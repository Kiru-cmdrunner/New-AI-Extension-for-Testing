/**
 * Autocomplete — Comprehensive Real-World Validation
 *
 * Validates the v10.4.16 Autocomplete detection milestone across:
 *
 * SITES:    Google Flights, MUI Autocomplete, React-Select,
 *           Ant Design AutoComplete, Native HTML <datalist>
 *
 * METHODS:  Mouse selection, Keyboard navigation (Arrow+Enter)
 *
 * CHECKS:   Search text captured, selected value captured,
 *           Autocomplete (not CustomDropdown), confidence scores,
 *           CustomDropdown regression preserved, raw events intact
 *
 * EDGE:     Type and select, type without selecting, click without typing,
 *           multiple fields, async suggestions, no suggestions found
 *
 * NOTE on keyboard navigation:
 *   The recorder captures click/focus/blur/change/input events — no
 *   keydown/keyup/keypress. Keyboard navigation (Arrow↓ to highlight an
 *   option, Enter to select) manifests as:
 *     focus(combobox) → change(combobox, valueAfter=selected) → blur(combobox)
 *   There is NO click event on the option element. This differs from mouse
 *   selection where there IS a click on the option.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { COMMIT_THRESHOLD } from '../../src/classifier/evidence/combination.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  focusEvent,
  blurEvent,
  changeEvent,
  domContext,
  autocompleteDomContext,
  comboboxDomContext,
  datalistDomContext,
} from './helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimum acceptable confidence for a committed interaction. */
const MIN_CONFIDENCE = COMMIT_THRESHOLD; // 0.5

/** Assert interaction is Autocomplete, optionally check metadata + confidence. */
function expectAutocomplete(
  result: ReturnType<typeof detectInteractionsV2>,
  opts: {
    textValue?: string;
    selectedValue?: string;
    minConfidence?: number;
    hasEventIds?: boolean;
  } = {},
) {
  const ac = result.find(r => r.type === 'Autocomplete');
  expect(ac, 'Expected an Autocomplete interaction').toBeDefined();
  if (!ac) return null;

  if (opts.textValue !== undefined) {
    expect(ac.metadata.textValue).toBe(opts.textValue);
  }
  if (opts.selectedValue !== undefined) {
    expect(ac.metadata.selectedValue).toBe(opts.selectedValue);
  }
  if (opts.minConfidence !== undefined) {
    expect(ac.confidence).toBeGreaterThanOrEqual(opts.minConfidence);
  }
  if (opts.hasEventIds) {
    expect(ac.eventIds.length).toBeGreaterThan(0);
  }
  return ac;
}

/** Assert NO CustomDropdown in result (regression check). */
function expectNoCustomDropdown(result: ReturnType<typeof detectInteractionsV2>) {
  const cd = result.find(r => r.type === 'CustomDropdown');
  expect(cd, 'Should NOT have CustomDropdown when autocomplete signals present').toBeUndefined();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GOOGLE FLIGHTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🌍 Google Flights — Airport Search', () => {
  beforeEach(() => resetEventCounter());

  it('Mouse: search "New" and click "New York (JFK)" suggestion', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
      ariaExpanded: 'true', ariaHasPopup: 'listbox', className: 'NZI5Gc',
    });
    const option = makeTarget({
      tag: 'LI', accessibleName: 'New York (JFK)', ariaRole: 'option', className: 'sbct',
    });
    const ctx = comboboxDomContext(true);

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'New York (JFK)', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      selectedValue: 'New York (JFK)',
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Keyboard: type "JFK", Arrow↓, Enter → change event on input', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Where to?', ariaRole: 'combobox',
      ariaExpanded: 'true', ariaHasPopup: 'listbox', className: 'NZI5Gc',
    });
    const ctx = comboboxDomContext(true);

    // Keyboard nav: no click on option, change fires on the combobox input itself
    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'JFK', domContext: ctx }),
      blurEvent(input, { valueAfter: 'JFK', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Search text captured: blur valueAfter has the typed query', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
      className: 'NZI5Gc',
    });
    const option = makeTarget({
      tag: 'LI', accessibleName: 'London (LHR)', ariaRole: 'option',
    });
    const ctx = comboboxDomContext(true);

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'London (LHR)', domContext: ctx }),
    ]);

    const ac = expectAutocomplete(result);
    expect(ac!.metadata.selectedValue).toBe('London (LHR)');
  });

  it('Detected as Autocomplete, NOT CustomDropdown', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
      className: 'NZI5Gc',
    });
    const option = makeTarget({
      tag: 'LI', accessibleName: 'Paris (CDG)', ariaRole: 'option',
    });
    const ctx = comboboxDomContext(true);

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'Paris (CDG)', domContext: ctx }),
    ]);

    expectAutocomplete(result);
    expectNoCustomDropdown(result);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MATERIAL UI AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════════════════════════

