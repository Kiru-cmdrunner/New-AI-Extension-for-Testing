/**
 * M9.1 — Signal Extraction Framework Tests
 *
 * Tests cover:
 *   1. ViewRegistry URL pattern matching
 *   2. NavigationSignalExtractor — URL → view-change signals
 *   3. NetworkSignalExtractor — URL → API-operation signals
 *   4. SignalExtractionCoordinator — pipeline orchestration
 *   5. Amazon workflow integration — the full recorded example
 *   6. Edge cases: no evidence, unknown URLs, graceful degradation
 */
import { describe, it, expect } from 'vitest';
import {
  SignalExtractionCoordinator,
  NavigationSignalExtractor,
  NetworkSignalExtractor,
  ViewRegistry,
  DEFAULT_VIEW_PATTERNS,
  createDefaultViewRegistry,
} from '../../src/understanding';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

// ── Fixture Helpers ────────────────────────────────────────────────────

function makeEvidence(
  appOverrides: Partial<BehavioralEvidence['applicationEvidence']> = {},
  windowOverrides: Partial<BehavioralEvidence['window']> = {},
): BehavioralEvidence {
  return {
    sourceEventId: 'evt-test',
    sourceEventType: 'click',
    windowId: 'bev-test',
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 100,
      durationMs: 100,
      endReason: 'lifecycle-complete',
      stabilityTrace: [],
      ...windowOverrides,
    },
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
      navigation: [],
      networkActivity: [],
      performanceCondition: null,
      ...appOverrides,
    },
  };
}

