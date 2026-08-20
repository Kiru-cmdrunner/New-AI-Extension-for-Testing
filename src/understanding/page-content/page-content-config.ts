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
    selector: '[data-product-id], [data-item-id], [data-sku]',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-product-id',
    extractAttributes: ['data-product-id', 'data-item-id', 'data-sku'],
  },
  {
    selector: '[data-order-id], [data-order-number]',
    kind: 'entity',
    entityType: 'order',
    idAttribute: 'data-order-id',
    extractAttributes: ['data-order-id', 'data-order-number'],
  },
  {
    // Alternate test-ID conventions — only when a value-bearing identity
    // attribute co-occurs, so decorative data-auto-id attrs are NOT
    // classified as entities (noise guard, mirrors the data-asin pattern).
    selector: '[data-auto-id][data-sku], [data-auto-id][data-item-id], [data-auto-id][data-product-id], [data-test-id][data-sku], [data-test-id][data-item-id], [data-test-id][data-product-id]',
    kind: 'entity',
    entityType: 'product',
    idAttribute: 'data-sku',
    extractAttributes: ['data-sku', 'data-item-id', 'data-product-id', 'data-auto-id', 'data-test-id'],
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
