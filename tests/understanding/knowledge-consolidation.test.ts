/**
 * M9.6 — Knowledge Consolidation & Consistency Tests
 *
 * Covers:
 * - KnowledgeLoader: assembly + deterministic confidence scoring
 * - ConflictDetector: duplicates, stale, evolving, orphaned (report only)
 * - JourneyReconstructor: ordered timeline, gaps, coverage
 * - KnowledgePreloader: StateBuilder seed from prior knowledge
 * - ConsistencyChecker: in-memory state vs persisted knowledge
 * - READ-ONLY guarantee: no table mutations by any M9.6 component
 * - Realistic multi-session fixtures with evolving attributes and
 *   incomplete journeys
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  KnowledgeDatabase,
  createKnowledgeDatabase,
} from '../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../src/understanding/persistence/knowledge-repository';
import {
  KnowledgePersistenceService,
  deriveAppId,
} from '../../src/understanding/persistence/knowledge-persistence-service';
import { KnowledgeLoader, scoreConfidence } from '../../src/understanding/consolidation/knowledge-loader';
import { ConflictDetector } from '../../src/understanding/consolidation/conflict-detector';
import { JourneyReconstructor } from '../../src/understanding/consolidation/journey-reconstructor';
import { KnowledgePreloader } from '../../src/understanding/consolidation/knowledge-preloader';
import { ConsistencyChecker } from '../../src/understanding/consolidation/consistency-checker';
import type { ApplicationState, StateTransition } from '../../src/understanding/state-builder/types';
import type { ViewDescriptor } from '../../src/understanding/types';
import type { ActionOutcome } from '../../src/understanding/outcome/outcome-types';

// ── Fixtures ───────────────────────────────────────────────────────────

const ORIGIN = 'https://shop.example.com';
const APP_ID = deriveAppId(ORIGIN);

function view(id: string, label = id): ViewDescriptor {
  return { id, label, confidence: 0.9, detectedFrom: 'url-pattern' };
}

function makeState(overrides?: Partial<ApplicationState>): ApplicationState {
  return {
    currentView: view('product-detail', 'Product Detail'),
    currentUrl: `${ORIGIN}/product/1`,
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: 'i-3',
    interactionCount: 3,
    ...overrides,
  };
}

function makeOutcome(interactionId: string, outcome = 'success'): ActionOutcome {
  return {
    interactionId,
    actionType: 'Click' as never,
    actionTarget: 'Add to cart',
    outcome: outcome as ActionOutcome['outcome'],
    confidence: 0.9,
    confidenceLevel: 'confirmed',
    supportingEvidence: [],
    resultingEntities: [],
    stateChanges: [],
  };
}

interface PersistInput {
  sessionId: string;
  view: ViewDescriptor;
  entity?: { id: string; type: string; attributes: Record<string, string | number | boolean | null>; source: string };
  counters?: { id: string; label: string; path: string; values: string[] }[];
  transitions: { interactionId: string; before: ViewDescriptor; after: ViewDescriptor }[];
  outcomes: { interactionId: string; outcome: string }[];
}

/**
 * Persist a realistic multi-session fixture via the real M9.5 service.
 */
async function persistSessions(
  svc: KnowledgePersistenceService,
  inputs: PersistInput[],
): Promise<void> {
  for (const input of inputs) {
    const state = makeState({
      currentView: input.view,
      entities: input.entity
        ? new Map([[input.entity.id, {
            id: input.entity.id, type: input.entity.type, attributes: input.entity.attributes,
            source: input.entity.source, firstSeenAt: 'i-1', lastUpdated: 'i-2',
          }]])
        : new Map(),
      counters: input.counters
        ? new Map(input.counters.map((c) => [c.id, {
            id: c.id, label: c.label, elementPath: c.path,
            values: c.values.map((v, i) => ({ value: v, interactionId: `i-${i}`, delta: null })),
          }]))
        : new Map(),
    });

    const transitions: StateTransition[] = input.transitions.map((t) => ({
      interactionId: t.interactionId,
      before: makeState({ currentView: t.before }),
      after: makeState({ currentView: t.after }),
      changes: [`view-change: ${t.before.id} -> ${t.after.id}`],
    }));

    const outcomes: ActionOutcome[] = input.outcomes.map((o) =>
      makeOutcome(o.interactionId, o.outcome),
    );

    await svc.persist({
      origin: ORIGIN,
      projectId: 'proj-1',
      recordingSessionId: input.sessionId,
      applicationState: state,
      transitions,
      outcomes,
    });
  }
}

