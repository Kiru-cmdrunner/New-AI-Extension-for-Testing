/**
 * Phase 6A — Collector-level seeding pins: idempotence (P6) and ownership (P7)
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §2.1, §6
 *
 * Pins the wiring inside captureResultingState (the ONLY production scan call
 * site, evidence-collector.ts:1515–1533):
 *  - P6: the seeding input is the window's own accumulation, taken at the
 *    observation moment; duplicate finalizes / double-close never re-scan.
 *    Nothing is derived from STOP re-drain (O6).
 *  - P7: ownership — a superseded TextEntry settle window must NOT seed from
 *    the NEXT interaction's consequence mutations (its scan is skipped
 *    entirely; existing guards apply unchanged to the seeded path).
 *
 * The FakeObserver here RECORDS the seeds argument scan() receives — the pin
 * fails until evidence-collector passes seeds into scan().
 *
 * TDD: written before implementation. Red until the collector wires
 * summaries→seeds→scan. No product code here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { NetworkBridge } from '../../src/tap/network-bridge';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import type { PageContentSnapshot } from '../../src/understanding/page-content/page-content-types';

/** Records the seeds argument and call count; returns a canned snapshot. */
class SeedRecordingObserver {
  public calls = 0;
  /** Second scan() argument, per call — undefined until the collector passes seeds. */
  public receivedSeeds: unknown[] = [];
  public snapshot: PageContentSnapshot | null = null;

  scan(_viewId: string | null, seeds?: unknown): PageContentSnapshot | null {
    this.calls++;
    this.receivedSeeds.push(seeds);
    return this.snapshot;
  }
}

function makeSnapshot(items: PageContentSnapshot['items']): PageContentSnapshot {
  return {
    url: 'https://example.test/search',
    viewId: null,
    items,
    itemsOverflow: 0,
    scannedAt: 456.789,
    scanDurationMs: 3,
  };
}

const COUNTER_ITEMS: PageContentSnapshot['items'] = [
  {
    kind: 'counter',
    matchedSelector: 'changed-element-seed',
    text: '5 items',
    numericValue: 5,
    entityId: null,
    entityType: null,
    domPath: 'body > div#counter',
    attributes: {},
    visible: true,
  },
];

