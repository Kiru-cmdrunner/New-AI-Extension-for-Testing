# Spec: Date Picker Classification + Spurious Hover Suppression

## Problem

Two bugs reported from flight booking page (Adani One) recordings:

### Bug 1: Date picker captured as CLK instead of DatePicker
When the user clicks a date in a calendar grid cell, the recorder captures it as a raw `click` event. The classifier (`interaction-detector.ts`) has **no date picker detection branch** — calendar cell clicks fall through to the generic `Click` catch-all (line 346). The `DatePicker`/`TimePicker`/`DateTimePicker` interaction types exist in `interaction-types.ts` but are in `TIER2_TYPES` ("requires future heuristics") and are never returned by `classifyGroup()`.

### Bug 2: Spurious MOUSEENTER events when opening/closing date picker
When the user hovers over a date trigger element (input/button), hover tracking starts via `startHoverTracking()`. When the user clicks to open the calendar, the calendar popup DOM appears → MutationObserver fires → `hoverMutationSeen=true` → after 300ms, a `mouseenter` event is sent. Similarly, when the calendar closes and the mouse moves, a new `mouseover` on whatever element is under the cursor starts fresh hover tracking that may detect the closing DOM mutation as a reveal.

**Root cause of spurious hover**: The hover skip filter at line 1184 checks if the *target* is inside a calendar container, but the date trigger element itself is NOT inside a calendar container when first hovered. The DOM mutation from calendar opening is indistinguishable from a real hover-triggered content reveal.

## Solution

### Fix 1: Date Picker Classification (`interaction-detector.ts`)

Add a new classification branch **before** the TextEntry and Click branches that detects date picker interactions. A group is a DatePicker interaction when:

**A. Native date input (INPUT with type=date/datetime-local/time/month/week)**:
- Detect via cssSelector matching `input[type="date"]`, `input[type="datetime-local"]`, etc.
- The `change` event on such inputs carries the date value.

**B. Calendar grid cell click** (the Adani One scenario):
- The clicked element is inside a calendar container — detected via className/cssSelector containing `calendar`, `datepicker`, `date-picker`, or via aria attributes (`role="grid"`, `role="gridcell"`, `data-date`, `data-day`).
- The accessible name or aria-label contains a date-like pattern (e.g., "Monday, July 20th, 2026", "20 Jul", "July 15").

**C. Date-like text input with value change** (text input whose placeholder/name/id/class contains date keywords: `date`, `depart`, `arrival`, `return`, `travel`, `journey`, `fly`, `calendar`):
- When a change event carries a date-like value (matching patterns like "Mon, 20 Jul", "20 July 2026", "20/07/2026").

Detection priority: **after** FileUpload/TextEntry check for native date inputs, **before** the Click catch-all for calendar cells.

### Fix 2: Hover Suppression (`deterministic-recorder.ts`)

Suppress spurious hover events in two ways:

**A. Skip hover tracking on date trigger elements**: When a `mouseover` target is a date-like element (placeholder/name/id/class/aria-label contains date keywords) or has `aria-haspopup` containing "calendar"/"dialog", skip hover tracking entirely. These elements produce calendar DOM mutations on click, not on hover.

**B. Cancel hover tracking on click**: When a `click` event fires, cancel any pending hover tracking (`clearHoverTracking()`). This prevents DOM mutations from a click-triggered calendar opening from being attributed to the preceding hover. The click handler already runs before the 300ms hover timer fires.

## Acceptance Criteria

- [ ] Clicking a calendar grid cell inside a `[class*="calendar"]` container classifies as `DatePicker` (not `Click`)
- [ ] Clicking a `[role="gridcell"]` or `[data-date]` element classifies as `DatePicker`
- [ ] Changing a native `input[type=date]` classifies as `DatePicker` (not `TextEntry`)
- [ ] Date-like text input (placeholder="Depart on") with date value change classifies as `DatePicker`
- [ ] A regular text input (placeholder="Enter name") still classifies as `TextEntry`
- [ ] A regular button click still classifies as `Click`
- [ ] Hover tracking is skipped when mouseover target has date-like attributes
- [ ] Hover tracking is cancelled when a click occurs (clearHoverTracking on click)
- [ ] Regular hover on a menu item with CSS reveal still works (not suppressed)
- [ ] All existing tests pass

## Files to Change

1. `src/classifier/interaction-detector.ts` — Add `isDatePickerInteraction()` helper + classification branch
2. `src/recorder/deterministic-recorder.ts` — Add date-trigger hover skip + clearHoverTracking() on click
3. `src/classifier/interaction-types.ts` — Move DatePicker/TimePicker/DateTimePicker from TIER2 to detection-ready
4. `tests/interaction-detector.test.ts` — Add date picker classification tests
5. `tests/smart-hover-detection.test.ts` — Add hover suppression during date interaction tests

## Test Plan

### Unit Tests (interaction-detector.test.ts)
- Calendar cell click inside `[class*="calendar"]` → DatePicker
- `[role="gridcell"]` click → DatePicker  
- Native `input[type=date]` change → DatePicker
- Date-like text input change → DatePicker
- Regular button click → Click (not DatePicker)
- Regular text input → TextEntry (not DatePicker)

### Unit Tests (deterministic-recorder / hover)
- Mouseover on date-like element → hover tracking NOT started
- Click fires → clearHoverTracking called (no pending mouseenter)
- Regular menu hover with CSS reveal → still produces mouseenter
