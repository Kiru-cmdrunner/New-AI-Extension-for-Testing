/**
 * ObservedTransition Entity — the behavioral raw data of the UI Knowledge Model.
 *
 * Each recorded interaction that passed the relevance filter produces one of these.
 * This is the empirical foundation — what actually happened during recording.
 * BehavioralContract is derived from these by the enrichment pass.
 *
 * Design principle: application-centric. This models what happened in the application,
 * not how AI interprets it.
 *
 * Reference: .drytis/specs/ui-knowledge-model-foundation.md (Phase 1)
 */

import {
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
  CascadeEffectType,
} from '../enums';
import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';

// ── Value objects ────────────────────────────────────────

/** Observable state of an element at a point in time. */
export interface ElementState {
  /** Current value of the element (text value, selected value, etc.). */
  readonly value: string | null;
  /** Checked state for checkboxes/radios. */
  readonly checked: boolean | null;
  /** Expanded state for collapsibles (aria-expanded). */
  readonly expanded: boolean | null;
  /** Selected state for options (aria-selected). */
  readonly selected: boolean | null;
}

/** A single evidence signal confirming a state transition. */
export interface TransitionEvidence {
  readonly type: TransitionEvidenceType;
  /** Human-readable description of what was observed. */
  readonly description: string;
  /** Value before the transition (if applicable). */
  readonly before: string | null;
  /** Value after the transition (if applicable). */
  readonly after: string | null;
}

/** A side effect observed on another element as a result of this transition. */
export interface CascadeEffect {
  /** The element affected by the cascade. */
  readonly elementId: string;
  /** How the affected element changed. */
  readonly effect: CascadeEffectType;
  /** Human-readable detail of the cascade effect. */
  readonly detail: string;
}

/** Validation behavior observed during this transition (if any). */
export interface ValidationResult {
  /** Whether validation was triggered. */
  readonly triggered: boolean;
  /** How the validation response was displayed (inline, toast, modal, etc.). */
  readonly responseType: string | null;
  /** The error message text shown to the user, if any. */
  readonly message: string | null;
  /** What action clears the validation error (correction, resubmit, etc.). */
  readonly clearedOn: string | null;
}

/** Input for creating a TransitionEvidence. */
export interface CreateTransitionEvidenceInput {
  type: TransitionEvidenceType;
  description: string;
  before?: string | null;
  after?: string | null;
}

/** Input for creating a CascadeEffect. */
export interface CreateCascadeEffectInput {
  elementId: string;
  effect: CascadeEffectType;
  detail: string;
}

// ── Factory helpers for value objects ────────────────────

export function createTransitionEvidence(input: CreateTransitionEvidenceInput): TransitionEvidence {
  if (!input.type) {
    throw new ValueObjectError('TransitionEvidence', 'type is required');
  }
  if (!input.description?.trim()) {
    throw new ValueObjectError('TransitionEvidence', 'description is required');
  }
  return {
    type: input.type,
    description: input.description.trim(),
    before: input.before ?? null,
    after: input.after ?? null,
  };
}

export function createCascadeEffect(input: CreateCascadeEffectInput): CascadeEffect {
  if (!input.elementId?.trim()) {
    throw new ValueObjectError('CascadeEffect', 'elementId is required');
  }
  if (!input.effect) {
    throw new ValueObjectError('CascadeEffect', 'effect is required');
  }
  return {
    elementId: input.elementId.trim(),
    effect: input.effect,
    detail: input.detail?.trim() ?? '',
  };
}

// ── ObservedTransition (entity) ──────────────────────────

/**
 * A single observed state transition caused by a user interaction.
 *
 * This is the empirical record — what the user did, what changed, and what
 * evidence confirms the change. The enrichment pass synthesizes these into
 * BehavioralContracts.
 */
