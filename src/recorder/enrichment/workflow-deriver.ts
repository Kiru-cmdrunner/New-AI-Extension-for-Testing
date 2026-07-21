/**
 * Workflow Deriver — derives the RecordedWorkflow from ordered logical actions
 * and transitions.
 *
 * Derives:
 *   - surfaceTransitions: navigation boundaries (workflow phases)
 *   - branchPoints: choice points from components with option sets
 *   - optionalSteps: actions from supporting transitions
 *
 * Pure function: reads LogicalActions + ObservedTransitions, produces a
 * RecordedWorkflow. No mutations to foundational entities.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §5
 */

import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import type { ObservedTransition } from '../../domain/entities/observed-transition';
import type {
  LogicalAction,
  RecordedWorkflow,
  SurfaceTransition,
  BranchPoint,
} from '../../domain/entities/application-knowledge';
import type { UiElement } from '../../domain/entities/ui-element';
import { isNavigationTransition, isSupportingTransition } from './semantic-aggregator';

/**
 * Derive the RecordedWorkflow from ordered actions and transitions.
 *
 * @param actions      Logical actions from Semantic Aggregation.
 * @param transitions  All observed transitions.
 * @param components   All confirmed components (for branch point detection).
 * @param elements     All elements (for URL derivation in surface transitions).
 * @returns RecordedWorkflow with boundaries, branch points, and optional steps.
 */
export function deriveWorkflow(
  actions: LogicalAction[],
  transitions: ObservedTransition[],
  components: ComponentGrouping[],
  elements: ReadonlyMap<string, UiElement>,
): RecordedWorkflow {
  return {
    surfaceTransitions: deriveSurfaceTransitions(transitions, elements),
    logicalActions: actions,
    branchPoints: deriveBranchPoints(components),
    optionalSteps: deriveOptionalSteps(actions, transitions),
  };
}

// ── Surface Transitions (workflow boundaries) ────────────

/**
 * Detect navigation boundaries from NAVIGATE transitions.
 *
 * Each navigation creates a SurfaceTransition with fromUrl/toUrl.
 * URL derivation: fromUrl from the navigate transition's element sourceUrl,
 * toUrl from navigation evidence (or next transition's element sourceUrl).
 */
function deriveSurfaceTransitions(
  transitions: ObservedTransition[],
  elements: ReadonlyMap<string, UiElement>,
): SurfaceTransition[] {
  const boundaries: SurfaceTransition[] = [];

  const navTransitions = transitions.filter(isNavigationTransition);

  for (const nav of navTransitions) {
    const fromUrl = getElementUrl(nav.elementId, elements);
    const toUrl = deriveToUrl(nav, transitions, elements);

    boundaries.push({
      fromUrl,
      toUrl,
      triggeredByTransitionId: nav.transitionId,
    });
  }

  return boundaries;
}

function getElementUrl(
  elementId: string,
  elements: ReadonlyMap<string, UiElement>,
): string {
  return elements.get(elementId)?.sourceUrl ?? 'unknown';
}

/**
 * Derive the destination URL from navigation evidence or the next
 * transition's element sourceUrl.
 */
function deriveToUrl(
  navTransition: ObservedTransition,
  allTransitions: ObservedTransition[],
  elements: ReadonlyMap<string, UiElement>,
): string {
  // Check navigation evidence for URL
  for (const e of navTransition.evidence) {
    if (e.after && e.after.startsWith('http')) {
      return e.after;
    }
  }

  // Fall back to the next transition's element URL
  const navIdx = allTransitions.findIndex((t) => t.transitionId === navTransition.transitionId);
  if (navIdx >= 0 && navIdx + 1 < allTransitions.length) {
    const nextTransition = allTransitions[navIdx + 1];
    return getElementUrl(nextTransition.elementId, elements);
  }

  return 'unknown';
}

// ── Branch Points ────────────────────────────────────────

/**
 * Detect branch points from components with option sets.
 *
 * For each confirmed component with an optionSet where the user selected one
 * option, the unchosen options form a branch point. This reveals alternate
 * flows the user didn't take.
 */
function deriveBranchPoints(components: ComponentGrouping[]): BranchPoint[] {
  const branchPoints: BranchPoint[] = [];

  for (const component of components) {
    if (!component.optionSet || component.optionSet.length <= 1) continue;

    const chosen = component.optionSet.find((o) => o.selected);
    if (!chosen) continue;

    branchPoints.push({
      componentId: component.groupingId,
      availableOptions: component.optionSet.map((o) => o.label),
      chosenOption: chosen.label,
    });
  }

  return branchPoints;
}

// ── Optional Steps ───────────────────────────────────────

/**
 * Identify actions derived from supporting (non-primary) transitions.
 *
 * These are optional steps — interactions that aren't the primary workflow
 * but provide context (e.g., dismissing a tooltip, hover state).
 */
function deriveOptionalSteps(
  actions: LogicalAction[],
  transitions: ObservedTransition[],
): LogicalAction[] {
  // Find supporting transition IDs
  const supportingTransitionIds = new Set(
    transitions.filter(isSupportingTransition).map((t) => t.transitionId),
  );

  // An action is "optional" if ALL its transitions are supporting
  return actions.filter((action) =>
    action.transitionIds.every((id) => supportingTransitionIds.has(id)),
  );
}
