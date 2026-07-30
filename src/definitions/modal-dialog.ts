/**
 * ModalDialog Definition — Container Lifecycle (Priority 22)
 *
 * Captures interactions inside modal dialogs, drawers, bottom sheets, and
 * other overlay surfaces as a single compound interaction.
 *
 * ## Lifecycle
 *
 * 1. **Trigger (surface-confirmation strategy):** Fires on click. The modal
 *    surface appears asynchronously (React portal, etc.) — it won't be present
 *    on the trigger event itself. The runtime's `trackSurface` binds the modal
 *    surfaceId to this session when it appears on a subsequent event.
 *
 *    If no modal surface appears within a reasonable event window, the session
 *    is abandoned and downcasts to Click (it wasn't a modal-opening click).
 *
 * 2. **Scope:** ALL events inside the modal's surfaceId are claimed. Each
 *    in-surface event is classified as a subAction using the same classification
 *    logic as Dropdown (selectOption, fillInput, increment, toggle, confirm).
 *
 * 3. **Completion:**
 *    - Click on a close/save/confirm/cancel button → completed
 *    - Escape key → completed
 *    - Surface closure (backdrop click detected by detectSurfaceClosure) → completed
 *    - Flush (navigation away) → interrupted
 *
 * ## Why priority 22?
 *
 * After DatePicker (10), DragDrop (15), and Dropdown (20). ModalDialog fires
 * only on positive modal signals (aria-haspopup, modal CSS classes), so it
 * doesn't compete with Dropdown/DatePicker for their well-defined triggers.
 * It sits between Dropdown (20) and Slider (25) in the discovery order.
 *
 * Architecture: `.drytis/specs/p0-6-modal-dialog.md`
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
import {
  bestName,
  elementKey,
} from './patterns';

// ── SubAction Model (shared with Dropdown) ───────────────────────────

export type SubActionType =
  | 'selectOption'    // Click a radio/option/button inside the modal
  | 'increment'       // Click "+" on a stepper inside the modal
  | 'decrement'       // Click "-" on a stepper inside the modal
  | 'toggle'          // Toggle a checkbox inside the modal
  | 'fillInput'       // Type into a text input inside the modal
  | 'confirm';        // Click Save/Submit/Confirm/Close inside the modal

export interface ModalSubAction {
  action: SubActionType;
  label: string;
  value?: string;
  target: ObservedEvent['target'];
  event: ObservedEvent;
}

// ── Close Button Detection ───────────────────────────────────────────

/**
 * Keywords that identify close/confirm/cancel buttons inside a modal.
 * Clicking one signals the user is finished with the modal interaction.
 */
const CLOSE_BUTTON_RE =
  /^(close|cancel|save|submit|confirm|ok|done|apply|update|delete|remove|send|create|add|register|login|sign\s?in|sign\s?up|continue|next|finish|discard|reset)$/i;

/**
 * Is this click a close/confirm button inside a modal?
 * Detects by accessible name or aria-label matching common close-button labels.
 */
function isCloseButton(event: ObservedEvent): boolean {
  const name = (event.target.accessibleName || '').trim();
  const label = (event.target.ariaLabel || '').trim();
  return CLOSE_BUTTON_RE.test(name) || CLOSE_BUTTON_RE.test(label);
}

/**
 * Is this element a visual close button (× icon)?
 */
function isCloseIcon(event: ObservedEvent): boolean {
  const name = (event.target.accessibleName || '').trim();
  const label = (event.target.ariaLabel || '').trim();
  // × or ✕ or the word "close" in the aria-label
  return /^[×✕x]$/.test(name) || /close|dismiss/i.test(label);
}

// ── SubAction Classification ─────────────────────────────────────────

/**
 * Classify an in-surface event into a subAction.
 * This reuses the same classification logic as Dropdown, adapted for
 * the modal context where any labeled click is significant (not just
 * dropdown options).
 */
