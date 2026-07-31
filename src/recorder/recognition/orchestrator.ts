/**
 * Recognition Orchestrator — per-interaction component recognition flow.
 *
 * Runs both structural and behavioral recognizers for each classified interaction,
 * resolves identity, merges results (structural classification authority,
 * behavioral enrichment), and manages lifecycle progression and rejection.
 *
 * Design principle: the orchestrator is GENERIC. It contains zero pattern-specific
 * logic. Pattern knowledge comes from the PatternDefinition via the catalogue.
 *
 * Key separation: recognition (establishing identity) vs. enrichment (accumulating
 * behavioral knowledge). Both run for every interaction, but structural recognition
 * is authoritative for classification while behavioral processing enriches.
 *
 * Architecture: .drytis/ui-knowledge-model.md §4 (Progressive Recognition)
 * Reference:    .drytis/specs/ui-knowledge-model-phase4.md
 */

import {
  RecognitionSource,
  ComponentLifecycleState,
  ComponentRole,
  type RelevanceLevel,
} from '../../domain/enums';
import type { ObservedTransition } from '../../domain/entities/observed-transition';
import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import {
  recognize,
  type RecognitionInput,
  type RecognitionResult,
  type ElementRoleInfo,
} from './structural-recognizer';
import { recognizeBehaviorally } from './behavioral-recognizer';
import {
  ComponentRegistry,
  createEvidence,
  resolveIdentity,
  type EvidenceEntry,
} from './component-registry';
import { getPattern } from './pattern-catalogue';

// ── Orchestrator Types ───────────────────────────────────

/**
 * Input to the orchestrator for processing a single interaction.
 *
 * Contains the element information for structural recognition, the accumulated
 * transitions for behavioral recognition, and the current interaction's transition.
 */
export interface OrchestratorInput {
  /** Element info for structural recognition (the interacted element + ancestor chain). */
  readonly element: ElementRoleInfo;
  /**
   * Ancestor chain from root to target (each entry is { elementId, ariaRole, tag }).
   * Ordered outermost → innermost (target). The target element itself is included
   * as the last entry by convention.
   */
  readonly ancestorRoles: readonly ElementRoleInfo[];
  /** ARIA roles of sibling elements (optional, for group patterns like radio groups). */
  readonly siblingElementRoles?: readonly ElementRoleInfo[];
  /** Element IDs related to this element (DOM descendants + ancestors). */
  readonly relatedElementIds: readonly string[];
  /** All accumulated transitions on related elements (for behavioral recognition). */
  readonly transitions: readonly ObservedTransition[];
  /** The current interaction's transition (will be added to the component). */
  readonly currentTransition: ObservedTransition;
}

/**
 * Result of processing a single interaction through the orchestrator.
 */
export interface OrchestratorResult {
  /** The component affected by this interaction, or null if standalone. */
  readonly component: ComponentGrouping | null;
  /** Whether a new component was created by this interaction. */
  readonly created: boolean;
  /** Whether an existing component was updated. */
  readonly updated: boolean;
  /** Whether the component was promoted (developing/confirmed). */
  readonly promoted: boolean;
  /** Whether the component was rejected. */
  readonly rejected: boolean;
  /** The structural recognition result (or null). */
  readonly structuralResult: RecognitionResult;
  /** The behavioral recognition result (or null). */
  readonly behavioralResult: RecognitionResult;
  /** Evidence entries generated during this processing. */
  readonly evidence: readonly EvidenceEntry[];
}

// ── Null Result ──────────────────────────────────────────

const NULL_RESULT: RecognitionResult = {
  patternType: null,
  rootElementId: null,
  constituents: [],
  confidence: 0,
  recognitionSource: RecognitionSource.STRUCTURAL,
  matchedRole: null,
  reason: null,
};

// ── Lifecycle Checking ───────────────────────────────────

/**
 * Check whether a component's observed operations cover its pattern's expected lifecycle.
 *
 * Generic: reads expectedLifecycle from the pattern definition. Never hardcodes
 * which operations mean "complete" for any specific pattern.
 */
function isLifecycleComplete(
  component: ComponentGrouping,
  observedOperations: Set<string>,
): boolean {
  const pattern = getPattern(component.patternType);

  // If pattern not found or no expected lifecycle, confirm on first transition
  if (!pattern || !pattern.expectedLifecycle || pattern.expectedLifecycle.length === 0) {
    return component.observedTransitionIds.length > 0;
  }

  // Check set-containment: all expected operations must be observed
  for (const op of pattern.expectedLifecycle) {
    if (!observedOperations.has(op)) {
      return false;
    }
  }

  return true;
}

