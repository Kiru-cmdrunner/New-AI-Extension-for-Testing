/**
 * Centralized constants for the Architecture C multi-tier classifier
 * and snapshot coalescer.
 *
 * All configurable thresholds and pattern definitions live here so that
 * classifier rules reference them by name rather than hardcoding magic
 * numbers. This makes the rules readable and the thresholds tunable.
 *
 * Architecture: .drytis/architecture-c-production.md §6 (Tier 1–3 rules)
 */

// ── Timing Thresholds ─────────────────────────────────────

/**
 * Minimum mouse dwell time (mouseenter → mouseleave/click) for hover
 * classification (Classifier Rule 14, Tier 2).
 *
 * Frozen by C3 (Hover Recording): DWELL_THRESHOLD = 500ms.
 */
export const DWELL_THRESHOLD = 500;

/**
 * Temporal window for grouping related browser events into a single
 * InteractionSnapshot (Coalescer).
 *
 * Events on the same element (or related ancestor chain) within this
 * window are coalesced. 500ms is generous enough to capture
 * mousedown→click→change→blur sequences without splitting them.
 */
export const COALESCING_WINDOW_MS = 500;

/**
 * Debounce for focus events before the coalescer treats a focus→blur
 * sequence as a text entry interaction.
 *
 * Prevents accidental tab-through focus events from being captured
 * as text entries. 300ms matches the current text-entry content script.
 */
export const FOCUS_DEBOUNCE_MS = 300;

/**
 * Minimum AI confidence to apply advisory classification (Tier 3).
 *
 * AI suggestions below this threshold are ignored — the deterministic
 * fallback (Rule 16: click) is used instead. This enforces AI Philosophy
 * P5 (Honest Confidence): low-confidence AI output is unreliable.
 *
 * Frozen by AI Observer Architecture: threshold = 0.70.
 */
export const AI_CONFIDENCE_THRESHOLD = 0.70;

/**
 * Confidence threshold above which deterministic classification is
 * considered authoritative and AI is informational only.
 *
 * When a Tier 1 or Tier 2 rule produces confidence ≥ 0.90, the AI
 * Observer is still called for enrichment (businessName, userIntent)
 * but its suggestedType is ignored (AP4: Evidence Sovereignty).
 */
export const DETERMINISTIC_CONFIDENCE_HIGH = 0.90;

/**
 * Minimum confidence for a Tier 1 rule (strong deterministic evidence).
 * Tier 1 rules always produce confidence ≥ this value.
 */
export const TIER_1_MIN_CONFIDENCE = 0.95;

/**
 * Minimum confidence for a Tier 2 rule (behavioral evidence).
 */
export const TIER_2_MIN_CONFIDENCE = 0.70;

// ── AI Philosophy Bounds (P5: Honest Confidence) ─────────

/**
 * Maximum representable confidence. Never 1.0 — absolute certainty is
 * epistemically dishonest (P5).
 */
export const CONFIDENCE_MAX = 0.95;

/**
 * Minimum representable confidence. Never 0.0 — some uncertainty is
 * always preferable to zero (P5).
 */
export const CONFIDENCE_MIN = 0.05;

/**
 * Confidence for the default fallback rule (Rule 16: click).
 * Intentionally low — signals "best guess, no evidence matched."
 */
export const FALLBACK_CONFIDENCE = 0.30;

// ── Date Detection Patterns ───────────────────────────────

/**
 * Regular expressions for detecting date-like values.
 *
 * Used by the coalescer to compute ValueChange.isDateLike — a stronger
 * signal than the current architecture's keyword-matching on element
 * attributes (placeholder, name, id, class).
 *
 * The coalescer tests the actual value that changed, not the element's
 * metadata. A value of '2026-07-18' is date-like regardless of whether
 * the input field says "date" anywhere.
 */
export const DATE_REGEX_PATTERNS: readonly RegExp[] = [
  /^\d{4}-\d{2}-\d{2}$/,                                    // ISO: 2026-07-18
  /^\d{2}\/\d{2}\/\d{4}$/,                                  // US: 07/18/2026
  /^\d{4}\/\d{2}\/\d{2}$/,                                  // alt ISO: 2026/07/18
  /^\d{2}-\d{2}-\d{4}$/,                                    // EU dash: 18-07-2026
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,                              // loose slash: 7/18/2026
  /^\w{3,9}\.?\s+\d{1,2},?\s+\d{4}$/,                       // Jul 18, 2026 / July 18 2026
  /^\d{1,2}\s+\w{3,9}\.?\s+\d{4}$/,                         // 18 Jul 2026 / 18 July 2026
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/,                // ISO datetime: 2026-07-18T14:30
] as const;

