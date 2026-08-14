/**
 * DragDrop Definition — Drag & Drop Lifecycle (Priority 5)
 *
 * Triggers on `dragstart`. Completes on `drop`.
 * If no `drop` arrives within the lifecycle timeout, the interaction
 * is abandoned by the runtime's standard timeout mechanism.
 *
 * M9.10
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { bestName, elementKey } from './patterns';

export const dragDropDefinition: ComponentDefinition = {
  type: 'DragDrop',
  priority: 5,
  triggerEventTypes: new Set<BrowserEventType>(['dragstart']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'dragstart') return null;

    // Any trusted dragstart on any element is a drag interaction.
    // We don't restrict by tag/role — drag targets can be anything.
    return { type: 'DragDrop' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // The lifecycle is in scope for:
    // 1. Events on the same element (repeated dragstart, dragend)
    // 2. The drop event — on any element (drop target differs from source)
    if (event.eventType === 'drop') return true;

    // Events on the drag source element
    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);
    if (eventKey === triggerKey) return true;

    return false;
  },

  handleEvent(
    event: ObservedEvent,
    ctx: ComponentContext,
  ): ComponentCompletion | null {
    // drop event completes the drag
    if (event.eventType === 'drop') {
      ctx.data.dropTarget = event.target;
      ctx.data.dropTargetName = bestName(
        event.target.accessibleName,
        event.target.ariaLabel,
      );

      // File-drop metadata is captured by the legacy recorder and enriched
      // separately — the Component Runtime's DomContext doesn't carry it.
      // The buildResult reads whatever's in ctx.data.
      return { endState: 'completed' };
    }

    // Another dragstart on same element — still dragging
    if (event.eventType === 'dragstart') {
      const eventKey = elementKey(event.target);
      const triggerKey = elementKey(ctx.trigger);
      if (eventKey === triggerKey) {
        return null;
      }
    }

    return null;
  },

  shouldCancelOnOutside(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const sourceName = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
    );
    const dropTarget = ctx.data.dropTarget as { tag: string; ariaRole: string | null; accessibleName: string; ariaLabel: string | null } | undefined;
    const dropTargetName = (ctx.data.dropTargetName as string) ?? '';

    return {
      metadata: {
        sourceName,
        sourceTag: ctx.trigger.tag,
        sourceRole: ctx.trigger.ariaRole,
        dropTargetName,
        dropTargetTag: dropTarget?.tag ?? null,
        dropTargetRole: dropTarget?.ariaRole ?? null,
      },
    };
  },
};
