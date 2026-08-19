/**
 * CP8 — Knowledge Consumer Contract v1 — TYPES
 *
 * The stable, versioned, READ-ONLY interface between the Behavioral
 * Knowledge Repository (CP1–CP7, frozen source of truth) and every future
 * consumer: Playwright generation+execution, API testing, database
 * validation, Agents/Assistants, LLM layers.
 *
 * Boundary rules enforced here:
 * - Every field is sourced VERBATIM from repository rows or is explicitly
 *   unavailable with a reason. There is no third state — nothing is
 *   derived, guessed, or silently reinterpreted.
 * - Effective status uses the exact CP7 read-time formula
 *   (currentSeq − lastSeenSeq > STALE_AFTER_SESSIONS ⇒ 'stale').
 * - Evidence references are returned verbatim (refJson); identities follow
 *   the FROZEN v1 grammar (tier|kind|targetIdentity).
 * - No mutation surface exists anywhere in this module.
 */

// ── Version ────────────────────────────────────────────────────────────

/** Contract compatibility version. Additive-only within a major version. */
export const CONTRACT_VERSION = 1 as const;

// ── Typed absence ──────────────────────────────────────────────────────

/**
 * Why a field a future consumer wants is not present. Absence is data:
 * consumers degrade gracefully instead of guessing.
 */
export type AbsenceReason =
  /** Durable selectors are not captured by the recording layer. */
  | 'capture-ceiling'
  /** Request/response bodies are never recorded (CP1–CP7 invariant). */
  | 'payload-unrecorded'
  /** No workflow row exists for the app yet — nothing recorded. */
  | 'none-recorded'
  /** Workflow rows exist but none co-occurs with this signature. */
  | 'linkage-pending'
  /** No database oracle exists in the core repository. */
  | 'db-ground-truth-unavailable'
  /** Payload of the field was FIFO-evicted with its session (R7). */
  | 'session-evicted';

/**
 * D6: workflow-linkage outcome for an action descriptor.
 * 'linked' carries the pattern ids; otherwise an absence reason applies.
 */
export type WorkflowLinkage =
  | { state: 'linked'; workflowPatternIds: string[] }
  | { state: 'absent'; reason: Extract<AbsenceReason, 'none-recorded' | 'linkage-pending'> };

/** A value that is not captured/available, with its reason. */
export interface Unavailable<T = string> {
  value: null;
  reason: AbsenceReason;
  /** What the field WOULD be once available (consumer documentation). */
  wouldBe: T;
}

// ── Shared value objects ───────────────────────────────────────────────

/** Evidence sample reference (resolvable deep-link into Stratum-1 rows). */
export interface EvidenceSampleRef {
  sessionId: string;
  edgeKey: string;
  /** False when the sample's session was FIFO-evicted — citation degrades,
   *  never disappears silently (R7). */
  resolvable: boolean;
}

/** Lifecycle of a generalized consequence, as of read time. */
export type ConsequenceLifecycle = 'active' | 'stale' | 'diverged';

/** Provenance of a knowledge row. */
export type KnowledgeProvenance = 'behavior' | 'external' | 'execution';

// ── DTOs ───────────────────────────────────────────────────────────────

/** One generalized consequence inside an action's profile. */
export interface ConsequenceDescriptor {
  /** FROZEN v1 grammar: `${tier}|${kind}|${targetIdentity}`. */
  identity: string;
  tier: string;
  kind: string;
  targetIdentity: string;
  /** Sessions that contained the consequence. */
  hitCount: number;
  /** Boundary sessions since last hit (reset on hit). */
  missedObservations: number;
  /** Recurrence confidence [0,1] — repository-computed, returned verbatim. */
  confidence: number;
  lifecycle: ConsequenceLifecycle;
  firstSeenAtSession: string;
  lastSeenAtSession: string;
  evidenceSamples: EvidenceSampleRef[];
}

/** Observed parameter input on the signature's richest retained episode. */
export interface ParameterInputDescriptor {
  interactionId: string;
  label: string | null;
  value: string | null;
}

// ── Phase 4b — observed post-conditions (read-side projection) ────────

/** Read-side vocabulary for observed state changes. */
export type StateChangeKind =
  | 'counter-delta'
  | 'entity-created'
  | 'notification'
  | 'view-change'
  | 'state-other';

