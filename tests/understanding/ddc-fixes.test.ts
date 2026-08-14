/**
 * DDC-1 … DDC-8 — Deterministic Data-Corruption Fix Tests
 *
 * Covers:
 * - DDC-1: PerformanceObserver dedup vs fetch/XHR + real status (no 200s)
 * - DDC-3: Click→outcome attribution across full-page reload
 * - DDC-4: RecordedWorkflow persistence across sessions (DB v2)
 * - DDC-5: Degraded evidence window → halved confidence + marker
 * - DDC-6: ControlStateChangeSignal (checked/expanded/selection/…)
 * - DDC-7: GraphQL operationName extraction + variable entity hints
 * - DDC-8: No-evidence interactions are incomplete, never success
 *
 * Architecture: .drytis/specs/ddc-deterministic-data-corruption-fixes.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// jsdom lacks chrome.* — stub the APIs NetworkBridge touches.
const listeners: Record<string, unknown[]> = {};
(globalThis as any).chrome = {
  runtime: {
    onMessage: {
      addListener: vi.fn((fn: unknown) => { listeners.onMessage = listeners.onMessage ?? []; listeners.onMessage.push(fn); }),
      removeListener: vi.fn(),
    },
  },
};

import { NetworkBridge } from '../../src/tap/network-bridge';
import { NetworkSignalExtractor, extractGraphqlOperation } from '../../src/understanding/signal-extractors/network-signals';
import { TargetStateSignalExtractor } from '../../src/understanding/signal-extractors/target-state-signals';
import { OutcomeDeterminer } from '../../src/understanding/outcome/outcome-determiner';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { createKnowledgeDatabase } from '../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../src/understanding/persistence/knowledge-repository';
import { createDefaultUnderstandingPipeline } from '../../src/understanding/pipeline/understanding-pipeline';
import type { NetworkActivity } from '../../src/shared/behavioral-evidence-types';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { SignalSet } from '../../src/understanding/types';
import type { ApplicationState } from '../../src/understanding/state-builder/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeNetActivity(overrides?: Partial<NetworkActivity>): NetworkActivity {
  return {
    url: 'https://api.example.com/cart/add',
    method: 'POST',
    status: 200,
    startRelativeToEvent: 10,
    endRelativeToEvent: 120,
    durationMs: 110,
    resourceType: 'xhr',
    source: 'main-world',
    ...overrides,
  };
}

/** Dispatch a MAIN-world CustomEvent into the bridge. */
function dispatchMainWorld(_bridge: NetworkBridge, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('cmdrunner-net', { detail }));
}

function emptySignalSet(id = 'int-1'): SignalSet {
  return {
    interactionId: id,
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    pageContent: null,
  };
}

function makeState(): ApplicationState {
  return {
    currentView: null,
    currentUrl: null,
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: null,
    interactionCount: 0,
  };
}

function minimalTriggerInteraction(id: string, name: string): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click',
    trigger: { kind: 'element', tagName: 'INPUT', accessibleName: name },
    triggerEvent: { eventId: `evt-${id}`, eventType: 'click' },
    memberEvents: [],
    startTime: 1000,
    endTime: 1161,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      sourceEventType: 'click',
      windowId: `w-${id}`,
      frameId: 'main',
      window: { openedAt: 1000, closedAt: 1161, durationMs: 161, endReason: 'lifecycle-complete', stabilityTrace: [] },
      targetEvidence: {
        identity: {
          accessibleName: name, ariaRole: 'button', ariaLabel: null, ariaLabelledBy: null,
          placeholder: null, tag: 'INPUT', className: null, name: null, stableId: null,
          testId: null, dataCy: null, dataQa: null, cssSelector: `#${id}`,
          xPath: '', inIframe: false, shadowDom: false, href: null, inputType: 'submit',
          elementId: id,
        },
        identityCapturedAt: 1000,
        before: null, after: null, focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [], networkActivity: [],
        performanceCondition: { mainThreadBlocked: false, highChurnMode: false, longestBatchMs: 0, totalBatches: 0 },
      },
    },
  } as unknown as ComponentInteraction;
}

