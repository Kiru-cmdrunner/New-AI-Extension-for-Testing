/**
 * Architecture-compliant data model types.
 *
 * Defines the shared objects specified in Phase 2 Engineering Specifications
 * (§2–§6) that were not yet present in the codebase. Existing types from
 * shared/types.ts and generation/contracts/execution-json-types.ts are
 * referenced — not duplicated — where they already satisfy the spec.
 *
 * Organization: one section per architectural layer, matching the Phase 2
 * spec object numbering (R=Recording, C=Context, I=Intelligence,
 * E=Execution, V=Review, F=Infrastructure).
 *
 * Phase 3 Task 3: addresses G13/G5/G6/G7.
 */

import type {
  SessionEvent,
  ElementIdentity,
  ScreenshotMetadata,
  AIUnderstanding,
} from './types';
import type { ExecutionJsonObject } from '../generation/contracts/execution-json-types';

// ── Recording Layer (R1–R7) ────────────────────────────────
//
// R1 BrowserEvent, R2 RawElementIdentity, R3 ElementIdentity, R4 SessionEvent,
// R5 ScreenshotMetadata, R6 RecordingContext, R7 RecorderActionInfo
// → All already defined in shared/types.ts. No new types needed.

// ── Context Layer (C1–C5) ──────────────────────────────────

/**
 * Descriptor for a DOM element referenced in the deterministic state.
 * Lightweight — just enough for AI snapshot and classifier context.
 */
export interface ElementDescriptor {
  tag: string;
  role: string | null;
  accessibleName: string;
  className: string | null;
}

/**
 * C2: DeterministicState — Layer 1 of Session Context.
 *
 * Owned exclusively by the State Tracker. Transient (in-memory only).
 * Updated on each DOM mutation via MutationObserver.
 *
 * Frozen by: E2E Architecture §GAP-4, AI Observer Architecture #3.
 */
export interface DeterministicState {
  currentUrl: string;
  pageTitle: string;
  openDialogs: ElementDescriptor[];
  openDropdowns: ElementDescriptor[];
  activeForm: ElementDescriptor | null;
  activeElement: ElementDescriptor | null;
}

/**
 * A single hypothesis with alternatives.
 *
 * Used by MentalModel (L2) for appIdentity, currentFocus, userIntent.
 *
 * P4: max 3 competing hypotheses (enforced by AI Observer).
 * P5: confidence clamped to [0.05, 0.95].
 * P6: evidence must cite action IDs.
 */
export interface Hypothesis {
  /** Best guess. */
  primary: string;
  /** Confidence in primary (0.05–0.95 per P5 bounds). */
  confidence: number;
  /** Action IDs supporting this hypothesis (P6 evidence citation). */
  evidence: string[];
  /** Competing hypotheses (max 3 per P4). */
  alternatives: { value: string; confidence: number }[];
}

/**
 * I6: WorkflowHypothesis — used as the workflow sub-domain of MentalModel.
 *
 * Owned by AI Observer. Tracks workflow progression.
 */
export interface WorkflowHypothesis {
  /** Workflow type, e.g. "login", "checkout", "data-entry", "unknown". */
  workflowType: string;
  /** Position in workflow (1-based). */
  currentStep: number;
  /** Total steps if known, null if unknown. */
  totalSteps: number | null;
  /** Advisory prediction of the next action. Null if no prediction. */
  expectedNextAction: string | null;
  /** Confidence in this workflow assessment (0.05–0.95). */
  confidence: number;
}

/**
 * ChangeAnalysis hypothesis — sub-domain tracking what changed after
 * the last interaction.
 */
export interface ChangeAnalysis {
  /** What changed, e.g. "page-navigation", "form-submitted", "dialog-opened". */
  changeType: string;
  /** Human-readable description of the change. */
  description: string;
  /** Confidence in this assessment (0.05–0.95). */
  confidence: number;
  /** Whether the change matches the expected behaviour (sub-domain of change). */
  matchesExpected: boolean;
}

/**
 * I5: ConfidenceState — 5-track weighted confidence model.
 *
 * Owned by Confidence Engine. Stored in MentalModel (L2).
 * Weights frozen by AI Philosophy P5: intent=0.35, workflow=0.25,
 * appFocus=0.15, uiFocus=0.15, change=0.10.
 * Ceiling 0.95, floor 0.05.
 */
export interface ConfidenceState {
  intent: number;
  workflow: number;
  appFocus: number;
  uiFocus: number;
  change: number;
  /** Weighted composite across all tracks. */
  composite: number;
}

/**
 * C3: MentalModel — Layer 2 of Session Context.
 *
 * Sole writer = AI Observer. Transient. Advisory only.
 * Consumed by Stage 3a (advisory input for ambiguous classification) and
 * Stage 3b (naming/readability). Discarded after STOP_RECORDING.
 *
 * Frozen by: AI Observer Architecture #1–14, AI Philosophy P1–P8.
 */
