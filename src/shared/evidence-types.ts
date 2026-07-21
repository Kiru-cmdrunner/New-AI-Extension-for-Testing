/**
 * Evidence pipeline type definitions for Architecture C.
 *
 * Defines the data structures that flow through the capture-first,
 * classify-second pipeline:
 *
 *   Observer → RawEvidence → Coalescer → InteractionSnapshot → Classifier → ClassifiedInteraction
 *
 * Re-exports existing types from architecture-types.ts and types.ts rather than
 * duplicating them. New interfaces are additive — they don't modify existing types.
 *
 * Architecture: .drytis/architecture-c-production.md §13
 */

import type { ElementIdentity } from './types';
import type {
  CanonicalType,
  ClassifiedInteraction,
  ClassificationEvidence,
  SessionContext,
} from './architecture-types';

// ── Re-exports (single source of truth) ───────────────────

export type {
  CanonicalType,
  ClassificationEvidence,
  ClassifiedInteraction,
  SessionContext,
};

// ── Observer → Coalescer ──────────────────────────────────

/**
 * Summary of DOM mutations observed during an interaction window.
 *
 * Produced by the Universal Interaction Observer's MutationObserver and
 * attached to RawEvidence. The coalescer accumulates these across all
 * events in a coalescing window to produce the snapshot's domMutations field.
 */
export interface MutationSummary {
  /** Child nodes added to the observed subtree. */
  childListAdded: number;
  /** Child nodes removed from the observed subtree. */
  childListRemoved: number;
  /** Attribute changes (filtered to relevant attributes only). */
  attributeChanges: number;
  /** Elements that transitioned from hidden→visible or visible→hidden. */
  visibilityChanges: number;
  /** Human-readable semantic change descriptions for debugging/evidence. */
  semanticChanges: string[];
}

/**
 * Raw browser event evidence sent from the Universal Interaction Observer
 * (content script) to the Snapshot Coalescer (service worker).
 *
 * One RawEvidence per browser event. The observer makes NO classification
 * decision — it captures and forwards everything. The coalescer groups
 * related RawEvidence into InteractionSnapshots.
 *
 * Message wrapper: { type: 'RAW_EVIDENCE', payload: RawEvidence }
 */
export interface RawEvidence {
  /** Browser event type: click, mousedown, change, focus, blur, input, mouseenter, mouseleave, keydown. */
  eventType: string;
  /** Target element identity (existing 18-field ElementIdentity). */
  identity: ElementIdentity;
  /** ISO 8601 timestamp of the browser event. */
  timestamp: string;
  /** Whether the event is trusted (user-initisted, not script-generated). Untrusted events are filtered. */
  isTrusted: boolean;
  /** Input/select value at the time of this event, if the element has a value. */
  value?: string;
  /** Checkbox/radio checked state at event time, if applicable. */
  checked?: boolean;
  /** ARIA-related state at event time (aria-checked, aria-pressed, aria-selected). */
  ariaState?: string;
  /** Mouse dwell time in milliseconds (for mouseenter→mouseleave sequences). */
  dwellTime?: number;
  /** DOM mutations observed since the last evidence in this interaction window. */
  mutations?: MutationSummary;
}

// ── Coalescer → Classifier ────────────────────────────────

/**
 * A value change computed by the coalescer from pre/post event values.
 *
 * The strongest behavioral signal for classification: knowing that a value
 * changed (and to what) reveals the interaction type even when the element
 * lacks ARIA roles.
 */
export interface ValueChange {
  /** Value before the interaction (captured at focus/mousedown). */
  before: string;
  /** Value after the interaction (captured at change/blur). */
  after: string;
  /** HTML input type or select type: 'text', 'date', 'email', 'select-one', etc. */
  inputType: string;
  /** Whether the new value matches a known date format. Computed by the coalescer. */
  isDateLike: boolean;
}

/**
 * A state change computed by the coalescer from pre/post states.
 *
 * Used for checkbox toggles, radio selections, and ARIA state transitions
 * (aria-checked, aria-pressed, aria-selected).
 */
export interface StateChange {
  /** The property that changed. */
  property: 'checked' | 'aria-checked' | 'aria-pressed' | 'aria-selected';
  /** State value before the interaction. */
  before: string;
  /** State value after the interaction. */
  after: string;
}

/**
 * A CSS class change computed by the coalescer from MutationObserver data.
 *
 * The weakest behavioral signal — but valuable for custom dropdowns and
 * segmented controls that use class toggling instead of ARIA.
 */
export interface ClassChange {
  /** Classes added during the interaction window. */
  added: string[];
  /** Classes removed during the interaction window. */
  removed: string[];
  /** Whether a selection-related class pattern appeared (selected, active, checked, current). */
  selectionPattern: boolean;
}