/**
 * Test whether a string value matches any known date format.
 *
 * @param value - The value to test.
 * @returns true if the value looks like a date.
 */
export function isDateLikeValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return DATE_REGEX_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ── Selection Pattern Detection ───────────────────────────

/**
 * CSS class substrings that indicate a selection state.
 *
 * When one of these appears in the classChange.added list, it suggests
 * the user selected an item (Classifier Rule 12: CSS class differential).
 *
 * These are intentionally broad — any class containing the substring
 * matches. This catches framework-specific classes like:
 *   - react-select's "select__option--is-selected"
 *   - Material-UI's "Mui-selected"
 *   - Bootstrap's "active"
 */
export const SELECTION_CLASS_PATTERNS: readonly string[] = [
  'selected',
  'active',
  'checked',
  'current',
  'is-selected',
  'is-active',
] as const;

/**
 * Test whether any added class matches a selection pattern.
 *
 * @param addedClasses - CSS classes added during the interaction.
 * @returns true if a selection-related class appeared.
 */
export function hasSelectionClass(addedClasses: string[]): boolean {
  return addedClasses.some((cls) =>
    SELECTION_CLASS_PATTERNS.some((pattern) =>
      cls.toLowerCase().includes(pattern),
    ),
  );
}

// ── ARIA Role Sets ────────────────────────────────────────

/**
 * ARIA roles that indicate a checkbox-like toggleable control.
 *
 * Classifier Rule 5 (Tier 1): state change + one of these roles → 'toggle'.
 */
export const TOGGLE_ROLES: readonly string[] = [
  'checkbox',
  'menuitemcheckbox',
  'switch',
] as const;

/**
 * ARIA roles that indicate a radio-like selection control.
 *
 * Classifier Rule 6 (Tier 1): state change + one of these roles → 'select'.
 */
export const RADIO_ROLES: readonly string[] = [
  'radio',
  'menuitemradio',
] as const;

/**
 * ARIA roles that indicate a selection target within a container.
 *
 * Classifier Rule 9 (Tier 2): click + option role + listbox ancestor → 'select'.
 * Classifier Rule 10 (Tier 2): click + menuitem role + menu ancestor → 'select'.
 */
export const OPTION_ROLES: readonly string[] = [
  'option',
  'treeitem',
] as const;

export const MENU_ITEM_ROLES: readonly string[] = [
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
] as const;

/**
 * ARIA roles that indicate a dropdown or combobox container.
 */
export const COMBOBOX_ROLES: readonly string[] = [
  'combobox',
  'listbox',
] as const;

/**
 * ARIA roles that indicate a calendar or grid container.
 */
export const CALENDAR_ROLES: readonly string[] = [
  'grid',
  'gridcell',
] as const;

/**
 * ARIA roles that indicate a menu container.
 */
export const MENU_ROLES: readonly string[] = [
  'menu',
  'menubar',
] as const;

/**
 * ARIA roles that indicate a dialog container.
 */
export const DIALOG_ROLES: readonly string[] = [
  'dialog',
  'alertdialog',
] as const;

/**
 * Container class substrings that suggest a calendar/datepicker context.
 *
 * Used by AncestorContext computation (coalescer) and Classifier Rule 8.
 */
export const CALENDAR_CLASS_PATTERNS: readonly string[] = [
  'calendar',
  'datepicker',
  'date-picker',
  'date_picker',
  'pikaday',
  'flatpickr',
  'air-datepicker',
] as const;

/**
 * Container class substrings that suggest a dropdown context.
 */
export const DROPDOWN_CLASS_PATTERNS: readonly string[] = [
  'dropdown',
  'select-menu',
  'select__menu',
  'popover',
  'flyout',
] as const;

// ── HTML Input Types ──────────────────────────────────────

/**
 * HTML input types that should be classified as text entry (fill),
 * NOT date selection — even if the value happens to look date-like.
 *
 * Classifier Rule 2 checks inputType against this list.
 */
export const TEXT_INPUT_TYPES: readonly string[] = [
  'text',
  'email',
  'password',
  'search',
  'tel',
  'url',
  'number',
] as const;

/**
 * HTML input types that produce native date/time pickers.
 *
 * Classifier Rule 3 (Tier 1): change on these input types → 'selectDate'.
 */
export const NATIVE_DATE_INPUT_TYPES: readonly string[] = [
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
] as const;

// ── Rule IDs ──────────────────────────────────────────────

