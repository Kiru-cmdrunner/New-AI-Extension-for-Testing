/**
 * Evidence Collector — End-to-End Evidence Orchestration (M4)
 *
 * The central orchestrator that ties together:
 *   - TargetStateCache (M2): element before/after state snapshots
 *   - DOMObserver (M3): summarized DOM mutations with batch indices
 *   - AdaptiveWindow (M3): setTimeout-based stabilization timer
 *   - EventTap hooks (M1): onAfterEvent for window triggers
 *
 * For each meaningful user interaction, the EvidenceCollector:
 *   1. Opens an evidence window (peek before-state, start DOMObserver, arm AdaptiveWindow)
 *   2. Collects mutations while the window is open
 *   3. On close (stabilized / max-duration / typing-complete / displaced):
 *      - Captures after-state
 *      - Summarizes mutations with 200-cap
 *      - Builds BehavioralEvidence (TargetEvidence + ApplicationEvidence)
 *      - Delivers to service worker via BEHAVIORAL_EVIDENCE message
 *
 * Design principles:
 *   - P1: Capture don't interpret — no causal claims about what caused mutations
 *   - P3: Composition over special observers — uses M2 + M3 components
 *   - P4: Raw timing — relativeTime + batchIndex only, no pre-classified labels
 *   - P6: Deferred causality — TargetEvidence and ApplicationEvidence are separate
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §4.1-4.7
 */

import type {
  BehavioralEvidence,
  EvidenceWindow,
  TargetEvidence,
  TargetStateSnapshot,
  FocusMovement,
  ApplicationEvidence,
  DomChangeSummary as _DomChangeSummary,
  SurfaceChange as _SurfaceChange,
  VisibilityChange as _VisibilityChange,
  NavigationEvidence,
  PerformanceCondition as _PerformanceCondition,
} from '../shared/behavioral-evidence-types';
import type { ElementIdentity } from '../shared/types';
import type { ObservedEvent } from '../shared/component-types';
import { TargetStateCache } from './target-state-cache';
import { DOMObserver } from './dom-observer';
import { AdaptiveWindow } from './adaptive-window';
import type { NetworkActivity } from '../shared/behavioral-evidence-types';
import type { NetworkBridge } from './network-bridge';
import type { PostNavCaptureRecord } from '../shared/post-nav-types';
import { captureValue, extractIdentity } from './identity-extractor';
import type { WirePageContentSnapshot } from '../shared/page-content-wire';
import { PageContentObserver } from '../understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../understanding/page-content/page-content-config';
import { BrowserPageContentAdapter, toWireSnapshot } from './page-content-dom-adapter';

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Safely capture a value from an element, returning null instead of undefined.
 */
function captureValueSafe(el: Element): string | null {
  try {
    const val = captureValue(el);
    if (val !== undefined && val !== null && val.trim().length > 0) {
      return val.trim().slice(0, 200);
    }
    // Fall back to textContent for non-form elements
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLTextAreaElement)) {
      const text = (el as HTMLElement).textContent?.trim();
      if (text && text.length > 0 && text.length <= 200) return text;
    }
  } catch {
    // Element may have been removed from DOM
  }
  return null;
}

// ── Constants ────────────────────────────────────────────────────────

/** Maximum concurrent observation windows. */
const MAX_CONCURRENT_WINDOWS = 5;

/** Minimum interval between scroll-triggered windows. */
const MIN_SCROLL_INTERVAL_MS = 500;

/** Maximum DomChangeSummary entries per evidence window. */
const MAX_DOM_CHANGES = 200;

/** SessionStorage key for evidence buffer (SW restart recovery). */
const EVIDENCE_BUFFER_KEY = 'cmdrunner_evidence_buffer';
const MAX_EVIDENCE_BUFFER = 50;

/**
 * Post-navigation window bounds (NAV pull model).
 * POST_NAV_MAX_DURATION_MS is passed to AdaptiveWindow as maxDuration — a
 * hard cap independent of mutation churn (spec AC2). POST_NAV_BODY_WAIT_MS
 * bounds how long the collector waits for document.body after a
 * document_start injection before giving up (placeholder stands).
 */
const POST_NAV_MAX_DURATION_MS = 3000;
const POST_NAV_BODY_WAIT_MS = 10_000;

/** Event types that open evidence windows. */
const WINDOW_OPEN_EVENTS = new Set([
  'click', 'contextmenu', 'change', 'keydown',
]);

/**
 * Event types whose windows are ALWAYS finalized at pagehide (INV-4):
 * user-action windows carry the causal anchor (sourceEventId + identity)
 * for stamp-joined network recovery — age is never a criterion.
 */
export const ACTION_WINDOW_EVENT_TYPES = new Set([
  'click', 'contextmenu', 'change', 'keydown', 'submit',
]);

/**
 * Pagehide finalization decision — pure, content+type based (no clocks).
 *
 * OLD rule (removed): only lifecycle-bound windows or windows open >500ms.
 * That silently abandoned fast form-submit clicks (<500ms, LIFECYCLE_BOUND
 * still in flight), destroying the causal anchor the CER-2 stamp needs.
 *
 * NEW rule: ALL open action windows finalize. Non-action windows finalize
 * only when they carry signal (navEvents). Everything else drops.
 */
export function finalizeAtPagehide(
  win: {
    isClosed: boolean;
    isLifecycleBound: boolean;
    sourceEventType: string;
    navEvents: unknown[];
  },
  _now: number,
): { finalize: boolean; endReason: 'page-reload' | null } {
  if (win.isClosed) return { finalize: false, endReason: null };
  if (win.isLifecycleBound) return { finalize: true, endReason: 'page-reload' };
  if (ACTION_WINDOW_EVENT_TYPES.has(win.sourceEventType)) {
    return { finalize: true, endReason: 'page-reload' };
  }
  if (win.navEvents.length > 0) return { finalize: true, endReason: 'page-reload' };
  return { finalize: false, endReason: null };
}

/** Event types that use extend-on-input typing model. */
const TYPING_EVENTS = new Set(['input']);

/** Event types that are throttled. */
const THROTTLED_EVENTS = new Set(['scroll']);

/**
 * Event types that are capture-only (no evidence window).
 *
 * Fix Round 5: focus, blur, mousedown moved here from WINDOW_OPEN_EVENTS.
 * These events produce no behavioral state changes on their own — they
 * only pre-populate the TargetStateCache. Allowing them to open evidence
 * windows caused empty-diff evidence to be delivered and attached first,
 * blocking the richer input/change evidence that has the real value diffs.
 *
 * - focus/blur: the TextEntry component triggers on focus, so the focus
 *   eventId becomes triggerEvent.eventId. If focus opens a window, its
 *   empty evidence gets attached first and blocks the input evidence.
 * - mousedown: click covers the behavioral moment for buttons/checkboxes.
 *   mousedown fires before the click and produces no state change.
 */
const CAPTURE_ONLY_EVENTS = new Set([
  'mouseenter', 'mouseleave', 'mousemove',
  'focus', 'blur', 'mousedown',
]);

// ── Types ────────────────────────────────────────────────────────────

/**
 * Internal state for a single observation window.
 */
interface ObservationWindowState {
  windowId: string;
  sourceEventId: string;
  sourceEventType: string;
  targetEl: Element;
  identity: ElementIdentity | null;
  beforeSnapshot: TargetStateSnapshot | null;
  openedAt: number;
  adaptiveWindow: AdaptiveWindow;
  navEvents: NavigationEvidence[];
  isClosed: boolean;
  /** Whether this is a navigation-triggered window. */
  isNavigationWindow: boolean;
  /**
   * Fix Pair 2+4 (INV-C2): whether this is the dedicated post-navigation
   * capture window (openPostNavWindow). Such a window is finalized ONLY by
   * its own AdaptiveWindow (stabilization / 3s hard cap), pagehide, or
   * recording stop — never by generic FINALIZE_EVIDENCE matching and never
   * held open by handleLifecycleBound.
   */
  isPostNavWindow: boolean;
  /** In-flight network requests at window close time (for bounded re-check). */
  inflightNetworkUrls: Set<string>;
  /**
   * P1-3 fix: Store the ObservedEvent for valueBefore/valueAfter fallback.
   * Null for events where no ObservedEvent was passed (e.g., typing windows
   * that extend from a prior input event).
   */
  observedEvent: ObservedEvent | null;
  /** Lifecycle-Driven Evidence: lifecycle ID bound to this window, if any. */
  lifecycleId: string | null;
  /** Lifecycle-Driven Evidence: whether this window is held open by a lifecycle. */
  isLifecycleBound: boolean;
  /**
   * Consequence-settling (.drytis/specs/consequence-settling.md §5):
   * set when FINALIZE_EVIDENCE (non-unloading) arrives — the window has
   * entered settle mode: holdOpen released, canClose gate installed, cap
   * re-armed from OPEN. The window self-closes via quiescence+idle or the
   * 10s cap; the closeWindow settle branch then delivers once.
   */
  settleMode: boolean;
  /** Metadata captured at finalize for the settle-close enrichment. */
  settleMetadata: Record<string, unknown> | null;
  /**
   * CER-3: requestIds known to the NetworkBridge when this window OPENED.
   * At close, requestIdsStartedDuring(atOpen, atClose) yields the exact set
   * of requests that started during the window — the deterministic
   * window↔network join (no timestamp overlap required).
   */
  requestIdsAtOpen: Set<string> | null;

