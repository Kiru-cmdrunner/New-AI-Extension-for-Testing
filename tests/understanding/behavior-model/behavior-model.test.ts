/**
 * CP4 — workflow fixtures through the full pipeline.
 *
 * The Amazon reference workflow (Search → Product → Add to Cart → API →
 * Entity → Navigation → UI consequence) modeled with realistic synthetic
 * artifacts shaped exactly like the captured originals, run through
 * deriveBehaviorModel, asserting the approved canonical graph.
 *
 * Plus interruption/concurrency cases and pipeline-level invariants
 * (determinism, input immutability, coverage honesty).
 */
import { describe, expect, it } from 'vitest';
import { deriveBehaviorModel } from '../../../src/understanding/behavior-model/behavior-model';
import type { EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';
import type { GraphInteractionEvidence, GraphNetworkRow } from '../../../src/understanding/behavior-model/causal-graph';
import type { ActionOutcome, OutcomeEvidence } from '../../../src/understanding/outcome/outcome-types';
import type { StateTransition } from '../../../src/understanding/state-builder/types';

const T = 1_700_000_000_000; // realistic epoch base
let seq = 0;

/** Reset the shared fixture counter so `amazonWorkflow()` builds byte-identical
 *  artifacts on every invocation — required for the same-input-twice
 *  determinism test (module-level `seq` alone is NOT stable across calls). */
function resetFixtures(): void {
  seq = 0;
}

// ── fixture builders (shaped like real captured artifacts) ──────────────

function fixture(
  id: string,
  type: string,
  over: {
    eventType: string;
    t: number;
    tabId?: number;
    pageId?: string;
    end?: number;
    trigger?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): EpisodeBuilderInteraction {
  seq += 1;
  const pageId = over.pageId ?? 'p1';
  return {
    interactionId: id,
    type: type as EpisodeBuilderInteraction['type'],
    triggerEvent: {
      eventId: `evt-${pageId}-${seq}`,
      eventType: over.eventType,
      timestamp: over.t,
      captureSeq: seq,
      captureOrigin: { tabId: over.tabId ?? 7, frameId: 0 },
      pageId,
    },
    trigger: over.trigger ?? { tag: 'INPUT', accessibleName: id },
    memberEvents: [],
    startTime: over.t,
    endTime: over.end ?? over.t + 100,
    endState: 'completed',
    metadata: over.metadata ?? {},
  } as unknown as EpisodeBuilderInteraction;
}

function state(last: string | null, count = 1) {
  return {
    currentView: null,
    currentUrl: null,
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: last,
    interactionCount: count,
  };
}

function outcomeOf(id: string, votes: OutcomeEvidence[]): ActionOutcome {
  return {
    interactionId: id,
    actionType: 'Click',
    actionTarget: id,
    outcome: votes.some((v) => v.result === 'failure') ? 'failure' : 'success',
    confidence: 0.9,
    confidenceLevel: 'likely',
    supportingEvidence: votes,
    resultingEntities: [],
    stateChanges: [],
  };
}

function windowFor(interactionId: string, open: number, close: number, over: Partial<GraphInteractionEvidence['evidence']> = {}): GraphInteractionEvidence {
  return {
    interactionId,
    windowOpenedEpochMs: open,
    windowClosedEpochMs: close,
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

// ═══ Amazon reference workflow ═════════════════════════════════════════

/**
 * Canonical fixture (values mirror the real int-18/19/20 Amazon run):
 *   int-18 TextEntry 'Search' (parameter of the search click)
 *   int-19 Click 'Add to Cart' (anchor; T₀ = T+10_000)
 *   int-20 Navigation to /cart (member of ep-int-19)
 *   POST /cart/add stamped to int-19's trigger (T1)
 *   cart-item:B0FFF9VPMN created from the API (T1 entity)
 *   view product→cart + 'Added to cart' notification + counter +1 (T3, carried by int-20)
 *   product-page churn window on int-19 (T4 0.6) + destination window (T4, capped-window)
 *   unstamped telemetry rows (unattributed context)
 */
function amazonWorkflow() {
  resetFixtures();
  const search = fixture('int-18', 'TextEntry', {
    eventType: 'input',
    t: T + 9_000,
    end: T + 9_500,
    pageId: 'p1',
    trigger: { tag: 'INPUT', accessibleName: 'Search' },
    metadata: { targetName: 'Search', textValue: 'lamp' },
  });
  // search click anchor (keyDown on the search box triggers submit) — using a
  // click on the search button as the anchor that owns the search episode.
  const searchGo = fixture('int-19a', 'Click', {
    eventType: 'click',
    t: T + 9_600,
    end: T + 9_700,
    trigger: { tag: 'BUTTON', accessibleName: 'Go' },
  });
  const addClick = fixture('int-19', 'Click', {
    eventType: 'click',
    t: T + 10_000,
    end: T + 10_190,
    trigger: { tag: 'INPUT', inputType: 'submit', accessibleName: 'Add to Cart' },
    metadata: { targetName: 'Add to Cart' },
  });
  const nav = fixture('int-20', 'Navigation', {
    eventType: 'navigation',
    t: T + 10_300,
    end: T + 10_350,
    pageId: 'p2',
    trigger: { tag: 'HTML', accessibleName: 'https://amazon.in/cart/add-to-cart' },
  });

  const addTrigger = addClick.triggerEvent as { eventId: string };
  const rows: GraphNetworkRow[] = [
    // The cart POST — stamped at request start to the add-to-cart click.
    {
      requestId: 'req-9001',
      sourceEventId: addTrigger.eventId,
      url: 'https://amazon.in/cart/add-to-cart',
      method: 'POST',
      status: 200,
    },
    // Unstamped telemetry (no sourceEventId) — must never claim.
    { requestId: 'req-t1', url: '/telemetry', method: 'GET', status: 204 },
    { requestId: 'req-t2', url: '/beacon', method: 'POST', status: 204 },
  ];

  const t19 = {
    interactionId: 'int-19',
    before: state(null, 0),
    after: state('int-19'),
    changes: ['cart-item entity (from API, productId=B0FFF9VPMN)'],
  } as StateTransition;
  (t19.after as { entities: Map<string, unknown> }).entities.set('cart-item:B0FFF9VPMN', {
    id: 'cart-item:B0FFF9VPMN',
    type: 'cart-item',
    attributes: { productId: 'B0FFF9VPMN', quantity: '1' },
    source: 'inferred',
    firstSeenAt: 'int-19',
    lastUpdated: 'int-19',
  });

  const t20 = {
    interactionId: 'int-20',
    before: state(null, 1),
    after: state('int-20', 2),
    changes: ['view product → cart', 'counter cart-count 0 → 1'],
  } as StateTransition;
  (t20.after as { currentView: unknown }).currentView = { id: 'cart' };
  (t20.after as { notifications: unknown[] }).notifications = [
    { id: 'notif-1', text: 'Added to cart', severity: 'success', elementPath: '/div', appearedAt: 'int-20', disappearedAt: null },
  ];
  (t20.after as { counters: Map<string, unknown> }).counters.set('cart-count', {
    id: 'cart-count',
    label: 'Cart',
    elementPath: '/span',
    values: [{ value: '1', interactionId: 'int-20', delta: 1 }],
  });

  const outcomes: ActionOutcome[] = [
    outcomeOf('int-19', [
      { kind: 'api-operation', result: 'success', weight: 0.4, detail: 'POST /cart/add 200', interactionId: 'int-19' },
    ]),
    outcomeOf('int-20', [
      { kind: 'view-change', result: 'success', weight: 0.25, detail: 'view → cart', interactionId: 'int-20' },
      { kind: 'notification', result: 'success', weight: 0.3, detail: 'Added to cart', interactionId: 'int-20' },
    ]),
  ];

  const windows: GraphInteractionEvidence[] = [
    // product-page churn captured on the click window
    windowFor('int-19', T + 10_010, T + 10_190),
    // destination churn inside the nav member's settling horizon (capped)
    windowFor('int-20', T + 10_400, T + 13_300, { domChangeOverflow: 176 }),
  ];

  const navEventId = (nav.triggerEvent as { eventId: string }).eventId;

  return {
    interactions: [search, searchGo, addClick, nav],
    networkRows: rows,
    stateTransitions: [t19, t20],
    // CP4 contract: outcomes are keyed pairs, not bare ActionOutcomes.
    actionOutcomes: outcomes.map((outcome) => ({
      interactionId: outcome.interactionId,
      outcome,
    })),
    evidenceWindows: windows,
    postNavRecords: [
      { navEventId, committedAt: T + 10_265, fromUrl: 'https://amazon.in/dp/B0FFF9VPMN', toUrl: 'https://amazon.in/cart/add-to-cart' },
    ],
  };
}

describe('Amazon reference workflow (CP4 canonical)', () => {
  it('derives the approved canonical episode graph', () => {
    const w = amazonWorkflow();
    const { model } = deriveBehaviorModel({
      ...w,
      sessionId: 'sess-amz',
      generatedAtMs: T + 60_000,
    });

    expect(model.id).toBe('abm-sess-amz');
    // Anchors: search Go click + Add to Cart click.
    expect(model.episodes.map((e) => e.id)).toEqual(['ep-int-19a', 'ep-int-19']);

    const search = model.episodes[0];
    const atc = model.episodes[1];

    // Search episode: parameter-linked text entry.
    expect(search.parameterInputs.map((p) => p.interactionId)).toEqual(['int-18']);

    // Add-to-cart episode membership.
    expect(atc.members.map((m) => `${m.interactionId}:${m.role}`)).toEqual([
      'int-19:anchor',
      'int-20:navigation',
    ]);

    // Edges — exact canonical set.
    const byKind = (k: string) => atc.edges.filter((e) => e.kind === k);
    expect(byKind('api').map((e) => (e.to as { requestId: string }).requestId)).toEqual(['req-9001']);
    expect(byKind('navigation')).toHaveLength(1);
    expect(byKind('navigation')[0]).toMatchObject({
      from: { episodeId: 'ep-int-19', interactionId: 'int-20' },
      tier: 'T2-lineage',
      latencyMs: 265,
    });
    expect(byKind('entity')).toHaveLength(1);
    expect(byKind('entity')[0]).toMatchObject({
      tier: 'T1-stamp',
      from: { interactionId: 'int-19' },
      to: { type: 'entity', entityId: 'cart-item:B0FFF9VPMN', operation: 'create' },
    });
    // One transition artifact (st-int-20) backs view AND counter facts —
    // the view edge claims the ref first, the counter edge is skipped by
    // ref-uniqueness (CP3 pinned behavior; see causal-graph.test.ts
    // 'the same transition ref can never be owned twice').
    expect(byKind('state').map((e) => e.to)).toEqual([
      { type: 'state', from: '(none)', to: 'cart' },
    ]);
    expect(
      model.warnings.some((w) => w.code === 'ref-conflict-skipped'),
    ).toBe(true);
    expect(byKind('notification')).toHaveLength(1);

    // T4 windows: product churn (clean) + destination churn (capped).
    const ui = byKind('ui');
    expect(ui).toHaveLength(2);
    const dest = ui.find((e) => e.from.interactionId === 'int-20')!;
    expect(dest.evidenceRefs[0]?.degradation).toEqual(['capped-window']);

    // Every edge owned by the Add-to-cart episode (the Amazon law).
    for (const edge of atc.edges) expect(edge.from.episodeId).toBe('ep-int-19');

    // Episode outcome: raw merge = 0.4 + 0.25 + 0.3 = 0.95, but the
    // destination evidence window overflowed (domChangeOverflow 176) →
    // DDC-5 halves it to 0.475 (inconclusive). Degraded windows must not
    // masquerade as clean ones.
    expect(atc.episodeOutcome).toMatchObject({
      outcome: 'success',
      confidence: 0.475,
      confidenceLevel: 'inconclusive',
      contributingMembers: ['int-19', 'int-20'],
    });

    // Coverage honesty. memberInteractions counts NON-anchor members only
    // (anchors already counted by anchoredInteractions).
    expect(model.coverage).toMatchObject({
      totalInteractions: 4,
      anchoredInteractions: 2,
      memberInteractions: 2,
      totalNetworkRows: 3,
      attributedNetworkRows: 1,
      totalObservations: 2,
      attributedObservations: 2,
      unattributedConsequences: 0,
      provenanceLinks: 0,
    });

    // Unstamped telemetry never claimed.
    const allRefs = model.episodes.flatMap((e) => e.edges.flatMap((x) => x.evidenceRefs));
    expect(allRefs.some((r) => r.kind === 'request' && r.requestId.startsWith('req-t'))).toBe(false);
  });

  it('original interaction records keep their own evidence (no re-attribution)', () => {
    const w = amazonWorkflow();
    const snapshot = JSON.stringify(
      w.interactions.map((i) => [i.interactionId, i.triggerEvent?.eventId]),
    );
    deriveBehaviorModel({ ...w, sessionId: 's', generatedAtMs: 0 });
    expect(JSON.stringify(w.interactions.map((i) => [i.interactionId, i.triggerEvent?.eventId]))).toBe(snapshot);
  });});

// ═══ Interruption / concurrency ════════════════════════════════════════

describe('interruption & concurrency workflows', () => {
  it('user clicks again while the cart POST is in flight: the POST still owns ep-A', () => {
    const a = fixture('int-1', 'Click', { eventType: 'click', t: T, trigger: { tag: 'BUTTON', accessibleName: 'Add' } });
    const b = fixture('int-2', 'Click', { eventType: 'click', t: T + 500, trigger: { tag: 'A', accessibleName: 'Next' } });
    const evA = a.triggerEvent as { eventId: string };
    const { model } = deriveBehaviorModel({
      interactions: [a, b],
      networkRows: [{ requestId: 'req-1', sourceEventId: evA.eventId, status: null }],
      sessionId: 's',
      generatedAtMs: T + 10_000,
    });
    const apiEdges = model.episodes.flatMap((e) => e.edges.filter((x) => x.kind === 'api'));
    expect(apiEdges).toHaveLength(1);
    expect(apiEdges[0].from.episodeId).toBe('ep-int-1');
  });

  it('two concurrent actions with two stamped rows: each episode keeps its own', () => {
    const a = fixture('int-1', 'Click', { eventType: 'click', t: T, trigger: { tag: 'BUTTON', accessibleName: 'A' } });
    const b = fixture('int-2', 'Click', { eventType: 'click', t: T + 50, trigger: { tag: 'BUTTON', accessibleName: 'B' } });
    const evA = a.triggerEvent as { eventId: string };
    const evB = b.triggerEvent as { eventId: string };
    const { model } = deriveBehaviorModel({
      interactions: [a, b],
      networkRows: [
        { requestId: 'req-a', sourceEventId: evA.eventId, status: 200 },
        { requestId: 'req-b', sourceEventId: evB.eventId, status: 200 },
      ],
      sessionId: 's',
      generatedAtMs: T + 10_000,
    });
    const epA = model.episodes.find((e) => e.id === 'ep-int-1')!;
    const epB = model.episodes.find((e) => e.id === 'ep-int-2')!;
    expect(epA.edges.filter((e) => e.kind === 'api').length).toBe(1);
    expect(epB.edges.filter((e) => e.kind === 'api').length).toBe(1);
  });

  it('evidence arriving long after every horizon → unattributed, never guessed', () => {
    const a = fixture('int-1', 'Click', { eventType: 'click', t: T, trigger: { tag: 'BUTTON', accessibleName: 'A' } });
    const { model } = deriveBehaviorModel({
      interactions: [a],
      evidenceWindows: [windowFor('int-9', T + 120_000, T + 120_100)],
      sessionId: 's',
      generatedAtMs: T + 200_000,
    });
    expect(model.unattributed).toHaveLength(1);
    expect(model.episodes[0].edges).toHaveLength(0);
  });

  it('malformed interaction inside the anchor horizon is retained as a degraded member (R4)', () => {
    // Malformed record WITH tabId inside ep-int-1's horizon: startTime T+100
    // sits between the anchor T₀ (T) and the next-anchor bound (none) →
    // retained as unclassified member by interval containment.
    const broken = {
      interactionId: 'int-broken',
      type: 'Click',
      triggerEvent: undefined,
      memberEvents: [],
      startTime: T + 100,
      endTime: T + 200,
      endState: 'completed',
      metadata: { captureOrigin: { tabId: 7, frameId: 0 } },
    } as unknown as EpisodeBuilderInteraction;
    const a = fixture('int-1', 'Click', { eventType: 'click', t: T, trigger: { tag: 'BUTTON', accessibleName: 'A' } });
    const { model, unownedInteractionIds } = deriveBehaviorModel({
      interactions: [broken, a],
      sessionId: 's',
      generatedAtMs: T + 20_000,
    });
    expect(model.episodes.map((e) => e.id)).toEqual(['ep-int-1']);
    expect(
      model.warnings.some((w) => w.code === 'malformed-member-retained' && w.refs.includes('int-broken')),
    ).toBe(true);
    // Retained as a member where the horizon contains it — NOT unowned.
    expect(model.episodes[0].members.map((m) => m.interactionId)).toContain('int-broken');
    expect(unownedInteractionIds).not.toContain('int-broken');
  });
});

// ═══ Pipeline invariants ═══════════════════════════════════════════════

describe('pipeline invariants', () => {
  it('deterministic: two independently-built fixtures → deep-equal models', () => {
    // Two SEPARATE amazonWorkflow() builds (not one object derived twice)
    // so the check also covers fixture-builder stability AND rules out
    // self-masking via input mutation between runs.
    const first = deriveBehaviorModel({ ...amazonWorkflow(), sessionId: 's', generatedAtMs: 42 });
    const second = deriveBehaviorModel({ ...amazonWorkflow(), sessionId: 's', generatedAtMs: 42 });
    expect(first).toEqual(second);
  });

  it('input immutability: interactions/rows/transitions unchanged', () => {
    const w = amazonWorkflow();
    // Map-aware serializer: plain JSON.stringify renders Maps as {} and
    // would miss mutations inside stateTransitions' entities/counters.
    const deep = (v: unknown) =>
      JSON.stringify(v, (_k, val) => (val instanceof Map ? { __map: [...val.entries()] } : val));
    const snap = deep([w.interactions, w.networkRows, w.stateTransitions, w.evidenceWindows]);
    deriveBehaviorModel({ ...w, sessionId: 's', generatedAtMs: 42 });
    expect(deep([w.interactions, w.networkRows, w.stateTransitions, w.evidenceWindows])).toBe(snap);
  });

  it('empty session → empty model with zeroed coverage', () => {
    const { model } = deriveBehaviorModel({ interactions: [], sessionId: 's', generatedAtMs: 1 });
    expect(model.episodes).toEqual([]);
    expect(model.coverage.totalInteractions).toBe(0);
    expect(model.warnings).toEqual([]);
  });

  it('actionOutcomes absent → episodeOutcome stays null, never invented', () => {
    const a = fixture('int-1', 'Click', { eventType: 'click', t: T, trigger: { tag: 'BUTTON', accessibleName: 'A' } });
    const { model } = deriveBehaviorModel({ interactions: [a], sessionId: 's', generatedAtMs: 1 });
    expect(model.episodes[0].episodeOutcome).toBeNull();
  });
});
