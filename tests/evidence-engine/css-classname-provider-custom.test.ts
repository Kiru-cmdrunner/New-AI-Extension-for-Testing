/**
 * Tests for expanded CSS Classname Provider — Headless UI, React-Select,
 * react-datepicker, and broader generic custom control patterns.
 */
import { describe, it, expect } from 'vitest';
import { CssClassnameProvider } from '../../src/classifier/evidence/providers/css-classname-provider.ts';
import type { RecordedEvent } from '../../src/recorder/recorded-event.ts';
import type { InteractionBuffer } from '../../src/classifier/evidence/types.ts';

const emptyBuffer: InteractionBuffer = { events: [] } as unknown as InteractionBuffer;

function makeEvent(className: string, eventType: string = 'click'): RecordedEvent {
  return {
    id: 'test-1',
    eventType: eventType as any,
    timestamp: 1000,
    target: {
      tag: 'DIV',
      id: '',
      className,
      cssSelector: `div.${className}`,
      xpath: '/html/body/div',
      ariaRole: null,
      ariaLabel: null,
      textContent: 'Test',
    },
  } as unknown as RecordedEvent;
}

function getEvidence(className: string, eventType: string = 'click') {
  const provider = new CssClassnameProvider();
  const events = provider.onEvent(makeEvent(className, eventType), emptyBuffer);
  return events;
}

// ── Headless UI ──────────────────────────────────────────────────────────────

