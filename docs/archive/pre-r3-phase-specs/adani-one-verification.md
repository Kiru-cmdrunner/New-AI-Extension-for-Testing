# Adani One Verification & Stabilization — Task Spec

**Date:** 2026-07-29
**Roadmap:** Pre-Work (Adani One Fix Verification)
**Base commit:** `f3acfbf`

## Objective

Verify, categorize, and fix all 8 Adani One issues against the verified runtime baseline. Implement fixes only for confirmed issues. No regressions.

## Issue Summary After Code Investigation

| Issue | Category | Root Cause |
|-------|----------|------------|
| 1: SVG chevron → icon | **Already Fixed** | `resolveTarget()` Strategy 2 walks to parent with meaningful name, SVG elements explicitly skipped via `NON_INTERACTIVE_TAGS` |
| 2: Surface evidence not propagated | **Already Fixed** | `detectSurface()` added to `dom-context-extractor.ts`, surface data flows to DomContext → ObservedEvent → SW → DetectedInteraction.metadata.surfaceContext |
| 3: multiConfig not activating | **Already Fixed** | `isMultiConfigActivation()` has 3 patterns: surface-anchored, CSS class, aria-haspopup + role |
| 4: Internal clicks not absorbed | **Already Fixed** | `shouldAbsorbMultiConfig()` Strategy 1 uses surface-anchored absorption, Strategy 2 CSS class-token overlap as fallback |
| 5: Icon-only +/- buttons | **Already Fixed** | `detectStepperDirection()` checks accessibleName, className patterns, and aria-label |
| 6: Date picker captured twice | **Needs Investigation** | Double classification: V1 classifier + Component Runtime both produce DatePicker for same events |
| 7: "Cheapest" button not captured | **Still Reproducible** | `shouldAbsorbMultiConfig()` Strategy 1 absorbs ALL Click types when surface-anchored, with no DOM boundary check — absorbs clicks outside the panel |
| 8: Semantic output missing steppers | **Partially Fixed + New Bug** | `session.getEvents()` removed ✅. But `configuredFields[field.field] = field.value` overwrites instead of accumulating stepper values (+1 × 3 → '+1', not '+3') |

## Fixes Required

### Fix A (Issue 7): multiConfig absorption boundary check

**File:** `src/classifier/semantic/panel-form-detectors.ts`, `shouldAbsorbMultiConfig()` Strategy 1 (lines 239-252)

**Problem:** When a multiConfig session is activated via surface-anchored detection, ALL Click interactions are absorbed regardless of whether they're inside the panel or outside. The "Cheapest" button (outside the panel) is absorbed and silently swallowed.

**Root cause:** Strategy 1 checks only `triggerSurfaceCtx?.openedByThisInteraction` and `absorbableTypes.has(interaction.type)`. It has no boundary check — it doesn't verify the click target shares a DOM ancestor with the trigger or is inside the surface.

**Fix:** Add a boundary check for Click interactions. Clicks should only be absorbed if they share a CSS class token with the trigger (indicating same panel) OR are stepper buttons. Non-panel clicks should fall through to outside-click cancellation.

**Acceptance criteria:**
- [ ] Clicks inside the panel are absorbed (CSS class overlap OR stepper)
- [ ] Clicks outside the panel (no class overlap, not a stepper) are NOT absorbed
- [ ] Outside clicks trigger multiConfig cancellation (commit if fields exist)
- [ ] Existing multiConfig tests pass
- [ ] New test: "Cheapest" button outside panel is NOT absorbed

### Fix B (Issue 8b): Stepper value accumulation

**File:** `src/classifier/semantic/reasoner.ts`, `checkAbsorption()` lines 526-529

**Problem:** `session.configuredFields[field.field] = field.value` overwrites stepper values. Three "+" clicks on "Adults" produce `{ Adults: '+1' }` instead of `{ Adults: '+3' }`.

**Fix:** When the field value is a stepper increment (`+1` or `-1`), accumulate into an integer count instead of overwriting. Store as `+3`, `-2`, etc.

**Acceptance criteria:**
- [ ] Multiple "+" clicks on the same field accumulate: 3 clicks → `+3`
- [ ] Mixed +/- clicks accumulate: 2 plus + 1 minus → `+1`
-- [ ] Non-stepper field values (Selection, Selected, On, Off) are overwritten as before
- [ ] Existing tests pass
- [ ] New test: stepper accumulation produces correct totals

## Files Changed

| File | Change |
|------|--------|
| `src/classifier/semantic/panel-form-detectors.ts` | Add boundary check to `shouldAbsorbMultiConfig()` Strategy 1 |
| `src/classifier/semantic/reasoner.ts` | Fix stepper value accumulation in `checkAbsorption()` |
| `tests/adani-one-verification.test.ts` | New: integration tests for all 8 issues |

## Frozen Contracts

No frozen contracts are modified. The changes are within the Semantic Reasoner engine (detection refinement, value accumulation).
