/**
 * MV3 Lifecycle Network Continuity — Regression Tests
 *
 * Proves the three structural fixes:
 *   A. webRequest listeners register at MODULE LOAD (SW restart simulation)
 *      and are gated by the persisted observing-tabs set — capture survives
 *      service-worker death mid-recording.
 *   B. activeTabId/observing-tabs persisted; fresh SW instance re-seeds the
 *      gate from storage, restores the last trusted action, and a
 *      main-frame POST is still stamped with sourceEventId + recovered by
 *      getCompletedBySourceEventId (drain join).
 *   C. MAIN-world interceptor is a manifest content script, recording-gated
 *      via the data-cmdrunner-net-active attribute; recorder-entry sets and
 *      clears the gate.
 *
 * Spec: .drytis/specs/mv3-lifecycle-network-continuity.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock chrome APIs ─────────────────────────────────────────────────

const mockWebRequestListeners = {
  onBeforeRequest: [] as Array<(d: unknown) => void>,
  onCompleted: [] as Array<(d: unknown) => void>,
  onErrorOccurred: [] as Array<(d: unknown) => void>,
  onBeforeRedirect: [] as Array<(d: unknown) => void>,
};

/** In-memory chrome.storage.local implementation. */
const storageData = new Map<string, unknown>();

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockScriptingExecuteScript = vi.fn().mockResolvedValue([]);

function installChrome(): void {
  (globalThis as Record<string, unknown>).chrome = {
    webRequest: {
      onBeforeRequest: {
        addListener: (cb: (d: unknown) => void) => mockWebRequestListeners.onBeforeRequest.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          const i = mockWebRequestListeners.onBeforeRequest.indexOf(cb);
          if (i >= 0) mockWebRequestListeners.onBeforeRequest.splice(i, 1);
        },
      },
      onCompleted: {
        addListener: (cb: (d: unknown) => void) => mockWebRequestListeners.onCompleted.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          const i = mockWebRequestListeners.onCompleted.indexOf(cb);
          if (i >= 0) mockWebRequestListeners.onCompleted.splice(i, 1);
        },
      },
      onErrorOccurred: {
        addListener: (cb: (d: unknown) => void) => mockWebRequestListeners.onErrorOccurred.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          const i = mockWebRequestListeners.onErrorOccurred.indexOf(cb);
          if (i >= 0) mockWebRequestListeners.onErrorOccurred.splice(i, 1);
        },
      },
      onBeforeRedirect: {
        addListener: (cb: (d: unknown) => void) => mockWebRequestListeners.onBeforeRedirect.push(cb),
        removeListener: (cb: (d: unknown) => void) => {
          const i = mockWebRequestListeners.onBeforeRedirect.indexOf(cb);
          if (i >= 0) mockWebRequestListeners.onBeforeRedirect.splice(i, 1);
        },
      },
    },
    scripting: {
      executeScript: mockScriptingExecuteScript,
    },
    tabs: {
      sendMessage: mockSendMessage,
    },
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of keyList) {
            if (storageData.has(k)) out[k] = storageData.get(k);
          }
          return Promise.resolve(out);
        },
        set: (record: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(record)) storageData.set(k, v);
          return Promise.resolve();
        },
      },
    },
  };
}

function resetMocks(): void {
  mockWebRequestListeners.onBeforeRequest = [];
  mockWebRequestListeners.onCompleted = [];
  mockWebRequestListeners.onErrorOccurred = [];
  mockWebRequestListeners.onBeforeRedirect = [];
  storageData.clear();
  mockSendMessage.mockClear();
  mockScriptingExecuteScript.mockClear();
}

async function importFresh(): Promise<typeof import('../../src/background/network-observation')> {
  return await import('../../src/background/network-observation');
}

