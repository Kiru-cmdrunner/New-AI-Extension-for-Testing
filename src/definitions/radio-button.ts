/**
 * RadioButton Definition — Radio Selection (Priority 40)
 *
 * Triggers on click/change of a radio input or ARIA radio.
 * Completes immediately.
 *
 * No-op detection: if checkedBefore=true, the radio was already selected.
 * Re-selecting an already-selected radio is a no-op.
 *
 * Bug 4 fix: checkedBefore flag detects pre-selected radios.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4.4
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { isRadio, bestName } from './patterns';

/** CSS class patterns for custom radio wrappers (OXD, MUI, etc.). */
const RADIO_WRAPPER_CLASS_RE =
  /\b(?:radio.*wrapper|radio.*input|oxd-radio|radio-input|radio-btn|custom-radio)\b/i;

export const radioButtonDefinition: ComponentDefinition = {
  type: 'RadioButton',
  priority: 40,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'change']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole, className } = event.target;
    const { inputType, ancestorClasses } = event.domContext;

    if (isRadio(tag, inputType, ariaRole)) {
      return { type: 'RadioButton' };
    }

    // Framework wrapper detection: OXD renders radios as
    // <div class="oxd-radio-wrapper"> — the click target is a
    // child div/span with no ARIA role and no inputType.
    const allClasses = (className ?? '') + ' ' + ancestorClasses.join(' ');
    if (RADIO_WRAPPER_CLASS_RE.test(allClasses)) {
      return { type: 'RadioButton' };
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
    // Radio buttons can only be turned ON by clicking — you can't uncheck
    // a radio by clicking it again. So every radio click is a real selection.
    //
    // Previous noOpSelection logic used checkedBefore, but browsers perform
    // pre-click activation: the radio's checked state is set to true BEFORE
    // the click event fires (even in capture phase). This made checkedBefore
    // always true, filtering out every radio click as a "no-op".
    //
    // Fix: noOpSelection is always false for radio buttons.
    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        noOpSelection: false,
      },
    };
  },
};
