/**
 * InteractionContract Deriver — derives semantic constraints from UiElement.domAttributes.
 *
 * Pure function: takes a UiElement, reads its captured DOM attributes, and produces
 * an InteractionContract describing the valid interaction space (constraints, formats,
 * ranges, options).
 *
 * No DOM inspection needed — domAttributes are already captured on the entity.
 * The only external input is an optional optionSet from the component (if this element
 * is part of a selectable component).
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §1
 */

import type { UiElement } from '../../domain/entities/ui-element';
import type { InteractionContract, InteractionConstraints } from '../../domain/entities/application-knowledge';
import type { PatternDefinition } from '../recognition/pattern-catalogue';

/**
 * Derive an InteractionContract from a UiElement's captured DOM attributes.
 *
 * @param element The UiElement to derive constraints for.
 * @param pattern Optional PatternDefinition if the element is part of a component.
 * @returns InteractionContract with all derivable constraints populated.
 */
export function deriveInteractionContract(
  element: UiElement,
  pattern?: PatternDefinition,
): InteractionContract {
  const attrs = element.domAttributes;

  const constraints: InteractionConstraints = {
    // required: check for `required` or `aria-required="true"`
    required: deriveRequired(attrs),

    // inputType: from `type` attribute
    inputType: attrs['type'] ?? null,

    // valueRange: from min/max/step (for number inputs)
    valueRange: deriveValueRange(attrs),

    // lengthRange: from minlength/maxlength
    lengthRange: deriveLengthRange(attrs),

    // format: from `pattern` attribute or type-derived format
    format: deriveFormat(attrs),

    // validOptions: populated by the enrichment orchestrator from component.optionSet
    validOptions: null,

    // dateFormat: from type=date inputs with min/max
    dateFormat: deriveDateFormat(attrs),
  };

  // Affordances from pattern definition if available, otherwise from element capabilities
  const affordances = pattern
    ? [...pattern.affordances]
    : element.intrinsicCapabilities.map((c) => String(c));

  return {
    appliesTo: { type: 'element', id: element.elementId },
    affordances,
    constraints,
  };
}

// ── Private derivation helpers ───────────────────────────

function deriveRequired(attrs: Readonly<Record<string, string>>): boolean | null {
  if ('required' in attrs || attrs['aria-required'] === 'true') {
    return true;
  }
  if (attrs['aria-required'] === 'false') {
    return false;
  }
  return null;
}

function deriveValueRange(
  attrs: Readonly<Record<string, string>>,
): { min: number; max: number; step: number } | null {
  const min = attrs['min'];
  const max = attrs['max'];
  const step = attrs['step'];

  if (min === undefined && max === undefined) {
    return null;
  }

  return {
    min: min !== undefined ? parseFloat(min) : Number.NEGATIVE_INFINITY,
    max: max !== undefined ? parseFloat(max) : Number.POSITIVE_INFINITY,
    step: step !== undefined ? parseFloat(step) : 1,
  };
}

function deriveLengthRange(
  attrs: Readonly<Record<string, string>>,
): { minLength: number; maxLength: number } | null {
  const minLength = attrs['minlength'];
  const maxLength = attrs['maxlength'];

  if (minLength === undefined && maxLength === undefined) {
    return null;
  }

  return {
    minLength: minLength !== undefined ? parseInt(minLength, 10) : 0,
    maxLength: maxLength !== undefined ? parseInt(maxLength, 10) : Number.POSITIVE_INFINITY,
  };
}

function deriveFormat(
  attrs: Readonly<Record<string, string>>,
): { regex: string; description: string } | null {
  const patternAttr = attrs['pattern'];
  if (patternAttr) {
    return {
      regex: patternAttr,
      description: `Pattern: ${patternAttr}`,
    };
  }

  const type = attrs['type'];
  if (type === 'email') {
    return {
      regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      description: 'Email address format',
    };
  }

  if (type === 'url') {
    return {
      regex: '^https?://.+',
      description: 'URL format (http or https)',
    };
  }

  return null;
}

function deriveDateFormat(
  attrs: Readonly<Record<string, string>>,
): { format: string; earliest: string | null; latest: string | null } | null {
  const type = attrs['type'];

  if (type === 'date' || type === 'datetime-local' || type === 'time' || type === 'month') {
    const formatMap: Record<string, string> = {
      date: 'yyyy-MM-dd',
      'datetime-local': "yyyy-MM-dd'T'HH:mm",
      time: 'HH:mm',
      month: 'yyyy-MM',
    };

    return {
      format: formatMap[type] ?? 'yyyy-MM-dd',
      earliest: attrs['min'] ?? null,
      latest: attrs['max'] ?? null,
    };
  }

  return null;
}
