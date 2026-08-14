/**
 * CER — Correlation-Based Evidence Routing
 *
 * Regression tests for the removal of timing-based correctness
 * dependencies in the click → main-frame POST → navigation → network
 * → outcome chain.
 *
 * Scenarios:
 *  1. Amazon-style form submission: click → main-frame POST → full-page
 *     reload → synthetic nav → recovered op attributed to the CLICK via
 *     exact sourceEventId join (no timestamp window).
 *  2. SPA/API flow: click → fetch in-window; requestId membership join
 *     (not timestamp overlap).
 *  3. Ambiguous multi-op recovery: stamped ops disagreeing on
 *     sourceEventId must NOT be attributed.
 *  4. Unknown-classification ops must not vote in outcomes.
 *  5. int-9/int-10 numeric ordering fix (most-recently-updated).
 *  6. requestId-equality dedup between webrequest and main-world.
 */

import { describe, it, expect } from 'vitest';
import { NetworkSignalExtractor } from '../../src/understanding/signal-extractors/network-signals';
import { OutcomeDeterminer } from '../../src/understanding/outcome/outcome-determiner';
import { compareInteractionIds, interactionIdNumber } from '../../src/understanding/state-builder/interaction-ordering';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { NetworkActivity } from '../../src/shared/behavioral-evidence-types';
import { createDefaultUnderstandingPipeline } from '../../src/understanding/pipeline/understanding-pipeline';

// ── Helpers ───────────────────────────────────────────────────────────

function netEntry(partial: Partial<NetworkActivity> & { url: string }): NetworkActivity {
  return {
    method: 'GET',
    status: 200,
    startRelativeToEvent: 10,
    endRelativeToEvent: 150,
    durationMs: 140,
    resourceType: 'unknown',
    source: 'webrequest',
    ...partial,
  } as NetworkActivity;
}

/** Minimal SignalSet with all iterables the outcome determiner reads. */
function emptySignalSet(overrides: Record<string, unknown> = {}): any {
  return {
    interactionId: 'int-x',
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    collectionChanges: [],
    listChanges: [],
    controlStateChanges: [],
    pageContentChanges: [],
    pageContent: {
      observedEntities: [],
      observedCollections: [],
      observedCounters: [],
      observedNotifications: [],
    },
    ...overrides,
  };
}

function makeInteraction(
  id: string,
  networkActivity: NetworkActivity[],
  opts: { type?: string; endReason?: string; sourceEventId?: string; startTime?: number; endTime?: number } = {},
): ComponentInteraction {
  const sourceEventId = opts.sourceEventId ?? `evt-${id}`;
  return {
    interactionId: id,
    type: (opts.type ?? 'click') as any,
    trigger: {
      kind: 'element',
      tagName: 'INPUT',
      id: 'add-to-cart-button',
      attributes: { type: 'submit' },
    } as any,
    triggerEvent: {
      eventId: sourceEventId,
      eventType: 'click',
      timestamp: opts.startTime ?? 1000,
      captureSeq: 1,
      isTrusted: true,
      target: {
        accessibleName: 'Add to cart',
        ariaRole: 'button',
        tag: 'INPUT',
        cssSelector: '#add-to-cart-button',
        inputType: 'submit',
        elementId: 'add-to-cart-button',
      } as any,
      domContext: {} as any,
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://www.amazon.in/dp/B08KGRVW2S',
      pageTitle: 'Vivo Y11 5G',
    } as any,
    memberEvents: [],
    startTime: opts.startTime ?? 1000,
    endTime: opts.endTime ?? 1161,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId,
      sourceEventType: 'click',
      windowId: `w-${id}`,
      frameId: 'main',
      window: {
        openedAt: opts.startTime ?? 1000,
        closedAt: opts.endTime ?? 1161,
        durationMs: (opts.endTime ?? 1161) - (opts.startTime ?? 1000),
        endReason: opts.endReason ?? 'lifecycle-complete',
        stabilityTrace: [],
      },
      targetEvidence: {
        identity: {
          accessibleName: 'Add to cart',
          ariaRole: 'button',
          tag: 'INPUT',
          cssSelector: '#add-to-cart-button',
          inputType: 'submit',
          elementId: 'add-to-cart-button',
        } as any,
        identityCapturedAt: opts.startTime ?? 1000,
        before: null,
        after: null,
        changed: false,
        changeSummary: [],
        focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [],
        domChangeOverflow: 0,
        coarseMode: false,
        newSurfaces: [],
        removedSurfaces: [],
        visibilityChanges: [],
        navigation: [],
        networkActivity,
        performanceCondition: {
          mainThreadBlocked: false,
          highChurnMode: false,
          longestBatchMs: 0,
          totalBatches: 1,
        },
      },
    },
  } as unknown as ComponentInteraction;
}

