/**
 * MS-U5 — Forward links (Surface 3C): "How will this knowledge improve
 * future recordings?"
 *
 * Renderer-only, deterministic templates of RECORDED fields. Every string is
 * a pure function of KnowledgeActionSignatureRow / KnowledgeGapRow /
 * Element.healHistory — no invented dates, names, or confidence, no AI
 * narration. Recognition hints into definitions are OUT (7.3 boundary):
 * this surface explains; it never alters capture or classification.
 *
 * Spec: .drytis/specs/phase-6-u5-forward-links.md §6 P1–P9.
 */

/** Minimal recorded fields the F1 line templates read. */
export interface ForwardSignature {
  actionType: string;
  normalizedTarget: string;
  occurrenceCount: number;
  status: 'active' | 'stale';
  firstSeenAtSession: string;
}

export interface ForwardLine {
  text: string;
  tone: 'new' | 'reinforced' | 'stale';
}

/**
 * F1 — one forward-link line per signature the session touched.
 * P1 new · P2 reinforced-active · P3 stale (never claims instant
 * recognition) · P3b ×2 reinforced · P3c honest absence.
 */
export function forwardLinkLine(
  sig: ForwardSignature | null | undefined,
): ForwardLine | null {
  if (!sig) return null;
  if (sig.status === 'stale') {
    return {
      text: `◆ reinforced ×${sig.occurrenceCount} · not seen recently`,
      tone: 'stale',
    };
  }
  if (sig.occurrenceCount <= 1) {
    return {
      text: '◆ new signature — first observation; next recording reinforces it',
      tone: 'new',
    };
  }
  return {
    text: `◆ reinforced ×${sig.occurrenceCount} · recognized instantly next session`,
    tone: 'reinforced',
  };
}

/**
 * F1 summary — one deterministic sentence describing the session's forward
 * value. All-new vs reinforced sessions only; callers render lines
 * alongside. Absent lines (all null) → null.
 */
export function forwardSummaryLine(
  lines: (ForwardLine | null)[],
  opts: { anyReinforced: boolean },
): string | null {
  const present = lines.filter((l): l is ForwardLine => l !== null);
  if (present.length === 0) return null;
  if (opts.anyReinforced) {
    return 'Recording reinforced existing knowledge — next session starts from what was learned.';
  }
  return 'No signatures existed before this session — every action learned is new.';
}

/**
 * F2 — gap guidance: deterministic counts by reason, count desc then reason
 * asc, one sentence. Unknown reasons are counted honestly (never dropped,
 * never invented). Zero gaps → null (block absent; absence is honest).
 */
export function gapGuidanceLine(
  gaps: readonly { reason: string }[] | null | undefined,
): string | null {
  if (!gaps || gaps.length === 0) return null;
  const byReason = new Map<string, number>();
  for (const g of gaps) {
    if (!g?.reason) continue;
    byReason.set(g.reason, (byReason.get(g.reason) ?? 0) + 1);
  }
  if (byReason.size === 0) return null;
  const parts = [...byReason.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([reason, count]) => `${reason} ×${count}`);
  const total = gaps.length;
  return `${total} observation(s) could not be attributed (${parts.join(', ')}) — recording the flow again may confirm horizons.`;
}

/** Minimal recorded fields the F3 line templates read (Element subset). */
export interface HealElement {
  healHistory: readonly unknown[];
  lastHealedAt: string | null;
}

/**
 * F3 — locator durability line for one Element. Non-empty healHistory →
 * `N heals · last healed YYYY-MM-DD` (date taken verbatim from the recorded
 * lastHealedAt, truncated to the date — never formatted from now()).
 * Empty healHistory → honest never-healed line. Null element → null.
 * `render=false` (P9: no Elements rows exist at all) → null — the line is
 * absent entirely rather than fabricating an empty state.
 */
export function healLine(
  el: HealElement | null | undefined,
  render = true,
): string | null {
  if (!el || !render) return null;
  const heals = Array.isArray(el.healHistory) ? el.healHistory : [];
  if (heals.length === 0) return 'recorded, no heals on record';
  const last = el.lastHealedAt ? el.lastHealedAt.slice(0, 10) : '—';
  return `${heals.length} heals · last healed ${last}`;
}
