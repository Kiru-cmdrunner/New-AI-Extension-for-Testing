/**
 * Resulting Application State — Phase 1 capture tests
 * (.drytis/specs/resulting-application-state.md AC1–AC3, AC7, INV-CS1/CS2)
 *
 * Collector-level: the settle branch scans once and attaches
 * applicationEvidence.resultingState; the post-nav window scans the
 * destination page into the NAVIGATION interaction's evidence; the unload
 * path NEVER scans (Vivo evidence stays byte-identical); failure/empty
 * cases leave the field absent; the no-observer default preserves today's
 * behavior exactly.
 *
 * Conventions mirror tests/tap/surface-reveal.test.ts: mock
 * chrome.runtime capturing BEHAVIORAL_EVIDENCE payloads; drive the collector
 * via onAfterEvent + finalizeForInteraction; flush mutations with triple
 * await Promise.resolve().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { NetworkBridge } from '../../src/tap/network-bridge';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import type { PageContentSnapshot } from '../../src/understanding/page-content/page-content-types';

/** Fake observer: records scan() calls, returns a canned snapshot or null. */
class FakeObserver {
  public calls = 0;
  public shouldThrow = false;
  public snapshot: PageContentSnapshot | null = null;

  scan(_viewId: string | null): PageContentSnapshot | null {
    this.calls++;
    if (this.shouldThrow) throw new Error('scan exploded');
    return this.snapshot;
  }
}

function makeSnapshot(overrides: Partial<PageContentSnapshot> = {}): PageContentSnapshot {
  return {
    url: 'https://example.test/cart',
    viewId: null,
    items: [
      {
        kind: 'counter',
        matchedSelector: '[aria-label*="cart" i][class*="count" i]',
        text: 'Shopping Cart, 4 items',
        numericValue: 4,
        entityId: null,
        entityType: null,
        domPath: 'div#nav-cart',
        attributes: { 'aria-label': 'Shopping Cart, 4 items' },
        visible: true,
      },
      {
        kind: 'entity',
        matchedSelector: '[data-asin]',
        entityType: 'product',
        entityId: 'B0TEST123',
        text: 'Test Product',
        numericValue: null,
        domPath: 'div[data-asin="B0TEST123"]',
        attributes: { 'data-asin': 'B0TEST123' },
        visible: true,
      },
    ],
    itemsOverflow: 0,
    scannedAt: 123.456,
    scanDurationMs: 3,
    ...overrides,
  };
}

