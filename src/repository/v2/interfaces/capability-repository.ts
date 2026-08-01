/**
 * CapabilityRepository Interface — contract for persisting Capability entities.
 *
 * Capabilities are mutable (enrichment grows them), so the interface supports
 * both create and update operations. Delete is present but should be gated by
 * referential integrity checks (can't delete a capability with active test cases).
 */

import type { Capability } from '../../../domain/entities/capability';

export interface CapabilityRepository {
  /** Get a capability by ID. Returns undefined if not found. */
  getById(id: string): Promise<Capability | undefined>;

  /** Get all capabilities in a project. */
  getByProject(projectId: string): Promise<Capability[]>;

  /** Create a new capability. */
  create(capability: Capability): Promise<Capability>;

  /**
   * Update an existing capability (used after enrichment).
   * Replaces the entire row — the caller should pass the enriched Capability.
   */
  update(capability: Capability): Promise<Capability>;

  /**
   * Delete a capability. Should only be called after verifying no test cases
   * reference it (referential integrity check).
   */
  delete(id: string): Promise<void>;

  /**
   * Find capabilities that match the given session IDs (any overlap).
   * Used by the matching service to find potential matches.
   */
  findBySessionId(sessionId: string): Promise<Capability[]>;

  /**
   * Find capabilities by review state.
   * Used by the P1 review workflow.
   */
  findByReviewState(reviewState: string): Promise<Capability[]>;
}
