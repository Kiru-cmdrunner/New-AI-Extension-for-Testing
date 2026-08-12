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
    };

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
   * Called on recording start (recover from SW restart).
   */
  flushBufferedEvidence(): void {
    try {
      const raw = sessionStorage.getItem(EVIDENCE_BUFFER_KEY);
      if (!raw) return;
      const buffer: BehavioralEvidence[] = JSON.parse(raw);
      for (const evidence of buffer) {
        if (chrome?.runtime?.sendMessage) {
          chrome.runtime.sendMessage(
            { type: 'BEHAVIORAL_EVIDENCE', payload: evidence },
            () => { void chrome.runtime.lastError; },
          );
        }
      }
      sessionStorage.removeItem(EVIDENCE_BUFFER_KEY);
    } catch {
      // silent degrade
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
