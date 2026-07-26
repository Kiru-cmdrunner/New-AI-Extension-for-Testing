/**
 * DatePicker Definition — Calendar Date Selection Lifecycle (Priority 10)
 *
 * Highest priority definition — gets first chance to claim events
 * involving date inputs and calendars.
 *
 * Triggers on focus/click of a date input or calendar trigger.
 * Completes when user clicks a calendar cell (an actual date).
 * Navigation buttons (Next/Prev Month) are lifecycle-internal —
 * they must NOT complete the picker.
 *
 * Bug 3 fix: Calendar focus-back on input triggers a new lifecycle.
 * Dedup in the runtime catches this via end-to-start time + selectedDate
 * metadata comparison.
 *
 * Bug 7 fix: Navigation buttons (class matches CALENDAR_NAV_BUTTON_RE)
 * are treated as lifecycle-internal events, not completion triggers.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4.3, §4.7
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
  isDatePickerTrigger,
  isCalendarCell,
  isInsideCalendarSurface,
  isCalendarNavigationButton,
  bestName,
  elementKey,
} from './patterns';

export const datePickerDefinition: ComponentDefinition = {
  type: 'DatePicker',
  priority: 10,
  triggerEventTypes: new Set<BrowserEventType>([
    'focus', 'click',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, className, name } = event.target;
    const { inputType, ariaHasPopup } = event.domContext;

    if (
      isDatePickerTrigger(tag, inputType, className, ariaHasPopup, name)
    ) {
      return { type: 'DatePicker' };
    }

    // Also detect clicks on date input wrapper (OXD: div.oxd-date-input)
    if (event.eventType === 'click') {
      const ancestorClasses = event.domContext.ancestorClasses.join(' ');
      if (isDatePickerTrigger(tag, inputType, ancestorClasses, null, name)) {
        return { type: 'DatePicker' };
      }
    }

    return null;
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // In scope if:
    // 1. Event is on the trigger element (the date input)
    // 2. Event is inside the calendar surface
    // 3. Event is on a calendar cell

    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // Same element as trigger
    if (eventKey === triggerKey) return true;

    // Inside calendar surface (check target class + ancestors)
    if (isInsideCalendarSurface(event.target.className)) return true;
    const ancestorClasses = event.domContext.ancestorClasses.join(' ');
    if (isInsideCalendarSurface(ancestorClasses)) return true;

    // Calendar cell (may not have surface ancestor classes in all frameworks)
    if (isCalendarCell(event.target.ariaRole, event.target.className)) return true;

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Calendar cell click → complete
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isCalendarCell(event.target.ariaRole, event.target.className)
    ) {
      // Bug 7 check: make sure this isn't a navigation button
      // (isCalendarCell should already exclude these, but double-check)
      if (isCalendarNavigationButton(event.target.ariaRole, event.target.accessibleName, event.target.className)) {
        return null; // lifecycle-internal
      }

      ctx.data.selectedDate = event.target.accessibleName || '';
      ctx.data.dateValue = event.valueAfter ?? event.target.accessibleName ?? '';

      // Only complete if dateValue is non-empty (Bug: empty date selection)
      const dateValue = (ctx.data.dateValue as string) || '';
      if (!dateValue.trim()) return null;

      return { endState: 'completed' };
    }

    // Change event on native date input → complete
    if (event.eventType === 'change' && ctx.trigger.tag === 'INPUT') {
      const dateValue = event.valueAfter ?? '';
      if (dateValue.trim()) {
        ctx.data.selectedDate = dateValue;
        ctx.data.dateValue = dateValue;
        return { endState: 'completed' };
      }
    }

    // Navigation button click → lifecycle-internal (Bug 7)
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isCalendarNavigationButton(event.target.ariaRole, event.target.accessibleName, event.target.className)
    ) {
      return null; // stay active, user is navigating months
    }

    return null; // unknown event, stay active
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Architecture: lifecycle abandonment is timeout-based (MAX_LIFECYCLE_DURATION_MS).
    // We do NOT abandon on DOM boundary heuristics — portal-rendered calendars
    // break those checks. The definition waits passively for completion evidence
    // (calendar cell click or change event) or the runtime timeout.
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const selectedDate = (ctx.data.selectedDate as string) ?? '';
    const dateValue = (ctx.data.dateValue as string) ?? '';
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    return {
      metadata: {
        targetName: name,
        selectedDate,
        dateValue,
      },
    };
  },
};