  /**
   * Resulting Application State (Phase 1): resulting-state snapshot scanned
   * for this window (set once, after consequence settlement). Undefined
   * means no scan ran (unload path, no observer, failure, or nothing
   * semantic found) — the evidence field stays ABSENT in that case.
   */
  resultingState?: WirePageContentSnapshot;

  /**
   * Resulting Application State (Phase 1): at-most-once scan guard.
   */
  resultingStateScanned?: boolean;
}

// ── EvidenceCollector ────────────────────────────────────────────────

/**
 * Orchestrates evidence capture for user interactions.
 *
 * Lifecycle:
 *   const collector = new EvidenceCollector({ targetStateCache, domObserver });
 *   collector.start();  // begin recording
 *   // EventTap calls collector.onAfterEvent(el, eventId, eventType, cssSelector)
 *   // for every trusted event
 *   collector.stop();   // stop, flush all open windows
 */
export class EvidenceCollector {
  private targetStateCache: TargetStateCache;
  private domObserver: DOMObserver;
  private activeWindows: ObservationWindowState[] = [];
  private isRunning = false;

  /** Typing extension tracking. */
  private activeTypingTarget: Element | null = null;
  private activeTypingWindow: ObservationWindowState | null = null;

  /** Scroll throttle tracking. */
  private lastScrollWindowTime = -Infinity;

  /** DOMObserver batch callback registration. */
  private domObserverRefcount = 0;

  /** Last known URL for navigation fromUrl tracking (GAP-4). */
  private lastKnownUrl: string = '';

  /**
   * NAV pull model: navEventIds for which a post-navigation window was
   * already requested in this document (exactly-once guard, spec AC3).
   * Entries are `opened:<id>` once the window actually opened.
   */
  private postNavOpenedFor = new Set<string>();

  /** Network bridge for collecting network activity (M6). */
  private networkBridge: NetworkBridge | null = null;

  /**
   * Resulting Application State (Phase 1): bounded semantic scanner. Built
   * lazily in start() when a live document exists; injectable via the ctor
   * optional for tests (undefined → no scan → today's exact behavior).
   * Stateless (no listeners) — safe to construct once and reuse.
   */
  private pageContentObserver?: PageContentObserver;

  // ── Lifecycle-Driven Evidence state ────────────────────────────────

  /** Active lifecycle bindings: lifecycleId → binding info. */
  private lifecycleBindings = new Map<string, {
    triggerEventId: string;
    interactionType: string;
  }>();

  /** Companion event suppression: prevents orphan evidence windows. */
  private companionSuppressUntil = 0;

  /** Whether the page is unloading (pagehide fired). */
  private isUnloading = false;

  constructor(config: {
    targetStateCache: TargetStateCache;
    domObserver: DOMObserver;
    networkBridge?: NetworkBridge | null;
    pageContentObserver?: PageContentObserver;
  }) {
    this.targetStateCache = config.targetStateCache;
    this.domObserver = config.domObserver;
    this.networkBridge = config.networkBridge ?? null;
    this.pageContentObserver = config.pageContentObserver;
  }

  /**
   * Start evidence collection. Does NOT start DOMObserver here —
   * it starts when the first window opens (refcounted).
   */
  start(): void {
    this.isRunning = true;
    this.activeWindows = [];
    this.activeTypingTarget = null;
    this.activeTypingWindow = null;
    this.lastScrollWindowTime = -Infinity;
    this.lastKnownUrl = typeof location !== 'undefined' ? location.href : '';
    // Resulting Application State (Phase 1): build the scanner lazily here —
    // never in the ctor — so pure-unit collectors without a live document
    // keep today's no-scan behavior. Stateless; reused across sessions.
    if (!this.pageContentObserver && typeof document !== 'undefined') {
      try {
        this.pageContentObserver = new PageContentObserver(
          createDefaultPageContentConfig(),
          new BrowserPageContentAdapter(document),
        );
      } catch {
        this.pageContentObserver = undefined;
      }
    }
  }

  /**
   * Stop evidence collection. Force-close all open windows.
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Force-close all active windows
    for (const win of [...this.activeWindows]) {
      if (!win.isClosed) {
        win.adaptiveWindow.close('recording-stopped');
      }
    }
    this.activeWindows = [];
    this.activeTypingTarget = null;
    this.activeTypingWindow = null;

    // Release DOMObserver refcount
    while (this.domObserverRefcount > 0) {
      this.domObserver.stop();
      this.domObserverRefcount--;
    }
  }

  /**
   * Entry point — called by EventTap's onAfterEvent for every trusted event.
   *
   * Implements the event-trigger matrix (§4.1):
   *   - Window-open events: open a new evidence window
   *   - Typing events (input): extend existing typing window or open new
   *   - Throttled events (scroll): max 1 window per 500ms
   *   - Capture-only events: ignored
   *
   * GAP-1 fix: now receives the full ElementIdentity extracted by EventTap.
   * GAP-4 fix: for navigation, receives the full ObservedEvent with navType + pageUrl.
   * GAP-7 fix: keydown filtering is done in EventTap (only Enter gets through).
   */
  onAfterEvent(
    targetEl: Element,
    eventId: string,
    eventType: string,
    _cssSelector: string,
    identity?: ElementIdentity | null,
    observedEvent?: ObservedEvent,
  ): void {
    if (!this.isRunning) return;

    // Lifecycle-Driven Evidence: Companion event suppression.
    // After a lifecycle finalizes, the companion click (e.g., click after
    // mousedown completion) should not create an orphan evidence window.
    // We suppress window creation for WINDOW_OPEN events within 300ms of
    // the last finalization.
    if (
      this.companionSuppressUntil > 0 &&
      Date.now() < this.companionSuppressUntil &&
      WINDOW_OPEN_EVENTS.has(eventType)
    ) {
      return;
    }

    // Capture-only events — no evidence window
    if (CAPTURE_ONLY_EVENTS.has(eventType)) return;

    // Navigation events — GAP-4 fix: open their own evidence window
    // (was: recordNavigationEvent which only attached to active windows)
    if (eventType === 'navigation') {
      this.handleNavigationEvent(targetEl, eventId, identity ?? null, observedEvent);
      return;
    }

    // Typing events — extend-on-input model (§4.6)
    if (TYPING_EVENTS.has(eventType)) {
      this.handleTypingEvent(targetEl, eventId, identity ?? null, observedEvent ?? null);
      return;
    }

    // Throttled events — scroll (§4.7)
    if (THROTTLED_EVENTS.has(eventType)) {
      this.handleScrollEvent(targetEl, eventId, identity ?? null, observedEvent ?? null);
      return;
    }

    // Standard window-open events (click, mousedown, contextmenu, change, focus, blur, keydown-Enter, submit)
    // GAP-7: EventTap now only calls onAfterEvent for Enter keydown — all keydown
    // events reaching here are Enter.
    if (WINDOW_OPEN_EVENTS.has(eventType) || eventType === 'submit') {
      this.openWindow(targetEl, eventId, eventType, identity ?? null, observedEvent ?? null);
    }
  }

  // ── Window Lifecycle ───────────────────────────────────────────────

