# Pre-Capability Completeness: G4, G6, G8, G15 (G5 deferred)

## Status: COMPLETE
## Date: 2025-08-05
## Branch: m1-m2-complete (from b49a465)
## Base: M0.5 (G2 tabIndex + G7 Slider lifecycle)

## Scope

Closing the remaining physical-interaction gaps that affect recording
correctness, before the Capability Model milestone. G5 (Spinbutton)
is explicitly deferred pending the mouse +/- architecture question.

## Changes

### G4: menuitemcheckbox / menuitemradio (COMPLETED)
- **File**: `src/definitions/patterns.ts`
- **Change**: Added `ariaRole === 'menuitemcheckbox'` to `isCheckbox()`,
  `ariaRole === 'menuitemradio'` to `isRadio()`.
- **Impact**: ARIA menu items with checkbox/radio semantics now correctly
  classified as Checkbox/RadioButton instead of Click fallback.

### G6: Native `<details>` expand/collapse (COMPLETED)
- **File**: `src/semantics/effect-rules.ts`
- **Change**: Added `open` attribute branch to `checkExpandCollapse()`.
  Detects `<details open>` attribute toggling as expand-collapse effect.
  Filters on `targetTag === 'DETAILS'`.
- **Impact**: Native HTML `<details>/<summary>` now produces M2
  expand-collapse semantic effect (HIGH confidence, direct-property).
- **No M1 changes needed**: MutationObserver already captures `attributes: true`.

### G8: ColorInput definition (COMPLETED)
- **Files**: `src/definitions/color-input.ts` (new, 109 lines),
  `src/definitions/index.ts` (registered at priority 15),
  `src/shared/component-types.ts` (InteractionType union),
  `src/presentation/output-adapter.ts` (production filter + IR mapping).
- **Design**: Focus trigger → input/change accumulate value → blur complete.
  `userAdjusted` ONLY true when value differs from triggerValueBefore.
  Mirrors Slider M0.5 lifecycle pattern.
- **Impact**: `<input type="color">` now correctly captured with actual
  selected color value. Same-color re-selection and cancel are filtered.

### G15: Link href extraction (COMPLETED)
- **Files**: `src/shared/types.ts`, `src/tap/identity-extractor.ts`,
  `src/definitions/link.ts`, `src/background/service-worker.ts` (fallback),
  `tests/helpers/make-event.ts`.
- **Change**: Added `href: string | null` to RawElementIdentity. Extracted
  via `el.getAttribute('href')`. Wired in Link definition buildResult.
- **Impact**: Link interactions now carry actual href URL for replay.

### G5: Spinbutton (DEFERRED)
- Deferred pending mouse +/- button architecture decision.
- Current TextEntry lifecycle has known limitations for spinbutton
  (false positive on focus-only, +/- click cancellation before change).

## Tests
- G6: 7 tests (`tests/semantics/g6-details-expand-collapse.test.ts`)
- G8: 23 tests (`tests/definitions/g8-color-input.test.ts`)
- Total new: 30 tests

## Regression
- 3,644 tests passed, 0 failed across 155 test files
- Baseline (M0.5): 3,614 | G6: +7 | G8: +23 = 3,644

## Extension
- `cmdrunner-pre-capability-g4-g6-g8-g15.zip` (v10.9.0, 35 files, 137KB)
