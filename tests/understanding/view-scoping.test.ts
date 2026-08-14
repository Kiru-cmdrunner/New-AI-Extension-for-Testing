/**
 * D5 — View-Level Entity Scoping Tests
 *
 * Verifies that entities, collections, and counters are attributed
 * to the views where they were actually observed — not broadcast
 * to every view.
 *
 * Architecture: .drytis/specs/deterministic-defects.md §D5
 */

import { describe, it, expect } from 'vitest';
import { buildApplicationSurface } from '../../src/understanding/enrichment/application-surface';
import type { ApplicationState, StateTransition } from '../../src/understanding/state-builder/types';
import type { ViewDescriptor } from '../../src/understanding/types';

function makeView(id: string): ViewDescriptor {
  return { id, label: id, matchedSelectors: [], matchedPatterns: [] } as unknown as ViewDescriptor;
}

function makeState(
  entities: Array<{ id: string; type: string; viewIds?: string[] }>,
  currentViewId: string | null = null,
): ApplicationState {
  const entityMap = new Map();
  for (const e of entities) {
    entityMap.set(e.id, {
      id: e.id,
      type: e.type,
      attributes: {},
      source: 'view-derived',
      firstSeenAt: 'int-1',
      lastUpdated: 'int-1',
      viewIds: e.viewIds,
    });
  }
  return {
    currentView: currentViewId ? makeView(currentViewId) : null,
    currentUrl: 'https://example.com/',
    entities: entityMap,
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: 'int-1',
    interactionCount: 1,
  } as unknown as ApplicationState;
}

function makeTransition(
  beforeViewId: string | null,
  afterViewId: string,
): StateTransition {
  return {
    interactionId: 'int-1',
    before: makeState([], beforeViewId),
    after: makeState([], afterViewId),
    changes: [],
  } as unknown as StateTransition;
}

describe('D5 — View-Level Entity Scoping', () => {
  it('entity observed on one view appears only in that view', () => {
    const state = makeState(
      [{ id: 'product:B001', type: 'product', viewIds: ['product-detail'] }],
    );
    const transitions = [
      makeTransition('search-results', 'product-detail'),
      makeTransition('product-detail', 'cart'),
      makeTransition('cart', 'login'),
    ];

    const surface = buildApplicationSurface(
      state,
      [], // interactions
      [], // components
      [], // contracts
      new Map(), // intents
      transitions,
    );

    const productView = surface.views.find((v) => v.viewId === 'product-detail');
    const cartView = surface.views.find((v) => v.viewId === 'cart');
    const loginView = surface.views.find((v) => v.viewId === 'login');

    expect(productView?.entityTypeRefs).toContain('product');
    expect(cartView?.entityTypeRefs).not.toContain('product');
    expect(loginView?.entityTypeRefs).not.toContain('product');
  });

  it('entity observed on multiple views appears in each', () => {
    const state = makeState(
      [{ id: 'product:B001', type: 'product', viewIds: ['product-detail', 'cart'] }],
    );
    const transitions = [
      makeTransition('search-results', 'product-detail'),
      makeTransition('product-detail', 'cart'),
    ];

    const surface = buildApplicationSurface(
      state,
      [],
      [],
      [],
      new Map(),
      transitions,
    );

    const productView = surface.views.find((v) => v.viewId === 'product-detail');
    const cartView = surface.views.find((v) => v.viewId === 'cart');

    expect(productView?.entityTypeRefs).toContain('product');
    expect(cartView?.entityTypeRefs).toContain('product');
  });

  it('entity with no viewIds falls back to broadcast (legacy compat)', () => {
    const state = makeState(
      [{ id: 'entity:legacy', type: 'legacy', viewIds: undefined }],
    );
    const transitions = [
      makeTransition('view-a', 'view-b'),
    ];

    const surface = buildApplicationSurface(
      state,
      [],
      [],
      [],
      new Map(),
      transitions,
    );

    // Without viewIds, entity appears in all views (backward compat)
    const viewA = surface.views.find((v) => v.viewId === 'view-a');
    const viewB = surface.views.find((v) => v.viewId === 'view-b');
    expect(viewA?.entityTypeRefs).toContain('legacy');
    expect(viewB?.entityTypeRefs).toContain('legacy');
  });

  it('different entities on different views do not cross-contaminate', () => {
    const state = makeState(
      [
        { id: 'employee:1', type: 'employee', viewIds: ['employee-list'] },
        { id: 'leave:1', type: 'leave-request', viewIds: ['leave-list'] },
      ],
    );
    const transitions = [
      makeTransition('employee-list', 'leave-list'),
    ];

    const surface = buildApplicationSurface(
      state,
      [],
      [],
      [],
      new Map(),
      transitions,
    );

    const empView = surface.views.find((v) => v.viewId === 'employee-list');
    const leaveView = surface.views.find((v) => v.viewId === 'leave-list');

    expect(empView?.entityTypeRefs).toContain('employee');
    expect(empView?.entityTypeRefs).not.toContain('leave-request');
    expect(leaveView?.entityTypeRefs).toContain('leave-request');
    expect(leaveView?.entityTypeRefs).not.toContain('employee');
  });
});
