/**
 * Fix Pair 2 + 4 regression tests
 * (.drytis/specs/fix-pair-2-4-window-accumulation-postnav-finalize.md)
 *
 * Fix 2 (INV-C1): the shared DOM/surface/visibility accumulation is cleared
 * only at a true boundary — when the window being opened/closed is the only
 * live window. While another window is open, openWindow('submit') must not
 * wipe the churn an earlier click window accumulated and will drain at its
 * 150ms lifecycle finalize.
 *
 * Fix 4 (INV-C2): a post-navigation window is finalized ONLY by its own
 * AdaptiveWindow (stabilization / 3s hard cap) or pagehide/stop — never by
 * generic FINALIZE_EVIDENCE matching, never via finalizeWithoutWindow, never
 * bound by handleLifecycleBound.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { PostNavCaptureRecord } from '../../src/shared/post-nav-types';

describe('Fix 2: overlapping-window accumulation protection', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];

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
        lastError: undefined,
      },
    } as unknown as typeof chrome;

    cache = new TargetStateCache();
    observer = new DOMObserver();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    vi.restoreAllMocks();
  });

  /** jsdom defers MutationObserver callbacks to microtasks; flush them. */
  async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function appendsChurn(count: number, prefix = 'widget'): void {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.id = `${prefix}-${i}`;
      p.className = 'a-row';
      document.body.appendChild(p);
      const child = document.createElement('span');
      child.textContent = `${prefix}${i}`;
      p.appendChild(child);
    }
  }

  /** Add an element isSignificantSurface() recognizes (SURFACE_ROLES). */
  function appendSurface(id: string): void {
    const s = document.createElement('div');
    s.id = id;
    s.setAttribute('role', 'listbox');
    document.body.appendChild(s);
  }

  it('T1 (int-23 repro): click churn survives a later submit window open', async () => {
    const btn = document.createElement('input');
    btn.type = 'submit';
    btn.id = 'add-to-cart-button';
    document.body.appendChild(btn);
    const form = document.createElement('form');
    document.body.appendChild(form);

    // t=0: click window opens (true boundary — clears, correctly)
    collector.onAfterEvent(btn, 'evt-click-1', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    // widget churn on 5 distinct targets
    appendsChurn(5);
    await flushMutations();

    // t~40ms: form submit fires → openWindow('submit') must NOT wipe
    collector.onAfterEvent(form, 'evt-submit-1', 'submit', '');
    expect(collector.getActiveWindowCount()).toBe(2);

    // one late mutation after submit (page teardown span)
    const late = document.createElement('span');
    btn.appendChild(late);
    await flushMutations();

    // lifecycle finalize for the click (SW FINALIZE_EVIDENCE → settle mode;
    // consequence-settling replaces the old fixed 150ms settle)
    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-1',
      interactionId: 'int-23',
      interactionType: 'Click',
      eventIds: ['evt-click-1'],
      metadata: {},
      endState: 'completed',
    });
    await new Promise((r) => setTimeout(r, 600));

    const clickEv = deliveredEvidence.find((e) => e.sourceEventId === 'evt-click-1');
    expect(clickEv).toBeDefined();
    // INV-C1: the 5 widget summaries must have survived the submit open.
    expect(clickEv!.applicationEvidence.domChanges.length).toBeGreaterThanOrEqual(5);
    expect(clickEv!.window.endReason).toBe('consequence-settled');
  });

  it('T2: click evidence keeps surfaces and visibility across the submit open', async () => {
    const btn = document.createElement('input');
    btn.type = 'submit';
    btn.id = 'add-to-cart-button';
    document.body.appendChild(btn);
    const form = document.createElement('form');
    document.body.appendChild(form);

    collector.onAfterEvent(btn, 'evt-click-2', 'click', '');

    // surface churn: real significant surfaces (role=listbox) + DOM churn
    appendsChurn(3, 'surf');
    appendSurface('flyout-listbox-1');
    appendSurface('flyout-listbox-2');
    await flushMutations();
    // visibility: aria-hidden flip on a live element
    const vis = document.createElement('div');
    vis.id = 'vis-target';
    vis.setAttribute('aria-hidden', 'false');
    document.body.appendChild(vis);
    await flushMutations();
    vis.setAttribute('aria-hidden', 'true');
    await flushMutations();

    collector.onAfterEvent(form, 'evt-submit-2', 'submit', '');

    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-2',
      interactionId: 'int-24',
      interactionType: 'Click',
      eventIds: ['evt-click-2'],
      metadata: {},
      endState: 'completed',
    });
    await new Promise((r) => setTimeout(r, 600));

    const clickEv = deliveredEvidence.find((e) => e.sourceEventId === 'evt-click-2');
    expect(clickEv).toBeDefined();
    // INV-C1: surfaces + visibility must survive the submit window open.
    expect(clickEv!.applicationEvidence.newSurfaces.length).toBeGreaterThanOrEqual(2);
    expect(clickEv!.applicationEvidence.visibilityChanges.length).toBeGreaterThanOrEqual(1);
    expect(clickEv!.applicationEvidence.domChanges.length).toBeGreaterThanOrEqual(5);
  });

  it('T3: first-window open still resets accumulation (true boundary preserved)', async () => {
    // Pre-create BOTH buttons so no DOM mutation happens inside window B's
    // lifetime (a post-open append would be legitimately attributed to B).
    const elA = document.createElement('button');
    document.body.appendChild(elA);
    const elB = document.createElement('button');
    document.body.appendChild(elB);
    await flushMutations();

    // Window A: open → churn → close (stabilization 300ms)
    collector.onAfterEvent(elA, 'evt-a', 'click', '');
    appendsChurn(3, 'a-churn');
    await flushMutations();
    await new Promise((r) => setTimeout(r, 400));

    const evA = deliveredEvidence.find((e) => e.sourceEventId === 'evt-a');
    expect(evA).toBeDefined();
    expect(evA!.applicationEvidence.domChanges.length).toBeGreaterThanOrEqual(3);

    // Window B opens AFTER A closed — must not inherit A's churn
    collector.onAfterEvent(elB, 'evt-b', 'click', '');
    await new Promise((r) => setTimeout(r, 400));

    const evB = deliveredEvidence.find((e) => e.sourceEventId === 'evt-b');
    expect(evB).toBeDefined();
    // B made no mutations of its own; it must NOT see A's 3 summaries.
    expect(evB!.applicationEvidence.domChanges.length).toBe(0);
  });

  it('T4: the submit window still delivers its own evidence', async () => {
    const form = document.createElement('form');
    document.body.appendChild(form);

    collector.onAfterEvent(form, 'evt-submit-3', 'submit', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    // churn AFTER the submit open belongs to the submit window
    appendsChurn(2, 'post-submit');
    await flushMutations();

    // The submit lifecycle finalizes (the SW path for form submits).
    // Settle era: the submit window also enters settle mode; its own
    // quiescence closes it (consequence-settled) after the churn settles.
    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-submit-3',
      interactionId: 'int-submit',
      interactionType: 'FormSubmit',
      eventIds: ['evt-submit-3'],
      metadata: {},
      endState: 'completed',
    });
    await new Promise((r) => setTimeout(r, 600));

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-submit-3');
    expect(ev).toBeDefined();
    expect(ev!.sourceEventId).toBe('evt-submit-3');
    expect(ev!.applicationEvidence.domChanges.length).toBeGreaterThanOrEqual(2);
    expect(['stabilized', 'max-duration', 'lifecycle-complete', 'consequence-settled']).toContain(ev!.window.endReason);
  });
});

