/**
 * Application Behavior Model — Causal Graph (CP3)
 *
 * Deterministic derivation of CausalEdges (T1–T4), ProvenanceLinks, and
 * UnattributedConsequences from the artifacts CP2 episodes carry.
 *
 * Governing law (approved): "Causality is proven at initiation; ownership
 * is proven at observation."
 *   T1 (api / request-derived entity) — initiation-time proof (the
 *       request-start sourceEventId stamp). Arrival time NEVER affects
 *       ownership: a row stamped to an episode emits to that episode even
 *       when it completes after a later anchor.
 *   T2 (navigation) — initiation-time proof (commit lineage reaching a
 *       navigation member of the episode).
 *   T3 (state / entity / notification / counter transitions) — observation
 *       facts recorded by StateBuilder inside the episode's members.
 *   T4 (ui observations from evidence windows) — observation facts claimed
 *       by the uiOwnership horizon owning the document at observation.
 *
 * Ownership rules encoded:
 *   - next-anchor closes uiOwnership only; attribution (already-initiated
 *     T1/T2 work) is NEVER closed by a new anchor.
 *   - post-anchor observations → latest-anchor-wins, capped 0.5 unless a
 *     T1/T3 fact corroborates the same carrier interaction.
 *   - ref uniqueness: one canonical EvidenceRef key → at most one owning
 *     edge, enforced by the registry in deterministic construction order
 *     (T1 → T2 → T3 → T4, CER-5 episode order). NO DUAL OWNERSHIP.
 *   - insufficient proof → UnattributedConsequence. NEVER a guessed edge.
 *   - provenance links are separate objects, never edges; CP3 emits none
 *     rather than guess (surface semantics is a known capture gap).
 *
 * Ordering domain (R3): recorded epoch milliseconds only; document-local
 * values never order across documents. Tie ladder: epoch → global
 * batchIndex → id lexical.
 *
 * This module MUST NOT: read stores, spawn timers, perform I/O, re-derive
 * entities from raw bodies (StateBuilder owns that), or touch
 * capture/attribution/ledger internals.
 */

import type {
  ActionEpisode,
  CausalEdge,
  RefDegradation,
  UnattributedConsequence,
  BehaviorModelWarning,
} from './model-types';
import {
  canonicalDegradations,
  createRefRegistry,
  evidenceRefKey,
  ref,
  refSummary,
} from './evidence-refs';
import { compareInteractionIds } from '../state-builder/interaction-ordering';
import type { StateTransition } from '../state-builder/types';
import type { EpisodeBuilderInteraction } from './episode-builder';

// ═════════════════════════════════════════════════════════════════════════
// Inputs (tolerant subsets of captured artifacts)
// ═════════════════════════════════════════════════════════════════════════

/** Network row subset (superset of CP2's BuilderNetworkRow). */
export interface GraphNetworkRow {
  requestId?: string;
  url?: string;
  method?: string;
  status?: number | null;
  sourceEventId?: string;
  requestBody?: Record<string, string>;
  degradation?: RefDegradation[];
}

/** Evidence payload attached to an interaction, subset. */
export interface GraphEvidence {
  windowId: string;
  sourceEventId: string;
  /** Document-local openedAt (performance.now) — NOT epoch. */
  openedAt: number;
  domChangeCount: number;
  domChangeOverflow: number;
  newSurfaces: Array<{ accessibleName: string | null }>;
  removedSurfaces: Array<{ accessibleName: string | null }>;
  visibilityChanges: number;
  navigation: Array<{ type: string; fromUrl: string | null; toUrl: string | null }>;
  synthesized?: boolean;
  endReason?: string;
}

/** One evidence window with its epoch interval (from the carrier record). */
export interface GraphInteractionEvidence {
  interactionId: string;
  evidence: GraphEvidence;
  windowOpenedEpochMs: number;
  windowClosedEpochMs: number;
}

