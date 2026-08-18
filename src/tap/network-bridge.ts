/**
 * Network Bridge — ISOLATED-world CustomEvent listener + deduplication (M6)
 *
 * Lives in the content script's ISOLATED world (same renderer process as
 * the MAIN world). Listens for 'cmdrunner-net' CustomEvents dispatched by
 * the dynamically-injected network-inject.js (MAIN world) and buffers
 * NetworkActivity entries.
 *
 * Also receives network activity from the service worker's webRequest
 * listeners (forwarded via chrome.runtime message), enabling parallel
 * capture for race-condition coverage (spec §6.3).
 *
 * Deduplication: When the same URL + method + approximate timestamp appears
 * from both sources, keeps 'main-world' (richer metadata) and drops the
 * 'webrequest' duplicate. If only webrequest captured it (race window or
 * CSP-blocked injection), keeps the 'webrequest' entry.
 *
 * Timing: performance.now() is shared between MAIN and ISOLATED worlds
 * (same renderer process). Correlation is exact.
 *
 * Architecture: behavioral-evidence-model.md §6.2, §6.3, §6.4
 */

import type { NetworkActivity } from '../shared/behavioral-evidence-types';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Raw event detail from MAIN-world network-inject.js CustomEvents.
 * Includes PerformanceObserver entries with resourceType 'navigation' or 'resource'.
 */
interface NetEventDetail {
  url: string;
  method: string;
  timestamp: number; // performance.now() from MAIN world
  phase: 'start' | 'complete';
  status: number | null;
  resourceType: 'fetch' | 'xhr' | 'navigation' | 'resource';
}

/**
 * Raw event from webRequest (forwarded by SW via chrome.runtime message).
 * P1-4 Fix: wallClock field for cross-process timestamp normalization.
 * Network Hardening: requestBody for POST form data (e.g., ASIN, quantity).
 */
interface WebRequestDetail {
  url: string;
  method: string;
  timestamp: number;
  wallClock?: number; // Date.now() from SW at event time (P1-4)
  phase: 'start' | 'complete';
  status: number | null;
  requestId: string;
  requestBody?: Record<string, string>;
  /** CER: trusted-action eventId at request start (exact join key). */
  sourceEventId?: string;
}

// ── Constants ────────────────────────────────────────────────────────

/** Maximum entries in the buffer. Older entries evicted. */
const MAX_BUFFER_SIZE = 500;

/** Time window for deduplication (ms). */
const DEDUP_WINDOW_MS = 2000;

/** Maximum network activity entries per evidence window. */
const MAX_NETWORK_PER_WINDOW = 50;

// ── NetworkBridge ────────────────────────────────────────────────────

/**
 * In-flight request tracking for matching start → complete.
 */
interface InFlightRequest {
  url: string;
  method: string;
  startTimestamp: number;
  source: 'main-world' | 'webrequest';
  requestId?: string;
  sourceEventId?: string;
}

/**
 * NetworkBridge manages the network activity buffer and deduplication.
 *
 * Lifecycle:
 *   const bridge = new NetworkBridge();
 *   bridge.start();  // install CustomEvent + message listeners
 *   // During evidence window: bridge.collectForRange(openedAt, closedAt)
 *   bridge.stop();   // remove listeners, clear buffer
 */
export class NetworkBridge {
  /** Buffered NetworkActivity entries with absolute timestamps. */
  private buffer: TimestampedNetworkActivity[] = [];

  /** In-flight requests for matching start→complete. */
  private inFlight = new Map<string, InFlightRequest[]>();

  /** Whether the MAIN-world interceptor is confirmed active. */
  private mainWorldActive = false;

  /** Listener for 'cmdrunner-net' CustomEvents. */
  private netListener: ((e: Event) => void) | null = null;

  /** Listener for 'cmdrunner-net-ready' CustomEvent. */
  private readyListener: ((e: Event) => void) | null = null;

  /** Listener for SW webRequest messages. */
  private messageListener: ((msg: unknown) => void) | null = null;

  /** Timeout handle for ready-signal wait. */
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Whether the bridge is running. */
  private running = false;

