# Phase 4 — Universal Interaction Observer

**Status:** In Progress  
**Blueprint:** `.drytis/architecture-c-production.md` §4  
**Implementation Plan:** `.drytis/architecture-c-implementation-plan.md` Phase 4  

## Goal

Build the single content script that replaces all six current content scripts. Captures ALL browser events + DOM context and sends `RawEvidence` messages to the service worker. No classification, no skipping, no ownership.

## Files to Create

| File | Content |
|------|---------|
| `src/recorder/observer/observer-helpers.ts` | Pure helper functions (extractIdentity, computeAccessibleName, generateCssSelector, generateXPath, etc.) — unit-testable |
| `src/recorder/observer/universal-interaction-observer.ts` | UniversalInteractionObserver class — event listeners, mutation observer lifecycle, recording state |
| `tests/universal-interaction-observer.test.ts` | Unit tests for helpers |

## Files Modified

| File | Changes |
|------|---------|
| `src/manifest.json` | Add new content script entry (alongside existing — not replacing) |

## Design Decisions

1. **Helpers extracted to separate file**: `observer-helpers.ts` holds all pure functions so they can be unit-tested with jsdom. The observer class depends on these helpers.
2. **Canonical implementations chosen** (per researcher analysis):
   - `computeAccessibleName()` → click-content-script.ts version (9-step cascade, most complete)
   - `generateCssSelector()` → click version (with MAX_DEPTH=5)
   - `generateXPath()` → click version (`//` prefix, MAX_DEPTH=10)
   - `isInShadowDom()` → Implementation A (simple `getRootNode() instanceof ShadowRoot`)
   - `extractIframeContext()` → click version (8-field return shape)
   - `getImplicitRole()` → click version (comprehensive TAG_ROLE_MAP + INPUT_TYPE_ROLE_MAP)
   - `resolveTarget()` → generic composedPath walk (no selector filtering — capture everything)
3. **No selector-based skipping**: Unlike current scripts that skip checkboxes/dates/etc, the observer captures ALL events on ALL elements.
4. **Capture-phase listeners**: All listeners use `addEventListener(type, handler, true)` to intercept before page handlers.
5. **MutationObserver lifecycle**: Starts on mousedown/click, auto-stops after 500ms (COALESCING_WINDOW_MS from classifier-constants.ts).
6. **Recording-gated**: Events are only captured when `isRecording === true`. The observer syncs this from `chrome.storage.local`.
7. **Single message type**: All evidence sent as `{ type: 'RAW_EVIDENCE', payload: RawEvidence }`.

## Acceptance Criteria

- [ ] Observer captures all event types: click, mousedown, change, focus, blur, input, mouseenter, mouseleave, keydown
- [ ] Every captured event includes a complete ElementIdentity (18 fields)
- [ ] Value and checked state captured at event time
- [ ] MutationObserver starts on mousedown/click, stops after 500ms
- [ ] No `data-cmdrunner-*` attributes written to DOM
- [ ] No selector-based skipping — all events captured
- [ ] Shadow DOM elements resolved via composedPath()
- [ ] Untrusted events filtered out
- [ ] Observer starts/stops cleanly
- [ ] All unit tests pass (target ~20+ tests)
- [ ] TypeScript compiles, build succeeds
- [ ] Full test suite passes (no regressions)

## Test Plan

| Category | Tests |
|---|---|
| Identity extraction | Button with text, input with aria-label, shadow DOM element, iframe context |
| Value capture | Input value, select value, checkbox checked state |
| Mutation summarization | Child added, class change, visibility change |
| Event filtering | Untrusted event filtered, non-recording state filtered |
| Observer lifecycle | start/stop, mutation window open/close |
