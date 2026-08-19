/**
 * Track 3 / Phase 4c-i — Playwright rendering of step-scoped assertions
 *
 * Option A: derived assertions render as expect.soft(...) and make the
 * NO_ASSERTIONS_BANNER disappear. POM mode must NOT substitute the step's
 * targetOverride for an assertion that carries its own element target with
 * a DIFFERENT elementId (observed elements are not POM members).
 *
 * Spec: .drytis/specs/resulting-application-state-plan.md (Phase 4c)
 */

import { describe, it, expect } from 'vitest';
import { renderTestFile, renderPomTestFile } from '../../../src/adapters/playwright/test-function-renderer';
import { renderPageObjectFiles } from '../../../src/adapters/playwright/page-object-renderer';
import { build } from '../../../src/generation/ir-bridge';
import type { GenerationEnrichment } from '../../../src/generation/generation-types';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { IRStep } from '../../../src/domain/execution-ir/types';
import { ValidationType, ValidationComparison, ValidationSeverity } from '../../../src/domain/enums';
import type { ExecutionIRPlan } from '../../../src/domain/execution-ir/types';

const BANNER = '// NOTE: No assertions generated — assertion derivation is not available. This test replays actions only.';

// ── Fixtures ───────────────────────────────────────────────

function stepWithSoftAssertion(): IRStep {
  return {
    id: 'step-0001',
    order: 0,
    action: 'click' as never,
    description: 'Click the Add to cart',
    target: {
      kind: 'element',
      elementId: 'elem-0001',
      elementName: 'Add to cart',
      pageOrComponent: 'main',
      resolvedLocators: [
        { type: 'css', value: '#add-to-cart', priority: 1, confidence: 1 },
      ],
    } as never,
    input: null,
    assertions: [
      {
        type: ValidationType.TEXT_MATCH,
        comparison: ValidationComparison.CONTAINS,
        severity: ValidationSeverity.SOFT,
        expectedValue: '4 items',
        property: null,
        target: {
          kind: 'element',
          elementId: 'obs-0-0', // observed element — synthetic id from the bridge
          elementName: 'cart count',
          pageOrComponent: 'main',
          resolvedLocators: [
            { type: 'css', value: '#cart-count', priority: 1, confidence: 0.7 },
          ],
        } as never,
      },
    ],
    executionParameters: { timeoutMs: 5000, retryCount: 0, waitStrategy: 'auto' } as never,
    sourceEventId: 'evt-1-1',
    plainEnglish: 'Click the Add to cart',
  } as unknown as IRStep;
}

function plan(steps: IRStep[]): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title: 'Purchase Flow',
    tags: ['shop'],
    environment: {
      baseUrl: 'http://127.0.0.1:8098/',
      browser: 'chrome',
      viewport: { width: 1280, height: 720 },
    },
    steps,
  } as unknown as ExecutionIRPlan;
}

// ── Flat mode ─────────────────────────────────────────────

describe('step-scoped assertions — flat rendering (Option A)', () => {
  it('renders expect.soft for a derived (soft) assertion', () => {
    const out = renderTestFile(plan([stepWithSoftAssertion()]));
    expect(out).toContain('expect.soft(');
    expect(out).not.toMatch(/await expect\(\S/);
  });

  it('banner disappears once any step carries derived assertions', () => {
    const out = renderTestFile(plan([stepWithSoftAssertion()]));
    expect(out).not.toContain(BANNER);
    expect(out).toContain("toContainText('4 items')");
  });

  it('assertion locator targets the OBSERVED element (#cart-count), not the step target', () => {
    const out = renderTestFile(plan([stepWithSoftAssertion()]));
    expect(out).toContain("#cart-count");
    expect(out).not.toContain("toHaveText('#add-to-cart')");
  });
});

// ── POM mode guard ────────────────────────────────────────

describe('step-scoped assertions — POM guard', () => {
  it('asserts the OBSERVED element via its own POM getter, never the step\u2019s trigger getter', () => {
    const out = renderPomTestFile(plan([stepWithSoftAssertion()]));
    // The assertion target is the observed element (its own synthetic id +
    // locator) — it gets its OWN POM getter, distinct from the step's
    // trigger-element getter.
    expect(out).toContain('expect.soft(');
    const softLines = out.split('\n').filter((l) => l.includes('expect.soft('));
    expect(softLines).toHaveLength(1);
    expect(softLines[0]).toContain("toContainText('4 items')");
    // Never the step trigger's getter name (addToCart).
    expect(softLines[0]).not.toMatch(/\.addToCart\b/);
    // The POM class file itself carries the observed locator.
    const files = renderPageObjectFiles(plan([stepWithSoftAssertion()]));
    const mainFile = files.find((f) => f.path.includes('main'));
    expect(mainFile).toBeDefined();
    expect(mainFile!.content).toContain('#cart-count');
  });
});

// ── End-to-end through build() ────────────────────────────

describe('build() → renderer end-to-end', () => {
  function click(eventId: string): ComponentInteraction {
    return {
      interactionId: `ix-${eventId}`,
      type: 'Click',
      trigger: {
        tag: 'button',
        cssSelector: '#add-to-cart',
        accessibleName: 'Add to cart',
        elementId: 'btn-1',
      } as never,
      triggerEvent: { eventId } as never,
      memberEvents: [],
      startTime: 0,
      endTime: 1,
      endState: 'completed',
      metadata: {},
    };
  }

  it('enrichment.stepAssertions flows through build() to expect.soft in the spec', async () => {
    const { deriveStepAssertions } = await import('../../../src/generation/assertion-derivation');
    const interactions = [
      {
        ...click('evt-9-1'),
        behavioralEvidence: {
          applicationEvidence: {
            resultingState: {
              url: 'https://shop.example.com/',
              viewId: null,
              items: [
                {
                  kind: 'counter',
                  matchedSelector: '[data-count]',
                  text: '4 items',
                  numericValue: 4,
                  entityId: null,
                  entityType: null,
                  domPath: 'DIV#cart-count',
                  attributes: {},
                  visible: true,
                },
              ],
              itemsOverflow: 0,
              scannedAt: 1,
              scanDurationMs: 1,
            },
          },
        } as never,
      },
    ];
    const enrichment: GenerationEnrichment = {
      stepAssertions: deriveStepAssertions(interactions as ComponentInteraction[]),
    };
    const ir = build({
      interactions: interactions as ComponentInteraction[],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Purchase Flow',
      enrichment,
    });
    const out = renderTestFile(ir);
    expect(out).toContain('expect.soft(');
    expect(out).toContain("toContainText('4 items')");
    expect(out).not.toContain(BANNER);
  });
});
