/**
 * Domain Adapter — converts deterministic recorder output to domain entities.
 *
 * This module bridges the deterministic recorder's capture format
 * (RecordedEvent[] + DetectedInteraction[]) to the domain entities the
 * Recognition and Enrichment pipelines consume (UiElement[] + ObservedTransition[]).
 *
 * Design principle: The adapter is a pure transformation. It does not
 * access the DOM, call external services, or maintain state. It is
 * deterministic and side-effect-free.
 *
 * Milestone 6.2 — Phase 6 wiring.
 */

import type { RecordedEvent, ElementRecordedEvent, NavigationRecordedEvent } from '../recorded-event';
import type { ComponentInteraction } from '../../shared/component-types';
import type { ElementIdentity } from '../../shared/types';
import { UiElement, createUiElement } from '../../domain/entities/ui-element';
import { ObservedTransition, createObservedTransition, emptyElementState } from '../../domain/entities/observed-transition';
import {
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
} from '../../domain/enums';

// ── Public types ────────────────────────────────────────────────────────

/**
 * Result of the adapter: the domain entities consumed by Recognition.
 * `ComponentGrouping` is not produced here — it is produced by the
 * recognition orchestrator.
 */
export interface DomainEntities {
  elements: UiElement[];
  transitions: ObservedTransition[];
}

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Mapping from InteractionType (classifier output) to TransitionOperation (domain entity).
 *
 * Most interaction types map to CLICK, because they begin with or are
 * fundamentally a click that the classifier enriched with additional context.
 * TextEntry maps to FILL, checkboxes/toggles to TOGGLE, dropdowns/selects to SELECT,
 * date interactions to SELECT_DATE, and hover to HOVER.
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
  // Default: everything else is a click
  Click: TransitionOperation.CLICK,
  DoubleClick: TransitionOperation.CLICK,
  RightClick: TransitionOperation.CLICK,
  Link: TransitionOperation.CLICK,
  Tab: TransitionOperation.CLICK,
  Menu: TransitionOperation.CLICK,
  Breadcrumb: TransitionOperation.CLICK,
  DragDrop: TransitionOperation.CLICK,
  FileUpload: TransitionOperation.CLICK,
  DragDropUpload: TransitionOperation.CLICK,
  Slider: TransitionOperation.CLICK,
  BrowserAlert: TransitionOperation.CLICK,
  Modal: TransitionOperation.CLICK,
  Drawer: TransitionOperation.CLICK,
  Popover: TransitionOperation.CLICK,
  Tooltip: TransitionOperation.CLICK,
  NewTab: TransitionOperation.CLICK,
  NewWindow: TransitionOperation.CLICK,
  Iframe: TransitionOperation.CLICK,
};

/**
 * Raw event types that map to FILL for when no DetectedInteraction is available.
 */
const FILL_EVENT_TYPES = new Set(['input', 'change']);

/**
 * Event types that are inherently noise — not meaningful transitions.
 */
const NOISE_EVENT_TYPES = new Set(['scroll', 'focus', 'blur']);

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Resolve the TransitionOperation for a recorded event.
 *
 * Priority:
 *   1. If a DetectedInteraction covers this event, use its InteractionType mapping.
 *   2. Otherwise, infer from the raw event type.
 */
function resolveOperation(
  event: ElementRecordedEvent,
  interactionByEventId: Map<string, ComponentInteraction>,
): TransitionOperation {
  const ci = interactionByEventId.get(event.eventId);
  if (ci) {
    const resolvedType = ci.interactionSubtype || ci.type;
    const mapped = INTERACTION_TO_OPERATION[resolvedType];
    if (mapped) return mapped;
  }

  // Fallback: infer from raw event type
  if (FILL_EVENT_TYPES.has(event.eventType)) return TransitionOperation.FILL;
  if (event.eventType === 'mouseenter') return TransitionOperation.HOVER;

  return TransitionOperation.CLICK;
}

/**
 * Determine the relevance level of a transition.
 *
 * If an interaction covers the event, it's DELIBERATE.
 * Scroll/focus/blur without classification are NOISE.
 */
function resolveRelevance(
  event: ElementRecordedEvent,
  interactionByEventId: Map<string, ComponentInteraction>,
): RelevanceLevel {
  const ci = interactionByEventId.get(event.eventId);
  if (ci) return RelevanceLevel.DELIBERATE;
  if (NOISE_EVENT_TYPES.has(event.eventType)) return RelevanceLevel.NOISE;
  return RelevanceLevel.SUPPORTING;
}

/**
 * Build an ElementState from a recorded event's values.
 */
function buildElementState(
  value: string | null,
  checked: boolean | null,
  domContext?: { ariaExpanded?: boolean | null },
): { value: string | null; checked: boolean | null; expanded: boolean | null; selected: boolean | null } {
  return {
    value,
    checked,
    expanded: domContext?.ariaExpanded ?? null,
    selected: null, // Not directly captured by the recorder
  };
}

/**
 * Build evidence array from a recorded event.
 */
