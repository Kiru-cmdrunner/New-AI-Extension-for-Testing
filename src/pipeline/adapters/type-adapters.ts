/**
 * Type Adapters — Bridge Existing Types to Foundation Types
 *
 * These adapter functions convert the existing recorder's types
 * (shared/types.ts ElementIdentity, recorder/recorded-event.ts DomContext)
 * into the new Phase 1 target architecture types.
 *
 * This enables gradual migration: the existing recorder continues to produce
 * its types, and adapters convert them for the new pipeline. Once the
 * content script is fully migrated, these adapters will be removed.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type {
  ResolvedLocator,
  FrameContext,
  TargetElementIdentity,
  TargetDomContext,
  SurfaceInfo,
} from '../../types/element';
import type { EvidenceRecord } from '../../types/foundation';

// Import existing types (type-only — no runtime dependency)
import type { ElementIdentity } from '../../shared/types';
import type { DomContext } from '../../recorder/recorded-event';

// ── ElementIdentity → TargetElementIdentity ──────────────────────────────

/**
 * Map existing locator fields to ResolvedLocator[].
 *
 * The existing ElementIdentity stores locators as flat fields (cssSelector,
 * xPath, testId, etc.). This adapter converts them to the structured
 * ResolvedLocator[] model with confidence values.
 */
function adaptLocators(identity: ElementIdentity): ResolvedLocator[] {
  const locators: ResolvedLocator[] = [];

  if (identity.testId) {
    locators.push({ kind: 'testId', value: identity.testId, confidence: 0.95, source: 'observed' });
  }
  if (identity.dataCy) {
    locators.push({ kind: 'dataCy', value: identity.dataCy, confidence: 0.9, source: 'observed' });
  }
  if (identity.dataQa) {
    locators.push({ kind: 'dataQa', value: identity.dataQa, confidence: 0.9, source: 'observed' });
  }
  if (identity.ariaLabel) {
    locators.push({ kind: 'ariaLabel', value: identity.ariaLabel, confidence: 0.85, source: 'observed' });
  }
  if (identity.stableId) {
    locators.push({ kind: 'id', value: identity.stableId, confidence: 0.9, source: 'observed' });
  }
  if (identity.name) {
    locators.push({ kind: 'name', value: identity.name, confidence: 0.7, source: 'observed' });
  }
  if (identity.placeholder) {
    locators.push({ kind: 'placeholder', value: identity.placeholder, confidence: 0.6, source: 'observed' });
  }
  if (identity.cssSelector) {
    locators.push({ kind: 'css', value: identity.cssSelector, confidence: 0.4, source: 'computed' });
  }
  if (identity.xPath) {
    locators.push({ kind: 'xpath', value: identity.xPath, confidence: 0.3, source: 'computed' });
  }

  return locators;
}

/**
 * Map existing iframeContext to the new FrameContext type.
 */
function adaptFrameContext(identity: ElementIdentity): FrameContext | null {
  if (!identity.inIframe || !identity.iframeContext) return null;
  return {
    url: identity.iframeContext.frameSrc,
    name: identity.iframeContext.frameName,
    frameElementId: identity.iframeContext.frameId,
    frameSelector: identity.iframeContext.frameSelector,
    depth: identity.iframeContext.frameDepth,
  };
}

/**
 * Adapt existing ElementIdentity to the new TargetElementIdentity.
 *
 * This adapter performs a lossless conversion — all information from the
 * existing identity is preserved in the new structured format.
 *
 * Note: The existing recorder's DomContext is passed separately because it
 * is captured at event time, not as part of the element's static identity.
 */
export function adaptElementIdentity(identity: ElementIdentity): TargetElementIdentity {
  const locators = adaptLocators(identity);
  return {
    tag: identity.tag,
    accessibleName: identity.accessibleName,
    ariaRole: identity.ariaRole,
    ariaExpanded: null,
    ariaHasPopup: null,
    ariaChecked: null,
    ariaSelected: null,
    ariaPressed: null,
    inputType: null,
    isContentEditable: false,
    locators,
    primaryLocator: locators[0] ?? {
      kind: 'css',
      value: identity.cssSelector || identity.tag.toLowerCase(),
      confidence: 0.1,
      source: 'computed',
    },
    inShadowDom: identity.shadowDom,
    inIframe: identity.inIframe,
    frameContext: adaptFrameContext(identity),
  };
}

/**
 * Adapt existing DomContext + event data to TargetDomContext.
 *
 * This adapter combines the DomContext fields with event-level data
 * (valueBefore/After, checkedBefore/After, surfaces) to produce the
 * complete target DOM context.
 */
