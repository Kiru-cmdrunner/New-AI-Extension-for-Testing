/**
 * M9.7 — Deterministic Semantic Enrichment Tests
 *
 * Covers all 7 capabilities:
 * 1. Domain classification (weighted scoring)
 * 2. Interaction contract extraction (element identity → contract)
 * 3. Component recognition (Tier 1 reuse + Tier 2 behavioral)
 * 4. Intent labeling (API operation → vocabulary → button text)
 * 5. Workflow discovery (temporal + view-containment grouping)
 * 6. Application surface enrichment (views + capabilities + navigation)
 * 7. Recorded workflow aggregation (cross-session patterns)
 *
 * Also tests the full SemanticEnricher orchestrator end-to-end.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import { describe, it, expect } from 'vitest';
import { classifyDomain } from '../../src/understanding/enrichment/domain-classifier';
import { recognizeComponent } from '../../src/understanding/enrichment/component-recognizer';
import { extractInteractionContract } from '../../src/understanding/enrichment/interaction-contract';
import { labelIntent, labelAllIntents } from '../../src/understanding/enrichment/intent-labeler';
import { discoverWorkflows } from '../../src/understanding/enrichment/workflow-discoverer';
import { buildApplicationSurface, enrichSurfaceWithKnowledge } from '../../src/understanding/enrichment/application-surface';
import { aggregateRecordedWorkflows, getRecurringPatterns } from '../../src/understanding/enrichment/recorded-workflow';
import { enrichSemantically } from '../../src/understanding/enrichment/semantic-enricher';
import type { SemanticWorkflow } from '../../src/understanding/enrichment/semantic-types';
import type { ApplicationKnowledge } from '../../src/understanding/consolidation/application-knowledge';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';
import type { ActionOutcome } from '../../src/understanding/outcome/outcome-types';
import type { ApplicationState, StateTransition } from '../../src/understanding/state-builder/types';
import type { ViewDescriptor } from '../../src/understanding/types';

// ── Helpers ────────────────────────────────────────────────────────────

function elem(id: string, overrides?: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: id,
    ...overrides,
  };
}

function interaction(
  id: string,
  startMs: number,
  trigger: ElementIdentity,
  overrides?: Partial<ComponentInteraction>,
): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click',
    trigger,
    triggerEvent: {} as never,
    memberEvents: [],
    startTime: startMs,
    endTime: startMs + 500,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

function outcome(
  interactionId: string,
  outcomeStr: 'success' | 'failure' | 'ambiguous' | 'incomplete' = 'success',
  overrides?: Partial<ActionOutcome>,
): ActionOutcome {
  return {
    interactionId,
    actionType: 'Click',
    actionTarget: '',
    outcome: outcomeStr,
    confidence: 0.9,
    confidenceLevel: 'confirmed',
    supportingEvidence: [],
    resultingEntities: [],
    stateChanges: [],
    ...overrides,
  };
}

function view(id: string, label = id): ViewDescriptor {
  return { id, label, confidence: 0.9, detectedFrom: 'url-pattern' };
}

function state(overrides?: Partial<ApplicationState>): ApplicationState {
  return {
    currentView: view('product-detail', 'Product Detail'),
    currentUrl: 'https://shop.example.com/product/1',
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: null,
    interactionCount: 0,
    ...overrides,
  };
}

function transition(
  interactionId: string,
  beforeView: ViewDescriptor | null,
  afterView: ViewDescriptor | null,
  changes: string[] = [],
): StateTransition {
  return {
    interactionId,
    before: { ...state(), currentView: beforeView },
    after: { ...state(), currentView: afterView },
    changes,
  };
}

function knowledge(overrides?: Partial<ApplicationKnowledge>): ApplicationKnowledge {
  return {
    appId: 'app-test',
    origin: 'https://shop.example.com/cart',
    label: 'Test Shop',
    sessionCount: 3,
    firstSeenAt: 1000,
    lastActiveAt: 9000,
    entities: [],
    views: [
      { viewId: 'cart', label: 'Shopping Cart', detectedFrom: 'url-pattern', visitCount: 5, confidence: { score: 0.9, observationScore: 0.8, recencyScore: 0.9, sourceScore: 0.8, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000 },
      { viewId: 'checkout', label: 'Checkout', detectedFrom: 'url-pattern', visitCount: 3, confidence: { score: 0.8, observationScore: 0.7, recencyScore: 0.8, sourceScore: 0.8, level: 'high' }, firstSeenAt: 2000, lastSeenAt: 8000 },
    ],
    viewGraph: { nodes: [], edges: [] },
    collections: [],
    counters: [],
    notifications: [],
    outcomePattern: { totalActions: 10, successCount: 8, failureCount: 1, ambiguousCount: 1, incompleteCount: 0, topActionTypes: [{ actionType: 'Click', count: 8 }] },
    totalRows: 20,
    ...overrides,
  };
}

// ── 1. Domain Classification ───────────────────────────────────────────

describe('DomainClassifier', () => {
  it('classifies e-commerce from cart/checkout views + product entities', () => {
    const k = knowledge({
      origin: 'https://shop.example.com/cart',
      views: [
        { viewId: 'cart', label: 'Cart', detectedFrom: 'url-pattern', visitCount: 5, confidence: { score: 0.9, observationScore: 0.8, recencyScore: 0.9, sourceScore: 0.8, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000 },
        { viewId: 'checkout', label: 'Checkout', detectedFrom: 'url-pattern', visitCount: 3, confidence: { score: 0.8, observationScore: 0.7, recencyScore: 0.8, sourceScore: 0.8, level: 'high' }, firstSeenAt: 2000, lastSeenAt: 8000 },
      ],
      entities: [
        { entityId: 'product-1', type: 'product', attributes: { name: 'Widget' }, source: 'view-derived', revision: 1, confidence: { score: 0.9, observationScore: 0.8, recencyScore: 0.9, sourceScore: 0.8, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000, observedInSessions: ['s1', 's2'] },
      ],
    });

    const result = classifyDomain(k);
    expect(result.domain).toBe('e-commerce');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.evidence.matchedSignals.length).toBeGreaterThan(0);
  });

  it('classifies authentication from login views + URL fragments', () => {
    const k = knowledge({
      origin: 'https://app.example.com/login',
      views: [
        { viewId: 'login', label: 'Login', detectedFrom: 'url-pattern', visitCount: 10, confidence: { score: 0.9, observationScore: 0.8, recencyScore: 0.9, sourceScore: 0.8, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000 },
      ],
      entities: [],
    });
    const result = classifyDomain(k);
    expect(result.domain).toBe('authentication');
  });

  it('classifies admin-crm from admin URL fragments', () => {
    const k = knowledge({
      origin: 'https://erp.example.com/admin/users',
      views: [],
      entities: [{ entityId: 'user-1', type: 'user', attributes: {}, source: 'view-derived', revision: 1, confidence: { score: 0.9, observationScore: 0.8, recencyScore: 0.9, sourceScore: 0.8, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000, observedInSessions: ['s1'] }],
    });
    const result = classifyDomain(k);
    expect(result.domain).toBe('admin-crm');
  });

  it('returns unknown when no signals match', () => {
    const k = knowledge({
      origin: 'https://random.example.com/page',
      views: [{ viewId: 'unknown-page', label: 'Page', detectedFrom: 'url-pattern', visitCount: 1, confidence: { score: 0.5, observationScore: 0.5, recencyScore: 0.5, sourceScore: 0.5, level: 'medium' }, firstSeenAt: 1000, lastSeenAt: 1000 }],
      entities: [],
      notifications: [],
      outcomePattern: { totalActions: 1, successCount: 1, failureCount: 0, ambiguousCount: 0, incompleteCount: 0, topActionTypes: [] },
    });
    const result = classifyDomain(k);
    expect(result.domain).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('reports margin between winner and alternative', () => {
    const k = knowledge({
      origin: 'https://shop.example.com/shop',
      views: [
        { viewId: 'cart', label: 'Cart', detectedFrom: 'url-pattern', visitCount: 5, confidence: { score: 0.9, observationScore: 0.8, recencyScore: 0.9, sourceScore: 0.8, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000 },
        { viewId: 'login', label: 'Login', detectedFrom: 'url-pattern', visitCount: 1, confidence: { score: 0.5, observationScore: 0.4, recencyScore: 0.5, sourceScore: 0.4, level: 'medium' }, firstSeenAt: 2000, lastSeenAt: 2000 },
      ],
      entities: [
        { entityId: 'product-1', type: 'product', attributes: {}, source: 'view-derived', revision: 1, confidence: { score: 0.8, observationScore: 0.7, recencyScore: 0.8, sourceScore: 0.7, level: 'high' }, firstSeenAt: 1000, lastSeenAt: 9000, observedInSessions: ['s1'] },
      ],
    });
    const result = classifyDomain(k);
    expect(result.domain).toBe('e-commerce');
    expect(result.alternative).not.toBeNull();
    expect(result.margin).toBeGreaterThan(0);
  });
});


// ── 2. Interaction Contract Extraction ─────────────────────────────────

describe('InteractionContract', () => {
  it('extracts text-input contract from INPUT[type=text]', () => {
    const i = interaction('i-1', 1000, elem('e-1', {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Search products',
      placeholder: 'Enter search term...',
    }));
    const contract = extractInteractionContract(i);
    expect(contract.elementType).toBe('text-input');
    expect(contract.inputType).toBe('text');
    expect(contract.format).toBe('text');
    expect(contract.placeholder).toBe('Enter search term...');
    expect(contract.label).toBe('Search products');
  });

  it('extracts email-input contract from INPUT[type=email]', () => {
    const i = interaction('i-2', 1000, elem('e-2', {
      tag: 'INPUT',
      inputType: 'email',
      accessibleName: 'Email',
    }));
    const contract = extractInteractionContract(i);
    expect(contract.elementType).toBe('email-input');
    expect(contract.format).toBe('email');
  });

  it('extracts checkbox contract from INPUT[type=checkbox]', () => {
    const i = interaction('i-3', 1000, elem('e-3', {
      tag: 'INPUT',
      inputType: 'checkbox',
      accessibleName: 'Accept terms',
    }));
    const contract = extractInteractionContract(i);
    expect(contract.elementType).toBe('checkbox');
  });

  it('extracts select contract from SELECT tag', () => {
    const i = interaction('i-4', 1000, elem('e-4', {
      tag: 'SELECT',
      accessibleName: 'Country',
    }));
    const contract = extractInteractionContract(i);
    expect(contract.elementType).toBe('select');
  });

  it('extracts button contract from BUTTON tag', () => {
    const i = interaction('i-5', 1000, elem('e-5', {
      tag: 'BUTTON',
      accessibleName: 'Submit',
    }));
    const contract = extractInteractionContract(i);
    expect(contract.elementType).toBe('button');
  });

  it('extracts link contract from A tag', () => {
    const i = interaction('i-6', 1000, elem('e-6', {
      tag: 'A',
      accessibleName: 'Home',
      href: 'https://example.com/',
    }));
    const contract = extractInteractionContract(i);
    expect(contract.elementType).toBe('link');
  });
});


// ── 3. Component Recognition ───────────────────────────────────────────

describe('ComponentRecognizer', () => {
  it('Tier 1: uses enrichment componentType when available', () => {
    const i = interaction('i-1', 1000, elem('e-1', { tag: 'BUTTON', accessibleName: 'Add' }), {
      componentType: 'IconButton',
      componentFramework: 'MUI',
      businessMeaning: 'Add item',
    });
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('IconButton');
    expect(model.componentFramework).toBe('MUI');
    expect(model.businessMeaning).toBe('Add item');
    expect(model.detectedBy).toBe('enrichment');
  });

  it('Tier 1 ARIA: recognizes checkbox from role', () => {
    const i = interaction('i-2', 1000, elem('e-2', {
      tag: 'DIV',
      ariaRole: 'checkbox',
      accessibleName: 'Remember me',
    }));
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('checkbox');
    expect(model.detectedBy).toBe('tier1-aria');
  });

  it('Tier 2: recognizes button from tag', () => {
    const i = interaction('i-3', 1000, elem('e-3', {
      tag: 'BUTTON',
      accessibleName: 'Save',
    }));
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('button');
    expect(model.detectedBy).toBe('tier2-behavioral');
  });

  it('Tier 2: recognizes link from A tag', () => {
    const i = interaction('i-4', 1000, elem('e-4', { tag: 'A' }));
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('link');
  });

  it('Tier 2: recognizes search-input from inputType=search', () => {
    const i = interaction('i-5', 1000, elem('e-5', {
      tag: 'INPUT',
      inputType: 'search',
    }));
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('search-input');
  });

  it('Tier 2: recognizes select from SELECT tag', () => {
    const i = interaction('i-6', 1000, elem('e-6', { tag: 'SELECT' }));
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('select');
  });

  it('Tier 2: recognizes link from button with nav outcome', () => {
    const i = interaction('i-7', 1000, elem('e-7', { tag: 'BUTTON', ariaRole: 'button' }));
    const o = outcome('i-7', 'success', {
      stateChanges: ['view-change: home → product-detail'],
    });
    const model = recognizeComponent(i, o);
    expect(model.componentType).toBe('link');
  });

  it('Tier 2: fallback to unknown for unrecognizable elements', () => {
    const i = interaction('i-8', 1000, elem('e-8', { tag: 'SPAN' }));
    const model = recognizeComponent(i);
    expect(model.componentType).toBe('unknown');
  });
});


// ── 4. Intent Labeling ─────────────────────────────────────────────────

describe('IntentLabeler', () => {
  it('resolves "Add to cart" from button label vocabulary', () => {
    const i = interaction('i-1', 1000, elem('e-1', {
      tag: 'BUTTON',
      accessibleName: 'Add to Cart',
    }));
    const label = labelIntent(i);
    expect(label.intent).toBe('Add to cart');
    expect(label.confidence).toBeGreaterThan(0.7);
  });

  it('resolves "Sign in" from auth vocabulary', () => {
    const i = interaction('i-2', 1000, elem('e-2', {
      tag: 'BUTTON',
      accessibleName: 'Sign In',
    }));
    const label = labelIntent(i);
    expect(label.intent).toBe('Sign in');
  });

  it('resolves "Proceed to checkout" from vocabulary', () => {
    const i = interaction('i-3', 1000, elem('e-3', {
      tag: 'BUTTON',
      accessibleName: 'Proceed to checkout',
    }));
    const label = labelIntent(i);
    expect(label.intent).toBe('Proceed to checkout');
  });

  it('resolves "Search" from inputType=search', () => {
    const i = interaction('i-4', 1000, elem('e-4', {
      tag: 'INPUT',
      inputType: 'search',
      accessibleName: '',
    }));
    const label = labelIntent(i);
    expect(label.intent).toBe('Search');
  });

  it('resolves intent from API-operation evidence', () => {
    const i = interaction('i-5', 1000, elem('e-5', { tag: 'BUTTON', accessibleName: 'Go' }));
    const o = outcome('i-5', 'success', {
      supportingEvidence: [{
        kind: 'api-operation',
        result: 'success',
        weight: 0.9,
        detail: 'POST /api/cart/items',
        interactionId: 'i-5',
      }],
    });
    const label = labelIntent(i, o);
    expect(label.resolutionPath).toBe('api-operation');
    expect(label.intent).toBe('Submit form');
  });

  it('falls back to button text for unmatched labels', () => {
    const i = interaction('i-6', 1000, elem('e-6', {
      tag: 'BUTTON',
      accessibleName: 'Do Something Weird',
    }));
    const label = labelIntent(i);
    expect(label.intent).toBe('Do Something Weird');
    expect(label.resolutionPath).toBe('context');
    expect(label.confidence).toBeLessThan(0.5);
  });

  it('labelAllIntents processes multiple interactions', () => {
    const i1 = interaction('i-1', 1000, elem('e-1', { accessibleName: 'Add to Cart', tag: 'BUTTON' }));
    const i2 = interaction('i-2', 2000, elem('e-2', { accessibleName: 'Cancel', tag: 'BUTTON' }));
    const outcomes = new Map<string, ActionOutcome>();
    const result = labelAllIntents([i1, i2], outcomes);
    expect(result.get('i-1')?.intent).toBe('Add to cart');
    expect(result.get('i-2')?.intent).toBe('Cancel');
  });
});


// ── 5. Workflow Discovery ──────────────────────────────────────────────

describe('WorkflowDiscoverer', () => {
  it('groups temporally close interactions into one workflow', () => {
    const i1 = interaction('i-1', 1000, elem('e-1', { accessibleName: 'Search' }));
    const i2 = interaction('i-2', 5000, elem('e-2', { accessibleName: 'Add to Cart' }));
    const intents = new Map([
      ['i-1', { interactionId: 'i-1', intent: 'Search', resolutionPath: 'button-text' as const, confidence: 0.8 }],
      ['i-2', { interactionId: 'i-2', intent: 'Add to cart', resolutionPath: 'button-text' as const, confidence: 0.85 }],
    ]);
    const outcomes = new Map<string, ActionOutcome>([
      ['i-1', outcome('i-1', 'success')],
      ['i-2', outcome('i-2', 'success')],
    ]);
    const transitions = [
      transition('i-1', view('home'), view('search-results')),
      transition('i-2', view('search-results'), view('product-detail')),
    ];

    const workflows = discoverWorkflows([i1, i2], outcomes, transitions, intents, 's1');
    expect(workflows.length).toBe(1);
    expect(workflows[0].stepIds).toEqual(['i-1', 'i-2']);
    expect(workflows[0].overallOutcome).toBe('success');
  });

  it('splits workflows on large temporal gap', () => {
    const i1 = interaction('i-1', 1000, elem('e-1'));
    const i2 = interaction('i-2', 120_000, elem('e-2')); // 120s later
    const intents = new Map([
      ['i-1', { interactionId: 'i-1', intent: 'A', resolutionPath: 'context' as const, confidence: 0.3 }],
      ['i-2', { interactionId: 'i-2', intent: 'B', resolutionPath: 'context' as const, confidence: 0.3 }],
    ]);
    const outcomes = new Map<string, ActionOutcome>();
    const transitions = [
      transition('i-1', view('home'), view('home')),
      transition('i-2', view('home'), view('home')),
    ];

    const workflows = discoverWorkflows([i1, i2], outcomes, transitions, intents, 's1');
    expect(workflows.length).toBe(2);
  });

  it('splits workflows on view boundary', () => {
    const i1 = interaction('i-1', 1000, elem('e-1'));
    const i2 = interaction('i-2', 3000, elem('e-2'));
    const intents = new Map([
      ['i-1', { interactionId: 'i-1', intent: 'Browse', resolutionPath: 'context' as const, confidence: 0.3 }],
      ['i-2', { interactionId: 'i-2', intent: 'Checkout', resolutionPath: 'context' as const, confidence: 0.3 }],
    ]);
    const outcomes = new Map<string, ActionOutcome>();
    const transitions = [
      transition('i-1', view('home'), view('product-detail'), ['view changed: home → product-detail']),
      transition('i-2', view('product-detail'), view('checkout'), ['view changed: product-detail → checkout']),
    ];

    const workflows = discoverWorkflows([i1, i2], outcomes, transitions, intents, 's1');
    expect(workflows.length).toBe(2);
  });

  it('computes workflow effects from outcomes', () => {
    const i1 = interaction('i-1', 1000, elem('e-1', { accessibleName: 'Add to Cart' }));
    const intents = new Map([
      ['i-1', { interactionId: 'i-1', intent: 'Add to cart', resolutionPath: 'button-text' as const, confidence: 0.85 }],
    ]);
    const outcomes = new Map<string, ActionOutcome>([
      ['i-1', outcome('i-1', 'success', { resultingEntities: ['cart-item-1'] })],
    ]);
    const transitions = [
      transition('i-1', view('product-detail'), view('cart-confirmation'), ['view changed: product-detail → cart-confirmation']),
    ];

    const workflows = discoverWorkflows([i1], outcomes, transitions, intents, 's1');
    expect(workflows[0].effects.entitiesCreated).toContain('cart-item-1');
    expect(workflows[0].effects.viewTransitions).toEqual([
      { from: 'product-detail', to: 'cart-confirmation' },
    ]);
  });

  it('reports mixed outcome when both success and failure present', () => {
    const i1 = interaction('i-1', 1000, elem('e-1'));
    const i2 = interaction('i-2', 2000, elem('e-2'));
    const intents = new Map([
      ['i-1', { interactionId: 'i-1', intent: 'A', resolutionPath: 'context' as const, confidence: 0.3 }],
      ['i-2', { interactionId: 'i-2', intent: 'B', resolutionPath: 'context' as const, confidence: 0.3 }],
    ]);
    const outcomes = new Map<string, ActionOutcome>([
      ['i-1', outcome('i-1', 'success')],
      ['i-2', outcome('i-2', 'failure')],
    ]);
    const transitions = [
      transition('i-1', view('home'), view('home')),
      transition('i-2', view('home'), view('home')),
    ];

    const workflows = discoverWorkflows([i1, i2], outcomes, transitions, intents, 's1');
    expect(workflows[0].overallOutcome).toBe('mixed');
  });

  it('returns empty for no interactions', () => {
    const workflows = discoverWorkflows([], new Map(), [], new Map(), 's1');
    expect(workflows).toEqual([]);
  });
});


// ── 6. Application Surface ─────────────────────────────────────────────

describe('ApplicationSurface', () => {
  it('builds surface views from transitions', () => {
    const transitions = [
      transition('i-1', view('home'), view('product-detail')),
      transition('i-2', view('product-detail'), view('cart')),
    ];
    const surface_ = buildApplicationSurface(
      null,
      [],
      [],
      [],
      new Map(),
      transitions,
    );
    expect(surface_.views.length).toBe(3);
    expect(surface_.views.map((v) => v.viewId)).toContain('home');
    expect(surface_.views.map((v) => v.viewId)).toContain('product-detail');
    expect(surface_.views.map((v) => v.viewId)).toContain('cart');
  });

  it('creates navigation edges between views', () => {
    const transitions = [
      transition('i-1', view('home'), view('product-detail')),
      transition('i-2', view('product-detail'), view('cart')),
    ];
    const surface_ = buildApplicationSurface(null, [], [], [], new Map(), transitions);
    expect(surface_.navigationEdges.length).toBe(2);
    expect(surface_.navigationEdges).toContainEqual({ fromViewId: 'home', toViewId: 'product-detail', count: 1 });
    expect(surface_.navigationEdges).toContainEqual({ fromViewId: 'product-detail', toViewId: 'cart', count: 1 });
  });

  it('assigns capabilities to views from intents', () => {
    const i1 = interaction('i-1', 1000, elem('e-1', { accessibleName: 'Add to Cart' }));
    const intents = new Map([
      ['i-1', { interactionId: 'i-1', intent: 'Add to cart', resolutionPath: 'button-text' as const, confidence: 0.85 }],
    ]);
    const transitions = [
      transition('i-1', view('product-detail'), view('product-detail')),
    ];
    const surface_ = buildApplicationSurface(null, [i1], [], [], intents, transitions);
    const productView = surface_.views.find((v) => v.viewId === 'product-detail');
    expect(productView?.capabilities).toContain('Add to cart');
  });

  it('enriches with knowledge: visit counts and business purpose', () => {
    const transitions = [
      transition('i-1', view('home'), view('cart')),
    ];
    let surface_ = buildApplicationSurface(null, [], [], [], new Map(), transitions);
    const k = knowledge();
    surface_ = enrichSurfaceWithKnowledge(surface_, k);
    const cartView = surface_.views.find((v) => v.viewId === 'cart');
    expect(cartView?.visitCount).toBeGreaterThan(1);
    expect(cartView?.businessPurpose).toBeTruthy();
  });

  it('aggregates navigation edge counts', () => {
    const transitions = [
      transition('i-1', view('a'), view('b')),
      transition('i-2', view('a'), view('b')),
      transition('i-3', view('a'), view('b')),
    ];
    const surface_ = buildApplicationSurface(null, [], [], [], new Map(), transitions);
    const edge = surface_.navigationEdges.find((e) => e.fromViewId === 'a' && e.toViewId === 'b');
    expect(edge?.count).toBe(3);
  });
});


// ── 7. Recorded Workflow Aggregation ───────────────────────────────────

describe('RecordedWorkflow', () => {
  it('aggregates identical patterns across sessions', () => {
    const w1: SemanticWorkflow = {
      workflowId: 'wf-s1-0', sessionId: 's1', label: 'Add to cart',
      stepIds: ['i-1', 'i-2'], stepIntents: ['Search', 'Add to cart'],
      viewIds: ['home', 'product-detail'], overallOutcome: 'success',
      effects: { entitiesCreated: [], entitiesModified: [], counterDeltas: [], collectionChanges: [], notificationsEmitted: [], viewTransitions: [] },
    };
    const w2: SemanticWorkflow = {
      workflowId: 'wf-s2-0', sessionId: 's2', label: 'Add to cart',
      stepIds: ['i-3', 'i-4'], stepIntents: ['Search', 'Add to cart'],
      viewIds: ['home', 'product-detail'], overallOutcome: 'success',
      effects: { entitiesCreated: [], entitiesModified: [], counterDeltas: [], collectionChanges: [], notificationsEmitted: [], viewTransitions: [] },
    };
    const aggregated = aggregateRecordedWorkflows([w1, w2]);
    expect(aggregated.length).toBe(1);
    expect(aggregated[0].occurrenceCount).toBe(2);
    expect(aggregated[0].sessionIds).toContain('s1');
    expect(aggregated[0].sessionIds).toContain('s2');
  });

  it('keeps distinct patterns separate', () => {
    const w1: SemanticWorkflow = {
      workflowId: 'wf-s1-0', sessionId: 's1', label: 'A',
      stepIds: ['i-1'], stepIntents: ['Search'],
      viewIds: ['home'], overallOutcome: 'success',
      effects: { entitiesCreated: [], entitiesModified: [], counterDeltas: [], collectionChanges: [], notificationsEmitted: [], viewTransitions: [] },
    };
    const w2: SemanticWorkflow = {
      workflowId: 'wf-s1-1', sessionId: 's1', label: 'B',
      stepIds: ['i-2'], stepIntents: ['Sign in'],
      viewIds: ['login'], overallOutcome: 'success',
      effects: { entitiesCreated: [], entitiesModified: [], counterDeltas: [], collectionChanges: [], notificationsEmitted: [], viewTransitions: [] },
    };
    const aggregated = aggregateRecordedWorkflows([w1, w2]);
    expect(aggregated.length).toBe(2);
  });

  it('getRecurringPatterns filters to 2+ occurrences', () => {
    const base = {
      effects: { entitiesCreated: [], entitiesModified: [], counterDeltas: [], collectionChanges: [], notificationsEmitted: [], viewTransitions: [] },
    };
    const w1: SemanticWorkflow = { workflowId: 'w1', sessionId: 's1', label: 'A', stepIds: ['i-1'], stepIntents: ['X'], viewIds: ['v1'], overallOutcome: 'success', ...base };
    const w2: SemanticWorkflow = { workflowId: 'w2', sessionId: 's2', label: 'A', stepIds: ['i-2'], stepIntents: ['X'], viewIds: ['v1'], overallOutcome: 'success', ...base };
    const w3: SemanticWorkflow = { workflowId: 'w3', sessionId: 's1', label: 'B', stepIds: ['i-3'], stepIntents: ['Y'], viewIds: ['v2'], overallOutcome: 'success', ...base };
    const aggregated = aggregateRecordedWorkflows([w1, w2, w3]);
    const recurring = getRecurringPatterns(aggregated);
    expect(recurring.length).toBe(1);
    expect(recurring[0].occurrenceCount).toBe(2);
  });

  it('preserves prior recorded workflows', () => {
    const prior = {
      patternId: 'wf-pattern-abc123',
      label: 'Checkout flow',
      canonicalSteps: ['Search', 'Add to cart', 'Proceed to checkout'],
      viewSequence: ['home', 'product-detail', 'checkout'],
      sessionIds: ['s0'],
      occurrenceCount: 1,
      instances: ['wf-s0-0'],
    };
    const w1: SemanticWorkflow = {
      workflowId: 'wf-s1-0', sessionId: 's1', label: 'Checkout flow',
      stepIds: ['i-1', 'i-2', 'i-3'],
      stepIntents: ['Search', 'Add to cart', 'Proceed to checkout'],
      viewIds: ['home', 'product-detail', 'checkout'], overallOutcome: 'success',
      effects: { entitiesCreated: [], entitiesModified: [], counterDeltas: [], collectionChanges: [], notificationsEmitted: [], viewTransitions: [] },
    };
    const aggregated = aggregateRecordedWorkflows([w1], [prior]);
    // The new workflow should merge into the prior pattern
    const matchingPattern = aggregated.find((p) => p.label === 'Checkout flow');
    expect(matchingPattern?.occurrenceCount).toBe(2);
    expect(matchingPattern?.sessionIds).toContain('s0');
    expect(matchingPattern?.sessionIds).toContain('s1');
  });
});


// ── 8. Full Enricher End-to-End ────────────────────────────────────────

describe('SemanticEnricher (end-to-end)', () => {
  it('produces complete SemanticKnowledge from session data', () => {
    const i1 = interaction('i-1', 1000, elem('e-1', { accessibleName: 'Search', tag: 'INPUT', inputType: 'search' }), { type: 'TextEntry' });
    const i2 = interaction('i-2', 5000, elem('e-2', { accessibleName: 'Add to Cart', tag: 'BUTTON' }));
    const i3 = interaction('i-3', 10_000, elem('e-3', { accessibleName: 'Proceed to checkout', tag: 'BUTTON' }));

    const outcomes = new Map<string, ActionOutcome>([
      ['i-1', outcome('i-1', 'success')],
      ['i-2', outcome('i-2', 'success', { resultingEntities: ['cart-item-1'] })],
      ['i-3', outcome('i-3', 'success')],
    ]);

    const transitions = [
      transition('i-1', view('home'), view('search-results')),
      transition('i-2', view('search-results'), view('product-detail'), ['view changed: search-results → product-detail']),
      transition('i-3', view('product-detail'), view('checkout'), ['view changed: product-detail → checkout']),
    ];

    const result = enrichSemantically({
      appId: 'app-test',
      interactions: [i1, i2, i3],
      outcomes,
      transitions,
      currentState: state({ currentView: view('checkout') }),
      priorKnowledge: knowledge(),
      sessionId: 's1',
    });

    // Domain
    expect(result.domain.domain).toBe('e-commerce');
    // Contracts
    expect(result.contracts.length).toBe(3);
    // Components
    expect(result.components.length).toBe(3);
    // Intents
    expect(result.intents.length).toBe(3);
    const addToCartIntent = result.intents.find((il) => il.interactionId === 'i-2');
    expect(addToCartIntent?.intent).toBe('Add to cart');
    // Workflows
    expect(result.workflows.length).toBeGreaterThan(0);
    // Surface
    expect(result.surface.views.length).toBeGreaterThan(0);
    // Metadata
    expect(result.metadata.enricherVersion).toBe('m9.7-deterministic-v1');
    expect(result.metadata.interactionCount).toBe(3);
    expect(result.metadata.coverage.intentCoverage).toBeGreaterThan(0);
  });

  it('handles empty session gracefully', () => {
    const result = enrichSemantically({
      appId: 'app-empty',
      interactions: [],
      outcomes: new Map(),
      transitions: [],
      currentState: null,
      priorKnowledge: null,
      priorRecordedWorkflows: null,
      sessionId: 's-empty',
    });

    expect(result.contracts).toEqual([]);
    expect(result.components).toEqual([]);
    expect(result.intents).toEqual([]);
    expect(result.workflows).toEqual([]);
    expect(result.surface.views).toEqual([]);
    expect(result.metadata.interactionCount).toBe(0);
  });

  it('falls back to session heuristic domain classification without prior knowledge', () => {
    const i1 = interaction('i-1', 1000, elem('e-1', { accessibleName: 'Add to Cart', tag: 'BUTTON' }));
    const result = enrichSemantically({
      appId: 'app-test',
      interactions: [i1],
      outcomes: new Map(),
      transitions: [transition('i-1', view('cart'), view('cart'))],
      currentState: state({ currentView: view('cart', 'Cart') }),
      priorKnowledge: null,
      priorRecordedWorkflows: null,
      sessionId: 's1',
    });
    expect(result.domain.domain).toBe('e-commerce');
  });
});
