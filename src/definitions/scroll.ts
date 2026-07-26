/**
 * Scroll Definition — Gesture-Coalesced Scroll Capture (Priority 110)
 *
 * ARCHITECTURE CHANGE: Scroll is now a lifecycle component, not an
 * immediate-complete. A scroll burst is coalesced into a single interaction
 * by keeping the component active across consecutive scroll events.
 * The burst completes when:
 *   - A non-scroll event arrives (user started a different interaction)
 *   - The runtime flushes on navigation
 *   - MAX_LIFECYCLE_DURATION_MS elapses (timeout safety net)
 *
 * This prevents the "4 Scroll interactions for one gesture" problem where
 * each individual scroll event produced a separate interaction.
 *
 * The accumulated scroll delta is recorded as the difference between the
 * first scroll position and the last scroll position in the burst.
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

/** Maximum gap (ms) between consecutive scroll events before the burst ends. */
const SCROLL_BURST_GAP_MS = 500;

export const scrollDefinition: ComponentDefinition = {
  type: 'Scroll',
  priority: 110,
  triggerEventTypes: new Set<BrowserEventType>(['scroll']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'scroll') return null;
    return { type: 'Scroll' };
  },

  /**
   * isInScope: A scroll event is in-scope if it arrives within
   * SCROLL_BURST_GAP_MS of the last scroll event in this component.
   * This is how consecutive scroll events are coalesced into one gesture.
   *
   * Non-scroll events are never in scope (Scroll doesn't own them).
   */
  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    if (event.eventType !== 'scroll') return false;

    // Check temporal proximity — is this part of the same scroll burst?
    const lastEvent = ctx.memberEvents[ctx.memberEvents.length - 1];
    if (!lastEvent) return false;

    const gap = event.timestamp - lastEvent.timestamp;
    return gap <= SCROLL_BURST_GAP_MS;
  },

  /**
   * handleEvent: Accumulate scroll position. Never completes on a scroll
   * event — the burst continues. Completion is driven by the runtime when
   * isInScope returns false for the next event (a non-scroll or a scroll
   * after the gap), or by the stale-component timeout.
   *
   * Note: The runtime doesn't have a "complete when leaving scope" mechanism
   * built into handleEvent. Instead, when isInScope returns false for an
   * active Scroll and shouldCancelOnOutside returns false, the Scroll stays
   * on the stack. The runtime's cleanupStaleComponents will eventually flush it.
   *
   * To ensure the Scroll completes promptly when the burst ends, we use a
   * self-contained timeout approach: if the gap between the current event
   * and the last member event exceeds SCROLL_BURST_GAP_MS, complete here.
   */
  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType !== 'scroll') return null;

    // Record the latest scroll position for delta calculation
    const deltaY = event.scrollDeltaY ?? 0;
    const deltaX = event.scrollDeltaX ?? 0;
    ctx.data.lastScrollY = deltaY;
    ctx.data.lastScrollX = deltaX;

    // Keep accumulating — the burst continues
    return null;
  },

  /**
   * Never abandon on outside events — Scroll is a passive accumulator.
   * Completion happens via shouldCompleteOnOutside, timeout, or navigation flush.
   */
  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  /**
   * Complete the scroll gesture when any non-scroll event arrives.
   * This is how a scroll burst is finalized — the user moved on to a
   * different action, so the accumulated scroll delta is emitted as
   * a single completed interaction.
   */
  shouldCompleteOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return true;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    // Calculate accumulated delta: difference between first and last scroll positions
    const firstY = ctx.triggerEvent.scrollDeltaY ?? 0;
    const firstX = ctx.triggerEvent.scrollDeltaX ?? 0;
    const lastY = (ctx.data.lastScrollY as number) ?? firstY;
    const lastX = (ctx.data.lastScrollX as number) ?? firstX;

    const deltaY = lastY - firstY;
    const deltaX = lastX - firstX;

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