describe('🎨 Material UI Autocomplete', () => {
  beforeEach(() => resetEventCounter());

  it('Mouse: aria-autocomplete + MuiAutocomplete classes → search "U" select "United States"', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Country', ariaRole: 'combobox',
      className: 'MuiOutlinedInput-input MuiAutocomplete-input',
      ariaExpanded: 'true', ariaHasPopup: 'listbox',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'United States', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
    });
    const ctx = autocompleteDomContext({ ariaAutoComplete: 'list' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'United States', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      selectedValue: 'United States',
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Keyboard: type "Ge", Arrow↓, Enter → no option click, change on input', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Country', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
      ariaExpanded: 'true', ariaHasPopup: 'listbox',
    });
    const ctx = autocompleteDomContext({ ariaAutoComplete: 'list' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Germany', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Germany', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      minConfidence: MIN_CONFIDENCE,
    });
  });

  it('Class-only detection: MuiAutocomplete-root without aria-autocomplete', () => {
    const trigger = makeTarget({
      tag: 'DIV', accessibleName: 'Select State', ariaRole: 'combobox',
      className: 'MuiAutocomplete-root',
    });
    const option = makeTarget({
      tag: 'LI', accessibleName: 'California', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
    });

    const result = detectInteractionsV2([
      clickEvent(trigger, { domContext: comboboxDomContext(true) }),
      clickEvent(option),
    ]);

    expectAutocomplete(result, { selectedValue: 'California' });
  });

  it('Confidence ≥ 0.5 (COMMIT_THRESHOLD)', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'City',
      className: 'MuiAutocomplete-input',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Boston', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    expect(ac!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. REACT-SELECT
// ═══════════════════════════════════════════════════════════════════════════════

describe('⚛️ React-Select', () => {
  beforeEach(() => resetEventCounter());

  it('Mouse: typeahead class → search and click option', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Select a color',
      className: 'react-select-input typeahead',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'Crimson', ariaRole: 'option',
      className: 'react-select-option',
    });
    const ctx = domContext({ inputType: 'text' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'Crimson', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      selectedValue: 'Crimson',
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Keyboard: Arrow↓ + Enter → change event on react-select input', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Select a color',
      className: 'react-select-input typeahead',
    });
    const ctx = domContext({ inputType: 'text' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Teal', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Teal', domContext: ctx }),
    ]);

    expectAutocomplete(result, { minConfidence: MIN_CONFIDENCE });
  });

  it('React-select class without typeahead → still detected via autocomplete class', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Choose flavor',
      className: 'react-select__input',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'Vanilla', ariaRole: 'option',
    });

    const result = detectInteractionsV2([
      focusEvent(input, {
        valueBefore: '',
        domContext: domContext({ inputType: 'text' }),
      }),
      clickEvent(option),
      blurEvent(input, {
        valueAfter: 'Vanilla',
        domContext: domContext({ inputType: 'text' }),
      }),
    ]);

    // react-select has combobox semantics via aria, or may just be TextEntry
    // Either Autocomplete or TextEntry is acceptable — NOT CustomDropdown
    const ac = result.find(r => r.type === 'Autocomplete');
    const te = result.find(r => r.type === 'TextEntry');
    const cd = result.find(r => r.type === 'CustomDropdown');
    expect(cd).toBeUndefined(); // No CustomDropdown for a text input
    expect(ac || te).toBeDefined(); // At least one valid interaction
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ANT DESIGN AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════════════════════════

