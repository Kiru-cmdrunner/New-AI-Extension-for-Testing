/**
 * MS-U1 — KR Linkage Chip (renderer-only, read-only knowledge reads).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md (P8/P8b/P9)
 *
 * Shows how strongly an interaction is linked to learned knowledge:
 *   ◆ new signature       — first observation of this action signature
 *   ◆ reinforced ×5 …     — the signature has been seen N times
 *
 * Join path (one bulk read per render batch, never per-card):
 *   knowledgeEpisodes.members[].interactionId → episode.signatureKey
 *   → knowledgeSignatures row (occurrenceCount, firstSeenAtSession, status)
 *
 * The Dexie read is injected via setKrLookup so the module stays
 * DOM/storage-free and testable; the default is an honest no-op (no chip).
 * Any failure → no chip, never an error surfaced in the panel. Zero writes.
 */

import type { KnowledgeEpisodeRow, KnowledgeActionSignatureRow } from '../understanding/persistence/knowledge-types';

export interface KrChipResult {
  text: string;
  tone: 'new' | 'reinforced' | 'stale';
}

export type KrLookup = (
  interactionIds: string[],
) => Promise<Map<string, KrChipResult> | null>;

let krLookup: KrLookup | null = null;

/** Test seam / real wiring installs the read-only lookup here. */
export function setKrLookup(fn: KrLookup | null): void {
  krLookup = fn;
}

export function buildKrChip(
  sig: Pick<KnowledgeActionSignatureRow, 'occurrenceCount' | 'firstSeenAtSession' | 'status'> | null | undefined,
): KrChipResult | null {
  if (!sig) return null;
  if (sig.status === 'stale') {
    return {
      text: `◆ reinforced ×${sig.occurrenceCount} · stale (not seen recently)`,
      tone: 'stale',
    };
  }
  if (sig.occurrenceCount <= 1) {
    return { text: '◆ new signature', tone: 'new' };
  }
  return {
    text: `◆ reinforced ×${sig.occurrenceCount} · first seen ${sig.firstSeenAtSession}`,
    tone: 'reinforced',
  };
}

/**
 * Bulk join: episodes → interactionId map, then signatures. Pure — the
 * caller (lookup implementation) does the reads.
 */
export function joinSignatures(
  episodes: KnowledgeEpisodeRow[],
  signatures: KnowledgeActionSignatureRow[],
): Map<string, KrChipResult> {
  const sigByKey = new Map(signatures.map((s) => [s.key, s]));
  const out = new Map<string, KrChipResult>();
  for (const ep of episodes) {
    const members = Array.isArray(ep.members) ? ep.members : [];
    for (const member of members) {
      if (!member?.interactionId) continue;
      if (out.has(member.interactionId)) continue; // first wins
      const sig = sigByKey.get(ep.signatureKey);
      const chip = buildKrChip(sig);
      if (chip) out.set(member.interactionId, chip);
    }
  }
 return out;
}

/**
 * Async chip attach — never blocks card render. All failures → silent
 * honest absence (chip simply not shown).
 */
export async function attachKrChips(
  cardsByInteractionId: Map<string, HTMLElement>,
): Promise<void> {
  if (!krLookup || cardsByInteractionId.size === 0) return;
  let result: Map<string, KrChipResult> | null = null;
  try {
    result = await krLookup([...cardsByInteractionId.keys()]);
  } catch {
    return; // honest absence
  }
  if (!result) return;
  for (const [interactionId, chip] of result) {
    const el = cardsByInteractionId.get(interactionId);
    if (!el || !el.isConnected) continue;
    if (el.querySelector('.interaction-chip--kr')) continue; // idempotent
    const span = document.createElement('span');
    span.className = 'interaction-chip interaction-chip--kr';
    span.textContent = chip.text;
    el.appendChild(span);
    if (chip.tone === 'new') el.classList.add('has-kr-new');
  }
}
