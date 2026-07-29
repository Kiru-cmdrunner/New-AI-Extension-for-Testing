/**
 * Output & Enrichment Types — Phase 1
 *
 * Types for the enrichment and output stages of the target pipeline.
 *
 * The enrichment pipeline adds behavioral contracts, capability analysis,
 * coverage assessment, and workflow detection to SemanticActions. The output
 * stage assembles everything into a RecordingArtifact — the final deliverable.
 *
 * Data flow:
 *
 *   LifecycleOutput (SemanticActions + ungrouped)
 *     → EnrichmentPipeline: behavioral contracts, capabilities, coverage
 *     → EnrichedRecording (actions + contracts + metadata)
 *     → OutputStage: assemble RecordingArtifact (metadata + IR + traces)
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { SemanticAction } from './lifecycle';
import type { UnrecognisedInteraction } from './recognition';
import type { ComponentType, InteractionVerb } from './foundation';
import type { TargetElementIdentity } from './element';

// ── Behavioral Contract ──────────────────────────────────────────────────

/**
 * A behavioral contract describing how an element should behave.
 *
 * Contracts are derived from DOM attributes (required, pattern, min, max,
 * step, etc.) and from observed interaction patterns. They serve as
 * assertions for execution and documentation for the test case.
 *
 * This is the target architecture's replacement for the existing
 * InteractionContract concept in the enrichment modules.
 */
export interface BehavioralContract {
  /** Which action this contract applies to. */
  actionId: string;
  /** Contract type. */
  type: ContractType;
  /** Human-readable constraint description. */
  description: string;
  /** The constraint value (e.g., regex pattern, min/max values). */
  constraint: string;
  /** Source of this contract (DOM attribute, ARIA, observed). */
  source: ContractSource;
}

/**
 * Types of behavioral contracts.
 */
export type ContractType =
  | 'required'      // Field must be filled
  | 'pattern'       // Value must match a regex
  | 'minLength'     // Minimum character length
  | 'maxLength'     // Maximum character length
  | 'minValue'      // Minimum numeric value
  | 'maxValue'      // Maximum numeric value
  | 'step'          // Numeric step
  | 'acceptedTypes' // Accepted file types
  | 'readOnly'      // Field is read-only
  | 'custom';       // Custom observed constraint

/**
 * Where a contract was derived from.
 */
export type ContractSource = 'domAttribute' | 'ariaAttribute' | 'observed';

// ── Capability Assessment ────────────────────────────────────────────────

/**
 * A capability the application demonstrates during the recording.
 *
 * Capabilities are derived from the set of SemanticActions. They represent
 * what the application *can do* based on what the user exercised during
 * recording. This feeds into the test case description and coverage analysis.
 */
export interface CapabilityAssessment {
  /** Unique capability ID. */
  id: string;
  /** The capability name, e.g., "form-submission", "date-selection". */
  name: string;
  /** Which actions demonstrate this capability. */
  actionIds: string[];
  /** Interaction verbs involved in this capability. */
  verbs: InteractionVerb[];
  /** Component types involved in this capability. */
  componentTypes: ComponentType[];
  /** Human-readable description. */
  description: string;
}

// ── Coverage Assessment ──────────────────────────────────────────────────

/**
 * Coverage analysis for the recording.
 *
 * Assesses how thoroughly the recording covers the interactive elements
 * on the page(s) — i.e., which elements were interacted with vs. which
 * were available but not exercised.
 */
export interface CoverageAssessment {
  /** Total interactive elements detected on the page(s). */
  totalInteractiveElements: number;
  /** Elements that were interacted with during recording. */
  interactedElements: number;
  /** Coverage ratio [0, 1]. */
  coverage: number;
  /** Interactive elements that were NOT interacted with. */
  uncoveredElements: UncoveredElement[];
}

/**
 * An interactive element that was not exercised during recording.
 */
export interface UncoveredElement {
  /** Element identity. */
  identity: TargetElementIdentity;
  /** Why it was flagged as uncovered. */
  reason: string;
}

// ── Enriched Recording ───────────────────────────────────────────────────

/**
 * The recording after enrichment pipeline processing.
 *
 * This is the enriched output of the pipeline before final formatting
 * into a RecordingArtifact.
 */
export interface EnrichedRecording {
  /** Semantic actions with enrichment data. */
  actions: EnrichedAction[];
  /** Unrecognised interactions (passed through from recognition). */
  unrecognised: UnrecognisedInteraction[];
  /** Behavioral contracts for all actions. */
  contracts: BehavioralContract[];
  /** Capabilities demonstrated by the recording. */
  capabilities: CapabilityAssessment[];
  /** Coverage assessment. */
  coverage: CoverageAssessment;
  /** ISO timestamp of when enrichment completed. */
  enrichedAt: string;
}

