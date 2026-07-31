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

// ── Iframe Selector Reporting (Phase 4: Hybrid Locator Strategy) ──────

/**
 * Report same-origin iframe selectors to the service worker's FrameTree.
 *
 * The content script inside a cross-origin iframe cannot read the parent's DOM
 * (same-origin policy). The service worker knows the frame tree (URLs, frame IDs)
 * but cannot inspect the DOM to get CSS selectors. This function bridges that gap:
 *
 * - Only runs in the TOP FRAME (window === window.top).
 * - Scans document.querySelectorAll('iframe') for same-origin iframes.
 * - Reports each iframe's CSS selector, name, id, and src to the SW.
 * - The SW correlates by URL and merges into the FrameTree.
 *
 * This gives best-of-both-worlds:
 * - Same-origin iframes: precise CSS selectors from the content script
 * - Cross-origin iframes: URL-based selectors from the SW frame tree
 * - Nested iframes: ancestor chain from the SW frame tree + same-origin enrichment
 *
 * Architecture: .drytis/IFRAME_ARCHITECTURE_ROADMAP.md §4
 */

function reportSameOriginIframeSelectors(): void {
  // Only run in the top frame
  if (window !== window.top) return;

  try {
    const iframes = document.querySelectorAll('iframe');
    const entries: Array<{
      frameSelector: string;
      frameName: string | null;
      frameId: string | null;
      frameIndex: number;
      frameSrc: string | null;
    }> = [];

    iframes.forEach((iframe, index) => {
      // Try to read the iframe's URL (throws for cross-origin)
      let frameSrc: string | null = null;
      try {
        frameSrc = iframe.contentWindow?.location?.href ?? null;
      } catch {
        // Cross-origin — contentWindow.location is inaccessible
        // Fall back to the src attribute (may differ from actual URL after redirects)
        frameSrc = iframe.src || null;
      }

      entries.push({
        frameSelector: generateIframeSelector(iframe),
        frameName: iframe.name || null,
        frameId: iframe.id || null,
        frameIndex: index,
        frameSrc,
      });
    });

    if (entries.length > 0 && chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'IFRAME_SELECTORS', payload: entries },
        // Don't retry — this is advisory enrichment, not critical data
        () => { void chrome.runtime.lastError; },
      );
    }
  } catch {
    // Permission or timing issue — non-fatal
  }
}

/**
 * Generate a CSS selector for an iframe element.
 * Uses the same priority chain as identity extraction: id > name > data-testid > nth-of-type.
 */
function generateIframeSelector(iframe: HTMLIFrameElement): string {
  // Priority 1: id attribute
  if (iframe.id) {
    return `iframe#${CSS.escape(iframe.id)}`;
  }

  // Priority 2: name attribute
  if (iframe.name) {
    return `iframe[name="${iframe.name}"]`;
  }

  // Priority 3: data-testid
  const testId = iframe.getAttribute('data-testid');
  if (testId) {
    return `iframe[data-testid="${testId}"]`;
  }

  // Priority 4: nth-of-type among sibling iframes
  const parent = iframe.parentElement;
  if (parent) {
    const siblings = Array.from(parent.querySelectorAll(':scope > iframe'));
    const nth = siblings.indexOf(iframe) + 1;
    const parentSelector = parent.id ? `#${CSS.escape(parent.id)}` : '';
    return `${parentSelector} iframe:nth-of-type(${nth})`;
  }

  // Fallback: just tag name
  return 'iframe';
}

// Report iframe selectors when the DOM is ready (after startRecording)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  reportSameOriginIframeSelectors();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    reportSameOriginIframeSelectors();
  });
}

// Re-report on dynamic iframe additions (MutationObserver)
// Only fires when an <iframe> element is actually added or removed — NOT on
// every DOM mutation (class change, text insertion, style update, etc.).
// Includes a trailing debounce to coalesce bursts of iframe additions.
if (window === window.top) {
  let iframeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const iframeObserver = new MutationObserver((mutations) => {
    // Filter: only act if at least one mutation added/removed an iframe
    const hasIframeMutation = mutations.some((m) => {
      // Check added nodes
      for (const node of m.addedNodes) {
        if (node.nodeName === 'IFRAME') return true;
        if (node instanceof Element && node.querySelector?.('iframe')) return true;
      }
      // Check removed nodes
      for (const node of m.removedNodes) {
        if (node.nodeName === 'IFRAME') return true;
        if (node instanceof Element && node.querySelector?.('iframe')) return true;
      }
      return false;
    });

    if (!hasIframeMutation) return;

    // Debounce: coalesce bursts (e.g. a framework rendering many components)
    if (iframeDebounceTimer) clearTimeout(iframeDebounceTimer);
    iframeDebounceTimer = setTimeout(() => {
      reportSameOriginIframeSelectors();
      iframeDebounceTimer = null;
    }, 250);
  });
  iframeObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
