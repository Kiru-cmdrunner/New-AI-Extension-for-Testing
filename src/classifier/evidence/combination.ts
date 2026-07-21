/**
 * Evidence Combination — Weighted Voting
 *
 * Combines evidence from multiple providers to determine the final interaction
 * type and confidence. Uses weighted average: each evidence contributes
 * (confidence × weight) to its suggested type, normalized by total weight.
 *
 * Design principles:
 * - A single authoritative provider (high weight) can carry a classification
 * - Multiple agreeing providers reinforce each other
 * - Conflicting evidence is resolved by highest weighted average
 */

import type { InteractionType } from '../interaction-types.ts';
import type { Evidence, CombinationResult } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum score to commit an interaction as a known type.
 * Below this, the interaction is classified as Unknown.
 */
export const COMMIT_THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Combination Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combine all evidence in a buffer to determine the final interaction type.
 *
 * Algorithm:
 *   1. Group evidence by suggestedType (skip null suggestions)
 *   2. For each type, compute the weighted average score:
 *        score(type) = Σ(confidence_i × weight_i) / Σ(weight_i)
 *      This is a WEIGHTED AVERAGE — providers with higher weight have more
 *      influence. A single authoritative provider (weight=1.0, conf=0.99)
 *      gives score = 0.99. Two weaker providers reinforce each other.
 *   3. The type with the highest score wins.
 *   4. If the winning score < COMMIT_THRESHOLD, classify as Unknown.
 *
 * @param evidence - All accumulated evidence
 * @returns Combination result with winning type, confidence, and full trail
 */
export function combineEvidence(evidence: Evidence[]): CombinationResult {
  if (evidence.length === 0) {
    return {
      type: 'Unknown' as InteractionType,
      confidence: 0.0,
      evidence: [],
      scores: [],
    };
  }

  // Step 1: Group evidence by suggestedType
  const byType = new Map<InteractionType, Evidence[]>();

  for (const e of evidence) {
    if (e.suggestedType === null) continue;

    const list = byType.get(e.suggestedType);
    if (list) {
      list.push(e);
    } else {
      byType.set(e.suggestedType, [e]);
    }
  }

  if (byType.size === 0) {
    return {
      type: 'Unknown' as InteractionType,
      confidence: 0.0,
      evidence,
      scores: [],
    };
  }

  // Step 2: Compute weighted average score for each type
  const scores: Array<{ type: InteractionType; score: number; evidenceCount: number }> = [];

  for (const [type, evidenceList] of byType) {
    const totalWeightedVote = evidenceList.reduce(
      (sum, e) => sum + e.confidence * e.weight,
      0,
    );
    const totalWeight = evidenceList.reduce(
      (sum, e) => sum + e.weight,
      0,
    );
    const score = totalWeight > 0 ? totalWeightedVote / totalWeight : 0;
    scores.push({ type, score, evidenceCount: evidenceList.length });
  }

  // Sort by score descending (highest first)
  scores.sort((a, b) => b.score - a.score);

  // Step 3: Pick the winner
  const winner = scores[0];

  // Step 4: Apply commit threshold
  if (winner.score < COMMIT_THRESHOLD) {
    return {
      type: 'Unknown' as InteractionType,
      confidence: round3(winner.score),
      evidence,
      scores,
    };
  }

  return {
    type: winner.type,
    confidence: round3(winner.score),
    evidence,
    scores,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: merge metadata from winning evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract metadata from the evidence that contributed to the winning type.
 * Later evidence overrides earlier evidence for the same metadata field.
 */
export function extractMetadata(
  winningType: InteractionType,
  evidence: Evidence[],
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  for (const e of evidence) {
    if (e.suggestedType !== winningType) continue;
    if (!e.metadata) continue;

    for (const [key, value] of Object.entries(e.metadata)) {
      if (value !== undefined && value !== null) {
        metadata[key] = value;
      }
    }
  }

  return metadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
