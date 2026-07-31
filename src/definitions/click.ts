/**
 * Click Definition — Universal Fallback (Priority 180)
 *
 * Captures clicks on any interactive element that no higher-priority
 * definition claimed. This is the safety net — if nothing else matched,
 * and the element is interactive, it's a Click.
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
import { isInteractiveElement, bestName, isTextEntry } from './patterns';
import { isStepperPlus, isStepperMinus } from './dropdown';

export const clickDefinition: ComponentDefinition = {
  type: 'Click',
  priority: 180,
  triggerEventTypes: new Set<BrowserEventType>([
    'click', 'dblclick', 'contextmenu',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // Only trigger on interactive elements
    const { tag, ariaRole, className } = event.target;
    const tabIndex = null; // tabIndex not in ElementIdentity (captured in content script)

    if (!isInteractiveElement(tag, ariaRole, className, tabIndex)) {
      return null;
    }

    // Text entry fields are owned by TextEntry, not Click.
    // Click and TextEntry listen on different events (click vs focus), so
    // priority-based discovery can't prevent both from triggering. Without
    // this exclusion, every text input click produces a spurious Click
    // before the TextEntry interaction.
    if (isTextEntry(tag, event.domContext.inputType, ariaRole, event.domContext.isContentEditable)) {
      return null;
    }

    return { type: 'Click' };
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Click is immediate — no lifecycle, never in scope for subsequent events
    return false;
  },

  handleEvent(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): ComponentCompletion | null {
    // Immediate completion
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const isDoubleClick = ctx.triggerEvent.eventType === 'dblclick';
    if (isDoubleClick) {
      ctx.data.interactionSubtype = 'DoubleClick';
    }

    // Detect bare stepper clicks (standalone +/- buttons not inside a panel).
    // These produce a Click with stepper metadata so the rendering layer can
    // display them appropriately, while keeping the type system simple.
    const isStepperPlusClick = isStepperPlus(ctx.triggerEvent);
    const isStepperMinusClick = isStepperMinus(ctx.triggerEvent);
    const isStepper = isStepperPlusClick || isStepperMinusClick;

    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        targetTag: ctx.trigger.tag,
        targetRole: ctx.trigger.ariaRole,
        clientX: ctx.triggerEvent.clientX,
        clientY: ctx.triggerEvent.clientY,
        ...(isDoubleClick ? { doubleClick: true } : {}),
        ...(isStepper ? {
          isStepper: true,
          stepperDirection: isStepperPlusClick ? 'increment' : 'decrement',
        } : {}),
      },
    };
  },
};
