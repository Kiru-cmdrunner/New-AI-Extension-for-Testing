/**
 * Drag and Drop Definition — Mouse-Based and HTML5 DnD (Priority 15)
 *
 * Captures drag-and-drop interactions via two paths:
 *
 * 1. Mouse-based (primary): mousedown → mousemove* → mouseup
 *    Modern web apps (react-beautiful-dnd, @dnd-kit, SortableJS, interact.js)
 *    use mouse/touch-based dragging rather than the HTML5 DnD API.
 *    The definition triggers on mousedown, tracks displacement via mousemove,
 *    and classifies the gesture: displacement ≥ threshold → drag, < threshold →
 *    discard (let Click handle it as a normal click).
 *
 * 2. HTML5 DnD (secondary): dragstart → drop
 *    Some apps use the native HTML5 drag-and-drop API (draggable="true").
 *    These events don't produce click events, so no dedup is needed.
 *
 * ## Click-After-Drag Suppression
 *
 * Mouse interactions fire: mousedown → mouseup → click.
 * After a drag is detected (mouseup with displacement ≥ threshold), the
 * DragDrop component stays active to consume the subsequent click event.
 * This prevents a spurious "Click" interaction from being recorded.
 *
 * If displacement < threshold on mouseup → discard immediately. The
 * subsequent click is NOT consumed and creates a normal Click interaction.
 *
 * Architecture: `.drytis/specs/p0-3-drag-and-drop.md`
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
import type { ElementIdentity } from '../shared/types';
import { bestName, isInteractiveElement, isDropdownTrigger, isTextEntry, isSliderHandleClass } from './patterns';

// ── Excluded elements ──────────────────────────────────────────────────

/**
 * Tags that are always handled by other definitions. DragDrop must not
 * intercept mousedown on these — they're form controls, not draggables.
 */
const EXCLUDED_TAGS = new Set([
  'SELECT', 'TEXTAREA',
  'INPUT', // checkboxes, radios, sliders, text fields — all have own defs
  'A',     // links are click-activated; HTML5 dragstart still captures genuine drags
  'BUTTON', // buttons are click-activated; same reasoning
]);

/**
 * ARIA roles handled by other definitions (Dropdown, DatePicker, etc.).
 * Includes roles for click-activated elements (link, button, menuitem, tab,
 * treeitem) — these have their own semantic definitions and should never be
 * claimed by DragDrop on mousedown. If genuinely draggable, dragstart fires.
 */
const EXCLUDED_ROLES = new Set([
  'combobox', 'listbox', 'slider', 'checkbox', 'radio', 'switch',
  'textbox', 'spinbutton',
  'link', 'button', 'menuitem', 'tab', 'treeitem', 'option',
]);

/**
 * CSS class patterns that indicate a drag handle — an element specifically
 * designed to be grabbed for drag-and-drop, even if it also has an
 * interactive role like role="button" or role="gridcell".
 *
 * When detected, the element is allowed through the DragDrop trigger gate
 * even if it would normally be excluded as an interactive element.
 * (Expanded validation finding GROUP-A, CI-01.)
 */
const DRAG_HANDLE_CLASS_RE = /(?:^|\s)(?:drag[-_]?(?:handle|grip|grab)|sortable[-_]?(?:handle|item)|dnd[-_]?handle|resiz(?:e|able)[-_]?(?:handle|grip)|grip[-_]?handle|move[-_]?handle|handlebar)(?:\s|$)/i;

/**
 * Should this element be excluded from mouse-based DragDrop triggering?
 * Returns true for:
 * - Form controls (INPUT, SELECT, TEXTAREA) — have own definitions
 * - Click-activated semantic elements (A, BUTTON) — their mousedown→click
 *   sequence is handled by Click/Link; a genuine drag still fires dragstart
 *   via Path 2 (HTML5 DnD), so nothing is lost
 * - ARIA roles owned by other definitions
 *
 * Exclusion is on mousedown only. dragstart always triggers DragDrop
 * regardless of element type (Path 2 in detectTrigger).
 */
function isExcluded(
  tag: string,
  ariaRole: string | null,
  ariaHasPopup: string | null,
  className?: string | null,
): boolean {
  if (EXCLUDED_TAGS.has(tag)) return true;
  if (ariaRole && EXCLUDED_ROLES.has(ariaRole)) return true;
  // Dropdown trigger (aria-haspopup=listbox) — let Dropdown handle it
  if (ariaHasPopup === 'listbox' || ariaHasPopup === 'dialog' || ariaHasPopup === 'true') return true;
  // Slider handle CSS classes — let Slider definition handle it (priority 25 > DragDrop 15)
  if (className && isSliderHandleClass(className)) return true;
  return false;
}

