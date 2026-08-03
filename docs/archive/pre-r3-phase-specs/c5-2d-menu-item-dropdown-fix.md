# C5.2D — ARIA Menu Dropdown Detection (role="menuitem")

## Confirmed Runtime Defect

**Date:** 2026-07-16  
**Source:** OrangeHRM live validation  
**Severity:** P1 — dropdown value selection not recorded as Select

### Problem

OrangeHRM's profile/user dropdown renders items as `<a role="menuitem">` inside a `<ul role="menu">`. When the user opens the dropdown and clicks "Support", the extension records:

1. Click on the `<i>` trigger icon → "i icon" (Click — icon guard works)
2. Click on `<a role="menuitem">Support</a>` → generic Click (WRONG — should be Select "Support")

### Root Cause

The select recorder (`select-content-script.ts`) only listens for `[role="option"]` elements. It does not recognize the ARIA menu pattern (`role="menu"` + `role="menuitem"`), which is semantically equivalent to a dropdown list for value selection.

The click recorder (`click-content-script.ts`) skips `[role="option"]` but does NOT skip `[role="menuitem"]` — so the selection falls through to a generic Click.

### Scope Constraint

NOT every `role="menuitem"` is a value selection. A `role="menuitem"` inside a context menu (right-click) or an application-level menu bar (File > Save) is a command/action, not a value selection.

**Detection criterion:** A `role="menuitem"` click is a Select when:
1. The menuitem is inside a `[role="menu"]`, AND
2. The `[role="menu"]` was opened from a trigger with `[aria-haspopup]` (dropdown trigger), AND
3. The menuitem does NOT trigger navigation (no `href` that changes the page)

If criterion 3 fails (the menuitem navigates), it's still recorded as a Click — we don't want to suppress navigation clicks. However, we still need to avoid the duplicate Click+Select problem.

**Revised approach:** For `role="menuitem"` inside `role="menu"`:
- Record as **Select** with the menu item's text as the value
- Suppress the duplicate **Click**
- The identity target is the dropdown trigger (the element with `aria-haspopup`), resolved the same way as portaled dropdowns

## Files to Modify

1. **`src/recorder/select-content-script.ts`**
   - Add `MENU_ITEM_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])'`
   - Add `handleMenuItemClick(event)` — mousedown handler that resolves the trigger, extracts value, records Select
   - Register the mousedown listener

2. **`src/recorder/click-content-script.ts`**
   - Add `MENU_ITEM_DROPDOWN_SELECTOR` to skip `role="menuitem"` elements inside `role="menu"` (after the select recorder has claimed ownership via `data-cmdrunner-handled`)
   - The select recorder's `claimOptionOwnership()` on the menuitem will set `data-cmdrunner-handled`, and the click recorder's `isOwnedByAnother()` already checks for that — so the skip will work naturally

3. **`tests/select-recording.test.ts`**
   - Test: `role="menuitem"` inside `role="menu"` → Select event
   - Test: no duplicate Click for menu-item selection
   - Test: OrangeHRM-style flow (icon trigger click + menu item select)
   - Test: existing Click on standalone menuitem (outside menu) still works

## Acceptance Criteria

- [ ] AC1: `role="menuitem"` inside `role="menu"` produces a **Select** event with the item's text as value
- [ ] AC2: No duplicate **Click** event for the same interaction
- [ ] AC3: The dropdown trigger icon click is still recorded as a **Click** (not suppressed)
- [ ] AC4: Existing interaction types and recording paths unaffected
- [ ] AC5: All 786+ existing tests pass
- [ ] AC6: New tests cover menu-item selection, no-dup, and trigger-click-preserved

## Known Limitations

1. Menu items that trigger navigation (e.g., `<a role="menuitem" href="/support">`) are still recorded as Select, not Click — the navigation itself is captured as a separate Navigation event. This is acceptable: the semantic action is "select Support from the dropdown", and the resulting navigation is a side effect.
2. `role="menuitemcheckbox"` and `role="menuitemradio"` are excluded — those are handled by the checkbox/radio recorder.
3. Context menus (right-click) are not distinguished from dropdown menus. Both use `role="menu"` + `role="menuitem"`. In practice, context menu selections are also value selections from a set, so this is semantically correct.
