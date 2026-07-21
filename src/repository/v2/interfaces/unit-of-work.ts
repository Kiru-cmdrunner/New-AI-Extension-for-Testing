/**
 * Unit of Work Interface — transactional boundary for cross-repository operations.
 *
 * Several invariants require operations spanning multiple repositories to be
 * atomic (INV-ATC1: create ATC + version together; AI review: create elements
 * + ATC version together; INV-EL3: check references before deleting element).
 *
 * The Unit of Work manages the transaction boundary. The Dexie implementation
 * wraps Dexie's native transaction; a future API implementation wraps
 * server-side transactions.
 */

import type { ProjectRepository } from './project-repository';
import type { TestCaseRepository } from './test-case-repository';
import type { ElementRepository } from './element-repository';
import type { SourceArtifactRepository } from './source-artifact-repository';
import type { ExecutionIRRepository } from './execution-ir-repository';

/**
 * Unit of Work — provides access to repositories within a transactional scope.
 *
 * Usage:
 *   const result = await uow.execute(async (repos) => {
 *     const element = await repos.elements.create({ ... });
 *     const tc = await repos.testCases.create({ ... });
 *     return { element, tc };
 *   });
 *
 * All repository operations within the callback are atomic — either all
 * succeed or all are rolled back.
 */
export interface UnitOfWork {
  /**
   * Execute a function within a transactional scope.
   * All repository operations within the callback are atomic.
   * If the callback throws, the transaction is rolled back.
   * If it returns successfully, the transaction commits.
   */
  execute<T>(work: (repos: RepositorySet) => Promise<T>): Promise<T>;
}

/**
 * The set of repositories available within a Unit of Work transaction.
 * This is the only way to access repositories within a transaction.
 */
export interface RepositorySet {
  readonly projects: ProjectRepository;
  readonly testCases: TestCaseRepository;
  readonly elements: ElementRepository;
  readonly sourceArtifacts: SourceArtifactRepository;
  readonly executionIRs: ExecutionIRRepository;
}

/**
 * Factory for creating Units of Work.
 * The composition root creates this and injects it into services.
 */
export interface UnitOfWorkFactory {
  create(): UnitOfWork;
}
