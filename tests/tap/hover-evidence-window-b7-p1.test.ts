/**
 * B7-P1 UNIT — Hover evidence window eligibility & lifecycle (red-first)
 *
 * Spec: .drytis/specs/phase-7-4-b7-hover-evidence-observation.md §5.1
 *   1. Window eligibility per-lifecycle (gated enter), not per-event-type.
 *   2. R-2: unbound provisional hover windows open holdOpen; close ONLY via
 *      binding+terminal, STOP, or pagehide — never settle/quiescence.
 *   5. Displacement preference: provisional hover windows evicted before
 *      non-hover windows.
 *   7. R-3: dialog-drain deferral includes hover windows in the
 *      candidate-owner predicate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('B7-P1: hover evidence window eligibility & lifecycle', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let delivered: BehavioralEvidence[];
  let mockNow: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    delivered = [];
    mockNow = 0;

    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();

    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            delivered.push(msg.payload as BehavioralEvidence);
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

  /** Minimal ObservedEvent the collector joins on (sourceEventId). */
  function observed(eventType: string, eventId: string, tag = 'BUTTON') {
    const tabIndex = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ? 0 : -1;
    return {
      eventId,
      eventType,
      timestamp: mockNow,
      captureSeq: 0,
      isTrusted: true,
      target: {
        accessibleName: 'x', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
        placeholder: null, tag, className: null, name: null, stableId: null,
        testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '', elementId: '',
        rect: null, textContent: null, shadowContext: null,
      },
      domContext: {
        inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
        disabled: false, readOnly: false, required: false, ancestorRoles: [],
        ancestorClasses: [], tabIndex,
      },
      valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }

  // ── §5.1.1 Eligibility (gated enter only) ──────────────────────────

  it('gated mouseenter (button) opens a provisional hover window', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('ungated mouseenter (bare div, no interactive signal) opens NO window', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    collector.onAfterEvent(div, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1', 'DIV'));
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  it('mouseleave and mousemove never open windows', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mousemove', '', null, observed('mousemove', 'evt-1'));
    collector.onAfterEvent(btn, 'evt-2', 'mouseleave', '', null, observed('mouseleave', 'evt-2'));
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  // ── §5.1.2 R-2: holdOpen from birth; no settle close while unbound ──

  it('unbound provisional hover window survives past quiescence + max-duration', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    expect(collector.getActiveWindowCount()).toBe(1);

    // Way past minQuiescence (300ms) and maxDuration (10s) — must STILL be open.
    advance(30_000);
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('R-5: long gesture — bound hover window survives a 30s dwell', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));

    // Bind to a Hover lifecycle.
    collector.handleLifecycleBound({
      lifecycleId: 'lc-1',
      triggerEventId: 'evt-1',
      interactionType: 'Hover',
    });

    advance(30_000);
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('STOP force-closes a hover window (recording-stopped) and delivers evidence', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    advance(50);
    collector.stop();
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(delivered.length).toBe(1);
    expect(delivered[0].sourceEventId).toBe('evt-1');
    expect(delivered[0].window.endReason).toBe('recording-stopped');
  });

  it('pagehide finalizes a bound hover window with endReason page-reload', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    collector.handleLifecycleBound({
      lifecycleId: 'lc-1',
      triggerEventId: 'evt-1',
      interactionType: 'Hover',
    });
    collector.onPageHide();
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(delivered.length).toBe(1);
    expect(delivered[0].window.endReason).toBe('page-reload');
  });

  // ── §5.1.5 Displacement preference ─────────────────────────────────

  it('at cap, a new hover window displaces the OLDEST HOVER window, not the older click window', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    // W1: click window (oldest, non-hover).
    collector.onAfterEvent(btn, 'evt-c1', 'click', '', null, observed('click', 'evt-c1'));
    advance(10);
    // W2–W5: four hover windows → cap reached (5).
    for (let i = 2; i <= 5; i++) {
      collector.onAfterEvent(btn, `evt-h${i}`, 'mouseenter', '', null, observed('mouseenter', `evt-h${i}`));
      advance(10);
    }
    expect(collector.getActiveWindowCount()).toBe(5);

    // W6: another hover enter — must evict the oldest HOVER (evt-h2), keeping the click window.
    collector.onAfterEvent(btn, 'evt-h6', 'mouseenter', '', null, observed('mouseenter', 'evt-h6'));
    expect(collector.getActiveWindowCount()).toBe(5);

    const evidence = delivered.map((e) => e.sourceEventId);
    expect(evidence).toContain('evt-h2'); // oldest hover displaced
    expect(evidence).not.toContain('evt-c1'); // click window survives
    const displaced = delivered.find((e) => e.sourceEventId === 'evt-h2');
    expect(displaced?.window.endReason).toBe('displaced');
  });

  it('at cap with no hover window open, a new click displaces the oldest window (legacy behavior intact)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    for (let i = 1; i <= 6; i++) {
      collector.onAfterEvent(btn, `evt-c${i}`, 'click', '', null, observed('click', `evt-c${i}`));
      advance(10);
    }
    expect(collector.getActiveWindowCount()).toBe(5);
    expect(delivered.map((e) => e.sourceEventId)).toContain('evt-c1');
  });
});
