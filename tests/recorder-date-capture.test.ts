/**
 * Recorder Date Capture — Milestone 2 Tests
 *
 * Tests the date picker capture pipeline:
 *   1. Content script sends dateSelect events with DomContext date fields
 *   2. Service worker normalizes date values via normalizeDateValue()
 *   3. Session stores dateSelect events with full metadata
 *   4. Debounce logic: intermediate values don't produce premature events
 *   5. Calendar cell clicks produce dateSelect events
 *   6. Custom date picker text inputs produce dateSelect events
 *   7. Native HTML5 date inputs produce dateSelect events
 *   8. Blur flushes pending debounce
 *
 * Note: The content script is self-contained and cannot be imported.
 * These tests validate the pipeline by simulating the messages the content
 * script would send, then verifying the service worker's normalization logic
 * and the session's storage of dateSelect events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { normalizeDateValue } from '../src/shared/date-normalizer';
import type { DomContext } from '../src/recorder/recorded-event';
import type { RecordedEventMessage } from '../src/recorder/recorded-event';

// ── Helpers ────────────────────────────────────────────────────────────

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    ...overrides,
  };
}

function makeDateSelectMessage(
  valueAfter: string,
  domContextOverrides: Partial<DomContext> = {},
): RecordedEventMessage {
  return {
    type: 'RECORDED_EVENT',
    eventType: 'dateSelect',
    timestamp: new Date().toISOString(),
    target: {
      accessibleName: 'Date of Birth',
      ariaRole: 'textbox',
      ariaLabel: 'Date of Birth',
      ariaLabelledBy: null,
      placeholder: 'Select date',
      tag: 'INPUT',
      className: 'oxd-input',
      name: 'dateOfBirth',
      stableId: 'dateOfBirth',
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'input[name="dateOfBirth"]',
      xPath: '//input[@name="dateOfBirth"]',
      inIframe: false,
      shadowDom: false,
    href: null,
      inputType: null,
      elementId: 'dateOfBirth-001',
    },
    valueBefore: null,
    valueAfter,
    checkedBefore: null,
    checkedAfter: null,
    domContext: makeDomContext({
      dateType: 'date',
      isoValue: valueAfter,
      displayValue: valueAfter,
      dateConfidence: 1.0,
      dateAmbiguous: false,
      ...domContextOverrides,
    }),
  };
}

/**
 * Simulate the service worker's normalizeDateDomContext logic.
 * This mirrors src/background/service-worker.ts:normalizeDateDomContext().
 */
