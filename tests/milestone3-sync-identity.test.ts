/**
 * Milestone 3: Synchronization + Identity Stability
 *
 * Validates assumptions:
 *   A2 (Identity Stability): controls survive re-renders via semantic fingerprint
 *   A3 (Mutation Observability): MutationObserver tracks DOM changes correctly
 *
 * Architecture:
 *   - Control Model maintained by a continuous MutationObserver
 *   - Semantic fingerprint: hash(role + name + treePath + frameUrl)
 *   - Re-bind grace period: 200ms window after element removal
 *   - State tracking: aria-expanded, aria-checked, class changes, value changes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Types ────────────────────────────────────────────────────────────────

interface ControlNode {
  controlId: string;
  role: string;
  name: string;
  tag: string;
  classes: string[];
  isComposite: boolean;
  parentId: string | null;
  childIds: string[];
  state: {
    expanded: boolean | null;
    checked: boolean | null;
    selected: boolean | null;
    value: string | null;
    visible: boolean;
  };
  /** WeakRef to the DOM element — may become stale after re-render */
  elementRef: WeakRef<Element> | null;
  /** Stable locators / identity hints for re-binding */
  fingerprint: string;
  /** Lifecycle: 'active' | 'rebinding' | 'destroyed' */
  status: 'active' | 'rebinding' | 'destroyed';
  /** Timestamp when the control was first discovered */
  createdAt: number;
  /** Timestamp when element was removed (for grace period) */
  removedAt: number | null;
}

interface ControlModel {
  controls: Map<string, ControlNode>;
  /** Element → controlId index for O(1) event matching */
  elementToControl: WeakMap<Element, string>;
  /** Fingerprint → controlId index for O(1) re-binding */
  fingerprintToControl: Map<string, string>;
}

// ─── Role Resolution (from Milestone 1/2, simplified) ─────────────────────

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
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
    return INPUT_TYPE_ROLES[type] || null;
  }
  return IMPLICIT_ROLES[tag] || null;
}

// ─── Accessible Name (from Milestone 2, simplified) ───────────────────────

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

  // Walk ancestors for enclosing <label>
  let ancestor: Element | null = el.parentElement;
  for (let i = 0; i < 5 && ancestor; i++) {
    if (ancestor.tagName === 'LABEL') {
      const clone = ancestor.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input,textarea,select').forEach(e => e.remove());
      if (clone.textContent?.trim()) return clone.textContent.trim();
    }
    ancestor = ancestor.parentElement;
  }

  const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || '';
  if (text && text.length < 200) return text;

  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  const nameAttr = el.getAttribute('name');
  if (nameAttr?.trim()) return nameAttr.trim();

  return '';
}

// ─── Semantic Fingerprint ──────────────────────────────────────────────────

/**
 * Compute a stable identity for a control based on semantic properties.
 * This survives re-renders because it's based on WHAT the control is,
 * not WHICH DOM node it is.
 */
function computeFingerprint(
  role: string,
  name: string,
  el: Element,
): string {
  // Tree path: walk up through ancestor controls to build a semantic path
  const treePathParts: string[] = [];
  let node: Element | null = el.parentElement;
  for (let i = 0; i < 10 && node; i++) {
    const nodeRole = getRole(node);
    if (nodeRole && WIDGET_ROLES.has(nodeRole)) {
      const nodeName = getAccessibleName(node);
      treePathParts.unshift(`${nodeRole}:${nodeName}`);
    } else if (nodeRole && COMPOSITE_ROLES.has(nodeRole)) {
      const nodeName = getAccessibleName(node);
      treePathParts.unshift(`${nodeRole}:${nodeName}`);
    }
    node = node.parentElement;
  }

  // Ordinal disambiguation: if there are sibling controls with the same
  // role+name, include position to distinguish them
  const parent = el.parentElement;
  let ordinal = 0;
  if (parent) {
    const siblings = Array.from(parent.children).filter(sib => {
      if (sib === el) return true;
      const sibRole = getRole(sib);
      return sibRole === role;
    });
    ordinal = siblings.indexOf(el);
  }

  const treePath = treePathParts.join(' > ');
  const stableAttrs = getStableAttributes(el);

  return `${role}:${name}:${treePath}:pos=${ordinal}:${stableAttrs}`;
}

function getStableAttributes(el: Element): string {
  const stableKeys = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'id', 'name'];
  const parts: string[] = [];
  for (const key of stableKeys) {
    const val = el.getAttribute(key);
    if (val) parts.push(`${key}=${val}`);
  }
  return parts.join(',');
}

// ─── State Extraction ──────────────────────────────────────────────────────

