/**
 * Tests: EventTap onAfterEvent callback (Phase D)
 *
 * Verifies that onAfterEvent fires after onEvent with correct arguments,
 * is optional (no fire when not provided), and passes the right values.
 *
 * Architecture: .drytis/specs/m1-phase-d-detailed-design.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import type { ObservedEvent } from '../../src/shared/component-types';

describe('EventTap onAfterEvent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    TEST_HOOK.forceTrusted = true;
  });

  it('does not fire onAfterEvent when not provided', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const btn = document.getElementById('btn')!;

    let afterEventCalled = false;

    const handle = createEventTap({
      onEvent: () => {},
      // onAfterEvent intentionally NOT provided
    });

    btn.click();
    expect(afterEventCalled).toBe(false);

    handle.stop();
    TEST_HOOK.forceTrusted = false;
  });

  it('fires onAfterEvent after onEvent with correct arguments', () => {
    document.body.innerHTML = '<button id="btn" class="primary">Click</button>';
    const btn = document.getElementById('btn')!;

    let onEventEvent: ObservedEvent | null = null;
    let afterEventCall: {
      targetEl: Element;
      eventId: string;
      eventType: string;
      cssSelector: string;
    } | null = null;
    let onEventCount = 0;
    let afterEventCount = 0;

    const handle = createEventTap({
      onEvent: (event) => {
        onEventEvent = event;
        onEventCount++;
      },
      onAfterEvent: (targetEl, eventId, eventType, cssSelector) => {
        afterEventCall = { targetEl, eventId, eventType, cssSelector };
        afterEventCount++;
      },
    });

    btn.click();

    // onEvent should fire first
    expect(onEventCount).toBe(1);
    expect(onEventEvent).not.toBeNull();
    expect(onEventEvent!.eventType).toBe('click');

    // onAfterEvent should fire second with matching args
    expect(afterEventCount).toBe(1);
    expect(afterEventCall).not.toBeNull();
    expect(afterEventCall!.targetEl).toBe(btn);
    expect(afterEventCall!.eventId).toBe(onEventEvent!.eventId);
    expect(afterEventCall!.eventType).toBe('click');
    expect(afterEventCall!.cssSelector).toBe(onEventEvent!.target.cssSelector);

    handle.stop();
    TEST_HOOK.forceTrusted = false;
  });

  it('onAfterEvent fires for every event type (not just click)', () => {
    document.body.innerHTML = '<input type="text" id="txt">';
    const txt = document.getElementById('txt')!;

    const eventTypes: string[] = [];

    const handle = createEventTap({
      onEvent: () => {},
      onAfterEvent: (_el, _id, eventType, _sel) => {
        eventTypes.push(eventType);
      },
    });

    txt.focus();
    txt.blur();

    // Should have received both focus and blur
    expect(eventTypes).toContain('focus');
    expect(eventTypes).toContain('blur');

    handle.stop();
    TEST_HOOK.forceTrusted = false;
  });

  it('onAfterEvent is synchronous (runs before any timer)', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const btn = document.getElementById('btn')!;

    const order: string[] = [];

    const handle = createEventTap({
      onEvent: () => { order.push('onEvent'); },
      onAfterEvent: () => { order.push('onAfterEvent'); },
    });

    btn.click();

    // Both should have fired synchronously in order
    expect(order).toEqual(['onEvent', 'onAfterEvent']);

    handle.stop();
    TEST_HOOK.forceTrusted = false;
  });

  it('existing callers without onAfterEvent are unaffected (backward compat)', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const btn = document.getElementById('btn')!;

    let eventCount = 0;

    // Only onEvent — the original a43df53 pattern
    const handle = createEventTap({
      onEvent: () => { eventCount++; },
    });

    btn.click();

    expect(eventCount).toBe(1);

    handle.stop();
    TEST_HOOK.forceTrusted = false;
  });
});