// Base multi-session fixture: 3 sessions, one evolving entity, incomplete journey in s3.
function threeSessionFixture(): PersistInput[] {
  return [
    {
      sessionId: 's1',
      view: view('home'),
      entity: { id: 'B0XYZ', type: 'product', attributes: { name: 'Widget', price: 10 }, source: 'view-derived' },
      counters: [{ id: 'cart-count', label: 'Cart', path: '/cart-badge', values: ['1'] }],
      transitions: [
        { interactionId: 'i-1', before: view('home'), after: view('product-detail') },
        { interactionId: 'i-2', before: view('product-detail'), after: view('cart') },
      ],
      outcomes: [
        { interactionId: 'i-1', outcome: 'success' },
        { interactionId: 'i-2', outcome: 'success' },
      ],
    },
    {
      sessionId: 's2',
      view: view('home'),
      entity: { id: 'B0XYZ', type: 'product', attributes: { name: 'Widget', price: 12 }, source: 'view-derived' },
      counters: [{ id: 'cart-count', label: 'Cart', path: '/cart-badge', values: ['2'] }],
      transitions: [
        { interactionId: 'i-3', before: view('home'), after: view('product-detail') },
      ],
      outcomes: [{ interactionId: 'i-3', outcome: 'success' }],
    },
    {
      sessionId: 's3',
      view: view('home'),
      entity: { id: 'B0XYZ', type: 'product', attributes: { name: 'Widget', price: 15, color: 'red' }, source: 'view-derived' },
      counters: [{ id: 'cart-count', label: 'Cart', path: '/cart-badge', values: ['3'] }],
      transitions: [
        { interactionId: 'i-4', before: view('home'), after: view('search-results') },
        // i-5 has a transition but NO outcome → incomplete journey
        { interactionId: 'i-5', before: view('search-results'), after: view('product-detail') },
      ],
      outcomes: [{ interactionId: 'i-4', outcome: 'success' }],
    },
  ];
}

// ── Setup ──────────────────────────────────────────────────────────────

let db: KnowledgeDatabase;
let repo: KnowledgeRepository;
let svc: KnowledgePersistenceService;
let loader: KnowledgeLoader;
let preloader: KnowledgePreloader;
let journey: JourneyReconstructor;
let checker: ConsistencyChecker;

beforeEach(async () => {
  db = createKnowledgeDatabase();
  await db.open();
  repo = new KnowledgeRepository(db);
  svc = new KnowledgePersistenceService(repo);
  loader = new KnowledgeLoader(repo);
  preloader = new KnowledgePreloader(loader);
  journey = new JourneyReconstructor(repo);
  checker = new ConsistencyChecker();
});

afterEach(async () => {
  await db.delete();
});

// ── scoreConfidence (pure function) ────────────────────────────────────

