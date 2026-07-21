/**
 * ProjectRepository Interface — domain-schema.md §3.1
 *
 * Repository contract for Project aggregate root.
 * Implementations: DexieProjectRepository (V1), ApiProjectRepository (future).
 */

import type { Project, CreateProjectInput } from '../../../domain/entities/project';

/** Update input for a Project. */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  tags?: string[];
  status?: Project['status'];
}

/** Repository interface for Project CRUD operations. */
export interface ProjectRepository {
  /** Get a project by ID. Returns undefined if not found. */
  getById(id: string): Promise<Project | undefined>;

  /** Get all projects. */
  getAll(): Promise<Project[]>;

  /** Create a new project. Throws on invariant violation. */
  create(input: CreateProjectInput): Promise<Project>;

  /** Update a project's metadata. Returns the updated project. */
  update(id: string, changes: UpdateProjectInput): Promise<Project>;

  /** Delete a project and all its children (INV-P2 cascade). */
  delete(id: string): Promise<void>;
}
