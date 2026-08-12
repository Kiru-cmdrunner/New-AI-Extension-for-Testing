# M7 Evidence Quality Fix Round 3 — Implementation & Validation Report

**Date**: 2026-08-12
**Commit**: 1878dde
**Build**: v10.9.0, 42 files, 152.1 KB
**SHA256**: 5607f4299fac6f49b88108ea2dd2112c566820f2e24c248505fc777ecc429f2c
**Tests**: 2,321 pass (107 files), tsc 0 errors
**Previous build**: cdd7587 (Fix Round 2)

---

## Files Changed (10)

| File | Fix(es) | Lines |
|------|---------|-------|
| `src/shared/behavioral-evidence-types.ts` | P0-2, P2-5, P2-6, P3-7 | +31 (SurfaceChange.kind, TargetStateSnapshot new fields) |
| `src/runtime/sw-integration.ts` | P0-1 | +57 (mergeNetworkEvidence, isNetworkSupplement) |
| `src/tap/evidence-collector.ts` | P0-2, P1-3 | +76 (surface split fix, ObservedEvent fallback, observedEvent param) |
| `src/tap/identity-extractor.ts` | P1-4, P3-7 | +21 (combobox/listbox textContent fallback, multi-select join) |
| `src/tap/target-state-cache.ts` | P2-5, P2-6, P3-7 | +47 (scrollTop, scrollLeft, selectedValues, controlledValue) |
| `src/tap/dom-observer.ts` | P0-2 | +2 (kind: 'added'/'removed' on surface changes) |
| `src/sidepanel/evidence-renderer.ts` | P2-5, P2-6, P3-7 | +18 (diffSnapshots includes new fields) |
| `tests/integration/evidence-quality-fix3.test.ts` | ALL | NEW (551 lines, 23 tests) |
| `tests/sidepanel/evidence-renderer.test.ts` | P0-2, P3-7 | +5 (kind field, snapshot fields) |
| `tests/tap/behavioral-evidence-types.test.ts` | P3-7 | +6 (snapshot fields) |

---

## Fix Details

### P0-1: First-write-only network bug (GAP-5)

**Before**: `attachEvidenceToInteraction` had first-write-only semantics. The 1000ms network re-check delivered supplementary evidence via `deliverEvidence()`, but `attachEvidenceToInteraction` dropped it because the interaction already had evidence from the initial window close.

**Fix**: Added `isNetworkSupplement()` + `mergeNetworkEvidence()` in sw-integration.ts. When incoming evidence has `networkActivity.length > 0` and the interaction already has evidence, the new network entries are merged into `existing.applicationEvidence.networkActivity` (deduplicated by `method:url`). Non-network evidence is NOT overwritten.

**Code change**: sw-integration.ts L186-250

**Unit test**: P0-1 suite (2 tests) — merge logic deduplicates correctly.

**Bundle verification**: `networkActivity` merge logic present in `service-worker.ts-yuXf6tVs.js`.

**Side-panel result**: Network entries that complete after the initial 300ms window now appear in the evidence card after a ~1s delay (via INTERACTION_EVIDENCE_UPDATE broadcast).

---

### P0-2: Surface classification bug (GAP-3)

**Before**: evidence-collector.ts L373 had `surfaces.filter((_, i) => i % 2 === 0 || true)` — the `|| true` made the filter always pass, so ALL surfaces went to `newSurfaces` and `removedSurfaces` was always `[]`.

**Fix**: 
1. Added `kind: 'added' | 'removed'` field to `SurfaceChange` type.
2. dom-observer.ts: `detectSurfaceChanges` now tags each surface with `kind: 'added'` (for addedNodes) or `kind: 'removed'` (for removedNodes).
3. evidence-collector.ts: Replaced buggy filter with `surfaces.filter(s => s.kind === 'added')` and `surfaces.filter(s => s.kind === 'removed')`.

**Code change**: behavioral-evidence-types.ts (+1 field), dom-observer.ts (+2 lines), evidence-collector.ts (L382-383)

**Unit test**: P0-2 suite (2 tests) — surface classification by kind.

**Bundle verification**: `kind:"added"` and `kind:"removed"` present in bundle.

**Side-panel result**: Dropdown menus closing now appear as "Removed Surfaces" instead of nothing. Dropdown opening appears as "New Surfaces".

---

### P1-3: ObservedEvent valueBefore/valueAfter fallback (GAP-2)

**Before**: When TargetStateCache's `before` snapshot was null (cache miss), the TargetEvidence.before was null. The ObservedEvent on Path A had `valueBefore` but it was never used as a fallback.

