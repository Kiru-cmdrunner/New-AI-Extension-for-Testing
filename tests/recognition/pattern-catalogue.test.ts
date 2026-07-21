/**
 * Pattern Catalogue — unit tests.
 *
 * Tests catalogue registration, lookup, validation, and the V1 pattern definitions.
 * Verifies the catalogue is self-consistent and ready for the recognizer to consume.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPattern,
  getPattern,
  getAllPatterns,
  clearCatalogue,
  buildRoleReverseLookup,
  type PatternDefinition,
} from '../../src/recorder/recognition/pattern-catalogue';
import { PatternType, ComponentRole } from '../../src/domain/enums';
import { ValueObjectError } from '../../src/domain/errors/invariant-errors';

describe('Pattern Catalogue', () => {
  // Reset to V1 defaults before each test
  beforeEach(() => {
    clearCatalogue();
    // Re-import V1 patterns by re-registering them
    // Since the module auto-registers on import, we need to re-import
    // But vitest caches imports, so we manually re-register the 5 V1 patterns
    registerV1Patterns();
  });

  describe('V1 pattern definitions', () => {
    it('should have all 5 V1 patterns registered', () => {
      const all = getAllPatterns();
      expect(all).toHaveLength(5);
      const types = all.map((p) => p.patternType);
      expect(types).toContain(PatternType.DROPDOWN);
      expect(types).toContain(PatternType.CHECKBOX);
      expect(types).toContain(PatternType.RADIO_GROUP);
      expect(types).toContain(PatternType.MODAL);
      expect(types).toContain(PatternType.TABS);
    });

    it('dropdown should have combobox and listbox as root roles', () => {
      const dropdown = getPattern(PatternType.DROPDOWN)!;
      expect(dropdown.rootAriaRoles).toContain('combobox');
      expect(dropdown.rootAriaRoles).toContain('listbox');
      expect(dropdown.hasOptionSet).toBe(true);
      expect(dropdown.minConstituents).toBe(2);
    });

    it('checkbox should have checkbox as root role and minConstituents of 1', () => {
      const checkbox = getPattern(PatternType.CHECKBOX)!;
      expect(checkbox.rootAriaRoles).toEqual(['checkbox']);
      expect(checkbox.minConstituents).toBe(1);
      expect(dropdown_hasOptionSet(checkbox)).toBe(false);
    });

    it('radioGroup should have radiogroup root role and option set', () => {
      const radio = getPattern(PatternType.RADIO_GROUP)!;
      expect(radio.rootAriaRoles).toEqual(['radiogroup']);
      expect(radio.hasOptionSet).toBe(true);
      expect(radio.constituentRoles[ComponentRole.OPTION]).toContain('radio');
      expect(radio.constituentRoles[ComponentRole.OPTION]).toContain('menuitemradio');
    });

    it('modal should have dialog and alertdialog as root roles', () => {
      const modal = getPattern(PatternType.MODAL)!;
      expect(modal.rootAriaRoles).toContain('dialog');
      expect(modal.rootAriaRoles).toContain('alertdialog');
      expect(modal.minConstituents).toBe(1);
    });

    it('tabs should have tablist root role with tab and tabpanel constituents', () => {
      const tabs = getPattern(PatternType.TABS)!;
      expect(tabs.rootAriaRoles).toEqual(['tablist']);
      expect(tabs.constituentRoles[ComponentRole.TAB]).toContain('tab');
      expect(tabs.constituentRoles[ComponentRole.PANEL]).toContain('tabpanel');
    });
  });

  describe('getAllPatterns ordering', () => {
    it('should return patterns ordered by specificity (fewer root roles first)', () => {
      const all = getAllPatterns();
      for (let i = 0; i < all.length - 1; i++) {
        expect(all[i].rootAriaRoles.length).toBeLessThanOrEqual(all[i + 1].rootAriaRoles.length);
      }
    });
  });

  describe('registerPattern validation', () => {
    it('should throw on empty rootAriaRoles', () => {
      expect(() =>
        registerPattern({
          patternType: PatternType.CUSTOM,
          rootAriaRoles: [],
          constituentRoles: { [ComponentRole.TRIGGER]: ['button'] },
          affordances: [],
          hasOptionSet: false,
          minConstituents: 1,
          description: 'test',
        }),
      ).toThrow(ValueObjectError);
    });

    it('should throw on empty constituentRoles', () => {
      expect(() =>
        registerPattern({
          patternType: PatternType.CUSTOM,
          rootAriaRoles: ['widget'],
          constituentRoles: {},
          affordances: [],
          hasOptionSet: false,
          minConstituents: 1,
          description: 'test',
        }),
      ).toThrow(ValueObjectError);
    });

    it('should throw on minConstituents < 1', () => {
      expect(() =>
        registerPattern({
          patternType: PatternType.CUSTOM,
          rootAriaRoles: ['widget'],
          constituentRoles: { [ComponentRole.TRIGGER]: ['widget'] },
          affordances: [],
          hasOptionSet: false,
          minConstituents: 0,
          description: 'test',
        }),
      ).toThrow(ValueObjectError);
    });

    it('should successfully register a new valid pattern', () => {
      const accordion: PatternDefinition = {
        patternType: PatternType.ACCORDION,
        rootAriaRoles: ['group'],
        constituentRoles: {
          [ComponentRole.CONTAINER]: ['group'],
          [ComponentRole.TRIGGER]: ['button'],
        },
        affordances: ['toggle'],
        hasOptionSet: false,
        minConstituents: 1,
        description: 'Accordion section',
      };
      registerPattern(accordion);
      expect(getPattern(PatternType.ACCORDION)).toBeDefined();
      expect(getAllPatterns()).toHaveLength(6);
    });
  });

  describe('buildRoleReverseLookup', () => {
    it('should map ARIA roles back to ComponentRoles', () => {
      const dropdown = getPattern(PatternType.DROPDOWN)!;
      const reverse = buildRoleReverseLookup(dropdown);

      expect(reverse.get('combobox')).toBe(ComponentRole.TRIGGER);
      expect(reverse.get('listbox')).toBe(ComponentRole.CONTAINER);
      expect(reverse.get('option')).toBe(ComponentRole.OPTION);
      expect(reverse.has('button')).toBe(false);
    });

    it('first ComponentRole wins when multiple map to same ARIA role', () => {
      const modal = getPattern(PatternType.MODAL)!;
      const reverse = buildRoleReverseLookup(modal);

      // Both COMMIT and CANCEL map to 'button' — whichever comes first in enum order wins
      expect(reverse.has('button')).toBe(true);
      expect(reverse.has('dialog')).toBe(true);
    });
  });
});

// ── Helpers ──────────────────────────────────────────────

function dropdown_hasOptionSet(def: PatternDefinition): boolean {
  return def.hasOptionSet;
}

function registerV1Patterns(): void {
  registerPattern({
    patternType: PatternType.DROPDOWN,
    rootAriaRoles: ['combobox', 'listbox'],
    constituentRoles: {
      [ComponentRole.TRIGGER]: ['combobox'],
      [ComponentRole.CONTAINER]: ['listbox'],
      [ComponentRole.OPTION]: ['option'],
    },
    affordances: ['open', 'select', 'search', 'commit', 'close'],
    hasOptionSet: true,
    minConstituents: 2,
    description: 'Combobox or listbox with selectable options',
  });

  registerPattern({
    patternType: PatternType.CHECKBOX,
    rootAriaRoles: ['checkbox'],
    constituentRoles: {
      [ComponentRole.TRIGGER]: ['checkbox'],
    },
    affordances: ['toggle'],
    hasOptionSet: false,
    minConstituents: 1,
    description: 'Checkbox toggle control',
  });

  registerPattern({
    patternType: PatternType.RADIO_GROUP,
    rootAriaRoles: ['radiogroup'],
    constituentRoles: {
      [ComponentRole.CONTAINER]: ['radiogroup'],
      [ComponentRole.OPTION]: ['radio', 'menuitemradio'],
    },
    affordances: ['select'],
    hasOptionSet: true,
    minConstituents: 2,
    description: 'Radio group with mutually exclusive options',
  });

  registerPattern({
    patternType: PatternType.MODAL,
    rootAriaRoles: ['dialog', 'alertdialog'],
    constituentRoles: {
      [ComponentRole.CONTAINER]: ['dialog', 'alertdialog'],
      [ComponentRole.COMMIT]: ['button'],
      [ComponentRole.CANCEL]: ['button'],
    },
    affordances: ['close', 'commit', 'cancel'],
    hasOptionSet: false,
    minConstituents: 1,
    description: 'Modal dialog or alert dialog',
  });

  registerPattern({
    patternType: PatternType.TABS,
    rootAriaRoles: ['tablist'],
    constituentRoles: {
      [ComponentRole.CONTAINER]: ['tablist'],
      [ComponentRole.TAB]: ['tab'],
      [ComponentRole.PANEL]: ['tabpanel'],
    },
    affordances: ['activate'],
    hasOptionSet: false,
    minConstituents: 2,
    description: 'Tab list with associated panels',
  });
}