// ── Thresholds ────────────────────────────────────────────────────────

/**
 * Minimum pointer displacement (Euclidean distance, pixels) between the
 * mousedown position and the mouseup position to classify as a drag.
 *
 * Below this, the gesture is a click — discard DragDrop and let Click
 * handle it normally.
 */
const MIN_DRAG_DISPLACEMENT_PX = 10;

// ── Lifecycle event sets ──────────────────────────────────────────────

/**
 * Events that belong to the mouse-drag lifecycle.
 */
const MOUSE_DRAG_EVENTS = new Set<BrowserEventType>([
  'mousemove', 'mouseup', 'click',
]);

/**
 * Events that belong to the HTML5 DnD lifecycle.
 */
const HTML5_DND_EVENTS = new Set<BrowserEventType>([
  'dragover', 'drop', 'dragend', 'click',
]);

// ── Definition ────────────────────────────────────────────────────────

export const dragAndDropDefinition: ComponentDefinition = {
  type: 'DragDrop',
  priority: 15,
  triggerEventTypes: new Set<BrowserEventType>(['mousedown', 'dragstart']),

  // ── Trigger ────────────────────────────────────────────────────────

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // Path 1: Mouse-based drag starts on mousedown
    if (event.eventType === 'mousedown') {
      // Exclude form controls, semantic elements, and ANY interactive element.
      // Interactive elements (buttons, links, dropdown triggers, etc.) are
      // click-activated. The browser fires mousedown → mouseup → click for
      // these; if DragDrop claims the mousedown and discards on mouseup (no
      // drag), its downcast to Click creates a duplicate when the subsequent
      // click event also discovers the real interaction (Dropdown, Click, etc.).
      // Genuinely draggable elements still fire dragstart → Path 2.
      const { tag, ariaRole, className } = event.target;
      const { ariaHasPopup, inputType, isContentEditable } = event.domContext;
      const ancestorClasses = event.domContext.ancestorClasses.join(' ');
      
      // Drag handles: elements with drag-handle CSS class patterns are always
      // allowed through, even if they have interactive roles like role="button"
      // or are excluded as form controls. These elements are designed for
      // dragging AND may have a click fallback, but the DragDrop definition's
      // displacement check (> 10px) will correctly discard non-drag mousedowns.
      // (Expanded validation finding GROUP-A, CI-01.)
      const allClasses = `${className ?? ''} ${ancestorClasses}`;
      const isDragHandle = DRAG_HANDLE_CLASS_RE.test(allClasses);

      if (!isDragHandle && isExcluded(tag, ariaRole, ariaHasPopup, className)) {
        return null;
      }
      // Interactive elements (CSS class patterns like btn, dropdown, option,
      // etc.) are handled by their own definitions on click — UNLESS the element
      // is a drag handle, in which case DragDrop claims it.
      if (!isDragHandle && isInteractiveElement(tag, ariaRole, className, null)) {
        return null;
      }
      // Dropdown triggers (CSS class patterns like dropdown, select, combobox)
      // — even if not in INTERACTIVE_CLASS_RE, isDropdownTrigger checks a
      // broader set of patterns and ancestor classes.
      if (isDropdownTrigger(tag, ariaRole, className) ||
          (ancestorClasses && isDropdownTrigger('', null, ancestorClasses))) {
        return null;
      }
      // Text entry fields — owned by TextEntry definition.
      if (isTextEntry(tag, inputType, ariaRole, isContentEditable)) {
        return null;
      }
      return { type: 'DragDrop' };
    }

    // Path 2: HTML5 DnD starts on dragstart
    if (event.eventType === 'dragstart') {
      return { type: 'DragDrop' };
    }

    return null;
  },

  // ── Scope ──────────────────────────────────────────────────────────

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Determine drag method from trigger event type (set once, stable)
    const isHtml5 = ctx.triggerEvent.eventType === 'dragstart';

    if (isHtml5) {
      // After the drag is completed/cancelled, stop claiming events
      if (ctx.data.dragCompleted === true) return false;
      return HTML5_DND_EVENTS.has(event.eventType);
    }

    // Mouse-based drag:
    // - mousemove/mouseup: always in scope during drag lifecycle
    // - click: ONLY in scope when drag was actually detected (displacement ≥ threshold).
    //   This ensures clicks on non-dragged elements fall through to Click/Dropdown/etc.
    //   When drag IS detected, the click is consumed here to prevent a spurious Click.
    if (ctx.data.dragCompleted === true) return false;
    if (event.eventType === 'click') {
      return ctx.data.dragDetected === true;
    }
    return MOUSE_DRAG_EVENTS.has(event.eventType);
  },

  // ── Handle Event ───────────────────────────────────────────────────

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    const isHtml5 = ctx.triggerEvent.eventType === 'dragstart';

    // ═══ HTML5 DnD path ═══
    if (isHtml5) {
      const result = handleHtml5Event(event, ctx);
      if (result?.endState === 'completed') ctx.data.dragCompleted = true;
      if (result?.endState === 'discarded') ctx.data.dragCompleted = true;
      return result;
    }

    // ═══ Mouse-based drag path ═══
    const result = handleMouseEvent(event, ctx);
    if (result?.endState === 'completed') ctx.data.dragCompleted = true;
    if (result?.endState === 'discarded') ctx.data.dragCompleted = true;
    return result;
  },

  // ── Outside events ─────────────────────────────────────────────────

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // If we've already detected a drag (displacement ≥ threshold), don't
    // abandon on outside events — we want to capture the mouseup/click.
    if (ctx.data.dragDetected === true) return false;

    // Before drag is confirmed, abandon on any interactive event (the user
    // started a different action without dragging).
    if (
      event.eventType === 'click' ||
      event.eventType === 'keydown' ||
      event.eventType === 'focus' ||
      event.eventType === 'blur' ||
      event.eventType === 'input' ||
      event.eventType === 'change' ||
      event.eventType === 'mouseenter' ||
      event.eventType === 'mouseleave'
    ) {
      return true;
    }

    return false;
  },

  /**
   * When displacement ≥ threshold at mouseup, complete the drag. The
   * click-after-drag is suppressed by the runtime because DragDrop consumed
   * the mouseup. We set shouldCompleteOnOutside to handle the case where
   * click arrives after the DragDrop is flushed.
   */
  shouldCompleteOnOutside(_event: ObservedEvent, ctx: ComponentContext): boolean {
    // Only auto-complete if drag was detected but we're still waiting
    return ctx.data.dragDetected === true && ctx.data.consumedClick !== true;
  },

  downcast(ctx: ComponentContext, completion: ComponentCompletion): InteractionType | null {
    // DragDrop downcasts to Click when:
    // - discarded: no drag detected (mousedown→mouseup without displacement).
    //   This ensures the user's click action is captured even when DragDrop
    //   absorbed the mousedown/mouseup events.
    // - abandoned: the session was interrupted before any drag was confirmed.
    //   Same reasoning — preserve the user's click.
    if (completion.endState === 'discarded' ||
        (completion.endState === 'abandoned' && ctx.data.dragDetected !== true)) {
      return 'Click' as InteractionType;
    }
    return null;
  },

  // ── Build Result ───────────────────────────────────────────────────

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const isHtml5 = ctx.triggerEvent.eventType === 'dragstart';
    const dragDetected = ctx.data.dragDetected === true;

    // Source element
    const sourceName = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    // Drop target
    const dropTargetIdentity = ctx.data.dropTarget as ElementIdentity | undefined;
    const dropTargetName = dropTargetIdentity
      ? bestName(
          dropTargetIdentity.accessibleName,
          dropTargetIdentity.ariaLabel,
          dropTargetIdentity.placeholder,
        )
      : null;

    // Set the interaction subtype
    ctx.data.interactionSubtype = isHtml5 ? 'Html5DragDrop' : 'MouseDragDrop';

    // Calculate displacement
    const startX = (ctx.data.startX as number) ?? 0;
    const startY = (ctx.data.startY as number) ?? 0;
    const endX = (ctx.data.endX as number) ?? startX;
    const endY = (ctx.data.endY as number) ?? startY;
    const displacement = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);

    return {
      metadata: {
        targetName: sourceName,
        sourceElement: sourceName,
        sourceTag: ctx.trigger.tag,
        sourceRole: ctx.trigger.ariaRole,
        dropTarget: dropTargetName,
        dropTargetTag: dropTargetIdentity?.tag ?? null,
        dropTargetRole: dropTargetIdentity?.ariaRole ?? null,
        displacement: Math.round(displacement),
        startX: Math.round(startX),
        startY: Math.round(startY),
        endX: Math.round(endX),
        endY: Math.round(endY),
        dragMethod: isHtml5 ? 'html5' : 'mouse',
        dragDetected,
      },
    };
  },
};