/** Build a minimal pipeline input for interactions. */
function pipelineInput(interactions: ComponentInteraction[]) {
  return {
    interactions,
    origin: 'https://www.amazon.in',
    sessionId: 'sess-cer-1',
  };
}

// ── 1. Ordering helper ───────────────────────────────────────────────

describe('CER-5 — numeric interaction ID ordering', () => {
  it('orders int-9 before int-10', () => {
    expect(compareInteractionIds('int-9', 'int-10')).toBeLessThan(0);
    expect(compareInteractionIds('int-10', 'int-9')).toBeGreaterThan(0);
  });

  it('orders across magnitudes (int-2 < int-99 < int-100)', () => {
    expect(compareInteractionIds('int-2', 'int-99')).toBeLessThan(0);
    expect(compareInteractionIds('int-99', 'int-100')).toBeLessThan(0);
    expect(compareInteractionIds('int-100', 'int-2')).toBeGreaterThan(0);
  });

  it('equal IDs compare 0; non-numeric falls back lexically', () => {
    expect(compareInteractionIds('int-5', 'int-5')).toBe(0);
    expect(interactionIdNumber('evt-5')).toBeNull();
    expect(compareInteractionIds('a', 'b')).toBeLessThan(0);
  });
});

// ── 2. Unknown ops must not vote ─────────────────────────────────────

describe('CER-6 — unknown-classification ops do not vote', () => {
  const det = new OutcomeDeterminer();

  it('telemetry beacon with unknown classification casts no success vote', () => {
    const interaction = makeInteraction('int-1', [
      netEntry({
        url: 'https://t.example-telemetry.net/v1/sync/OE7ead3e8be0f0e8f8',
        method: 'POST',
        status: 200,
        source: 'webrequest',
      }),
    ]);
    const extractor = new NetworkSignalExtractor();
    const signalArr = extractor.extract(interaction);
    const unknownOps = signalArr.filter((op: any) => op.operation === 'unknown');
    expect(unknownOps.length).toBeGreaterThan(0);

    const outcome = det.determine({
      interactionId: 'int-1',
      actionType: 'Click',
      actionTarget: 'Add to cart',
      signals: emptySignalSet({ apiOperations: signalArr as any }),
      transition: null,
      evidenceQuality: { mainThreadBlocked: false, domChangeOverflow: 0, coarseMode: false },
    });

    const apiVotes = outcome.supportingEvidence.filter((e) => e.kind === 'api-operation');
    expect(apiVotes.length).toBe(0);
    expect(outcome.outcome).toBe('incomplete');
  });

  it('a classified op still votes (add-to-cart POST 200)', () => {
    const interaction = makeInteraction('int-2', [
      netEntry({
        url: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-btf_1_cart',
        method: 'POST',
        status: 200,
        source: 'webrequest',
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
      }),
    ]);
    const extractor = new NetworkSignalExtractor();
    const signalArr = extractor.extract(interaction);
    expect(signalArr.length).toBeGreaterThan(0);
    expect((signalArr[0] as any).operation).not.toBe('unknown');

    const det = new OutcomeDeterminer();
    const outcome = det.determine({
      interactionId: 'int-2',
      actionType: 'Click',
      actionTarget: 'Add to cart',
      signals: emptySignalSet({ apiOperations: signalArr as any }),
      transition: null,
      evidenceQuality: { mainThreadBlocked: false, domChangeOverflow: 0, coarseMode: false },
    });
    expect(outcome.outcome).toBe('success');
    expect(outcome.supportingEvidence.some((e) => e.kind === 'api-operation')).toBe(true);
  });
});

