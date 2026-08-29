/**
 * B7-P1 UNIT — Hover lifecycle binding, finalize-settle, R-5 settle-cap, revert fact (red-first)
 *
 * Spec §5.1.2/§5.1.6: LIFECYCLE_BOUND retro-binding; FINALIZE_EVIDENCE →
 * settle mode (revert fact captured after leave); R-5 settle-entry cap
 * measured from SETTLE ENTRY for hover windows (a >10s gesture must not
 * insta-close at leave-settle — settleEntry() re-arms from OPEN today).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('B7-P1: hover binding, finalize settle, R-5 settle-cap, revert', () => {
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
      valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }

  function bindHover(eventId: string, lifecycleId = 'lc-1'): void {
    collector.handleLifecycleBound({
      lifecycleId,
      triggerEventId: eventId,
      interactionType: 'Hover',
    });
  }

  it('LIFECYCLE_BOUND marks the hover window bound to the lifecycle', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    bindHover('evt-1');
    // Bound window must not self-close on quiescence.
    advance(60_000);
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('FINALIZE_EVIDENCE (completed) enters settle mode and delivers consequence-settled evidence', async () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    bindHover('evt-1');

    // Reveal happens during the gesture.
    const menu = document.createElement('div');
    menu.setAttribute('id', 'submenu');
    document.body.appendChild(menu);
    await vi.waitFor(() => {
      expect((observer as any).getBatchCounter()).toBeGreaterThan(0);
    });

    // Leave → lifecycle completed → FINALIZE_EVIDENCE.
    // The revert (submenu removed) must be captured by the settle scan.
    advance(1_200);
    collector.finalizeForInteraction({
      lifecycleId: 'lc-1',
      interactionId: 'int-1',
      interactionType: 'Hover',
      eventIds: ['evt-1'],
      metadata: {},
      endState: 'completed',
    });

    // Revert after leave, inside the settle window.
    menu.remove();
    await vi.waitFor(() => {
      expect(collector.getActiveWindowCount()).toBe(0);
    });

    expect(delivered.length).toBe(1);
    const ev = delivered[0];
    expect(ev.sourceEventId).toBe('evt-1');
    expect(ev.window.endReason).toBe('consequence-settled');
    // Reveal + revert both recorded at the honest tier: childList domChange
    // summaries carry addedNodesCount > 0 (reveal) and removedNodesCount > 0
    // (revert) for #submenu. (newSurfaces/removedSurfaces require
    // significant-surface ARIA roles a bare div lacks — that tier is NOT
    // asserted here; domChanges is the raw MutationObserver fact.)
    const app = ev.applicationEvidence;
    const added = (app.domChanges ?? []).some(
      (c: any) => c.addedNodesCount > 0 && (c.targetPath ?? '').includes('body'),
    );
    const removed = (app.domChanges ?? []).some(
      (c: any) => c.removedNodesCount > 0 && (c.targetPath ?? '').includes('body'),
    );
    expect(added).toBe(true);
    expect(removed).toBe(true);
  });

  it('R-5: a 12s dwell does NOT insta-close at leave-settle (cap re-arms from settle entry)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    bindHover('evt-1');

    advance(12_000); // > maxDuration — hover window still open (holdOpen)
    expect(collector.getActiveWindowCount()).toBe(1);

    collector.finalizeForInteraction({
      lifecycleId: 'lc-1',
      interactionId: 'int-1',
      interactionType: 'Hover',
      eventIds: ['evt-1'],
      metadata: {},
      endState: 'completed',
    });

    // Must NOT close instantly at settle entry (today: remaining ≤ 0 →
    // immediate max-duration close). The window settles normally.
    expect(collector.getActiveWindowCount()).toBe(1);
    advance(400);
    expect(delivered.length).toBe(1);
    expect(delivered[0].window.endReason).toBe('consequence-settled');
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  it('abandoned finalize delivers lifecycle-abandoned evidence for the hover window', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    bindHover('evt-1');
    advance(1_000);
    collector.finalizeForInteraction({
      lifecycleId: 'lc-1',
      interactionId: 'int-1',
      interactionType: 'Hover',
      eventIds: ['evt-1'],
      metadata: {},
      endState: 'abandoned',
    });
    advance(400);
    expect(delivered.length).toBe(1);
    expect(delivered[0].window.endReason).toBe('lifecycle-abandoned');
  });

  it('settle-remap is HOVER-SCOPED: a non-hover abandoned finalize still delivers consequence-settled (byte-identity)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-9', 'click', '', null, observed('click', 'evt-9'));
    collector.finalizeForInteraction({
      lifecycleId: 'lc-9',
      interactionId: 'int-9',
      interactionType: 'Dropdown',
      eventIds: ['evt-9'],
      metadata: {},
      endState: 'abandoned',
    });
    advance(400);
    expect(delivered.length).toBe(1);
    // Pre-P1 behavior preserved: stabilized → consequence-settled regardless
    // of lifecycle endState for NON-hover types (reviewer WARN scoping fix).
    expect(delivered[0].window.endReason).toBe('consequence-settled');
  });

  it('unbound hover window is dropped at pagehide (zero-signal non-action window)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    collector.onAfterEvent(btn, 'evt-1', 'mouseenter', '', null, observed('mouseenter', 'evt-1'));
    collector.onPageHide();
    expect(collector.getActiveWindowCount()).toBe(0);
    expect(delivered.length).toBe(0);
  });
});
