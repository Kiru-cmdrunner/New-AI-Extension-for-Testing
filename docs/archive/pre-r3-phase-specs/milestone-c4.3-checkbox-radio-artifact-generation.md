# Milestone C4.3 — Checkbox & Radio Button Artifact Generation

**Status:** PERMANENTLY FROZEN  
**Frozen At:** 2026-07-16T05:35:00Z  
**Depends On:** C4.1 (FROZEN), C4.2 (FROZEN)  
**Scope:** Integrate Checkbox and Radio into the existing artifact generation pipeline. No recording layer changes. No product changes.

---

## 1. Objective

Checkbox and Radio interactions are already recorded by C4.2 and produce Canonical Test Steps with correct plain English ("Check X", "Uncheck X", "Select X"). The remaining gap is:

1. **Execution JSON** — `mapActionType()` maps `checkbox` → pass-through (`"checkbox"` as the action type) and `radio` → pass-through (`"radio"`). C4.1 §5.2 requires `checkbox+checked=true → "check"`, `checkbox+checked=false → "uncheck"`, `radio → "select"`.
2. **Playwright** — `translateAction()` has no cases for `check`, `uncheck`, or `select` action types. C4.1 §5.5 requires `.check()`, `.uncheck()`, `.check()` respectively.

## 2. Architecture Challenge

The `checked` boolean is on `CheckboxEvent` but NOT on `CanonicalStep`. The execution-json-generator's `mapActionType(step.actionType)` only receives a string — it cannot distinguish check from uncheck.

**Solution:** Add an optional `checked` field to `CanonicalStep` (defaulting to null, same pattern as `value`). The canonical-step-generator already extracts `checked` from events for `toPlainEnglish()` extras — we propagate it to the step itself.

## 3. Files to Change

### 3.1 `src/generation/types.ts` — Add `checked` field to CanonicalStep

```typescript
/**
 * Checkbox state for checkbox interactions. Null for non-checkbox actions.
 * Carries the resulting checked state from the recording layer through
 * to the Execution JSON Generator for check/uncheck mapping.
 * Mirrors how `value` carries text-entry data.
 */
checked: boolean | null;
```

### 3.2 `src/generation/generators/canonical-step-generator.ts` — Populate `checked`

In `transformActionEvent()`, extract `checked` from the event (same pattern as existing `value` extraction) and set it on the returned CanonicalStep.

In `transformNavigationEvent()`, set `checked: null`.

### 3.3 `src/generation/generators/execution-json-generator.ts` — State-aware `mapActionType`

Replace the current single-argument `mapActionType(actionType: string)` with:

```typescript
function mapActionType(actionType: string, checked: boolean | null): string {
  if (actionType === 'click') return 'click';
  if (actionType === 'navigation') return 'navigate';
  if (actionType === 'text') return 'fill';
  if (actionType === 'hover') return 'hover';
  if (actionType === 'checkbox') return checked === true ? 'check' : 'uncheck';
  if (actionType === 'radio') return 'select';
  return actionType;
}
```

Update `processStep()` to call `mapActionType(step.actionType, step.checked)`.

### 3.4 `src/generation/generators/playwright-generator.ts` — New action cases

Add three new cases in the `translateAction()` switch:

```typescript
case 'check': {
  if (target.kind !== 'element' || !primaryLocator) {
    return { statements: [`// ⚠️ Check step has no locators`] };
  }
  const selector = translateLocator(primaryLocator);
  return { statements: [`${framePrefix}${selector}.check();`] };
}

case 'uncheck': {
  if (target.kind !== 'element' || !primaryLocator) {
    return { statements: [`// ⚠️ Uncheck step has no locators`] };
  }
  const selector = translateLocator(primaryLocator);
  return { statements: [`${framePrefix}${selector}.uncheck();`] };
}

