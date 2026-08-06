/**
 * Slider Definition — Range Input Lifecycle (Priority 25)
 *
 * Triggers on focus of a range input or ARIA slider.
 * Completes on blur IF the user actually adjusted the value (userAdjusted=true).
 * Otherwise, no-op (filtered by presentation layer via isProductionInteraction).
 *
 * Lifecycle mirrors TextEntry:
 *   focus (trigger) → input/change (accumulate value) → blur (complete)
 *
 * This captures the final committed slider value regardless of adjustment
 * method (mouse drag, click-to-set, or keyboard arrows).
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 * M0.5 Fix: G7 — stale value on mouse drag, keyboard adjustment, click-to-set.
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { isSlider, bestName, elementKey } from './patterns';

export const sliderDefinition: ComponentDefinition = {
  type: 'Slider',
  priority: 25,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    const { tag, ariaRole } = event.target;
    const { inputType } = event.domContext;

    if (isSlider(tag, inputType, ariaRole)) {
      return { type: 'Slider' };
    }

    return null;
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Use elementKey() to avoid null === null false positives.
    return elementKey(event.target) === elementKey(ctx.trigger);
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType === 'input' || event.eventType === 'change') {
      // User adjusted the slider — track the latest value
      ctx.data.userAdjusted = true;
      ctx.data.finalValue = event.valueAfter ?? null;
      return null; // still active, wait for blur
    }

    if (event.eventType === 'blur') {
      // Fallback: if we missed input/change events, check whether the blur
      // value differs from the original. Only infer adjustment when we can
      // confirm a value change (prevents focus-only traversal from being
      // mistaken for an adjustment).
      if (event.valueAfter != null) {
        ctx.data.finalValue = event.valueAfter;
        if (ctx.data.userAdjusted !== true) {
          const originalValue = ctx.triggerEvent.valueBefore;
          if (originalValue != null && event.valueAfter !== originalValue) {
            ctx.data.userAdjusted = true;
          }
        }
      }
      return { endState: 'completed' };
    }

    // Other events on same element (click, etc.) are consumed but ignored
    return null;
  },

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // A click on a DIFFERENT element means the user moved on.
    // Use elementKey() to correctly detect different elements when IDs are absent.
    if (event.eventType === 'click') {
      return elementKey(event.target) !== elementKey(ctx.trigger);
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const userAdjusted = ctx.data.userAdjusted === true;
    const finalValue = (ctx.data.finalValue as string | null) ?? null;

    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        value: finalValue ?? ctx.triggerEvent.valueBefore ?? null,
        userAdjusted,
      },
    };
  },
};
