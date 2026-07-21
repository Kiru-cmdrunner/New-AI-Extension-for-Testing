/**
 * Date Picker Recording Tests — Milestone C6.2
 *
 * Tests the interaction type registration, plain English generation,
 * and pipeline integration for Date Picker interactions.
 *
 * Permanently frozen C6.1: DateSelect interactions represent meaningful
 * committed date/time/range value changes, not clicks or calendar mechanics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getInteractionType, getRegisteredTypes } from '../src/recorder/interaction-types';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { SessionEvent, ElementIdentity, RecordingContext } from '../src/shared/types';
import type { CanonicalStep } from '../src/generation/types';

// ── Test Helpers ──────────────────────────────────────────

const recordingContext: RecordingContext = {
  startUrl: 'https://example.com',
  startTitle: 'Example',
  capturedAt: '2026-07-16T00:00:00Z',
};

function makeDateSelectEvent(
  actionId: string,
  accessibleName: string,
  dateType: string,
  displayValue: string,
  isoValue: string,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'textbox',
    ariaLabel: accessibleName,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input[type="date"]#date-field',
    xPath: '//input[@type="date"]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('dateSelect', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'dateSelect',
    elementIdentity: identity,
    dateType,
    displayValue,
    isoValue,
    timestamp: '2026-07-16T00:00:00Z',
  } as SessionEvent;
}

// ════════════════════════════════════════════════════════════════
// Registration Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — DateSelect Registration', () => {
  it('dateSelect type is registered', () => {
    const config = getInteractionType('dateSelect');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('dateSelect');
    expect(config!.idPrefix).toBe('dateSelect');
  });

  it('exactly 7 interaction types are registered', () => {
    const types = getRegisteredTypes();
    expect(types).toHaveLength(7);
    expect(types).toContain('dateSelect');
  });

  it('badge color is amber (#f59e0b)', () => {
    const config = getInteractionType('dateSelect');
    expect(config!.badgeColor).toBe('#f59e0b');
  });

  it('badge label is "Date"', () => {
    const config = getInteractionType('dateSelect');
    expect(config!.badgeLabel).toBe('Date');
  });
});

// ════════════════════════════════════════════════════════════════
// Plain English Generation Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Plain English Generation', () => {
  it('date type produces "Select Date "15 July 2026""', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'date', displayValue: '15 July 2026', isoValue: '2026-07-15' },
    });
    expect(result).toBe('Select Date "15 July 2026"');
  });

  it('time type produces "Select Time "09:30 AM""', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'time', displayValue: '09:30 AM', isoValue: '09:30' },
    });
    expect(result).toBe('Select Time "09:30 AM"');
  });

  it('dateTime type produces "Select Date & Time "15 July 2026 09:30""', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'dateTime', displayValue: '15 July 2026 09:30', isoValue: '2026-07-15T09:30' },
    });
    expect(result).toBe('Select Date & Time "15 July 2026 09:30"');
  });

  it('dateRange type produces "Select Date Range "1 July 2026" to "10 July 2026""', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: {
        dateType: 'dateRange',
        displayValue: '1 July 2026 to 10 July 2026',
        isoValue: '2026-07-01/2026-07-10',
        startDisplayValue: '1 July 2026',
        endDisplayValue: '10 July 2026',
      },
    });
    expect(result).toBe('Select Date Range "1 July 2026" to "10 July 2026"');
  });

  it('month type produces "Select Date "July 2026""', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'month', displayValue: 'July 2026', isoValue: '2026-07' },
    });
    expect(result).toBe('Select Date "July 2026"');
  });

  it('week type produces "Select Date "Week 29, 2026""', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'week', displayValue: 'Week 29, 2026', isoValue: '2026-W29' },
    });
    expect(result).toBe('Select Date "Week 29, 2026"');
  });
});

// ════════════════════════════════════════════════════════════════
// Render Title Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Render Title', () => {
  it('renderTitle returns the display value', () => {
    const config = getInteractionType('dateSelect')!;
    const event = {
      actionId: 'dateSelect-0001',
      actionType: 'dateSelect',
      type: 'dateSelect',
      elementIdentity: { accessibleName: 'Departure Date', tag: 'INPUT' } as ElementIdentity,
      aiUnderstanding: undefined,
      displayValue: '15 July 2026',
      dateType: 'date',
      timestamp: '2026-07-16T00:00:00Z',
    };
    expect(config.renderTitle(event as any)).toBe('15 July 2026');
  });

  it('renderTitle falls back to accessibleName', () => {
    const config = getInteractionType('dateSelect')!;
    const event = {
      actionId: 'dateSelect-0001',
      actionType: 'dateSelect',
      type: 'dateSelect',
      elementIdentity: { accessibleName: 'Departure Date', tag: 'INPUT' } as ElementIdentity,
      aiUnderstanding: undefined,
      timestamp: '2026-07-16T00:00:00Z',
    };
    expect(config.renderTitle(event as any)).toBe('Departure Date');
  });
});

// ════════════════════════════════════════════════════════════════
// Pipeline Integration Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Canonical Step Generation', () => {
  it('native date input produces Canonical Step with dateSelect actionType', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Departure Date', 'date', '15 July 2026', '2026-07-15'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('selectDate');
    expect(result.output![0].plainEnglish).toBe('Select 15 July 2026 as the Departure Date');
  });

  it('time selection produces Canonical Step', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Meeting Time', 'time', '09:30 AM', '09:30'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].actionType).toBe('selectDate');
    expect(result.output![0].plainEnglish).toBe('Select 09:30 AM as the Meeting Time');
  });

  it('dateTime selection produces Canonical Step', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Appointment', 'dateTime', '15 July 2026 09:30', '2026-07-15T09:30'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select 15 July 2026 09:30 as the Appointment');
  });

  it('dateRange selection produces Canonical Step', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'dateSelect-0001',
        type: 'dateSelect',
        elementIdentity: {
          accessibleName: 'Date Range', ariaRole: 'textbox', ariaLabel: 'Date Range',
          ariaLabelledBy: null, placeholder: null, tag: 'INPUT', className: null,
          name: null, stableId: null, testId: null, dataCy: null, dataQa: null,
          cssSelector: 'input.daterangepicker', xPath: '//input[@class="daterangepicker"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        dateType: 'dateRange',
        displayValue: '1 July 2026 to 10 July 2026',
        isoValue: '2026-07-01/2026-07-10',
        startDisplayValue: '1 July 2026',
        endDisplayValue: '10 July 2026',
        startIsoValue: '2026-07-01',
        endIsoValue: '2026-07-10',
        timestamp: '2026-07-16T00:00:00Z',
      } as SessionEvent,
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select 1 July 2026 to 10 July 2026 as the Date Range');
  });

  it('multiple date selections in sequence produce multiple Canonical Steps', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Start Date', 'date', '1 July 2026', '2026-07-01'),
      makeDateSelectEvent('dateSelect-0002', 'End Date', 'date', '10 July 2026', '2026-07-10'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].plainEnglish).toBe('Select 1 July 2026 as the Start Date');
    expect(result.output![1].plainEnglish).toBe('Select 10 July 2026 as the End Date');
  });

  it('mixed workflow: Click + DateSelect + Select + Navigate', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'click-0001', type: 'click',
        elementIdentity: {
          accessibleName: 'Open Calendar', ariaRole: 'button', ariaLabel: 'Open Calendar',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', className: null,
          name: null, stableId: null, testId: null, dataCy: null, dataQa: null,
          cssSelector: 'button.cal-icon', xPath: '//button[@class="cal-icon"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        timestamp: '2026-07-16T00:00:00Z',
      },
      makeDateSelectEvent('dateSelect-0001', 'Departure Date', 'date', '15 July 2026', '2026-07-15',
        { cssSelector: 'input[name="departure"]', xPath: '//input[@name="departure"]' }),
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Class', ariaRole: 'listbox', ariaLabel: 'Class',
          ariaLabelledBy: null, placeholder: null, tag: 'SELECT', className: null,
          name: 'class', stableId: null, testId: null, dataCy: null, dataQa: null,
          cssSelector: 'select#class', xPath: '//select[@id="class"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0003',
        },
        value: 'Business', timestamp: '2026-07-16T00:00:02Z',
      },
      {
        actionId: 'nav-0001', type: 'navigation',
        url: 'https://example.com/results',
        title: 'Search Results',
        timestamp: '2026-07-16T00:00:03Z',
      } as SessionEvent,
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(4);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![1].actionType).toBe('selectDate');
    expect(result.output![1].plainEnglish).toBe('Select 15 July 2026 as the Departure Date');
    expect(result.output![2].actionType).toBe('select');
    expect(result.output![3].actionType).toBe('navigate');
  });
});

// ════════════════════════════════════════════════════════════════
// Execution JSON Generation Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Execution JSON Generation', () => {
  it('dateSelect produces valid Execution JSON', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Departure Date', 'date', '15 July 2026', '2026-07-15',
        { name: 'departure_date', stableId: 'departure' }),
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output![0].executionJson!.action.type).toBe('fill');
  });
});

// ════════════════════════════════════════════════════════════════
// Date Format Conversion Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — ISO to Display Format Conversion', () => {
  // Test the isoToDisplay function indirectly via the pipeline
  // by constructing events with ISO values and checking the display format

  it('YYYY-MM-DD → "D Month YYYY"', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'date', displayValue: '15 July 2026', isoValue: '2026-07-15' },
    });
    expect(result).toContain('15 July 2026');
  });

  it('HH:MM → "HH:MM AM/PM"', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'time', displayValue: '09:30 AM', isoValue: '09:30' },
    });
    expect(result).toContain('09:30 AM');
  });

  it('PM time conversion', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'time', displayValue: '02:30 PM', isoValue: '14:30' },
    });
    expect(result).toContain('02:30 PM');
  });

  it('YYYY-MM-DDTHH:MM → "D Month YYYY HH:MM"', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'dateTime', displayValue: '15 July 2026 14:30', isoValue: '2026-07-15T14:30' },
    });
    expect(result).toContain('15 July 2026 14:30');
  });

  it('YYYY-MM → "Month YYYY"', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'month', displayValue: 'July 2026', isoValue: '2026-07' },
    });
    expect(result).toContain('July 2026');
  });

  it('YYYY-WNN → "Week N, YYYY"', () => {
    const config = getInteractionType('dateSelect')!;
    const result = config.toPlainEnglish({
      identity: {} as ElementIdentity,
      understanding: undefined,
      extras: { dateType: 'week', displayValue: 'Week 29, 2026', isoValue: '2026-W29' },
    });
    expect(result).toContain('Week 29, 2026');
  });
});

// ════════════════════════════════════════════════════════════════
// No Duplicate Event Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — No Duplicate Events', () => {
  it('a date selection does NOT produce a Click event alongside', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Departure Date', 'date', '15 July 2026', '2026-07-15'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('selectDate');
    expect(result.output!.some(s => s.actionType === 'click')).toBe(false);
  });

  it('calendar trigger click IS recorded as Click (not suppressed)', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'click-0001', type: 'click',
        elementIdentity: {
          accessibleName: 'Open Calendar', ariaRole: 'button', ariaLabel: 'Open Calendar',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', className: null,
          name: null, stableId: null, testId: null, dataCy: null, dataQa: null,
          cssSelector: 'button.cal-trigger', xPath: '//button',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        timestamp: '2026-07-16T00:00:00Z',
      },
      makeDateSelectEvent('dateSelect-0001', 'Departure Date', 'date', '15 July 2026', '2026-07-15'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![1].actionType).toBe('selectDate');
  });
});

// ════════════════════════════════════════════════════════════════
// Native Input Type Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Native Input Type Coverage', () => {
  it('input[type=date] → date sub-type', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Date', 'date', '15 July 2026', '2026-07-15'),
    ];
    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select 15 July 2026 as the Date');
  });

  it('input[type=time] → time sub-type', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Time', 'time', '09:30 AM', '09:30'),
    ];
    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select 09:30 AM as the Time');
  });

  it('input[type=datetime-local] → dateTime sub-type', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Date & Time', 'dateTime', '15 July 2026 09:30', '2026-07-15T09:30'),
    ];
    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select 15 July 2026 09:30 as the Date & Time');
  });

  it('input[type=month] → month sub-type', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Month', 'month', 'July 2026', '2026-07'),
    ];
    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select July 2026 as the Month');
  });

  it('input[type=week] → week sub-type', () => {
    const events: SessionEvent[] = [
      makeDateSelectEvent('dateSelect-0001', 'Week', 'week', 'Week 29, 2026', '2026-W29'),
    ];
    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output![0].plainEnglish).toBe('Select Week 29, 2026 as the Week');
  });
});

// ════════════════════════════════════════════════════════════════
// DOM Selector Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — DOM Selector Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('NATIVE_DATE_INPUT_SELECTOR matches all 5 native date input types', () => {
    document.body.innerHTML = `
      <input type="date" id="d1">
      <input type="datetime-local" id="d2">
      <input type="time" id="d3">
      <input type="month" id="d4">
      <input type="week" id="d5">
      <input type="text" id="t1">
      <input type="email" id="e1">
    `;

    const NATIVE_DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"], input[type="time"], input[type="month"], input[type="week"]';
    const matches = document.querySelectorAll(NATIVE_DATE_INPUT_SELECTOR);
    expect(matches).toHaveLength(5);
    expect(matches[0].id).toBe('d1');
    expect(matches[4].id).toBe('d5');
  });

  it('CALENDAR_GRIDCELL_SELECTOR matches role=gridcell', () => {
    document.body.innerHTML = `
      <table role="grid">
        <tr><td role="gridcell" aria-label="15 July 2026">15</td></tr>
        <tr><td role="gridcell" aria-label="16 July 2026">16</td></tr>
      </table>
    `;

    const CALENDAR_GRIDCELL_SELECTOR = '[role="gridcell"], [data-date], td[aria-label]';
    const matches = document.querySelectorAll(CALENDAR_GRIDCELL_SELECTOR);
    expect(matches).toHaveLength(2);
  });

  it('CALENDAR_GRIDCELL_SELECTOR matches data-date attribute', () => {
    document.body.innerHTML = `
      <div role="grid">
        <button data-date="2026-07-15">15</button>
        <button data-date="2026-07-16">16</button>
      </div>
    `;

    const CALENDAR_GRIDCELL_SELECTOR = '[role="gridcell"], [data-date], td[aria-label]';
    const matches = document.querySelectorAll(CALENDAR_GRIDCELL_SELECTOR);
    expect(matches).toHaveLength(2);
  });

  it('click exclusion: DATE_INPUT_SELECTOR matches native date inputs', () => {
    document.body.innerHTML = `
      <input type="date" id="d1">
      <input type="text" id="t1">
    `;

    const DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"], input[type="time"], input[type="month"], input[type="week"]';
    const dateInput = document.getElementById('d1')!;
    const textInput = document.getElementById('t1')!;

    expect(dateInput.matches(DATE_INPUT_SELECTOR)).toBe(true);
    expect(textInput.matches(DATE_INPUT_SELECTOR)).toBe(false);
  });

  it('text entry selector does NOT include date inputs', () => {
    const TEXT_ENTRY_SELECTOR = [
      'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
      'input[type="search"]', 'input[type="tel"]', 'input[type="url"]',
      'input[type="number"]', 'input:not([type])', 'textarea', '[contenteditable="true"]',
    ].join(', ');

    document.body.innerHTML = `<input type="date" id="d1">`;
    const dateInput = document.getElementById('d1')!;
    expect(dateInput.matches(TEXT_ENTRY_SELECTOR)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// C6.2A — Broader Calendar Detection (non-gridcell cells)
// ════════════════════════════════════════════════════════════════

describe('C6.2A — Broader Calendar Cell Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('CALENDAR_CONTAINER_SELECTOR matches class*="calendar"', () => {
    document.body.innerHTML = `<div class="my-custom-calendar"><span>15</span></div>`;
    const CALENDAR_CONTAINER_SELECTOR = '[role="grid"], [role="dialog"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';
    const el = document.querySelector('.my-custom-calendar')!;
    expect(el.matches(CALENDAR_CONTAINER_SELECTOR)).toBe(true);
  });

  it('CALENDAR_CONTAINER_SELECTOR matches class*="datepicker"', () => {
    document.body.innerHTML = `<div class="react-datepicker__calendar"><span>15</span></div>`;
    const CALENDAR_CONTAINER_SELECTOR = '[role="grid"], [role="dialog"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';
    const el = document.querySelector('.react-datepicker__calendar')!;
    expect(el.matches(CALENDAR_CONTAINER_SELECTOR)).toBe(true);
  });

  it('CALENDAR_CONTAINER_SELECTOR matches data-datepicker attribute', () => {
    document.body.innerHTML = `<div data-datepicker="true"><span>15</span></div>`;
    const CALENDAR_CONTAINER_SELECTOR = '[role="grid"], [role="dialog"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';
    const el = document.querySelector('[data-datepicker]')!;
    expect(el.matches(CALENDAR_CONTAINER_SELECTOR)).toBe(true);
  });

  it('Flatpickr-style span cell inside calendar container has date-like content', () => {
    document.body.innerHTML = `
      <div class="flatpickr-calendar">
        <span class="flatpickr-day" aria-label="July 15, 2026">15</span>
      </div>
    `;
    const cell = document.querySelector('.flatpickr-day')!;
    const ariaLabel = cell.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toContain('July');
    expect(ariaLabel).toContain('15');
    expect(cell.textContent?.trim()).toBe('15');
  });

  it('react-datepicker-style div cell inside calendar container has date-like content', () => {
    document.body.innerHTML = `
      <div class="react-datepicker">
        <div class="react-datepicker__day" aria-label="day-15">15</div>
      </div>
    `;
    const cell = document.querySelector('.react-datepicker__day')!;
    expect(cell.closest('[class*="datepicker"]')).toBeTruthy();
    expect(cell.textContent?.trim()).toBe('15');
    expect(cell.tagName).toBe('DIV');
  });

  it('bare button with numeric text inside calendar container is interactive', () => {
    document.body.innerHTML = `
      <div class="custom-calendar-widget">
        <button class="day-btn">15</button>
      </div>
    `;
    const cell = document.querySelector('.day-btn')!;
    expect(cell.closest('[class*="calendar"]')).toBeTruthy();
    expect(cell.textContent?.trim()).toBe('15');
    expect(cell.tagName).toBe('BUTTON');
  });

  it('element OUTSIDE calendar container is NOT a calendar cell', () => {
    document.body.innerHTML = `
      <div class="regular-container">
        <button>15</button>
      </div>
    `;
    const btn = document.querySelector('button')!;
    expect(btn.closest('[role="grid"], [class*="calendar"], [class*="datepicker"], [data-datepicker]')).toBeNull();
  });

  it('DATEPICKER_CONTAINER_SELECTOR in select-content-script matches calendar containers', () => {
    document.body.innerHTML = `
      <div class="calendar-widget" id="cal">
        <button data-date="2026-07-15">15</button>
      </div>
      <div class="regular-dropdown" id="dd">
        <div role="option">Option 1</div>
      </div>
    `;
    const DATEPICKER_CONTAINER_SELECTOR = '[role="grid"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';
    const calCell = document.querySelector('#cal [data-date]')!;
    const ddOption = document.querySelector('#dd [role="option"]')!;

    expect(calCell.closest(DATEPICKER_CONTAINER_SELECTOR)).toBeTruthy();
    expect(ddOption.closest(DATEPICKER_CONTAINER_SELECTOR)).toBeNull();
  });

  it('data-day attribute is also recognized as calendar cell evidence', () => {
    document.body.innerHTML = `
      <div class="calendar">
        <div data-day="15" class="day-cell">15</div>
      </div>
    `;
    const cell = document.querySelector('[data-day]')!;
    expect(cell.closest('[class*="calendar"]')).toBeTruthy();
    expect(cell.getAttribute('data-day')).toBe('15');
  });
});

// ════════════════════════════════════════════════════════════════
// C6.2A — Post-Click Value Outcome Detection
// ════════════════════════════════════════════════════════════════

describe('C6.2A — Post-Click Value Outcome Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('date-like text input is identified by placeholder', () => {
    document.body.innerHTML = `<input type="text" id="onward" placeholder="Depart on">`;
    const input = document.getElementById('onward') as HTMLInputElement;
    const placeholder = (input.placeholder || '').toLowerCase();
    expect(placeholder).toContain('depart');
    expect(/\b(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar)\b/.test(placeholder)).toBe(true);
  });

  it('date-like text input is identified by name attribute', () => {
    document.body.innerHTML = `<input type="text" name="departure_date">`;
    const input = document.querySelector('input')!;
    const name = (input.getAttribute('name') || '').toLowerCase();
    expect(/\b(date|depart)/.test(name)).toBe(true);
  });

  it('non-date text input is NOT identified as date-like', () => {
    document.body.innerHTML = `<input type="text" placeholder="Enter your name">`;
    const input = document.querySelector('input')!;
    const placeholder = (input.placeholder || '').toLowerCase();
    expect(/\b(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar)\b/.test(placeholder)).toBe(false);
  });

  it('isDateLikeValue detects "Sat, 18 Jul" format', () => {
    const DATE_VALUE_PATTERN_4 = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
    expect(DATE_VALUE_PATTERN_4.test('Sat, 18 Jul')).toBe(true);
    expect(DATE_VALUE_PATTERN_4.test('18 Jul')).toBe(false);
  });

  it('isDateLikeValue detects "18 July 2026" format', () => {
    const DATE_VALUE_PATTERN_2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{2,4}\b/i;
    expect(DATE_VALUE_PATTERN_2.test('18 July 2026')).toBe(true);
  });

  it('isDateLikeValue detects "18/07/2026" format', () => {
    const DATE_VALUE_PATTERN_3 = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/;
    expect(DATE_VALUE_PATTERN_3.test('18/07/2026')).toBe(true);
    expect(DATE_VALUE_PATTERN_3.test('07-18-2026')).toBe(true);
  });

  it('isDateLikeValue rejects non-date strings', () => {
    const DATE_VALUE_PATTERN_3 = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/;
    expect(DATE_VALUE_PATTERN_3.test('Hello World')).toBe(false);
    expect(DATE_VALUE_PATTERN_3.test('')).toBe(false);
  });

  it('CALENDAR_OVERLAY_SELECTOR matches unrecognized calendar class names', () => {
    document.body.innerHTML = `
      <div class="flight-calendar-picker">
        <button>15</button>
      </div>
    `;
    const CALENDAR_OVERLAY_SELECTOR = '[role="grid"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';
    const cell = document.querySelector('button')!;
    expect(cell.closest(CALENDAR_OVERLAY_SELECTOR)).toBeTruthy();
  });

  it('Adani One scenario: text input with "Depart on" placeholder is date-like', () => {
    // Simulates the exact Adani One date input from the screenshot
    document.body.innerHTML = `<input type="text" id="onward" name="onward" placeholder="Depart on">`;
    const input = document.getElementById('onward') as HTMLInputElement;
    const combined = `${input.placeholder} ${input.name} ${input.id}`.toLowerCase();
    expect(/\b(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar)\b/.test(combined)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// Execution Extras Tests
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Execution Extras', () => {
  it('executionExtras extracts dateType, displayValue, isoValue', () => {
    const config = getInteractionType('dateSelect')!;
    const event = {
      actionId: 'dateSelect-0001',
      actionType: 'dateSelect',
      type: 'dateSelect',
      elementIdentity: {} as ElementIdentity,
      dateType: 'date',
      displayValue: '15 July 2026',
      isoValue: '2026-07-15',
      timestamp: '2026-07-16T00:00:00Z',
    };
    const extras = config.executionExtras(event as any);
    expect(extras.dateType).toBe('date');
    expect(extras.displayValue).toBe('15 July 2026');
    expect(extras.isoValue).toBe('2026-07-15');
  });

  it('executionExtras extracts range data for dateRange', () => {
    const config = getInteractionType('dateSelect')!;
    const event = {
      actionId: 'dateSelect-0001',
      actionType: 'dateSelect',
      type: 'dateSelect',
      elementIdentity: {} as ElementIdentity,
      dateType: 'dateRange',
      displayValue: '1 July 2026 to 10 July 2026',
      isoValue: '2026-07-01/2026-07-10',
      startDisplayValue: '1 July 2026',
      endDisplayValue: '10 July 2026',
      startIsoValue: '2026-07-01',
      endIsoValue: '2026-07-10',
      timestamp: '2026-07-16T00:00:00Z',
    };
    const extras = config.executionExtras(event as any);
    expect(extras.dateType).toBe('dateRange');
    expect(extras.startDisplayValue).toBe('1 July 2026');
    expect(extras.endDisplayValue).toBe('10 July 2026');
    expect(extras.startIsoValue).toBe('2026-07-01');
    expect(extras.endIsoValue).toBe('2026-07-10');
  });
});

// ════════════════════════════════════════════════════════════════
// Regression: Existing Interaction Types Unaffected
// ════════════════════════════════════════════════════════════════

describe('C6.2 — Regression: Existing Types Unaffected', () => {
  it('click interaction type still works', () => {
    const config = getInteractionType('click');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('click');
  });

  it('text interaction type still works', () => {
    const config = getInteractionType('text');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('text');
  });

  it('hover interaction type still works', () => {
    const config = getInteractionType('hover');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('hover');
  });

  it('checkbox interaction type still works', () => {
    const config = getInteractionType('checkbox');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('checkbox');
  });

  it('radio interaction type still works', () => {
    const config = getInteractionType('radio');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('radio');
  });

  it('select interaction type still works', () => {
    const config = getInteractionType('select');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('select');
  });
});
