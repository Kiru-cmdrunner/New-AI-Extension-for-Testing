/**
 * Dropdown Definition — Combobox/Select Lifecycle (Priority 20)
 *
 * Triggers on click/mousedown/focus of a combobox/listbox/select/
 * aria-haspopup element. Completes when an option is selected.
 *
 * No-op detection: if the selected option's display name matches the
 * trigger's current display value (normalized), it's a no-op — the user
 * opened the dropdown and selected the already-selected option.
 *
 * Bug 2 fix: uses `||` not `??` for accessibleName/valueBefore comparison.
 * OXD combobox inputs have accessibleName='' (empty string), and `??`
 * doesn't fall through on empty strings.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4.2
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
  isDropdownTrigger,
  isDropdownOption,
  isInsideDropdownSurface,
  isInsideCalendarSurface,
  isCalendarCell,
  hasDateCellName,
  normalizeDisplayValue,
  bestName,
  elementKey,
  extractSemanticRoles,
} from './patterns';
import { DISCRETE_ACTION_TYPES } from '../runtime/evidence-ledger';

export const dropdownDefinition: ComponentDefinition = {
  type: 'Dropdown',
  priority: 20,
  triggerEventTypes: new Set<BrowserEventType>([
    'click', 'mousedown', 'focus',
  ]),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole, className } = event.target;
    const { ariaHasPopup, inputType } = event.domContext;

    // Standard dropdown triggers
    if (isDropdownTrigger(tag, ariaRole, className)) {
      return { type: 'Dropdown' };
    }

    // aria-haspopup="listbox" on any element
    if (ariaHasPopup === 'listbox') {
      return { type: 'Dropdown' };
    }

    // OXD-style: readonly text input with combobox wrapper
    if (tag === 'INPUT' && inputType === 'text' && event.domContext.readOnly) {
      // Check ancestor classes for combobox patterns
      const ancestorClasses = event.domContext.ancestorClasses.join(' ');
      if (isDropdownTrigger('', null, ancestorClasses)) {
        return { type: 'Dropdown' };
      }
    }

    return null;
  },

  // Capture surface role from aria-haspopup for ownership testing.
  // detectTrigger returns ComponentTrigger (not ctx), so surfaceRole is
  // captured in handleEvent when the first in-scope event arrives.
  // The runtime's lifecycleOwnsTarget() reads ctx.data.surfaceRole.

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // In scope if:
    // 1. Event is on the trigger element itself
    // 2. Event is on a dropdown option
    // 3. Event is inside the dropdown surface AND is not on an interactive
    //    element that has its own definition (e.g., a stepper +/- button
    //    inside a passenger selector popover). Those clicks must fall through
    //    to Click discovery so they're not swallowed.

    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);

    // Same element as trigger
    if (eventKey === triggerKey) return true;

    // Dropdown option — always in scope (this is the selection event)
    if (isDropdownOption(event.target.ariaRole, event.target.className)) {
      return true;
    }

    // Inside dropdown surface — but NOT if the event target is itself an
    // interactive element (button, link, etc.) with its own clear identity.
    // This prevents the dropdown from swallowing clicks on stepper buttons,
    // filter controls, and other interactive elements rendered inside
    // popover/modal surfaces.
    if (isInsideDropdownSurface(event.target.className) ||
        isInsideDropdownSurface(event.domContext.ancestorClasses.join(' '))) {
      // Let clearly interactive elements (buttons, links, checkboxes, etc.)
      // fall through to their own definitions instead of being claimed here
      const { tag, ariaRole } = event.target;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ||
          ariaRole === 'button' || ariaRole === 'link' || ariaRole === 'checkbox' ||
          ariaRole === 'radio' || ariaRole === 'spinbutton' || ariaRole === 'slider') {
        return false; // let Click/Checkbox/etc. definition claim it
      }
      return true;
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Capture surfaceRole from the trigger's aria-haspopup.
    // Used by runtime's lifecycleOwnsTarget() for positive ownership testing.
    if (!ctx.data.surfaceRole) {
      ctx.data.surfaceRole =
        ctx.triggerEvent.domContext.ariaHasPopup === 'listbox' ? 'listbox' : null;
    }

    // ── S3' (RCA2 2026-08-20): structural completion gating. ───────────
    // Calendar cells belong to the DatePicker definition — a calendar cell
    // click can NEVER complete a Dropdown lifecycle. Two structural signals:
    //   1. date-like CSS classes (DATEPICKER_CELL_CLASS_RE), and
    //   2. the W3C date-cell naming shape on the accessible name
    //      ("Choose Saturday, September 5th, 2026") — framework-agnostic.
    // This was the root cause of the AdaniOne Economy dropdown describing
    // "Choose Saturday, September 5th" (a role=option date-cell completing
    // a 12s-old passenger/cabin select). Structural exclusion — no timing.
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      (isCalendarCell(event.target.ariaRole, event.target.className) ||
        hasDateCellName(event.target.accessibleName, event.target.ariaLabel))
    ) {
      return null; // not a dropdown selection — never completes here
    }

    // Option click/mousedown → complete ONLY with positive containment proof
    if (
      (event.eventType === 'click' || event.eventType === 'mousedown') &&
      isDropdownOption(event.target.ariaRole, event.target.className)
    ) {
      // Containment proof (structural, mirrors the lifecycleOwnsTarget contract):
      //   (a) the option sits inside a dropdown surface class that is NOT a
      //       calendar surface, or
      //   (b) the lifecycle has a captured surfaceRole (aria-haspopup) and the
      //       option's DOM ancestry includes it.
      // Without proof (e.g., a bare role=option anywhere on the page), the
      // click is parked as a provisional selection; the lifecycle ends
      // abandoned (displaced) at the next different-target discrete event —
      // an event-sequence boundary, not a clock.
      const optionName =
        event.target.accessibleName || event.target.ariaLabel || '';

      const surfaceClassContainsDropdown =
        isInsideDropdownSurface(event.target.className) ||
        isInsideDropdownSurface(event.domContext.ancestorClasses.join(' '));

      const surfaceIsCalendar =
        isInsideCalendarSurface(event.target.className) ||
        isInsideCalendarSurface(event.domContext.ancestorClasses.join(' '));

      const hasContainmentProof =
        (surfaceClassContainsDropdown && !surfaceIsCalendar) ||
        ((ctx.data.surfaceRole as string | null) != null &&
          // Phase 6D.0: semantic-role parse — capture stores `div[role=listbox]`,
          // surfaceRole is the bare token 'listbox'.
          extractSemanticRoles(event.domContext.ancestorRoles).includes(
            ctx.data.surfaceRole as string,
          ));

      if (hasContainmentProof) {
        ctx.data.selectedValue = optionName;
        ctx.data.selectionConfirmed = true;
        return { endState: 'completed' };
      }

      // No proof — park the provisional selection; lifecycle continues.
      ctx.data.pendingOptionClick = { eventId: event.eventId, name: optionName };
      return null;
    }

    // Native SELECT change → provisional sample; complete on structural end.
    // P11 (spec §3b): a keyboard-driven native <select> fires a TRUSTED
    // change after every ArrowDown. Completing on the FIRST change pins an
    // intermediate option ("Low") while the user keeps driving to the final
    // choice ("high"). Same typed/committed family as 6C: record the sample,
    // keep the lifecycle open, and complete at the structural end — blur of
    // the same select (or the outside-action path). No timing.
    if (event.eventType === 'change' && ctx.trigger.tag === 'SELECT') {
      ctx.data.selectedValue = event.valueAfter ?? '';
      ctx.data.selectionConfirmed = true;
      ctx.data.nativeSelectActive = true;
      return null; // still active — the user may keep driving the select
    }

    // P11: blur of the same native select = the structural end of the
    // selection interaction. Complete with the LAST recorded change value;
    // blur valueAfter is identical by definition for native selects and
    // serves as a fallback when no change was observed (autofill-style flows).
    if (
      event.eventType === 'blur' &&
      ctx.trigger.tag === 'SELECT' &&
      ctx.data.nativeSelectActive === true
    ) {
      if (event.valueAfter != null && event.valueAfter !== '') {
        ctx.data.selectedValue = event.valueAfter;
      }
      return { endState: 'completed' };
    }

    // Click on trigger again (toggle close without selecting) → still active
    if (event.eventType === 'click' || event.eventType === 'mousedown') {
      const eventKey = elementKey(event.target);
      const triggerKey = elementKey(ctx.trigger);
      if (eventKey === triggerKey) return null; // still active
    }

    return null;
  },

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // S3' structural displaced-end: a parked (unproven) option click means the
    // user has interacted outside our controllable surface. The next discrete
    // action on a DIFFERENT element (event-sequence fact) ends the lifecycle
    // as abandoned (rendered displaced) instead of leaving it open for a
    // future stray option-role click to mis-attribute a selection.
    if (ctx.data.pendingOptionClick == null) return false;

    if (!DISCRETE_ACTION_TYPES.has(event.eventType)) return false;

    const eventKey = elementKey(event.target);
    const triggerKey = elementKey(ctx.trigger);
    if (eventKey === triggerKey) return false; // same element — keep waiting

    // A pending option click already parked the provisional selection; any
    // further different-target discrete event confirms the user moved on.
    return true;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const selectedValue = (ctx.data.selectedValue as string) ?? '';
    const triggerDisplay = ctx.trigger.accessibleName || ctx.triggerEvent.valueBefore || '';
    const triggerName = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
      ctx.trigger.className,
    );

    // No-op detection: selected value matches current display value
    // Bug 2 fix: using || not ?? for accessibleName/valueBefore comparison
    const normalizedSelected = normalizeDisplayValue(selectedValue);
    const normalizedDisplay = normalizeDisplayValue(triggerDisplay);
    const noOpSelection = normalizedSelected === normalizedDisplay && normalizedSelected !== '';

    // S3': a lifecycle that ended without containment-proven selection carries
    // honest metadata — the provisional (parked) option click name and an
    // explicit selectionConfirmed:false. Never fabricates a confirmed
    // "Select X from Y" when the selection evidence was not ours.
    const pending = ctx.data.pendingOptionClick as { eventId: string; name: string } | undefined;
    const selectionConfirmed = ctx.data.selectionConfirmed === true;

    const metadata: Record<string, unknown> = {
      targetName: triggerName,
      selectedValue,
      noOpSelection,
    };
    if (!selectionConfirmed && pending) {
      metadata.provisionalSelection = pending.name;
      metadata.selectionConfirmed = false;
    }

    return { metadata };
  },

  // W3C-standard semantic children for ownership testing.
  // Only role="option" and native <option> are recognized as dropdown items.
  semanticChildRoles: ['option'],
  semanticChildTags: ['OPTION'],
};
