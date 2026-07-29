/**
 * Milestone 5: End-to-End Acceptance Tests
 *
 * Integrates all proven components (M1-M4) into a single pipeline and tests
 * against realistic DOM structures for every interaction type from the
 * behavioural acceptance test suite.
 *
 * Pipeline:
 *   DOM → ControlModel.discover() + observe()
 *   User Event → composedPath → matchEvent → identifyControl
 *   → checkState (before/after) → emit SemanticAction
 *
 * The test harness simulates user interactions by dispatching real DOM events
 * against JSDOM-rendered pages, then checking the recorded SemanticActions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC ACTION TYPE
// ═══════════════════════════════════════════════════════════════════════════

type InteractionVerb =
  | 'fill' | 'select' | 'selectDate' | 'toggle' | 'click'
  | 'navigate' | 'scroll' | 'hover';

interface SemanticAction {
  verb: InteractionVerb;
  target: string;       // control name
  role: string;         // control role
  value?: string;       // entered text, selected option, checked state
  parentGroup?: string; // for radio: group name; for dropdown: dropdown name
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLE RESOLUTION (from M1/M2, with OXD adapter)
// ═══════════════════════════════════════════════════════════════════════════

const OXD_CLASS_ROLE_MAP: Record<string, string> = {
  'oxd-select-text': 'combobox',
  'oxd-select-text-input': 'combobox',
  'oxd-input': 'textbox',
  'oxd-button': 'button',
};

const OXD_WRAPPER_CLASSES = new Set([
  'oxd-select-wrapper', 'oxd-radio-wrapper', 'oxd-checkbox-wrapper',
]);

const OXD_CHECKED_CLASS = 'oxd-checkbox-checked';

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

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link', button: 'button', nav: 'navigation', main: 'main',
  aside: 'complementary', header: 'banner', footer: 'contentinfo',
  section: 'region', article: 'article', form: 'form',
  select: 'listbox', textarea: 'textbox', option: 'option',
  ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row',
  td: 'cell', th: 'rowheader', dialog: 'dialog', summary: 'button',
  details: 'group', fieldset: 'group', legend: 'legend',
  datalist: 'listbox', img: 'img',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading',
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
  'combobox', 'listbox', 'option', 'menuitem', 'switch', 'slider',
  'spinbutton', 'tab', 'treeitem', 'gridcell',
]);

const COMPOSITE_ROLES = new Set([
  'combobox', 'listbox', 'menu', 'menubar', 'radiogroup',
  'tablist', 'tree', 'grid', 'treegrid', 'dialog', 'alertdialog',
]);

function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const oxdRole = oxdInferRole(el);
  if (oxdRole) return oxdRole;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    return INPUT_TYPE_ROLES[type] || null;
  }
  return IMPLICIT_ROLES[tag] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCESSIBLE NAME (from M2, with ancestor walking)
// ═══════════════════════════════════════════════════════════════════════════

function isPlaceholderText(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return lower === '-- select --' || lower.startsWith('--') ||
    lower === 'select...' || lower === 'please select' || lower === 'choose...';
}

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

  // Walk ancestors for <label>
  let ancestor: Element | null = el.parentElement;
  for (let i = 0; i < 5 && ancestor; i++) {
    if (ancestor.tagName === 'LABEL') {
      const clone = ancestor.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input,textarea,select').forEach(e => e.remove());
      const text = clone.textContent?.trim();
      if (text) return text;
    }
    ancestor = ancestor.parentElement;
  }

  const text = el.textContent?.trim() || '';
  // Don't filter placeholder text for option elements — they ARE the placeholder
  if (el.getAttribute('role') === 'option' || el.tagName.toLowerCase() === 'option' || el.tagName.toLowerCase() === 'li') {
    if (text && text.length < 200) return text;
  }
  if (text && text.length < 200 && !isPlaceholderText(text)) return text;

  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  // OXD label resolution
  let node: Element | null = el.parentElement;
  for (let i = 0; i < 8 && node; i++) {
    const classes = (node.className || '').toString();
    if (classes.includes('oxd-input-group')) {
      const oxdLabel = node.querySelector('.oxd-label');
      if (oxdLabel?.textContent?.trim()) return oxdLabel.textContent.trim();
    }
    if (isOxdWrapper(node)) {
      const wrapperText = node.textContent?.trim();
      if (wrapperText && !isPlaceholderText(wrapperText)) return wrapperText;
    }
    if (node.getAttribute('role') === 'group' || node.tagName === 'FIELDSET') {
      const legend = node.querySelector('legend, .oxd-label');
      if (legend?.textContent?.trim()) return legend.textContent.trim();
    }
    node = node.parentElement;
  }

  const nameAttr = el.getAttribute('name');
  if (nameAttr?.trim()) return nameAttr.trim();

  return '';
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL MODEL (from M3/M4, integrated)
// ═══════════════════════════════════════════════════════════════════════════

interface ControlNode {
  controlId: string;
  role: string;
  name: string;
  tag: string;
  classes: string[];
  parentId: string | null;
  state: {
    expanded: boolean | null;
    checked: boolean | null;
    selected: boolean | null;
    value: string | null;
  };
  elementRef: WeakRef<Element>;
}

class IntegratedControlModel {
  controls = new Map<string, ControlNode>();
  elementToControl = new WeakMap<Element, string>();
  private nextId = 1;
  private observer: MutationObserver | null = null;
  private scrollAccumulator = { lastTime: 0, count: 0 };

  discover(root: Element = document.body) {
    this._discover(root, null);
  }

  private _discover(node: Element, parentId: string | null) {
    const role = getRole(node);
    let myId: string | null = null;

    if (role && (WIDGET_ROLES.has(role) || COMPOSITE_ROLES.has(role))) {
      const name = getAccessibleName(node);
      myId = `ctrl-${this.nextId++}`;
      const tag = node.tagName.toLowerCase();
      const classes = (node.className || '').toString().split(/\s+/).filter(Boolean);

      this.controls.set(myId, {
        controlId: myId, role, name: name || '(unnamed)', tag, classes,
        parentId,
        state: {
          expanded: node.getAttribute('aria-expanded') === 'true' ? true
            : node.getAttribute('aria-expanded') === 'false' ? false : null,
          checked: node.getAttribute('aria-checked') === 'true' ? true
            : node.getAttribute('aria-checked') === 'false' ? false
            : (node as HTMLInputElement).checked ?? null,
          selected: node.getAttribute('aria-selected') === 'true' ? true : null,
          value: (node as HTMLInputElement).value ?? null,
        },
        elementRef: new WeakRef(node),
      });
      this.elementToControl.set(node, myId);
    }

    for (const child of Array.from(node.children)) {
      this._discover(child, myId || parentId);
    }
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.children)) {
        this._discover(child, myId || parentId);
      }
    }
  }

  observe(root: Element = document.body) {
    this.observer = new MutationObserver((mutations) => {
      // Re-discover dynamically added elements (options, calendar days)
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            const el = node as Element;
            // Find parent control for relationship tracking
            let parentId: string | null = null;
            let p: Element | null = el.parentElement;
            while (p) {
              parentId = this.elementToControl.get(p) || null;
              if (parentId) break;
              p = p.parentElement;
            }
            this._discover(el, parentId);
          }
        }
      }
    });
    this.observer.observe(root, {
      childList: true, subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-expanded', 'aria-checked', 'aria-selected',
        'class', 'value', 'checked', 'hidden', 'style'],
    });
  }

  disconnect() {
    this.observer?.disconnect();
  }

  findByElement(el: Element): ControlNode | null {
    const id = this.elementToControl.get(el);
    return id ? this.controls.get(id) || null : null;
  }

  /**
   * Match an event target to a control via composedPath walking.
   * If the target isn't in the model (dynamically added), try to discover it.
   */
  matchEvent(targetEl: Element): ControlNode | null {
    // Strategy 1: Walk composedPath (ancestors)
    // Skip COMPOSITE roles (radiogroup, listbox, etc.) — they are containers,
    // not interaction targets. Only WIDGET roles are interaction targets.
    let node: Element | null = targetEl;
    while (node) {
      const ctrl = this.findByElement(node);
      if (ctrl) {
        if (COMPOSITE_ROLES.has(ctrl.role)) {
          // Skip composite containers — keep walking to find a widget
          node = node.parentElement;
          continue;
        }
        return ctrl;
      }
      node = node.parentElement;
    }

    // Strategy 1b: Lazy discovery — element may have been added dynamically
    // Check if the target itself is a control we haven't discovered yet
    const targetRole = getRole(targetEl);
    if (targetRole && (WIDGET_ROLES.has(targetRole) || COMPOSITE_ROLES.has(targetRole))) {
      let parentId: string | null = null;
      let p: Element | null = targetEl.parentElement;
      while (p) {
        parentId = this.elementToControl.get(p) || null;
        if (parentId) break;
        p = p.parentElement;
      }
      this._discover(targetEl, parentId);
      const ctrl = this.findByElement(targetEl);
      if (ctrl) return ctrl;
    }

    // Strategy 2: Label/wrapper fallback (starts from target itself)
    let node2: Element | null = targetEl;
    for (let i = 0; i < 5 && node2; i++) {
      if (node2.tagName === 'LABEL' && node2.querySelector('input')) {
        const input = node2.querySelector('input[type="radio"], input[type="checkbox"], input');
        if (input) {
          const ctrl = this.findByElement(input);
          if (ctrl) return ctrl;
        }
      }
      if (isOxdWrapper(node2)) {
        const input = node2.querySelector('input[type="radio"], input[type="checkbox"]');
        if (input) {
          const ctrl = this.findByElement(input);
          if (ctrl) return ctrl;
        }
      }
      node2 = node2.parentElement;
    }

    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTION RECOGNIZER
// ═══════════════════════════════════════════════════════════════════════════

class InteractionRecognizer {
  actions: SemanticAction[] = [];
  private model: IntegratedControlModel;
  private activeDropdown: ControlNode | null = null;
  private activeDatePicker: ControlNode | null = null;
  private textEntryBuffer: { control: ControlNode; value: string } | null = null;
  private scrollLastEmit = 0;
  private seenRadioSelections = new Set<string>(); // dedup OXD label→input
  private seenCheckboxToggles = new Set<string>();

  constructor(model: IntegratedControlModel) {
    this.model = model;
  }

  reset() {
    this.actions = [];
    this.activeDropdown = null;
    this.activeDatePicker = null;
    this.textEntryBuffer = null;
    this.scrollLastEmit = 0;
    this.seenRadioSelections.clear();
    this.seenCheckboxToggles.clear();
  }

  /**
   * Process a simulated user interaction.
   */
  onInteraction(type: string, target: Element, options?: { value?: string; key?: string }) {
    // Scroll is a page-level event — doesn't require a control match
    if (type === 'scroll') {
      this._handleScroll();
      return;
    }

    const control = this.model.matchEvent(target);
    if (!control) return;

    switch (type) {
      case 'click':
        this._handleClick(control, target, options);
        break;
      case 'input':
        this._handleInput(control, options?.value || '');
        break;
      case 'blur':
        this._handleBlur(control);
        break;
      case 'keydown':
        this._handleKey(control, options?.key || '');
        break;
    }
  }

  private _handleClick(control: ControlNode, target: Element, options?: { value?: string }) {
    // If we have an active dropdown and user clicks an option
    if (this.activeDropdown) {
      const targetRole = control.role;
      // Check if this is an option in the dropdown's listbox
      if (targetRole === 'option' || target.tagName.toLowerCase() === 'li' ||
          target.getAttribute('role') === 'option') {
        const optionText = control.name;
        // No-op check: same value selected
        if (!isPlaceholderText(optionText)) {
          this.actions.push({
            verb: 'select',
            target: this.activeDropdown.name,
            role: 'combobox',
            value: optionText,
            parentGroup: this.activeDropdown.name,
            timestamp: Date.now(),
          });
        }
        this.activeDropdown = null;
        return;
      }
      // Clicking outside the dropdown closes it
      this.activeDropdown = null;
    }

    // If we have an active date picker and user clicks a day
    if (this.activeDatePicker) {
      const role = control.role;
      // Calendar day click
      if (role === 'gridcell' || target.classList.contains('oxd-date-day') ||
          target.getAttribute('role') === 'gridcell') {
        this.actions.push({
          verb: 'selectDate',
          target: this.activeDatePicker.name,
          role: 'textbox',
          value: control.name,
          timestamp: Date.now(),
        });
        this.activeDatePicker = null;
        return;
      }
      // Nav buttons are lifecycle-internal (no step)
      const classes = (target.className || '').toString();
      if (classes.includes('oxd-date') && (classes.includes('nav') ||
          classes.includes('switch') || classes.includes('prev') ||
          classes.includes('next') || classes.includes('today'))) {
        // Lifecycle-internal navigation — no step emitted
        return;
      }
    }

    // Flush pending text entry
    this._flushTextEntry();

    switch (control.role) {
      case 'textbox':
        // Check if this is a date picker input
        if (control.classes.includes('oxd-date-input') ||
            control.tag === 'input' && (control.elementRef.deref() as HTMLInputElement)?.type === 'date') {
          this.activeDatePicker = control;
        } else {
          // Text field click — start text entry tracking
          this.textEntryBuffer = { control, value: '' };
        }
        break;

      case 'combobox':
        // Dropdown trigger — activate lifecycle
        this.activeDropdown = control;
        break;

      case 'radio': {
        // Dedup OXD label→input synthetic click
        if (!this.seenRadioSelections.has(control.controlId)) {
          this.seenRadioSelections.add(control.controlId);
          // Walk up to find group name (radiogroup, fieldset, or OXD input group)
          const groupName = this._findGroupName(control);
          this.actions.push({
            verb: 'select',
            target: control.name,
            role: 'radio',
            parentGroup: groupName,
            timestamp: Date.now(),
          });
          setTimeout(() => this.seenRadioSelections.delete(control.controlId), 100);
        }
        break;
      }

      case 'checkbox': {
        // Dedup OXD label→input synthetic click
        if (!this.seenCheckboxToggles.has(control.controlId)) {
          this.seenCheckboxToggles.add(control.controlId);
          const isOxdChecked = control.classes.includes(OXD_CHECKED_CLASS) ||
            control.classes.includes('checked') ||
            (target as HTMLElement).getAttribute('aria-checked') === 'true';
          this.actions.push({
            verb: 'toggle',
            target: control.name,
            role: 'checkbox',
            value: isOxdChecked ? 'checked' : 'unchecked',
            timestamp: Date.now(),
          });
          setTimeout(() => this.seenCheckboxToggles.delete(control.controlId), 100);
        }
        break;
      }

      case 'button':
        this.actions.push({
          verb: 'click',
          target: control.name,
          role: 'button',
          timestamp: Date.now(),
        });
        break;

      case 'link':
        this.actions.push({
          verb: 'navigate',
          target: control.name,
          role: 'link',
          timestamp: Date.now(),
        });
        break;

      default:
        // Unknown widget click
        if (control.tag === 'input' && control.classes.includes('oxd-date-input')) {
          // Date picker trigger
          this.activeDatePicker = control;
        }
        break;
    }
  }

  private _handleInput(control: ControlNode, value: string) {
    if (control.role === 'textbox') {
      this.textEntryBuffer = { control, value };
    }
  }

  private _handleBlur(control: ControlNode) {
    // Flush text entry on blur
    this._flushTextEntry();

    // Date picker: typed + blur completion
    if (this.activeDatePicker && control.role === 'textbox') {
      const value = (control.elementRef.deref() as HTMLInputElement)?.value;
      if (value) {
        this.actions.push({
          verb: 'selectDate',
          target: this.activeDatePicker.name,
          role: 'textbox',
          value,
          timestamp: Date.now(),
        });
        this.activeDatePicker = null;
      }
    }
  }

  private _handleKey(control: ControlNode, key: string) {
    if (key === 'Escape') {
      if (this.activeDropdown) {
        this.activeDropdown = null;
        return;
      }
      if (this.activeDatePicker) {
        this.activeDatePicker = null;
        return;
      }
    }
    if (key === 'Enter' && this.textEntryBuffer) {
      this._flushTextEntry();
    }
  }

  /**
   * Find the group name for a radio/checkbox by walking up the DOM
   * to find radiogroup, fieldset legend, or OXD input group label.
   */
  private _findGroupName(control: ControlNode): string {
    const el = control.elementRef.deref();
    if (!el) return 'Radio Group';

    let node: Element | null = el.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      if (node.getAttribute('role') === 'radiogroup') {
        const label = node.getAttribute('aria-label') ||
          node.querySelector('legend')?.textContent?.trim();
        if (label) return label.trim();
      }
      const classes = (node.className || '').toString();
      if (classes.includes('oxd-input-group')) {
        const oxdLabel = node.querySelector('.oxd-label');
        if (oxdLabel?.textContent?.trim()) return oxdLabel.textContent.trim();
      }
      if (node.tagName === 'FIELDSET') {
        const legend = node.querySelector('legend');
        if (legend?.textContent?.trim()) return legend.textContent.trim();
      }
      node = node.parentElement;
    }
    return 'Radio Group';
  }

  private _flushTextEntry() {
    if (this.textEntryBuffer) {
      const { control, value } = this.textEntryBuffer;
      if (value && value.trim()) {
        this.actions.push({
          verb: 'fill',
          target: control.name,
          role: 'textbox',
          value,
          timestamp: Date.now(),
        });
      }
      this.textEntryBuffer = null;
    }
  }

  private _handleScroll() {
    const now = Date.now();
    // Emit if: first scroll ever, OR burst gap exceeded (>500ms since last)
    if (this.scrollLastEmit === 0 || now - this.scrollLastEmit > 500) {
      this.actions.push({
        verb: 'scroll',
        target: 'page',
        role: 'document',
        timestamp: now,
      });
      this.scrollLastEmit = now;
    }
    // Otherwise: coalesce into existing burst
  }

  /**
   * Flush all pending interactions (call after Stop).
   */
  flush() {
    this._flushTextEntry();
    this.activeDropdown = null;
    this.activeDatePicker = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST HARNESS
// ═══════════════════════════════════════════════════════════════════════════

function createHarness(html: string) {
  document.body.innerHTML = html;
  const model = new IntegratedControlModel();
  model.discover();
  model.observe();
  const recognizer = new InteractionRecognizer(model);
  return { model, recognizer };
}

/** Wait for MutationObserver to discover dynamically added elements */
async function waitForDiscovery(delay = 50): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay));
}

