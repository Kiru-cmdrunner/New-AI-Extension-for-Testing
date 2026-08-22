/**
 * MS-U4 — KR browser section renderers (pure, textContent-only).
 *
 * Every renderer takes rows (already loaded, already sorted by kr-sort) and
 * returns an HTMLElement. No DB access here (renderer purity — pinned by
 * kr-wiring A13: this file must not mention Dexie at all). Honest empty
 * states for zero rows; caps + "… N more" overflow markers; XSS-safe via
 * createElement/textContent everywhere.
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md §2, §6 P6/P7.
 */

import type {
  ApplicationRow,
  KnowledgeActionSignatureRow,
  KnowledgeRecordedWorkflowRow,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
  KnowledgeGapRow,
  KnowledgeOutcomeRow,
  KnowledgeEntityRow,
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeNotificationRow,
  KnowledgeBehaviorSessionRow,
} from '../../understanding/persistence/knowledge-types';
import type { ApiTestSeed } from '../../understanding/contract/contract-types';
import {
  KR_CAPS,
  overflowMarker,
  fmtDate,
  sortSignatures,
  sortWorkflows,
  sortViews,
  sortViewEdges,
  sortGaps,
  reasonSummary,
} from './kr-sort';
import type { SessionDetail, HealElementLike } from './kr-data';
import { healLine } from '../../sidepanel/forward-links';

/** MS-U5 F3 — bounded per-element heal lines under the aggregate summary. */
const KR_HEAL_LINES = 4;
import {
  loadApplications,
  loadAppKnowledge,
  loadHealElements,
  loadBehaviorSessions,
  loadSessionDetail,
  loadApiSeeds,
} from './kr-data';

// ── DOM helpers (all textContent — XSS-safe by construction) ────────────