/**
 * A SemanticAction enriched with contracts and capabilities.
 */
export interface EnrichedAction {
  /** The base semantic action. */
  action: SemanticAction;
  /** Contracts derived for this action. */
  contracts: BehavioralContract[];
  /** Capabilities this action contributes to. */
  capabilityIds: string[];
}

// ── Execution IR ─────────────────────────────────────────────────────────

/**
 * A single step in the Execution Intermediate Representation.
 *
 * The IR is a framework-agnostic representation of the recording that can
 * be lowered to Playwright, Cypress, Selenium, or other test frameworks.
 */
export interface IRStep {
  /** Unique step ID. */
  stepId: string;
  /** The semantic action this step represents. */
  actionId: string;
  /** The interaction verb. */
  verb: InteractionVerb;
  /** Human-readable description. */
  description: string;
  /** Locators for the target element, ordered by priority. */
  locators: {
    kind: string;
    value: string;
    confidence: number;
  }[];
  /** Value for the action, if applicable (fill text, select option, etc.). */
  value: string | null;
  /** Checked state for toggle actions. */
  checked: boolean | null;
  /** Frame context, if the element is in an iframe. */
  frame: { selector: string; depth: number } | null;
}

/**
 * A complete execution IR plan.
 */
export interface ExecutionIRPlan {
  /** Schema version. */
  schemaVersion: 1;
  /** All steps in execution order. */
  steps: IRStep[];
  /** Total number of steps. */
  stepCount: number;
  /** ISO timestamp of when the IR was generated. */
  generatedAt: string;
}

// ── Recording Artifact ───────────────────────────────────────────────────

/**
 * Recording metadata.
 */
export interface RecordingMetadata {
  /** ISO timestamp of when recording started. */
  startedAt: string;
  /** ISO timestamp of when recording stopped. */
  stoppedAt: string;
  /** Duration of the recording in milliseconds. */
  durationMs: number;
  /** URL of the page where recording started. */
  startUrl: string;
  /** Page title when recording started. */
  startTitle: string;
  /** Total number of DOM events captured. */
  totalEvents: number;
  /** Schema version of this artifact. */
  schemaVersion: 1;
}

/**
 * The final output of the entire recording pipeline.
 *
 * Contains everything: metadata, semantic actions, enrichment data,
 * execution IR, generated code, and diagnostic traces.
 *
 * This is the **RecordingArtifact** from the target pipeline — the
 * comprehensive deliverable that replaces the current scattered storage
 * (ReplayJson + DetectedInteractions + ExecutionIRPlan + GeneratedFiles).
 */
export interface RecordingArtifact {
  /** Unique recording ID. */
  recordingId: string;
  /** Recording metadata. */
  metadata: RecordingMetadata;
  /** Enriched semantic actions. */
  enrichedRecording: EnrichedRecording;
  /** Execution IR plan. */
  executionIR: ExecutionIRPlan;
  /** Generated test code (framework-dependent). */
  generatedCode: GeneratedCode[];
  /** Plain English narrative of the recording. */
  plainEnglishNarrative: string;
  /** Pipeline trace for debugging and review. */
  pipelineTrace: PipelineTrace;
}

/**
 * Generated test code in a specific framework.
 */
export interface GeneratedCode {
  /** Framework name, e.g., 'playwright'. */
  framework: string;
  /** The generated source code. */
  code: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
}

// ── Pipeline Trace ───────────────────────────────────────────────────────

/**
 * Trace of the entire pipeline execution for debugging.
 *
 * Records what happened at each stage, including timing, errors, and
 * non-fatal degradation.
 */
export interface PipelineTrace {
  /** Per-stage execution records. */
  stages: PipelineStageTrace[];
  /** Total pipeline duration in milliseconds. */
  totalDurationMs: number;
  /** Whether all stages succeeded. */
  allStagesSucceeded: boolean;
  /** Any warnings (non-fatal issues). */
  warnings: string[];
}

/**
 * Execution record for a single pipeline stage.
 */
export interface PipelineStageTrace {
  /** Stage name. */
  stage: string;
  /** ISO timestamp when the stage started. */
  startedAt: string;
  /** ISO timestamp when the stage completed. */
  completedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Whether the stage succeeded. */
  succeeded: boolean;
  /** Error message if the stage failed. */
  error: string | null;
  /** Stage-specific metrics. */
  metrics: Record<string, number>;
}
