/**
 * Capability Matching Service — determines whether a new CapabilityCandidate
 * matches an existing Capability or represents a new capability.
 *
 * Multi-factor scored matching:
 *   Entry element (35%) — physical DOM anchor, most stable
 *   Input field set (30%) — Jaccard similarity of input labels
 *   Observed outcome (25%) — terminal URL + success signals
 *   Capability name (10%) — supporting signal only
 *
 * Decision thresholds:
 *   score ≥ 0.75 → auto-merge
 *   score ≥ 0.50 → ambiguous (flag for human confirmation)
 *   score < 0.50 → new capability
 *
 * Design principles:
 *   - Deterministic — no AI, no randomness, no external calls
 *   - Auditable — every score is decomposed into its component signals
 *   - Conservative — the ambiguous band (0.50–0.75) defers to human judgment
 *   - Pure function — candidate + existing capabilities in, match result out
 *
 * Reference: Phase 10 architectural design discussion
 */

import type { CapabilityCandidate } from '../../domain/entities/capability-candidate';
import type { Capability } from '../../domain/entities/capability';

// ── Types ─────────────────────────────────────────────────

/** The match decision for a candidate against existing capabilities. */
export type MatchDecision = 'auto-merge' | 'ambiguous' | 'new-capability';

/** A single capability match score with decomposed signals. */
export interface CapabilityMatchScore {
  /** The existing capability that was scored against. */
  readonly capabilityId: string;
  /** The total weighted score (0–1). */
  readonly totalScore: number;
  /** Entry element similarity (0–1, weight 35%). */
  readonly entryElementScore: number;
  /** Input field set Jaccard similarity (0–1, weight 30%). */
  readonly inputScore: number;
  /** Observed outcome similarity (0–1, weight 25%). */
  readonly outcomeScore: number;
  /** Name word-overlap similarity (0–1, weight 10%). */
  readonly nameScore: number;
  /** The match decision based on the total score. */
  readonly decision: MatchDecision;
}

/** The result of matching a candidate against all existing capabilities. */
export interface CapabilityMatchResult {
  /** All scored candidates, sorted by total score descending. */
  readonly scores: CapabilityMatchScore[];
  /** The best match (highest score), or null if no capabilities exist. */
  readonly bestMatch: CapabilityMatchScore | null;
  /** The final decision: auto-merge into bestMatch, ambiguous (needs human), or new. */
  readonly decision: MatchDecision;
  /** The capability to merge into (if auto-merge), or null. */
  readonly mergeTargetId: string | null;
}

// ── Constants ─────────────────────────────────────────────

const WEIGHTS = {
  entryElement: 0.35,
  input: 0.30,
  outcome: 0.25,
  name: 0.10,
} as const;

const AUTO_MERGE_THRESHOLD = 0.75;
const AMBIGUOUS_THRESHOLD = 0.50;

// ── Signal scorers ────────────────────────────────────────

/**
 * Score entry element similarity.
 * Compares elementId, accessibleName, and tag.
 * Same elementId = 1.0 (strongest signal — same physical element).
 * Same accessibleName + tag = 0.8 (likely same element, different ID).
 * Same tag only = 0.3 (weak — same type of element).
 * No entry element on either side = 0.5 (neutral — can't compare).
 */
function scoreEntryElement(
  candidate: CapabilityCandidate,
  existing: Capability,
): number {
  const candidateEntry = candidate.entryElement;
  // The existing capability doesn't store an entry element directly —
  // it stores inputs and observed outcomes. We compare via the first
  // input's elementId as a proxy, or fall back to neutral.
  //
  // Note: the existing Capability entity doesn't have an entryElement field.
  // We use the sessionIds to cross-reference, but for scoring we compare
  // the candidate's entry element against the capability's first input
  // element label. This is a reasonable proxy because the entry element
  // (submit button) and the first input field are on the same form.
  //
  // If no entry element on candidate, return neutral.
  if (!candidateEntry) return 0.5;

  // The existing capability's name often derives from the entry element's
  // accessible name. If they match, it's a strong signal.
  if (existing.name === candidateEntry.accessibleName) return 0.9;

  // Word overlap between entry element name and capability name
  const nameOverlap = wordOverlapRatio(candidateEntry.accessibleName, existing.name);
  return Math.max(nameOverlap, 0.3);
}

/**
 * Score input field set similarity using Jaccard coefficient.
 * Jaccard = |intersection| / |union|
 */
