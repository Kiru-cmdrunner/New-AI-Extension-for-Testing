/**
 * Application Knowledge Fragment — the derived views and aggregate output.
 *
 * These are computed from the three foundational entities (UiElement,
 * ObservedTransition, ComponentGrouping). They are materialized as cached
 * snapshots during the post-recording enrichment pass, but are always
 * regenerable from the foundations.
 *
 * Design principle: application-centric. The fragment represents what the
 * application IS, not what AI reasons about. AI is one consumer of this model.
 *
 * Reference: .drytis/specs/ui-knowledge-model-foundation.md (Phase 7)
 */

import type { IntrinsicCapability, ComponentRole } from '../enums';
import type { InteractionType } from '../../shared/component-types';

// ── InteractionContract (derived view) ───────────────────

/**
 * The space of valid interactions for an element or component.
 *
 * Computed from UiElement.domAttributes + PatternDefinition.
 * This is the primary input for boundary testing and negative test generation:
 * "what values are valid?" "what makes this field required?" "what format?"
 *
 * Derived — always recomputable from UiElement.domAttributes.
 */
export interface InteractionContract {
  /** Which entity this contract applies to. */
  readonly appliesTo: { type: 'element' | 'component'; id: string };
  /** Operations supported (from pattern definition + element capabilities). */
  readonly affordances: string[];
  /** Input constraints derived from DOM attributes. */
  readonly constraints: InteractionConstraints;
}

/**
 * Constraint rules governing valid input/state.
 * Each field is null if the corresponding DOM attribute was not present.
 */
export interface InteractionConstraints {
  readonly required: boolean | null;
  readonly inputType: string | null;
  /** Numeric range (from min/max/step attributes). */
  readonly valueRange: { min: number; max: number; step: number } | null;
  /** String length limits (from minlength/maxlength). */
  readonly lengthRange: { minLength: number; maxLength: number } | null;
  /** Format pattern (from pattern attribute or type attribute). */
  readonly format: { regex: string; description: string } | null;
  /** Valid options for selectables (matches ComponentGrouping.optionSet as flat list). */
  readonly validOptions: string[] | null;
  /** Date format and range for date pickers. */
  readonly dateFormat: { format: string; earliest: string | null; latest: string | null } | null;
}

// ── BehavioralContract (derived view) ────────────────────

/**
 * How the application responds when an operation is performed.
 *
 * Computed from ObservedTransitions + ComponentGrouping + PatternDefinition.
 * This is what makes generated tests meaningful — assertions about expected
 * outcomes, validation responses, and cascading effects.
 *
 * Derived — always recomputable from ObservedTransitions.
 */
export interface BehavioralContract {
  /** Which entity this contract applies to. */
  readonly appliesTo: { type: 'element' | 'component'; id: string };
  /** Valid states and transitions observed or inferred from pattern. */
  readonly stateMachine: StateMachine;
  /** How the app validates and reports errors (if observed). */
  readonly validationBehavior: ValidationBehavior | null;
  /** Side effects on other components/state observed during recording. */
  readonly cascadeEffects: CascadeEffectSummary[];
  /** How we know an operation succeeded. */
  readonly successIndicators: SuccessIndicator[];
}

/** A finite state machine for a component's lifecycle. */
export interface StateMachine {
  readonly states: { name: string; description: string }[];
  readonly transitions: StateTransitionDef[];
  readonly terminalStates: string[];
}

/** A state transition in the component's state machine. */
export interface StateTransitionDef {
  readonly from: string;
  readonly to: string;
  readonly operation: string;
  /** Whether the user triggered this transition during recording. */
  readonly observed: boolean;
  /** DOM signals confirming the transition. */
  readonly evidence: string[];
}

/** How the application validates input and reports errors. */
export interface ValidationBehavior {
  readonly triggerTiming: 'onBlur' | 'onChange' | 'onSubmit' | 'realtime';
  readonly responseType: 'inline' | 'fieldHighlight' | 'modal' | 'toast' | 'banner';
  readonly errorMessages: { condition: string; messageText: string }[];
  readonly observed: boolean;
}

