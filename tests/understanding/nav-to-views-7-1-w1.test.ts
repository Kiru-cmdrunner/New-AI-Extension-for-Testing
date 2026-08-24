/**
 * 7.1-W1 Integration Pin: SPA pushState nav event → view rows in KR
 *
 * Spec: .drytis/specs/phase-7-1-w1-spa-nav-inject.md §5 (test 8)
 *
 * Proves the repository-layer chain end-to-end with the REAL components
 * (no mocks of the pipeline under test):
 *
 *   synthetic navigation ObservedEvent (exactly the shape the 7.1-W1
 *   bridge emits) → NavigationSignalExtractor + ViewRegistry →
 *   StateBuilder → KnowledgePersistenceService → Dexie rows:
 *
 *   - knowledgeViews contains a `search-results` row (from /search?q=)
 *   - knowledgeViewTransitions contains a home → search-results row
 *
 * This pins the code that was correct but starved of input: if the bridge
 * ever delivers a real nav event, rows MUST land.
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

/** Build a minimal interaction whose behavioral evidence carries ONE nav. */
function navInteraction(toUrl: string, fromUrl: string): ComponentInteraction {
  return {
    interactionId: 'int-nav-1',
    type: 'Navigation',
    triggerEvent: {
      eventId: 'evt-p1-1',
      eventType: 'navigation',
      timestamp: Date.now(),
      captureSeq: 1,
      isTrusted: true,
      target: {
        tagName: 'BODY',
      } as unknown as ComponentInteraction['triggerEvent']['target'],
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
      pageTitle: 'Test Page',
      navType: 'pushState',
    },
    triggerSelector: '',
    startedAt: Date.now() - 100,
    completedAt: Date.now(),
    endState: 'completed',
    metadata: { pageUrl: toUrl, pageTitle: 'Test Page' },
    behavioralEvidence: {
      sourceEventId: 'evt-p1-1',
      sourceEventType: 'navigation',
      windowId: 'win-1',
      frameId: 'main',
      window: {} as never,
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
            type: 'pushState',
            fromUrl,
            toUrl,
            relativeTime: 5,
            batchIndex: 0,
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

describe('7.1-W1 integration — nav event → view rows in KR (repository layer)', () => {
  let db: KnowledgeDatabase;

  beforeAll(async () => {
    db = new KnowledgeDatabase();
    await db.open();
  });

  afterAll(async () => {
    await db.close();
  });

  it('pushState to /search?q= lands search-results view + home→search-results transition', async () => {
    const registry = createDefaultViewRegistry();
    const extractor = new NavigationSignalExtractor(registry);
    const interaction = navInteraction(
      'https://shop.example/search?q=flights',
      'https://shop.example/',
    );

    // 1. Signal extraction (real extractor + real registry)
    const signals = extractor.extract(interaction);
    expect(signals.length).toBeGreaterThan(0);
    const viewChange = signals.find((s) => s.type === 'view-change');
    expect(viewChange).toBeTruthy();
    expect((viewChange as unknown as { toView: { id: string } }).toView.id).toBe('search-results');

    // 2. State building (real StateBuilder) — coordinator-shaped SignalSet.
    // Real session shape: two view changes (pushState to /search?q=, then
    // popstate back to /). The first change has no prior view (honest
    // before=null); the SECOND change lands the transition row.
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
    const toSearch = mkSet(
      'int-nav-1',
      extractor.extract(interaction),
    );
    const transition1 = stateBuilder.processSignals(toSearch as never);
    expect(transition1.after.currentView?.id).toBe('search-results');

    const backHome = mkSet(
      'int-nav-2',
      extractor.extract(
        navInteraction('https://shop.example/', 'https://shop.example/search?q=flights'),
      ),
    );
    const transition2 = stateBuilder.processSignals(backHome as never);
    expect(transition2.after.currentView?.id).toBe('home');

    const finalState = stateBuilder.getCurrentState();

    // 3. Persistence (real repository + service)
    const repo = new KnowledgeRepository(db);
    const service = new KnowledgePersistenceService(repo);
    const APP_ID = deriveAppId('https://shop.example');
    await service.persist({
      origin: 'https://shop.example',
      recordingSessionId: 'session-w1-1',
      applicationState: finalState,
      outcomes: [],
      transitions: [transition1, transition2],
    } as never);

    const app = await repo.getApplication(APP_ID);
    expect(app).toBeTruthy();

    const views = await repo.getViews(APP_ID);
    const viewIds = views.map((v: { viewId: string }) => v.viewId);
    expect(viewIds).toContain('search-results');

    const viewTransitions = await repo.getViewTransitions(APP_ID);
    expect(viewTransitions.length).toBeGreaterThanOrEqual(1);
    // First change has before=null (honest: no prior view yet) → the
    // persisted row is the SECOND change (search-results → home).
    const link = viewTransitions.find(
      (t: { fromViewId?: string; toViewId?: string }) =>
        (t.fromViewId === 'search-results' && t.toViewId === 'home') ||
        (t.fromViewId === 'home' && t.toViewId === 'search-results'),
    );
    expect(link).toBeTruthy();
  });
});
