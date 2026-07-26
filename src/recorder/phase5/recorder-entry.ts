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

// ── Service Worker Communication ─────────────────────────────────────

/**
 * Send an observed event to the service worker.
 * Removes from buffer on confirmed delivery. Retries on failure.
 */
function sendObservedEvent(event: ObservedEvent): void {
  if (!chrome?.runtime?.sendMessage) return;

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
    if (results[i].status === 'fulfilled' && results[i].value === true) {
      removeFromBuffer(buffered[i].eventId);
      modified = true;
    }
  }
}

// ── Event Tap Lifecycle ──────────────────────────────────────────────

let eventTapHandle: EventTapHandle | null = null;
let isRecording = false;

function onEvent(event: ObservedEvent): void {
  // 1. Buffer the event
  pushToBuffer(event);
  // 2. Forward to SW
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

  // Install the event tap
  eventTapHandle = createEventTap({ onEvent });
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
}

// ── Message Listener ─────────────────────────────────────────────────

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
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
