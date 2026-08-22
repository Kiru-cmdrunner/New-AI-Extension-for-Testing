/**
 * Phase 6A — Seeded scan() integration (observer + structural resolution)
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §2.3
 *
 * Pins the observer's NEW seeded scan path with the REAL structural resolver:
 *  - scan(viewId, seeds?) — selector pass FIRST, byte-identical; seed pass
 *    second, only for paths the selector pass did not cover.
 *  - resolvePath via DOMAdapter (production adapter) — structural segment
 *    walk over children; NO querySelector(pattern) matching.
 *  - Content anchoring for characterData seeds (picks the changed sibling).
 *  - Dedup vs selector items by the observer's own rules.
 *  - Mock adapters without resolvePath keep today's behavior exactly.
 *
 * TDD: written before implementation. Red until scan() accepts seeds and the
 * adapter gains resolvePath. No product code here.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { BrowserPageContentAdapter } from '../../src/tap/page-content-dom-adapter';
import type { DomChangeSummary } from '../../src/shared/behavioral-evidence-types';

function setup(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
  });
  (globalThis as Record<string, unknown>).window = dom.window;
  (globalThis as Record<string, unknown>).document = dom.window.document;
  const adapter = new BrowserPageContentAdapter(dom.window.document);
  const observer = new PageContentObserver(createDefaultPageContentConfig(), adapter);
  return { dom, adapter, observer };
}

function summary(overrides: Partial<DomChangeSummary> = {}): DomChangeSummary {
  return {
    types: ['characterData'],
    targetPath: 'body > div#counter',
    targetTag: 'DIV',
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: { old: '0', new: '5' },
    firstMutationAt: 10,
    lastMutationAt: 20,
    rawMutationCount: 1,
    firstBatchIndex: 1,
    lastBatchIndex: 1,
    ...overrides,
  };
}

const SEED = 'changed-element-seed';

// ── P1: selector-independent counter ──────────────────────

describe('seeded scan — P1 selector-independent counter', () => {
  it('seeds a counter item for a #id element with numeric characterData and NO selector match', () => {
    const { observer } = setup('<div id="counter">5</div>');
    const snap = observer.scan(null, [
      summary({ targetPath: 'body > div#counter', characterDataDelta: { old: '0', new: '5' } }),
    ]);
    expect(snap).not.toBeNull();
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters).toHaveLength(1);
    expect(counters[0].numericValue).toBe(5);
    expect(counters[0].matchedSelector).toBe(SEED);
    expect(counters[0].domPath).toBe('body > div#counter');
  });

  it('NO seed → NO item: the same DOM alone (selector-only scan) still derives nothing', () => {
    const { observer } = setup('<div id="counter">5</div>');
    const snap = observer.scan(null);
    expect(snap).toBeNull();
  });

  it('P3: counter without data-count, without aria-label, without testids — numeric characterData alone', () => {
    const { observer } = setup('<span id="pax-count">2</span>');
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > span#pax-count',
        targetTag: 'SPAN',
        characterDataDelta: { old: '1', new: '2' },
      }),
    ]);
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters).toHaveLength(1);
    expect(counters[0].numericValue).toBe(2);
  });

  it('seeded item carries the uniqueInSnapshot stamp when the element is uniquely addressable', () => {
    const { observer } = setup('<div id="counter">5</div>');
    const snap = observer.scan(null, [summary({ targetPath: 'body > div#counter' })]);
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters).toHaveLength(1);
    expect(counters[0].uniqueInSnapshot).toBe(true);
  });
});

// ── P4: content-anchored resolution among ambiguous siblings ──

describe('seeded scan — P4 aria-label-only / content anchoring', () => {
  it('picks the CHANGED sibling among structurally identical ones (content anchor)', () => {
    const { observer } = setup(
      '<ul id="cells">' +
        '<li aria-label="departure date">Sat, 22 Aug</li>' +
        '<li aria-label="return date">Sat, 29 Aug</li>' +
        '</ul>',
    );
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > ul#cells > li',
        targetTag: 'LI',
        characterDataDelta: { old: 'Sat, 15 Aug', new: 'Sat, 22 Aug' },
      }),
    ]);
    const items = snap!.items.filter((i) => i.kind === 'status-badge');
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Sat, 22 Aug');
    expect(items[0].attributes['aria-label']).toBe('departure date');
  });

  it('drops the seed when no candidate matches the content anchor', () => {
    const { observer } = setup(
      '<ul id="cells"><li aria-label="departure date">Sat, 22 Aug</li></ul>',
    );
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > ul#cells > li',
        targetTag: 'LI',
        characterDataDelta: { old: null, new: 'Fri, 31 Jul' },
      }),
    ]);
    // Honest skip: the delta's new text is nowhere → no item. With zero
    // items the snapshot itself is null (existing scan contract).
    expect(snap === null || snap.items.length === 0).toBe(true);
  });
});

// ── P4b: resolveViaChildren — bounded child walk (§6a fold) ──

describe('seeded scan — childList additions on a non-list parent (child walk)', () => {
  it('collection item lands on the parent; identity children seed as entities', () => {
    // A <ul> appended to <body>: the childList summary targets the PARENT
    // (body), the added <li data-sku> children carry entity semantics.
    const html =
      '<ul>' +
      '<li data-sku="SKU-A">Item A</li>' +
      '<li data-sku="SKU-B">Item B</li>' +
      '</ul>';
    const { observer } = setup(html);
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body',
        targetTag: 'BODY',
        types: ['childList'],
        addedNodesCount: 1,
        removedNodesCount: 0,
        characterDataDelta: null,
      }),
    ]);
    expect(snap).not.toBeNull();
    // Collection lands ON THE ADDED LIST (body > ul), not on body — its
    // own children are the members (extractCollectionCount semantics).
    const collections = snap!.items.filter((i) => i.kind === 'collection');
    expect(collections).toHaveLength(1);
    expect(collections[0].matchedSelector).toBe('changed-element-seed');
    expect(collections[0].domPath).toBe('body > ul');
    expect(collections[0].numericValue).toBe(2);
    // Identity children seed as entities (the selector pass already
    // captured them by [data-sku] — dedup keeps one item per path; the
    // pin asserts the entities ARE present, whether selector- or
    // seed-sourced).
    const entities = snap!.items.filter((i) => i.kind === 'entity');
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.entityId).sort()).toEqual(['SKU-A', 'SKU-B']);
  });

  it('child walk is bounded: >8 children → at most 8 SEED items, cap holds', () => {
    const items = Array.from({ length: 12 }, (_, i) => `<li data-sku="SKU-${i}">item ${i}</li>`).join('');
    const { observer } = setup(`<ul>${items}</ul>`);
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body',
        targetTag: 'BODY',
        types: ['childList'],
        addedNodesCount: 1,
        removedNodesCount: 0,
        characterDataDelta: null,
      }),
    ]);
    // The SELECTOR pass independently matches all 12 [data-sku] items (its
    // own cap is MAX_ITEMS 50) — the bound under test is the seed walk's:
    // at most MAX_SEED_CHILDREN seed-sentinel items may be emitted.
    const seedItems = snap!.items.filter((i) => i.matchedSelector === 'changed-element-seed');
    expect(seedItems.length).toBeLessThanOrEqual(9); // 1 collection + ≤8 entities
    const seedEntities = seedItems.filter((i) => i.kind === 'entity');
    expect(seedEntities.length).toBeLessThanOrEqual(8);
  });

  it('children without identity attributes seed only the parent collection', () => {
    const { observer } = setup('<ul><li>plain row</li><li>plain row</li></ul>');
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body',
        targetTag: 'BODY',
        types: ['childList'],
        addedNodesCount: 1,
        removedNodesCount: 0,
        characterDataDelta: null,
      }),
    ]);
    expect(snap!.items.filter((i) => i.kind === 'collection')).toHaveLength(1);
    expect(snap!.items.filter((i) => i.kind === 'entity')).toHaveLength(0);
  });
  it('aria-label-only element seeds via verified-attr tier — no class chain, no synthesized nth', () => {
    // Two badges, no ids, no testids — only distinct aria-labels. The scan
    // runs at CONSEQUENCE SETTLEMENT: the changed element already shows its
    // post-change text (the delta's new value IS the live text).
    const { observer } = setup(
      '<div><span aria-label="outbound fare">₹ 8,200</span></div>' +
        '<div><span aria-label="refund status">Refunded</span></div>',
    );
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > div > span',
        targetTag: 'SPAN',
        characterDataDelta: { old: 'Pending', new: 'Refunded' },
      }),
    ]);
    const items = snap!.items.filter((i) => i.kind === 'status-badge');
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Refunded');
    expect(items[0].attributes['aria-label']).toBe('refund status');
    // uniqueInSnapshot verification uses [aria-label="refund status"] — one
    // element on the page carries it.
    expect(items[0].uniqueInSnapshot).toBe(true);
  });
});

// ── Dedup vs selector pass ────────────────────────────────

describe('seeded scan — selector-first ordering and dedup', () => {
  it('selector-matched elements are NOT double-captured (seed dedups against selector items)', () => {
    // data-auto-id*="count" IS a selector-family match. Its selector-pass
    // domPath is 'body > span'. A seed for the same path must not add a twin.
    const { observer } = setup('<span data-auto-id="cart-count">3</span>');
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > span',
        targetTag: 'SPAN',
        characterDataDelta: { old: '2', new: '3' },
      }),
    ]);
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters).toHaveLength(1);
    expect(counters[0].matchedSelector).not.toBe(SEED);
  });

  it('selector pass output is byte-identical whether seeds are present or absent', () => {
    const a = setup('<span data-auto-id="cart-count">3</span>');
    const snapA = a.observer.scan(null);
    const b = setup('<span data-auto-id="cart-count">3</span>');
    const snapB = b.observer.scan(null, [
      summary({
        targetPath: 'body > span',
        targetTag: 'SPAN',
        characterDataDelta: { old: '2', new: '3' },
      }),
    ]);
    expect(snapA!.items).toEqual(
      snapB!.items.filter((i) => i.matchedSelector !== SEED),
    );
    expect(snapB!.items.filter((i) => i.matchedSelector === SEED)).toHaveLength(0);
  });

  it('mock adapter without resolvePath: seeded pass silently skips — legacy harnesses unaffected', () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="counter">5</div></body></html>', {
      pretendToBeVisual: true,
    });
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).document = dom.window.document;
    class NoResolveAdapter {
      querySelectorAll(): unknown[] {
        return [];
      }
      querySelector(): unknown {
        return null;
      }
      get url() {
        return 'https://example.test';
      }
    }
    const observer = new PageContentObserver(
      createDefaultPageContentConfig(),
      new NoResolveAdapter() as never,
    );
    const snap = observer.scan(null, [summary({ targetPath: 'body > div#counter' })]);
    // No crash, and no items: mock adapters without resolvePath keep today's
    // behavior EXACTLY (null snapshot when the selector pass finds nothing).
    expect(snap).toBeNull();
  });
});

// ── Bounds ────────────────────────────────────────────────

describe('seeded scan — bounds', () => {
  it('seeds respect the shared 50-item cap and overflow accounting', () => {
    // Two cap layers, one pin: the selector pass fills the 50-item cap
    // (48 status regions), then seeds must honor the SAME cap — only 2 fit,
    // the remaining 8 are counted in itemsOverflow.
    const html =
      Array.from({ length: 48 }, (_, i) => `<div role="status" id="s${i}">status ${i}</div>`).join('') +
      Array.from({ length: 10 }, (_, i) => `<span id="c${i}">${i}</span>`).join('');
    const { observer } = setup(html);
    const seeds = Array.from({ length: 10 }, (_, i) =>
      summary({
        targetPath: `body > span#c${i}`,
        characterDataDelta: { old: String(i + 1), new: String(i) },
        firstBatchIndex: i,
        lastBatchIndex: i,
      }),
    );
    const snap = observer.scan(null, seeds);
    // Cap holds across BOTH passes: 48 selector + 2 seeded.
    expect(snap!.items.length).toBe(50);
    expect(snap!.itemsOverflow).toBe(8);
    // And the two seeded items are genuinely seed-sourced (sentinel marker).
    const seedItems = snap!.items.filter((i) => i.matchedSelector === 'changed-element-seed');
    expect(seedItems).toHaveLength(2);
  });
});
