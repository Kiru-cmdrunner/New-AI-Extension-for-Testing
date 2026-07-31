/**
 * NewTab Definition — Opens New Browser Tab (Priority 68)
 *
 * Triggers on click of an element that opens a new browser tab
 * (e.g., <a target="_blank">). Completes immediately.
 *
 * Phase 2: Capability gap — replaces V1 classifier's NewTab detection.
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { bestName } from './patterns';

export const newTabDefinition: ComponentDefinition = {
  type: 'NewTab',
  priority: 68,
  triggerEventTypes: new Set<BrowserEventType>(['click']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.domContext.opensNewTab === true) {
      return { type: 'NewTab' };
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
        opensNewTab: true,
        openedUrl: ctx.triggerEvent.domContext.openedUrl ?? null,
      },
    };
  },
};