  /**
   * Open a new observation window for a user interaction.
   * GAP-1 fix: now receives and stores the full ElementIdentity.
   * P1-3 fix: now receives and stores the ObservedEvent for fallback.
   */
  private openWindow(
    targetEl: Element,
    eventId: string,
    eventType: string,
    identity: ElementIdentity | null = null,
    observedEvent: ObservedEvent | null = null,
    maxDurationMs?: number,
  ): void {
    // Enforce max concurrent windows with displacement
    this.enforceMaxConcurrent();

    // Start DOMObserver if this is the first window
    if (this.domObserverRefcount === 0) {
      this.domObserver.start();
    }
    this.domObserverRefcount++;
    // Fix Pair 2 (INV-C1): the shared accumulation clears only at a TRUE
    // boundary — when the window being opened is the only live window.
    // A second window opening while another is still open (Amazon's native
    // form 'submit' firing ~40-80ms after the add-to-cart 'click') must NOT
    // wipe the churn the first window accumulated and will drain at its
    // 150ms lifecycle finalize. Attribution/lifecycle semantics are
    // unchanged: overlapping windows simply share the accumulated
    // DOM/surface/visibility summaries (bounded by the caps + Tier-1
    // exact-id attach + richness replace upstream).
    const otherLiveWindows = this.activeWindows.some((w) => !w.isClosed);
    if (!otherLiveWindows) {
      this.domObserver.clearAccumulated();
    }

    // Peek TargetStateCache for before snapshot
    // Fix Round 6: For typing (input) windows, the cache might not have a
    // pre-populated snapshot (e.g., autofill, paste, programmatic input).
    // Use peek() first (from capture-phase mousedown/keydown listeners),
    // then fall back to a fresh capture if peek returns undefined.
    let beforeSnapshot: TargetStateSnapshot | null;
    const cachedSnapshot = this.targetStateCache.peek(targetEl) ?? null;
    if (cachedSnapshot !== null) {
      beforeSnapshot = cachedSnapshot;
    } else if (eventType === 'input') {
      // No cache entry — capture fresh. For input events, the value at this
      // point includes the first typed character. Store it and let the
      // enrichment logic in closeWindow handle the before value.
      beforeSnapshot = this.targetStateCache.capture(targetEl);
    } else {
      beforeSnapshot = null;
    }

    const windowId = `ev-${eventId}`;
    const openedAt = performance.now();

    // CER-3: snapshot the requestIds the bridge already knows about, so the
    // window↔network join at close is membership-based, not timestamp-based.
    const requestIdsAtOpen = this.networkBridge
      ? this.networkBridge.snapshotRequestIds()
      : null;

    // Create AdaptiveWindow
    const adaptiveWindow = new AdaptiveWindow({
      onClose: (evidenceWindow) => {
        this.closeWindow(windowId, evidenceWindow);
      },
      ...(maxDurationMs !== undefined ? { maxDuration: maxDurationMs } : {}),
    });

    const state: ObservationWindowState = {
      windowId,
      sourceEventId: eventId,
      sourceEventType: eventType,
      targetEl,
      identity, // GAP-1 fix: store identity from EventTap (was always null)
      beforeSnapshot,
      openedAt,
      adaptiveWindow,
      navEvents: [],
      isClosed: false,
      isNavigationWindow: false,
      isPostNavWindow: false,
      inflightNetworkUrls: new Set(),
      observedEvent, // P1-3 fix: store ObservedEvent for valueBefore/valueAfter fallback
      lifecycleId: null,
      isLifecycleBound: false,
      settleMode: false,
      settleMetadata: null,
      requestIdsAtOpen,
    };

    // Lifecycle-Driven Evidence: if any lifecycle bindings exist, hold this
    // window open. It will be matched at finalization time by event ID.
    if (this.lifecycleBindings.size > 0) {
      state.isLifecycleBound = true;
      adaptiveWindow.setHoldOpen(true);
    }

    this.activeWindows.push(state);

    // Arm the adaptive window (starts stabilization timer)
    adaptiveWindow.arm();

    // Register batch callback to feed mutations to the adaptive window
    this.domObserver.start((batchIndex) => {
      if (!state.isClosed) {
        adaptiveWindow.recordMutation(batchIndex);
      }
    });
  }

  /**
   * Open a post-navigation evidence window (NAV pull model).
   *
   * Called by the recorder entry after auto-resume on the DESTINATION page
   * of a full-page navigation, with the SW-provided capture record. The
   * window is attributed to the navEventId (the synthetic navigation
   * interaction's triggerEvent.eventId), so delivered evidence attaches to
   * the Navigation interaction — never to the preceding click/typing
   * interaction.
   *
   * Differences from openWindow:
   *  - Waits for document.body (DOMObserver can only observe a live body;
   *    at document_start it is still null).
   *  - Exactly-once per document for a given navEventId (duplicate pulls or
   *    duplicate calls are no-ops).
   *  - Bounded hard cap POST_NAV_MAX_DURATION_MS regardless of churn —
   *    lifecycle bindings must NOT hold this window open (its lifecycle is
   *    the navigation itself, already committed).
   *  - Seeds the navigation entry from the SW record so the delivered
   *    evidence re-includes it (the richness-replacement path does not
   *    carry the placeholder's navigation array over).
   */
  openPostNavWindow(record: PostNavCaptureRecord): void {
    if (!this.isRunning) return;
    if (this.postNavOpenedFor.has(record.navEventId)) return;
    this.postNavOpenedFor.add(record.navEventId);

    const open = (): void => {
      // Re-check running: the await may have raced a STOP.
      if (!this.isRunning || document.body === null) return;
      if (this.postNavOpenedFor.has(`opened:${record.navEventId}`)) return;
      this.postNavOpenedFor.add(`opened:${record.navEventId}`);

      const targetEl = document.body;
      // Navigation identity — enriched like emitSpaNavigation's, so the
      // delivered evidence carries a meaningful identity for the document.
      const navIdentity: ElementIdentity = {
        ...extractIdentity(targetEl),
        accessibleName: record.toUrl,
        ariaLabel: `Navigation to ${record.toUrl}`,
        href: record.toUrl,
        ariaRole: extractIdentity(targetEl).ariaRole ?? 'document',
      };
      const navEntry: NavigationEvidence = {
        type: record.navType as NavigationEvidence['type'],
        fromUrl: record.fromUrl,
        toUrl: record.toUrl,
        relativeTime: performance.now(),
        batchIndex: this.domObserver.getBatchCounter(),
      };

      this.openWindow(targetEl, record.navEventId, 'navigation', navIdentity, null, POST_NAV_MAX_DURATION_MS);
      const navWin = this.activeWindows[this.activeWindows.length - 1];
      if (navWin && !navWin.isClosed) {
        navWin.isNavigationWindow = true;
        navWin.isPostNavWindow = true; // Fix Pair 4 (INV-C2)
        // The post-nav window's lifecycle is the navigation itself (already
        // committed) — it must never be held open by lifecycle bindings, or
        // the hard cap would be disabled (spec AC2).
        navWin.isLifecycleBound = false;
        navWin.adaptiveWindow.setHoldOpen(false);
        navWin.navEvents.push(navEntry);
      }
    };

    if (document.body !== null) {
      open();
      return;
    }

    // Body not yet parsed — wait for it (DOMContentLoaded at the latest).
    const startedAt = performance.now();
    const tryOpen = (): void => {
      if (document.body !== null) {
        open();
        return;
      }
      if (performance.now() - startedAt > POST_NAV_BODY_WAIT_MS) return; // give up silently — placeholder stands
      setTimeout(tryOpen, 50);
    };
    setTimeout(tryOpen, 50);
  }