export interface CausalGraphInput {
  episodes: ActionEpisode[];
  /** Raw interaction records (trigger/event/tab lookup). */
  interactions: EpisodeBuilderInteraction[];
  networkRows?: GraphNetworkRow[];
  postNavRecords?: Array<{
    navEventId: string;
    committedAt: number;
    fromUrl: string;
    toUrl: string;
  }>;
  stateTransitions?: StateTransition[];
  evidenceWindows?: GraphInteractionEvidence[];
}

export interface CausalGraphResult {
  episodes: ActionEpisode[];
  unattributed: UnattributedConsequence[];
  provenanceLinks: [];
  warnings: BehaviorModelWarning[];
  /** Registry diagnostics: every claimed canonical ref key, sorted. */
  claimedRefKeys: string[];
}

// ═════════════════════════════════════════════════════════════════════════
// Confidence floors / caps
// ═════════════════════════════════════════════════════════════════════════

export const TIER_CONFIDENCE_FLOORS: Record<CausalEdge['tier'], number> = {
  'T1-stamp': 0.9,
  'T2-lineage': 0.85,
  'T3-transition': 0.7,
  'T4-window': 0.6,
};

/** Cap for observations claimed by a later episode after a previous
 *  anchor, unless corroborated (approved latest-anchor-wins rule). */
export const POST_ANCHOR_CAP = 0.5;

function lex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ═════════════════════════════════════════════════════════════════════════
// Main derivation
// ═════════════════════════════════════════════════════════════════════════

