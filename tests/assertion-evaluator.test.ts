/**
 * Tests for the Assertion Evaluator — evaluates IRAssertion[] against live DOM.
 *
 * Uses jsdom to simulate a DOM environment. Tests cover:
 *   - Each ValidationType (presence, visibility, textMatch, attributeMatch,
 *     equality, count, urlMatch, custom)
 *   - Each ValidationComparison (equals, contains, matches, startsWith,
 *     greaterThan, lessThan, isTrue, isFalse)
 *   - Property extraction (text, value, visible, enabled, checked, href, etc.)
 *   - Missing element handling
 *   - URL-based assertions
 *   - Batch evaluation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateAssertion,
  evaluateAssertions,
  extractPropertyValue,
  compareValues,
  type AssertionInput,
  type AssertionResult,
} from '../src/execution/assertion-evaluator';

// ── Test Helpers ────────────────────────────────────────────

function setupDom(html: string): void {
  document.body.innerHTML = html;
}

function elementAssertion(
  element: Element | null,
  overrides: Partial<AssertionInput> = {},
): AssertionInput {
  return {
    type: 'textMatch',
    comparison: 'equals',
    expectedValue: '',
    property: null,
    target: { kind: 'element', element },
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('Assertion Evaluator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── compareValues ──
  describe('compareValues', () => {
    it('equals — string equality', () => {
      expect(compareValues('hello', 'hello', 'equals')).toBe(true);
      expect(compareValues('hello', 'world', 'equals')).toBe(false);
    });

    it('equals — number → string coercion', () => {
      expect(compareValues(42, '42', 'equals')).toBe(true);
      expect(compareValues(42, 42, 'equals')).toBe(true);
    });

    it('equals — boolean → string coercion', () => {
      expect(compareValues(true, 'true', 'equals')).toBe(true);
      expect(compareValues(false, 'false', 'equals')).toBe(true);
    });

    it('contains — substring match', () => {
      expect(compareValues('hello world', 'world', 'contains')).toBe(true);
      expect(compareValues('hello', 'world', 'contains')).toBe(false);
    });

    it('contains — array includes', () => {
      expect(compareValues(['a', 'b', 'c'], 'b', 'contains')).toBe(true);
      expect(compareValues(['a', 'b', 'c'], 'd', 'contains')).toBe(false);
    });

    it('contains — non-string non-array returns false', () => {
      expect(compareValues(42, '4', 'contains')).toBe(false);
    });

    it('matches — regex pattern', () => {
      expect(compareValues('hello123', 'hello\\d+', 'matches')).toBe(true);
      expect(compareValues('hello', 'hello\\d+', 'matches')).toBe(false);
    });

    it('matches — invalid regex returns false', () => {
      expect(compareValues('test', '(', 'matches')).toBe(false);
    });

    it('startsWith — prefix match', () => {
      expect(compareValues('hello world', 'hello', 'startsWith')).toBe(true);
      expect(compareValues('hello world', 'world', 'startsWith')).toBe(false);
    });

    it('greaterThan — numeric comparison', () => {
      expect(compareValues(10, 5, 'greaterThan')).toBe(true);
      expect(compareValues(5, 10, 'greaterThan')).toBe(false);
      expect(compareValues('10', '5', 'greaterThan')).toBe(true);
    });

    it('lessThan — numeric comparison', () => {
      expect(compareValues(5, 10, 'lessThan')).toBe(true);
      expect(compareValues(10, 5, 'lessThan')).toBe(false);
    });

    it('isTrue — truthy values', () => {
      expect(compareValues(true, null, 'isTrue')).toBe(true);
      expect(compareValues('true', null, 'isTrue')).toBe(true);
      expect(compareValues(1, null, 'isTrue')).toBe(true);
      expect(compareValues('1', null, 'isTrue')).toBe(true);
      expect(compareValues(false, null, 'isTrue')).toBe(false);
      expect(compareValues(0, null, 'isTrue')).toBe(false);
    });

    it('isFalse — falsy values', () => {
      expect(compareValues(false, null, 'isFalse')).toBe(true);
      expect(compareValues('false', null, 'isFalse')).toBe(true);
      expect(compareValues(0, null, 'isFalse')).toBe(true);
      expect(compareValues(null, null, 'isFalse')).toBe(true);
      expect(compareValues('', null, 'isFalse')).toBe(true);
      expect(compareValues(true, null, 'isFalse')).toBe(false);
      expect(compareValues('true', null, 'isFalse')).toBe(false);
    });

    it('unknown comparison defaults to equals', () => {
      expect(compareValues('abc', 'abc', 'unknownOp')).toBe(true);
      expect(compareValues('abc', 'xyz', 'unknownOp')).toBe(false);
    });
  });

  // ── extractPropertyValue ──
  describe('extractPropertyValue', () => {
    it('extracts text content', () => {
      setupDom('<button>Submit Form</button>');
      const el = document.querySelector('button')!;
      expect(extractPropertyValue(el, 'text')).toBe('Submit Form');
    });

    it('extracts input value', () => {
      setupDom('<input value="test@example.com" />');
      const el = document.querySelector('input')!;
      expect(extractPropertyValue(el, 'value')).toBe('test@example.com');
    });

    it('extracts visibility', () => {
      setupDom('<div style="display:block">Visible</div>');
      const el = document.querySelector('div')!;
      expect(extractPropertyValue(el, 'visible')).toBe(true);
    });

    it('extracts visibility (hidden)', () => {
      setupDom('<div style="display:none">Hidden</div>');
      const el = document.querySelector('div')!;
      expect(extractPropertyValue(el, 'visible')).toBe(false);
    });

    it('extracts enabled state', () => {
      setupDom('<button>Enabled</button>');
      const el = document.querySelector('button')!;
      expect(extractPropertyValue(el, 'enabled')).toBe(true);
    });

    it('extracts disabled state', () => {
      setupDom('<button disabled>Disabled</button>');
      const el = document.querySelector('button')!;
      expect(extractPropertyValue(el, 'enabled')).toBe(false);
    });

    it('extracts checked state', () => {
      setupDom('<input type="checkbox" checked />');
      const el = document.querySelector('input')!;
      expect(extractPropertyValue(el, 'checked')).toBe(true);
    });

    it('extracts href', () => {
      setupDom('<a href="/login">Login</a>');
      const el = document.querySelector('a')!;
      expect(extractPropertyValue(el, 'href')).toBe('/login');
    });

    it('extracts className', () => {
      setupDom('<div class="btn btn-primary">Click</div>');
      const el = document.querySelector('div')!;
      expect(extractPropertyValue(el, 'class')).toBe('btn btn-primary');
    });

    it('extracts tagName', () => {
      setupDom('<button>Click</button>');
      const el = document.querySelector('button')!;
      expect(extractPropertyValue(el, 'tag')).toBe('button');
    });

    it('extracts id', () => {
      setupDom('<div id="main-content">Content</div>');
      const el = document.querySelector('div')!;
      expect(extractPropertyValue(el, 'id')).toBe('main-content');
    });

    it('extracts custom attribute', () => {
      setupDom('<div data-custom="value">Content</div>');
      const el = document.querySelector('div')!;
      expect(extractPropertyValue(el, 'data-custom')).toBe('value');
    });

    it('returns null for missing element', () => {
      expect(extractPropertyValue(null, 'text')).toBeNull();
    });

    it('uses textContent as default when property is null', () => {
      setupDom('<p>Hello</p>');
      const el = document.querySelector('p')!;
      expect(extractPropertyValue(el, null)).toBe('Hello');
    });

    it('extracts URL from url property', () => {
      expect(extractPropertyValue(null, 'url', 'https://example.com/page')).toBe('https://example.com/page');
    });
  });

  // ── evaluateAssertion — PRESENCE ──
  describe('evaluateAssertion — presence', () => {
    it('passes when element is present (isTrue)', () => {
      setupDom('<button data-testid="btn">Click</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, { type: 'presence', comparison: 'isTrue', expectedValue: true }),
      );
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe(true);
    });

    it('fails when element is not present (isTrue)', () => {
      const result = evaluateAssertion(
        elementAssertion(null, { type: 'presence', comparison: 'isTrue', expectedValue: true }),
      );
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe(false);
    });

    it('passes when element is absent (isFalse)', () => {
      const result = evaluateAssertion(
        elementAssertion(null, { type: 'presence', comparison: 'isFalse', expectedValue: false }),
      );
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe(false);
    });
  });

  // ── evaluateAssertion — VISIBILITY ──
  describe('evaluateAssertion — visibility', () => {
    it('passes when element is visible', () => {
      setupDom('<div style="display:block">Visible</div>');
      const el = document.querySelector('div');
      const result = evaluateAssertion(
        elementAssertion(el, { type: 'visibility', comparison: 'isTrue', expectedValue: true }),
      );
      expect(result.passed).toBe(true);
    });

    it('fails when element is display:none', () => {
      setupDom('<div style="display:none">Hidden</div>');
      const el = document.querySelector('div');
      const result = evaluateAssertion(
        elementAssertion(el, { type: 'visibility', comparison: 'isTrue', expectedValue: true }),
      );
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe(false);
    });

    it('fails when element is not found', () => {
      const result = evaluateAssertion(
        elementAssertion(null, { type: 'visibility', comparison: 'isTrue', expectedValue: true }),
      );
      expect(result.passed).toBe(false);
    });

    it('passes when element is not visible (isFalse)', () => {
      setupDom('<div style="display:none">Hidden</div>');
      const el = document.querySelector('div');
      const result = evaluateAssertion(
        elementAssertion(el, { type: 'visibility', comparison: 'isFalse', expectedValue: false }),
      );
      expect(result.passed).toBe(true);
    });
  });

  // ── evaluateAssertion — TEXT_MATCH ──
  describe('evaluateAssertion — textMatch', () => {
    it('equals — exact text match', () => {
      setupDom('<button>Submit Order</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'Submit Order',
        }),
      );
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe('Submit Order');
    });

    it('contains — partial text match', () => {
      setupDom('<div>Order #12345 confirmed</div>');
      const el = document.querySelector('div');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'contains',
          expectedValue: '12345',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('matches — regex text match', () => {
      setupDom('<span>Error: CODE-404</span>');
      const el = document.querySelector('span');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'matches',
          expectedValue: 'CODE-\\d+',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('startsWith — prefix text match', () => {
      setupDom('<p>Order confirmed at 3pm</p>');
      const el = document.querySelector('p');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'startsWith',
          expectedValue: 'Order',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('fails on text mismatch', () => {
      setupDom('<button>Submit</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'Cancel',
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe('Submit');
    });

    it('fails when element is null', () => {
      const result = evaluateAssertion(
        elementAssertion(null, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'test',
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Element not found');
    });
  });

  // ── evaluateAssertion — ATTRIBUTE_MATCH ──
  describe('evaluateAssertion — attributeMatch', () => {
    it('checks attribute equals', () => {
      setupDom('<input type="email" required />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'attributeMatch',
          comparison: 'equals',
          expectedValue: 'email',
          property: 'type',
        }),
      );
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe('email');
    });

    it('checks attribute contains', () => {
      setupDom('<div class="btn btn-primary active">Button</div>');
      const el = document.querySelector('div');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'attributeMatch',
          comparison: 'contains',
          expectedValue: 'btn-primary',
          property: 'class',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('fails on attribute mismatch', () => {
      setupDom('<input type="text" />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'attributeMatch',
          comparison: 'equals',
          expectedValue: 'email',
          property: 'type',
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe('text');
    });

    it('defaults to value attribute when property is null', () => {
      setupDom('<input value="hello" />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'attributeMatch',
          comparison: 'equals',
          expectedValue: 'hello',
          property: null,
        }),
      );
      // null property → defaults to 'value' attribute
      expect(result.actualValue).toBe('hello');
      expect(result.passed).toBe(true);
    });
  });

  // ── evaluateAssertion — EQUALITY ──
  describe('evaluateAssertion — equality', () => {
    it('checks input value equality', () => {
      setupDom('<input value="test@example.com" />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'equality',
          comparison: 'equals',
          expectedValue: 'test@example.com',
          property: 'value',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('checks checkbox checked equality (isTrue)', () => {
      setupDom('<input type="checkbox" checked />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'equality',
          comparison: 'isTrue',
          expectedValue: true,
          property: 'checked',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('checks enabled state (isTrue)', () => {
      setupDom('<button>Click</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'equality',
          comparison: 'isTrue',
          expectedValue: true,
          property: 'enabled',
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('fails on value mismatch', () => {
      setupDom('<input value="wrong" />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'equality',
          comparison: 'equals',
          expectedValue: 'right',
          property: 'value',
        }),
      );
      expect(result.passed).toBe(false);
    });
  });

  // ── evaluateAssertion — COUNT ──
  describe('evaluateAssertion — count', () => {
    it('passes when count equals 1 (single element)', () => {
      setupDom('<button>Click</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'count',
          comparison: 'equals',
          expectedValue: 1,
        }),
      );
      expect(result.passed).toBe(true);
    });

    it('fails when count does not match', () => {
      setupDom('<button>Click</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'count',
          comparison: 'equals',
          expectedValue: 2,
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe(1);
    });
  });

  // ── evaluateAssertion — URL_MATCH ──
  describe('evaluateAssertion — urlMatch', () => {
    it('passes when URL equals expected', () => {
      const result = evaluateAssertion(
        elementAssertion(null, {
          type: 'urlMatch',
          comparison: 'equals',
          expectedValue: 'https://example.com/dashboard',
          target: { kind: 'url', url: 'https://example.com/dashboard' },
        }),
        'https://example.com/dashboard',
      );
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe('https://example.com/dashboard');
    });

    it('passes when URL contains expected path', () => {
      const result = evaluateAssertion(
        elementAssertion(null, {
          type: 'urlMatch',
          comparison: 'contains',
          expectedValue: '/dashboard',
          target: { kind: 'url', url: 'https://example.com/dashboard' },
        }),
        'https://example.com/dashboard',
      );
      expect(result.passed).toBe(true);
    });

    it('passes when URL matches regex', () => {
      const result = evaluateAssertion(
        elementAssertion(null, {
          type: 'urlMatch',
          comparison: 'matches',
          expectedValue: 'https://.*\\.example\\.com/.*',
          target: { kind: 'url', url: 'https://app.example.com/users' },
        }),
        'https://app.example.com/users',
      );
      expect(result.passed).toBe(true);
    });

    it('fails on URL mismatch', () => {
      const result = evaluateAssertion(
        elementAssertion(null, {
          type: 'urlMatch',
          comparison: 'equals',
          expectedValue: 'https://example.com/login',
          target: { kind: 'url', url: 'https://example.com/dashboard' },
        }),
        'https://example.com/dashboard',
      );
      expect(result.passed).toBe(false);
    });
  });

  // ── evaluateAssertion — CUSTOM ──
  describe('evaluateAssertion — custom', () => {
    it('evaluates custom property check', () => {
      setupDom('<input value="custom-value" />');
      const el = document.querySelector('input');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'custom',
          comparison: 'equals',
          expectedValue: 'custom-value',
          property: 'value',
        }),
      );
      expect(result.passed).toBe(true);
    });
  });

  // ── evaluateAssertion — None target ──
  describe('evaluateAssertion — none target', () => {
    it('returns failure for element assertion on none target', () => {
      const result = evaluateAssertion(
        elementAssertion(null, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'test',
          target: { kind: 'none' },
        }),
      );
      expect(result.passed).toBe(false);
      expect(result.message).toContain('not applicable to none');
    });
  });

  // ── evaluateAssertions (batch) ──
  describe('evaluateAssertions (batch)', () => {
    it('evaluates multiple assertions in order', () => {
      setupDom('<button data-testid="btn" aria-label="Submit">Submit</button>');
      const el = document.querySelector('button');

      const assertions: AssertionInput[] = [
        elementAssertion(el, { type: 'presence', comparison: 'isTrue', expectedValue: true }),
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'Submit',
        }),
        elementAssertion(el, {
          type: 'attributeMatch',
          comparison: 'equals',
          expectedValue: 'Submit',
          property: 'aria-label',
        }),
      ];

      const results = evaluateAssertions(assertions);
      expect(results).toHaveLength(3);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(true);
      expect(results[2].passed).toBe(true);
    });

    it('returns mixed results when some assertions fail', () => {
      setupDom('<button>Submit</button>');
      const el = document.querySelector('button');

      const assertions: AssertionInput[] = [
        elementAssertion(el, { type: 'presence', comparison: 'isTrue', expectedValue: true }),
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'Cancel',
        }),
      ];

      const results = evaluateAssertions(assertions);
      expect(results).toHaveLength(2);
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });

    it('handles empty assertions array', () => {
      const results = evaluateAssertions([]);
      expect(results).toHaveLength(0);
    });
  });

  // ── Result message format ──
  describe('result messages', () => {
    it('includes actual and expected values in message on failure', () => {
      setupDom('<button>Submit</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'Cancel',
        }),
      );
      expect(result.message).toContain('Submit');
      expect(result.message).toContain('Cancel');
    });

    it('includes confirmation in message on pass', () => {
      setupDom('<button>Submit</button>');
      const el = document.querySelector('button');
      const result = evaluateAssertion(
        elementAssertion(el, {
          type: 'textMatch',
          comparison: 'equals',
          expectedValue: 'Submit',
        }),
      );
      expect(result.message).toContain('matched');
    });
  });
});