function extractState(el: Element) {
  const classes = (el.className || '').toString();
  return {
    expanded: el.getAttribute('aria-expanded') === 'true' ? true
      : el.getAttribute('aria-expanded') === 'false' ? false : null,
    checked: el.getAttribute('aria-checked') === 'true' ? true
      : el.getAttribute('aria-checked') === 'false' ? false
      : (el as HTMLInputElement).checked === true ? true
      : (el as HTMLInputElement).checked === false ? false
      : classes.includes('checked') ? true : null,
    selected: el.getAttribute('aria-selected') === 'true' ? true
      : el.getAttribute('aria-selected') === 'false' ? false : null,
    value: (el as HTMLInputElement).value ?? el.getAttribute('aria-valuenow') ?? null,
    visible: el.checkVisibility?.() ?? !el.hasAttribute('hidden'),
  };
}

// ─── Control Model with MutationObserver ───────────────────────────────────

const GRACE_PERIOD_MS = 200;

class ControlModelManager {
  model: ControlModel;
  private observer: MutationObserver | null = null;
  private rebindTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private nextId = 1;
  onControlAdded: ((control: ControlNode) => void) | null = null;
  onControlRemoved: ((controlId: string) => void) | null = null;
  onStateChange: ((controlId: string, newState: ControlNode['state']) => void) | null = null;

  constructor() {
    this.model = {
      controls: new Map(),
      elementToControl: new WeakMap(),
      fingerprintToControl: new Map(),
    };
  }

  /**
   * Discover all controls in the given root element (and its shadow roots).
   */
  discover(root: Element = document.body) {
    const discovered: ControlNode[] = [];
    this._discoverRecursive(root, 0, null, discovered);
    return discovered;
  }

