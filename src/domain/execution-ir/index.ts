/**
 * Execution IR — public API barrel export.
 *
 * The framework-neutral execution contract. Re-exports all types, the
 * generator, and adapter interfaces.
 */

// Types
export {
  IRAction,
  DEFAULT_EXECUTION_PARAMETERS,
} from './types';

export type {
  ResolvedLocator,
  ResolvedTarget,
  ElementTarget,
  UrlTarget,
  NoTarget,
  IRAssertion,
  ExecutionParameters,
  IRInput,
  IRStep,
  IREnvironment,
  ExecutionIRPlan,
  RenderingEngine,
  RenderingFormat,
  Rendering,
  ExecutionIRArtifact,
} from './types';

// Staleness
export {
  checkStaleness,
  detectLocatorChanges,
} from './staleness';

export type {
  IRStalenessStatus,
  IRStalenessReport,
  StalenessReason,
  LocatorDiff,
} from './staleness';

// Generator
export {
  DefaultIRGenerator,
  GENERATOR_VERSION,
  mapStepActionToIRAction,
  resolveElementTarget,
} from './generator';

export type { IRGenerator } from './generator';

// Adapter interfaces
export type {
  IRExecutor,
  IRExecutionOptions,
  IRExecutionResult,
  IRStepResult,
  IRAssertionResult,
  IRCodeGenerator,
  GeneratorConfig,
  GenerationResult,
  GeneratedFile,
} from './adapters';
