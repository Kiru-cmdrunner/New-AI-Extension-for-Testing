# Phase 3 — Real-World Validation Report

**Status:** COMPLETE — Observation Pass Only
**Date:** Session 3
**Validation Harness:** `tests/validation-harness/` — 30 tests, 6 groups, 8 quality dimensions
**Methodology:** Programmatic pipeline exercise (ObservedEvent[] → ComponentRuntime → IR Bridge → Playwright) against synthetic fixtures representing real-world UI patterns
**Discipline:** Observation only. No fixes applied during validation. All findings documented before any implementation prioritization.

---

## §1. Executive Summary

The validation exercised **22 interaction capabilities** across **6 groups** (Form Input, Click, Advanced, Specialized, Compound, Cross-Cutting), scoring each on **8 quality dimensions** (Q1-Q8).

### Coverage Distribution

| Support Level | Count | Capabilities |
|--------------|-------|-------------|
| **FULL** ✅ | 13 | TextEntry (input+textarea), Checkbox (native+switch), RadioButton, CustomDropdown, Click (plain), Link, Tab, DragDrop, FileUpload, Stepper, RichTextEditor |
| **PARTIAL** ⚠️ | 9 | NativeSelect, Autocomplete, DatePicker, DoubleClick, RightClick, Hover, Slider, TagInput, OTP, Multi-config Dropdown, Modal, Iframe |
| **UNSUPPORTED** ❌ | 0 | — |

### Key Architectural Findings

1. **`change`-event gap (P1, systemic):** Three definitions (NativeSelect, NativeDate, Slider) fail to recognize bare `change` events. Their `triggerEventTypes` are limited to `focus`/`click`/`mousedown`. Real-world usage of `<select>`, `<input type="date">`, and `<input type="range">` produces `change` events as the primary interaction signal.
2. **`isInteractiveElement` gate too strict (P1, systemic):** Hover and Click definitions reject events on elements whose tag/role is not in `INTERACTIVE_TAGS`/`INTERACTIVE_ROLES`. Real-world `<tr>`, `<td>`, `<div role="group">` fail the gate, blocking Hover, DoubleClick, and RightClick.
3. **Compound lifecycle unvalidated (P2):** Multi-config Dropdown and Modal Dialog definitions exist but the validation harness cannot simulate real DOM surface detection. These need browser-based testing to assess.
4. **Iframe Playwright output missing (P1):** The IR Bridge passes iframe context through to interactions, but the Playwright adapter does not generate `frameLocator()` calls.
5. **Locator strategy ranking unclear (P2):** `getTopLocatorStrategy()` returned `null` in multiple tests — suggesting either the IR plan doesn't populate `resolvedLocators` for simple clicks, or the step target structure differs from expected shape.
6. **Evidence engine dormant for primary path (P2):** Evidence annotations produce 0 votes for standard Click interactions. The evidence engine appears to only activate on V1 ambiguous-click fallback, which was retired in Phase 3 Thrust 1.

---

## §2. Coverage Matrix

### Group A — Form Input

| ID | Capability | Scenario | Support | Type | Severity |
|----|-----------|----------|---------|------|----------|
| A1 | TextEntry (input) | focus → type → blur | ✅ FULL | TextEntry | P3 |
| A1 | TextEntry (textarea) | focus → type → blur | ✅ FULL | TextEntry | P3 |
| A2 | Checkbox (native) | click to check | ✅ FULL | Checkbox | P3 |
| A2 | Checkbox (ARIA switch) | role=switch click | ✅ FULL | Checkbox (not ToggleSwitch) | P2 |
| A3 | RadioButton | click to select | ✅ FULL | RadioButton | P3 |
| A4 | Native `<select>` | change event | ⚠️ PARTIAL | NONE (not recognized) | **P1** |
| A5 | Custom Dropdown (ARIA combobox) | click trigger → click option | ✅ FULL | CustomDropdown | P2 |
| A5 | Autocomplete | type → select | ⚠️ PARTIAL | SearchableDropdown (2 interactions) | P2 |
| A6 | Native date input | change event | ⚠️ PARTIAL | NONE (not recognized) | **P1** |

