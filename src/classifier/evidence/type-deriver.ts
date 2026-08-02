/**
 * Type derivation: maps a semantic intent back to a backward-compatible
 * InteractionType.
 *
 * The intent is the primary classification; the type is derived for
 * backward compatibility with the existing IR Bridge, display layer,
 * and storage. Every existing InteractionType is derivable.
 *
 * Phase 1 scope: only toggle, navigate, and trigger intents are implemented.
 * The other intents (select, input, explore) are for future phases.
 *
 * R3.2: select and input intents now implemented. The derivation uses
 * behavioral and structural signals from the expanded FeatureViewInput to
 * produce specific types (Dropdown, Slider, TextEntry) when sufficient
 * evidence is available, falling back to Click when signals are ambiguous.
 */

import type { SemanticIntent, FeatureViewInput } from './types';

/**
 * Resolved interaction type from the evidence engine's intent inference.
 * Uses the same string literal vocabulary the IR Bridge expects.
 */
type DerivedInteractionType =
  | 'ToggleSwitch'
  | 'Checkbox'
  | 'NewTab'
  | 'NewWindow'
  | 'Link'
  | 'Click'
  | 'Hover'
  | 'Dropdown'    // R3.2: select intent
  | 'Slider'      // R3.2: select intent
  | 'TextEntry'   // R3.2: input intent
  | 'RadioButton'; // R3.2: select intent

/**
 * Derive an InteractionType from a semantic intent and the feature view.
 *
 * The derivation uses element context to produce the most specific type.
 * When behavioral/structural signals are ambiguous, falls back to Click
 * rather than guessing.
 */
export function deriveType(
  intent: SemanticIntent,
  f: FeatureViewInput,
): DerivedInteractionType {
  switch (intent) {
    case 'toggle':
      // role=switch → ToggleSwitch; everything else is a Checkbox
      if (f.ariaRole === 'switch') return 'ToggleSwitch';
      if (f.ariaRole === 'button' && f.hasCheckedTransition) return 'ToggleSwitch';
      return 'Checkbox';

    case 'navigate':
      // Opens new tab/window is handled by the fast path, but as a safety net:
      if (f.opensNewTab) return 'NewTab';
      if (f.opensNewWindow) return 'NewWindow';
      return 'Link';

    case 'trigger':
      return 'Click';

    case 'explore':
      return 'Hover';

    // R3.2: select intent — derive specific select type from behavioral/structural signals
    case 'select': {
      // aria-valuenow present → Slider
      if (f.ariaValueNow !== null) return 'Slider';

      // Panel emergence: aria-expanded set (statically or via transition) OR aria-haspopup
      const hasExpandedTransition = f.hasAttributeTransition &&
        f.attributeChanges.some(c => c.attribute === 'aria-expanded');
      if (hasExpandedTransition) return 'Dropdown';
      if (f.ariaExpanded === true) return 'Dropdown';
      if (f.ariaHasPopup) return 'Dropdown';

      // Ancestor context suggests a listbox/menu/tablist
      const selectAncestor = f.ancestorRoles.some(r =>
        r === 'listbox' || r === 'menu' || r === 'tablist' || r === 'list'
      );
      if (selectAncestor) return 'Dropdown';

      // Insufficient behavioral signal for a specific select type
      return 'Click';
    }

    // R3.2: input intent — derive from value transitions
    case 'input': {
      // Value changed → TextEntry
      if (f.valueBefore !== null && f.valueAfter !== null && f.valueBefore !== f.valueAfter) {
        return 'TextEntry';
      }
      // ContentEditable → TextEntry
      if (f.isContentEditable) return 'TextEntry';

      // Insufficient behavioral signal
      return 'Click';
    }

    default:
      return 'Click';
  }
}

/**
 * Derive metadata from the intent and feature view.
 * This supplements the type derivation with the metadata fields
 * the downstream IR Bridge expects.
 */
export function deriveMetadata(
  intent: SemanticIntent,
  f: FeatureViewInput,
): { checked?: boolean; accessibleName?: string; inputValue?: string; selectedValue?: string } {
  const meta: { checked?: boolean; accessibleName?: string; inputValue?: string; selectedValue?: string } = {};

  if (intent === 'toggle') {
    // Use checkedAfter if available, fall back to checkedBefore
    if (f.checkedAfter !== null) {
      meta.checked = f.checkedAfter;
    } else if (f.checkedBefore !== null) {
      meta.checked = f.checkedBefore;
    } else {
      // No native checked state (e.g. <a> tag toggle with class/aria-checked
      // transitions). Default to true — a toggle click means the element was
      // activated. This metadata feeds the domain adapter's STATE_CHANGE
      // evidence, which the pattern recognizer needs to create a CHECKBOX
      // component grouping.
      meta.checked = true;
    }
  }

  // R3.2: input intent — carry the input value
  if (intent === 'input') {
    if (f.valueAfter !== null) {
      meta.inputValue = f.valueAfter;
    } else if (f.valueBefore !== null) {
      meta.inputValue = f.valueBefore;
    }
  }

  // R3.2: select intent — carry selected value if available
  if (intent === 'select') {
    if (f.ariaValueNow !== null) {
      meta.selectedValue = f.ariaValueNow;
    }
  }

  if (f.accessibleName) {
    meta.accessibleName = f.accessibleName;
  }

  return meta;
}
