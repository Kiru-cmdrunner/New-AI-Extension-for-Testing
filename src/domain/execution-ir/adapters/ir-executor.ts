/**
 * IRExecutor Interface — execution-ir-design.md §4.1
 *
 * "Run this now" — the executor receives an IR plan plus runtime options and
 * executes it against a live browser environment. Returns structured results
 * (step results, assertion results, timing, evidence references).
 *
 * The CmdRunner Runtime is the V1 (and possibly only) executor.
 */

import type { ExecutionIRPlan, IRStep } from '../types';
import type { ValidationType } from '../../enums';

// ── Executor Interface ────────────────────────────────────

export interface IRExecutor {
  /**
   * Execute an IR plan against a live browser environment.
   *
   * @param plan    The execution IR plan.
   * @param options Runtime options (credentials, overrides, progress callbacks).
   * @returns       Structured execution results.
   */
  execute(
    plan: ExecutionIRPlan,
    options?: IRExecutionOptions,
  ): Promise<IRExecutionResult>;
}

// ── Options ───────────────────────────────────────────────

export interface IRExecutionOptions {
  /** Runtime credentials, if needed by the test flow. */
  readonly credentials?: Record<string, string>;
  /** Override execution parameters globally for this run. */
  readonly parameterOverrides?: Partial<IRStep['executionParameters']>;
  /** Callback fired before each step begins. */
  readonly onStepStart?: (step: IRStep) => void;
  /** Callback fired after each step completes (pass or fail). */
  readonly onStepComplete?: (step: IRStep, result: IRStepResult) => void;
}

// ── Results ───────────────────────────────────────────────

export interface IRExecutionResult {
  readonly status: 'passed' | 'failed' | 'error';
  readonly stepResults: IRStepResult[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface IRStepResult {
  readonly stepId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'skipped';
  readonly durationMs: number;
  readonly assertionResults: IRAssertionResult[];
  readonly actualValue?: unknown;
  readonly error?: {
    readonly message: string;
    readonly type: string;
    readonly stack?: string;
  };
}

export interface IRAssertionResult {
  readonly type: ValidationType;
  readonly passed: boolean;
  readonly actualValue?: unknown;
  readonly expectedValue?: unknown;
  readonly message: string;
}