describe('Collector seeding wiring (P6 idempotence, P7 ownership)', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let bridge: NetworkBridge;
  let deliveredEvidence: BehavioralEvidence[];
  let fake: SeedRecordingObserver;
  interface MockListener {
    callback: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => void;
  }
  const mockListeners: MockListener[] = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    mockListeners.length = 0;
    fake = new SeedRecordingObserver();
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

  function bind(eventId: string, interactionType: string, lifecycleId: string): void {
    collector.handleLifecycleBound({
      lifecycleId,
      triggerEventId: eventId,
      interactionType,
    });
  }

  function finalize(
    eventId: string,
    interactionType: string,
    lifecycleId: string,
  ): void {
    (collector as unknown as {
      finalizeForInteraction: (p: object) => void;
    }).finalizeForInteraction({
      lifecycleId,
      interactionId: `int-${lifecycleId}`,
      interactionType,
      eventIds: [eventId],
      metadata: {},
      endState: 'completed',
    });
  }

  // ── P6: idempotence ─────────────────────────────────────

  it('P6a: scan receives the window\'s own accumulation as seeds (not undefined)', async () => {
    // A counter div changes during the click window.
    document.body.innerHTML = '<div id="counter">5</div>';
    collector.onAfterEvent(document.getElementById('counter')!, 'ev-1', 'click', '#counter');
    await flushMutations();
    bind('ev-1', 'Click', 'lc-1');
    document.getElementById('counter')!.textContent = '5 items';
    await flushMutations();
    fake.snapshot = makeSnapshot(COUNTER_ITEMS);
    finalize('ev-1', 'Click', 'lc-1');
    await flushMutations();
    await vi.waitFor(
      () => expect(deliveredEvidence.some((e) => e.sourceEventId === 'ev-1')).toBe(true),
      { timeout: 5000 },
    );
    expect(fake.calls).toBe(1);
    // THE pin: the collector passed seeds (the window's accumulation) — today
    // it passes nothing.
    expect(fake.receivedSeeds[0]).toBeDefined();
  });

  it('P6b: duplicate finalize → still exactly one scan (at-most-once holds on the seeded path)', async () => {
    document.body.innerHTML = '<div id="counter">5</div>';
    collector.onAfterEvent(document.getElementById('counter')!, 'ev-1', 'click', '#counter');
    await flushMutations();
    bind('ev-1', 'Click', 'lc-1');
    document.getElementById('counter')!.textContent = '5 items';
    await flushMutations();
    fake.snapshot = makeSnapshot(COUNTER_ITEMS);
    finalize('ev-1', 'Click', 'lc-1');
    await flushMutations();
    finalize('ev-1', 'Click', 'lc-1'); // duplicate
    await flushMutations();
    await vi.waitFor(
      () => expect(deliveredEvidence.some((e) => e.sourceEventId === 'ev-1')).toBe(true),
      { timeout: 5000 },
    );
    expect(fake.calls).toBe(1);
  });

  it('P6c: double-close → still exactly one scan', async () => {
    document.body.innerHTML = '<div id="counter">5</div>';
    collector.onAfterEvent(document.getElementById('counter')!, 'ev-1', 'click', '#counter');
    await flushMutations();
    bind('ev-1', 'Click', 'lc-1');
    document.getElementById('counter')!.textContent = '5 items';
    await flushMutations();
    fake.snapshot = makeSnapshot(COUNTER_ITEMS);
    finalize('ev-1', 'Click', 'lc-1');
    await flushMutations();
    await vi.waitFor(
      () => expect(deliveredEvidence.some((e) => e.sourceEventId === 'ev-1')).toBe(true),
      { timeout: 5000 },
    );
    // Second close (already delivered window) must not re-scan.
    finalize('ev-1', 'Click', 'lc-1');
    await flushMutations();
    expect(fake.calls).toBe(1);
  });

  // ── P7: ownership on the seeded path ────────────────────

  it('P7: superseded TextEntry settle window does NOT scan (no seeded photographing of the next click\'s consequence)', async () => {
    // Real interaction order (mirrors resulting-state-consequence-ownership
    // test): the SW's TextEntry FINALIZE arrives AFTER the click window has
    // already opened — the claimant rule supersedes the typing window at
    // settle entry.
    // 1. typing window on #q
    document.body.innerHTML = '<input id="q" /><button id="go">Go</button>';
    collector.onAfterEvent(document.getElementById('q')!, 'ev-type-1', 'input', '#q');
    await flushMutations();
    bind('ev-type-1', 'TextEntry', 'lc-type');
    // 2. >300ms later, the click opens its own window (supersede point)
    await new Promise((r) => setTimeout(r, 350));
    collector.onAfterEvent(document.getElementById('go')!, 'ev-click-2', 'click', '#go');
    await flushMutations();
    // The app's click handler updates the counter (click consequence).
    const counter = document.createElement('div');
    counter.id = 'counter';
    counter.textContent = '5 items';
    document.body.appendChild(counter);
    await flushMutations();
    bind('ev-click-2', 'Click', 'lc-click');
    // 3. TextEntry finalize arrives NOW (blur→click→SW ordering) → superseded
    finalize('ev-type-1', 'TextEntry', 'lc-type');
    await flushMutations();
    fake.snapshot = makeSnapshot(COUNTER_ITEMS);
    finalize('ev-click-2', 'Click', 'lc-click');
    await flushMutations();
    // Wait for the click's evidence (windows are async).
    await vi.waitFor(
      () => expect(deliveredEvidence.some((e) => e.sourceEventId === 'ev-click-2')).toBe(true),
      { timeout: 5000 },
    );
    const typeEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-type-1');
    const clickEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-click-2');
    // Ownership: the typing window was superseded → NO resultingState at all.
    expect(typeEvidence?.applicationEvidence?.resultingState).toBeUndefined();
    // The click window scanned once — with its OWN accumulation as seeds.
    expect(clickEvidence?.applicationEvidence?.resultingState).toBeDefined();
    expect(fake.calls).toBe(1);
  });

  // ── O6-STOP: no scan is derived from the STOP drain ──────────────
  //
  // O6 (AdaniOne RCA): the span diff Economy→Premium Economy was
  // re-reported on 4 consecutive cards because legacy re-drain derived
  // observations from changes whose causal window had already closed.
  // The 6A architecture answers this structurally: captureResultingState
  // runs ONLY inside closeWindow's branches (Hook A settle / Hook B
  // post-nav), and stop() merely force-closes still-open windows through
  // that same path — there is no separate STOP sweep, so no already-closed
  // window can re-scan and no cross-window re-drain exists.

  it('O6-STOP: collector.stop() with a still-open settle window closes it WITHOUT any scan (STOP never derives observations)', async () => {
    document.body.innerHTML = '<div id="counter">5</div>';
    collector.onAfterEvent(document.getElementById('counter')!, 'ev-1', 'click', '#counter');
    await flushMutations();
    bind('ev-1', 'Click', 'lc-1');
    document.getElementById('counter')!.textContent = '5 items';
    await flushMutations();
    // Settle-mode finalize arms the window but it has NOT settled yet —
    // the window is still open when STOP arrives.
    finalize('ev-1', 'Click', 'lc-1');
    await flushMutations();
    fake.snapshot = makeSnapshot(COUNTER_ITEMS);
    collector.stop(); // STOP drain: force-close all open windows
    await flushMutations();
    await vi.waitFor(
      () => expect(deliveredEvidence.some((e) => e.sourceEventId === 'ev-1')).toBe(true),
      { timeout: 5000 },
    );
    // O6 contract: the STOP path NEVER scans — captureResultingState gates
    // on isRunning (pre-existing Phase 1 guard, f8feb10), so a window that
    // only closes BECAUSE of stop() delivers evidence with the field
    // honestly ABSENT (absent-not-empty; INV-CS2 family). No STOP-derived
    // observation can exist, so no cross-window re-drain is possible.
    expect(fake.calls).toBe(0);
    const evidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-1');
    expect(evidence?.applicationEvidence).toBeDefined();
    expect(evidence?.applicationEvidence?.resultingState).toBeUndefined();
    // And nothing scans afterwards — late mutations are not re-drained.
    document.getElementById('counter')!.textContent = '9 items';
    await flushMutations();
    expect(fake.calls).toBe(0);
  });

  it('O6-STOP: no scan occurs for windows that already closed (stop() after delivery adds zero scans)', async () => {
    document.body.innerHTML = '<div id="counter">5</div>';
    collector.onAfterEvent(document.getElementById('counter')!, 'ev-1', 'click', '#counter');
    await flushMutations();
    bind('ev-1', 'Click', 'lc-1');
    document.getElementById('counter')!.textContent = '5 items';
    await flushMutations();
    fake.snapshot = makeSnapshot(COUNTER_ITEMS);
    finalize('ev-1', 'Click', 'lc-1');
    await flushMutations();
    await vi.waitFor(
      () => expect(deliveredEvidence.some((e) => e.sourceEventId === 'ev-1')).toBe(true),
      { timeout: 5000 },
    );
    expect(fake.calls).toBe(1); // normal settle delivery
    // Late mutation + STOP: nothing may re-scan the settled window.
    document.getElementById('counter')!.textContent = '7 items';
    await flushMutations();
    collector.stop();
    await flushMutations();
    expect(fake.calls).toBe(1);
    const evidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-1');
    expect(evidence?.applicationEvidence?.resultingState?.items[0].numericValue).toBe(5);
  });
});
