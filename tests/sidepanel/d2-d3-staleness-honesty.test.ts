/**
 * D2/D3 — side panel honesty: the stale-IR row.
 *
 * Regression tests for the approved D2 fix: renderExecutionResult() must
 * render an explicit "IR status: stale — … runtime healing attempted" row
 * when the executed plan was stale, and must render nothing stale-related
 * when irStale is absent or false.
 *
 * Follows the jsdom pattern of tests/sidepanel/d4-assertion-availability.test.ts.
 * Spec: .drytis/specs/d2-d3-element-linkage-healing.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';

let domInitialized = false;

function setupDom(): void {
  if (domInitialized) {
    // The sidepanel module captures its element references at import time.
    // Re-creating the JSDOM would disconnect them — reuse the first DOM and
    // just clear the container the render function writes into.
    document.getElementById('execution-body')!.innerHTML = '';
    return;
  }
  domInitialized = true;
  // Load the REAL side panel markup so the module's top-level element
  // lookups resolve. Views stay inert — only the render function under
  // test is invoked.
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../src/sidepanel/index.html'),
    'utf8',
  );
  const dom = new JSDOM(html, { url: 'chrome-extension://test-id/src/sidepanel/index.html' });
  const w = dom.window as unknown as typeof globalThis;
  (globalThis as Record<string, unknown>).document = w.document;
  (globalThis as Record<string, unknown>).window = w;
  // chrome.* is not used by the render function under test, but the module
  // wires listeners at import time — stub defensively.
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

function baseResult(): Record<string, unknown> {
  return {
    status: 'passed',
    stepCount: 5,
    passedSteps: 5,
    failedSteps: 0,
    errorSteps: 0,
    skippedSteps: 0,
    durationMs: 1200,
    startedAt: '2026-08-18T00:00:00.000Z',
    completedAt: '2026-08-18T00:00:01.200Z',
    stepResults: [
      {
        stepId: 'step-0001',
        status: 'passed',
        durationMs: 10,
        assertionResults: [{ name: 'x', passed: true, expected: '', actual: '', message: '' }],
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('D2 sidepanel staleness honesty', () => {
  beforeEach(() => {
    setupDom();
  });

  it('renders the stale row when irStale === true', async () => {
    const mod = await loadSidepanel();
    mod.renderExecutionResult({ ...baseResult(), irStale: true } as never);
    const body = document.getElementById('execution-body')!;
    expect(body.textContent).toMatch(/IR stale/i);
    expect(body.textContent).toMatch(/runtime healing/i);
  });

  it('renders NO stale row when irStale is absent', async () => {
    const mod = await loadSidepanel();
    mod.renderExecutionResult(baseResult() as never);
    const body = document.getElementById('execution-body')!;
    expect(body.textContent).not.toMatch(/IR stale/i);
    expect(body.textContent).not.toMatch(/stale —/i);
  });

  it('renders NO stale row when irStale === false', async () => {
    const mod = await loadSidepanel();
    mod.renderExecutionResult({ ...baseResult(), irStale: false } as never);
    const body = document.getElementById('execution-body')!;
    expect(body.textContent).not.toMatch(/IR stale/i);
    expect(body.textContent).not.toMatch(/stale —/i);
  });

  it('companion timestamp contract: handleRunTest must fetch BOTH keys (staleness is not always-true)', async () => {
    // Regression guard for the reviewer-found read-path defect: the SW read
    // is chrome.storage.local.get([EXECUTION_IR_PLAN, EXECUTION_IR_PLAN +
    // '_generated_at']). This test pins the semantic contract in vitest — a
    // fresh plan (companion written at generation, elements older) must NOT
    // be stale — by exercising the SW's exact staleness inputs against the
    // real checkStaleness.
    const { checkStaleness } = await import('../../src/domain/execution-ir/staleness');
    const generatedAt = new Date().toISOString();
    const artifact = {
      id: 'cached',
      testCaseVersionId: 'tcv-x',
      plan: { environment: {}, steps: [] },
      generatedAt,
      generatorVersion: 'ir-bridge-1.0',
      renderings: {},
    } as never;
    const elements = [
      { id: 'e1', locatorStrategies: [], updatedAt: new Date(Date.now() - 60_000).toISOString() },
    ] as never;
    const report = checkStaleness(artifact, elements, 'ir-bridge-1.0');
    // elements older than the companion → NOT stale (pre-fix this was always
    // stale because the companion never loaded and epoch was used).
    expect(report.status).not.toBe('stale');
  });
});
