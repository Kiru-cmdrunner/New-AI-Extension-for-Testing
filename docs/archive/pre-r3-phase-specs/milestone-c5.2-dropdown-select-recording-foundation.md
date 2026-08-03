# Milestone C5.2 — Dropdown & Select Recording Foundation

**Status:** PERMANENTLY FROZEN  
**Frozen At:** 2026-07-16T07:15:00Z  
**Depends On:** C5.1 (Dropdown & Select Product Strategy — PERMANENTLY FROZEN)  
**Scope:** Recording layer only. No generation pipeline changes.

---

## 1. Objective

Implement the recording layer for Dropdown & Select interactions per the frozen C5.1 product strategy. Only meaningful value changes are recorded. Disabled, read-only, and programmatic changes are excluded. Select takes precedence over generic Click when a value change occurs.

## 2. Files to Create/Modify

### 2.1 New: `src/recorder/select-content-script.ts`
Self-contained content script implementing C5.1's 5-gate decision tree for dropdown controls.

### 2.2 Modify: `src/shared/types.ts`
Add `SelectEvent` interface, extend `SessionEvent` union, add `SELECT_CAPTURED` to `AppMessage`, extend `isAppMessage`.

### 2.3 Modify: `src/recorder/interaction-types.ts`
Register `select` InteractionTypeConfig (actionType='select', idPrefix='select', badgeColor='#06b6d4' cyan).

### 2.4 Modify: `src/background/service-worker.ts`
Add `SELECT_CAPTURED` case handler, pass `{ value, optionLabel }` as extrasData.

### 2.5 Modify: `src/manifest.json`
Add 5th content_scripts entry for select-content-script.ts.

### 2.6 Modify: `src/recorder/click-content-script.ts`
Add `SELECT_DROPDOWN_SELECTOR` and early return for native `<select>` value changes (Decision 2c).

## 3. Acceptance Criteria

- [x] Native `<select>` value changes recorded as Select interactions
- [x] Only meaningful value changes recorded (not re-selecting same value)
- [x] Opening/closing dropdown without selecting new value NOT recorded
- [x] Disabled controls not recorded
- [x] Read-only controls not recorded (including aria-readonly)
- [x] Programmatic changes not recorded (isTrusted gate)
- [x] Select precedence over Click (data-cmdrunner-handled ownership)
- [x] No duplicate recording
- [x] Deterministic recording (existing recording session unchanged)
- [x] Existing Click/Hover/Text/Checkbox/Radio/Navigation unaffected
- [x] Full test suite passes (742 tests, 28 files), zero regressions

## 4. Regression Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Select different option | `Select "X"` recorded |
| 2 | Re-select current option | NOT recorded |
| 3 | Open/close without selecting | NOT recorded |
| 4 | Disabled select | NOT recorded |
| 5 | Read-only select | NOT recorded |
| 6 | Programmatic change | NOT recorded |
| 7 | Change selection twice | Two `Select` steps |
| 8 | Multiple dropdowns in sequence | Each independent |
| 9 | Existing Click unaffected | All click tests pass |
| 10 | Existing Hover unaffected | All hover tests pass |
| 11 | Existing Checkbox/Radio unaffected | All checkbox/radio tests pass |
| 12 | Existing Text Entry unaffected | All text entry tests pass |

## 5. As-Built Implementation

### 5.1 Files Created
- `src/recorder/select-content-script.ts` (646 lines) — Self-contained content script with 5-gate decision tree
- `tests/select-recording.test.ts` (35 tests) — Registration, plain English, pipeline, regression

### 5.2 Files Modified
- `src/shared/types.ts` — Added `SelectEvent` interface, extended `SessionEvent` union, `AppMessage`, `isAppMessage`
- `src/recorder/interaction-types.ts` — Registered `select` InteractionTypeConfig (cyan #06b6d4)
- `src/background/service-worker.ts` — Added `SELECT_CAPTURED` handler
- `src/manifest.json` — Added 5th content_scripts entry
- `src/recorder/click-content-script.ts` — Added `SELECT_DROPDOWN_SELECTOR` + Decision 2c early return
- `tests/hover-content-script.test.ts` — Updated registration count 5→6
- `tests/checkbox-radio-recording.test.ts` — Updated registration count 5→6

### 5.3 Recording Flow

```
User selects option in native <select>
        ↓
Browser fires 'change' event (capture phase)
        ↓
Gate 1: event.isTrusted === true
Gate 2: element not owned by data-cmdrunner-handled
Gate 3: target matches select:not([multiple]) or [role="combobox"] or [role="listbox"]
Gate 5: !disabled, !aria-disabled, !aria-readonly, no fieldset[disabled] ancestor
Gate 4: current value !== pre-state value (or trusted change event is definitive for native)
        ↓
Extract identity + selected option label
Send SELECT_CAPTURED message with {value: "India"}
Claim ownership: data-cmdrunner-handled='select'
```

### 5.4 Known Limitations

1. **Custom dropdown framework support:** The content script detects ARIA combobox/listbox controls via selectors, but full framework-specific support (React Select, MUI, etc.) requires real-world validation. The value extraction for ARIA controls relies on `aria-selected="true"` and `aria-activedescendant`, which may vary by implementation.
2. **Multi-select deferred:** `<select multiple>` is excluded per C5.1 §2.3.
3. **Shadow DOM:** Content scripts do not cross closed Shadow DOM boundaries.
4. **selectedValue field:** C5.1 §6.6 recommended a new `selectedValue: string | null` field on `CanonicalStep`. The implementation reuses the existing `value: string | null` field instead — functionally equivalent since the pipeline already propagates `value` through to Execution JSON.

### 5.5 Test Results
- 742 tests pass across 28 files
- 35 new tests in select-recording.test.ts
- Zero regressions

## 6. Freeze Declaration

C5.2 is PERMANENTLY FROZEN. The recording layer for Dropdown & Select interactions is complete and validated. All acceptance criteria are satisfied. The full test suite (742 tests across 28 files) passes with zero regressions.

**Review evidence:**
- Infrastructure verification: PASS (all 7 checks)
- Code review: PASS (11/11 acceptance criteria, C5.1 compliance 9/9, security clean)
- Post-fix: aria-readonly exclusion added per reviewer recommendation
