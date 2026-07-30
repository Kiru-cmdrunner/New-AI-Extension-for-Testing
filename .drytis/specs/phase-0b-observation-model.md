# Phase 0b: Observation Model — Surface-Bound Session Identity

**Date:** 2026-07-29
**Roadmap:** Unified Master Roadmap Phase 0b
**Design document:** `docs/architecture/OBSERVATION_MODEL_DESIGN.md`
**Base commit:** post-adani-fix (f3acfbf + date picker dedup + stopRecording fix)

## Objective

Implement the observation model defined in `OBSERVATION_MODEL_DESIGN.md`. Make event ownership deterministic by replacing CSS-class-based scope checks with surface-identity-based scope checks. Add surface identity capture, session-surface binding, concurrent session resolution, and behavioral trigger detection.

## Implementation Tasks

### Task 1: Add surfaceId + surfaceOpenedBy to DomContext

**Files:**
- `src/shared/component-types.ts` — add two fields to `DomContext`
- `src/definitions/dom-context-extractor.ts` — compute `surfaceId` in `detectSurface()` by extracting structural identity of the surface container

**Acceptance criteria:**
- [ ] `DomContext` has `surfaceId: string | null` and `surfaceOpenedBy: string | null`
- [ ] `detectSurface()` returns surface identity (not just type/role/label)
- [ ] `surfaceId` is stable across React re-renders (based on structural position, not CSS class)
- [ ] Events outside any surface have `surfaceId: null`
- [ ] Existing tests pass (fields are additive, default null)

### Task 2: Add openedSurface + insideSurface to ComponentContext

**Files:**
- `src/shared/component-types.ts` — add two fields to `ComponentContext`
- `src/runtime/component-runtime.ts` — populate fields in `createContext()`

**Acceptance criteria:**
- [ ] `ComponentContext` has `openedSurface: string | null` and `insideSurface: string | null`
- [ ] `createContext()` sets `insideSurface` from `triggerEvent.domContext.surfaceId`
- [ ] `openedSurface` is set when a surface appears after the session activates
- [ ] Existing tests pass (fields are additive, default null)

### Task 3: Add SurfaceEntry type + surface stack to Component Runtime

**Files:**
- `src/shared/component-types.ts` — add `SurfaceEntry` interface
- `src/runtime/component-runtime.ts` — add `surfaceStack: SurfaceEntry[]`, surface push/pop on detection

**Acceptance criteria:**
- [ ] `SurfaceEntry` type defined with surfaceId, type, role, label, openedByEventId, openedAt, closedAt
- [ ] Runtime maintains `surfaceStack` alongside `activeStack`
- [ ] New surfaces are pushed when detected (first event referencing unknown surfaceId)
- [ ] Surfaces are popped when closed (surface closure detection)
- [ ] Session completion cascades from surface closure (I11 invariant)
- [ ] Existing tests pass

### Task 4: Rewrite isInScope to use surface containment

**Files:**
- `src/definitions/dropdown.ts` — rewrite `isInScope`
- `src/definitions/date-picker.ts` — rewrite `isInScope`
- `src/definitions/click.ts` — no change needed (immediate completion, never inScope)
- `src/definitions/checkbox.ts`, `radio-button.ts`, `slider.ts`, `text-entry.ts`, `hover.ts`, `link.ts`, `file-upload.ts`, `tab.ts`, `scroll.ts` — check if any use surface-based scope

**Acceptance criteria:**
- [ ] `isInScope` checks `event.domContext.surfaceId === ctx.openedSurface` (not CSS class patterns)
- [ ] Events inside a DIFFERENT session's surface are NOT claimed (I10 invariant)
- [ ] Events on the trigger element itself are still in scope
- [ ] Two concurrent dropdown sessions disambiguate correctly
- [ ] All existing definition tests pass

### Task 5: Add concurrent session resolution

**Files:**
- `src/runtime/component-runtime.ts` — in `tryDiscovery()` or `process()`, check if new session trigger is inside/outside existing session's surface

