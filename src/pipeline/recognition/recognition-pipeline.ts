/**
 * Recognition Pipeline — Phase 4
 *
 * Orchestrates the recognition stages:
 * 1. Event Grouper — merges related batches into candidates
 * 2. Pattern Evaluator — evaluates each candidate against the pattern registry
 * 3. Confidence Gate — accepts matches above threshold
 *
 * This is the entry point for the recognition stage. It takes raw EvidenceBatches
 * and produces a RecognitionOutput with RecognisedInteractions and
 * UnrecognisedInteractions.
 *
 * The pipeline is stateless and pure — same input always produces the same output.
 * No side effects, no mutation of input data.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch, BatchId } from '../../types/evidence';
import type { PatternDefinition, InteractionVerb } from '../../types/foundation';
import type {
  RecognisedInteraction,
  UnrecognisedInteraction,
  RecognitionResult,
  RecognitionOutput,
  PatternMatchTrace,
  ClosestPatternMatch,
  RecognitionError,
} from '../../types/recognition';

import { groupBatches, type InteractionCandidate } from './event-grouper';
import { evaluatePattern, type PatternEvalResult } from './pattern-evaluator';
import { getAllPatterns } from './pattern-registry';
import { TemporalDedup } from './temporal-dedup';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Options for running the recognition pipeline.
 */
export interface RecognitionOptions {
  /** Custom patterns to use (defaults to all registered patterns). */
  patterns?: PatternDefinition[];
  /**
   * Enable temporal deduplication (Phase 5b).
   * Suppresses duplicate interactions within a 2000ms window.
   * Default: true.
   */
  enableDedup?: boolean;
}

// ── ID Generators ────────────────────────────────────────────────────────

let recognitionCounter = 0;

function nextRecognitionId(): string {
  recognitionCounter++;
  return `rec-${String(recognitionCounter).padStart(4, '0')}`;
}

/** Reset the ID counter (for testing). */
export function resetRecognitionCounter(): void {
  recognitionCounter = 0;
}

// ── Tracing Helpers ──────────────────────────────────────────────────────

function toTrace(result: PatternEvalResult): PatternMatchTrace[] {
  return result.conditionResults.map((cr) => ({
    condition: cr.condition,
    matched: cr.matched,
    actualValue: cr.actualValue,
    contribution: cr.contribution,
  }));
}

function toClosestMatch(result: PatternEvalResult): ClosestPatternMatch {
  return {
    pattern: result.pattern,
    matchedConditions: result.matchedCount,
    totalConditions: result.totalConditions,
    confidence: result.confidence,
  };
}

// ── Candidate Evaluation ─────────────────────────────────────────────────

/**
 * Evaluate a single candidate against all patterns.
 *
 * Returns the best match (highest confidence among all-conditions-met patterns)
 * or the closest partial match if none fully matched.
 */
function evaluateCandidate(
  candidate: InteractionCandidate,
  patterns: PatternDefinition[],
): { result: PatternEvalResult | null; closest: PatternEvalResult | null } {
  let bestMatch: PatternEvalResult | null = null;
  let closest: PatternEvalResult | null = null;
  let closestScore = -1;

  for (const pattern of patterns) {
    const evalResult = evaluatePattern(pattern, candidate);

    // Track closest partial match (highest confidence regardless of all-conditions-met)
    if (evalResult.confidence > closestScore) {
      closestScore = evalResult.confidence;
      closest = evalResult;
    }

    // First match that satisfies ALL conditions AND is above threshold
    if (
      evalResult.allConditionsMet &&
      evalResult.confidence >= pattern.confidenceThreshold
    ) {
      // First-match-wins (patterns are ordered by specificity)
      if (!bestMatch) {
        bestMatch = evalResult;
      }
    }
  }

  return { result: bestMatch, closest };
}

// ── Result Builders ──────────────────────────────────────────────────────

function buildRecognised(
  candidate: InteractionCandidate,
  evalResult: PatternEvalResult,
): RecognisedInteraction {
  const batchIds: BatchId[] = candidate.batches.map((b) => b.id);

  return {
    id: nextRecognitionId(),
    kind: 'recognised' as const,
    verb: evalResult.pattern.verb,
    componentType: evalResult.pattern.componentType ?? 'Generic',
    matchedPattern: evalResult.pattern,
    confidence: evalResult.confidence,
    sourceBatches: batchIds,
    timestamp: candidate.startedAt,
    description: evalResult.pattern.description,
    evidenceTrace: toTrace(evalResult),
  };
}

function buildUnrecognised(
  candidate: InteractionCandidate,
  closest: PatternEvalResult | null,
  reason: UnrecognisedInteraction['reason'],
): UnrecognisedInteraction {
  const batchIds: BatchId[] = candidate.batches.map((b) => b.id);

  // Infer the attempted verb from the event sequence
  const attemptedVerb = inferAttemptedVerb(candidate);

  // Collect raw evidence for diagnostics
  const evidence = candidate.batches.flatMap((b) => b.evidence);

  return {
    id: nextRecognitionId(),
    kind: 'unrecognised' as const,
    reason,
    sourceBatches: batchIds,
    timestamp: candidate.startedAt,
    attemptedVerb,
    closestMatch: closest ? toClosestMatch(closest) : null,
    evidence,
  };
}

