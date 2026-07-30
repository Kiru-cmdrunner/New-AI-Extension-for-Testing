# TextEntry Dropped in Autocomplete Fields — Root Cause & Fix

## Bug
When recording on Adani One flight booking, entering "Chennai" in the From field
works, but entering "Bangalore" in the To field is intermittently dropped from
the semantic timeline (visible in Raw Timeline but not in Observed Workflow).

## Root Cause
**Deferred blur race condition** in SPA frameworks (React, Vue, Angular).

EventTap defers blur value reading by 0ms (setTimeout 0) to let SPA frameworks
flush state updates to the DOM. This means the event order for autocomplete
selection is:

```
mousedown → click → [deferred] blur
```

The old TextEntry `shouldCancelOnOutside` returned `true` for click events on
different elements. This caused TextEntry to be **abandoned** when the user
clicked an autocomplete suggestion — BEFORE the deferred blur could update the
value.

When the deferred blur arrived later, the TextEntry was already removed from the
runtime's active stack. The blur event went to discovery and no TextEntry claimed
it. Result: the text value captured was the partial typed value ("Ban"), not the
final autocomplete value ("Bangalore").

## Fix
Three changes:

1. **text-entry.ts `shouldCancelOnOutside`**: Changed to ALWAYS return false.
   TextEntry is never cancelled by outside events. The blur event (deferred or
   not) is the authoritative completion signal.

2. **text-entry.ts `shouldCompleteOnOutside`** (new): Completes TextEntry when
   focus moves to a DIFFERENT element. This captures the value before the
   deferred blur arrives — handles the case where the user moves to a new field
   without the blur having fired yet.

3. **component-types.ts + component-runtime.ts + scroll.ts**: Added
   `shouldCompleteOnFlush` to decouple flush behavior from
   `shouldCompleteOnOutside`. Previously `flush()` checked
   `shouldCompleteOnOutside` to decide completion vs interruption — which meant
   any component with `shouldCompleteOnOutside` (now including TextEntry) would
   be 'completed' on navigation flush instead of 'interrupted'. Scroll now uses
   `shouldCompleteOnFlush: () => true` explicitly.

## Files Changed
- `src/definitions/text-entry.ts` — shouldCancelOnOutside returns false, added shouldCompleteOnOutside for focus
- `src/shared/component-types.ts` — Added shouldCompleteOnFlush optional method
- `src/runtime/component-runtime.ts` — flush() uses shouldCompleteOnFlush instead of shouldCompleteOnOutside
- `src/definitions/scroll.ts` — Added shouldCompleteOnFlush: () => true
- `tests/runtime/text-entry-deferred-blur-bug.test.ts` — NEW: 2 tests reproducing the race condition
- `tests/runtime/capture-bugfix.test.ts` — Updated TextEntry shouldCancelOnOutside test expectations

## Test Results
- 4,513 pass, 1 pre-existing JSDOM timing flake
- Bug reproduction test confirms: click-before-blur now captures "Bangalore" correctly
