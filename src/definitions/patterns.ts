/**
 * Pattern Matching Utilities — Shared Classification Helpers
 *
 * These functions are used by Component Definitions to identify element types,
 * check interactivity, and extract best-fit names. They encode the accumulated
 * knowledge of which CSS classes, ARIA roles, and tag patterns indicate
 * specific interaction surfaces (dropdowns, date pickers, checkboxes, etc.).
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 *
 * Design principle: every function here is a PURE function on identity
 * strings (tag, role, className, accessibleName) — never on live DOM elements.
 * This keeps definitions testable without a browser.
 */

import { PatternRegistry } from './pattern-registry';
import type { ElementIdentity } from '../shared/types';

// ── Best Name ──────────────────────────────────────────────────────────

/**
 * Pick the best available human-readable name for an element.
 *
 * Priority: accessibleName > ariaLabel > placeholder > 'element'.
 *
 * IMPORTANT: callers that have a valueBefore should use `||` to combine:
 *   bestName(accessibleName || valueBefore, ariaLabel, placeholder)
 * The `??` operator does NOT fall through on empty string, which was the
 * root cause of Bug 2 (dropdown "from element" display).
 *
 * Architecture: §4.2 (Dropdown no-op fix)
 */
export function bestName(
  accessibleName: string,
  ariaLabel?: string | null,
  placeholder?: string | null,
): string {
  if (accessibleName && accessibleName.trim()) return accessibleName.trim();
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  if (placeholder && placeholder.trim()) return placeholder.trim();
  return 'element';
}

// ── Interactive Element Check ──────────────────────────────────────────

/** Tags that are inherently interactive. */
const INTERACTIVE_TAGS = new Set([
  'BUTTON', 'A', 'SELECT', 'INPUT', 'TEXTAREA', 'SUMMARY', 'OPTION',
]);

/**
 * ARIA roles that indicate interactivity.
 *
 * Table/grid roles (columnheader, rowheader, row) are included because data
 * tables and grids are common click targets — sort headers, selectable rows,
 * and AG Grid cells all rely on these roles. Without them, the Click gate
 * produces 0 interactions for entire categories of UI patterns.
 * (Expanded validation finding GROUP-A, WF-04/FW-AGG-02.)
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'combobox', 'listbox', 'option', 'checkbox', 'radio',
  'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'textbox', 'spinbutton', 'slider', 'treeitem', 'gridcell',
  // Table / grid roles — sortable headers, selectable rows
  'columnheader', 'rowheader', 'row',
]);

/**
 * Is this element interactive (worth capturing as a Click)?
 *
 * Checks tag, ARIA role, tabIndex, and class patterns. Returns false for
 * bare divs, spans, and container elements that a QA engineer would never
 * write as a test step.
 *
 * Architecture: §2.3 (Click definition — universal fallback, rejects non-interactive)
 */
export function isInteractiveElement(
  tag: string,
  ariaRole: string | null,
  className: string | null,
  tabIndex: number | null,
): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (ariaRole && INTERACTIVE_ROLES.has(ariaRole)) return true;
  if (tabIndex !== null && tabIndex >= 0) return true;
  // Use the pattern registry instead of a hardcoded regex.
  if (className && PatternRegistry.isInteractiveClass(className)) return true;
  return false;
}

// ── Dropdown Patterns ──────────────────────────────────────────────────

/**
 * ARIA roles for dropdown triggers (the element the user clicks to open).
 */
const DROPDOWN_TRIGGER_ROLES = new Set([
  'combobox', 'listbox',
]);

/**
 * ARIA roles for dropdown options (the element the user clicks to select).
 *
 * Menu roles (menuitem, menuitemcheckbox, menuitemradio) are included
 * because frameworks like Radix UI and Headless UI render dropdown menus
 * using the ARIA menu pattern rather than the listbox pattern. Without
 * these roles, menu item clicks inside an open dropdown are classified
 * as separate Click interactions instead of selectOption subActions.
 * (Expanded validation finding GROUP-B, FW-RDX-01.)
 */
const DROPDOWN_OPTION_ROLES = new Set([
  'option',
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
]);


/**
 * Is this element a dropdown trigger?
 */
export function isDropdownTrigger(
  tag: string,
  ariaRole: string | null,
  className: string | null,
): boolean {
  if (tag === 'SELECT') return true;
  if (ariaRole && DROPDOWN_TRIGGER_ROLES.has(ariaRole)) return true;
  // Use the pattern registry instead of a hardcoded regex.
  if (className && PatternRegistry.isDropdownTriggerClass(className)) return true;
  return false;
}

