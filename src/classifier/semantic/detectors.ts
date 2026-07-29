/**
 * Component Detectors — Stage 5
 *
 * Detection functions for activation, completion, cancellation, and
 * absorption of component sessions.
 *
 * Each detector operates on a DetectedInteraction and optional DetectionContext,
 * returning whether the interaction matches the component lifecycle signal.
 *
 * Design: detectors are pure functions — no state, no side effects.
 * The SemanticReasoner orchestrates which detectors to call based on
 * active sessions.
 */

import type { DetectedInteraction, InteractionType } from '../interaction-types';
import type { ComponentSession } from './types';

// ── Activation Detectors ─────────────────────────────────────────────────

/**
 * CSS class patterns that indicate a dropdown trigger element.
 */
const DROPDOWN_TRIGGER_CLASSES = [
  'oxd-select-text', 'oxd-select-wrapper', 'oxd-select-text-input',
  'select-wrapper', 'custom-select', 'dropdown-trigger',
  'combo-trigger', 'ant-select-selector', 'ant-select',
];

/**
 * CSS class patterns that indicate a date picker trigger element.
 */
const DATEPICKER_TRIGGER_CLASSES = [
  'oxd-date-input', 'oxd-date-picker', 'oxd-date-wrapper',
  'date-picker', 'pika-input', 'air-datepicker-input',
  'react-datepicker', 'flatpickr', 'calendar-input',
];

/**
 * Placeholder patterns that indicate a date picker input.
 */
const DATE_FORMAT_TOKENS = new Set(['yyyy', 'yy', 'mm', 'dd', 'mon', 'day', 'month', 'year']);

/**
 * CSS class patterns that indicate an autocomplete/typeahead input.
 */
const AUTOCOMPLETE_TRIGGER_CLASSES = [
  'autocomplete', 'typeahead', 'suggestion-input',
  'oxd-autocomplete', 'ant-select-show-search',
  'search-input', 'combobox-input',
];

/**
 * Check if a CSS class string contains any of the given patterns.
 */
function hasClassPattern(className: string | null | undefined, patterns: string[]): boolean {
  if (!className) return false;
  const lower = className.toLowerCase();
  return patterns.some(p => lower.includes(p));
}

/**
 * Check if a placeholder string looks like a date format pattern.
 */
function isDateFormatPlaceholder(placeholder: string | null | undefined): boolean {
  if (!placeholder) return false;
  const tokens = placeholder.toLowerCase().match(/[a-z]+/g) ?? [];
  let dateTokens = 0;
  for (const t of tokens) {
    if (DATE_FORMAT_TOKENS.has(t)) dateTokens++;
  }
  return dateTokens >= 2;
}

/**
 * Check if an interaction is a click on a dropdown trigger.
 *
 * A dropdown trigger click is a Click/CustomDropdown interaction on an
 * element that has dropdown-like CSS classes or roles.
 */
export function isDropdownActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type === 'NativeDropdown') return true;
  if (interaction.type === 'CustomDropdown') return true;

  // Click on a combobox/lisbbox element
  if (interaction.type === 'Click' || interaction.type === 'Unknown') {
    const target = interaction.target;
    if (!target) return false;

    if (target.ariaRole === 'combobox' || target.ariaRole === 'listbox') return true;
    if (hasClassPattern(target.className, DROPDOWN_TRIGGER_CLASSES)) return true;
  }

  return false;
}

/**
 * Check if an interaction is a click on a date picker trigger.
 */
export function isDatePickerActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type === 'DatePicker') return true;
  if (interaction.type === 'TimePicker') return true;
  if (interaction.type === 'DateTimePicker') return true;

  // Click on date input
  if (interaction.type === 'Click' || interaction.type === 'TextEntry') {
    const target = interaction.target;
    if (!target) return false;

    if (target.tag === 'INPUT') {
      const inputType = (target as any).inputType as string | undefined;
      if (inputType === 'date' || inputType === 'time' || inputType === 'datetime-local') return true;
    }

    if (hasClassPattern(target.className, DATEPICKER_TRIGGER_CLASSES)) return true;
    if (isDateFormatPlaceholder(target.placeholder)) return true;
  }

  return false;
}

/**
 * Check if an interaction is a focus/interaction on an autocomplete input.
 */
export function isAutocompleteActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type === 'Autocomplete') return true;

  if (interaction.type === 'Click' || interaction.type === 'TextEntry') {
    const target = interaction.target;
    if (!target) return false;

    if (hasClassPattern(target.className, AUTOCOMPLETE_TRIGGER_CLASSES)) return true;
    // aria-autocomplete indicates the element supports suggestions
    if ((target as any).ariaAutoComplete === 'list' || (target as any).ariaAutoComplete === 'both') {
      return true;
    }
  }

  return false;
}