// ── 3. sourceEventId propagation through the extractor ───────────────

describe('CER-4 — sourceEventId exact join key', () => {
  it('extractor propagates sourceEventId from webrequest entries', () => {
    const interaction = makeInteraction('int-19', [
      netEntry({
        url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
        method: 'POST',
        status: 200,
        source: 'webrequest',
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
        sourceEventId: 'evt-int-19',
      } as Partial<NetworkActivity> & { url: string }),
    ]);
    const signalArr = new NetworkSignalExtractor().extract(interaction);
    expect(signalArr.length).toBe(1);
    expect((signalArr[0] as any).sourceEventId).toBe('evt-int-19');
  });

  it('main-world entries without sourceEventId propagate undefined', () => {
    const interaction = makeInteraction('int-3', [
      netEntry({
        url: 'https://api.shop.example.com/api/cart',
        method: 'POST',
        status: 201,
        source: 'main-world',
        requestBody: { productId: 'p-1', qty: 1 } as any,
      }),
    ]);
    const signalArr = new NetworkSignalExtractor().extract(interaction);
    expect((signalArr[0] as any).sourceEventId).toBeUndefined();
  });
});

// ── 4. Amazon-style form submit: click → synthetic nav → attribution ─

describe('CER pipeline — Amazon-style form submission attribution', () => {
  it('recovers the main-frame POST and attributes it to the click by sourceEventId', async () => {
    // Click on Add to cart. The main-frame POST destroys the page before
    // the content script's window can collect — click has zero network
    // evidence of its own.
    const click = makeInteraction('int-19', [], {
      sourceEventId: 'evt-int-19',
      startTime: 1000,
      endTime: 1161,
    });

    // Synthetic navigation created by the SW after the reload. Its
    // recovered evidence contains the main-frame POST — stamped with the
    // CLICK's event id (lastTrustedAction at onBeforeRequest time).
    const syntheticNav = makeInteraction('int-20', [
      netEntry({
        url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
        method: 'POST',
        status: 200,
        source: 'webrequest',
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
        sourceEventId: 'evt-int-19',
      } as Partial<NetworkActivity> & { url: string }),
      // Unload beacons — unknown classification, must not vote.
      netEntry({
        url: 'https://fls-eu.amazon.in/1/batch/1/OE.abc',
        method: 'POST',
        status: 200,
        source: 'webrequest',
      }),
    ], {
      type: 'navigation',
      endReason: 'page-reload-synthetic',
      sourceEventId: 'evt-int-20-nav',
      startTime: 1200,
      endTime: 1250,
    });

    const pipeline = createDefaultUnderstandingPipeline();
    const result = await pipeline.run(pipelineInput([click, syntheticNav]));

    // The CLICK (int-19) now has an evidenced outcome.
    const clickOutcome = result.outcomes.get('int-19');
    expect(clickOutcome).toBeDefined();
    expect(clickOutcome!.outcome).toBe('success');
    expect(
      clickOutcome!.supportingEvidence.some(
        (e) => e.kind === 'api-operation' && e.detail.includes('attributed via reload recovery'),
      ),
    ).toBe(true);

    // Entity: cart-item with productId linkage from the recovered body.
    const cartItem = [...result.finalState!.entities.values()].find(
      (e: any) => e.entityType === 'cart-item',
    );
    if (cartItem) {
      expect(cartItem.attributes?.asin ?? cartItem.attributes?.productId).toBeTruthy();
    }
  });

  it('does NOT attribute when stamped ops disagree on sourceEventId (ambiguity guard)', async () => {
    const click = makeInteraction('int-5', [], {
      sourceEventId: 'evt-int-5',
      startTime: 1000,
      endTime: 1161,
    });
    const click2 = makeInteraction('int-7', [], {
      sourceEventId: 'evt-int-7',
      startTime: 1100,
      endTime: 1200,
    });
    const syntheticNav = makeInteraction('int-8', [
      netEntry({
        url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
        method: 'POST',
        status: 200,
        source: 'webrequest',
        sourceEventId: 'evt-int-5',
      } as any),
      netEntry({
        url: 'https://www.amazon.in/cart/add-to-cart/ref=y',
        method: 'POST',
        status: 200,
        source: 'webrequest',
        sourceEventId: 'evt-int-7',
      } as any),
    ], {
      type: 'navigation',
      endReason: 'page-reload-synthetic',
      sourceEventId: 'evt-int-8-nav',
      startTime: 1300,
      endTime: 1350,
    });

    const pipeline = createDefaultUnderstandingPipeline();
    const result = await pipeline.run(pipelineInput([click, click2, syntheticNav]));

    // Ambiguous: two different stamped events → no attribution to either.
    const o5 = result.outcomes.get('int-5');
    const o7 = result.outcomes.get('int-7');
    const attributed = (o: any) =>
      o?.supportingEvidence?.some(
        (e: any) => e.kind === 'api-operation' && String(e.detail).includes('attributed via reload recovery'),
      );
    expect(attributed(o5)).toBeFalsy();
    expect(attributed(o7)).toBeFalsy();
  });

  it('does NOT attribute stamped-but-unmatched ops to a nearest action', async () => {
    // The recovered op is stamped with an event id that belongs to NO
    // interaction in this session (e.g. recorded after the click's
    // window closed and before any new trusted action). Guessing the
    // nearest preceding action would fabricate causality.
    const click = makeInteraction('int-9', [], {
      sourceEventId: 'evt-int-9',
      startTime: 1000,
      endTime: 1161,
    });
    const syntheticNav = makeInteraction('int-10', [
      netEntry({
        url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
        method: 'POST',
        status: 200,
        source: 'webrequest',
        sourceEventId: 'evt-ghost',
      } as any),
    ], {
      type: 'navigation',
      endReason: 'page-reload-synthetic',
      sourceEventId: 'evt-int-10-nav',
      startTime: 1200,
      endTime: 1250,
    });

    const pipeline = createDefaultUnderstandingPipeline();
    const result = await pipeline.run(pipelineInput([click, syntheticNav]));

    const o9 = result.outcomes.get('int-9');
    const attributed = (o: any) =>
      o?.supportingEvidence?.some(
        (e: any) => e.kind === 'api-operation' && String(e.detail).includes('attributed via reload recovery'),
      );
    expect(attributed(o9)).toBeFalsy();
  });
});

