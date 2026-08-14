/**
 * D12 Fix — State Serialization
 *
 * ApplicationState uses Map<string, T> for entities, collections, and counters.
 * Maps survive structured-clone (chrome.storage, IndexedDB) but serialize to
 * `{}` via JSON.stringify — which breaks side-panel display, export, and any
 * future REST API consumption.
 *
 * This module converts ApplicationState / StateTransition into JSON-safe
 * representations at the UnderstandingResult boundary so downstream consumers
 * never encounter empty Maps.
 *
 * Architecture: D12 defect fix, layered on M9.12 production wiring.
 */

import type {
  ApplicationState,
  Entity,
  Collection,
  CounterRecord,
  StateTransition,
} from './types';

// ── Serialized forms (plain objects, JSON-safe) ──────────────────────────

/**
 * ApplicationState with Map fields converted to plain Record objects.
 * Structurally identical to ApplicationState except entities / collections /
 * counters use Record<string, T> instead of Map<string, T>.
 */
export interface SerializedApplicationState {
  currentView: ApplicationState['currentView'];
  currentUrl: string | null;
  entities: Record<string, Entity>;
  collections: Record<string, Collection>;
  counters: Record<string, CounterRecord>;
  notifications: ApplicationState['notifications'];
  lastInteractionId: string | null;
  interactionCount: number;
}

/**
 * A StateTransition with before/after serialized to JSON-safe form.
 */
export interface SerializedStateTransition {
  interactionId: string;
  before: SerializedApplicationState;
  after: SerializedApplicationState;
  changes: string[];
}

// ── Serialization functions ──────────────────────────────────────────────

/**
 * Convert an ApplicationState's Map fields to plain Record objects.
 *
 * If the input is null, returns null. If the state already has plain-object
 * fields (e.g. from a partially deserialized source), they are passed through
 * unchanged.
 */
export function serializeApplicationState(
  state: ApplicationState | null,
): SerializedApplicationState | null {
  if (!state) return null;

  return {
    currentView: state.currentView,
    currentUrl: state.currentUrl,
    entities: mapToRecord(state.entities),
    collections: mapToRecord(state.collections),
    counters: mapToRecord(state.counters),
    notifications: state.notifications,
    lastInteractionId: state.lastInteractionId,
    interactionCount: state.interactionCount,
  };
}

/**
 * Convert a StateTransition's before/after states to JSON-safe form.
 */
export function serializeStateTransition(
  transition: StateTransition,
): SerializedStateTransition {
  return {
    interactionId: transition.interactionId,
    before: serializeApplicationState(transition.before)!,
    after: serializeApplicationState(transition.after)!,
    changes: transition.changes,
  };
}

/**
 * Convert an array of StateTransitions to JSON-safe form.
 */
export function serializeStateTransitions(
  transitions: StateTransition[],
): SerializedStateTransition[] {
  return transitions.map(serializeStateTransition);
}

// ── Internal helpers ─────────────────────────────────────────────────────

/**
 * Convert a Map to a plain Record object. If the input is not a Map (already a
 * plain object), pass it through.
 */
function mapToRecord<V>(map: Map<string, V> | Record<string, V>): Record<string, V> {
  if (map instanceof Map) {
    const record: Record<string, V> = {};
    for (const [key, value] of map) {
      record[key] = value;
    }
    return record;
  }
  // Already a plain object — pass through
  return map as Record<string, V>;
}