function div(cls: string, text?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function section(title: string, count: number): { root: HTMLElement; list: HTMLElement } {
  const root = document.createElement('section');
  root.className = 'kr-section';
  const header = div('kr-section__header');
  header.appendChild(div('kr-section__title', title));
  header.appendChild(div('kr-section__count', String(count)));
  root.appendChild(header);
  const list = div('kr-section__list');
  root.appendChild(list);
  return { root, list };
}

function row(): HTMLElement {
  return div('kr-row');
}

function chip(text: string, variant: 'active' | 'stale' | 'diverged' | 'linked' | 'pending' | 'plain'): HTMLElement {
  return div(`kr-chip kr-chip--${variant}`, text);
}

function empty(text: string): HTMLElement {
  return div('kr-empty', text);
}

function attachOverflow(list: HTMLElement, total: number, cap: number): void {
  const marker = overflowMarker(total, cap);
  if (marker) list.appendChild(div('kr-overflow', marker));
}

// ── orchestrator (repository-page entry point) ─────────────────────────

export interface KrBrowserOptions {
  selectedAppId: string | null;
  onAppSelected: (appId: string) => void;
  /**
   * MS-U5 F3: repository project scope for the Elements/heals read. Null →
   * unscoped bulk read (bounded). Kept optional so existing callers/tests
   * are unaffected.
   */
  projectId?: string | null;
}

/**
 * Render the full KR browser into `container`. Async (bounded Dexie reads);
 * honest empty states throughout; renderer modules never write the KR.
 * App selection re-renders via the provided callback.
 */
export async function renderKrBrowser(
  container: HTMLElement,
  options: KrBrowserOptions,
): Promise<void> {
  container.replaceChildren();
  const apps = await loadApplications();
  const selector = renderAppSelector(apps, options.selectedAppId);
  const select = selector.querySelector<HTMLSelectElement>('select');
  if (select) {
    select.addEventListener('change', () => options.onAppSelected(select.value));
  }
  container.appendChild(selector);

  const appId = options.selectedAppId ?? apps[0]?.appId ?? null;
  if (!appId) return; // empty state already rendered by the selector

  const knowledge = await loadAppKnowledge(appId);
  const [sessions, apiSeeds, healElements] = await Promise.all([
    loadBehaviorSessions(appId),
    loadApiSeeds(appId),
    loadHealElements(options.projectId ?? null),
  ]);
  const details: Record<string, SessionDetail> = {};
  for (const s of sessions) {
    details[s.key] = await loadSessionDetail(appId, s.sessionId);
  }

  const sections = [
    renderSignaturesSection(knowledge.signatures, healElements),
    renderWorkflowsSection(knowledge.workflows),
    renderViewsSection(knowledge.views, knowledge.viewEdges),
    renderSessionsSection(sessions, details),
    renderGapsSection(knowledge.gaps),
    renderApiSeedsSection(apiSeeds),
    renderOutcomesSection(knowledge.outcomes),
    renderEntitiesSection(knowledge.entities),
    renderCollectionsSection(knowledge.collections, knowledge.counters),
    renderNotificationsSection(knowledge.notifications),
  ];
  container.append(...sections);
}

// ── A3: app selector ────────────────────────────────────────────────────

export function renderAppSelector(
  apps: ApplicationRow[],
  selectedAppId: string | null,
): HTMLElement {
  const root = div('kr-appselect');
  if (apps.length === 0) {
    root.appendChild(empty('No applications recorded yet. Record a session to start building knowledge.'));
    return root;
  }
  const label = div('kr-appselect__label', 'Application');
  root.appendChild(label);
  const select = document.createElement('select');
  select.className = 'kr-appselect__select';
  for (const app of apps) {
    const opt = document.createElement('option');
    opt.value = app.appId;
    opt.textContent = `${app.origin} — ${app.appId} (${app.sessionCount} session${app.sessionCount === 1 ? '' : 's'})`;
    opt.selected = app.appId === selectedAppId;
    select.appendChild(opt);
  }
  root.appendChild(select);
  return root;
}

// ── A5: action signatures ───────────────────────────────────────────────

/**
 * MS-U5 F3 — locator durability summary line for the signatures section.
 * Deterministic counts of RECORDED healHistory entries only. Null (absent
 * line) when no Elements rows exist at all — absence rather than a
 * fabricated empty state (spec A7/P9).
 */
export function healSummaryLine(els: HealElementLike[] | null): string | null {
  if (!els) return null; // no elements recorded — line absent entirely
  const healed = els.filter((e) => e.healHistory.length > 0);
  if (healed.length === 0) return 'Locator healing: not yet observed — elements recorded, no heals on record.';
  const lastDate = healed
    .map((e) => e.lastHealedAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const totalHeals = healed.reduce((n, e) => n + e.healHistory.length, 0);
  return `Locator healing: ${totalHeals} heal(s) across ${healed.length}/${els.length} element(s)${lastDate ? ` · last ${lastDate.slice(0, 10)}` : ''}`;
}

export function renderSignaturesSection(
  rows: KnowledgeActionSignatureRow[],
  healElements?: HealElementLike[] | null,
): HTMLElement {
  const { root, list } = section('Action signatures', rows.length);
  if (rows.length === 0) {
    list.appendChild(empty('No action signatures yet.'));
    return root;
  }
  const sorted = sortSignatures(rows).slice(0, KR_CAPS.signatures);
  for (const s of sorted) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__type', s.actionType));
    const target = div('kr-row__target');
    target.textContent = s.normalizedTarget;
    head.appendChild(target);
    head.appendChild(div('kr-row__count', `×${s.occurrenceCount}`));
    head.appendChild(chip(s.status, s.status === 'active' ? 'active' : 'stale'));
    if (s.divergenceFlags.length > 0) {
      head.appendChild(div('kr-row__flags', `${s.divergenceFlags.length} divergence flags`));
    }
    r.appendChild(head);
    const sub = div('kr-row__sub');
    const anchor = s.anchorViewId ? s.anchorViewId : '—';
    sub.textContent = `${s.firstSeenAtSession} → ${s.lastSeenAtSession} (seq ${s.firstSeenSeq}–${s.lastSeenSeq}) · anchor ${anchor}`;
    r.appendChild(sub);
    if (s.consequenceProfile.length > 0) {
      const prof = div('kr-consequences');
      prof.appendChild(div('kr-consequences__title', `Consequence profile (${s.consequenceProfile.length})`));
      for (const c of s.consequenceProfile.slice(0, KR_CAPS.entities)) {
        const line = div('kr-consequence');
        line.textContent = `${c.tier} · ${c.kind} · ${c.targetIdentity} — ×${c.occurrenceCount} (hits ${c.hitCount}, missed ${c.missedObservations}) · ${Math.round(c.confidence * 100)}% · ${c.status} · via ${c.observedVia}`;
        prof.appendChild(line);
      }
      r.appendChild(prof);
    }
    list.appendChild(r);
  }
  attachOverflow(list, rows.length, KR_CAPS.signatures);
  // MS-U5 F3 — forward link: locator durability (honest absence when null).
  // Aggregate summary + bounded per-ELEMENT lines. Per-signature attribution
  // is deliberately NOT attempted: no recorded join key exists between
  // knowledgeSignatures.normalizedTarget (action vocabulary) and
  // Element.logicalName (repository vocabulary) — inventing one would
  // fabricate attribution. Elements are listed in their own vocabulary.
  if (healElements && healElements.length > 0) {
    const summary = healSummaryLine(healElements);
    if (summary) list.appendChild(div('kr-heal-line', summary));
    const ranked = [...healElements]
      .sort((a, b) =>
        (b.healHistory.length - a.healHistory.length) ||
        (a.logicalName < b.logicalName ? -1 : a.logicalName > b.logicalName ? 1 : 0))
      .slice(0, KR_HEAL_LINES);
    for (const el of ranked) {
      const line = healLine(el);
      if (line) list.appendChild(div('kr-heal-el', `${el.logicalName}: ${line}`));
    }
    if (healElements.length > KR_HEAL_LINES) {
      list.appendChild(div('kr-heal-el kr-heal-el--more', `… ${healElements.length - KR_HEAL_LINES} more elements`));
    }
  }
  return root;
}

// ── A6: recorded workflows ──────────────────────────────────────────────

export function renderWorkflowsSection(rows: KnowledgeRecordedWorkflowRow[]): HTMLElement {
  const { root, list } = section('Recorded workflows', rows.length);
  if (rows.length === 0) {
    list.appendChild(empty('No recorded workflows yet.'));
    return root;
  }
  const sorted = sortWorkflows(rows).slice(0, KR_CAPS.workflows);
  for (const w of sorted) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__label', w.label));
    head.appendChild(div('kr-row__count', `×${w.occurrenceCount}`));
    head.appendChild(chip(w.linkageState ?? 'linkage-pending', w.linkageState === 'linked' ? 'linked' : 'pending'));
    r.appendChild(head);
    const steps = div('kr-steps');
    w.canonicalSteps.forEach((step, i) => {
      steps.appendChild(div('kr-step', `${i + 1}. ${step}`));
    });
    r.appendChild(steps);
    const sub = div('kr-row__sub');
    sub.textContent = `views: ${w.viewSequence.join(' → ') || '—'} · ${w.sessionIds.length} sessions · ${w.signatureIds?.length ?? 0} signatures · ${w.instances.length} instances · last ${fmtDate(w.lastSeenAt)}`;
    r.appendChild(sub);
    list.appendChild(r);
  }
  attachOverflow(list, rows.length, KR_CAPS.workflows);
  return root;
}

