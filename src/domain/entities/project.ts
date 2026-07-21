/**
 * Project Entity — domain-schema.md §3.1
 *
 * The tenancy, isolation, and permissions boundary. A Project owns its own
 * Element Repository, Environment Profiles, Test Suites, and all Test Cases.
 * There is no cross-project sharing in V1.
 *
 * The Project is NOT a hierarchy level — organization within a project is flat,
 * using tags and optional collections.
 */

import { ProjectStatus } from '../enums';
import { MissingFieldError } from '../errors/invariant-errors';

/** Project entity — the tenancy root. */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Advisory tag vocabulary for UI autocomplete. Not enforced (INV-P3). */
  readonly tags: string[];
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

/** Input for creating a new Project. */
export interface CreateProjectInput {
  name: string;
  description?: string;
  tags?: string[];
  createdBy: string;
}

/**
 * Create a Project entity with invariant validation.
 *
 * @throws MissingFieldError if name or createdBy is empty
 */
export function createProject(input: CreateProjectInput): Project {
  const name = input.name?.trim();
  if (!name) {
    throw new MissingFieldError('Project', 'name');
  }

  const createdBy = input.createdBy?.trim();
  if (!createdBy) {
    throw new MissingFieldError('Project', 'createdBy');
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name,
    description: input.description?.trim() ?? '',
    tags: input.tags ?? [],
    status: ProjectStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
}

/**
 * Create an updated Project with new metadata fields.
 * Used by the repository's update method.
 */
export function updateProject(
  existing: Project,
  changes: { name?: string; description?: string; tags?: string[]; status?: ProjectStatus },
): Project {
  const name = changes.name !== undefined ? changes.name.trim() : existing.name;
  if (!name) {
    throw new MissingFieldError('Project', 'name');
  }

  return {
    ...existing,
    name,
    description: changes.description !== undefined ? changes.description.trim() : existing.description,
    tags: changes.tags ?? existing.tags,
    status: changes.status ?? existing.status,
    updatedAt: new Date().toISOString(),
  };
}