export function adaptDomContext(
  ctx: DomContext | undefined,
  eventData: {
    valueBefore: string | null;
    valueAfter: string | null;
    checkedBefore: boolean | null;
    checkedAfter: boolean | null;
    surfaces?: SurfaceInfo[];
  },
): TargetDomContext {
  // Build surfaces array
  const surfaces: SurfaceInfo[] = [];
  if (eventData.surfaces) {
    surfaces.push(...eventData.surfaces);
  } else if (ctx?.surfaceType) {
    surfaces.push({
      type: ctx.surfaceType as SurfaceInfo['type'],
      role: ctx.surfaceRole ?? null,
      accessibleName: ctx.surfaceLabel ?? null,
      direction: 'appeared',
      detectedAt: new Date().toISOString(),
    });
  }

  // Build value transition
  const valueTransition = (eventData.valueBefore !== null || eventData.valueAfter !== null)
    ? { before: eventData.valueBefore ?? '', after: eventData.valueAfter ?? '' }
    : null;

  // Build checked transition
  let checkedTransition = null;
  if (eventData.checkedBefore !== null && eventData.checkedAfter !== null) {
    checkedTransition = {
      before: eventData.checkedBefore,
      after: eventData.checkedAfter,
      property: 'checked' as const,
    };
  }

  // Date picker context
  let datePicker = null;
  if (ctx?.dateType) {
    datePicker = {
      dateType: ctx.dateType as 'date' | 'time' | 'dateTime' | 'month' | 'week',
      isoValue: ctx.isoValue ?? '',
      displayValue: ctx.displayValue ?? '',
      ambiguous: ctx.dateAmbiguous ?? false,
      confidence: ctx.dateConfidence ?? 0,
    };
  }

  // File upload context
  let fileUpload = null;
  if (ctx?.uploadMethod) {
    fileUpload = {
      method: ctx.uploadMethod,
      acceptedTypes: ctx.acceptedFileTypes?.split(',').map((s: string) => s.trim()) ?? [],
      multiple: ctx.multipleFiles ?? false,
      files: ctx.fileData ?? [],
    };
  }

  // Dialog context
  let dialog = null;
  if (ctx?.triggeredDialog) {
    dialog = {
      type: ctx.triggeredDialog,
      message: ctx.dialogMessage ?? '',
      result: ctx.dialogResult ?? '',
    };
  }

  // Navigation context
  let navigation = null;
  if (ctx?.openedUrl) {
    navigation = {
      url: ctx.openedUrl,
      title: '',
      newTab: ctx.opensNewTab ?? false,
      newWindow: ctx.opensNewWindow ?? false,
    };
  }

  return {
    surfaces,
    valueTransition,
    checkedTransition,
    ancestorChain: ctx?.ancestorRoles ?? [],
    datePicker,
    fileUpload,
    dialog,
    navigation,
  };
}

// ── RecordedEvent → EvidenceRecord[] Adapter ────────────────────────────

/**
 * Convert an existing RecordedEvent's identity and context into the
 * new EvidenceRecord[] format.
 *
 * This adapter enables the existing recorder's events to be processed
 * by the new evidence pipeline without modifying the recorder itself.
 *
 * It synthesizes EvidenceRecords from the already-captured data,
 * simulating what the channels would produce if the recorder were
 * fully migrated.
 */
export function recordedEventToEvidenceRecords(
  identity: ElementIdentity,
  ctx: DomContext | undefined,
  eventType: string,
  timestamp: string,
  valueBefore: string | null,
  valueAfter: string | null,
  checkedBefore: boolean | null,
  checkedAfter: boolean | null,
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];

  // Channel A signals (from identity)
  if (identity.ariaRole) {
    records.push({ channelId: 'A', signalType: 'ariaRole', timestamp, value: identity.ariaRole, confidence: 1.0 });
  }
  if (identity.accessibleName) {
    records.push({ channelId: 'A', signalType: 'accessibleName', timestamp, value: identity.accessibleName, confidence: 1.0 });
  }

  // Channel B signals (from identity)
  records.push({ channelId: 'B', signalType: 'tag', timestamp, value: identity.tag, confidence: 1.0 });
  if (identity.className) {
    const classes = identity.className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      records.push({ channelId: 'B', signalType: 'cssClass', timestamp, value: classes, confidence: 1.0 });
    }
  }

  // Channel C signals (from event data)
  records.push({ channelId: 'C', signalType: 'eventSequence', timestamp, value: eventType, confidence: 1.0 });
  if (valueBefore !== null || valueAfter !== null) {
    records.push({
      channelId: 'C', signalType: 'valueTransition', timestamp,
      value: { before: valueBefore ?? '', after: valueAfter ?? '' }, confidence: 1.0,
    });
  }
  if (checkedBefore !== null && checkedAfter !== null) {
    records.push({
      channelId: 'C', signalType: 'checkedTransition', timestamp,
      value: { before: checkedBefore, after: checkedAfter }, confidence: 1.0,
    });
  }

  // Channel A/D signals (from DomContext)
  if (ctx?.ariaExpanded !== undefined && ctx.ariaExpanded !== null) {
    records.push({
      channelId: 'A', signalType: 'ariaAttribute', timestamp,
      value: { attribute: 'aria-expanded', value: ctx.ariaExpanded }, confidence: 1.0,
    });
  }
  if (ctx?.ariaHasPopup) {
    records.push({
      channelId: 'A', signalType: 'ariaAttribute', timestamp,
      value: { attribute: 'aria-haspopup', value: ctx.ariaHasPopup }, confidence: 1.0,
    });
  }
  if (ctx?.surfaceType) {
    records.push({
      channelId: 'D', signalType: 'surfaceAppearance', timestamp,
      value: {
        type: ctx.surfaceType,
        role: ctx.surfaceRole,
        accessibleName: ctx.surfaceLabel,
      }, confidence: 0.9,
    });
  }
  if (ctx?.ancestorRoles && ctx.ancestorRoles.length > 0) {
    records.push({ channelId: 'B', signalType: 'hierarchy', timestamp, value: ctx.ancestorRoles, confidence: 1.0 });
  }

  return records;
}