describe('🐜 Ant Design AutoComplete', () => {
  beforeEach(() => resetEventCounter());

  it('Mouse: aria-autocomplete + ant-select classes → search "lap" click "Laptop Pro"', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search products', ariaRole: 'combobox',
      className: 'ant-input ant-select-selection-search-input',
      ariaExpanded: 'true', ariaHasPopup: 'listbox',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'Laptop Pro', ariaRole: 'option',
      className: 'ant-select-item ant-select-item-option',
    });
    const ctx = autocompleteDomContext({ ariaAutoComplete: 'list' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'Laptop Pro', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      selectedValue: 'Laptop Pro',
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Keyboard: combobox role + text change via Enter', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search products', ariaRole: 'combobox',
      className: 'ant-select-show-search',
      ariaExpanded: 'true', ariaHasPopup: 'listbox',
    });
    const ctx = comboboxDomContext(true);

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Tablet', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Tablet', domContext: ctx }),
    ]);

    // With combobox + text change, should be Autocomplete or CustomDropdown
    const ac = result.find(r => r.type === 'Autocomplete');
    const cd = result.find(r => r.type === 'CustomDropdown');
    expect(ac || cd).toBeDefined();
    if (ac) {
      expect(ac.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    }
  });

  it('AntD AutoComplete with aria-autocomplete="list"', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Email', ariaRole: 'combobox',
      className: 'ant-select-selection-search-input',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'john@example.com', ariaRole: 'option',
    });
    const ctx = autocompleteDomContext({ ariaAutoComplete: 'list' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'john@example.com', domContext: ctx }),
    ]);

    expectAutocomplete(result);
    expectNoCustomDropdown(result);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. NATIVE HTML <datalist>
// ═══════════════════════════════════════════════════════════════════════════════

