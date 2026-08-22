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
import { isTextEntry, bestName, elementKey } from './patterns';

export const textEntryDefinition: ComponentDefinition = {
  type: 'TextEntry',
  priority: 50,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    const { tag, ariaRole } = event.target;
    const { inputType, isContentEditable } = event.domContext;

    if (!isTextEntry(tag, inputType, ariaRole, isContentEditable)) {
      return null;
    }

    return { type: 'TextEntry' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Use elementKey() to avoid null === null false positives when both
    // elements lack ID attributes.
    return elementKey(event.target) === elementKey(ctx.trigger);
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType === 'input' || event.eventType === 'change') {
      // User typed something
      ctx.data.userTyped = true;
      ctx.data.textValue = event.valueAfter ?? '';
      // 6C dual-sample contract (spec §3): typedValue = user INTENT, sampled
      // on every input/change, NEVER overwritten by the committed blur value.
      // textValue keeps its committed semantics (blur-wins) so all existing
      // consumers are unchanged; IR fill reads typedValue ?? textValue.
      ctx.data.typedValue = event.valueAfter ?? '';
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
        // Autofill/paste-without-input: no input/change ever fired, so no
        // typed intent existed to preserve — backfill typed := committed so
        // consumers reading typedValue ?? textValue behave exactly as before
        // (typedValue ??= blurValueAfter).
        if (ctx.data.typedValue == null) {
          ctx.data.typedValue = event.valueAfter;
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
      return elementKey(event.target) !== elementKey(ctx.trigger);
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const userTyped = ctx.data.userTyped === true;
    const textValue = (ctx.data.textValue as string) ?? '';
    // 6C: typedValue = user intent (last input/change sample). Falls back to
    // committed textValue when the field was autofilled/pasted without input
    // events (backfilled at blur) — never null when textValue exists.
    const typedValue = (ctx.data.typedValue as string) ?? textValue;
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    return {
      metadata: {
        targetName: name,
        textValue,
        typedValue,
        userTyped,
      },
    };
  },
};