case 'select': {
  // C4.1 §5.5: Radio buttons use .check() in Playwright
  // (semantically: ensure the radio is selected)
  if (target.kind !== 'element' || !primaryLocator) {
    return { statements: [`// ⚠️ Select step has no locators`] };
  }
  const selector = translateLocator(primaryLocator);
  return { statements: [`${framePrefix}${selector}.check();`] };
}
```

**IMPORTANT:** The existing `select` case (lines 208-215) handles `<select>` dropdowns (`.selectOption()`). Radio buttons also map to action type `"select"` per C4.1 §5.2. We need to distinguish:
- Radio → action.type `"select"` → Playwright `.check()`
- Dropdown `<select>` → action.type `"select"` → Playwright `.selectOption()`

**Resolution:** The existing dropdown `select` case should remain. Radio's action type `"select"` in the execution JSON must produce `.check()`. The Playwright generator must distinguish based on target tag/role:
- If target.role === 'radio' or target.tag === 'INPUT' with role 'radio' → `.check()`
- Otherwise → `.selectOption()` (existing dropdown behavior)

## 4. Readability Optimizer

**No changes.** Confirm OR-1, OR-2, OR-3 rules are unaffected. No new rules introduced. OR-4 remains deferred per C4.1.

## 5. Execution JSON Contract

**No contract changes.** The Execution JSON structure remains:
```json
{ "action": {"type": "...", "value": null}, "target": {...}, "locators": [...], "context": {...}, "trace": {...}, "meta": {...} }
```
Only the `action.type` values `check`, `uncheck`, `select` are new enum values — already contemplated by the B5.2 contract's "framework-agnostic action verb" design.

## 6. Acceptance Criteria

- [x] Checkbox (checked=true) generates `action.type = "check"` in Execution JSON
- [x] Checkbox (checked=false) generates `action.type = "uncheck"` in Execution JSON
- [x] Radio generates `action.type = "select"` in Execution JSON
- [x] Check → Playwright `.check()`
- [x] Uncheck → Playwright `.uncheck()`
- [x] Radio select → Playwright `.check()`
- [x] Canonical Test Steps: `Check "X"`, `Uncheck "X"`, `Select "X"` (already working from C4.2)
- [x] Click/Hover/Text/Navigation generation unchanged
- [x] Readability Optimizer unchanged
- [x] Execution JSON contract structure unchanged
- [x] Playwright generation deterministic
- [x] Full test suite passes, zero regressions

## 7. Regression Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Check unchecked checkbox | Canonical: `Check "X"`, Exec JSON: `action.type: "check"`, Playwright: `.check()` |
| 2 | Uncheck checked checkbox | Canonical: `Uncheck "X"`, Exec JSON: `action.type: "uncheck"`, Playwright: `.uncheck()` |
| 3 | Select radio | Canonical: `Select "X"`, Exec JSON: `action.type: "select"`, Playwright: `.check()` |
| 4 | Multiple sequential checkbox state changes | Each generates correct check/uncheck verb |
| 5 | Multiple radio selections in same group | Each generates `Select "X"` with `.check()` |
| 6 | Full pipeline: Check → Click → Navigate | All three step types flow through pipeline |
| 7 | Click generation unchanged | Existing click tests pass |
| 8 | Hover generation unchanged | Existing hover tests pass |
| 9 | Text Entry generation unchanged | Existing text tests pass |
| 10 | Navigation generation unchanged | Existing navigation tests pass |
| 11 | Readability Optimizer unchanged | OR-1 merge still works |

## 8. As-Built Implementation Summary

### 8.1 Files Created
- `tests/checkbox-radio-artifact-generation.test.ts` (37 tests)

### 8.2 Files Modified
- `src/generation/types.ts` — Added `checked: boolean | null` to CanonicalStep (mirrors `value` pattern)
- `src/generation/generators/canonical-step-generator.ts` — Populates `checked` from CheckboxEvent
- `src/generation/generators/execution-json-generator.ts` — Extended `mapActionType(actionType, checked)` with state-aware checkbox→check/uncheck and radio→select mapping
- `src/generation/generators/playwright-generator.ts` — Added `check` and `uncheck` action cases; extended `select` case to distinguish radio (`.check()`) from dropdown (`.selectOption()`) via `target.role === 'radio'`

### 8.3 Canonical Test Step Examples
```
Check "Remember Me"
Uncheck "Subscribe to Newsletter"
Select "Credit Card"
Select "Express Delivery"
```

### 8.4 Execution JSON Examples

**Checkbox Check (checked=true):**
```json
{ "action": { "type": "check", "value": null }, "target": { "kind": "element", "tag": "INPUT", "role": "checkbox", "name": "Remember Me" }, "locators": [...], "context": {...}, "trace": {...}, "meta": {...} }
```

**Checkbox Uncheck (checked=false):**
```json
{ "action": { "type": "uncheck", "value": null }, "target": { "kind": "element", "tag": "INPUT", "role": "checkbox", "name": "Subscribe to Newsletter" }, ... }
```

**Radio Select:**
```json
{ "action": { "type": "select", "value": null }, "target": { "kind": "element", "tag": "INPUT", "role": "radio", "name": "Express Delivery" }, ... }
```

### 8.5 Playwright Examples
```typescript
// Step 1: Check "Remember Me"
await page.getByLabel('Remember Me').check();

