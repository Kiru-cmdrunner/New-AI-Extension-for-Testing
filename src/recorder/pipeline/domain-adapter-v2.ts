/**
 * Domain Adapter V2 — Interaction-Centric Domain Entity Mapping
 *
 * The canonical domain adapter, converting raw RecordedEvents into interaction-centric domain entities.
 * Instead of creating one transition per raw event (focus, input, change, blur =
 * 4 transitions for one TextEntry), this adapter creates ONE transition per
 * interaction — producing clean, interaction-level domain entities.
 *
 * Phase 3 — Type System Unification: now accepts ComponentInteraction[] directly,
 * eliminating the dependency on the classifier's DetectedInteraction type.
 * The interaction type is resolved using the same subtype→default→'Unknown'
 * resolution as the former adapter.
 *
 * Produces the same DomainEntities interface so all downstream consumers
 * (recognition orchestrator, enrichment, healing) work unchanged.
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ElementIdentity } from '../../shared/types';
import type { RecordedEvent } from '../recorded-event';
import { UiElement, createUiElement } from '../../domain/entities/ui-element';
import { createObservedTransition, emptyElementState, type ObservedTransition } from '../../domain/entities/observed-transition';
import {
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
} from '../../domain/enums';

// ── Domain Entities Interface ──────────────────────────────────────────

/**
 * Domain entities produced by the domain adapter.
 * Consumed by recognition orchestrator, enrichment, and healing.
 */
export interface DomainEntities {
  elements: UiElement[];
  transitions: ObservedTransition[];
}

// ── Interaction → Operation Mapping ─────────────────────────────────────

/**
 * Maps InteractionType → TransitionOperation.
 *
 * Simpler than the legacy mapping because the control engine's recognizer
 * already classified the semantic action — we just translate the domain enum.
 */
