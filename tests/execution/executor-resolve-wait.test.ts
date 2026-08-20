/**
 * Defect 1 regression — RESOLVE_LOCATOR / EXECUTE_STEP honor timeoutMs for
 * late-rendered elements (AdaniOne-clone audit 2026-08-20).
 *
 * Pins:
 *  - timeoutMs > 0 → polls until the element appears (bounded by the 10s cap)
 *  - timeoutMs absent / 0 → legacy single-shot behavior (backwards compatible)
 *  - genuinely-missing element with timeoutMs → resolves null at the cap,
 *    not instantly (bounded failure latency)
 *
 * The content script is SELF-CONTAINED and registers a chrome.runtime
 * listener at import time. We stub chrome + document + a controllable
 * performance BEFORE the dynamic import (same harness class as
 * executor-content-script-count.test.ts) and drive time with REAL timers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void;
let listener: Listener | null = null;

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;

// jsdom has NO layout engine: getBoundingClientRect() is always 0×0 and
// offsetParent is always null, so isElementVisible() can never pass. Emulate
// minimal geometry for elements appended to #host so the visibility gate in
// resolveWithWait's requireVisible path is exercisable.
{
  const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, 'offsetParent', { get() { return dom.window.document.body; }, configurable: true });
  const origGBCR = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const r = origGBCR.call(this);
    return r.width === 0 && r.height === 0 && this.isConnected
      ? { ...r, width: 10, height: 10, x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10 } as DOMRect
      : r;
  };
}

// Controllable monotonic clock — the module reads `performance` lazily at
// call time from globalThis, so replacing the global works even though the
// import happens later.
let nowMs = 0;
g.performance = { now: () => nowMs };
g.MutationObserver = dom.window.MutationObserver;

g.chrome = {
  runtime: {
    onMessage: {
      addListener: (fn: Listener) => {
        listener = fn;
      },
    },
  },
};

await import('../../src/execution/executor-content-script');

const send = (message: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    void listener!(message, {}, (r) => resolve(r as Record<string, unknown>));
  });

/** Drive wall-clock + fake perf in 25ms slices while a promise settles. */
const settleWithin = async (p: Promise<unknown>, ms: number): Promise<boolean> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 25));
    nowMs = Date.now() - t0;
    // microtask drain
    await p.then(
      () => undefined,
      () => undefined,
    ).then(() => undefined);
  }
  // final check without throwing
  let settledFlag = false;
  await Promise.race([p.then(() => { settledFlag = true; }), new Promise((r) => setTimeout(r, 5))]);
  return settledFlag;
};

const CSS_LOCATOR = [{ type: 'css', value: '#late-target', priority: 1 }];

describe('executor content script — resolve with wait (Defect 1)', () => {
  beforeEach(() => {
    nowMs = 0;
  });
  afterEach(() => {
    const host = dom.window.document.getElementById('host');
    if (host) host.innerHTML = '';
  });

  it('RESOLVE_LOCATOR without timeoutMs stays single-shot (legacy contract)', async () => {
    const t0 = Date.now();
    const res = await send({ type: 'RESOLVE_LOCATOR', locators: CSS_LOCATOR });
    expect(Date.now() - t0).toBeLessThan(80); // no polling happened
    expect(res.found).toBe(false);
    expect(res.identity).toBeNull();
  });

  it('RESOLVE_LOCATOR with timeoutMs polls until the element appears (late render)', async () => {
    const host = dom.window.document.getElementById('host')!;
    setTimeout(() => {
      const el = dom.window.document.createElement('div');
      el.id = 'late-target';
      el.textContent = 'late';
      host.appendChild(el);
    }, 300);

    const p = send({ type: 'RESOLVE_LOCATOR', locators: CSS_LOCATOR, timeoutMs: 5000 });
    const settled = await settleWithin(p, 800);
    expect(settled).toBe(true);
    const res = (await p) as Record<string, unknown>;
    expect(res.found).toBe(true);
    expect((res.identity as Record<string, unknown>).id).toBe('late-target');
  }, 4000);

  it('RESOLVE_LOCATOR with timeoutMs caps at 10s for a genuinely missing element', async () => {
    const p = send({ type: 'RESOLVE_LOCATOR', locators: [{ type: 'css', value: '#never', priority: 1 }], timeoutMs: 60_000 });
    // still polling well past 10s of OUR clock? No — cap applies at 10s.
    let settled = false;
    p.then(() => { settled = true; });
    await settleWithin(Promise.resolve(), 12_000);
    // If the cap works, it must have settled by ~10s and NOT at 60s.
    expect(settled).toBe(true);
    const res = await p;
    expect(res.found).toBe(false);
  }, 20_000);

  it('EXECUTE_STEP honors executionParameters.timeoutMs for its inline resolve', async () => {
    const host = dom.window.document.getElementById('host')!;
    setTimeout(() => {
      const el = dom.window.document.createElement('button');
      el.id = 'late-target';
      el.textContent = 'Go';
      host.appendChild(el);
    }, 200);

    const step = {
      id: 'step-0001',
      action: 'click',
      input: null,
      target: { kind: 'element', resolvedLocators: CSS_LOCATOR },
      executionParameters: { timeoutMs: 3000 },
    };
    const p = send({ type: 'EXECUTE_STEP', step });
    const settled = await settleWithin(p, 600);
    expect(settled).toBe(true);
    const res = (await p) as Record<string, unknown>;
    expect(res.stepId).toBe('step-0001');
    expect(res.status).toBe('passed');
  }, 4000);

  it('EXECUTE_STEP without timeoutMs fails fast when the element is absent (unchanged behavior)', async () => {
    const t0 = Date.now();
    const step = {
      id: 'step-0002',
      action: 'click',
      input: null,
      target: { kind: 'element', resolvedLocators: CSS_LOCATOR },
    };
    const res = (await send({ type: 'EXECUTE_STEP', step })) as Record<string, unknown>;
    expect(Date.now() - t0).toBeLessThan(80);
    expect(res.status).toBe('failed');
  });

  it("waitStrategy 'none' NEVER waits — single-shot even with timeoutMs set (resolveElementWithWait parity)", async () => {
    const t0 = Date.now();
    const step = {
      id: 'step-0003',
      action: 'click',
      input: null,
      target: { kind: 'element', resolvedLocators: CSS_LOCATOR },
      executionParameters: { timeoutMs: 8000, waitStrategy: 'none' },
    };
    const res = (await send({ type: 'EXECUTE_STEP', step })) as Record<string, unknown>;
    expect(Date.now() - t0).toBeLessThan(80); // returned immediately, no polling
    expect(res.status).toBe('failed'); // element never existed
  });
});
