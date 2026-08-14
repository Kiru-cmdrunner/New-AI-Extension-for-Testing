/**
 * M9.11 — Network Pattern Registry
 *
 * Extensible registry for network/API classification patterns.
 * When installed via DomainPack, NetworkSignalExtractor resolves new
 * operations without modifying the extractor's core logic.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { NetworkPatternSpec } from './domain-pack-types';

/**
 * Registry of URL→operation classification patterns.
 */
export class NetworkPatternRegistry {
  private patterns: NetworkPatternSpec[] = [];

  /**
   * Register patterns. Patterns are prepended so domain-specific rules
   * are checked before the built-in defaults.
   */
  register(specs: NetworkPatternSpec[]): void {
    this.patterns = [...specs, ...this.patterns];
  }

  /**
   * Classify a URL to an operation label.
   * Domain patterns first, then unknown if none match.
   */
  classify(url: string): string | null {
    for (const spec of this.patterns) {
      const re = new RegExp(spec.pattern, 'i');
      if (re.test(url)) return spec.operation;
    }
    return null;
  }

  /**
   * Get all registered patterns.
   */
  getAll(): NetworkPatternSpec[] {
    return this.patterns;
  }

  clear(): void {
    this.patterns = [];
  }

  /** Number of registered patterns. */
  get size(): number {
    return this.patterns.length;
  }
}
