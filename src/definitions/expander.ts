/**
 * Expander Definition — Semantic Control (Priority 80)
 *
 * 7.4-B1: an expander/collapse trigger (accordion header, "More filters",
 * "View details", disclosure button) declares WHAT it is via the W3C/ARIA
 * disclosure convention: aria-expanded. The attribute is captured at event
 * time (DomContext.ariaExpanded); the flip itself is attributed to the
 * click by the evidence window (control-state-change{expanded}) — so this
 * definition needs no lifecycle. Click-shaped: immediate completion.
 *
 * Claim rule: ariaExpanded !== null — attribute-presence fact (same family
 * as W-B auto-id and 7.4-M1 computed facts). No timing, no site vocabulary.
 * Priority 80: above Link(70) so expanders never fall to the Click(180)
 * fallback; below Tab(65)/Dropdown(20) which stay their types when they
 * ALSO bear aria-expanded (desired — a role=tab with aria-expanded is a Tab).
 *
 * Replay: mapped to IRAction.CLICK — a human replays an expander by
 * clicking it; IRAction.TOGGLE is checkbox-specific (sets .checked) and
 * would be a no-op on div/button triggers. Direction lives on metadata +
 * the behavioral layer, never the IR step input.
 *
 * Spec: .drytis/specs/phase-7-4-b1-expander.md (baseline cf18d34)
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

export const expanderDefinition: ComponentDefinition = {
  type: 'Expander',
  priority: 80,
  triggerEventTypes: new Set<BrowserEventType>(['click']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // aria-expanded presence = the ARIA disclosure convention. The
    // attribute exists on button/div/role=button/pointer-styled targets
    // alike; resolution already guarantees the resolved target carries it
    // (resolveTarget lifts interactive ancestors; DomContext is extracted
    // for the resolved element). The flip direction is owned by the
    // evidence window — no lifecycle needed here.
    //
    // Presence test is BOOLEAN-VALUED, not `!== null`: old sessions and
    // partial DomContexts omit the field entirely (undefined), and
    // `undefined === null` is false — a strict-null gate would over-claim
    // them (caught by 6D.1 W3 AC-W3a runtime pin, 2026-08-24). Only an
    // actual true/false attribute value claims.
    const ariaExpanded = event.domContext.ariaExpanded;
    if (ariaExpanded !== true && ariaExpanded !== false) return null;
    return { type: 'Expander' };
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Immediate — no lifecycle, never in scope for subsequent events
    return false;
  },

  handleEvent(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): ComponentCompletion | null {
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
        // PRE-flip value at trigger time — diagnostic only. The POST-flip
        // direction lives on the behavioral layer (contract.expanded /
        // state row). Never a replay input.
        expandedAtTrigger: ctx.triggerEvent.domContext.ariaExpanded,
      },
    };
  },
};
