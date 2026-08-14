/**
 * M9.11 — Intent Vocabulary Registry
 *
 * Extensible registry for intent vocabulary entries. When installed
 * via DomainPack, IntentLabeler resolves new intents without modifying
 * the labeler's core logic.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { IntentVocabEntry } from '../enrichment/intent-vocabulary';

/**
 * Registry of intent vocabulary entries from all sources.
 */
export class IntentVocabularyRegistry {
  private entries: IntentVocabEntry[] = [];

  /**
   * Register vocabulary entries. Entries are prepended so domain-specific
   * intents are checked before generic fallbacks.
   */
  register(entries: IntentVocabEntry[]): void {
    this.entries = [...entries, ...this.entries];
  }

  /**
   * Get all registered entries in priority order (domain-specific first).
   */
  getAll(): IntentVocabEntry[] {
    return this.entries;
  }

  /**
   * Number of registered entries.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }
}
