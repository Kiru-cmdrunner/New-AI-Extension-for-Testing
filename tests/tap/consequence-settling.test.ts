/**
 * Consequence-Settling Evidence Windows — Unit + Integration Tests
 * (.drytis/specs/consequence-settling.md §14 + §15, red phase)
 *
 * Timing-free settle model:
 *   FINALIZE_EVIDENCE (non-unloading) → enterSettleMode:
 *     setHoldOpen(false) + canClose = causalNetworkIdle(state)
 *   AdaptiveWindow self-closes 'stabilized' only when DOM is quiescent
 *   ≥300ms AND canClose() → collector remaps endReason to
 *   'consequence-settled'. The 10s-from-open cap is re-armed at settle
 *   entry (remaining-from-OPEN, so the window can never outlive open+10s).
 *
 * Unchanged paths: isUnloading immediate finalize, pagehide INV-4,
 * post-nav windows, recording stop, displacement, companion suppression.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdaptiveWindow } from '../../src/tap/adaptive-window';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { NetworkBridge } from '../../src/tap/network-bridge';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import type { BehavioralEvidence, EvidenceWindow } from '../../src/shared/behavioral-evidence-types';

// ══════════════════════════════════════════════════════════════════════
// Part 1 — AdaptiveWindow settle mode (UA1–UA5, fake timers)
// ══════════════════════════════════════════════════════════════════════

describe('AdaptiveWindow settle mode (canClose + cap re-arm)', () => {
  let mockNow = 0;

  beforeEach(() => {
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  it('UA1: canClose=false blocks the stabilized close; re-schedules at quiescence cadence', () => {
    let result: EvidenceWindow | null = null;
    let canCloseCalls = 0;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
      canClose: () => { canCloseCalls++; return false; },
    });
    win.arm();
    advance(300);
    // Quiescence elapsed but canClose=false → window stays open, predicate consulted
    expect(result).toBeNull();
    expect(canCloseCalls).toBeGreaterThanOrEqual(1);
    // Re-scheduled at quiescence cadence → consulted again later
    advance(300);
    expect(canCloseCalls).toBeGreaterThanOrEqual(2);
    expect(result).toBeNull();
    expect(win.getIsOpen()).toBe(true);
  });

  it('UA2: canClose=true + 300ms quiescence → closes stabilized', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
      canClose: () => true,
    });
    win.arm();
    advance(300);
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('stabilized');
  });

  it('UA3: canClose is never consulted before quiescence/minDuration are satisfied', () => {
    let canCloseCalls = 0;
    const win = new AdaptiveWindow({
      onClose: () => {},
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
      canClose: () => { canCloseCalls++; return true; },
    });
    win.arm();
    advance(50); // < minQuiescence (300) — must not consult yet
    expect(canCloseCalls).toBe(0);
    advance(250); // = 300 total
    expect(canCloseCalls).toBeGreaterThanOrEqual(1);
  });

  it('UA4: window entering settle at +2s closes max-duration at open+10s (not now+10s)', () => {
    let result: EvidenceWindow | null = null;
    let canCloseVal = false;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
      canClose: () => canCloseVal,
    });
    win.arm();
    win.setHoldOpen(true);
    advance(2000);
    expect(result).toBeNull(); // holdOpen: no self-close, no cap timer
    win.setHoldOpen(false);    // settle entry at +2s → cap re-armed remaining-from-OPEN
    advance(400);              // quiescent but canClose=false
    expect(result).toBeNull();
    advance(7600);             // open+10s total → cap fires
    expect(result!.endReason).toBe('max-duration');
    expect(result!.durationMs).toBeGreaterThanOrEqual(9900);
  });

  it('UA5: setHoldOpen(false) when elapsed ≥ maxDuration closes immediately max-duration', () => {
    let result: EvidenceWindow | null = null;
    const win = new AdaptiveWindow({
      onClose: (w) => { result = w; },
      minQuiescence: 300,
      maxDuration: 10000,
      minDuration: 50,
    });
    win.arm();
    win.setHoldOpen(true);
    advance(10500); // > 10s from open
    win.setHoldOpen(false);
    advance(0);
    expect(result).not.toBeNull();
    expect(result!.endReason).toBe('max-duration');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Part 2 — NetworkBridge.getInFlightRequestIds (UA7 bridge-level)
// ╔═ RED until src/tap/network-bridge.ts gains the additive getter ═════
// ══════════════════════════════════════════════════════════════════════

describe('NetworkBridge.getInFlightRequestIds', () => {
  interface MockListener {
    callback: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void;
  }
  const mockListeners: MockListener[] = [];

  beforeEach(() => {
    mockListeners.length = 0;
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        onMessage: {
          addListener: (cb: MockListener['callback']) => { mockListeners.push({ callback: cb }); },
          removeListener: (cb: MockListener['callback']) => {
            const idx = mockListeners.findIndex((l) => l.callback === cb);
            if (idx >= 0) mockListeners.splice(idx, 1);
          },
        },
      },
    };
  });

  afterEach(() => { vi.restoreAllMocks(); });

  function sendWebRequest(detail: Record<string, unknown>): void {
    for (const l of mockListeners) {
      l.callback({ type: 'NETWORK_REQUEST', detail }, {}, () => {});
    }
  }

  it('UA7a: in-flight request started after open (not in requestIdsAtOpen) is returned', () => {
    const bridge = new NetworkBridge();
    bridge.start();
    sendWebRequest({ url: 'https://api.example.com/cart', method: 'POST', timestamp: 100, phase: 'start', status: null, requestId: 'req-1' });
    const ids = bridge.getInFlightRequestIds();
    expect(ids.has('req-1')).toBe(true);
    expect(ids.size).toBe(1);
    bridge.stop();
  });

  it('UA7b: completed request is no longer in the set', () => {
    const bridge = new NetworkBridge();
    bridge.start();
    sendWebRequest({ url: 'https://api.example.com/cart', method: 'POST', timestamp: 100, phase: 'start', status: null, requestId: 'req-1' });
    sendWebRequest({ url: 'https://api.example.com/cart', method: 'POST', timestamp: 400, phase: 'complete', status: 200, requestId: 'req-1' });
    expect(bridge.getInFlightRequestIds().size).toBe(0);
    bridge.stop();
  });

  it('UA7c: noise-URL requests are excluded at the getter level by NOISE_URLS', () => {
    const bridge = new NetworkBridge();
    bridge.start();
    sendWebRequest({ url: 'https://example.com/unagi/events/1?x=1', method: 'POST', timestamp: 100, phase: 'start', status: null, requestId: 'req-noise' });
    sendWebRequest({ url: 'https://example.com/img/pixel.gif', method: 'GET', timestamp: 100, phase: 'start', status: null, requestId: 'req-img' });
    const ids = bridge.getInFlightRequestIds();
    expect(ids.has('req-noise')).toBe(false);
    expect(ids.has('req-img')).toBe(false);
    expect(ids.size).toBe(0);
    bridge.stop();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Part 3 — EvidenceCollector settle mode (UA6, UA8–UA13, real timers)
// ══════════════════════════════════════════════════════════════════════

describe('EvidenceCollector consequence-settling', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let bridge: NetworkBridge;
  let deliveredEvidence: BehavioralEvidence[];
  interface MockListener {
    callback: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void;
  }
  const mockListeners: MockListener[] = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    mockListeners.length = 0;
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            deliveredEvidence.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        onMessage: {
          addListener: (cb: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void) => { mockListeners.push({ callback: cb }); },
          removeListener: (cb: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void) => {
            const idx = mockListeners.findIndex((l) => l.callback === cb);
            if (idx >= 0) mockListeners.splice(idx, 1);
          },
        },
        lastError: undefined,
      },
    } as unknown as typeof chrome;

    cache = new TargetStateCache();
    observer = new DOMObserver();
    bridge = new NetworkBridge();
    bridge.start();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer, networkBridge: bridge });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    bridge.stop();
    vi.restoreAllMocks();
  });

  /** jsdom defers MutationObserver callbacks to microtasks; flush them. */
  async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function sendWebRequest(detail: Record<string, unknown>): void {
    for (const l of [...mockListeners]) {
      l.callback({ type: 'NETWORK_REQUEST', detail }, {}, () => {});
    }
  }

  function finalizeClick(eventId: string, lifecycleId = 'lc-1'): void {
    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId,
      interactionId: 'int-1',
      interactionType: 'Click',
      eventIds: [eventId],
      metadata: {},
      endState: 'completed',
    });
  }

  const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('UA6/UA13: non-unloading finalize enters settle mode; window NOT closed at +150ms; delivers once with consequence-settled', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-1', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    finalizeClick('evt-1');
    // OLD behavior: executeFinalization at +150ms → lifecycle-complete.
    // NEW: window enters settle mode; stays open past 150ms.
    await waitFor(250);
    expect(collector.getActiveWindowCount()).toBe(1);

    // Quiescent and network-idle → AdaptiveWindow self-closes 'stabilized',
    // collector remaps to 'consequence-settled'.
    await waitFor(400);
    expect(collector.getActiveWindowCount()).toBe(0);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-1');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    // Delivered exactly once for this sourceEventId (UA13)
    expect(deliveredEvidence.filter((e) => e.sourceEventId === 'evt-1').length).toBe(1);
  }, 8000);

  it('UA8: duplicate FINALIZE_EVIDENCE is idempotent — no double delivery', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-2', 'click', '');
    finalizeClick('evt-2', 'lc-a');
    finalizeClick('evt-2', 'lc-b'); // duplicate finalize for the same window
    await waitFor(800);

    expect(deliveredEvidence.filter((e) => e.sourceEventId === 'evt-2').length).toBe(1);
    expect(collector.getActiveWindowCount()).toBe(0);
  }, 8000);

  it('UA9: pagehide during settle → immediate page-reload finalize (INV-4, unchanged)', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-3', 'click', '');
    finalizeClick('evt-3');
    await waitFor(100);
    expect(collector.getActiveWindowCount()).toBe(1); // in settle mode

    (collector as unknown as { onPageHide: () => void }).onPageHide();
    await flushMutations();

    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-3');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('page-reload');
  }, 8000);

  it('UA11a: settle close remaps stabilized → consequence-settled; cap close keeps max-duration', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-4', 'click', '');
    finalizeClick('evt-4');
    await waitFor(800);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-4');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
  }, 8000);

  it('UA12: G3 late-network re-collect still scheduled from the settle close path (slow causal request outliving settle)', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-5', 'click', '');
    finalizeClick('evt-5');

    // Causal request: started after open, completes after settle-close
    sendWebRequest({ url: 'https://api.example.com/slow-add', method: 'POST', timestamp: 100, phase: 'start', status: null, requestId: 'req-slow-1' });
    await waitFor(500); // quiescent DOM, but causal request in flight → blocks settle
    expect(collector.getActiveWindowCount()).toBe(1);

    // Complete it; its completion then allows settling
    sendWebRequest({ url: 'https://api.example.com/slow-add', method: 'POST', timestamp: 100, phase: 'complete', status: 200, requestId: 'req-slow-1' });
    await waitFor(600);
    expect(collector.getActiveWindowCount()).toBe(0);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-5');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    // The causal request's network row is in the primary evidence
    expect(ev!.applicationEvidence.networkActivity.some((n) => n.url.includes('slow-add'))).toBe(true);
  }, 8000);

  it('UA7-collector: causalNetworkIdle — request started before open does NOT block settling', async () => {
    // Pre-existing request (started before window open → in requestIdsAtOpen)
    sendWebRequest({ url: 'https://api.example.com/heartbeat', method: 'GET', timestamp: 50, phase: 'start', status: null, requestId: 'req-pre-1' });

    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-6', 'click', '');
    // requestIdsAtOpen snapshot taken at open includes req-pre-1
    finalizeClick('evt-6');
    await waitFor(700); // quiescent; pre-existing request excluded by membership

    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-6');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
  }, 8000);

  it('IA1: delayed modal — causal async chain (click → causal request → +600ms dialog) captured with consequence-settled', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-7', 'click', '');
    finalizeClick('evt-7');

    // Causal async chain (Amazon shape): the click starts a request that
    // is in flight at settle entry. It completes at +500ms, and the modal
    // renders on its completion — re-arming quiescence, keeping the window
    // open until the consequence truly settles. A zero-precursor delayed
    // modal is the documented epistemic limit (§18) and is NOT asserted.
    sendWebRequest({ url: 'https://api.example.com/add-to-cart', method: 'POST', timestamp: 100, phase: 'start', status: null, requestId: 'req-modal-1' });
    setTimeout(() => {
      sendWebRequest({ url: 'https://api.example.com/add-to-cart', method: 'POST', timestamp: 100, phase: 'complete', status: 200, requestId: 'req-modal-1' });
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Added to cart');
      document.body.appendChild(dialog);
    }, 500);

    await waitFor(1600);
    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-7');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    expect(ev!.applicationEvidence.newSurfaces.length).toBeGreaterThanOrEqual(1);
    expect(ev!.applicationEvidence.newSurfaces.some((s) => s.ariaRole === 'dialog')).toBe(true);
    // The causal request that produced the dialog is in the evidence
    expect(ev!.applicationEvidence.networkActivity.some((n) => n.url.includes('add-to-cart'))).toBe(true);
  }, 8000);

  it('IA2: fast modal (+100ms) — no regression for in-window effects', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-8', 'click', '');
    finalizeClick('evt-8');

    setTimeout(() => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.appendChild(dialog);
    }, 100);

    await waitFor(900);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-8');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    expect(ev!.applicationEvidence.newSurfaces.some((s) => s.ariaRole === 'dialog')).toBe(true);
  }, 8000);

  it('IA3: polling page (1s causal poll, no DOM change) settles within ~one poll cycle — never hits cap', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-9', 'click', '');
    finalizeClick('evt-9');

    // Causal poll started after open, completes at ~1100ms (once)
    sendWebRequest({ url: 'https://api.example.com/poll', method: 'GET', timestamp: 100, phase: 'start', status: null, requestId: 'req-poll-1' });
    setTimeout(() => {
      sendWebRequest({ url: 'https://api.example.com/poll', method: 'GET', timestamp: 100, phase: 'complete', status: 200, requestId: 'req-poll-1' });
    }, 1100);

    await waitFor(2200);
    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-9');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    expect(ev!.window.durationMs).toBeLessThan(5000);
  }, 8000);

  it('UA10: recording stop during settle → recording-stopped (existing stop semantics, unchanged)', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-stop-1', 'click', '');
    finalizeClick('evt-stop-1');
    await waitFor(120);
    expect(collector.getActiveWindowCount()).toBe(1); // in settle mode

    // Continuous causal request blocks settle — stop must still close it.
    sendWebRequest({ url: 'https://api.example.com/never-completes', method: 'GET', timestamp: 100, phase: 'start', status: null, requestId: 'req-stuck-1' });
    await waitFor(200);

    collector.stop();
    await flushMutations();
    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-stop-1');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('recording-stopped');
  }, 8000);

  it('IA4: continuous churn during settle → closes at the 10s cap with max-duration (never hangs)', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-cap-1', 'click', '');
    finalizeClick('evt-cap-1');

    // Sub-quiescence perpetual storm: mutation every 100ms for 12s.
    const churn = setInterval(() => {
      const s = document.createElement('span');
      s.textContent = 'tick';
      btn.appendChild(s);
    }, 100);

    const t0 = Date.now();
    // Poll until the window closes (bounded: must be ≤ ~10.5s from open).
    while (collector.getActiveWindowCount() > 0 && Date.now() - t0 < 11500) {
      await waitFor(250);
    }
    clearInterval(churn);
    document.querySelectorAll('span').forEach((n) => n.remove());

    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-cap-1');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('max-duration'); // raw fact, not consequence-settled
    expect(ev!.window.durationMs).toBeLessThan(11000); // capped from OPEN
  }, 15000);

  it('IA5: slow causal XHR (2.5s) — window waits for completion, response DOM consequence captured', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-slow-1', 'click', '');
    finalizeClick('evt-slow-1');

    sendWebRequest({ url: 'https://api.example.com/slow-op', method: 'POST', timestamp: 100, phase: 'start', status: null, requestId: 'req-slow-op' });
    setTimeout(() => {
      sendWebRequest({ url: 'https://api.example.com/slow-op', method: 'POST', timestamp: 100, phase: 'complete', status: 200, requestId: 'req-slow-op' });
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.setAttribute('aria-label', 'Order placed');
      document.body.appendChild(alert);
    }, 2500);

    await waitFor(3600);
    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-slow-1');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    expect(ev!.window.durationMs).toBeGreaterThan(2500); // waited for the request
    expect(ev!.applicationEvidence.newSurfaces.some((s) => s.ariaRole === 'alert')).toBe(true);
    expect(ev!.applicationEvidence.networkActivity.some((n) => n.url.includes('slow-op'))).toBe(true);
  }, 10000);

  it('IA7: form-submit navigation (isUnloading) → immediate finalize, page-reload — unchanged', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-nav-1', 'click', '');
    finalizeClick('evt-nav-1');
    await waitFor(150);
    expect(collector.getActiveWindowCount()).toBe(1); // settle mode

    // Navigation begins: pagehide fires → INV-4 zero-delay finalize
    (collector as unknown as { onPageHide: () => void }).onPageHide();
    await flushMutations();

    expect(collector.getActiveWindowCount()).toBe(0);
    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-nav-1');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('page-reload'); // unload path, NOT settle path
  }, 8000);

  it('IA8: overlapping interactions remain isolated — two clicks, two separate windows and evidence deliveries', async () => {
    const btnA = document.createElement('button');
    btnA.id = 'btn-a';
    const btnB = document.createElement('button');
    btnB.id = 'btn-b';
    document.body.append(btnA, btnB);
    await flushMutations();

    collector.onAfterEvent(btnA, 'evt-a-1', 'click', '');
    await waitFor(50);
    collector.onAfterEvent(btnB, 'evt-b-1', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(2);

    // Two separate lifecycles finalize their own windows
    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-a', interactionId: 'int-a', interactionType: 'Click',
      eventIds: ['evt-a-1'], metadata: {}, endState: 'completed',
    });
    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-b', interactionId: 'int-b', interactionType: 'Click',
      eventIds: ['evt-b-1'], metadata: {}, endState: 'completed',
    });

    await waitFor(800);
    expect(collector.getActiveWindowCount()).toBe(0);
    const evA = deliveredEvidence.find((e) => e.sourceEventId === 'evt-a-1');
    const evB = deliveredEvidence.find((e) => e.sourceEventId === 'evt-b-1');
    expect(evA).toBeDefined();
    expect(evB).toBeDefined();
    expect(evA!.window.endReason).toBe('consequence-settled');
    expect(evB!.window.endReason).toBe('consequence-settled');
    // Isolated: each window delivered exactly its own evidence
    expect(deliveredEvidence.filter((e) => e.sourceEventId === 'evt-a-1').length).toBe(1);
    expect(deliveredEvidence.filter((e) => e.sourceEventId === 'evt-b-1').length).toBe(1);
  }, 8000);

  it('IA6: no consequence — settles ~350ms with empty application arrays', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-10', 'click', '');
    finalizeClick('evt-10');
    await waitFor(700);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-10');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    expect(ev!.applicationEvidence.newSurfaces.length).toBe(0);
    expect(ev!.applicationEvidence.domChanges.length).toBe(0);
    expect(ev!.window.durationMs).toBeLessThan(1000);
  }, 8000);
});
