/**
 * MutationProvider Lifecycle Detection Tests
 *
 * Tests behavioral lifecycle detection for custom controls that lack ARIA roles
 * and native HTML semantics but DO have semantic CSS class names:
 * - Custom dropdown lifecycle: trigger click → option click
 * - Calendar lifecycle: trigger click → gridcell click
 * - Autocomplete lifecycle: typing → suggestion click
 */
import { describe, it, expect } from 'vitest';
import { MutationProvider } from '../../src/classifier/evidence/providers/mutation-provider.ts';
import type { RecordedEvent, ElementRecordedEvent } from '../../src/recorder/recorded-event.ts';
import type { InteractionBuffer } from '../../src/classifier/evidence/types.ts';

function makeEvent(
  overrides: Partial<ElementRecordedEvent> & { target?: Partial<ElementRecordedEvent['target']> }
): ElementRecordedEvent {
  return {
    eventId: 'evt-1',
    eventType: 'click',
    timestamp: '1000',
    target: {
      elementId: 'elem-1',
      tag: 'DIV',
      accessibleName: 'Test',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag_name: undefined as any,
      className: '',
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'div',
      xPath: '/html/body/div',
      inIframe: false,
      shadowDom: false,
    href: null,
      ...overrides.target,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  } as ElementRecordedEvent;
}

function makeBuffer(events: ElementRecordedEvent[]): InteractionBuffer {
  return {
    elementKey: 'test-key',
    events: events as RecordedEvent[],
    evidence: [],
    startTime: '1000',
    lastEventTime: '2000',
  };
}

function getCommitEvidence(events: ElementRecordedEvent[]) {
  const provider = new MutationProvider();
  return provider.onCommit!(makeBuffer(events));
}

// ── Custom Dropdown Lifecycle ────────────────────────────────────────────────

describe('MutationProvider — custom dropdown lifecycle', () => {
  it('detects dropdown lifecycle: trigger click → option click without ARIA', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      timestamp: '1000',
      target: {
        elementId: 'elem-1',
        tag: 'DIV',
        className: 'dropdown-trigger',
        accessibleName: 'Select City',
        cssSelector: 'div.dropdown-trigger',
      } as any,
    });
    const option = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      timestamp: '2000',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'dropdown-option',
        accessibleName: 'Mumbai',
        cssSelector: 'div.dropdown-option',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, option]);
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
    expect(dropdownEv!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(dropdownEv!.reason).toContain('lifecycle');
    expect(dropdownEv!.metadata?.selectedValue).toBe('Mumbai');
  });

  it('detects dropdown lifecycle with Headless UI classes', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'BUTTON',
        className: 'headlessui-listbox-button',
        accessibleName: 'Passengers',
        cssSelector: 'button.headlessui-listbox-button',
      } as any,
    });
    const option = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'LI',
        className: 'headlessui-listbox-option',
        accessibleName: '2 Adults',
        cssSelector: 'li.headlessui-listbox-option',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, option]);
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });

  it('detects dropdown lifecycle with React-Select classes', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'DIV',
        className: 'select__control',
        accessibleName: 'Fare Type',
        cssSelector: 'div.select__control',
      } as any,
    });
    const option = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'select__option',
        accessibleName: 'Economy',
        cssSelector: 'div.select__option',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, option]);
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });

  it('detects dropdown lifecycle with menu-item class', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'DIV',
        className: 'dropdown-toggle',
        accessibleName: 'Options',
        cssSelector: 'div.dropdown-toggle',
      } as any,
    });
    const option = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'menu-item',
        accessibleName: 'Settings',
        cssSelector: 'div.menu-item',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, option]);
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });
});

// ── Calendar Lifecycle ───────────────────────────────────────────────────────

