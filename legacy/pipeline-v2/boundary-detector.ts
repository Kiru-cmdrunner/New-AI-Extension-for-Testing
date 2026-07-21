/**
 * Boundary Detector — Pipeline V2 Layer 2
 *
 * Groups PipelineEvents into InteractionUnit objects based on interaction
 * lifecycle boundaries.
 *
 * Boundary detection strategies (in priority order):
 *
 * 1. SURFACE LIFECYCLE: When a surface opens (modal, dropdown, menu), a new
 *    unit begins. All subsequent events belong to that unit until the surface
 *    closes (or another surface opens). This is the primary grouping mechanism
 *    for composite interactions like dropdown selection, date picker, etc.
 *
 * 2. TEMPORAL GAP: When no events arrive within TEMPORAL_GAP_MS, the current
 *    unit is closed. This handles simple interactions (click, checkbox toggle)
 *    where there's no explicit open/close lifecycle.
 *
 * 3. FOCUS CONTINUITY: Focus changes to a related element keep the unit open;
 *    focus changes to an unrelated element close it.
 *
 * 4. NAVIGATION: URL changes immediately close any open unit.
 *
 * 5. EXPLICIT FLUSH: flush() (called on Stop Recording) closes any open unit.
 *
 * FRAMEWORK AGNOSTICISM: The detector observes DOM behavior (surface_open /
 * surface_close events from the observer, temporal gaps, focus changes), not
 * framework internals. A Material UI dropdown, Ant Design dropdown, and custom
 * div dropdown all produce the same surface_open → events → surface_close
 * sequence.
 */

import type {
  PipelineEvent,
  InteractionUnit,
  BoundaryReason,
} from './canonical-event-schema';

// ── Configuration ───────────────────────────────────────────────────────

export interface BoundaryDetectorConfig {
  /**
   * Maximum gap between events before the current unit is closed.
   * Default: 800ms. Tuned for typical click-pause-click patterns.
   */
  temporalGapMs: number;

  /**
   * Whether to use a timer for temporal-gap detection.
   * In tests, set to false and call tick() manually.
   */
  useTimer: boolean;
}

const DEFAULT_CONFIG: BoundaryDetectorConfig = {
  // RC-4 FIX: Increased from 800ms to 2000ms to accommodate multi-step
  // interactions (dropdown trigger click → browse options → select option)
  // and native <select> dropdowns where the native UI adds latency.
  temporalGapMs: 2000,
  useTimer: true,
};

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Callback invoked when the boundary detector closes an interaction unit.
 */
export type OnUnitClosed = (unit: InteractionUnit) => void;

interface PendingUnit {
  events: PipelineEvent[];
  primaryEvent: PipelineEvent;
  startTime: string;
  lastEventTime: number; // epoch ms
  hasOpenSurface: boolean;
  surfaceDepth: number; // nested surfaces
}

// ── Boundary Detector ───────────────────────────────────────────────────

export class BoundaryDetector {
  private readonly config: BoundaryDetectorConfig;
  private pending: PendingUnit | null = null;
  private onUnitClosed: OnUnitClosed | null = null;
  private unitCounter = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<BoundaryDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the callback for when an interaction unit is closed.
   */
  onClosed(callback: OnUnitClosed): void {
    this.onUnitClosed = callback;
  }

