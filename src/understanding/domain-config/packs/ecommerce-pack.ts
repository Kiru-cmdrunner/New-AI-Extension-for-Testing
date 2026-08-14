/**
 * M9.11 — E-commerce Domain Pack
 *
 * Extracted from M9.1-M9.10 default patterns. This is reference data —
 * NOT auto-installed. The existing hard-coded defaults continue to work
 * for backward compatibility. This pack exists so consumers can install
 * the e-commerce configuration explicitly via the domain-config registry.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { DomainPack } from '../domain-pack-types';

export const ECOMMERCE_PACK: DomainPack = {
  id: 'ecommerce',
  label: 'E-commerce',
  domainType: 'e-commerce',

  // Signatures are in domain-signatures.ts already (ECOMMERCE_SIGNATURE).
  // We reference them by not duplicating — the classifier already reads
  // from the existing registry.

  stateVocabulary: [
    { keywords: ['active', 'enabled'], canonical: 'active' },
    { keywords: ['inactive', 'disabled'], canonical: 'inactive' },
    { keywords: ['expired'], canonical: 'expired' },
    { keywords: ['refunded'], canonical: 'refunded' },
    { keywords: ['shipped'], canonical: 'shipped' },
    { keywords: ['delivered'], canonical: 'delivered' },
    { keywords: ['returned'], canonical: 'returned' },
    { keywords: ['pending'], canonical: 'pending' },
    { keywords: ['cancelled', 'canceled'], canonical: 'cancelled' },
    { keywords: ['confirmed'], canonical: 'confirmed' },
    { keywords: ['completed', 'complete', 'done'], canonical: 'completed' },
  ],

  viewPatterns: [
    { pattern: '/cart', label: 'Cart', viewId: 'cart' },
    { pattern: '/checkout', label: 'Checkout', viewId: 'checkout' },
    { pattern: '/dp/[A-Z0-9]', label: 'Product Detail', viewId: 'product-detail' },
    { pattern: '/gp/product', label: 'Product Detail', viewId: 'product-detail' },
    { pattern: '/s?', label: 'Search Results', viewId: 'search-results' },
    { pattern: '/s/ref=', label: 'Search Results', viewId: 'search-results' },
    { pattern: '/orders', label: 'Orders', viewId: 'orders' },
    { pattern: '/wishlist', label: 'Wishlist', viewId: 'wishlist' },
    { pattern: '/account', label: 'Account', viewId: 'account' },
    { pattern: '/profile', label: 'Profile', viewId: 'account' },
    { pattern: '/dashboard', label: 'Dashboard', viewId: 'dashboard' },
    { pattern: '/login', label: 'Login', viewId: 'login' },
    { pattern: '/register', label: 'Register', viewId: 'register' },
  ],

  networkPatterns: [
    { operation: 'add-to-cart', pattern: '/cart/add' },
    { operation: 'add-to-cart', pattern: '/cart.*add' },
    { operation: 'add-to-cart', pattern: '/addToCart' },
    { operation: 'remove-from-cart', pattern: '/cart.*remove' },
    { operation: 'update-cart', pattern: '/cart.*update' },
    { operation: 'checkout', pattern: '/checkout' },
    { operation: 'checkout', pattern: '/payment' },
  ],

  confirmationViews: [
    'cart-confirmation',
    'order-confirmation',
    'checkout-confirmation',
    'payment-confirmation',
  ],

  // Entity types for e-commerce are handled by the StateBuilder's legacy
  // code path. Adding them here allows the registry to resolve them too.
  entityTypes: [],

  // Page-content selectors for e-commerce already in DEFAULT_SEMANTIC_SELECTORS.
  pageContentSelectors: [],

  // Intent vocabulary already in ECOMMERCE_INTENT_VOCABULARY.
  intentVocabulary: [],
};
