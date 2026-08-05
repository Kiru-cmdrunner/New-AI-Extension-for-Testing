/**
 * Observation Coordinator — Window Lifecycle Management (M1 Phase C)
 *
 * Connects Phase A (Element State Cache) and Phase B (Document Observer)
 * into one independent 3-second observation window per user interaction.
 *
 * For every click or change event (via Phase D's onAfterEvent):
 *   1. Reads before-state from the Phase A cache
 *   2. Opens a window on the Phase B document observer
 *   3. Starts an independent 3-second timer
 *   4. On close: captures final-state (via read(), not capture()), collects
 *      mutation records, prunes the buffer, builds ObservationResult, delivers it
 *
 * Each window has an INDEPENDENT lifetime. Windows do not close together.
 * Shared mutations during overlapping windows carry all active windowIds.
 *
 * Architecture: .drytis/specs/m1-phase-c-detailed-design.md
 */

import type {
  ObservationResult,
  ObservationWindow,
  WindowEndReason,
} from '../shared/observation-types';
import type { ElementStateCache } from './element-state-cache';
import type { DocumentObserver } from './document-observer';

// ── Configuration ───────────────────────────────────────────────────────

export interface CoordinatorConfig {
  /** Phase A's ElementStateCache instance. */
  cache: ElementStateCache;
  /** Phase B's DocumentObserver instance. */
  observer: DocumentObserver;
  /** Called when a window closes with a complete ObservationResult. */
  onResult: (result: ObservationResult) => void;
  /**
   * Window duration in milliseconds. Production default: 3000.
   * Tests may inject a shorter value for faster execution.
   */
  windowDurationMs?: number;
}

// ── Constants ───────────────────────────────────────────────────────────

/** Fixed observation window duration (ms). No early closure, no stability check. */
const DEFAULT_WINDOW_DURATION_MS = 3000;

// ── ObservationCoordinator ──────────────────────────────────────────────

/**
 * Manages independent observation windows. One window per interaction.
 *
 * Lifecycle:
 *   configure() → openWindow() × N → closeWindow() (timer or shutdown) → shutdown()
 *
 * Thread safety: JavaScript is single-threaded. All methods run in the same
 * event loop turn as the caller — no concurrent access to internal maps.
 * Late timer fires after shutdown are guarded by null checks and map lookups.
 */
export class ObservationCoordinator {
  /** Phase A: element state cache for before/final state snapshots. */
  private cache: ElementStateCache | null = null;

  /** Phase B: document observer for mutation capture. */
  private observer: DocumentObserver | null = null;

  /** Result delivery callback. */
  private onResultCb: ((result: ObservationResult) => void) | null = null;

  /** Window duration (ms). 3000 in production, configurable for tests. */
  private windowDurationMs: number = DEFAULT_WINDOW_DURATION_MS;

  /** Active windows, keyed by windowId. */
  private windows: Map<string, ObservationWindow> = new Map();

  /** Active timers, keyed by windowId. */
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Element references for final-state capture at close time. */
  private targetElements: Map<string, WeakRef<Element>> = new Map();

  /**
   * Configure the coordinator with its dependencies and result callback.
   * Called once at recording start (by recorder-entry in Phase D).
   */
  configure(config: CoordinatorConfig): void {
    this.cache = config.cache;
    this.observer = config.observer;
    this.onResultCb = config.onResult;
    this.windowDurationMs = config.windowDurationMs ?? DEFAULT_WINDOW_DURATION_MS;
  }

  /**
   * Open an observation window for a user interaction.
   * Called by EventTap's onAfterEvent callback (Phase D) for click/change events.
   *
   * Steps:
   * 1. Peek the cache for the before-state snapshot (may be null on first interaction)
   * 2. Capture current state (updates the cache for next interaction's before-state)
   * 3. Create an ObservationWindow record
   * 4. Call docObserver.start(windowId) — refcounted, may be no-op if already running
   * 5. Set an independent timer for this window
   */
  openWindow(
    eventId: string,
    eventType: string,
    targetEl: Element,
  ): void {
    // Defensive guard: fail safely rather than crashing the recorder.
    if (!this.cache || !this.observer || !this.onResultCb) return;

    const windowId = `obs-${eventId}`;
    const now = performance.now();

    // 1. Peek the cache for before-state (may be null on first interaction)
    const beforeSnapshot = this.cache.peek(targetEl);

    // 2. Capture current state (updates cache for next interaction's before-state)
    this.cache.capture(targetEl);

    // 3. Create the window record
    const window: ObservationWindow = {
      windowId,
      sourceEventId: eventId,
      sourceEventType: eventType,
      sourceElementPath: this.computeElementPath(targetEl),
      openedAt: now,
      closedAt: null,
      endReason: null,
      beforeSnapshot,
      finalSnapshot: null,
    };

    this.windows.set(windowId, window);
    this.targetElements.set(windowId, new WeakRef(targetEl));

    // 4. Start observing (refcounted — no-op if already running for another window)
    this.observer.start(windowId);

    // 5. Set independent timer
    const timer = setTimeout(() => {
      this.closeWindow(windowId, 'completed');
    }, this.windowDurationMs);

    this.timers.set(windowId, timer);
  }

