/**
 * DexieExecutionIRRepository — V1 implementation of ExecutionIRRepository.
 *
 * Stores Execution IR artifacts in IndexedDB via Dexie.
 * Implements INV-IR7: save() replaces any existing artifact for the same
 * testCaseVersionId — one cached IR per ATC version.
 */

import type { ExecutionIRArtifact } from '../../../domain/execution-ir/types';
import type { ExecutionIRRepository } from '../interfaces/execution-ir-repository';
import type { Table } from 'dexie';

export class DexieExecutionIRRepository implements ExecutionIRRepository {
  constructor(private readonly executionIRs: Table<ExecutionIRArtifact, string>) {}

  async getById(id: string): Promise<ExecutionIRArtifact | undefined> {
    return this.executionIRs.get(id);
  }

  async getByTestCaseVersion(testCaseVersionId: string): Promise<ExecutionIRArtifact | undefined> {
    return this.executionIRs
      .where('testCaseVersionId')
      .equals(testCaseVersionId)
      .first();
  }

  async save(artifact: ExecutionIRArtifact): Promise<ExecutionIRArtifact> {
    // INV-IR7: Replace any existing artifact for the same testCaseVersionId.
    // Delete by testCaseVersionId first, then add the new one.
    await this.deleteByTestCaseVersion(artifact.testCaseVersionId);
    await this.executionIRs.add(artifact);
    return artifact;
  }

  async delete(id: string): Promise<void> {
    await this.executionIRs.delete(id);
  }

  async deleteByTestCaseVersion(testCaseVersionId: string): Promise<void> {
    const existing = await this.executionIRs
      .where('testCaseVersionId')
      .equals(testCaseVersionId)
      .toArray();

    for (const artifact of existing) {
      await this.executionIRs.delete(artifact.id);
    }
  }
}
