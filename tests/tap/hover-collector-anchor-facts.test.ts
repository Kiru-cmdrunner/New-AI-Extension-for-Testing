/**
 * HEC v1 §7 — collector→envelope anchor-facts seam pin.
 *
 * The hover window opened from a recorded mouseenter must copy the
 * domContext anchor facts (hoverAnchorKey / hoverClickAnchorKey /
 * hoverAnchorResolution) into window state, and the delivered
 * BehavioralEvidence envelope must carry them inside
 * hoverQualification.anchorFacts. This is the seam that was silently dead
 * before the R-A1 writer existed.
 *
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §7 R-A1/R-A2.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('HEC R-A2 — collector envelope carries recorded anchor facts', () => {
  let dom: JSDOM;
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];
  let mockNow: number;

  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><html><body>
      <div id="wrap" tabindex="0"><span id="inner">text</span></div>
    </body></html>`, { pretendToBeVisual: true });
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
    (globalThis as Record<string, unknown>).Element = dom.window.Element;

    deliveredEvidence = [];
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();

    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            deliveredEvidence.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        lastError: undefined,
      },
    };

    collector = new EvidenceCollector({
      targetStateCache: new TargetStateCache(),
      domObserver: new DOMObserver(),
    });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>).chrome = undefined;
    (globalThis as Record<string, unknown>).window = undefined;
    (globalThis as Record<string, unknown>).document = undefined;
  });

  it('mouseenter envelope carries recorded anchor facts in hoverQualification', () => {
    const inner = dom.window.document.getElementById('inner')!;
    const wrap = dom.window.document.getElementById('wrap')!;

    // The enter's target element is the RAW pointer element (inner, span)
    // while the recorded anchor facts key the LIFTED anchor (wrap).
    const identity = {
      tag: 'SPAN', stableId: 'inner', accessibleName: '', cssSelector: '#inner',
      domPath: 'html>body>div#wrap>span#inner', classes: '', ariaRole: null, testId: null,
    };
    // Gate: hover discovery enter requires a shaped target — pass the
    // identity of the SHAPED anchor (wrap: tabIndex=0 button shape).
    const anchorIdentity = {
      tag: 'DIV', stableId: 'wrap', accessibleName: '', cssSelector: '#wrap',
      domPath: 'html>body>div#wrap', classes: '', ariaRole: null, testId: null,
    };
    const observedEvent = {
      eventId: 'evt-test-1',
      eventType: 'mouseenter',
      isTrusted: true,
      captureSeq: 1,
      timestamp: Date.now(),
      target: anchorIdentity,
      domContext: {
        tabIndex: 0,
        hoverAnchorKey: 'id:wrap',
        hoverClickAnchorKey: 'id:wrap',
        hoverAnchorResolution: 'ancestor-lift',
      },
    } as never;

    collector.onAfterEvent(wrap, 'evt-test-1', 'mouseenter', '', anchorIdentity as never, observedEvent);
    expect(collector.getActiveWindowCount()).toBe(1);

    // Drain at STOP: closes the provisional hover window and delivers.
    collector.drainHoverWindowsAtStop();

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-test-1');
    expect(ev).toBeTruthy();
    const hq = ev!.hoverQualification;
    expect(hq).toBeTruthy();
    expect(hq!.anchorFacts.anchorKey).toBe('id:wrap');
    expect(hq!.anchorFacts.clickAnchorKey).toBe('id:wrap');
    expect(hq!.anchorFacts.resolution).toBe('ancestor-lift');
    // The verdict is computed from recorded facts — no DOM churn happened,
    // so the envelope honestly says gesture-only.
    expect(hq!.verdict).toBe('gesture-only');
  });
});