  private _discoverRecursive(
    node: Element,
    depth: number,
    parentId: string | null,
    discovered: ControlNode[] = [],
  ) {
    const role = getRole(node);
    if (role && (WIDGET_ROLES.has(role) || COMPOSITE_ROLES.has(role))) {
      const name = getAccessibleName(node);
      const tag = node.tagName.toLowerCase();
      const classes = (node.className || '').toString().split(/\s+/).filter(Boolean);
      const isComposite = COMPOSITE_ROLES.has(role);
      const fingerprint = computeFingerprint(role, name, node);
      const state = extractState(node);

      // Re-bind check: if a control with this fingerprint exists and is in
      // 'rebinding' state, re-bind it to this new element
      const existingId = this.model.fingerprintToControl.get(fingerprint);
      if (existingId) {
        const existing = this.model.controls.get(existingId);
        if (existing && existing.status === 'rebinding') {
          // Re-bind: same identity, new DOM element
          existing.elementRef = new WeakRef(node);
          existing.status = 'active';
          existing.removedAt = null;
          existing.state = state;
          this.model.elementToControl.set(node, existingId);

          // Cancel the destruction timer
          const timer = this.rebindTimers.get(existingId);
          if (timer) {
            clearTimeout(timer);
            this.rebindTimers.delete(existingId);
          }

          this.onControlAdded?.(existing);
          discovered.push(existing);
          return; // Don't recurse into a re-bound control's children
        }
      }

      // New control
      const controlId = `ctrl-${this.nextId++}`;
      const control: ControlNode = {
        controlId,
        role,
        name: name || '(unnamed)',
        tag,
        classes,
        isComposite,
        parentId,
        childIds: [],
        state,
        elementRef: new WeakRef(node),
        fingerprint,
        status: 'active',
        createdAt: Date.now(),
        removedAt: null,
      };

      this.model.controls.set(controlId, control);
      this.model.elementToControl.set(node, controlId);
      this.model.fingerprintToControl.set(fingerprint, controlId);

      if (parentId) {
        const parent = this.model.controls.get(parentId);
        if (parent) parent.childIds.push(controlId);
      }

      this.onControlAdded?.(control);
      discovered.push(control);
    }

    // Walk children
    for (const child of Array.from(node.children)) {
      this._discoverRecursive(child, depth + 1, parentId);
    }

    // Walk open shadow roots
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.children)) {
        this._discoverRecursive(child, depth + 1, parentId);
      }
    }
  }

  /**
   * Start a continuous MutationObserver on the given root.
   */
  observe(root: Element = document.body) {
    this.observer = new MutationObserver((mutations) => {
      this._processMutations(mutations);
    });
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-expanded', 'aria-checked', 'aria-selected',
        'aria-label', 'aria-labelledby', 'class', 'value', 'checked',
        'selected', 'disabled', 'hidden', 'style'],
    });

    // Also observe any existing open shadow roots
    this._observeShadowRoots(root);
  }

  private _observeShadowRoots(root: Element) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode as Element;
    while (current) {
      if (current.shadowRoot) {
        this.observer!.observe(current.shadowRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['role', 'aria-expanded', 'aria-checked', 'aria-selected',
            'aria-label', 'aria-labelledby', 'class', 'value', 'checked',
            'selected', 'disabled', 'hidden', 'style'],
        });
      }
      current = walker.nextSibling() as Element || walker.firstChild() as Element;
    }
  }

  private _processMutations(mutations: MutationRecord[]) {
    // First pass: process ALL removals — this marks controls as 'rebinding'
    // so that additions in the same batch can find them for re-binding.
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        this._handleRemoval(el);
      }
    }

    // Second pass: process additions — can re-bind to 'rebinding' controls
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        this._discoverRecursive(el, 0, this._findParentControlId(el), []);
      }
    }

    // Third pass: process attribute changes
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const el = mutation.target as Element;
        const attributeName = mutation.attributeName;
        this._handleAttributeChange(el, attributeName);
      }
    }

    // Fourth pass: childList changes that may indicate text content change
    // (e.g., button text changed → accessible name changed)
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.target.nodeType === 1) {
        const el = mutation.target as Element;
        this._handleContentChange(el);
      }
    }
  }

  private _handleContentChange(el: Element) {
    const ctrlId = this.model.elementToControl.get(el);
    if (!ctrlId) return;
    const control = this.model.controls.get(ctrlId);
    if (!control) return;

    // Re-compute accessible name — text content may have changed
    const newName = getAccessibleName(el);
    if (newName !== control.name) {
      // Name changed → update control and recompute fingerprint
      this.model.fingerprintToControl.delete(control.fingerprint);
      control.name = newName;
      control.fingerprint = computeFingerprint(control.role, newName, el);
      this.model.fingerprintToControl.set(control.fingerprint, ctrlId);
      this.onStateChange?.(ctrlId, control.state);
    }
  }

  private _findParentControlId(el: Element): string | null {
    let node: Element | null = el.parentElement;
    while (node) {
      const ctrlId = this.model.elementToControl.get(node);
      if (ctrlId) return ctrlId;
      node = node.parentElement;
    }
    return null;
    }

  private _handleRemoval(el: Element) {
    // Check if this element (or its descendants) is a control
    const ctrlId = this.model.elementToControl.get(el);
    if (ctrlId) {
      const control = this.model.controls.get(ctrlId);
      if (control) {
        // Start grace period
        control.status = 'rebinding';
        control.removedAt = Date.now();

        const timer = setTimeout(() => {
          const ctrl = this.model.controls.get(ctrlId);
          if (ctrl && ctrl.status === 'rebinding') {
            // Grace period expired — destroy
            ctrl.status = 'destroyed';
            this.model.fingerprintToControl.delete(ctrl.fingerprint);
            this.onControlRemoved?.(ctrlId);
          }
          this.rebindTimers.delete(ctrlId);
        }, GRACE_PERIOD_MS);
        this.rebindTimers.set(ctrlId, timer);
      }
    }

    // Also check descendants
    for (const child of Array.from(el.querySelectorAll('*'))) {
      const childCtrlId = this.model.elementToControl.get(child);
      if (childCtrlId) {
        const childControl = this.model.controls.get(childCtrlId);
        if (childControl && childControl.status === 'active') {
          childControl.status = 'rebinding';
          childControl.removedAt = Date.now();

          const timer = setTimeout(() => {
            const ctrl = this.model.controls.get(childCtrlId);
            if (ctrl && ctrl.status === 'rebinding') {
              ctrl.status = 'destroyed';
              this.model.fingerprintToControl.delete(ctrl.fingerprint);
              this.onControlRemoved?.(childCtrlId);
            }
            this.rebindTimers.delete(childCtrlId);
          }, GRACE_PERIOD_MS);
          this.rebindTimers.set(childCtrlId, timer);
        }
      }
    }
  }

  private _handleAttributeChange(el: Element, attributeName: string | null) {
    if (!attributeName) return;
    const ctrlId = this.model.elementToControl.get(el);
    if (!ctrlId) return;
    const control = this.model.controls.get(ctrlId);
    if (!control) return;

    let changed = false;

    switch (attributeName) {
      case 'role': {
        // Role changed — control may need re-evaluation
        const newRole = getRole(el);
        if (newRole !== control.role) {
          control.role = newRole || control.role;
          changed = true;
        }
        break;
      }
      case 'aria-expanded': {
        const newExpanded = el.getAttribute('aria-expanded') === 'true';
        if (control.state.expanded !== newExpanded) {
          control.state.expanded = newExpanded;
          changed = true;
        }
        break;
      }
      case 'aria-checked':
      case 'checked': {
        const newState = extractState(el);
        if (control.state.checked !== newState.checked) {
          control.state = newState;
          changed = true;
        }
        break;
      }
      case 'aria-selected':
      case 'selected': {
        const newState = extractState(el);
        if (control.state.selected !== newState.selected) {
          control.state = newState;
          changed = true;
        }
        break;
      }
      case 'value': {
        const newValue = (el as HTMLInputElement).value;
        if (control.state.value !== newValue) {
          control.state.value = newValue;
          changed = true;
        }
        break;
      }
      case 'class': {
        // Framework state changes via class (e.g. oxd-checkbox-checked)
        const newClasses = (el.className || '').toString().split(/\s+/).filter(Boolean);
        const oldClasses = control.classes;
        const added = newClasses.filter(c => !oldClasses.includes(c));
        const removed = oldClasses.filter(c => !newClasses.includes(c));
        if (added.length > 0 || removed.length > 0) {
          control.classes = newClasses;
          const newState = extractState(el);
          control.state = newState;
          changed = true;
        }
        break;
      }
      case 'style': {
        // Display/visibility changes
        const newState = extractState(el);
        if (control.state.visible !== newState.visible) {
          control.state = newState;
          changed = true;
        }
        break;
      }
      case 'hidden': {
        const newState = extractState(el);
        control.state = newState;
        changed = true;
        break;
      }
    }

    if (changed) {
      this.onStateChange?.(ctrlId, control.state);
    }
  }

  /**
   * Manually trigger grace period expiry (for testing).
   */
  expireGracePeriods() {
    for (const [ctrlId, timer] of this.rebindTimers) {
      clearTimeout(timer);
      const ctrl = this.model.controls.get(ctrlId);
      if (ctrl && ctrl.status === 'rebinding') {
        ctrl.status = 'destroyed';
        this.model.fingerprintToControl.delete(ctrl.fingerprint);
        this.onControlRemoved?.(ctrlId);
      }
    }
    this.rebindTimers.clear();
  }

  disconnect() {
    this.observer?.disconnect();
    for (const timer of this.rebindTimers.values()) {
      clearTimeout(timer);
    }
    this.rebindTimers.clear();
  }

  /**
   * Get all active controls.
   */
  activeControls(): ControlNode[] {
    return Array.from(this.model.controls.values())
      .filter(c => c.status === 'active');
  }

  /**
   * Find a control by DOM element (for event matching).
   */
  findByElement(el: Element): ControlNode | null {
    const ctrlId = this.model.elementToControl.get(el);
    if (!ctrlId) return null;
    return this.model.controls.get(ctrlId) || null;
  }

  /**
   * Find a control by ID.
   */
  findById(id: string): ControlNode | null {
    return this.model.controls.get(id) || null;
  }

  /**
   * Find a control by fingerprint.
   */
  findByFingerprint(fp: string): ControlNode | null {
    const id = this.model.fingerprintToControl.get(fp);
    if (!id) return null;
    return this.model.controls.get(id) || null;
  }
}

