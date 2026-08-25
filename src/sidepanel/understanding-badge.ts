/**
 * MS-U1 — Understanding Badge + Why-Block (renderer-only, pure functions).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md
 *
 * Deterministic display of why the engine classified an interaction the way
 * it did. Facts come ONLY from data already recorded on the interaction
 * (metadata written by definitions / projection engine). Where no fact
 * exists, the honest placeholder `reason not recorded` is shown — never a
 * fabricated explanation (definition-evaluation trace is future engine work,
 * design phase U6).
 *
 * No writes, no DOM dependency (callers render), no engine imports.
 */

import type { ComponentInteraction } from '../shared/component-types';

// ── Definition priorities (frozen map, drift-pinned by fs-parse test) ───
//
// D1 (spec §3): priorities are properties of the definition FILES, stable
// and deterministic. The renderer MUST NOT import the engine registry
// (bundle coupling: ALL_DEFINITIONS would pull all 17 definition modules
// and their engine deps into the sidepanel). This is a hand-frozen copy;
// the P4c pin (tests/sidepanel/understanding-badge.test.ts) PARSES the
// 17 definition files from source and fails when this map drifts —
// priority change, new definition, or removal.
//
// Source of truth: `type:` + `priority:` literals in src/definitions/*.ts
// (verified 2026-08-22 @ 64296a1: drag-drop 5 … click 180).

export const DEFINITION_PRIORITIES: Readonly<Record<string, number>> = Object.freeze({
  DragDrop: 5,
  KeyboardShortcut: 8,
  DatePicker: 10,
  ColorInput: 15,
  Dropdown: 20,
  Slider: 25,
  Checkbox: 30,
  FileUpload: 35,
  RadioButton: 40,
  TextEntry: 50,
  Hover: 60,
  Tab: 65,
  Link: 70,
  Expander: 80,
  Scroll: 110,
  Navigation: 120,
  Click: 180,
});

export interface BadgeResult {
  text: string;
  tone: 'recognized' | 'unclassified' | 'honest-gap';
}

// ── Primary understanding badge ─────────────────────────────────────────

export function buildUnderstandingBadge(
  interaction: Pick<ComponentInteraction, 'type' | 'metadata'>,
): BadgeResult {
  const metadata = (interaction.metadata ?? {}) as Record<string, unknown>;

  if (interaction.type === 'Unclassified') {
    const reason = typeof metadata.reason === 'string' && metadata.reason.trim() !== ''
      ? metadata.reason
      : 'reason not recorded';
    return {
      text: `❓ Unclassified — ${reason}`,
      tone: 'unclassified',
    };
  }

  const priority = DEFINITION_PRIORITIES[interaction.type];
  if (priority != null) {
    return {
      text: `✓ ${interaction.type} (prio ${priority})`,
      tone: 'recognized',
    };
  }

  // Type has no registered definition (projected/synthetic or future type) —
  // honest gap, never blank.
  return {
    text: `❓ ${interaction.type} — reason not recorded`,
    tone: 'honest-gap',
  };
}

// ── Projected-pair chip (companion) ─────────────────────────────────────

export function buildProjectedChip(metadata: {
  reason?: unknown;
  physicalEvents?: unknown;
  pairedAtProjection?: unknown;
}): BadgeResult | null {
  const physicalEvents = Array.isArray(metadata.physicalEvents)
    ? (metadata.physicalEvents as unknown[]).filter((e): e is string => typeof e === 'string')
    : [];
  if (physicalEvents.length >= 2) {
    return {
      text: `⚠ projected (${physicalEvents.join('+')} paired)`,
      tone: 'honest-gap',
    };
  }
  return null;
}

// ── Why-block (recorded facts only) ─────────────────────────────────────

/**
 * One-line explanation of the classification, derived exclusively from
 * metadata keys definitions already write. Returns null when no recorded
 * fact applies — the renderer then shows nothing (honesty).
 */
export function buildWhyBlock(
  interaction: Pick<ComponentInteraction, 'type' | 'metadata'>,
): string | null {
  const metadata = (interaction.metadata ?? {}) as Record<string, unknown>;

  switch (interaction.type) {
    case 'Hover': {
      const reason = typeof metadata.evidenceReason === 'string' ? metadata.evidenceReason : null;
      return reason ? `why: hover evidence — ${reason}` : null;
    }

    case 'Dropdown': {
      const provisional = typeof metadata.provisionalSelection === 'string'
        ? metadata.provisionalSelection
        : null;
      const confirmed = metadata.selectionConfirmed === true;
      const selected = typeof metadata.selectedValue === 'string'
        ? metadata.selectedValue
        : null;
      if (provisional && selected) {
        return `why: provisional: ${provisional} → final: ${selected}`;
      }
      if (confirmed && selected) {
        return 'why: selection confirmed';
      }
      return null;
    }

    case 'DatePicker': {
      // date-picker.ts:192 semanticChildRoles ['gridcell'] / tags ['TD'] —
      // structural fact of the definition, stable by registry.
      return 'why: detected via gridcell children';
    }

    default:
      return null;
  }
}
