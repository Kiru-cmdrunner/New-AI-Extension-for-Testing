/**
 * Date Normalizer — Shared utility for parsing, validating, and normalizing
 * date/time values captured from web form controls.
 *
 * Design principle: **Capture the final committed value, do not silently
 * correct invalid dates.** If a value cannot be confidently parsed to ISO,
 * preserve the raw value and flag it as ambiguous rather than guessing.
 *
 * Used by:
 *   - Recorder (content script) — normalize values before emitting dateSelect events
 *   - Classifier (service worker) — normalize values from metadata
 *   - IR Bridge — extract ISO value for execution, display value for description
 *
 * Supported input formats:
 *   - ISO 8601:            "2026-07-15", "2026-07-15T14:30", "14:30", "2026-07"
 *   - Display (long):       "July 15, 2026", "15 July 2026", "15-Jul-2026"
 *   - Display (numeric):   "07/15/2026", "15/07/2026", "07-15-2026", "15-07-2026"
 *   - Aria-label strings:  "Monday, July 15, 2026" (extras stripped, date extracted)
 *   - Partial / invalid:   preserved with confidence < 1.0
 */

// ── Types ─────────────────────────────────────────────────────────────

export type DateType = 'date' | 'time' | 'dateTime' | 'month' | 'week';

export interface NormalizedDate {
  /** ISO 8601 value for execution. Empty string if unparseable. */
  isoValue: string;
  /** Human-readable display value for UI and descriptions. */
  displayValue: string;
  /** Date sub-type. */
  dateType: DateType;
  /** Confidence: 1.0 = confident, 0.5 = ambiguous, 0 = unparseable. */
  confidence: number;
  /** True if the raw value could not be confidently parsed. */
  ambiguous: boolean;
  /** The original raw value, preserved for audit. */
  rawValue: string;
  /** Warning message if parsing was uncertain. */
  warning?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_PREFIXES = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[,\s]+/i;

// ── Helpers ───────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

function buildIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function buildDisplayDate(year: number, month: number, day: number): string {
  return `${MONTH_NAMES[month]} ${day}, ${year}`;
}

/**
 * Parse a numeric date string with separators (/ - or .).
 * Does NOT assume month-first or day-first — returns all valid interpretations.
 */
function parseNumericDate(raw: string): Array<{ year: number; month: number; day: number }> {
  const match = raw.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (!match) return [];

  const [, p1, p2, p3] = match;
  const a = parseInt(p1, 10);
  const b = parseInt(p2, 10);
  const c = parseInt(p3, 10);

  const results: Array<{ year: number; month: number; day: number }> = [];

  // 4-digit year first (yyyy-mm-dd or yyyy/dd/mm)
  if (a >= 1000) {
    if (isValidDate(a, b, c)) results.push({ year: a, month: b, day: c });
    if (results.length === 0 && isValidDate(a, c, b)) {
      results.push({ year: a, month: c, day: b });
    }
    return results;
  }

  // 4-digit year last (mm/dd/yyyy or dd/mm/yyyy)
  if (c >= 1000) {
    const year = c;
    // mm/dd/yyyy
    if (isValidDate(year, a, b)) results.push({ year, month: a, day: b });
    // dd/mm/yyyy
    if (isValidDate(year, b, a)) results.push({ year, month: b, day: a });
    return results;
  }

  // All 2-digit parts — try all orderings
  if (p1.length <= 2 && p2.length <= 2 && p3.length <= 2) {
    // Try each position as the year
    for (const [ya, yb, yc] of [[a, b, c], [c, a, b], [c, b, a]]) {
      const year = 2000 + ya;
      if (isValidDate(year, yb, yc)) {
        results.push({ year, month: yb, day: yc });
      }
    }
    return results;
  }

  return results;
}

/**
 * Parse a display-format date string with month names.
 * Handles: "July 15, 2026", "15 July 2026", "Jul 15, 2026"
 */
function parseDisplayDate(raw: string): { year: number; month: number; day: number } | null {
  // "July 15, 2026" or "Jul 15, 2026"
  let m = raw.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) {
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      if (isValidDate(year, month, day)) return { year, month, day };
    }
  }

  // "15 July 2026" or "15-Jul-2026"
  m = raw.match(/^(\d{1,2})[-\s]+(\w+)[-\s]+(\d{4})$/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = MONTHS[m[2].toLowerCase()];
    if (month) {
      const year = parseInt(m[3], 10);
      if (isValidDate(year, month, day)) return { year, month, day };
    }
  }

  return null;
}