  /**
   * P1-4 Fix: Counters for diagnostics.
   */
  private webRequestCount = 0;
  private mainWorldCount = 0;

  /**
   * Start listening for network activity from both sources.
   *
   * P1-4 Fix: Added diagnostic logging to help diagnose capture failures.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.buffer = [];
    this.inFlight.clear();
    this.mainWorldActive = false;
    this.webRequestCount = 0;
    this.mainWorldCount = 0;

    // Listen for MAIN-world network events
    this.netListener = (e: Event) => {
      const detail = (e as CustomEvent<NetEventDetail>).detail;
      if (detail) {
        this.mainWorldCount++;
        this.handleNetEvent(detail, 'main-world');
      }
    };
    window.addEventListener('cmdrunner-net', this.netListener);

    // D8: The MAIN-world interceptor loads at document_start and dispatches
    // its ready event ONCE at document load — long before START_RECORDING
    // constructs this bridge. The durable cross-world signal is the shared
    // DOM marker the interceptor sets alongside its dispatch. If present,
    // the MAIN world is already active; no wait, no false diagnostic.
    if (document.documentElement.getAttribute('data-cmdrunner-net-ready') === 'true') {
      this.mainWorldActive = true;
    }

    // Listen for ready signal
    this.readyListener = () => {
      this.mainWorldActive = true;
      console.debug('[NetworkBridge] MAIN-world interceptor active');
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
      }
    };
    window.addEventListener('cmdrunner-net-ready', this.readyListener);

    // Set timeout for ready signal (500ms per spec §6.2) — only honest when
    // the marker path did NOT already establish readiness (D8: covers the
    // re-injection race where the bridge starts before the SW's synchronous
    // ready re-dispatch).
    if (!this.mainWorldActive) {
      this.readyTimeout = setTimeout(() => {
        // Ready signal not received — fall back to webRequest-only mode
        console.debug('[NetworkBridge] MAIN-world interceptor NOT active after 500ms — webRequest-only mode');
        this.readyTimeout = null;
      }, 500);
    }

    // Listen for webRequest messages forwarded from SW
    this.messageListener = (msg: unknown) => {
      if (
        msg &&
        typeof msg === 'object' &&
        (msg as { type?: string }).type === 'NETWORK_REQUEST'
      ) {
        const detail = (msg as { detail?: WebRequestDetail }).detail;
        if (detail) {
          this.webRequestCount++;
          this.handleNetEvent(detail, 'webrequest');
        }
      }
    };
    chrome.runtime.onMessage.addListener(this.messageListener);
  }

  /**
   * Stop listening. Does NOT dispatch the MAIN-world stop signal —
   * the caller (recorder-entry) handles that separately.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.netListener) {
      window.removeEventListener('cmdrunner-net', this.netListener);
      this.netListener = null;
    }
    if (this.readyListener) {
      window.removeEventListener('cmdrunner-net-ready', this.readyListener);
      this.readyListener = null;
    }
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }

    this.buffer = [];
    this.inFlight.clear();
  }

  /**
   * Signal the MAIN-world script to restore originals and stop.
   */
  sendStopSignal(): void {
    window.dispatchEvent(new CustomEvent('cmdrunner-net-stop'));
  }

  /**
   * Whether the MAIN-world interceptor is confirmed active.
   */
  isMainWorldActive(): boolean {
    return this.mainWorldActive;
  }

