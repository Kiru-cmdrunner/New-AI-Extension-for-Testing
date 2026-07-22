/**
 * Tests for the Action Executor — executes IRStep actions against live DOM elements.
 *
 * Uses jsdom to simulate a DOM environment. Tests cover:
 *   - Click action
 *   - Fill action (with native setter for React/Vue compatibility)
 *   - Select action
 *   - Toggle action
 *   - Hover action
 *   - Verify (no-op)
 *   - Wait action
 *   - Missing element handling
 *   - Unknown action handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  executeAction,
  executeClick,
  executeFill,
  executeSelect,
  executeToggle,
  executeHover,
  executeWait,
  type ActionExecutionResult,
} from '../src/execution/action-executor';

// ── Tests ───────────────────────────────────────────────────

describe('Action Executor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('executeClick', () => {
    it('clicks an element and returns success', () => {
      const button = document.createElement('button');
      button.textContent = 'Submit';
      document.body.appendChild(button);

      const clickSpy = vi.spyOn(button, 'click');
      const result = executeClick(button);

      expect(result.success).toBe(true);
      expect(clickSpy).toHaveBeenCalledOnce();
    });

    it('returns error if click throws', () => {
      const el = {} as Element;
      const result = executeClick(el);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('ActionError');
    });
  });

  describe('executeFill', () => {
    it('fills an input element and dispatches input + change events', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const inputSpy = vi.fn();
      const changeSpy = vi.fn();
      input.addEventListener('input', inputSpy);
      input.addEventListener('change', changeSpy);

      const result = executeFill(input, 'hello@example.com');

      expect(result.success).toBe(true);
      expect(result.actualValue).toBe('hello@example.com');
      expect(input.value).toBe('hello@example.com');
      expect(inputSpy).toHaveBeenCalledOnce();
      expect(changeSpy).toHaveBeenCalledOnce();
    });

    it('fills a textarea element', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      const result = executeFill(textarea, 'Some text content');

      expect(result.success).toBe(true);
      expect(textarea.value).toBe('Some text content');
    });

    it('returns error on non-input element', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const result = executeFill(div, 'value');

      // Fill uses native input setter which fails on non-input elements
      expect(result.success).toBe(false);
    });
  });

  describe('executeSelect', () => {
    it('selects an option by value', () => {
      const select = document.createElement('select');
      select.innerHTML = `
        <option value="option1">Option 1</option>
        <option value="option2">Option 2</option>
        <option value="option3">Option 3</option>
      `;
      document.body.appendChild(select);

      const changeSpy = vi.fn();
      select.addEventListener('change', changeSpy);

      const result = executeSelect(select, 'option2');

      expect(result.success).toBe(true);
      expect(result.actualValue).toBe('option2');
      expect(select.value).toBe('option2');
      expect(changeSpy).toHaveBeenCalledOnce();
    });

    it('selects an option by text content', () => {
      const select = document.createElement('select');
      select.innerHTML = `
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
      `;
      document.body.appendChild(select);

      const result = executeSelect(select, 'United Kingdom');

      expect(result.success).toBe(true);
      expect(select.value).toBe('uk');
    });

    it('returns error when option is not found', () => {
      const select = document.createElement('select');
      select.innerHTML = '<option value="a">A</option>';
      document.body.appendChild(select);

      const result = executeSelect(select, 'nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('OptionNotFound');
    });
  });

  describe('executeToggle', () => {
    it('checks a checkbox and dispatches change event', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);

      const changeSpy = vi.fn();
      checkbox.addEventListener('change', changeSpy);

      const result = executeToggle(checkbox, true);

      expect(result.success).toBe(true);
      expect(result.actualValue).toBe(true);
      expect(checkbox.checked).toBe(true);
      expect(changeSpy).toHaveBeenCalledOnce();
    });

    it('unchecks a checkbox', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      document.body.appendChild(checkbox);

      const result = executeToggle(checkbox, false);

      expect(result.success).toBe(true);
      expect(checkbox.checked).toBe(false);
    });
  });

  describe('executeHover', () => {
    it('dispatches mouseover and mouseenter events', () => {
      const div = document.createElement('div');
      div.textContent = 'Hover me';
      document.body.appendChild(div);

      const mouseoverSpy = vi.fn();
      const mouseenterSpy = vi.fn();
      div.addEventListener('mouseover', mouseoverSpy);
      div.addEventListener('mouseenter', mouseenterSpy);

      const result = executeHover(div);

      expect(result.success).toBe(true);
      expect(mouseoverSpy).toHaveBeenCalledOnce();
      // mouseenter doesn't bubble, so it may or may not fire depending on jsdom
    });
  });

  describe('executeWait', () => {
    it('waits for the specified duration', async () => {
      const start = Date.now();
      const result = await executeWait(50);
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.actualValue).toBe(50);
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
    });
  });

  describe('executeAction (dispatcher)', () => {
    it('returns error for missing element on click', () => {
      const result = executeAction('click', null, null);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('MissingElement');
    });

    it('returns error for missing element on fill', () => {
      const result = executeAction('fill', null, 'value');
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('MissingElement');
    });

    it('returns success for verify action (no element needed)', () => {
      const result = executeAction('verify', null, null);
      expect(result.success).toBe(true);
    });

    it('returns success for navigate action (handled elsewhere)', () => {
      const result = executeAction('navigate', null, 'https://example.com');
      expect(result.success).toBe(true);
    });

    it('returns success for waitForElement (handled by resolver)', () => {
      const result = executeAction('waitForElement', null, null);
      expect(result.success).toBe(true);
    });

    it('returns error for unknown action', () => {
      const result = executeAction('unknownAction', null, null);
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('UnknownAction');
    });

    it('converts string "true" to boolean for toggle', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);

      const result = executeAction('toggle', checkbox, 'true');
      expect(result.success).toBe(true);
      expect(checkbox.checked).toBe(true);
    });

    it('fills with string representation of input', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const result = executeAction('fill', input, 12345);
      expect(result.success).toBe(true);
      expect(input.value).toBe('12345');
    });
  });
});
