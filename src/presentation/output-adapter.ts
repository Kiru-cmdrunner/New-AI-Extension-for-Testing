/**
 * Presentation Layer — Interaction Filtering & IR Mapping
 *
 * This module has two responsibilities:
 * 1. isProductionInteraction: filter out no-ops and noise
 * 2. toIRAction: convert a ComponentInteraction to an IR action
 *
 * No-op filtering rules:
 * - endState must be 'completed' (abandoned/interrupted are filtered)
 * - TextEntry: userTyped must be true AND textValue non-empty
 * - Dropdown: noOpSelection must be false
 * - RadioButton: noOpSelection must be false
 * - DatePicker: selectedDate must be non-empty
 * - Scroll: hasDelta must be true (non-zero delta)
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 6
 */

import type { ComponentInteraction } from './component-types';
import type { InteractionType } from './component-types';

// ── Production Interaction Filter ────────────────────────────────────

/**
 * Check if a ComponentInteraction should appear in the final output.
 * Filters out no-ops, abandoned, and interrupted interactions.
 *
 * Architecture: §2.2 Stage 6, §4.2/4.4/4.5 (OrangeHRM bug fixes)
 */
export function isProductionInteraction(
  interaction: ComponentInteraction,
): boolean {
  // Only completed interactions pass
  if (interaction.endState !== 'completed') return false;

  const { type, metadata } = interaction;

  switch (type as InteractionType) {
    case 'TextEntry':
      // Bug 4 fix: must have actually typed
      if (metadata.userTyped !== true) return false;
      if (!metadata.textValue || String(metadata.textValue).trim() === '') {
        return false;
      }
      return true;

    case 'Dropdown':
      // Bug 2 fix: must not be a no-op selection
      if (metadata.noOpSelection === true) return false;
      return true;

    case 'RadioButton':
      // Bug 4 fix: must not be a re-selection of already-selected radio
      if (metadata.noOpSelection === true) return false;
      return true;

    case 'DatePicker':
      // Empty date selection must be filtered
      if (
        !metadata.selectedDate ||
        String(metadata.selectedDate).trim() === ''
      ) {
        return false;
      }
      return true;

    case 'Scroll':
      // Bug 5 fix: 0px scroll must be filtered
      if (metadata.hasDelta !== true) return false;
      return true;

    case 'Slider':
      // M0.5 Fix G7: filter out focus-only traversal (userAdjusted=false).
      // Slider triggers on focus but should only appear in output if the
      // user actually adjusted the value (mouse drag, click-to-set, keyboard).
      if (metadata.userAdjusted !== true) return false;
      return true;

    case 'ColorInput':
      // G8: filter out focus-only traversal and same-color re-selection.
      // ColorInput triggers on focus but should only appear if user
      // actually changed the color (userAdjusted=true).
      if (metadata.userAdjusted !== true) return false;
      return true;

    case 'Click':
    case 'Link':
    case 'Checkbox':
    case 'Navigation':
      return true;

    case 'Hover':
      // Evidence-based hover: only meaningful hovers pass the production filter.
      // Transit hovers, cosmetic hovers, and click-suppressed hovers are filtered.
      if (metadata.meaningful !== true) return false;
      return true;

    default:
      return true;
  }
}

/**
 * Filter an array of interactions, keeping only production-worthy ones.
 */
export function filterProductionInteractions(
  interactions: ComponentInteraction[],
): ComponentInteraction[] {
  return interactions.filter(isProductionInteraction);
}

// ── IR Action Mapping ────────────────────────────────────────────────

/**
 * IR Action types — what the generation pipeline expects.
 * These map to Playwright actions in the code generator.
 */
