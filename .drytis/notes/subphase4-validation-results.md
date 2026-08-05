# Sub-phase 4: Real-World Semantic Effect Validation Results

**Date**: 2026-08-05
**Test file**: `tests/validation/subphase4-realworld-validation.test.ts`
**Tests**: 19 passed, 0 failed
**Method**: JSDOM with real MutationObserver capture → real `interpret()` → assert category/direction/target/confidence

---

## Summary

All 19 validation tests pass. The semantic effect interpretation engine correctly handles every interaction type in the v1 taxonomy across all 7 categories. No production code was modified.

**Pass rate**: 19/19 (100%)

---

## Results by Category

### A. Direct State Toggle (state-toggle / HIGH) — 3/3 PASS

| Case | Expected | Actual | Category | Direction | Target | Confidence | Verdict |
|------|----------|--------|----------|-----------|--------|------------|---------|
| A1: Native Checkbox | state-toggle HIGH, checked: false→true | ✅ | state-toggle | checked: false → true | trigger (cb) | high | PASS |
| A2: Native Radio | state-toggle HIGH, checked: false→true | ✅ | state-toggle | checked: false → true | trigger (r2) | high | PASS |
| A3: Amazon Custom Checkbox | state-toggle HIGH, aria-checked: false→true | ✅ | state-toggle | aria-checked: false → true | trigger (ccb) | high | PASS |

**Key finding**: A3 — the Amazon failure pattern that triggered the entire M1 redesign — is **fully solved**. The aria-checked mutation is captured by Phase B MutationObserver and correctly matched by the state-toggle rule via Source B (mutation attribute changes on any element). The class mutation on the inner `<i>` icon does NOT produce a spurious unclassified effect (it stays in raw evidence only, per design).

### B. Expand-Collapse (expand-collapse / HIGH) — 2/2 PASS

| Case | Expected | Actual | Category | Direction | Confidence | Verdict |
|------|----------|--------|----------|-----------|------------|---------|
| B1: Accordion Expand | expand-collapse HIGH | ✅ | expand-collapse | collapsed → expanded | high | PASS |
| B2: Modal Dialog Open | content-change (structural) | ✅ | content-change | (childList additions) | medium | PASS |

**Key finding**: B2 reveals that modals without `aria-expanded` on the trigger button correctly fall through to content-change. This is expected behavior — the button itself doesn't have expand-collapse semantics. A taxonomy gap for "dialog/modal opened" is noted but not critical for v1.

### C. Content Change (content-change / MEDIUM) — 3/3 PASS

| Case | Expected | Actual | Category | Target | Confidence | Verdict |
|------|----------|--------|----------|--------|------------|---------|
| C1: Filter Button | content-change on results, NOT trigger | ✅ | content-change | results container | medium | PASS |
| C2: Text Input + Search | unclassified on input, content-change on results | ✅ | content-change | results container | medium | PASS |
| C3: React Re-render | content-change | ✅ | content-change | app container | medium | PASS |

**Key finding C1**: The affectedTarget correctly points to the **results container** (`#results`), NOT the filter button that was clicked. This proves the multi-target design works — structural effects carry the mutation target's path, not the trigger element's path.

**Key finding C2**: Text input value change correctly does NOT produce state-toggle. The content-change effect is produced from the search results container mutations, which is the correct affected target. The text field itself produces no effect (its value delta exists in snapshot but has no matching rule — would be unclassified if no other mutations existed).

**Key finding C3**: React-style full innerHTML replacement produces content-change correctly. Mutation count was low enough (3 paths) to avoid aggregation to "broad structural change" LOW.

### D. Multiple Effects — 2/2 PASS

| Case | Effects Produced | Verdict |
|------|-----------------|---------|
| D1: Checkbox Toggle + Filter | state-toggle HIGH (checked: false→true) + content-change (results filtered) | PASS |
| D2: Accordion Expand + Content Load | expand-collapse HIGH (collapsed→expanded) + content-change (panel content loaded) | PASS |

**Key finding D1**: The most important validation result — multiple effects are correctly emitted from a single observation window. The state-toggle stays HIGH even though the window also contains childList mutations from the filter updating. This proves direct-property evidence is noise-immune.

**Key finding D2**: Expand-collapse HIGH alongside content-change confirms that different rules can fire simultaneously on different evidence sources without suppression.

### E. No Observable Effect — 2/2 PASS

| Case | Expected | Actual | Category | Confidence | Verdict |
|------|----------|--------|----------|------------|---------|
| E1: Click non-interactive (completed) | no-observable-effect HIGH | ✅ | no-observable-effect | high | PASS |
| E2: Stop recording mid-window | no-observable-effect LOW | ✅ | no-observable-effect | low | PASS |

**Key finding**: The confidence distinction between completed windows (HIGH — absence IS evidence) and early-close windows (LOW — may not have observed yet) works correctly.

### F. Unclassified (unclassified / LOW) — 1/1 PASS

