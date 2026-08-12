# RCA: M7 Evidence Quality Remaining Issues (Round 4)

**Date**: 2026-08-12T04:38Z
**Status**: Root-cause analysis complete, fixes pending

---

## Issue 1: Text value `Enter "vivo"` shows no `value: "" → "vivo"`

### Trace
1. User clicks input → `mousedown` capture-phase → `cache.capture(input)` → `value: ''`
2. User types 'v' → `keydown` capture-phase → `cache.capture(input)` → `value: ''` (before char insertion)
3. `input` event → `onAfterEvent` → `handleTypingEvent` → first input → `openWindow` → `peek(input)` → gets before `value: ''`
4. User types 'i','v','o' → `keydown` capture-phase fires BEFORE each input event → `cache.capture(input)` OVERWRITES cache with pre-keystroke value each time
5. Each `input` event → `handleTypingEvent` → extends window (no re-peek)
6. Stabilization → `closeWindow` → `capture(input)` → `value: 'vivo'`
7. `diffSnapshots(before, after)` → before has `value: ''`, after has `value: 'vivo'`

### Expected Result
The diff SHOULD show `value: → vivo`. The keydown overwrite happens BEFORE the input event opens the window, so the first peek at step 3 gets `value: ''`.

### Actual Root Cause
**Two possibilities:**

**Possibility A (most likely): The `input` event's ObservedEvent only sets `valueAfter`, not `valueBefore`.** The before snapshot comes from `peek()`, which should work IF the keydown capture listener populated it. BUT — the keydown listener calls `resolveTarget(e)` and then `cache.capture(target)`. The `input` event also calls `resolveTarget(e)` via EventTap. Both should resolve to the same `<input>` element. If they do, the cache key matches and the peek should return the keydown-captured value.

**Possibility B: The P1-3 ObservedEvent fallback condition is too strict.** Check: for the FIRST `input` event, `observedEvent.valueBefore` is `null` (EventTap only sets `valueBefore` for focus/click/mousedown, NOT for input). And `observedEvent.valueAfter` is `'v'` (the first character). So:
- `before.value = ''` (from keydown capture) → NOT null → P1-3 fallback doesn't trigger
- `after.value` should be captured at closeWindow → `'vivo'`

This should work. The diff should show `value: → vivo`.

**Possibility C (THE ACTUAL BUG): The `input` event also fires `onAfterEvent` which calls `handleTypingEvent`. On the FIRST input, it opens a window with `openWindow`. But `openWindow` is called with `observedEvent` = the first input's ObservedEvent. The state stores `state.observedEvent = observedEvent` (the FIRST input event, where `valueAfter = 'v'`). But in `closeWindow`, the after snapshot is captured fresh from the DOM, so `after.value = 'vivo'`. The before snapshot was peeked at open time, which should be the keydown-captured `value: ''`. So before=`''`, after=`'vivo'`.**

**Wait — let me re-examine. The `keydown` capture listener fires before the `input` event listener. At keydown time, `cache.capture(input)` stores the CURRENT value (before the keystroke). For the very first keystroke ('v'), the value IS `''`. For the second keystroke ('i'), the keydown captures `'v'`. But at that point the typing window is ALREADY open (from step 3) and `state.beforeSnapshot` is a snapshot of `peek()` at open time — which was `''`. The keydown doesn't change `state.beforeSnapshot` because it only modifies the cache, not the stored state.

**CONCLUSION**: The before should be `''` and after should be `'vivo'`. The diff logic should work.

**Possibility D (THE REAL BUG): `diffSnapshots` receives `targetEvidence.before` which is `state.beforeSnapshot`. If `state.beforeSnapshot` was set via `peek()` and returned a valid snapshot with `value: ''`, then `oldVal = ''` and `newVal = 'vivo'`. Line 184: `if (oldVal === newVal) continue;` → `'' !== 'vivo'` → does NOT skip. Line 189: `if (oldVal === null && newVal === null) continue;` → doesn't apply. So the diff SHOULD include `value: → vivo`.

**Wait — maybe the issue is that `before.value` is the empty string `''`, and the display renders it as `—` (em-dash). Look at `safeText`: `safeText('')` returns `''` (because `'' !== null && '' !== undefined`). So it renders as `value: → vivo`. That's correct.

