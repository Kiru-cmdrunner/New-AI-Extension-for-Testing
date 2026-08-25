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
    const { tag, className, name, placeholder } = event.target;
    const { inputType, ariaHasPopup } = event.domContext;

    // 7.4-B2a: aria-haspopup="listbox" is the W3C combobox-with-list popup
    // shape — never a calendar (calendars use dialog/grid). Prevents the
    // name-hint vocabulary (e.g. name="arrival") from stealing typeable
    // comboboxes at priority 10 before Dropdown (20) or TextEntry (50) are
    // consulted. Deliberately narrow: role=combobox alone is NOT declined
    // (MUI Desktop DatePicker is role=combobox aria-haspopup=dialog); only
    // the listbox popup shape is disclaimed.
    if (ariaHasPopup === 'listbox') {
      return null;
    }

    if (
      isDatePickerTrigger(tag, inputType, className, ariaHasPopup, name, placeholder)
    ) {
      return { type: 'DatePicker' };
    }

    // Also detect focus/click on date input wrapper (OXD: div.oxd-date-input)
    // The date-triggering class is on the parent wrapper, not the input.
    // Check ancestor classes for ALL trigger events (focus AND click).
    //
    // 6E-M2 round 2 (E2E finding): the real react-datepicker markup nests
    // the calendar INSIDE the wrapper (travel_date > div.date_picker >
    // react-datepicker > … > __day cells). On a cell click the ancestors
    // legitimately carry `date_picker`/`react-datepicker`, and the ancestor
    // token match below would otherwise start a lifecycle with the CELL as
    // its own trigger — the cell then completes both lifecycles, emitting a
    // duplicate DatePicker card named after the cell's aria-label.
    // W-A.3 (cells never trigger) therefore applies to the EVENT TARGET
    // here, not just the class string being tested: a cell-shaped target
    // (cell class family OR W3C date-cell name shape) may complete a
    // lifecycle but never start one via the ancestor path.
    const isCellShapedTarget =
      isCalendarCell(event.target.ariaRole, event.target.className) ||
      isCalendarCell(event.target.ariaRole, event.target.className, event.target.accessibleName);
    if (isCellShapedTarget) return null;

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
    if (isInsideCalendarSurface(event.target.className)) return true;
    const ancestorClasses = event.domContext.ancestorClasses.join(' ');
    if (isInsideCalendarSurface(ancestorClasses)) return true;

    // Calendar cell (may not have surface ancestor classes in all frameworks)
    // 6E-M2: name-aware cell check (W3C name shape + interactive role).
    if (isCalendarCell(event.target.ariaRole, event.target.className, event.target.accessibleName)) return true;

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Capture surfaceRole from the trigger's aria-haspopup.
    // Used by runtime's lifecycleOwnsTarget() for positive ownership testing.
    if (!ctx.data.surfaceRole) {
      ctx.data.surfaceRole =
        ctx.triggerEvent.domContext.ariaHasPopup === 'grid' ? 'grid' : null;
    }

    // Track typed values from input events (OXD date fields are text inputs
    // that users type into directly — no native date picker, no calendar click)
    if (event.eventType === 'input' || event.eventType === 'change') {
      if (event.valueAfter && event.valueAfter.trim()) {
        ctx.data.dateValue = event.valueAfter;
        ctx.data.selectedDate = event.valueAfter;
      }
    }

    // Blur on the trigger input → complete with whatever date was typed
    // This handles the OXD pattern: user types a date in a text input,
    // then clicks elsewhere (blur fires). Without this, the lifecycle
    // sits idle for 15s and gets abandoned with no value captured.
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
    // 6E-M2: pass the accessible name so the W3C date-cell name shape
    // ("Choose Saturday, September 5th, 2026") recognizes cells whose class
    // family is unknown — belt (name shape) + braces (role option/gridcell/
    // button) per spec §3 W-A.2b. Existing 2-arg behavior unchanged.
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isCalendarCell(event.target.ariaRole, event.target.className, event.target.accessibleName)
    ) {
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

    // Change event on native date input → complete
    if (event.eventType === 'change' && ctx.trigger.tag === 'INPUT') {
      const dateValue = event.valueAfter ?? (ctx.data.dateValue as string) ?? '';
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

  // W3C-standard semantic children for ownership testing.
  // Only role="gridcell" and native <td> are recognized as date cells.
  semanticChildRoles: ['gridcell'],
  semanticChildTags: ['TD'],
};
