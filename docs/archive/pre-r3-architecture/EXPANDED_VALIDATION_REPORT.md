# Expanded Validation Report

**Generated:** 2025-01-15
**Validation Period:** Phase 3 — Post-Tier-1+Tier-2A Implementation
**Raw Observations:** `.drytis/expanded-validation-observations.json` (53 records)
**Test Suite:** 99 tests across 9 files, all passing

---

## 1. Executive Summary

This report consolidates findings from four validation areas — Framework-Specific Patterns, Locator Quality, Multi-Step Workflows, and Compound Interactions — comprising **53 raw observations** across **22 interaction capabilities** and **7 UI frameworks**.

### Headline Metrics

| Metric | Value |
|--------|-------|
| Total observations | 53 |
| Full support | 35 (66%) |
| Partial support | 10 (19%) |
| Unsupported | 8 (15%) |
| P0 (critical) | 0 |
| P1 (high) | 1 |
| P2 (medium) | 17 |
| P3 (low/informational) | 35 |

### Key Conclusions

1. **The core pipeline is architecturally sound.** Multi-step workflows with diverse field types are captured with high fidelity (WF-12: 5/5 field types in mixed form, WF-10: 10/10 rapid fills). Dedup correctly preserves interactions with distinct element identities.

2. **Locator ranking is robust for standard patterns** but has gaps in dynamic content detection and SVG handling.

3. **Framework support is strong for ARIA-compliant frameworks** (MUI, Ant Design, PrimeReact) but **three frameworks have no Pattern Registry plugins** (Radix, Chakra, AGGrid) and fall back to generic ARIA detection — which works for tabs/checkboxes but fails for framework-specific dropdown/dialog patterns.

4. **Compound interaction support is mixed.** HTML5 drag-drop, double-click, right-click, and keyboard shortcuts work well. Mouse-based drag-drop, scroll, and touch events are unsupported.

5. **Evidence and assertion quality remain the weakest dimensions** (Q7 avg 3.0, Q8 avg 2.3) — the Interaction Enrichment Pass (Tier 2A) improved assertions but evidence annotation is still shallow for most interaction types.

---

## 2. Coverage Matrix

### By Area

| Area | Tests | Observations | Full | Partial | Unsupported |
|------|-------|-------------|------|---------|-------------|
| Locator Quality | 18 | 10 | 7 | 3 | 0 |
| Framework Patterns | 16 | 15 | 7 | 6 | 2 |
| Multi-Step Workflows | 17 | 16 | 15 | 0 | 1 |
| Compound Interactions | 13 | 12 | 7 | 1 | 4 |

### By Severity

| Severity | Count | Examples |
|----------|-------|----------|
| P0 | 0 | — |
| P1 | 1 | WF-04: Table elements (TH/TR) produce 0 interactions |
| P2 | 17 | Framework dropdown gaps, mouse drag, scroll, touch, autocomplete |
| P3 | 35 | Informational, working-as-expected observations |

---

## 3. Quality Dimension Analysis

### Average Scores Across All 53 Observations

| Dimension | Average | Trend (vs Phase 3 baseline) |
|-----------|---------|----------------------------|
| Q1 Intent Accuracy | 3.8 | ↑ (was 3.6) |
| Q2 Abstraction Fidelity | 4.0 | ↑ (was 3.7) |
| Q3 Locator Quality | 4.0 | NEW (not previously measured) |
| Q4 Semantic Description | 3.4 | ↑ (was 3.0) |
| Q5 Replay Reliability | 3.6 | ↑ (was 3.5) |
| Q6 Confidence | 4.1 | ↑ (was 3.8) |
| Q7 Evidence Trail | 3.0 | = (unchanged) |
| Q8 Assertion Value | 2.7 | ↑ (was 2.1) |

**Weakest dimensions:** Q7 (Evidence, 3.0) and Q8 (Assertions, 2.7) — same as Phase 3 baseline but improved slightly from the Enrichment Pass.

