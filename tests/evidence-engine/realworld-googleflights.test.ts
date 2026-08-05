/**
 * Real-World Validation: Google Flights / Airline Booking Flow
 *
 * Tests built from actual DOM inspection of Google Flights (google.com/travel/flights).
 * Google Flights uses Material Design components with full ARIA compliance:
 *
 *   - Airport autocomplete: <input role="combobox" aria-haspopup="true" aria-expanded="false">
 *   - Class dropdown: <div role="combobox" aria-haspopup="listbox">
 *     - <span role="listbox"> container
 *     - <ul role="listbox"> with <li role="option"> items
 *   - Date picker: <input> opens calendar popup
 *
 * Pattern matches Adani One-style flight booking: departure/destination autocomplete,
 * passenger/class dropdown, departure date picker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.ts';
import { detectInteractions } from '../../src/classifier/interaction-detector.ts';
import {
  clickEvent, focusEvent, blurEvent, changeEvent, inputEvent,
  navigationEvent, resetEventCounter, domContext,
} from './helpers.ts';

// ── Element identities matching Google Flights / Material Design ────────

// Airport autocomplete input: role=combobox, aria-haspopup=true, aria-expanded changes
const departureInput = {
  tag: 'INPUT', ariaRole: 'combobox',
  accessibleName: 'Where from?',
  stableId: null,
  cssSelector: 'input[role="combobox"][aria-label="Where from?"]',
  className: 'II2One j0Ppje zmMKJ LbIaRd',
};

const destinationInput = {
  tag: 'INPUT', ariaRole: 'combobox',
  accessibleName: 'Where to?',
  stableId: null,
  cssSelector: 'input[role="combobox"][aria-label="Where to?"]',
  className: 'II2One j0Ppje zmMKJ LbIaRd',
};

// Autocomplete suggestion option (Material Design listbox option)
function googleOption(label: string, index: number) {
  return {
    tag: 'LI', ariaRole: 'option',
    accessibleName: label,
    stableId: null,
    cssSelector: `li[role="option"]:nth-child(${index + 1})`,
    className: 'MCs1Pd UbEQCe VfPpkd-OkbHre',
  };
}

// Travel class dropdown: div role=combobox, aria-haspopup=listbox
const classDropdown = {
  tag: 'DIV', ariaRole: 'combobox',
  accessibleName: 'Passenger class',
  stableId: null,
  cssSelector: 'div[role="combobox"][aria-haspopup="listbox"]',
  className: 'VfPpkd-TkwUic',
};

// Travel class option
function classOption(label: string, index: number) {
  return {
    tag: 'LI', ariaRole: 'option',
    accessibleName: label,
    stableId: null,
    cssSelector: `ul[role="listbox"] li[role="option"]:nth-child(${index + 1})`,
    className: 'MCs1Pd UbEQCe VfPpkd-OkbHre',
  };
}

// Date input: Google Flights uses text inputs for dates
const departureDateInput = {
  tag: 'INPUT', ariaRole: null,
  accessibleName: 'Departure',
  stableId: null,
  cssSelector: 'input[aria-label="Departure"]',
  className: 'TP4Lpb eoY5cb j0Ppje',
};

// Calendar cell (after opening the date picker)
function calendarCell(label: string) {
  return {
    tag: 'DIV', ariaRole: 'gridcell',
    accessibleName: label,
    stableId: null,
    cssSelector: `div[role="gridcell"][aria-label="${label}"]`,
    className: 'calendar-day',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Airport Autocomplete (MUI-style combobox with real ARIA)
// ─────────────────────────────────────────────────────────────────────────

describe('Real-World: Google Flights airport autocomplete', () => {
  beforeEach(() => resetEventCounter());

  it('departure selection: focus → type → option click → 1 CustomDropdown', () => {
    // Real flow: user clicks departure, types "jfk", clicks suggestion
    const events = [
      clickEvent(departureInput, {
        domContext: domContext({ ariaExpanded: false, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      // User types - focus then input events
      focusEvent(departureInput, {
        valueBefore: '',
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      inputEvent(departureInput, {
        valueAfter: 'j',
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      inputEvent(departureInput, {
        valueAfter: 'jf',
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      inputEvent(departureInput, {
        valueAfter: 'jfk',
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      // User clicks the suggestion option
      clickEvent(googleOption('John F. Kennedy International Airport', 0)),
    ];

    const v2 = detectInteractionsV2(events);
    // The combobox + option should be grouped as 1 CustomDropdown
    expect(v2).toHaveLength(1);
    expect(v2[0].type).toBe('CustomDropdown');
    expect(v2[0].confidence).toBeGreaterThan(0.5);
  });

  it('V1 produces Click(s), V2 produces CustomDropdown', () => {
    const events = [
      clickEvent(departureInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('JFK Airport', 0)),
      navigationEvent('https://google.com/travel/flights'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // V1 can't detect CustomDropdown
    expect(v1.map(r => r.type)).not.toContain('CustomDropdown');
    // V2 detects it
    expect(v2.map(r => r.type)).toContain('CustomDropdown');
  });

  it('both departure and destination autocomplete → 2 CustomDropdown', () => {
    const events = [
      // Departure selection
      clickEvent(departureInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('San Francisco (SFO)', 0)),
      // Destination selection
      clickEvent(destinationInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('New York (JFK)', 0)),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(2);
    expect(v2.every(r => r.type === 'CustomDropdown')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Travel Class Dropdown (Material Design combobox → listbox → option)
// ─────────────────────────────────────────────────────────────────────────

describe('Real-World: Google Flights class dropdown', () => {
  beforeEach(() => resetEventCounter());

  it('class selection: click combobox → click option → 1 CustomDropdown', () => {
    const events = [
      clickEvent(classDropdown, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(classOption('Economy', 0)),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(1);
    expect(v2[0].type).toBe('CustomDropdown');
  });

  it('selecting Business class → CustomDropdown with selectedValue', () => {
    const events = [
      clickEvent(classDropdown, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(classOption('Business', 2)),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(1);
    expect(v2[0].type).toBe('CustomDropdown');
    expect(v2[0].confidence).toBeGreaterThan(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Date Picker (input → calendar popup → gridcell click)
// ─────────────────────────────────────────────────────────────────────────

describe('Real-World: Google Flights date picker', () => {
  beforeEach(() => resetEventCounter());

  it('departure date: click date input → click calendar cell → 1 DatePicker', () => {
    const events = [
      clickEvent(departureDateInput),
      clickEvent(calendarCell('March 15, 2024')),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(1);
    expect(v2[0].type).toBe('DatePicker');
  });

  it('V1 vs V2 on date picker', () => {
    const events = [
      clickEvent(departureDateInput),
      clickEvent(calendarCell('April 20, 2024')),
      navigationEvent('https://google.com/travel/flights'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    const v2Types = v2.map(r => r.type);
    expect(v2Types).toContain('DatePicker');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Complete flight booking flow
// ─────────────────────────────────────────────────────────────────────────

describe('Real-World: Complete Google Flights booking flow', () => {
  beforeEach(() => resetEventCounter());

  it('departure + destination + class + date → 4 interactions', () => {
    const events = [
      // Departure airport autocomplete
      clickEvent(departureInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('Los Angeles (LAX)', 0)),

      // Destination airport autocomplete
      clickEvent(destinationInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('Tokyo (NRT)', 0)),

      // Travel class dropdown
      clickEvent(classDropdown, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(classOption('First', 3)),

      // Departure date
      clickEvent(departureDateInput),
      clickEvent(calendarCell('May 15, 2024')),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(4);
    expect(v2[0].type).toBe('CustomDropdown');   // departure
    expect(v2[1].type).toBe('CustomDropdown');   // destination
    expect(v2[2].type).toBe('CustomDropdown');   // class
    expect(v2[3].type).toBe('DatePicker');        // date
  });

  it('V2 outperforms V1: CustomDropdown vs Click for autocomplete', () => {
    const events = [
      clickEvent(departureInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('Chicago (ORD)', 0)),
      navigationEvent('https://google.com/travel/flights'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // V2 produces fewer interactions (1 dropdown vs 2 clicks)
    expect(v2.length).toBeLessThanOrEqual(v1.length);

    // V2 detects CustomDropdown
    expect(v2.map(r => r.type)).toContain('CustomDropdown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Evidence trail inspection
// ─────────────────────────────────────────────────────────────────────────

describe('Real-World: Evidence trail and confidence', () => {
  beforeEach(() => resetEventCounter());

  it('CustomDropdown has evidence trail from multiple providers', () => {
    const events = [
      clickEvent(departureInput, {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'true', inputType: 'text' }),
      }),
      clickEvent(googleOption('Dallas (DFW)', 0)),
      navigationEvent('https://example.com'),
    ];

    const v2 = detectInteractionsV2(events);
    const dropdown = v2.find(r => r.type === 'CustomDropdown');

    expect(dropdown).toBeDefined();
    expect(dropdown!.confidence).toBeGreaterThan(0.5);
    expect(dropdown!.confidence).toBeLessThanOrEqual(1.0);

    // Evidence trail should exist (it's attached as _evidenceTrail)
    const trail = (dropdown as DetectedInteraction & { _evidenceTrail?: unknown })._evidenceTrail;
    expect(trail).toBeDefined();
  });

  it('NativeDropdown confidence for native <select>', () => {
    const events = [
      {
        eventId: 'evt-0001',
        eventType: 'click' as const,
        timestamp: new Date().toISOString(),
        target: { tag: 'SELECT', accessibleName: 'Make', cssSelector: '#make-input', className: 'gxp-select',
          ariaRole: null, ariaLabel: null, ariaLabelledBy: null, placeholder: null, name: '',
          stableId: 'make-input', testId: null, dataCy: null, dataQa: null, xPath: '',
          inIframe: true, shadowDom: false, href: null, elementId: 'el-1' },
        valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
        domContext: domContext({ inputType: null }),
      },
      {
        eventId: 'evt-0002',
        eventType: 'change' as const,
        timestamp: new Date().toISOString(),
        target: { tag: 'SELECT', accessibleName: 'Make', cssSelector: '#make-input', className: 'gxp-select',
          ariaRole: null, ariaLabel: null, ariaLabelledBy: null, placeholder: null, name: '',
          stableId: 'make-input', testId: null, dataCy: null, dataQa: null, xPath: '',
          inIframe: true, shadowDom: false, href: null, elementId: 'el-1' },
        valueBefore: 'FORD', valueAfter: 'HONDA', checkedBefore: null, checkedAfter: null,
        domContext: domContext({ inputType: null }),
      },
    ];

    const v2 = detectInteractionsV2(events as Parameters<typeof detectInteractionsV2>[0]);
    expect(v2).toHaveLength(1);
    expect(v2[0].type).toBe('NativeDropdown');
    // Native <select> should get high confidence from DomProvider (0.99) + EventSequence
    expect(v2[0].confidence).toBeGreaterThan(0.8);
  });
});

import type { DetectedInteraction } from '../../src/classifier/interaction-types.ts';