/** Interaction whose network evidence lives on a synthetic-nav window. */
function syntheticNavInteraction(id: string, net: NetworkActivity[]): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Navigation',
    trigger: { kind: 'document', tagName: 'HTML', accessibleName: 'Navigation' },
    triggerEvent: { eventId: `evt-${id}`, eventType: 'navigation' },
    memberEvents: [],
    startTime: 1200,
    endTime: 1200,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      sourceEventType: 'navigation',
      windowId: `synthetic-nav-${id}`,
      frameId: 'main',
      window: { openedAt: 0, closedAt: 0, durationMs: 0, endReason: 'page-reload-synthetic', stabilityTrace: [] },
      targetEvidence: {
        identity: {
          accessibleName: id, ariaRole: 'document', ariaLabel: null, ariaLabelledBy: null,
          placeholder: null, tag: 'HTML', className: null, name: null, stableId: null,
          testId: null, dataCy: null, dataQa: null, cssSelector: 'html',
          xPath: '/html', inIframe: false, shadowDom: false, href: null, inputType: null,
          elementId: '',
        },
        identityCapturedAt: 0,
        before: null, after: null, focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [{ type: 'full-reload', fromUrl: 'https://www.amazon.in/dp/B08KGRVW2S', toUrl: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bft_w_cart', relativeTime: 0, batchIndex: null }],
        networkActivity: net,
        performanceCondition: { mainThreadBlocked: false, highChurnMode: false, longestBatchMs: 0, totalBatches: 0 },
      },
    },
  } as unknown as ComponentInteraction;
}

// ── DDC-1: PerformanceObserver dedup + real status ────────────────────

describe('DDC-1: PerformanceObserver dedup', () => {
  let bridge: NetworkBridge;

  beforeEach(() => {
    bridge = new NetworkBridge();
    bridge.start();
  });

  it('drops a PO entry when a fetch twin (same URL) exists in the window', () => {
    // fetch patch captured the request with real method + status
    dispatchMainWorld(bridge, {
      url: 'https://api.example.com/cart',
      method: 'POST',
      timestamp: 1000,
      phase: 'start',
      status: null,
      resourceType: 'fetch',
    });
    dispatchMainWorld(bridge, {
      url: 'https://api.example.com/cart',
      method: 'POST',
      timestamp: 1100,
      phase: 'complete',
      status: 201,
      resourceType: 'fetch',
    });
    // PerformanceObserver ALSO reported the same request (resource entry)
    dispatchMainWorld(bridge, {
      url: 'https://api.example.com/cart',
      method: 'GET', // PO cannot read method — GET is the default
      timestamp: 1050,
      phase: 'complete',
      status: null,
      resourceType: 'resource',
    });

    const collected = bridge.collectForRange(950, 1200);
    const forUrl = collected.filter((e) => e.url === 'https://api.example.com/cart');
    expect(forUrl).toHaveLength(1); // deduped — PO twin dropped
    expect(forUrl[0].status).toBe(201); // real status from the fetch twin
    expect(forUrl[0].method).toBe('POST'); // real method
  });

  it('keeps a PO navigation entry with no fetch/XHR twin', () => {
    dispatchMainWorld(bridge, {
      url: 'https://www.amazon.in/gp/cart/view.html',
      method: 'GET',
      timestamp: 2000,
      phase: 'complete',
      status: null,
      resourceType: 'navigation',
    });

    const collected = bridge.collectForRange(1950, 2100);
    const forUrl = collected.filter((e) => e.url === 'https://www.amazon.in/gp/cart/view.html');
    expect(forUrl).toHaveLength(1);
    expect(forUrl[0].status).toBeNull(); // DDC-1: never fabricated 200
  });

  it('never fabricates status 200 — PO entries carry status null', () => {
    dispatchMainWorld(bridge, {
      url: 'https://cdn.example.com/app.js',
      method: 'GET',
      timestamp: 3000,
      phase: 'complete',
      status: null,
      resourceType: 'resource',
    });

    const collected = bridge.collectForRange(2950, 3100);
    const po = collected.find((e) => e.url === 'https://cdn.example.com/app.js');
    expect(po).toBeDefined();
    expect(po!.status).toBeNull();
  });

  it('yields no status-derived outcome vote for PO-only requests', () => {
    const extractor = new NetworkSignalExtractor();
    const interaction = syntheticNavInteraction('int-po', [
      makeNetActivity({
        url: 'https://api.example.com/graphql',
        resourceType: 'resource',
        source: 'performance-observer',
        status: null,
      }),
    ]);
    const signals = extractor.extract(interaction);
    // URL is still classified (dedup passed through), but no succeeded flag
    expect(signals.length).toBeGreaterThan(0);
    const op = signals[0] as any;
    expect(op.succeeded).toBeNull();
    expect(op.outcomeHint).toBeNull();
  });
});

