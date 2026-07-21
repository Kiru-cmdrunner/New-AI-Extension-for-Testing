/**
 * TestCaseRepository Interface — domain-schema.md §3.2
 *
 * Repository contract for Approved Test Case aggregate root.
 * Handles both the ATC identity and its version chain.
 * Implementations: DexieTestCaseRepository (V1), ApiTestCaseRepository (future).
 */

import type {
  ApprovedTestCase,
  TestCaseVersion,
  CreateTestCaseInput,
  CreateTestCaseVersionInput,
} from '../../../domain/entities/approved-test-case';
import type {
  CreateStepInput,
} from '../../../domain/entities/approved-test-case';

/** Update input for ATC metadata (INV-ATC3: title/tags update in place). */
export interface UpdateTestCaseMetadataInput {
  title?: string;
  description?: string;
  tags?: string[];
  priority?: ApprovedTestCase['priority'];
  testDataRefs?: string[];
}

/** Result of creating a new test case — the ATC and its initial version. */
export interface CreateTestCaseResult {
  testCase: ApprovedTestCase;
  version: TestCaseVersion;
}

/** Repository interface for Approved Test Case operations. */
export interface TestCaseRepository {
  // ── ATC Identity ────────────────────────────────────────

  /** Get an ATC by ID. Returns undefined if not found. */
  getById(id: string): Promise<ApprovedTestCase | undefined>;

  /** Get all ATCs in a project. */
  getByProject(projectId: string): Promise<ApprovedTestCase[]>;

  /** Get ATCs matching any of the given tags. */
  getByTag(projectId: string, tags: string[]): Promise<ApprovedTestCase[]>;

  // ── Versioning ──────────────────────────────────────────

  /**
   * Create a new test case with its initial version (v1).
   * INV-ATC1: the ATC and version 1 are persisted atomically.
   */
  create(input: CreateTestCaseInput): Promise<CreateTestCaseResult>;

  /**
   * Create a new version of an existing test case.
   * The versionNumber is auto-computed (current max + 1).
   * The ATC's currentVersionId is updated to point to the new version.
   * The ATC status returns to 'draft' (revision requires re-approval).
   *
   * @param testCaseId The parent ATC ID
   * @param steps The new step content for this version
   * @param options Additional version metadata (changeSummary, sourceArtifactIds, etc.)
   */
  createVersion(
    testCaseId: string,
    steps: CreateStepInput[],
    options?: {
      changeSummary?: string;
      sourceArtifactIds?: string[];
      aiMetadata?: CreateTestCaseVersionInput['aiMetadata'];
      createdBy: string;
    },
  ): Promise<TestCaseVersion>;

  /** Get a specific version by ID. Returns undefined if not found. */
  getVersion(versionId: string): Promise<TestCaseVersion | undefined>;

  /** Get the current version of a test case. */
  getCurrentVersion(testCaseId: string): Promise<TestCaseVersion | undefined>;

  /** Get all versions of a test case, ordered by versionNumber. */
  listVersions(testCaseId: string): Promise<TestCaseVersion[]>;

  // ── Metadata Updates ────────────────────────────────────

  /** Update ATC metadata (title, tags, priority, etc.). Does not create a new version. */
  updateMetadata(id: string, changes: UpdateTestCaseMetadataInput): Promise<ApprovedTestCase>;

  // ── Status Transitions ──────────────────────────────────

  /** Transition ATC status (INV-ATC2). Throws InvalidStatusTransitionError on invalid transition. */
  transitionStatus(id: string, to: ApprovedTestCase['status']): Promise<ApprovedTestCase>;

  /**
   * Approve the current version of a test case.
   * Sets approvedBy/At on the version and transitions status → approved.
   */
  approve(testCaseId: string, approvedBy: string): Promise<void>;

  // ── Referential Integrity ───────────────────────────────

  /**
   * Find all ATC versions that reference a given element ID.
   * Used by ElementRepository.delete() to enforce INV-EL3.
   * Returns array of { versionId, testCaseId } pairs.
   */
  findVersionsReferencingElement(elementId: string): Promise<Array<{ versionId: string; testCaseId: string }>>;

  /**
   * Delete a test case and all its versions.
   * Blocked if any Test Run references a version (historical runs must survive).
   */
  delete(id: string): Promise<void>;
}
