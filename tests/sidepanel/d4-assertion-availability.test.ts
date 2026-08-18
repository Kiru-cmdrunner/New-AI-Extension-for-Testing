/**
 * D4 — Assertion Availability Honesty (side panel side)
 *
 * Regression tests for the approved D4 fix:
 *  1. renderIRSteps(): a step with zero assertions must render an explicit
 *     "Assertions: none — not derived for this recording" row (class
 *     step-card__unavailable) instead of silently omitting the row.
 *  2. renderExecutionResult(): when every step result has empty
 *     assertionResults, the summary must state "replay-only run (0 checks)".
 *
 * Follows the jsdom pattern of tests/sidepanel/evidence-renderer.test.ts.
 * Spec: .drytis/specs/d4-assertion-availability.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NONE_TEXT = 'Assertions: none — not derived for this recording';
const REPLAY_TEXT = 'none evaluated — replay-only run (0 checks)';

let domInitialized = false;

function setupDom(): void {
  if (domInitialized) {
    // The sidepanel module captures its element references at import time.
    // Re-creating the JSDOM would disconnect them — reuse the first DOM and
    // just clear the containers the render functions write into.
    document.getElementById('ir-steps-list')!.innerHTML = '';
    document.getElementById('execution-body')!.innerHTML = '';
    return;
  }
  domInitialized = true;
  // Load the REAL side panel markup so the module's top-level element
  // lookups (dozens of getElementById calls) resolve. Views stay inert —
  // only the two render functions under test are invoked.
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../src/sidepanel/index.html'),
    'utf8',
  );
  const dom = new JSDOM(html, { url: 'chrome-extension://test-id/src/sidepanel/index.html' });
  const w = dom.window as unknown as typeof globalThis;
  (globalThis as Record<string, unknown>).document = w.document;
  (globalThis as Record<string, unknown>).window = w;
  // chrome.* is not used by the two render functions under test, but the
  // module wires listeners at import time — stub defensively.
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: async () => {},
      onMessage: { addListener: () => {} },
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    tabs: { query: async () => [], create: async () => ({}) },
  };
}

async function loadSidepanel(): Promise<typeof import('../../src/sidepanel/sidepanel')> {
  return await import('../../src/sidepanel/sidepanel');
}

// ── Fixtures ───────────────────────────────────────────────

const STEP_FIXTURE = {
  id: 'step-0001',
  order: 0,
  action: 'click',
  description: 'Click the Add to cart',
  target: {
    kind: 'element',
    elementId: 'el-1',
    elementName: 'Add to cart',
    pageOrComponent: 'main',
    resolvedLocators: [{ type: 'css', value: '#add-to-cart', priority: 1, confidence: 1 }],
  },
  input: null,
  assertions: [] as unknown[],
  executionParameters: { timeoutMs: 5000, retryCount: 0, waitStrategy: 'auto' },
  sourceEventId: 'evt-1',
  plainEnglish: 'Click the Add to cart',
};

function makePlan(assertions: unknown[]): unknown {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title: 'Purchase Flow',
    tags: [],
    environment: {
      baseUrl: 'http://127.0.0.1:8098/',
      browser: 'chrome',
      viewport: { width: 1, height: 1 },
    },
    steps: [{ ...STEP_FIXTURE, assertions }],
  };
}

const ASSERTED_STEP_ASSERTIONS = [
  {
    id: 'asrt-1',
    type: 'VISIBILITY',
    comparison: 'IS_TRUE',
    severity: 'HARD',
    target: STEP_FIXTURE.target,
    expectedValue: null,
    property: null,
  },
];

// ── IR steps ───────────────────────────────────────────────

describe('D4: renderIRSteps — explicit unavailability marker', () => {
  beforeEach(() => setupDom());

  it('renders the none-marker row for a step with zero assertions', async () => {
    const mod = await loadSidepanel();
    mod.renderIRSteps(makePlan([]) as never);

    const list = document.getElementById('ir-steps-list')!;
    expect(list.children.length).toBe(1);
    const card = list.children[0] as HTMLElement;

    const marker = Array.from(card.querySelectorAll('div'))
      .find((d) => d.textContent === NONE_TEXT) as HTMLElement | undefined;
    expect(marker).toBeDefined();
    expect(marker!.className).toContain('step-card__unavailable');
  });

  it('keeps the normal Assertions row for an asserted step (no regression)', async () => {
    const mod = await loadSidepanel();
    mod.renderIRSteps(makePlan(ASSERTED_STEP_ASSERTIONS) as never);

    const list = document.getElementById('ir-steps-list')!;
    expect(list.children.length).toBe(1);
    const card = list.children[0] as HTMLElement;
    const text = card.textContent ?? '';

    expect(text).toContain('Assertions:');
    expect(text).not.toContain(NONE_TEXT);
    expect(text).toContain('VISIBILITY');
  });
});

// ── Execution results ──────────────────────────────────────

describe('D4: renderExecutionResult — replay-only row', () => {
  beforeEach(() => setupDom());

  const baseSummary = {
    status: 'passed',
    stepCount: 2,
    passedSteps: 2,
    failedSteps: 0,
    errorSteps: 0,
    skippedSteps: 0,
    durationMs: 1234,
    startedAt: '2026-08-17T22:00:00Z',
    completedAt: '2026-08-17T22:00:01Z',
    executionRunId: 'run-1234567890abcdef',
  };

  it('shows the replay-only row when every step has empty assertionResults', async () => {
    const mod = await loadSidepanel();
    const data = {
      ...baseSummary,
      stepResults: [
        { stepId: 'step-0001', status: 'passed', durationMs: 100, assertionResults: [] },
        { stepId: 'step-0002', status: 'passed', durationMs: 100, assertionResults: [] },
      ],
    };

    mod.renderExecutionResult(data as never);

    const body = document.getElementById('execution-body')!;
    const text = body.textContent ?? '';
    expect(text).toContain(REPLAY_TEXT);

    const row = Array.from(body.querySelectorAll('div'))
      .find((d) => d.textContent === `Assertions:${REPLAY_TEXT}`) as HTMLElement | undefined;
    expect(row).toBeDefined();
    expect(row!.className).toContain('repo-status__unavailable');
    // Label + value both present in the row
    expect(row!.textContent).toContain('Assertions:');
    expect(row!.textContent).toContain(REPLAY_TEXT);
  });

  it('does not show the replay-only row when any step has assertion results', async () => {
    const mod = await loadSidepanel();
    const data = {
      ...baseSummary,
      stepResults: [
        { stepId: 'step-0001', status: 'passed', durationMs: 100, assertionResults: [] },
        {
          stepId: 'step-0002',
          status: 'passed',
          durationMs: 100,
          assertionResults: [{ type: 'VISIBILITY', passed: true, message: 'visible' }],
        },
      ],
    };

    mod.renderExecutionResult(data as never);

    const body = document.getElementById('execution-body')!;
    const text = body.textContent ?? '';
    expect(text).not.toContain(REPLAY_TEXT);
    expect(text).toContain('VISIBILITY');
  });
});
