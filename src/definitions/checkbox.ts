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
  // Only trigger on click — change events are a side-effect of the click.
  // Triggering on both click and change causes double-capture when the
  // browser fires both events for the same user action.
  triggerEventTypes: new Set<BrowserEventType>(['click']),

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
    // Browsers perform pre-click activation: the checkbox's checked state
    // is toggled BEFORE the click event fires. So checkedBefore captured
    // at click time is actually the NEW state, not the old state.
    //
    // For OXD/label-wrapped checkboxes: clicking the label fires a
    // synthetic click on the hidden input. This produces two events
    // (one on the span/wrapper, one on the input). The wrapper click
    // fires first with checkedBefore=NEW state. The input click fires
    // second but is suppressed by per-type dedup (same element key
    // since both resolve to the checkbox's accessible name).
    //
    // Use checkedBefore as the NEW state directly (no negation).
    let checked: boolean;
    if (ctx.triggerEvent.checkedBefore !== null) {
      checked = ctx.triggerEvent.checkedBefore;
    } else {
      // Fallback for ARIA checkboxes without native checked state
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
