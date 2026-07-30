# Architectural Validation Findings — Structural Semantic Enrichment

> **Date:** 2026-07-30
> **Validation Plan:** `docs/architecture/ARCHITECTURAL_VALIDATION_PLAN.md`
> **Build:** v10.9.0, 148.8 KB
> **Tests:** 4375/4376 pass (1 pre-existing JSDOM timing flake)

---

## Summary

The Structural Semantic Enrichment layer (Phase 0e) passes systematic validation across **31 interaction patterns** covering all 13 runtime interaction types, 7 enrichment patterns, and 10 edge cases.

**One gap was found and fixed during validation.** No design-level changes were needed — the existing architecture held up.

---

## Test Results

| Category | Patterns | Tests | Result |
|----------|----------|-------|--------|
| **B — No Enrichment** (regression) | 14 interaction types | 44 | ✅ All pass |
| **A — Should Enrich** | 7 config patterns | 33 | ✅ All pass |
| **C — Edge Cases** | 10 boundary scenarios | 25 | ✅ All pass (after GAP-1 fix) |
| **Full Suite** | 185 test files | 4376 | ✅ 4375 pass (1 pre-existing flake) |

---

## GAP-1: Confirm-Only Dropdown Produces Empty ConfigurationSession

**Status:** ✅ FIXED

**Pattern:** User opens a dropdown panel and immediately clicks "Done" without changing any fields.

**Expected:** No `configurationSession` — there's nothing to structurally represent.

**Actual:** `enrichConfigurationSession()` produced a `ConfigurationSession` with `fields: []` and `pattern: "multiFieldConfig"`. While `shouldEnrich()` correctly returned `false`, `enrichConfigurationSession()` wasn't checking its own preconditions internally — it relied on the caller to check `shouldEnrich()` first.

**Root Cause:** In `shouldEnrich()` (L274), the discrimination rule was:
```
return hasConfirm || fieldLabels.size > 1;
```
This returns `true` when `hasConfirm` is `true` even if `fieldLabels.size === 0` (no field changes, only a confirm action).

**Fix:** Changed the discrimination rule to require at least one field change:
```
return fieldLabels.size > 0 && (hasConfirm || fieldLabels.size > 1);
```

**Design Impact:** None — this is a bug fix, not a design change. The design document (§8 Discrimination Rule) specifies enrichment when "hasConfirmAction OR multipleFieldChanges" — but also implies at least one field change exists. The fix aligns the code with the design intent.

**File:** `src/enrichment/structural-enrichment.ts` L274

---

## Patterns Validated

### Category B — No Enrichment (44 tests, all pass)

All 13 non-config interaction types are completely untouched by the enrichment layer:

| Interaction Type | shouldEnrich | configurationSession | IR Action |
|-----------------|-------------|---------------------|-----------|
| Dropdown (simple, no subActions) | false | absent | SELECT/CLICK |
| Checkbox | false | absent | TOGGLE |
| RadioButton | false | absent | CLICK |
| TextEntry | false | absent | FILL |
| Slider | false | absent | FILL |
| Hover | false | absent | HOVER |
| Link | false | absent | CLICK |
| Tab | false | absent | CLICK |
| Navigation | false | absent | NAVIGATE |
| Scroll | false | absent | *(noise-filtered)* |
| Click (generic) | false | absent | CLICK |
| FileUpload | false | absent | FILL |
| DatePicker | false | absent | SELECT_DATE |

**Key finding:** The enrichment layer is completely invisible to all simple interactions. No metadata is modified, no side effects, no unexpected IR step changes.

### Category A — Should Enrich (33 tests, all pass)

| Pattern | StructuralPattern | Fields | IR Steps | Verified |
|---------|------------------|--------|----------|----------|
| Steppers + Select + Confirm | multiFieldConfig | 2 counter + 1 select | 2 FILL + 2 CLICK | ✅ |
| Filter: 3 Selects + Apply | filterApply | 3 select | 3 CLICK + 1 CLICK(commit) | ✅ |
| Toggle batch + Save | toggleBatch | 2 toggle | 2 TOGGLE + 1 CLICK | ✅ |
| Search submit | searchSubmit | 1 text | 1 FILL + 1 CLICK | ✅ |
| Mixed counter + toggle + select | multiFieldConfig | counter + toggle + select | FILL + TOGGLE + CLICK + CLICK | ✅ |
| Counter with decrement | singleSelect | 1 counter (delta=0) | 1 FILL + 1 CLICK | ✅ |
| Uncommitted (no confirm) | uncommitted | 2 counter | 2 FILL (no commit) | ✅ |

**Key findings:**
- Counter fields always produce FILL with the final value (idempotent strategy) regardless of how many increments/decrements
- Toggle fields produce TOGGLE with boolean input (true=checked, false=unchecked)
- Select fields produce CLICK (not SELECT — because the option element is clicked, not a native select)
- Uncommitted sessions correctly omit the commit step
- Large deltas (5 increments) correctly collapse to a single FILL

### Category C — Edge Cases (25 tests, all pass after GAP-1 fix)

| Edge Case | Behaviour | Risk Mitigated |
|-----------|-----------|---------------|
| Single-select + Done | Enriched as singleSelect (1 field + commit) | ✅ Not over-classified as multi-config |
| Checkbox inside dropdown | Toggle field, label normalized ("Insurance" not "Add Insurance") | ✅ Checkbox definition doesn't steal it |
| Radio inside dropdown | Select field | ✅ Radio definition doesn't steal it |
| Two separate sessions | Independent ConfigurationSessions, no cross-contamination | ✅ No session leaking |
| Text input inside dropdown | Text field with value | ✅ TextEntry definition doesn't steal it |
| 5 increments | 1 field, delta=5, finalValue=6, single FILL | ✅ No step explosion |
| Idempotency | Enriching twice = identical result, no nesting | ✅ Safe to call multiple times |
| Empty subActions | No enrichment, no crash | ✅ Graceful degradation |
| Confirm-only (GAP-1) | No enrichment (after fix) | ✅ Empty session prevented |
| Negative delta | delta=-2, finalValue=-1 | ✅ Negative values handled |

---

## IR Action Mapping Summary

Verified end-to-end through the IR Bridge:

| Field Kind | IRAction | Rationale |
|-----------|----------|-----------|
| counter | FILL | Idempotent: set final value directly rather than clicking +/+ N times |
| select | CLICK | Click the specific option element |
| toggle | TOGGLE | Set boolean state (checked/unchecked) |
| text | FILL | Enter the text value |
| date | SELECT_DATE | Select the date value |
| commit | CLICK | Click Done/Apply/Save/Search button |

---

## What This Validation Does NOT Cover

The following require real browser testing with the loaded Chrome extension and cannot be validated in JSDOM:

1. **Real DOM event capture** — Capture-phase event listeners, surface detection via CSS class containment, ARIA attribute reading
2. **Surface tracking lifecycle** — Session opening/closing, stale cleanup, 15s timeout
3. **Cross-element deduplication** — Calendar cell click + synthetic change event on date input
4. **Side panel rendering** — Extension panel UI (not testable via Playwright on extension panels)
5. **Concurrent session resolution** — Two overlapping dropdown surfaces

These will be validated through manual browser testing on real websites (Adani One, Amazon, etc.).

---

## Conclusion

The Structural Semantic Enrichment design holds up across all tested interaction patterns. The one gap found (GAP-1: confirm-only dropdown) was a code-level bug, not a design-level issue, and has been fixed. The architecture is ready to proceed to real-world browser validation and, upon successful results, to the next architectural milestone (Phase 1: Persistent Semantic Layer).
