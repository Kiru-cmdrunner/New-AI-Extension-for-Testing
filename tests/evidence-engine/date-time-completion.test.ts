/**
 * Date & Time Completion — Comprehensive Tests
 *
 * Validates TimePicker and DateTimePicker detection, metadata, and phrasing
 * across native HTML, MUI, Ant Design, and generic frameworks.
 *
 * Also validates DatePicker regression — no metadata or phrasing changes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { COMMIT_THRESHOLD } from '../../src/classifier/evidence/combination.js';
import { actionDescription } from '../../src/sidepanel/timeline-renderer.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  focusEvent,
  blurEvent,
  changeEvent,
  domContext,
} from './helpers.js';

const MIN_CONFIDENCE = COMMIT_THRESHOLD;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TIME PICKER
// ═══════════════════════════════════════════════════════════════════════════════

describe('TimePicker Detection', () => {
  beforeEach(() => resetEventCounter());

  // ── Native HTML time input ──
  describe('Native <input type="time">', () => {
    it('type=time → TimePicker with timeValue metadata', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Meeting Time',
        cssSelector: 'input[type="time"]#meeting',
      });
      const ctx = domContext({ inputType: 'time' });

      const result = detectInteractionsV2([
        focusEvent(input, { valueBefore: '09:00', domContext: ctx }),
        changeEvent(input, { valueBefore: '09:00', valueAfter: '14:30', domContext: ctx }),
        blurEvent(input, { valueAfter: '14:30', domContext: ctx }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
      expect(tp!.metadata.timeValue).toBe('14:30');
      expect(tp!.metadata.dateValue).toBeUndefined();
      expect(tp!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('type=time via domContext only (no cssSelector) → TimePicker', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Start Time',
        cssSelector: '#start-time',
      });
      const ctx = domContext({ inputType: 'time' });

      const result = detectInteractionsV2([
        changeEvent(input, { valueAfter: '08:00', domContext: ctx }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
      expect(tp!.metadata.timeValue).toBe('08:00');
    });

    it('timeValue NOT dateValue — field separation correct', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Alarm',
        cssSelector: 'input[type="time"]#alarm',
      });
      const ctx = domContext({ inputType: 'time' });

      const result = detectInteractionsV2([
        changeEvent(input, { valueAfter: '07:30', domContext: ctx }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
      expect(tp!.metadata.timeValue).toBe('07:30');
      expect(tp!.metadata).not.toHaveProperty('dateValue');
      expect(tp!.metadata).not.toHaveProperty('dateTimeValue');
    });
  });

  // ── MUI ClockPicker ──
  describe('Material UI ClockPicker / TimePicker', () => {
    it('MuiClockPicker CSS → TimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Select Time',
        className: 'MuiClockPicker-root',
        cssSelector: 'div#mui-clock',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
    });

    it('MuiClockPicker-clock + click → TimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Hours',
        className: 'MuiClockPicker-clock',
        cssSelector: 'div#mui-clock-face',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
    });

    it('TimePickerToolbar CSS → TimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Time',
        className: 'MuiTimePickerToolbar-root',
        cssSelector: 'div#mui-time-toolbar',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
    });
  });

  // ── Ant Design TimePicker ──
  describe('Ant Design TimePicker', () => {
    it('ant-time-picker CSS → TimePicker', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Select time',
        className: 'ant-time-picker-input',
        cssSelector: 'input#antd-time',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
    });
  });

  // ── Generic time picker patterns ──
  describe('Generic patterns', () => {
    it('timepicker class → TimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Pick Time',
        className: 'timepicker-container',
        cssSelector: 'div#tp',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
    });

    it('time-picker class → TimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Schedule',
        className: 'time-picker-widget',
        cssSelector: 'div#time-widget',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
    });
  });

  // ── Timeline phrasing ──
  describe('timeline phrasing', () => {
    it('timeValue present → "Set time to "X""', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Meeting',
        cssSelector: 'input[type="time"]#meeting',
      });
      const ctx = domContext({ inputType: 'time' });
      const result = detectInteractionsV2([
        changeEvent(input, { valueAfter: '14:30', domContext: ctx }),
      ]);
      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
      const formatted = actionDescription(tp!);
      expect(formatted).toContain('Set time');
      expect(formatted).toContain('14:30');
    });

    it('no timeValue → "Set time"', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Clock',
        className: 'MuiClockPicker-root',
        cssSelector: 'div#clock',
      });
      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);
      const tp = result.find(r => r.type === 'TimePicker');
      expect(tp).toBeDefined();
      const formatted = actionDescription(tp!);
      expect(formatted).toContain('Set time');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATETIME PICKER
// ═══════════════════════════════════════════════════════════════════════════════

describe('DateTimePicker Detection', () => {
  beforeEach(() => resetEventCounter());

  // ── Native HTML datetime-local input ──
  describe('Native <input type="datetime-local">', () => {
    it('type=datetime-local → DateTimePicker with dateTimeValue metadata', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Appointment',
        cssSelector: 'input[type="datetime-local"]#appt',
      });
      const ctx = domContext({ inputType: 'datetime-local' });

      const result = detectInteractionsV2([
        focusEvent(input, { valueBefore: '', domContext: ctx }),
        changeEvent(input, { valueBefore: '', valueAfter: '2026-07-20T14:30', domContext: ctx }),
        blurEvent(input, { valueAfter: '2026-07-20T14:30', domContext: ctx }),
      ]);

      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
      expect(dtp!.metadata.dateTimeValue).toBe('2026-07-20T14:30');
      expect(dtp!.metadata.dateValue).toBeUndefined();
      expect(dtp!.metadata.timeValue).toBeUndefined();
      expect(dtp!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('type=datetime-local via domContext only → DateTimePicker', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Event Start',
        cssSelector: '#event-start',
      });
      const ctx = domContext({ inputType: 'datetime-local' });

      const result = detectInteractionsV2([
        changeEvent(input, { valueAfter: '2026-01-15T10:00', domContext: ctx }),
      ]);

      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
      expect(dtp!.metadata.dateTimeValue).toBe('2026-01-15T10:00');
    });

    it('dateTimeValue NOT dateValue — field separation correct', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Reminder',
        cssSelector: 'input[type="datetime-local"]#remind',
      });
      const ctx = domContext({ inputType: 'datetime-local' });

      const result = detectInteractionsV2([
        changeEvent(input, { valueAfter: '2026-03-01T09:00', domContext: ctx }),
      ]);

      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
      expect(dtp!.metadata.dateTimeValue).toBe('2026-03-01T09:00');
      expect(dtp!.metadata).not.toHaveProperty('dateValue');
      expect(dtp!.metadata).not.toHaveProperty('timeValue');
    });
  });

  // ── MUI DateTimePicker ──
  describe('Material UI DateTimePicker', () => {
    it('DateTimePickerToolbar CSS → DateTimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Date & Time',
        className: 'MuiDateTimePickerToolbar-root',
        cssSelector: 'div#mui-dt-toolbar',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
    });
  });

  // ── Generic datetime picker patterns ──
  describe('Generic patterns', () => {
    it('datetimepicker class → DateTimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Schedule',
        className: 'datetimepicker-widget',
        cssSelector: 'div#dtp',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
    });

    it('datetime-picker class → DateTimePicker', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Pick Date and Time',
        className: 'datetime-picker',
        cssSelector: 'div#dt-picker',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
    });
  });

  // ── Timeline phrasing ──
  describe('timeline phrasing', () => {
    it('dateTimeValue present → "Select date and time "X""', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Event',
        cssSelector: 'input[type="datetime-local"]#event',
      });
      const ctx = domContext({ inputType: 'datetime-local' });
      const result = detectInteractionsV2([
        changeEvent(input, { valueAfter: '2026-07-20T14:30', domContext: ctx }),
      ]);
      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
      const formatted = actionDescription(dtp!);
      expect(formatted).toContain('date and time');
      expect(formatted).toContain('2026-07-20T14:30');
    });

    it('no dateTimeValue → "Select date and time"', () => {
      const input = makeTarget({
        tag: 'DIV', accessibleName: 'Picker',
        className: 'datetimepicker-widget',
        cssSelector: 'div#picker',
      });
      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);
      const dtp = result.find(r => r.type === 'DateTimePicker');
      expect(dtp).toBeDefined();
      const formatted = actionDescription(dtp!);
      expect(formatted).toContain('date and time');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DATEPICKER REGRESSION
// ═══════════════════════════════════════════════════════════════════════════════

describe('DatePicker Regression', () => {
  beforeEach(() => resetEventCounter());

  it('type=date → DatePicker with dateValue (unchanged)', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Departure Date',
      cssSelector: 'input[type="date"]#departure',
    });
    const ctx = domContext({ inputType: 'date' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: '2026-07-20', domContext: ctx }),
      blurEvent(input, { valueAfter: '2026-07-20', domContext: ctx }),
    ]);

    const dp = result.find(r => r.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.metadata.dateValue).toBe('2026-07-20');
    // Should NOT have timeValue or dateTimeValue
    expect(dp!.metadata.timeValue).toBeUndefined();
    expect(dp!.metadata.dateTimeValue).toBeUndefined();
  });

  it('DatePicker timeline phrasing unchanged', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Birthday',
      cssSelector: 'input[type="date"]#bday',
    });
    const ctx = domContext({ inputType: 'date' });
    const result = detectInteractionsV2([
      changeEvent(input, { valueAfter: '1990-05-15', domContext: ctx }),
    ]);
    const dp = result.find(r => r.type === 'DatePicker');
    expect(dp).toBeDefined();
    const formatted = actionDescription(dp!);
    expect(formatted).toContain('Select date');
    expect(formatted).toContain('1990-05-15');
  });

  it('type=month → DatePicker (unchanged)', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Select Month',
      cssSelector: 'input[type="month"]#month',
    });
    const ctx = domContext({ inputType: 'month' });

    const result = detectInteractionsV2([
      changeEvent(input, { valueAfter: '2026-07', domContext: ctx }),
    ]);

    const dp = result.find(r => r.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.metadata.dateValue).toBe('2026-07');
  });

  it('type=week → DatePicker (unchanged)', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Week Picker',
      cssSelector: 'input[type="week"]#week',
    });
    const ctx = domContext({ inputType: 'week' });

    const result = detectInteractionsV2([
      changeEvent(input, { valueAfter: '2026-W29', domContext: ctx }),
    ]);

    const dp = result.find(r => r.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.metadata.dateValue).toBe('2026-W29');
  });

  it('calendar cell click → DatePicker (unchanged)', () => {
    const cell = makeTarget({
      tag: 'TD', accessibleName: '15', ariaRole: 'gridcell',
      className: 'calendar-day',
      cssSelector: 'td#day-15',
    });

    const result = detectInteractionsV2([
      clickEvent(cell, { domContext: domContext() }),
    ]);

    const dp = result.find(r => r.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.metadata.dateValue).toBe('15');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. RAW EVENT INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Raw Event Integrity', () => {
  beforeEach(() => resetEventCounter());

  it('TimePicker preserves focus, change, blur event IDs', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Time',
      cssSelector: 'input[type="time"]#t1',
    });
    const ctx = domContext({ inputType: 'time' });

    const events = [
      focusEvent(input, { valueBefore: '09:00', domContext: ctx }),
      changeEvent(input, { valueBefore: '09:00', valueAfter: '10:00', domContext: ctx }),
      blurEvent(input, { valueAfter: '10:00', domContext: ctx }),
    ];
    const ids = events.map(e => e.eventId);

    const result = detectInteractionsV2(events);
    const tp = result.find(r => r.type === 'TimePicker');
    expect(tp).toBeDefined();
    for (const id of ids) {
      expect(tp!.eventIds).toContain(id);
    }
    expect(tp!.rawEventTypes).toContain('focus');
    expect(tp!.rawEventTypes).toContain('change');
    expect(tp!.rawEventTypes).toContain('blur');
  });

  it('DateTimePicker preserves change event IDs', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Event',
      cssSelector: 'input[type="datetime-local"]#e1',
    });
    const ctx = domContext({ inputType: 'datetime-local' });

    const events = [
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: '2026-07-20T14:30', domContext: ctx }),
      blurEvent(input, { valueAfter: '2026-07-20T14:30', domContext: ctx }),
    ];
    const ids = events.map(e => e.eventId);

    const result = detectInteractionsV2(events);
    const dtp = result.find(r => r.type === 'DateTimePicker');
    expect(dtp).toBeDefined();
    for (const id of ids) {
      expect(dtp!.eventIds).toContain(id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FULL FORM WORKFLOW (date + time + datetime)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Date/Time Workflow', () => {
  beforeEach(() => resetEventCounter());

  it('Booking form: DatePicker + TimePicker + DateTimePicker', () => {
    const dateInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Check-in Date',
      cssSelector: 'input[type="date"]#checkin',
    });
    const timeInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Preferred Time',
      cssSelector: 'input[type="time"]#time',
    });
    const dtInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Appointment',
      cssSelector: 'input[type="datetime-local"]#appt',
    });

    const result = detectInteractionsV2([
      changeEvent(dateInput, { valueAfter: '2026-08-01', domContext: domContext({ inputType: 'date' }) }),
      changeEvent(timeInput, { valueAfter: '14:00', domContext: domContext({ inputType: 'time' }) }),
      changeEvent(dtInput, { valueAfter: '2026-08-15T10:30', domContext: domContext({ inputType: 'datetime-local' }) }),
    ]);

    const dp = result.find(r => r.type === 'DatePicker');
    const tp = result.find(r => r.type === 'TimePicker');
    const dtp = result.find(r => r.type === 'DateTimePicker');

    expect(dp).toBeDefined();
    expect(tp).toBeDefined();
    expect(dtp).toBeDefined();

    expect(dp!.metadata.dateValue).toBe('2026-08-01');
    expect(tp!.metadata.timeValue).toBe('14:00');
    expect(dtp!.metadata.dateTimeValue).toBe('2026-08-15T10:30');

    // No event ID overlap
    expect(dp!.eventIds.filter(id => tp!.eventIds.includes(id)).length).toBe(0);
    expect(dp!.eventIds.filter(id => dtp!.eventIds.includes(id)).length).toBe(0);
    expect(tp!.eventIds.filter(id => dtp!.eventIds.includes(id)).length).toBe(0);
  });
});
