# Tier 1 Validation Fixes Spec

## Goal
Fix the two highest-priority findings from the expanded validation:
- T1-1 (GROUP-A, P1): `isInteractiveElement` gate blocks table/grid elements
- T1-2 (GROUP-D, P2): TextEntry requires focus→blur lifecycle, no fallback

## T1-1: Expand isInteractiveElement for table/grid roles + DragDrop drag-handle recognition

### Files to change
1. `src/definitions/patterns.ts` — Add `columnheader`, `rowheader`, `row` to INTERACTIVE_ROLES
2. `src/definitions/drag-and-drop.ts` — Add drag-handle class pattern detection before isInteractiveElement gate
3. `tests/validation-harness/multi-step-workflows.test.ts` — Update WF-04 assertion (should now produce interactions)
4. `tests/validation-harness/compound-interactions.test.ts` — Update CI-01 fixture (realistic drag handle)

### Acceptance Criteria
- [ ] WF-04 (data table): TH click produces ≥1 interaction
- [ ] WF-04: TR click produces ≥1 interaction  
- [ ] FW-AGG-02 (AGGrid header): produces ≥1 interaction
- [ ] CI-01 (mouse drag): produces ≥1 DragDrop interaction
- [ ] No regression in existing tests
- [ ] tsc --noEmit clean for src/

## T1-2: TextEntry fallback for input-only events

### Files to change
1. `src/definitions/text-entry.ts` — Add 'input' to triggerEventTypes; add fallback trigger when input arrives without active session

### Acceptance Criteria
- [ ] CI-04 (input-only): produces ≥1 TextEntry interaction
- [ ] No regression: focus→blur path still works identically
- [ ] No regression in golden master
- [ ] tsc --noEmit clean for src/

## Verification
- Full test suite passes (except pre-existing flaky benchmark)
- Golden master 131/131
- Validation harness: all tests pass