  /**
   * Ingest a PipelineEvent. May open a new unit, append to the current
   * unit, or close the current unit and open a new one.
   */
  ingest(event: PipelineEvent): void {
    // Navigation always closes any open unit immediately
    if (event.type === 'navigation') {
      this.closePending('navigation');
      // Navigation is its own unit
      this.openUnit(event);
      this.closePending('navigation');
      return;
    }

    // Surface lifecycle management
    if (event.type === 'surface_open') {
      if (this.pending) {
        this.pending.hasOpenSurface = true;
        this.pending.surfaceDepth++;
        this.pending.events.push(event);
        this.pending.lastEventTime = this.toEpoch(event.timestamp);
        this.resetTimer();
        return;
      }
      // No pending unit — start one with the surface_open
      this.openUnit(event);
      if (this.pending) {
        this.pending.hasOpenSurface = true;
        this.pending.surfaceDepth = 1;
      }
      return;
    }

    if (event.type === 'surface_close') {
      if (this.pending && this.pending.hasOpenSurface) {
        this.pending.events.push(event);
        this.pending.lastEventTime = this.toEpoch(event.timestamp);
        this.pending.surfaceDepth--;

        // When all nested surfaces have closed, close the unit
        if (this.pending.surfaceDepth <= 0) {
          this.pending.hasOpenSurface = false;
          this.pending.surfaceDepth = 0;
          // Small grace period — some frameworks fire value changes
          // slightly after surface_close. But we close immediately
          // because the state diff is taken at close time anyway.
          this.closePending('surface_closed');
        } else {
          this.resetTimer();
        }
        return;
      }
      // surface_close without matching open — standalone event
      this.openUnit(event);
      this.closePending('temporal_gap');
      return;
    }

    // Standard events (click, change, input, focus, blur, keydown, etc.)
    if (this.pending) {
      // Check temporal gap
      const eventTime = this.toEpoch(event.timestamp);
      const gap = eventTime - this.pending.lastEventTime;
      if (gap > this.config.temporalGapMs && !this.pending.hasOpenSurface) {
        // Gap exceeded — close current unit, start new one
        this.closePending('temporal_gap');
        this.openUnit(event);
      } else {
        // Append to current unit
        this.pending.events.push(event);
        this.pending.lastEventTime = eventTime;
        this.resetTimer();
      }
    } else {
      // No pending unit — start a new one
      this.openUnit(event);
    }
  }

  /**
   * Flush any pending unit (called on Stop Recording or explicit flush).
   */
  flush(): void {
    if (this.pending) {
      this.closePending('explicit_flush');
    }
  }

  /**
   * Reset the detector to its initial state.
   */
  reset(): void {
    this.pending = null;
    this.unitCounter = 0;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Whether a unit is currently open (for debugging/testing).
   */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private openUnit(event: PipelineEvent): void {
    const eventTime = this.toEpoch(event.timestamp);
    this.pending = {
      events: [event],
      primaryEvent: event,
      startTime: event.timestamp,
      lastEventTime: eventTime,
      hasOpenSurface: false,
      surfaceDepth: 0,
    };
    this.resetTimer();
  }

  private closePending(reason: BoundaryReason): void {
    if (!this.pending) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const unit: InteractionUnit = {
      unitId: `unit-${String(++this.unitCounter).padStart(4, '0')}`,
      events: [...this.pending.events],
      primaryEvent: this.pending.primaryEvent,
      startTime: this.pending.startTime,
      endTime: this.pending.events[this.pending.events.length - 1].timestamp,
      boundaryReason: reason,
    };

    this.pending = null;

    if (this.onUnitClosed) {
      this.onUnitClosed(unit);
    }
  }

  private resetTimer(): void {
    if (!this.config.useTimer || !this.pending || this.pending.hasOpenSurface) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.closePending('temporal_gap');
    }, this.config.temporalGapMs);
  }

  private toEpoch(timestamp: string): number {
    return new Date(timestamp).getTime();
  }
}

// ── Pure Helper: Determine the Primary Event ────────────────────────────

/**
 * Given a set of events in an interaction unit, determine which event
 * is the "primary" — the one that most likely initiated the interaction.
 *
 * Heuristic:
 *   - If there's a surface_open, the click before it is primary
 *   - If there's a click, the first click is primary
 *   - Otherwise, the first event is primary
 *
 * This is a pure function for unit testing.
 */
export function determinePrimaryEvent(events: PipelineEvent[]): PipelineEvent | null {
  if (events.length === 0) return null;

  // Look for the first click event
  const firstClick = events.find((e) => e.type === 'click' || e.type === 'dblclick');
  if (firstClick) return firstClick;

  // Look for surface_open
  const surfaceOpen = events.find((e) => e.type === 'surface_open');
  if (surfaceOpen) return surfaceOpen;

  // Default: first event
  return events[0];
}
