/**
 * CP8 — Knowledge Consumer Contract v1 — QUERY TESTS
 *
 * Correctness of every contract query over a real (fake-indexeddb)
 * database seeded through the production persistence path:
 * mapBehaviorModel → repo.upsertBehaviorKnowledge — the exact rows any
 * real consumer would read.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { KnowledgeDatabase } from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '../../../src/understanding/consolidation/knowledge-loader';
import { mapBehaviorModel } from '../../../src/understanding/persistence/behavior-knowledge-mapper';
import {
  getApiSurface,
  getActionDescriptor,
  getConsequenceEvidence,
  getEntitySummary,
  getGapReport,
  getNavigationGraph,
  getStateGraph,
  listActions,
  listApplications,
  reconstructWorkflow,
  describeApplication,
  describeActionAsContext,
} from '../../../src/understanding/contract/contract-queries';
import type { AppBehaviorModel } from '../../../src/understanding/behavior-model/model-types';
import type { StateTransition } from '../../../src/understanding/state-builder/types';

const APP = 'app-cp8';

// ── Fixture: one session, two episodes (Go/search → Add to Cart) ──────

function makeModel(): AppBehaviorModel {
  return {
    id: 'abm-cp8',
    sessionId: 'session-1',
    generatedAtMs: 1000,
    coverage: {
      totalInteractions: 4, anchoredInteractions: 2, memberInteractions: 0,
      attributedNetworkRows: 2, attributedObservations: 2, totalNetworkRows: 2,
      totalObservations: 2, malformedInteractions: 0, provenanceLinks: 0,
      unattributedConsequences: 0,
    },
    warnings: [],
    provenanceLinks: [],
    episodes: [
      {
        id: 'ep-int-5',
        anchor: { interactionId: 'int-5', actionType: 'Click', actionTarget: 'Go', triggerTimestamp: 100 },
        members: [{ interactionId: 'int-5', role: 'anchor' }],
        parameterInputs: [
          { interactionId: 'int-5', label: 'Search', value: 'headphones', link: 'direct' },
        ],
        horizon: {
          attribution: { openedAtMs: 100, closedAtMs: 100, closeReason: 'all-stamped-settled', pendingRequestIds: [] },
          uiOwnership: { openedAtMs: 100, closedAtMs: 100, closeReason: 'stabilized' },
        },
        edges: [
          {
            id: 'edge-000',
            kind: 'api',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-5', interactionId: 'int-5' },
            to: { type: 'api', requestId: 'r1' },
            detail: 'GET https://shop.example/product.html?k=headphones initiated during ep-int-5',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'request', requestId: 'r1' }],
          },
        ],
        episodeOutcome: {
          outcome: 'success', confidence: 0.9, confidenceLevel: 'confirmed',
          derivation: 'derived-episode-outcome', contributingMembers: ['int-5'],
        },
        tabId: 1,
        unattributed: [],
      },
      {
        id: 'ep-int-8',
        anchor: { interactionId: 'int-8', actionType: 'Click', actionTarget: 'Add to Cart', triggerTimestamp: 200 },
        members: [{ interactionId: 'int-8', role: 'anchor' }],
        parameterInputs: [],
        horizon: {
          attribution: { openedAtMs: 200, closedAtMs: 200, closeReason: 'all-stamped-settled', pendingRequestIds: [] },
          uiOwnership: { openedAtMs: 200, closedAtMs: 200, closeReason: 'stabilized' },
        },
        edges: [
          {
            id: 'edge-001',
            kind: 'api',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-8', interactionId: 'int-8' },
            to: { type: 'api', requestId: 'r2' },
            detail: 'POST https://shop.example/cart/add initiated during ep-int-8',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'request', requestId: 'r2' }],
          },
          {
            id: 'edge-002',
            kind: 'navigation',
            tier: 'T2-lineage',
            from: { episodeId: 'ep-int-8', interactionId: 'int-8' },
            to: { type: 'navigation', navEventId: 'nav-1', toUrl: 'https://shop.example/cart.html' },
            detail: 'navigation committed to https://shop.example/cart.html',
            confidence: 0.85,
            latencyMs: null,
            evidenceRefs: [{ kind: 'navigation', navEventId: 'nav-1' }],
          },
          {
            id: 'edge-003',
            kind: 'state',
            tier: 'T3-transition',
            from: { episodeId: 'ep-int-8', interactionId: 'int-8' },
            to: { type: 'state', from: 'search-results', to: 'cart' },
            detail: 'view search-results → cart',
            confidence: 0.7,
            latencyMs: null,
            evidenceRefs: [{ kind: 'state-transition', transitionId: 'st-1' }],
          },
          {
            id: 'edge-004',
            kind: 'entity',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-8', interactionId: 'int-8' },
            to: { type: 'entity', entityId: 'cart-item:B0FFF9VPMN', operation: 'create' },
            detail: 'entity cart-item:B0FFF9VPMN (cart-item) created from API',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'entity', entityId: 'cart-item:B0FFF9VPMN', interactionId: 'int-8' }],
          },
        ],
        episodeOutcome: {
          outcome: 'success', confidence: 0.95, confidenceLevel: 'confirmed',
          derivation: 'derived-episode-outcome', contributingMembers: ['int-8'],
        },
        tabId: 1,
        unattributed: [],
      },
    ],
    unattributed: [
      {
        id: 'gap-001',
        observedKind: 'api',
        reason: 'no-live-horizon',
        detail: 'pre-recording request',
        observedAtMs: 150,
        windowRef: { kind: 'request', requestId: 'r0' },
        tabId: 1,
      },
    ],
  } as unknown as AppBehaviorModel;
}

function transitionsFor(): StateTransition[] {
  const view = (id: string) => ({
    id, label: id, confidence: 0.8, detectedFrom: 'url-pattern',
  });
  return [
    {
      interactionId: 'int-5',
      before: { currentView: view('search-results'), currentUrl: 'https://shop.example/', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-4', interactionCount: 4 },
      after: { currentView: view('product'), currentUrl: 'https://shop.example/product.html', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-5', interactionCount: 5 },
      changes: [],
    },
    {
      interactionId: 'int-8',
      before: { currentView: view('search-results'), currentUrl: 'https://shop.example/product.html', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-7', interactionCount: 7 },
      after: { currentView: view('cart'), currentUrl: 'https://shop.example/cart.html', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-8', interactionCount: 8 },
      changes: [],
    },
  ] as unknown as StateTransition[];
}

describe('CP8 contract queries', () => {
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
    // The application row the contract's app discovery reads.
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

  it('describeApplication + listApplications return app meta with behavior counts', async () => {
    const d = await describeApplication(repo, loader, APP);
    expect(d).not.toBeNull();
    expect(d!.appId).toBe(APP);
    expect(d!.origin).toBe('https://shop.example');
    expect(d!.behaviorVersion).toBe(1);
    expect(d!.signatureCount).toBeGreaterThanOrEqual(2);
    expect(d!.retainedSessionCount).toBe(1);
    expect(d!.gapTotal).toBe(1);
    expect(d!.capabilities.dbGroundTruth).toBe('unavailable');

    const apps = await listApplications(repo, loader);
    expect(apps).toHaveLength(1);
    expect(apps[0].appId).toBe(APP);
  });

  it('listActions returns deterministic descriptors with typed absence', async () => {
    const actions = await listActions(repo, loader, APP);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    const keys1 = actions.map((a) => a.signatureKey);
    const actions2 = await listActions(repo, loader, APP);
    expect(actions2.map((a) => a.signatureKey)).toEqual(keys1);

    for (const a of actions) {
      expect(a.selector.value).toBeNull();
      expect(a.selector.reason).toBe('capture-ceiling');
      // D6: fixture seeds no workflow rows → typed absence 'none-recorded'.
      expect(a.workflowPatternIds).toEqual([]);
      expect(a.workflowPatternAbsence).toBe('none-recorded');
    }
    const go = actions.find((a) => a.normalizedTarget === 'go');
    expect(go).toBeTruthy();
    expect(go!.parameterInputs).toEqual([
      { interactionId: 'int-5', label: 'Search', value: 'headphones', link: 'direct' },
    ]);
    // filter: actionType
    const clicks = await listActions(repo, loader, APP, { actionType: 'Click' });
    expect(clicks.length).toBe(actions.length); // all fixtures are Clicks
  });

  it('getActionDescriptor returns the full consequence profile with evidence', async () => {
    const actions = await listActions(repo, loader, APP);
    const atc = actions.find((a) => a.normalizedTarget === 'add to cart');
    expect(atc).toBeTruthy();
    const full = await getActionDescriptor(repo, loader, atc!.signatureKey);
    expect(full).toBeTruthy();
    const kinds = full!.consequences.map((c) => `${c.kind}:${c.targetIdentity}`).sort();
    expect(kinds).toContain('api:POST /cart/add');
    expect(kinds).toContain('navigation:to:/cart.html');
    expect(kinds).toContain('state:search-results→cart');
    expect(kinds).toContain('entity:cart-item:create');
    for (const c of full!.consequences) {
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.evidenceSamples.length).toBeGreaterThan(0);
      expect(c.evidenceSamples[0].resolvable).toBe(true);
    }
    expect(full!.status).toBe('active');
    expect(full!.occurrenceCount).toBe(1);
  });

  it('getConsequenceEvidence deep-links to the verbatim edge; ghost degrades to null', async () => {
    const actions = await listActions(repo, loader, APP);
    const atc = actions.find((a) => a.normalizedTarget === 'add to cart')!;
    const full = await getActionDescriptor(repo, loader, atc.signatureKey);
    const apiCons = full!.consequences.find((c) => c.targetIdentity.includes('cart/add'))!;
    const ev = await getConsequenceEvidence(repo, apiCons.evidenceSamples[0]);
    expect(ev).not.toBeNull();
    expect(ev!.resolvable).toBe(true);
    expect(ev!.detail).toContain('POST');
    expect(ev!.detail).toContain('/cart/add');
    expect(ev!.refJson).toContain('r2');
    expect(ev!.fromEpisodeId).toBe('ep-int-8');

    const ghost = await getConsequenceEvidence(repo, {
      sessionId: 'evicted-session',
      edgeKey: `${APP}:evicted-session:edge-999`,
    });
    expect(ghost).toBeNull();
  });

  it('reconstructWorkflow returns CER-5 ordered steps with edges and gaps', async () => {
    const trace = await reconstructWorkflow(repo, APP, 'session-1');
    expect(trace).not.toBeNull();
    expect(trace!.steps.map((s) => s.episodeId)).toEqual(['ep-int-5', 'ep-int-8']);
    expect(trace!.steps[1].edges.map((e) => e.edgeId)).toEqual([
      'edge-001', 'edge-002', 'edge-003', 'edge-004',
    ]);
    expect(trace!.steps[0].parameterInputs[0].value).toBe('headphones');
    expect(trace!.gaps).toHaveLength(1);
    expect(trace!.gaps[0].reason).toBe('no-live-horizon');
    expect(trace!.seq).toBe(1);
  });

  it('aggregations: api surface, entities, navigation, state graphs', async () => {
    const api = await getApiSurface(repo, loader, APP);
    // Frozen grammar keeps the query string in the generalized path.
    expect(api.map((a) => a.identity).sort()).toEqual([
      'GET /product.html?k=headphones',
      'POST /cart/add',
    ]);
    expect(api.every((a) => a.payloadSchema === 'unrecorded')).toBe(true);
    expect(api.every((a) => a.sessionCount === 1)).toBe(true);
    expect(api.find((a) => a.identity === 'POST /cart/add')!.method).toBe('POST');

    const entities = await getEntitySummary(repo, loader, APP);
    expect(entities.map((e) => e.identity)).toEqual(['cart-item:create']);

    const nav = await getNavigationGraph(repo, loader, APP);
    expect(nav.map((n) => n.to)).toEqual(['/cart.html']);

    const state = await getStateGraph(repo, loader, APP);
    expect(state.map((s) => `${s.from}→${s.to}`)).toEqual(['search-results→cart']);
  });

  it('gap report aggregates by reason with recent entries', async () => {
    const report = await getGapReport(repo, APP);
    expect(report.total).toBe(1);
    expect(report.byReason).toEqual([{ reason: 'no-live-horizon', count: 1 }]);
    expect(report.recent[0].gapId).toBe('gap-001');
  });

  it('describeActionAsContext produces the LLM grounding block', async () => {
    const actions = await listActions(repo, loader, APP);
    const atc = actions.find((a) => a.normalizedTarget === 'add to cart')!;
    const ctx = await describeActionAsContext(repo, loader, atc.signatureKey);
    expect(ctx).not.toBeNull();
    expect(ctx!.action).toContain('add to cart');
    expect(ctx!.observed.length).toBe(4);
    expect(ctx!.provenance.signatureKey).toBe(atc.signatureKey);
    expect(ctx!.observed.every((o) => o.confidence > 0)).toBe(true);
  });

  it('unknown app: queries return empty/null, never throw', async () => {
    expect(await describeApplication(repo, loader, 'app-none')).toBeNull();
    expect(await listActions(repo, loader, 'app-none')).toEqual([]);
    expect(await getApiSurface(repo, loader, 'app-none')).toEqual([]);
    expect(await getEntitySummary(repo, loader, 'app-none')).toEqual([]);
    expect(await getNavigationGraph(repo, loader, 'app-none')).toEqual([]);
    expect(await getStateGraph(repo, loader, 'app-none')).toEqual([]);
    expect(await getGapReport(repo, 'app-none')).toEqual({
      total: 0, byReason: [], recent: [],
    });
    expect(await reconstructWorkflow(repo, 'app-none', 's-none')).toBeNull();
    expect(await getActionDescriptor(repo, loader, 'no-such-key')).toBeNull();
  });

  // ── D6: workflow linkage in descriptors ────────────────────────────────

  it('D6: descriptor reports linked patterns sorted; honest absence otherwise; deterministic; stores untouched', async () => {
    // Grab the two fixture signatures ('go' and 'add to cart').
    const actions = await listActions(repo, loader, APP);
    const go = actions.find((a) => a.normalizedTarget === 'go')!;
    const cart = actions.find((a) => a.normalizedTarget === 'add to cart')!;

    // Baseline BEFORE any workflow rows: 'none-recorded'.
    const before = await getActionDescriptor(repo, loader, go.signatureKey);
    expect(before!.workflowPatternIds).toEqual([]);
    expect(before!.workflowPatternAbsence).toBe('none-recorded');

    // Seed a workflow row linked to BOTH signatures (linked set), and a
    // second pattern linked to neither (pending), via the repository.
    await repo.upsertRecordedWorkflow({
      key: `${APP}:wf-pattern-aaaa1111`,
      appId: APP,
      patternId: 'wf-pattern-aaaa1111',
      label: 'Search + add to cart',
      canonicalSteps: ['go', 'add to cart'],
      viewSequence: ['search-results', 'cart'],
      sessionIds: ['session-1'],
      occurrenceCount: 2,
      instances: ['wf-session-1-0', 'wf-session-1-1'],
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      signatureIds: [cart.signatureKey, go.signatureKey],
      linkageState: 'linked',
      instanceSignatureIds: {
        'wf-session-1-0': [go.signatureKey],
        'wf-session-1-1': [cart.signatureKey],
      },
    });
    await repo.upsertRecordedWorkflow({
      key: `${APP}:wf-pattern-bbbb2222`,
      appId: APP,
      patternId: 'wf-pattern-bbbb2222',
      label: 'Text-only flow',
      canonicalSteps: ['type query'],
      viewSequence: ['search-results'],
      sessionIds: ['session-1'],
      occurrenceCount: 1,
      instances: ['wf-session-1-2'],
      firstSeenAt: 1000,
      lastSeenAt: 2000,
    });

    // Linked signature → sorted pattern ids.
    const goAfter = await getActionDescriptor(repo, loader, go.signatureKey);
    expect(goAfter!.workflowPatternIds).toEqual(['wf-pattern-aaaa1111']);
    expect(goAfter!.workflowPatternAbsence).toBe('linked');

    // Multi-pattern: second row now links 'go' too → both ids, sorted.
    await repo.upsertRecordedWorkflow({
      key: `${APP}:wf-pattern-00000000`,
      appId: APP,
      patternId: 'wf-pattern-00000000',
      label: 'Go again',
      canonicalSteps: ['go'],
      viewSequence: ['search-results'],
      sessionIds: ['session-1'],
      occurrenceCount: 1,
      instances: ['wf-session-1-3'],
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      signatureIds: [go.signatureKey],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-session-1-3': [go.signatureKey] },
    });
    const goMulti = await getActionDescriptor(repo, loader, go.signatureKey);
    expect(goMulti!.workflowPatternIds).toEqual(
      ['wf-pattern-00000000', 'wf-pattern-aaaa1111'].sort(),
    );

    // Determinism: repeated reads identical.
    const again = await getActionDescriptor(repo, loader, go.signatureKey);
    expect(again!.workflowPatternIds).toEqual(goMulti!.workflowPatternIds);

    // Read-only: signature rows unchanged by descriptor reads (fixture
    // seeds one session → 'go' occ=1; reads must not bump any count).
    const sigsAfter = await repo.getSignatures(APP);
    const goAfterReads = sigsAfter.find((s) => s.key === go.signatureKey)!;
    const cartAfterReads = sigsAfter.find((s) => s.key === cart.signatureKey)!;
    expect(goAfterReads.occurrenceCount).toBe(1);
    expect(goAfterReads.consequenceProfile.length).toBeGreaterThan(0);
    expect(cartAfterReads.occurrenceCount).toBe(1);
    const wfRows = await repo.getRecordedWorkflows(APP);
    expect(wfRows).toHaveLength(3);
    const linked = wfRows.find((r) => r.patternId === 'wf-pattern-aaaa1111')!;
    expect(linked.signatureIds).toEqual([cart.signatureKey, go.signatureKey].sort());
    expect(linked.instanceSignatureIds).toEqual({
      'wf-session-1-0': [go.signatureKey],
      'wf-session-1-1': [cart.signatureKey],
    });

    // Honest absence: the pending pattern's session-only flow → the 'type
    // query' signature doesn't exist, but a descriptor for an UNLINKED
    // signature must report 'linkage-pending' (rows exist, none co-occur).
    // 'add to cart' currently links only aaaa1111 → still 'linked'.
    const cartAfter = await getActionDescriptor(repo, loader, cart.signatureKey);
    expect(cartAfter!.workflowPatternIds).toEqual(['wf-pattern-aaaa1111']);
    expect(cartAfter!.workflowPatternAbsence).toBe('linked');

    // A signature linked by NO row: seed one directly via the table
    // (signatures are normally written only through upsertBehaviorKnowledge;
    // this row is a read-model fixture for the contract, test-only).
    await (repo as unknown as { db: { knowledgeSignatures: { put: (r: unknown) => Promise<string> } } })
      .db.knowledgeSignatures.put({
        key: `${APP}:sig:unlinked`,
        appId: APP,
        actionType: 'Click',
        normalizedTarget: 'unlinked target',
        anchorViewId: null,
        firstSeenAtSession: 'session-1',
        lastSeenAtSession: 'session-1',
        firstSeenSeq: 1,
        lastSeenSeq: 1,
        firstSeenAtMs: 1000,
        lastSeenAtMs: 1000,
        occurrenceCount: 1,
        sessionsSinceSeen: 0,
        status: 'active',
        source: 'behavior',
        consequenceProfile: [],
        divergenceFlags: [],
      });
    const unlinked = await getActionDescriptor(repo, loader, `${APP}:sig:unlinked`);
    expect(unlinked!.workflowPatternIds).toEqual([]);
    expect(unlinked!.workflowPatternAbsence).toBe('linkage-pending');
  });
});
