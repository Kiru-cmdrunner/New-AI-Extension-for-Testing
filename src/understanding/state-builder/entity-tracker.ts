/**
 * Entity Tracker — creates, updates, and looks up entities.
 *
 * Entities are derived from view changes (page-level entities like Product,
 * SearchQuery) and target-state changes (input fields).
 *
 * M9.2
 */

import type { Entity, EntityType } from './types';

export class EntityTracker {
  private entities = new Map<string, Entity>();

  /**
   * Get an entity by ID.
   */
  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Get all entities of a specific type.
   */
  getByType(type: EntityType): Entity[] {
    return Array.from(this.entities.values()).filter((e) => e.type === type);
  }

  /**
   * Create or update an entity.
   */
  upsert(entity: Entity): Entity {
    const existing = this.entities.get(entity.id);
    if (existing) {
      // Merge attributes — new values overwrite old
      existing.attributes = { ...existing.attributes, ...entity.attributes };
      existing.lastUpdated = entity.lastUpdated;
      // M9.9: preserve lifecycle state — only the EntityStateTracker may
      // change it, and it does so through observe(); never through upsert.
      if (existing.currentState !== undefined) {
        existing.currentState = existing.currentState;
      }
      if (existing.stateHistory !== undefined) {
        existing.stateHistory = existing.stateHistory;
      }
      return existing;
    }
    this.entities.set(entity.id, entity);
    return entity;
  }

  /**
   * All entities as a map (for ApplicationState snapshot).
   */
  snapshot(): Map<string, Entity> {
    return new Map(this.entities);
  }

  get size(): number {
    return this.entities.size;
  }

  clear(): void {
    this.entities.clear();
  }
}
