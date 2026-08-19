/**
 * CP8 — Knowledge Consumer Contract v1 — QUERIES
 *
 * Pure, deterministic, bounded, read-only joins over the frozen CP1–CP7
 * repository. No clock reads, no randomness, no reinterpretation:
 * - effective status = CP7 read-time formula (exact loader semantics)
 * - evidence refJson returned verbatim
 * - identity grammar never re-derived
 *
 * Every function takes the repository (and loader where read-time
 * semantics apply) and returns contract DTOs or null (empty app).
 */

import type { KnowledgeRepository } from '../persistence/knowledge-repository';
import type { KnowledgeLoader } from '../consolidation/knowledge-loader';
import { MAX_SAFE_SESSIONS } from '../consolidation/knowledge-loader';
import type {
  KnowledgeActionSignatureRow,
  KnowledgeEdgeRow,
  KnowledgeBehaviorSessionRow,
  KnowledgeStateTransitionRow,
} from '../persistence/knowledge-types';
import {
  MAX_CONSEQUENCES_PER_SIGNATURE,
  MAX_EVIDENCE_SAMPLES,
  STALE_AFTER_SESSIONS,
} from '../persistence/knowledge-types';
import type {
  ActionContextBlock,
  ActionDescriptor,
  StateChangeDescriptor,
  StateChangeKind,
  ApiSurfaceEntry,
  ApplicationDescriptor,
  ConsequenceDescriptor,
  EntityDescriptor,
  EvidenceDescriptor,
  GapReport,
  GraphEdge,
  Unavailable,
  WorkflowStep,
  WorkflowTrace,
} from './contract-types';

const SELECTOR_UNAVAILABLE: Unavailable<'css:role:aria locator'> = {
  value: null,
  reason: 'capture-ceiling',
  wouldBe: 'css:role:aria locator',
};

/** CP7 read-time effective status (exact loader formula). */
function effectiveStatus(
  currentSeq: number,
  lastSeenSeq: number,
  staleAfter: number,
): 'active' | 'stale' {
  return currentSeq - lastSeenSeq > staleAfter ? 'stale' : 'active';
}

/** Deterministic consequence sort: identity asc. */
function byIdentity(a: { identity: string }, b: { identity: string }): number {
  return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
}

// ── Application level ─────────────────────────────────────────────────

export async function describeApplication(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
): Promise<ApplicationDescriptor | null> {
  const [app, behavior] = await Promise.all([
    repo.getApplication(appId),
    loader.loadBehaviorKnowledge(appId),
  ]);
  if (!app) return null;
  return {
    appId: app.appId,
    origin: app.origin,
    label: app.label,
    behaviorVersion: behavior?.behaviorVersion ?? 0,
    currentSeq: behavior?.currentSeq ?? 0,
    signatureCount: behavior?.signatures.length ?? 0,
    retainedSessionCount: behavior?.sessions.length ?? 0,
    gapTotal: behavior?.gapSummary.total ?? 0,
    capabilities: { dbGroundTruth: 'unavailable' },
  };
}

export async function listApplications(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
): Promise<ApplicationDescriptor[]> {
  const apps = await repo.listApplications();
  const out: ApplicationDescriptor[] = [];
  for (const app of apps) {
    const d = await describeApplication(repo, loader, app.appId);
    if (d) out.push(d);
  }
  return out.sort((a, b) => (a.appId < b.appId ? -1 : 1));
}

// ── Action level ──────────────────────────────────────────────────────

export async function listActions(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
  filter: { actionType?: string; status?: 'active' | 'stale' } = {},
): Promise<ActionDescriptor[]> {
  const behavior = await loader.loadBehaviorKnowledge(appId);
  if (!behavior) return [];
  const currentSeq = behavior.currentSeq;
  const staleAfter = STALE_AFTER_SESSIONS;

  const rows: KnowledgeActionSignatureRow[] = filter.actionType
    ? await repo.searchSignatures(appId, { actionType: filter.actionType })
    : await repo.getSignatures(appId);

  const descriptors: ActionDescriptor[] = [];
  for (const row of rows) {
    const status = effectiveStatus(currentSeq, row.lastSeenSeq, staleAfter);
    if (filter.status && status !== filter.status) continue;
    descriptors.push(await toActionDescriptor(repo, appId, row, currentSeq, staleAfter, behavior));
  }
  return descriptors.sort((a, b) => (a.signatureKey < b.signatureKey ? -1 : 1));
}

