/**
 * Checkbox Definition — Checkbox Toggle (Priority 30)
 *
 * Triggers on click/change of a checkbox input or ARIA checkbox/switch.
 * Completes immediately — toggles always count as interactions.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { isCheckbox, bestName } from './patterns';

/** CSS class patterns for custom checkbox wrappers (OXD, MUI, etc.). */
const CHECKBOX_WRAPPER_CLASS_RE =
  /\b(?:checkbox.*wrapper|checkbox.*input|oxd-checkbox|checkbox-input|custom-checkbox)\b/i;

export const checkboxDefinition: ComponentDefinition = {
  type: 'Checkbox',
  priority: 30,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'change']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole, className } = event.target;
    const { inputType, ancestorClasses } = event.domContext;

    if (isCheckbox(tag, inputType, ariaRole)) {
      return { type: 'Checkbox' };
    }

    // Framework wrapper detection: OXD renders checkboxes as
    // <div class="oxd-checkbox-wrapper"> — the click target is a
    // child div/span with no ARIA role and no inputType.
    const allClasses = (className ?? '') + ' ' + ancestorClasses.join(' ');
    if (CHECKBOX_WRAPPER_CLASS_RE.test(allClasses)) {
      return { type: 'Checkbox' };
    }

    return null;
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false; // immediate completion
  },

  handleEvent(_event: ObservedEvent, _ctx: ComponentContext): ComponentCompletion | null {
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    // Determine checked state AFTER the click
    // For a checkbox, checkedAfter from the change event is the new state.
    // If we only have a click event, checkedBefore is the OLD state,
    // so the new state is the negation.
    let checked: boolean;
    if (ctx.triggerEvent.checkedAfter !== null) {
      checked = ctx.triggerEvent.checkedAfter;
    } else if (ctx.triggerEvent.checkedBefore !== null) {
      checked = !ctx.triggerEvent.checkedBefore;
    } else {
      // ARIA checkbox — check aria-pressed or default to true
      checked = true;
    }

    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        checked,
      },
    };
  },
};
