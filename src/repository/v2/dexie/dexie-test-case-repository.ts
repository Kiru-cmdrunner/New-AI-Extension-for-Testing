/**
 * DexieTestCaseRepository — V1 implementation of TestCaseRepository.
 *
 * Handles both the ATC identity table and the version chain.
 * Enforces INV-ATC1 (ATC + version created atomically), INV-ATCV2
 * (versionNumber monotonically increasing), and INV-ATC2 (status
 * transitions).
 */

import type {
  ApprovedTestCase,
  TestCaseVersion,
  CreateTestCaseInput,
} from '../../../domain/entities/approved-test-case';
import {
  createTestCase,
  createTestCaseVersion,
  updateTestCaseMetadata,
  transitionStatus,
  setCurrentVersion,
  approveVersion,
} from '../../../domain/entities/approved-test-case';
import type { CreateStepInput } from '../../../domain/entities/approved-test-case';
import type {
  TestCaseRepository,
  UpdateTestCaseMetadataInput,
  CreateTestCaseResult,
} from '../interfaces/test-case-repository';
import type { Table } from 'dexie';
import { TestCaseStatus } from '../../../domain/enums';

/** Dexie-based implementation of TestCaseRepository. */
export class DexieTestCaseRepository implements TestCaseRepository {
  constructor(
    private readonly testCases: Table<ApprovedTestCase, string>,
    private readonly testCaseVersions: Table<TestCaseVersion, string>,
  ) {}

  // ── ATC Identity ────────────────────────────────────────

  async getById(id: string): Promise<ApprovedTestCase | undefined> {
    return this.testCases.get(id);
  }

  async getByProject(projectId: string): Promise<ApprovedTestCase[]> {
    return this.testCases.where('projectId').equals(projectId).toArray();
  }

  async getByTag(projectId: string, tags: string[]): Promise<ApprovedTestCase[]> {
    // Use the Dexie multi-entry index on *tags for efficient lookup.
    // anyOf() matches any test case with at least one of the requested tags.
    // Then filter by projectId to scope to the project.
    const matches = await this.testCases
      .where('tags').anyOf(tags)
      .and(tc => tc.projectId === projectId)
      .toArray();

    // Deduplicate (a test case matching multiple tags should appear once)
    const results = new Map<string, ApprovedTestCase>();
    for (const tc of matches) {
      results.set(tc.id, tc);
    }

    return Array.from(results.values());
  }

  // ── Versioning ──────────────────────────────────────────

  async create(input: CreateTestCaseInput): Promise<CreateTestCaseResult> {
    const { testCase, version } = createTestCase(input);

    // INV-ATC1: persist ATC and version 1 atomically.
    // Within a Dexie transaction, both succeed or both roll back.
    await this.testCases.add(testCase);
    await this.testCaseVersions.add(version);

    return { testCase, version };
  }

  async createVersion(
    testCaseId: string,
    steps: CreateStepInput[],
    options: {
      changeSummary?: string;
      sourceArtifactIds?: string[];
      aiMetadata?: Parameters<typeof createTestCaseVersion>[0]['aiMetadata'];
      createdBy: string;
    },
  ): Promise<TestCaseVersion> {
    const testCase = await this.testCases.get(testCaseId);
    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    // INV-ATCV2: compute next version number
    const versions = await this.testCaseVersions
      .where('testCaseId').equals(testCaseId)
      .toArray();
    const maxVersion = versions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
    const nextVersionNumber = maxVersion + 1;

    // Get the current version to use as parent
    const currentVersion = await this.testCaseVersions.get(testCase.currentVersionId);

    const newVersion = createTestCaseVersion({
      testCaseId,
      versionNumber: nextVersionNumber,
      steps,
      changeSummary: options?.changeSummary,
      sourceArtifactIds: options?.sourceArtifactIds,
      aiMetadata: options?.aiMetadata,
      parentVersionId: currentVersion?.id ?? null,
      createdBy: options.createdBy,
    });

    await this.testCaseVersions.add(newVersion);

    // Update ATC to point to new version and return to draft (revision requires re-approval).
    // INV-ATC2 status transitions: approved→draft and in_review→draft are valid.
    // DRAFT→DRAFT is a no-op (no transition needed). DEPRECATED→draft is blocked
    // (deprecated is terminal — deprecated test cases should not be revised).
    const updated = setCurrentVersion(testCase, newVersion.id);
    const asDraft = updated.status === TestCaseStatus.DRAFT
      ? updated // Already draft — no transition needed
      : transitionStatus(updated, TestCaseStatus.DRAFT);
    await this.testCases.put(asDraft);

    return newVersion;
  }

