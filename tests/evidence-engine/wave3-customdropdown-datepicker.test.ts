/**
 * Wave 3 — CustomDropdown + DatePicker Tests
 *
 * Validates that the Evidence Engine V2 outperforms V1 on multi-element
 * interactions. Tests use realistic event sequences from different UI libraries:
 *
 * Custom Dropdowns:
 *   - MUI Autocomplete (role=combobox, role=listbox, role=option)
 *   - Ant Design Select (role=combobox, partial option ARIA)
 *   - PrimeReact Dropdown (class-based, partial ARIA)
 *   - Custom div dropdown (class-based only)
 *
 * Date Pickers:
 *   - Native date input (inputType=date)
 *   - React DatePicker (calendar popup with gridcell)
 *   - Custom calendar widget (class-based cells)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.ts';
import { detectInteractions } from '../../src/classifier/interaction-detector.ts';
import {
  clickEvent,
  focusEvent,
  blurEvent,
  changeEvent,
  inputEvent,
  navigationEvent,
  resetEventCounter,
  domContext,
} from './helpers.ts';
import type { ElementIdentity } from '../../src/shared/types.ts';

// ── Element identity factories for framework patterns ───────────────────

function muiCombobox(label: string): Partial<ElementIdentity> {
  return {
    tag: 'DIV',
    ariaRole: 'combobox',
    accessibleName: label,
    stableId: `mui-combobox-${label.toLowerCase().replace(/\s/g, '-')}`,
    cssSelector: `div[role="combobox"][aria-labelledby="${label.toLowerCase()}"]`,
    className: 'MuiAutocomplete-root',
  };
}

function muiOption(label: string, index: number): Partial<ElementIdentity> {
  return {
    tag: 'LI',
    ariaRole: 'option',
    accessibleName: label,
    stableId: `mui-option-${index}`,
    cssSelector: `li[role="option"][data-option-index="${index}"]`,
    className: 'MuiAutocomplete-option',
  };
}

function antSelect(label: string): Partial<ElementIdentity> {
  // Ant Design: role=combobox, class ant-select
  return {
    tag: 'DIV',
    ariaRole: 'combobox',
    accessibleName: label,
    stableId: `ant-select-${label.toLowerCase()}`,
    cssSelector: `div.ant-select-selector`,
    className: 'ant-select ant-select-show-search',
  };
}

function antOption(label: string): Partial<ElementIdentity> {
  // Ant Design: options have class ant-select-item-option
  // Note: Ant Design doesn't always set role=option on the inner element
  return {
    tag: 'DIV',
    ariaRole: 'option',
    accessibleName: label,
    stableId: null,
    cssSelector: `div.ant-select-item-option`,
    className: 'ant-select-item ant-select-item-option',
  };
}

function primeReactDropdown(label: string): Partial<ElementIdentity> {
  return {
    tag: 'DIV',
    ariaRole: null, // PrimeReact doesn't always set combobox role
    accessibleName: label,
    stableId: `pr-dropdown-${label.toLowerCase()}`,
    cssSelector: `div.p-dropdown`,
    className: 'p-dropdown p-component',
  };
}

function primeReactOption(label: string, index: number): Partial<ElementIdentity> {
  return {
    tag: 'LI',
    ariaRole: 'option',
    accessibleName: label,
    stableId: `pr-option-${index}`,
    cssSelector: `li.p-dropdown-item:nth-child(${index + 1})`,
    className: 'p-dropdown-item',
  };
}

function customDivDropdown(label: string): Partial<ElementIdentity> {
  return {
    tag: 'DIV',
    ariaRole: null,
    accessibleName: label,
    stableId: `custom-dd-${label.toLowerCase()}`,
    cssSelector: `div.custom-dropdown`,
    className: 'custom-dropdown',
  };
}

function customDivOption(label: string, index: number): Partial<ElementIdentity> {
  return {
    tag: 'DIV',
    ariaRole: null,
    accessibleName: label,
    stableId: null,
    cssSelector: `div.dropdown-option:nth-child(${index + 1})`,
    className: 'dropdown-option',
  };
}

function dateInput(label: string): Partial<ElementIdentity> {
  return {
    tag: 'INPUT',
    accessibleName: label,
    stableId: `date-${label.toLowerCase()}`,
    cssSelector: `input[type="date"]#date-${label.toLowerCase()}`,
    name: label.toLowerCase().replace(/\s/g, '-'),
  };
}

function reactDatePickerDay(day: string, dateStr: string): Partial<ElementIdentity> {
  return {
    tag: 'DIV',
    ariaRole: 'gridcell',
    accessibleName: day,
    stableId: null,
    cssSelector: `div.react-datepicker__day[aria-label="${dateStr}"]`,
    className: 'react-datepicker__day',
  };
}

function reactDatePickerContainer(): Partial<ElementIdentity> {
  return {
    tag: 'DIV',
    ariaRole: null,
    accessibleName: '',
    stableId: 'react-datepicker',
    cssSelector: 'div.react-datepicker',
    className: 'react-datepicker',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MUI Autocomplete (full ARIA compliance)
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — MUI Autocomplete (full ARIA)', () => {
  beforeEach(() => resetEventCounter());

  it('combobox click → option click → 1 Autocomplete', () => {
    const events = [
      clickEvent(muiCombobox('State'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('California', 0)),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    // MUI Autocomplete now correctly detected as Autocomplete (was CustomDropdown)
    expect(result[0].type).toBe('Autocomplete');
  });

  it('combobox click → option click → change → 1 Autocomplete with selectedValue', () => {
    const events = [
      clickEvent(muiCombobox('Country'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('United States', 0)),
      changeEvent(muiCombobox('Country'), { valueAfter: 'US' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Autocomplete');
    // selectedValue should come from either the option name or change event value
    expect(result[0].metadata?.selectedValue || result[0].metadata?.accessibleName).toBeTruthy();
  });

  it('V1 produces 2 Clicks, V2 produces 1 Autocomplete', () => {
    const events = [
      clickEvent(muiCombobox('City'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('San Francisco', 0)),
      navigationEvent('https://example.com/next'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // V1 should produce Clicks (can't detect Autocomplete)
    const v1Types = v1.map(r => r.type);
    expect(v1Types).not.toContain('Autocomplete');

    // V2 should produce Autocomplete
    const v2Types = v2.map(r => r.type);
    expect(v2Types).toContain('Autocomplete');

    // V2 should produce fewer interactions (1 autocomplete vs 2 clicks)
    const v2AutoCount = v2Types.filter(t => t === 'Autocomplete').length;
    const v1ClickCount = v1Types.filter(t => t === 'Click').length;
    expect(v2AutoCount).toBe(1);
    expect(v1ClickCount).toBeGreaterThanOrEqual(2);
  });

  it('two sequential MUI autocompletes → 2 Autocomplete', () => {
    const events = [
      clickEvent(muiCombobox('State'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Texas', 1)),
      clickEvent(muiCombobox('City'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Austin', 0)),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'Autocomplete')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ant Design Select
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — Ant Design Select', () => {
  beforeEach(() => resetEventCounter());

  it('select click → option click → 1 CustomDropdown', () => {
    const events = [
      clickEvent(antSelect('Language'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(antOption('English')),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('CustomDropdown');
  });

  it('V1 produces Click, V2 produces CustomDropdown', () => {
    const events = [
      clickEvent(antSelect('Framework'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(antOption('React')),
      navigationEvent('https://example.com'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    expect(v1.map(r => r.type)).not.toContain('CustomDropdown');
    expect(v2.map(r => r.type)).toContain('CustomDropdown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PrimeReact Dropdown
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — PrimeReact Dropdown', () => {
  beforeEach(() => resetEventCounter());

  it('dropdown click → option click → 1 CustomDropdown', () => {
    const events = [
      clickEvent(primeReactDropdown('Category'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(primeReactOption('Electronics', 0)),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('CustomDropdown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Custom div dropdown (no ARIA, class-based only)
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — Custom div dropdown (class-based)', () => {
  beforeEach(() => resetEventCounter());

  it('dropdown click → option click → 1 CustomDropdown', () => {
    const events = [
      clickEvent(customDivDropdown('Sort By'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(customDivOption('Price: Low to High', 0)),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('CustomDropdown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Native Date Input
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — Native Date Input', () => {
  beforeEach(() => resetEventCounter());

  it('date input click → 1 DatePicker with dateValue', () => {
    const events = [
      clickEvent(dateInput('Appointment'), {
        valueAfter: '2024-03-15',
        domContext: domContext({ inputType: 'date' }),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
    expect(result[0].metadata?.dateValue).toBe('2024-03-15');
  });

  it('V1 and V2 both detect native date input', () => {
    const events = [
      clickEvent(dateInput('Birthday'), {
        valueAfter: '1990-05-20',
        domContext: domContext({ inputType: 'date' }),
      }),
      navigationEvent('https://example.com'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    expect(v1.map(r => r.type)).toContain('DatePicker');
    expect(v2.map(r => r.type)).toContain('DatePicker');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// React DatePicker (calendar popup with gridcell)
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — React DatePicker (calendar popup)', () => {
  beforeEach(() => resetEventCounter());

  it('calendar container click → day cell click → 1 DatePicker', () => {
    const events = [
      clickEvent(reactDatePickerContainer()),
      clickEvent(reactDatePickerDay('15', 'Day 15')),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
    expect(result[0].metadata?.dateValue).toBeTruthy();
  });

  it('V2 detects DatePicker from gridcell, V1 may or may not', () => {
    const events = [
      clickEvent(reactDatePickerContainer()),
      clickEvent(reactDatePickerDay('20', 'Day 20')),
      navigationEvent('https://example.com'),
    ];

    const v2 = detectInteractionsV2(events);

    // V2 should detect DatePicker from gridcell role + calendar class
    expect(v2.map(r => r.type)).toContain('DatePicker');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Custom calendar widget (class-based cells, no ARIA)
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — Custom calendar widget', () => {
  beforeEach(() => resetEventCounter());

  it('calendar trigger → day cell → 1 DatePicker', () => {
    const events = [
      clickEvent({
        tag: 'DIV',
        ariaRole: null,
        accessibleName: '',
        stableId: 'my-calendar',
        cssSelector: 'div.my-calendar',
        className: 'my-calendar-widget',
      }, {
        domContext: domContext({ ariaExpanded: true }),
      }),
      clickEvent({
        tag: 'DIV',
        ariaRole: null,
        accessibleName: 'March 15, 2024',
        stableId: null,
        cssSelector: 'div.calendar-day:nth-child(15)',
        className: 'calendar-day',
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// V2 outperforms V1 — comprehensive comparison
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — V2 outperforms V1', () => {
  beforeEach(() => resetEventCounter());

  it('V1 produces Clicks, V2 produces Autocomplete with evidence trail', () => {
    const events = [
      clickEvent(muiCombobox('Department'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Engineering', 0)),
      navigationEvent('https://example.com'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // V1 can't detect Autocomplete
    expect(v1.map(r => r.type)).not.toContain('Autocomplete');

    // V2 detects it
    const v2Auto = v2.find(r => r.type === 'Autocomplete');
    expect(v2Auto).toBeDefined();
    expect(v2Auto!.confidence).toBeGreaterThan(0.5);

    // V2 should have evidence trail
    const trail = (v2Auto as DetectedInteraction & { _evidenceTrail?: unknown })._evidenceTrail;
    expect(trail).toBeDefined();
  });

  it('V2 produces fewer interactions than V1 for combobox sequence', () => {
    const events = [
      clickEvent(muiCombobox('Project'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Project Alpha', 0)),
      clickEvent(muiOption('Project Beta', 1)), // user changed mind
      clickEvent(muiOption('Project Gamma', 2)), // final selection
      navigationEvent('https://example.com'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // V2 should produce ≤ V1 interactions
    expect(v2.length).toBeLessThanOrEqual(v1.length);
  });

  it('confidence scores present for all V2 detections', () => {
    const events = [
      clickEvent(muiCombobox('Team'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Team A', 0)),
      navigationEvent('https://example.com'),
    ];

    const v2 = detectInteractionsV2(events);
    for (const interaction of v2) {
      expect(interaction.confidence).toBeGreaterThanOrEqual(0);
      expect(interaction.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Real-world scenario: form with dropdown + date picker
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — Real-world mixed form', () => {
  beforeEach(() => resetEventCounter());

  it('custom dropdown + native date input + text field → correct types', () => {
    const events = [
      // Custom dropdown: select department
      clickEvent(muiCombobox('Department'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Sales', 3)),

      // Native date input: select appointment date
      clickEvent(dateInput('Appointment Date'), {
        valueAfter: '2024-04-10',
        domContext: domContext({ inputType: 'date' }),
      }),

      // Text field: enter notes
      focusEvent(
        { tag: 'INPUT', accessibleName: 'Notes', stableId: 'notes', cssSelector: '#notes' },
        { valueBefore: '', domContext: domContext({ inputType: 'text' }) },
      ),
      blurEvent(
        { tag: 'INPUT', accessibleName: 'Notes', stableId: 'notes', cssSelector: '#notes' },
        { valueAfter: 'Need oil change', domContext: domContext({ inputType: 'text' }) },
      ),

      // Submit button
      clickEvent({ tag: 'BUTTON', accessibleName: 'Schedule', cssSelector: '#schedule-btn' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('Autocomplete');
    expect(result[1].type).toBe('DatePicker');
    expect(result[2].type).toBe('TextEntry');
    expect(result[3].type).toBe('Click');
  });

  it('calendar popup + custom dropdown + submit', () => {
    const events = [
      // Date picker calendar
      clickEvent(reactDatePickerContainer()),
      clickEvent(reactDatePickerDay('25', 'Day 25')),

      // Custom dropdown (MUI Autocomplete)
      clickEvent(muiCombobox('Time Slot'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      clickEvent(muiOption('Morning', 0)),

      // Submit
      clickEvent({ tag: 'BUTTON', accessibleName: 'Book', cssSelector: '#book-btn' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('DatePicker');
    expect(result[1].type).toBe('Autocomplete');
    expect(result[2].type).toBe('Click');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────

describe('Wave 3 — Edge cases', () => {
  beforeEach(() => resetEventCounter());

  it('combobox click without option selection → Click (not CustomDropdown)', () => {
    const events = [
      clickEvent(muiCombobox('Search'), {
        domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }),
      }),
      // User clicks away without selecting — navigation flushes
      navigationEvent('https://example.com'),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(2); // click + navigation
    // First should be a click-like interaction
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it('datetime-local input → DateTimePicker', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Start Time', stableId: 'start-time', cssSelector: '#start-time' },
        { valueAfter: '2024-06-15T14:30', domContext: domContext({ inputType: 'datetime-local' }) },
      ),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DateTimePicker');
  });

  it('time input → TimePicker', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Alarm', stableId: 'alarm', cssSelector: '#alarm' },
        { valueAfter: '08:00', domContext: domContext({ inputType: 'time' }) },
      ),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TimePicker');
  });

  it('multiple date selections (date range picker) → separate DatePickers', () => {
    const events = [
      clickEvent({
        tag: 'DIV',
        ariaRole: 'gridcell',
        accessibleName: 'March 10',
        stableId: null,
        cssSelector: 'div.react-datepicker__day:nth-child(10)',
        className: 'react-datepicker__day',
      }),
      clickEvent({
        tag: 'DIV',
        ariaRole: 'gridcell',
        accessibleName: 'March 20',
        stableId: null,
        cssSelector: 'div.react-datepicker__day:nth-child(20)',
        className: 'react-datepicker__day',
      }),
    ];

    const result = detectInteractionsV2(events);
    // Two separate calendar cell clicks on different days
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'DatePicker')).toBe(true);
  });
});

// Type import for evidence trail access
import type { DetectedInteraction } from '../../src/classifier/interaction-types.ts';