  /**
   * Collect NetworkActivity entries within a time range.
   * Returns entries with relativeTime adjusted to the evidence window.
   * Applies the 50-entry cap (spec §6.6).
   *
   * CER-3: When `windowRequestIds` is provided, entries whose requestId is
   * a member are included REGARDLESS of timestamp (ID join primary).
   * Time-range matching remains only as the fallback for main-world
   * entries that carry no requestId (fetch/XHR patch events).
   *
   * @param openedAt - performance.now() when the evidence window opened
   * @param closedAt - performance.now() when the evidence window closed
   * @param windowRequestIds - requestIds that STARTED during this window
   *   (from snapshotRequestIds at window open → collect at close).
   * @returns NetworkActivity[] capped at 50 entries
   */
  collectForRange(
    openedAt: number,
    closedAt: number,
    windowRequestIds?: Set<string>,
  ): NetworkActivity[] {
    // Filter entries: ID membership OR time range (fallback for
    // main-world-only entries without requestIds)
    const inRange = this.buffer.filter((entry) => {
      if (windowRequestIds && entry.requestId && windowRequestIds.has(entry.requestId)) {
        return true;
      }
      return (
        entry.absStartTimestamp >= openedAt - 50 &&
        entry.absStartTimestamp <= closedAt + 50
      );
    });

    // Deduplicate: prefer 'main-world' source over 'webrequest'
    const deduped = this.deduplicate(inRange);

    // Convert to relative timing and apply cap
    const results: NetworkActivity[] = deduped
      .map((entry) => ({
        url: entry.url,
        method: entry.method,
        status: entry.status,
        startRelativeToEvent: Math.max(
          0,
          entry.absStartTimestamp - openedAt,
        ),
        endRelativeToEvent:
          entry.absEndTimestamp !== null
            ? Math.max(0, entry.absEndTimestamp - openedAt)
            : null,
        durationMs:
          entry.absEndTimestamp !== null
            ? Math.max(0, entry.absEndTimestamp - entry.absStartTimestamp)
            : null,
        resourceType: entry.resourceType,
        source: entry.source,
        requestBody: entry.requestBody,
        sourceEventId: entry.sourceEventId,
      }))
      .sort((a, b) => a.startRelativeToEvent - b.startRelativeToEvent)
      .slice(0, MAX_NETWORK_PER_WINDOW);

    return results;
  }

  /**
   * Clear the buffer. Called after evidence collection for a window.
   */
  clearBuffer(): void {
    this.buffer = [];
  }