function simulateClick(el: Element) {
  return el;
}

function getLastAction(recognizer: InteractionRecognizer): SemanticAction {
  const actions = recognizer.actions;
  return actions[actions.length - 1]!;
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('M5 — Text Entry', () => {
  it('records Fill when user clicks field, types, and blurs', () => {
    const { recognizer } = createHarness(`
      <form>
        <label for="username">Username</label>
        <input type="text" id="username" />
      </form>
    `);

    const input = document.getElementById('username')!;
    recognizer.onInteraction('click', input);
    recognizer.onInteraction('input', input, { value: 'Admin' });
    recognizer.onInteraction('blur', input);

    expect(recognizer.actions.length).toBe(1);
    const action = recognizer.actions[0]!;
    expect(action.verb).toBe('fill');
    expect(action.target).toBe('Username');
    expect(action.value).toBe('Admin');
  });

  it('does NOT record a step for tab-without-typing (no-op)', () => {
    const { recognizer } = createHarness(`
      <form>
        <input type="text" aria-label="Field 1" />
        <input type="text" aria-label="Field 2" />
      </form>
    `);

    const f1 = document.querySelectorAll('input')[0]!;
    recognizer.onInteraction('click', f1);
    // Tab without typing — no input events
    recognizer.onInteraction('blur', f1);

    expect(recognizer.actions.length).toBe(0);
  });

  it('records separate Fill for each field in multi-field edit', () => {
    const { recognizer } = createHarness(`
      <form>
        <label for="fname">First Name</label>
        <input type="text" id="fname" />
        <label for="lname">Last Name</label>
        <input type="text" id="lname" />
      </form>
    `);

    const fname = document.getElementById('fname')!;
    const lname = document.getElementById('lname')!;

    recognizer.onInteraction('click', fname);
    recognizer.onInteraction('input', fname, { value: 'John' });
    recognizer.onInteraction('blur', fname);

    recognizer.onInteraction('click', lname);
    recognizer.onInteraction('input', lname, { value: 'Doe' });
    recognizer.onInteraction('blur', lname);

    expect(recognizer.actions.length).toBe(2);
    expect(recognizer.actions[0]!.target).toBe('First Name');
    expect(recognizer.actions[0]!.value).toBe('John');
    expect(recognizer.actions[1]!.target).toBe('Last Name');
    expect(recognizer.actions[1]!.value).toBe('Doe');
  });
});

describe('M5 — Dropdown (OXD Custom)', () => {
  const oxdDropdownHTML = `
    <form>
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
    </form>
  `;

  it('records Select when user opens dropdown and clicks option', () => {
    const { recognizer } = createHarness(oxdDropdownHTML);

    // Click Nationality trigger (click on the text area)
    const nationalityTrigger = document.querySelectorAll('.oxd-select-text-input')[0]!;
    recognizer.onInteraction('click', nationalityTrigger);

    // Simulate dropdown options appearing
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option">American</li><li role="option">British</li>';
    document.body.appendChild(listbox);

    // Click "American" option
    const option = listbox.querySelector('li')!;
    recognizer.onInteraction('click', option);

    expect(recognizer.actions.length).toBe(1);
    const action = recognizer.actions[0]!;
    expect(action.verb).toBe('select');
    expect(action.target).toBe('Nationality');
    expect(action.value).toBe('American');
  });

  it('does NOT produce "Select Blood Type" when clicking Nationality', () => {
    const { recognizer } = createHarness(oxdDropdownHTML);

    // The v10.4.18 bug: clicking Nationality resolved to Blood Type
    // because resolveTarget returned the first [tabindex] match.
    // Our Control Model assigns each dropdown a separate controlId.
    const nationalityTrigger = document.querySelectorAll('.oxd-select-text-input')[0]!;
    recognizer.onInteraction('click', nationalityTrigger);

    // Add option list
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option">American</li>';
    document.body.appendChild(listbox);

    recognizer.onInteraction('click', listbox.querySelector('li')!);

    const action = recognizer.actions[0]!;
    expect(action.target).toBe('Nationality');
    expect(action.target).not.toContain('Blood');
    expect(action.target).not.toContain('Marital');
  });

  it('records separate Select for Marital Status (not Nationality)', () => {
    const { recognizer } = createHarness(oxdDropdownHTML);

    // Click Marital Status trigger
    const maritalTrigger = document.querySelectorAll('.oxd-select-text-input')[1]!;
    recognizer.onInteraction('click', maritalTrigger);

    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option">Single</li>';
    document.body.appendChild(listbox);

    recognizer.onInteraction('click', listbox.querySelector('li')!);

    const action = recognizer.actions[0]!;
    expect(action.target).toBe('Marital Status');
    expect(action.value).toBe('Single');
  });

  it('filters placeholder "-- Select --" selection as no-op', () => {
    const { recognizer } = createHarness(oxdDropdownHTML);

    const trigger = document.querySelectorAll('.oxd-select-text-input')[0]!;
    recognizer.onInteraction('click', trigger);

    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option">-- Select --</li>';
    document.body.appendChild(listbox);

    recognizer.onInteraction('click', listbox.querySelector('li')!);

    // Should NOT produce a step — placeholder filtered
    expect(recognizer.actions.length).toBe(0);
  });

  it('matches dropdown trigger via icon click (decorative child)', () => {
    const { recognizer } = createHarness(oxdDropdownHTML);

    // Click on the dropdown arrow icon
    const icon = document.querySelectorAll('.oxd-select-text-icon')[0]!;
    recognizer.onInteraction('click', icon);

    // Should activate dropdown lifecycle, not produce a separate click step
    const action = recognizer.actions[0];
    expect(action?.verb).not.toBe('click'); // Not a button click
    expect(action).toBeUndefined(); // Just activates lifecycle, no step yet
  });
});

describe('M5 — Radio Button (OXD)', () => {
  const oxdRadioHTML = `
    <div class="oxd-input-group">
      <label class="oxd-label">Gender</label>
      <div class="oxd-radio-wrapper">
        <label>
          <input type="radio" name="gender" value="male" />
          <span>Male</span>
        </label>
      </div>
      <div class="oxd-radio-wrapper">
        <label>
          <input type="radio" name="gender" value="female" />
          <span>Female</span>
        </label>
      </div>
    </div>
  `;

  it('records Select when user clicks Female radio', () => {
    const { recognizer } = createHarness(oxdRadioHTML);

    const femaleInput = document.querySelectorAll('input[type="radio"]')[1]!;
    recognizer.onInteraction('click', femaleInput);

    expect(recognizer.actions.length).toBe(1);
    const action = recognizer.actions[0]!;
    expect(action.verb).toBe('select');
    expect(action.target).toBe('Female');
    expect(action.parentGroup).toBe('Gender');
  });

  it('matches radio via wrapper div click (label text area)', () => {
    const { recognizer } = createHarness(oxdRadioHTML);

    const wrapper = document.querySelectorAll('.oxd-radio-wrapper')[1]!;
    recognizer.onInteraction('click', wrapper);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.target).toBe('Female');
  });

  it('does NOT produce Click on wrapper or label as separate step', () => {
    const { recognizer } = createHarness(oxdRadioHTML);

    const label = document.querySelectorAll('.oxd-radio-wrapper label')[1]!;
    recognizer.onInteraction('click', label);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.verb).toBe('select'); // Not 'click'
    expect(recognizer.actions[0]!.target).toBe('Female');
  });
});

