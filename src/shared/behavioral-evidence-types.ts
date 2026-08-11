/**
 * Behavioral Evidence Model — Type Definitions
 *
 * All types for the dual-scope Behavioral Evidence Model (spec v3.0).
 * This file defines the data structures only — no logic, no capture.
 *
 * Two independent evidence scopes:
 *   - TargetEvidence: what happened to the interacted element
 *   - ApplicationEvidence: what happened across the application
 *
 * INV-BEHAV-1: This structure contains raw evidence only.
 *   No semantic classification, no causal attribution,
 *   no confidence scores, no "what happened" summaries.
 *
 * INV-BEHAV-2: targetEvidence and applicationEvidence are independent.
 *   Neither is derived from or dependent on the other.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3
 */

import type { ElementIdentity } from './types';

// ── Top-Level Envelope ──────────────────────────────────────────────────

/**
 * Complete behavioral evidence for one user interaction.
 * Contains two independent scopes. Neither scope references the other.
 */
export interface BehavioralEvidence {
  /** Event that triggered this evidence collection. */
  sourceEventId: string;

  /** Event type from EventTap. */
  sourceEventType: string;

  /** Unique evidence window ID: `bev-{eventId}`. */
  windowId: string;

  /** Frame identifier — 'main' for top frame, URL for iframes. */
  frameId: string;

  /** Window metadata — how/when the observation opened and closed. */
  window: EvidenceWindow;

  /** What happened to the interacted element. */
  targetEvidence: TargetEvidence;

  /** What happened across the application. */
  applicationEvidence: ApplicationEvidence;
}

// ── Evidence Window ─────────────────────────────────────────────────────

/**
 * Metadata about the observation window itself.
 * Raw timing only — no interpretation of window quality.
 */
export interface EvidenceWindow {
  /** performance.now() when the window opened (event dispatch time). */
  openedAt: number;

  /** performance.now() when the window closed. */
  closedAt: number;

  /** Duration in milliseconds (closedAt - openedAt). */
  durationMs: number;

  /**
   * Why the window closed. Raw fact, not interpretation.
   *
   * 'stabilized'         — DOM was quiescent for minQuiescence ms.
   * 'max-duration'       — hit the 10s hard cap.
   * 'element-removed'    — target element left the DOM.
   * 'recording-stopped'  — recording ended, window force-closed.
   * 'navigation'         — SPA or full-page navigation detected.
   * 'typing-complete'    — input quiescence timer expired (typing sessions).
   * 'displaced'          — displaced by max-concurrent-windows limit.
   */
  endReason:
    | 'stabilized'
    | 'max-duration'
    | 'element-removed'
    | 'recording-stopped'
    | 'navigation'
    | 'typing-complete'
    | 'displaced';

  /**
   * Stability trace — quiescence period measurements taken during the window.
   * Lets the correlation layer see the mutation rhythm, not just the final state.
   * Capped at 50 entries (circular buffer — oldest entries dropped).
   */
  stabilityTrace: StabilitySample[];
}

/**
 * A single quiescence measurement sample.
 */
export interface StabilitySample {
  /** performance.now() when this sample was taken. */
  timestamp: number;
  /** Milliseconds since the last mutation batch at this sample point. */
  msSinceLastMutation: number;
  /** Global batch counter value at this sample point. */
  globalBatchCount: number;
}

// ── Target Evidence ─────────────────────────────────────────────────────

/**
 * Evidence about the element the user interacted with.
 * Answers: "What is this element, what state was it in,
 *           and what happened to it?"
 *
 * INV-TGT-1: identity is the existing ElementIdentity from src/shared/types.ts,
 *   extracted by identity-extractor.ts at EventTap capture time.
 *
 * INV-TGT-2: The ObservedEvent already carries .target (ElementIdentity) and
 *   .valueBefore/.valueAfter. TargetEvidence ADDS the TargetStateSnapshot
 *   for properties EventTap doesn't capture.
 */
export interface TargetEvidence {
  /** Full element identity — existing 18-field ElementIdentity. */
  identity: ElementIdentity;

  /**
   * When identity was captured (relative to window.openedAt).
   * Always 0 or near-0 since identity is captured at event dispatch time.
   */
  identityCapturedAt: number;

  /** State before the interaction. null if no prior cache entry. */
  before: TargetStateSnapshot | null;

  /** State after the observation window closed. */
  after: TargetStateSnapshot | null;

  /** Where focus moved after this interaction, if detectable. */
  focusMovement: FocusMovement | null;
}

/**
 * Point-in-time snapshot of an element's observable state.
 * 9 DOM properties that MutationObserver cannot see (they are properties,
 * not attributes). Complements the existing ObservedEvent.valueBefore/valueAfter.
 */
export interface TargetStateSnapshot {
  value: string | null;
  checked: boolean | null;
  className: string;
  disabled: boolean;
  ariaExpanded: boolean | null;
  ariaChecked: boolean | null;
  ariaPressed: boolean | null;
  textContent: string | null;
  childCount: number;
  /** performance.now() when this snapshot was captured. */
  capturedAt: number;
}

/**
 * Where focus moved before/after the interaction.
 */
export interface FocusMovement {
  /** Where focus was before the interaction (from cache). */
  before: { tagName: string; ariaRole: string | null; accessibleName: string | null } | null;
  /** Where focus moved to after the interaction. */
  after: { tagName: string; ariaRole: string | null; accessibleName: string | null } | null;
  /** performance.now() when the focus change was detected. */
  detectedAt: number;
}