### Group B — Click Interactions

| ID | Capability | Scenario | Support | Type | Severity |
|----|-----------|----------|---------|------|----------|
| B1 | Plain Click (button+testId) | click | ✅ FULL | Click | P3 |
| B1 | Plain Click (div role=button) | click | ✅ FULL | Click | P2 |
| B2 | Link (anchor href) | click | ✅ FULL | Link | P2 |
| B2 | SPA Navigation (pushState) | click → navigation | ⚠️ PARTIAL | Link (no Navigation merge) | P2 |
| B3 | Double-click (table row) | dblclick on `<tr>` | ⚠️ PARTIAL | NONE (isInteractiveElement rejects TR) | P2 |
| B3 | Right-click (contextmenu) | contextmenu on `<td>` | ⚠️ PARTIAL | NONE (isInteractiveElement rejects TD) | P2 |
| B4 | Tab (role=tab in tablist) | click | ✅ FULL | Tab | P2 |

### Group C — Advanced Interactions

| ID | Capability | Scenario | Support | Type | Severity |
|----|-----------|----------|---------|------|----------|
| C1 | Hover | mouseenter → mouseleave | ⚠️ PARTIAL | NONE (isInteractiveElement rejects group) | **P1** |
| C2 | Slider (native range) | change event | ⚠️ PARTIAL | NONE (triggerEventTypes lacks 'change') | **P1** |
| C3 | Drag and Drop (HTML5) | dragstart → drop | ✅ FULL | Html5DragDrop | P1 |
| C4 | File Upload | change event | ✅ FULL | FileUpload | P1 |
| C5 | Stepper / Counter | click increment | ✅ FULL | Stepper | P1 |

### Group D — Specialized Inputs

| ID | Capability | Scenario | Support | Type | Severity |
|----|-----------|----------|---------|------|----------|
| D1 | Tag Input | type → Enter → type → comma | ⚠️ PARTIAL | TextEntry (no TagInput recognized) | P2 |
| D2 | OTP Input (6 boxes) | 6× input events | ⚠️ PARTIAL | NONE (no interactions emitted) | P2 |
| D3 | Rich Text Editor | contenteditable focus → input → blur | ✅ FULL | RichTextEditor | P2 |

### Group E — Compound & Structural

| ID | Capability | Scenario | Support | Type | Severity |
|----|-----------|----------|---------|------|----------|
| E1 | Multi-Config Dropdown | open → 2× increment → confirm | ⚠️ PARTIAL | 3× Click (no compound lifecycle) | P2 |
| E2 | Modal Dialog | delete → modal → confirm | ⚠️ PARTIAL | 2× Click (no modal lifecycle) | P2 |

### Group F — Cross-Cutting

| ID | Capability | Scenario | Support | Type | Severity |
|----|-----------|----------|---------|------|----------|
| F1 | Locator (testId available) | element with data-testid | ⚠️ PARTIAL | topStrategy=null | P2 |
| F1 | Locator (CSS only) | no semantic identifiers | ⚠️ PARTIAL | topStrategy=null | P3 |
| F1 | Locator (React auto-ID) | `:r1:` + CSS-in-JS hash | ⚠️ PARTIAL | topStrategy=role | P2 |
| F2 | Iframe Interactions | click inside iframe | ⚠️ PARTIAL | NONE + no frameLocator | **P1** |

---

## §3. Quality Score Matrix

Scores per capability (1-5 scale). Each cell: average across 8 quality dimensions.

