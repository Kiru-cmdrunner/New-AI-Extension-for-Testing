/**
 * CP3 unit tests — causal-graph.ts
 *
 * Tier rules (T1–T4), split-horizon ownership, latest-anchor-wins with the
 * 0.5 cap + corroboration uplift, ref uniqueness (no dual ownership),
 * unattributed-never-guessed, and the eight interruption cases from the
 * approved architecture.
 *
 * Fixtures reuse CP2's builder so episodes/horizons are derived by the
 * real CP2 code, then causal-graph runs on top.
 */
import { describe, expect, it } from 'vitest';
import { buildEpisodes } from '../../../src/understanding/behavior-model/episode-builder';
import {
  deriveCausalGraph,
  POST_ANCHOR_CAP,
  TIER_CONFIDENCE_FLOORS,
  type CausalGraphInput,
  type GraphInteractionEvidence,
  type GraphNetworkRow,
} from '../../../src/understanding/behavior-model/causal-graph';
import type { EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';

import type { StateTransition } from '../../../src/understanding/state-builder/types';

// ── shared fixture base ─────────────────────────────────────────────────

const T = 1_000_000;
let seq = 0;

function click(id: string, t0: number, tabId = 7, tag = 'INPUT', inputType = 'submit'): EpisodeBuilderInteraction {
  seq += 1;
  return {
    interactionId: id,
    type: 'Click',
    triggerEvent: {
      eventId: `evt-p1-${seq}`,
      eventType: 'click',
      timestamp: t0,
      captureSeq: seq,
      captureOrigin: { tabId, frameId: 0 },
      pageId: 'p1',
    },
    trigger: { tag, inputType, accessibleName: id },
    memberEvents: [],
    startTime: t0,
    endTime: t0 + 190,
    endState: 'completed',
    metadata: { targetName: id },
  } as unknown as EpisodeBuilderInteraction;
}

function nav(id: string, commitT: number, tabId = 7, pageId = 'p2'): EpisodeBuilderInteraction {
  seq += 1;
  return {
    interactionId: id,
    type: 'Navigation',
    triggerEvent: {
      eventId: `nav-${commitT}`,
      eventType: 'navigation',
      timestamp: commitT,
      captureSeq: seq,
      captureOrigin: { tabId, frameId: 0 },
      pageId,
    },
    trigger: { tag: 'HTML', accessibleName: 'https://shop/cart' },
    memberEvents: [],
    startTime: commitT,
    endTime: commitT + 50,
    endState: 'completed',
    metadata: { pageUrl: 'https://shop/cart' },
  } as unknown as EpisodeBuilderInteraction;
}

function emptyState(lastInteractionId: string | null, interactionCount = 1) {
  return {
    currentView: null,
    currentUrl: null,
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId,
    interactionCount,
  };
}

function transition(interactionId: string, mutate: (after: ReturnType<typeof emptyState>) => void): StateTransition {
  const after = emptyState(interactionId);
  mutate(after);
  return { interactionId, before: emptyState(null, 0), after, changes: [] };
}

function evidence(
  interactionId: string,
  openedEpoch: number,
  closedEpoch: number,
  over: Partial<GraphInteractionEvidence['evidence']> = {},
): GraphInteractionEvidence {
  return {
    interactionId,
    windowOpenedEpochMs: openedEpoch,
    windowClosedEpochMs: closedEpoch,
    evidence: {
      windowId: `bev-${interactionId}`,
      sourceEventId: `src-${interactionId}`,
      openedAt: 0,
      domChangeCount: 2,
      domChangeOverflow: 0,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: 0,
      navigation: [],
      ...over,
    },
  };
}

/** Build episodes via the real CP2 builder, then run CP3 on top. */
function pipeline(interactions: EpisodeBuilderInteraction[], extra: Partial<CausalGraphInput> = {}) {
  const built = buildEpisodes({ interactions, networkRows: extra.networkRows, postNavRecords: extra.postNavRecords });
  const graph = deriveCausalGraph({
    episodes: built.episodes,
    interactions,
    networkRows: extra.networkRows,
    postNavRecords: extra.postNavRecords,
    stateTransitions: extra.stateTransitions,
    evidenceWindows: extra.evidenceWindows,
  });
  return { built, graph };
}

// ── T1 ──────────────────────────────────────────────────────────────────

describe('T1 — initiation-stamped API edges', () => {
  it('a stamped row emits a T1 edge to the stamping episode at floor 0.9', () => {
    const c = click('int-1', T);
    const ev = c.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-9001', sourceEventId: ev.eventId, url: '/cart/add', method: 'POST', status: 200 },
    ];
    const { graph } = pipeline([c], { networkRows: rows });
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'api');
    expect(edge).toMatchObject({
      tier: 'T1-stamp',
      confidence: TIER_CONFIDENCE_FLOORS['T1-stamp'],
      from: { episodeId: 'ep-int-1', interactionId: 'int-1' },
      to: { type: 'api', requestId: 'req-9001' },
    });
  });

  it('unstamped rows never produce T1 edges (unattributed remains empty but no guess)', () => {
    const c = click('int-1', T);
    const rows: GraphNetworkRow[] = [{ requestId: 'req-x', status: null }];
    const { graph } = pipeline([c], { networkRows: rows });
    expect(graph.episodes[0].edges.filter((e) => e.kind === 'api')).toHaveLength(0);
    expect(graph.unattributed).toHaveLength(0);
  });

  it('multiple stamped rows sort deterministically by requestId', () => {
    const c = click('int-1', T);
    const ev = c.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-9', sourceEventId: ev.eventId, status: 200 },
      { requestId: 'req-10', sourceEventId: ev.eventId, status: 200 },
      { requestId: 'req-2', sourceEventId: ev.eventId, status: 200 },
    ];
    const { graph } = pipeline([c], { networkRows: rows });
    expect(graph.episodes[0].edges.map((e) => e.to.type === 'api' ? e.to.requestId : null)).toEqual([
      'req-10',
      'req-2',
      'req-9',
    ]);
  });
});

