# Spec: Missing Interaction Types + Checkbox Double-Capture Fix

## Problem 1: Checkbox captures twice (Check + Uncheck)
- **Root cause:** OXD renders `<div class="oxd-checkbox-wrapper"><label><input type="checkbox"/><span class="oxd-checkbox-input">`. When user clicks the label/span, browser fires a synthetic click on the input. Two Checkbox interactions emit because they have different element keys (span vs input) and different checked states.
- **Fix:** Checkbox `buildResult` should use `checkedAfter` if available (from change event). If only `checkedBefore` from click, DON'T negate it — same pre-click activation bug as radio: `checkedBefore` is already the NEW state at click time. Fix: for click events on checkboxes, use `checkedBefore` directly as the new state (it's the post-toggle state).
- **Dedup fix:** Cross-element dedup for checkbox — if two Checkbox interactions on sibling elements in the same wrapper fire within 200ms, keep only the first.

## Problem 2: Missing interaction types (Slider, Tab, FileUpload)
- **Types defined in InteractionType but no definition registered:**
  - `Slider` — `isSlider()` exists in patterns.ts but no definition file
  - `Tab` — `isTab()` exists but no definition file  
  - `FileUpload` — `isFileInput()` exists but no definition file
- **Fix:** Create definition files for each, register in index.ts

## Problem 3: Sort and Grid not recognized
- These are button/link elements with specific classes. They currently fall through to Click, which is semantically correct — Click IS the right interaction. No separate Sort/Grid types needed.

## Acceptance Criteria
- [ ] Checkbox: single interaction emitted per user toggle action
- [ ] Checkbox: `checked` state reflects the NEW state correctly
- [ ] Slider definition created and registered (priority 25)
- [ ] Tab definition created and registered (priority 75)
- [ ] FileUpload definition created and registered (priority 35)
- [ ] All 3,333+ existing tests pass
- [ ] New tests for each fix