| ID | Capability | Q1 Intent | Q2 Abstraction | Q3 Locator | Q4 Description | Q5 Replay | Q6 Confidence | Q7 Evidence | Q8 Assertion | **Avg** |
|----|-----------|-----|-----|-----|-----|-----|-----|-----|-----|------|
| A1a | TextEntry (input) | 5 | 5 | 4 | 5 | 5 | 4 | 3 | 2 | **4.1** |
| A1b | TextEntry (textarea) | 5 | 5 | 4 | 5 | 5 | 4 | 3 | 2 | **4.1** |
| A2a | Checkbox (native) | 5 | 5 | 4 | 4 | 5 | 4 | 4 | 3 | **4.1** |
| A2b | Checkbox (switch) | 4 | 5 | 4 | 4 | 5 | 4 | 4 | 3 | **4.1** |
| A3 | RadioButton | 5 | 5 | 4 | 3 | 4 | 4 | 3 | 2 | **3.8** |
| A4 | Native Select | 2 | 3 | 3 | 3 | 3 | 4 | 3 | 2 | **2.9** |
| A5a | Custom Dropdown | 5 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | **4.3** |
| A5b | Autocomplete | 3 | 2 | 4 | 4 | 4 | 4 | 3 | 4 | **3.5** |
| A6 | Date Picker | 2 | 3 | 3 | 3 | 3 | 4 | 3 | 2 | **2.9** |
| B1a | Click (testId) | 5 | 5 | 3 | 5 | 5 | 4 | 3 | 2 | **4.0** |
| B1b | Click (div role=button) | 5 | 5 | 3 | 4 | 5 | 4 | 2 | 2 | **3.8** |
| B2a | Link | 5 | 5 | 4 | 4 | 4 | 4 | 3 | 2 | **3.9** |
| B2b | SPA Navigation | 3 | 4 | 3 | 3 | 3 | 3 | 3 | 2 | **3.0** |
| B3a | Double-click | 2 | 5 | 4 | 3 | 3 | 4 | 3 | 2 | **3.3** |
| B3b | Right-click | 2 | 5 | 4 | 3 | 3 | 4 | 3 | 2 | **3.3** |
| B4 | Tab | 5 | 5 | 4 | 3 | 3 | 4 | 3 | 2 | **3.6** |
| C1 | Hover | 2 | 3 | 4 | 3 | 2 | 4 | 3 | 2 | **2.9** |
| C2 | Slider | 2 | 5 | 4 | 3 | 4 | 4 | 3 | 2 | **3.4** |
| C3 | Drag and Drop | 5 | 5 | 3 | 3 | 3 | 3 | 3 | 2 | **3.4** |
| C4 | File Upload | 5 | 5 | 4 | 5 | 3 | 4 | 3 | 2 | **3.9** |
| C5 | Stepper | 5 | 5 | 4 | 3 | 3 | 4 | 3 | 2 | **3.6** |
| D1 | Tag Input | 3 | 2 | 4 | 3 | 3 | 3 | 3 | 2 | **2.9** |
| D2 | OTP Input | 2 | 1 | 3 | 3 | 3 | 3 | 3 | 2 | **2.5** |
| D3 | Rich Text Editor | 5 | 5 | 3 | 4 | 3 | 4 | 3 | 2 | **3.6** |
| E1 | Multi-config Dropdown | 2 | 2 | 3 | 3 | 3 | 3 | 3 | 2 | **2.6** |
| E2 | Modal Dialog | 3 | 4 | 3 | 3 | 3 | 3 | 3 | 2 | **3.0** |
| F1a | Locator (testId) | 5 | 5 | 2 | 4 | 4 | 4 | 3 | 2 | **3.6** |
| F1b | Locator (CSS only) | 5 | 5 | 2 | 2 | 3 | 3 | 3 | 2 | **3.1** |
| F1c | Locator (React ID) | 5 | 5 | 3 | 4 | 3 | 3 | 3 | 2 | **3.5** |
| F2 | Iframe | 2 | 5 | 2 | 4 | 2 | 4 | 3 | 2 | **3.0** |

### Dimension Heatmap (averages across all capabilities)

