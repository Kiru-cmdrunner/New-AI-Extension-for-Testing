/**
 * 7.4-B3 E2E C3 RCA probe (kept: pins the EvidenceCollector dismissal-window semantics the C3 RCA relied on — window-per-discrete-event, lifecycle binding, quiescence close).
 *
 * Reproduces the census fixture's F-pop-4 dismissal sequence against the
 * REAL EvidenceCollector + AdaptiveWindow to determine why the dismissal
 * click's evidence window never delivered in real Chrome:
 *
 *   click A (button, lifecycle-bound + finalize-with-settle)
 *     → 1100ms later → click B (plain backdrop div)
 *
 * Expected (harness C3'): click B opens its own evidence window and
 * delivers BehavioralEvidence keyed to its event id.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('EvidenceCollector — dismissal window probe (7.4-B3 C3 RCA)', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];
  let mockNow: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    mockNow = 0;

    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();

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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const tick = (ms: number) => { mockNow += ms; vi.advanceTimersByTime(ms); };

  /** Let jsdom's MutationObserver deliver its records (microtask-deferred). */
  const settleMutations = async () => { await Promise.resolve(); await Promise.resolve(); };

  it('dismissal click AFTER settle-finalize still opens its own window', async () => {
    const btn = document.createElement('button');
    btn.id = 'open-popover';
    btn.textContent = 'Open popover';
    document.body.appendChild(btn);
    const backdrop = document.createElement('div');
    backdrop.id = 'popover-backdrop';
    document.body.appendChild(backdrop);
    const popover = document.createElement('div');
    popover.id = 'popover';
    document.body.appendChild(popover);

    // Click A: open-popover button
    collector.onAfterEvent(btn, 'evt-A', 'click', '');
    // Click lifecycle starts → LIFECYCLE_BOUND
    collector.handleLifecycleBound({ lifecycleId: 'lc-1', triggerEventId: 'evt-A', interactionType: 'Click' });
    tick(50);
    // popover opens (DOM mutation → recorded batch)
    popover.style.display = 'block';
    backdrop.style.display = 'block';
    await settleMutations();
    tick(50);
    // Click completes → FINALIZE_EVIDENCE (settle mode)
    collector.finalizeForInteraction({
      lifecycleId: 'lc-1',
      interactionId: 'int-1',
      interactionType: 'Click',
      eventIds: ['evt-A'],
      metadata: {},
      endState: 'completed',
    });
    // Settle window quiescence: 300ms with no mutations → closes + delivers
    tick(400);
    const aEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'evt-A');
    expect(aEvidence).toBeDefined();

    // 1100ms later (harness sleep(1100) after open click)
    tick(1100);

    // Dismissal click on the plain backdrop div
    collector.onAfterEvent(backdrop, 'evt-B', 'click', '');
    popover.style.display = 'none';
    backdrop.removeAttribute('style');
    await settleMutations();
    tick(400); // quiescence

    const bEvidence = deliveredEvidence.find((e) => e.sourceEventId === 'evt-B');
    // If the collector is healthy, evt-B's window delivered:
    expect(bEvidence).toBeDefined();
    expect(bEvidence?.applicationEvidence.domChanges.map((d) => d.targetPath))
      .toEqual(expect.arrayContaining(['body > div#popover', 'body > div#popover-backdrop']));
  });

  it('dismissal click 500ms after finalize (pre-fix harness timing) opens its own window too', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const backdrop = document.createElement('div');
    document.body.appendChild(backdrop);

    collector.onAfterEvent(btn, 'evt-A', 'click', '');
    collector.handleLifecycleBound({ lifecycleId: 'lc-1', triggerEventId: 'evt-A', interactionType: 'Click' });
    tick(50);
    collector.finalizeForInteraction({
      lifecycleId: 'lc-1', interactionId: 'int-1', interactionType: 'Click',
      eventIds: ['evt-A'], metadata: {}, endState: 'completed',
    });
    tick(450); // settle close + companion suppression expiry

    collector.onAfterEvent(backdrop, 'evt-B', 'click', '');
    tick(400);

    expect(deliveredEvidence.find((e) => e.sourceEventId === 'evt-B')).toBeDefined();
  });
});