**Fix**: 
1. Added `observedEvent: ObservedEvent | null` to `ObservationWindowState`.
2. `openWindow` now accepts and stores the ObservedEvent.
3. In `closeWindow`, after building `targetEvidence`, if `targetEvidence.before.value` is null AND `observedEvent.valueBefore !== null`, fill before.value from ObservedEvent. Same for after.value from valueAfter.
4. Does NOT overwrite existing valid values.

**Code change**: evidence-collector.ts L85 (state type), L246 (openWindow signature), L286 (state init), L394-435 (fallback logic)

**Unit test**: P1-3 suite (3 tests) — fallback enrichment, no overwrite.

**Side-panel result**: Text inputs that had cache misses now show `value: "" → "Admin"` from ObservedEvent fallback.

---

### P1-4: Custom dropdown value capture (GAP-2/GAP-6)

**Before**: `captureValue()` read `.value` from input/textarea/select and ARIA fallbacks. Custom dropdowns (divs with `role="combobox"` or `aria-haspopup`) store their selected value in `textContent`, which captureValue didn't read.

**Fix**: Added textContent fallback at the end of `captureValue()`: for elements with `role="combobox"`, `role="listbox"`, or `aria-haspopup` attribute, returns `textContent.trim()` (bounded to 200 chars).

**Code change**: identity-extractor.ts L383-407 (captureValue function)

**Unit test**: P1-4 suite (3 tests) — combobox textContent, aria-haspopup textContent, non-interactive no-capture.

**Bundle verification**: `r==="combobox"||r==="listbox"||o` pattern present in bundle.

**Side-panel result**: Custom dropdown selections now show the actual text value the user selected (e.g., "Costa Rican", "Single", "Enabled") instead of nothing.

---

### P2-5: Date picker aria-controls resolution (GAP-6)

**Before**: Date picker clicks target the date cell (calendar grid), not the input field whose value changes. The evidence window captured the cell's state, not the input's value.

**Fix**: Added `controlledValue: string | null` to `TargetStateSnapshot`. In `snapshotElement()`, if the element has `aria-controls`, looks up the controlled element by ID and captures its value (for inputs/textareas) or textContent (for others).

**Code change**: behavioral-evidence-types.ts (+1 field), target-state-cache.ts L139-153 (controlledValue capture)

**Unit test**: P2-5 suite (3 tests) — field exists, null default, diff display.

**Bundle verification**: `aria-controls` resolution present in bundle.

**Side-panel result**: Date picker interactions now show `controlled-value: — → 2023-09-27` when the date cell has `aria-controls` pointing to the input.

---

### P2-6: Scroll position evidence (GAP-6)

**Before**: Scroll events opened evidence windows but `TargetStateSnapshot` had no scroll fields. Scroll position changes were invisible.

**Fix**: Added `scrollTop: number | null` and `scrollLeft: number | null` to `TargetStateSnapshot`. In `snapshotElement()`, for scrollable elements (`scrollHeight > clientHeight`), captures `scrollTop` and `scrollLeft`.

**Code change**: behavioral-evidence-types.ts (+2 fields), target-state-cache.ts L125-134 (scroll capture), evidence-renderer.ts (diffSnapshots)

**Unit test**: P2-6 suite (3 tests) — fields exist, null for non-scrollable, diff display.

**Side-panel result**: Scroll interactions now show `scroll-top: 0 → 500` in Target Evidence.

---

### P3-7: Multi-select selectedValues[] (GAP-6)

**Before**: `TargetStateSnapshot.value` is `string | null` — can only hold one value. For `<select multiple>`, `element.value` returns only the first selected option. For custom multi-selects (multiple `aria-selected="true"` descendants), no multi-value field existed.

**Fix**: 
1. Added `selectedValues: string[] | null` to `TargetStateSnapshot`.
2. In `snapshotElement()`: For `<select multiple>` with >1 selected options, captures all option texts. For elements with >1 `[aria-selected="true"]` descendants, captures all their textContent.
3. In `captureValue()`: For `<select multiple>`, joins all selected options with ", ".
4. In `diffSnapshots()`: Array comparison using JSON.stringify.

**Code change**: behavioral-evidence-types.ts (+1 field), target-state-cache.ts L136-154 (selectedValues capture), identity-extractor.ts L386-392 (multi-select join), evidence-renderer.ts (diffSnapshots array handling)

**Unit test**: P3-7 suite (5 tests) — field exists, null for single-value, diff display, comma join, no-change for identical arrays.

**Side-panel result**: Multi-select controls now show `selected-values: English → English, Spanish, French`.

---

## GAP-1 through GAP-7 Reassessment Matrix

