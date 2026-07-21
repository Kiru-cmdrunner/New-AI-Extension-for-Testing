/**
 * Merge Layer — V2-Primary with V1 Event-Segment Fallback
 *
 * Architecture:
 *
 *   Raw Events
 *       │
 *       ├─→ V2 (detectInteractionsV2) → v2Results[]
 *       │       Each result has eventIds[] + confidence + type
 *       │
 *       ├─→ V1 (detectInteractions)   → v1Results[]
 *       │       Runs on FULL event stream (preserves grouping)
 *       │
 *       └─→ mergeV1V2()
 *               1. Partition V2 into "confident" (type≠Unknown, conf≥threshold)
 *                  and "unconfident" (Unknown or below threshold)
 *               2. Build claimedEventIds from confident V2 results
 *               3. Filter V1: drop any interaction with ANY eventId overlap
 *                  with claimed set — V2 always wins
 *               4. Merge: confident V2 + surviving V1, sorted by first eventId
 *               5. Tag each interaction: engine='v2' or engine='v1-fallback'
 *               6. Compute metrics
 *
 * Design Principles:
 *   - V2 is always the primary engine.
 *   - V1 only classifies event segments V2 couldn't claim.
 *   - Every interaction records which engine produced it.
 *   - No event belongs to more than one interaction (dedup guarantee).
 *   - Metrics track V2 vs V1 ratio for progress monitoring.
 */

import type { DetectedInteraction } from '../interaction-types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MergeMetrics {
  totalInteractions: number;
  v2Count: number;
  v1FallbackCount: number;
  v2Percentage: number;
  v1FallbackPercentage: number;
  /** Number of V2 interactions that were Unknown or below threshold (didn't claim events). */
  v2UnconfidentCount: number;
  /** Number of V1 interactions dropped because V2 claimed their events. */
  v1DroppedCount: number;
  /** Total events in the recording. */
  totalEvents: number;
  /** Events claimed by confident V2 interactions. */
  eventsClaimedByV2: number;
  /** Events that fell through to V1. */
  eventsInV1Fallback: number;
}

export interface MergeResult {
  interactions: DetectedInteraction[];
  metrics: MergeMetrics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum confidence for V2 to "claim" an interaction and prevent V1 fallback. */
const CONFIDENCE_THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Merge Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge V2 (Evidence Engine) and V1 (Interaction Detector) results.
 *
 * V2 is primary: confident V2 interactions claim their events, preventing
 * V1 from classifying those same events. V1 only handles events V2 didn't
 * claim.
 *
 * @param v2Results - Output from detectInteractionsV2()
 * @param v1Results - Output from detectInteractions()
 * @param totalEvents - Total number of raw events (for metrics)
 * @returns Merged interactions + metrics
 */
export function mergeV1V2(
  v2Results: DetectedInteraction[],
  v1Results: DetectedInteraction[],
  totalEvents: number,
): MergeResult {
  // ── Step 1: Partition V2 into confident vs unconfident ──
  const confidentV2: DetectedInteraction[] = [];
  const unconfidentV2: DetectedInteraction[] = [];

  for (const v2 of v2Results) {
    if (v2.type !== 'Unknown' && v2.confidence >= CONFIDENCE_THRESHOLD) {
      confidentV2.push(v2);
    } else {
      unconfidentV2.push(v2);
    }
  }

  // ── Step 2: Build claimed event ID set from confident V2 ──
  const claimedEventIds = new Set<string>();
  for (const v2 of confidentV2) {
    for (const eventId of v2.eventIds) {
      claimedEventIds.add(eventId);
    }
  }

  // ── Step 3: Filter V1 — drop interactions that overlap with claimed events ──
  const survivingV1: DetectedInteraction[] = [];
  let v1DroppedCount = 0;

  for (const v1 of v1Results) {
    const overlaps = v1.eventIds.some(id => claimedEventIds.has(id));
    if (overlaps) {
      v1DroppedCount++;
    } else {
      survivingV1.push(v1);
    }
  }

  // ── Step 4: Tag engine source ──
  const taggedV2 = confidentV2.map(i => ({
    ...i,
    engine: 'v2' as const,
  }));

  const taggedV1 = survivingV1.map(i => ({
    ...i,
    engine: 'v1-fallback' as const,
  }));

  // ── Step 5: Merge + sort by first eventId ──
  const merged = [...taggedV2, ...taggedV1].sort((a, b) => {
    const aFirst = a.eventIds[0] || '';
    const bFirst = b.eventIds[0] || '';
    // Sort by numeric portion of evt-NNNN
    const aNum = parseInt(aFirst.split('-')[1] || '0', 10);
    const bNum = parseInt(bFirst.split('-')[1] || '0', 10);
    return aNum - bNum;
  });

  // ── Step 6: Compute metrics ──
  const v2Count = taggedV2.length;
  const v1Count = taggedV1.length;
  const total = v2Count + v1Count;

  const eventsInV1Fallback = taggedV1.reduce((sum, i) => sum + i.eventIds.length, 0);

  const metrics: MergeMetrics = {
    totalInteractions: total,
    v2Count,
    v1FallbackCount: v1Count,
    v2Percentage: total > 0 ? Math.round((v2Count / total) * 1000) / 10 : 0,
    v1FallbackPercentage: total > 0 ? Math.round((v1Count / total) * 1000) / 10 : 0,
    v2UnconfidentCount: unconfidentV2.length,
    v1DroppedCount,
    totalEvents,
    eventsClaimedByV2: claimedEventIds.size,
    eventsInV1Fallback,
  };

  return { interactions: merged, metrics };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev Logging — only active when console.debug is called
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log merge metrics to console for debugging.
 * Called after merge in the service worker's STOP_RECORDING handler.
 */
export function logMergeMetrics(metrics: MergeMetrics): void {
  const bar = '═'.repeat(50);
  console.log(
    `\n${bar}\n` +
    `  Merge Metrics\n` +
    `${bar}\n` +
    `  V2 (Evidence Engine):     ${metrics.v2Count} interactions (${metrics.v2Percentage}%)\n` +
    `  V1 (Fallback):            ${metrics.v1FallbackCount} interactions (${metrics.v1FallbackPercentage}%)\n` +
    `  V2 Unconfident:           ${metrics.v2UnconfidentCount} (didn't claim events)\n` +
    `  V1 Dropped (overlap):     ${metrics.v1DroppedCount}\n` +
    `  Events claimed by V2:     ${metrics.eventsClaimedByV2}/${metrics.totalEvents}\n` +
    `  Events in V1 fallback:    ${metrics.eventsInV1Fallback}/${metrics.totalEvents}\n` +
    `${bar}\n`,
  );
}