---

## 4. Area-by-Area Findings

### Area 1: Framework-Specific Patterns

#### Registered Frameworks (with Pattern Registry plugins)

| Framework | Dropdown | DatePicker | Checkbox | Modal | Tab | Verdict |
|-----------|----------|------------|----------|-------|-----|---------|
| MUI | ✅ CustomDropdown | — | ✅ Checkbox | ⚠️ Click only | — | Strong |
| Ant Design | ✅ CustomDropdown | ✅ DatePicker | — | — | — | Strong |
| PrimeReact | ✅ CustomDropdown | — | — | — | — | Strong |
| Bootstrap | ⚠️ 2× Click | — | — | ⚠️ Click only | — | Weak |
| OXD | — | — | — | — | — | Not tested (domain-specific) |

**Root cause for Bootstrap weakness:** Bootstrap uses `data-bs-toggle="dropdown"` attribute, not ARIA combobox. The Pattern Registry has only a `surfaces` pattern for Bootstrap, not a dropdown pattern.

#### Unregistered Frameworks (no Pattern Registry plugins)

| Framework | Dropdown | Dialog | Tab | Grid | Verdict |
|-----------|----------|--------|-----|------|---------|
| Radix | ⚠️ 2× Click | ⚠️ 2× Click | ✅ Tab | — | Fallback to ARIA works for tabs only |
| Chakra | ✅ NativeDropdown | ⚠️ Click only | — | — | Native select works; modals don't |
| AGGrid | — | — | — | ⚠️ Click / 0 interactions | Grid not recognized; sort not detected |

**Root cause for Radix:** Radix uses `data-state` attributes and custom roles (`menuitemcheckbox`), no standard ARIA combobox. Portal behavior breaks ancestor-based surface detection.

**Root cause for AGGrid:** AGGrid uses `role="gridcell"` but no framework-specific definition. Header sorting uses click on custom elements that the Click definition's `isInteractiveElement` gate filters out.

### Area 2: Locator Quality

**Strengths:**
- testId is correctly ranked #1 (BUSINESS tier, 0.90 confidence)
- Auto-generated IDs filtered: React `:r5:`, Angular `ng-*`, Vue `data-v-*`
- CSS-in-JS classes filtered: MUI `css-*`, Emotion `css-*`
- Ranking order is correct: testId → aria-label → accessible-name → CSS → XPath

**Gaps:**
- **LQ-08 (P2):** Dynamic aria-label content (e.g., `"Item 5 of 12 at 3:42pm"`) is not detected as unstable — it will produce a brittle locator.
- **LQ-09 (P2):** Duplicate testId values have no uniqueness awareness — if two elements share `data-testid="save-btn"`, both get the same locator with no disambiguation.
- **LQ-10 (P2):** SVG icon elements lack semantic anchors (no aria-label, no testId), falling back to structural CSS selectors.

**Architectural note:** TEXT and LABEL locator strategy types are defined in the enum but never produced by `extractCandidatesFromIdentity`. They are dead strategies — either implement them or remove them.

### Area 3: Multi-Step Workflows

**Strengths (15 of 16 workflows fully captured):**
- Login flows: 3/3 interactions (2 TextEntry + 1 Click)
- Multi-step wizards: 6/6 interactions across 3 steps (TextEntry, Click, Dropdown, Checkbox)
- Rapid form filling: 10/10 distinct fields with no dedup drops
- Mixed-type forms: 5/5 types (TextEntry, NativeDropdown, RadioButton, Checkbox, Click)
- Tab navigation: 4/4 tab clicks with Tab classification
- Checkbox groups: 3/3 distinct checkboxes