/**
 * DOM ancestor context for the interaction target.
 *
 * Computed by the coalescer from the element's DOM hierarchy at capture time.
 * This is richer than the current architecture's single-element snapshot because
 * it includes container context (calendar, listbox, menu, dialog).
 */
export interface AncestorContext {
  /** ARIA roles of ancestor elements, root-to-target order. */
  roles: string[];
  /** CSS classes of ancestor containers matching known patterns (calendar, dropdown, etc.). */
  containerClasses: string[];
  /** Whether any ancestor is a calendar/grid container. */
  hasCalendarAncestor: boolean;
  /** Whether any ancestor has role="listbox" or role="combobox". */
  hasListboxAncestor: boolean;
  /** Whether any ancestor has role="menu". */
  hasMenuAncestor: boolean;
  /** Whether any ancestor has role="dialog" or aria-modal="true". */
  hasDialogAncestor: boolean;
}

/**
 * Relevant ARIA attributes extracted from the element identity.
 *
 * Grouped separately from ElementIdentity so the classifier can evaluate
 * ARIA evidence in a structured way without reaching into the full identity.
 */
export interface AriaEvidence {
  role: string | null;
  ariaLabel: string | null;
  ariaHasPopup: string | null;
  ariaSelected: string | null;
  ariaChecked: string | null;
  ariaPressed: string | null;
  ariaExpanded: string | null;
}

/**
 * DOM mutation evidence accumulated by the coalescer across the coalescing window.
 */
export interface DomMutationEvidence {
  childListChanges: number;
  attributeChanges: number;
  visibilityChanges: number;
  /** Duration in ms the MutationObserver was active for this interaction. */
  observedWindow: number;
}

/**
 * The primary browser event in a coalesced interaction.
 *
 * When multiple events are grouped (e.g., mousedown + click + change),
 * the primary event determines the classification path.
 */
export interface PrimaryEvent {
  type: 'click' | 'change' | 'focus' | 'blur' | 'mouseenter' | 'mouseleave' | 'keydown' | 'navigation';
  timestamp: string;
  isTrusted: boolean;
}

/**
 * A secondary (supporting) event in a coalesced interaction.
 */
export interface SecondaryEvent {
  type: string;
  timestamp: string;
}

/**
 * The central data structure of Architecture C.
 *
 * Produced by the Snapshot Coalescer. Consumed by the Multi-Tier Semantic
 * Classifier. Contains ALL evidence the classifier needs to determine
 * the interaction type — structural, behavioral, and contextual.
 *
 * Unlike the current architecture (where classification happens at capture
 * time with only CSS selectors), the snapshot carries rich evidence gathered
 * across the full temporal window of the interaction.
 */
export interface InteractionSnapshot {
  // ── Identity ──
  /** The resolved target element identity. */
  identity: ElementIdentity;

  // ── Event Evidence ──
  /** The most semantically meaningful event in this interaction. */
  primaryEvent: PrimaryEvent;
  /** Other events coalesced into this interaction. */
  secondaryEvents: SecondaryEvent[];

  // ── Value Evidence ──
  /** Computed value change (before/after). Present when a value-bearing element changed. */
  valueChange?: ValueChange;

  // ── State Evidence ──
  /** Computed state change (checked/aria). Present when a toggleable element changed state. */
  stateChange?: StateChange;

  // ── CSS Class Evidence ──
  /** Computed class changes during the interaction window. */
  classChange?: ClassChange;

  // ── DOM Context Evidence ──
  /** Ancestor context — container types surrounding the element. */
  ancestorContext: AncestorContext;

  // ── ARIA Evidence ──
  /** Relevant ARIA attributes from the element. */
  ariaAttributes: AriaEvidence;

  // ── Behavioral Evidence ──
  /** Mouse dwell time in ms (for mouseenter→mouseleave/click sequences). */
  dwellTime?: number;
  /** Focus duration in ms (for focus→blur sequences). */
  focusDuration?: number;
  /** Key events captured (e.g., ['Enter', 'Space', 'Escape', 'Tab']). */
  keyEvents?: string[];

  // ── DOM Mutation Evidence ──
  /** Accumulated DOM mutations observed during this interaction. */
  domMutations?: DomMutationEvidence;

  // ── Temporal Context ──
  /** Canonical type of the preceding interaction, if any. */
  precedingSnapshotType?: string;
  /** ISO 8601 timestamp of the primary event. */
  timestamp: string;
}

// ── Classifier Types ──────────────────────────────────────

