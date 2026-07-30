# Task: Multi-Config Dropdown Accumulation + Done Detection + Autocomplete City Capture

## Problem Statement

After Phase 0b (Observation Model), dropdown cross-wiring is fixed. But four issues remain:

### Issue 1: Multi-config panel captures only first selection
**Symptom:** Economy dropdown has Adults counters, Children counters, Premium Economy options, Done button. Only "Premium Economy" is captured; Adults/Children increments are lost.
**Root cause:** `dropdown.handleEvent` returns `{ endState: 'completed' }` on the FIRST option click. The session is removed from the active stack. Subsequent selections inside the same surface have no session to claim them → fall through to Click discovery (or are lost entirely if they're non-interactive elements like stepper counter text).
**Fix:** Dropdown should ACCUMULATE selections instead of completing on first click. Complete only when: (a) Done/Apply button clicked inside surface, or (b) surface closes (outside click).

### Issue 2: Done button captured separately as "Click on Done dialog"
**Symptom:** "Done" appears as a separate Click interaction instead of completing the Dropdown session.
**Root cause:** `isInScope` returns false for `BUTTON` elements inside the surface (to let steppers fall through). Done button never reaches Dropdown's handleEvent. Since the Dropdown already completed on first option click (Issue 1), Done has no session anyway.
**Fix:** (a) Dropdown stays active (Issue 1 fix), (b) isInScope allows Done/Apply/Close buttons through, (c) handleEvent detects Done button click as completion signal.

### Issue 3: Missing city capture (Chennai not captured)
**Symptom:** User selects Chennai in "From" autocomplete and Bangalore in "To" autocomplete. Only Bangalore (int-19) is captured.
**Root cause:** When autocomplete suggestion is clicked inside an autocomplete surface, detectSurfaceClosure fires (the click is on an option-like element which may have surfaceId). OR the TextEntry session is interrupted by resolveConcurrentSessions because the suggestion click appears to be "inside a different surface".
**Fix:** Investigate TextEntry + autocomplete interaction. Ensure the suggestion click updates the TextEntry value and the TextEntry completes with the selected city name.

### Issue 4: Semantic form doesn't show all selections
**Symptom:** The semantic/playwright form only shows one selection per dropdown.
**Root cause:** Downstream of Issue 1 — if only one interaction is captured per dropdown, the pipeline can only show that one.
**Fix:** Fixed by Issue 1 fix (capture all selections).

## Acceptance Criteria

- [ ] Multi-config dropdown accumulates all selections (Adults, Children, Premium Economy) into a single Dropdown interaction
- [ ] Done button click completes the Dropdown session (not captured as separate Click)
- [ ] Regular dropdowns (Trip Type) still complete correctly (on option click that closes the surface, or on surface closure)
- [ ] Both From and To cities are captured in autocomplete flows
- [ ] Existing 4223+ tests still pass
- [ ] New tests cover: multi-select accumulation, Done completion, regular dropdown unchanged
- [ ] Build succeeds

## Files to Change

1. `src/definitions/dropdown.ts` — handleEvent accumulation, isInScope Done button, buildResult multiple values
2. `src/runtime/component-runtime.ts` — detectSurfaceClosure must not complete sessions on Done-button clicks (Done is handled by the definition)
3. `tests/observation-model/multi-config-dropdown.test.ts` — new tests
