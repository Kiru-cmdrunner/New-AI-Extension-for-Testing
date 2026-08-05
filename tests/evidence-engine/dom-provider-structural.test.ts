/**
 * DomProvider Structural Heuristics Tests
 *
 * Tests data-attribute-based detection of custom controls that lack ARIA roles
 * and CSS framework classes but DO have semantic data attributes:
 * - data-testid, data-cy, data-qa with dropdown/option/date/calendar/suggestion keywords
 */
import { describe, it, expect } from 'vitest';
import { DomProvider } from '../../src/classifier/evidence/providers/dom-provider.ts';
import type { RecordedEvent, ElementRecordedEvent } from '../../src/recorder/recorded-event.ts';
import type { InteractionBuffer } from '../../src/classifier/evidence/types.ts';

const emptyBuffer: InteractionBuffer = { events: [] } as unknown as InteractionBuffer;

function makeEvent(overrides: Partial<ElementRecordedEvent>): ElementRecordedEvent {
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

function getEvidence(overrides: Partial<ElementRecordedEvent>): Evidence[] {
  const provider = new DomProvider();
  return provider.onEvent(makeEvent(overrides) as RecordedEvent, emptyBuffer);
}

import type { Evidence } from '../../src/classifier/evidence/types.ts';

// ── Data-Attribute Dropdown Detection ────────────────────────────────────────

describe('DomProvider — data-attribute dropdown detection', () => {
  it('data-testid="city-option" → CustomDropdown', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'city-option',
        accessibleName: 'Mumbai',
      } as any,
    });
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
    expect(dropdownEv!.confidence).toBe(0.55);
    expect(dropdownEv!.weight).toBe(0.5);
    expect(dropdownEv!.reason).toContain('Data attribute');
  });

  it('data-testid="fare-dropdown-item" → CustomDropdown', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'fare-dropdown-item',
        accessibleName: 'Economy',
      } as any,
    });
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });

  it('data-cy="select-option" → CustomDropdown', () => {
    const evidence = getEvidence({
      target: {
        tag: 'LI',
        dataCy: 'select-option',
        accessibleName: 'Option 1',
      } as any,
    });
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });

  it('data-testid="menu-item" → CustomDropdown', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'menu-item',
        accessibleName: 'Settings',
      } as any,
    });
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });

  it('data-qa="choice-item" → CustomDropdown', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        dataQa: 'choice-item',
        accessibleName: 'Choice A',
      } as any,
    });
    const dropdownEv = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });
});

// ── Data-Attribute Calendar Detection ────────────────────────────────────────

describe('DomProvider — data-attribute calendar detection', () => {
  it('data-testid="date-picker-day" → DatePicker', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'date-picker-day',
        accessibleName: '22',
      } as any,
    });
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
    expect(datePickerEv!.confidence).toBe(0.6);
    expect(datePickerEv!.weight).toBe(0.55);
    expect(datePickerEv!.reason).toContain('Data attribute');
  });

  it('data-testid="calendar-day" → DatePicker', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'calendar-day',
        accessibleName: '15',
      } as any,
    });
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
  });

  it('data-cy="datepicker-cell" → DatePicker', () => {
    const evidence = getEvidence({
      target: {
        tag: 'TD',
        dataCy: 'datepicker-cell',
        accessibleName: 'July 20',
      } as any,
    });
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
  });

  it('data-testid="date-cell" → DatePicker', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'date-cell',
        accessibleName: '15',
      } as any,
    });
    const datePickerEv = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(datePickerEv).toBeDefined();
  });
});

// ── Data-Attribute Autocomplete Detection ────────────────────────────────────

describe('DomProvider — data-attribute autocomplete detection', () => {
  it('data-testid="search-suggestion" → Autocomplete', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'search-suggestion',
        accessibleName: 'Mumbai (BOM)',
      } as any,
    });
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeDefined();
    expect(autocompleteEv!.confidence).toBe(0.55);
    expect(autocompleteEv!.reason).toContain('Data attribute');
  });

  it('data-cy="autocomplete-result" → Autocomplete', () => {
    const evidence = getEvidence({
      target: {
        tag: 'LI',
        dataCy: 'autocomplete-result',
        accessibleName: 'Delhi (DEL)',
      } as any,
    });
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeDefined();
  });

  it('data-qa="typeahead-item" → Autocomplete', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        dataQa: 'typeahead-item',
        accessibleName: 'Bangalore',
      } as any,
    });
    const autocompleteEv = evidence.find(e => e.suggestedType === 'Autocomplete');
    expect(autocompleteEv).toBeDefined();
  });
});

// ── Negative Tests: No False Positives ───────────────────────────────────────

describe('DomProvider — data-attribute negative tests', () => {
  it('data-testid="submit-button" → no data-attribute evidence', () => {
    const evidence = getEvidence({
      target: {
        tag: 'BUTTON',
        testId: 'submit-button',
        accessibleName: 'Submit',
      } as any,
    });
    // Button gets Click evidence from native tag, but no data-attribute hint
    const dataAttrEv = evidence.find(e => e.reason && e.reason.includes('Data attribute'));
    expect(dataAttrEv).toBeUndefined();
  });

  it('data-testid="random-value" → no data-attribute evidence', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: 'random-value',
      } as any,
    });
    const dataAttrEv = evidence.find(e => e.reason && e.reason.includes('Data attribute'));
    expect(dataAttrEv).toBeUndefined();
  });

  it('no data attributes → no data-attribute evidence', () => {
    const evidence = getEvidence({
      target: {
        tag: 'DIV',
        testId: null,
        dataCy: null,
        dataQa: null,
        className: 'some-class',
      } as any,
    });
    const dataAttrEv = evidence.find(e => e.reason && e.reason.includes('Data attribute'));
    expect(dataAttrEv).toBeUndefined();
  });

  it('INPUT tag with data-testid="dropdown" → no data-attribute evidence (stronger tag signal)', () => {
    const evidence = getEvidence({
      target: {
        tag: 'INPUT',
        testId: 'dropdown',
      } as any,
    });
    // Input tag is excluded from data-attribute detection (only DIV/SPAN/LI etc.)
    const dataAttrEv = evidence.find(e => e.reason && e.reason.includes('Data attribute'));
    expect(dataAttrEv).toBeUndefined();
  });
});

// ── Regression: existing DomProvider behavior unaffected ─────────────────────

describe('DomProvider — regression: existing behavior', () => {
  it('native <select> still detected as NativeDropdown', () => {
    const evidence = getEvidence({
      eventType: 'change',
      target: {
        tag: 'SELECT',
        className: '',
      } as any,
    });
    const selectEv = evidence.find(e => e.suggestedType === 'NativeDropdown');
    expect(selectEv).toBeDefined();
    expect(selectEv!.confidence).toBe(0.99);
  });

  it('native <button> click still detected as Click', () => {
    const evidence = getEvidence({
      eventType: 'click',
      target: {
        tag: 'BUTTON',
        className: 'btn',
      } as any,
    });
    const clickEv = evidence.find(e => e.suggestedType === 'Click');
    expect(clickEv).toBeDefined();
  });
});
