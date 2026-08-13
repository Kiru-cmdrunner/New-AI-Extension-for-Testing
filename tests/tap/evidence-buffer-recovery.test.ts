/**
 * TD-7: F5 / sessionStorage Evidence Recovery Path
 *
 * Validates the full evidence survival path:
 *   pagehide → onPageHide() → deliverEvidence() → bufferEvidence()
 *   → sessionStorage['cmdrunner_evidence_buffer']
 *   → F5 reload
 *   → startRecording() → flushBufferedEvidence() → re-deliver to SW
 *
 * Tests cover:
 *   1. Evidence buffered during onPageHide survives in sessionStorage
 *   2. flushBufferedEvidence replays buffered evidence to SW with { ok: true }
 *   3. flushBufferedEvidence retains undelivered evidence (SW cold-start)
 *   4. flushBufferedEvidence clears buffer after confirmed delivery
 *   5. Buffer cap (50 entries) drops oldest
 *   6. Empty buffer is a no-op
 *   7. Corrupt buffer is cleared gracefully
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

const BUFFER_KEY = 'cmdrunner_evidence_buffer';
const MAX_BUFFER = 50;

/** Minimal valid BehavioralEvidence for testing. */
function makeEvidence(id: string): BehavioralEvidence {
  return {
    sourceEventId: id,
    sourceEventType: 'click',
    windowId: `ev-${id}`,
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 1,
      durationMs: 1,
      endReason: 'page-reload',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: null,
      identityCapturedAt: 0,
      before: null,
      after: null,
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: false,
        longestBatchMs: 0,
        totalBatches: 0,
      },
    },
  };
}