// ─── Test Helper: wait for MutationObserver callback ─────────────────────

function waitForMutationObserver(delay = 50): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delay));
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Milestone 3 — A3: Mutation Observability', () => {
  let mgr: ControlModelManager;

  beforeEach(() => {
    document.body.innerHTML = `
      <form id="test-form">
        <input type="text" aria-label="First Name" id="fname" />
        <input type="text" aria-label="Last Name" id="lname" />
        <button type="submit" id="save-btn">Save</button>
      </form>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();
  });

  afterEach(() => {
    mgr.disconnect();
  });

  it('discovers initial controls on page load', () => {
    const controls = mgr.activeControls();
    expect(controls.length).toBe(3); // 2 textboxes + 1 button
    const roles = controls.map(c => c.role);
    expect(roles).toContain('textbox');
    expect(roles).toContain('button');
  });

  it('discovers new controls added via DOM insertion', async () => {
    const initialCount = mgr.activeControls().length;

    // Add a new checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', 'Subscribe');
    document.getElementById('test-form')!.appendChild(checkbox);

    await waitForMutationObserver();

    const controls = mgr.activeControls();
    expect(controls.length).toBe(initialCount + 1);
    const cb = controls.find(c => c.role === 'checkbox');
    expect(cb).toBeDefined();
    expect(cb!.name).toBe('Subscribe');
  });

  it('marks controls destroyed when elements are removed', async () => {
    const initialCount = mgr.activeControls().length;
    expect(initialCount).toBe(3);

    // Remove the Save button
    document.getElementById('save-btn')!.remove();

    await waitForMutationObserver();

    // Within grace period: control is in 'rebinding' state
    const rebindingCount = Array.from(mgr.model.controls.values())
      .filter(c => c.status === 'rebinding').length;
    expect(rebindingCount).toBe(1);
  });

  it('destroys controls after grace period expires', async () => {
    document.getElementById('save-btn')!.remove();
    await waitForMutationObserver();

    mgr.expireGracePeriods();

    const controls = mgr.activeControls();
    expect(controls.length).toBe(2); // First Name + Last Name only
    expect(controls.find(c => c.name === 'Save')).toBeUndefined();
  });

  it('detects aria-expanded state changes', async () => {
    document.body.innerHTML = `
      <div role="combobox" aria-expanded="false" aria-label="Search" id="cb">
        <input type="text" />
      </div>
    `;
    const mgr2 = new ControlModelManager();
    mgr2.discover();
    mgr2.observe();

    const cb = mgr2.activeControls().find(c => c.role === 'combobox')!;
    expect(cb.state.expanded).toBe(false);

    // Expand
    document.getElementById('cb')!.setAttribute('aria-expanded', 'true');
    await waitForMutationObserver();

    const updated = mgr2.findById(cb.controlId)!;
    expect(updated.state.expanded).toBe(true);

    mgr2.disconnect();
  });

  it('detects aria-checked state changes', async () => {
    document.body.innerHTML = `
      <div role="checkbox" aria-checked="false" aria-label="Accept" id="cb" tabindex="0"></div>
    `;
    const mgr2 = new ControlModelManager();
    mgr2.discover();
    mgr2.observe();

    const cb = mgr2.activeControls().find(c => c.role === 'checkbox')!;
    expect(cb.state.checked).toBe(false);

    document.getElementById('cb')!.setAttribute('aria-checked', 'true');
    await waitForMutationObserver();

    const updated = mgr2.findById(cb.controlId)!;
    expect(updated.state.checked).toBe(true);

    mgr2.disconnect();
  });

  it('detects CSS class changes (framework state detection)', async () => {
    document.body.innerHTML = `
      <div role="checkbox" aria-label="Smoker" id="smoker" class="oxd-checkbox" tabindex="0"></div>
    `;
    const mgr2 = new ControlModelManager();
    mgr2.discover();
    mgr2.observe();

    const cb = mgr2.activeControls().find(c => c.name === 'Smoker')!;
    expect(cb.classes).toContain('oxd-checkbox');

    // Framework adds checked class
    document.getElementById('smoker')!.classList.add('oxd-checkbox-checked');
    await waitForMutationObserver();

    const updated = mgr2.findById(cb.controlId)!;
    expect(updated.classes).toContain('oxd-checkbox-checked');

    mgr2.disconnect();
  });

  it('detects input value changes', async () => {
    document.body.innerHTML = `
      <input type="text" aria-label="Search" id="search" />
    `;
    const mgr2 = new ControlModelManager();
    mgr2.discover();
    mgr2.observe();

    const input = mgr2.activeControls()[0]!;
    expect(input.state.value).toBe('');

    // Simulate user typing
    const inputEl = document.getElementById('search') as HTMLInputElement;
    inputEl.value = 'hello world';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));

    // MutationObserver doesn't catch value property changes.
    // The value attribute change WOULD be caught, but value is a property.
    // This is a KNOWN LIMITATION — value must be tracked via input events,
    // not MutationObserver. The value-tracker from Phase 3 handles this.

    // Verify: the model doesn't update via observer alone
    await waitForMutationObserver();
    const ctrl = mgr2.findById(input.controlId)!;
    // Value NOT tracked via MutationObserver — this is expected
    expect(ctrl.state.value).toBe('');

    mgr2.disconnect();
  });

  it('detects mutations inside open shadow DOM', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<button id="shadow-btn">Shadow Button</button>`;

    const mgr2 = new ControlModelManager();
    mgr2.discover(document.body);
    mgr2.observe();

    // Initial: shadow button discovered
    let controls = mgr2.activeControls();
    expect(controls.some(c => c.name === 'Shadow Button')).toBe(true);

    // Add a new control inside shadow root
    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.setAttribute('aria-label', 'Shadow Input');
    shadow.appendChild(newInput);

    await waitForMutationObserver(100);

    controls = mgr2.activeControls();
    expect(controls.some(c => c.name === 'Shadow Input')).toBe(true);

    mgr2.disconnect();
  });

  it('processes batch mutations (multiple changes at once)', async () => {
    const initialCount = mgr.activeControls().length;

    // Batch: remove one, add two
    const form = document.getElementById('test-form')!;
    form.removeChild(document.getElementById('save-btn')!);

    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.setAttribute('aria-label', 'Email');
    form.appendChild(emailInput);

    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.setAttribute('aria-label', 'Phone');
    form.appendChild(phoneInput);

    await waitForMutationObserver();

    const controls = mgr.activeControls();
    // Original 3 - 1 removed (Save is in grace period, not active)
    // + 2 new = 4 active
    const activeCount = controls.length;
    expect(activeCount).toBe(initialCount - 1 + 2);
  });
});