describe('CssClassnameProvider — Headless UI patterns', () => {
  it('headlessui-listbox-option → CustomDropdown', () => {
    const evidence = getEvidence('headlessui-listbox-option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.75);
    expect(evidence[0].weight).toBe(0.7);
    expect(evidence[0].reason).toContain('Headless UI');
  });

  it('headlessui-listbox-button → CustomDropdown', () => {
    const evidence = getEvidence('headlessui-listbox-button');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('headlessui-combobox-input → Autocomplete', () => {
    const evidence = getEvidence('headlessui-combobox-input');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Autocomplete');
    expect(evidence[0].confidence).toBe(0.8);
    expect(evidence[0].weight).toBe(0.75);
  });

  it('headlessui-combobox-option → Autocomplete', () => {
    const evidence = getEvidence('headlessui-combobox-option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Autocomplete');
  });

  it('headlessui-menu-item → CustomDropdown', () => {
    const evidence = getEvidence('headlessui-menu-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.7);
    expect(evidence[0].weight).toBe(0.65);
  });

  it('headlessui-menu-button → CustomDropdown', () => {
    const evidence = getEvidence('headlessui-menu-button');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('headlessui-disclosure-button → Click', () => {
    const evidence = getEvidence('headlessui-disclosure-button');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Click');
  });

  it('headlessui-tabs-tab → Tab', () => {
    const evidence = getEvidence('headlessui-tabs-tab');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Tab');
  });

  it('headlessui-switch → ToggleSwitch', () => {
    const evidence = getEvidence('headlessui-switch');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('ToggleSwitch');
  });

  it('unknown headlessui prefix → no false match', () => {
    const evidence = getEvidence('headlessui-unknown-widget');
    expect(evidence).toHaveLength(0);
  });
});

// ── React-Select ─────────────────────────────────────────────────────────────

describe('CssClassnameProvider — React-Select patterns', () => {
  it('select__control → CustomDropdown', () => {
    const evidence = getEvidence('select__control');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.75);
    expect(evidence[0].weight).toBe(0.7);
    expect(evidence[0].reason).toContain('React-Select');
  });

  it('select__option → CustomDropdown', () => {
    const evidence = getEvidence('select__option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.7);
    expect(evidence[0].weight).toBe(0.65);
  });

  it('select__value-container → CustomDropdown', () => {
    const evidence = getEvidence('select__value-container');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('select__input → Autocomplete', () => {
    const evidence = getEvidence('select__input');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Autocomplete');
    expect(evidence[0].confidence).toBe(0.7);
    expect(evidence[0].weight).toBe(0.65);
  });

  it('select__menu → CustomDropdown', () => {
    const evidence = getEvidence('select__menu');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('select__indicator → CustomDropdown', () => {
    const evidence = getEvidence('select__indicator');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.6);
    expect(evidence[0].weight).toBe(0.55);
  });

  it('custom prefix: my-select__option → CustomDropdown', () => {
    const evidence = getEvidence('my-select__option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].reason).toContain('React-Select');
  });

  it('non-select prefix: my-app__option → no match', () => {
    const evidence = getEvidence('my-app__option');
    expect(evidence).toHaveLength(0);
  });
});

// ── react-datepicker ─────────────────────────────────────────────────────────

describe('CssClassnameProvider — react-datepicker patterns', () => {
  it('react-datepicker__day → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__day');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
    expect(evidence[0].confidence).toBe(0.85);
    expect(evidence[0].weight).toBe(0.8);
    expect(evidence[0].reason).toContain('react-datepicker');
  });

  it('react-datepicker__day--selected → DatePicker (modifier stripped)', () => {
    const evidence = getEvidence('react-datepicker__day--selected');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('react-datepicker__month → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__month');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
    expect(evidence[0].confidence).toBe(0.7);
  });

  it('react-datepicker__month-container → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__month-container');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('react-datepicker__year → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__year');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('react-datepicker__input → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__input');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('react-datepicker__time → TimePicker', () => {
    const evidence = getEvidence('react-datepicker__time');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('TimePicker');
    expect(evidence[0].confidence).toBe(0.75);
  });

  it('react-datepicker__day-name → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__day-name');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('react-datepicker__header → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__header');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('react-datepicker__container → DatePicker', () => {
    const evidence = getEvidence('react-datepicker__container');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });
});

// ── Expanded Generic Dropdown Patterns ───────────────────────────────────────

describe('CssClassnameProvider — expanded generic dropdown patterns', () => {
  it('dropdown-trigger → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-trigger');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.65);
    expect(evidence[0].weight).toBe(0.6);
  });

  it('dropdown-toggle → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-toggle');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('dropdown-menu → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-menu');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('dropdown-list → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-list');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('dropdown-item → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('dropdown-option → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('exact class "dropdown" → CustomDropdown', () => {
    const evidence = getEvidence('dropdown');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('exact class "listbox" → CustomDropdown', () => {
    const evidence = getEvidence('listbox');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('select-option → CustomDropdown', () => {
    const evidence = getEvidence('select-option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('select-item → CustomDropdown', () => {
    const evidence = getEvidence('select-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('list-option → CustomDropdown', () => {
    const evidence = getEvidence('list-option');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('combo-box → CustomDropdown', () => {
    const evidence = getEvidence('combo-box');
    expect(evidence).toHaveLength(1);
    const dropdown = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdown).toBeDefined();
  });
});

// ── Expanded Generic Calendar/Date Patterns ──────────────────────────────────

describe('CssClassnameProvider — expanded generic calendar patterns', () => {
  it('calendar-day → DatePicker', () => {
    const evidence = getEvidence('calendar-day');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
    expect(evidence[0].confidence).toBe(0.7);
    expect(evidence[0].weight).toBe(0.65);
  });

  it('calendar-cell → DatePicker', () => {
    const evidence = getEvidence('calendar-cell');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('date-cell → DatePicker', () => {
    const evidence = getEvidence('date-cell');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('datepicker-day → DatePicker', () => {
    const evidence = getEvidence('datepicker-day');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('day-cell → DatePicker', () => {
    const evidence = getEvidence('day-cell');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('calendar-container → DatePicker', () => {
    const evidence = getEvidence('calendar-container');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('calendar-grid → DatePicker', () => {
    const evidence = getEvidence('calendar-grid');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('date-selector → DatePicker', () => {
    const evidence = getEvidence('date-selector');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });

  it('picker-day → DatePicker', () => {
    const evidence = getEvidence('picker-day');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DatePicker');
  });
});

// ── Expanded Generic Menu/Option Patterns ────────────────────────────────────

describe('CssClassnameProvider — expanded generic option patterns', () => {
  it('menu-item → CustomDropdown', () => {
    const evidence = getEvidence('menu-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('option-item → CustomDropdown', () => {
    const evidence = getEvidence('option-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('suggestion-item → CustomDropdown', () => {
    const evidence = getEvidence('suggestion-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });
});

// ── CSS-in-JS Hashed Class Exclusion ─────────────────────────────────────────

describe('CssClassnameProvider — CSS-in-JS hashed class exclusion', () => {
  it('css-1abc2de → no false match', () => {
    const evidence = getEvidence('css-1abc2de');
    expect(evidence).toHaveLength(0);
  });

  it('css-h2x9f0 → no false match', () => {
    const evidence = getEvidence('css-h2x9f0');
    expect(evidence).toHaveLength(0);
  });

  it('sc-abc123 (styled-components) → no false match', () => {
    // styled-components uses sc-* prefix — not in our patterns, naturally excluded
    const evidence = getEvidence('sc-abc123');
    expect(evidence).toHaveLength(0);
  });

  it('mixed classes: semantic + hashed → only semantic matched', () => {
    const provider = new CssClassnameProvider();
    const events = provider.onEvent(
      makeEvent('css-1abc2de dropdown-option flex items-center'),
      emptyBuffer
    );
    // Should match dropdown-option, not css-1abc2de or Tailwind utilities
    const types = events.map(e => e.suggestedType);
    expect(types).toContain('CustomDropdown');
    expect(types).not.toContain('Click');
    expect(events).toHaveLength(1); // Only dropdown-option matches
  });
});

// ── Regression: existing framework patterns still work ───────────────────────

describe('CssClassnameProvider — regression: existing patterns still work', () => {
  it('MUI MuiSelect-root → CustomDropdown', () => {
    const evidence = getEvidence('MuiSelect-root');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.8);
    expect(evidence[0].weight).toBe(0.75);
    expect(evidence[0].reason).toContain('MUI');
  });

  it('AntD ant-select → CustomDropdown', () => {
    const evidence = getEvidence('ant-select');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
    expect(evidence[0].confidence).toBe(0.8);
    expect(evidence[0].reason).toContain('AntD');
  });

  it('Bootstrap dropdown-item → CustomDropdown', () => {
    const evidence = getEvidence('dropdown-item');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('CustomDropdown');
  });

  it('MUI MuiCheckbox-root → Checkbox', () => {
    const evidence = getEvidence('MuiCheckbox-root');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Checkbox');
    expect(evidence[0].confidence).toBe(0.85);
  });

  it('generic autocomplete → Autocomplete (not overwritten by new patterns)', () => {
    const evidence = getEvidence('autocomplete-input');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Autocomplete');
    expect(evidence[0].confidence).toBe(0.7);
  });

  it('generic breadcrumb → Breadcrumb (not overwritten)', () => {
    const evidence = getEvidence('breadcrumb');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Breadcrumb');
  });

  it('no className → no evidence', () => {
    const provider = new CssClassnameProvider();
    const events = provider.onEvent(
      { id: 'e1', eventType: 'click', timestamp: 1000, target: { className: '' } } as unknown as RecordedEvent,
      emptyBuffer
    );
    expect(events).toHaveLength(0);
  });

  it('random non-semantic class → no false match', () => {
    const evidence = getEvidence('flex items-center justify-between');
    const event = makeEvent('flex items-center justify-between');
    const provider = new CssClassnameProvider();
    const events = provider.onEvent(event, emptyBuffer);
    expect(events).toHaveLength(0);
  });
});
