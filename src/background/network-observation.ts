/**
 * Network Observation — SW-side webRequest listener management (M6)
 *
 * Manages chrome.webRequest listeners in the service worker for parallel
 * network capture. Also orchestrates MAIN-world injection of network-inject.js
 * via chrome.scripting.executeScript({ world: 'MAIN' }).
 *
 * webRequest listeners are registered IMMEDIATELY when recording starts —
 * BEFORE the dynamic injection call. They run in parallel with the MAIN-world
 * interceptor for the entire recording session, covering the race window
 * (spec §6.3).
 *
 * Captured request metadata is forwarded to the content script's NetworkBridge
 * via chrome.tabs.sendMessage with type 'NETWORK_REQUEST'.
 *
 * Architecture: behavioral-evidence-model.md §6.2, §6.3, §6.4
 */

// ── Types ────────────────────────────────────────────────────────────

/** In-flight webRequest tracking for matching start → complete. */
interface InFlightWebRequest {
  url: string;
  method: string;
  startTime: number;
  requestId: string;
  requestBody?: Record<string, string>;
}

/**
 * Completed request record for the ring buffer.
 * Used by synthetic nav evidence to recover form-submit POSTs.
 */
export interface CompletedWebRequest {
  url: string;
  method: string;
  status: number;
  startWallClock: number;
  endWallClock: number;
  requestId: string;
  requestBody?: Record<string, string>;
}

// ── Constants ────────────────────────────────────────────────────────

/** URL filter for webRequest listeners. */
const URL_FILTER = ['http://*/*', 'https://*/*'];

/** How long to retain completed requests in the ring buffer (ms). */
const COMPLETED_BUFFER_TTL_MS = 10_000;

/** Maximum completed requests to retain. */
const MAX_COMPLETED_ENTRIES = 100;

// ── Module state ─────────────────────────────────────────────────────

/** Currently tracked tabId for webRequest filtering. */
let activeTabId: number | null = null;

/** In-flight requests keyed by requestId. */
const inFlightRequests = new Map<string, InFlightWebRequest>();

/**
 * Ring buffer of recently completed requests.
 * Used to bridge network evidence into synthetic navigation interactions
 * for full-page-reload apps (e.g., Amazon Add to Cart).
 */
const completedRequests: CompletedWebRequest[] = [];

/** Whether webRequest listeners are currently registered. */
let listenersActive = false;

/** Callback for onBeforeRequest. */
let onBeforeRequestCallback:
  | ((details: chrome.webRequest.WebRequestBodyDetails) => void)
  | null = null;

/** Callback for onCompleted. */
let onCompletedCallback:
  | ((details: chrome.webRequest.WebResponseCacheDetails) => void)
  | null = null;

/** Callback for onErrorOccurred. */
let onErrorCallback:
  | ((details: chrome.webRequest.WebResponseErrorDetails) => void)
  | null = null;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Start network observation for a tab.
 *
 * 1. Immediately registers webRequest listeners (covers race window)
 * 2. Injects MAIN-world network interceptor (better metadata)
 *
 * Both run in parallel for the entire recording session.
 *
 * @param tabId The tab to observe
 */
export async function startNetworkObservation(tabId: number): Promise<void> {
  activeTabId = tabId;
  inFlightRequests.clear();
  completedRequests.length = 0;

  // 1. Register webRequest listeners IMMEDIATELY (race coverage)
  registerWebRequestListeners();

  // 2. Inject MAIN-world interceptor
  await injectNetworkInterceptor(tabId);
}

/**
 * Stop network observation.
 *
 * Removes webRequest listeners. The MAIN-world script restores itself
 * via the 'cmdrunner-net-stop' CustomEvent (dispatched by the NetworkBridge
 * in the content script).
 *
 * @param tabId The tab to stop observing
 */
export function stopNetworkObservation(_tabId: number): void {
  unregisterWebRequestListeners();
  inFlightRequests.clear();
  activeTabId = null;

  // Note: MAIN-world restoration is handled by the content script's
  // NetworkBridge.sendStopSignal() which dispatches 'cmdrunner-net-stop'
}

/**
 * Whether webRequest listeners are currently active.
 */
export function isObserving(): boolean {
  return listenersActive;
}

/**
 * Return recently completed requests matching a time range and optional URL filter.
 *
 * Used by `attachSyntheticNavEvidence` to recover form-submit POSTs that
 * were captured by webRequest but never delivered to the content script
 * (because the page was destroyed by the reload).
 *
 * @param sinceWallClock - Date.now() threshold; only entries with
 *   `endWallClock >= sinceWallClock` are returned.
 * @param urlPattern - Optional regex string; only matching URLs returned.
 */
export function getRecentRequests(
  sinceWallClock: number,
  urlPattern?: string,
): CompletedWebRequest[] {
  const re = urlPattern ? new RegExp(urlPattern, 'i') : null;
  return completedRequests.filter(
    (r) =>
      r.endWallClock >= sinceWallClock &&
      (!re || re.test(r.url)),
  );
}

// ── webRequest Listener Management ───────────────────────────────────

/**
 * Register chrome.webRequest listeners for the active tab.
 */
