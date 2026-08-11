# M3 ApplicationEvidence — Implementation & Validation Report

**Branch:** `capability-surgical-removal`
**Commit:** `68f576e` — "M3 ApplicationEvidence: DOMObserver + AdaptiveWindow + mutation cap"
**Baseline:** `20f5be8` (M2 TargetEvidence)
**Date:** 2026-08-11

## Scope

M3 from the approved milestone plan. Builds DOMObserver (refcounted singleton MutationObserver
with summarization pipeline) and AdaptiveWindow (setTimeout-based stabilization timer). Both
are standalone modules, tested in isolation. Not wired into recorder-entry.ts (that's M4).

## Files Changed (6 files, +1,954 lines)

### New Source Files (2)

| File | Lines | Purpose |
|------|-------|---------|
| `src/tap/dom-observer.ts` | 528 | Refcounted singleton MutationObserver on document.body. Global batch counter shared across all active windows. 3-stage summarization pipeline: filter → summarize → accumulate. Surface detection (dialog/menu/tooltip by ARIA role/tag). Visibility change detection (hidden, aria-hidden). Performance tracking. |
| `src/tap/adaptive-window.ts` | 231 | setTimeout-based stabilization timer. Params: minQuiescence=300ms, maxDuration=10000ms, minDuration=50ms. State machine with stabilization reset on mutations. Stability trace (circular buffer capped 50). |

### New Test Files (3)

| File | Tests | Coverage |
|------|-------|----------|
| `tests/tap/dom-observer.test.ts` | 25 | Refcounting (start/stop/multi-start), mutation grouping (same element, separate elements), attribute deltas (class, aria-expanded old/new), childList counting (add/remove), characterData, global batch counter (increments per callback), batch callback, noise filtering (script tags), surface detection (dialog added/removed), visibility changes (hidden, aria-hidden), clear/reset, performance tracking, relativeTime, rawMutationCount |
| `tests/tap/adaptive-window.test.ts` | 18 | Basic lifecycle, stabilization timer reset, multiple mutations extending, max-duration hard cap, min-duration enforcement, all 5 endReason values, stability trace samples + circular buffer (50 cap), EvidenceWindow output (durationMs, timestamps), double-close safety, default parameters |
| `tests/tap/dom-change-cap.test.ts` | 10 | 200-entry cap boundary (50, 200 exact, 201, 500, 1000+), overflow counting, coarseMode flag, first-200 preserved (INV-APP-3), empty/single input, ApplicationEvidence integration shape, surfaces independent of cap |

## Verification Results

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Test Suite
```
npx vitest run → 97 files, 2113 tests, ALL PASSING (0 failures)
```

**M3-specific tests:** 3 files, 53 tests, all passing:
- `dom-observer.test.ts` — 25 tests
- `adaptive-window.test.ts` — 18 tests
- `dom-change-cap.test.ts` — 10 tests

**Test delta from M2 (20f5be8):** 94→97 files (+3), 2060→2113 tests (+53). Zero existing test regressions.

### Build
```
npm run build → 0 errors, 36 files, 125.3 KB
```

Note: ZIP hash is identical to M2 (`db612f10...`) because M3 modules are standalone — not imported by recorder-entry.ts or any bundle. They exist as source + tests only, ready for M4 EvidenceCollector to wire them in.

### ZIP Audit
- **Size:** 128,309 bytes (125.3 KB)
- **SHA256:** `db612f10154fc63a04343fa0aa48fd993cea791642c12924f9019f16d4ec9462`
- **Files:** 36
- **Nested ZIPs:** 0
- **Source maps (.map):** 0
- **.ts source files:** 0
- **Old capability/behavioral observation system files:** 0
- **Manifest-referenced files:** 8/8 present
- **M3 modules in bundle:** Correctly absent (standalone, not yet wired)

### Browser Validation
- **stress-test.html:** 100 dynamically updating items confirmed, 6 toasts, items changing values between snapshots, 0 JS errors
- **m1-realworld-test.html:** 12 patterns verified (accordion with aria-expanded, tabs with class shuffle, toggle, checkbox, text input, select, modal), 0 JS errors
- **m1-realworld-test-v2.html:** 13 patterns verified (same + element removal, dynamic list, async loading), 0 JS errors
- All pages with high-churn/dynamic content load without errors

## Technical Notes

1. **performance.now() + fake timers:** Vitest's `vi.useFakeTimers()` does NOT mock `performance.now()` by default. Solved by `vi.spyOn(performance, 'now')` with a `advance(ms)` helper that advances both mock clock + fake timers together.

2. **MutationObserver in jsdom:** jsdom delivers MutationObserver callbacks asynchronously (microtask). Tests use `await flushMutations()` (setTimeout 0) to await callback delivery.

3. **StabilitySample fields:** The spec v3.0 types define `timestamp`, `msSinceLastMutation`, `globalBatchCount` — not the earlier v2.0 `elapsedMs` / `mutationBatchesSinceLastSample`. Tests correctly use v3.0 field names.

4. **Standalone design:** M3 modules are intentionally not wired into recorder-entry.ts. The EvidenceCollector (M4) will import and compose them. This allows independent unit testing of each component.

## What Was NOT Built (M4+ scope)

- EvidenceCollector — wiring DOMObserver + AdaptiveWindow into the recording lifecycle (M4)
- Shadow DOM recursive observation (M5)
- Network injection / MAIN-world script / webRequest integration (M6)
- Side panel evidence display (M7)
- Dexie V4 persistence (M8)

## Existing Behavior Unchanged

- **Recording (Layer 0):** EventTap event capture unchanged. No new imports in recorder-entry.ts.
- **Classification (Layer 2):** ComponentRuntime classification unchanged.
- **IR Generation (Layer 5):** ir-bridge unchanged.
- **Repository V2 (Layer 6):** Dexie schema V3 unchanged (8 tables).
- **All 2060 existing tests pass** with zero modifications.

## Download

**URL:** https://semantic-test-intell-wvxv6e.drytis.dev/download/cmdrunner-extension-m3.zip
**SHA256:** `db612f10154fc63a04343fa0aa48fd993cea791642c12924f9019f16d4ec9462`

## Verdict

**M3 PASS.** All M3 scope items implemented. 0 tsc errors. 2113/2113 tests passing. ZIP clean. Existing recording/classification/generation behavior unchanged. DOMObserver and AdaptiveWindow are standalone and tested in isolation, ready for M4 EvidenceCollector to compose them. Ready for M4.