/**
 * Is this element a dropdown option?
 */
export function isDropdownOption(
  ariaRole: string | null,
  className: string | null,
): boolean {
  if (ariaRole && DROPDOWN_OPTION_ROLES.has(ariaRole)) return true;
  // Use the pattern registry instead of a hardcoded regex.
  if (className && PatternRegistry.isDropdownOptionClass(className)) return true;
  return false;
}

/**
 * Is this element a dropdown option, with a fallback for frameworks that
 * don't use standard ARIA roles or CSS classes?
 *
 * In React SPAs (AdaniOne, etc.), dropdown options are often plain
 * div/span/li elements inside a dropdown surface without explicit roles.
 * We detect them by checking if:
 *   1. The standard check passes (role=option or known CSS class)
 *   2. OR the element has a non-empty accessible name and contains text
 *      content (it's a clickable choice).
 *
 * This is called by the dropdown definition ONLY when inside a dropdown
 * surface — it's not used for general element classification.
 */
export function isDropdownOptionWithFallback(
  ariaRole: string | null,
  className: string | null,
  accessibleName: string | null,
): boolean {
  // First try the standard check
  if (isDropdownOption(ariaRole, className)) return true;

  // Fallback: element has a meaningful accessible name (the option's label)
  if (accessibleName && accessibleName.trim()) {
    return true;
  }

  return false;
}

/**
 * Is this element inside a dropdown surface (the open listbox)?
 */
export function isInsideDropdownSurface(className: string | null): boolean {
  if (!className) return false;
  return PatternRegistry.isDropdownSurfaceClass(className);
}

/**
 * Normalize a display string for no-op comparison.
 * Strips leading/trailing dashes, colons, whitespace — OXD wraps values
 * in "-- value --" formatting.
 *
 * Architecture: §4.2 (Dropdown no-op fix)
 */
export function normalizeDisplayValue(s: string): string {
  return s.replace(/^[-–—:*\s]+|[-–—:*\s]+$/g, '').trim();
}

// ── Date Picker Patterns ───────────────────────────────────────────────

/**
 * Input types that indicate a date/time picker.
 */
const DATE_INPUT_TYPES = new Set([
  'date', 'time', 'datetime-local', 'month', 'week',
]);





/**
 * Is this element a date picker trigger?
 */
export function isDatePickerTrigger(
  tag: string,
  inputType: string | null,
  className: string | null,
  ariaHasPopup: string | null,
  name: string | null,
): boolean {
  // Native date/time inputs
  if (tag === 'INPUT' && inputType && DATE_INPUT_TYPES.has(inputType)) return true;
  // CSS class patterns
  if (className && PatternRegistry.isDatePickerTriggerClass(className)) return true;
  // ARIA hasPopup on a text input near a calendar
  if (ariaHasPopup === 'dialog' && tag === 'INPUT') return true;
  // Name attribute hints (date, birth, dob, etc.)
  if (name && /(?:date|birth|dob|expire|expiry|calendar)/i.test(name)) return true;
  return false;
}

/**
 * Is this element a calendar cell (an actual selectable date)?
 * Checks both ARIA role and CSS class.
 */
export function isCalendarCell(
  ariaRole: string | null,
  className: string | null,
): boolean {
  if (ariaRole === 'gridcell' || ariaRole === 'option') {
    // Must also have a date-like class to avoid matching listbox options
    if (className && PatternRegistry.isDatePickerCellClass(className)) return true;
  }
  // Some calendars use buttons/cells without explicit roles
  if (className && PatternRegistry.isDatePickerCellClass(className)) return true;
  return false;
}

/**
 * Is this element a calendar cell, with fallback for frameworks that
 * don't use standard ARIA roles or CSS classes?
 *
 * In React SPAs (AdaniOne, etc.), calendar date cells are often plain
 * div/span/button elements inside a calendar surface without explicit
 * roles. We detect them by checking if:
 *   1. The element has a date-like accessible name (1-2 digits, or
 *      day-month-year patterns)
 *   2. The element is inside a calendar surface (checked by the caller
 *      via ancestor classes)
 *
 * This is called by the date-picker definition ONLY when inside a
 * calendar surface — it's not used for general element classification.
 */