// ── Constituent Enrichment ───────────────────────────────

/**
 * Find an existing component that owns the interacted element or any of its
 * related elements (DOM descendants/ancestors/siblings).
 *
 * Used when neither structural nor behavioral recognition fires: the interaction
 * may still belong to an existing component if the element is in that component's
 * neighborhood. This implements the "behavioral enrichment runs for structurally-
 * recognized components" principle — enrichment isn't skipped just because the
 * interacted element wasn't part of the original structural root match.
 *
 * @param elementId - The interacted element.
 * @param relatedElementIds - Elements DOM-related to the interacted element.
 * @param activeComponents - Currently active (non-rejected) components.
 * @returns The owning component, or null if none found.
 */
function findOwningComponent(
  elementId: string,
  relatedElementIds: readonly string[],
  activeComponents: readonly ComponentGrouping[],
): ComponentGrouping | null {
  const candidateIds = new Set<string>([elementId, ...relatedElementIds]);

  for (const component of activeComponents) {
    // Check if any candidate element is the root or a constituent of this component
    if (candidateIds.has(component.rootElementId)) {
      return component;
    }
    for (const constituent of component.constituents) {
      if (candidateIds.has(constituent.elementId)) {
        return component;
      }
    }
  }

  return null;
}

// ── Orchestrator ─────────────────────────────────────────

/**
 * Process a single interaction through the recognition pipeline.
 *
 * This is the main entry point for component recognition. The recorder calls this
 * for each classified interaction.
 *
 * Flow:
 *   1. Structural recognition (ARIA-based, deterministic)
 *   2. Behavioral recognition (evidence-based, from accumulated transitions)
 *   3. Identity resolution + merge (or create new)
 *   4. Enrichment (add transition, update lifecycle)
 *   5. Rejection check
 *
 * @param input - The interaction data and accumulated context.
 * @param registry - The session-scoped component registry.
 * @returns The result of processing this interaction.
 */
