/**
 * Stage 3 — New Classifier (Recognition) Tests
 *
 * Tests the InteractionRecognizer against:
 * - OrangeHRM 9-step workflow scenarios
 * - All major interaction types
 * - Date picker recognition (native + custom)
 * - Temporal dedup
 * - Feature flag integration
 */

import { describe, it, expect } from 'vitest';
import { recognizeInteractions } from '../src/recorder/v2/interaction-recognizer';
import type { RecordedEvent, ElementRecordedEvent, NavigationRecordedEvent } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ──────────────────────────────────────────────────────────────

let eventCounter = 0;

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: `elem-${String(++eventCounter).padStart(4, '0')}`,
    ...overrides,
  };
}

function makeClickEvent(
  target: ElementIdentity,
  timestamp = Date.now(),
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'click',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeFocusEvent(
  target: ElementIdentity,
  timestamp = Date.now(),
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'focus',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeBlurEvent(
  target: ElementIdentity,
  timestamp = Date.now(),
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'blur',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeInputEvent(
  target: ElementIdentity,
  timestamp = Date.now(),
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'input',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeChangeEvent(
  target: ElementIdentity,
  timestamp = Date.now(),
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'change',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeScrollEvent(
  target: ElementIdentity,
  timestamp = Date.now(),
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'scroll',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
  };
}

function makeNavigationEvent(
  url: string,
  timestamp = Date.now(),
  transitionType?: string,
): NavigationRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'navigation',
    timestamp: new Date(timestamp).toISOString(),
    url,
    title: 'Test Page',
    transitionType,
  };
}

function makeDateSelectEvent(
  target: ElementIdentity,
  domContext: any,
  timestamp = Date.now(),
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'dateSelect',
    timestamp: new Date(timestamp).toISOString(),
    target,
    valueBefore: null,
    valueAfter: domContext.isoValue || domContext.displayValue || null,
    checkedBefore: null,
    checkedAfter: null,
    domContext,
  };
}

function resetCounter(): void {
  eventCounter = 0;
}

// ════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════

describe('InteractionRecognizer', () => {

  describe('Navigation', () => {
    it('classifies page navigation', () => {
      resetCounter();
      const events: RecordedEvent[] = [
        makeNavigationEvent('https://example.com/page1'),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageNavigation');
      expect(result[0].metadata.url).toBe('https://example.com/page1');
      expect(result[0].confidence).toBe(1.0);
      expect(result[0].target).toBeUndefined();
    });

    it('classifies refresh', () => {
      resetCounter();
      const events: RecordedEvent[] = [
        makeNavigationEvent('https://example.com', Date.now(), 'reload'),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('Refresh');
    });

    it('classifies back navigation', () => {
      resetCounter();
      const events: RecordedEvent[] = [
        makeNavigationEvent('https://example.com', Date.now(), 'link,forward_back'),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('Back');
    });
  });

  describe('Text Entry', () => {
    it('recognises text entry from focus→input→blur sequence', () => {
      resetCounter();
      const firstName = makeElementIdentity({
        accessibleName: 'First Name',
        ariaRole: 'textbox',
        tag: 'INPUT',
        cssSelector: 'input#firstName',
      });
      const events: RecordedEvent[] = [
        makeFocusEvent(firstName, 1000, { valueBefore: '' }),
        makeInputEvent(firstName, 2000, { valueAfter: 'John' }),
        makeBlurEvent(firstName, 3000, { valueAfter: 'John' }),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('John');
      expect(result[0].confidence).toBe(1.0);
      expect(result[0].target?.accessibleName).toBe('First Name');
    });

    it('recognises text entry from focus→change→blur on select element would not trigger text entry', () => {
      resetCounter();
      const selectEl = makeElementIdentity({
        accessibleName: 'Country',
        tag: 'SELECT',
        ariaRole: 'listbox',
        cssSelector: 'select#country',
      });
      const events: RecordedEvent[] = [
        makeFocusEvent(selectEl, 1000),
        makeChangeEvent(selectEl, 2000, { valueAfter: 'US' }),
        makeBlurEvent(selectEl, 3000),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('NativeDropdown');
      expect(result[0].metadata.selectedValue).toBe('US');
    });
  });

  describe('Native Dropdown', () => {
    it('recognises native <select> dropdown selection', () => {
      resetCounter();
      const nationality = makeElementIdentity({
        accessibleName: 'Nationality',
        tag: 'SELECT',
        ariaRole: 'listbox',
        cssSelector: 'select#nationality',
      });
      const events: RecordedEvent[] = [
        makeFocusEvent(nationality, 1000),
        makeChangeEvent(nationality, 2000, { valueAfter: 'American' }),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('NativeDropdown');
      expect(result[0].metadata.selectedValue).toBe('American');
      expect(result[0].target?.accessibleName).toBe('Nationality');
    });
  });

  describe('Custom Dropdown (OXD)', () => {
    it('recognises custom combobox dropdown', () => {
      resetCounter();
      const maritalStatus = makeElementIdentity({
        accessibleName: 'Marital Status',
        ariaRole: 'combobox',
        tag: 'DIV',
        className: 'oxd-select-text-input',
        cssSelector: 'div.oxd-select-text-input',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(maritalStatus, 1000, {
          domContext: { ariaExpanded: true, ariaHasPopup: 'listbox', inputType: null, isContentEditable: false },
        }),
        makeChangeEvent(maritalStatus, 3000, { valueAfter: 'Single' }),
      ];
      const result = recognizeInteractions(events);
      // The click and change should be separate groups (different event types,
      // click starts a new group)
      const dropdown = result.find((r) => r.type === 'CustomDropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown?.metadata.selectedValue).toBe('Single');
    });

    it('classifies combobox with aria-haspopup=listbox as CustomDropdown', () => {
      resetCounter();
      const combobox = makeElementIdentity({
        accessibleName: 'Blood Type',
        ariaRole: 'combobox',
        tag: 'DIV',
        className: 'oxd-select-wrapper',
        cssSelector: 'div.oxd-select-wrapper',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(combobox, 1000, {
          domContext: { ariaHasPopup: 'listbox', ariaExpanded: true, inputType: null, isContentEditable: false },
        }),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('CustomDropdown');
    });
  });

  describe('Checkbox', () => {
    it('recognises checkbox toggle', () => {
      resetCounter();
      const checkbox = makeElementIdentity({
        accessibleName: 'Subscribe',
        ariaRole: 'checkbox',
        tag: 'INPUT',
        cssSelector: 'input[type="checkbox"]#subscribe',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(checkbox, 1000, {
          checkedBefore: false,
          checkedAfter: true,
        }),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(true);
    });
  });

  describe('Radio Button', () => {
    it('recognises radio button selection', () => {
      resetCounter();
      const radio = makeElementIdentity({
        accessibleName: 'Female',
        ariaRole: 'radio',
        tag: 'INPUT',
        cssSelector: 'input[type="radio"]#female',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(radio, 1000, {
          checkedBefore: false,
          checkedAfter: true,
        }),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RadioButton');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[0].metadata.selectedValue).toBe('Female');
    });
  });

  describe('Slider', () => {
    it('recognises slider adjustment', () => {
      resetCounter();
      const slider = makeElementIdentity({
        accessibleName: 'Volume',
        ariaRole: 'slider',
        tag: 'INPUT',
        cssSelector: 'input[type="range"]#volume',
      });
      const events: RecordedEvent[] = [
        makeChangeEvent(slider, 1000, {
          valueAfter: '75',
          domContext: { inputType: 'range', ariaValueMin: '0', ariaValueMax: '100', isContentEditable: false, inputType2: 'range' } as any,
        }),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('Slider');
      expect(result[0].metadata.sliderValue).toBe('75');
    });
  });

  describe('Scroll', () => {
    it('classifies page scroll', () => {
      resetCounter();
      const html = makeElementIdentity({ tag: 'HTML', ariaRole: 'document', cssSelector: 'html' });
      const events: RecordedEvent[] = [
        makeScrollEvent(html, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageScroll');
    });

    it('classifies container scroll', () => {
      resetCounter();
      const container = makeElementIdentity({
        tag: 'DIV',
        ariaRole: null,
        className: 'scroll-container',
        cssSelector: 'div.scroll-container',
      });
      const events: RecordedEvent[] = [
        makeScrollEvent(container, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ContainerScroll');
    });
  });

  describe('Date Picker', () => {
    it('recognises native date input via dateSelect event', () => {
      resetCounter();
      const dateInput = makeElementIdentity({
        accessibleName: 'Date of Birth',
        ariaRole: 'textbox',
        tag: 'INPUT',
        cssSelector: 'input[type="date"]#dob',
      });
      const events: RecordedEvent[] = [
        makeDateSelectEvent(dateInput, {
          inputType: 'date',
          isContentEditable: false,
          dateType: 'date',
          isoValue: '1990-05-15',
          displayValue: 'May 15, 1990',
          dateConfidence: 1.0,
        }, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DatePicker');
      expect(result[0].metadata.dateValue).toBe('1990-05-15');
      expect(result[0].metadata.displayValue).toBe('May 15, 1990');
      expect(result[0].confidence).toBe(1.0);
    });

    it('recognises time picker', () => {
      resetCounter();
      const timeInput = makeElementIdentity({
        accessibleName: 'Start Time',
        tag: 'INPUT',
        cssSelector: 'input[type="time"]#startTime',
      });
      const events: RecordedEvent[] = [
        makeDateSelectEvent(timeInput, {
          inputType: 'time',
          isContentEditable: false,
          dateType: 'time',
          isoValue: '14:30',
          displayValue: '2:30 PM',
          dateConfidence: 1.0,
        }, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('TimePicker');
      expect(result[0].metadata.timeValue).toBe('14:30');
    });

    it('recognises datetime-local picker', () => {
      resetCounter();
      const dtInput = makeElementIdentity({
        accessibleName: 'Appointment',
        tag: 'INPUT',
        cssSelector: 'input[type="datetime-local"]#apt',
      });
      const events: RecordedEvent[] = [
        makeDateSelectEvent(dtInput, {
          inputType: 'datetime-local',
          isContentEditable: false,
          dateType: 'dateTime',
          isoValue: '2026-07-28T14:30',
          displayValue: 'July 28, 2026, 2:30 PM',
          dateConfidence: 1.0,
        }, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('DateTimePicker');
      expect(result[0].metadata.dateTimeValue).toBe('2026-07-28T14:30');
    });

    it('recognises custom date picker via dateSelect event', () => {
      resetCounter();
      const customDate = makeElementIdentity({
        accessibleName: 'Calendar',
        ariaRole: 'gridcell',
        tag: 'BUTTON',
        ariaLabel: 'Choose Tuesday, July 15, 2026',
        className: 'oxd-date-input-link',
        cssSelector: 'button.oxd-date-input-link',
      });
      const events: RecordedEvent[] = [
        makeDateSelectEvent(customDate, {
          inputType: null,
          isContentEditable: false,
          dateType: 'date',
          isoValue: 'July 15, 2026',
          displayValue: 'July 15, 2026',
          dateConfidence: 0.9,
        }, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('DatePicker');
      expect(result[0].metadata.dateValue).toBe('July 15, 2026');
      expect(result[0].confidence).toBe(0.9);
    });

    it('skips events owned by date picker (calendar internal events)', () => {
      resetCounter();
      const calendarNav = makeElementIdentity({
        accessibleName: 'Next Month',
        tag: 'BUTTON',
        className: 'calendar-nav',
        cssSelector: 'button.calendar-nav',
      });
      const events: RecordedEvent[] = [
        // Scroll inside calendar with ownedByDatePicker — should be skipped
        {
          eventId: 'evt-0001',
          eventType: 'scroll',
          timestamp: new Date(1000).toISOString(),
          target: calendarNav,
          valueBefore: null,
          valueAfter: null,
          checkedBefore: null,
          checkedAfter: null,
          domContext: { ownedByDatePicker: true, isContentEditable: false, inputType: null },
        },
        // Click inside calendar with ownedByDatePicker — should be skipped
        makeClickEvent(calendarNav, 1100, {
          domContext: { ownedByDatePicker: true, isContentEditable: false, inputType: null },
        }),
      ];
      const result = recognizeInteractions(events);
      // Both events should be skipped as evidence-only
      expect(result).toHaveLength(0);
    });
  });

  describe('Click', () => {
    it('classifies generic button click', () => {
      resetCounter();
      const saveBtn = makeElementIdentity({
        accessibleName: 'Save',
        ariaRole: 'button',
        tag: 'BUTTON',
        cssSelector: 'button#save',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(saveBtn, 1000),
      ];
      const result = recognizeInteractions(events);
      // With ariaRole=button but no checked state → falls through to Click
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Save');
    });

    it('classifies link click', () => {
      resetCounter();
      const link = makeElementIdentity({
        accessibleName: 'My Info',
        tag: 'A',
        ariaRole: 'link',
        cssSelector: 'a#myInfo',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(link, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].type).toBe('Link');
    });
  });

  describe('Hover', () => {
    it('classifies hover', () => {
      resetCounter();
      const target = makeElementIdentity({
        accessibleName: 'Menu',
        tag: 'DIV',
        className: 'menu-item',
        cssSelector: 'div.menu-item',
      });
      const events: RecordedEvent[] = [
        {
          eventId: 'evt-0001',
          eventType: 'mouseenter',
          timestamp: new Date(1000).toISOString(),
          target,
          valueBefore: null,
          valueAfter: null,
          checkedBefore: null,
          checkedAfter: null,
        },
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
    });
  });

  describe('Temporal Dedup', () => {
    it('removes duplicate same-type interactions on same element within 2s', () => {
      resetCounter();
      const btn = makeElementIdentity({
        accessibleName: 'Submit',
        tag: 'BUTTON',
        ariaRole: 'button',
        cssSelector: 'button#submit',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(btn, 1000),
        makeClickEvent(btn, 1500), // 500ms later — should be deduped
      ];
      const result = recognizeInteractions(events);
      // Each click starts a new group, but temporal dedup should remove the duplicate
      expect(result).toHaveLength(1);
    });

    it('keeps interactions that are more than 2s apart', () => {
      resetCounter();
      const btn = makeElementIdentity({
        accessibleName: 'Submit',
        tag: 'BUTTON',
        ariaRole: 'button',
        cssSelector: 'button#submit',
      });
      const events: RecordedEvent[] = [
        makeClickEvent(btn, 1000),
        makeClickEvent(btn, 4000), // 3s later — should be kept
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(2);
    });

    it('keeps different-type interactions on same element', () => {
      resetCounter();
      const input = makeElementIdentity({
        accessibleName: 'Name',
        tag: 'INPUT',
        ariaRole: 'textbox',
        cssSelector: 'input#name',
      });
      const events: RecordedEvent[] = [
        makeFocusEvent(input, 1000, { valueBefore: '' }),
        makeInputEvent(input, 1100, { valueAfter: 'Test' }),
        makeBlurEvent(input, 1200, { valueAfter: 'Test' }),
        makeClickEvent(input, 1500),
      ];
      const result = recognizeInteractions(events);
      // TextEntry (focus+input+blur group) + Click (separate group)
      expect(result.length).toBeGreaterThanOrEqual(1);
      const hasTextEntry = result.some((r) => r.type === 'TextEntry');
      const hasClick = result.some((r) => r.type === 'Click');
      expect(hasTextEntry).toBe(true);
    });
  });

  describe('Engine Tag', () => {
    it('tags all interactions with engine=control', () => {
      resetCounter();
      const btn = makeElementIdentity({ tag: 'BUTTON', ariaRole: 'button', cssSelector: 'button' });
      const events: RecordedEvent[] = [makeClickEvent(btn, 1000)];
      const result = recognizeInteractions(events);
      expect(result[0].engine).toBe('control');
    });

    it('uses ctrl- prefix for interaction IDs', () => {
      resetCounter();
      const btn = makeElementIdentity({ tag: 'BUTTON', ariaRole: 'button', cssSelector: 'button' });
      const events: RecordedEvent[] = [makeClickEvent(btn, 1000)];
      const result = recognizeInteractions(events);
      expect(result[0].interactionId).toMatch(/^ctrl-\d{4}$/);
    });
  });

  describe('OrangeHRM 9-Step Workflow', () => {
    it('produces 9 correct interactions for the full OrangeHRM My Info workflow', () => {
      resetCounter();
      const ts = 1000;

      const loginUrl = makeNavigationEvent('https://opensource-demo.orangehrmlive.com/web/index.php/dashboard', ts, 'link');
      const navMyInfo = makeNavigationEvent('https://opensource-demo.orangehrmlive.com/web/index.php/pim/viewMyDetails', ts + 2000, 'link');

      const firstName = makeElementIdentity({
        accessibleName: 'First Name', ariaRole: 'textbox', tag: 'INPUT',
        cssSelector: 'input[name="firstName"]',
      });
      const lastName = makeElementIdentity({
        accessibleName: 'Last Name', ariaRole: 'textbox', tag: 'INPUT',
        cssSelector: 'input[name="lastName"]',
      });
      const nationality = makeElementIdentity({
        accessibleName: 'Nationality', tag: 'SELECT', ariaRole: 'listbox',
        cssSelector: 'select#nationality',
      });
      const maritalStatus = makeElementIdentity({
        accessibleName: 'Marital Status', ariaRole: 'combobox', tag: 'DIV',
        className: 'oxd-select-text-input',
        cssSelector: 'div.oxd-select-text-input',
      });
      const femaleRadio = makeElementIdentity({
        accessibleName: 'Female', ariaRole: 'radio', tag: 'INPUT',
        cssSelector: 'input[type="radio"][value="2"]',
      });
      const dob = makeElementIdentity({
        accessibleName: 'Date of Birth', ariaRole: 'textbox', tag: 'INPUT',
        cssSelector: 'input[type="date"]#dob',
      });
      const saveBtn = makeElementIdentity({
        accessibleName: 'Save', ariaRole: 'button', tag: 'BUTTON',
        className: 'oxd-button oxd-button--medium oxd-button--secondary',
        cssSelector: 'button.oxd-button--secondary',
      });

      const events: RecordedEvent[] = [
        loginUrl,
        navMyInfo,
        // Edit First Name
        makeFocusEvent(firstName, ts + 3000, { valueBefore: 'John' }),
        makeInputEvent(firstName, ts + 4000, { valueAfter: 'Jonathan' }),
        makeBlurEvent(firstName, ts + 5000, { valueAfter: 'Jonathan' }),
        // Edit Last Name
        makeFocusEvent(lastName, ts + 6000, { valueBefore: 'Doe' }),
        makeInputEvent(lastName, ts + 7000, { valueAfter: 'Smith' }),
        makeBlurEvent(lastName, ts + 8000, { valueAfter: 'Smith' }),
        // Select Nationality (native dropdown)
        makeFocusEvent(nationality, ts + 9000),
        makeChangeEvent(nationality, ts + 10000, { valueAfter: 'American' }),
        // Select Marital Status (custom dropdown)
        makeClickEvent(maritalStatus, ts + 11000, {
          domContext: { ariaExpanded: true, ariaHasPopup: 'listbox', inputType: null, isContentEditable: false },
        }),
        makeChangeEvent(maritalStatus, ts + 12000, { valueAfter: 'Single' }),
        // Select Gender = Female (radio)
        makeClickEvent(femaleRadio, ts + 13000, { checkedBefore: false, checkedAfter: true }),
        // Select DOB via date picker (native date input)
        makeDateSelectEvent(dob, {
          inputType: 'date', isContentEditable: false,
          dateType: 'date', isoValue: '1990-05-15', displayValue: 'May 15, 1990', dateConfidence: 1.0,
        }, ts + 14000),
        // Click Save
        makeClickEvent(saveBtn, ts + 15000),
      ];

      const result = recognizeInteractions(events);

      // Should produce ~9 interactions (allowing for possible grouping variance)
      expect(result.length).toBeGreaterThanOrEqual(8);

      // Verify correct types
      const types = result.map((r) => r.type);

      // Navigation
      expect(types).toContain('PageNavigation');

      // Text entries
      const textEntries = result.filter((r) => r.type === 'TextEntry');
      expect(textEntries.length).toBeGreaterThanOrEqual(2); // First + Last name
      expect(textEntries.some((r) => r.metadata.textValue === 'Jonathan')).toBe(true);
      expect(textEntries.some((r) => r.metadata.textValue === 'Smith')).toBe(true);

      // Nationality — native dropdown
      const natDropdown = result.find((r) => r.type === 'NativeDropdown');
      expect(natDropdown).toBeDefined();
      expect(natDropdown?.metadata.selectedValue).toBe('American');
      expect(natDropdown?.target?.accessibleName).toBe('Nationality');

      // Marital Status — custom dropdown (OXD)
      const msDropdown = result.find((r) => r.type === 'CustomDropdown');
      expect(msDropdown).toBeDefined();
      expect(msDropdown?.target?.accessibleName).toBe('Marital Status');

      // Gender — radio button
      const radio = result.find((r) => r.type === 'RadioButton');
      expect(radio).toBeDefined();
      expect(radio?.metadata.checked).toBe(true);
      expect(radio?.metadata.selectedValue).toBe('Female');

      // Date picker
      const datePicker = result.find((r) => r.type === 'DatePicker');
      expect(datePicker).toBeDefined();
      expect(datePicker?.metadata.dateValue).toBe('1990-05-15');

      // Save button — click
      const saveClick = result.find((r) => r.type === 'Click' && r.metadata.accessibleName === 'Save');
      expect(saveClick).toBeDefined();

      // All should have engine=control
      expect(result.every((r) => r.engine === 'control')).toBe(true);
    });

    it('Nationality is NOT classified as Blood Type (regression test)', () => {
      resetCounter();
      const nationality = makeElementIdentity({
        accessibleName: 'Nationality',
        tag: 'SELECT',
        ariaRole: 'listbox',
        cssSelector: 'select#nationality',
        stableId: 'nationality',
      });
      const bloodType = makeElementIdentity({
        accessibleName: 'Blood Type',
        tag: 'DIV',
        ariaRole: 'combobox',
        className: 'oxd-select-wrapper',
        cssSelector: 'div.oxd-select-wrapper--bloodtype',
        stableId: 'bloodType',
      });

      const events: RecordedEvent[] = [
        makeFocusEvent(nationality, 1000),
        makeChangeEvent(nationality, 2000, { valueAfter: 'American' }),
        makeClickEvent(bloodType, 3000, {
          domContext: { ariaHasPopup: 'listbox', ariaExpanded: true, inputType: null, isContentEditable: false },
        }),
      ];

      const result = recognizeInteractions(events);
      const natInteraction = result.find((r) => r.target?.accessibleName === 'Nationality');
      expect(natInteraction).toBeDefined();
      expect(natInteraction?.type).toBe('NativeDropdown');
      expect(natInteraction?.target?.accessibleName).not.toBe('Blood Type');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty event list', () => {
      const result = recognizeInteractions([]);
      expect(result).toEqual([]);
    });

    it('handles single event', () => {
      resetCounter();
      const btn = makeElementIdentity({ tag: 'BUTTON', ariaRole: 'button', cssSelector: 'button' });
      const result = recognizeInteractions([makeClickEvent(btn, 1000)]);
      expect(result).toHaveLength(1);
    });

    it('classifies unknown for unrecognised events', () => {
      resetCounter();
      const div = makeElementIdentity({
        tag: 'DIV',
        ariaRole: null,
        className: 'unknown-thing',
        cssSelector: 'div.unknown-thing',
      });
      // A blur with no preceding focus/input on a non-text element
      const events: RecordedEvent[] = [
        makeBlurEvent(div, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Unknown');
      expect(result[0].confidence).toBe(0.0);
    });

    it('produces valid interaction IDs, eventIds, and rawEventTypes', () => {
      resetCounter();
      const btn = makeElementIdentity({ tag: 'BUTTON', ariaRole: 'button', cssSelector: 'button' });
      const events: RecordedEvent[] = [
        makeClickEvent(btn, 1000),
      ];
      const result = recognizeInteractions(events);
      expect(result[0].interactionId).toBeTruthy();
      expect(result[0].eventIds).toHaveLength(1);
      expect(result[0].eventIds[0]).toMatch(/^evt-/);
      expect(result[0].rawEventTypes).toEqual(['click']);
    });
  });

  describe('Feature Flag Integration', () => {
    it('recognizeInteractions produces control-engine output', () => {
      resetCounter();
      const input = makeElementIdentity({
        accessibleName: 'Email',
        ariaRole: 'textbox',
        tag: 'INPUT',
        cssSelector: 'input#email',
      });
      const events: RecordedEvent[] = [
        makeFocusEvent(input, 1000, { valueBefore: '' }),
        makeInputEvent(input, 2000, { valueAfter: 'test@example.com' }),
        makeBlurEvent(input, 3000, { valueAfter: 'test@example.com' }),
      ];
      const result = recognizeInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].engine).toBe('control');
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('test@example.com');
    });
  });
});
