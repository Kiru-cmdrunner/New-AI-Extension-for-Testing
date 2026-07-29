/**
 * Identity Extractor Tests — Phase 3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractTargetIdentity,
  captureValue,
  captureCheckedState,
} from '../../../../src/pipeline/tap/identity-extractor';

describe('Identity Extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('extractTargetIdentity', () => {
    it('should extract tag name', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      const identity = extractTargetIdentity(btn);
      expect(identity.tag).toBe('BUTTON');
    });

    it('should extract ARIA role', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'combobox');
      document.body.appendChild(div);
      const identity = extractTargetIdentity(div);
      expect(identity.ariaRole).toBe('combobox');
    });

    it('should extract implicit role for button', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);
      const identity = extractTargetIdentity(btn);
      expect(identity.ariaRole).toBe('button');
    });

    it('should extract accessible name from aria-label', () => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Submit Form');
      document.body.appendChild(btn);
      const identity = extractTargetIdentity(btn);
      expect(identity.accessibleName).toBe('Submit Form');
    });

    it('should extract ARIA state attributes', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'combobox');
      div.setAttribute('aria-expanded', 'true');
      div.setAttribute('aria-haspopup', 'listbox');
      document.body.appendChild(div);
      const identity = extractTargetIdentity(div);
      expect(identity.ariaExpanded).toBe(true);
      expect(identity.ariaHasPopup).toBe('listbox');
    });

    it('should extract input type', () => {
      const input = document.createElement('input');
      input.type = 'email';
      document.body.appendChild(input);
      const identity = extractTargetIdentity(input);
      expect(identity.inputType).toBe('email');
    });

    it('should extract locators including testId', () => {
      const div = document.createElement('div');
      div.setAttribute('data-testid', 'login-btn');
      document.body.appendChild(div);
      const identity = extractTargetIdentity(div);
      const testIdLocator = identity.locators.find(l => l.kind === 'testId');
      expect(testIdLocator).toBeDefined();
      expect(testIdLocator!.value).toBe('login-btn');
      expect(identity.primaryLocator.kind).toBe('testId');
    });

    it('should set primary locator to highest-confidence', () => {
      const input = document.createElement('input');
      input.id = 'email';
      input.setAttribute('aria-label', 'Email');
      document.body.appendChild(input);
      const identity = extractTargetIdentity(input);
      // aria-label (0.85) vs id (0.9) — id should win
      expect(identity.primaryLocator.kind).toBe('id');
    });

    it('should detect Shadow DOM', () => {
      // Can't create real ShadowRoot in JSDOM, but test the function exists
      const div = document.createElement('div');
      document.body.appendChild(div);
      const identity = extractTargetIdentity(div);
      expect(identity.inShadowDom).toBe(false);
    });

    it('should detect iframe context', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const identity = extractTargetIdentity(div);
      // In test env, window === window.top
      expect(identity.inIframe).toBe(false);
      expect(identity.frameContext).toBeNull();
    });

    it('should extract contentEditable flag', () => {
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      document.body.appendChild(div);
      const identity = extractTargetIdentity(div);
      expect(identity.isContentEditable).toBe(true);
    });
  });

  describe('captureValue', () => {
    it('should capture input value', () => {
      const input = document.createElement('input');
      input.value = 'hello@example.com';
      document.body.appendChild(input);
      expect(captureValue(input)).toBe('hello@example.com');
    });

    it('should capture textarea value', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'Long text';
      document.body.appendChild(textarea);
      expect(captureValue(textarea)).toBe('Long text');
    });

    it('should capture select selected option', () => {
      const select = document.createElement('select');
      const opt1 = document.createElement('option');
      opt1.value = 'a';
      opt1.textContent = 'Option A';
      const opt2 = document.createElement('option');
      opt2.value = 'b';
      opt2.textContent = 'Option B';
      select.appendChild(opt1);
      select.appendChild(opt2);
      select.selectedIndex = 1;
      document.body.appendChild(select);
      expect(captureValue(select)).toBe('Option B');
    });

    it('should capture aria-valuenow', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'slider');
      div.setAttribute('aria-valuenow', '50');
      document.body.appendChild(div);
      expect(captureValue(div)).toBe('50');
    });

    it('should return undefined for element without value', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(captureValue(div)).toBeUndefined();
    });
  });

  describe('captureCheckedState', () => {
    it('should capture native checkbox checked', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      document.body.appendChild(checkbox);
      expect(captureCheckedState(checkbox)).toBe(true);
    });

    it('should capture native checkbox unchecked', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      document.body.appendChild(checkbox);
      expect(captureCheckedState(checkbox)).toBe(false);
    });

    it('should capture aria-checked', () => {
      const div = document.createElement('div');
      div.setAttribute('aria-checked', 'true');
      document.body.appendChild(div);
      expect(captureCheckedState(div)).toBe(true);
    });

    it('should capture aria-pressed', () => {
      const div = document.createElement('div');
      div.setAttribute('aria-pressed', 'true');
      document.body.appendChild(div);
      expect(captureCheckedState(div)).toBe(true);
    });

    it('should return undefined for element without checked state', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      expect(captureCheckedState(div)).toBeUndefined();
    });

    it('should detect MUI checked class', () => {
      const div = document.createElement('div');
      div.className = 'Mui-checked custom-checkbox';
      document.body.appendChild(div);
      expect(captureCheckedState(div)).toBe(true);
    });
  });
});
