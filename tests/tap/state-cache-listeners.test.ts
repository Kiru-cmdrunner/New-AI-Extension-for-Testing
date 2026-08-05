/**
 * Unit Tests: State Cache Listeners
 *
 * Tests the capture-phase mousedown and focus listeners that silently
 * populate the ElementStateCache before the browser changes element state.
 *
 * Architecture: `.drytis/specs/m1-phase-a-detailed-design.md`
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ElementStateCache } from '../../src/tap/element-state-cache';
import { setupStateCacheListeners } from '../../src/tap/state-cache-listeners';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';

describe('State Cache Listeners', () => {
  let cache: ElementStateCache;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = new ElementStateCache();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    TEST_HOOK.forceTrusted = false;
  });

  // ── Basic Capture ────────────────────────────────────────────────────

  it('captures element state on mousedown (capture phase)', () => {
    document.body.innerHTML = '<input type="checkbox" id="cb">';
    const cb = document.getElementById('cb') as HTMLInputElement;
    cb.checked = false;

    cleanup = setupStateCacheListeners(cache);

    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const peeked = cache.peek(cb);
    expect(peeked).not.toBeNull();
    expect(peeked!.checked).toBe(false);
  });

  it('captures element state on focus (capture phase)', () => {
    document.body.innerHTML = '<input type="text" id="inp" value="">';
    const inp = document.getElementById('inp') as HTMLInputElement;

    cleanup = setupStateCacheListeners(cache);

    inp.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    const peeked = cache.peek(inp);
    expect(peeked).not.toBeNull();
    expect(peeked!.value).toBe('');
  });

  // ── Timing Guarantee ─────────────────────────────────────────────────

  it('populates cache BEFORE state changes (timing guarantee)', () => {
    document.body.innerHTML = '<input type="checkbox" id="cb">';
    const cb = document.getElementById('cb') as HTMLInputElement;
    cb.checked = false;

    cleanup = setupStateCacheListeners(cache);

    // Simulate the real event order: mousedown fires, THEN state changes
    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // NOW change state (simulating browser activation behavior)
    cb.checked = true;

    // Cache must have the pre-change state
    const before = cache.peek(cb);
    expect(before).not.toBeNull();
    expect(before!.checked).toBe(false); // pre-change state
  });

  // ── Non-HTMLElement targets ──────────────────────────────────────────

  it('ignores non-HTMLElement targets', () => {
    cleanup = setupStateCacheListeners(cache);

    // Dispatch mousedown on document — target is document, not HTMLElement
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // No crash, no cache pollution — just silently ignored
    // Verify by checking that a real element still works
    document.body.innerHTML = '<button id="btn">Test</button>';
    const btn = document.getElementById('btn')!;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(cache.peek(btn)).not.toBeNull();
  });

  // ── No interference with EventTap ────────────────────────────────────

  it('does not interfere with EventTap event flow', () => {
    document.body.innerHTML = '<button id="btn">Click Me</button>';
    const btn = document.getElementById('btn')!;

    const capturedEvents: any[] = [];
    TEST_HOOK.forceTrusted = true;
    const tapHandle = createEventTap({
      onEvent: (e) => capturedEvents.push(e),
    });
    cleanup = setupStateCacheListeners(cache);

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // EventTap should still receive the event
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].eventType).toBe('click');

    // Cache should also be populated (mousedown before click)
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(cache.peek(btn)).not.toBeNull();

    tapHandle.stop();
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes listeners on cleanup (no capture after cleanup)', () => {
      document.body.innerHTML = '<button id="btn">Test</button>';
      const btn = document.getElementById('btn')!;

      cleanup = setupStateCacheListeners(cache);
      cleanup();
      cleanup = null;

      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      // Should not have been captured
      expect(cache.peek(btn)).toBeNull();
    });

    it('cleanup function is idempotent (safe to call twice)', () => {
      cleanup = setupStateCacheListeners(cache);
      cleanup!();
      // Should not throw
      cleanup!();
      cleanup = null;

      // Normal operation still works
      cleanup = setupStateCacheListeners(cache);
      document.body.innerHTML = '<button id="btn2">Test</button>';
      const btn = document.getElementById('btn2')!;
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(cache.peek(btn)).not.toBeNull();
    });
  });

  // ── Multiple Elements ────────────────────────────────────────────────

  it('multiple elements cached independently', () => {
    document.body.innerHTML =
      '<input type="checkbox" id="cb"><input type="text" id="inp" value="hello">';
    const cb = document.getElementById('cb') as HTMLInputElement;
    const inp = document.getElementById('inp') as HTMLInputElement;

    cleanup = setupStateCacheListeners(cache);

    cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    inp.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    const cbSnap = cache.peek(cb);
    const inpSnap = cache.peek(inp);

    expect(cbSnap).not.toBeNull();
    expect(cbSnap!.checked).toBe(false);
    expect(inpSnap).not.toBeNull();
    expect(inpSnap!.value).toBe('hello');
  });
});
