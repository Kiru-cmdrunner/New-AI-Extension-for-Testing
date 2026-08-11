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
 */
interface NetEventDetail {
  url: string;
  method: string;
  timestamp: number; // performance.now() from MAIN world
  phase: 'start' | 'complete';
  status: number | null;
  resourceType: 'fetch' | 'xhr';
}

/**
 * Raw event from webRequest (forwarded by SW via chrome.runtime message).
 */
interface WebRequestDetail {
  url: string;
  method: string;
  timestamp: number;
  phase: 'start' | 'complete';
  status: number | null;
  requestId: string;
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
   * Start listening for network activity from both sources.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.buffer = [];
    this.inFlight.clear();
    this.mainWorldActive = false;

    // Listen for MAIN-world network events
    this.netListener = (e: Event) => {
      const detail = (e as CustomEvent<NetEventDetail>).detail;
      if (detail) this.handleNetEvent(detail, 'main-world');
    };
    window.addEventListener('cmdrunner-net', this.netListener);

    // Listen for ready signal
    this.readyListener = () => {
      this.mainWorldActive = true;
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
      }
    };
    window.addEventListener('cmdrunner-net-ready', this.readyListener);

    // Set timeout for ready signal (500ms per spec §6.2)
    this.readyTimeout = setTimeout(() => {
      // Ready signal not received — fall back to webRequest-only mode
      this.readyTimeout = null;
    }, 500);

    // Listen for webRequest messages forwarded from SW
    this.messageListener = (msg: unknown) => {
      if (
        msg &&
        typeof msg === 'object' &&
        (msg as { type?: string }).type === 'NETWORK_REQUEST'
      ) {
        const detail = (msg as { detail?: WebRequestDetail }).detail;
        if (detail) this.handleNetEvent(detail, 'webrequest');
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
   * @param openedAt - performance.now() when the evidence window opened
   * @param closedAt - performance.now() when the evidence window closed
   * @returns NetworkActivity[] capped at 50 entries
   */
  collectForRange(openedAt: number, closedAt: number): NetworkActivity[] {
    // Filter entries within the time range
    const inRange = this.buffer.filter(
      (entry) =>
        entry.absStartTimestamp >= openedAt - 50 &&
        entry.absStartTimestamp <= closedAt + 50,
    );

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
   * Get buffer size (for testing).
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Handle a network event from either source.
   */
  private handleNetEvent(
    detail: NetEventDetail | WebRequestDetail,
    source: 'main-world' | 'webrequest',
  ): void {
    if (!this.running) return;

    const url = detail.url;
    const method = detail.method;
    const timestamp = detail.timestamp;
    const phase = detail.phase;
    const status = detail.status;
    const resourceType =
      source === 'main-world'
        ? (detail as NetEventDetail).resourceType
        : 'unknown';

    if (phase === 'start') {
      // Track in-flight
      const key = `${method}:${url}`;
      const existing = this.inFlight.get(key) ?? [];
      existing.push({
        url,
        method,
        startTimestamp: timestamp,
        source,
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
        }
      } else {
        // No matching start (missed or from before recording) — create standalone entry
        this.pushBuffer({
          url,
          method,
          status,
          absStartTimestamp: timestamp,
          absEndTimestamp: timestamp,
          resourceType,
          source,
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
   * Entries from different sources with the same URL + method and
   * timestamps within DEDUP_WINDOW_MS are considered duplicates.
   */
  private deduplicate(
    entries: TimestampedNetworkActivity[],
  ): TimestampedNetworkActivity[] {
    const result: TimestampedNetworkActivity[] = [];
    const usedWebrequestIndices = new Set<number>();

    for (const entry of entries) {
      if (entry.source === 'main-world') {
        // Mark any webrequest duplicates
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
  resourceType: 'xhr' | 'fetch' | 'unknown';
  source: 'main-world' | 'webrequest';
}
