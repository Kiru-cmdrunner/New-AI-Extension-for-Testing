/**
 * Navigation Definition — Page Navigation (Priority 120)
 *
 * Triggers on navigation events (URL change). Completes immediately.
 * The runtime also triggers a flush() on navigation events, interrupting
 * all active components.
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

export const navigationDefinition: ComponentDefinition = {
  type: 'Navigation',
  priority: 120,
  triggerEventTypes: new Set<BrowserEventType>(['navigation'] as BrowserEventType[]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType === ('navigation' as string)) {
      return { type: 'Navigation' };
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
        pageUrl: ctx.triggerEvent.pageUrl,
        pageTitle: ctx.triggerEvent.pageTitle,
      },
    };
  },
};
