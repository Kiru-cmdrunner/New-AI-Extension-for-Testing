/**
 * Application Behavior Model — Core Types (CP1)
 *
 * The derived, application-agnostic causal model that turns a session of
 * independent interaction records into a graph of user-level actions and
 * their proven consequences.
 *
 * Governing law (approved architecture):
 *   "Causality is proven at initiation; ownership is proven at observation."
 *   - T1/T2 consequences carry initiation-time proof (request-start stamp,
 *     commit lineage) bound to an episode BEFORE any later anchor exists —
 *     arrival time is irrelevant to their owner.
 *   - T3/T4 consequences carry observation-time facts only and belong to the
 *     episode whose UI-ownership horizon owns the document at observation.
 *
 * Design constraints:
 *   - Pure derivation layer. Nothing in these types requires capture,
 *     attribution, ledger, StateBuilder, or OutcomeDeterminer changes.
 *   - Deterministic: every ID is derived from recorded identifiers only —
 *     no wall-clock reads, no randomness. Generated-at/session metadata is
 *     injected by the orchestrator's caller, never produced here.
 *   - Ref uniqueness: one EvidenceRef canonical key maps to at most one
 *     CausalEdge per model (a consequence never belongs to two episodes).
 *
 * Architecture: .drytis/specs/application-behavior-model.md (planned)
 * Design:       revised coding design R1–R7 (approved)
 */

import type { InteractionType } from '../../shared/component-types';
import type {
  ActionOutcome,
  ConfidenceLevel,
  OutcomeCategory,
} from '../outcome/outcome-types';

// ═════════════════════════════════════════════════════════════════════════
// Evidence references
// ═════════════════════════════════════════════════════════════════════════

/**
 * RefDegradation — known, principled reasons an EvidenceRef carries less
 * proof than its kind normally would. Recorded so the model can reason
 * about certainty WITHOUT inventing causality to compensate.
 *
 * These are conditions of the underlying captured record, discovered by
 * derivation — never speculative flags.
 */
export type RefDegradation =
  /** The owning network row lacks a captured request body (bridge/drain-joined
   *  rows). Entity extraction impossible for this row; api shape still exact. */
  | 'body-less-row'
  /** The referenced evidence record is marked synthesized by capture
   *  (e.g. synthetic navigation placeholder evidence). */
  | 'synthesized-evidence'
  /** The observation was captured inside a window that hit its hard cap or
   *  closed before stabilization (window may have missed later mutations). */
  | 'capped-window'
  /** The observation's originating window is absent from the record set —
   *  the mutation exists but its owning window cannot be resolved. */
  | 'missing-window'
  /** The carrier interaction record is malformed (missing triggerEvent or
   *  eventId) and could only be placed by interval containment. */
  | 'malformed-trigger'
  /** The evidence lived past the episode's attribution tail cap
   *  (ATTRIBUTION_TAIL_MS) — owner is provable but proof is time-expired. */
  | 'tail-capped'
  /** The relationship was joined across locator grammars (identity form ↔
   *  DOM-path form) via chain containment rather than exact id agreement —
   *  B7-P3 surface-reuse provenance. The match is real; the bridging is
   *  imperfect. */
  | 'degraded-chain-join';

/**
 * EvidenceRef — a stable, typed pointer to ONE captured artifact.
 * NEVER a copy of artifact content: consumers resolve refs against the
 * session's stores.
 *
 * Ref uniqueness law: within one AppBehaviorModel, a ref's canonical key
 * (evidenceRefKey()) may be owned by at most ONE CausalEdge. tryClaim()
 * enforces this mechanically.
 */
export type EvidenceRef =
  | {
      kind: 'request';
      /** requestId — join key to NetworkActivity rows and the ledger. */
      requestId: string;
      degradation?: RefDegradation[];
    }
  | {
      kind: 'event';
      /** ObservedEvent.eventId — the ledger's primary evidence unit. */
      eventId: string;
      degradation?: RefDegradation[];
    }
  | {
      kind: 'transition';
      /** StateTransition id (state-builder). */
      transitionId: string;
      degradation?: RefDegradation[];
    }
  | {
      kind: 'entity';
      /** Derived entity id as recorded by understanding (e.g. 'cart-item:B0FFF9VPMN'). */
      entityId: string;
      /** Interaction whose understanding produced the entity. */
      interactionId: string;
      degradation?: RefDegradation[];
    }
  | {
      kind: 'dom';
      /** Observation window id the mutation was captured in. */
      windowId: string;
      /** Mutation-sequence number inside that window (0-based). */
      sequence: number;
      degradation?: RefDegradation[];
    }
  | {
      kind: 'nav';
      /** navigation event id (navEventId) — full-reload lineage key. */
      navEventId: string;
      degradation?: RefDegradation[];
    };

