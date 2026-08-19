/**
 * Resulting-state consequence ownership (A-Slice fix 1)
 * (.drytis/specs/a-slice-executor-navigation.md, Issue 1)
 *
 * Reproduces the real-Chrome audit failure (head-audit-1703e43): a TextEntry
 * window finalized on blur enters settle mode, then the SUBSEQUENT click's
 * mutations re-arm the shared quiescence clock; the type window closes
 * `consequence-settled` and Hook A scans the live DOM — photographing the
 * CLICK's consequence into the TextEntry's evidence.
 *
 * Ownership rule under test: when a newer interaction's window opens while an
 * earlier window is in settle mode, the earlier window's pending scan is
 * superseded — the consequence belongs to the interaction that caused it.
 *
 * Conventions mirror tests/tap/resulting-state-capture.test.ts.
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

/** Mutation caused by the app's click handler (three results appended). */
const CLICK_CONSEQUENCE_ITEMS: PageContentSnapshot['items'] = [
  {
    kind: 'collection',
    matchedSelector: 'ul',
    text: '3 products',
    numericValue: 3,
    entityId: null,
    entityType: null,
    domPath: 'body > ul#results',
    attributes: {},
    visible: true,
  },
];

describe('Resulting-state consequence ownership (A-Slice 1)', () => {
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

  /** SW binds the lifecycle shortly AFTER the window opens (holdOpen). */
  function bind(eventId: string, interactionType: string, lifecycleId: string): void {
    collector.handleLifecycleBound({
      lifecycleId,
      triggerEventId: eventId,
      interactionType,
    });
  }

  /** SW sends FINALIZE_EVIDENCE when the lifecycle completes (blur). */
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

  /**
   * Real-Chrome audit sequence, scripted:
   *   1. focus + input on #q  → type window opens (lifecycle bound)
   *   2. blur on #q (mousedown on button) → TextEntry FINALIZE → settle mode
   *   3. click on #go → Click window OPENS (supersede point) and the app's
   *      click handler appends three <li> to #results (click consequence)
   *   4. Click lifecycle FINALIZE → click window settles
   * The type window must close WITHOUT scanning; the click window's scan must
   * observe the three results.
   */
  it('fill → click: TextEntry window does not photograph the click consequence', async () => {
    fake.snapshot = makeSnapshot(CLICK_CONSEQUENCE_ITEMS);

    const input = document.createElement('input');
    input.id = 'q';
    document.body.appendChild(input);
    const btn = document.createElement('button');
    btn.id = 'go';
    btn.textContent = 'Go';
    document.body.appendChild(btn);

    // 1. type window opens on input; the SW binds the TextEntry lifecycle
    //    almost immediately (async round-trip, ~ms) — holdOpen keeps the
    //    window open through the typing pause (production behavior).
    collector.onAfterEvent(input, 'ev-type-1', 'input', '#q');
    await flushMutations();
    bind('ev-type-1', 'TextEntry', 'lc-type');

    // Real-world pacing: the user finishes typing and moves to the button
    // ≥ COMPANION_WINDOW_MS later (real Chrome audit: ~1s). The click is a
    // DISTINCT later interaction, not a typing companion.
    await new Promise((r) => setTimeout(r, 350));

    // 2. CLICK EVENT fires: mousedown moved focus → blur → SW finalizes
    //    TextEntry, but the click EVENT ITSELF wins the race in real Chrome
    //    (dispatch is synchronous; the SW round-trip is async). Click window
    //    opens FIRST, app handler mutations land, THEN the TextEntry
    //    finalize arrives — the type window enters settle mode LATE.
    collector.onAfterEvent(btn, 'ev-click-2', 'click', '#go');
    const results = document.createElement('ul');
    results.id = 'results';
    for (let i = 0; i < 3; i++) {
      const li = document.createElement('li');
      li.textContent = `headphones product ${i + 1}`;
      results.appendChild(li);
    }
    document.body.appendChild(results);
    await flushMutations();

    // 3. TextEntry finalize (blur) arrives now → settle mode
    finalize('ev-type-1', 'TextEntry', 'lc-type');
    await flushMutations();

    // 4. click lifecycle finalizes → click window settles
    finalize('ev-click-2', 'Click', 'lc-click');
    await flushMutations();

    // Wait for both windows to settle (real timers, 300ms quiescence each).
    await vi.waitFor(() => {
      expect(
        deliveredEvidence.find((e) => e.sourceEventId === 'ev-click-2'),
      ).toBeDefined();
    }, { timeout: 5000 });

    const typeEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-type-1');
    const clickEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-click-2');
    // OWNERSHIP: the click consequence belongs to the CLICK interaction
    expect(clickEvidence?.applicationEvidence.resultingState).toBeDefined();
    expect(clickEvidence?.applicationEvidence.resultingState?.items[0].numericValue).toBe(3);

    // The TextEntry window must NOT carry the click's consequence
    expect(typeEvidence?.applicationEvidence.resultingState).toBeUndefined();
  });

  it('blur-caused consequences still attach to the TextEntry (no supersede)', async () => {
    // Same-element finalization: type → blur mutates DOM (validation message)
    // while the type window still owns the batch callback → RS belongs to type.
    fake.snapshot = makeSnapshot([
      {
        kind: 'notification',
        matchedSelector: '[role="alert"]',
        text: '3 characters minimum',
        numericValue: null,
        entityId: null,
        entityType: null,
        domPath: 'body > p#hint',
        attributes: {},
        visible: true,
      },
    ]);

    const input = document.createElement('input');
    input.id = 'q';
    document.body.appendChild(input);

    collector.onAfterEvent(input, 'ev-type-9', 'input', '#q');
    await flushMutations();
    bind('ev-type-9', 'TextEntry', 'lc-type-9');

    // Blur-time consequence: the app appends a hint before any next window opens
    const hint = document.createElement('p');
    hint.id = 'hint';
    hint.setAttribute('role', 'alert');
    hint.textContent = '3 characters minimum';
    document.body.appendChild(hint);
    await flushMutations();

    finalize('ev-type-9', 'TextEntry', 'lc-type-9');
    await flushMutations();

    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });

    const typeEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-type-9');
    expect(typeEvidence?.applicationEvidence.resultingState).toBeDefined();
    expect(typeEvidence?.applicationEvidence.resultingState?.items[0].kind).toBe('notification');
  });

  it('unsuperseded click window keeps scanning (regression guard for fix 1)', async () => {
    // Plain click with its own consequence — the Phase 1 AC1 behavior must
    // survive the supersede rule unchanged.
    fake.snapshot = makeSnapshot([
      {
        kind: 'counter',
        matchedSelector: '[aria-label*="cart" i]',
        text: '1 items',
        numericValue: 1,
        entityId: null,
        entityType: null,
        domPath: 'body > p > span#cart-count',
        attributes: {},
        visible: true,
      },
    ]);

    const btn = document.createElement('button');
    btn.id = 'add1';
    btn.textContent = 'Add to cart';
    document.body.appendChild(btn);

    collector.onAfterEvent(btn, 'ev-click-77', 'click', '#add1');
    bind('ev-click-77', 'Click', 'lc-click-77');
    const counter = document.createElement('span');
    counter.id = 'cart-count';
    counter.textContent = '1 items';
    document.body.appendChild(counter);
    await flushMutations();

    finalize('ev-click-77', 'Click', 'lc-click-77');
    await flushMutations();

    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });

    const clickEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-click-77');
    expect(clickEvidence?.applicationEvidence.resultingState).toBeDefined();
    expect(clickEvidence?.applicationEvidence.resultingState?.items[0].numericValue).toBe(1);
    expect(fake.calls).toBe(1);
  });

  it('companion window (native form submit ~0ms after the click) does not suppress the click scan', async () => {
    // Real-Chrome audit round 2: the Go button's click is followed ~0.4ms by
    // the native form 'submit' event — a COMPANION of the same physical
    // action, not a distinct later interaction. The naive newerLiveClaimant
    // predicate (any newer open window) wrongly suppressed the click's own
    // resulting-state scan (over-suppression regression found in re-audit).
    // Rule: only windows opening ≥ COMPANION_WINDOW_MS (300ms) later count
    // as distinct claimants.
    fake.snapshot = makeSnapshot(CLICK_CONSEQUENCE_ITEMS);

    const form = document.createElement('form');
    form.id = 'sf';
    document.body.appendChild(form);
    const btn = document.createElement('button');
    btn.id = 'go';
    btn.type = 'submit';
    btn.textContent = 'Go';
    form.appendChild(btn);

    // Click window opens; consequences render synchronously after
    collector.onAfterEvent(btn, 'ev-click-88', 'click', '#go');
    bind('ev-click-88', 'Click', 'lc-click-88');
    const results = document.createElement('ul');
    results.id = 'results';
    for (let i = 0; i < 3; i++) {
      const li = document.createElement('li');
      li.textContent = `headphones product ${i + 1}`;
      results.appendChild(li);
    }
    document.body.appendChild(results);
    await flushMutations();

    // Companion submit window opens +0.4ms later (same physical action)
    collector.onAfterEvent(form, 'ev-submit-89', 'submit', '#sf');
    await flushMutations();

    // Click lifecycle finalizes FIRST → click window settles with a live
    // (companion) submit window present — must NOT be superseded.
    finalize('ev-click-88', 'Click', 'lc-click-88');
    await flushMutations();

    await vi.waitFor(() => {
      expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });

    const clickEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'ev-click-88');
    expect(clickEvidence?.applicationEvidence.resultingState).toBeDefined();
    expect(clickEvidence?.applicationEvidence.resultingState?.items[0].numericValue).toBe(3);
  });
});
