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

export const radioButtonDefinition: ComponentDefinition = {
  type: 'RadioButton',
  priority: 40,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'change']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole } = event.target;
    const { inputType } = event.domContext;

    if (isRadio(tag, inputType, ariaRole)) {
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
    // No-op detection: if the radio was already checked before the click,
    // this is a re-selection of an already-selected option.
    // Bug 4 fix: checkedBefore detects pre-selected radios.
    const noOpSelection = ctx.triggerEvent.checkedBefore === true;

    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        noOpSelection,
      },
    };
  },
};
