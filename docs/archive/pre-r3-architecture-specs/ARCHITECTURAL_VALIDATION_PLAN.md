# Architectural Validation Plan — Structural Semantic Enrichment

> **Status:** PROPOSED — awaiting user approval
> **Date:** 2026-07-30
> **Scope:** Validate that the three-layer architecture (Observation → Structural Semantic → IR) behaves correctly across the full range of interaction types the recorder supports.

---

## 1. Motivation

Phase 0e implemented the Structural Semantic Enrichment layer and validated it against the Adani One Economy panel (multi-config dropdown). Before advancing to Phase 1 (Persistent Semantic Layer), we must confirm the design holds generically — not just for the one interaction pattern it was built against.

This document defines a systematic test matrix covering every interaction type the recorder supports, the expected behaviour at each pipeline stage, and what evidence proves correctness.

---

## 2. Validation Approach

### 2.1 Three Layers Under Test

| Layer | Question | Evidence |
|-------|----------|----------|
| **Observation** | Are the correct physical events captured and classified into the right interaction type? | ComponentInteraction with correct `type`, `metadata`, and `eventIds` |
| **Structural Semantic** | Where applicable, does enrichment produce the correct ConfigurationSession? | `metadata.configurationSession` with correct `fields`, `pattern`, `commitAction` |
| **IR + Playwright** | Does the IR Bridge generate correct, readable, replayable IR steps? | ExecutionIRPlan with correct `action`, `target`, `input` per step |

### 2.2 Test Categories

Each interaction pattern falls into one of three enrichment categories:

| Category | Expected Behaviour | Patterns |
|----------|-------------------|----------|
| **A — Should enrich** | ConfigurationSession produced | Multi-config dropdowns, filter panels, toggle batches |
| **B — Should NOT enrich** | Interaction passes through unchanged (no configurationSession) | Simple dropdowns, checkboxes, radio buttons, text entries, sliders, hovers, clicks, links, tabs, navigation, scroll |
| **C — Edge cases** | Behaviour must be explicitly verified | Single-select with Done button, uncommitted multi-config, checkbox inside a dropdown surface, radio group inside a dropdown surface |

### 2.3 Test Strategy

For each interaction pattern we verify:

1. **Unit test** — Construct synthetic ComponentInteraction objects and assert the enrichment output. Fast, deterministic, covers edge cases.
2. **Integration test** — Feed enriched interaction through the IR Bridge and assert the IR plan steps (action, target, input, ordering).
3. **Regression check** — Confirm Category B interactions produce identical IR output whether or not the enrichment module is present (no side effects on simple interactions).

> **Note on browser testing:** The recorder is a Chrome extension content script that captures real DOM events via capture-phase listeners. JSDOM (our test environment) does not fully simulate DOM event propagation for all event types (mouseenter, scroll, navigation events). Full browser testing requires loading the extension on real websites. The unit + integration tests below provide structural validation; real-world browser validation will be done manually by the user on actual sites (Adani One, Amazon, etc.).

---

## 3. Test Matrix

### 3.1 Category A — Should Enrich (ConfigurationSession Expected)

These patterns have the signature: **Open Surface → Multiple field changes → Confirm/Apply**.

| # | Pattern | SubActions | Expected Pattern | Expected Fields | Test File |
|---|---------|-----------|-----------------|----------------|-----------|
| A1 | **Multi-config: Steppers + Select + Confirm** (Adani One Economy) | increment×2, selectOption, confirm | `multiFieldConfig` | Adults(counter,2), Children(counter,1), Premium Economy(select) | ✅ existing |
| A2 | **Filter: Multiple Selects + Apply** | selectOption×3, confirm | `filterApply` | Status(select), Department(select), Location(select) | ✅ existing |
| A3 | **Toggle Batch: Multiple Checkboxes + Save** | toggle×2, confirm | `toggleBatch` | Notifications(toggle,true), Newsletter(toggle,false) | ✅ existing |
| A4 | **Search Submit: Text Input + Search Button** | fillInput, confirm | `searchSubmit` | Search(text,"value") | ⬜ new |
| A5 | **Mixed: Counter + Toggle + Select + Done** | increment, toggle, selectOption, confirm | `multiFieldConfig` | Adults(counter), Insurance(toggle), Class(select) | ⬜ new |
| A6 | **Counter with Decrement** | increment, decrement, confirm | `singleSelect` or `multiFieldConfig` | Adults(counter, delta=0, finalValue=1) | ⬜ new |
| A7 | **Uncommitted: Multi-field changes, no confirm** | increment×2 | `uncommitted` | Adults(counter), Children(counter), commitAction=null | ✅ existing |

