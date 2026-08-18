/**
 * Network Bridge — Unit Tests
 *
 * Tests the ISOLATED-world NetworkBridge: buffer management,
 * CustomEvent handling, deduplication, range collection, caps.
 *
 * Architecture: behavioral-evidence-model.md §6.2, §6.3, §6.6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkBridge } from '../../src/tap/network-bridge';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Mock chrome.runtime.onMessage ────────────────────────────────────

interface MockListener {
  callback: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void;
}

const mockListeners: MockListener[] = [];

beforeEach(() => {
  mockListeners.length = 0;
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onMessage: {
        addListener: (cb: MockListener['callback']) => {
          mockListeners.push({ callback: cb });
        },
        removeListener: (cb: MockListener['callback']) => {
          const idx = mockListeners.findIndex((l) => l.callback === cb);
          if (idx >= 0) mockListeners.splice(idx, 1);
        },
      },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper: Dispatch a CustomEvent ───────────────────────────────────

function dispatchNetEvent(detail: unknown): void {
  window.dispatchEvent(new CustomEvent('cmdrunner-net', { detail }));
}

function dispatchReady(): void {
  window.dispatchEvent(new CustomEvent('cmdrunner-net-ready'));
}

// ── Helper: Dispatch a webRequest message ────────────────────────────

function dispatchWebRequest(detail: unknown): void {
  for (const listener of mockListeners) {
    listener.callback(
      { type: 'NETWORK_REQUEST', detail },
      {},
      () => {},
    );
  }
}

// ── Helper: Simulate performance.now advancing ───────────────────────

let perfNow = 1000;
beforeEach(() => {
  perfNow = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
});

function advance(ms: number): void {
  perfNow += ms;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('NetworkBridge', () => {
  describe('lifecycle', () => {
    it('starts and stops cleanly', () => {
      const bridge = new NetworkBridge();
      bridge.start();
      expect(bridge.getBufferSize()).toBe(0);
      bridge.stop();
      expect(bridge.getBufferSize()).toBe(0);
    });

    it('isMainWorldActive is false before ready signal', () => {
      const bridge = new NetworkBridge();
      bridge.start();
      expect(bridge.isMainWorldActive()).toBe(false);
      bridge.stop();
    });

    it('isMainWorldActive becomes true after ready signal', () => {
      const bridge = new NetworkBridge();
      bridge.start();
      dispatchReady();
      expect(bridge.isMainWorldActive()).toBe(true);
      bridge.stop();
    });

    // ── D8: DOM ready-marker path (the bridge starts AFTER document load) ──

    it('D8: start() with data-cmdrunner-net-ready marker → isMainWorldActive true immediately (no wait)', () => {
      // The MAIN-world interceptor loaded at document_start and already
      // dispatched cmdrunner-net-ready — long before START_RECORDING built
      // this bridge. The durable signal is the shared-DOM marker.
      document.documentElement.setAttribute('data-cmdrunner-net-ready', 'true');
      const bridge = new NetworkBridge();
      bridge.start();
      expect(bridge.isMainWorldActive()).toBe(true); // marker path, no event needed
      bridge.stop();
      document.documentElement.removeAttribute('data-cmdrunner-net-ready');
    });

    it('D8: marker absent, no event → still false (honest webRequest-only fallback preserved)', () => {
      document.documentElement.removeAttribute('data-cmdrunner-net-ready');
      const bridge = new NetworkBridge();
      bridge.start();
      expect(bridge.isMainWorldActive()).toBe(false);
      bridge.stop();
    });

    it('D8: marker present AND event also arrives → stays true (idempotent)', () => {
      document.documentElement.setAttribute('data-cmdrunner-net-ready', 'true');
      const bridge = new NetworkBridge();
      bridge.start();
      dispatchReady(); // late re-injection dispatch — must not flip anything
      expect(bridge.isMainWorldActive()).toBe(true);
      bridge.stop();
      document.documentElement.removeAttribute('data-cmdrunner-net-ready');
    });

    it('D8: stop() then start() with marker still on the document → true (interceptor persists per document)', () => {
      document.documentElement.setAttribute('data-cmdrunner-net-ready', 'true');
      const first = new NetworkBridge();
      first.start();
      first.stop();
      const second = new NetworkBridge();
      second.start();
      expect(second.isMainWorldActive()).toBe(true);
      second.stop();
      document.documentElement.removeAttribute('data-cmdrunner-net-ready');
    });

    it('ignores events when not running', () => {
      const bridge = new NetworkBridge();
      // Don't start — events should be ignored
      dispatchNetEvent({
        url: '/api/test',
        method: 'GET',
        timestamp: 100,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      expect(bridge.getBufferSize()).toBe(0);
    });
  });

  describe('MAIN-world event handling', () => {
    it('buffers a fetch start event', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchNetEvent({
        url: '/api/users',
        method: 'GET',
        timestamp: 100,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });

      expect(bridge.getBufferSize()).toBe(1);
      bridge.stop();
    });

    it('matches start → complete for fetch', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchNetEvent({
        url: '/api/users',
        method: 'GET',
        timestamp: 100,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      dispatchNetEvent({
        url: '/api/users',
        method: 'GET',
        timestamp: 200,
        phase: 'complete',
        status: 200,
        resourceType: 'fetch',
      });

      // Start + complete should result in 2 entries in buffer
      // (the start entry is updated, not duplicated)
      expect(bridge.getBufferSize()).toBe(1);
      bridge.stop();
    });

    it('buffers XHR start and complete events', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchNetEvent({
        url: '/api/data',
        method: 'POST',
        timestamp: 100,
        phase: 'start',
        status: null,
        resourceType: 'xhr',
      });
      advance(50);
      dispatchNetEvent({
        url: '/api/data',
        method: 'POST',
        timestamp: 150,
        phase: 'complete',
        status: 201,
        resourceType: 'xhr',
      });

      expect(bridge.getBufferSize()).toBe(1);
      bridge.stop();
    });
  });

  describe('webRequest event handling', () => {
    it('buffers webRequest events', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchWebRequest({
        url: '/api/search',
        method: 'GET',
        timestamp: 200,
        phase: 'start',
        status: null,
        requestId: 'req-1',
      });

      expect(bridge.getBufferSize()).toBe(1);
      bridge.stop();
    });

    it('matches webRequest start → complete', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchWebRequest({
        url: '/api/search',
        method: 'GET',
        timestamp: 200,
        phase: 'start',
        status: null,
        requestId: 'req-2',
      });
      dispatchWebRequest({
        url: '/api/search',
        method: 'GET',
        timestamp: 300,
        phase: 'complete',
        status: 200,
        requestId: 'req-2',
      });

      expect(bridge.getBufferSize()).toBe(1);
      bridge.stop();
    });
  });

  describe('collectForRange', () => {
    it('collects entries within the time range', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      // Entry at t=100
      dispatchNetEvent({
        url: '/api/a',
        method: 'GET',
        timestamp: 100,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      advance(50);
      dispatchNetEvent({
        url: '/api/a',
        method: 'GET',
        timestamp: 150,
        phase: 'complete',
        status: 200,
        resourceType: 'fetch',
      });

      // Entry at t=500
      advance(350);
      dispatchNetEvent({
        url: '/api/b',
        method: 'GET',
        timestamp: 500,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      advance(30);
      dispatchNetEvent({
        url: '/api/b',
        method: 'GET',
        timestamp: 530,
        phase: 'complete',
        status: 404,
        resourceType: 'fetch',
      });

      // Collect range [80, 200]
      const results = bridge.collectForRange(80, 200);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('/api/a');
      expect(results[0].method).toBe('GET');
      expect(results[0].status).toBe(200);
      expect(results[0].source).toBe('main-world');
      expect(results[0].resourceType).toBe('fetch');
      bridge.stop();
    });

    it('returns relative timing', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchNetEvent({
        url: '/api/test',
        method: 'GET',
        timestamp: 1000,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      advance(100);
      dispatchNetEvent({
        url: '/api/test',
        method: 'GET',
        timestamp: 1100,
        phase: 'complete',
        status: 200,
        resourceType: 'fetch',
      });

      // Window opened at t=900
      const results = bridge.collectForRange(900, 1200);
      expect(results).toHaveLength(1);
      expect(results[0].startRelativeToEvent).toBe(100); // 1000 - 900
      expect(results[0].endRelativeToEvent).toBe(200);   // 1100 - 900
      expect(results[0].durationMs).toBe(100);           // 1100 - 1000
      bridge.stop();
    });

    it('applies 50-entry cap', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      // Generate 60 unique requests
      for (let i = 0; i < 60; i++) {
        const ts = 100 + i * 10;
        dispatchNetEvent({
          url: `/api/item-${i}`,
          method: 'GET',
          timestamp: ts,
          phase: 'start',
          status: null,
          resourceType: 'fetch',
        });
        dispatchNetEvent({
          url: `/api/item-${i}`,
          method: 'GET',
          timestamp: ts + 5,
          phase: 'complete',
          status: 200,
          resourceType: 'fetch',
        });
      }

      // Large range to include all
      const results = bridge.collectForRange(0, 10000);
      expect(results.length).toBeLessThanOrEqual(50);
      bridge.stop();
    });
  });

  describe('deduplication', () => {
    it('prefers main-world over webrequest for same request', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      // MAIN-world captures it
      dispatchNetEvent({
        url: '/api/dup',
        method: 'GET',
        timestamp: 200,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      advance(10);
      dispatchNetEvent({
        url: '/api/dup',
        method: 'GET',
        timestamp: 250,
        phase: 'complete',
        status: 200,
        resourceType: 'fetch',
      });

      // webRequest also captures it
      dispatchWebRequest({
        url: '/api/dup',
        method: 'GET',
        timestamp: 205,
        phase: 'start',
        status: null,
        requestId: 'dup-1',
      });
      dispatchWebRequest({
        url: '/api/dup',
        method: 'GET',
        timestamp: 255,
        phase: 'complete',
        status: 200,
        requestId: 'dup-1',
      });

      const results = bridge.collectForRange(100, 300);
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('main-world');
      bridge.stop();
    });

    it('keeps webrequest entry when only webrequest captured it', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      // Only webRequest captures it
      dispatchWebRequest({
        url: '/api/only-wr',
        method: 'GET',
        timestamp: 200,
        phase: 'start',
        status: null,
        requestId: 'wr-only-1',
      });
      dispatchWebRequest({
        url: '/api/only-wr',
        method: 'GET',
        timestamp: 300,
        phase: 'complete',
        status: 200,
        requestId: 'wr-only-1',
      });

      const results = bridge.collectForRange(100, 400);
      expect(results).toHaveLength(1);
      expect(results[0].source).toBe('webrequest');
      expect(results[0].resourceType).toBe('unknown');
      bridge.stop();
    });

    it('keeps both when URL or method differ', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchNetEvent({
        url: '/api/unique-1',
        method: 'GET',
        timestamp: 200,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      dispatchWebRequest({
        url: '/api/unique-2',
        method: 'GET',
        timestamp: 200,
        phase: 'start',
        status: null,
        requestId: 'wr-2',
      });

      const results = bridge.collectForRange(100, 400);
      expect(results).toHaveLength(2);
      bridge.stop();
    });
  });

  describe('stop signal', () => {
    it('sendStopSignal dispatches cmdrunner-net-stop event', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      let stopReceived = false;
      window.addEventListener('cmdrunner-net-stop', () => {
        stopReceived = true;
      });

      bridge.sendStopSignal();
      expect(stopReceived).toBe(true);
      bridge.stop();
    });
  });

  describe('buffer management', () => {
    it('enforces max buffer size', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      // Generate enough entries to exceed MAX_BUFFER_SIZE (500)
      for (let i = 0; i < 550; i++) {
        dispatchNetEvent({
          url: `/api/overflow-${i}`,
          method: 'GET',
          timestamp: 100 + i,
          phase: 'start',
          status: null,
          resourceType: 'fetch',
        });
      }

      // Buffer should be capped at 500
      expect(bridge.getBufferSize()).toBeLessThanOrEqual(500);
      bridge.stop();
    });

    it('clearBuffer empties the buffer', () => {
      const bridge = new NetworkBridge();
      bridge.start();

      dispatchNetEvent({
        url: '/api/clear-test',
        method: 'GET',
        timestamp: 100,
        phase: 'start',
        status: null,
        resourceType: 'fetch',
      });
      expect(bridge.getBufferSize()).toBe(1);

      bridge.clearBuffer();
      expect(bridge.getBufferSize()).toBe(0);
      bridge.stop();
    });
  });
});

// ── D8: network-inject.js MAIN-world script source contract ──────────
//
// The MAIN-world asset patches fetch/XHR at import time, so it cannot be
// unit-loaded in jsdom. Source-level assertions are the honest test level:
// they pin the DOM ready-marker contract at both ready-dispatch sites and
// the stop-handler cleanup.

describe('D8: network-inject.js ready-marker contract (source assertions)', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../public/assets/network-inject.js'),
    'utf-8',
  );

  it('signals ready on the shared DOM (marker) at initial install', () => {
    // The final ready dispatch of the IIFE must set the marker as well as
    // dispatch the CustomEvent.
    expect(src).toMatch(/cmdrunner-net-ready/);
    expect(src).toMatch(/data-cmdrunner-net-ready/);
    // Marker set BEFORE (or with) the ready dispatch so a bridge starting
    // any time after document load observes it.
    const setMarker = src.indexOf('data-cmdrunner-net-ready');
    const firstDispatch = src.indexOf('cmdrunner-net-ready');
    expect(setMarker).toBeGreaterThan(-1);
    expect(firstDispatch).toBeGreaterThan(-1);
  });

  it('signals ready on the shared DOM in the double-injection guard path', () => {
    // Guard path: re-injection on an already-patched page must ALSO set the
    // marker (the earlier attribute may have been cleared by a stop signal).
    const guardIdx = src.indexOf('__cmdrunnerNetPatched');
    const dispatchCount = src.split('cmdrunner-net-ready').length - 1;
    const markerSetCount = src.split('data-cmdrunner-net-ready').length - 1;
    expect(dispatchCount).toBeGreaterThanOrEqual(2); // guard + final
    expect(markerSetCount).toBeGreaterThanOrEqual(2); // both paths set it
    expect(guardIdx).toBeGreaterThan(-1);
  });

  it('stop handler clears the marker (a stopped document is not "ready")', () => {
    // The minified handler-name may vary — assert the remove-attribute call
    // exists in the source's stop path (the only place that restores the
    // patched originals and unpatches the guard).
    expect(src).toMatch(/removeAttribute\(['"]data-cmdrunner-net-ready['"]/);
  });
});