  /**
   * Close an observation window and build the BehavioralEvidence.
   */
  private closeWindow(windowId: string, evidenceWindow: EvidenceWindow): void {
    const state = this.activeWindows.find((w) => w.windowId === windowId);
    if (!state || state.isClosed) return;

    state.isClosed = true;
    state.adaptiveWindow = evidenceWindow as unknown as AdaptiveWindow; // store the evidence window data

    // Consequence-settling (§5): a window closing while in settle mode
    // delivers ONCE through this branch — remapping 'stabilized' to
    // 'consequence-settled', scheduling the G3 re-collect, and building
    // evidence with the metadata captured at finalize. Cap closes keep
    // their raw endReason. No other delivery path runs for this window
    // (executeFinalization is never invoked for settle-mode windows).
    if (state.settleMode) {
      const reason =
        evidenceWindow.endReason === 'stabilized'
          ? 'consequence-settled'
          : evidenceWindow.endReason;
      // G3 kept verbatim from the executeFinalization path — schedule
      // BEFORE cleanup so late-completing causal requests still surface.
      this.scheduleLateNetworkReCollect(state);
      let afterSnapshot: TargetStateSnapshot | null = null;
      try {
        afterSnapshot = this.targetStateCache.capture(state.targetEl);
      } catch {
        // Element may have been removed from DOM
      }
      const metadata = state.settleMetadata ?? {};
      if (afterSnapshot) {
        afterSnapshot = this.enrichFromMetadata(afterSnapshot, metadata);
      }
      // Resulting Application State (Phase 1) — Hook A: scan the settled DOM
      // once, inside the single-delivery settle branch, BEFORE evidence is
      // assembled. Event-driven (fires at window close, not on any timer).
      this.captureResultingState(state);
      this.buildAndDeliverEvidence(state, afterSnapshot, reason);
      return;
    }

    // Capture after snapshot
    const afterSnapshot = this.targetStateCache.capture(state.targetEl);

    // Capture focus movement
    const focusMovement = this.captureFocusMovement();

    // Collect accumulated mutations
    const allSummaries = this.domObserver.getAccumulatedSummaries();
    const surfaces = this.domObserver.getSurfaceChanges();
    const visibilityChanges = this.domObserver.getVisibilityChanges();
    const perfMetrics = this.domObserver.getPerformanceMetrics();

    // Collect network activity from the bridge (M6)
    // GAP-5 fix: check for in-flight requests and do a bounded re-check
    // for requests that started within the window but haven't completed yet.
    let networkActivity: NetworkActivity[] = [];
    if (this.networkBridge) {
      // CER-3: primary join is requestId membership — requests that STARTED
      // during this window (per the open/close snapshots). Timestamp range
      // remains only as fallback for main-world entries with no requestId.
      const atClose = this.networkBridge.snapshotRequestIds();
      const startedDuring = state.requestIdsAtOpen
        ? this.networkBridge.requestIdsStartedDuring(state.requestIdsAtOpen, atClose)
        : atClose;
      networkActivity = this.networkBridge.collectForRange(
        state.openedAt,
        performance.now(),
        startedDuring.size > 0 ? startedDuring : undefined,
      );

      // GAP-5: Check for in-flight requests that started within this window.
      // P1-4 Fix: Increased from 200ms to 1000ms. Real API calls (auth,
      // data fetch) typically take 200-800ms. The 200ms re-check was too
      // short to catch most completions.
      const inflightCount = this.networkBridge.getInFlightCount?.() ?? 0;
      if (inflightCount > 0 && !state.isNavigationWindow) {
        // Schedule a bounded re-collect for in-flight requests.
        // Max 1 re-check at +1000ms, only for requests that started in this window's range.
        setTimeout(() => {
          if (state.isClosed) {
            const lateNetwork = this.networkBridge?.collectForRange(
              state.openedAt,
              performance.now(),
            ) ?? [];
            // Only deliver if we got new completion data
            if (lateNetwork.length > networkActivity.length) {
              // Build a supplementary evidence with updated network data
              const lateEvidence: BehavioralEvidence = {
                sourceEventId: state.sourceEventId,
                sourceEventType: state.sourceEventType,
                windowId: state.windowId,
                frameId: 'main',
                window: evidenceWindow,
                targetEvidence,
                applicationEvidence: {
                  ...applicationEvidence,
                  networkActivity: lateNetwork,
                },
              };
              this.deliverEvidence(lateEvidence);
            }
          }
        }, 1000);
      }
    }

    // Apply 200-cap
    const coarseMode = allSummaries.length > MAX_DOM_CHANGES;
    const domChanges = allSummaries.slice(0, MAX_DOM_CHANGES);
    const domChangeOverflow = Math.max(0, allSummaries.length - MAX_DOM_CHANGES);

    // Split surfaces into new/removed based on 'kind' field
    const newSurfaces = surfaces.filter((s) => s.kind === 'added').slice(0, 50);
    const removedSurfaces = surfaces.filter((s) => s.kind === 'removed').slice(0, 50);

    // Build TargetEvidence
    const targetEvidence: TargetEvidence = {
      identity: state.identity as ElementIdentity,
      identityCapturedAt: state.openedAt,
      before: state.beforeSnapshot,
      after: afterSnapshot,
      focusMovement,
    };

    // P1-3 fix: Fall back to ObservedEvent valueBefore/valueAfter when
    // TargetStateSnapshot before is null or has no value but ObservedEvent has one.
    // This fills the gap when TargetStateCache wasn't pre-populated for this element.
    //
    // Fix Round 4: For typing windows (input events), valueBefore is always null
    // because EventTap only sets valueBefore for focus/click/mousedown. We now
    // also default before.value to '' (empty string) for typing events when the
    // cache-based before is missing, since a typing session starting on a fresh
    // field has an empty value. Additionally, use the latest valueAfter from
    // member events when the after snapshot's value is null.
    if (state.observedEvent) {
      const obs = state.observedEvent;

      // Enrich 'before' value if missing
      const beforeValueMissing =
        targetEvidence.before === null || targetEvidence.before?.value === null;
      if (beforeValueMissing) {
        let beforeValue: string | null = null;
        // For input events, obs.valueBefore is null, but the typing session
        // started from an empty field. Default to '' if the field is a text input.
        if (obs.valueBefore !== null) {
          beforeValue = obs.valueBefore;
        } else if (state.sourceEventType === 'input' && state.targetEl instanceof HTMLInputElement) {
          // Typing window: before value was '' (empty) before first keystroke
          beforeValue = '';
        } else if (obs.valueBefore !== null) {
          beforeValue = obs.valueBefore;
        }

        if (beforeValue !== null) {
          const beforeBase = targetEvidence.before ?? {
            value: null,
            checked: null,
            className: '',
            disabled: false,
            ariaExpanded: null,
            ariaChecked: null,
            ariaPressed: null,
            textContent: null,
            childCount: 0,
            scrollTop: null,
            scrollLeft: null,
            selectedValues: null,
            controlledValue: null,
            capturedAt: state.openedAt,
          };
          targetEvidence.before = {
            ...beforeBase,
            value: beforeValue,
          };
        }
      }

      // Enrich 'after' value if missing.
      // For typing windows: obs.valueAfter has the value from the FIRST input
      // event (e.g., 'v' when typing 'vivo'). This is better than null but not
      // the final value. The DOM-captured after should have the final value.
      // Only use obs.valueAfter as fallback when the DOM capture returned null.
      if (targetEvidence.after?.value === null && obs.valueAfter !== null) {
        targetEvidence.after = {
          ...targetEvidence.after,
          value: obs.valueAfter,
        };
      }
    }

    // Fix Round 6: Context-aware enrichment for dropdown and date picker.
    // When the evidence window targets a cell/option (click event), the
    // before/after snapshots are of that cell, not the value-holding element.
    // Enrich the evidence by looking for a related combobox/select/input
    // whose value actually changed.
    const sourceType = state.sourceEventType;
    const targetTag = state.targetEl.tagName;
    const targetRole = (state.targetEl as HTMLElement).getAttribute?.('role');
    const isOptionLike = targetRole === 'option' || targetRole === 'gridcell' ||
      targetTag === 'OPTION' ||
      (state.targetEl as HTMLElement).className?.match?.(/\b(option|gridcell|cell)\b/i);

    if (isOptionLike && sourceType === 'click') {
      // Look for a related combobox/select/input whose value changed
      const relatedValue = this.findRelatedControlValue(state.targetEl);
      if (relatedValue !== null) {
        // Enrich after.value with the related control's current value
        if (targetEvidence.after) {
          if (targetEvidence.after.value === null || targetEvidence.after.value === '') {
            targetEvidence.after = {
              ...targetEvidence.after,
              value: relatedValue,
            };
          }
        } else {
          // Create a minimal after snapshot
          targetEvidence.after = {
            value: relatedValue,
            checked: null,
            className: '',
            disabled: false,
            ariaExpanded: null,
            ariaChecked: null,
            ariaPressed: null,
            textContent: null,
            childCount: 0,
            scrollTop: null,
            scrollLeft: null,
            selectedValues: null,
            controlledValue: null,
            capturedAt: performance.now(),
          };
        }
        // Ensure before has a value to diff against
        if (!targetEvidence.before) {
          targetEvidence.before = {
            value: null,
            checked: null,
            className: '',
            disabled: false,
            ariaExpanded: null,
            ariaChecked: null,
            ariaPressed: null,
            textContent: null,
            childCount: 0,
            scrollTop: null,
            scrollLeft: null,
            selectedValues: null,
            controlledValue: null,
            capturedAt: state.openedAt,
          };
        }
      }
    }

    // Resulting Application State (Phase 1) — Hook B: destination-page scan
    // for the dedicated post-navigation window ONLY (INV-CS1: Click and
    // Navigation evidence stay strictly separate; non-post-nav windows that
    // reach this regular path do not scan — the click-side scan already ran
    // in the settle branch of THIS window or the window never settled).
    if (state.isPostNavWindow) {
      this.captureResultingState(state);
    }

    // Build ApplicationEvidence
    const applicationEvidence: ApplicationEvidence = {
      domChanges,
      domChangeOverflow,
      coarseMode,
      newSurfaces: newSurfaces.slice(0, 50),
      removedSurfaces,
      visibilityChanges: visibilityChanges.slice(0, 50),
      navigation: [...state.navEvents], // GAP-4: only nav events attributed to THIS window
      networkActivity, // M6: populated from NetworkBridge
      performanceCondition: {
        mainThreadBlocked: perfMetrics.longestBatchMs > 15,
        highChurnMode: coarseMode,
        longestBatchMs: perfMetrics.longestBatchMs,
        totalBatches: perfMetrics.totalBatches,
      },
    };

    // Resulting Application State (Phase 1): attach only when a snapshot
    // exists — ABSENT otherwise (INV-CS2: evidence with no scan is
    // byte-identical to the pre-Phase-1 shape; JSON drops undefined keys).
    if (state.resultingState) {
      applicationEvidence.resultingState = state.resultingState;
    }

    // Build BehavioralEvidence
    const evidence: BehavioralEvidence = {
      sourceEventId: state.sourceEventId,
      sourceEventType: state.sourceEventType,
      windowId: state.windowId,
      frameId: 'main', // top-level frame
      window: evidenceWindow,
      targetEvidence,
      applicationEvidence,
    };

    // Deliver to service worker
    this.deliverEvidence(evidence);

    // Clean up: remove from active windows
    this.activeWindows = this.activeWindows.filter((w) => w.windowId !== windowId);

    // Reset typing tracking if this was the typing window
    if (this.activeTypingWindow?.windowId === windowId) {
      this.activeTypingTarget = null;
      this.activeTypingWindow = null;
    }

    // Decrement DOMObserver refcount
    if (this.domObserverRefcount > 0) {
      this.domObserver.stop();
      this.domObserverRefcount--;
    }

    // Clear accumulated data for next window
    // Fix Pair 2 (INV-C1): true-boundary rule — only clear when this was the
    // last live window. Otherwise a later submit-window close would wipe the
    // shared accumulation an earlier click window still depends on.
    this.clearAccumulatedIfBoundary(windowId);
  }