function makeInteraction(
  id: string,
  evidence?: BehavioralEvidence,
): ComponentInteraction {
  return {
    interactionId: id,
    lifecycleId: 'lc-test',
    type: 'Click',
    trigger: null as any,
    triggerEvent: {
      eventId: `evt-${id}`,
      eventType: 'click',
      timestamp: 1000,
      captureSeq: 1,
      isTrusted: true,
      target: null as any,
      domContext: null as any,
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
      pageUrl: 'https://www.amazon.in',
      pageTitle: 'Amazon',
    },
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: evidence,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('M9.1: Signal Extraction', () => {

  // ── 1. ViewRegistry ─────────────────────────────────────────────

  describe('ViewRegistry', () => {
    it('matches product detail URL (/dp/ASIN)', () => {
      const registry = createDefaultViewRegistry();
      const result = registry.match('https://www.amazon.in/vivo-Mystic-Storage/dp/B0H2Z9JL52');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('product-detail');
      expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('matches search results URL (/s?keywords=)', () => {
      const registry = createDefaultViewRegistry();
      const result = registry.match('https://www.amazon.in/s?field-keywords=vivo&crid=ABC');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('search-results');
    });

    it('matches cart URL', () => {
      const registry = createDefaultViewRegistry();
      const result = registry.match('https://www.amazon.in/cart/add-to-cart/ref=dp_start');
      expect(result).not.toBeNull();
      // cart-confirmation should match before plain cart (pattern order)
      expect(result!.id).toBe('cart-confirmation');
    });

    it('matches plain cart URL', () => {
      const registry = createDefaultViewRegistry();
      const result = registry.match('https://www.amazon.in/cart');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('cart');
    });

    it('matches home page URL', () => {
      const registry = createDefaultViewRegistry();
      const result = registry.match('https://www.amazon.in/');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('home');
    });

    it('returns null for unknown URL', () => {
      const registry = createDefaultViewRegistry();
      const result = registry.match('https://example.com/some/random/page');
      expect(result).toBeNull();
    });

    it('returns null for empty URL', () => {
      const registry = createDefaultViewRegistry();
      expect(registry.match('')).toBeNull();
    });

    it('allows custom patterns', () => {
      const registry = new ViewRegistry();
      registry.add({
        viewId: 'custom-view',
        viewLabel: 'Custom',
        pattern: '/my-app/view',
        confidence: 0.8,
      });
      const result = registry.match('https://example.com/my-app/view?id=1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('custom-view');
    });

    it('first match wins when multiple patterns could match', () => {
      const registry = new ViewRegistry([
        { viewId: 'first', viewLabel: 'First', pattern: '/path', confidence: 0.9 },
        { viewId: 'second', viewLabel: 'Second', pattern: '/path', confidence: 0.8 },
      ]);
      const result = registry.match('https://example.com/path');
      expect(result!.id).toBe('first');
    });

    it('reports registered pattern count', () => {
      const registry = createDefaultViewRegistry();
      expect(registry.size).toBe(DEFAULT_VIEW_PATTERNS.length);
    });
  });

  // ── 2. NavigationSignalExtractor ────────────────────────────────

  describe('NavigationSignalExtractor', () => {
    it('extracts view-change signal from navigation to search results', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({
        navigation: [{
          type: 'full-reload',
          fromUrl: 'https://www.amazon.in/',
          toUrl: 'https://www.amazon.in/s?field-keywords=vivo',
          relativeTime: 100,
          batchIndex: 1,
        }],
      });
      const interaction = makeInteraction('int-search-nav', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe('view-change');
      const s = signals[0] as any;
      expect(s.toView.id).toBe('search-results');
      expect(s.fromView).not.toBeNull();
      expect(s.fromView.id).toBe('home');
      expect(s.navigationType).toBe('full-reload');
      expect(s.toUrl).toContain('field-keywords=vivo');
    });

    it('extracts view-change for product detail navigation', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({
        navigation: [{
          type: 'full-reload',
          fromUrl: 'https://www.amazon.in/s?field-keywords=vivo',
          toUrl: 'https://www.amazon.in/vivo-Mystic-Storage/dp/B0H2Z9JL52',
          relativeTime: 50,
          batchIndex: 1,
        }],
      });
      const interaction = makeInteraction('int-product-nav', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      expect(signals[0].type).toBe('view-change');
      const s = signals[0] as any;
      expect(s.toView.id).toBe('product-detail');
      expect(s.fromView!.id).toBe('search-results');
    });

    it('produces no signal for unknown destination URL', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({
        navigation: [{
          type: 'pushState',
          fromUrl: 'https://example.com/',
          toUrl: 'https://example.com/some/random/path',
          relativeTime: 50,
          batchIndex: 1,
        }],
      });
      const interaction = makeInteraction('int-unknown-nav', evidence);
      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(0);
    });

    it('handles fromUrl that does not match any view', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({
        navigation: [{
          type: 'full-reload',
          fromUrl: 'https://example.com/unknown',
          toUrl: 'https://www.amazon.in/cart',
          relativeTime: 0,
          batchIndex: null,
        }],
      });
      const interaction = makeInteraction('int-partial-nav', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      const s = signals[0] as any;
      expect(s.toView.id).toBe('cart');
      expect(s.fromView).toBeNull(); // fromUrl didn't match
    });

    it('returns empty for interaction without evidence', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const interaction = makeInteraction('int-no-ev');
      expect(extractor.extract(interaction)).toHaveLength(0);
    });

    it('returns empty for evidence with no navigation', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({ navigation: [] });
      const interaction = makeInteraction('int-no-nav', evidence);
      expect(extractor.extract(interaction)).toHaveLength(0);
    });

    it('extracts multiple signals from multiple navigations', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({
        navigation: [
          {
            type: 'pushState',
            fromUrl: 'https://www.amazon.in/',
            toUrl: 'https://www.amazon.in/s?field-keywords=vivo',
            relativeTime: 10,
            batchIndex: 1,
          },
          {
            type: 'pushState',
            fromUrl: 'https://www.amazon.in/s?field-keywords=vivo',
            toUrl: 'https://www.amazon.in/dp/B0H2Z9JL52',
            relativeTime: 20,
            batchIndex: 2,
          },
        ],
      });
      const interaction = makeInteraction('int-multi-nav', evidence);
      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(2);
    });
  });

  // ── 3. NetworkSignalExtractor ───────────────────────────────────

  describe('NetworkSignalExtractor', () => {
    it('classifies search autocomplete request', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/suggestions?limit=11&prefix=vivo',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 10,
          endRelativeToEvent: 318,
          durationMs: 308,
          resourceType: 'fetch',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-autocomplete', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      const s = signals[0] as any;
      expect(s.type).toBe('api-operation');
      expect(s.operation).toBe('search-autocomplete');
      expect(s.succeeded).toBe(true);
      expect(s.outcomeHint).not.toBeNull();
      expect(s.outcomeHint.result).toBe('success');
    });

    it('classifies add-to-cart request', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start',
          method: 'POST',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: 200,
          durationMs: 200,
          resourceType: 'xhr',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-add-cart-net', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      const s = signals[0] as any;
      expect(s.operation).toBe('add-to-cart');
      expect(s.method).toBe('POST');
      expect(s.succeeded).toBe(true);
    });

    it('classifies search request', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/search?q=vivo',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: 300,
          durationMs: 300,
          resourceType: 'fetch',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-search-net', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      expect((signals[0] as any).operation).toBe('search');
    });

    it('skips analytics requests', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [
          {
            url: 'https://unagi.amazon.in/1/events/com.amazon.eel.Something',
            method: 'POST',
            status: 200,
            startRelativeToEvent: 0,
            endRelativeToEvent: 100,
            durationMs: 100,
            resourceType: 'fetch',
            source: 'main-world',
          },
          {
            url: 'https://fls-eu.amazon.in/1/batch/1/OP/A21TJRUUN4KGV',
            method: 'GET',
            status: 200,
            startRelativeToEvent: 5,
            endRelativeToEvent: 293,
            durationMs: 288,
            resourceType: 'fetch',
            source: 'webrequest',
          },
        ],
      });
      const interaction = makeInteraction('int-analytics', evidence);
      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(0);
    });

    it('skips static resource requests', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://m.media-amazon.com/images/S/sash/XbXEZE76MQS35vU.png',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: 3,
          durationMs: 3,
          resourceType: 'fetch',
          source: 'webrequest',
        }],
      });
      const interaction = makeInteraction('int-resource', evidence);
      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(0);
    });

    it('classifies unknown URLs as unknown operation with low confidence', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://api.example.com/v2/some-opaque-endpoint',
          method: 'POST',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: 100,
          durationMs: 100,
          resourceType: 'xhr',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-unknown-net', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      const s = signals[0] as any;
      expect(s.operation).toBe('unknown');
      expect(s.confidence).toBeLessThanOrEqual(0.2);
    });

    it('produces failure outcome hint for 4xx/5xx', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/cart/add',
          method: 'POST',
          status: 500,
          startRelativeToEvent: 0,
          endRelativeToEvent: 100,
          durationMs: 100,
          resourceType: 'xhr',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-fail-net', evidence);
      const signals = extractor.extract(interaction);

      const s = signals[0] as any;
      expect(s.outcomeHint.result).toBe('failure');
      expect(s.outcomeHint.weight).toBeGreaterThanOrEqual(0.5);
      expect(s.succeeded).toBe(false);
    });

    it('handles null status (in-flight request)', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/search?q=vivo',
          method: 'GET',
          status: null,
          startRelativeToEvent: 10,
          endRelativeToEvent: null,
          durationMs: null,
          resourceType: 'fetch',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-inflight', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      const s = signals[0] as any;
      expect(s.succeeded).toBeNull();
      expect(s.outcomeHint).toBeNull();
    });

    it('returns empty for interaction without evidence', () => {
      const extractor = new NetworkSignalExtractor();
      const interaction = makeInteraction('int-no-ev-net');
      expect(extractor.extract(interaction)).toHaveLength(0);
    });

    it('classifies checkout endpoint', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/checkout',
          method: 'POST',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: 500,
          durationMs: 500,
          resourceType: 'xhr',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-checkout', evidence);
      const signals = extractor.extract(interaction);
      expect((signals[0] as any).operation).toBe('checkout');
    });

    it('classifies login endpoint', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [{
          url: 'https://www.amazon.in/signin',
          method: 'POST',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: 500,
          durationMs: 500,
          resourceType: 'xhr',
          source: 'main-world',
        }],
      });
      const interaction = makeInteraction('int-login', evidence);
      const signals = extractor.extract(interaction);
      expect((signals[0] as any).operation).toBe('login');
    });
  });

  // ── 4. SignalExtractionCoordinator ──────────────────────────────

  describe('SignalExtractionCoordinator', () => {
    it('runs all extractors and combines results', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NavigationSignalExtractor(createDefaultViewRegistry()));
      coordinator.register(new NetworkSignalExtractor());

      const evidence = makeEvidence({
        navigation: [{
          type: 'full-reload',
          fromUrl: 'https://www.amazon.in/',
          toUrl: 'https://www.amazon.in/s?field-keywords=vivo',
          relativeTime: 10,
          batchIndex: 1,
        }],
        networkActivity: [{
          url: 'https://www.amazon.in/suggestions?prefix=vivo',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 5,
          endRelativeToEvent: 323,
          durationMs: 318,
          resourceType: 'fetch',
          source: 'main-world',
        }],
      });

      const interaction = makeInteraction('int-combined', evidence);
      const result = coordinator.extractFromInteraction(interaction);

      expect(result.interactionId).toBe('int-combined');
      expect(result.viewChanges).toHaveLength(1);
      expect(result.apiOperations).toHaveLength(1);
    });

    it('returns empty signal set for interaction without evidence', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NavigationSignalExtractor(createDefaultViewRegistry()));

      const interaction = makeInteraction('int-coord-no-ev');
      const result = coordinator.extractFromInteraction(interaction);

      expect(result.viewChanges).toHaveLength(0);
      expect(result.apiOperations).toHaveLength(0);
    });

    it('batch extraction: processes multiple interactions', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NavigationSignalExtractor(createDefaultViewRegistry()));
      coordinator.register(new NetworkSignalExtractor());

      const interactions = [
        // Has evidence + navigation
        makeInteraction('int-batch-1', makeEvidence({
          navigation: [{
            type: 'full-reload', fromUrl: '', toUrl: 'https://www.amazon.in/s?q=test',
            relativeTime: 0, batchIndex: 1,
          }],
        })),
        // No evidence — should be skipped
        makeInteraction('int-batch-2'),
        // Has evidence + network
        makeInteraction('int-batch-3', makeEvidence({
          networkActivity: [{
            url: 'https://www.amazon.in/search?q=test', method: 'GET', status: 200,
            startRelativeToEvent: 0, endRelativeToEvent: 100, durationMs: 100,
            resourceType: 'fetch', source: 'main-world',
          }],
        })),
      ];

      const result = coordinator.extract(interactions);

      expect(result.interactionCount).toBe(3);
      expect(result.skippedCount).toBe(1);
      expect(result.signals.size).toBe(2); // 2 interactions had evidence
      expect(result.signals.has('int-batch-1')).toBe(true);
      expect(result.signals.has('int-batch-2')).toBe(false);
      expect(result.signals.has('int-batch-3')).toBe(true);
    });

    it('handles no extractors registered gracefully', () => {
      const coordinator = new SignalExtractionCoordinator();
      const interaction = makeInteraction('int-empty-coord', makeEvidence());
      const result = coordinator.extractFromInteraction(interaction);

      expect(result.viewChanges).toHaveLength(0);
      expect(result.apiOperations).toHaveLength(0);
    });
  });

  // ── 5. Amazon Workflow Integration ──────────────────────────────

  describe('Amazon Add-to-Cart workflow', () => {
    it('produces correct signals for the full recorded workflow', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NavigationSignalExtractor(createDefaultViewRegistry()));
      coordinator.register(new NetworkSignalExtractor());

      // Reproduce the Amazon workflow interactions with realistic evidence
      const interactions: ComponentInteraction[] = [
        // int-8: Text entry "vivo" — has autocomplete network, no navigation
        makeInteraction('int-8', makeEvidence({
          networkActivity: [{
            url: 'https://www.amazon.in/suggestions?limit=11&prefix=vivo',
            method: 'GET', status: 200,
            startRelativeToEvent: 0, endRelativeToEvent: 318, durationMs: 318,
            resourceType: 'fetch', source: 'main-world',
          }],
        })),

        // int-11: Navigation to search results
        makeInteraction('int-11', makeEvidence({
          navigation: [{
            type: 'full-reload',
            fromUrl: 'https://www.amazon.in/',
            toUrl: 'https://www.amazon.in/s/ref=nb_sb_noss_2?url=search-alias%3Daps&field-keywords=vivo',
            relativeTime: 0,
            batchIndex: null,
          }],
        }, {
          endReason: 'page-reload-synthetic',
          durationMs: 0,
        })),

        // int-17: Navigation to product detail
        makeInteraction('int-17', makeEvidence({
          navigation: [{
            type: 'full-reload',
            fromUrl: 'https://www.amazon.in/s?field-keywords=vivo',
            toUrl: 'https://www.amazon.in/vivo-Mystic-Storage-Additional-Exchange/dp/B0H2Z9JL52',
            relativeTime: 0,
            batchIndex: null,
          }],
        }, {
          endReason: 'page-reload-synthetic',
          durationMs: 0,
        })),

        // int-19: Click "Add to cart" — 0ms window, no network captured
        makeInteraction('int-19', makeEvidence({}, {
          endReason: 'lifecycle-complete',
          durationMs: 0,
        })),

        // int-20: Navigation to cart confirmation
        makeInteraction('int-20', makeEvidence({
          navigation: [{
            type: 'full-reload',
            fromUrl: 'https://www.amazon.in/dp/B0H2Z9JL52',
            toUrl: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bbf_1_glance',
            relativeTime: 0,
            batchIndex: null,
          }],
        }, {
          endReason: 'page-reload-synthetic',
          durationMs: 0,
        })),
      ];

      const result = coordinator.extract(interactions);

      // All 5 interactions have evidence (none skipped)
      expect(result.interactionCount).toBe(5);
      expect(result.skippedCount).toBe(0);
      expect(result.signals.size).toBe(5);

      // int-8: autocomplete API signal only
      const s8 = result.signals.get('int-8')!;
      expect(s8.viewChanges).toHaveLength(0);
      expect(s8.apiOperations).toHaveLength(1);
      expect(s8.apiOperations[0].operation).toBe('search-autocomplete');

      // int-11: view change to search-results
      const s11 = result.signals.get('int-11')!;
      expect(s11.viewChanges).toHaveLength(1);
      expect(s11.viewChanges[0].toView.id).toBe('search-results');
      expect(s11.viewChanges[0].fromView!.id).toBe('home');
      expect(s11.apiOperations).toHaveLength(0);

      // int-17: view change to product-detail
      const s17 = result.signals.get('int-17')!;
      expect(s17.viewChanges).toHaveLength(1);
      expect(s17.viewChanges[0].toView.id).toBe('product-detail');
      expect(s17.viewChanges[0].fromView!.id).toBe('search-results');

      // int-19: 0ms window, nothing to extract
      const s19 = result.signals.get('int-19')!;
      expect(s19.viewChanges).toHaveLength(0);
      expect(s19.apiOperations).toHaveLength(0);

      // int-20: view change to cart-confirmation
      const s20 = result.signals.get('int-20')!;
      expect(s20.viewChanges).toHaveLength(1);
      expect(s20.viewChanges[0].toView.id).toBe('cart-confirmation');
      expect(s20.viewChanges[0].fromView!.id).toBe('product-detail');
    });

    it('the workflow tells a coherent navigation story', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NavigationSignalExtractor(createDefaultViewRegistry()));

      const interactions = [
        makeInteraction('nav-1', makeEvidence({
          navigation: [{
            type: 'full-reload', fromUrl: 'https://www.amazon.in/',
            toUrl: 'https://www.amazon.in/s?field-keywords=vivo',
            relativeTime: 0, batchIndex: null,
          }],
        })),
        makeInteraction('nav-2', makeEvidence({
          navigation: [{
            type: 'full-reload',
            fromUrl: 'https://www.amazon.in/s?field-keywords=vivo',
            toUrl: 'https://www.amazon.in/dp/B0H2Z9JL52',
            relativeTime: 0, batchIndex: null,
          }],
        })),
        makeInteraction('nav-3', makeEvidence({
          navigation: [{
            type: 'full-reload',
            fromUrl: 'https://www.amazon.in/dp/B0H2Z9JL52',
            toUrl: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start',
            relativeTime: 0, batchIndex: null,
          }],
        })),
      ];

      const result = coordinator.extract(interactions);

      // Reconstruct the journey from view-change signals
      const journey = interactions
        .map((i) => result.signals.get(i.interactionId))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .flatMap((s) => s.viewChanges)
        .map((vc) => `${vc.fromView?.id ?? '?'} → ${vc.toView.id}`);

      expect(journey).toEqual([
        'home → search-results',
        'search-results → product-detail',
        'product-detail → cart-confirmation',
      ]);
    });
  });

  // ── 6. Edge Cases ───────────────────────────────────────────────

  describe('edge cases', () => {
    it('interaction with null behavioralEvidence is skipped by batch extractor', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NetworkSignalExtractor());
      const result = coordinator.extract([makeInteraction('skip-me')]);
      expect(result.skippedCount).toBe(1);
      expect(result.signals.size).toBe(0);
    });

    it('empty interactions array produces empty result', () => {
      const coordinator = new SignalExtractionCoordinator();
      coordinator.register(new NetworkSignalExtractor());
      const result = coordinator.extract([]);
      expect(result.interactionCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.signals.size).toBe(0);
    });

    it('SPA navigation (pushState) is handled same as full-reload', () => {
      const registry = createDefaultViewRegistry();
      const extractor = new NavigationSignalExtractor(registry);
      const evidence = makeEvidence({
        navigation: [{
          type: 'pushState',
          fromUrl: 'https://shop.example.com/',
          toUrl: 'https://shop.example.com/cart',
          relativeTime: 50,
          batchIndex: 1,
        }],
      });
      const interaction = makeInteraction('int-spa', evidence);
      const signals = extractor.extract(interaction);

      expect(signals).toHaveLength(1);
      expect((signals[0] as any).navigationType).toBe('pushState');
      expect((signals[0] as any).toView.id).toBe('cart');
    });

    it('multiple network operations in one interaction produce multiple signals', () => {
      const extractor = new NetworkSignalExtractor();
      const evidence = makeEvidence({
        networkActivity: [
          {
            url: 'https://www.amazon.in/search?q=vivo', method: 'GET', status: 200,
            startRelativeToEvent: 0, endRelativeToEvent: 100, durationMs: 100,
            resourceType: 'fetch', source: 'main-world',
          },
          {
            url: 'https://www.amazon.in/cart/add', method: 'POST', status: 200,
            startRelativeToEvent: 50, endRelativeToEvent: 200, durationMs: 150,
            resourceType: 'xhr', source: 'main-world',
          },
        ],
      });
      const interaction = makeInteraction('int-multi-net', evidence);
      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(2);
    });
  });
});
