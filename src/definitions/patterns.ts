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

/** ARIA roles that indicate interactivity. */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'combobox', 'listbox', 'option', 'checkbox', 'radio',
  'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'textbox', 'spinbutton', 'slider', 'treeitem', 'gridcell',
]);

/**
 * CSS class patterns that indicate a custom interactive element.
 * Frameworks apply these to wrapper divs that act as buttons, links, etc.
 * Includes common patterns from modern React/Vue/Angular apps.
 */
const INTERACTIVE_CLASS_RE =
  /(btn|button|clickable|selectable|dropdown|menu-item|nav-item|tab-item|chip|toggle|action|stepper|counter|increment|decrement|qty|quantity|plus|minus|add-btn|remove-btn|arrow|chevron|expand|collapse)/i;

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
  if (className && INTERACTIVE_CLASS_RE.test(className)) return true;
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
 */
const DROPDOWN_OPTION_ROLES = new Set([
  'option',
]);

/**
 * CSS class patterns for dropdown triggers and options.
 * Covers OXD (OrangeHRM), MUI, Ant Design, Bootstrap, React-Select.
 */
const DROPDOWN_TRIGGER_CLASS_RE =
  /(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect|selector|traveler|passenger|cabin|class-selector|trip-type|economy|traveller)/i;

const DROPDOWN_OPTION_CLASS_RE =
  /(oxd-select-option|select-option|option-item|list-option|ant-select-item)/i;

/**
 * CSS class patterns for the dropdown surface (the open listbox container).
 */
const DROPDOWN_SURFACE_CLASS_RE =
  /(oxd-select-dropdown|select-dropdown|listbox|dropdown-menu|popover|overlay)/i;

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
  if (className && DROPDOWN_TRIGGER_CLASS_RE.test(className)) return true;
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
  if (className && DROPDOWN_OPTION_CLASS_RE.test(className)) return true;
  return false;
}

/**
 * Is this element inside a dropdown surface (the open listbox)?
 */
export function isInsideDropdownSurface(className: string | null): boolean {
  if (!className) return false;
  return DROPDOWN_SURFACE_CLASS_RE.test(className);
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
 * CSS class patterns for date picker triggers.
 * Covers OXD, MUI DatePicker, Ant Design DatePicker, React-DatePicker.
 */
const DATEPICKER_TRIGGER_CLASS_RE =
  /(oxd-date-input|datepicker|date-picker|date-input|calendar-input)/i;

/**
 * CSS class patterns for calendar cells (actual selectable dates).
 */
const DATEPICKER_CELL_CLASS_RE =
  /(oxd-date-day|calendar-day|datepicker-day|day-cell|flatpickr-day)/i;

/**
 * CSS class patterns for the calendar surface (the open calendar container).
 */
const CALENDAR_SURFACE_CLASS_RE =
  /(oxd-date-input-dropdown|oxd-calendar|calendar|datepicker|flatpickr-calendar)/i;

/**
 * CSS class patterns for calendar NAVIGATION buttons (Next/Prev Month, etc.).
 * These must NOT complete the date picker lifecycle — they are lifecycle-internal.
 *
 * Architecture: §4.7 (DatePicker navigation button false positives fix)
 */
const CALENDAR_NAV_BUTTON_RE =
  /(oxd-calendar-switch-button|calendar.*nav|datepicker.*nav|prev|next|today|switch|chevron)/i;

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
  if (className && DATEPICKER_TRIGGER_CLASS_RE.test(className)) return true;
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
    if (className && DATEPICKER_CELL_CLASS_RE.test(className)) return true;
  }
  // Some calendars use buttons/cells without explicit roles
  if (className && DATEPICKER_CELL_CLASS_RE.test(className)) return true;
  return false;
}

/**
 * Is this element inside a calendar surface?
 */
export function isInsideCalendarSurface(className: string | null): boolean {
  if (!className) return false;
  return CALENDAR_SURFACE_CLASS_RE.test(className);
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
  // Class check
  if (className && CALENDAR_NAV_BUTTON_RE.test(className)) return true;
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
  if (ariaRole === 'checkbox' || ariaRole === 'switch' || ariaRole === 'menuitemcheckbox') return true;
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
  if (ariaRole === 'radio' || ariaRole === 'menuitemradio') return true;
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
  if (ariaRole === 'spinbutton') return true; // G5: custom ARIA spinbutton
  return false;
}

// ── Tab Patterns ───────────────────────────────────────────────────────

/**
 * Is this element a tab?
 */
export function isTab(ariaRole: string | null): boolean {
  return ariaRole === 'tab';
}
