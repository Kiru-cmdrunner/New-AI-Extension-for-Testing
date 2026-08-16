/**
 * Application Behavior Model — Orchestrator (CP4)
 *
 * Pure composition: episodes (CP2) → causal graph (CP3) → episode
 * outcomes (CP4) → AppBehaviorModel with coverage stats.
 *
 * The orchestrator performs NO I/O and reads no clock — sessionId and
 * generatedAtMs are INJECTED by the caller (boundary C of the approved
 * data flow). Downstream wiring (Stage 3.5, persistence) is CP5/CP6.
 *
 * This module MUST NOT: mutate its inputs, decide ownership (that is
 * CP2/CP3 territory), touch capture/attribution/StateBuilder/
 * OutcomeDeterminer internals, or import pipeline persistence.
 */

import type {
  AppBehaviorModel,
  CoverageStats,
  BehaviorModelWarning,
  EpisodeOutcome,
} from './model-types';
import { buildEpisodes, type EpisodeBuilderInput } from './episode-builder';
import {
  deriveCausalGraph,
  type CausalGraphInput,
} from './causal-graph';
import { deriveEpisodeOutcome } from './episode-outcome';
import type { ActionOutcome } from '../outcome/outcome-types';
import { compareInteractionIds } from '../state-builder/interaction-ordering';

// ── inputs ──────────────────────────────────────────────────────────────

/** Everything the orchestrator needs (superset of CP2/CP3 inputs). */
export interface BehaviorModelInput extends Omit<EpisodeBuilderInput, 'postNavRecords'> {
  /** Session id (injected — never derived here). */
  sessionId: string;
  /** Model-build timestamp (injected — derivation never reads the clock). */
  generatedAtMs: number;
  /** Per-interaction recorded outcomes (CP4 consumes as votes). */
  actionOutcomes?: Array<{ interactionId: string; outcome: ActionOutcome }>;
  /** Extra CP3 inputs beyond EpisodeBuilderInput. */
  postNavRecords?: CausalGraphInput['postNavRecords'];
  stateTransitions?: CausalGraphInput['stateTransitions'];
  evidenceWindows?: CausalGraphInput['evidenceWindows'];
}

export interface BehaviorModelResult {
  model: AppBehaviorModel;
  /** Builder diagnostics not carried on the model. */
  unownedInteractionIds: string[];
  warnings: BehaviorModelWarning[];
}

// ── orchestrator ────────────────────────────────────────────────────────

export function deriveBehaviorModel(input: BehaviorModelInput): BehaviorModelResult {
  const {
    sessionId,
    generatedAtMs,
    actionOutcomes,
    stateTransitions,
    evidenceWindows,
    ...builderInput
  } = input;

  // Stage 1 — episodes.
  const built = buildEpisodes(builderInput);

  // Stage 2 — causal graph.
  const graph = deriveCausalGraph({
    episodes: built.episodes,
    interactions: builderInput.interactions,
    networkRows: builderInput.networkRows,
    postNavRecords: builderInput.postNavRecords,
    stateTransitions,
    evidenceWindows,
  });

  // Stage 3 — episode outcomes (member-vote merge over recorded outcomes).
  const memberOutcomes = new Map(
    (actionOutcomes ?? []).map((o) => [o.interactionId, o.outcome]),
  );

  // DDC-5 mirror: an episode's evidence is degraded when any evidence
  // window carried by one of its members (anchor included) hit its DOM
  // change cap — the determiner's degraded-window signal available in the
  // CP3 input subset (mainThreadBlocked/coarseMode are not carried there).
  // Detected from the input windows, NEVER from edge existence: edges are
  // consequences, and their presence/absence must not alter the flag.
  const memberIdsByEpisode = new Map<string, Set<string>>();
  for (const ep of graph.episodes) {
    memberIdsByEpisode.set(
      ep.id,
      new Set(ep.members.map((m) => m.interactionId)),
    );
  }
  const degradedEpisodes = new Set<string>();
  for (const w of evidenceWindows ?? []) {
    if ((w.evidence.domChangeOverflow ?? 0) <= 0) continue;
    for (const [episodeId, ids] of memberIdsByEpisode) {
      if (ids.has(w.interactionId)) degradedEpisodes.add(episodeId);
    }
  }

  const episodesWithOutcomes = graph.episodes.map((ep) => {
    const outcome: EpisodeOutcome | null = deriveEpisodeOutcome({
      episode: ep,
      memberOutcomes,
      degraded: degradedEpisodes.has(ep.id),
    });
    return { ...ep, episodeOutcome: outcome };
  });

  // Stage 4 — coverage stats (honest accounting, deterministic counts).
  // memberInteractions counts NON-anchor members only (the anchor is
  // already counted once by anchoredInteractions — one anchor per episode).
  const memberIds = new Set(
    episodesWithOutcomes.flatMap((ep) =>
      ep.members.filter((m) => m.role !== 'anchor').map((m) => m.interactionId),
    ),
  );
  const apiEdgeRequestIds = new Set(
    episodesWithOutcomes.flatMap((ep) =>
      ep.edges
        .filter((e) => e.kind === 'api' && e.to.type === 'api')
        .map((e) => (e.to as { requestId: string }).requestId),
    ),
  );
  const uiEdges = episodesWithOutcomes.flatMap((ep) => ep.edges.filter((e) => e.kind === 'ui'));

  const coverage: CoverageStats = {
    totalInteractions: builderInput.interactions.length,
    anchoredInteractions: episodesWithOutcomes.length,
    memberInteractions: memberIds.size,
    malformedInteractions: episodesWithOutcomes
      .flatMap((ep) => ep.members)
      .filter((m) => m.degraded).length,
    totalNetworkRows: builderInput.networkRows?.length ?? 0,
    attributedNetworkRows: apiEdgeRequestIds.size,
    totalObservations: evidenceWindows?.length ?? 0,
    attributedObservations: uiEdges.length,
    unattributedConsequences: graph.unattributed.length,
    provenanceLinks: graph.provenanceLinks.length,
  };

  const warnings = [...built.warnings, ...graph.warnings];

  const model: AppBehaviorModel = {
    id: `abm-${sessionId}`,
    sessionId,
    episodes: episodesWithOutcomes,
    unattributed: graph.unattributed,
    provenanceLinks: graph.provenanceLinks,
    generatedAtMs,
    coverage,
    warnings,
  };

  return {
    model,
    unownedInteractionIds: built.unownedInteractionIds,
    warnings,
  };
}

/** Convenience export for consumers ordering episodes CER-5 themselves. */
export { compareInteractionIds };