// ── DDC-3: Click→outcome attribution across reload ─────────────────────

describe('DDC-3: reload attribution', () => {
  it('attributes the recovered add-to-cart POST to the preceding click', async () => {
    const click = minimalTriggerInteraction('int-19', 'Add to cart');
    const nav = syntheticNavInteraction('int-20', [
      makeNetActivity({
        url: 'https://www.amazon.in/cart/add-to-cart',
        method: 'POST',
        status: 200,
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
        source: 'webrequest',
      }),
    ]);

    const pipeline = createDefaultUnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: [click, nav],
      origin: 'https://www.amazon.in',
      sessionId: 'session-ddc3',
      seed: null,
    });
    await pipeline.close();

    const clickOutcome = outcome.outcomes.get('int-19');
    expect(clickOutcome).toBeDefined();
    expect(clickOutcome!.outcome).toBe('success');
    expect(clickOutcome!.supportingEvidence.some((e) => e.kind === 'api-operation')).toBe(true);
    expect(
      clickOutcome!.supportingEvidence.some((e) => e.detail.includes('attributed via reload recovery')),
    ).toBe(true);
  });

  it('does not attribute when the click captured its own ops', async () => {
    const click = {
      ...minimalTriggerInteraction('int-c1', 'Add to cart'),
    } as ComponentInteraction;
    // click captured its own fetch call
    click.behavioralEvidence!.applicationEvidence.networkActivity = [
      makeNetActivity({ status: 200 }),
    ];
    const nav = syntheticNavInteraction('int-c2', [
      makeNetActivity({ url: 'https://www.amazon.in/cart/add-to-cart', source: 'webrequest' }),
    ]);

    const pipeline = createDefaultUnderstandingPipeline({ noPersistence: true });
    const outcome = await pipeline.run({
      interactions: [click, nav],
      origin: 'https://www.amazon.in',
      sessionId: 'session-ddc3b',
      seed: null,
    });
    await pipeline.close();

    const clickOutcome = outcome.outcomes.get('int-c1');
    expect(clickOutcome!.supportingEvidence).toHaveLength(1); // own op only
  });
});

// ── DDC-4: RecordedWorkflow persistence ────────────────────────────────

