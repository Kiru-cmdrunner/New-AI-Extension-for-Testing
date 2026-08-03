# Stage 4b: Date Picker Semantic Merging + Large Container Click Suppression

## Context

After the Stage 4 UX improvements (developer-details view, hover suppression),
the user observed two remaining issues during manual testing on OrangeHRM:

1. **Date picker interactions are split** — selecting a date produces separate
   "Text Entry" (`Enter yyyy-mm-dd`) and "Popover" interactions instead of a
   single `DatePicker` interaction.
2. **Large-container clicks are captured as noise** — clicking on/within a form
   section produces multiple `Click 'Employee Full Name Nickname Employ...'`
   interactions from the container's concatenated `innerText`.

## Root Cause Analysis

### Issue 1: Date Picker — three root causes

**A. `isDateTriggerElement()` doesn't recognize date-format placeholders.**
The OrangeHRM date input uses `<input type="text" placeholder="yyyy-mm-dd">`.
The placeholder "yyyy-mm-dd" does NOT match `DATE_TRIGGER_KEYWORDS` (which looks
for words like "date", "depart", "calendar"). So `isDateTriggerElement()`
returns `false`, the change event is NOT routed to the date handler, and no
`dateSelect` event is emitted.

**B. Focus/blur on date text inputs still recorded as TextEntry.**
Even if the change event were routed correctly, `isTextEntryElement()` returns
`true` for `type="text"` inputs. So focus → blur events are recorded and
classified as `TextEntry`.

**C. Click that opens calendar popover produces Popover evidence.**
Clicking the date input opens a calendar popover. `detectSurfaceAfterClick()`
detects it via class patterns and sets `surfaceType: 'popover'`. Since the date
input is NOT inside the calendar popover, `ownedByDatePicker` is not set.
The MutationProvider emits `Popover` evidence (weight 0.75).

### Issue 2: Large-container clicks

`resolveTarget()` falls through to Strategy 2 (cursor:pointer) or Strategy 3
(raw target) when no interactive element is found in `composedPath()`. For large
form containers (e.g., OrangeHRM's `<div class="oxd-form-row">` wrapping
"Employee Full Name", "Nickname", etc.), this resolves the click to the
container itself. `computeAccessibleName()` returns `el.innerText` (up to 200
chars), producing the "Employee Full Name Nickname Employ..." label. There is
no existing filter to suppress clicks on large containers.

## Fixes

### Fix A: Recognize date-format placeholders

**File:** `src/recorder/deterministic-recorder.ts`
**Function:** `isDateTriggerElement()`

Add `isDateFormatPlaceholder(str)` that splits the string by delimiters
(`-/_./\s`) and checks if ≥ 2 tokens are standard date format tokens
(`yyyy`, `yy`, `mm`, `m`, `dd`, `d`).

Call it on `placeholder` and `ariaLabel` in `isDateTriggerElement()`.

Examples it must match: `yyyy-mm-dd`, `mm/dd/yyyy`, `dd-mm-yyyy`, `yyyy.mm.dd`.
Examples it must NOT match: `Enter your name`, `admin@example.com`.

### Fix B: Don't treat date trigger text inputs as text entry

**File:** `src/recorder/deterministic-recorder.ts`
**Function:** `isTextEntryElement()`

After confirming the input is a text-type input, check `isDateTriggerElement()`.
If true, return `false` — the date picker capture system handles the
interaction.

### Fix C: Tag calendar-popover-opening clicks on date triggers

**File:** `src/recorder/deterministic-recorder.ts`
**Function:** click handler's `detectSurfaceAfterClick` callback

After surface detection, if the surface looks like a calendar (class matches
`calendar|datepicker|date-picker`) AND the click target is a date trigger
element, set `mergedCtx.ownedByDatePicker = true`. This causes:
- V1 classifier to skip the click event
- V2 evidence engine to skip the click event
- MutationProvider to skip Popover evidence

### Fix D: Suppress large-container clicks

**File:** `src/recorder/deterministic-recorder.ts`
**Function:** click handler

Add `isLargeContainerClick(el)` — returns true when:
1. Tag is structural (`DIV`, `SECTION`, `FIELDSET`, `ARTICLE`, `MAIN`, `FORM`,
   `UL`, `OL`, `TABLE`, etc.)
2. `computeAccessibleName(el).length > 80`

In the click handler, after `resolveTarget()` and before further processing,
if `isLargeContainerClick(target)` is true, suppress the click (return early).

## Acceptance Criteria

### Date Picker
- [ ] `<input type="text" placeholder="yyyy-mm-dd">` is recognized as a date trigger
- [ ] Focus/blur events on date trigger text inputs are NOT recorded
- [ ] Clicking a date trigger text input that opens a calendar popover does NOT produce Popover evidence
- [ ] Selecting a date from the calendar produces exactly ONE DatePicker interaction
- [ ] Typing a date into a date trigger text input produces exactly ONE DatePicker interaction
- [ ] The DatePicker interaction includes the correct date value
- [ ] Existing date picker tests still pass (calendar-popover-suppression, date-picker-e2e)

### Large Container
- [ ] Clicks on large containers (accessible name > 80 chars) are suppressed
- [ ] Clicks on specific interactive elements (buttons, links, inputs) are NOT suppressed
- [ ] Clicks on containers with short accessible names (< 80 chars) are NOT suppressed
- [ ] Form field interactions (text entry, radio, checkbox, select) are NOT affected

## Test Strategy

- Unit tests: date format placeholder detection
- Unit tests: isTextEntryElement returns false for date triggers
- Unit tests: large container click suppression
- Unit tests: existing date picker tests still pass
- Build the extension and verify no TypeScript errors
