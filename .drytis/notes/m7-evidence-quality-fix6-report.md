# M7 Evidence Quality Fix Round 6 — Implementation Report

**Date**: 2026-08-12
**Commit**: f87fcb4
**Branch**: capability-surgical-removal

## Problem Statement

Three critical evidence capture failures persisted after Round 5:
1. **Text input**: `Enter "vivo"` shows "No observable state changes" instead of `value: "" → "vivo"`
2. **Custom dropdown**: Selecting `American` from `Dutch` shows no state change
3. **Date picker**: Selecting a date shows no state change

Working features to preserve: identity (GAP-1), network merge (P0-1), checkbox/radio, `aria-expanded`, typing window model.

## Root Cause Analysis

### Text Input (P0-1)
**Pipeline**: EventTap → `onAfterEvent(input)` → `handleTypingEvent` → `openWindow(targetEl, eventId, 'input')` → `peek(targetEl)` for before snapshot → closeWindow → `capture(targetEl)` for after snapshot → `deliverEvidence` → SW `attachEvidenceToInteraction` (Tier 2 match via memberEvents)

**Root cause**: The `before` snapshot was obtained via `peek()` only. If no capture-phase listener had cached the element before the first input event, `peek()` returns `undefined`, making `before = null`. The enrichment logic at closeWindow tries to default `before.value` to `""` for input events, but only when `state.observedEvent` exists.

**Fix**: Changed `openWindow` to use `peek()` first, then fall back to `capture()` if `peek()` returns undefined. For input events specifically, the enrichment logic defaults `before.value` to `""` when the snapshot has no value.

### Custom Dropdown (P0-2)
**Root cause**: `snapshotElement()` only captured `.value` for HTMLInputElement/TextArea/Select. Non-form elements (divs) with `role=combobox` or `aria-haspopup` used `captureValue()` from identity-extractor. But OrangeHRM custom dropdowns are styled divs WITHOUT ARIA roles — they use class names like `oxd-select-text`.

**Fix**: Added class-based detection regex `\b(select|dropdown|combobox|choice)\b/i` in both `snapshotElement()` and `captureValue()`. Also added context-aware `findRelatedControlValue()` method in EvidenceCollector that walks up from option/cell elements to find parent combobox/select and captures its value.

### Date Picker (P0-3)
**Root cause**: DatePicker completes on calendar cell click. Evidence window opens on the cell click — `targetEl` is the cell, not the date input. Before/after snapshots of the cell show no value change. The `controlledValue` heuristic was limited to `aria-controls` and specific date input patterns.

**Fix**: Added Strategy 3 in `snapshotElement` controlledValue heuristic — broader fallback looking for date-pattern values (`dd-mm-yyyy`) in nearby inputs. Added `findRelatedControlValue()` with three strategies: aria-controls resolution, parent combobox lookup, sibling display element. Enrichment in `closeWindow` detects option-like elements and enriches `after.value` from the related control's value.

## Files Changed

| File | Changes |
|------|---------|
| `src/tap/evidence-collector.ts` | Typing window before snapshot fix (peek→capture fallback). `findRelatedControlValue()` method. `captureValueSafe()` helper. Option-like context-aware enrichment in `closeWindow`. `captureValue` import. |
| `src/tap/identity-extractor.ts` | Class-based detection in `captureValue()` for custom select widgets |
| `src/tap/target-state-cache.ts` | Class-based detection in `snapshotElement()`. Date picker Strategy 3 (date-pattern regex). |
| `src/sidepanel/evidence-renderer.ts` | `controlledValue` label changed to `date/input value` |
| `src/runtime/sw-integration.ts` | Diagnostic log cleanup (no functional change) |

## Tests

- **evidence-quality-fix5.test.ts**: 12 tests (richness scoring, drainPendingEvidence, attachEvidenceToInteraction, event routing)
- **evidence-quality-fix6.test.ts**: 18 tests (P0-1 typing, P0-2 dropdown, P0-3 date picker, pipeline correctness, no regression)
- **Full suite**: 2,379 tests pass across 110 files. tsc 0 errors.

## ZIP

- **Version**: 10.9.0
- **Size**: 42 files, 153.5 KB
- **SHA256**: `c66d8916ac38130360a858498f3ef7717075a7645fa840f42713436000dd7341`
- **Audit**: No nested ZIPs, no .ts source, no .map files

## M1-M6 Impact

No M1-M6 files touched. All changes are in M7 evidence pipeline files:
- `src/tap/` (evidence collector, identity extractor, target state cache)
- `src/sidepanel/` (evidence renderer)
- `src/runtime/` (sw-integration — diagnostic cleanup only)

## GAP Status

| GAP | Status | Notes |
|-----|--------|-------|
| GAP-1 | ✅ | Identity passthrough (unchanged) |
| GAP-2 | ✅ Fixed | Before snapshot with peek→capture fallback |
| GAP-3 | ✅ Fixed | Surface classification (from Round 3) |
| GAP-4 | ⚠️ Accepted | SPA navigation works, reload synthetic |
| GAP-5 | ✅ Fixed | Network merge (from Round 3) |
| GAP-6 | ✅ Fixed | Option-like context-aware enrichment |
| GAP-7 | ✅ | Keydown Enter only (unchanged) |
