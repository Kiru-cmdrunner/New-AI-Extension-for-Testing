/**
 * Phase 3 — State Tracker unit tests
 *
 * Tests the pure helper functions extracted from StateTracker.
 * These run in jsdom (configured in vite.config.ts) so DOM APIs are available.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isVisible,
  computeAccessibleName,
  describeElement,
  findOpenDialogs,
  findOpenDropdowns,
  findActiveForm,
  describeActiveElement,
  computeDeterministicState,
  isRelevantMutation,
  StateTracker,
} from '../src/recorder/context/state-tracker';
import type { DeterministicState } from '../src/shared/architecture-types';

// ── isVisible ──────────────────────────────────────────────────────────

describe('isVisible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns true for a visible div', () => {
    const div = document.createElement('div');
    div.style.width = '100px';
    div.style.height = '50px';
    document.body.appendChild(div);
    expect(isVisible(div)).toBe(true);
  });

  it('returns false for element with display:none', () => {
    const div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    expect(isVisible(div)).toBe(false);
  });

  it('returns false for element with [hidden]', () => {
    const div = document.createElement('div');
    div.hidden = true;
    document.body.appendChild(div);
    expect(isVisible(div)).toBe(false);
  });

  it('returns false for element with aria-hidden="true"', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-hidden', 'true');
    div.style.width = '100px';
    div.style.height = '50px';
    document.body.appendChild(div);
    expect(isVisible(div)).toBe(false);
  });

  it('returns false for disconnected element', () => {
    const div = document.createElement('div');
    // not appended to document
    expect(isVisible(div)).toBe(false);
  });

  it('returns true for <option> elements', () => {
    const select = document.createElement('select');
    const opt = document.createElement('option');
    opt.textContent = 'Choice';
    select.appendChild(opt);
    document.body.appendChild(select);
    expect(isVisible(opt)).toBe(true);
  });
});

// ── computeAccessibleName ──────────────────────────────────────────────

describe('computeAccessibleName', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns aria-label when present', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Close dialog');
    document.body.appendChild(btn);
    expect(computeAccessibleName(btn)).toBe('Close dialog');
  });

  it('returns aria-labelledby target text', () => {
    const label = document.createElement('span');
    label.id = 'lbl1';
    label.textContent = 'Email Address';
    document.body.appendChild(label);

    const input = document.createElement('input');
    input.setAttribute('aria-labelledby', 'lbl1');
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Email Address');
  });

  it('returns label[for] text', () => {
    const label = document.createElement('label');
    label.setAttribute('for', 'email');
    label.textContent = 'Email';
    document.body.appendChild(label);

    const input = document.createElement('input');
    input.id = 'email';
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Email');
  });

  it('returns wrapping label text', () => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    label.appendChild(document.createTextNode('Username'));
    label.appendChild(input);
    document.body.appendChild(label);
    expect(computeAccessibleName(input)).toBe('Username');
  });

  it('returns textContent for elements with text', () => {
    const btn = document.createElement('button');
    btn.textContent = '  Submit  ';
    document.body.appendChild(btn);
    expect(computeAccessibleName(btn)).toBe('Submit');
  });

  it('returns title when no other name source', () => {
    const div = document.createElement('div');
    div.setAttribute('title', 'Help tooltip');
    document.body.appendChild(div);
    expect(computeAccessibleName(div)).toBe('Help tooltip');
  });

  it('returns placeholder for input with no other name', () => {
    const input = document.createElement('input');
    input.placeholder = 'Enter your name';
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Enter your name');
  });

  it('returns empty string for unnamed div', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(computeAccessibleName(div)).toBe('');
  });

  it('truncates long text content to 200 chars', () => {
    const div = document.createElement('div');
    div.textContent = 'x'.repeat(300);
    document.body.appendChild(div);
    expect(computeAccessibleName(div).length).toBe(200);
  });
});

// ── describeElement ────────────────────────────────────────────────────

describe('describeElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('describes a button with text', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    btn.className = 'btn-primary';
    document.body.appendChild(btn);
    const desc = describeElement(btn);
    expect(desc).toEqual({
      tag: 'button',
      role: null,
      accessibleName: 'Submit',
      className: 'btn-primary',
    });
  });

  it('describes an element with explicit role', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-label', 'Settings');
    document.body.appendChild(div);
    const desc = describeElement(div);
    expect(desc).toEqual({
      tag: 'div',
      role: 'dialog',
      accessibleName: 'Settings',
      className: null,
    });
  });

  it('returns null for null input', () => {
    expect(describeElement(null)).toBeNull();
  });
});

// ── findOpenDialogs ────────────────────────────────────────────────────

describe('findOpenDialogs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds a visible role="dialog" element', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Confirmation');
    dialog.style.width = '200px';
    dialog.style.height = '100px';
    document.body.appendChild(dialog);
    const dialogs = findOpenDialogs(document);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].accessibleName).toBe('Confirmation');
    expect(dialogs[0].role).toBe('dialog');
  });

  it('filters out hidden dialogs', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.display = 'none';
    document.body.appendChild(dialog);
    expect(findOpenDialogs(document)).toHaveLength(0);
  });

  it('returns empty array when no dialogs present', () => {
    document.body.innerHTML = '<div>Hello world</div>';
    expect(findOpenDialogs(document)).toEqual([]);
  });

  it('finds aria-modal="true" elements', () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Warning');
    modal.style.width = '100px';
    modal.style.height = '100px';
    document.body.appendChild(modal);
    const dialogs = findOpenDialogs(document);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].accessibleName).toBe('Warning');
  });
});

// ── findOpenDropdowns ──────────────────────────────────────────────────

describe('findOpenDropdowns', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds an element with aria-expanded="true"', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Options';
    btn.style.width = '100px';
    btn.style.height = '30px';
    document.body.appendChild(btn);
    const dropdowns = findOpenDropdowns(document);
    expect(dropdowns).toHaveLength(1);
    expect(dropdowns[0].accessibleName).toBe('Options');
  });

  it('filters out elements with aria-expanded="false"', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = 'Options';
    btn.style.width = '100px';
    btn.style.height = '30px';
    document.body.appendChild(btn);
    expect(findOpenDropdowns(document)).toHaveLength(0);
  });

  it('finds visible role="listbox" elements', () => {
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', 'Country list');
    listbox.style.width = '200px';
    listbox.style.height = '200px';
    document.body.appendChild(listbox);
    const dropdowns = findOpenDropdowns(document);
    expect(dropdowns).toHaveLength(1);
    expect(dropdowns[0].accessibleName).toBe('Country list');
  });

  it('filters out hidden listboxes', () => {
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.hidden = true;
    document.body.appendChild(listbox);
    expect(findOpenDropdowns(document)).toHaveLength(0);
  });
});

// ── findActiveForm ─────────────────────────────────────────────────────

describe('findActiveForm', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns form descriptor when focused element is inside a form', () => {
    const form = document.createElement('form');
    form.id = 'login-form';
    form.className = 'form-vertical';
    const input = document.createElement('input');
    input.type = 'email';
    input.placeholder = 'Email';
    form.appendChild(input);
    document.body.appendChild(form);

    input.focus();

    const activeForm = findActiveForm(document);
    expect(activeForm).not.toBeNull();
    expect(activeForm!.tag).toBe('form');
    expect(activeForm!.className).toBe('form-vertical');
  });

  it('returns null when focused element is outside any form', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    expect(findActiveForm(document)).toBeNull();
  });

  it('returns null when document.body is active (no focus)', () => {
    document.body.innerHTML = '<div>content</div>';
    expect(findActiveForm(document)).toBeNull();
  });
});

// ── describeActiveElement ──────────────────────────────────────────────

describe('describeActiveElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('describes the currently focused element', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Click Me';
    document.body.appendChild(btn);
    btn.focus();

    const desc = describeActiveElement(document);
    expect(desc).not.toBeNull();
    expect(desc!.tag).toBe('button');
    expect(desc!.accessibleName).toBe('Click Me');
  });

  it('returns null when body is active', () => {
    expect(describeActiveElement(document)).toBeNull();
  });
});

// ── computeDeterministicState ──────────────────────────────────────────

describe('computeDeterministicState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns a complete state snapshot', () => {
    // Set up a page with a dialog and a focused input
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Test Dialog');
    dialog.style.width = '200px';
    dialog.style.height = '100px';
    document.body.appendChild(dialog);

    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name';
    form.appendChild(input);
    document.body.appendChild(form);

    input.focus();

    const state = computeDeterministicState(document);
    expect(state.currentUrl).toBe(window.location.href);
    expect(state.openDialogs).toHaveLength(1);
    expect(state.openDialogs[0].accessibleName).toBe('Test Dialog');
    expect(state.activeForm).not.toBeNull();
    expect(state.activeElement).not.toBeNull();
    expect(state.activeElement!.tag).toBe('input');
  });

  it('returns empty arrays for pages with no dialogs or dropdowns', () => {
    document.body.innerHTML = '<p>Hello</p>';
    const state = computeDeterministicState(document);
    expect(state.openDialogs).toEqual([]);
    expect(state.openDropdowns).toEqual([]);
    expect(state.activeForm).toBeNull();
    expect(state.activeElement).toBeNull();
  });
});

// ── isRelevantMutation ─────────────────────────────────────────────────

describe('isRelevantMutation', () => {
  function mockMutation(
    type: string,
    attrName?: string,
    added = 0,
    removed = 0,
  ): MutationRecord {
    const addedNodes: Node[] = [];
    const removedNodes: Node[] = [];
    for (let i = 0; i < added; i++) addedNodes.push(document.createTextNode('x'));
    for (let i = 0; i < removed; i++) removedNodes.push(document.createTextNode('x'));

    return {
      type,
      attributeName: attrName ?? null,
      oldValue: null,
      addedNodes: addedNodes as unknown as NodeList,
      removedNodes: removedNodes as unknown as NodeList,
      target: document.body,
      previousSibling: null,
      nextSibling: null,
    } as unknown as MutationRecord;
  }

  it('marks aria-expanded attribute change as relevant', () => {
    const m = mockMutation('attributes', 'aria-expanded');
    expect(isRelevantMutation([m])).toBe(true);
  });

  it('marks style attribute change as relevant', () => {
    const m = mockMutation('attributes', 'style');
    expect(isRelevantMutation([m])).toBe(true);
  });

  it('marks class attribute change as relevant', () => {
    const m = mockMutation('attributes', 'class');
    expect(isRelevantMutation([m])).toBe(true);
  });

  it('marks childList with added nodes as relevant', () => {
    const m = mockMutation('childList', undefined, 1, 0);
    expect(isRelevantMutation([m])).toBe(true);
  });

  it('marks childList with removed nodes as relevant', () => {
    const m = mockMutation('childList', undefined, 0, 1);
    expect(isRelevantMutation([m])).toBe(true);
  });

  it('does NOT mark childList with no nodes added/removed as relevant', () => {
    const m = mockMutation('childList', undefined, 0, 0);
    expect(isRelevantMutation([m])).toBe(false);
  });

  it('does NOT mark irrelevant attribute changes (e.g. data-id) as relevant', () => {
    const m = mockMutation('attributes', 'data-id');
    expect(isRelevantMutation([m])).toBe(false);
  });

  it('does NOT mark characterData changes as relevant', () => {
    const m = mockMutation('characterData');
    expect(isRelevantMutation([m])).toBe(false);
  });

  it('returns true if ANY mutation in a batch is relevant', () => {
    const m1 = mockMutation('characterData');
    const m2 = mockMutation('attributes', 'aria-expanded');
    expect(isRelevantMutation([m1, m2])).toBe(true);
  });
});

// ── StateTracker class ─────────────────────────────────────────────────

describe('StateTracker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('computes initial state on start', () => {
    const tracker = new StateTracker();
    let emittedState: DeterministicState | null = null;
    tracker.onEmit((state) => {
      emittedState = state;
    });

    tracker.start();

    expect(emittedState).not.toBeNull();
    expect(emittedState!.currentUrl).toBe(window.location.href);
    tracker.stop();
  });

  it('emits state on navigation', () => {
    const tracker = new StateTracker();
    const emitted: DeterministicState[] = [];
    tracker.onEmit((state) => emitted.push(state));

    tracker.start();
    expect(emitted).toHaveLength(1);

    tracker.onNavigation('http://example.com/new', 'New Page');
    expect(emitted).toHaveLength(2);
    expect(emitted[1].pageTitle).toBe('New Page');

    tracker.stop();
  });

  it('getState() returns null before start', () => {
    const tracker = new StateTracker();
    expect(tracker.getState()).toBeNull();
  });

  it('getState() returns current state after start', () => {
    const tracker = new StateTracker();
    tracker.start();

    const state = tracker.getState();
    expect(state).not.toBeNull();
    expect(state!.currentUrl).toBe(window.location.href);

    tracker.stop();
  });

  it('clears state on stop', () => {
    const tracker = new StateTracker();
    tracker.start();
    expect(tracker.getState()).not.toBeNull();

    tracker.stop();
    expect(tracker.getState()).toBeNull();
  });

  it('does not throw when callback is not set', () => {
    const tracker = new StateTracker();
    // Should not throw
    tracker.start();
    tracker.onNavigation('http://example.com', 'Title');
    tracker.stop();
  });
});