**Gaps:**
- **WF-04 (P1):** Data table interactions produce 0 interactions. TH/TR elements are rejected by the Click definition's `isInteractiveElement` gate. This is the only P1 finding in the expanded validation.
- **WF-07 (P3):** Same-element dedup merges repeated clicks on the same button — 3 clicks (2× same + 1× different) produce 2 interactions. This is by design but means "click 3 times" semantics are lost.
- **WF-14 (P3):** Accordion expand/collapse not distinguished from generic Click — no Accordion definition exists.
- **WF-16 (P3):** Toast notifications after save cannot be verified because toast DOM is not in the event stream.

### Area 4: Compound Interactions [SIMULATED]

> **Confidence caveat:** All compound interaction findings carry `confidence: SIMULATED` because the harness approximates browser behavior without a real DOM. Findings must be validated with browser-driven testing before implementation work.

**Working compound interactions (7 of 12):**
- HTML5 drag-and-drop: ✅ classified as Html5DragDrop
- Double-click: ✅ classified as DoubleClick
- Right-click: ✅ classified as RightClick
- Keyboard shortcut (Ctrl+Enter): ✅ classified as ModifierShortcut
- Focus/blur chain (tab between fields): ✅ produces distinct TextEntry per field
- Slider drag: ✅ classified as NativeSlider (but sliderValue not extracted)
- Multi-character text entry with focus/blur: ✅ merged into single TextEntry

**Unsupported compound interactions (4 of 12):**
- **CI-01 (P2):** Mouse-based drag-drop (mousedown→mousemove→mouseup) produces 0 interactions — DIV drag handle excluded by DragDrop definition.
- **CI-04 (P2):** Input-only text entry (no focus event) produces 0 interactions — TextEntry requires focus→blur lifecycle.
- **CI-08 (P2):** Scroll/wheel events produce 0 interactions — no Scroll definition exists.
- **CI-10/CI-11 (P2):** Touch events (touchstart/touchmove/touchend) are not in the BrowserEventType union — silently ignored.

**Partial compound interactions (1 of 12):**
- **CI-12 (P2):** Autocomplete flow produces SearchableDropdown + Click instead of a single compound interaction. Text entry portion within the autocomplete is not captured.

---

## 5. Consolidated Common Issues

Issues grouped by root cause + subsystem. Severity = max across observations. Frequency = number of observations sharing this root cause.

### Issue GROUP-A: `isInteractiveElement` gate blocks valid interactive elements
- **Severity:** P1
- **Frequency:** 3 observations (WF-04, CI-01, FW-AGG-02)
- **Distribution:** workflows, compound, framework
- **Root cause:** The Click definition's `isInteractiveElement` helper rejects TH, TR, and grid elements that lack standard ARIA roles. The DragDrop definition similarly excludes generic DIV elements from mouse-based drag.
- **Affected capabilities:** Data table sort/row-click, mouse-based drag-drop, AGGrid header sort
- **Recommended fix:** Expand `isInteractiveElement` to accept table roles (columnheader, rowheader, row, gridcell) and recognize `draggable="true"` attribute for DragDrop.

### Issue GROUP-B: Missing Pattern Registry plugins for major frameworks
- **Severity:** P2
- **Frequency:** 8 observations (FW-BS-01, FW-BS-02, FW-RDX-01, FW-RDX-02, FW-CHK-02, FW-AGG-01, FW-AGG-02, and partial FW-MUI-02)
- **Distribution:** framework
- **Root cause:** Radix, Chakra, and AGGrid have no Pattern Registry plugins. Bootstrap has only a surfaces plugin. These frameworks use non-standard attributes (`data-bs-toggle`, `data-state`, `data-value`) or custom roles that aren't detected.
- **Affected capabilities:** Framework-specific dropdowns, modals, grids
- **Recommended fix:** Add Pattern Registry plugins for each framework targeting their specific attribute patterns. Priority: Radix (most popular), AGGrid (enterprise), Chakra, then Bootstrap dropdown.

