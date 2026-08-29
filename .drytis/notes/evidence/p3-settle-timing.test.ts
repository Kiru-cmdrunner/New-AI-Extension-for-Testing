// Unit: settle-mode close timing when FINALIZE arrives ~150ms after open
// and NO further DOM mutations occur (the S4 delayed-badge situation).
// Expected per design: window closes at quiescence after settle entry,
// i.e. ~150+300 = 450ms, BEFORE a 600ms delayed consequence lands.
import { describe, it, expect, vi } from 'vitest';
import { AdaptiveWindow } from '../../../src/tap/adaptive-window';

describe('settle-mode timing (S4 semantics)', () => {
  it('closes at quiescence after settle entry, before a 600ms-late consequence', () => {
    vi.useFakeTimers();
    const closes: string[] = [];
    const w = new AdaptiveWindow({
      onClose: (ew) => closes.push(ew.endReason),
    });
    w.arm();
    // lifecycle-bound: hold open
    w.setHoldOpen(true);
    // FINALIZE at ~150ms
    vi.advanceTimersByTime(150);
    // settle-mode transition
    w.setHoldOpen(false);
    w.setCanClose(() => true);
    // 600ms delayed consequence (would mutate DOM now)
    vi.advanceTimersByTime(600);
    expect(closes).toEqual(['stabilized']);
    expect(closes[0]).toBe('stabilized');
    vi.useRealTimers();
  });
});
