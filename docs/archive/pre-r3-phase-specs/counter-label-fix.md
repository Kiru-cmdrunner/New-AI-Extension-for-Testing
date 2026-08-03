# Spec: Counter Label Fix for Icon-Only Stepper Buttons

## Problem
When recording on Adani One flight booking, passenger stepper buttons (Adults +, Children +, Infants +) merge into a single "Counter +3" field because:

1. `elementId` is always `''` in the EventTap pipeline (never assigned by SW).
2. `groupByField()` falls through to generic "Counter" key when elementId is empty.
3. `inferCounterName()` fails when stepper buttons lack passenger keywords in their own CSS classes.
4. `extractStepperLabel()` returns `''` when aria-label, accessibleName, CSS selector, and className all lack context.

## Root Cause Analysis

### Identity pipeline
- `extractIdentity()` sets `elementId: ''` — this field is designed to be assigned by the SW, but the EventTap pipeline never does this assignment.
- The full `ElementIdentity` (with CSS selector, XPath, stableId, className) IS available at capture time and IS stored on the target.
- The issue is only in `groupByField()` using `elementId` (always empty) instead of other available discriminators.

### Available discriminators that ARE preserved
- `cssSelector` — generated from tag+nth-of-type chain (e.g., `div > div:nth-of-type(1) > button`)
- `stableId` — element's `id` attribute
- `testId`, `dataCy`, `dataQa` — data attributes

## Fix Strategy

### Layer 1: Preserve ancestor context in buildResult (dropdown.ts)
Add `targetAncestorClasses` to the stripped subAction metadata so the enrichment layer can use nearby context labels.

### Layer 2: Better grouping fallback (structural-enrichment.ts groupByField)
When `elementId` is empty, use `cssSelector` as the discriminator instead of merging into one group.

### Layer 3: Enhanced inferCounterName (structural-enrichment.ts)
Search ancestor classes for passenger-type keywords (adult, child, infant, etc.).

### Layer 4: Better label extraction (dropdown.ts extractStepperLabel)
Look at ancestor classes for label context when the button itself lacks labels.

## Acceptance Criteria

- [ ] Three stepper clicks on different buttons (no aria-label, no elementId, no passenger CSS keywords on button itself, but distinct CSS selectors) → 3 separate "Passenger 1/2/3" fields with delta +1 each.
- [ ] Stepper buttons whose ANCESTORS have passenger keywords (e.g., ancestor class "adult-row") → labeled "Adults", "Children", etc.
- [ ] Stepper buttons with aria-labels "Increase Adults" etc. → labeled "Adults" (existing behavior preserved).
- [ ] Multiple clicks on the SAME stepper button → grouped correctly as a single counter field with correct delta (e.g., delta=+3).
- [ ] Existing structural-enrichment tests still pass.
- [ ] The summary text reads naturally: "Configure Economy: Adults +1, Children +1, Infants +1, Premium Economy, Done" instead of "Counter +3".

## Files to Change
1. `src/definitions/dropdown.ts` — extractStepperLabel: add ancestor class search; buildResult: preserve ancestorClasses
2. `src/enrichment/structural-enrichment.ts` — groupByField: CSS selector fallback; inferCounterName: ancestor class search
3. `tests/enrichment/structural-enrichment.test.ts` — new test cases
4. `tests/definitions/stepper-capture-fix.test.ts` — new test cases
