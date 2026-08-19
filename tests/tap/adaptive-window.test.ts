/**
 * M3 Unit Tests: AdaptiveWindow — setTimeout-Based Stabilization
 *
 * Tests the stabilization timer, max-duration cap, min-duration enforcement,
 * stability trace, and all endReason values.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §4.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdaptiveWindow } from '../../src/tap/adaptive-window';
import type { EvidenceWindow } from '../../src/shared/behavioral-evidence-types';

describe('AdaptiveWindow', () => {
  let mockNow = 0;

  beforeEach(() => {
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Advance both fake timers and the mocked performance.now() together. */
  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  // ── Basic Lifecycle ────────────────────────────────────────────────

  it('arm() opens the window and schedules timers', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    expect(win.getIsOpen()).toBe(true);
    expect(result).toBeNull(); // not closed yet
  });

  it('after arm() with no mutations, closes with "stabilized" after minQuiescence', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();

    // Advance past minQuiescence (and minDuration)
    advance(301);

    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('stabilized');
    expect(win.getIsOpen()).toBe(false);
  });

  // ── Stabilization Timer Reset ──────────────────────────────────────

  it('recordMutation() resets the stabilization timer', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();

    // Advance 200ms (not yet at minQuiescence=300)
    advance(200);
    expect(win.getIsOpen()).toBe(true);

    // Record a mutation — resets the timer
    win.recordMutation();

    // Advance 250ms — would have closed at 300+50 without reset, but now
    // timer was reset at 200ms, so it fires at 200+300=500ms
    advance(250);
    expect(win.getIsOpen()).toBe(true);

    // Advance remaining time to pass 300ms since the mutation
    advance(100);
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('stabilized');
  });

  it('multiple recordMutation() calls keep extending the window', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 5000,
      minDuration: 50,
    });

    win.arm();

    // Simulate rapid mutations every 100ms
    for (let i = 0; i < 5; i++) {
      advance(100);
      win.recordMutation();
    }

    expect(win.getIsOpen()).toBe(true);

    // Now stop mutating — should close after minQuiescence
    advance(301);

    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('stabilized');
  });

  // ── Max-Duration Hard Cap ──────────────────────────────────────────

  it('forceClose() fires at maxDuration even with continuous mutations', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 1000, // short for testing
      minDuration: 50,
    });

    win.arm();

    // Continuously fire mutations to prevent stabilization
    for (let i = 0; i < 20; i++) {
      advance(50);
      win.recordMutation();
    }

    // Total elapsed = 1000ms = maxDuration
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('max-duration');
  });

  // ── Min-Duration Enforcement ───────────────────────────────────────

  it('minDuration prevents premature close', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 100,
      maxDuration: 10000,
      minDuration: 200, // minDuration > minQuiescence for this test
    });

    win.arm();

    // Advance past minQuiescence (100ms) but NOT past minDuration (200ms)
    advance(110);
    expect(win.getIsOpen()).toBe(true);

    // Advance to past minDuration
    advance(100);
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('stabilized');
  });

  // ── End Reasons ────────────────────────────────────────────────────

  it('close("recording-stopped") works immediately', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    win.close('recording-stopped');

    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('recording-stopped');
  });

  it('close("displaced") works immediately', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    win.close('displaced');

    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('displaced');
  });

  it('close("typing-complete") works', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    win.close('typing-complete');

    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('typing-complete');
  });

  // ── Stability Trace ────────────────────────────────────────────────

  it('stabilityTrace has at least one sample (initial)', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    win.close('recording-stopped');

    expect(result!.stabilityTrace.length).toBeGreaterThanOrEqual(1);
  });

  it('stabilityTrace grows with mutations', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();

    win.recordMutation();
    win.recordMutation();

    win.close('recording-stopped');

    // Should have: initial + 2 mutation samples + final
    expect(result!.stabilityTrace.length).toBeGreaterThanOrEqual(3);
  });

  it('stabilityTrace caps at 50 entries (circular buffer)', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 50,
      maxDuration: 10000,
      minDuration: 10,
    });

    win.arm();

    // Fire 100 mutations to exceed the 50 cap
    for (let i = 0; i < 100; i++) {
      advance(5);
      win.recordMutation();
    }

    win.close('recording-stopped');

    expect(result!.stabilityTrace.length).toBeLessThanOrEqual(50);
  });

  it('stabilityTrace samples have timestamp, msSinceLastMutation, globalBatchCount', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    win.recordMutation();
    win.close('recording-stopped');

    for (const sample of result!.stabilityTrace) {
      expect(sample.timestamp).toBeGreaterThanOrEqual(0);
      expect(typeof sample.msSinceLastMutation).toBe('number');
      expect(typeof sample.globalBatchCount).toBe('number');
    }
  });

  // ── EvidenceWindow Output ──────────────────────────────────────────

  it('EvidenceWindow has correct durationMs', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    advance(350); // close via stabilization

    expect(result).not.toBeNull();
    expect(result!.durationMs).toBeGreaterThanOrEqual(50);
    expect(result!.durationMs).toBeLessThanOrEqual(400);
  });

  it('EvidenceWindow has openedAt and closedAt timestamps', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 100,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    advance(110);

    expect(result).not.toBeNull();
    expect(result!.openedAt).toBeGreaterThanOrEqual(0);
    expect(result!.closedAt).toBeGreaterThanOrEqual(result!.openedAt);
  });

  // ── Double-close safety ────────────────────────────────────────────

  it('double close() does not fire callback twice', () => {
    let closeCount = 0;
    const win = new AdaptiveWindow({
      onClose: () => { closeCount++; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });

    win.arm();
    win.close('recording-stopped');
    win.close('recording-stopped'); // second close

    expect(closeCount).toBe(1);
  });

  // ── recordMutation before arm ──────────────────────────────────────

  it('recordMutation() before arm() does not crash', () => {
    const win = new AdaptiveWindow({
      onClose: () => {},
    });

    expect(() => win.recordMutation()).not.toThrow();
  });

  // ── Default parameter values ───────────────────────────────────────

  it('uses default parameters when none provided', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
    });

    win.arm();
    // Default minQuiescence=300, minDuration=50
    advance(301);

    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('stabilized');
  });

  // ── TD-8: holdOpen + max-duration ──────────────────────────────────

  it('TD-8: holdOpen=true set BEFORE arm() prevents max-duration timer', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 1000, // short — if timer fires, test fails
      minDuration: 50,
    });

    win.setHoldOpen(true);
    win.arm();

    // Advance well past maxDuration
    advance(2000);

    // Window should still be open — max-duration timer was never scheduled
    expect(result).toBeNull();
    expect(win.getIsOpen()).toBe(true);

    // Explicit close works
    win.close('lifecycle-complete');
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('lifecycle-complete');
  });

  it('TD-8: holdOpen=true set AFTER arm() clears running max-duration timer', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 1000,
      minDuration: 50,
    });

    win.arm(); // schedules max-duration timer for T=1000ms

    // Simulate LIFECYCLE_BOUND arriving shortly after arm
    advance(100);
    win.setHoldOpen(true); // should clear the max-duration timer

    // Continuously fire mutations (typing)
    for (let i = 0; i < 20; i++) {
      advance(100);
      win.recordMutation();
    }

    // Total elapsed = 100 + 2000 = 2100ms > maxDuration(1000)
    // Window should still be open
    expect(result).toBeNull();
    expect(win.getIsOpen()).toBe(true);
  });

  it('TD-8: holdOpen=true with recordMutation does not schedule max-duration', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 500,
      minDuration: 50,
    });

    win.arm();
    advance(50);
    win.setHoldOpen(true);

    // Fire mutations well past maxDuration
    for (let i = 0; i < 10; i++) {
      advance(100);
      win.recordMutation();
    }

    // Total elapsed = 50 + 1000 = 1050ms > maxDuration(500)
    expect(result).toBeNull();
    expect(win.getIsOpen()).toBe(true);
  });

  it('TD-8: non-holdOpen window still closes on max-duration (M3 behavior preserved)', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 1000,
      minDuration: 50,
    });

    win.arm();

    // Fire mutations to prevent stabilization
    for (let i = 0; i < 20; i++) {
      advance(50);
      win.recordMutation();
    }

    // Total = 1000ms = maxDuration → should close
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('max-duration');
  });

  it('TD-8: setHoldOpen(false) after setHoldOpen(true) allows max-duration to resume', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 1000,
      minDuration: 50,
    });

    win.setHoldOpen(true);
    win.arm();
    advance(500);

    // Disable holdOpen — window should eventually close
    win.setHoldOpen(false);

    // Fire mutations to prevent stabilization
    for (let i = 0; i < 10; i++) {
      advance(50);
      win.recordMutation();
    }

    // advance past stabilization quiescence
    advance(350);

    // Should close via stabilization (holdOpen was removed)
    expect(result).not.toBeNull();
  });
});

