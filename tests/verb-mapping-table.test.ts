import { describe, it, expect } from 'vitest';
import {
  VERB_MAPPING_TABLE,
  lookupExecutionVerb,
  type ExecutionVerb,
} from '../src/generation/verb-mapping-table';
import type { CanonicalType } from '../src/shared/architecture-types';

describe('Verb Mapping Table', () => {

  describe('Completeness', () => {
    it('contains all 10 canonical types', () => {
      const keys = Object.keys(VERB_MAPPING_TABLE);
      expect(keys).toHaveLength(10);
    });

    it('covers every CanonicalType value', () => {
      const allTypes: CanonicalType[] = [
        'navigate', 'click', 'fill', 'select', 'toggle',
        'selectDate', 'hover', 'pressKey', 'upload', 'drag',
      ];
      for (const ct of allTypes) {
        expect(VERB_MAPPING_TABLE[ct]).toBeDefined();
      }
    });

    it('entries have matching canonicalType field', () => {
      for (const [key, entry] of Object.entries(VERB_MAPPING_TABLE)) {
        expect(entry.canonicalType).toBe(key);
      }
    });
  });

  describe('Individual mappings', () => {
    it('navigate maps to navigate verb', () => {
      expect(VERB_MAPPING_TABLE.navigate.executionVerb).toBe('navigate');
      expect(VERB_MAPPING_TABLE.navigate.requiresValue).toBe(true);
    });

    it('click maps to click verb', () => {
      expect(VERB_MAPPING_TABLE.click.executionVerb).toBe('click');
      expect(VERB_MAPPING_TABLE.click.requiresValue).toBe(false);
    });

    it('fill maps to fill verb', () => {
      expect(VERB_MAPPING_TABLE.fill.executionVerb).toBe('fill');
      expect(VERB_MAPPING_TABLE.fill.requiresValue).toBe(true);
    });

    it('select maps to select verb', () => {
      expect(VERB_MAPPING_TABLE.select.executionVerb).toBe('select');
      expect(VERB_MAPPING_TABLE.select.requiresValue).toBe(true);
    });

    it('toggle maps to check verb (default)', () => {
      expect(VERB_MAPPING_TABLE.toggle.executionVerb).toBe('check');
    });

    it('selectDate maps to fill verb', () => {
      expect(VERB_MAPPING_TABLE.selectDate.executionVerb).toBe('fill');
      expect(VERB_MAPPING_TABLE.selectDate.requiresValue).toBe(true);
    });

    it('hover maps to hover verb', () => {
      expect(VERB_MAPPING_TABLE.hover.executionVerb).toBe('hover');
      expect(VERB_MAPPING_TABLE.hover.requiresValue).toBe(false);
    });

    it('pressKey maps to press verb', () => {
      expect(VERB_MAPPING_TABLE.pressKey.executionVerb).toBe('press');
    });

    it('upload maps to upload verb', () => {
      expect(VERB_MAPPING_TABLE.upload.executionVerb).toBe('upload');
    });

    it('drag maps to drag verb', () => {
      expect(VERB_MAPPING_TABLE.drag.executionVerb).toBe('drag');
    });
  });

  describe('Playwright verb documentation', () => {
    it('every entry has a playwrightVerb string', () => {
      for (const entry of Object.values(VERB_MAPPING_TABLE)) {
        expect(entry.playwrightVerb).toBeTruthy();
        expect(typeof entry.playwrightVerb).toBe('string');
      }
    });
  });

  describe('lookupExecutionVerb', () => {
    it('returns navigate for navigate', () => {
      expect(lookupExecutionVerb('navigate')).toBe('navigate');
    });

    it('returns click for click', () => {
      expect(lookupExecutionVerb('click')).toBe('click');
    });

    it('returns fill for fill', () => {
      expect(lookupExecutionVerb('fill')).toBe('fill');
    });

    it('returns select for select', () => {
      expect(lookupExecutionVerb('select')).toBe('select');
    });

    it('returns fill for selectDate', () => {
      expect(lookupExecutionVerb('selectDate')).toBe('fill');
    });

    it('returns hover for hover', () => {
      expect(lookupExecutionVerb('hover')).toBe('hover');
    });

    it('returns press for pressKey', () => {
      expect(lookupExecutionVerb('pressKey')).toBe('press');
    });

    it('returns upload for upload', () => {
      expect(lookupExecutionVerb('upload')).toBe('upload');
    });

    it('returns drag for drag', () => {
      expect(lookupExecutionVerb('drag')).toBe('drag');
    });

    it('returns check for toggle with checked=true', () => {
      expect(lookupExecutionVerb('toggle', true)).toBe('check');
    });

    it('returns check for toggle with no checked arg (default)', () => {
      expect(lookupExecutionVerb('toggle')).toBe('check');
    });

    it('returns uncheck for toggle with checked=false', () => {
      expect(lookupExecutionVerb('toggle', false)).toBe('uncheck');
    });
  });

  describe('Immutability', () => {
    it('VERB_MAPPING_TABLE is frozen', () => {
      expect(Object.isFrozen(VERB_MAPPING_TABLE)).toBe(true);
    });

    it('mutating the table throws in strict mode', () => {
      'use strict';
      expect(() => {
        // @ts-expect-error — testing runtime immutability
        VERB_MAPPING_TABLE.click = VERB_MAPPING_TABLE.navigate;
      }).toThrow(TypeError);
    });
  });

  describe('Verb values are valid ExecutionVerbs', () => {
    it('all execution verbs are from the ExecutionVerb union', () => {
      const validVerbs: ExecutionVerb[] = [
        'navigate', 'click', 'fill', 'select', 'check',
        'uncheck', 'hover', 'press', 'upload', 'drag',
      ];
      for (const entry of Object.values(VERB_MAPPING_TABLE)) {
        expect(validVerbs).toContain(entry.executionVerb);
      }
    });
  });
});
