/**
 * Track 3 / Phase 4c-i — IR-bridge consumption of stepAssertions
 *
 * build() joins enrichment.stepAssertions by step.sourceEventId, maps
 * StepScopedAssertion → IRAssertion (soft, own-locator target), and OR-1
 * merging keeps the FRESHEST resulting state's assertions.
 *
 * Spec: .drytis/specs/resulting-application-state-plan.md (Phase 4c)
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type { GenerationEnrichment, StepScopedAssertion } from '../../src/generation/generation-types';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WireObservedItem, WirePageContentSnapshot } from '../../src/shared/page-content-wire';
import { IRAction } from '../../src/domain/execution-ir/types';

// ── Factories ──────────────────────────────────────────────

function clickInteraction(eventId: string, id = 'btn-1'): ComponentInteraction {
  return {
    interactionId: `ix-${eventId}`,
    type: 'Click',
    trigger: {
      tag: 'button',
      cssSelector: '#add-to-cart',
      accessibleName: 'Add to cart',
      elementId: id,
    } as never,
    triggerEvent: { eventId } as never,
    memberEvents: [],
    startTime: 0,
    endTime: 1,
    endState: 'completed',
    metadata: {},
  };
}

function counterAssertion(
  overrides: Partial<StepScopedAssertion> = {},
): StepScopedAssertion {
  return {
    type: 'textMatch',
    comparison: 'matches',
    severity: 'soft',
    expectedValue: '4 items',
    property: null,
    targetCss: '#cart-count',
    targetName: 'cart count',
    derivedFrom: 'counter',
    ...overrides,
  };
}

// ── sourceEventId join ────────────────────────────────────

describe('build() — stepAssertions joined by sourceEventId', () => {
  it('attaches assertions to the step whose sourceEventId matches', () => {
    const interactions = [clickInteraction('evt-1-1'), clickInteraction('evt-1-2', 'btn-2')];
    const enrichment: GenerationEnrichment = {
      stepAssertions: new Map([['evt-1-2', [counterAssertion()]]]),
    };
    const plan = build({
      interactions,
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });

    const asserted = plan.steps.filter((s) => s.assertions.length > 0);
    expect(asserted).toHaveLength(1);
    expect(asserted[0].sourceEventId).toBe('evt-1-2');
  });

  it('maps StepScopedAssertion → soft IRAssertion with its OWN locator target', () => {
    const enrichment: GenerationEnrichment = {
      stepAssertions: new Map([['evt-2-1', [counterAssertion()]]]),
    };
    const plan = build({
      interactions: [clickInteraction('evt-2-1')],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });

    const a = plan.steps[0].assertions[0];
    expect(a.severity).toBe('soft');
    expect(a.type).toBe('textMatch');
    expect(a.comparison).toBe('matches');
    expect(a.expectedValue).toBe('4 items');
    // The assertion targets the OBSERVED element, not the step's trigger.
    expect(a.target.kind).toBe('element');
    if (a.target.kind === 'element') {
      expect(a.target.resolvedLocators[0].type).toBe('css');
      expect(a.target.resolvedLocators[0].value).toBe('#cart-count');
      expect(a.target.elementName).toBe('cart count');
      // Observed elements carry a stable synthetic id (unique per step+slot,
      // required for POM registration correctness with multiple observed elements).
      expect(a.target.elementId).toBe('obs-0-0');
    }
  });

  it('multiple step-scoped assertions keep derivation order', () => {
    const enrichment: GenerationEnrichment = {
      stepAssertions: new Map([
        [
          'evt-3-1',
          [
            counterAssertion(),
            counterAssertion({
              type: 'presence',
              comparison: 'isTrue',
              expectedValue: null,
              targetCss: '[data-asin="B0VAL1"]',
              targetName: 'product:B0VAL1',
              derivedFrom: 'entity',
            }),
          ],
        ],
      ]),
    };
    const plan = build({
      interactions: [clickInteraction('evt-3-1')],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });
    expect(plan.steps[0].assertions.map((a) => a.type)).toEqual([
      'textMatch',
      'presence',
    ]);
  });

  it('INV-GEN-7: absent enrichment → zero assertions (legacy unchanged)', () => {
    const plan = build({
      interactions: [clickInteraction('evt-4-1')],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
    });
    expect(plan.steps[0].assertions).toHaveLength(0);
  });

  it('stepAssertion keys with no matching step are ignored safely', () => {
    const enrichment: GenerationEnrichment = {
      stepAssertions: new Map([['evt-nonexistent', [counterAssertion()]]]),
    };
    const plan = build({
      interactions: [clickInteraction('evt-5-1')],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });
    expect(plan.steps[0].assertions).toHaveLength(0);
  });
});

// ── OR-1 merge ────────────────────────────────────────────

describe('build() — OR-1 merge keeps the freshest resulting state', () => {
  function clickWithCounter(
    eventId: string,
    count: number,
  ): ComponentInteraction {
    const items: WireObservedItem[] = [
      {
        kind: 'counter',
        matchedSelector: '[data-count]',
        text: `${count} items`,
        numericValue: count,
        entityId: null,
        entityType: null,
        domPath: 'DIV#cart-count',
        attributes: {},
        visible: true,
      },
    ];
    const rs: WirePageContentSnapshot = {
      url: 'https://shop.example.com/',
      viewId: null,
      items,
      itemsOverflow: 0,
      scannedAt: 1,
      scanDurationMs: 1,
    };
    const base = clickInteraction(eventId);
    return {
      ...base,
      behavioralEvidence: {
        applicationEvidence: { resultingState: rs },
      } as never,
    };
  }

  it('merged duplicate clicks carry the SECOND click\u2019s assertions', async () => {
    // Same element id → OR-1 merge triggers.
    const interactions = [clickWithCounter('evt-6-1', 1), clickWithCounter('evt-6-2', 2)];
    const { deriveStepAssertions } = await import('../../src/generation/assertion-derivation');
    const enrichment: GenerationEnrichment = {
      stepAssertions: deriveStepAssertions(interactions),
    };
    const plan = build({
      interactions,
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });

    // Two clicks on the same element merge to ONE step.
    expect(plan.steps.filter((s) => s.action === IRAction.CLICK)).toHaveLength(1);
    const merged = plan.steps.find((s) => s.action === IRAction.CLICK)!;
    expect(merged.assertions).toHaveLength(1);
    // Freshest state: cart=2, not the stale cart=1.
    expect(merged.assertions[0].expectedValue).toBe('2 items');
  });
});

// ── 4c-iii-b: collection COUNT through the bridge ─────────

describe('build() — collection COUNT assertion (4c-iii-b)', () => {
  it('maps a derived collection COUNT to a soft count/equals IRAssertion on #id > *', async () => {
    const items: WireObservedItem[] = [
      {
        kind: 'collection',
        matchedSelector: 'ul[data-testid], ul.list',
        text: '',
        numericValue: 3,
        entityId: null,
        entityType: null,
        domPath: 'UL#cart-items',
        attributes: {},
        visible: true,
      },
    ];
    const rs: WirePageContentSnapshot = {
      url: 'https://shop.example.com/cart',
      viewId: null,
      items,
      itemsOverflow: 0,
      scannedAt: 1,
      scanDurationMs: 1,
    };
    const interaction: ComponentInteraction = {
      ...clickInteraction('evt-7-1'),
      behavioralEvidence: {
        applicationEvidence: { resultingState: rs },
      } as never,
    };

    const { deriveStepAssertions } = await import('../../src/generation/assertion-derivation');
    const enrichment: GenerationEnrichment = {
      stepAssertions: deriveStepAssertions([interaction]),
    };
    const plan = build({
      interactions: [interaction],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });

    expect(plan.steps[0].assertions).toHaveLength(1);
    const a = plan.steps[0].assertions[0];
    expect(a.type).toBe('count');
    expect(a.comparison).toBe('equals');
    expect(a.severity).toBe('soft');
    expect(a.expectedValue).toBe(3);
    expect(a.target.kind).toBe('element');
    if (a.target.kind === 'element') {
      expect(a.target.resolvedLocators[0].value).toBe('#cart-items > *');
    }
  });

  it('collection without #id yields NO assertions through the bridge (skip preserved)', async () => {
    const items: WireObservedItem[] = [
      {
        kind: 'collection',
        matchedSelector: 'ul[data-testid], ul.list',
        text: '',
        numericValue: 3,
        entityId: null,
        entityType: null,
        domPath: 'UL',
        attributes: {},
        visible: true,
      },
    ];
    const rs: WirePageContentSnapshot = {
      url: 'https://shop.example.com/cart',
      viewId: null,
      items,
      itemsOverflow: 0,
      scannedAt: 1,
      scanDurationMs: 1,
    };
    const interaction: ComponentInteraction = {
      ...clickInteraction('evt-7-2'),
      behavioralEvidence: {
        applicationEvidence: { resultingState: rs },
      } as never,
    };

    const { deriveStepAssertions } = await import('../../src/generation/assertion-derivation');
    const enrichment: GenerationEnrichment = {
      stepAssertions: deriveStepAssertions([interaction]),
    };
    const plan = build({
      interactions: [interaction],
      recordingContext: { startUrl: 'https://shop.example.com/', title: null },
      testCaseName: 'Cart',
      enrichment,
    });

    expect(plan.steps[0].assertions).toHaveLength(0);
  });
});
