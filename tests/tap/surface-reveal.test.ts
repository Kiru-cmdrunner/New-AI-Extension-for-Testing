/**
 * Surface Reveal + Descendant Detection — Integration Tests
 * (.drytis/specs/surface-detection-generification.md §11, red phase)
 *
 * Collector-level: surfaces produced by 5a (bounded descendant scan) and
 * 5b (reveal of an already-significant element) must flow through the
 * existing drain path — settle-mode windows, pagehide (INV-4), caps —
 * without touching window lifecycles, Click/Navigation separation, or
 * the shape guard in sw-integration (not loaded here).
 *
 * Conventions mirror tests/tap/consequence-settling.test.ts (Part 3):
 * mock chrome.runtime capturing BEHAVIORAL_EVIDENCE payloads; drive the
 * collector via onAfterEvent + finalizeForInteraction; flush mutations
 * with triple await Promise.resolve().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { NetworkBridge } from '../../src/tap/network-bridge';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('Surface reveal + descendant detection (collector level)', () => {
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
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer, networkBridge: bridge });
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

  it('IA1: reveal of role=dialog during settle delivers emergence=revealed, endReason=consequence-settled', async () => {
    // Pre-rendered, hidden, recognized surface (5b shape)
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Added to cart');
    dialog.setAttribute('style', 'display:none');
    document.body.appendChild(dialog);
    await flushMutations();

    const btn = document.createElement('button');
    btn.textContent = 'Add to cart';
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-1', 'click', '');
    finalizeClick('evt-1');
    await waitFor(120);
    expect(collector.getActiveWindowCount()).toBe(1); // in settle mode

    // Reveal the hidden surface during settle
    dialog.setAttribute('style', 'display:block');
    await flushMutations();

    await waitFor(450); // quiescence + causal idle → close
    expect(collector.getActiveWindowCount()).toBe(0);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-1');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    const revealed = (ev!.applicationEvidence.newSurfaces ?? []).filter((s) => s.emergence === 'revealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0].ariaRole).toBe('dialog');
    expect((ev!.applicationEvidence.visibilityChanges ?? []).some((v) => v.property === 'display')).toBe(true);
  }, 8000);

  it('IA2: wrapper+descendant insert during settle delivers descendant identity, emergence=inserted', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-2', 'click', '');
    finalizeClick('evt-2');
    await waitFor(120);

    // Wrapper insert with descendant dialog (5a shape)
    const wrapper = document.createElement('div');
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-label', 'Nested');
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    await flushMutations();

    await waitFor(450);
    expect(collector.getActiveWindowCount()).toBe(0);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-2');
    expect(ev).toBeDefined();
    const inserted = (ev!.applicationEvidence.newSurfaces ?? []).filter((s) => s.emergence === 'inserted' || s.emergence === undefined);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].ariaRole).toBe('dialog');
    expect(inserted[0].accessibleName).toBe('Nested');
  }, 8000);

  it('IA3: 60 surfaces in one window → delivered newSurfaces capped at 50', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-3', 'click', '');

    // Direct inserts (no scan budget issue): 60 dialogs appended in one batch
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 60; i++) {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-label', 'D' + i);
      frag.appendChild(d);
    }
    document.body.appendChild(frag);
    await flushMutations();

    finalizeClick('evt-3');
    await waitFor(500);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-3');
    expect(ev).toBeDefined();
    expect(ev!.applicationEvidence.newSurfaces!.length).toBe(50);
  }, 8000);

  it('IA4: Vivo shape — pagehide finalizes Click with page-reload + revealed surface; Navigation stays separate', async () => {
    // Pre-rendered hidden surface on the source page
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('style', 'display:none');
    document.body.appendChild(dialog);
    await flushMutations();

    // Vivo-style form with real submit
    const form = document.createElement('form');
    const submit = document.createElement('input');
    submit.type = 'submit';
    submit.id = 'add-to-cart-button';
    form.appendChild(submit);
    document.body.appendChild(form);
    await flushMutations();

    // Click opens window; reveal fires before unload
    collector.onAfterEvent(submit, 'evt-4', 'click', '');
    dialog.setAttribute('style', 'display:block');
    await flushMutations();

    // pagehide: INV-4 finalizes the click window immediately
    (collector as unknown as { onPageHide: () => void }).onPageHide();
    await flushMutations();

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-4');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('page-reload');
    const revealed = (ev!.applicationEvidence.newSurfaces ?? []).filter((s) => s.emergence === 'revealed');
    expect(revealed).toHaveLength(1);

    // Navigation interaction evidence must NOT be attached to the click window
    expect(ev!.applicationEvidence.navigation!.length).toBe(0);
  }, 8000);

  it('IA5: overlapping windows share accumulation — dedup prevents duplicate surface records', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    // Two overlapping windows on the same accumulation:
    collector.onAfterEvent(btn, 'evt-5', 'click', '');
    collector.onAfterEvent(btn, 'evt-6', 'click', '');

    // Wrapper with descendant dialog — recorded once despite shared drain
    const wrapper = document.createElement('div');
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    await flushMutations();

    finalizeClick('evt-5');
    finalizeClick('evt-6');
    await waitFor(600);

    // Each window drains the shared accumulation at its own close, but the
    // DOMObserver dedup ensures a single record per element path per
    // accumulation lifetime — the two deliveries each carry it exactly once.
    for (const ev of deliveredEvidence) {
      const recs = (ev.applicationEvidence.newSurfaces ?? []).filter((s) => s.ariaRole === 'dialog');
      expect(recs.length).toBeLessThanOrEqual(1);
    }
    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
  }, 8000);

  it('IA6: emergence field is optional — legacy-shaped records (no field) pass through unchanged', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    await flushMutations();

    collector.onAfterEvent(btn, 'evt-7', 'click', '');

    // Directly-significant insert (legacy shape: no emergence recorded)
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Legacy');
    document.body.appendChild(dialog);
    await flushMutations();

    finalizeClick('evt-7');
    await waitFor(500);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-7');
    expect(ev).toBeDefined();
    const rec = (ev!.applicationEvidence.newSurfaces ?? [])[0];
    // Field optional: legacy semantics preserved when absent
    expect(rec).toBeDefined();
    expect(rec!.ariaRole).toBe('dialog');
    expect(rec!.kind).toBe('added');
  }, 8000);
});
