/**
 * Capability Rule Interface — the contract every capability rule implements.
 *
 * Rules are independent, side-effect-free evaluators. Each examines the
 * evidence for one interaction and returns a claim (or null if it doesn't
 * claim). The engine collects all claims and delegates to the conflict resolver.
 *
 * Phase 1 provides the interface only. Individual rules (ToggleControl,
 * FilterSelection, etc.) are implemented in Phases 2–5.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (§7, Phase 1)
 */

import type { CapabilityType, CapabilityClaim } from './capability-types';
import type { ExtractedEvidence } from './evidence-extractor';

/**
 * The contract every capability rule implements.
 *
 * A rule is registered with the engine, which calls evaluate() for each
 * interaction. The rule decides whether the evidence supports its capability
 * type and at what confidence.
 *
 * Key invariants:
 * - Rules are stateless — no side effects, no mutation of inputs.
 * - Rules are independent — one rule's output does not affect another's.
 * - Required signals: ALL must be present for the rule to claim at all.
 * - Supporting signals: each present boosts confidence; absent ones don't block.
 */
export interface CapabilityRule {
  /** The capability type this rule classifies. */
  readonly capability: CapabilityType;

  /**
   * Priority for conflict resolution tiebreaker.
   * Lower number = more specific rule = wins ties.
   * E.g., OpenDetail (priority 10) beats Navigate (priority 30).
   */
  readonly priority: number;

  /**
   * Evaluate the evidence and return a claim, or null if the rule doesn't fire.
   *
   * @param evidence - The extracted evidence for this interaction.
   * @returns A CapabilityClaim if the rule claims, null otherwise.
   */
  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null;
}
