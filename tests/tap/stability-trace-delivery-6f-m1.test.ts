/**
 * 6F-M1 Item C — stabilityTrace delivery for consequence-settled windows
 *
 * Spec: .drytis/specs/phase-6f-m1-gesture-ownership.md §2.1.C, §2.3.5, §3.C
 *
 * The settle branch of closeWindow must deliver the recorded stability
 * trace instead of hardcoding []. The lc- lifecycle windows keep [].
 *
 * Pattern follows tests/tap/evidence-collector.test.ts (fake timers,
 * mocked chrome.runtime.sendMessage capture).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ObservedEvent } from '../../src/shared/component-types';

function observedEvent(over: Partial<ObservedEvent> & { eventId: string }): ObservedEvent {
  return {
    timestamp: 0,
    captureSeq: 0,
    isTrusted: true,
    domContext: {} as ObservedEvent['domContext'],
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: '',
    pageTitle: '',
    target: {} as ObservedEvent['target'],
    ...over,
  } as ObservedEvent;
}

describe('6F-M1 C — settle-branch stabilityTrace delivery', () => {
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];
  let mockNow: number;
  let advance: (ms: number) => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    deliveredEvidence = [];
    mockNow = 0;

    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();

    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: 'BEHAVIORAL_EVIDENCE'; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            deliveredEvidence.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;

    const cache = new TargetStateCache();
    const observer = new DOMObserver();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer });
    collector.start();

    advance = (ms: number) => {
      mockNow += ms;
      vi.advanceTimersByTime(ms);
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (global as { chrome?: unknown }).chrome;
  });

  it('AC-C1: settle-mode window delivers its recorded stability trace', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = '';
    document.body.appendChild(input);

    // Open a lifecycle-bound typing window (TD-8 path → settle mode at finalize)
    collector.onAfterEvent(input, 'evt-c1-1', 'input', 'input', null, observedEvent({
      eventId: 'evt-c1-1',
      eventType: 'input',
      valueAfter: 'A',
    }));

    collector.handleLifecycleBound({
      lifecycleId: 'lc-c1',
      triggerEventId: 'evt-c1-1',
      interactionType: 'TextEntry',
    });

    // Advance in steps so the adaptive window records stability samples
    advance(100);
    advance(100);

    collector.finalizeForInteraction({
      lifecycleId: 'lc-c1',
      interactionId: 'int-c1',
      interactionType: 'TextEntry',
      eventIds: ['evt-c1-1'],
      metadata: { textValue: 'A' },
      endState: 'completed',
    });

    advance(500); // quiescence settle

    const evidence = deliveredEvidence.find((e) => e.sourceEventId === 'evt-c1-1');
    expect(evidence).toBeDefined();
    expect(evidence?.window.endReason).toBe('consequence-settled');
    // THE 6F-M1 C fix: trace delivered, not []
    expect(evidence?.window.stabilityTrace).not.toBeNull();
    expect(evidence?.window.stabilityTrace.length).toBeGreaterThan(0);
  });

  it('AC-C2: lc- lifecycle windows keep an honest empty trace', () => {
    // A lifecycle finalize with NO open window for its events → the lc-
    // synthetic evidence path at :1901 (no adaptive window exists).
    collector.finalizeForInteraction({
      lifecycleId: 'lc-c2',
      interactionId: 'int-c2',
      interactionType: 'DatePicker',
      eventIds: ['evt-c2-none'], // no window was ever opened for this event
      metadata: { dateValue: 'X' },
      endState: 'completed',
    });
    advance(250); // lc- path defers delivery by the 150ms settle delay

    const lcEvidence = deliveredEvidence.find((e) => e.windowId.startsWith('lc-'));
    expect(lcEvidence).toBeDefined();
    expect(lcEvidence?.window.stabilityTrace).toEqual([]);
  });
});