function buildEvidence(event: ElementRecordedEvent): {
  type: TransitionEvidenceType;
  description: string;
  before: string | null;
  after: string | null;
}[] {
  const evidence: {
    type: TransitionEvidenceType;
    description: string;
    before: string | null;
    after: string | null;
  }[] = [];

  // Value change evidence
  if (event.valueBefore !== event.valueAfter && (event.valueBefore !== null || event.valueAfter !== null)) {
    evidence.push({
      type: TransitionEvidenceType.VALUE_CHANGE,
      description: `Value changed from "${event.valueBefore}" to "${event.valueAfter}"`,
      before: event.valueBefore,
      after: event.valueAfter,
    });
  }

  // Checked state change evidence
  if (event.checkedBefore !== event.checkedAfter && (event.checkedBefore !== null || event.checkedAfter !== null)) {
    evidence.push({
      type: TransitionEvidenceType.STATE_CHANGE,
      description: `Checked state changed from ${event.checkedBefore} to ${event.checkedAfter}`,
      before: event.checkedBefore !== null ? String(event.checkedBefore) : null,
      after: event.checkedAfter !== null ? String(event.checkedAfter) : null,
    });
  }

  return evidence;
}

/**
 * Build the domTreePath from an ElementIdentity.
 *
 * Uses cssSelector as the primary path (it already encodes the DOM structure).
 * Falls back to xPath if cssSelector is empty.
 */
function buildDomTreePath(identity: ElementIdentity): string {
  if (identity.cssSelector) return identity.cssSelector;
  if (identity.xPath) return identity.xPath;
  return identity.tag.toLowerCase();
}

/**
 * Build a sourceUrl for an element.
 *
 * ElementRecordedEvent doesn't carry a URL directly. When available,
 * we construct it from the identity or use a fallback.
 */
function buildSourceUrl(_event: ElementRecordedEvent): string {
  // ElementRecordedEvent doesn't have a url field, but NavigationRecordedEvent does.
  // We use 'about:blank' as a placeholder — the caller can override with the
  // tab URL when available (the service worker has the tab's URL).
  // In practice, the STOP_RECORDING handler will pass the tab URL.
  return 'about:blank';
}

/**
 * Extract the elementId from an ElementIdentity.
 */
function getElementId(identity: ElementIdentity): string {
  return identity.elementId;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Convert deterministic recorder output to domain entities.
 *
 * @param events - Raw recorded events from the deterministic recorder.
 * @param interactions - Detected interactions from the V1/V2 classifier (optional).
 * @param sourceUrl - The URL of the page where recording occurred (overrides per-event).
 * @returns Domain entities: { elements: UiElement[], transitions: ObservedTransition[] }
 */
export function adaptToDomainEntities(
  events: RecordedEvent[],
  interactions: ComponentInteraction[] = [],
  sourceUrl?: string,
): DomainEntities {
  // Index interactions by event ID for O(1) lookup
  const interactionByEventId = new Map<string, ComponentInteraction>();
  for (const ci of interactions) {
    for (const eventId of (ci.memberEvents ?? []).map(e => e.eventId)) {
      interactionByEventId.set(eventId, ci);
    }
  }

  const elementMap = new Map<string, UiElement>();
  const transitions: ObservedTransition[] = [];

  for (const event of events) {
    // Navigation events are not element events — skip for element creation
    if (event.eventType === 'navigation') {
      const navEvent = event as NavigationRecordedEvent;
      // Create a synthetic navigation transition (no element)
      // We don't create a UiElement for navigation — it's page-level
      const transition = createObservedTransition({
        transitionId: navEvent.eventId,
        elementId: '__page__', // Synthetic element ID for navigation
        operation: TransitionOperation.NAVIGATE,
        timestamp: new Date(navEvent.timestamp).getTime() || Date.now(),
        relevance: RelevanceLevel.DELIBERATE,
        stateBefore: emptyElementState(),
        stateAfter: emptyElementState(),
        evidence: [{
          type: TransitionEvidenceType.NAVIGATION,
          description: `Navigated to ${navEvent.url}`,
          before: null,
          after: navEvent.url,
        }],
      });
      transitions.push(transition);
      continue;
    }

    const elementEvent = event as ElementRecordedEvent;
    const identity = elementEvent.target;
    const elementId = getElementId(identity);

    // Create or skip UiElement (deduplicated by elementId)
    if (!elementMap.has(elementId)) {
      const url = sourceUrl ?? buildSourceUrl(elementEvent);
      const domAttributes = elementEvent.domContext?.domAttributes ?? {};
      const uiElement = createUiElement({
        elementId,
        identity,
        domAttributes,
        sourceUrl: url,
        domTreePath: buildDomTreePath(identity),
      });
      elementMap.set(elementId, uiElement);
    }

    // Create ObservedTransition
    const operation = resolveOperation(elementEvent, interactionByEventId);
    const relevance = resolveRelevance(elementEvent, interactionByEventId);

    // Skip pure noise transitions (scroll, focus, blur without classification)
    if (relevance === RelevanceLevel.NOISE) continue;

    const stateBefore = buildElementState(
      elementEvent.valueBefore,
      elementEvent.checkedBefore,
      elementEvent.domContext,
    );
    const stateAfter = buildElementState(
      elementEvent.valueAfter,
      elementEvent.checkedAfter,
    );
    const evidence = buildEvidence(elementEvent);

    const transition = createObservedTransition({
      transitionId: elementEvent.eventId,
      elementId,
      operation,
      timestamp: new Date(elementEvent.timestamp).getTime() || Date.now(),
      relevance,
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
