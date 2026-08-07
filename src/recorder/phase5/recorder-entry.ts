/**
 * Recorder Entry — Content Script Entry Point
 *
 * This is the bridge between the page DOM and the MV3 service worker.
 * It:
 * 1. Installs an EventTap on the page.
 * 2. Buffers events in sessionStorage for MV3 resilience.
 * 3. Forwards events to the service worker (chrome.runtime.sendMessage).
 * 4. Retries failed deliveries with exponential backoff.
 * 5. Clears the buffer on explicit stopRecording.
 *
 * Architecture: `.drytis/specs/m00a-architecture-validation.md` §2.2 Stage 1
 * Principle: AP1 (Separation of evidence and classification), AP2 (Graceful degradation)
 *
 * MV3 Reality:
 * - The service worker is killed when no message is received for ~30s.
 * - The content script lives as long as the page is loaded.
 * - So: buffer events in sessionStorage, retry on failure, clear on stop.
 */

import type { ObservedEvent } from '../../shared/component-types';
import { createEventTap, type EventTapHandle } from '../../tap/event-tap';
import { ElementStateCache } from '../../tap/element-state-cache';
import { DocumentObserver } from '../../tap/document-observer';
import { ObservationCoordinator } from '../../tap/observation-coordinator';
import { setupStateCacheListeners } from '../../tap/state-cache-listeners';
import type { ObservationResult } from '../../shared/observation-types';

// ── Session Storage Keys ─────────────────────────────────────────────

const BUFFER_KEY = 'cmdrunner_event_buffer';
const RECORDING_KEY = 'cmdrunner_is_recording';

// ── Session Storage Buffer ───────────────────────────────────────────

const MAX_BUFFER_SIZE = 500;

/**
 * Push an event to the sessionStorage buffer.
 */
function pushToBuffer(event: ObservedEvent): void {
  try {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    const buffer: ObservedEvent[] = raw ? JSON.parse(raw) : [];
    buffer.push(event);
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.shift(); // drop oldest if over capacity
    }
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    // sessionStorage may be full or unavailable — silent degrade
  }
}

/**
 * Remove an event from the buffer by eventId.
 */
function removeFromBuffer(eventId: string): void {
  try {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    if (!raw) return;
    const buffer: ObservedEvent[] = JSON.parse(raw);
    const filtered = buffer.filter((e) => e.eventId !== eventId);
    sessionStorage.setItem(BUFFER_KEY, JSON.stringify(filtered));
  } catch {
    // silent degrade
  }
}

/**
 * Peek the buffer (non-destructive read).
 */
function peekBuffer(): ObservedEvent[] {
  try {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    return raw ? (JSON.parse(raw) as ObservedEvent[]) : [];
  } catch {
    return [];
  }
}

/**
 * Clear the entire buffer.
 */
function clearBuffer(): void {
  try {
    sessionStorage.removeItem(BUFFER_KEY);
  } catch {
    // silent degrade
  }
}

// ── Behavioral Buffer (Phase D) ──────────────────────────────────────

const BEHAVIORAL_BUFFER_KEY = 'cmdrunner_behavioral_buffer';
const MAX_BEHAVIORAL_BUFFER = 200;

