/**
 * Collection Tracker — tracks list-like collections and their sizes.
 *
 * Collections are identified by container DOM path. When a ListChangeSignal
 * arrives, the tracker updates the collection's count.
 *
 * M9.2
 */

import type { Collection, EntityType } from './types';

export class CollectionTracker {
  private collections = new Map<string, Collection>();

  /**
   * Update a collection's size from a list-change signal.
   * Creates the collection if it doesn't exist.
   */
  update(
    containerPath: string,
    addedCount: number,
    removedCount: number,
    interactionId: string,
    entityType: EntityType = 'unknown',
    viewId?: string,
  ): Collection {
    const id = `collection:${containerPath}`;
    let coll = this.collections.get(id);

    if (!coll) {
      coll = {
        id,
        entityType,
        count: null,
        containerPath,
        lastUpdated: interactionId,
        viewIds: viewId ? [viewId] : undefined,
      };
      this.collections.set(id, coll);
    } else if (viewId) {
      const ids = new Set(coll.viewIds ?? []);
      ids.add(viewId);
      coll.viewIds = Array.from(ids);
    }

    // Update count: if we had a known count, apply the delta; otherwise start from 0
    const baseCount = coll.count ?? 0;
    coll.count = Math.max(0, baseCount + addedCount - removedCount);
    coll.lastUpdated = interactionId;

    return coll;
  }

  /**
   * Set the count directly (e.g., from a page content snapshot).
   */
  setCount(containerPath: string, count: number, interactionId: string, viewId?: string): void {
    const id = `collection:${containerPath}`;
    let coll = this.collections.get(id);
    if (!coll) {
      coll = {
        id,
        entityType: 'unknown',
        count,
        containerPath,
        lastUpdated: interactionId,
        viewIds: viewId ? [viewId] : undefined,
      };
      this.collections.set(id, coll);
    } else {
      if (viewId) {
        const ids = new Set(coll.viewIds ?? []);
        ids.add(viewId);
        coll.viewIds = Array.from(ids);
      }
    }
    coll.count = count;
    coll.lastUpdated = interactionId;
  }

  /**
   * Get a collection by container path.
   */
  get(containerPath: string): Collection | undefined {
    return this.collections.get(`collection:${containerPath}`);
  }

  /**
   * All collections as a map.
   */
  snapshot(): Map<string, Collection> {
    return new Map(this.collections);
  }

  get size(): number {
    return this.collections.size;
  }

  clear(): void {
    this.collections.clear();
  }
}