  /**
   * Fix Round 6: Find the value of a related control (combobox/select/input)
   * when the evidence window targets an option/cell inside a dropdown or
   * date picker.
   *
   * Strategies:
   * 1. aria-controls on the option → resolve target element
   * 2. Walk up to find parent combobox/listbox/select element
   * 3. Look for a nearby select/input in the same container
   *
   * Returns the current value of the related control, or null if not found.
   */
  private findRelatedControlValue(optionEl: Element): string | null {
    // Strategy 1: aria-controls
    const controlsId = (optionEl as HTMLElement).getAttribute?.('aria-controls');
    if (controlsId) {
      const controlled = document.getElementById(controlsId);
      if (controlled) {
        const val = captureValueSafe(controlled);
        if (val !== null) return val;
      }
    }

    // Strategy 2: Walk up to find parent combobox/select
    const parentCombobox = (optionEl as HTMLElement).closest(
      '[role="combobox"], [role="listbox"], select, .oxd-select-text, [data-select], [class*="select-wrapper"]'
    );
    if (parentCombobox) {
      const val = captureValueSafe(parentCombobox);
      if (val !== null) return val;
      // Also check for a child input that holds the value
      const input = parentCombobox.querySelector('input, [role="textbox"]');
      if (input) {
        const inputVal = captureValueSafe(input);
        if (inputVal !== null) return inputVal;
      }
    }

    // Strategy 3: Look for sibling/nearby select or input
    const container = (optionEl as HTMLElement).closest(
      '[role="dialog"], [role="listbox"], .oxd-select-wrapper, .dropdown, [class*="select"]'
    );
    if (container) {
      // Look for the display text of the combobox (not the option itself)
      const displayEl = container.querySelector(
        '.oxd-select-text-input, .select-text, [class*="display"], [class*="selected-value"]'
      );
      if (displayEl && displayEl !== optionEl) {
        const val = captureValueSafe(displayEl);
        if (val !== null) return val;
      }
    }

    return null;
  }

  /**
   * Enforce max concurrent windows. If at capacity, displace oldest.
   */
  private enforceMaxConcurrent(): void {
    const openWindows = this.activeWindows.filter((w) => !w.isClosed);
    if (openWindows.length >= MAX_CONCURRENT_WINDOWS) {
      // Force-close the oldest open window
      const oldest = openWindows[0];
      oldest.adaptiveWindow.close('displaced');
    }
  }

  // ── Typing Strategy (§4.6) ─────────────────────────────────────────

  /**
   * Handle input events using extend-on-input model.
   * First input → open new window. Subsequent → extend (reset timer).
   * GAP-1 fix: now receives and stores identity.
   *
   * TD-8 fix: extension path now updates observedEvent so the P1-3 enrichment
   * fallback has the latest valueAfter, not just the first keystroke's.
   */
  private handleTypingEvent(targetEl: Element, eventId: string, identity: ElementIdentity | null = null, observedEvent: ObservedEvent | null = null): void {
    // If typing on the same element, extend the existing window
    if (this.activeTypingTarget === targetEl && this.activeTypingWindow && !this.activeTypingWindow.isClosed) {
      // Extend: reset stabilization timer
      this.activeTypingWindow.adaptiveWindow.recordMutation();
      // TD-8: Update observedEvent to latest input so enrichment fallback
      // sees the current value, not just the first keystroke's.
      if (observedEvent) {
        this.activeTypingWindow.observedEvent = observedEvent;
      }
      return;
    }

    // Different element or no active typing window → open new window
    this.openWindow(targetEl, eventId, 'input', identity, observedEvent);
    this.activeTypingTarget = targetEl;
    this.activeTypingWindow = this.activeWindows[this.activeWindows.length - 1] ?? null;
  }

  // ── Scroll Strategy (§4.7) ─────────────────────────────────────────

  /**
   * Handle scroll events with throttling.
   */
  private handleScrollEvent(targetEl: Element, eventId: string, identity: ElementIdentity | null = null, observedEvent: ObservedEvent | null = null): void {
    const now = performance.now();
    if (now - this.lastScrollWindowTime < MIN_SCROLL_INTERVAL_MS) {
      return; // throttled
    }
    this.lastScrollWindowTime = now;
    this.openWindow(targetEl, eventId, 'scroll', identity, observedEvent);
  }

  // ── Navigation Evidence (GAP-4) ───────────────────────────────────

  /**
   * Handle a navigation event by opening its own evidence window and
   * recording the nav metadata from the ObservedEvent.
   *
   * GAP-4 fix: navigation events now open their own window (to capture
   * post-navigation DOM mutations), and use the real navType and pageUrl
   * from EventTap instead of hardcoded values.
   */
  private handleNavigationEvent(
    targetEl: Element,
    eventId: string,
    identity: ElementIdentity | null,
    observedEvent?: ObservedEvent,
  ): void {
    // Extract real nav type and URLs from the ObservedEvent
    const navType: NavigationEvidence['type'] = this.extractNavTypeFromEvent(observedEvent);
    const fromUrl = this.extractFromUrlFromEvent(observedEvent);
    const toUrl = observedEvent?.pageUrl ?? location.href;

    // Record nav evidence for active windows (preserve old attribution behavior)
    const navEvidence: NavigationEvidence = {
      type: navType,
      fromUrl,
      toUrl,
      relativeTime: performance.now(),
      batchIndex: this.domObserver.getBatchCounter(),
    };

    // Attribute to all active non-closed windows
    for (const win of this.activeWindows) {
      if (!win.isClosed) {
        win.navEvents.push(navEvidence);
      }
    }

    // GAP-4: Also open a new window for the navigation itself.
    // This captures post-navigation DOM mutations (page content rendering).
    this.openWindow(targetEl, eventId, 'navigation', identity, observedEvent ?? null);

    // Mark the new window as a navigation window and store the nav evidence
    const navWin = this.activeWindows[this.activeWindows.length - 1];
    if (navWin && !navWin.isClosed) {
      navWin.isNavigationWindow = true;
      navWin.navEvents.push(navEvidence);
    }
  }

  /**
   * Extract navigation type from the ObservedEvent.
   * GAP-4 fix: uses the real navType from EventTap instead of hardcoded 'pushState'.
   */
  private extractNavTypeFromEvent(observedEvent?: ObservedEvent): NavigationEvidence['type'] {
    if (observedEvent?.navType) {
      return observedEvent.navType;
    }
    return 'pushState'; // fallback for legacy events without navType
  }

  /**
   * Get the previous URL from the ObservedEvent.
   * GAP-4 fix: uses the real fromUrl tracked by EventTap's lastKnownUrl.
   */
  private extractFromUrlFromEvent(observedEvent?: ObservedEvent): string {
    // EventTap doesn't store fromUrl on the event, but we can infer from
    // the pageUrl of the PREVIOUS event. For now, use a module-level tracker.
    const fromUrl = this.lastKnownUrl;
    this.lastKnownUrl = observedEvent?.pageUrl ?? location.href;
    return fromUrl;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Capture focus movement (where focus was before, where it is now).
   */
  private captureFocusMovement(): FocusMovement | null {
    const activeEl = document.activeElement;
    if (!activeEl || activeEl === document.body) return null;

    const after = {
      tagName: activeEl.tagName,
      ariaRole: activeEl.getAttribute('role'),
      accessibleName: this.getAccessibleName(activeEl),
    };

    // "Before" is unknown at this point — the TargetStateCache may have it
    // from the capture-phase focus listener. We set it to null for now;
    // the correlation layer can reconstruct from prior windows.
    return {
      before: null,
      after,
      detectedAt: performance.now(),
    };
  }

  /**
   * Get accessible name from an element (simplified).
   */
  private getAccessibleName(el: Element): string | null {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    if (el instanceof HTMLElement) {
      const text = (el.innerText || el.textContent || '').trim();
      return text ? text.slice(0, 200) : null;
    }
    return null;
  }

  /**
   * Deliver evidence to the service worker.
   * Uses chrome.runtime.sendMessage with BEHAVIORAL_EVIDENCE message type.
   * Also buffers in sessionStorage for SW restart recovery (§9).
   */
  private deliverEvidence(evidence: BehavioralEvidence): void {
    // Buffer in sessionStorage for SW restart recovery
    this.bufferEvidence(evidence);

    // Send to service worker
    if (chrome?.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(
          { type: 'BEHAVIORAL_EVIDENCE', payload: evidence },
          () => { void chrome.runtime.lastError; },
        );
      } catch {
        // SW may be dead — evidence stays in buffer
      }
    }
  }

