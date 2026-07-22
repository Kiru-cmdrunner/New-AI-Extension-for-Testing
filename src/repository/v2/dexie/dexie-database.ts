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
import type { Capability } from '../../../domain/entities/capability';
import type { RecordingSession } from '../../../domain/entities/recording-session';

/** Database name — versioned for future migrations. */
const DB_NAME = 'cmdrunner_repository';

/** Schema version. V1: 6 tables. V2: added capabilities + recordingSessions. */
const DB_VERSION = 2;

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

/** Capability row — identical to domain Capability. */
export type CapabilityRow = Capability;

/** RecordingSession row — identical to domain RecordingSession. */
export type RecordingSessionRow = RecordingSession;

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
  capabilities!: Table<CapabilityRow, string>;
  recordingSessions!: Table<RecordingSessionRow, string>;

  constructor() {
    super(DB_NAME);

    // V1: Original 6 tables
    this.version(1).stores({
      projects: 'id, status',
      elements: 'id, projectId, [projectId+pageOrComponent], status',
      testCases: 'id, projectId, *tags, status, priority',
      testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',
      sourceArtifacts: 'id, projectId, [projectId+type]',
      executionIRs: 'id, testCaseVersionId',
    });

    // V2: Added Capability + RecordingSession tables
    // Capabilities: indexed by projectId for getByProject(),
    // multi-entry on sessionIds for findBySessionId().
    // RecordingSessions: indexed by projectId for getByProject().
    // (understandingResult.capability is queried in-memory, not indexed.)
    this.version(2).stores({
      // V1 tables (unchanged — must repeat in Dexie version upgrade)
      projects: 'id, status',
      elements: 'id, projectId, [projectId+pageOrComponent], status',
      testCases: 'id, projectId, *tags, status, priority',
      testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',
      sourceArtifacts: 'id, projectId, [projectId+type]',
      executionIRs: 'id, testCaseVersionId',
      // V2 new tables
      capabilities: 'id, projectId, *sessionIds',
      recordingSessions: 'id, projectId',
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
