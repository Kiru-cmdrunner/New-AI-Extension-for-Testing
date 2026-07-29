/**
 * Stage 1 — Production Control Model
 *
 * The core component that discovers, tracks, and resolves DOM elements
 * to logical interaction units ("controls").
 *
 * This is the validated algorithm from Milestones 2–5, extracted from
 * the inline test prototypes into production source.
 *
 * Responsibilities:
 * - discover(root): tree walk, create ControlNodes for all widget + composite roles
 * - observe(root): MutationObserver for dynamically added elements
 * - matchEvent(targetEl): resolve a DOM event target to the correct control
 * - findByElement(el): O(1) WeakMap lookup
 *
 * Three matchEvent strategies (in priority order):
 * 1. Ancestor walk (composedPath) — skip COMPOSITE roles, return first WIDGET
 * 2. Lazy discovery — element was added dynamically, discover on the fly
 * 3. Label/wrapper fallback — find input inside <label> or OXD wrapper
 *
 * This is the fix for the v10.4.18 "Nationality → Blood Type" bug:
 * the ancestor walk skips composite containers (radiogroup, listbox) and
 * the label-wrapper fallback correctly resolves clicks on wrapper elements
 * to their inner inputs.
 */

import type { ControlNode } from './types';
import { WIDGET_ROLES, COMPOSITE_ROLES, TRACKABLE_ROLES } from './types';
import { getRole, getAccessibleName } from './identity-extractor';
import { isOxdWrapper } from './framework-adapters';

/**
 * Roles to skip during the matchEvent ancestor walk.
 * These are PURE containers — the user never interacts with them directly.
 * The user interacts with child widgets inside them (radio inside radiogroup,
 * option inside listbox, etc.).
 *
 * Note: `combobox` is in COMPOSITE_ROLES but is ALSO an interaction target
 * (clicking it opens the dropdown), so it is NOT in this skip set.
 */
const SKIP_IN_ANCESTOR_WALK = new Set<string>();
for (const role of COMPOSITE_ROLES) {
  if (!WIDGET_ROLES.has(role)) {
    SKIP_IN_ANCESTOR_WALK.add(role);
  }
}

export class ControlModel {
  /** All discovered controls, keyed by controlId. */
  readonly controls = new Map<string, ControlNode>();

  /** O(1) element → controlId lookup (WeakMap, doesn't prevent GC). */
  readonly elementToControl = new WeakMap<Element, string>();

  private nextId = 1;
  private observer: MutationObserver | null = null;

  // ─── Discovery ───────────────────────────────────────────────────────────

  /**
   * Walk the DOM tree from root, creating ControlNodes for all elements
   * with a trackable role (widget or composite).
   *
   * Handles shadow roots: descends into open shadow roots (closed shadow
   * roots are not accessible from outside).
   */
  discover(root: Element = document.body): void {
    this._discover(root, null);
  }