### Issue GROUP-C: BrowserEventType union lacks touch/scroll events
- **Severity:** P2
- **Frequency:** 4 observations (CI-08, CI-10, CI-11, and indirectly WF-16)
- **Distribution:** compound
- **Root cause:** The `BrowserEventType` union in `shared/component-types.ts` does not include `touchstart`, `touchmove`, `touchend`, or `wheel` as valid event types. Events of these types are silently ignored by the runtime.
- **Affected capabilities:** Touch gestures, scroll, pinch zoom
- **Recommended fix:** Add touch and wheel events to the BrowserEventType union. Then create a ScrollDefinition and TouchDefinition. Note: real browser validation needed first.

### Issue GROUP-D: TextEntry requires focus→blur lifecycle
- **Severity:** P2
- **Frequency:** 2 observations (CI-04, and partially CI-12)
- **Distribution:** compound
- **Root cause:** The TextEntry definition triggers on `focus` and completes on `blur`. If a text input receives `input` events without a preceding `focus` event (e.g., programmatic value changes, autofill, or incomplete event capture), no interaction is emitted.
- **Affected capabilities:** Input-only text entry, autocomplete text portion
- **Recommended fix:** Add a fallback path in TextEntry that triggers on `input` events when no active session exists, creating a session immediately.

### Issue GROUP-E: Dynamic content in locator values not detected
- **Severity:** P2
- **Frequency:** 2 observations (LQ-08, LQ-09)
- **Distribution:** locator
- **Root cause:** No heuristic exists to detect dynamic content in aria-label, accessible-name, or testId values. Timestamps, counters, and UUIDs in these attributes produce brittle locators.
- **Affected capabilities:** Locator robustness for dynamic UIs
- **Recommended fix:** Add a `isLikelyDynamic` heuristic to the locator ranking: detect numeric substrings, date patterns, UUID patterns in attribute values. Down-rank or filter these.

