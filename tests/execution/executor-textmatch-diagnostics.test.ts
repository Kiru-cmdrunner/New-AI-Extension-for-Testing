/**
 * textMatch diagnostics (A-Slice fix 3)
 * (.drytis/specs/a-slice-executor-navigation.md, Issue 3)
 *
 * Pins BOTH sides of the audit finding (head-audit-1703e43):
 *   1. exists-but-differs → actualValue = the element's real text, message
 *      names both sides of the mismatch. (The code already does this, but the
 *      audit saw a "not found" because the run never navigated — with fix 2
 *      this path becomes the one users actually hit.)
 *   2. genuinely-missing element → actualValue null + "Element not found"
 *      message preserved exactly (do not regress).
 *
 * BOTH layers: canonical assertion-evaluator.ts AND the inlined evaluator in
 * the executor content script driven through its message listener (the exact
 * shipped path), mirroring executor-content-script-count.test.ts.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { evaluateAssertion as canonicalEvaluate } from '../../src/execution/assertion-evaluator';
import type { AssertionInput } from '../../src/execution/assertion-evaluator';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (r: unknown) => void,
) => boolean | undefined;

let capturedListener: Listener | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = globalThis as any;

async function loadContentScript(): Promise<void> {
  if (capturedListener) return;
  globalAny.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          capturedListener = fn;
        },
      },
    },
  };
  await import('../../src/execution/executor-content-script');
}

function evaluateInContentScript(
  assertion: Record<string, unknown>,
  url?: string,
): { type: string; passed: boolean; actualValue?: unknown; expectedValue?: unknown; message: string } {
  if (!capturedListener) throw new Error('content script listener was not registered');
  let response: { results: Array<Record<string, unknown>> } | undefined;
  capturedListener(
    { type: 'EVALUATE_ASSERTIONS', assertions: [assertion], url },
    {},
    (r) => {
      response = r as { results: Array<Record<string, unknown>> };
    },
  );
  if (!response || response.results.length !== 1) {
    throw new Error('EVALUATE_ASSERTIONS did not return exactly one result');
  }
  return response.results[0] as never;
}

function textMatchAssertion(
  locator: string,
  expected: string,
  comparison = 'contains',
): Record<string, unknown> {
  return {
    type: 'textMatch',
    comparison,
    expectedValue: expected,
    property: null,
    severity: 'soft',
    target: {
      kind: 'element',
      elementId: 'el-x',
      resolvedLocators: [{ type: 'css', value: locator, priority: 1, confidence: 0.9 }],
    },
  };
}

describe('textMatch failure diagnostics (A-Slice 3)', () => {
  beforeAll(async () => {
    await loadContentScript();
  });

  beforeEach(() => {
    document.body.innerHTML = `<p>Cart: <span id="cart-count">2 items</span></p>`;
  });

  describe('canonical evaluator (assertion-evaluator.ts)', () => {
    // The canonical evaluator receives a PRE-RESOLVED element (the content
    // script resolves locators itself); mirror that here.
    const evalCanonical = (locator: string, expected: string) =>
      canonicalEvaluate({
        ...textMatchAssertion(locator, expected),
        target: {
          kind: 'element',
          element: document.querySelector(locator),
        },
      } as unknown as AssertionInput);

    it('element exists, text differs → actualValue is the real text with a real mismatch message', () => {
      const r = evalCanonical('#cart-count', '0 items');
      expect(r.passed).toBe(false);
      expect(r.actualValue).toBe('2 items');
      expect(r.message).toContain('2 items');
      expect(r.message).toContain('0 items');
      expect(r.message).not.toContain('not found');
    });

    it('element genuinely missing → null actualValue + not-found message (preserved)', () => {
      const r = evalCanonical('#does-not-exist', '0 items');
      expect(r.passed).toBe(false);
      expect(r.actualValue).toBeNull();
      expect(r.message).toContain('Element not found');
    });

    it('element exists and matches → passes with the actual text recorded', () => {
      const r = evalCanonical('#cart-count', '2 items');
      expect(r.passed).toBe(true);
      expect(r.actualValue).toBe('2 items');
    });
  });

  describe('executor content script (shipped inlined evaluator)', () => {
    it('element exists, text differs → actualValue is the real text with a real mismatch message', () => {
      const r = evaluateInContentScript(textMatchAssertion('#cart-count', '0 items'));
      expect(r.passed).toBe(false);
      expect(r.actualValue).toBe('2 items');
      expect(r.message).toContain('2 items');
      expect(r.message).toContain('0 items');
      expect(r.message).not.toContain('not found');
    });

    it('element genuinely missing → null actualValue + not-found message (preserved)', () => {
      const r = evaluateInContentScript(textMatchAssertion('#does-not-exist', '0 items'));
      expect(r.passed).toBe(false);
      expect(r.actualValue).toBeNull();
      expect(r.message).toContain('Element not found');
    });

    it('element exists and matches → passes with the actual text recorded', () => {
      const r = evaluateInContentScript(textMatchAssertion('#cart-count', '2 items'));
      expect(r.passed).toBe(true);
      expect(r.actualValue).toBe('2 items');
    });
  });

  // Cross-layer parity: same inputs, same diagnostics
  it('both layers agree on the mismatch message for exists-but-differs', () => {
    const canonical = canonicalEvaluate({
      ...textMatchAssertion('#cart-count', '0 items'),
      target: {
        kind: 'element',
        element: document.querySelector('#cart-count'),
      },
    } as unknown as AssertionInput);
    const shipped = evaluateInContentScript(textMatchAssertion('#cart-count', '0 items'));
    expect(shipped.passed).toBe(canonical.passed);
    expect(shipped.actualValue).toBe(canonical.actualValue);
    expect(shipped.message).toBe(canonical.message);
  });
});
