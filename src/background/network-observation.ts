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
  /** Original URL captured at onBeforeRequest — never rewritten by redirects. */
  originalUrl: string;
  method: string;
  startTime: number;
  requestId: string;
  frameId: number;
  /** Chrome resource type: main_frame, sub_frame, xmlhttprequest, ... */
  resourceKind: string;
  requestBody?: Record<string, string>;
  /** CER-2: navEvent tag set at webNavigation.onCommitted (destroyed-document membership). */
  navEventId?: string;
  /** CER-2: last trusted user-action event id at request start (exact click join). */
  sourceEventId?: string;
}

/**
 * Completed request record for the ring buffer.
 * Used by synthetic nav evidence to recover form-submit POSTs.
 */
export interface CompletedWebRequest {
  /** ORIGINAL request URL (pre-redirect) — classification runs on this. */
  url: string;
  /** Final URL after redirects (diagnostic). */
  finalUrl?: string;
  /** Full redirect chain (original → hops → final), when observed. */
  redirectChain?: string[];
  method: string;
  status: number;
  startWallClock: number;
  endWallClock: number;
  requestId: string;
  frameId?: number;
  /** True when this request IS the navigation document (CER-2). */
  documentRequest?: boolean;
  /** navEvent of the commit that superseded this request's document (CER-2). */
  navEventId?: string;
  /** Trusted user-action event id at request start (CER-2). */
  sourceEventId?: string;
  requestBody?: Record<string, string>;
}