/**
 * Strip leading weekday from aria-label strings like
 * "Monday, July 15, 2026" → "July 15, 2026"
 */
function stripWeekday(raw: string): string {
  return raw.replace(WEEKDAY_PREFIXES, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Normalize a raw date value to ISO + display format.
 *
 * Per the user's requirement: does NOT silently correct invalid dates by
 * swapping day/month. If the value is ambiguous or invalid, preserves the
 * raw value and flags it with `ambiguous: true` and reduced confidence.
 *
 * @param rawValue - The raw value from the DOM (el.value, aria-label, etc.)
 * @param hints   - Optional hints to disambiguate
 * @param hints.inputType - The input type attribute (e.g. 'date', 'time')
 * @param hints.dateFormat - Expected format hint (e.g. 'yyyy-MM-dd')
 */
export function normalizeDateValue(
  rawValue: string,
  hints?: { inputType?: string; dateFormat?: string },
): NormalizedDate {
  const raw = (rawValue ?? '').trim();
  const dateType = inferDateType(hints?.inputType, raw);

  // Empty
  if (!raw) {
    return {
      isoValue: '',
      displayValue: '',
      dateType,
      confidence: 0,
      ambiguous: false,
      rawValue: raw,
    };
  }

  // ── Time only (HH:mm or HH:mm:ss) ──────────────────────────────
  if (dateType === 'time' || /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const s = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59) {
        const iso = `${pad2(h)}:${pad2(m)}${s > 0 ? ':' + pad2(s) : ''}`;
        return {
          isoValue: iso,
          displayValue: iso,
          dateType: 'time',
          confidence: 1.0,
          ambiguous: false,
          rawValue: raw,
        };
      }
    }
  }

  // ── Month only (yyyy-MM) ──────────────────────────────────────
  if (dateType === 'month' || /^\d{4}-\d{2}$/.test(raw)) {
    const m = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      if (month >= 1 && month <= 12) {
        return {
          isoValue: `${year}-${pad2(month)}`,
          displayValue: `${MONTH_NAMES[month]} ${year}`,
          dateType: 'month',
          confidence: 1.0,
          ambiguous: false,
          rawValue: raw,
        };
      }
    }
  }

  // ── Week (yyyy-Www) ────────────────────────────────────────────
  if (dateType === 'week' || /^\d{4}-W\d{1,2}$/.test(raw)) {
    const m = raw.match(/^(\d{4})-W(\d{1,2})$/);
    if (m) {
      const week = parseInt(m[2], 10);
      if (week >= 1 && week <= 53) {
        return {
          isoValue: raw,
          displayValue: `Week ${week}, ${m[1]}`,
          dateType: 'week',
          confidence: 1.0,
          ambiguous: false,
          rawValue: raw,
        };
      }
    }
  }

  // ── ISO 8601 date (yyyy-MM-dd) ────────────────────────────────
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (isValidDate(year, month, day)) {
      return {
        isoValue: raw,
        displayValue: buildDisplayDate(year, month, day),
        dateType: 'date',
        confidence: 1.0,
        ambiguous: false,
        rawValue: raw,
      };
    }
    // ISO format but invalid date (e.g. 2026-02-30)
    return {
      isoValue: '',
      displayValue: raw,
      dateType,
      confidence: 0,
      ambiguous: true,
      rawValue: raw,
      warning: `Invalid ISO date: ${raw} (day ${day} is not valid for month ${month})`,
    };
  }

  // ── ISO 8601 datetime (yyyy-MM-ddTHH:mm) ──────────────────────
  const dtMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/);
  if (dtMatch) {
    const year = parseInt(dtMatch[1], 10);
    const month = parseInt(dtMatch[2], 10);
    const day = parseInt(dtMatch[3], 10);
    const h = parseInt(dtMatch[4], 10);
    const mi = parseInt(dtMatch[5], 10);
    if (isValidDate(year, month, day) && h <= 23 && mi <= 59) {
      const iso = `${buildIsoDate(year, month, day)}T${pad2(h)}:${pad2(mi)}`;
      const display = `${buildDisplayDate(year, month, day)}, ${pad2(h)}:${pad2(mi)}`;
      return {
        isoValue: iso,
        displayValue: display,
        dateType: 'dateTime',
        confidence: 1.0,
        ambiguous: false,
        rawValue: raw,
      };
    }
  }

  // ── Strip weekday prefix (from aria-label) ────────────────────
  const stripped = stripWeekday(raw);

  // ── Display format with month names ────────────────────────────
  const displayParsed = parseDisplayDate(stripped);
  if (displayParsed) {
    const { year, month, day } = displayParsed;
    return {
      isoValue: buildIsoDate(year, month, day),
      displayValue: buildDisplayDate(year, month, day),
      dateType: 'date',
      confidence: 1.0,
      ambiguous: false,
      rawValue: raw,
    };
  }

  // ── Numeric date with separators ──────────────────────────────
  const numericResults = parseNumericDate(stripped);
  if (numericResults.length === 1) {
    // Unambiguous
    const { year, month, day } = numericResults[0];
    return {
      isoValue: buildIsoDate(year, month, day),
      displayValue: buildDisplayDate(year, month, day),
      dateType: 'date',
      confidence: 1.0,
      ambiguous: false,
      rawValue: raw,
    };
  }
  if (numericResults.length > 1) {
    // Ambiguous — multiple valid interpretations
    // Pick the first but flag as ambiguous
    const { year, month, day } = numericResults[0];
    return {
      isoValue: buildIsoDate(year, month, day),
      displayValue: buildDisplayDate(year, month, day),
      dateType: 'date',
      confidence: 0.5,
      ambiguous: true,
      rawValue: raw,
      warning: `Ambiguous date format: "${raw}" could be ${numericResults.map(r => buildIsoDate(r.year, r.month, r.day)).join(' or ')}`,
    };
  }

  // ── Unparseable — preserve raw value ──────────────────────────
  return {
    isoValue: '',
    displayValue: raw,
    dateType,
    confidence: 0,
    ambiguous: true,
    rawValue: raw,
    warning: `Could not parse date value: "${raw}"`,
  };
}

