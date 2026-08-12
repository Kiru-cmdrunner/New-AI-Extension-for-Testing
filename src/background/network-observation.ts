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
}

// ── Constants ────────────────────────────────────────────────────────

/** URL filter for webRequest listeners. */
const URL_FILTER = ['http://*/*', 'https://*/*'];

// ── Module state ─────────────────────────────────────────────────────

/** Currently tracked tabId for webRequest filtering. */
let activeTabId: number | null = null;

/** In-flight requests keyed by requestId. */
const inFlightRequests = new Map<string, InFlightWebRequest>();

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

    inFlightRequests.set(details.requestId, {
      url: details.url,
      method: details.method,
      startTime: performance.now(),
      requestId: details.requestId,
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
