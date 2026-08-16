/**
 * CP5 — capture-inputs adapter: production capture artifacts → CP1–CP4
 * Behavior Model inputs.
 *
 * Wiring layer ONLY (spec: .drytis/specs/cp5-pipeline-wiring.md). This module
 * routes read-only inputs into `deriveBehaviorModel`; it adds no causal rules,
 * no ordering, no clock, no I/O. CP1–CP4 semantics are consumed as-is.
 *
 * Purity: no Date.now / Math.random / performance.now; inputs never mutated;
 * output arrays preserve input order (CP2/CP3 own deterministic sorting).
 *
 * Epochization (R3): evidence windows are documented in performance.now()
 * time (document-local); the graph needs epoch ms. The window's epoch anchor
 * is resolved EXACTLY by finding the carrier interaction's event whose
 * eventId === evidence.sourceEventId and using its ObservedEvent.timestamp
 * (a Date.now() epoch, component-types.ts). When the event is missing or its
 * timestamp is invalid, the window is DROPPED — no timestamp is ever guessed.
 * A dropped window yields no T4 edge downstream (CP3's absent-window rules);
 * this is honest degradation, not data loss (capture retains the raw
 * evidence untouched).
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { PostNavCaptureRecord } from '../../shared/post-nav-types';
import type { StampedRequest } from '../../background/evidence-attribution';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { StateTransition } from '../state-builder/types';
import type { GraphInteractionEvidence, GraphNetworkRow } from './causal-graph';
import type { EpisodeBuilderInteraction } from './episode-builder';

/** A network row as it appears attached to interaction evidence. */
type AttachedNetworkRow = {
  url: string;
  method: string;
  status?: number | null;
  sourceEventId?: string;
  requestId?: string;
  requestBody?: Record<string, string>;
};

/** Minimal behavioral-evidence shape the adapter reads (structural type). */
type InteractionEvidence = {
  applicationEvidence?: {
    networkActivity?: AttachedNetworkRow[];
  };
};

/** Session-scoped capture artifacts from the service worker. */
export interface CaptureArtifacts {
  /** From DurableAttributionLedger.snapshotStamped() — JSON-safe already. */
  stampedRequests: StampedRequest[];
  /** Post-nav records retained at consume time for this session (R1). */
  postNavRecords: PostNavCaptureRecord[];
}

/** Assembled inputs for deriveBehaviorModel (CP4 orchestrator). */
export interface BehaviorModelInputs {
  interactions: EpisodeBuilderInteraction[];
  networkRows: GraphNetworkRow[];
  evidenceWindows: GraphInteractionEvidence[];
  postNavRecords: Array<{ navEventId: string; committedAt: number; fromUrl: string; toUrl: string }>;
  actionOutcomes: Array<{ interactionId: string; outcome: ActionOutcome }>;
  stateTransitions: StateTransition[];
}

/** Is `value` a finite number usable as an epoch ms timestamp? */
function isValidEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Resolve the epoch ms for an evidence window carried by an interaction.
 *
 * The carrier's triggerEvent and memberEvents are the session's epoch domain
 * (CP2 uses the same domain for anchors and horizons). Returns null when the
 * source event cannot be found or its timestamp is invalid — callers must
 * drop the window, never substitute a guess.
 */
function resolveWindowEpoch(
  interaction: ComponentInteraction,
  sourceEventId: string,
): number | null {
  const candidates: Array<{ eventId?: string; timestamp: unknown }> = [];
  if (interaction.triggerEvent) {
    candidates.push({
      eventId: interaction.triggerEvent.eventId,
      timestamp: interaction.triggerEvent.timestamp,
    });
  }
  for (const member of interaction.memberEvents ?? []) {
    candidates.push({ eventId: member.eventId, timestamp: member.timestamp });
  }
  for (const candidate of candidates) {
    if (candidate.eventId === sourceEventId && isValidEpochMs(candidate.timestamp)) {
      return candidate.timestamp;
    }
  }
  return null;
}

/** Map a stamped request to the graph's row shape (subset mapping only). */
function toNetworkRow(request: StampedRequest): GraphNetworkRow {
  // documentRequest / mainFrame / captureOrigin are attribution-internal;
  // the graph's T1 rule keys on sourceEventId + status semantics only.
  return {
    requestId: request.requestId,
    url: request.url,
    method: request.method,
    status: request.status === 0 ? null : request.status,
    sourceEventId: request.sourceEventId,
    requestBody: request.requestBody,
  };
}

/**
 * T1 source assembly — the union of the two capture-path survivors, deduped
 * by the globally-unique webRequest requestId (exactly-once):
 *
 *  1. ATTACHED rows: the live attach path (BEHAVIORAL_EVIDENCE handler →
 *     ledger.attachToInteractions → LIVE_INTERACTIONS persist →
 *     acknowledgePersisted) lands stamped requests on
 *     interaction.behavioralEvidence.applicationEvidence.networkActivity and
 *     durably DELETES them from the ledger (delete-after-persist, INV-5).
 *     By STOP the ledger no longer contains them — the interactions do.
 *     Rows there carry sourceEventId + requestId only on webRequest-sourced
 *     entries; main-world / performance-observer rows are unstamped → skip
 *     (the graph never emits T1 from unstamped rows anyway).
 *
 *  2. SNAPSHOT rows: ledger.snapshotStamped() at STOP — recovery leftovers
 *     only (crash survivors, pre-completion captures not yet attached).
 *
 * Dedup: same requestId may appear in both (an attached row whose ledger
 * copy survived). The snapshot copy wins status ties; an attached row with
 * a real status enriches a null-status snapshot duplicate (upgrade-only,
 * mirroring the ledger's own merge semantics). requestId is unique per HTTP
 * request, so one requestId → one T1 edge (exactly-once).
 */
