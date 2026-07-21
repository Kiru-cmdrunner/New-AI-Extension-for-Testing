/**
 * DexieSourceArtifactRepository — V1 implementation of SourceArtifactRepository.
 */

import type { SourceArtifact } from '../../../domain/entities/source-artifact';
import { createSourceArtifact } from '../../../domain/entities/source-artifact';
import type { CreateSourceArtifactInput } from '../../../domain/entities/source-artifact';
import type { SourceArtifactRepository } from '../interfaces/source-artifact-repository';
import type { Table } from 'dexie';

export class DexieSourceArtifactRepository implements SourceArtifactRepository {
  constructor(private readonly sourceArtifacts: Table<SourceArtifact, string>) {}

  async getById(id: string): Promise<SourceArtifact | undefined> {
    return this.sourceArtifacts.get(id);
  }

  async getByProject(projectId: string): Promise<SourceArtifact[]> {
    return this.sourceArtifacts.where('projectId').equals(projectId).toArray();
  }

  async getByType(
    projectId: string,
    type: SourceArtifact['type'],
  ): Promise<SourceArtifact[]> {
    return this.sourceArtifacts
      .where('[projectId+type]')
      .equals([projectId, type])
      .toArray();
  }

  async create(input: CreateSourceArtifactInput): Promise<SourceArtifact> {
    const artifact = createSourceArtifact(input);
    await this.sourceArtifacts.add(artifact);
    return artifact;
  }

  async getByVersion(sourceArtifactIds: string[]): Promise<SourceArtifact[]> {
    if (!sourceArtifactIds.length) return [];
    const results: SourceArtifact[] = [];
    for (const id of sourceArtifactIds) {
      const sa = await this.sourceArtifacts.get(id);
      if (sa) results.push(sa);
    }
    return results;
  }
}
