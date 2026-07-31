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
 */

import type { InteractionType } from '../interaction-types';
import type { SemanticIntent, FeatureViewInput } from './types';

/**
 * Derive an InteractionType from a semantic intent and the feature view.
 *
 * The derivation uses element context to produce the most specific type:
 *   - toggle + role=switch → ToggleSwitch
 *   - toggle + anything else → Checkbox
 *   - navigate + opensNewTab → NewTab (handled earlier in classifier, but safe)
 *   - navigate + link element → Link
 *   - navigate + non-link → Link (fallback)
 *   - trigger → Click
 */
export function deriveType(
  intent: SemanticIntent,
  f: FeatureViewInput,
): InteractionType {
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

    // Phase 2+ intents — not yet implemented, fall through to Click
    case 'select':
    case 'input':
      return 'Click';

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
): { checked?: boolean; accessibleName?: string } {
  const meta: { checked?: boolean; accessibleName?: string } = {};

  if (intent === 'toggle') {
    // Use checkedAfter if available, fall back to checkedBefore
    if (f.checkedAfter !== null) {
      meta.checked = f.checkedAfter;
    } else if (f.checkedBefore !== null) {
      meta.checked = f.checkedBefore;
    }
  }

  if (f.accessibleName) {
    meta.accessibleName = f.accessibleName;
  }

  return meta;
}