/**
 * One recurring observed state change for an action signature — a
 * READ-SIDE projection of consequenceProfile entries with kind
 * 'state' | 'entity' | 'notification' (api/nav/ui consequences stay in
 * `consequences`, the causal inventory; both derive from the same
 * persisted source, so they can never disagree).
 *
 * Persisted counter identities are value-bearing (`cart=3→cart=4`), so
 * `identity` is generalized at READ time (counter id before the first
 * '=') while `valueChange` keeps the last-observed raw pair. Unknown
 * formats degrade honestly to 'state-other' + the raw string. NOTE:
 * notification edges persist window-level granularity ('anchor-window' /
 * 'post-anchor' identities) — the notification TEXT is only in the edge
 * detail, reachable via getConsequenceEvidence deep-link; the projection
 * never reinterprets persisted identities.
 */
export interface StateChangeDescriptor {
  changeKind: StateChangeKind;
  /** Generalized identity: counter id, 'type:op', notification text (≤60), or 'a→b' view ids. */
  identity: string;
  /** Raw value pair from the persisted identity ('3→4') when present, else null. */
  valueChange: string | null;
  occurrenceCount: number;
  hitCount: number;
  missedObservations: number;
  confidence: number;
  lifecycle: ConsequenceLifecycle;
  firstSeenAtSession: string;
  lastSeenAtSession: string;
  evidenceSamples: EvidenceSampleRef[];
  /** How observed — e.g. 'behavior/dom-observer'. */
  observedVia: string;
}

/** One action signature — the unit "what does this action do?" answers. */
export interface ActionDescriptor {
  signatureKey: string;
  appId: string;
  actionType: string;
  normalizedTarget: string;
  anchorViewId: string | null;
  occurrenceCount: number;
  /** CP7 read-time effective status. */
  status: 'active' | 'stale';
  sessionsSinceSeen: number;
  firstSeenAtSession: string;
  lastSeenAtSession: string;
  lastSeenSeq: number;
  /** Durable locator (CSS/role/aria) — capture ceiling, always null in v1. */
  selector: Unavailable<'css:role:aria locator'>;
  /**
   * D6: workflow linkage — patterns whose instances co-occur with this
   * signature (anchor inside the instance). Empty when not linked.
   */
  workflowPatternIds: string[];
  /**
   * D6: 'linked' when workflowPatternIds is populated; otherwise the typed
   * absence ('none-recorded' = no workflow rows for the app,
   * 'linkage-pending' = rows exist, none co-occur with this signature).
   */
  workflowPatternAbsence: 'linked' | AbsenceReason;
  parameterInputs: ParameterInputDescriptor[];
  consequences: ConsequenceDescriptor[];
  /**
   * Phase 4b — read-side projection of state/entity/notification
   * consequences into observed post-conditions (generalized identities,
   * last-observed value pairs). Empty when no state consequences recorded.
   */
  observedStateChanges: StateChangeDescriptor[];
  divergenceFlags: string[];
}

/** Fully resolved evidence: the deep-link join behind a sample ref. */
export interface EvidenceDescriptor {
  sessionId: string;
  edgeKey: string;
  tier: string;
  kind: string;
  detail: string;
  confidence: number;
  latencyMs: number | null;
  /** OWNING episode (causality is proven at initiation). */
  fromEpisodeId: string;
  /** CARRIER member whose recorded artifact the edge cites. */
  fromInteractionId: string;
  /** EvidenceRef[] verbatim as JSON — never reinterpreted. */
  refJson: string;
  resolvable: boolean;
}

/** One ordered step in a reconstructed workflow (the generation input). */
export interface WorkflowStep {
  /** CER-5 episode order within the session. */
  order: number;
  episodeId: string;
  signatureKey: string;
  actionType: string;
  actionTarget: string;
  parameterInputs: ParameterInputDescriptor[];
  episodeOutcome: {
    outcome: string;
    confidence: number;
    derivation: string;
  } | null;
  /** Causal edges owned by this episode, emission order (edgeSeq asc). */
  edges: Array<{
    edgeId: string;
    tier: string;
    kind: string;
    detail: string;
    confidence: number;
  }>;
  // ── Phase 4b — observed post-conditions per step (read-side join with
  // persisted state-transition rows; IN-field when the row is retained) ──
  /** Anchor interaction id — the join key for transition rows. */
  interactionId: string;
  /** Persisted state-change summary strings for this interaction. */
  stateChanges: string[];
  /** Entity ids recorded as new/updated at this interaction. */
  affectedEntities: string[];
  fromViewId: string | null;
  toViewId: string | null;
  /**
   * Honest typing (workflowPatternAbsence pattern): 'observed' when the
   * retained row carries change strings; 'observed-none' when a transition
   * row exists with an empty changes list; 'rows-not-retained' when no row
   * survives (cap eviction 500/session or never recorded).
   */
  stateChangeAbsence: 'observed' | 'observed-none' | 'rows-not-retained';
}