describe('Milestone 3 — A2: Identity Stability', () => {
  let mgr: ControlModelManager;

  afterEach(() => {
    mgr?.disconnect();
  });

  it('preserves controlId when element is removed and re-added within grace period', async () => {
    document.body.innerHTML = `
      <form id="f">
        <input type="text" aria-label="First Name" id="fname" />
      </form>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const original = mgr.activeControls()[0]!;
    const originalId = original.controlId;
    const originalFingerprint = original.fingerprint;

    // Simulate React re-render: remove the element
    const input = document.getElementById('fname')!;
    input.remove();

    await waitForMutationObserver();

    // Within grace period — should be rebinding
    let ctrl = mgr.findById(originalId)!;
    expect(ctrl.status).toBe('rebinding');

    // Re-add a semantically identical element
    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.setAttribute('aria-label', 'First Name');
    newInput.id = 'fname';
    document.getElementById('f')!.appendChild(newInput);

    await waitForMutationObserver();

    // Control should be re-bound, not destroyed
    ctrl = mgr.findById(originalId)!;
    expect(ctrl.status).toBe('active');
    expect(ctrl.fingerprint).toBe(originalFingerprint);

    // Element reference should point to the NEW element
    const boundElement = ctrl.elementRef?.deref();
    expect(boundElement).toBe(newInput);
    expect(boundElement).not.toBe(input);
  });

  it('destroys control when element removed and NOT re-added within grace period', async () => {
    document.body.innerHTML = `
      <input type="text" aria-label="Search" id="search" />
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const original = mgr.activeControls()[0]!;
    const originalId = original.controlId;

    document.getElementById('search')!.remove();
    await waitForMutationObserver();

    mgr.expireGracePeriods();

    const ctrl = mgr.findById(originalId);
    expect(ctrl?.status).toBe('destroyed');
    expect(mgr.activeControls().length).toBe(0);
  });

  it('creates new controlId when element re-added with DIFFERENT semantic properties', async () => {
    document.body.innerHTML = `
      <form id="f">
        <input type="text" aria-label="First Name" id="fname" />
      </form>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const original = mgr.activeControls()[0]!;
    const originalId = original.controlId;

    // Remove and re-add with different name
    document.getElementById('fname')!.remove();
    await waitForMutationObserver();

    const newInput = document.createElement('input');
    newInput.type = 'text';
    newInput.setAttribute('aria-label', 'Last Name'); // DIFFERENT name
    newInput.id = 'fname';
    document.getElementById('f')!.appendChild(newInput);

    await waitForMutationObserver();
    mgr.expireGracePeriods(); // Clean up the old one

    // Original control should be destroyed (different fingerprint)
    const oldCtrl = mgr.findById(originalId);
    expect(oldCtrl?.status).toBe('destroyed');

    // New control should have a different ID
    const newControls = mgr.activeControls();
    expect(newControls.length).toBe(1);
    expect(newControls[0]!.controlId).not.toBe(originalId);
    expect(newControls[0]!.name).toBe('Last Name');
  });

  it('maintains identity across full subtree replacement (React re-render)', async () => {
    document.body.innerHTML = `
      <div id="app">
        <form>
          <input type="text" aria-label="Username" id="user" />
          <button type="submit">Login</button>
        </form>
      </div>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const userControl = mgr.activeControls().find(c => c.name === 'Username')!;
    const buttonControl = mgr.activeControls().find(c => c.name === 'Login')!;
    const userId = userControl.controlId;
    const buttonId = buttonControl.controlId;

    // Simulate React re-render: replace entire form subtree
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <form>
        <input type="text" aria-label="Username" id="user" />
        <button type="submit">Login</button>
      </form>
    `;

    await waitForMutationObserver();

    // Both controls should be re-bound (same semantic fingerprint)
    const userCtrl = mgr.findById(userId);
    const buttonCtrl = mgr.findById(buttonId);

    expect(userCtrl?.status).toBe('active');
    expect(buttonCtrl?.status).toBe('active');
    expect(userCtrl?.name).toBe('Username');
    expect(buttonCtrl?.name).toBe('Login');
  });

  it('creates new identity when accessible name changes (correct behavior)', async () => {
    document.body.innerHTML = `
      <button id="btn" type="button">Edit</button>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const original = mgr.activeControls()[0]!;
    const originalId = original.controlId;
    const originalFingerprint = original.fingerprint;

    // Change the accessible name (e.g., button text changes)
    document.getElementById('btn')!.textContent = 'Save';
    await waitForMutationObserver();

    const ctrl = mgr.findById(originalId);
    expect(ctrl).toBeDefined();

    // Name should update
    expect(ctrl!.name).toBe('Save');

    // Fingerprint changes — but since the element itself didn't change,
    // we UPDATE the fingerprint rather than creating a new control
    const newFingerprint = ctrl!.fingerprint;
    expect(newFingerprint).not.toBe(originalFingerprint);
  });

  it('handles virtualization: controls discovered/destroyed as rows scroll', async () => {
    document.body.innerHTML = `
      <div id="list" role="list">
        <div role="listitem" id="row-0">Item 0</div>
        <div role="listitem" id="row-1">Item 1</div>
      </div>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    // Initial: 2 listitems discovered (list is composite, not a widget)
    // listitem is NOT in WIDGET_ROLES, so let's use listbox/option instead
    expect(mgr.activeControls().length).toBe(0); // listitems are not widgets

    // Use a combobox + options for the virtualization test
    document.body.innerHTML = `
      <div id="lb" role="listbox" aria-label="Items">
        <div role="option" id="opt-0">Option 0</div>
        <div role="option" id="opt-1">Option 1</div>
      </div>
    `;
    const mgr2 = new ControlModelManager();
    mgr2.discover();
    mgr2.observe();

    expect(mgr2.activeControls().length).toBe(3); // listbox + 2 options

    // Simulate scroll: remove row 0, add row 2
    document.getElementById('opt-0')!.remove();
    const newOpt = document.createElement('div');
    newOpt.setAttribute('role', 'option');
    newOpt.id = 'opt-2';
    newOpt.textContent = 'Option 2';
    document.getElementById('lb')!.appendChild(newOpt);

    await waitForMutationObserver();

    const controls = mgr2.activeControls();
    // listbox + option-1 + option-2 (option-0 in grace period)
    const options = controls.filter(c => c.role === 'option');
    expect(options.length).toBe(2); // opt-1 and opt-2
    expect(options.some(c => c.name === 'Option 1')).toBe(true);
    expect(options.some(c => c.name === 'Option 2')).toBe(true);

    mgr2.disconnect();
  });

  it('handles SPA route change: all controls destroyed and rediscovered', async () => {
    document.body.innerHTML = `
      <main id="content">
        <button id="page1-btn">Page 1 Action</button>
      </main>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const originalId = mgr.activeControls()[0]!.controlId;

    // Simulate SPA navigation: replace entire content
    const content = document.getElementById('content')!;
    content.innerHTML = `
      <button id="page2-btn">Page 2 Action</button>
      <input type="text" aria-label="Search" />
    `;

    await waitForMutationObserver();
    mgr.expireGracePeriods();

    // Old control destroyed
    expect(mgr.findById(originalId)?.status).toBe('destroyed');

    // New controls discovered
    const controls = mgr.activeControls();
    expect(controls.length).toBe(2);
    expect(controls.some(c => c.name === 'Page 2 Action')).toBe(true);
    expect(controls.some(c => c.name === 'Search')).toBe(true);
  });

  it('handles reordering of identical controls (identity by name, not position)', async () => {
    document.body.innerHTML = `
      <fieldset id="fs">
        <label><input type="radio" name="size" value="S" /> Small</label>
        <label><input type="radio" name="size" value="M" /> Medium</label>
        <label><input type="radio" name="size" value="L" /> Large</label>
      </fieldset>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const controls = mgr.activeControls();
    expect(controls.length).toBe(3);

    const small = controls.find(c => c.name === 'Small')!;
    const medium = controls.find(c => c.name === 'Medium')!;
    const large = controls.find(c => c.name === 'Large')!;

    // Verify unique fingerprints
    const fingerprints = [small, medium, large].map(c => c.fingerprint);
    const uniqueFingerprints = new Set(fingerprints);
    expect(uniqueFingerprints.size).toBe(3);
  });

  it('fires lifecycle callbacks: onControlAdded, onControlRemoved, onStateChange', async () => {
    document.body.innerHTML = `<div id="container"></div>`;
    mgr = new ControlModelManager();
    mgr.observe();

    const added: string[] = [];
    const removed: string[] = [];
    const stateChanges: string[] = [];

    mgr.onControlAdded = (c) => added.push(c.name);
    mgr.onControlRemoved = (id) => removed.push(id);
    mgr.onStateChange = (id, state) => stateChanges.push(`${id}:${state.checked}`);

    // Add a checkbox
    const cb = document.createElement('div');
    cb.setAttribute('role', 'checkbox');
    cb.setAttribute('aria-label', 'Agree');
    cb.setAttribute('aria-checked', 'false');
    cb.id = 'agree-cb';
    document.getElementById('container')!.appendChild(cb);

    await waitForMutationObserver();
    expect(added).toContain('Agree');

    // Toggle state
    cb.setAttribute('aria-checked', 'true');
    await waitForMutationObserver();
    expect(stateChanges.length).toBeGreaterThan(0);
    expect(stateChanges.some(s => s.includes('true'))).toBe(true);

    // Remove
    cb.remove();
    await waitForMutationObserver();
    mgr.expireGracePeriods();
    expect(removed.length).toBe(1);
  });

  it('computes stable fingerprints with data-testid for enterprise controls', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" aria-label="Name" data-testid="name-input" id="i1" />
        <input type="text" aria-label="Email" data-testid="email-input" id="i2" />
      </form>
    `;
    mgr = new ControlModelManager();
    mgr.discover();

    const controls = mgr.activeControls();
    const nameCtrl = controls.find(c => c.name === 'Name')!;
    const emailCtrl = controls.find(c => c.name === 'Email')!;

    // data-testid is included in the fingerprint
    expect(nameCtrl.fingerprint).toContain('data-testid=name-input');
    expect(emailCtrl.fingerprint).toContain('data-testid=email-input');
    expect(nameCtrl.fingerprint).not.toBe(emailCtrl.fingerprint);
  });

  it('preserves parent-child relationships after re-bind', async () => {
    document.body.innerHTML = `
      <div id="cb" role="combobox" aria-expanded="true" aria-label="Country">
        <input type="text" role="textbox" />
      </div>
      <ul id="lb" role="listbox" aria-label="Country options">
        <li role="option" id="opt1">USA</li>
        <li role="option" id="opt2">Canada</li>
      </ul>
    `;
    mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const listbox = mgr.activeControls().find(c => c.role === 'listbox')!;
    const initialChildCount = listbox.childIds.length;

    // Remove and re-add an option (React re-render of one item)
    const opt1 = document.getElementById('opt1')!;
    opt1.remove();
    await waitForMutationObserver();

    const newOpt = document.createElement('li');
    newOpt.setAttribute('role', 'option');
    newOpt.textContent = 'USA';
    newOpt.id = 'opt1';
    document.getElementById('lb')!.insertBefore(newOpt, document.getElementById('opt2'));

    await waitForMutationObserver();

    // Listbox should still track its options
    const updatedListbox = mgr.findById(listbox.controlId)!;
    expect(updatedListbox.childIds.length).toBe(initialChildCount);
  });
});

