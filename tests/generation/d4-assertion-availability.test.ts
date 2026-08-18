/**
 * D4 — Assertion Availability Honesty (generation side)
 *
 * A regression test for the approved D4 fix: when a plan carries no
 * assertions at all (the ONLY state the current pipeline can produce —
 * deriveAssertions() is a stub, INV-GEN-7), the generated Playwright spec
 * must SAY so instead of implying verification via an unused expect import.
 *
 * Spec: .drytis/specs/d4-assertion-availability.md
 */

import { describe, it, expect } from 'vitest';
import { renderTestFile, renderPomTestFile, renderTestBody } from '../../src/adapters/playwright/test-function-renderer';
import { IRAction } from '../../src/domain/execution-ir/types';
import type { ExecutionIRPlan, IRStep, IRAssertion } from '../../src/domain/execution-ir/types';
import { ValidationType, ValidationComparison, ValidationSeverity } from '../../src/domain/enums';

// ── Fixtures ───────────────────────────────────────────────

const BANNER = '// NOTE: No assertions generated — assertion derivation is not available. This test replays actions only.';

function makeStep(overrides: Partial<IRStep> = {}): IRStep {
  return {
    id: 'step-0001',
    order: 0,
    action: IRAction.CLICK,
    description: 'Click the Add to cart',
    target: {
      kind: 'element',
      elementId: 'el-1',
      elementName: 'Add to cart',
      pageOrComponent: 'main',
      resolvedLocators: [
        { type: 'css', value: '#add-to-cart', priority: 1, confidence: 1.0 },
      ],
    },
    input: null,
    assertions: [],
    executionParameters: {
      timeoutMs: 5000,
      retryCount: 0,
      waitStrategy: 'auto',
    },
    sourceEventId: 'evt-1',
    plainEnglish: 'Click the Add to cart',
    ...overrides,
  } as IRStep;
}

function makeAssertedStep(): IRStep {
  const assertion: IRAssertion = {
    id: 'asrt-1',
    type: ValidationType.VISIBILITY,
    comparison: ValidationComparison.IS_TRUE,
    severity: ValidationSeverity.HARD,
    target: {
      kind: 'element',
      elementId: 'el-1',
      elementName: 'Add to cart',
      pageOrComponent: 'main',
      resolvedLocators: [
        { type: 'css', value: '#add-to-cart', priority: 1, confidence: 1.0 },
      ],
    },
    expectedValue: null,
    property: null,
  } as unknown as IRAssertion;
  return makeStep({ assertions: [assertion] });
}

function makePlan(steps: IRStep[], title = 'Purchase Flow'): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title,
    tags: ['shop'],
    environment: {
      baseUrl: 'http://127.0.0.1:8098/',
      browser: 'chrome',
      viewport: { width: 1280, height: 720 },
    },
    steps,
  } as ExecutionIRPlan;
}

// ── Flat pattern ──────────────────────────────────────────

describe('D4: flat render — assertion availability banner', () => {
  it('shows the banner when every step has zero assertions', () => {
    const plan = makePlan([makeStep(), makeStep({ id: 'step-0002', order: 1 })]);
    const result = renderTestFile(plan);

    expect(result).toContain(BANNER);
    // Exactly once (file-level banner, not per-step)
    expect(result.split(BANNER).length - 1).toBe(1);
  });

  it('does not show the banner when any step is asserted', () => {
    const plan = makePlan([makeStep(), makeAssertedStep()]);
    const result = renderTestFile(plan);

    expect(result).not.toContain(BANNER);
    // And the real assertion is rendered
    expect(result).toContain('toBeVisible()');
  });

  it('does not show the banner for an empty step list', () => {
    const plan = makePlan([]);
    const result = renderTestFile(plan);

    expect(result).not.toContain(BANNER);
  });

  it('emits no expect() call sites for an all-unasserted plan (import may remain)', () => {
    const plan = makePlan([makeStep()]);
    const result = renderTestFile(plan);

    // The import line is allowed; call sites are not.
    const body = result.replace(/import \{ test, expect \} from '@playwright\/test';/, '');
    expect(body).not.toMatch(/await expect\(/);
    expect(body).not.toMatch(/expect\.soft\(/);
    // Honest statement instead
    expect(result).toContain(BANNER);
  });

  it('renders the banner as the first body line of renderTestBody', () => {
    const steps = [makeStep()];
    const body = renderTestBody(steps, '    ');

    expect(body[0]).toBe(`    ${BANNER}`);
  });

  it('shows NO banner for an all-WAIT_FOR_ELEMENT plan (nothing renderable)', () => {
    const steps = [makeStep({ action: IRAction.WAIT_FOR_ELEMENT })];
    const body = renderTestBody(steps, '    ');

    expect(body.length).toBe(0);
    expect(body.join('\n')).not.toContain(BANNER);
  });
});

// ── POM pattern ───────────────────────────────────────────

describe('D4: POM render — assertion availability banner', () => {
  it('shows the banner exactly once when every step has zero assertions', () => {
    const plan = makePlan([makeStep(), makeStep({ id: 'step-0002', order: 1 })]);
    const result = renderPomTestFile(plan);

    expect(result).toContain(BANNER);
    expect(result.split(BANNER).length - 1).toBe(1);
  });

  it('does not show the banner when any step is asserted', () => {
    const plan = makePlan([makeStep(), makeAssertedStep()]);
    const result = renderPomTestFile(plan);

    expect(result).not.toContain(BANNER);
    expect(result).toContain('toBeVisible()');
  });
});

// ── Mixed plan guard ──────────────────────────────────────

describe('D4: mixed plans', () => {
  it('all-asserted plan renders assertions and no banner', () => {
    const plan = makePlan([makeAssertedStep(), makeAssertedStep()]);
    const result = renderTestFile(plan);

    expect(result).not.toContain(BANNER);
    expect(result.match(/toBeVisible\(\)/g)?.length).toBe(2);
  });
});