// ── Application Evidence ────────────────────────────────────────────────

/**
 * Evidence about what happened across the application because of
 * (or coincident with) the interaction.
 *
 * INV-APP-1: No causal claims. Mutations are tagged with timing
 *   and batch index only. The correlation layer determines causality.
 *
 * INV-APP-2: All data is summarized and capped. No raw MutationRecords.
 *   No unbounded arrays.
 *
 * INV-APP-3: When coarseMode is true, domChanges contains the first 200
 *   summaries collected (NOT zero — the earliest, most-relevant evidence
 *   is preserved). domChangeOverflow indicates how many additional
 *   summaries were dropped.
 */
export interface ApplicationEvidence {
  /** Summarized DOM mutations, grouped and capped at 200. */
  domChanges: DomChangeSummary[];

  /**
   * Number of DomChangeSummary entries dropped because the 200 cap was hit.
   * 0 in normal operation. >0 indicates a high-churn page.
   * When >0, coarseMode is true.
   */
  domChangeOverflow: number;

  /** True if domChanges hit the 200 cap. Surfaces + navigation + network retained. */
  coarseMode: boolean;

  /** New surfaces that appeared (dialogs, menus, panels, overlays). */
  newSurfaces: SurfaceChange[];

  /** Surfaces that were removed. */
  removedSurfaces: SurfaceChange[];

  /** Elements whose visibility changed (display, visibility, opacity, hidden). */
  visibilityChanges: VisibilityChange[];

  /** SPA or full-page navigation events (from existing EventTap navigation events). */
  navigation: NavigationEvidence[];

  /** Network activity observed during the window. */
  networkActivity: NetworkActivity[];

  /** Performance condition: was the main thread congested? */
  performanceCondition: PerformanceCondition | null;
}

/**
 * A summarized group of mutations on the same target element.
 * Multiple raw MutationRecords on the same element are collapsed
 * into one DomChangeSummary.
 *
 * CAP: Max 200 summaries per evidence window. The FIRST 200 are kept;
 * additional summaries are counted in domChangeOverflow and dropped.
 */
export interface DomChangeSummary {
  types: ('attributes' | 'childList' | 'characterData')[];
  targetPath: string;
  targetTag: string;
  shadowContext: string | null;
  changedAttributes: string[];
  attributeDeltas: Record<string, { old: string | null; new: string | null }>;
  addedNodesCount: number;
  removedNodesCount: number;
  characterDataDelta: { old: string | null; new: string | null } | null;

  /**
   * Raw timing: performance.now() - window.openedAt for the FIRST
   * mutation in this group.
   */
  firstMutationAt: number;

  /** Raw timing for the LAST mutation in this group. */
  lastMutationAt: number;

  /** Total raw MutationRecords collapsed into this summary. */
  rawMutationCount: number;

  /**
   * Global batch index of the FIRST mutation in this group.
   * Shared counter across all concurrent observation windows.
   */
  firstBatchIndex: number;

  /** Global batch index of the LAST mutation in this group. */
  lastBatchIndex: number;
}

/**
 * A new or removed surface (dialog, menu, panel, overlay).
 */
export interface SurfaceChange {
  path: string;
  tagName: string;
  ariaRole: string | null;
  accessibleName: string | null;
  shadowContext: string | null;
  descendantCount: number;
  /** performance.now() - window.openedAt. */
  relativeTime: number;
  /** Global batch index (shared counter). */
  batchIndex: number;
}

/**
 * A visibility change on an element.
 */
export interface VisibilityChange {
  path: string;
  property: 'display' | 'visibility' | 'opacity' | 'hidden' | 'aria-hidden';
  oldValue: string | null;
  newValue: string | null;
  relativeTime: number;
  batchIndex: number;
}

/**
 * Navigation evidence derived from existing EventTap navigation events.
 * EventTap already patches history.pushState/replaceState and listens for
 * popstate/hashchange. The EvidenceCollector consumes these.
 */
export interface NavigationEvidence {
  type: 'pushState' | 'replaceState' | 'hashchange' | 'popstate' | 'full-reload';
  fromUrl: string;
  toUrl: string;
  relativeTime: number;
  batchIndex: number | null;
}

/**
 * Network request observed during the observation window.
 *
 * PRIMARY: captured by MAIN-world fetch/XHR monkeypatch (dynamically injected).
 * FALLBACK/PARALLEL: captured by chrome.webRequest in SW (metadata only).
 *
 * Records metadata only — no request/response bodies.
 */
export interface NetworkActivity {
  url: string;
  method: string;
  status: number | null;
  startRelativeToEvent: number;
  endRelativeToEvent: number | null;
  durationMs: number | null;
  resourceType: 'xhr' | 'fetch' | 'unknown';
  /**
   * Source of this record.
   * 'main-world' — dynamically injected MAIN-world monkeypatch (full metadata).
   * 'webrequest' — SW chrome.webRequest (url/method/status/timing).
   */
  source: 'main-world' | 'webrequest';
}

/**
 * Performance condition during the observation window.
 */
export interface PerformanceCondition {
  /** True if any MutationObserver callback batch exceeded the threshold. */
  mainThreadBlocked: boolean;
  /** True if domChanges hit the 200-entry cap. */
  highChurnMode: boolean;
  /** Longest MutationObserver callback duration in milliseconds. */
  longestBatchMs: number;
  /** Total number of mutation batches in this window. */
  totalBatches: number;
}
