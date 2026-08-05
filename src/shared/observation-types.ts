/**
 * Observation Types — M1 Behavioral Observation Data Structures
 *
 * These types define the shape of evidence captured during the 3-second
 * observation window following a user interaction (click or change event).
 *
 * Design principle: M1 captures evidence only — no semantic meaning,
 * no classification, no causation claims.
 *
 * Two complementary before-state sources:
 * - Phase A (Element State Cache): DOM properties (.value, .checked)
 * - Phase B (MutationObserver oldValue): DOM attributes, text, structure
 *
 * Architecture: `.drytis/specs/m1-complete-design.md`
 */

import type { SemanticEffect } from '../semantics/effect-types';

// ── Mutation Record ───────────────────────────────────────────────────

/**
 * Compact representation of a single DOM mutation captured during an
 * observation window. O(1) to create — reads only the properties needed,
 * no DOM traversal. Created in Phase B's DocumentObserver callback.
 *
 * One MutationRecord2 = one MutationObserver entry.
 */
export interface MutationRecord2 {
  /** Sequential record ID within the recording session. */
  id: number;
  /** Mutation type from the DOM MutationObserver. */
  type: 'attributes' | 'childList' | 'characterData';
  /** CSS selector path from document.body to the target element. */
  targetPath: string;
  /** Target element's tagName for quick deferred filtering. */
  targetTag: string;
  /** Attribute name when type='attributes', null otherwise. */
  attributeName: string | null;
  /** Previous attribute value or text content (from MutationObserver oldValue config). */
  oldValue: string | null;
  /** Current attribute value or text content (read immediately — DOM mutates). */
  newValue: string | null;
  /** Number of nodes added (type='childList'). */
  addedNodesCount: number;
  /** Number of nodes removed (type='childList'). */
  removedNodesCount: number;
  /** Timestamp relative to recording start (performance.now()). */
  timestamp: number;
  /** Which observation window(s) were active when this mutation occurred. */
  windowIds: string[];
}

// ── Element State Snapshot ────────────────────────────────────────────

/**
 * A point-in-time snapshot of an element's observable state.
 *
 * Captures DOM PROPERTIES that MutationObserver may miss:
 * - `.value` on input/select (not reflected as DOM attributes after init)
 * - `.checked` on checkbox/radio (not reflected as DOM attributes)
 *
 * Used for the TARGET element (the one the user clicked/changed) to
 * produce a before → after diff of property-level state.
 *
 * Each snapshot is an immutable object — stored inside an observation window,
 * it can never be mutated by later interactions. The ElementStateCache creates
 * a new object on each capture() call; previous objects remain unchanged.
 *
 * NOTE: For custom components where the clicked element is NOT the state
 * holder (e.g., clicking a <span> inside a custom checkbox), this snapshot
 * may honestly show no meaningful state. The meaningful before-state for
 * those cases comes from Phase B's MutationObserver oldValue on the actual
 * state-holding element's attribute change.
 */
export interface ElementStateSnapshot {
  /** Input/select value. null for non-value elements. */
  value: string | null;
  /** Checked state (checkbox/radio, aria-checked, aria-pressed). null if N/A. */
  checked: boolean | null;
  /** className attribute (empty string if absent). */
  className: string;
  /** disabled attribute or aria-disabled='true'. */
  disabled: boolean;
  /** aria-expanded attribute value. null if attribute absent. */
  ariaExpanded: boolean | null;
  /** aria-checked attribute value. null if attribute absent. */
  ariaChecked: boolean | null;
  /** aria-pressed attribute value. null if attribute absent. */
  ariaPressed: boolean | null;
  /** Direct text content, truncated to 200 chars. null if empty. */
  textContent: string | null;
  /** Number of direct child element nodes. */
  childCount: number;
  /** When this snapshot was taken (Date.now()). */
  capturedAt: number;
}

// ── Observation Window ────────────────────────────────────────────────

/**
 * Why an observation window closed.
 */
export type WindowEndReason =
  | 'completed'       // 3-second timer elapsed
  | 'element-removed' // target element gone from DOM at close time
  | 'recording-stopped'; // stopRecording called mid-window

/**
 * Internal representation of one interaction's observation window.
 * Lives in the ObservationCoordinator (Phase C) while open.
 *
 * The beforeSnapshot and finalSnapshot are immutable value copies — they are
 * independent plain objects. The ElementStateCache creates a new object on
 * each capture() call; previous objects remain unchanged even when the
 * WeakMap entry is replaced.
 */
export interface ObservationWindow {
  /** Unique window ID: `obs-{eventId}`. */
  windowId: string;
  /** The ObservedEvent.eventId that triggered this observation. */
  sourceEventId: string;
  /** Event type: 'click' or 'change'. */
  sourceEventType: string;
  /** CSS path of the target element at window open time. */
  sourceElementPath: string;
  /** performance.now() when window opened. */
  openedAt: number;
  /** performance.now() when window closed (null while open). */
  closedAt: number | null;
  /** Why the window closed (null while open). */
  endReason: WindowEndReason | null;
  /** Before-state snapshot from cache at window open. May be null on first interaction. */
  beforeSnapshot: ElementStateSnapshot | null;
  /** After-state snapshot captured at window close. */
  finalSnapshot: ElementStateSnapshot | null;
}

// ── Observation Result (delivered to service worker) ──────────────────

/**
 * The complete behavioral evidence for one interaction.
 * Serialized and sent via chrome.runtime.sendMessage in Phase D.
 *
 * This is what gets attached to ComponentInteraction.behavioralObservations.
 *
 * Evidence sources:
 * - beforeSnapshot/finalSnapshot: DOM property before/after (Phase A cache)
 * - mutations[]: DOM attribute/text/structural before/after (Phase B observer)
 *
 * Neither source alone covers every component type. Together they provide
 * complete evidence for both native controls (property-based state) and
 * custom components (attribute-based state).
 */
export interface ObservationResult {
  /** The ObservedEvent.eventId that triggered this observation. */
  sourceEventId: string;
  /** Event type: 'click' or 'change'. */
  sourceEventType: string;
  /** Window ID. */
  windowId: string;
  /** performance.now() when window opened. */
  openedAt: number;
  /** performance.now() when window closed. */
  closedAt: number;
  /** Duration in milliseconds (closedAt - openedAt). */
  durationMs: number;
  /** Why the window closed. */
  endReason: WindowEndReason;
  /** Target element state before the interaction. null if no prior cache. */
  beforeSnapshot: ElementStateSnapshot | null;
  /** Target element state after the observation window. */
  finalSnapshot: ElementStateSnapshot | null;
  /** All mutations attributed to this window (from shared buffer). */
  mutations: MutationRecord2[];
  /** Count of mutations in the mutations array. */
  mutationCount: number;
  /** Total mutations across the entire document during this window (noise context). */
  documentWideMutationTotal: number;
  /**
   * Optional diagnostic: performance condition if a high-volume mutation batch
   * occurred during this window. PURELY diagnostic — does not affect capture,
   * classification, reliability, or window behaviour.
   *
   * Type defined in document-observer.ts to avoid a circular import.
   * Import the PerformanceCondition type from there when needed.
   */
  performanceCondition?: {
    batchRecordCount: number;
    batchDurationMs: number;
    timestamp: number;
  } | null;

  /**
   * Semantic effects derived from this observation's evidence by the
   * Effect Interpreter. Attached in the service worker when this result
   * is correlated with its ComponentInteraction. Absent until interpreted.
   *
   * Populated by: interpretBehavioralObservations() in sw-bridge.ts
   */
  semanticEffects?: SemanticEffect[];
}
