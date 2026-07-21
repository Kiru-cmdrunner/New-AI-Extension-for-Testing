/**
 * Element Entity Tests — domain-schema.md §3.4
 *
 * Tests Element and LocatorStrategy creation, validation, and invariants.
 */
import { describe, it, expect } from 'vitest';
import {
  createElement,
  updateElement,
  createLocatorStrategy,
  type CreateElementInput,
} from '../../src/domain/entities/element';
import { ElementStatus, LocatorStrategyType } from '../../src/domain/enums';
import { MissingFieldError, ValueObjectError } from '../../src/domain/errors/invariant-errors';

// ── LocatorStrategy Tests ─────────────────────────────────

describe('LocatorStrategy', () => {

  describe('createLocatorStrategy', () => {
    it('creates a strategy with all fields', () => {
      const ls = createLocatorStrategy({
        type: LocatorStrategyType.ROLE,
        value: 'button[name="Sign In"]',
        priority: 1,
      });
      expect(ls.type).toBe(LocatorStrategyType.ROLE);
      expect(ls.value).toBe('button[name="Sign In"]');
      expect(ls.priority).toBe(1);
      expect(ls.confidence).toBeNull(); // default
    });

    it('accepts explicit confidence value', () => {
      const ls = createLocatorStrategy({
        type: LocatorStrategyType.CSS,
        value: '#login-btn',
        priority: 2,
        confidence: 0.85,
      });
      expect(ls.confidence).toBe(0.85);
    });

    it('accepts null confidence', () => {
      const ls = createLocatorStrategy({
        type: LocatorStrategyType.TEST_ID,
        value: '[data-testid="login"]',
        priority: 1,
        confidence: null,
      });
      expect(ls.confidence).toBeNull();
    });

    it('trims whitespace from value', () => {
      const ls = createLocatorStrategy({
        type: LocatorStrategyType.CSS,
        value: '  #login-btn  ',
        priority: 1,
      });
      expect(ls.value).toBe('#login-btn');
    });

    it('throws ValueObjectError when type is missing', () => {
      expect(() => createLocatorStrategy({
        type: undefined as unknown as LocatorStrategyType,
        value: 'x', priority: 1,
      })).toThrow(ValueObjectError);
    });

    it('throws ValueObjectError when value is empty', () => {
      expect(() => createLocatorStrategy({
        type: LocatorStrategyType.CSS, value: '', priority: 1,
      })).toThrow(ValueObjectError);
    });

    it('throws ValueObjectError when value is whitespace-only', () => {
      expect(() => createLocatorStrategy({
        type: LocatorStrategyType.CSS, value: '   ', priority: 1,
      })).toThrow(ValueObjectError);
    });

    it('throws ValueObjectError when priority is zero', () => {
      expect(() => createLocatorStrategy({
        type: LocatorStrategyType.CSS, value: '#btn', priority: 0,
      })).toThrow(ValueObjectError);
    });

    it('throws ValueObjectError when priority is negative', () => {
      expect(() => createLocatorStrategy({
        type: LocatorStrategyType.CSS, value: '#btn', priority: -1,
      })).toThrow(ValueObjectError);
    });

    it('throws ValueObjectError when priority is not an integer', () => {
      expect(() => createLocatorStrategy({
        type: LocatorStrategyType.CSS, value: '#btn', priority: 1.5,
      })).toThrow(ValueObjectError);
    });
  });
});

// ── Element Tests ─────────────────────────────────────────