// ── T2 ──────────────────────────────────────────────────────────────────

describe('T2 — navigation lineage', () => {
  it('navigation member emits a T2 edge owned by the episode, carried by the nav interaction', () => {
    const c = click('int-1', T);
    const n = nav('int-nav', T + 300);
    const { graph } = pipeline([c, n]);
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'navigation');
    expect(edge).toMatchObject({
      tier: 'T2-lineage',
      confidence: TIER_CONFIDENCE_FLOORS['T2-lineage'],
      from: { episodeId: 'ep-int-1', interactionId: 'int-nav' },
    });
    expect(edge?.to).toMatchObject({ type: 'navigation', navEventId: 'nav-1000300' });
    expect(edge?.evidenceRefs[0]).toMatchObject({ kind: 'nav', navEventId: 'nav-1000300' });
  });

  it('latency = committedAt − anchor T₀ when postNavRecords provided', () => {
    const c = click('int-1', T);
    const n = nav('int-nav', T + 300);
    const { graph } = pipeline([c, n], {
      postNavRecords: [{ navEventId: 'nav-1000300', committedAt: T + 265, fromUrl: '/p', toUrl: '/cart' }],
    });
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'navigation');
    expect(edge?.latencyMs).toBe(265);
  });

  it('no url resolvable → missing-window degradation', () => {
    const c = click('int-1', T);
    const n = nav('int-nav', T + 300);
    (n.triggerEvent as { pageUrl?: string }).pageUrl = undefined;
    const { graph } = pipeline([c, n]);
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'navigation');
    expect(edge?.evidenceRefs[0]?.degradation).toEqual(['missing-window']);
  });
});

// ── T3 ──────────────────────────────────────────────────────────────────

