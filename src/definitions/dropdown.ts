/**
 * Dropdown Definition — Combobox/Select Lifecycle (Priority 20)
 *
 * Triggers on click/mousedown/focus of a combobox/listbox/select/
 * aria-haspopup element. Completes when an option is selected, Done/Apply
 * is clicked, or the surface closes.
 *
 * Multi-config support: When a dropdown panel contains multiple controls
 * (steppers, radio groups, checkboxes), the definition captures every
 * in-surface interaction as a structured SubAction. buildResult emits
 * both the flat selectedValue (backward compat) and the subActions array
 * for the presentation and generation layers.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4.2
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import {
  isDropdownTrigger,
  isDropdownOption,
  isDropdownOptionWithFallback,
  isInsideDropdownSurface,
  normalizeDisplayValue,
  bestName,
  elementKey,
} from './patterns';

// ── SubAction Model ───────────────────────────────────────────────────
// Each in-surface event is classified into one of these action types.
// The subActions array is what the generation layer expands into
// individual Playwright steps.

export type SubActionType =
  | 'selectOption'    // Click a radio/option (e.g., "Premium Economy")
  | 'increment'       // Click "+" on a stepper (e.g., Adults: 1→2)
  | 'decrement'       // Click "-" on a stepper (e.g., Adults: 2→1)
  | 'toggle'          // Toggle a checkbox
  | 'fillInput'       // Type into a text input inside the panel
  | 'confirm';        // Click Done/Apply/Confirm

export interface DropdownSubAction {
  /** What kind of action this is. */
  action: SubActionType;
  /** Human-readable label of the element acted on (e.g., "Adults", "Premium Economy"). */
  label: string;
  /** Value after the action (e.g., "2", "Premium Economy"). */
  value?: string;
  /** Original target element identity — carries locator data for the generation layer. */
  target: ObservedEvent['target'];
  /** The event that produced this subAction. */
  event: ObservedEvent;
}

// ── Done/Apply Button Detection ───────────────────────────────────────
// Keywords that identify a Done/Apply/Confirm button inside a dropdown surface.
// Clicking one of these signals the user is finished with a multi-config
// panel (passenger selector, cabin class picker, etc.).
const DONE_BUTTON_RE = /^(done|apply|confirm|ok|close|save|update|select|continue|search|done$|reset$)$/i;

/**
 * Is this click a "Done" button inside a multi-config dropdown surface?
 * Detects by accessible name, aria-label, or text content matching common
 * confirmation button labels.
 */
function isDoneButton(event: ObservedEvent): boolean {
  const name = (event.target.accessibleName || '').trim();
  const label = (event.target.ariaLabel || '').trim();
  return DONE_BUTTON_RE.test(name) || DONE_BUTTON_RE.test(label);
}

// ── Stepper Detection ─────────────────────────────────────────────────
// Steppers have +/- buttons. We detect them via multiple signals:
//   1. Word-form labels: "Increase Adults", "Add Infant", "plus", "minus"
//   2. Symbol labels: "+" or "-" (standalone or in compound like "+ Adults")
//   3. CSS class patterns: plus-icon, increment-btn, counter-plus, etc.
//
// IMPORTANT: The old regexes used \b (word boundary) around \+ and \-.
// Since + and - are non-word characters, \b+ does NOT match a standalone "+".
// This was the root cause of stepper clicks being silently dropped.

/** Match word forms of "plus/increase" AND standalone "+" symbols. */
const STEPPER_PLUS_RE = /(?:^|\s|\b)(increase|add|plus|\+)(?:\s|$|\b)/i;
const STEPPER_PLUS_SYMBOL_RE = /^\s*\+\s*$/;

/** Match word forms of "minus/decrease" AND standalone "-" symbols. */
const STEPPER_MINUS_RE = /(?:^|\s|\b)(decrease|remove|minus|less)(?:\s|$|\b)/i;
const STEPPER_MINUS_SYMBOL_RE = /(?:^|\s|\b)-(?:\s|$)/;

/** CSS class patterns for icon-only stepper buttons. */
const STEPPER_PLUS_CLASS_RE =
  /(?:plus|increment|add-btn|add-button|counter-plus|stepper-plus|pax-plus|qty-plus|btn-plus|inc-btn|increase)/i;
const STEPPER_MINUS_CLASS_RE =
  /(?:minus|decrement|remove-btn|remove-button|counter-minus|stepper-minus|pax-minus|qty-minus|btn-minus|dec-btn|decrease)/i;

