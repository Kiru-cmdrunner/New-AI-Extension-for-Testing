/**
 * IR Bridge Input — the encapsulated input model for the IR bridge.
 *
 * The IR bridge is the integration point where three recording outputs converge
 * into a single ExecutionIRPlan:
 *   - SessionEvent[] (mechanical execution record — locators, values, DOM context)
 *   - DetectedInteraction[] (classified interaction — type, metadata, confidence)
 *   - ApplicationKnowledgeFragment (semantic enrichment — assertions, business fields, workflow)
 *
 * Each input provides unique, non-overlapping data. See
 * docs/handover/14-target-generation-architecture.md for the full analysis.
 *
 * Design principle: IRBridgeInput is a stable interface. Future inputs
 * (e.g., EnvironmentProfile, TestData) can be added as optional fields
 * without breaking existing callers.
 */

import type { SessionEvent } from '../shared/types';
import type { DetectedInteraction } from '../classifier/interaction-types';
import type { ApplicationKnowledgeFragment } from '../domain/entities/application-knowledge';

/**
 * The recording context captured at session start.
 * Used to set IREnvironment (baseUrl, viewport) and test case metadata.
 */
export interface IRBridgeRecordingContext {
  /** The URL the recording started on. */
  readonly startUrl: string;
  /** The page title at recording start (for test case naming). */
  readonly title: string | null;
}

/**
 * Encapsulated input for the IR bridge's build() method.
 *
 * All fields are required — the bridge needs all three perspectives
 * to produce a complete ExecutionIRPlan. The fragment may be an empty
 * fragment (no components, no contracts) if enrichment was not run;
 * in that case the bridge produces steps without assertions or
 * business-field enrichment.
 */
export interface IRBridgeInput {
  /** Raw event timeline — provides locators, input values, DOM context. */
  readonly events: SessionEvent[];
  /** Classified interactions — provides type classification, metadata, confidence. */
  readonly interactions: DetectedInteraction[];
  /** Semantic enrichment — provides assertions, business field labels, workflow structure. */
  readonly fragment: ApplicationKnowledgeFragment | null;
  /** Recording context — start URL, title. */
  readonly recordingContext: IRBridgeRecordingContext;
  /** Test case name (for test file naming and report headers). */
  readonly testCaseName: string;
}
