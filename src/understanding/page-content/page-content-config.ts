/**
 * M9.4 - Page Content Config
 *
 * Configurable selector registry for semantic page-content scanning.
 * Selectors are generic web patterns - no site-specific hardcoding.
 *
 * Architecture: .drytis/specs/m9-4-page-content-observer.md
 */

import type { PageContentConfig, SemanticSelector } from './page-content-types';

/**
 * Default generic semantic selectors for e-commerce and general web apps.
 * These are common conventions, not site-specific hacks.
 */
export const DEFAULT_SEMANTIC_SELECTORS: SemanticSelector[] = [
  // -- Counters --
  {
    selector: '[data-testid*="cart-count" i], [data-testid*="cart-badge" i], [aria-label*="cart" i][class*="count" i]',
    kind: 'counter',
    extractNumeric: true,
    extractAttributes: ['aria-label'],
  },
  {
    selector: '[role="status"][class*="count" i], [class*="badge-count" i], [data-count]',
    kind: 'counter',
    extractNumeric: true,
    extractAttributes: ['aria-label', 'data-count'],
  },
  {
    selector: '[data-testid*="notification-count" i], [aria-label*="notification" i][class*="count" i], [aria-label*="unread" i]',
    kind: 'counter',
    extractNumeric: true,
    extractAttributes: ['aria-label'],
  },
  {
    // Alternate test-ID conventions (AdaniOne uses data-auto-id; data-test-id
    // and data-test are widespread). Same generic-substring class as the
    // data-testid entries above — conventions, not site hacks. "total" joins
    // "count" as counter semantics ("cart-total", "grand-total", …).
    selector:
      '[data-auto-id*="count" i], [data-auto-id*="total" i], [data-test-id*="count" i], [data-test-id*="total" i], [data-test*="count" i], [data-test*="total" i]',
    kind: 'counter',
    extractNumeric: true,
    extractAttributes: ['aria-label', 'data-auto-id', 'data-test-id', 'data-test'],
  },

  // -- Notifications --
  {
    selector: '[role="alert"], [role="status"]',
    kind: 'notification',
    extractAttributes: ['aria-label'],
  },
  {
    selector: '[data-testid*="toast" i], [class*="toast-message" i]',
    kind: 'notification',
    extractAttributes: ['aria-label', 'data-testid'],
  },
  {
    // 6D.1 W1: W3C live-region announcement channel (polite/assertive/off).
    // Structural convention, not a site token.
    selector: '[aria-live]',
    kind: 'notification',
    extractAttributes: ['aria-label'],
  },
  {
    // 6D.1 W1: W3C live log region (append-only feeds/logs).
    selector: '[role="log"]',
    kind: 'notification',
    extractAttributes: ['aria-label'],
  },
  {
    // 6D.1 W1: Material snackbar convention. Matched on the message-bearing
    // class token (not the container) — snackbar-* naming carries the text.
    selector: '[class*="snackbar" i]:not([class*="snackbar-container" i])',
    kind: 'notification',
    extractAttributes: ['aria-label'],
  },
  {
    // 6D.1 W1: toast message-bearing variants beyond the compound
    // toast-message above. Container-only classes (toast, toast-holder,
    // toast-container) intentionally stay UNMATCHED — breadth without noise.
    selector: '[class*="toast-body" i], [class*="toast-content" i]',
    kind: 'notification',
    extractAttributes: ['aria-label'],
  },

  // -- Collections --
  {
    selector: 'ul[data-testid], ol[data-testid], [role="list"][data-testid]',
    kind: 'collection',
    extractNumeric: true,
  },
  {
    selector: '[data-testid*="results" i], [class*="results-container" i], [data-testid*="cart-items" i], [data-testid*="cart-list" i]',
    kind: 'collection',
    extractNumeric: true,
  },
  {
    // Alternate test-ID conventions (data-auto-id / data-test-id / data-test).
    selector: '[data-auto-id*="items" i], [data-auto-id*="results" i], [data-test-id*="items" i], [data-test-id*="results" i], [data-test*="items" i], [data-test*="results" i]',
    kind: 'collection',
    extractNumeric: true,
    extractAttributes: ['data-auto-id', 'data-test-id', 'data-test'],
  },

  // -- Entities --
  {
    selector: '[data-asin]',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-asin',
    extractAttributes: ['data-asin', 'aria-label'],
  },
  {
    // Alternate test-ID conventions — only when a value-bearing identity
    // attribute co-occurs, so decorative data-auto-id attrs are NOT
    // classified as entities (noise guard, mirrors the data-asin pattern).
    // G2 generic fix (2026-08-20): each co-occurrence variant now demands
    // its OWN identity attribute (was: idAttribute always data-sku, so
    // [data-auto-id][data-item-id] rows captured entityId:null). Order:
    // these run BEFORE the generic single-attribute entries below, so
    // co-occurrence elements keep their richer attribute capture and
    // byte-identical prior output.
    selector: '[data-auto-id][data-sku]:not([data-product-id]):not([data-item-id]), [data-test-id][data-sku]:not([data-product-id]):not([data-item-id])',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-sku',
    extractAttributes: ['data-sku', 'data-item-id', 'data-product-id', 'data-auto-id', 'data-test-id'],
  },
  {
    selector: '[data-auto-id][data-item-id]:not([data-product-id]):not([data-sku]), [data-test-id][data-item-id]:not([data-product-id]):not([data-sku])',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-item-id',
    extractAttributes: ['data-item-id', 'data-sku', 'data-product-id', 'data-auto-id', 'data-test-id'],
  },
  {
    selector: '[data-auto-id][data-product-id]:not([data-item-id]):not([data-sku]), [data-test-id][data-product-id]:not([data-item-id]):not([data-sku])',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-product-id',
    extractAttributes: ['data-product-id', 'data-item-id', 'data-sku', 'data-auto-id', 'data-test-id'],
  },
  {
    // Generic single-attribute entries: each identity attribute demands
    // itself, so data-sku-only and data-item-id-only elements derive
    // entityId + [data-sku="X"] / [data-item-id="X"] presence assertions
    // (G2: the previous merged entry trusted only data-product-id, so rows
    // carrying just data-sku or data-item-id were captured with
    // entityId:null and conservatively skipped by the entity assertion
    // branch — Defect 2c's safe behavior). The :not() guards enforce
    // product-id > item-id > sku identity precedence with no overlap.
    selector: '[data-product-id]',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-product-id',
    extractAttributes: ['data-product-id', 'data-item-id', 'data-sku'],
  },
  {
    selector: '[data-item-id]:not([data-product-id])',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-item-id',
    extractAttributes: ['data-item-id', 'data-sku'],
  },
  {
    selector: '[data-sku]:not([data-product-id]):not([data-item-id])',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-sku',
    extractAttributes: ['data-sku'],
  },
  {
    selector: '[data-order-id], [data-order-number]',
    kind: 'entity',
    entityType: 'order',
    idAttribute: 'data-order-id',
    extractAttributes: ['data-order-id', 'data-order-number'],
  },

  // -- Status badges --
  {
    selector: '[class*="badge" i][class*="status" i], [data-testid*="status" i]',
    kind: 'status-badge',
    extractAttributes: ['aria-label', 'data-testid'],
  },
  {
    selector: '[class*="pill" i], [class*="chip" i]',
    kind: 'status-badge',
    extractAttributes: ['aria-label'],
  },
  {
    // 6D.1 W1: generic state-attribute convention (Vue/Alpine/htmx data-state;
    // the shape the audit app uses for its idle→planned state badge).
    selector: '[data-state]',
    kind: 'status-badge',
    extractAttributes: ['data-state', 'aria-label'],
  },
  {
    // 6D.1 W1: ARIA state-attribute conventions — pressed toggles, current
    // nav items, selected tabs/options. The STATE is the observable fact;
    // text-bearing requirement is enforced by the observer scan gates
    // (MIN_TEXT_LENGTH), so empty state holders stay unmatched.
    selector: '[aria-pressed], [aria-current], [aria-selected="true"]',
    kind: 'status-badge',
    extractAttributes: ['aria-label'],
  },
];

/**
 * Built-in default config.
 */
export function createDefaultPageContentConfig(): PageContentConfig {
  return {
    name: 'default',
    selectors: [...DEFAULT_SEMANTIC_SELECTORS],
  };
}

/**
 * Contribute site-specific selectors on top of the default config.
 * Site-specific selectors run BEFORE the defaults (first match wins per element).
 */
export function registerDomainSelectors(
  base: PageContentConfig,
  name: string,
  extraSelectors: SemanticSelector[],
): PageContentConfig {
  return {
    name: base.name + '+' + name,
    selectors: [...extraSelectors, ...base.selectors],
  };
}
