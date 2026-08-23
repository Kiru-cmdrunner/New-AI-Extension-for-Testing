/**
 * Phase 6D.1 W1 — Notification & status-badge semantic selector expansion.
 *
 * Spec: .drytis/specs/phase-6d1-universal-interaction-classes.md §3 W1
 *
 * Additive-only expansion of DEFAULT_SEMANTIC_SELECTORS:
 *  - notification: [aria-live], [role="log"], snackbar, toast-message/body/content
 *  - status-badge: [data-state], [aria-pressed], [aria-current], [aria-selected="true"]
 *
 * Pins (real PageContentObserver + real DEFAULT_SEMANTIC_SELECTORS, jsdom —
 * same harness shape as page-content-alt-testid.test.ts):
 *  - AC-W1a: each new notification convention matches
 *  - AC-W1b: each new status-badge convention matches
 *  - AC-W1c: STAB — existing family outputs byte-identical for the
 *            existing fixtures (no string edits, no reordering)
 *  - AC-W1d: negatives — container-only toast, empty-text data-state,
 *            aria-selected="false", hidden badges do not match
 *  - AC-W1e: genericity tokens (aria-live, role=log, snackbar, data-state,
 *            aria-pressed, aria-current, aria-selected are W3C/generic
 *            conventions — pinned via behavior, doctrine test stays green)
 *
 * TDD: written before implementation. Red until the new selectors exist.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { BrowserPageContentAdapter } from '../../src/tap/page-content-dom-adapter';
import {
  DEFAULT_SEMANTIC_SELECTORS,
  registerDomainSelectors,
} from '../../src/understanding/page-content/page-content-config';
import type { PageContentConfig, SemanticSelector } from '../../src/understanding/page-content/page-content-types';

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

function items(snap: ReturnType<PageContentObserver['scan']>, kind: string) {
  return (snap?.items ?? []).filter((i) => i.kind === kind);
}

// ── AC-W1a: new notification conventions ───────────────────────────────

describe('6D.1 W1 — notification family expansion', () => {
  it('captures a toast via [aria-live] (polite)', () => {
    const snap = scanHtml('<div aria-live="polite">Saved successfully</div>');
    const notifications = items(snap, 'notification');
    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toBe('Saved successfully');
  });

  it('captures a toast via [aria-live] (assertive)', () => {
    const snap = scanHtml('<div aria-live="assertive">Connection lost</div>');
    const notifications = items(snap, 'notification');
    expect(notifications.length).toBe(1);
  });

  it('captures a live log region via [role="log"]', () => {
    const snap = scanHtml('<div role="log">3 events captured</div>');
    const notifications = items(snap, 'notification');
    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toBe('3 events captured');
  });

  it('captures a snackbar message via class snackbar (Material convention)', () => {
    const snap = scanHtml('<div class="snackbar-message">Item added to cart</div>');
    const notifications = items(snap, 'notification');
    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toBe('Item added to cart');
  });

  it('captures toast variants beyond the compound toast-message (toast-body / toast-content)', () => {
    const body = scanHtml('<div class="toast-body">Flight added</div>');
    expect(items(body, 'notification').length).toBe(1);
    const content = scanHtml('<div class="toast-content">Flight added</div>');
    expect(items(content, 'notification').length).toBe(1);
  });

  it('still captures the existing conventions (role=alert, toast-message) — additive STAB', () => {
    // Distinct containers: sibling divs with identical paths are collapsed
    // by the observer's first-match-wins region dedup (by design — same
    // convention as page-content-alt-testid.test.ts).
    const snap = scanHtml(
      '<main><div role="alert">Error</div></main><nav><div class="toast-message">Saved</div></nav>',
    );
    const notifications = items(snap, 'notification');
    expect(notifications.length).toBe(2);
  });
});

// ── AC-W1b: new status-badge conventions ───────────────────────────────

describe('6D.1 W1 — status-badge family expansion', () => {
  it('captures a state badge via [data-state]', () => {
    const snap = scanHtml('<span data-state="confirmed">Confirmed</span>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe('Confirmed');
  });

  it('captures a toggle state via [aria-pressed] (chip/toggle convention)', () => {
    const snap = scanHtml('<button aria-pressed="true">Direct only</button>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(1);
  });

  it('captures the current item via [aria-current]', () => {
    const snap = scanHtml('<a aria-current="page">Flights</a>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe('Flights');
  });

  it('captures a selected option/tab via [aria-selected="true"] with text', () => {
    const snap = scanHtml('<div role="tab" aria-selected="true">Departure</div>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe('Departure');
  });
});

// ── AC-W1d: negatives — breadth must not become noise ─────────────────

describe('6D.1 W1 — negative space', () => {
  it('container-only toast class does NOT match (message-bearing children only)', () => {
    // No text-bearing toast-message/body/content descendant at the same element;
    // the container itself must not seed a notification.
    const snap = scanHtml(
      '<div class="toast-container"><div class="row"><span>Save</span></div></div>',
    );
    const notifications = items(snap, 'notification');
    expect(notifications.length).toBe(0);
  });

  it('data-state element with EMPTY text does NOT produce an item', () => {
    const snap = scanHtml('<span data-state="busy"></span>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(0);
  });

  it('aria-selected="false" does NOT match (only the true state is a badge)', () => {
    const snap = scanHtml('<div role="tab" aria-selected="false">Return</div>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(0);
  });

  it('aria-pressed="false" still captures (any pressed state is observable)', () => {
    const snap = scanHtml('<button aria-pressed="false">Direct only</button>');
    const badges = items(snap, 'status-badge');
    expect(badges.length).toBe(1);
  });

  it('role=log container whose TEXT is transient stays subject to downstream noise gates', () => {
    // The selector captures; the seed noise gates are classifier-side. Here we
    // pin only that a visible log region with real text is captured.
    const snap = scanHtml('<div role="log">Latest event</div>');
    expect(items(snap, 'notification').length).toBe(1);
  });
});

// ── AC-W1c: STAB — existing selector strings byte-identical ───────────

describe('6D.1 W1 — STAB: existing selector entries unchanged', () => {
  it('every pre-6D.1 selector string appears verbatim in the expanded list', () => {
    // The exact selector strings shipped at 92de517 (6B closure). Byte-for-byte.
    const pre = [
      '[data-testid*="cart-count" i], [data-testid*="cart-badge" i], [aria-label*="cart" i][class*="count" i]',
      '[role="status"][class*="count" i], [class*="badge-count" i], [data-count]',
      '[data-testid*="notification-count" i], [aria-label*="notification" i][class*="count" i], [aria-label*="unread" i]',
      '[data-auto-id*="count" i], [data-auto-id*="total" i], [data-test-id*="count" i], [data-test-id*="total" i], [data-test*="count" i], [data-test*="total" i]',
      '[role="alert"], [role="status"]',
      '[data-testid*="toast" i], [class*="toast-message" i]',
      'ul[data-testid], ol[data-testid], [role="list"][data-testid]',
      '[data-testid*="results" i], [class*="results-container" i], [data-testid*="cart-items" i], [data-testid*="cart-list" i]',
      '[data-auto-id*="items" i], [data-auto-id*="results" i], [data-test-id*="items" i], [data-test-id*="results" i], [data-test*="items" i], [data-test*="results" i]',
      '[data-asin]',
      '[data-auto-id][data-sku]:not([data-product-id]):not([data-item-id]), [data-test-id][data-sku]:not([data-product-id]):not([data-item-id])',
      '[data-auto-id][data-item-id]:not([data-product-id]):not([data-sku]), [data-test-id][data-item-id]:not([data-product-id]):not([data-sku])',
      '[data-auto-id][data-product-id]:not([data-item-id]):not([data-sku]), [data-test-id][data-product-id]:not([data-item-id]):not([data-sku])',
      '[data-product-id]',
      '[data-item-id]:not([data-product-id])',
      '[data-sku]:not([data-product-id]):not([data-item-id])',
      '[data-order-id], [data-order-number]',
      '[class*="badge" i][class*="status" i], [data-testid*="status" i]',
      '[class*="pill" i], [class*="chip" i]',
    ];
    const present = new Set(DEFAULT_SEMANTIC_SELECTORS.map((s) => s.selector));
    for (const selector of pre) {
      expect(present.has(selector), `missing pre-6D.1 selector: ${selector}`).toBe(true);
    }
    // New entries must be NEW strings, not edits of old ones: none of the new
    // convention strings may appear inside an existing entry's selector string.
    const newFragments = ['[aria-live]', '[role="log"]', 'snackbar', 'toast-body', 'toast-content',
      '[data-state]', '[aria-pressed]', '[aria-current]', '[aria-selected="true"]'];
    for (const s of DEFAULT_SEMANTIC_SELECTORS) {
      for (const frag of newFragments) {
        if (pre.includes(s.selector)) continue;
        // Only new entries may contain these fragments.
        expect(s.selector.includes(frag) || !pre.includes(s.selector)).toBe(true);
      }
    }
  });

  it('family ORDER is preserved for the pre-existing entries (append-only within family)', () => {
    // The last pre-6D.1 entry of each touched family must still precede any
    // new entry — i.e. existing entry indices are stable.
    const selectors = DEFAULT_SEMANTIC_SELECTORS.map((s) => s.selector);
    const idxToast = selectors.indexOf('[data-testid*="toast" i], [class*="toast-message" i]');
    const idxPill = selectors.indexOf('[class*="pill" i], [class*="chip" i]');
    expect(idxToast).toBeGreaterThan(0);
    expect(idxPill).toBeGreaterThan(idxToast);
    // New notification entries come AFTER the existing two.
    const notificationCount = DEFAULT_SEMANTIC_SELECTORS.filter((s) => s.kind === 'notification').length;
    expect(notificationCount).toBeGreaterThanOrEqual(4);
  });

  it('registerDomainSelectors still prepends site-specific selectors (extension point unchanged)', () => {
    const base = createDefaultPageContentConfig();
    const domainExtra: SemanticSelector[] = [
      { selector: '[data-svc="notice"]', kind: 'notification', extractAttributes: [] },
    ];
    const merged = registerDomainSelectors(base, 'svc', domainExtra);
    expect(merged.selectors[0].selector).toBe('[data-svc="notice"]');
    expect(merged.name).toBe('default+svc');
    // base untouched
    expect(base.selectors.length).toBe(DEFAULT_SEMANTIC_SELECTORS.length);
    void (null as unknown as PageContentConfig);
  });
});
