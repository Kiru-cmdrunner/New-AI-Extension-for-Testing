/**
 * B7-P1 UNIT — TRIGGER_REMOVED notification → hover window close (red-first)
 *
 * Spec §5.1.4: when the hover target is removed from the DOM mid-gesture,
 * the content script closes the hover evidence window observably
 * (element-removed endReason). Full lifecycle-terminal wiring lands in P2.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('B7-P1: TRIGGER_REMOVED → element-removed window close', () => {
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

    const sendMessage = vi.fn(
      (msg: { type: string; payload?: unknown }, cb?: () => void) => {
        if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
          delivered.push(msg.payload as BehavioralEvidence);
        }
        if (cb) cb();
      },
    );
    global.chrome = {
      runtime: { sendMessage, lastError: undefined },
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

  function observed(eventType: string, eventId: string, tag = 'BUTTON') {
    return {
      eventId,
      eventType,
      timestamp: mockNow,
      captureSeq: 0,
      mouseTest: null,
      isTrusted: true,
      target: {
        accessibleName: 'x', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
        placeholder: null, tag, className: null, name: null, stableId: null,
        testId: null, dataCy: null, dataQa: null, esCape: null, cssSelector: '', xPath: '', elementId: '',
        rect: null, textContent: null, shadowContext: null,
      },
      domContext: {
        inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
        disabled: false, readOnly: false, required: false, ancestorRoles: [],
        ancestorClasses: [], tabIndex: 0,
      },
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollAction: null,
      scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }

  it('TRIGGER_REMOVED closes the hover window with endReason element-removed', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    expect(collector.getActiveWindowCount()).toBe(1);

    collector.handleTriggerRemoved('evt-1');
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(delivered.length).toBe(1);
    expect(delivered[0].window.endReason).toBe('element-removed');
  });

  it('TRIGGER_REMOVED on an unknown eventId is a harmless no-op', () => {
    collector.handleTriggerRemoved('evt-nope');
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(delivered.length).toBe(0);
  });

  it('PRODUCER: a mutation batch after the hover target is removed closes the window (structural isConnected check)', async () => {
    // Real timers for this test: MutationObserver delivers its batch as a
    // microtask AFTER the current task, which fake timers block.
    vi.useRealTimers();
    try {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      collector.onAfterEvent(btn, 'evt-70', 'mouseenter', '', null, observed('mouseenter', 'evt-70'));
      expect(collector.getActiveWindowCount()).toBe(1);
      // Target removed from the DOM, then ANY mutation batch fires (the
      // removal itself is a mutation) — the producer must close the window.
      btn.remove();
      document.body.appendChild(document.createElement('div')); // triggers a batch
      await new Promise((r) => setTimeout(r, 10)); // let MutationObserver deliver
      expect(collector.getActiveWindowCount()).toBe(0);
    } finally {
      vi.useFakeTimers();
    }
  });
});
