/**
 * Interpretation Context — minimal metadata the effect interpreter needs
 * from the ComponentInteraction that triggered the observation window.
 *
 * Intentionally a subset of ComponentInteraction to keep the interpreter
 * decoupled and testable with plain data. The interpreter never imports
 * or touches ComponentInteraction directly.
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md
 */

import type { InteractionType } from '../shared/component-types';

export interface InterpretationContext {
  /** The interaction type (Click, Checkbox, TextEntry, etc.). */
  interactionType: InteractionType;
  /** ARIA role of the trigger element, null if none. */
  triggerRole: string | null;
  /** Accessible name of the trigger element. */
  triggerLabel: string;
  /** CSS selector of the trigger element at capture time. */
  triggerCssPath: string;
}
