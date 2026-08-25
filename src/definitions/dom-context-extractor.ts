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

/**
 * Extract DOM context from a live element.
 *
 * This function touches the live DOM — it must be called synchronously
 * during event capture, before the DOM can mutate.
 */
export function extractDomContext(el: Element): DomContext {
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
    tabIndex: el instanceof HTMLElement ? el.tabIndex : null,
    // 7.4-M1: interaction affordance facts — the same computed checks
    // resolveTarget Strategy 2 already performs (identity-extractor.ts), now
    // PERSISTED for classification instead of discarded. Boolean by
    // construction ('' and undefined both fail === 'pointer'). Classification
    // input only — never identity/locators.
    pointerCursor: window.getComputedStyle(el).cursor === 'pointer',
    clickHandler: el.hasAttribute('onclick'),
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
