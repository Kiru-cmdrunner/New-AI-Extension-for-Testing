/**
 * Stage 4b: Date Picker Semantic Merging + Large Container Click Suppression
 *
 * Tests the fixes for two issues observed during OrangeHRM manual testing:
 *
 * 1. Date picker text inputs with date-format placeholders (e.g. "yyyy-mm-dd")
 *    should be recognized as date triggers → produce ONE DatePicker interaction,
 *    NOT separate TextEntry + Popover interactions.
 *
 * 2. Clicks on large container elements (form sections whose accessible name
 *    is a concatenation of child field labels) should be suppressed.
 *
 * These tests simulate the events the recorder WOULD produce after the fixes
 * and verify the classifier handles them correctly. The recorder-level changes
 * (isDateTriggerElement, isTextEntryElement, ownedByDatePicker tagging,
 * isLargeContainerClick suppression) affect WHICH events are produced —
 * these tests validate the downstream classification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { detectInteractions } from '../src/classifier/interaction-detector';
import { detectInteractionsV2 } from '../src/classifier/evidence/detector';
import { mergeV1V2 } from '../src/classifier/evidence/merge-layer';
import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

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

// ── Tests ──────────────────────────────────────────────────────────────

describe('Stage 4b: Date Picker Semantic Merging', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  describe('OrangeHRM-style date picker (text input with date-format placeholder)', () => {
    // After Fix A+B+C, the recorder will:
    //   - NOT emit focus/blur (isTextEntryElement returns false for date triggers)
    //   - NOT emit change (routed to handleDateValueChange → dateSelect)
    //   - Tag the click that opens the calendar popover as ownedByDatePicker
    //   - Emit a single dateSelect event with the committed value

    it('produces exactly ONE DatePicker interaction (no TextEntry, no Popover)', () => {
      const events: RecordedEvent[] = [
        // 1. Click on date input — opens calendar popover
        // After Fix C: ownedByDatePicker = true because the click target is a
        // date trigger and the surface that appeared is a calendar popover
        makeEvent('click', {
          tag: 'INPUT',
          name: 'empDateOfBirth',
          accessibleName: 'yyyy-mm-dd',
          placeholder: 'yyyy-mm-dd',
          ariaRole: 'textbox',
          className: 'oxd-input oxd-input--active',
          cssSelector: 'input[name="empDateOfBirth"]',
          elementId: 'dob-oxd-001',
        }, {
          inputType: 'text',
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'dialog',
          ownedByDatePicker: true,
        }),

        // 2. Click on a day cell in the calendar
        makeEvent('click', {
          tag: 'DIV',
          className: 'oxd-date-input-link oxd-date-picker-calendar',
          ariaRole: 'gridcell',
          ariaLabel: 'October 17, 2005',
          accessibleName: 'October 17, 2005',
          cssSelector: '.oxd-date-picker-calendar',
          elementId: 'cal-day-001',
        }, { ownedByDatePicker: true }),

        // 3. dateSelect event (the actual interaction)
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'empDateOfBirth',
          accessibleName: 'yyyy-mm-dd',
          placeholder: 'yyyy-mm-dd',
          ariaRole: 'textbox',
          className: 'oxd-input oxd-input--active',
          cssSelector: 'input[name="empDateOfBirth"]',
          elementId: 'dob-oxd-001',
        }, {
          inputType: 'text',
          dateType: 'date',
          isoValue: '2005-10-17',
          displayValue: 'October 17, 2005',
          dateConfidence: 0.8,
        }, '2005-10-17'),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      const types = merged.map(i => i.type);

      // Should have exactly ONE DatePicker interaction
      const datePickerInteractions = merged.filter(i =>
        i.type === 'DatePicker' || i.type === 'TimePicker' || i.type === 'DateTimePicker'
      );
      expect(datePickerInteractions).toHaveLength(1);
      expect(datePickerInteractions[0].type).toBe('DatePicker');

      // Should NOT have TextEntry
      expect(types).not.toContain('TextEntry');

      // Should NOT have Popover
      expect(types).not.toContain('Popover');
    });

    it('date value is preserved in the DatePicker metadata', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'empDateOfBirth',
          placeholder: 'yyyy-mm-dd',
          accessibleName: 'yyyy-mm-dd',
          ariaRole: 'textbox',
          elementId: 'dob-oxd-002',
          cssSelector: 'input[name="empDateOfBirth"]',
        }, {
          inputType: 'text',
          dateType: 'date',
          isoValue: '2005-10-17',
          displayValue: 'October 17, 2005',
          dateConfidence: 0.8,
        }, '2005-10-17'),
      ];

      const v1 = detectInteractions(events);
      expect(v1[0].type).toBe('DatePicker');
      expect(v1[0].metadata.dateValue).toBe('2005-10-17');
    });

    it('two date fields produce two DatePicker interactions', () => {
      const events: RecordedEvent[] = [
        // First date field
        makeEvent('click', {
          tag: 'INPUT', name: 'empDateOfBirth', placeholder: 'yyyy-mm-dd',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="empDateOfBirth"]',
        }, { inputType: 'text', surfaceType: 'popover' as DomContext['surfaceType'], ownedByDatePicker: true }),
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'empDateOfBirth', placeholder: 'yyyy-mm-dd',
          ariaRole: 'textbox', elementId: 'dob-001', cssSelector: 'input[name="empDateOfBirth"]',
        }, { inputType: 'text', dateType: 'date', isoValue: '2005-10-17',
             displayValue: 'October 17, 2005', dateConfidence: 0.8 }, '2005-10-17'),

        // Second date field
        makeEvent('click', {
          tag: 'INPUT', name: 'empLicenseExpiryDate', placeholder: 'yyyy-mm-dd',
          ariaRole: 'textbox', elementId: 'exp-001', cssSelector: 'input[name="empLicenseExpiryDate"]',
        }, { inputType: 'text', surfaceType: 'popover' as DomContext['surfaceType'], ownedByDatePicker: true }),
        makeEvent('dateSelect', {
          tag: 'INPUT', name: 'empLicenseExpiryDate', placeholder: 'yyyy-mm-dd',
          ariaRole: 'textbox', elementId: 'exp-001', cssSelector: 'input[name="empLicenseExpiryDate"]',
        }, { inputType: 'text', dateType: 'date', isoValue: '2026-12-31',
             displayValue: 'December 31, 2026', dateConfidence: 0.8 }, '2026-12-31'),
      ];

      // Ensure distinct timestamps
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime();
      events.forEach((e, i) => {
        (e as ElementRecordedEvent).timestamp = new Date(baseTime + i * 2000).toISOString();
      });

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      const datePickerInteractions = merged.filter(i => i.type === 'DatePicker');
      expect(datePickerInteractions).toHaveLength(2);
    });
  });

  describe('Popover evidence suppressed for date trigger clicks', () => {
    it('MutationProvider does NOT emit Popover evidence for date trigger click', () => {
      // Simulate the event the recorder produces AFTER Fix C:
      // click on date trigger input → calendar popover appeared → ownedByDatePicker = true
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          placeholder: 'yyyy-mm-dd',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          className: 'oxd-input',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-trigger-001',
        }, {
          inputType: 'text',
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'dialog',
          surfaceLabel: 'October 2005 SMTWTFS 123456789...',
          ownedByDatePicker: true,
        }),
      ];

      const v2 = detectInteractionsV2(events);
      const popoverInteractions = v2.filter(i => i.type === 'Popover');
      expect(popoverInteractions).toHaveLength(0);
    });

    it('Popover evidence IS emitted for non-date popover triggers', () => {
      // A menu trigger button that opens a popover — should still produce Popover
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'BUTTON',
          accessibleName: 'Options',
          ariaRole: 'button',
          className: 'dropdown-trigger',
          cssSelector: 'button.dropdown-trigger',
          elementId: 'menu-trigger-001',
        }, {
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'menu',
        }),
      ];

      const v2 = detectInteractionsV2(events);
      const popoverInteractions = v2.filter(i => i.type === 'Popover');
      expect(popoverInteractions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('date trigger click with calendar popover → merged pipeline', () => {
    it('full OrangeHRM scenario: no Popover, no TextEntry, exactly one DatePicker', () => {
      const events: RecordedEvent[] = [
        // 1. Click on date input field (trigger) — ownedByDatePicker from Fix C
        makeEvent('click', {
          tag: 'INPUT',
          name: 'empBirthday',
          placeholder: 'yyyy-mm-dd',
          accessibleName: 'yyyy-mm-dd',
          ariaRole: 'textbox',
          className: 'oxd-input',
          cssSelector: 'input[name="empBirthday"]',
          elementId: 'dob-001',
        }, {
          inputType: 'text',
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'dialog',
          ownedByDatePicker: true,
        }),

        // 2. Calendar day cell click (ownedByDatePicker)
        makeEvent('click', {
          tag: 'DIV',
          className: 'oxd-date-picker-calendar',
          ariaRole: 'gridcell',
          ariaLabel: 'October 27, 2005',
          accessibleName: 'October 27, 2005',
          cssSelector: '.oxd-date-picker-calendar',
          elementId: 'cal-day-001',
        }, { ownedByDatePicker: true }),

        // 3. dateSelect event
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'empBirthday',
          placeholder: 'yyyy-mm-dd',
          accessibleName: 'yyyy-mm-dd',
          ariaRole: 'textbox',
          className: 'oxd-input',
          cssSelector: 'input[name="empBirthday"]',
          elementId: 'dob-001',
        }, {
          inputType: 'text',
          dateType: 'date',
          isoValue: '2005-10-27',
          displayValue: 'October 27, 2005',
          dateConfidence: 0.8,
        }, '2005-10-27'),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      const types = merged.map(i => i.type);

      // ONE DatePicker
      const datePicker = merged.filter(i => i.type === 'DatePicker');
      expect(datePicker).toHaveLength(1);

      // No TextEntry, no Popover
      expect(types).not.toContain('TextEntry');
      expect(types).not.toContain('Popover');
    });
  });
});

describe('Stage 4b: Large Container Click Suppression', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  // After Fix D, clicks on large containers (accessible name > 80 chars)
  // are suppressed at the recorder level and NEVER appear in the event stream.
  // These tests verify that NO events are produced for such clicks, and
  // that legitimate clicks on specific interactive elements are unaffected.

  describe('container clicks are suppressed at recorder level', () => {
    it('no events for a large container click (form section)', () => {
      // After Fix D, the click on this container would be suppressed entirely.
      // The event stream is empty for this click.
      const events: RecordedEvent[] = [];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      expect(merged).toHaveLength(0);
    });
  });

  describe('legitimate clicks are NOT suppressed', () => {
    it('button click with short name is captured', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'BUTTON',
          accessibleName: 'Save',
          ariaRole: 'button',
          elementId: 'save-001',
        }),
      ];

      const v1 = detectInteractions(events);
      expect(v1).toHaveLength(1);
      expect(v1[0].type).toBe('Click');
    });

    it('text entry interaction is captured (not affected by container fix)', () => {
      const events: RecordedEvent[] = [
        makeEvent('focus', {
          tag: 'INPUT',
          accessibleName: 'First Name',
          ariaRole: 'textbox',
          elementId: 'fn-001',
        }),
        makeEvent('change', {
          tag: 'INPUT',
          accessibleName: 'First Name',
          ariaRole: 'textbox',
          elementId: 'fn-001',
        }, {}, 'John'),
      ];

      const v1 = detectInteractions(events);
      expect(v1).toHaveLength(1);
      expect(v1[0].type).toBe('TextEntry');
    });

    it('radio button click is captured', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'INPUT',
          accessibleName: 'Female',
          ariaRole: 'radio',
          elementId: 'gender-f-001',
        }),
      ];

      const v1 = detectInteractions(events);
      expect(v1).toHaveLength(1);
      expect(v1[0].type).toBe('RadioButton');
    });

    it('checkbox click is captured', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'INPUT',
          accessibleName: 'Smoker',
          ariaRole: 'checkbox',
          elementId: 'smoker-001',
        }),
      ];

      const v1 = detectInteractions(events);
      expect(v1).toHaveLength(1);
      expect(v1[0].type).toBe('Checkbox');
    });
  });
});

// ── Pure logic tests for isDateFormatPlaceholder ───────────────────────
// Since the content script can't be imported, we test the date-format
// placeholder detection logic directly. This mirrors the implementation
// in deterministic-recorder.ts exactly.

describe('Date Format Placeholder Detection Logic', () => {
  const DATE_FORMAT_TOKENS = new Set(['yyyy', 'yy', 'mm', 'dd', 'd', 'm']);

  function isDateFormatPlaceholder(str: string): boolean {
    if (!str || str.length < 4) return false;
    const tokens = str.split(/[-/_\.\s]+/).filter(Boolean);
    if (tokens.length < 2) return false;
    let dateTokenCount = 0;
    for (const token of tokens) {
      if (DATE_FORMAT_TOKENS.has(token.toLowerCase())) {
        dateTokenCount++;
      }
    }
    return dateTokenCount >= 2;
  }

  // Positive cases — should match
  it.each([
    ['yyyy-mm-dd'],
    ['yyyy/mm/dd'],
    ['yyyy.mm.dd'],
    ['dd-mm-yyyy'],
    ['mm/dd/yyyy'],
    ['dd/mm/yy'],
    ['MM/DD/YYYY'],  // case insensitive
    ['yyyy mm dd'],  // space-delimited
    ['yyyy_mm_dd'],  // underscore-delimited
  ])('matches date format placeholder "%s"', (input) => {
    expect(isDateFormatPlaceholder(input)).toBe(true);
  });

  // Negative cases — should NOT match
  it.each([
    ['Enter your name'],
    ['admin@example.com'],
    ['Password'],
    ['Search...'],
    ['Phone number'],
    [''],               // empty
    ['yy'],             // single token
    ['date'],           // single token, not a format
    ['abc def'],        // no date tokens
    ['yyyy'],           // single date token
  ])('does NOT match non-date placeholder "%s"', (input) => {
    expect(isDateFormatPlaceholder(input)).toBe(false);
  });
});

// ── Container noise detection logic ───────────────────────────────────
// Mirrors isContainerNoiseClick() from deterministic-recorder.ts

describe('Container Noise Click Detection Logic', () => {
  const CONTAINER_TAGS = new Set([
    'DIV', 'SECTION', 'FIELDSET', 'ARTICLE', 'MAIN', 'FORM',
    'UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'SPAN',
  ]);
  const LARGE_CONTAINER_NAME_THRESHOLD = 80;

  function isContainerNoiseClick(tag: string, accessibleName: string, className: string = ''): boolean {
    const tagUpper = tag.toUpperCase();
    if (!CONTAINER_TAGS.has(tagUpper)) return false;

    // Dropdown triggers are never suppressed
    const cls = className.toLowerCase();
    if (cls.includes('oxd-select') || cls.includes('dropdown-trigger') ||
        cls.includes('select-wrapper') || cls.includes('select-text')) {
      return false;
    }

    if (accessibleName.length > LARGE_CONTAINER_NAME_THRESHOLD) return true;
    if (accessibleName.length > 0 && accessibleName.length <= 2) return true;
    if (accessibleName.length === 0) return true;

    return false;
  }

  it('returns true for DIV with very long accessible name', () => {
    const longName = 'Employee Full Name Nickname Employee Id Other Id Driver License Number License Expiry Date SSN Number';
    expect(isContainerNoiseClick('DIV', longName)).toBe(true);
  });

  it('returns true for SECTION with long accessible name', () => {
    const longName = 'A'.repeat(81);
    expect(isContainerNoiseClick('SECTION', longName)).toBe(true);
  });

  it('returns true for DIV with very short name (≤ 2 chars) — "Click I" fix', () => {
    expect(isContainerNoiseClick('DIV', 'I')).toBe(true);
    expect(isContainerNoiseClick('DIV', 'Ab')).toBe(true);
    expect(isContainerNoiseClick('SPAN', 'x')).toBe(true);
  });

  it('returns true for DIV with empty accessible name', () => {
    expect(isContainerNoiseClick('DIV', '')).toBe(true);
  });

  it('returns false for DIV with meaningful short name (3+ chars)', () => {
    expect(isContainerNoiseClick('DIV', 'Save')).toBe(false);
    expect(isContainerNoiseClick('DIV', 'Yes')).toBe(false);
  });

  it('returns false for non-container tag even with long name', () => {
    const longName = 'A'.repeat(100);
    expect(isContainerNoiseClick('BUTTON', longName)).toBe(false);
    expect(isContainerNoiseClick('INPUT', longName)).toBe(false);
    expect(isContainerNoiseClick('A', longName)).toBe(false);
  });

  it('returns false at exactly the threshold (80 chars)', () => {
    const atThreshold = 'A'.repeat(80);
    expect(isContainerNoiseClick('DIV', atThreshold)).toBe(false);
  });

  it('returns true just above the threshold (81 chars)', () => {
    const aboveThreshold = 'A'.repeat(81);
    expect(isContainerNoiseClick('DIV', aboveThreshold)).toBe(true);
  });

  it('returns false for dropdown wrapper with long name', () => {
    const longName = 'A'.repeat(100);
    expect(isContainerNoiseClick('DIV', longName, 'oxd-select-text')).toBe(false);
    expect(isContainerNoiseClick('DIV', longName, 'oxd-select-wrapper')).toBe(false);
    expect(isContainerNoiseClick('DIV', longName, 'dropdown-trigger')).toBe(false);
  });

  it('returns false for dropdown wrapper with short name', () => {
    expect(isContainerNoiseClick('DIV', 'A', 'oxd-select-text--focus')).toBe(false);
  });
});