**Acceptance criteria:**
- [ ] New session outside existing session's surface → existing session completes as 'interrupted'
- [ ] New session inside existing session's surface → nested, both coexist
- [ ] Same-type sessions with no surfaces → temporal dedup applies
- [ ] Adani One: Trip Type + Cabin Class dropdowns don't cross-wire
- [ ] Existing tests pass

### Task 6: Update detectTrigger to behavioral signals primary

**Files:**
- `src/definitions/patterns.ts` — keep CSS class patterns as fallback only
- `src/definitions/dropdown.ts` — `detectTrigger`: check aria-haspopup, aria-expanded, role=combobox FIRST, then CSS class fallback
- `src/definitions/date-picker.ts` — `detectTrigger`: check aria-haspopup, role, date input types FIRST, then CSS class fallback

**Acceptance criteria:**
- [ ] `detectTrigger` checks ARIA attributes before CSS classes
- [ ] Elements with `aria-haspopup` are detected as triggers without CSS class match
- [ ] CSS class patterns still work as fallback (no regression for OXD etc.)
- [ ] Existing tests pass

### Task 7: Bind post-click poll to session surface

**Files:**
- `src/tap/event-tap.ts` — `schedulePostClickValueCheck()`: synthetic change event carries `surfaceId` from the focus event that started the session, not from a global `lastFocusedEl`

**Acceptance criteria:**
- [ ] Synthetic change events carry the correct `surfaceId`
- [ ] Synthetic events complete the correct session, not a wrong one
- [ ] No duplicate date picker interactions from post-click poll
- [ ] Existing tests pass

### Task 8: Surface closure detection

**Files:**
- `src/runtime/component-runtime.ts` — detect surface closure via: (a) outside-click event where no subsequent events reference the surface, (b) navigation event, (c) 15s timeout
- Future: MutationObserver for real-time surface removal detection (not in this phase — event-based detection first)

**Acceptance criteria:**
- [ ] Surface closure completes sessions with `openedSurface = surfaceId`
- [ ] Outside click closes the topmost surface
- [ ] Navigation closes all surfaces
- [ ] 15s timeout still works as safety net
- [ ] Existing tests pass

### Task 9: Write characterization tests + Adani One scenario tests

**Files:**
- `tests/observation-model/` — new test directory
- Characterization tests: record current behavior for 10+ interaction types
- Adani One scenario tests: concurrent dropdowns, date picker dedup, passenger panel, stale labels
- Invariant tests: verify all 12 invariants from §13

**Acceptance criteria:**
- [ ] 10+ characterization tests covering all interaction types
- [ ] Adani One concurrent dropdown test (Trip Type + Cabin Class)
- [ ] Adani One date picker dedup test
- [ ] Adani One passenger panel test
- [ ] Invariant tests for I3, I4, I10, I11
- [ ] All tests pass

## Acceptance Criteria (Phase Gate 0b)

- [ ] All 12 invariants hold under every test scenario
- [ ] Adani One: no cross-wiring between Trip Type and Cabin Class
- [ ] Adani One: no duplicate date picker entries
- [ ] Adani One: passenger count changes captured
- [ ] Adani One: "Done" button captured with correct surface context
- [ ] All existing tests pass (4200+)
- [ ] Build succeeds
- [ ] No hardcoded secrets, URLs, or credentials in source
- [ ] No dev-mode commands in background services
- [ ] Preview URL reachable

## Edge Cases

- Surface appears before the trigger event is processed (mutation observer fires first)
- Two surfaces of the same type close simultaneously
- Surface closes between events (no event triggers closure detection)
- Shadow DOM surfaces
- Portal surfaces (React Portal renders outside the trigger's DOM subtree)
- Nested surfaces (dropdown inside a modal)
- Surface never closes (user navigates away — timeout handles it)

## Dependencies

- Phase 0a (dead code removal) — should be done first but not blocking if dead code doesn't interfere
- Pre-Work (Adani One fixes) — DONE (date picker dedup + stopRecording fix committed)