// ── A7: views & transitions ─────────────────────────────────────────────

export function renderViewsSection(
  views: KnowledgeViewRow[],
  edges: KnowledgeViewTransitionRow[],
): HTMLElement {
  const { root, list } = section('Views & transitions', views.length);
  if (views.length === 0) {
    list.appendChild(empty('No views yet.'));
    return root;
  }
  const viewList = div('kr-views');
  for (const v of sortViews(views).slice(0, KR_CAPS.views)) {
    const line = div('kr-view');
    line.textContent = `${v.label} (${v.viewId}) — ${v.visitCount} visits · ${fmtDate(v.firstSeenAt)} → ${fmtDate(v.lastSeenAt)} · via ${v.detectedFrom}`;
    viewList.appendChild(line);
  }
  list.appendChild(viewList);
  attachOverflow(viewList, views.length, KR_CAPS.views);

  const edgesTitle = div('kr-section__title', `Transitions (${edges.length})`);
  const edgeList = div('kr-edges');
  if (edges.length === 0) {
    edgeList.appendChild(empty('No transitions yet.'));
  } else {
    for (const e of sortViewEdges(edges).slice(0, KR_CAPS.viewEdges)) {
      const line = div('kr-edge');
      line.textContent = `${e.fromViewId} → ${e.toViewId} ×${e.count}`;
      edgeList.appendChild(line);
    }
    attachOverflow(edgeList, edges.length, KR_CAPS.viewEdges);
  }
  list.appendChild(edgesTitle);
  list.appendChild(edgeList);
  return root;
}

