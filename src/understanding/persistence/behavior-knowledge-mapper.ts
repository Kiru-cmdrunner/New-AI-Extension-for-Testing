/**
 * CP6 — Behavior Knowledge Mapper
 *
 * Pure translation of a session's AppBehaviorModel into Knowledge Repository
 * rows (Stratum 1) plus signature merge inputs (Stratum 2 seed).
 *
 * PURE: no clock, no randomness, no I/O, never mutates the model.
 * All identity keys are deterministic functions of content + (appId, sessionId).
 *
 * Architecture: .drytis/specs/cp6-knowledge-repository.md
 */

import type {
  AppBehaviorModel,
  CausalEdge,
  EvidenceRef,
} from '../behavior-model/model-types';
import type {
  KnowledgeBehaviorSessionRow,
  KnowledgeEdgeRow,
  KnowledgeEpisodeRow,
  KnowledgeGapRow,
} from './knowledge-types';
import type { SignatureMergeInput } from './behavior-knowledge-merge';
import type { StateTransition } from '../state-builder/types';

// ── Deterministic string hash (FNV-1a, 32-bit) ─────────────────────────

/**
 * Stable, deterministic, non-cryptographic content hash.
 * Same input → same output, forever (identity grammar frozen at v1).
 */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Normalize an action target: lowercase, trim, collapse whitespace. */
export function normalizeTarget(target: string): string {
  return target.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Signature identity ──────────────────────────────────────────────────

/**
 * Signature identity key: appId|actionType|normalizedTarget|anchorViewId.
 * FROZEN at v1 — any change requires an explicit recompute migration.
 */
export function signatureKey(
  appId: string,
  actionType: string,
  normalizedTarget: string,
  anchorViewId: string | null,
): string {
  return `${appId}:sig:${stableHash(
    `${appId}|${actionType}|${normalizedTarget}|${anchorViewId ?? '∅'}`,
  )}`;
}

// ── Consequence identity (generalization grammar) ───────────────────────

/**
 * Generalize a consequence target for cross-session identity. NEVER literal
 * DOM/URL — the grammar extracts the semantic invariant of the consequence.
 *
 *   api       → `METHOD /path`        host-stripped pathname (query excluded)
 *   entity    → `type:op`             entity type + operation
 *   nav       → `to:/path`            destination pathname (query excluded —
 *                                      per-session ids live in query strings)
 *   state     → `from→to`             view transition identity
 *   ui        → `anchor-window` | `post-anchor`   horizon role, never DOM
 *   member    → `member:<id>`         fallback (should not recur)
 */
export function consequenceTargetIdentity(edge: CausalEdge): string {
  const t = edge.to;
  switch (t.type) {
    case 'api':
      return apiIdentity(edge);
    case 'entity':
      return `${t.entityId.split(':')[0]}:${t.operation}`;
    case 'navigation':
      return `to:${navGeneralization(t.toUrl)}`;
    case 'state':
      return `${t.from ?? '∅'}→${t.to ?? '∅'}`;
    case 'ui':
      // Post-anchor cap is 0.5 (uncorroborated); anchor-owned windows carry
      // their tier floor (T4 0.6 / corroborated higher).
      return edge.confidence < 0.6 ? 'post-anchor' : 'anchor-window';
    case 'member':
      return `member:${t.interactionId}`;
    default:
      return 'unknown';
  }
}

/** Extract `METHOD /path` from an api edge's detail line. */
function apiIdentity(edge: CausalEdge): string {
  // detail is e.g. "POST http://127.0.0.1:8098/cart/add initiated during ep-int-9"
  const m = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+?)(?: |$)/.exec(edge.detail);
  if (m) {
    try {
      const u = new URL(m[2]);
      return `${m[1]} ${u.pathname}`;
    } catch {
      return `${m[1]} ${m[2]}`;
    }
  }
  return 'api';
}

/** Generalize a navigation destination to its pathname. */
function navGeneralization(toUrl: string): string {
  try {
    return new URL(toUrl).pathname;
  } catch {
    return toUrl;
  }
}

// ── observedVia (how the consequence was observed) ──────────────────────

/** Source label for a consequence, from its evidence ref kinds. */
function observedVia(refs: EvidenceRef[]): string {
  const kinds = new Set(refs.map((r) => r.kind));
  if (kinds.has('request')) return 'behavior/webrequest';
  if (kinds.has('nav')) return 'behavior/nav-lineage';
  if (kinds.has('transition')) return 'behavior/state-transition';
  if (kinds.has('event')) return 'behavior/observed-event';
  if (kinds.has('entity')) return 'behavior/entity-derivation';
  if (kinds.has('dom')) return 'behavior/dom-window';
  return 'behavior/unknown';
}

// ── Mapper entry ────────────────────────────────────────────────────────

export interface MapBehaviorModelArgs {
  appId: string;
  sessionId: string;
  model: AppBehaviorModel;
  /** Session state transitions (for anchorViewId resolution). */
  transitions: StateTransition[];
}

export interface MappedBehaviorRows {
  session: KnowledgeBehaviorSessionRow;
  episodes: KnowledgeEpisodeRow[];
  edges: KnowledgeEdgeRow[];
  gaps: KnowledgeGapRow[];
  /** Per-episode signature seeds for Stratum 2 merge (one per episode). */
  signatureInputs: SignatureMergeInput[];
}

