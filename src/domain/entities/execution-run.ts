/**
 * ExecutionRun — a persisted record of a single test case execution.
 *
 * Wraps IRExecutionResult with run-level metadata: which test case was
 * executed, what environment was used, and which elements were healed
 * during the run.
 *
 * ExecutionRuns are append-only — each execution creates a new run.
 * They are queryable by testCaseVersionId and projectId for history.
 */

import type { IRExecutionResult, IRStepResult } from '../execution-ir/adapters/ir-executor';

/** Result of a single assertion evaluation during execution. */
export interface ExecutionAssertionResult {
  readonly type: string;
  readonly comparison: string;
  readonly expectedValue: unknown;
  readonly actualValue: unknown;
  readonly passed: boolean;
  readonly severity: 'hard' | 'soft';
  readonly message: string;
}

/** Result of a single step during execution. */
export interface ExecutionStepResult {
  readonly stepId: string;
  readonly stepOrder: number;
  readonly action: string;
  readonly description: string;
  readonly status: 'passed' | 'failed' | 'error' | 'skipped';
  readonly durationMs: number;
  readonly assertionResults: ExecutionAssertionResult[];
  /** True if this step's target element was healed during execution. */
  readonly healed: boolean;
  /** Base64 PNG screenshot (failures only). */
  readonly screenshot?: string;
  readonly error?: {
    readonly message: string;
    readonly type: string;
  };
}

/** Environment snapshot at execution time. */
export interface ExecutionEnvironment {
  readonly baseUrl: string;
  readonly browser: string;
  readonly viewport: { readonly width: number; readonly height: number };
}

/**
 * A persisted execution run.
 *
 * Immutable after creation. Append-only — each execution creates a new run.
 */
export interface ExecutionRun {
  /** Unique identifier (UUID). */
  readonly id: string;
  /** Which test case this run executed. */
  readonly testCaseId: string;
  /** Which test case version this run executed. */
  readonly testCaseVersionId: string;
  /** Project this run belongs to. */
  readonly projectId: string;
  /** Final execution status. */
  readonly status: 'passed' | 'failed' | 'error' | 'aborted';
  /** ISO timestamp when execution started. */
  readonly startedAt: string;
  /** ISO timestamp when execution completed. */
  readonly completedAt: string;
  /** Total execution duration in milliseconds. */
  readonly durationMs: number;
  /** Per-step results. */
  readonly stepResults: ExecutionStepResult[];
  /** Environment used during execution. */
  readonly environment: ExecutionEnvironment;
  /** Element IDs that were healed during this run. */
  readonly healedElementIds: string[];
}

// ── Factory ────────────────────────────────────────────────

export interface CreateExecutionRunInput {
  readonly testCaseId: string;
  readonly testCaseVersionId: string;
  readonly projectId: string;
  readonly result: IRExecutionResult;
  readonly environment: ExecutionEnvironment;
  readonly healedElementIds: string[];
  /** Optional screenshots keyed by stepId. */
  readonly screenshots?: Record<string, string>;
}

/**
 * Create an ExecutionRun from an IRExecutionResult.
 *
 * Maps the executor's transient result types to the persistent
 * ExecutionRun shape, adding run-level metadata.
 */
export function createExecutionRun(input: CreateExecutionRunInput): ExecutionRun {
  if (!input.testCaseId?.trim()) {
    throw new Error('ExecutionRun requires testCaseId');
  }
  if (!input.testCaseVersionId?.trim()) {
    throw new Error('ExecutionRun requires testCaseVersionId');
  }
  if (!input.projectId?.trim()) {
    throw new Error('ExecutionRun requires projectId');
  }

  const stepResults = input.result.stepResults.map((sr: IRStepResult, index: number) => {
    const stepResult: ExecutionStepResult = {
      stepId: sr.stepId,
      stepOrder: index + 1,
      action: '', // Populated by caller from the IR plan
      description: '',
      status: sr.status,
      durationMs: sr.durationMs,
      assertionResults: sr.assertionResults.map((ar) => ({
        type: String(ar.type),
        comparison: '',
        expectedValue: ar.expectedValue,
        actualValue: ar.actualValue,
        passed: ar.passed,
        severity: 'hard' as const,
        message: ar.message,
      })),
      healed: false,
      screenshot: input.screenshots?.[sr.stepId],
      error: sr.error
        ? { message: sr.error.message, type: sr.error.type }
        : undefined,
    };
    return stepResult;
  });

  return {
    id: crypto.randomUUID(),
    testCaseId: input.testCaseId.trim(),
    testCaseVersionId: input.testCaseVersionId.trim(),
    projectId: input.projectId.trim(),
    status: input.result.status,
    startedAt: input.result.startedAt,
    completedAt: input.result.completedAt,
    durationMs: input.result.durationMs,
    stepResults,
    environment: input.environment,
    healedElementIds: input.healedElementIds,
  };
}
