/**
 * Hover Definition — Mouse Hover (Priority 60)
 *
 * Triggers on mouseenter of an interactive element.
 * Completes after a dwell threshold (500ms) or on mouseleave.
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
import {
  HOVER_DWELL_THRESHOLD_MS,
  isInteractiveElement,
  bestName,
} from './patterns';

export const hoverDefinition: ComponentDefinition = {
  type: 'Hover',
  priority: 60,
  triggerEventTypes: new Set<BrowserEventType>(['mouseenter']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'mouseenter') return null;

    const { tag, ariaRole, className } = event.target;
    if (!isInteractiveElement(tag, ariaRole, className, null)) {
      return null;
    }

    return { type: 'Hover' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // In scope if same element AND event is relevant to the hover lifecycle.
    // CRITICAL: Exclude click/mousedown/contextmenu — these must fall through
    // to discovery so the Click definition can fire. Without this exclusion,
    // an active Hover absorbs clicks on the same element, silently losing
    // the click interaction entirely.
    const HOVER_RELEVANT_EVENTS = new Set(['mouseenter', 'mouseleave']);
    if (!HOVER_RELEVANT_EVENTS.has(event.eventType)) {
      return false;
    }
    const eventKey = `${event.target.tag}:${event.target.cssSelector}`;
    const triggerKey = `${ctx.trigger.tag}:${ctx.trigger.cssSelector}`;
    return eventKey === triggerKey;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType === 'mouseleave') {
      // Check dwell time
      const dwell = event.timestamp - ctx.startTime;
      if (dwell >= HOVER_DWELL_THRESHOLD_MS) {
        ctx.data.dwellMs = dwell;
        return { endState: 'completed' };
      }
      // Too short — abandon (not a meaningful hover)
      return { endState: 'abandoned' };
    }
    return null;
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
        dwellMs: (ctx.data.dwellMs as number) ?? 0,
      },
    };
  },
};