describe('Fix 4: post-nav finalization isolation', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    vi.spyOn(performance, 'now');
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            deliveredEvidence.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;

    cache = new TargetStateCache();
    observer = new DOMObserver();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    vi.restoreAllMocks();
  });

  async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function makeRecord(overrides?: Partial<PostNavCaptureRecord>): PostNavCaptureRecord {
    return {
      navEventId: 'nav-2000-xyz',
      fromUrl: 'https://www.amazon.in/dp/B0FFF9VPMN',
      toUrl: 'https://www.amazon.in/cart/add-to-cart',
      navType: 'form_submit',
      committedAt: 0,
      ...overrides,
    };
  }

  // Unique-element churn counter: the DOMObserver accumulation is keyed by
  // target path — re-using the same id across calls collapses entries.
  let churnCounter = 0;
  function appendsChurn(count: number, prefix = 'dest'): void {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.id = `${prefix}-${churnCounter++}`;
      p.className = 'cart-row';
      document.body.appendChild(p);
      const child = document.createElement('span');
      child.textContent = `${prefix}${churnCounter}`;
      p.appendChild(child);
    }
  }

  it('T5: FINALIZE_EVIDENCE for navEventId does not close the post-nav window', async () => {
    collector.openPostNavWindow(makeRecord());
    await flushMutations();
    expect(collector.getActiveWindowCount()).toBe(1);

    // Destination-page churn arriving AROUND the time the Navigation
    // lifecycle's FINALIZE_EVIDENCE would prematurely close the window
    // (~150ms settle). Real destination pages churn continuously as the
    // results render — model that with a churn interval.
    const churn = setInterval(() => appendsChurn(1, 'dest'), 80);

    // Navigation definition completes immediately → generic finalize arrives
    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-nav-1',
      interactionId: 'int-25',
      interactionType: 'Navigation',
      eventIds: ['nav-2000-xyz'],
      metadata: { pageUrl: 'https://www.amazon.in/cart/add-to-cart' },
      endState: 'completed',
    });

    // Must NOT have closed at the 150ms settle point, nor via its own 300ms
    // stabilization (churn keeps re-arming it) — the OLD code closed the
    // window here (lifecycle-complete @~150ms).
    await new Promise((r) => setTimeout(r, 800));
    clearInterval(churn);
    expect(collector.getActiveWindowCount()).toBe(1);

    // Churn stopped → its OWN stabilization closes it (~300ms later)
    await new Promise((r) => setTimeout(r, 450));

    const navEv = deliveredEvidence.find((e) => e.sourceEventId === 'nav-2000-xyz');
    expect(navEv).toBeDefined();
    expect(navEv!.windowId).toBe('ev-nav-2000-xyz');
    expect(navEv!.window.endReason).toBe('stabilized');
    // Duration must reflect its own settling (~1250ms), not ~150ms.
    expect(navEv!.window.durationMs).toBeGreaterThanOrEqual(1000);
    expect(navEv!.applicationEvidence.domChanges.length).toBeGreaterThanOrEqual(4);

    // Exactly once: no fallback synth evidence for the nav finalize
    // (finalizeWithoutWindow would emit a second, synthetic delivery).
    expect(
      deliveredEvidence.filter((e) => e.sourceEventId === 'nav-2000-xyz').length,
    ).toBe(1);
  }, 8000);

  it('T6: post-nav window under churn closes at its own 3s hard cap', async () => {
    collector.openPostNavWindow(makeRecord());
    await flushMutations();

    // Continuous churn every 100ms keeps the stabilization timer resetting
    const churn = setInterval(() => {
      const d = document.createElement('div');
      d.className = 'cart-row';
      document.body.appendChild(d);
    }, 100);

    // still open at t=1s (past the old ~154ms premature close)
    await new Promise((r) => setTimeout(r, 1000));
    expect(collector.getActiveWindowCount()).toBe(1);

    await new Promise((r) => setTimeout(r, 2300));
    clearInterval(churn);
    await new Promise((r) => setTimeout(r, 200));

    const navEv = deliveredEvidence.find((e) => e.sourceEventId === 'nav-2000-xyz');
    expect(navEv).toBeDefined();
    expect(navEv!.window.endReason).toBe('max-duration');
    // ~3s minus timer jitter; the assertion catches the ~150ms premature
    // close, not sub-millisecond precision.
    expect(navEv!.window.durationMs).toBeGreaterThanOrEqual(2900);
    expect(navEv!.applicationEvidence.domChanges.length).toBeGreaterThan(0);
  }, 8000);

  it('T7: generic FINALIZE_EVIDENCE for a normal click still finalizes it', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    collector.onAfterEvent(btn, 'evt-click-3', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    (collector as unknown as { finalizeForInteraction: (p: object) => void }).finalizeForInteraction({
      lifecycleId: 'lc-3',
      interactionId: 'int-26',
      interactionType: 'Click',
      eventIds: ['evt-click-3'],
      metadata: {},
      endState: 'completed',
    });
    // Settle era: no fixed 150ms close — the window settles on quiescence.
    await new Promise((r) => setTimeout(r, 600));

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-click-3');
    expect(ev).toBeDefined();
    expect(ev!.window.endReason).toBe('consequence-settled');
    expect(ev!.window.durationMs).toBeLessThan(4000);
  });

  it('T8: handleLifecycleBound does not hold the post-nav window open', async () => {
    collector.openPostNavWindow(makeRecord());
    await flushMutations();

    // A nav-triggered lifecycle binding arrives retroactively — must be
    // ignored for the post-nav window (Phase-1 AC2: hard cap stays armed).
    (collector as unknown as { handleLifecycleBound: (p: object) => void }).handleLifecycleBound({
      lifecycleId: 'lc-nav-2',
      triggerEventId: 'nav-2000-xyz',
      interactionType: 'Navigation',
    });

    // Under zero churn the window must still close via its own timers
    // (stabilization at ~300ms). If it had been hold-open'd, it would sit
    // open until the 10s default cap or recording stop.
    await new Promise((r) => setTimeout(r, 500));
    expect(collector.getActiveWindowCount()).toBe(0);
  });
});