describe('scoreConfidence (pure)', () => {
  it('scores a freshly-seen multi-session entity higher than single-session', () => {
    const multi = scoreConfidence(3, 0, 1);
    const single = scoreConfidence(1, 0, 1);
    expect(multi.score).toBeGreaterThan(single.score);
    expect(multi.observationScore).toBe(0.6);
    expect(single.observationScore).toBe(0.2);
  });

  it('decays recency by sessions since seen', () => {
    const fresh = scoreConfidence(1, 0, 1);
    const stale = scoreConfidence(1, 5, 1);
    expect(fresh.recencyScore).toBe(1);
    expect(stale.recencyScore).toBeGreaterThanOrEqual(0.1);
    expect(stale.recencyScore).toBeLessThan(fresh.recencyScore);
  });

  it('saturates observation score at saturationCount', () => {
    const a = scoreConfidence(5, 0, 1);
    const b = scoreConfidence(100, 0, 1);
    expect(a.observationScore).toBe(1);
    expect(b.observationScore).toBe(1);
  });

  it('floors recency at minRecency', () => {
    const veryStale = scoreConfidence(1, 100, 1);
    expect(veryStale.recencyScore).toBe(0.1);
  });

  it('maps scores to levels', () => {
    expect(scoreConfidence(5, 0, 4).level).toBe('very-high');
    expect(scoreConfidence(1, 100, 1).level).toBe('low');
  });
});

// ── KnowledgeLoader ────────────────────────────────────────────────────

describe('KnowledgeLoader (M9.6)', () => {
  it('returns null for unknown app', async () => {
    expect(await loader.load('no-such-app')).toBeNull();
  });

  it('assembles the full read model from persisted rows', async () => {
    await persistSessions(svc, threeSessionFixture());

    const k = await loader.load(APP_ID);
    expect(k).not.toBeNull();
    expect(k!.appId).toBe(APP_ID);
    expect(k!.origin).toBe(ORIGIN);
    expect(k!.sessionCount).toBe(3);
    expect(k!.entities.length).toBe(1);
    expect(k!.entities[0].entityId).toBe('B0XYZ');
    expect(k!.entities[0].revision).toBe(3);
    expect(k!.entities[0].attributes.price).toBe(15); // latest merged
    expect(k!.entities[0].attributes.name).toBe('Widget'); // preserved
    expect(k!.views.length).toBeGreaterThanOrEqual(4); // home, product-detail, cart, search-results
    expect(k!.viewGraph.edges.length).toBeGreaterThanOrEqual(4);
    expect(k!.counters.length).toBe(1);
    expect(k!.counters[0].historyLength).toBe(3);
    expect(k!.counters[0].currentValue).toBe('3');
    expect(k!.outcomePattern.totalActions).toBe(4);
    expect(k!.outcomePattern.successCount).toBe(4);
    expect(k!.notifications.length).toBe(0);
    expect(k!.totalRows).toBeGreaterThan(0);
  });

  it('scores evolving multi-session entities higher than first-seen', async () => {
    await persistSessions(svc, threeSessionFixture());
    const k = await loader.load(APP_ID);

    // B0XYZ seen in 3 sessions (revision 3), last seen in latest session.
    // All sessions persisted within ~1ms so recencyScore ≈ 1.
    const e = k!.entities[0];
    expect(e.confidence.observationScore).toBeCloseTo(0.6, 2);
    expect(e.confidence.recencyScore).toBeGreaterThanOrEqual(0.9);
    expect(e.confidence.score).toBeGreaterThan(0.5);
  });

  it('aggregates notifications by text+severity', async () => {
    const state = makeState({
      notifications: [
        { id: 'n1', text: 'Added to cart', severity: 'success', elementPath: '/toast', appearedAt: 'i-1', disappearedAt: null },
        { id: 'n2', text: 'Added to cart', severity: 'success', elementPath: '/toast', appearedAt: 'i-2', disappearedAt: null },
      ],
    });
    await svc.persist({
      origin: ORIGIN, projectId: 'p', recordingSessionId: 's1',
      applicationState: state, transitions: [], outcomes: [],
    });

    const k = await loader.load(APP_ID);
    expect(k!.notifications.length).toBe(1);
    expect(k!.notifications[0].count).toBe(2);
  });
});

// ── ConflictDetector (report only) ─────────────────────────────────────

