/**
 * Pipeline Orchestration Types — Phase 1
 *
 * Types for the pipeline orchestrator — the component that runs the STOP
 * pipeline stages in sequence, handles errors non-fatally, and assembles
 * the final RecordingArtifact.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch } from './evidence';
import type { RecognitionOutput } from './recognition';
import type { LifecycleOutput } from './lifecycle';
import type { EnrichedRecording, RecordingArtifact, PipelineTrace } from './output';

// ── Pipeline Stages ──────────────────────────────────────────────────────

/**
 * The stages of the STOP pipeline, executed in order on STOP_RECORDING.
 *
 * Each stage is non-fatal: if it fails, the pipeline logs the error and
 * continues to the next stage with degraded output. The recording always
 * completes.
 */
export type PipelineStageName =
  | 'event_grouping'    // Group related evidence batches into interaction candidates
  | 'recognition'       // Match candidates against declarative patterns
  | 'lifecycle'         // Group recognised interactions into SemanticActions
  | 'enrichment'        // Add contracts, capabilities, coverage
  | 'output';           // Assemble RecordingArtifact + generate code

/**
 * The status of a pipeline stage execution.
 */
export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Input to a pipeline stage.
 *
 * Pipeline stages are chained: each stage's output becomes part of the
 * accumulated PipelineResult, which the next stage reads.
 */
export interface PipelineStageInput {
  /** All evidence batches captured during recording. */
  batches: EvidenceBatch[];
  /** Output from the recognition stage, if completed. */
  recognition: RecognitionOutput | null;
  /** Output from the lifecycle stage, if completed. */
  lifecycle: LifecycleOutput | null;
  /** Output from the enrichment stage, if completed. */
  enrichment: EnrichedRecording | null;
}

/**
 * Result of a pipeline stage execution.
 */
export interface PipelineStageResult {
  /** The stage that produced this result. */
  stage: PipelineStageName;
  /** Execution status. */
  status: StageStatus;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Error message if the stage failed. */
  error: string | null;
  /** Stage-specific metrics. */
  metrics: Record<string, number>;
}

// ── Pipeline Result ──────────────────────────────────────────────────────

/**
 * Accumulated result of the entire pipeline execution.
 *
 * Carries the outputs of each stage. Stages that haven't run yet have
 * null values. The output stage reads everything and produces the
 * final RecordingArtifact.
 */
export interface PipelineResult {
  /** Input batches consumed by the pipeline. */
  batches: EvidenceBatch[];
  /** Recognition stage output. */
  recognition: RecognitionOutput | null;
  /** Lifecycle stage output. */
  lifecycle: LifecycleOutput | null;
  /** Enrichment stage output. */
  enrichment: EnrichedRecording | null;
  /** Final recording artifact. */
  artifact: RecordingArtifact | null;
  /** Per-stage execution results. */
  stageResults: PipelineStageResult[];
  /** Total pipeline duration in milliseconds. */
  totalDurationMs: number;
  /** Whether all stages succeeded. */
  allStagesSucceeded: boolean;
  /** Pipeline trace for debugging. */
  trace: PipelineTrace;
}

// ── STOP Pipeline Trace (convenience alias) ──────────────────────────────

/**
 * Convenience alias for the pipeline trace returned with PipelineResult.
 *
 * This is the same type as PipelineTrace in output.ts — re-exported here
 * for the pipeline context.
 */
export type StopPipelineTrace = PipelineTrace;

// ── Session Management Types ─────────────────────────────────────────────

/**
 * Options for starting a recording session.
 */
export interface StartRecordingOptions {
  /** Tab ID to record. */
  tabId: number;
  /** Initial URL of the page. */
  startUrl: string;
  /** Initial page title. */
  startTitle: string;
}

/**
 * Options for stopping a recording session.
 */
export interface StopRecordingOptions {
  /** Whether to run the full STOP pipeline (default: true). */
  runPipeline: boolean;
  /** Whether to generate code immediately (default: true). */
  generateCode: boolean;
}

// ── Messaging Types (target architecture) ────────────────────────────────

/**
 * Messages sent from the content script to the service worker.
 *
 * These are the target architecture's typed message types. They coexist
 * with the existing AppMessage union in shared/types.ts.
 */
export type ContentToSWMessage =
  | { type: 'EVIDENCE_BATCH_DELIVERED'; batch: EvidenceBatch }
  | { type: 'PING'; tabId: number; alive: boolean; url: string }
  | { type: 'CONTENT_SCRIPT_READY'; tabId: number; url: string };

/**
 * Messages sent from the service worker to the side panel.
 */
export type SWToPanelMessage =
  | { type: 'BATCH_BUFFERED'; count: number }
  | { type: 'PIPELINE_STARTED'; batchCount: number }
  | {
      type: 'PIPELINE_PROGRESS';
      stage: PipelineStageName;
      status: StageStatus;
      metrics: Record<string, number>;
    }
  | { type: 'PIPELINE_COMPLETE'; result: PipelineResult }
  | { type: 'PIPELINE_ERROR'; stage: PipelineStageName; error: string };

/**
 * Messages sent from the side panel to the service worker.
 */
export type PanelToSWMessage =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'REQUEST_STATUS' }
  | { type: 'REQUEST_PIPELINE_RESULT' };
