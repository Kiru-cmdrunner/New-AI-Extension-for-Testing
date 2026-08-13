/**
 * M9.2 — State Builder + Entity/Collection/Counter Tracking
 * Focused tests.
 *
 * Covers:
 *  - View state + continuity across interactions
 *  - Entity tracking (products, search queries, cart items)
 *  - Collection tracking (list size changes)
 *  - Counter tracking (value history + deltas)
 *  - Notification tracking (appearance/disappearance)
 *  - Reset
 *  - Amazon workflow validation (end-to-end signal sequence)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import type { SignalSet, ViewDescriptor } from '../../src/understanding/types';

// -- Fixtures --

function makeSignalSet(interactionId: string, overrides: Partial<SignalSet> = {}): SignalSet {
  return {
    interactionId,
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    ...overrides,
  };
}

const SEARCH_VIEW: ViewDescriptor = {
  id: 'search-results',
  label: 'Search Results',
  detectedFrom: 'url-pattern',
  confidence: 0.9,
};

const PDP_VIEW: ViewDescriptor = {
  id: 'product-detail',
  label: 'Product Detail',
  detectedFrom: 'url-pattern',
  confidence: 0.95,
};

const CART_CONFIRM_VIEW: ViewDescriptor = {
  id: 'cart-confirmation',
  label: 'Cart Confirmation',
  detectedFrom: 'url-pattern',
  confidence: 0.9,
};

function mkViewChange(
  iid: string,
  fromV: ViewDescriptor | null,
  toV: ViewDescriptor,
  fromUrl: string,
  toUrl: string,
) {
  return {
    type: 'view-change' as const,
    source: 'navigation-url' as const,
    interactionId: iid,
    confidence: 0.9,
    fromView: fromV ? { ...fromV } : null,
    toView: { ...toV },
    fromUrl,
    toUrl,
    navigationType: 'full-reload' as const,
  };
}

function mkList(iid: string, containerPath: string, addedCount: number, removedCount: number) {
  return {
    type: 'list-change' as const,
    source: 'dom-mutation' as const,
    interactionId: iid,
    confidence: 0.7,
    containerPath,
    containerTag: 'div',
    addedCount,
    removedCount,
    netChange: addedCount - removedCount,
  };
}

function mkCounter(iid: string, path: string, oldV: string, newV: string) {
  return {
    type: 'counter-change' as const,
    source: 'dom-mutation' as const,
    interactionId: iid,
    confidence: 0.8,
    elementPath: path,
    oldValue: oldV,
    newValue: newV,
    numericDelta: Number(newV) - Number(oldV),
    label: null as string | null,
  };
}

function mkNotif(iid: string, kind: 'appeared' | 'disappeared', text: string, path: string) {
  return {
    type: 'notification' as const,
    source: 'surface' as const,
    interactionId: iid,
    confidence: 0.8,
    text,
    severity: 'success' as const,
    kind,
    elementPath: path,
  };
}

function mkApiOp(
  iid: string,
  operation: 'add-to-cart' | 'search-autocomplete' | 'search' | 'submit-form',
  url: string,
  status: number,
) {
  return {
    type: 'api-operation' as const,
    source: 'network-url' as const,
    interactionId: iid,
    confidence: 0.8,
    operation,
    method: 'POST',
    status,
    succeeded: status >= 200 && status < 300,
    url,
    outcomeHint: null as null,
  };
}

function mkInput(iid: string, field: string, oldV: string, newV: string) {
  return {
    type: 'input-value-change' as const,
    source: 'target-state' as const,
    interactionId: iid,
    confidence: 0.8,
    field,
    oldValue: oldV,
    newValue: newV,
    elementLabel: null as string | null,
  };
}

// -- View state and continuity --

describe('M9.2 StateBuilder - view state', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder();
  });

  it('starts with null view and empty state', () => {
    const state = builder.getCurrentState();
    expect(state.currentView).toBeNull();
    expect(state.currentUrl).toBeNull();
    expect(state.entities.size).toBe(0);
    expect(state.collections.size).toBe(0);
    expect(state.counters.size).toBe(0);
    expect(state.notifications.length).toBe(0);
    expect(state.interactionCount).toBe(0);
  });

  it('applies a view change and tracks current view', () => {
    builder.processSignals(
      makeSignalSet('int-1', {
        viewChanges: [
          mkViewChange('int-1', null, SEARCH_VIEW, 'https://example.com/', 'https://example.com/s?k=vivo'),
        ],
      }),
    );

    const state = builder.getCurrentState();
    expect(state.currentView?.id).toBe('search-results');
    expect(state.currentUrl).toBe('https://example.com/s?k=vivo');
    expect(state.interactionCount).toBe(1);
  });

  it('maintains view continuity across interactions without view changes', () => {
    builder.processSignals(
      makeSignalSet('int-1', {
        viewChanges: [
          mkViewChange('int-1', null, SEARCH_VIEW, 'https://example.com/', 'https://example.com/s?k=vivo'),
        ],
      }),
    );

    // int-2: no view change (e.g., scrolling)
    const t2 = builder.processSignals(makeSignalSet('int-2'));

    expect(t2.after.currentView?.id).toBe('search-results');
    expect(t2.after.interactionCount).toBe(2);
    expect(t2.after.lastInteractionId).toBe('int-2');
  });

  it('produces before/after snapshots in StateTransition', () => {
    const t = builder.processSignals(
      makeSignalSet('int-1', {
        viewChanges: [
          mkViewChange('int-1', null, SEARCH_VIEW, 'https://example.com/', 'https://example.com/s?k=vivo'),
        ],
      }),
    );

    expect(t.before.currentView).toBeNull();
    expect(t.after.currentView?.id).toBe('search-results');
    expect(t.changes).toContain('view \u2192 search-results');
  });
});

// -- Entity tracking --

describe('M9.2 StateBuilder - entity tracking', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder();
  });

  it('derives product entity from PDP navigation', () => {
    builder.processSignals(
      makeSignalSet('int-3', {
        viewChanges: [
          mkViewChange('int-3', SEARCH_VIEW, PDP_VIEW, 'https://example.com/s?k=vivo', 'https://example.com/dp/B0XYZ12345'),
        ],
      }),
    );

    const entities = builder.getCurrentState().entities;
    const product = entities.get('product:B0XYZ12345');
    expect(product).toBeDefined();
    expect(product?.type).toBe('product');
    expect(product?.attributes.asin).toBe('B0XYZ12345');
    expect(product?.source).toBe('view-derived');
  });

  it('derives search-query entity from URL on view change', () => {
    builder.processSignals(
      makeSignalSet('int-1', {
        viewChanges: [
          mkViewChange('int-1', null, SEARCH_VIEW, 'https://example.com/', 'https://example.com/s?k=vivo'),
        ],
      }),
    );

    const queries = Array.from(builder.getCurrentState().entities.values()).filter(
      (e) => e.type === 'search-query',
    );
    expect(queries.length).toBe(1);
    expect(queries[0].attributes.term).toBe('vivo');
    expect(queries[0].source).toBe('view-derived');
  });

  it('derives cart-item entity from add-to-cart API operation', () => {
    builder.processSignals(
      makeSignalSet('int-19', {
        apiOperations: [
          mkApiOp('int-19', 'add-to-cart', 'https://example.com/cart/add-to-cart/json', 200),
        ],
      }),
    );

    const cartItems = Array.from(builder.getCurrentState().entities.values()).filter(
      (e) => e.type === 'cart-item',
    );
    expect(cartItems.length).toBe(1);
    expect(cartItems[0].source).toBe('inferred');
  });

  it('does not create cart-item entity when API fails', () => {
    builder.processSignals(
      makeSignalSet('int-19', {
        apiOperations: [
          mkApiOp('int-19', 'add-to-cart', 'https://example.com/cart/add-to-cart/json', 503),
        ],
      }),
    );

    const cartItems = Array.from(builder.getCurrentState().entities.values()).filter(
      (e) => e.type === 'cart-item',
    );
    expect(cartItems.length).toBe(0);
  });

  it('upserts entities - re-visit updates lastUpdated without duplicating', () => {
    const mk = (iid: string): SignalSet =>
      makeSignalSet(iid, {
        viewChanges: [
          mkViewChange(iid, SEARCH_VIEW, PDP_VIEW, 'https://example.com/s?k=vivo', 'https://example.com/dp/B0XYZ12345'),
        ],
      });

    builder.processSignals(mk('int-3'));
    builder.processSignals(mk('int-7'));

    const state = builder.getCurrentState();
    const products = Array.from(state.entities.values()).filter((e) => e.type === 'product');
    expect(products.length).toBe(1);
    expect(products[0].firstSeenAt).toBe('int-3');
    expect(products[0].lastUpdated).toBe('int-7');
  });

  it('derives search-query entity from input-value-change on search field', () => {
    builder.processSignals(
      makeSignalSet('int-8', {
        inputChanges: [mkInput('int-8', 'search-field', 'viv', 'vivo')],
      }),
    );

    const queries = Array.from(builder.getCurrentState().entities.values()).filter(
      (e) => e.type === 'search-query',
    );
    expect(queries.length).toBe(1);
    expect(queries[0].attributes.term).toBe('vivo');
    expect(queries[0].source).toBe('target-derived');
  });
});

// -- Collection tracking --

describe('M9.2 StateBuilder - collection tracking', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder();
  });

  it('creates collection on first list change and tracks size', () => {
    builder.processSignals(
      makeSignalSet('int-11', {
        listChanges: [mkList('int-11', 'div.s-main-slot', 5, 0)],
      }),
    );

    const collections = builder.getCurrentState().collections;
    expect(collections.size).toBe(1);
    const coll = Array.from(collections.values())[0];
    expect(coll.count).toBe(5);
    expect(coll.containerPath).toBe('div.s-main-slot');
  });

  it('applies net changes across interactions for continuity', () => {
    builder.processSignals(
      makeSignalSet('int-11', {
        listChanges: [mkList('int-11', 'div.s-main-slot', 5, 0)],
      }),
    );
    builder.processSignals(
      makeSignalSet('int-12', {
        listChanges: [mkList('int-12', 'div.s-main-slot', 0, 2)],
      }),
    );

    const collections = builder.getCurrentState().collections;
    const coll = Array.from(collections.values())[0];
    expect(coll.count).toBe(3);
  });

  it('clamps collection size at zero (never negative)', () => {
    builder.processSignals(
      makeSignalSet('int-11', {
        listChanges: [mkList('int-11', 'ul.results', 2, 0)],
      }),
    );
    builder.processSignals(
      makeSignalSet('int-12', {
        listChanges: [mkList('int-12', 'ul.results', 0, 10)],
      }),
    );

    const collections = builder.getCurrentState().collections;
    const coll = Array.from(collections.values())[0];
    expect(coll.count).toBe(0);
  });
});

// -- Counter tracking --

describe('M9.2 StateBuilder - counter tracking', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder();
  });

  it('creates counter on first change with initial value', () => {
    builder.processSignals(
      makeSignalSet('int-2', {
        counterChanges: [mkCounter('int-2', '#nav-cart-count', '0', '1')],
      }),
    );

    const counters = builder.getCurrentState().counters;
    expect(counters.size).toBe(1);
    const ctr = Array.from(counters.values())[0];
    expect(ctr.elementPath).toBe('#nav-cart-count');
    expect(ctr.values.length).toBe(1);
    expect(ctr.values[0].value).toBe('1');
    // First observation has no previous value — delta is null
    expect(ctr.values[0].delta).toBeNull();
  });

  it('maintains value history with per-change deltas', () => {
    builder.processSignals(
      makeSignalSet('int-2', { counterChanges: [mkCounter('int-2', '#nav-cart-count', '0', '1')] }),
    );
    builder.processSignals(
      makeSignalSet('int-5', { counterChanges: [mkCounter('int-5', '#nav-cart-count', '1', '3')] }),
    );
    builder.processSignals(
      makeSignalSet('int-9', { counterChanges: [mkCounter('int-9', '#nav-cart-count', '3', '2')] }),
    );

    const counters = builder.getCurrentState().counters;
    const ctr = Array.from(counters.values())[0];
    expect(ctr.values.length).toBe(3);
    expect(ctr.values.map((v) => v.value)).toEqual(['1', '3', '2']);
    // First entry has no previous, so delta is null; subsequent entries compute deltas
    expect(ctr.values.map((v) => v.delta)).toEqual([null, 2, -1]);
  });

  it('tracks multiple counters independently', () => {
    builder.processSignals(
      makeSignalSet('int-2', { counterChanges: [mkCounter('int-2', '#nav-cart-count', '0', '1')] }),
    );
    builder.processSignals(
      makeSignalSet('int-3', { counterChanges: [mkCounter('int-3', '#wishlist-count', '0', '1')] }),
    );

    const counters = builder.getCurrentState().counters;
    expect(counters.size).toBe(2);
    const paths = Array.from(counters.values()).map((c) => c.elementPath).sort();
    expect(paths).toEqual(['#nav-cart-count', '#wishlist-count']);
  });
});

// -- Notification tracking --

describe('M9.2 StateBuilder - notification tracking', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder();
  });

  it('records notification appearance', () => {
    builder.processSignals(
      makeSignalSet('int-20', {
        notifications: [mkNotif('int-20', 'appeared', 'Added to Cart', 'div#sw-atc-confirmation')],
      }),
    );

    const notifications = builder.getCurrentState().notifications;
    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toBe('Added to Cart');
    expect(notifications[0].severity).toBe('success');
    expect(notifications[0].appearedAt).toBe('int-20');
    expect(notifications[0].disappearedAt).toBeNull();
  });

  it('records disappearance completing the lifecycle', () => {
    builder.processSignals(
      makeSignalSet('int-20', {
        notifications: [mkNotif('int-20', 'appeared', 'Added to Cart', 'div#sw-atc-confirmation')],
      }),
    );
    builder.processSignals(
      makeSignalSet('int-21', {
        notifications: [mkNotif('int-21', 'disappeared', 'Added to Cart', 'div#sw-atc-confirmation')],
      }),
    );

    const notifications = builder.getCurrentState().notifications;
    expect(notifications.length).toBe(1);
    expect(notifications[0].disappearedAt).toBe('int-21');
  });
});

// -- Reset --

describe('M9.2 StateBuilder - reset', () => {
  it('clears all state on reset', () => {
    const builder = new StateBuilder();
    builder.processSignals(
      makeSignalSet('int-1', {
        viewChanges: [
          mkViewChange('int-1', null, SEARCH_VIEW, 'https://example.com/', 'https://example.com/s?k=test'),
        ],
        counterChanges: [mkCounter('int-1', '#cart-count', '0', '1')],
      }),
    );

    builder.reset();

    const state = builder.getCurrentState();
    expect(state.currentView).toBeNull();
    expect(state.currentUrl).toBeNull();
    expect(state.entities.size).toBe(0);
    expect(state.collections.size).toBe(0);
    expect(state.counters.size).toBe(0);
    expect(state.notifications.length).toBe(0);
    expect(state.interactionCount).toBe(0);
  });
});

// -- Full Amazon workflow --

describe('M9.2 StateBuilder - Amazon workflow validation', () => {
  it('builds coherent state across the vivo Y11 5G workflow', () => {
    const builder = new StateBuilder();

    // int-8: typing 'vivo' -> search suggestions API + input change
    const t8 = builder.processSignals(
      makeSignalSet('int-8', {
        inputChanges: [mkInput('int-8', 'search-field', 'viv', 'vivo')],
        apiOperations: [
          {
            type: 'api-operation',
            source: 'network-url',
            interactionId: 'int-8',
            confidence: 0.8,
            operation: 'search-autocomplete',
            method: 'GET',
            status: 200,
            succeeded: true,
            url: 'https://example.com/complete/search?q=vivo',
            outcomeHint: null,
          },
        ],
      }),
    );

    // int-11: submit search -> search results view + results list
    builder.processSignals(
      makeSignalSet('int-11', {
        viewChanges: [
          mkViewChange('int-11', null, SEARCH_VIEW, 'https://example.com/', 'https://example.com/s?k=vivo'),
        ],
        listChanges: [mkList('int-11', 'div.s-main-slot', 48, 0)],
      }),
    );

    // int-17: click product -> PDP view + product entity
    const t17 = builder.processSignals(
      makeSignalSet('int-17', {
        viewChanges: [
          mkViewChange('int-17', SEARCH_VIEW, PDP_VIEW, 'https://example.com/s?k=vivo', 'https://example.com/dp/B0XYZ12345'),
        ],
      }),
    );

    // int-19: Add to cart (0ms window, full-page reload - no signals captured)
    const t19 = builder.processSignals(makeSignalSet('int-19'));

    // int-20: cart confirmation view + counter + notification + add-to-cart API
    builder.processSignals(
      makeSignalSet('int-20', {
        viewChanges: [
          mkViewChange('int-20', SEARCH_VIEW, CART_CONFIRM_VIEW, 'https://example.com/dp/B0XYZ12345', 'https://example.com/cart/add-to-cart/'),
        ],
        counterChanges: [mkCounter('int-20', '#nav-cart-count', '0', '1')],
        notifications: [mkNotif('int-20', 'appeared', 'Added to Cart', 'div#sw-atc-confirmation')],
        apiOperations: [
          mkApiOp('int-20', 'add-to-cart', 'https://example.com/cart/add-to-cart/json', 200),
        ],
      }),
    );

    // -- Assertions on final state --
    const state = builder.getCurrentState();

    // View continuity
    expect(state.currentView?.id).toBe('cart-confirmation');
    expect(state.interactionCount).toBe(5);
    expect(state.lastInteractionId).toBe('int-20');

    // Entities: product, search-query, cart-item
    const entityTypes = Array.from(state.entities.values()).map((e) => e.type).sort();
    expect(entityTypes).toContain('product');
    expect(entityTypes).toContain('search-query');
    expect(entityTypes).toContain('cart-item');

    // Product entity created at int-17
    const product = state.entities.get('product:B0XYZ12345');
    expect(product).toBeDefined();
    expect(product?.firstSeenAt).toBe('int-17');

    // Counters
    expect(state.counters.size).toBe(1);
    const cartCounter = Array.from(state.counters.values())[0];
    expect(cartCounter.elementPath).toBe('#nav-cart-count');
    expect(cartCounter.values.length).toBe(1);
    expect(cartCounter.values[0].value).toBe('1');

    // Notifications
    expect(state.notifications.length).toBe(1);
    expect(state.notifications[0].text).toBe('Added to Cart');

    // Collections (search results list)
    expect(state.collections.size).toBe(1);
    const coll = Array.from(state.collections.values())[0];
    expect(coll.count).toBe(48);

    // Transitions captured before/after snapshots
    expect(t8.before.currentView).toBeNull();
    expect(t17.after.entities.get('product:B0XYZ12345')).toBeDefined();

    // int-19 had no signals -> no state changes, but view persisted from int-17
    expect(t19.changes.length).toBe(0);
    expect(t19.after.currentView?.id).toBe('product-detail');
  });
});
