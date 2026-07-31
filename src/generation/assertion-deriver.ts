/**
 * State-Based Assertion Derivation
 *
 * Derives verification assertions from the interaction's captured state changes.
 * Unlike the constraint-based assertions in ir-bridge.ts (which come from
 * ApplicationKnowledgeFragment), these assertions come from what the recorder
 * actually observed: value changes, checked transitions, navigation events.
 *
 * Assertion severity:
 *   - HARD: Direct state changes the user initiated (value entered, option selected)
 *   - SOFT: Secondary evidence (required-field presence, disabled state)
 *
 * Architecture: .drytis/PHASE2_DESIGN.md §5
 */

import {
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../domain/enums';
import type { IRAssertion } from '../domain/execution-ir/types';
import type { DetectedInteraction } from '../classifier/interaction-types';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Create a minimal IRAssertion with the given parameters.
 * Target is element-based with empty locators (the IR Bridge fills these).
 */
function makeAssertion(
  type: ValidationType,
  comparison: ValidationComparison,
  expectedValue: unknown,
  property: string,
  severity: ValidationSeverity = ValidationSeverity.HARD,
): IRAssertion {
  return {
    type,
    comparison,
    expectedValue,
    severity,
    target: {
      kind: 'element',
      elementId: '',
      elementName: '',
      pageOrComponent: '',
      resolvedLocators: [],
    },
    property,
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Derive state-based assertions from a single interaction's metadata.
 *
 * These assertions verify that the action the user performed actually
 * changed the page state as expected — the core of "did the action
 * take effect?"
 *
 * @param interaction  The detected interaction with metadata
 * @returns Array of assertions derived from the interaction's evidence
 */
export function deriveStateAssertions(
  interaction: DetectedInteraction,
): IRAssertion[] {
  const assertions: IRAssertion[] = [];
  const meta = interaction.metadata;
  const type = interaction.type;

  // ── TextEntry: value assertion ──
  if (type === 'TextEntry' || type === 'RichTextEditor') {
    const value = meta.textValue;
    if (value !== undefined && value !== null && value !== '') {
      assertions.push(
        makeAssertion(
          ValidationType.EQUALITY,
          ValidationComparison.EQUALS,
          value,
          'value',
        ),
      );
    }
  }

  // ── TagInput / OtpInput: value assertion ──
  if (type === 'TagInput' || type === 'OtpInput') {
    const value = meta.textValue ?? meta.configuredFields;
    if (value !== undefined && value !== null && value !== '') {
      assertions.push(
        makeAssertion(
          ValidationType.EQUALITY,
          ValidationComparison.EQUALS,
          value,
          'value',
        ),
      );
    }
  }

  // ── Checkbox / ToggleSwitch: checked assertion ──
  if (type === 'Checkbox' || type === 'ToggleSwitch') {
    if (meta.checked === true) {
      assertions.push(
        makeAssertion(
          ValidationType.PRESENCE,
          ValidationComparison.IS_TRUE,
          true,
          'checked',
        ),
      );
    } else if (meta.checked === false) {
      assertions.push(
        makeAssertion(
          ValidationType.PRESENCE,
          ValidationComparison.IS_FALSE,
          false,
          'checked',
        ),
      );
    }
  }

  // ── Dropdown / Autocomplete: selected value assertion ──
  if (type === 'NativeDropdown' || type === 'CustomDropdown' ||
      type === 'Autocomplete' || type === 'MultiSelect') {
    const value = meta.selectedValue;
    if (value !== undefined && value !== null && value !== '') {
      assertions.push(
        makeAssertion(
          ValidationType.EQUALITY,
          ValidationComparison.EQUALS,
          value,
          'value',
        ),
      );
    }
  }

  // ── DatePicker / TimePicker: date value assertion ──
  if (type === 'DatePicker' || type === 'TimePicker' || type === 'DateTimePicker') {
    const value = meta.dateValue;
    if (value !== undefined && value !== null && value !== '') {
      assertions.push(
        makeAssertion(
          ValidationType.EQUALITY,
          ValidationComparison.EQUALS,
          value,
          'value',
        ),
      );
    }
  }

  // ── Slider: value assertion ──
  if (type === 'Slider') {
    const value = meta.sliderValue;
    if (value !== undefined && value !== null) {
      assertions.push(
        makeAssertion(
          ValidationType.EQUALITY,
          ValidationComparison.EQUALS,
          value,
          'value',
        ),
      );
    }
  }

  // ── Navigation: URL assertion ──
  if (type === 'PageNavigation' || type === 'Back' || type === 'Forward' || type === 'Refresh') {
    const url = meta.url ?? meta.pageUrl;
    if (url !== undefined && url !== null && url !== '') {
      assertions.push(
        makeAssertion(
          ValidationType.URL_MATCH,
          ValidationComparison.EQUALS,
          url,
          'url',
        ),
      );
    }
  }

  // ── Configuration Session: per-field assertions ──
  // When a definition captures multiple configured fields (e.g., DatePicker
  // with start/end dates, dropdown with multiple selections), verify each.
  if (meta.configuredFields) {
    const fields = meta.configuredFields as Record<string, unknown>;
    for (const [fieldKey, fieldValue] of Object.entries(fields)) {
      if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
        assertions.push(
          makeAssertion(
            ValidationType.EQUALITY,
            ValidationComparison.EQUALS,
            fieldValue,
            `value.${fieldKey}`,
          ),
        );
      }
    }
  }

  return assertions;
}

/**
 * Derive state-based assertions for all interactions.
 */
export function deriveStateAssertionsBatch(
  interactions: DetectedInteraction[],
): Map<string, IRAssertion[]> {
  const result = new Map<string, IRAssertion[]>();
  for (const interaction of interactions) {
    const assertions = deriveStateAssertions(interaction);
    if (assertions.length > 0) {
      result.set(interaction.interactionId, assertions);
    }
  }
  return result;
}
