/**
 * CP8 — Knowledge Consumer Contract v1 — INVARIANT TESTS
 *
 * Pins the contract-level invariants:
 * 1. contractVersion === 1 on every envelope
 * 2. determinism: same DB state → byte-identical JSON across instances
 * 3. read-only facade: no mutation method names anywhere on the class
 * 4. typed absence (selector / workflowPatternIds / payloadSchema / db)
 * 5. bounds respected (48 consequences, 5 samples)
 * 6. ports declared but unimplemented in core
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { KnowledgeDatabase } from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '../../../src/understanding/consolidation/knowledge-loader';
import { KnowledgeContract, CONTRACT_VERSION } from '../../../src/understanding/index';
import { mapBehaviorModel } from '../../../src/understanding/persistence/behavior-knowledge-mapper';
import type { AppBehaviorModel } from '../../../src/understanding/behavior-model/model-types';
import type { StateTransition } from '../../../src/understanding/state-builder/types';

const APP = 'app-cp8-inv';

function modelWith(count: number): AppBehaviorModel {
  const edges = Array.from({ length: count }, (_, i) => ({
    id: `edge-${String(i).padStart(3, '0')}`,
    kind: 'api',
    tier: 'T1-stamp',
    from: { episodeId: 'ep-1', interactionId: 'int-1' },
    to: { type: 'api', requestId: `r${i}` },
    detail: `GET https://shop.example/p${i} initiated during ep-1`,
    confidence: 0.9,
    latencyMs: null,
    evidenceRefs: [{ kind: 'request', requestId: `r${i}` }],
  }));
  return {
    id: 'abm-inv',
    sessionId: 'session-1',
    generatedAtMs: 1000,
    coverage: {
      totalInteractions: 1, anchoredInteractions: 1, memberInteractions: 0,
      attributedNetworkRows: count, attributedObservations: count,
      totalNetworkRows: count, totalObservations: count,
      malformedInteractions: 0, provenanceLinks: 0, unattributedConsequences: 0,
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

describe('CP8 KnowledgeContract facade invariants', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;
  let loader: KnowledgeLoader;
  let contract: KnowledgeContract;

  beforeEach(async () => {
    db = new KnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
    loader = new KnowledgeLoader(repo);
    contract = new KnowledgeContract(repo, loader);
    const mapped = mapBehaviorModel({ appId: APP, sessionId: 'session-1', model: modelWith(2), transitions: transitionsFor() });
    await repo.upsertBehaviorKnowledge(mapped, 1000);
    await repo.upsertApplication({
      appId: APP, origin: 'https://shop.example', label: 'shop.example',
      firstSeenAt: 1000, lastActiveAt: 1000, sessionCount: 1, lastSessionId: 'session-1',
    });
  });

  afterEach(async () => {
    await db.delete();
  });

  it('every envelope carries contractVersion === 1', async () => {
    const calls: Array<Promise<{ contractVersion: number }>> = [
      contract.describeApplication(APP),
      contract.listApplications(),
      contract.listActions(APP),
      contract.getNavigationGraph(APP),
      contract.getStateGraph(APP),
      contract.getApiSurface(APP),
      contract.getEntitySummary(APP),
      contract.getGapReport(APP),
    ];
    for (const p of calls) {
      const env = await p;
      expect(env.contractVersion).toBe(1);
      expect(CONTRACT_VERSION).toBe(1);
    }
  });

  it('determinism: two contract instances → byte-identical JSON', async () => {
    const contract2 = new KnowledgeContract(repo, loader);
    const [a1, b1, c1] = await Promise.all([
      contract.listActions(APP),
      contract.getApiSurface(APP),
      contract.reconstructWorkflow(APP, 'session-1'),
    ]);
    const [a2, b2, c2] = await Promise.all([
      contract2.listActions(APP),
      contract2.getApiSurface(APP),
      contract2.reconstructWorkflow(APP, 'session-1'),
    ]);
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it('read-only facade: no mutation method names exist on the class', async () => {
    const forbidden = /upsert|put|add|delete|append|ingest|remove|update|clear|create/i;
    const names = new Set<string>();
    let proto: object | null = KnowledgeContract.prototype;
    while (proto && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((n) => names.add(n));
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    const offenders = [...names].filter((n) => forbidden.test(n));
    expect(offenders).toEqual([]);
  });

  it('typed absence: selector / workflow linkage / payload schema / db oracle', async () => {
    const actions = await contract.listActions(APP);
    expect(actions.data.length).toBeGreaterThan(0);
    const a = actions.data[0];
    expect(a.selector).toEqual({
      value: null, reason: 'capture-ceiling', wouldBe: 'css:role:aria locator',
    });
    expect(a.workflowPatternIds).toEqual([]);
    // D6: no workflow rows in this fixture → 'none-recorded' (typed absence).
    expect(a.workflowPatternAbsence).toBe('none-recorded');
    const api = await contract.getApiSurface(APP);
    expect(api.data.every((e) => e.payloadSchema === 'unrecorded')).toBe(true);
    const app = await contract.describeApplication(APP);
    expect(app.data!.capabilities.dbGroundTruth).toBe('unavailable');
  });

  it('bounds: 48 consequences per signature, 5 evidence samples surfaced', async () => {
    // 60 distinct API edges → 60 distinct consequences → bounded to 48.
    const mapped = mapBehaviorModel({ appId: APP, sessionId: 'session-2', model: modelWith(60), transitions: transitionsFor() });
    await repo.upsertBehaviorKnowledge(mapped, 2000);
    const actions = await contract.listActions(APP);
    const a = actions.data[0];
    expect(a.consequences.length).toBeLessThanOrEqual(48);
    for (const c of a.consequences) {
      expect(c.evidenceSamples.length).toBeLessThanOrEqual(5);
    }
  });

  it('ports are declared but not implemented in the core', async () => {
    // Types exist (compile-time); the core exposes no writer/ingestor.
    const core: unknown = await import('../../../src/understanding/index');
    const exported = Object.keys(core as Record<string, unknown>);
    expect(exported.some((k) => /writer|ingestor|executor|playwright|jira|connector/i.test(k))).toBe(false);
  });
});
