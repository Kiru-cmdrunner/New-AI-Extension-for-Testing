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
  /**
   * 7.2-M1 deep-link context (optional — pure additive). When present the
   * chip renders as a button that opens the KR browser at this app +
   * signature. Absent → plain span (honest degradation, e.g. lookup that
   * could not resolve the app).
   */
  appId?: string;
  signatureKey?: string;
}

/** 7.2-M1: deep-link target — the KR browser opens at this knowledge row. */
export interface KnowledgeLinkTarget {
  appId?: string;
  signatureKey?: string;
  entityId?: string;
}

export type KrLookup = (
  interactionIds: string[],
) => Promise<Map<string, KrChipResult> | null>;

/** 7.2-M1: injected tab-opener seam (default null → chip inert). */
export type KnowledgeOpen = (target: KnowledgeLinkTarget) => void;

let krLookup: KrLookup | null = null;
let knowledgeOpen: KnowledgeOpen | null = null;

/** Test seam / real wiring installs the read-only lookup here. */
export function setKrLookup(fn: KrLookup | null): void {
  krLookup = fn;
}

/** Test seam / real wiring installs the KR-browser opener here. */
export function setKnowledgeOpen(open: KnowledgeOpen | null): void {
  knowledgeOpen = open;
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
    // 7.2-M1: with link data the chip is a real button (keyboard
    // activatable, cursor-pointer); without, a plain span — text/tone
    // behavior identical to the shipped chip. Values go into dataset /
    // textContent only, never innerHTML.
    let chipEl: HTMLElement;
    if (chip.appId != null && chip.signatureKey != null) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'interaction-chip interaction-chip--kr';
      btn.dataset.appId = chip.appId;
      btn.dataset.signatureKey = chip.signatureKey;
      // 7.2-M1: click + Enter/Space → injected opener (null → inert).
      // Native button click() covers pointer activation; the keydown
      // handler pins Enter/Space for environments that don't synthesize
      // click from keydown on buttons.
      const openTarget = (): void => {
        if (!knowledgeOpen) return;
        try {
          knowledgeOpen({ appId: chip.appId, signatureKey: chip.signatureKey });
        } catch {
          // opener failure must never surface in the panel
        }
      };
      btn.addEventListener('click', openTarget);
      // 7.2-M1: Enter/Space → opener. preventDefault() BEFORE opening
      // suppresses the browser's synthesized click on real buttons (which
      // would call the opener twice → two tabs). jsdom synthesizes nothing,
      // so this handler alone drives keyboard activation in tests.
      btn.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openTarget();
        }
      });
      chipEl = btn;
    } else {
      const span = document.createElement('span');
      span.className = 'interaction-chip interaction-chip--kr';
      chipEl = span;
    }
    chipEl.textContent = chip.text;
    el.appendChild(chipEl);
    if (chip.tone === 'new') el.classList.add('has-kr-new');
  }
}
