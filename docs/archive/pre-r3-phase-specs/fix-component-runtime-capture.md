# Spec: Fix Component Runtime Capture Failures

## Problem

When a user performs a typical login flow (type username → type password → click Login), the extension captures:
- Empty text values (Enter "" in "Username" with "no typing detected")
- Missing password entry entirely
- Click on Login button misclassified as "Hover (interrupted)"

Three root causes in the Component Runtime pipeline:

### Bug 1: TextEntry abandoned before blur (text-entry.ts)
`shouldCancelOnOutside` triggers on `mousedown` on a different element. Browser event order is `mousedown → blur → click`. The TextEntry is abandoned on `mousedown` BEFORE `blur` fires, so it never completes. This especially affects the LAST text field before a submit button click (e.g., Password before Login).

### Bug 2: Text value not captured on blur (event-tap.ts)
`event-tap.ts` only sets `valueAfter` for `input`/`change` events (line 149). The `blur` event carries no value. If `input` events don't fire (autofill, paste via context menu, React controlled inputs suppressing native events), the text value is permanently lost.

### Bug 3: Hover swallows click events (hover.ts)
`hover.ts` `isInScope` returns `true` for ANY event on the same element (line 42-44), including `click`. When the user hovers a button then clicks it, the active Hover absorbs the click → returns null → marked handled → Click discovery never fires → click is silently lost.

## Files to Change

1. **`src/definitions/text-entry.ts`**
   - Remove `mousedown` from `shouldCancelOnOutside` — only cancel on `click` (which fires after `blur`, so TextEntry can complete naturally)
   - Capture `valueAfter` from `blur` event as a fallback

2. **`src/tap/event-tap.ts`**
   - Set `valueAfter` on `blur` events too (read `el.value` at blur time)

3. **`src/definitions/hover.ts`**
   - Exclude `click`, `mousedown`, and `contextmenu` from `isInScope` — only match hover-lifecycle events (`mouseenter`, `mouseleave`)

## Acceptance Criteria

- [ ] AC1: TextEntry completes with actual text value when user types in a field and clicks elsewhere
- [ ] AC2: TextEntry for password field is NOT abandoned — completes successfully with the typed value
- [ ] AC3: Click on a button is NOT absorbed by an active Hover — Click definition fires
- [ ] AC4: Hover still completes on `mouseleave` with dwell time as before
- [ ] AC5: Existing unit tests still pass (3256 tests)
- [ ] AC6: New unit tests cover each bug scenario specifically
- [ ] AC7: event-tap.ts captures `valueAfter` on `blur` events
- [ ] AC8: text-entry.ts reads `valueAfter` from `blur` event when `input` events were missed
