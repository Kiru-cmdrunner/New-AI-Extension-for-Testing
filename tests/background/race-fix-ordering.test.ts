/**
 * RACE FIX regression — onBeforeRequest → onCompleted → onCommitted.
 *
 * Chrome dispatches webRequest.onCompleted for a fast document response
 * BEFORE webNavigation.onCommitted reaches the extension (Amazon add-to-
 * cart: main-frame POST → 200 HTML directly, no redirect).
 *
 * Old behavior: onCompleted DELETED pendingMainFrameByTab[tab], so the
 * commit-time recovery read null and the POST (URL, method, requestBody,
 * sourceEventId) was lost — int-14/int-15 showed zero network evidence.
 *
 * New behavior (ownership handoff): onCompleted only stamps completionStatus;
 * the onCommitted consumer (consumeMainFrameCorrelation) deletes it and
 * receives the stamped status. A stop-recording drain joins surviving ring
 * entries by sourceEventId as the second safety net.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockWebRequestListeners = {
  onBeforeRequest: [] as Array<(d: unknown) => void>,
  onCompleted: [] as Array<(d: unknown) => void>,
  onErrorOccurred: [] as Array<(d: unknown) => void>,
  onBeforeRedirect: [] as Array<(d: unknown) => void>,
};

beforeEach(() => {
  vi.resetModules();
  mockWebRequestListeners.onBeforeRequest = [];
  mockWebRequestListeners.onCompleted = [];
  mockWebRequestListeners.onErrorOccurred = [];
  mockWebRequestListeners.onBeforeRedirect = [];

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
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    tabs: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  };
});

async function importModule() {
  return await import('../../src/background/network-observation');
}

describe('RACE FIX — onCompleted → onCommitted ordering', () => {
  it('LOSING order: pending POST survives onCompleted and is consumed at commit with stamped status', async () => {
    const mod = await importModule();
    await mod.startNetworkObservation(42);

    // The click was stamped as the trusted action before the POST fired.
    mod.setLastTrustedAction(42, { eventId: 'evt-int-14', interactionId: 'int-14' });

    // 1. onBeforeRequest — main-frame form POST
    mockWebRequestListeners.onBeforeRequest[0]({
      url: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bbf_1_glance',
      method: 'POST',
      tabId: 42,
      frameId: 0,
      type: 'main_frame',
      requestId: 'r-add-cart',
      requestBody: {
        formData: { ASIN: ['B0FQF2ZJWT'], quantity: ['1'], 'session-id': ['259-1234567-1234567'] },
      },
    });

    // The authoritative pre-redirect record exists.
    const before = mod.getMainFrameCorrelation(42);
    expect(before).not.toBeNull();
    expect(before!.originalUrl).toContain('/cart/add-to-cart');
    expect(before!.requestBody).toEqual(expect.objectContaining({ ASIN: 'B0FQF2ZJWT' }));
    expect(before!.sourceEventId).toBe('evt-int-14');
    expect(before!.completionStatus).toBeUndefined(); // still in flight

    // 2. onCompleted fires FIRST (the race) — must STAMP, not delete.
    mockWebRequestListeners.onCompleted[0]({
      url: 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bbf_1_glance',
      statusCode: 200,
      tabId: 42,
      frameId: 0,
      type: 'main_frame',
      requestId: 'r-add-cart',
    });

    const stamped = mod.getMainFrameCorrelation(42);
    expect(stamped).not.toBeNull(); // ← the regression: was deleted before this fix
    expect(stamped!.completionStatus).toBe(200);

    // 3. onCommitted arrives late — consumes the record exactly once.
    const consumed = mod.consumeMainFrameCorrelation(42);
    expect(consumed).not.toBeNull();
    expect(consumed!.completionStatus).toBe(200);
    expect(consumed!.requestBody).toEqual(expect.objectContaining({ ASIN: 'B0FQF2ZJWT' }));
    expect(consumed!.sourceEventId).toBe('evt-int-14');

    // Second consume returns null — single ownership.
    expect(mod.consumeMainFrameCorrelation(42)).toBeNull();
  });

  it('WINNING order: commit before completion still sees undefined status (honest null)', async () => {
    const mod = await importModule();
    await mod.startNetworkObservation(42);
    mod.setLastTrustedAction(42, { eventId: 'evt-a', interactionId: 'int-a' });

    mockWebRequestListeners.onBeforeRequest[0]({
      url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
      method: 'POST',
      tabId: 42,
      frameId: 0,
      type: 'main_frame',
      requestId: 'r2',
      requestBody: { formData: { ASIN: ['B0X'], quantity: ['2'] } },
    });

    // Commit FIRST — request still in flight.
    const consumed = mod.consumeMainFrameCorrelation(42);
    expect(consumed).not.toBeNull();
    expect(consumed!.completionStatus).toBeUndefined();

    // Late onCompleted stamps nothing (already consumed) — no crash, no leak.
    mockWebRequestListeners.onCompleted[0]({
      url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
      statusCode: 200,
      tabId: 42,
      requestId: 'r2',
      type: 'main_frame',
      frameId: 0,
    });
    expect(mod.consumeMainFrameCorrelation(42)).toBeNull();
  });

  it('network error stamps completionStatus -1 and survives to commit', async () => {
    const mod = await importModule();
    await mod.startNetworkObservation(42);
    mod.setLastTrustedAction(42, { eventId: 'evt-b', interactionId: 'int-b' });

    mockWebRequestListeners.onBeforeRequest[0]({
      url: 'https://www.amazon.in/cart/add-to-cart/ref=y',
      method: 'POST',
      tabId: 42,
      frameId: 0,
      type: 'main_frame',
      requestId: 'r3',
      requestBody: { formData: { ASIN: ['B0Y'] } },
    });
    mockWebRequestListeners.onErrorOccurred[0]({
      url: 'https://www.amazon.in/cart/add-to-cart/ref=y',
      tabId: 42,
      requestId: 'r3',
      error: 'net::ERR_CONNECTION_RESET',
    });

    const consumed = mod.consumeMainFrameCorrelation(42);
    expect(consumed).not.toBeNull();
    expect(consumed!.completionStatus).toBe(-1);
  });

  it('ring entries are findable by sourceEventId for the stop-recording drain', async () => {
    const mod = await importModule();
    await mod.startNetworkObservation(42);
    mod.setLastTrustedAction(42, { eventId: 'evt-int-14', interactionId: 'int-14' });

    // A sub-frame/XHR POST also stamps the same trusted action.
    mockWebRequestListeners.onBeforeRequest[0]({
      url: 'https://www.amazon.in/hz/cart/ajax-update',
      method: 'POST',
      tabId: 42,
      frameId: 0,
      type: 'xmlhttprequest',
      requestId: 'r-xhr',
      requestBody: { formData: { asin: ['B0FQF2ZJWT'] } },
    });
    mockWebRequestListeners.onCompleted[0]({
      url: 'https://www.amazon.in/hz/cart/ajax-update',
      statusCode: 200,
      tabId: 42,
      requestId: 'r-xhr',
      type: 'xmlhttprequest',
      frameId: 0,
    });

    const byEvent = mod.getCompletedBySourceEventId('evt-int-14');
    expect(byEvent.length).toBeGreaterThanOrEqual(1);
    expect(byEvent.some((r) => r.requestId === 'r-xhr' && r.status === 200)).toBe(true);
  });
});

// ── Drain module (pure) ───────────────────────────────────────────────

describe('RACE FIX — drainNetworkEvidence (stop-recording drain)', () => {

  function makeInteraction(id: string, sourceEventId: string, network: unknown[] = [], endReason = 'lifecycle-complete') {
    return {
      interactionId: id,
      type: 'Click',
      trigger: { accessibleName: 'Add to cart', tag: 'INPUT' },
      behavioralEvidence: {
        sourceEventId,
        sourceEventType: 'click',
        windowId: `w-${id}`,
        frameId: 'main',
        window: { endReason },
        applicationEvidence: {
          networkActivity: network as never,
        },
      },
    } as never;
  }

  it('merges the ring POST onto the click by sourceEventId', () => {
    const click = makeInteraction('int-14', 'evt-int-14');
    const { updatedInteractions, mergedRequestIds } = drainNetworkEvidence([click], [
      {
        url: 'https://www.amazon.in/cart/add-to-cart/ref=x',
        method: 'POST',
        status: 200,
        requestId: 'r-add-cart',
        sourceEventId: 'evt-int-14',
        requestBody: { ASIN: 'B0FQF2ZJWT', quantity: '1' },
        documentRequest: true,
      },
    ]);

    expect(mergedRequestIds).toEqual(['r-add-cart']);
    expect(updatedInteractions.length).toBe(1);
    const net = (click as { behavioralEvidence: { applicationEvidence: { networkActivity: { url: string; method: string; status: number; requestBody?: Record<string, string>; sourceEventId?: string; requestId?: string }[] } } }).behavioralEvidence.applicationEvidence.networkActivity;
    expect(net.length).toBe(1);
    expect(net[0].method).toBe('POST');
    expect(net[0].status).toBe(200);
    expect(net[0].requestBody).toEqual(expect.objectContaining({ ASIN: 'B0FQF2ZJWT' }));
    expect(net[0].sourceEventId).toBe('evt-int-14');
  });

  it('skips telemetry/noise entries — no beacon ever reaches the click', () => {
    const click = makeInteraction('int-14', 'evt-int-14');
    const { mergedRequestIds } = drainNetworkEvidence([click], [
      { url: 'https://fls-eu.amazon.in/1/batch/1/OP/abc', method: 'GET', status: 200, requestId: 'r-fls', sourceEventId: 'evt-int-14' },
      { url: 'https://www.amazon.in/rd/uedata?rid=1', method: 'GET', status: 200, requestId: 'r-ue', sourceEventId: 'evt-int-14' },
      { url: 'https://unagi.amazon.in/1/events/com.amazon.csm', method: 'POST', status: 200, requestId: 'r-unagi', sourceEventId: 'evt-int-14' },
    ]);
    expect(mergedRequestIds).toEqual([]);
  });

  it('exactly-once: a requestId already captured directly is not merged again', () => {
    const click = makeInteraction('int-14', 'evt-int-14', [
      { url: 'https://www.amazon.in/cart/add-to-cart/ref=x', method: 'POST', status: 200, requestId: 'r-add-cart' },
    ]);
    const { mergedRequestIds, updatedInteractions } = drainNetworkEvidence([click], [
      { url: 'https://www.amazon.in/cart/add-to-cart/ref=x', method: 'POST', status: 200, requestId: 'r-add-cart', sourceEventId: 'evt-int-14', requestBody: { ASIN: 'B0FQF2ZJWT' } },
    ]);
    expect(mergedRequestIds).toEqual([]);
    expect(updatedInteractions).toEqual([]);
  });

  it('unstamped or unmatched entries are never guessed onto anyone', () => {
    const click = makeInteraction('int-14', 'evt-int-14');
    const nav = makeInteraction('int-15', 'evt-int-15', [], 'page-reload-synthetic');
    const { mergedRequestIds } = drainNetworkEvidence([click, nav], [
      { url: 'https://x.example.com/api', method: 'POST', status: 200, requestId: 'r1' }, // unstamped
      { url: 'https://y.example.com/api', method: 'POST', status: 200, requestId: 'r2', sourceEventId: 'evt-ghost' }, // unmatched
    ]);
    expect(mergedRequestIds).toEqual([]);
  });

  it('synthetic-navigation interactions are not merge targets', () => {
    const nav = makeInteraction('int-15', 'evt-int-15', [], 'page-reload-synthetic');
    const { mergedRequestIds, updatedInteractions } = drainNetworkEvidence([nav], [
      { url: 'https://www.amazon.in/cart/add-to-cart/ref=x', method: 'POST', status: 200, requestId: 'r9', sourceEventId: 'evt-int-15' },
    ]);
    expect(mergedRequestIds).toEqual([]);
    expect(updatedInteractions).toEqual([]);
  });
});

import { drainNetworkEvidence } from '../../src/background/network-drain';
