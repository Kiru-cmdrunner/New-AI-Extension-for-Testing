/**
 * Post-Commit Navigation Evidence Window — Unit Tests (AC1–AC3, AC8b shape)
 *
 * From .drytis/specs/post-nav-evidence-capture.md. Verifies the content-script
 * side of the NAV pull model: openPostNavWindow waits for body, opens a
 * navigation-owned window attributed to the SW's navEventId, is bounded by
 * the post-nav settle cap, is exactly-once per document, and delivers through
 * the standard BEHAVIORAL_EVIDENCE path with the rebuilt navigation entry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { PostNavCaptureRecord } from '../../src/shared/post-nav-types';

describe('EvidenceCollector.openPostNavWindow', () => {
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

  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  /**
   * jsdom defers MutationObserver callbacks to a microtask; fake timers do
   * not flush microtasks, so we yield explicitly after DOM churn.
   */
  async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  function makeRecord(overrides?: Partial<PostNavCaptureRecord>): PostNavCaptureRecord {
    return {
      navEventId: 'nav-1000-abc',
      fromUrl: 'https://www.amazon.in/s?k=vivo',
      toUrl: 'https://www.amazon.in/s?k=vivo+phones',
      navType: 'form_submit',
      committedAt: 0,
      ...overrides,
    };
  }

  function lastDelivered(): BehavioralEvidence | undefined {
    return deliveredEvidence[deliveredEvidence.length - 1];
  }

  it('AC1: opens a navigation window attributed to navEventId and delivers with rebuilt nav entry', async () => {
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(0); // body-ready microtask flush
    expect(collector.getActiveWindowCount()).toBe(1);

    // Simulate destination render churn
    const results = document.createElement('div');
    results.id = 'results';
    document.body.appendChild(results);
    await flushMutations();

    advance(350); // stabilization
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(deliveredEvidence.length).toBe(1);

    const evidence = lastDelivered()!;
    expect(evidence.sourceEventId).toBe('nav-1000-abc');
    expect(evidence.sourceEventType).toBe('navigation');
    expect(evidence.applicationEvidence?.navigation?.length).toBe(1);
    const nav = evidence.applicationEvidence!.navigation![0];
    expect(nav.type).toBe('form_submit');
    expect(nav.fromUrl).toBe('https://www.amazon.in/s?k=vivo');
    expect(nav.toUrl).toBe('https://www.amazon.in/s?k=vivo+phones');
    // DOM churn captured and attributed to the nav interaction
    expect(evidence.applicationEvidence!.domChanges!.length).toBeGreaterThan(0);
  });

  it('AC1b: waits for document.body before opening when body is absent', async () => {
    // Simulate document_start-like environment: body removed
    const html = document.documentElement;
    const savedBody = document.body;
    html.removeChild(savedBody);

    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(50);
    expect(collector.getActiveWindowCount()).toBe(0); // not yet open

    // Body appears (DOMContentLoaded-ish)
    html.appendChild(savedBody);
    await vi.advanceTimersByTimeAsync(50);
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('AC1c: drains surfaces and visibility alongside DOM changes', async () => {
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(0);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await flushMutations();

    advance(400);
    const evidence = lastDelivered();
    expect(evidence).toBeDefined();
    expect(evidence!.sourceEventId).toBe('nav-1000-abc');
    expect(evidence!.applicationEvidence!.newSurfaces!.length + evidence!.applicationEvidence!.visibilityChanges!.length).toBeGreaterThanOrEqual(1);
  });

  it('AC2: closes at the post-nav hard cap even under continuous churn', async () => {
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(0);
    expect(collector.getActiveWindowCount()).toBe(1);

    // Continuous mutation churn — stabilization timer keeps resetting, so
    // ONLY the 3s hard cap can close it. 45 iterations × 60ms = 2700ms < 3000.
    for (let i = 0; i < 45; i++) {
      const el = document.createElement('div');
      el.textContent = `churn-${i}`;
      document.body.appendChild(el);
      await flushMutations();
      advance(60); // < 300ms minQuiescence, keeps window open
    }
    expect(collector.getActiveWindowCount()).toBe(1); // still open under churn

    // Stop churning and let the hard cap fire (3000 − 2700 = 300ms remain)
    advance(300);
    expect(collector.getActiveWindowCount()).toBe(0); // hard cap closed it
    expect(deliveredEvidence.length).toBe(1);
    const evidence = lastDelivered()!;
    expect(evidence.applicationEvidence!.domChanges!.length).toBeGreaterThan(0);
  });

  it('AC3: second call for the same navEventId is a no-op (exactly-once per document)', async () => {
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(0);
    expect(collector.getActiveWindowCount()).toBe(1);

    collector.openPostNavWindow(makeRecord()); // duplicate
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(400);
    expect(deliveredEvidence.length).toBe(1); // exactly one delivery
  });

  it('AC3b: a DIFFERENT navEventId in the same document opens a second window', async () => {
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(0);

    collector.openPostNavWindow(makeRecord({ navEventId: 'nav-2000-def' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(collector.getActiveWindowCount()).toBe(2);
  });

  it('AC8b: does nothing when not running (recording stopped)', async () => {
    collector.stop();
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(50);
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(deliveredEvidence.length).toBe(0);
  });

  it('targetEvidence is identity-shaped for the navigation document (no null identity crash)', async () => {
    collector.openPostNavWindow(makeRecord());
    await vi.advanceTimersByTimeAsync(0);
    advance(400);
    const evidence = lastDelivered()!;
    expect(evidence.targetEvidence).not.toBeNull();
    expect(evidence.targetEvidence!.identity).not.toBeNull();
  });
});
