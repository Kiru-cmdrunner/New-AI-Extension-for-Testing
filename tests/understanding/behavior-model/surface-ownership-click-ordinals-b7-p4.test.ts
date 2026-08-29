/**
 * B7-P4 provenance-regression amendment (2026-08-29) — C-1…C-6 pins.
 *
 * Root cause pinned by the final grounding audit: rule (b)'s fact-granularity
 * guard (`fact.batchIndex < c.openedBatch` ⇒ no veto) went INERT whenever a
 * consumer click's delivered evidence window lacked `openedBatch`. Consumer
 * clicks (hover reveal → click the revealed item) are consumed by the in-flight
 * hover lifecycle; their own `ev-{click}` window is silently closed and the
 * lifecycle synthetic (`lc-…`) carries no ordinal — so P3 surface-reuse links
 * died session-wide while P4 V1/V2 stayed green.
 *
 * These pins enforce the approved contract on the SHARED PASS
 * (deriveSurfaceFactOwnership) with the real click shapes:
 *
 *   P1  CONSUMER click with a stamped ordinal (lifecycle `lc-` window that
 *       carries openedBatch per C-1): reveal facts recorded at batches BELOW
 *       the click's ordinal are NOT vetoed — the hover keeps them (P3 S1).
 *   P2  REVEALER click with an ordinal (V1 shape, but WITH the C-1 stamp —
 *       collector-window clicks already deliver it): facts at/after the
 *       click's ordinal ARE vetoed (P4 V1) — the guard now discriminates on
 *       ordinals, not on which window shape happened to survive.
 *   P3  SAME-BATCH tie (C-3): fact.batch == click.openedBatch ⇒ unprovable as
 *       pre-click ⇒ veto stands (conservative under-claim, never a false
 *       assertion).
 *   P4  LIFECYCLE-REVEALER hybrid: a click that BOTH consumes a hover
 *       lifecycle AND causes the reveal (click-the-nav-item itself). The
 *       click-caused reveal lands at batch ≥ the click's stamped ordinal →
 *       vetoed. This is the case a blanket "consumer exemption" would have
 *       broken — Channel A through the consumer door.
 *   P5  Absent ordinal stays legacy (C-4): click without openedBatch on a
 *       P4-verified hover still vetoes (window-span rule, unchanged) — the
 *       regression guard until ordinals are complete.
 *   P6  TWO consumers (P3 S2): two clicks, each with ordinals, both later
 *       than the producer's reveal facts — hover keeps them; and the second
 *       consumer's OWN fact (a body insertion at the click) is still vetoed
 *       (honest attribution).
 */