### 3.2 Category B — Should NOT Enrich (Pass-Through)

These patterns produce a single interaction that should pass through the enrichment layer completely unchanged. **No `configurationSession` should appear in metadata.**

| # | Pattern | Interaction Type | Why Not Enriched | Expected IR Action | Test File |
|---|---------|-----------------|------------------|-------------------|-----------|
| B1 | **Simple dropdown (native `<select>`)** | Dropdown | Single selectOption, no confirm | SELECT | ⬜ new |
| B2 | **Simple custom dropdown** (open → pick option → auto-close) | Dropdown | Single selectOption, no confirm, no subActions | SELECT | ⬜ new |
| B3 | **Checkbox toggle** | Checkbox | No subActions (not a Dropdown) | TOGGLE | ⬜ new |
| B4 | **Radio button selection** | RadioButton | No subActions | CLICK | ⬜ new |
| B5 | **Text entry** (focus → type → blur) | TextEntry | No subActions | FILL | ⬜ new |
| B6 | **Slider** (click range input) | Slider | No subActions | FILL | ⬜ new |
| B7 | **Hover** (mouseenter → dwell → mouseleave) | Hover | No subActions | HOVER | ⬜ new |
| B8 | **Link click** | Link | No subActions | CLICK | ⬜ new |
| B9 | **Tab click** | Tab | No subActions | CLICK | ⬜ new |
| B10 | **Navigation** (SPA route change) | Navigation | No subActions | NAVIGATE | ⬜ new |
| B11 | **Scroll** | Scroll | No subActions | *(noise-filtered)* | ⬜ new |
| B12 | **Button click** (generic) | Click | No subActions | CLICK | ⬜ new |
| B13 | **File upload** | FileUpload | No subActions | FILL | ⬜ new |
| B14 | **Date picker** (open calendar → click date) | DatePicker | No subActions (not a Dropdown) | SELECT_DATE | ⬜ new |

### 3.3 Category C — Edge Cases

These patterns probe boundary conditions and potential failure modes.

| # | Pattern | Scenario | Expected Behaviour | Risk |
|---|---------|----------|-------------------|------|
| C1 | **Single-select dropdown WITH Done button** | Open dropdown → select "Round Trip" → click Done | Enrich as `singleSelect` (1 field + commit). IR = CLICK + CLICK (Done). | Could be incorrectly classified as multi-config if Done button alone triggers enrichment. |
| C2 | **Checkbox INSIDE dropdown surface** | Open Economy → click "Add Insurance" checkbox → click Done | Enriched: checkbox becomes a toggle field in the ConfigurationSession. Checkbox definition does NOT claim it away from the Dropdown session. | Checkbox definition (priority 30) could intercept before Dropdown session (priority 20) claims it. |
| C3 | **Radio group INSIDE dropdown surface** | Open Economy → click radio "Premium Economy" → click Done | Enriched: radio becomes a select field. RadioButton definition does NOT claim it. | RadioButton (priority 40) could claim it before Dropdown session. |
| C4 | **Two separate dropdown sessions** | Open dropdown A → select → Done. Then open dropdown B → select → Done. | Two separate ComponentInteractions, each with its own configurationSession (or not enriched if single-select). | Cross-session contamination — subActions from session B leaking into session A. |
| C5 | **Text input inside dropdown surface** | Open search dropdown → type "Bangalore" → click Search | Enriched: text field in ConfigurationSession. | TextEntry definition (priority 50) could claim the input before Dropdown session. |
| C6 | **Counter with large delta** | Open passengers → click increment 5 times → Done | Counter field with delta=5, finalValue=6. Single FILL step. | Delta computation must handle many increments correctly. |
| C7 | **Idempotency under re-enrichment** | Enrich an already-enriched interaction | Returns identical result. No nested configurationSession. | Double enrichment if pipeline calls enrichConfigurationSession more than once. |
| C8 | **Empty subActions array** | Dropdown interaction with `subActions: []` | shouldEnrich returns false. No configurationSession. | Could crash on empty array iteration. |
| C9 | **Only confirm action (no field changes)** | Open dropdown → immediately click Done | shouldEnrich returns false (single confirm, no fields). Pass-through. | Could produce empty-fields ConfigurationSession. |
| C10 | **Stepper with only minus** | Open dropdown → click decrement 3 times → Done | Counter field with negative delta, finalValue = starting value − 3. | Negative delta handling. |

