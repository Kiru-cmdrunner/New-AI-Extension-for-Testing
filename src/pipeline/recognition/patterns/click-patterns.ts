/**
 * Click Patterns — Phase 4 + Phase 5b
 *
 * Ordered by specificity (most specific first):
 *   Checkbox Toggle → Radio Select → Link Click → Button Click → Generic Click
 *
 * Phase 5b additions:
 *   - Interactive element filter on GENERIC_CLICK (reject bare divs/spans)
 *   - Priority field for discovery ordering
 *
 * Decision: [ADOPTED] from v10.9.0 — Click should be the lowest-priority
 * fallback. Bare divs/spans without interactive signals are not test steps.
 */

import type { PatternDefinition } from '../../../types/foundation';

// ── Checkbox Toggle Pattern ─────────────────────────────────────────────

export const CHECKBOX_TOGGLE_PATTERN: PatternDefinition = {
  id: 'checkbox-toggle-v1',
  verb: 'toggle',
  componentType: 'Checkbox',
  confidenceThreshold: 0.7,
  priority: 130,
  description: 'User toggles a checkbox',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must be a click event',
    },
    {
      signalType: 'ariaRole',
      operator: 'equals',
      expected: 'checkbox',
      weight: 2,
      description: 'ARIA role = checkbox, switch, or native INPUT[type=checkbox]',
      anyOf: [
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'inputType:checkbox' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'switch' },
      ],
    },
    {
      signalType: 'checkedTransition',
      operator: 'exists',
      expected: null,
      weight: 1,
      description: 'Checked state must have changed',
    },
  ],
};

// ── Radio Select Pattern ────────────────────────────────────────────────

export const RADIO_SELECT_PATTERN: PatternDefinition = {
  id: 'radio-select-v1',
  verb: 'selectOption',
  componentType: 'RadioButton',
  confidenceThreshold: 0.7,
  priority: 140,
  description: 'User selects a radio button',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must be a click event',
    },
    {
      signalType: 'ariaRole',
      operator: 'equals',
      expected: 'radio',
      weight: 2,
      description: 'ARIA role = radio or native INPUT[type=radio]',
      anyOf: [
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'inputType:radio' },
      ],
    },
  ],
};

// ── Link Click Pattern ──────────────────────────────────────────────────

export const LINK_CLICK_PATTERN: PatternDefinition = {
  id: 'link-click-v1',
  verb: 'click',
  componentType: 'Link',
  confidenceThreshold: 0.7,
  priority: 120,
  description: 'User clicks a link',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must be a click event',
    },
    {
      signalType: 'ariaRole',
      operator: 'equals',
      expected: 'link',
      weight: 2,
      description: 'ARIA role = link or native <a> tag',
      anyOf: [
        { signalType: 'tag', operator: 'equals', expected: 'A' },
      ],
    },
  ],
};

// ── Button Click Pattern ────────────────────────────────────────────────

export const BUTTON_CLICK_PATTERN: PatternDefinition = {
  id: 'button-click-v1',
  verb: 'click',
  componentType: 'Button',
  confidenceThreshold: 0.7,
  priority: 110,
  description: 'User clicks a button',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must be a click event',
    },
    {
      signalType: 'ariaRole',
      operator: 'equals',
      expected: 'button',
      weight: 2,
      description: 'ARIA role = button or native BUTTON tag',
      anyOf: [
        { signalType: 'tag', operator: 'equals', expected: 'BUTTON' },
      ],
    },
  ],
};

// ── Generic Click (fallback — interactive elements only) ────────────────
//
// Decision: [ADOPTED] from v10.9.0
// The generic click pattern now requires an interactive element indicator.
// Bare <div>, <span>, <p> without ARIA roles, interactive tags, or
// interactive CSS classes are NOT matched. This prevents noise from
// non-interactive container clicks.
//
// An element is considered "interactive" if it has any of:
//   - Interactive tag: BUTTON, A, SELECT, INPUT, TEXTAREA, SUMMARY, OPTION
//   - Interactive ARIA role: button, link, combobox, checkbox, radio,
//     slider, textbox, tab, menuitem, option, switch
//   - Interactive CSS class: btn, button, clickable, etc.
//   - tabindex (checked via accessibility channel)
//
// This is implemented via an anyOf condition that checks for the presence
// of any of these signals.



export const GENERIC_CLICK_PATTERN: PatternDefinition = {
  id: 'generic-click-v1',
  verb: 'click',
  componentType: 'Generic',
  confidenceThreshold: 0.4,
  priority: 10,
  description: 'User clicks any interactive element (fallback — rejects bare divs/spans)',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must be a click event',
    },
    {
      // The element must have at least one interactive indicator.
      // We use anyOf with multiple signal types to express this declaratively.
      // If the element has an interactive tag (BUTTON, A, SELECT, etc.)
      // the 'tag' condition matches. If it has an interactive ARIA role,
      // the 'ariaRole' condition matches. If it has interactive CSS classes,
      // the 'cssClass' condition matches.
      //
      // Elements that have none of these (bare div/span/p) are rejected.
      signalType: 'tag',
      operator: 'equals',
      expected: 'BUTTON',
      weight: 1,
      description: 'Interactive tag OR interactive role OR interactive class',
      anyOf: [
        { signalType: 'tag', operator: 'equals', expected: 'A' },
        { signalType: 'tag', operator: 'equals', expected: 'SELECT' },
        { signalType: 'tag', operator: 'equals', expected: 'INPUT' },
        { signalType: 'tag', operator: 'equals', expected: 'TEXTAREA' },
        { signalType: 'tag', operator: 'equals', expected: 'SUMMARY' },
        { signalType: 'tag', operator: 'equals', expected: 'OPTION' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'button' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'link' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'combobox' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'checkbox' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'radio' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'slider' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'textbox' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'tab' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'menuitem' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'option' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'switch' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'menuitemcheckbox' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'menuitemradio' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'treeitem' },
        { signalType: 'ariaRole', operator: 'equals', expected: 'gridcell' },
        // Interactive CSS class patterns (regex via 'matches' operator)
        { signalType: 'cssClass', operator: 'matches', expected: /\b(?:btn|button|clickable|selectable|dropdown|menu-item|nav-item|tab-item|chip|toggle|action)\b/i },
      ],
    },
  ],
};

// ── Export ordered array (priority descending) ──────────────────────────

export const CLICK_PATTERNS: PatternDefinition[] = [
  CHECKBOX_TOGGLE_PATTERN,
  RADIO_SELECT_PATTERN,
  LINK_CLICK_PATTERN,
  BUTTON_CLICK_PATTERN,
  GENERIC_CLICK_PATTERN,
];
