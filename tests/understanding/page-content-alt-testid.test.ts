/**
 * Defect 2a — alternate test-ID conventions captured by the REAL
 * PageContentObserver + REAL DEFAULT_SEMANTIC_SELECTORS (jsdom).
 *
 * Pins (spec .drytis/specs/defect1-2a-2c-replay-wait-alt-testid.md):
 *  - data-auto-id / data-test-id / data-test counters are captured (2a)
 *  - data-auto-id collections are captured (2a)
 *  - [data-auto-id][data-sku]-co-occurrence entities captured w/ entityId (2a)
 *  - decorative-only data-auto-id is NOT an entity (noise guard)
 *  - data-testid conventions unchanged (a-slice replica regression pin)
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { BrowserPageContentAdapter } from '../../src/tap/page-content-dom-adapter';

function scanHtml(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { pretendToBeVisual: true });
  (globalThis as Record<string, unknown>).window = dom.window;
  (globalThis as Record<string, unknown>).document = dom.window.document;
  const observer = new PageContentObserver(
    createDefaultPageContentConfig(),
    new BrowserPageContentAdapter(dom.window.document),
  );
  return observer.scan('test');
}

describe('Defect 2a — alternate test-ID semantic capture', () => {
  it('captures data-auto-id counters (id-less span)', () => {
    const snap = scanHtml('<span data-auto-id="cart-count">3</span>');
    const counters = (snap?.items ?? []).filter((i) => i.kind === 'counter');
    expect(counters.length).toBe(1);
    expect(counters[0].numericValue).toBe(3);
    expect(counters[0].attributes['data-auto-id']).toBe('cart-count');
  });

  it('captures data-auto-id total counters (cart-total / grand-total)', () => {
    const snap = scanHtml(
      '<div class="total">Total items: <span data-auto-id="cart-total">3</span></div>',
    );
    const totals = (snap?.items ?? []).filter(
      (i) => i.kind === 'counter' && i.attributes['data-auto-id'] === 'cart-total',
    );
    expect(totals.length).toBe(1);
    expect(totals[0].numericValue).toBe(3);
  });

  it('captures data-test-id and data-test counter variants', () => {
    // Distinct parents: sibling spans with identical paths are collapsed by
    // the observer's first-match-wins region dedup (by design).
    const snap = scanHtml(
      '<div><span data-test-id="cart-count">2</span></div>' +
        '<nav><span data-test="cart-count">5</span></nav>',
    );
    const counters = (snap?.items ?? []).filter(
      (i) => i.attributes['data-test-id'] === 'cart-count' || i.attributes['data-test'] === 'cart-count',
    );
    expect(counters.length).toBe(2);
  });

  it('captures data-auto-id collections', () => {
    const snap = scanHtml(
      '<ul data-auto-id="flight-results"><li>F1</li><li>F2</li><li>F3</li></ul>',
    );
    const collections = (snap?.items ?? []).filter(
      (i) => i.kind === 'collection' && i.attributes['data-auto-id'] === 'flight-results',
    );
    expect(collections.length).toBe(1);
    expect(collections[0].numericValue).toBe(3);
  });

  it('captures entities via data-auto-id + data-sku co-occurrence — identity-bearing item present', () => {
    const snap = scanHtml(
      '<div id="cart-root"><div data-auto-id="cart-item-F1" data-sku="F1">Flight 1</div></div>',
    );
    const entities = (snap?.items ?? []).filter((i) => i.kind === 'entity');
    // The row ALSO matches the legacy [data-sku] entry (entityId null) — the
    // observer keeps both (capture stays lossy-free); derivation collapses
    // them (dedupeEntities, pinned in assertion-derivation-alt-testid.test.ts).
    // Capture-level pin: an identity-bearing entity item EXISTS.
    const identified = entities.filter((i) => i.entityId === 'F1');
    expect(identified.length).toBe(1);
    expect(identified[0].entityType).toBe('product');
    // …and the legacy twin exists with a NULL entityId (documents the
    // double-capture that derivation-side dedup must handle).
    const legacy = entities.filter((i) => i.entityId === null && i.attributes['data-sku'] === 'F1');
    expect(legacy.length).toBe(1);
  });

  it('does NOT classify decorative-only data-auto-id as entity (noise guard)', () => {
    const snap = scanHtml(
      '<div data-auto-id="svc-flight-booking">Flight booking</div><span data-auto-id="qty-F1">2</span>',
    );
    const entities = (snap?.items ?? []).filter((i) => i.kind === 'entity');
    expect(entities.length).toBe(0);
  });

  it('a-slice replica conventions unchanged: data-testid + data-count + id-based capture identical', () => {
    // Mirrors .drytis/notes/evidence/a-slice-fixes/harness.mjs replica DOM
    const snap = scanHtml(
      '<main id="app-root">' +
        '<ul id="results" data-testid="source-results"></ul>' +
        '<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart">0 items</span></p>' +
        '<ul id="cart-items" data-testid="cart-items"></ul>' +
        '</main>',
    );
    const items = snap?.items ?? [];
    // cart-count counter via [data-count], domPath carries its OWN #id
    const cartCount = items.find(
      (i) => i.kind === 'counter' && i.domPath.includes('span#cart-count'),
    );
    expect(cartCount).toBeDefined();
    expect(cartCount!.numericValue).toBe(0);
    // source-results + cart-items collections via data-testid
    const collections = items.filter((i) => i.kind === 'collection');
    expect(collections.length).toBe(2);
    const paths = collections.map((c) => c.domPath);
    expect(paths).toContain('body > main#app-root > ul#results');
    expect(paths).toContain('body > main#app-root > ul#cart-items');
  });
});
