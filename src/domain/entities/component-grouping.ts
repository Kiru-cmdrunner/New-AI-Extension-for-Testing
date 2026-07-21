/**
 * ComponentGrouping Entity — the semantic foundation of the UI Knowledge Model.
 *
 * A recognized UI pattern composed of multiple elements. This captures the
 * grouping assertion (which elements belong together) and the semantic meaning
 * (pattern type, business field, option set). It is one of three foundational
 * entities that are persisted as source of truth.
 *
 * Design principle: application-centric. This models a recognized component in
 * the application's UI, not an AI reasoning artifact.
 *
 * Reference: .drytis/specs/ui-knowledge-model-foundation.md (Phase 1)
 */

import {
  PatternType,
  RecognitionSource,
  ComponentLifecycleState,
  ComponentRole,
} from '../enums';
import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';

// ── Value objects ────────────────────────────────────────

/** A reference to a constituent element with its role in the component. */
export interface ConstituentRef {
  /** The UiElement's session ID. */
  readonly elementId: string;
  /** The role this element plays in the component. */
  readonly role: ComponentRole;
}

/** An option in a selectable component (dropdown, radio group, etc.). */
export interface OptionEntry {
  /** The internal value of the option. */
  readonly value: string;
  /** The display label shown to the user. */
  readonly label: string;
  /** Whether this option was selected during recording. */
  readonly selected: boolean;
  /** Whether this option is disabled. */
  readonly disabled: boolean;
}

/** Input for creating a ConstituentRef. */
export interface CreateConstituentRefInput {
  elementId: string;
  role: ComponentRole;
}

/** Input for creating an OptionEntry. */
export interface CreateOptionEntryInput {
  value: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
}

// ── Factory helpers ──────────────────────────────────────

export function createConstituentRef(input: CreateConstituentRefInput): ConstituentRef {
  if (!input.elementId?.trim()) {
    throw new ValueObjectError('ConstituentRef', 'elementId is required');
  }
  if (!input.role) {
    throw new ValueObjectError('ConstituentRef', 'role is required');
  }
  return {
    elementId: input.elementId.trim(),
    role: input.role,
  };
}

export function createOptionEntry(input: CreateOptionEntryInput): OptionEntry {
  if (!input.value) {
    throw new ValueObjectError('OptionEntry', 'value is required');
  }
  return {
    value: input.value,
    label: input.label?.trim() || input.value,
    selected: input.selected ?? false,
    disabled: input.disabled ?? false,
  };
}

// ── ComponentGrouping (entity) ───────────────────────────

/**
 * A recognized UI component — a group of elements that form a known pattern.
 *
 * Lifecycle: tentative → developing → confirmed (or → rejected).
 * The grouping assertion is persisted because AI-assisted recognition is
 * non-deterministic and structural recognition state is expensive to recompute.
 */
export interface ComponentGrouping {
  /** Stable session-scoped ID (e.g., "comp-0001"). */
  readonly groupingId: string;
  /** The recognized UI pattern type. */
  readonly patternType: PatternType;
  /** The primary anchoring element. */
  readonly rootElementId: string;
  /** Elements that belong to this component, with their roles. */
  readonly constituents: ConstituentRef[];
  /**
   * Semantic name in the application domain (e.g., "Travel Class").
   * Null until AI enrichment or manual naming.
   */
  readonly businessField: string | null;
  /** How this component was recognized. */
  readonly recognitionSource: RecognitionSource;
  /** Confidence in the pattern recognition (0.05–0.95). */
  readonly recognitionConfidence: number;
  /** Current lifecycle state. */
  readonly lifecycleState: ComponentLifecycleState;
  /**
   * Full set of options for selectable components.
   * Null for non-selectable patterns (modal, tabs container, etc.).
   */
  readonly optionSet: OptionEntry[] | null;
  /** IDs of transitions observed on this component's constituents. */
  readonly observedTransitionIds: string[];
}

/** Input for creating a ComponentGrouping. */
export interface CreateComponentGroupingInput {
  groupingId: string;
  patternType: PatternType;
  rootElementId: string;
  constituents: CreateConstituentRefInput[];
  recognitionSource: RecognitionSource;
  recognitionConfidence: number;
  businessField?: string | null;
  optionSet?: CreateOptionEntryInput[] | null;
}

/**
 * Create a ComponentGrouping entity with invariant validation.
 *
 * Invariants:
 *   - groupingId is required and non-empty
 *   - patternType is required
 *   - rootElementId is required and non-empty
 *   - constituents must be non-empty
 *   - recognitionConfidence must be in [0.05, 0.95]
 *   - initial lifecycleState is always TENTATIVE
 *
 * @throws MissingFieldError if required fields are empty
 * @throws ValueObjectError if constituents are empty or confidence is out of range
 */
