/**
 * Repository V2 — Public API for the new domain-model repository layer.
 *
 * Re-exports all interfaces and types. Consumers depend on these interfaces,
 * not on any specific storage implementation.
 */

// Interfaces
export type { ProjectRepository, UpdateProjectInput } from './interfaces/project-repository';
export type { ElementRepository } from './interfaces/element-repository';
export type { SourceArtifactRepository } from './interfaces/source-artifact-repository';
export type { ExecutionIRRepository } from './interfaces/execution-ir-repository';
export type {
  TestCaseRepository,
  UpdateTestCaseMetadataInput,
  CreateTestCaseResult,
} from './interfaces/test-case-repository';
export type { UnitOfWork, RepositorySet, UnitOfWorkFactory } from './interfaces/unit-of-work';
export type { ExecutionRunRepository } from './interfaces/execution-run-repository';

// Domain entities
export type { ExecutionRun, ExecutionStepResult, ExecutionAssertionResult, ExecutionEnvironment } from '../../domain/entities/execution-run';

// Dexie implementation (V1)
export { DexieUnitOfWorkFactory } from './dexie/dexie-unit-of-work-factory';
export type { CmdRunnerDatabase } from './dexie/dexie-database';
