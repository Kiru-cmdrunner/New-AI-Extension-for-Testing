/**
 * Capability Candidate — the semantic understanding artifact.
 *
 * Represents what the application DOES, as opposed to the fragment which
 * represents what EXISTS and what HAPPENED. The capability answers:
 *   "What business capability did this recording session exercise?"
 *
 * Derived deterministically from the ApplicationKnowledgeFragment using
 * pattern matching on workflow structure, component data, and interaction
 * contracts. No rigid taxonomy — the capability name is derived from the
 * application's own text (button labels, page titles, URL patterns).
 *
 * Design principles:
 *   - Structural description, NOT classification — same principle as the fragment.
 *     No enum of capability types (CREATE, UPDATE, DELETE) that grows with every
 *     new feature. The name is derived, not enumerated.
 *   - Peer to the fragment — separate type, separate concern, separate consumer.
 *   - Immutable per-session snapshot — enriched through future test execution,
 *     not mutated in-place.
 *   - Confidence starts at 'candidate' (single observation) and rises to
 *     'confirmed' through cross-session accumulation (future: Repository).
 *
 * Reference: Phase 9.5 architectural design discussion
 */

import type { InteractionType } from '../../shared/component-types';

// ── Capability Input (what the capability accepts) ───────

/**
 * A single input field that the capability accepts.
 * Derived from LogicalAction.businessField + InteractionContract.constraints.
 */
export interface CapabilityInput {
  /** Human-readable field label (from LogicalAction.businessField). */
  readonly label: string;
  /**
   * C2: Display label preserved independently for forward-compatible fieldKey evolution.
   * Same value as label in Tier 1 (both from accessibleName). When fieldKey
   * derivation is added later, label may carry the normalized key while
   * displayLabel preserves the real accessibleName.
   *
   * Optional for backward compatibility — consumers should fall back to
   * label when displayLabel is absent.
   */
  readonly displayLabel?: string | null;
  /** Element ID in the fragment (for locator resolution). */
  readonly elementId: string;
  /** Whether the field is required. */
  readonly required: boolean;
  /** Input type (text, email, number, tel, etc.). */
  readonly inputType: string | null;
  /** Value range for numeric inputs. */
  readonly valueRange: { min: number; max: number; step: number } | null;
  /** String length limits. */
  readonly lengthRange: { minLength: number; maxLength: number } | null;
  /** Format constraint (regex + description). */
  readonly format: { regex: string; description: string } | null;
  /** Valid options for selectables. */
  readonly validOptions: string[] | null;
  /**
   * The InteractionType that the recorder classified for the originating
   * interaction. Carried through from LogicalAction.sourceInteractionType.
   * Used by P1 to derive inputMethod on DataRequirement.
   *
   * Null for standalone transitions or when no pattern type maps.
   *
   * Optional for backward compatibility — consumers treat undefined as null.
   */
  readonly sourceInteractionType?: InteractionType | null;
}

// ── Validation Rule (what makes input valid) ─────────────

/**
 * A validation rule that the capability enforces.
 * Derived from InteractionContract.constraints.
 */
export interface ValidationRule {
  /** What is being validated (field label or element reference). */
  readonly field: string;
  /** The rule type (required, format, range, length, options). */
  readonly type: 'required' | 'format' | 'range' | 'length' | 'options';
  /** Human-readable description of the rule. */
  readonly description: string;
  /** The constraint value (regex, range object, options array, etc.). */
  readonly constraint: string;
}

// ── Outcome Descriptor (what happens when the capability runs) ──

/**
 * The observed outcome of the capability in this session.
 * Derived from the terminal SurfaceTransition + BehavioralContract.successIndicators.
 */
export interface OutcomeDescriptor {
  /** Where the workflow ended (URL of the final page). */
  readonly terminalUrl: string | null;
  /** How success was indicated (navigation, value display, etc.). */
  readonly successSignals: string[];
  /** Whether the workflow completed (reached a terminal state). */
  readonly completed: boolean;
}

// ── Enrichment (future — populated by test execution) ────

/**
 * A failure mode observed during test execution.
 * Initially empty — populated when generated tests reveal validation errors,
 * business rule failures, or unexpected outcomes.
 */
export interface FailureMode {
  /** What input triggered the failure. */
  readonly trigger: string;
  /** What happened (validation error, business rule rejection, etc.). */
  readonly outcome: string;
  /** When this was observed. */
  readonly observedAt: string;
}

/**
 * A business rule inferred from observations.
 * Initially empty — populated when test execution reveals cross-field
 * dependencies, uniqueness constraints, or conditional logic.
 */
export interface BusinessRule {
  /** Human-readable description of the rule. */
  readonly description: string;
  /** Fields involved in the rule. */
  readonly fields: string[];
  /** When this was inferred. */
  readonly inferredAt: string;
}

// ── Capability Candidate ─────────────────────────────────

/**
 * The semantic understanding of what a recording session exercised.
 *
 * This is the "what does the application do?" artifact, derived from the
 * fragment's "what exists and what happened?" data.
 *
 * Confidence levels:
 *   - 'candidate': single observation. The capability is provisionally understood.
 *   - 'confirmed': multiple consistent observations across sessions (future).
 *
 * Enrichment loop (future, via test execution):
 *   observedOutcomes, businessRules, and failureModes start empty after the
 *   first recording. They get populated when generated tests reveal new
 *   outcomes, failure modes, and business rules. This enables progressive
 *   enrichment without re-recording.
 */
export interface CapabilityCandidate {
  /** Unique identifier for this capability. */
  readonly capabilityId: string;

  // ── Identity ──

  /** Human-readable name (e.g., "Create Customer", "Login"). */
  readonly name: string;
  /** Best-effort description of what this capability does. */
  readonly purpose: string;
  /** Confidence in the capability understanding. */
  readonly confidence: 'candidate' | 'confirmed';

  // ── Structure (from fragment) ──

  /** The element that triggered the capability (e.g., submit button). */
  readonly entryElement: { elementId: string; accessibleName: string; tag: string; role: string | null } | null;
  /** Input fields accepted by the capability. */
  readonly inputs: CapabilityInput[];
  /** The outcome observed in this session. */
  readonly observedOutcome: OutcomeDescriptor;
  /** Validation rules derived from interaction contracts. */
  readonly validationRules: ValidationRule[];

  // ── Enrichment (future — initially empty) ──

  /** Additional outcomes observed through test execution. */
  readonly observedOutcomes: OutcomeDescriptor[];
  /** Business rules inferred from observations. */
  readonly businessRules: BusinessRule[];
  /** Failure modes observed during test execution. */
  readonly failureModes: FailureMode[];

  // ── Provenance ──

  /** Session ID this capability was derived from. */
  readonly sourceSessionId: string;
  /** Fragment ID this capability was derived from. */
  readonly sourceFragmentId: string;
  /** When this capability was derived. */
  readonly derivedAt: string;
  /** History of enrichment events (initially empty). */
  readonly enrichmentHistory: EnrichmentEvent[];
}

/**
 * A single enrichment event in the capability's history.
 * Records when and how the capability was enriched.
 */
export interface EnrichmentEvent {
  /** Type of enrichment. */
  readonly type: 'initial-derivation' | 'test-execution' | 'cross-session' | 'ai-enrichment';
  /** When the enrichment occurred. */
  readonly timestamp: string;
  /** What was added or changed. */
  readonly description: string;
}