export function createComponentGrouping(input: CreateComponentGroupingInput): ComponentGrouping {
  if (!input.groupingId?.trim()) {
    throw new MissingFieldError('ComponentGrouping', 'groupingId');
  }
  if (!input.patternType) {
    throw new ValueObjectError('ComponentGrouping', 'patternType is required');
  }
  if (!input.rootElementId?.trim()) {
    throw new MissingFieldError('ComponentGrouping', 'rootElementId');
  }
  if (!input.constituents || input.constituents.length === 0) {
    throw new ValueObjectError(
      'ComponentGrouping',
      'constituents must have at least one member',
    );
  }
  if (
    typeof input.recognitionConfidence !== 'number' ||
    input.recognitionConfidence < 0.05 ||
    input.recognitionConfidence > 0.95
  ) {
    throw new ValueObjectError(
      'ComponentGrouping',
      `recognitionConfidence must be in [0.05, 0.95] (got ${input.recognitionConfidence})`,
    );
  }

  return {
    groupingId: input.groupingId.trim(),
    patternType: input.patternType,
    rootElementId: input.rootElementId.trim(),
    constituents: input.constituents.map(createConstituentRef),
    businessField: input.businessField?.trim() || null,
    recognitionSource: input.recognitionSource,
    recognitionConfidence: input.recognitionConfidence,
    lifecycleState: ComponentLifecycleState.TENTATIVE,
    optionSet: input.optionSet ? input.optionSet.map(createOptionEntry) : null,
    observedTransitionIds: [],
  };
}

// ── Mutation helpers (return new instances) ──────────────

/**
 * Add a constituent to the component.
 * Idempotent — if the element is already a constituent, returns the component unchanged.
 */
export function addConstituent(
  component: ComponentGrouping,
  elementId: string,
  role: ComponentRole,
): ComponentGrouping {
  if (component.constituents.some((c) => c.elementId === elementId)) {
    return component;
  }
  return {
    ...component,
    constituents: [...component.constituents, createConstituentRef({ elementId, role })],
  };
}

/**
 * Record a transition observed on this component.
 */
export function addObservedTransition(
  component: ComponentGrouping,
  transitionId: string,
): ComponentGrouping {
  if (component.observedTransitionIds.includes(transitionId)) {
    return component;
  }
  return {
    ...component,
    observedTransitionIds: [...component.observedTransitionIds, transitionId],
    // Automatically advance from tentative to developing once we have transitions
    lifecycleState:
      component.lifecycleState === ComponentLifecycleState.TENTATIVE
        ? ComponentLifecycleState.DEVELOPING
        : component.lifecycleState,
  };
}

/**
 * Promote the component to CONFIRMED lifecycle state.
 *
 * Call this when the expected pattern lifecycle has been fully observed
 * (e.g., dropdown: open → select → commit/close).
 */
export function promoteToConfirmed(component: ComponentGrouping): ComponentGrouping {
  if (component.lifecycleState === ComponentLifecycleState.REJECTED) {
    throw new ValueObjectError(
      'ComponentGrouping',
      `cannot promote rejected component ${component.groupingId} to confirmed`,
    );
  }
  return {
    ...component,
    lifecycleState: ComponentLifecycleState.CONFIRMED,
  };
}

/**
 * Reject the component — mark it as a false recognition.
 */
export function rejectComponent(component: ComponentGrouping): ComponentGrouping {
  return {
    ...component,
    lifecycleState: ComponentLifecycleState.REJECTED,
  };
}

/**
 * Assign a business field name to the component.
 *
 * Called during AI enrichment to give the component a semantic name
 * (e.g., "Travel Class", "Departure Date").
 */
export function setBusinessField(
  component: ComponentGrouping,
  businessField: string,
): ComponentGrouping {
  if (!businessField?.trim()) {
    throw new ValueObjectError('ComponentGrouping', 'businessField cannot be empty');
  }
  return { ...component, businessField: businessField.trim() };
}

/**
 * Set the option set on the component.
 *
 * Called during enrichment to populate the full option set extracted from the DOM.
 */
export function setOptionSet(
  component: ComponentGrouping,
  options: CreateOptionEntryInput[],
): ComponentGrouping {
  if (!options || options.length === 0) {
    throw new ValueObjectError('ComponentGrouping', 'optionSet cannot be empty');
  }
  return { ...component, optionSet: options.map(createOptionEntry) };
}

/**
 * Check whether the component has reached CONFIRMED state.
 */
export function isConfirmed(component: ComponentGrouping): boolean {
  return component.lifecycleState === ComponentLifecycleState.CONFIRMED;
}

/**
 * Check whether the component is still active (not rejected).
 */
export function isActive(component: ComponentGrouping): boolean {
  return component.lifecycleState !== ComponentLifecycleState.REJECTED;
}
