/**
 * CP4 — episode-outcome derivation.
 *
 * Derives an episode-level outcome by merging the recorded member outcomes'
 * votes with OutcomeDeterminer's EXISTING semantics (weights already assigned
 * in supportingEvidence; categorization and confidence rules mirrored
 * exactly). The determiner class is NEVER instantiated — §8 invariant: only
 * the weight table is mirrored, and tests pin its values/sum.
 *
 * Semantics mirrors:
 *   - OutcomeDeterminer.categorize(): no votes → 'incomplete' (DDC-8);
 *     both sides present with min/max ratio > 0.3 (strict) → 'ambiguous';
 *     otherwise stronger side wins; tie with votes → 'ambiguous'.
 *   - OutcomeDeterminer.computeConfidence(): success/failure → winning side
 *     (capped at 1); ambiguous → half the TOTAL evidence weight (capped at 1);
 *     incomplete → 0; degraded halves positive confidence (DDC-5).
 *
 * DDC-8 respected: members with a recorded outcome but no vote-bearing
 * evidence yield 'incomplete' — edge existence alone never fabricates
 * success. null is reserved for "no member of this episode has any recorded
 * ActionOutcome at all" (CP1 contract).
 *
 * Determinism: no Date.now / Math.random / performance.now; member/vote
 * ordering follows CER-5 (numeric interaction-ID order); contributingMembers
 * sorted CER-5 and deduped; confidence rounded to 3 decimals. Inputs are
 * never mutated.
 */

import { compareInteractionIds } from '../state-builder/interaction-ordering';
import type { ActionOutcome, OutcomeVote } from '../outcome/outcome-types';
import { confidenceToLevel } from '../outcome/outcome-types';
import type { ActionEpisode, EpisodeOutcome } from './model-types';

/**
 * Weight table mirrored from OutcomeDeterminer.WEIGHTS (read-only mirror —
 * never redefined from source of truth; tests pin every value and the sum).
 * Any determiner drift must be mirrored here deliberately.
 */
export const EPISODE_WEIGHTS = {
  apiSuccess: 0.4,
  apiFailure: 0.5,
  notificationSuccess: 0.3,
  notificationError: 0.4,
  notificationWarning: 0.15,
  counterPositive: 0.2,
  counterNegative: 0.2,
  viewConfirmation: 0.25,
  listGrowth: 0.15,
  pageContentEntity: 0.15,
  pageContentCounter: 0.2,
  pageContentNotification: 0.2,
} as const;

/** Round to 3 decimals so 0.1+0.2-style float drift never leaks. */
function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Categorize summed votes exactly as OutcomeDeterminer.categorize() does.
 * No votes (voteCount 0) → 'incomplete' — evidence with unknown result
 * never votes, so an outcome record can exist with zero counted votes.
 */
export function categorizeVotes(
  successSum: number,
  failureSum: number,
  voteCount: number,
): 'success' | 'failure' | 'ambiguous' | 'incomplete' {
  if (voteCount === 0) return 'incomplete';
  if (successSum > 0 && failureSum > 0) {
    const ratio = Math.min(successSum, failureSum) / Math.max(successSum, failureSum);
    if (ratio > 0.3) return 'ambiguous';
  }
  if (successSum > failureSum) return 'success';
  if (failureSum > successSum) return 'failure';
  return 'ambiguous'; // tie with votes
}

/** Confidence mirrors OutcomeDeterminer.computeConfidence exactly:
 *  success/failure → winning side's summed weight (capped at 1);
 *  ambiguous → half the TOTAL evidence weight (how balanced it is),
 *  capped at 1; incomplete → 0. Degraded evidence halves it (DDC-5). */
export function episodeConfidence(
  outcome: 'success' | 'failure' | 'ambiguous' | 'incomplete',
  successSum: number,
  failureSum: number,
  degraded: boolean,
): number {
  let base: number;
  switch (outcome) {
    case 'success':
      base = successSum;
      break;
    case 'failure':
      base = failureSum;
      break;
    case 'ambiguous':
      base = (successSum + failureSum) * 0.5;
      break;
    default:
      base = 0;
  }
  const confidence = Math.min(1, base);
  return degraded ? confidence / 2 : confidence;
}

/** Input for deriveEpisodeOutcome. */
export interface EpisodeOutcomeInput {
  /** Episode whose members' outcomes are merged. Never mutated. */
  episode: ActionEpisode;
  /** Recorded per-interaction outcomes keyed by interactionId. */
  memberOutcomes: Map<string, ActionOutcome>;
  /** DDC-5: degraded evidence (e.g. capped windows) halves confidence. */
  degraded?: boolean;
}

/**
 * Derive the episode-level outcome from member outcomes' recorded votes.
 * Returns null ⇔ no member of this episode has ANY recorded ActionOutcome
 * (CP1 contract). Members with outcomes but zero counted votes →
 * 'incomplete' at 0 (DDC-8: never fabricate).
 */
export function deriveEpisodeOutcome(
  input: EpisodeOutcomeInput,
): EpisodeOutcome | null {
  const { episode, memberOutcomes, degraded = false } = input;

  // Deterministic member order: CER-5.
  const memberIds = episode.members
    .map((m) => m.interactionId)
    .sort(compareInteractionIds);

  const votes: Array<{ member: string; vote: OutcomeVote }> = [];
  const contributingSet = new Set<string>();
  let anyOutcomeRecorded = false;

  for (const memberId of memberIds) {
    const outcome = memberOutcomes.get(memberId);
    if (!outcome) continue;
    anyOutcomeRecorded = true;
    for (const evidence of outcome.supportingEvidence) {
      if (evidence.result !== 'success' && evidence.result !== 'failure') continue;
      contributingSet.add(memberId);
      votes.push({
        member: memberId,
        vote: { result: evidence.result, weight: evidence.weight, evidence },
      });
    }
  }

  // CP1 contract: null ⇔ no member of this episode has ANY recorded
  // ActionOutcome. A member HAS one but no vote survived (empty evidence
  // or all 'unknown') → 'incomplete' at 0 — never fabricate (DDC-8).
  if (!anyOutcomeRecorded) return null;

  const successSum = votes
    .filter((v) => v.vote.result === 'success')
    .reduce((sum, v) => sum + v.vote.weight, 0);
  const failureSum = votes
    .filter((v) => v.vote.result === 'failure')
    .reduce((sum, v) => sum + v.vote.weight, 0);

  const outcome = categorizeVotes(successSum, failureSum, votes.length);
  const confidence = episodeConfidence(outcome, successSum, failureSum, degraded);

  return {
    outcome,
    confidence: roundConfidence(confidence),
    confidenceLevel: confidenceToLevel(confidence),
    contributingMembers: [...contributingSet].sort(compareInteractionIds),
    derivation: 'derived-episode-outcome',
  };
}