/** Summary of a cascade effect on another entity. */
export interface CascadeEffectSummary {
  readonly trigger: string;
  readonly affectsEntityId: string;
  readonly effect: string;
  readonly detail: string;
}

/** Evidence that an operation succeeded. */
export interface SuccessIndicator {
  readonly signal: string;
  readonly type: 'navigation' | 'valueDisplay' | 'visibility' | 'stateChange';
  readonly description: string;
}

// ── LogicalAction (derived view — Semantic Aggregation output) ──

/**
 * A logical user action, aggregated from one or more observed transitions that
 * compose a complete (or partial) interaction lifecycle on a single component.
 *
 * This is the output of Semantic Aggregation: multiple low-level transitions
 * (e.g., open + select) on the same component become one semantic action.
 *
 * Design principle: structural description, NOT classification. A logical action
 * is described by what it acted on, what transitions composed it, what field it
 * affected, and what state change resulted. It does NOT carry an actionType enum
 * — consumers derive whatever classification they need from the structural data.
 * This avoids a growing taxonomy (the coupling problem that plagued the legacy
 * recorder's interaction-types.ts).
 *
 * Derived — always recomputable from ComponentGrouping.observedTransitionIds +
 * PatternDefinition.expectedLifecycle + enriched component data.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §4
 */
export interface LogicalAction {
  /** Unique identifier for this action within the session. */
  readonly actionId: string;
  /** Component this action acted on. Null for standalone transitions (no component). */
  readonly componentId: string | null;
  /**
   * Business-field label for the affected field, from enrichment.
   * Null if the component was not enriched or has no discernible label.
   */
  readonly businessField: string | null;
  /** The transition IDs that compose this action (traceability to foundations). */
  readonly transitionIds: readonly string[];
  /** Whether the observed operations fully satisfied the expected lifecycle. */
  readonly lifecycleComplete: boolean;
  /** Net state change resulting from this action. Null if no observable state change. */
  readonly resultingChange: ResultingChange | null;
  /** Timestamp of the first composing transition (for temporal ordering). */
  readonly timestamp: number;
  /**
   * The InteractionType that the recorder classified for the originating
   * component interaction. Carried through from ComponentInteraction.type
   * via the component's patternType. Used by P1 to derive inputMethod on
   * DataRequirement.
   *
   * Null for standalone transitions or when the component's pattern type
   * does not map to a known InteractionType.
   */
  readonly sourceInteractionType: InteractionType | null;
}

/**
 * The net state change produced by a logical action, read from the transition
 * boundaries of the action group (first stateBefore → last stateAfter).
 *
 * This is observed data — the first and last observed states of the affected
 * element within the action group. No inference.
 */
export interface ResultingChange {
  /** Which element's state changed (typically the component's root/trigger). */
  readonly targetElementId: string;
  /** Which state field changed. */
  readonly field: 'value' | 'checked' | 'expanded' | 'selected';
  /** State before the action group (first transition's stateBefore). */
  readonly from: string | boolean | null;
  /** State after the action group (last transition's stateAfter). */
  readonly to: string | boolean | null;
}

// ── RecordedWorkflow (derived view — workflow structure) ──

/**
 * The logical workflow structure of a recording session, derived from ordered
 * LogicalActions and navigation transitions.
 *
 * Represents the user's flow as a sequence of semantic actions grouped by page
 * (surface), with branch points revealing alternate paths the user didn't take.
 *
 * Derived — always recomputable from LogicalAction[] + ObservedTransition[].
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §5
 */
export interface RecordedWorkflow {
  /** Page-to-page transitions (workflow boundaries, from NAVIGATE operations). */
  readonly surfaceTransitions: readonly SurfaceTransition[];
  /** Ordered logical actions across the entire session. */
  readonly logicalActions: readonly LogicalAction[];
  /** Choice points where the user selected one option from many. */
  readonly branchPoints: readonly BranchPoint[];
  /** Actions derived from relevance=supporting transitions (not primary actions). */
  readonly optionalSteps: readonly LogicalAction[];
}