describe('Resulting-state capture (Phase 1)', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let bridge: NetworkBridge;
  let deliveredEvidence: BehavioralEvidence[];
  let fake: FakeObserver;
  interface MockListener {
    callback: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void;
  }
  const mockListeners: MockListener[] = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    mockListeners.length = 0;
    fake = new FakeObserver();
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            deliveredEvidence.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        onMessage: {
          addListener: (cb: (msg: unknown) => void) => { mockListeners.push({ callback: cb as MockListener['callback'] }); },
          removeListener: (cb: (msg: unknown) => void) => {
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
    collector = new EvidenceCollector({
      targetStateCache: cache,
      domObserver: observer,
      networkBridge: bridge,
      pageContentObserver: fake as unknown as PageContentObserver,
    });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    bridge.stop();
    vi.restoreAllMocks();
  });

  async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function finalizeClick(eventId: string, lifecycleId = 'lc-1'): void {
    (collector as unknown as {
      finalizeForInteraction: (p: object) => void;
    }).finalizeForInteraction({
      lifecycleId,
      interactionId: 'int-1',
      interactionType: 'Click',
      eventIds: [eventId],
      metadata: {},
      endState: 'completed',
    });
  }

  async function recordClickAndSettle(eventId: string): Promise<void> {
    const btn = document.createElement('button');
    btn.id = 'add-to-cart';
    btn.textContent = 'Add to Cart';
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, eventId, 'click', '#add-to-cart');
    await flushMutations();
    finalizeClick(eventId);
    // AdaptiveWindow quiescence: advance past the 300ms timer with real timers.
    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  }

  // ── AC1: settle-closed click windows carry resultingState ──────────

  it('settle-closed click window attaches resultingState from the scan', async () => {
    fake.snapshot = makeSnapshot();
    await recordClickAndSettle('ev-1');
    expect(fake.calls).toBe(1);
    expect(deliveredEvidence.length).toBe(1);
    const rs = deliveredEvidence[0].applicationEvidence.resultingState;
    expect(rs).toBeDefined();
    expect(rs?.url).toBe('https://example.test/cart');
    expect(rs?.items.length).toBe(2);
    expect(rs?.items[0].kind).toBe('counter');
    expect(rs?.items[0].numericValue).toBe(4);
    expect(rs?.items[1].entityId).toBe('B0TEST123');
    // Wire copy preserves every field class
    expect(typeof rs?.scannedAt).toBe('number');
    expect(typeof rs?.scanDurationMs).toBe('number');
    expect(rs?.itemsOverflow).toBe(0);
  });

  it('scan runs once per window even if close is delivered twice', async () => {
    fake.snapshot = makeSnapshot();
    await recordClickAndSettle('ev-2');
    // Second finalize for the same lifecycle: window already closed
    finalizeClick('ev-2');
    await flushMutations();
    expect(fake.calls).toBe(1);
  });

  it('empty scan (no semantic items) leaves the field ABSENT, evidence delivered', async () => {
    fake.snapshot = null;
    await recordClickAndSettle('ev-3');
    expect(deliveredEvidence.length).toBe(1);
    expect('resultingState' in deliveredEvidence[0].applicationEvidence).toBe(false);
    expect(JSON.stringify(deliveredEvidence[0].applicationEvidence)).not.toContain('resultingState');
  });

  it('scan failure leaves the field absent and does not block delivery', async () => {
    fake.shouldThrow = true;
    await recordClickAndSettle('ev-4');
    expect(deliveredEvidence.length).toBe(1);
    expect('resultingState' in deliveredEvidence[0].applicationEvidence).toBe(false);
  });

  // ── AC2 / INV-CS2: unload path never scans ─────────────────────────

  it('Vivo unload finalize (pagehide) never scans; evidence shape unchanged', async () => {
    fake.snapshot = makeSnapshot();
    const btn = document.createElement('button');
    btn.id = 'vivo-btn';
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'ev-vivo', 'click', '#vivo-btn');
    await flushMutations();
    // Enter settle mode first (non-unloading finalize), then unload.
    finalizeClick('ev-vivo', 'lc-vivo');
    await flushMutations();
    (collector as unknown as { onPageHide: () => void }).onPageHide();
    await flushMutations();
    expect(fake.calls).toBe(0);
    expect(deliveredEvidence.length).toBe(1);
    // Byte-shape: the delivered evidence must not contain the new field
    expect('resultingState' in deliveredEvidence[0].applicationEvidence).toBe(false);
    const json = JSON.stringify(deliveredEvidence[0]);
    expect(json).not.toContain('resultingState');
    // End reason must be the unload path, not the settle path
    expect(deliveredEvidence[0].window.endReason).toBe('page-reload');
  });

  // ── AC3 / INV-CS1: Navigation destination scan is a separate interaction ──

  it('post-nav window scans the destination page into the NAVIGATION evidence', async () => {
    fake.snapshot = makeSnapshot({ url: 'https://example.test/dest' });
    // Open the post-nav window the way the recorder entry does.
    (collector as unknown as {
      openPostNavWindow: (record: object) => void;
    }).openPostNavWindow({
      navEventId: 'nav-1',
      toUrl: 'https://example.test/dest',
      fromUrl: 'https://example.test/cart',
      navigationType: 'full-reload',
      committedAt: performance.now(),
    });
    // Destination content exists on the (same) document in jsdom.
    const heading = document.createElement('h1');
    heading.textContent = 'Order Confirmed';
    document.body.appendChild(heading);
    await flushMutations();
    // Post-nav window closes via its own stabilization — wait for its
    // evidence to arrive, then assert the destination scan landed on the
    // NAVIGATION interaction's evidence.
    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThan(0);
    }, { timeout: 5000 });
    expect(fake.calls).toBe(1);
    const rs = deliveredEvidence[0].applicationEvidence.resultingState;
    expect(rs).toBeDefined();
    expect(rs?.url).toBe('https://example.test/dest');
    expect(deliveredEvidence[0].window.endReason).not.toBe('consequence-settled');
  });

  it('non-post-nav window closing through the regular path does NOT scan', async () => {
    fake.snapshot = makeSnapshot();
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    // A window that closes WITHOUT settle mode (e.g. displaced by a later
    // window) uses the regular branch and must not carry a click scan.
    collector.onAfterEvent(input, 'ev-reg', 'click', 'input');
    await flushMutations();
    // Displace: a new event on a different target closes the prior window
    // through the regular path.
    const input2 = document.createElement('input');
    input2.type = 'text';
    document.body.appendChild(input2);
    collector.onAfterEvent(input2, 'ev-reg2', 'click', 'input');
    await flushMutations();
    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    // The displaced window never entered settle mode → no scan.
    const scanned = deliveredEvidence.some(
      (e) => e.applicationEvidence.resultingState !== undefined,
    );
    expect(scanned).toBe(false);
    expect(fake.calls).toBe(0);
  });

  // ── AC7: shape guard stays correct with the new field present ──────
  // (classification matrix lives in tests/runtime/network-supplement-shape-guard.test.ts)
});

// ── No-observer default: today's behavior preserved exactly ──────────

describe('Resulting-state capture — no observer injected', () => {
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];
  let bridge: NetworkBridge;

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            deliveredEvidence.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        onMessage: { addListener: () => {}, removeListener: () => {} },
        lastError: undefined,
      },
    } as unknown as typeof chrome;
    collector = new EvidenceCollector({
      targetStateCache: new TargetStateCache(),
      domObserver: new DOMObserver(),
      networkBridge: (bridge = new NetworkBridge()),
    });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    bridge.stop();
    vi.restoreAllMocks();
  });

  async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('collector without injected observer delivers evidence with NO resultingState field', async () => {
    const btn = document.createElement('button');
    btn.textContent = 'Go';
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'ev-none', 'click', 'button');
    await flushMutations();
    (collector as unknown as {
      finalizeForInteraction: (p: object) => void;
    }).finalizeForInteraction({
      lifecycleId: 'lc-none',
      interactionId: 'int-none',
      interactionType: 'Click',
      eventIds: ['ev-none'],
      metadata: {},
      endState: 'completed',
    });
    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect('resultingState' in deliveredEvidence[0].applicationEvidence).toBe(false);
  });
});