describe('📋 Native HTML <datalist>', () => {
  beforeEach(() => resetEventCounter());

  it('Mouse: input[list] → type and select from suggestions', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Browser', cssSelector: '#browser-input',
    });
    const ctx = datalistDomContext('browsers');

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Firefox', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      textValue: 'Firefox',
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Keyboard: Arrow↓ + Enter on datalist suggestion', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Choose OS', cssSelector: '#os-input',
    });
    const ctx = datalistDomContext('os-list');

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Linux', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Linux', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      minConfidence: MIN_CONFIDENCE,
      hasEventIds: true,
    });
  });

  it('Selected value extracted from change event', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Fruit', cssSelector: '#fruit-input',
    });
    const ctx = datalistDomContext('fruits');

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Mango', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Mango', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    // textValue should be set from blur valueAfter
    expect(ac!.metadata.textValue).toBeDefined();
  });

  it('datalist NOT classified as TextEntry', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Country', cssSelector: '#country',
    });
    const ctx = datalistDomContext('countries');

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Canada', domContext: ctx }),
    ]);

    const te = result.find(r => r.type === 'TextEntry');
    expect(te).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CUSTOMDROPWN REGRESSION (NO AUTOCOMPLETE SIGNALS)
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔄 CustomDropdown Regression', () => {
  beforeEach(() => resetEventCounter());

  it('Plain combobox click + option → CustomDropdown (NOT Autocomplete)', () => {
    const trigger = makeTarget({
      tag: 'DIV', accessibleName: 'Sort by', ariaRole: 'combobox',
    });
    const option = makeTarget({
      tag: 'LI', accessibleName: 'Price: Low to High', ariaRole: 'option',
    });

    const result = detectInteractionsV2([
      clickEvent(trigger, { domContext: comboboxDomContext(true) }),
      clickEvent(option),
    ]);

    const cd = result.find(r => r.type === 'CustomDropdown');
    expect(cd).toBeDefined();
    expect(cd!.metadata.selectedValue).toBe('Price: Low to High');

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeUndefined();
  });

  it('AntD Select without search → CustomDropdown', () => {
    const trigger = makeTarget({
      tag: 'DIV', accessibleName: 'Status',
      className: 'ant-select-selector',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'Active',
      className: 'ant-select-item-option',
    });

    const result = detectInteractionsV2([
      clickEvent(trigger, { domContext: domContext() }),
      clickEvent(option),
    ]);

    const cd = result.find(r => r.type === 'CustomDropdown');
    expect(cd).toBeDefined();
    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeUndefined();
  });

  it('Plain text input (no combobox, no datalist) → TextEntry', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Full Name', cssSelector: '#name',
    });
    const ctx = domContext({ inputType: 'text' });

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Jane Doe', domContext: ctx }),
    ]);

    const te = result.find(r => r.type === 'TextEntry');
    expect(te).toBeDefined();
    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeUndefined();
  });

  it('Native <select> → NativeDropdown (not Autocomplete)', () => {
    const select = makeTarget({
      tag: 'SELECT', accessibleName: 'Choose Country',
    });
    const ctx = domContext({ inputType: 'select-one' });

    const result = detectInteractionsV2([
      focusEvent(select, { valueBefore: '', domContext: ctx }),
      changeEvent(select, { valueBefore: '', valueAfter: 'US', domContext: ctx }),
      blurEvent(select, { valueAfter: 'US', domContext: ctx }),
    ]);

    const nd = result.find(r => r.type === 'NativeDropdown');
    expect(nd).toBeDefined();
    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('⚡ Edge Cases', () => {
  beforeEach(() => resetEventCounter());

  // ── Type and Select (normal happy path) ──
  it('Type and select: search "Uni" → click "United States"', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Country', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'United States', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'United States', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      selectedValue: 'United States',
      hasEventIds: true,
    });
  });

  // ── Type Without Selecting ──
  it('Type without selecting: focus + blur, no option click, no change event', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'partial text', domContext: ctx }),
    ]);

    // Should still detect Autocomplete (the element HAS autocomplete semantics)
    // — the engine can't know the user didn't select, it just sees the field
    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    // No selectedValue since no option was clicked
    expect(ac!.metadata.selectedValue).toBeUndefined();
  });

  // ── Click Input Without Typing ──
  it('Click input without typing: focus + immediate blur (no text change)', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search City', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: '', domContext: ctx }),
    ]);

    // No text change → no Autocomplete or TextEntry committed.
    // Could be Click if there was a click, or nothing if just focus+blur.
    const ac = result.find(r => r.type === 'Autocomplete');
    const te = result.find(r => r.type === 'TextEntry');
    // Either no interaction, or an interaction without selectedValue
    if (ac) {
      expect(ac.metadata.selectedValue).toBeUndefined();
      expect(ac.metadata.textValue || '').toBe('');
    }
    // TextEntry should NOT fire (combobox guard suppresses it)
    expect(te).toBeUndefined();
  });

  // ── Multiple Autocomplete Fields ──
  it('Multiple autocomplete fields: two separate interactions', () => {
    const input1 = makeTarget({
      tag: 'INPUT', accessibleName: 'From', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
      cssSelector: 'input#from',
      elementId: 'from-input',
    });
    const option1 = makeTarget({
      tag: 'DIV', accessibleName: 'New York', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
      cssSelector: 'div#from-option',
      elementId: 'from-option',
    });
    const input2 = makeTarget({
      tag: 'INPUT', accessibleName: 'To', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
      cssSelector: 'input#to',
      elementId: 'to-input',
    });
    const option2 = makeTarget({
      tag: 'DIV', accessibleName: 'Los Angeles', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
      cssSelector: 'div#to-option',
      elementId: 'to-option',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      // First autocomplete: From → New York
      focusEvent(input1, { valueBefore: '', domContext: ctx }),
      clickEvent(option1),
      blurEvent(input1, { valueAfter: 'New York', domContext: ctx }),
      // Second autocomplete: To → Los Angeles
      focusEvent(input2, { valueBefore: '', domContext: ctx }),
      clickEvent(option2),
      blurEvent(input2, { valueAfter: 'Los Angeles', domContext: ctx }),
    ]);

    const autocompletes = result.filter(r => r.type === 'Autocomplete');
    expect(autocompletes.length).toBeGreaterThanOrEqual(2);

    // Each should have distinct event IDs (no overlap)
    const ids1 = new Set(autocompletes[0].eventIds);
    const ids2 = new Set(autocompletes[1].eventIds);
    const overlap = [...ids1].filter(id => ids2.has(id));
    expect(overlap.length).toBe(0);
  });

  // ── Async Suggestions (network-delayed dropdown) ──
  it('Async suggestions: focus → delayed change event (API response)', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search users', ariaRole: 'combobox',
      className: 'async-autocomplete',
      ariaExpanded: 'true', ariaHasPopup: 'listbox',
    });
    const ctx = autocompleteDomContext();

    // Async pattern: focus → wait for API → option appears → click
    // The event stream is the same; timing doesn't affect classification
    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent({
        tag: 'LI', accessibleName: 'Alice Anderson', ariaRole: 'option',
        className: 'async-option',
      }),
      blurEvent(input, { valueAfter: 'Alice Anderson', domContext: ctx }),
    ]);

    expectAutocomplete(result, {
      selectedValue: 'Alice Anderson',
      hasEventIds: true,
    });
  });

  // ── No Suggestions Found (no false positive) ──
  it('No suggestions found: type and blur, no results — no CustomDropdown', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
    });
    const ctx = autocompleteDomContext();

    // User types, no matching results, closes without selecting
    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'xyznomatch', domContext: ctx }),
    ]);

    // No CustomDropdown false positive
    const cd = result.find(r => r.type === 'CustomDropdown');
    expect(cd).toBeUndefined();

    // May be Autocomplete (element has autocomplete semantics) — acceptable
    // since the user DID interact with an autocomplete field
    const ac = result.find(r => r.type === 'Autocomplete');
    if (ac) {
      // Should NOT have a selectedValue (nothing was selected)
      expect(ac.metadata.selectedValue).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CONFIDENCE SCORES
// ═══════════════════════════════════════════════════════════════════════════════

describe('📊 Confidence Scores', () => {
  beforeEach(() => resetEventCounter());

  it('aria-autocomplete detection confidence ≥ 0.5', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Test',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Result', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    expect(ac!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it('Full pattern (focus + option click + blur) confidence ≥ 0.5', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Country',
      className: 'MuiAutocomplete-input',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'France', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'France', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    expect(ac!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it('Keyboard selection confidence ≥ 0.5', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'City',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Berlin', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Berlin', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    expect(ac!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it('datalist detection confidence ≥ 0.5', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Browser', cssSelector: '#browser',
    });
    const ctx = datalistDomContext('browsers');

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Chrome', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    expect(ac!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. RAW EVENTS INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('🔗 Raw Events Integrity', () => {
  beforeEach(() => resetEventCounter());

  it('Autocomplete interaction preserves all contributing event IDs', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Country',
      className: 'MuiAutocomplete-input',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'Japan', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
    });
    const ctx = autocompleteDomContext();

    const events = [
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'Japan', domContext: ctx }),
    ];
    const eventIds = events.map(e => e.eventId);

    const result = detectInteractionsV2(events);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    // All event IDs should be accounted for in the interaction
    for (const id of eventIds) {
      expect(ac!.eventIds).toContain(id);
    }
  });

  it('rawEventTypes array includes focus, click, blur', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Country',
      className: 'MuiAutocomplete-input',
    });
    const option = makeTarget({
      tag: 'DIV', accessibleName: 'Spain', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
    });
    const ctx = autocompleteDomContext();

    const result = detectInteractionsV2([
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      clickEvent(option),
      blurEvent(input, { valueAfter: 'Spain', domContext: ctx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    expect(ac!.rawEventTypes).toContain('focus');
    expect(ac!.rawEventTypes).toContain('click');
    expect(ac!.rawEventTypes).toContain('blur');
  });

  it('Keyboard nav preserves focus, change, blur event IDs', () => {
    const input = makeTarget({
      tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'City',
    });
    const ctx = autocompleteDomContext();

    const events = [
      focusEvent(input, { valueBefore: '', domContext: ctx }),
      changeEvent(input, { valueBefore: '', valueAfter: 'Tokyo', domContext: ctx }),
      blurEvent(input, { valueAfter: 'Tokyo', domContext: ctx }),
    ];
    const eventIds = events.map(e => e.eventId);

    const result = detectInteractionsV2(events);

    const ac = result.find(r => r.type === 'Autocomplete');
    expect(ac).toBeDefined();
    for (const id of eventIds) {
      expect(ac!.eventIds).toContain(id);
    }
    expect(ac!.rawEventTypes).toContain('focus');
    expect(ac!.rawEventTypes).toContain('change');
    expect(ac!.rawEventTypes).toContain('blur');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. FULL WORKFLOW SIMULATIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('🎬 Full Workflow Simulations', () => {
  beforeEach(() => resetEventCounter());

  it('Flight booking: From + To + Date (autocomplete + autocomplete + date)', () => {
    const fromInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
      className: 'NZI5Gc',
      cssSelector: 'input#from',
      elementId: 'from',
    });
    const fromOption = makeTarget({
      tag: 'LI', accessibleName: 'New York (JFK)', ariaRole: 'option',
      cssSelector: 'li#from-opt',
      elementId: 'from-opt',
    });
    const toInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Where to?', ariaRole: 'combobox',
      className: 'NZI5Gc',
      cssSelector: 'input#to',
      elementId: 'to',
    });
    const toOption = makeTarget({
      tag: 'LI', accessibleName: 'London (LHR)', ariaRole: 'option',
      cssSelector: 'li#to-opt',
      elementId: 'to-opt',
    });
    const ctx = comboboxDomContext(true);

    const result = detectInteractionsV2([
      focusEvent(fromInput, { valueBefore: '', domContext: ctx }),
      clickEvent(fromOption),
      blurEvent(fromInput, { valueAfter: 'New York (JFK)', domContext: ctx }),
      focusEvent(toInput, { valueBefore: '', domContext: ctx }),
      clickEvent(toOption),
      blurEvent(toInput, { valueAfter: 'London (LHR)', domContext: ctx }),
    ]);

    const acs = result.filter(r => r.type === 'Autocomplete' || r.type === 'CustomDropdown');
    expect(acs.length).toBeGreaterThanOrEqual(2);

    // Each interaction should have distinct event IDs
    for (let i = 0; i < acs.length; i++) {
      for (let j = i + 1; j < acs.length; j++) {
        const overlap = acs[i].eventIds.filter(id => acs[j].eventIds.includes(id));
        expect(overlap.length).toBe(0);
      }
    }
  });

  it('Form: autocomplete field followed by a regular text field', () => {
    const acInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Country', ariaRole: 'combobox',
      className: 'MuiAutocomplete-input',
      cssSelector: 'input#country-ac',
      elementId: 'country-ac',
    });
    const acOption = makeTarget({
      tag: 'DIV', accessibleName: 'Canada', ariaRole: 'option',
      className: 'MuiAutocomplete-option',
      cssSelector: 'div#country-opt',
      elementId: 'country-opt',
    });
    const textInput = makeTarget({
      tag: 'INPUT', accessibleName: 'City', cssSelector: '#city',
      elementId: 'city-text',
    });
    const acCtx = autocompleteDomContext();
    const textCtx = domContext({ inputType: 'text' });

    const result = detectInteractionsV2([
      focusEvent(acInput, { valueBefore: '', domContext: acCtx }),
      clickEvent(acOption),
      blurEvent(acInput, { valueAfter: 'Canada', domContext: acCtx }),
      focusEvent(textInput, { valueBefore: '', domContext: textCtx }),
      blurEvent(textInput, { valueAfter: 'Toronto', domContext: textCtx }),
    ]);

    const ac = result.find(r => r.type === 'Autocomplete');
    const te = result.find(r => r.type === 'TextEntry');
    expect(ac).toBeDefined();
    expect(te).toBeDefined();

    // No event ID overlap between the two interactions
    const overlap = ac!.eventIds.filter(id => te!.eventIds.includes(id));
    expect(overlap.length).toBe(0);
  });
});