  /**
   * CER-3: Snapshot the set of requestIds currently known to the buffer.
   * Called by EvidenceCollector when an interaction window OPENS. At
   * close, collectForRange receives the requestIds that STARTED during
   * the window = (snapshot at close) − (snapshot at open). This is the
   * deterministic window↔network join — no timestamp overlap needed.
   */
  snapshotRequestIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.buffer) {
      if (entry.requestId) ids.add(entry.requestId);
    }
    return ids;
  }

  /**
   * CER-3: Compute the requestIds that started between two snapshots
   * (window-open snapshot vs window-close snapshot).
   */
  requestIdsStartedDuring(
    atOpen: Set<string>,
    atClose: Set<string>,
  ): Set<string> {
    const started = new Set<string>();
    for (const id of atClose) {
      if (!atOpen.has(id)) started.add(id);
    }
    return started;
  }

  /**
   * Get buffer size (for testing).
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * P1-4 Fix: Get diagnostic info about network capture status.
   * Returns counts of events received from each source.
   */
  getDiagnostics(): { mainWorldActive: boolean; mainWorldCount: number; webRequestCount: number; bufferSize: number } {
    return {
      mainWorldActive: this.mainWorldActive,
      mainWorldCount: this.mainWorldCount,
      webRequestCount: this.webRequestCount,
      bufferSize: this.buffer.length,
    };
  }

  /**
   * Get count of in-flight requests (for bounded network re-check).
   * GAP-5: used by EvidenceCollector to decide whether to do a delayed re-collect.
   */
  getInFlightCount(): number {
    let count = 0;
    for (const list of this.inFlight.values()) {
      count += list.length;
    }
    return count;
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Handle a network event from either source.
   *
   * P1-4 Fix: For webRequest events, normalize the timestamp from the SW's
   * performance.now() clock to the content script's performance.now() clock.
   * SW timestamps are in a different process and don't align with the content
   * script's clock. We estimate the offset when the first webRequest arrives
   * by comparing Date.now()-derived timing.
   */
  private handleNetEvent(
    detail: NetEventDetail | WebRequestDetail,
    source: 'main-world' | 'webrequest',
  ): void {
    if (!this.running) return;

    const url = detail.url;
    const method = detail.method;
    const phase = detail.phase;
    const status = detail.status;
    // Extract requestBody from webRequest source (MAIN-world doesn't have it)
    const requestBody =
      source === 'webrequest'
        ? (detail as WebRequestDetail).requestBody
        : undefined;
    const resourceType =
      source === 'main-world'
        ? (detail as NetEventDetail).resourceType
        : 'unknown';
    // CER-3: thread requestId + sourceEventId from webRequest events.
    const requestId =
      source === 'webrequest' ? (detail as WebRequestDetail).requestId : undefined;
    const sourceEventId =
      source === 'webrequest' ? (detail as WebRequestDetail).sourceEventId : undefined;

    // P1-4 Fix: Normalize timestamp for webRequest events.
    // MAIN-world events use the same performance.now() as the content script
    // (same renderer process) — no conversion needed.
    // webRequest events arrive from the SW with SW's performance.now() —
    // a different clock. If wallClock is present, convert to content script
    // time using Date.now() as a common reference. If wallClock is absent
    // (e.g., from tests or older SW code), use the original timestamp as-is.
    let timestamp = detail.timestamp;
    if (source === 'webrequest') {
      const wallClock = (detail as WebRequestDetail).wallClock;
      if (wallClock !== undefined && wallClock > 0) {
        // Convert: content_performance_now = contentNow - (wallNow - wallClock)
        const contentNow = performance.now();
        const wallNow = Date.now();
        timestamp = contentNow - (wallNow - wallClock);
      }
      // else: use detail.timestamp as-is (test context or no wallClock available)
    }

    if (phase === 'start') {
      // Track in-flight
      const key = `${method}:${url}`;
      const existing = this.inFlight.get(key) ?? [];
      existing.push({
        url,
        method,
        startTimestamp: timestamp,
        source,
        requestId,
        sourceEventId,
      });
      this.inFlight.set(key, existing);

      // Buffer the start entry
      this.pushBuffer({
        url,
        method,
        status: null,
        absStartTimestamp: timestamp,
        absEndTimestamp: null,
        resourceType,
        source,
        requestBody,
        requestId,
        sourceEventId,
      });
    } else {
      // Complete phase — find matching in-flight request
      const key = `${method}:${url}`;
      const candidates = this.inFlight.get(key);

      if (candidates && candidates.length > 0) {
        // Take the oldest matching in-flight request
        const matched = candidates.shift()!;
        if (candidates.length === 0) {
          this.inFlight.delete(key);
        }

        // Find the buffered start entry and update with completion data
        const startEntry = this.buffer.find(
          (e) =>
            e.url === url &&
            e.method === method &&
            e.absStartTimestamp === matched.startTimestamp &&
            e.source === matched.source,
        );

        if (startEntry) {
          startEntry.absEndTimestamp = timestamp;
          startEntry.status = status;
          // Attach requestBody if available from the start phase
          if (requestBody && !startEntry.requestBody) {
            startEntry.requestBody = requestBody;
          }
          // CER-3: late-arriving IDs backfill the start entry
          if (requestId && !startEntry.requestId) startEntry.requestId = requestId;
          if (sourceEventId && !startEntry.sourceEventId) startEntry.sourceEventId = sourceEventId;
        }
      } else {
        // No matching start (missed or from before recording) — create standalone entry.
        // DDC-1: PerformanceObserver completions arrive with no start phase.
        // Tag them 'performance-observer' so dedup can drop them when a
        // fetch/XHR twin (which carries the REAL method + status) exists.
        const isPoEntry =
          source === 'main-world' &&
          (resourceType === 'navigation' || resourceType === 'resource');
        this.pushBuffer({
          url,
          method,
          status,
          absStartTimestamp: timestamp,
          absEndTimestamp: timestamp,
          resourceType,
          source: isPoEntry ? 'performance-observer' : source,
          requestBody,
          requestId,
          sourceEventId,
        });
      }
    }

    // Enforce buffer cap
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }
  }

  /**
   * Push to buffer.
   */
  private pushBuffer(entry: TimestampedNetworkActivity): void {
    this.buffer.push(entry);
  }

  /**
   * Deduplicate entries — prefer main-world over webrequest.
   * CER-3: requestId equality is the primary duplicate signal for
   * webrequest-vs-main-world pairs (exact same HTTP request seen by both
   * channels). URL+method+timestamp remains the fallback when either
   * entry lacks a requestId.
   *
   * DDC-1: Also drop PerformanceObserver duplicates of fetch/XHR patch
   * entries. PO entries carry no method and no real status — when the
   * fetch/XHR twin exists (same URL within DEDUP_WINDOW_MS), the twin is
   * strictly richer, so the PO entry is dropped. Method is NOT compared
   * for PO dedup because PO cannot read the HTTP method.
   */
  private deduplicate(
    entries: TimestampedNetworkActivity[],
  ): TimestampedNetworkActivity[] {
    const result: TimestampedNetworkActivity[] = [];
    const usedWebrequestIndices = new Set<number>();
    const usedPoIndices = new Set<number>();

    // Index webrequest entries by requestId for exact matching
    const webrequestByRequestId = new Map<string, number>();
    entries.forEach((e, i) => {
      if (e.source === 'webrequest' && e.requestId) {
        webrequestByRequestId.set(e.requestId, i);
      }
    });

    for (const entry of entries) {
      if (entry.source === 'main-world') {
        // CER-3: exact-ID dedup — a main-world entry whose requestId
        // matches a webrequest entry is the same HTTP request; the
        // webrequest twin (richer: body, sourceEventId) wins, this drops.
        if (entry.requestId && webrequestByRequestId.has(entry.requestId)) {
          usedWebrequestIndices.delete(webrequestByRequestId.get(entry.requestId)!);
          continue;
        }
        // Mark any webrequest duplicates (fallback: url+method+time)
        for (let i = 0; i < entries.length; i++) {
          if (
            entries[i].source === 'webrequest' &&
            entries[i].url === entry.url &&
            entries[i].method === entry.method &&
            Math.abs(
              entries[i].absStartTimestamp - entry.absStartTimestamp,
            ) < DEDUP_WINDOW_MS
          ) {
            usedWebrequestIndices.add(i);
          }
        }
        // DDC-1: mark any PerformanceObserver duplicates — URL only,
        // no method comparison (PO cannot read the method)
        for (let i = 0; i < entries.length; i++) {
          if (
            entries[i].source === 'performance-observer' &&
            entries[i].url === entry.url &&
            Math.abs(
              entries[i].absStartTimestamp - entry.absStartTimestamp,
            ) < DEDUP_WINDOW_MS
          ) {
            usedPoIndices.add(i);
          }
        }
        result.push(entry);
      }
    }

    // Add webrequest entries that weren't deduplicated
    for (let i = 0; i < entries.length; i++) {
      if (
        entries[i].source === 'webrequest' &&
        !usedWebrequestIndices.has(i)
      ) {
        result.push(entries[i]);
      }
    }

    // DDC-1: add PerformanceObserver entries that weren't deduplicated —
    // these are requests the fetch/XHR patch never saw (document
    // navigations, beacons, CSP-blocked fetches, etc.)
    for (let i = 0; i < entries.length; i++) {
      if (
        entries[i].source === 'performance-observer' &&
        !usedPoIndices.has(i)
      ) {
        result.push(entries[i]);
      }
    }

    return result;
  }
}

// ── Internal Types ───────────────────────────────────────────────────

/**
 * Network activity entry with absolute timestamps for range filtering.
 */
interface TimestampedNetworkActivity {
  url: string;
  method: string;
  status: number | null;
  absStartTimestamp: number;
  absEndTimestamp: number | null;
  resourceType: 'xhr' | 'fetch' | 'unknown' | 'navigation' | 'resource';
  source: 'main-world' | 'webrequest' | 'performance-observer';
  requestBody?: Record<string, string>;
  /** CER-3: webRequest requestId — exact join/dedup key. */
  requestId?: string;
  /** CER-4: trusted-action eventId at request start. */
  sourceEventId?: string;
}
