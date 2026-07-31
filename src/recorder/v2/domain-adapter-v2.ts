/**
 * Domain Adapter V2 — Interaction-Centric Domain Entity Mapping
 *
 * Replaces the legacy event-centric domain adapter when recorderEngine='control'.
 * Instead of creating one transition per raw event (focus, input, change, blur =
 * 4 transitions for one TextEntry), this adapter creates ONE transition per
 * DetectedInteraction — producing clean, interaction-level domain entities.
 *
 * Benefits over the legacy adapter:
 *   - 4-5× fewer transitions (1 per interaction, not per raw event)
 *   - Richer state extraction (from interaction.metadata, not individual events)
 *   - Cleaner evidence descriptions (from the semantic interaction type)
 *   - No noise transitions (scroll, focus, blur without classification)
 *   - Recognition pipeline receives interaction-level granularity
 *
 * Produces the same DomainEntities interface so all downstream consumers
 * (recognition orchestrator, enrichment, healing) work unchanged.
 */

import type { DetectedInteraction, InteractionMetadata } from '../../classifier/interaction-types';
import type { ElementIdentity } from '../../shared/types';
import type { RecordedEvent } from '../recorded-event';
import type { DomainEntities } from '../pipeline/domain-adapter';
import { UiElement, createUiElement } from '../../domain/entities/ui-element';
import { createObservedTransition, emptyElementState, type ObservedTransition } from '../../domain/entities/observed-transition';
import {
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
} from '../../domain/enums';

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
 * Extract the state BEFORE an interaction from the metadata and raw events.
 *
 * For the control engine, we don't always have a "before" state because
 * the recognizer focuses on the final committed value. We use the raw
 * events' valueBefore when available, otherwise empty state.
 */
