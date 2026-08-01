/**
 * Slider Definition — Range Input with Drag Tracking (Priority 25)
 *
 * Captures slider interactions through three trigger paths:
 *
 * 1. Mousedown → drag: mousedown on slider handle → mousemove* → mouseup
 *    Modern ARIA sliders (MUI, AntD, RC Slider, jQuery UI) use mouse-based
 *    dragging. The definition tracks the drag, captures start/end values,
 *    and suppresses the click-after-drag.
 *
 * 2. Click (existing): click on native <input type="range"> or slider track
 *    Completes immediately with the value at click time.
 *
 * 3. Focus (existing): keyboard interaction via arrow keys
 *    Completes immediately with the adjusted value.
 *
 * ## Value Extraction Priority
 *
 * ARIA sliders expose values through DOM context:
 *   - aria-valuenow → current value (updated at each mousemove)
 *   - aria-valuemin / aria-valuemax → range bounds
 *
 * Native range inputs expose values through event valueAfter:
 *   - valueAfter reflects the new range position after input/change
 *
 * ## DragDrop Interaction
 *
 * DragDrop (priority 15) excludes `role="slider"` via EXCLUDED_ROLES and
 * `<input>` via EXCLUDED_TAGS. No conflict — DragDrop never triggers on
 * slider elements.
 *
 * Architecture: `.drytis/specs/p0-10-slider-drag.md`
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  InteractionType,
  ObservedEvent,
} from '../shared/component-types';
import { isSlider, bestName } from './patterns';

// ── Lifecycle event sets ──────────────────────────────────────────────

/**
 * Events that belong to the mousedown-drag lifecycle.
 */
const DRAG_LIFECYCLE_EVENTS = new Set<BrowserEventType>([
  'mousemove', 'mouseup', 'click',
]);

// ── Definition ────────────────────────────────────────────────────────

