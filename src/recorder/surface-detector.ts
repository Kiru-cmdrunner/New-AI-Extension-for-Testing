/**
 * Surface Detector
 *
 * Classifies dynamically appearing DOM elements as one of:
 *   - modal    (role=dialog, aria-modal=true, MUI Dialog, AntD Modal)
 *   - drawer   (slide-in panel, MUI Drawer, AntD Drawer)
 *   - popover  (role=menu, floating menu, dropdown, calendar, autocomplete)
 *   - tooltip  (role=tooltip, MUI Tooltip, AntD Tooltip)
 *
 * Ported and cleaned from Pipeline V2's identifySurface() — separated into a
 * pure utility function so it can be tested in isolation without the full
 * observer pipeline.
 */

import type { SurfaceType } from '../recorded-event.ts';

export interface SurfaceInfo {
  type: SurfaceType;
  role: string | null;
  label: string | null;
}

// ── Class name patterns for framework detection ─────────────────────────────

/**
 * All patterns use simple substring matching (no word boundaries).
 * Framework class names are compound (e.g., 'p-overlaypanel', 'calendar-wrapper')
 * so anchoring at spaces or string boundaries misses valid cases.
 */

/** MUI, AntD, Bootstrap, PrimeReact modal patterns */
const MODAL_PATTERNS = [
  'modal', 'mui-dialog', 'ant-modal', 'p-dialog', 'dialog',
];

/** Drawer / slide-in panel patterns */
const DRAWER_PATTERNS = [
  'drawer', 'sidebar', 'slideout', 'slidein', 'slide-out', 'slide-in',
  'mui-drawer', 'ant-drawer', 'panel-left', 'panel-right',
];

/** Popover / floating menu patterns */
const POPOVER_PATTERNS = [
  'popover', 'dropdown', 'overlay', 'flyout',
  'muipopover', 'muimenu', 'antpopover', 'antdropdown', 'antmenu',
  'p-overlaypanel',
  'menu', // generic — checked last in the array
];

/** Tooltip patterns */
const TOOLTIP_PATTERNS = [
  'tooltip', 'mui-tooltip', 'ant-tooltip', 'tippy-box', 'p-tooltip', 'hint',
];

/** Calendar / date picker patterns (classified as popover) */
const CALENDAR_PATTERNS = [
  'calendar', 'datepicker', 'date-picker',
  'muicalendarpicker', 'muidatepicker', 'ant-picker',
];

/** Autocomplete / suggestion patterns (classified as popover) */
const AUTOCOMPLETE_PATTERNS = [
  'autocomplete', 'suggestion', 'typeahead',
  'muiautocomplete', 'ant-select-dropdown',
];

/** Classes that should be excluded from popover matching */
const POPOVER_EXCLUDE_PATTERNS = ['breadcrumb'];

// ── ARIA role → surface type mapping ────────────────────────────────────────

const ROLE_SURFACE_MAP: Record<string, SurfaceType> = {
  'dialog': 'modal',
  'alertdialog': 'modal',
  'menu': 'popover',
  'listbox': 'popover',
  'tree': 'popover',
  'tooltip': 'tooltip',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a readable label from an element (accessible name, aria-label, text content).
 */
function getSurfaceLabel(el: Element): string | null {
  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl?.textContent) return labelEl.textContent.trim().slice(0, 100);
  }

  // heading inside the element (common in modals/dialogs)
  const heading = el.querySelector('h1, h2, h3, h4, [role="heading"]');
  if (heading?.textContent) return heading.textContent.trim().slice(0, 100);

  // title attribute
  const title = el.getAttribute('title');
  if (title) return title;

  // First few words of text content (truncated)
  const text = el.textContent?.trim();
  if (text && text.length > 0) return text.slice(0, 100);

  return null;
}

/**
 * Check if an element is a positioned overlay with high z-index.
 * Used as a fallback heuristic when no ARIA role or class matches.
 */
