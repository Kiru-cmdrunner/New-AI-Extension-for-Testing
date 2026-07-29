/**
 * Lifecycle Engine Types — Phase 1
 *
 * Types for the lifecycle stage of the target pipeline.
 *
 * The lifecycle engine groups recognised interactions into higher-level
 * SemanticActions — meaningful user actions that may span multiple low-level
 * interactions. For example, a dropdown selection is a single SemanticAction
 * composed of: click (open) → click (select item) → optional blur (close).
 *
 * Data flow:
 *
 *   RecognitionResult[]
 *     → LifecycleEngine: state machine groups recognised interactions
 *     → Produces SemanticAction[] (with optional child interactions)
 *     → Remaining unrecognised interactions pass through
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { RecognitionResult, InteractionId } from './recognition';
import type { InteractionVerb, ComponentType } from './foundation';

// ── Lifecycle Phase ──────────────────────────────────────────────────────

/**
 * Phases in the lifecycle state machine.
 *
 * Each recognised interaction advances a SemanticAction through its lifecycle:
 *
 *   TARGET → ACTIVATE → INTERMEDIATE → COMMIT | CANCEL
 *
 * Not every action goes through all phases. A simple click goes directly
 * from TARGET to COMMIT.
 */
export type LifecyclePhase =
  | 'target'         // User is targeting an element (hover, focus)
  | 'activate'       // User activated the element (click, keydown)
  | 'intermediate'   // An intermediate step within a multi-step action (select item)
  | 'commit'         // The action is complete and committed
  | 'cancel';        // The action was cancelled (Escape, click-away)

/**
 * A lifecycle state machine configuration.
 *
 * Defines which verb sequences constitute a valid SemanticAction and how
 * interactions should be grouped. This is the declarative replacement
 * for the existing classifier's multi-event grouping logic.
 */
export interface LifecycleConfig {
  /** Unique config identifier, e.g. 'dropdown-select-v1'. */
  id: string;
  /** The SemanticAction verb this config produces. */
  actionVerb: InteractionVerb;
  /** The component type this lifecycle applies to. */
  componentType: ComponentType;
  /** Sequence of verb transitions that define this lifecycle. */
  transitions: LifecycleTransition[];
  /** Maximum time window between interactions in the same lifecycle (ms). */
  maxWindowMs: number;
  /** Human-readable description. */
  description: string;
}

/**
 * A transition in the lifecycle state machine.
 */
export interface LifecycleTransition {
  /** The current lifecycle phase. */
  from: LifecyclePhase;
  /** The phase to transition to. */
  to: LifecyclePhase;
  /** The interaction verb that triggers this transition. */
  triggeredBy: InteractionVerb;
  /** Optional condition on the component type. */
  requiresComponent?: ComponentType;
}

// ── Semantic Action ──────────────────────────────────────────────────────

/**
 * A high-level user action composed of one or more recognised interactions.
 *
 * SemanticActions are the primary output of the lifecycle engine and the
 * primary input to the enrichment pipeline. They represent "what the user
 * did" at a semantic level — e.g., "Selected 'India' from the Country dropdown"
 * rather than "Clicked element with role=combobox, then clicked element
 * with role=option".
 *
 * Multi-interaction example (dropdown selection):
 *   interaction[0] = click on combobox (activate)
 *   interaction[1] = click on option "India" (commit)
 *   → SemanticAction: verb='select', value='India'
 */
export interface SemanticAction {
  /** Unique sequential action ID within the session. */
  id: string;
  /** Discriminator: always 'semantic_action'. */
  kind: 'semantic_action';
  /** The interaction verb of this action. */
  verb: InteractionVerb;
  /** The component type this action targets. */
  componentType: ComponentType | null;
  /** The recognised interactions that compose this action. */
  interactions: InteractionId[];
  /** ISO timestamp of the first interaction in this action. */
  startedAt: string;
  /** ISO timestamp of the last interaction in this action. */
  endedAt: string;
  /** Lifecycle phase this action reached. */
  lifecyclePhase: LifecyclePhase;
  /** Confidence in this action classification [0, 1]. */
  confidence: number;
  /** The primary value resulting from this action, if any (e.g., selected text). */
  value: string | null;
  /** Human-readable plain English description. */
  plainEnglish: string;
  /** Whether this action was completed (commit) or cancelled. */
  committed: boolean;
}

// ── Lifecycle Output ─────────────────────────────────────────────────────

/**
 * Complete output of the lifecycle engine stage.
 */
export interface LifecycleOutput {
  /** Semantic actions produced. */
  actions: SemanticAction[];
  /** Recognition results that could not be grouped into actions. */
  ungrouped: RecognitionResult[];
  /** Number of interactions consumed. */
  interactionCount: number;
  /** Number of semantic actions produced. */
  actionCount: number;
  /** ISO timestamp of when lifecycle processing completed. */
  completedAt: string;
  /** Any errors encountered (non-fatal). */
  errors: LifecycleError[];
}

/**
 * A non-fatal error during lifecycle processing.
 */
export interface LifecycleError {
  message: string;
  interactionId: InteractionId | null;
  timestamp: string;
}
