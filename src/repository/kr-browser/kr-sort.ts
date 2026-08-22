/**
 * MS-U4 — pure deterministic ordering + caps for the KR browser.
 *
 * Renderer-only helpers: no DB, no DOM. Every ordering is total and
 * deterministic (secondary key asc) so cross-render snapshots are stable.
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md §6 P1–P5, P12.
 */

import type {
  KnowledgeActionSignatureRow,
  KnowledgeRecordedWorkflowRow,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
  KnowledgeGapRow,
} from '../../understanding/persistence/knowledge-types';

// ── caps (single source of truth; pinned in kr-sort.test.ts) ────────────

export const KR_CAPS = Object.freeze({
  signatures: 50,
  workflows: 30,
  views: 30,
  viewEdges: 60,
  gaps: 50,
  outcomes: 50,
  entities: 100,
  collections: 30,
  counters: 30,
  notifications: 50,
  behaviorSessions: 10,
  edgesPerSession: 20,
  apiSeeds: 25,
});

/** null at/below cap; honest "… N more" above (never hides the count). */
export function overflowMarker(total: number, cap: number): string | null {
  if (total <= cap) return null;
  return `… ${total - cap} more`;
}

// ── ordering ────────────────────────────────────────────────────────────

/** Signatures: active before stale; occurrenceCount desc; key asc. */
export function sortSignatures(
  rows: KnowledgeActionSignatureRow[],
): KnowledgeActionSignatureRow[] {
  return [...rows].sort((a, b) => {
    const statusRank = (s: string) => (s === 'active' ? 0 : 1);
    const byStatus = statusRank(a.status) - statusRank(b.status);
    if (byStatus !== 0) return byStatus;
    if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Workflows: lastSeenAt desc, then key asc. */
export function sortWorkflows(
  rows: KnowledgeRecordedWorkflowRow[],
): KnowledgeRecordedWorkflowRow[] {
  return [...rows].sort((a, b) => {
    if (b.lastSeenAt !== a.lastSeenAt) return b.lastSeenAt - a.lastSeenAt;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Views: visitCount desc, then key asc (deterministic map node order). */
export function sortViews(rows: KnowledgeViewRow[]): KnowledgeViewRow[] {
  return [...rows].sort((a, b) => {
    if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** View edges (transitions): count desc, then key asc. */
export function sortViewEdges(
  rows: KnowledgeViewTransitionRow[],
): KnowledgeViewTransitionRow[] {
  return [...rows].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Gaps: newest first (observedAtMs desc), then key asc. */
export function sortGaps(rows: KnowledgeGapRow[]): KnowledgeGapRow[] {
  return [...rows].sort((a, b) => {
    if (b.observedAtMs !== a.observedAtMs) return b.observedAtMs - a.observedAtMs;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/** Reason-grouped gap summary: count desc, reason asc. */
export function reasonSummary(
  rows: KnowledgeGapRow[],
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const g of rows) counts.set(g.reason, (counts.get(g.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
    });
}

// ── dates (deterministic rendering; P12) ────────────────────────────────

/**
 * Deterministic date rendering. Epoch-ms → 'YYYY-MM-DD HH:MM' in UTC so
 * pins and cross-render snapshots never drift with the host locale.
 * Nullish/undefined/0 → '—' (honest absence; 0 is never a real timestamp
 * in the KR — rows always carry Date.now() values).
 */
export function fmtDate(epochMs: number | null | undefined): string {
  if (!epochMs) return '—';
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