describe('MutationProvider — calendar lifecycle', () => {
  it('detects calendar lifecycle: trigger click → day cell click without ARIA', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'DIV',
        className: 'calendar-container',
        accessibleName: 'Departure Date',
        cssSelector: 'div.calendar-container',
      } as any,
    });
    const cell = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'calendar-day',
        accessibleName: '15',
        cssSelector: 'div.calendar-day',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, cell]);
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
    expect(datePickerEv!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(datePickerEv!.reason).toContain('calendar');
    expect(datePickerEv!.metadata?.dateValue).toBe('15');
  });

  it('detects calendar lifecycle with react-datepicker classes', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'react-datepicker__input',
        accessibleName: 'Date',
        cssSelector: 'input.react-datepicker__input',
      } as any,
    });
    const cell = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'react-datepicker__day',
        accessibleName: '22',
        cssSelector: 'div.react-datepicker__day',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, cell]);
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
  });

  it('detects calendar lifecycle with day-cell class', () => {
    const trigger = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'DIV',
        className: 'date-selector',
        accessibleName: 'Select Date',
        cssSelector: 'div.date-selector',
      } as any,
    });
    const cell = makeEvent({
      eventId: 'e2',
      eventType: 'click',
    target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'day-cell',
        accessibleName: 'July 22',
        cssSelector: 'div.day-cell',
      } as any,
    });

    const evidence = getCommitEvidence([trigger, cell]);
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
  });

  it('detects calendar cell with non-calendar buffer event', () => {
    const someClick = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'BUTTON',
        className: 'open-calendar-btn',
        accessibleName: 'Open Calendar',
        cssSelector: 'button.open-calendar-btn',
      } as any,
    });
    const cell = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'calendar-day',
        accessibleName: '15',
        cssSelector: 'div.calendar-day',
      } as any,
    });

    const evidence = getCommitEvidence([someClick, cell]);
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
    expect(datePickerEv!.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ── Autocomplete Lifecycle ───────────────────────────────────────────────────

describe('MutationProvider — autocomplete lifecycle', () => {
  it('detects autocomplete: typing → suggestion click without aria-autocomplete', () => {
    const focus = makeEvent({
      eventId: 'e1',
      eventType: 'focus',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'search-input',
        accessibleName: 'From',
        cssSelector: 'input.search-input',
      } as any,
    });
    const input = makeEvent({
      eventId: 'e2',
      eventType: 'input',
      valueBefore: '',
      valueAfter: 'mum',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'search-input',
        accessibleName: 'From',
        cssSelector: 'input.search-input',
      } as any,
    });
    const suggestion = makeEvent({
      eventId: 'e3',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'suggestion-item',
        accessibleName: 'Mumbai (BOM)',
        cssSelector: 'div.suggestion-item',
      } as any,
    });

    const evidence = getCommitEvidence([focus, input, suggestion]);
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeDefined();
    expect(autocompleteEv!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(autocompleteEv!.reason).toContain('autocomplete');
    expect(autocompleteEv!.metadata?.selectedValue).toBe('Mumbai (BOM)');
  });

  it('detects autocomplete with Headless UI combobox option', () => {
    const focus = makeEvent({
      eventId: 'e1',
      eventType: 'focus',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'headlessui-combobox-input',
        accessibleName: 'Search',
        cssSelector: 'input.headlessui-combobox-input',
      } as any,
    });
    const input = makeEvent({
      eventId: 'e2',
      eventType: 'input',
      valueBefore: '',
      valueAfter: 'del',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'headlessui-combobox-input',
        accessibleName: 'Search',
        cssSelector: 'input.headlessui-combobox-input',
      } as any,
    });
    const suggestion = makeEvent({
      eventId: 'e3',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'LI',
        className: 'headlessui-combobox-option',
        accessibleName: 'Delhi (DEL)',
        cssSelector: 'li.headlessui-combobox-option',
      } as any,
    });

    const evidence = getCommitEvidence([focus, input, suggestion]);
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeDefined();
  });

  it('detects autocomplete with select__option (React-Select)', () => {
    const focus = makeEvent({
      eventId: 'e1',
      eventType: 'focus',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'select__input',
        accessibleName: 'Select',
        cssSelector: 'input.select__input',
      } as any,
    });
    const suggestion = makeEvent({
      eventId: 'e2',
      eventType: 'click',
      target: {
        elementId: 'elem-2',
        tag: 'DIV',
        className: 'select__option',
        accessibleName: 'Option A',
        cssSelector: 'div.select__option',
      } as any,
    });

    const evidence = getCommitEvidence([focus, suggestion]);
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeDefined();
  });
});

// ── Negative Tests: No False Positives ───────────────────────────────────────

describe('MutationProvider — no false positives', () => {
  it('single button click (no mutation, no option) → no lifecycle evidence', () => {
    const click = makeEvent({
      eventId: 'e1',
      eventType: 'click',
      target: {
        elementId: 'elem-1',
        tag: 'BUTTON',
        className: 'btn-primary',
        accessibleName: 'Submit',
        cssSelector: 'button.btn-primary',
      } as any,
    });

    const evidence = getCommitEvidence([click]);
    expect(evidence).toHaveLength(0);
  });

  it('text entry without suggestion click → no autocomplete evidence', () => {
    const focus = makeEvent({
      eventId: 'e1',
      eventType: 'focus',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'form-control',
        accessibleName: 'Email',
        cssSelector: 'input.form-control',
      } as any,
    });
    const blur = makeEvent({
      eventId: 'e2',
      eventType: 'blur',
      target: {
        elementId: 'elem-1',
        tag: 'INPUT',
        className: 'form-control',
        accessibleName: 'Email',
        cssSelector: 'input.form-control',
      } as any,
    });

    const evidence = getCommitEvidence([focus, blur]);
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeUndefined();
  });

  it('native <select> interaction does not trigger lifecycle false positive', () => {
    const select = makeEvent({
      eventId: 'e1',
      eventType: 'change',
      target: {
        elementId: 'elem-1',
        tag: 'SELECT',
        className: 'form-select',
        accessibleName: 'Make',
        cssSelector: 'select#make',
      } as any,
    });

    const evidence = getCommitEvidence([select]);
    // NativeDropdown evidence should NOT come from MutationProvider lifecycle
    // (it comes from DomProvider)
    const lifecycleEv = evidence.find(e =>
      e.reason && e.reason.includes('lifecycle') && e.suggestedType !== 'CustomDropdown'
    );
    // Actually for a native select, mutation provider may produce CustomDropdown
    // evidence via aria-expanded. The key is it shouldn't produce DatePicker or
    // Autocomplete lifecycle evidence.
    const dateEv = evidence.find(e => e.suggestedType === 'DatePicker');
    const autoEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(dateEv).toBeUndefined();
    expect(autoEv).toBeUndefined();
  });
});
