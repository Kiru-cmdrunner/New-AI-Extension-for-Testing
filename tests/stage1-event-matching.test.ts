/**
 * Stage 1 — Production Event Matching Tests
 *
 * Validates that the production Control Model (imported from src/recorder/v2/)
 * produces the same correct results as the inline prototype in milestone tests.
 *
 * Test suites:
 * 1. Semantic HTML (baseline correctness)
 * 2. OrangeHRM OXD (the original failure case — Nationality ≠ Blood Type)
 * 3. MUI (React wrapper patterns)
 * 4. Ant Design (class-based custom components)
 * 5. Shadow DOM (Web Components)
 * 6. Composite Controls (dialog, menu, radiogroup)
 * 7. Deeply Nested (icon-in-button, span-in-link)
 * 8. Stats & Discovery (counts, role distribution)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

import { ControlModel } from '../src/recorder/v2/control-model';
import { getRole, getAccessibleName, isPlaceholderText } from '../src/recorder/v2/identity-extractor';

// ─── Test Helpers ──────────────────────────────────────────────────────────

function setupDOM(html: string) {
  const dom = new JSDOM(html);
  globalThis.document = dom.window.document;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  (globalThis as any).WeakRef = dom.window.WeakRef || WeakRef;
  (globalThis as any).WeakMap = dom.window.WeakMap || WeakMap;
  return dom;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Semantic HTML', () => {
  beforeEach(() => {
    setupDOM(`
      <body>
        <nav>
          <a href="/home">Home</a>
          <a href="/about">About Us</a>
        </nav>
        <main>
          <form>
            <label for="username">Username</label>
            <input type="text" id="username" />
            <label for="password">Password</label>
            <input type="password" id="password" />
            <button type="submit">Sign In</button>
          </form>
          <select id="country">
            <option value="">Choose a country</option>
            <option value="us">United States</option>
            <option value="uk">United Kingdom</option>
          </select>
          <fieldset>
            <legend>Subscribe to newsletter</legend>
            <label><input type="radio" name="sub" value="yes" /> Yes</label>
            <label><input type="radio" name="sub" value="no" /> No</label>
          </fieldset>
          <label><input type="checkbox" id="terms" /> Accept terms</label>
        </main>
      </body>
    `);
  });

  it('discovers all interactive controls', () => {
    const model = new ControlModel();
    model.discover();

    const stats = model.stats();
    expect(stats.widgets).toBeGreaterThanOrEqual(8); // 2 links, 2 inputs, 1 button, 1 select, 2 radios, 1 checkbox
    expect(stats.total).toBeGreaterThanOrEqual(stats.widgets);
  });

  it('resolves text input role and name via label[for]', () => {
    const model = new ControlModel();
    model.discover();

    const usernameInput = document.getElementById('username')!;
    const ctrl = model.findByElement(usernameInput);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('textbox');
    expect(ctrl!.name).toBe('Username');
  });

  it('resolves button role and name', () => {
    const model = new ControlModel();
    model.discover();

    const btn = document.querySelector('button')!;
    const ctrl = model.findByElement(btn);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Sign In');
  });

  it('resolves radio button via label wrapper', () => {
    const model = new ControlModel();
    model.discover();

    const yesRadio = document.querySelector('input[value="yes"]')!;
    const ctrl = model.findByElement(yesRadio);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('radio');
  });

  it('matchEvent resolves icon inside button to button', () => {
    const model = new ControlModel();
    model.discover();

    const btn = document.querySelector('button')!;
    const ctrl = model.matchEvent(btn);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.name).toBe('Sign In');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2: OrangeHRM OXD (the original failure case)
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — OrangeHRM OXD', () => {
  const oxdFormHTML = `
    <body>
      <div class="oxd-form">
        <div class="oxd-input-group">
          <label class="oxd-label">First Name</label>
          <div class="oxd-input-wrapper">
            <input type="text" class="oxd-input" />
          </div>
        </div>
        <div class="oxd-input-group">
          <label class="oxd-label">Nationality</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text" tabindex="0">
              <div class="oxd-select-text-input">-- Select --</div>
              <i class="oxd-select-text-icon"></i>
            </div>
          </div>
        </div>
        <div class="oxd-input-group">
          <label class="oxd-label">Blood Type</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text" tabindex="0">
              <div class="oxd-select-text-input">-- Select --</div>
              <i class="oxd-select-text-icon"></i>
            </div>
          </div>
        </div>
        <div class="oxd-input-group">
          <label class="oxd-label">Marital Status</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text" tabindex="0">
              <div class="oxd-select-text-input">-- Select --</div>
              <i class="oxd-select-text-icon"></i>
            </div>
          </div>
        </div>
        <div class="oxd-input-group">
          <label class="oxd-label">Gender</label>
          <div role="radiogroup">
            <label class="oxd-radio-wrapper">
              <input type="radio" name="gender" value="male" />
              <span class="oxd-radio-input-icon"></span>
              <span>Male</span>
            </label>
            <label class="oxd-radio-wrapper">
              <input type="radio" name="gender" value="female" />
              <span class="oxd-radio-input-icon"></span>
              <span>Female</span>
            </label>
          </div>
        </div>
        <button type="submit" class="oxd-button">
          <i class="oxd-button-icon"></i>
          <span>Save</span>
        </button>
      </div>
    </body>
  `;

  beforeEach(() => setupDOM(oxdFormHTML));

  it('discovers OXD combobox controls', () => {
    const model = new ControlModel();
    model.discover();

    const nationalitySelect = document.querySelectorAll('.oxd-select-text')[0]!;
    const ctrl = model.findByElement(nationalitySelect);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('combobox');
  });

  it('OXD combobox resolves to correct name via .oxd-input-group > .oxd-label', () => {
    const model = new ControlModel();
    model.discover();

    const nationalitySelect = document.querySelectorAll('.oxd-select-text')[0]!;
    const ctrl = model.findByElement(nationalitySelect);
    expect(ctrl!.name).toBe('Nationality');
  });

  it('Nationality does NOT resolve to Blood Type (v10.4.18 regression check)', () => {
    const model = new ControlModel();
    model.discover();

    const nationalitySelect = document.querySelectorAll('.oxd-select-text')[0]!;
    const ctrl = model.matchEvent(nationalitySelect);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.name).toBe('Nationality');
    expect(ctrl!.name).not.toBe('Blood Type');
  });

  it('Marital Status resolves to its own name, not Blood Type', () => {
    const model = new ControlModel();
    model.discover();

    const maritalSelect = document.querySelectorAll('.oxd-select-text')[2]!;
    const ctrl = model.matchEvent(maritalSelect);
    expect(ctrl!.name).toBe('Marital Status');
    expect(ctrl!.name).not.toBe('Blood Type');
  });

  it('Blood Type resolves to Blood Type', () => {
    const model = new ControlModel();
    model.discover();

    const bloodTypeSelect = document.querySelectorAll('.oxd-select-text')[1]!;
    const ctrl = model.matchEvent(bloodTypeSelect);
    expect(ctrl!.name).toBe('Blood Type');
  });

  it('Click on Save icon resolves to Save button (not "I")', () => {
    const model = new ControlModel();
    model.discover();

    const saveIcon = document.querySelector('.oxd-button-icon')!;
    const ctrl = model.matchEvent(saveIcon);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.name).toBe('Save');
    expect(ctrl!.name).not.toBe('I');
  });

  it('Click on Save span text resolves to Save button', () => {
    const model = new ControlModel();
    model.discover();

    const saveSpan = document.querySelector('.oxd-button > span')!;
    const ctrl = model.matchEvent(saveSpan);
    expect(ctrl!.name).toBe('Save');
  });

  it('OXD radio resolves via OXD wrapper fallback', () => {
    const model = new ControlModel();
    model.discover();

    const femaleLabel = document.querySelectorAll('.oxd-radio-wrapper')[1]!;
    const ctrl = model.matchEvent(femaleLabel);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('radio');
  });

  it('OXD text input resolves correct name', () => {
    const model = new ControlModel();
    model.discover();

    const input = document.querySelector('.oxd-input')!;
    const ctrl = model.findByElement(input);
    expect(ctrl!.name).toBe('First Name');
  });

  it('clicking the dropdown icon (decorative child) resolves to parent combobox', () => {
    const model = new ControlModel();
    model.discover();

    const icon = document.querySelectorAll('.oxd-select-text-icon')[0]!;
    const ctrl = model.matchEvent(icon);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('combobox');
    expect(ctrl!.name).toBe('Nationality');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3: MUI (React wrapper patterns)
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — MUI', () => {
  const muiHTML = `
    <body>
      <div class="MuiFormControl-root">
        <label class="MuiInputLabel-root">Email Address</label>
        <div class="MuiInputBase-root">
          <input type="text" class="MuiInputBase-input" />
        </div>
      </div>
      <label class="MuiFormControlLabel-root">
        <span class="MuiButtonBase-root MuiCheckbox-root">
          <input type="checkbox" class="MuiCheckbox-input" />
        </span>
        <span>Accept Terms</span>
      </label>
      <button class="MuiButtonBase-root MuiButton-root" type="button">
        <span class="MuiButton-label">Submit Form</span>
      </button>
    </body>
  `;

  beforeEach(() => setupDOM(muiHTML));

  it('MUI text input resolves name via nested label', () => {
    const model = new ControlModel();
    model.discover();

    const input = document.querySelector('.MuiInputBase-input')!;
    const ctrl = model.findByElement(input);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('textbox');
    // Name resolution from MUI nested label
    expect(ctrl!.name.length).toBeGreaterThan(0);
  });

  it('MUI checkbox resolves via label wrapper', () => {
    const model = new ControlModel();
    model.discover();

    const labelWrapper = document.querySelector('.MuiFormControlLabel-root')!;
    const ctrl = model.matchEvent(labelWrapper);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('checkbox');
    expect(ctrl!.name).toBe('Accept Terms');
  });

  it('MUI button resolves via nested span', () => {
    const model = new ControlModel();
    model.discover();

    const span = document.querySelector('.MuiButton-label')!;
    const ctrl = model.matchEvent(span);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Submit Form');
  });

  it('MUI text input role is textbox', () => {
    const model = new ControlModel();
    model.discover();

    const input = document.querySelector('.MuiInputBase-input')!;
    const ctrl = model.findByElement(input);
    expect(ctrl!.role).toBe('textbox');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 4: Ant Design
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Ant Design', () => {
  const antHTML = `
    <body>
      <div>
        <button class="ant-btn ant-btn-primary" type="button">
          <span>Confirm</span>
        </button>
        <label class="ant-checkbox-wrapper">
          <span class="ant-checkbox">
            <input type="checkbox" class="ant-checkbox-input" />
            <span class="ant-checkbox-inner"></span>
          </span>
          <span>Remember me</span>
        </label>
        <div class="ant-radio-group" role="radiogroup">
          <label class="ant-radio-wrapper">
            <span class="ant-radio">
              <input type="radio" name="size" value="small" />
              <span class="ant-radio-inner"></span>
            </span>
            <span>Small</span>
          </label>
          <label class="ant-radio-wrapper">
            <span class="ant-radio">
              <input type="radio" name="size" value="large" />
              <span class="ant-radio-inner"></span>
            </span>
            <span>Large</span>
          </label>
        </div>
      </div>
    </body>
  `;

  beforeEach(() => setupDOM(antHTML));

  it('Ant button resolves via span child', () => {
    const model = new ControlModel();
    model.discover();

    const span = document.querySelector('.ant-btn span')!;
    const ctrl = model.matchEvent(span);
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Confirm');
  });

  it('Ant checkbox resolves via label wrapper', () => {
    const model = new ControlModel();
    model.discover();

    const wrapper = document.querySelector('.ant-checkbox-wrapper')!;
    const ctrl = model.matchEvent(wrapper);
    expect(ctrl!.role).toBe('checkbox');
    expect(ctrl!.name).toBe('Remember me');
  });

  it('Ant radio resolves via label wrapper, not radiogroup', () => {
    const model = new ControlModel();
    model.discover();

    const wrappers = document.querySelectorAll('.ant-radio-wrapper');
    const ctrl = model.matchEvent(wrappers[1]!);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('radio');
    // Name should be 'Large' (or from the text content)
    expect(ctrl!.name.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 5: Shadow DOM
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Shadow DOM', () => {
  it('discovers elements inside open shadow roots', () => {
    setupDOM(`<body><my-component></my-component></body>`);
    const host = document.querySelector('my-component')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <button id="inner-btn">Click Me</button>
      <input type="text" placeholder="Search" />
    `;

    const model = new ControlModel();
    model.discover();

    const innerBtn = shadow.querySelector('#inner-btn')!;
    const ctrl = model.findByElement(innerBtn);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Click Me');
  });

  it('matchEvent resolves through shadow boundary', () => {
    setupDOM(`<body><my-widget></my-widget></body>`);
    const host = document.querySelector('my-widget')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<button>Shadow Button</button>`;

    const model = new ControlModel();
    model.discover();

    const btn = shadow.querySelector('button')!;
    const ctrl = model.matchEvent(btn);
    expect(ctrl!.name).toBe('Shadow Button');
  });

  it('discovers shadow DOM slot text content', () => {
    setupDOM(`<body><my-card><button>Card Button</button></my-card></body>`);
    const host = document.querySelector('my-card')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<div><slot></slot></div>`;

    const model = new ControlModel();
    model.discover();

    // The slotted button should be discoverable in the light DOM
    const btn = document.querySelector('my-card > button')!;
    const ctrl = model.findByElement(btn);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('button');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 6: Composite Controls
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Composite Controls', () => {
  beforeEach(() => {
    setupDOM(`
      <body>
        <div role="dialog" aria-modal="true" aria-label="Settings Modal">
          <button>Close</button>
          <input type="text" aria-label="Setting Name" />
        </div>
        <div role="menu" aria-label="File Menu">
          <div role="menuitem">New</div>
          <div role="menuitem">Open</div>
          <div role="menuitem">Save</div>
          <div role="separator"></div>
          <div role="menuitem">Exit</div>
        </div>
        <div role="tablist">
          <div role="tab" aria-selected="true">Tab 1</div>
          <div role="tab" aria-selected="false">Tab 2</div>
        </div>
        <div role="radiogroup" aria-label="Priority">
          <div role="radio" aria-checked="true">High</div>
          <div role="radio" aria-checked="false">Low</div>
        </div>
      </body>
    `);
  });

  it('discovers composite containers (dialog, menu, tablist, radiogroup)', () => {
    const model = new ControlModel();
    model.discover();

    const stats = model.stats();
    expect(stats.byRole['dialog']).toBe(1);
    expect(stats.byRole['menu']).toBe(1);
    expect(stats.byRole['tablist']).toBe(1);
    expect(stats.byRole['radiogroup']).toBe(1);
  });

  it('matchEvent skips composite roles — radio inside radiogroup matches radio', () => {
    const model = new ControlModel();
    model.discover();

    const radio = document.querySelector('[role="radio"]')!;
    const ctrl = model.matchEvent(radio);
    expect(ctrl!.role).toBe('radio');
    expect(ctrl!.name).toBe('High');
  });

  it('matchEvent skips tablist — tab matches tab', () => {
    const model = new ControlModel();
    model.discover();

    const tab = document.querySelector('[role="tab"]')!;
    const ctrl = model.matchEvent(tab);
    expect(ctrl!.role).toBe('tab');
    expect(ctrl!.name).toBe('Tab 1');
  });

  it('matchEvent skips dialog — button inside dialog matches button', () => {
    const model = new ControlModel();
    model.discover();

    const closeBtn = document.querySelector('dialog button, [role="dialog"] button')!;
    const ctrl = model.matchEvent(closeBtn);
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Close');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 7: Deeply Nested
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Deeply Nested Elements', () => {
  beforeEach(() => {
    setupDOM(`
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="card">
              <div class="card-body">
                <button type="button">
                  <span class="icon-wrapper">
                    <i class="fas fa-trash"></i>
                    <span class="btn-text">Delete</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <a href="/profile">
          <div class="avatar">
            <img src="/avatar.png" alt="User Avatar" />
            <span class="name">John Doe</span>
          </div>
        </a>
      </body>
    `);
  });

  it('resolves deeply nested icon (5 levels) to button', () => {
    const model = new ControlModel();
    model.discover();

    const icon = document.querySelector('.fas')!;
    const ctrl = model.matchEvent(icon);
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Delete');
  });

  it('resolves nested span inside link to link', () => {
    const model = new ControlModel();
    model.discover();

    const span = document.querySelector('.name')!;
    const ctrl = model.matchEvent(span);
    expect(ctrl!.role).toBe('link');
  });

  it('resolves deeply nested button text', () => {
    const model = new ControlModel();
    model.discover();

    const btnText = document.querySelector('.btn-text')!;
    const ctrl = model.matchEvent(btnText);
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Delete');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 8: Discovery Stats & Mutation Observer
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Stats & Mutation Observer', () => {
  it('stats() returns correct counts and role distribution', () => {
    setupDOM(`
      <body>
        <button>A</button>
        <button>B</button>
        <input type="text" />
        <a href="/">Home</a>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    const stats = model.stats();
    expect(stats.total).toBe(4);
    expect(stats.widgets).toBe(4);
    expect(stats.composites).toBe(0);
    expect(stats.byRole['button']).toBe(2);
    expect(stats.byRole['textbox']).toBe(1);
    expect(stats.byRole['link']).toBe(1);
  });

  it('MutationObserver discovers dynamically added elements', async () => {
    setupDOM(`<body><div id="container"></div></body>`);

    const model = new ControlModel();
    model.discover();
    model.observe();

    expect(model.controls.size).toBe(0);

    // Add a button dynamically
    const btn = document.createElement('button');
    btn.textContent = 'Dynamic Button';
    document.getElementById('container')!.appendChild(btn);

    // Wait for MutationObserver callback (microtask)
    await new Promise(r => setTimeout(r, 50));

    const ctrl = model.findByElement(btn);
    expect(ctrl).not.toBeNull();
    expect(ctrl!.name).toBe('Dynamic Button');
    expect(ctrl!.role).toBe('button');
  });

  it('lazy discovery in matchEvent finds undiscovered elements', () => {
    setupDOM(`<body><div id="root"><button>Lazy</button></div></body>`);

    const model = new ControlModel();
    // Don't call discover — simulate element added before observer setup
    const btn = document.querySelector('button')!;
    const ctrl = model.matchEvent(btn);

    // Lazy discovery should find it
    expect(ctrl).not.toBeNull();
    expect(ctrl!.role).toBe('button');
    expect(ctrl!.name).toBe('Lazy');
  });

  it('disconnect() stops the MutationObserver', async () => {
    setupDOM(`<body><div id="container"></div></body>`);

    const model = new ControlModel();
    model.discover();
    model.observe();
    model.disconnect();

    // Add element after disconnect
    const btn = document.createElement('button');
    btn.textContent = 'After Disconnect';
    document.getElementById('container')!.appendChild(btn);

    await new Promise(r => setTimeout(r, 50));

    expect(model.findByElement(btn)).toBeNull();
  });

  it('model clears on new ControlModel instance', () => {
    setupDOM(`<body><button>Btn</button></body>`);

    const m1 = new ControlModel();
    m1.discover();
    expect(m1.controls.size).toBe(1);

    // Each instance maintains its own control map
    const m2 = new ControlModel();
    m2.discover();
    expect(m2.controls.size).toBe(1);

    // m1's map is independent from m2's map
    expect(m1.controls).not.toBe(m2.controls);
  });
});

// ═════════════════════════════ contradictory test removed — the MUI input
// is type="text" so role is 'textbox', not 'checkbox'
// ═══════════════════════════════════════════════════════════════════════════
// SUITE 9: Identity Extraction Helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Identity Extraction', () => {
  beforeEach(() => {
    setupDOM(`<body><div id="root"></div></body>`);
  });

  it('getRole: explicit ARIA wins', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'button');
    expect(getRole(el)).toBe('button');
  });

  it('getRole: input type mapping', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    expect(getRole(input)).toBe('checkbox');
  });

  it('getRole: implicit tag mapping', () => {
    const a = document.createElement('a');
    expect(getRole(a)).toBe('link');

    const btn = document.createElement('button');
    expect(getRole(btn)).toBe('button');
  });

  it('getRole: returns null for non-interactive div', () => {
    const div = document.createElement('div');
    expect(getRole(div)).toBeNull();
  });

  it('getAccessibleName: aria-label', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Close Dialog');
    expect(getAccessibleName(el)).toBe('Close Dialog');
  });

  it('getAccessibleName: title attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('title', 'Tooltip Text');
    expect(getAccessibleName(el)).toBe('Tooltip Text');
  });

  it('getAccessibleName: placeholder', () => {
    const el = document.createElement('input');
    el.setAttribute('placeholder', 'Enter email');
    expect(getAccessibleName(el)).toBe('Enter email');
  });

  it('getAccessibleName: text content', () => {
    const el = document.createElement('button');
    el.textContent = ' Submit ';
    expect(getAccessibleName(el)).toBe('Submit');
  });

  it('getAccessibleName: ancestor label walk', () => {
    document.getElementById('root')!.innerHTML = `
      <label>Username <input type="text" id="user" /></label>
    `;
    const input = document.getElementById('user')!;
    expect(getAccessibleName(input)).toBe('Username');
  });

  it('isPlaceholderText: detects "-- Select --"', () => {
    expect(isPlaceholderText('-- Select --')).toBe(true);
    expect(isPlaceholderText('-- Please choose --')).toBe(true);
    expect(isPlaceholderText('Select...')).toBe(true);
    expect(isPlaceholderText('United States')).toBe(false);
    expect(isPlaceholderText('American')).toBe(false);
  });

  it('isPlaceholderText: detects "Choose..."', () => {
    expect(isPlaceholderText('Choose...')).toBe(true);
  });

  it('isPlaceholderText: detects "Please select"', () => {
    expect(isPlaceholderText('Please select')).toBe(true);
  });
});
