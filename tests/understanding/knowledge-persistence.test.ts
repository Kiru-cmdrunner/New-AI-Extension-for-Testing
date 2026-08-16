/**
 * M9.5 — Knowledge Persistence Tests
 *
 * Covers:
 * - Database schema creation (V1, 9 tables)
 * - Repository CRUD + accumulation semantics
 * - Idempotency: re-persist of same session never inflates counts/history
 * - Cross-session accumulation (sessionCount, visitCount, revisions)
 * - Bounded growth (counter history, notifications, state transitions)
 * - Cleanup (deleteBySession keeps knowledge, deleteByApp tears down)
 * - Service translation: in-memory state → rows
 * - Layer separation: knowledge DB separate from cmdrunner_repository
 *
 * Architecture: .drytis/specs/m9-5-knowledge-persistence.md
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
  type KnowledgePersistenceInput,
} from '../../src/understanding/persistence/knowledge-persistence-service';
import type { ApplicationState, StateTransition } from '../../src/understanding/state-builder/types';
import type { ViewDescriptor } from '../../src/understanding/types';
import type { ActionOutcome } from '../../src/understanding/outcome/outcome-types';
import {
  MAX_COUNTER_HISTORY,
  MAX_NOTIFICATIONS_PER_APP,
  MAX_TRANSITIONS_PER_SESSION,
} from '../../src/understanding/persistence/knowledge-types';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeState(overrides?: Partial<ApplicationState>): ApplicationState {
  return {
    currentView: {
      id: 'product-detail',
      label: 'Product Detail',
      confidence: 0.9,
      detectedFrom: 'url-pattern',
      
    },
    currentUrl: 'https://shop.example.com/product/1',
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: 'i-3',
    interactionCount: 3,
    ...overrides,
  };
}

function makeTransition(
  interactionId: string,
  before: ApplicationState,
  after: ApplicationState,
): StateTransition {
  return { interactionId, before, after, changes: ['view-change'] };
}

function makeOutcome(interactionId: string): ActionOutcome {
  return {
    interactionId,
    actionType: 'Click' as never,
    actionTarget: 'Add to cart',
    outcome: 'success',
    confidence: 0.9,
    confidenceLevel: 'confirmed',
    supportingEvidence: [
      {
        kind: 'notification',
        result: 'success',
        weight: 0.4,
        detail: '"Added to cart"',
        interactionId,
      },
    ],
    resultingEntities: ['cart-item-1'],
    stateChanges: ['cart-item created'],
  };
}

function makeInput(overrides?: Partial<KnowledgePersistenceInput>): KnowledgePersistenceInput {
  const state = makeState();
  return {
    origin: 'https://shop.example.com',
    projectId: 'proj-1',
    recordingSessionId: 'session-1',
    applicationState: state,
    transitions: [makeTransition('i-1', makeState(), state)],
    outcomes: [makeOutcome('i-1')],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('KnowledgeDatabase (M9.5)', () => {
  it('creates with version 1 and all 9 tables', async () => {
    const db = createKnowledgeDatabase();
    await db.open();
    // CP6: version 3 — additive migration adds the five behavior-knowledge
    // stores (v2 was DDC-4's knowledgeRecordedWorkflows).
    expect(db.verno).toBe(3);
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'applications',
      'knowledgeBehaviorSessions',
      'knowledgeCollections',
      'knowledgeCounters',
      'knowledgeEdges',
      'knowledgeEntities',
      'knowledgeEpisodes',
      'knowledgeGaps',
      'knowledgeNotifications',
      'knowledgeOutcomes',
      'knowledgeRecordedWorkflows',
      'knowledgeSignatures',
      'knowledgeStateTransitions',
      'knowledgeViewTransitions',
      'knowledgeViews',
    ]);
    await db.delete();
  });

  it('is a separate database from cmdrunner_repository', async () => {
    const db = createKnowledgeDatabase();
    await db.open();
    expect(db.name).toBe('cmdrunner_knowledge');
    expect(db.name).not.toBe('cmdrunner_repository');
    await db.delete();
  });
});

describe('KnowledgeRepository (M9.5)', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;

  beforeEach(async () => {
    db = createKnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  // -- Applications --

  it('upserts application with session guard', async () => {
    await repo.upsertApplication({
      appId: 'app-1',
      origin: 'https://a.com',
      label: 'a.com',
      firstSeenAt: 1,
      lastActiveAt: 1,
      sessionCount: 0,
      lastSessionId: 's1',
    });
    // Same session re-persist: no double-count
    await repo.upsertApplication({
      appId: 'app-1',
      origin: 'https://a.com',
      label: 'a.com',
      firstSeenAt: 1,
      lastActiveAt: 2,
      sessionCount: 0,
      lastSessionId: 's1',
    });
    let app = await repo.getApplication('app-1');
    expect(app?.sessionCount).toBe(1); // +1 only once
    expect(app?.lastActiveAt).toBe(2);

    // New session increments
    await repo.upsertApplication({
      appId: 'app-1',
      origin: 'https://a.com',
      label: 'a.com',
      firstSeenAt: 1,
      lastActiveAt: 3,
      sessionCount: 0,
      lastSessionId: 's2',
    });
    app = await repo.getApplication('app-1');
    expect(app?.sessionCount).toBe(2);
    expect(app?.lastSessionId).toBe('s2');
  });

  it('getApplicationByOrigin finds by origin index', async () => {
    await repo.upsertApplication({
      appId: 'app-1',
      origin: 'https://a.com',
      label: 'a.com',
      firstSeenAt: 1,
      lastActiveAt: 1,
      sessionCount: 1,
      lastSessionId: 's1',
    });
    const app = await repo.getApplicationByOrigin('https://a.com');
    expect(app?.appId).toBe('app-1');
  });

  // -- Entities --

  it('merges entity attributes across sessions and guards same-session re-persist', async () => {
    await repo.upsertEntity({
      key: 'app-1:e1',
      appId: 'app-1',
      entityId: 'e1',
      type: 'product',
      attributes: { name: 'Widget', price: 10 },
      source: 'view-derived',
      firstSeenAt: 1,
      lastSeenAt: 1,
      revision: 1,
      lastSessionId: 's1',
    });
    // Same session re-persist: revision stays, no re-merge
    await repo.upsertEntity({
      key: 'app-1:e1',
      appId: 'app-1',
      entityId: 'e1',
      type: 'product',
      attributes: { name: 'Widget', price: 12 },
      source: 'view-derived',
      latestOnly: true,
      firstSeenAt: 1,
      lastSeenAt: 2,
      revision: 1,
      lastSessionId: 's1',
    } as never);
    let rows = await repo.getEntities('app-1');
    expect(rows[0].revision).toBe(1);
    expect(rows[0].attributes.price).toBe(10);
    expect(rows[0].attributes.latestOnly).toBeUndefined();

    // New session merges
    await repo.upsertEntity({
      key: 'app-1:e1',
      appId: 'app-1',
      entityId: 'e1',
      type: 'product',
      attributes: { price: 15, color: 'red' },
      source: 'view-derived',
      firstSeenAt: 1,
      lastSeenAt: 3,
      revision: 1,
      lastSessionId: 's2',
    });
    rows = await repo.getEntities('app-1');
    expect(rows[0].revision).toBe(2);
    expect(rows[0].attributes.price).toBe(15);
    expect(rows[0].attributes.name).toBe('Widget'); // preserved
    expect(rows[0].attributes.color).toBe('red');
  });

  it('queries entities by type index', async () => {
    for (const [i, type] of ['product', 'product', 'cart-item'].entries()) {
      await repo.upsertEntity({
        key: `app-1:e${i}`,
        appId: 'app-1',
        entityId: `e${i}`,
        type,
        attributes: {},
        source: 'inferred',
        firstSeenAt: 1,
        lastSeenAt: 1,
        revision: 1,
        lastSessionId: 's1',
      });
    }
    expect((await repo.getEntitiesByType('app-1', 'product')).length).toBe(2);
    expect((await repo.getEntitiesByType('app-1', 'cart-item')).length).toBe(1);
  });

  // -- Views --

  it('increments visitCount only across sessions', async () => {
    const view = {
      key: 'app-1:v1',
      appId: 'app-1',
      viewId: 'v1',
      label: 'Home',
      detectedFrom: 'url-pattern',
      firstSeenAt: 1,
      lastSeenAt: 1,
      visitCount: 1,
      lastSessionId: 's1',
    };
    await repo.upsertView(view);
    await repo.upsertView({ ...view, lastSessionId: 's1' });
    await repo.upsertView({ ...view, lastSessionId: 's2' });
    const rows = await repo.getViews('app-1');
    expect(rows[0].visitCount).toBe(2);
  });

  // -- View transitions --

  it('increments view transition count across sessions', async () => {
    const t = {
      key: 'app-1:v1->v2',
      appId: 'app-1',
      fromViewId: 'v1',
      toViewId: 'v2',
      count: 1,
      firstSeenAt: 1,
      lastSeenAt: 1,
      lastSessionId: 's1',
    };
    await repo.upsertViewTransition(t);
    await repo.upsertViewTransition({ ...t, lastSessionId: 's1' });
    await repo.upsertViewTransition({ ...t, lastSessionId: 's2' });
    const rows = await repo.getViewTransitions('app-1');
    expect(rows[0].count).toBe(2);
  });

  // -- Collections --

  it('tracks currentCount and preserves maxCount', async () => {
    const coll = {
      key: 'app-1:c1',
      appId: 'app-1',
      collectionId: 'c1',
      entityType: 'product',
      currentCount: 5,
      maxCount: 5,
      lastUpdated: 1,
      lastSessionId: 's1',
    };
    await repo.upsertCollection(coll);
    await repo.upsertCollection({ ...coll, currentCount: 2, maxCount: 2, lastSessionId: 's2' });
    const rows = await repo.getCollections('app-1');
    expect(rows[0].currentCount).toBe(2);
    expect(rows[0].maxCount).toBe(5);
  });

  // -- Counters --

  it('appends counter history with session/value dedup and bounding', async () => {
    // First observation
    await repo.appendCounter('app-1', 'cart-count', 'Cart', '/p', {
      value: '1',
      observedAt: 1,
      sessionId: 's1',
      delta: null,
    });
    // Same session, same value → dedup
    await repo.appendCounter('app-1', 'cart-count', 'Cart', '/p', {
      value: '1',
      observedAt: 2,
      sessionId: 's1',
      delta: null,
    });
    let rows = await repo.getCounters('app-1');
    expect(rows[0].history.length).toBe(1);

    // Same session, different value → appends
    await repo.appendCounter('app-1', 'cart-count', 'Cart', '/p', {
      value: '3',
      observedAt: 3,
      sessionId: 's1',
      delta: 2,
    });
    rows = await repo.getCounters('app-1');
    expect(rows[0].history.length).toBe(2);
    expect(rows[0].currentValue).toBe('3');

    // Cross-session: same value as previous session still appends (new session observation)
    await repo.appendCounter('app-1', 'cart-count', 'Cart', '/p', {
      value: '3',
      observedAt: 4,
      sessionId: 's2',
      delta: 0,
    });
    rows = await repo.getCounters('app-1');
    expect(rows[0].history.length).toBe(3);
    expect(rows[0].lastSessionId).toBe('s2');
  });

  it('bounds counter history at MAX_COUNTER_HISTORY', async () => {
    for (let i = 0; i < MAX_COUNTER_HISTORY + 25; i++) {
      await repo.appendCounter('app-1', 'c', 'C', '/p', {
        value: String(i),
        observedAt: i,
        sessionId: `s-${i}`,
        delta: 1,
      });
    }
    const rows = await repo.getCounters('app-1');
    expect(rows[0].history.length).toBe(MAX_COUNTER_HISTORY);
    expect(rows[0].history[0].value).toBe(String(25)); // oldest trimmed
    expect(rows[0].history[rows[0].history.length - 1].value).toBe(String(MAX_COUNTER_HISTORY + 24));
  });

  // -- Notifications --

  it('dedups notifications by key', async () => {
    const notif = {
      key: 'app-1:n1',
      appId: 'app-1',
      text: 'Added to cart',
      severity: 'success',
      elementPath: '/toast',
      appearedAt: 1,
      sessionId: 's1',
    };
    await repo.addNotification(notif);
    await repo.addNotification(notif);
    expect((await repo.getNotifications('app-1')).length).toBe(1);
  });

  it('bounds notifications at MAX_NOTIFICATIONS_PER_APP', async () => {
    for (let i = 0; i < MAX_NOTIFICATIONS_PER_APP + 10; i++) {
      await repo.addNotification({
        key: `app-1:n${i}`,
        appId: 'app-1',
        text: `n${i}`,
        severity: 'info',
        elementId: undefined,
        elementPath: '/toast',
        appearedAt: i,
        sessionId: 's1',
      } as never);
    }
    expect((await repo.getNotifications('app-1')).length).toBe(MAX_NOTIFICATIONS_PER_APP);
  });

  it('bounds state transitions at MAX_TRANSITIONS_PER_SESSION', async () => {
    for (let i = 0; i < MAX_TRANSITIONS_PER_SESSION + 5; i++) {
      await repo.addStateTransition({
        key: `s1:t${i}`,
        appId: 'app-1',
        sessionId: 's1',
        interactionId: `i-${i}`,
        changes: [],
        fromViewId: null,
        toViewId: null,
        affectedEntities: [],
        timestamp: i,
      });
    }
    expect((await repo.getStateTransitions('s1')).length).toBe(MAX_TRANSITIONS_PER_SESSION);
  });

  // -- Cleanup --

  it('deleteBySession removes outcomes/transitions but keeps accumulated knowledge', async () => {
    // Seed app-level knowledge
    await repo.upsertView({
      key: 'app-1:v1', appId: 'app-1', viewId: 'v1', label: 'V',
      detectedFrom: 'url-pattern', firstSeenAt: 1, lastSeenAt: 1, visitCount: 1, lastSessionId: 's1',
    });
    await repo.addNotification({
      key: 'app-1:n1', appId: 'app-1', text: 'x', severity: 'info',
      elementPath: '/t', appearedAt: 1, sessionId: 's1',
    });
    await repo.putOutcome({
      key: 's1:i-1', appId: 'app-1', sessionId: 's1', interactionId: 'i-1',
      actionType: 'Click', actionTarget: 'btn', outcome: 'success',
      confidence: 0.9, confidenceLevel: 'confirmed', evidence: [],
      resultingEntities: [], persistedAt: 1,
    });
    await repo.addStateTransition({
      key: 's1:i-1', appId: 'app-1', sessionId: 's1', interactionId: 'i-1',
      changes: [], fromViewId: null, toViewId: null, affectedEntities: [], timestamp: 1,
    });

    await repo.deleteBySession('s1');

    expect((await repo.getOutcomes('s1')).length).toBe(0);
    expect((await repo.getStateTransitions('s1')).length).toBe(0);
    expect((await repo.getViews('app-1')).length).toBe(1); // survives
    expect((await repo.getNotifications('app-1')).length).toBe(1); // survives
  });

  it('deleteByApp removes everything for the app', async () => {
    await repo.upsertView({
      key: 'app-1:v1', appId: 'app-1', viewId: 'v1', label: 'V',
      detectedFrom: 'url-pattern', firstSeenAt: 1, lastSeenAt: 1, visitCount: 1, lastSessionId: 's1',
    });
    await repo.putOutcome({
      key: 's1:i-1', appId: 'app-1', sessionId: 's1', interactionId: 'i-1',
      actionType: 'Click', actionTarget: 'btn', outcome: 'success',
      confidence: 0.9, confidenceLevel: 'confirmed', evidence: [],
      resultingEntities: [], persistedAt: 1,
    });

    await repo.deleteByApp('app-1');

    const summary = await repo.getAppSummary('app-1');
    expect(summary.entities).toBe(0);
    expect(summary.views).toBe(0);
    expect(summary.outcomes).toBe(0);
    expect(await repo.getApplication('app-1')).toBeUndefined();
  });

  it('getAppSummary counts all tables', async () => {
    await repo.upsertView({
      key: 'app-1:v1', appId: 'app-1', viewId: 'v1', label: 'V',
      detectedFrom: 'url-pattern', firstSeenAt: 1, lastSeenAt: 1, visitCount: 1, lastSessionId: 's1',
    });
    const summary = await repo.getAppSummary('app-1');
    expect(summary.views).toBe(1);
    expect(summary.entities).toBe(0);
  });
});

describe('deriveAppId', () => {
  it('is stable for the same origin and distinct across origins', () => {
    expect(deriveAppId('https://a.com')).toBe(deriveAppId('https://a.com'));
    expect(deriveAppId('https://a.com')).not.toBe(deriveAppId('https://b.com'));
  });
});

describe('KnowledgePersistenceService (M9.5)', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;
  let svc: KnowledgePersistenceService;

  beforeEach(async () => {
    db = createKnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
    svc = new KnowledgePersistenceService(repo);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('persists application, view, entity, counter, notification, outcome, transition', async () => {
    const state = makeState({
      entities: new Map([
        ['e1', {
          id: 'e1', type: 'product', attributes: { name: 'Widget' },
          source: 'view-derived', firstSeenAt: 'i-1', lastUpdated: 'i-2',
        }],
      ]),
      collections: new Map([
        ['c1', {
          id: 'c1', entityType: 'product', count: 5, containerPath: '/grid',
          lastUpdated: 'i-2',
        }],
      ]),
      counters: new Map([
        ['cart-count', {
          id: 'cart-count', label: 'Cart', elementPath: '/cart-badge',
          values: [
            { value: '1', interactionId: 'i-1', delta: null },
            { value: '2', interactionId: 'i-2', delta: 1 },
          ],
        }],
      ]),
      notifications: [
        { id: 'n1', text: 'Added to cart', severity: 'success', elementPath: '/toast', appearedAt: 'i-2', disappearedAt: null },
      ],
    });
    const transitions = [
      makeTransition('i-1', makeState({ currentView: { ...makeState().currentView!, id: 'home', label: 'Home' } }), state),
    ];
    const outcomes = [makeOutcome('i-1')];

    await svc.persist({ origin: 'https://shop.example.com', projectId: 'p1', recordingSessionId: 's1', applicationState: state, transitions, outcomes });

    const appId = deriveAppId('https://shop.example.com');

    const app = await repo.getApplication(appId);
    expect(app).toBeDefined();
    expect(app!.sessionCount).toBe(1);
    expect(app!.label).toBe('shop.example.com');

    const views = await repo.getViews(appId);
    expect(views.length).toBe(2); // home + product-detail
    expect(views.map((v) => v.viewId).sort()).toEqual(['home', 'product-detail']);

    const entities = await repo.getEntities(appId);
    expect(entities.length).toBe(1);
    expect(entities[0].entityId).toBe('e1');
    expect(entities[0].attributes.name).toBe('Widget');

    const collections = await repo.getCollections(appId);
    expect(collections.length).toBe(1);
    expect(collections[0].currentCount).toBe(5);

    const counters = await repo.getCounters(appId);
    expect(counters.length).toBe(1);
    expect(counters[0].history.length).toBe(2);
    expect(counters[0].currentValue).toBe('2');

    const notifs = await repo.getNotifications(appId);
    expect(notifs.length).toBe(1);
    expect(notifs[0].text).toBe('Added to cart');

    const storedOutcomes = await repo.getOutcomes('s1');
    expect(storedOutcomes.length).toBe(1);
    expect(storedOutcomes[0].outcome).toBe('success');
    expect(storedOutcomes[0].evidence[0].kind).toBe('notification');

    const storedTransitions = await repo.getStateTransitions('s1');
    expect(storedTransitions.length).toBe(1);
    expect(storedTransitions[0].fromViewId).toBe('home');
    expect(storedTransitions[0].toViewId).toBe('product-detail');
  });

  it('is idempotent: re-persisting the same session changes nothing', async () => {
    const input = makeInput();
    const appId = deriveAppId(input.origin);

    await svc.persist(input);
    await svc.persist(input); // re-persist

    const app = await repo.getApplication(appId);
    expect(app!.sessionCount).toBe(1); // not 2

    const views = await repo.getViews(appId);
    expect(views.length).toBe(1);
    expect(views[0].visitCount).toBe(1); // not 2

    const transitions = await repo.getViewTransitions(appId);
    expect(transitions.length).toBe(0); // no view change in fixture

    const entities = await repo.getEntities(appId);
    expect(entities.length).toBe(0);

    const outcomes = await repo.getOutcomes('session-1');
    expect(outcomes.length).toBe(1); // put is idempotent by key
  });

  it('accumulates across sessions: counts, revisions, merged attributes', async () => {
    const appId = deriveAppId('https://shop.example.com');

    // Session 1: view home, entity price 10
    const s1State = makeState({
      currentView: { id: 'home', label: 'Home', confidence: 0.9, detectedFrom: 'url-pattern' },
      entities: new Map([
        ['e1', { id: 'e1', type: 'product', attributes: { name: 'Widget', price: 10 }, source: 'view-derived', firstSeenAt: 'i-1', lastUpdated: 'i-1' }],
      ]),
    });
    await svc.persist(makeInput({
      recordingSessionId: 's1',
      applicationState: s1State,
      transitions: [],
      outcomes: [],
    }));

    // Session 2: view home again, entity price 15
    const s2State = makeState({
      currentView: { id: 'home', label: 'Home', confidence: 0.9, detectedFrom: 'url-pattern' },
      entities: new Map([
        ['e1', { id: 'e1', type: 'product', attributes: { name: 'Widget', price: 15, color: 'red' }, source: 'view-derived', firstUpdated: undefined, firstSeenAt: 'i-1', lastUpdated: 'i-2' }],
      ]),
    });
    await svc.persist(makeInput({
      recordingSessionId: 's2',
      applicationState: s2State,
      transitions: [],
      outcomes: [],
    }));

    const app = await repo.getApplication(appId);
    expect(app!.sessionCount).toBe(2);

    const views = await repo.getViews(appId);
    expect(views.length).toBe(1);
    expect(views[0].visitCount).toBe(2);

    const entities = await repo.getEntities(appId);
    expect(entities.length).toBe(1);
    expect(entities[0].revision).toBe(2);
    expect(entities[0].attributes.price).toBe(15);
    expect(entities[0].attributes.name).toBe('Widget');
  });

  it('handles view transitions across sessions via upsert', async () => home_to_product_flow(repo, svc));
});

/** Helper: verify view-transition accumulation across two sessions. */
async function home_to_product_flow(repo: KnowledgeRepository, svc: KnowledgePersistenceService) {
  const appId = deriveAppId('https://shop.example.com');
  const homeView: ViewDescriptor = { id: 'home', label: 'Home', confidence: 0.9, detectedFrom: 'url-pattern' };
  const pdView: ViewDescriptor = { id: 'product-detail', label: 'Product Detail', confidence: 0.9, detectedFrom: 'url-pattern' };

  // Session 1: home → product-detail
  const before1 = makeState({ currentView: homeView });
  const after1 = makeState({ currentView: pdView });
  await svc.persist(makeInput({
    recordingSessionId: 's1',
    applicationState: after1,
    transitions: [makeTransition('i-1', before1, after1)],
    outcomes: [],
  }));

  // Session 2: same flow again
  await svc.persist(makeInput({
    recordingSessionId: 's2',
    applicationState: after1,
    transitions: [makeTransition('i-2', before1, after1)],
    outcomes: [],
  }));

  const transitions = await repo.getViewTransitions(appId);
  expect(transitions.length).toBe(1);
  expect(transitions[0].count).toBe(2);
  expect(transitions[0].fromViewId).toBe('home');
  expect(transitions[0].toViewId).toBe('product-detail');
}