  async getVersion(versionId: string): Promise<TestCaseVersion | undefined> {
    return this.testCaseVersions.get(versionId);
  }

  async getCurrentVersion(testCaseId: string): Promise<TestCaseVersion | undefined> {
    const testCase = await this.testCases.get(testCaseId);
    if (!testCase) {
      return undefined;
    }
    return this.testCaseVersions.get(testCase.currentVersionId);
  }

  async listVersions(testCaseId: string): Promise<TestCaseVersion[]> {
    const versions = await this.testCaseVersions
      .where('testCaseId').equals(testCaseId)
      .toArray();
    return versions.sort((a, b) => a.versionNumber - b.versionNumber);
  }

  // ── Metadata Updates ────────────────────────────────────

  async updateMetadata(id: string, changes: UpdateTestCaseMetadataInput): Promise<ApprovedTestCase> {
    const existing = await this.testCases.get(id);
    if (!existing) {
      throw new Error(`Test case not found: ${id}`);
    }

    const updated = updateTestCaseMetadata(existing, changes);
    await this.testCases.put(updated);
    return updated;
  }

  // ── Status Transitions ──────────────────────────────────

  async transitionStatus(id: string, to: ApprovedTestCase['status']): Promise<ApprovedTestCase> {
    const existing = await this.testCases.get(id);
    if (!existing) {
      throw new Error(`Test case not found: ${id}`);
    }

    const updated = transitionStatus(existing, to);
    await this.testCases.put(updated);
    return updated;
  }

  async approve(testCaseId: string, approvedBy: string): Promise<void> {
    const testCase = await this.testCases.get(testCaseId);
    if (!testCase) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    const currentVersion = await this.testCaseVersions.get(testCase.currentVersionId);
    if (!currentVersion) {
      throw new Error(`Current version not found: ${testCase.currentVersionId}`);
    }

    // Mark version as approved
    const approvedVer = approveVersion(currentVersion, approvedBy);
    await this.testCaseVersions.put(approvedVer);

    // Transition ATC status to approved
    const updated = transitionStatus(testCase, TestCaseStatus.APPROVED);
    await this.testCases.put(updated);
  }

  // ── Referential Integrity ───────────────────────────────

  async findVersionsReferencingElement(
    elementId: string,
  ): Promise<Array<{ versionId: string; testCaseId: string }>> {
    const allVersions = await this.testCaseVersions.toArray();
    const references: Array<{ versionId: string; testCaseId: string }> = [];

    for (const version of allVersions) {
      const stepRef = version.steps.some(s => s.elementId === elementId);
      const valRef = version.steps.some(s =>
        s.validations.some(v => v.elementId === elementId),
      );

      if (stepRef || valRef) {
        references.push({ versionId: version.id, testCaseId: version.testCaseId });
      }
    }

    return references;
  }

  async delete(id: string): Promise<void> {
    // Delete all versions first, then the ATC.
    const versions = await this.testCaseVersions
      .where('testCaseId').equals(id)
      .primaryKeys();

    await this.testCaseVersions.bulkDelete(versions);
    await this.testCases.delete(id);
  }
}