/**
 * Check if an interaction could be a navigation trigger — click on a
 * submit/link/button that may cause a page navigation.
 *
 * This is intentionally conservative: only explicit navigation elements
 * (links, submit buttons) are considered. Keyword matching on accessible
 * names (e.g., "Save", "Login") is too broad — many such buttons don't
 * cause navigation (e.g., AJAX saves).
 */
export function isNavigationActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type === 'PageNavigation') return false; // navigation events themselves
  if (interaction.type === 'Click' || interaction.type === 'Link') {
    const target = interaction.target;
    if (!target) return false;

    // Links always navigate
    if (target.tag === 'A') return true;
    if (target.ariaRole === 'link') return true;

    // Submit buttons
    if (target.tag === 'BUTTON') {
      const typeAttr = (target as any).typeAttribute as string | undefined;
      if (typeAttr === 'submit') return true;
    }

    // INPUT type=submit
    if (target.tag === 'INPUT') {
      const typeAttr = (target as any).typeAttribute as string | undefined;
      if (typeAttr === 'submit') return true;
    }
  }

  return false;
}

// ── Completion Detectors ─────────────────────────────────────────────────

/**
 * Roles that indicate an element is a dropdown option.
 */
const OPTION_ROLES = new Set(['option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const OPTION_TAGS = new Set(['OPTION', 'LI']);

/**
 * Check if an interaction represents selecting a dropdown option.
 *
 * For dropdown sessions, completion is:
 * 1. A click on an element with role=option, role=menuitem, etc.
 * 2. A Select/NativeDropdown interaction with a selectedValue.
 * 3. A TextEntry interaction with a value (typed input + auto-select).
 */
export function isDropdownCompletion(
  interaction: DetectedInteraction,
  _session: ComponentSession,
): boolean {
  // A Select/NativeDropdown with a value
  if (interaction.type === 'NativeDropdown' || interaction.type === 'CustomDropdown') {
    return !!interaction.metadata.selectedValue;
  }

  // A click on an option element
  if (interaction.type === 'Click') {
    const target = interaction.target;
    if (target) {
      if (target.ariaRole && OPTION_ROLES.has(target.ariaRole)) return true;
      if (target.tag && OPTION_TAGS.has(target.tag)) return true;
    }
  }

  return false;
}

/**
 * Check if an interaction represents completing a date selection.
 */
export function isDatePickerCompletion(
  interaction: DetectedInteraction,
  _session: ComponentSession,
): boolean {
  // A dateSelect event
  if (interaction.type === 'DatePicker') {
    return !!interaction.metadata.dateValue || !!interaction.metadata.displayValue;
  }

  // Click on a calendar cell
  if (interaction.type === 'Click') {
    const target = interaction.target;
    if (target) {
      const role = target.ariaRole;
      if (role === 'gridcell' || role === 'cell') return true;
      if (target.tag === 'TD') return true;
      // OXD date picker day buttons
      if (hasClassPattern(target.className, ['oxd-date-day'])) return true;
    }
  }

  // TextEntry with a date-like value (typed date + blur)
  if (interaction.type === 'TextEntry') {
    const value = interaction.metadata.textValue ?? '';
    // Check if the text looks like a date
    if (/^\d{1,4}[-/.\s]\d{1,2}[-/.\s]\d{1,4}$/.test(value.trim())) return true;
  }

  return false;
}

/**
 * Check if an interaction represents selecting an autocomplete suggestion.
 */
export function isAutocompleteCompletion(
  interaction: DetectedInteraction,
  _session: ComponentSession,
): boolean {
  // Autocomplete interaction with a value
  if (interaction.type === 'Autocomplete') {
    return !!interaction.metadata.selectedValue;
  }

  // Click on a suggestion element
  if (interaction.type === 'Click') {
    const target = interaction.target;
    if (target) {
      if (target.ariaRole && OPTION_ROLES.has(target.ariaRole)) return true;
      // Suggestion items often have active-row class
      if (hasClassPattern(target.className, ['suggestion', 'autocomplete-item', 'result-item', 'typeahead-item'])) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a PageNavigation interaction completes a navigation session.
 */
export function isNavigationCompletion(
  interaction: DetectedInteraction,
): boolean {
  return interaction.type === 'PageNavigation' ||
         interaction.type === 'NewTab';
}

// ── Absorption Detectors ─────────────────────────────────────────────────

/**
 * Interaction types that are always absorbed when inside an active session.
 *
 * These are internal to the component interaction — they are noise when
 * viewed from a semantic perspective.
 */
const ALWAYS_ABSORBED_TYPES = new Set<InteractionType>([
  'PageScroll', 'ContainerScroll', 'Hover', 'Tooltip',
]);

/**
 * Check if an interaction should be absorbed into an active component session.
 *
 * Absorbed interactions are NOT emitted — they are implementation details
 * of the component interaction.
 */
export function shouldAbsorb(
  interaction: DetectedInteraction,
  session: ComponentSession,
): boolean {
  // Always-absorbed types
  if (ALWAYS_ABSORBED_TYPES.has(interaction.type)) return true;

  // Date picker internal: month/year navigation, prev/next buttons
  if (session.componentType === 'datePicker') {
    if (interaction.type === 'Click') {
      const target = interaction.target;
      if (target) {
        const name = (target.accessibleName || '').toLowerCase();
        const NAV_KEYWORDS = ['prev', 'next', 'previous', 'chevron', 'switch', 'today', 'month', 'year'];
        if (NAV_KEYWORDS.some(k => name.includes(k))) return true;
      }
    }
  }

  // Dropdown internal: scroll within dropdown list.
  // NOTE: Non-option clicks are NOT absorbed — they either complete the
  // session (if they hit an option) or pass through (cancelling the session
  // via timeout or the next activation). Absorbing arbitrary clicks would
  // swallow legitimate interactions like Save/Submit buttons.
  if (session.componentType === 'dropdown') {
    // Only absorb clicks on elements that are clearly part of the dropdown
    // panel itself (e.g., the dropdown wrapper, a search filter inside it)
    if (interaction.type === 'Click') {
      const target = interaction.target;
      if (target) {
        // Clicks on the dropdown trigger itself (re-clicking to scroll) → absorb
        if (hasClassPattern(target.className, DROPDOWN_TRIGGER_CLASSES)) return true;
      }
    }
  }

  // Autocomplete: text entry while typing
  if (session.componentType === 'autocomplete') {
    if (interaction.type === 'TextEntry') return true;
    if (interaction.type === 'Click') {
      const target = interaction.target;
      if (target) {
        // If it's an option, that's completion
        if (target.ariaRole && OPTION_ROLES.has(target.ariaRole)) return false;
        // Click on the input itself → absorb
        if (hasClassPattern(target.className, AUTOCOMPLETE_TRIGGER_CLASSES)) return true;
      }
    }
  }

  return false;
}

// ── Cancellation Detectors ───────────────────────────────────────────────

/**
 * Check if an interaction causes all active sessions to cancel.
 */
export function isSessionCancellation(
  interaction: DetectedInteraction,
): boolean {
  // Navigation always cancels pending sessions
  if (interaction.type === 'PageNavigation') return true;
  // New tab cancels the navigation session
  if (interaction.type === 'NewTab') return true;
  return false;
}

// ── Value Extraction ─────────────────────────────────────────────────────

/**
 * Extract the result value from a completion interaction.
 *
 * Returns the semantic value of the completed action (selected option text,
 * date value, etc.).
 */
export function extractCompletionValue(
  completion: DetectedInteraction,
  componentType: ComponentSession['componentType'],
): { value: string | null; metadata: Record<string, unknown> } {
  const meta = completion.metadata;

  switch (componentType) {
    case 'dropdown':
    case 'autocomplete': {
      // Prefer selectedValue from metadata
      if (meta.selectedValue) {
        return { value: meta.selectedValue, metadata: { selectedValue: meta.selectedValue } };
      }
      // Fall back to accessibleName of the clicked option
      const name = completion.target?.accessibleName ?? '';
      if (name) {
        return { value: name, metadata: { selectedValue: name } };
      }
      // Fall back to textValue
      if (meta.textValue) {
        return { value: meta.textValue, metadata: { selectedValue: meta.textValue } };
      }
      return { value: null, metadata: {} };
    }

    case 'datePicker': {
      // Prefer dateValue/displayValue from DatePicker interaction
      if (meta.dateValue) {
        return {
          value: meta.dateValue,
          metadata: {
            dateValue: meta.dateValue,
            displayValue: meta.displayValue ?? meta.dateValue,
            dateAmbiguous: meta.dateAmbiguous,
          },
        };
      }
      // Fall back to textValue (typed date)
      if (meta.textValue) {
        return {
          value: meta.textValue,
          metadata: { dateValue: meta.textValue, displayValue: meta.textValue },
        };
      }
      // Fall back to accessibleName of clicked cell
      const cellName = completion.target?.accessibleName ?? '';
      if (cellName) {
        return {
          value: cellName,
          metadata: { dateValue: cellName, displayValue: cellName },
        };
      }
      return { value: null, metadata: {} };
    }

    default:
      return { value: null, metadata: {} };
  }
}
