/**
 * ColorInput Definition — Native Color Picker (Priority 15)
 *
 * Triggers on focus of an <input type="color">.
 * Completes on blur IF the user actually changed the color (userAdjusted=true).
 * Otherwise, no-op (filtered by presentation layer via isProductionInteraction).
 *
 * Lifecycle mirrors Slider (M0.5 G7):
 *   focus (trigger) → input/change (accumulate value) → blur (complete)
 *
 * Value comparison: userAdjusted is only set when finalValue !== triggerValueBefore.
 * This prevents:
 *   - Focus-only traversal (user tabbed through without selecting)
 *   - Same-color re-selection (user opened picker but chose same color)
 *   - Cancel (user opened picker and clicked cancel — no change event fires)
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 * Pre-Capability Completeness: G8 — color input value capture
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

const COLOR_LIFECYCLE_EVENTS = new Set<BrowserEventType>([
  'input', 'change', 'blur',
]);

export const colorInputDefinition: ComponentDefinition = {
  type: 'ColorInput',
  priority: 15,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    if (event.target.tag === 'INPUT' && event.domContext.inputType === 'color') {
      return { type: 'ColorInput' };
    }

    return null;
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    if (!COLOR_LIFECYCLE_EVENTS.has(event.eventType)) return false;

    return event.target.stableId === ctx.trigger.stableId
      || event.target.cssSelector === ctx.trigger.cssSelector;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    const originalValue = ctx.triggerEvent.valueBefore;

    if (event.eventType === 'input' || event.eventType === 'change') {
      // Only mark as adjusted if value actually differs from original
      if (event.valueAfter != null && event.valueAfter !== originalValue) {
        ctx.data.userAdjusted = true;
        ctx.data.finalValue = event.valueAfter;
      }
      return null;
    }

    if (event.eventType === 'blur') {
      // Fallback: if input/change events were missed, check at blur time
      if (event.valueAfter != null) {
        ctx.data.finalValue = event.valueAfter;
        if (ctx.data.userAdjusted !== true && originalValue != null && event.valueAfter !== originalValue) {
          ctx.data.userAdjusted = true;
        }
      }
      return { endState: 'completed' };
    }

    return null;
  },

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    if (event.eventType === 'click') {
      const sameElement =
        event.target.stableId === ctx.trigger.stableId ||
        event.target.cssSelector === ctx.trigger.cssSelector;
      return !sameElement;
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const userAdjusted = ctx.data.userAdjusted === true;
    const finalValue = (ctx.data.finalValue as string | null) ?? null;

    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        value: finalValue ?? ctx.triggerEvent.valueBefore ?? null,
        userAdjusted,
      },
    };
  },
};