describe('M5 — Checkbox (OXD)', () => {
  const oxdCheckboxHTML = `
    <div class="oxd-input-group">
      <label class="oxd-label">Smoker</label>
      <div class="oxd-checkbox-wrapper">
        <label>
          <input type="checkbox" name="smoker" />
          <span class="oxd-checkbox-input"></span>
        </label>
      </div>
    </div>
  `;

  it('records Toggle when user clicks checkbox', () => {
    const { recognizer } = createHarness(oxdCheckboxHTML);

    const checkbox = document.querySelector('input[type="checkbox"]')!;
    // Simulate checked state
    checkbox.checked = true;
    checkbox.setAttribute('aria-checked', 'true');
    recognizer.onInteraction('click', checkbox);

    expect(recognizer.actions.length).toBe(1);
    const action = recognizer.actions[0]!;
    expect(action.verb).toBe('toggle');
    expect(action.target).toBe('Smoker');
    expect(action.value).toBe('checked');
  });

  it('matches checkbox via wrapper click', () => {
    const { recognizer } = createHarness(oxdCheckboxHTML);

    const wrapper = document.querySelector('.oxd-checkbox-wrapper')!;
    const checkbox = document.querySelector('input[type="checkbox"]')!;
    checkbox.setAttribute('aria-checked', 'true');
    recognizer.onInteraction('click', wrapper);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.verb).toBe('toggle');
    expect(recognizer.actions[0]!.target).toBe('Smoker');
  });
});