// ── A9: gaps ────────────────────────────────────────────────────────────

export function renderGapsSection(rows: KnowledgeGapRow[]): HTMLElement {
  const { root, list } = section('Gaps backlog', rows.length);
  if (rows.length === 0) {
    list.appendChild(empty('No gaps yet.'));
    return root;
  }
  const summary = reasonSummary(rows);
  const summaryEl = div('kr-gapsummary');
  summaryEl.textContent = summary.map((s) => `${s.reason} ×${s.count}`).join(' · ');
  list.appendChild(summaryEl);
  for (const g of sortGaps(rows).slice(0, KR_CAPS.gaps)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__kind', g.observedKind));
    head.appendChild(div('kr-row__reason', g.reason));
    head.appendChild(div('kr-row__date', fmtDate(g.observedAtMs)));
    r.appendChild(head);
    const sub = div('kr-row__sub');
    sub.textContent = `${g.detail} · ${g.sessionId} · ${g.gapId}`;
    r.appendChild(sub);
    list.appendChild(r);
  }
  attachOverflow(list, rows.length, KR_CAPS.gaps);
  return root;
}

// ── A10: API seeds ──────────────────────────────────────────────────────

export function renderApiSeedsSection(seeds: ApiTestSeed[]): HTMLElement {
  const { root, list } = section('API seeds', seeds.length);
  if (seeds.length === 0) {
    list.appendChild(empty('No attributed API requests yet.'));
    return root;
  }
  for (const s of seeds.slice(0, KR_CAPS.apiSeeds)) {
    const r = row();
    const head = div('kr-row__head');
    const ident = div('kr-row__target');
    ident.textContent = `${s.request.method} ${s.request.path}`;
    head.appendChild(ident);
    head.appendChild(div('kr-row__count', `${Math.round((s.confidence ?? 0) * 100)}%`));
    if (s.shared) head.appendChild(chip('shared', 'plain'));
    if (s.recurring) head.appendChild(chip('recurring', 'plain'));
    r.appendChild(head);
    const sub = div('kr-row__sub');
    const sig = s.action ? `${s.action.actionType} · sig ${(s.action.signatureKey.split(':').pop() ?? '')}` : 'no signature';
    sub.textContent = `${s.sessionId} · ${sig} · status ${s.request.status ?? '—'} · keys ${s.request.bodyKeys.length}`;
    r.appendChild(sub);
    list.appendChild(r);
  }
  attachOverflow(list, seeds.length, KR_CAPS.apiSeeds);
  return root;
}

