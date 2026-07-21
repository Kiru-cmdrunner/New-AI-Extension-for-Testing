/**
 * Tests for InteractionContract Deriver
 *
 * Verifies that deriveInteractionContract correctly parses DOM attributes
 * into semantic constraints (required, inputType, valueRange, lengthRange,
 * format, dateFormat).
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §1
 */

import { describe, it, expect } from 'vitest';
import { deriveInteractionContract } from '../src/recorder/enrichment/interaction-contract-deriver';
import type { UiElement } from '../src/domain/entities/ui-element';
import { IntrinsicCapability } from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Fixtures ─────────────────────────────────────────────

function makeElement(
  attrs: Record<string, string>,
  capabilities: IntrinsicCapability[] = [],
  elementId = 'elem-001',
): UiElement {
  return {
    elementId,
    identity: makeIdentity(attrs['type']),
    domAttributes: attrs,
    sourceUrl: 'https://example.com/form',
    domTreePath: 'html>body>form>input',
    intrinsicCapabilities: capabilities,
    componentId: null,
    componentRole: null,
  };
}

function makeIdentity(inputType?: string): ElementIdentity {
  return {
    cssPath: 'form > input',
    xpath: '//form/input',
    ariaRole: 'textbox',
    ariaLevel: null,
    accessibleName: 'Email',
    tag: 'input',
    type: inputType ?? 'text',
    testId: null,
    text: null,
    childText: null,
    href: null,
    title: null,
    label: null,
    classes: [],
    attributes: {},
    domPosition: 1,
    rect: null,
  } as unknown as ElementIdentity;
}

// ── Tests ────────────────────────────────────────────────

describe('deriveInteractionContract', () => {
  describe('required constraint', () => {
    it('detects required attribute', () => {
      const el = makeElement({ type: 'text', required: '' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.required).toBe(true);
    });

    it('detects aria-required="true"', () => {
      const el = makeElement({ type: 'text', 'aria-required': 'true' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.required).toBe(true);
    });

    it('detects aria-required="false"', () => {
      const el = makeElement({ type: 'text', 'aria-required': 'false' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.required).toBe(false);
    });

    it('returns null when neither required nor aria-required present', () => {
      const el = makeElement({ type: 'text' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.required).toBeNull();
    });
  });

  describe('inputType', () => {
    it('extracts type attribute', () => {
      const el = makeElement({ type: 'email' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.inputType).toBe('email');
    });

    it('returns null when type attribute is absent', () => {
      const el = makeElement({});
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.inputType).toBeNull();
    });
  });

  describe('valueRange', () => {
    it('derives min/max/step from number input', () => {
      const el = makeElement({ type: 'number', min: '0', max: '100', step: '5' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.valueRange).toEqual({ min: 0, max: 100, step: 5 });
    });

    it('returns null when min and max are both absent', () => {
      const el = makeElement({ type: 'number' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.valueRange).toBeNull();
    });

    it('handles only min present', () => {
      const el = makeElement({ type: 'number', min: '10' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.valueRange).toEqual({
        min: 10,
        max: Number.POSITIVE_INFINITY,
        step: 1,
      });
    });

    it('handles only max present', () => {
      const el = makeElement({ type: 'number', max: '50' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.valueRange).toEqual({
        min: Number.NEGATIVE_INFINITY,
        max: 50,
        step: 1,
      });
    });

    it('defaults step to 1 when absent', () => {
      const el = makeElement({ type: 'number', min: '0', max: '10' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.valueRange?.step).toBe(1);
    });
  });

  describe('lengthRange', () => {
    it('derives minlength/maxlength', () => {
      const el = makeElement({ type: 'text', minlength: '3', maxlength: '20' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.lengthRange).toEqual({ minLength: 3, maxLength: 20 });
    });

    it('returns null when both absent', () => {
      const el = makeElement({ type: 'text' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.lengthRange).toBeNull();
    });

    it('handles only maxlength present', () => {
      const el = makeElement({ type: 'text', maxlength: '50' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.lengthRange).toEqual({
        minLength: 0,
        maxLength: 50,
      });
    });
  });

  describe('format', () => {
    it('derives format from pattern attribute', () => {
      const el = makeElement({ type: 'text', pattern: '[0-9]{4}' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.format).toEqual({
        regex: '[0-9]{4}',
        description: 'Pattern: [0-9]{4}',
      });
    });

    it('derives email format from type=email', () => {
      const el = makeElement({ type: 'email' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.format).not.toBeNull();
      expect(contract.constraints.format!.description).toContain('Email');
    });

    it('derives URL format from type=url', () => {
      const el = makeElement({ type: 'url' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.format).not.toBeNull();
      expect(contract.constraints.format!.description).toContain('URL');
    });

    it('returns null when no pattern or format type', () => {
      const el = makeElement({ type: 'text' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.format).toBeNull();
    });
  });

  describe('dateFormat', () => {
    it('derives date format from type=date', () => {
      const el = makeElement({ type: 'date', min: '2024-01-01', max: '2024-12-31' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.dateFormat).toEqual({
        format: 'yyyy-MM-dd',
        earliest: '2024-01-01',
        latest: '2024-12-31',
      });
    });

    it('derives datetime-local format', () => {
      const el = makeElement({ type: 'datetime-local' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.dateFormat?.format).toBe("yyyy-MM-dd'T'HH:mm");
    });

    it('derives time format', () => {
      const el = makeElement({ type: 'time' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.dateFormat?.format).toBe('HH:mm');
    });

    it('returns null for non-date types', () => {
      const el = makeElement({ type: 'text' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.dateFormat).toBeNull();
    });
  });

  describe('appliesTo', () => {
    it('sets appliesTo with element type and id', () => {
      const el = makeElement({}, [], 'elem-042');
      const contract = deriveInteractionContract(el);
      expect(contract.appliesTo).toEqual({ type: 'element', id: 'elem-042' });
    });
  });

  describe('affordances', () => {
    it('uses element capabilities when no pattern provided', () => {
      const caps = [IntrinsicCapability.CLICK, IntrinsicCapability.FOCUS];
      const el = makeElement({}, caps);
      const contract = deriveInteractionContract(el);
      expect(contract.affordances).toEqual(['click', 'focus']);
    });

    it('uses pattern affordances when pattern provided', () => {
      const el = makeElement({ type: 'text' });
      const pattern = {
        patternType: 'dropdown' as any,
        rootAriaRoles: ['combobox'],
        constituentRoles: {},
        affordances: ['click', 'select'],
        hasOptionSet: true,
        minConstituents: 2,
        description: 'test',
      } as any;
      const contract = deriveInteractionContract(el, pattern);
      expect(contract.affordances).toEqual(['click', 'select']);
    });
  });

  describe('validOptions', () => {
    it('is null by default (populated by orchestrator from component.optionSet)', () => {
      const el = makeElement({ type: 'text' });
      const contract = deriveInteractionContract(el);
      expect(contract.constraints.validOptions).toBeNull();
    });
  });
});
