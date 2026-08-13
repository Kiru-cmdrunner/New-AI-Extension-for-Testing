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

  constructor(config: {
    onClose: (window: EvidenceWindow) => void;
    minQuiescence?: number;
    maxDuration?: number;
    minDuration?: number;
  }) {
    this.onClose = config.onClose;
    this.minQuiescence = config.minQuiescence ?? 300;
    this.maxDuration = config.maxDuration ?? 10000;
    this.minDuration = config.minDuration ?? 50;
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

    // Schedule max-duration hard cap
    this.maxDurationTimer = setTimeout(() => {
      this.close('max-duration');
    }, this.maxDuration);
  }

  /**
   * Record a mutation batch. Resets the stabilization timer.
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
  }

  /**
   * Force-close the window (e.g., for displacement or recording stop).
   */
  close(reason: WindowEndReason): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closedAt = performance.now();
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
   * When true, the stabilization timer continuously re-arms itself.
   * The window stays open until explicitly closed (FINALIZE_EVIDENCE or pagehide).
   */
  setHoldOpen(value: boolean): void {
    this.holdOpen = value;
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
