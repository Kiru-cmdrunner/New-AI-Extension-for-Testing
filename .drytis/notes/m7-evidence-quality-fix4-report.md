# M7 Evidence Quality Fix Round 4 — Implementation & Validation Report

**Date**: 2026-08-12T04:55Z
**Commit**: 0daef72
**Build**: v10.9.0, 42 files, 152.4 KB
**SHA256**: ca3fd71805c487673bc9aea25c55bcd2cbc69a8ff8e2163324fd9b3521383220
**Tests**: 2,348 pass (108 files), tsc 0 errors
**Previous build**: 5607f42 (Fix Round 3)

---

## Root Cause Analysis

### Issue 1: Text value `Enter "vivo"` shows no `value: "" → "vivo"`

**Root cause**: When the typing window opens on the first `input` event, `TargetStateCache.peek()` should return the pre-populated snapshot from the keydown capture-phase listener. However, when the cache is empty (peek returns undefined → null), the P1-3 ObservedEvent fallback doesn't trigger because `input` events have `obs.valueBefore = null` (EventTap only sets `valueBefore` for focus/click/mousedown events).

**Fix**: In evidence-collector.ts closeWindow, added a typing-specific fallback: when `sourceEventType === 'input'` and `targetEl instanceof HTMLInputElement` and before value is missing, default `before.value` to `''` (empty string) — the logical before-state for a fresh typing session. Also improved diff rendering to show `(empty)` instead of blank for empty strings.

### Issue 2: Dropdown not showing actual selected values

**Root cause**: `snapshotElement()` only captured `.value` for HTMLInputElement/HTMLTextAreaElement/HTMLSelectElement. Custom dropdown triggers (divs with `role="combobox"`, `aria-haspopup`) store their selected value in textContent, which `snapshotElement` only put into `textContent`, not `value`. The diff showed `text: OldValue → NewValue` instead of `value: OldValue → NewValue`.

**Fix**: In target-state-cache.ts, for non-form elements with `role="combobox"`, `role="listbox"`, `role="option"`, or `aria-haspopup`, use `captureValue()` from identity-extractor.ts (which reads textContent) to populate the `value` field. This makes custom dropdown selections show as `value: Algerian → Costa Rican`.

### Issue 3: Date picker not capturing selected date value

**Root cause**: `controlledValue` only worked when the target element had `aria-controls`. Date calendar cells (`role="gridcell"`, `role="option"`) typically don't have `aria-controls` — they're inside a dialog/application container, with the date input elsewhere on the page.

**Fix**: In target-state-cache.ts, added heuristic for calendar cells: when `controlledValue` is null and the element is a calendar cell (role=gridcell/option, or inside a dialog/application/datepicker container), search for `input[type="date"]`, or inputs with date-related name/class/label within the same form/dialog scope.

### Issue 4: Accordion/visibility changes

**Root cause**: No bug found — the existing code is correct. `detectClassVisibilityChange` (added in Fix Round 2) compares computed display/visibility/opacity against the seeded baseline. `detectStyleVisibilityChange` handles inline style changes. `detectVisibilityChange` handles hidden/aria-hidden. The `seedComputedStylesCache` method pre-seeds all elements to prevent cold-start misses.

**No fix needed** — verified the code paths are correct.

---

## Files Changed (3 source + 1 test + 1 spec)

| File | Fix(es) |
|------|---------|
| `src/tap/evidence-collector.ts` | Issue 1: typing before-value default |
| `src/tap/target-state-cache.ts` | Issue 2: captureValue for custom dropdowns; Issue 3: date picker heuristic |
| `src/sidepanel/evidence-renderer.ts` | Issue 1: empty-string display as `(empty)` in diff |
| `tests/integration/evidence-quality-fix4.test.ts` | All 4 issues (27 regression tests) |

---

## Before → Fix → Expected Evidence → Side-panel Result

### Issue 1: Text entry

| | Before Fix | After Fix |
|---|---|---|
| **Before snapshot** | `null` (cache miss + no fallback) | `{ value: '' }` (typing default) |
| **After snapshot** | `{ value: 'vivo' }` | `{ value: 'vivo' }` |
| **Diff** | `formatSnapshot(after)` (no diff) | `value: (empty) → vivo` |
| **Side panel** | "No observable state changes" | `value: (empty) → vivo` ✓ |

### Issue 2: Custom dropdown

| | Before Fix | After Fix |
|---|---|---|
| **Before snapshot** | `{ value: null, textContent: 'Algerian' }` | `{ value: 'Algerian' }` |
| **After snapshot** | `{ value: null, textContent: 'Costa Rican' }` | `{ value: 'Costa Rican' }` |
| **Diff** | `text: Algerian → Costa Rican` | `value: Algerian → Costa Rican` ✓ |

### Issue 3: Date picker

| | Before Fix | After Fix |
|---|---|---|
| **Before snapshot** | `{ controlledValue: null }` | `{ controlledValue: null }` |
| **After snapshot** | `{ controlledValue: null }` | `{ controlledValue: '2023-09-27' }` |
| **Diff** | (nothing) | `controlled-value: — → 2023-09-27` ✓ |

### Issue 4: Accordion

| | Before Fix | After Fix |
|---|---|---|
| **Visibility** | `display: none → block` ✓ | `display: none → block` ✓ (no change needed) |

---

## Bundle Verification

All 4 fixes confirmed in the built JS bundle:
- Issue 1: `sourceEventType==="input"&&i.targetEl instanceof HTMLInputElement?I=""` ✓
- Issue 2: `combobox.*listbox.*option` in snapshot path ✓
- Issue 3: `gridcell.*option.*closest('[role="dialog"]` ✓
- Issue 4: `seedComputedStylesCache` ✓

## ZIP Audit

- Version: 10.9.0, 42 files, 152.4 KB
- SHA256: `ca3fd71805c487673bc9aea25c55bcd2cbc69a8ff8e2163324fd9b3521383220`
- No nested ZIPs, no source maps, no .ts source files

## M1-M6 Verification

Only 3 source files changed — all M7 evidence subsystem:
- evidence-collector.ts (M4 orchestrator)
- target-state-cache.ts (M2 cache)
- evidence-renderer.ts (M7 display)

No M1-M6 core files touched (ComponentRuntime, ComponentDefinitions, IR Bridge, Repository, Dexie, Healing, EventTap event handling).

---

**End of Report — M7 Evidence Quality Fix Round 4 complete. M8 NOT started.**
