/**
 * DexieUnitOfWork — transactional Unit of Work backed by Dexie.
 *
 * Wraps Dexie's native transaction support. All repository operations
 * within the execute() callback are atomic — either all succeed or
 * all are rolled back.
 *
 * Dexie transactions auto-commit when the callback resolves successfully.
 * If the callback throws, the transaction is aborted (rolled back).
 */

import type { UnitOfWork, RepositorySet } from '../interfaces/unit-of-work';
import type { ProjectRepository } from '../interfaces/project-repository';
import type { TestCaseRepository } from '../interfaces/test-case-repository';
import type { ElementRepository } from '../interfaces/element-repository';
import type { SourceArtifactRepository } from '../interfaces/source-artifact-repository';
import type { ExecutionIRRepository } from '../interfaces/execution-ir-repository';
import type { CapabilityRepository } from '../interfaces/capability-repository';
import type { RecordingSessionRepository } from '../interfaces/recording-session-repository';
import type { CmdRunnerDatabase } from './dexie-database';
import { DexieProjectRepository } from './dexie-project-repository';
import { DexieTestCaseRepository } from './dexie-test-case-repository';
import { DexieElementRepository } from './dexie-element-repository';
import { DexieSourceArtifactRepository } from './dexie-source-artifact-repository';
import { DexieExecutionIRRepository } from './dexie-execution-ir-repository';
import { DexieCapabilityRepository } from './dexie-capability-repository';
import { DexieRecordingSessionRepository } from './dexie-recording-session-repository';

/** A set of repositories that all operate on the same Dexie transaction. */
class TransactionalRepositorySet implements RepositorySet {
  readonly projects: ProjectRepository;
  readonly testCases: TestCaseRepository;
  readonly elements: ElementRepository;
  readonly sourceArtifacts: SourceArtifactRepository;
  readonly executionIRs: ExecutionIRRepository;
  readonly capabilities: CapabilityRepository;
  readonly recordingSessions: RecordingSessionRepository;

  constructor(db: CmdRunnerDatabase) {
    this.projects = new DexieProjectRepository(db.projects);
    this.testCases = new DexieTestCaseRepository(db.testCases, db.testCaseVersions);
    this.elements = new DexieElementRepository(db.elements, db.testCaseVersions);
    this.sourceArtifacts = new DexieSourceArtifactRepository(db.sourceArtifacts);
    this.executionIRs = new DexieExecutionIRRepository(db.executionIRs);
    this.capabilities = new DexieCapabilityRepository(db.capabilities);
    this.recordingSessions = new DexieRecordingSessionRepository(db.recordingSessions);
  }
}

/** Dexie-backed Unit of Work. */
export class DexieUnitOfWork implements UnitOfWork {
  constructor(private readonly db: CmdRunnerDatabase) {}

  async execute<T>(work: (repos: RepositorySet) => Promise<T>): Promise<T> {
    return this.db.transaction(
      'rw!',
      [
        this.db.projects,
        this.db.testCases,
        this.db.testCaseVersions,
        this.db.elements,
        this.db.sourceArtifacts,
        this.db.executionIRs,
        this.db.capabilities,
        this.db.recordingSessions,
      ],
      async () => {
        const repos = new TransactionalRepositorySet(this.db);
        return work(repos);
      },
    );
  }
}
