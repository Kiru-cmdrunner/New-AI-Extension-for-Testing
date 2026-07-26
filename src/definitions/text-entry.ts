/**
 * TextEntry Definition — Text Input Lifecycle (Priority 50)
 *
 * Triggers on focus of a text input/textarea/contentEditable.
 * Completes on blur IF the user actually typed (userTyped=true) AND
 * the value is non-empty. Otherwise, no-op (filtered by presentation).
 *
 * Bug 4 fix: userTyped flag prevents capturing focus+blur on pre-filled
 * fields without any actual typing.
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
import { isTextEntry, bestName } from './patterns';

export const textEntryDefinition: ComponentDefinition = {
  type: 'TextEntry',
  priority: 50,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    const { tag, ariaRole, placeholder } = event.target;
    const { inputType, isContentEditable } = event.domContext;

    if (!isTextEntry(tag, inputType, ariaRole, isContentEditable)) {
      return null;
    }

    return { type: 'TextEntry' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Events on the same element are in scope
    return event.target.stableId === ctx.trigger.stableId
      || event.target.cssSelector === ctx.trigger.cssSelector;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType === 'input' || event.eventType === 'change') {
      // User typed something
      ctx.data.userTyped = true;
      ctx.data.textValue = event.valueAfter ?? '';
      return null; // still active, wait for blur
    }

    if (event.eventType === 'blur') {
      // Complete on blur — the presentation layer will filter if userTyped=false.
      // Also capture the value from the blur event as a fallback in case input
      // events were missed (autofill, paste, React controlled inputs).
      if (event.valueAfter != null && event.valueAfter !== '') {
        ctx.data.textValue = event.valueAfter;
        if (ctx.data.userTyped !== true) {
          ctx.data.userTyped = true;
        }
      }
      return { endState: 'completed' };
    }

    return null;
  },

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Only cancel on 'click' (fires AFTER blur, so the TextEntry completes
    // naturally). Never cancel on 'mousedown' — it fires BEFORE blur in the
    // browser event order (mousedown → blur → click), which would abandon
    // the TextEntry before it can complete.
    if (event.eventType === 'click') {
      const sameElement =
        event.target.stableId === ctx.trigger.stableId ||
        event.target.cssSelector === ctx.trigger.cssSelector;
      return !sameElement;
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const userTyped = ctx.data.userTyped === true;
    const textValue = (ctx.data.textValue as string) ?? '';
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    return {
      metadata: {
        targetName: name,
        textValue,
        userTyped,
      },
    };
  },
};
