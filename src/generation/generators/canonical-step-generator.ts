/**
 * Canonical Step Generator — transforms the Interaction Timeline
 * into Canonical Test Steps.
 *
 * Milestone B3 (v4.1.0) — Foundation
 *
 * B2 §3.2 Responsibilities:
 *   - Transform Interaction Timeline into Canonical Test Steps
 *   - One step per interaction
 *   - Project element identity and AI enrichment from interaction events
 *
 * B2 AP1: Single responsibility — this generator owns only step generation.
 * B2 AP3: Pure function — no side effects, no storage writes, no AI calls.
 * B2 AP5: Timeline is read-only input.
 *
 * Phase 3 Integration Step 3: Plain English is generated from the frozen
 * Semantic Interaction Language templates (semantic-templates.ts), the
 * single source of truth for the production generation pipeline. This
 * generator no longer depends on the legacy interaction-type registry for
 * semantic interpretation or plain-English generation.
 */

import type {
  SessionEvent,
  NavigationEvent,
} from '../../shared/types';
import type { CanonicalStep, GeneratorResult } from '../types';
import type {
  GeneratorContract,
  CanonicalStepGeneratorInput,
  CanonicalStepGeneratorOutput,
} from '../contracts/generator-contract';
import type { ClassifiedInteraction, CanonicalType } from '../../shared/architecture-types';
import { renderSemanticPlainEnglish } from '../engine/semantic-templates';
import { normalizeToCanonical } from '../engine/step-to-semantic';
import { StepIdGenerator } from '../../recorder/step-id-generator';
import { applyReadabilityRules } from '../engine/readability-optimizer';

/**
 * Generate Canonical Test Steps from the Interaction Timeline.
 *
 * This is a PURE FUNCTION:
 *   - Same timeline → same steps (modulo timestamp)
 *   - No side effects
 *   - No storage writes
 *   - No AI calls
 *
 * Phase 3 Integration Step 3: Plain English is generated from the frozen
 * Semantic Interaction Language templates (§8.2). The canonical type is
 * resolved from the Stage 3a classifier output when available, or by
 * normalizing the raw event.type via normalizeToCanonical() for backward
 * compatibility. The classified array must be positionally aligned with
 * the timeline array (one entry per event, in order).
 *
 * @param input  The frozen timeline, recording context, and optional
 *               Stage 3a classified interactions.
 * @returns      GeneratorResult containing the canonical steps.
 */
function generate(
  input: CanonicalStepGeneratorInput,
): GeneratorResult<CanonicalStepGeneratorOutput> {
  const { timeline, classified } = input;
  const errors: GeneratorResult<unknown>['errors'] = [];

  // Handle empty timeline
  if (timeline.length === 0) {
    return {
      status: 'success',
      output: [],
      errors: [],
    };
  }

  const stepIdGenerator = new StepIdGenerator('step');
  const steps: CanonicalStep[] = [];

  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i];

    try {
      // Phase 3 Integration Step 1: use canonicalType when available
      const ci: ClassifiedInteraction | undefined = classified?.[i];
      const canonicalType: string | undefined = ci?.canonicalType;
      const step = transformEventToStep(event, i + 1, stepIdGenerator, canonicalType);
      steps.push(step);
    } catch (err) {
      errors.push({
        stepIndex: i,
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    }
  }

  if (errors.length > 0 && steps.length === 0) {
    return {
      status: 'failure',
      output: null,
      errors,
    };
  }

  // B7.2: Apply readability optimization (internal post-processing pass).
  // B7.1 §2.1: The optimizer is an internal refinement of this generator.
  // It modifies only plainEnglish and stepNumber (display presentation).
  // All execution fields (actionType, elementIdentity, value, executionJson)
  // are immutable by the optimizer. The optimizer is deterministic.
  const optimized = applyReadabilityRules(steps);

  return {
    status: errors.length > 0 ? 'partial' : 'success',
    output: optimized,
    errors,
  };
}

/**
 * Transform a single interaction event into a Canonical Test Step.
 *
 * This function handles all event types:
 *   - Navigation events: delegates to transformNavigationEvent
 *   - Action events: delegates to transformActionEvent
 *
 * Phase 3 Integration Step 3: canonicalType is resolved from Stage 3a
 * classifier output when available, or via normalizeToCanonical() for
 * backward compatibility. Plain English is rendered by the frozen
 * Semantic Interaction Language templates.
 */
function transformEventToStep(
  event: SessionEvent,
  stepNumber: number,
  stepIdGenerator: StepIdGenerator,
  canonicalType?: string,
): CanonicalStep {
  if (event.type === 'navigation') {
    return transformNavigationEvent(event, stepNumber, stepIdGenerator, canonicalType);
  }

  return transformActionEvent(event, stepNumber, stepIdGenerator, canonicalType);
}