function classifySubAction(event: ObservedEvent): ModalSubAction | null {
  const label = bestName(
    event.target.accessibleName,
    event.target.ariaLabel,
    event.target.placeholder,
  );

  // Skip events with no identity — they're noise
  if (!label || label === 'element') return null;

  // Close/confirm button → confirm subAction
  if (event.eventType === 'click' && (isCloseButton(event) || isCloseIcon(event))) {
    return {
      action: 'confirm',
      label,
      value: label,
      target: event.target,
      event,
    };
  }

  // Checkbox/switch toggle
  if (event.target.ariaRole === 'checkbox' || event.target.ariaRole === 'switch') {
    return {
      action: 'toggle',
      label,
      value: event.checkedAfter !== null ? String(event.checkedAfter) : undefined,
      target: event.target,
      event,
    };
  }

  // Stepper +/- buttons (reuse Dropdown's detection logic)
  // Check the event's target for plus/minus indicator patterns
  const stepperPlus = /(\bplus\b|\badd\b|\bincrease\b|\+\b|↑|▲|aria-label.*increase)/i;
  const stepperMinus = /(\bminus\b|\bremove\b|\bdecrease\b|\-\b|↓|▼|aria-label.*decrease)/i;
  if (event.eventType === 'click') {
    const targetText = `${event.target.accessibleName || ''} ${event.target.ariaLabel || ''}`;
    if (stepperPlus.test(targetText)) {
      return { action: 'increment', label, target: event.target, event };
    }
    if (stepperMinus.test(targetText)) {
      return { action: 'decrement', label, target: event.target, event };
    }
  }

  // Text input/change → fillInput
  if (event.eventType === 'change' || event.eventType === 'input') {
    if (event.valueAfter && event.valueAfter.trim()) {
      return {
        action: 'fillInput',
        label,
        value: event.valueAfter,
        target: event.target,
        event,
      };
    }
  }

  // Radio button selection
  if (event.target.ariaRole === 'radio' || event.target.ariaRole === 'option') {
    return {
      action: 'selectOption',
      label,
      value: label,
      target: event.target,
      event,
    };
  }

  // Generic labeled click inside modal → clickAction
  if (event.eventType === 'click') {
    return {
      action: 'selectOption',
      label,
      value: label,
      target: event.target,
      event,
    };
  }

  return null;
}

// ── SubAction Accumulation ───────────────────────────────────────────

/**
 * Add a subAction to the context's data bag, with dedup logic.
 * Prevents mousedown+click duplicates on the same element within 500ms.
 */
function addSubAction(ctx: ComponentContext, sub: ModalSubAction): void {
  if (!ctx.data.subActions) ctx.data.subActions = [];
  const subs = ctx.data.subActions as ModalSubAction[];

  const subKey = sub.target?.elementId || sub.event?.target?.elementId;
  if (subKey && sub.event) {
    const last = subs[subs.length - 1];
    if (
      last &&
      last.action === sub.action &&
      (last.target?.elementId === subKey ||
       last.target?.cssSelector === sub.event.target.cssSelector) &&
      sub.event.timestamp - (last.event?.timestamp ?? 0) < 500
    ) {
      return; // Skip duplicate
    }
  }

  subs.push(sub);
}

// ── Definition ───────────────────────────────────────────────────────

