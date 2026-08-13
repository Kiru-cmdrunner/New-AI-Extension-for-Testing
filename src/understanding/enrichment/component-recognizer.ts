/**
 * M9.7 — Component Recognizer
 *
 * Tier 1: Reuse existing src/enrichment/ component detection when
 *   ComponentInteraction.componentType / componentFramework /
 *   businessMeaning is already populated.
 *
 * Tier 2: Add behavioral pattern recognition using interaction type,
 *   trigger identity, and target state evidence captured by M1–M9.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { ComponentModel } from './semantic-types';

/**
 * Build a ComponentModel from a component interaction and its outcome.
 *
 * If the interaction already has a componentType (from Phase 1 enrichment),
 * we trust it and enrich the model. If not, we apply Tier 2 behavioral
 * pattern matching.
 */
export function recognizeComponent(
  interaction: ComponentInteraction,
  outcome?: ActionOutcome,
  viewId?: string,
): ComponentModel {
  const trigger = interaction.trigger;
  const ariaRole = trigger.ariaRole ?? inferRoleFromTag(trigger.tag);
  const label = trigger.accessibleName ?? trigger.placeholder ?? trigger.ariaLabel ?? '';

  // ── Tier 1: Already detected by Phase 1 enrichment ────────────────
  if (interaction.componentType) {
    return {
      interactionId: interaction.interactionId,
      componentType: interaction.componentType,
      componentFramework: interaction.componentFramework ?? null,
      businessMeaning: interaction.businessMeaning ?? null,
      detectedBy: 'enrichment',
      ariaRole,
      label,
      viewId: viewId ?? null,
    };
  }

  // ── Tier 2: Behavioral pattern recognition ────────────────────────
  const tier2 = recognizeByBehavior(interaction, outcome);
  const detectedBy: ComponentModel['detectedBy'] =
    tier2.method.startsWith('aria') ? 'tier1-aria' : 'tier2-behavioral';

  return {
    interactionId: interaction.interactionId,
    componentType: tier2.type,
    componentFramework: null,
    businessMeaning: null,
    detectedBy,
    ariaRole,
    label,
    viewId: viewId ?? null,
  };
}

// ── Internal types ─────────────────────────────────────────────────────

interface Tier2Result {
  type: string;
  method: string;
}

/**
 * Classify the element's component type from behavioral evidence.
 */
function recognizeByBehavior(
  interaction: ComponentInteraction,
  outcome?: ActionOutcome,
): Tier2Result {
  const trigger = interaction.trigger;
  const tagName = trigger.tag?.toLowerCase() ?? '';
  const role = trigger.ariaRole ?? '';
  const inputType = trigger.inputType ?? '';
  const className = trigger.className ?? '';
  const stateChanges = outcome?.stateChanges ?? [];
  const hasNavEffect = stateChanges.some((sc) =>
    sc.includes('view-change') || sc.includes('navigation') || sc.includes('Navigation'),
  );

  // ARIA role → component type (highest priority)
  if (role === 'combobox') return { type: 'select', method: 'aria-role' };
  if (role === 'checkbox') return { type: 'checkbox', method: 'aria-role' };
  if (role === 'radio') return { type: 'radio', method: 'aria-role' };
  if (role === 'button') {
    if (hasNavEffect) return { type: 'link', method: 'aria-role+behavior' };
    return { type: 'button', method: 'aria-role' };
  }
  if (role === 'link') return { type: 'link', method: 'aria-role' };
  if (role === 'textbox') return { type: 'text-input', method: 'aria-role' };
  if (role === 'searchbox') return { type: 'search-input', method: 'aria-role' };
  if (role === 'menuitem') return { type: 'menu-item', method: 'aria-role' };
  if (role === 'tab') return { type: 'tab', method: 'aria-role' };
  if (role === 'switch') return { type: 'toggle', method: 'aria-role' };
  if (role === 'slider') return { type: 'slider', method: 'aria-role' };

  // Tag-based detection
  if (tagName === 'button') {
    if (hasNavEffect) return { type: 'link', method: 'tag+behavior' };
    return { type: 'button', method: 'tag' };
  }
  if (tagName === 'a') return { type: 'link', method: 'tag' };
  if (tagName === 'select') return { type: 'select', method: 'tag' };
  if (tagName === 'option') return { type: 'option', method: 'tag' };

  if (tagName === 'input') {
    return recognizeInput(inputType, className, hasNavEffect);
  }

  if (tagName === 'textarea') return { type: 'text-area', method: 'tag' };

  // Class-based heuristics
  const cls = className.toLowerCase();
  if (/\b(btn|button)\b/.test(cls)) return { type: 'button', method: 'class-pattern' };
  if (/\b(dropdown|select|combo)\b/.test(cls)) return { type: 'select', method: 'class-pattern' };
  if (/\btab\b/.test(cls) && !/\b(table|tabbed)\b/.test(cls)) return { type: 'tab', method: 'class-pattern' };
  if (/\b(toggle|switch)\b/.test(cls)) return { type: 'toggle', method: 'class-pattern' };

  // Behavioral: if the outcome caused a navigation, treat as link
  if (hasNavEffect) return { type: 'link', method: 'behavior-nav' };

  // Fallback
  return { type: 'unknown', method: 'fallback' };
}

function recognizeInput(
  inputType: string,
  className: string,
  _hasNavEffect: boolean,
): Tier2Result {
  const cls = className.toLowerCase();

  switch (inputType) {
    case 'checkbox':
      return { type: 'checkbox', method: 'tag+attr' };
    case 'radio':
      return { type: 'radio', method: 'tag+attr' };
    case 'search':
      return { type: 'search-input', method: 'tag+attr' };
    case 'email':
      return { type: 'email-input', method: 'tag+attr' };
    case 'password':
      return { type: 'password-input', method: 'tag+attr' };
    case 'number':
      return { type: 'number-input', method: 'tag+attr' };
    case 'range':
      return { type: 'slider', method: 'tag+attr' };
    case 'date':
    case 'datetime-local':
      return { type: 'date-input', method: 'tag+attr' };
    case 'submit':
      return { type: 'button', method: 'tag+attr' };
    case 'image':
      return { type: 'button', method: 'tag+attr' };
    case 'text':
    case '':
      if (/\b(search|lookup|query)\b/.test(cls)) return { type: 'search-input', method: 'class-pattern' };
      return { type: 'text-input', method: 'tag+attr' };
    default:
      return { type: 'text-input', method: 'tag+attr' };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function inferRoleFromTag(tag?: string): string | null {
  switch (tag?.toLowerCase()) {
    case 'button': return 'button';
    case 'a': return 'link';
    case 'select': return 'combobox';
    case 'option': return 'option';
    case 'textarea': return 'textbox';
    case 'input':
      return 'textbox';
    default:
      return null;
  }
}
