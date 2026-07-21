/**
 * DexieProjectRepository — V1 implementation of ProjectRepository.
 *
 * Operates within a Dexie transaction provided by the Unit of Work.
 * All operations are scoped to the transaction — if the transaction
 * aborts, all changes are rolled back.
 */

import type { Project } from '../../../domain/entities/project';
import {
  createProject,
  updateProject,
} from '../../../domain/entities/project';
import type { ProjectRepository, UpdateProjectInput } from '../interfaces/project-repository';
import type { Table } from 'dexie';

/** Dexie-based implementation of ProjectRepository. */
export class DexieProjectRepository implements ProjectRepository {
  constructor(private readonly projects: Table<Project, string>) {}

  async getById(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async getAll(): Promise<Project[]> {
    return this.projects.toArray();
  }

  async create(input: Parameters<typeof createProject>[0]): Promise<Project> {
    const project = createProject(input);
    await this.projects.add(project);
    return project;
  }

  async update(id: string, changes: UpdateProjectInput): Promise<Project> {
    const existing = await this.projects.get(id);
    if (!existing) {
      throw new Error(`Project not found: ${id}`);
    }

    const updated = updateProject(existing, changes);
    await this.projects.put(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    // INV-P2: cascade delete all child entities.
    // In Dexie, this requires explicit deletion of related records.
    // The cascade is handled at the UnitOfWork level — we just delete
    // the project here. The calling service layer is responsible for
    // deleting children (elements, test cases, etc.) in the same
    // transaction before calling this.
    await this.projects.delete(id);
  }
}
