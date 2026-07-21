/**
 * Dexie Database Schema — V1 storage implementation.
 *
 * Tables match the aggregate roots from domain-schema.md. Value objects
 * (Step, Validation, LocatorStrategy) are stored inline within their parent
 * aggregate, not as separate tables.
 *
 * Reference: domain-schema.md §3 (entity definitions)
 */

import Dexie, { type Table } from 'dexie';
import type { Project } from '../../../domain/entities/project';
import type { Element } from '../../../domain/entities/element';
import type { ApprovedTestCase, TestCaseVersion } from '../../../domain/entities/approved-test-case';
import type { SourceArtifact } from '../../../domain/entities/source-artifact';
import type { ExecutionIRArtifact } from '../../../domain/execution-ir/types';

/** Database name — versioned for future migrations. */
const DB_NAME = 'cmdrunner_repository';
const DB_VERSION = 1;

/**
 * Row types for Dexie storage. These extend the domain entities with
 * IndexedDB-specific indexing metadata. The domain entities themselves
 * are immutable plain objects — these row types add indexable fields
 * for query performance.
 *
 * The key insight: the stored shape IS the domain entity. We don't
 * transform between domain and storage representations. Dexie stores
 * the entity as-is, and we index on the fields we need to query by.
 */

/** Project row — identical to domain Project. */
export type ProjectRow = Project;

/** Element row — identical to domain Element. */
export type ElementRow = Element;

/** ATC row — identical to domain ApprovedTestCase. */
export type TestCaseRow = ApprovedTestCase;

/** TestCaseVersion row — identical to domain TestCaseVersion. */
export type TestCaseVersionRow = TestCaseVersion;

/** SourceArtifact row — identical to domain SourceArtifact. */
export type SourceArtifactRow = SourceArtifact;

/** ExecutionIRArtifact row — identical to domain ExecutionIRArtifact. */
export type ExecutionIRRow = ExecutionIRArtifact;

/**
 * The CmdRunner Dexie database.
 *
 * Table indexes are defined for the query patterns identified in the
 * repository interfaces:
 *   - projects: by id (primary key)
 *   - elements: by id (PK), projectId, pageOrComponent (compound with projectId)
 *   - testCases: by id (PK), projectId, tags (multi-entry)
 *   - testCaseVersions: by id (PK), testCaseId, versionNumber
 */
export class CmdRunnerDatabase extends Dexie {
  projects!: Table<ProjectRow, string>;
  elements!: Table<ElementRow, string>;
  testCases!: Table<TestCaseRow, string>;
  testCaseVersions!: Table<TestCaseVersionRow, string>;
  sourceArtifacts!: Table<SourceArtifactRow, string>;
  executionIRs!: Table<ExecutionIRRow, string>;

  constructor() {
    super(DB_NAME);

    this.version(DB_VERSION).stores({
      // Primary key is `id` (first field). Subsequent fields are indexed.
      // 'id' is the IndexedDB primary key.
      // 'projectId' is indexed for getByProject() queries.
      projects: 'id, status',

      // Elements: index on projectId for getByProject(), compound on
      // [projectId+pageOrComponent] for getByPageComponent().
      elements: 'id, projectId, [projectId+pageOrComponent], status',

      // Test cases: index on projectId for getByProject(),
      // multi-entry on tags for getByTag().
      testCases: 'id, projectId, *tags, status, priority',

      // Versions: index on testCaseId for listVersions(),
      // compound on [testCaseId+versionNumber] for getCurrentVersion().
      testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',

      // Source artifacts: indexed by projectId and type for queries.
      sourceArtifacts: 'id, projectId, [projectId+type]',

      // Execution IR artifacts: indexed by id and testCaseVersionId.
      // testCaseVersionId is the primary lookup key (one IR per ATC version, INV-IR7).
      executionIRs: 'id, testCaseVersionId',
    });
  }
}

/**
 * Create a new database instance.
 * Used by the UnitOfWork factory.
 */
export function createDatabase(): CmdRunnerDatabase {
  return new CmdRunnerDatabase();
}