function registerWebRequestListeners(): void {
  if (listenersActive) return;
  if (!chrome?.webRequest) return;

  const filter: chrome.webRequest.RequestFilter = {
    urls: URL_FILTER,
  };
  // We use a broader filter and filter by tabId in callbacks
  void filter;

  onBeforeRequestCallback = (details) => {
    // Only process requests from the active tab
    if (activeTabId !== null && details.tabId !== activeTabId) return;

    // Parse requestBody formData into a flat key→string map.
    // Chrome provides this when extraInfoSpec includes 'requestBody'.
    let requestBody: Record<string, string> | undefined;
    if (details.requestBody?.formData) {
      requestBody = {};
      for (const [key, values] of Object.entries(details.requestBody.formData)) {
        if (Array.isArray(values) && values.length > 0) {
          requestBody[key] = values[0];
        }
      }
    }

    inFlightRequests.set(details.requestId, {
      url: details.url,
      method: details.method,
      startTime: performance.now(),
      requestId: details.requestId,
      requestBody,
    });

    // P1-4 Fix: Include wallClock (Date.now()) for cross-process timestamp normalization
    forwardToTab(details.tabId, {
      url: details.url,
      method: details.method,
      timestamp: performance.now(),
      wallClock: Date.now(),
      phase: 'start' as const,
      status: null,
      requestId: details.requestId,
    });
  };

  onCompletedCallback = (details) => {
    if (activeTabId !== null && details.tabId !== activeTabId) return;

    const inFlight = inFlightRequests.get(details.requestId);
    inFlightRequests.delete(details.requestId);

    // Buffer completed request for synthetic nav evidence recovery
    pushCompletedRequest({
      url: details.url,
      method: inFlight?.method ?? details.method,
      status: details.statusCode,
      startWallClock: inFlight ? Date.now() - (performance.now() - inFlight.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: details.requestId,
      requestBody: inFlight?.requestBody,
    });

    // P1-4 Fix: Include wallClock
    forwardToTab(details.tabId, {
      url: details.url,
      method: inFlight?.method ?? details.method,
      timestamp: performance.now(),
      wallClock: Date.now(),
      phase: 'complete' as const,
      status: details.statusCode,
      requestId: details.requestId,
    });
  };

  onErrorCallback = (details) => {
    if (activeTabId !== null && details.tabId !== activeTabId) return;

    const inFlight = inFlightRequests.get(details.requestId);
    inFlightRequests.delete(details.requestId);

    // Buffer errored request too (status=0 signals failure)
    pushCompletedRequest({
      url: details.url,
      method: inFlight?.method ?? 'GET',
      status: 0,
      startWallClock: inFlight ? Date.now() - (performance.now() - inFlight.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: details.requestId,
      requestBody: inFlight?.requestBody,
    });

    // P1-4 Fix: Include wallClock
    forwardToTab(details.tabId, {
      url: details.url,
      method: inFlight?.method ?? 'GET',
      timestamp: performance.now(),
      wallClock: Date.now(),
      phase: 'complete' as const,
      status: 0,
      requestId: details.requestId,
    });
  };

  // Use a broad URL filter and filter by tabId in callbacks
  const broadFilter: chrome.webRequest.RequestFilter = {
    urls: URL_FILTER,
  };

  try {
    chrome.webRequest.onBeforeRequest.addListener(
      onBeforeRequestCallback,
      broadFilter,
      ['requestBody'],
    );
    chrome.webRequest.onCompleted.addListener(
      onCompletedCallback,
      broadFilter,
    );
    chrome.webRequest.onErrorOccurred.addListener(
      onErrorCallback,
      broadFilter,
    );
    listenersActive = true;
  } catch (e) {
    console.warn('[NetworkObservation] Failed to register webRequest listeners:', e);
  }
}

/**
 * Unregister chrome.webRequest listeners.
 */
function unregisterWebRequestListeners(): void {
  if (!listenersActive) return;
  if (!chrome?.webRequest) return;

  try {
    if (onBeforeRequestCallback) {
      chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestCallback);
    }
    if (onCompletedCallback) {
      chrome.webRequest.onCompleted.removeListener(onCompletedCallback);
    }
    if (onErrorCallback) {
      chrome.webRequest.onErrorOccurred.removeListener(onErrorCallback);
    }
  } catch {
    // Silent — listeners may already be removed
  }

  onBeforeRequestCallback = null;
  onCompletedCallback = null;
  onErrorCallback = null;
  listenersActive = false;
}

// ── MAIN-world Injection ─────────────────────────────────────────────

/**
 * Push a completed request to the ring buffer with TTL eviction.
 */
function pushCompletedRequest(entry: CompletedWebRequest): void {
  completedRequests.push(entry);
  // Evict entries older than TTL or over capacity
  const cutoff = Date.now() - COMPLETED_BUFFER_TTL_MS;
  while (completedRequests.length > 0 && completedRequests[0].endWallClock < cutoff) {
    completedRequests.shift();
  }
  while (completedRequests.length > MAX_COMPLETED_ENTRIES) {
    completedRequests.shift();
  }
}

/**
 * Dynamically inject the MAIN-world network interceptor.
 *
 * Uses chrome.scripting.executeScript with world: 'MAIN' to run
 * network-inject.js in the page's JS context. This patches
 * window.fetch and XMLHttpRequest to intercept page requests.
 *
 * The injected script is a standalone bundle at /assets/network-inject.js
 * (built from public/assets/network-inject.js, copied as-is by Vite).
 */
async function injectNetworkInterceptor(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['assets/network-inject.js'],
      injectImmediately: true,
    });
    return true;
  } catch (e) {
    console.warn('[NetworkObservation] MAIN-world injection failed:', e);
    return false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Forward a webRequest event to the content script's NetworkBridge.
 *
 * P1-4 Fix: Includes wallClock (Date.now() from SW) for cross-process
 * timestamp normalization.
 */
function forwardToTab(
  tabId: number,
  detail: {
    url: string;
    method: string;
    timestamp: number;
    wallClock: number; // P1-4: Date.now() from SW
    phase: 'start' | 'complete';
    status: number | null;
    requestId: string;
  },
): void {
  try {
    chrome.tabs.sendMessage(tabId, {
      type: 'NETWORK_REQUEST',
      detail,
    }).catch(() => {
      // Content script may not be ready — silent
    });
  } catch {
    // Tab may not exist — silent
  }
}