export async function getActionDescriptor(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  signatureKey: string,
): Promise<ActionDescriptor | null> {
  const row = await repo.getSignature(signatureKey);
  if (!row) return null;
  const behavior = await loader.loadBehaviorKnowledge(row.appId);
  const currentSeq = behavior?.currentSeq ?? row.lastSeenSeq;
  const staleAfter = STALE_AFTER_SESSIONS;
  return toActionDescriptor(repo, row.appId, row, currentSeq, staleAfter, behavior);
}

async function toActionDescriptor(
  repo: KnowledgeRepository,
  appId: string,
  row: KnowledgeActionSignatureRow,
  currentSeq: number,
  staleAfter: number,
  behavior: Awaited<ReturnType<KnowledgeLoader['loadBehaviorKnowledge']>>,
): Promise<ActionDescriptor> {
  // Richest retained episode carrying parameter inputs for this signature:
  // highest member count, then most recent session (deterministic).
  const sessions = behavior?.sessions ?? [];
  const parameterInputs: ActionDescriptor['parameterInputs'] = [];
  for (const s of sessions) {
    const episodes = await repo.getEpisodesBySession(appId, s.sessionId);
    const candidates = episodes.filter((e) => e.signatureKey === row.key);
    if (candidates.length > 0) {
      const best = candidates
        .slice()
        .sort(
          (a, b) =>
            b.members.length - a.members.length ||
            (a.episodeId < b.episodeId ? -1 : 1),
        )[0];
      parameterInputs.push(...best.parameterInputs);
      break;
    }
  }

  const retainedSessions = new Set(sessions.map((s) => s.sessionId));
  const consequences: ConsequenceDescriptor[] = row.consequenceProfile
    .slice(0, MAX_CONSEQUENCES_PER_SIGNATURE)
    .map((c) => ({
      identity: c.identity,
      tier: c.tier,
      kind: c.kind,
      targetIdentity: c.targetIdentity,
      hitCount: c.hitCount,
      missedObservations: c.missedObservations,
      confidence: c.confidence,
      lifecycle: divergenceLifecycle(c.status, row.divergenceFlags, c.identity),
      firstSeenAtSession: c.firstSeenAtSession,
      lastSeenAtSession: c.lastSeenAtSession,
      evidenceSamples: c.evidenceSamples
        .slice(0, MAX_EVIDENCE_SAMPLES)
        .map((s) => ({
          sessionId: s.sessionId,
          edgeKey: s.edgeKey,
          resolvable: retainedSessions.has(s.sessionId),
        })),
    }));

  // D6: workflow linkage — honest, read-only, deterministic. Patterns whose
  // stored signatureIds contain this signature's key; typed absence when
  // nothing links ('none-recorded' when the app has no workflow rows at
  // all, 'linkage-pending' when rows exist but none co-occur).
  const workflowRows = await repo.getRecordedWorkflows(appId);
  const linkedPatternIds = workflowRows
    .filter((w) => (w.signatureIds ?? []).includes(row.key))
    .map((w) => w.patternId)
    .sort();
  const workflowPatternAbsence: ActionDescriptor['workflowPatternAbsence'] =
    workflowRows.length === 0
      ? 'none-recorded'
      : linkedPatternIds.length > 0
        ? 'linked'
        : 'linkage-pending';

  return {
    signatureKey: row.key,
    appId: row.appId,
    actionType: row.actionType,
    normalizedTarget: row.normalizedTarget,
    anchorViewId: row.anchorViewId,
    occurrenceCount: row.occurrenceCount,
    status: effectiveStatus(currentSeq, row.lastSeenSeq, staleAfter),
    sessionsSinceSeen: Math.max(0, currentSeq - row.lastSeenSeq),
    firstSeenAtSession: row.firstSeenAtSession,
    lastSeenAtSession: row.lastSeenAtSession,
    lastSeenSeq: row.lastSeenSeq,
    selector: SELECTOR_UNAVAILABLE,
    workflowPatternIds: linkedPatternIds,
    workflowPatternAbsence,
    parameterInputs,
    consequences: consequences.sort(byIdentity),
    observedStateChanges: projectStateChanges(row, retainedSessions),
    divergenceFlags: [...row.divergenceFlags],
  };
}

