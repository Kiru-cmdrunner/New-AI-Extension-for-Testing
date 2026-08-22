/**
 * MS-U3 — Session Understanding Card.
 *
 * Spec: .drytis/specs/phase-6-u3-session-understanding-card.md.
 *
 * Renders the UnderstandingResult aggregate (written by the service worker
 * at STOP) as ONE card in the stopped view — the panel's first Knowledge
 * Repository READ path. Read-only, renderer-only:
 *   - Data: chrome.storage.local `understanding_result` + (async) Dexie
 *     knowledgeGaps. The panel NEVER writes knowledge.
 *   - Honesty: absent optional fields → absent rows/sections; null result →
 *     null element (section stays hidden). No "undefined"/"null" text.
 *   - Security: every string via createElement/textContent.
 *   - Caps: entities 8, views 6, transitions 8, gaps 10, warnings 8 — with
 *     honest overflow markers.
 */

import type { UnderstandingResult } from '../domain/entities/understanding-result';
import type { ActionOutcome } from '../understanding/outcome/outcome-types';
import type {
  ApplicationKnowledge,
  ConsolidatedEntity,
} from '../understanding/consolidation/application-knowledge';

// ── Caps (spec §0) ─────────────────────────────────────────────────────

export const MAX_ENTITIES = 8;
export const MAX_VIEWS = 6;
export const MAX_TRANSITIONS = 8;
export const MAX_GAPS = 10;
export const MAX_WARNINGS = 8;
export const MAX_SIGNALS = 4;

/** Subset of KnowledgeGapRow the renderer needs (Dexie rows carry more). */
export interface GapLike {
  gapId?: string;
  observedKind: string;
  reason: string;
  detail: string;
}

/** Optional async-attached gaps payload for the initial render call. */
export interface UnderstandingCardOptions {
  gaps?: GapLike[];
}

// ── DOM-free rollup helpers (unit-pinned) ─────────────────────────────

export interface OutcomeRollup {
  total: number;
  success: number;
  failure: number;
  ambiguous: number;
  incomplete: number;
}

export function outcomeRollup(outcomes?: ActionOutcome[]): OutcomeRollup | null {
  if (!outcomes || outcomes.length === 0) return null;
  const r: OutcomeRollup = { total: outcomes.length, success: 0, failure: 0, ambiguous: 0, incomplete: 0 };
  for (const o of outcomes) {
    if (o.outcome === 'success' || o.outcome === 'failure' || o.outcome === 'ambiguous' || o.outcome === 'incomplete') {
      r[o.outcome]++;
    }
  }
  return r;
}

export interface EntitySplit {
  total: number;
  new: ConsolidatedEntity[];
  reinforced: ConsolidatedEntity[];
}

/**
 * New = revision 1 OR observed in a single session (first observation).
 * Everything else is reinforced knowledge.
 */
export function entitySplit(app?: ApplicationKnowledge): EntitySplit {
  const entities = app?.entities ?? [];
  const isNew = (e: ConsolidatedEntity) =>
    e.revision <= 1 || (e.observedInSessions?.length ?? 1) <= 1;
  return {
    total: entities.length,
    new: entities.filter(isNew),
    reinforced: entities.filter((e) => !isNew(e)),
  };
}

/** Single display row per coverage fact. */
export function coverageRows(result: UnderstandingResult): string[] {
  const rows: string[] = [];
  const cov = result.behaviorModel?.coverage;
  if (cov) {
    if (cov.totalInteractions > 0) rows.push(`${cov.anchoredInteractions}/${cov.totalInteractions} interactions anchored`);
    if (cov.totalNetworkRows > 0) rows.push(`${cov.attributedNetworkRows}/${cov.totalNetworkRows} network rows attributed`);
    if (cov.totalObservations > 0) rows.push(`${cov.attributedObservations}/${cov.totalObservations} observations attributed`);
    if (cov.unattributedConsequences > 0) rows.push(`${cov.unattributedConsequences} unattributed consequences`);
    if (cov.provenanceLinks > 0) rows.push(`${cov.provenanceLinks} provenance links`);
  }
  const ec = result.semanticKnowledge?.metadata?.coverage;
  if (ec) {
    // EnrichmentCoverage is a 0–1 FRACTION (semantic-enricher.ts rounds to
    // 3dp) — ×100 for display; guard legacy 0–100 values (none emitted
    // today) by treating >1 as already-percent.
    const pctOf = (v: number) => (v > 1 ? Math.round(v) : Math.round(v * 100));
    if (ec.intentCoverage > 0) rows.push(`intent ${pctOf(ec.intentCoverage)}%`);
    if (ec.componentCoverage > 0) rows.push(`component ${pctOf(ec.componentCoverage)}%`);
    if (ec.contractCoverage > 0) rows.push(`contract ${pctOf(ec.contractCoverage)}%`);
  }
  return rows;
}