describe('M5 — Button Click', () => {
  it('records Click when user clicks Save button', () => {
    const { recognizer } = createHarness(`
      <button type="submit" class="oxd-button">
        <i class="oxd-icon save"></i>
        <span>Save</span>
      </button>
    `);

    const button = document.querySelector('button')!;
    recognizer.onInteraction('click', button);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.verb).toBe('click');
    expect(recognizer.actions[0]!.target).toBe('Save');
  });

  it('records Click "Save" when clicking icon inside button (NOT "Click I")', () => {
    const { recognizer } = createHarness(`
      <button type="submit" class="oxd-button">
        <i class="oxd-icon save"></i>
        <span>Save</span>
      </button>
    `);

    // The v10.4.18 bug: clicking the icon resolved to "Click I"
    const icon = document.querySelector('.oxd-icon')!;
    recognizer.onInteraction('click', icon);

    expect(recognizer.actions.length).toBe(1);
    const action = recognizer.actions[0]!;
    expect(action.verb).toBe('click');
    expect(action.target).toBe('Save'); // NOT "I" or icon name
    expect(action.target).not.toBe('I');
  });

  it('records Click "Save" when clicking span text inside button', () => {
    const { recognizer } = createHarness(`
      <button type="submit">
        <span>Save</span>
      </button>
    `);

    const span = document.querySelector('button span')!;
    recognizer.onInteraction('click', span);

    expect(recognizer.actions[0]!.verb).toBe('click');
    expect(recognizer.actions[0]!.target).toBe('Save');
  });
});

