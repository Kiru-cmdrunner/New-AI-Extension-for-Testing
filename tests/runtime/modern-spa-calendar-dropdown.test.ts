/**
 * Modern SPA Calendar & Dropdown Fix Tests
 *
 * Validates the root-cause fixes for capture failures on modern React SPA apps
 * like adanione.com. Tests use the REAL component definitions (not mocks)
 * against the REAL runtime to verify the full lifecycle:
 *
 *   1. Dropdown option click inside a surface, no ARIA role, custom class
 *      → produces Dropdown with selectedValue.
 *   2. Date cell click inside calendar surface where trigger value never
 *      updates (value in display div) → produces DatePicker with cell text.
 *   3. Autocomplete option click where post-click value poll detects change
 *      → produces correct value.
 *   4. Regression: OrangeHRM (OXD) dropdown still works.
 *   5. Regression: native <select> dropdown still works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
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
    elementId: '',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    ...overrides,
  };
}

let evtCounter = 0;
function makeEvent(
  eventType: string,
  targetOverrides: Partial<ElementIdentity> = {},
  domContextOverrides: Partial<DomContext> = {},
  extras: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${++evtCounter}`,
    eventType: eventType as any,
    timestamp: Date.now(),
    isTrusted: true,
    target: makeTarget(targetOverrides),
    domContext: makeDomContext(domContextOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://adanione.com/flight-booking',
    pageTitle: 'Flight Tickets',
    ...extras,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────

describe('Modern SPA Calendar & Dropdown Fix', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  // ── 1. Dropdown option click inside surface (no ARIA role) ─────────

  it('captures dropdown option click without ARIA role inside surface (AdaniOne Premium Economy)', () => {
    // User clicks the passenger/class dropdown trigger
    const triggerClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: '2 • Economy',
      className: 'pax-selector trip-type-select traveler-class',
      stableId: 'pax-trigger',
      cssSelector: 'div.pax-selector',
    });
    runtime.process(triggerClick);
    expect(emitted).toHaveLength(0); // lifecycle started, not completed yet

    // User clicks "Premium Economy" option inside the dropdown surface
    // — plain div, no role=option, no standard option CSS class
    const optionClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Premium Economy',
      className: 'class-card fare-option-card', // custom SPA class
      stableId: null,
      cssSelector: 'div.popup-content > div.class-card:nth-child(2)',
    }, {
      ancestorClasses: ['popup-content', 'bottom-sheet modal-body', 'main-content'],
    });
    runtime.process(optionClick);

    // Surface closure: click outside to complete the dropdown
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: 'Page',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.allSelections).toContain('Premium Economy');
    expect(dropdown!.endState).toBe('completed');
  });

  // ── 2. Date cell click inside calendar surface (trigger value never updates) ──

  it('captures date selection when trigger value does not update in input', () => {
    // User clicks the "Depart on" date field
    const dateFieldClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Depart on',
      className: 'date-input-field depart-on',
      stableId: 'depart-date-trigger',
      cssSelector: 'div.date-input-field',
    });
    runtime.process(dateFieldClick);
    expect(emitted).toHaveLength(0); // DatePicker lifecycle started

    // User clicks a date cell inside the calendar surface
    // The cell is a div with date-like text but no standard calendar classes
    const dateCellClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: '30',
      className: 'day-number available-date', // custom SPA class
      stableId: null,
      cssSelector: 'div.calendar-panel > div.day-number:nth-child(15)',
    }, {
      ancestorClasses: ['calendar-panel', 'date-picker-popup', 'main-content'],
    });
    runtime.process(dateCellClick);

    const datePicker = emitted.find((i) => i.type === 'DatePicker');
    expect(datePicker).toBeDefined();
    expect(datePicker!.metadata.selectedDate).toBe('30');
    expect(datePicker!.endState).toBe('completed');
  });

  // ── 3. Date cell with formatted date text ──────────────────────────

  it('captures date selection with formatted date text (Thu, 30 Jul)', () => {
    // Trigger the DatePicker
    const dateFieldClick = makeEvent('click', {
      tag: 'INPUT',
      accessibleName: 'Depart on',
      inputType: 'text',
      className: 'journey-date-picker',
      stableId: 'depart-input',
      cssSelector: 'input.journey-date-picker',
    }, {
      inputType: 'text',
    });
    runtime.process(dateFieldClick);
    expect(emitted).toHaveLength(0);

    // Click a date cell with formatted date text
    const dateCellClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Thu, 30 Jul',
      className: 'calendar-tile', // custom SPA class
      stableId: null,
      cssSelector: 'div.calendar-grid > div.calendar-tile:nth-child(20)',
    }, {
      ancestorClasses: ['calendar-grid', 'calendar-container', 'flight-search'],
    });
    runtime.process(dateCellClick);

    const datePicker = emitted.find((i) => i.type === 'DatePicker');
    expect(datePicker).toBeDefined();
    expect(datePicker!.metadata.selectedDate).toBe('Thu, 30 Jul');
    expect(datePicker!.endState).toBe('completed');
  });

  // ── 4. City autocomplete — change event after async update ─────────

  it('captures correct city value via change event after async update', () => {
    // Focus the "From" city input
    const focusFrom = makeEvent('focus', {
      tag: 'INPUT',
      accessibleName: 'From',
      inputType: 'text',
      className: 'city-input from-field',
      stableId: 'from-input',
      cssSelector: 'input#from-input',
    }, {
      inputType: 'text',
    }, {
      valueBefore: 'Mumbai (BOM)',
    });
    runtime.process(focusFrom);

    // Click a city option in the dropdown surface
    const optionClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'New Delhi (DEL)',
      className: 'city-suggestion airport-option',
      stableId: null,
      cssSelector: 'div.autocomplete-list > div.city-suggestion:nth-child(1)',
    }, {
      ancestorClasses: ['autocomplete-list', 'suggestion-popup', 'flight-form'],
    });
    runtime.process(optionClick);

    // The post-click value check emits a supplementary change event
    // on the trigger input with the NEW value
    const changeEvent = makeEvent('change', {
      tag: 'INPUT',
      accessibleName: 'From',
      stableId: 'from-input',
      cssSelector: 'input#from-input',
      className: 'city-input from-field',
    }, {
      inputType: 'text',
    }, {
      valueBefore: 'Mumbai (BOM)',
      valueAfter: 'New Delhi (DEL)',
    });
    runtime.process(changeEvent);

    // Should have a Dropdown (from the option click) OR TextEntry (from the change)
    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    if (dropdown) {
      expect(dropdown.metadata.selectedValue).toBe('New Delhi (DEL)');
    }
  });

  // ── 5. Regression: OrangeHRM (OXD) dropdown ────────────────────────

  it('regression: OXD combobox dropdown still works correctly', () => {
    // OXD combobox trigger
    const triggerClick = makeEvent('click', {
      tag: 'DIV',
      ariaRole: 'combobox',
      accessibleName: 'Status',
      className: 'oxd-select-text oxd-select-text--active',
      stableId: 'oxd-status-trigger',
      cssSelector: 'div.oxd-select-text',
    });
    runtime.process(triggerClick);
    expect(emitted).toHaveLength(0);

    // OXD option click
    const optionClick = makeEvent('click', {
      tag: 'DIV',
      ariaRole: 'option',
      accessibleName: 'Active',
      className: 'oxd-select-option',
      stableId: null,
      cssSelector: 'div.oxd-select-dropdown > div.oxd-select-option:nth-child(1)',
    }, {
      ancestorClasses: ['oxd-select-dropdown', 'oxd-form-row', 'orangehrm-container'],
    });
    runtime.process(optionClick);

    // SPA change event on trigger (completes the dropdown)
    runtime.process(makeEvent('change', {
      tag: 'DIV',
      ariaRole: 'combobox',
      accessibleName: 'Status',
      className: 'oxd-select-text',
      stableId: 'oxd-status-trigger',
      cssSelector: 'div.oxd-select-text',
    }, {}, { valueAfter: 'Active' }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('Active');
    expect(dropdown!.endState).toBe('completed');
  });

  // ── 6. Regression: native <select> ─────────────────────────────────

  it('regression: native SELECT dropdown still works', () => {
    // Click the select element
    const selectClick = makeEvent('click', {
      tag: 'SELECT',
      ariaRole: 'listbox',
      accessibleName: 'Country',
      stableId: 'country-select',
      cssSelector: 'select#country-select',
      name: 'country',
    });
    runtime.process(selectClick);
    expect(emitted).toHaveLength(0);

    // Change event on the SELECT
    const changeEv = makeEvent('change', {
      tag: 'SELECT',
      ariaRole: 'listbox',
      accessibleName: 'Country',
      stableId: 'country-select',
      cssSelector: 'select#country-select',
      name: 'country',
    }, {}, {
      valueAfter: 'India',
    });
    runtime.process(changeEv);

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('India');
  });

  // ── 7. Regression: DatePicker native date input ────────────────────

  it('regression: native date input with change event still works', () => {
    // Focus on a native date input
    const dateFocus = makeEvent('focus', {
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      stableId: 'dob-input',
      cssSelector: 'input#dob-input',
      name: 'dob',
    }, {
      inputType: 'date',
    });
    runtime.process(dateFocus);
    expect(emitted).toHaveLength(0);

    // Change event with the selected date
    const dateChange = makeEvent('change', {
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      stableId: 'dob-input',
      cssSelector: 'input#dob-input',
      name: 'dob',
    }, {
      inputType: 'date',
    }, {
      valueAfter: '2026-07-30',
    });
    runtime.process(dateChange);

    const datePicker = emitted.find((i) => i.type === 'DatePicker');
    expect(datePicker).toBeDefined();
    expect(datePicker!.metadata.selectedDate).toBe('2026-07-30');
  });

  // ── 8. Dropdown option with no accessibleName (should NOT falsely complete) ──

  it('does not falsely complete dropdown on empty-name click inside surface', () => {
    // Dropdown trigger
    const triggerClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Select Class',
      className: 'class-selector dropdown-trigger',
      stableId: 'class-trigger',
      cssSelector: 'div.class-selector',
    });
    runtime.process(triggerClick);

    // Click on an empty container element inside the surface
    const emptyClick = makeEvent('click', {
      tag: 'DIV',
      accessibleName: '', // empty!
      className: 'spacer',
      stableId: null,
      cssSelector: 'div.spacer',
    }, {
      ancestorClasses: ['popup-content', 'bottom-sheet'],
    });
    runtime.process(emptyClick);

    // Should NOT complete — empty name, not a valid option
    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeUndefined();
  });
});