const INTERACTION_TO_OPERATION: Record<string, TransitionOperation> = {
  // Text entry
  TextEntry: TransitionOperation.FILL,
  // Toggles
  Checkbox: TransitionOperation.TOGGLE,
  ToggleSwitch: TransitionOperation.TOGGLE,
  RadioButton: TransitionOperation.TOGGLE,
  // Selections
  NativeDropdown: TransitionOperation.SELECT,
  CustomDropdown: TransitionOperation.SELECT,
  Autocomplete: TransitionOperation.SELECT,
  MultiSelect: TransitionOperation.SELECT,
  // Date & Time
  DatePicker: TransitionOperation.SELECT_DATE,
  TimePicker: TransitionOperation.SELECT_DATE,
  DateTimePicker: TransitionOperation.SELECT_DATE,
  // Hover
  Hover: TransitionOperation.HOVER,
  // Navigation
  PageNavigation: TransitionOperation.NAVIGATE,
  Back: TransitionOperation.NAVIGATE,
  Forward: TransitionOperation.NAVIGATE,
  Refresh: TransitionOperation.NAVIGATE,
  // Drag & Drop
  DragDrop: TransitionOperation.CLICK,
  DragDropUpload: TransitionOperation.CLICK,
  // File Upload
  FileUpload: TransitionOperation.CLICK,
  // Slider
  Slider: TransitionOperation.CLICK,
  // Default: everything else is a click
  Click: TransitionOperation.CLICK,
  DoubleClick: TransitionOperation.CLICK,
  RightClick: TransitionOperation.CLICK,
  Link: TransitionOperation.CLICK,
  Tab: TransitionOperation.CLICK,
  Menu: TransitionOperation.CLICK,
  Breadcrumb: TransitionOperation.CLICK,
  BrowserAlert: TransitionOperation.CLICK,
  Modal: TransitionOperation.CLICK,
  Drawer: TransitionOperation.CLICK,
  Popover: TransitionOperation.CLICK,
  Tooltip: TransitionOperation.CLICK,
  NewTab: TransitionOperation.CLICK,
  NewWindow: TransitionOperation.CLICK,
  Iframe: TransitionOperation.CLICK,
  Unknown: TransitionOperation.CLICK,
  PageScroll: TransitionOperation.CLICK,
  ContainerScroll: TransitionOperation.CLICK,
  InfiniteScroll: TransitionOperation.CLICK,
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the TransitionOperation for an interaction.
 * Falls back to CLICK if the interaction type has no mapping.
 */
function resolveOperation(type: string): TransitionOperation {
  return INTERACTION_TO_OPERATION[type] ?? TransitionOperation.CLICK;
}

/**
 * Resolve the bridge interaction type from a ComponentInteraction.
 * Same resolution as the former adapter: subtype → DEFAULT_BRIDGE_TYPE → 'Unknown'.
 */
const DEFAULT_V2_TYPE: Record<string, string> = {
  Click: 'Click',
  TextEntry: 'TextEntry',
  Dropdown: 'CustomDropdown',
  Checkbox: 'Checkbox',
  RadioButton: 'RadioButton',
  DatePicker: 'DatePicker',
  Hover: 'Hover',
  Link: 'Link',
  FileUpload: 'FileUpload',
  Slider: 'Slider',
  Tab: 'Tab',
  Scroll: 'PageScroll',
  Navigation: 'PageNavigation',
  DragDrop: 'DragDrop',
  KeyboardShortcut: 'KeyboardShortcut',
  ModalDialog: 'ModalDialog',
  Stepper: 'Stepper',
  TagInput: 'TagInput',
  OtpInput: 'OtpInput',
  HotkeySequence: 'HotkeySequence',
  NewTab: 'NewTab',
  NewWindow: 'NewWindow',
  Breadcrumb: 'Breadcrumb',
};

function resolveType(ci: ComponentInteraction): string {
  return ci.interactionSubtype || DEFAULT_V2_TYPE[ci.type] || 'Unknown';
}

/**
 * Get the event IDs from a ComponentInteraction.
 */
function getEventIds(ci: ComponentInteraction): string[] {
  return (ci.memberEvents ?? []).map((e) => e.eventId);
}

/**
 * Extract the state BEFORE an interaction from the metadata and raw events.
 *
 * For the control engine, we don't always have a "before" state because
 * the recognizer focuses on the final committed value. We use the raw
 * events' valueBefore when available, otherwise empty state.
 */
function buildStateBefore(
  ci: ComponentInteraction,
  eventsById: Map<string, RecordedEvent>,
): { value: string | null; checked: boolean | null; expanded: boolean | null; selected: boolean | null } {
  const firstEventId = getEventIds(ci)[0];
  const firstEvent = eventsById.get(firstEventId);

  if (firstEvent && firstEvent.eventType !== 'navigation') {
    const el = firstEvent as { valueBefore: string | null; checkedBefore: boolean | null; domContext?: { ariaExpanded?: boolean | null } };
    return {
      value: el.valueBefore ?? null,
      checked: el.checkedBefore ?? null,
      expanded: el.domContext?.ariaExpanded ?? null,
      selected: null,
    };
  }

  return emptyElementState();
}

/**
 * Extract the state AFTER an interaction from the metadata.
 */
function buildStateAfter(metadata: Record<string, unknown>): {
  value: string | null;
  checked: boolean | null;
  expanded: boolean | null;
  selected: boolean | null;
} {
  // Extract the final value from metadata based on interaction type
  const value =
    (metadata.textValue as string)
    ?? (metadata.selectedValue as string)
    ?? (metadata.dateValue as string)
    ?? (metadata.sliderValue as string)
    ?? null;

  const checked = (metadata.checked as boolean) ?? null;

  return {
    value,
    checked,
    expanded: null, // Not tracked post-interaction by the recognizer
    selected: null,
  };
}

/**
 * Build evidence array from interaction metadata.
 */
function buildEvidence(
  ci: ComponentInteraction,
  eventsById: Map<string, RecordedEvent>,
  resolvedType: string,
): { type: TransitionEvidenceType; description: string; before: string | null; after: string | null }[] {
  const evidence: { type: TransitionEvidenceType; description: string; before: string | null; after: string | null }[] = [];
  const meta = ci.metadata;

  // Value-based evidence
  const afterValue =
    (meta.textValue as string)
    ?? (meta.selectedValue as string)
    ?? (meta.selectedDate as string)
    ?? (meta.sliderValue as string)
    ?? null;

  if (afterValue !== undefined && afterValue !== null) {
    const firstEventId = getEventIds(ci)[0];
    const firstEvent = eventsById.get(firstEventId);
    const beforeValue = firstEvent && firstEvent.eventType !== 'navigation'
      ? (firstEvent as { valueBefore: string | null }).valueBefore
      : null;

    evidence.push({
      type: TransitionEvidenceType.VALUE_CHANGE,
      description: buildInteractionDescription(ci, resolvedType),
      before: beforeValue,
      after: afterValue,
    });
  }

  // Checked-state evidence
  const checked = meta.checked as boolean | undefined;
  if (checked !== undefined && checked !== null) {
    const firstEventId = getEventIds(ci)[0];
    const firstEvent = eventsById.get(firstEventId);
    const beforeChecked = firstEvent && firstEvent.eventType !== 'navigation'
      ? (firstEvent as { checkedBefore: boolean | null }).checkedBefore
      : null;

    if (beforeChecked !== checked) {
      evidence.push({
        type: TransitionEvidenceType.STATE_CHANGE,
        description: `State changed to ${checked ? 'checked' : 'unchecked'}`,
        before: beforeChecked !== null ? String(beforeChecked) : null,
        after: String(checked),
      });
    }
  }

  // Navigation evidence
  const navEvent = ci.triggerEvent;
  const url = (meta.url as string) ?? navEvent?.pageUrl;
  if (url) {
    evidence.push({
      type: TransitionEvidenceType.NAVIGATION,
      description: `Navigated to ${url}`,
      before: null,
      after: url,
    });
  }

  // If no evidence was generated, create a minimal one
  if (evidence.length === 0) {
    evidence.push({
      type: TransitionEvidenceType.VALUE_CHANGE,
      description: buildInteractionDescription(ci, resolvedType),
      before: null,
      after: null,
    });
  }

  return evidence;
}

/**
 * Build a human-readable description of the interaction.
 */
function buildInteractionDescription(ci: ComponentInteraction, resolvedType: string): string {
  const meta = ci.metadata;
  const name = ci.trigger?.accessibleName ?? 'element';

  switch (resolvedType) {
    case 'TextEntry':
      return `Entered "${(meta.textValue as string) ?? ''}" into ${name}`;
    case 'NativeDropdown':
    case 'CustomDropdown':
      return `Selected "${(meta.selectedValue as string) ?? ''}" from ${name}`;
    case 'Checkbox':
      return `${(meta.checked as boolean) ? 'Checked' : 'Unchecked'} ${name}`;
    case 'RadioButton':
      return `Selected ${(meta.selectedValue as string) ?? name}`;
    case 'ToggleSwitch':
      return `${(meta.checked as boolean) ? 'Enabled' : 'Disabled'} ${name}`;
    case 'DatePicker':
      return `Selected date ${(meta.dateValue as string) ?? (meta.displayValue as string) ?? ''} for ${name}`;
    case 'Slider':
      return `Adjusted ${name} to ${(meta.sliderValue as string) ?? ''}`;
    case 'FileUpload':
      return meta.fileCount ? `Uploaded ${meta.fileCount} file(s) to ${name}` : `Uploaded file to ${name}`;
    case 'DragDrop':
    case 'DragDropUpload':
      return `Dragged and dropped onto ${(meta.dropTarget as string) ?? name}`;
    case 'PageNavigation':
    case 'Back':
    case 'Forward':
    case 'Refresh':
      return `Navigated to ${(meta.url as string) ?? name}`;
    case 'Hover':
      return `Hovered over ${name}`;
    case 'Link':
      return `Clicked link "${name}"`;
    case 'Click':
      return `Clicked ${name}`;
    default:
      return `${resolvedType} on ${name}`;
  }
}

/**
 * Build the domTreePath from an ElementIdentity.
 */
function buildDomTreePath(identity: ElementIdentity): string {
  if (identity.cssSelector) return identity.cssSelector;
  if (identity.xPath) return identity.xPath;
  return identity.tag.toLowerCase();
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Convert control-engine interactions to domain entities.
 *
 * Interaction-centric: ONE transition per interaction (not per raw event).
 *
 * @param events - Raw recorded events (used for "before" state lookup)
 * @param interactions - Detected interactions from the Control Model recognizer
 * @param sourceUrl - URL of the page where recording occurred
 * @returns Domain entities: { elements: UiElement[], transitions: ObservedTransition[] }
 */
export function adaptToDomainEntitiesV2(
  events: RecordedEvent[],
  interactions: ComponentInteraction[],
  sourceUrl: string,
): DomainEntities {
  // Index events by ID for O(1) lookup of "before" state
  const eventsById = new Map<string, RecordedEvent>();
  for (const event of events) {
    eventsById.set(event.eventId, event);
  }

  const elementMap = new Map<string, UiElement>();
  const transitions: ObservedTransition[] = [];

  for (const ci of interactions) {
    const resolvedType = resolveType(ci);
    const eventIds = getEventIds(ci);

    // Navigation interactions don't have a meaningful target element.
    // In the unified type system, trigger is always set, so we check the resolved type.
    const isNavigation = resolvedType === 'PageNavigation'
      || resolvedType === 'Back'
      || resolvedType === 'Forward'
      || resolvedType === 'Refresh';
    if (isNavigation) {
      const transition = createObservedTransition({
        transitionId: ci.interactionId,
        elementId: '__page__',
        operation: resolveOperation(resolvedType),
        timestamp: extractTimestamp(ci, eventsById),
        relevance: RelevanceLevel.DELIBERATE,
        stateBefore: emptyElementState(),
        stateAfter: emptyElementState(),
        evidence: buildEvidence(ci, eventsById, resolvedType),
      });
      transitions.push(transition);
      continue;
    }

    const identity = ci.trigger;
    const elementId = identity.elementId;

    // Create UiElement if not already seen
    if (!elementMap.has(elementId)) {
      const firstEvent = eventsById.get(eventIds[0]);
      const domAttributes = firstEvent && firstEvent.eventType !== 'navigation'
        ? (firstEvent as { domContext?: { domAttributes?: Record<string, string> } }).domContext?.domAttributes ?? {}
        : {};

      // R4: Extract ancestorRoles from first event's DomContext
      const ancestorRoles = firstEvent && firstEvent.eventType !== 'navigation'
        ? (firstEvent as { domContext?: { ancestorRoles?: string[] } }).domContext?.ancestorRoles
        : undefined;

      const uiElement = createUiElement({
        elementId,
        identity,
        domAttributes,
        sourceUrl,
        domTreePath: buildDomTreePath(identity),
        ancestorRoles,
      });
      elementMap.set(elementId, uiElement);
    }

    // Create one transition for the interaction
    const operation = resolveOperation(resolvedType);
    const stateBefore = buildStateBefore(ci, eventsById);
    const stateAfter = buildStateAfter(ci.metadata);
    const evidence = buildEvidence(ci, eventsById, resolvedType);

    const transition = createObservedTransition({
      transitionId: ci.interactionId,
      elementId,
      operation,
      timestamp: extractTimestamp(ci, eventsById),
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore,
      stateAfter,
      evidence,
    });
    transitions.push(transition);
  }

  return {
    elements: Array.from(elementMap.values()),
    transitions,
  };
}

/**
 * Extract the timestamp for an interaction from its first event.
 */
function extractTimestamp(
  ci: ComponentInteraction,
  eventsById: Map<string, RecordedEvent>,
): number {
  const firstEventId = getEventIds(ci)[0];
  const firstEvent = eventsById.get(firstEventId);
  if (firstEvent) {
    const ts = new Date(firstEvent.timestamp).getTime();
    if (!isNaN(ts)) return ts;
  }
  return Date.now();
}