// Step 2: Uncheck "Subscribe to Newsletter"
await page.getByLabel('Subscribe to Newsletter').uncheck();

// Step 3: Select "Express Delivery"
await page.getByLabel('Express Delivery').check();
```

### 8.6 Test Results
- 695 tests pass across 27 files
- 37 new tests in checkbox-radio-artifact-generation.test.ts
- Zero regressions in existing tests

### 8.7 Known Limitations
1. **Radio `select` vs dropdown `select` disambiguation:** The Playwright generator distinguishes via `target.role === 'radio'`. If a custom radio implementation omits the ARIA role and the recorder cannot infer it, the Playwright generator would fall through to `.selectOption()` instead of `.check()`. This is mitigated by the C4.2 recorder, which resolves the ARIA role for all standard and custom controls.
2. **No readability optimization for checkbox/radio:** OR-4 (collapse consecutive check→uncheck pairs) remains deferred per C4.1 §4.4. All checkbox/radio steps pass through the optimizer unchanged.

### 8.8 Implementation Conflicts Discovered
None. All changes were additive extensions following the existing generator patterns. The `CanonicalStep.checked` field is backward-compatible (null for non-checkbox events). The `mapActionType` signature change from `(actionType)` to `(actionType, checked)` is internal — the function is not exported. No existing behavior was modified.

## 9. Frozen Decisions Confirmed

- C4.1 §5.2 execution model implemented exactly as specified (check/uncheck/select verbs)
- C4.1 §5.5 Playwright mapping implemented exactly as specified (.check()/.uncheck()/.check())
- C4.1 §4.4 OR-4 readability optimization remains deferred — no new rules introduced
- C4.2 recording layer not modified
- B5.2 Execution JSON contract structure unchanged (only new action.type enum values)
- B6 Playwright Generator extensibility pattern preserved (new switch cases, no rewrite)
- B7.1/B7.2 Readability Optimizer byte-for-byte unchanged
- Product Foundation (B1-B8), Architecture, C3.1, C3.3, C4.1, C4.2 remain unmodified

## 10. Freeze Declaration

C4.3 is PERMANENTLY FROZEN. Checkbox and Radio Button interactions now flow through the complete artifact generation pipeline: Interaction Timeline → Canonical Test Steps → Execution JSON → Playwright. All acceptance criteria are satisfied. The full test suite (695 tests across 27 files) passes with zero regressions.

**Review evidence:**
- Infrastructure verification: PASS (all 7 checks)
- Code review: PASS (12/12 acceptance criteria, security, spec compliance, zero warnings)
- Critical radio-vs-dropdown disambiguation verified and explicitly tested
