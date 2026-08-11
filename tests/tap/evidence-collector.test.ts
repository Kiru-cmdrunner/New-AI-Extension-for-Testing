/**
 * M4 Unit Tests: EvidenceCollector — End-to-End Evidence Orchestration
 *
 * Tests the full evidence lifecycle: window open → mutations → close →
 * BehavioralEvidence assembled and delivered. Covers:
 *   - Event-trigger matrix (which events open windows)
 *   - Extend-on-input typing (one window per typing session)
 *   - Scroll throttle (max 1 per 500ms)
 *   - Max 5 concurrent windows with displacement
 *   - Capture-only events (mouseenter/mouseleave/mousemove) ignored
 *   - Navigation evidence
 *   - Evidence delivery (BEHAVIORAL_EVIDENCE message)
 *   - TargetEvidence before/after snapshots
 *   - ApplicationEvidence domChanges + surfaces + visibility
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §4.1-4.7
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

describe('EvidenceCollector', () => {
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

    // Mock chrome.runtime.sendMessage to capture delivered evidence
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

  /** Advance both fake timers and mocked performance.now() */
  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  // ── Basic lifecycle ────────────────────────────────────────────────

  it('start() sets isRunning', () => {
    expect(collector.getIsRunning()).toBe(true);
  });

  it('stop() sets isRunning to false and closes all windows', () => {
    collector.stop();
    expect(collector.getIsRunning()).toBe(false);
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  // ── Event-Trigger Matrix ───────────────────────────────────────────

  it('click opens an evidence window', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-1', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(350); // close via stabilization
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  it('mousedown opens an evidence window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-2', 'mousedown', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(350);
  });

  it('change opens an evidence window', () => {
    const el = document.createElement('select');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-3', 'change', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(350);
  });

  it('focus opens an evidence window', () => {
    const el = document.createElement('input');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-4', 'focus', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(350);
  });

  it('submit opens an evidence window', () => {
    const el = document.createElement('form');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-5', 'submit', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(350);
  });

  it('mouseenter does NOT open an evidence window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-6', 'mouseenter', '');
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  it('mouseleave does NOT open an evidence window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-7', 'mouseleave', '');
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  it('mousemove does NOT open an evidence window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-8', 'mousemove', '');
    expect(collector.getActiveWindowCount()).toBe(0);
  });

  // ── Typing Strategy (Extend-on-Input) ──────────────────────────────

  it('first input event opens a typing window', () => {
    const el = document.createElement('input');
    el.type = 'text';
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-typing-1', 'input', '');
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('subsequent input on same element extends window (does not open new)', () => {
    const el = document.createElement('input');
    el.type = 'text';
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-typing-2', 'input', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    // Simulate another keystroke
    collector.onAfterEvent(el, 'evt-typing-3', 'input', '');
    expect(collector.getActiveWindowCount()).toBe(1); // still 1 window
  });

  it('input on different element opens new window', () => {
    const el1 = document.createElement('input');
    el1.type = 'text';
    const el2 = document.createElement('input');
    el2.type = 'text';
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    collector.onAfterEvent(el1, 'evt-typing-4', 'input', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    collector.onAfterEvent(el2, 'evt-typing-5', 'input', '');
    expect(collector.getActiveWindowCount()).toBe(2);
  });

  // ── Scroll Throttle ────────────────────────────────────────────────

  it('scroll opens a window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-scroll-1', 'scroll', '');
    expect(collector.getActiveWindowCount()).toBe(1);
  });

  it('rapid scroll is throttled to 1 per 500ms', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-scroll-1', 'scroll', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    advance(100); // within throttle window

    collector.onAfterEvent(el, 'evt-scroll-2', 'scroll', '');
    expect(collector.getActiveWindowCount()).toBe(1); // throttled

    advance(500); // past throttle window

    collector.onAfterEvent(el, 'evt-scroll-3', 'scroll', '');
    // The first window may have closed, but a new one should be open
    expect(collector.getActiveWindowCount()).toBeGreaterThanOrEqual(1);
  });

  // ── Max Concurrent Windows ─────────────────────────────────────────

  it('max 5 concurrent windows with displacement', () => {
    const els: Element[] = [];
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('button');
      document.body.appendChild(el);
      els.push(el);
    }

    // Open 5 windows
    for (let i = 0; i < 5; i++) {
      collector.onAfterEvent(els[i], `evt-conc-${i}`, 'click', '');
    }
    expect(collector.getActiveWindowCount()).toBe(5);

    // 6th should displace the oldest
    collector.onAfterEvent(els[5], 'evt-conc-5', 'click', '');
    expect(collector.getActiveWindowCount()).toBeLessThanOrEqual(5);
  });

  // ── Evidence Delivery ──────────────────────────────────────────────

  it('delivers BehavioralEvidence on window close', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-deliver-1', 'click', '');

    // Advance past stabilization
    advance(350);

    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    const evidence = deliveredEvidence[0];
    expect(evidence.sourceEventId).toBe('evt-deliver-1');
    expect(evidence.sourceEventType).toBe('click');
  });

  it('delivered evidence has targetEvidence with before/after snapshots', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = false;
    document.body.appendChild(el);

    // Pre-populate cache (simulating capture-phase listener)
    cache.capture(el);

    collector.onAfterEvent(el, 'evt-target-1', 'click', '');

    // Simulate the click toggling the checkbox
    el.checked = true;

    advance(350);

    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    const evidence = deliveredEvidence[0];
    expect(evidence.targetEvidence).toBeDefined();
    expect(evidence.targetEvidence.before).toBeDefined();
    expect(evidence.targetEvidence.after).toBeDefined();
    // Before should show unchecked
    expect(evidence.targetEvidence.before?.checked).toBe(false);
    // After should show checked
    expect(evidence.targetEvidence.after?.checked).toBe(true);
  });

  it('delivered evidence has applicationEvidence with domChanges array', () => {
    const el = document.createElement('button');
    el.id = 'test-btn';
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-app-1', 'click', '');

    // Trigger a DOM mutation
    el.className = 'clicked';

    advance(350);

    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    const evidence = deliveredEvidence[0];
    expect(evidence.applicationEvidence).toBeDefined();
    expect(Array.isArray(evidence.applicationEvidence.domChanges)).toBe(true);
    expect(evidence.applicationEvidence.domChangeOverflow).toBeGreaterThanOrEqual(0);
    expect(evidence.applicationEvidence.coarseMode).toBe(false);
  });

  it('delivered evidence has window with endReason and durationMs', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-window-1', 'click', '');

    advance(350);

    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    const evidence = deliveredEvidence[0];
    expect(evidence.window).toBeDefined();
    expect(evidence.window.endReason).toBe('stabilized');
    expect(evidence.window.durationMs).toBeGreaterThan(0);
    expect(evidence.window.stabilityTrace.length).toBeGreaterThanOrEqual(1);
  });

  // ── Navigation Evidence ────────────────────────────────────────────

  it('navigation events are recorded', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-nav-1', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    // Trigger a navigation event
    collector.onAfterEvent(document.body, 'evt-nav-2', 'navigation', '');

    advance(350);

    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    const evidence = deliveredEvidence[0];
    expect(evidence.applicationEvidence.navigation.length).toBeGreaterThanOrEqual(1);
  });

  // ── Causal Interpretation Excluded (P1: Capture Don't Interpret) ───

  it('evidence does not contain causal labels', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-no-interpret-1', 'click', '');
    el.className = 'active';

    advance(350);

    const evidence = deliveredEvidence[0];
    const json = JSON.stringify(evidence);
    // No causal labels should appear
    expect(json).not.toContain('synchronousEffects');
    expect(json).not.toContain('asyncEffects');
    expect(json).not.toContain('networkCorrelated');
    expect(json).not.toContain('causedBy');
    expect(json).not.toContain('effectType');
  });

  // ── Recording Stopped ──────────────────────────────────────────────

  it('stop() force-closes open windows with recording-stopped reason', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-stop-1', 'click', '');
    expect(collector.getActiveWindowCount()).toBe(1);

    collector.stop();

    expect(deliveredEvidence.length).toBeGreaterThanOrEqual(1);
    const evidence = deliveredEvidence[0];
    expect(evidence.window.endReason).toBe('recording-stopped');
  });

  // ── Performance Condition ──────────────────────────────────────────

  it('delivered evidence has performanceCondition', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    collector.onAfterEvent(el, 'evt-perf-1', 'click', '');
    advance(350);

    const evidence = deliveredEvidence[0];
    expect(evidence.applicationEvidence.performanceCondition).toBeDefined();
    expect(evidence.applicationEvidence.performanceCondition).not.toBeNull();
    expect(typeof evidence.applicationEvidence.performanceCondition!.mainThreadBlocked).toBe('boolean');
    expect(typeof evidence.applicationEvidence.performanceCondition!.highChurnMode).toBe('boolean');
    expect(typeof evidence.applicationEvidence.performanceCondition!.totalBatches).toBe('number');
  });

  // ── Multiple sequential interactions ───────────────────────────────

  it('multiple sequential interactions each produce evidence', () => {
    const el1 = document.createElement('button');
    el1.id = 'btn-1';
    const el2 = document.createElement('button');
    el2.id = 'btn-2';
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    // First interaction
    collector.onAfterEvent(el1, 'evt-seq-1', 'click', '');
    advance(350);

    // Second interaction
    collector.onAfterEvent(el2, 'evt-seq-2', 'click', '');
    advance(350);

    expect(deliveredEvidence.length).toBe(2);
    expect(deliveredEvidence[0].sourceEventId).toBe('evt-seq-1');
    expect(deliveredEvidence[1].sourceEventId).toBe('evt-seq-2');
  });
});
