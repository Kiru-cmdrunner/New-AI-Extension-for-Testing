/**
 * Slider Definition — Range Input (Priority 25)
 *
 * Triggers on click/focus of a range input or ARIA slider.
 * Completes immediately — captures the value at click time.
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
import { isSlider, bestName } from './patterns';

export const sliderDefinition: ComponentDefinition = {
  type: 'Slider',
  priority: 25,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole } = event.target;
    const { inputType } = event.domContext;

    if (isSlider(tag, inputType, ariaRole)) {
      return { type: 'Slider' };
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
    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        value: ctx.triggerEvent.valueAfter ?? ctx.triggerEvent.valueBefore ?? null,
      },
    };
  },
};
