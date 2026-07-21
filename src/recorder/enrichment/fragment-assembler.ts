/**
 * Fragment Assembler — combines all foundations and derived views into
 * a single ApplicationKnowledgeFragment.
 *
 * Pure function: takes pre-computed foundations and derived views, produces
 * the complete fragment. No computation — just assembly.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §7
 */

import type { UiElement } from '../../domain/entities/ui-element';
import type { ObservedTransition } from '../../domain/entities/observed-transition';
import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import type {
  ApplicationKnowledgeFragment,
  UiElementSummary,
  TransitionSummary,
  ComponentSummary,
  InteractionContract,
  BehavioralContract,
  LogicalAction,
  RecordedWorkflow,
  ApplicationSurface,
} from '../../domain/entities/application-knowledge';

/** Schema version — bump when the fragment structure changes. */
export const FRAGMENT_SCHEMA_VERSION = 1;

/**
 * Input for fragment assembly — all foundations and derived views.
 */
export interface AssemblyInput {
  readonly sessionId: string;
  readonly elements: UiElement[];
  readonly transitions: ObservedTransition[];
  readonly components: ComponentGrouping[];
  readonly interactionContracts: InteractionContract[];
  readonly behavioralContracts: BehavioralContract[];
  readonly logicalActions: LogicalAction[];
  readonly recordedWorkflow: RecordedWorkflow;
  readonly applicationSurfaces: ApplicationSurface[];
}

/**
 * Assemble an ApplicationKnowledgeFragment from foundations and derived views.
 *
 * Converts foundational entities to compact summaries and packages everything
 * into the final fragment.
 *
 * @param input All pre-computed foundations and views.
 * @returns Complete ApplicationKnowledgeFragment.
 */
export function assembleFragment(input: AssemblyInput): ApplicationKnowledgeFragment {
  return {
    sessionId: input.sessionId,
    generatedAt: new Date().toISOString(),
    schemaVersion: FRAGMENT_SCHEMA_VERSION,

    elements: input.elements.map(toElementSummary),
    transitions: input.transitions.map(toTransitionSummary),
    components: input.components.map(toComponentSummary),

    interactionContracts: input.interactionContracts,
    behavioralContracts: input.behavioralContracts,
    logicalActions: input.logicalActions,
    recordedWorkflow: input.recordedWorkflow,
    applicationSurfaces: input.applicationSurfaces,
  };
}

// ── Summary converters ───────────────────────────────────

function toElementSummary(el: UiElement): UiElementSummary {
  return {
    elementId: el.elementId,
    tag: el.identity?.tag ?? 'unknown',
    role: el.identity?.ariaRole ?? null,
    accessibleName: el.identity?.accessibleName ?? '',
    capabilities: [...el.intrinsicCapabilities],
    componentId: el.componentId,
    componentRole: el.componentRole,
    sourceUrl: el.sourceUrl,
  };
}

function toTransitionSummary(t: ObservedTransition): TransitionSummary {
  return {
    transitionId: t.transitionId,
    elementId: t.elementId,
    componentId: t.componentId,
    operation: t.operation,
    timestamp: t.timestamp,
    relevance: t.relevance,
  };
}

function toComponentSummary(c: ComponentGrouping): ComponentSummary {
  return {
    groupingId: c.groupingId,
    patternType: c.patternType,
    rootElementId: c.rootElementId,
    constituentCount: c.constituents.length,
    businessField: c.businessField,
    lifecycleState: c.lifecycleState,
    optionCount: c.optionSet?.length ?? null,
  };
}
