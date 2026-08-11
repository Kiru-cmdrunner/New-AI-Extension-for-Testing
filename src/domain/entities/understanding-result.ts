/**
 * Understanding Result — the aggregate output of the Understanding Layer.
 *
 * This is the layer boundary between understanding and generation. The
 * Understanding Layer produces a single UnderstandingResult containing all
 * semantic and structural artifacts derived from the recording session.
 * The Generation Layer (IR Bridge) consumes this as its sole input from
 * the Understanding Layer.
 *
 * Design principles:
 *   - Aggregate boundary: downstream systems import UnderstandingResult, not
 *     individual artifact types. This keeps the layer boundary explicit.
 *   - Extensible: future understanding artifacts (Domain Entities, Navigation
 *     Graph, Business Rules) extend this aggregate as optional fields.
 *     Existing consumers don't break because all new fields are optional.
 *
 * Architecture:
 *
 *   Understanding Layer
 *     ├── Enrichment Pipeline → Fragment
 *     └── Output: UnderstandingResult { fragment }
 *
 *   Generation Layer
 *     └── IR Bridge: (events + interactions + UnderstandingResult) → ExecutionIRPlan
 *
 * Reference: Phase 9.5 architectural design discussion
 */

import type { ApplicationKnowledgeFragment } from './application-knowledge';

/**
 * The complete output of the Understanding Layer for a single recording session.
 *
 * Contains all artifacts produced by understanding the recording:
 *   - Fragment: structural understanding (what exists, what happened)
 *
 * Future artifacts (all optional, additive, non-breaking):
 *   - Domain Entities, Navigation Graph, Business Rules, Requirements
 *
 * The Generation Layer reads this aggregate and produces ExecutionIRPlan.
 * The Repository persists this aggregate as the canonical session understanding.
 * Coverage visualization and impact analysis query this aggregate.
 */
export interface UnderstandingResult {
  /** Session ID this result was produced from. */
  readonly sessionId: string;
  /** When the understanding was computed. */
  readonly generatedAt: string;
  /** Schema version for forward compatibility. */
  readonly schemaVersion: number;

  // ── Understanding artifacts ──

  /** Structural understanding: what exists, what happened. Null when the Understanding Layer has not yet produced a fragment. */
  readonly fragment: ApplicationKnowledgeFragment | null;

  // ── Future artifacts (optional, additive) ──
  // domainEntities?: DomainEntity[];
  // navigationGraph?: NavigationGraph;
  // businessRules?: BusinessRule[];
}