  /**
   * Buffer evidence in sessionStorage for SW restart recovery.
   */
  private bufferEvidence(evidence: BehavioralEvidence): void {
    try {
      const raw = sessionStorage.getItem(EVIDENCE_BUFFER_KEY);
      const buffer: BehavioralEvidence[] = raw ? JSON.parse(raw) : [];
      buffer.push(evidence);
      if (buffer.length > MAX_EVIDENCE_BUFFER) {
        buffer.shift();
      }
      sessionStorage.setItem(EVIDENCE_BUFFER_KEY, JSON.stringify(buffer));
    } catch {
      // sessionStorage may be full — silent degrade
    }
  }

  /**
   * Flush buffered evidence to the service worker.
   * Called on recording start (recover from SW restart or page navigation).
   *
   * TD-3 fix: Only removes evidence that was confirmed delivered (SW responded
   * with { ok: true }). Undelivered evidence (SW cold-start, dead, or error)
   * stays in the buffer for the next flush attempt. This prevents permanent
   * evidence loss across page navigation when the SW isn't yet ready.
   */
  flushBufferedEvidence(): void {
    try {
      const raw = sessionStorage.getItem(EVIDENCE_BUFFER_KEY);
      if (!raw) return;
      const buffer: BehavioralEvidence[] = JSON.parse(raw);
      if (buffer.length === 0) {
        sessionStorage.removeItem(EVIDENCE_BUFFER_KEY);
        return;
      }

      // Track delivery status per item
      const delivered = new Array<boolean>(buffer.length).fill(false);
      let pending = buffer.length;

      const updateBuffer = () => {
        pending--;
        if (pending > 0) return; // wait for all callbacks

        // Rewrite sessionStorage with only undelivered evidence
        const remaining = buffer.filter((_, i) => !delivered[i]);
        try {
          if (remaining.length === 0) {
            sessionStorage.removeItem(EVIDENCE_BUFFER_KEY);
          } else {
            // Cap at MAX_EVIDENCE_BUFFER (drop oldest if overflow)
            const capped = remaining.slice(-MAX_EVIDENCE_BUFFER);
            sessionStorage.setItem(EVIDENCE_BUFFER_KEY, JSON.stringify(capped));
          }
        } catch {
          // sessionStorage may be full — undelivered evidence is lost
        }
      };

      for (let i = 0; i < buffer.length; i++) {
        const evidence = buffer[i];
        if (!chrome?.runtime?.sendMessage) {
          updateBuffer();
          continue;
        }
        try {
          chrome.runtime.sendMessage(
            { type: 'BEHAVIORAL_EVIDENCE', payload: evidence },
            (response) => {
              void chrome.runtime.lastError;
              // Only mark delivered if SW confirmed receipt
              if (response && response.ok === true) {
                delivered[i] = true;
              }
              updateBuffer();
            },
          );
        } catch {
          updateBuffer();
        }
      }
    } catch {
      // JSON parse failure — clear corrupt buffer
      try { sessionStorage.removeItem(EVIDENCE_BUFFER_KEY); } catch {}
    }
  }

  /**
   * Clear evidence buffer (called on stopRecording).
   */
  clearEvidenceBuffer(): void {
    try {
      sessionStorage.removeItem(EVIDENCE_BUFFER_KEY);
    } catch {
      // silent degrade
    }
  }

  // ── Lifecycle-Driven Evidence (v3.1) ───────────────────────────────

  /**
   * Handle a LIFECYCLE_BOUND message from the SW.
   * A new semantic interaction lifecycle has started. Mark any evidence
   * window opened by the trigger event as lifecycle-bound (holdOpen).
   */
  handleLifecycleBound(payload: {
    lifecycleId: string;
    triggerEventId: string;
    interactionType: string;
  }): void {
    // Store the binding
    this.lifecycleBindings.set(payload.lifecycleId, {
      triggerEventId: payload.triggerEventId,
      interactionType: payload.interactionType,
    });

    // Retroactively mark any window opened by the trigger event
    const window = this.activeWindows.find(
      (w) => !w.isClosed && w.sourceEventId === payload.triggerEventId,
    );
    if (window) {
      window.lifecycleId = payload.lifecycleId;
      // Fix Pair 4 (INV-C2): the dedicated post-navigation window must never
      // be held open by a lifecycle binding — its lifecycle IS the navigation
      // (already committed). Holding it open would disable the 3s hard cap
      // (setHoldOpen clears the max-duration timer), leaving the window open
      // until recording stop.
      if (!window.isPostNavWindow) {
        window.isLifecycleBound = true;
        window.adaptiveWindow.setHoldOpen(true);
      }
    }
  }

  /**
   * Handle a FINALIZE_EVIDENCE message from the SW.
   * A semantic interaction lifecycle has completed. Immediately finalize
   * evidence for the matching window(s). This replaces the 300ms stabilization
   * timer and 5s timeout as the primary evidence delivery mechanism.
   */
  finalizeForInteraction(payload: {
    lifecycleId: string;
    interactionId: string;
    interactionType: string;
    eventIds: string[];
    metadata: Record<string, unknown>;
    endState: string;
    triggerIdentity?: ElementIdentity;
  }): void {
    // Clear the lifecycle binding
    this.lifecycleBindings.delete(payload.lifecycleId);

    // Fix Pair 4 (INV-C2): a dedicated post-navigation window is finalized
    // ONLY by its own AdaptiveWindow (stabilization / 3s hard cap), pagehide,
    // or recording stop. The Navigation definition completes immediately on
    // trigger, so its FINALIZE_EVIDENCE arrives ~150ms into the destination
    // page's churn — matching it here cut the post-nav window off early
    // (observed: lifecycle-complete @154ms instead of the designed settle).
    // A given eventId opens at most one window (windowId is `ev-${eventId}`),
    // so "a matching window is post-nav" ⇒ the payload targets the post-nav
    // window and nothing else.
    const matchesPostNavWindow = this.activeWindows.some(
      (w) => !w.isClosed && w.isPostNavWindow && payload.eventIds.includes(w.sourceEventId),
    );
    if (matchesPostNavWindow) {
      // Early return — do NOT run finalizeWithoutWindow for this payload:
      // that path emits a synthetic 0-richness evidence whose only content
      // is nav metadata, which can never win the richness-replace attach and
      // would at best deliver nothing and at worst race the real post-nav
      // window. The synthetic-navigation placeholder (SW-side) remains the
      // fallback if the destination content script never captures evidence.
      // Companion suppression stays unset — no lifecycle finalize happened.
      return;
    }

    // Find matching windows by event ID
    const matchingWindows = this.activeWindows.filter(
      (w) => !w.isClosed && payload.eventIds.includes(w.sourceEventId),
    );

    // Determine the settle delay: 150ms normally, 0ms during page unload
    const settleDelay = this.isUnloading ? 0 : 150;

    if (matchingWindows.length > 0) {
      // Finalize the first matching window
      // (there should typically be exactly one)
      const win = matchingWindows[0];
      this.finalizeWindow(win, payload, settleDelay);

      // Close any additional matching windows without evidence
      for (let i = 1; i < matchingWindows.length; i++) {
        this.closeWindowSilently(matchingWindows[i]);
      }
    } else {
      // No matching window found — this happens when all completing events
      // were capture-only (e.g., DatePicker focus+mousedown).
      // Try to resolve the trigger element from the lifecycle bindings
      // and create evidence targeting it.
      this.finalizeWithoutWindow(payload, settleDelay);
    }

    // Set companion event suppression
    this.companionSuppressUntil = Date.now() + 300;
  }

  /**
   * Finalize a specific evidence window on lifecycle completion.
   */
  private finalizeWindow(
    win: ObservationWindowState,
    payload: {
      interactionType: string;
      metadata: Record<string, unknown>;
      endState: string;
    },
    settleDelay: number,
  ): void {
    const endReason: 'lifecycle-complete' | 'lifecycle-abandoned' =
      payload.endState === 'completed' ? 'lifecycle-complete' : 'lifecycle-abandoned';

    // If page is unloading, finalize immediately (no settle delay) — the
    // INV-4 form-submit recovery path. UNCHANGED by consequence-settling.
    if (settleDelay === 0) {
      this.executeFinalization(win, payload.metadata, endReason);
      return;
    }

    // Consequence-settling (.drytis/specs/consequence-settling.md §5):
    // the fixed 150ms settle is REPLACED by the settle-mode transition.
    // The window returns to its own AdaptiveWindow quiescence mechanism
    // (holdOpen released, canClose = causal-network-idle gate installed,
    // 10s-from-open cap re-armed). It self-closes when the application
    // consequence has settled (DOM quiescent + causal in-flight == 0) or
    // at the hard cap — whichever comes first. The settle-close branch in
    // closeWindow delivers the evidence exactly once.
    this.enterSettleMode(win, payload.metadata);
  }

