/**
 * Autocomplete Real-World Validation
 *
 * Tests autocomplete detection against actual DOM patterns from real-world
 * applications and UI frameworks.
 *
 * Frameworks covered:
 *   - MUI Autocomplete (aria-autocomplete, MuiAutocomplete classes)
 *   - Ant Design Select with search (role=combobox, ant-select classes)
 *   - React-Select (react-select classes, no aria-autocomplete)
 *   - Google Flights (role=combobox, suggestion classes)
 *   - Native HTML <datalist> (input[list])
 *   - Downshift (aria-autocomplete)
 *   - Regression: plain CustomDropdown (no autocomplete signals)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
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

describe('Real-World: Autocomplete Detection', () => {
  beforeEach(() => resetEventCounter());

  // ════════════════════════════════════════════════════════════════════════════
  // 1. MUI AUTOCOMPLETE
  // ════════════════════════════════════════════════════════════════════════════

  describe('Material UI Autocomplete', () => {
    it('MUI Autocomplete with aria-autocomplete + text search + option select', () => {
      const input = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Country',
        className: 'MuiOutlinedInput-input MuiInputBase-input',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
      });
      const option = makeTarget({
        tag: 'DIV', ariaRole: 'option', accessibleName: 'United States',
        className: 'MuiAutocomplete-option',
      });

      const events = [
        focusEvent(input, { valueBefore: '', domContext: autocompleteDomContext() }),
        clickEvent(option),
        blurEvent(input, { valueAfter: 'United States', domContext: autocompleteDomContext() }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
    });

    it('MUI Autocomplete with class-only detection (no aria-autocomplete)', () => {
      const trigger = clickEvent({
        tag: 'DIV', accessibleName: 'Select State', ariaRole: 'combobox',
        className: 'MuiAutocomplete-root',
      }, { domContext: comboboxDomContext(true) });
      const option = clickEvent({
        tag: 'LI', accessibleName: 'California', ariaRole: 'option',
        className: 'MuiAutocomplete-option',
      });

      const result = detectInteractionsV2([trigger, option]);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. ANT DESIGN SELECT (with search)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Ant Design Select with Search', () => {
    it('AntD Select with combobox role + search input', () => {
      const trigger = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', accessibleName: 'Search products',
        className: 'ant-select ant-select-show-search',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
      });
      const option = makeTarget({
        tag: 'DIV', ariaRole: 'option', accessibleName: 'Laptop Pro',
        className: 'ant-select-item ant-select-item-option',
      });

      const events = [
        focusEvent(trigger, {
          valueBefore: '',
          domContext: comboboxDomContext(true),
        }),
        clickEvent(option),
        blurEvent(trigger, {
          valueAfter: 'Laptop',
          domContext: comboboxDomContext(true),
        }),
      ];

      const result = detectInteractionsV2(events);
      // Should detect some form of dropdown/autocomplete interaction
      const dropdown = result.find(r =>
        r.type === 'Autocomplete' || r.type === 'CustomDropdown'
      );
      expect(dropdown).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. REACT-SELECT (no aria-autocomplete, uses class names)
  // ════════════════════════════════════════════════════════════════════════════

  describe('React-Select', () => {
    it('react-select with typeahead class detection', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Select a color',
        className: 'react-select-input typeahead',
      });

      const events = [
        focusEvent(input, {
          valueBefore: '',
          domContext: domContext({ inputType: 'text' }),
        }),
        blurEvent(input, {
          valueAfter: 'Red',
          domContext: domContext({ inputType: 'text' }),
        }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. GOOGLE FLIGHTS (combobox + suggestion patterns)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Google Flights', () => {
    it('airport search with combobox + suggestion dropdown', () => {
      const searchInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
        className: 'NZI5Gc',
      });
      const suggestion = makeTarget({
        tag: 'LI', accessibleName: 'New York (JFK)',
        ariaRole: 'option',
        className: 'sbct',
      });

      const events = [
        focusEvent(searchInput, {
          valueBefore: '',
          domContext: comboboxDomContext(true),
        }),
        clickEvent(suggestion),
        blurEvent(searchInput, {
          valueAfter: 'New York (JFK)',
          domContext: comboboxDomContext(true),
        }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r =>
        r.type === 'Autocomplete' || r.type === 'CustomDropdown'
      );
      expect(ac).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. NATIVE HTML DATALIST
  // ════════════════════════════════════════════════════════════════════════════

  describe('Native HTML <datalist>', () => {
    it('input with list attribute + datalist → Autocomplete', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Browser',
        cssSelector: 'input#browser-input',
      });

      const events = [
        focusEvent(input, {
          valueBefore: '',
          domContext: datalistDomContext('browsers'),
        }),
        blurEvent(input, {
          valueAfter: 'Firefox',
          domContext: datalistDomContext('browsers'),
        }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
    });

    it('datalist textValue extracted correctly', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Choose fruit',
        cssSelector: 'input#fruit',
      });

      const events = [
        focusEvent(input, {
          valueBefore: '',
          domContext: datalistDomContext('fruits'),
        }),
        blurEvent(input, {
          valueAfter: 'Mango',
          domContext: datalistDomContext('fruits'),
        }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
      expect(ac?.metadata.textValue).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. DOWNSHIFT (accessibility-first React library)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Downshift', () => {
    it('Downshift with aria-autocomplete="list" + focus/blur', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Search items', ariaRole: 'combobox',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
      });

      const events = [
        focusEvent(input, {
          valueBefore: '',
          domContext: autocompleteDomContext({ ariaAutoComplete: 'list' }),
        }),
        blurEvent(input, {
          valueAfter: 'Apple',
          domContext: autocompleteDomContext({ ariaAutoComplete: 'list' }),
        }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. REGRESSION: CustomDropdown still works (no autocomplete signals)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Regression: CustomDropdown preserved', () => {
    it('plain combobox click + option (no aria-autocomplete, no autocomplete class) → CustomDropdown', () => {
      const trigger = clickEvent({
        tag: 'DIV', accessibleName: 'Sort by', ariaRole: 'combobox',
      }, { domContext: comboboxDomContext(true) });
      const option = clickEvent({
        tag: 'LI', accessibleName: 'Price: Low to High', ariaRole: 'option',
      });

      const result = detectInteractionsV2([trigger, option]);
      const dropdown = result.find(r => r.type === 'CustomDropdown');
      expect(dropdown).toBeDefined();
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeUndefined();
    });

    it('AntD Select without search (class-only, no combobox role) → CustomDropdown', () => {
      const trigger = clickEvent({
        tag: 'DIV', accessibleName: 'Choose Status',
        className: 'ant-select-selector',
      }, { domContext: domContext() });
      const option = clickEvent({
        tag: 'DIV', accessibleName: 'Active',
        className: 'ant-select-item-option',
      });

      const result = detectInteractionsV2([trigger, option]);
      const dropdown = result.find(r => r.type === 'CustomDropdown');
      expect(dropdown).toBeDefined();
    });

    it('plain text input (no datalist, no combobox) → TextEntry', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Full Name',
        cssSelector: '#full-name',
      });

      const events = [
        focusEvent(input, {
          valueBefore: '',
          domContext: domContext({ inputType: 'text' }),
        }),
        blurEvent(input, {
          valueAfter: 'John Smith',
          domContext: domContext({ inputType: 'text' }),
        }),
      ];

      const result = detectInteractionsV2(events);
      const textEntry = result.find(r => r.type === 'TextEntry');
      expect(textEntry).toBeDefined();
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 8. METADATA QUALITY
  // ════════════════════════════════════════════════════════════════════════════

  describe('metadata quality', () => {
    it('aria-autocomplete combobox with search text and option name', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Airport', ariaRole: 'combobox',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
      });
      const option = makeTarget({
        tag: 'LI', accessibleName: 'JFK Airport', ariaRole: 'option',
      });

      const events = [
        focusEvent(input, {
          valueBefore: '',
          domContext: autocompleteDomContext(),
        }),
        clickEvent(option),
        blurEvent(input, {
          valueAfter: 'JFK',
          domContext: autocompleteDomContext(),
        }),
      ];

      const result = detectInteractionsV2(events);
      const ac = result.find(r => r.type === 'Autocomplete');
      expect(ac).toBeDefined();
      // Should have search text and/or selected value
      expect(ac?.metadata.textValue || ac?.metadata.selectedValue).toBeTruthy();
    });
  });
});