function isPositionedOverlay(el: Element): boolean {
  try {
    const style = window.getComputedStyle(el);
    const isOverlay = style.position === 'fixed' || style.position === 'absolute';
    const zIndex = parseInt(style.zIndex || '0', 10);
    return isOverlay && zIndex >= 100 && el.children.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if an element has a transform indicating a slide-in drawer.
 * (e.g., transform: translateX(-100%) or translate3d on a fixed element)
 */
function hasSlideTransform(el: Element): boolean {
  try {
    const style = window.getComputedStyle(el);
    if (style.position !== 'fixed') return false;
    const transform = style.transform;
    if (!transform || transform === 'none') return false;
    // Check for translateX/translate3d (drawer animation)
    return /translate[3d]*\s*\(/i.test(transform);
  } catch {
    return false;
  }
}

// ── Main classification function ────────────────────────────────────────────

/**
 * Classify a dynamically appearing DOM element as a surface type.
 *
 * Detection order (most reliable first):
 * 1. ARIA roles (dialog, alertdialog, menu, tooltip, etc.)
 * 2. aria-modal attribute
 * 3. Native <dialog> element
 * 4. Framework class names (MUI, AntD, Bootstrap)
 * 5. Generic class name patterns (modal, drawer, popover, tooltip)
 * 6. CSS transform for drawer animation
 * 7. Positioned overlay fallback (z-index ≥ 100, has clickable children)
 *
 * @returns SurfaceInfo with type, role, and label — or null if not a recognized surface.
 */
export function identifySurface(el: Element): SurfaceInfo | null {
  const role = el.getAttribute('role');
  const roleLower = role?.toLowerCase() ?? '';

  // ── 1. ARIA roles (most reliable) ──
  if (roleLower && ROLE_SURFACE_MAP[roleLower]) {
    return {
      type: ROLE_SURFACE_MAP[roleLower],
      role: roleLower,
      label: getSurfaceLabel(el),
    };
  }

  // ── 2. aria-modal ──
  if (el.getAttribute('aria-modal') === 'true') {
    return {
      type: 'modal',
      role: roleLower || null,
      label: getSurfaceLabel(el),
    };
  }

  // ── 3. Native <dialog> element ──
  if (el.tagName === 'DIALOG') {
    return {
      type: 'modal',
      role: null,
      label: getSurfaceLabel(el),
    };
  }

  // ── 4 & 5. Class name patterns ──
  const cls = (el as HTMLElement).className;
  if (typeof cls === 'string' && cls.length > 0) {
    const lower = cls.toLowerCase();

    // Helper: check if any pattern matches as substring
    const matchesAny = (patterns: string[]): boolean =>
      patterns.some(p => lower.includes(p));

    // Calendar / autocomplete patterns checked first (more specific)
    if (matchesAny(CALENDAR_PATTERNS) || matchesAny(AUTOCOMPLETE_PATTERNS)) {
      return { type: 'popover', role: roleLower || null, label: getSurfaceLabel(el) };
    }
    if (matchesAny(MODAL_PATTERNS)) {
      return { type: 'modal', role: roleLower || null, label: getSurfaceLabel(el) };
    }
    if (matchesAny(DRAWER_PATTERNS)) {
      return { type: 'drawer', role: roleLower || null, label: getSurfaceLabel(el) };
    }
    if (matchesAny(TOOLTIP_PATTERNS)) {
      return { type: 'tooltip', role: roleLower || null, label: getSurfaceLabel(el) };
    }
    if (matchesAny(POPOVER_PATTERNS) && !POPOVER_EXCLUDE_PATTERNS.some(p => lower.includes(p))) {
      return { type: 'popover', role: roleLower || null, label: getSurfaceLabel(el) };
    }
  }

  // ── 6. Drawer via CSS transform ──
  if (hasSlideTransform(el)) {
    return { type: 'drawer', role: roleLower || null, label: getSurfaceLabel(el) };
  }

  // ── 7. Positioned overlay fallback ──
  if (isPositionedOverlay(el)) {
    // Only classify as popover if it has clickable children
    const hasClickable = el.querySelector(
      'button, a, [role="option"], [role="menuitem"], [data-value], li, input, select',
    );
    if (hasClickable) {
      return { type: 'popover', role: roleLower || null, label: getSurfaceLabel(el) };
    }
  }

  return null;
}

/**
 * Map aria-haspopup value to a surface type.
 * Used when the triggering element has aria-haspopup but the surface itself
 * hasn't been identified yet.
 */
export function mapHasPopupToSurface(hasPopup: string): SurfaceType {
  switch (hasPopup.toLowerCase()) {
    case 'dialog':
      return 'modal';
    case 'menu':
      return 'popover';
    case 'listbox':
    case 'grid':
    case 'tree':
      return 'popover';
    default:
      return 'popover';
  }
}