// ── A11: outcomes / entities / collections / notifications ──────────────

export function renderOutcomesSection(rows: KnowledgeOutcomeRow[]): HTMLElement {
  const { root, list } = section('Outcomes', rows.length);
  if (rows.length === 0) {
    list.appendChild(empty('No outcomes yet.'));
    return root;
  }
  const rollup = new Map<string, number>();
  for (const o of rows) rollup.set(o.outcome, (rollup.get(o.outcome) ?? 0) + 1);
  const summary = div('kr-rollup');
  summary.textContent = [...rollup.entries()].map(([k, v]) => `${v} ${k}`).join(' · ');
  list.appendChild(summary);
  for (const o of rows.slice(0, KR_CAPS.outcomes)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__type', o.actionType));
    head.appendChild(div('kr-row__label', o.actionTarget));
    head.appendChild(chip(o.outcome, 'plain'));
    head.appendChild(div('kr-row__count', `${Math.round(o.confidence * 100)}%`));
    r.appendChild(head);
    const sub = div('kr-row__sub');
    sub.textContent = `${o.confidenceLevel} · ${o.interactionId} · ${o.sessionId}`;
    r.appendChild(sub);
    list.appendChild(r);
  }
  attachOverflow(list, rows.length, KR_CAPS.outcomes);
  return root;
}

export function renderEntitiesSection(rows: KnowledgeEntityRow[]): HTMLElement {
  const { root, list } = section('Entities', rows.length);
  if (rows.length === 0) {
    list.appendChild(empty('No entities yet.'));
    return root;
  }
  for (const e of rows.slice(0, KR_CAPS.entities)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__type', e.type));
    head.appendChild(div('kr-row__label', e.entityId));
    head.appendChild(chip(e.currentState ?? 'unknown', 'plain'));
    head.appendChild(div('kr-row__count', `rev ${e.revision}`));
    r.appendChild(head);
    const sub = div('kr-row__sub');
    sub.textContent = `${fmtDate(e.firstSeenAt)} → ${fmtDate(e.lastSeenAt)} · ${e.viewIds?.length ?? 0} views · last ${e.lastSessionId}`;
    r.appendChild(sub);
    const attrs = Object.entries(e.attributes ?? {}).slice(0, 12);
    if (attrs.length > 0) {
      const attrEl = div('kr-attrs');
      attrEl.textContent = attrs.map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
      r.appendChild(attrEl);
    }
    const history = (e.stateHistory ?? []).slice(0, 10);
    for (const h of history) {
      r.appendChild(div('kr-state', `${h.from ?? '∅'} → ${h.to} · ${h.evidence}`));
    }
    list.appendChild(r);
  }
  attachOverflow(list, rows.length, KR_CAPS.entities);
  return root;
}

export function renderCollectionsSection(
  collections: KnowledgeCollectionRow[],
  counters: KnowledgeCounterRow[],
): HTMLElement {
  const { root, list } = section('Collections & counters', collections.length + counters.length);
  if (collections.length === 0 && counters.length === 0) {
    list.appendChild(empty('No collections or counters yet.'));
    return root;
  }
  for (const c of collections.slice(0, KR_CAPS.collections)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__label', c.collectionId));
    head.appendChild(div('kr-row__type', c.entityType));
    head.appendChild(div('kr-row__count', `${c.currentCount} · max ${c.maxCount}`));
    r.appendChild(head);
    list.appendChild(r);
  }
  attachOverflow(list, collections.length, KR_CAPS.collections);
  for (const c of counters.slice(0, KR_CAPS.counters)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__label', c.label || c.counterId));
    head.appendChild(div('kr-row__count', c.currentValue));
    r.appendChild(head);
    const history = c.history ?? [];
    const last = history[history.length - 1];
    const sub = div('kr-row__sub');
    sub.textContent = `${c.elementPath} · ${history.length} observations${last?.delta != null ? ` · last ${last.delta >= 0 ? '+' : ''}${last.delta}` : ''}`;
    r.appendChild(sub);
    list.appendChild(r);
  }
  return root;
}

