# Fix: Stepper +/- Buttons Not Captured in Dropdown Panels

## Problem
On the Adani OneApp flight booking page (and similar React SPAs), clicking the
"+" button to increment Adults or Children passenger counts inside the passenger
dropdown panel is NOT captured by the recorder. "Premium Economy" selection and
"Done" button clicks ARE captured correctly.

## Root Causes

### RC1: Regex `\b` word boundary doesn't match standalone `+`/`-` characters
**File:** `src/definitions/dropdown.ts` L81-82
```typescript
const STEPPER_PLUS_RE = /\b(increase|add|plus|\+)\b/i;
const STEPPER_MINUS_RE = /\b(decrease|remove|minus|less|-)\b/i;
```
The `\b` (word boundary) before `\+` does NOT match when the string is literally
`"+"` because `+` is a non-word character. There is no word boundary between the
start of string and a non-word char. So `isStepperPlus` returns `false` even when
the button's accessibleName is `"+"`.

### RC2: Icon-only stepper buttons have no text → accessibleName is empty → classifySubAction returns null
**File:** `src/definitions/dropdown.ts` L99-192
When a stepper "+" button contains only an SVG icon (no text, no aria-label),
`computeAccessibleName` returns `''`. Then `bestName('', null, null)` returns
`'element'`. The generic click fallback at L181 checks `label !== 'element'` which
is `false`, so `classifySubAction` returns `null`. The click is silently swallowed
by the active Dropdown session.

### RC3: detectSurfaceClosure prematurely kills the Dropdown session on stepper clicks
**File:** `src/runtime/component-runtime.ts` L717-753
When the Dropdown session uses CSS-class fallback (no surfaceId), and the user
has already made a selection (e.g., "Premium Economy" → `hasSelections = true`),
clicking a "+" button that doesn't have a surface-matching CSS class causes the
session to be completed and removed from the active stack. Unlike Done/Apply
buttons, stepper buttons have NO protection from premature closure.

## Fixes

### Fix 1: Rewrite stepper regexes to handle standalone `+` and `-`
Replace the `\b`-bounded regexes with patterns that match:
- Word forms: "increase", "add", "plus", "decrease", "remove", "minus", "less"
- Symbol forms: standalone `+` or `-` characters
- CSS-class-driven stepper buttons (detected via className patterns)

### Fix 2: Add CSS class + tag-based detection for icon-only steppers
The `isStepperPlus`/`isStepperMinus` functions should also check:
- `className` for stepper-related CSS patterns (e.g., "plus", "increment", "add-btn", "pax-plus")
- `tag === 'BUTTON'` with icon-only content (accessibleName is empty but className matches stepper pattern)

When an icon-only stepper is detected, `classifySubAction` must return an
`increment`/`decrement` subAction with a descriptive label derived from the
CSS class or a generic "stepper" label — NOT silently return `null`.

### Fix 3: Protect stepper buttons from premature session closure
In `detectSurfaceClosure`, add stepper button detection alongside the existing
Done/Apply button protection. If the click is on a stepper button (detected via
accessibleName `+`/`-`, aria-label, or CSS class), skip the closure logic so the
Dropdown session remains active and the stepper click is properly classified.

## Acceptance Criteria

- [ ] Clicking a "+" button with accessibleName `"+"` is captured as an `increment` subAction
- [ ] Clicking a "-" button with accessibleName `"-"` is captured as a `decrement` subAction
- [ ] Clicking an icon-only "+" button (SVG, no text, CSS class "plus-icon") is captured as `increment`
- [ ] Clicking a "+" button with aria-label "Increase Adults" is captured as `increment` with label "Adults"
- [ ] The Dropdown session is NOT prematurely closed when a stepper button is clicked
- [ ] Existing tests still pass (no regressions)
- [ ] New unit tests cover all three fix areas

## Files Changed
- `src/definitions/dropdown.ts` — Fix 1 + Fix 2 (regex, isStepperPlus/Minus, classifySubAction)
- `src/runtime/component-runtime.ts` — Fix 3 (detectSurfaceClosure stepper guard)
- `tests/definitions/stepper-capture-fix.test.ts` — New tests
