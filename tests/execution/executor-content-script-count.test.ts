/**
 * Executor Content Script — COUNT evaluation tests (Phase 4c-iii-a).
 *
 * The content script is a SELF-CONTAINED module: it registers a
 * chrome.runtime.onMessage listener at import time and cannot be imported
 * like a normal module without a chrome stub. This suite stubs
 * chrome.runtime and drives the file through the message-listener path —
 * the exact path the service worker exercises at replay time — and pins
 * the COUNT semantics of the inlined evaluator:
 *
 *   - true multi-match count via querySelectorAll against the best-priority
 *     locator (parity with the Playwright export's locator().count())
 *   - empty match set → count 0 (NOT "Element not found")
 *   - best-priority-empty does NOT fall through to a lower-priority
 *     locator (no count inflation)
 *   - unsupported locator set → historical element?1:0 semantics
 *   - twin parity with src/execution/assertion-evaluator.ts COUNT
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// ── chrome stub (installed in beforeAll — ES imports are hoisted, so the
//    module under test must be imported dynamically AFTER the stub) ──
type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | undefined;

let capturedListener: Listener | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = globalThis as any;

async function loadContentScript(): Promise<void> {
  // Import exactly once — a cached module import does not re-run the
  // registration side effect, so a second call must not clobber the
  // captured listener.
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

function evaluateAssertion(
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

function countAssertion(
  locators: Array<{ type: string; value: string; priority: number; confidence: number | null }> | undefined,
  expectedValue: number,
  comparison = 'equals',
): Record<string, unknown> {
  return {
    type: 'count',
    comparison,
    expectedValue,
    property: null,
    severity: 'soft',
    target: locators ? { kind: 'element', elementId: '', resolvedLocators: locators } : { kind: 'element', elementId: '' },
  };
}

const CSS_PRIMARY = [{ type: 'css', value: '.cart-item', priority: 1, confidence: 0.9 }];

describe('executor-content-script — COUNT (multi-match)', () => {
  beforeAll(async () => {
    await loadContentScript();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('counts ALL matches of the best-priority css locator', () => {
    document.body.innerHTML = `
      <ul>
        <li class="cart-item">A</li>
        <li class="cart-item">B</li>
        <li class="cart-item">C</li>
      </ul>`;
    const result = evaluateAssertion(countAssertion(CSS_PRIMARY, 3));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(3);
  });

  it('returns count 0 when the best-priority locator matches nothing (not "Element not found")', () => {
    document.body.innerHTML = `<div class="empty">nothing here</div>`;
    const result = evaluateAssertion(countAssertion(CSS_PRIMARY, 0));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(0);
    expect(result.message).not.toContain('not found');
  });

  it('does NOT fall through to a lower-priority locator when the best-priority locator is empty', () => {
    document.body.innerHTML = `
      <li class="other-item">A</li>
      <li class="other-item">B</li>`;
    const locators = [
      { type: 'css', value: '.cart-item', priority: 1, confidence: 0.9 },
      { type: 'css', value: '.other-item', priority: 2, confidence: 0.7 },
    ];
    const result = evaluateAssertion(countAssertion(locators, 0));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(0);
  });

  it('supports greaterThan against the multi-match count', () => {
    document.body.innerHTML = `
      <li class="cart-item">A</li>
      <li class="cart-item">B</li>`;
    const result = evaluateAssertion(countAssertion(CSS_PRIMARY, 1, 'greaterThan'));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(2);
  });

  it('counts testId matches across data-testid/data-cy/data-qa', () => {
    document.body.innerHTML = `
      <div data-testid="row">1</div>
      <div data-cy="row">2</div>`;
    const locators = [{ type: 'testId', value: 'row', priority: 1, confidence: 0.95 }];
    const result = evaluateAssertion(countAssertion(locators, 2));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(2);
  });

  it('counts role matches via [role="…"]', () => {
    // NOTE: <tr role="row"> outside a table context is DROPPED by the HTML
    // parser, so this fixture uses <div role="row"> to survive jsdom.
    document.body.innerHTML = `
      <div role="row">1</div>
      <div role="row">2</div>
      <div role="row">3</div>`;
    const locators = [{ type: 'role', value: 'row', priority: 1, confidence: 0.8 }];
    const result = evaluateAssertion(countAssertion(locators, 3));
    expect(result.passed).toBe(true);
  });

  it('counts text matches across every element with equal trimmed text', () => {
    // NOTE: a text locator's text-walk matches ANY element whose trimmed
    // textContent equals the value — including wrapper elements (here the
    // <div> around <p>SKU</p> also trims to "SKU", so the count is 3).
    // This mirrors the inlined resolveByText semantics exactly. Derived
    // assertions never emit text locators, so this is a fidelity pin only.
    document.body.innerHTML = `
      <span>SKU</span>
      <div><p>SKU</p></div>
      <span>other</span>`;
    const locators = [{ type: 'text', value: 'SKU', priority: 1, confidence: 0.6 }];
    const result = evaluateAssertion(countAssertion(locators, 3));
    expect(result.passed).toBe(true);
  });

  it('counts xpath matches (snapshot)', () => {
    document.body.innerHTML = `
      <ul><li>1</li><li>2</li></ul>`;
    const locators = [{ type: 'xpath', value: '//ul/li', priority: 1, confidence: 0.8 }];
    const result = evaluateAssertion(countAssertion(locators, 2));
    expect(result.passed).toBe(true);
  });

  it('falls back to element?1:0 when no locator type supports all-match resolution', () => {
    // No locators at all → the element cannot be resolved → historical 0.
    document.body.innerHTML = `<button>Click</button>`;
    const result = evaluateAssertion(countAssertion(undefined, 0));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(0);
  });

  it('invalid css selector degrades without throwing and falls to next locator', () => {
    document.body.innerHTML = `<li class="cart-item">A</li><li class="cart-item">B</li>`;
    const locators = [
      { type: 'css', value: '###invalid', priority: 1, confidence: 0.9 },
      { type: 'css', value: '.cart-item', priority: 2, confidence: 0.7 },
    ];
    const result = evaluateAssertion(countAssertion(locators, 2));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(2);
  });
});

// ── Twin parity: same DOM + same locators must yield the same count as
//    the main evaluator with allMatches populated by the same selector. ──
describe('executor-content-script — twin parity with assertion-evaluator', () => {
  beforeAll(async () => {
    await loadContentScript();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('css multi-match count matches the main evaluator driven with allMatches', async () => {
    document.body.innerHTML = `
      <ul>
        <li class="cart-item">A</li>
        <li class="cart-item">B</li>
        <li class="cart-item">C</li>
      </ul>`;

    const contentResult = evaluateAssertion(countAssertion(CSS_PRIMARY, 3));

    const { evaluateAssertion: evaluateMain } = await import('../../src/execution/assertion-evaluator');
    const els = Array.from(document.querySelectorAll('.cart-item'));
    const mainResult = evaluateMain({
      type: 'count',
      comparison: 'equals',
      expectedValue: 3,
      property: null,
      target: { kind: 'element', element: els[0] ?? null, allMatches: els },
    });

    expect(contentResult.passed).toBe(true);
    expect(mainResult.passed).toBe(true);
    expect(contentResult.actualValue).toBe(mainResult.actualValue);
  });

  it('empty match set: count 0 on both twins', async () => {
    document.body.innerHTML = `<div class="none">x</div>`;

    const contentResult = evaluateAssertion(countAssertion(CSS_PRIMARY, 0));

    const { evaluateAssertion: evaluateMain } = await import('../../src/execution/assertion-evaluator');
    const mainResult = evaluateMain({
      type: 'count',
      comparison: 'equals',
      expectedValue: 0,
      property: null,
      target: { kind: 'element', element: null, allMatches: [] },
    });

    expect(contentResult.passed).toBe(true);
    expect(mainResult.passed).toBe(true);
    expect(contentResult.actualValue).toBe(0);
    expect(mainResult.actualValue).toBe(0);
  });
});

describe('executor-content-script — COUNT dedup (testId union)', () => {
  beforeAll(async () => {
    await loadContentScript();
  });

  it('does not double-count an element carrying data-testid AND data-cy with the same value', () => {
    document.body.innerHTML = `
      <div data-testid="row" data-cy="row">1</div>
      <div data-testid="row">2</div>`;
    const locators = [{ type: 'testId', value: 'row', priority: 1, confidence: 0.95 }];
    const result = evaluateAssertion(countAssertion(locators, 2));
    expect(result.passed).toBe(true);
    expect(result.actualValue).toBe(2);
  });
});
