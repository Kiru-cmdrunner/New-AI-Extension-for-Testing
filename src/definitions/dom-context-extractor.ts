/**
 * DOM Context Extractor
 *
 * Extracts structural DOM context from a live element at event time.
 * This runs in the content script (where the DOM is accessible) and the
 * resulting DomContext is part of every ObservedEvent sent to the SW.
 *
 * The fields here are what the Component Definitions need to make
 * classification decisions — they CANNOT access the DOM later (it mutates).
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 1
 */

import type { DomContext } from '../shared/component-types';

/** Maximum ancestor chain depth to capture. */
const MAX_ANCESTOR_DEPTH = 10;

// ── Surface Detection ──────────────────────────────────────────────────

const SURFACE_ROLE_MAP: Record<string, string> = {
  dialog: 'modal',
  alertdialog: 'modal',
  menu: 'popover',
  listbox: 'popover',
  tree: 'popover',
  grid: 'popover',
  tooltip: 'tooltip',
};

const SURFACE_CLASS_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  // MUI
  { regex: /MuiDialog-root/i, type: 'modal' },
  { regex: /MuiDrawer-root/i, type: 'drawer' },
  { regex: /MuiPopover-root|MuiMenu-root|MuiAutocomplete-popper|MuiCalendarPicker-root/i, type: 'popover' },
  { regex: /MuiTooltip-popper/i, type: 'tooltip' },
  // Ant Design
  { regex: /ant-modal/i, type: 'modal' },
  { regex: /ant-drawer/i, type: 'drawer' },
  { regex: /ant-popover|ant-dropdown|ant-picker-dropdown|ant-select-dropdown/i, type: 'popover' },
  { regex: /ant-tooltip/i, type: 'tooltip' },
  // Bootstrap
  { regex: /modal\s+show|modal-open/i, type: 'modal' },
  { regex: /offcanvas/i, type: 'drawer' },
  { regex: /dropdown-menu/i, type: 'popover' },
  { regex: /tooltip-inner/i, type: 'tooltip' },
  // Generic patterns
  { regex: /\bmodal\b/i, type: 'modal' },
  { regex: /\bdrawer\b/i, type: 'drawer' },
  { regex: /\bpopover|popup|dropdown\b/i, type: 'popover' },
];

function getSurfaceLabel(el: Element): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim().substring(0, 100);
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="header"]');
  if (heading) {
    const text = heading.textContent?.trim();
    if (text) return text.substring(0, 100);
  }
  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim().substring(0, 100);
  return null;
}

/**
 * Detect if the element or any of its ancestors is a dynamic UI surface
 * (modal, drawer, popover, tooltip) that appeared after a user interaction.
 */
