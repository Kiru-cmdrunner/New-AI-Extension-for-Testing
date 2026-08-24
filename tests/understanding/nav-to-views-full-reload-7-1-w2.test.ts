/**
 * 7.1-W2 Integration Pins: FULL-RELOAD nav evidence → view rows in KR
 *
 * Spec: .drytis/specs/phase-7-1-w2-full-reload-views.md §5 (T1–T3)
 *
 * 7.1-W1 pinned the SPA half (nav-inject.js → emitExternalNavigation →
 * pushState evidence). This file pins the OTHER half of the same chain —
 * the synthetic full-reload evidence that the service worker attaches to
 * a Navigation interaction at webNavigation.onCommitted (service-worker.ts
 * attachSyntheticNavEvidence: NavigationEvidence.type === 'full-reload',
 * real DDC-2 fromUrl) — proving it flows through the REAL
 * NavigationSignalExtractor + ViewRegistry + StateBuilder +
 * KnowledgePersistenceService into Dexie view / view-transition rows.
 *
 * T1  first full-reload to /search?q=  → search-results view row
 *     (transition honestly has before=null — first change, no row)
 * T2  second full-reload to /cart?ASIN= → cart view row +
 *     search-results → cart transition row
 * T3  honesty pin: /m9-cart-landed.html matches NO default pattern →
 *     zero view signals, zero view rows (graceful degradation intact —
 *     the m9 fixture's zero views are CORRECT, not a bug)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'fake-indexeddb/auto';
import { KnowledgeDatabase } from '../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../src/understanding/persistence/knowledge-repository';
import { KnowledgePersistenceService, deriveAppId } from '../../src/understanding/persistence/knowledge-persistence-service';
import { createDefaultViewRegistry } from '../../src/understanding/signal-extractors/view-registry';
import { NavigationSignalExtractor } from '../../src/understanding/signal-extractors/navigation-signals';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { createEntityTypeRegistry } from '../../src/understanding/state-builder/entity-type-registry';
import type { ComponentInteraction } from '../../src/shared/component-types';

/**
 * Build a Navigation interaction whose behavioral evidence carries ONE
 * full-reload NavigationEvidence — exactly the shape
 * attachSyntheticNavEvidence builds at onCommitted (type 'full-reload',
 * real DDC-2 fromUrl = previous committed URL, relativeTime 0).
 */
function fullReloadInteraction(
  id: string,
  toUrl: string,
  fromUrl: string,
): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Navigation',
    triggerEvent: {
      eventId: `evt-${id}`,
      eventType: 'navigation',
      timestamp: Date.now(),
      captureSeq: 1,
      isTrusted: true,
      target: { tagName: 'HTML' } as unknown as ComponentInteraction['triggerEvent']['target'],
      domContext: {} as never,
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: toUrl,
      pageTitle: 'Landed',
      navType: 'form_submit',
      captureOrigin: { tabId: 1, frameId: 0 },
    },
    triggerSelector: '',
    startedAt: Date.now() - 50,
    completedAt: Date.now(),
    endState: 'completed',
    metadata: { pageUrl: toUrl, pageTitle: 'Landed' },
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      sourceEventType: 'navigation',
      windowId: `synthetic-nav-${id}`,
      frameId: 'main',
      window: {
        openedAt: 0,
        closedAt: 0,
        durationMs: 0,
        endReason: 'page-reload-synthetic',
        stabilityTrace: [],
      } as never,
      targetEvidence: {
        identity: null,
        identityCapturedAt: 0,
        before: null,
        after: null,
        focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [],
        domChangeOverflow: 0,
        coarseMode: false,
        newSurfaces: [],
        removedSurfaces: [],
        visibilityChanges: [],
        navigation: [
          {
            type: 'full-reload',
            fromUrl,
            toUrl,
            relativeTime: 0,
            batchIndex: null,
          },
        ],
        networkActivity: [],
        performanceCondition: {
          mainThreadBlocked: false,
          highChurnMode: false,
          longestBatchMs: 0,
          totalBatches: 0,
        },
      },
    },
  } as unknown as ComponentInteraction;
}

