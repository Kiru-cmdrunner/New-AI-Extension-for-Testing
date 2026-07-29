/**
 * Lifecycle Types — Phase 5
 *
 * Declarative lifecycle definitions for the interaction state machine.
 *
 * The lifecycle engine takes RecognitionResults from Phase 4 and groups
 * them into SemanticActions — meaningful test steps that a QA engineer
 * would expect to see.
 *
 * Each lifecycle definition describes a state machine as DATA:
 *   ACTIVATE → INTERMEDIATE → COMMIT | CANCEL
 *
 * The engine is a generic interpreter — no interaction-specific logic.
 *
 * Decision classification:
 * - Adopted: immediate completion pattern (from working-better)
 * - Improved: dropdown/date-picker outside-click cancellation
 * - Rejected: hover sustained-dwell false-positive (working-better incorrect)
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { InteractionVerb, ComponentType } from '../../types/foundation';

// ── Lifecycle Phases ─────────────────────────────────────────────────────

/**
 * The phases a lifecycle can be in.
 *
 * Diagram:
 *   INACTIVE → ACTIVE → COMMITTED (terminal)
 *                   ↘ CANCELLED  (terminal)
 */
export type LifecyclePhase = 'inactive' | 'active' | 'committed' | 'cancelled';

// ── Lifecycle Definition ─────────────────────────────────────────────────

/**
 * A rule for matching a recognition result to a lifecycle stage.
 */
export interface LifecycleMatchRule {
  /** The verb that triggers this rule. */
  verb: InteractionVerb;
  /** Optional component type constraint. */
  componentType?: ComponentType;
}

/**
 * A declarative lifecycle definition — describes a state machine as data.
 *
 * The lifecycle engine interprets these definitions generically. Adding a
 * new lifecycle = adding a new LifecycleDefinition, not changing the engine.
 */
export interface LifecycleDefinition {
  /** Unique identifier. */
  id: string;
  /** The verb of the SemanticAction produced when this lifecycle commits. */
  actionVerb: InteractionVerb;
  /** The component type of the SemanticAction. */
  componentType: ComponentType;
  /** Human-readable description. */
  description: string;

  /** Recognition results that activate this lifecycle. */
  activateOn: LifecycleMatchRule;
  /** Recognition results that sustain (extend) this lifecycle. */
  sustainOn?: LifecycleMatchRule;
  /** Recognition results that commit (complete) this lifecycle. */
  commitOn: LifecycleMatchRule;
  /**
   * Alternative commit rules (Phase 5b). If the primary commitOn doesn't match,
   * these alternative rules are tried. Used for date picker multi-mode completion:
   * cell click, blur with typed value, native input change.
   */
  commitOnAlternatives?: LifecycleMatchRule[];

  /**
   * Verbs that are lifecycle-internal — they sustain the lifecycle but
   * neither commit nor cancel it. Used for date picker navigation buttons
   * (prev/next/switch/month). Phase 5b.
   */
  internalVerbs?: string[];

  /**
   * For scroll coalescing lifecycles: any non-scroll event commits.
   * Phase 5b: scroll burst coalescing.
   */
  commitOnAnyNonMatching?: boolean;

  /**
   * Burst gap in milliseconds for scroll-like coalescing. If two events
   * arrive within this gap, they're part of the same gesture.
   */
  burstGapMs?: number;

  /** Cancel the lifecycle when a click occurs outside its scope. */
  cancelOnOutsideClick: boolean;
  /** Cancel the lifecycle when Escape is pressed. */
  cancelOnEscape: boolean;
  /** Navigation events cancel this lifecycle. */
  cancelOnNavigation: boolean;

  /** Max duration in milliseconds before stale timeout cancels the lifecycle. */
  maxDurationMs: number;

  /**
   * If true, the lifecycle is rejected (no SemanticAction emitted) when it
   * ends without any intermediate or commit events.
   *
   * This implements no-op detection: "focus on a field and blur without
   * typing" is not a meaningful test step.
   */
  rejectIfNoProgress: boolean;
}

// ── Active Lifecycle Instance ────────────────────────────────────────────

/**
 * A runtime instance of a lifecycle definition — tracks state as
 * recognition results arrive.
 */
export interface ActiveLifecycle {
  /** The definition governing this instance. */
  definition: LifecycleDefinition;
  /** Current phase. */
  phase: LifecyclePhase;
  /** The activation recognition result that started this lifecycle. */
  activatedBy: string; // RecognitionResult id
  /** IDs of recognition results that sustained this lifecycle. */
  sustainedBy: string[];
  /** The commit recognition result, if committed. */
  committedBy: string | null;
  /** Timestamp when the lifecycle was activated. */
  startedAt: string;
  /** Timestamp of the last event. */
  lastEventAt: string;
  /** Element key of the activating interaction (for scope detection). */
  scopeElementKey: string;
  /** The accumulated value (e.g., selected option text, entered text). */
  value: string | null;
}

// ── Lifecycle Processing Result ──────────────────────────────────────────

/**
 * Result of processing a recognition result through the lifecycle engine.
 */
export interface LifecycleProcessResult {
  /** SemanticActions emitted (committed) by this processing step. */
  emitted: SemanticActionOutput[];
  /** Active lifecycles cancelled by this processing step. */
  cancelled: string[];
}

/**
 * Output representation of a SemanticAction (before being converted to
 * the full SemanticAction type from lifecycle.ts types).
 */
export interface SemanticActionOutput {
  /** The lifecycle definition that produced this action. */
  definitionId: string;
  /** The interaction verb. */
  verb: InteractionVerb;
  /** The component type. */
  componentType: ComponentType;
  /** All recognition result IDs that contributed. */
  sourceResults: string[];
  /** Started timestamp. */
  startedAt: string;
  /** Ended timestamp. */
  endedAt: string;
  /** The captured value (selected option, entered text, etc.). */
  value: string | null;
  /** Whether this action was committed (true) or force-flushed (false). */
  committed: boolean;
}