export function processInteraction(
  input: OrchestratorInput,
  registry: ComponentRegistry,
): OrchestratorResult {
  const evidence: EvidenceEntry[] = [];
  let created = false;
  let updated = false;
  let promoted = false;
  let rejected = false;

  // ── Step 1: Structural Recognition ───────────────────

  const structuralInput: RecognitionInput = {
    element: input.element,
    ancestorRoles: [...input.ancestorRoles],
    siblingElementRoles: input.siblingElementRoles ? [...input.siblingElementRoles] : undefined,
  };

  const structuralResult = recognize(structuralInput);

  // ── Step 2: Behavioral Recognition ───────────────────

  // Behavioral runs regardless of structural result — it enriches, not just classifies.
  // But skip if there are insufficient transitions.
  let behavioralResult: RecognitionResult = NULL_RESULT;

  const nonNoiseTransitions = input.transitions.filter(
    (t) => t.relevance !== ('noise' as RelevanceLevel),
  );

  if (nonNoiseTransitions.length >= 1) {
    behavioralResult = recognizeBehaviorally({
      rootElementId: input.element.elementId,
      relatedElementIds: [...input.relatedElementIds],
      transitions: nonNoiseTransitions,
    });
  }

  // ── Step 3: Identity Resolution + Merge ──────────────

  // Prefer structural result for identity. If structural found a component,
  // use it. If not, try behavioral.
  let primaryResult: RecognitionResult = structuralResult;
  let secondaryResult: RecognitionResult = behavioralResult;

  if (primaryResult.patternType === null && secondaryResult.patternType !== null) {
    // Only behavioral matched — use it as primary
    primaryResult = behavioralResult;
    secondaryResult = NULL_RESULT;
  }

  // If neither matched, this may still be an interaction on an element that
  // is DOM-related to an existing component (e.g. a button inside a dropdown
  // that isn't itself a pattern root). Enrich that component by adding the
  // element as a constituent and recording the transition, rather than
  // discarding the interaction as standalone.
  let component: ComponentGrouping | null = null;

  if (primaryResult.patternType === null) {
    // Look for an existing component that owns the interacted element or any
    // of its related elements (DOM descendants/ancestors/siblings).
    const owningComponent = findOwningComponent(
      input.element.elementId,
      input.relatedElementIds,
      registry.getActive(),
    );

    if (owningComponent) {
      // Add the current element as a constituent if not already present
      if (
        owningComponent.rootElementId !== input.element.elementId &&
        !owningComponent.constituents.some((c) => c.elementId === input.element.elementId)
      ) {
        component = registry.addConstituent(
          owningComponent.groupingId,
          input.element.elementId,
          ComponentRole.UNKNOWN,
        );
      } else {
        component = owningComponent;
      }

      // Record the transition on the component
      component = registry.addTransition(
        component.groupingId,
        input.currentTransition.transitionId,
      );
      updated = true;

      evidence.push(
        createEvidence(
          RecognitionSource.BEHAVIORAL,
          'supporting',
          `Interaction on related element "${input.element.elementId}" enriched existing ${component.patternType}`,
        ),
      );
      // Fall through to lifecycle + rejection checks (skip registration below).
    } else {
      return {
        component: null,
        created: false,
        updated: false,
        promoted: false,
        rejected: false,
        structuralResult,
        behavioralResult,
        evidence: [],
      };
    }
  } else {
    // Try to find existing component via identity resolution
    const existing = resolveIdentity(primaryResult, registry.getActive());

    if (existing) {
      // Merge the primary result into existing component
      component = registry.register(primaryResult);
      updated = true;

      // Record evidence for the match
      evidence.push(
        createEvidence(
          primaryResult.recognitionSource,
          'supporting',
          primaryResult.reason ?? `${primaryResult.patternType} matched existing component`,
        ),
      );

      // If there's a secondary result with different elements, merge constituents
      if (secondaryResult.patternType !== null) {
        // Merge behavioral constituents into the structurally-identified component
        component = registry.register(secondaryResult);
        evidence.push(
          createEvidence(
            secondaryResult.recognitionSource,
            'supporting',
            secondaryResult.reason ??
              `Behavioral enrichment added constituents to ${component.patternType}`,
          ),
        );
      }
    } else {
      // Create new component from primary result
      component = registry.register(primaryResult);
      created = true;

      // If there's a secondary result, try to merge it (it might share elements)
      if (secondaryResult.patternType !== null) {
        // Check if the secondary result refers to the same component we just created
        const secondaryMatch = resolveIdentity(secondaryResult, [component]);
        if (secondaryMatch) {
          component = registry.register(secondaryResult);
        }
        // If they don't match, the secondary result refers to a different component.
        // We don't create a second component — the orchestrator processes one root at a time.
      }
    }

    // ── Step 4: Enrichment ──────────────────────────────
    // Add the current transition to the component (skip if already added via
    // the constituent-enrichment path above).
    if (input.currentTransition) {
      component = registry.addTransition(component.groupingId, input.currentTransition.transitionId);
      updated = true;
    }
  }

  // ── Step 5: Lifecycle Progression ───────────────────

  // Collect observed operations from all related transitions
  const observedOperations = new Set<string>();
  for (const t of input.transitions) {
    observedOperations.add(t.operation);
  }
  if (input.currentTransition) {
    observedOperations.add(input.currentTransition.operation);
  }

  // Check if lifecycle is complete
  if (
    component.lifecycleState !== ComponentLifecycleState.CONFIRMED &&
    component.lifecycleState !== ComponentLifecycleState.REJECTED &&
    isLifecycleComplete(component, observedOperations)
  ) {
    component = registry.promote(component.groupingId);
    promoted = true;

    evidence.push(
      createEvidence(
        component.recognitionSource,
        'supporting',
        `Lifecycle complete — promoted to confirmed`,
      ),
    );
  }

  // ── Step 6: Rejection Check ─────────────────────────

  // Only check rejection for tentative/developing components
  if (
    component.lifecycleState === ComponentLifecycleState.TENTATIVE ||
    component.lifecycleState === ComponentLifecycleState.DEVELOPING
  ) {
    if (registry.checkRejection(component.groupingId)) {
      rejected = true;
      component = registry.getComponent(component.groupingId)!;

      evidence.push(
        createEvidence(
          component.recognitionSource,
          'contradicting',
          `Component rejected due to accumulated contradiction`,
        ),
      );
    }
  }

  // Add all collected evidence to the ledger
  for (const e of evidence) {
    registry.addEvidence(component?.groupingId ?? '', e);
  }

  return {
    component,
    created,
    updated,
    promoted,
    rejected,
    structuralResult,
    behavioralResult,
    evidence,
  };
}
