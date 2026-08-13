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
import { captureValue } from './identity-extractor';

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

/** Event types that open evidence windows. */
const WINDOW_OPEN_EVENTS = new Set([
  'click', 'contextmenu', 'change', 'keydown',
]);

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

  /** Network bridge for collecting network activity (M6). */
  private networkBridge: NetworkBridge | null = null;

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
  }) {
    this.targetStateCache = config.targetStateCache;
    this.domObserver = config.domObserver;
    this.networkBridge = config.networkBridge ?? null;
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
  ): void {
    // Enforce max concurrent windows with displacement
    this.enforceMaxConcurrent();

    // Start DOMObserver if this is the first window
    if (this.domObserverRefcount === 0) {
      this.domObserver.start();
    }
    this.domObserverRefcount++;
    this.domObserver.clearAccumulated();

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

    // Create AdaptiveWindow
    const adaptiveWindow = new AdaptiveWindow({
      onClose: (evidenceWindow) => {
        this.closeWindow(windowId, evidenceWindow);
      },
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
      inflightNetworkUrls: new Set(),
      observedEvent, // P1-3 fix: store ObservedEvent for valueBefore/valueAfter fallback
      lifecycleId: null,
      isLifecycleBound: false,
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
   * Close an observation window and build the BehavioralEvidence.
   */
  private closeWindow(windowId: string, evidenceWindow: EvidenceWindow): void {
    const state = this.activeWindows.find((w) => w.windowId === windowId);
    if (!state || state.isClosed) return;

    state.isClosed = true;
    state.adaptiveWindow = evidenceWindow as unknown as AdaptiveWindow; // store the evidence window data

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
      networkActivity = this.networkBridge.collectForRange(
        state.openedAt,
        performance.now(),
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
    this.domObserver.clearAccumulated();
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
   */
  private handleTypingEvent(targetEl: Element, eventId: string, identity: ElementIdentity | null = null, observedEvent: ObservedEvent | null = null): void {
    // If typing on the same element, extend the existing window
    if (this.activeTypingTarget === targetEl && this.activeTypingWindow && !this.activeTypingWindow.isClosed) {
      // Extend: reset stabilization timer
      this.activeTypingWindow.adaptiveWindow.recordMutation();
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
      window.isLifecycleBound = true;
      window.adaptiveWindow.setHoldOpen(true);
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

    // If page is unloading, finalize immediately (no settle delay)
    if (settleDelay === 0) {
      this.executeFinalization(win, payload.metadata, endReason);
      return;
    }

    // Schedule a brief settle for framework handlers to propagate state changes
    setTimeout(() => {
      if (win.isClosed) return; // already closed by another path
      this.executeFinalization(win, payload.metadata, endReason);
    }, settleDelay);
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
    endReason: 'lifecycle-complete' | 'lifecycle-abandoned' | 'page-reload',
  ): void {
    // Collect accumulated mutations
    const allSummaries = this.domObserver.getAccumulatedSummaries();
    const surfaces = this.domObserver.getSurfaceChanges();
    const visibilityChanges = this.domObserver.getVisibilityChanges();
    const perfMetrics = this.domObserver.getPerformanceMetrics();

    // Collect network activity
    let networkActivity: NetworkActivity[] = [];
    if (this.networkBridge) {
      networkActivity = this.networkBridge.collectForRange(
        state.openedAt,
        performance.now(),
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

    this.domObserver.clearAccumulated();
  }

  /**
   * Handle pagehide: immediately finalize all lifecycle-bound windows.
   * Evidence is buffered to sessionStorage and flushed by the next page.
   *
   * TD-4: Also finalize non-lifecycle-bound windows that have been open for
   * more than 500ms. This catches the narrow edge case where LIFECYCLE_BOUND
   * hasn't arrived yet when pagehide fires. Windows open <500ms are likely
   * companion events or transient and can be safely abandoned.
   *
   * TD-6: Construct fallback metadata from the window's observedEvent so that
   * enrichFromMetadata can fill a null/empty after-value. The FINALIZE_EVIDENCE
   * payload (which carries selectedValue/selectedDate from component buildResults)
   * hasn't arrived yet — the lifecycle hasn't completed. observedEvent.valueAfter
   * is the best available fallback at content-script level.
   */
  onPageHide(): void {
    this.isUnloading = true;

    const now = performance.now();

    // Immediately finalize all lifecycle-bound windows (zero settle delay)
    for (const win of [...this.activeWindows]) {
      if (win.isClosed) continue;

      // TD-6: Build fallback metadata from observedEvent valueAfter
      const pageHideMetadata: Record<string, unknown> = {};
      if (win.observedEvent?.valueAfter) {
        pageHideMetadata.textValue = win.observedEvent.valueAfter;
      }

      if (win.isLifecycleBound) {
        this.executeFinalization(win, pageHideMetadata, 'page-reload');
      } else if (now - win.openedAt > 500) {
        // TD-4: Safety net for windows that never received a LIFECYCLE_BOUND
        // but have been open long enough that their evidence is worth saving.
        this.executeFinalization(win, pageHideMetadata, 'page-reload');
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