  /**
   * Resulting Application State (Phase 1): scan the page's rendered content
   * once per window, at consequence settlement (settle branch) or
   * destination-page stabilization (post-nav close). Event-driven — no
   * timers. Bounded by the observer (13 selectors, ≤50 items, ≤200 chars,
   * ≤30 attributes). Every failure path degrades to "field absent":
   * observer missing → return; already scanned → return; scan throws →
   * undefined; no semantic items → observer returns null → undefined.
   */
  private captureResultingState(state: ObservationWindowState): void {
    // At-most-once per window (double-close / re-entrant delivery guard).
    if (state.resultingStateScanned) return;
    state.resultingStateScanned = true;
    if (!this.pageContentObserver || !this.isRunning) return;
    try {
      const snapshot = this.pageContentObserver.scan(null);
      if (snapshot) {
        state.resultingState = toWireSnapshot(snapshot);
      }
    } catch {
      // Scan failure must never block evidence delivery.
      state.resultingState = undefined;
    }
  }

  /**
   * Consequence-settling (§5): transition a lifecycle-finalized window
   * into settle mode. Idempotent — a second FINALIZE_EVIDENCE (duplicate
   * or racing lifecycle) is a no-op. Releasing holdOpen (a) re-enables the
   * window's own quiescence close and (b) re-arms the max-duration timer
   * with the REMAINING time measured from OPEN (never now+10s).
   */
  private enterSettleMode(
    win: ObservationWindowState,
    metadata: Record<string, unknown>,
  ): void {
    if (win.isClosed) return;
    if (win.settleMode) return; // idempotent

    win.settleMode = true;
    win.settleMetadata = { ...metadata };

    // Phase 3 Fix A: settleEntry() completes the transition — releases the
    // lifecycle hold (TD-8 cap re-arm), installs the causal close gate, and
    // re-arms the stabilization loop so quiescence is measured from settle
    // ENTRY (on an already-quiet DOM no timer was running; the window would
    // otherwise park until the 10s cap and scan a stale DOM).
    win.adaptiveWindow.settleEntry(() => this.causalNetworkIdle(win));
  }

  /**
   * Consequence-settling (§8): the causal-idle predicate.
   * causalInFlight = current in-flight (noise-excluded) − requestIdsAtOpen.
   * A request already in flight when the window OPENED is background
   * activity, not a consequence — membership is the join, no timing.
   * No bridge ⇒ pure DOM-quiescence settling (network dimension absent).
   */
  private causalNetworkIdle(win: ObservationWindowState): boolean {
    if (!this.networkBridge || typeof this.networkBridge.getInFlightRequestIds !== 'function') {
      return true;
    }
    const inFlight = this.networkBridge.getInFlightRequestIds();
    if (inFlight.size === 0) return true;
    if (!win.requestIdsAtOpen) return false;
    for (const id of inFlight) {
      if (!win.requestIdsAtOpen.has(id)) return false; // causal in-flight
    }
    return true;
  }