  /** Recursive discovery implementation. */
  private _discover(node: Element, parentId: string | null): void {
    const role = getRole(node);
    let myId: string | null = null;

    if (role && TRACKABLE_ROLES.has(role)) {
      const name = getAccessibleName(node);
      myId = `ctrl-${this.nextId++}`;
      const tag = node.tagName.toLowerCase();
      const classes = (node.className || '').toString().split(/\s+/).filter(Boolean);

      this.controls.set(myId, {
        controlId: myId,
        role,
        name: name || '(unnamed)',
        tag,
        classes,
        parentId,
        state: this._readState(node),
        elementRef: new WeakRef(node),
      });
      this.elementToControl.set(node, myId);
    }

    // Recurse into children
    for (const child of Array.from(node.children)) {
      this._discover(child, myId || parentId);
    }

    // Descend into open shadow roots
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.children)) {
        this._discover(child, myId || parentId);
      }
    }
  }

  /** Read the observable state from a DOM element. */
  private _readState(el: Element): ControlNode['state'] {
    const get = (attr: string): boolean | null => {
      const val = el.getAttribute(attr);
      if (val === 'true') return true;
      if (val === 'false') return false;
      return null;
    };

    return {
      expanded: get('aria-expanded'),
      checked: get('aria-checked') ?? (el as HTMLInputElement).checked ?? null,
      selected: get('aria-selected'),
      value: (el as HTMLInputElement).value ?? null,
    };
  }

  // ─── Mutation Observation ────────────────────────────────────────────────

  /**
   * Observe the root for dynamically added elements (dropdown options,
   * calendar days, modal content, etc.) and discover them as they appear.
   *
   * Also watches attribute changes (aria-expanded, aria-checked, etc.) for
   * state tracking. State updates are read lazily by callers via findByElement.
   */
  observe(root: Element = document.body): void {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Discover newly added elements
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
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'role', 'aria-expanded', 'aria-checked', 'aria-selected',
        'class', 'value', 'checked', 'hidden', 'style',
      ],
    });
  }

  /** Stop observing and clean up. */
  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  // ─── Lookup ──────────────────────────────────────────────────────────────

  /** O(1) element → control lookup via WeakMap. */
  findByElement(el: Element): ControlNode | null {
    const id = this.elementToControl.get(el);
    return id ? this.controls.get(id) || null : null;
  }

  // ─── Event Matching ──────────────────────────────────────────────────────

  /**
   * Resolve a DOM event target to the correct control.
   *
   * This is the function that fixes the v10.4.18 bugs:
   * - Nationality no longer resolves to Blood Type (ancestor walk skips
   *   composite containers, finds the correct combobox)
   * - Click on Save icon resolves to Save button (decorative child skipped)
   * - Radio/checkbox wrapper clicks resolve to the inner input (label fallback)
   *
   * Three strategies:
   * 1. Ancestor walk: walk from target up, return first WIDGET control found.
   *    COMPOSITE roles (radiogroup, listbox, etc.) are SKIPPED — they are
   *    containers, not interaction targets.
   * 2. Lazy discovery: if the target itself has a trackable role but wasn't
   *    discovered (added after discover() but before observer callback),
   *    discover it on the fly.
   * 3. Label/wrapper fallback: walk ancestors looking for a <label> or OXD
   *    wrapper that contains a native input, then resolve to that input's
   *    control.
   */
  matchEvent(targetEl: Element): ControlNode | null {
    // Strategy 1: Walk ancestors (composedPath simulation)
    // Skip pure container roles — they hold child widgets the user interacts with.
    // `combobox` is NOT skipped because it's an interaction target (click opens dropdown).
    let node: Element | null = targetEl;
    while (node) {
      const ctrl = this.findByElement(node);
      if (ctrl) {
        if (SKIP_IN_ANCESTOR_WALK.has(ctrl.role)) {
          node = node.parentElement;
          continue;
        }
        return ctrl;
      }
      node = node.parentElement;
    }

    // Strategy 1b: Lazy discovery — element may have been added dynamically
    const targetRole = getRole(targetEl);
    if (targetRole && TRACKABLE_ROLES.has(targetRole)) {
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
      // <label> wrapping a native input
      if (node2.tagName === 'LABEL' && node2.querySelector('input')) {
        const input = node2.querySelector('input[type="radio"], input[type="checkbox"], input');
        if (input) {
          const ctrl = this.findByElement(input);
          if (ctrl) return ctrl;
        }
      }
      // OXD wrapper containing a native input
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

  // ─── Stats ───────────────────────────────────────────────────────────────

  /** Return summary statistics about the discovered controls. */
  stats(): { total: number; widgets: number; composites: number; byRole: Record<string, number> } {
    let widgets = 0;
    let composites = 0;
    const byRole: Record<string, number> = {};
    for (const ctrl of this.controls.values()) {
      byRole[ctrl.role] = (byRole[ctrl.role] || 0) + 1;
      if (WIDGET_ROLES.has(ctrl.role)) widgets++;
      else if (COMPOSITE_ROLES.has(ctrl.role)) composites++;
    }
    return { total: this.controls.size, widgets, composites, byRole };
  }
}
