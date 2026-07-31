/**
 * Intent inference: the evidence fusion function.
 *
 * This is a pure function: Evidence[] → IntentClassification.
 * It aggregates all evidence votes by intent, sums weights, and picks the winner.
 *
 * The function signature is the de facto reasoning strategy interface.
 * If a future phase needs a different reasoning strategy (rule-based,
 * probabilistic, AI-assisted), this function is replaced — evidence
 * generators don't change.
 *
 * Fusion algorithm:
 *   1. Group evidence by intent
 *   2. Sum weights per intent (positive adds, negative subtracts)
 *   3. Pick the intent with the highest score
 *   4. Confidence = normalized score (0.0–1.0)
 *   5. Runner-up = second-highest scoring intent (if score > 0)
 */

import type { IntentVote, IntentClassification, SemanticIntent } from './types';

// Minimum score to be considered a valid classification.
// If no intent reaches this threshold, confidence is 0 and the type
// deriver will fall back to 'Click' (the universal fallback).
const MIN_CONFIDENCE_THRESHOLD = 0.0;

/**
 * Fuse evidence votes into a single intent classification.
 *
 * @param evidence All evidence votes from all generators
 * @returns The winning intent, its confidence, the audit trail, and runner-up
 */
export function fuseEvidence(evidence: IntentVote[]): IntentClassification {
  if (evidence.length === 0) {
    return {
      intent: 'trigger', // neutral fallback — trigger is the "just clicked" intent
      confidence: 0,
      evidence: [],
    };
  }

  // Aggregate scores by intent
  const scores = new Map<SemanticIntent, number>();
  for (const e of evidence) {
    scores.set(e.intent, (scores.get(e.intent) ?? 0) + e.weight);
  }

  // Sort intents by score (descending)
  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);

  const [bestIntent, bestScore] = ranked[0];
  const runnerUp = ranked.length > 1 && ranked[1][1] > 0
    ? { intent: ranked[1][0], score: ranked[1][1] }
    : undefined;

  // Confidence: the raw score, clamped to [0, 1]
  const confidence = Math.max(0, Math.min(1, bestScore));

  return {
    intent: bestScore >= MIN_CONFIDENCE_THRESHOLD ? bestIntent : 'trigger',
    confidence,
    evidence,
    runnerUp,
  };
}