/**
 * Infer the date type from input type attribute or value patterns.
 */
function inferDateType(inputType?: string, rawValue?: string): DateType {
  if (inputType) {
    switch (inputType) {
      case 'date': return 'date';
      case 'datetime-local': return 'dateTime';
      case 'time': return 'time';
      case 'month': return 'month';
      case 'week': return 'week';
    }
  }
  // Infer from value
  if (rawValue) {
    if (/^\d{1,2}:\d{2}/.test(rawValue)) return 'time';
    if (/^\d{4}-\d{2}$/.test(rawValue)) return 'month';
    if (/^\d{4}-W\d{1,2}$/.test(rawValue)) return 'week';
    if (/T\d{1,2}:\d{2}/.test(rawValue)) return 'dateTime';
  }
  return 'date';
}

/**
 * Convenience: format an ISO date value to a display string.
 * Returns the input unchanged if it doesn't match ISO date format.
 */
export function isoToDisplay(isoValue: string, dateType: DateType = 'date'): string {
  if (!isoValue) return '';

  switch (dateType) {
    case 'date': {
      const m = isoValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        const day = parseInt(m[3], 10);
        return buildDisplayDate(year, month, day);
      }
      return isoValue;
    }
    case 'dateTime': {
      const m = isoValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/);
      if (m) {
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        const day = parseInt(m[3], 10);
        const h = parseInt(m[4], 10);
        const mi = parseInt(m[5], 10);
        return `${buildDisplayDate(year, month, day)}, ${pad2(h)}:${pad2(mi)}`;
      }
      return isoValue;
    }
    case 'time':
      return isoValue;
    case 'month': {
      const m = isoValue.match(/^(\d{4})-(\d{2})$/);
      if (m) {
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        return `${MONTH_NAMES[month]} ${year}`;
      }
      return isoValue;
    }
    case 'week':
      return isoValue;
    default:
      return isoValue;
  }
}