export const sliderDefinition: ComponentDefinition = {
  type: 'Slider',
  priority: 25,
  triggerEventTypes: new Set<BrowserEventType>(['mousedown', 'click', 'focus', 'change']),

  // ── Trigger ────────────────────────────────────────────────────────

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole, className } = event.target;
    const { inputType, ancestorClasses } = event.domContext;

    if (isSlider(tag, inputType, ariaRole, className, ancestorClasses)) {
      return { type: 'Slider' };
    }

    return null;
  },

  // ── Scope ──────────────────────────────────────────────────────────

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    const triggerType = ctx.triggerEvent.eventType;

    // Click/focus/change path: immediate completion, no extended scope
    if (triggerType === 'click' || triggerType === 'focus' || triggerType === 'change') {
      return false;
    }

    // Mousedown drag path: track mousemove/mouseup/click
    if (ctx.data.dragCompleted === true) return false;

    // Click is only in scope if a drag was detected (to suppress it)
    if (event.eventType === 'click') {
      return ctx.data.dragDetected === true;
    }

    return DRAG_LIFECYCLE_EVENTS.has(event.eventType);
  },

  // ── Handle Event ───────────────────────────────────────────────────

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    const triggerType = ctx.triggerEvent.eventType;

    // Click/focus/change path: immediate completion
    if (triggerType === 'click' || triggerType === 'focus' || triggerType === 'change') {
      return { endState: 'completed' };
    }

    // Mousedown drag path
    return handleDragEvent(event, ctx);
  },

  // ── Outside events ─────────────────────────────────────────────────

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Never cancel — slider drag should complete naturally
    return false;
  },

  shouldCompleteOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // For mousedown drag path: complete when user starts a different action
    const triggerType = ctx.triggerEvent.eventType;
    if (triggerType !== 'mousedown') return false;

    // Complete if drag was detected and user clicks elsewhere
    if (
      ctx.data.dragDetected === true &&
      (event.eventType === 'click' ||
        event.eventType === 'focus' ||
        event.eventType === 'keydown' ||
        event.eventType === 'blur')
    ) {
      return true;
    }

    // Before drag detected, complete on interactive events (treat as click)
    if (
      ctx.data.dragDetected !== true &&
      (event.eventType === 'click' ||
        event.eventType === 'focus' ||
        event.eventType === 'keydown' ||
        event.eventType === 'input' ||
        event.eventType === 'change')
    ) {
      return true;
    }

    return false;
  },

  shouldCompleteOnFlush(ctx: ComponentContext): boolean {
    // Preserve drag data on navigation flush
    return ctx.triggerEvent.eventType === 'mousedown';
  },

  downcast(ctx: ComponentContext, completion: ComponentCompletion): InteractionType | null {
    // If mousedown with no drag detected and no value change → downcast to Click
    if (
      ctx.triggerEvent.eventType === 'mousedown' &&
      ctx.data.dragDetected !== true &&
      completion.endState !== 'completed'
    ) {
      return 'Click' as InteractionType;
    }
    return null;
  },

  // ── Build Result ───────────────────────────────────────────────────

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const triggerType = ctx.triggerEvent.eventType;
    const trigger = ctx.trigger;
    const domCtx = ctx.triggerEvent.domContext;

    // Target name
    const targetName = bestName(
      trigger.accessibleName,
      trigger.ariaLabel,
      trigger.placeholder,
    );

    // Determine subtype
    const isNative = trigger.tag === 'INPUT' && domCtx.inputType === 'range';
    ctx.data.interactionSubtype = isNative ? 'NativeSlider' : 'AriaSlider';

    // ── Range Slider Detection ──
    // Dual-handle sliders expose two handles in the same container.
    // Detect via container classes with explicit range indicators.
    // Avoid matching based on the label alone ("Price Range") since
    // single-handle sliders frequently have "range" in their name.
    // Require explicit dual-handle class evidence: range-slider,
    // dual-range, multi-thumb, dual-handle.
    const sliderLabel = targetName.toLowerCase();
    const containerClasses = (domCtx.ancestorClasses ?? []).join(' ').toLowerCase();
    const DUAL_HANDLE_RE = /(?:range[-_]?slider|dual[-_]?range|dual[-_]?handle|multi[-_]?thumb|dual[-_]?slider)/i;
    const isRangeHandle =
      DUAL_HANDLE_RE.test(containerClasses) ||
      DUAL_HANDLE_RE.test(sliderLabel);
    if (isRangeHandle) {
      ctx.data.interactionSubtype = 'RangeSlider';
    }

    // Extract min/max from ARIA or native attributes
    const min = domCtx.ariaValueMin ?? domCtx.nativeMin ?? null;
    const max = domCtx.ariaValueMax ?? domCtx.nativeMax ?? null;

    // Extract values based on trigger path
    let startValue: string | null = null;
    let endValue: string | null = null;
    let sliderValue: string | null = null;

    if (triggerType === 'mousedown') {
      // Drag path: start value from trigger event, end value from mouseup event
      startValue =
        domCtx.ariaValueNow ??
        ctx.triggerEvent.valueBefore ??
        null;

      const endEvent = ctx.data.endEvent as ObservedEvent | undefined;
      if (endEvent) {
        endValue =
          endEvent.domContext.ariaValueNow ??
          endEvent.valueAfter ??
          null;
      } else {
        // Fallback: use trigger value if no mousemove/mouseup occurred
        endValue =
          domCtx.ariaValueNow ??
          ctx.triggerEvent.valueAfter ??
          startValue;
      }

      sliderValue = endValue ?? startValue;
    } else {
      // Click/focus path: single value
      sliderValue =
        domCtx.ariaValueNow ??
        ctx.triggerEvent.valueAfter ??
        ctx.triggerEvent.valueBefore ??
        null;
      startValue = sliderValue;
      endValue = sliderValue;
    }

    // ── R2: Geometry-based value fallback for custom sliders ──
    // When no ARIA or native value is available (custom div-based sliders),
    // compute a percentage from the handle's position relative to the track.
    if (sliderValue === null && domCtx.trackOffsetWidth && domCtx.trackOffsetWidth > 0) {
      const handleLeft = domCtx.targetOffsetLeft ?? 0;
      const trackLeft = domCtx.trackOffsetLeft ?? 0;
      const trackWidth = domCtx.trackOffsetWidth;
      const percent = Math.round(((handleLeft - trackLeft) / trackWidth) * 100);

      // Map to range if min/max available, otherwise use percentage directly
      if (min !== null && max !== null) {
        const minNum = Number(min);
        const maxNum = Number(max);
        if (!isNaN(minNum) && !isNaN(maxNum)) {
          sliderValue = String(minNum + (percent / 100) * (maxNum - minNum));
        } else {
          sliderValue = String(percent);
        }
      } else {
        sliderValue = String(percent);
      }

      // Mark as custom slider subtype
      ctx.data.interactionSubtype = 'CustomSlider';
      startValue = sliderValue;
      endValue = sliderValue;
    }

    return {
      metadata: {
        targetName,
        sliderValue,
        startValue,
        endValue,
        min,
        max,
        ariaValueText: domCtx.ariaValueText ?? null,
        dragTracked: triggerType === 'mousedown' && ctx.data.dragDetected === true,
      },
    };
  },
};

// ── Drag Event Handler ────────────────────────────────────────────────

/**
 * Process a mousedown-drag lifecycle event for the slider.
 *
 * Lifecycle:
 *   mousedown (trigger) → mousemove* → mouseup → click (suppressed)
 *
 * On mousemove: mark drag as detected, track latest value via domContext.
 * On mouseup: capture end value, stay active to consume click.
 * On click: complete (suppress the spurious click after drag).
 */
function handleDragEvent(
  event: ObservedEvent,
  ctx: ComponentContext,
): ComponentCompletion | null {
  switch (event.eventType) {
    case 'mousemove': {
      // Mark that a drag is happening
      ctx.data.dragDetected = true;

      // Track the latest event for value extraction
      ctx.data.endEvent = event;

      return null; // drag continues
    }

    case 'mouseup': {
      // Capture the end value from this event's DOM context
      ctx.data.endEvent = event;

      // If drag was detected, wait for the click event to complete
      // (suppresses the click-after-drag)
      if (ctx.data.dragDetected === true) {
        return null; // wait for click
      }

      // No mousemove between mousedown and mouseup — it's a click on the slider
      return { endState: 'completed' };
    }

    case 'click': {
      if (ctx.data.dragDetected === true) {
        // Click-after-drag — consume it and complete
        ctx.data.consumedClick = true;
        ctx.data.dragCompleted = true;
        return { endState: 'completed' };
      }

      // Click without prior drag — complete immediately
      ctx.data.dragCompleted = true;
      return { endState: 'completed' };
    }

    default:
      return null;
  }
}
