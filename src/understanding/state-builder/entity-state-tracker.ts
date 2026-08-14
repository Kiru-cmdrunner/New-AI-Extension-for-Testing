/**
 * M9.9 — Entity State Tracker
 *
 * Detects entity lifecycle state from status badges and notification
 * text, and maintains per-entity state history.
 *
 * State Association Strategy:
 *   - If exactly one entity is tracked, state signals apply to it.
 *   - If multiple entities exist, the signal is stored but not
 *     associated (multi-entity disambiguation is a future AI candidate).
 *
 * Architecture: .drytis/specs/m9-9-entity-state-lifecycle.md
 */

import type { Entity, EntityStateChange } from './types';

/**
 * Common lifecycle state keywords recognized deterministically.
 * Keys are lowercase patterns; values are canonical state strings.
 */
const STATE_KEYWORDS: Record<string, string> = {
  // Approval / review lifecycles
  'pending': 'pending',
  'awaiting approval': 'pending',
  'awaiting review': 'pending',
  'approved': 'approved',
  'rejected': 'rejected',
  'declined': 'rejected',
  'cancelled': 'cancelled',
  'canceled': 'cancelled',
  'confirmed': 'confirmed',
  'completed': 'completed',
  'complete': 'completed',
  'done': 'completed',
  'draft': 'draft',
  'submitted': 'submitted',

  // Issue / PR lifecycles
  'open': 'open',
  'closed': 'closed',
  'merged': 'merged',
  'in review': 'in-review',
  'changes requested': 'changes-requested',
  'in progress': 'in-progress',
  'todo': 'todo',
  'blocked': 'blocked',
  'archived': 'archived',

  // E-commerce / order lifecycles
  'active': 'active',
  'inactive': 'inactive',
  'disabled': 'disabled',
  'enabled': 'enabled',
  'expired': 'expired',
  'refunded': 'refunded',
  'shipped': 'shipped',
  'delivered': 'delivered',
  'returned': 'returned',

  // HR / hiring lifecycles
  'shortlisted': 'shortlisted',
  'interviewed': 'interviewed',
  'hired': 'hired',
  'on hold': 'on-hold',
};

/**
 * Normalize raw status text to a canonical state string.
 * Returns null when the text contains no recognizable state keyword.
 *
 * Matching: word-boundary, case-insensitive, longest-match-first so
 * "Awaiting Approval" → 'pending' and not a partial hit.
 */
export function normalizeStateText(text: string): string | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;

  // Exact match first (whole string)
  if (STATE_KEYWORDS[lower]) return STATE_KEYWORDS[lower];

  // Partial match: badge text like "Status: Approved" or "Leave Approved"
  const phrases = Object.keys(STATE_KEYWORDS)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const re = new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
    if (re.test(lower)) {
      return STATE_KEYWORDS[phrase];
    }
  }

  return null;
}

/**
 * Extract a state transition verb from notification text.
 * E.g., "Leave request approved" → 'approved', "Issue closed" → 'closed'.
 */
export function extractStateFromNotification(text: string): string | null {
  // Try the whole text first — handles "Approved" toasts
  const direct = normalizeStateText(text);
  if (direct) return direct;

  // Past-tense verbs often indicate a transition ("has been approved",
  // "was merged", "successfully saved" → completed)
  const verbMap: Record<string, string> = {
    'saved': 'saved',
    'created': 'created',
    'updated': 'updated',
    'deleted': 'deleted',
    'removed': 'removed',
    'added': 'added',
  };
  const lower = text.toLowerCase();
  for (const [verb, state] of Object.entries(verbMap)) {
    const re = new RegExp(`\\b${verb}\\b`, 'i');
    if (re.test(lower)) return state;
  }

  return null;
}

/**
 * Tracks lifecycle state per entity.
 */
export class EntityStateTracker {
  private histories = new Map<string, EntityStateChange[]>();
  private current = new Map<string, string>();

  /**
   * Apply a state observation to an entity.
   * Only records a transition when the state actually changes.
   */
  observe(
    entityId: string,
    state: string,
    changedAt: string,
    evidence: string,
  ): boolean {
    const prev = this.current.get(entityId) ?? null;
    if (prev === state) return false; // no change

    const change: EntityStateChange = { from: prev, to: state, changedAt, evidence };
    const history = this.histories.get(entityId) ?? [];
    history.push(change);
    this.histories.set(entityId, history);
    this.current.set(entityId, state);
    return true;
  }

  /**
   * Get the current state of an entity (null = never observed).
   */
  getState(entityId: string): string | null {
    return this.current.get(entityId) ?? null;
  }

  /**
   * Get the state history for an entity (may be empty).
   */
  getHistory(entityId: string): EntityStateChange[] {
    return this.histories.get(entityId) ?? [];
  }

  /**
   * Apply tracked state to an entity snapshot map (M9.2 ApplicationState).
   */
  applyToEntities(entities: Map<string, Entity>): void {
    for (const [entityId, state] of this.current) {
      const entity = entities.get(entityId);
      if (!entity) continue;
      entity.currentState = state;
    }
    for (const [entityId, history] of this.histories) {
      const entity = entities.get(entityId);
      if (!entity) continue;
      entity.stateHistory = history;
    }
  }

  clear(): void {
    this.histories.clear();
    this.current.clear();
  }
}
