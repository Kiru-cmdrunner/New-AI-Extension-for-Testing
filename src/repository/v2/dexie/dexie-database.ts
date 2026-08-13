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
import type { RecordingSession } from '../../../domain/entities/recording-session';
import type { ExecutionRun } from '../../../domain/entities/execution-run';
import type { BehavioralEvidence } from '../../../shared/behavioral-evidence-types';

/** Database name — versioned for future migrations. */
const DB_NAME = 'cmdrunner_repository';

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

/** RecordingSession row — identical to domain RecordingSession. */
export type RecordingSessionRow = RecordingSession;

/** ExecutionRun row — identical to domain ExecutionRun. */
export type ExecutionRunRow = ExecutionRun;

/**
 * BehavioralEvidence row — extends BehavioralEvidence with linking fields
 * for querying by interaction and recording session.
 *
 * Uses `windowId` as the primary key (format `bev-{eventId}`), which is
 * already unique per evidence window. This gives natural idempotency:
 * put() with the same windowId overwrites instead of duplicating.
 *
 * M8.1: Introduced in Dexie V4 schema migration.
 */
export interface BehavioralEvidenceRow extends BehavioralEvidence {
  /** Links to the ComponentInteraction this evidence was attached to. */
  interactionId: string;

  /** Links to the RecordingSession this evidence belongs to. */
  recordingSessionId: string;

  /** Epoch timestamp (Date.now()) when the evidence was persisted to Dexie. */
  persistedAt: number;
}

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
  recordingSessions!: Table<RecordingSessionRow, string>;
  executionRuns!: Table<ExecutionRunRow, string>;
  behavioralEvidence!: Table<BehavioralEvidenceRow, string>;

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

    // V2: Added RecordingSession table.
    // RecordingSessions: indexed by projectId for getByProject().
    this.version(2).stores({
      // V1 tables (unchanged — must repeat in Dexie version upgrade)
      projects: 'id, status',
      elements: 'id, projectId, [projectId+pageOrComponent], status',
      testCases: 'id, projectId, *tags, status, priority',
      testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',
      sourceArtifacts: 'id, projectId, [projectId+type]',
      executionIRs: 'id, testCaseVersionId',
      // V2 new table
      recordingSessions: 'id, projectId',
    });

    // V3: Added ExecutionRun table for persisted execution history.
    // Indexed by testCaseVersionId (history per version) and projectId (all runs).
    this.version(3).stores({
      // V1 tables
      projects: 'id, status',
      elements: 'id, projectId, [projectId+pageOrComponent], status',
      testCases: 'id, projectId, *tags, status, priority',
      testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',
      sourceArtifacts: 'id, projectId, [projectId+type]',
      executionIRs: 'id, testCaseVersionId',
      // V2 table
      recordingSessions: 'id, projectId',
      // V3 new table
      executionRuns: 'id, testCaseVersionId, projectId',
    });

    // V4: Added BehavioralEvidence table (M8 — Persistence + Hardening).
    // BehavioralEvidence is kept separate from the interaction record.
    // Uses windowId as primary key (bev-{eventId}) for natural idempotency.
    // Indexed by interactionId (get evidence for one interaction)
    // and recordingSessionId (get all evidence for a recording).
    this.version(4).stores({
      // V1 tables
      projects: 'id, status',
      elements: 'id, projectId, [projectId+pageOrComponent], status',
      testCases: 'id, projectId, *tags, status, priority',
      testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',
      sourceArtifacts: 'id, projectId, [projectId+type]',
      executionIRs: 'id, testCaseVersionId',
      // V2 table
      recordingSessions: 'id, projectId',
      // V3 table
      executionRuns: 'id, testCaseVersionId, projectId',
      // V4 new table
      behavioralEvidence: 'windowId, interactionId, recordingSessionId',
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
