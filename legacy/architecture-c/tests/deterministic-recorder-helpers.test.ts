/**
 * Unit tests for the deterministic recorder helper functions.
 *
 * These test the PROVEN identity extraction and target resolution logic
 * that the deterministic recorder content script relies on. The tests
 * import the canonical implementations from observer-helpers.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveTarget,
  extractIdentity,
  captureValue,
  captureCheckedState,
  computeAccessibleName,
  getImplicitRole,
  generateCssSelector,
  generateXPath,
  isInShadowDom,
} from '../src/recorder/observer/observer-helpers';

// ── DOM Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = '';
});

// ── resolveTarget ───────────────────────────────────────────────────────

describe('resolveTarget', () => {
  it('resolves to the interactive element when target is inside a button', () => {
    document.body.innerHTML = '<button id="btn">Click <span class="icon">⊕</span></button>';
    const span = document.querySelector('.icon')!;
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: span });
    Object.defineProperty(event, 'composedPath', {
      value: () => [span, document.getElementById('btn'), document.body, document.documentElement],
    });

    const target = resolveTarget(event);
    expect(target).toBeInstanceOf(HTMLButtonElement);
    expect(target?.id).toBe('btn');
  });

  it('resolves to <a> when clicking a span inside a link', () => {
    document.body.innerHTML = '<a href="/page"><span>Link text</span></a>';
    const span = document.querySelector('span')!;
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: span });
    Object.defineProperty(event, 'composedPath', {
      value: () => [span, document.querySelector('a'), document.body],
    });

    const target = resolveTarget(event);
    expect(target?.tagName).toBe('A');
  });

  it('returns null for a click on a non-interactive container', () => {
    document.body.innerHTML = '<div><p>Some text</p></div>';
    const div = document.querySelector('div')!;
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: div });
    Object.defineProperty(event, 'composedPath', {
      value: () => [div, document.body],
    });

    const target = resolveTarget(event);
    expect(target).toBeNull();
  });

  it('resolves to input element directly', () => {
    document.body.innerHTML = '<input type="text" id="field" />';
    const input = document.getElementById('field')!;
    const event = new Event('focus', { bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    Object.defineProperty(event, 'composedPath', {
      value: () => [input, document.body],
    });

    const target = resolveTarget(event);
    expect(target?.tagName).toBe('INPUT');
  });

  it('resolves ARIA role=button elements', () => {
    document.body.innerHTML = '<div role="button" id="aria-btn" tabindex="0">Custom</div>';
    const el = document.getElementById('aria-btn')!;
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: el });
    Object.defineProperty(event, 'composedPath', {
      value: () => [el, document.body],
    });

    const target = resolveTarget(event);
    expect(target?.id).toBe('aria-btn');
  });

  it('resolves selects and textareas', () => {
    document.body.innerHTML = '<select id="sel"><option>A</option></select><textarea id="ta"></textarea>';
    const sel = document.getElementById('sel')!;
    const ta = document.getElementById('ta')!;

    const selEvent = new Event('change', { bubbles: true });
    Object.defineProperty(selEvent, 'target', { value: sel });
    Object.defineProperty(selEvent, 'composedPath', { value: () => [sel, document.body] });
    expect(resolveTarget(selEvent)?.tagName).toBe('SELECT');

    const taEvent = new Event('focus', { bubbles: true });
    Object.defineProperty(taEvent, 'target', { value: ta });
    Object.defineProperty(taEvent, 'composedPath', { value: () => [ta, document.body] });
    expect(resolveTarget(taEvent)?.tagName).toBe('TEXTAREA');
  });
});

// ── extractIdentity ─────────────────────────────────────────────────────

describe('extractIdentity', () => {
  it('extracts complete identity from a button with id', () => {
    document.body.innerHTML = '<button id="submit-btn" class="primary" data-testid="submit">Submit</button>';
    const btn = document.getElementById('submit-btn')!;
    const identity = extractIdentity(btn);

    expect(identity.tag).toBe('BUTTON');
    expect(identity.accessibleName).toBe('Submit');
    expect(identity.stableId).toBe('submit-btn');
    expect(identity.testId).toBe('submit');
    expect(identity.className).toBe('primary');
    expect(identity.ariaRole).toBe('button');
    expect(identity.cssSelector).toBe('#submit-btn');
    expect(identity.inIframe).toBe(false);
    expect(identity.shadowDom).toBe(false);
  });

  it('extracts identity from an input with label[for]', () => {
    document.body.innerHTML = `
      <label for="email">Email Address</label>
      <input type="email" id="email" name="email" placeholder="Enter email" />
    `;
    const input = document.getElementById('email')!;
    const identity = extractIdentity(input);

    expect(identity.tag).toBe('INPUT');
    expect(identity.accessibleName).toBe('Email Address');
    expect(identity.name).toBe('email');
    expect(identity.placeholder).toBe('Enter email');
    expect(identity.ariaRole).toBe('textbox');
  });

  it('extracts identity from a select with options', () => {
    document.body.innerHTML = `
      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="us">United States</option>
        <option value="uk" selected>United Kingdom</option>
      </select>
    `;
    const select = document.getElementById('country')! as HTMLSelectElement;
    const identity = extractIdentity(select);

    expect(identity.tag).toBe('SELECT');
    expect(identity.accessibleName).toBe('Country');
    expect(identity.ariaRole).toBe('listbox');
  });

  it('extracts identity from checkbox with aria-label', () => {
    document.body.innerHTML = '<input type="checkbox" id="agree" aria-label="I agree to terms" />';
    const cb = document.getElementById('agree')!;
    const identity = extractIdentity(cb);

    expect(identity.tag).toBe('INPUT');
    expect(identity.accessibleName).toBe('I agree to terms');
    expect(identity.ariaLabel).toBe('I agree to terms');
    expect(identity.ariaRole).toBe('checkbox');
  });

  it('extracts identity from ARIA checkbox', () => {
    document.body.innerHTML = '<div role="checkbox" id="cb" aria-checked="true" aria-label="Subscribe" tabindex="0"></div>';
    const el = document.getElementById('cb')!;
    const identity = extractIdentity(el);

    expect(identity.tag).toBe('DIV');
    expect(identity.ariaRole).toBe('checkbox');
    expect(identity.accessibleName).toBe('Subscribe');
  });

  it('extracts data-cy and data-qa attributes', () => {
    document.body.innerHTML = '<button data-cy="login-btn" data-qa="qa-login">Login</button>';
    const btn = document.querySelector('button')!;
    const identity = extractIdentity(btn);

    expect(identity.dataCy).toBe('login-btn');
    expect(identity.dataQa).toBe('qa-login');
  });

  it('generates cssSelector when no id is present', () => {
    document.body.innerHTML = '<div><button class="btn">Click</button></div>';
    const btn = document.querySelector('button')!;
    const identity = extractIdentity(btn);

    expect(identity.stableId).toBeNull();
    expect(identity.cssSelector).toContain('button');
  });
});

// ── captureValue ────────────────────────────────────────────────────────

describe('captureValue', () => {
  it('captures text input value', () => {
    document.body.innerHTML = '<input type="text" id="field" value="hello world" />';
    const input = document.getElementById('field')!;
    expect(captureValue(input)).toBe('hello world');
  });

  it('captures textarea value', () => {
    document.body.innerHTML = '<textarea id="ta">multi\nline</textarea>';
    const ta = document.getElementById('ta')!;
    expect(captureValue(ta)).toBe('multi\nline');
  });

  it('captures selected option text from select', () => {
    document.body.innerHTML = `
      <select id="sel">
        <option value="a">Option A</option>
        <option value="b" selected>Option B</option>
      </select>
    `;
    const sel = document.getElementById('sel')! as HTMLSelectElement;
    expect(captureValue(sel)).toBe('Option B');
  });

  it('returns undefined for non-value elements', () => {
    document.body.innerHTML = '<button>Click</button>';
    const btn = document.querySelector('button')!;
    expect(captureValue(btn)).toBeUndefined();
  });

  it('captures ARIA listbox selected option', () => {
    document.body.innerHTML = `
      <div role="listbox" id="lb">
        <div role="option">A</div>
        <div role="option" aria-selected="true">B</div>
      </div>
    `;
    const lb = document.getElementById('lb')!;
    expect(captureValue(lb)).toBe('B');
  });
});

// ── captureCheckedState ─────────────────────────────────────────────────

describe('captureCheckedState', () => {
  it('captures native checkbox checked state', () => {
    document.body.innerHTML = '<input type="checkbox" id="cb" checked />';
    const cb = document.getElementById('cb') as HTMLInputElement;
    expect(captureCheckedState(cb)).toBe(true);

    cb.checked = false;
    expect(captureCheckedState(cb)).toBe(false);
  });

  it('captures native radio checked state', () => {
    document.body.innerHTML = '<input type="radio" id="r1" name="grp" checked /><input type="radio" id="r2" name="grp" />';
    const r1 = document.getElementById('r1') as HTMLInputElement;
    const r2 = document.getElementById('r2') as HTMLInputElement;
    expect(captureCheckedState(r1)).toBe(true);
    expect(captureCheckedState(r2)).toBe(false);
  });

  it('captures ARIA checkbox state', () => {
    document.body.innerHTML = '<div role="checkbox" aria-checked="true">CB</div>';
    const el = document.querySelector('div')!;
    expect(captureCheckedState(el)).toBe(true);
  });

  it('captures ARIA pressed state', () => {
    document.body.innerHTML = '<button aria-pressed="false">Toggle</button>';
    const btn = document.querySelector('button')!;
    expect(captureCheckedState(btn)).toBe(false);
  });

  it('returns undefined for elements without checked state', () => {
    document.body.innerHTML = '<input type="text" value="hello" />';
    const input = document.querySelector('input')!;
    expect(captureCheckedState(input)).toBeUndefined();
  });
});

// ── computeAccessibleName ───────────────────────────────────────────────

describe('computeAccessibleName', () => {
  it('prefers aria-label over innerText', () => {
    document.body.innerHTML = '<button aria-label="Save Changes">Save</button>';
    const btn = document.querySelector('button')!;
    expect(computeAccessibleName(btn)).toBe('Save Changes');
  });

  it('uses aria-labelledby reference', () => {
    document.body.innerHTML = `
      <span id="label-text">Full Name</span>
      <input type="text" aria-labelledby="label-text" />
    `;
    const input = document.querySelector('input')!;
    expect(computeAccessibleName(input)).toBe('Full Name');
  });

  it('uses enclosing label text for input', () => {
    document.body.innerHTML = '<label>Username <input type="text" /></label>';
    const input = document.querySelector('input')!;
    expect(computeAccessibleName(input)).toBe('Username');
  });

  it('uses placeholder as fallback', () => {
    document.body.innerHTML = '<input type="text" placeholder="Search..." />';
    const input = document.querySelector('input')!;
    expect(computeAccessibleName(input)).toBe('Search...');
  });

  it('returns empty string when no name is derivable', () => {
    document.body.innerHTML = '<div></div>';
    const div = document.querySelector('div')!;
    expect(computeAccessibleName(div)).toBe('');
  });
});

// ── getImplicitRole ─────────────────────────────────────────────────────

describe('getImplicitRole', () => {
  it('returns explicit role when present', () => {
    document.body.innerHTML = '<div role="navigation">Nav</div>';
    const el = document.querySelector('div')!;
    expect(getImplicitRole(el)).toBe('navigation');
  });

  it('returns button for button tag', () => {
    document.body.innerHTML = '<button>OK</button>';
    expect(getImplicitRole(document.querySelector('button')!)).toBe('button');
  });

  it('returns textbox for text input', () => {
    document.body.innerHTML = '<input type="text" />';
    expect(getImplicitRole(document.querySelector('input')!)).toBe('textbox');
  });

  it('returns checkbox for checkbox input', () => {
    document.body.innerHTML = '<input type="checkbox" />';
    expect(getImplicitRole(document.querySelector('input')!)).toBe('checkbox');
  });

  it('returns slider for range input', () => {
    document.body.innerHTML = '<input type="range" />';
    expect(getImplicitRole(document.querySelector('input')!)).toBe('slider');
  });
});

// ── Selector Generation ─────────────────────────────────────────────────

describe('generateCssSelector', () => {
  it('uses #id when present', () => {
    document.body.innerHTML = '<button id="my-btn">Click</button>';
    const btn = document.getElementById('my-btn')!;
    expect(generateCssSelector(btn)).toBe('#my-btn');
  });

  it('generates nth-of-type chain when no id', () => {
    document.body.innerHTML = '<div><button>A</button><button>B</button></div>';
    const buttons = document.querySelectorAll('button');
    expect(generateCssSelector(buttons[1])).toContain('nth-of-type(2)');
  });
});

describe('generateXPath', () => {
  it('uses //tag[@id="id"] when id present', () => {
    document.body.innerHTML = '<button id="my-btn">Click</button>';
    const btn = document.getElementById('my-btn')!;
    expect(generateXPath(btn)).toBe("//button[@id='my-btn']");
  });
});

// ── isInShadowDom ───────────────────────────────────────────────────────

describe('isInShadowDom', () => {
  it('returns false for light DOM elements', () => {
    document.body.innerHTML = '<button>Click</button>';
    const btn = document.querySelector('button')!;
    expect(isInShadowDom(btn)).toBe(false);
  });

  it('returns true for shadow DOM elements', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.textContent = 'Shadow';
    shadow.appendChild(btn);
    expect(isInShadowDom(btn)).toBe(true);
  });
});
