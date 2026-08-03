# Calendar & Dropdown Capture Fix on Modern Apps (adanione.com)

## Problem
On modern React SPA apps like adanione.com, three capture failures occur:

1. **Dropdown clicks not recognized**: Clicking "Premium Economy" travel class
   option inside a passenger/class dropdown popover is NOT captured. The click
   event target (a div/span option) is silently dropped.

2. **Date picker captures stale value**: When user selects a date in the
   calendar, the recorder captures the date that was ALREADY in the field,
   not the newly-selected date. The SPA's async React update happens AFTER
   the post-click value check fires (50ms), so the value hasn't changed yet.

3. **City autocomplete captures stale value**: Same root cause as #2 for
   departure/arrival city selection — the displayed value is read too early.

## Root Causes

### RC1: Dropdown options inside a surface without recognizable CSS classes
`isDropdownOption` requires ARIA role=option OR specific CSS class patterns
(`oxd-select-option`, `select-option`, `option-item`, `list-option`,
`ant-select-item`). AdaniOne renders options as plain divs/spans inside the
popover surface with no role and custom class names. They pass the surface
check but `handleEvent` returns null (never completes), so the click is lost.

### RC2: POST_CLICK_CHECK_DELAY_MS (50ms) is too short for heavy SPAs
React state batching + re-render on heavy SPA pages like AdaniOne routinely
takes 100-300ms. The 50ms post-click check fires before the framework has
flushed the new value to the DOM, so `captureValue` reads the OLD value.
The synthetic change event is never emitted (old === new).

### RC3: Date input value never updates in the trigger's DOM element
AdaniOne date picker writes the selected date into a DISPLAY div/span, NOT
back into the trigger input element. `captureValue` reads `el.value` on an
INPUT element, but the actual displayed value lives in a sibling display
div. The post-click check on the trigger element never sees a change.

## Files to Change

### src/tap/event-tap.ts
- Increase `POST_CLICK_CHECK_DELAY_MS` from 50 → 150ms to allow SPA
  frameworks time to flush state updates.
- Add a **multi-poll** post-click check: schedule value reads at 50ms,
  150ms, and 400ms. If any poll detects a value change, emit the change
  event. Stop polling after a change is detected.

### src/tap/identity-extractor.ts
- Expand `captureValue` to also read `aria-valuetext`/`aria-valuenow` on the
  trigger element (already present but after the input check — reorder so
  ARIA value is checked before falling through to descendant lookups).
- Add a **display-value fallback**: when the tracked element is inside a
  container that has a display div/span showing the current value, read the
  container's visible text. This catches React date/class selectors that
  render the value in a sibling display element rather than the input.

### src/definitions/patterns.ts
- Broaden `DROPDOWN_OPTION_CLASS_RE` to catch more SPA option patterns.
- Add a new `isDropdownOptionWithFallback` that detects option-like elements
  inside a dropdown surface even without recognizable CSS classes — same
  pattern as `isCalendarCellWithFallback`.
- Broaden `DROPDOWN_TRIGGER_CLASS_RE` and `DROPDOWN_SURFACE_CLASS_RE` with
  more SPA class tokens.

### src/definitions/dropdown.ts
- In `isInScope`: when inside a dropdown surface and the target is a
  clickable option-like element (per the new fallback), keep it in scope so
  `handleEvent` can complete it. Currently these fall through to Click
  discovery, which captures the click but the Dropdown lifecycle never
  completes, so the SELECTED VALUE is lost.
- In `handleEvent`: add a fallback path — if the click is inside a dropdown
  surface and the target has a non-empty accessibleName, treat it as a
  selection and complete with that name as `selectedValue`.

### src/definitions/date-picker.ts
- Mirror the dropdown fix: if a click inside the calendar surface has a
  date-like accessibleName (already handled by isCalendarCellWithFallback)
  but the post-click value poll couldn't read the new value from the
  trigger, fall back to using the clicked cell's accessibleName as the
  selected date.

## Acceptance Criteria
- [ ] Clicking "Premium Economy" inside a passenger/class dropdown popover
      on a React SPA produces a Dropdown interaction with selectedValue =
      "Premium Economy".
- [ ] Selecting a date in a React calendar produces a DatePicker interaction
      with the NEWLY selected date (not the stale prior value).
- [ ] Selecting a city in a React autocomplete produces the correct new
      value, not the stale prior value.
- [ ] All existing unit tests in tests/evidence-engine/ still pass.
- [ ] New unit tests cover the AdaniOne-style event sequences for dropdown
      option click, date selection, and autocomplete selection.

## Tests
- New test file: `tests/evidence-engine/modern-spa-calendar-dropdown.test.ts`
- Test cases:
  1. Dropdown option click inside a surface, no ARIA role, custom class
     → produces Dropdown with selectedValue.
  2. Date cell click inside calendar surface where trigger value never
     updates (value in display div) → produces DatePicker with cell text.
  3. City autocomplete option click where post-click value poll sees the
     change after a longer delay → produces correct value.
  4. Regression: OrangeHRM (OXD) dropdown still works correctly.
  5. Regression: native <select> dropdown still works.