describe('T3 — transitions', () => {
  it('view change emits a state edge citing the transition ref', () => {
    const c = click('int-1', T);
    const t = transition('int-1', (after) => {
      after.currentView = { id: 'cart' } as never;
    });
    const { graph } = pipeline([c], { stateTransitions: [t] });
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'state');
    expect(edge).toMatchObject({
      tier: 'T3-transition',
      to: { type: 'state', from: '(none)', to: 'cart' },
    });
    expect(edge?.evidenceRefs[0]).toMatchObject({ kind: 'transition', transitionId: 'st-int-1' });
  });

  it('new entity emits an entity edge; API-derived upgrades to T1', () => {
    const c = click('int-1', T);
    const ev = c.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-9001', sourceEventId: ev.eventId, url: '/cart/add', method: 'POST', status: 200 },
    ];
    const t = transition('int-1', (after) => {
      after.entities.set('cart-item:B0FFF9VPMN', {
        id: 'cart-item:B0FFF9VPMN',
        type: 'cart-item',
        attributes: { productId: 'B0FFF9VPMN' },
        source: 'inferred',
        firstSeenAt: 'int-1',
        lastUpdated: 'int-1',
      } as never);
    });
    t.changes.push('cart-item entity (from API, productId=B0FFF9VPMN)');
    const { graph } = pipeline([c], { networkRows: rows, stateTransitions: [t] });
    const entityEdge = graph.episodes[0].edges.find((e) => e.kind === 'entity');
    expect(entityEdge?.tier).toBe('T1-stamp');
    expect(entityEdge?.to).toMatchObject({
      type: 'entity',
      entityId: 'cart-item:B0FFF9VPMN',
      operation: 'create',
    });
    expect(entityEdge?.evidenceRefs[0]).toMatchObject({
      kind: 'entity',
      entityId: 'cart-item:B0FFF9VPMN',
      interactionId: 'int-1',
    });
  });

  it('DOM-only entity stays T3 at 0.7', () => {
    const c = click('int-1', T);
    const t = transition('int-1', (after) => {
      after.entities.set('product-1', {
        id: 'product-1',
        type: 'product',
        attributes: {},
        source: 'dom',
        firstSeenAt: 'int-1',
        lastUpdated: 'int-1',
      } as never);
    });
    const { graph } = pipeline([c], { stateTransitions: [t] });
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'entity');
    expect(edge?.tier).toBe('T3-transition');
    expect(edge?.confidence).toBe(0.7);
  });

  it('notification appearing at the carrier emits a notification edge citing its event id', () => {
    const c = click('int-1', T);
    const t = transition('int-1', (after) => {
      after.notifications.push({
        id: 'notif-1',
        text: 'Added to cart',
        severity: 'success',
        elementPath: '/div[2]',
        appearedAt: 'int-1',
        disappearedAt: null,
      } as never);
    });
    const { graph } = pipeline([c], { stateTransitions: [t] });
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'notification');
    expect(edge?.tier).toBe('T3-transition');
    expect(edge?.evidenceRefs[0]).toMatchObject({ kind: 'event', eventId: 'notif-1' });
  });

  it('counter delta emits a state edge; zero/first observation does not', () => {
    const c = click('int-1', T);
    const t = transition('int-1', (after) => {
      after.counters.set('cart-count', {
        id: 'cart-count',
        label: 'Cart',
        elementPath: '/span',
        values: [
          { value: '0', interactionId: 'int-0', delta: null },
          { value: '1', interactionId: 'int-1', delta: 1 },
        ],
      } as never);
    });
    const { graph } = pipeline([c], { stateTransitions: [t] });
    const edges = graph.episodes[0].edges.filter((e) => e.kind === 'state');
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toMatchObject({ from: 'cart-count=0', to: 'cart-count=1' });
  });
});

// ── T4 ──────────────────────────────────────────────────────────────────

