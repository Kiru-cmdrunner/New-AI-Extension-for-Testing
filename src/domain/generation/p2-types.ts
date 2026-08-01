/**
 * P2 Type Definitions — types for capability-derived IR generation.
 *
 * P2 transforms an approved P2CapabilityContract into a disposable
 * ExecutionIRPlan without re-recording.
 *
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md
 */

import type { ExecutionIRPlan, IREnvironment } from '../execution-ir/types';
import type { P2CapabilityContract } from '../entities/p2-capability-contract';

// ── Input Types ──────────────────────────────────────────────

/**
 * Concrete test values keyed by DataRequirement.field.
 * Passed in by P3 (AI test generation) or by a caller specifying data manually.
 */
export type TestData = ReadonlyMap<string, string | number | boolean>;

/**
 * Input for P2 IR generation.
 */
export interface P2GenerationInput {
  /** Approved capability contract from P1 review. */
  readonly contract: P2CapabilityContract;
  /** Concrete test data for this variant. */
  readonly testData: TestData;
  /** Project ID for Element Repository scoping. */
  readonly projectId: string;
  /** Execution environment (base URL, browser, viewport). */
  readonly environment: IREnvironment;
  /** Optional label for this data variant (e.g., "boundary-min"). */
  readonly variantLabel?: string;
}

// ── Warning Types ────────────────────────────────────────────

/**
 * Reason why a field or target could not be resolved.
 */
export type ResolutionReason =
  | 'ambiguous'                 // Multiple plausible Elements, margin < MIN_MARGIN
  | 'unmatched'                 // No Element above MATCH_THRESHOLD
  | 'no-session-element'        // No UiElementSummary matching the field
  | 'no-logical-action'         // No LogicalAction with matching businessField
  | 'missing-source-session'    // sourceSessionId is null/empty
  | 'session-not-found'         // Session not in repository
  | 'no-originating-interaction' // elementId not in rawInteractions or rawEvents
  | 'missing-required'          // Required test data value missing
  | 'invalid-value';            // Test data value fails constraint

/**
 * A warning about an unresolved field, target, or data issue.
 */
export interface ResolutionWarning {
  /** The field this warning applies to. */
  readonly field: string;
  /** Why resolution failed. */
  readonly reason: ResolutionReason;
  /** Human-readable explanation. */
  readonly message: string;
  /** For ambiguous: candidate Elements that tied. */
  readonly candidates?: ReadonlyArray<{ elementId: string; matchScore: number }>;
}

/**
 * Warning about a data value issue.
 */
export interface DataWarning {
  readonly field: string;
  readonly reason: 'missing-required' | 'invalid-value';
  readonly message: string;
}

/**
 * Warning about a field binding issue.
 */
export interface BindingWarning {
  readonly field: string;
  readonly reason: 'no-logical-action' | 'no-session-element';
  readonly message: string;
}

// ── Result Types ─────────────────────────────────────────────

/**
 * Result of P2 IR generation.
 */
export interface CapabilityIRResult {
  /** The generated execution IR plan. */
  readonly plan: ExecutionIRPlan;
  /** Warnings about unresolved targets, data issues, etc. */
  readonly warnings: ResolutionWarning[];
  /** True if any target in the plan is NoTarget. */
  readonly hasUnresolvedTargets: boolean;
  /** Fields that were successfully resolved to Elements. */
  readonly resolvedFields: ReadonlyArray<{
    field: string;
    elementId: string;
    matchScore: number;
  }>;
}

/**
 * Binding result: maps a DataRequirement.field to a session element.
 */
export interface FieldBinding {
  readonly field: string;
  readonly sessionElementId: string | null;
  readonly summary: import('../entities/application-knowledge').UiElementSummary | null;
  readonly resolutionMethod: 'logical-action' | 'accessible-name' | 'none';
}

/**
 * Target resolution result for a single field.
 */
export interface ResolvedTargetEntry {
  readonly field: string;
  readonly target: import('../execution-ir/types').ResolvedTarget;
  readonly matchScore: number | null;
  readonly warning: ResolutionWarning | null;
}
