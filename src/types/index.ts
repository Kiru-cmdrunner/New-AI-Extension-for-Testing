/**
 * Foundation Type System — Barrel Export
 *
 * Single import surface for all Phase 1 target architecture types.
 *
 * Usage:
 *   import type { EvidenceBatch, RecognitionResult, SemanticAction } from '@/types';
 *   import type { EvidenceBatch, RecognitionResult } from '../types';
 *
 * These types are PURE — no runtime values, no side effects.
 * They define the shape of the target architecture without implementing it.
 *
 * Existing types in shared/types.ts and shared/architecture-types.ts remain
 * unchanged. New code should import from here; existing code is untouched.
 */

// ── Foundation ──
export type {
  ChannelId,
  SignalType,
  TargetRecordingState,
  ComponentType,
  InteractionVerb,
  EvidenceRecord,
  PatternCondition,
  PatternOperator,
  PatternDefinition,
} from './foundation';

// ── Element & DOM Context ──
export type {
  LocatorKind,
  ResolvedLocator,
  FrameContext,
  TargetElementIdentity,
  TargetSurfaceType,
  SurfaceInfo,
  TargetDomContext,
  ValueTransitionInfo,
  CheckedTransitionInfo,
  DatePickerContext,
  FileUploadContext,
  DialogContext,
  NavigationContext,
} from './element';

// ── Evidence Pipeline ──
export type {
  BatchId,
  BatchStatus,
  EvidenceBatch,
} from './evidence';

// ── Recognition Pipeline ──
export type {
  InteractionId,
  UnrecognisedReason,
  RecognisedInteraction,
  PatternMatchTrace,
  UnrecognisedInteraction,
  ClosestPatternMatch,
  RecognitionResult,
  RecognitionOutput,
  RecognitionError,
} from './recognition';

// Runtime exports (type guards are functions, not types)
export {
  isRecognised,
  isUnrecognised,
} from './recognition';

// ── Lifecycle Engine ──
export type {
  LifecyclePhase,
  LifecycleConfig,
  LifecycleTransition,
  SemanticAction,
  LifecycleOutput,
  LifecycleError,
} from './lifecycle';

// ── Output & Enrichment ──
export type {
  BehavioralContract,
  ContractType,
  ContractSource,
  CapabilityAssessment,
  CoverageAssessment,
  UncoveredElement,
  EnrichedRecording,
  EnrichedAction,
  IRStep,
  ExecutionIRPlan,
  RecordingMetadata,
  RecordingArtifact,
  GeneratedCode,
  PipelineTrace,
  PipelineStageTrace,
} from './output';

// ── Pipeline Orchestration ──
export type {
  PipelineStageName,
  StageStatus,
  PipelineStageInput,
  PipelineStageResult,
  PipelineResult,
  StopPipelineTrace,
  StartRecordingOptions,
  StopRecordingOptions,
  ContentToSWMessage,
  SWToPanelMessage,
  PanelToSWMessage,
} from './pipeline';