export function renderNotificationsSection(rows: KnowledgeNotificationRow[]): HTMLElement {
  const { root, list } = section('Notifications', rows.length);
  if (rows.length === 0) {
    list.appendChild(empty('No notifications yet.'));
    return root;
  }
  for (const n of rows.slice(0, KR_CAPS.notifications)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(chip(n.severity, 'plain'));
    head.appendChild(div('kr-row__label', n.text));
    r.appendChild(head);
    const sub = div('kr-row__sub');
    sub.textContent = `${n.elementPath} · ${fmtDate(n.appearedAt)}`;
    r.appendChild(sub);
    list.appendChild(r);
  }
  attachOverflow(list, rows.length, KR_CAPS.notifications);
  return root;
}

// ── A8: behavior sessions (episodes & edges) ────────────────────────────

export function renderSessionsSection(
  sessions: KnowledgeBehaviorSessionRow[],
  details: Record<string, SessionDetail>,
): HTMLElement {
  const { root, list } = section('Behavior sessions', sessions.length);
  if (sessions.length === 0) {
    list.appendChild(empty('No behavior sessions yet.'));
    return root;
  }
  for (const s of sessions.slice(0, KR_CAPS.behaviorSessions)) {
    const r = row();
    const head = div('kr-row__head');
    head.appendChild(div('kr-row__label', `#${s.seq} ${s.sessionId}`));
    head.appendChild(div('kr-row__date', fmtDate(s.generatedAtMs)));
    r.appendChild(head);
    const sub = div('kr-row__sub');
    const cov = s.coverage;
    sub.textContent =
      `${s.episodeCount} episodes · ${s.edgeCount} edges · ${s.gapCount} gap${s.gapCount === 1 ? '' : 's'}` +
      (cov ? ` · ${cov.anchoredInteractions}/${cov.totalInteractions} anchored · ${cov.attributedObservations}/${cov.totalObservations} observations attributed · ${cov.unattributedConsequences} unattributed` : '');
    r.appendChild(sub);

    const d = details[s.key] ?? details[`${s.appId}:${s.sessionId}`];
    if (d) {
      for (const ep of d.episodes.slice(0, KR_CAPS.behaviorSessions)) {
        const epEl = div('kr-episode');
        const oc = ep.episodeOutcome;
        epEl.textContent = `${ep.anchor.actionType} ${ep.anchor.actionTarget} · ${ep.members?.length ?? 0} members${oc ? ` · ${oc.outcome} (${oc.confidenceLevel})` : ' · outcome —'} · sig ${(ep.signatureKey ?? '').split(':').pop()}`;
        r.appendChild(epEl);
      }
      const edges = d.edges.slice(0, KR_CAPS.edgesPerSession);
      for (const e of edges) {
        const eEl = div('kr-kedge');
        eEl.textContent = `${e.tier} · ${e.kind} · ${e.detail} · ${Math.round(e.confidence * 100)}%${e.latencyMs != null ? ` · ${e.latencyMs}ms` : ''} · carrier ${e.fromInteractionId}`;
        r.appendChild(eEl);
        // parsed EvidenceRefs (refJson) — honest absence when unparseable
        try {
          const refs = JSON.parse(e.refJson ?? '[]') as Array<{ windowId?: string; kind?: string }>;
          for (const ref of refs.slice(0, 5)) {
            r.appendChild(div('kr-ref', `↳ ${ref.kind ?? 'ref'} ${ref.windowId ?? ''}`.trim()));
          }
        } catch {
          r.appendChild(div('kr-ref', '↳ (unparseable ref)'));
        }
      }
      attachOverflow(r, d.edges.length, KR_CAPS.edgesPerSession);
    }
    list.appendChild(r);
  }
  return root;
}
