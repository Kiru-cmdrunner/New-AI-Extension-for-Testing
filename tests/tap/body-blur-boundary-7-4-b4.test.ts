/**
 * 7.4-B4 S4-3 — Tap-layer body-blur boundary pin.
 *
 * Grounded at src/tap/event-tap.ts:299–311 (valueBefore/valueAfter
 * capture semantics). B3-S4 shipped BODY/HTML capture with a mirror pin
 * (resolveTarget) + E2E evidence only — this file pins the CAPTURE-side
 * boundary in the tap itself:
 *
 *   - a blur on a tracked input captures valueAfter from the blurred
 *     element (the terminal value the user left);
 *   - a subsequent click on BODY captures valueBefore from BODY itself
 *     (BODY has no value — null), never from the previously blurred
 *     input (no state bleed across targets);
 *   - the blur is the S3 episode-close trigger upstream — exactly one
 *     synthetic mint happens at the runtime layer (pinned in
 *     typed-text-terminal-sample-7-4-b3.test.ts); here we pin the
 *     capture substrate the runtime consumes.
 *
 * Spec: .drytis/specs/phase-7-4-b4-unclassified-output-policy.md §S4-3
 * (absorbed from the superseded consolidation spec).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';

describe('7.4-B4 S4-3: tap-layer body-blur boundary', () => {
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

  it('S4-3a: blur on a tracked input captures valueAfter from the blurred element', () => {
    document.body.innerHTML = '<input id="search" type="text" value="hotel" />';
    const input = document.getElementById('search') as HTMLInputElement;

    tapHandle = createEventTap({ onEvent: (e) => capturedEvents.push(e) });

    // The blur captures the terminal value the user left in the field
    input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    const blur = capturedEvents.find((e) => e.eventType === 'blur');
    expect(blur).toBeDefined();
    expect(blur.valueAfter).toBe('hotel');
    expect(blur.valueBefore).toBeNull();
  });

  it('S4-3b: subsequent BODY click captures valueBefore from BODY itself (null), no bleed from the blurred input', () => {
    document.body.innerHTML =
      '<input id="search" type="text" value="hotel" /><div id="backdrop"></div>';
    const input = document.getElementById('search') as HTMLInputElement;

    tapHandle = createEventTap({ onEvent: (e) => capturedEvents.push(e) });

    input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const blur = capturedEvents.find((e) => e.eventType === 'blur');
    expect(blur).toBeDefined();
    expect(blur.valueAfter).toBe('hotel');

    const bodyClick = capturedEvents.find(
      (e) => e.eventType === 'click' && e.target.tag === 'BODY',
    );
    expect(bodyClick).toBeDefined();
    // BODY has no value — and critically, the previously blurred input's
    // value must NOT bleed into the BODY click's valueBefore
    expect(bodyClick.valueBefore).toBeNull();
    expect(bodyClick.valueAfter).toBeNull();
  });

  it('S4-3c: the blur+BODY-click pair is the S3 episode-close substrate — blur arrives, BODY click captures its own target identity', () => {
    document.body.innerHTML = '<input id="search" type="text" value="hotel" />';
    const input = document.getElementById('search') as HTMLInputElement;

    tapHandle = createEventTap({ onEvent: (e) => capturedEvents.push(e) });

    input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Both events were captured, in order (blur before the body click)
    const idxBlur = capturedEvents.findIndex((e) => e.eventType === 'blur');
    const idxBody = capturedEvents.findIndex(
      (e) => e.eventType === 'click' && e.target.tag === 'BODY',
    );
    expect(idxBlur).toBeGreaterThanOrEqual(0);
    expect(idxBody).toBeGreaterThan(idxBlur);

    // The BODY click's identity is BODY — resolveTarget resolution kept
    // the structural click-on-background gesture (B3-S4) intact
    expect(capturedEvents[idxBody].target.tag).toBe('BODY');
    // The blur's identity is the input — episode close keys on elementKey
    // upstream; the tap hands the runtime a distinct identity per event
    expect(capturedEvents[idxBlur].target.tag).toBe('INPUT');
    expect(capturedEvents[idxBlur].target.cssSelector).toBe('#search');
  });
});
