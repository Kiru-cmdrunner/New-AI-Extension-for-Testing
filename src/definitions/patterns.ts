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
import type { DomContext } from '../shared/component-types';

// ── Best Name ──────────────────────────────────────────────────────────

/**
 * Pick the best available human-readable name for an element.
 *
 * Priority: accessibleName > ariaLabel > placeholder > icon-class > 'element'.
 *
 * IMPORTANT: callers that have a valueBefore should use `||` to combine:
 *   bestName(accessibleName || valueBefore, ariaLabel, placeholder)
 * The `??` operator does NOT fall through on empty string, which was the
 * root cause of Bug 2 (dropdown "from element" display).
 *
 * S2 (2026-08-20): icon-only elements (<i class="icon-plus">, fa-plus, mdi-*)
 * carry their semantic in CSS class tokens. When all three textual tiers are
 * empty, derive a name from the icon class family shared with
 * enrichment/component-detector.ts extractIconName. Pure string function —
 * structural, no timing, no DOM.
 *
 * Architecture: §4.2 (Dropdown no-op fix), RCA2 S2 (icon naming tier)
 */
export function bestName(
  accessibleName: string,
  ariaLabel?: string | null,
  placeholder?: string | null,
  iconClassName?: string | null,
): string {
  if (accessibleName && accessibleName.trim()) return accessibleName.trim();
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  if (placeholder && placeholder.trim()) return placeholder.trim();
  const icon = iconNameFromClasses(iconClassName);
  if (icon) return icon;
  return 'element';
}

/**
 * Semantic icon names shared with the enrichment layer. Kept as a small local
 * map (subset of ICON_SEMANTIC_NAMES in component-detector.ts) because
 * patterns.ts must stay dependency-free from the enrichment layer.
 */
const ICON_NAME_OVERRIDES: Record<string, string> = {
  plus: 'add',
  add: 'add',
  minus: 'remove',
  remove: 'remove',
  close: 'close',
  cancel: 'close',
  x: 'close',
  delete: 'delete',
  trash: 'delete',
  search: 'search',
  arrowdown: 'arrow-down',
  arrowup: 'arrow-up',
  arrowleft: 'arrow-left',
  arrowright: 'arrow-right',
  chevrondown: 'chevron-down',
  chevronup: 'chevron-up',
  chevronleft: 'chevron-left',
  chevronright: 'chevron-right',
  calendar: 'calendar',
  menu: 'menu',
  hamburger: 'menu',
  edit: 'edit',
  pencil: 'edit',
};

/**
 * Derive a human-readable icon name from CSS class tokens.
 * Families: fa-* / fa-solid-* (Font Awesome), mdi-* (Material Design Icons),
 * bi-* (Bootstrap Icons), icon-* / *-icon (generic), material icons.
 * Returns e.g. 'plus icon' for 'icon-plus', 'add icon' for 'fa-plus',
 * or null when no icon token is present.
 */
