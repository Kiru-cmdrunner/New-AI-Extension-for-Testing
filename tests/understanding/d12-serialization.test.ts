/**
 * D12 Fix — UnderstandingResult Map Serialization Tests
 *
 * Verifies that ApplicationState Map fields (entities, collections, counters)
 * are converted to JSON-safe Record objects at the UnderstandingResult
 * boundary, so that JSON.stringify does not silently drop data.
 *
 * Tests:
 *   1. serializeApplicationState converts Maps → Records
 *   2. serializeStateTransition converts both before/after
 *   3. JSON.stringify preserves all entity/collection/counter data
 *   4. Serialized result can be reconstructed (round-trip)
 *   5. Null input handled gracefully
 *
 * Architecture: D12 defect fix regression tests.
 */

import { describe, it, expect } from 'vitest';
import {
  serializeApplicationState,
  serializeStateTransition,
  serializeStateTransitions,
} from '../../src/understanding/state-builder/serialize';
import type {
  ApplicationState,
  StateTransition,
  Entity,
  Collection,
  CounterRecord,
} from '../../src/understanding/state-builder/types';

// ── Fixtures ────────────────────────────────────────────────────────────

function makeState(): ApplicationState {
  const entities = new Map<string, Entity>();
  entities.set('product-001', {
    id: 'product-001',
    type: 'product',
    attributes: { name: 'Widget', price: 29.99 },
    source: 'view-derived',
    firstSeenAt: 'int-1',
    lastUpdated: 'int-2',
    currentState: 'available',
    viewIds: ['product-list'],
  });
  entities.set('cart-item-001', {
    id: 'cart-item-001',
    type: 'cart-item',
    attributes: { sku: 'ABC', quantity: 2 },
    source: 'counter-derived',
    firstSeenAt: 'int-3',
    lastUpdated: 'int-3',
  });

  const collections = new Map<string, Collection>();
  collections.set('cart-items', {
    id: 'cart-items',
    entityType: 'cart-item',
    count: 2,
    containerPath: 'div.cart',
    lastUpdated: 'int-3',
    viewIds: ['cart-view'],
  });

  const counters = new Map<string, CounterRecord>();
  counters.set('cart-count', {
    id: 'cart-count',
    label: 'Shopping Cart',
    elementPath: 'span#cart-count',
    values: [
      { value: '0', interactionId: 'int-1', delta: null },
      { value: '2', interactionId: 'int-3', delta: 2 },
    ],
    viewIds: ['cart-view'],
  });

  return {
    currentView: { id: 'cart-view', label: 'Cart', detectedFrom: 'url-pattern', confidence: 1 },
    currentUrl: 'https://shop.example.com/cart',
    entities,
    collections,
    counters,
    notifications: [
      {
        id: 'notif-1',
        text: 'Added to cart',
        severity: 'success',
        elementPath: 'div.toast',
        appearedAt: 'int-3',
        disappearedAt: null,
      },
    ],
    lastInteractionId: 'int-3',
    interactionCount: 3,
  };
}

