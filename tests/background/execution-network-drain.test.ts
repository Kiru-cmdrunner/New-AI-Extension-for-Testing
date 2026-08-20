/**
 * Execution network drain (Option D) — unit tests.
 * Spec: .drytis/specs/executor-network-drain.md
 *
 * Exercises the REAL webRequest listener callbacks (registered via
 * registerWebRequestListeners on the mocked chrome.webRequest) so the drain
 * hooks are validated at their actual integration point — including the
 * critical property that capture happens BEFORE the recorder gate (these
 * tests run with recording STOPPED, exactly like RUN_TEST).
 *
 * Also covers the executor wiring (ir-executor-impl): beginTab/drain/endTab
 * call order relative to EXECUTE_STEP / EVALUATE_ASSERTIONS.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Fake-time setup ──────────────────────────────────────────────────
// vitest fake timers must also own Date.now/performance.now for the drain's
// performance.now() deadline math to advance with advanceTimersByTimeAsync.
let fakeNow = 0;
const perfNow = vi.fn(() => fakeNow);

// ── Mock chrome APIs (mirrors tests/background/network-observation.test.ts) ──

const listeners = {
  onBeforeRequest: [] as Array<(d: unknown) => void | Promise<void>>,
  onCompleted: [] as Array<(d: unknown) => void | Promise<void>>,
  onErrorOccurred: [] as Array<(d: unknown) => void>,
  onBeforeRedirect: [] as Array<(d: unknown) => void>,
};

const mockChrome = () => {
  (globalThis as Record<string, unknown>).chrome = {
    webRequest: {
      onBeforeRequest: {
        addListener: (cb: (d: unknown) => void | Promise<void>) => listeners.onBeforeRequest.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          listeners.onBeforeRequest = listeners.onBeforeRequest.filter((c) => c !== cb);
        },
      },
      onCompleted: {
        addListener: (cb: (d: unknown) => void | Promise<void>) => listeners.onCompleted.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          listeners.onCompleted = listeners.onCompleted.filter((c) => c !== cb);
        },
      },
      onErrorOccurred: {
        addListener: (cb: (d: unknown) => void) => listeners.onErrorOccurred.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          listeners.onErrorOccurred = listeners.onErrorOccurred.filter((c) => c !== cb);
        },
      },
      onBeforeRedirect: {
        addListener: (cb: (d: unknown) => void) => listeners.onBeforeRedirect.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          listeners.onBeforeRedirect = listeners.onBeforeRedirect.filter((c) => c !== cb);
        },
      },
    },
    tabs: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({ id: 42 }),
      get: vi.fn().mockResolvedValue({ id: 42, status: 'complete', url: 'https://example.test' }),
      update: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue([]),
    },
    scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
};

// Recompute the module under test fresh per test (module state resets).
type NetworkObservationModule = typeof import('../../src/background/network-observation');
let NO: NetworkObservationModule;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  fakeNow = 0;
  perfNow.mockImplementation(() => fakeNow);
  vi.spyOn(performance, 'now').mockImplementation(perfNow);
  listeners.onBeforeRequest = [];
  listeners.onCompleted = [];
  listeners.onErrorOccurred = [];
  listeners.onBeforeRedirect = [];
  mockChrome();
  NO = await import('../../src/background/network-observation');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).chrome;
});

// Advance fake time; setTimeout callbacks AND fakeNow move together.
const tick = async (ms: number) => {
  fakeNow += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

// ── Helpers ──────────────────────────────────────────────────────────

const fire = (which: 'onBeforeRequest' | 'onCompleted' | 'onErrorOccurred', d: unknown) => {
  for (const cb of listeners[which]) void cb(d);
};

const startReq = (overrides: Partial<{ requestId: string; url: string; tabId: number; frameId: number; type: string; method: string }> = {}) =>
  fire('onBeforeRequest', {
    requestId: 'r1',
    url: 'https://app.example.com/api/cart/add',
    method: 'POST',
    tabId: 7,
    frameId: 0,
    type: 'xmlhttprequest',
    ...overrides,
  });

const finishReq = (requestId = 'r1', tabId = 7) =>
  fire('onCompleted', { requestId, url: 'https://app.example.com/api/cart/add', statusCode: 200, tabId, frameId: 0, type: 'xmlhttprequest' });

const errReq = (requestId = 'r1', tabId = 7) =>
  fire('onErrorOccurred', { requestId, url: 'https://app.example.com/api/cart/add', error: 'net::ERR_ABORTED', tabId, frameId: 0, type: 'xmlhttprequest' });

// ── Session lifecycle & classification ───────────────────────────────

describe('ExecutionNetworkDrain (Option D)', () => {
  it('counts a request start→finish: drain completes only after finish', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq();
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(1);

    let resolved = false;
    const p = drain.drainForTab(7, 3000);
    void p.then(() => { resolved = true; });

    await tick(300);
    expect(resolved).toBe(false); // still in flight

    finishReq();
    await tick(250);
    expect(resolved).toBe(true); // drained after 2 stable zero samples
    const r = await p;
    expect(r.timedOut).toBe(false);
    drain.dispose();
  });

  it('concurrent requests: drain completes only after ALL finish', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'a' });
    startReq({ requestId: 'b' });
    startReq({ requestId: 'c' });

    const p = drain.drainForTab(7, 3000);
    finishReq('a');
    await tick(300);
    finishReq('b');
    await tick(300);
    // 'c' still in flight → not resolved
    let resolved = false;
    void p.then(() => { resolved = true; });
    expect(resolved).toBe(false);
    finishReq('c');
    await tick(250);
    expect(resolved).toBe(true);
    drain.dispose();
  });

  it('noise URLs never count (static asset + telemetry beacon), even in flight', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'img', url: 'https://cdn.example.com/logo.png', type: 'image' });
    startReq({ requestId: 'tlm', url: 'https://app.example.com/1/batch/events', type: 'xmlhttprequest' });
    startReq({ requestId: 'js', url: 'https://cdn.example.com/app.js?v=3', type: 'script' });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(0);

    const p = drain.drainForTab(7, 3000);
    await tick(300); // zero-request drain: 2 stable samples ≈ 200ms
    const r = await p;
    expect(r.drained).toBe(true);
    expect(r.timedOut).toBe(false);
    drain.dispose();
  });

  it('non-causal kinds excluded: websocket, sub_frame script, main_frame', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'ws', type: 'websocket', url: 'wss://push.example.com/socket' });
    startReq({ requestId: 'sub', type: 'script', frameId: 3, url: 'https://ads.example.com/frame.js' });
    startReq({ requestId: 'doc', type: 'main_frame', url: 'https://app.example.com/cart' });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(0);
    const p = drain.drainForTab(7, 3000);
    await tick(300);
    const r = await p;
    expect(r.drained).toBe(true);
    drain.dispose();
  });

  it('other-tab and unregistered-tab requests are invisible', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'other', tabId: 99 });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(0);
    expect(NO.getExecutionDrainInFlightForTab(99)).toBe(0);

    // unregistered tab 8 requests also invisible even though session active
    startReq({ requestId: 'unreg', tabId: 8 });
    const p = drain.drainForTab(7, 3000);
    await tick(300);
    const r = await p;
    expect(r.drained).toBe(true);
    drain.dispose();
  });

  it('zero-request drain resolves within two samples (~200ms), no artificial wait', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    const p = drain.drainForTab(7, 30_000);
    let resolved = false;
    void p.then(() => { resolved = true; });
    await tick(90);
    expect(resolved).toBe(false); // first sample in flight
    await tick(150);
    expect(resolved).toBe(true);
    const r = await p;
    expect(r.drained).toBe(true);
    expect(r.waitedMs).toBeGreaterThanOrEqual(100);
    expect(r.waitedMs).toBeLessThan(400);
    drain.dispose();
  });

  it('never-completing request: times out at timeoutMs, does not throw, reports timedOut', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'stuck' });
    const p = drain.drainForTab(7, 1000);
    let resolved = false;
    void p.then(() => { resolved = true; });
    await tick(500);
    expect(resolved).toBe(false);
    await tick(700);
    expect(resolved).toBe(true);
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(r.drained).toBe(false);
    drain.dispose();
  });

  it('long-lived request followed by completion drains late (long-poll scenario, bounded)', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'poll', url: 'https://app.example.com/api/poll' });
    const p = drain.drainForTab(7, 5000);
    let resolved = false;
    void p.then(() => { resolved = true; });
    await tick(2000);
    expect(resolved).toBe(false);
    finishReq('poll');
    await tick(250);
    expect(resolved).toBe(true);
    const r = await p;
    expect(r.drained).toBe(true);
    expect(r.timedOut).toBe(false);
    drain.dispose();
  });

  it('late-start race: request starting mid-drain (after first zero sample) is caught', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    const p = drain.drainForTab(7, 3000);
    let resolved = false;
    void p.then(() => { resolved = true; });
    // First zero sample happens at ~100ms; new request starts at 50ms — the
    // second sample (200ms) must see it and reset stability.
    await tick(50);
    startReq({ requestId: 'late' });
    await tick(200);
    expect(resolved).toBe(false);
    finishReq('late');
    await tick(250);
    expect(resolved).toBe(true);
    drain.dispose();
  });

  it('timeoutMs 0 (waitStrategy none) → no wait at all', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'x' });
    const r = await drain.drainForTab(7, 0);
    expect(r.drained).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.waitedMs).toBe(0);
    drain.dispose();
  });

  it('errored request also clears (onErrorOccurred) — cannot block the drain', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'boom' });
    const p = drain.drainForTab(7, 3000);
    errReq('boom');
    await tick(250);
    const r = await p;
    expect(r.drained).toBe(true);
    drain.dispose();
  });

  it('dispose() stops capture; endTab(tab) forgets that tab only', async () => {
    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    drain.beginTab(8);
    startReq({ requestId: 'a', tabId: 7 });
    startReq({ requestId: 'b', tabId: 8 });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(1);
    expect(NO.getExecutionDrainInFlightForTab(8)).toBe(1);

    drain.endTab(8);
    // tab 8's stale request is forgotten wholesale
    expect(NO.getExecutionDrainInFlightForTab(8)).toBe(0);
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(1);

    // new requests from tab 8 are ignored after endTab
    startReq({ requestId: 'b2', tabId: 8 });
    expect(NO.getExecutionDrainInFlightForTab(8)).toBe(0);

    // finish for an endTab'd request is a no-op (no throw)
    finishReq('b', 8);

    drain.dispose();
    startReq({ requestId: 'after', tabId: 7 });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(0);
  });

  it('capture works with recording STOPPED (drain hooks run before the recorder gate)', async () => {
    // Recording stopped → shouldProcessRequest() === false → the recorder
    // path returns early. The drain must still observe requests — this is
    // the RUN_TEST condition.
    await NO.startNetworkObservation(7);
    NO.stopNetworkObservation(7);

    const drain = NO.createExecutionDrain();
    drain.beginTab(7);
    startReq({ requestId: 'gated' });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(1);
    const p = drain.drainForTab(7, 1500);
    await tick(2000); // run past the 1500ms bound
    const r = await p;
    expect(r.drained).toBe(false); // still in flight at timeout
    expect(r.timedOut).toBe(true);
    drain.dispose();
  });

  it('drain session replacement: a second createExecutionDrain replaces the first', async () => {
    const d1 = NO.createExecutionDrain();
    d1.beginTab(7);
    startReq({ requestId: 'first' });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(1);

    const d2 = NO.createExecutionDrain();
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(0); // d1 disposed by replacement
    d2.beginTab(7);
    startReq({ requestId: 'second' });
    expect(NO.getExecutionDrainInFlightForTab(7)).toBe(1);
    d2.dispose();
  });
});

// ── Executor wiring ──────────────────────────────────────────────────

describe('IRExecutorImpl × networkDrain wiring', () => {
  const makePlan = (steps: unknown[]) => ({
    environment: { baseUrl: 'https://example.test', browser: 'chrome', viewport: null, startUrl: 'https://example.test' },
    steps,
  } as unknown as import('../../src/domain/execution-ir/types').ExecutionIRPlan);

  const makeClickStep = (id: string): import('../../src/domain/execution-ir/types').IRStep => ({
    id,
    order: 0,
    action: 'click',
    description: 'Click',
    target: { kind: 'element', elementId: 'e1', elementName: 'Add to cart', resolvedLocators: [{ type: 'css', value: '#add', priority: 1, confidence: 0.9 }] },
    input: null,
    assertions: [{ id: 'a1', locator: 'obs-0-0', type: 'presence', comparison: 'isTrue', severity: 'soft', expectedValue: null }],
    executionParameters: { waitStrategy: 'visible', timeoutMs: 3000, retryCount: 0, retryDelayMs: 1000 },
    sourceEventId: 'evt-1',
    plainEnglish: 'Click add to cart',
  } as unknown as import('../../src/domain/execution-ir/types').IRStep);

  type Calls = string[];

  function makeBinding(drain: unknown, calls: Calls, overrides: Record<string, unknown> = {}) {
    const responses: Record<string, unknown> = {
      RESOLVE_LOCATOR: { found: true, identity: {} },
      EXECUTE_STEP: { stepId: 'step-0001', action: 'click', status: 'passed', durationMs: 5 },
      EVALUATE_ASSERTIONS: { results: [{ type: 'presence', passed: true, severity: 'soft', expectedValue: null, actualValue: true, message: 'ok' }] },
      ...overrides,
    };
    const binding: import('../../src/execution/ir-executor-impl').IRExecutorImplOptions = {
      createTab: async () => { calls.push('createTab'); return 42; },
      injectScript: async () => { calls.push('injectScript'); },
      getTabUrl: async () => { calls.push('getTabUrl'); return 'https://example.test/cart'; },
      updateTabUrl: async () => { calls.push('updateTabUrl'); },
      closeTab: async () => { calls.push('closeTab'); },
      sendTabMessage: (async <T,>(_t: number, m: { type: string }): Promise<T> => {
        calls.push(m.type);
        return (responses[m.type] ?? {}) as T;
      }) as import('../../src/execution/ir-executor-impl').IRExecutorImplOptions['sendTabMessage'],
    };
    if (drain) (binding as { networkDrain?: unknown }).networkDrain = drain;
    return binding;
  }

  it('drains after a passed action, BEFORE EVALUATE_ASSERTIONS; begin/endTab around the run', async () => {
    const calls: Calls = [];
    const drainCalls: string[] = [];
    const drain = {
      beginTab: (t: number) => drainCalls.push(`beginTab(${t})`),
      endTab: (t: number) => drainCalls.push(`endTab(${t})`),
      drainForTab: async (t: number, timeoutMs: number) => { drainCalls.push(`drain(${t},${timeoutMs})`); return { drained: true, timedOut: false, waitedMs: 1 }; },
      dispose: () => drainCalls.push('dispose'),
    };
    const { IRExecutorImpl } = await import('../../src/execution/ir-executor-impl');
    const exec = new IRExecutorImpl(makeBinding(drain, calls));
    const res = await exec.execute(makePlan([makeClickStep('step-0001')]));

    expect(res.status).toBe('passed');
    expect(drainCalls.some((d) => d === 'drain(42,3000)')).toBe(true);
    // ORDER: beginTab before first step message; endTab after closeTab
    expect(drainCalls[0]).toBe('beginTab(42)');
    expect(drainCalls[drainCalls.length - 1]).toBe('endTab(42)');
    // the drain call happened between EXECUTE_STEP and EVALUATE_ASSERTIONS
    const iExec = calls.indexOf('EXECUTE_STEP');
    const iEval = calls.indexOf('EVALUATE_ASSERTIONS');
    const iDrain = drainCalls.indexOf('drain(42,3000)');
    expect(iExec).toBeGreaterThanOrEqual(0);
    expect(iEval).toBeGreaterThan(iExec);
    expect(iDrain).toBeGreaterThan(0);
  });

  it('NO drain on failed action (assertions are skipped there anyway); no drain dep → unchanged behavior', async () => {
    const calls: Calls = [];
    const drainCalls: string[] = [];
    const drain = {
      beginTab: () => drainCalls.push('beginTab'),
      endTab: () => drainCalls.push('endTab'),
      drainForTab: async () => { drainCalls.push('drain'); return { drained: true, timedOut: false, waitedMs: 0 }; },
      dispose: () => drainCalls.push('dispose'),
    };
    const binding = makeBinding(drain, calls, {
      EXECUTE_STEP: { stepId: 'step-0001', action: 'click', status: 'failed', durationMs: 3, error: { message: 'click failed', type: 'ActionError' } },
    });

    const { IRExecutorImpl } = await import('../../src/execution/ir-executor-impl');
    const exec = new IRExecutorImpl(binding);
    const res = await exec.execute(makePlan([makeClickStep('step-0001')]));
    expect(res.status).toBe('failed');
    expect(drainCalls.includes('drain')).toBe(false); // never drained a failed action
    expect(calls.includes('EVALUATE_ASSERTIONS')).toBe(false);

    // and with NO drain dep at all — pure legacy path, no crash
    const calls2: Calls = [];
    const b2 = makeBinding(undefined, calls2);
    const exec2 = new IRExecutorImpl(b2);
    const res2 = await exec2.execute(makePlan([makeClickStep('step-0001')]));
    expect(res2.status).toBe('passed');
  });

  it('navigate step drains after page load, before its assertions', async () => {
    const calls: Calls = [];
    const drainCalls: string[] = [];
    const drain = {
      beginTab: () => drainCalls.push('beginTab'),
      endTab: () => drainCalls.push('endTab'),
      drainForTab: async (t: number, timeoutMs: number) => { drainCalls.push(`drain(${t},${timeoutMs})`); return { drained: true, timedOut: false, waitedMs: 1 }; },
      dispose: () => drainCalls.push('dispose'),
    };
    const navStep = {
      id: 'step-nav', order: 0, action: 'navigate', description: 'Go to cart',
      target: { kind: 'url', url: 'https://example.test/cart' },
      input: null,
      assertions: [{ id: 'an1', locator: '#cart-count', type: 'textMatch', comparison: 'contains', severity: 'soft', expectedValue: '0 items' }],
      executionParameters: { waitStrategy: 'visible', timeoutMs: 2000, retryCount: 0, retryDelayMs: 1000 },
      sourceEventId: 'nav-1', plainEnglish: 'Go to cart',
    } as unknown as import('../../src/domain/execution-ir/types').IRStep;
    const { IRExecutorImpl } = await import('../../src/execution/ir-executor-impl');
    const exec = new IRExecutorImpl(makeBinding(drain, calls));
    const res = await exec.execute(makePlan([navStep]));
    expect(res.status).toBe('passed');
    expect(drainCalls.some((d) => d.startsWith('drain(42,2000)'))).toBe(true);
  });
});
