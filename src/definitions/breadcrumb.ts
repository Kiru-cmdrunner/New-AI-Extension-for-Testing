/**
 * Breadcrumb Definition — Breadcrumb Navigation (Priority 72)
 *
 * Triggers on click of an element inside a breadcrumb container.
 * Completes immediately. Breadcrumbs are navigation links showing
 * the page's location in a site hierarchy.
 *
 * Phase 2: Capability gap — replaces V1 classifier's Breadcrumb detection.
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { isBreadcrumb, bestName } from './patterns';

export const breadcrumbDefinition: ComponentDefinition = {
  type: 'Breadcrumb',
  priority: 68,
  triggerEventTypes: new Set<BrowserEventType>(['click']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { className } = event.target;
    const ancestorClasses = event.domContext.ancestorClasses ?? [];

    if (isBreadcrumb(className, ancestorClasses)) {
      return { type: 'Breadcrumb' };
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
        crumbText: ctx.trigger.accessibleName ?? null,
      },
    };
  },
};
