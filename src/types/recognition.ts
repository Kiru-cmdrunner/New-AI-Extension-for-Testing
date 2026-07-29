/**
 * Recognition Pipeline Types — Phase 1
 *
 * Types for the recognition stage of the target pipeline.
 *
 * The recognition pipeline consumes EvidenceBatches and produces
 * RecognitionResults — either RecognisedInteractions (successfully matched
 * against a declarative pattern) or UnrecognisedInteractions (no pattern
 * matched or confidence was below threshold).
 *
 * Data flow:
 *
 *   EvidenceBatch[]
 *     → EventGrouper: merges related batches into interaction candidates
 *     → RecognitionPipeline: pattern matching + confidence gate
 *     → RecognitionResult[] (RecognisedInteraction | UnrecognisedInteraction)
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch, BatchId } from './evidence';
import type { InteractionVerb, ComponentType, PatternDefinition } from './foundation';

// ── Recognition Result ───────────────────────────────────────────────────

/**
 * Unique identifier for a recognised interaction.
 */
export type InteractionId = string;

/**
 * Why an interaction was not recognised.
 */
export type UnrecognisedReason =
  | 'no_pattern_matched'        // No pattern's conditions were satisfied
  | 'confidence_below_threshold' // Pattern matched but confidence was too low
  | 'ambiguous_match'           // Multiple patterns matched equally
  | 'grouping_failed'           // EventGrouper could not form a coherent interaction
  | 'target_unresolved'         // Target element could not be identified
  | 'error'                     // Exception during recognition

// ── Recognised Interaction ───────────────────────────────────────────────

/**
 * A successfully recognised interaction.
 *
 * Produced when the recognition pipeline finds a pattern whose conditions
 * are all satisfied and whose aggregate confidence meets the threshold.
 */
export interface RecognisedInteraction {
  /** Unique sequential interaction ID within the session. */
  id: InteractionId;
  /** Discriminator: always 'recognised'. */
  kind: 'recognised';
  /** The interaction verb assigned by the matched pattern. */
  verb: InteractionVerb;
  /** The component type this interaction targets, if determined. */
  componentType: ComponentType | null;
  /** The pattern definition that matched this interaction. */
  matchedPattern: PatternDefinition;
  /** Confidence in this recognition [0, 1]. */
  confidence: number;
  /** The evidence batch (or merged group) that produced this interaction. */
  sourceBatches: BatchId[];
  /** ISO timestamp of the interaction (from the primary event). */
  timestamp: string;
  /** Human-readable description of what the user did. */
  description: string;
  /** Evidence trace: which conditions matched and their individual contributions. */
  evidenceTrace: PatternMatchTrace[];
}

/**
 * Trace of a single pattern condition match.
 */
export interface PatternMatchTrace {
  /** The condition that was evaluated. */
  condition: PatternDefinition['conditions'][number];
  /** Whether the condition was satisfied. */
  matched: boolean;
  /** The actual value found in the evidence. */
  actualValue: unknown;
  /** Confidence contribution of this condition [0, 1]. */
  contribution: number;
}

// ── Unrecognised Interaction ─────────────────────────────────────────────

/**
 * An interaction that the pipeline could not recognise.
 *
 * These are NOT discarded — they are preserved for later review, manual
 * classification, or pattern refinement. The output stage includes them
 * in the RecordingArtifact as a diagnostic.
 */
export interface UnrecognisedInteraction {
  /** Unique sequential interaction ID within the session. */
  id: InteractionId;
  /** Discriminator: always 'unrecognised'. */
  kind: 'unrecognised';
  /** Why recognition failed. */
  reason: UnrecognisedReason;
  /** The evidence batch (or merged group) that produced this interaction. */
  sourceBatches: BatchId[];
  /** ISO timestamp of the interaction. */
  timestamp: string;
  /** What was attempted (human-readable). */
  attemptedVerb: InteractionVerb | null;
  /** Closest pattern match, if any (for diagnostic purposes). */
  closestMatch: ClosestPatternMatch | null;
  /** All evidence records from the source batches. */
  evidence: EvidenceBatch['evidence'];
}

/**
 * The closest pattern match for an unrecognised interaction.
 *
 * Captured for diagnostics and pattern refinement.
 */
export interface ClosestPatternMatch {
  /** The pattern that came closest to matching. */
  pattern: PatternDefinition;
  /** Number of conditions that matched out of total. */
  matchedConditions: number;
  /** Total conditions in the pattern. */
  totalConditions: number;
  /** Aggregate confidence achieved (below threshold). */
  confidence: number;
}

// ── Recognition Result Union ─────────────────────────────────────────────

/**
 * Result of recognising an interaction candidate.
 *
 * Either recognised (pattern matched) or unrecognised (no match or
 * confidence too low).
 */
export type RecognitionResult = RecognisedInteraction | UnrecognisedInteraction;

/**
 * Type guard: is a RecognitionResult recognised?
 */
export function isRecognised(r: RecognitionResult): r is RecognisedInteraction {
  return r.kind === 'recognised';
}

/**
 * Type guard: is a RecognitionResult unrecognised?
 */
export function isUnrecognised(r: RecognitionResult): r is UnrecognisedInteraction {
  return r.kind === 'unrecognised';
}

// ── Recognition Output ───────────────────────────────────────────────────

/**
 * Complete output of the recognition pipeline stage.
 *
 * Contains all recognised and unrecognised interactions from a recording,
 * plus metadata about the recognition process.
 */
export interface RecognitionOutput {
  /** All recognition results (recognised + unrecognised). */
  results: RecognitionResult[];
  /** Number of evidence batches consumed. */
  batchCount: number;
  /** Number of interaction candidates after grouping. */
  candidateCount: number;
  /** Number of recognised interactions. */
  recognisedCount: number;
  /** Number of unrecognised interactions. */
  unrecognisedCount: number;
  /** Number of duplicate interactions suppressed by temporal dedup. */
  dedupSuppressed?: number;
  /** Patterns that matched at least once. */
  matchedPatternIds: string[];
  /** ISO timestamp of when recognition completed. */
  completedAt: string;
  /** Any errors encountered (non-fatal). */
  errors: RecognitionError[];
}

/**
 * A non-fatal error during recognition.
 */
export interface RecognitionError {
  /** Error message. */
  message: string;
  /** Batch ID that caused the error, if applicable. */
  batchId: BatchId | null;
  /** ISO timestamp of the error. */
  timestamp: string;
}