/**
 * Extract a descriptive label for a stepper button from its aria-label,
 * accessible name, or CSS selector context. Looks for patterns like
 * "Increase Adults" → "Adults".
 * Falls back to inferring the field name from the CSS selector (e.g.,
 * "button.plus-adults" → "Adults") or a generic label.
 */
function extractStepperLabel(event: ObservedEvent): string {
  // Try aria-label first — "Increase Adults" → "Adults"
  const ariaLabel = event.target.ariaLabel || '';
  const fromAria = ariaLabel.replace(/\b(?:increase|decrease|add|remove|plus|minus|less|more)\b\s*/i, '').trim();
  if (fromAria) return fromAria;

  // Try accessibleName — "Add Infant" → "Infant"
  const accName = event.target.accessibleName || '';
  const fromName = accName.replace(/\b(?:increase|decrease|add|remove|plus|minus|less|more)\b\s*/i, '').trim();
  if (fromName && fromName !== '+' && fromName !== '-') return fromName;

  // Try inferring from CSS selector — "button.plus-adults" → "Adults"
  // This helps icon-only buttons that have a contextual CSS class but no aria-label
  const selector = event.target.cssSelector || '';
  const selectorMatch = selector.match(/(?:adult|child|children|infant|senior|youth|teen|pax|passenger|qty|quantity|counter|room|guest)(?:[-_a-z]*)?/i);
  if (selectorMatch) {
    const inferred = selectorMatch[0]
      .replace(/[-_]/g, ' ')
      .replace(/\b(qty|quantity|counter)\b/gi, '')
      .trim();
    if (inferred) {
      // Capitalize first letter
      return inferred.charAt(0).toUpperCase() + inferred.slice(1).toLowerCase();
    }
  }

  // Try className — "plus-btn adults-stepper" → "Adults"
  const className = event.target.className || '';
  const classMatch = className.match(/(?:adult|child|children|infant|senior|youth|teen|pax|passenger|room|guest)(?:[-_a-z]*)?/i);
  if (classMatch) {
    const inferred = classMatch[0].replace(/[-_]/g, ' ').trim();
    if (inferred) {
      return inferred.charAt(0).toUpperCase() + inferred.slice(1).toLowerCase();
    }
  }

  // Fallback: a generic label based on the action type
  return '';
}

function isStepperPlus(event: ObservedEvent): boolean {
  const label = `${event.target.accessibleName || ''} ${event.target.ariaLabel || ''}`.trim();

  // Symbol check: standalone "+" character
  if (STEPPER_PLUS_SYMBOL_RE.test(label)) return true;

  // Word form check: "increase", "add", "plus"
  if (STEPPER_PLUS_RE.test(label)) return true;

  // CSS class check (for icon-only buttons with no text/aria-label)
  const className = event.target.className || '';
  if (className && STEPPER_PLUS_CLASS_RE.test(className)) return true;

  return false;
}

function isStepperMinus(event: ObservedEvent): boolean {
  const label = `${event.target.accessibleName || ''} ${event.target.ariaLabel || ''}`.trim();

  // Symbol check: standalone "-" character
  if (STEPPER_MINUS_SYMBOL_RE.test(label)) return true;

  // Word form check: "decrease", "remove", "minus"
  if (STEPPER_MINUS_RE.test(label)) return true;

  // CSS class check (for icon-only buttons with no text/aria-label)
  const className = event.target.className || '';
  if (className && STEPPER_MINUS_CLASS_RE.test(className)) return true;

  return false;
}

/**
 * Classify an in-surface event into a SubAction.
 * Returns null if the event should not be recorded as a subAction
 * (e.g., generic clicks on non-interactive surface padding).
 */