  /**
   * Close all open windows immediately.
   * Called on stopRecording (by recorder-entry in Phase D).
   *
   * Each window is finalized with all evidence captured up to the
   * recording-stop boundary:
   *   - Final state read at this moment
   *   - Mutations already captured for the window are collected
   *   - Result is emitted
   *   - Timers and observer state are cleaned up
   *
   * Does NOT wait for remaining window duration. Does NOT discard evidence.
   */
  shutdown(): void {
    const openIds = [...this.windows.keys()];
    for (const id of openIds) {
      this.closeWindow(id, 'recording-stopped');
    }

    // Clean up references — coordinator is done.
    this.cache = null;
    this.observer = null;
    this.onResultCb = null;
  }

  // ── Introspection (testing/debugging) ─────────────────────────────────

  /** Number of currently open windows. */
  getOpenWindowCount(): number {
    return this.windows.size;
  }

  /** Get a window's current state (for testing). */
  getWindow(windowId: string): ObservationWindow | null {
    return this.windows.get(windowId) ?? null;
  }

  // ── Internal: Window Close ────────────────────────────────────────────

  /**
   * Close a window, collect all evidence, build result, and deliver it.
   *
   * Called by:
   * - Timer expiry (endReason='completed')
   * - shutdown() (endReason='recording-stopped')
   *
   * Order of operations (critical):
   * 1. Clear timer (prevent double-close if shutdown races with timer)
   * 2. Read final state via cache.read() (non-mutating — doesn't corrupt before-state)
   * 3. Collect mutation records from shared buffer (copies)
   * 4. Prune this window's records from the shared buffer
   * 5. Stop observing for this window (refcounted — may keep observer alive for others)
   * 6. Build immutable ObservationResult
   * 7. Clean up internal state
   * 8. Deliver result
   */
  private closeWindow(windowId: string, reason: WindowEndReason): void {
    const window = this.windows.get(windowId);
    if (!window) return; // already closed or unknown — defensive guard

    // Late-timer/reset race: if dependencies were nulled by shutdown, guard.
    if (!this.cache || !this.observer || !this.onResultCb) return;

    const now = performance.now();

    // 1. Clear timer (if closing early due to shutdown)
    const timer = this.timers.get(windowId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(windowId);
    }

    // 2. Read final state — uses read() not capture() to avoid corrupting
    //    before-state for overlapping interactions.
    //    Uses document.contains() for reliable removal detection (not WeakRef GC).
    const ref = this.targetElements.get(windowId);
    let finalSnapshot = null;
    let actualReason = reason;

    if (ref) {
      const el = ref.deref();
      if (el && document.contains(el)) {
        finalSnapshot = this.cache.read(el);
      } else {
        actualReason = 'element-removed';
      }
      this.targetElements.delete(windowId);
    }

    // 3. Collect mutation records for this window (copies from shared buffer)
    const mutations = this.observer.getRecordsForWindow(windowId);
    const mutationCount = mutations.length;
    const docWideTotal = this.observer.getTotalRecordsDuringWindow(windowId);

    // 4. Prune this window's records from the shared buffer
    this.observer.pruneWindowRecords(windowId);

    // 5. Stop observing for this window (refcounted — may keep observer alive)
    this.observer.stop(windowId);

    // 6. Build result
    const result: ObservationResult = {
      sourceEventId: window.sourceEventId,
      sourceEventType: window.sourceEventType,
      windowId,
      openedAt: window.openedAt,
      closedAt: now,
      durationMs: Math.round((now - window.openedAt) * 100) / 100,
      endReason: actualReason,
      beforeSnapshot: window.beforeSnapshot,
      finalSnapshot,
      mutations,
      mutationCount,
      documentWideMutationTotal: docWideTotal,
      performanceCondition: this.observer.getPerformanceCondition(),
    };

    // 7. Clean up internal state
    this.windows.delete(windowId);

    // 8. Deliver result
    this.onResultCb(result);
  }

  // ── Internal: Element Path ────────────────────────────────────────────

  /**
   * Compute a human-readable CSS path from document.body to the element.
   * Display-only — NOT used for element resolution at window close.
   */
  private computeElementPath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    let depth = 0;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const sameTagSiblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName,
      );

      if (sameTagSiblings.length === 1) {
        parts.unshift(tag);
      } else {
        parts.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
      }

      current = parent;
      depth++;
    }

    return parts.length > 0 ? `body > ${parts.join(' > ')}` : 'body';
  }
}
