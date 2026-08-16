/**
 * CP6 — Stage 5 persistence pass-through tests
 *
 * Covers:
 * - behaviorModel present → knowledge rows written (persistence ON)
 * - behaviorModel null → no rows, no warning
 * - mapper throw → warning 'behavior-knowledge-persist', steps 1–10
 *   data intact, pipeline result unaffected
 *
 * Uses fake-indexeddb directly with the real KnowledgePersistenceService.
 *
 * Architecture: .drytis/specs/cp6-knowledge-repository.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { KnowledgeDatabase } from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import {
  KnowledgePersistenceService,
  deriveAppId,
} from '../../../src/understanding/persistence/knowledge-persistence-service';
import type { AppBehaviorModel } from '../../../src/understanding/behavior-model/model-types';
import type { ApplicationState, StateTransition } from '../../../src/understanding/state-builder/types';
import type { ActionOutcome } from '../../../src/understanding/outcome/outcome-types';

// ── Fixtures ───────────────────────────────────────────────────────────

const ORIGIN = 'https://shop.example.com';

function makeState(): ApplicationState {
  return {
    currentView: { id: 'product', label: 'Product', confidence: 0.9, detectedFrom: 'url-pattern' },
    currentUrl: `${ORIGIN}/product`,
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: 'int-1',
    interactionCount: 1,
  };
}

function makeTransitions(): StateTransition[] {
  return [
    {
      interactionId: 'int-1',
      before: { currentView: { id: 'search-results', label: 'Search Results', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: `${ORIGIN}/s`, entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-0', interactionCount: 0 },
      after: { currentView: { id: 'product', label: 'Product', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: `${ORIGIN}/p`, entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-1', interactionCount: 1 },
      changes: [],
    },
  ] as unknown as StateTransition[];
}

function makeModel(): AppBehaviorModel {
  return {
    id: 'abm-s1',
    sessionId: 's1',
    generatedAtMs: 1000,
    coverage: {
      totalInteractions: 1, anchoredInteractions: 1, memberInteractions: 0,
      attributedNetworkRows: 0, attributedObservations: 0, totalNetworkRows: 0,
      totalObservations: 0, malformedInteractions: 0, provenanceLinks: 0,
      unattributedConsequences: 0,
    },
    warnings: [],
    provenanceLinks: [],
    episodes: [
      {
        id: 'ep-int-1',
        anchor: { interactionId: 'int-1', actionType: 'Click', actionTarget: 'Add to Cart', triggerTimestamp: 100 },
        members: [{ interactionId: 'int-1', role: 'anchor' }],
        parameterInputs: [],
        horizon: {
          attribution: { openedAtMs: 100, closedAtMs: 100, closeReason: 'all-stamped-settled', pendingRequestIds: [] },
          uiOwnership: { openedAtMs: 100, closedAtMs: 100, closeReason: 'stabilized' },
        },
        edges: [],
        episodeOutcome: null,
        tabId: 1,
        unattributed: [],
      },
    ],
    unattributed: [],
  } as unknown as AppBehaviorModel;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('CP6 Stage 5 — behavior knowledge pass-through', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;
  let service: KnowledgePersistenceService;
  const appId = deriveAppId(ORIGIN);

  beforeEach(async () => {
    db = new KnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
    service = new KnowledgePersistenceService(repo);
  });

  afterEach(async () => {
    await db.delete();
  });

  function baseInput() {
    return {
      origin: ORIGIN,
      projectId: appId,
      recordingSessionId: 's1',
      applicationState: makeState(),
      transitions: makeTransitions(),
      outcomes: [] as ActionOutcome[],
    };
  }

  it('behaviorModel present → behavior rows written; steps 1–10 data intact', async () => {
    await service.persist({ ...baseInput(), behaviorModel: makeModel() });

    expect(await repo.getBehaviorSession(appId, 's1')).toBeDefined();
    expect(await repo.getEpisodesBySession(appId, 's1')).toHaveLength(1);
    expect(await repo.getSignatures(appId)).toHaveLength(1);
    // v1-layer knowledge intact (before+after views from the transition):
    expect(await repo.getApplication(appId)).toBeDefined();
    expect((await repo.getViews(appId)).length).toBeGreaterThan(0);
  });

  it('behaviorModel absent → no behavior rows, no error', async () => {
    await service.persist(baseInput());

    expect(await repo.getRecentBehaviorSessions(appId, 5)).toHaveLength(0);
    expect(await repo.getSignatures(appId)).toHaveLength(0);
    expect(await repo.getApplication(appId)).toBeDefined();
  });

  it('step-11 failure is isolated and tagged: steps 1–10 still committed', async () => {
    // Break the MODEL (not the transitions — steps 1–3 consume those) so
    // the mapper's anchorViewId resolution throws inside step 11 only.
    // An episode anchor with a non-string actionTarget passes the shape
    // but explodes in normalizeTarget at map time.
    const broken = makeModel();
    (broken.episodes[0].anchor as unknown as { actionTarget: unknown }).actionTarget =
      { poison: true } as never;

    await expect(
      service.persist({ ...baseInput(), behaviorModel: broken }),
    ).rejects.toThrow(/behavior-knowledge-persist/);

    // Steps 1–10 committed BEFORE the tagged step-11 failure:
    expect(await repo.getApplication(appId)).toBeDefined();
    expect((await repo.getViews(appId)).length).toBeGreaterThan(0);
    expect(await repo.getRecentBehaviorSessions(appId, 5)).toHaveLength(0);
  });

  it('zero-episode model is skipped gracefully (no rows, no throw) — steps 1–10 intact', async () => {
    const empty = makeModel();
    (empty as { episodes: unknown[] }).episodes = [];

    await service.persist({ ...baseInput(), behaviorModel: empty });

    expect(await repo.getApplication(appId)).toBeDefined();
    expect((await repo.getViews(appId)).length).toBeGreaterThan(0);
    expect(await repo.getRecentBehaviorSessions(appId, 5)).toHaveLength(0);
    expect(await repo.getSignatures(appId)).toHaveLength(0);
  });

  it('a second session merges into the same signature (cross-session via service)', async () => {
    await service.persist({ ...baseInput(), behaviorModel: makeModel() });
    const m2 = makeModel();
    m2.id = 'abm-s2';
    await service.persist({
      ...baseInput(),
      recordingSessionId: 's2',
      behaviorModel: m2,
    });

    const sigs = await repo.getSignatures(appId);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].occurrenceCount).toBe(2);
  });
});
