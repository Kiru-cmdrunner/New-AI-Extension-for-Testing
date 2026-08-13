/**
 * M9.7 — Domain Signatures
 *
 * Built-in domain signatures for deterministic classification.
 * Each signature defines weighted patterns across view IDs,
 * entity types, API operations, and notification keywords.
 *
 * Extensible via registerDomainSignature().
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { DomainType } from './semantic-types';

// ── Signature Definition ───────────────────────────────────────────────

export interface DomainSignature {
  /** Domain identifier. */
  domain: DomainType;
  /** View IDs and their weights. */
  viewWeights: Record<string, number>;
  /** Entity types and their weights. */
  entityWeights: Record<string, number>;
  /** API operations and their weights. */
  apiOperationWeights: Record<string, number>;
  /** Notification keywords and their weights. */
  notificationKeywords: Record<string, number>;
  /** URL path fragments and their weights. */
  urlFragments: Record<string, number>;
}

// ── Built-in signatures ────────────────────────────────────────────────

export const ECOMMERCE_SIGNATURE: DomainSignature = {
  domain: 'e-commerce',
  viewWeights: {
    'cart': 2,
    'cart-confirmation': 3,
    'checkout': 3,
    'product-detail': 3,
    'search-results': 2,
    'wishlist': 2,
    'orders': 2,
  },
  entityWeights: {
    'product': 3,
    'cart-item': 3,
    'order': 2,
    'search-query': 1,
  },
  apiOperationWeights: {
    'add-to-cart': 3,
    'remove-from-cart': 2,
    'update-cart': 2,
    'checkout': 3,
    'search': 1,
    'search-autocomplete': 1,
  },
  notificationKeywords: {
    'cart': 2,
    'order': 2,
    'purchase': 2,
    'checkout': 2,
    'shipped': 2,
    'delivered': 2,
    'refund': 2,
    'discount': 1,
    'coupon': 1,
  },
  urlFragments: {
    '/cart': 2,
    '/checkout': 3,
    '/product': 2,
    '/shop': 1,
    '/wishlist': 2,
    '/orders': 2,
  },
};

export const AUTHENTICATION_SIGNATURE: DomainSignature = {
  domain: 'authentication',
  viewWeights: {
    'login': 3,
    'register': 3,
    'account': 1,
  },
  entityWeights: {
    'user': 2,
  },
  apiOperationWeights: {
    'login': 3,
    'logout': 2,
    'register': 3,
  },
  notificationKeywords: {
    'sign in': 2,
    'sign out': 2,
    'log in': 2,
    'log out': 2,
    'password': 2,
    'welcome': 1,
    'account': 1,
    'verif': 1,
  },
  urlFragments: {
    '/login': 3,
    '/signin': 3,
    '/signup': 2,
    '/register': 3,
    '/auth': 2,
    '/account': 1,
  },
};

export const ADMIN_CRM_SIGNATURE: DomainSignature = {
  domain: 'admin-crm',
  viewWeights: {
    'account': 1,
    'orders': 1,
  },
  entityWeights: {
    'user': 2,
    'order': 1,
    'filter': 1,
  },
  apiOperationWeights: {
    'submit-form': 1,
    'search': 1,
  },
  notificationKeywords: {
    'saved': 1,
    'created': 1,
    'updated': 1,
    'deleted': 1,
    'approved': 1,
    'rejected': 1,
    'assigned': 1,
  },
  urlFragments: {
    '/admin': 3,
    '/dashboard': 2,
    '/crm': 3,
    '/manage': 2,
    '/users': 2,
    '/reports': 1,
  },
};

export const CONTENT_SIGNATURE: DomainSignature = {
  domain: 'content',
  viewWeights: {
    'home': 1,
    'search-results': 1,
  },
  entityWeights: {
    'search-query': 2,
    'page-content': 1,
  },
  apiOperationWeights: {
    'search': 2,
    'resource': 1,
  },
  notificationKeywords: {
    'published': 2,
    'article': 2,
    'post': 2,
    'comment': 2,
    'subscribe': 1,
  },
  urlFragments: {
    '/blog': 3,
    '/news': 2,
    '/article': 2,
    '/post': 2,
    '/content': 2,
  },
};

// ── Registry ───────────────────────────────────────────────────────────

const registry: DomainSignature[] = [
  ECOMMERCE_SIGNATURE,
  AUTHENTICATION_SIGNATURE,
  ADMIN_CRM_SIGNATURE,
  CONTENT_SIGNATURE,
];

/**
 * Register a custom domain signature. Pure additive — existing
 * signatures are untouched.
 */
export function registerDomainSignature(signature: DomainSignature): void {
  // Replace if same domain already registered
  const idx = registry.findIndex((s) => s.domain === signature.domain);
  if (idx >= 0) {
    registry[idx] = signature;
  } else {
    registry.push(signature);
  }
}

/**
 * Get all registered signatures.
 */
export function getDomainSignatures(): DomainSignature[] {
  return [...registry];
}

/**
 * Reset to built-in signatures (test helper).
 */
export function resetDomainSignatures(): void {
  registry.length = 0;
  registry.push(
    ECOMMERCE_SIGNATURE,
    AUTHENTICATION_SIGNATURE,
    ADMIN_CRM_SIGNATURE,
    CONTENT_SIGNATURE,
  );
}
