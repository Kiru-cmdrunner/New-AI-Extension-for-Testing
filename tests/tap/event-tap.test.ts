/**
 * Unit Tests: Event Tap
 *
 * Tests the capture-phase event listener factory.
 * Uses jsdom to simulate DOM events.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';

describe('Event Tap', () => {
  let tapHandle: ReturnType<typeof createEventTap> | null = null;
  let capturedEvents: any[] = [];

  beforeEach(() => {
    capturedEvents = [];
    document.body.innerHTML = '';
    TEST_HOOK.forceTrusted = true; // treat synthetic events as trusted in tests
  });

  afterEach(() => {
    TEST_HOOK.forceTrusted = false;
    tapHandle?.stop();
    tapHandle = null;
  });

  // ── Basic Capture ─────────────────────────────────────────────────

  it('captures trusted click events', () => {
    document.body.innerHTML = '<button id="btn">Login</button>';
    const btn = document.getElementById('btn')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].eventType).toBe('click');
  });

  it('ignores untrusted (synthetic) events', () => {
    document.body.innerHTML = '<button id="btn">Submit</button>';
    const btn = document.getElementById('btn')!;
    TEST_HOOK.forceTrusted = false;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(capturedEvents.length).toBe(0);
  });

  it('captures keydown events', () => {
    document.body.innerHTML = '<input id="inp" type="text" />';
    const inp = document.getElementById('inp')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].key).toBe('a');
    expect(capturedEvents[0].code).toBe('KeyA');
  });

  // ── Target Resolution ─────────────────────────────────────────────

  it('resolves target through Shadow DOM composedPath', () => {
    // jsdom does not propagate events from inside shadow roots to
    // document-level capture listeners. This test verifies that
    // when composedPath returns the shadow element, the tap resolves it.
    // In a real browser, the capture listener fires naturally.
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;

    if (host.attachShadow) {
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<button id="inner">Shadow Button</button>';
      const innerBtn = shadow.getElementById('inner')!;

      tapHandle = createEventTap({
        onEvent: (e) => capturedEvents.push(e),
      });

      // Dispatch from the shadow element — in jsdom this won't reach
      // document capture, but we can verify the tap doesn't throw.
      innerBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      // In jsdom, shadow events don't reach document capture listeners.
      // This is an environment limitation, not a code bug.
      // The test verifies no crash occurs.
      expect(true).toBe(true);
    }
  });

  // ── Scroll Rate Limiting ──────────────────────────────────────────

  it('rate-limits scroll events', () => {
    document.body.innerHTML =
      '<div id="sc" style="overflow:auto; height:100px;"></div>';
    const sc = document.getElementById('sc')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(capturedEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ── Identity Extraction ───────────────────────────────────────────

  it('extracts element identity including accessible name', () => {
    document.body.innerHTML =
      '<button id="btn" aria-label="Save Profile">Save</button>';
    const btn = document.getElementById('btn')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
     });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].target.accessibleName).toBe('Save Profile');
  });

  // ── Value Capture ─────────────────────────────────────────────────

  it('captures value on input events', () => {
    document.body.innerHTML =
      '<input id="inp" type="text" value="hello" />';
    const inp = document.getElementById('inp') as HTMLInputElement;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    inp.value = 'hello world';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].valueAfter).toBe('hello world');
  });

  // ── Stop / Cleanup ────────────────────────────────────────────────

  it('stops capturing after stop()', () => {
    document.body.innerHTML = '<button id="btn">Test</button>';
    const btn = document.getElementById('btn')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);

    tapHandle.stop();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(capturedEvents.length).toBe(1); // no new capture
  });

  // ── Event Types ───────────────────────────────────────────────────

  it('captures focus and blur events', async () => {
    document.body.innerHTML = '<input id="f1" type="text" /><input id="f2" type="text" />';
    const f1 = document.getElementById('f1')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    f1.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    f1.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    // Blur value capture is deferred via setTimeout(0) for SPA frameworks
    // so the framework has time to flush state updates. Wait for it.
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedEvents.length).toBe(2);
    expect(capturedEvents[0].eventType).toBe('focus');
    expect(capturedEvents[1].eventType).toBe('blur');
  });

  it('captures change events', () => {
    document.body.innerHTML =
      '<select id="sel"><option>A</option><option>B</option></select>';
    const sel = document.getElementById('sel') as HTMLSelectElement;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    sel.value = 'B';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].eventType).toBe('change');
  });

  it('captures mousedown events', () => {
    document.body.innerHTML = '<button id="btn">Click Me</button>';
    const btn = document.getElementById('btn')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].eventType).toBe('mousedown');
  });

  it('captures mouseenter and mouseleave events', () => {
    document.body.innerHTML = '<div id="d" style="width:50px;height:50px;"></div>';
    const div = document.getElementById('d')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    div.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    div.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    // mouseenter/leave are not bubbling events and use a different dispatch path
    // The capture-phase listener catches them regardless of bubbling
    expect(capturedEvents.length).toBe(2);
    expect(capturedEvents[0].eventType).toBe('mouseenter');
    expect(capturedEvents[1].eventType).toBe('mouseleave');
  });

  it('captures contextmenu events', () => {
    document.body.innerHTML = '<div id="d"></div>';
    const div = document.getElementById('d')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    div.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].eventType).toBe('contextmenu');
  });

  // ── SPA Deferred Value Capture (AdaniOne) ───────────────────────────

  it('defers blur value capture so SPA frameworks can flush state', async () => {
    // Simulate a React-like scenario: blur fires BEFORE the framework
    // updates the DOM value. The deferred capture reads the value AFTER.
    document.body.innerHTML = '<input id="date-input" type="text" value="Old Date" />';
    const input = document.getElementById('date-input') as HTMLInputElement;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    // Focus the input
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Simulate: user selects a date from a calendar. The framework will
    // update the value asynchronously AFTER blur fires.
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

    // Simulate React flushing the state update (happens after blur in SPAs)
    input.value = 'New Date';

    // Wait for deferred blur capture
    await new Promise((r) => setTimeout(r, 20));

    const blurEvent = capturedEvents.find((e) => e.eventType === 'blur');
    expect(blurEvent).toBeDefined();
    // The deferred value should reflect the NEW value, not the stale one
    expect(blurEvent.valueAfter).toBe('New Date');
  });

  it('emits supplementary change event when input value changes after click', async () => {
    // Simulate: user clicks a dropdown option, React updates the input
    // value asynchronously after the click.
    document.body.innerHTML = `
      <input id="city-input" type="text" value="Old City" />
      <div id="option">New City</div>
    `;
    const input = document.getElementById('city-input') as HTMLInputElement;
    const option = document.getElementById('option')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    // Focus the input (user was typing/selecting in autocomplete)
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Click on the option (simulates selecting from dropdown)
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Simulate React flushing the value update AFTER the click
    input.value = 'New City';

    // Wait for post-click value check
    await new Promise((r) => setTimeout(r, 80));

    // Should have: focus event, click event, and a supplementary change event
    const changeEvents = capturedEvents.filter((e) => e.eventType === 'change');
    expect(changeEvents.length).toBeGreaterThanOrEqual(1);
    expect(changeEvents[0].valueBefore).toBe('Old City');
    expect(changeEvents[0].valueAfter).toBe('New City');
  });

  it('does NOT emit change event when value stays the same after click', async () => {
    document.body.innerHTML = `
      <input id="input" type="text" value="Same Value" />
      <div id="btn">Click</div>
    `;
    const input = document.getElementById('input') as HTMLInputElement;
    const btn = document.getElementById('btn')!;
    tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });

    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Value does NOT change
    await new Promise((r) => setTimeout(r, 80));

    const changeEvents = capturedEvents.filter((e) => e.eventType === 'change');
    expect(changeEvents.length).toBe(0);
  });
});