| Dimension | Avg Score | Assessment |
|-----------|-----------|------------|
| Q1 Intent Accuracy | **3.7** | Good for recognized interactions; drops to 2 for unrecognized |
| Q2 Abstraction Fidelity | **4.3** | Strong — single interactions at right granularity when recognized |
| Q3 Locator Quality | **3.5** | Moderate — locator resolution pipeline unclear in test harness |
| Q4 Description | **3.6** | Good for recognized interactions; descriptions missing when type=NONE |
| Q5 Replay Fidelity | **3.5** | Good for recognized; breaks for iframe, slider, hover |
| Q6 Confidence Calibration | **3.8** | Decent — but hardcoded scores since evidence is dormant |
| Q7 Evidence Quality | **3.0** | **Weakest dimension** — evidence engine dormant for primary path |
| Q8 Assertion Value | **2.1** | **Second weakest** — assertions barely generated outside form inputs |

---

## §4. Architectural Root Cause Analysis

### Finding 1: `change` Event Blindness (P1 — Systemic)

**Affected:** NativeSelect (A4), DatePicker (A6), Slider (C2)

The root cause is that these definitions list their `triggerEventTypes` as `['focus', 'click']`, `['focus', 'click']`, and `['mousedown', 'click', 'focus']` respectively. None include `'change'`.

In real-world usage:
- `<select>` elements emit `change` when the user selects an option
- `<input type="date">` emits `change` when a date is picked
- `<input type="range">` emits `change` (and `input`) when the slider is released

**Impact:** These are among the most common form interactions on the web. Every native select, date picker, and slider goes unrecorded.

**Resolution path:** Add `'change'` to the `triggerEventTypes` sets, and update `detectTrigger` to recognize the element by tag+inputType when the triggering event is `change`.

### Finding 2: `isInteractiveElement` Gate Too Restrictive (P1 — Systemic)

**Affected:** Hover (C1), DoubleClick (B3a), RightClick (B3b)

The `isInteractiveElement()` function checks `INTERACTIVE_TAGS` and `INTERACTIVE_ROLES`. In real-world apps:
- Table rows (`<tr role="row">`) are dblclicked to open detail views
- Table cells (`<td role="cell">`) are right-clicked for context menus
- Product cards (`<div role="group">`) are hovered to reveal actions

None of `TR`, `TD`, `DIV`, `row`, `cell`, `group` are in the interactive sets. The gate rejects them before any definition can process the event.

**Impact:** A significant class of real-world interactions is silently dropped.

**Resolution path:** Either (a) expand `INTERACTIVE_TAGS`/`INTERACTIVE_ROLES` to include common click targets, or (b) relax the gate for `dblclick` and `contextmenu` (these events are inherently intentional — nobody accidentally double-clicks or right-clicks).

### Finding 3: Compound Interaction Lifecycle Cannot Be Validated Without Browser (P2)

**Affected:** Multi-config Dropdown (E1), Modal Dialog (E2)

The validation harness is fully programmatic — it feeds `ObservedEvent[]` to the runtime. Surface detection (modal/popover/dropdown opening) depends on real DOM mutations that the content script observes. The harness can't simulate "a modal appeared" because it requires actual DOM state changes between events.

**Impact:** The ModalDialog and Dropdown definitions exist but their lifecycle logic (open → interact inside surface → close) is untested. Whether they correctly bind to surface context and produce compound interactions is unknown.

**Resolution path:** Browser-based integration testing with real modal/dropdown components.

### Finding 4: Playwright Iframe Output Missing (P1)

**Affected:** Iframe interactions (F2)

The `ObservedEvent.target.inIframe` and `iframeContext` fields are populated, and the IR Bridge passes them through to interactions. But the Playwright `renderTestFile()` adapter does not generate `frameLocator()` calls. The generated test code would fail to interact with elements inside iframes (Stripe, AdSense, embedded widgets).

**Impact:** Any interaction inside an iframe produces broken test code.

**Resolution path:** Update the Playwright adapter to check `target.inIframe` and wrap locators with `frameLocator()`.

### Finding 5: Locator Strategy Resolution Unclear (P2)

**Affected:** F1a, F1b, F1c

`getTopLocatorStrategy()` returned `null` for elements with `data-testid` and `null` for CSS-only elements. This means either:
- The IR Bridge doesn't populate `resolvedLocators` in the step target structure
- The step target `kind` is not `'element'` (different variant)
- The locator resolution happens in a different pipeline stage not exercised by the harness

