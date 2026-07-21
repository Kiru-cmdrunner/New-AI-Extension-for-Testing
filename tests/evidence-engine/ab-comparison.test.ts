/**
 * A/B Comparison Utility Tests
 *
 * Tests the extracted comparison utility that compares V1 (existing classifier)
 * with V2 (Evidence Engine) outputs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compareClassifierOutputs,
  logComparisonResult,
  type ComparisonResult,
} from '../../src/classifier/evidence/ab-comparison.ts';

// ── compareClassifierOutputs ────────────────────────────────────────────

describe('compareClassifierOutputs', () => {
  it('returns agree=true when both outputs are identical', () => {
    const v1 = [
      { type: 'Click', eventIds: ['evt-1'] },
      { type: 'Checkbox', eventIds: ['evt-2', 'evt-3'] },
    ];
    const v2 = [
      { type: 'Click', eventIds: ['evt-1'] },
      { type: 'Checkbox', eventIds: ['evt-2', 'evt-3'] },
    ];

    const result = compareClassifierOutputs(v1, v2);
    expect(result.agree).toBe(true);
    expect(result.v1Count).toBe(2);
    const typedResult: ComparisonResult = result;
    expect(typedResult.v2Count).toBe(2);
    expect(result.differences).toHaveLength(0);
  });

  it('returns agree=false when types differ', () => {
    const v1 = [{ type: 'Click', eventIds: ['evt-1'] }];
    const v2 = [{ type: 'Checkbox', eventIds: ['evt-1'] }];

    const result = compareClassifierOutputs(v1, v2);
    expect(result.agree).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toEqual({
      index: 0,
      v1Type: 'Click',
      v2Type: 'Checkbox',
      v1EventCount: 1,
      v2EventCount: 1,
    });
  });

  it('returns agree=false when counts differ', () => {
    const v1 = [
      { type: 'Click', eventIds: ['evt-1'] },
      { type: 'Click', eventIds: ['evt-2'] },
    ];
    const v2 = [{ type: 'Click', eventIds: ['evt-1'] }];

    const result = compareClassifierOutputs(v1, v2);
    expect(result.agree).toBe(false);
    expect(result.v1Count).toBe(2);
    const typedResult: ComparisonResult = result;
    expect(typedResult.v2Count).toBe(1);
    // Difference at index 1: V1 has Click(1 evt), V2 has nothing
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0].index).toBe(1);
    expect(result.differences[0].v1Type).toBe('Click');
    expect(result.differences[0].v2Type).toBe('—');
  });

  it('returns agree=false when event counts differ for same type', () => {
    const v1 = [{ type: 'Checkbox', eventIds: ['evt-1', 'evt-2', 'evt-3'] }];
    const v2 = [{ type: 'Checkbox', eventIds: ['evt-1'] }];

    const result = compareClassifierOutputs(v1, v2);
    expect(result.agree).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0].v1EventCount).toBe(3);
    expect(result.differences[0].v2EventCount).toBe(1);
  });

  it('handles both empty arrays', () => {
    const result = compareClassifierOutputs([], []);
    expect(result.agree).toBe(true);
    expect(result.v1Count).toBe(0);
    const typedResult: ComparisonResult = result;
    expect(typedResult.v2Count).toBe(0);
    expect(result.differences).toHaveLength(0);
  });

  it('handles V2 having more interactions than V1', () => {
    const v1 = [{ type: 'Click', eventIds: ['evt-1'] }];
    const v2 = [
      { type: 'Click', eventIds: ['evt-1'] },
      { type: 'TextEntry', eventIds: ['evt-2', 'evt-3'] },
    ];

    const result = compareClassifierOutputs(v1, v2);
    expect(result.agree).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0].index).toBe(1);
    expect(result.differences[0].v1Type).toBe('—');
    expect(result.differences[0].v2Type).toBe('TextEntry');
  });

  it('handles multiple differences in a long sequence', () => {
    const v1 = [
      { type: 'Click', eventIds: ['e1'] },
      { type: 'Checkbox', eventIds: ['e2'] },
      { type: 'Click', eventIds: ['e3'] },
      { type: 'RadioButton', eventIds: ['e4'] },
    ];
    const v2 = [
      { type: 'Click', eventIds: ['e1'] },
      { type: 'Click', eventIds: ['e2'] }, // different type
      { type: 'Click', eventIds: ['e3'] },
      { type: 'RadioButton', eventIds: ['e4'] },
      { type: 'TextEntry', eventIds: ['e5', 'e6'] }, // extra
    ];

    const result = compareClassifierOutputs(v1, v2);
    expect(result.agree).toBe(false);
    expect(result.differences).toHaveLength(2);
    expect(result.differences[0].index).toBe(1);
    expect(result.differences[1].index).toBe(4);
  });
});

// ── logComparisonResult ─────────────────────────────────────────────────

describe('logComparisonResult', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('logs agreement with console.log', () => {
    logComparisonResult({
      agree: true,
      v1Count: 3,
      v2Count: 3,
      differences: [],
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('V1 and V2 agree: 3 interactions'),
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('logs disagreement with console.warn', () => {
    logComparisonResult({
      agree: false,
      v1Count: 2,
      v2Count: 3,
      differences: [
        { index: 1, v1Type: 'Click', v2Type: 'Checkbox', v1EventCount: 1, v2EventCount: 2 },
      ],
    });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Classifier disagreement: V1=2 vs V2=3'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('#1: V1=Click(1 evts) vs V2=Checkbox(2 evts)'),
    );
  });

  it('does nothing when both counts are zero', () => {
    logComparisonResult({
      agree: true,
      v1Count: 0,
      v2Count: 0,
      differences: [],
    });

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('logs each difference separately', () => {
    logComparisonResult({
      agree: false,
      v1Count: 3,
      v2Count: 3,
      differences: [
        { index: 0, v1Type: 'Click', v2Type: 'Unknown', v1EventCount: 1, v2EventCount: 1 },
        { index: 2, v1Type: 'Link', v2Type: 'Click', v1EventCount: 1, v2EventCount: 1 },
      ],
    });

    // One call for the summary + two calls for the differences
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});
