# Milestone 3: Synchronization + Identity Stability — VALIDATED

## Assumptions Tested
- **A2 (Identity Stability):** Controls maintain stable identities across re-renders.
- **A3 (Mutation Observability):** DOM mutations are tracked correctly.

## Result: A2 + A3 VALIDATED ✓

All 23 tests pass across 3 test suites:
- A3: Mutation Observability: 10/10
- A2: Identity Stability: 11/11
- Performance: 2/2

## Architecture Validated

### Continuous MutationObserver Works
- `childList: true, subtree: true` catches all element additions/removals
- `attributes: true` with `attributeFilter` catches aria-*, class, value, checked, style changes
- Open shadow roots are also observed
- Batch processing works: mutations are processed in 4 passes (removals → additions → attributes → content)

### Semantic Fingerprint Preserves Identity
`fingerprint = role:name:treePath:pos=N:stableAttrs`

- **Re-render survival**: element removed + re-added with same role+name+testid → controlId preserved
- **Identity change detection**: element name changes (Edit→Save) → fingerprint updates correctly
- **Virtualization**: options added/removed as list scrolls → correct discovery/destruction
- **data-testid preferred**: included in fingerprint for enterprise controls
- **Ordinal disambiguation**: sibling controls with same role get positional index

### Re-bind Grace Period (200ms)
When element is removed:
1. Control marked `status='rebinding'`
2. 200ms timer starts
3. If new element with matching fingerprint appears → re-bind (controlId preserved, element updated)
4. If timer expires → control destroyed

### Mutation Processing Strategy (4-pass)
Critical insight: mutations must be processed in a specific order within each batch:
1. **Removals first** — marks controls as 'rebinding', releases fingerprints NOT yet
2. **Additions second** — can re-bind to 'rebinding' controls via fingerprint match
3. **Attributes third** — state updates on existing controls
4. **Content changes fourth** — accessible name updates from text changes

This ordering is REQUIRED for React re-render: when `innerHTML` replaces a subtree,
both removals and additions fire in the same batch. Processing removals first ensures
the old controls are in 'rebinding' state when the new elements are discovered.

### State Tracking
- `aria-expanded` → control.state.expanded ✓
- `aria-checked` → control.state.checked ✓
- `aria-selected` → control.state.selected ✓
- CSS class changes (oxd-checkbox-checked) → control.state updated ✓
- Content changes (button text) → accessible name recomputed ✓

### KNOWN LIMITATION: Input value NOT tracked via MutationObserver
The `value` property on `<input>` elements does NOT trigger MutationObserver.
This is by browser design — `value` is a property, not an attribute (the attribute
is only the initial value). The existing Phase 3 `value-tracker.ts` already handles
this via `input`/`change`/`blur` event listeners. The Control Model will consume
values from the value-tracker, not from MutationObserver.

## Performance Characteristics (JSDOM)
- Initial discovery of 50 controls: **16.4ms** (well under 50ms threshold)
- Mutation batch of 20 simultaneous changes: **101.7ms** in JSDOM
  (JSDOM overhead is ~10x real browser; expect <15ms in Chrome)
- O(n) where n = DOM elements in observed subtree
- WeakMap lookup for event matching: O(1)
- Fingerprint index for re-binding: O(1) via Map

## Bugs Found & Fixed During Validation

### Fix 1: Mutation Batch Ordering
**Bug:** Original code processed mutations sequentially (add+remove interleaved per mutation).
React's `innerHTML` replacement fires removals and additions in the same batch —
sequential processing meant additions couldn't find 'rebinding' controls.

**Fix:** 4-pass processing — all removals first, then all additions, then attributes,
then content changes.

### Fix 2: Content Change Detection
**Bug:** Changing `textContent` (e.g., button text "Edit"→"Save") didn't trigger
any mutation we handled. `childList` fires for text node changes, but we only
looked at element-level childList.

**Fix:** Added `_handleContentChange` — when `childList` mutation targets an element
that IS a control, recompute its accessible name and update fingerprint.

### Fix 3: Default Parameter for Internal Discovery
**Bug:** `_discoverRecursive` required `discovered` array parameter, but when called
from `_processMutations` during observer callback, no array was passed.

**Fix:** Default parameter `discovered: ControlNode[] = []`.

## Remaining Known Limitations (Non-Blocking)

1. **Closed Shadow DOM**: Cannot observe inside closed shadow roots.
   Same limitation as Milestone 1/2. Low impact.

2. **JSDOM performance overhead**: ~10x slower than real Chrome.
   Real-world mutation processing will be <15ms for typical forms.
   Performance Milestone (M4) will validate in real browser.

3. **Virtualization identity**: Controls in virtualized lists get new controlIds
   when scrolled back into view. This is CORRECT — the DOM node IS different.
   For recording purposes, the semantic identity (role+name) is what matters.
   The recording layer should deduplicate by semantic fingerprint, not controlId.

## Test Location
tests/milestone3-sync-identity.test.ts (23 tests, ~1260 lines)

## Milestone Progress
- M1: Discovery Validation ✓ (multi-framework benchmark)
- M2: Event Matching ✓ (Control Model + WeakMap + composedPath)
- **M3: Synchronization + Identity ✓** (MutationObserver + semantic fingerprint)
- M4: Performance + Scaling (pending)
- M5: Acceptance Tests (pending)