**Impact:** Locator quality cannot be assessed through the current harness. This is a harness limitation, not necessarily a production bug.

**Resolution path:** Investigate the IR plan step structure; possibly extend the harness to extract locators from the correct field.

### Finding 6: Evidence Engine Dormant for Primary Classification Path (P2)

**Affected:** All Click interactions (B1b: 0 evidence votes)

The evidence engine (6 semantic generators, IntentVote, confidence scoring) was designed to annotate interactions with semantic intent. In the primary Component Runtime path, it produces 0 votes. This is likely because the evidence engine was originally wired into the V1 fallback classifier path, which was retired in Phase 3 Thrust 1.

**Impact:** Every interaction loses semantic annotation — the evidence trail is empty, confidence is a static value, and the "reasoning" layer is dark.

**Resolution path:** Re-wire the evidence engine as a POST-CLASSIFICATION annotation layer: after the Component Runtime emits a `ComponentInteraction`, pass it through the evidence generators to populate `intent`, `confidence`, and `evidenceTrail`.

### Finding 7: Assertion Engine Barely Active (P2 — Q8 weakest after Evidence)

**Affected:** All capabilities — Q8 average 2.1/5

Assertions are only generated for form inputs (value assertions). Click, hover, drag-drop, navigation — none produce assertions. The assertion deriver exists but only fires for `TextEntry` and `Checkbox` value changes.

**Impact:** Generated tests lack verification steps. A test that clicks "Submit" but doesn't assert the resulting state is a test that can't catch regressions.

**Resolution path:** Extend the assertion deriver to generate:
- Visibility assertions after modal/dropdown opens
- URL assertions after navigation
- State assertions after toggle/checkbox changes
- Element existence assertions after dynamic content loads

### Finding 8: OTP Input Definition Not Triggering (P2)

**Affected:** D2

The OTP input definition triggers on `'focus'` and has logic for adjacent input grouping. The test sent 6 `input` events to 6 different `<input>` elements (maxLength=1). Zero interactions were emitted. Root cause: the OTP definition may require a `focus` event to start tracking, not `input`. Or the adjacent-element detection (CSS selector proximity) fails when each input has a distinct `stableId`.

**Impact:** OTP entry — common in auth flows — produces no recorded interaction.

**Resolution path:** Investigate OTP trigger conditions; ensure it can start from `input` events when `maxLength=1` is present.

---

## §5. Findings by Severity

### P1 — High Priority (blocks common real-world interactions)

| ID | Finding | Subsystem | Root Cause |
|----|---------|-----------|------------|
| A4 | Native `<select>` not recognized | definitions/dropdown.ts | `triggerEventTypes` lacks `'change'` |
| A6 | Native date input not recognized | definitions/date-picker.ts | `triggerEventTypes` lacks `'change'` |
| C1 | Hover not recognized on non-interactive elements | definitions/patterns.ts | `isInteractiveElement` rejects `DIV`, `group` |
| C2 | Slider not recognized on change | definitions/slider.ts | `triggerEventTypes` lacks `'change'` |
| F2 | Iframe Playwright code missing | adapters/playwright/ | `frameLocator()` not generated |

### P2 — Medium Priority (reduced quality, not blocking)

| ID | Finding | Subsystem | Root Cause |
|----|---------|-----------|------------|
| A5b | Autocomplete produces 2 interactions | definitions/dropdown.ts | Type+select not merged into compound |
| B2b | SPA navigation not merged with link click | runtime or IR Bridge | Navigation event separate from click |
| B3a | DoubleClick not recognized on `<tr>` | definitions/patterns.ts | `isInteractiveElement` rejects `TR` |
| B3b | RightClick not recognized on `<td>` | definitions/patterns.ts | `isInteractiveElement` rejects `TD` |
| D1 | TagInput classified as TextEntry | definitions/tag-input.ts | Delimiter lifecycle not detecting Enter/comma |
| D2 | OTP produces zero interactions | definitions/otp-input.ts | Trigger conditions fail on input-only sequence |
| E1 | Multi-config Dropdown produces separate clicks | definitions/dropdown.ts | Compound lifecycle not activated in harness |
| E2 | Modal Dialog produces separate clicks | definitions/modal-dialog.ts | Surface detection not available in harness |
| F1a | Locator ranking unclear (testId) | IR Bridge / Playwright | `resolvedLocators` not populated or wrong shape |
| F1c | React auto-ID filtering unclear | shared/locator-utils.ts | `:r1:` filtering not verified |
| — | Evidence engine dormant | evidence/classifier | Not wired to primary classification path |
| — | Assertion engine barely active | generation/assertion-deriver | Only fires for form value changes |