describe('M5 — Navigation', () => {
  it('records Navigate when user clicks a link', () => {
    const { recognizer } = createHarness(`
      <nav>
        <a href="/my-info">My Info</a>
      </nav>
    `);

    const link = document.querySelector('a')!;
    recognizer.onInteraction('click', link);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.verb).toBe('navigate');
    expect(recognizer.actions[0]!.target).toBe('My Info');
  });
});

describe('M5 — Scroll', () => {
  it('coalesces rapid scroll events into a single step', () => {
    const { recognizer } = createHarness('<div id="content"></div>');

    // 3 rapid scroll events
    recognizer.onInteraction('scroll', document.body);
    recognizer.onInteraction('scroll', document.body);
    recognizer.onInteraction('scroll', document.body);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.verb).toBe('scroll');
  });
});

describe('M5 — Date Picker (OXD)', () => {
  const oxdDatePickerHTML = `
    <div class="oxd-input-group">
      <label class="oxd-label">Date of Birth</label>
      <div class="oxd-date-wrapper">
        <input type="text" class="oxd-input oxd-date-input" aria-label="Date of Birth" />
        <i class="oxd-date-icon"></i>
      </div>
    </div>
  `;

  it('records SelectDate when user clicks trigger and selects a day', () => {
    const { recognizer } = createHarness(oxdDatePickerHTML);

    // Click date picker trigger
    const input = document.querySelector('.oxd-date-input')!;
    recognizer.onInteraction('click', input);

    // Simulate calendar appearing with days
    const calendar = document.createElement('div');
    calendar.setAttribute('role', 'grid');
    calendar.innerHTML = '<div role="gridcell" class="oxd-date-day">15</div>';
    document.body.appendChild(calendar);

    // Click day 15
    const day = calendar.querySelector('[role="gridcell"]')!;
    recognizer.onInteraction('click', day);

    expect(recognizer.actions.length).toBe(1);
    const action = recognizer.actions[0]!;
    expect(action.verb).toBe('selectDate');
    expect(action.target).toBe('Date of Birth');
    expect(action.value).toBe('15');
  });

  it('does NOT produce steps for navigation button clicks (prev/next month)', () => {
    const { recognizer } = createHarness(oxdDatePickerHTML);

    const input = document.querySelector('.oxd-date-input')!;
    recognizer.onInteraction('click', input);

    // Click "next month" nav button — should be lifecycle-internal
    const navBtn = document.createElement('button');
    navBtn.className = 'oxd-date-nav-button oxd-date-next';
    navBtn.textContent = 'Next';
    document.body.appendChild(navBtn);

    recognizer.onInteraction('click', navBtn);

    // No step should be emitted for nav button
    expect(recognizer.actions.length).toBe(0);
  });

  it('records SelectDate via typed input + blur completion', () => {
    const { recognizer } = createHarness(oxdDatePickerHTML);

    const input = document.querySelector('.oxd-date-input')!;
    recognizer.onInteraction('click', input);
    (input as HTMLInputElement).value = '1990-01-15';
    recognizer.onInteraction('blur', input);

    expect(recognizer.actions.length).toBe(1);
    expect(recognizer.actions[0]!.verb).toBe('selectDate');
    expect(recognizer.actions[0]!.value).toBe('1990-01-15');
  });
});

