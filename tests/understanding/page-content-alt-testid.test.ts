/**
 * Defect 2a + Phase 2b — alternate test-ID conventions captured by the REAL
 * PageContentObserver + REAL DEFAULT_SEMANTIC_SELECTORS (jsdom).
 *
 * Pins (specs: defect1-2a-2c-replay-wait-alt-testid.md, phase-2b-verified-counter-locators.md):
 *  - data-auto-id / data-test-id / data-test counters are captured (2a)
 *  - data-auto-id collections are captured (2a)
 *  - [data-auto-id][data-sku]-co-occurrence entities captured w/ entityId (2a)
 *  - decorative-only data-auto-id is NOT an entity (noise guard)
 *  - data-testid conventions unchanged (a-slice replica regression pin)
 *  - Phase 2b: uniqueInSnapshot stamped true/false/undefined per DOM reality
 *  - Phase 2b: full pipeline — verified stamp consumed by the derivation
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { BrowserPageContentAdapter } from '../../src/tap/page-content-dom-adapter';
import { deriveStepAssertions } from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WireObservedItem } from '../../src/shared/page-content-wire';

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

describe('Phase 2b — observer-verified uniqueness stamping', () => {
  it('stamps uniqueInSnapshot=true when the allowlisted attr selector matches exactly one element', () => {
    const snap = scanHtml('<span data-auto-id="cart-count">3</span>');
    const counter = (snap?.items ?? []).find(
      (i) => i.kind === 'counter' && i.attributes['data-auto-id'] === 'cart-count',
    );
    expect(counter).toBeDefined();
    expect(counter!.uniqueInSnapshot).toBe(true);
  });

  it('stamps uniqueInSnapshot=false when the attr selector matches multiple elements', () => {
    const snap = scanHtml(
      '<span data-auto-id="cart-count">1</span><nav><span data-auto-id="cart-count">2</span></nav>',
    );
    const counters = (snap?.items ?? []).filter(
      (i) => i.kind === 'counter' && i.attributes['data-auto-id'] === 'cart-count',
    );
    // Both captured (different parents → different region paths)
    expect(counters.length).toBe(2);
    for (const c of counters) {
      expect(c.uniqueInSnapshot).toBe(false);
    }
  });

  it('stamps uniqueInSnapshot=undefined when no allowlisted attribute was captured', () => {
    // [data-testid*="cart-badge" i] entry captures but extracts only
    // aria-label — which is absent here → attributes empty → no candidate
    // → undefined stamp. (data-testid itself is NOT extracted.)
    const snap = scanHtml('<span data-testid="mini-cart-badge">4</span>');
    const counters = (snap?.items ?? []).filter((i) => i.kind === 'counter');
    expect(counters.length).toBe(1);
    expect(counters[0].uniqueInSnapshot).toBeUndefined();
  });

  it('sole allowlisted attribute that is unique → stamp true', () => {
    // [data-count] entry: aria-label absent, data-count="0" unique → true.
    const snap = scanHtml('<main id="app-root"><span data-count="0">0 items</span></main>');
    const stamped = (snap?.items ?? []).find(
      (i) => i.kind === 'counter' && i.attributes['data-count'] === '0',
    );
    expect(stamped).toBeDefined();
    expect(stamped!.uniqueInSnapshot).toBe(true);
  });

  it('conservative single-candidate rule: FIRST allowlisted attr shared elsewhere → stamp false (no fall-through)', () => {
    // The counter carries aria-label='Cart' (first in extractAttributes
    // order) AND data-count='0' (which IS unique). aria-label is shared
    // with the [role=status] div → [aria-label="Cart"] matches 2 elements
    // → stamp false. The verifier never falls through to data-count — the
    // derivation will pick aria-label too, so verifying a different attr
    // would desync. Conservative by design (pin).
    const snap = scanHtml(
      '<main id="app-root"><span data-count="0" aria-label="Cart">0 items</span></main>' +
        '<div aria-label="Cart" role="status">elsewhere</div>',
    );
    const stamped = (snap?.items ?? []).find(
      (i) => i.kind === 'counter' && i.attributes['data-count'] === '0',
    );
    expect(stamped).toBeDefined();
    expect(stamped!.uniqueInSnapshot).toBe(false);
  });

  it('entities and collections are never stamped (identity/collection kinds excluded)', () => {
    const snap = scanHtml(
      '<div id="cart-root"><div data-auto-id="cart-item-F1" data-sku="F1">Flight 1</div></div>' +
        '<ul data-auto-id="flight-results"><li>F1</li><li>F2</li></ul>',
    );
    const items = snap?.items ?? [];
    const entity = items.find((i) => i.kind === 'entity');
    const collection = items.find((i) => i.kind === 'collection');
    expect(entity).toBeDefined();
    expect(collection).toBeDefined();
    expect(entity!.uniqueInSnapshot).toBeUndefined();
    expect(collection!.uniqueInSnapshot).toBeUndefined();
  });

  it('full 2b pipeline: verified id-less counter derives its attribute locator (stamp consumed end-to-end)', () => {
    const snap = scanHtml('<span data-auto-id="cart-count">3</span>');
    const counter = (snap?.items ?? []).find((i) => i.kind === 'counter');
    expect(counter).toBeDefined();
    expect(counter!.uniqueInSnapshot).toBe(true);
    // Feed the SAME item through the derivation to prove the stamp is
    // consumed end-to-end (wire copy → decideLocator).
    const map = deriveStepAssertions([
      {
        triggerEvent: { eventId: 'evt-2b' },
        behavioralEvidence: {
          applicationEvidence: {
            resultingState: { ...snap!, items: [counter as unknown as WireObservedItem] },
          },
        },
      } as unknown as ComponentInteraction,
    ]);
    expect(map.get('evt-2b')?.[0]?.targetCss).toBe('[data-auto-id="cart-count"]');
  });
});