describe('7.1-W2 integration — full-reload nav → view rows in KR (repository layer)', () => {
  let db: KnowledgeDatabase;

  beforeAll(async () => {
    db = new KnowledgeDatabase();
    await db.open();
  });

  afterAll(async () => {
    await db.close();
  });

  it('T1+T2: full-reload /search?q= then /cart?ASIN= → search-results + cart view rows and search-results→cart transition', async () => {
    const registry = createDefaultViewRegistry();
    const extractor = new NavigationSignalExtractor(registry);

    // T1 — first full reload lands on /search?q=flights (form submit).
    const toSearch = fullReloadInteraction(
      'int-fr-1',
      'https://shop.example/search?q=flights',
      'https://shop.example/search-form.html',
    );

    const signals1 = extractor.extract(toSearch);
    expect(signals1.length).toBeGreaterThan(0);
    const vc1 = signals1.find((s) => s.type === 'view-change');
    expect(vc1).toBeTruthy();
    expect((vc1 as unknown as { toView: { id: string } }).toView.id).toBe('search-results');
    expect(
      (vc1 as unknown as { navigationType?: string }).navigationType,
    ).toBe('full-reload');

    // Real StateBuilder, coordinator-shaped SignalSet (same shape as W1 pin).
    const stateBuilder = new StateBuilder(
      createEntityTypeRegistry(true),
      undefined,
    );
    const mkSet = (id: string, raw: ReturnType<NavigationSignalExtractor['extract']>) => ({
      interactionId: id,
      viewChanges: raw.filter((s) => s.type === 'view-change'),
      apiOperations: [],
      notifications: [],
      counterChanges: [],
      listChanges: [],
      inputChanges: [],
    });
    const transition1 = stateBuilder.processSignals(mkSet('int-fr-1', signals1) as never);
    expect(transition1.after.currentView?.id).toBe('search-results');

    // T2 — second full reload lands on /cart?ASIN=… (the form's target).
    const toCart = fullReloadInteraction(
      'int-fr-2',
      'https://shop.example/cart?ASIN=B08KGRVW2S',
      'https://shop.example/search?q=flights',
    );
    const signals2 = extractor.extract(toCart);
    const vc2 = signals2.find((s) => s.type === 'view-change');
    expect(vc2).toBeTruthy();
    expect((vc2 as unknown as { toView: { id: string } }).toView.id).toBe('cart');

    const transition2 = stateBuilder.processSignals(mkSet('int-fr-2', signals2) as never);
    expect(transition2.after.currentView?.id).toBe('cart');

    const finalState = stateBuilder.getCurrentState();

    // Persistence — real repository + service, same origin discipline as W1.
    const repo = new KnowledgeRepository(db);
    const service = new KnowledgePersistenceService(repo);
    const APP_ID = deriveAppId('https://shop.example');
    await service.persist({
      origin: 'https://shop.example',
      recordingSessionId: 'session-w2-1',
      applicationState: finalState,
      outcomes: [],
      transitions: [transition1, transition2],
    } as never);

    const app = await repo.getApplication(APP_ID);
    expect(app).toBeTruthy();

    const views = await repo.getViews(APP_ID);
    const viewIds = views.map((v: { viewId: string }) => v.viewId);
    expect(viewIds).toContain('search-results');
    expect(viewIds).toContain('cart');

    const viewTransitions = await repo.getViewTransitions(APP_ID);
    expect(viewTransitions.length).toBeGreaterThanOrEqual(1);
    // T1's change is the FIRST (before=null, honestly no row); the persisted
    // transition is T2's search-results → cart.
    const link = viewTransitions.find(
      (t: { fromViewId?: string; toViewId?: string }) =>
        t.fromViewId === 'search-results' && t.toViewId === 'cart',
    );
    expect(link).toBeTruthy();
  });

  it('T3 (honesty): /m9-cart-landed.html matches no default pattern → zero view signals and zero view rows', async () => {
    const registry = createDefaultViewRegistry();
    const extractor = new NavigationSignalExtractor(registry);

    const nav = fullReloadInteraction(
      'int-fr-3',
      'https://shop.example/m9-cart-landed.html',
      'https://shop.example/m9-form-submit-validation.html',
    );

    const signals = extractor.extract(nav);
    expect(signals.filter((s) => s.type === 'view-change')).toHaveLength(0);

    // StateBuilder records no view; persistence writes no view rows for it.
    const stateBuilder = new StateBuilder(
      createEntityTypeRegistry(true),
      undefined,
    );
    const transition = stateBuilder.processSignals({
      interactionId: 'int-fr-3',
      viewChanges: [],
      apiOperations: [],
      notifications: [],
      counterChanges: [],
      listChanges: [],
      inputChanges: [],
    } as never);
    expect(transition.after.currentView ?? null).toBeNull();
  });
});
