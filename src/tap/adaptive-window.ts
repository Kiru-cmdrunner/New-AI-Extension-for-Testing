/**
 * Adaptive Window — setTimeout-Based Stabilization Timer (M3)
 *
 * Replaces the old fixed 3-second observation window. Uses setTimeout-based
 * stabilization that resets on each MutationObserver callback, with a hard
 * max-duration cap.
 *
 * Parameters (spec §4.3):
 *   minQuiescence = 300ms  — DOM must be stable for this long before closing
 *   maxDuration   = 10000ms — hard cap regardless of activity
 *   minDuration   = 50ms    — minimum window lifetime (captures sync effects)
 *
 * State machine:
 *   Window opens → schedule stabilization timer + max-duration timer
 *   Each mutation batch → clear stabilization timer, re-schedule
 *   checkStabilized() → if elapsed >= minDuration, close('stabilized')
 *   forceClose() → close('max-duration')
 *
 * Stability trace: StabilitySample pushed at each timer fire + each mutation batch.
 * Circular buffer capped at 50 entries.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §4.3
 */

import type { EvidenceWindow, StabilitySample } from '../shared/behavioral-evidence-types';

// ── Window End Reasons ───────────────────────────────────────────────

export type WindowEndReason =
  | 'stabilized'
  | 'max-duration'
  | 'typing-complete'
  | 'recording-stopped'
  | 'displaced'
  | 'lifecycle-complete'
  | 'lifecycle-abandoned'
  | 'page-reload';

// ── AdaptiveWindow ───────────────────────────────────────────────────

/**
 * setTimeout-based adaptive observation window.
 *
 * Lifecycle:
 *   const win = new AdaptiveWindow({ onClose });
 *   win.arm();              // Start timers
 *   win.recordMutation();   // Reset stabilization timer (DOM still active)
 *   // ... eventually onClose is called with the EvidenceWindow ...
 */
export class AdaptiveWindow {
  private openedAt: number;
  private closedAt: number | null = null;

  private stabilizationTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stability trace — circular buffer capped at 50. */
  private stabilityTrace: StabilitySample[] = [];
  private static readonly MAX_TRACE = 50;

  /** Configuration. */
  private readonly minQuiescence: number;
  private readonly maxDuration: number;
  private readonly minDuration: number;

  /** Callback when the window closes. */
  private readonly onClose: (window: EvidenceWindow) => void;

  /** Whether the window is currently open. */
  private isOpen = false;

  /**
   * Lifecycle-bound hold-open flag. When true, the stabilization timer
   * continuously re-arms itself and the window does not close on its own.
   * The window is closed only by an explicit close() call from the
   * EvidenceCollector (triggered by FINALIZE_EVIDENCE or pagehide).
   */
  private holdOpen = false;

  /**
   * Consequence-settling gate (.drytis/specs/consequence-settling.md §7).
   * Consulted in checkStabilized() ONLY after the quiescence interval has
   * elapsed and minDuration is satisfied. Returning false delays the close
   * (re-schedules the stabilization check at the quiescence cadence); it
   * can never force a close. Undefined ⇒ pure DOM quiescence (unchanged
   * behavior for post-nav and non-lifecycle windows).
   */
  private canClose: (() => boolean) | null;

  constructor(config: {
    onClose: (window: EvidenceWindow) => void;
    minQuiescence?: number;
    maxDuration?: number;
    minDuration?: number;
    /** Consequence-settling gate — see field docs. Optional. */
    canClose?: () => boolean;
  }) {
    this.onClose = config.onClose;
    this.minQuiescence = config.minQuiescence ?? 300;
    this.maxDuration = config.maxDuration ?? 10000;
    this.minDuration = config.minDuration ?? 50;
    this.canClose = config.canClose ?? null;
    this.openedAt = performance.now();
  }

  /**
   * Arm the window: schedule stabilization + max-duration timers.
   */
  arm(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.openedAt = performance.now();

    // Record initial stability sample
    this.pushStabilitySample(0, false);

    // Schedule stabilization timer
    this.scheduleStabilization();

    // Schedule max-duration hard cap — only for non-lifecycle-bound windows.
    // Lifecycle-bound windows (holdOpen=true) are closed exclusively by
    // explicit close() calls (FINALIZE_EVIDENCE, pagehide, etc.).
    // TD-8 fix: max-duration was force-closing holdOpen windows after 10s,
    // preempting the lifecycle-driven finalization path.
    if (!this.holdOpen) {
      this.maxDurationTimer = setTimeout(() => {
        this.close('max-duration');
      }, this.maxDuration);
    }
  }

