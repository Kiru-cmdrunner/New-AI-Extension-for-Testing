/**
 * Foundation Type System — Phase 1
 *
 * Core vocabulary for the Semantic Evidence Pipeline architecture.
 * These types define the *shape* of the target architecture's data flow
 * without implementing any logic. They coexist with existing types in
 * shared/types.ts and shared/architecture-types.ts — nothing is removed.
 *
 * Every type here maps to a slot in the target pipeline:
 *
 *   EvidenceRecord  → produced by Evidence Channels (A-E)
 *   EvidenceBatch   → assembled per-interaction by EventTap
 *   RecognitionResult → produced by Recognition Pipeline
 *   SemanticAction  → produced by Lifecycle Engine
 *   EnrichedRecording → produced by Enrichment Pipeline
 *   RecordingArtifact → final output of Output Stage
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

// ── Evidence Channels (A–E) ──────────────────────────────────────────────

/**
 * The five evidence channels that collect structured data about each DOM event.
 *
 * Each channel is a modular collector responsible for one category of evidence.
 * Together they assemble an EvidenceBatch — the atomic unit of the pipeline.
 *
 *   A — Accessibility:  ARIA roles, states, accessible name, landmarks
 *   B — DOM Structure:  tag, classes, hierarchy, text content, shadow/iframe
 *   C — Behavioural:    event sequence, interaction pattern, value transitions
 *   D — Runtime Mutations: surface detection, hover reveal, DOM changes
 *   E — Focus & Overlay: focus chain, overlay stack, dialog/modal tracking
 */
export type ChannelId = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * Categories of signals that evidence channels can report.
 *
 * A SignalType classifies what *kind* of observation was made, independent
 * of which channel made it. This allows the recognition pipeline to match
 * patterns by signal category rather than by channel origin.
 */
export type SignalType =
  // Structural signals
  | 'tag'
  | 'cssClass'
  | 'hierarchy'
  | 'text'
  // Accessibility signals
  | 'ariaRole'
  | 'ariaState'
  | 'ariaAttribute'
  | 'accessibleName'
  | 'landmark'
  // Behavioural signals
  | 'eventSequence'
  | 'valueTransition'
  | 'checkedTransition'
  | 'keySequence'
  | 'dwellTime'
  | 'focusDuration'
  // Mutation signals
  | 'surfaceAppearance'
  | 'surfaceDisappearance'
  | 'childListChange'
  | 'attributeChange'
  | 'visibilityChange'
  // Focus signals
  | 'focusEnter'
  | 'focusExit'
  | 'overlayOpen'
  | 'overlayClose'
  // Navigation signals
  | 'navigation'
  | 'tabOpen'
  | 'tabClose';

// ── Recording Lifecycle States ───────────────────────────────────────────

/**
 * Target recording lifecycle states.
 *
 * Extends the existing 3-state enum (Ready, Recording, Stopped) with
 * intermediate transition states for robust lifecycle management.
 *
 * These are for the *target* SessionManager. The existing RecordingState
 * enum in shared/types.ts remains the current source of truth.
 */
export type TargetRecordingState =
  | 'idle'           // Initial state, before recording starts
  | 'starting'       // Injecting content scripts, setting up listeners
  | 'recording'      // Actively capturing events
  | 'stopping'       // Processing pipeline, building artifact
  | 'completed'      // Pipeline finished, artifact ready
  | 'error_recovery';// Recovering from a crash or error

// ── Component Classification ─────────────────────────────────────────────

/**
 * Semantic component categories recognised by the pipeline.
 *
 * Unlike the existing ARIA-role-based structural recognizer, these represent
 * *behavioural* component types — what the component *does*, not just what
 * ARIA role it declares. A <div role="combobox"> and a <select> both
 * resolve to ComponentType.DropDownListbox.
 */
export type ComponentType =
  | 'Button'
  | 'Link'
  | 'TextInput'
  | 'TextArea'
  | 'Checkbox'
  | 'RadioButton'
  | 'DropDownListbox'    // Native <select> or ARIA combobox
  | 'DatePicker'
  | 'Slider'
  | 'ToggleSwitch'
  | 'Menu'
  | 'MenuItem'
  | 'Tab'
  | 'Accordion'
  | 'Dialog'
  | 'Tooltip'
  | 'FileUpload'
  | 'Breadcrumb'
  | 'NavigationBar'
  | 'Generic';           // Fallback for unrecognised elements

// ── Interaction Verbs ────────────────────────────────────────────────────

/**
 * Canonical interaction verbs — the "what the user did" vocabulary.
 *
 * These are the output of the recognition pipeline's classification step.
 * Each EvidenceBatch is classified into exactly one InteractionVerb.
 *
 * Maps to the existing CanonicalType in architecture-types.ts but uses
 * verb-based naming (click, fill, toggle) rather than noun-based (click,
 * fill, toggle) for clarity in the pipeline context.
 */