export function iconNameFromClasses(className: string | null | undefined): string | null {
  if (!className) return null;
  const classes = className.toLowerCase();

  // Font Awesome: fa-plus, fa-solid fa-plus, fa-regular fa-*, fa-brands fa-*
  const fa = classes.match(/\bfa-(?:solid|regular|brands?-)?([a-z][-a-z0-9]+)\b/);
  if (fa) {
    const stem = fa[1].replace(/-/g, '');
    return `${ICON_NAME_OVERRIDES[stem] ?? fa[1]} icon`;
  }

  // Material Design Icons: mdi-plus, mdi-chevron-down
  const mdi = classes.match(/\bmdi-([a-z][-a-z0-9]+)\b/);
  if (mdi) {
    const stem = mdi[1].replace(/-/g, '');
    return `${ICON_NAME_OVERRIDES[stem] ?? mdi[1]} icon`;
  }

  // Bootstrap Icons: bi-plus-lg, bi-x
  const bi = classes.match(/\bbi-([a-z][-a-z0-9]*)\b/);
  if (bi) {
    const stem = bi[1].replace(/-/g, '');
    return `${ICON_NAME_OVERRIDES[stem] ?? bi[1]} icon`;
  }

  // Generic: icon-plus / plus-icon (leading and trailing forms)
  const generic = classes.match(/\bicon-([a-z][-a-z0-9]+)\b/);
  if (generic) {
    const stem = generic[1].replace(/-/g, '');
    return `${ICON_NAME_OVERRIDES[stem] ?? generic[1]} icon`;
  }
  const trailing = classes.match(/\b([a-z][-a-z0-9]+)-icon\b/);
  if (trailing) {
    const stem = trailing[1].replace(/-/g, '');
    return `${ICON_NAME_OVERRIDES[stem] ?? trailing[1]} icon`;
  }

  return null;
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

// ── S6/LP1: Open Selection Surface Ancestry ─────────────────────────────

/**
 * S6/LP1: ARIA roles of "open selection surface" containers — when a click
 * target has no interactive signal of its own but sits inside one of these,
 * the surface must be open (pointer events cannot reach descendants of a
 * hidden/closed surface), so the click is a deliberate selection action.
 */
const OPEN_SELECTION_SURFACE_ROLES = new Set([
  'listbox', 'menu', 'grid', 'dialog',
]);

/**
 * Phase 6D.0: extract the semantic ARIA role tokens from an ancestorRoles
 * chain. Capture (dom-context-extractor / deterministic-recorder) stores
 * entries as `tag[role=x]` (e.g. `div[role=dialog]`) — bare entries are
 * native tags and are preserved as-is. Deterministic, case-sensitive parse
 * (ARIA roles are lowercase); no DOM, no mutation of the input.
 *
 * Why parse at the comparison boundary instead of changing the producer
 * format: the chain is persisted on ledger entries (LP3) and feeds
 * knowledge-repo signatures — changing the stored format would make
 * `'dialog'` ambiguous (native <dialog> tag vs role) and drift persisted
 * knowledge. Consumers compare against bare tokens; this is the single
 * canonical bridge.
 */
export function extractSemanticRoles(ancestorRoles: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of ancestorRoles) {
    const m = /^(\S+)\[role=(.+)\]$/.exec(entry);
    if (m) {
      // Multi-token roles ("div[role=button menuitem]") contribute each token;
      // quoted variants ("div[role=\"dialog\"]") are unwrapped too.
      const tokens = m[2].replace(/["']/g, '').split(/\s+/).filter(Boolean);
      out.push(...tokens);
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * S6/LP1: class tokens for open selection surfaces. Deliberately mirrors the
 * surface/menu/dialog conventions already used across the codebase
 * (DROPDOWN_SURFACE_CLASS_RE surface classes + DIALOG_RE's dialog tokens +
 * flyout/menu conventions) — one shared vocabulary, no site-specific tokens.
 *
 * Phase 6D.0: `popup` added so the vocabulary is a superset of DIALOG_RE
 * (component-detector.ts) — a surface class that enriches a card as Dialog
 * must also qualify a deliberate selection Click (int-47 RCA: the Dialog tag
 * fired but LP1 didn't). Framework families (MuiDialog/ant-modal/p-dialog)
 * are substring-covered by dialog/modal.
 *
 * Phase 6D.1: suggestion-family tokens added (options-list, suggestion,
 * autocomplete, typeahead) — generic typeahead/autocomplete naming
 * conventions. Root cause: the audit's ul.options-list typeahead matched no
 * token, so li.opt clicks fell unclaimed-at-projection. Substring anchoring
 * is the pre-existing family style (menu matches menu-item, etc.).
 */
const OPEN_SELECTION_SURFACE_CLASS_RE =
  /(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu|popup|suggestion|autocomplete|typeahead|options-list|MuiDialog|ant-modal|p-dialog)/i;

/**
 * S6/LP1: Is this click target inside an open selection surface?
 *
 * Structural DOM-state fact, no timing: ancestor roles/classes come from the
 * captured DomContext at click time. Used ONLY by click.detectTrigger as a
 * last-resort gate — it does NOT modify isInteractiveElement (Hover and any
 * other callers keep their existing semantics).
 */
export function isInsideOpenSelectionSurface(
  ancestorRoles: readonly string[],
  ancestorClasses: readonly string[],
): boolean {
  // Phase 6D.0: compare the SEMANTIC role tokens, not the raw chain entries —
  // capture emits `div[role=dialog]`, the set holds bare 'dialog'.
  const semanticRoles = extractSemanticRoles(ancestorRoles);
  if (semanticRoles.some((r) => OPEN_SELECTION_SURFACE_ROLES.has(r))) return true;
  return ancestorClasses.some((c) => OPEN_SELECTION_SURFACE_CLASS_RE.test(c));
}

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
/**
 * CSS class patterns for date-picker trigger wrappers/inputs.
 *
 * 6E-M2: separator-tolerant `date[_-]?picker` — the real site's wrapper is
 * `date_picker undefined` (underscore; batch 2 RC-A) while shipped tokens
 * cover `datepicker`/`date-picker`. Not a broadened substring: the
 * separator is optional between the two words only.
 */
const DATEPICKER_TRIGGER_CLASS_RE =
  /(^|[^a-z])(?:oxd-date-input|date[_-]?picker|date-input|calendar-input)/i;

/**
 * Date-vocabulary hint for trigger naming (name attribute or placeholder).
 * Shared by both paths so placeholder parity is exact (6D.1).
 *
 * 6E-M2: travel-date tokens (depart|return|onward|arrival) added from real
 * AdaniOne markup — the 'Depart on'/'Return on' fields carry no other date
 * signal (batch 2, RC-A). The four NEW tokens are separator/word-bounded
 * (exactly the frozen §2.3.2 vocabulary; 'Department store' stays out)
 * while the LEGACY tokens keep their shipped substring semantics
 * ('emp_birthday' matches 'birth' — pinned by patterns.test.ts) so no
 * shipped behavior changes.
 */
const DATE_NAME_HINT_RE =
  /(?:(?:^|[^a-z0-9])(?:depart|return|onward|arrival)(?=$|[^a-z0-9]|[_-])|date|birth|dob|expire|expiry|calendar)/i;

/**
 * CSS class patterns for calendar cells (actual selectable dates).
 *
 * 6E-M2: `datepicker__day` (react-datepicker's BEM family — double
 * underscore; the real site's cells are
 * `react-datepicker__day react-datepicker__day--selected …`, batch 2 RC-B).
 * Distinct from the inner `datepicker-date-holder` (not a cell).
 */
const DATEPICKER_CELL_CLASS_RE =
  /(oxd-date-day|calendar-day|datepicker-day|datepicker__day|day-cell|flatpickr-day)/i;

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
  placeholder: string | null = null,
): boolean {
  // 6E-M2 W-A.3: a calendar CELL is never a trigger. Checked FIRST
  // because the cell class family (`react-datepicker__day`) contains the
  // `datepicker` substring that the trigger token `date[_-]?picker` would
  // otherwise match — cells must complete lifecycles, not start them.
  if (className && DATEPICKER_CELL_CLASS_RE.test(className)) return false;
  // Native date/time inputs
  if (tag === 'INPUT' && inputType && DATE_INPUT_TYPES.has(inputType)) return true;
  // CSS class patterns
  if (className && DATEPICKER_TRIGGER_CLASS_RE.test(className)) return true;
  // ARIA hasPopup on a text input near a calendar
  if (ariaHasPopup === 'dialog' && tag === 'INPUT') return true;
  // Name attribute hints (date, birth, dob, etc.)
  if (name && DATE_NAME_HINT_RE.test(name)) return true;
  // Phase 6D.1: placeholder hints — real apps put the date vocabulary in the
  // placeholder ("Choose a date") or aria-label (capture folds both into
  // target.placeholder). Same vocabulary, same substring rule as `name`
  // (parity). Scoped to INPUT elements (spec §4.3): placeholder on other
  // tag shapes is decoration, not a control hint.
  if (placeholder && tag === 'INPUT' && DATE_NAME_HINT_RE.test(placeholder)) return true;
  return false;
}

/**
 * Is this element a calendar cell (an actual selectable date)?
 * Checks both ARIA role and CSS class.
 *
 * 6E-M2: optional `accessibleName` third argument — the W3C date-cell
 * name shape ("Choose Saturday, September 5th, 2026", the 6D.0
 * hasDateCellName machinery) is accepted as an additional sufficient cell
 * signal ONLY when the role is interactive (option|gridcell|button).
 * Belt = name shape; braces = role. Two-arg call sites behave exactly as
 * before (name path requires the third argument).
 */
export function isCalendarCell(
  ariaRole: string | null,
  className: string | null,
  accessibleName?: string | null,
): boolean {
  if (accessibleName != null && hasDateCellName(accessibleName, null)) {
    // W3C date-cell name + interactive role ⇒ cell even with unknown
    // classes (frameworks vary). Non-interactive roles (headings etc.)
    // must not become cells from a decorative name.
    if (ariaRole === 'option' || ariaRole === 'gridcell' || ariaRole === 'button') {
      return true;
    }
  }
  if (ariaRole === 'gridcell' || ariaRole === 'option') {
    // Must also have a date-like class to avoid matching listbox options
    if (className && DATEPICKER_CELL_CLASS_RE.test(className)) return true;
  }
  // Some calendars use buttons/cells without explicit roles
  if (className && DATEPICKER_CELL_CLASS_RE.test(className)) return true;
  return false;
}

/**
 * W3C date-cell naming shape: "Choose Saturday, September 5th, 2026".
 * The convention (ARIA APG date-picker pattern; used by AdaniOne,
 * react-datepicker, Material UI, and Chrome's built-in date pickers) is a
 * pure structural fact of the accessible name — no timing, no DOM probing.
 */
const DATE_CELL_NAME_RE =
  /^(?:choose|select|pick)?\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/i;

/**
 * Does this element's accessible name carry the date-cell naming shape?
 * Used by the Dropdown definition to exclude calendar cells from completing
 * a dropdown lifecycle even when the calendar's CSS classes are unknown
 * (frameworks vary) — the name shape is the stable structural signal.
 */
export function hasDateCellName(
  accessibleName: string | null | undefined,
  ariaLabel: string | null | undefined,
): boolean {
  const name = accessibleName || ariaLabel || '';
  if (!name) return false;
  return DATE_CELL_NAME_RE.test(name.trim());
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
  // 7.3 W-B: auto-id spellings join AFTER stableId (6B byte-identity rule —
  // elements keyed by DOM id today keep their key), dataAutoId first, then
  // the bare spelling. Aligns with the harvest chain (session-element-harvest
  // AC8) which already honors dataAutoId.
  if (identity.dataAutoId) return `dataAutoId:${identity.dataAutoId}`;
  if (identity.autoId) return `autoId:${identity.autoId}`;
  const name = identity.accessibleName || '';
  const selector = identity.cssSelector || '';
  if (name && selector) return `name:${name}|sel:${selector}`;
  if (selector) return `sel:${selector}`;
  return `tag:${identity.tag}`;
}

// ── Owner-Form Join (7.4-B6) ──────────────────────────────────────────

/**
 * Join key for "which form owns this control?" — the prefixed elementKey
 * of the closest ancestor <form>, as captured at event time in
 * DomContext.formElementKey.
 *
 * Pure function of RECORDED data (identity + domContext snapshot) — the
 * caller must never query the live DOM. Returns null when the field is
 * absent (legacy events, pre-B6 recordings) or honestly empty — a null
 * join NEVER matches, so legacy behavior is preserved byte-for-byte.
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md §4.1
 */
export function formJoinKey(
  _identity: ElementIdentity,
  domContext: Pick<DomContext, 'formElementKey'> | undefined,
): string | null {
  const key = domContext?.formElementKey;
  if (typeof key !== 'string' || key === '') return null;
  return `form:${key}`;
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