export interface IRAction {
  type:
    | 'CLICK'
    | 'FILL'
    | 'SELECT'
    | 'TOGGLE'
    | 'SELECT_DATE'
    | 'NAVIGATE'
    | 'HOVER'
    | 'WAIT';
  target: {
    name: string;
    tag?: string;
    role?: string | null;
  };
  value?: string;
  metadata?: Record<string, unknown>;
  /** Layer 2: Semantic component type (DataGrid, IconButton, SortButton, etc.). */
  componentType?: string;
  /** Layer 2: Framework that rendered the component (MUI, AntDesign, etc.). */
  componentFramework?: string;
  /** Layer 3: Human-readable business meaning. */
  businessMeaning?: string;
}

/**
 * Convert a ComponentInteraction to an IR Action.
 *
 * Architecture: §3.3 IR Action mapping table
 */
export function toIRAction(interaction: ComponentInteraction): IRAction | null {
  const { type, metadata } = interaction;
  const targetName = String(metadata.targetName ?? 'element');
  const target = {
    name: targetName,
    tag: interaction.trigger.tag,
    role: interaction.trigger.ariaRole,
  };

  // Three-layer enrichment fields
  const enrichment = {
    componentType: interaction.componentType,
    componentFramework: interaction.componentFramework,
    businessMeaning: interaction.businessMeaning,
  };

  switch (type as InteractionType) {
    case 'Click':
    case 'Link':
      return {
        type: 'CLICK',
        target,
        metadata: {
          clientX: metadata.clientX,
          clientY: metadata.clientY,
        },
        ...enrichment,
      };

    case 'TextEntry':
      return {
        type: 'FILL',
        target,
        value: String(metadata.textValue ?? ''),
        metadata: {
          userTyped: metadata.userTyped,
        },
        ...enrichment,
      };

    case 'Dropdown':
      return {
        type: 'SELECT',
        target,
        value: String(metadata.selectedValue ?? ''),
        metadata: {
          noOpSelection: metadata.noOpSelection,
        },
        ...enrichment,
      };

    case 'Checkbox':
      return {
        type: 'TOGGLE',
        target,
        value: metadata.checked ? 'check' : 'uncheck',
        metadata: {
          checked: metadata.checked,
        },
        ...enrichment,
      };

    case 'RadioButton':
      return {
        type: 'CLICK',
        target,
        metadata: {
          noOpSelection: metadata.noOpSelection,
        },
        ...enrichment,
      };

    case 'DatePicker':
      return {
        type: 'SELECT_DATE',
        target,
        value: String(metadata.dateValue ?? metadata.selectedDate ?? ''),
        metadata: {
          selectedDate: metadata.selectedDate,
        },
        ...enrichment,
      };

    case 'Navigation':
      return {
        type: 'NAVIGATE',
        target: { name: metadata.pageTitle ?? metadata.pageUrl ?? 'page' },
        value: metadata.pageUrl,
        ...enrichment,
      };

    case 'Hover':
      return {
        type: 'HOVER',
        target,
        metadata: {
          dwellMs: metadata.dwellMs,
        },
        ...enrichment,
      };

    case 'Scroll':
      return {
        type: 'WAIT',
        target: { name: 'scroll' },
        metadata: {
          scrollDeltaY: metadata.scrollDeltaY,
          scrollDeltaX: metadata.scrollDeltaX,
        },
        ...enrichment,
      };

    case 'Slider':
      return {
        type: 'FILL',
        target,
        value: String(metadata.value ?? ''),
        metadata: {
          userAdjusted: metadata.userAdjusted,
        },
        ...enrichment,
      };

    case 'ColorInput':
      return {
        type: 'FILL',
        target,
        value: String(metadata.value ?? ''),
        metadata: {
          userAdjusted: metadata.userAdjusted,
        },
        ...enrichment,
      };

    default:
      return null;
  }
}

/**
 * Convert an array of interactions to IR actions (with production filter).
 */
export function toIRActions(
  interactions: ComponentInteraction[],
): IRAction[] {
  return filterProductionInteractions(interactions)
    .map(toIRAction)
    .filter((a): a is IRAction => a !== null);
}
