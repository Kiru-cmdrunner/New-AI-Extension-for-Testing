# Done Button Escaping Dropdown Session on Adani One

**Date:** 2026-07-30
**Status:** Under investigation — requires real browser testing

## Problem

On Adani One's Economy dropdown (Passenger & Cabin panel), the "Done" button
click escapes the Dropdown session as a separate `Click` interaction (int-10)
instead of being captured as a `confirm` subAction within the Dropdown
interaction (int-9).

## Root Cause Analysis

The Dropdown definition's `isInScope()` function (dropdown.ts L257-294)
claims events inside the dropdown surface. The Done button detection
(`isDoneButton()`, L72-76) checks if the accessible name matches
`DONE_BUTTON_RE` (`/^(done|apply|...)$/i`).

For the Done button to be captured as a `confirm` subAction, it must:
1. Pass `isInScope` — the event's `surfaceId` must match `ctx.openedSurface`
2. Reach `handleEvent` — where `isDoneButton()` classifies it as `confirm`

## Why it escapes

The Done button's `domContext.surfaceId` likely doesn't match the Dropdown
session's `openedSurface`. This happens when:
- The DOM extractor (`dom-context-extractor.ts detectSurface()`) doesn't
  assign the same surfaceId to the Done button as it does to the dropdown
  trigger
- The Done button is in a different DOM subtree that the surface tracker
  doesn't recognize as "inside" the dropdown surface

## Why we can't reproduce in JSDOM tests

JSDOM doesn't simulate real DOM structure — our tests use synthetic events
with manually-set metadata. The surface tracking issue only manifests on
real website DOM.

## Fix approach (when investigated on real DOM)

1. Check if Adani One's Done button has a `surfaceId` set in its DOM context
2. If not, improve `detectSurface()` in `dom-context-extractor.ts` to handle
   Adani One's specific DOM structure
3. Alternatively, add a fallback in `isInScope()`: if the event target is a
   Done/Apply button and there's an active Dropdown session with
   un-confirmed subActions, claim it

## Impact

Even when Done escapes, the enrichment layer handles it gracefully:
- The Dropdown interaction gets `pattern: "uncommitted"` (no confirm)
- The separate Click interaction shows "Click Done"
- The IR Bridge generates field steps + a separate Done click step

This produces correct Playwright code but doesn't group them semantically.