/** Full ordered causal trace of one recorded session. */
export interface WorkflowTrace {
  appId: string;
  sessionId: string;
  seq: number;
  generatedAtMs: number;
  steps: WorkflowStep[];
  /** Honest gaps observed in this session (interleaved by observedAtMs). */
  gaps: Array<{
    gapId: string;
    observedKind: string;
    reason: string;
    detail: string;
    observedAtMs: number;
  }>;
}

/** Aggregated API endpoint in the app's observed surface. */
export interface ApiSurfaceEntry {
  /** Generalized identity from the frozen grammar: `METHOD /path`. */
  identity: string;
  method: string;
  path: string;
  /** Distinct sessions observing the endpoint. */
  sessionCount: number;
  /** Signature keys of actions whose episodes emitted this edge. */
  originActions: string[];
  evidenceSamples: EvidenceSampleRef[];
  /** Request/response bodies are never captured. */
  payloadSchema: 'unrecorded';
}

/** Aggregated entity operation derived from API activity. */
export interface EntityDescriptor {
  /** `${type}:${operation}` from the frozen grammar. */
  identity: string;
  sessionCount: number;
  originActions: string[];
  evidenceSamples: EvidenceSampleRef[];
}

/** Directed edge in navigation/state graphs (aggregated across sessions). */
export interface GraphEdge {
  from: string;
  to: string;
  /** Number of sessions containing this transition. */
  sessionCount: number;
  evidenceSamples: EvidenceSampleRef[];
}

/** Honest-uncertainty surface of an app. */
export interface GapReport {
  total: number;
  byReason: Array<{ reason: string; count: number }>;
  recent: Array<{
    sessionId: string;
    gapId: string;
    observedKind: string;
    reason: string;
    detail: string;
    observedAtMs: number;
  }>;
}

/** Top-level application descriptor. */
export interface ApplicationDescriptor {
  appId: string;
  origin: string;
  label: string;
  behaviorVersion: number;
  currentSeq: number;
  signatureCount: number;
  retainedSessionCount: number;
  gapTotal: number;
  /** Capabilities the contract can vouch for today. */
  capabilities: {
    dbGroundTruth: 'unavailable';
  };
}

/** Response envelope — the version travels with every payload. */
export interface ContractEnvelope<T> {
  contractVersion: typeof CONTRACT_VERSION;
  data: T;
}

// ── Phase 5a — API test seeds (read-side, additive) ────────────────────

/**
 * Attribution of one network request to a user interaction.
 * Only 'event-stamped' rows (DurableAttributionLedger CER stamps:
 * sourceEventId + requestId present, webRequest-sourced) may carry causal
 * expected-post-conditions. 'window-inferred' rows rode the same evidence
 * window but were not stamped — their post-conditions are
 * observed-alongside, never expected-of.
 */
export type ApiSeedAttribution = 'event-stamped' | 'window-inferred';

/** One expected post-condition of an API seed, from observed UI state. */
export type ApiPostCondition =
  | {
      kind: 'counter';
      /** FROZEN identity grammar (e.g. 'DIV#cart-count'). */
      identity: string;
      value: number;
      operator: 'equals';
    }
  | {
      kind: 'collection';
      identity: string;
      count: number;
    }
  | {
      kind: 'entity-present';
      /** entityId (e.g. 'cart-item:B0VAL1'). Presence only — never values. */
      identity: string;
    }
  | {
      kind: 'ui-badge';
      identity: string;
      /** Distinctive non-numeric badge text, ≤200 chars, verbatim. */
      text: string;
    }
  | {
      kind: 'ui-notification';
      identity: string;
    };

/**
 * Phase 5a — one deterministic API test seed: a recorded request paired
 * with the resulting application state observed in the same evidence
 * window. Derived READ-ONLY from persisted evidence + knowledge rows.
 *
 * Honest-uncertainty fields never over-claim: bodies are 'unrecorded',
 * response verification 'unverified', and the UI basis states whether any
 * resulting-state snapshot backed the window. Phase 5b (response bodies)
 * and 5c (DB oracle) remain gated and out of scope here.
 */