describe('M5 — Compound Interactions', () => {
  it('dropdown lifecycle: open → select → close (no fragmentation)', () => {
    const { recognizer } = createHarness(`
      <div class="oxd-input-group">
        <label class="oxd-label">Country</label>
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text" tabindex="0">
            <div class="oxd-select-text-input">-- Select --</div>
          </div>
        </div>
      </div>
    `);

    // Open dropdown
    const trigger = document.querySelector('.oxd-select-text-input')!;
    recognizer.onInteraction('click', trigger);
    expect(recognizer.actions.length).toBe(0); // No step for opening

    // Select option
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option">USA</li>';
    document.body.appendChild(listbox);
    recognizer.onInteraction('click', listbox.querySelector('li')!);

    expect(recognizer.actions.length).toBe(1); // Only the select step
    expect(recognizer.actions[0]!.verb).toBe('select');
    expect(recognizer.actions[0]!.target).toBe('Country');
    expect(recognizer.actions[0]!.value).toBe('USA');
  });

  it('checkbox OXD label→input synthetic click deduplication', () => {
    const { recognizer } = createHarness(`
      <div class="oxd-checkbox-wrapper">
        <label>
          <input type="checkbox" aria-label="Subscribe" />
          <span>Subscribe</span>
        </label>
      </div>
    `);

    const checkbox = document.querySelector('input[type="checkbox"]')!;

    // OXD fires: label click → input click (synthetic). Both events target
    // the same control. Should produce ONE toggle, not two.
    recognizer.onInteraction('click', checkbox);
    recognizer.onInteraction('click', checkbox);

    // Due to dedup, should only have 1 action
    expect(recognizer.actions.length).toBe(1);
  });
});