export interface MentalModel {
  appIdentity: Hypothesis | null;
  workflow: WorkflowHypothesis | null;
  currentFocus: Hypothesis | null;
  userIntent: Hypothesis | null;
  recentChange: ChangeAnalysis | null;
  confidence: ConfidenceState;
  /** ISO timestamp of last AI update. */
  lastUpdated: string;
}

/**
 * C4: ContextUpdate — delta notification when a Session Context layer changes.
 *
 * Produced by whichever component wrote to the layer.
 * Consumed by anyone subscribed to context changes.
 */
export interface ContextUpdate {
  /** Which layer changed. */
  layer: 'L1' | 'L2' | 'L3';
  /** Type of change. */
  changeType: 'create' | 'update' | 'append';
  /** ISO timestamp of the change. */
  timestamp: string;
}

/**
 * C1: SessionContext — the 3-layer container for all recording-session state.
 *
 * Container = Session Context Manager. Each layer has its own sole writer.
 * L1 and L2 are transient (in-memory only). L3 persists as the Timeline.
 * Readers receive deep copies — cannot mutate originals.
 *
 * Frozen by: E2E Architecture §GAP-1, AI Observer Architecture #2–3.
 */
export interface SessionContext {
  /** L1 — Deterministic State (written by State Tracker). */
  layer1: DeterministicState;
  /** L2 — Mental Model (written by AI Observer). Null when AI is unavailable. */
  layer2: MentalModel | null;
  /** L3 — Action History / Timeline (written by Event Pipeline). Immutable once appended. */
  layer3: SessionEvent[];
}

// ── Intelligence Layer (I1–I7) ─────────────────────────────

/**
 * I1: ActionElementInfo — same as R7 RecorderActionInfo.
 * Already defined in shared/types.ts as the semantic snapshot for AI.
 */

/**
 * The 10 canonical interaction types from the Semantic Interaction Language.
 * Frozen by L1 (Semantic Interaction Language Design).
 */
export type CanonicalType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'toggle'
  | 'selectDate'
  | 'hover'
  | 'pressKey'
  | 'upload'
  | 'drag';

/**
 * I3: ClassifiedInteraction — a Timeline action classified into one of the
 * 10 canonical types by Stage 3a.
 *
 * Writer = Stage 3a Classifier. Immutable after assignment (L6).
 * Every action gets exactly one canonicalType (L5 default click).
 *
 * Frozen by: Semantic Interaction Language L1–L14, E2E Architecture §GAP-1.
 */
export interface ClassifiedInteraction {
  /** The canonical type assigned by Stage 3a. */
  canonicalType: CanonicalType;
  /** References the source SessionEvent. */
  actionId: string;
  /** The raw event being classified. */
  originalEvent: SessionEvent;
  /** Which tier made the decision: 1=deterministic, 2=advisory AI, 3=default. */
  classificationTier: 1 | 2 | 3;
  /** Structured classification evidence trail for debugging and review. */
  evidence: ClassificationEvidence;
}

/**
 * I7a: SemanticInteraction — the canonical interaction object that carries
 * semantic type and execution metadata.
 *
 * Derived from a CanonicalStep (Stage 3b output) by extracting the canonicalType
 * and execution-relevant fields. Consumed by the Execution JSON Generator (Stage 4)
 * to look up the execution verb via the frozen verb-mapping-table.
 *
 * Phase 3 Integration Step 2.
 */
export interface SemanticInteraction {
  /** Canonical interaction type from the Semantic Interaction Language. */
  canonicalType: CanonicalType;
  /** Links back to the source SessionEvent. */
  actionId: string;
  /** Links back to the CanonicalStep. */
  stepId: string;
  /** Value for fill/select/selectDate/navigate. Null for click/toggle/hover. */
  value: string | null;
  /** Checked state for toggle. Null for all other types. */
  checked: boolean | null;
}

/**
 * I4: ClassificationEvidence — structured evidence trail for classification.
 *
 * Supports debugging and review. Each rule match produces one entry.
 */
export interface ClassificationEvidence {
  /** Rule identifier from the 14-rule priority list. */
  ruleId: string;
  /** Human-readable rule description. */
  ruleDescription: string;
  /** Signals that matched to trigger this rule. */
  matchedSignals: string[];
  /** Which tier this rule belongs to. */
  tier: 1 | 2 | 3;
}

/**
 * I7: CanonicalStep — the step after Stage 3b but before Stage 4 populates
 * executionJson. Human-readable artifact with optional machine-executable JSON.
 *
 * Note: A similar interface already exists in generation/types.ts with
 * `elementId: string` (not nullable). The spec's version allows null for
 * navigation steps. The generation/types.ts version is the implementation
 * used by existing code; this spec-compliant version is for the future
 * Stage 3a→3b pipeline. They will converge when Stage 3a is implemented.
 *
 * Fields match Phase 2 §I7 exactly.
 */
