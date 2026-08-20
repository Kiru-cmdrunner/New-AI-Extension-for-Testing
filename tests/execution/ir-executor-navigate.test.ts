/**
 * IRExecutorImpl navigate steps (A-Slice fix 2)
 * (.drytis/specs/a-slice-executor-navigation.md, Issue 2)
 *
 * Reproduces the real-Chrome audit failure (head-audit-1703e43): IR `navigate`
 * steps are a silent no-op — the content script returns success without
 * navigating, and `chrome.tabs.update` is never called anywhere in the
 * executor. The run tab therefore stays on the start URL; every element on
 * the destination page (e.g. #add1 on /cart) reports ElementNotFound even
 * though the element exists.
 *
 * Under test: a navigate step MUST
 *   1. call chrome.tabs.update(tabId, { url }) with the step's target URL,
 *   2. wait for the new page to load, and
 *   3. re-inject the executor content script (the old document is destroyed).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IRExecutorImpl } from '../../src/execution/ir-executor-impl';
import type { ExecutionIRPlan, IRStep } from '../../src/domain/execution-ir/types';

function makeNavigateStep(url: string): IRStep {
  return {
    id: 'step-nav',
    order: 0,
    action: 'navigate',
    description: 'Navigate to cart',
    target: { kind: 'url', url },
    input: null,
    assertions: [],
    executionParameters: { waitStrategy: 'visible' },
    sourceEventId: 'nav-1',
    plainEnglish: 'Navigate to cart',
  } as unknown as IRStep;
}

function makeElementStep(): IRStep {
  return {
    id: 'step-click',
    order: 1,
    action: 'click',
    description: 'Click Add to cart',
    target: {
      kind: 'element',
      elementId: 'el-1',
      elementName: 'Add to cart',
      resolvedLocators: [{ type: 'css', value: '#add1', priority: 1, confidence: 0.9 }],
    },
    input: null,
    assertions: [],
    executionParameters: { waitStrategy: 'visible' },
    sourceEventId: 'evt-2',
    plainEnglish: 'Click the Add to cart button',
  } as unknown as IRStep;
}

function makePlan(steps: IRStep[]): ExecutionIRPlan {
  return {
    id: 'plan-1',
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    title: 'Search then cart',
    steps,
    environment: {
      baseUrl: 'http://127.0.0.1:8121/',
      startUrl: 'http://127.0.0.1:8121/',
      browser: 'chromium',
      viewport: { width: 1280, height: 720 },
    },
    generatedAt: new Date().toISOString(),
  } as unknown as ExecutionIRPlan;
}

/** Page state machine: which URL the fake tab is on and what elements exist. */
function makeBindings() {
  const state = { currentUrl: 'http://127.0.0.1:8121/', injections: [] as string[] };

  const tabsUpdate = vi.fn(async (_tabId: number, props: { url: string }) => {
    state.currentUrl = props.url;
    (chrome.tabs as unknown as { __tabStatus?: string }).__tabStatus = 'loading';
    setTimeout(() => {
      (chrome.tabs as unknown as { __tabStatus?: string }).__tabStatus = 'complete';
    }, 30);
  });

  const createTab = vi.fn(async (url: string) => {
    state.currentUrl = url;
    return 42;
  });

  const injectScript = vi.fn(async (tabId: number) => {
    state.injections.push(`inject:${tabId}@${state.currentUrl}`);
  });

  const sendTabMessage = vi.fn(async (_tabId: number, message: { type: string; locators?: { value: string }[] }) => {
    // RESOLVE_LOCATOR answers according to the CURRENT page
    if (message.type === 'RESOLVE_LOCATOR') {
      const onCart = state.currentUrl.includes('/cart');
      const wanted = message.locators?.[0]?.value ?? '';
      const found = onCart && wanted === '#add1';
      return { found, identity: null };
    }
    if (message.type === 'EXECUTE_STEP') return { stepId: 'x', status: 'passed', durationMs: 1 };
    if (message.type === 'EVALUATE_ASSERTIONS') return { results: [] };
    return {};
  });

  const getTabUrl = vi.fn(async () => state.currentUrl);
  const closeTab = vi.fn(async () => {});

  return { state, tabsUpdate, createTab, injectScript, sendTabMessage, getTabUrl, closeTab };
}