function pushToBehavioralBuffer(result: ObservationResult): void {
  try {
    const raw = sessionStorage.getItem(BEHAVIORAL_BUFFER_KEY);
    const buffer: ObservationResult[] = raw ? JSON.parse(raw) : [];
    buffer.push(result);
    if (buffer.length > MAX_BEHAVIORAL_BUFFER) {
      buffer.shift();
    }
    sessionStorage.setItem(BEHAVIORAL_BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    // silent degrade
  }
}

function removeFromBehavioralBuffer(sourceEventId: string): void {
  try {
    const raw = sessionStorage.getItem(BEHAVIORAL_BUFFER_KEY);
    if (!raw) return;
    const buffer: ObservationResult[] = JSON.parse(raw);
    const filtered = buffer.filter((r) => r.sourceEventId !== sourceEventId);
    sessionStorage.setItem(BEHAVIORAL_BUFFER_KEY, JSON.stringify(filtered));
  } catch {
    // silent degrade
  }
}

function peekBehavioralBuffer(): ObservationResult[] {
  try {
    const raw = sessionStorage.getItem(BEHAVIORAL_BUFFER_KEY);
    return raw ? (JSON.parse(raw) as ObservationResult[]) : [];
  } catch {
    return [];
  }
}

// ── Transient Event Types ────────────────────────────────────────────

/**
 * Event types whose raw data is high-frequency and positionally transient.
 * These are still captured and sent to the SW in real time (so the Component
 * Runtime receives them for interaction recognition), but they are NOT placed
 * in the durable recovery buffer and are NOT retried on delivery failure.
 *
 * Rationale: mousemove pointer positions and scroll offsets are stale within
 * milliseconds. Replaying them seconds after an SW outage injects false
 * stationarity/dwell data into hover confidence and creates phantom scroll
 * gestures. The next live event carries current, accurate data.
 *
 * All other event types (click, mousedown, focus, blur, input, change,
 * keydown, contextmenu, mouseenter, mouseleave) are discrete actions or
 * lifecycle markers that carry meaningful evidence even if replayed late.
 * They continue using the full durable buffer + retry mechanism.
 */
const TRANSIENT_EVENT_TYPES = new Set<string>(['mousemove', 'scroll']);

// ── Service Worker Communication ─────────────────────────────────────

/**
 * Send an observed event to the service worker.
 * For durable events: buffers first, retries on failure, removes on ack.
 * For transient events: fire-and-forget, no buffer, no retry.
 */
function sendObservedEvent(event: ObservedEvent): void {
  if (!chrome?.runtime?.sendMessage) return;

  // Transient events: send once, no retry, no buffer interaction
  if (TRANSIENT_EVENT_TYPES.has(event.eventType)) {
    try {
      chrome.runtime.sendMessage(
        { type: 'OBSERVED_EVENT', payload: event },
        // Swallow errors silently — transient events are expendable
        () => { void chrome.runtime.lastError; },
      );
    } catch {
      // silent degrade
    }
    return;
  }

  // Durable events: full retry + buffer lifecycle (unchanged)
  const attempt = (retryCount: number) => {
    chrome.runtime.sendMessage(
      { type: 'OBSERVED_EVENT', payload: event },
      (response) => {
        if (chrome.runtime.lastError || !response || response.ok === false) {
          // Retry with exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
          if (retryCount < 5) {
            setTimeout(() => attempt(retryCount + 1), 100 * Math.pow(2, retryCount));
          }
          // If all retries failed, event stays in buffer for next session
          return;
        }
        // Confirmed delivery — remove from buffer
        removeFromBuffer(event.eventId);
      },
    );
  };

  attempt(0);
}

/**
 * Flush all pending buffered events to the service worker.
 * Uses Promise.allSettled so one failure doesn't block others.
 */
async function flushPendingEvents(): Promise<void> {
  const buffered = peekBuffer();
  if (buffered.length === 0) return;

  const results = await Promise.allSettled(
    buffered.map(
      (event) =>
        new Promise<boolean>((resolve) => {
          if (!chrome?.runtime?.sendMessage) {
            resolve(false);
            return;
          }
          chrome.runtime.sendMessage(
            { type: 'OBSERVED_EVENT', payload: event },
            (response) => {
              if (chrome.runtime.lastError || !response || response.ok === false) {
                resolve(false);
              } else {
                resolve(true);
              }
            },
          );
        }),
    ),
  );

  // Remove confirmed-delivered events from buffer
  let modified = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value === true) {
      removeFromBuffer(buffered[i].eventId);
      modified = true;
    }
  }
}

// ── Behavioral Result Delivery (Phase D) ─────────────────────────────

/**
 * Send a behavioral observation result to the service worker.
 * Buffers first (for MV3 resilience), removes on confirmed delivery.
 * Retries on failure with exponential backoff.
 */
function sendBehavioralResult(result: ObservationResult): void {
  if (!chrome?.runtime?.sendMessage) return;

  pushToBehavioralBuffer(result);

  const attempt = (retryCount: number) => {
    chrome.runtime.sendMessage(
      { type: 'BEHAVIORAL_EFFECTS', payload: result },
      (response) => {
        if (chrome.runtime.lastError || !response || response.ok === false) {
          if (retryCount < 5) {
            setTimeout(() => attempt(retryCount + 1), 100 * Math.pow(2, retryCount));
          }
          return;
        }
        removeFromBehavioralBuffer(result.sourceEventId);
      },
    );
  };

  attempt(0);
}

/**
 * Flush all pending buffered behavioral results to the service worker.
 * Called on startRecording and pagehide for MV3 recovery.
 */
async function flushPendingBehavioralEvents(): Promise<void> {
  const buffered = peekBehavioralBuffer();
  if (buffered.length === 0) return;

  const results = await Promise.allSettled(
    buffered.map(
      (result) =>
        new Promise<boolean>((resolve) => {
          if (!chrome?.runtime?.sendMessage) {
            resolve(false);
            return;
          }
          chrome.runtime.sendMessage(
            { type: 'BEHAVIORAL_EFFECTS', payload: result },
            (response) => {
              if (chrome.runtime.lastError || !response || response.ok === false) {
                resolve(false);
              } else {
                resolve(true);
              }
            },
          );
        }),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value === true) {
      removeFromBehavioralBuffer(buffered[i].sourceEventId);
    }
  }
}

// ── Event Tap Lifecycle ──────────────────────────────────────────────

let eventTapHandle: EventTapHandle | null = null;
let isRecording = false;