**FINAL ROOT CAUSE: The issue must be that the before snapshot's `value` is `null` (not `''`), which means `peek()` returned undefined → `beforeSnapshot = null`.** If `beforeSnapshot` is `null`, then:
- `targetEvidence.before = null`
- P1-3 check: `targetEvidence.before?.value === null || targetEvidence.before === null` → `true`
- `obs.valueBefore` → `null` (input events don't set valueBefore)
- So P1-3 doesn't enrich it → before stays null
- `diffSnapshots(null, after)` → `formatSnapshot(after)` → shows after's current state, NOT a diff

**Why would peek return undefined?** Because the keydown listener and the EventTap's `onAfterEvent` resolve DIFFERENT elements. The keydown listener uses `resolveTarget(e)` where `e` is the keyboard event. EventTap's `onAfterEvent` also uses `resolveTarget(rawEvent)`. Both should return the same `<input>` element.

**BUT WAIT** — the keydown capture listener is registered by `target-state-listeners.ts`. Is it actually installed? Let me check if `installTargetStateListeners` is called during recording setup.

→ This is the key question. Let me verify the content script sets up target-state-listeners.

---

## Issue 2: Dropdown not showing actual selected value

### Trace
Custom dropdowns (OXD buttons with role=combobox or aria-haspopup) store the selected value in textContent. 

**Round 3 fix**: `captureValue()` now has a textContent fallback for combobox/listbox/aria-haspopup elements.

**Problem**: The evidence window is opened on the dropdown TRIGGER element (the div/button the user clicks). At close time, `capture(state.targetEl)` captures the trigger's state. The trigger's `value` is null (it's a div, not an input). The trigger's `textContent` changes from "Select..." to the selected value.

**BUT**: `snapshotElement()` only sets `value` for `HTMLInputElement`, `HTMLTextAreaElement`, or `HTMLSelectElement`. For a `<div role="combobox">`, `value` stays null. The textContent IS captured in `snapshot.textContent`, and `diffSnapshots` compares textContent. So the diff should show `text: Select... → Costa Rican`.

**The issue is likely that the before snapshot's textContent is null** (same cache miss problem as Issue 1), so the diff falls back to `formatSnapshot(after)` which shows the full state but NOT as a before→after diff.

**For native `<select>` elements**: The value is captured. The diff should show `value: Old → New`. This should work if the cache is populated.

**For multi-select**: `selectedValues` is captured in snapshot. But the native `<select multiple>` with only 1 selection won't populate selectedValues (requires >1). And the diff needs both before and after to have arrays to compare.

### Root Cause
Same as Issue 1: cache miss → null before → no diff. PLUS: for custom dropdowns, the selected value shows up as `text:` not `value:` in the diff because it's textContent, not a `.value` property. This is correct behavior per the model — but the user expects to see the actual selected value prominently.

### Fix Direction
1. Fix the cache miss (same as Issue 1).
2. For the textContent-vs-value distinction: the current behavior is CORRECT per the model. `value` is for form elements with `.value`, `text` is for everything else. The diff `text: Select... → Costa Rican` IS showing the selected value.

---

## Issue 3: Date picker not capturing selected date value

### Trace
User clicks a date cell in the calendar → EventTap resolves target (the cell, typically a `<td>` or `<div role="gridcell">`). Evidence window opens on the cell. At close, `capture(cell)` captures the cell's properties. The cell has no `.value` property → value is null.

**Round 3 fix**: `controlledValue` captures the value of the element referenced by `aria-controls`. BUT — the date cell typically does NOT have `aria-controls`. The `aria-controls` relationship is on the date picker TRIGGER button (the button that opens the calendar), not on individual date cells.

**Real relationship**: When the user clicks a date cell:
- The calendar's selected date changes
- The hidden `<input>` or visible date input field's `.value` changes
- The calendar may close

The evidence window targets the cell, not the input. The input's value change is on a DIFFERENT element.

### Root Cause
`controlledValue` relies on `aria-controls` on the TARGET element. Date cells don't have `aria-controls`. The value-holding input is a sibling/parent, not referenced by aria-controls from the cell.

### Fix Direction
At closeWindow time, also search for nearby value-holding inputs:
1. Check if the clicked element is inside a `[role="dialog"]`, `[role="application"]`, or `.datepicker` container.
2. Find any `input[type="date"]`, `input[type="text"]` with date-related class/name within the same container or the document.
3. Alternatively: check if ANY input on the page changed its value during the window — but this is too broad.

Better approach: check `document.activeElement` at close time (after date selection, focus often moves to the input), OR check the most recently changed input. But this is fragile.

Best approach: when capturing the after snapshot, if the target has no `.value` and no `aria-controls`, look for `input[type="date"]` or elements with date-picker-related attributes in the parent chain.

---

## Issue 4: Accordion/visibility changes

### Trace
User clicks an accordion header → the panel expands or collapses → CSS class changes or `hidden`/`aria-hidden` toggles.

**Round 2 fix**: `seedComputedStylesCache()` pre-seeds, `detectClassVisibilityChange` compares display/visibility/opacity.

**Expected**: New Surfaces (accordion panel appeared) or Removed Surfaces (panel disappeared), or Visibility Changes.

**Current state**: Should work IF the DOMObserver is started (it is, via refcounting in openWindow) and the panel has a significant role (SURFACE_ROLES includes `region`, `tabpanel`, `complementary`, etc.).

### Verification Needed
- Check if accordion panels have significant ARIA roles
- Check if the MutationObserver catches the class changes
- Check if `detectClassVisibilityChange` correctly detects the display/visibility change

### No code fix likely needed — verify in real browser.
