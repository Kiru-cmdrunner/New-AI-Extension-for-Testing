/**
 * MS-U1 — Assertion Chip (renderer-only, A8).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md
 *
 * Counts derived IR assertions per interaction via the join the generation
 * pipeline already guarantees: interaction.triggerEvent.eventId ===
 * IRStep.sourceEventId (ir-bridge.ts:587). Display only — the IR itself is
 * untouched. An explicit plan may be installed before a render batch
 * (setAssertionPlan) or cleared; without a plan the chip is honestly absent
 * (never zero-claim from no data — absent data ≠ zero assertions).
 */

import type { ExecutionIRPlan } from '../domain/execution-ir/types';

let countsBySourceEventId: ReadonlyMap<string, number> | null = null;

/** Install the plan whose assertion counts should be displayed. */
export function setAssertionPlan(plan: ExecutionIRPlan | null): void {
  if (!plan) {
    countsBySourceEventId = null;
    return;
  }
  const map = new Map<string, number>();
  for (const step of plan.steps ?? []) {
    if (!step.sourceEventId) continue;
    const n = Array.isArray(step.assertions) ? step.assertions.length : 0;
    map.set(step.sourceEventId, (map.get(step.sourceEventId) ?? 0) + n);
  }
  countsBySourceEventId = map;
}

/**
 * Assertion count for a source event, or null when unknown (no plan
 * installed / this event has no step). null ≠ 0: a step with zero
 * assertions renders `0 assertions` (honest); no data renders nothing.
 */
export function getAssertionCountFor(sourceEventId: string | undefined): number | null {
  if (!sourceEventId || !countsBySourceEventId) return null;
  if (!countsBySourceEventId.has(sourceEventId)) return null;
  return countsBySourceEventId.get(sourceEventId) ?? 0;
}