/** The six artifact kinds an EvidenceRef can point at. */
export type EvidenceRefKinds = EvidenceRef['kind'];

// ═════════════════════════════════════════════════════════════════════════
// Episodes
// ═════════════════════════════════════════════════════════════════════════

/**
 * The deliberate user action that anchors the episode. Exactly one per
 * episode; members derive from it (R3 boundary rules).
 *
 * Anchor eligibility mirrors DISCRETE_ACTION_TYPES (evidence-ledger.ts) —
 * the model CONSUMES that classification, never redefines it.
 */
export type EpisodeAnchor = {
  /** The anchor interaction's id. */
  interactionId: string;
  /** Recorded action type (click/contextmenu/mousedown/keydown/dragstart/drop). */
  actionType: InteractionType;
  /** Accessible name of the acted-on element, from the recorded definition. */
  actionTarget: string;
  /** Recorded trigger timestamp (epoch ms) — the episode's T₀. */
  triggerTimestamp: number;
};

/**
 * Role a member interaction plays inside its episode.
 *
 * - 'anchor'      — the deliberate action (unique).
 * - 'companion'   — browser-generated semantic child of the anchor's
 *                   lifecycle (e.g. native submit following an input-type=
 *                   submit click) — NOT itself an anchor (submit is not in
 *                   DISCRETE_ACTION_TYPES).
 * - 'parameter'   — a TextEntry/parameter input linked to the anchor
 *                   (form-overlap or same-lifecycle), input to the action,
 *                   not caused by it.
 * - 'navigation'  — a document transition committed while the episode was
 *                   live (T2 lineage); its DESTINATION observations follow
 *                   observation-ownership rules and may belong to a later
 *                   episode's horizon.
 * - 'unclassified'— a malformed interaction retained by interval
 *                   containment (never silently dropped, R4).
 */
export type EpisodeMemberRole =
  | 'anchor'
  | 'companion'
  | 'parameter'
  | 'navigation'
  | 'unclassified';

export interface EpisodeMember {
  /** The member interaction's id. */
  interactionId: string;
  /** Role inside this episode. */
  role: EpisodeMemberRole;
  /**
   * True when the member is a derived (non-anchor) member whose record is
   * malformed — the model retains it, flagged, instead of dropping it.
   */
  degraded?: boolean;
}

/**
 * A parameter input linked to the anchor: part of WHAT the user did, never
 * a consequence. Linked (not caused) by form-overlap or shared lifecycle.
 */
export interface ParameterInput {
  interactionId: string;
  /** Recorded semantic role where known (e.g. search text, quantity). */
  label: string | null;
  /** Recorded value snapshot at commit time, where captured. */
  value: string | null;
}

/**
 * ConsequenceHorizon — the two independent windows every episode carries
 * (approved split-horizon law).
 *
 * Both domains are ordered EXCLUSIVELY in recorded epoch milliseconds
 * (R3). captureSeq/performance.now values are document-local and may only
 * break ties WITHIN one document, never order across documents.
 */
export interface ConsequenceHorizon {
  /**
   * UI-ownership horizon — which episode may claim NEW T3/T4 observations.
   * Opens at the anchor trigger timestamp (T₀). Closes at the earliest of:
   * the next anchor on the same tab (CER-5 order), member stabilization
   * (max member end time), recording stop, or an unrelated navigation.
   */
  uiOwnership: {
    openedAtMs: number;
    closedAtMs: number | null /** null = still open at model build */;
    closeReason: UiOwnershipCloseReason | null;
  };
  /**
   * Attribution horizon — which episode owns completions of ALREADY-INITIATED
   * T1/T2 work, regardless of arrival time. Opens at T₀. Closes only when
   * every pending request id reaches a terminal ledger status, or the tail
   * cap (ATTRIBUTION_TAIL_MS after uiOwnership close), or recording stop.
   * A NEW ANCHOR NEVER CLOSES IT.
   */
  attribution: {
    openedAtMs: number;
    closedAtMs: number | null;
    closeReason: AttributionCloseReason | null;
    /** Request ids initiated inside the horizon and still unsettled. */
    pendingRequestIds: string[];
  };
}

export type UiOwnershipCloseReason =
  | 'next-anchor' /** a later deliberate action on the same tab */
  | 'stabilized' /** all members ended and settled */
  | 'recording-stop'
  | 'unrelated-navigation'; /** navigation whose lineage does not reach this episode */

