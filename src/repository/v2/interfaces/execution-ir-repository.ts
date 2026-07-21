/**
 * ExecutionIRRepository Interface — execution-ir-design.md §2.11, §6
 *
 * Repository contract for Execution IR artifacts. Implements INV-IR7:
 * one cached artifact per ATC version. save() replaces; it does not append.
 *
 * The IR is a derived artifact — it can be discarded and regenerated at any
 * time without data loss. Deletion is always safe.
 */

import type { ExecutionIRArtifact } from '../../../domain/execution-ir/types';

export interface ExecutionIRRepository {
  /** Get an IR artifact by its own ID. */
  getById(id: string): Promise<ExecutionIRArtifact | undefined>;

  /** Get the cached IR artifact for a specific ATC version. */
  getByTestCaseVersion(testCaseVersionId: string): Promise<ExecutionIRArtifact | undefined>;

  /**
   * Save an IR artifact. INV-IR7: replaces any existing artifact for the same
   * testCaseVersionId. One cached IR per ATC version — no append, no version history.
   */
  save(artifact: ExecutionIRArtifact): Promise<ExecutionIRArtifact>;

  /** Delete the cached IR artifact. Safe — IR is derived and regenerable. */
  delete(id: string): Promise<void>;

  /** Delete the cached IR for a specific ATC version. */
  deleteByTestCaseVersion(testCaseVersionId: string): Promise<void>;
}