/** Like makeBindings, but EVALUATE_ASSERTIONS evaluates against the fake page. */
function makeEvaluatingBindings() {
  const b = makeBindings();
  b.sendTabMessage = vi.fn(async (_tabId: number, message: { type: string; locators?: { value: string }[] }) => {
    if (message.type === 'RESOLVE_LOCATOR') {
      const onCart = b.state.currentUrl.includes('/cart');
      const wanted = message.locators?.[0]?.value ?? '';
      return { found: onCart && wanted === '#add1', identity: null };
    }
    if (message.type === 'EXECUTE_STEP') return { stepId: 'x', status: 'passed', durationMs: 1 };
    if (message.type === 'EVALUATE_ASSERTIONS') {
      // Destination-page evaluation: soft textMatch on #cart-count → 2 items
      const results = (message as { assertions?: { type: string; expectedValue?: string }[] }).assertions?.map(
        () => ({ type: 'textMatch', passed: false, actualValue: '2 items', expectedValue: '0 items', severity: 'soft', message: 'Text "2 items" did not match "0 items"' }),
      );
      return { results: results ?? [] };
    }
    return {};
  });
  return b;
}

describe('IRExecutorImpl navigate steps (A-Slice 2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('navigate step calls tabs.update, waits for load, and re-injects the executor', async () => {
    const b = makeEvaluatingBindings();
    (global.chrome as unknown as Record<string, unknown>) = {
      tabs: {
        create: b.createTab,
        update: b.tabsUpdate,
        // Status is driven by __tabStatus: tabsUpdate sets 'loading', then
        // flips to 'complete' after 30ms — waitForPageLoad must observe it.
        get: vi.fn(async () => ({
          id: 42,
          get status() {
            return (chrome.tabs as unknown as { __tabStatus?: string }).__tabStatus ?? 'complete';
          },
          url: b.state.currentUrl,
        })),
        remove: b.closeTab,
      },
      scripting: { executeScript: async () => {} },
    };

    const executor = new IRExecutorImpl({
      createTab: b.createTab,
      injectScript: b.injectScript,
      sendTabMessage: b.sendTabMessage,
      getTabUrl: b.getTabUrl,
      closeTab: b.closeTab,
    });

    const navStep = makeNavigateStep('http://127.0.0.1:8121/cart');
    navStep.assertions = [
      {
        type: 'textMatch',
        comparison: 'contains',
        expectedValue: '0 items',
        property: null,
        severity: 'soft',
        target: {
          kind: 'element',
          elementId: 'el-cart',
          resolvedLocators: [{ type: 'css', value: '#cart-count', priority: 1, confidence: 0.9 }],
        },
      } as never,
    ];
    const result = await executor.execute(makePlan([navStep]));

    expect(b.tabsUpdate).toHaveBeenCalledTimes(1);
    expect(b.tabsUpdate).toHaveBeenCalledWith(42, { url: 'http://127.0.0.1:8121/cart' });
    // Executor content script re-injected AFTER navigation (old document destroyed)
    expect(b.injectScript).toHaveBeenCalledTimes(2);
    expect(b.injectScript).toHaveBeenLastCalledWith(42);
    // Step-scoped assertion evaluated on the DESTINATION page (soft → recorded)
    const evaluated = result.stepResults[0].assertionResults;
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0].type).toBe('textMatch');
    expect(evaluated[0].actualValue).toBe('2 items');
    expect(result.stepResults[0].status).toBe('passed'); // soft failure does not fail the step
    expect(result.status).toBe('passed');
  }, 15_000);

  it('element step after navigate resolves on the destination page (audit repro)', async () => {
    const b = makeBindings();
    (global.chrome as unknown as Record<string, unknown>) = {
      tabs: {
        create: b.createTab,
        update: b.tabsUpdate,
        get: vi.fn(async () => ({ id: 42, status: 'complete' })),
        remove: b.closeTab,
      },
      scripting: { executeScript: async () => {} },
    };

    const executor = new IRExecutorImpl({
      createTab: b.createTab,
      injectScript: b.injectScript,
      sendTabMessage: b.sendTabMessage,
      getTabUrl: b.getTabUrl,
      closeTab: b.closeTab,
    });

    // Pre-fix behavior: run stayed on start URL; RESOLVE_LOCATOR for #add1
    // could never succeed because the run tab is on / (search page).
    const result = await executor.execute(
      makePlan([makeNavigateStep('http://127.0.0.1:8121/cart'), makeElementStep()]),
    );

    expect(b.tabsUpdate).toHaveBeenCalledWith(42, { url: 'http://127.0.0.1:8121/cart' });
    expect(b.state.currentUrl).toBe('http://127.0.0.1:8121/cart');
    // The element resolves: no ElementNotFound error on the click step
    const clickStep = result.stepResults.find((s) => s.stepId === 'step-click');
    expect(clickStep?.status).toBe('passed');
    expect(clickStep?.error?.type).not.toBe('ElementNotFound');
    expect(result.status).toBe('passed');
  });

  it('navigate-free plans keep the single injection (Scenario B parity)', async () => {
    const b = makeBindings();
    (global.chrome as unknown as Record<string, unknown>) = {
      tabs: {
        create: b.createTab,
        update: b.tabsUpdate,
        get: vi.fn(async () => ({ id: 42, status: 'complete' })),
        remove: b.closeTab,
      },
      scripting: { executeScript: async () => {} },
    };

    const executor = new IRExecutorImpl({
      createTab: b.createTab,
      injectScript: b.injectScript,
      sendTabMessage: b.sendTabMessage,
      getTabUrl: b.getTabUrl,
      closeTab: b.closeTab,
    });

    // Single-page plan: resolve needs currentUrl to include /cart (start URL)
    // createTab(startUrl) sets currentUrl — plan starts on /cart so the fake
    // RESOLVE_LOCATOR sees the page it expects.
    const plan = makePlan([makeElementStep()]);
    plan.environment.startUrl = 'http://127.0.0.1:8121/cart';
    const result = await executor.execute(plan);

    expect(b.injectScript).toHaveBeenCalledTimes(1);
    expect(b.tabsUpdate).not.toHaveBeenCalled();
    expect(result.status).toBe('passed');
  });
});

