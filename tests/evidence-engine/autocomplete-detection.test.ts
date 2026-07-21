/**
 * Autocomplete Detection Tests
 *
 * Validates that the V2 Evidence Engine correctly differentiates autocomplete
 * interactions (user types, selects from filtered suggestions) from plain
 * dropdown interactions (user clicks trigger, picks from fixed list).
 *
 * Detection signals covered:
 *   1. aria-autocomplete attribute present
 *   2. role=combobox + focus/blur with text change
 *   3. Native <datalist> (input[list])
 *   4. CSS class patterns (MUI Autocomplete, typeahead, combobox)
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
  datalistDomContext,
  comboboxDomContext,
} from './helpers.js';
import type { DomContext } from '../../src/recorder/recorded-event.js';

describe('Autocomplete Detection', () => {
  beforeEach(() => resetEventCounter());

  // ════════════════════════════════════════════════════════════════════════════
  // 1. ARIA-AUTOCOMPLETE SIGNAL
  // ════════════════════════════════════════════════════════════════════════════

  describe('aria-autocomplete attribute detection', () => {
    it('combobox with aria-autocomplete="list" → Autocomplete (not CustomDropdown)', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Airport Search', ariaRole: 'combobox',
      }, { domContext: autocompleteDomContext() });
      const click = clickEvent({
        tag: 'DIV', accessibleName: 'JFK - New York', ariaRole: 'option',
      }, { domContext: domContext() });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Airport Search', ariaRole: 'combobox',
        valueAfter: 'New',
      }, { domContext: autocompleteDomContext() });

      const result = detectInteractionsV2([focus, click, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });

    it('combobox with aria-autocomplete="both" → Autocomplete', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      }, { domContext: autocompleteDomContext({ ariaAutoComplete: 'both' }) });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
        valueAfter: 'test',
      }, { domContext: autocompleteDomContext({ ariaAutoComplete: 'both' }) });

      const result = detectInteractionsV2([focus, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. COMBOBOX WITH FOCUS/BLUR + TEXT CHANGE
  // ════════════════════════════════════════════════════════════════════════════

  describe('combobox focus/blur with text change', () => {
    it('combobox with focus+blur and text change + option click → Autocomplete', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Destination', ariaRole: 'combobox',
      }, {
        valueBefore: '',
        domContext: comboboxDomContext(true),
      });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'Paris, France', ariaRole: 'option',
      }, { domContext: domContext() });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Destination', ariaRole: 'combobox',
      }, {
        valueAfter: 'Par',
        domContext: comboboxDomContext(true),
      });

      const result = detectInteractionsV2([focus, optionClick, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });

    it('metadata includes search text (textValue)', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      }, {
        valueBefore: '',
        domContext: comboboxDomContext(true),
      });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'Paris', ariaRole: 'option',
      }, { domContext: domContext() });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      }, {
        valueAfter: 'Par',
        domContext: comboboxDomContext(true),
      });

      const result = detectInteractionsV2([focus, optionClick, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete?.metadata.textValue).toBeDefined();
    });

    it('metadata includes selected value (selectedValue)', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      }, {
        valueBefore: '',
        domContext: comboboxDomContext(true),
      });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'Paris, France', ariaRole: 'option',
      }, { domContext: domContext() });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Search', ariaRole: 'combobox',
      }, {
        valueAfter: 'Par',
        domContext: comboboxDomContext(true),
      });

      const result = detectInteractionsV2([focus, optionClick, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete?.metadata.selectedValue).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. NATIVE DATALIST
  // ════════════════════════════════════════════════════════════════════════════

  describe('native <datalist> detection', () => {
    it('input with list attribute → Autocomplete (not TextEntry)', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Browser',
      }, {
        valueBefore: '',
        domContext: datalistDomContext('browsers'),
      });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Browser',
      }, {
        valueAfter: 'Chrome',
        domContext: datalistDomContext('browsers'),
      });

      const result = detectInteractionsV2([focus, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });

    it('input without list attribute → TextEntry (not Autocomplete)', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Name',
      }, {
        valueBefore: '',
        domContext: domContext({ inputType: 'text' }),
      });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Name',
      }, {
        valueAfter: 'John',
        domContext: domContext({ inputType: 'text' }),
      });

      const result = detectInteractionsV2([focus, blur]);
      const textEntry = result.find(r => r.type === 'TextEntry');
      expect(textEntry).toBeDefined();
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. CSS CLASS PATTERNS
  // ════════════════════════════════════════════════════════════════════════════

  describe('CSS class pattern detection', () => {
    it('MuiAutocomplete-root class → Autocomplete', () => {
      const click = clickEvent({
        tag: 'DIV', accessibleName: 'Select Country',
        className: 'MuiAutocomplete-root',
      }, { domContext: domContext() });
      const result = detectInteractionsV2([click]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });

    it('react-autocomplete class → Autocomplete (generic pattern)', () => {
      const click = clickEvent({
        tag: 'DIV', accessibleName: 'Search',
        className: 'react-autocomplete-input',
      }, { domContext: domContext() });
      const result = detectInteractionsV2([click]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });

    it('typeahead class → Autocomplete (generic pattern)', () => {
      const click = clickEvent({
        tag: 'INPUT', accessibleName: 'Search City',
        className: 'twitter-typeahead',
      }, { domContext: domContext({ inputType: 'text' }) });
      const result = detectInteractionsV2([click]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. REGRESSION: CustomDropdown still works when no autocomplete signals
  // ════════════════════════════════════════════════════════════════════════════

  describe('CustomDropdown regression', () => {
    it('combobox click + option click without aria-autocomplete → CustomDropdown', () => {
      const triggerClick = clickEvent({
        tag: 'DIV', accessibleName: 'Status', ariaRole: 'combobox',
      }, { domContext: comboboxDomContext(true) });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'Active', ariaRole: 'option',
      }, { domContext: domContext() });

      const result = detectInteractionsV2([triggerClick, optionClick]);
      const customDropdown = result.find(r => r.type === 'CustomDropdown');
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      // Should be CustomDropdown, NOT Autocomplete (no text search)
      expect(customDropdown).toBeDefined();
      expect(autocomplete).toBeUndefined();
    });

    it('MUI Select (MuiSelect-root) → CustomDropdown (not Autocomplete)', () => {
      const triggerClick = clickEvent({
        tag: 'DIV', accessibleName: 'Choose One',
        className: 'MuiSelect-root',
      }, { domContext: domContext() });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'Option A', ariaRole: 'option',
      }, { domContext: domContext() });

      const result = detectInteractionsV2([triggerClick, optionClick]);
      const customDropdown = result.find(r => r.type === 'CustomDropdown');
      expect(customDropdown).toBeDefined();
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. METADATA EXTRACTION
  // ════════════════════════════════════════════════════════════════════════════

  describe('metadata extraction', () => {
    it('extracts both search text and selected option name', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Airport', ariaRole: 'combobox',
      }, {
        valueBefore: '',
        domContext: autocompleteDomContext(),
      });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'JFK - John F. Kennedy', ariaRole: 'option',
      }, { domContext: domContext() });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Airport', ariaRole: 'combobox',
      }, {
        valueAfter: 'New',
        domContext: autocompleteDomContext(),
      });

      const result = detectInteractionsV2([focus, optionClick, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete).toBeDefined();
      // textValue should come from blur valueAfter or focus/blur text change
      expect(autocomplete?.metadata.textValue).toBeDefined();
      // selectedValue should come from option accessibleName
      expect(autocomplete?.metadata.selectedValue).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. TIMELINE PHRASING
  // ════════════════════════════════════════════════════════════════════════════

  describe('timeline phrasing data', () => {
    it('has both textValue and selectedValue for Search/Select phrasing', () => {
      const focus = focusEvent({
        tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
      }, {
        valueBefore: '',
        domContext: autocompleteDomContext(),
      });
      const optionClick = clickEvent({
        tag: 'LI', accessibleName: 'New York (JFK)', ariaRole: 'option',
      }, { domContext: domContext() });
      const blur = blurEvent({
        tag: 'INPUT', accessibleName: 'Where from?', ariaRole: 'combobox',
      }, {
        valueAfter: 'New York',
        domContext: autocompleteDomContext(),
      });

      const result = detectInteractionsV2([focus, optionClick, blur]);
      const autocomplete = result.find(r => r.type === 'Autocomplete');
      expect(autocomplete?.metadata.textValue).toBeDefined();
      expect(autocomplete?.metadata.selectedValue).toBeDefined();
    });
  });
});
