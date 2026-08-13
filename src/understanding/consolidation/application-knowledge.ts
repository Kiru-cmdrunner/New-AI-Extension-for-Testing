/**
 * M9.6 — Application Knowledge Read-Model Types
 *
 * The consolidated view of persisted application knowledge (M9.5).
 * These types are the output of KnowledgeLoader and input to
 * ConflictDetector, JourneyReconstructor, and KnowledgePreloader.
 *
 * All read-only: nothing here mutates persisted data.
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

// ── Confidence ─────────────────────────────────────────────────────────

/**
 * Confidence score for a consolidated knowledge item.
 */
export interface KnowledgeConfidence {
  /** Final score 0–1. */
  score: number;
  /** Observation-frequency component (0–1). */
  observationScore: number;
  /** Recency component (0–1). */
  recencyScore: number;
  /** Source-diversity component (0–1). */
  sourceScore: number;
  /** Human-readable level. */
  level: KnowledgeConfidenceLevel;
}

export type KnowledgeConfidenceLevel = 'low' | 'medium' | 'high' | 'very-high';

// ── Consolidated Entity ────────────────────────────────────────────────

/**
 * A persisted entity enriched with confidence and consolidation metadata.
 */
export interface ConsolidatedEntity {
  /** Business entity ID. */
  entityId: string;
  /** Entity type. */
  type: string;
  /** Merged attributes. */
  attributes: Record<string, string | number | boolean | null>;
  /** Original detection source. */
  source: string;
  /** Revision count from persistence (how many sessions merged). */
  revision: number;
  /** Confidence assessment. */
  confidence: KnowledgeConfidence;
  /** Epoch ms first seen. */
  firstSeenAt: number;
  /** Epoch ms last seen. */
  lastSeenAt: number;
  /** Session IDs that observed this entity. */
  observedInSessions: string[];
}

// ── Consolidated View ──────────────────────────────────────────────────

/**
 * A persisted view enriched with confidence.
 */
export interface ConsolidatedView {
  /** View ID. */
  viewId: string;
  /** Human label. */
  label: string;
  /** Detection method. */
  detectedFrom: string;
  /** Visit count. */
  visitCount: number;
  /** Confidence assessment. */
  confidence: KnowledgeConfidence;
  /** Epoch ms first seen. */
  firstSeenAt: number;
  /** Epoch ms last seen. */
  lastSeenAt: number;
}

// ── Consolidated Collection ────────────────────────────────────────────

export interface ConsolidatedCollection {
  collectionId: string;
  entityType: string;
  currentCount: number;
  maxCount: number;
  lastUpdated: number;
}

// ── Consolidated Counter ───────────────────────────────────────────────

export interface ConsolidatedCounter {
  counterId: string;
  label: string;
  elementPath: string;
  currentValue: string;
  historyLength: number;
  lastUpdated: number;
}

// ── View Graph ─────────────────────────────────────────────────────────

/**
 * An edge in the view-navigation graph.
 */
export interface ViewGraphEdge {
  fromViewId: string;
  toViewId: string;
  count: number;
}

/**
 * The navigation graph between known views.
 */
export interface ViewGraph {
  nodes: ConsolidatedView[];
  edges: ViewGraphEdge[];
}

// ── Outcome Pattern ────────────────────────────────────────────────────

/**
 * Aggregated outcome statistics across sessions.
 */
export interface OutcomePattern {
  totalActions: number;
  successCount: number;
  failureCount: number;
  ambiguousCount: number;
  incompleteCount: number;
  /** Most common action types. */
  topActionTypes: { actionType: string; count: number }[];
}

// ── Application Knowledge ──────────────────────────────────────────────

/**
 * The full consolidated read-model for one application.
 * Assembled by KnowledgeLoader from M9.5 persisted rows.
 */
export interface ApplicationKnowledge {
  appId: string;
  origin: string;
  label: string;
  sessionCount: number;
  firstSeenAt: number;
  lastActiveAt: number;

  entities: ConsolidatedEntity[];
  views: ConsolidatedView[];
  viewGraph: ViewGraph;
  collections: ConsolidatedCollection[];
  counters: ConsolidatedCounter[];
  notifications: { text: string; severity: string; count: number }[];
  outcomePattern: OutcomePattern;

  /** Total rows across all tables (for diagnostics). */
  totalRows: number;
}

// ── Conflict / Finding Types ───────────────────────────────────────────

export type FindingSeverity = 'info' | 'warning' | 'error';