// ── Mouse-Based Drag Handlers ─────────────────────────────────────────

/**
 * Process a mouse-drag lifecycle event.
 */
function handleMouseEvent(
  event: ObservedEvent,
  ctx: ComponentContext,
): ComponentCompletion | null {
  // ── Initialize origin on first handling ──
  if (ctx.data.startX === undefined && ctx.triggerEvent.clientX !== null) {
    ctx.data.startX = ctx.triggerEvent.clientX;
    ctx.data.startY = ctx.triggerEvent.clientY;
    ctx.data.lastX = ctx.triggerEvent.clientX;
    ctx.data.lastY = ctx.triggerEvent.clientY;
  }

  switch (event.eventType) {
    case 'mousemove': {
      // Track current pointer position
      if (event.clientX !== null && event.clientY !== null) {
        ctx.data.lastX = event.clientX;
        ctx.data.lastY = event.clientY;
      }

      // Check displacement mid-drag to flag drag detected early
      const displacement = calcDisplacement(ctx, event.clientX, event.clientY);
      if (displacement >= MIN_DRAG_DISPLACEMENT_PX) {
        ctx.data.dragDetected = true;
      }

      return null; // drag continues
    }

    case 'mouseup': {
      const endX = event.clientX ?? (ctx.data.lastX as number) ?? (ctx.data.startX as number);
      const endY = event.clientY ?? (ctx.data.lastY as number) ?? (ctx.data.startY as number);

      ctx.data.endX = endX;
      ctx.data.endY = endY;

      // Capture the drop target — the element under the pointer at mouseup
      ctx.data.dropTarget = event.target;

      const displacement = calcDisplacementFromCoords(
        (ctx.data.startX as number) ?? endX,
        (ctx.data.startY as number) ?? endY,
        endX,
        endY,
      );

      if (displacement >= MIN_DRAG_DISPLACEMENT_PX) {
        // It's a drag! Stay active to consume the subsequent click event.
        ctx.data.dragDetected = true;
        return null; // don't complete yet — wait for click
      }

      // Displacement below threshold — not a drag, discard
      return { endState: 'discarded' };
    }

    case 'click': {
      if (ctx.data.dragDetected === true) {
        // This is the click-after-drag. Consume it and complete.
        ctx.data.consumedClick = true;
        return { endState: 'completed' };
      }

      // Click without prior drag detection — discard (Click definition handles it)
      return { endState: 'discarded' };
    }

    default:
      return null;
  }
}