describe('TD-7: F5 / sessionStorage Evidence Recovery', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let mockNow: number;
  let swResponses: Map<string, { ok: boolean } | undefined>;
  let swCallCount: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    mockNow = 0;
    swResponses = new Map();
    swCallCount = 0;

    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();

    // Mock SW: responds based on a response map keyed by sourceEventId.
    // Default: { ok: true } (SW is alive and confirms receipt).
    // Explicit undefined = SW cold-start (no response body).
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((
          msg: { type: string; payload?: unknown },
          cb?: (resp?: { ok: boolean }) => void,
        ) => {
          swCallCount++;
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            const evidence = msg.payload as BehavioralEvidence;
            // If explicit response set (including undefined), use it.
            // Otherwise default to { ok: true } (warm SW).
            const hasKey = swResponses.has(evidence.sourceEventId);
            const resp = hasKey
              ? swResponses.get(evidence.sourceEventId)
              : { ok: true };
            if (cb) cb(resp);
          }
        }),
        lastError: undefined,
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
          hasListener: vi.fn(),
        },
      },
    } as unknown as typeof chrome;

    cache = new TargetStateCache();
    observer = new DOMObserver();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // ── Helper: read the buffer from sessionStorage ──────────────────

  function readBuffer(): BehavioralEvidence[] {
    const raw = sessionStorage.getItem(BUFFER_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function writeToBuffer(evidence: BehavioralEvidence[]): void {
    if (evidence.length === 0) {
      sessionStorage.removeItem(BUFFER_KEY);
    } else {
      sessionStorage.setItem(BUFFER_KEY, JSON.stringify(evidence));
    }
  }

  // ── 1. Evidence buffered during onPageHide survives ──────────────

  it('onPageHide finalizes lifecycle-bound windows and buffers evidence to sessionStorage', () => {
    // Simulate: a lifecycle-bound window is open when pagehide fires.
    // We can't easily create a real lifecycle-bound window in a unit test,
    // but we can verify the bufferEvidence path by checking that
    // deliverEvidence always writes to sessionStorage.
    // Use the public API indirectly: call onPageHide with an active window
    // We'll pre-populate an active window via onAfterEvent (click)
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    document.body.appendChild(btn);

    // Simulate a click that opens an evidence window
    collector.onAfterEvent(btn, 'evt-1', 'click', 'button', null);

    // Mark as lifecycle-bound (simulates LIFECYCLE_BOUND message)
    collector.handleLifecycleBound({
      lifecycleId: 'lc-1',
      triggerEventId: 'evt-1',
      interactionType: 'click',
    });

    // Fire pagehide
    collector.onPageHide();

    // Evidence should be buffered in sessionStorage
    const buffer = readBuffer();
    expect(buffer.length).toBeGreaterThanOrEqual(1);
    expect(buffer[0].sourceEventId).toBe('evt-1');
    expect(buffer[0].window.endReason).toBe('page-reload');
  });

  // ── 2. flushBufferedEvidence replays with SW alive ───────────────

  it('flushBufferedEvidence delivers buffered evidence to SW and clears buffer on confirmed delivery', () => {
    // Pre-populate sessionStorage with evidence from a "previous page"
    const evidence1 = makeEvidence('evt-prev-1');
    const evidence2 = makeEvidence('evt-prev-2');
    writeToBuffer([evidence1, evidence2]);

    // SW is alive — responds { ok: true } for both
    swResponses.set('evt-prev-1', { ok: true });
    swResponses.set('evt-prev-2', { ok: true });

    // Flush
    collector.flushBufferedEvidence();

    // Run any pending callbacks (sendMessage uses callbacks)
    vi.runAllTimers();

    // Buffer should be cleared (all confirmed delivered)
    expect(readBuffer().length).toBe(0);
    // SW should have received 2 messages
    expect(swCallCount).toBe(2);
  });

  // ── 3. flushBufferedEvidence retains undelivered evidence ────────

  it('flushBufferedEvidence retains evidence when SW is cold-starting (no { ok: true })', () => {
    const evidence1 = makeEvidence('evt-prev-1');
    const evidence2 = makeEvidence('evt-prev-2');
    writeToBuffer([evidence1, evidence2]);

    // SW cold-start: responds undefined (no response body)
    swResponses.set('evt-prev-1', undefined);
    swResponses.set('evt-prev-2', undefined);

    collector.flushBufferedEvidence();
    vi.runAllTimers();

    // Buffer should retain both (none confirmed)
    const remaining = readBuffer();
    expect(remaining.length).toBe(2);
    expect(remaining[0].sourceEventId).toBe('evt-prev-1');
    expect(remaining[1].sourceEventId).toBe('evt-prev-2');
  });

  // ── 4. Partial delivery: some confirmed, some not ────────────────

  it('flushBufferedEvidence retains only undelivered evidence on partial delivery', () => {
    const evidence1 = makeEvidence('evt-delivered');
    const evidence2 = makeEvidence('evt-undelivered');
    writeToBuffer([evidence1, evidence2]);

    swResponses.set('evt-delivered', { ok: true });
    swResponses.set('evt-undelivered', undefined);

    collector.flushBufferedEvidence();
    vi.runAllTimers();

    const remaining = readBuffer();
    expect(remaining.length).toBe(1);
    expect(remaining[0].sourceEventId).toBe('evt-undelivered');
  });

  // ── 5. Buffer cap drops oldest ───────────────────────────────────

  it('bufferEvidence caps at MAX_EVIDENCE_BUFFER (50), dropping oldest', () => {
    // Fill buffer beyond cap
    const overfill: BehavioralEvidence[] = [];
    for (let i = 0; i < MAX_BUFFER + 5; i++) {
      overfill.push(makeEvidence(`evt-${i}`));
    }
    writeToBuffer(overfill);

    // Simulate: deliverEvidence is called for one more evidence item
    // by having the collector process a new interaction while buffer is full.
    // We test the cap via the direct bufferEvidence path.
    // Since bufferEvidence is private, we test it indirectly:
    // flushBufferedEvidence reads the pre-existing buffer (which was
    // already capped at write time by the previous page).

    // Verify buffer cap was applied at write time — simulate a fresh write
    // of MAX_BUFFER + 5 items to see if bufferEvidence caps them.
    // We use deliverEvidence via onPageHide to trigger bufferEvidence.
    sessionStorage.removeItem(BUFFER_KEY);

    // Pre-populate with MAX_BUFFER items
    const items: BehavioralEvidence[] = [];
    for (let i = 0; i < MAX_BUFFER; i++) {
      items.push(makeEvidence(`evt-${i}`));
    }
    writeToBuffer(items);

    // Now add one more via collector (simulates new evidence during pagehide)
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-extra', 'click', 'button', null);
    collector.handleLifecycleBound({
      lifecycleId: 'lc-extra',
      triggerEventId: 'evt-extra',
      interactionType: 'click',
    });
    collector.onPageHide();

    // Buffer should be capped at MAX_BUFFER, and oldest should be dropped
    const buffer = readBuffer();
    expect(buffer.length).toBe(MAX_BUFFER);
    // The newest item should be evt-extra (last pushed)
    expect(buffer[buffer.length - 1].sourceEventId).toBe('evt-extra');
    // The oldest (evt-0) should have been dropped
    expect(buffer[0].sourceEventId).not.toBe('evt-0');
  });

  // ── 6. Empty buffer is a no-op ───────────────────────────────────

  it('flushBufferedEvidence is a no-op when buffer is empty', () => {
    // No buffer in sessionStorage
    expect(sessionStorage.getItem(BUFFER_KEY)).toBeNull();

    collector.flushBufferedEvidence();
    vi.runAllTimers();

    // No SW calls should have been made
    expect(swCallCount).toBe(0);
    expect(sessionStorage.getItem(BUFFER_KEY)).toBeNull();
  });

  // ── 7. Corrupt buffer is cleared ─────────────────────────────────

  it('flushBufferedEvidence clears corrupt buffer gracefully', () => {
    sessionStorage.setItem(BUFFER_KEY, '{ this is not valid JSON');

    collector.flushBufferedEvidence();
    vi.runAllTimers();

    // Buffer should be cleared (corrupt data removed)
    expect(sessionStorage.getItem(BUFFER_KEY)).toBeNull();
  });

  // ── 8. Multi-flush: first fails, second succeeds ─────────────────

  it('evidence retained after first flush (SW cold) is delivered on second flush (SW warm)', () => {
    const evidence = makeEvidence('evt-survivor');
    writeToBuffer([evidence]);

    // First flush: SW cold (no confirmation)
    swResponses.set('evt-survivor', undefined);
    collector.flushBufferedEvidence();
    vi.runAllTimers();

    // Still in buffer
    expect(readBuffer().length).toBe(1);

    // Second flush: SW warm
    swResponses.set('evt-survivor', { ok: true });
    collector.flushBufferedEvidence();
    vi.runAllTimers();

    // Now cleared
    expect(readBuffer().length).toBe(0);
  });

  // ── 9. Full F5 simulation: pagehide → buffer → flush ─────────────

  it('full F5 cycle: pagehide buffers evidence, flushBufferedEvidence delivers it on reload', () => {
    // Phase 1: Active interaction, pagehide fires
    const btn = document.createElement('button');
    btn.textContent = 'Search';
    document.body.appendChild(btn);

    collector.onAfterEvent(btn, 'evt-f5-1', 'click', 'button', null);
    collector.handleLifecycleBound({
      lifecycleId: 'lc-f5-1',
      triggerEventId: 'evt-f5-1',
      interactionType: 'click',
    });

    // Simulate time passing
    mockNow = 600; // >500ms so TD-4 safety net would also apply

    collector.onPageHide();

    // Evidence should be buffered
    const buffer1 = readBuffer();
    expect(buffer1.length).toBeGreaterThanOrEqual(1);
    const bufferedId = buffer1[0].sourceEventId;
    expect(bufferedId).toBe('evt-f5-1');

    // Phase 2: "F5 reload" — new EvidenceCollector on the new page
    // (simulate by creating a fresh collector, as startRecording does)
    collector.stop();
    const collector2 = new EvidenceCollector({
      targetStateCache: cache,
      domObserver: observer,
    });
    collector2.start();

    // SW is warm on the new page
    swResponses.set('evt-f5-1', { ok: true });

    collector2.flushBufferedEvidence();
    vi.runAllTimers();

    // Buffer should be cleared
    expect(readBuffer().length).toBe(0);
    collector2.stop();
  });
});