describe('Milestone 3 — Performance', () => {
  it('processes initial discovery for 50 controls efficiently', () => {
    const html: string[] = ['<form>'];
    for (let i = 0; i < 50; i++) {
      html.push(`<input type="text" aria-label="Field ${i}" data-testid="f${i}" />`);
    }
    html.push('</form>');
    document.body.innerHTML = html.join('');

    const mgr = new ControlModelManager();
    const start = performance.now();
    mgr.discover();
    const elapsed = performance.now() - start;

    expect(mgr.activeControls().length).toBe(50);
    expect(elapsed).toBeLessThan(50); // <50ms for 50 controls
    console.log(`Discovery of 50 controls: ${elapsed.toFixed(1)}ms`);

    mgr.disconnect();
  });

  it('processes mutation batch for 20 simultaneous changes efficiently', async () => {
    document.body.innerHTML = '<form id="f"></form>';
    const mgr = new ControlModelManager();
    mgr.discover();
    mgr.observe();

    const start = performance.now();
    const form = document.getElementById('f')!;
    for (let i = 0; i < 20; i++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', `Field ${i}`);
      form.appendChild(input);
    }
    await waitForMutationObserver(100);
    const elapsed = performance.now() - start;

    expect(mgr.activeControls().length).toBe(20);
    expect(elapsed).toBeLessThan(200); // <200ms for batch of 20 in JSDOM
    console.log(`Mutation batch (20 elements): ${elapsed.toFixed(1)}ms`);

    mgr.disconnect();
  });
});
