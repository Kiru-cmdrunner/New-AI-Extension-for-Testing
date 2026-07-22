/**
 * Tests for the Locator Resolver — resolves ResolvedLocator[] against live DOM.
 *
 * Uses jsdom to simulate a DOM environment. Tests cover:
 *   - Each locator strategy (testId, accessibleName, role, text, label, css, xpath)
 *   - Priority ordering (highest priority tried first)
 *   - Visibility filtering
 *   - Fallback to next locator when first fails
 *   - Empty locator array
 *   - Invalid CSS selectors
 *   - Element identity extraction (for runtime healing)
 *   - Wait strategy polling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveElement,
  isElementVisible,
  extractElementIdentity,
  type LocatorInput,
} from '../src/execution/locator-resolver';

// ── Test Helpers ────────────────────────────────────────────

function setupDom(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

function makeLocator(type: string, value: string, priority: number = 1): LocatorInput {
  return { type, value, priority, confidence: 0.9 };
}

// ── Tests ───────────────────────────────────────────────────

describe('Locator Resolver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('resolveElement', () => {
    it('resolves by testId (data-testid)', () => {
      setupDom('<button data-testid="submit-btn">Submit</button>');
      const result = resolveElement([makeLocator('testId', 'submit-btn')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('BUTTON');
      expect(result?.matchedLocator.type).toBe('testId');
    });

    it('resolves by testId (data-cy)', () => {
      setupDom('<input data-cy="email-field" type="email" />');
      const result = resolveElement([makeLocator('testId', 'email-field')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('INPUT');
    });

    it('resolves by testId (data-qa)', () => {
      setupDom('<div data-qa="container">Content</div>');
      const result = resolveElement([makeLocator('testId', 'container')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('DIV');
    });

    it('resolves by accessibleName (aria-label)', () => {
      setupDom('<button aria-label="Close">X</button>');
      const result = resolveElement([makeLocator('accessibleName', 'Close')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('BUTTON');
    });

    it('resolves by role', () => {
      setupDom('<div role="navigation">Nav</div>');
      const result = resolveElement([makeLocator('role', 'navigation')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.getAttribute('role')).toBe('navigation');
    });

    it('resolves by text content', () => {
      setupDom('<button>Submit Order</button>');
      const result = resolveElement([makeLocator('text', 'Submit Order')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('BUTTON');
    });

    it('resolves by label (label[for])', () => {
      setupDom('<label for="username">Username</label><input id="username" type="text" />');
      const result = resolveElement([makeLocator('label', 'username')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('INPUT');
      expect(result?.element.id).toBe('username');
    });

    it('resolves by label (name attribute)', () => {
      setupDom('<input name="email" type="email" />');
      const result = resolveElement([makeLocator('label', 'email')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('INPUT');
    });

    it('resolves by label (placeholder)', () => {
      setupDom('<input placeholder="Enter your name" type="text" />');
      const result = resolveElement([makeLocator('label', 'Enter your name')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('INPUT');
    });

    it('resolves by CSS selector', () => {
      setupDom('<div class="container"><button id="btn">Click</button></div>');
      const result = resolveElement([makeLocator('css', '#btn')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('BUTTON');
    });

    it('resolves by CSS class selector', () => {
      setupDom('<div class="submit-btn">Submit</div>');
      const result = resolveElement([makeLocator('css', '.submit-btn')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('DIV');
    });

    it('resolves by XPath', () => {
      setupDom('<div><button id="target">Click Me</button></div>');
      const result = resolveElement(
        [makeLocator('xpath', '//button[@id="target"]')],
        document,
        false,
      );
      expect(result).not.toBeNull();
      expect(result?.element.tagName).toBe('BUTTON');
    });

    it('returns null when no locator matches', () => {
      setupDom('<div>No matching element</div>');
      const result = resolveElement([makeLocator('testId', 'nonexistent')], document, false);
      expect(result).toBeNull();
    });

    it('returns null for empty locator array', () => {
      setupDom('<div>Content</div>');
      const result = resolveElement([], document, false);
      expect(result).toBeNull();
    });

    it('tries locators in priority order (1 = highest, tried first)', () => {
      setupDom('<button data-testid="btn-1" id="btn-2">Button</button>');
      // CSS has priority 1, testId has priority 2 → CSS tried first
      const locators = [
        makeLocator('css', '#btn-2', 1),
        makeLocator('testId', 'btn-1', 2),
      ];
      const result = resolveElement(locators, document, false);
      expect(result).not.toBeNull();
      expect(result?.matchedLocator.type).toBe('css');
      expect(result?.matchedLocator.value).toBe('#btn-2');
    });

    it('falls back to next locator when first fails', () => {
      setupDom('<button data-testid="real-btn">Submit</button>');
      const locators = [
        makeLocator('css', '#nonexistent', 1),
        makeLocator('testId', 'real-btn', 2),
      ];
      const result = resolveElement(locators, document, false);
      expect(result).not.toBeNull();
      expect(result?.matchedLocator.type).toBe('testId');
    });

    it('skips invisible elements when requireVisible is true', () => {
      setupDom('<div style="display:none" data-testid="hidden">Hidden</div>');
      const result = resolveElement([makeLocator('testId', 'hidden')], document, true);
      expect(result).toBeNull();
    });

    it('returns invisible elements when requireVisible is false', () => {
      setupDom('<div style="display:none" data-testid="hidden">Hidden</div>');
      const result = resolveElement([makeLocator('testId', 'hidden')], document, false);
      expect(result).not.toBeNull();
      expect(result?.visible).toBe(false);
    });

    it('handles invalid CSS selectors gracefully', () => {
      setupDom('<div>Content</div>');
      const result = resolveElement([makeLocator('css', '###invalid')], document, false);
      expect(result).toBeNull();
    });

    it('handles invalid XPath gracefully', () => {
      setupDom('<div>Content</div>');
      const result = resolveElement([makeLocator('xpath', '///invalid')], document, false);
      expect(result).toBeNull();
    });

    it('resolves multiple elements with same locator (returns first)', () => {
      setupDom(`
        <button data-testid="btn">First</button>
        <button data-testid="btn">Second</button>
      `);
      const result = resolveElement([makeLocator('testId', 'btn')], document, false);
      expect(result).not.toBeNull();
      expect(result?.element.textContent).toBe('First');
    });
  });

  describe('isElementVisible', () => {
    it('returns true for visible elements', () => {
      setupDom('<div style="display:block">Visible</div>');
      const el = document.querySelector('div')!;
      expect(isElementVisible(el)).toBe(true);
    });

    it('returns false for display:none', () => {
      setupDom('<div style="display:none">Hidden</div>');
      const el = document.querySelector('div')!;
      expect(isElementVisible(el)).toBe(false);
    });

    it('returns false for visibility:hidden', () => {
      setupDom('<div style="visibility:hidden">Hidden</div>');
      const el = document.querySelector('div')!;
      expect(isElementVisible(el)).toBe(false);
    });

    it('returns false for disconnected elements', () => {
      const el = document.createElement('div');
      expect(isElementVisible(el)).toBe(false);
    });
  });

  describe('extractElementIdentity', () => {
    it('extracts identity from a button with testId', () => {
      setupDom('<button data-testid="submit" aria-label="Submit Order">Submit</button>');
      const el = document.querySelector('button')!;
      const identity = extractElementIdentity(el);

      expect(identity.tag).toBe('BUTTON');
      expect(identity.testId).toBe('submit');
      expect(identity.ariaLabel).toBe('Submit Order');
      expect(identity.accessibleName).toBe('Submit Order');
    });

    it('extracts identity from an input with name and placeholder', () => {
      setupDom('<input name="email" placeholder="Enter email" type="email" />');
      const el = document.querySelector('input')!;
      const identity = extractElementIdentity(el);

      expect(identity.tag).toBe('INPUT');
      expect(identity.name).toBe('email');
      expect(identity.placeholder).toBe('Enter email');
      expect(identity.testId).toBeNull();
    });

    it('extracts identity from a div with role', () => {
      setupDom('<div role="navigation" id="main-nav">Nav</div>');
      const el = document.querySelector('div')!;
      const identity = extractElementIdentity(el);

      expect(identity.tag).toBe('DIV');
      expect(identity.role).toBe('navigation');
      expect(identity.id).toBe('main-nav');
      expect(identity.cssSelector).toBe('#main-nav');
    });

    it('extracts className', () => {
      setupDom('<button class="btn btn-primary" data-testid="btn">Click</button>');
      const el = document.querySelector('button')!;
      const identity = extractElementIdentity(el);

      expect(identity.className).toBe('btn btn-primary');
      expect(identity.testId).toBe('btn');
    });
  });
});
