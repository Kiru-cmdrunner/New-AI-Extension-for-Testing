/**
 * Hover–click pair folding (G5) — presentation-only grouping.
 *
 * Hover-capture generic fix v1: one physical action (hover then click)
 * surfaces two cards (Hover + Click). A COMPLETED hover with terminal
 * `consumed-by-click` whose trigger identity (tag + stableId +
 * accessibleName — structural keys only; the lifecycle already encodes the
 * causality) matches a FOLLOWING click's trigger folds under that click
 * card. No timestamps, no persistence change, no live-timeline change —
 * the stopped-view renderer consumes this to render one card per user
 * action with the hover as a nested detail row.
 *
 * Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G5.
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { ElementIdentity } from '../shared/types';

export interface HoverClickPair {
  /** The primary card (the click). */
  primary: ComponentInteraction;
  /** Hovers folded under the primary card, in recorded order. */
  folded: ComponentInteraction[];
}

export interface FoldResult {
  /** Folded pairs (clicks with ≥1 folded hover). */
  pairs: HoverClickPair[];
  /** Render order: for each surviving card, its interactionId. Folded
   *  hovers are NOT dropped — they render nested inside their click card. */
  order: string[];
  /** interactionId → pair index (for the renderer to attach nested rows). */
  foldedUnder: Map<string, number>;
}

/** Structural trigger identity key — no timestamps, no classes. */
function triggerKey(t: ElementIdentity | null | undefined): string {
  if (!t) return '';
  return `${t.tag ?? ''}|${t.stableId ?? ''}|${t.accessibleName ?? ''}`;
}

/** Is this interaction a foldable consumed-by-click hover? (recorded facts only) */
function isConsumedHover(i: ComponentInteraction): boolean {
  if (i.type !== 'Hover') return false;
  if (i.endState !== 'completed') return false;
  return (i.metadata as Record<string, unknown> | undefined)?.terminal === 'consumed-by-click';
}

/** Click-family interactions that can own a folded hover. */
function isClickFamily(i: ComponentInteraction): boolean {
  return (i.type === 'Click' || i.type === 'Link' || i.type === 'Unclassified') &&
    i.endState === 'completed';
}

/**
 * Fold consumed-by-click hovers under the NEXT click-family interaction with
 * the same structural trigger identity. A hover never folds across a
 * different-target click (identity is the join key). Unmatched hovers stay
 * as their own cards.
 */
export function foldHoverClickPairs(interactions: ComponentInteraction[]): FoldResult {
  const pairs: HoverClickPair[] = [];
  const foldedUnder = new Map<string, number>();
  const order: string[] = [];
  /** Pending consumed hovers awaiting their identity-matching click —
   *  kept WITH their original position so unmatched ones render in
   *  recorded order (R-I6 spirit: STOP projects, never reorders history). */
  const pending: Array<{ interaction: ComponentInteraction; position: number }> = [];

  for (const interaction of interactions) {
    if (isConsumedHover(interaction)) {
      pending.push({ interaction, position: order.length });
      // Reserve the slot — filled by the hover itself if never matched.
      order.push(interaction.interactionId);
      continue;
    }
    if (isClickFamily(interaction)) {
      const key = triggerKey(interaction.trigger);
      const matched = pending.filter(
        (p) => triggerKey(p.interaction.trigger) === key,
      );
      if (matched.length > 0) {
        for (const p of matched) {
          pending.splice(pending.indexOf(p), 1);
          // Remove the reserved slot — the hover now renders nested.
          const slot = order.indexOf(p.interaction.interactionId);
          if (slot !== -1) order.splice(slot, 1);
        }
        const idx = pairs.findIndex((p) => p.primary.interactionId === interaction.interactionId);
        if (idx === -1) {
          const pair: HoverClickPair = { primary: interaction, folded: matched.map((m) => m.interaction) };
          pairs.push(pair);
          foldedUnder.set(interaction.interactionId, pairs.length - 1);
        } else {
          pairs[idx].folded.push(...matched.map((m) => m.interaction));
        }
      }
    }
    // The click (matched or not) and every non-foldable interaction render
    // as their own card, in recorded order.
    order.push(interaction.interactionId);
  }

  return { pairs, order, foldedUnder };
}
