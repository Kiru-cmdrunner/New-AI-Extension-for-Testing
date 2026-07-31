/**
 * Interaction Enrichment Pass (E1)
 *
 * A single enrichment pass that runs after classification (evidence
 * annotation in onEmit) and before IR generation (IR Bridge build()).
 * It consolidates three concerns into one cohesive transform:
 *
 * 1. Locator resolution — every interaction's trigger element gets
 *    resolved locators, stored for assertion backfill.
 * 2. Assertion derivation + backfill — state and constraint assertions
 *    are derived and given real locators (fixes F5 crash).
 * 3. Structural assertion generation — action-type-specific assertions
 *    (presence, visibility) that verify the action had an effect.
 *
 * Design principle: the IR Bridge should be a pure transform that reads
 * pre-enriched data, not a layer that re-derives semantic properties.
 *
 * Boundary: this pass handles per-interaction enrichment only.
 * Cross-interaction enrichment (state dependencies, semantic grouping)
 * belongs in a future Sequence Enrichment Pass (E2). Post-IR
 * optimization (POM extraction, step merging) belongs in a future IR
 * Optimization Pass (E3).
 *
 * Architecture: .drytis/TIER2A_DESIGN.md
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { ResolvedLocator } from '../domain/execution-ir/types';
import type { IRAssertion } from '../domain/execution-ir/types';
import type { ApplicationKnowledgeFragment } from '../domain/entities/application-knowledge';
import {
  toBridgeInteraction,
  resolveLocatorsForIR,
  deriveAssertions,
  type BridgeInteraction,
} from './ir-bridge';
import { deriveStateAssertions } from './assertion-deriver';
import { deriveStructuralAssertions } from './assertion-providers';

// ── Contract Types ────────────────────────────────────────────────────

/**
 * Input for the Interaction Enrichment Pass.
 *
 * The interactions array contains ComponentInteractions that have already
 * been through the per-interaction enrichment in onEmit:
 *   - enrichInteraction() → componentType, businessMeaning
 *   - annotateWithEvidence() → intent, confidence, evidenceTrail
 *   - enrichConfigurationSession() → configurationSession metadata
 *
 * This pass adds locator resolution and assertion derivation on top.
 */
export interface EnrichmentInput {
  /** Interactions from stopRecording(), already evidence-annotated. */
  interactions: ComponentInteraction[];
  /** Optional knowledge fragment for constraint assertions. */
  fragment: ApplicationKnowledgeFragment | null;
}

/**
 * Output of the Interaction Enrichment Pass.
 *
 * Both maps are keyed by interactionId so the IR Bridge can look up
 * pre-derived assertions and locators during build() without re-deriving.
 */
export interface EnrichmentOutput {
  /** Pre-derived assertions per interaction, keyed by interactionId. */
  assertions: Map<string, IRAssertion[]>;
  /** Resolved locators per interaction, keyed by interactionId. */
  locators: Map<string, ResolvedLocator[]>;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Run the Interaction Enrichment Pass over a batch of interactions.
 *
 * For each interaction, this pass:
 *   1. Resolves locators from the interaction's trigger element identity
 *   2. Derives state assertions (value, checked, selected) from metadata
 *   3. Derives constraint assertions from the knowledge fragment
 *   4. Backfills resolved locators into every assertion's target
 *
 * The pass is a pure function — it does not mutate the input interactions.
 * It returns derived data (assertions, locators) for the IR Bridge to read.
 *
 * @param input Interactions + optional knowledge fragment
 * @returns Pre-derived assertions and locators, keyed by interactionId
 */
export function enrichInteractions(input: EnrichmentInput): EnrichmentOutput {
  const assertions = new Map<string, IRAssertion[]>();
  const locators = new Map<string, ResolvedLocator[]>();

  for (const interaction of input.interactions) {
    // Phase 1: Resolve locators from the interaction's trigger element
    const resolvedLocators = resolveLocatorsForIR(interaction.trigger);
    locators.set(interaction.interactionId, resolvedLocators);

    // Phase 2: Derive assertions (state + constraint + structural)
    const bridgeInteraction = toBridgeInteraction(interaction);
    const stateAssertions = deriveStateAssertions(bridgeInteraction);
    const constraintAssertions = deriveAssertions(
      interaction.trigger.elementId,
      input.fragment,
    );
    const structuralAssertions = deriveStructuralAssertions(
      bridgeInteraction,
      resolvedLocators,
    );
    const allAssertions = [
      ...constraintAssertions,
      ...stateAssertions,
      ...structuralAssertions,
    ];

    // Phase 3: Backfill resolved locators into every assertion target
    // deriveStateAssertions() creates targets with empty resolvedLocators[].
    // Without locators, the Playwright assertion renderer crashes (F5 bug).
    const backfilledAssertions = allAssertions.map((assertion) => {
      if (assertion.target.kind === 'element') {
        return {
          ...assertion,
          target: {
            ...assertion.target,
            resolvedLocators: resolvedLocators,
            elementId: interaction.trigger.elementId || assertion.target.elementId,
            elementName: interaction.trigger.accessibleName
              || interaction.trigger.ariaLabel
              || interaction.trigger.tag
              || assertion.target.elementName,
          },
        };
      }
      return assertion;
    });

    if (backfilledAssertions.length > 0) {
      assertions.set(interaction.interactionId, backfilledAssertions);
    }
  }

  return { assertions, locators };
}
