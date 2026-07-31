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

// ── Date Range Detection ──────────────────────────────────────────────

/**
 * CSS class / ARIA patterns that indicate a date-range picker.
 * These widgets have two date inputs (start + end) and the user selects
 * two dates from the same calendar.
 *
 * IMPORTANT: range detection requires PAIR indicators (both start/end,
 * check-in/check-out, depart/return, from/to). A single "depart" or
 * "check-in" field alone is a single-date picker, not a range.
 */
const RANGE_PAIR_RE =
  /(?:start.?date.*end.?date|end.?date.*start.?date|check.?in.*check.?out|check.?out.*check.?in|depart.*return|return.*depart|from.?date.*to.?date|to.?date.*from.?date|outbound.*inbound|inbound.*outbound|range)/i;

/**
 * Individual field names that indicate ONE side of a range pair.
 * These alone do NOT prove a range — they're used to match adjacent
 * fields on the page.
 */
const RANGE_FIELD_RE =
  /(?:start.?date|end.?date|check.?in|check.?out|depart|return|outbound|inbound|from.?date|to.?date)/i;

/**
 * Check if this date picker is likely a range picker.
 * Signals: container classes, ARIA labels, input names.
 *
 * A range picker is detected when we find explicit range indicators:
 *   - CSS class with "range" in it
 *   - Label containing BOTH pair indicators (e.g., "Check-in – Check-out")
 *   - Container class explicitly naming range-picker
 *
 * A single "depart" or "check-in" field is NOT a range — it's one
 * date input in what may be two separate fields.
 */
function isLikelyDateRange(ctx: ComponentContext): boolean {
  // Check for explicit "range" class indicators
  const { ariaLabel, name, className } = ctx.trigger;
  const allLabels = [ariaLabel, name, className].filter(Boolean).join(' ');
  if (allLabels && /(?:range.?picker|dual.?date|date.?range|range.?input)/i.test(allLabels)) return true;

  // Check for PAIR indicators in the same string (both sides of a range)
  if (allLabels && RANGE_PAIR_RE.test(allLabels)) return true;

  // Check ancestor classes for explicit range indicators
  const ancestorClasses = ctx.triggerEvent.domContext.ancestorClasses.join(' ');
  if (/(?:range.?picker|dual.?date|date.?range|range.?input)/i.test(ancestorClasses)) return true;

  return false;
}

export const datePickerDefinition: ComponentDefinition = {
  type: 'DatePicker',
  priority: 10,
  triggerEventTypes: new Set<BrowserEventType>([
    'focus', 'click',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, className, name } = event.target;
    const { inputType, ariaHasPopup } = event.domContext;

    // ── Phase 0b: Behavioral signal detection (ARIA primary) ──

    // 1. aria-haspopup="dialog" on an INPUT — standard ARIA signal for date picker
    if (ariaHasPopup === 'dialog' && tag === 'INPUT') {
      return { type: 'DatePicker' };
    }

    // 2. Native date input types
    if (tag === 'INPUT' && (inputType === 'date' || inputType === 'datetime-local' || inputType === 'month' || inputType === 'week' || inputType === 'time')) {
      return { type: 'DatePicker' };
    }

    // ── Phase 0b: CSS class detection (fallback) ──

    if (
      isDatePickerTrigger(tag, inputType, className, ariaHasPopup, name)
    ) {
      return { type: 'DatePicker' };
    }

    // Also detect focus/click on date input wrapper (OXD: div.oxd-date-input)
    const ancestorClasses = event.domContext.ancestorClasses.join(' ');
    if (isDatePickerTrigger(tag, inputType, ancestorClasses, null, name)) {
      return { type: 'DatePicker' };
    }

    return null;
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Phase 0b: Surface-bound session identity.
    // Primary path: surface containment (event.domContext.surfaceId === ctx.openedSurface).
    // Fallback: CSS class-based calendar surface detection.

    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // Same element as trigger — always in scope
    if (eventKey === triggerKey) return true;

    // Phase 0b: Surface containment check (primary path)
    if (ctx.openedSurface && event.domContext.surfaceId) {
      return event.domContext.surfaceId === ctx.openedSurface;
    }

    // Fallback: CSS class-based surface detection (legacy path)
    const inCalendarSurface = isInsideCalendarSurface(event.target.className) ||
      isInsideCalendarSurface(event.domContext.ancestorClasses.join(' '));
    if (inCalendarSurface) return true;

    // Calendar cell (may not have surface ancestor classes in all frameworks)
    if (isCalendarCell(event.target.ariaRole, event.target.className)) return true;

    // Fallback: inside calendar surface + date-like accessible name
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

        // ── Date Range support ──
        // If this looks like a range picker and this is the FIRST date
        // selection, record it as startDate and stay active.
        if (!ctx.data.rangeStarted && isLikelyDateRange(ctx)) {
          ctx.data.rangeStarted = true;
          ctx.data.startDate = dateValue;
          ctx.data.selectedDate = dateValue; // backward compat for first date
          return null; // stay active — wait for end date
        }

        // If this is the SECOND date in a range
        if (ctx.data.rangeStarted) {
          ctx.data.endDate = dateValue;
          ctx.data.interactionSubtype = 'DateRangePicker';
          return { endState: 'completed' };
        }

        return { endState: 'completed' };
      }

      // Fallback: element inside a calendar surface with date-like text
      // Phase 0b: Check surface containment first (primary path)
      const inSurfaceById = ctx.openedSurface && event.domContext.surfaceId === ctx.openedSurface;
      const inCalendarSurface = inSurfaceById ||
        isInsideCalendarSurface(event.target.className) ||
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

    // ── Date Range Picker output ──
    if (ctx.data.rangeStarted) {
      const startDate = (ctx.data.startDate as string) ?? '';
      const endDate = (ctx.data.endDate as string) ?? '';
      return {
        metadata: {
          targetName: name,
          selectedDate: endDate || startDate, // backward compat
          dateValue: endDate || startDate,
          startDate,
          endDate,
          isDateRange: true,
        },
      };
    }

    return {
      metadata: {
        targetName: name,
        selectedDate,
        dateValue,
      },
    };
  },
};
