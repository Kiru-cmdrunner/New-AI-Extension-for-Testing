/**
 * Phase 5a — API Test Seed QUERIES (end-to-end over fake-indexeddb)
 *
 * Seeds the knowledge DB through the production persistence path
 * (mapBehaviorModel → repo.upsertBehaviorKnowledge) and drives the
 * contract queries with an in-memory SeedEvidenceAccess, verifying:
 * session enumeration via listBehaviorSessions, the knowledge join
 * (signature + api-edge confidence), eviction honesty (R7 resolvable
 * degradation), deterministic ordering across sessions, envelope
 * wrapping via KnowledgeContract, and the Click/Navigation separation
 * at the evidence-row level.
 *
 * Architecture: .drytis/specs/resulting-application-state-plan.md Phase 5a
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { KnowledgeDatabase } from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '../../../src/understanding/consolidation/knowledge-loader';
import { mapBehaviorModel } from '../../../src/understanding/persistence/behavior-knowledge-mapper';
import {
  listApiSeeds,
  listApiSeedsForSession,
} from '../../../src/understanding/contract/contract-queries';
import type { SeedEvidenceAccess, SeedEvidenceRow } from '../../../src/understanding/contract/api-seed-derivation';
import type { AppBehaviorModel } from '../../../src/understanding/behavior-model/model-types';

const APP = 'app-p5a';

// ── Knowledge fixture: one session, one Add-to-Cart episode ────────────

function makeModel(sessionId: string, interactionId: string): AppBehaviorModel {
  return {
    id: `abm-${sessionId}`,
    sessionId,
    generatedAtMs: 1000,
    coverage: {
      totalInteractions: 1, anchoredInteractions: 1, memberInteractions: 0,
      attributedNetworkRows: 1, attributedObservations: 1, totalNetworkRows: 1,
      totalObservations: 1, malformedInteractions: 0, provenanceLinks: 0,
      unattributedConsequences: 0,
    },
    warnings: [],
    provenanceLinks: [],
    episodes: [
      {
        id: `ep-${interactionId}`,
        anchor: { interactionId, actionType: 'Click', actionTarget: 'Add to Cart', triggerTimestamp: 100 },
        members: [{ interactionId, role: 'anchor' }],
        parameterInputs: [],
        horizon: {
          attribution: { openedAtMs: 100, closedAtMs: 100, closeReason: 'all-stamped-settled', pendingRequestIds: [] },
          uiOwnership: { openedAtMs: 100, closedAtMs: 100, closeReason: 'stabilized' },
        },
        edges: [
          {
            id: 'edge-api',
            kind: 'api',
            tier: 'T1-stamp',
            from: { episodeId: `ep-${interactionId}`, interactionId },
            to: { type: 'api', requestId: 'req-1' },
            detail: 'POST https://shop.example/cart/add initiated during ep-x',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'request', requestId: 'req-1' }],
          },
        ],
        episodeOutcome: {
          outcome: 'success', confidence: 0.9, confidenceLevel: 'confirmed',
          derivation: 'derived-episode-outcome', contributingMembers: [interactionId],
        },
        tabId: 1,
        unattributed: [],
      },
    ],
    unattributed: [],
  } as unknown as AppBehaviorModel;
}

// ── Evidence access fixture ────────────────────────────────────────────

function evidenceAccess(rows: SeedEvidenceRow[]): SeedEvidenceAccess {
  const bySession = new Map<string, SeedEvidenceRow[]>();
  const eventIds = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    const list = bySession.get(row.recordingSessionId) ?? [];
    list.push(row);
    bySession.set(row.recordingSessionId, list);
    if (!eventIds.has(row.recordingSessionId)) {
      eventIds.set(row.recordingSessionId, new Map());
    }
    eventIds.get(row.recordingSessionId)!.set(row.interactionId, [...row.interactionEventIds]);
  }
  return {
    async getBySession(sessionId) {
      return bySession.get(sessionId) ?? [];
    },
    async getInteractionEventIds(_appId, sessionId) {
      return eventIds.get(sessionId) ?? new Map();
    },
  };
}

function seedRow(overrides: Partial<SeedEvidenceRow> = {}): SeedEvidenceRow {
  return {
    windowId: 'bev-evt-1',
    interactionId: 'int-9',
    recordingSessionId: 'session-1',
    sourceEventId: 'evt-9',
    interactionEventIds: ['evt-9'],
    networkActivity: [
      {
        url: 'https://shop.example/cart/add?sku=B0VAL1',
        method: 'POST',
        status: 200,
        resourceType: 'xhr',
        source: 'webrequest',
        sourceEventId: 'evt-9',
        requestId: 'req-1',
        requestBody: { ASIN: 'B0VAL1', quantity: '1', password: 'x' },
      },
    ],
    resultingState: {
      items: [
        { kind: 'counter', matchedSelector: 'div', text: '1', numericValue: 1, entityId: null, domPath: 'DIV#cart-count' },
        { kind: 'entity', matchedSelector: 'li[data-asin]', text: 'Widget', numericValue: null, entityId: 'cart-item:B0VAL1', domPath: 'LI[data-asin="B0VAL1"]' },
      ],
    },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Phase 5a — listApiSeeds (queries, end-to-end)', () => {
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

  async function seedSession(sessionId: string, interactionId: string) {
    await mapAndUpsert(sessionId, interactionId, sessionId === 'session-1' ? 1 : 2);
  }

  async function mapAndUpsert(sessionId: string, interactionId: string, seq: number) {
    const mapped = mapBehaviorModel({
      appId: APP,
      sessionId,
      model: makeModel(sessionId, interactionId),
      transitions: [],
    });
    await repo.upsertBehaviorKnowledge(mapped, seq);
    await repo.upsertApplication({
      appId: APP,
      origin: 'https://shop.example',
      label: 'shop.example',
      firstSeenAt: 1000,
      lastActiveAt: 1000,
      sessionCount: seq,
      lastSessionId: sessionId,
    });
  }

  it('derives a stamped seed with the knowledge join intact', async () => {
    await seedSession('session-1', 'int-9');
    const seeds = await listApiSeeds(repo, APP, evidenceAccess([seedRow()]));
    expect(seeds).toHaveLength(1);
    const seed = seeds[0];
    expect(seed.attribution).toBe('event-stamped');
    expect(seed.request.path).toBe('/cart/add'); // query-free
    expect(seed.action?.actionType).toBe('Click');
    expect(seed.action?.normalizedTarget).toBe('Add to Cart');
    expect(seed.action?.signatureKey).toMatch(new RegExp(`^${APP}:sig:`));
    expect(seed.confidence).toBeCloseTo(0.9, 5);
    expect(seed.expectedPostConditions).toEqual([
      { kind: 'counter', identity: 'DIV#cart-count', value: 1, operator: 'equals' },
      { kind: 'entity-present', identity: 'cart-item:B0VAL1' },
    ]);
    // INV-5a-7 through the full query path: values never surface.
    expect(seed.request.bodyKeys).toEqual(['ASIN', 'quantity']);
  });

  it('degrades evidenceRef.resolvable when the session was FIFO-evicted (R7)', async () => {
    await seedSession('session-1', 'int-9');
    // Flood past the 50-session retention bound so session-1 is evicted.
    for (let i = 2; i <= 51; i++) {
      await mapAndUpsert(`session-${i}`, `int-${i}`, i);
    }
    const seeds = await listApiSeedsForSession(repo, APP, 'session-1', evidenceAccess([seedRow()]));
    expect(seeds).toHaveLength(1);
    expect(seeds[0].evidenceRef.resolvable).toBe(false);
    // The seed itself survives — citation degrades, never disappears.
    expect(seeds[0].sessionId).toBe('session-1');
  });

  it('resolvable stays true for a retained session', async () => {
    await seedSession('session-1', 'int-9');
    const seeds = await listApiSeeds(repo, APP, evidenceAccess([seedRow()]));
    expect(seeds[0].evidenceRef.resolvable).toBe(true);
  });

  it('returns [] for a session with no evidence rows', async () => {
    await seedSession('session-1', 'int-9');
    const seeds = await listApiSeeds(repo, APP, evidenceAccess([]));
    expect(seeds).toEqual([]);
  });

  it('enumerates all retained sessions in seq order (session asc)', async () => {
    await seedSession('session-1', 'int-9');
    await seedSession('session-2', 'int-10');
    const seeds = await listApiSeeds(
      repo,
      APP,
      evidenceAccess([
        seedRow(),
        seedRow({
          windowId: 'bev-evt-10',
          interactionId: 'int-10',
          recordingSessionId: 'session-2',
          sourceEventId: 'evt-10',
          interactionEventIds: ['evt-10'],
          networkActivity: [
            {
              url: 'https://shop.example/checkout',
              method: 'GET',
              status: 200,
              resourceType: 'xhr',
              source: 'webrequest',
              sourceEventId: 'evt-10',
              requestId: 'req-10',
            },
          ],
        }),
      ]),
    );
    expect(seeds.map((s) => s.sessionId)).toEqual(['session-1', 'session-2']);
    expect(seeds.map((s) => s.request.path)).toEqual(['/cart/add', '/checkout']);
  });

  it('keeps Click-window and Navigation-window seeds strictly separate (INV-CS1)', async () => {
    await seedSession('session-1', 'int-9');
    const clickRow = seedRow(); // Click window: stamped POST /cart/add
    const navRow = seedRow({
      windowId: 'bev-nav-1',
      interactionId: 'int-nav-1',
      sourceEventId: 'evt-nav',
      interactionEventIds: ['evt-nav'],
      networkActivity: [
        {
          // The destination-page fetch — a DIFFERENT window's evidence.
          url: 'https://shop.example/cart.html',
          method: 'GET',
          status: 200,
          resourceType: 'xhr',
          source: 'webrequest',
          sourceEventId: 'evt-nav',
          requestId: 'req-nav-1',
        },
        {
          // A full-page navigation row — excluded by INV-CS1.
          url: 'https://shop.example/cart.html',
          method: 'GET',
          status: 200,
          resourceType: 'navigation',
          source: 'performance-observer',
          requestId: 'req-doc-1',
        },
      ],
      resultingState: { items: [] },
    });
    const seeds = await listApiSeeds(repo, APP, evidenceAccess([clickRow, navRow]));
    // Two windows → two independent seed sets; the navigation DOCUMENT row
    // never became an API seed.
    expect(seeds).toHaveLength(2);
    const navSeeds = seeds.filter((s) => s.interactionId === 'int-nav-1');
    expect(navSeeds).toHaveLength(1);
    expect(navSeeds[0].request.path).toBe('/cart.html');
    expect(navSeeds[0].request.resourceType).toBe('xhr');
    expect(seeds.some((s) => s.seedId.includes('req-doc-1'))).toBe(false);
  });

  it('KnowledgeContract.listApiSeeds wraps the payload in a v1 envelope', async () => {
    await seedSession('session-1', 'int-9');
    const { KnowledgeContract } = await import('../../../src/understanding/contract/knowledge-contract');
    const contract = new KnowledgeContract(repo, new KnowledgeLoader(repo));
    const env = await contract.listApiSeeds(APP, evidenceAccess([seedRow()]));
    expect(env.contractVersion).toBe(1);
    expect(env.data).toHaveLength(1);
    expect(env.data[0].seedId).toBe('session-1:int-9:req-1');
  });

  it('KnowledgeContract.listApiSeedsForSession wraps one session', async () => {
    await seedSession('session-1', 'int-9');
    const { KnowledgeContract } = await import('../../../src/understanding/contract/knowledge-contract');
    const contract = new KnowledgeContract(repo, new KnowledgeLoader(repo));
    const env = await contract.listApiSeedsForSession(APP, 'session-1', evidenceAccess([seedRow()]));
    expect(env.contractVersion).toBe(1);
    expect(env.data).toHaveLength(1);
  });

  it('CONTRACT_VERSION is unchanged at 1 (additive read-side only)', async () => {
    const { CONTRACT_VERSION } = await import('../../../src/understanding/contract/contract-types');
    expect(CONTRACT_VERSION).toBe(1);
  });
});
