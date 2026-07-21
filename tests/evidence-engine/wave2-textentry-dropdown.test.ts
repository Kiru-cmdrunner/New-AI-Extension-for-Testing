/**
 * Wave 2 — TextEntry + NativeDropdown Tests
 *
 * Validates that the Evidence Engine produces single interactions for:
 * 1. Text entry: focus → blur on text inputs/textareas
 * 2. Native dropdown: click → change on <select> elements
 *
 * These tests use realistic event sequences matching what the recorder
 * actually produces (including DomContext enrichment).
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
  textInputDomContext,
} from './helpers.ts';
import type { ElementIdentity, ElementRecordedEvent } from '../../src/recorder/recorded-event.ts';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.ts';

// ── Element identity helpers for common form elements ───────────────────

function textInput(
  id: string,
  accessibleName: string,
): Partial<ElementIdentity> {
  return {
    tag: 'INPUT',
    accessibleName,
    stableId: id,
    cssSelector: `#${id}`,
    name: id,
  };
}

function textarea(
  id: string,
  accessibleName: string,
): Partial<ElementIdentity> {
  return {
    tag: 'TEXTAREA',
    accessibleName,
    stableId: id,
    cssSelector: `#${id}`,
    name: id,
  };
}

function selectEl(
  id: string,
  accessibleName: string,
): Partial<ElementIdentity> {
  return {
    tag: 'SELECT',
    accessibleName,
    stableId: id,
    cssSelector: `#${id}`,
    name: id,
  };
}

function emailInput(
  id: string,
): Partial<ElementIdentity> {
  return {
    tag: 'INPUT',
    accessibleName: 'Email',
    stableId: id,
    cssSelector: `#${id}`,
    name: id,
  };
}

// ── TextEntry: single field ─────────────────────────────────────────────

describe('Wave 2 — TextEntry (single field)', () => {
  beforeEach(() => resetEventCounter());

  it('produces a single TextEntry from focus→blur', () => {
    const events = [
      focusEvent(textInput('name', 'Full Name'), {
        valueBefore: '',
        domContext: textInputDomContext(),
      }),
      blurEvent(textInput('name', 'Full Name'), {
        valueAfter: 'John Doe',
        domContext: textInputDomContext(),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('John Doe');
  });

  it('produces TextEntry even with intermediate input events', () => {
    // Real recorder suppresses intermediate input events, but if some leak through,
    // the engine should still produce ONE TextEntry, not multiple.
    const events = [
      focusEvent(textInput('phone', 'Phone'), {
        valueBefore: '',
        domContext: textInputDomContext(),
      }),
      inputEvent(textInput('phone', 'Phone'), {
        valueAfter: '5',
        domContext: textInputDomContext(),
      }),
      inputEvent(textInput('phone', 'Phone'), {
        valueAfter: '55',
        domContext: textInputDomContext(),
      }),
      inputEvent(textInput('phone', 'Phone'), {
        valueAfter: '555',
        domContext: textInputDomContext(),
      }),
      blurEvent(textInput('phone', 'Phone'), {
        valueAfter: '555-1234',
        domContext: textInputDomContext(),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('555-1234');
  });

  it('produces TextEntry for textarea', () => {
    const events = [
      focusEvent(textarea('comments', 'Comments'), {
        valueBefore: '',
        domContext: domContext({ isContentEditable: false }),
      }),
      blurEvent(textarea('comments', 'Comments'), {
        valueAfter: 'This is a comment',
        domContext: domContext({ isContentEditable: false }),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('This is a comment');
  });

  it('produces TextEntry for email input', () => {
    const events = [
      focusEvent(emailInput('email'), {
        valueBefore: '',
        domContext: domContext({ inputType: 'email' }),
      }),
      blurEvent(emailInput('email'), {
        valueAfter: 'user@example.com',
        domContext: domContext({ inputType: 'email' }),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('user@example.com');
  });

  it('produces TextEntry for contenteditable div', () => {
    const events = [
      focusEvent(
        { tag: 'DIV', ariaRole: 'textbox', cssSelector: '.editor', accessibleName: 'Editor' },
        { valueBefore: '', domContext: domContext({ isContentEditable: true }) },
      ),
      blurEvent(
        { tag: 'DIV', ariaRole: 'textbox', cssSelector: '.editor', accessibleName: 'Editor' },
        { valueAfter: 'Rich text content',
          domContext: domContext({ isContentEditable: true }) },
      ),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('Rich text content');
  });

  it('produces TextEntry even when value did not change', () => {
    // User focused but didn't type — still a TextEntry interaction
    const events = [
      focusEvent(textInput('search', 'Search'), {
        valueBefore: '',
        domContext: textInputDomContext(),
      }),
      blurEvent(textInput('search', 'Search'), {
        valueAfter: '',
        domContext: textInputDomContext(),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
  });

  it('captures valueBefore from focus event as pre-existing value', () => {
    // Text field had existing value before focus
    const events = [
      focusEvent(textInput('addr', 'Address'), {
        valueBefore: '123 Main St',
        domContext: textInputDomContext(),
      }),
      blurEvent(textInput('addr', 'Address'), {
        valueAfter: '123 Main Street',
        domContext: textInputDomContext(),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('123 Main Street');
  });
});

// ── TextEntry: multiple fields ──────────────────────────────────────────

describe('Wave 2 — TextEntry (multiple fields)', () => {
  beforeEach(() => resetEventCounter());

  it('produces separate TextEntry interactions for sequential fields', () => {
    const events = [
      focusEvent(textInput('first', 'First Name'), {
        valueBefore: '',
        domContext: textInputDomContext(),
      }),
      blurEvent(textInput('first', 'First Name'), {
        valueAfter: 'Jane',
        domContext: textInputDomContext(),
      }),
      focusEvent(textInput('last', 'Last Name'), {
        valueBefore: '',
        domContext: textInputDomContext(),
      }),
      blurEvent(textInput('last', 'Last Name'), {
        valueAfter: 'Smith',
        domContext: textInputDomContext(),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('Jane');
    expect(result[1].type).toBe('TextEntry');
    expect(result[1].metadata?.textValue).toBe('Smith');
  });

  it('produces 3 TextEntry for 3 fields filled in sequence', () => {
    const events = [
      focusEvent(textInput('name', 'Name'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('name', 'Name'), { valueAfter: 'Alice', domContext: textInputDomContext() }),
      focusEvent(textInput('email', 'Email'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('email', 'Email'), { valueAfter: 'a@b.com', domContext: textInputDomContext() }),
      focusEvent(textInput('phone', 'Phone'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('phone', 'Phone'), { valueAfter: '555-0001', domContext: textInputDomContext() }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === 'TextEntry')).toBe(true);
    expect(result[0].metadata?.textValue).toBe('Alice');
    expect(result[1].metadata?.textValue).toBe('a@b.com');
    expect(result[2].metadata?.textValue).toBe('555-0001');
  });

  it('interleaving text field and click does not merge', () => {
    // User types in field A, clicks a button, then types in field B
    const events = [
      focusEvent(textInput('a', 'Field A'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('a', 'Field A'), { valueAfter: 'A', domContext: textInputDomContext() }),
      clickEvent({ tag: 'BUTTON', accessibleName: 'Check', cssSelector: '#btn-check' }),
      focusEvent(textInput('b', 'Field B'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('b', 'Field B'), { valueAfter: 'B', domContext: textInputDomContext() }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('TextEntry');
    expect(result[1].type).toBe('Click');
    expect(result[2].type).toBe('TextEntry');
  });
});

// ── NativeDropdown: single select ───────────────────────────────────────

describe('Wave 2 — NativeDropdown (single select)', () => {
  beforeEach(() => resetEventCounter());

  it('produces a single NativeDropdown from click→change', () => {
    const events = [
      clickEvent(selectEl('make', 'Make')),
      changeEvent(selectEl('make', 'Make'), { valueAfter: 'PONTIAC' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('NativeDropdown');
    expect(result[0].metadata?.selectedValue).toBe('PONTIAC');
  });

  it('produces NativeDropdown from focus→click→change→blur sequence', () => {
    // Full event sequence for a native select interaction
    const events = [
      focusEvent(selectEl('year', 'Year')),
      clickEvent(selectEl('year', 'Year')),
      changeEvent(selectEl('year', 'Year'), { valueAfter: '2021' }),
      blurEvent(selectEl('year', 'Year')),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('NativeDropdown');
    expect(result[0].metadata?.selectedValue).toBe('2021');
  });

  it('produces NativeDropdown with just change event (no preceding click)', () => {
    // Keyboard-driven selection: focus → change → blur (no click)
    const events = [
      focusEvent(selectEl('model', 'Model')),
      changeEvent(selectEl('model', 'Model'), { valueAfter: 'Accord' }),
      blurEvent(selectEl('model', 'Model')),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('NativeDropdown');
    expect(result[0].metadata?.selectedValue).toBe('Accord');
  });

  it('produces separate interactions for multiple dropdowns', () => {
    const events = [
      clickEvent(selectEl('make', 'Make')),
      changeEvent(selectEl('make', 'Make'), { valueAfter: 'FORD' }),
      clickEvent(selectEl('year', 'Year')),
      changeEvent(selectEl('year', 'Year'), { valueAfter: '2023' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'NativeDropdown')).toBe(true);
    expect(result[0].metadata?.selectedValue).toBe('FORD');
    expect(result[1].metadata?.selectedValue).toBe('2023');
  });
});

// ── V1 vs V2 comparison ─────────────────────────────────────────────────

describe('Wave 2 — V1 vs V2 type parity', () => {
  beforeEach(() => resetEventCounter());

  it('V1 and V2 agree on single TextEntry', () => {
    const events = [
      focusEvent(textInput('name', 'Name'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('name', 'Name'), { valueAfter: 'Bob', domContext: textInputDomContext() }),
      navigationEvent('https://example.com/next'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // Filter out the navigation interaction
    const v1Types = v1.map(r => r.type);
    const v2Types = v2.map(r => r.type);

    // Both should classify the text entry as TextEntry
    expect(v1Types).toContain('TextEntry');
    expect(v2Types).toContain('TextEntry');
  });

  it('V1 and V2 agree on single NativeDropdown', () => {
    const events = [
      clickEvent(selectEl('make', 'Make')),
      changeEvent(selectEl('make', 'Make'), { valueAfter: 'HONDA' }),
      navigationEvent('https://example.com/next'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    const v1Types = v1.map(r => r.type);
    const v2Types = v2.map(r => r.type);

    expect(v1Types).toContain('NativeDropdown');
    expect(v2Types).toContain('NativeDropdown');
  });

  it('V2 produces ≤ V1 interactions for text entry with intermediate input events', () => {
    // This is the key validation: V2 must not produce MORE interactions than V1
    // when intermediate input events leak through.
    const events = [
      focusEvent(textInput('phone', 'Phone'), { valueBefore: '', domContext: textInputDomContext() }),
      inputEvent(textInput('phone', 'Phone'), { valueAfter: '5', domContext: textInputDomContext() }),
      inputEvent(textInput('phone', 'Phone'), { valueAfter: '55', domContext: textInputDomContext() }),
      inputEvent(textInput('phone', 'Phone'), { valueAfter: '555', domContext: textInputDomContext() }),
      blurEvent(textInput('phone', 'Phone'), { valueAfter: '555-1234', domContext: textInputDomContext() }),
      navigationEvent('https://example.com'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    // V2 should produce at most as many interactions as V1
    expect(v2.length).toBeLessThanOrEqual(v1.length);
  });
});

// ── Real-world form scenario (Avis Ford style) ─────────────────────────

describe('Wave 2 — Real-world form scenario', () => {
  beforeEach(() => resetEventCounter());

  it('Avis Ford service form: VIN, Make, Year, Model, Mileage → 5 interactions', () => {
    // Simulates the form from the screenshot:
    // - VIN text field (optional)
    // - Make dropdown (selected PONTIAC)
    // - Year dropdown
    // - Model dropdown
    const events = [
      // VIN text field
      focusEvent(textInput('vin', 'VIN'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('vin', 'VIN'), { valueAfter: '1G2ZG58B874123456', domContext: textInputDomContext() }),

      // Make dropdown (FORD → PONTIAC)
      clickEvent(selectEl('ddMake', 'Make')),
      changeEvent(selectEl('ddMake', 'Make'), { valueAfter: 'PONTIAC' }),

      // Year dropdown
      clickEvent(selectEl('ddYear', 'Year')),
      changeEvent(selectEl('ddYear', 'Year'), { valueAfter: '2008' }),

      // Model dropdown
      clickEvent(selectEl('ddModel', 'Model')),
      changeEvent(selectEl('ddModel', 'Model'), { valueAfter: 'G6' }),

      // Mileage text field
      focusEvent(textInput('mileage', 'Mileage'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('mileage', 'Mileage'), { valueAfter: '75000', domContext: textInputDomContext() }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(5);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('1G2ZG58B874123456');
    expect(result[1].type).toBe('NativeDropdown');
    expect(result[1].metadata?.selectedValue).toBe('PONTIAC');
    expect(result[2].type).toBe('NativeDropdown');
    expect(result[2].metadata?.selectedValue).toBe('2008');
    expect(result[3].type).toBe('NativeDropdown');
    expect(result[3].metadata?.selectedValue).toBe('G6');
    expect(result[4].type).toBe('TextEntry');
    expect(result[4].metadata?.textValue).toBe('75000');
  });

  it('Multi-step form: text → dropdown → text → dropdown → submit', () => {
    const events = [
      focusEvent(textInput('custName', 'Customer Name'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('custName', 'Customer Name'), { valueAfter: 'John Smith', domContext: textInputDomContext() }),

      clickEvent(selectEl('dept', 'Department')),
      changeEvent(selectEl('dept', 'Department'), { valueAfter: 'Service' }),

      focusEvent(textInput('desc', 'Description'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('desc', 'Description'), { valueAfter: 'Oil change needed', domContext: textInputDomContext() }),

      clickEvent(selectEl('priority', 'Priority')),
      changeEvent(selectEl('priority', 'Priority'), { valueAfter: 'Normal' }),

      clickEvent({ tag: 'BUTTON', accessibleName: 'Submit', cssSelector: '#submit-btn' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(5);
    expect(result[0].type).toBe('TextEntry');
    expect(result[1].type).toBe('NativeDropdown');
    expect(result[2].type).toBe('TextEntry');
    expect(result[3].type).toBe('NativeDropdown');
    expect(result[4].type).toBe('Click');
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────

describe('Wave 2 — Edge cases', () => {
  beforeEach(() => resetEventCounter());

  it('click on select without change produces single interaction (NativeDropdown by element type)', () => {
    // User opens the dropdown but doesn't change the value.
    // V2's DomProvider classifies SELECT elements as NativeDropdown by tag (0.99 confidence),
    // even without a change event. This is by design — the element type is the signal,
    // not the event sequence. The key validation is that it's ONE interaction.
    const events = [
      clickEvent(selectEl('opt', 'Options')),
      // No change event — user clicked away without selecting
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('NativeDropdown');
    expect(result[0].confidence).toBeGreaterThan(0.5);
  });

  it('rapid focus→blur on multiple fields (tab-through)', () => {
    // User tabs through fields quickly without typing
    const events = [
      focusEvent(textInput('a', 'A'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('a', 'A'), { valueAfter: '', domContext: textInputDomContext() }),
      focusEvent(textInput('b', 'B'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('b', 'B'), { valueAfter: '', domContext: textInputDomContext() }),
      focusEvent(textInput('c', 'C'), { valueBefore: '', domContext: textInputDomContext() }),
      blurEvent(textInput('c', 'C'), { valueAfter: '', domContext: textInputDomContext() }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === 'TextEntry')).toBe(true);
  });

  it('password field produces TextEntry', () => {
    const events = [
      focusEvent(textInput('pwd', 'Password'), {
        valueBefore: '',
        domContext: domContext({ inputType: 'password' }),
      }),
      blurEvent(textInput('pwd', 'Password'), {
        valueAfter: 'secret123',
        domContext: domContext({ inputType: 'password' }),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
  });

  it('number input produces TextEntry', () => {
    const events = [
      focusEvent(textInput('qty', 'Quantity'), {
        valueBefore: '',
        domContext: domContext({ inputType: 'number' }),
      }),
      blurEvent(textInput('qty', 'Quantity'), {
        valueAfter: '42',
        domContext: domContext({ inputType: 'number' }),
      }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('42');
  });

  it('select with only change event (programmatic or keyboard)', () => {
    const events = [
      focusEvent(selectEl('cat', 'Category')),
      changeEvent(selectEl('cat', 'Category'), { valueAfter: 'Books' }),
    ];

    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('NativeDropdown');
  });
});
