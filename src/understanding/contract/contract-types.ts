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
