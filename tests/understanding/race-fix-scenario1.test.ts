/**
 * Scenario 1 end-to-end validation — Amazon Add-to-Cart shape, reproducing
 * the real recording (int-14 click → int-15 synthetic nav) AFTER the
 * onCompleted→onCommitted race fix.
 *
 * Simulates the full production evidence shape the SW now produces:
 * the click (int-14) receives the recovered POST via the drain (or via
 * commit-time recovery), the synthetic nav (int-15) carries only navigation
 * + filtered residual requests, then the understanding pipeline runs over
 * both and must produce the complete checklist result.
 *
 * Checklist (Manual Validation — Scenario 1):
 *  1. POST + requestBody on the Add-to-cart click
 *  2. click-level success attribution (no marker = direct evidence)
 *  3. cart-item entity with ASIN attribute
 *  4. telemetry exclusion (fls-/unagi/uedata never vote)
 *  5. exactly-once POST evidence across both interactions
 *  6. synthetic nav fromUrl = product page (DDC-2)
 */

import { describe, it, expect } from 'vitest';
import { createDefaultUnderstandingPipeline } from '../../src/understanding/pipeline/understanding-pipeline';
import { drainNetworkEvidence } from '../../src/background/network-drain';
import type { NetworkActivity } from '../../src/shared/behavioral-evidence-types';
import type { ComponentInteraction } from '../../src/shared/component-types';

function makeInteraction(
  id: string,
  network: NetworkActivity[],
  opts: {
    type?: string;
    endReason?: string;
    sourceEventId?: string;
    navFrom?: string;
    navTo?: string;
  } = {},
): ComponentInteraction {
  const sourceEventId = opts.sourceEventId ?? `evt-${id}`;
  return {
    interactionId: id,
    type: (opts.type ?? 'Click') as never,
    trigger: {
      kind: 'element',
      tagName: 'INPUT',
      id: 'add-to-cart-button',
      accessibleName: 'Add to cart',
      attributes: { type: 'submit' },
    } as never,
    triggerEvent: {
      eventId: sourceEventId,
      eventType: 'click',
      timestamp: 1000,
      captureSeq: 1,
      isTrusted: true,
      target: {
        accessibleName: 'Add to cart',
        ariaRole: 'button',
        tag: 'INPUT',
        cssSelector: '#add-to-cart-button',
        inputType: 'submit',
        elementId: 'add-to-cart-button',
      } as never,
      domContext: {} as never,
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
      pageUrl: 'https://www.amazon.in/iPhone-Pro-512-Promotion-Breakthrough/dp/B0FQF2ZJWT',
      pageTitle: 'iPhone 17 Pro 512 GB',
    } as never,
    memberEvents: [],
    startTime: 1000,
    endTime: 1174,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId,
      sourceEventType: 'click',
      windowId: `bev-${id}`,
      frameId: 'main',
      window: {
        openedAt: 1000,
        closedAt: 1174,
        durationMs: 174,
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
        } as never,
        identityCapturedAt: 1000,
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
        navigation: opts.navTo
          ? [{
              type: 'full-reload',
              fromUrl: opts.navFrom ?? '',
              toUrl: opts.navTo,
              relativeTime: 0,
              batchIndex: null,
            }]
          : [],
        networkActivity: network,
        performanceCondition: {
          mainThreadBlocked: false,
          highChurnMode: false,
          longestBatchMs: 14,
          totalBatches: 6,
        },
      },
    },
  } as unknown as ComponentInteraction;
}