### Issue GROUP-F: Evidence and assertion quality remain shallow
- **Severity:** P3 (low impact, high opportunity)
- **Frequency:** Universal (affects all 53 observations' Q7/Q8 scores)
- **Distribution:** all areas
- **Root cause:** The evidence engine annotates Click interactions with intent/confidence/evidenceTrail but uses static TYPE_TO_INTENT mapping for all other interaction types (confidence=1.0). Assertions are derived but limited to form input state (value, checked, selected). No assertions for UI state changes (modal opened, toast appeared, accordion expanded).
- **Affected capabilities:** All — evidence and assertion quality across the board
- **Recommended fix:** Extend evidence annotation to all interaction types (not just Click). Extend assertion providers to cover UI state changes. This is the highest-value improvement area.

---

## 6. Prioritized Implementation Roadmap

### Tier 1 — Architectural Gaps (clear, high-impact)

| # | Issue | Effort | Impact | Description |
|---|-------|--------|--------|-------------|
| T1-1 | GROUP-A: `isInteractiveElement` gate | S | High | Expand to accept table roles + draggable attribute. Fixes WF-04 (P1), CI-01 (P2), FW-AGG-02 (P2) — 3 findings. |
| T1-2 | GROUP-D: TextEntry focus-only trigger | S | Medium | Add fallback input-only trigger path. Fixes CI-04 (P2), improves CI-12. |

### Tier 2 — Framework Coverage

| # | Issue | Effort | Impact | Description |
|---|-------|--------|--------|-------------|
| T2-1 | GROUP-B: Radix Pattern Registry plugin | M | Medium | Add detection for `data-state`, custom roles. Fixes FW-RDX-01/02 (P2). |
| T2-2 | GROUP-B: AGGrid Pattern Registry plugin | M | Medium | Add detection for grid roles, header sort. Fixes FW-AGG-01/02 (P2). |
| T2-3 | GROUP-B: Bootstrap dropdown plugin | S | Low | Add `data-bs-toggle` detection. Fixes FW-BS-01 (P2). |
| T2-4 | GROUP-B: Chakra modal plugin | S | Low | Add detection for Chakra portal patterns. Fixes FW-CHK-02 (P2). |

### Tier 3 — Capability Extensions

| # | Issue | Effort | Impact | Description |
|---|-------|--------|--------|-------------|
| T3-1 | GROUP-C: Touch/scroll event support | L | Medium | Add events to union, create definitions. Requires browser validation first. |
| T3-2 | GROUP-E: Dynamic content detection | M | Medium | Add heuristic for dynamic aria-label/testId values. Fixes LQ-08/09 (P2). |
| T3-3 | Accordion definition | S | Low | New definition for expand/collapse via aria-expanded. Addresses WF-14 (P3). |
| T3-4 | Pagination/navigation semantics | S | Low | Detect pagination clicks from aria-label patterns. Addresses WF-13 (P3). |

### Tier 4 — Quality Enhancement

| # | Issue | Effort | Impact | Description |
|---|-------|--------|--------|-------------|
| T4-1 | GROUP-F: Extended evidence annotation | M | High | Extend evidence engine beyond Click to all interaction types. Improves Q7 universally. |
| T4-2 | GROUP-F: Extended assertion providers | M | High | Add assertion providers for UI state changes (modal/toast/accordion). Improves Q8 universally. |
| T4-3 | Autocomplete compound definition | M | Medium | Merge text-entry + option-select into single Autocomplete interaction. Addresses CI-12 (P2). |
| T4-4 | Dead locator strategies cleanup | S | Low | Remove or implement TEXT/LABEL strategy types. Addresses LQ findings. |

---

## 7. Blind Spots and Limitations

### Validated blind spots (acknowledged but not covered):

1. **Browser-driven testing:** All compound interaction findings are [SIMULATED]. Real browser validation is needed to confirm timing-dependent behavior (drag thresholds, debounce windows, rapid event ordering).
2. **Shadow DOM:** Not tested. Elements inside shadow roots may have different ancestor chains and CSS selector behavior.
3. **Cross-origin iframes:** Not tested. Security boundaries may prevent event capture.
4. **Accessibility tree vs DOM:** The harness simulates the accessibility tree via ElementIdentity fields. Real browsers may produce different accessible names.
5. **Performance at scale:** Only tested up to 10 fields (WF-10). Production forms with 50+ fields may expose dedup or memory issues.
6. **Real framework versions:** Tests use static class patterns. Frameworks update their CSS classes between versions (e.g., MUI v5 vs v6), which may break Pattern Registry detection.

### Observations with low confidence:

- All 12 compound interaction observations (`confidence: SIMULATED`)
- Framework observations assume current framework version CSS patterns

---

## 8. Exit Criteria Assessment

Per `.drytis/EXPANDED_VALIDATION_DESIGN.md §12`:

| Criterion | Status |
|-----------|--------|
| C1: Full scenario coverage across all 4 areas | ✅ 53 observations across 4 areas, 22 capabilities, 7 frameworks |
| C2: Every observation classified | ✅ All have category, severity, subsystem, rootCause |
| C3: All P0/P1 observations root-caused | ✅ 0 P0, 1 P1 (WF-04: `isInteractiveElement` gate) |
| C4: Consolidated roadmap produced | ✅ §6 — 4-tier prioritized roadmap |
| C5: Blind spots explicitly acknowledged | ✅ §7 — 6 blind spots + low-confidence observations |

**Exit criteria MET.** Validation is complete. The body of evidence is sufficient to define the next implementation phase.

---

## 9. Recommendation

Based on the complete body of evidence:

1. **Start with Tier 1** (T1-1: expand `isInteractiveElement`, T1-2: TextEntry fallback) — these are small, high-impact fixes for clear architectural gaps.

2. **Then Tier 2** (framework Pattern Registry plugins) — these are the most impactful for real-world coverage since Radix, Chakra, and AGGrid are widely used.

3. **Defer Tier 3/4** until browser-driven validation confirms the compound interaction findings — the SIMULATED observations need real-world confirmation before implementation investment.

4. **Before any new implementation**, validate Tier 1 fixes against this same observation suite to confirm no regressions and measure improvement.
