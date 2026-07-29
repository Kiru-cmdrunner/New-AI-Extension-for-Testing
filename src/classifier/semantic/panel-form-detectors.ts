/**
 * Panel & Form Detectors — Component-Aware Semantic Reasoning
 *
 * Detection functions for MultiConfig (multi-field panels) and FormSubmit
 * (form submission workflows).
 *
 * These are pure functions — no side effects. The reasoner calls them
 * to decide when to activate, complete, or absorb interactions for these
 * new component types.
 */

import type { DetectedInteraction } from '../interaction-types';
import type { ComponentSession } from './types';

// ── Shared Helpers ─────────────────────────────────────────────────────────

/**
 * Extract a usable name from an interaction's target.
 * Falls back through accessibleName → ariaLabel → name → tag.
 */
function getTargetName(interaction: DetectedInteraction): string {
  const t = interaction.target;
  if (!t) return '';
  return t.accessibleName || t.ariaLabel || t.name || t.tag || '';
}

/**
 * Check if an interaction's target has a CSS class matching any pattern.
 */
function hasClassPattern(interaction: DetectedInteraction, patterns: string[]): boolean {
  const cls = interaction.target?.className ?? '';
  if (!cls) return false;
  const lower = cls.toLowerCase();
  return patterns.some(p => lower.includes(p));
}

// ── MultiConfig: Activation ───────────────────────────────────────────────

/**
 * CSS class patterns that indicate a panel/dropdown containing multiple
 * configurable fields (AdaniOne flight options, filter panels, etc.).
 */
const PANEL_TRIGGER_CLASSES = [
  'flight-options', 'cabin-selector', 'passenger-selector',
  'preferences-panel', 'filter-panel', 'config-panel',
  'dropdown-panel', 'popover-content', 'drawer-content',
  'stepper', 'counter', 'quantity-selector',
];

/**
 * Check if an interaction activates a MultiConfig session.
 *
 * A MultiConfig session activates when a click opens a panel/popover/drawer
 * that contains multiple interactive controls. Detection methods in priority order:
 *   1. Surface evidence: click caused a surface (popover, drawer, menu) to appear
 *      — detected via DomContext.surfaceType propagated to metadata.surfaceContext
 *   2. Known panel trigger CSS classes
 *   3. Element with aria-haspopup + panel-like role (combobox/button/menuitem)
 */
export function isMultiConfigActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type !== 'Click') return false;

  // Pattern 1 (NEW): Surface-anchored activation — the most reliable signal.
  // If this click caused a surface (popover, drawer, menu) to appear, activate
  // a multiConfig session. This is framework-agnostic: it doesn't depend on
  // CSS class naming conventions.
  const surfaceCtx = interaction.metadata.surfaceContext;
  if (surfaceCtx?.openedByThisInteraction) {
    // popover and drawer are composite panels; menu may be a simple dropdown
    // (let the dropdown session handle those). We activate multiConfig for
    // surfaces that typically contain multiple fields.
    if (surfaceCtx.type === 'popover' || surfaceCtx.type === 'drawer') {
      return true;
    }
  }

  // Pattern 2: Known panel trigger classes (fallback for frameworks without
  // surface detection — older content script versions)
  if (hasClassPattern(interaction, PANEL_TRIGGER_CLASSES)) return true;

  // Pattern 3: Element with aria-haspopup + panel-like role
  const target = interaction.target;
  if (target) {
    const role = target.ariaRole ?? '';
    const cls = (target.className ?? '').toLowerCase();

    // Combobox or menu button that opens a panel (not a simple dropdown)
    if ((role === 'combobox' || role === 'button' || role === 'menuitem') &&
        (cls.includes('options') || cls.includes('selector') || cls.includes('config'))) {
      return true;
    }
  }

  return false;
}

// ── MultiConfig: Completion ───────────────────────────────────────────────

/**
 * Keywords for panel completion buttons.
 */
const PANEL_COMPLETION_KEYWORDS = [
  'done', 'apply', 'confirm', 'ok', 'search', 'update',
  'select', 'continue', 'set', 'save',
];

/**
 * Check if an interaction completes a MultiConfig session.
 *
 * Completion happens when the user clicks a "Done"/"Apply" button.
 */
export function isMultiConfigCompletion(
  interaction: DetectedInteraction,
  session: ComponentSession,
): boolean {
  if (session.componentType !== 'multiConfig') return false;

  // Button click with completion keyword
  if (interaction.type === 'Click' || interaction.type === 'Link') {
    const name = getTargetName(interaction).toLowerCase();
    if (PANEL_COMPLETION_KEYWORDS.some(kw => name === kw || name.startsWith(kw))) {
      return true;
    }
    // Submit-type button
    if (interaction.target?.tag === 'BUTTON') {
      if (PANEL_COMPLETION_KEYWORDS.some(kw => name.includes(kw))) {
        return true;
      }
    }
  }

  return false;
}

// ── MultiConfig: Absorption ───────────────────────────────────────────────

/**
 * Determine whether an interaction should be absorbed by an active MultiConfig session.
 *
 * Absorbs all interactions that occur inside the panel — the panel boundary
 * is determined by proximity (timing + overlapping ancestor classes).
 */
