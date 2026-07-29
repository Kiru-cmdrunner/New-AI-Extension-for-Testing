/**
 * Milestone 2: Event Matching Validation
 *
 * Validates assumption A4 (Event Traceability):
 * "Given a DOM event, can we correctly identify which logical Control
 * the user intended to interact with?"
 *
 * Tests event matching against representative DOM structures from:
 * - Semantic HTML (baseline)
 * - OrangeHRM OXD (the original failure case)
 * - MUI (React wrapper patterns)
 * - Shadow DOM (Web Components)
 * - Ant Design (class-based custom components)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ─── Control Model Types (minimal for prototype) ──────────────────────────

interface ControlNode {
  controlId: string;
  role: string | null;
  name: string;
  tag: string;
  classes: string[];
  isComposite: boolean;
  parentId: string | null;
  childIds: string[];
}

// ─── Framework Adapters ───────────────────────────────────────────────────

const OXD_CLASS_ROLE_MAP: Record<string, string> = {
  'oxd-select-text': 'combobox',    // clickable container with tabindex
  'oxd-select-text-input': 'combobox', // text display (fallback if clicked directly)
  'oxd-date-input': 'textbox',
  'oxd-date-day': 'gridcell',
  'oxd-button': 'button',
  'oxd-switch-input': 'switch',
  'oxd-input': 'textbox',
};

// OXD wrappers: not controls themselves but carry name context
const OXD_WRAPPER_CLASSES = new Set([
  'oxd-select-wrapper',
  'oxd-radio-wrapper',
  'oxd-checkbox-wrapper',
]);

function oxdInferRole(el: Element): string | null {
  const classList = (el.className || '').toString().split(/\s+/);
  for (const cls of classList) {
    if (OXD_CLASS_ROLE_MAP[cls]) return OXD_CLASS_ROLE_MAP[cls];
  }
  return null;
}

function isOxdWrapper(el: Element): boolean {
  const classList = (el.className || '').toString().split(/\s+/);
  return classList.some(c => OXD_WRAPPER_CLASSES.has(c));
}

// ─── Role Resolution ──────────────────────────────────────────────────────

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link', button: 'button', nav: 'navigation', main: 'main',
  aside: 'complementary', header: 'banner', footer: 'contentinfo',
  section: 'region', article: 'article', form: 'form', search: 'search',
  select: 'listbox', textarea: 'textbox', option: 'option',
  ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row',
  td: 'cell', th: 'rowheader', dialog: 'dialog', summary: 'button',
  details: 'group', fieldset: 'group', legend: 'legend',
  datalist: 'listbox', output: 'status', progress: 'progressbar',
  meter: 'meter', menu: 'menu', img: 'img',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
  h5: 'heading', h6: 'heading',
};

const INPUT_TYPE_ROLES: Record<string, string> = {
  button: 'button', checkbox: 'checkbox', image: 'button',
  number: 'spinbutton', radio: 'radio', range: 'slider',
  reset: 'button', search: 'searchbox', submit: 'button',
  tel: 'textbox', text: 'textbox', url: 'textbox', email: 'textbox',
  password: 'textbox', date: 'textbox', 'datetime-local': 'textbox',
  time: 'textbox', month: 'textbox', week: 'textbox', color: 'textbox',
  file: 'textbox',
};

const WIDGET_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
  'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'switch', 'slider', 'spinbutton', 'tab',
  'treeitem', 'gridcell', 'rowheader', 'columnheader',
]);

const COMPOSITE_ROLES = new Set([
  'combobox', 'listbox', 'menu', 'menubar', 'radiogroup',
  'tablist', 'tree', 'grid', 'treegrid', 'dialog', 'alertdialog',
]);

function getRole(el: Element): string | null {
  // 1. Explicit ARIA role
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  // 2. OXD framework adapter
  const oxdRole = oxdInferRole(el);
  if (oxdRole) return oxdRole;

  // 3. Implicit tag role
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    return INPUT_TYPE_ROLES[type] || null;
  }
  return IMPLICIT_ROLES[tag] || null;
}

// ─── Enhanced Accessible Name ─────────────────────────────────────────────

function getAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref?.textContent?.trim()) return ref.textContent.trim();
  }

  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // Walk ancestors looking for an enclosing <label> element.
  // Frameworks like MUI/Ant nest input inside spans inside <label>:
  //   <label><span><input/></span> Label Text</label>
  // We need to find the label regardless of nesting depth.
  // This walk also crosses shadow DOM boundaries.
  const ancestors = getAncestorChain(el);
  for (const ancestor of ancestors) {
    if (ancestor.tagName === 'LABEL') {
      const clone = ancestor.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input,textarea,select').forEach(e => e.remove());
      if (clone.textContent?.trim()) return clone.textContent.trim();
    }
  }

  // Own text content — but skip placeholder-like values
  const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || '';
  if (text && text.length < 200 && !isPlaceholderText(text)) return text;

  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  // Shadow DOM: if element is inside a shadow root, read host's text content
  // (slot-assigned text doesn't populate textContent inside the shadow root)
  const rootNode = el.getRootNode();
  if (rootNode instanceof ShadowRoot && rootNode.host) {
    const slotText = rootNode.host.textContent?.trim();
    if (slotText && slotText.length < 200 && !isPlaceholderText(slotText)) return slotText;
  }

  // Framework adapters: walk ancestors for wrapper-based name resolution
  for (const node of ancestors) {
    // OXD form group: name is in child .oxd-label above the input.
    // Check this BEFORE wrapper text so "-- Select --" doesn't win.
    const classes = (node.className || '').toString();
    if (classes.includes('oxd-input-group')) {
      const oxdLabel = node.querySelector('.oxd-label');
      if (oxdLabel?.textContent?.trim()) return oxdLabel.textContent.trim();
    }

    // OXD wrappers: name is the text content of the wrapper
    if (isOxdWrapper(node)) {
      const wrapperText = node.textContent?.trim();
      if (wrapperText && !isPlaceholderText(wrapperText)) return wrapperText;
    }

    // Generic group with legend/label
    if (node.getAttribute('role') === 'group' || node.tagName === 'FIELDSET') {
      const legend = node.querySelector('legend, .label');
      if (legend?.textContent?.trim()) return legend.textContent.trim();
    }

    // Framework form-control patterns: sibling label above the input
    if (classes.includes('MuiFormControl') || classes.includes('ant-form-item')) {
      const siblingLabel = node.querySelector('label, .MuiFormLabel-root, .ant-form-item-label');
      if (siblingLabel?.textContent?.trim()) return siblingLabel.textContent.trim();
    }

    // Shadow DOM host: slot text from light DOM
    const shadowHost = (node.getRootNode() as ShadowRoot)?.host;
    if (shadowHost) {
      const slotText = shadowHost.textContent?.trim();
      if (slotText && slotText.length < 200) return slotText;
    }
  }

  // Last resort: use the name attribute (e.g. <input name="dob" />)
  const nameAttr = el.getAttribute('name');
  if (nameAttr?.trim()) return nameAttr.trim();

  return '';
}

function isPlaceholderText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return lower === '-- select --' || lower.startsWith('--') ||
    lower === 'select...' || lower === 'please select' ||
    lower === 'choose...' || lower === 'none';
}

function getAncestorChain(el: Element): Element[] {
  const chain: Element[] = [];
  let node: Element | null = el.parentElement;

  // If parent is null, we may be inside a shadow root
  if (!node) {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      node = rootNode.host;
    }
  }

  for (let i = 0; i < 10 && node; i++) {
    chain.push(node);
    if (node.parentElement) {
      node = node.parentElement;
    } else {
      // Cross shadow boundary
      const rootNode = node.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        node = rootNode.host;
      } else {
        break;
      }
    }
  }
  return chain;
}

// ─── Control Model Builder ────────────────────────────────────────────────

interface ControlModel {
  controls: Map<string, ControlNode>;
  elementToControl: WeakMap<Element, string>;
  controlToElement: Map<string, Element>;
}

function buildControlModel(root: Element = document.body): ControlModel {
  const controls = new Map<string, ControlNode>();
  const elementToControl = new WeakMap<Element, string>();
  const controlToElement = new Map<string, Element>();
  let nextId = 1;

  function discover(node: Element, depth: number, parentId: string | null) {
    const role = getRole(node);
    const name = getAccessibleName(node);
    const tag = node.tagName.toLowerCase();
    const classList = (node.className || '').toString().split(/\s+/).filter(Boolean);

    const isWidget = role && WIDGET_ROLES.has(role);
    const isInteractiveTag = ['button', 'a', 'input', 'select', 'textarea', 'option', 'summary'].includes(tag);
    const oxdControl = oxdInferRole(node);
    const isControl = isWidget || isInteractiveTag || (oxdControl && !OXD_WRAPPER_CLASSES.has(classList.find(c => OXD_WRAPPER_CLASSES.has(c)) || ''));

    let myId: string | null = null;

    if (isControl) {
      myId = `ctrl-${nextId++}`;
      const control: ControlNode = {
        controlId: myId,
        role,
        name: name || '(unnamed)',
        tag,
        classes: classList,
        isComposite: role ? COMPOSITE_ROLES.has(role) : false,
        parentId,
        childIds: [],
      };
      controls.set(myId, control);
      elementToControl.set(node, myId);
      controlToElement.set(myId, node);

      if (parentId && controls.has(parentId)) {
        controls.get(parentId)!.childIds.push(myId);
      }
    }

    // Walk children
    for (const child of Array.from(node.children)) {
      discover(child, depth + 1, myId || parentId);
    }

    // Walk open shadow DOM
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.children)) {
        discover(child, depth + 1, myId || parentId);
      }
    }
  }

  discover(root, 0, null);
  return { controls, elementToControl, controlToElement };
}

// ─── Event Matcher ────────────────────────────────────────────────────────

interface MatchResult {
  control: ControlNode | null;
  matchStrategy: string;
  pathDepth: number;
  visitedElements: { tag: string; role: string | null; classes: string }[];
}

function simulateComposedPath(targetEl: Element): Element[] {
  const path: Element[] = [];
  let node: Element | null = targetEl;
  while (node) {
    path.push(node);
    if (node.parentElement) {
      node = node.parentElement;
    } else {
      const shadowHost = (node.getRootNode() as ShadowRoot)?.host;
      node = shadowHost || null;
    }
  }
  return path;
}

function matchEvent(
  targetEl: Element,
  model: ControlModel,
): MatchResult {
  const path = simulateComposedPath(targetEl);
  const visited: MatchResult['visitedElements'] = [];

  // Strategy 1: Direct WeakMap lookup along composedPath
  for (let i = 0; i < path.length; i++) {
    const el = path[i];
    const ctrlId = model.elementToControl.get(el);
    if (ctrlId) {
      return {
        control: model.controls.get(ctrlId) || null,
        matchStrategy: i === 0 ? 'direct-target' : 'ancestor-walk',
        pathDepth: i,
        visitedElements: visited,
      };
    }
    visited.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      classes: (el.className || '').toString().slice(0, 60),
    });
  }

  // Strategy 2: Framework wrapper fallback (container-to-control)
  // This handles the case where the event target is a wrapper element that
  // contains the real control — e.g. an OXD radio-wrapper div, an Ant
  // .ant-checkbox-wrapper label, or a MUI .MuiFormControlLabel-root.
  // We look for a control WITHIN the wrapper element (querySelector).
  for (const el of path) {
    // OXD wrapper: find input inside
    if (isOxdWrapper(el)) {
      const input = el.querySelector('input[type="radio"], input[type="checkbox"]');
      if (input) {
        const ctrlId = model.elementToControl.get(input);
        if (ctrlId) {
          return {
            control: model.controls.get(ctrlId) || null,
            matchStrategy: 'wrapper-fallback',
            pathDepth: -1,
            visitedElements: visited,
          };
        }
      }
    }
    // Framework label wrappers: <label class="...wrapper"> contains an input
    // This covers MUI .MuiFormControlLabel-root, Ant .ant-checkbox-wrapper, etc.
    if (el.tagName === 'LABEL' && el.querySelector('input')) {
      const input = el.querySelector('input[type="radio"], input[type="checkbox"], input[type="text"], button');
      if (input && model.elementToControl.has(input)) {
        const ctrlId = model.elementToControl.get(input)!;
        return {
          control: model.controls.get(ctrlId) || null,
          matchStrategy: 'label-wrapper-fallback',
          pathDepth: -1,
          visitedElements: visited,
        };
      }
    }
  }

  return {
    control: null,
    matchStrategy: 'no-match',
    pathDepth: -1,
    visitedElements: visited,
  };
}

// ─── Test Helpers ─────────────────────────────────────────────────────────

function expectMatch(
  target: Element,
  model: ControlModel,
  expected: { role: string; nameContains?: string },
  label: string,
) {
  const result = matchEvent(target, model);
  expect(result.control, `${label}: should match a control`).to.not.be.null;
  expect(result.control!.role, `${label}: role should be ${expected.role}`).toBe(expected.role);
  if (expected.nameContains) {
    expect(result.control!.name.toLowerCase(), `${label}: name should contain "${expected.nameContains}"`)
      .toContain(expected.nameContains.toLowerCase());
  }
  return result;
}

// ─── Test Suites ──────────────────────────────────────────────────────────

describe('Milestone 2: Event Matching — Semantic HTML (baseline)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <div>
          <label for="fname">First Name</label>
          <input id="fname" type="text" />
        </div>
        <div>
          <label for="lname">Last Name</label>
          <input id="lname" type="text" />
        </div>
        <fieldset>
          <legend>Gender</legend>
          <label><input type="radio" name="gender" value="male" /> Male</label>
          <label><input type="radio" name="gender" value="female" /> Female</label>
        </fieldset>
        <button type="submit">Save</button>
        <a href="/nav">Dashboard</a>
      </form>
    `;
  });

  it('matches direct click on text input', () => {
    const model = buildControlModel();
    const input = document.getElementById('fname')!;
    expectMatch(input, model, { role: 'textbox', nameContains: 'First Name' }, 'First Name input');
  });

  it('matches click inside <label> to the contained input (radio)', () => {
    const model = buildControlModel();
    // Click on the label that wraps the radio input
    const radioLabels = document.querySelectorAll('fieldset label');
    const femaleLabel = radioLabels[1]!;
    // The input is a descendant of the label — composedPath from the input
    // goes through the label. But clicking the label text itself means
    // event.target is the label, which the label-wrapper-fallback handles.
    const result = matchEvent(femaleLabel, model);
    // label-wrapper-fallback: <label> wrapping an input
    expect(result.control, 'Label click should resolve to radio').to.not.be.null;
    expect(result.control!.role).toBe('radio');
    expect(result.control!.name.toLowerCase()).toContain('female');
  });

  it('matches Save button via direct click', () => {
    const model = buildControlModel();
    const btn = document.querySelector('button[type="submit"]')!;
    expectMatch(btn, model, { role: 'button', nameContains: 'Save' }, 'Save button');
  });

  it('matches link via direct click', () => {
    const model = buildControlModel();
    const link = document.querySelector('a')!;
    expectMatch(link, model, { role: 'link', nameContains: 'Dashboard' }, 'Dashboard link');
  });

  it('no control matched for purely decorative div', () => {
    document.body.innerHTML = '<div><span>Some text</span></div>';
    const model = buildControlModel();
    const span = document.querySelector('span')!;
    const result = matchEvent(span, model);
    expect(result.control).to.be.null;
  });
});

describe('Milestone 2: Event Matching — OrangeHRM OXD (the original failure)', () => {
  beforeEach(() => {
    // Replicate OXD DOM structure from OrangeHRM My Info page
    document.body.innerHTML = `
      <form>
        <!-- Text inputs with label above -->
        <div class="oxd-form-row">
          <div class="--name-grouped-field">
            <div class="oxd-input-group">
              <label class="oxd-label">First Name</label>
              <div class="oxd-input-field">
                <input class="oxd-input" type="text" name="firstName" />
              </div>
            </div>
          </div>
        </div>

        <!-- OXD Custom Dropdown (the CRITICAL failure case) -->
        <div class="oxd-form-row">
          <div class="oxd-input-group">
            <label class="oxd-label">Nationality</label>
            <div class="oxd-select-wrapper">
              <div class="oxd-select-text" tabindex="0">
                <div class="oxd-select-text-input">-- Select --</div>
                <i class="oxd-select-text-icon"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- OXD Custom Dropdown #2 (was mismatched to Blood Type in v10.4.18) -->
        <div class="oxd-form-row">
          <div class="oxd-input-group">
            <label class="oxd-label">Marital Status</label>
            <div class="oxd-select-wrapper">
              <div class="oxd-select-text" tabindex="0">
                <div class="oxd-select-text-input">-- Select --</div>
                <i class="oxd-select-text-icon"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- OXD Radio buttons (name on wrapper, input hidden) -->
        <div class="oxd-form-row">
          <div class="oxd-input-group">
            <label class="oxd-label">Gender</label>
            <div class="oxd-radio-wrapper">
              <label>
                <input type="radio" name="gender" value="male" />
                <span class="oxd-radio-input"></span>
                <span>Male</span>
              </label>
            </div>
            <div class="oxd-radio-wrapper">
              <label>
                <input type="radio" name="gender" value="female" />
                <span class="oxd-radio-input"></span>
                <span>Female</span>
              </label>
            </div>
          </div>
        </div>

        <!-- OXD Checkbox -->
        <div class="oxd-form-row">
          <div class="oxd-input-group">
            <label class="oxd-label">Smoker</label>
            <div class="oxd-checkbox-wrapper">
              <label>
                <input type="checkbox" name="smoker" />
                <span class="oxd-checkbox-input"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Save button with icon inside -->
        <button type="submit" class="oxd-button oxd-button--secondary">
          <i class="oxd-icon save"></i>
          <span>Save</span>
        </button>
      </form>
    `;
  });

  it('matches Nationality dropdown trigger as combobox', () => {
    const model = buildControlModel();
    const trigger = document.querySelector('.oxd-select-text-input')!;
    const result = expectMatch(trigger, model, { role: 'combobox' }, 'Nationality dropdown');
    // CRITICAL: verify it does NOT match Blood Type or any other dropdown
    expect(result.control!.classes).toContain('oxd-select-text-input');
  });

  it('matches Marital Status dropdown as a SEPARATE combobox (not Nationality)', () => {
    const model = buildControlModel();
    const triggers = document.querySelectorAll('.oxd-select-text-input');
    expect(triggers.length).toBe(2);

    const nationalityResult = matchEvent(triggers[0], model);
    const maritalResult = matchEvent(triggers[1], model);

    expect(nationalityResult.control, 'Nationality should match').to.not.be.null;
    expect(maritalResult.control, 'Marital Status should match').to.not.be.null;

    // CRITICAL: they must be different controls
    expect(nationalityResult.control!.controlId).not.toBe(maritalResult.control!.controlId);
  });

  it('matches dropdown trigger click on the icon (decorative child)', () => {
    const model = buildControlModel();
    // Click on the icon inside the dropdown trigger
    const icon = document.querySelector('.oxd-select-text-icon')!;
    const result = matchEvent(icon, model);
    // Icon is decorative; should walk up to find the combobox
    expect(result.control, 'Icon click should resolve to combobox').to.not.be.null;
    expect(result.control!.role).toBe('combobox');
  });

  it('matches Female radio via wrapper click', () => {
    const model = buildControlModel();
    // Click on the radio wrapper (common UX — click label text area)
    const wrapper = document.querySelectorAll('.oxd-radio-wrapper')[1]!;
    const result = matchEvent(wrapper, model);
    expect(result.control, 'Wrapper click should resolve to radio').to.not.be.null;
    expect(result.control!.role).toBe('radio');
    expect(result.control!.name.toLowerCase()).toContain('female');
  });

  it('matches Female radio via label text', () => {
    const model = buildControlModel();
    // Click on the "Female" text span inside the label
    const label = document.querySelectorAll('.oxd-radio-wrapper label')[1]!;
    const result = matchEvent(label, model);
    expect(result.control, 'Label click should resolve to radio').to.not.be.null;
    expect(result.control!.role).toBe('radio');
  });

  it('matches Female radio via direct input click', () => {
    const model = buildControlModel();
    const input = document.querySelectorAll('input[type="radio"]')[1]!;
    expectMatch(input, model, { role: 'radio', nameContains: 'Female' }, 'Female radio input');
  });

  it('matches Smoker checkbox via wrapper click', () => {
    const model = buildControlModel();
    const wrapper = document.querySelector('.oxd-checkbox-wrapper')!;
    const result = matchEvent(wrapper, model);
    expect(result.control, 'Wrapper click should resolve to checkbox').to.not.be.null;
    expect(result.control!.role).toBe('checkbox');
  });

  it('matches Save button when clicking the icon inside it', () => {
    const model = buildControlModel();
    const icon = document.querySelector('button[type="submit"] .oxd-icon')!;
    const result = matchEvent(icon, model);
    expect(result.control, 'Icon click should resolve to button').to.not.be.null;
    expect(result.control!.role).toBe('button');
    expect(result.control!.name.toLowerCase()).toContain('save');
    expect(result.matchStrategy).toBe('ancestor-walk');
  });

  it('matches Save button when clicking the span text', () => {
    const model = buildControlModel();
    const span = document.querySelector('button[type="submit"] span')!;
    const result = matchEvent(span, model);
    expect(result.control!.role).toBe('button');
    expect(result.control!.name.toLowerCase()).toContain('save');
  });

  it('does NOT cross dropdown boundaries (Nationality stays Nationality)', () => {
    const model = buildControlModel();
    // This is the v10.4.18 bug: clicking Nationality resolved to Blood Type
    // because resolveTarget returned the first [tabindex] match
    const nationalityTrigger = document.querySelectorAll('.oxd-select-text-input')[0]!;
    const result = matchEvent(nationalityTrigger, model);
    expect(result.control!.role).toBe('combobox');

    // Verify the name resolves from the label above, not a sibling
    const nameEl = result.control!.name.toLowerCase();
    expect(nameEl).toContain('nationality');
    expect(nameEl).not.toContain('marital');
    expect(nameEl).not.toContain('blood');
  });
});

describe('Milestone 2: Event Matching — MUI (React Material UI)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <!-- MUI Button with ripple wrapper -->
        <button class="MuiButtonBase-root MuiButton-root" type="button">
          <span class="MuiButton-label">Submit Form</span>
          <span class="MuiTouchRipple-root"></span>
        </button>

        <!-- MUI Checkbox with wrapper -->
        <label class="MuiFormControlLabel-root">
          <span class="MuiButtonBase-root MuiCheckbox-root PrivateSwitchBase-root">
            <input type="checkbox" class="PrivateSwitchBase-input" />
          </span>
          <span class="MuiFormControlLabel-label">Accept Terms</span>
        </label>

        <!-- MUI Autocomplete (combobox pattern) -->
        <div class="MuiAutocomplete-root">
          <div class="MuiFormControl-root">
            <label class="MuiFormLabel-root">Country</label>
            <div class="MuiInputBase-root">
              <input type="text" role="combobox" aria-expanded="false" />
            </div>
          </div>
        </div>

        <!-- MUI Tab list -->
        <div class="MuiTabs-root">
          <div class="MuiTabs-scroller">
            <div class="MuiTabs-flexContainer" role="tablist">
              <button class="MuiTab-root" role="tab" aria-selected="true">Profile</button>
              <button class="MuiTab-root" role="tab" aria-selected="false">Settings</button>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  it('matches MUI button via ripple span click (decorative child)', () => {
    const model = buildControlModel();
    const ripple = document.querySelector('.MuiTouchRipple-root')!;
    const result = matchEvent(ripple, model);
    expect(result.control!.role).toBe('button');
    expect(result.control!.name.toLowerCase()).toContain('submit');
  });

  it('matches MUI checkbox via label wrapper click', () => {
    const model = buildControlModel();
    const labelWrapper = document.querySelector('.MuiFormControlLabel-root')!;
    const result = matchEvent(labelWrapper, model);
    expect(result.control!.role).toBe('checkbox');
    expect(result.control!.name.toLowerCase()).toContain('accept');
  });

  it('matches MUI autocomplete as combobox', () => {
    const model = buildControlModel();
    const input = document.querySelector('input[role="combobox"]')!;
    expectMatch(input, model, { role: 'combobox', nameContains: 'Country' }, 'MUI autocomplete');
  });

  it('matches MUI tabs', () => {
    const model = buildControlModel();
    const tab = document.querySelector('[role="tab"]')!;
    expectMatch(tab, model, { role: 'tab', nameContains: 'Profile' }, 'Profile tab');
  });
});

describe('Milestone 2: Event Matching — Ant Design', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <!-- Ant Design Button -->
        <button class="ant-btn ant-btn-primary" type="button">
          <span>Confirm</span>
        </button>

        <!-- Ant Design Checkbox -->
        <label class="ant-checkbox-wrapper">
          <span class="ant-checkbox">
            <input type="checkbox" class="ant-checkbox-input" />
            <span class="ant-checkbox-inner"></span>
          </span>
          <span>Remember me</span>
        </label>

        <!-- Ant Design Select (custom dropdown) -->
        <div class="ant-select ant-select-single">
          <div class="ant-select-selector">
            <span class="ant-select-selection-search">
              <input type="search" class="ant-select-selection-search-input" role="combobox" readonly />
            </span>
            <span class="ant-select-selection-item">China</span>
          </div>
        </div>

        <!-- Ant Design Radio Group -->
        <div class="ant-radio-group" role="radiogroup">
          <label class="ant-radio-wrapper">
            <span class="ant-radio">
              <input type="radio" name="size" value="small" class="ant-radio-input" />
              <span class="ant-radio-inner"></span>
            </span>
            <span>Small</span>
          </label>
          <label class="ant-radio-wrapper">
            <span class="ant-radio">
              <input type="radio" name="size" value="large" class="ant-radio-input" />
              <span class="ant-radio-inner"></span>
            </span>
            <span>Large</span>
          </label>
        </div>
      </div>
    `;
  });

  it('matches Ant button via span click', () => {
    const model = buildControlModel();
    const span = document.querySelector('.ant-btn span')!;
    const result = matchEvent(span, model);
    expect(result.control!.role).toBe('button');
    expect(result.control!.name.toLowerCase()).toContain('confirm');
  });

  it('matches Ant checkbox via wrapper label', () => {
    const model = buildControlModel();
    const wrapper = document.querySelector('.ant-checkbox-wrapper')!;
    const result = matchEvent(wrapper, model);
    expect(result.control!.role).toBe('checkbox');
    expect(result.control!.name.toLowerCase()).toContain('remember');
  });

  it('matches Ant select (custom) as combobox', () => {
    const model = buildControlModel();
    const searchInput = document.querySelector('input[role="combobox"]')!;
    expectMatch(searchInput, model, { role: 'combobox' }, 'Ant select');
  });

  it('matches Ant radio via wrapper label click', () => {
    const model = buildControlModel();
    const wrappers = document.querySelectorAll('.ant-radio-wrapper');
    const largeWrapper = wrappers[1]!;
    const result = matchEvent(largeWrapper, model);
    expect(result.control!.role).toBe('radio');
    expect(result.control!.name.toLowerCase()).toContain('large');
  });
});

describe('Milestone 2: Event Matching — Shadow DOM (Web Components)', () => {
  beforeEach(() => {
    // Shoelace-style component: custom element with open shadow root
    const host = document.createElement('sl-button');
    host.setAttribute('variant', 'primary');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <button part="base">
        <slot></slot>
      </button>
    `;

    // Put text in the light DOM slot
    host.textContent = 'Click Me';

    // Shoelace-style checkbox
    const checkboxHost = document.createElement('sl-checkbox');
    checkboxHost.setAttribute('checked', '');
    const cbShadow = checkboxHost.attachShadow({ mode: 'open' });
    cbShadow.innerHTML = `
      <span part="control">
        <input type="checkbox" part="input" checked />
      </span>
      <slot></slot>
    `;
    checkboxHost.textContent = 'Enable feature';

    document.body.innerHTML = '';
    document.body.appendChild(host);
    document.body.appendChild(checkboxHost);
  });

  it('discovers shadow DOM button', () => {
    const model = buildControlModel();
    const controls = Array.from(model.controls.values());
    const buttons = controls.filter(c => c.role === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons.some(c => c.name.includes('Click'))).toBe(true);
  });

  it('discovers shadow DOM checkbox', () => {
    const model = buildControlModel();
    const controls = Array.from(model.controls.values());
    const checkboxes = controls.filter(c => c.role === 'checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(1);
  });

  it('matches click on shadow DOM button', () => {
    const model = buildControlModel();
    const shadowButton = document.querySelector('sl-button')!.shadowRoot!.querySelector('button')!;
    const result = matchEvent(shadowButton, model);
    expect(result.control!.role).toBe('button');
  });
});

describe('Milestone 2: Event Matching — Composite Controls', () => {
  beforeEach(() => {
    // Open dropdown list — composite: combobox parent, options children
    document.body.innerHTML = `
      <div>
        <div role="combobox" aria-expanded="true" aria-haspopup="listbox">
          <input type="text" aria-controls="listbox1" value="" />
        </div>
        <ul id="listbox1" role="listbox">
          <li role="option" id="opt1">Option A</li>
          <li role="option" id="opt2">Option B</li>
          <li role="option" id="opt3">Option C</li>
        </ul>

        <!-- Tab panel composite -->
        <div role="tablist">
          <button role="tab" aria-selected="true" aria-controls="panel1">Tab 1</button>
          <button role="tab" aria-selected="false" aria-controls="panel2">Tab 2</button>
        </div>
        <div role="tabpanel" id="panel1">Content 1</div>
        <div role="tabpanel" id="panel2">Content 2</div>
      </div>
    `;
  });

  it('matches option click within listbox', () => {
    const model = buildControlModel();
    const option = document.getElementById('opt2')!;
    expectMatch(option, model, { role: 'option', nameContains: 'Option B' }, 'Option B');
  });

  it('matches combobox input', () => {
    const model = buildControlModel();
    const input = document.querySelector('input[role]') || document.querySelector('input[type="text"]')!;
    expectMatch(input, model, { role: 'textbox' }, 'Combobox input');
  });

  it('tracks parent-child relationships (option → listbox)', () => {
    const model = buildControlModel();
    const option = document.getElementById('opt2')!;
    const result = matchEvent(option, model);
    expect(result.control!.parentId).not.toBeNull();
  });

  it('matches tabs within tablist', () => {
    const model = buildControlModel();
    const tab2 = document.querySelectorAll('[role="tab"]')[1]!;
    expectMatch(tab2, model, { role: 'tab', nameContains: 'Tab 2' }, 'Tab 2');
  });
});

describe('Milestone 2: Event Matching — Deeply Nested Decorative Elements', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="form-group">
            <div class="input-wrapper">
              <div class="input-icon-container">
                <i class="icon icon-calendar"></i>
                <input type="date" id="dob" name="dob" />
              </div>
            </div>
          </div>
        </div>
        <div class="card-footer">
          <div class="btn-group">
            <div class="btn-inner">
              <button type="submit">Submit</button>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  it('matches date input through deep nesting', () => {
    const model = buildControlModel();
    const input = document.getElementById('dob')!;
    const result = matchEvent(input, model);
    expect(result.control, 'Date input should match').to.not.be.null;
    expect(result.control!.role).toBe('textbox');
    // No label — name falls back to 'dob' from name attribute
    expect(result.control!.name.toLowerCase()).toContain('dob');
  });

  it('matches submit button through deep nesting', () => {
    const model = buildControlModel();
    const button = document.querySelector('button[type="submit"]')!;
    expectMatch(button, model, { role: 'button', nameContains: 'Submit' }, 'Submit button');
  });

  it('matches submit button when clicking a deeply nested parent', () => {
    const model = buildControlModel();
    // Click on .btn-inner which wraps the button
    const wrapper = document.querySelector('.btn-inner')!;
    const result = matchEvent(wrapper, model);
    // .btn-inner is a div — if it's an ancestor of the button, composedPath of
    // the button would include .btn-inner. But here we're matching FROM .btn-inner
    // as the event target. .btn-inner contains a button as child.
    //
    // With the label-wrapper fallback: .btn-inner is a div (not a label),
    // but it does contain a button. Our fallback only checks <label> wrappers,
    // so this should correctly return null — clicking a div that happens to
    // contain a button doesn't mean the button was clicked.
    expect(result.control).to.be.null;
  });
});

describe('Milestone 2: Control Model Statistics', () => {
  it('counts controls in OXD form', () => {
    document.body.innerHTML = `
      <form>
        <input class="oxd-input" type="text" />
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
        </div>
        <div class="oxd-radio-wrapper">
          <label><input type="radio" name="g" /> Male</label>
        </div>
        <div class="oxd-radio-wrapper">
          <label><input type="radio" name="g" /> Female</label>
        </div>
        <button class="oxd-button">Save</button>
      </form>
    `;
    const model = buildControlModel();
    const controls = Array.from(model.controls.values());

    console.log('OXD form controls discovered:', controls.length);
    console.log('By role:', controls.reduce((acc, c) => {
      acc[c.role || 'none'] = (acc[c.role || 'none'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>));

    // Should discover: 1 textbox, 1 combobox, 2 radios, 1 button = 5 controls
    expect(controls.length).toBe(5);
  });
});
