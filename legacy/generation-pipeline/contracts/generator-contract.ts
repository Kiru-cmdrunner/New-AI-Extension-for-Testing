/**
 * Generator Contracts — published input/output contracts for every generator.
 *
 * Milestone B3 (v4.1.0) — Foundation
 *
 * B2 AP11: Generators communicate only through published contracts.
 * No generator imports another generator's internal implementation.
 * No generator assumes another generator's internal representation.
 */

import type {
  SessionEvent,
  RecordingContext,
} from '../../shared/types';
import type { CanonicalStep, GeneratorResult } from '../types';
import type { ClassifiedInteraction } from '../../shared/architecture-types';

// ── Canonical Step Generator Contract ──────────────────────

/**
 * Input contract for the Canonical Step Generator.
 * B2 §3.2: Takes the frozen Interaction Timeline and Recording Context.
 *
 * Phase 3 Integration Step 1: The generator now receives `classified` —
 * the output of Stage 3a (Semantic Classifier). When provided, the
 * generator uses `canonicalType` for the step's actionType instead of
 * the raw event.type. This field is additive — `timeline` remains for
 * backward compatibility and for generators that haven't migrated yet.
 */
export interface CanonicalStepGeneratorInput {
  /** Frozen interaction timeline (immutable input). */
  timeline: SessionEvent[];
  /** Recording context (start URL, title, timestamp). */
  recordingContext: RecordingContext;
  /**
   * Stage 3a output — one ClassifiedInteraction per timeline event.
   * When provided, the generator uses canonicalType as actionType.
   * Phase 3 Integration Step 1.
   */
  classified?: ClassifiedInteraction[];
}

/**
 * Output contract for the Canonical Step Generator.
 * B2 §3.2: Produces CanonicalStep[] with executionJson = null.
 */
export type CanonicalStepGeneratorOutput = CanonicalStep[];

// ── Execution JSON Generator Contract (B5.3 — implemented) ─

/**
 * Input contract for the Execution JSON Generator.
 * B2 §3.3 / B5.1 §3.1: Takes canonical steps (with executionJson = null).
 */
export interface ExecutionJsonGeneratorInput {
  /** Steps with executionJson = null. */
  steps: CanonicalStep[];
}

/**
 * Output contract for the Execution JSON Generator.
 * B2 §3.3 / B5.1 §3.2: Steps with executionJson populated per B5.2 contract.
 */
export type ExecutionJsonGeneratorOutput = CanonicalStep[];

// ── Playwright Generator Contract (B5 — defined here, implemented later) ────

/**
 * Input contract for the Playwright Generator.
 * B2 §3.4: Takes steps with JSON, recording context, and TC metadata.
 */
export interface PlaywrightGeneratorInput {
  /** Steps with executionJson populated. */
  steps: CanonicalStep[];
  /** Recording context (becomes page.goto()). */
  recordingContext: RecordingContext;
  /** Test case name (becomes test() name). */
  testCaseName: string;
  /** Optional expected result. */
  expectedResult?: string;
}

/**
 * Output contract for the Playwright Generator.
 */
export interface PlaywrightGeneratorOutput {
  /** Complete TypeScript Playwright test string. */
  testCode: string;
  /** Always false on fresh generation. */
  isManualEdit: false;
  /** ISO timestamp of generation. */
  generatedAt: string;
}

// ── Generic Generator Contract ─────────────────────────────

/**
 * The generic contract that every generator implements.
 *
 * This is the interface the Generation Engine uses to invoke generators.
 * It is intentionally generic so that future generators (Cypress, Selenium,
 * Cucumber) can implement it without modification.
 *
 * B2 AP1: Single responsibility per generator.
 * B2 AP3: Pure function — input in, output out, no side effects.
 * B2 AP7: Extension by addition — new generators register, not modify.
 */
export interface GeneratorContract<TInput = unknown, TOutput = unknown> {
  /** Unique generator name, e.g. "canonical-step-generator". */
  name: string;

  /** Names of generators that must complete before this one. Empty = runs first. */
  dependencies: string[];

  /**
   * Execute the generator.
   *
   * Must be a pure function: same input → same output, no side effects,
   * no storage writes, no AI calls, no external state reads.
   * Never throws — returns a GeneratorResult.
   */
  generate(input: TInput): GeneratorResult<TOutput>;
}