export function isCalendarCellWithFallback(
  ariaRole: string | null,
  className: string | null,
  accessibleName: string | null,
): boolean {
  // First try the standard check
  if (isCalendarCell(ariaRole, className)) return true;

  // Fallback: check for date-like accessible name
  // A calendar cell's text is typically a day number (1-31) or a formatted date
  if (accessibleName) {
    const name = accessibleName.trim();

    // Pure 1-2 digit number (day of month)
    if (/^\d{1,2}$/.test(name)) {
      const dayNum = parseInt(name, 10);
      if (dayNum >= 1 && dayNum <= 31) return true;
    }

    // Date patterns like "15 July", "Jul 15", "15/07", "2026-07-15"
    if (/^\d{1,2}\s+\w+/i.test(name)) return true; // "15 July"
    if (/^\w+\s+\d{1,2}/i.test(name)) return true; // "July 15"
    if (/^\d{1,2}[\/\-]\d{1,2}/.test(name)) return true; // "15/07"
    if (/^\d{4}-\d{2}-\d{2}$/.test(name)) return true; // ISO format

    // "Thu, 30 Jul" or similar formatted dates
    if (/^\w{2,3},\s*\d{1,2}\s+\w{3}/i.test(name)) return true;
  }

  return false;
}

/**
 * Does this text look like a date? A broader check used as a last-resort
 * fallback for React SPAs (AdaniOne, etc.) where calendar cells have
 * unique class names and no ARIA roles.
 *
 * Matches:
 *   - Day numbers: "15", "30"
 *   - Formatted dates: "Thu, 30 Jul", "30 July", "Jul 30"
 *   - ISO dates: "2026-07-30"
 *   - Slashed dates: "30/07", "07/30/2026"
 */
export function looksLikeDateText(text: string): boolean {
  const name = text.trim();
  if (!name) return false;

  // Pure 1-2 digit number (day of month)
  if (/^\d{1,2}$/.test(name)) {
    const dayNum = parseInt(name, 10);
    if (dayNum >= 1 && dayNum <= 31) return true;
  }

  // "Thu, 30 Jul" or "30 Jul" or "Jul 30"
  if (/^\w{2,3},?\s*\d{1,2}\s+\w{3}/i.test(name)) return true;
  if (/^\w{3}\s+\d{1,2}/i.test(name)) return true;

  // "15 July" or "July 15"
  if (/^\d{1,2}\s+\w+/i.test(name)) return true;
  if (/^\w+\s+\d{1,2}/i.test(name)) return true;

  // ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) return true;

  // Slashed dates
  if (/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(name)) return true;

  return false;
}

/**
 * Is this element inside a calendar surface?
 */
export function isInsideCalendarSurface(className: string | null): boolean {
  if (!className) return false;
  return PatternRegistry.isCalendarSurfaceClass(className);
}

/**
 * Is this element a calendar navigation button (Next/Prev Month, etc.)?
 * These are lifecycle-internal — they must NOT complete the date picker.
 *
 * Architecture: §4.7
 */
