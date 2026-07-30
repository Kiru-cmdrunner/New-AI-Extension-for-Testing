/**
 * Stepper Definition — DOM-Proximity Grouping (Priority 28)
 *
 * Standalone steppers (quantity selectors, passenger counters, rating steppers)
 * exist outside dropdown/modal surfaces. They are independent +/- button pairs
 * where clicking adjusts a counter value.
 *
 * This definition groups consecutive +/- clicks by DOM proximity (shared ancestor
 * container) rather than by surface containment. Two stepper buttons belong to
 * the same field if they share the same ancestor container structure.
 *
 * ## Lifecycle
 *
 * ```
 * Trigger: click on element matching isStepperPlus() or isStepperMinus()
 *          AND event has no surfaceId (not inside Dropdown/ModalDialog)
 *
 * Active:  accumulate +/- clicks on stepper buttons. Stay active across
 *          multiple clicks on the same or related stepper elements.
 *
 * Completion:
 *   - Click on a non-stepper element → completed (outside click via shouldCompleteOnOutside)
 *   - Stale timeout → completed/interrupted
 *   - Flush (navigation) → completed (via shouldCompleteOnFlush)
 * ```
 *
 * ## Field Grouping
 *
 * The definition does NOT use surface containment (no surfaceId). Instead, it
 * groups by DOM proximity:
 *   - Same `cssSelector` parent prefix → same field
 *   - Overlapping `ancestorClasses` → same field
 *
 * Field name extraction reuses `extractStepperLabel()` from Dropdown.
 *
 * ## Reuse
 *
 * - `isStepperPlus()` / `isStepperMinus()` — exported from dropdown.ts
 * - `extractStepperLabel()` — exported from dropdown.ts
 * - Pattern Registry stepper class patterns (via isStepperPlusClass/MinusClass)
 * - SubAction accumulation model (similar to Dropdown)
 *
 * ## No Interference
 *
 * Steppers inside Dropdown surfaces are claimed by Dropdown (priority 20) via
 * isInScope before Stepper (priority 28) can discover them. The detectTrigger
 * also checks surfaceId to skip events inside surfaces.
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { isStepperPlus, isStepperMinus, extractStepperLabel } from './dropdown';
import { bestName } from './patterns';

// ── Stepper SubAction Model ───────────────────────────────────────────

interface StepperSubAction {
  action: 'increment' | 'decrement';
  label: string;
  field: string;
  delta: number;
  target: ObservedEvent['target'];
  event: ObservedEvent;
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Extract a field name from the stepper button's context.
 * Uses the same logic as Dropdown's extractStepperLabel, with
 * additional ancestor-class-based inference.
 */
function getFieldName(event: ObservedEvent): string {
  // Reuse Dropdown's label extraction (aria-label → accessibleName → CSS class)
  const label = extractStepperLabel(event);
  // Skip bare stepper symbols (+, -, +1, -1)
  if (label && !/^[+\-]1?$/.test(label)) return label;

  // Fallback: infer from accessibleName/ariaLabel directly
  const best = bestName(
    event.target.accessibleName,
    event.target.ariaLabel,
    null,
  );
  if (best && best !== 'element' && !/^[+\-]1?$/.test(best)) {
    return best;
  }

  // Final fallback: try ancestor classes for common field patterns
  const ancestorClasses = event.domContext.ancestorClasses.join(' ');
  const classMatch = ancestorClasses.match(
    /(?:adult|child|children|infant|senior|youth|teen|guest|passenger|quantity|qty|count|item)(?:[-_a-z]*)?/i,
  );
  if (classMatch) {
    const inferred = classMatch[0].replace(/[-_]/g, ' ').trim();
    return inferred.charAt(0).toUpperCase() + inferred.slice(1).toLowerCase();
  }

  return 'Counter';
}

/**
 * Get the ancestor container identity for DOM-proximity grouping.
 * Two stepper buttons belong to the same field if they share the same
 * ancestor container (by CSS selector or stableId).
 */
function getAncestorKey(event: ObservedEvent): string {
  // Use ancestor classes as the grouping key — buttons in the same
  // stepper widget share ancestor container classes.
  const ancestorClasses = event.domContext.ancestorClasses;
  if (ancestorClasses && ancestorClasses.length > 0) {
    // Take the first 3 ancestor classes (the closest container)
    // and join them as a grouping key. This is robust because
    // React/Vue/Angular components render consistent ancestor structures.
    return ancestorClasses.slice(0, 3).join('|');
  }
  // Fallback: use the cssSelector parent path
  const selector = event.target.cssSelector || '';
  // Extract parent path (everything except the last element)
  const parentPath = selector.replace(/(^|>)[^>]+$/, '');
  return parentPath || selector;
}

