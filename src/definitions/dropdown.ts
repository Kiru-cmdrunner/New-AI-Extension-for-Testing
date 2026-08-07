/**
 * Dropdown Definition — Combobox/Select Lifecycle (Priority 20)
 *
 * Triggers on click/mousedown/focus of a combobox/listbox/select/
 * aria-haspopup element. Completes when an option is selected.
 *
 * No-op detection: if the selected option's display name matches the
 * trigger's current display value (normalized), it's a no-op — the user
 * opened the dropdown and selected the already-selected option.
 *
 * Bug 2 fix: uses `||` not `??` for accessibleName/valueBefore comparison.
 * OXD combobox inputs have accessibleName='' (empty string), and `??`
 * doesn't fall through on empty strings.
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
  isInsideDropdownSurface,
  normalizeDisplayValue,
  bestName,
  elementKey,
} from './patterns';

export const dropdownDefinition: ComponentDefinition = {
  type: 'Dropdown',
  priority: 20,
  triggerEventTypes: new Set<BrowserEventType>([
    'click', 'mousedown', 'focus',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole, className } = event.target;
    const { ariaHasPopup, inputType } = event.domContext;

    // Standard dropdown triggers
    if (isDropdownTrigger(tag, ariaRole, className)) {
      return { type: 'Dropdown' };
    }

    // aria-haspopup="listbox" on any element
    if (ariaHasPopup === 'listbox') {
      return { type: 'Dropdown' };
    }

    // OXD-style: readonly text input with combobox wrapper
    if (tag === 'INPUT' && inputType === 'text' && event.domContext.readOnly) {
      // Check ancestor classes for combobox patterns
      const ancestorClasses = event.domContext.ancestorClasses.join(' ');
      if (isDropdownTrigger('', null, ancestorClasses)) {
        return { type: 'Dropdown' };
      }
    }

    return null;
  },

  // Capture surface role from aria-haspopup for ownership testing.
  // detectTrigger returns ComponentTrigger (not ctx), so surfaceRole is
  // captured in handleEvent when the first in-scope event arrives.
  // The runtime's lifecycleOwnsTarget() reads ctx.data.surfaceRole.

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // In scope if:
    // 1. Event is on the trigger element itself
    // 2. Event is on a dropdown option
    // 3. Event is inside the dropdown surface AND is not on an interactive
    //    element that has its own definition (e.g., a stepper +/- button
    //    inside a passenger selector popover). Those clicks must fall through
    //    to Click discovery so they're not swallowed.

    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // Same element as trigger
    if (eventKey === triggerKey) return true;

    // Dropdown option — always in scope (this is the selection event)
    if (isDropdownOption(event.target.ariaRole, event.target.className)) {
      return true;
    }

    // Inside dropdown surface — but NOT if the event target is itself an
    // interactive element (button, link, etc.) with its own clear identity.
    // This prevents the dropdown from swallowing clicks on stepper buttons,
    // filter controls, and other interactive elements rendered inside
    // popover/modal surfaces.
    if (isInsideDropdownSurface(event.target.className) ||
        isInsideDropdownSurface(event.domContext.ancestorClasses.join(' '))) {
      // Let clearly interactive elements (buttons, links, checkboxes, etc.)
      // fall through to their own definitions instead of being claimed here
      const { tag, ariaRole } = event.target;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
          ariaRole === 'button' || ariaRole === 'link' || ariaRole === 'checkbox' ||
          ariaRole === 'radio' || ariaRole === 'spinbutton' || ariaRole === 'slider') {
        return false; // let Click/Checkbox/etc. definition claim it
      }
      return true;
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Capture surfaceRole from the trigger's aria-haspopup.
    // Used by runtime's lifecycleOwnsTarget() for positive ownership testing.
    if (!ctx.data.surfaceRole) {
      ctx.data.surfaceRole =
        ctx.triggerEvent.domContext.ariaHasPopup === 'listbox' ? 'listbox' : null;
    }

    // Option click/mousedown → complete
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isDropdownOption(event.target.ariaRole, event.target.className)
    ) {
      ctx.data.selectedValue = event.target.accessibleName
        || event.target.ariaLabel
        || '';
      return { endState: 'completed' };
    }

    // Native SELECT change → complete
    if (event.eventType === 'change' && ctx.trigger.tag === 'SELECT') {
      ctx.data.selectedValue = event.valueAfter ?? '';
      return { endState: 'completed' };
    }

    // Click on trigger again (toggle close without selecting) → still active
    if (event.eventType === 'click' || event.eventType === 'mousedown') {
      const eventKey = elementKey(event.target);
      const triggerKey = elementKey(ctx.trigger);
      if (eventKey === triggerKey) return null; // still active
    }

    return null;
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Architecture: lifecycle abandonment is timeout-based (MAX_LIFECYCLE_DURATION_MS).
    // We do NOT abandon on DOM boundary heuristics — portal-rendered overlays
    // break those checks. The definition waits passively for completion evidence
    // (option click or change event) or the runtime timeout.
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const selectedValue = (ctx.data.selectedValue as string) ?? '';
    const triggerDisplay = ctx.trigger.accessibleName || ctx.triggerEvent.valueBefore || '';
    const triggerName = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    // No-op detection: selected value matches current display value
    // Bug 2 fix: using || not ?? for accessibleName/valueBefore comparison
    const normalizedSelected = normalizeDisplayValue(selectedValue);
    const normalizedDisplay = normalizeDisplayValue(triggerDisplay);
    const noOpSelection = normalizedSelected === normalizedDisplay && normalizedSelected !== '';

    return {
      metadata: {
        targetName: triggerName,
        selectedValue,
        noOpSelection,
      },
    };
  },

  // W3C-standard semantic children for ownership testing.
  // Only role="option" and native <option> are recognized as dropdown items.
  semanticChildRoles: ['option'],
  semanticChildTags: ['OPTION'],
};
