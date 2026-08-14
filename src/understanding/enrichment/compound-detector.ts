/**
 * M9.10 — Compound Interaction Detector
 *
 * Post-hoc analysis over a sequence of ComponentInteractions to detect
 * multi-step patterns that represent a single user intent.
 *
 * This is a READ-ONLY derived view — it does NOT modify, merge, or
 * delete the original interactions. It produces CompoundAction[] that
 * can be consumed alongside SemanticKnowledge.
 *
 * Detected patterns:
 *  1. Drag-and-drop compound: dragstart → (mousemove*) → drop
 *     Already captured as a single DragDrop interaction by the definition,
 *     but if raw events arrive as separate Click + Click, we detect the
 *     spatial+temporal pattern.
 *  2. Keyboard navigation compound: Tab → Tab → ... → Enter
 *     User tabs through elements and acts on the final one.
 *  3. Select-then-act compound: Click (selection) → Click (action)
 *     on same container within 2s.
 *  4. Form submit compound: TextEntry* → submit event / Click[submit button]
 *
 * Architecture: .drytis/specs/m9-10-extended-interactions.md
 */

import type { ComponentInteraction } from '../../shared/component-types';

/**
 * A compound action groups consecutive interactions that represent a single
 * user intent.
 */
export interface CompoundAction {
  /** Unique ID for this compound action. */
  id: string;
  /** The interaction type of the compound. */
  type: 'drag-drop-sequence' | 'keyboard-navigation' | 'select-then-act' | 'form-submit';
  /** Interaction IDs that compose this compound, in order. */
  memberInteractionIds: string[];
  /** Human-readable summary. */
  summary: string;
  /** Timestamp of the first member interaction. */
  startedAt: number;
  /** Timestamp of the last member interaction. */
  endedAt: number;
  /** Pattern-specific metadata. */
  metadata: Record<string, unknown>;
}

/**
 * Maximum gap (ms) between two interactions for them to be considered
 * part of a compound action.
 */
const COMPOUND_GAP_MS = 3000;

/**
 * Detect compound actions in a sequence of interactions.
 *
 * Interactions must be ordered by timestamp ascending.
 * Returns compound actions without modifying the input.
 */
export function detectCompoundActions(
  interactions: ComponentInteraction[],
): CompoundAction[] {
  if (interactions.length < 2) return [];

  const compounds: CompoundAction[] = [];
  const claimed = new Set<number>(); // indices already in a compound

  // ── Pattern: Form submit (TextEntry* → submit/Click on button) ──
  detectFormSubmit(interactions, compounds, claimed);

  // ── Pattern: Select-then-act (Click on list → Click on action in same area) ──
  detectSelectThenAct(interactions, compounds, claimed);

  // ── Pattern: Keyboard navigation (Tab+ → Enter) ──
  detectKeyboardNavigation(interactions, compounds, claimed);

  return compounds;
}

// ── Pattern Detectors ──────────────────────────────────────────────────

/**
 * Detect form submission: a sequence of TextEntry interactions followed
 * by a Click on a submit button or a submit event.
 */
function detectFormSubmit(
  interactions: ComponentInteraction[],
  compounds: CompoundAction[],
  claimed: Set<number>,
): void {
  for (let i = 0; i < interactions.length; i++) {
    if (claimed.has(i)) continue;
    if (interactions[i].type !== 'TextEntry') continue;

    // Collect consecutive TextEntry interactions
    const members: number[] = [i];
    let j = i + 1;
    while (j < interactions.length && interactions[j].type === 'TextEntry') {
      if (claimed.has(j)) break;
      const gap = interactions[j].startTime - interactions[j - 1].endTime;
      if (gap > COMPOUND_GAP_MS) break;
      members.push(j);
      j++;
    }

    // Check if the next interaction after the TextEntry sequence is a submit
    if (j < interactions.length && !claimed.has(j)) {
      const next = interactions[j];
      const gap = next.startTime - interactions[j - 1].endTime;
      if (gap <= COMPOUND_GAP_MS && isSubmitAction(next)) {
        members.push(j);
        for (const m of members) claimed.add(m);
        compounds.push({
          id: `compound-form-${interactions[i].interactionId}`,
          type: 'form-submit',
          memberInteractionIds: members.map((m) => interactions[m].interactionId),
          summary: `Fill form and submit (${members.length} fields)`,
          startedAt: interactions[i].startTime,
          endedAt: next.endTime,
          metadata: {
            fieldCount: members.length - 1,
            submitType: next.type,
          },
        });
        i = j; // skip past the compound
      }
    }
  }
}

