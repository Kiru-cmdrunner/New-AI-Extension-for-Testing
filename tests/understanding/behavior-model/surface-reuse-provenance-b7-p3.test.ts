/**
 * B7-P3 §5.3.2 — surface-reuse provenance links (N6 phase 1, degraded).
 *
 * The reserved ProvenanceLink slot (model-types.ts) is currently typed
 * and emitted as [] (causal-graph.ts "CP3 emits NO provenance links
 * rather than guess"). P3 emits `surface-reuse` links:
 *
 *   hover episode (producer) → click episode whose anchor interaction's
 *   recorded element identity joins an insertion/reveal fact recorded in
 *   the producer's evidence window.
 *
 * JOIN FORMAT REALITY (verified against real capture — p2-reveal-consume
 * dump): surface facts record DOM-path form (`body > div > div#mega-products`,
 * segments `tag` or `tag#id` only) while click triggers record identity
 * form (`#mega-products` cssSelector, `//div[@id='mega-products']` xPath,
 * `mega-products` stableId). The join is therefore:
 *   - id-exact: fact-path terminal id === consumer's own DOM id;
 *   - chain-degraded: normalized segment-chain containment, labeled
 *     degraded, needs id agreement or ≥2 aligned segments;
 *   - NEVER tag-only single-segment (ambiguity documented).
 *
 * Contracts pinned here:
 *   - NON-CAUSAL: no CausalEdge for the link; ref-uniqueness registry
 *     never claims provenance refs (links cite, edges own);
 *   - deterministic order;
 *   - no self-links, no cross-tab links, hover producer only (P3 scope);
 *   - recorded order respected (click after the window, by anchor T0 vs
 *     window interval);
 *   - V2 honesty: the link cites the surface fact via a dom ref
 *     (windowId + batch sequence), never a copy of surface content.
 */