export type AttributionCloseReason =
  | 'all-stamped-settled' /** every pending request reached terminal status */
  | 'tail-capped' /** ATTRIBUTION_TAIL_MS elapsed after uiOwnership close */
  | 'recording-stop';

/** Attribution tail: how long after uiOwnership close T1 completions may
 *  still claim this episode (proof remains exact; the cap bounds memory). */
export const ATTRIBUTION_TAIL_MS = 30_000;

/** Window in which a corroborating T1/T3 fact may lift a capped 0.5
 *  post-anchor observation to full confidence. */
export const CORROBORATION_WINDOW_MS = 2_000;

/**
 * How a parameter input was linked to the anchor — provenance for the
 * LINK (inputs are never causal edges).
 */
export type ParameterLink =
  | 'form-overlap' /** input shares a form with the anchor's target */
  | 'same-lifecycle'; /** input shares the anchor's component lifecycle */

// ═════════════════════════════════════════════════════════════════════════
// Causal edges
// ═════════════════════════════════════════════════════════════════════════

/**
 * Proof tier of a causal edge. Higher tier = stronger initiation-time
 * (or observation-time) evidence; tiers never mix to "average up"
 * confidence (R1/R4 rules).
 *
 * - 'T1-stamp'       — request-start stamp. Causality proven at initiation.
 * - 'T2-lineage'     — navigation commit lineage reaching a member.
 *                      Causality proven at initiation (commit lineage).
 * - 'T3-transition'  — state/entity transition delta inside a horizon.
 *                      Observation-time fact; confidences apply.
 * - 'T4-window'      — window-local DOM/surface/visibility capture.
 *                      Observation-time fact; confidences apply.
 */
export type EdgeTier = 'T1-stamp' | 'T2-lineage' | 'T3-transition' | 'T4-window';

/**
 * What an edge points AT: either an episode member (a navigation member,
 * the anchor's own window) or an observable consequence class.
 */
export type EdgeTarget =
  | { type: 'member'; interactionId: string; role: EpisodeMemberRole }
  | { type: 'api'; requestId: string }
  | { type: 'navigation'; navEventId: string; toUrl: string }
  | { type: 'state'; from: string; to: string }
  | { type: 'entity'; entityId: string; operation: 'create' | 'update' | 'read' }
  | { type: 'ui'; summary: string };

/**
 * CausalEdge — one PROVEN consequence relationship.
 *
 * R1 ownership rule (load-bearing): `from.episodeId` is the OWNING episode.
 * `from.interactionId` is the CARRIER — the member whose artifact the edge
 * cites — and is provenance metadata ONLY. A carrier is never a second
 * owner: the same EvidenceRef cannot be owned by two episodes because
 * edge construction claims refs exclusively, in deterministic order.
 */
export interface CausalEdge {
  /** Deterministic: 'edge-<ownerEpisodeId>-<seq>' (seq assigned in emission order). */
  id: string;
  from: {
    /** OWNING episode. */
    episodeId: string;
    /** CARRIER member whose recorded artifact the edge cites. */
    interactionId: string;
  };
  /** The consequence this edge proves. */
  to: EdgeTarget;
  kind: EdgeKind;
  tier: EdgeTier;
  /** 0–1. Floors by tier: T1 0.9, T2 0.85, T3 0.7, T4 0.6. Post-anchor
   *  observations are capped at 0.5 unless corroborated. */
  confidence: number;
  /** Recorded latency from anchor T₀ to consequence, where measurable (ms). */
  latencyMs: number | null;
  /** Human-readable one-liner for downstream surfaces. */
  detail: string;
  /** Proven, sorted, deduplicated evidence refs backing this edge. */
  evidenceRefs: EvidenceRef[];
  /** Edge-level degradations (from its refs, plus edge-specific ones). */
  degradation?: RefDegradation[];
}

export type EdgeKind =
  | 'api'
  | 'navigation'
  | 'state'
  | 'entity'
  | 'ui'
  | 'notification';

/**
 * ProvenanceLink — a NON-causal relationship between two episodes: e.g. a
 * later action operating on a surface created by an earlier episode.
 * Emits no CausalEdge and never affects confidence; it exists so agents
 * can follow surface lineage without mistaking it for causality.
 */
export interface ProvenanceLink {
  /** Deterministic: 'prov-<sourceEpisodeId>-<targetEpisodeId>'. */
  id: string;
  /** Episode that owns the creation of the surface. */
  sourceEpisodeId: string;
  /** Episode whose anchor operated on that surface. */
  targetEpisodeId: string;
  kind: 'surface-reuse' | 'entity-reuse';
  /** Ref proving the surface/entity creation (owned by source). */
  evidenceRefs: EvidenceRef[];
}