describe('RESOLVE_LOCATOR wait wiring (Defect 1)', () => {
  it('element steps pass executionParameters.timeoutMs through to RESOLVE_LOCATOR', async () => {
    const b = makeBindings();
    const step = {
      ...makeElementStep(),
      executionParameters: { timeoutMs: 7500, waitStrategy: 'visible' },
    } as unknown as IRStep;
    const exec = new IRExecutorImpl({
      sendTabMessage: b.sendTabMessage as never,
      injectScript: b.injectScript as never,
      getTabUrl: b.getTabUrl as never,
      updateTabUrl: b.tabsUpdate as never,
      createTab: b.createTab as never,
      closeTab: b.closeTab as never,
    });
    await exec.execute(makePlan([step]));
    const resolveCalls = b.sendTabMessage.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === 'RESOLVE_LOCATOR',
    );
    expect(resolveCalls.length).toBeGreaterThan(0);
    for (const c of resolveCalls) {
      expect((c[1] as { timeoutMs?: number }).timeoutMs).toBe(7500);
    }
  });

  it("waitStrategy 'none' sends timeoutMs 0 (no wait) — resolveElementWithWait parity", async () => {
    const b = makeBindings();
    const step = {
      ...makeElementStep(),
      executionParameters: { timeoutMs: 7500, waitStrategy: 'none' },
    } as unknown as IRStep;
    const exec = new IRExecutorImpl({
      sendTabMessage: b.sendTabMessage as never,
      injectScript: b.injectScript as never,
      getTabUrl: b.getTabUrl as never,
      updateTabUrl: b.tabsUpdate as never,
      createTab: b.createTab as never,
      closeTab: b.closeTab as never,
    });
    await exec.execute(makePlan([step]));
    const resolveCalls = b.sendTabMessage.mock.calls.filter(
      (c) => (c[1] as { type: string }).type === 'RESOLVE_LOCATOR',
    );
    expect(resolveCalls.length).toBeGreaterThan(0);
    for (const c of resolveCalls) {
      expect((c[1] as { timeoutMs?: number }).timeoutMs).toBe(0);
    }
  });
});
