/**
 * Generation Types — types specific to the Artifact Generation Engine.
 *
 * Milestone B3 (v4.1.0) — Foundation
 *
 * These types define the contracts that generators communicate through.
 * No generator imports another generator's internal types.
 */

import type {
  ElementIdentity,
  AIUnderstanding,
} from '../shared/types';
import type { ExecutionJsonObject } from './contracts/execution-json-types';

/**
 * A Canonical Test Step — the interpreted, structured representation
 * of one interaction from the timeline.
 *
 * This is the SOURCE OF TRUTH per B1/B2. Execution JSON and Playwright
 * are derived from this.
 *
 * In B3, executionJson is null — it will be populated by the
 * Execution JSON Generator in B4.
 */
export interface CanonicalStep {
  /** Unique sequential step ID, e.g. "step-0001". */
  stepId: string;
  /** Sequential step number (1-based). */
  stepNumber: number;
  /** Action type: "click", "navigation", etc. */
  actionType: string;
  /** Human-readable description (plain English). */
  plainEnglish: string;
  /** Element identity projected from the source interaction (immutable). */
  elementIdentity: ElementIdentity;
  /** AI enrichment projected from the source interaction. Null if AI failed. */
  aiEnrichment: AIUnderstanding | null;
  /** AI confidence score (0.0–1.0). 0 if AI failed. */
  aiConfidence: number;
  /** Linked interaction actionId, e.g. "click-0001". */
  linkedInteractionId: string;
  /**
   * Text value for text-entry interactions. Null for non-text actions.
   * Carries the user-entered value from the recording layer through
   * to the Execution JSON and Playwright generators.
   */
  value: string | null;
  /**
   * Checkbox state for checkbox interactions. Null for non-checkbox actions.
   * Carries the resulting checked state from the recording layer through
   * to the Execution JSON Generator, which uses it to determine whether
   * the execution verb is "check" (checked=true) or "uncheck" (checked=false).
   * Mirrors how `value` carries text-entry data.
   */
  checked: boolean | null;
  /**
   * Execution JSON. Null before generation (B3).
   * Populated by the Execution JSON Generator (B5.3).
   */
  executionJson: ExecutionJsonObject | null;
  /** Generation timestamp. */
  timestamp: string;
}

/**
 * Result returned by every generator.
 *
 * B2 AP3: Generators are pure functions. They never throw — they
 * return a GeneratorResult that encodes success, partial, or failure.
 */
export interface GeneratorResult<T> {
  /** Status of the generation. */
  status: 'success' | 'partial' | 'failure';
  /** The output (null on complete failure). */
  output: T | null;
  /** Errors encountered during generation. */
  errors: GeneratorError[];
}

/**
 * A single error from a generator.
 */
export interface GeneratorError {
  /** Which step failed (null = whole pipeline). */
  stepIndex: number | null;
  /** Human-readable error message. */
  message: string;
  /** Whether retrying might fix this. */
  recoverable: boolean;
}

/**
 * Result of a full generation pipeline run.
 */
export interface GenerationResult {
  /** Overall status. */
  status: 'success' | 'partial' | 'failure';
  /** Generated canonical steps (null on complete failure). */
  steps: CanonicalStep[] | null;
  /** Errors from all generators. */
  errors: GeneratorError[];
  /** Timestamp of generation completion. */
  generatedAt: string;
}