describe('DDC-4: recorded workflow persistence', () => {
  it('persists single-occurrence patterns so a second session makes them recurring', async () => {
    const db = createKnowledgeDatabase();
    const repo = new KnowledgeRepository(db);

    // Session 1 workflow pattern
    await repo.upsertRecordedWorkflow({
      key: 'app-x:wf-pattern-1',
      appId: 'app-x',
      patternId: 'wf-pattern-1',
      label: 'Add product to cart',
      canonicalSteps: ['navigate', 'select-product', 'add-to-cart'],
      viewSequence: ['home', 'product-detail', 'cart-confirmation'],
      sessionIds: ['session-1'],
      occurrenceCount: 1,
      instances: ['wf-1'],
      firstSeenAt: 1000,
      lastSeenAt: 1000,
    });

    // Session 2 hits the same pattern
    await repo.upsertRecordedWorkflow({
      key: 'app-x:wf-pattern-1',
      appId: 'app-x',
      patternId: 'wf-pattern-1',
      label: 'Add product to cart',
      canonicalSteps: ['navigate', 'select-product', 'add-to-cart'],
      viewSequence: ['home', 'product-detail', 'cart-confirmation'],
      sessionIds: ['session-2'],
      occurrenceCount: 1,
      instances: ['wf-2'],
      firstSeenAt: 2000,
      lastSeenAt: 2000,
    });

    const rows = await repo.getRecordedWorkflows('app-x');
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrenceCount).toBe(2);
    expect(rows[0].sessionIds).toEqual(expect.arrayContaining(['session-1', 'session-2']));
    expect(rows[0].instances).toEqual(expect.arrayContaining(['wf-1', 'wf-2']));
    db.close();
  });

  it('loader returns RecordedWorkflow[] from persisted rows', async () => {
    const { KnowledgeLoader } = await import('../../src/understanding/consolidation/knowledge-loader');
    const db = createKnowledgeDatabase();
    const repo = new KnowledgeRepository(db);
    const loader = new KnowledgeLoader(repo);

    await repo.upsertRecordedWorkflow({
      key: 'app-y:wf-p9',
      appId: 'app-y',
      patternId: 'wf-p9',
      label: 'Apply leave',
      canonicalSteps: ['navigate', 'fill-form', 'submit'],
      viewSequence: ['dashboard', 'leave-form', 'leave-list'],
      sessionIds: ['s1', 's2', 's3'],
      occurrenceCount: 3,
      instances: ['w1', 'w2', 'w3'],
      firstSeenAt: 1,
      lastSeenAt: 3,
    });

    const workflows = await loader.loadRecordedWorkflows('app-y');
    expect(workflows).toHaveLength(1);
    expect(workflows[0].occurrenceCount).toBe(3);
    expect(workflows[0].canonicalSteps).toEqual(['navigate', 'fill-form', 'submit']);
    db.close();
  });

  it('end-to-end: two identical sessions produce a recurring pattern via pipeline', async () => {
    const { UnderstandingPipeline } = await import('../../src/understanding/pipeline/understanding-pipeline');
    const { deriveAppId } = await import('../../src/understanding/persistence/knowledge-persistence-service');
    const db = createKnowledgeDatabase();

    const mkInteractions = () => [
      minimalTriggerInteraction('i1', 'Search'),
      minimalTriggerInteraction('i2', 'Add to cart'),
    ];

    // Session 1 — same shared db; close() at the very end only
    const p1 = new UnderstandingPipeline({ db });
    await p1.run({ interactions: mkInteractions(), origin: 'https://shop.test', sessionId: 's1', seed: null });

    // Session 2 — same pattern, sees session 1's persisted patterns
    const p2 = new UnderstandingPipeline({ db });
    const r2 = await p2.run({ interactions: mkInteractions(), origin: 'https://shop.test', sessionId: 's2', seed: null });

    const repo = new KnowledgeRepository(db);
    const rows = await repo.getRecordedWorkflows(deriveAppId('https://shop.test'));
    expect(rows.length).toBeGreaterThan(0);
    const recurring = rows.find((r) => r.occurrenceCount >= 2);
    expect(recurring).toBeDefined(); // two identical sessions → recurrence
    expect(r2.semanticKnowledge).not.toBeNull();
    db.close();
  });
});

// ── DDC-5: degraded evidence windows ───────────────────────────────────

describe('DDC-5: evidence degradation', () => {
  const determiner = new OutcomeDeterminer();

  it('halves confidence when mainThreadBlocked', () => {
    const clean = determiner.determine({
      interactionId: 'int-a',
      actionType: 'Click',
      actionTarget: 'Save',
      signals: {
        ...emptySignalSet('int-a'),
        notifications: [{
          type: 'notification', interactionId: 'int-a', source: 'surface',
          confidence: 0.8, kind: 'appeared', text: 'Saved successfully',
          severity: 'success', elementPath: '#toast',
        }],
      },
      transition: null,
    });
    const degraded = determiner.determine({
      interactionId: 'int-a',
      actionType: 'Click',
      actionTarget: 'Save',
      signals: {
        ...emptySignalSet('int-a'),
        notifications: [{
          type: 'notification', interactionId: 'int-a', source: 'surface',
          confidence: 0.8, kind: 'appeared', text: 'Saved successfully',
          severity: 'success', elementPath: '#toast',
        }],
      },
      transition: null,
      evidenceQuality: { mainThreadBlocked: true, domChangeOverflow: 0, coarseMode: false },
    });

    expect(clean.outcome).toBe('success');
    expect(degraded.outcome).toBe('success');
    expect(degraded.confidence).toBeCloseTo(clean.confidence * 0.5, 5);
  });

  it('records degradation markers into transition changes', () => {
    const builder = new StateBuilder();
    builder.setEvidenceQuality({ mainThreadBlocked: true, domChangeOverflow: 12, coarseMode: false });
    const t = builder.processSignals(emptySignalSet('int-deg'));
    expect(t.changes).toContain('evidence-degraded: main-thread-blocked');
    expect(t.changes.some((c) => c.startsWith('evidence-degraded: dom-change-overflow (12)'))).toBe(true);
  });
});

