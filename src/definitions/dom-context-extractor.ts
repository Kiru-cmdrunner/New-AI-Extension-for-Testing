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
 *
 * Phase 0b: Now also returns the surface's structural identity (surfaceId)
 * so the Component Runtime can bind events to sessions via surface containment.
 */
function detectSurface(el: Element): { type: string; role: string | null; label: string | null; surfaceId: string | null } | null {
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < MAX_ANCESTOR_DEPTH) {
    const role = current.getAttribute('role');
    if (role) {
      const roleLower = role.toLowerCase();
      if (SURFACE_ROLE_MAP[roleLower]) {
        return {
          type: SURFACE_ROLE_MAP[roleLower]!,
          role: roleLower,
          label: getSurfaceLabel(current),
          surfaceId: computeSurfaceId(current),
        };
      }
    }
    if (current.getAttribute('aria-modal') === 'true') {
      return { type: 'modal', role: role ?? null, label: getSurfaceLabel(current), surfaceId: computeSurfaceId(current) };
    }
    if (current.tagName === 'DIALOG') {
      return { type: 'modal', role: 'dialog', label: getSurfaceLabel(current), surfaceId: computeSurfaceId(current) };
    }
    const cls = current.getAttribute('class') || '';
    if (cls) {
      for (const { regex, type } of SURFACE_CLASS_PATTERNS) {
        if (regex.test(cls)) {
          return { type, role: role ?? null, label: getSurfaceLabel(current), surfaceId: computeSurfaceId(current) };
        }
      }
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

// ── Surface Identity (Phase 0b) ─────────────────────────────────────────

/**
 * Compute a stable structural identity for a surface container element.
 *
 * The identity is based on the element's position in the DOM tree (tag, role,
 * nth-child index), NOT on CSS class names (which mutate when React re-renders).
 *
 * Priority:
 *   1. data-testid → "testId:<value>"
 *   2. id attribute → "id:<value>"
 *   3. data-cy → "dataCy:<value>"
 *   4. Structural path: tag[role=<role>] at nth-child(<index>) chained to root
 *
 * The structural path (priority 4) is stable across re-renders because it is
 * based on DOM position, not styling. React may re-render the component, but
 * as long as the element maintains the same position in the tree, the identity
 * is preserved.
 *
 * Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §6.2
 */
function computeSurfaceId(el: Element): string | null {
  // Priority 1-3: stable attributes
  const testId = el.getAttribute('data-testid');
  if (testId) return `surf:testId:${testId}`;

  const id = el.id;
  if (id) return `surf:id:${id}`;

  const dataCy = el.getAttribute('data-cy');
  if (dataCy) return `surf:dataCy:${dataCy}`;

  // Priority 4: structural path (tag + role + nth-child position)
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const MAX_SURFACE_ID_DEPTH = 5;

  while (current && current !== document.body && current !== document.documentElement && depth < MAX_SURFACE_ID_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    const parent: Element | null = current.parentElement;
    let nth = 1;
    if (parent) {
      let sibling: Element | null = parent.firstElementChild;
      while (sibling && sibling !== current) {
        nth++;
        sibling = sibling.nextElementSibling;
      }
    }
    const rolePart = role ? `[role=${role}]` : '';
    parts.unshift(`${tag}${rolePart}:nth(${nth})`);
    current = parent;
    depth++;
  }

  if (parts.length === 0) return null;
  return `surf:struct:${parts.join('>')}`;
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
    // Phase 0b: surface identity for session-surface binding
    surfaceId: surface?.surfaceId ?? null,
    surfaceOpenedBy: null, // populated by the runtime when it matches the trigger event
    ariaAutoComplete: getAttributeString(el, 'aria-autocomplete'),
    ariaValueNow: getAttributeString(el, 'aria-valuenow'),
    ariaValueText: getAttributeString(el, 'aria-valuetext'),
    ariaValueMin: getAttributeString(el, 'aria-valuemin'),
    ariaValueMax: getAttributeString(el, 'aria-valuemax'),
    nativeMin: el instanceof HTMLInputElement ? (el.min || null) : null,
    nativeMax: el instanceof HTMLInputElement ? (el.max || null) : null,
    // Phase 2: Navigation signals
    opensNewTab: detectOpensNewTab(el),
    opensNewWindow: detectOpensNewWindow(el),
    openedUrl: getOpenedUrl(el),
    // Phase 2: Validation & form context
    minLength: getNumericAttribute(el, 'minlength'),
    maxLength: getNumericAttribute(el, 'maxlength'),
    pattern: getAttributeString(el, 'pattern'),
    min: el instanceof HTMLInputElement ? (el.min || null) : null,
    max: el instanceof HTMLInputElement ? (el.max || null) : null,
    step: el instanceof HTMLInputElement ? (el.step || null) : null,
    acceptedFileTypes: getAttributeString(el, 'accept'),
    formId: getFormId(el),
    formName: getFormName(el),
    // R2: Slider geometry for custom slider value extraction
    ...extractSliderGeometry(el),
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

/**
 * CSS class patterns for slider tracks. When an ancestor matches,
 * its geometry is captured for value extraction.
 */
const TRACK_GEOMETRY_RE = /\b(?:ui-slider|noUi-slider|irs|slider-track|range-track|slider-rail)\b/;

/**
 * Extract slider geometry fields for R2 custom slider value extraction.
 *
 * If the target element has a track-class ancestor, captures:
 * - targetOffsetLeft/Top: the target's own offsetLeft/offsetTop
 * - trackOffsetLeft/Width: the nearest track ancestor's offsetLeft/offsetWidth
 *
 * Returns nulls if no track ancestor is found (the fields are optional).
 */
function extractSliderGeometry(el: Element): {
  targetOffsetLeft: number | null;
  targetOffsetTop: number | null;
  trackOffsetLeft: number | null;
  trackOffsetWidth: number | null;
} {
  // Walk ancestors to find a track element
  let current: Element | null = el.parentElement;
  let depth = 0;
  let trackEl: HTMLElement | null = null;

  while (current && depth < MAX_ANCESTOR_DEPTH) {
    if (current instanceof HTMLElement) {
      const cls = current.className || '';
      if (TRACK_GEOMETRY_RE.test(cls)) {
        trackEl = current;
        break;
      }
    }
    current = current.parentElement;
    depth++;
  }

  // Always capture target geometry
  const targetEl = el instanceof HTMLElement ? el : null;
  const targetOffsetLeft = targetEl?.offsetLeft ?? null;
  const targetOffsetTop = targetEl?.offsetTop ?? null;

  if (trackEl) {
    return {
      targetOffsetLeft,
      targetOffsetTop,
      trackOffsetLeft: trackEl.offsetLeft,
      trackOffsetWidth: trackEl.offsetWidth,
    };
  }

  return {
    targetOffsetLeft,
    targetOffsetTop,
    trackOffsetLeft: null,
    trackOffsetWidth: null,
  };
}

// ── Navigation Signal Detection (Phase 2) ──────────────────────────────

/**
 * Detect if clicking this element opens a new browser tab.
 *
 * Checks for:
 * - `<a target="_blank">` or `<a target="_new">`
 * - `<a rel="opener">` (modern target=_blank signal)
 */
function detectOpensNewTab(el: Element): boolean | null {
  if (el instanceof HTMLAnchorElement) {
    const target = el.target.toLowerCase();
    if (target === '_blank' || target === '_new') {
      return true;
    }
  }
  return null;
}

/**
 * Detect if clicking this element opens a new browser window.
 *
 * window.open() calls with width/height features are difficult to detect
 * statically. We check for:
 * - data attributes commonly used by SPAs to signal window.open
 * - onclick handlers that reference window.open (best-effort heuristic)
 *
 * Returns null when no signal is found (not false — we can't be certain).
 */
function detectOpensNewWindow(el: Element): boolean | null {
  // Check for data-open-window attribute (custom, used by some frameworks)
  if (el.getAttribute('data-open-window') === 'true') {
    return true;
  }
  return null;
}

/**
 * Get the URL that will be opened when this element is clicked.
 *
 * For <a> tags: returns the href.
 * For elements with data-href: returns that value.
 */
function getOpenedUrl(el: Element): string | null {
  if (el instanceof HTMLAnchorElement) {
    const href = el.href;
    if (href) return href;
  }
  const dataHref = el.getAttribute('data-href');
  if (dataHref) return dataHref;
  return null;
}

// ── Validation & Form Context Helpers (Phase 2) ────────────────────────

/**
 * Get a numeric attribute value.
 */
function getNumericAttribute(el: Element, attr: string): number | null {
  const value = el.getAttribute(attr);
  if (value === null) return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

/**
 * Get the ID of the nearest containing <form> element.
 */
function getFormId(el: Element): string | null {
  if (el instanceof HTMLElement) {
    // Check form attribute first (for elements associated via form attribute)
    const formAttr = el.getAttribute('form');
    if (formAttr) return formAttr;
    // Walk up to find containing form
    const form = el.closest('form');
    if (form) return form.id || null;
  }
  return null;
}

/**
 * Get the name of the nearest containing <form> element.
 */
function getFormName(el: Element): string | null {
  if (el instanceof HTMLElement) {
    const form = el.closest('form');
    if (form instanceof HTMLFormElement) {
      return form.name || form.getAttribute('name') || null;
    }
  }
  return null;
}