function buildStateBefore(
  interaction: DetectedInteraction,
  eventsById: Map<string, RecordedEvent>,
): { value: string | null; checked: boolean | null; expanded: boolean | null; selected: boolean | null } {
  // Try to find the "before" state from the first event in the interaction
  const firstEventId = interaction.eventIds[0];
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
function buildStateAfter(metadata: InteractionMetadata): {
  value: string | null;
  checked: boolean | null;
  expanded: boolean | null;
  selected: boolean | null;
} {
  // Extract the final value from metadata based on interaction type
  const value =
    metadata.textValue
    ?? metadata.selectedValue
    ?? metadata.dateValue
    ?? metadata.timeValue
    ?? metadata.dateTimeValue
    ?? metadata.sliderValue
    ?? null;

  const checked = metadata.checked ?? null;

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
  interaction: DetectedInteraction,
  eventsById: Map<string, RecordedEvent>,
): { type: TransitionEvidenceType; description: string; before: string | null; after: string | null }[] {
  const evidence: { type: TransitionEvidenceType; description: string; before: string | null; after: string | null }[] = [];
  const meta = interaction.metadata;

  // Value-based evidence
  const afterValue =
    meta.textValue
    ?? meta.selectedValue
    ?? meta.dateValue
    ?? meta.timeValue
    ?? meta.dateTimeValue
    ?? meta.sliderValue;

  if (afterValue !== undefined && afterValue !== null) {
    // Try to get the "before" value from the first event
    const firstEventId = interaction.eventIds[0];
    const firstEvent = eventsById.get(firstEventId);
    const beforeValue = firstEvent && firstEvent.eventType !== 'navigation'
      ? (firstEvent as { valueBefore: string | null }).valueBefore
      : null;

    evidence.push({
      type: TransitionEvidenceType.VALUE_CHANGE,
      description: buildInteractionDescription(interaction),
      before: beforeValue,
      after: afterValue,
    });
  }

  // Checked-state evidence
  if (meta.checked !== undefined && meta.checked !== null) {
    const firstEventId = interaction.eventIds[0];
    const firstEvent = eventsById.get(firstEventId);
    const beforeChecked = firstEvent && firstEvent.eventType !== 'navigation'
      ? (firstEvent as { checkedBefore: boolean | null }).checkedBefore
      : null;

    if (beforeChecked !== meta.checked) {
      evidence.push({
        type: TransitionEvidenceType.STATE_CHANGE,
        description: `State changed to ${meta.checked ? 'checked' : 'unchecked'}`,
        before: beforeChecked !== null ? String(beforeChecked) : null,
        after: String(meta.checked),
      });
    }
  }

  // Navigation evidence
  if (meta.url) {
    evidence.push({
      type: TransitionEvidenceType.NAVIGATION,
      description: `Navigated to ${meta.url}`,
      before: null,
      after: meta.url,
    });
  }

  // If no evidence was generated, create a minimal one so the transition is never empty
  if (evidence.length === 0) {
    evidence.push({
      type: TransitionEvidenceType.VALUE_CHANGE,
      description: buildInteractionDescription(interaction),
      before: null,
      after: null,
    });
  }

  return evidence;
}

/**
 * Build a human-readable description of the interaction.
 */
function buildInteractionDescription(interaction: DetectedInteraction): string {
  const meta = interaction.metadata;
  const name = interaction.target?.accessibleName ?? 'element';

  switch (interaction.type) {
    case 'TextEntry':
      return `Entered "${meta.textValue ?? ''}" into ${name}`;
    case 'NativeDropdown':
    case 'CustomDropdown':
      return `Selected "${meta.selectedValue ?? ''}" from ${name}`;
    case 'Checkbox':
      return `${meta.checked ? 'Checked' : 'Unchecked'} ${name}`;
    case 'RadioButton':
      return `Selected ${meta.selectedValue ?? name}`;
    case 'ToggleSwitch':
      return `${meta.checked ? 'Enabled' : 'Disabled'} ${name}`;
    case 'DatePicker':
      return `Selected date ${meta.dateValue ?? meta.displayValue ?? ''} for ${name}`;
    case 'TimePicker':
      return `Selected time ${meta.timeValue ?? ''} for ${name}`;
    case 'DateTimePicker':
      return `Selected datetime ${meta.dateTimeValue ?? ''} for ${name}`;
    case 'Slider':
      return `Adjusted ${name} to ${meta.sliderValue ?? ''}`;
    case 'FileUpload':
      return meta.fileCount ? `Uploaded ${meta.fileCount} file(s) to ${name}` : `Uploaded file to ${name}`;
    case 'DragDrop':
    case 'DragDropUpload':
      return `Dragged and dropped onto ${meta.dropTarget ?? name}`;
    case 'PageNavigation':
    case 'Back':
    case 'Forward':
    case 'Refresh':
      return `Navigated to ${meta.url ?? name}`;
    case 'Hover':
      return `Hovered over ${name}`;
    case 'Link':
      return `Clicked link "${name}"`;
    case 'Click':
      return `Clicked ${name}`;
    default:
      return `${interaction.type} on ${name}`;
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
  interactions: DetectedInteraction[],
  sourceUrl: string,
): DomainEntities {
  // Index events by ID for O(1) lookup of "before" state
  const eventsById = new Map<string, RecordedEvent>();
  for (const event of events) {
    eventsById.set(event.eventId, event);
  }

  const elementMap = new Map<string, UiElement>();
  const transitions: ObservedTransition[] = [];

  for (const interaction of interactions) {
    // Navigation interactions don't have a target element
    if (!interaction.target) {
      const transition = createObservedTransition({
        transitionId: interaction.interactionId,
        elementId: '__page__',
        operation: resolveOperation(interaction.type),
        timestamp: extractTimestamp(interaction, eventsById),
        relevance: RelevanceLevel.DELIBERATE,
        stateBefore: emptyElementState(),
        stateAfter: emptyElementState(),
        evidence: buildEvidence(interaction, eventsById),
      });
      transitions.push(transition);
      continue;
    }

    const identity = interaction.target;
    const elementId = identity.elementId;

    // Create UiElement if not already seen
    if (!elementMap.has(elementId)) {
      // Look up DOM attributes from the first event for this interaction
      const firstEvent = eventsById.get(interaction.eventIds[0]);
      const domAttributes = firstEvent && firstEvent.eventType !== 'navigation'
        ? (firstEvent as { domContext?: { domAttributes?: Record<string, string> } }).domContext?.domAttributes ?? {}
        : {};

      const uiElement = createUiElement({
        elementId,
        identity,
        domAttributes,
        sourceUrl,
        domTreePath: buildDomTreePath(identity),
      });
      elementMap.set(elementId, uiElement);
    }

    // Create one transition for the interaction
    const operation = resolveOperation(interaction.type);
    const stateBefore = buildStateBefore(interaction, eventsById);
    const stateAfter = buildStateAfter(interaction.metadata);
    const evidence = buildEvidence(interaction, eventsById);

    const transition = createObservedTransition({
      transitionId: interaction.interactionId,
      elementId,
      operation,
      timestamp: extractTimestamp(interaction, eventsById),
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
  interaction: DetectedInteraction,
  eventsById: Map<string, RecordedEvent>,
): number {
  const firstEventId = interaction.eventIds[0];
  const firstEvent = eventsById.get(firstEventId);
  if (firstEvent) {
    const ts = new Date(firstEvent.timestamp).getTime();
    if (!isNaN(ts)) return ts;
  }
  return Date.now();
}
