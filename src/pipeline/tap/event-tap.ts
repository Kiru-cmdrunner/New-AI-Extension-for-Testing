/**
 * Event Tap — Phase 3
 *
 * The orchestrator that ties together all Phase 3 modules:
 *
 *   DOM Event
 *     → resolveTarget()          [target-resolver.ts]
 *     → extractTargetIdentity()  [identity-extractor.ts]
 *     → captureValueSnapshot()   [value-tracker.ts]
 *     → collectAllEvidence()     [channels/index.ts]
 *     → assembleBatch()          [batch-assembler.ts]
 *     → deliverBatch()           [delivery-coordinator.ts]
 *
 * The EventTap is NOT wired into the content script yet. It coexists
 * alongside the existing deterministic-recorder.ts. Wiring happens in
 * a later phase when we switch the content script.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch } from '../../types/evidence';
import type { ChannelCollectInput } from '../channels/evidence-channel';
import { resolveTarget } from './target-resolver';
import { extractTargetIdentity } from './identity-extractor';
import { captureValueSnapshot } from './value-tracker';
import { assembleBatch, nextBatchId, type BatchAssemblyInput } from './batch-assembler';
import { collectAllEvidence } from '../channels';
import {
  deliverBatch,
  flushPendingBatches,
  clearBuffer,
  setRecordingActive,
  isRecordingActive,
  installPageLifecycleHandlers,
} from './delivery-coordinator';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Configuration for the EventTap.
 */
export interface EventTapConfig {
  /** Called when a batch is assembled and ready for delivery. */
  onBatch?: (batch: EvidenceBatch) => void;
  /** Whether to deliver batches to the SW (default: true). */
  deliverToSW?: boolean;
  /** Event types to capture. Defaults to all supported types. */
  eventTypes?: string[];
}

/**
 * Handle for controlling the EventTap.
 */
export interface EventTapHandle {
  /** Stop capturing events and remove all listeners. */
  stop(): void;
  /** Check if the tap is active. */
  isActive(): boolean;
}

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_EVENT_TYPES = [
  'click', 'mousedown', 'contextmenu',
  'focus', 'blur',
  'input', 'change',
  'mouseenter', 'mouseleave', 'mousemove',
  'keydown',
  'scroll',
];

const SCROLL_MIN_INTERVAL_MS = 16;
const MOUSEMOVE_MIN_INTERVAL_MS = 50;

/**
 * Test-only flag to bypass isTrusted check (JSDOM doesn't set isTrusted).
 */
export const TEST_HOOK = { forceTrusted: false };

// ── Event ID Generation ──────────────────────────────────────────────────

let eventCounter = 0;
const pageId = `p${Date.now().toString(36)}`;

function nextEventId(): string {
  eventCounter++;
  return `evt-${pageId}-${eventCounter}`;
}

// ── Throttling State ─────────────────────────────────────────────────────

let lastScrollTime = 0;
let lastMousemoveTime = 0;

function shouldThrottle(eventType: string, timestamp: number): boolean {
  if (eventType === 'scroll') {
    if (timestamp - lastScrollTime < SCROLL_MIN_INTERVAL_MS) return true;
    lastScrollTime = timestamp;
    return false;
  }
  if (eventType === 'mousemove') {
    if (timestamp - lastMousemoveTime < MOUSEMOVE_MIN_INTERVAL_MS) return true;
    lastMousemoveTime = timestamp;
    return false;
  }
  return false;
}

// ── Core Event Processing ────────────────────────────────────────────────

/**
 * Process a single raw DOM event into an EvidenceBatch.
 *
 * This is the core pipeline:
 * 1. Resolve target element
 * 2. Extract target identity
 * 3. Capture value snapshot
 * 4. Collect evidence from all channels
 * 5. Assemble EvidenceBatch
 *
 * Returns null if the event should be skipped (untrusted, no target, throttled).
 */