describe('T4 — evidence windows', () => {
  it('window inside the anchor horizon emits a T4 ui edge at floor 0.6', () => {
    const c = click('int-1', T); // horizon T..T+190
    const { graph } = pipeline([c], { evidenceWindows: [evidence('int-1', T + 10, T + 150)] });
    const edge = graph.episodes[0].edges.find((e) => e.kind === 'ui');
    expect(edge).toMatchObject({
      tier: 'T4-window',
      confidence: 0.6,
      from: { interactionId: 'int-1' },
    });
    expect(edge?.evidenceRefs[0]).toMatchObject({ kind: 'dom', windowId: 'bev-int-1', sequence: 0 });
  });

  it('window with overflow gets capped-window degradation', () => {
    const c = click('int-1', T);
    const { graph } = pipeline([c], {
      evidenceWindows: [evidence('int-1', T + 10, T + 150, { domChangeOverflow: 176 })],
    });
    expect(graph.episodes[0].edges[0]?.evidenceRefs[0]?.degradation).toEqual(['capped-window']);
  });

  it('synthesized evidence gets synthesized-evidence degradation', () => {
    const c = click('int-1', T);
    const { graph } = pipeline([c], {
      evidenceWindows: [evidence('int-1', T + 10, T + 150, { synthesized: true })],
    });
    expect(graph.episodes[0].edges[0]?.evidenceRefs[0]?.degradation).toEqual(['synthesized-evidence']);
  });

  it('window outside every horizon → unattributed (no-live-horizon), never guessed', () => {
    const c = click('int-1', T); // horizon T..T+190
    const { graph } = pipeline([c], { evidenceWindows: [evidence('int-9', T + 5_000, T + 5_100)] });
    expect(graph.episodes[0].edges.filter((e) => e.kind === 'ui')).toHaveLength(0);
    expect(graph.unattributed).toHaveLength(1);
    expect(graph.unattributed[0]).toMatchObject({
      observedKind: 'ui',
      reason: 'no-live-horizon',
      observedAtMs: T + 5_000,
    });
  });

  it('post-anchor window claimed by the LATER episode at the 0.5 cap', () => {
    const a = click('int-1', T); // anchor A
    const b = click('int-2', T + 500); // anchor B
    // Window on int-2's carrier opens at T+600 — after A's anchor, inside
    // B's horizon (B: T+500..T+690).
    const { graph } = pipeline([a, b], {
      evidenceWindows: [evidence('int-2', T + 600, T + 680)],
    });
    const t4 = graph.episodes.find((e) => e.id === 'ep-int-2')!.edges.find((e) => e.kind === 'ui');
    expect(t4?.confidence).toBe(POST_ANCHOR_CAP);
    expect(t4?.from.episodeId).toBe('ep-int-2');
  });

  it('post-anchor cap lifted when a T1 api edge corroborates the same carrier', () => {
    const a = click('int-1', T);
    const b = click('int-2', T + 500);
    const evB = b.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-1', sourceEventId: evB.eventId, status: 200 },
    ];
    const { graph } = pipeline([a, b], {
      networkRows: rows,
      evidenceWindows: [evidence('int-2', T + 600, T + 680)],
    });
    const t4 = graph.episodes.find((e) => e.id === 'ep-int-2')!.edges.find((e) => e.kind === 'ui');
    expect(t4?.confidence).toBe(TIER_CONFIDENCE_FLOORS['T4-window']);
  });

  it('tabs never cross-claim windows', () => {
    const a = click('int-1', T, 7);
    const b = click('int-2', T + 500, 9);
    const { graph } = pipeline([a, b], {
      evidenceWindows: [evidence('int-2', T + 600, T + 680)],
    });
    const t4 = graph.episodes.find((e) => e.id === 'ep-int-2')!.edges.find((e) => e.kind === 'ui');
    expect(t4?.from.episodeId).toBe('ep-int-2');
  });
});

// ── ref uniqueness / no dual ownership ──────────────────────────────────

