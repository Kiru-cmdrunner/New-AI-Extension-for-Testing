/**
 * Target Resolver Tests — Phase 3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTarget, NON_INTERACTIVE_TAGS } from '../../../../src/pipeline/tap/target-resolver';

describe('Target Resolver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return null for null event', () => {
    expect(resolveTarget(null)).toBeNull();
  });

  it('should return null for undefined event', () => {
    expect(resolveTarget(undefined)).toBeNull();
  });

  it('should resolve a button target via composedPath', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Click';
    document.body.appendChild(btn);
    const event = new MouseEvent('click', { bubbles: true });
    btn.dispatchEvent(event);
    const target = resolveTarget(event);
    expect(target).toBe(btn);
  });

  it('should resolve interactive element inside a wrapper div', () => {
    const wrapper = document.createElement('div');
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Link';
    wrapper.appendChild(link);
    document.body.appendChild(wrapper);
    const event = new MouseEvent('click', { bubbles: true });
    link.dispatchEvent(event);
    const target = resolveTarget(event);
    expect(target).toBe(link);
  });

  it('should resolve via clickable heuristic (cursor:pointer)', () => {
    const div = document.createElement('div');
    div.style.cursor = 'pointer';
    div.textContent = 'Clickable';
    document.body.appendChild(div);
    const event = new MouseEvent('click', { bubbles: true });
    div.dispatchEvent(event);
    const target = resolveTarget(event);
    // Should find the div via clickable heuristic
    expect(target).not.toBeNull();
  });

  it('should resolve via ARIA role', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    div.textContent = 'Custom Button';
    document.body.appendChild(div);
    const event = new MouseEvent('click', { bubbles: true });
    div.dispatchEvent(event);
    const target = resolveTarget(event);
    expect(target).toBe(div);
  });

  it('should resolve via tabindex', () => {
    const div = document.createElement('div');
    div.setAttribute('tabindex', '0');
    document.body.appendChild(div);
    const event = new MouseEvent('click', { bubbles: true });
    div.dispatchEvent(event);
    const target = resolveTarget(event);
    expect(target).toBe(div);
  });

  it('should resolve parent interactive element when clicking child', () => {
    const btn = document.createElement('button');
    const span = document.createElement('span');
    span.textContent = 'Inner text';
    btn.appendChild(span);
    document.body.appendChild(btn);
    const event = new MouseEvent('click', { bubbles: true });
    span.dispatchEvent(event);
    const target = resolveTarget(event);
    expect(target).toBe(btn);
  });

  it('should include structural tags in NON_INTERACTIVE_TAGS', () => {
    expect(NON_INTERACTIVE_TAGS.has('BODY')).toBe(true);
    expect(NON_INTERACTIVE_TAGS.has('HTML')).toBe(true);
    expect(NON_INTERACTIVE_TAGS.has('SCRIPT')).toBe(true);
    expect(NON_INTERACTIVE_TAGS.has('SVG')).toBe(true);
    expect(NON_INTERACTIVE_TAGS.has('PATH')).toBe(true);
    expect(NON_INTERACTIVE_TAGS.has('BUTTON')).toBe(false);
  });

  it('should return raw target for non-interactive but not structural elements', () => {
    const div = document.createElement('div');
    div.textContent = 'Plain';
    document.body.appendChild(div);
    const event = new MouseEvent('click', { bubbles: true });
    div.dispatchEvent(event);
    const target = resolveTarget(event);
    // div is not structural, not interactive — should return raw target
    expect(target).toBe(div);
  });
});
