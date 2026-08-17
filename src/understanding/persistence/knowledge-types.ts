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

// -- Recorded Workflow (DDC-4) --

/**
 * Persisted cross-session workflow pattern.
 * Mirrors enrichment RecordedWorkflow but with persistence metadata.
 */
export interface KnowledgeRecordedWorkflowRow {
  /** Compound key: appId + ':' + patternId. */
  key: string;
  /** App scope. */
  appId: string;
  /** Stable hash of the canonical step sequence. */
  patternId: string;
  /** Human label. */
  label: string;
  /** Canonical step sequence (intent names). */
  canonicalSteps: string[];
  /** View transition pattern. */
  viewSequence: string[];
  /** Sessions where this pattern was observed. */
  sessionIds: string[];
  /** Total occurrences across all sessions. */
  occurrenceCount: number;
  /** Workflow instance IDs (bounded — last MAX_WORKFLOW_INSTANCES kept). */
  instances: string[];
  /**
   * D6: behavior-signature keys co-occurring with this pattern (sorted,
   * deduped union across instances). Undefined on rows written before D6.
   */
  signatureIds?: string[];
  /** D6: 'linked' once any signature co-occurs; else 'linkage-pending'. */
  linkageState?: 'linked' | 'linkage-pending';
  /**
   * D6: per-instance linkage — instance id → sorted signature keys whose
   * anchors are steps of that instance. Keys pruned to the bounded
   * instances list. Undefined on rows written before D6.
   */
  instanceSignatureIds?: Record<string, string[]>;
  /** Epoch ms first seen. */
  firstSeenAt: number;
  /** Epoch ms last seen. */
  lastSeenAt: number;
}

// -- Constants --

export const MAX_COUNTER_HISTORY = 100;
export const MAX_NOTIFICATIONS_PER_APP = 500;
export const MAX_TRANSITIONS_PER_SESSION = 500;
export const MAX_WORKFLOW_INSTANCES = 200;

// ── CP6: Application Knowledge Repository (behavior strata) ──────────────
// Architecture: .drytis/specs/cp6-knowledge-repository.md
// Two strata: session-scoped observation facts (append-only, evictable) and
// cross-session generalized action knowledge (merged, confidence-scored).

/**
 * Stratum 1 — session manifest for one recording session's behavior model.
 * Idempotency anchor (key = appId:sessionId), per-app monotonic seq source,
 * behaviorVersion derivation source, FIFO eviction manifest.
 */
export interface KnowledgeBehaviorSessionRow {
  /** Compound key: `${appId}:${sessionId}`. */
  key: string;
  appId: string;
  sessionId: string;
  /** Per-app monotonic session sequence (assigned inside the write tx). */
  seq: number;
  /** From AppBehaviorModel.generatedAtMs (never a new clock read). */
  generatedAtMs: number;
  episodeCount: number;
  edgeCount: number;
  gapCount: number;
  /** Verbatim coverage stats from the model. */
  coverage: {
    totalInteractions: number;
    anchoredInteractions: number;
    memberInteractions: number;
    malformedInteractions: number;
    totalNetworkRows: number;
    attributedNetworkRows: number;
    totalObservations: number;
    attributedObservations: number;
    unattributedConsequences: number;
    provenanceLinks: number;
  };
  /** Deterministic hash of the session's sorted view id set. */
  viewSetHash: string;
  /** Deterministic hash of the session's sorted signature key set. */
  signatureSetHash: string;
  /** Bounded copy of model warnings (code + message + refs). */
  warnings: Array<{ code: string; message: string; refs: string[] }>;
}

/**
 * Stratum 1 — one action episode as observed in one session. Append-only.
 */
export interface KnowledgeEpisodeRow {
  /** Compound key: `${appId}:${sessionId}:${episodeId}`. */
  key: string;
  appId: string;
  sessionId: string;
  episodeId: string;
  anchor: {
    interactionId: string;
    actionType: string;
    actionTarget: string;
    triggerTimestamp: number;
  };
  members: Array<{ interactionId: string; role: string; degraded?: boolean }>;
  horizonAttribution: {
    openedAtMs: number;
    closedAtMs: number | null;
    closeReason: string | null;
  };
  horizonUiOwnership: {
    openedAtMs: number;
    closedAtMs: number | null;
    closeReason: string | null;
  };
  parameterInputs: Array<{
    interactionId: string;
    label: string | null;
    value: string | null;
    link: string;
  }>;
  episodeOutcome: {
    outcome: string;
    confidence: number;
    confidenceLevel: string;
    derivation: string;
  } | null;
  tabId: number | null;
  /** Back-reference to the generalized action signature (Stratum 2). */
  signatureKey: string;
}

/**
 * Stratum 1 — one proven causal edge from one session. Append-only.
 * `refJson` preserves EvidenceRef[] verbatim (JSON) — no reinterpretation.
 * `fromEpisodeId` (owner) and `fromInteractionId` (carrier) stay distinct.
 */