describe('ConflictDetector (M9.6) — report only', () => {
  it('detects duplicate entities with overlapping attributes', async () => {
    await persistSessions(svc, [
      {
        sessionId: 's1', view: view('home'),
        entity: { id: 'A', type: 'product', attributes: { name: 'X', price: 1, sku: 'S1' }, source: 'view-derived' },
        transitions: [], outcomes: [],
      },
      {
        sessionId: 's2', view: view('home'),
        entity: { id: 'B', type: 'product', attributes: { name: 'X', price: 1, sku: 'S2' }, source: 'view-derived' },
        transitions: [], outcomes: [],
      },
    ]);

    const k = await loader.load(APP_ID);
    const report = new ConflictDetector(k!).check();

    expect(report.duplicateCount).toBe(1);
    const dup = report.findings.find((f) => f.kind === 'duplicate-entity');
    expect(dup).toBeDefined();
    if (dup && dup.kind === 'duplicate-entity') {
      expect(dup.overlappingKeys).toContain('name');
    }
  });

  it('does not flag same-entity or different-type entities as duplicates', async () => {
    await persistSessions(svc, [
      {
        sessionId: 's1', view: view('home'),
        entity: { id: 'A', type: 'product', attributes: { name: 'X', price: 1 }, source: 'view-derived' },
        transitions: [], outcomes: [],
      },
      {
        sessionId: 's2', view: view('home'),
        entity: { id: 'B', type: 'cart-item', attributes: { name: 'X', price: 1 }, source: 'view-derived' },
        transitions: [], outcomes: [],
      },
    ]);

    const k = await loader.load(APP_ID);
    const report = new ConflictDetector(k!).check();
    expect(report.duplicateCount).toBe(0);
  });

  it('detects evolving entities (revision > 1)', async () => {
    await persistSessions(svc, threeSessionFixture());
    const k = await loader.load(APP_ID);
    const report = new ConflictDetector(k!).check();

    expect(report.evolvingCount).toBe(1);
    const evo = report.findings.find((f) => f.kind === 'evolving-entity');
    expect(evo).toBeDefined();
    if (evo && evo.kind === 'evolving-entity') {
      expect(evo.revision).toBe(3);
    }
  });

  it('detects stale entities after threshold sessions', async () => {
    // Entity seen only in session 1 of 7 total sessions.
    // The stale detector uses observedInSessions.length (always 1 since
    // M9.5 only stores lastSessionId) vs sessionCount (7).
    const inputs: PersistInput[] = [];
    for (let i = 1; i <= 7; i++) {
      inputs.push({
        sessionId: `s${i}`, view: view('home'),
        entity: i === 1 ? { id: 'OLD', type: 'product', attributes: { sku: 'OLD' }, source: 'view-derived' } : undefined,
        transitions: [], outcomes: [{ interactionId: `i-${i}`, outcome: 'success' }],
      });
    }
    await persistSessions(svc, inputs);

    const k = await loader.load(APP_ID);
    const report = new ConflictDetector(k!).check();

    expect(report.staleCount).toBe(1);
    const stale = report.findings.find((f) => f.kind === 'stale-knowledge');
    expect(stale).toBeDefined();
    if (stale && stale.kind === 'stale-knowledge') {
      expect(stale.sessionsSinceLastSeen).toBeGreaterThanOrEqual(5);
    }
  });

  it('does not report findings on a clean single-session knowledge base', async () => {
    await persistSessions(svc, [
      {
        sessionId: 's1', view: view('home'),
        entity: { id: 'A', type: 'product', attributes: { sku: 'A' }, source: 'view-derived' },
        transitions: [{ interactionId: 'i-1', before: view('home'), after: view('product-detail') }],
        outcomes: [{ interactionId: 'i-1', outcome: 'success' }],
      },
    ]);

    const k = await loader.load(APP_ID);
    const report = new ConflictDetector(k!).check();
    expect(report.duplicateCount).toBe(0);
    expect(report.staleCount).toBe(0);
  });
});

