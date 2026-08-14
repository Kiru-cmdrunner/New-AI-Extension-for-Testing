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
 *   - Extensible: future understanding artifacts extend this aggregate as
 *     optional fields. Existing consumers don't break because all new fields
 *     are optional.
 *
 * Architecture:
 *
 *   Understanding Layer
 *     └── Output: UnderstandingResult
 *
 *   Generation Layer
 *     └── IR Bridge: (events + interactions + UnderstandingResult) → ExecutionIRPlan
 *
 * Reference: Phase 9.5 architectural design discussion
 */

// M9.12: type-only imports from understanding layer.
// These are additive optional fields — no runtime coupling to the
// understanding module from the domain layer.
import type { SemanticKnowledge } from '../../understanding/enrichment/semantic-types';
import type { ApplicationKnowledge } from '../../understanding/consolidation/application-knowledge';
import type { ActionOutcome } from '../../understanding/outcome/outcome-types';
import type { StateTransition } from '../../understanding/state-builder/types';

/**
 * The complete output of the Understanding Layer for a single recording session.
 *
 * Contains all artifacts produced by understanding the recording.
 *
 * Future artifacts (all optional, additive, non-breaking):
 *   - Fragment (structural understanding), Domain Entities, Navigation Graph,
 *     Business Rules, Requirements
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

  // ── M9.12 — Application Understanding (optional, additive) ──

  /** Semantic knowledge from M9.7 enrichment (domain, surface, workflows...). */
  readonly semanticKnowledge?: SemanticKnowledge;
  /** Consolidated cross-session application knowledge from M9.6. */
  readonly applicationKnowledge?: ApplicationKnowledge;
  /** Non-fatal warnings from the understanding pipeline. */
  readonly knowledgeWarnings?: string[];

  // ── D12 — Pipeline artifacts (optional, additive) ──

  /** Determined outcomes per interaction (D12). Serialized as array. */
  readonly outcomes?: ActionOutcome[];
  /** State transitions from the recording session (D12). */
  readonly transitions?: StateTransition[];
  /** Stable app ID derived from the recording origin (D12). */
  readonly appId?: string;
}
