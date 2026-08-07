/**
 * SW Bridge — connects the pure interpret() function to the service worker's
 * ComponentInteraction data model.
 *
 * Translates a ComponentInteraction into the minimal InterpretationContext
 * the interpreter needs, calls interpret() for each observation window,
 * and attaches the resulting SemanticEffect[] to the result.
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md §Sub-phase 2
 */

import { interpret } from './effect-interpreter';
import type { InterpretationContext } from './interpretation-context';
import type { ComponentInteraction } from '../shared/component-types';

/**
 * Build an InterpretationContext from a ComponentInteraction's trigger
 * element identity. The interpreter only needs 4 fields from the full
 * ElementIdentity — this avoids coupling the interpreter to the
 * ComponentInteraction type.
 */
function buildContext(interaction: ComponentInteraction): InterpretationContext {
  return {
    interactionType: interaction.type,
    triggerRole: interaction.trigger.ariaRole,
    triggerLabel: interaction.trigger.accessibleName,
    triggerCssPath: interaction.trigger.cssSelector,
  };
}

/**
 * Interpret all behavioral observations attached to an interaction.
 *
 * For each ObservationResult, runs interpret() and attaches the
 * resulting SemanticEffect[] back onto the result as a new field.
 *
 * Idempotent: if semanticEffects already exist on a result, they are
 * NOT reinterpreted — the existing effects are preserved.
 *
 * Fail-safe: if interpret() throws for any reason, the observation's
 * semanticEffects is left unset and the exception is swallowed so
 * that interpretation never prevents evidence persistence.
 *
 * This is called from BOTH attachment points:
 * - handleBehavioralEffects (immediate path)
 * - attachPendingBehavioralObservations (deferred path)
 */
export function interpretBehavioralObservations(
  interaction: ComponentInteraction,
): void {
  if (!interaction.behavioralObservations) return;

  const ctx = buildContext(interaction);

  for (const result of interaction.behavioralObservations) {
    // Idempotency: don't reinterpret if already done
    if (result.semanticEffects) continue;

    try {
      const effects = interpret(result, ctx);
      result.semanticEffects = effects;
    } catch {
      // Fail-safe: interpretation failure must never prevent
      // evidence persistence. Leave semanticEffects unset.
    }
  }
}
