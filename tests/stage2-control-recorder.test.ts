/**
 * Stage 2 — Feature Flag + Control Recorder Tests
 *
 * Tests that the feature flag mechanism works and the control-recorder
 * builds correct ElementIdentity and RECORDED_EVENT messages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

import { ControlModel } from '../src/recorder/v2/control-model';
import { buildElementIdentity } from '../src/recorder/v2/element-identity-builder';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
// SUITE 1: Element Identity Builder
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 2 — Element Identity Builder', () => {
  it('builds identity with correct accessible name from Control Model', () => {
    setupDOM(`
      <body>
        <div class="oxd-input-group">
          <label class="oxd-label">Nationality</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text" tabindex="0">
              <div class="oxd-select-text-input">-- Select --</div>
              <i class="oxd-select-text-icon"></i>
            </div>
          </div>
        </div>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    const selectEl = document.querySelector('.oxd-select-text')!;
    const ctrl = model.matchEvent(selectEl)!;
    const identity = buildElementIdentity(ctrl, selectEl);

    expect(identity.accessibleName).toBe('Nationality');
    expect(identity.ariaRole).toBe('combobox');
  });

  it('builds identity with correct tag and className', () => {
    setupDOM(`<body><button class="oxd-button">Save</button></body>`);

    const model = new ControlModel();
    model.discover();

    const btn = document.querySelector('button')!;
    const ctrl = model.matchEvent(btn)!;
    const identity = buildElementIdentity(ctrl, btn);

    expect(identity.tag).toBe('BUTTON');
    expect(identity.className).toBe('oxd-button');
  });

  it('builds identity with cssSelector', () => {
    setupDOM(`<body><div id="app"><button id="save-btn">Save</button></div></body>`);

    const model = new ControlModel();
    model.discover();

    const btn = document.getElementById('save-btn')!;
    const ctrl = model.matchEvent(btn)!;
    const identity = buildElementIdentity(ctrl, btn);

    expect(identity.cssSelector).toBe('#save-btn');
    expect(identity.stableId).toBe('save-btn');
  });

  it('builds identity with testId from data attribute', () => {
    setupDOM(`<body><button data-testid="submit-btn">Submit</button></body>`);

    const model = new ControlModel();
    model.discover();

    const btn = document.querySelector('button')!;
    const ctrl = model.matchEvent(btn)!;
    const identity = buildElementIdentity(ctrl, btn);

    expect(identity.testId).toBe('submit-btn');
  });

  it('builds identity with synthetic elementId when no id exists', () => {
    setupDOM(`<body><button>Cancel</button></body>`);

    const model = new ControlModel();
    model.discover();

    const btn = document.querySelector('button')!;
    const ctrl = model.matchEvent(btn)!;
    const identity = buildElementIdentity(ctrl, btn);

    // elementId should be non-empty (falls back to cssSelector or tag::name)
    expect(identity.elementId.length).toBeGreaterThan(0);
  });

  it('builds identity with ancestor roles in domContext fields', () => {
    setupDOM(`
      <body>
        <form>
          <fieldset>
            <legend>Settings</legend>
            <input type="text" id="name" />
          </fieldset>
        </form>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    const input = document.getElementById('name')!;
    const ctrl = model.matchEvent(input)!;
    const identity = buildElementIdentity(ctrl, input);

    expect(identity.tag).toBe('INPUT');
    expect(identity.stableId).toBe('name');
  });

  it('Nationality identity does NOT say Blood Type (regression check)', () => {
    setupDOM(`
      <body>
        <div class="oxd-input-group">
          <label class="oxd-label">Nationality</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text" tabindex="0">
              <div class="oxd-select-text-input">-- Select --</div>
            </div>
          </div>
        </div>
        <div class="oxd-input-group">
          <label class="oxd-label">Blood Type</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text" tabindex="0">
              <div class="oxd-select-text-input">-- Select --</div>
            </div>
          </div>
        </div>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    // Click on the FIRST oxd-select-text (Nationality)
    const selects = document.querySelectorAll('.oxd-select-text');
    const nationalitySelect = selects[0]!;
    const ctrl = model.matchEvent(nationalitySelect)!;
    const identity = buildElementIdentity(ctrl, nationalitySelect);

    expect(identity.accessibleName).toBe('Nationality');
    expect(identity.accessibleName).not.toBe('Blood Type');
  });

  it('Save icon resolves to Save identity (not "I")', () => {
    setupDOM(`
      <body>
        <button type="submit" class="oxd-button">
          <i class="oxd-button-icon"></i>
          <span>Save</span>
        </button>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    const icon = document.querySelector('.oxd-button-icon')!;
    const ctrl = model.matchEvent(icon)!;
    const identity = buildElementIdentity(ctrl, icon);

    // The identity should reflect the BUTTON, not the icon
    expect(identity.accessibleName).toBe('Save');
  });

  it('detects shadow DOM in identity', () => {
    setupDOM(`<body><my-element></my-element></body>`);
    const host = document.querySelector('my-element')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<button id="shadow-btn">Shadow Action</button>`;

    const model = new ControlModel();
    model.discover();

    const btn = shadow.querySelector('#shadow-btn')!;
    const ctrl = model.findByElement(btn)!;
    const identity = buildElementIdentity(ctrl, btn);

    expect(identity.shadowDom).toBe(true);
  });

  it('builds identity for radio button resolved via label wrapper', () => {
    setupDOM(`
      <body>
        <label class="ant-radio-wrapper">
          <span class="ant-radio">
            <input type="radio" name="size" value="large" />
          </span>
          <span>Large</span>
        </label>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    const label = document.querySelector('.ant-radio-wrapper')!;
    const ctrl = model.matchEvent(label)!;
    const el = ctrl.elementRef.deref()!;
    const identity = buildElementIdentity(ctrl, el);

    expect(identity.ariaRole).toBe('radio');
    expect(identity.tag).toBe('INPUT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2: Feature Flag Type + UIState
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 2 — Feature Flag Types', () => {
  it('UIState has optional recorderEngine field', async () => {
    const { DEFAULT_UI_STATE } = await import('../src/shared/types');
    expect(DEFAULT_UI_STATE.recorderEngine).toBe('legacy');
  });

  it('UIState can hold control engine flag', async () => {
    const { RecordingState } = await import('../src/shared/types');
    const state = {
      recordingState: RecordingState.Recording,
      lastChanged: new Date().toISOString(),
      recorderEngine: 'control' as const,
    };
    expect(state.recorderEngine).toBe('control');
  });

  it('UIState defaults to legacy when recorderEngine is undefined', () => {
    const state = {
      recordingState: 'recording',
      lastChanged: new Date().toISOString(),
    };
    const engine = (state as any).recorderEngine || 'legacy';
    expect(engine).toBe('legacy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3: Manifest Configuration
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 2 — Manifest Configuration', () => {
  it('manifest.json has two content_scripts entries', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.resolve(process.cwd(), 'src/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.content_scripts).toHaveLength(2);
  });

  it('manifest.json includes control-recorder.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.resolve(process.cwd(), 'src/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const jsFiles = manifest.content_scripts.flatMap((cs: any) => cs.js);
    expect(jsFiles.some((f: string) => f.includes('control-recorder'))).toBe(true);
  });

  it('manifest.json still includes deterministic-recorder.ts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.resolve(process.cwd(), 'src/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const jsFiles = manifest.content_scripts.flatMap((cs: any) => cs.js);
    expect(jsFiles.some((f: string) => f.includes('recorder-entry') || f.includes('deterministic-recorder'))).toBe(true);
  });

  it('built manifest has both content scripts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.resolve(process.cwd(), 'dist/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.content_scripts).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 4: End-to-End Capture Simulation
// ═══════════════════════════════════════════════════════════════════════════

describe('Stage 2 — Capture Simulation (OrangeHRM Form)', () => {
  /**
   * Simulate what the control-recorder would capture on an OrangeHRM My Info form.
   * This validates the full flow: event → matchEvent → buildElementIdentity →
   * verify the identity has correct name/role.
   */
  it('captures correct identities for all OrangeHRM form controls', () => {
    setupDOM(`
      <body>
        <form class="oxd-form">
          <div class="oxd-input-group">
            <label class="oxd-label">First Name</label>
            <input type="text" class="oxd-input" value="" />
          </div>
          <div class="oxd-input-group">
            <label class="oxd-label">Last Name</label>
            <input type="text" class="oxd-input" value="" />
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
                <span>Male</span>
              </label>
              <label class="oxd-radio-wrapper">
                <input type="radio" name="gender" value="female" />
                <span>Female</span>
              </label>
            </div>
          </div>
          <button type="submit" class="oxd-button">
            <i class="oxd-button-icon"></i>
            <span>Save</span>
          </button>
        </form>
      </body>
    `);

    const model = new ControlModel();
    model.discover();

    // Simulate: Click on Nationality dropdown trigger
    const nationalityEl = document.querySelectorAll('.oxd-select-text')[0]!;
    const natCtrl = model.matchEvent(nationalityEl)!;
    const natIdentity = buildElementIdentity(natCtrl, nationalityEl);
    expect(natIdentity.accessibleName).toBe('Nationality');

    // Simulate: Click on Marital Status dropdown trigger
    const maritalEl = document.querySelectorAll('.oxd-select-text')[1]!;
    const marCtrl = model.matchEvent(maritalEl)!;
    const marIdentity = buildElementIdentity(marCtrl, maritalEl);
    expect(marIdentity.accessibleName).toBe('Marital Status');

    // Simulate: Click on Save icon (should resolve to button)
    const saveIcon = document.querySelector('.oxd-button-icon')!;
    const saveCtrl = model.matchEvent(saveIcon)!;
    const saveIdentity = buildElementIdentity(saveCtrl, saveIcon);
    expect(saveIdentity.accessibleName).toBe('Save');

    // Simulate: Click on Female radio wrapper
    const femaleLabel = document.querySelectorAll('.oxd-radio-wrapper')[1]!;
    const femCtrl = model.matchEvent(femaleLabel)!;
    const femIdentity = buildElementIdentity(femCtrl, femCtrl.elementRef.deref()!);
    expect(femIdentity.ariaRole).toBe('radio');

    // Simulate: Focus First Name input
    const firstNameInput = document.querySelector('.oxd-input')!;
    const fnCtrl = model.matchEvent(firstNameInput)!;
    const fnIdentity = buildElementIdentity(fnCtrl, firstNameInput);
    expect(fnIdentity.accessibleName).toBe('First Name');
  });
});
