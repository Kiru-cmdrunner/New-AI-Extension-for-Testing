# P0-8: Standalone Stepper (Independent Counter)

## Problem

Standalone steppers (quantity selectors, passenger counters, rating steppers)
exist outside dropdown surfaces. They are independent +/- button pairs where
clicking + or - adjusts a counter value. Currently these are captured as
individual Click interactions — the semantic relationship between consecutive
+ clicks on the same field is lost.

Example: Clicking + three times on "Adults" produces 3 separate Click events
instead of one "Increment Adults to 3" interaction.

## Architecture

**New `Stepper` ComponentDefinition at priority 28** (after Checkbox at 30,
before RadioButton at 40). Only triggers on elements matching `isStepperPlus()`
or `isStepperMinus()` — the same patterns used by Dropdown's subAction classifier.

### Lifecycle
```
Trigger: click on element matching isStepperPlus() or isStepperMinus()
         AND event has no surfaceId (not inside a Dropdown/ModalDialog surface)

Active:  accumulate +/- clicks. Group by field identity (ancestor proximity).
         Continue collecting clicks on +/- buttons.

Completion:
  - Click on a non-stepper element → completed (outside click)
  - Timeout (5s stale cleanup) → completed/interrupted
  - Flush (navigation) → completed (via shouldCompleteOnFlush)
```

### Field Grouping (DOM proximity)
Two stepper buttons belong to the same field if they share:
1. The same `cssSelector` prefix (parent container)
2. OR overlapping `ancestorClasses` patterns

Field name extraction reuses `extractStepperLabel()` from Dropdown, which
handles aria-label parsing, CSS selector inference, and ancestor class extraction.

### Exclusions
- Events with a surfaceId → defer to surface-owning session (Dropdown/ModalDialog)
- Events inside an active Dropdown/ModalDialog session → those claim via isInScope first

## Files to Change

1. `src/definitions/stepper.ts` — NEW definition
2. `src/definitions/index.ts` — register at priority 28
3. `src/shared/component-types.ts` — add 'Stepper' to InteractionType
4. `src/classifier/interaction-types.ts` — add 'Stepper' type, metadata, display
5. `src/generation/component-to-classifier-adapter.ts` — Stepper mapping
6. `src/generation/ir-bridge.ts` — Stepper → IRAction.CLICK (with delta metadata)
7. `src/sidepanel/interaction-renderer.ts` — Stepper display entry
8. `tests/runtime/stepper.test.ts` — unit tests

## Acceptance Criteria

- [ ] Clicking + three times on Adults → one Stepper interaction with delta=+3
- [ ] Clicking + on Adults then + on Children → two separate Stepper interactions
- [ ] Clicking - decrements correctly (delta tracking with negatives)
- [ ] Standalone steppers outside dropdowns are captured as Stepper type
- [ ] Steppers inside dropdown surfaces remain as Dropdown subActions (no interference)
- [ ] Stepper interactionSubtype correctly identifies increment vs decrement
- [ ] Field name is extracted (Adults, Children, Quantity, etc.)
- [ ] Existing 4,543 tests pass (zero regressions)

## Implementation Order

1. Create stepper.ts definition
2. Wire through all layers (types, adapter, IR bridge, renderer)
3. Write unit tests
4. Run full suite
5. Build + verify
