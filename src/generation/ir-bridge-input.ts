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
import type { DetectedInteraction } from '../shared/bridge-types';
import type { UnderstandingResult } from '../domain/entities/understanding-result';

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
 * The IR Bridge consumes the UnderstandingResult — the aggregate output of
 * the Understanding Layer — as its input boundary. The fragment within
 * provides assertions, business field labels, and workflow structure.
 * The capability is available for future use (test naming, metadata) but
 * is not required for IR plan generation.
 *
 * Design principle: IRBridgeInput is a stable interface. Future inputs
 * (e.g., EnvironmentProfile, TestData) can be added as optional fields
 * without breaking existing callers.
 */
export interface IRBridgeInput {
  /** Raw event timeline — provides locators, input values, DOM context. */
  readonly events: SessionEvent[];
  /** Classified interactions — provides type classification, metadata, confidence. */
  readonly interactions: DetectedInteraction[];
  /**
   * Understanding Layer output — contains the fragment (structural understanding)
   * and capability (semantic understanding). The bridge reads fragment for
   * assertions, business field labels, and workflow structure. Null if the
   * Understanding Layer failed entirely.
   */
  readonly understanding: UnderstandingResult | null;
  /** Recording context — start URL, title. */
  readonly recordingContext: IRBridgeRecordingContext;
  /** Test case name (for test file naming and report headers). */
  readonly testCaseName: string;
}