// ── Phase 4b — observed post-conditions (read-side projection) ────────

/**
 * Bounded lines in ActionContextBlock.stateChanges before the '+N more'
 * honesty row. The block is LLM-facing; bounded by design.
 */
const MAX_STATE_CHANGE_CONTEXT_LINES = 8;

/**
 * Classify a persisted consequence into the read-side StateChangeKind
 * vocabulary. Counter identities are value-bearing (`cart=3→cart=4`);
 * view-change identities carry `→` between view ids. Notification edges
 * persist window-level granularity ('anchor-window'/'post-anchor') —
 * passed through unchanged (see StateChangeDescriptor doc).
 *
 * Format dependency (R1): these formats are pinned by tests; unknown
 * formats degrade honestly to 'state-other' + the raw string — never
 * dropped.
 */
function classifyStateChange(
  kind: string,
  targetIdentity: string,
): { changeKind: StateChangeKind; identity: string; valueChange: string | null } {
  if (kind === 'entity') {
    return { changeKind: 'entity-created', identity: targetIdentity, valueChange: null };
  }
  if (kind === 'notification') {
    return {
      changeKind: 'notification',
      identity: targetIdentity.length > 60 ? targetIdentity.slice(0, 60) : targetIdentity,
      valueChange: null,
    };
  }
  // kind === 'state' (or unrecognized) — parse the persisted identity.
  const t = targetIdentity;
  // Counter form: `counterId=from` / `counterId=to` segments joined by '→'.
  // detail is `counter cart 3 → 4`; identity is `cart=3→cart=4`.
  const counterMatch = /^([^=→]+?)=([^=→]*)→[^=→]*=([^=→]*)$/.exec(t);
  if (counterMatch) {
    return { changeKind: 'counter-delta', identity: counterMatch[1], valueChange: `${counterMatch[2]}→${counterMatch[3]}` };
  }
  // View-change form: `fromView → toView` (words separated by '→').
  const viewMatch = /^(.+?)→(.+)$/.exec(t);
  if (viewMatch && !t.includes('=')) {
    return {
      changeKind: 'view-change',
      identity: t,
      valueChange: `${viewMatch[1]}→${viewMatch[2]}`,
    };
  }
  return { changeKind: 'state-other', identity: t, valueChange: null };
}

/**
 * Project a signature row's consequenceProfile into observed
 * post-conditions. Pure: no repo reads, no clock reads. Groups the
 * value-bearing counter identities (0→1 and 3→4 share the counter id) by
 * accumulating occurrence/hit counts; valueChange keeps the LAST profile
 * entry's pair (profile order = merge order, newest last).
 */
