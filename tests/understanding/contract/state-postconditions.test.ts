/**
 * Phase 4b — Observed Post-Conditions via the Contract Read-Side
 *
 * Read-side projection tests: observedStateChanges on ActionDescriptor
 * (classification, counter-id generalization + grouping, raw fallback),
 * stateChanges on ActionContextBlock (bounded lines + '+N more'),
 * reconstructWorkflow step enrichment (transition-row join, honest
 * absence typing), and the E1 chain with listBehaviorSessions.
 *
 * Invariants pinned: no scannedAt anywhere in contract surfaces;
 * consequences array unchanged (single-source projection).
 *
 * Architecture: .drytis/specs/resulting-application-state-plan.md Phase 4b
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { KnowledgeDatabase } from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '../../../src/understanding/consolidation/knowledge-loader';
import { mapBehaviorModel } from '../../../src/understanding/persistence/behavior-knowledge-mapper';
import {
  getActionDescriptor,
  listActions,
  listBehaviorSessions,
  reconstructWorkflow,
  describeActionAsContext,
} from '../../../src/understanding/contract/contract-queries';
import type { AppBehaviorModel } from '../../../src/understanding/behavior-model/model-types';
import type { StateTransition } from '../../../src/understanding/state-builder/types';
import type { KnowledgeStateTransitionRow } from '../../../src/understanding/persistence/knowledge-types';

const APP = 'app-p4b';

// ── Fixture: one episode (Add to Cart click) with state/entity edges ──

function makeModel(): AppBehaviorModel {
  return {
    id: 'abm-p4b',
    sessionId: 'session-1',
    generatedAtMs: 1000,
    coverage: {
      totalInteractions: 2, anchoredInteractions: 1, memberInteractions: 0,
      attributedNetworkRows: 1, attributedObservations: 1, totalNetworkRows: 1,
      totalObservations: 1, malformedInteractions: 0, provenanceLinks: 0,
      unattributedConsequences: 0,
    },
    warnings: [],
    provenanceLinks: [],
    episodes: [
      {
        id: 'ep-int-9',
        anchor: { interactionId: 'int-9', actionType: 'Click', actionTarget: 'Add to Cart', triggerTimestamp: 100 },
        members: [{ interactionId: 'int-9', role: 'anchor' }],
        parameterInputs: [],
        horizon: {
          attribution: { openedAtMs: 100, closedAtMs: 100, closeReason: 'all-stamped-settled', pendingRequestIds: [] },
          uiOwnership: { openedAtMs: 100, closedAtMs: 100, closeReason: 'stabilized' },
        },
        edges: [
          {
            id: 'edge-a',
            kind: 'api',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'api', requestId: 'r1' },
            detail: 'POST https://shop.example/cart/add initiated during ep-int-9',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'request', requestId: 'r1' }],
          },
          {
            id: 'edge-b',
            kind: 'state',
            tier: 'T3-transition',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'state', from: 'cart=3', to: 'cart=4' },
            detail: 'counter cart 3 → 4',
            confidence: 0.7,
            latencyMs: null,
            evidenceRefs: [{ kind: 'state-transition', transitionId: 'st-9' }],
          },
          {
            id: 'edge-c',
            kind: 'state',
            tier: 'T3-transition',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'state', from: 'search-results', to: 'cart' },
            detail: 'view search-results → cart',
            confidence: 0.7,
            latencyMs: null,
            evidenceRefs: [{ kind: 'state-transition', transitionId: 'st-10' }],
          },
          {
            id: 'edge-d',
            kind: 'entity',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'entity', entityId: 'cart-item:B0VAL1', operation: 'create' },
            detail: 'entity cart-item:B0VAL1 (cart-item) created from API',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'entity', entityId: 'cart-item:B0VAL1', interactionId: 'int-9' }],
          },
          {
            id: 'edge-e',
            kind: 'notification',
            tier: 'T3-transition',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'ui', summary: 'notification: Item added to cart' },
            detail: 'notification "Item added to cart" (info) appeared',
            confidence: 0.7,
            latencyMs: null,
            evidenceRefs: [{ kind: 'event', eventId: 'n-1' }],
          },
        ],
        episodeOutcome: {
          outcome: 'success', confidence: 0.95, confidenceLevel: 'confirmed',
          derivation: 'derived-episode-outcome', contributingMembers: ['int-9'],
        },
        tabId: 1,
        unattributed: [],
      },
    ],
    unattributed: [],
  } as unknown as AppBehaviorModel;
}

function transitionsFor(): StateTransition[] {
  const view = (id: string) => ({ id, label: id, confidence: 0.8, detectedFrom: 'url-pattern' });
  return [
    {
      interactionId: 'int-9',
      before: { currentView: view('search-results'), currentUrl: 'https://shop.example/product.html', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-8', interactionCount: 8 },
      after: { currentView: view('cart'), currentUrl: 'https://shop.example/cart.html', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-9', interactionCount: 9 },
      changes: [
        'page-content entity: cart-item:B0VAL1',
        'page-content counter: DIV#cart-count = 4',
        'page-content collection: UL[data-testid=cart-items] = 4 items',
        'page-content notification: "Item added to cart"',
        'counter: 3 → 4',
      ],
    },
  ] as unknown as StateTransition[];
}

function transitionRow(overrides: Partial<KnowledgeStateTransitionRow> = {}): KnowledgeStateTransitionRow {
  return {
    key: `session-1:int-9`,
    appId: APP,
    sessionId: 'session-1',
    interactionId: 'int-9',
    changes: ['counter cart 3 → 4', 'cart-item entity (from API, productId=B0VAL1)'],
    affectedEntities: ['cart-item:B0VAL1'],
    fromViewId: 'search-results',
    toViewId: 'cart',
    timestamp: 1000,
    ...overrides,
  };
}

describe('Phase 4b — observed post-conditions (read-side)', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;
  let loader: KnowledgeLoader;

  beforeEach(async () => {
    db = new KnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
    loader = new KnowledgeLoader(repo);
    const mapped = mapBehaviorModel({ appId: APP, sessionId: 'session-1', model: makeModel(), transitions: transitionsFor() });
    await repo.upsertBehaviorKnowledge(mapped, 1000);
    await repo.upsertApplication({
      appId: APP,
      origin: 'https://shop.example',
      label: 'shop.example',
      firstSeenAt: 1000,
      lastActiveAt: 1000,
      sessionCount: 1,
      lastSessionId: 'session-1',
    });
  });

  afterEach(async () => {
    await db.delete();
  });

  const atcKey = async (): Promise<string> => {
    const actions = await listActions(repo, loader, APP);
    return actions.find((a) => a.normalizedTarget === 'add to cart')!.signatureKey;
  };

  it('AC1: counter edge projects to counter-delta with generalized id and value pair', async () => {
    const d = await getActionDescriptor(repo, loader, await atcKey());
    const counter = d!.observedStateChanges.find((sc) => sc.changeKind === 'counter-delta')!;
    expect(counter).toBeDefined();
    expect(counter.identity).toBe('cart');
    expect(counter.valueChange).toBe('3→4');
    expect(counter.hitCount).toBe(1);
    expect(counter.observedVia).toBeTruthy();
  });

  it('AC2: entity/notification/view edges classify to their kinds', async () => {
    const d = await getActionDescriptor(repo, loader, await atcKey());
    const kinds = d!.observedStateChanges.map((sc) => sc.changeKind).sort();
    expect(kinds).toEqual(['counter-delta', 'entity-created', 'notification', 'view-change']);
    const entity = d!.observedStateChanges.find((sc) => sc.changeKind === 'entity-created')!;
    expect(entity.identity).toBe('cart-item:create');
    // Notification edges persist to.type 'ui' → targetIdentity 'anchor-window'
    // (window-level granularity — the persisted ceiling). The notification
    // TEXT lives in the edge detail, resolvable via the evidence deep-link.
    const notif = d!.observedStateChanges.find((sc) => sc.changeKind === 'notification')!;
    expect(notif.identity).toBe('anchor-window');
    const view = d!.observedStateChanges.find((sc) => sc.changeKind === 'view-change')!;
    expect(view.identity).toBe('search-results→cart');
  });

  it('AC3: unknown state format falls back to state-other + raw identity (never dropped)', async () => {
    // Inject a state identity that matches NEITHER regex: contains '='
    // (blocks view-change) and fails the counter grammar ('x=1→y' has no
    // second '=' segment) → honest degradation to state-other.
    const model2 = makeModel();
    model2.episodes[0]!.anchor.triggerTimestamp = 200;
    (model2.episodes[0]!.edges[2] as { to: Record<string, unknown> }).to = {
      type: 'state',
      from: 'x=1',
      to: 'y',
    };
    const mapped2 = mapBehaviorModel({ appId: APP, sessionId: 'session-2', model: model2, transitions: transitionsFor() });
    await repo.upsertBehaviorKnowledge(mapped2, 2000);

    const d = await getActionDescriptor(repo, loader, await atcKey());
    const other = d!.observedStateChanges.find((sc) => sc.changeKind === 'state-other');
    expect(other).toBeDefined();
    expect(other!.identity).toBe('x=1→y');           // raw passthrough
    expect(other!.valueChange).toBeNull();           // no invented pair
    // Nothing dropped: the fixture's canonical entries all survive.
    const all = d!.observedStateChanges.map((sc) => sc.identity);
    expect(all).toContain('cart');
    expect(all).toContain('cart-item:create');
  });

  it('AC4: grouping — value-bearing counter variants merge into one entry with accumulated counts', async () => {
    // Session 2: same counter, different values (0→1).
    const model2 = makeModel();
    model2.episodes[0]!.anchor.triggerTimestamp = 300;
    (model2.episodes[0]!.edges[1] as { to: Record<string, unknown> }).to = {
      type: 'state',
      from: 'cart=0',
      to: 'cart=1',
    };
    const mapped2 = mapBehaviorModel({ appId: APP, sessionId: 'session-2', model: model2, transitions: transitionsFor() });
    await repo.upsertBehaviorKnowledge(mapped2, 2000);

    const d = await getActionDescriptor(repo, loader, await atcKey());
    const counters = d!.observedStateChanges.filter((sc) => sc.changeKind === 'counter-delta' && sc.identity === 'cart');
    expect(counters).toHaveLength(1); // 3→4 and 0→1 merged
    expect(counters[0]!.hitCount).toBe(2); // one hit per session
    expect(counters[0]!.occurrenceCount).toBe(2);
    // valueChange keeps the LAST-observed pair. Session ids are
    // 'session-1' < 'session-2' (equal-length producers), so the
    // session-2 pair (0→1) wins. Non-vacuous: '3→4' would fail.
    expect(counters[0]!.valueChange).toBe('0→1');
  });

  it('AC5: describeActionAsContext renders bounded state-change lines (+N more when >8)', async () => {
    const ctx = await describeActionAsContext(repo, loader, await atcKey());
    expect(ctx!.stateChanges).toHaveLength(4); // 4 projected entries
    expect(ctx!.stateChanges.some((l) => l.startsWith('counter-delta cart'))).toBe(true);
    expect(ctx!.stateChanges.some((l) => l.includes('(last 3→4)'))).toBe(true);

    // >8 entries case: seed 8 more distinct entity types across sessions.
    for (let i = 1; i <= 9; i++) {
      const m = makeModel();
      m.episodes[0]!.anchor.triggerTimestamp = 400 + i;
      (m.episodes[0]!.edges[3] as { to: Record<string, unknown> }).to = {
        type: 'entity',
        entityId: `widget-type-${i}:W${i}`,
        operation: 'create',
      };
      const mapped = mapBehaviorModel({ appId: APP, sessionId: `session-e${i}`, model: m, transitions: transitionsFor() });
      await repo.upsertBehaviorKnowledge(mapped, 3000 + i);
    }
    const ctx2 = await describeActionAsContext(repo, loader, await atcKey());
    expect(ctx2!.stateChanges.length).toBe(9); // 8 lines + '+N more'
    expect(ctx2!.stateChanges[8]).toMatch(/^\+\d+ more$/);
  });

  it('AC6: reconstructWorkflow steps join transition rows with honest absence typing', async () => {
    // Row NOT yet seeded → rows-not-retained
    let trace = await reconstructWorkflow(repo, APP, 'session-1');
    expect(trace!.steps).toHaveLength(1);
    let step = trace!.steps[0]!;
    expect(step.interactionId).toBe('int-9');
    expect(step.stateChanges).toEqual([]);
    expect(step.affectedEntities).toEqual([]);
    expect(step.fromViewId).toBeNull();
    expect(step.stateChangeAbsence).toBe('rows-not-retained');

    // Seed the row → observed (changes present)
    await repo.addStateTransition(transitionRow());
    trace = await reconstructWorkflow(repo, APP, 'session-1');
    step = trace!.steps[0]!;
    expect(step.stateChanges).toEqual(transitionRow().changes);
    expect(step.affectedEntities).toEqual(['cart-item:B0VAL1']);
    expect(step.fromViewId).toBe('search-results');
    expect(step.toViewId).toBe('cart');
    expect(step.stateChangeAbsence).toBe('observed');

    // Row with empty changes → observed-none
    await repo.addStateTransition(transitionRow({ changes: [] }));
    trace = await reconstructWorkflow(repo, APP, 'session-1');
    step = trace!.steps[0]!;
    expect(step.stateChangeAbsence).toBe('observed-none');
  });

  it('AC7: E1 chain — listBehaviorSessions → reconstructWorkflow → getAction per step', async () => {
    await repo.addStateTransition(transitionRow());
    const sessions = await listBehaviorSessions(repo, APP);
    expect(sessions).toEqual(['session-1']);
    for (const sid of sessions) {
      const trace = await reconstructWorkflow(repo, APP, sid);
      expect(trace).not.toBeNull();
      for (const step of trace!.steps) {
        const d = await getActionDescriptor(repo, loader, step.signatureKey);
        expect(d).not.toBeNull();
        expect(Array.isArray(d!.observedStateChanges)).toBe(true);
      }
    }
  });

  it('AC8: no scannedAt anywhere in contract surfaces (S4 guard)', async () => {
    const d = await getActionDescriptor(repo, loader, await atcKey());
    const serialized = JSON.stringify(d);
    expect(serialized.includes('scannedAt')).toBe(false);
    const ctx = await describeActionAsContext(repo, loader, await atcKey());
    expect(JSON.stringify(ctx).includes('scannedAt')).toBe(false);
  });

  it('AC9: consequences array unchanged — single-source projection, api/nav excluded from stateChanges', async () => {
    const d = await getActionDescriptor(repo, loader, await atcKey());
    // api + nav consequences stay in consequences (2), state kinds projected (3... entity+counter+view+notification = 4)
    expect(d!.consequences.length).toBe(5); // api, state(2), entity, notification
    const projectedKinds = d!.observedStateChanges.map((sc) => sc.changeKind);
    expect(projectedKinds).not.toContain('api');
    // view-change IS projected from a state edge; navigation edges excluded
    expect(d!.observedStateChanges).toHaveLength(4);
  });
});
