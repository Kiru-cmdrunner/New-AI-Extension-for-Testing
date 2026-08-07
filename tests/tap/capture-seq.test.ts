/**
 * Tests: captureSeq — Browser-Assigned Monotonic Event Ordering
 *
 * Milestone 1 of the End-to-End Capture Guarantee.
 *
 * captureSeq is assigned from rawEvent.timeStamp at capture time.
 * It provides deterministic within-document event ordering that
 * survives async service-worker message processing reordering.
 *
 * Navigation synthetic events (which have no rawEvent) use
 * performance.now() as a substitute.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import { makeObservedEvent } from '../helpers/make-event';

describe('captureSeq — Milestone 1', () => {
  let tapHandle: ReturnType<typeof createEventTap> | null = null;
  let capturedEvents: any[] = [];

  beforeEach(() => {
    capturedEvents = [];
    document.body.innerHTML = '';
    TEST_HOOK.forceTrusted = true;
  });

  afterEach(() => {
    TEST_HOOK.forceTrusted = false;
    tapHandle?.stop();
    tapHandle = null;
  });

  // ── captureSeq assigned from rawEvent.timeStamp ─────────────────────

  it('assigns captureSeq from rawEvent.timeStamp', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const btn = document.getElementById('btn')!;

    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    const mockTime = 12345.678;
    const event = new MouseEvent('click', { bubbles: true });
    // jsdom allows timeStamp override via Object.defineProperty
    Object.defineProperty(event, 'timeStamp', { value: mockTime });

    btn.dispatchEvent(event);

    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].captureSeq).toBe(mockTime);
  });

  // ── Monotonic ordering within a document ────────────────────────────

  it('two sequential events have monotonically increasing captureSeq', () => {
    document.body.innerHTML = '<div id="a">A</div><div id="b">B</div>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;

    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    const e1 = new MouseEvent('mousedown', { bubbles: true });
    Object.defineProperty(e1, 'timeStamp', { value: 1000 });
    a.dispatchEvent(e1);

    const e2 = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(e2, 'timeStamp', { value: 1001 });
    a.dispatchEvent(e2);

    expect(capturedEvents.length).toBe(2);
    expect(capturedEvents[0].captureSeq).toBeLessThanOrEqual(capturedEvents[1].captureSeq);
    expect(capturedEvents[0].captureSeq).toBe(1000);
    expect(capturedEvents[1].captureSeq).toBe(1001);
  });

  // ── captureSeq is a number ──────────────────────────────────────────

  it('captureSeq is a number, not undefined or null', () => {
    document.body.innerHTML = '<button id="btn">Test</button>';
    const btn = document.getElementById('btn')!;

    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(capturedEvents.length).toBe(1);
    expect(typeof capturedEvents[0].captureSeq).toBe('number');
    expect(capturedEvents[0].captureSeq).not.toBeNaN();
  });

  // ── Navigation synthetic events have captureSeq ─────────────────────

  it('navigation synthetic events have a captureSeq from performance.now()', () => {
    const beforeNow = performance.now();

    document.body.innerHTML = '<div id="main">Content</div>';

    tapHandle = createEventTap({
      onEvent: (e) => {
        if (e.eventType === 'navigation') capturedEvents.push(e);
      },
    });

    // Trigger SPA navigation via history.pushState
    history.pushState({}, '', '/test-page');

    const afterNow = performance.now();

    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].eventType).toBe('navigation');
    expect(typeof capturedEvents[0].captureSeq).toBe('number');
    // performance.now() was called during navigation emission
    expect(capturedEvents[0].captureSeq).toBeGreaterThanOrEqual(beforeNow);
    expect(capturedEvents[0].captureSeq).toBeLessThanOrEqual(afterNow);
  });

  // ── Test helper includes captureSeq ──────────────────────────────────

  it('makeObservedEvent test helper defaults captureSeq to 0', () => {
    const event = makeObservedEvent({
      eventId: 'evt-test-1',
      eventType: 'click',
    });

    expect(event.captureSeq).toBe(0);
    expect(typeof event.captureSeq).toBe('number');
  });
});