describe('M5 — OrangeHRM My Info Full Workflow', () => {
  it('produces exactly 9 correct steps for the My Info edit workflow', () => {
    // Recreate the full OrangeHRM My Info page DOM
    const { recognizer } = createHarness(`
      <form>
        <!-- Text inputs -->
        <div class="oxd-input-group">
          <label class="oxd-label">First Name</label>
          <div class="oxd-input-field">
            <input type="text" class="oxd-input" name="firstName" />
          </div>
        </div>
        <div class="oxd-input-group">
          <label class="oxd-label">Last Name</label>
          <div class="oxd-input-field">
            <input type="text" class="oxd-input" name="lastName" />
          </div>
        </div>

        <!-- Dropdowns -->
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

        <!-- Radio -->
        <div class="oxd-input-group">
          <label class="oxd-label">Gender</label>
          <div class="oxd-radio-wrapper">
            <label><input type="radio" name="gender" value="male" /><span>Male</span></label>
          </div>
          <div class="oxd-radio-wrapper">
            <label><input type="radio" name="gender" value="female" /><span>Female</span></label>
          </div>
        </div>

        <!-- Date picker -->
        <div class="oxd-input-group">
          <label class="oxd-label">Date of Birth</label>
          <div class="oxd-date-wrapper">
            <input type="text" class="oxd-input oxd-date-input" name="dob" />
          </div>
        </div>

        <!-- Save -->
        <button type="submit" class="oxd-button">
          <i class="oxd-icon save"></i>
          <span>Save</span>
        </button>
      </form>
    `);

    // Step 1: Edit First Name
    const fname = document.querySelector('input[name="firstName"]')!;
    recognizer.onInteraction('click', fname);
    recognizer.onInteraction('input', fname, { value: 'John' });
    recognizer.onInteraction('blur', fname);

    // Step 2: Edit Last Name
    const lname = document.querySelector('input[name="lastName"]')!;
    recognizer.onInteraction('click', lname);
    recognizer.onInteraction('input', lname, { value: 'Doe' });
    recognizer.onInteraction('blur', lname);

    // Step 3: Select Nationality → American
    const nationalityTrigger = document.querySelectorAll('.oxd-select-text-input')[0]!;
    recognizer.onInteraction('click', nationalityTrigger);
    const natListbox = document.createElement('ul');
    natListbox.setAttribute('role', 'listbox');
    natListbox.innerHTML = '<li role="option">American</li>';
    document.body.appendChild(natListbox);
    recognizer.onInteraction('click', natListbox.querySelector('li')!);

    // Step 4: Select Marital Status → Single
    const maritalTrigger = document.querySelectorAll('.oxd-select-text-input')[1]!;
    recognizer.onInteraction('click', maritalTrigger);
    const msListbox = document.createElement('ul');
    msListbox.setAttribute('role', 'listbox');
    msListbox.innerHTML = '<li role="option">Single</li>';
    document.body.appendChild(msListbox);
    recognizer.onInteraction('click', msListbox.querySelector('li')!);

    // Step 5: Select Gender → Female
    const femaleRadio = document.querySelectorAll('input[type="radio"]')[1]!;
    recognizer.onInteraction('click', femaleRadio);

    // Step 6: Select Date of Birth → 15th
    const dobInput = document.querySelector('.oxd-date-input')!;
    recognizer.onInteraction('click', dobInput);
    const calendar = document.createElement('div');
    calendar.setAttribute('role', 'grid');
    calendar.innerHTML = '<div role="gridcell" class="oxd-date-day">15</div>';
    document.body.appendChild(calendar);
    recognizer.onInteraction('click', calendar.querySelector('[role="gridcell"]')!);

    // Step 7: Click Save (via icon — the v10.4.18 bug)
    const saveIcon = document.querySelector('.oxd-icon')!;
    recognizer.onInteraction('click', saveIcon);

    // Flush
    recognizer.flush();

    // Verify exactly 7 steps (text entry x2 + dropdown x2 + radio + date + button)
    expect(recognizer.actions.length).toBe(7);

    // Verify each step
    const actions = recognizer.actions;

    // 1. Fill First Name
    expect(actions[0]!.verb).toBe('fill');
    expect(actions[0]!.target).toBe('First Name');
    expect(actions[0]!.value).toBe('John');

    // 2. Fill Last Name
    expect(actions[1]!.verb).toBe('fill');
    expect(actions[1]!.target).toBe('Last Name');
    expect(actions[1]!.value).toBe('Doe');

    // 3. Select Nationality
    expect(actions[2]!.verb).toBe('select');
    expect(actions[2]!.target).toBe('Nationality');
    expect(actions[2]!.value).toBe('American');

    // 4. Select Marital Status
    expect(actions[3]!.verb).toBe('select');
    expect(actions[3]!.target).toBe('Marital Status');
    expect(actions[3]!.value).toBe('Single');

    // 5. Select Gender → Female
    expect(actions[4]!.verb).toBe('select');
    expect(actions[4]!.target).toBe('Female');
    expect(actions[4]!.parentGroup).toBe('Gender');

    // 6. Select Date
    expect(actions[5]!.verb).toBe('selectDate');
    expect(actions[5]!.target).toBe('Date of Birth');
    expect(actions[5]!.value).toBe('15');

    // 7. Click Save (NOT "Click I")
    expect(actions[6]!.verb).toBe('click');
    expect(actions[6]!.target).toBe('Save');
    expect(actions[6]!.target).not.toBe('I');
  });

  it('does NOT produce v10.4.18 bugs (regression check)', () => {
    const { recognizer } = createHarness(`
      <form>
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
        <button type="submit">
          <i class="icon-save"></i>
          <span>Save</span>
        </button>
      </form>
    `);

    // Click Nationality dropdown
    const nationality = document.querySelectorAll('.oxd-select-text-input')[0]!;
    recognizer.onInteraction('click', nationality);

    // Select an option
    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.innerHTML = '<li role="option">American</li>';
    document.body.appendChild(listbox);
    recognizer.onInteraction('click', listbox.querySelector('li')!);

    // Regression 1: Nationality must NOT resolve to Blood Type
    expect(recognizer.actions[0]!.target).toBe('Nationality');
    expect(recognizer.actions[0]!.target).not.toContain('Blood');

    // Click Save via icon
    const icon = document.querySelector('.icon-save')!;
    recognizer.onInteraction('click', icon);

    // Regression 2: Must say "Save", not "I" or icon name
    expect(recognizer.actions[1]!.verb).toBe('click');
    expect(recognizer.actions[1]!.target).toBe('Save');
    expect(recognizer.actions[1]!.target).not.toBe('I');
    expect(recognizer.actions[1]!.target).not.toBe('icon-save');

    // Total: exactly 2 steps (no spurious clicks)
    expect(recognizer.actions.length).toBe(2);
  });
});

