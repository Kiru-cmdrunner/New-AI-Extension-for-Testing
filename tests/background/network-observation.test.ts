/**
 * Network Observation — Unit Tests
 *
 * Tests the SW-side NetworkObservation module: webRequest listener
 * registration, MAIN-world injection orchestration, tab filtering,
 * forward to content script.
 *
 * Architecture: behavioral-evidence-model.md §6.2, §6.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock chrome APIs ─────────────────────────────────────────────────

const mockWebRequestListeners = {
  onBeforeRequest: [] as Array<(d: unknown) => void>,
  onCompleted: [] as Array<(d: unknown) => void>,
  onErrorOccurred: [] as Array<(d: unknown) => void>,
};

const mockScriptingExecuteScript = vi.fn();

beforeEach(() => {
  // Reset module state by re-importing
  vi.resetModules();

  mockWebRequestListeners.onBeforeRequest = [];
  mockWebRequestListeners.onCompleted = [];
  mockWebRequestListeners.onErrorOccurred = [];
  mockScriptingExecuteScript.mockClear();

  (globalThis as Record<string, unknown>).chrome = {
    webRequest: {
      onBeforeRequest: {
        addListener: (cb: (d: unknown) => void) => {
          mockWebRequestListeners.onBeforeRequest.push(cb);
        },
        removeListener: (cb: (d: unknown) => void) => {
          const idx = mockWebRequestListeners.onBeforeRequest.indexOf(cb);
          if (idx >= 0) mockWebRequestListeners.onBeforeRequest.splice(idx, 1);
        },
      },
      onCompleted: {
        addListener: (cb: (d: unknown) => void) => {
          mockWebRequestListeners.onCompleted.push(cb);
        },
        removeListener: (cb: (d: unknown) => void) => {
          const idx = mockWebRequestListeners.onCompleted.indexOf(cb);
          if (idx >= 0) mockWebRequestListeners.onCompleted.splice(idx, 1);
        },
      },
      onErrorOccurred: {
        addListener: (cb: (d: unknown) => void) => {
          mockWebRequestListeners.onErrorOccurred.push(cb);
        },
        removeListener: (cb: (d: unknown) => void) => {
          const idx = mockWebRequestListeners.onErrorOccurred.indexOf(cb);
          if (idx >= 0) mockWebRequestListeners.onErrorOccurred.splice(idx, 1);
        },
      },
    },
    scripting: {
      executeScript: mockScriptingExecuteScript.mockResolvedValue([]),
    },
    tabs: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helper: dynamically import after mock setup ──────────────────────

async function importModule() {
  return await import('../../src/background/network-observation');
}

// ── Helper: Simulate performance.now ─────────────────────────────────

let perfNow = 1000;
beforeEach(() => {
  perfNow = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
});

// ── Tests ────────────────────────────────────────────────────────────

describe('NetworkObservation', () => {
  describe('startNetworkObservation', () => {
    it('registers webRequest listeners', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(123);

      expect(mockWebRequestListeners.onBeforeRequest).toHaveLength(1);
      expect(mockWebRequestListeners.onCompleted).toHaveLength(1);
      expect(mockWebRequestListeners.onErrorOccurred).toHaveLength(1);
    });

    it('injects MAIN-world script', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(123);

      expect(mockScriptingExecuteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 123, allFrames: true },
          world: 'MAIN',
          files: ['assets/network-inject.js'],
          injectImmediately: true,
        }),
      );
    });

    it('isObserving returns true after start', async () => {
      const mod = await importModule();
      expect(mod.isObserving()).toBe(false);
      await mod.startNetworkObservation(123);
      expect(mod.isObserving()).toBe(true);
    });

    it('continues if MAIN-world injection fails', async () => {
      mockScriptingExecuteScript.mockRejectedValueOnce(new Error('CSP blocked'));
      const mod = await importModule();

      // Should not throw
      await mod.startNetworkObservation(123);
      expect(mod.isObserving()).toBe(true);
    });
  });

  describe('stopNetworkObservation', () => {
    it('removes webRequest listeners', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(123);
      expect(mod.isObserving()).toBe(true);

      mod.stopNetworkObservation(123);
      expect(mod.isObserving()).toBe(false);
      expect(mockWebRequestListeners.onBeforeRequest).toHaveLength(0);
      expect(mockWebRequestListeners.onCompleted).toHaveLength(0);
      expect(mockWebRequestListeners.onErrorOccurred).toHaveLength(0);
    });
  });

  describe('tab filtering', () => {
    it('forwards requests from the active tab', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(42);

      const sendMessageMock = (globalThis as { chrome?: { tabs?: { sendMessage?: unknown } } })
        .chrome?.tabs?.sendMessage as ReturnType<typeof vi.fn>;
      sendMessageMock.mockClear();

      // Simulate onBeforeRequest for the active tab
      const callback = mockWebRequestListeners.onBeforeRequest[0];
      callback({
        url: 'https://example.com/api',
        method: 'GET',
        tabId: 42,
        requestId: 'r1',
      });

      expect(sendMessageMock).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'NETWORK_REQUEST',
          detail: expect.objectContaining({
            url: 'https://example.com/api',
            method: 'GET',
            phase: 'start',
          }),
        }),
      );
    });

    it('ignores requests from other tabs', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(42);

      const sendMessageMock = (globalThis as { chrome?: { tabs?: { sendMessage?: unknown } } })
        .chrome?.tabs?.sendMessage as ReturnType<typeof vi.fn>;
      sendMessageMock.mockClear();

      // Simulate onBeforeRequest for a different tab
      const callback = mockWebRequestListeners.onBeforeRequest[0];
      callback({
        url: 'https://other.com/api',
        method: 'GET',
        tabId: 999,
        requestId: 'r2',
      });

      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('forwards completion with status code', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(42);

      // First fire the start
      const startCb = mockWebRequestListeners.onBeforeRequest[0];
      startCb({
        url: 'https://example.com/api',
        method: 'POST',
        tabId: 42,
        requestId: 'r3',
      });

      const sendMessageMock = (globalThis as { chrome?: { tabs?: { sendMessage?: unknown } } })
        .chrome?.tabs?.sendMessage as ReturnType<typeof vi.fn>;
      sendMessageMock.mockClear();

      // Then fire the completion
      const completeCb = mockWebRequestListeners.onCompleted[0];
      completeCb({
        url: 'https://example.com/api',
        method: 'POST',
        tabId: 42,
        requestId: 'r3',
        statusCode: 201,
      });

      expect(sendMessageMock).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'NETWORK_REQUEST',
          detail: expect.objectContaining({
            phase: 'complete',
            status: 201,
          }),
        }),
      );
    });
  });

  describe('error handling', () => {
    it('forwards errorOccurred as complete with status 0', async () => {
      const mod = await importModule();
      await mod.startNetworkObservation(42);

      // Fire start first
      const startCb = mockWebRequestListeners.onBeforeRequest[0];
      startCb({
        url: 'https://example.com/fail',
        method: 'GET',
        tabId: 42,
        requestId: 'r4',
      });

      const sendMessageMock = (globalThis as { chrome?: { tabs?: { sendMessage?: unknown } } })
        .chrome?.tabs?.sendMessage as ReturnType<typeof vi.fn>;
      sendMessageMock.mockClear();

      // Fire error
      const errorCb = mockWebRequestListeners.onErrorOccurred[0];
      errorCb({
        url: 'https://example.com/fail',
        tabId: 42,
        requestId: 'r4',
        error: 'net::ERR_FAILED',
      });

      expect(sendMessageMock).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'NETWORK_REQUEST',
          detail: expect.objectContaining({
            phase: 'complete',
            status: 0,
          }),
        }),
      );
    });
  });
});