---

## 4. Per-Pattern Expected Outputs

### A1: Multi-config (Steppers + Select + Confirm)

**Input subActions:**
```
increment(Adults, "2"), increment(Children, "1"), selectOption(Premium Economy, "premium"), confirm(Done)
```

**Expected ConfigurationSession:**
```json
{
  "triggerLabel": "Economy",
  "pattern": "multiFieldConfig",
  "commitAction": { "action": "confirm", "label": "Done" },
  "fields": [
    { "label": "Adults", "kind": "counter", "finalValue": "2", "delta": 1 },
    { "label": "Children", "kind": "counter", "finalValue": "1", "delta": 1 },
    { "label": "Premium Economy", "kind": "select", "finalValue": "premium" }
  ]
}
```

**Expected IR Steps:**
```
FILL  Set Adults to 2          target=Adults
FILL  Set Children to 1         target=Children
CLICK Select "premium"          target=premium
CLICK Confirm Economy selections target=Done
```

**Expected Playwright:**
```typescript
await page.fill('button[name="Adults"]', '2');       // or click +/+ if no text input
await page.fill('button[name="Children"]', '1');
await page.click('button[name="premium"]');
await page.click('button[name="Done"]');
```

---

### A4: Search Submit

**Input subActions:**
```
fillInput(Search flights, "Bangalore to Chennai"), confirm(Search)
```

**Expected ConfigurationSession:**
```json
{
  "pattern": "searchSubmit",
  "commitAction": { "action": "confirm", "label": "Search" },
  "fields": [
    { "label": "Search flights", "kind": "text", "finalValue": "Bangalore to Chennai" }
  ]
}
```

**Expected IR Steps:**
```
FILL  Enter "Bangalore to Chennai" in Search flights
CLICK Confirm Economy selections
```

---

### A6: Counter with Decrement

**Input subActions:**
```
increment(Adults, "3"), decrement(Adults, "2"), confirm(Done)
```

**Expected ConfigurationSession:**
```json
{
  "pattern": "singleSelect",
  "commitAction": { "action": "confirm", "label": "Done" },
  "fields": [
    { "label": "Adults", "kind": "counter", "finalValue": "2", "delta": 0 }
  ]
}
```

**Expected IR Steps:**
```
FILL  Set Adults to 2
CLICK Confirm selections
```

---

### C1: Single-Select with Done

**Input subActions:**
```
selectOption(Round Trip, "round-trip"), confirm(Done)
```

**Expected ConfigurationSession:**
```json
{
  "pattern": "singleSelect",
  "commitAction": { "action": "confirm", "label": "Done" },
  "fields": [
    { "label": "Round Trip", "kind": "select", "finalValue": "round-trip" }
  ]
}
```

**Expected IR Steps:**
```
CLICK Select "round-trip"
CLICK Confirm selections
```

---

### C2: Checkbox Inside Dropdown Surface

**Input subActions:**
```
toggle(Add Insurance, "checked"), confirm(Done)
```

**Expected ConfigurationSession:**
```json
{
  "pattern": "singleSelect",
  "commitAction": { "action": "confirm", "label": "Done" },
  "fields": [
    { "label": "Insurance", "kind": "toggle", "finalValue": "true" }
  ]
}
```

---

### C10: Stepper with Only Minus