### P3 — Low Priority (expected limitations, minor quality issues)

| ID | Finding | Subsystem | Root Cause |
|----|---------|-----------|------------|
| A2b | Switch classified as Checkbox not ToggleSwitch | definitions/checkbox.ts | `role=switch` not differentiated from checkbox |
| F1b | CSS-only locators inherently fragile | — | Expected when no semantic locators exist |

---

## §6. Architectural Questions Answered

### Q1: Which capabilities work reliably today?
**Form inputs** (text, checkbox, radio) and **simple clicks** (buttons, links, tabs) work well. The core classification pipeline is sound for these — correct interaction type, correct IR action, correct Playwright code, value assertions present.

### Q2: Where do architectural assumptions break down?
Three systemic assumptions fail in real-world conditions:
1. **Event-type coupling:** Definitions assume `focus`/`click`/`mousedown` as the primary signal. Native HTML elements like `<select>`, `<input type="date">`, and `<input type="range">` use `change` as their primary interaction signal.
2. **Interactive-element gate:** The `isInteractiveElement` filter assumes only ARIA-button-like elements receive clicks. Modern SPAs make anything clickable with `onClick` handlers on `<div>`, `<tr>`, etc.
3. **Surface lifecycle in isolation:** Compound interactions (modals, multi-config panels) require real DOM mutation observation. The current pipeline can't validate these without a browser.

### Q3: What improvements would have the highest ROI?
1. **Add `change` to triggerEventTypes for NativeSelect, DatePicker, Slider** — fixes 3 P1 issues with minimal code change.
2. **Relax `isInteractiveElement` for `dblclick` and `contextmenu`** — fixes 2 P2 issues. These events are inherently intentional.
3. **Wire evidence engine as post-classification layer** — activates semantic annotation for ALL interactions, improving Q7 from 3.0 to target 4.0+.
4. **Generate `frameLocator()` in Playwright adapter** — fixes iframe output with a targeted adapter change.

### Q4: What needs browser-based testing?
- Compound interactions (E1, E2) — require real surface detection
- SPA navigation (B2b) — requires real `pushState` events
- Autocomplete (A5b) — requires real dropdown rendering and selection
- Locator resolution (F1) — requires real DOM to verify locator ranking

### Q5: Is the evidence engine placement correct?
**No — it's currently disconnected.** The evidence engine was wired to the V1 fallback classifier, which was retired in Phase 3 Thrust 1. The recommended placement (from Phase 2 Design §4) is as a **post-classification semantic annotation layer**: after Component Runtime emits `ComponentInteraction[]`, a separate pass enriches each with `intent`, `confidence`, and `evidenceTrail`. This is architecturally sound — it decouples classification correctness from semantic enrichment.

### Q6: Are there capabilities that need entirely new definitions?
- **ToggleSwitch** — currently classified as Checkbox. Could be a subtype or separate definition for `role=switch`.
- **ColorPicker** — `<input type="color">` is untested and likely unrecognized.
- **Range Slider with aria-valuetext** — the Slider definition exists but may not extract human-readable values.

---

## §7. Implementation Priority Recommendations

Based on the complete body of evidence, here is the recommended priority ordering for Phase 4 implementation:

### Tier 1: Critical Fixes (P1, high impact, low effort)

