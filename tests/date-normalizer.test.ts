/**
 * Date Normalizer — Unit Tests
 *
 * Tests for src/shared/date-normalizer.ts
 *
 * Key principle: do NOT silently correct invalid dates by swapping day/month.
 * If a value is ambiguous or invalid, preserve the raw value and flag it.
 */

import { describe, it, expect } from 'vitest';
import { normalizeDateValue, isoToDisplay } from '../src/shared/date-normalizer';
import type { NormalizedDate } from '../src/shared/date-normalizer';

// Helper: assert common fields without repeating boilerplate
function assertNormalized(
  result: NormalizedDate,
  expected: Partial<NormalizedDate>,
) {
  for (const [key, value] of Object.entries(expected)) {
    expect(result[key as keyof NormalizedDate]).toBe(value);
  }
}

describe('normalizeDateValue', () => {
  // ── ISO 8601 (native HTML5 date input) ──────────────────────────

  describe('ISO 8601 dates', () => {
    it('parses valid ISO date yyyy-MM-dd', () => {
      const result = normalizeDateValue('2026-07-15');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        displayValue: 'July 15, 2026',
        dateType: 'date',
        confidence: 1.0,
        ambiguous: false,
        rawValue: '2026-07-15',
      });
    });

    it('parses valid ISO datetime yyyy-MM-ddTHH:mm', () => {
      const result = normalizeDateValue('2026-07-15T14:30');
      assertNormalized(result, {
        isoValue: '2026-07-15T14:30',
        displayValue: 'July 15, 2026, 14:30',
        dateType: 'dateTime',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('rejects invalid ISO date (Feb 30)', () => {
      const result = normalizeDateValue('2026-02-30');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
        rawValue: '2026-02-30',
      });
      expect(result.warning).toContain('Invalid ISO date');
    });

    it('rejects invalid ISO date (month 13)', () => {
      const result = normalizeDateValue('2026-13-15');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });

    it('handles ISO date with day 31 in a 30-day month', () => {
      const result = normalizeDateValue('2026-04-31');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });

    it('accepts leap day in leap year', () => {
      const result = normalizeDateValue('2024-02-29');
      assertNormalized(result, {
        isoValue: '2024-02-29',
        displayValue: 'February 29, 2024',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('rejects leap day in non-leap year', () => {
      const result = normalizeDateValue('2023-02-29');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });
  });

  // ── Time values ──────────────────────────────────────────────────

  describe('time values', () => {
    it('parses HH:mm', () => {
      const result = normalizeDateValue('14:30');
      assertNormalized(result, {
        isoValue: '14:30',
        displayValue: '14:30',
        dateType: 'time',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('parses HH:mm:ss', () => {
      const result = normalizeDateValue('14:30:45');
      assertNormalized(result, {
        isoValue: '14:30:45',
        dateType: 'time',
        confidence: 1.0,
      });
    });

    it('rejects invalid hour (25:00)', () => {
      const result = normalizeDateValue('25:00');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });

    it('rejects invalid minute (14:60)', () => {
      const result = normalizeDateValue('14:60');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });

    it('uses hint inputType=time for bare numbers', () => {
      const result = normalizeDateValue('09:30', { inputType: 'time' });
      assertNormalized(result, {
        isoValue: '09:30',
        dateType: 'time',
        confidence: 1.0,
      });
    });
  });

  // ── Month values ─────────────────────────────────────────────────

  describe('month values', () => {
    it('parses yyyy-MM', () => {
      const result = normalizeDateValue('2026-07');
      assertNormalized(result, {
        isoValue: '2026-07',
        displayValue: 'July 2026',
        dateType: 'month',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('rejects invalid month (2026-13)', () => {
      const result = normalizeDateValue('2026-13');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });

    it('uses hint inputType=month', () => {
      const result = normalizeDateValue('2026-03', { inputType: 'month' });
      assertNormalized(result, {
        dateType: 'month',
        confidence: 1.0,
      });
    });
  });

  // ── Week values ───────────────────────────────────────────────────

  describe('week values', () => {
    it('parses yyyy-Www', () => {
      const result = normalizeDateValue('2026-W03');
      assertNormalized(result, {
        isoValue: '2026-W03',
        displayValue: 'Week 3, 2026',
        dateType: 'week',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('rejects invalid week (W54)', () => {
      const result = normalizeDateValue('2026-W54');
      assertNormalized(result, {
        isoValue: '',
        ambiguous: true,
        confidence: 0,
      });
    });
  });

  // ── Display format with month names ───────────────────────────────

  describe('display format dates', () => {
    it('parses "July 15, 2026"', () => {
      const result = normalizeDateValue('July 15, 2026');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        displayValue: 'July 15, 2026',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('parses "15 July 2026"', () => {
      const result = normalizeDateValue('15 July 2026');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('parses "Jul 15, 2026" (abbreviated)', () => {
      const result = normalizeDateValue('Jul 15, 2026');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
      });
    });

    it('parses "15-Jul-2026" (dash separated)', () => {
      const result = normalizeDateValue('15-Jul-2026');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
      });
    });

    it('parses "September 19, 1987"', () => {
      const result = normalizeDateValue('September 19, 1987');
      assertNormalized(result, {
        isoValue: '1987-09-19',
        displayValue: 'September 19, 1987',
        confidence: 1.0,
      });
    });
  });

  // ── Aria-label strings (from calendar grid cells) ────────────────

  describe('aria-label strings', () => {
    it('strips weekday and parses "Monday, July 15, 2026"', () => {
      const result = normalizeDateValue('Monday, July 15, 2026');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('strips weekday and parses "Tue, 15 July 2026"', () => {
      const result = normalizeDateValue('Tue, 15 July 2026');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
      });
    });

    it('strips weekday and parses "Friday, September 19, 1987"', () => {
      const result = normalizeDateValue('Friday, September 19, 1987');
      assertNormalized(result, {
        isoValue: '1987-09-19',
        confidence: 1.0,
      });
    });
  });

  // ── Numeric dates with separators ────────────────────────────────

  describe('numeric dates', () => {
    it('parses unambiguous mm/dd/yyyy (07/15/2026)', () => {
      const result = normalizeDateValue('07/15/2026');
      // 15 > 12 → only valid interpretation is mm/dd/yyyy
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('parses unambiguous dd/mm/yyyy (15/07/2026)', () => {
      const result = normalizeDateValue('15/07/2026');
      // 15 > 12 → only valid interpretation is dd/mm/yyyy
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
        ambiguous: false,
      });
    });

    it('flags ambiguous 05/06/2026 (could be May 6 or June 5)', () => {
      const result = normalizeDateValue('05/06/2026');
      assertNormalized(result, {
        confidence: 0.5,
        ambiguous: true,
      });
      expect(result.warning).toContain('Ambiguous');
      // Should still produce a best-guess ISO
      expect(result.isoValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('parses 2-digit year 07/15/26 as 2026', () => {
      const result = normalizeDateValue('07/15/26');
      assertNormalized(result, {
        isoValue: '2026-07-15',
        confidence: 1.0,
      });
    });
  });

  // ── The user's specific bug cases ────────────────────────────────

  describe('real-world malformed values (from OrangeHRM)', () => {
    it('"1998-15-05" — month 15 is impossible, flagged ambiguous (NOT swapped)', () => {
      const result = normalizeDateValue('1998-15-05');
      // This looks like ISO format yyyy-MM-dd but month 15 is invalid
      // We should NOT silently swap to 1998-05-15
      // It should be flagged as ambiguous/invalid
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.ambiguous).toBe(true);
      expect(result.rawValue).toBe('1998-15-05');
    });

    it('"1987-19-08" — month 19 is impossible, flagged ambiguous (NOT swapped)', () => {
      const result = normalizeDateValue('1987-19-08');
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.ambiguous).toBe(true);
      expect(result.rawValue).toBe('1987-19-08');
    });

    it('preserves raw value when unparseable', () => {
      const result = normalizeDateValue('not-a-date');
      assertNormalized(result, {
        isoValue: '',
        displayValue: 'not-a-date',
        ambiguous: true,
        confidence: 0,
        rawValue: 'not-a-date',
      });
      expect(result.warning).toContain('Could not parse');
    });
  });

  // ── Empty / edge cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = normalizeDateValue('');
      assertNormalized(result, {
        isoValue: '',
        displayValue: '',
        confidence: 0,
        ambiguous: false,
      });
    });

    it('handles null/undefined input', () => {
      const result = normalizeDateValue(null as unknown as string);
      assertNormalized(result, {
        isoValue: '',
        confidence: 0,
      });
    });

    it('handles whitespace-only input', () => {
      const result = normalizeDateValue('   ');
      assertNormalized(result, {
        isoValue: '',
        confidence: 0,
      });
    });

    it('uses inputType hint for date type inference', () => {
      const result = normalizeDateValue('2026-07-15', { inputType: 'date' });
      assertNormalized(result, { dateType: 'date', confidence: 1.0 });
    });

    it('uses inputType hint for datetime-local', () => {
      const result = normalizeDateValue('2026-07-15T14:30', { inputType: 'datetime-local' });
      assertNormalized(result, { dateType: 'dateTime', confidence: 1.0 });
    });

    it('uses dateFormat hint is accepted without error', () => {
      const result = normalizeDateValue('2026-07-15', { dateFormat: 'yyyy-MM-dd' });
      assertNormalized(result, { confidence: 1.0 });
    });
  });

  // ── Date type inference from value patterns ──────────────────────

  describe('date type inference', () => {
    it('infers time from HH:mm pattern', () => {
      const result = normalizeDateValue('14:30');
      expect(result.dateType).toBe('time');
    });

    it('infers month from yyyy-MM pattern', () => {
      const result = normalizeDateValue('2026-07');
      expect(result.dateType).toBe('month');
    });

    it('infers week from yyyy-Www pattern', () => {
      const result = normalizeDateValue('2026-W03');
      expect(result.dateType).toBe('week');
    });

    it('defaults to date for yyyy-MM-dd', () => {
      const result = normalizeDateValue('2026-07-15');
      expect(result.dateType).toBe('date');
    });

    it('infers dateTime from yyyy-MM-ddTHH:mm', () => {
      const result = normalizeDateValue('2026-07-15T14:30');
      expect(result.dateType).toBe('dateTime');
    });
  });
});

// ── isoToDisplay ─────────────────────────────────────────────────────

describe('isoToDisplay', () => {
  it('converts ISO date to display', () => {
    expect(isoToDisplay('2026-07-15')).toBe('July 15, 2026');
  });

  it('converts ISO datetime to display', () => {
    expect(isoToDisplay('2026-07-15T14:30', 'dateTime')).toBe('July 15, 2026, 14:30');
  });

  it('converts ISO month to display', () => {
    expect(isoToDisplay('2026-07', 'month')).toBe('July 2026');
  });

  it('returns time unchanged', () => {
    expect(isoToDisplay('14:30', 'time')).toBe('14:30');
  });

  it('returns week unchanged', () => {
    expect(isoToDisplay('2026-W03', 'week')).toBe('2026-W03');
  });

  it('returns empty string for empty input', () => {
    expect(isoToDisplay('')).toBe('');
  });

  it('returns input unchanged for non-ISO format', () => {
    expect(isoToDisplay('not-a-date')).toBe('not-a-date');
  });
});
