/**
 * Phase 2 — pipeline-level integration of resultingState consumption.
 *
 * Verifies the full production path on a real UnderstandingPipeline:
 *   interaction (with behavioralEvidence.resultingState)
 *     → SignalExtractionCoordinator (D2 PageContentEvidenceExtractor)
 *     → SignalSet.pageContent
 *     → StateBuilder.processPageContent
 *     → transitions carry 'page-content entity/counter/collection' change
 *       strings; outcome votes include page-content evidence kinds;
 *       entity stamped 'content-observed'.
 *
 * Uses deterministic timestamps (no Date.now in fixtures).
 *
 * Spec: .drytis/specs/resulting-application-state.md (Phase 2),
 * plan: .drytis/specs/resulting-application-state-plan.md (Phase 2).
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { UnderstandingPipeline } from '../../../src/understanding/pipeline/understanding-pipeline';
import type { ComponentInteraction } from '../../../src/shared/component-types';

// ── Fixtures ────────────────────────────────────────────────────────────

const T = 1_700_000_000_000;

function clickWithResultingState(id: string, t: number): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click',
    trigger: { tag: 'BUTTON', accessibleName: 'Add to cart' },
    triggerEvent: {
      eventId: `evt-${id}`,
      eventType: 'click',
      timestamp: t,
      captureSeq: 1,
      captureOrigin: { tabId: 7, frameId: 0 },
      pageId: 'p1',
    },
    memberEvents: [],
    startTime: t,
    endTime: t + 120,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      applicationEvidence: {
        newSurfaces: [],
        removedSurfaces: [],
        domChanges: [],
        resultingState: {
          url: 'https://shop.example/cart',
          viewId: 'cart',
          items: [
            {
              kind: 'entity',
              matchedSelector: '[data-asin]',
              text: 'Widget A',
              numericValue: null,
              entityId: 'B0VAL1',
              entityType: 'product',
              domPath: 'ul[data-testid="cart-items"] > li',
              attributes: { 'data-asin': 'B0VAL1' },
              visible: true,
            },
            {
              kind: 'counter',
              matchedSelector: '[data-count]',
              text: '3',
              numericValue: 3,
              entityId: null,
              entityType: null,
              domPath: 'span#cart-count',
              attributes: { 'data-count': '3' },
              visible: true,
            },
            {
              kind: 'collection',
              matchedSelector: '[data-testid="cart-items"]',
              text: '3 items',
              numericValue: 3,
              entityId: null,
              entityType: null,
              domPath: 'ul[data-testid="cart-items"]',
              attributes: {},
              visible: true,
            },
            {
              kind: 'notification',
              matchedSelector: '[role="alert"]',
              text: 'Added to cart',
              numericValue: null,
              entityId: null,
              entityType: null,
              domPath: 'div[role="alert"]',
              attributes: {},
              visible: true,
            },
          ],
          itemsOverflow: 0,
          scannedAt: t + 100,
          scanDurationMs: 5,
        },
        navigation: [],
        networkActivity: [],
        performanceCondition: null,
      },
    },
  } as unknown as ComponentInteraction;
}

// ── Tests ───────────────────────────────────────── test ────────────────

describe('Phase 2 — pipeline integration of resultingState', () => {
  it('resultingState flows to transitions, entities, and outcome votes', async () => {
    const pipeline = new UnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      sessionId: 'sess-p2-pipeline',
      origin: 'https://shop.example',
      interactions: [clickWithResultingState('int-p2-pl-1', T)],
    });

    // 1. D2 emitted a page-content signal → StateBuilder recorded all kinds.
    const transition = outcome.transitions.find((tr) => tr.interactionId === 'int-p2-pl-1');
    expect(transition).toBeDefined();
    expect(transition!.changes.some((c) => c.includes('page-content entity: product:B0VAL1'))).toBe(true);
    expect(transition!.changes.some((c) => c.includes('page-content counter:'))).toBe(true);
    expect(transition!.changes.some((c) => c.includes('page-content collection:'))).toBe(true);

    // 2. Entity present in the pipeline's final application state, with the
    //    Phase 2 'content-observed' stamp.
    const state = outcome.finalState;
    expect(state).not.toBeNull();
    const product = state!.entities.get('product:B0VAL1');
    expect(product).toBeDefined();
    expect(product!.source).toBe('content-observed');

    // 3. Outcome votes include page-content kinds; confidence within caps.
    const result = outcome.outcomes.get('int-p2-pl-1');
    expect(result).toBeDefined();
    const pcVotes = (result!.supportingEvidence ?? []).filter(
      (ev) => ev.kind === 'page-content',
    );
    expect(pcVotes.length).toBeGreaterThan(0);
    // Confidence sanity: page-content evidence weights ≤ the configured cap.
    // (OutcomeEvidence has no weight field — it reaches ActionOutcome via
    // supportingEvidence; the determiner's WEIGHTS.pageContent* ≤ 0.2 cap is
    // asserted at the unit level in outcome tests. Here: outcome exists and
    // carries page-content kinds, and confidence ≤ 1.)
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });
});