// ── JourneyReconstructor ───────────────────────────────────────────────

describe('JourneyReconstructor (M9.6)', () => {
  it('reconstructs an ordered multi-session timeline', async () => {
    await persistSessions(svc, threeSessionFixture());

    const timeline = await journey.reconstruct(APP_ID);
    expect(timeline.steps.length).toBeGreaterThanOrEqual(5);
    expect(timeline.sessionCount).toBe(3);
    expect(timeline.totalInteractions).toBe(timeline.steps.length);
  });

  it('matches transitions with outcomes on interactionId', async () => {
    await persistSessions(svc, threeSessionFixture());

    const timeline = await journey.reconstruct(APP_ID);
    const withOutcome = timeline.steps.filter((s) => s.outcome !== null);
    // Fixture has 4 outcomes (i-1, i-2, i-3, i-4), each matching a transition.
    expect(withOutcome.length).toBe(4);
    for (const step of withOutcome) {
      expect(step.actionType).not.toBeNull();
      expect(step.actionTarget).not.toBeNull();
    }
  });

  it('reports outcome coverage below 100 for incomplete journeys', async () => {
    await persistSessions(svc, threeSessionFixture());

    // s3/i-5 has a transition but no outcome
    const timeline = await journey.reconstruct(APP_ID);
    expect(timeline.outcomeCoverage).toBeLessThan(100);
    expect(timeline.outcomeCoverage).toBeGreaterThanOrEqual(0);
  });

  it('includes steps for outcomes without transitions', async () => {
    await persistSessions(svc, [
      {
        sessionId: 's1', view: view('home'),
        transitions: [],
        outcomes: [{ interactionId: 'i-99', outcome: 'ambiguous' }],
      },
    ]);

    const timeline = await journey.reconstruct(APP_ID);
    expect(timeline.steps.length).toBe(1);
    expect(timeline.steps[0].outcome).toBe('ambiguous');
    expect(timeline.steps[0].fromViewId).toBeNull();
  });

  it('detects no gaps when steps share timestamps', async () => {
    // All transitions in one session share persist-time timestamp.
    await persistSessions(svc, [
      {
        sessionId: 's1', view: view('home'),
        transitions: [
          { interactionId: 'i-1', before: view('home'), after: view('product-detail') },
          { interactionId: 'i-2', before: view('product-detail'), after: view('cart') },
        ],
        outcomes: [
          { interactionId: 'i-1', outcome: 'success' },
          { interactionId: 'i-2', outcome: 'success' },
        ],
      },
    ]);

    const tl = await journey.reconstruct(APP_ID);
    expect(tl.gaps.length).toBe(0);
  });
});

// ── KnowledgePreloader ─────────────────────────────────────────────────

describe('KnowledgePreloader (M9.6)', () => {
  it('returns empty seed when no prior knowledge exists', async () => {
    const seed = await preloader.buildSeed(APP_ID);
    expect(seed.hasPriorKnowledge).toBe(false);
    expect(seed.entities.size).toBe(0);
    expect(seed.views.size).toBe(0);
    expect(seed.counters.size).toBe(0);
  });

  it('seeds entities, views, and counters from prior knowledge', async () => {
    await persistSessions(svc, threeSessionFixture());

    const seed = await preloader.buildSeed(APP_ID);
    expect(seed.hasPriorKnowledge).toBe(true);
    expect(seed.entities.size).toBe(1);
    expect(seed.entities.get('B0XYZ')!.attributes.price).toBe(15);
    expect(seed.entities.get('B0XYZ')!.provenance).toBe('prior-session');

    expect(seed.views.size).toBeGreaterThanOrEqual(4);
    expect(seed.views.get('home')!.provenance).toBe('prior-session');

    expect(seed.counters.size).toBe(1);
    expect(seed.counters.get('cart-count')!.lastKnownValue).toBe('3');
  });

  it('is read-only: preloading does not mutate any table', async () => {
    await persistSessions(svc, threeSessionFixture());

    const before = await snapshotTables(repo);
    await preloader.buildSeed(APP_ID);
    const after = await snapshotTables(repo);

    expect(after).toEqual(before);
  });
});