  /**
   * Record a mutation batch. Resets the stabilization timer.
   *
   * TD-8 fix: For holdOpen windows, also ensure the max-duration timer is
   * cleared (it may have been scheduled before setHoldOpen was called).
   */
  recordMutation(batchIndex?: number): void {
    if (!this.isOpen) return;

    const now = performance.now();
    const elapsed = now - this.openedAt;
    void batchIndex; // reserved for future use

    // Push stability sample (active period)
    this.pushStabilitySample(elapsed, true);

    // Clear and re-schedule stabilization timer
    if (this.stabilizationTimer) {
      clearTimeout(this.stabilizationTimer);
      this.stabilizationTimer = null;
    }
    this.scheduleStabilization();

    // TD-8: Safety — clear any lingering max-duration timer on holdOpen windows
    if (this.holdOpen && this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  /**
   * Force-close the window (e.g., for displacement or recording stop).
   */
  close(reason: WindowEndReason): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closedAt = performance.now();
    // Consequence-settling: drop the gate on close — the window is done.
    this.canClose = null;
    // Clear timers
    if (this.stabilizationTimer) {
      clearTimeout(this.stabilizationTimer);
      this.stabilizationTimer = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }

    // Push final stability sample
    const elapsed = this.closedAt - this.openedAt;
    this.pushStabilitySample(elapsed, false);

    // Build and emit EvidenceWindow
    const window: EvidenceWindow = {
      openedAt: this.openedAt,
      closedAt: this.closedAt,
      durationMs: this.closedAt - this.openedAt,
      endReason: reason,
      stabilityTrace: [...this.stabilityTrace],
    };

    this.onClose(window);
  }

  /**
   * Check if the window is currently open.
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Set lifecycle-bound hold-open mode.
   * When true, the stabilization timer continuously re-arms itself and the
   * max-duration timer is disabled. The window stays open until explicitly
   * closed (FINALIZE_EVIDENCE or pagehide).
   *
   * TD-8 fix: When holdOpen is enabled after arm() has already scheduled the
   * max-duration timer, clear it so lifecycle-bound windows aren't force-closed.
   *
   * Consequence-settling (§5, §6): setHoldOpen(false) is the settle-mode
   * transition. Because arm() never schedules the max-duration timer for
   * holdOpen windows, entering settle mode must (re)arm it with the
   * REMAINING time measured from OPEN — so the window can never outlive
   * open+maxDuration regardless of when the lifecycle finalized. If the
   * cap has already elapsed, close immediately.
   */
  setHoldOpen(value: boolean): void {
    this.holdOpen = value;
    if (value && this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (!value && this.isOpen && this.maxDurationTimer === null) {
      const remaining = this.maxDuration - this.getElapsedMs();
      if (remaining <= 0) {
        this.close('max-duration');
        return;
      }
      this.maxDurationTimer = setTimeout(() => {
        this.close('max-duration');
      }, remaining);
    }
  }

  /**
   * Set the consequence-settling close gate (§6.1). Callers install this
   * at settle-mode entry; close() clears it. Optional by design — windows
   * without a gate keep pure DOM-quiescence behavior.
   */
  setCanClose(fn: (() => boolean) | null): void {
    this.canClose = fn;
  }

  /**
   * Get the time the window was opened.
   */
  getOpenedAt(): number {
    return this.openedAt;
  }

  /**
   * Get elapsed time since window opened (or total duration if closed).
   */
  getElapsedMs(): number {
    const end = this.closedAt ?? performance.now();
    return end - this.openedAt;
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Schedule the stabilization check timer.
   */
  private scheduleStabilization(): void {
    this.stabilizationTimer = setTimeout(() => {
      this.checkStabilized();
    }, this.minQuiescence);
  }

  /**
   * Check if the DOM has been quiescent long enough to close the window.
   */
  private checkStabilized(): void {
    if (!this.isOpen) return;

    const now = performance.now();
    const elapsed = now - this.openedAt;

    // Push stability sample (quiescence period)
    this.pushStabilitySample(elapsed, false);

    if (elapsed >= this.minDuration) {
      if (this.holdOpen) {
        // Lifecycle-bound: don't close on stabilization. Re-schedule.
        this.scheduleStabilization();
        return;
      }
      // Consequence-settling gate (§7): consult ONLY after quiescence +
      // minDuration are satisfied. A false result re-schedules the check
      // at the quiescence cadence — the network-idle poll loop. It never
      // forces a close and is never consulted before quiescence.
      if (this.canClose && !this.canClose()) {
        this.scheduleStabilization();
        return;
      }
      this.close('stabilized');
    } else {
      // Too early — re-schedule for the remaining time
      const remaining = this.minDuration - elapsed;
      this.stabilizationTimer = setTimeout(() => {
        this.checkStabilized();
      }, remaining);
    }
  }

  /**
   * Push a stability sample to the trace.
   * Circular buffer: if at capacity, overwrite oldest.
   */
  private pushStabilitySample(_elapsedMs: number, hasMutations: boolean): void {
    const sample: StabilitySample = {
      timestamp: performance.now(),
      msSinceLastMutation: hasMutations ? 0 : this.minQuiescence,
      globalBatchCount: 0,
    };

    this.stabilityTrace.push(sample);

    // Enforce circular buffer cap
    if (this.stabilityTrace.length > AdaptiveWindow.MAX_TRACE) {
      this.stabilityTrace.shift();
    }
  }
}
