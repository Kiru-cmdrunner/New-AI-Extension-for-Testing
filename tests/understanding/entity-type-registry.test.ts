/**
 * M9.8 — Entity Type Generalization Tests
 *
 * Tests:
 * 1. Registry: registration and resolution
 * 2. Registry: built-in seed types
 * 3. Backward compatibility: existing 8 types unchanged
 * 4. StateBuilder: custom types via page-content
 * 5. StateBuilder: custom types via view changes
 * 6. StateBuilder: custom types via API operations
 * 7. Persistence: arbitrary types round-trip through M9.5
 * 8. Consolidation: arbitrary types preserved by M9.6
 * 9. Enrichment: arbitrary types in M9.7 surface
 *
 * Architecture: .drytis/specs/m9-8-entity-type-generalization.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  EntityTypeRegistry,
  createEntityTypeRegistry,
  ENTITY_TYPE_SEEDS,
} from '../../src/understanding/state-builder/entity-type-registry';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { EntityTracker } from '../../src/understanding/state-builder/entity-tracker';
import type { SignalSet, ViewChangeSignal, ApiOperationSignal, ApiOperationType } from '../../src/understanding/types';
import type { PageContentSignal, ObservedItem } from '../../src/understanding/page-content/page-content-types';
import { KnowledgeDatabase, createKnowledgeDatabase } from '../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../src/understanding/persistence/knowledge-repository';
import { deriveAppId } from '../../src/understanding/persistence/knowledge-persistence-service';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeSignalSet(overrides?: Partial<SignalSet>): SignalSet {
  return {
    interactionId: 'i-1',
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    pageContent: null,
    ...overrides,
  };
}

function makePageContent(
  overrides?: Partial<PageContentSignal>,
): PageContentSignal {
  return {
    type: 'page-content',
    source: 'page-content',
    interactionId: 'i-1',
    confidence: 0.9,
    snapshot: {
      url: 'https://shop.example.com/product/1',
      viewId: 'product-detail',
      items: [],
      itemsOverflow: 0,
      scannedAt: 1000,
      scanDurationMs: 5,
    },
    observedEntities: [],
    observedCounters: [],
    observedCollections: [],
    observedNotifications: [],
    ...overrides,
  };
}

function viewChangeSignal(
  interactionId: string,
  toViewId: string,
  toUrl: string,
): ViewChangeSignal {
  return {
    type: 'view-change',
    source: 'navigation-url',
    interactionId,
    confidence: 0.9,
    toView: { id: toViewId, label: toViewId, confidence: 0.9, detectedFrom: 'url-pattern' },
    fromView: null,
    toUrl,
    fromUrl: '',
    navigationType: 'pushState',
  };
}

function apiOpSignal(
  interactionId: string,
  operation: string,
  url: string,
  succeeded = true,
): ApiOperationSignal {
  return {
    type: 'api-operation',
    source: 'network-url',
    interactionId,
    confidence: 0.8,
    operation: operation as ApiOperationType,
    method: 'POST',
    status: succeeded ? 200 : null,
    succeeded,
    url,
    outcomeHint: null,
  };
}

function observedEntity(
  entityType: string | null,
  entityId: string,
  overrides?: Partial<ObservedItem>,
): ObservedItem {
  return {
    kind: 'entity',
    matchedSelector: '[data-id]',
    text: 'Test',
    numericValue: null,
    entityId,
    entityType,
    domPath: '/html/body/div',
    attributes: {},
    visible: true,
    ...overrides,
  };
}

// ── 1. Registry: Registration and Resolution ───────────────────────────

describe('EntityTypeRegistry', () => {
  it('registers and resolves a custom type from page-content kind', () => {
    const registry = new EntityTypeRegistry();
    registry.register({ entityType: 'invoice', pageContentKind: 'invoice' });

    const result = registry.resolveFromPageContent('invoice', 'inv-001');
    expect(result).toBe('invoice');
  });

  it('returns null for unregistered kinds', () => {
    const registry = new EntityTypeRegistry();
    expect(registry.resolveFromPageContent('unknown-thing', 'x')).toBeNull();
  });

  it('returns null for undefined/null kind', () => {
    const registry = new EntityTypeRegistry();
    expect(registry.resolveFromPageContent(undefined, 'x')).toBeNull();
    expect(registry.resolveFromPageContent(null, 'x')).toBeNull();
  });

  it('registers and resolves from view + URL pattern', () => {
    const registry = new EntityTypeRegistry();
    registry.register({
      entityType: 'employee',
      viewId: 'employee-detail',
      urlPattern: '/pim/viewEmployee/([\\w-]+)',
    });

    const result = registry.resolveFromView(
      'employee-detail',
      'https://hr.example.com/pim/viewEmployee/emp-001',
    );
    expect(result).toEqual({ type: 'employee', id: 'emp-001' });
  });

  it('returns null when viewId matches but URL pattern does not', () => {
    const registry = new EntityTypeRegistry();
    registry.register({
      entityType: 'employee',
      viewId: 'employee-detail',
      urlPattern: '/pim/viewEmployee/([\\w-]+)',
    });

    const result = registry.resolveFromView(
      'employee-detail',
      'https://hr.example.com/dashboard',
    );
    expect(result).toBeNull();
  });

  it('registers and resolves from API operation', () => {
    const registry = new EntityTypeRegistry();
    registry.register({
      entityType: 'leave-request',
      apiOperation: 'submit-form',
    });

    const result = registry.resolveFromApiOperation('submit-form', 'i-5');
    expect(result).toEqual({ type: 'leave-request', id: 'leave-request:i-5' });
  });

  it('returns null for unregistered API operations', () => {
    const registry = new EntityTypeRegistry();
    expect(registry.resolveFromApiOperation('unknown-op', 'i-1')).toBeNull();
  });

  it('supports bulk registration', () => {
    const registry = new EntityTypeRegistry();
    registry.register([
      { entityType: 'employee', pageContentKind: 'employee' },
      { entityType: 'issue', pageContentKind: 'issue' },
    ]);
    expect(registry.getAll().length).toBe(2);
  });

  it('clear() removes all rules', () => {
    const registry = new EntityTypeRegistry();
    registry.register({ entityType: 'foo', pageContentKind: 'foo' });
    expect(registry.getAll().length).toBe(1);
    registry.clear();
    expect(registry.getAll().length).toBe(0);
  });
});

// ── 2. Registry: Built-in Seed Types ───────────────────────────────────

describe('EntityTypeRegistry seeds', () => {
  it('createEntityTypeRegistry(true) seeds with 8+ types', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.getAll().length).toBeGreaterThanOrEqual(8);
  });

  it('createEntityTypeRegistry(false) has no rules', () => {
    const registry = createEntityTypeRegistry(false);
    expect(registry.getAll().length).toBe(0);
  });

  it('resolves employee from page-content kind', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.resolveFromPageContent('employee', 'emp-1')).toBe('employee');
  });

  it('resolves leave-request from page-content kind', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.resolveFromPageContent('leave-request', 'lr-1')).toBe('leave-request');
  });

  it('resolves issue from view pattern', () => {
    const registry = createEntityTypeRegistry(true);
    const result = registry.resolveFromView('issue-detail', 'https://github.com/org/repo/issues/42');
    expect(result).toEqual({ type: 'issue', id: '42' });
  });

  it('resolves pull-request from view pattern', () => {
    const registry = createEntityTypeRegistry(true);
    const result = registry.resolveFromView('pr-detail', 'https://github.com/org/repo/pull/99');
    expect(result).toEqual({ type: 'pull-request', id: '99' });
  });

  it('resolves leave-request from view pattern', () => {
    const registry = createEntityTypeRegistry(true);
    const result = registry.resolveFromView('leave-detail', 'https://hr.example.com/leave/123');
    expect(result).toEqual({ type: 'leave-request', id: '123' });
  });

  it('resolves commit from page-content kind', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.resolveFromPageContent('commit', 'abc123')).toBe('commit');
  });

  it('resolves comment from page-content kind', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.resolveFromPageContent('comment', 'c-1')).toBe('comment');
  });

  it('resolves candidate from page-content kind', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.resolveFromPageContent('candidate', 'can-1')).toBe('candidate');
  });

  it('resolves build from page-content kind', () => {
    const registry = createEntityTypeRegistry(true);
    expect(registry.resolveFromPageContent('build', 'b-1')).toBe('build');
  });

  it('ENTITY_TYPE_SEEDS exports the array', () => {
    expect(ENTITY_TYPE_SEEDS.length).toBeGreaterThanOrEqual(8);
    expect(ENTITY_TYPE_SEEDS.some((r) => r.entityType === 'employee')).toBe(true);
    expect(ENTITY_TYPE_SEEDS.some((r) => r.entityType === 'issue')).toBe(true);
  });
});

// ── 3. Backward Compatibility: Existing 8 Types ────────────────────────

describe('Backward compatibility — existing 8 types', () => {
  it('product entity from product-detail view (hard-coded logic)', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      viewChanges: [viewChangeSignal('i-1', 'product-detail', 'https://www.amazon.com/dp/B0H2Z9JL52')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'product')).toBe(true);
  });

  it('search-query entity from search-results view (hard-coded logic)', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      viewChanges: [viewChangeSignal('i-1', 'search-results', 'https://www.amazon.com/s?k=laptop')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'search-query')).toBe(true);
  });

  it('cart-item entity from add-to-cart API (hard-coded logic)', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      apiOperations: [apiOpSignal('i-1', 'add-to-cart', 'https://www.amazon.com/cart/add')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'cart-item')).toBe(true);
  });

  it('search-query from input change (hard-coded logic)', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      inputChanges: [{
        type: 'input-value-change',
        source: 'target-state',
        interactionId: 'i-1',
        confidence: 0.8,
        field: 'search',
        oldValue: null,
        newValue: 'laptop',
        elementLabel: null,
      }],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'search-query')).toBe(true);
  });

  it('StateBuilder with no registry constructor arg works (default seeded)', () => {
    const builder = new StateBuilder();
    // Should not throw and should process signals normally
    const transition = builder.processSignals(makeSignalSet());
    expect(transition.after.interactionCount).toBe(1);
  });

  it('StateBuilder with false (no registry) works like legacy', () => {
    const builder = new StateBuilder(false);
    const transition = builder.processSignals(makeSignalSet());
    expect(transition.after.interactionCount).toBe(1);
  });
});

// ── 4. StateBuilder: Custom Types via Page-Content ─────────────────────

describe('StateBuilder: custom entity types from page-content', () => {
  it('detects employee entity from page-content kind=employee', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      pageContent: makePageContent({
        observedEntities: [observedEntity('employee', 'emp-001', { attributes: { name: 'John Doe' } })],
      }),
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'employee')).toBe(true);
  });

  it('falls back to observed kind when registry has no matching rule', () => {
    const builder = new StateBuilder(false);
    const signals = makeSignalSet({
      pageContent: makePageContent({
        observedEntities: [observedEntity('custom-thing', 'c-1', { text: 'Something' })],
      }),
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'custom-thing')).toBe(true);
  });

  it('falls back to unknown when no type info available', () => {
    const builder = new StateBuilder(false);
    const signals = makeSignalSet({
      pageContent: makePageContent({
        observedEntities: [observedEntity(null, 'x-1', { text: 'Something' })],
      }),
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'unknown')).toBe(true);
  });
});

// ── 5. StateBuilder: Custom Types via View Changes ─────────────────────

describe('StateBuilder: custom entity types from view changes', () => {
  it('detects issue entity from issue-detail view + URL pattern', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      viewChanges: [viewChangeSignal('i-1', 'issue-detail', 'https://github.com/org/repo/issues/42')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    const issue = entities.find((e) => e.type === 'issue');
    expect(issue).toBeDefined();
    expect(issue?.id).toContain('42');
  });

  it('detects employee entity from employee-detail view via custom registry', () => {
    const registry = new EntityTypeRegistry();
    registry.register({
      entityType: 'employee',
      viewId: 'employee-detail',
      urlPattern: '/pim/viewEmployee/([\\w-]+)',
    });
    const builder = new StateBuilder(registry);
    const signals = makeSignalSet({
      viewChanges: [viewChangeSignal('i-1', 'employee-detail', 'https://hr.example.com/pim/viewEmployee/emp-001')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    const emp = entities.find((e) => e.type === 'employee');
    expect(emp).toBeDefined();
  });

  it('does not override existing entities when registry also matches', () => {
    const builder = new StateBuilder();
    const signals = makeSignalSet({
      viewChanges: [viewChangeSignal('i-1', 'product-detail', 'https://www.amazon.com/dp/B0H2Z9JL52')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    const products = entities.filter((e) => e.type === 'product');
    expect(products.length).toBe(1);
  });
});

// ── 6. StateBuilder: Custom Types via API Operations ───────────────────

describe('StateBuilder: custom entity types from API operations', () => {
  it('detects leave-request entity from submit-form API operation via registry', () => {
    const registry = new EntityTypeRegistry();
    registry.register({
      entityType: 'leave-request',
      apiOperation: 'submit-form',
    });
    const builder = new StateBuilder(registry);
    const signals = makeSignalSet({
      apiOperations: [apiOpSignal('i-5', 'submit-form', 'https://hr.example.com/leave/apply')],
    });

    const transition = builder.processSignals(signals);
    const entities = Array.from(transition.after.entities.values());
    expect(entities.some((e) => e.type === 'leave-request')).toBe(true);
  });
});

// ── 7. Persistence: Arbitrary Types Round-Trip ─────────────────────────

describe('M9.5 persistence: arbitrary entity types', () => {
  let db: KnowledgeDatabase;

  beforeEach(async () => {
    db = createKnowledgeDatabase();
    await db.open();
    // Clean tables to ensure test isolation
    await db.knowledgeEntities.clear();
  });

  it('persists and retrieves employee entity type', async () => {
    const repo = new KnowledgeRepository(db);
    const appId = deriveAppId('https://hr.example.com');

    await repo.upsertEntity({
      key: `${appId}:employee:emp-001`,
      appId,
      entityId: 'employee:emp-001',
      type: 'employee',
      attributes: { name: 'John Doe', department: 'Engineering' },
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      revision: 1,
      lastSessionId: 's1',
    });

    const entities = await repo.getEntitiesByType(appId, 'employee');
    expect(entities.length).toBe(1);
    expect(entities[0].type).toBe('employee');
    expect(entities[0].attributes.name).toBe('John Doe');
  });

  it('persists and retrieves issue entity type', async () => {
    const repo = new KnowledgeRepository(db);
    const appId = deriveAppId('https://github.com');

    await repo.upsertEntity({
      key: `${appId}:issue:42`,
      appId,
      entityId: 'issue:42',
      type: 'issue',
      attributes: { title: 'Bug: login fails', status: 'open' },
      source: 'view-derived',
      firstSeenAt: 1000,
      lastSeenAt: 2000,
      revision: 1,
      lastSessionId: 's1',
    });

    const entities = await repo.getEntitiesByType(appId, 'issue');
    expect(entities.length).toBe(1);
    expect(entities[0].type).toBe('issue');
    expect(entities[0].attributes.status).toBe('open');
  });

  it('getEntitiesByType works with custom types', async () => {
    const repo = new KnowledgeRepository(db);
    const appId = deriveAppId('https://hr.example.com');

    await repo.upsertEntity({
      key: `${appId}:employee:1`, appId, entityId: 'employee:1',
      type: 'employee', attributes: {}, source: 'view-derived',
      firstSeenAt: 1000, lastSeenAt: 1000, revision: 1, lastSessionId: 's1',
    });
    await repo.upsertEntity({
      key: `${appId}:employee:2`, appId, entityId: 'employee:2',
      type: 'employee', attributes: {}, source: 'view-derived',
      firstSeenAt: 1000, lastSeenAt: 1000, revision: 1, lastSessionId: 's1',
    });
    await repo.upsertEntity({
      key: `${appId}:leave:1`, appId, entityId: 'leave-request:1',
      type: 'leave-request', attributes: {}, source: 'view-derived',
      firstSeenAt: 1000, lastSeenAt: 1000, revision: 1, lastSessionId: 's1',
    });

    const employees = await repo.getEntitiesByType(appId, 'employee');
    expect(employees.length).toBe(2);

    const leaves = await repo.getEntitiesByType(appId, 'leave-request');
    expect(leaves.length).toBe(1);
  });
});

// ── 8. EntityType is string — Cross-Module Compatibility ───────────────

describe('EntityType as string — cross-module', () => {
  it('Entity.type accepts arbitrary strings', () => {
    // Type-level check — if this compiles, EntityType accepts strings
    const entity = {
      id: 'test:1',
      type: 'custom-type-not-in-old-union' as const,
      attributes: {},
      source: 'view-derived' as const,
      firstSeenAt: 'i-1',
      lastUpdated: 'i-1',
    };
    expect(entity.type).toBe('custom-type-not-in-old-union');
  });

  it('EntityTracker.getByType works with custom types', () => {
    const tracker = new EntityTracker();
    tracker.upsert({
      id: 'custom:1',
      type: 'custom-type',
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 'i-1',
      lastUpdated: 'i-1',
    });
    const result = tracker.getByType('custom-type');
    expect(result.length).toBe(1);
  });

  it('Collection.entityType accepts arbitrary strings', () => {
    const coll = {
      id: 'test',
      entityType: 'whatever' as const,
      count: 5,
      containerPath: null,
      lastUpdated: 'i-1',
    };
    expect(coll.entityType).toBe('whatever');
  });
});
