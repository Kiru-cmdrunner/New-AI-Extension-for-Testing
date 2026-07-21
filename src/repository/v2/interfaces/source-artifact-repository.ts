/**
 * SourceArtifactRepository Interface — domain-schema.md §3.3
 *
 * Repository contract for Source Artifact aggregate root.
 * INV-SA2: Source Artifacts are never deleted — the delete method
 * is intentionally absent from this interface.
 */

import type {
  SourceArtifact,
  CreateSourceArtifactInput,
} from '../../../domain/entities/source-artifact';

export interface SourceArtifactRepository {
  /** Get a source artifact by ID. Returns undefined if not found. */
  getById(id: string): Promise<SourceArtifact | undefined>;

  /** Get all source artifacts in a project. */
  getByProject(projectId: string): Promise<SourceArtifact[]>;

  /** Get source artifacts by type (e.g., all interaction_timelines). */
  getByType(projectId: string, type: SourceArtifact['type']): Promise<SourceArtifact[]>;

  /** Create a new source artifact. INV-SA1: immutable after creation. */
  create(input: CreateSourceArtifactInput): Promise<SourceArtifact>;

  /**
   * Get all source artifacts referenced by a specific ATC version.
   * Resolves the version's sourceArtifactIds[] to full entities.
   */
  getByVersion(sourceArtifactIds: string[]): Promise<SourceArtifact[]>;
}
