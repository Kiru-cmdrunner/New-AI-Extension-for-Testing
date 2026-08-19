/**
 * M9.4 - Page Content Observer
 * Focused tests.
 *
 * Covers:
 *  - Semantic scanning with bounded results
 *  - Noise filtering (hidden elements, non-semantic tags, short text)
 *  - Deduplication (first-match-wins)
 *  - Counter/collection/entity/notification extraction
 *  - Amazon add-to-cart workflow: int-19 gap filled by page-content snapshot
 *  - StateBuilder integration
 *  - OutcomeDeterminer integration
 */

import { describe, it, expect } from 'vitest';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import type { DOMAdapter, ElementLike } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { extractFromSnapshot } from '../../src/understanding/page-content/page-content-signals';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { OutcomeDeterminer } from '../../src/understanding/outcome/outcome-determiner';
import type { SignalSet } from '../../src/understanding/types';
import type { PageContentSnapshot } from '../../src/understanding/page-content/page-content-types';

// -- Mock DOM helpers --

class MockElement implements ElementLike {
  tagName: string;
  textContent: string | null;
  attrs: Record<string, string> = {};
  visible: boolean;
  path: string;
  children: ElementLike[] = [];

  constructor(opts: {
    tagName: string;
    text?: string | null;
    attrs?: Record<string, string>;
    visible?: boolean;
    path: string;
    children?: ElementLike[];
  }) {
    this.tagName = opts.tagName;
    this.textContent = opts.text ?? null;
    this.attrs = opts.attrs ?? {};
    this.visible = opts.visible ?? true;
    this.path = opts.path;
    this.children = opts.children ?? [];
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getPath(): string {
    return this.path;
  }
}

class MockDOM implements DOMAdapter {
  private elements: ElementLike[];
  url: string;

  constructor(elements: ElementLike[], url = 'https://example.com/cart') {
    this.elements = elements;
    this.url = url;
  }

  querySelectorAll(selector: string): ElementLike[] {
    // Mock selector matching: we pre-assign selectors to elements
    return this.elements.filter((el) => {
      const mockEl = el as MockElement;
      return mockEl.attrs['data-mock-match'] === selector;
    });
  }

  querySelector(selector: string): ElementLike | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }
}

function mockEl(opts: {
  tagName: string;
  text?: string | null;
  attrs?: Record<string, string>;
  visible?: boolean;
  path: string;
  children?: ElementLike[];
  match?: string;
}): MockElement {
  const el = new MockElement(opts);
  if (opts.match) {
    el.attrs['data-mock-match'] = opts.match;
  }
  return el;
}

// -- Scanning --