export function processEvent(
  rawEvent: Event | null | undefined,
  config?: { pageUrl?: string },
): EvidenceBatch | null {
  if (!rawEvent) return null;

  const eventType = rawEvent.type;

  // 1. Skip untrusted events (unless test hook is active)
  if (!TEST_HOOK.forceTrusted && !rawEvent.isTrusted) return null;

  // 2. Apply throttling
  const now = Date.now();
  if (shouldThrottle(eventType, now)) return null;

  // 3. Resolve target element
  const targetEl = resolveTarget(rawEvent);
  if (!targetEl) return null;

  // 4. Extract target identity
  const target = extractTargetIdentity(targetEl);

  // 5. Capture value snapshot
  const snapshot = captureValueSnapshot(targetEl, eventType);

  // 6. Collect evidence from all channels
  const channelInput: ChannelCollectInput = {
    target: targetEl,
    event: rawEvent,
    eventType,
    timestamp: new Date().toISOString(),
    pageUrl: config?.pageUrl ?? window.location.href,
    inShadowDom: target.inShadowDom,
    inIframe: target.inIframe,
    valueBefore: snapshot.valueBefore,
    valueAfter: snapshot.valueAfter,
    checkedBefore: snapshot.checkedBefore,
    checkedAfter: snapshot.checkedAfter,
  };
  const evidence = collectAllEvidence(channelInput);

  // 7. Assemble EvidenceBatch
  const batchId = nextBatchId();
  const assemblyInput: BatchAssemblyInput = {
    batchId,
    timestamp: channelInput.timestamp,
    target,
    eventType,
    evidence,
    pageUrl: channelInput.pageUrl,
    inShadowDom: target.inShadowDom,
    inIframe: target.inIframe,
    valueBefore: snapshot.valueBefore,
    valueAfter: snapshot.valueAfter,
    checkedBefore: snapshot.checkedBefore,
    checkedAfter: snapshot.checkedAfter,
  };
  const batch = assembleBatch(assemblyInput);

  // Override batch id with our event-id scheme for traceability
  batch.id = nextEventId();

  return batch;
}

// ── EventTap Factory ─────────────────────────────────────────────────────

/**
 * Create and install an EventTap on the document.
 *
 * Registers capture-phase passive listeners for all configured event types.
 * Returns a handle for stopping the tap.
 *
 * Usage:
 *   const handle = createEventTap({ onBatch: deliverBatch });
 *   // ... recording ...
 *   handle.stop();
 */
export function createEventTap(config: EventTapConfig = {}): EventTapHandle {
  const eventTypes = config.eventTypes ?? DEFAULT_EVENT_TYPES;
  const deliver = config.deliverToSW !== false;
  let active = true;

  /**
   * Raw event handler — processes each event through the pipeline.
   */
  function handleRawEvent(rawEvent: Event): void {
    if (!active) return;

    const batch = processEvent(rawEvent);
    if (!batch) return;

    // Call the onBatch callback (for testing or custom delivery)
    config.onBatch?.(batch);

    // Deliver to SW via the delivery coordinator
    if (deliver) {
      deliverBatch(batch);
    }
  }

  // Register listeners on capture phase (before page scripts)
  const listenerOptions: AddEventListenerOptions = {
    capture: true,
    passive: true,
  };

  for (const eventType of eventTypes) {
    document.addEventListener(eventType, handleRawEvent, listenerOptions);
  }

  return {
    stop() {
      if (!active) return;
      active = false;
      for (const eventType of eventTypes) {
        document.removeEventListener(eventType, handleRawEvent, listenerOptions);
      }
    },
    isActive() {
      return active;
    },
  };
}

// ── Recording Lifecycle ──────────────────────────────────────────────────

/**
 * Start recording: install event tap + page lifecycle handlers.
 */
export async function startRecording(config?: EventTapConfig): Promise<EventTapHandle> {
  setRecordingActive(true);

  // Flush any stale events from a previous session
  await flushPendingBatches();

  // Install page lifecycle handlers
  let tapHandle: EventTapHandle | null = null;
  installPageLifecycleHandlers(() => {
    // On pageshow resume: re-install the tap if recording was active
    if (tapHandle && !tapHandle.isActive()) {
      tapHandle = createEventTap(config);
    }
  });

  // Install the event tap
  tapHandle = createEventTap(config);
  return tapHandle;
}

/**
 * Stop recording: remove event tap + final flush + clear buffer.
 */
export async function stopRecording(handle: EventTapHandle): Promise<void> {
  handle.stop();
  setRecordingActive(false);

  // Final flush attempt
  await flushPendingBatches();

  // Clear the buffer so stale events don't reappear in next session
  clearBuffer();
}

// ── Auto-resume Check ────────────────────────────────────────────────────

/**
 * Check if recording was active and resume if so.
 * Called on script injection to handle MV3 re-injection.
 */
export function shouldAutoResume(): boolean {
  return isRecordingActive();
}