/**
 * Result of a single classifier rule evaluation.
 *
 * Each rule function returns this or null. The first non-null result wins.
 */
export interface ClassificationResult {
  /** The canonical type assigned by this rule. */
  canonicalType: CanonicalType;
  /** Confidence in this classification [0.05, 0.95]. */
  confidence: number;
  /** Which tier this rule belongs to. */
  tier: 1 | 2 | 3;
  /** Structured evidence trail. */
  evidence: ClassificationEvidence;
}

/**
 * Input to the multi-tier classifier.
 *
 * The snapshot is required. AI result and session context are optional —
 * the classifier produces correct results without them (graceful degradation).
 */
export interface ClassifyInput {
  /** The interaction snapshot to classify. */
  snapshot: InteractionSnapshot;
  /** AI advisory result. Null when AI is unavailable or hasn't responded yet. */
  aiResult?: AIIntentResult | null;
  /** Session context (page state, mental model). Null when not yet built. */
  sessionContext?: SessionContext | null;
}

/**
 * Output of the multi-tier classifier.
 */
export interface ClassifyOutput {
  /** The classification result. */
  classified: ClassifiedInteraction;
  /**
   * Whether Phase 2 AI refinement could change this result.
   * True when: tier < 3 AND confidence < 0.9.
   * Used by the pipeline to decide whether to request AI advisory.
   */
  aiEligible: boolean;
}

/**
 * A classified interaction, extending the existing ClassifiedInteraction
 * from architecture-types.ts with the original snapshot reference.
 *
 * The base ClassifiedInteraction in architecture-types.ts references
 * originalEvent: SessionEvent (the Timeline event). In Architecture C,
 * classification happens DURING recording, so the "original" is the
 * InteractionSnapshot that produced the event. This type adds that
 * reference without modifying the frozen base type.
 */
export interface ClassifiedInteractionC extends ClassifiedInteraction {
  /** The snapshot that was classified. */
  originalSnapshot: InteractionSnapshot;
}

// ── Classifier → AI Observer ──────────────────────────────

/**
 * A semantic subset of the InteractionSnapshot sent to the AI Observer.
 *
 * Contains NO raw selectors, XPath, or DOM plumbing. Only semantic and
 * behavioral information that an LLM can reason about to understand
 * the user's intent.
 *
 * This enforces AI Philosophy P1 (Observation First) and P8 (Provider
 * Independence) structurally: the AI sees semantics, not mechanics.
 */
export interface SnapshotForAI {
  // ── Element Semantics (NOT raw selectors) ──
  tagName: string;
  accessibleName: string;
  ariaRole: string | null;
  className: string | null;

  // ── Behavioral Context ──
  primaryEvent: string;
  valueChanged: boolean;
  valueAfter: string;
  stateChanged: boolean;
  dwellTime: number | null;

  // ── Structural Context ──
  ancestorRoles: string[];
  hasCalendarContext: boolean;
  hasDropdownContext: boolean;
  hasFormContext: boolean;

  // ── Temporal Context (from Session Context) ──
  precedingType: string | null;
  currentUrl: string;
  workflowHint: string | null;
}

// ── AI Observer → Classifier ──────────────────────────────

/**
 * Advisory classification result from the AI Observer.
 *
 * Returned asynchronously (~200ms–2s). Consumed by the classifier's
 * Tier 3 rules. Advisory only — cannot override deterministic evidence
 * (AP4: Evidence Sovereignty).
 *
 * Differs from AIUnderstanding (in types.ts) in that it includes
 * suggestedType for classification purposes. AIUnderstanding is the
 * enrichment stored on the Timeline event; AIIntentResult is the
 * advisory signal to the classifier.
 */
export interface AIIntentResult {
  /** AI's suggested canonical type for this interaction. */
  suggestedType: CanonicalType;
  /** Human-readable business name for the element (e.g., "Departure Date Picker"). */
  businessName: string;
  /** Description of what the user is trying to do. */
  userIntent: string;
  /** Confidence in the suggestion [0.05, 0.95] (P5: never absolute). */
  confidence: number;
}

// ── Coalescer Configuration ───────────────────────────────

/**
 * Configurable thresholds for the snapshot coalescer and classifier.
 *
 * Centralized so they can be tuned without touching rule logic, and
 * eventually surfaced in settings.
 */
export interface CoalescingConfig {
  /** Temporal window for grouping related events on the same element (ms). */
  windowMs: number;
  /** Minimum dwell time for hover classification (ms). */
  dwellThresholdMs: number;
  /** Debounce for focus events before treating as text entry (ms). */
  focusDebounceMs: number;
  /** Minimum AI confidence to apply advisory classification. */
  aiConfidenceThreshold: number;
}
