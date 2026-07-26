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

export const checkboxDefinition: ComponentDefinition = {
  type: 'Checkbox',
  priority: 30,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'change']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole } = event.target;
    const { inputType } = event.domContext;

    if (isCheckbox(tag, inputType, ariaRole)) {
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
