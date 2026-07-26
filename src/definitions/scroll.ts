/**
 * Scroll Definition — Scroll Capture (Priority 110)
 *
 * Triggers on scroll events. Completes immediately with the scroll
 * position. Non-zero delta required for production output (Bug 5 fix).
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4.5
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { hasScrollDelta } from './patterns';

export const scrollDefinition: ComponentDefinition = {
  type: 'Scroll',
  priority: 110,
  triggerEventTypes: new Set<BrowserEventType>(['scroll']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'scroll') return null;
    // Capture all scroll events — the presentation layer filters 0px
    return { type: 'Scroll' };
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
    const deltaY = ctx.triggerEvent.scrollDeltaY ?? 0;
    const deltaX = ctx.triggerEvent.scrollDeltaX ?? 0;

    return {
      metadata: {
        scrollDeltaY: deltaY,
        scrollDeltaX: deltaX,
        hasDelta: hasScrollDelta(deltaY, deltaX),
        pageUrl: ctx.triggerEvent.pageUrl,
      },
    };
  },
};