function detectSurface(el: Element): { type: string; role: string | null; label: string | null } | null {
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < MAX_ANCESTOR_DEPTH) {
    const role = current.getAttribute('role');
    if (role) {
      const roleLower = role.toLowerCase();
      if (SURFACE_ROLE_MAP[roleLower]) {
        return { type: SURFACE_ROLE_MAP[roleLower]!, role: roleLower, label: getSurfaceLabel(current) };
      }
    }
    if (current.getAttribute('aria-modal') === 'true') {
      return { type: 'modal', role: role ?? null, label: getSurfaceLabel(current) };
    }
    if (current.tagName === 'DIALOG') {
      return { type: 'modal', role: 'dialog', label: getSurfaceLabel(current) };
    }
    const cls = current.getAttribute('class') || '';
    if (cls) {
      for (const { regex, type } of SURFACE_CLASS_PATTERNS) {
        if (regex.test(cls)) {
          return { type, role: role ?? null, label: getSurfaceLabel(current) };
        }
      }
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

/**
 * Extract DOM context from a live element.
 *
 * This function touches the live DOM — it must be called synchronously
 * during event capture, before the DOM can mutate.
 */
export function extractDomContext(el: Element): DomContext {
  const surface = detectSurface(el);

  return {
    inputType: getInputType(el),
    ariaExpanded: getAttributeBoolean(el, 'aria-expanded'),
    ariaHasPopup: getAttributeString(el, 'aria-haspopup'),
    isContentEditable: isContentEditable(el),
    disabled: isDisabled(el),
    readOnly: isReadOnly(el),
    required: hasAttribute(el, 'required') || getAttributeBoolean(el, 'aria-required') === true,
    ancestorRoles: getAncestorRoles(el),
    ancestorClasses: getAncestorClasses(el),
    // Surface detection — populated when the element is inside a modal,
    // drawer, popover, or tooltip. Used by the surface-anchored detection
    // pipeline (interaction-detector.ts → extractSurfaceContext).
    surfaceType: surface?.type ?? null,
    surfaceRole: surface?.role ?? null,
    surfaceLabel: surface?.label ?? null,
    ariaAutoComplete: getAttributeString(el, 'aria-autocomplete'),
    ariaValueNow: getAttributeString(el, 'aria-valuenow'),
    ariaValueText: getAttributeString(el, 'aria-valuetext'),
    ariaValueMin: getAttributeString(el, 'aria-valuemin'),
    ariaValueMax: getAttributeString(el, 'aria-valuemax'),
    nativeMin: el instanceof HTMLInputElement ? (el.min || null) : null,
    nativeMax: el instanceof HTMLInputElement ? (el.max || null) : null,
  };
}

// ── Extractors ─────────────────────────────────────────────────────────

function getInputType(el: Element): string | null {
  if (el instanceof HTMLInputElement) {
    return el.type || 'text';
  }
  return null;
}

function getAttributeString(el: Element, attr: string): string | null {
  const val = el.getAttribute(attr);
  return val ?? null;
}

function getAttributeBoolean(el: Element, attr: string): boolean | null {
  const val = el.getAttribute(attr);
  if (val === null) return null;
  return val === 'true';
}

function hasAttribute(el: Element, attr: string): boolean {
  return el.hasAttribute(attr);
}

function isContentEditable(el: Element): boolean {
  return el instanceof HTMLElement && el.isContentEditable;
}

function isDisabled(el: Element): boolean {
  // Native disabled attribute
  if (el instanceof HTMLElement && el.hasAttribute('disabled')) return true;
  // ARIA disabled
  if (el.getAttribute('aria-disabled') === 'true') return true;
  // Fieldset disabled (children are disabled)
  const fieldset = el.closest('fieldset[disabled]');
  if (fieldset) return true;
  return false;
}

function isReadOnly(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.readOnly;
  }
  if (el.getAttribute('aria-readonly') === 'true') return true;
  return false;
}

/**
 * Walk ancestors and collect their tag names and ARIA roles.
 * Format: "tag" or "tag[role=role]".
 * Index 0 is the target's direct parent.
 *
 * Used by definitions for structural pattern matching (e.g., detecting
 * that an element is inside a combobox or listbox).
 */
function getAncestorRoles(el: Element): string[] {
  const roles: string[] = [];
  let current: Element | null = el.parentElement;
  let depth = 0;

  while (current && depth < MAX_ANCESTOR_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const explicitRole = current.getAttribute('role');
    if (explicitRole) {
      roles.push(`${tag}[role=${explicitRole}]`);
    } else {
      roles.push(tag);
    }
    current = current.parentElement;
    depth++;
  }

  return roles;
}

/**
 * Walk ancestors and collect their CSS class names.
 * Index 0 is the target's direct parent.
 *
 * Used by definitions for framework-specific class pattern matching
 * (e.g., OXD wrappers, MUI containers).
 */
function getAncestorClasses(el: Element): string[] {
  const classes: string[] = [];
  let current: Element | null = el.parentElement;
  let depth = 0;

  while (current && depth < MAX_ANCESTOR_DEPTH) {
    if (current instanceof HTMLElement) {
      classes.push(current.className || '');
    } else {
      classes.push('');
    }
    current = current.parentElement;
    depth++;
  }

  return classes;
}
