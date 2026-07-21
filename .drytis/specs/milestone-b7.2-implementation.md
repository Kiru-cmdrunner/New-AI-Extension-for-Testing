# Milestone B7.2 — Canonical Test Step Readability Optimizer Implementation

**Type:** Implementation
**Status:** Active
**Date:** 2026-07-15
**Depends on:** B7.1 (frozen), B7.2 Design Clarifications (frozen)

---

## Files to Create

1. `src/generation/engine/readability-optimizer.ts` — Pure functions implementing the optimizer
2. `tests/readability-optimizer.test.ts` — Unit tests for all optimizer functions

## Files to Modify

1. `src/generation/generators/canonical-step-generator.ts` — Integrate optimizer as post-processing pass
2. `tests/b53-validation.test.ts` — Update test helpers (value field on steps may change)
3. `package.json` — Version bump to 5.3.0
4. `src/manifest.json` — Version bump to 5.3.0

## Files NOT to Modify

- Interaction Timeline (read-only)
- Execution JSON Generator (consumes optimized steps, unaware of optimization)
- Playwright Generator (consumes Execution JSON, unaware of optimization)
- Generation Engine (invokes Canonical Step Generator, unaware of internal optimization)
- Locator Resolution Engine
- Content scripts (recorder layer)
- Storage Service

## Implementation Plan

### Step 1: Create `readability-optimizer.ts`

Pure functions:

- `isSameElement(a: ElementIdentity, b: ElementIdentity): boolean` — composite key (tag | stableId | cssSelector). Replaceable. Decision 1.
- `isInputElement(tag: string): boolean` — INPUT/TEXTAREA/SELECT. Condition C4.
- `applyRuleOR1(steps: CanonicalStep[]): CanonicalStep[]` — walks steps left-to-right. For each click step, checks if the next step is an adjacent text entry on the same input element. If all conditions hold, drops the click step. Renumber stepNumbers.
- `applyReadabilityRules(steps: CanonicalStep[]): CanonicalStep[]` — orchestrator. Applies OR-1. Has hook for OR-3 (no-op currently). Returns optimized steps.
- OR-2 is a no-op (no code needed — it prevents future merging of consecutive text entries).

### Step 2: Integrate into canonical-step-generator.ts

In `generate()`, after the step creation loop, before returning:

```typescript
const optimized = applyReadabilityRules(steps);
// Renumber stepNumbers for contiguous display
optimized.forEach((step, i) => { step.stepNumber = i + 1; });
return { status, output: optimized, errors };
```

### Step 3: Tests

Unit tests:
- OR-1 fires: click+text on same input element, adjacent → merged
- OR-1 fails: different elements → no merge
- OR-1 fails: non-adjacent (20 steps between) → no merge
- OR-1 fails: navigation between → no merge
- OR-1 fails: click on non-input (button) → no merge
- OR-1 fails: click+click (not text) → no merge
- Step ID preservation: merged step carries text entry's stepId
- Step number renumbering: gaps are filled
- Determinism: same input → same output
- Execution field preservation: elementIdentity, value, actionType unchanged

Integration tests:
- Optimized steps → Execution JSON Generator → verify fill action present
- Optimized steps → Playwright Generator → verify .fill() present, no unnecessary .click()

### Step 4: Regression

All 439+ tests pass. Full pipeline unchanged.

## Acceptance Criteria

