/**
 * View Registry — configurable URL→view pattern matching.
 *
 * Ships with a default e-commerce/general-web pattern set. Patterns are
 * tested in order — first match wins. Unknown URLs produce no view signal.
 *
 * M9.1: Used by NavigationSignalExtractor to identify views from URLs.
 */

import type { ViewPattern, ViewDescriptor } from '../types';

/**
 * A registry of URL patterns that classify pages into semantic views.
 */
export class ViewRegistry {
  private patterns: ViewPattern[] = [];

  constructor(patterns: ViewPattern[] = []) {
    this.patterns = [...patterns];
  }

  /**
   * Add a pattern to the registry. Patterns are tested in insertion order.
   */
  add(pattern: ViewPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Add multiple patterns.
   */
  addAll(patterns: ViewPattern[]): void {
    for (const p of patterns) this.patterns.push(p);
  }

  /**
   * Match a URL against registered patterns.
   * Returns the first matching ViewDescriptor, or null if no match.
   */
  match(url: string): ViewDescriptor | null {
    for (const p of this.patterns) {
      const regex = new RegExp(p.pattern);
      if (regex.test(url)) {
        return {
          id: p.viewId,
          label: p.viewLabel,
          detectedFrom: 'url-pattern',
          confidence: p.confidence,
        };
      }
    }
    return null;
  }

  /**
   * Number of registered patterns.
   */
  get size(): number {
    return this.patterns.length;
  }
}

/**
 * Default view patterns for common web application types.
 * These are intentionally generic — covering common e-commerce, SPA,
 * and general web URL structures.
 *
 * Confidence values reflect how reliably the pattern identifies the view:
 *  0.9 — strong structural signal (path segment like /dp/, /cart/)
 *  0.7 — good signal (query param like ?q=, ?search=)
 *  0.5 — moderate signal (generic patterns)
 *
 * Order matters — more specific patterns before generic ones (first match wins).
 */
export const DEFAULT_VIEW_PATTERNS: ViewPattern[] = [
  // ── E-commerce: Cart-specific patterns (must be before generic /cart) ──
  { viewId: 'cart-confirmation', viewLabel: 'Cart Confirmation', pattern: '/cart/add-to-cart', confidence: 0.9 },
  { viewId: 'cart-confirmation', viewLabel: 'Cart Confirmation', pattern: '/cart/add', confidence: 0.8 },
  { viewId: 'cart', viewLabel: 'Cart', pattern: '/cart', confidence: 0.9 },
  { viewId: 'cart', viewLabel: 'Cart', pattern: '/shopping-cart', confidence: 0.9 },
  { viewId: 'cart', viewLabel: 'Cart', pattern: '/basket', confidence: 0.85 },

  // ── E-commerce: Product detail ──
  // Amazon: /dp/ASIN, /product/ID
  { viewId: 'product-detail', viewLabel: 'Product Detail', pattern: '/dp/[A-Z0-9]', confidence: 0.9 },
  { viewId: 'product-detail', viewLabel: 'Product Detail', pattern: '/product/', confidence: 0.9 },
  { viewId: 'product-detail', viewLabel: 'Product Detail', pattern: '/products?/', confidence: 0.9 },
  { viewId: 'product-detail', viewLabel: 'Product Detail', pattern: '/item/', confidence: 0.85 },

  // ── E-commerce: Checkout ──
  { viewId: 'checkout', viewLabel: 'Checkout', pattern: '/checkout', confidence: 0.9 },
  { viewId: 'checkout', viewLabel: 'Checkout', pattern: '/pay$', confidence: 0.85 },

  // ── Search results ──
  // Amazon uses /s? and /s/ref= paths; general apps use /search?q=
  { viewId: 'search-results', viewLabel: 'Search Results', pattern: '/s\\?', confidence: 0.85 },
  { viewId: 'search-results', viewLabel: 'Search Results', pattern: '/s/ref=', confidence: 0.85 },
  { viewId: 'search-results', viewLabel: 'Search Results', pattern: '/search', confidence: 0.85 },
  { viewId: 'search-results', viewLabel: 'Search Results', pattern: '[?&](q|query|search|keywords|field-keywords)=', confidence: 0.8 },
  { viewId: 'search-results', viewLabel: 'Search Results', pattern: '/results', confidence: 0.75 },

  // ── Home / landing ──
  { viewId: 'home', viewLabel: 'Home', pattern: '^https?://[^/]+/?$', confidence: 0.7 },
  { viewId: 'home', viewLabel: 'Home', pattern: '/home', confidence: 0.7 },
  { viewId: 'home', viewLabel: 'Home', pattern: '/landing', confidence: 0.7 },

  // ── User account ──
  { viewId: 'account', viewLabel: 'Account', pattern: '/account', confidence: 0.85 },
  { viewId: 'account', viewLabel: 'Account', pattern: '/profile', confidence: 0.85 },
  { viewId: 'account', viewLabel: 'Account', pattern: '/dashboard', confidence: 0.8 },
  { viewId: 'login', viewLabel: 'Login', pattern: '/login', confidence: 0.9 },
  { viewId: 'login', viewLabel: 'Login', pattern: '/signin', confidence: 0.9 },
  { viewId: 'register', viewLabel: 'Register', pattern: '/register', confidence: 0.9 },
  { viewId: 'register', viewLabel: 'Register', pattern: '/signup', confidence: 0.9 },

  // ── Order history ──
  { viewId: 'orders', viewLabel: 'Orders', pattern: '/orders', confidence: 0.9 },
  { viewId: 'orders', viewLabel: 'Orders', pattern: '/order-history', confidence: 0.9 },

  // ── Wishlist / favorites ──
  { viewId: 'wishlist', viewLabel: 'Wishlist', pattern: '/wishlist', confidence: 0.9 },
  { viewId: 'wishlist', viewLabel: 'Wishlist', pattern: '/favorites', confidence: 0.85 },
];

/**
 * Factory: create a ViewRegistry with default patterns.
 */
export function createDefaultViewRegistry(): ViewRegistry {
  return new ViewRegistry(DEFAULT_VIEW_PATTERNS);
}