export type InteractionVerb =
  | 'navigate'     // URL change, tab navigation
  | 'click'        // Single click on a button, link, or interactive element
  | 'fill'         // Text entry into an input/textarea
  | 'select'       // Selection from a dropdown, listbox, or combobox
  | 'toggle'       // Checkbox, toggle switch state change
  | 'selectOption' // Radio button selection
  | 'selectDate'   // Date picker interaction
  | 'hover'        // Hover with observable UI response
  | 'scroll'       // Meaningful scroll (above threshold)
  | 'upload'       // File upload (browse or drag-drop)
  | 'dragDrop'     // Drag and drop interaction
  | 'pressKey'     // Keyboard shortcut or meaningful key press
  | 'dismiss'      // Closing a dialog, modal, or overlay
  | 'unknown';     // Unclassified — pipeline could not determine verb

// ── Evidence Record ──────────────────────────────────────────────────────

/**
 * A single piece of structured evidence collected by a channel.
 *
 * EvidenceRecord is the atom of the evidence system. Each channel produces
 * one or more EvidenceRecords per DOM event. The EventTap assembles these
 * into an EvidenceBatch.
 *
 * Design principle: EvidenceRecords are *immutable* once created. They
 * represent a point-in-time observation and must never be mutated.
 */
export interface EvidenceRecord<T = unknown> {
  /** Which channel collected this evidence. */
  channelId: ChannelId;
  /** What category of signal this represents. */
  signalType: SignalType;
  /** ISO 8601 timestamp of when the evidence was collected. */
  timestamp: string;
  /** The observed value. Type depends on signalType. */
  value: T;
  /**
   * Confidence in this observation [0, 1].
   * 1.0 = directly observed (e.g., tagName from element.tagName).
   * <1.0 = inferred (e.g., surface type guessed from class names).
   */
  confidence: number;
}

// ── Pattern Definition (declarative recognition) ─────────────────────────

/**
 * A condition that must be satisfied for a pattern to match.
 *
 * Conditions reference signal types and apply operators to the evidence
 * values. This is the declarative replacement for procedural if/else
 * classification rules.
 */
export interface PatternCondition {
  /** The signal type this condition checks. */
  signalType: SignalType;
  /** The operator to apply. */
  operator: PatternOperator;
  /** The expected value (operator-dependent). */
  expected: unknown;
  /** Human-readable description of what this condition checks. */
  description: string;
  /** Weight contribution to the overall confidence [0, 1]. */
  weight: number;
  /**
   * Alternative sub-conditions — if ANY of these match, the condition is
   * satisfied (OR logic). The primary signalType/operator/expected is still
   * checked first; anyOf is an additional path to satisfaction.
   *
   * Example: checkbox detection needs EITHER (tag=INPUT + type=checkbox)
   * OR (ariaRole=checkbox) OR (ariaRole=switch).
   */
  anyOf?: Array<{
    signalType: SignalType;
    operator: PatternOperator;
    expected: unknown;
  }>;
}

/**
 * Operators for pattern condition matching.
 */
export type PatternOperator =
  | 'equals'           // value === expected
  | 'notEquals'        // value !== expected
  | 'contains'         // value includes expected (string/array)
  | 'notContains'      // value does not include expected
  | 'exists'           // value is not null/undefined
  | 'notExists'        // value is null/undefined
  | 'matches'          // value matches regex (expected = pattern string)
  | 'greaterThan'      // value > expected (numeric)
  | 'lessThan'         // value < expected (numeric)
  | 'inRange';         // expected = [min, max]

/**
 * A declarative pattern definition for interaction recognition.
 *
 * Patterns are registered in a PatternRegistry and evaluated by the
 * RecognitionPipeline. Each pattern describes how to recognise a specific
 * interaction verb from evidence signals.
 *
 * This replaces the existing classifier's if/else cascade (807 lines)
 * with a data-driven approach.
 */
export interface PatternDefinition {
  /** Unique pattern identifier, e.g. 'checkbox-toggle-v1'. */
  id: string;
  /** The interaction verb this pattern recognises. */
  verb: InteractionVerb;
  /** The component type this pattern expects, if known. */
  componentType?: ComponentType;
  /** Conditions that must be satisfied (ALL must match). */
  conditions: PatternCondition[];
  /** Minimum confidence threshold for this pattern to be accepted [0, 1]. */
  confidenceThreshold: number;
  /** Human-readable description for debugging and documentation. */
  description: string;
  /** Whether this pattern requires multi-event evidence (grouped batches). */
  requiresGrouping?: boolean;
  /**
   * Discovery priority — higher = evaluated first (most specific).
   * Click fallback should have the lowest priority.
   * Defaults to 100 if omitted.
   */
  priority?: number;
}