// ── DDC-6: control state changes ───────────────────────────────────────

describe('DDC-6: control-state signals', () => {
  const extractor = new TargetStateSignalExtractor();

  function interactionWithTarget(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): ComponentInteraction {
    const identity = {
      accessibleName: 'Terms accepted', ariaRole: 'checkbox', ariaLabel: null,
      ariaLabelledBy: null, placeholder: null, tag: 'INPUT', className: null,
      name: null, stableId: null, testId: null, dataCy: null, dataQa: null,
      cssSelector: '#terms', xPath: '', inIframe: false, shadowDom: false,
      href: null, inputType: 'checkbox', elementId: 'terms',
    };
    return {
      interactionId: 'int-chk',
      type: 'Checkbox',
      trigger: { kind: 'element', tagName: 'INPUT', accessibleName: 'Terms accepted' },
      triggerEvent: { eventId: 'evt', eventType: 'change' },
      memberEvents: [],
      startTime: 1, endTime: 2, endState: 'completed', metadata: {},
      behavioralEvidence: {
        sourceEventId: 'evt', sourceEventType: 'change',
        windowId: 'w', frameId: 'main',
        window: { openedAt: 1, closedAt: 2, durationMs: 1, endReason: 'lifecycle-complete', stabilityTrace: [] },
        targetEvidence: {
          identity,
          identityCapturedAt: 1,
          before: { value: null, checked: null, className: '', disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: null, childCount: 0, scrollTop: null, scrollLeft: null, selectedValues: null, controlledValue: null, capturedAt: 1, ...before },
          after: { value: null, checked: null, className: '', disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: null, childCount: 0, scrollTop: null, scrollLeft: null, selectedValues: null, controlledValue: null, capturedAt: 2, ...after },
          focusMovement: null,
        },
        applicationEvidence: {
          domChanges: [], domChangeOverflow: 0, coarseMode: false,
          newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
          navigation: [], networkActivity: [],
          performanceCondition: { mainThreadBlocked: false, highChurnMode: false, longestBatchMs: 0, totalBatches: 0 },
        },
      },
    } as unknown as ComponentInteraction;
  }

  it('extracts checked toggles', () => {
    const signals = extractor.extract(interactionWithTarget({ checked: false }, { checked: true })) as any[];
    const chk = signals.find((s) => s.type === 'control-state-change' && s.property === 'checked');
    expect(chk).toBeDefined();
    expect(chk.oldValue).toBe('false');
    expect(chk.newValue).toBe('true');
  });

  it('extracts aria-expanded (accordion)', () => {
    const signals = extractor.extract(interactionWithTarget({ ariaExpanded: false }, { ariaExpanded: true })) as any[];
    const exp = signals.find((s) => s.property === 'expanded');
    expect(exp).toBeDefined();
    expect(exp.newValue).toBe('true');
  });

  it('extracts multi-select selection changes (order-insensitive)', () => {
    const signals = extractor.extract(
      interactionWithTarget({ selectedValues: ['b', 'a'] }, { selectedValues: ['a', 'b', 'c'] }),
    ) as any[];
    const sel = signals.find((s) => s.property === 'selection');
    expect(sel).toBeDefined();
    expect(sel.oldValue).toBe('a|b');
    expect(sel.newValue).toBe('a|b|c');
  });

  it('extracts aria-pressed (toggle buttons)', () => {
    const signals = extractor.extract(interactionWithTarget({ ariaPressed: null }, { ariaPressed: true })) as any[];
    const pr = signals.find((s) => s.property === 'pressed');
    expect(pr).toBeDefined();
    expect(pr.newValue).toBe('true');
  });

  it('records control changes as transition changes in the state builder', () => {
    const builder = new StateBuilder();
    const signals: SignalSet = {
      ...emptySignalSet('int-csc'),
      controlStateChanges: [{
        type: 'control-state-change',
        interactionId: 'int-csc',
        source: 'target-state',
        confidence: 0.95,
        property: 'checked',
        field: '#terms',
        oldValue: 'false',
        newValue: 'true',
        elementLabel: 'Terms accepted',
      }],
    };
    const t = builder.processSignals(signals);
    expect(t.changes.some((c) => c.includes('control: Terms accepted (checked)'))).toBe(true);
  });
});