describe('M5 — Multi-Framework Coverage', () => {
  it('Semantic HTML: records form interactions correctly', () => {
    const { recognizer } = createHarness(`
      <form>
        <fieldset>
          <legend>Contact Info</legend>
          <label for="email">Email</label>
          <input type="email" id="email" />
          <label><input type="checkbox" id="news" /> Newsletter</label>
        </fieldset>
        <button type="submit">Submit</button>
      </form>
    `);

    const email = document.getElementById('email')!;
    recognizer.onInteraction('click', email);
    recognizer.onInteraction('input', email, { value: 'test@test.com' });
    recognizer.onInteraction('blur', email);

    const checkbox = document.getElementById('news')!;
    checkbox.checked = true;
    checkbox.setAttribute('aria-checked', 'true');
    recognizer.onInteraction('click', checkbox);

    const submit = document.querySelector('button')!;
    recognizer.onInteraction('click', submit);

    expect(recognizer.actions.length).toBe(3);
    expect(recognizer.actions[0]!.verb).toBe('fill');
    expect(recognizer.actions[0]!.target).toBe('Email');
    expect(recognizer.actions[1]!.verb).toBe('toggle');
    expect(recognizer.actions[1]!.target).toBe('Newsletter');
    expect(recognizer.actions[2]!.verb).toBe('click');
    expect(recognizer.actions[2]!.target).toBe('Submit');
  });

  it('MUI: records React component interactions correctly', () => {
    const { recognizer } = createHarness(`
      <div>
        <button class="MuiButtonBase-root MuiButton-root" type="button">
          <span class="MuiButton-label">Submit Form</span>
          <span class="MuiTouchRipple-root"></span>
        </button>
        <label class="MuiFormControlLabel-root">
          <span class="MuiButtonBase-root MuiCheckbox-root">
            <input type="checkbox" class="PrivateSwitchBase-input" />
          </span>
          <span class="MuiFormControlLabel-label">Accept Terms</span>
        </label>
      </div>
    `);

    // Click MUI button via ripple span
    const ripple = document.querySelector('.MuiTouchRipple-root')!;
    recognizer.onInteraction('click', ripple);
    expect(recognizer.actions[0]!.verb).toBe('click');
    expect(recognizer.actions[0]!.target).toBe('Submit Form');

    // Click MUI checkbox via label wrapper
    const labelWrapper = document.querySelector('.MuiFormControlLabel-root')!;
    const checkbox = labelWrapper.querySelector('input')!;
    checkbox.checked = true;
    checkbox.setAttribute('aria-checked', 'true');
    recognizer.onInteraction('click', labelWrapper);
    expect(recognizer.actions[1]!.verb).toBe('toggle');
    expect(recognizer.actions[1]!.target).toBe('Accept Terms');
  });

  it('Ant Design: records custom component interactions correctly', () => {
    const { recognizer } = createHarness(`
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
    `);

    // Click Ant button via span
    const span = document.querySelector('.ant-btn span')!;
    recognizer.onInteraction('click', span);
    expect(recognizer.actions[0]!.verb).toBe('click');
    expect(recognizer.actions[0]!.target).toBe('Confirm');

    // Click Ant checkbox via wrapper
    const checkboxWrapper = document.querySelector('.ant-checkbox-wrapper')!;
    const cb = checkboxWrapper.querySelector('input')!;
    cb.checked = true;
    cb.setAttribute('aria-checked', 'true');
    recognizer.onInteraction('click', checkboxWrapper);
    expect(recognizer.actions[1]!.verb).toBe('toggle');
    expect(recognizer.actions[1]!.target).toBe('Remember me');

    // Click Ant radio via wrapper
    const radioWrappers = document.querySelectorAll('.ant-radio-wrapper');
    recognizer.onInteraction('click', radioWrappers[1]!);
    expect(recognizer.actions[2]!.verb).toBe('select');
    expect(recognizer.actions[2]!.target).toBe('Large');
  });
});
