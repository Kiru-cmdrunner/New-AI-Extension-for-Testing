# Pre-Stage 5: Interaction Quality Improvements

## Context

After Stage 4 manual testing, the user observed four issues with the control engine's
interaction output. These must be fixed before Stage 5 (parallel validation) can produce
meaningful comparisons.

## Fixes

### Fix 1: Date Picker — Suppress Toggle Click

**Problem:** Clicking the date picker field/calendar-icon to open the calendar emits a
`Click` interaction. This is implementation detail — the semantic action is "select a date",
not "open calendar then select".

**Solution:** In `control-recorder.ts`, when a click lands on a native date input or a
date-picker toggle element (element with class matching calendar trigger patterns, or a
button/icon adjacent to a date input), suppress the click event. Only the `dateSelect`
event (emitted by `handleDateValueChange`) should represent the interaction.

**Detection of date picker toggle:**
- Click on `<input type="date|datetime-local|month|week|time">` → suppress, defer to onChange
- Click on element whose class matches `/date.*picker|calendar|oxd-date-input-icon/i`
  AND is inside a container that also contains a date input → suppress

**Acceptance criteria:**
- [ ] Clicking a native date input does NOT produce a Click interaction
- [ ] Clicking an OXD date picker calendar icon does NOT produce a Click interaction
- [ ] Selecting a date from the calendar produces exactly ONE DatePicker interaction
- [ ] Typing a date into a native date input produces exactly ONE DatePicker interaction
- [ ] Multiple rapid date selections (debounce window) produce ONE DatePicker interaction

### Fix 2: Hover — Suppress Unintentional Hovers

**Problem:** Every `mouseenter` on a control produces a `Hover` interaction. Moving the
mouse across the page floods the timeline.

**Solution — two-layer filtering:**

**Layer 1 (capture): Minimum dwell time + cooldown after click**
- `mouseenter` events are buffered for 500ms
- If a `mouseleave` or `click` arrives before 500ms, the hover is suppressed
- After any `click` on an element, suppress `mouseenter` on that element for 2000ms
  (cooldown prevents hover noise from the click → label → hover pattern)

**Layer 2 (recognition): Click-cancels-hover rule**
- In `interaction-recognizer.ts`, if a `Hover` interaction on element X is immediately
  followed by a `Click` or `TextEntry` on the same element X within 2000ms, the Hover
  is suppressed (the click/text-entry is the primary action)

**Acceptance criteria:**
- [ ] `mouseenter` followed by `mouseleave` within 500ms does NOT produce a Hover
- [ ] `mouseenter` followed by `click` on same element within 2000ms does NOT produce a Hover
- [ ] `mouseenter` followed by `click` on same element within 2000ms does NOT produce a Hover
- [ ] `mouseenter` with dwell > 500ms and no subsequent action DOES produce a Hover
- [ ] After clicking an element, `mouseenter` on that element within 2000ms is suppressed
- [ ] Hovering on an element for > 500ms with no subsequent interaction produces a Hover

### Fix 3: Expandable Developer View for Raw Evidence

**Problem:** Every interaction card shows `[focus, click, change, blur]` as flat text.
Low-level DOM events are exposed to end users.

**Solution:** Restructure `createDetectedInteractionElement()` to have two sections:
1. **Summary** (always visible): type badge, interaction ID, action description
2. **Developer details** (collapsed by default): raw event types, confidence, engine badge

Add a `▶ Details` / `▼ Details` toggle button using the existing `.collapsible-toggle`
pattern. The toggle reveals/hides the detail section.

**Acceptance criteria:**
- [ ] Raw event types `[focus, click, change, blur]` are NOT visible by default
- [ ] A `▶ Details` toggle button appears on each interaction card
- [ ] Clicking the toggle reveals raw event types, confidence, and engine badge
- [ ] Clicking again hides them
- [ ] The toggle state is per-card (independent of other cards)
- [ ] CSS matches the existing `.collapsible-toggle` visual pattern

### Fix 4: Confidence — Move to Developer View

**Problem:** Confidence percentages (85%, 86%, 80%) are visible on every card and may
not be meaningful to end users.

**Solution:** Move confidence percentage into the developer details section (along with
raw event types). Remove from the default-visible summary.

**Acceptance criteria:**
- [ ] Confidence percentage is NOT visible by default
- [ ] Confidence percentage appears when developer details are expanded
- [ ] No layout shift or visual artefact when confidence is absent

## Test Strategy

- Unit tests for recognizer hover suppression logic
- Unit tests for recognizer date picker grouping
- Unit tests for timeline renderer expandable section
- Manual verification after rebuild

## Out of Scope

- Smart-hover with MutationObserver / CSS analysis (deferred — the click-cancels-hover
  rule handles the most common case)
- Removing hover interactions entirely (they have value for tooltip testing)
- Changing the IR bridge or Playwright output
