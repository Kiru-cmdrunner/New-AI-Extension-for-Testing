/**
 * M9.9 — Entity State & Lifecycle Tracking tests
 *
 * Covers:
 *  1. EntityStateTracker: observe, transition dedup, history, apply
 *  2. normalizeStateText: keyword normalization (multi-word, casing, partial)
 *  3. extractStateFromNotification: notification → state
 *  4. PageContentSignal: status badges now carried through
 *  5. StateBuilder: badge → entity state integration
 *  6. StateBuilder: notification → entity state integration
 *  7. EntityTracker: state preservation on upsert merge
 *  8. Persistence: KnowledgeEntityRow round-trips state fields
 *  9. Consolidation: ConsolidatedEntity carries state from persistence
 * 10. Backward compat: entities without state work unchanged
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  EntityStateTracker,
  normalizeStateText,
  extractStateFromNotification,
} from '../../src/understanding/state-builder/entity-state-tracker';
import { EntityTracker } from '../../src/understanding/state-builder/entity-tracker';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { extractFromSnapshot } from '../../src/understanding/page-content/page-content-signals';
import type { PageContentSnapshot, ObservedItem } from '../../src/understanding/page-content/page-content-types';
import type { Entity } from '../../src/understanding/state-builder/types';
import type { SignalSet, NotificationSignal } from '../../src/understanding/types';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'leave-request:101',
    type: 'leave-request',
    attributes: { employee: 'Ada' },
    source: 'view-derived',
    firstSeenAt: 'int-1',
    lastUpdated: 'int-1',
    ...overrides,
  };
}

function makeSnapshot(items: ObservedItem[]): PageContentSnapshot {
  return {
    url: 'https://hr.example.com/leave/list',
    viewId: 'leave-list',
    items,
    itemsOverflow: 0,
    scannedAt: 100,
    scanDurationMs: 5,
  };
}

function makeBadge(text: string, overrides: Partial<ObservedItem> = {}): ObservedItem {
  return {
    kind: 'status-badge',
    matchedSelector: '[class*="badge"][class*="status"]',
    text,
    numericValue: null,
    entityId: null,
    entityType: null,
    domPath: 'div[2]/span[1]',
    attributes: {},
    visible: true,
    ...overrides,
  };
}

function makeEntityObs(
  entityId: string,
  entityType: string,
  text: string,
): ObservedItem {
  return {
    kind: 'entity',
    matchedSelector: '[data-record-id]',
    text,
    numericValue: null,
    entityId,
    entityType,
    domPath: `table/tr[${entityId}]`,
    attributes: { 'data-record-id': entityId },
    visible: true,
  };
}

function makeSignalSet(pageContentItems: ObservedItem[], iid: string): SignalSet {
  const snapshot = makeSnapshot(pageContentItems);
  const signal = extractFromSnapshot(snapshot, iid);
  return {
    interactionId: iid,
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    pageContent: signal,
  };
}

function makeNotificationSignal(
  iid: string,
  text: string,
  severity: 'success' | 'error' | 'warning' | 'info' | 'unknown' = 'success',
): NotificationSignal {
  return {
    type: 'notification',
    source: 'surface',
    interactionId: iid,
    confidence: 0.8,
    kind: 'appeared',
    text,
    severity,
    elementPath: 'div/toast',
  };
}

function makeNotifOnlySignalSet(iid: string, notifs: NotificationSignal[]): SignalSet {
  return {
    interactionId: iid,
    viewChanges: [],
    apiOperations: [],
    notifications: notifs,
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    pageContent: null,
  };
}

// ── 1. EntityStateTracker ──────────────────────────────────────────────

describe('M9.9 EntityStateTracker', () => {
  it('records an initial observation with from=null', () => {
    const tracker = new EntityStateTracker();
    const changed = tracker.observe('leave-request:101', 'pending', 'int-1', 'badge');
    expect(changed).toBe(true);
    const history = tracker.getHistory('leave-request:101');
    expect(history).toHaveLength(1);
    expect(history[0].from).toBeNull();
    expect(history[0].to).toBe('pending');
    expect(tracker.getState('leave-request:101')).toBe('pending');
  });

  it('does not record a transition when state is unchanged', () => {
    const tracker = new EntityStateTracker();
    tracker.observe('e:1', 'pending', 'int-1', 'badge');
    const changed = tracker.observe('e:1', 'pending', 'int-2', 'badge again');
    expect(changed).toBe(false);
    expect(tracker.getHistory('e:1')).toHaveLength(1);
  });

  it('records pending → approved as a real transition', () => {
    const tracker = new EntityStateTracker();
    tracker.observe('e:1', 'pending', 'int-1', 'badge');
    const changed = tracker.observe('e:1', 'approved', 'int-2', 'badge');
    expect(changed).toBe(true);
    expect(tracker.getHistory('e:1').map((h) => [h.from, h.to])).toEqual([
      [null, 'pending'],
      ['pending', 'approved'],
    ]);
  });

  it('applies state to an entity snapshot map', () => {
    const tracker = new EntityStateTracker();
    tracker.observe('leave-request:101', 'pending', 'int-1', 'badge');
    tracker.observe('leave-request:101', 'approved', 'int-5', 'toast');

    const entities = new Map<string, Entity>([['leave-request:101', makeEntity()]]);
    tracker.applyToEntities(entities);

    const entity = entities.get('leave-request:101')!;
    expect(entity.currentState).toBe('approved');
    expect(entity.stateHistory).toHaveLength(2);
    expect(entity.stateHistory![1].to).toBe('approved');
  });

  it('clear() resets all tracked state', () => {
    const tracker = new EntityStateTracker();
    tracker.observe('e:1', 'open', 'int-1', 'badge');
    tracker.clear();
    expect(tracker.getState('e:1')).toBeNull();
    expect(tracker.getHistory('e:1')).toHaveLength(0);
  });

  it('handles multiple independent entities', () => {
    const tracker = new EntityStateTracker();
    tracker.observe('e:1', 'open', 'int-1', 'badge');
    tracker.observe('e:2', 'closed', 'int-1', 'badge');
    expect(tracker.getState('e:1')).toBe('open');
    expect(tracker.getState('e:2')).toBe('closed');
    tracker.observe('e:1', 'merged', 'int-3', 'badge');
    expect(tracker.getState('e:1')).toBe('merged');
    expect(tracker.getState('e:2')).toBe('closed'); // unchanged
  });
});

// ── 2. normalizeStateText ──────────────────────────────────────────────

describe('M9.9 normalizeStateText', () => {
  it('maps exact keywords', () => {
    expect(normalizeStateText('Pending')).toBe('pending');
    expect(normalizeStateText('Approved')).toBe('approved');
    expect(normalizeStateText('Closed')).toBe('closed');
    expect(normalizeStateText('Merged')).toBe('merged');
  });

  it('maps multi-word phrases (longest-first)', () => {
    expect(normalizeStateText('Awaiting Approval')).toBe('pending');
    expect(normalizeStateText('Leave Approved')).toBe('approved');
    expect(normalizeStateText('Changes Requested')).toBe('changes-requested');
  });

  it('maps partial context like "Status: Approved"', () => {
    expect(normalizeStateText('Status: Approved')).toBe('approved');
  });

  it('returns null for unrecognized text', () => {
    expect(normalizeStateText('Items in your cart')).toBeNull();
    expect(normalizeStateText('')).toBeNull();
  });

  it('does not match substrings inside other words', () => {
    // "open" should not match inside "opened" — they're different tokens
    expect(normalizeStateText('opened')).toBeNull();
  });

  it('handles case-insensitive matching', () => {
    expect(normalizeStateText('PENDING')).toBe('pending');
    expect(normalizeStateText('In Progress')).toBe('in-progress');
  });
});

// ── 3. extractStateFromNotification ────────────────────────────────────

describe('M9.9 extractStateFromNotification', () => {
  it('extracts state from direct keyword', () => {
    expect(extractStateFromNotification('Approved')).toBe('approved');
    expect(extractStateFromNotification('Merged')).toBe('merged');
  });

  it('extracts state from past-tense verbs', () => {
    expect(extractStateFromNotification('Leave request saved')).toBe('saved');
    expect(extractStateFromNotification('Issue deleted')).toBe('deleted');
  });

  it('returns null for stateless notifications', () => {
    expect(extractStateFromNotification('Welcome back!')).toBeNull();
  });
});

// ── 4. PageContentSignal carries status badges ─────────────────────────

describe('M9.9 PageContentSignal status badges', () => {
  it('extracts status-badge items into observedStatusBadges', () => {
    const snapshot = makeSnapshot([
      makeBadge('Approved'),
      {
        kind: 'counter',
        matchedSelector: '[data-count]',
        text: '12',
        numericValue: 12,
        entityId: null,
        entityType: null,
        domPath: 'div/span',
        attributes: {},
        visible: true,
      },
    ]);
    const signal = extractFromSnapshot(snapshot, 'int-1');
    expect(signal.observedStatusBadges).toHaveLength(1);
    expect(signal.observedStatusBadges[0].text).toBe('Approved');
    expect(signal.observedCounters).toHaveLength(1);
  });

  it('snapshot with no badges yields empty array', () => {
    const snapshot = makeSnapshot([]);
    const signal = extractFromSnapshot(snapshot, 'int-1');
    expect(signal.observedStatusBadges).toEqual([]);
  });
});

// ── 5. StateBuilder badge → entity state ───────────────────────────────

describe('M9.9 StateBuilder badge → entity state', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder(false);
  });

  it('badge with entityId associates state with the entity', () => {
    // Seed entity via page-content observation
    builder.processSignals(makeSignalSet([makeEntityObs('101', 'leave-request', 'Ada — Vacation')], 'int-1'));

    // Badge naming that entity
    builder.processSignals(
      makeSignalSet([makeBadge('Pending', { entityId: '101', entityType: 'leave-request' })], 'int-2'),
    );

    const entity = builder.getCurrentState().entities.get('leave-request:101');
    expect(entity).toBeDefined();
    expect(entity!.currentState).toBe('pending');
  });

  it('badge with no reference associates with the sole tracked entity', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('42', 'pull-request', 'PR #42')], 'int-1'));
    builder.processSignals(makeSignalSet([makeBadge('Merged')], 'int-2'));

    const entity = builder.getCurrentState().entities.get('pull-request:42');
    expect(entity!.currentState).toBe('merged');
  });

  it('multiple entities same type: badge with entityType applies to all of that type', () => {
    builder.processSignals(makeSignalSet([
      makeEntityObs('101', 'leave-request', 'A'),
      makeEntityObs('102', 'leave-request', 'B'),
    ], 'int-1'));
    builder.processSignals(
      makeSignalSet([makeBadge('Approved', { entityType: 'leave-request' })], 'int-2'),
    );

    const state = builder.getCurrentState();
    expect(state.entities.get('leave-request:101')!.currentState).toBe('approved');
    expect(state.entities.get('leave-request:102')!.currentState).toBe('approved');
  });

  it('ambiguous badge (multi entities, different types, no type on badge) applies to most-recent entity (D11)', () => {
    builder.processSignals(makeSignalSet([
      makeEntityObs('101', 'leave-request', 'A'),
      makeEntityObs('7', 'issue', 'I'),
    ], 'int-1'));
    builder.processSignals(makeSignalSet([makeBadge('Approved')], 'int-2'));

    // D11: Previously skipped silently. Now applies to the most-recently-updated
    // entity (deterministic fallback) instead of being silently dropped.
    const state = builder.getCurrentState();
    // Exactly one entity should have the state (the most-recent one)
    const withState = [...state.entities.values()].filter((e) => e.currentState !== undefined);
    expect(withState.length).toBe(1);
    expect(withState[0].currentState).toBe('approved');
  });

  it('repeated badge observations do not duplicate history entries', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('101', 'leave-request', 'Ada — Vacation')], 'int-1'));
    builder.processSignals(makeSignalSet([makeBadge('Pending', { entityId: '101' })], 'int-2'));
    builder.processSignals(makeSignalSet([makeBadge('Pending', { entityId: '101' })], 'int-3'));

    const entity = builder.getCurrentState().entities.get('leave-request:101');
    expect(entity!.stateHistory).toHaveLength(1);
  });

  it('state transition lifecycle: pending → approved → completed', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('101', 'leave-request', 'Ada')], 'int-1'));
    builder.processSignals(makeSignalSet([makeBadge('Pending', { entityId: '101' })], 'int-2'));
    builder.processSignals(makeSignalSet([makeBadge('Approved', { entityId: '101' })], 'int-3'));
    builder.processSignals(makeSignalSet([makeBadge('Completed', { entityId: '101' })], 'int-4'));

    const entity = builder.getCurrentState().entities.get('leave-request:101');
    expect(entity!.currentState).toBe('completed');
    expect(entity!.stateHistory).toHaveLength(3);
    expect(entity!.stateHistory!.map((h) => h.to)).toEqual(['pending', 'approved', 'completed']);
  });
});

// ── 6. StateBuilder notification → entity state ────────────────────────

describe('M9.9 StateBuilder notification → entity state', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder(false);
  });

  it('notification text triggers state transition on sole entity', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('7', 'issue', 'Issue #7')], 'int-1'));

    const notifSignal = makeNotifOnlySignalSet('int-2', [
      makeNotificationSignal('int-2', 'Issue closed'),
    ]);
    builder.processSignals(notifSignal);

    const entity = builder.getCurrentState().entities.get('issue:7');
    expect(entity!.currentState).toBe('closed');
    expect(entity!.stateHistory).toHaveLength(1);
  });

  it('notification with past-tense verb triggers state', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('101', 'leave-request', 'Ada')], 'int-1'));

    builder.processSignals(
      makeNotifOnlySignalSet('int-2', [makeNotificationSignal('int-2', 'Leave request saved')]),
    );

    const entity = builder.getCurrentState().entities.get('leave-request:101');
    expect(entity!.currentState).toBe('saved');
  });

  it('notification with no recognizable state keyword is ignored', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('7', 'issue', 'Issue #7')], 'int-1'));
    builder.processSignals(
      makeNotifOnlySignalSet('int-2', [makeNotificationSignal('int-2', 'Welcome back!')]),
    );

    const entity = builder.getCurrentState().entities.get('issue:7');
    expect(entity!.currentState).toBeUndefined();
  });

  it('reset() clears state tracking', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('42', 'pull-request', 'PR #42')], 'int-1'));
    builder.processSignals(makeSignalSet([makeBadge('Open', { entityId: '42' })], 'int-2'));
    builder.reset();

    const entity = builder.getCurrentState().entities.get('pull-request:42');
    expect(entity).toBeUndefined();
  });
});

// ── 7. EntityTracker state preservation ────────────────────────────────

describe('M9.9 EntityTracker state preservation', () => {
  it('preserves currentState and stateHistory on upsert merge', () => {
    const tracker = new EntityTracker();
    tracker.upsert(makeEntity({
      currentState: 'approved',
      stateHistory: [
        { from: null, to: 'pending', changedAt: 'int-1', evidence: 'badge' },
        { from: 'pending', to: 'approved', changedAt: 'int-2', evidence: 'toast' },
      ],
    }));

    // A later upsert with no state fields (e.g., view-derived attributes)
    tracker.upsert(makeEntity({ attributes: { note: 'extra' } }));

    const entity = tracker.get('leave-request:101')!;
    expect(entity.currentState).toBe('approved');
    expect(entity.stateHistory).toHaveLength(2);
    expect(entity.attributes.note).toBe('extra');
  });

  it('new entity with no state works unchanged', () => {
    const tracker = new EntityTracker();
    tracker.upsert(makeEntity());
    const entity = tracker.get('leave-request:101')!;
    expect(entity.currentState).toBeUndefined();
    expect(entity.stateHistory).toBeUndefined();
  });
});

// ── 8. Persistence round-trip ──────────────────────────────────────────

describe('M9.9 KnowledgeEntityRow state round-trip', () => {
  it('persists currentState and stateHistory through repository upsert + read', async () => {
    const { createKnowledgeDatabase } = await import(
      '../../src/understanding/persistence/knowledge-database'
    );
    const { KnowledgeRepository } = await import(
      '../../src/understanding/persistence/knowledge-repository'
    );

    const db = createKnowledgeDatabase();
    const repo = new KnowledgeRepository(db);

    // First insert: create entity with initial state
    await repo.upsertEntity({
      key: 'app-1:leave-request:101',
      appId: 'app-1',
      entityId: 'leave-request:101',
      type: 'leave-request',
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      revision: 1,
      lastSessionId: 'session-1',
      currentState: 'pending',
      stateHistory: [
        { from: null, to: 'pending', changedAt: 'int-1', evidence: 'badge "Pending"' },
      ],
    });

    // Second insert from a different session: state advanced to approved
    await repo.upsertEntity({
      key: 'app-1:leave-request:101',
      appId: 'app-1',
      entityId: 'leave-request:101',
      type: 'leave-request',
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      revision: 1,
      lastSessionId: 'session-2',
      currentState: 'approved',
      stateHistory: [
        { from: 'pending', to: 'approved', changedAt: 'int-5', evidence: 'toast "Approved"' },
      ],
    });

    const entities = await repo.getEntities('app-1');
    expect(entities).toHaveLength(1);
    const entity = entities[0];
    expect(entity.currentState).toBe('approved');
    expect(entity.stateHistory).toBeDefined();
    expect(entity.stateHistory!.length).toBeGreaterThanOrEqual(2);
    expect(entity.stateHistory!.map((h) => h.to)).toContain('pending');
    expect(entity.stateHistory!.map((h) => h.to)).toContain('approved');
    expect(entity.revision).toBe(2);

    db.close();
  });

  it('same-session re-persist preserves existing state (idempotency)', async () => {
    const { createKnowledgeDatabase } = await import(
      '../../src/understanding/persistence/knowledge-database'
    );
    const { KnowledgeRepository } = await import(
      '../../src/understanding/persistence/knowledge-repository'
    );

    const db = createKnowledgeDatabase();
    const repo = new KnowledgeRepository(db);

    await repo.upsertEntity({
      key: 'app-1:issue:7',
      appId: 'app-1',
      entityId: 'issue:7',
      type: 'issue',
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      revision: 1,
      lastSessionId: 'session-1',
      currentState: 'open',
      stateHistory: [
        { from: null, to: 'open', changedAt: 'int-1', evidence: 'badge' },
      ],
    });

    // Same-session re-persist with different state — should NOT overwrite
    await repo.upsertEntity({
      key: 'app-1:issue:7',
      appId: 'app-1',
      entityId: 'issue:7',
      type: 'issue',
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      revision: 1,
      lastSessionId: 'session-1',
      currentState: 'closed',
      stateHistory: [
        { from: 'open', to: 'closed', changedAt: 'int-3', evidence: 'toast' },
      ],
    });

    const entities = await repo.getEntities('app-1');
    const entity = entities[0];
    // Same session: existing state preserved, revision not bumped
    expect(entity.currentState).toBe('open');
    expect(entity.revision).toBe(1);

    db.close();
  });

  it('entity without state fields persists and reads without error', async () => {
    const { createKnowledgeDatabase } = await import(
      '../../src/understanding/persistence/knowledge-database'
    );
    const { KnowledgeRepository } = await import(
      '../../src/understanding/persistence/knowledge-repository'
    );

    const db = createKnowledgeDatabase();
    const repo = new KnowledgeRepository(db);

    await repo.upsertEntity({
      key: 'app-3:product:B001',
      appId: 'app-3',
      entityId: 'product:B001',
      type: 'product',
      attributes: { title: 'Widget' },
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 1000,
      revision: 1,
      lastSessionId: 'session-1',
      // No currentState or stateHistory — backward compat
    });

    const entities = await repo.getEntities('app-3');
    expect(entities).toHaveLength(1);
    expect(entities[0].currentState).toBeUndefined();
    expect(entities[0].stateHistory).toBeUndefined();

    db.close();
  });
});

// ── 9. Consolidation ───────────────────────────────────────────────────

describe('M9.9 ConsolidatedEntity carries state from persistence', () => {
  it('KnowledgeLoader maps currentState and stateHistory', async () => {
    const { KnowledgeLoader } = await import(
      '../../src/understanding/consolidation/knowledge-loader'
    );
    const { createKnowledgeDatabase } = await import(
      '../../src/understanding/persistence/knowledge-database'
    );
    const { KnowledgeRepository } = await import(
      '../../src/understanding/persistence/knowledge-repository'
    );

    const db = createKnowledgeDatabase();
    const repo = new KnowledgeRepository(db);

    await repo.upsertApplication({
      appId: 'app-4',
      origin: 'https://hr.example.com',
      label: 'hr.example.com',
      firstSeenAt: 1000,
      lastActiveAt: 5000,
      sessionCount: 1,
      lastSessionId: 'session-1',
    });

    await repo.upsertEntity({
      key: 'app-4:leave-request:101',
      appId: 'app-4',
      entityId: 'leave-request:101',
      type: 'leave-request',
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 5000,
      revision: 2,
      lastSessionId: 'session-1',
      currentState: 'approved',
      stateHistory: [
        { from: null, to: 'pending', changedAt: 'int-1', evidence: 'badge' },
        { from: 'pending', to: 'approved', changedAt: 'int-5', evidence: 'toast' },
      ],
    });

    const loader = new KnowledgeLoader(repo);
    const knowledge = await loader.load('app-4');
    expect(knowledge).not.toBeNull();
    const entity = knowledge!.entities.find((e) => e.entityId === 'leave-request:101');
    expect(entity).toBeDefined();
    expect(entity!.currentState).toBe('approved');
    expect(entity!.stateHistory).toBeDefined();
    expect(entity!.stateHistory!.length).toBeGreaterThanOrEqual(2);

    db.close();
  });
});

// ── 10. Backward compat — no state, no regression ──────────────────────

describe('M9.9 backward compatibility', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder(false);
  });

  it('entities observed via page content with no status badges work unchanged', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('B001', 'product', 'Widget')], 'int-1'));
    const entity = builder.getCurrentState().entities.get('product:B001');
    expect(entity).toBeDefined();
    expect(entity!.currentState).toBeUndefined();
    expect(entity!.stateHistory).toBeUndefined();
  });

  it('unrecognized status badge text is silently skipped', () => {
    builder.processSignals(makeSignalSet([makeEntityObs('42', 'pull-request', 'PR #42')], 'int-1'));
    builder.processSignals(makeSignalSet([makeBadge('Some Random Text')], 'int-2'));
    const entity = builder.getCurrentState().entities.get('pull-request:42');
    expect(entity!.currentState).toBeUndefined();
  });

  it('entities without lifecycle work (Amazon product + cart)', () => {
    // Simulate Amazon-like page content: product entity, no badges
    builder.processSignals(makeSignalSet([
      makeEntityObs('B0H2Z9JL52', 'product', 'USB-C Cable'),
    ], 'int-1'));
    const state = builder.getCurrentState();
    expect(state.entities.size).toBe(1);
    const product = state.entities.get('product:B0H2Z9JL52')!;
    expect(product.type).toBe('product');
    expect(product.currentState).toBeUndefined();
  });
});