export function deriveCausalGraph(input: CausalGraphInput): CausalGraphResult {
  const registry = createRefRegistry();
  const warnings: BehaviorModelWarning[] = [];
  const modelUnattributed: UnattributedConsequence[] = [];

  // Clone episodes so the input is never mutated.
  const episodes: ActionEpisode[] = input.episodes.map((e) => ({
    ...e,
    edges: [],
    provenanceLinks: [],
    unattributed: [],
  }));
  const byId = new Map(episodes.map((e) => [e.id, e]));
  const rawById = new Map(input.interactions.map((i) => [i.interactionId, i]));

  /** trigger + member event ids → owning member, per episode. */
  const eventOwnersByEpisode = new Map<string, Map<string, { interactionId: string; role: string }>>();
  const interactionRolesByEpisode = new Map<string, Map<string, string>>();
  for (const ep of episodes) {
    const owners = new Map<string, { interactionId: string; role: string }>();
    const roles = new Map<string, string>();
    for (const m of ep.members) {
      roles.set(m.interactionId, m.role);
      const raw = rawById.get(m.interactionId);
      const triggerId = raw?.triggerEvent?.eventId;
      if (triggerId) owners.set(triggerId, { interactionId: m.interactionId, role: m.role });
      for (const e of raw?.memberEvents ?? []) {
        if (e?.eventId) owners.set(e.eventId, { interactionId: m.interactionId, role: m.role });
      }
    }
    eventOwnersByEpisode.set(ep.id, owners);
    interactionRolesByEpisode.set(ep.id, roles);
  }

  function emit(
    episodeId: string,
    edge: Omit<CausalEdge, 'id'>,
  ): CausalEdge | null {
    const ep = byId.get(episodeId);
    if (!ep) return null;
    // Ref-uniqueness gate: EVERY ref must be unclaimed.
    for (const r of edge.evidenceRefs) {
      const existing = registry.ownerOf(r);
      if (existing !== null) {
        warnings.push({
          code: 'ref-conflict-skipped',
          message: `Edge from ${edge.from.episodeId} (${edge.kind}) skipped: ref ${refSummary(r)} already owned by ${existing}.`,
          refs: [edge.from.episodeId, evidenceRefKey(r), existing],
        });
        return null;
      }
    }
    const id = `edge-${edge.from.episodeId}-${String(ep.edges.length).padStart(3, '0')}`;
    const full: CausalEdge = { ...edge, id };
    for (const r of full.evidenceRefs) registry.tryClaim(r, id);
    ep.edges.push(full);
    return full;
  }

  // Deterministic pass order: T1 → T2 → T3 → T4; episodes in CER-5 order.

  // ── T1: API rows stamped (at request START) with an episode-owned event ──
  const t1RowsByEpisode = new Map<string, Array<{ row: GraphNetworkRow; carrier: string }>>();
  for (const row of input.networkRows ?? []) {
    if (!row.requestId || !row.sourceEventId) continue; // unstamped → not T1
    for (const ep of episodes) {
      const owner = eventOwnersByEpisode.get(ep.id)?.get(row.sourceEventId);
      if (!owner) continue;
      const list = t1RowsByEpisode.get(ep.id) ?? [];
      list.push({ row, carrier: owner.interactionId });
      t1RowsByEpisode.set(ep.id, list);
    }
  }
  for (const ep of episodes) {
    const list = (t1RowsByEpisode.get(ep.id) ?? []).sort((a, b) =>
      lex(a.row.requestId ?? '', b.row.requestId ?? ''),
    );
    for (const { row, carrier } of list) {
      const degradation = canonicalDegradations(row.degradation);
      const requestId = row.requestId as string;
      emit(ep.id, {
        from: { episodeId: ep.id, interactionId: carrier },
        to: { type: 'api', requestId },
        kind: 'api',
        tier: 'T1-stamp',
        confidence: TIER_CONFIDENCE_FLOORS['T1-stamp'],
        latencyMs: null, // completion latency not derivable at emission time
        detail: `${row.method ?? 'GET'} ${row.url ?? requestId} initiated during ${ep.id}`,
        evidenceRefs: [ref.request(requestId, degradation)],
      });
    }
  }

  // ── T2: navigation lineage (navigation members) ───────────────────────
  for (const ep of episodes) {
    const navMembers = ep.members
      .filter((m) => m.role === 'navigation')
      .sort((a, b) => compareInteractionIds(a.interactionId, b.interactionId));
    for (const navMember of navMembers) {
      const rawNav = rawById.get(navMember.interactionId);
      const navEventId = rawNav?.triggerEvent?.eventId;
      if (!navEventId) continue;
      const record = input.postNavRecords?.find((p) => p.navEventId === navEventId);
      const toUrl =
        record?.toUrl ?? rawNav?.triggerEvent?.pageUrl ?? rawNav?.trigger?.href ?? '';
      const degradation: RefDegradation[] = toUrl ? [] : ['missing-window'];
      emit(ep.id, {
        from: { episodeId: ep.id, interactionId: navMember.interactionId },
        to: { type: 'navigation', navEventId, toUrl },
        kind: 'navigation',
        tier: 'T2-lineage',
        confidence: TIER_CONFIDENCE_FLOORS['T2-lineage'],
        latencyMs: record
          ? Math.max(0, record.committedAt - ep.anchor.triggerTimestamp)
          : null,
        detail: `navigation committed to ${toUrl || '(url unknown)'}`,
        evidenceRefs: [ref.nav(navEventId, degradation)],
      });
    }
  }

  // ── T3: state / entity / notification / counter transitions ──────────
  for (const ep of episodes) {
    const roles = interactionRolesByEpisode.get(ep.id);
    if (!roles) continue;
    const transitions = (input.stateTransitions ?? [])
      .filter((t) => roles.has(t.interactionId))
      .sort((a, b) => compareInteractionIds(a.interactionId, b.interactionId));

    for (const t of transitions) {
      const transitionRef = ref.transition(`st-${t.interactionId}`);

      // View change
      const viewBefore = t.before.currentView?.id ?? null;
      const viewAfter = t.after.currentView?.id ?? null;
      if (viewBefore !== viewAfter && (viewBefore !== null || viewAfter !== null)) {
        emit(ep.id, {
          from: { episodeId: ep.id, interactionId: t.interactionId },
          to: {
            type: 'state',
            from: viewBefore ?? '(none)',
            to: viewAfter ?? '(none)',
          },
          kind: 'state',
          tier: 'T3-transition',
          confidence: TIER_CONFIDENCE_FLOORS['T3-transition'],
          latencyMs: null,
          detail: `view ${viewBefore ?? '(none)'} → ${viewAfter ?? '(none)'}`,
          evidenceRefs: [transitionRef],
        });
      }

      // New entities (recorded by StateBuilder — never re-derived here).
      // Request-derived entities (an API-op change on the same carrier with
      // a T1 api edge) are T1; DOM-only observations are T3.
      // StateBuilder's change formats:
      //   `cart-item entity (from API, productId=<value>)`
      //   `<type> entity (from API registry)`
      // — they name the entity TYPE, not the full `<type>:<id>`.
      const entityIds = [...t.after.entities.keys()].sort(lex);
      for (const entityId of entityIds) {
        const entity = t.after.entities.get(entityId);
        if (!entity || entity.firstSeenAt !== t.interactionId) continue;
        const fromApi = t.changes.some(
          (c) =>
            c.includes('from API') &&
            (c.includes(entity.type) ||
              c.includes(entityId) ||
              (entity.attributes.productId !== undefined &&
                c.includes(String(entity.attributes.productId)))),
        );
        const tier = fromApi && epHasT1For(ep, t.interactionId) ? 'T1-stamp' : 'T3-transition';
        const confidence =
          tier === 'T1-stamp'
            ? TIER_CONFIDENCE_FLOORS['T1-stamp']
            : TIER_CONFIDENCE_FLOORS['T3-transition'];
        emit(ep.id, {
          from: { episodeId: ep.id, interactionId: t.interactionId },
          to: { type: 'entity', entityId, operation: 'create' },
          kind: 'entity',
          tier,
          confidence,
          latencyMs: null,
          detail: `entity ${entityId} (${entity.type}) created${fromApi ? ' from API' : ''}`,
          evidenceRefs: [ref.entity(entityId, t.interactionId)],
        });
      }

      // Notifications appearing at this interaction
      for (const n of t.after.notifications) {
        if (n.appearedAt !== t.interactionId) continue;
        emit(ep.id, {
          from: { episodeId: ep.id, interactionId: t.interactionId },
          to: { type: 'ui', summary: `notification: ${n.text}` },
          kind: 'notification',
          tier: 'T3-transition',
          confidence: TIER_CONFIDENCE_FLOORS['T3-transition'],
          latencyMs: null,
          detail: `notification "${n.text}" (${n.severity}) appeared`,
          evidenceRefs: [ref.event(n.id)],
        });
      }

      // Counter deltas observed at this interaction
      const counterIds = [...t.after.counters.keys()].sort(lex);
      for (const counterId of counterIds) {
        const counter = t.after.counters.get(counterId);
        const value = counter?.values.find((v) => v.interactionId === t.interactionId);
        if (!value || value.delta === null || value.delta === 0) continue;
        const to = Number(value.value);
        const from = to - value.delta;
        emit(ep.id, {
          from: { episodeId: ep.id, interactionId: t.interactionId },
          to: { type: 'state', from: `${counterId}=${from}`, to: `${counterId}=${to}` },
          kind: 'state',
          tier: 'T3-transition',
          confidence: TIER_CONFIDENCE_FLOORS['T3-transition'],
          latencyMs: null,
          detail: `counter ${counterId} ${from} → ${to}`,
          evidenceRefs: [transitionRef],
        });
      }
    }
  }

  // ── T4: evidence windows claimed by uiOwnership horizons ─────────────
  for (const w of input.evidenceWindows ?? []) {
    const windowTab =
      rawById.get(w.interactionId)?.triggerEvent?.captureOrigin?.tabId ?? null;

    const candidates = episodes.filter((ep) => {
      const ui = ep.horizon.uiOwnership;
      const overlaps =
        w.windowOpenedEpochMs < (ui.closedAtMs ?? Number.POSITIVE_INFINITY) &&
        w.windowClosedEpochMs >= ui.openedAtMs;
      const sameTab = ep.tabId === null || windowTab === null || ep.tabId === windowTab;
      return overlaps && sameTab;
    });

    if (candidates.length === 0) {
      modelUnattributed.push({
        id: `unattr-ui-${w.interactionId}`,
        observedKind: 'ui',
        evidenceRef: ref.dom(w.evidence.windowId, 0),
        reason: 'no-live-horizon',
        observedAtMs: w.windowOpenedEpochMs,
        tabId: windowTab,
        detail: `evidence window ${w.evidence.windowId} lies outside every uiOwnership horizon`,
      });
      continue;
    }

    // Latest-anchor-wins; tie → CER-5.
    candidates.sort(
      (a, b) =>
        b.horizon.uiOwnership.openedAtMs - a.horizon.uiOwnership.openedAtMs ||
        compareInteractionIds(a.anchor.interactionId, b.anchor.interactionId),
    );
    const winner = candidates[0];

    // Post-anchor cap unless a T1/T3 edge corroborates the same carrier.
    const crossedAnchor = episodes.some(
      (ep) =>
        ep.id !== winner.id && ep.anchor.triggerTimestamp <= w.windowOpenedEpochMs,
    );
    const corroborated = winner.edges.some(
      (e) =>
        (e.tier === 'T1-stamp' || e.tier === 'T3-transition') &&
        e.from.interactionId === w.interactionId,
    );
    const confidence =
      crossedAnchor && !corroborated
        ? Math.min(TIER_CONFIDENCE_FLOORS['T4-window'], POST_ANCHOR_CAP)
        : TIER_CONFIDENCE_FLOORS['T4-window'];

    const degradation: RefDegradation[] = [];
    if (w.evidence.domChangeOverflow > 0) degradation.push('capped-window');
    if (w.evidence.synthesized) degradation.push('synthesized-evidence');

    emit(winner.id, {
      from: { episodeId: winner.id, interactionId: w.interactionId },
      to: { type: 'ui', summary: uiSummary(w.evidence) },
      kind: 'ui',
      tier: 'T4-window',
      confidence,
      latencyMs: Math.max(0, w.windowOpenedEpochMs - winner.anchor.triggerTimestamp),
      detail: `UI observations on ${w.interactionId}: ${uiSummary(w.evidence)}`,
      evidenceRefs: [ref.dom(w.evidence.windowId, 0, degradation)],
    });
  }

  // ── Provenance links ─────────────────────────────────────────────────
  // Case 7 (action on a surface created by an earlier episode) requires
  // surface semantics that capture does not yet provide. CP3 emits NO
  // provenance links rather than guess; the surface lineage surfaces via
  // the model's per-episode T4/T3 edges instead. This is the documented
  // capture insufficiency (plan §13), not a derivation gap.

  return {
    episodes,
    unattributed: modelUnattributed,
    provenanceLinks: [],
    warnings,
    claimedRefKeys: registry.claimedKeys(),
  };
}

// ── helpers ─────────────────────────────────────────────────────────────

function epHasT1For(ep: ActionEpisode, interactionId: string): boolean {
  return ep.edges.some((e) => e.tier === 'T1-stamp' && e.from.interactionId === interactionId);
}

function uiSummary(w: GraphEvidence): string {
  const parts: string[] = [`${w.domChangeCount} DOM changes`];
  if (w.newSurfaces.length) parts.push(`${w.newSurfaces.length} new surfaces`);
  if (w.removedSurfaces.length) parts.push(`${w.removedSurfaces.length} removed surfaces`);
  if (w.visibilityChanges) parts.push(`${w.visibilityChanges} visibility changes`);
  return parts.join(', ');
}