export interface ApiTestSeed {
  /** `${sessionId}:${interactionId}:${requestId}` — deterministic. */
  seedId: string;
  appId: string;
  sessionId: string;
  /** The Click/Navigation interaction whose window carried the row. */
  interactionId: string;
  /**
   * Evidence-row sourceEventId (the interaction's trigger/member event).
   * Present when the interaction retained its event linkage.
   */
  sourceEventId: string | null;
  request: {
    /** HTTP method, verbatim from the network row. */
    method: string;
    /** Generalized query-free pathname (frozen grammar `METHOD /path`). */
    path: string;
    /** Observed status; null when unknown at capture time. */
    status: number | null;
    resourceType: 'xhr' | 'fetch' | 'unknown' | 'navigation' | 'resource';
    /**
     * KEYS ONLY of a parsed formData body (INV-5a-7: values are never
     * emitted — they may contain secrets). Sensitive-looking keys are
     * filtered by a small best-effort denylist.
     */
    bodyKeys: string[];
  };
  attribution: ApiSeedAttribution;
  /**
   * True when the seed's interaction carried MORE than one attributed
   * request — single-request causality cannot be claimed (INV-5a-3).
   */
  shared: boolean;
  /** True when identical (method,path) requests recur within the session
   *  (polling) — the seed represents the recurring endpoint, not one poll. */
  recurring: boolean;
  /**
   * Join to knowledge when the interaction's episode produced a signature;
   * null when no signature was recorded for the action.
   */
  action: { signatureKey: string; actionType: string; normalizedTarget: string } | null;
  /** Observed post-conditions, bounded (≤ MAX_POST_CONDITIONS_PER_SEED). */
  expectedPostConditions: ApiPostCondition[];
  honesty: {
    /** Request/response bodies are never captured (CP1–CP7). */
    payloadSchema: 'unrecorded';
    /** Response content is not verified by 5a (5b is gated). */
    responseBody: 'unverified';
    /** Whether a resulting-state snapshot backed this window. */
    uiBasis: 'content-observed' | 'none';
  };
  /** Mirrors the knowledge consequence confidence for this endpoint. */
  confidence: number;
  /** Citation; resolvable:false once the session is FIFO-evicted (R7). */
  evidenceRef: EvidenceSampleRef;
}

/**
 * Cap on expectedPostConditions per seed. Counters/collections/entities/
 * badges/notifications in priority order — same ranking the 4c assertion
 * derivation uses.
 */
export const MAX_POST_CONDITIONS_PER_SEED = 4;

/** Compact LLM-grounding block: pure formatting of contract data. */
export interface ActionContextBlock {
  action: string;
  performed: string;
  observed: Array<{
    consequence: string;
    confidence: number;
    lifecycle: ConsequenceLifecycle;
    sessions: number;
  }>;
  /**
   * Phase 4b — observed post-conditions as bounded plain-text lines
   * (≤ MAX_STATE_CHANGE_CONTEXT_LINES entries; '+N more' honesty row when
   * truncated). Pure formatting of ActionDescriptor.observedStateChanges.
   */
  stateChanges: string[];
  provenance: {
    signatureKey: string;
    appId: string;
    evidenceSamples: EvidenceSampleRef[];
  };
}

// ── Future ports (DECLARED, NOT IMPLEMENTED) ───────────────────────────

/**
 * Future additive writer for external knowledge (Jira, DBs, APIs).
 * Implementations live OUTSIDE the core and write rows tagged
 * source:'external' + originSystem into THEIR OWN additive stores —
 * never into behavioral stores, never mutating behavioral signatures.
 * Coexistence is by provenance; behavioral confidence is never adjusted
 * by external data.
 */
export interface ExternalKnowledgeWriter {
  readonly originSystem: string;
  /** Registers the writer's additive Dexie version (v4+), never v3 stores. */
  registerAdditiveStores(): Promise<void>;
}

/**
 * Execution result produced by the future Intelligence/Execution Layer.
 * CP8 declares the shape so executors have a stable target; the core does
 * NOT implement ingestion in v1.
 */
export interface ExecutionRecord {
  runId: string;
  executedAtMs: number;
  appId: string;
  /** Contract query consumed (for provenance of the expectation). */
  consumedQuery: string;
  /** Hash of the contract snapshot the expectations were built from. */
  contractSnapshotHash: string;
  expected: Array<{ identity: string; kind: string }>;
  actual: Array<{ identity: string; kind: string; observed: boolean }>;
  passed: boolean;
  artifactRefs: string[];
}

/**
 * Future feedback port. Ingests ExecutionRecords into NEW additive stores
 * (source:'execution'). MUST NEVER update knowledgeSignatures or any
 * Stratum-1 row. Correlation is read-time (join by appId/signatureKey).
 */
export interface ExecutionIngestionPort {
  ingest(record: ExecutionRecord): Promise<void>;
}
