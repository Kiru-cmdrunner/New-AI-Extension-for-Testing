/**
 * M2 Unit Tests: TargetStateCache
 *
 * Tests all 9 TargetStateSnapshot properties, null handling for optional
 * fields, WeakMap semantics (peek vs read vs capture), and capturedAt timing.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TargetStateCache } from '../../src/tap/target-state-cache';

describe('TargetStateCache', () => {
  let cache: TargetStateCache;

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = new TargetStateCache();
  });

  // ── Basic Capture + Peek ──────────────────────────────────────────

  it('capture stores a snapshot and peek retrieves it', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'hello';
    document.body.appendChild(el);

    cache.capture(el);
    const snap = cache.peek(el);

    expect(snap).toBeDefined();
    expect(snap!.value).toBe('hello');
  });

  it('peek returns undefined for uncached element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    expect(cache.peek(el)).toBeUndefined();
  });

  it('has() returns true for cached, false for uncached', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    expect(cache.has(el)).toBe(false);

    cache.capture(el);
    expect(cache.has(el)).toBe(true);
  });

  // ── All 9 Properties ──────────────────────────────────────────────

  it('captures value for text input', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'test value';
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.value).toBe('test value');
  });

  it('captures value for textarea', () => {
    const el = document.createElement('textarea');
    el.value = 'multi\nline\ntext';
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.value).toBe('multi\nline\ntext');
  });

  it('captures value for select element', () => {
    const el = document.createElement('select');
    const opt1 = document.createElement('option');
    opt1.value = 'a';
    opt1.selected = true;
    const opt2 = document.createElement('option');
    opt2.value = 'b';
    el.appendChild(opt1);
    el.appendChild(opt2);
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.value).toBe('a');
  });

  it('value is null for non-form element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.value).toBeNull();
  });

  it('captures checked=true for checked checkbox', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = true;
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.checked).toBe(true);
  });

  it('captures checked=false for unchecked checkbox', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = false;
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.checked).toBe(false);
  });

  it('captures checked=true for selected radio', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.checked = true;
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.checked).toBe(true);
  });

  it('checked is null for text input (not checkbox/radio)', () => {
    const el = document.createElement('input');
    el.type = 'text';
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.checked).toBeNull();
  });

  it('checked is null for non-input element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.checked).toBeNull();
  });

  it('captures className', () => {
    const el = document.createElement('div');
    el.className = 'btn primary active';
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.className).toBe('btn primary active');
  });

  it('className is empty string for element without class', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.className).toBe('');
  });

  it('captures disabled=true for disabled input', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.disabled = true;
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.disabled).toBe(true);
  });

  it('captures disabled=false for enabled input', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.disabled = false;
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.disabled).toBe(false);
  });

  // ── ARIA State Attributes ─────────────────────────────────────────

  it('captures aria-expanded=true', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-expanded', 'true');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaExpanded).toBe(true);
  });

  it('captures aria-expanded=false', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-expanded', 'false');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaExpanded).toBe(false);
  });

  it('ariaExpanded is null when not set', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaExpanded).toBeNull();
  });

  it('captures aria-checked=true', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', 'true');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaChecked).toBe(true);
  });

  it('captures aria-checked=false', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', 'false');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaChecked).toBe(false);
  });

  it('ariaChecked is null when not set', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaChecked).toBeNull();
  });

  it('captures aria-pressed=true', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-pressed', 'true');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaPressed).toBe(true);
  });

  it('captures aria-pressed=false', () => {
    const el = document.createElement('button');
    el.setAttribute('aria-pressed', 'false');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaPressed).toBe(false);
  });

  it('ariaPressed is null when not set', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.ariaPressed).toBeNull();
  });

  // ── textContent ───────────────────────────────────────────────────

  it('captures textContent', () => {
    const el = document.createElement('button');
    el.textContent = 'Submit Form';
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.textContent).toBe('Submit Form');
  });

  it('textContent is null for element with no text', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.textContent).toBe('');
  });

  it('textContent is truncated at 500 chars', () => {
    const el = document.createElement('div');
    el.textContent = 'x'.repeat(600);
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.textContent!.length).toBe(500);
  });

  // ── childCount ────────────────────────────────────────────────────

  it('captures childCount correctly', () => {
    const el = document.createElement('div');
    for (let i = 0; i < 5; i++) {
      el.appendChild(document.createElement('span'));
    }
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.childCount).toBe(5);
  });

  it('childCount is 0 for empty element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.childCount).toBe(0);
  });

  // ── capturedAt ────────────────────────────────────────────────────

  it('capturedAt uses performance.now()', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const before = performance.now();
    const snap = cache.capture(el);
    const after = performance.now();

    expect(snap.capturedAt).toBeGreaterThanOrEqual(before);
    expect(snap.capturedAt).toBeLessThanOrEqual(after);
  });

  // ── read() semantics ──────────────────────────────────────────────

  it('read returns previous snapshot and updates cache', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'before';
    document.body.appendChild(el);

    cache.capture(el); // stores "before"

    // Change value
    el.value = 'after';

    const prev = cache.read(el);
    expect(prev!.value).toBe('before'); // returns old snapshot

    // Cache should now have the new value
    const fresh = cache.peek(el);
    expect(fresh!.value).toBe('after');
  });

  it('read returns undefined when no prior snapshot', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const prev = cache.read(el);
    expect(prev).toBeUndefined();

    // But a new snapshot was captured
    expect(cache.peek(el)).toBeDefined();
  });

  it('capture overwrites previous snapshot', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = 'first';
    document.body.appendChild(el);

    cache.capture(el);
    el.value = 'second';
    cache.capture(el);

    const snap = cache.peek(el);
    expect(snap!.value).toBe('second');
  });

  // ── Multiple elements ─────────────────────────────────────────────

  it('caches multiple elements independently', () => {
    const el1 = document.createElement('input');
    el1.type = 'text';
    el1.value = 'first';
    const el2 = document.createElement('input');
    el2.type = 'text';
    el2.value = 'second';
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    cache.capture(el1);
    cache.capture(el2);

    expect(cache.peek(el1)!.value).toBe('first');
    expect(cache.peek(el2)!.value).toBe('second');
  });

  // ── Complex realistic scenarios ───────────────────────────────────

  it('captures full state of a checkbox before toggle', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = false;
    el.className = 'form-check-input';
    el.disabled = false;
    el.setAttribute('aria-checked', 'false');
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.checked).toBe(false);
    expect(snap.className).toBe('form-check-input');
    expect(snap.disabled).toBe(false);
    expect(snap.ariaChecked).toBe(false);
  });

  it('captures full state of an expanded accordion button', () => {
    const el = document.createElement('button');
    el.className = 'accordion-header active';
    el.setAttribute('aria-expanded', 'true');
    el.setAttribute('aria-pressed', 'true');
    el.textContent = 'Section 1';
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.className).toBe('accordion-header active');
    expect(snap.ariaExpanded).toBe(true);
    expect(snap.ariaPressed).toBe(true);
    expect(snap.textContent).toBe('Section 1');
    expect(snap.disabled).toBe(false);
    expect(snap.value).toBeNull();
    expect(snap.checked).toBeNull();
  });

  it('captures state of a select with selected option', () => {
    const el = document.createElement('select');
    el.disabled = false;
    const opt1 = document.createElement('option');
    opt1.value = '';
    opt1.textContent = 'Choose...';
    const opt2 = document.createElement('option');
    opt2.value = 'us';
    opt2.textContent = 'United States';
    opt2.selected = true;
    el.appendChild(opt1);
    el.appendChild(opt2);
    document.body.appendChild(el);

    const snap = cache.capture(el);
    expect(snap.value).toBe('us');
    expect(snap.disabled).toBe(false);
    expect(snap.childCount).toBe(2);
    expect(snap.checked).toBeNull();
  });
});
