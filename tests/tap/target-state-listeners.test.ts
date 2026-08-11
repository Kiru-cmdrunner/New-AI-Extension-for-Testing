/**
 * M2 Unit Tests: TargetStateListeners — Capture-Phase Pre-Population
 *
 * Tests that capture-phase mousedown and focus listeners fire BEFORE
 * element state changes are applied, correctly pre-populating the
 * TargetStateCache.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3.3, §4.2 step 2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { installTargetStateListeners } from '../../src/tap/target-state-listeners';
import type { TargetStateListenersHandle } from '../../src/tap/target-state-listeners';

describe('TargetStateListeners', () => {
  let cache: TargetStateCache;
  let handle: TargetStateListenersHandle | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = new TargetStateCache();
  });

  afterEach(() => {
    handle?.stop();
    handle = null;
  });

  // ── Installation & Cleanup ────────────────────────────────────────

  it('installTargetStateListeners returns a handle with stop()', () => {
    handle = installTargetStateListeners(cache);
    expect(typeof handle.stop).toBe('function');
  });

  it('stop() removes listeners (no crash on multiple stop)', () => {
    handle = installTargetStateListeners(cache);
    handle.stop();
    // Second stop should not throw
    expect(() => handle!.stop()).not.toThrow();
  });

  // ── mousedown Capture-Phase ───────────────────────────────────────

  it('mousedown capture-phase populates cache before click handler', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'before-click';
    document.body.appendChild(el);

    // Simulate: mousedown fires in capture phase (before the click handler changes value)
    const mousedownEvent = new MouseEvent('mousedown', { bubbles: true });
    el.dispatchEvent(mousedownEvent);

    // At this point, cache should have the "before" state
    const snap = cache.peek(el);
    expect(snap).toBeDefined();
    expect(snap!.value).toBe('before-click');
  });

  it('mousedown captures checkbox state before toggle', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = false;
    document.body.appendChild(el);

    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Now simulate the click toggling checked
    el.checked = true;

    // Cache should still have the pre-toggle state
    const snap = cache.peek(el);
    expect(snap).toBeDefined();
    expect(snap!.checked).toBe(false);
  });

  it('mousedown captures aria-expanded before toggle', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('button');
    el.setAttribute('aria-expanded', 'false');
    el.textContent = 'Expand';
    document.body.appendChild(el);

    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Simulate click handler expanding
    el.setAttribute('aria-expanded', 'true');
    el.textContent = 'Collapse';

    // Cache should have pre-toggle state
    const snap = cache.peek(el);
    expect(snap).toBeDefined();
    expect(snap!.ariaExpanded).toBe(false);
    expect(snap!.textContent).toBe('Expand');
  });

  // ── focus Capture-Phase ───────────────────────────────────────────

  it('focus capture-phase populates cache', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'text';
    el.value = '';
    document.body.appendChild(el);

    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    const snap = cache.peek(el);
    expect(snap).toBeDefined();
    expect(snap!.value).toBe('');
  });

  it('focus captures input value before focus handler modifies it', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'original';
    document.body.appendChild(el);

    // Focus event fires (capture phase, before any focus handler)
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Simulate a focus handler clearing the field
    el.value = '';

    // Cache should have the value before the focus handler ran
    const snap = cache.peek(el);
    expect(snap).toBeDefined();
    expect(snap!.value).toBe('original');
  });

  // ── Multiple elements ─────────────────────────────────────────────

  it('multiple elements are cached independently via mousedown', () => {
    handle = installTargetStateListeners(cache);

    const el1 = document.createElement('input');
    el1.type = 'text';
    el1.value = 'first';
    const el2 = document.createElement('input');
    el2.type = 'text';
    el2.value = 'second';
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    el1.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(cache.peek(el1)!.value).toBe('first');
    expect(cache.peek(el2)!.value).toBe('second');
  });

  // ── stop() removes listeners ──────────────────────────────────────

  it('after stop(), mousedown no longer populates cache', () => {
    handle = installTargetStateListeners(cache);
    handle.stop();

    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'test';
    document.body.appendChild(el);

    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(cache.peek(el)).toBeUndefined();
  });

  it('after stop(), focus no longer populates cache', () => {
    handle = installTargetStateListeners(cache);
    handle.stop();

    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'test';
    document.body.appendChild(el);

    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    expect(cache.peek(el)).toBeUndefined();
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it('mousedown on document does not crash', () => {
    handle = installTargetStateListeners(cache);

    // Dispatch mousedown on document — should be safely ignored
    expect(() => {
      document.dispatchEvent(new MouseEvent('mousedown'));
    }).not.toThrow();
  });

  it('focus on document does not crash', () => {
    handle = installTargetStateListeners(cache);

    expect(() => {
      document.dispatchEvent(new FocusEvent('focus'));
    }).not.toThrow();
  });

  it('subsequent captures overwrite previous snapshot', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'first';
    document.body.appendChild(el);

    // First mousedown
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Change value, dispatch second mousedown
    el.value = 'second';
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const snap = cache.peek(el);
    expect(snap!.value).toBe('second');
  });

  // ── Full before/after lifecycle simulation ────────────────────────

  it('full lifecycle: mousedown → state change → peek shows before-state', () => {
    handle = installTargetStateListeners(cache);

    // Set up an accordion button
    const el = document.createElement('button');
    el.className = 'accordion-header';
    el.setAttribute('aria-expanded', 'false');
    el.textContent = 'Expand Section';
    el.disabled = false;
    document.body.appendChild(el);

    // 1. mousedown fires (capture phase) — cache stores pre-interaction state
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // 2. Simulate click handler expanding the accordion
    el.setAttribute('aria-expanded', 'true');
    el.className = 'accordion-header active';
    el.textContent = 'Collapse Section';

    // 3. Verify cache has the BEFORE state (this is what EvidenceCollector will peek)
    const beforeSnap = cache.peek(el);
    expect(beforeSnap).toBeDefined();
    expect(beforeSnap!.ariaExpanded).toBe(false);
    expect(beforeSnap!.className).toBe('accordion-header');
    expect(beforeSnap!.textContent).toBe('Expand Section');
    expect(beforeSnap!.disabled).toBe(false);

    // 4. EvidenceCollector would capture the AFTER state directly
    const afterSnap = cache.capture(el);
    expect(afterSnap.ariaExpanded).toBe(true);
    expect(afterSnap.className).toBe('accordion-header active');
    expect(afterSnap.textContent).toBe('Collapse Section');
  });

  it('checkbox lifecycle: mousedown → toggle → before-state preserved', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = false;
    el.className = 'form-check';
    document.body.appendChild(el);

    // mousedown → cache stores unchecked state
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Click toggles the checkbox
    el.checked = true;

    // Peek shows before-state (unchecked)
    const beforeSnap = cache.peek(el);
    expect(beforeSnap!.checked).toBe(false);

    // Capture shows after-state (checked)
    const afterSnap = cache.capture(el);
    expect(afterSnap.checked).toBe(true);
  });

  it('text input lifecycle: focus → type → before-state preserved', () => {
    handle = installTargetStateListeners(cache);

    const el = document.createElement('input');
    el.type = 'text';
    el.value = '';
    document.body.appendChild(el);

    // focus → cache stores empty value
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

    // Simulate typing
    el.value = 'hello world';

    // Peek shows before-state (empty)
    const beforeSnap = cache.peek(el);
    expect(beforeSnap!.value).toBe('');

    // Capture shows after-state (typed value)
    const afterSnap = cache.capture(el);
    expect(afterSnap.value).toBe('hello world');
  });
});