// ── Definition ───────────────────────────────────────────────────────

export const stepperDefinition: ComponentDefinition = {
  type: 'Stepper',
  priority: 28,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'mousedown']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // Only trigger on stepper buttons (+ / - patterns)
    if (!isStepperPlus(event) && !isStepperMinus(event)) return null;

    // Don't trigger inside a surface — Dropdown/ModalDialog handle steppers there
    if (event.domContext.surfaceId) return null;

    // This is a standalone stepper button click
    return { type: 'Stepper' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Only claim click events on stepper buttons
    if (event.eventType !== 'click') return false;
    if (!isStepperPlus(event) && !isStepperMinus(event)) return false;

    // On the first event after trigger, ctx.data.ancestorKey may not be set yet
    // (it's set in handleEvent). If not set, accept the event — handleEvent
    // will initialize the key and field name.
    const sessionKey = ctx.data.ancestorKey as string;
    if (!sessionKey) return true;

    // Compare ancestor keys for DOM-proximity grouping
    const eventKey = getAncestorKey(event);
    if (eventKey === sessionKey) return true;

    // Also check field name match (handles CSS selector variations)
    const sessionField = ctx.data.fieldName as string;
    if (sessionField && sessionField !== 'Counter') {
      const eventField = getFieldName(event);
      if (eventField === sessionField) return true;
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Only process click events (not mousedown) to avoid double-counting
    if (event.eventType !== 'click') return null;

    // Record the ancestor key for grouping on first event
    if (!ctx.data.ancestorKey) {
      ctx.data.ancestorKey = getAncestorKey(event);
    }
    if (!ctx.data.fieldName) {
      ctx.data.fieldName = getFieldName(event);
    }

    // Classify as increment or decrement
    const isPlus = isStepperPlus(event);
    const isMinus = isStepperMinus(event);
    if (!isPlus && !isMinus) return null;

    const label = bestName(
      event.target.accessibleName,
      event.target.ariaLabel,
      null,
    );
    const field = (ctx.data.fieldName as string) || getFieldName(event);
    const delta = isPlus ? 1 : -1;

    // Initialize delta tracking
    if (typeof ctx.data.totalDelta !== 'number') {
      ctx.data.totalDelta = 0;
    }
    ctx.data.totalDelta = (ctx.data.totalDelta as number) + delta;

    // Track subActions
    if (!ctx.data.subActions) ctx.data.subActions = [];
    const subs = ctx.data.subActions as StepperSubAction[];
    subs.push({
      action: isPlus ? 'increment' : 'decrement',
      label,
      field,
      delta,
      target: event.target,
      event,
    });

    // Set subtype for rendering — use 'increment'/'decrement' as metadata,
    // not as interactionSubtype (which becomes the classifier type).
    // The adapter maps Stepper → 'Stepper' classifier type by default.
    const total = ctx.data.totalDelta as number;
    ctx.data.stepperDirection = total > 0 ? 'increment' : 'decrement';

    return null; // stay active — complete on outside click or timeout
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Never abandon — we always have accumulated data worth keeping.
    // Use shouldCompleteOnOutside for completion logic.
    return false;
  },

  shouldCompleteOnOutside(event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Complete when a non-stepper element is clicked (user moved on).
    // Only check click events — not mousedown or other types.
    if (event.eventType !== 'click') return false;
    if (!isStepperPlus(event) && !isStepperMinus(event)) {
      return true; // Non-stepper click → complete the session
    }
    return false;
  },

  shouldCompleteOnFlush(_ctx: ComponentContext): boolean {
    // Complete on navigation flush — we have accumulated data
    return true;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const subActions = (ctx.data.subActions as StepperSubAction[]) ?? [];
    const totalDelta = (ctx.data.totalDelta as number) ?? 0;
    const field = (ctx.data.fieldName as string) ?? 'Counter';
    const increments = subActions.filter(s => s.action === 'increment').length;
    const decrements = subActions.filter(s => s.action === 'decrement').length;

    return {
      metadata: {
        targetName: field,
        fieldName: field,
        totalDelta,
        incrementCount: increments,
        decrementCount: decrements,
        subActions: subActions.map(s => ({
          action: s.action,
          label: s.label,
          field: s.field,
          delta: s.delta,
          targetElementId: s.target?.elementId ?? undefined,
          targetCssSelector: s.target?.cssSelector ?? undefined,
          targetStableId: s.target?.stableId ?? undefined,
          targetClassName: s.target?.className ?? undefined,
        })),
      },
    };
  },
};