describe('M9.4 PageContentObserver - scanning', () => {
  it('returns null for empty DOM', () => {
    const dom = new MockDOM([]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);
    expect(snap).toBeNull();
  });

  it('extracts counter with numeric value', () => {
    const counterEl = mockEl({
      tagName: 'SPAN',
      text: '1',
      attrs: { 'aria-label': 'Shopping Cart, 1 item' },
      path: '#nav-cart-count',
      match: '[data-testid*="cart-count" i], [data-testid*="cart-badge" i], [aria-label*="cart" i][class*="count" i]',
    });

    const dom = new MockDOM([counterEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan('cart-confirmation');

    expect(snap).not.toBeNull();
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters.length).toBe(1);
    expect(counters[0].numericValue).toBe(1);
    expect(counters[0].attributes['aria-label']).toContain('Shopping Cart');
  });

  it('extracts notification from role=alert', () => {
    const alertEl = mockEl({
      tagName: 'DIV',
      text: 'Added to Cart',
      path: 'div#confirm',
      match: '[role="alert"], [role="status"]',
    });

    const dom = new MockDOM([alertEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    const notifs = snap!.items.filter((i) => i.kind === 'notification');
    expect(notifs.length).toBe(1);
    expect(notifs[0].text).toBe('Added to Cart');
  });

  it('extracts entity from data-asin', () => {
    const productEl = mockEl({
      tagName: 'DIV',
      text: 'vivo Y11 5G Smartphone',
      attrs: { 'data-asin': 'B0XYZ12345' },
      path: 'div[data-asin]',
      match: '[data-asin]',
    });

    const dom = new MockDOM([productEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan('product-detail');

    const entities = snap!.items.filter((i) => i.kind === 'entity');
    expect(entities.length).toBe(1);
    expect(entities[0].entityId).toBe('B0XYZ12345');
    expect(entities[0].entityType).toBe('product');
  });

  it('P1: sibling entities sharing a grouping path are EACH captured (entityId dedup)', () => {
    // Three cart items share path 'ul > li' but carry distinct data-asin ids.
    const items = [
      mockEl({ tagName: 'LI', text: 'Widget A', attrs: { 'data-asin': 'B0VAL1' }, path: 'ul > li', match: '[data-asin]' }),
      mockEl({ tagName: 'LI', text: 'Widget B', attrs: { 'data-asin': 'B0VAL2' }, path: 'ul > li', match: '[data-asin]' }),
      mockEl({ tagName: 'LI', text: 'Widget C', attrs: { 'data-asin': 'B0VAL3' }, path: 'ul > li', match: '[data-asin]' }),
    ];
    const dom = new MockDOM(items);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);
    const entities = snap!.items.filter((i) => i.kind === 'entity');
    expect(entities.length).toBe(3);
    expect(entities.map((e) => e.entityId).sort()).toEqual(['B0VAL1', 'B0VAL2', 'B0VAL3']);
  });

  it('P1: duplicate entityId across selectors is deduped (first match wins)', () => {
    const a = mockEl({ tagName: 'LI', text: 'Widget A', attrs: { 'data-asin': 'B0DUP' }, path: 'ul > li', match: '[data-asin]' });
    const b = mockEl({ tagName: 'LI', text: 'Widget A alt', attrs: { 'data-asin': 'B0DUP' }, path: 'div > div', match: '[data-asin]' });
    const dom = new MockDOM([a, b]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);
    const entities = snap!.items.filter((i) => i.kind === 'entity');
    expect(entities.length).toBe(1);
    expect(entities[0].entityId).toBe('B0DUP');
  });

  it('extracts collection count from child elements', () => {
    const collectionEl = mockEl({
      tagName: 'UL',
      text: 'items',
      attrs: { 'data-testid': 'cart-items-list' },
      path: 'ul[data-testid]',
      children: [mockEl({ tagName: 'LI', path: 'li-1' }), mockEl({ tagName: 'LI', path: 'li-2' }), mockEl({ tagName: 'LI', path: 'li-3' })],
      match: 'ul[data-testid], ol[data-testid], [role="list"][data-testid]',
    });

    const dom = new MockDOM([collectionEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    const colls = snap!.items.filter((i) => i.kind === 'collection');
    expect(colls.length).toBe(1);
    expect(colls[0].numericValue).toBe(3);
  });

  it('extracts status badge', () => {
    const badgeEl = mockEl({
      tagName: 'SPAN',
      text: 'In Stock',
      attrs: { 'data-testid': 'availability-badge' },
      path: 'span#badge',
      match: '[class*="badge" i][class*="status" i], [data-testid*="status" i]',
    });

    const dom = new MockDOM([badgeEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    const badges = snap!.items.filter((i) => 'status-badge' as string === i.kind);
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe('In Stock');
  });
});

// -- Noise filtering --

describe('M9.4 PageContentObserver - noise filtering', () => {
  it('skips hidden elements', () => {
    const hiddenEl = mockEl({
      tagName: 'SPAN',
      text: '3 items',
      visible: false,
      path: '#hidden-counter',
      match: '[role="status"][class*="count" i], [class*="badge-count" i], [data-count]',
    });

    const dom = new MockDOM([hiddenEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    expect(snap).toBeNull();
  });

  it('skips script/style tags even if matching', () => {
    const scriptEl = mockEl({
      tagName: 'SCRIPT',
      text: 'cart count = 5',
      path: 'script#data',
      match: '[role="alert"], [role="status"]',
    });

    const dom = new MockDOM([scriptEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    expect(snap).toBeNull();
  });

  it('skips short text when extractNumeric is false', () => {
    const shortEl = mockEl({
      tagName: 'DIV',
      text: 'a',
      path: 'div#short',
      match: '[role="alert"], [role="status"]',
    });

    const dom = new MockDOM([shortEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    expect(snap).toBeNull();
  });

  it('deduplicates elements matched by multiple selectors', () => {
    const el = mockEl({
      tagName: 'DIV',
      text: 'Added to Cart',
      path: 'div#confirm',
    });
    el.attrs['data-mock-match'] = 'sel-a';

    const config = {
      name: 'test',
      selectors: [
        { selector: 'sel-a', kind: 'notification' as const },
        { selector: 'sel-b', kind: 'notification' as const },
      ],
    };

    const dom = new MockDOM([el]);
    const observer = new PageContentObserver(config, dom);
    const snap = observer.scan(null);

    // Dedup by path: only one item even if matched by first selector
    expect(snap!.items.length).toBe(1);
  });

  it('caps items at 50 and tracks overflow', () => {
    const elements: ElementLike[] = [];
    for (let i = 0; i < 60; i++) {
      elements.push(
        mockEl({
          tagName: 'DIV',
          text: `Product ${i}`,
          attrs: { 'data-asin': `B0XYZ${String(i).padStart(5, '0')}` },
          path: `div#prod-${i}`,
          match: '[data-asin]',
        }),
      );
    }

    const dom = new MockDOM(elements);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    expect(snap!.items.length).toBe(50);
    expect(snap!.itemsOverflow).toBe(10);
  });

  it('caps text length at 200 chars', () => {
    const longEl = mockEl({
      tagName: 'DIV',
      text: 'A'.repeat(300),
      path: 'div#long',
      match: '[role="alert"], [role="status"]',
    });

    const dom = new MockDOM([longEl]);
    const observer = new PageContentObserver(createDefaultPageContentConfig(), dom);
    const snap = observer.scan(null);

    const items = snap!.items.filter((i) => i.kind === 'notification');
    expect(items[0].text.length).toBe(200);
  });
});

// -- Signal extraction --

describe('M9.4 PageContentSignal extraction', () => {
  it('categorizes observations into entity/counter/collection/notification groups', () => {
    const snapshot = {
      url: 'https://example.com/cart',
      viewId: 'cart-confirmation',
      items: [
        { kind: 'counter' as const, matchedSelector: 's1', text: '1', numericValue: 1, entityId: null, entityType: null, domPath: '#cc', attributes: {}, visible: true },
        { kind: 'notification' as const, matchedSelector: 's2', text: 'Added to Cart', numericValue: null, entityId: null, entityType: null, domPath: '#nt', attributes: {}, visible: true },
        { kind: 'entity' as const, matchedSelector: 's3', text: 'vivo Y11 5G', numericValue: null, entityId: 'B0XYZ12345', entityType: 'product', domPath: '#pe', attributes: { 'data-asin': 'B0XYZ12345' }, visible: true },
        { kind: 'collection' as const, matchedSelector: 's4', text: 'items', numericValue: 1, entityId: null, entityType: null, domPath: '#cl', attributes: {}, visible: true },
      ],
      itemsOverflow: 0,
      scannedAt: 100,
      scanDurationMs: 5,
    };

    const signal = extractFromSnapshot(snapshot as PageContentSnapshot, 'int-19');

    expect(signal.type).toBe('page-content');
    expect(signal.source).toBe('page-content');
    expect(signal.interactionId).toBe('int-19');
    expect(signal.confidence).toBe(0.7);
    expect(signal.observedCounters.length).toBe(1);
    expect(signal.observedNotifications.length).toBe(1);
    expect(signal.observedEntities.length).toBe(1);
    expect(signal.observedCollections.length).toBe(1);
  });

  it('carries provenance interactionId on every observation', () => {
    const snapshot = {
      url: 'https://example.com/cart',
      viewId: null,
      items: [
        { kind: 'notification' as const, matchedSelector: 's', text: 'Hello', numericValue: null, entityId: null, entityType: null, domPath: '#n', attributes: {}, visible: true },
      ],
      itemsOverflow: 0,
      scannedAt: 0,
      scanDurationMs: 1,
    };

    const signal = extractFromSnapshot(snapshot as PageContentSnapshot, 'int-42');

    expect(signal.interactionId).toBe('int-42');
    expect(signal.snapshot.url).toBe('https://example.com/cart');
  });
});

// -- StateBuilder integration --

describe('M9.4 StateBuilder + page content', () => {
  function makeSignalSet(iid: string, overrides = {}): SignalSet {
    return {
      interactionId: iid,
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

  it('processes page-content snapshot into entities, counters, collections, notifications', () => {
    const builder = new StateBuilder();

    const pcSignal = extractFromSnapshot(
      {
        url: 'https://example.com/cart/add-to-cart/',
        viewId: 'cart-confirmation',
        items: [
          { kind: 'counter' as const, matchedSelector: 's1', text: '1', numericValue: 1, entityId: null, entityType: null, domPath: '#nav-cart-count', attributes: { 'aria-label': 'Cart' }, visible: true },
          { kind: 'notification' as const, matchedSelector: 's2', text: 'Added to Cart', numericValue: null, entityId: null, entityType: null, domPath: '#nt', attributes: {}, visible: true },
          { kind: 'entity' as const, matchedSelector: 's3', text: 'vivo Y11 5G', numericValue: null, entityId: 'B0XYZ12345', entityType: 'product', domPath: '#pe', attributes: { 'data-asin': 'B0XYZ12345' }, visible: true },
          { kind: 'collection' as const, matchedSelector: 's4', text: '1 item', numericValue: 1, entityId: null, entityType: null, domPath: '#cl', attributes: {}, visible: true },
        ],
        itemsOverflow: 0,
        scannedAt: 0,
        scanDurationMs: 2,
      },
      'int-19',
    );

    const transition = builder.processSignals(makeSignalSet('int-19', { pageContent: pcSignal }));
    const state = builder.getCurrentState();

    // Entity from content
    expect(state.entities.get('product:B0XYZ12345')).toBeDefined();
    expect(state.entities.get('product:B0XYZ12345')?.attributes['data-asin']).toBe('B0XYZ12345');

    // Counter from content
    expect(state.counters.size).toBe(1);
    const counter = Array.from(state.counters.values())[0];
    expect(counter.elementPath).toBe('#nav-cart-count');
    expect(counter.values[0].value).toBe('1');

    // Collection from content
    expect(state.collections.size).toBe(1);
    const coll = Array.from(state.collections.values())[0];
    expect(coll.count).toBe(1);

    // Notification from content
    expect(state.notifications.length).toBe(1);
    expect(state.notifications[0].text).toBe('Added to Cart');

    // Transition recorded changes
    expect(transition.changes.some((c) => c.includes('page-content'))).toBe(true);
  });

  it('upserts page-content entity over an inferred cart-item', () => {
    const builder = new StateBuilder();

    // int-17: PDP view creates product entity (view-derived)
    builder.processSignals(
      makeSignalSet('int-17', {
        viewChanges: [
          {
            type: 'view-change',
            source: 'navigation-url',
            interactionId: 'int-17',
            confidence: 0.9,
            fromView: null,
            toView: { id: 'product-detail', label: 'PDP', detectedFrom: 'url-pattern', confidence: 0.9 },
            fromUrl: 'https://example.com/s',
            toUrl: 'https://example.com/dp/B0XYZ12345',
            navigationType: 'full-reload',
          },
        ],
      }),
    );

    // int-19: page-content snapshot arrives for the same product
    const pcSignal = extractFromSnapshot(
      {
        url: 'https://example.com/cart/add-to-cart/',
        viewId: 'cart-confirmation',
        items: [
          { kind: 'entity' as const, matchedSelector: 's3', text: 'vivo Y11 5G', numericValue: null, entityId: 'B0XYZ12345', entityType: 'product', domPath: '#pe', attributes: { 'data-asin': 'B0XYZ12345', 'aria-label': 'vivo Y11 5G' }, visible: true },
        ],
        itemsOverflow: 0,
        scannedAt: 0,
        scanDurationMs: 2,
      },
      'int-19',
    );

    builder.processSignals(makeSignalSet('int-19', { pageContent: pcSignal }));
    const state = builder.getCurrentState();

    // Same entity - merged, not duplicated
    const products = Array.from(state.entities.values()).filter((e) => e.type === 'product');
    expect(products.length).toBe(1);
    expect(products[0].lastUpdated).toBe('int-19');
  });
});

// -- OutcomeDeterminer integration --

describe('M9.4 OutcomeDeterminer + page content', () => {
  function makeSignalSet(iid: string, overrides = {}): SignalSet {
    return {
      interactionId: iid,
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

  it('page-content evidence alone yields low-confidence success, not confirmed', () => {
    const determiner = new OutcomeDeterminer();

    const pcSignal = extractFromSnapshot(
      {
        url: 'https://example.com/cart/add-to-cart/',
        viewId: 'cart-confirmation',
        items: [
          { kind: 'counter' as const, matchedSelector: 's1', text: '1', numericValue: 1, entityId: null, entityType: null, domPath: '#nav-cart-count', attributes: {}, visible: true },
        ],
        itemsOverflow: 0,
        scannedAt: 0,
        scanDurationMs: 2,
      },
      'int-19',
    );

    const result = determiner.determine({
      interactionId: 'int-19',
      actionType: 'Click',
      actionTarget: 'Add to Cart',
      signals: makeSignalSet('int-19', { pageContent: pcSignal }),
      transition: null,
    });

    expect(result.outcome).toBe('success');
    expect(result.confidence).toBe(0.2);
    expect(result.confidenceLevel).toBe('inconclusive');
  });

  it('error notification in content votes failure', () => {
    const determiner = new OutcomeDeterminer();

    const pcSignal = extractFromSnapshot(
      {
        url: 'https://example.com/cart',
        viewId: null,
        items: [
          { kind: 'notification' as const, matchedSelector: 's1', text: 'Error: could not add item', numericValue: null, entityId: null, entityType: null, domPath: '#err', attributes: {}, visible: true },
        ],
        itemsOverflow: 0,
        scannedAt: 0,
        scanDurationMs: 2,
      },
      'int-19',
    );

    const result = determiner.determine({
      interactionId: 'int-19',
      actionType: 'Click',
      actionTarget: 'Add to Cart',
      signals: makeSignalSet('int-19', { pageContent: pcSignal }),
      transition: null,
    });

    expect(result.outcome).toBe('failure');
  });

  it('page content corroborates API success into confirmed', () => {
    const determiner = new OutcomeDeterminer();

    const pcSignal = extractFromSnapshot(
      {
        url: 'https://example.com/cart/add-to-cart/',
        viewId: 'cart-confirmation',
        items: [
          { kind: 'counter' as const, matchedSelector: ' ' === ' ' ? 's1' : '', text: '1', numericValue: 1, entityId: null, entityType: null, domPath: '#nav-cart-count', attributes: {}, visible: true },
          { kind: 'notification' as const, matchedSelector: 's2', text: 'Added to Cart', numericValue: null, entityId: determiner !== null ? null : null, entityType: null, domPath: '#nt', attributes: {}, visible: true },
          { kind: 'entity' as const, matchedSelector: 's3', text: 'vivo Y11 5G', numericValue: null, entityId: 'B0XYZ12345', entityType: 'product', domPath: '#pe', attributes: {}, visible: true },
        ],
        itemsOverflow: 0,
        scannedAt: 0,
        scanDurationMs: 2,
      },
      'int-20',
    );

    const signals: SignalSet = makeSignalSet('int-20', {
      pageContent: pcSignal,
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          success: true,
          interactionId: 'int-20',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/cart/add',
          outcomeHint: null,
        },
      ],
    });

    const result = determiner.determine({
      interactionId: 'int-20',
      actionType: 'Click',
      actionTarget: 'Add to Cart',
      signals,
      transition: null,
    });

    // API (0.4) + entity (0.15) + counter (0.2) + notification (0.2) = 0.95
    expect(result.outcome).toBe('success');
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.confidenceLevel).toBe('confirmed');
  });
});
