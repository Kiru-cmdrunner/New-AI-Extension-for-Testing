/**
 * CP6 — Behavior Knowledge Repository tests
 *
 * Covers (fake-indexeddb):
 * - v3 additive migration over a seeded v2 DB (v1/v2 rows preserved)
 * - Session idempotency: re-persist of the same session is a NO-OP
 * - Cross-session merge: same action in two sessions → ONE signature,
 *   occurrenceCount=2, merged consequence profile, both evidence samples
 * - Consequence identity generalization across sessions
 * - Divergence: recurring consequence absent 3 sessions → 'diverged' flag
 * - Stale: signature unseen > STALE_AFTER_SESSIONS → 'stale' at read time
 * - FIFO eviction with cascade (manifest+episodes+edges+gaps; signatures
 *   survive)
 * - Orphan sweep removes manifest-less rows
 * - deleteBySession cascades behavior rows; deleteByApp tears down all 5
 * - Loader read model: behaviorVersion, evidence-sample resolution, gaps
 *
 * Architecture: .drytis/specs/cp6-knowledge-repository.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { KnowledgeDatabase } from '../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '../../src/understanding/consolidation/knowledge-loader';
import { mapBehaviorModel } from '../../src/understanding/persistence/behavior-knowledge-mapper';
import {
  MAX_BEHAVIOR_SESSIONS_PER_APP,
  MAX_EVIDENCE_SAMPLES,
  DIVERGENCE_AFTER_SESSIONS,
  STALE_AFTER_SESSIONS,
  MAX_CONSEQUENCES_PER_SIGNATURE,
} from '../../src/understanding/persistence/knowledge-types';
import { boundConsequences } from '../../src/understanding/persistence/behavior-knowledge-merge';
import type { KnowledgeConsequence } from '../../src/understanding/persistence/knowledge-types';
import type { AppBehaviorModel } from '../../src/understanding/behavior-model/model-types';
import type { StateTransition } from '../../src/understanding/state-builder/types';

// ── Fixtures ───────────────────────────────────────────────────────────

const APP = 'app-cp6';

function makeModel(
  opts: { withCartApi?: boolean; id?: string } = {},
): AppBehaviorModel {
  const withCartApi = opts.withCartApi ?? true;
  const edges = withCartApi
    ? [
        {
          id: 'edge-1',
          kind: 'api',
          tier: 'T1-stamp',
          from: { episodeId: 'ep-1', interactionId: 'int-1' },
          to: { type: 'api', requestId: 'r1' },
          detail: 'POST http://shop.example.com/cart/add initiated during ep-1',
          confidence: 0.9,
          latencyMs: null,
          evidenceRefs: [{ kind: 'request', requestId: 'r1' }],
        },
      ]
    : [
        {
          id: 'edge-1',
          kind: 'ui',
          tier: 'T4-window',
          from: { episodeId: 'ep-1', interactionId: 'int-1' },
          to: { type: 'ui', windowId: 'w1' },
          detail: 'UI observations on int-1',
          confidence: 0.6,
          latencyMs: null,
          evidenceRefs: [{ kind: 'dom', windowId: 'w1', sequence: 0 }],
        },
      ];
  return {
    id: opts.id ?? 'abm-1',
    sessionId: 'placeholder',
    generatedAtMs: 1000,
    coverage: {
      totalInteractions: 3, anchoredInteractions: 1, memberInteractions: 0,
      attributedNetworkRows: 1, attributedObservations: 1, totalNetworkRows: 1,
      totalObservations: 1, malformedInteractions: 0, provenanceLinks: 0,
      unattributedConsequences: 0,
    },
    warnings: [],
    provenanceLinks: [],
    episodes: [
      {
        id: 'ep-1',
        anchor: { interactionId: 'int-1', actionType: 'Click', actionTarget: 'Add to Cart', triggerTimestamp: 100 },
        members: [{ interactionId: 'int-1', role: 'anchor' }],
        parameterInputs: [],
        horizon: {
          attribution: { openedAtMs: 100, closedAtMs: 100, closeReason: 'all-stamped-settled', pendingRequestIds: [] },
          uiOwnership: { openedAtMs: 100, closedAtMs: 100, closeReason: 'stabilized' },
        },
        edges,
        episodeOutcome: null,
        tabId: 1,
        unattributed: [],
      },
    ],
    unattributed: [],
  } as unknown as AppBehaviorModel;
}

function transitionsFor(): StateTransition[] {
  return [
    {
      interactionId: 'int-1',
      before: { currentView: { id: 'product', label: 'Product', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: 'http://x/p', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-0', interactionCount: 0 },
      after: { currentView: { id: 'product', label: 'Product', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: 'http://x/p', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-1', interactionCount: 1 },
      changes: [],
    },
  ] as unknown as StateTransition[];
}

describe('CP6 behavior knowledge repository', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;

  beforeEach(async () => {
    db = new KnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  async function persistSession(sessionId: string, model: AppBehaviorModel, atMs: number) {
    const mapped = mapBehaviorModel({ appId: APP, sessionId, model, transitions: transitionsFor() });
    await repo.upsertBehaviorKnowledge(mapped, atMs);
  }

  it('same session persisted twice → full no-op (idempotency gate)', async () => {
    await persistSession('s1', makeModel(), 1000);
    await persistSession('s1', makeModel(), 2000);
    const sessions = await repo.getRecentBehaviorSessions(APP, 100);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].seq).toBe(1);
    const sigs = await repo.getSignatures(APP);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].occurrenceCount).toBe(1);
    const eps = await repo.getEpisodesBySession(APP, 's1');
    expect(eps).toHaveLength(1);
  });

  it('same action in two sessions → ONE signature, occurrenceCount=2, merged profile, both samples', async () => {
    await persistSession('s1', makeModel(), 1000);
    await persistSession('s2', makeModel({ id: 'abm-2' }), 2000);

    const sigs = await repo.getSignatures(APP);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].occurrenceCount).toBe(2);
    expect(sigs[0].firstSeenAtSession).toBe('s1');
    expect(sigs[0].lastSeenAtSession).toBe('s2');

    const apiCons = sigs[0].consequenceProfile.find((c) => c.kind === 'api');
    expect(apiCons?.hitCount).toBe(2);
    expect(apiCons?.occurrenceCount).toBe(2);
    expect(apiCons?.evidenceSamples.map((s) => s.sessionId).sort()).toEqual(['s1', 's2']);
    expect(apiCons?.status).toBe('active');
  });

  it('consequence absent in session 2 → missedObservations=1, status stale (not diverged)', async () => {
    await persistSession('s1', makeModel(), 1000);
    await persistSession('s2', makeModel({ withCartApi: false, id: 'abm-2' }), 2000);

    const sigs = await repo.getSignatures(APP);
    const apiCons = sigs[0].consequenceProfile.find((c) => c.kind === 'api');
    expect(apiCons?.missedObservations).toBe(1);
    expect(apiCons?.status).toBe('stale');
    expect(sigs[0].divergenceFlags).not.toContain('T1-stamp|api|POST /cart/add');
  });

  it(`api consequence absent ${DIVERGENCE_AFTER_SESSIONS} consecutive sessions → diverged flag`, async () => {
    await persistSession('s1', makeModel(), 1000);
    for (let i = 2; i <= 1 + DIVERGENCE_AFTER_SESSIONS; i++) {
      await persistSession(`s${i}`, makeModel({ withCartApi: false, id: `abm-${i}` }), 1000 * i);
    }
    const sigs = await repo.getSignatures(APP);
    const apiCons = sigs[0].consequenceProfile.find((c) => c.kind === 'api');
    expect(apiCons?.missedObservations).toBe(DIVERGENCE_AFTER_SESSIONS);
    expect(apiCons?.status).toBe('diverged');
    expect(sigs[0].divergenceFlags).toContain('T1-stamp|api|POST /cart/add');
  });

  it('a hit after divergence restores active and resets missedObservations', async () => {
    await persistSession('s1', makeModel(), 1000);
    for (let i = 2; i <= 4; i++) {
      await persistSession(`s${i}`, makeModel({ withCartApi: false, id: `abm-${i}` }), 1000 * i);
    }
    await persistSession('s5', makeModel({ withCartApi: true, id: 'abm-5' }), 5000);
    const sigs = await repo.getSignatures(APP);
    const apiCons = sigs[0].consequenceProfile.find((c) => c.kind === 'api');
    expect(apiCons?.status).toBe('active');
    expect(apiCons?.missedObservations).toBe(0);
    expect(sigs[0].divergenceFlags).toHaveLength(0);
  });

  it('within-session replay of two episodes of the same signature counts ONE session', async () => {
    const m = makeModel();
    const second = JSON.parse(JSON.stringify(m.episodes[0]));
    second.id = 'ep-2';
    second.anchor.interactionId = 'int-2';
    second.edges = [];
    m.episodes.push(second);
    const transitions = [
      ...transitionsFor(),
      { ...transitionsFor()[0], interactionId: 'int-2' } as StateTransition,
    ];
    const mapped = mapBehaviorModel({ appId: APP, sessionId: 's1', model: m, transitions });
    await repo.upsertBehaviorKnowledge(mapped, 1000);

    const sigs = await repo.getSignatures(APP);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].occurrenceCount).toBe(1);
  });

  it(`FIFO eviction keeps ${MAX_BEHAVIOR_SESSIONS_PER_APP} sessions and cascades`, async () => {
    for (let i = 1; i <= MAX_BEHAVIOR_SESSIONS_PER_APP + 2; i++) {
      await persistSession(`s${i}`, makeModel({ id: `abm-${i}` }), 1000 * i);
    }
    const sessions = await repo.getRecentBehaviorSessions(APP, 100);
    expect(sessions).toHaveLength(MAX_BEHAVIOR_SESSIONS_PER_APP);
    expect(sessions.map((s) => s.sessionId)).not.toContain('s1');
    expect(sessions.map((s) => s.sessionId)).not.toContain('s2');
    const evictedEpisodes = await repo.getEpisodesBySession(APP, 's1');
    expect(evictedEpisodes).toHaveLength(0);
    const sigs = await repo.getSignatures(APP);
    expect(sigs[0].occurrenceCount).toBe(MAX_BEHAVIOR_SESSIONS_PER_APP + 2);
  });

  it('orphan sweep removes manifest-less stratum-1 rows', async () => {
    await persistSession('s1', makeModel(), 1000);
    await db.knowledgeEpisodes.put({
      key: `${APP}:sX:ep-1`, appId: APP, sessionId: 'sX', episodeId: 'ep-1',
      anchor: { interactionId: 'int-1', actionType: 'Click', actionTarget: 'x', triggerTimestamp: 0 },
      membersJson: '[]', horizonAttributionJson: '{}', horizonUiOwnershipJson: '{}',
      parameterInputsJson: '[]', episodeOutcomeJson: 'null', tabId: null, signatureKey: 'k',
    } as never);
    await db.knowledgeEdges.put({
      key: `${APP}:sX:ep-1:0`, appId: APP, sessionId: 'sX', episodeKey: `${APP}:sX:ep-1`,
      edgeId: 'edge-1', tier: 'T1-stamp', kind: 'api', detail: 'd', confidence: 0.9,
      latencyMs: null, fromEpisodeId: 'ep-1', fromInteractionId: 'int-1', toJson: '{}',
      refJson: '[]', signatureKey: 'k',
    } as never);

    const removed = await repo.sweepOrphans(APP);
    expect(removed).toBe(2);
    expect(await repo.getEpisodesBySession(APP, 'sX')).toHaveLength(0);
    expect(await repo.getEpisodesBySession(APP, 's1')).toHaveLength(1);
  });

  it('deleteBySession cascades behavior rows; signatures survive', async () => {
    await persistSession('s1', makeModel(), 1000);
    await repo.deleteBySession('s1');
    expect(await repo.getRecentBehaviorSessions(APP, 10)).toHaveLength(0);
    expect(await repo.getEpisodesBySession(APP, 's1')).toHaveLength(0);
    expect(await repo.getEdgesBySession(APP, 's1')).toHaveLength(0);
    const sigs = await repo.getSignatures(APP);
    expect(sigs).toHaveLength(1); // knowledge survives
  });

  it('deleteByApp tears down all five stores', async () => {
    await persistSession('s1', makeModel(), 1000);
    await repo.deleteByApp(APP);
    expect(await repo.getRecentBehaviorSessions(APP, 10)).toHaveLength(0);
    expect(await repo.getSignatures(APP)).toHaveLength(0);
    expect(await repo.getGaps(APP)).toHaveLength(0);
  });

  it('loader read model: behaviorVersion, sample resolution, gap summary', async () => {
    await persistSession('s1', makeModel(), 1000);
    await persistSession('s2', makeModel({ id: 'abm-2' }), 2000);

    const loader = new KnowledgeLoader(repo);
    const bk = await loader.loadBehaviorKnowledge(APP);
    expect(bk).not.toBeNull();
    expect(bk!.behaviorVersion).toBe(1); // same signature set both sessions
    expect(bk!.currentSeq).toBe(2);
    expect(bk!.signatures).toHaveLength(1);
    const cons = bk!.signatures[0].consequenceProfile.find((c) => c.kind === 'api');
    expect(cons?.evidenceSamples.every((s) => s.resolvable)).toBe(true);
    expect(cons?.confidence).toBeGreaterThan(0.5);
  });

  it('loader marks evicted-session samples unresolvable (R7 honest degradation)', async () => {
    // The api signature's only hit is s1; 50 further sessions of a
    // DIFFERENT action evict s1 while the signature row survives.
    await persistSession('s1', makeModel(), 1000);
    for (let i = 2; i <= MAX_BEHAVIOR_SESSIONS_PER_APP + 1; i++) {
      const m = makeModel({ withCartApi: false, id: `abm-${i}` });
      m.episodes[0].anchor.actionTarget = 'Different Button';
      await persistSession(`s${i}`, m, 1000 * i);
    }
    const loader = new KnowledgeLoader(repo);
    const bk = await loader.loadBehaviorKnowledge(APP);
    const cons = bk!.signatures
      .find((s) => s.normalizedTarget === 'add to cart')
      ?.consequenceProfile.find((c) => c.kind === 'api');
    expect(cons).toBeDefined();
    expect(cons!.evidenceSamples).toHaveLength(1); // only s1's sample
    expect(cons!.evidenceSamples[0].sessionId).toBe('s1');
    expect(cons!.evidenceSamples[0].resolvable).toBe(false); // evicted
  });

  it('behaviorVersion increments when the signature set changes', async () => {
    await persistSession('s1', makeModel(), 1000);
    await persistSession('s2', makeModel({ id: 'abm-2' }), 2000);
    // session 3 introduces a NEW action → different signature set hash
    const m3 = makeModel({ id: 'abm-3' });
    const other = JSON.parse(JSON.stringify(m3.episodes[0]));
    other.id = 'ep-2';
    other.anchor.interactionId = 'int-2';
    other.anchor.actionTarget = 'Buy Now';
    other.edges = [];
    m3.episodes.push(other);
    const t3 = [
      ...transitionsFor(),
      { ...transitionsFor()[0], interactionId: 'int-2' } as StateTransition,
    ];
    const mapped3 = mapBehaviorModel({ appId: APP, sessionId: 's3', model: m3, transitions: t3 });
    await repo.upsertBehaviorKnowledge(mapped3, 3000);

    const loader = new KnowledgeLoader(repo);
    const bk = await loader.loadBehaviorKnowledge(APP);
    expect(bk!.behaviorVersion).toBe(2); // 1 + one hash change
  });

  it('migrates a genuine v2 database to v3 additively (v2 data preserved)', async () => {
    await db.close();
    await db.delete();

    const Dexie = (await import('dexie')).default;
    const v2db = new Dexie('cmdrunner_knowledge');
    v2db.version(1).stores({
      applications: 'appId, origin',
      knowledgeEntities: 'key, appId, [appId+type], lastSeenAt',
      knowledgeViews: 'key, appId, [appId+lastSeenAt]',
      knowledgeViewTransitions: 'key, appId, lastSeenAt',
      knowledgeCollections: 'key, appId, [appId+entityType]',
      knowledgeCounters: 'key, appId',
      knowledgeNotifications: 'key, appId, [appId+severity]',
      knowledgeOutcomes: 'key, appId, [appId+outcome]',
      knowledgeStateTransitions: 'key, appId, sessionId',
    });
    v2db.version(2).stores({
      knowledgeRecordedWorkflows: 'key, appId, patternId, lastSeenAt',
    });
    await v2db.open();
    expect(v2db.verno).toBe(2);
    await v2db.table('applications').put({
      appId: 'app-v2', origin: 'https://v2.example.com', label: 'v2.example.com',
      firstSeenAt: 1, lastActiveAt: 1, sessionCount: 0, lastSessionId: 'old',
    });
    await v2db.table('knowledgeRecordedWorkflows').put({
      key: 'app-v2:wf-1', appId: 'app-v2', patternId: 'p1', label: 'wf',
      canonicalSteps: [], viewSequence: [], sessionIds: ['old'],
      occurrenceCount: 1, instances: [],
    });
    await v2db.close();

    // Open the v3 KnowledgeDatabase over the same name → migration runs.
    const v3 = new KnowledgeDatabase();
    await v3.open();
    expect(v3.verno).toBe(3);
    expect(await v3.applications.get('app-v2')).toMatchObject({
      origin: 'https://v2.example.com',
    });
    expect(await v3.knowledgeRecordedWorkflows.get('app-v2:wf-1')).toBeDefined();
    expect(await v3.knowledgeSignatures.count()).toBe(0);
    await v3.close();
    await v3.delete();

    // restore the suite's db for subsequent hooks
    db = new KnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
  });

  it(`stale signature after ${STALE_AFTER_SESSIONS} unseen sessions`, async () => {
    await persistSession('s1', makeModel(), 1000);
    for (let i = 2; i <= STALE_AFTER_SESSIONS + 2; i++) {
      const m = makeModel({ withCartApi: false, id: `abm-${i}` });
      m.episodes[0].anchor.actionTarget = 'Different Button';
      await persistSession(`s${i}`, m, 1000 * i);
    }
    const loader = new KnowledgeLoader(repo);
    const bk = await loader.loadBehaviorKnowledge(APP);
    const atc = bk!.signatures.find((s) => s.normalizedTarget === 'add to cart');
    expect(atc?.status).toBe('stale');
    expect(atc?.sessionsSinceSeen).toBe(STALE_AFTER_SESSIONS + 1);
  });

  it('evidence ring is bounded to MAX_EVIDENCE_SAMPLES (last distinct sessions)', async () => {
    for (let i = 1; i <= MAX_EVIDENCE_SAMPLES + 4; i++) {
      await persistSession(`s${i}`, makeModel({ id: `abm-${i}` }), 1000 * i);
    }
    const sigs = await repo.getSignatures(APP);
    const apiCons = sigs[0].consequenceProfile.find((c) => c.kind === 'api');
    expect(apiCons).toBeDefined();
    expect(apiCons!.evidenceSamples.length).toBeLessThanOrEqual(MAX_EVIDENCE_SAMPLES);
    expect(apiCons!.evidenceSamples.map((s) => s.sessionId)).toEqual([
      's5', 's6', 's7', 's8', 's9',
    ]);
  });

  it('v3 is additive: existing v2-style rows coexist untouched', async () => {
    await db.applications.put({
      appId: APP, origin: 'https://shop.example.com', label: 'shop.example.com',
      firstSeenAt: 1, lastActiveAt: 1, sessionCount: 0, lastSessionId: 's1',
    });
    await persistSession('s1', makeModel(), 1000);
    const app = await db.applications.get(APP);
    expect(app?.origin).toBe('https://shop.example.com');
    const sigs = await repo.getSignatures(APP);
    expect(sigs).toHaveLength(1);
  });
});

// ── boundConsequences pin (audit item 11 — profile bound invariant) ────
// Pure-function pin on the FROZEN v1 profile-budget law:
//   (a) profile length ≤ MAX_CONSEQUENCES_PER_SIGNATURE under pressure;
//   (b) stale/diverged entries are NEVER evicted by the bound ("knowledge
//       is demoted, not destroyed") even when active entries alone exceed
//       the budget;
//   (c) among actives, the weakest (lowest occurrenceCount, identity asc)
//       are evicted — strongest survive;
//   (d) input profile is never mutated (deterministic, side-effect free).
describe('boundConsequences — profile bound invariant', () => {
  const TIER = 'T1-stamp';
  const KIND = 'api';

  function cons(
    identity: string,
    status: KnowledgeConsequence['status'],
    occurrenceCount: number,
  ): KnowledgeConsequence {
    return {
      identity,
      tier: TIER,
      kind: KIND,
      targetIdentity: `GET /endpoint/${identity}`,
      occurrenceCount,
      hitCount: occurrenceCount,
      missedObservations:
        status === 'diverged'
          ? DIVERGENCE_AFTER_SESSIONS
          : status === 'stale'
            ? 1
            : 0,
      firstSeenAtSession: 's1',
      lastSeenAtSession: status === 'active' ? 's9' : 's1',
      lastSeenSeq: status === 'active' ? 9 : 1,
      confidence: 1,
      status,
      evidenceSamples: [{ sessionId: 's1', edgeKey: `edge-${identity}` }],
      observedVia: 'behavior/webrequest',
    };
  }

  it('keeps the profile at ≤ MAX_CONSEQUENCES_PER_SIGNATURE under pressure', () => {
    const profile = Array.from({ length: 60 }, (_, i) =>
      cons(`api:${i}`, 'active', 10),
    );
    expect(profile.length).toBeGreaterThan(MAX_CONSEQUENCES_PER_SIGNATURE);
    const bounded = boundConsequences(profile);
    expect(bounded.length).toBeLessThanOrEqual(MAX_CONSEQUENCES_PER_SIGNATURE);
    expect(bounded.length).toBe(MAX_CONSEQUENCES_PER_SIGNATURE);
    expect(new Set(bounded.map((c) => c.identity)).size).toBe(bounded.length);
  });

  it('retains every stale/diverged entry even when actives exceed the budget', () => {
    const profile = [
      ...Array.from({ length: 55 }, (_, i) => cons(`a:${i}`, 'active', 5)),
      cons('stale:1', 'stale', 4),
      cons('div:1', 'diverged', 3),
      cons('div:2', 'diverged', 3),
    ];
    const bounded = boundConsequences(profile);
    const ids = new Set(bounded.map((c) => c.identity));
    expect(ids.has('stale:1')).toBe(true);
    expect(ids.has('div:1')).toBe(true);
    expect(ids.has('div:2')).toBe(true);
    // Budget left for actives after protecting 3 stale/diverged.
    expect(bounded.length).toBe(MAX_CONSEQUENCES_PER_SIGNATURE);
    expect(
      bounded.filter((c) => c.status === 'active').length,
    ).toBe(MAX_CONSEQUENCES_PER_SIGNATURE - 3);
    expect(
      bounded.filter((c) => c.status !== 'active').length,
    ).toBe(3);
  });

  it('evicts weakest actives first (lowest occurrenceCount, then identity asc)', () => {
    const profile = [
      cons('strong-1', 'active', 20),
      ...Array.from({ length: 60 }, (_, i) => cons(`weak:${String(i).padStart(3, '0')}`, 'active', 1)),
      cons('mid-1', 'active', 5),
      cons('mid-2', 'active', 5),
      cons('stale-1', 'stale', 1),
    ];
    const bounded = boundConsequences(profile);
    const ids = new Set(bounded.map((c) => c.identity));
    expect(ids.has('strong-1')).toBe(true);
    expect(ids.has('mid-1')).toBe(true);
    expect(ids.has('mid-2')).toBe(true);
    // Weakest actives evicted first (occurrenceCount 1 < mid 5 < strong 20);
    // among equal counts the highest identities are the evict tail
    // (identity-asc tiebreak keeps low identities).
    expect(ids.has('weak:000')).toBe(true);
    expect(ids.has('weak:043')).toBe(true);
    expect(ids.has('weak:044')).toBe(false);
    expect(ids.has('weak:059')).toBe(false);
    expect(bounded.length).toBe(MAX_CONSEQUENCES_PER_SIGNATURE);
    expect(bounded.filter((c) => c.status === 'active').length)
      .toBe(MAX_CONSEQUENCES_PER_SIGNATURE - 1);
    expect(bounded.filter((c) => c.status === 'stale').length).toBe(1);
  });

  it('does not mutate its input', () => {
    const profile = Array.from({ length: 50 }, (_, i) =>
      cons(`a:${i}`, 'active', 1),
    );
    const snapshot = JSON.parse(JSON.stringify(profile));
    const bounded = boundConsequences(profile);
    expect(profile).toEqual(snapshot);
    expect(bounded).not.toBe(profile);
    expect(bounded.length).toBe(MAX_CONSEQUENCES_PER_SIGNATURE);
  });

  it('returns the same array when under the bound (no-op fast path)', () => {
    const profile = [cons('a:0', 'active', 1), cons('s:0', 'stale', 1)];
    const bounded = boundConsequences(profile);
    expect(bounded).toBe(profile);
  });
});