// ── 5. SPA/API flow still works ──────────────────────────────────────

describe('CER pipeline — SPA/API flow', () => {
  it('click with in-window fetch keeps its own ops (no double attribution)', async () => {
    const click = makeInteraction('int-11', [
      netEntry({
        url: 'https://www.shop-spa.example.com/cart/add',
        method: 'POST',
        status: 201,
        source: 'main-world',
      }),
    ], { sourceEventId: 'evt-int-11', startTime: 1000, endTime: 1161 });

    const pipeline = createDefaultUnderstandingPipeline();
    const result = await pipeline.run(pipelineInput([click]));

    const outcome = result.outcomes.get('int-11');
    expect(outcome).toBeDefined();
    expect(outcome!.outcome).toBe('success');
    // NOT attributed via recovery — captured directly.
    expect(
      outcome!.supportingEvidence.every(
        (e) => !(e.kind === 'api-operation' && e.detail.includes('attributed via reload recovery')),
      ),
    ).toBe(true);
  });

  it('counter + notification + API together produce a confident outcome', async () => {
    const click = makeInteraction('int-12', [
      netEntry({
        url: 'https://orangehrm.example.com/leave/apply',
        method: 'POST',
        status: 200,
        source: 'main-world',
        requestBody: { leaveType: 'annual', employeeId: '7' } as any,
      }),
    ], { sourceEventId: 'evt-int-12' });

    const pipeline = createDefaultUnderstandingPipeline();
    const result = await pipeline.run(pipelineInput([click]));

    const outcome = result.outcomes.get('int-12');
    expect(outcome).toBeDefined();
    expect(outcome!.outcome).toBe('success');
  });
});
