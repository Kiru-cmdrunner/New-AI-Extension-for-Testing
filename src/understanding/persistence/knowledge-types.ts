/**
 * M9.5 - Application Knowledge Persistence Types
 *
 * Row types for the cmdrunner_knowledge Dexie database.
 * These are the persisted shapes of the in-memory M9.2/M9.3/M9.4 types.
 *
 * Design principle: knowledge is a SEPARATE LAYER from behavioral evidence.
 * Cross-layer linking by ID reference only. No embedded raw evidence.
 *
 * Architecture: .drytis/specs/m9-5-knowledge-persistence.md
 */

// -- Application --

/**
 * A tracked application/site, identified by origin.
 */
export interface ApplicationRow {
  /** App ID: hash of origin (stable across sessions). */
  appId: string;
  /** Site origin (e.g., 'https://www.amazon.com'). */
  origin: string;
  /** Human-readable name (derived from hostname). */
  label: string;
  /** Epoch ms when first seen. */
  firstSeenAt: number;
  /** Epoch ms of last recording session. */
  lastActiveAt: number;
  /** Total recording sessions recorded. */
  sessionCount: number;
  /** Last session that updated this app (idempotency guard). */
  lastSessionId: string;
}

// -- Entity --

/**
 * Persisted application entity. Accumulates across sessions.
 */
export interface KnowledgeEntityRow {
  /** Compound key: appId + ':' + entityId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Entity business ID (e.g., 'B0XYZ12345'). */
  entityId: string;
  /** Entity type. */
  type: string;
  /** Merged attributes (latest wins per key). */
  attributes: Record<string, string | number | boolean | null>;
  /** How first detected. */
  source: string;
  /** Epoch ms when first seen. */
  firstSeenAt: number;
  /** Epoch ms when last seen/updated. */
  lastSeenAt: number;
  /** Merge count (incremented on each upsert). */
  revision: number;
  /** Last recording session that observed this entity. */
  lastSessionId: string;
  /** Current lifecycle state (e.g., 'pending', 'approved'). M9.9. */
  currentState?: string;
  /** Ordered lifecycle transitions. M9.9. */
  stateHistory?: KnowledgeEntityStateChange[];
  /** Views where this entity has been observed. D5. */
  viewIds?: string[];
}

/**
 * A persisted entity state transition. M9.9.
 */
export interface KnowledgeEntityStateChange {
  /** Previous state (null when this is the initial observation). */
  from: string | null;
  /** New state. */
  to: string;
  /** Interaction ID when this transition was observed. */
  changedAt: string;
  /** Detection evidence description. */
  evidence: string;
}

// -- View --

/**
 * A known application view/page.
 */
export interface KnowledgeViewRow {
  /** Compound key: appId + ':' + viewId. */
  key: string;
  /** App scope. */
  appId: string;
  /** View ID (e.g., 'product-detail'). */
  viewId: string;
  /** Human label. */
  label: string;
  /** How detected. */
  detectedFrom: string;
  /** Epoch ms first seen. */
  firstSeenAt: number;
  /** Epoch ms last seen. */
  lastSeenAt: number;
  /** Times this view was visited. */
  visitCount: number;
  /** Last session that visited this view (idempotency guard). */
  lastSessionId: string;
}

// -- View Transition --

/**
 * A known transition between two views.
 */
export interface KnowledgeViewTransitionRow {
  /** Compound key: appId + ':' + fromViewId + '->' + toViewId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Source view. */
  fromViewId: string;
  /** Destination view. */
  toViewId: string;
  /** Times this transition was observed. */
  count: number;
  /** Epoch ms first observed. */
  firstSeenAt: number;
  /** Epoch ms last observed. */
  lastSeenAt: number;
  /** Last session that observed this transition (idempotency guard). */
  lastSessionId: string;
}

// -- Collection --

/**
 * A tracked collection with accumulated size data.
 */
export interface KnowledgeCollectionRow {
  /** Compound key: appId + ':' + collectionId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Collection ID (container path or semantic name). */
  collectionId: string;
  /** Entity type stored in this collection. */
  entityType: string;
  /** Latest known count. */
  currentCount: number;
  /** Max observed count. */
  maxCount: number;
  /** Epoch ms last updated. */
  lastUpdated: number;
  /** Last session that updated this collection (idempotency guard). */
  lastSessionId: string;
}

// -- Counter --

/**
 * A tracked counter with value history.
 */
export interface KnowledgeCounterRow {
  /** Compound key: appId + ':' + counterId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Counter ID (element path). */
  counterId: string;
  /** Human label. */
  label: string;
  /** Element DOM path. */
  elementPath: string;
  /** Latest value. */
  currentValue: string;
  /** Value history (bounded at MAX_COUNTER_HISTORY). */
  history: KnowledgeCounterEntry[];
  /** Epoch ms last updated. */
  lastUpdated: number;
  /** Last session that updated this counter (idempotency guard). */
  lastSessionId: string;
}

/**
 * A single counter observation in the history.
 */
export interface KnowledgeCounterEntry {
  /** Value at this observation. */
  value: string;
  /** Epoch ms when observed. */
  observedAt: number;
  /** Recording session that observed it. */
  sessionId: string;
  /** Numeric delta from previous (null for first). */
  delta: number | null;
}

// -- Notification --

/**
 * A captured notification (append-only with dedup).
 */
export interface KnowledgeNotificationRow {
  /** Compound key: appId + ':' + hash(text+elementPath+appearedAt). */
  key: string;
  /** App scope. */
  appId: string;
  /** Notification text. */
  text: string;
  /** Severity. */
  severity: string;
  /** DOM path. */
  elementPath: string;
  /** Epoch ms when appeared. */
  appearedAt: number;
  /** Recording session. */
  sessionId: string;
}

// -- Outcome --

/**
 * Persisted action outcome.
 */
export interface KnowledgeOutcomeRow {
  /** Compound key: sessionId + ':' + interactionId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Recording session. */
  sessionId: string;
  /** Interaction ID. */
  interactionId: string;
  /** What the user did. */
  actionType: string;
  /** Target element label. */
  actionTarget: string;
  /** Determined outcome. */
  outcome: string;
  /** Confidence score 0-1. */
  confidence: number;
  /** Confidence level. */
  confidenceLevel: string;
  /** Evidence summary (kind + result + detail). */
  evidence: KnowledgeEvidenceEntry[];
  /** Entity IDs resulting from this action. */
  resultingEntities: string[];
  /** Epoch ms persisted. */
  persistedAt: number;
}

/**
 * Flattened evidence entry for persistence.
 */
export interface KnowledgeEvidenceEntry {
  kind: string;
  result: string;
  weight: number;
  detail: string;
}

// -- State Transition --

/**
 * Persisted state transition per interaction.
 */
export interface KnowledgeStateTransitionRow {
  /** Compound key: sessionId + ':' + interactionId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Recording session. */
  sessionId: string;
  /** Interaction ID. */
  interactionId: string;
  /** State change summary strings. */
  changes: string[];
  /** View before (or null). */
  fromViewId: string | null;
  /** View after (or null). */
  toViewId: string | null;
  /** New/updated entity IDs in this transition. */
  affectedEntities: string[];
  /** Epoch ms. */
  timestamp: number;
}

// -- Constants --

export const MAX_COUNTER_HISTORY = 100;
export const MAX_NOTIFICATIONS_PER_APP = 500;
export const MAX_TRANSITIONS_PER_SESSION = 500;
