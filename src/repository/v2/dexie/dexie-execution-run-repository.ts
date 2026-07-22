/**
 * DexieExecutionRunRepository — persists ExecutionRuns to IndexedDB.
 *
 * Append-only: save() always adds a new record. No update operation.
 */

import type { ExecutionRun } from '../../../domain/entities/execution-run';
import type { ExecutionRunRepository } from '../interfaces/execution-run-repository';
import type { Table } from 'dexie';

export class DexieExecutionRunRepository implements ExecutionRunRepository {
  constructor(
    private readonly executionRuns: Table<ExecutionRun, string>,
  ) {}

  async getById(id: string): Promise<ExecutionRun | undefined> {
    return this.executionRuns.get(id);
  }

  async getByTestCaseVersion(testCaseVersionId: string): Promise<ExecutionRun[]> {
    return this.executionRuns
      .where('testCaseVersionId')
      .equals(testCaseVersionId)
      .toArray();
  }

  async getByProject(projectId: string): Promise<ExecutionRun[]> {
    return this.executionRuns
      .where('projectId')
      .equals(projectId)
      .toArray();
  }

  async save(run: ExecutionRun): Promise<ExecutionRun> {
    await this.executionRuns.add(run);
    return run;
  }

  async delete(id: string): Promise<void> {
    await this.executionRuns.delete(id);
  }
}
