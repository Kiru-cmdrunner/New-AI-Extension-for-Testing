/**
 * Unit Tests: Element State Cache
 *
 * Tests the WeakMap-backed element state cache that preserves
 * DOM property before-state for observation windows.
 *
 * Architecture: `.drytis/specs/m1-phase-a-detailed-design.md`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ElementStateCache } from '../../src/tap/element-state-cache';
import type { ElementStateSnapshot } from '../../src/shared/observation-types';

describe('ElementStateCache', () => {
  let cache: ElementStateCache;

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = new ElementStateCache();
  });

  // ── capture ──────────────────────────────────────────────────────────

  describe('capture', () => {
    it('captures checkbox state (checked, className)', () => {
      document.body.innerHTML = '<input type="checkbox" id="cb" class="filter-opt">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = false;

      const snap = cache.capture(cb);

      expect(snap.checked).toBe(false);
      expect(snap.className).toBe('filter-opt');
      expect(snap.value).toBe('on'); // default checkbox value is "on"
      expect(snap.disabled).toBe(false);
      expect(snap.childCount).toBe(0);
    });

    it('captures select value', () => {
      document.body.innerHTML =
        '<select id="sel"><option value="economy">Economy</option><option value="premium">Premium</option></select>';
      const sel = document.getElementById('sel') as HTMLSelectElement;

      const snap = cache.capture(sel);

      expect(snap.value).toBe('economy');
      expect(snap.checked).toBeNull();
    });

    it('captures text input value', () => {
      document.body.innerHTML = '<input type="text" id="inp" value="hello">';
      const inp = document.getElementById('inp') as HTMLInputElement;

      const snap = cache.capture(inp);

      expect(snap.value).toBe('hello');
      expect(snap.checked).toBeNull();
    });

    it('captures div state (className, textContent, childCount, ariaExpanded)', () => {
      document.body.innerHTML =
        '<div id="d" class="accordion-header" aria-expanded="false">' +
        '<span>Section 1</span><span>Section 2</span></div>';
      const div = document.getElementById('d')!;

      const snap = cache.capture(div);

      expect(snap.className).toBe('accordion-header');
      expect(snap.ariaExpanded).toBe(false);
      expect(snap.textContent).toContain('Section 1');
      expect(snap.textContent).toContain('Section 2');
      expect(snap.childCount).toBe(2);
      expect(snap.value).toBeNull();
    });

    it('captures aria-checked and aria-pressed on custom elements', () => {
      document.body.innerHTML =
        '<div id="toggle" role="switch" aria-checked="true" aria-pressed="false">On</div>';
      const div = document.getElementById('toggle')!;

      const snap = cache.capture(div);

      expect(snap.ariaChecked).toBe(true);
      expect(snap.ariaPressed).toBe(false);
      expect(snap.checked).toBe(true); // aria-checked maps to checked
    });

    it('overwrites previous snapshot on re-capture (same element)', () => {
      document.body.innerHTML = '<input type="text" id="inp" value="before">';
      const inp = document.getElementById('inp') as HTMLInputElement;

      const snap1 = cache.capture(inp);
      inp.value = 'after';
      const snap2 = cache.capture(inp);

      // snap1 is the old snapshot (immutable)
      expect(snap1.value).toBe('before');
      // snap2 is the new snapshot
      expect(snap2.value).toBe('after');
      // peek returns the latest
      expect(cache.peek(inp)?.value).toBe('after');
    });
  });

  // ── peek ─────────────────────────────────────────────────────────────

  describe('peek', () => {
    it('returns null for uncached element (first interaction)', () => {
      document.body.innerHTML = '<input type="text" id="inp">';
      const inp = document.getElementById('inp')!;

      expect(cache.peek(inp)).toBeNull();
    });

    it('returns stored snapshot for cached element', () => {
      document.body.innerHTML = '<input type="checkbox" id="cb">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = true;

      cache.capture(cb);
      const peeked = cache.peek(cb);

      expect(peeked).not.toBeNull();
      expect(peeked!.checked).toBe(true);
    });
  });

  // ── clear ────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('clears all cached states (peek returns null after clear)', () => {
      document.body.innerHTML =
        '<input type="text" id="inp1"><input type="text" id="inp2">';
      const inp1 = document.getElementById('inp1')!;
      const inp2 = document.getElementById('inp2')!;

      cache.capture(inp1);
      cache.capture(inp2);
      expect(cache.peek(inp1)).not.toBeNull();
      expect(cache.peek(inp2)).not.toBeNull();

      cache.clear();

      expect(cache.peek(inp1)).toBeNull();
      expect(cache.peek(inp2)).toBeNull();
    });
  });

  // ── immutability ─────────────────────────────────────────────────────

  describe('immutability', () => {
    it('stored snapshot is not modified when cache is re-captured', () => {
      document.body.innerHTML = '<input type="checkbox" id="cb">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = false;

      const snap1: ElementStateSnapshot = cache.capture(cb);
      cb.checked = true;
      const snap2: ElementStateSnapshot = cache.capture(cb);

      // snap1 must NOT have changed
      expect(snap1.checked).toBe(false); // still the old snapshot
      expect(snap2.checked).toBe(true); // new snapshot
      expect(snap1).not.toBe(snap2); // different objects
    });

    it('peeked snapshot remains valid after subsequent capture', () => {
      document.body.innerHTML = '<input type="text" id="inp" value="first">';
      const inp = document.getElementById('inp') as HTMLInputElement;

      cache.capture(inp);
      const peeked = cache.peek(inp);
      expect(peeked!.value).toBe('first');

      // Change and re-capture
      inp.value = 'second';
      cache.capture(inp);

      // Previously peeked snapshot must be unchanged
      expect(peeked!.value).toBe('first');

      // New peek returns new value
      expect(cache.peek(inp)?.value).toBe('second');
    });
  });

  // ── disabled detection ───────────────────────────────────────────────

  it('detects disabled state via attribute and aria-disabled', () => {
    document.body.innerHTML =
      '<button id="b1" disabled>Btn1</button>' +
      '<button id="b2" aria-disabled="true">Btn2</button>' +
      '<button id="b3">Btn3</button>';

    const b1 = document.getElementById('b1')!;
    const b2 = document.getElementById('b2')!;
    const b3 = document.getElementById('b3')!;

    expect(cache.capture(b1).disabled).toBe(true);
    expect(cache.capture(b2).disabled).toBe(true);
    expect(cache.capture(b3).disabled).toBe(false);
  });

  // ── read (non-mutating snapshot) ────────────────────────────────────

  describe('read', () => {
    it('returns current state without updating the cache', () => {
      document.body.innerHTML = '<input type="checkbox" id="cb" class="original">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = false;

      // Populate cache with capture
      cache.capture(cb); // { checked: false, className: 'original' }

      // Mutate the element
      cb.checked = true;
      cb.className = 'changed';

      // read() should return the NEW state
      const readSnap = cache.read(cb);
      expect(readSnap.checked).toBe(true);
      expect(readSnap.className).toBe('changed');

      // But peek() should still return the OLD cached state (capture didn't overwrite)
      const peekSnap = cache.peek(cb);
      expect(peekSnap!.checked).toBe(false);
      expect(peekSnap!.className).toBe('original');
    });

    it('read() does not require prior capture — returns fresh snapshot', () => {
      document.body.innerHTML = '<input type="text" id="txt" value="hello">';
      const txt = document.getElementById('txt') as HTMLInputElement;

      // No prior capture — cache is empty for this element
      expect(cache.peek(txt)).toBeNull();

      // read() still works
      const snap = cache.read(txt);
      expect(snap.value).toBe('hello');
    });
  });
});
