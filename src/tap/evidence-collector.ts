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
  SurfaceChange,
  VisibilityChange as _VisibilityChange,
  NavigationEvidence,
  PerformanceCondition as _PerformanceCondition,
} from '../shared/behavioral-evidence-types';
import type { ElementIdentity } from '../shared/types';
import { TargetStateCache } from './target-state-cache';
import { DOMObserver } from './dom-observer';
import { AdaptiveWindow } from './adaptive-window';

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
  'click', 'mousedown', 'contextmenu', 'change', 'keydown', 'focus', 'blur',
]);

/** Event types that use extend-on-input typing model. */
const TYPING_EVENTS = new Set(['input']);

/** Event types that are throttled. */
const THROTTLED_EVENTS = new Set(['scroll']);

/** Event types that are capture-only (no evidence window). */
const CAPTURE_ONLY_EVENTS = new Set([
  'mouseenter', 'mouseleave', 'mousemove',
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

  /** Collected navigation events not yet attributed to a window. */
  private pendingNavEvents: NavigationEvidence[] = [];

  constructor(config: {
    targetStateCache: TargetStateCache;
    domObserver: DOMObserver;
  }) {
    this.targetStateCache = config.targetStateCache;
    this.domObserver = config.domObserver;
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
    this.pendingNavEvents = [];
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
   */
  onAfterEvent(
    targetEl: Element,
    eventId: string,
    eventType: string,
    _cssSelector: string,
  ): void {
    if (!this.isRunning) return;

    // Capture-only events — no evidence window
    if (CAPTURE_ONLY_EVENTS.has(eventType)) return;

    // Navigation events — record and attribute to active windows
    if (eventType === 'navigation') {
      this.recordNavigationEvent(targetEl);
      return;
    }

    // Typing events — extend-on-input model (§4.6)
    if (TYPING_EVENTS.has(eventType)) {
      this.handleTypingEvent(targetEl, eventId);
      return;
    }

    // Throttled events — scroll (§4.7)
    if (THROTTLED_EVENTS.has(eventType)) {
      this.handleScrollEvent(targetEl, eventId);
      return;
    }

    // keydown — only open window for Enter key
    if (eventType === 'keydown') {
      // EventTap filters to Enter-only before calling onAfterEvent
      // (handled by the caller; if we get here for keydown, it's Enter)
    }

    // Standard window-open events (click, mousedown, contextmenu, change, focus, blur, keydown-Enter)
    if (WINDOW_OPEN_EVENTS.has(eventType) || eventType === 'submit') {
      this.openWindow(targetEl, eventId, eventType);
    }
  }

  // ── Window Lifecycle ───────────────────────────────────────────────

  /**
   * Open a new observation window for a user interaction.
   */
  private openWindow(targetEl: Element, eventId: string, eventType: string): void {
    // Enforce max concurrent windows with displacement
    this.enforceMaxConcurrent();

    // Start DOMObserver if this is the first window
    if (this.domObserverRefcount === 0) {
      this.domObserver.start();
    }
    this.domObserverRefcount++;
    this.domObserver.clearAccumulated();

    // Peek TargetStateCache for before snapshot
    const beforeSnapshot = this.targetStateCache.peek(targetEl) ?? null;

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
      identity: null, // Identity comes from the ObservedEvent, not available here
      beforeSnapshot,
      openedAt,
      adaptiveWindow,
      navEvents: [],
      isClosed: false,
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

    // Apply 200-cap
    const coarseMode = allSummaries.length > MAX_DOM_CHANGES;
    const domChanges = allSummaries.slice(0, MAX_DOM_CHANGES);
    const domChangeOverflow = Math.max(0, allSummaries.length - MAX_DOM_CHANGES);

    // Split surfaces into new/removed (we track them together in DOMObserver)
    const newSurfaces = surfaces.filter((_, i) => i % 2 === 0 || true).slice(0, 50); // simplified
    const removedSurfaces: SurfaceChange[] = []; // DOMObserver tracks all as one list

    // Build TargetEvidence
    const targetEvidence: TargetEvidence = {
      identity: state.identity as ElementIdentity,
      identityCapturedAt: state.openedAt,
      before: state.beforeSnapshot,
      after: afterSnapshot,
      focusMovement,
    };

    // Build ApplicationEvidence
    const applicationEvidence: ApplicationEvidence = {
      domChanges,
      domChangeOverflow,
      coarseMode,
      newSurfaces: newSurfaces.slice(0, 50),
      removedSurfaces,
      visibilityChanges: visibilityChanges.slice(0, 50),
      navigation: [...state.navEvents, ...this.pendingNavEvents],
      networkActivity: [], // M6 scope
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
    this.pendingNavEvents = [];
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
   */
  private handleTypingEvent(targetEl: Element, eventId: string): void {
    // If typing on the same element, extend the existing window
    if (this.activeTypingTarget === targetEl && this.activeTypingWindow && !this.activeTypingWindow.isClosed) {
      // Extend: reset stabilization timer
      this.activeTypingWindow.adaptiveWindow.recordMutation();
      return;
    }

    // Different element or no active typing window → open new window
    this.openWindow(targetEl, eventId, 'input');
    this.activeTypingTarget = targetEl;
    this.activeTypingWindow = this.activeWindows[this.activeWindows.length - 1] ?? null;

    // Set end reason to typing-complete when this window closes
    // (the AdaptiveWindow will close via stabilization, but we override the reason)
  }

  // ── Scroll Strategy (§4.7) ─────────────────────────────────────────

  /**
   * Handle scroll events with throttling.
   */
  private handleScrollEvent(targetEl: Element, eventId: string): void {
    const now = performance.now();
    if (now - this.lastScrollWindowTime < MIN_SCROLL_INTERVAL_MS) {
      return; // throttled
    }
    this.lastScrollWindowTime = now;
    this.openWindow(targetEl, eventId, 'scroll');
  }

  // ── Navigation Evidence ────────────────────────────────────────────

  /**
   * Record a navigation event and attribute it to active windows.
   */
  private recordNavigationEvent(targetEl: Element): void {
    const navEvidence: NavigationEvidence = {
      type: this.extractNavType(targetEl),
      fromUrl: this.extractFromUrl(),
      toUrl: location.href,
      relativeTime: performance.now(),
      batchIndex: this.domObserver.getBatchCounter(),
    };

    // Attribute to all active windows
    for (const win of this.activeWindows) {
      if (!win.isClosed) {
        win.navEvents.push(navEvidence);
      }
    }

    // Also keep in pending for the next window that might open
    this.pendingNavEvents.push(navEvidence);
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
   * Extract navigation type from a navigation event target.
   */
  private extractNavType(_targetEl: Element): NavigationEvidence['type'] {
    // The navType is set on the ObservedEvent by EventTap (M1).
    // Here we infer from location change — full reload detection is limited.
    return 'pushState'; // default; refined by correlation layer
  }

  /**
   * Get the previous URL (best effort).
   */
  private extractFromUrl(): string {
    return ''; // Unknown in content script context
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