describe('Element Entity', () => {

  const validInput: CreateElementInput = {
    projectId: 'prj-001',
    logicalName: 'Login Button',
    description: 'The primary sign-in submission button on the login page',
    pageOrComponent: 'login_page',
    locatorStrategies: [
      { type: LocatorStrategyType.ROLE, value: 'button[name="Sign In"]', priority: 1 },
      { type: LocatorStrategyType.TEST_ID, value: '[data-testid="login-submit"]', priority: 2 },
    ],
  };

  // ── Valid Creation ──────────────────────────────────────

  describe('createElement', () => {
    it('creates an element with all fields populated', () => {
      const elm = createElement(validInput);

      expect(elm.id).toBeDefined();
      expect(elm.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(elm.projectId).toBe('prj-001');
      expect(elm.logicalName).toBe('Login Button');
      expect(elm.description).toBe('The primary sign-in submission button on the login page');
      expect(elm.pageOrComponent).toBe('login_page');
      expect(elm.locatorStrategies).toHaveLength(2);
      expect(elm.status).toBe(ElementStatus.ACTIVE);
      expect(elm.createdAt).toBeDefined();
      expect(elm.updatedAt).toBe(elm.createdAt);
      expect(elm.lastHealedAt).toBeNull();
      expect(elm.healHistory).toEqual([]);
    });

    it('defaults description to empty string', () => {
      const elm = createElement({
        ...validInput,
        description: undefined,
      });
      expect(elm.description).toBe('');
    });

    it('defaults pageOrComponent to empty string', () => {
      const elm = createElement({
        ...validInput,
        pageOrComponent: undefined,
      });
      expect(elm.pageOrComponent).toBe('');
    });

    it('sets confidence to null for all strategies when not specified', () => {
      const elm = createElement(validInput);
      expect(elm.locatorStrategies.every(s => s.confidence === null)).toBe(true);
    });

    it('trims whitespace from logicalName', () => {
      const elm = createElement({ ...validInput, logicalName: '  Login Button  ' });
      expect(elm.logicalName).toBe('Login Button');
    });
  });

  // ── Invariant: INV-EL4 (non-empty locatorStrategies) ────

  describe('INV-EL4: locatorStrategies must be non-empty', () => {
    it('throws when locatorStrategies is empty array', () => {
      expect(() => createElement({ ...validInput, locatorStrategies: [] }))
        .toThrow(ValueObjectError);
    });

    it('throws when locatorStrategies is undefined', () => {
      expect(() => createElement({
        ...validInput,
        locatorStrategies: undefined as unknown as CreateElementInput['locatorStrategies'],
      })).toThrow(ValueObjectError);
    });

    it('error message references INV-EL4', () => {
      try {
        createElement({ ...validInput, locatorStrategies: [] });
      } catch (e) {
        expect((e as Error).message).toContain('INV-EL4');
      }
    });
  });

  // ── Invariant: Unique priorities ────────────────────────

  describe('unique priorities', () => {
    it('throws when two strategies have the same priority', () => {
      expect(() => createElement({
        ...validInput,
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '#a', priority: 1 },
          { type: LocatorStrategyType.TEST_ID, value: '[data-testid="a"]', priority: 1 },
        ],
      })).toThrow(ValueObjectError);
    });

    it('allows strategies with different priorities', () => {
      const elm = createElement({
        ...validInput,
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '#a', priority: 1 },
          { type: LocatorStrategyType.TEST_ID, value: '[data-testid="a"]', priority: 2 },
          { type: LocatorStrategyType.XPATH, value: '//button', priority: 3 },
        ],
      });
      expect(elm.locatorStrategies).toHaveLength(3);
    });
  });

  // ── Required Field Violations ───────────────────────────

  describe('required field violations', () => {
    it('throws MissingFieldError when projectId is empty', () => {
      expect(() => createElement({ ...validInput, projectId: '' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when logicalName is empty', () => {
      expect(() => createElement({ ...validInput, logicalName: '' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when logicalName is whitespace', () => {
      expect(() => createElement({ ...validInput, logicalName: '   ' }))
        .toThrow(MissingFieldError);
    });
  });

  // ── updateElement ───────────────────────────────────────

  describe('updateElement', () => {
    it('updates logicalName', () => {
      const original = createElement(validInput);
      const updated = updateElement(original, { logicalName: 'Sign In Button' });
      expect(updated.logicalName).toBe('Sign In Button');
      expect(updated.id).toBe(original.id);
    });

    it('updates description', () => {
      const original = createElement(validInput);
      const updated = updateElement(original, { description: 'New desc' });
      expect(updated.description).toBe('New desc');
    });

    it('updates pageOrComponent', () => {
      const original = createElement(validInput);
      const updated = updateElement(original, { pageOrComponent: 'nav_bar' });
      expect(updated.pageOrComponent).toBe('nav_bar');
    });

    it('updates status', () => {
      const original = createElement(validInput);
      const updated = updateElement(original, { status: ElementStatus.STALE });
      expect(updated.status).toBe(ElementStatus.STALE);
    });

    it('updates locatorStrategies', () => {
      const original = createElement(validInput);
      const updated = updateElement(original, {
        locatorStrategies: [
          { type: LocatorStrategyType.TEST_ID, value: '[data-testid="new"]', priority: 1 },
        ],
      });
      expect(updated.locatorStrategies).toHaveLength(1);
      expect(updated.locatorStrategies[0].type).toBe(LocatorStrategyType.TEST_ID);
    });

    it('updates updatedAt timestamp', async () => {
      const original = createElement(validInput);
      await new Promise(r => setTimeout(r, 5));
      const updated = updateElement(original, { logicalName: 'New' });
      expect(updated.updatedAt).not.toBe(original.updatedAt);
    });

    it('preserves unspecified fields', () => {
      const original = createElement(validInput);
      const updated = updateElement(original, { logicalName: 'New' });
      expect(updated.description).toBe(original.description);
      expect(updated.pageOrComponent).toBe(original.pageOrComponent);
      expect(updated.locatorStrategies).toEqual(original.locatorStrategies);
    });

    it('throws when updating to empty logicalName', () => {
      const original = createElement(validInput);
      expect(() => updateElement(original, { logicalName: '' }))
        .toThrow(MissingFieldError);
    });

    it('throws when updating to empty locatorStrategies', () => {
      const original = createElement(validInput);
      expect(() => updateElement(original, { locatorStrategies: [] }))
        .toThrow(ValueObjectError);
    });

    it('throws on duplicate priorities when updating', () => {
      const original = createElement(validInput);
      expect(() => updateElement(original, {
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '#a', priority: 1 },
          { type: LocatorStrategyType.TEST_ID, value: '[data-testid="a"]', priority: 1 },
        ],
      })).toThrow(ValueObjectError);
    });
  });
});