export function isCalendarNavigationButton(
  ariaRole: string | null,
  accessibleName: string | null,
  className: string | null,
): boolean {
  // Role check: navigation buttons are typically buttons
  if (ariaRole !== 'button' && ariaRole !== null) return false;
  // Class check — use the registry
  const navPatterns = PatternRegistry.getMerged().calendarNavButtonClasses ?? [];
  if (className && navPatterns.length > 0) {
    const regex = new RegExp(`(?:${navPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
    if (regex.test(className)) return true;
  }
  // Name check: common navigation button names
  if (accessibleName) {
    const name = accessibleName.toLowerCase();
    if (/^(next|previous|prev|today|switch|change month|change year)/i.test(name)) return true;
  }
  return false;
}

// ── Checkbox / Radio Patterns ──────────────────────────────────────────

/**
 * Is this element a checkbox?
 */
export function isCheckbox(
  tag: string,
  inputType: string | null,
  ariaRole: string | null,
): boolean {
  if (tag === 'INPUT' && inputType === 'checkbox') return true;
  if (ariaRole === 'checkbox' || ariaRole === 'switch') return true;
  return false;
}

/**
 * Is this element a radio button?
 */
export function isRadio(
  tag: string,
  inputType: string | null,
  ariaRole: string | null,
): boolean {
  if (tag === 'INPUT' && inputType === 'radio') return true;
  if (ariaRole === 'radio') return true;
  return false;
}

// ── Link Patterns ──────────────────────────────────────────────────────

/**
 * Is this element a link?
 */
export function isLink(tag: string, ariaRole: string | null): boolean {
  if (tag === 'A') return true;
  if (ariaRole === 'link') return true;
  return false;
}

// ── Text Entry Patterns ────────────────────────────────────────────────

/**
 * Is this element a text entry field?
 */
export function isTextEntry(
  tag: string,
  inputType: string | null,
  ariaRole: string | null,
  isContentEditable: boolean,
): boolean {
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT' && (inputType === 'text' || inputType === 'email' ||
      inputType === 'password' || inputType === 'search' || inputType === 'tel' ||
      inputType === 'url' || inputType === 'number' || inputType === null)) {
    return true;
  }
  if (ariaRole === 'textbox') return true;
  if (isContentEditable) return true;
  return false;
}

// ── Hover Patterns ─────────────────────────────────────────────────────

/** Minimum dwell time in ms to qualify as a hover interaction. */
export const HOVER_DWELL_THRESHOLD_MS = 500;

// ── Scroll Patterns ────────────────────────────────────────────────────

/**
 * Check if a scroll event has meaningful movement (non-zero delta).
 *
 * Architecture: §4.5 (Scroll events with zero delta fix)
 */
export function hasScrollDelta(scrollDeltaY: number | null, scrollDeltaX: number | null): boolean {
  const dy = scrollDeltaY ?? 0;
  const dx = scrollDeltaX ?? 0;
  return dy !== 0 || dx !== 0;
}

// ── Element Key ────────────────────────────────────────────────────────

/**
 * Generate a stable identity key for an element from its ElementIdentity.
 * Used for dedup, scope tracking, and lifecycle management.
 *
 * Priority: testId > dataCy > dataQa > stableId > (accessibleName + cssSelector) > cssSelector > tag
 *
 * This is the identity function used by the runtime — NOT the one used by
 * the content script (which operates on live DOM elements). The runtime
 * operates on ElementIdentity objects (snapshots).
 */
export function elementKey(identity: ElementIdentity): string {
  if (identity.testId) return `testId:${identity.testId}`;
  if (identity.dataCy) return `dataCy:${identity.dataCy}`;
  if (identity.dataQa) return `dataQa:${identity.dataQa}`;
  if (identity.stableId) return `id:${identity.stableId}`;
  const name = identity.accessibleName || '';
  const selector = identity.cssSelector || '';
  if (name && selector) return `name:${name}|sel:${selector}`;
  if (selector) return `sel:${selector}`;
  return `tag:${identity.tag}`;
}

// ── File Upload Patterns ───────────────────────────────────────────────

/**
 * Is this element a file upload input?
 */
export function isFileInput(tag: string, inputType: string | null): boolean {
  return tag === 'INPUT' && inputType === 'file';
}

// ── Slider Patterns ────────────────────────────────────────────────────

/**
 * Is this element a slider/range input?
 */
export function isSlider(tag: string, inputType: string | null, ariaRole: string | null): boolean {
  if (tag === 'INPUT' && inputType === 'range') return true;
  if (ariaRole === 'slider') return true;
  return false;
}

// ── Tab Patterns ───────────────────────────────────────────────────────

/**
 * Is this element a tab?
 */
export function isTab(ariaRole: string | null): boolean {
  return ariaRole === 'tab';
}

// ── Breadcrumb Patterns (Phase 2) ──────────────────────────────────────

/**
 * CSS class patterns that identify breadcrumb elements.
 */
const BREADCRUMB_CLASS_RE = /\b(?:breadcrumb|crumb|breadcrumbs|bcrumb|trail)\b/i;

/**
 * Is this element a breadcrumb item?
 *
 * Breadcrumbs are navigation elements showing the page's location in a
 * site hierarchy. They're typically <li> or <a> elements inside a
 * container with a breadcrumb class.
 */
export function isBreadcrumb(
  className: string | null,
  ancestorClasses: string[],
): boolean {
  // Check the element's own class
  if (className && BREADCRUMB_CLASS_RE.test(className)) {
    return true;
  }
  // Check ancestor classes — breadcrumb items are often plain <li>/<a>
  // inside a nav.breadcrumb container
  for (const ac of ancestorClasses) {
    if (ac && BREADCRUMB_CLASS_RE.test(ac)) {
      return true;
    }
  }
  return false;
}