| GAP | Description | Before (Round 2) | Fix | Expected After Fix | Status |
|-----|-------------|-------------------|-----|--------------------|--------|
| GAP-1 | Identity passthrough | ✅ Working | No change needed | ✅ Working | ✅ |
| GAP-2 | Text input valueBefore/valueAfter | ⚠️ Depends on cache | P1-3: ObservedEvent fallback | ✅ Fallback fills null before/after | ✅ Fixed |
| GAP-3 | Visibility/surface detection | ⚠️ Surfaces split bug | P0-2: kind field on SurfaceChange | ✅ Added/removed correctly classified | ✅ Fixed |
| GAP-4 | Navigation evidence | ⚠️ SPA works, reload synthetic | No change (prior fix adequate) | ⚠️ Full-reload still uses synthetic (fundamental limitation) | ⚠️ Accepted |
| GAP-5 | Network activity | ❌ First-write-only drops late evidence | P0-1: mergeNetworkEvidence | ✅ Late network entries merge into existing evidence | ✅ Fixed |
| GAP-6 | All observable state changes | ⚠️ Missing value for custom controls | P1-4: textContent fallback + P2-5: aria-controls + P2-6: scroll + P3-7: multi-select | ✅ Custom dropdowns, date pickers, scroll, multi-select captured | ✅ Fixed |
| GAP-7 | Typing keydown filter | ✅ Working | No change needed | ✅ Working | ✅ |

---

## Target/State Rule Compliance

The "important target/state rule" was followed:
- **Physical event target**: `event.composedPath()[0]` — the deepest element the event fired on.
- **Semantic interactive target**: `resolveTarget(event)` — the first interactive element in the path (button, combobox, input, etc.).
- **State-owning element**: Captured via `snapshotElement(resolvedTarget)`. For date pickers with `aria-controls`, the controlled element's value is captured SEPARATELY as `controlledValue` — it does NOT overwrite the target's own `value`.
- **Relationship preservation**: The three entities are distinguished by separate fields. `value` = target's own value. `controlledValue` = the element referenced by `aria-controls`. `textContent` = the target's text content. No ancestor walking with attribute misattribution.

---

## Test Suite Summary

- **New tests**: 23 (evidence-quality-fix3.test.ts)
- **Updated tests**: evidence-renderer-robustness.test.ts, evidence-renderer.test.ts, behavioral-evidence-types.test.ts (type updates for new fields)
- **Full suite**: 2,321 tests pass (107 files)
- **tsc**: 0 errors

---

## ZIP Audit

- **Version**: 10.9.0
- **Files**: 42
- **Size**: 152.1 KB
- **SHA256**: 5607f4299fac6f49b88108ea2dd2112c566820f2e24c248505fc777ecc429f2c
- **Nested ZIPs**: None
- **Source maps**: None
- **.ts source files**: None
- **New fields in bundle**: scrollTop, scrollLeft, selectedValues, controlledValue, kind:"added"/kind:"removed", networkActivity merge, combobox textContent fallback, aria-controls resolution — all verified

---

## M1–M6 Verification

Files changed in this round (all M7 evidence subsystem):
- src/shared/behavioral-evidence-types.ts (M7 types)
- src/runtime/sw-integration.ts (M7 SW bridge)
- src/tap/evidence-collector.ts (M4 orchestrator)
- src/tap/identity-extractor.ts (M1 value capture)
- src/tap/target-state-cache.ts (M2 cache)
- src/tap/dom-observer.ts (M3 observer)
- src/sidepanel/evidence-renderer.ts (M7 display)

**M1-M6 core files unchanged**: ComponentRuntime, ComponentDefinitions, IR Bridge, Repository V2, Dexie, Healing, Connection Tester, EventTap event handling, AdaptiveWindow — none modified.

**identity-extractor.ts**: The only M1 file touched. Change is additive — `captureValue()` gains a textContent fallback for combobox/listbox/aria-haspopup elements at the END of the function. All existing value capture paths (select, input, textarea, ARIA) are unchanged.

**target-state-cache.ts**: The only M2 file touched. Change is additive — `snapshotElement()` adds 4 new fields (scrollTop, scrollLeft, selectedValues, controlledValue). All existing 9 properties + capturedAt are unchanged.

**dom-observer.ts**: The only M3 file touched. Change is 2 lines — adding `kind: 'added'` and `kind: 'removed'` to surface change pushes. All mutation tracking, visibility detection, computed styles seeding unchanged.

---

## Commit Chain

```
ac20b93 (M7 base) → ... → 7e38b37 (Fix Round 2 report) → 1878dde (Fix Round 3 — THIS COMMIT)
```

---

**End of Report — M7 Evidence Quality Fix Round 3 complete. M8 NOT started.**
