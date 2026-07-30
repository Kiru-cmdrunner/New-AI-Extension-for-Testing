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
// Steppers have +/- buttons. We detect them by aria-label patterns.

const STEPPER_PLUS_RE = /\b(increase|add|plus|\+)\b/i;
const STEPPER_MINUS_RE = /\b(decrease|remove|minus|less|-)\b/i;

function isStepperPlus(event: ObservedEvent): boolean {
  const label = `${event.target.accessibleName} ${event.target.ariaLabel || ''}`;
  return STEPPER_PLUS_RE.test(label);
}

function isStepperMinus(event: ObservedEvent): boolean {
  const label = `${event.target.accessibleName} ${event.target.ariaLabel || ''}`;
  return STEPPER_MINUS_RE.test(label);
}

/**
 * Classify an in-surface event into a SubAction.
 * Returns null if the event should not be recorded as a subAction
 * (e.g., generic clicks on non-interactive surface padding).
 */
function classifySubAction(event: ObservedEvent): DropdownSubAction | null {
  if (event.eventType !== 'click' && event.eventType !== 'mousedown' && event.eventType !== 'change') {
    return null;
  }

  const label = bestName(
    event.target.accessibleName,
    event.target.ariaLabel,
    null,
  );

  // Done/Apply button → confirm
  if ((event.eventType === 'click' || event.eventType === 'mousedown') && isDoneButton(event)) {
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

  // Stepper +/- buttons (detected by aria-label patterns)
  if (event.eventType === 'click' || event.eventType === 'mousedown') {
    if (isStepperPlus(event)) {
      return {
        action: 'increment',
        label,
        value: event.valueAfter ?? undefined,
        target: event.target,
        event,
      };
    }
    if (isStepperMinus(event)) {
      return {
        action: 'decrement',
        label,
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
  if ((event.eventType === 'click' || event.eventType === 'mousedown') && label !== 'element') {
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

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // ── Done/Apply button → complete with all accumulated subActions ──
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isDoneButton(event)
    ) {
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
  (ctx.data.subActions as DropdownSubAction[]).push(sub);
}