// ═════════════════════════════════════════════════════════════════════════
// Unattributed consequences
// ═════════════════════════════════════════════════════════════════════════

/**
 * UnattributedConsequence — a captured consequence with NO episode owning
 * it under the rules. Kept, timestamped, and classified by WHY it is
 * unattributed. The model NEVER assigns these to a guessed episode.
 */
export interface UnattributedConsequence {
  /** Deterministic: 'unattr-<kind>-<artifactKey>'. */
  id: string;
  observedKind: EdgeKind;
  /** Ref to the artifact (never owned by any edge). */
  evidenceRef: EvidenceRef;
  reason:
    | 'no-live-horizon' /** no episode's horizons were open at observation */
    | 'outside-horizon' /** arrived after every relevant horizon closed */
    | 'proof-less' /** no T1/T2 initiation proof and no corroborating link */;
  /** Recorded observation/arrival time (epoch ms). */
  observedAtMs: number;
  /** Tab the observation occurred on, where known. */
  tabId: number | null;
  detail: string;
}

// ═════════════════════════════════════════════════════════════════════════
// Episode + outcome
// ═════════════════════════════════════════════════════════════════════════

/**
 * EpisodeOutcome — the episode-level outcome derived by merging member
 * ActionOutcomes with OutcomeDeterminer's existing weight table (pure
 * helper reuse — the class itself is never instantiated here).
 */
export interface EpisodeOutcome {
  outcome: OutcomeCategory;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** Member ids whose votes dominated, for audit. */
  contributingMembers: string[];
  /** Provenance label — always 'derived-episode-outcome'. */
  derivation: 'derived-episode-outcome';
}

export interface ActionEpisode {
  /** Deterministic: 'ep-<anchorInteractionId>'. */
  id: string;
  anchor: EpisodeAnchor;
  /** Anchor + derived members (companion/parameter/navigation/unclassified). */
  members: EpisodeMember[];
  /** Parameter inputs linked to the anchor (never causal). */
  parameterInputs: Array<ParameterInput & { link: ParameterLink }>;
  /** Proven consequence edges owned by this episode. */
  edges: CausalEdge[];
  /** Provenance links TO this episode's surfaces/entities. */
  provenanceLinks: ProvenanceLink[];
  /** Consequences observed inside this episode's window that no rules
   *  could own. Escalated to the model level, never guessed. */
  unattributed: UnattributedConsequence[];
  horizon: ConsequenceHorizon;
  /** Derived episode outcome (null while no member has an ActionOutcome). */
  episodeOutcome: EpisodeOutcome | null;
  /** The tab the anchor fired on. */
  tabId: number | null;
}

// ═════════════════════════════════════════════════════════════════════════
// Model root + coverage
// ═════════════════════════════════════════════════════════════════════════

/**
 * CoverageStats — honest accounting of what the derivation could and
 * could not prove. Surfaced so consumers (and tests) can audit the model
 * instead of trusting a silent aggregate.
 */
export interface CoverageStats {
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
}

export interface AppBehaviorModel {
  /** Model id: deterministic 'abm-<sessionId>'. */
  id: string;
  /** Recorded session id (injected by orchestrator caller — never read here). */
  sessionId: string;
  /** All episodes, anchor CER-5 order. */
  episodes: ActionEpisode[];
  /** Consequences with no owning episode (union of episode-level sets). */
  unattributed: UnattributedConsequence[];
  /** Cross-episode provenance links. */
  provenanceLinks: ProvenanceLink[];
  /** Derived at a caller-injected timestamp (never wall-clock inside derivation). */
  generatedAtMs: number;
  coverage: CoverageStats;
  /** Non-fatal derivation warnings (malformed members, degraded refs, …). */
  warnings: BehaviorModelWarning[];
}

export interface BehaviorModelWarning {
  code:
    | 'malformed-member-retained'
    | 'malformed-interaction-dropped'
    | 'degraded-evidence'
    | 'unknown-tab-resolution'
    | 'ref-conflict-skipped'
    | 'unprovable-edge-dropped';
  message: string;
  /** Ids of affected episodes/interactions/refs. */
  refs: string[];
}

/**
 * Convenience re-export so CP2+ modules can import outcome types from one
 * place. Re-exports do NOT duplicate logic.
 */
export type { ActionOutcome, OutcomeCategory, ConfidenceLevel };