/** `kind · reason — detail` per gap. */
export function gapsRows(gaps?: GapLike[]): string[] {
  if (!gaps || gaps.length === 0) return [];
  return gaps.map((g) => `${g.observedKind} · ${g.reason} — ${g.detail}`);
}

// ── Row builders (textContent-only) ────────────────────────────────────

function row(text: string, cls = 'understanding-row'): HTMLElement {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return div;
}

function mutedRow(text: string): HTMLElement {
  return row(text, 'understanding-row understanding-row--muted');
}

function subheader(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'understanding-subheader';
  h.textContent = text;
  return h;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function entityLine(e: ConsolidatedEntity): string {
  const parts = [`${e.type}:${e.entityId}`];
  if (e.currentState) parts.push(e.currentState);
  const isNew = e.revision <= 1 || (e.observedInSessions?.length ?? 1) <= 1;
  if (!isNew) parts.push(`reinforced ×${e.revision}`);
  return parts.join(' · ');
}

function shortSession(sessionId: string): string {
  return sessionId.length > 18 ? `${sessionId.slice(0, 15)}…` : sessionId;
}

// ── Card root ──────────────────────────────────────────────────────────

/**
 * Render the Session Understanding card. Null result → null element
 * (caller keeps the section hidden — honest absence).
 */
export function renderUnderstandingCard(
  result: UnderstandingResult | null | undefined,
  options?: UnderstandingCardOptions,
): HTMLElement | null {
  if (!result) return null;

  const card = document.createElement('div');
  card.className = 'understanding-card';

  // Header
  const header = document.createElement('div');
  header.className = 'understanding-card__header';
  const title = document.createElement('strong');
  title.textContent = 'Session Understanding';
  header.appendChild(title);
  header.appendChild(row(`session ${shortSession(result.sessionId)} · generated ${result.generatedAt}`, 'understanding-card__meta'));
  card.appendChild(header);

  const app = result.applicationKnowledge;
  const semantic = result.semanticKnowledge;

  // 1. App identity
  const identityRows: string[] = [];
  if (app?.label || result.appId) identityRows.push(app?.label ?? result.appId ?? '');
  if (result.appId && app?.label && app.label !== result.appId) identityRows.push(result.appId);
  if (app) {
    identityRows.push(`session ${app.sessionCount} with this app`);
    if (app.origin) identityRows.push(app.origin);
  }
  if (identityRows.length > 0) {
    card.appendChild(subheader('App'));
    for (const r of identityRows) card.appendChild(row(r));
  }

  // 2. Domain
  const domain = semantic?.domain;
  if (domain) {
    card.appendChild(subheader('Domain'));
    const parts = [domain.domain, pct(domain.confidence)];
    if (domain.alternative && domain.margin > 0) parts.push(`alternative: ${domain.alternative}`);
    card.appendChild(row(parts.join(' · ')));
    const signals = domain.evidence?.matchedSignals ?? [];
    if (signals.length > 0) {
      const shown = signals.slice(0, MAX_SIGNALS);
      let line = `signals: ${shown.join(', ')}`;
      if (signals.length > MAX_SIGNALS) line += ` … ${signals.length - MAX_SIGNALS} more`;
      card.appendChild(mutedRow(line));
    }
  }

  // 3. Views & navigation
  const views = app?.views ?? [];
  const edges = app?.viewGraph?.edges ?? [];
  if (views.length > 0 || edges.length > 0) {
    card.appendChild(subheader('Views & navigation'));
    if (views.length > 0) {
      card.appendChild(row(`${views.length} view${views.length === 1 ? '' : 's'}`));
      const shown = views.slice(0, MAX_VIEWS);
      for (const v of shown) card.appendChild(mutedRow(`${v.label} ×${v.visitCount}`));
      if (views.length > MAX_VIEWS) card.appendChild(mutedRow(`… ${views.length - MAX_VIEWS} more views`));
    }
    const viewLabel = (id: string): string => views.find((v) => v.viewId === id)?.label ?? id;
    const shownEdges = edges.slice(0, MAX_TRANSITIONS);
    for (const e of shownEdges) card.appendChild(mutedRow(`${viewLabel(e.fromViewId)} → ${viewLabel(e.toViewId)} ×${e.count}`));
    if (edges.length > MAX_TRANSITIONS) card.appendChild(mutedRow(`… ${edges.length - MAX_TRANSITIONS} more transitions`));
  }

  // 4. Entities
  const split = entitySplit(app);
  if (split.total > 0) {
    card.appendChild(subheader('Entities'));
    card.appendChild(row(`${split.total} tracked · ${split.new.length} new · ${split.reinforced.length} reinforced`));
    const shown = [...split.new, ...split.reinforced].slice(0, MAX_ENTITIES);
    for (const e of shown) card.appendChild(mutedRow(entityLine(e)));
    if (split.total > MAX_ENTITIES) card.appendChild(mutedRow(`… ${split.total - MAX_ENTITIES} more entities`));
  }

  // 5. State & feedback
  const counters = app?.counters?.length ?? 0;
  const collections = app?.collections ?? [];
  const notifications = app?.notifications?.length ?? 0;
  if (counters > 0 || collections.length > 0 || notifications > 0) {
    card.appendChild(subheader('State & feedback'));
    const parts: string[] = [];
    if (counters > 0) parts.push(`${counters} counter${counters === 1 ? '' : 's'}`);
    if (collections.length > 0) parts.push(`${collections.length} collection${collections.length === 1 ? '' : 's'}`);
    if (notifications > 0) parts.push(`${notifications} notification${notifications === 1 ? '' : 's'}`);
    card.appendChild(row(parts.join(' · ')));
    for (const c of collections.slice(0, 3)) {
      card.appendChild(mutedRow(`collection ${c.entityType}: ${c.currentCount} item${c.currentCount === 1 ? '' : 's'}`));
    }
  }

  // 6. Outcomes
  const rollup = outcomeRollup(result.outcomes);
  const pattern = app?.outcomePattern;
  if (rollup || pattern) {
    card.appendChild(subheader('Outcomes'));
    if (rollup) {
      card.appendChild(row(`${rollup.success} success · ${rollup.failure} failure · ${rollup.ambiguous} ambiguous · ${rollup.incomplete} incomplete`));
      card.appendChild(mutedRow(`${rollup.total} actions this session`));
    }
    if (pattern && pattern.totalActions > 0) {
      card.appendChild(mutedRow(`across sessions: ${pattern.successCount} successes / ${pattern.totalActions} actions`));
    }
  }

  // 7. Coverage
  const cov = coverageRows(result);
  if (cov.length > 0) {
    card.appendChild(subheader('Coverage'));
    for (const r of cov) card.appendChild(mutedRow(r));
  }

  // 8. Honesty block — warnings + gaps
  const warnings = [...(result.knowledgeWarnings ?? [])];
  for (const w of result.behaviorModel?.warnings ?? []) warnings.push(w.message);
  const gapTexts = gapsRows(options?.gaps).slice(0, MAX_GAPS);
  if (warnings.length > 0 || gapTexts.length > 0) {
    card.appendChild(subheader('What we could not prove'));
    for (const w of warnings.slice(0, MAX_WARNINGS)) card.appendChild(mutedRow(w));
    if (warnings.length > MAX_WARNINGS) card.appendChild(mutedRow(`… ${warnings.length - MAX_WARNINGS} more warnings`));
    for (const g of gapTexts) card.appendChild(mutedRow(g));
    if ((options?.gaps?.length ?? 0) > MAX_GAPS) {
      card.appendChild(mutedRow(`… ${(options?.gaps?.length ?? 0) - MAX_GAPS} more gaps`));
    }
  }

  return card;
}