/**
 * Infer the likely interaction verb from the event sequence.
 *
 * This is used for diagnostics — it helps the developer understand what
 * the user tried to do even if no pattern matched.
 */
function inferAttemptedVerb(candidate: InteractionCandidate): InteractionVerb | null {
  const events = candidate.eventSequence;

  if (events.includes('scroll')) return 'scroll';
  if (events.includes('input')) return 'fill';
  if (events.includes('change')) return 'select';
  if (events.includes('click')) return 'click';
  if (events.includes('mouseenter')) return 'hover';
  if (events.includes('keydown')) return 'pressKey';
  if (events.includes('navigation')) return 'navigate';

  return 'unknown';
}

/**
 * Determine why a candidate was not recognised.
 */
function determineRejectionReason(
  closest: PatternEvalResult | null,
): UnrecognisedInteraction['reason'] {
  if (!closest) {
    // No pattern was even partially relevant
    return 'no_pattern_matched';
  }

  if (closest.allConditionsMet && closest.confidence < closest.pattern.confidenceThreshold) {
    // All conditions met but confidence too low
    return 'confidence_below_threshold';
  }

  if (!closest.allConditionsMet && closest.matchedCount > 0) {
    // Some but not all conditions matched
    return 'no_pattern_matched';
  }

  return 'no_pattern_matched';
}

// ── Pipeline Entry Point ─────────────────────────────────────────────────

/**
 * Run the recognition pipeline on a set of EvidenceBatches.
 *
 * @param batches Raw evidence batches from the EventTap / delivery coordinator
 * @param options Optional configuration (custom patterns)
 * @returns RecognitionOutput with recognised and unrecognised interactions
 */
export function recogniseInteractions(
  batches: EvidenceBatch[],
  options?: RecognitionOptions,
): RecognitionOutput {
  const patterns = options?.patterns ?? getAllPatterns();
  const errors: RecognitionOutput['errors'] = [];

  // Stage 1: Group batches into interaction candidates
  let candidates: InteractionCandidate[];
  try {
    candidates = groupBatches(batches);
  } catch (err) {
    return {
      results: [],
      batchCount: batches.length,
      candidateCount: 0,
      recognisedCount: 0,
      unrecognisedCount: batches.length,
      matchedPatternIds: [],
      completedAt: new Date().toISOString(),
      errors: [{
        message: `Event grouping failed: ${err instanceof Error ? err.message : String(err)}`,
        batchId: null,
        timestamp: new Date().toISOString(),
      } satisfies RecognitionError],
    };
  }

  // Stage 2: Evaluate each candidate
  const results: RecognitionResult[] = [];
  const matchedPatternIds = new Set<string>();

  for (const candidate of candidates) {
    try {
      const { result, closest } = evaluateCandidate(candidate, patterns);

      if (result) {
        // Recognised
        matchedPatternIds.add(result.pattern.id);
        results.push(buildRecognised(candidate, result));
      } else {
        // Not recognised
        const reason = determineRejectionReason(closest);
        results.push(buildUnrecognised(candidate, closest, reason));
      }
    } catch (err) {
      // Non-fatal: record the error and mark the candidate as unrecognised
      errors.push({
        message: `Pattern evaluation failed for candidate ${candidate.primaryBatchId}: ${err instanceof Error ? err.message : String(err)}`,
        batchId: candidate.primaryBatchId,
        timestamp: new Date().toISOString(),
      } satisfies RecognitionError);
      results.push(
        buildUnrecognised(candidate, null, 'error'),
      );
    }
  }

  // Stage 3: Temporal dedup (Phase 5b)
  // Suppress duplicate interactions within the dedup window.
  let finalResults = results;
  let dedupSuppressed = 0;
  const enableDedup = options?.enableDedup ?? true;
  if (enableDedup && results.length > 0) {
    const batchMap = new Map(batches.map(b => [b.id, b]));
    const dedup = new TemporalDedup();
    finalResults = results.filter(result => {
      const batch = batchMap.get(result.sourceBatches[0] ?? '');
      if (dedup.isDuplicate(result, batch)) {
        dedupSuppressed++;
        return false;
      }
      return true;
    });
  }

  const finalRecognised = finalResults.filter((r) => r.kind === 'recognised').length;
  const finalUnrecognised = finalResults.filter((r) => r.kind === 'unrecognised').length;

  return {
    results: finalResults,
    batchCount: batches.length,
    candidateCount: candidates.length,
    recognisedCount: finalRecognised,
    unrecognisedCount: finalUnrecognised,
    dedupSuppressed,
    matchedPatternIds: [...matchedPatternIds],
    completedAt: new Date().toISOString(),
    errors,
  };
}