describe('Scenario 1 — Amazon Add-to-Cart after RACE FIX (int-14 → int-15)', () => {
  it('full checklist: POST+body on click, click success, cart-item+ASIN, telemetry out, exactly-once, fromUrl', async () => {
    // ── Production evidence shape after the fix ──
    // int-14 (the click): evidence destroyed by reload → networkActivity [].
    // The stop-recording drain merges the ring POST by sourceEventId.
    const click = makeInteraction('int-14', [], { sourceEventId: 'evt-int-14' });

    // int-15 (synthetic nav): commit-time recovery attached navigation +
    // the document POST is consumed there… in the LOSING order the drain
    // supplies it instead. Nav carries only navigation + already-filtered
    // residual (telemetry removed by the recovery filter).
    const nav = makeInteraction('int-15', [], {
      type: 'Navigation',
      endReason: 'page-reload-synthetic',
      sourceEventId: 'evt-nav-int-15',
      navFrom: 'https://www.amazon.in/iPhone-Pro-512-Promotion-Breakthrough/dp/B0FQF2ZJWT',
      navTo: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bbf_1_glance',
    });

    // Ring state at stop-recording: the main-frame POST (stamped with the
    // click's trusted-action event id) + telemetry that must never surface.
    const ring = [
      {
        url: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bbf_1_glance',
        method: 'POST',
        status: 200,
        requestId: 'r-add-cart',
        sourceEventId: 'evt-int-14',
        requestBody: { ASIN: 'B0FQF2ZJWT', quantity: '1', 'session-id': '259-1234567-1234567' },
        documentRequest: true,
      },
      {
        url: 'https://fls-eu.amazon.in/1/batch/1/OP/A21TJRUUN4KGV:520-9695',
        method: 'GET',
        status: 200,
        requestId: 'r-fls',
        sourceEventId: 'evt-int-14',
      },
      {
        url: 'https://unagi.amazon.in/1/events/com.amazon.eel.FlashLogger',
        method: 'POST',
        status: 200,
        requestId: 'r-unagi',
        sourceEventId: 'evt-int-14',
      },
    ];

    // Drain (stop-recording pass 2)
    const { mergedRequestIds } = drainNetworkEvidence([click, nav], ring);
    expect(mergedRequestIds).toEqual(['r-add-cart']); // ONLY the POST — check 4 (telemetry excluded)

    // ── Checklist 1: POST + requestBody on the click ──
    const clickNet = click.behavioralEvidence!.applicationEvidence.networkActivity;
    expect(clickNet.length).toBe(1);
    expect(clickNet[0].url).toContain('/cart/add-to-cart');
    expect(clickNet[0].method).toBe('POST');
    expect(clickNet[0].status).toBe(200);
    expect(clickNet[0].requestBody).toEqual(
      expect.objectContaining({ ASIN: 'B0FQF2ZJWT', quantity: '1' }),
    );

    // ── Checklist 5: exactly-once — nav has zero network entries ──
    expect(nav.behavioralEvidence!.applicationEvidence.networkActivity.length).toBe(0);

    // ── Checklist 6: synthetic nav fromUrl = product page (DDC-2) ──
    const navEntry = nav.behavioralEvidence!.applicationEvidence.navigation[0];
    expect(navEntry.fromUrl).toContain('/dp/B0FQF2ZJWT');
    expect(navEntry.toUrl).toContain('/cart/add-to-cart');

    // ── Pipeline over the fixed evidence ──
    const pipeline = createDefaultUnderstandingPipeline();
    const result = await pipeline.run({
      interactions: [click, nav],
      origin: 'https://www.amazon.in',
      sessionId: 'sess-racefix',
    });

    // ── Checklist 2: click-level success (direct evidence — no marker) ──
    const outcome = result.outcomes.get('int-14');
    expect(outcome).toBeDefined();
    expect(outcome!.outcome).toBe('success');
    const apiVotes = outcome!.supportingEvidence.filter((e) => e.kind === 'api-operation');
    expect(apiVotes.length).toBeGreaterThan(0);
    // Every api vote must reference the add-to-cart POST, never telemetry.
    for (const v of apiVotes) {
      expect(v.detail).toContain('/cart/add-to-cart');
    }

    // ── Checklist 3: cart-item entity with ASIN ──
    const entities = [...(result.finalState?.entities.values() ?? [])] as {
      id: string;
      type: string;
      attributes?: Record<string, string>;
    }[];
    const cartItem = entities.find((e) => e.type === 'cart-item');
    expect(cartItem).toBeDefined();
    expect(
      cartItem!.attributes?.productId ?? cartItem!.attributes?.asin ?? cartItem!.attributes?.ASIN,
    ).toBeTruthy();
  });
});