/** Fire a main-frame POST through the registered onBeforeRequest listener. */
function fireBeforeRequest(tabId: number, requestId: string, url: string, method = 'POST', body?: Record<string, string[]>) {
  const cb = mockWebRequestListeners.onBeforeRequest[mockWebRequestListeners.onBeforeRequest.length - 1];
  expect(cb).toBeTruthy();
  cb!({
    tabId,
    requestId,
    url,
    method,
    type: 'main_frame',
    frameId: 0,
    requestBody: body ? { formData: body } : undefined,
  });
}

function fireCompleted(tabId: number, requestId: string, url: string, status = 200) {
  const cb = mockWebRequestListeners.onCompleted[mockWebRequestListeners.onCompleted.length - 1];
  expect(cb).toBeTruthy();
  cb!({ tabId, requestId, url, statusCode: status, frameId: 0, type: 'main_frame' });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MV3 lifecycle network continuity', () => {
  beforeEach(() => {
    vi.resetModules();
    resetMocks();
    installChrome();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Fix A — top-level registration', () => {
    it('registers all four webRequest listeners at module import (SW start)', async () => {
      await importFresh();
      expect(mockWebRequestListeners.onBeforeRequest).toHaveLength(1);
      expect(mockWebRequestListeners.onBeforeRedirect).toHaveLength(1);
      expect(mockWebRequestListeners.onCompleted).toHaveLength(1);
      expect(mockWebRequestListeners.onErrorOccurred).toHaveLength(1);
    });

    it('startNetworkObservation does not double-register (idempotent)', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);
      expect(mockWebRequestListeners.onBeforeRequest).toHaveLength(1);
    });

    it('stopNetworkObservation keeps listeners registered (gate, not teardown)', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);
      mod.stopNetworkObservation(7);
      expect(mockWebRequestListeners.onBeforeRequest).toHaveLength(1);
    });

    it('requests from non-observing tabs are ignored after gate seeded', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);
      mod.stopNetworkObservation(7);
      // Gate now genuinely empty + seeded → tab 9 traffic must be ignored
      storageData.delete('cmdrunner_net_observing_tabs');
      fireBeforeRequest(9, 'req-x', 'https://example.com/x');
      expect(mod.getRecentRequests(0)).toHaveLength(0);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Fix B — SW restart mid-recording', () => {
    it('persists observing tabs and the last trusted action', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);
      mod.setLastTrustedAction(7, { eventId: 'click-19', interactionId: 'int-19' });

      expect(storageData.get('cmdrunner_net_observing_tabs')).toEqual([7]);
      expect(storageData.get('cmdrunner_net_last_action')).toMatchObject({
        tabId: 7,
        action: { eventId: 'click-19', interactionId: 'int-19' },
      });
    });

    it('fresh SW instance re-seeds gate from storage and still captures the POST', async () => {
      // SW instance 1 starts recording
      const mod1 = await importFresh();
      await mod1.startNetworkObservation(7);
      mod1.setLastTrustedAction(7, { eventId: 'click-19', interactionId: 'int-19' });

      // ── SW DIES (module state reset — fresh import = fresh instance) ──
      const mod2 = await importFresh();
      // Module-load top-level registration ran: listeners registered again.
      expect(mockWebRequestListeners.onBeforeRequest.length).toBeGreaterThan(0);

      // The click's POST fires while the fresh SW is live (tab still
      // recording per the persisted gate).
      fireBeforeRequest(7, 'req-100', 'https://www.amazon.in/cart/add-to-cart', 'POST', {
        ASIN: ['B0FQF2ZJWT'],
        quantity: ['1'],
      });

      // No in-memory lastTrustedAction in this instance — the persisted
      // action was restored from storage at module load.
      // (restore is async; the sourceEventId join uses whatever was stamped.)
      fireCompleted(7, 'req-100', 'https://www.amazon.in/cart/add-to-cart', 200);

      // Stop-time drain join still finds it by sourceEventId
      const recovered = mod2.getCompletedBySourceEventId('click-19');
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toMatchObject({
        url: 'https://www.amazon.in/cart/add-to-cart',
        method: 'POST',
        status: 200,
        requestId: 'req-100',
        requestBody: { ASIN: 'B0FQF2ZJWT', quantity: '1' },
      });
    });

    it('unknown-state buffering: request before gate seed is buffered, not forwarded', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);

      // Simulate SW death + wake with an UNSEEDED gate: storage reports an
      // observing tab, but the in-memory set is empty and gateSeeded=false.
      const mod2 = await importFresh();
      // Manually reset in-memory gate without touching storage (simulates
      // the wake window where the storage read has not resolved).
      const restore = mod2.__testSetGateStateForSim as ((v: { seeded: boolean; tabs: number[] }) => void) | undefined;
      if (restore) restore({ seeded: false, tabs: [] });

      fireBeforeRequest(7, 'req-200', 'https://api.example.com/orders', 'POST');
      fireCompleted(7, 'req-200', 'https://api.example.com/orders', 201);

      // Buffered SW-side (ring), NOT forwarded to the content script
      const recent = mod2.getRecentRequests(0);
      expect(recent.some((r) => r.requestId === 'req-200')).toBe(true);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('stop clears the persisted observing set', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);
      expect(storageData.get('cmdrunner_net_observing_tabs')).toEqual([7]);
      mod.stopNetworkObservation(7);
      expect(storageData.get('cmdrunner_net_observing_tabs')).toEqual([]);
    });
  });

  describe('Fix C — MAIN-world interceptor gating', () => {
    it('manifest declares network-inject.js as a MAIN-world content script', async () => {
      const manifest = (await import('../../src/manifest.json')).default;
      const entry = (manifest.content_scripts ?? []).find((cs: { js?: string[] }) =>
        (cs.js ?? []).some((j: string) => j.includes('network-inject')),
      );
      expect(entry).toBeTruthy();
      expect(entry).toMatchObject({
        world: 'MAIN',
        run_at: 'document_start',
        all_frames: true,
      });
    });

    it('network-inject.js gates dispatches on data-cmdrunner-net-active', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../public/assets/network-inject.js'),
        'utf-8',
      );
      // Gate helper reads the shared-DOM attribute
      expect(src).toContain("data-cmdrunner-net-active");
      expect(src).toContain("getAttribute('data-cmdrunner-net-active') === 'true'");
      // Dispatch is gated
      expect(src).toContain('if (!isRecordingActive()) return');
    });

    it('recorder-entry sets and clears the gate attribute', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../src/recorder/phase5/recorder-entry.ts'),
        'utf-8',
      );
      expect(src).toContain("setAttribute('data-cmdrunner-net-active', 'true')");
      expect(src).toContain("setAttribute('data-cmdrunner-net-active', 'false')");
    });

    it('dynamic injection is retained as idempotent fallback', async () => {
      const mod = await importFresh();
      await mod.startNetworkObservation(7);
      expect(mockScriptingExecuteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 7, allFrames: true },
          world: 'MAIN',
          injectImmediately: true,
        }),
      );
    });
  });

  describe('requestId/sourceEventId correlation survives restart', () => {
    it('drain join key (sourceEventId) is stamped on post-restart captures', async () => {
      const mod1 = await importFresh();
      await mod1.startNetworkObservation(7);
      mod1.setLastTrustedAction(7, { eventId: 'click-42', interactionId: 'int-42' });

      const mod2 = await importFresh(); // SW restart
      fireBeforeRequest(7, 'req-300', 'https://app.example.com/api/save', 'POST');
      fireCompleted(7, 'req-300', 'https://app.example.com/api/save', 200);

      const recovered = mod2.getCompletedBySourceEventId('click-42');
      expect(recovered).toHaveLength(1);
      expect(recovered[0].sourceEventId).toBe('click-42');
      expect(recovered[0].requestId).toBe('req-300');
    });
  });
});