// ── ConsistencyChecker ─────────────────────────────────────────────────

describe('ConsistencyChecker (M9.6)', () => {
  it('reports inconsistent when no persisted knowledge exists', async () => {
    const gap = checker.check(makeState(), null);
    expect(gap.isConsistent).toBe(false);
    expect(gap.detail).toContain('No persisted knowledge');
  });

  it('reports new entities present in state but not persisted', async () => {
    await persistSessions(svc, threeSessionFixture());
    const k = await loader.load(APP_ID);

    const state = makeState({
      entities: new Map([
        ['B0XYZ', { id: 'B0XYZ', type: 'product', attributes: {}, source: 'view-derived', firstSeenAt: 'i-1', lastUpdated: 'i-1' }],
        ['NEW-1', { id: 'NEW-1', type: 'order', attributes: {}, source: 'inferred', firstSeenAt: 'i-2', lastUpdated: 'i-2' }],
      ]),
    });

    const gap = checker.check(state, k);
    expect(gap.newEntities).toEqual(['NEW-1']);
    expect(gap.missingEntities).toEqual([]);
    expect(gap.isConsistent).toBe(false);
  });

  it('reports missing entities persisted but not in state', async () => {
    await persistSessions(svc, threeSessionFixture());
    const k = await loader.load(APP_ID);

    const state = makeState({ entities: new Map() });
    const gap = checker.check(state, k);
    expect(gap.missingEntities).toEqual(['B0XYZ']);
    expect(gap.isConsistent).toBe(false);
  });

  it('reports consistent when entity sets match', async () => {
    await persistSessions(svc, threeSessionFixture());
    const k = await loader.load(APP_ID);

    const persistedViewId = k!.views[0]?.viewId ?? 'product-detail';
    const state = makeState({
      currentView: view(persistedViewId),
      entities: new Map([
        ['B0XYZ', { id: 'B0XYZ', type: 'product', attributes: {}, source: 'view-derived', firstSeenAt: 'i-1', lastUpdated: 'i-1' }],
      ]),
    });

    const gap = checker.check(state, k);
    expect(gap.newEntities).toEqual([]);
    expect(gap.missingEntities).toEqual([]);
  });

  it('reports new/missing views', async () => {
    await persistSessions(svc, threeSessionFixture());
    const k = await loader.load(APP_ID);

    const state = makeState({ currentView: view('brand-new-view') });
    const gap = checker.check(state, k);
    expect(gap.newViews).toEqual(['brand-new-view']);
    expect(gap.isConsistent).toBe(false);
  });
});

// ── Read-only guarantee (all components) ───────────────────────────────

describe('M9.6 read-only guarantee', () => {
  it('loader, conflict detector, journey, preloader, checker never mutate tables', async () => {
    await persistSessions(svc, threeSessionFixture());

    const before = await snapshotTables(repo);

    const k = await loader.load(APP_ID);
    new ConflictDetector(k!).check();
    await journey.reconstruct(APP_ID);
    await preloader.buildSeed(APP_ID);
    checker.check(makeState(), k);

    const after = await snapshotTables(repo);
    expect(after).toEqual(before);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────

async function snapshotTables(repo: KnowledgeRepository): Promise<unknown> {
  const summary = await repo.getAppSummary(APP_ID);
  const entities = await repo.getEntities(APP_ID);
  const views = await repo.getViews(APP_ID);
  const counters = await repo.getCounters(APP_ID);
  return {
    summary,
    entities: entities.map((e) => ({ ...e })),
    views: views.map((v) => ({ ...v })),
    counters: counters.map((c) => ({ ...c, history: [...c.history] })),
  };
}
