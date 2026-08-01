/**
 * Dexie Capability Version Repository — persistence for CapabilityVersion entities.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §11 Step 4
 */

import type { CapabilityVersion } from '../../../domain/entities/capability-version';
import type { Table } from 'dexie';

export interface CapabilityVersionRepository {
  getByVersionId(versionId: string): Promise<CapabilityVersion | undefined>;
  listVersions(capabilityId: string): Promise<CapabilityVersion[]>;
  getByCapabilityAndNumber(capabilityId: string, versionNumber: number): Promise<CapabilityVersion | undefined>;
  getLatestVersion(capabilityId: string): Promise<CapabilityVersion | undefined>;
  create(version: CapabilityVersion): Promise<CapabilityVersion>;
  getBySourceSessionId(sessionId: string): Promise<CapabilityVersion[]>;
}

export class DexieCapabilityVersionRepository implements CapabilityVersionRepository {
  constructor(private readonly versions: Table<CapabilityVersion, string>) {}

  async getByVersionId(versionId: string): Promise<CapabilityVersion | undefined> {
    return this.versions.get(versionId);
  }

  async listVersions(capabilityId: string): Promise<CapabilityVersion[]> {
    const all = await this.versions
      .where('capabilityId')
      .equals(capabilityId)
      .toArray();
    return all.sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async getByCapabilityAndNumber(
    capabilityId: string,
    versionNumber: number,
  ): Promise<CapabilityVersion | undefined> {
    return this.versions
      .where('[capabilityId+versionNumber]')
      .equals([capabilityId, versionNumber])
      .first();
  }

  async getLatestVersion(capabilityId: string): Promise<CapabilityVersion | undefined> {
    const versions = await this.listVersions(capabilityId);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }

  async create(version: CapabilityVersion): Promise<CapabilityVersion> {
    await this.versions.add(version);
    return version;
  }

  async getBySourceSessionId(sessionId: string): Promise<CapabilityVersion[]> {
    return this.versions.where('sourceSessionId').equals(sessionId).toArray();
  }
}
