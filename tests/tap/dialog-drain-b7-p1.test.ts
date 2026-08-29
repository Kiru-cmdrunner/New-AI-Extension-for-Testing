/**
 * B7-P1 UNIT — R-3: dialog/window.open drain candidate-owner membership (red-first)
 *
 * Spec §5.1.7: hover windows join the last-resort drain's candidate-owner
 * predicate. A click-dialog arriving while a hover window is open still
 * defers to the CLICK window's close-time read (the click remains the
 * designed claimant); with no click window open, an open hover window
 * defers the drain (the stamp is not stolen by the last-resort path).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('B7-P1: R-3 dialog-drain membership with hover windows', () => {
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
    document.documentElement.removeAttribute('data-cmdrunner-dialog');
  });

  afterEach(() => {
    collector.stop();
    document.documentElement.removeAttribute('data-cmdrunner-dialog');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

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
      scrollDeltaY: null, scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }

  it('dialog stamp is NOT claimed by the last-resort drain while a hover window is open', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-h1', 'mouseenter', '', null, observed('mouseenter', 'evt-h1'));
    expect(collector.getActiveWindowCount()).toBe(1);

    // A dialog stamp appears (hover-triggered, no click window open).
    document.documentElement.setAttribute('data-cmdrunner-dialog', JSON.stringify({ type: 'alert', message: 'hover dialog' }));

    // The hover lifecycle completes → FINALIZE → settle → close.
    collector.handleLifecycleBound({ lifecycleId: 'lc-1', triggerEventId: 'evt-h1', interactionType: 'Hover' });
    advance(500);
    collector.finalizeForInteraction({
      lifecycleId: 'lc-1', interactionId: 'int-1', interactionType: 'Hover',
      eventIds: ['evt-h1'], metadata: {}, endState: 'completed',
    });
    advance(500);

    // The delivered hover evidence OWNS the dialog (claimed at its close).
    expect(delivered.length).toBe(1);
    expect(delivered[0].applicationEvidence.triggeredDialog).toBeDefined();
  });

  it('click dialog during open hover: the CLICK window remains the claimant', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    // Hover window open.
    collector.onAfterEvent(btn, 'evt-h1', 'mouseenter', '', null, observed('mouseenter', 'evt-h1'));
    // Click window opens (newer).
    advance(400); // past COMPANION_WINDOW_MS so the hover window is not a companion
    collector.onAfterEvent(btn, 'evt-c1', 'click', '', null, observed('click', 'evt-c1'));
    // Dialog stamp appears AFTER the click window opened (click-triggered).
    document.documentElement.setAttribute('data-cmdrunner-dialog', JSON.stringify({ type: 'alert', message: 'click dialog' }));

    // Click lifecycle completes → settle → close (delivery).
    collector.handleLifecycleBound({ lifecycleId: 'lc-2', triggerEventId: 'evt-c1', interactionType: 'Click' });
    advance(500);
    collector.finalizeForInteraction({
      lifecycleId: 'lc-2', interactionId: 'int-2', interactionType: 'Click',
      eventIds: ['evt-c1'], metadata: {}, endState: 'completed',
    });
    advance(500);

    const clickEv = delivered.find((e) => e.sourceEventId === 'evt-c1');
    const hoverEv = delivered.find((e) => e.sourceEventId === 'evt-h1');
    expect(clickEv?.applicationEvidence.triggeredDialog).toBeDefined();
    // The hover evidence (delivered when its own window closes) must NOT
    // steal the click's dialog: it was drained at click-open? No — the
    // stamp appeared AFTER the click window opened, so only the close-time
    // reads can claim it. First reader wins: the click's settle-close read
    // runs while the hover window is still open → the last-resort drain
    // must have DEFERRED (hover window exists as candidate owner).
    expect(hoverEv?.applicationEvidence.triggeredDialog).toBeUndefined();
  });
});
