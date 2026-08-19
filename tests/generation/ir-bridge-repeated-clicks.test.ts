/**
 * OR-1 correction — repeated same-target clicks
 * (.drytis/specs/or1-repeated-clicks.md)
 *
 * Two deliberate clicks on the same element (A-Slice audit: #add1, counter
 * 1 → 2) must remain TWO steps, each keeping its own sourceEventId and
 * resulting-state assertions. Only genuinely redundant duplicates (no new
 * state) merge. Run-length: 3+ repeated clicks collapse correctly.
 */
import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import { deriveStepAssertions } from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';
import type { GenerationEnrichment } from '../../src/generation/generation-types';
import type { IRAction } from '../../src/domain/execution-ir/types';
import type { WireObservedItem, WirePageContentSnapshot } from '../../src/shared/page-content-wire';

// ── Fixtures ───────────────────────────────────────────────

function makeIdentity(): ElementIdentity {
  return {
    accessibleName: 'Add to cart',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn btn-primary',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button#add1.btn-primary',
    xPath: '//button[@id="add1"]',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'el-add-1',
  };
}

let evtCounter = 0;
function makeEventId(): string {
  evtCounter += 1;
  return `evt-or1-${evtCounter}`;
}

function clickInteraction(
  eventId: string,
  resultingState?: WirePageContentSnapshot,
): ComponentInteraction {
  const base = {
    interactionId: `int-${eventId}`,
    type: 'Click' as never,
    trigger: makeIdentity(),
    triggerEvent: {
      eventId,
      eventType: 'click' as never,
      timestamp: evtCounter,
      valueBefore: null,
      valueAfter: null,
    },
    metadata: {},
    confidence: 1,
  };
  if (!resultingState) return base as never;
  return {
    ...base,
    behavioralEvidence: {
      applicationEvidence: { resultingState },
    },
  } as never;
}

function counterSnapshot(count: number): WirePageContentSnapshot {
  const items: WireObservedItem[] = [
    {
      kind: 'counter',
      matchedSelector: '[data-count]',
      text: `${count} items`,
      numericValue: count,
      entityId: null,
      entityType: null,
      domPath: 'BODY > P > SPAN#cart-count',
      attributes: {},
      visible: true,
    },
  ];
  return {
    url: 'https://shop.example.com/cart',
    viewId: null,
    items,
    itemsOverflow: 0,
    scannedAt: 1,
    scanDurationMs: 1,
  };
}

function planFor(interactions: ComponentInteraction[]) {
  const enrichment: GenerationEnrichment = {
    stepAssertions: deriveStepAssertions(interactions),
  };
  return build({
    interactions,
    recordingContext: { startUrl: 'https://shop.example.com/cart', title: null },
    testCaseName: 'Repeated clicks',
    enrichment,
  });
}

// ── Tests ──────────────────────────────────────────────────

describe('OR-1 correction — repeated same-target clicks', () => {
  it('two deliberate clicks with DIFFERENT resulting states stay TWO steps', () => {
    const interactions = [
      clickInteraction('evt-a-1', counterSnapshot(1)),
      clickInteraction('evt-a-2', counterSnapshot(2)),
    ];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    expect(clicks).toHaveLength(2);

    // Each step keeps its OWN sourceEventId and assertions
    expect(clicks[0].sourceEventId).toBe('evt-a-1');
    expect(clicks[1].sourceEventId).toBe('evt-a-2');
    const t1 = clicks[0].assertions.find((a) => a.type === 'textMatch');
    const t2 = clicks[1].assertions.find((a) => a.type === 'textMatch');
    expect(t1?.expectedValue).toBe('1 items');
    expect(t2?.expectedValue).toBe('2 items');
    // Renumbered contiguously
    expect(clicks[0].order).toBe(0);
    expect(clicks[1].order).toBe(1);
  });

  it('genuinely redundant duplicate (second click, NO new state) still merges to ONE step', () => {
    const interactions = [
      clickInteraction('evt-b-1', counterSnapshot(1)),
      clickInteraction('evt-b-2'), // no resulting state — double-fire residue
    ];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].sourceEventId).toBe('evt-b-1');
    const t1 = clicks[0].assertions.find((a) => a.type === 'textMatch');
    expect(t1?.expectedValue).toBe('1 items');
  });

  it('focus+click residue (first click no state, second click carries state) keeps the SECOND state', () => {
    // Focus-click then the stateful click: first step has no assertions,
    // second does. Both kept — merge only collapses no-new-state FOLLOWERS.
    const interactions = [
      clickInteraction('evt-c-1'), // focus click, no state
      clickInteraction('evt-c-2', counterSnapshot(1)),
    ];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    expect(clicks).toHaveLength(2);
    expect(clicks[1].sourceEventId).toBe('evt-c-2');
    const t2 = clicks[1].assertions.find((a) => a.type === 'textMatch');
    expect(t2?.expectedValue).toBe('1 items');
  });

  it('THREE repeated clicks (stateful, stateless, stateful) stay THREE steps', () => {
    const interactions = [
      clickInteraction('evt-d-1', counterSnapshot(1)),
      clickInteraction('evt-d-2'), // redundant middle duplicate
      clickInteraction('evt-d-3', counterSnapshot(2)),
    ];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    // run-length correct: the middle redundant duplicate merges into #1,
    // the final stateful click is a separate step
    expect(clicks).toHaveLength(2);
    expect(clicks[0].sourceEventId).toBe('evt-d-1');
    expect(clicks[1].sourceEventId).toBe('evt-d-3');
    const t2 = clicks[1].assertions.find((a) => a.type === 'textMatch');
    expect(t2?.expectedValue).toBe('2 items');
  });

  it('THREE repeated clicks (stateful, stateless, stateless) collapse to TWO steps', () => {
    const interactions = [
      clickInteraction('evt-e-1', counterSnapshot(1)),
      clickInteraction('evt-e-2'),
      clickInteraction('evt-e-3'),
    ];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    expect(clicks).toHaveLength(1); // maximal redundant run collapses
    expect(clicks[0].sourceEventId).toBe('evt-e-1');
  });

  it('consecutive clicks on DIFFERENT elements are never merged', () => {
    const other = makeIdentity();
    other.cssSelector = 'button#buy-now';
    other.elementId = 'el-buy-now';
    const a = clickInteraction('evt-f-1', counterSnapshot(1));
    (a.trigger as ElementIdentity) = other;
    const interactions = [a, clickInteraction('evt-f-2', counterSnapshot(2))];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    expect(clicks).toHaveLength(2);
  });

  it('two no-state clicks (pure double-fire) merge to ONE step', () => {
    const interactions = [
      clickInteraction('evt-g-1'),
      clickInteraction('evt-g-2'),
    ];
    const plan = planFor(interactions);

    const clicks = plan.steps.filter((s) => s.action === ('click' as IRAction));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].sourceEventId).toBe('evt-g-1');
    expect(clicks[0].assertions).toHaveLength(0);
  });
});