// ── DDC-7: GraphQL operationName ───────────────────────────────────────

describe('DDC-7: GraphQL operation extraction', () => {
  it('extracts operationName from query text', () => {
    expect(extractGraphqlOperation({
      query: 'mutation AddToCart($asin: String!, $qty: Int!) { addToCart(asin: $asin, qty: $qty) { id } }',
    })).toBe('graphql:AddToCart');
  });

  it('extracts explicit operationName field', () => {
    expect(extractGraphqlOperation({
      operationName: 'GetCart',
      query: 'query GetCart { cart { items { id } } }',
    })).toBe('graphql:GetCart');
  });

  it('returns null for REST bodies', () => {
    expect(extractGraphqlOperation({ ASIN: 'B08', quantity: '1' })).toBeNull();
  });

  it('returns null for anonymous queries', () => {
    expect(extractGraphqlOperation({ query: '{ cart { items } }' })).toBeNull();
  });

  it('classifies GraphQL requests via the signal extractor', () => {
    const extractor = new NetworkSignalExtractor();
    const interaction = syntheticNavInteraction('int-gql', [
      makeNetActivity({
        url: 'https://api.example.com/graphql',
        method: 'POST',
        status: 200,
        requestBody: {
          query: 'mutation AddToCart($asin: String!, $qty: Int!) { addToCart(asin: $asin, qty: $qty) { id } }',
          variables: '{"asin":"B08KGRVW2S","qty":1}',
        },
      }),
    ]);
    const signals = extractor.extract(interaction) as any[];
    expect(signals).toHaveLength(1);
    expect(signals[0].operation).toBe('graphql:AddToCart');
    expect(signals[0].confidence).toBe(0.8);
    // entity hints from variables
    expect(signals[0].entityHints).toBeDefined();
    expect(signals[0].entityHints.some((h: any) => h.hint === 'product-id' && h.value === 'B08KGRVW2S')).toBe(true);
    expect(signals[0].entityHints.some((h: any) => h.hint === 'quantity' && h.value === '1')).toBe(true);
  });
});

// ── DDC-8: no fabricated success ───────────────────────────────────────

describe('DDC-8: no +0.1 fallback', () => {
  const determiner = new OutcomeDeterminer();

  it('state changes with zero votes → incomplete (indeterminate), not success', () => {
    const outcome = determiner.determine({
      interactionId: 'int-none',
      actionType: 'Click',
      actionTarget: 'Mystery button',
      signals: emptySignalSet('int-none'),
      transition: {
        interactionId: 'int-none',
        before: makeState(),
        after: makeState(),
        changes: ['view → somewhere'], // DOM changed, but no signal votes
      },
    });
    expect(outcome.outcome).toBe('incomplete');
    expect(outcome.confidence).toBe(0);
    expect(outcome.supportingEvidence).toHaveLength(0);
  });

  it('empty signals + empty transition → incomplete', () => {
    const outcome = determiner.determine({
      interactionId: 'int-empty',
      actionType: 'Click',
      actionTarget: 'X',
      signals: emptySignalSet('int-empty'),
      transition: null,
    });
    expect(outcome.outcome).toBe('incomplete');
    expect(outcome.confidence).toBe(0);
  });
});
