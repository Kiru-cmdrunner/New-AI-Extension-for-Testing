/**
 * MS-U1 — Evidence Footer (renderer-only, pure function).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md (P6/P6b)
 *
 * Compact counts of what the evidence window captured, so a card answers
 * "what happened around this action" at a glance; the full sections live in
 * the evidence block below. Counts derive from already-captured
 * ApplicationEvidence fields — nothing new is computed or inferred.
 *
 * Absent evidence → null (no footer). Honesty over decoration.
 */

import type { BehavioralEvidence } from '../shared/behavioral-evidence-types';

export function buildEvidenceFooter(
  bev: BehavioralEvidence | null | undefined,
): string | null {
  const app = bev?.applicationEvidence;
  if (!app) return null;

  const parts: string[] = [];

  const domCount = app.domChanges?.length ?? 0;
  const overflow = app.domChangeOverflow ?? 0;
  if (domCount > 0 || overflow > 0) {
    const label = domCount === 1 ? 'dom change' : 'dom changes';
    parts.push(`${domCount} ${label}${overflow > 0 ? ` · +${overflow} dropped` : ''}`);
  }

  const netCount = app.networkActivity?.length ?? 0;
  if (netCount > 0) {
    parts.push(`${netCount} network`);
  }

  const surfaceCount = app.newSurfaces?.length ?? 0;
  if (surfaceCount > 0) {
    const label = surfaceCount === 1 ? 'new surface' : 'new surfaces';
    parts.push(`${surfaceCount} ${label}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
