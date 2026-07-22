/**
 * ExecutionRunRepository Interface — persists execution run records.
 *
 * ExecutionRuns are append-only — each execution creates a new record.
 * They are queryable by testCaseVersionId (history for a specific version)
 * and by projectId (all runs for a project).
 */

import type { ExecutionRun } from '../../../domain/entities/execution-run';

export interface ExecutionRunRepository {
  /** Get a run by its ID. */
  getById(id: string): Promise<ExecutionRun | undefined>;

  /** Get all runs for a specific test case version (chronological). */
  getByTestCaseVersion(testCaseVersionId: string): Promise<ExecutionRun[]>;

  /** Get all runs for a project. */
  getByProject(projectId: string): Promise<ExecutionRun[]>;

  /** Save a new execution run. Append-only — does not replace. */
  save(run: ExecutionRun): Promise<ExecutionRun>;

  /** Delete a run by ID. */
  delete(id: string): Promise<void>;
}