function classifySubAction(event: ObservedEvent): DropdownSubAction | null {
  // Only classify click and change events as subActions — NOT mousedown.
  // Every real button press fires mousedown → click in sequence, so processing
  // both double-counts every interaction. In React SPAs, the element identity
  // may change between mousedown and click (re-render), which breaks dedup.
  // Using click only eliminates the duplication at the source.
  // (mousedown is still used for trigger detection / session discovery.)
  if (event.eventType !== 'click' && event.eventType !== 'change') {
    return null;
  }

  const label = bestName(
    event.target.accessibleName,
    event.target.ariaLabel,
    null,
  );

  // Done/Apply button → confirm
  if (event.eventType === 'click' && isDoneButton(event)) {
    return { action: 'confirm', label, target: event.target, event };
  }

  // Checkbox / toggle — check BEFORE stepper (ariaRole is more reliable
  // than the stepper regex which can false-positive on labels like
  // "Add insurance" matching the "add" keyword).
  if (
    event.target.ariaRole === 'checkbox' ||
    event.target.ariaRole === 'switch' ||
    event.target.tag === 'INPUT' && event.domContext.inputType === 'checkbox'
  ) {
    return {
      action: 'toggle',
      label,
      value: event.checkedAfter ? 'checked' : 'unchecked',
      target: event.target,
      event,
    };
  }

  // Stepper +/- buttons (detected by aria-label, accessible name, or CSS class)
  // This check runs BEFORE the generic click fallback to ensure icon-only
  // stepper buttons (no text, only SVG icon) are captured as increment/decrement.
  if (event.eventType === 'click') {
    if (isStepperPlus(event)) {
      // For icon-only buttons, derive a descriptive label from aria-label
      // or CSS class instead of falling through to 'element'
      const stepperLabel = extractStepperLabel(event);
      return {
        action: 'increment',
        label: stepperLabel || label !== 'element' ? (stepperLabel || label) : '+',
        value: event.valueAfter ?? undefined,
        target: event.target,
        event,
      };
    }
    if (isStepperMinus(event)) {
      const stepperLabel = extractStepperLabel(event);
      return {
        action: 'decrement',
        label: stepperLabel || label !== 'element' ? (stepperLabel || label) : '-',
        value: event.valueAfter ?? undefined,
        target: event.target,
        event,
      };
    }
  }

  // Input/change inside the panel → fillInput
  if (event.eventType === 'change' || event.eventType === 'input') {
    if (event.valueAfter && event.valueAfter.trim()) {
      return {
        action: 'fillInput',
        label,
        value: event.valueAfter,
        target: event.target,
        event,
      };
    }
  }

  // Radio button / option selection
  if (event.target.ariaRole === 'radio' ||
      event.target.ariaRole === 'option' ||
      isDropdownOption(event.target.ariaRole, event.target.className)) {
    return {
      action: 'selectOption',
      label,
      value: label,
      target: event.target,
      event,
    };
  }

  // Generic click on a labeled element inside the surface (SPA-style options)
  if (event.eventType === 'click' && label !== 'element') {
    return {
      action: 'selectOption',
      label,
      value: label,
      target: event.target,
      event,
    };
  }

  return null;
}

