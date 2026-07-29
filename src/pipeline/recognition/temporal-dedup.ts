/**
 * Temporal Dedup — Phase 5b
 *
 * Suppresses duplicate interactions within a time window.
 *
 * Decision: [ADOPTED] from v10.9.0 component-runtime.ts per-type dedup.
 * The reference uses a 2000ms window per interaction type with special
 * rules for checkbox/radio (cross-element same-name dedup).
 *
 * Rules:
 * 1. Same event type + same element within DEDUP_WINDOW_MS → suppress
 * 2. Checkbox/radio: same accessibleName within DEDUP_WINDOW_MS (different
 *    elements are still duplicates — OXD framework fires label→input synthetic clicks)
 * 3. Scroll is exempt (burst coalescing handles it)
 *
 * Architecture: sits between recognition and lifecycle as a filter.
 */

import type { RecognitionResult, RecognisedInteraction } from '../../types/recognition';
import type { EvidenceBatch } from '../../types/evidence';

const DEDUP_WINDOW_MS = 2000;

interface DedupEntry {
  verb: string;
  elementKey: string;
  accessibleName: string;
  timestamp: number;
}

/**
 * Dedup state tracker.
 */
export class TemporalDedup {
  private entries: DedupEntry[] = [];

  /**
   * Check if a recognition result should be suppressed as a duplicate.
   * If not, record it for future checks.
   *
   * @returns true if the result is a duplicate (should be suppressed)
   */
  isDuplicate(
    result: RecognitionResult,
    batch?: EvidenceBatch,
  ): boolean {
    if (result.kind !== 'recognised') return false;

    const rec = result as RecognisedInteraction;
    const now = new Date(rec.timestamp).getTime();

    // Scroll is exempt — burst coalescing handles it
    if (rec.verb === 'scroll') return false;

    const elementKey = batch?.target.primaryLocator?.value ?? rec.id;
    const accessibleName = batch?.target.accessibleName ?? '';

    // Check if this is a duplicate
    for (const entry of this.entries) {
      const age = now - entry.timestamp;
      if (age > DEDUP_WINDOW_MS) continue;

      // Rule 1: Same verb + same element within window
      if (entry.verb === rec.verb && entry.elementKey === elementKey) {
        return true;
      }

      // Rule 2: Checkbox/radio same accessibleName within window
      // (cross-element — OXD fires label→input synthetic clicks)
      if (
        (rec.verb === 'toggle' || rec.verb === 'selectOption') &&
        entry.verb === rec.verb &&
        accessibleName &&
        entry.accessibleName === accessibleName
      ) {
        return true;
      }
    }

    // Record this interaction
    this.entries.push({
      verb: rec.verb,
      elementKey,
      accessibleName,
      timestamp: now,
    });

    // Cleanup old entries
    if (this.entries.length > 200) {
      this.entries = this.entries.filter(e => now - e.timestamp <= DEDUP_WINDOW_MS);
    }

    return false;
  }

  /**
   * Filter an array of recognition results, removing duplicates.
   */
  filter(
    results: RecognitionResult[],
    batches: Map<string, EvidenceBatch>,
  ): RecognitionResult[] {
    this.reset();
    return results.filter(result => {
      const batch = batches.get(result.sourceBatches[0] ?? '');
      return !this.isDuplicate(result, batch);
    });
  }

  reset(): void {
    this.entries = [];
  }
}
