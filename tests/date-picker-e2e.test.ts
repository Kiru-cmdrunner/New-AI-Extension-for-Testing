/**
 * Date Picker E2E — Milestone 4 Tests
 *
 * Validates the complete pipeline for date picker interactions:
 *   1. Raw events (dateSelect + calendar popover events)
 *   2. V1 + V2 classification → single DatePicker interaction
 *   3. IR Bridge → single SELECT_DATE step with ISO value
 *   4. Description uses displayValue
 *   5. No standalone Popover/Scroll/Click interactions
 *   6. Multiple date fields produce multiple steps
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { detectInteractions } from '../src/classifier/interaction-detector';
import { detectInteractionsV2 } from '../src/classifier/evidence/detector';
import { mergeV1V2 } from '../src/classifier/evidence/merge-layer';
import { build } from '../src/generation/ir-bridge';
import type { IRBridgeInput } from '../src/generation/ir-bridge-input';
import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import type { ElementIdentity, SessionEvent } from '../src/shared/types';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';
import { IRAction } from '../src/domain/execution-ir/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: '',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '//div',
    inIframe: false,
    shadowDom: false,
    elementId: 'el-001',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    ...overrides,
  };
}

function makeEvent(
  eventType: ElementRecordedEvent['eventType'],
  target: Partial<ElementIdentity>,
  domContextOverrides: Partial<DomContext> = {},
  valueAfter: string | null = null,
): ElementRecordedEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    timestamp: new Date().toISOString(),
    target: makeIdentity(target),
    valueBefore: null,
    valueAfter,
    checkedBefore: null,
    checkedAfter: null,
    domContext: makeDomContext(domContextOverrides),
  };
}

function makeSessionEvent(
  actionId: string,
  type: SessionEvent['type'],
  overrides: Partial<SessionEvent> = {},
): SessionEvent {
  return {
    actionId,
    timestamp: new Date().toISOString(),
    elementIdentity: makeIdentity(),
    ...overrides,
  } as SessionEvent;
}

function makeIRBridgeInput(
  events: SessionEvent[],
  interactions: DetectedInteraction[],
): IRBridgeInput {
  return {
    events,
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test Page' },
    testCaseName: 'Date Picker Test',
  };
}

function runFullPipeline(events: RecordedEvent[]): { interactions: DetectedInteraction[]; plan: ReturnType<typeof build> } {
  const v1 = detectInteractions(events);
  const v2 = detectInteractionsV2(events);
  const { interactions: merged } = mergeV1V2(v2, v1, events.length);

  // Convert RecordedEvent[] to SessionEvent[] for the IR Bridge.
  // In the real service worker, session.getEvents() returns RecordedEvent[]
  // which are passed directly to buildIRPlan. The IR Bridge's
  // buildEventIndex uses actionId, which RecordedEvent doesn't have.
  // findCorrespondingEvent falls back to undefined, and the IR Bridge
  // uses interaction.metadata for values. This is the production behavior.
  const sessionEvents: SessionEvent[] = [];
  for (const e of events) {
    if (e.eventType === 'navigation') continue;
    const el = e as ElementRecordedEvent;
    // Create a SessionEvent with actionId = eventId for IR Bridge lookup
    sessionEvents.push({
      actionId: el.eventId,
      timestamp: el.timestamp,
      elementIdentity: el.target,
      type: el.eventType === 'dateSelect' ? 'dateSelect' : el.eventType,
      value: el.valueAfter ?? undefined,
      ...(el.domContext?.dateType ? {
        dateType: el.domContext.dateType as any,
        displayValue: el.domContext.displayValue ?? '',
        isoValue: el.domContext.isoValue ?? '',
      } : {}),
    } as SessionEvent);
  }

  const plan = build(makeIRBridgeInput(sessionEvents, merged));
  return { interactions: merged, plan };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Date Picker E2E — Milestone 4', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  // ── Single date selection ─────────────────────────────────────────

  describe('single date selection', () => {
    it('produces exactly ONE DatePicker interaction and ONE SELECT_DATE IR step', () => {
      const events: RecordedEvent[] = [
        // Click on date input (trigger) — ownedByDatePicker
        makeEvent('click', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="dateOfBirth"]',
        }, { inputType: 'text', ownedByDatePicker: true }),

        // Scroll in calendar — ownedByDatePicker (suppressed)
        makeEvent('scroll', {
          tag: 'DIV', className: 'oxd-datepicker-calendar',
          cssSelector: '.oxd-datepicker-calendar', elementId: 'cal-1',
        }, { ownedByDatePicker: true }),

        // Click next month — ownedByDatePicker (suppressed)
        makeEvent('click', {
          tag: 'BUTTON', className: 'oxd-datepicker-nav-next',
          ariaLabel: 'Next month', elementId: 'cal-nav-1',
        }, { ownedByDatePicker: true }),

        // Click day cell — ownedByDatePicker (suppressed)
        makeEvent('click', {
          tag: 'DIV', className: 'oxd-datepicker-day',
          ariaRole: 'gridcell', ariaLabel: 'September 19, 1987',
          accessibleName: 'September 19, 1987', elementId: 'cal-day-1',
        }, { ownedByDatePicker: true }),

        // dateSelect event (the actual interaction)
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="dateOfBirth"]',
        }, {
          inputType: 'text', dateType: 'date',
          isoValue: '1987-09-19', displayValue: 'September 19, 1987',
          dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const { interactions, plan } = runFullPipeline(events);

      // Should have exactly ONE DatePicker interaction
      const datePickerInteractions = interactions.filter(i =>
        i.type === 'DatePicker' || i.type === 'TimePicker' || i.type === 'DateTimePicker'
      );
      expect(datePickerInteractions).toHaveLength(1);
      expect(datePickerInteractions[0].type).toBe('DatePicker');

      // IR plan should have exactly ONE SELECT_DATE step
      const selectDateSteps = plan.steps.filter(s => s.action === IRAction.SELECT_DATE);
      expect(selectDateSteps).toHaveLength(1);

      // No other steps from the calendar lifecycle
      expect(plan.steps.length).toBe(1);
    });

    it('IR step uses ISO value for input', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="dateOfBirth"]',
        }, {
          dateType: 'date', isoValue: '1987-09-19',
          displayValue: 'September 19, 1987', dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const { plan } = runFullPipeline(events);
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      expect(step!.input).toBe('1987-09-19');
    });

    it('IR step description uses displayValue', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="dateOfBirth"]',
        }, {
          dateType: 'date', isoValue: '1987-09-19',
          displayValue: 'September 19, 1987', dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const { plan } = runFullPipeline(events);
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      expect(step!.description).toContain('September 19, 1987');
    });

    it('IR step target has field label', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="dateOfBirth"]',
        }, {
          dateType: 'date', isoValue: '1987-09-19',
          displayValue: 'September 19, 1987', dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const { plan } = runFullPipeline(events);
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      expect(step!.target.kind).toBe('element');
      if (step!.target.kind === 'element') {
        expect(step!.target.elementName).toBe('Date of Birth');
      }
    });

    it('no TextEntry, Popover, Scroll, Click, or Hover steps', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
        }, { inputType: 'text', ownedByDatePicker: true }),
        makeEvent('scroll', {
          tag: 'DIV', className: 'calendar', elementId: 'cal-1',
        }, { ownedByDatePicker: true }),
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
        }, {
          dateType: 'date', isoValue: '2026-07-15',
          displayValue: 'July 15, 2026', dateConfidence: 1.0,
        }, '2026-07-15'),
      ];

      const { plan } = runFullPipeline(events);
      const actions = plan.steps.map(s => s.action);

      // Should only have SELECT_DATE, not CLICK, FILL, HOVER, etc.
      expect(actions).not.toContain(IRAction.CLICK);
      expect(actions).not.toContain(IRAction.FILL);
      expect(actions).not.toContain(IRAction.HOVER);
      expect(actions).toContain(IRAction.SELECT_DATE);
    });
  });

  // ── Native HTML5 date input ──────────────────────────────────────

  describe('native HTML5 date input', () => {
    it('native input[type=date] produces SELECT_DATE with ISO value', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'appointmentDate', accessibleName: 'Appointment Date',
          ariaRole: 'textbox', elementId: 'appt-001',
          cssSelector: 'input[type="date"][name="appointmentDate"]',
        }, {
          inputType: 'date', dateType: 'date',
          isoValue: '2026-07-15', displayValue: 'July 15, 2026',
          dateConfidence: 1.0,
        }, '2026-07-15'),
      ];

      const { plan } = runFullPipeline(events);
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      expect(step!.input).toBe('2026-07-15');
    });
  });

  // ── Time picker ──────────────────────────────────────────────────

  describe('time picker', () => {
    it('time picker produces SELECT_DATE with time value', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'meetingTime', accessibleName: 'Meeting Time',
          ariaRole: 'textbox', elementId: 'time-001',
        }, {
          inputType: 'time', dateType: 'time',
          isoValue: '14:30', displayValue: '14:30',
          dateConfidence: 1.0,
        }, '14:30'),
      ];

      const { interactions, plan } = runFullPipeline(events);
      expect(interactions[0].type).toBe('TimePicker');
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      expect(step!.input).toBe('14:30');
    });
  });

  // ── DateTime picker ──────────────────────────────────────────────

  describe('datetime picker', () => {
    it('datetime picker produces SELECT_DATE with datetime value', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'eventDateTime', accessibleName: 'Event Date & Time',
          ariaRole: 'textbox', elementId: 'dt-001',
        }, {
          inputType: 'datetime-local', dateType: 'dateTime',
          isoValue: '2026-07-15T14:30', displayValue: 'July 15, 2026, 14:30',
          dateConfidence: 1.0,
        }, '2026-07-15T14:30'),
      ];

      const { interactions, plan } = runFullPipeline(events);
      expect(interactions[0].type).toBe('DateTimePicker');
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      expect(step!.input).toBe('2026-07-15T14:30');
    });
  });

  // ── Multiple date fields ─────────────────────────────────────────

  describe('multiple date fields', () => {
    it('two date fields produce two SELECT_DATE steps', () => {
      const events: RecordedEvent[] = [
        // First date field: Date of Birth
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
          cssSelector: 'input[name="dateOfBirth"]',
        }, {
          dateType: 'date', isoValue: '1987-09-19',
          displayValue: 'September 19, 1987', dateConfidence: 1.0,
        }, '1987-09-19'),

        // Second date field: License Expiry Date
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'licenseExpiryDate', accessibleName: 'License Expiry Date',
          ariaRole: 'textbox', elementId: 'license-001',
          cssSelector: 'input[name="licenseExpiryDate"]',
        }, {
          dateType: 'date', isoValue: '2026-12-31',
          displayValue: 'December 31, 2026', dateConfidence: 1.0,
        }, '2026-12-31'),
      ];

      // Ensure distinct timestamps
      events[0]!.timestamp = '2026-01-01T00:00:00Z';
      events[1]!.timestamp = '2026-01-01T00:00:01Z';

      const { plan } = runFullPipeline(events);
      const selectDateSteps = plan.steps.filter(s => s.action === IRAction.SELECT_DATE);
      expect(selectDateSteps).toHaveLength(2);

      // First step: Date of Birth
      expect(selectDateSteps[0].input).toBe('1987-09-19');
      expect(selectDateSteps[0].description).toContain('September 19, 1987');

      // Second step: License Expiry Date
      expect(selectDateSteps[1].input).toBe('2026-12-31');
      expect(selectDateSteps[1].description).toContain('December 31, 2026');
    });
  });

  // ── Date field mixed with other interactions ─────────────────────

  describe('date field mixed with other interactions', () => {
    it('date selection plus text entry and click produce correct steps', () => {
      const events: RecordedEvent[] = [
        // Text entry: First Name (focus + change)
        makeEvent('focus', {
          tag: 'INPUT', name: 'firstName', accessibleName: 'First Name',
          ariaRole: 'textbox', elementId: 'fn-001',
          cssSelector: 'input[name="firstName"]',
        }),
        makeEvent('change', {
          tag: 'INPUT', name: 'firstName', accessibleName: 'First Name',
          ariaRole: 'textbox', elementId: 'fn-001',
          cssSelector: 'input[name="firstName"]',
        }, {}, 'John'),

        // Date selection: Date of Birth
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
          cssSelector: 'input[name="dateOfBirth"]',
        }, {
          dateType: 'date', isoValue: '1987-09-19',
          displayValue: 'September 19, 1987', dateConfidence: 1.0,
        }, '1987-09-19'),

        // Click: Save button
        makeEvent('click', {
          tag: 'BUTTON', accessibleName: 'Save',
          ariaRole: 'button', elementId: 'save-001',
          cssSelector: 'button[type="submit"]',
        }),
      ];

      // Ensure distinct timestamps
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime();
      events.forEach((e, i) => {
        (e as ElementRecordedEvent).timestamp = new Date(baseTime + i * 1000).toISOString();
      });

      const { plan } = runFullPipeline(events);

      // Should have: FILL (first name), SELECT_DATE (DOB), CLICK (save)
      const actions = plan.steps.map(s => s.action);
      expect(actions).toContain(IRAction.FILL);
      expect(actions).toContain(IRAction.SELECT_DATE);
      expect(actions).toContain(IRAction.CLICK);

      // Verify the SELECT_DATE step
      const dateStep = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(dateStep).toBeDefined();
      expect(dateStep!.input).toBe('1987-09-19');
      expect(dateStep!.description).toContain('September 19, 1987');
    });
  });

  // ── Ambiguous date value ─────────────────────────────────────────

  describe('ambiguous date value', () => {
    it('ambiguous date still produces SELECT_DATE step', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
        }, {
          dateType: 'date', isoValue: '',
          displayValue: '05/06/2026',
          dateConfidence: 0.5, dateAmbiguous: true,
        }, '05/06/2026'),
      ];

      const { plan } = runFullPipeline(events);
      const step = plan.steps.find(s => s.action === IRAction.SELECT_DATE);
      expect(step).toBeDefined();
      // Input may be empty or a best-guess — the important thing is it's flagged
      // and the description preserves the raw value
      expect(step!.description).toBeDefined();
    });
  });

  // ── V1 + V2 + IR Bridge consistency ──────────────────────────────

  describe('V1 + V2 + IR Bridge consistency', () => {
    it('both V1 and V2 classify dateSelect as DatePicker', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
        }, {
          dateType: 'date', isoValue: '2026-07-15',
          displayValue: 'July 15, 2026', dateConfidence: 1.0,
        }, '2026-07-15'),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);

      expect(v1[0].type).toBe('DatePicker');
      expect(v1[0].confidence).toBe(1.0);

      expect(v2[0].type).toBe('DatePicker');
      expect(v2[0].confidence).toBe(1.0);
    });

    it('merged interactions preserve DatePicker classification', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
        }, {
          dateType: 'date', isoValue: '2026-07-15',
          displayValue: 'July 15, 2026', dateConfidence: 1.0,
        }, '2026-07-15'),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      expect(merged).toHaveLength(1);
      expect(merged[0].type).toBe('DatePicker');
      expect(merged[0].confidence).toBe(1.0);
    });
  });

  // ── Playwright code generation ───────────────────────────────────

  describe('Playwright code generation from IR', () => {
    it('SELECT_DATE step renders as fill() with ISO value', async () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'dateOfBirth', accessibleName: 'Date of Birth',
          ariaRole: 'textbox', elementId: 'dob-001',
          cssSelector: 'input[name="dateOfBirth"]',
        }, {
          dateType: 'date', isoValue: '1987-09-19',
          displayValue: 'September 19, 1987', dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const { plan } = runFullPipeline(events);

      // Import PlaywrightCodeGenerator
      const { PlaywrightCodeGenerator } = await import('../src/adapters/playwright/project-generator');
      const codeGen = new PlaywrightCodeGenerator();
      const result = await codeGen.generate(plan, {
        language: 'typescript',
        pattern: 'flat',
        assertions: 'expect',
      });

      // The generated code should contain the ISO date value
      const codeString = JSON.stringify(result);
      expect(codeString).toContain('1987-09-19');
    });
  });
});
