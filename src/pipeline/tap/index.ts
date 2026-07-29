/**
 * EventTap + Delivery — Barrel Export (Phase 3)
 */

export { resolveTarget, NON_INTERACTIVE_TAGS, INTERACTIVE_SELECTOR } from './target-resolver';

export {
  extractTargetIdentity,
  captureValue,
  captureCheckedState,
  extractFrameContext,
  isInShadowDom,
  extractAncestorChain,
} from './identity-extractor';

export { captureValueSnapshot, type ValueSnapshot } from './value-tracker';

export { assembleBatch, nextBatchId, resetBatchCounter, type BatchAssemblyInput } from './batch-assembler';

export {
  deliverBatch,
  flushPendingBatches,
  clearBuffer,
  isRecordingActive,
  setRecordingActive,
  getBufferedCount,
  installPageLifecycleHandlers,
  EVIDENCE_BATCH_MESSAGE_TYPE,
} from './delivery-coordinator';

export {
  createEventTap,
  processEvent,
  startRecording,
  stopRecording,
  shouldAutoResume,
  TEST_HOOK,
  type EventTapConfig,
  type EventTapHandle,
} from './event-tap';
