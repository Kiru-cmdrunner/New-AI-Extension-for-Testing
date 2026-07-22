/**
 * DexieCapabilityRepository — Dexie implementation of CapabilityRepository.
 */

import type { Capability } from '../../../domain/entities/capability';
import type { CapabilityRepository } from '../interfaces/capability-repository';
import type { Table } from 'dexie';

export class DexieCapabilityRepository implements CapabilityRepository {
  constructor(private readonly capabilities: Table<Capability, string>) {}

  async getById(id: string): Promise<Capability | undefined> {
    return this.capabilities.get(id);
  }

  async getByProject(projectId: string): Promise<Capability[]> {
    return this.capabilities.where('projectId').equals(projectId).toArray();
  }

  async create(capability: Capability): Promise<Capability> {
    await this.capabilities.add(capability);
    return capability;
  }

  async update(capability: Capability): Promise<Capability> {
    await this.capabilities.put(capability);
    return capability;
  }

  async delete(id: string): Promise<void> {
    await this.capabilities.delete(id);
  }

  async findBySessionId(sessionId: string): Promise<Capability[]> {
    // Uses the multi-entry index on sessionIds — Dexie matches any
    // array element that equals sessionId.
    return this.capabilities.where('sessionIds').equals(sessionId).toArray();
  }
}
