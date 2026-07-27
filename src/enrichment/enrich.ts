/**
 * Enrichment Pipeline — Three-Layer Model Integration
 *
 * Takes a ComponentInteraction (Layer 1: interaction type) and enriches it with:
 *   Layer 2: Component Type (DataGrid, IconButton, SortButton, etc.)
 *   Layer 3: Business Meaning ("Sort by Name", "Close dialog", etc.)
 *
 * This module is the single integration point between the Component Runtime
 * and the Enrichment Layer. It's called in the onEmit callback — after the
 * runtime produces a ComponentInteraction, before it's persisted/displayed.
 *
 * Architecture: .drytis/specs/three-layer-component-model.md
 */

import type { ComponentInteraction } from '../shared/component-types';
import { detectComponent } from './component-detector';
import { resolveMeaning } from './meaning-resolver';

/**
 * Enrich a ComponentInteraction with Layer 2 (component type) and
 * Layer 3 (business meaning).
 *
 * Mutates the interaction object by adding:
 *   - componentType: which UI component was interacted with
 *   - componentFramework: which library rendered it
 *   - businessMeaning: human-readable description of the user's intent
 *
 * @param interaction — the interaction to enrich
 * @returns the same interaction (mutated, for chaining)
 */
export function enrichInteraction(
  interaction: ComponentInteraction,
): ComponentInteraction {
  const detection = detectComponent(interaction.triggerEvent);
  const meaning = resolveMeaning(interaction, detection);

  interaction.componentType = detection.componentType;
  interaction.componentFramework = detection.componentFramework;
  interaction.businessMeaning = meaning;

  return interaction;
}

/**
 * Enrich an array of interactions in place.
 */
export function enrichInteractions(
  interactions: ComponentInteraction[],
): ComponentInteraction[] {
  for (const interaction of interactions) {
    enrichInteraction(interaction);
  }
  return interactions;
}
