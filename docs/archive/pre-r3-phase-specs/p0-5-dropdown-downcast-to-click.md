# P0-5: Click Capture for False-Positive Triggers (Downcast Protocol)

## Problem

On AdaniOne's flight booking page, clicking "Armed Forces" (a fare-type button
card) is NOT captured in either the Observed Workflow or the IR Plan test steps.

**Root cause (TWO pathways):**

### Pathway 1: DragDrop absorbs mousedown/mouseup without click

On React SPAs, sometimes only `mousedown` + `mouseup` fire without a synthesized
`click` event. The DragDrop definition (priority 15) triggers on `mousedown` for
all non-excluded elements (DIV, etc.). When `mouseup` arrives with displacement <
threshold, DragDrop returns `{ endState: 'discarded' }`. Since no `click` event
reaches discovery, the interaction is lost. The `discarded` DragDrop is filtered
out of all output.

### Pathway 2: Dropdown claims click but never completes

When a `click` event DOES arrive, the Dropdown definition (priority 20) detects
a false-positive trigger via CSS class patterns (`fare-type`, `travel-class`,
`option`). A Dropdown session opens but no option is ever selected. On flush,
the Dropdown is `interrupted` and filtered out.

## Solution: Downcast Protocol

Add an optional `downcast(ctx, completion)` method to `ComponentDefinition`.
When a component is about to be completed with a non-completed endState (or
discarded), the runtime asks: "should this be converted to a simpler type?"

### DragDrop → Click downcast rule

A DragDrop that was discarded (displacement < threshold = it was a click, not
a drag) downcasts to Click. The drag was never real — the user just clicked.

### Dropdown → Click downcast rule

A Dropdown session that was interrupted/abandoned with no subActions, no
selectedValue, and no Done click downcasts to Click. The dropdown panel never
opened — the user just clicked a button.

## Files to Change

1. **`src/shared/component-types.ts`** — Add `downcast` method to `ComponentDefinition`
2. **`src/runtime/component-runtime.ts`** — Call `downcast` in `completeComponent`
3. **`src/definitions/dropdown.ts`** — Implement `downcast` for empty interrupted sessions
4. **`src/definitions/drag-and-drop.ts`** — Implement `downcast` for discarded drags

## Acceptance Criteria

- [ ] Clicking an element that triggers DragDrop but has <10px displacement produces a Click (not a discarded DragDrop)
- [ ] Clicking an element that matches Dropdown trigger patterns but doesn't open a panel produces a Click
- [ ] A real drag (displacement > threshold) still produces a DragDrop interaction
- [ ] A real dropdown with selected options still produces a Dropdown interaction
- [ ] Downcast Click appears in BOTH the side panel and the IR Plan (endState = 'completed')
- [ ] mousedown+mouseup without click event → Click (Pathway 1 fix)
- [ ] click event on fare-type element → Click (Pathway 2 fix)
- [ ] Zero regressions in existing test suite
