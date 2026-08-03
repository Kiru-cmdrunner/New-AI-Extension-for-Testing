# Bug Fixes: Forward Navigation + role=button Dead Code

## Bug 1: Forward Navigation Not Detected by V2

**File:** `src/classifier/evidence/engine.ts` (line 278-283)
**Problem:** `emitNavigationInteraction()` checks `transitionType.includes('reload')` → Refresh, `transitionType.includes('forward_back')` → Back, but never checks for forward navigation. The browser's `forward_back` transition type covers both directions, but V1 separately checks `transition === 'forward'`. V2 is missing this case.
**Fix:** Add forward detection to the navigation type logic.

## Bug 2: role=button Dead Code (Click + ToggleSwitch)

**File:** `src/classifier/evidence/providers/aria-provider.ts` (lines 56, 84)
**Problem:** The ToggleSwitch override at line 84 (`if (role === 'button' || role === 'switch')`) is INSIDE the `if (role && role in ROLE_TYPE_MAP)` block at line 56. But `'button'` is NOT in `ROLE_TYPE_MAP`. So:
- `role=button` never enters the block → never checked for ToggleSwitch → never emits Click
- A button with `aria-pressed` is silently ignored by V2
- A button without `aria-pressed` gets no AriaProvider evidence at all

**Fix:** Add `'button': 'Click'` to `ROLE_TYPE_MAP`. The ToggleSwitch override at line 84-98 runs first (inside the block), pushes ToggleSwitch evidence + returns early when aria-pressed/checked is present. Otherwise, the generic push at line 101 emits Click evidence.

## Acceptance Criteria

- [ ] Forward navigation produces `Forward` interaction type from V2
- [ ] `role=button` without aria-pressed emits `Click` evidence from AriaProvider
- [ ] `role=button` with aria-pressed emits `ToggleSwitch` evidence from AriaProvider
- [ ] `role=button` with aria-checked emits `ToggleSwitch` evidence from AriaProvider
- [ ] `role=switch` with aria-pressed still emits `ToggleSwitch` (no regression)
- [ ] Existing `<button>` tag detection from DomProvider is unaffected
- [ ] All existing tests pass
- [ ] New tests cover all 4 scenarios above
