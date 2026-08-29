/**
 * B7-P2 §5.2.2 T4 — CS→SW TRIGGER_REMOVED notification contract.
 *
 * Spec line 130: the content script notifies the SW "when the hover
 * target is removed". The P1 half closes the evidence window; the missing
 * half tells the SW so the HOVER LIFECYCLE can complete with terminal
 * 'target-removed' (instead of dangling until STOP → 'recording-end' or
 * 5-min idle → 'abandoned' + an Unclassified twin the spec does not
 * promise for this terminal).
 *
 * This suite pins the collector-side notify: when checkHoverTargetsRemoved
 * (or handleTriggerRemoved) closes a hover window because the target was
 * removed, the collector sends TRIGGER_REMOVED { lifecycleId } to the SW
 * via chrome.runtime.sendMessage.
 *
 * The notify is keyed on lifecycleId (the SW join key) with a
 * triggerEventId fallback for unbound windows (defensive; the SW lookup
 * by triggerEvent.eventId is the fallback join).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('B7-P2 T4: collector TRIGGER_REMOVED notify', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let delivered: BehavioralEvidence[];
  let messages: Array<{ type: string; payload?: unknown }>;
  let mockNow: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    delivered = [];
    messages = [];
    mockNow = 0;

    vi.spyOn(performance, 'now').mockImplementation(() => opened_mockNow());
    vi.useFakeTimers();

    const sendMessage = vi.fn(
      (msg: { type: string; payload?: unknown }, cb?: () => void) => {
        messages.push(msg);
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

  function opened_mockNow(): number { return mockNow; }

  function observed(eventType: string, eventId: string, tag = 'BUTTON') {
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
        ancestorClasses: [], tabIndex: 0,
      },
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }

  it('producer: target removal + mutation batch → TRIGGER_REMOVED message to the SW (lifecycleId present when window is bound)', async () => {
    vi.useRealTimers();
    try {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      collector.onAfterEvent(btn, 'evt-trn-1', 'mouseenter', '', null, observed('mouseenter', 'evt-trn-1'));
      expect(collector.getActiveWindowCount()).toBe(1);
      // Simulate the SW binding (LIFECYCLE_BOUND round-trip already done)
      collector.handleLifecycleBound({
        lifecycleId: 'lc-42', triggerEventId: 'evt-trn-1', interactionType: 'Hover',
      });
      btn.remove();
      document.body.appendChild(document.createElement('div'));
      await new Promise((r) => setTimeout(r, 10));
      expect(collector.getActiveWindowCount()).toBe(0);
      const notify = messages.find((m) => m.type === 'TRIGGER_REMOVED');
      expect(notify).toBeDefined();
      expect((notify!.payload as Record<string, unknown>).lifecycleId).toBe('lc-42');
    } finally {
      vi.useFakeTimers();
    }
  });

  it('handleTriggerRemoved (SW-called) closes the window and NOTIFIES via lifecycleId when bound', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-trn-2', 'mouseenter', '', null, observed('mouseenter', 'evt-trn-2'));
    collector.handleLifecycleBound({
      lifecycleId: 'lc-43', triggerEventId: 'evt-trn-2', interactionType: 'Hover',
    });
    collector.handleTriggerRemoved('evt-trn-2');
    expect(collector.getActiveWindowCount()).toBe(0);
    const notify = messages.find((m) => m.type === 'TRIGGER_REMOVED');
    expect(notify).toBeDefined();
    expect((notify!.payload as Record<string, unknown>).lifecycleId).toBe('lc-43');
  });

  it('unbound window: notify carries triggerEventId fallback (no lifecycleId)', () => {
    const btn = document.createElement('chrome-fixture');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-trn-3', 'mouseenter', '', null, observed('mouseenter', 'evt-trn-3'));
    collector.handleTriggerRemoved('evt-trn-3');
    expect(collector.getActiveWindowCount()).toBe(0);
    const notify = messages.find((m) => m.type === 'TRIGGER_REMOVED');
    expect(notify).toBeDefined();
    expect((notify!.payload as Record<string, unknown>).lifecycleId).toBeNull();
    expect((notify!.payload as Record<string, unknown>).triggerEventId).toBe('evt-trn-3');
  });
});