/**
 * Transform a navigation event into a canonical step.
 *
 * Navigation events have no element identity in the traditional sense.
 * The step's element identity is synthetic (tag: NAVIGATION, accessibleName: URL).
 *
 * Phase 3 Integration Step 3: Uses the frozen navigate template
 * (§8.2: "Navigate to {url}" — no quotes around URL).
 */
function transformNavigationEvent(
  event: NavigationEvent,
  stepNumber: number,
  stepIdGenerator: StepIdGenerator,
  canonicalType?: string,
): CanonicalStep {
  const resolvedType = canonicalType ?? normalizeToCanonical(event.type);
  const plainEnglish = renderSemanticPlainEnglish({
    canonicalType: resolvedType as CanonicalType,
    identity: {
      accessibleName: event.url,
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'NAVIGATION',
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      className: null,
      cssSelector: 'body',
      xPath: '//body',
      inIframe: false,
      shadowDom: false,
      elementId: 'nav',
    },
    understanding: null,
    value: null,
    checked: null,
    url: event.url,
  });

  return {
    stepId: stepIdGenerator.next(),
    stepNumber,
    actionType: resolvedType,
    plainEnglish,
    elementIdentity: {
      accessibleName: event.url,
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'NAVIGATION',
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      className: null,
      cssSelector: 'body',
      xPath: '//body',
      inIframe: false,
      shadowDom: false,
      elementId: 'nav',
    },
    aiEnrichment: null,
    aiConfidence: 1.0, // Navigation is deterministic — URL is known with full confidence
    linkedInteractionId: event.actionId,
    value: null,
    checked: null,
    executionJson: null, // Populated by Execution JSON Generator (B5.3)
    timestamp: new Date().toISOString(),
  };
}

/**
 * Transform an action event into a canonical step.
 *
 * Reads the element identity and AI enrichment from the event.
 *
 * Phase 3 Integration Step 3: Plain English is rendered by the frozen
 * Semantic Interaction Language templates (§8.2). The canonical type is
 * resolved from Stage 3a classifier output when available, or via
 * normalizeToCanonical() for backward compatibility.
 */
function transformActionEvent(
  event: SessionEvent,
  stepNumber: number,
  stepIdGenerator: StepIdGenerator,
  canonicalType?: string,
): CanonicalStep {
  // NavigationEvent has no elementIdentity — this function is only called
  // for action events. Use 'elementIdentity' as the discriminant.
  if (!('elementIdentity' in event)) {
    throw new Error(`Event ${event.actionId} has no element identity`);
  }

  const identity = event.elementIdentity;
  const understanding = event.aiUnderstanding ?? null;
  const aiConfidence = understanding?.confidenceScore ?? 0;

  // Resolve the canonical type: prefer Stage 3a classifier output,
  // fall back to normalizing the raw event.type for backward compat.
  const resolvedType: CanonicalType = canonicalType
    ? normalizeToCanonical(canonicalType)
    : normalizeToCanonical(event.type);

  // Extract type-specific values from the event for template rendering.
  const value = 'value' in event ? event.value : null;
  const checked = 'checked' in event ? event.checked : null;

  // Date display value for selectDate template rendering.
  let dateDisplayValue: string | null = null;
  if ('dateType' in event) {
    if (event.dateType === 'dateRange'
        && event.startDisplayValue
        && event.endDisplayValue) {
      dateDisplayValue = `${event.startDisplayValue} to ${event.endDisplayValue}`;
    } else if (event.displayValue) {
      dateDisplayValue = event.displayValue;
    }
  }

  // Generate plain English using the frozen Semantic Interaction Language templates.
  const plainEnglish = renderSemanticPlainEnglish({
    canonicalType: resolvedType,
    identity,
    understanding,
    value,
    checked,
    dateDisplayValue,
  });

  return {
    stepId: stepIdGenerator.next(),
    stepNumber,
    actionType: resolvedType,
    plainEnglish,
    elementIdentity: { ...identity }, // Copy — never modify the original
    aiEnrichment: understanding,
    aiConfidence,
    linkedInteractionId: event.actionId,
    value: 'value' in event ? event.value : null,
    checked: 'checked' in event ? event.checked : null,
    executionJson: null, // Populated by Execution JSON Generator (B5.3)
    timestamp: new Date().toISOString(),
  };
}

/**
 * The Canonical Step Generator contract.
 *
 * B2 AP11: This contract is the generator's published interface.
 * The Generation Engine invokes generate() and reads the result.
 * No engine code imports the generator's internal functions.
 */
export const canonicalStepGenerator: GeneratorContract<
  CanonicalStepGeneratorInput,
  CanonicalStepGeneratorOutput
> = {
  name: 'canonical-step-generator',
  dependencies: [],
  generate,
};
