/**
 * Lifecycle Definitions — Phase 5 + Phase 5b
 *
 * Declarative lifecycle state machine definitions for each interaction type.
 *
 * Phase 5b additions:
 *   - SCROLL_LIFECYCLE (burst coalescing)
 *   - DATE_PICKER_LIFECYCLE multi-mode completion (blur, native change)
 *   - DATE_PICKER_LIFECYCLE navigation button rejection
 *
 * Decision classification:
 *   [ADOPTED]   — proven behaviour from a reference implementation
 *   [IMPROVED]  — same intent, better implementation
 *   [REJECTED]  — reference behaviour is incorrect, we do the right thing
 */

import type { LifecycleDefinition } from './lifecycle-types';

// ── Text Entry Lifecycle ─────────────────────────────────────────────────

export const TEXT_ENTRY_LIFECYCLE: LifecycleDefinition = {
  id: 'text-entry-lifecycle',
  actionVerb: 'fill',
  componentType: 'TextInput',
  description: 'User enters text into an input field',
  activateOn: { verb: 'fill' },
  commitOn: { verb: 'fill' },
  cancelOnOutsideClick: false,
  cancelOnEscape: false,
  cancelOnNavigation: true,
  maxDurationMs: 30_000,
  rejectIfNoProgress: true,
};

// ── Dropdown Lifecycle ───────────────────────────────────────────────────

export const DROPDOWN_LIFECYCLE: LifecycleDefinition = {
  id: 'dropdown-lifecycle',
  actionVerb: 'select',
  componentType: 'DropDownListbox',
  description: 'User selects an option from a dropdown',
  activateOn: { verb: 'select', componentType: 'DropDownListbox' },
  commitOn: { verb: 'click', componentType: 'Generic' },
  cancelOnOutsideClick: true,
  cancelOnEscape: true,
  cancelOnNavigation: true,
  maxDurationMs: 10_000,
  rejectIfNoProgress: true,
};

// ── Date Picker Lifecycle ────────────────────────────────────────────────
//
// [ADOPTED] Multi-mode completion from v10.9.0 (commit 4e2f2d7):
//   - Calendar cell click (existing commitOn)
//   - Blur with typed date value (commitOnAlternatives)
//   - Native input change event (commitOnAlternatives)
// [ADOPTED] Navigation button rejection from v10.9.0:
//   prev/next/switch/today/chevron are lifecycle-internal.

export const DATE_PICKER_LIFECYCLE: LifecycleDefinition = {
  id: 'date-picker-lifecycle',
  actionVerb: 'selectDate',
  componentType: 'DatePicker',
  description: 'User selects a date from a date picker',
  activateOn: { verb: 'selectDate' },
  commitOn: { verb: 'click', componentType: 'Generic' },
  // Alternative completion modes:
  // 1. A 'fill' on the date picker input (typed date + blur)
  // 2. A 'select' on the date picker (native input change)
  commitOnAlternatives: [
    { verb: 'fill' },
    { verb: 'select', componentType: 'DatePicker' },
  ],
  cancelOnOutsideClick: true,
  cancelOnEscape: true,
  cancelOnNavigation: true,
  maxDurationMs: 10_000,
  rejectIfNoProgress: true,
  // Navigation buttons are lifecycle-internal — they sustain but never
  // commit or cancel. Clicking "Next Month" should not end the date picker
  // interaction.
  internalVerbs: ['prev', 'next', 'switch', 'today', 'chevron', 'month', 'year'],
};

// ── Slider Lifecycle ─────────────────────────────────────────────────────

export const SLIDER_LIFECYCLE: LifecycleDefinition = {
  id: 'slider-lifecycle',
  actionVerb: 'selectOption',
  componentType: 'Slider',
  description: 'User sets a slider value',
  activateOn: { verb: 'selectOption', componentType: 'Slider' },
  commitOn: { verb: 'selectOption', componentType: 'Slider' },
  cancelOnOutsideClick: false,
  cancelOnEscape: false,
  cancelOnNavigation: true,
  maxDurationMs: 10_000,
  rejectIfNoProgress: false,
};

// ── Scroll Lifecycle (Phase 5b — Burst Coalescing) ───────────────────────
//
// [ADOPTED] from v10.9.0 (scroll.ts):
//   Scroll is a lifecycle component with 500ms burst gap coalescing.
//   Multiple scroll events within the gap are part of one gesture.
//   Any non-scroll event finalizes the scroll gesture.
//   Zero-delta scroll is filtered.
//
// Implementation:
//   - activateOn: scroll (first scroll event starts the lifecycle)
//   - commitOnAnyNonMatching: true (any non-scroll event commits)
//   - burstGapMs: 500 (scroll events within 500ms extend the lifecycle)
//   - The lifecycle engine handles this specially in processResult

export const SCROLL_LIFECYCLE: LifecycleDefinition = {
  id: 'scroll-lifecycle',
  actionVerb: 'scroll',
  componentType: 'Generic',
  description: 'User scrolls the page (burst coalescing)',
  activateOn: { verb: 'scroll' },
  // commitOn is a verb that will never match — scroll commits on
  // any non-scroll event (commitOnAnyNonMatching) or on burst gap expiry.
  commitOn: { verb: '__never_match__' as any },
  commitOnAnyNonMatching: true,
  burstGapMs: 500,
  cancelOnOutsideClick: false,
  cancelOnEscape: false,
  cancelOnNavigation: true,
  maxDurationMs: 30_000,
  rejectIfNoProgress: true,
};

// ── Registry ─────────────────────────────────────────────────────────────

export const LIFECYCLE_DEFINITIONS: LifecycleDefinition[] = [
  DATE_PICKER_LIFECYCLE,
  DROPDOWN_LIFECYCLE,
  SCROLL_LIFECYCLE,
  TEXT_ENTRY_LIFECYCLE,
  SLIDER_LIFECYCLE,
];

export function getLifecycleDefinitions(): LifecycleDefinition[] {
  return [...LIFECYCLE_DEFINITIONS];
}

export function findActivatingDefinition(
  verb: string,
  componentType: string | null | undefined,
): LifecycleDefinition | undefined {
  return LIFECYCLE_DEFINITIONS.find((def) => {
    const rule = def.activateOn;
    if (rule.verb !== verb) return false;
    if (rule.componentType && componentType && rule.componentType !== componentType) {
      return false;
    }
    return true;
  });
}
