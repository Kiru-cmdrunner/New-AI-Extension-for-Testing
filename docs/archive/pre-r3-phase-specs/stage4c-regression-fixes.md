# Stage 4c: Regression Fixes — Date Picker, Dropdown, Click Label, Checkbox

## Context

After Stage 4b fixes (date-format placeholder detection, large container suppression),
four regressions were found during manual OrangeHRM testing:

1. Date picker text input leaks as TextEntry via the `input` handler fallthrough
2. Custom (div-based) dropdowns not recorded as dropdown interactions
3. "Click I" — short container name bypasses large-container suppression
4. Checkbox accessible name empty — no OXD label resolution in V1

## Root Causes

### 1. Date Picker → TextEntry Leak
`isTextEntryElement()` now returns `false` for date triggers (correct). But the `input`
handler's "non-text-entry that fire input (rare)" path at line ~1281 sends the event
raw. The `change` handler correctly routes to `handleDateValueChange`, but the `input`
event fires first and leaks through.

### 2. Missing Dropdown Interactions
OrangeHRM uses `<div class="oxd-select-text">` div-based dropdowns. The V1 classifier
and CSS classname provider don't recognize `oxd-select` patterns. Additionally,
`isLargeContainerClick()` can suppress the dropdown wrapper if its innerText > 80 chars.

### 3. "Click I" Regression
`resolveTarget()` can resolve to a container DIV with a very short accessible name
(e.g., "I") via Strategy 2 (cursor:pointer) or Strategy 3 (raw target). The
`isLargeContainerClick` threshold (>80 chars) doesn't catch these — the name is 1 char.
Additionally, `[role="group"]` in INTERACTIVE_SELECTOR can hijack Strategy 1.

### 4. Checkbox Empty Accessible Name
`computeAccessibleName()` has no ancestor-walking label resolution. OrangeHRM
checkboxes have no `aria-label`, no wrapping `<label>`, and no `id` for `label[for]`.
The label is in a sibling `.oxd-label` element inside the `.oxd-input-group` ancestor.
The V2 identity-extractor already handles this but V1 does not.

## Fixes

### Fix 1: Suppress input events on date trigger elements
**File:** `src/recorder/deterministic-recorder.ts`, input handler (~line 1268)
Add early return for `isDateTriggerElement(target)` before the fallthrough.

### Fix 2: Recognize OXD div-based dropdowns
**File:** `src/classifier/evidence/providers/css-classname-provider.ts`
Add `oxd-select`, `oxd-dropdown` patterns to the dropdown detection.
**File:** `src/recorder/deterministic-recorder.ts`
Exclude dropdown wrapper elements from `isLargeContainerClick` suppression.

### Fix 3: Suppress clicks on containers with very short (non-meaningful) names
**File:** `src/recorder/deterministic-recorder.ts`, `isLargeContainerClick()`
Rename to `isContainerNoiseClick()` and add a lower bound: suppress containers
whose accessible name is ≤ 2 chars (likely noise — single letters, empty, icon glyphs).
Remove `[role="group"]` from INTERACTIVE_SELECTOR (structural role, not interactive).

### Fix 4: Port OXD label resolution to V1 computeAccessibleName
**File:** `src/recorder/deterministic-recorder.ts`, `computeAccessibleName()`
After the `el.closest('label')` check fails, walk up to 8 ancestors looking for:
- `.oxd-input-group` → query `.oxd-label`
- `role="group"` or `<fieldset>` → query `legend` or `.oxd-label`

## Acceptance Criteria

- [ ] Typing in a date trigger text input does NOT produce a TextEntry interaction
- [ ] Date trigger text input still produces a DatePicker interaction (via dateSelect)
- [ ] OXD div-based dropdown clicks are captured (not suppressed)
- [ ] Clicks resolving to containers with names ≤ 2 chars are suppressed
- [ ] "Click I" no longer appears — suppressed as container noise
- [ ] Legitimate single-char interactive elements (buttons with aria-label="I") are NOT suppressed
- [ ] Checkbox clicks produce a label (resolved from OXD ancestor)
- [ ] All existing tests still pass
