/**
 * Link Definition — Link Click (Priority 70)
 *
 * Triggers on click of an <a> tag or role=link element.
 * Completes immediately. Links are navigation triggers.
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
import { isLink, bestName } from './patterns';

export const linkDefinition: ComponentDefinition = {
  type: 'Link',
  priority: 70,
  triggerEventTypes: new Set<BrowserEventType>(['click']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole } = event.target;
    if (isLink(tag, ariaRole)) {
      return { type: 'Link' };
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
        href: null, // href not available in ElementIdentity; could be added
      },
    };
  },
};