  /**
   * G3: schedule one bounded +1000ms network re-collect for a closing
   * window that has in-flight requests (display enrichment only).
   * Uses the SAME semantics as closeWindow's GAP-5 re-check: re-collect
   * the window range, deliver a supplement only when NEW completion data
   * arrived. Dedup upstream (requestId membership + evidence replace) keeps
   * rows exactly-once.
   */
  private scheduleLateNetworkReCollect(state: ObservationWindowState): void {
    const inflightCount = this.networkBridge?.getInFlightCount?.() ?? 0;
    if (inflightCount === 0 || state.isNavigationWindow) return;

    const openedAt = state.openedAt;
    const sourceEventId = state.sourceEventId;
    const sourceEventType = state.sourceEventType;
    const windowId = state.windowId;

    setTimeout(() => {
      // The window IS closed now — that is the point: this is a
      // post-close display supplement for late-completing requests.
      const lateNetwork =
        this.networkBridge?.collectForRange(openedAt, performance.now()) ?? [];
      if (lateNetwork.length === 0) return;

      const lateEvidence = {
        sourceEventId,
        sourceEventType,
        windowId,
        frameId: 'main' as const,
        // Synthetic display window — the ORIGINAL evidence already
        // delivered; this supplement only carries the updated network set.
        window: {
          openedAt,
          closedAt: performance.now(),
          durationMs: 1000,
          endReason: 'stabilized' as const,
          targetSelector: null,
        },
        targetEvidence: null,
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: lateNetwork,
        },
      };
      this.deliverEvidence(lateEvidence as unknown as BehavioralEvidence);
    }, 1000);
  }

  /**
   * Execute the finalization: capture after-snapshot, build evidence, deliver.
   */
  private executeFinalization(
    win: ObservationWindowState,
    metadata: Record<string, unknown>,
    endReason: 'lifecycle-complete' | 'lifecycle-abandoned' | 'page-reload',
  ): void {
    if (win.isClosed) return;
    // G3 (display-only, INV-N7): schedule the +1000ms re-collect BEFORE
    // marking the window closed — this is the ONLY path on which a
    // lifecycle-finalized window can still surface late-completing XHRs
    // for DISPLAY. Correctness never depends on it: requests started by
    // page JS after the click carry the still-active per-tab stamp and are
    // attached SW-side by the drain / boot reconcile even if this timer
    // dies with the document.
    this.scheduleLateNetworkReCollect(win);
    win.isClosed = true;

    // Close the adaptive window to stop timers
    win.adaptiveWindow.close(endReason);

    // Capture after snapshot from the target element
    let afterSnapshot: TargetStateSnapshot | null = null;
    try {
      afterSnapshot = this.targetStateCache.capture(win.targetEl);
    } catch {
      // Element may have been removed from DOM
    }

    // Enrich after-snapshot from metadata (fallback only)
    if (afterSnapshot) {
      afterSnapshot = this.enrichFromMetadata(afterSnapshot, metadata);
    }

    // Build evidence using the existing closeWindow infrastructure
    this.buildAndDeliverEvidence(win, afterSnapshot, endReason);
  }

  /**
   * Build and deliver BehavioralEvidence from a finalized window.
   * Reuses the same logic as closeWindow for consistency.
   */
  private buildAndDeliverEvidence(
    state: ObservationWindowState,
    afterSnapshot: TargetStateSnapshot | null,
    endReason: EvidenceWindow['endReason'],
  ): void {
    // Collect accumulated mutations
    const allSummaries = this.domObserver.getAccumulatedSummaries();
    const surfaces = this.domObserver.getSurfaceChanges();
    const visibilityChanges = this.domObserver.getVisibilityChanges();
    const perfMetrics = this.domObserver.getPerformanceMetrics();

    // Collect network activity
    let networkActivity: NetworkActivity[] = [];
    if (this.networkBridge) {
      // CER-3: same membership-based join as closeWindow — requests that
      // STARTED during this window, by requestId, with time-range fallback
      // for entries carrying no requestId.
      const atClose = this.networkBridge.snapshotRequestIds();
      const startedDuring = state.requestIdsAtOpen
        ? this.networkBridge.requestIdsStartedDuring(state.requestIdsAtOpen, atClose)
        : atClose;
      networkActivity = this.networkBridge.collectForRange(
        state.openedAt,
        performance.now(),
        startedDuring.size > 0 ? startedDuring : undefined,
      );
    }

    // Apply 200-cap
    const coarseMode = allSummaries.length > MAX_DOM_CHANGES;
    const domChanges = allSummaries.slice(0, MAX_DOM_CHANGES);
    const domChangeOverflow = Math.max(0, allSummaries.length - MAX_DOM_CHANGES);

    const newSurfaces = surfaces.filter((s) => s.kind === 'added').slice(0, 50);
    const removedSurfaces = surfaces.filter((s) => s.kind === 'removed').slice(0, 50);

    // Build TargetEvidence
    const targetEvidence: TargetEvidence = {
      identity: state.identity as ElementIdentity,
      identityCapturedAt: state.openedAt,
      before: state.beforeSnapshot,
      after: afterSnapshot,
      focusMovement: this.captureFocusMovement(),
    };

    // P1-3 enrichment: use observedEvent valueBefore/valueAfter as fallback
    if (state.observedEvent) {
      const obs = state.observedEvent;
      const beforeValueMissing =
        targetEvidence.before === null || targetEvidence.before?.value === null;
      if (beforeValueMissing) {
        if (obs.valueBefore !== null) {
          const beforeBase = targetEvidence.before ?? {
            value: null, checked: null, className: '', disabled: false,
            ariaExpanded: null, ariaChecked: null, ariaPressed: null,
            textContent: null, childCount: 0, scrollTop: null, scrollLeft: null,
            selectedValues: null, controlledValue: null, capturedAt: state.openedAt,
          };
          targetEvidence.before = { ...beforeBase, value: obs.valueBefore };
        } else if (state.sourceEventType === 'input' && state.targetEl instanceof HTMLInputElement) {
          const beforeBase = targetEvidence.before ?? {
            value: null, checked: null, className: '', disabled: false,
            ariaExpanded: null, ariaChecked: null, ariaPressed: null,
            textContent: null, childCount: 0, scrollTop: null, scrollLeft: null,
            selectedValues: null, controlledValue: null, capturedAt: state.openedAt,
          };
          targetEvidence.before = { ...beforeBase, value: '' };
        }
      }
    }

    // Build ApplicationEvidence
    const applicationEvidence: ApplicationEvidence = {
      domChanges,
      domChangeOverflow,
      coarseMode,
      newSurfaces,
      removedSurfaces,
      visibilityChanges: visibilityChanges.slice(0, 50),
      navigation: [...state.navEvents],
      networkActivity,
      performanceCondition: {
        mainThreadBlocked: perfMetrics.longestBatchMs > 15,
        highChurnMode: coarseMode,
        longestBatchMs: perfMetrics.longestBatchMs,
        totalBatches: perfMetrics.totalBatches,
      },
    };

    // Resulting Application State (Phase 1): attach only when a snapshot
    // exists — ABSENT otherwise (INV-CS2: evidence with no scan is
    // byte-identical to the pre-Phase-1 shape; JSON drops undefined keys).
    if (state.resultingState) {
      applicationEvidence.resultingState = state.resultingState;
    }

    // Build and deliver BehavioralEvidence
    const evidence: BehavioralEvidence = {
      sourceEventId: state.sourceEventId,
      sourceEventType: state.sourceEventType,
      windowId: state.windowId,
      frameId: 'main',
      window: {
        openedAt: state.openedAt,
        closedAt: performance.now(),
        durationMs: performance.now() - state.openedAt,
        endReason,
        stabilityTrace: [],
      },
      targetEvidence,
      applicationEvidence,
    };

    this.deliverEvidence(evidence);

    // Clean up
    this.cleanupWindow(state);
  }

  /**
   * Finalize when no evidence window was opened (capture-only trigger path).
   * Creates evidence from metadata + trigger identity (passed from the SW
   * via FINALIZE_EVIDENCE payload). This handles the DatePicker/Dropdown case
   * where focus+mousedown are capture-only and no evidence window was opened.
   */
  private finalizeWithoutWindow(
    payload: {
      eventIds: string[];
      metadata: Record<string, unknown>;
      endState: string;
      triggerIdentity?: ElementIdentity;
    },
    settleDelay: number,
  ): void {
    const endReason: 'lifecycle-complete' | 'lifecycle-abandoned' =
      payload.endState === 'completed' ? 'lifecycle-complete' : 'lifecycle-abandoned';

    const doFinalize = () => {
      // Build evidence from metadata
      const metadata = payload.metadata;
      let afterValue: string | null = null;
      if (metadata.selectedDate) afterValue = metadata.selectedDate as string;
      else if (metadata.selectedValue) afterValue = metadata.selectedValue as string;
      else if (metadata.textValue) afterValue = metadata.textValue as string;

      const afterSnapshot: TargetStateSnapshot | null = afterValue ? {
        value: afterValue,
        checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: null, ariaPressed: null,
        textContent: null, childCount: 0, scrollTop: null, scrollLeft: null,
        selectedValues: metadata.selectedValues as string[] ?? null,
        controlledValue: null, capturedAt: performance.now(),
      } : null;

      // Use the first eventId as sourceEventId for SW correlation
      const sourceEventId = payload.eventIds[0] ?? '';

      const evidence: BehavioralEvidence = {
        sourceEventId,
        sourceEventType: 'lifecycle',
        windowId: `lc-${sourceEventId}`,
        frameId: 'main',
        window: {
          openedAt: 0,
          closedAt: performance.now(),
          durationMs: 0,
          endReason,
          stabilityTrace: [],
        },
        targetEvidence: {
          identity: payload.triggerIdentity ?? null,
          identityCapturedAt: payload.triggerIdentity ? performance.now() : 0,
          before: null,
          after: afterSnapshot,
          focusMovement: null,
        },
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: [],
          performanceCondition: {
            mainThreadBlocked: false,
            highChurnMode: false,
            longestBatchMs: 0,
            totalBatches: 0,
          },
        },
      };

      this.deliverEvidence(evidence);
    };

    if (settleDelay === 0) {
      doFinalize();
    } else {
      setTimeout(doFinalize, settleDelay);
    }
  }

  /**
   * Enrich after-snapshot from interaction metadata (fallback only).
   * Only fills values when the DOM snapshot's value is null/empty.
   */
  private enrichFromMetadata(
    snapshot: TargetStateSnapshot,
    metadata: Record<string, unknown>,
  ): TargetStateSnapshot {
    const enriched = { ...snapshot };

    if (enriched.value === null || enriched.value === '') {
      if (metadata.selectedValue) {
        enriched.value = metadata.selectedValue as string;
      } else if (metadata.selectedValues) {
        enriched.selectedValues = metadata.selectedValues as string[];
      } else if (metadata.selectedDate) {
        enriched.value = metadata.selectedDate as string;
      } else if (metadata.textValue) {
        enriched.value = metadata.textValue as string;
      }
    }

    return enriched;
  }

  /**
   * Close a window silently (no evidence delivery).
   * Used when multiple windows match and only the first delivers evidence.
   */
  private closeWindowSilently(win: ObservationWindowState): void {
    if (win.isClosed) return;
    win.isClosed = true;
    win.adaptiveWindow.close('displaced');
    this.cleanupWindow(win);
  }

  /**
   * Clean up a closed window: remove from active list, decrement refcount.
   */
  private cleanupWindow(win: ObservationWindowState): void {
    this.activeWindows = this.activeWindows.filter((w) => w.windowId !== win.windowId);

    if (this.activeTypingWindow?.windowId === win.windowId) {
      this.activeTypingTarget = null;
      this.activeTypingWindow = null;
    }

    if (this.domObserverRefcount > 0) {
      this.domObserver.stop();
      this.domObserverRefcount--;
    }

    // Fix Pair 2 (INV-C1): same true-boundary rule as closeWindow — while
    // another window still lives, its accumulation must survive this close.
    this.clearAccumulatedIfBoundary(win.windowId);
  }

  /**
   * Fix Pair 2 (INV-C1): clear the shared DOM/surface/visibility
   * accumulation only at a true boundary — after the window identified by
   * `closedWindowId` has been removed, when no other live window remains to
   * drain it. Called from every close path (closeWindow tail, cleanupWindow)
   * and from openWindow (guarded there by "is this the only live window").
   */
  private clearAccumulatedIfBoundary(closedWindowId: string): void {
    const stillOpen = this.activeWindows.some(
      (w) => !w.isClosed && w.windowId !== closedWindowId,
    );
    if (!stillOpen) {
      this.domObserver.clearAccumulated();
    }
  }

  /**
   * Handle pagehide: finalize windows by CONTENT, not age.
   *
   * INV-4 (form-submit recovery): ALL open action windows are finalized
   * (zero settle delay) with endReason 'page-reload' — they carry the
   * sourceEventId anchor the CER-2 stamp joins to. Non-action windows are
   * finalized only when they carry signal (navEvents); zero-signal
   * non-action windows are abandoned. The decision is delegated to the
   * pure finalizeAtPagehide rule.
   *
   * TD-6: Construct fallback metadata from the window's observedEvent so
   * that enrichFromMetadata can fill a null/empty after-value. The
   * FINALIZE_EVIDENCE payload (which carries selectedValue/selectedDate
   * from component buildResults) hasn't arrived yet — the lifecycle hasn't
   * completed. observedEvent.valueAfter is the best available fallback at
   * content-script level.
   */
  onPageHide(): void {
    this.isUnloading = true;

    const now = performance.now();

    // INV-4 (form-submit recovery): finalize by CONTENT, never by age.
    // The old >500ms guard abandoned fast form-submit clicks whose
    // LIFECYCLE_BOUND was still in flight at pagehide — the exact Amazon
    // case. Action windows (click/keydown/change/contextmenu/submit) always
    // finalize and carry the sourceEventId anchor; zero-signal non-action
    // windows drop.
    for (const win of [...this.activeWindows]) {
      if (win.isClosed) continue;

      // TD-6: Build fallback metadata from observedEvent valueAfter
      const pageHideMetadata: Record<string, unknown> = {};
      if (win.observedEvent?.valueAfter) {
        pageHideMetadata.textValue = win.observedEvent.valueAfter;
      }

      const decision = finalizeAtPagehide(win, now);
      if (decision.finalize && decision.endReason) {
        this.executeFinalization(win, pageHideMetadata, decision.endReason);
      } else {
        // Zero-signal non-action window — abandon silently
        this.closeWindowSilently(win);
      }
    }

    // Clear all lifecycle bindings
    this.lifecycleBindings.clear();
  }

  /**
   * Get count of active windows (for testing).
   */
  getActiveWindowCount(): number {
    return this.activeWindows.filter((w) => !w.isClosed).length;
  }

  /**
   * Get whether the collector is running (for testing).
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}