describe('ref uniqueness', () => {
  it('the same transition ref can never be owned twice', () => {
    const c = click('int-1', T);
    const t1 = transition('int-1', (after) => {
      after.currentView = { id: 'cart' } as never;
      after.counters.set('cart-count', {
        id: 'cart-count',
        label: 'Cart',
        elementPath: '/span',
        values: [{ value: '1', interactionId: 'int-1', delta: 1 }],
      } as never);
    });
    const { graph } = pipeline([c], { stateTransitions: [t1] });
    // view edge claims st-int-1 first; counter edge tries the same ref and
    // is skipped with a ref-conflict warning.
    const stateEdges = graph.episodes[0].edges.filter((e) => e.kind === 'state');
    expect(stateEdges).toHaveLength(1);
    expect(graph.warnings.some((w) => w.code === 'ref-conflict-skipped')).toBe(true);
  });

  it('claimedRefKeys is sorted and unique', () => {
    const c = click('int-1', T);
    const ev = c.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [{ requestId: 'req-1', sourceEventId: ev.eventId, status: 200 }];
    const { graph } = pipeline([c], { networkRows: rows });
    expect(graph.claimedRefKeys).toEqual(['request:req-1']);
  });
});

// ── the eight interruption/consequence cases (approved architecture) ────

describe('eight interruption cases', () => {
  it('case 1 — API starts before next anchor, completes after: T1 stays with the FIRST episode', () => {
    const a = click('int-1', T);
    const b = click('int-2', T + 500);
    const evA = a.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-1', sourceEventId: evA.eventId, status: 200 }, // completed late; stamp is A's
    ];
    const { graph } = pipeline([a, b], { networkRows: rows });
    const apiEdges = graph.episodes.flatMap((e) => e.edges.filter((x) => x.kind === 'api'));
    expect(apiEdges).toHaveLength(1);
    expect(apiEdges[0].from.episodeId).toBe('ep-int-1');
  });

  it('case 2 — UI mutation before/after next anchor: before → A (0.6); after → B (capped 0.5)', () => {
    const a = click('int-1', T); // ui T..T+190
    const b = click('int-2', T + 500); // ui T+500..T+690
    const { graph } = pipeline([a, b], {
      evidenceWindows: [evidence('int-1', T + 20, T + 100), evidence('int-2', T + 600, T + 680)],
    });
    const e1 = graph.episodes.find((e) => e.id === 'ep-int-1')!.edges.find((e) => e.kind === 'ui')!;
    const e2 = graph.episodes.find((e) => e.id === 'ep-int-2')!.edges.find((e) => e.kind === 'ui')!;
    expect(e1.confidence).toBe(0.6);
    expect(e2.confidence).toBe(POST_ANCHOR_CAP);
  });

  it('case 3 — navigation commit → destination render → next action: nav edge belongs to A; destination observations to the live episode', () => {
    const a = click('int-1', T);
    const n = nav('int-nav', T + 300); // member of A (latest live), effective end T+3350
    const b = click('int-2', T + 4_000); // next action after destination settles
    const { graph } = pipeline([a, n, b], {
      evidenceWindows: [evidence('int-nav', T + 400, T + 2_000)],
    });
    const navEdge = graph.episodes.find((e) => e.id === 'ep-int-1')!.edges.find((e) => e.kind === 'navigation');
    expect(navEdge).toBeDefined();
    const destT4 = graph.episodes.find((e) => e.id === 'ep-int-1')!.edges.find((e) => e.kind === 'ui');
    expect(destT4).toBeDefined();
    expect(destT4?.from.interactionId).toBe('int-nav');
  });

  it('case 4 — delayed notification after next anchor: owned by A only via T3 recorded at A\'s member; else unattributed', () => {
    const a = click('int-1', T);
    const b = click('int-2', T + 500);
    // Notification recorded by StateBuilder as appearing at int-1's window.
    const t = transition('int-1', (after) => {
      after.notifications.push({
        id: 'notif-late',
        text: 'Added to cart',
        severity: 'success',
        elementPath: '/div',
        appearedAt: 'int-1',
        disappearedAt: null,
      } as never);
    });
    const { graph } = pipeline([a, b], { stateTransitions: [t] });
    const notif = graph.episodes.find((e) => e.id === 'ep-int-1')!.edges.find((e) => e.kind === 'notification');
    expect(notif).toBeDefined();
  });

  it('case 5 — entity/state update after next anchor: request-derived → A (T1); DOM-only → follows observation rules', () => {
    const a = click('int-1', T);
    const b = click('int-2', T + 500);
    const evA = a.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-1', sourceEventId: evA.eventId, status: 200 },
    ];
    const t = transition('int-1', (after) => {
      after.entities.set('cart-item:X', {
        id: 'cart-item:X',
        type: 'cart-item',
        attributes: {},
        source: 'inferred',
        firstSeenAt: 'int-1',
        lastUpdated: 'int-1',
      } as never);
    });
    t.changes.push('cart-item entity (from API)');
    const { graph } = pipeline([a, b], { networkRows: rows, stateTransitions: [t] });
    const entityEdge = graph.episodes.find((e) => e.id === 'ep-int-1')!.edges.find((e) => e.kind === 'entity');
    expect(entityEdge?.tier).toBe('T1-stamp');
    expect(entityEdge?.from.episodeId).toBe('ep-int-1');
  });

  it('case 6 — multiple in-flight APIs from different actions: each stamps its own episode', () => {
    const a = click('int-1', T);
    const b = click('int-2', T + 500);
    const evA = a.triggerEvent as { eventId: string };
    const evB = b.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-a', sourceEventId: evA.eventId, status: null },
      { requestId: 'req-b', sourceEventId: evB.eventId, status: 200 },
    ];
    const { graph } = pipeline([a, b], { networkRows: rows });
    const epA = graph.episodes.find((e) => e.id === 'ep-int-1')!;
    const epB = graph.episodes.find((e) => e.id === 'ep-int-2')!;
    expect(epA.edges.filter((e) => e.kind === 'api').map((e) => (e.to as { requestId: string }).requestId)).toEqual(['req-a']);
    expect(epB.edges.filter((e) => e.kind === 'api').map((e) => (e.to as { requestId: string }).requestId)).toEqual(['req-b']);
  });

  it('case 7 — action on a surface created earlier: B owns its action; no provenance link is guessed', () => {
    const a = click('int-1', T);
    const b = click('int-2', T + 500);
    const { graph } = pipeline([a, b], {
      evidenceWindows: [evidence('int-1', T + 20, T + 100)],
    });
    expect(graph.provenanceLinks).toEqual([]);
    // B's own window is still claimed by B (latest-anchor-wins).
    const bUi = graph.episodes.find((e) => e.id === 'ep-int-2')!.edges;
    expect(bUi.filter((e) => e.kind === 'ui')).toHaveLength(0);
  });

  it('case 8 — consequence after every horizon closed: unattributed (outside-horizon shape)', () => {
    const a = click('int-1', T); // ui T..T+190
    const { graph } = pipeline([a], {
      evidenceWindows: [evidence('int-1', T + 50_000, T + 50_100)],
    });
    expect(graph.episodes[0].edges.filter((e) => e.kind === 'ui')).toHaveLength(0);
    expect(graph.unattributed).toHaveLength(1);
    expect(graph.unattributed[0].reason).toBe('no-live-horizon');
  });
});

// ── determinism ─────────────────────────────────────────────────────────

describe('determinism', () => {
  it('same input twice → identical output', () => {
    const c = click('int-1', T);
    const n = nav('int-nav', T + 300);
    const ev = c.triggerEvent as { eventId: string };
    const rows: GraphNetworkRow[] = [
      { requestId: 'req-1', sourceEventId: ev.eventId, status: 200 },
    ];
    const t = transition('int-1', (after) => {
      after.currentView = { id: 'cart' } as never;
    });
    const make = () =>
      pipeline([c, n], {
        networkRows: rows,
        stateTransitions: [t],
        evidenceWindows: [evidence('int-1', T + 10, T + 150)],
      });
    expect(make().graph).toEqual(make().graph);
  });

  it('input episodes are never mutated', () => {
    const c = click('int-1', T);
    const built = buildEpisodes({ interactions: [c] });
    const snapshot = JSON.stringify(built.episodes.map((e) => e.edges));
    deriveCausalGraph({ episodes: built.episodes, interactions: [c] });
    expect(JSON.stringify(built.episodes.map((e) => e.edges))).toBe(snapshot);
  });
});