export interface KnowledgeEdgeRow {
  /** Compound key: `${appId}:${sessionId}:${edgeId}` — edgeId itself embeds episode + seq. */
  key: string;
  appId: string;
  sessionId: string;
  episodeId: string;
  edgeId: string;
  /** Position of the edge inside the episode's emission order. */
  edgeSeq: number;
  tier: 'T1-stamp' | 'T2-lineage' | 'T3-transition' | 'T4-window';
  kind: string;
  detail: string;
  confidence: number;
  latencyMs: number | null;
  /** OWNING episode (never collapses with the carrier). */
  fromEpisodeId: string;
  /** CARRIER member whose recorded artifact the edge cites. */
  fromInteractionId: string;
  /** Edge target, stored as-is (discriminated by `kind`). */
  to: Record<string, unknown>;
  /** EvidenceRef[] verbatim as JSON. */
  refJson: string;
  /** Back-reference to the generalized action signature. */
  signatureKey: string;
}

/**
 * Stratum 1 — an unattributed consequence gap from one session.
 */
export interface KnowledgeGapRow {
  /** Compound key: `${appId}:${sessionId}:${gapId}`. */
  key: string;
  appId: string;
  sessionId: string;
  gapId: string;
  observedKind: string;
  reason: string;
  detail: string;
  observedAtMs: number;
  tabId: number | null;
  /** The gap's single EvidenceRef verbatim as JSON. */
  windowRefJson: string;
}

/**
 * One generalized consequence inside a signature's profile. Identity:
 * `tier|kind|targetIdentity` (FROZEN v1 grammar).
 */
export interface KnowledgeConsequence {
  /** `${tier}|${kind}|${targetIdentity}`. */
  identity: string;
  tier: string;
  kind: string;
  /** Generalized target identity (api → METHOD path; entity → type:op; …). */
  targetIdentity: string;
  /** Total observations of this consequence for this signature. */
  occurrenceCount: number;
  /** Sessions (of those where the signature was seen) containing it. */
  hitCount: number;
  /** Consecutive signature-observed sessions since last hit (exact count —
   * increments ONLY when the signature is observed without this consequence;
   * resets to 0 on a hit). Divergence/staleness derive from this, never
   * from seq distance (which over-counts across recording gaps). */
  missedObservations: number;
  firstSeenAtSession: string;
  lastSeenAtSession: string;
  /** Manifest seq of the session that last observed this consequence. */
  lastSeenSeq: number;
  /** Recurrence confidence 0–1 (deterministic formula, recomputed on merge). */
  confidence: number;
  status: 'active' | 'stale' | 'diverged';
  /** Bounded evidence ring: last MAX_EVIDENCE_SAMPLES distinct sessions. */
  evidenceSamples: KnowledgeEvidenceSample[];
  /** How observed — e.g. 'behavior/webrequest'. */
  observedVia: string;
}

export interface KnowledgeEvidenceSample {
  sessionId: string;
  /** Edge row key (resolvable inside that session's stratum-1 rows). */
  edgeKey: string;
}

/**
 * Stratum 2 — the generalized action signature. THE knowledge unit:
 * "app X + actionType + normalizedTarget + anchorView → recurring
 * consequence profile". Identity frozen at v1.
 */
export interface KnowledgeActionSignatureRow {
  /** `${appId}:sig:${hash}`. */
  key: string;
  appId: string;
  actionType: string;
  normalizedTarget: string;
  anchorViewId: string | null;
  firstSeenAtSession: string;
  lastSeenAtSession: string;
  /** Session seq of first/last observation. */
  firstSeenSeq: number;
  lastSeenSeq: number;
  /** From session manifests' generatedAtMs (never a new clock read). */
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  occurrenceCount: number;
  /** Sessions since the signature itself was last observed. */
  sessionsSinceSeen: number;
  /** Signature-level status: 'stale' once sessionsSinceSeen exceeds
   * STALE_AFTER_SESSIONS (recomputed at merge/read time). Consequence-level
   * 'diverged' lives on profile entries. */
  status: 'active' | 'stale';
  source: 'behavior';
  /** Reserved: future external writers tag their origin system here. */
  originSystem?: string;
  consequenceProfile: KnowledgeConsequence[];
  /** Consequence identities that have diverged (flag-only, never deleted). */
  divergenceFlags: string[];
}

// ── CP6 constants ──
export const MAX_BEHAVIOR_SESSIONS_PER_APP = 50;
export const MAX_EPISODES_PER_SESSION = 200;
export const MAX_EDGES_PER_SESSION = 1000;
export const MAX_GAPS_PER_SESSION = 200;
export const MAX_CONSEQUENCES_PER_SIGNATURE = 48;
export const MAX_EVIDENCE_SAMPLES = 5;
export const STALE_AFTER_SESSIONS = 10;
export const DIVERGENCE_AFTER_SESSIONS = 3;