/** A workflow boundary — navigation from one page to another. */
export interface SurfaceTransition {
  /** URL of the page the user was on before navigation. */
  readonly fromUrl: string;
  /** URL of the page the user navigated to. */
  readonly toUrl: string;
  /** The transition that triggered this navigation. */
  readonly triggeredByTransitionId: string;
}

/**
 * A choice point where the user selected one option from a set of available
 * options. The unchosen options reveal alternate flows for test generation.
 */
export interface BranchPoint {
  /** Component where the choice was made. */
  readonly componentId: string;
  /** All available options (from ComponentGrouping.optionSet). */
  readonly availableOptions: readonly string[];
  /** The option the user chose. */
  readonly chosenOption: string;
}

// ── ApplicationSurface (derived view — page-level grouping) ──

/**
 * A page-level view of the interactive elements and components on a single URL.
 *
 * Derived by grouping UiElements by sourceUrl. Each surface represents one
 * "page" (or distinct URL state) in the application.
 *
 * Derived — always recomputable from UiElement.sourceUrl grouping.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §6
 */
export interface ApplicationSurface {
  /** The URL this surface represents. */
  readonly url: string;
  /** IDs of interactive elements on this surface. */
  readonly elementIds: readonly string[];
  /** IDs of confirmed components on this surface. */
  readonly componentIds: readonly string[];
}

// ── Application Knowledge Fragment (aggregate) ───────────

/**
 * The complete knowledge model produced from a single recording session.
 *
 * This is the dual output of the recording pipeline:
 *   1. Test steps (existing generation pipeline, unchanged)
 *   2. Application Knowledge Fragment (this — semantic understanding)
 *
 * Contains:
 *   - Foundational entities (persisted as source of truth)
 *   - Derived views (materialized at enrichment time, recomputable)
 *
 * The fragment is application-centric — it describes the application's UI,
 * behavior, and relationships. AI test generation consumes it but does not
 * define its structure.
 */
export interface ApplicationKnowledgeFragment {
  /** Session ID this fragment was produced from. */
  readonly sessionId: string;
  /** Timestamp the fragment was assembled. */
  readonly generatedAt: string;
  /** Schema version for forward compatibility. */
  readonly schemaVersion: number;

  // ── Foundational entities (source of truth) ──

  /** All elements encountered during the session. */
  readonly elements: UiElementSummary[];
  /** All observed transitions (in chronological order). */
  readonly transitions: TransitionSummary[];
  /** All recognized components (confirmed and developing). */
  readonly components: ComponentSummary[];

  // ── Derived views (materialized, recomputable) ──

  /** Interaction contracts for each interactive element/component. */
  readonly interactionContracts: InteractionContract[];
  /** Behavioral contracts for each confirmed component. */
  readonly behavioralContracts: BehavioralContract[];
  /** Logical actions from Semantic Aggregation (transitions grouped by lifecycle). */
  readonly logicalActions: LogicalAction[];
  /** Workflow structure (ordered actions, boundaries, branch points). */
  readonly recordedWorkflow: RecordedWorkflow;
  /** Page-level surfaces (elements grouped by URL). */
  readonly applicationSurfaces: ApplicationSurface[];
}

/** Compact element summary for the fragment. */
export interface UiElementSummary {
  readonly elementId: string;
  readonly tag: string;
  readonly role: string | null;
  readonly accessibleName: string;
  readonly capabilities: IntrinsicCapability[];
  readonly componentId: string | null;
  readonly componentRole: ComponentRole | null;
  readonly sourceUrl: string;
}

/** Compact transition summary for the fragment. */
export interface TransitionSummary {
  readonly transitionId: string;
  readonly elementId: string;
  readonly componentId: string | null;
  readonly operation: string;
  readonly timestamp: number;
  readonly relevance: string;
}

/** Compact component summary for the fragment. */
export interface ComponentSummary {
  readonly groupingId: string;
  readonly patternType: string;
  readonly rootElementId: string;
  readonly constituentCount: number;
  readonly businessField: string | null;
  readonly lifecycleState: string;
  readonly optionCount: number | null;
}
