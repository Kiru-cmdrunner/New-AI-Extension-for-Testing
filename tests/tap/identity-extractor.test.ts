/**
 * Unit Tests: Identity Extractor
 *
 * Tests the 10-tier accessible name cascade, selector generation,
 * value/checked state capture, and Shadow DOM traversal.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractIdentity,
  resolveTarget,
  captureValue,
  captureCheckedState,
} from '../../src/tap/identity-extractor';

describe('Identity Extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── Accessible Name Cascade ───────────────────────────────────────

  describe('accessible name cascade', () => {
    it('prefers aria-label', () => {
      document.body.innerHTML =
        '<button id="b" aria-label="Save Profile">Save</button>';
      const el = document.getElementById('b')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Save Profile');
    });

    it('falls back to aria-labelledby', () => {
      document.body.innerHTML = `
        <span id="lbl">Username Field</span>
        <input id="inp" type="text" aria-labelledby="lbl" />
      `;
      const el = document.getElementById('inp')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Username Field');
    });

    it('falls back to label[for] association', () => {
      document.body.innerHTML = `
        <label for="pass">Password</label>
        <input id="pass" type="password" />
      `;
      const el = document.getElementById('pass')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Password');
    });

    it('falls back to wrapping label', () => {
      document.body.innerHTML = `
        <label>Phone Number
          <input id="phone" type="tel" />
        </label>
      `;
      const el = document.getElementById('phone')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Phone Number');
    });

    it('falls back to title attribute', () => {
      document.body.innerHTML =
        '<input id="x" type="text" title="Employee ID" />';
      const el = document.getElementById('x')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Employee ID');
    });

    it('falls back to textContent for buttons', () => {
      document.body.innerHTML =
        '<button id="b">Submit Form</button>';
      const el = document.getElementById('b')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Submit Form');
    });

    it('falls back to placeholder', () => {
      document.body.innerHTML =
        '<input id="x" type="text" placeholder="Enter your name" />';
      const el = document.getElementById('x')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('Enter your name');
    });

    it('returns empty string when no name source', () => {
      document.body.innerHTML = '<div id="d"></div>';
      const el = document.getElementById('d')!;
      const id = extractIdentity(el);
      expect(id.accessibleName).toBe('');
    });
  });

  // ── Role Detection ────────────────────────────────────────────────

  describe('role detection', () => {
    it('detects explicit role', () => {
      document.body.innerHTML = '<div id="d" role="combobox"></div>';
      const el = document.getElementById('d')!;
      const id = extractIdentity(el);
      expect(id.ariaRole).toBe('combobox');
    });

    it('infers button role from <button> tag', () => {
      document.body.innerHTML = '<button id="b">Go</button>';
      const el = document.getElementById('b')!;
      const id = extractIdentity(el);
      expect(id.ariaRole).toBe('button');
    });

    it('infers textbox role from <input type="text">', () => {
      document.body.innerHTML = '<input id="t" type="text" />';
      const el = document.getElementById('t')!;
      const id = extractIdentity(el);
      expect(id.ariaRole).toBe('textbox');
    });

    it('infers link role from <a>', () => {
      document.body.innerHTML = '<a id="l" href="#">Link</a>';
      const el = document.getElementById('l')!;
      const id = extractIdentity(el);
      expect(id.ariaRole).toBe('link');
    });

    it('infers checkbox role from <input type="checkbox">', () => {
      document.body.innerHTML = '<input id="c" type="checkbox" />';
      const el = document.getElementById('c')!;
      const id = extractIdentity(el);
      expect(id.ariaRole).toBe('checkbox');
    });

    it('infers radio role from <input type="radio">', () => {
      document.body.innerHTML = '<input id="r" type="radio" name="grp" />';
      const el = document.getElementById('r')!;
      const id = extractIdentity(el);
      expect(id.ariaRole).toBe('radio');
    });
  });

  // ── Selector Generation ───────────────────────────────────────────

  describe('CSS selector generation', () => {
    it('uses id when present', () => {
      document.body.innerHTML = '<button id="login-btn">Login</button>';
      const el = document.getElementById('login-btn')!;
      const id = extractIdentity(el);
      expect(id.cssSelector).toContain('#login-btn');
    });

    it('falls back to tag + class when no id', () => {
      document.body.innerHTML = '<button class="oxd-button oxd-button--main">Login</button>';
      const el = document.querySelector('.oxd-button')!;
      const id = extractIdentity(el);
      expect(id.cssSelector).toContain('button');
    });

    it('falls back to nth-of-type path', () => {
      document.body.innerHTML = '<div><div><div></div></div></div>';
      const el = document.querySelectorAll('div')[2]!;
      const id = extractIdentity(el);
      expect(id.cssSelector).toBeTruthy();
    });
  });

  // ── Value / Checked State ─────────────────────────────────────────

  describe('captureValue', () => {
    it('captures text input value', () => {
      document.body.innerHTML = '<input id="t" type="text" value="hello" />';
      const el = document.getElementById('t') as HTMLInputElement;
      expect(captureValue(el)).toBe('hello');
    });

    it('captures select value', () => {
      document.body.innerHTML = '<select id="s"><option value="a">A</option><option value="b" selected>B</option></select>';
      const el = document.getElementById('s') as HTMLSelectElement;
      expect(captureValue(el)).toBe('B');
    });

    it('captures textarea value', () => {
      document.body.innerHTML = '<textarea id="ta">multi\nline</textarea>';
      const el = document.getElementById('ta') as HTMLTextAreaElement;
      expect(captureValue(el)).toBe('multi\nline');
    });

    it('returns undefined for non-form elements', () => {
      document.body.innerHTML = '<div id="d">text</div>';
      const el = document.getElementById('d')!;
      expect(captureValue(el)).toBeUndefined();
    });
  });

  describe('captureCheckedState', () => {
    it('captures checkbox checked state', () => {
      document.body.innerHTML = '<input id="c" type="checkbox" checked />';
      const el = document.getElementById('c') as HTMLInputElement;
      expect(captureCheckedState(el)).toBe(true);
    });

    it('captures unchecked state', () => {
      document.body.innerHTML = '<input id="c" type="checkbox" />';
      const el = document.getElementById('c') as HTMLInputElement;
      expect(captureCheckedState(el)).toBe(false);
    });

    it('returns undefined for non-checkable elements', () => {
      document.body.innerHTML = '<div id="d"></div>';
      const el = document.getElementById('d')!;
      expect(captureCheckedState(el)).toBeUndefined();
    });
  });

  // ── Target Resolution ─────────────────────────────────────────────

  describe('resolveTarget', () => {
    it('returns event target for regular elements', () => {
      document.body.innerHTML = '<button id="b">Click</button>';
      const btn = document.getElementById('b')!;
      const fakeEvent = { target: btn, composedPath: () => [btn] } as any;
      const resolved = resolveTarget(fakeEvent);
      expect(resolved).toBe(btn);
    });

    it('returns null for null/undefined event', () => {
      expect(resolveTarget(null as any)).toBeNull();
      expect(resolveTarget(undefined as any)).toBeNull();
    });
  });
});