// ── Phase 3 Fix A: stabilization re-arm at settle entry ───────────────
// Real-Chrome S1/S4 RCA: enterSettleMode releases holdOpen, but if the DOM
// is already quiescent no stabilization timer is running (the last one fired
// long before FINALIZE arrived). Without a re-arm, checkStabilized() never
// runs again — the window parks until the 10s cap or a later mutation.
// settleEntry() must (re)arm the quiescence loop so quiescence is measured
// from SETTLE ENTRY, not from open.
describe('AdaptiveWindow — settle entry (Phase 3 Fix A)', () => {
  let mockNow = 0;

  beforeEach(() => {
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  it('re-arms stabilization at settle entry when DOM is already quiet (closes at entry+quiescence)', () => {
    const ends: string[] = [];
    const win = new AdaptiveWindow({
      onClose: (w) => ends.push(w.endReason),
    });
    win.setHoldOpen(true);
    win.arm();
    advance(150); // FINALIZE arrives; DOM quiet since open

    win.settleEntry(); // settle-mode transition (Fix A)

    advance(250);
    expect(ends).toEqual([]); // quiescence not yet elapsed from settle entry
    advance(100); // entry+300 + minDuration → stabilized
    expect(ends).toEqual(['stabilized']);
  });

  it('a mutation after settle entry resets quiescence — close is delayed until it settles', () => {
    const ends: string[] = [];
    const win = new AdaptiveWindow({
      onClose: (w) => ends.push(w.endReason),
    });
    win.setHoldOpen(true);
    win.arm();
    advance(150);
    win.settleEntry();

    advance(250);
    win.recordMutation(); // delayed consequence at entry+250
    advance(200);
    expect(ends).toEqual([]); // still within re-armed quiescence
    advance(150); // mutation+300
    expect(ends).toEqual(['stabilized']);
  });

  it('settleEntry keeps the causal close gate: canClose=false defers the close and re-arms', () => {
    const ends: string[] = [];
    const win = new AdaptiveWindow({
      onClose: (w) => ends.push(w.endReason),
    });
    win.setHoldOpen(true);
    win.arm();
    advance(150);
    let gate = false;
    win.settleEntry(() => gate); // gate consulted after entry+300
    advance(400); // quiescence elapsed; gate false → defer + re-arm
    expect(ends).toEqual([]);
    gate = true;
    advance(300); // next cadence consult → close
    expect(ends).toEqual(['stabilized']);
  });

  it('settleEntry is a no-op on an already-closed window', () => {
    const ends: string[] = [];
    const win = new AdaptiveWindow({
      onClose: (w) => ends.push(w.endReason),
    });
    win.arm();
    advance(400); // plain quiescence close
    expect(ends).toEqual(['stabilized']);
    win.settleEntry(() => true);
    expect(ends).toEqual(['stabilized']); // no double close
  });

  it('max-duration cap measured from OPEN still bounds a settle-mode window', () => {
    const ends: string[] = [];
    const win = new AdaptiveWindow({
      onClose: (w) => ends.push(w.endReason),
      maxDuration: 500,
    });
    win.setHoldOpen(true);
    win.arm();
    advance(150);
    win.settleEntry(() => false); // never network-idle
    advance(1000);
    expect(ends).toEqual(['max-duration']);
  });
});
