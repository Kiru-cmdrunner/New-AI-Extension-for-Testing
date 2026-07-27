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
  isCalendarCellWithFallback,
  isInsideCalendarSurface,
  isCalendarNavigationButton,
  looksLikeDateText,
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

    // Also detect focus/click on date input wrapper (OXD: div.oxd-date-input)
    // The date-triggering class is on the parent wrapper, not the input.
    // Check ancestor classes for ALL trigger events (focus AND click).
    const ancestorClasses = event.domContext.ancestorClasses.join(' ');
    if (isDatePickerTrigger(tag, inputType, ancestorClasses, null, name)) {
      return { type: 'DatePicker' };
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
    const inCalendarSurface = isInsideCalendarSurface(event.target.className) ||
      isInsideCalendarSurface(event.domContext.ancestorClasses.join(' '));
    if (inCalendarSurface) return true;

    // Calendar cell (may not have surface ancestor classes in all frameworks)
    if (isCalendarCell(event.target.ariaRole, event.target.className)) return true;

    // Fallback: inside calendar surface + date-like accessible name
    // (React SPAs that use custom calendar implementations)
    if (inCalendarSurface && isCalendarCellWithFallback(
      event.target.ariaRole, event.target.className, event.target.accessibleName
    )) {
      return true;
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Track typed values from input events (OXD date fields are text inputs
    // that users type into directly — no native date picker, no calendar click)
    if (event.eventType === 'input' || event.eventType === 'change') {
      if (event.valueAfter && event.valueAfter.trim()) {
        ctx.data.dateValue = event.valueAfter;
        ctx.data.selectedDate = event.valueAfter;
      }
    }

    // Blur on the trigger input → complete with whatever date was typed.
    // The value is captured deferred by the EventTap for SPA frameworks,
    // so valueAfter should reflect the FINAL value after framework updates.
    if (event.eventType === 'blur') {
      const dateValue =
        (ctx.data.dateValue as string) ||
        event.valueAfter ||
        '';
      if (dateValue.trim()) {
        ctx.data.dateValue = dateValue;
        ctx.data.selectedDate = dateValue;
        return { endState: 'completed' };
      }
      // Empty value on blur — abandon silently
      return { endState: 'abandoned' };
    }

    // Calendar cell click → complete
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown')
    ) {
      // Standard calendar cell detection
      if (isCalendarCell(event.target.ariaRole, event.target.className)) {
        // Bug 7 check: make sure this isn't a navigation button
        if (isCalendarNavigationButton(event.target.ariaRole, event.target.accessibleName, event.target.className)) {
          return null; // lifecycle-internal
        }

        ctx.data.selectedDate = event.target.accessibleName || '';
        ctx.data.dateValue = event.valueAfter ?? event.target.accessibleName ?? '';

        const dateValue = (ctx.data.dateValue as string) || '';
        if (!dateValue.trim()) return null;

        return { endState: 'completed' };
      }

      // Fallback: element inside a calendar surface with date-like text
      const inCalendarSurface = isInsideCalendarSurface(event.target.className) ||
        isInsideCalendarSurface(event.domContext.ancestorClasses.join(' '));
      if (inCalendarSurface && isCalendarCellWithFallback(
        event.target.ariaRole, event.target.className, event.target.accessibleName
      )) {
        // Check it's not a navigation button
        if (isCalendarNavigationButton(event.target.ariaRole, event.target.accessibleName, event.target.className)) {
          return null; // lifecycle-internal
        }

        ctx.data.selectedDate = event.target.accessibleName || '';
        ctx.data.dateValue = event.valueAfter ?? event.target.accessibleName ?? '';

        const fallbackDateValue = (ctx.data.dateValue as string) || '';
        if (!fallbackDateValue.trim()) return null;

        return { endState: 'completed' };
      }

      // SPA fallback: React SPAs (AdaniOne, etc.) render date selection as
      // a click on a date-like element that may not match the standard cell
      // or fallback patterns. If the click is inside a calendar surface and
      // the target's accessibleName looks like a date, use it as the value.
      // This catches cases where the calendar is a custom component with
      // unique class names.
      if (inCalendarSurface && event.target.accessibleName) {
        const name = event.target.accessibleName.trim();
        if (isCalendarCellWithFallback(event.target.ariaRole, event.target.className, name)) {
          // Already handled above — skip to avoid duplication
        } else if (looksLikeDateText(name)) {
          ctx.data.selectedDate = name;
          ctx.data.dateValue = event.valueAfter ?? name;
          return { endState: 'completed' };
        }
      }
    }

    // Change event on native date input → complete
    if (event.eventType === 'change' && ctx.trigger.tag === 'INPUT') {
      const dateValue = event.valueAfter ?? (ctx.data.dateValue as string) ?? '';
      if (dateValue.trim()) {
        ctx.data.selectedDate = dateValue;
        ctx.data.dateValue = dateValue;
        return { endState: 'completed' };
      }
    }

    // SPA-style: change event on the trigger input after async framework update.
    // When a calendar cell is clicked, React updates the input value
    // asynchronously. The recorder's post-click value check emits a
    // supplementary change event. Complete the DatePicker with this value.
    if (event.eventType === 'change') {
      const eventKey = elementKey(event.target);
      const triggerKey = elementKey(ctx.trigger);
      if (eventKey === triggerKey && event.valueAfter) {
        const dateValue = event.valueAfter;
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