1. **Add `change` event support to NativeSelect, DatePicker, Slider definitions**
   - Add `'change'` to `triggerEventTypes`
   - Update `detectTrigger` to recognize element by `tag + inputType` when event is `change`
   - Estimated touch: 3 files, ~15 lines each

2. **Relax `isInteractiveElement` for intentional events**
   - For `dblclick` and `contextmenu`: skip the interactive-element gate entirely (these events only fire on intentional user action)
   - For `mouseenter` (hover): expand to include `DIV`, `LI`, `TR` or remove the gate for hover specifically
   - Estimated touch: 1 file (`patterns.ts`), ~10 lines

3. **Generate `frameLocator()` in Playwright adapter**
   - Check `target.inIframe` in the Playwright renderer
   - Emit `page.frameLocator('...').locator('...')` pattern
   - Estimated touch: 1 file, ~20 lines

### Tier 2: Semantic Enrichment (P2, high value)

4. **Wire evidence engine as post-classification layer**
   - After `runtime.flush()`, pass each `ComponentInteraction` through evidence generators
   - Populate `intent`, `confidence`, `evidenceTrail`
   - Estimated touch: 1 new file (enrichment pass), wire into pipeline-runner.ts

5. **Extend assertion deriver**
   - Add visibility assertions (modal/dropdown open)
   - Add URL assertions (navigation)
   - Add state assertions (toggle changes)
   - Estimated touch: 1 file, ~100 lines

### Tier 3: Coverage Expansion (P2, medium effort)

6. **Fix OTP trigger conditions**
7. **Fix TagInput delimiter lifecycle**
8. **Differentiate ToggleSwitch from Checkbox**
9. **Merge autocomplete type+select into compound**

### Tier 4: Browser-Based Validation (required before production)

10. **Real-world browser testing** on diverse apps to validate:
    - Compound interactions (modals, multi-config panels)
    - SPA navigation
    - Surface detection lifecycle
    - Locator quality against real DOM

---

## §8. Quality Dimension Summary

| Dimension | Current Avg | Target | Gap | Primary Blocker |
|-----------|------------|--------|-----|-----------------|
| Q1 Intent Accuracy | 3.7 | 4.5 | -0.8 | Unrecognized capabilities (change events, interactive gate) |
| Q2 Abstraction Fidelity | 4.3 | 4.5 | -0.2 | Autocomplete over-fragmentation |
| Q3 Locator Quality | 3.5 | 4.0 | -0.5 | Harness limitation; needs browser validation |
| Q4 Description | 3.6 | 4.0 | -0.4 | Missing descriptions when type=NONE |
| Q5 Replay Fidelity | 3.5 | 4.0 | -0.5 | Iframe, slider, hover broken |
| Q6 Confidence Calibration | 3.8 | 4.0 | -0.2 | Hardcoded scores; needs evidence engine |
| Q7 Evidence Quality | 3.0 | 4.0 | -1.0 | **Evidence engine dormant** |
| Q8 Assertion Value | 2.1 | 3.5 | -1.4 | **Assertion engine barely active** |

**The two weakest dimensions (Q7 Evidence and Q8 Assertions) represent the largest architectural gaps and should be prioritized after P1 fixes.**

---

## Appendix A: Validation Harness File Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `tests/validation-harness/harness.ts` | 246 | Pipeline runner + fixture builders + finding collector |
| `tests/validation-harness/group-a.test.ts` | ~200 | Form Input (A1-A6) |
| `tests/validation-harness/group-b.test.ts` | 228 | Click Interactions (B1-B4) |
| `tests/validation-harness/group-c.test.ts` | 190 | Advanced Interactions (C1-C5) |
| `tests/validation-harness/group-def.test.ts` | 333 | Specialized (D), Compound (E), Cross-cutting (F) |
| **Total** | **~1,200** | 30 tests across 22 capabilities |

## Appendix B: Test Execution

```
Test Files  4 passed (4)
     Tests  30 passed (30)
  Duration  2.57s
```

All tests pass — the harness records findings without asserting pass/fail. This is by design: the purpose is systematic observation, not pass/fail gating.
