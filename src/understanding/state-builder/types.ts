/**
 * M9.2 — State Builder Types
 *
 * ApplicationState is a semantic model of the application at a point in time.
 * It accumulates across interactions, creating an unbroken chain:
 *   State₀ → [Action₁] → State₁ → [Action₂] → State₂ → ...
 *
 * Architecture: .drytis/specs/m9-design.md §4
 */

import type { ViewDescriptor } from '../types';

// ── Entity ─────────────────────────────────────────────────────────────

export type EntityType =
  | 'product'
  | 'cart-item'
  | 'search-query'
  | 'order'
  | 'user'
  | 'filter'
  | 'page-content'
  | 'unknown';

/**
 * A semantic object the application works with.
 */
export interface Entity {
  /** Internal entity ID (e.g., "product-B0H2Z9JL52"). */
  id: string;
  /** Entity type. */
  type: EntityType;
  /** Key-value attributes (name, price, quantity, etc.). */
  attributes: Record<string, string | number | boolean | null>;
  /** How this entity was detected. */
  source: EntitySource;
  /** Interaction ID when first observed. */
  firstSeenAt: string;
  /** Interaction ID of last update. */
  lastUpdated: string;
}

export type EntitySource = 'view-derived' | 'target-derived' | 'counter-derived' | 'inferred';

// ── Collection ─────────────────────────────────────────────────────────

/**
 * A named collection of entities (e.g., search results, cart items).
 */
export interface Collection {
  /** Collection ID (e.g., "search-results", "cart-items"). */
  id: string;
  /** Entity type contained in this collection. */
  entityType: EntityType;
  /** Known item count (null if unknown). */
  count: number | null;
  /** Container DOM path (for tracking). */
  containerPath: string | null;
  /** Interaction ID when last updated. */
  lastUpdated: string;
}

// ── Counter ────────────────────────────────────────────────────────────

/**
 * A tracked counter with value history.
 */
export interface CounterRecord {
  /** Counter ID (e.g., "cart-count"). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** DOM path of the counter element. */
  elementPath: string;
  /** Value history. */
  values: CounterValue[];
}

/**
 * A single counter value observation.
 */
export interface CounterValue {
  /** The value (as string). */
  value: string;
  /** Interaction ID when observed. */
  interactionId: string;
  /** Numeric delta from previous (null for first observation). */
  delta: number | null;
}

// ── Notification ───────────────────────────────────────────────────────

/**
 * A captured notification.
 */
export interface NotificationRecord {
  /** Notification ID. */
  id: string;
  /** Full text content. */
  text: string;
  /** Severity classification. */
  severity: 'success' | 'error' | 'warning' | 'info' | 'unknown';
  /** DOM path. */
  elementPath: string;
  /** Interaction ID when it appeared. */
  appearedAt: string;
  /** Interaction ID when it disappeared (null if still visible). */
  disappearedAt: string | null;
}

// ── Application State ──────────────────────────────────────────────────

/**
 * A snapshot of the application's semantic state at a point in time.
 * Built by StateBuilder from accumulated signals.
 */
export interface ApplicationState {
  /** Current view the user is on. */
  currentView: ViewDescriptor | null;
  /** Current URL. */
  currentUrl: string | null;
  /** All known entities, keyed by entity ID. */
  entities: Map<string, Entity>;
  /** All known collections, keyed by collection ID. */
  collections: Map<string, Collection>;
  /** All known counters, keyed by counter ID. */
  counters: Map<string, CounterRecord>;
  /** All notifications seen. */
  notifications: NotificationRecord[];
  /** Interaction ID that produced this state. */
  lastInteractionId: string | null;
  /** Number of interactions processed. */
  interactionCount: number;
}

/**
 * The result of processing one interaction through the StateBuilder.
 */
export interface StateTransition {
  /** Interaction ID. */
  interactionId: string;
  /** State before the interaction. */
  before: ApplicationState;
  /** State after the interaction. */
  after: ApplicationState;
  /** What changed in this transition. */
  changes: string[];
}