import { describe, expect, it } from 'vitest';
import { deriveCausalGraph } from '../../../src/understanding/behavior-model/causal-graph';
import { buildEpisodes, type EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';
import type { GraphInteractionEvidence } from '../../../src/understanding/behavior-model/causal-graph';

let seq = 0;
const T = 1_000_000;

function evt(opts: { eventType: string; timestamp: number; tabId?: number }) {
  seq += 1;
  return {
    eventId: `evt-p1-${seq}`,
    eventType: opts.eventType,
    timestamp: opts.timestamp,
    captureSeq: seq,
    ...(opts.tabId === undefined ? {} : { captureOrigin: { tabId: opts.tabId, frameId: 0 } }),
  };
}

/**
 * Admitted hover whose window recorded ONE inserted surface with the
 * given DOM path (real SurfaceChange shape; batchIndex = global ordinal).
 */
function admittedHoverWithWindow(
  id: string,
  t0: number,
  windowId: string,
  surfaces: Array<{ path: string; ariaRole: string | null; name: string | null; batchIndex?: number }>,
): { interaction: EpisodeBuilderInteraction; evidence: GraphInteractionEvidence } {
  const triggerEvent = evt({ eventType: 'mouseenter', timestamp: t0 });
  const interaction = {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Products', cssSelector: '#nav-products', xPath: "//button[@id='nav-products']", stableId: 'nav-products' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 1200,
    endState: 'completed',
    metadata: { targetName: 'Products', terminal: 'left', consequenceClasses: ['reveal', 'insertion'], meaningful: true },
    behavioralEvidence: {
      sourceEventId: triggerEvent.eventId,
      windowId,
      window: { openedAt: 0, closedAt: 1200, durationMs: 1200, endReason: 'consequence-settled' },
      applicationEvidence: {
        domChanges: surfaces.length
          ? [{
              types: ['childList'] as never, targetPath: surfaces[0].path, targetTag: 'DIV',
              shadowContext: null, changedAttributes: [], attributeDeltas: {},
              addedNodesCount: 1, removedNodesCount: 0, characterDataDelta: null,
              firstMutationAt: 80, lastMutationAt: 80, rawMutationCount: 1,
              firstBatchIndex: surfaces[0].batchIndex ?? 1, lastBatchIndex: surfaces[0].batchIndex ?? 1,
            }]
          : [],
        domChangeOverflow: 0,
        newSurfaces: surfaces.map((s, i) => ({
          path: s.path, tagName: 'DIV', ariaRole: s.ariaRole, accessibleName: s.name,
          shadowContext: null, descendantCount: 1, relativeTime: 100,
          batchIndex: s.batchIndex ?? i + 1, kind: 'added' as const, emergence: 'inserted' as const,
        })),
        removedSurfaces: [],
        visibilityChanges: [],
        navigation: [],
        networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;

  const evidence: GraphInteractionEvidence = {
    interactionId: id,
    evidence: {
      windowId,
      sourceEventId: triggerEvent.eventId,
      openedAt: 0,
      domChangeCount: surfaces.length,
      domChangeOverflow: 0,
      newSurfaces: surfaces.map((s) => ({ accessibleName: s.name })),
      removedSurfaces: [],
      visibilityChanges: 0,
      navigation: [],
      synthesized: false,
      endReason: 'consequence-settled',
    },
    windowOpenedEpochMs: t0,
    windowClosedEpochMs: t0 + 1200,
  };
  return { interaction, evidence };
}

/** Real click record: identity lives on `trigger` (cssSelector/xPath/stableId). */
function clickOn(
  id: string,
  t0: number,
  identity: { cssSelector: string; xPath: string; stableId?: string | null; tag?: string; name?: string },
): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'click', timestamp: t0 });
  return {
    interactionId: id,
    type: 'Click',
    triggerEvent,
    trigger: {
      tag: identity.tag ?? 'A',
      accessibleName: identity.name ?? 'Laptops',
      ariaRole: null,
      cssSelector: identity.cssSelector,
      xPath: identity.xPath,
      stableId: identity.stableId ?? null,
    },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 100,
    endState: 'completed',
    metadata: { targetName: identity.name ?? 'Laptops' },
  } as unknown as EpisodeBuilderInteraction;
}

describe('B7-P3: surface-reuse provenance links', () => {
  it('hover reveal → click on the revealed element (id-exact join) emits ONE surface-reuse link (producer→consumer)', () => {
    // Real dump shape: surface path `body > div > div#mega-products`; the
    // clicked child carries stableId/cssSelector `mega-products`/`#mega-products`.
    const surfacePath = 'body > div > div#mega-products';
    const h = admittedHoverWithWindow('int-h1', T, 'ev-e1', [{ path: surfacePath, ariaRole: 'region', name: 'Products flyout' }]);
    const c = clickOn('int-c1', T + 3000, { cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", stableId: 'mega-products', tag: 'DIV', name: 'Laptops' });

    const built = buildEpisodes({ interactions: [h.interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c], evidenceWindows: [h.evidence] });

    expect(graph.provenanceLinks.length).toBe(1);
    const link = graph.provenanceLinks[0];
    expect(link.kind).toBe('surface-reuse');
    expect(link.sourceEpisodeId).toBe('ep-int-h1');
    expect(link.targetEpisodeId).toBe('ep-int-c1');
    expect(link.evidenceRefs.length).toBeGreaterThan(0);
    expect(link.evidenceRefs[0].kind).toBe('dom');
  });

  it('click on a CHILD of the inserted surface links (chain-degraded join, labeled degraded)', () => {
    // Surface inserted at `body > div > div#mega-products`; the user clicks
    // the id-less link inside it (real css chain: 5-deep from the element).
    const surfacePath = 'body > div > div#mega-products';
    const h = admittedHoverWithWindow('int-h2', T, 'ev-e2', [{ path: surfacePath, ariaRole: 'region', name: 'Flyout' }]);
    const c = clickOn('int-c2', T + 3000, {
      cssSelector: 'div#mega-products > ul > li > a',
      xPath: '//div[@id="mega-products"]/ul/li/a',
      tag: 'A', name: 'Laptops',
    });

    const built = buildEpisodes({ interactions: [h.interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c], evidenceWindows: [h.evidence] });
    expect(graph.provenanceLinks.length).toBe(1);
    expect(graph.provenanceLinks[0].targetEpisodeId).toBe('ep-int-c2');
    // Degraded join must be LABELED, never silent.
    expect(graph.provenanceLinks[0].evidenceRefs[0]).toHaveProperty('degradation');
    expect((graph.provenanceLinks[0].evidenceRefs[0] as { degradation?: string[] }).degradation).toContain('degraded-chain-join');
  });

  it('NO link when the click identity joins nothing recorded (unrelated path)', () => {
    const h = admittedHoverWithWindow('int-h3', T, 'ev-e3', [{ path: 'body > div > div#mega-products', ariaRole: 'region', name: 'Flyout' }]);
    const c = clickOn('int-c3', T + 3000, { cssSelector: '#privacy', xPath: "//a[@id='privacy']", stableId: 'privacy', tag: 'A', name: 'Privacy' });

    const built = buildEpisodes({ interactions: [h.interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c], evidenceWindows: [h.evidence] });
    expect(graph.provenanceLinks.length).toBe(0);
  });

  it('NO link when the click PRECEDES the hover window (recorded order respected)', () => {
    const h = admittedHoverWithWindow('int-h4', T + 3000, 'ev-e4', [{ path: 'body > div > div#mega-products', ariaRole: null, name: 'Flyout' }]);
    const c = clickOn('int-c4', T, { cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", stableId: 'mega-products', tag: 'DIV' });

    const built = buildEpisodes({ interactions: [h.interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c], evidenceWindows: [h.evidence] });
    expect(graph.provenanceLinks.length).toBe(0);
  });

  it('NON-CAUSAL: no CausalEdge is emitted for the link; ref registries untouched by provenance', () => {
    const h = admittedHoverWithWindow('int-h5', T, 'ev-e5', [{ path: 'body > div > div#mega-products', ariaRole: 'region', name: 'Flyout' }]);
    const c = clickOn('int-c5', T + 3000, { cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", stableId: 'mega-products', tag: 'DIV' });

    const built = buildEpisodes({ interactions: [h.interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c], evidenceWindows: [h.evidence] });

    expect(graph.provenanceLinks.length).toBe(1);
    // No edge BETWEEN the two episodes exists (the link is not causality).
    for (const ep of graph.episodes) {
      for (const edge of ep.edges) {
        const linksEpisodes = edge.from.episodeId === 'ep-int-h1' || edge.from.episodeId === 'ep-int-c1';
        if (linksEpisodes) {
          // Edges FROM either episode must be ordinary consequence edges
          // (ui/state/api) — never a surface-reuse pseudo-edge.
          expect(edge.kind === 'ui' || edge.kind === 'state' || edge.kind === 'api' || edge.kind === 'navigation').toBe(true);
        }
      }
    }
    // Ref-uniqueness registry does NOT claim provenance refs.
    const claimed = new Set(graph.claimedRefKeys);
    for (const link of graph.provenanceLinks) {
      for (const r of link.evidenceRefs) {
        if (r.kind === 'dom') {
          const key = `dom:${(r as { windowId: string }).windowId}#${(r as { sequence: number }).sequence}`;
          expect(claimed.has(key)).toBe(false);
        }
      }
    }
  });

  it('deterministic: identical input yields identical links (order + ids stable)', () => {
    const build = () => {
      const h = admittedHoverWithWindow('int-h6', T, 'ev-e6', [{ path: 'body > div > div#mega-products', ariaRole: null, name: 'F' }]);
      const c1 = clickOn('int-c6a', T + 3000, { cssSelector: 'div#mega-products > ul > li:nth-of-type(1) > a', xPath: '//div[@id="mega-products"]/ul/li[1]/a', tag: 'A', name: 'A' });
      const c2 = clickOn('int-c6b', T + 6000, { cssSelector: 'div#mega-products > ul > li:nth-of-type(2) > a', xPath: '//div[@id="mega-products"]/ul/li[2]/a', tag: 'A', name: 'B' });
      const built = buildEpisodes({ interactions: [h.interaction, c1, c2] });
      return deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c1, c2], evidenceWindows: [h.evidence] });
    };
    const a = build();
    const b = build();
    expect(a.provenanceLinks).toEqual(b.provenanceLinks);
    expect(a.provenanceLinks.length).toBe(2);
    // Order follows CER-5 episode order (producer episode order, then
    // consumer T0) — here both links share the producer, consumers ordered.
    expect(a.provenanceLinks[0].targetEpisodeId).toBe('ep-int-c6a');
    expect(a.provenanceLinks[1].targetEpisodeId).toBe('ep-int-c6b');
  });

  it('cross-tab: a matching click on ANOTHER tab does NOT link (tab compatibility)', () => {
    const h = admittedHoverWithWindow('int-h7', T, 'ev-e7', [{ path: 'body > div > div#mega-products', ariaRole: null, name: 'F' }]);
    (h.interaction.triggerEvent as { captureOrigin?: { tabId: number } }).captureOrigin = { tabId: 1 };
    const otherTab = clickOn('int-c7', T + 3000, { cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", stableId: 'mega-products', tag: 'DIV' });
    (otherTab.triggerEvent as { captureOrigin?: { tabId: number } }).captureOrigin = { tabId: 99 };

    const built = buildEpisodes({ interactions: [h.interaction, otherTab] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, otherTab], evidenceWindows: [h.evidence] });
    expect(graph.provenanceLinks.length).toBe(0);
  });

  it('attribute-driven REVEAL fact (aria-expanded flip on targetPath) also joins (B-3 parity with deriveConsequenceClasses)', () => {
    const triggerEvent = evt({ eventType: 'mouseenter', timestamp: T });
    const interaction = {
      interactionId: 'int-h8',
      type: 'Hover',
      triggerEvent,
      trigger: { tag: 'BUTTON', accessibleName: 'Products', cssSelector: '#nav-products', xPath: "//button[@id='nav-products']", stableId: 'nav-products' },
      memberEvents: [triggerEvent],
      startTime: T, endTime: T + 1000, endState: 'completed',
      metadata: { targetName: 'Products', terminal: 'left', consequenceClasses: ['reveal'], meaningful: true },
      behavioralEvidence: {
        sourceEventId: triggerEvent.eventId,
        windowId: 'ev-e8',
        window: { openedAt: 0, closedAt: 1000, durationMs: 1000, endReason: 'consequence-settled' },
        applicationEvidence: {
          domChanges: [
            {
              types: ['attributes'] as never, targetPath: 'body > div > div#mega-products', targetTag: 'DIV',
              shadowContext: null, changedAttributes: ['aria-expanded'],
              attributeDeltas: { 'aria-expanded': { old: 'false', new: 'true' } },
              addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
              firstMutationAt: 30, lastMutationAt: 30, rawMutationCount: 1,
              firstBatchIndex: 1, lastBatchIndex: 1,
            },
          ],
          domChangeOverflow: 0, newSurfaces: [], removedSurfaces: [], visibilityChanges: [], navigation: [], networkActivity: [],
        },
      },
    } as unknown as EpisodeBuilderInteraction;
    const evidence: GraphInteractionEvidence = {
      interactionId: 'int-h8',
      evidence: {
        windowId: 'ev-e8', sourceEventId: triggerEvent.eventId, openedAt: 0,
        domChangeCount: 1, domChangeOverflow: 0, newSurfaces: [], removedSurfaces: [],
        visibilityChanges: 0, navigation: [], synthesized: false, endReason: 'consequence-settled',
      },
      windowOpenedEpochMs: T, windowClosedEpochMs: T + 1000,
    };
    const c = clickOn('int-c8', T + 3000, { cssSelector: 'div#mega-products > a', xPath: '//div[@id="mega-products"]/a', tag: 'A', name: 'Laptops' });

    const built = buildEpisodes({ interactions: [interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [interaction, c], evidenceWindows: [evidence] });
    expect(graph.provenanceLinks.length).toBe(1);
  });

  it('NO tag-only single-FACT join: a 1-segment fact path never links (floor)', () => {
    // Fact path `div` (one segment) — even against a matching consumer
    // chain, a single tag proves nothing.
    const h = admittedHoverWithWindow('int-h9', T, 'ev-e9', [{ path: 'div', ariaRole: null, name: 'F' }]);
    const c = clickOn('int-c9', T + 3000, { cssSelector: 'div', xPath: '/html/body/div/div', tag: 'DIV', name: 'X' });

    const built = buildEpisodes({ interactions: [h.interaction, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h.interaction, c], evidenceWindows: [h.evidence] });
    expect(graph.provenanceLinks.length).toBe(0);
  });
});
