/**
 * Stage 1 — Production Control Model Types
 *
 * Core types for the control-centric interaction model.
 * These coexist with the existing recorder types (no modifications to
 * existing files). Downstream stages will connect these to the extension
 * runtime via adapters.
 */

// ─── Role Constant Sets ────────────────────────────────────────────────────

/** Roles that represent atomic interaction targets (user can click/type/toggle). */
export const WIDGET_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
  'combobox', 'listbox', 'option', 'menuitem', 'switch', 'slider',
  'spinbutton', 'tab', 'treeitem', 'gridcell',
]);

/** Roles that represent container/group elements (never interaction targets). */
export const COMPOSITE_ROLES = new Set([
  'combobox', 'listbox', 'menu', 'menubar', 'radiogroup',
  'tablist', 'tree', 'grid', 'treegrid', 'dialog', 'alertdialog',
]);

/** All roles the Control Model tracks (widget + composite). */
export const TRACKABLE_ROLES = new Set([...WIDGET_ROLES, ...COMPOSITE_ROLES]);

// ─── Control State ──────────────────────────────────────────────────────────

/** Observable state of a control, captured at discovery and on mutation. */
export interface ControlState {
  /** ARIA aria-expanded attribute (dropdowns, dialogs, etc.). */
  expanded: boolean | null;
  /** ARIA aria-checked or native .checked property (checkboxes, radios). */
  checked: boolean | null;
  /** ARIA aria-selected attribute (tabs, options). */
  selected: boolean | null;
  /** Input element value (text fields, selects). */
  value: string | null;
}

// ─── Control Node ───────────────────────────────────────────────────────────

/**
 * A logical interaction unit in the page — an element the user can interact
 * with, resolved via W3C ARIA semantics + framework adapters.
 *
 * Each node holds a WeakRef to its DOM element so the model never prevents
 * garbage collection.
 */
export interface ControlNode {
  /** Stable unique identifier within this model instance. */
  controlId: string;

  /** W3C ARIA role (explicit, inferred from tag, or from framework adapter). */
  role: string;

  /** Accessible name computed via W3C algorithm + framework fallbacks. */
  name: string;

  /** Lowercase tag name (e.g. 'input', 'div', 'button'). */
  tag: string;

  /** CSS class list of the bound element (for framework detection, state checks). */
  classes: string[];

  /** controlId of the parent composite, or null for top-level controls. */
  parentId: string | null;

  /** Current observable state. */
  state: ControlState;

  /** Weak reference to the DOM element — never prevents GC. */
  elementRef: WeakRef<Element>;
}