function assembleNetworkRows(
  interactions: ComponentInteraction[],
  stampedRequests: StampedRequest[],
): GraphNetworkRow[] {
  const byRequestId = new Map<string, GraphNetworkRow>();

  // (1) attached rows, in stable interaction then array order.
  for (const interaction of interactions) {
    const network =
      (interaction.behavioralEvidence as InteractionEvidence | undefined)
        ?.applicationEvidence?.networkActivity ?? [];
    for (const row of network) {
      if (!row.requestId || !row.sourceEventId) continue; // unstamped → not T1
      if (!byRequestId.has(row.requestId)) {
        byRequestId.set(row.requestId, {
          requestId: row.requestId,
          url: row.url,
          method: row.method,
          status: row.status == null ? null : row.status,
          sourceEventId: row.sourceEventId,
          requestBody: row.requestBody,
        });
      }
    }
  }

  // (2) snapshot rows (recovery leftovers), enriching/deduping by requestId.
  for (const request of stampedRequests) {
    if (!request.requestId) continue; // no dedup key → unusable
    const mapped = toNetworkRow(request);
    const existing = byRequestId.get(request.requestId);
    if (!existing) {
      byRequestId.set(request.requestId, mapped);
    } else if (existing.status == null && mapped.status != null) {
      existing.status = mapped.status; // upgrade-only status enrichment
    }
  }

  return [...byRequestId.values()];
}

/**
 * Assemble BehaviorModelInputs from production capture artifacts and
 * Stage 1–3 pipeline outputs. Pure: never mutates any input.
 */
export function extractBehaviorModelInputs(
  interactions: ComponentInteraction[],
  transitions: StateTransition[],
  outcomes: Map<string, ActionOutcome>,
  artifacts: CaptureArtifacts | null,
): BehaviorModelInputs {
  const networkRows: GraphNetworkRow[] = assembleNetworkRows(
    interactions,
    artifacts?.stampedRequests ?? [],
  );

  // Post-nav subset pass-through (navType is not consumed by the graph).
  const postNavRecords = (artifacts?.postNavRecords ?? []).map((r) => ({
    navEventId: r.navEventId,
    committedAt: r.committedAt,
    fromUrl: r.fromUrl,
    toUrl: r.toUrl,
  }));

  // Evidence windows: epochize from the carrier's own events; drop windows
  // whose source event is unresolvable (R3 — no guessed timestamps).
  const evidenceWindows: GraphInteractionEvidence[] = [];
  for (const interaction of interactions) {
    const evidence = interaction.behavioralEvidence as
      | (NonNullable<ComponentInteraction['behavioralEvidence']> & InteractionEvidence)
      | undefined;
    if (!evidence || !evidence.sourceEventId) continue;
    const epoch = resolveWindowEpoch(interaction, evidence.sourceEventId);
    if (epoch === null) continue; // dropped — honest degradation
    const durationMs = evidence.window?.durationMs;
    if (!isValidEpochMs(durationMs)) continue; // dropped — no valid window span
    evidenceWindows.push({
      interactionId: interaction.interactionId,
      evidence: {
        windowId: evidence.windowId,
        sourceEventId: evidence.sourceEventId,
        openedAt: evidence.window.openedAt,
        domChangeCount: evidence.applicationEvidence.domChanges.length,
        domChangeOverflow: evidence.applicationEvidence.domChangeOverflow,
        newSurfaces: evidence.applicationEvidence.newSurfaces.map((s) => ({
          accessibleName: s.accessibleName ?? null,
        })),
        removedSurfaces: evidence.applicationEvidence.removedSurfaces.map((s) => ({
          accessibleName: s.accessibleName ?? null,
        })),
        visibilityChanges: evidence.applicationEvidence.visibilityChanges.length,
        navigation: evidence.applicationEvidence.navigation.map((n) => ({
          type: n.type,
          fromUrl: n.fromUrl ?? null,
          toUrl: n.toUrl ?? null,
        })),
        synthesized: evidence.window.endReason === 'page-reload-synthetic',
        endReason: evidence.window.endReason,
      },
      windowOpenedEpochMs: epoch,
      windowClosedEpochMs: epoch + durationMs,
    });
  }

  // Outcomes: keyed pairs (CP4 contract) — insertion order preserved.
  const actionOutcomes: Array<{ interactionId: string; outcome: ActionOutcome }> = [];
  for (const [interactionId, outcome] of outcomes) {
    actionOutcomes.push({ interactionId, outcome });
  }

  return {
    // Read-only view cast: EpisodeBuilderInteraction is ComponentInteraction
    // with triggerEvent optional — structurally compatible, never mutated.
    interactions: interactions as EpisodeBuilderInteraction[],
    networkRows,
    evidenceWindows,
    postNavRecords,
    actionOutcomes,
    stateTransitions: transitions,
  };
}