function makeTransition(): StateTransition {
  const before = makeState();
  // After state: one more entity, counter changed
  const after: ApplicationState = {
    ...before,
    lastInteractionId: 'int-4',
    interactionCount: 4,
    entities: new Map(before.entities),
    counters: new Map(before.counters),
  };
  after.entities.set('cart-item-002', {
    id: 'cart-item-002',
    type: 'cart-item',
    attributes: { sku: 'XYZ', quantity: 1 },
    source: 'counter-derived',
    firstSeenAt: 'int-4',
    lastUpdated: 'int-4',
  });
  after.counters.set('cart-count', {
    id: 'cart-count',
    label: 'Shopping Cart',
    elementPath: 'span#cart-count',
    values: [
      ...before.counters.get('cart-count')!.values,
      { value: '3', interactionId: 'int-4', delta: 1 },
    ],
    viewIds: ['cart-view'],
  });

  return {
    interactionId: 'int-4',
    before,
    after,
    changes: ['cart-count: 2→3', 'entity cart-item-002 added'],
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('D12 Fix — Map Serialization', () => {
  describe('serializeApplicationState', () => {
    it('converts Map entities to Record', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;
      expect(serialized).not.toBeNull();
      expect(serialized.entities).toBeTypeOf('object');
      expect(serialized.entities).not.toBeInstanceOf(Map);
      expect(Object.keys(serialized.entities)).toHaveLength(2);
      expect(serialized.entities['product-001']).toBeDefined();
      expect(serialized.entities['product-001'].attributes.name).toBe('Widget');
      expect(serialized.entities['cart-item-001'].attributes.sku).toBe('ABC');
    });

    it('converts Map collections to Record', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;
      expect(serialized.collections).not.toBeInstanceOf(Map);
      expect(Object.keys(serialized.collections)).toHaveLength(1);
      expect(serialized.collections['cart-items'].count).toBe(2);
    });

    it('converts Map counters to Record', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;
      expect(serialized.counters).not.toBeInstanceOf(Map);
      expect(Object.keys(serialized.counters)).toHaveLength(1);
      expect(serialized.counters['cart-count'].values).toHaveLength(2);
    });

    it('preserves scalar fields (currentView, currentUrl, notifications)', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;
      expect(serialized.currentView?.id).toBe('cart-view');
      expect(serialized.currentUrl).toBe('https://shop.example.com/cart');
      expect(serialized.notifications).toHaveLength(1);
      expect(serialized.notifications[0].text).toBe('Added to cart');
      expect(serialized.interactionCount).toBe(3);
    });

    it('returns null for null input', () => {
      expect(serializeApplicationState(null)).toBeNull();
    });
  });

  describe('serializeStateTransition', () => {
    it('converts both before and after states', () => {
      const transition = makeTransition();
      const serialized = serializeStateTransition(transition);
      expect(serialized.interactionId).toBe('int-4');
      expect(serialized.before.entities).not.toBeInstanceOf(Map);
      expect(serialized.after.entities).not.toBeInstanceOf(Map);
      expect(Object.keys(serialized.before.entities)).toHaveLength(2);
      expect(Object.keys(serialized.after.entities)).toHaveLength(3);
      expect(serialized.changes).toHaveLength(2);
    });
  });

  describe('serializeStateTransitions', () => {
    it('converts an array of transitions', () => {
      const transitions = [makeTransition(), makeTransition()];
      const serialized = serializeStateTransitions(transitions);
      expect(serialized).toHaveLength(2);
      expect(serialized[0].before.entities).not.toBeInstanceOf(Map);
    });
  });

  describe('JSON.stringify round-trip (the core D12 bug)', () => {
    it('JSON.stringify of serialized state preserves all entity data', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;

      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);

      // Before the fix, entities would be {} because Maps serialize to {}
      expect(parsed.entities).toBeDefined();
      expect(Object.keys(parsed.entities)).toHaveLength(2);
      expect(parsed.entities['product-001']).toBeDefined();
      expect(parsed.entities['product-001'].attributes.name).toBe('Widget');
    });

    it('JSON.stringify of serialized state preserves all collection data', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;

      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);

      expect(parsed.collections).toBeDefined();
      expect(Object.keys(parsed.collections)).toHaveLength(1);
      expect(parsed.collections['cart-items'].count).toBe(2);
    });

    it('JSON.stringify of serialized state preserves all counter data', () => {
      const state = makeState();
      const serialized = serializeApplicationState(state)!;

      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);

      expect(parsed.counters).toBeDefined();
      expect(Object.keys(parsed.counters)).toHaveLength(1);
      expect(parsed.counters['cart-count'].values).toHaveLength(2);
      expect(parsed.counters['cart-count'].values[1].delta).toBe(2);
    });

    it('JSON.stringify of serialized transition preserves before/after state', () => {
      const transition = makeTransition();
      const serialized = serializeStateTransition(transition);

      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);

      // Before the fix, before.entities and after.entities would be {}
      expect(Object.keys(parsed.before.entities)).toHaveLength(2);
      expect(Object.keys(parsed.after.entities)).toHaveLength(3);
      expect(Object.keys(parsed.after.counters)).toHaveLength(1);
      expect(parsed.after.counters['cart-count'].values).toHaveLength(3);
    });

    it('demonstrates the bug: unserialized state loses data on JSON.stringify', () => {
      const state = makeState();
      // Without serialization: Map → {} in JSON
      const rawJson = JSON.stringify(state);
      const parsed = JSON.parse(rawJson);
      // The entities Map is now empty
      expect(parsed.entities).toEqual({});
      // This proves the bug exists without the fix
      expect(Object.keys(parsed.entities)).toHaveLength(0);
    });
  });
});