/**
 * Detect select-then-act: a Click on a list/table row followed by a Click
 * on an action button within the same container area.
 */
function detectSelectThenAct(
  interactions: ComponentInteraction[],
  compounds: CompoundAction[],
  claimed: Set<number>,
): void {
  for (let i = 0; i < interactions.length - 1; i++) {
    if (claimed.has(i)) continue;
    if (interactions[i].type !== 'Click') continue;

    const next = interactions[i + 1];
    if (claimed.has(i + 1)) continue;
    if (next.type !== 'Click' && next.type !== 'KeyboardShortcut') continue;

    const gap = next.startTime - interactions[i].endTime;
    if (gap > COMPOUND_GAP_MS) continue;

    // Heuristic: the first click's target has list/table/row semantics
    const firstTarget = interactions[i].trigger;
    const hasListSemantics =
      firstTarget.ariaRole === 'option' ||
      firstTarget.ariaRole === 'row' ||
      firstTarget.ariaRole === 'listitem' ||
      (firstTarget.className?.includes('row') ?? false) ||
      (firstTarget.className?.includes('item') ?? false);

    if (!hasListSemantics) continue;

    claimed.add(i);
    claimed.add(i + 1);
    compounds.push({
      id: `compound-select-${interactions[i].interactionId}`,
      type: 'select-then-act',
      memberInteractionIds: [interactions[i].interactionId, next.interactionId],
      summary: `Select "${firstTarget.accessibleName}" then act`,
      startedAt: interactions[i].startTime,
      endedAt: next.endTime,
      metadata: {
        selectedTarget: firstTarget.accessibleName ?? firstTarget.ariaLabel ?? firstTarget.tag,
      },
    });
    i++; // skip the pair
  }
}

/**
 * Detect keyboard navigation: Tab → Tab → ... → Enter/Click
 */
function detectKeyboardNavigation(
  interactions: ComponentInteraction[],
  compounds: CompoundAction[],
  claimed: Set<number>,
): void {
  for (let i = 0; i < interactions.length; i++) {
    if (claimed.has(i)) continue;

    // Look for Tab sequences (at least 2 consecutive)
    if (interactions[i].type !== 'Tab') continue;

    const members: number[] = [i];
    let j = i + 1;
    while (j < interactions.length && interactions[j].type === 'Tab') {
      if (claimed.has(j)) break;
      const gap = interactions[j].startTime - interactions[j - 1].endTime;
      if (gap > COMPOUND_GAP_MS) break;
      members.push(j);
      j++;
    }

    if (members.length < 2) continue;

    // Check for a finalizing action (Enter/Click) right after
    if (j < interactions.length && !claimed.has(j)) {
      const next = interactions[j];
      const gap = next.startTime - interactions[j - 1].endTime;
      if (gap <= COMPOUND_GAP_MS && (next.type === 'Click' || isEnterShortcut(next))) {
        members.push(j);
      }
    }

    for (const m of members) claimed.add(m);
    const lastMember = interactions[members[members.length - 1]];
    compounds.push({
      id: `compound-kbdnav-${interactions[i].interactionId}`,
      type: 'keyboard-navigation',
      memberInteractionIds: members.map((m) => interactions[m].interactionId),
      summary: `Tab through ${members.length - 1} elements then act`,
      startedAt: interactions[i].startTime,
      endedAt: lastMember.endTime,
      metadata: {
        tabCount: members.length - (isEnterShortcut(lastMember) || lastMember.type === 'Click' ? 1 : 0),
      },
    });
    i = members[members.length - 1];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function isSubmitAction(interaction: ComponentInteraction): boolean {
  // Click on a submit button
  if (interaction.type === 'Click') {
    const md = interaction.metadata;
    const tag = interaction.trigger.tag;
    const inputType = interaction.trigger.inputType ?? md['inputType'] ?? null;
    return tag === 'BUTTON' && (
      (interaction.trigger.className?.match(/submit|btn-primary|btn-save/i) != null) ||
      inputType === 'submit'
    );
  }
  // A submit event itself
  if (interaction.type === 'KeyboardShortcut') {
    const md = interaction.metadata;
    return (md['key'] as string) === 'Enter' && (md['ctrlKey'] as boolean) === true;
  }
  return false;
}

function isEnterShortcut(interaction: ComponentInteraction): boolean {
  if (interaction.type !== 'KeyboardShortcut') return false;
  const md = interaction.metadata;
  const key = (md['key'] as string) ?? '';
  return key === 'Enter';
}