// ── HTML5 DnD Handlers ────────────────────────────────────────────────

/**
 * Process an HTML5 DnD lifecycle event.
 */
function handleHtml5Event(
  event: ObservedEvent,
  ctx: ComponentContext,
): ComponentCompletion | null {
  switch (event.eventType) {
    case 'dragover': {
      // Track the element under the pointer during drag
      ctx.data.dropTarget = event.target;
      return null; // continue
    }

    case 'drop': {
      // Drop fired — capture the drop target
      ctx.data.dropTarget = event.target;
      ctx.data.dragDetected = true;

      // Set end coordinates from drop event if available
      if (event.clientX !== null) ctx.data.endX = event.clientX;
      if (event.clientY !== null) ctx.data.endY = event.clientY;

      return { endState: 'completed' };
    }

    case 'dragend': {
      // dragend fires after drop (or when the drag is cancelled)
      if (ctx.data.dragDetected === true) return null; // already completed on drop
      // Drag was cancelled (no drop) — discard
      return { endState: 'discarded' };
    }

    case 'click': {
      // HTML5 DnD doesn't produce click events, but just in case
      return { endState: 'discarded' };
    }

    default:
      return null;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────

/**
 * Calculate displacement from the drag origin to a point.
 */
function calcDisplacement(
  ctx: ComponentContext,
  currentX: number | null,
  currentY: number | null,
): number {
  const startX = (ctx.data.startX as number) ?? currentX ?? 0;
  const startY = (ctx.data.startY as number) ?? currentY ?? 0;
  if (currentX === null || currentY === null) return 0;
  return Math.sqrt((currentX - startX) ** 2 + (currentY - startY) ** 2);
}

/**
 * Calculate displacement from explicit coordinates.
 */
function calcDisplacementFromCoords(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  return Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
}

/**
 * Mark the trigger path (mouse vs html5) when the component is created.
 * This is called from detectTrigger context — but since we can't set ctx.data
 * in detectTrigger, we detect it lazily in handleEvent instead.
 */
export function _isHtml5Dnd(triggerEventType: string): boolean {
  return triggerEventType === 'dragstart';
}
