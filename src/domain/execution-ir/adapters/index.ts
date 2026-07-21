/**
 * Execution IR Adapters — public API barrel export.
 *
 * These are the two consumer interfaces for the Execution IR:
 *   - IRExecutor      — executes the IR against a live browser
 *   - IRCodeGenerator — renders the IR into source files
 *
 * Both consume the same ExecutionIRPlan. They never receive the ATC,
 * Element Repository, or Environment Profile.
 */

export type { IRExecutor, IRExecutionOptions, IRExecutionResult, IRStepResult, IRAssertionResult } from './ir-executor';
export type { IRCodeGenerator, GeneratorConfig, GenerationResult, GeneratedFile } from './ir-code-generator';