function projectStateChanges(
  row: KnowledgeActionSignatureRow,
  retainedSessions: Set<string>,
): StateChangeDescriptor[] {
  const stateEntries = row.consequenceProfile.filter(
    (c) => c.kind === 'state' || c.kind === 'entity' || c.kind === 'notification',
  );
  const grouped = new Map<string, StateChangeDescriptor>();
  for (const c of stateEntries) {
    const { changeKind, identity, valueChange } = classifyStateChange(c.kind, c.targetIdentity);
    // Group key: changeKind + generalized identity — distinct counters,
    // entity types, notifications, and views stay separate.
    const key = `${changeKind}|${identity}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrenceCount += c.occurrenceCount;
      existing.hitCount += c.hitCount;
      if (c.lastSeenAtSession > existing.lastSeenAtSession) {
        existing.lastSeenAtSession = c.lastSeenAtSession;
        existing.valueChange = valueChange;
        existing.missedObservations = c.missedObservations;
      }
      // evidenceSamples: keep the union, bounded later.
      existing.evidenceSamples.push(
        ...c.evidenceSamples.slice(0, MAX_EVIDENCE_SAMPLES).map((s) => ({
          sessionId: s.sessionId,
          edgeKey: s.edgeKey,
          resolvable: retainedSessions.has(s.sessionId),
        })),
      );
    } else {
      grouped.set(key, {
        changeKind,
        identity,
        valueChange,
        occurrenceCount: c.occurrenceCount,
        hitCount: c.hitCount,
        missedObservations: c.missedObservations,
        confidence: c.confidence,
        lifecycle: divergenceLifecycle(c.status, row.divergenceFlags, c.identity),
        firstSeenAtSession: c.firstSeenAtSession,
        lastSeenAtSession: c.lastSeenAtSession,
        evidenceSamples: c.evidenceSamples
          .slice(0, MAX_EVIDENCE_SAMPLES)
          .map((s) => ({
            sessionId: s.sessionId,
            edgeKey: s.edgeKey,
            resolvable: retainedSessions.has(s.sessionId),
          })),
        observedVia: c.observedVia,
      });
    }
  }
  return [...grouped.values()]
    .map((d) => ({
      ...d,
      evidenceSamples: d.evidenceSamples.slice(0, MAX_EVIDENCE_SAMPLES),
    }))
    .sort(
      (a, b) =>
        (a.changeKind < b.changeKind ? -1 : a.changeKind > b.changeKind ? 1 : 0) ||
        (a.identity < b.identity ? -1 : 1),
    );
}

function divergenceLifecycle(
  stored: string,
  divergenceFlags: string[],
  identity: string,
): ConsequenceDescriptor['lifecycle'] {
  if (divergenceFlags.includes(identity)) return 'diverged';
  if (stored === 'stale') return 'stale';
  return 'active';
}

// ── Evidence deep-link ────────────────────────────────────────────────

export async function getConsequenceEvidence(
  repo: KnowledgeRepository,
  sampleRef: { sessionId: string; edgeKey: string },
): Promise<EvidenceDescriptor | null> {
  const [sessionId, edgeKey] = [sampleRef.sessionId, sampleRef.edgeKey];
  // edgeKey embeds appId:sessionId:edgeId — appId is its prefix.
  const appId = edgeKey.split(':').slice(0, 1)[0] ?? '';
  const manifest = await repo.getBehaviorSession(appId, sessionId);
  const edges = await repo.getEdgesBySession(appId, sessionId);
  const edge = edges.find((e) => e.key === edgeKey);
  if (!edge) {
    return manifest
      ? { ...emptyEvidence(sessionId, edgeKey, manifest), resolvable: false }
      : null;
  }
  return {
    sessionId,
    edgeKey,
    tier: edge.tier,
    kind: edge.kind,
    detail: edge.detail,
    confidence: edge.confidence,
    latencyMs: edge.latencyMs,
    fromEpisodeId: edge.fromEpisodeId,
    fromInteractionId: edge.fromInteractionId,
    refJson: edge.refJson,
    resolvable: true,
  };
}

function emptyEvidence(
  sessionId: string,
  edgeKey: string,
  _manifest: KnowledgeBehaviorSessionRow,
): Omit<EvidenceDescriptor, 'resolvable'> {
  return {
    sessionId,
    edgeKey,
    tier: 'unknown',
    kind: 'unknown',
    detail: 'edge row not retained',
    confidence: 0,
    latencyMs: null,
    fromEpisodeId: 'unknown',
    fromInteractionId: 'unknown',
    refJson: '[]',
  };
}

// ── Workflow reconstruction ───────────────────────────────────────────

export async function reconstructWorkflow(
  repo: KnowledgeRepository,
  appId: string,
  sessionId: string,
): Promise<WorkflowTrace | null> {
  const manifest = await repo.getBehaviorSession(appId, sessionId);
  if (!manifest) return null;
  const [episodes, edges, gaps] = await Promise.all([
    repo.getEpisodesBySession(appId, sessionId),
    repo.getEdgesBySession(appId, sessionId),
    repo.getGaps(appId, { sessionId }),
  ]);

  const edgesByEpisode = new Map<string, KnowledgeEdgeRow[]>();
  for (const e of edges) {
    const list = edgesByEpisode.get(e.episodeId) ?? [];
    list.push(e);
    edgesByEpisode.set(e.episodeId, list);
  }

  // Phase 4b — persisted state-transition rows keyed by interactionId
  // (one indexed read; join key = anchor interaction id).
  const transitionsByInteraction = new Map<string, KnowledgeStateTransitionRow>();
  for (const t of await repo.getStateTransitions(sessionId)) {
    transitionsByInteraction.set(t.interactionId, t);
  }

  // CER-5 episode order = anchor triggerTimestamp asc, episodeId asc.
  const ordered = [...episodes].sort(
    (a, b) =>
      a.anchor.triggerTimestamp - b.anchor.triggerTimestamp ||
      (a.episodeId < b.episodeId ? -1 : 1),
  );

  const steps: WorkflowStep[] = ordered.map((ep, i) => {
    // Phase 4b — read-side join with persisted transition rows.
    const interactionId = ep.anchor.interactionId;
    const transition = transitionsByInteraction.get(interactionId);
    return {
      order: i,
      episodeId: ep.episodeId,
      signatureKey: ep.signatureKey,
      actionType: ep.anchor.actionType,
      actionTarget: ep.anchor.actionTarget,
      parameterInputs: ep.parameterInputs.map((p) => ({
        interactionId: p.interactionId,
        label: p.label,
        value: p.value,
      })),
      episodeOutcome: ep.episodeOutcome
        ? {
            outcome: ep.episodeOutcome.outcome,
            confidence: ep.episodeOutcome.confidence,
            derivation: ep.episodeOutcome.derivation,
          }
        : null,
      edges: (edgesByEpisode.get(ep.episodeId) ?? [])
        .sort((a, b) => a.edgeSeq - b.edgeSeq)
        .map((e) => ({
          edgeId: e.edgeId,
          tier: e.tier,
          kind: e.kind,
          detail: e.detail,
          confidence: e.confidence,
        })),
      interactionId,
      stateChanges: transition ? [...transition.changes] : [],
      affectedEntities: transition ? [...transition.affectedEntities] : [],
      fromViewId: transition?.fromViewId ?? null,
      toViewId: transition?.toViewId ?? null,
      stateChangeAbsence: transition
        ? transition.changes.length > 0
          ? ('observed' as const)
          : ('observed-none' as const)
        : ('rows-not-retained' as const),
    };
  });

  return {
    appId,
    sessionId,
    seq: manifest.seq,
    generatedAtMs: manifest.generatedAtMs,
    steps,
    gaps: gaps
      .sort((a, b) => a.observedAtMs - b.observedAtMs)
      .map((g) => ({
        gapId: g.gapId,
        observedKind: g.observedKind,
        reason: g.reason,
        detail: g.detail,
        observedAtMs: g.observedAtMs,
      })),
  };
}

// ── Aggregations (API / entity / graphs) ──────────────────────────────

interface Aggregated {
  identity: string;
  sessionCount: number;
  originActions: Set<string>;
  samples: Array<{ sessionId: string; edgeKey: string; resolvable: boolean }>;
}

async function aggregateEdges(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
  kinds: string[],
): Promise<Map<string, Aggregated>> {
  const behavior = await loader.loadBehaviorKnowledge(appId);
  const retained = new Set((behavior?.sessions ?? []).map((s) => s.sessionId));
  const out = new Map<string, Aggregated>();
  if (!behavior) return out;

  for (const s of [...behavior.sessions].sort((a, b) => a.seq - b.seq)) {
    const edges = await repo.getEdgesBySession(appId, s.sessionId);
    for (const e of edges) {
      if (!kinds.includes(e.kind)) continue;
      const identity = consequenceIdentity(e);
      const agg = out.get(identity) ?? {
        identity,
        sessionCount: 0,
        originActions: new Set<string>(),
        samples: [],
      };
      agg.sessionCount += 1;
      agg.originActions.add(e.signatureKey);
      agg.samples.push({
        sessionId: s.sessionId,
        edgeKey: e.key,
        resolvable: retained.has(s.sessionId),
      });
      out.set(identity, agg);
    }
  }
  return out;
}

/** Reconstructs the FROZEN grammar identity from a stored edge row. */
function consequenceIdentity(e: KnowledgeEdgeRow): string {
  const to = e.to as Record<string, unknown>;
  if (e.kind === 'api') {
    const method = String(to.requestMethod ?? e.detail.split(' ')[0] ?? 'GET');
    const path = String(to.requestPath ?? generalizedPath(e.detail));
    return `api|${method} ${path}`;
  }
  if (e.kind === 'entity') {
    // FROZEN grammar: `${type}:${operation}` — type is the entityId's
    // prefix, operation comes from edge.to.operation (never the raw id).
    const entityId = String(to.entityId ?? 'unknown:unknown');
    const type = entityId.includes(':') ? entityId.split(':')[0] : 'unknown';
    const op = String(to.operation ?? 'unknown');
    return `entity|${type}:${op}`;
  }
  if (e.kind === 'navigation') {
    return `navigation|to:${String(to.toUrl ?? '').replace(/^https?:\/\/[^/]+/, '')}`;
  }
  if (e.kind === 'state') {
    return `state|${String(to.from ?? '∅')}→${String(to.to ?? '∅')}`;
  }
  if (e.kind === 'ui') {
    return `ui|${e.confidence < 0.6 ? 'post-anchor' : 'anchor-window'}`;
  }
  return `${e.kind}|unknown`;
}

function generalizedPath(detail: string): string {
  const m = detail.match(/https?:\/\/[^/]+(\/[^\s]*)?/);
  return m ? m[1] ?? '/' : '/';
}

export async function getApiSurface(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
): Promise<ApiSurfaceEntry[]> {
  const agg = await aggregateEdges(repo, loader, appId, ['api']);
  const out: ApiSurfaceEntry[] = [];
  for (const a of agg.values()) {
    const [method, ...rest] = a.identity.split('|')[1].split(' ');
    out.push({
      identity: a.identity.split('|').slice(1).join('|'),
      method,
      path: rest.join(' ') || '/',
      sessionCount: a.sessionCount,
      originActions: [...a.originActions].sort(),
      evidenceSamples: a.samples.slice(0, MAX_EVIDENCE_SAMPLES),
      payloadSchema: 'unrecorded',
    });
  }
  return out.sort((a, b) => (a.identity < b.identity ? -1 : 1));
}

export async function getEntitySummary(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
): Promise<EntityDescriptor[]> {
  const agg = await aggregateEdges(repo, loader, appId, ['entity']);
  const out: EntityDescriptor[] = [];
  for (const a of agg.values()) {
    out.push({
      identity: a.identity.split('|')[1],
      sessionCount: a.sessionCount,
      originActions: [...a.originActions].sort(),
      evidenceSamples: a.samples.slice(0, MAX_EVIDENCE_SAMPLES),
    });
  }
  return out.sort((a, b) => (a.identity < b.identity ? -1 : 1));
}

export async function getNavigationGraph(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
): Promise<GraphEdge[]> {
  const agg = await aggregateEdges(repo, loader, appId, ['navigation']);
  const out: GraphEdge[] = [];
  for (const a of agg.values()) {
    const to = a.identity.split('|')[1].replace(/^to:/, '');
    out.push({
      from: '*', // destination-only generalization (grammar: to:pathname)
      to,
      sessionCount: a.sessionCount,
      evidenceSamples: a.samples.slice(0, MAX_EVIDENCE_SAMPLES),
    });
  }
  return out.sort((a, b) => (a.to < b.to ? -1 : 1));
}

export async function getStateGraph(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  appId: string,
): Promise<GraphEdge[]> {
  const agg = await aggregateEdges(repo, loader, appId, ['state']);
  const out: GraphEdge[] = [];
  for (const a of agg.values()) {
    const [from, to] = a.identity.split('|')[1].split('→');
    out.push({
      from: from || '∅',
      to: to || '∅',
      sessionCount: a.sessionCount,
      evidenceSamples: a.samples.slice(0, MAX_EVIDENCE_SAMPLES),
    });
  }
  return out.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : (a.from < b.from ? -1 : 1)));
}

export async function getGapReport(
  repo: KnowledgeRepository,
  appId: string,
): Promise<GapReport> {
  const gaps = await repo.getGaps(appId);
  const byReasonMap = new Map<string, number>();
  for (const g of gaps) {
    byReasonMap.set(g.reason, (byReasonMap.get(g.reason) ?? 0) + 1);
  }
  return {
    total: gaps.length,
    byReason: [...byReasonMap.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1)),
    recent: [...gaps]
      .sort((a, b) => b.observedAtMs - a.observedAtMs)
      .slice(0, 10)
      .map((g) => ({
        sessionId: g.sessionId,
        gapId: g.gapId,
        observedKind: g.observedKind,
        reason: g.reason,
        detail: g.detail,
        observedAtMs: g.observedAtMs,
      })),
  };
}

// ── LLM grounding block ───────────────────────────────────────────────

/**
 * CP8 v1.1 — retained behavior-session ids for an app (seq asc), bounded
 * by the loader's MAX_SAFE_SESSIONS. Additive query used by the knowledge
 * snapshot (M-EXEC E1) to enumerate reconstructable workflow traces.
 * Read-only; deterministic ordering.
 */
export async function listBehaviorSessions(
  repo: KnowledgeRepository,
  appId: string,
): Promise<string[]> {
  const rows = await repo.getRecentBehaviorSessions(appId, MAX_SAFE_SESSIONS);
  return rows
    .sort((a, b) => a.seq - b.seq)
    .map((r) => r.sessionId);
}

export async function describeActionAsContext(
  repo: KnowledgeRepository,
  loader: KnowledgeLoader,
  signatureKey: string,
): Promise<ActionContextBlock | null> {
  const d = await getActionDescriptor(repo, loader, signatureKey);
  if (!d) return null;
  // Phase 4b — bounded plain-text lines from observedStateChanges
  // (≤ MAX_STATE_CHANGE_CONTEXT_LINES; '+N more' honesty row).
  const stateChangeLines = d.observedStateChanges.map((sc) => {
    const valuePart = sc.valueChange ? ` (last ${sc.valueChange})` : '';
    return `${sc.changeKind} ${sc.identity} changed${valuePart} · ${sc.hitCount} session(s)`;
  });
  const truncated =
    stateChangeLines.length > MAX_STATE_CHANGE_CONTEXT_LINES
      ? [
          ...stateChangeLines.slice(0, MAX_STATE_CHANGE_CONTEXT_LINES),
          `+${stateChangeLines.length - MAX_STATE_CHANGE_CONTEXT_LINES} more`,
        ]
      : stateChangeLines;
  return {
    action: `${d.actionType} "${d.normalizedTarget}"`,
    performed: `${d.occurrenceCount} time(s) across sessions; last seen session ${d.lastSeenAtSession} (seq ${d.lastSeenSeq}); effective status ${d.status}`,
    observed: d.consequences.map((c) => ({
      consequence: `${c.tier} ${c.targetIdentity}`,
      confidence: c.confidence,
      lifecycle: c.lifecycle,
      sessions: c.hitCount,
    })),
    stateChanges: truncated,
    provenance: {
      signatureKey: d.signatureKey,
      appId: d.appId,
      evidenceSamples: d.consequences.flatMap((c) => c.evidenceSamples),
    },
  };
}
