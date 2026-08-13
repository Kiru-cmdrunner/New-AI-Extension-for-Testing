/**
 * M9.3 - Relationship Tracker
 *
 * Stores ActionOutcome records and provides query methods to
 * retrieve action/outcome relationships across a recording session.
 *
 * In-memory only (M9.5 will add Dexie V5 persistence).
 */

import type { ActionOutcome } from './outcome-types';

export class RelationshipTracker {
  private outcomes = new Map<string, ActionOutcome>();

  /**
   * Record an outcome for an interaction. Idempotent by interactionId.
   */
  record(outcome: ActionOutcome): void {
    this.outcomes.set(outcome.interactionId, outcome);
  }

  /**
   * Get the outcome for a specific interaction.
   */
  get(interactionId: string): ActionOutcome | undefined {
    return this.outcomes.get(interactionId);
  }

  /**
   * Get all recorded outcomes in insertion order.
   */
  getAll(): ActionOutcome[] {
    return Array.from(this.outcomes.values());
  }

  /**
   * Get all outcomes with a specific category.
   */
  getByOutcome(category: ActionOutcome['outcome']): ActionOutcome[] {
    return this.getAll().filter((o) => o.outcome === category);
  }

  /**
   * Get all outcomes for a specific action type.
   */
  getByActionType(actionType: ActionOutcome['actionType']): ActionOutcome[] {
    return this.getAll().filter((o) => o.actionType === actionType);
  }

  /**
   * Get outcomes that resulted in a specific entity being created/updated.
   */
  getByResultingEntity(entityId: string): ActionOutcome[] {
    return this.getAll().filter((o) => o.resultingEntities.includes(entityId));
  }

  /**
   * Get the count of each outcome category.
   */
  getSummary(): {
    total: number;
    success: number;
    failure: number;
    ambiguous: number;
    incomplete: number;
  } {
    let success = 0;
    let failure = 0;
    let ambiguous = 0;
    let incomplete = 0;

    for (const o of this.outcomes.values()) {
      switch (o.outcome) {
        case 'success': success++; break;
        case 'failure': failure++; break;
        case 'ambiguous': ambiguous++; break;
        case 'incomplete': incomplete++; break;
      }
    }

    return {
      total: this.outcomes.size,
      success,
      failure,
      ambiguous,
      incomplete,
    };
  }

  /**
   * Build a human-readable chain of action/outcome relationships.
   */
  getChain(): string[] {
    return this.getAll().map((o) => {
      const entityStr =
        o.resultingEntities.length > 0
          ? ` [entities: ${o.resultingEntities.join(', ')}]`
          : '';
      return `${o.actionType} "${o.actionTarget}" -> ${o.outcome} (${o.confidenceLevel}, ${(o.confidence * 100).toFixed(0)}%)${entityStr}`;
    });
  }

  get size(): number {
    return this.outcomes.size;
  }

  clear(): void {
    this.outcomes.clear();
  }
}