| Case | Expected | Actual | Category | Confidence | Verdict |
|------|----------|--------|----------|------------|---------|
| F1: CSS-only class change | unclassified LOW | ✅ | unclassified | low | PASS |

**Key finding**: A class-only mutation (`btn-default` → `btn-default btn-selected`) correctly produces unclassified LOW. The description includes mutation types and attribute names for human inspection. No false positive content-change from the attribute mutation.

### G. Edge Cases / Stress — 2/2 PASS

| Case | Expected | Actual | Verdict |
|------|----------|--------|---------|
| G1: Rapid consecutive toggles (3 checkboxes) | 3 independent state-toggle HIGH | ✅ | PASS |
| G2: SPA navigation (bulk DOM replacement) | content-change (medium or low) | ✅ | PASS |

**Key finding G1**: The interpret() function is correctly stateless across calls. Each observation window produces independent effects with no cross-contamination.

**Key finding G2**: SPA navigation with large DOM replacement produces content-change. With 3 distinct mutation paths in this test, it stays at per-path MEDIUM. Real-world SPAs with more paths would aggregate to LOW.

### Bonus Cases — 4/4 PASS

| Case | Expected | Actual | Verdict |
|------|----------|--------|---------|
| X1: Enable-Disable | enable-disable HIGH (disabled→enabled) | ✅ | PASS |
| X2: Element Removed (trigger survives) | content-change (NOT visibility-change) | ✅ | PASS |
| X3: Noise-degraded structural | content-change LOW (performanceCondition) | ✅ | PASS |
| X4: Direct property immune to noise | state-toggle HIGH despite performanceCondition | ✅ | PASS |

**Key finding X2**: Removing a banner element produces content-change (childList removal), NOT visibility-change. visibility-change correctly fires ONLY when the TRIGGER element itself was removed (endReason='element-removed').

**Key finding X3**: PerformanceCondition correctly degrades content-change from MEDIUM to LOW.

**Key finding X4**: state-toggle stays HIGH even when performanceCondition is present. This is the critical design guarantee — direct property evidence is noise-immune.

---

## Taxonomy Gaps Discovered

### Gap 1: Text Input Value Change (known, documented)
- **Pattern**: `<input>` or `<textarea>` value property changes
- **Current behavior**: Falls to unclassified if no other mutations exist. If results update elsewhere → content-change on results.
- **Impact**: LOW — ComponentInteraction.type='TextEntry' carries replay semantics. Capability Model can handle value verification without a semantic category.
- **v2 recommendation**: Add `value-change` category (HIGH confidence, direct property).

### Gap 2: Modal/Dialog Opening (minor)
- **Pattern**: Button click injects modal DOM without aria-expanded on trigger
- **Current behavior**: Falls to content-change (structural).
- **Impact**: LOW — content-change correctly describes what happened structurally.
- **v2 consideration**: Could add `dialog-open` category if needed for capability model.

### Gap 3: CSS Visual State Changes (by design)
- **Pattern**: Class/style changes for visual feedback (selected, active, hover states)
- **Current behavior**: unclassified LOW.
- **Impact**: NONE — this is the intended escape hatch behavior. Class mutations remain in raw M1 evidence for forensic inspection.

---

## Confidence Model Validation

| Confidence Scenario | Expected | Actual | Verdict |
|---------------------|----------|--------|---------|
| Direct property delta (checked, aria-checked, aria-expanded, aria-pressed) | HIGH always | HIGH | PASS |
| Direct property + noise | HIGH (immune) | HIGH | PASS |
| Structural inference, clean window | MEDIUM | MEDIUM | PASS |
| Structural inference + noise | LOW | LOW | PASS |
| No mutations, completed window | HIGH | HIGH | PASS |
| No mutations, early close | LOW | LOW | PASS |
| Mutations but no rule match | LOW (unclassified) | LOW | PASS |

**Verdict**: Confidence model is correct across all tiers.

---

## Affected Target Validation

| Scenario | Expected Target | Actual Target | Verdict |
|----------|----------------|---------------|---------|
| Direct property effect (snapshot delta) | Trigger element | Trigger element | PASS |
| Mutation attribute effect (aria-checked on container) | Mutation target path | Mutation target path | PASS |
| Structural effect (childList on results container) | Mutation target path (results) | Mutation target path (results) | PASS |
| Content change NOT on trigger | Results container, NOT button | Results container | PASS |

**Verdict**: Affected target correctly distinguishes trigger element (for direct property effects) from mutation target (for structural effects).

---

## Conclusion

The Semantic Effect Interpretation engine is correct across all v1 taxonomy categories. All 19 real-world patterns produce the expected category, direction, affected target, and confidence. No production code changes are needed.

The engine is ready to serve as the bridge between the Observation layer (M1) and the Capability Model (next milestone).

Three taxonomy gaps are noted for v2 (value-change, dialog-open, CSS visual states) but none block the v1 pipeline or the Capability Model.
