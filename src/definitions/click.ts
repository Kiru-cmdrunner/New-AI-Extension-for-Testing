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
import {
  isInteractiveElement,
  bestName,
  isInsideOpenSelectionSurface,
} from './patterns';

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
      // S6/LP1: last-resort gate — a target with no interactive signal of
      // its own is still a deliberate selection click when it sits inside an
      // OPEN selection surface (listbox/menu/grid/dialog ancestor, or a
      // popover/modal/flyout-class ancestor). Pointer events cannot reach
      // descendants of a closed surface, so ancestry at click time is a
      // structural DOM-state fact (no timing rule). This is scoped to the
      // Click definition only — isInteractiveElement is untouched.
      if (!isInsideOpenSelectionSurface(
        event.domContext.ancestorRoles,
        event.domContext.ancestorClasses,
      )) {
        // 7.3 W-B: QA-instrumented target gate. A target bearing an auto-id
        // (either industry spelling) is a deliberate test target by the app
        // author's own instrumentation — attribute-presence fact, no timing,
        // no site vocabulary. Truthy check: empty strings claim nothing
        // (honest absence — matches the identity layer's ''→null
        // normalization, and stays safe against raw '' fields).
        // Scoped to the Click definition — isInteractiveElement untouched.
        if (
          !event.target.autoId &&
          !event.target.dataAutoId
        ) {
          // 7.4-M1: affordance gate. A target the app itself declares
          // clickable — cursor:pointer computed style (the platform's own
          // affordance declaration) or an onclick attribute — is a deliberate
          // click target by DOM/computed-state fact at event time. No timing,
          // no site vocabulary, no statistics. Truthiness: undefined
          // (pre-7.4 persisted sessions) stays inert.
          // Scoped to the Click definition — isInteractiveElement untouched.
          if (
            !event.domContext.pointerCursor &&
            !event.domContext.clickHandler
          ) {
            return null;
          }
        }
      }
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