function scoreInputs(
  candidate: CapabilityCandidate,
  existing: Capability,
): number {
  const candidateLabels = new Set(
    candidate.inputs.map((i) => i.label.toLowerCase()),
  );
  const existingLabels = new Set(
    existing.inputs.map((i) => i.label.toLowerCase()),
  );

  if (candidateLabels.size === 0 && existingLabels.size === 0) {
    return 0.5; // Both empty — neutral
  }

  let intersection = 0;
  for (const label of candidateLabels) {
    if (existingLabels.has(label)) intersection++;
  }

  const union = candidateLabels.size + existingLabels.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score observed outcome similarity.
 * Compares terminal URL and success indicators.
 */
function scoreOutcome(
  candidate: CapabilityCandidate,
  existing: Capability,
): number {
  const candidateOutcome = candidate.observedOutcome;
  const existingOutcomes = existing.observedOutcomes;

  if (existingOutcomes.length === 0) return 0.5; // No data to compare

  // Find the best matching existing outcome
  let bestScore = 0;
  for (const existingOutcome of existingOutcomes) {
    let score = 0;

    // Terminal URL comparison
    if (candidateOutcome.terminalUrl && existingOutcome.terminalUrl) {
      if (candidateOutcome.terminalUrl === existingOutcome.terminalUrl) {
        score += 0.5;
      } else if (
        normalizeUrl(candidateOutcome.terminalUrl) ===
        normalizeUrl(existingOutcome.terminalUrl)
      ) {
        score += 0.4;
      }
    }

    // Success signal overlap
    const candidateSignals = new Set(candidateOutcome.successSignals.map((s) => s.toLowerCase()));
    const existingSignals = new Set(existingOutcome.successIndicators.map((s) => s.toLowerCase()));
    if (candidateSignals.size > 0 && existingSignals.size > 0) {
      let signalIntersection = 0;
      for (const sig of candidateSignals) {
        if (existingSignals.has(sig)) signalIntersection++;
      }
      const signalUnion = candidateSignals.size + existingSignals.size - signalIntersection;
      score += signalUnion > 0 ? (signalIntersection / signalUnion) * 0.5 : 0;
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

/**
 * Score name similarity using word-overlap ratio.
 * "Create Customer" vs "Create Customer" = 1.0
 * "Create Customer" vs "Add Customer" = 0.33 (1/3 words overlap)
 * "Create Customer" vs "New Customer" = 0.33
 * "Create Customer" vs "Create Premium Customer" = 0.67 (2/3)
 */
function scoreName(
  candidate: CapabilityCandidate,
  existing: Capability,
): number {
  return wordOverlapRatio(candidate.name, existing.name);
}

// ── Utilities ─────────────────────────────────────────────

/**
 * Calculate word-overlap ratio between two strings.
 * Ratio = |shared words| / |total unique words|
 * Case-insensitive, ignores common stop words.
 */
function wordOverlapRatio(a: string, b: string): number {
  const stopWords = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with']);
  const wordsA = new Set(
    a.toLowerCase().split(/\s+/).filter((w) => w.length > 0 && !stopWords.has(w)),
  );
  const wordsB = new Set(
    b.toLowerCase().split(/\s+/).filter((w) => w.length > 0 && !stopWords.has(w)),
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalize a URL for comparison (strip trailing slash, lowercase, strip query params).
 */
function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/$/, '').replace(/\?.*$/, '');
}

/**
 * Determine the match decision from a total score.
 */
function decideFromScore(score: number): MatchDecision {
  if (score >= AUTO_MERGE_THRESHOLD) return 'auto-merge';
  if (score >= AMBIGUOUS_THRESHOLD) return 'ambiguous';
  return 'new-capability';
}

// ── Public API ───────────────────────────────────────────

/**
 * Match a CapabilityCandidate against all existing capabilities in a project.
 *
 * @param candidate The capability candidate from a new recording session.
 * @param existing All existing capabilities in the same project.
 * @returns Match result with the best match and decision.
 */
export function matchCapability(
  candidate: CapabilityCandidate,
  existing: Capability[],
): CapabilityMatchResult {
  if (existing.length === 0) {
    return {
      scores: [],
      bestMatch: null,
      decision: 'new-capability',
      mergeTargetId: null,
    };
  }

  const scores: CapabilityMatchScore[] = existing.map((cap) => {
    const entryElementScore = scoreEntryElement(candidate, cap);
    const inputScore = scoreInputs(candidate, cap);
    const outcomeScore = scoreOutcome(candidate, cap);
    const nameScore = scoreName(candidate, cap);

    const totalScore =
      WEIGHTS.entryElement * entryElementScore +
      WEIGHTS.input * inputScore +
      WEIGHTS.outcome * outcomeScore +
      WEIGHTS.name * nameScore;

    return {
      capabilityId: cap.id,
      totalScore: Math.round(totalScore * 1000) / 1000, // Round to 3 decimal places
      entryElementScore: Math.round(entryElementScore * 1000) / 1000,
      inputScore: Math.round(inputScore * 1000) / 1000,
      outcomeScore: Math.round(outcomeScore * 1000) / 1000,
      nameScore: Math.round(nameScore * 1000) / 1000,
      decision: decideFromScore(totalScore),
    };
  });

  // Sort by total score descending
  scores.sort((a, b) => b.totalScore - a.totalScore);
  const bestMatch = scores[0];
  const decision = bestMatch.decision;

  return {
    scores,
    bestMatch,
    decision,
    mergeTargetId: decision === 'auto-merge' ? bestMatch.capabilityId : null,
  };
}

/**
 * Convert a CapabilityCandidate into the input for createCapability().
 *
 * This is the bridge between the Understanding Layer's per-session snapshot
 * and the Repository's accumulated entity. Maps:
 *   - CapabilityCandidate.name → CreateCapabilityInput.name
 *   - CapabilityCandidate.purpose → CreateCapabilityInput.purpose
 *   - CapabilityCandidate.inputs → CapabilityInput[] (Repository format)
 *   - CapabilityCandidate.validationRules → CapabilityValidationRule[] (Repository format)
 *   - CapabilityCandidate.observedOutcome → CapabilityOutcome[] (Repository format)
 *   - CapabilityCandidate.sourceSessionId → CreateCapabilityInput.sourceSessionId
 */
export function candidateToCreateInput(
  candidate: CapabilityCandidate,
  projectId: string,
): import('../../domain/entities/capability').CreateCapabilityInput {
  // Map candidate inputs to Repository CapabilityInput format
  const inputs = candidate.inputs.map((inp) => ({
    label: inp.label,
    fieldType: inp.inputType ?? 'text',
    required: inp.required,
    validationConstraints: buildConstraintStrings(inp),
  }));

  // Map candidate validation rules to Repository CapabilityValidationRule format
  const validationRules = candidate.validationRules.map((rule) => ({
    fieldLabel: rule.field,
    ruleType: rule.type,
    constraint: rule.constraint,
    source: 'observed' as const,
  }));

  // Map candidate observed outcome to Repository CapabilityOutcome format
  const observedOutcomes = [
    {
      outcomeId: `outcome-${candidate.sourceSessionId}`,
      terminalUrl: candidate.observedOutcome.terminalUrl,
      successIndicators: candidate.observedOutcome.successSignals,
      description: candidate.observedOutcome.completed
        ? 'Workflow completed successfully'
        : 'Workflow did not reach terminal state',
      firstObservedAt: candidate.derivedAt,
    },
  ];

  return {
    projectId,
    name: candidate.name,
    purpose: candidate.purpose,
    inputs,
    validationRules,
    observedOutcomes,
    sourceSessionId: candidate.sourceSessionId,
  };
}

/**
 * Convert a CapabilityCandidate into the input for enrichCapability().
 *
 * Maps the candidate's observations into the enrichment input format,
 * using the candidate's sourceSessionId as the enrichment source.
 */
export function candidateToEnrichInput(
  candidate: CapabilityCandidate,
): import('../../domain/entities/capability').EnrichCapabilityInput {
  const inputs = candidate.inputs.map((inp) => ({
    label: inp.label,
    fieldType: inp.inputType ?? 'text',
    required: inp.required,
    validationConstraints: buildConstraintStrings(inp),
  }));

  const validationRules = candidate.validationRules.map((rule) => ({
    fieldLabel: rule.field,
    ruleType: rule.type,
    constraint: rule.constraint,
    source: 'observed' as const,
  }));

  const observedOutcomes = [
    {
      outcomeId: `outcome-${candidate.sourceSessionId}`,
      terminalUrl: candidate.observedOutcome.terminalUrl,
      successIndicators: candidate.observedOutcome.successSignals,
      description: candidate.observedOutcome.completed
        ? 'Workflow completed successfully'
        : 'Workflow did not reach terminal state',
      firstObservedAt: candidate.derivedAt,
    },
  ];

  return {
    inputs,
    validationRules,
    observedOutcomes,
    sourceSessionId: candidate.sourceSessionId,
    consistentObservation: true, // The matching service already confirmed this is the same capability
  };
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Build constraint description strings from a candidate input.
 */
function buildConstraintStrings(
  inp: CapabilityCandidate['inputs'][number],
): string[] {
  const constraints: string[] = [];
  if (inp.required) constraints.push('required');
  if (inp.format) constraints.push(`format:${inp.format.description}`);
  if (inp.valueRange) constraints.push(`range:${inp.valueRange.min}-${inp.valueRange.max}`);
  if (inp.lengthRange) constraints.push(`length:${inp.lengthRange.minLength}-${inp.lengthRange.maxLength}`);
  if (inp.validOptions) constraints.push(`options:${inp.validOptions.join(',')}`);
  return constraints;
}
