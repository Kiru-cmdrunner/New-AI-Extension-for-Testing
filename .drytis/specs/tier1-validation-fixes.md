# Tier 1 Fixes — Validation-Driven P1 Issues

## Context
Phase 3 real-world validation identified 5 P1 issues that block common real-world interactions.
These are systemic architectural gaps, not edge cases. All fixes are refactoring/correction — no new features.

## Acceptance Criteria

### Fix 1: `change` Event Support (A4, A6, C2)
- [ ] DatePicker definition: add `'change'` to `triggerEventTypes`
- [ ] DatePicker definition: `detectTrigger` recognizes `<input type="date">` on `change` event
- [ ] Slider definition: add `'change'` to `triggerEventTypes`
- [ ] Slider definition: `detectTrigger` recognizes `<input type="range">` on `change` event
- [ ] Dropdown definition: add `'change'` to `triggerEventTypes`
- [ ] Dropdown definition: `detectTrigger` recognizes `<select>` on `change` event
- [ ] Validation tests A4, A6, C2 emit correct interaction type (not NONE)

### Fix 2: Relax `isInteractiveElement` Gate (C1, B3a, B3b)
- [ ] `dblclick` events bypass `isInteractiveElement` check (Click definition)
- [ ] `contextmenu` events bypass `isInteractiveElement` check (Click definition)
- [ ] Hover definition relaxes or removes interactive-element requirement for mouseenter
- [ ] Validation tests B3a (DoubleClick on TR), B3b (RightClick on TD), C1 (Hover on DIV) emit correct interaction type

### Fix 3: Playwright Iframe `frameLocator()` (F2)
- [ ] Playwright test renderer checks `target.inIframe` / `iframeContext`
- [ ] When `inIframe` is true, generates `page.frameLocator('...').locator('...')` pattern
- [ ] Validation test F2 produces Playwright code containing `frameLocator`

### Regression
- [ ] `tsc --noEmit` — zero errors
- [ ] Full test suite passes (excluding known flaky perf benchmark)
- [ ] Golden master: 130/130 pass
- [ ] Existing validation tests still pass (30/30)

## Out of Scope
- Evidence engine re-wiring (Tier 2)
- Assertion deriver expansion (Tier 2)
- OTP/TagInput/ToggleSwitch fixes (Tier 3)
- New definitions