/**
 * Classifier rule identifiers for evidence trails.
 *
 * Each rule produces a ClassificationEvidence with a ruleId. These IDs
 * are used for debugging, auditing, and the Review Layer (future).
 *
 * Tiers: R1–R6 = Tier 1 (deterministic), R7–R14 = Tier 2 (behavioral),
 * R15 = Tier 3 (AI advisory), R16 = Tier 3 (fallback).
 */
export const RULE = {
  // Tier 1 — Strong Deterministic Evidence
  NAVIGATE: 'R1',
  TEXT_ENTRY: 'R2',
  NATIVE_DATE_INPUT: 'R3',
  NATIVE_SELECT: 'R4',
  CHECKBOX_TOGGLE: 'R5',
  RADIO_SELECT: 'R6',

  // Tier 2 — Behavioral Evidence
  DATE_VALUE_OUTCOME: 'R7',
  DATE_CALENDAR_CONTEXT: 'R8',
  ARIA_OPTION_IN_LISTBOX: 'R9',
  ARIA_MENUITEM_IN_MENU: 'R10',
  SEGMENTED_CONTROL: 'R11',
  CSS_CLASS_DIFFERENTIAL: 'R12',
  TOGGLE_INDICATOR: 'R13',
  HOVER_DWELL_MUTATION: 'R14',

  // Tier 3 — AI Advisory + Fallback
  AI_ADVISORY: 'R15',
  DEFAULT_FALLBACK: 'R16',
} as const;

/**
 * Human-readable descriptions for each rule, used in ClassificationEvidence.
 */
export const RULE_DESCRIPTIONS: Record<string, string> = {
  [RULE.NAVIGATE]: 'Navigation event',
  [RULE.TEXT_ENTRY]: 'Text entry with value change on input/textarea',
  [RULE.NATIVE_DATE_INPUT]: 'Native date/time input change',
  [RULE.NATIVE_SELECT]: 'Native <select> element change',
  [RULE.CHECKBOX_TOGGLE]: 'Checkbox/switch state change with toggle role',
  [RULE.RADIO_SELECT]: 'Radio state change with radio role',
  [RULE.DATE_VALUE_OUTCOME]: 'Value changed to a date-like format',
  [RULE.DATE_CALENDAR_CONTEXT]: 'Click within a calendar/grid ancestor',
  [RULE.ARIA_OPTION_IN_LISTBOX]: 'Click on ARIA option within listbox',
  [RULE.ARIA_MENUITEM_IN_MENU]: 'Click on ARIA menuitem within menu',
  [RULE.SEGMENTED_CONTROL]: 'Click on segmented control (aria-pressed group)',
  [RULE.CSS_CLASS_DIFFERENTIAL]: 'Click with selection class pattern change',
  [RULE.TOGGLE_INDICATOR]: 'Click on element with toggle indicator (summary/aria-expanded/tab)',
  [RULE.HOVER_DWELL_MUTATION]: 'Hover with dwell time + observable DOM change',
  [RULE.AI_ADVISORY]: 'AI advisory classification (high confidence)',
  [RULE.DEFAULT_FALLBACK]: 'Default classification: click (no rule matched)',
};

// ── Canonical Type Lists ──────────────────────────────────

/**
 * All 10 canonical interaction types.
 *
 * Re-exported from architecture-types for convenience as a runtime array
 * (the type itself is in evidence-types.ts).
 */
export const CANONICAL_TYPES = [
  'navigate',
  'click',
  'fill',
  'select',
  'toggle',
  'selectDate',
  'hover',
  'pressKey',
  'upload',
  'drag',
] as const;

/**
 * Canonical types that carry a value (fill, select, selectDate).
 * Used to determine whether a snapshot's valueChange should populate
 * the Timeline event's value field.
 */
export const VALUE_BEARING_TYPES: readonly string[] = [
  'fill',
  'select',
  'selectDate',
] as const;

/**
 * Canonical types that carry a checked state (toggle).
 */
export const STATE_BEARING_TYPES: readonly string[] = [
  'toggle',
] as const;

// ── Default Configuration ─────────────────────────────────

/**
 * Default coalescer configuration.
 *
 * All thresholds are overridable via CoalescingConfig in the pipeline.
 * These defaults match the frozen thresholds from the architecture document.
 */
export const DEFAULT_COALESCING_CONFIG = {
  windowMs: COALESCING_WINDOW_MS,
  dwellThresholdMs: DWELL_THRESHOLD,
  focusDebounceMs: FOCUS_DEBOUNCE_MS,
  aiConfidenceThreshold: AI_CONFIDENCE_THRESHOLD,
} as const;
