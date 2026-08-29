/**
 * Click Definition — Universal Fallback (Priority 180)
 *
 * Captures every trusted physical click on any target that no
 * higher-priority definition claimed — qualified at capture time by the
 * universal pre-gate (§8.1), not by element appearance here.
 *
 * Click Qualification v1.2 §8.5: the four inclusion gates
 * (isInteractiveElement → selection-surface ancestry → auto-id →
 * pointer-cursor/onclick) were the de-facto qualification authority and
 * are DELETED. Capture now says "trusted click → facts → provably
 * invalid? → Unclassified : Click". Whether an element "looks
 * interactive" is not evidence of click validity. Invalid clicks are
 * gated upstream in ComponentRuntime.process (the universal pre-gate
 * runs before tryDiscovery); qualified clicks are claimed
 * unconditionally here.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 * Click Qualification: `.drytis/specs/click-capture-qualification-v1.md` §8.5
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

export const clickDefinition: ComponentDefinition = {
  type: 'Click',
  priority: 180,
  triggerEventTypes: new Set<BrowserEventType>([
    'click', 'contextmenu',
  ]),

  detectTrigger(_event: ObservedEvent): ComponentTrigger | null {
    // Qualified at capture (§8.5) — unconditional claim.
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