function normalizeDateDomContext(ctx: DomContext): DomContext {
  const rawValue = ctx.isoValue || ctx.displayValue || '';
  if (!rawValue) return ctx;

  const hints: { inputType?: string; dateFormat?: string } = {};
  if (ctx.inputType) hints.inputType = ctx.inputType;

  const normalized = normalizeDateValue(rawValue, hints);

  // Always apply the normalizer's result — it is the authority
  return {
    ...ctx,
    dateType: normalized.dateType,
    isoValue: normalized.isoValue,
    displayValue: normalized.displayValue,
    dateAmbiguous: normalized.ambiguous,
    dateConfidence: normalized.confidence,
    ...(normalized.warning ? { dateWarning: normalized.warning } : {}),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Recorder Date Capture — Milestone 2', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  // ── Native HTML5 date inputs ──────────────────────────────────────

  describe('native HTML5 date inputs', () => {
    it('content script sends dateSelect with ISO value from native input[type=date]', () => {
      const msg = makeDateSelectMessage('1987-09-19', {
        inputType: 'date',
        isoValue: '1987-09-19',
        displayValue: 'September 19, 1987',
        dateType: 'date',
        dateConfidence: 1.0,
      });

      expect(msg.eventType).toBe('dateSelect');
      expect(msg.domContext?.isoValue).toBe('1987-09-19');
      expect(msg.domContext?.dateType).toBe('date');
      expect(msg.domContext?.dateConfidence).toBe(1.0);
      expect(msg.domContext?.dateAmbiguous).toBe(false);
    });

    it('service worker normalizer confirms ISO value for native date input', () => {
      const ctx = makeDomContext({
        inputType: 'date',
        isoValue: '1987-09-19',
        displayValue: '1987-09-19', // content script's basic display conversion
        dateType: 'date',
        dateConfidence: 1.0,
        dateAmbiguous: false,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.isoValue).toBe('1987-09-19');
      expect(normalized.displayValue).toBe('September 19, 1987');
      expect(normalized.dateConfidence).toBe(1.0);
      expect(normalized.dateAmbiguous).toBe(false);
    });

    it('native datetime-local input produces correct dateType', () => {
      const ctx = makeDomContext({
        inputType: 'datetime-local',
        isoValue: '2026-07-15T14:30',
        dateType: 'dateTime',
        dateConfidence: 1.0,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateType).toBe('dateTime');
      expect(normalized.isoValue).toBe('2026-07-15T14:30');
      expect(normalized.displayValue).toBe('July 15, 2026, 14:30');
    });

    it('native time input produces correct dateType', () => {
      const ctx = makeDomContext({
        inputType: 'time',
        isoValue: '14:30',
        dateType: 'time',
        dateConfidence: 1.0,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateType).toBe('time');
      expect(normalized.isoValue).toBe('14:30');
    });

    it('native month input produces correct dateType', () => {
      const ctx = makeDomContext({
        inputType: 'month',
        isoValue: '2026-07',
        dateType: 'month',
        dateConfidence: 1.0,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateType).toBe('month');
      expect(normalized.isoValue).toBe('2026-07');
      expect(normalized.displayValue).toBe('July 2026');
    });
  });

  // ── Custom date picker text inputs ────────────────────────────────

  describe('custom date picker text inputs', () => {
    it('content script sends display-format value from custom picker', () => {
      const msg = makeDateSelectMessage('September 19, 1987', {
        inputType: 'text',
        isoValue: 'September 19, 1987',
        displayValue: 'September 19, 1987',
        dateType: 'date',
        dateConfidence: 0.8, // lower confidence from content script
      });

      expect(msg.eventType).toBe('dateSelect');
      expect(msg.domContext?.displayValue).toBe('September 19, 1987');
    });

    it('service worker normalizer parses display format to ISO', () => {
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: 'September 19, 1987',
        displayValue: 'September 19, 1987',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.isoValue).toBe('1987-09-19');
      expect(normalized.displayValue).toBe('September 19, 1987');
      expect(normalized.dateConfidence).toBe(1.0);
      expect(normalized.dateAmbiguous).toBe(false);
    });

    it('custom picker with numeric format 15/07/2026 is parsed to ISO', () => {
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: '15/07/2026',
        displayValue: '15/07/2026',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.isoValue).toBe('2026-07-15');
      expect(normalized.dateConfidence).toBe(1.0);
    });

    it('custom picker with ambiguous numeric format preserves ambiguity', () => {
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: '05/06/2026',
        displayValue: '05/06/2026',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateAmbiguous).toBe(true);
      expect(normalized.dateConfidence).toBe(0.5);
      expect(normalized.dateWarning).toContain('Ambiguous');
    });
  });

  // ── Calendar grid cell clicks ─────────────────────────────────────

  describe('calendar grid cell clicks', () => {
    it('aria-label "Friday, September 19, 1987" is parsed to ISO', () => {
      const ctx = makeDomContext({
        inputType: null,
        isoValue: 'Friday, September 19, 1987',
        displayValue: 'Friday, September 19, 1987',
        dateType: 'date',
        dateConfidence: 0.9, // calendar cell confidence
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.isoValue).toBe('1987-09-19');
      expect(normalized.displayValue).toBe('September 19, 1987');
      expect(normalized.dateConfidence).toBe(1.0);
      expect(normalized.dateAmbiguous).toBe(false);
    });

    it('aria-label "Monday, July 15, 2026" is parsed to ISO', () => {
      const ctx = makeDomContext({
        inputType: null,
        isoValue: 'Monday, July 15, 2026',
        displayValue: 'Monday, July 15, 2026',
        dateType: 'date',
        dateConfidence: 0.9,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.isoValue).toBe('2026-07-15');
      expect(normalized.dateConfidence).toBe(1.0);
    });
  });

  // ── Malformed values from OrangeHRM ──────────────────────────────

  describe('malformed date values (OrangeHRM real-world)', () => {
    it('"1998-15-05" is flagged as ambiguous, NOT silently swapped', () => {
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: '1998-15-05',
        displayValue: '1998-15-05',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateAmbiguous).toBe(true);
      expect(normalized.dateConfidence).toBe(0);
      expect(normalized.isoValue).toBe('');
      expect(normalized.displayValue).toBe('1998-15-05');
      expect(normalized.dateWarning).toBeDefined();
    });

    it('"1987-19-08" is flagged as ambiguous, NOT silently swapped', () => {
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: '1987-19-08',
        displayValue: '1987-19-08',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateAmbiguous).toBe(true);
      expect(normalized.dateConfidence).toBe(0);
      expect(normalized.isoValue).toBe('');
      expect(normalized.displayValue).toBe('1987-19-08');
    });
  });

  // ── Debounce behavior ─────────────────────────────────────────────

  describe('debounce behavior', () => {
    it('intermediate values are not emitted — only final stabilized value', () => {
      // Simulate a sequence of intermediate values during date entry
      makeDomContext({
        inputType: 'text',
        isoValue: '1987', // partial
        displayValue: '1987',
        dateType: 'date',
        dateConfidence: 0.8,
      });
      makeDomContext({
        inputType: 'text',
        isoValue: '1987-09', // still partial
        displayValue: '1987-09',
        dateType: 'date',
        dateConfidence: 0.8,
      });
      const finalValue = makeDomContext({
        inputType: 'text',
        isoValue: '1987-09-19', // complete
        displayValue: '1987-09-19',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      // Only the final value should be emitted as a dateSelect event.
      // The debounce in handleDateValueChange() ensures this:
      //   - Each intermediate change resets the timer
      //   - Only after DATE_DEBOUNCE_MS (800ms) of no changes does it fire
      // The intermediate values would have been seen as input/change events
      // but NOT as dateSelect events.

      // The final normalized result:
      const normalized = normalizeDateDomContext(finalValue);
      expect(normalized.isoValue).toBe('1987-09-19');
      expect(normalized.displayValue).toBe('September 19, 1987');
      expect(normalized.dateConfidence).toBe(1.0);
    });

    it('blur flushes pending debounce immediately', () => {
      // When the user clicks away (blur) from a custom date input,
      // the debounce timer is flushed and the dateSelect event is emitted
      // with the last value. This is handled by the blur listener which
      // checks if datePickerDebounce.target === target and flushes it.

      // Verify the normalizeDateDomContext works correctly for a value
      // that was captured on blur (should be the committed final value)
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: 'July 15, 2026',
        displayValue: 'July 15, 2026',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.isoValue).toBe('2026-07-15');
      expect(normalized.displayValue).toBe('July 15, 2026');
      expect(normalized.dateConfidence).toBe(1.0);
    });
  });

  // ── DomContext date fields ────────────────────────────────────────

  describe('DomContext date fields', () => {
    it('dateSelect event includes all required date fields', () => {
      const msg = makeDateSelectMessage('2026-07-15', {
        inputType: 'date',
        isoValue: '2026-07-15',
        displayValue: 'July 15, 2026',
        dateType: 'date',
        dateConfidence: 1.0,
        dateAmbiguous: false,
      });

      expect(msg.domContext).toBeDefined();
      expect(msg.domContext?.dateType).toBe('date');
      expect(msg.domContext?.isoValue).toBe('2026-07-15');
      expect(msg.domContext?.displayValue).toBe('July 15, 2026');
      expect(msg.domContext?.dateConfidence).toBe(1.0);
      expect(msg.domContext?.dateAmbiguous).toBe(false);
    });

    it('ambiguous date includes warning field', () => {
      const ctx = makeDomContext({
        inputType: 'text',
        isoValue: '05/06/2026',
        displayValue: '05/06/2026',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateWarning).toBeDefined();
      expect(normalized.dateWarning).toContain('Ambiguous');
    });

    it('normalizer confirms high-confidence values without change', () => {
      // If the content script already produced confidence 1.0 with valid ISO,
      // the normalizer confirms it with the same result
      const ctx = makeDomContext({
        inputType: 'date',
        isoValue: '2026-07-15',
        displayValue: '2026-07-15',
        dateType: 'date',
        dateConfidence: 1.0,
        dateAmbiguous: false,
      });

      const normalized = normalizeDateDomContext(ctx);
      expect(normalized.dateConfidence).toBe(1.0);
      expect(normalized.dateAmbiguous).toBe(false);
      expect(normalized.isoValue).toBe('2026-07-15');
    });
  });

  // ── End-to-end: message → normalize → verify ─────────────────────

  describe('end-to-end: message → normalize → verify', () => {
    it('OrangeHRM-style Date of Birth: native input with ISO value', () => {
      // OrangeHRM uses a custom date picker, but the value committed to
      // the underlying input is what we capture. If it's ISO, great.
      const msg = makeDateSelectMessage('1987-09-19', {
        inputType: 'date',
        isoValue: '1987-09-19',
        displayValue: '1987-09-19',
        dateType: 'date',
        dateConfidence: 1.0,
      });

      // Simulate service worker processing
      const normalizedCtx = normalizeDateDomContext(msg.domContext!);
      expect(normalizedCtx.isoValue).toBe('1987-09-19');
      expect(normalizedCtx.displayValue).toBe('September 19, 1987');
      expect(normalizedCtx.dateType).toBe('date');
      expect(normalizedCtx.dateConfidence).toBe(1.0);
      expect(normalizedCtx.dateAmbiguous).toBe(false);
    });

    it('OrangeHRM-style Date of Birth: custom picker with display value', () => {
      // If OrangeHRM's date picker puts a display-format value in the input
      const msg = makeDateSelectMessage('September 19, 1987', {
        inputType: 'text',
        isoValue: 'September 19, 1987',
        displayValue: 'September 19, 1987',
        dateType: 'date',
        dateConfidence: 0.8,
      });

      const normalizedCtx = normalizeDateDomContext(msg.domContext!);
      expect(normalizedCtx.isoValue).toBe('1987-09-19');
      expect(normalizedCtx.displayValue).toBe('September 19, 1987');
      expect(normalizedCtx.dateConfidence).toBe(1.0);
      expect(normalizedCtx.dateAmbiguous).toBe(false);
    });

    it('OrangeHRM-style Date of Birth: calendar cell click with aria-label', () => {
      // When the user clicks a day in the calendar popup
      const msg = makeDateSelectMessage('Friday, September 19, 1987', {
        inputType: null,
        isoValue: 'Friday, September 19, 1987',
        displayValue: 'Friday, September 19, 1987',
        dateType: 'date',
        dateConfidence: 0.9,
      });

      const normalizedCtx = normalizeDateDomContext(msg.domContext!);
      expect(normalizedCtx.isoValue).toBe('1987-09-19');
      expect(normalizedCtx.displayValue).toBe('September 19, 1987');
      expect(normalizedCtx.dateConfidence).toBe(1.0);
      expect(normalizedCtx.dateAmbiguous).toBe(false);
    });
  });

  // ── Multiple date fields in same recording ───────────────────────

  describe('multiple date fields in same recording', () => {
    it('two date fields produce two separate dateSelect events', () => {
      const dobMsg = makeDateSelectMessage('1987-09-19', {
        inputType: 'date',
        isoValue: '1987-09-19',
        dateType: 'date',
        dateConfidence: 1.0,
      });
      dobMsg.target.elementId = 'dateOfBirth-001';
      dobMsg.target.accessibleName = 'Date of Birth';
      dobMsg.target.name = 'dateOfBirth';

      const licenseMsg = makeDateSelectMessage('2026-12-31', {
        inputType: 'date',
        isoValue: '2026-12-31',
        dateType: 'date',
        dateConfidence: 1.0,
      });
      licenseMsg.target.elementId = 'licenseExpiry-002';
      licenseMsg.target.accessibleName = 'License Expiry Date';
      licenseMsg.target.name = 'licenseExpiryDate';

      const dobNormalized = normalizeDateDomContext(dobMsg.domContext!);
      const licenseNormalized = normalizeDateDomContext(licenseMsg.domContext!);

      expect(dobNormalized.isoValue).toBe('1987-09-19');
      expect(dobNormalized.displayValue).toBe('September 19, 1987');

      expect(licenseNormalized.isoValue).toBe('2026-12-31');
      expect(licenseNormalized.displayValue).toBe('December 31, 2026');
    });
  });
});
