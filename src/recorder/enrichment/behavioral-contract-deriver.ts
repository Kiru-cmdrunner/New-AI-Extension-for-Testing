/**
 * BehavioralContract Deriver — synthesizes state machines, validation behavior,
 * cascade effects, and success indicators from observed transitions.
 *
 * Pure function: takes a ComponentGrouping + its transitions + the pattern
 * definition, and produces a BehavioralContract describing how the component
 * behaves when interacted with.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §2
 */

import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import type { ObservedTransition, ElementState } from '../../domain/entities/observed-transition';
import type {
  BehavioralContract,
  StateMachine,
  StateTransitionDef,
  ValidationBehavior,
  CascadeEffectSummary,
  SuccessIndicator,
} from '../../domain/entities/application-knowledge';
import type { PatternDefinition } from '../recognition/pattern-catalogue';

/**
 * Derive a BehavioralContract from a component's observed transitions.
 *
 * @param component    The confirmed component.
 * @param transitions  All transitions belonging to this component (chronological).
 * @param pattern      The pattern definition (for affordance context).
 * @returns BehavioralContract with synthesized state machine, validation, cascades.
 */
export function deriveBehavioralContract(
  component: ComponentGrouping,
  transitions: ObservedTransition[],
  _pattern?: PatternDefinition,
): BehavioralContract {
  return {
    appliesTo: { type: 'component', id: component.groupingId },
    stateMachine: deriveStateMachine(transitions),
    validationBehavior: deriveValidationBehavior(transitions),
    cascadeEffects: deriveCascadeEffects(transitions),
    successIndicators: deriveSuccessIndicators(transitions),
  };
}

// ── State Machine Synthesis ──────────────────────────────

/**
 * Infer states and transitions from observed before/after states.
 *
 * Each transition creates states from its stateBefore and stateAfter.
 * States are named by their observable field values.
 */
function deriveStateMachine(transitions: ObservedTransition[]): StateMachine {
  const stateNames = new Map<string, { name: string; description: string }>();
  const transitionDefs: StateTransitionDef[] = [];

  for (const t of transitions) {
    const beforeName = stateKey(t.stateBefore);
    const afterName = stateKey(t.stateAfter);

    if (!stateNames.has(beforeName)) {
      stateNames.set(beforeName, stateDescriptor(beforeName, t.stateBefore));
    }
    if (!stateNames.has(afterName)) {
      stateNames.set(afterName, stateDescriptor(afterName, t.stateAfter));
    }

    transitionDefs.push({
      from: beforeName,
      to: afterName,
      operation: t.operation,
      observed: true,
      evidence: t.evidence.map((e) => e.description),
    });
  }

  // Terminal state = last transition's stateAfter
  const terminalStates: string[] = [];
  if (transitions.length > 0) {
    const lastState = stateKey(transitions[transitions.length - 1].stateAfter);
    terminalStates.push(lastState);
  }

  return {
    states: Array.from(stateNames.values()),
    transitions: transitionDefs,
    terminalStates,
  };
}

/**
 * Create a stable string key from an ElementState.
 */
function stateKey(state: ElementState): string {
  const parts: string[] = [];
  if (state.value !== null) parts.push(`v:${state.value}`);
  if (state.checked !== null) parts.push(`c:${state.checked}`);
  if (state.expanded !== null) parts.push(`e:${state.expanded}`);
  if (state.selected !== null) parts.push(`s:${state.selected}`);
  return parts.length > 0 ? parts.join('|') : 'initial';
}

/**
 * Create a human-readable state descriptor from a state key + ElementState.
 */
function stateDescriptor(key: string, state: ElementState): { name: string; description: string } {
  if (key === 'initial') {
    return { name: 'initial', description: 'No observable state' };
  }

  const bits: string[] = [];
  if (state.value !== null) bits.push(`value="${state.value}"`);
  if (state.checked !== null) bits.push(`checked=${state.checked}`);
  if (state.expanded !== null) bits.push(`expanded=${state.expanded}`);
  if (state.selected !== null) bits.push(`selected=${state.selected}`);

  return {
    name: key,
    description: bits.join(', ') || 'initial state',
  };
}

// ── Validation Behavior ──────────────────────────────────

function deriveValidationBehavior(transitions: ObservedTransition[]): ValidationBehavior | null {
  const validated = transitions.filter((t) => t.validationResult?.triggered);

  if (validated.length === 0) {
    return null;
  }

  // Derive trigger timing from the first validated transition's evidence
  const first = validated[0];
  const triggerTiming = inferTriggerTiming(first);

  // Derive response type from validation results
  const responseTypes = validated
    .map((t) => t.validationResult?.responseType)
    .filter((rt): rt is string => rt !== null && rt !== undefined);

  const responseType = (responseTypes[0] as ValidationBehavior['responseType']) ?? 'inline';

  // Collect error messages
  const errorMessages = validated
    .filter((t) => t.validationResult?.message)
    .map((t) => ({
      condition: `after ${t.operation}`,
      messageText: t.validationResult!.message!,
    }));

  return {
    triggerTiming,
    responseType,
    errorMessages,
    observed: true,
  };
}

function inferTriggerTiming(
  transition: ObservedTransition,
): ValidationBehavior['triggerTiming'] {
  // Heuristic: if the evidence mentions 'blur' or 'focus', it's onBlur
  // If it mentions 'change' or 'input', it's onChange
  // Default: onSubmit
  const evidenceText = transition.evidence.map((e) => e.description).join(' ').toLowerCase();

  if (evidenceText.includes('blur') || evidenceText.includes('focus')) {
    return 'onBlur';
  }
  if (evidenceText.includes('change') || evidenceText.includes('input')) {
    return 'onChange';
  }
  return 'onSubmit';
}

// ── Cascade Effects ──────────────────────────────────────

function deriveCascadeEffects(transitions: ObservedTransition[]): CascadeEffectSummary[] {
  const summaries: CascadeEffectSummary[] = [];

  for (const t of transitions) {
    for (const cascade of t.cascadeEffects) {
      summaries.push({
        trigger: `${t.operation} on ${t.elementId}`,
        affectsEntityId: cascade.elementId,
        effect: cascade.effect,
        detail: cascade.detail,
      });
    }
  }

  return summaries;
}

// ── Success Indicators ───────────────────────────────────

function deriveSuccessIndicators(transitions: ObservedTransition[]): SuccessIndicator[] {
  const indicators: SuccessIndicator[] = [];

  for (const t of transitions) {
    // Value change is a success indicator (state change)
    if (t.stateBefore.value !== t.stateAfter.value && t.stateAfter.value !== null) {
      indicators.push({
        signal: `value changed to "${t.stateAfter.value}"`,
        type: 'valueDisplay',
        description: `Element ${t.elementId} displayed value "${t.stateAfter.value}" after ${t.operation}`,
      });
    }

    // Navigation is a success indicator
    if (t.evidence.some((e) => e.type === 'navigation' as any)) {
      indicators.push({
        signal: 'navigation occurred',
        type: 'navigation',
        description: `${t.operation} triggered navigation`,
      });
    }

    // Visibility change via cascade
    const visibilityCascade = t.cascadeEffects.find(
      (c) => c.effect === ('visibility' as any),
    );
    if (visibilityCascade) {
      indicators.push({
        signal: `${visibilityCascade.elementId} visibility changed`,
        type: 'visibility',
        description: visibilityCascade.detail,
      });
    }
  }

  return indicators;
}