export const dropdownDefinition: ComponentDefinition = {
  type: 'Dropdown',
  priority: 20,
  triggerEventTypes: new Set<BrowserEventType>([
    'click', 'mousedown', 'focus',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole, className } = event.target;
    const { ariaHasPopup, inputType } = event.domContext;

    // ── Phase 0b: Behavioral signal detection (ARIA primary) ──
    // Check semantic ARIA attributes FIRST — they're the standard, reliable
    // way to identify dropdowns regardless of framework or CSS class names.
    // CSS class detection is a FALLBACK below.

    // 1. aria-haspopup="listbox" — the standard ARIA signal for a dropdown
    if (ariaHasPopup === 'listbox') {
      return { type: 'Dropdown' };
    }

    // 2. role="combobox" — standard ARIA combobox (native SELECT, custom widgets)
    if (ariaRole === 'combobox') {
      return { type: 'Dropdown' };
    }

    // 3. role="listbox" on a non-option element — a selection list
    if (ariaRole === 'listbox') {
      return { type: 'Dropdown' };
    }

    // 4. tag-based: SELECT element always triggers dropdown
    if (tag === 'SELECT') {
      return { type: 'Dropdown' };
    }

    // ── Phase 0b: CSS class detection (fallback) ──
    // Framework-specific CSS class patterns for SPAs without ARIA roles.

    // Standard CSS class trigger check (includes SELECT tag, combobox roles,
    // and framework CSS patterns)
    if (isDropdownTrigger(tag, ariaRole, className)) {
      return { type: 'Dropdown' };
    }

    // OXD-style: readonly text input with combobox wrapper
    if (tag === 'INPUT' && inputType === 'text' && event.domContext.readOnly) {
      const ancestorClasses = event.domContext.ancestorClasses.join(' ');
      if (isDropdownTrigger('', null, ancestorClasses)) {
        return { type: 'Dropdown' };
      }
    }

    // SPA-style: custom div/span with dropdown/combobox/selector class.
    // AdaniOne and similar React SPAs use div-based dropdowns without ARIA roles.
    if (tag === 'DIV' || tag === 'SPAN') {
      if (isDropdownTrigger(tag, ariaRole, className)) {
        return { type: 'Dropdown' };
      }
    }

    // Phase 0e Fix: Ancestor-based trigger detection.
    // On SPA sites, the user often clicks a child element (icon, span, label)
    // inside a dropdown trigger. The child itself lacks ARIA roles or matching
    // CSS classes, but the parent wrapper is the actual trigger.
    // Check ancestor classes for dropdown trigger patterns.
    //
    // EXCLUSION: Don't trigger a new Dropdown session for Done/Apply buttons
    // inside a dropdown surface — those should be captured by the active
    // session as confirm subActions, not start a new session.
    if (!isDoneButton(event)) {
      const ancestorClasses = event.domContext.ancestorClasses.join(' ');
      if (ancestorClasses && isDropdownTrigger('', null, ancestorClasses)) {
        return { type: 'Dropdown' };
      }
    }

    return null;
  },
  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Phase 0b + Multi-config: Surface-bound session identity with full
    // event claiming. ALL events inside the dropdown surface are claimed
    // by this session — steppers, radio buttons, checkboxes, text inputs,
    // and Done buttons. This prevents individual clicks from leaking out
    // as separate Click interactions and ensures the full compound
    // interaction is captured as one unit.

    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // Same element as trigger — always in scope
    if (eventKey === triggerKey) return true;

    // Dropdown option — in scope if inside this session's surface.
    if (isDropdownOption(event.target.ariaRole, event.target.className)) {
      if (ctx.openedSurface && event.domContext.surfaceId) {
        return event.domContext.surfaceId === ctx.openedSurface;
      }
      return true;
    }

    // Phase 0b: Surface containment check (primary path)
    // ALL events inside this session's surface are in-scope. This includes
    // steppers (+/-), radio buttons, checkboxes, text inputs, and Done/Apply
    // buttons — the Dropdown session claims the entire compound interaction.
    if (ctx.openedSurface && event.domContext.surfaceId) {
      return event.domContext.surfaceId === ctx.openedSurface;
    }

    // Fallback: CSS class-based surface detection (legacy path, no surfaceId)
    if (isInsideDropdownSurface(event.target.className) ||
        isInsideDropdownSurface(event.domContext.ancestorClasses.join(' '))) {
      // Claim all events inside the surface (steppers, options, buttons, etc.)
      return true;
    }

    // Phase 0e Fix: Done-button rescue for active multi-config sessions.
    // On many SPA sites (Adani One, etc.), the Done/Apply button lives in a
    // DOM subtree that the surface tracker can't associate with the dropdown
    // session (surfaceId mismatch, CSS class gap). When a Dropdown session
    // has accumulated subActions but hasn't been confirmed yet, and the user
    // clicks a Done/Apply/Confirm button, that click MUST be claimed by this
    // session to complete the compound interaction.
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isDoneButton(event) &&
      (ctx.data.allSelections?.length > 0 || ctx.data.subActions?.length > 0) &&
      !ctx.data.doneClicked
    ) {
      return true;
    }

    // Stepper-button rescue: icon-only +/- buttons inside a dropdown panel may
    // not carry a surfaceId (CSS-class fallback mode) and their CSS classes may
    // not match the surface patterns. But they ARE inside the panel. When a
    // Dropdown session is active, claim stepper clicks so they're captured as
    // increment/decrement subActions instead of leaking as separate Clicks.
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      (isStepperPlus(event) || isStepperMinus(event))
    ) {
      return true;
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // ── Done/Apply button → complete with all accumulated subActions ──
    // Only on click — not mousedown — to avoid completing the session
    // before the click event arrives (which would cause the click to be
    // processed as a separate Click interaction).
    if (event.eventType === 'click' && isDoneButton(event)) {
      ctx.data.doneClicked = true;
      const sub = classifySubAction(event);
      if (sub) addSubAction(ctx, sub);
      return { endState: 'completed' };
    }

    // ── Native SELECT change → complete immediately (single-select) ──
    if (event.eventType === 'change' && ctx.trigger.tag === 'SELECT') {
      ctx.data.selectedValue = event.valueAfter ?? '';
      if (!ctx.data.allSelections) ctx.data.allSelections = [];
      (ctx.data.allSelections as string[]).push(event.valueAfter ?? '');
      addSubAction(ctx, {
        action: 'selectOption',
        label: ctx.data.selectedValue,
        value: ctx.data.selectedValue,
        target: event.target,
        event,
      });
      return { endState: 'completed' };
    }

    // ── SPA change on the trigger input → complete (framework value update) ──
    if (event.eventType === 'change') {
      if (eventKey === triggerKey && event.valueAfter) {
        ctx.data.selectedValue = event.valueAfter;
        if (!ctx.data.allSelections) ctx.data.allSelections = [];
        (ctx.data.allSelections as string[]).push(event.valueAfter);
        addSubAction(ctx, {
          action: 'selectOption',
          label: event.valueAfter,
          value: event.valueAfter,
          target: event.target,
          event,
        });
        return { endState: 'completed' };
      }
    }

    // ── Skip the trigger element itself — it's the opening action, not a subAction ──
    if (eventKey === triggerKey) return null;

    // ── Classify every other in-surface event into a subAction ──
    // This captures steppers, radio options, checkboxes, text inputs —
    // everything the user does inside the panel.
    const sub = classifySubAction(event);
    if (sub) {
      addSubAction(ctx, sub);
      // Also update backward-compatible selectedValue/allSelections
      if (sub.action === 'selectOption' || sub.action === 'fillInput') {
        if (!ctx.data.allSelections) ctx.data.allSelections = [];
        (ctx.data.allSelections as string[]).push(sub.value || sub.label);
        ctx.data.selectedValue = sub.value || sub.label;
      }
    }

    // For simple dropdowns, surface closure completes the session.
    // For multi-config panels, Done/Apply or surface closure completes.
    return null; // stay active — complete on Done or surface closure
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Architecture: lifecycle abandonment is timeout-based (MAX_LIFECYCLE_DURATION_MS).
    // We do NOT abandon on DOM boundary heuristics — portal-rendered overlays
    // break those checks. The definition waits passively for completion evidence
    // (option click or change event) or the runtime timeout.
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const subActions = (ctx.data.subActions as DropdownSubAction[]) ?? [];
    const selectedValue = (ctx.data.selectedValue as string) ?? '';
    const allSelections = (ctx.data.allSelections as string[]) ?? [];
    const triggerDisplay = ctx.trigger.accessibleName || ctx.triggerEvent.valueBefore || '';
    const triggerName = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    // No-op detection: selected value matches current display value
    const normalizedSelected = normalizeDisplayValue(selectedValue);
    const normalizedDisplay = normalizeDisplayValue(triggerDisplay);
    const noOpSelection = normalizedSelected === normalizedDisplay && normalizedSelected !== '';

    // Determine if this is a multi-config panel (more than one subAction,
    // or any subAction that isn't a plain selectOption).
    const isMultiConfig = subActions.length > 1 ||
      subActions.some(s => s.action !== 'selectOption' && s.action !== 'confirm');

    return {
      metadata: {
        targetName: triggerName,
        selectedValue,
        allSelections: allSelections.length > 0 ? allSelections : [selectedValue],
        noOpSelection,
        doneClicked: ctx.data.doneClicked === true,
        // ── Compound interaction data ──
        // subActions: ordered list of every action inside the panel.
        // isMultiConfig: true when the panel has steppers/toggles/inputs
        //   (not just a single option selection).
        // These drive the timeline-renderer display and the IR bridge
        // expansion into multiple Playwright steps.
        subActions: subActions.map(s => ({
          action: s.action,
          label: s.label,
          value: s.value,
          // Preserve target identity fields needed by the enrichment layer to
          // distinguish different stepper buttons (Adults vs Children vs Infants)
          // that share the same generic label ("+").
          targetElementId: s.target?.elementId ?? undefined,
          targetCssSelector: s.target?.cssSelector ?? undefined,
          targetClassName: s.target?.className ?? undefined,
        })),
        isMultiConfig,
        // Keep raw element identities for the generation layer (locators).
        // These are NOT included in the metadata consumed by the renderer.
      },
    };
  },
};

// ── Helpers ───────────────────────────────────────────────────────────

function addSubAction(ctx: ComponentContext, sub: DropdownSubAction): void {
  if (!ctx.data.subActions) ctx.data.subActions = [];
  const subs = ctx.data.subActions as DropdownSubAction[];

  // Dedup: when both mousedown and click fire for the same target+action,
  // skip the second one. This is very common with SPA buttons (React, Angular)
  // where the event pipeline delivers mousedown → click in quick succession.
  const subEvent = sub.event;
  const subKey = sub.target?.elementId || subEvent?.target?.elementId;
  if (subKey && subEvent) {
    const last = subs[subs.length - 1];
    if (last &&
        last.action === sub.action &&
        last.target?.elementId === subKey &&
        subEvent.timestamp - (last.event?.timestamp ?? 0) < 500) {
      return; // Skip duplicate — same button, same action, within 500ms
    }
  }

  subs.push(sub);
}
