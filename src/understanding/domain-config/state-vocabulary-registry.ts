/**
 * M9.11 — State Vocabulary Registry
 *
 * Extensible registry for entity lifecycle state keywords.
 * When installed via DomainPack, new state keywords are resolved by
 * EntityStateTracker.normalizeStateText() without modifying the tracker.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { StateVocabEntry } from './domain-pack-types';

/**
 * Registry of domain-contributed state vocabulary entries.
 */
export class StateVocabularyRegistry {
  private entries: Map<string, string> = new Map();

  /**
   * Register a state vocabulary entry. Keywords are case-insensitive.
   */
  register(entry: StateVocabEntry): void {
    for (const kw of entry.keywords) {
      this.entries.set(kw.toLowerCase(), entry.canonical);
    }
  }

  /**
   * Register multiple entries.
   */
  registerAll(entries: StateVocabEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  /**
   * Resolve raw text to a canonical state.
   * Tries exact match first, then word-boundary partial match
   * (longest keyword first).
   */
  resolve(text: string): string | null {
    const lower = text.trim().toLowerCase();
    if (!lower) return null;

    // Exact match
    if (this.entries.has(lower)) {
      return this.entries.get(lower)!;
    }

    // Partial match (longest keyword first)
    const keywords = [...this.entries.keys()].sort((a, b) => b.length - a.length);
    for (const kw of keywords) {
      const re = new RegExp(
        `(^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`,
        'i',
      );
      if (re.test(lower)) {
        return this.entries.get(kw)!;
      }
    }

    return null;
  }

  /**
   * Get all registered keywords.
   */
  getKeywords(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Number of registered keywords.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }
}
