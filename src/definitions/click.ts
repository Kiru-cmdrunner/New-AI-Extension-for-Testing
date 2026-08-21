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
    'click', 'contextmenu',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // Only trigger on interactive elements
    const { tag, ariaRole, className } = event.target;
    const tabIndex = event.domContext.tabIndex ?? null;

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
    return {
      metadata: {
        // S2: pass the icon class tokens so icon-only targets (<i class="icon-plus">)
        // get a derived name instead of the vacuous 'element'.
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
          ctx.trigger.className,
        ),
        targetTag: ctx.trigger.tag,
        targetRole: ctx.trigger.ariaRole,
        clientX: ctx.triggerEvent.clientX,
        clientY: ctx.triggerEvent.clientY,
      },
    };
  },
};
