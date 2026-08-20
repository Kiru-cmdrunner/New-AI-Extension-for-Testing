/**
 * G1 — JS dialog capture (alert/confirm/prompt/window.open) wiring.
 *
 * Pins the port of the legacy page-world interception (pre-b4222a6,
 * src/recorder/deterministic-recorder.ts) to the Component Runtime:
 *  - readPageWorldSignals: parse + CLEAR the dialog-inject.js stamps
 *    (destructive read — a signal is never read twice)
 *  - malformed JSON degrades silently (never throws)
 *  - EvidenceCollector: open-time drain owns synchronous in-handler dialogs
 *  - EvidenceCollector: close-time re-read owns later dialogs (setTimeout
 *    after the click, before window close)
 *  - triggeredDialog/openedWindow attach to ApplicationEvidence ONLY when
 *    present (dialog-free wire shape unchanged — key absent, not null)
 *  - a second dialog within the same window replaces the first
 *    (last-write-wins; dialogs are modal)
 *
 * Environment: vitest jsdom (ambient document), fake timers, mocked
 * chrome.runtime.sendMessage — same harness as evidence-collector.test.ts.
 *
 * Spec: .drytis/specs/p1-p2-generic-gaps.md (G1)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readPageWorldSignals } from '../../src/tap/page-world-signals';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function stampDialog(payload: unknown): void {
  document.documentElement.setAttribute('data-cmdrunner-dialog', JSON.stringify(payload));
}
function stampWindowOpen(payload: unknown): void {
  document.documentElement.setAttribute('data-cmdrunner-window-open', JSON.stringify(payload));
}

describe('G1 — readPageWorldSignals (page-world-signals.ts)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-cmdrunner-dialog');
    document.documentElement.removeAttribute('data-cmdrunner-window-open');
  });

  it('no attributes → empty signals (dialog-free interaction)', () => {
    const sig = readPageWorldSignals();
    expect(sig.dialog).toBeNull();
    expect(sig.windowOpen).toBeNull();
  });

  it('alert stamp parses and is CLEARED on read (destructive, never double-attributed)', () => {
    stampDialog({ type: 'alert', message: 'Order confirmed' });
    const first = readPageWorldSignals();
    expect(first.dialog).toEqual({ type: 'alert', message: 'Order confirmed', result: null });
    expect(readPageWorldSignals().dialog).toBeNull(); // second read sees nothing
    expect(document.documentElement.hasAttribute('data-cmdrunner-dialog')).toBe(false);
  });

  it('confirm stamp carries the dismissal result', () => {
    stampDialog({ type: 'confirm', message: 'Discard order?', result: 'OK' });
    expect(readPageWorldSignals().dialog).toEqual({
      type: 'confirm', message: 'Discard order?', result: 'OK',
    });
  });

  it('prompt stamp carries entered text or Cancelled', () => {
    stampDialog({ type: 'prompt', message: 'Name?', result: 'Alice' });
    expect(readPageWorldSignals().dialog?.result).toBe('Alice');
    stampDialog({ type: 'prompt', message: 'Name?', result: 'Cancelled' });
    expect(readPageWorldSignals().dialog?.result).toBe('Cancelled');
  });

  it('window.open stamp distinguishes popup window vs tab', () => {
    stampWindowOpen({ url: 'https://example.com/help', target: 'help', isWindow: true });
    const sig = readPageWorldSignals();
    expect(sig.windowOpen).toEqual({ url: 'https://example.com/help', target: 'help', isWindow: true });
    expect(document.documentElement.hasAttribute('data-cmdrunner-window-open')).toBe(false);
  });

  it('malformed JSON degrades silently — never throws, signal absent, attribute cleared', () => {
    document.documentElement.setAttribute('data-cmdrunner-dialog', '{not json');
    const sig = readPageWorldSignals();
    expect(sig.dialog).toBeNull();
    expect(document.documentElement.hasAttribute('data-cmdrunner-dialog')).toBe(false);
  });

  it('non-string type payload is rejected defensively', () => {
    stampDialog({ type: 42, message: 'x' });
    expect(readPageWorldSignals().dialog).toBeNull();
  });
});

describe('G1 — EvidenceCollector dialog ownership (jsdom lifecycle)', () => {
  let collector: EvidenceCollector;
  let deliveredEvidence: BehavioralEvidence[];
  let mockNow: number;

  beforeEach(() => {
    document.body.innerHTML = '<button id="b">go</button>';
    deliveredEvidence = [];
    mockNow = 0;
    document.documentElement.removeAttribute('data-cmdrunner-dialog');
    document.documentElement.removeAttribute('data-cmdrunner-window-open');

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
  });

  it('open-time drain: dialog stamped by the click handler lands on THAT window’s evidence', () => {
    const el = document.getElementById('b')!;
    // The page-world wrapper writes the stamp BEFORE the native alert()
    // blocks; onAfterEvent runs after the handler returns.
    stampDialog({ type: 'alert', message: 'Order confirmed' });

    collector.onAfterEvent(el, 'evt-1', 'click', '#b');
    // Stamp drained at window open — no orphan survives for a later window.
    expect(document.documentElement.hasAttribute('data-cmdrunner-dialog')).toBe(false);

    // Advance past window duration so it closes and delivers.
    mockNow = 10_000;
    vi.advanceTimersByTime(10_000);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-1');
    expect(ev).toBeTruthy();
    expect(ev!.applicationEvidence.triggeredDialog).toEqual({
      type: 'alert', message: 'Order confirmed', result: null,
    });
  });

  it('close-time re-read: dialog fired LATER (setTimeout after click) lands on the same window', () => {
    const el = document.getElementById('b')!;
    collector.onAfterEvent(el, 'evt-2', 'click', '#b');

    // A setTimeout inside the page fires the dialog while the evidence
    // window is still open — the close-time drain picks it up.
    setTimeout(() => stampDialog({ type: 'confirm', message: 'Sure?', result: 'Cancel' }), 50);
    vi.advanceTimersByTime(50);
    mockNow = 5_000;
    vi.advanceTimersByTime(5_000);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-2');
    expect(ev).toBeTruthy();
    expect(ev!.applicationEvidence.triggeredDialog).toEqual({
      type: 'confirm', message: 'Sure?', result: 'Cancel',
    });
  });

  it('dialog-free interaction: triggeredDialog key ABSENT (wire shape unchanged)', () => {
    const el = document.getElementById('b')!;
    collector.onAfterEvent(el, 'evt-3', 'click', '#b');
    mockNow = 10_000;
    vi.advanceTimersByTime(10_000);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-3');
    expect(ev).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(ev!.applicationEvidence, 'triggeredDialog')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ev!.applicationEvidence, 'openedWindow')).toBe(false);
  });

  it('second dialog in the same window replaces the first (last-write-wins)', () => {
    const el = document.getElementById('b')!;
    // Handler chain: confirm() then alert() — the alert stamp overwrites
    // the confirm stamp on the same attribute (dialog-inject.js behavior).
    stampDialog({ type: 'confirm', message: 'first', result: 'OK' });
    stampDialog({ type: 'alert', message: 'second' });

    collector.onAfterEvent(el, 'evt-4', 'click', '#b');
    mockNow = 10_000;
    vi.advanceTimersByTime(10_000);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-4');
    expect(ev).toBeTruthy();
    expect(ev!.applicationEvidence.triggeredDialog).toEqual({
      type: 'alert', message: 'second', result: null,
    });
  });

  it('window.open signal attaches as openedWindow (isWindow flag preserved)', () => {
    const el = document.getElementById('b')!;
    stampWindowOpen({ url: 'https://help.example.com', target: 'help', isWindow: true });
    collector.onAfterEvent(el, 'evt-5', 'click', '#b');
    mockNow = 10_000;
    vi.advanceTimersByTime(10_000);

    const ev = deliveredEvidence.find((e) => e.sourceEventId === 'evt-5');
    expect(ev).toBeTruthy();
    expect(ev!.applicationEvidence.openedWindow).toEqual({
      url: 'https://help.example.com', target: 'help', isWindow: true,
    });
  });

  it('a dialog is never attributed to a LATER window (destructive read)', () => {
    const el = document.getElementById('b')!;
    stampDialog({ type: 'alert', message: 'belongs to first' });
    collector.onAfterEvent(el, 'evt-6a', 'click', '#b'); // drains the stamp

    collector.onAfterEvent(el, 'evt-6b', 'click', '#b'); // later window: nothing left
    mockNow = 20_000;
    vi.advanceTimersByTime(20_000);

    const evA = deliveredEvidence.find((e) => e.sourceEventId === 'evt-6a');
    const evB = deliveredEvidence.find((e) => e.sourceEventId === 'evt-6b');
    expect(evA?.applicationEvidence.triggeredDialog?.message).toBe('belongs to first');
    expect(Object.prototype.hasOwnProperty.call(evB?.applicationEvidence ?? {}, 'triggeredDialog')).toBe(false);
  });
});
