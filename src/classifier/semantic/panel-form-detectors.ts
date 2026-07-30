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

// ── Stepper Detection ────────────────────────────────────────────────────

/**
 * CSS class patterns that indicate a stepper/counter button.
 * Matches plus, minus, increment, decrement, stepper, counter, qty, spinner.
 */
const STEPPER_CSS_PATTERN = /plus|minus|increment|decrement|stepper|counter|qty|spinner/i;

/** CSS class patterns specifically for plus/increment buttons. */
const STEPPER_PLUS_CSS = /plus|increment|add|increase/i;

/** CSS class patterns specifically for minus/decrement buttons. */
const STEPPER_MINUS_CSS = /minus|decrement|remove|decrease/i;

/** aria-label patterns for plus/increment buttons (e.g., "Increase Adults"). */
const STEPPER_PLUS_ARIA = /^(add|increase|increment)\b/i;

/** aria-label patterns for minus/decrement buttons (e.g., "Decrease Children"). */
const STEPPER_MINUS_ARIA = /^(remove|decrease|decrement)\b/i;

/**
 * Check if a Click interaction targets a stepper/counter button.
 *
 * Detection methods:
 *   1. accessibleName matches +/- / add / remove / increase / decrease
 *   2. CSS class matches stepper patterns (plus-icon, counter-btn, etc.)
 *   3. aria-label matches "Increase/Decrease ..." patterns
 *
 * Returns 'plus', 'minus', or null.
 */
function detectStepperDirection(interaction: DetectedInteraction): 'plus' | 'minus' | null {
  if (interaction.type !== 'Click') return null;

  const name = getTargetName(interaction).toLowerCase();
  const cls = (interaction.target?.className ?? '').toLowerCase();
  const ariaLabel = (interaction.target?.ariaLabel ?? '').toLowerCase();

  // Check accessibleName first (most reliable when present)
  if (name === '+' || name === 'add' || name.includes('increase') || name.includes('increment')) return 'plus';
  if (name === '-' || name === 'remove' || name.includes('decrease') || name.includes('decrement')) return 'minus';

  // Check CSS class patterns (icon-only buttons with no text label)
  if (STEPPER_PLUS_CSS.test(cls)) return 'plus';
  if (STEPPER_MINUS_CSS.test(cls)) return 'minus';

  // Check aria-label patterns (e.g., "Increase Adults", "Decrease Children")
  if (STEPPER_PLUS_ARIA.test(ariaLabel)) return 'plus';
  if (STEPPER_MINUS_ARIA.test(ariaLabel)) return 'minus';

  return null;
}

/**
 * Extract a field name from a stepper button's aria-label.
 *
 * "Increase Adults" → "Adults"
 * "Decrease Children" → "Children"
 * "Add Infant" → "Infant"
 *
 * Falls back to the accessibleName (which may come from a parent container
 * via the recorder's ancestor label resolution), then to 'Counter'.
 */
function extractStepperFieldName(interaction: DetectedInteraction): string {
  const ariaLabel = interaction.target?.ariaLabel ?? '';
  if (ariaLabel) {
    const stripped = ariaLabel
      .replace(/^(add|increase|increment|remove|decrease|decrement)\s+/i, '')
      .trim();
    if (stripped) return stripped;
  }
  const accessibleName = getTargetName(interaction);
  if (accessibleName && accessibleName.length > 0) return accessibleName;
  return 'Counter';
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
 * Two absorption strategies:
 *
 * 1. Surface-anchored absorption (preferred): If the session was activated by
 *    a click that opened a surface (popover/drawer), absorb ALL Click, RadioButton,
 *    Checkbox, ToggleSwitch, Slider, and TextEntry interactions. This works because:
 *    - Completion (Done/Apply) is checked BEFORE absorption in the reasoner
 *    - PageNavigation is handled by the navigation lookback merge BEFORE absorption
 *    - The session has a 15s timeout as a safety valve
 *    - End-of-stream flush commits accumulated fields
 *
 * 2. CSS class-token overlap (fallback): For sessions activated via CSS class
 *    matching (no surface evidence), use the original heuristic approach:
 *    absorb noise types, field types, TextEntry, and Click with stepper keywords.
 */
export function shouldAbsorbMultiConfig(
  interaction: DetectedInteraction,
  session: ComponentSession,
): boolean {
  if (session.componentType !== 'multiConfig') return false;

  // Always absorb noise interactions
  const noiseTypes = new Set(['PageScroll', 'ContainerScroll', 'Hover', 'Tooltip']);
  if (noiseTypes.has(interaction.type)) return true;

  // ── Strategy 1: Surface-anchored absorption ────────────────────────────
  // If the session was activated by a surface-opening click, absorb interactions
  // that are field adjustments inside the panel.
  //
  // Non-Click types (RadioButton, Checkbox, ToggleSwitch, Slider, TextEntry,
  // NativeDropdown, CustomDropdown) are always absorbed — these only occur
  // inside the panel.
  //
  // Click interactions require a boundary check: the click must be inside the
  // surface (indicated by its own surfaceContext being non-null — the DOM context
  // extractor walks ancestors and detects surface containers), OR be a stepper
  // button (stepper +/- buttons are always inside the panel).
  //
  // Without this check, ANY click on the page would be absorbed, including
  // buttons outside the panel (Issue 7: "Cheapest" fare button outside the
  // flight options popover was silently swallowed).
  const triggerSurfaceCtx = session.triggerInteraction.metadata.surfaceContext;
  if (triggerSurfaceCtx?.openedByThisInteraction) {
    const absorbableTypes = new Set([
      'RadioButton', 'Checkbox', 'ToggleSwitch', 'Slider', 'TextEntry',
      'NativeDropdown', 'CustomDropdown',
    ]);
    if (absorbableTypes.has(interaction.type)) return true;

    if (interaction.type === 'Click') {
      // Stepper buttons are always absorbed (they're part of the panel)
      if (detectStepperDirection(interaction) !== null) return true;

      // Boundary check: the interaction itself has surfaceContext, meaning
      // the DOM context extractor found a surface ancestor (popover/drawer/modal)
      // at capture time. This confirms the click is inside the panel.
      if (interaction.metadata.surfaceContext) return true;

      // Fallback: CSS class-token overlap between trigger and click target
      const triggerClass = session.triggerInteraction.target?.className ?? '';
      const targetClass = interaction.target?.className ?? '';
      if (triggerClass && targetClass) {
        const triggerTokens = triggerClass.toLowerCase().split(/[\s-]/).filter(t => t.length > 3);
        const targetTokens = targetClass.toLowerCase().split(/[\s-]/).filter(t => t.length > 3);
        if (triggerTokens.some(t => targetTokens.includes(t))) return true;
      }

      // No boundary evidence — this Click is outside the panel.
      // Do NOT absorb; fall through to outside-click cancellation.
    }
  }

  // ── Strategy 2: CSS class-token overlap (fallback) ─────────────────────
  // Used when the session was NOT activated by a surface-opening click
  // (e.g., activated via CSS class matching on the trigger).
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
  // Uses enhanced stepper detection: accessibleName, CSS class, and aria-label
  if (interaction.type === 'Click' && detectStepperDirection(interaction) !== null) {
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
      // Stepper/counter clicks: detect direction via accessibleName, CSS class, aria-label
      const direction = detectStepperDirection(interaction);
      if (direction === 'plus') {
        const fieldName = extractStepperFieldName(interaction);
        return { field: fieldName, value: '+1' };
      }
      if (direction === 'minus') {
        const fieldName = extractStepperFieldName(interaction);
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
