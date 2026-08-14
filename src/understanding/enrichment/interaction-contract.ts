/**
 * M9.7 — Interaction Contract Extractor
 *
 * Extracts a deterministic interaction contract from a ComponentInteraction's
 * element identity and behavioral evidence. D9: now reads actual
 * TargetStateSnapshot evidence instead of hardcoding state defaults.
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
 * Extract an interaction contract from a component interaction's trigger
 * and behavioral evidence.
 *
 * D9: State fields (disabled, checked, expanded, optionCount, required)
 * are now populated from actual TargetStateSnapshot evidence in
 * behavioralEvidence.targetEvidence, falling back to triggerEvent.domContext,
 * then to safe defaults only when neither is available.
 */
export function extractInteractionContract(
  interaction: ComponentInteraction,
): InteractionContract {
  const trigger = interaction.trigger;

  // D9: Extract actual state evidence from multiple sources.
  const targetEvidence = interaction.behavioralEvidence?.targetEvidence;
  const after = targetEvidence?.after ?? null;
  const domContext = interaction.triggerEvent?.domContext ?? null;

  // disabled: prefer target state snapshot, then domContext
  const disabled = after?.disabled
    ?? (domContext?.disabled ?? false);

  // checked: prefer target state snapshot.checked, then ariaChecked
  const checked: boolean | null =
    after?.checked ??
    after?.ariaChecked ??
    null;

  // expanded: prefer target state snapshot.ariaExpanded, then domContext.ariaExpanded
  const expanded: boolean | null =
    after?.ariaExpanded ??
    domContext?.ariaExpanded ??
    null;

  // required: prefer domContext.required (actual DOM attribute); only use
  // heuristic when domContext is unavailable (e.g., synthetic interactions).
  const required: boolean | null =
    domContext ? domContext.required : inferRequired(trigger);

  // optionCount: for select-like elements, use childCount from target state snapshot
  const tag = (trigger.tag ?? '').toLowerCase();
  const optionCount: number | null =
    (tag === 'select' && after?.childCount != null) ? after.childCount : null;

  return {
    interactionId: interaction.interactionId,
    label: trigger.accessibleName ?? trigger.placeholder ?? trigger.ariaLabel ?? '',
    tag: trigger.tag ?? '',
    elementType: deriveElementType(trigger),
    inputType: trigger.inputType,
    format: deriveFormat(trigger),
    disabled,
    checked,
    expanded,
    required,
    placeholder: trigger.placeholder,
    optionCount,
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
 * D9: Now a fallback only — the primary source is domContext.required.
 * This heuristic is used when domContext is unavailable (e.g., synthetic
 * interactions without full evidence).
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