export function mapBehaviorModel(args: MapBehaviorModelArgs): MappedBehaviorRows {
  const { appId, sessionId, model, transitions } = args;
  if (!model || model.episodes.length === 0) {
    throw new Error('mapBehaviorModel: model with zero episodes cannot be mapped');
  }

  // anchorViewId resolution: the anchor's transition before.currentView.id.
  const transitionByInteraction = new Map<string, StateTransition>();
  for (const t of transitions) transitionByInteraction.set(t.interactionId, t);
  const anchorViewByEpisode = new Map<string, string | null>();
  for (const ep of model.episodes) {
    const anchorTransition = transitionByInteraction.get(ep.anchor.interactionId);
    anchorViewByEpisode.set(
      ep.id,
      anchorTransition?.before?.currentView?.id ?? null,
    );
  }

  // ── Stratum 1: episodes, edges, gaps ─────────────────────────────────
  const episodes: KnowledgeEpisodeRow[] = [];
  const edges: KnowledgeEdgeRow[] = [];
  const gaps: KnowledgeGapRow[] = [];
  const signatureInputs: SignatureMergeInput[] = [];

  for (const ep of model.episodes) {
    const sigKey = signatureKey(
      appId,
      ep.anchor.actionType,
      normalizeTarget(ep.anchor.actionTarget),
      anchorViewByEpisode.get(ep.id) ?? null,
    );

    episodes.push({
      key: `${appId}:${sessionId}:${ep.id}`,
      appId,
      sessionId,
      episodeId: ep.id,
      anchor: {
        interactionId: ep.anchor.interactionId,
        actionType: ep.anchor.actionType,
        actionTarget: ep.anchor.actionTarget,
        triggerTimestamp: ep.anchor.triggerTimestamp,
      },
      members: ep.members.map((m) => ({
        interactionId: m.interactionId,
        role: m.role,
        ...(m.degraded ? { degraded: true } : {}),
      })),
      horizonAttribution: {
        openedAtMs: ep.horizon.attribution.openedAtMs,
        closedAtMs: ep.horizon.attribution.closedAtMs,
        closeReason: ep.horizon.attribution.closeReason,
      },
      horizonUiOwnership: {
        openedAtMs: ep.horizon.uiOwnership.openedAtMs,
        closedAtMs: ep.horizon.uiOwnership.closedAtMs,
        closeReason: ep.horizon.uiOwnership.closeReason,
      },
      parameterInputs: ep.parameterInputs.map((p) => ({
        interactionId: p.interactionId,
        label: p.label,
        value: p.value,
        link: p.link,
      })),
      episodeOutcome: ep.episodeOutcome
        ? {
            outcome: ep.episodeOutcome.outcome,
            confidence: ep.episodeOutcome.confidence,
            confidenceLevel: ep.episodeOutcome.confidenceLevel,
            derivation: ep.episodeOutcome.derivation,
          }
        : null,
      tabId: ep.tabId,
      signatureKey: sigKey,
    });

    let edgeSeq = 0;
    for (const edge of ep.edges) {
      edges.push({
        key: `${appId}:${sessionId}:${edge.id}`,
        appId,
        sessionId,
        episodeId: ep.id,
        edgeId: edge.id,
        edgeSeq,
        tier: edge.tier,
        kind: edge.kind,
        detail: edge.detail,
        confidence: edge.confidence,
        latencyMs: edge.latencyMs,
        fromEpisodeId: edge.from.episodeId,
        fromInteractionId: edge.from.interactionId,
        to: edge.to as unknown as Record<string, unknown>,
        refJson: JSON.stringify(edge.evidenceRefs),
        signatureKey: sigKey,
      });
      edgeSeq++;
    }

    signatureInputs.push({
      key: sigKey,
      appId,
      actionType: ep.anchor.actionType,
      normalizedTarget: normalizeTarget(ep.anchor.actionTarget),
      anchorViewId: anchorViewByEpisode.get(ep.id) ?? null,
      sessionSeq: 0, // assigned by the repository INSIDE the write transaction
      sessionId,
      generatedAtMs: model.generatedAtMs,
      consequences: ep.edges.map((edge) => ({
        identity: `${edge.tier}|${edge.kind}|${consequenceTargetIdentity(edge)}`,
        tier: edge.tier,
        kind: edge.kind,
        targetIdentity: consequenceTargetIdentity(edge),
        observedVia: observedVia(edge.evidenceRefs),
        edgeKey: `${appId}:${sessionId}:${edge.id}`,
      })),
    });
  }

  // Gaps: model-level unattributed list (union of episode-level sets).
  for (const gap of model.unattributed) {
    gaps.push({
      key: `${appId}:${sessionId}:${gap.id}`,
      appId,
      sessionId,
      gapId: gap.id,
      observedKind: gap.observedKind,
      reason: gap.reason,
      detail: gap.detail,
      observedAtMs: gap.observedAtMs,
      tabId: gap.tabId,
      windowRefJson: JSON.stringify(gap.evidenceRef),
    });
  }

  // ── Session manifest ─────────────────────────────────────────────────
  const viewIds = new Set<string>();
  for (const t of transitions) {
    if (t.before?.currentView?.id) viewIds.add(t.before.currentView.id);
    if (t.after?.currentView?.id) viewIds.add(t.after.currentView.id);
  }
  const viewSetHash = stableHash([...viewIds].sort().join(','));
  const signatureSetHash = stableHash(
    signatureInputs.map((s) => s.key).sort().join(','),
  );

  const session: KnowledgeBehaviorSessionRow = {
    key: `${appId}:${sessionId}`,
    appId,
    sessionId,
    seq: 0, // assigned by the repository INSIDE the write transaction
    generatedAtMs: model.generatedAtMs,
    episodeCount: model.episodes.length,
    edgeCount: edges.length,
    gapCount: gaps.length,
    coverage: { ...model.coverage },
    viewSetHash,
    signatureSetHash,
    warnings: model.warnings.map((w) => ({
      code: w.code,
      message: w.message,
      refs: [...w.refs],
    })),
  };

  return { session, episodes, edges, gaps, signatureInputs };
}
