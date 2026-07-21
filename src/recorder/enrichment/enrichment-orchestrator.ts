/**
 * Enrichment Orchestrator — the post-recording enrichment pass.
 *
 * Runs all derivers in dependency order to produce a complete
 * ApplicationKnowledgeFragment from the foundational entities.
 *
 * Flow:
 *   1. Option set extraction (DOM inspection → optionSet + businessField)
 *   2. InteractionContract derivation (domAttributes → constraints)
 *   3. BehavioralContract derivation (transitions → state machines)
 *   4. Semantic Aggregation (transitions + lifecycle → LogicalAction[])
 *   5. Workflow derivation (actions + navigations → RecordedWorkflow)
 *   6. Surface derivation (elements → ApplicationSurface[])
 *   7. Fragment assembly
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §8
 *           docs/architecture-walkthrough.md (flight booking scenario)
 */

import type { UiElement } from '../../domain/entities/ui-element';
import type { ObservedTransition } from '../../domain/entities/observed-transition';
import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import type { ApplicationKnowledgeFragment } from '../../domain/entities/application-knowledge';
import type { DomInspector } from './dom-inspector';
import { getPattern, getAllPatterns } from '../recognition/pattern-catalogue';
import { ComponentLifecycleState } from '../../domain/enums';

import { extractOptionSet } from './option-set-extractor';
import { deriveInteractionContract } from './interaction-contract-deriver';
import { deriveBehavioralContract } from './behavioral-contract-deriver';
import { aggregateActions, _resetActionCounter } from './semantic-aggregator';
import { deriveWorkflow } from './workflow-deriver';
import { deriveSurfaces } from './surface-deriver';
import { assembleFragment } from './fragment-assembler';

/**
 * Input for the enrichment pass.
 */
export interface EnrichmentInput {
  /** Session ID for the fragment. */
  readonly sessionId: string;
  /** All UiElements encountered during the session. */
  readonly elements: UiElement[];
  /** All ObservedTransitions (chronological). */
  readonly transitions: ObservedTransition[];
  /** All ComponentGroupings (confirmed + developing). */
  readonly components: ComponentGrouping[];
  /** DOM inspector for read-only DOM access (option set extraction). */
  readonly domInspector: DomInspector;
}

/**
 * Run the full enrichment pass and produce an ApplicationKnowledgeFragment.
 *
 * This is the entry point for post-recording enrichment. It takes the
 * foundational entities produced during recording, enriches them with
 * deterministic derived views, and assembles the complete fragment.
 *
 * @param input Foundations + DOM inspector.
 * @returns Complete ApplicationKnowledgeFragment.
 */
export function enrichSession(input: EnrichmentInput): ApplicationKnowledgeFragment {
  const { sessionId, elements, transitions, components, domInspector } = input;

  // Reset action counter for deterministic action IDs within a session
  _resetActionCounter();

  // Build lookup maps for efficient access
  const elementMap = new Map(elements.map((e) => [e.elementId, e]));
  const patternMap = new Map(getAllPatterns().map((p) => [p.patternType, p]));

  // ── Step 1: Enrich components with optionSet + businessField ──
  const enrichedComponents = components.map((component) => {
    if (component.lifecycleState !== ComponentLifecycleState.CONFIRMED) {
      return component;
    }

    const extraction = extractOptionSet(component, elementMap, domInspector);

    // Only update if new values were derived
    if (extraction.optionSet !== null || extraction.businessField !== null) {
      return {
        ...component,
        optionSet: extraction.optionSet ?? component.optionSet,
        businessField: extraction.businessField ?? component.businessField,
      };
    }

    return component;
  });

  // ── Step 2: Derive InteractionContracts ──
  const interactionContracts = elements.map((el) => {
    const component = enrichedComponents.find((c) => c.rootElementId === el.elementId);
    const pattern = component ? getPattern(component.patternType) : undefined;
    const contract = deriveInteractionContract(el, pattern);

    // Wire validOptions from enriched component optionSet (spec §1)
    if (component?.optionSet && contract.constraints.validOptions === null) {
      return {
        ...contract,
        constraints: {
          ...contract.constraints,
          validOptions: component.optionSet,
        },
      };
    }
    return contract;
  });

  // ── Step 3: Derive BehavioralContracts for confirmed components ──
  const confirmedComponents = enrichedComponents.filter(
    (c) => c.lifecycleState === ComponentLifecycleState.CONFIRMED,
  );

  const behavioralContracts = confirmedComponents.map((component) => {
    const compTransitions = transitions.filter((t) => t.componentId === component.groupingId);
    const pattern = getPattern(component.patternType);
    return deriveBehavioralContract(
      component,
      compTransitions,
      pattern ?? {
        patternType: component.patternType,
        rootAriaRoles: [],
        constituentRoles: {},
        affordances: [],
        hasOptionSet: false,
        minConstituents: 1,
        description: 'Unknown pattern',
      },
    );
  });

  // ── Step 4: Semantic Aggregation → LogicalActions ──
  const logicalActions = aggregateActions({
    components: confirmedComponents,
    transitions,
    patterns: patternMap,
  });

  // ── Step 5: Workflow derivation ──
  const recordedWorkflow = deriveWorkflow(
    logicalActions,
    transitions,
    confirmedComponents,
    elementMap,
  );

  // ── Step 6: Surface derivation ──
  const applicationSurfaces = deriveSurfaces(elements, confirmedComponents);

  // ── Step 7: Assemble fragment ──
  return assembleFragment({
    sessionId,
    elements,
    transitions,
    components: enrichedComponents,
    interactionContracts,
    behavioralContracts,
    logicalActions,
    recordedWorkflow,
    applicationSurfaces,
  });
}
