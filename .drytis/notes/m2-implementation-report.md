# M2 TargetEvidence — Implementation & Validation Report

**Branch:** `capability-surgical-removal`
**Commit:** `20f5be8` — "M2 TargetEvidence: TargetStateCache + capture-phase listeners"
**Baseline:** `391e823` (M1 Foundation)
**Date:** 2026-08-11

## Scope

M2 from the approved milestone plan. Builds TargetStateCache + capture-phase listeners
that pre-populate element state snapshots BEFORE interactions change them. The cache
is populated but NOT yet consumed (EvidenceCollector arrives in M4).

## Files Changed (11 files, +4,653 lines)

### New Source Files (2)

| File | Lines | Purpose |
|------|-------|---------|
| `src/tap/target-state-cache.ts` | 161 | WeakMap-based cache. Stores `TargetStateSnapshot` (9 properties: value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount + capturedAt). Methods: capture(), peek(), read(), has(). |
| `src/tap/target-state-listeners.ts` | 70 | Two capture-phase listeners (mousedown, focus) with `{ capture: true, passive: true }` that pre-populate the cache BEFORE state changes are applied by click/focus handlers. Returns handle with stop(). |

### Modified Source Files (1)

| File | Change |
|------|--------|
| `src/recorder/phase5/recorder-entry.ts` | Imports TargetStateCache + installTargetStateListeners. Creates cache + installs listeners on `startRecording()`. Stops listeners + releases cache on `stopRecording()`. Exports `targetStateCache` variable for EvidenceCollector (M4). |

### New Test Files (2)

| File | Tests | Coverage |
|------|-------|----------|
| `tests/tap/target-state-cache.test.ts` | 38 | All 9 properties (value for input/textarea/select, checked for checkbox/radio, className, disabled, ariaExpanded/ariaChecked/ariaPressed true/false/null, textContent + truncation at 500, childCount), capturedAt timing, peek/read/capture semantics, overwrite behavior, multi-element, complex realistic scenarios (accordion, checkbox toggle, select with options) |
| `tests/tap/target-state-listeners.test.ts` | 16 | Installation/cleanup, mousedown capture-phase pre-population, focus capture-phase pre-population, before-state preservation through state changes, multiple elements, stop() removes listeners, edge cases (document target), full lifecycle simulations (accordion toggle, checkbox toggle, text input typing) |

## Verification Results

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Test Suite
```
npx vitest run → 94 files, 2060 tests, ALL PASSING (0 failures)
```

**M2-specific tests:** 2 files, 54 tests, all passing:
- `target-state-cache.test.ts` — 38 tests (all 9 properties, null handling, WeakMap lifecycle, capture timing, complex scenarios)
- `target-state-listeners.test.ts` — 16 tests (capture-phase timing, before/after lifecycle, stop/cleanup, edge cases)

**Test delta from M1 (391e823):** 92→94 files (+2), 2006→2060 tests (+54). Zero existing test regressions.

### Build
```
npm run build → 0 errors, 36 files, 125.3 KB
```

recorder-entry bundle grew from 14.41 KB (M1) → 16.00 KB (M2) — the TargetStateCache + listeners code.

### ZIP Audit
- **Size:** 128,309 bytes (125.3 KB)
- **SHA256:** `17bcf8bcb029c79eec97955dc9cde51774bbaa0ac51efb4691b4a28a118fd573`
- **Files:** 36
- **Nested ZIPs:** 0 (cleaned stale M1 ZIP from public/)
- **Source maps (.map):** 0
- **.ts source files:** 0
- **Test artifacts:** 0
- **Old capability/behavioral observation system files:** 0
- **Manifest-referenced files:** 8/8 present
- **TargetStateCache in bundle:** Confirmed (WeakMap class + capture/peek/read/has + snapshotElement + parseAriaBoolean all present in minified recorder-entry.ts bundle)

### Browser Validation
- All 3 test HTML pages load with 0 console errors
- Test pages contain relevant form elements: text inputs, checkboxes, radio buttons, select dropdowns, accordion buttons with aria-expanded, toggle switches, tabs
- No runtime errors detected

## What Was NOT Built (M3+ scope)

- DomObserver / AdaptiveWindow (M3)
- EvidenceCollector — wiring onAfterEvent, building TargetEvidence from cache (M4)
- Shadow DOM recursive observation (M5)
- Network injection (M6)
- Side panel display (M7)
- Dexie V4 persistence (M8)

## Existing Behavior Unchanged

- **Recording (Layer 0):** EventTap event capture unchanged. New listeners are additive — they populate a cache that no one reads yet.
- **Classification (Layer 2):** ComponentRuntime classification unchanged.
- **IR Generation (Layer 5):** ir-bridge unchanged.
- **Repository V2 (Layer 6):** Dexie schema V3 unchanged (8 tables).
- **All 2006 existing tests pass** with zero modifications to test logic.

## Technical Notes

1. **Capture-phase timing:** Both mousedown and focus listeners use `{ capture: true }` to fire BEFORE target/bubble-phase handlers. This ensures we see the element's state before any onclick/onfocus handler modifies it.

2. **WeakMap design:** No manual eviction needed. Entries are GC'd when elements leave the DOM. This prevents memory leaks on long recording sessions.

3. **textContent truncation:** Capped at 500 characters to prevent memory bloat on large container elements.

4. **TypeScript fix during implementation:** Initial listener code compared `Element` with `document` (a `Document`), causing TS2367. Fixed by using `instanceof Element` check on `e.target` instead.

## Download

**URL:** https://semantic-test-intell-wvxv6e.drytis.dev/download/cmdrunner-extension-m2.zip
**SHA256:** `17bcf8bcb029c79eec97955dc9cde51774bbaa0ac51efb4691b4a28a118fd573`

## Verdict

**M2 PASS.** All M2 scope items implemented. 0 tsc errors. 2060/2060 tests passing. ZIP clean. Existing recording/classification/generation behavior unchanged. TargetStateCache is populated by capture-phase listeners and ready for EvidenceCollector (M4) to consume. Ready for M3.
