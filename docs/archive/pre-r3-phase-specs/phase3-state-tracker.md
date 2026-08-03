# Phase 3 — State Tracker (Session Context L1)

**Status:** In Progress  
**Blueprint:** `.drytis/architecture-c-production.md` §5  
**Implementation Plan:** `.drytis/architecture-c-implementation-plan.md` Phase 3  

## Goal

Build the Deterministic State Tracker — the component that maintains Layer 1 of Session Context. It observes the page DOM and tracks current URL, open dialogs/dropdowns, active form, and active element. MV3-safe (persists to storage).

## Files to Create

| File | Content |
|------|---------|
| `src/recorder/context/state-tracker.ts` | `StateTracker` class (content script) + pure helper functions extracted for testability |
| `tests/state-tracker.test.ts` | Unit tests for pure helpers |

## Files to Reuse (no changes)

- `src/shared/architecture-types.ts` — `DeterministicState`, `ElementDescriptor` already defined (lines 36-58)
- `src/shared/types.ts` — `ElementIdentity` available if needed

## Design Decisions

1. **Content script, not service worker**: State Tracker needs DOM access for MutationObserver. It communicates state to the SW via `chrome.runtime.sendMessage`.
2. **Pure helpers extracted**: DOM-querying logic is extracted into standalone functions so they can be unit-tested with jsdom without Chrome APIs.
3. **Mutation relevance filter**: Only recompute on `aria-expanded`, `aria-modal`, `aria-hidden`, `hidden`, `class` attribute changes and `childList` changes.
4. **Recording-gated**: Only emits state when recording is active.
5. **Clean lifecycle**: `start()` connects observers, `stop()` disconnects everything.

## Acceptance Criteria

- [ ] `StateTracker` correctly tracks open dialogs, dropdowns, active form, active element
- [ ] MutationObserver only fires on relevant attribute/childList changes (not on every DOM mutation)
- [ ] State is emitted to SW via message
- [ ] Navigation triggers state reset and recompute
- [ ] Observer disconnects on stop, reconnects on start
- [ ] All unit tests pass (target ~13+ tests)
- [ ] TypeScript compiles
- [ ] Full test suite passes (no regressions)
- [ ] Vite build succeeds

## Test Plan

| Category | Tests |
|---|---|
| `findOpenDialogs` | Visible dialog → returned. Hidden dialog → filtered out. No dialogs → []. |
| `findOpenDropdowns` | Expanded element → returned. Collapsed → filtered. Nested expanded → all returned. |
| `findActiveForm` | Focus inside form → returns form. Focus outside form → null. |
| `describeElement` | Button with text → descriptor with accessibleName. Unnamed element → accessibleName: ''. |
| `isRelevantMutation` | aria-expanded change → relevant. style change → not relevant. childList → relevant. |
| Navigation | `onNavigation` resets state. |
| Emit + debounce | State changes emit message. Non-relevant mutations don't emit. |
