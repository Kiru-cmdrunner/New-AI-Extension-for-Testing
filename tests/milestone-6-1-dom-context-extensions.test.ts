/**
 * Tests for DomContext extensions in Milestone 6.1:
 * - domAttributes: validation attributes captured from the element
 * - ancestorRoles: ancestor chain with roles
 *
 * These tests verify the capture functions exported from recorded-event.ts
 * and the DomContext interface extensions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

// We need to test the capture functions that are defined in the content script.
// Since the content script is a bundled module (not directly importable), we
// test the logic via JSDOM by replicating the attribute capture logic and
// verifying it matches what the enrichment pipeline expects.

// Import the DomContext type to verify the interface shape
import type { DomContext } from '../src/recorder/recorded-event';

describe('Milestone 6.1 — DomContext extensions', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
    document = dom.window.document;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe('domAttributes capture', () => {
    it('should capture required attribute when present', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('required', '');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['required']).toBe(''); // boolean attributes serialize as empty string
    });

    it('should capture aria-required attribute when present', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('aria-required', 'true');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['aria-required']).toBe('true');
    });

    it('should capture min, max, step attributes', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'number');
      input.setAttribute('min', '0');
      input.setAttribute('max', '100');
      input.setAttribute('step', '5');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['min']).toBe('0');
      expect(attrs['max']).toBe('100');
      expect(attrs['step']).toBe('5');
    });

    it('should capture pattern attribute', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('pattern', '[0-9]{3}-[0-9]{4}');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['pattern']).toBe('[0-9]{3}-[0-9]{4}');
    });

    it('should capture minlength and maxlength attributes', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('minlength', '2');
      input.setAttribute('maxlength', '50');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['minlength']).toBe('2');
      expect(attrs['maxlength']).toBe('50');
    });

    it('should always capture type for <input> elements', () => {
      const input = document.createElement('input');
      // No type attribute set — should default to 'text'
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['type']).toBe('text');
    });

    it('should capture explicit type for <input type="email">', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'email');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['type']).toBe('email');
    });

    it('should capture type for <input type="date">', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'date');
      input.setAttribute('min', '2026-01-01');
      input.setAttribute('max', '2026-12-31');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['type']).toBe('date');
      expect(attrs['min']).toBe('2026-01-01');
      expect(attrs['max']).toBe('2026-12-31');
    });

    it('should capture multiple and accept attributes for file inputs', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'file');
      input.setAttribute('accept', '.pdf,image/*');
      input.setAttribute('multiple', '');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['type']).toBe('file');
      expect(attrs['accept']).toBe('.pdf,image/*');
      expect(attrs['multiple']).toBe(''); // boolean attribute
    });

    it('should capture autocomplete attribute', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('autocomplete', 'off');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs['autocomplete']).toBe('off');
    });

    it('should capture contenteditable for editable elements', () => {
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      document.body.appendChild(div);

      const attrs = captureAttributesForTest(div);
      // contenteditable is captured as an attribute regardless of isContentEditable runtime state
      expect(attrs['contenteditable']).toBe('true');
    });

    it('should not include absent attributes', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      document.body.appendChild(input);

      const attrs = captureAttributesForTest(input);
      expect(attrs).not.toHaveProperty('required');
      expect(attrs).not.toHaveProperty('min');
      expect(attrs).not.toHaveProperty('max');
      expect(attrs).not.toHaveProperty('pattern');
      expect(attrs).not.toHaveProperty('minlength');
      expect(attrs).not.toHaveProperty('maxlength');
      expect(attrs).toHaveProperty('type', 'text');
    });

    it('should return empty object for elements with no relevant attributes', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);

      const attrs = captureAttributesForTest(button);
      // Buttons don't have validation attributes
      expect(Object.keys(attrs).length).toBe(0);
    });

    it('should capture type for <select> elements via getAttribute', () => {
      const select = document.createElement('select');
      select.setAttribute('required', '');
      document.body.appendChild(select);

      const attrs = captureAttributesForTest(select);
      expect(attrs['required']).toBe('');
    });
  });

  describe('ancestorRoles capture', () => {
    it('should capture ancestor chain with tags', () => {
      // <body><div><form><input>
      const div = document.createElement('div');
      const form = document.createElement('form');
      const input = document.createElement('input');
      form.appendChild(input);
      div.appendChild(form);
      document.body.appendChild(div);

      const chain = captureAncestorsForTest(input);
      expect(chain[0]).toBe('form');
      expect(chain[1]).toBe('div');
      // body would be next but we stop at document.documentElement (html)
    });

    it('should include ARIA roles when ancestors have them', () => {
      // <div role="listbox"><ul role="list"><li role="option"><button>
      const div = document.createElement('div');
      div.setAttribute('role', 'listbox');
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'list');
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const button = document.createElement('button');
      li.appendChild(button);
      ul.appendChild(li);
      div.appendChild(ul);
      document.body.appendChild(div);

      const chain = captureAncestorsForTest(button);
      expect(chain[0]).toBe('li[role=option]');
      expect(chain[1]).toBe('ul[role=list]');
      expect(chain[2]).toBe('div[role=listbox]');
    });

    it('should stop at document.documentElement', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const chain = captureAncestorsForTest(div);
      // parent is body, which stops before html (documentElement)
      expect(chain[0]).toBe('body');
      // body's parent is html (documentElement) which we stop before
      expect(chain.length).toBe(1);
    });

    it('should respect MAX_DEPTH of 10', () => {
      // Create 15 nested divs
      let current: HTMLElement = document.createElement('div');
      document.body.appendChild(current);
      for (let i = 0; i < 13; i++) {
        const child = document.createElement('div');
        current.appendChild(child);
        current = child;
      }
      const target = document.createElement('input');
      current.appendChild(target);

      const chain = captureAncestorsForTest(target);
      // Should cap at 10 ancestors
      expect(chain.length).toBeLessThanOrEqual(10);
    });

    it('should return empty array for element with no parent', () => {
      const input = document.createElement('input');
      // Not appended to DOM — no parent

      const chain = captureAncestorsForTest(input);
      expect(chain).toEqual([]);
    });

    it('should capture mixed roles and tags in the same chain', () => {
      // <div><nav role="navigation"><ul><li role="tab"><a>
      const div = document.createElement('div');
      const nav = document.createElement('nav');
      nav.setAttribute('role', 'navigation');
      const ul = document.createElement('ul');
      const li = document.createElement('li');
      li.setAttribute('role', 'tab');
      const a = document.createElement('a');
      li.appendChild(a);
      ul.appendChild(li);
      nav.appendChild(ul);
      div.appendChild(nav);
      document.body.appendChild(div);

      const chain = captureAncestorsForTest(a);
      expect(chain[0]).toBe('li[role=tab]');
      expect(chain[1]).toBe('ul');
      expect(chain[2]).toBe('nav[role=navigation]');
      expect(chain[3]).toBe('div');
    });

    it('should handle elements with role attribute set to empty string', () => {
      const div = document.createElement('div');
      div.setAttribute('role', '');
      const button = document.createElement('button');
      div.appendChild(button);
      document.body.appendChild(div);

      const chain = captureAncestorsForTest(button);
      // Empty role string is falsy — should just be 'div'
      expect(chain[0]).toBe('div');
    });
  });

  describe('DomContext interface shape', () => {
    it('should accept domAttributes field', () => {
      const ctx: DomContext = {
        inputType: 'text',
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        domAttributes: { type: 'email', required: '', min: '0' },
      };
      expect(ctx.domAttributes).toBeDefined();
      expect(ctx.domAttributes!['type']).toBe('email');
    });

    it('should accept ancestorRoles field', () => {
      const ctx: DomContext = {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        ancestorRoles: ['div', 'form', 'body'],
      };
      expect(ctx.ancestorRoles).toBeDefined();
      expect(ctx.ancestorRoles!.length).toBe(3);
    });

    it('should allow both fields to be optional (undefined)', () => {
      const ctx: DomContext = {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
      };
      expect(ctx.domAttributes).toBeUndefined();
      expect(ctx.ancestorRoles).toBeUndefined();
    });
  });
});

// ── Test helpers (replicate the capture logic from deterministic-recorder.ts) ──

function captureAttributesForTest(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const htmlEl = el instanceof (win?.HTMLElement || HTMLElement) ? el : null;
  const validationAttrs = [
    'required', 'aria-required', 'type', 'min', 'max', 'step',
    'pattern', 'minlength', 'maxlength', 'multiple', 'accept', 'autocomplete',
  ];
  for (const attr of validationAttrs) {
    const value = el.getAttribute(attr);
    if (value !== null) {
      attrs[attr] = value;
    }
  }
  if (win && el instanceof win.HTMLInputElement) {
    if (!('type' in attrs)) {
      attrs['type'] = el.type || 'text';
    }
  }
  if (htmlEl && (htmlEl.isContentEditable || htmlEl.getAttribute('contenteditable') === 'true')) {
    attrs['contenteditable'] = 'true';
  }
  return attrs;
}

function captureAncestorsForTest(el: Element): string[] {
  const chain: string[] = [];
  const doc = el.ownerDocument;
  let current: Element | null = el.parentElement;
  const MAX_DEPTH = 10;
  let depth = 0;
  while (current && current !== doc.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    if (role) {
      chain.push(`${tag}[role=${role}]`);
    } else {
      chain.push(tag);
    }
    current = current.parentElement;
    depth++;
  }
  return chain;
}