import { describe, expect, it } from 'vitest';
import { deriveSurfaceFactOwnership } from '../../../src/shared/surface-fact-ownership';
import type { ObservedEvent } from '../../../src/shared/component-types';
import type { EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';

const T = 1_780_000_000_000;

function evt(eventType: string, timestamp: number, eventId: string): ObservedEvent {
  return {
    eventId,
    eventType: eventType as ObservedEvent['eventType'],
    timestamp,
    isTrusted: true,
    target: { tag: 'DIV', cssSelector: 'body > div', xPath: '//div', ariaRole: null, className: '', accessibleName: null, tabIndex: null },
    domContext: { tabIndex: null, pointerCursor: false, clickHandler: false },
    captureOrigin: { tabId: 1, frameId: 0 },
  } as unknown as ObservedEvent;
}

interface HoverOpts {
  openedBatch?: number;
  revealBatch: number;
  /** epoch timestamp of the mouseenter (open) */
  openTs: number;
  durationMs?: number;
}

/** Hover with ONE reveal-class fact (aria-expanded flip) at revealBatch. */
function hoverWithReveal(id: string, o: HoverOpts): EpisodeBuilderInteraction {
  const duration = o.durationMs ?? 12_000;
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent: evt('mouseenter', o.openTs, `evt-${id}`),
    trigger: { tag: 'DIV', accessibleName: 'Products', cssSelector: '#nav-products', xPath: '//div', stableId: 'nav-products' },
    memberEvents: [],
    startTime: o.openTs,
    endTime: o.openTs + duration,
    endState: 'completed',
    metadata: { terminal: 'left' },
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      windowId: `ev-evt-${id}`,
      window: {
        openedAt: 0, closedAt: duration, durationMs: duration,
        endReason: 'consequence-settled',
        ...(o.openedBatch !== undefined ? { openedBatch: o.openedBatch } : {}),
      },
      applicationEvidence: {
        domChanges: [{
          types: ['attributes'], targetPath: 'body > nav#nav > div#nav-products', targetTag: 'div',
          shadowContext: null, changedAttributes: ['aria-expanded'],
          attributeDeltas: { 'aria-expanded': { old: 'false', new: 'true' } },
          addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
          firstMutationAt: 80, lastMutationAt: 80, rawMutationCount: 1,
          firstBatchIndex: o.revealBatch, lastBatchIndex: o.revealBatch,
        }],
        domChangeOverflow: 0,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [], navigation: [], networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;
}

interface ClickOpts {
  ts: number;
  /** C-1 stamp — the batch counter recorded at click dispatch. Absent = legacy. */
  openedBatch?: number;
  /** an extra insertion fact owned by the CLICK's own evidence (S2 shape) */
  ownInsertionBatch?: number;
}

function clickWithEvidence(id: string, css: string, o: ClickOpts): EpisodeBuilderInteraction {
  return {
    interactionId: id,
    type: 'Link',
    triggerEvent: evt('click', o.ts, `evt-${id}`),
    trigger: { tag: 'A', accessibleName: 'Laptops', ariaRole: null, cssSelector: css, xPath: '//a', stableId: null },
    memberEvents: [],
    startTime: o.ts,
    endTime: o.ts + 100,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      // The lifecycle synthetic shape — windowId `lc-…` — is exactly the
      // consumer-click carrier C-1 stamps.
      windowId: `lc-evt-${id}`,
      window: {
        openedAt: 0, closedAt: 0, durationMs: 0, endReason: 'lifecycle-complete',
        ...(o.openedBatch !== undefined ? { openedBatch: o.openedBatch } : {}),
      },
      applicationEvidence: {
        domChanges: o.ownInsertionBatch !== undefined
          ? [{
              types: ['childList'], targetPath: 'body >', targetTag: 'body',
              shadowContext: null, changedAttributes: [], attributeDeltas: {},
              addedNodesCount: 1, removedNodesCount: 0, characterDataDelta: null,
              firstMutationAt: 0, lastMutationAt: 0, rawMutationCount: 1,
              firstBatchIndex: o.ownInsertionBatch, lastBatchIndex: o.ownInsertionBatch,
            }]
          : [],
        domChangeOverflow: 0,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [], navigation: [], networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;
}

describe('B7-P4 provenance-regression amendment: click ordinals discriminate rule (b)', () => {
  it('P1 — consumer click WITH C-1 ordinal does not strip reveal facts recorded BEFORE the click (P3 S1 restored)', () => {
    // Reveal at batch 0, ~1ms after hover open; consumer click at +10,646ms
    // with stamped ordinal 1 (its own consequence was batch 1).
    const hover = hoverWithReveal('int-h1', { openTs: T, revealBatch: 0, openedBatch: 0, durationMs: 12_000 });
    const consumer = clickWithEvidence('int-c1', '#nav-products > div#mega-products a', { ts: T + 10_646, openedBatch: 1 });
    const { ownedByInteraction } = deriveSurfaceFactOwnership([hover, consumer]);
    const owned = ownedByInteraction.get('int-h1') ?? [];
    expect(owned).toHaveLength(1);
    expect(owned[0].kind).toBe('reveal');
    expect(owned[0].path).toBe('body > nav#nav > div#nav-products');
  });

  it('P2 — revealer click WITH ordinal still vetoes facts at/after its ordinal (P4 V1 preserved)', () => {
    // The V1 shape: the click CAUSES the reveal. Facts land at batch 1, at
    // or after the click's stamped ordinal 0/1 — vetoed either way.
    const hover = hoverWithReveal('int-h1', { openTs: T, revealBatch: 1, openedBatch: 0, durationMs: 1_571 });
    const revealer = clickWithEvidence('int-rev', '#nav-products', { ts: T + 400, openedBatch: 0 });
    const { ownedByInteraction } = deriveSurfaceFactOwnership([hover, revealer]);
    expect(ownedByInteraction.get('int-h1') ?? []).toHaveLength(0);
  });

  it('P3 — same-batch tie (C-3): fact.batch == click.openedBatch is vetoed (conservative, never a false assertion)', () => {
    const hover = hoverWithReveal('int-h1', { openTs: T, revealBatch: 1, openedBatch: 0, durationMs: 5_000 });
    const click = clickWithEvidence('int-c1', '#x', { ts: T + 1_000, openedBatch: 1 });
    const { ownedByInteraction } = deriveSurfaceFactOwnership([hover, click]);
    expect(ownedByInteraction.get('int-h1') ?? []).toHaveLength(0);
  });

  it('P4 — lifecycle-revealer hybrid: a click that consumes the hover AND causes the reveal is still vetoed (no consumer exemption)', () => {
    // Hover nav item, then CLICK the nav item itself: the click terminates
    // the hover lifecycle (consumer shape) but its handler reveals the
    // panel. The click-caused reveal lands at batch 2 ≥ stamped ordinal 1
    // → vetoed. The pre-click dwell noise at batch 0 stays owned (honest).
    const hover = hoverWithReveal('int-h1', { openTs: T, revealBatch: 2, openedBatch: 0, durationMs: 5_000 });
    const hybrid = clickWithEvidence('int-hc', '#nav-products', { ts: T + 1_500, openedBatch: 1 });
    const { ownedByInteraction } = deriveSurfaceFactOwnership([hover, hybrid]);
    expect(ownedByInteraction.get('int-h1') ?? []).toHaveLength(0);
  });

  it('P5 — absent ordinal stays legacy: click without openedBatch still vetoes a verified hover (window-span rule unchanged)', () => {
    // Regression guard: the pre-fix shape (ordinal missing) must keep the
    // shipped P4 conservative behavior, not silently start linking.
    const hover = hoverWithReveal('int-h1', { openTs: T, revealBatch: 0, openedBatch: 0, durationMs: 12_000 });
    const legacyClick = clickWithEvidence('int-c1', '#nav-products a', { ts: T + 10_646 });
    const { ownedByInteraction } = deriveSurfaceFactOwnership([hover, legacyClick]);
    expect(ownedByInteraction.get('int-h1') ?? []).toHaveLength(0);
  });

  it('P6 — two consumers (P3 S2): both post-reveal clicks keep the hover producing; a consumer\'s OWN insertion is still vetoed for the hover', () => {
    const hover = hoverWithReveal('int-h1', { openTs: T, revealBatch: 0, openedBatch: 0, durationMs: 12_000 });
    const c1 = clickWithEvidence('int-c1', '#mega-products a:nth-child(1)', { ts: T + 2_086, openedBatch: 1 });
    const c2 = clickWithEvidence('int-c2', '#mega-products a:nth-child(2)', { ts: T + 2_751, openedBatch: 2, ownInsertionBatch: 2 });
    const { ownedByInteraction } = deriveSurfaceFactOwnership([hover, c1, c2]);
    const owned = ownedByInteraction.get('int-h1') ?? [];
    expect(owned).toHaveLength(1);
    expect(owned[0].kind).toBe('reveal');
  });
});
