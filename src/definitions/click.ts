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
import { isInteractiveElement, bestName } from './patterns';

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
      },
    };
  },
};
