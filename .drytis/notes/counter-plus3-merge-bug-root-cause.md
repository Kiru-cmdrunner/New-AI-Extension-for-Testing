# Counter +3 Merge Bug — Root Cause & Fix

## Bug
On Adani One flight booking, passenger stepper buttons (Adults +, Children +, Infants +)
merged into a single "Counter +3" field in the side panel.

## Root Cause Chain
1. `extractIdentity()` (identity-extractor.ts:364) sets `elementId: ''` — this field
   is designed to be assigned by the background SW, but the EventTap pipeline never
   does this assignment.
2. In `buildResult()` (dropdown.ts), `targetElementId: s.target?.elementId` → always `''`
3. In `groupByField()` (structural-enrichment.ts:204), `elementId` was empty/falsy →
   line 207 `else if (elementId)` was FALSE → fell through → all stepper clicks merged
   into one generic "Counter" group key.
4. `inferCounterName()` also failed because Adani One stepper buttons don't have passenger
   keywords in their own CSS classes — the keywords are on ANCESTOR container elements.

## Fix (3 layers)
1. **groupByField fallback**: When elementId is empty, use `stableId` → then `cssSelector`
   as discriminator (structural-enrichment.ts). Different CSS selector = different button.
2. **Ancestor class search**: Both `extractStepperLabel()` (dropdown.ts) and
   `inferCounterName()` (structural-enrichment.ts) now search `ancestorClasses` for
   passenger-type keywords (adult, child, infant, etc.).
3. **Metadata preservation**: `buildResult()` now passes `targetAncestorClasses` and
   `targetStableId` in the stripped subAction metadata so enrichment can use them.

## Key insight
The regex for ancestor keyword matching uses `(?=\W|$)` lookahead instead of `(?:[-_a-z]*)?`
greedy capture — otherwise "adults-section" → "Adults section" instead of "Adults".

## Files changed
- `src/definitions/dropdown.ts` — extractStepperLabel + buildResult
- `src/enrichment/structural-enrichment.ts` — groupByField + inferCounterName
- `tests/enrichment/structural-enrichment.test.ts` — 4 new test cases
- `tests/definitions/stepper-capture-fix.test.ts` — 3 new test cases
