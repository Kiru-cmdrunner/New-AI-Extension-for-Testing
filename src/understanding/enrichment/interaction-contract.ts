/**
 * M9.7 — Interaction Contract Extractor
 *
 * Extracts a deterministic interaction contract from a ComponentInteraction's
 * element identity. Purely from DOM attributes captured in trigger — no
 * JS-based validation rules (those require LLM in a future layer).
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ElementIdentity } from '../../shared/types';
import type {
  InteractionContract,
  ElementType,
  InputFormat,
} from './semantic-types';

/**
 * Extract an interaction contract from a component interaction's trigger.
 */
export function extractInteractionContract(
  interaction: ComponentInteraction,
): InteractionContract {
  const trigger = interaction.trigger;

  return {
    interactionId: interaction.interactionId,
    label: trigger.accessibleName ?? trigger.placeholder ?? trigger.ariaLabel ?? '',
    tag: trigger.tag ?? '',
    elementType: deriveElementType(trigger),
    inputType: trigger.inputType,
    format: deriveFormat(trigger),
    disabled: false,
    checked: null,
    expanded: null,
    required: inferRequired(trigger),
    placeholder: trigger.placeholder,
    optionCount: null,
    elementPath: trigger.xPath ?? trigger.cssSelector ?? '',
  };
}

/**
 * Derive the semantic element type from tag + input type.
 */
function deriveElementType(trigger: ElementIdentity): ElementType {
  const tag = (trigger.tag ?? '').toLowerCase();
  const inputType = (trigger.inputType ?? '').toLowerCase();

  if (tag === 'textarea') return 'textarea';
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'select';

  if (tag === 'input') {
    switch (inputType) {
      case 'email': return 'email-input';
      case 'password': return 'password-input';
      case 'number': return 'number-input';
      case 'date':
      case 'datetime-local':
        return 'date-input';
      case 'range': return 'slider';
      case 'file': return 'file-input';
      case 'checkbox': return 'checkbox';
      case 'radio': return 'radio';
      case 'text': return 'text-input';
      default: return 'text-input';
    }
  }

  return 'other';
}

/**
 * Derive expected value format from input type.
 */
function deriveFormat(trigger: ElementIdentity): InputFormat | null {
  const inputType = (trigger.inputType ?? '').toLowerCase();
  const direct: Record<string, InputFormat> = {
    email: 'email',
    url: 'url',
    tel: 'tel',
    number: 'number',
    date: 'date',
    time: 'time',
    'datetime-local': 'datetime',
    month: 'month',
    week: 'week',
    password: 'password',
    color: 'color',
    search: 'search',
    text: 'text',
  };
  return direct[inputType] ?? null;
}

/**
 * Infer whether the element is required.
 * M1–M9 does NOT capture the `required` attribute in the behavioral
 * evidence path — so we infer from aria-required and CSS class patterns.
 * This is explicitly a best-effort heuristic.
 */
function inferRequired(trigger: ElementIdentity): boolean | null {
  // aria-label might contain required indicator
  const label = (trigger.accessibleName ?? '').toLowerCase();
  if (label.includes('required')) return true;

  // Class-based heuristic
  const cls = (trigger.className ?? '').toLowerCase();
  if (/\brequired\b/.test(cls)) return true;

  return null;
}