/** Pending main-frame request captured at onBeforeRequest (CER-2). */
export interface PendingMainFrameRequest {
  requestId: string;
  tabId: number;
  frameId: number;
  originalUrl: string;
  method: string;
  requestBody?: Record<string, string>;
  sourceEventId?: string;
  /**
   * RACE FIX: completion status recorded by onCompleted/onErrorOccurred.
   *
   * Chrome dispatches webRequest.onCompleted (full body received) BEFORE
   * webNavigation.onCommitted reaches the extension for fast document
   * responses (Amazon add-to-cart: POST → 200 HTML directly). The old code
   * DELETED the pending record at onCompleted, so the commit-time recovery
   * read null and the POST was lost. Now completion only STAMPS status —
   * the record stays alive until the onCommitted path consumes it
   * (consumeMainFrameCorrelation).
   *
   * undefined        → still in flight
   * number >= 0      → completed with this HTTP status
   * number < 0       → errored (network error, cancel; -1 by convention)
   */
  completionStatus?: number;
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

/**
 * CER-2: Pending main-frame request per tab, captured at onBeforeRequest —
 * BEFORE redirects and BEFORE completion. This is the authoritative record
 * of the form-submit POST (original URL + method + body).
 */
const pendingMainFrameByTab = new Map<number, PendingMainFrameRequest>();

/**
 * CER-2: redirect chains keyed by requestId. requestId is reused across
 * redirect hops by Chrome; onBeforeRedirect records each hop.
 */
const redirectChains = new Map<string, string[]>();

/**
 * CER-2: last trusted user action per tab { eventId, interactionId }.
 * Set by the service worker (CER-2 wiring); read at onBeforeRequest to
 * stamp requests with the action that likely triggered them.
 */
const lastTrustedActionByTab = new Map<
  number,
  { eventId: string; interactionId: string; wallClock: number }
>();

/** Whether webRequest listeners are currently registered. */
let listenersActive = false;

/** Callback for onBeforeRequest. */
let onBeforeRequestCallback:
  | ((details: chrome.webRequest.WebRequestBodyDetails) => void)
  | null = null;

/** Callback for onBeforeRedirect (CER). */
let onBeforeRedirectCallback:
  | ((details: chrome.webRequest.WebRedirectionResponseDetails) => void)
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
  pendingMainFrameByTab.clear();
  redirectChains.clear();
  lastTrustedActionByTab.clear();

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
  pendingMainFrameByTab.clear();
  redirectChains.clear();
  lastTrustedActionByTab.clear();
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

// ── CER: ID/Lifecycle-based correlation APIs ─────────────────────────

/**
 * CER-2: Record the last trusted user action for a tab.
 * Called by the service worker on every trusted OBSERVED_EVENT (click,
 * keydown). Read at onBeforeRequest to stamp requests with the exact
 * event that likely triggered them — replaces timestamp-window attribution.
 */
export function setLastTrustedAction(
  tabId: number,
  action: { eventId: string; interactionId: string },
): void {
  lastTrustedActionByTab.set(tabId, {
    ...action,
    wallClock: Date.now(),
  });
}

/**
 * CER-2: Get the pending main-frame request for a tab (captured at
 * onBeforeRequest — original URL/method/body, pre-redirect, pre-completion).
 * Null when no main-frame navigation is pending for the tab.
 */
export function getMainFrameCorrelation(tabId: number): PendingMainFrameRequest | null {
  return pendingMainFrameByTab.get(tabId) ?? null;
}

/**
 * RACE FIX: Consume the pending main-frame record for a tab — called from
 * the webNavigation.onCommitted path, which is the single owner that may
 * delete it. Returns the record (with completion status stamped by an
 * earlier onCompleted, if the losing race order occurred) or null.
 */
export function consumeMainFrameCorrelation(tabId: number): PendingMainFrameRequest | null {
  const rec = pendingMainFrameByTab.get(tabId) ?? null;
  if (rec) pendingMainFrameByTab.delete(tabId);
  return rec;
}

/**
 * RACE FIX: Find completed ring entries stamped with a trusted-action
 * sourceEventId — the stop-recording drain join key. Entries whose
 * interaction-level evidence was already delivered (direct content-script
 * capture) are excluded by the caller via requestId membership.
 */
export function getCompletedBySourceEventId(sourceEventId: string): CompletedWebRequest[] {
  return completedRequests.filter((r) => r.sourceEventId === sourceEventId);
}

/**
 * CER-2: Tag all in-flight requests for a tab with the navEvent that is
 * committing — "requests issued from the destroyed document". Membership
 * is by lifecycle state (started, not finished) at commit time, NOT by
 * timestamp. Returns the tagged entries.
 */
export function snapshotInFlightForTab(
  _tabId: number,
  navEventId: string,
): { requestId: string; url: string; originalUrl: string; method: string; requestBody?: Record<string, string> }[] {
  const snapped: {
    requestId: string; url: string; originalUrl: string; method: string;
    requestBody?: Record<string, string>;
  }[] = [];
  for (const entry of inFlightRequests.values()) {
    // In-flight entries are only tracked for the active tab (filter above),
    // so tab membership is implicit; frame scoping keeps sub-frame noise out
    // of the main-document commit correlation.
    if (entry.frameId === 0 || entry.resourceKind === 'xmlhttprequest' || entry.resourceKind === 'fetch') {
      entry.navEventId = navEventId;
      snapped.push({
        requestId: entry.requestId,
        url: entry.originalUrl,
        originalUrl: entry.originalUrl,
        method: entry.method,
        requestBody: entry.requestBody,
      });
    }
  }
  return snapped;
}

/**
 * CER-2: Exact-ID lookup of network evidence for a navigation.
 * Returns ring entries (completed) AND in-flight entries tagged with the
 * given navEventId. No time math — pure ID join. This replaces the
 * 10-second lookback window.
 */
export function getNetworkEvidenceForNavigation(navEventId: string): CompletedWebRequest[] {
  const fromRing = completedRequests.filter((r) => r.navEventId === navEventId);
  // In-flight entries that have not completed yet are exposed with
  // status null — the pipeline treats them as "issued, outcome pending".
  const fromInFlight: CompletedWebRequest[] = [];
  for (const entry of inFlightRequests.values()) {
    if (entry.navEventId === navEventId) {
      fromInFlight.push({
        url: entry.originalUrl,
        finalUrl: entry.url,
        method: entry.method,
        status: -1, // sentinel: still in flight
        startWallClock: Date.now(),
        endWallClock: Date.now(),
        requestId: entry.requestId,
        frameId: entry.frameId,
        documentRequest: entry.resourceKind === 'main_frame',
        navEventId: entry.navEventId,
        sourceEventId: entry.sourceEventId,
        requestBody: entry.requestBody,
      });
    }
  }
  return [...fromRing, ...fromInFlight];
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

    // CER-2: stamp the trusted action active when the request started —
    // the exact-event join key for click→request attribution.
    const action = lastTrustedActionByTab.get(details.tabId);
    const sourceEventId = action?.eventId;

    inFlightRequests.set(details.requestId, {
      url: details.url,
      originalUrl: details.url,
      method: details.method,
      startTime: performance.now(),
      requestId: details.requestId,
      frameId: details.frameId,
      resourceKind: details.type ?? 'other',
      requestBody,
      sourceEventId,
    });

    // CER-2: capture main-frame POSTs IMMEDIATELY, before redirects can
    // rewrite the URL and before completion timing matters. This is the
    // authoritative form-submit record (Amazon #add-to-cart-button case).
    if (details.type === 'main_frame' && details.frameId === 0) {
      pendingMainFrameByTab.set(details.tabId, {
        requestId: details.requestId,
        tabId: details.tabId,
        frameId: details.frameId,
        originalUrl: details.url,
        method: details.method,
        requestBody,
        sourceEventId,
      });
    }

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

  // CER: record redirect hops — requestId is reused across the chain.
  onBeforeRedirectCallback = (details) => {
    if (activeTabId !== null && details.tabId !== activeTabId) return;
    const chain = redirectChains.get(details.requestId) ?? [details.url];
    // details.url at onBeforeRedirect is the URL BEFORE this hop
    chain.push(details.redirectUrl);
    redirectChains.set(details.requestId, chain);
  };

  onCompletedCallback = (details) => {
    if (activeTabId !== null && details.tabId !== activeTabId) return;

    const inFlight = inFlightRequests.get(details.requestId);
    inFlightRequests.delete(details.requestId);

    // RACE FIX: do NOT delete the pending main-frame record here. Chrome
    // may dispatch onCompleted before webNavigation.onCommitted; the
    // commit path must still find the POST. Stamp completion status and
    // leave ownership with the commit consumer.
    const pendingDoc = pendingMainFrameByTab.get(details.tabId);
    const isDocumentRequest = pendingDoc?.requestId === details.requestId;
    if (isDocumentRequest) {
      pendingDoc!.completionStatus = details.statusCode;
    }

    // Buffer completed request for synthetic nav evidence recovery.
    // CER: url is the ORIGINAL request URL (classification target), not
    // the post-redirect final URL; redirect chain preserved when observed.
    const chain = redirectChains.get(details.requestId);
    redirectChains.delete(details.requestId);

    pushCompletedRequest({
      url: inFlight?.originalUrl ?? details.url,
      finalUrl: details.url,
      redirectChain: chain,
      method: inFlight?.method ?? details.method,
      status: details.statusCode,
      startWallClock: inFlight ? Date.now() - (performance.now() - inFlight.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: details.requestId,
      frameId: inFlight?.frameId ?? details.frameId,
      documentRequest: isDocumentRequest,
      navEventId: inFlight?.navEventId,
      sourceEventId: inFlight?.sourceEventId,
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

    // RACE FIX: same handoff semantics as onCompleted — stamp, don't delete.
    const pendingDoc = pendingMainFrameByTab.get(details.tabId);
    const isDocumentRequest = pendingDoc?.requestId === details.requestId;
    if (isDocumentRequest) {
      pendingDoc!.completionStatus = -1; // network error / cancelled
    }

    const chain = redirectChains.get(details.requestId);
    redirectChains.delete(details.requestId);

    // Buffer errored request too (status=0 signals failure)
    pushCompletedRequest({
      url: inFlight?.originalUrl ?? details.url,
      finalUrl: details.url,
      redirectChain: chain,
      method: inFlight?.method ?? 'GET',
      status: 0,
      startWallClock: inFlight ? Date.now() - (performance.now() - inFlight.startTime) : Date.now(),
      endWallClock: Date.now(),
      requestId: details.requestId,
      frameId: inFlight?.frameId ?? details.frameId,
      documentRequest: isDocumentRequest,
      navEventId: inFlight?.navEventId,
      sourceEventId: inFlight?.sourceEventId,
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
    if (onBeforeRedirectCallback) {
      chrome.webRequest.onBeforeRedirect.addListener(onBeforeRedirectCallback, broadFilter);
    }
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
    if (onBeforeRedirectCallback) {
      chrome.webRequest.onBeforeRedirect.removeListener(onBeforeRedirectCallback);
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
  onBeforeRedirectCallback = null;
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
