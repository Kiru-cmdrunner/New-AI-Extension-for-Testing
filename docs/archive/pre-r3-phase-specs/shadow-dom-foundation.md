# Shadow DOM Foundation Fixes — Incremental Recorder Improvements

**Scope:** Three isolated fixes to improve Shadow DOM and cross-frame compatibility.
**Constraint:** No changes to Semantic Interaction Engine architecture, public
interfaces, data models, or recording behavior. All existing tests must pass.

---

## Fix #3: Cross-Frame Event Ordering

**Problem:** Events from multiple frames are appended to `events[]` in
`chrome.runtime.sendMessage` delivery order, not timestamp order. Both
classifiers compute `timeDiff` on consecutive events and assume chronological
ordering.

**Fix:** Stable sort by timestamp (with eventId tiebreaker) applied to the
events array before classification. Applied in the service worker's
stop-recording handler, after session ends and before classification runs.

**Isolation:** Pure read-only transform on the events array at classification
time. Does not affect storage order, eventId assignment, or recording behavior.

**Files:** `src/background/service-worker.ts` (add sort before classification)

**Acceptance Criteria:**
- [ ] Events are sorted by timestamp before V1 and V2 classification
- [ ] Stable sort (eventId tiebreaker for same-timestamp events)
- [ ] Navigation events (which lack eventId format but have timestamp) sort correctly
- [ ] Existing single-frame recordings produce identical classification results
- [ ] Regression: all existing tests pass

---

## Fix #6: Shadow-Aware Querying

**Problem:** Six `document.getElementById` / `document.querySelector` calls
are shadow-blind. Three directly affect accessible name computation
(aria-labelledby, label[for], aria-activedescendant).

**Fix:** Add `deepGetElementById()` and `deepQuerySelector()` helper functions
that recursively traverse open shadow roots. Replace the 6 call sites.

**Isolation:** Utility functions with the same return types as their
`document.*` equivalents. Each replacement is a line-by-line swap.

**Files:** `src/recorder/deterministic-recorder.ts` (add helpers + replace calls)

**Acceptance Criteria:**
- [ ] `deepGetElementById(id)` finds elements in open shadow roots
- [ ] `deepQuerySelector(selector)` finds elements in open shadow roots
- [ ] Recursion handles nested shadow roots
- [ ] All 6 call sites use the deep variants
- [ ] Fallback to `document.*` when no shadow roots exist (identical behavior)
- [ ] Regression: all existing tests pass

---

## Fix #4: Shadow-Root MutationObserver

**Problem:** Surface detection and hover tracking MutationObservers observe
`document.body` with `subtree: true`, which does not cross shadow boundaries.
Modal/Drawer/Popover/Tooltip rendered inside shadow roots are not detected.

**Fix:** Add `observeWithShadowRoots()` helper that discovers open shadow
roots and calls `.observe()` on each, in addition to `document.body`. Uses
the SAME MutationObserver instance (native multi-target support).

**Isolation:** The MutationObserver callback is unchanged. Only the `.observe()`
call sites gain additional targets. `disconnect()` still tears down all
observations natively.

**Files:** `src/recorder/deterministic-recorder.ts` (add helper + update 2 observe calls)

**Acceptance Criteria:**
- [ ] Shadow root discovery walks the DOM tree and recurses into nested shadows
- [ ] Surface detection observer covers shadow-root children
- [ ] Hover tracking observer covers shadow-root children
- [ ] Observer cleanup (disconnect) unchanged — still disconnects all targets
- [ ] Performance: shadow root discovery is one-time per observer creation (not per-mutation)
- [ ] Closed shadow roots are skipped (browser limitation)
- [ ] Regression: all existing tests pass

---

## Test Plan

New test file: `tests/evidence-engine/shadow-dom-fixes.test.ts`
- Event ordering with out-of-order timestamps
- Shadow-aware querying (element in shadow root, nested shadow, fallback)
- Shadow MutationObserver coverage (mock)
- Regression: Link, Click, TextEntry, DragDrop detection unchanged
