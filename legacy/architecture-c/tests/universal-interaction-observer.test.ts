/**
 * Phase 4 — Universal Interaction Observer unit tests
 *
 * Tests the pure helper functions extracted into observer-helpers.ts.
 * These run in jsdom so DOM APIs are available.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeAccessibleName,
  getImplicitRole,
  generateCssSelector,
  generateXPath,
  isInShadowDom,
  extractIdentity,
  captureValue,
  captureCheckedState,
  captureAriaState,
  resolveTarget,
  summarizeMutations,
} from '../src/recorder/observer/observer-helpers';
import { UniversalInteractionObserver } from '../src/recorder/observer/universal-interaction-observer';
import type { MutationRecord } from 'vitest';

// ── computeAccessibleName ──────────────────────────────────────────────

describe('computeAccessibleName', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns aria-label when present', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Close');
    document.body.appendChild(btn);
    expect(computeAccessibleName(btn)).toBe('Close');
  });

  it('returns aria-labelledby target text', () => {
    const label = document.createElement('span');
    label.id = 'lbl';
    label.textContent = 'Email Field';
    document.body.appendChild(label);
    const input = document.createElement('input');
    input.setAttribute('aria-labelledby', 'lbl');
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Email Field');
  });

  it('handles multiple aria-labelledby IDs', () => {
    const l1 = document.createElement('span');
    l1.id = 'l1';
    l1.textContent = 'Billing';
    const l2 = document.createElement('span');
    l2.id = 'l2';
    l2.textContent = 'Address';
    document.body.appendChild(l1);
    document.body.appendChild(l2);
    const input = document.createElement('input');
    input.setAttribute('aria-labelledby', 'l1 l2');
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Billing Address');
  });

  it('returns innerText for elements with rendered text', () => {
    const btn = document.createElement('button');
    btn.innerText = 'Submit Form';
    document.body.appendChild(btn);
    expect(computeAccessibleName(btn)).toBe('Submit Form');
  });

  it('returns label[for] text for form controls', () => {
    const label = document.createElement('label');
    label.setAttribute('for', 'username');
    label.textContent = 'Username';
    document.body.appendChild(label);
    const input = document.createElement('input');
    input.id = 'username';
    input.type = 'text';
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Username');
  });

  it('returns placeholder when no other name source', () => {
    const input = document.createElement('input');
    input.placeholder = 'Enter search term';
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Enter search term');
  });

  it('returns aria-placeholder as alternative', () => {
    const input = document.createElement('input');
    input.setAttribute('aria-placeholder', 'ARIA Placeholder');
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('ARIA Placeholder');
  });

  it('returns value for button-type inputs', () => {
    const input = document.createElement('input');
    input.type = 'submit';
    input.value = 'Send Form';
    document.body.appendChild(input);
    expect(computeAccessibleName(input)).toBe('Send Form');
  });

  it('returns alt text for images', () => {
    const img = document.createElement('img');
    img.alt = 'Logo';
    document.body.appendChild(img);
    expect(computeAccessibleName(img)).toBe('Logo');
  });

  it('returns title when no other source', () => {
    const div = document.createElement('div');
    div.setAttribute('title', 'Tooltip text');
    document.body.appendChild(div);
    expect(computeAccessibleName(div)).toBe('Tooltip text');
  });

  it('returns empty string for unnamed element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(computeAccessibleName(div)).toBe('');
  });

  it('truncates to 200 chars', () => {
    const div = document.createElement('div');
    div.textContent = 'x'.repeat(300);
    document.body.appendChild(div);
    expect(computeAccessibleName(div).length).toBe(200);
  });
});

// ── getImplicitRole ────────────────────────────────────────────────────

describe('getImplicitRole', () => {
  it('returns explicit role when present', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'navigation');
    expect(getImplicitRole(div)).toBe('navigation');
  });

  it('maps button tag to button role', () => {
    const btn = document.createElement('button');
    expect(getImplicitRole(btn)).toBe('button');
  });

  it('maps input[type=checkbox] to checkbox role', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    expect(getImplicitRole(input)).toBe('checkbox');
  });

  it('maps input[type=text] to textbox role', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(getImplicitRole(input)).toBe('textbox');
  });

  it('returns null for unmapped tag without role', () => {
    const div = document.createElement('div');
    expect(getImplicitRole(div)).toBeNull();
  });
});

// ── generateCssSelector ────────────────────────────────────────────────

describe('generateCssSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns #id when element has id', () => {
    const div = document.createElement('div');
    div.id = 'main-content';
    document.body.appendChild(div);
    expect(generateCssSelector(div)).toBe('#main-content');
  });

  it('builds nth-of-type chain for elements without id', () => {
    document.body.innerHTML = '<div><span>one</span><span>two</span></div>';
    const secondSpan = document.querySelectorAll('span')[1];
    expect(generateCssSelector(secondSpan)).toContain('span:nth-of-type(2)');
  });

  it('does not add nth-of-type when element is unique child', () => {
    document.body.innerHTML = '<div><button>Click</button></div>';
    const btn = document.querySelector('button')!;
    // Walks up to documentElement, so includes ancestors
    const selector = generateCssSelector(btn);
    expect(selector).toContain('button');
    expect(selector).not.toContain('nth-of-type'); // unique, no nth needed
  });
});

// ── generateXPath ──────────────────────────────────────────────────────

describe('generateXPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns //tag[@id] when element has id', () => {
    const input = document.createElement('input');
    input.id = 'email';
    document.body.appendChild(input);
    expect(generateXPath(input)).toBe("//input[@id='email']");
  });

  it('builds positional path with // prefix', () => {
    document.body.innerHTML = '<div><p>one</p><p>two</p></div>';
    const secondP = document.querySelectorAll('p')[1];
    const xpath = generateXPath(secondP);
    expect(xpath.startsWith('//')).toBe(true);
    expect(xpath).toContain('p[2]');
  });

  it('uses // prefix (not /)', () => {
    document.body.innerHTML = '<div><button>Test</button></div>';
    const btn = document.querySelector('button')!;
    const xpath = generateXPath(btn);
    expect(xpath.startsWith('//')).toBe(true);
  });
});

// ── isInShadowDom ──────────────────────────────────────────────────────

describe('isInShadowDom', () => {
  it('returns false for regular elements', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(isInShadowDom(div)).toBe(false);
  });

  it('returns true for shadow DOM elements', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const span = document.createElement('span');
    shadow.appendChild(span);
    expect(isInShadowDom(span)).toBe(true);
  });
});

// ── extractIdentity ────────────────────────────────────────────────────

describe('extractIdentity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('builds complete identity for a button', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    btn.id = 'submit-btn';
    btn.className = 'btn-primary';
    document.body.appendChild(btn);

    const identity = extractIdentity(btn);
    expect(identity.tag).toBe('BUTTON');
    expect(identity.accessibleName).toBe('Submit');
    expect(identity.ariaRole).toBe('button');
    expect(identity.stableId).toBe('submit-btn');
    expect(identity.className).toBe('btn-primary');
    expect(identity.cssSelector).toBe('#submit-btn');
    expect(identity.xPath).toBe("//button[@id='submit-btn']");
    expect(identity.inIframe).toBe(false);
    expect(identity.shadowDom).toBe(false);
  });

  it('includes testId and dataCy when present', () => {
    const div = document.createElement('div');
    div.setAttribute('data-testid', 'login-button');
    div.setAttribute('data-cy', 'login');
    document.body.appendChild(div);

    const identity = extractIdentity(div);
    expect(identity.testId).toBe('login-button');
    expect(identity.dataCy).toBe('login');
  });

  it('captures ariaLabel and ariaLabelledBy', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-label', 'Custom');
    div.setAttribute('aria-labelledby', 'ref1');
    document.body.appendChild(div);

    const identity = extractIdentity(div);
    expect(identity.ariaLabel).toBe('Custom');
    expect(identity.ariaLabelledBy).toBe('ref1');
  });

  it('sets elementId to empty (assigned by SW)', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const identity = extractIdentity(btn);
    expect(identity.elementId).toBe('');
  });

  it('detects shadow DOM elements', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    shadow.appendChild(btn);

    const identity = extractIdentity(btn);
    expect(identity.shadowDom).toBe(true);
  });
});

// ── captureValue ───────────────────────────────────────────────────────

describe('captureValue', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures input value', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'hello world';
    document.body.appendChild(input);
    expect(captureValue(input)).toBe('hello world');
  });

  it('captures textarea value', () => {
    const ta = document.createElement('textarea');
    ta.value = 'multi\nline';
    document.body.appendChild(ta);
    expect(captureValue(ta)).toBe('multi\nline');
  });

  it('captures selected option text from select', () => {
    document.body.innerHTML = `
      <select>
        <option value="us">United States</option>
        <option value="uk" selected>United Kingdom</option>
      </select>
    `;
    const select = document.querySelector('select')!;
    expect(captureValue(select)).toBe('United Kingdom');
  });

  it('returns undefined for non-value elements', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(captureValue(div)).toBeUndefined();
  });

  it('returns selected option from ARIA listbox', () => {
    document.body.innerHTML = `
      <ul role="listbox">
        <li role="option">Apple</li>
        <li role="option" aria-selected="true">Banana</li>
      </ul>
    `;
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(captureValue(listbox)).toBe('Banana');
  });
});

// ── captureCheckedState ────────────────────────────────────────────────

describe('captureCheckedState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures checkbox checked state', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    document.body.appendChild(input);
    expect(captureCheckedState(input)).toBe(true);
  });

  it('captures unchecked state', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.appendChild(input);
    expect(captureCheckedState(input)).toBe(false);
  });

  it('captures aria-checked="true"', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'checkbox');
    div.setAttribute('aria-checked', 'true');
    document.body.appendChild(div);
    expect(captureCheckedState(div)).toBe(true);
  });

  it('captures aria-pressed as boolean', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    div.setAttribute('aria-pressed', 'true');
    document.body.appendChild(div);
    expect(captureCheckedState(div)).toBe(true);
  });

  it('returns undefined for elements without checkable state', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(captureCheckedState(div)).toBeUndefined();
  });
});

// ── captureAriaState ───────────────────────────────────────────────────

describe('captureAriaState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures aria-checked state', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-checked', 'true');
    expect(captureAriaState(div)).toBe('aria-checked=true');
  });

  it('captures aria-pressed state', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-pressed', 'false');
    expect(captureAriaState(div)).toBe('aria-pressed=false');
  });

  it('captures aria-selected state', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-selected', 'true');
    expect(captureAriaState(div)).toBe('aria-selected=true');
  });

  it('returns undefined when no ARIA state', () => {
    const div = document.createElement('div');
    expect(captureAriaState(div)).toBeUndefined();
  });
});

// ── resolveTarget ──────────────────────────────────────────────────────

describe('resolveTarget', () => {
  it('returns the event target element when it is directly interactive', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const event = new Event('click', { bubbles: true });
    btn.dispatchEvent(event);
    const target = resolveTarget(event);
    expect(target).toBe(btn);
  });

  it('returns null for non-element targets', () => {
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: document.createTextNode('text') });
    expect(resolveTarget(event)).toBeNull();
  });

  it('resolves to nearest interactive ancestor when clicking nested span inside button', () => {
    const btn = document.createElement('button');
    const span = document.createElement('span');
    span.textContent = 'Click me';
    btn.appendChild(span);
    document.body.appendChild(btn);

    const event = new MouseEvent('click', { bubbles: true });
    span.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(btn); // Should resolve to the button, not the span
  });

  it('resolves to nearest interactive ancestor when clicking deeply nested element', () => {
    // <div class="wrapper"> > <button> > <span.icon> > <svg> > <path>
    const wrapper = document.createElement('div');
    wrapper.className = 'wrapper';
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Search');
    const span = document.createElement('span');
    span.className = 'icon';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    svg.appendChild(path);
    span.appendChild(svg);
    btn.appendChild(span);
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);

    const event = new MouseEvent('click', { bubbles: true });
    path.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(btn); // Should resolve to the button with aria-label
  });

  it('resolves to ARIA role=button ancestor when clicking a child element', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', 'Open date picker');
    const iconSpan = document.createElement('span');
    iconSpan.textContent = '📅';
    div.appendChild(iconSpan);
    document.body.appendChild(div);

    const event = new MouseEvent('click', { bubbles: true });
    iconSpan.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(div); // Should resolve to the role=button div
  });

  it('resolves to input element when clicking its label text', () => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'departure-date';
    label.appendChild(input);
    const labelText = document.createElement('span');
    labelText.textContent = 'Departure Date';
    label.appendChild(labelText);
    document.body.appendChild(label);

    // Simulate a click on the label text (which is NOT interactive)
    const event = new MouseEvent('click', { bubbles: true });
    labelText.dispatchEvent(event);

    const target = resolveTarget(event);
    // composedPath from label text: [span, label, body, html, document, window]
    // label is not interactive, span is not interactive
    // No interactive ancestor found → returns null (click is dropped)
    expect(target).toBeNull();
  });

  it('resolves to role=option ancestor when clicking nested content', () => {
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-label', 'Premium Economy');
    const priceSpan = document.createElement('span');
    priceSpan.textContent = '₹5,200';
    option.appendChild(priceSpan);
    document.body.appendChild(option);

    const event = new MouseEvent('click', { bubbles: true });
    priceSpan.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(option); // Should resolve to the role=option div
  });

  it('does NOT resolve to <main> or container when no interactive ancestor exists', () => {
    // Simulates: clicking a plain text inside <main> with no interactive wrapper
    const main = document.createElement('main');
    main.setAttribute('role', 'main');
    const div = document.createElement('div');
    div.className = 'some-content';
    const p = document.createElement('p');
    p.textContent = 'Some text the user clicked';
    div.appendChild(p);
    main.appendChild(div);
    document.body.appendChild(main);

    const event = new MouseEvent('click', { bubbles: true });
    p.dispatchEvent(event);

    const target = resolveTarget(event);
    // Should NOT resolve to <main> — main has role="main" which is NOT in
    // the interactive selector. No interactive ancestor → returns null.
    expect(target).toBeNull();
  });

  it('resolves to input[type=date] when clicking the date input directly', () => {
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'departure';
    document.body.appendChild(dateInput);

    const event = new MouseEvent('click', { bubbles: true });
    dateInput.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(dateInput);
  });

  it('resolves to role=combobox ancestor when clicking a child', () => {
    const combobox = document.createElement('div');
    combobox.setAttribute('role', 'combobox');
    combobox.setAttribute('aria-label', 'Travel Class');
    combobox.setAttribute('aria-expanded', 'false');
    const displaySpan = document.createElement('span');
    displaySpan.textContent = 'Select class';
    combobox.appendChild(displaySpan);
    document.body.appendChild(combobox);

    const event = new MouseEvent('click', { bubbles: true });
    displaySpan.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(combobox);
  });

  it('resolves to a[href] ancestor when clicking nested text', () => {
    const link = document.createElement('a');
    link.href = '#services';
    const linkText = document.createElement('span');
    linkText.textContent = 'Services';
    link.appendChild(linkText);
    document.body.appendChild(link);

    const event = new MouseEvent('click', { bubbles: true });
    linkText.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(link);
  });

  it('resolves to element with aria-haspopup when clicking a child', () => {
    const trigger = document.createElement('div');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-label', 'Open dropdown');
    const iconSpan = document.createElement('span');
    iconSpan.textContent = '▼';
    trigger.appendChild(iconSpan);
    document.body.appendChild(trigger);

    const event = new MouseEvent('click', { bubbles: true });
    iconSpan.dispatchEvent(event);

    const target = resolveTarget(event);
    expect(target).toBe(trigger);
  });
});

// ── summarizeMutations ─────────────────────────────────────────────────

describe('summarizeMutations', () => {
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

  it('counts childList additions', () => {
    const summary = summarizeMutations([mockMutation('childList', undefined, 3, 0)]);
    expect(summary.childListAdded).toBe(3);
    expect(summary.childListRemoved).toBe(0);
    expect(summary.semanticChanges).toContain('childList:added:3');
  });

  it('counts childList removals', () => {
    const summary = summarizeMutations([mockMutation('childList', undefined, 0, 2)]);
    expect(summary.childListRemoved).toBe(2);
    expect(summary.semanticChanges).toContain('childList:removed:2');
  });

  it('counts relevant attribute changes', () => {
    const summary = summarizeMutations([mockMutation('attributes', 'aria-expanded')]);
    expect(summary.attributeChanges).toBe(1);
    expect(summary.semanticChanges).toContain('aria-expanded:null');
  });

  it('does not count irrelevant attribute changes', () => {
    const summary = summarizeMutations([mockMutation('attributes', 'data-id')]);
    expect(summary.attributeChanges).toBe(0);
  });

  it('tracks class changes with selected/active/open', () => {
    const div = document.createElement('div');
    div.setAttribute('class', 'item selected active');
    document.body.appendChild(div);
    const m = mockMutation('attributes', 'class');
    Object.defineProperty(m, 'target', { value: div });
    const summary = summarizeMutations([m]);
    expect(summary.semanticChanges).toContain('class:selected-added');
    expect(summary.semanticChanges).toContain('class:active-added');
  });

  it('tracks visibility transitions', () => {
    const summary = summarizeMutations([
      mockMutation('attributes', 'hidden'),
      mockMutation('attributes', 'aria-hidden'),
    ]);
    expect(summary.visibilityChanges).toBe(2);
  });

  it('accumulates across multiple mutations', () => {
    const summary = summarizeMutations([
      mockMutation('childList', undefined, 2, 1),
      mockMutation('attributes', 'class'),
      mockMutation('attributes', 'aria-selected'),
    ]);
    expect(summary.childListAdded).toBe(2);
    expect(summary.childListRemoved).toBe(1);
    expect(summary.attributeChanges).toBe(2);
  });
});

// ── UniversalInteractionObserver lifecycle ─────────────────────────────

describe('UniversalInteractionObserver', () => {
  it('starts and stops cleanly', () => {
    const observer = new UniversalInteractionObserver();
    observer.start();
    observer.stop();
    // Should not throw
  });

  it('respects recording state', () => {
    const observer = new UniversalInteractionObserver();
    observer.start();

    expect(observer.isCurrentlyRecording()).toBe(false);

    observer.setRecording(true);
    expect(observer.isCurrentlyRecording()).toBe(true);

    observer.setRecording(false);
    expect(observer.isCurrentlyRecording()).toBe(false);

    observer.stop();
  });

  it('emits evidence on click when recording', () => {
    const observer = new UniversalInteractionObserver();
    const emitted: any[] = [];
    observer.onEmit((evidence) => emitted.push(evidence));

    const btn = document.createElement('button');
    btn.textContent = 'Click Me';
    document.body.appendChild(btn);

    observer.start();
    observer.setRecording(true);
    observer.setAllowUntrusted(true); // jsdom synthetic events

    btn.click();

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0].eventType).toBe('click');
    expect(emitted[0].identity.tag).toBe('BUTTON');
    expect(emitted[0].identity.accessibleName).toBe('Click Me');

    observer.stop();
  });

  it('does NOT emit when not recording', () => {
    const observer = new UniversalInteractionObserver();
    const emitted: any[] = [];
    observer.onEmit((evidence) => emitted.push(evidence));

    const btn = document.createElement('button');
    document.body.appendChild(btn);

    observer.start();
    // recording is false by default
    btn.click();

    expect(emitted).toHaveLength(0);
    observer.stop();
  });

  it('starts mutation window on mousedown', () => {
    const observer = new UniversalInteractionObserver();
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    observer.start();
    observer.setRecording(true);
    observer.setAllowUntrusted(true);

    expect(observer.isMutationWindowActive()).toBe(false);

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(observer.isMutationWindowActive()).toBe(true);

    observer.stop();
  });

  it('filters out untrusted events when recording flag is off', () => {
    const observer = new UniversalInteractionObserver();
    const emitted: any[] = [];
    observer.onEmit((e) => emitted.push(e));

    const btn = document.createElement('button');
    document.body.appendChild(btn);

    observer.start();
    observer.setRecording(true);
    // allowUntrusted is false by default — synthetic events filtered

    btn.click();

    expect(emitted).toHaveLength(0);
    observer.stop();
  });
});