export interface SpecCanonicalStep {
  stepId: string;
  plainEnglish: string;
  actionId: string;
  elementId: string | null;
  aiConfidence: number;
  timestamp: string;
  /** Machine-executable JSON — null until Stage 4 populates it. */
  executionJson: ExecutionJsonObject | null;
}

// I2 AIUnderstanding — already defined in shared/types.ts.
// I5 ConfidenceState — defined above in Context Layer section.
// I6 WorkflowHypothesis — defined above in Context Layer section.

// ── Execution Layer (E1–E9) ────────────────────────────────
//
// E1–E7: Already defined in generation/contracts/execution-json-types.ts
//        (frozen B5.2 six-section contract).
// E8 TestStep: Already defined in shared/types.ts (though the spec version
//        uses elementId: string | null and ExecutionJsonObject | null for
//        executionJson — the convergence is deferred to Stage 3a implementation).
// E9 GenerationResult: Already defined in generation/types.ts as GeneratorResult.

/**
 * E9: GenerationResult — alias for the existing GeneratorResult type.
 *
 * Already implemented in generation/types.ts. Documented here for completeness.
 * Fields: success, steps, playwrightCode (nullable), errors.
 */

// ── Review Layer (V1–V3) ───────────────────────────────────

import type { TestStep } from './types';

/**
 * V1: ReviewItem — a step in the review queue.
 *
 * Writer = Review Engine. Consumer = Review UI, Approval Manager.
 */
export interface ReviewItem {
  /** Which step this review item covers. */
  stepId: string;
  /** Review state. */
  status: 'pending' | 'approved' | 'edited' | 'rejected';
  /** Pre-review snapshot (immutable copy). */
  originalStep: TestStep;
  /** If edited, the modified version. Null if not edited. */
  editedStep: TestStep | null;
  /** Reviewer comments. Optional. */
  reviewNotes?: string | null;
}

/**
 * V2: ValidationResult — outcome of validating a step's execution JSON.
 *
 * Writer = Validation Engine. Consumer = Review Engine.
 */
export interface ValidationResult {
  /** Which step was validated. */
  stepId: string;
  /** Whether the step passed validation. */
  passed: boolean;
  /** Validation errors (empty if passed). */
  errors: string[];
  /** Validation warnings (non-fatal issues). */
  warnings: string[];
}

/**
 * V3: EvidenceBundle — all evidence for a single interaction.
 *
 * Used by the Review Engine to provide full context for each step.
 */
export interface EvidenceBundle {
  /** The action this evidence covers. */
  actionId: string;
  /** Screenshot at the time of the action. */
  screenshot: ScreenshotMetadata | null;
  /** Element identity extracted at capture time. */
  elementIdentity: ElementIdentity | null;
  /** Classification evidence from Stage 3a. */
  classificationEvidence: ClassificationEvidence | null;
  /** AI understanding at the time of the action. */
  aiUnderstanding: AIUnderstanding | null;
}

// V4 RepositoryTestCase — already defined in shared/types.ts.

// ── Infrastructure Layer (F1–F8) ───────────────────────────
//
// F1 UIState, F2 TestCaseDraft, F3 AIConfig, F4 ProviderSettings,
// F8 TestRepository → already defined in shared/types.ts.

/**
 * F5: AuditEvent — an immutable record of a significant system action.
 *
 * Writer = any component (via Audit Manager). Consumer = Audit trail.
 * Immutable once written. Append-only log.
 */
export interface AuditEvent {
  /** Event type, e.g. "recording-started", "step-generated", "test-saved". */
  type: string;
  /** ISO timestamp. */
  timestamp: string;
  /** ID of the entity involved (session ID, step ID, etc.). */
  entityId: string;
  /** Additional structured details about the event. */
  details: Record<string, unknown>;
}

/**
 * F6: LogEntry — a structured log record.
 *
 * Writer = any component (via Logging Manager). Consumer = debug logs.
 * Level-prioritized for filtering.
 */
export interface LogEntry {
  /** Log severity level. */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Component category, e.g. "recorder", "generation", "ai". */
  category: string;
  /** Human-readable message. */
  message: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Additional structured data. Optional. */
  data?: Record<string, unknown>;
}

/**
 * F7: ErrorObject — a structured error for the error handling pipeline.
 *
 * Writer = any component that catches an error. Consumer = error handler,
 * Logging Manager, user notification.
 */
export interface ErrorObject {
  /** Error code, e.g. "AI_TIMEOUT", "LOCATOR_RESOLUTION_FAILED". */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Which component produced the error. */
  component: string;
  /** Whether the error is recoverable (retry or fallback possible). */
  recoverable: boolean;
  /** Additional context. Optional. */
  context?: Record<string, unknown>;
}