- [ ] OR-1 merges focus-click + text-entry on same input element when adjacent
- [ ] OR-1 does NOT merge when any eligibility condition fails
- [ ] isSameElement() is replaceable (single function)
- [ ] OR-2 is documented as no-op constraint
- [ ] OR-3 hook exists (comment/structure) but no implementation
- [ ] Optimizer is pure function (deterministic, no side effects)
- [ ] Step IDs preserved (text entry's stepId retained)
- [ ] Step numbers renumbered for contiguous display
- [ ] No execution field modified by optimizer
- [ ] Full regression: all existing tests pass
- [x] Execution JSON from optimized steps is functionally equivalent
- [x] Playwright from optimized steps is functionally identical

---

## OR-1 Implementation Assumption (Pre-Freeze Documentation)

### The Assumption

The current implementation of OR-1 assumes that a click on a standard HTML
input element (`INPUT`, `TEXTAREA`, `SELECT`) is a **focus click** — its
only effect is placing focus on the input. When such a click is immediately
followed by a text entry on the same element, the click is safe to merge
into the text entry step.

This is an **implementation assumption**, not a permanent product guarantee.

### Why It Is Acceptable for the Current Recorder

1. **Standard browser behavior.** Clicking an `<input type="text">`,
   `<textarea>`, or `<select>` element places focus. The browser does not
   submit forms, navigate pages, or change application state in response
   to a click on these element types.

2. **Playwright `.fill()` auto-focuses.** The generated Playwright test
   uses `.fill()` for text entries. Playwright's `.fill()` method internally
   calls `focus()` on the element before setting the value. A preceding
   `.click()` is redundant — `.fill()` achieves the same focus state.

3. **C4 guard restricts scope.** The merge only fires for `INPUT`,
   `TEXTAREA`, `SELECT` tags. Custom components (`DIV`, `SPAN`, custom
   element names), `contenteditable` elements (typically `DIV`-based),
   and interactive elements (`BUTTON`, `A`) are all excluded. This
   eliminates the highest-risk categories.

### Known Boundary of the Assumption

The assumption holds for standard HTML input elements on standard web
applications. The boundary is:

| Scenario | Inside Boundary (assumption holds) | Outside Boundary (assumption may not hold) |
|---|---|---|
| Element type | `<input>`, `<textarea>`, `<select>` | `contenteditable` divs, custom web components, rich text editors |
| Click behavior | Pure focus — no side effects | Click triggers popup, calendar, validation UI, or state change |
| Framework | Standard HTML form controls | Frameworks that intercept `onclick` on inputs for application logic |

If a web application attaches meaningful `onclick` behavior to a standard
`<input>` element (e.g., an onclick handler that opens a date picker
calendar), removing the click would change behavior. This is rare in
practice — date pickers are typically custom components with non-INPUT
tags, which are excluded by C4.

The optimizer handles out-of-boundary cases **conservatively**: if the
element is not in the INPUT_ELEMENT_TAGS set, no merge. When uncertain,
the steps remain separate.

### Future Recorder Extensibility

The optimization rule (OR-1) is defined at the product level:

> **Merge a focus click and subsequent text entry only when both
> interactions refer to the same logical element and the click is a
> focus action.**

This product rule is permanently frozen.

What may change in the future is the **evidence** used to determine
whether the click is a focus action. Today, the optimizer uses element
tag type (C4: `INPUT`/`TEXTAREA`/`SELECT`) as a proxy for "this is a
focus click." This is the current implementation's best available evidence.

A future recorder could provide richer evidence:

| Future Capability | How It Strengthens OR-1 | Architecture Impact |
|---|---|---|
| Click intent classification | Recorder tags each click as `focus` or `action` based on event analysis | C4 condition becomes `clickStep.clickIntent === 'focus'` instead of tag check. Product rule unchanged. |
| Element behavior fingerprint | Recorder captures whether the element has `onclick`/`onfocus` handlers with side effects | C4 condition becomes `!clickStep.elementIdentity.hasClickHandler`. Product rule unchanged. |
| Application-level click semantics | Recorder distinguishes clicks that trigger state changes from clicks that only focus | C4 condition becomes `clickStep.isFocusOnly === true`. Product rule unchanged. |

**None of these future capabilities would change the product rule, the
optimizer architecture, the pipeline position, or the merge logic.** Only
the implementation of condition C4 (currently `isInputElement(tag)`)
would become more sophisticated. The rest of the optimizer — Decision 1
(same element), C1-C3 (action types, adjacency), the merge operation,
step renumbering — remains identical.

The optimizer is designed so that C4 is a single function call:
`isInputElement(clickStep.elementIdentity.tag)`. Replacing this with a
richer check is a one-line change that does not ripple through the
optimizer or the pipeline.

### Confirmation

- **No product rules changed.** OR-1's product definition (B7.1 §4.2) is unchanged.
- **No architecture decisions changed.** Pipeline position, generator contracts, and frozen milestones (B1–B6) are all preserved.
- **B7.2 is ready for permanent freeze.** The implementation assumption is documented, bounded, and replaceable. The optimizer faithfully implements the frozen design.