**Input subActions:**
```
decrement(Adults, "0"), decrement(Adults, "-1"), confirm(Done)
```

**Expected ConfigurationSession:**
```json
{
  "pattern": "singleSelect",
  "commitAction": { "action": "confirm", "label": "Done" },
  "fields": [
    { "label": " Adults", "kind": "counter", "finalValue": "-1", "delta": -2 }
  ]
}
```

---

## 5. Regression Tests (Category B)

For each Category B interaction, the regression test verifies that:

1. `shouldEnrich(interaction)` returns `false`
2. `enrichConfigurationSession(interaction)` returns the interaction with NO `configurationSession` added to metadata
3. The IR Bridge produces exactly the same IR steps it would without the enrichment module

**Example (B3 — Checkbox):**

**Input ComponentInteraction:**
```json
{
  "type": "Checkbox",
  "metadata": { "targetName": "Remember me", "checked": true }
}
```

**Expected: shouldEnrich → false**
**Expected: No configurationSession in metadata**
**Expected IR:**
```
TOGGLE  Check "Remember me"  input=true
```

---

## 6. Test File Structure

```
tests/validation/
├── category-a-enrichment.test.ts      # A1-A7: Should enrich
├── category-b-no-enrichment.test.ts   # B1-B14: Should NOT enrich
├── category-c-edge-cases.test.ts      # C1-C10: Edge cases
└── regression-ir-output.test.ts       # Verify IR output for B patterns unchanged
```

Each test:
1. Constructs a ComponentInteraction with realistic metadata
2. Calls `shouldEnrich()` and asserts the boolean
3. Calls `enrichConfigurationSession()` and asserts the ConfigurationSession (or its absence)
4. For A/C patterns: feeds the enriched interaction through `build()` and asserts IR steps
5. For B patterns: feeds the interaction through `build()` and asserts no `configurationSession`-related steps

---

## 7. What We're NOT Testing Here

| Excluded | Reason | When |
|----------|--------|------|
| **Real DOM event capture** | JSDOM doesn't simulate capture-phase event propagation for all event types. Real browser testing requires loading the extension. | Manual user testing on real websites. |
| **Surface tracking in live DOM** | Surface detection requires real DOM structure with CSS classes, ARIA attributes, and element containment. | Manual user testing. |
| **Side panel rendering** | The side panel is a Chrome extension UI panel. Playwright can't test extension panels. | Manual user verification. |
| **Playwright code generation** | The action-renderer.ts generates Playwright code from IR steps. This is downstream of the IR Bridge and already tested in existing tests. | Covered by existing test suite. |

---

## 8. Validation Exit Criteria

The validation phase is complete when:

1. ✅ All Category A tests pass — enrichment fires correctly for every multi-field config pattern
2. ✅ All Category B tests pass — simple interactions are completely unaffected
3. ✅ All Category C tests pass — edge cases behave as specified
4. ✅ Full test suite remains green (no regressions in existing 4274 tests)
5. ✅ Build succeeds
6. ✅ Any gaps discovered are documented with: (a) the pattern that doesn't fit, (b) evidence of the failure, (c) proposed design refinement

If recurring gaps emerge that can't be addressed within the current design, we escalate to a design revision before proceeding to Phase 1.

---

## 9. Gap Documentation Protocol

During validation, if a pattern doesn't behave as expected:

```
### GAP-<n>: <Pattern Name>

**Pattern:** <description of the interaction>
**Expected:** <what should happen>
**Actual:** <what actually happens>
**Root Cause:** <analysis>
**Design Impact:** <does this require a design change or just a code fix?>
**Proposed Resolution:** <fix description>
```

Gaps are appended to `docs/architecture/VALIDATION_FINDINGS.md` as they're discovered.

---

## 10. Execution Order

1. **Category B first** — Verify no regressions on simple interactions (most important — the enrichment must be invisible to non-config patterns)
2. **Category A next** — Verify enrichment fires correctly for all config patterns
3. **Category C last** — Probe edge cases and boundary conditions
4. **Run full suite** — Confirm no regressions
5. **Build** — Confirm production build succeeds
6. **Document findings** — Write VALIDATION_FINDINGS.md