export function shouldAbsorbMultiConfig(
  interaction: DetectedInteraction,
  session: ComponentSession,
): boolean {
  if (session.componentType !== 'multiConfig') return false;

  // Always absorb noise interactions
  const noiseTypes = new Set(['PageScroll', 'ContainerScroll', 'Hover', 'Tooltip']);
  if (noiseTypes.has(interaction.type)) return true;

  // Absorb interactions that share CSS class ancestry with the panel trigger
  const triggerClass = session.triggerInteraction.target?.className ?? '';

  // Check if the interaction target shares a common panel ancestor class
  const targetClass = interaction.target?.className ?? '';
  if (triggerClass && targetClass) {
    // Extract root-level class tokens (first 1-2 words) from trigger
    const triggerTokens = triggerClass.toLowerCase().split(/[\s-]/).filter(t => t.length > 3);
    const targetTokens = targetClass.toLowerCase().split(/[\s-]/).filter(t => t.length > 3);
    const overlap = triggerTokens.some(t => targetTokens.includes(t));
    if (overlap) return true;
  }

  // Absorb RadioButton, Checkbox, ToggleSwitch, Slider interactions
  // (these are field adjustments inside the panel)
  const fieldTypes = new Set(['RadioButton', 'Checkbox', 'ToggleSwitch', 'Slider']);
  if (fieldTypes.has(interaction.type)) return true;

  // Absorb TextEntry inside the panel
  if (interaction.type === 'TextEntry') return true;

  // Absorb Click interactions on stepper/counter buttons (+/-)
  const name = getTargetName(interaction);
  if (interaction.type === 'Click' && /^[+\-]$|add|remove|increase|decrease/i.test(name)) {
    return true;
  }

  return false;
}

/**
 * Extract field name and value from an absorbed interaction.
 *
 * Returns null if the interaction doesn't represent a field configuration.
 */
export function extractConfigField(
  interaction: DetectedInteraction,
): { field: string; value: string } | null {
  const fieldName = getTargetName(interaction);

  switch (interaction.type) {
    case 'RadioButton':
      return {
        field: fieldName || 'Option',
        value: interaction.metadata.checked ? 'Selected' : 'Unselected',
      };

    case 'Checkbox':
    case 'ToggleSwitch':
      return {
        field: fieldName || 'Option',
        value: interaction.metadata.checked ? 'On' : 'Off',
      };

    case 'TextEntry':
      return {
        field: fieldName || 'Field',
        value: interaction.metadata.textValue ?? '',
      };

    case 'Slider':
      return {
        field: fieldName || 'Slider',
        value: interaction.metadata.sliderValue ?? '',
      };

    case 'Click': {
      // Stepper/counter clicks: extract +/- as increment/decrement
      const name = fieldName.toLowerCase();
      if (name === '+' || name.includes('add') || name.includes('increase')) {
        return { field: fieldName, value: '+1' };
      }
      if (name === '-' || name.includes('remove') || name.includes('decrease')) {
        return { field: fieldName, value: '-1' };
      }
      // Generic click inside panel — record as selection
      if (fieldName) {
        return { field: 'Selection', value: fieldName };
      }
      return null;
    }

    case 'NativeDropdown':
    case 'CustomDropdown':
      return {
        field: fieldName || 'Dropdown',
        value: interaction.metadata.selectedValue ?? '',
      };

    default:
      return null;
  }
}

// ── FormSubmit: Activation ────────────────────────────────────────────────

/**
 * Check if an interaction activates a FormSubmit session.
 *
 * Activates when a TextEntry occurs on a password-type field, or when a
 * TextEntry occurs inside a form context (multiple form fields in sequence).
 */
export function isFormSubmitActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type !== 'TextEntry') return false;

  // Check for password field
  const target = interaction.target;
  if (target) {
    const name = (target.name ?? '').toLowerCase();
    const ariaLabel = (target.ariaLabel ?? '').toLowerCase();
    const accessibleName = (target.accessibleName ?? '').toLowerCase();
    const placeholder = (target.placeholder ?? '').toLowerCase();

    if (name.includes('password') || name.includes('passwd') || name.includes('pwd') ||
        ariaLabel.includes('password') || accessibleName.includes('password') ||
        placeholder.includes('password')) {
      return true;
    }
  }

  return false;
}

// ── FormSubmit: Completion ────────────────────────────────────────────────

/**
 * Keywords for form submit buttons.
 */
const SUBMIT_KEYWORDS = [
  'login', 'sign in', 'signin', 'log in', 'submit', 'register',
  'sign up', 'signup', 'continue', 'next', 'create account',
];

/**
 * Check if an interaction completes a FormSubmit session.
 *
 * FormSubmit completion is handled differently from other sessions:
 * it doesn't absorb the form fields (they're emitted normally), and
 * completion is triggered by a submit button click that causes navigation.
 *
 * This detector identifies submit button clicks. The actual merge with
 * navigation is handled by the navigation lookback mechanism.
 */
export function isFormSubmitCompletion(
  interaction: DetectedInteraction,
  session: ComponentSession,
): boolean {
  if (session.componentType !== 'formSubmit') return false;

  if (interaction.type === 'Click') {
    const name = getTargetName(interaction).toLowerCase();
    if (SUBMIT_KEYWORDS.some(kw => name === kw || name.startsWith(kw))) {
      return true;
    }
  }

  return false;
}

// ── FormSubmit: Enrichment ────────────────────────────────────────────────

/**
 * Check if a TextEntry interaction should be enriched with form context.
 *
 * While a FormSubmit session is active, TextEntry interactions on form
 * fields are enriched with formContext metadata.
 */
export function isFormFieldEntry(interaction: DetectedInteraction): boolean {
  return interaction.type === 'TextEntry';
}

/**
 * Build form context metadata for enrichment.
 */
export function buildFormContext(
  submitAction: string,
): { formSubmitAction: string } {
  return { formSubmitAction: submitAction };
}