export const modalDialogDefinition: ComponentDefinition = {
  type: 'ModalDialog',
  priority: 22,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'mousedown']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // ── Positive-Signal Trigger Strategy ──
    //
    // ModalDialog fires ONLY when there's a positive signal that a modal/dialog
    // will appear. This prevents intercepting generic clicks that should become
    // plain Click interactions.
    //
    // Detection signals (ARIA-first, framework-independent):
    //   1. aria-haspopup="dialog" — explicit modal signal
    //   2. aria-haspopup="true" — generic popup (could be a modal)
    //   3. data-bs-toggle="modal" / data-toggle="modal" — Bootstrap
    //   4. Framework CSS class patterns via Pattern Registry
    //
    // The modal surface appears asynchronously. trackSurface binds the modal
    // surfaceId to this session when it appears (type-aware: only 'modal'/'drawer'
    // surfaces). If no modal surface appears within the session lifetime, the
    // session is abandoned and downcasts to Click.

    const { ariaHasPopup, ariaRole } = event.domContext;
    const { tag } = event.target;

    // ── Exclusions (let other definitions handle their triggers) ──
    if (ariaHasPopup === 'listbox' || ariaRole === 'combobox') return null;
    if (ariaHasPopup === 'grid' || ariaRole === 'grid') return null;
    if (tag === 'SELECT') return null;
    if (event.domContext.surfaceId) return null;
    if (tag === 'A' || event.target.ariaRole === 'link') return null;

    // ── Positive Signal 1: aria-haspopup="dialog" ──
    if (ariaHasPopup === 'dialog') {
      return { type: 'ModalDialog' };
    }

    // ── Positive Signal 2: aria-haspopup="true" (generic popup) ──
    // This is a weaker signal — it could be a popover, menu, or dialog.
    // We fire ModalDialog optimistically; if a popover surface appears instead
    // of a modal surface, the type-aware surface binding won't match and the
    // session will downcast to Click.
    if (ariaHasPopup === 'true') {
      return { type: 'ModalDialog' };
    }

    // ── Positive Signal 3: Bootstrap data attributes ──
    // data-bs-toggle="modal" (Bootstrap 5) / data-toggle="modal" (Bootstrap 4)
    // These are framework-specific but extremely common and unambiguous.
    const className = event.target.className || '';
    if (
      /\bmodal-(?:open|trigger|toggle|button)\b/i.test(className) ||
      /\bopen-modal\b/i.test(className) ||
      /\bjs-modal\b/i.test(className)
    ) {
      return { type: 'ModalDialog' };
    }

    // ── Positive Signal 4: Framework modal trigger CSS patterns ──
    // Check ancestor classes for modal-opening patterns (e.g., MUI Dialog trigger)
    const ancestorClasses = event.domContext.ancestorClasses?.join(' ') || '';
    if (
      /\bmodal-(?:open|trigger|toggle|button)\b/i.test(ancestorClasses) ||
      /\bopen-modal\b/i.test(ancestorClasses)
    ) {
      return { type: 'ModalDialog' };
    }

    // No positive modal signal — let this click fall through to Click
    return null;
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Once a surface is bound, claim ALL events inside that surface.
    if (ctx.openedSurface && event.domContext.surfaceId) {
      return event.domContext.surfaceId === ctx.openedSurface;
    }

    // Before surface binding: only the trigger element itself is in scope
    // (we're waiting for the modal to appear)
    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);
    if (eventKey === triggerKey) return true;

    // CSS-class fallback: if we don't have a surfaceId yet, check if
    // the event is inside a modal surface by surfaceType
    if (event.domContext.surfaceType === 'modal') {
      return true;
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // ── Escape key → complete ──
    if (event.eventType === 'keydown' && event.key === 'Escape') {
      return { endState: 'completed' };
    }

    // ── Surface not yet bound: waiting for modal to appear ──
    // The trigger click itself doesn't produce a subAction.
    if (!ctx.openedSurface && eventKey === triggerKey) {
      return null;
    }

    // ── Close/confirm button → complete with subActions ──
    if (event.eventType === 'click' && (isCloseButton(event) || isCloseIcon(event))) {
      const sub = classifySubAction(event);
      if (sub) addSubAction(ctx, sub);
      return { endState: 'completed' };
    }

    // ── Skip the trigger element itself ──
    if (eventKey === triggerKey) return null;

    // ── Classify every other in-surface event ──
    const sub = classifySubAction(event);
    if (sub) {
      addSubAction(ctx, sub);
    }

    return null; // stay active — complete on close button or surface closure
  },

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // If the modal surface hasn't appeared yet, cancel on any non-trigger
    // interactive event (the click didn't open a modal).
    if (!ctx.openedSurface) {
      const triggerKey = elementKey(ctx.trigger);
      const eventKey = elementKey(event.target);
      if (eventKey !== triggerKey) {
        return true; // abandon — this wasn't a modal-opening click
      }
    }
    return false;
  },

  shouldCompleteOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Surface closure (click outside the modal, detected by detectSurfaceClosure
    // in the runtime) will complete this session. But we also want to complete
    // when the user clicks on the backdrop (which IS an outside event but might
    // not have a surfaceId). Let the runtime's surface closure handle it.
    return false;
  },

  downcast(ctx: ComponentContext, completion: ComponentCompletion): InteractionType | null {
    // If the ModalDialog session is abandoned/interrupted and no surface was
    // ever bound (no modal appeared) and no subActions were collected,
    // downcast to Click — the click didn't open a modal.
    if (completion.endState !== 'completed' && !ctx.openedSurface) {
      const subActions = (ctx.data.subActions as ModalSubAction[]) ?? [];
      if (subActions.length === 0) {
        return 'Click' as InteractionType;
      }
    }

    // If a modal DID open (surface was bound) and we have subActions,
    // keep the ModalDialog type even if interrupted — the subActions
    // represent real user interactions inside the modal.
    return null;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const subActions = (ctx.data.subActions as ModalSubAction[]) ?? [];
    const triggerName = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    // Derive the modal title from the surface metadata
    const modalTitle = ctx.triggerEvent.domContext.surfaceLabel || triggerName;

    return {
      metadata: {
        targetName: triggerName,
        modalTitle,
        subActions: subActions.map((s) => ({
          action: s.action,
          label: s.label,
          value: s.value,
          targetElementId: s.target?.elementId ?? undefined,
          targetCssSelector: s.target?.cssSelector ?? undefined,
          targetClassName: s.target?.className ?? undefined,
          targetStableId: s.target?.stableId ?? undefined,
        })),
        hasSubActions: subActions.length > 0,
      },
    };
  },
};