// ── Observation Infrastructure (Phase D) ──────────────────────────────

let elementStateCache: ElementStateCache | null = null;
let documentObserver: DocumentObserver | null = null;
let observationCoordinator: ObservationCoordinator | null = null;
let cacheCleanupFn: (() => void) | null = null;

function onEvent(event: ObservedEvent): void {
  // Transient events (mousemove, scroll): fire-and-forget — no buffer, no retry.
  // Their positional data is stale within milliseconds; replaying after an SW
  // outage would inject false stationarity/dwell/scroll data into the runtime.
  if (!TRANSIENT_EVENT_TYPES.has(event.eventType)) {
    pushToBuffer(event);
  }
  sendObservedEvent(event);
}

/**
 * Start recording: install event tap, load buffered events.
 */
async function startRecording(): Promise<void> {
  if (isRecording) return;
  isRecording = true;
  sessionStorage.setItem(RECORDING_KEY, 'true');

  // Flush any stale events from a previous session — but do NOT
  // clear them. If the SW is alive, they get delivered. If not,
  // they stay for the next alive SW.
  await flushPendingEvents();
  await flushPendingBehavioralEvents();

  // ── Observation Infrastructure ───────────────────────────────────
  elementStateCache = new ElementStateCache();
  documentObserver = new DocumentObserver();
  observationCoordinator = new ObservationCoordinator();

  observationCoordinator.configure({
    cache: elementStateCache,
    observer: documentObserver,
    windowDurationMs: 3000,
    onResult: sendBehavioralResult,
  });

  // Register Phase A capture-phase listeners (mousedown + focus)
  cacheCleanupFn = setupStateCacheListeners(elementStateCache);
  // ── End Observation Infrastructure ───────────────────────────────

  // Install the event tap — now with onAfterEvent for observation windows
  eventTapHandle = createEventTap({
    onEvent,
    onAfterEvent: (targetEl, eventId, eventType, _cssSelector) => {
      // M1 contract: only observe click and change events
      if (eventType === 'click' || eventType === 'change') {
        observationCoordinator?.openWindow(eventId, eventType, targetEl);
      }
    },
  });
}

/**
 * Stop recording: remove event tap, clear buffer.
 */
async function stopRecording(): Promise<void> {
  if (!isRecording) return;
  isRecording = false;
  sessionStorage.setItem(RECORDING_KEY, 'false');

  // Final flush attempt
  await flushPendingEvents();

  // Stop listening
  eventTapHandle?.stop();
  eventTapHandle = null;

  // CRITICAL: Clear the buffer so stale events don't reappear in the
  // next recording session (Bug 1 fix from OrangeHRM learnings)
  clearBuffer();

  // ── Observation Cleanup ──────────────────────────────────────────
  // Shutdown the coordinator FIRST — finalizes all open windows and
  // delivers their results via sendBehavioralResult (buffered + async).
  // Per design: do NOT clear unacknowledged behavioral results during
  // Stop Recording. They must remain recoverable through the behavioral
  // flush/retry mechanism. Successfully acknowledged results are removed
  // normally by sendBehavioralResult's callback.
  observationCoordinator?.shutdown();
  observationCoordinator = null;

  // Clean up Phase A listeners
  cacheCleanupFn?.();
  cacheCleanupFn = null;

  // Clear observation infrastructure
  documentObserver?.reset();
  documentObserver = null;

  elementStateCache?.clear();
  elementStateCache = null;
  // ── End Observation Cleanup ──────────────────────────────────────
}

// ── Message Listener ─────────────────────────────────────────────────

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING') {
      sendResponse({ type: 'PONG', recording: isRecording });
      return false;
    }
    if (message?.type === 'START_RECORDING') {
      startRecording();
      // Don't sendResponse async — the listener must return synchronously
      return false;
    }
    if (message?.type === 'STOP_RECORDING') {
      stopRecording();
      return false;
    }
    if (message?.type === 'FLUSH_EVENTS') {
      flushPendingEvents();
      return false;
    }
    return false;
  });
}

// ── Page Lifecycle (MV3 Resilience) ──────────────────────────────────

/**
 * On pagehide, flush pending events but do NOT drain the buffer.
 * Events survive navigation for the next page's SW to pick up.
 */
window.addEventListener('pagehide', () => {
  flushPendingEvents();
  flushPendingBehavioralEvents();
});

/**
 * On pageshow, if we were recording, resume.
 */
window.addEventListener('pageshow', () => {
  if (sessionStorage.getItem(RECORDING_KEY) === 'true') {
    startRecording();
  }
});

// ── Auto-resume on script injection ──────────────────────────────────

/**
 * If the content script is re-injected (e.g. on navigation) and
 * recording was active, resume immediately.
 */
if (sessionStorage.getItem(RECORDING_KEY) === 'true') {
  startRecording();
}