export interface DuplicateEntityFinding {
  kind: 'duplicate-entity';
  severity: FindingSeverity;
  entityIdA: string;
  entityIdB: string;
  type: string;
  /** Overlapping attribute key names. */
  overlappingKeys: string[];
  /** Jaccard similarity of attribute keys (0–1). */
  similarity: number;
  detail: string;
}

export interface StaleKnowledgeFinding {
  kind: 'stale-knowledge';
  severity: FindingSeverity;
  entityId: string;
  type: string;
  sessionsSinceLastSeen: number;
  lastSeenAt: number;
  detail: string;
}

export interface EvolvingEntityFinding {
  kind: 'evolving-entity';
  severity: FindingSeverity;
  entityId: string;
  type: string;
  revision: number;
  /** Attribute keys that have changed across revisions. */
  changedAttributes: string[];
  detail: string;
}

export interface OrphanedTransitionFinding {
  kind: 'orphaned-transition';
  severity: FindingSeverity;
  transitionKey: string;
  missingRefType: 'view' | 'entity';
  missingRefId: string;
  detail: string;
}

export type KnowledgeFinding =
  | DuplicateEntityFinding
  | StaleKnowledgeFinding
  | EvolvingEntityFinding
  | OrphanedTransitionFinding;

/**
 * Full conflict-detection report.
 */
export interface ConflictReport {
  findings: KnowledgeFinding[];
  duplicateCount: number;
  staleCount: number;
  evolvingCount: number;
  orphanedCount: number;
}

// ── Journey Reconstruction ─────────────────────────────────────────────

export interface JourneyStep {
  /** Session this step belongs to. */
  sessionId: string;
  /** Interaction ID. */
  interactionId: string;
  /** Epoch ms timestamp. */
  timestamp: number;
  /** View before the action. */
  fromViewId: string | null;
  /** View after the action. */
  toViewId: string | null;
  /** Action type if an outcome was determined. */
  actionType: string | null;
  /** Action target if an outcome was determined. */
  actionTarget: string | null;
  /** Determined outcome. */
  outcome: string | null;
  /** State changes in this step. */
  changes: string[];
  /** Entity IDs affected. */
  affectedEntities: string[];
}

export interface JourneyGap {
  /** Session where the gap occurs. */
  sessionId: string;
  /** Timestamp before the gap. */
  afterTimestamp: number;
  /** Timestamp after the gap. */
  beforeTimestamp: number;
  /** Gap duration in ms. */
  gapMs: number;
  detail: string;
}

/**
 * Reconstructed user journey timeline.
 */
export interface JourneyTimeline {
  steps: JourneyStep[];
  gaps: JourneyGap[];
  /** Percentage of transitions that have matching outcomes (0–100). */
  outcomeCoverage: number;
  /** Total sessions covered. */
  sessionCount: number;
  /** Total interactions in the timeline. */
  totalInteractions: number;
}

// ── Knowledge Preloader Seed ───────────────────────────────────────────

/**
 * Seed data extracted from prior-session knowledge.
 * Fed to StateBuilder at session start for cross-session continuity.
 */
export interface StateBuilderSeed {
  /** Entities from prior sessions, keyed by entity ID. */
  entities: Map<string, PriorSessionEntity>;
  /** Views from prior sessions, keyed by view ID. */
  views: Map<string, PriorSessionView>;
  /** Counters from prior sessions, keyed by counter ID. */
  counters: Map<string, PriorSessionCounter>;
  /** Whether any prior knowledge was available. */
  hasPriorKnowledge: boolean;
}

export interface PriorSessionEntity {
  id: string;
  type: string;
  attributes: Record<string, string | number | boolean | null>;
  source: string;
  /** Marks this entity as preloaded, not freshly observed. */
  provenance: 'prior-session';
}

export interface PriorSessionView {
  id: string;
  label: string;
  detectedFrom: string;
  provenance: 'prior-session';
}

export interface PriorSessionCounter {
  id: string;
  label: string;
  elementPath: string;
  lastKnownValue: string;
  provenance: 'prior-session';
}

// ── Consistency Check ──────────────────────────────────────────────────

export interface ConsistencyGap {
  /** Entity IDs in current state but missing from persisted knowledge. */
  newEntities: string[];
  /** Entity IDs in persisted knowledge but missing from current state. */
  missingEntities: string[];
  /** Views in current state but not in persisted knowledge. */
  newViews: string[];
  /** Views in persisted knowledge but not in current state. */
  missingViews: string[];
  /** True if the in-memory state is consistent with persisted knowledge. */
  isConsistent: boolean;
  detail: string;
}