export interface ObservedTransition {
  /** Stable transition ID. */
  readonly transitionId: string;
  /** Which element was interacted with. */
  readonly elementId: string;
  /** Which component this transition belongs to, if any. */
  readonly componentId: string | null;
  /** What the user did. */
  readonly operation: TransitionOperation;
  /** When the transition occurred (epoch ms). */
  readonly timestamp: number;
  /** Whether this interaction is meaningful for the workflow. */
  readonly relevance: RelevanceLevel;
  /** Element state before the transition. */
  readonly stateBefore: ElementState;
  /** Element state after the transition. */
  readonly stateAfter: ElementState;
  /** Evidence signals confirming the transition. */
  readonly evidence: TransitionEvidence[];
  /** Side effects on other elements observed as a result of this transition. */
  readonly cascadeEffects: CascadeEffect[];
  /** Validation behavior observed during this transition, if any. */
  readonly validationResult: ValidationResult | null;
}

/** Input for creating an ObservedTransition. */
export interface CreateObservedTransitionInput {
  transitionId: string;
  elementId: string;
  componentId?: string | null;
  operation: TransitionOperation;
  timestamp: number;
  relevance: RelevanceLevel;
  stateBefore: ElementState;
  stateAfter: ElementState;
  evidence?: CreateTransitionEvidenceInput[];
  cascadeEffects?: CreateCascadeEffectInput[];
  validationResult?: ValidationResult | null;
}

/**
 * Create an ObservedTransition entity with invariant validation.
 *
 * Invariants:
 *   - transitionId and elementId are required and non-empty
 *   - operation is required
 *   - timestamp must be a positive number (epoch ms)
 *   - relevance is required
 *   - stateBefore and stateAfter are required
 *
 * @throws MissingFieldError if required fields are empty
 * @throws ValueObjectError if operation or relevance are invalid
 */
export function createObservedTransition(input: CreateObservedTransitionInput): ObservedTransition {
  if (!input.transitionId?.trim()) {
    throw new MissingFieldError('ObservedTransition', 'transitionId');
  }
  if (!input.elementId?.trim()) {
    throw new MissingFieldError('ObservedTransition', 'elementId');
  }
  if (!input.operation) {
    throw new ValueObjectError('ObservedTransition', 'operation is required');
  }
  if (!input.relevance) {
    throw new ValueObjectError('ObservedTransition', 'relevance is required');
  }
  if (typeof input.timestamp !== 'number' || input.timestamp <= 0) {
    throw new ValueObjectError(
      'ObservedTransition',
      `timestamp must be a positive epoch ms value (got ${input.timestamp})`,
    );
  }
  if (!input.stateBefore) {
    throw new MissingFieldError('ObservedTransition', 'stateBefore');
  }
  if (!input.stateAfter) {
    throw new MissingFieldError('ObservedTransition', 'stateAfter');
  }

  return {
    transitionId: input.transitionId.trim(),
    elementId: input.elementId.trim(),
    componentId: input.componentId?.trim() || null,
    operation: input.operation,
    timestamp: input.timestamp,
    relevance: input.relevance,
    stateBefore: input.stateBefore,
    stateAfter: input.stateAfter,
    evidence: (input.evidence ?? []).map(createTransitionEvidence),
    cascadeEffects: (input.cascadeEffects ?? []).map(createCascadeEffect),
    validationResult: input.validationResult ?? null,
  };
}

/**
 * Create an updated ObservedTransition with component assignment.
 *
 * Used when the recognizer associates a transition with a component after creation.
 */
export function assignTransitionToComponent(
  transition: ObservedTransition,
  componentId: string,
): ObservedTransition {
  if (!componentId?.trim()) {
    throw new ValueObjectError('ObservedTransition', 'componentId is required');
  }
  return { ...transition, componentId: componentId.trim() };
}

/**
 * Check whether a transition produced any observable evidence of change.
 *
 * Used by the relevance filter — an interaction with zero observable outcome
 * is classified as noise.
 */
export function hasObservableOutcome(transition: ObservedTransition): boolean {
  if (transition.evidence.length > 0) return true;
  if (transition.cascadeEffects.length > 0) return true;
  if (transition.operation === TransitionOperation.NAVIGATE) return true;
  return false;
}

/** Helper: create an empty element state (for elements with no prior state). */
export function emptyElementState(): ElementState {
  return { value: null, checked: null, expanded: null, selected: null };
}
