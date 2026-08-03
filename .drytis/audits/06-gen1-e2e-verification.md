# Gen 1 End-to-End Verification: Real-World Testing Across 5 Domains

## Test Harness

**File**: `tests/gen1-e2e-verification.test.ts` (783 lines, 48 tests)  
**Method**: Simulated 5 real-world web application scenarios through `runPipeline()` (the actual production pipeline function), then traced outputs through every Gen 1 layer: domain adapter → recognition → enrichment → IR Bridge → Playwright generation → side panel data structures.

**Domains tested**:
1. **E-Commerce** (product search, price slider, category dropdown, add-to-cart)
2. **Travel** (flight search, date picker, passenger dropdown, radio button)
3. **Banking** (login form, account dropdown, amount input, transfer button)
4. **Healthcare** (patient intake, date picker, checkbox consent, submit)
5. **SaaS** (project creation, custom R3: div-checkbox, div-dropdown, div-slider)

## Results Summary

| Metric | Count |
|--------|-------|
| Total tests | 48 |
| Pass | 48 |
| Fail | 0 |
| Known flaky (not Gen 1 related) | 1 (milestone4-performance-scaling JSDOM timing) |

Full regression: **3335 pass, 1 fail** (known flaky timing test, unrelated to Gen 1).

---

## Findings: Confirmed, Disproved, and New

### CONFIRMED Findings (from prior analysis)

#### D-R1: ancestorRoles truncated to [target] only — CONFIRMED
**Location**: `pipeline-runner.ts:109`  
**Evidence**: Every test scenario showed structural recognition only matching when the interacted element's OWN role is a pattern root role. No ancestor-dependent recognition worked. Radio inside radiogroup, tab inside tablist — all fail.

#### D-R2: relatedElementIds always [] — CONFIRMED  
**Location**: `pipeline-runner.ts:110`  
**Evidence**: Behavioral recognition receives empty relatedElementIds in every scenario. `recognizeBehaviorally` filters transitions to `relatedSet` — with empty set, no transitions pass through, so behavioral recognition NEVER fires in production.

#### D-R4: Multi-operation lifecycles unachievable — CONFIRMED
**Location**: `pattern-catalogue.ts:358` (DROPDOWN expectedLifecycle: [CLICK, SELECT])  
**Evidence**: Dropdown interaction produces ONE transition with operation='select'. Pattern expects [CLICK, SELECT] (set containment). {SELECT} ⊄ {CLICK, SELECT} → never CONFIRMED. Even if recognition fired, lifecycle would be stuck at TENTATIVE.

#### D-R5: componentId never assigned — CONFIRMED
**Location**: `domain-adapter-v2.ts` — `assignTransitionToComponent()` exists but is never called  
**Evidence**: Every transition in every scenario has `componentId: null`.

#### D-A1: Slider maps to CLICK operation — CONFIRMED
**Evidence**: Slider interaction produces transition with `operation: 'click'`. Semantic gap: slider should produce 'slide' or 'adjust' operation.

#### D-E1: NoOp DomInspector (optionSets always null) — CONFIRMED
**Location**: `pipeline-runner.ts:67` creates `createNoOpDomInspector()`  
**Evidence**: All scenarios with dropdowns show `optionSet: null` in enrichment output. NoOp returns null for querySelector, [] for querySelectorAll.

### PARTIALLY DISPROVED Findings

#### D-E2: BehavioralContract gated on CONFIRMED — PARTIALLY DISPROVED
**Original finding**: BehavioralContract is gated on CONFIRMED components, so no contracts are ever produced.  
**Disproof**: Checkbox with role=checkbox IS structurally recognized (self-matching role, minConstituents=1). Lifecycle [TOGGLE] is satisfied by single TOGGLE transition. So checkbox DOES reach CONFIRMED and DOES get a BehavioralContract.  
**Revised finding**: BehavioralContract IS produced for single-element patterns with single-operation lifecycles (Checkbox, Modal, Tabs, Accordion). NOT produced for multi-constituent patterns (Dropdown, RadioGroup) that never reach CONFIRMED.

#### D-R4 for Checkbox — DISPROVED
**Original finding**: Multi-operation lifecycles can't be satisfied by single-transition adapter.  
**Disproof for Checkbox**: Checkbox expectedLifecycle=[TOGGLE]. Domain adapter assigns TOGGLE to checkbox transition. Set containment: {TOGGLE} ⊆ {TOGGLE} → CONFIRMED. Works correctly.

#### D-R4 for Dropdown — CONFIRMED (but for different reason)
Dropdown fails for TWO compounding reasons:
1. **Recognition failure** (D-R-DROPDOWN, new finding below): minConstituents=2 can't be met without siblings
2. **Lifecycle failure** (D-R4): even if recognized, [CLICK, SELECT] can't be satisfied by single 'select' transition

### NEW Findings (discovered during testing)

#### D-R-DROPDOWN: DROPDOWN pattern NEVER structurally recognized in production pipeline
**Severity**: HIGH  
**Location**: `pipeline-runner.ts:109-110` + `pattern-catalogue.ts:355` (minConstituents=2)  
**Root cause**: DROPDOWN pattern requires minConstituents=2 (trigger + at least 1 option). pipeline-runner only knows about the interacted element. It passes `ancestorRoles: [roleInfo]` (target only) and `relatedElementIds: []` (empty). The structural recognizer builds `roleChain` from ancestorRoles and `allElements` from roleChain + siblings. With only 1 element, `allConstituents.length < 2` → pattern returns null.  
**Evidence**: Test "CONFIRMED FINDING D-R-DROPDOWN" — 0 dropdown components recognized across all 5 scenarios. Even when combobox role is present, minConstituents=2 prevents match.  
**Impact**: All custom dropdowns (div[role=combobox]) and native selects classified as 'Dropdown' InteractionType fail recognition entirely. They appear as standalone transitions with no component grouping.

#### D-A-RadioButton: RadioButton maps to TOGGLE, pattern expects SELECT — CONFIRMED
**Location**: `domain-adapter-v2.ts` DEFAULT_V2_TYPE maps RadioButton → 'RadioButton' → operation='toggle'. Pattern RADIO_GROUP expects [SELECT].  
**Evidence**: Radio button in Travel scenario produces transition with operation='toggle'. Pattern expects SELECT. {TOGGLE} ⊄ {SELECT} → never CONFIRMED.  
**Note**: Radio inside radiogroup also fails recognition because radiogroup is an ancestor role, and D-R1 truncates ancestorRoles.

#### D-A-Checkbox-Op: Checkbox behavioral-recognizer expects 'click' operation
**Location**: `behavioral-recognizer.ts` — `evaluateCondition` checks `condition.expectedOperation`  
**Evidence**: Checkbox behavioral signature condition expects operation='click'. Adapter assigns 'toggle' to checkbox interactions. So behavioral recognition for custom checkboxes (div[role=checkbox]) also fails on the operation mismatch. However, structural recognition for role=checkbox still works because it doesn't check operations.

#### D-IR-WaitStrategy: IR Bridge applies 'visible' wait to toggle steps even at confidence 0.8
**Location**: `ir-bridge.ts` wait strategy logic  
**Evidence**: Toggle steps in SAAS scenario get `waitStrategy: 'visible'` even with confidence=0.8 (above 0.7 threshold). This is likely intentional (wait for element to be visible before toggling), not a bug.

#### D-IR-Navigate: IR Bridge does not auto-add NAVIGATE as first step
**Evidence**: IR Bridge output starts with fill/select/toggle/click steps, no 'navigate' step. Navigate is typically added by the test case wrapper or the PlaywrightCodeGenerator, not the IR Bridge itself. This is by design — IR Bridge produces interaction steps, the generator wraps them with navigation.

---

## Complete End-to-End Map: Interaction Type → What Survives

### TextEntry (text input, textarea, search)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | focus, input, blur events. DomContext with required, pattern, minLength, maxLength, inputType | ElementIdentity (18 fields), DomContext (30+ fields), value before/after |
| Component Runtime | TextEntryDefinition (priority 30). Classifies as TextEntry. Evidence: valueChange +0.6 | ComponentInteraction type=TextEntry, metadata.evidenceTrail |
| Domain Adapter | DEFAULT_V2_TYPE → operation='fill'. Builds domAttributes from DomContext | ObservedTransition operation='fill', domAttributes={required, type, pattern, minlength, maxlength} |
| Recognition | No pattern match (not a composite component) | No component grouping |
| Enrichment | buildStandaloneAction → businessField=accessibleName, displayLabel | LogicalAction businessField, sourceInteractionType=TextEntry |
| IR Bridge | FILL step with selector, value | Playwright: `page.fill(selector, value)` |
| Side Panel | "Typed in 'Email Address' field" | Timestamp, value, field name |

**Gen 1 status**: ✅ Working end-to-end after Tier 1.

### Click (button, link, submit)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click event. post-click value polling (50/150/400ms), R3.4 attribute re-snapshot | ElementIdentity, DomContext, valueAfter (if changed) |
| Component Runtime | ClickDefinition (priority 180, fallback). Classifies as Click. R3.4 may reclassify if attribute changes detected | ComponentInteraction type=Click (or reclassified type) |
| Domain Adapter | operation='click' | ObservedTransition operation='click' |
| Recognition | May match MODAL, TABS, ACCORDION if role matches | Component if matched, standalone if not |
| Enrichment | If standalone: businessField=accessibleName | LogicalAction with sourceInteractionType=Click |
| IR Bridge | CLICK step | Playwright: `page.click(selector)` |
| Side Panel | "Clicked 'Submit' button" | Timestamp, element label |

**Gen 1 status**: ✅ Working. Note: Click on submit buttons now produces businessField (Tier 1 side effect — D7 concern for Capability, not Gen 1).

### Checkbox (native input[type=checkbox] or div[role=checkbox])
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click event. checked state before/after. R3.4 attribute re-snapshot | checkedBefore, checkedAfter |
| Component Runtime | CheckboxDefinition (priority 40). Classifies as Checkbox. Evidence: triggerStateChanged +0.5 | ComponentInteraction type=Checkbox, metadata.evidenceTrail |
| Domain Adapter | operation='toggle' | ObservedTransition operation='toggle' |
| Recognition | Structural: role=checkbox → CHECKBOX pattern, minConstituents=1 → MATCHED, CONFIRMED | ComponentGrouping patternType=checkbox, lifecycleState=confirmed |
| Enrichment | BehavioralContract produced (CONFIRMED). businessField=accessibleName | LogicalAction sourceInteractionType=Checkbox, BehavioralContract |
| IR Bridge | TOGGLE step with waitStrategy='visible' | Playwright: `page.click(selector)` with check assertion |
| Side Panel | "Toggled 'Subscribe to newsletter' checkbox" | Timestamp, checked state |

**Gen 1 status**: ✅ Working end-to-end for native and ARIA checkboxes.

### RadioButton (native input[type=radio] or div[role=radio])
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click event. checked state before/after | ElementIdentity, checkedBefore/After |
| Component Runtime | RadioButtonDefinition (priority 45). Classifies as RadioButton | ComponentInteraction type=RadioButton |
| Domain Adapter | operation='toggle' (MISMATCH: pattern expects SELECT) | ObservedTransition operation='toggle' |
| Recognition | Structural: role=radio is NOT a root role (RADIO_GROUP root=radiogroup). Needs ancestor. D-R1 truncates → FAILS. | No component grouping |
| Enrichment | Standalone: businessField=accessibleName | LogicalAction sourceInteractionType=RadioButton |
| IR Bridge | TOGGLE step | Playwright: `page.click(selector)` |
| Side Panel | "Selected 'Economy' radio button" | Timestamp, label |

**Gen 1 status**: ⚠️ Partially working. Standalone path works (IR Bridge → Playwright). Component grouping BROKEN: (1) ancestor roles truncated, (2) operation mismatch (toggle vs select).

### Native Dropdown (select element)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click + change events. value before/after | ElementIdentity, DomContext (inputType=select-one), valueAfter |
| Component Runtime | SelectDefinition (priority 50). Classifies as Dropdown | ComponentInteraction type=Dropdown, metadata.selectedValue |
| Domain Adapter | operation='select' | ObservedTransition operation='select' |
| Recognition | tag=SELECT, no ARIA role → no structural match. minConstituents=2 → fails even if combobox role | No component grouping |
| Enrichment | Standalone: businessField=accessibleName. OptionSet=null (NoOp) | LogicalAction sourceInteractionType=CustomDropdown |
| IR Bridge | SELECT step | Playwright: `page.selectOption(selector, value)` |
| Side Panel | "Selected 'Active' from dropdown" | Timestamp, value |

**Gen 1 status**: ⚠️ Partially working. IR Bridge correctly generates select steps. But no component grouping, no optionSet extraction.

### Custom Dropdown (div[role=combobox])
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click event. ariaExpanded tracked. R3.4 attribute re-snapshot | ElementIdentity (ariaRole=combobox), DomContext (ariaExpanded, ariaHasPopup) |
| Component Runtime | May be classified as Dropdown (if R3 detects panel emergence) or Click (fallback) | ComponentInteraction type=Dropdown or Click |
| Domain Adapter | operation='select' (if Dropdown) or 'click' (if Click) | ObservedTransition |
| Recognition | Structural: combobox is DROPDOWN root role. BUT minConstituents=2 → FAILS (no option siblings available) | No component grouping |
| Enrichment | Standalone. OptionSet=null (NoOp) | LogicalAction |
| IR Bridge | SELECT or CLICK step | Playwright |
| Side Panel | "Selected from custom dropdown" or "Clicked combobox" | Timestamp |

**Gen 1 status**: ❌ Recognition broken (D-R-DROPDOWN). IR Bridge works for standalone. No optionSet, no behavioral contract.

### DatePicker
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click + change events. value transitions | ElementIdentity, DomContext, valueAfter (date string) |
| Component Runtime | Classified as DatePicker (if R2/R3 detects) or TextEntry (fallback) | ComponentInteraction type=DatePicker or TextEntry |
| Domain Adapter | operation='fill' (if TextEntry) or 'select' (if DatePicker→Dropdown) | ObservedTransition |
| Recognition | No DATE_PICKER pattern registered → no structural match | No component grouping |
| Enrichment | Standalone | LogicalAction |
| IR Bridge | FILL or SELECT step | Playwright: `page.fill(selector, date)` |
| Side Panel | "Selected date '2024-03-15'" or "Typed in date field" | Timestamp, value |

**Gen 1 status**: ⚠️ Works as standalone. No pattern definition, no recognition, no component grouping. R2/R3 may classify correctly but no downstream component understanding.

### Slider (native input[type=range] or div[role=slider])
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | input events. value transitions. R2: ariaValueMin/Max/Now, keyboard detection | ElementIdentity, DomContext (ariaValueMin/Max, inputType=range), valueBefore/After |
| Component Runtime | R2 SliderDefinition (priority 35). Classifies as Slider. Evidence: sliderValue +0.5 | ComponentInteraction type=Slider, metadata.evidenceTrail |
| Domain Adapter | operation='click' (MISMATCH: should be 'slide' or 'adjust') | ObservedTransition operation='click' |
| Recognition | No SLIDER pattern registered → no structural match | No component grouping |
| Enrichment | Standalone: businessField=accessibleName. Constraints: valueRange from ariaValueMin/Max in domAttributes | LogicalAction sourceInteractionType=Slider, constraints with min/max |
| IR Bridge | FILL step (slider value) | Playwright: `page.fill(selector, value)` |
| Side Panel | "Adjusted 'Maximum Price' slider to 250" | Timestamp, value, min/max |

**Gen 1 status**: ⚠️ Classification works (R2). IR Bridge works. But operation='click' is semantically wrong, no pattern, no recognition.

### Hover (mouseover/mouseout)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | mouseover, mouseout events | ElementIdentity, pointer coordinates |
| Component Runtime | HoverDefinition (priority 70). Classifies as Hover | ComponentInteraction type=Hover |
| Domain Adapter | operation='hover' | ObservedTransition operation='hover' |
| Recognition | No HOVER pattern → no match | No component grouping |
| Enrichment | Standalone | LogicalAction sourceInteractionType=Hover |
| IR Bridge | HOVER step | Playwright: `page.hover(selector)` |
| Side Panel | "Hovered 'Menu item'" | Timestamp |

**Gen 1 status**: ✅ Working as standalone. No component grouping by design (hover is not a composite component).

### Scroll
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | scroll event. scrollX/Y, scrollDelta | ElementIdentity (__page__), scroll position |
| Component Runtime | ScrollDefinition (priority 75). Classifies as Scroll | ComponentInteraction type=Scroll |
| Domain Adapter | operation='scroll' | ObservedTransition operation='scroll' |
| Recognition | Element is __page__ → skipped (line 98) | No component grouping |
| Enrichment | Standalone | LogicalAction sourceInteractionType=Scroll |
| IR Bridge | SCROLL step | Playwright: `page.scrollTo(x, y)` |
| Side Panel | "Scrolled page" | Timestamp, position |

**Gen 1 status**: ✅ Working.

### Navigation (URL change, SPA route)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | popstate/hashchange/navigation event | URL before/after |
| Component Runtime | NavigationDefinition (priority 10). Classifies as Navigation | ComponentInteraction type=Navigation |
| Domain Adapter | operation='navigate'. elementId='__page__' | ObservedTransition operation='navigate' |
| Recognition | elementId='__page__' → skipped (line 98) | No component grouping |
| Enrichment | Standalone | LogicalAction sourceInteractionType=Navigation |
| IR Bridge | NAVIGATE step | Playwright: `page.goto(url)` |
| Side Panel | "Navigated to https://example.com/page2" | Timestamp, URL |

**Gen 1 status**: ✅ Working.

### Tabs (role=tablist, role=tab)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | click on tab element | ElementIdentity (ariaRole=tab), ancestor: tablist |
| Component Runtime | ClickDefinition (fallback, priority 180) or R3 reclassification | ComponentInteraction type=Click or Tab |
| Domain Adapter | operation='click' | ObservedTransition operation='click' |
| Recognition | Structural: tablist is TABS root role. BUT ancestor truncated (D-R1) → only tab role in chain → tab is NOT a root role → FAILS | No component grouping |
| Enrichment | Standalone | LogicalAction |
| IR Bridge | CLICK step | Playwright: `page.click(selector)` |
| Side Panel | "Clicked 'Settings' tab" | Timestamp |

**Gen 1 status**: ❌ Recognition broken (D-R1 ancestor truncation). Standalone path works. TABS pattern expectedLifecycle=[CLICK] would be satisfiable if recognition fired.

### Autocomplete (combobox with dynamic suggestions)
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | focus, input events. R3.4: suggestion panel emergence detected | ElementIdentity (ariaRole=combobox), DomContext (ariaExpanded, ariaHasPopup) |
| Component Runtime | R3 may classify as Dropdown (if panel emergence evidence) or TextEntry (if typing only) | ComponentInteraction type=Dropdown or TextEntry |
| Domain Adapter | operation='fill' (TextEntry) or 'select' (Dropdown) | ObservedTransition |
| Recognition | Same as custom dropdown: combobox root role, minConstituents=2 → FAILS | No component grouping |
| Enrichment | Standalone. OptionSet=null | LogicalAction |
| IR Bridge | FILL or SELECT step | Playwright |
| Side Panel | "Typed in search field" or "Selected from autocomplete" | Timestamp |

**Gen 1 status**: ❌ Recognition broken (same as custom dropdown). R3 evidence may detect suggestions but recognition can't group them.

### Drag and Drop
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | mousedown, mousemove, mouseup events. pointer coordinates | ElementIdentity (source + target), pointer coords |
| Component Runtime | ClickDefinition (fallback, priority 180) — NO drag/drop definition exists | ComponentInteraction type=Click |
| Domain Adapter | operation='click' (MISMATCH) | ObservedTransition operation='click' |
| Recognition | No DRAG_DROP pattern → no match | No component grouping |
| Enrichment | Standalone | LogicalAction sourceInteractionType=Click |
| IR Bridge | CLICK step (MISMATCH: should be drag) | Playwright: `page.click()` (WRONG) |
| Side Panel | "Clicked element" (WRONG: should show drag) | Timestamp |

**Gen 1 status**: ❌ Semantic gap. No drag/drop definition, classified as Click, wrong IR step.

### Novel / Unrecognized Interactions
| Layer | What happens | What survives |
|-------|-------------|---------------|
| Capture | Events captured normally | ElementIdentity, DomContext |
| Component Runtime | ClickDefinition fallback (priority 180). Classifies as Click with confidence < UNRECOGNIZED_THRESHOLD | ComponentInteraction type=Click, confidence < 0.3 |
| Domain Adapter | operation='click' | ObservedTransition operation='click' |
| Recognition | No pattern match | No component grouping |
| Enrichment | Standalone. businessField=accessibleName | LogicalAction sourceInteractionType=Click |
| IR Bridge | CLICK step | Playwright: `page.click(selector)` |
| Side Panel | "Clicked element" (generic) | Timestamp |

**Gen 1 status**: ⚠️ Graceful degradation works — no crash, fallback to Click. But semantic understanding is lost: novel interaction treated as click. R3 behavioral evidence (if any) is captured in ComponentInteraction.metadata but not displayed in side panel.

---

## Disconnect Summary (Updated)

| ID | Severity | Disconnect | Confirmed? | Impact |
|----|----------|-----------|------------|--------|
| D-R1 | HIGH | ancestorRoles truncated to [target] only | ✅ Confirmed | Radio, Tab, Accordion (ancestor-dependent patterns) never recognized |
| D-R2 | HIGH | relatedElementIds always [] | ✅ Confirmed | Behavioral recognition NEVER fires in production |
| D-R-DROPDOWN | HIGH | DROPDOWN minConstituents=2 unmet (no siblings) | ✅ Confirmed (NEW) | All dropdowns fail structural recognition |
| D-R4 | MEDIUM | Multi-op lifecycles unachievable | ✅ Confirmed (Dropdown) / ❌ Disproved (Checkbox) | Dropdown lifecycle stuck at TENTATIVE |
| D-R5 | MEDIUM | componentId never assigned | ✅ Confirmed | Transitions not linked to components |
| D-A1 | MEDIUM | Slider operation='click' (should be slide) | ✅ Confirmed | Semantic gap in IR generation |
| D-A-RadioButton | MEDIUM | RadioButton operation='toggle' (pattern expects SELECT) | ✅ Confirmed (NEW) | Radio lifecycle never confirmed |
| D-A-Checkbox-Op | LOW | Checkbox behavioral signature expects 'click' (adapter sends 'toggle') | ✅ Confirmed (NEW) | Behavioral recognition for custom checkboxes fails on operation check |
| D-E1 | MEDIUM | NoOp DomInspector | ✅ Confirmed | OptionSets always null |
| D-E2 | LOW | BehavioralContract gated on CONFIRMED | ❌ Disproved for Checkbox / ✅ for Dropdown/Radio | Contracts work for simple patterns, not complex ones |
| D-A-DragDrop | MEDIUM | No DragDrop definition, maps to Click | ✅ Confirmed (NEW) | Wrong IR step, wrong side panel label |

---

## What Works in Gen 1 (End-to-End)

1. **Event capture** — 19 event types, 18-field ElementIdentity, 30+ DomContext fields, SPA deferred blur, post-click value polling, R3.4 attribute re-snapshot. All working.

2. **Component Runtime classification** — 23 lifecycle definitions, R3 behavioral evidence, R2 slider geometry, R3.4 deferred annotation. All working. Correctly classifies TextEntry, Click, Checkbox, RadioButton, Dropdown, Slider, Hover, Scroll, Navigation.

3. **IR Bridge** — Consumes ComponentInteraction[] directly, generates Playwright code. Works for all standalone interactions: FILL, CLICK, SELECT, TOGGLE, HOVER, SCROLL, NAVIGATE.

4. **Side Panel display** — Recording timeline, stopped view, replay JSON, IR steps, Playwright files. Working.

5. **Single-element structural recognition** — Checkbox (role=checkbox, minConstituents=1) correctly recognized and confirmed.

## What's Broken in Gen 1

1. **Multi-constituent recognition** — Dropdown, RadioGroup, Tabs, Accordion all fail because:
   - Ancestor roles truncated (D-R1)
   - No sibling elements (D-R-DROPDOWN, D-R2)
   - No DOM access in MV3 service worker (D-E1)

2. **Behavioral recognition** — Never fires because relatedElementIds is always empty (D-R2)

3. **Lifecycle for multi-op patterns** — Dropdown [CLICK, SELECT] can't be satisfied (D-R4)

4. **Operation mismatches** — Slider→click, RadioButton→toggle vs select, Checkbox behavioral→click vs toggle (D-A1, D-A-RadioButton, D-A-Checkbox-Op)

5. **Missing patterns** — No Slider, DatePicker, FileUpload, DragDrop, Autocomplete patterns

6. **OptionSet extraction** — NoOp DomInspector returns null (D-E1, MV3 constraint)

7. **Semantic gaps** — DragDrop classified as Click, no drag IR step

## Root Cause Analysis

All Gen 1 recognition/enrichment failures stem from **two root causes**:

### Root Cause 1: pipeline-runner.ts starves the recognizers
Lines 109-110 pass only the interacted element, no ancestors, no siblings, no related elements. This was identified in the original analysis (D-R1, D-R2) but the e2e testing revealed an additional consequence: even self-matching patterns with minConstituents > 1 (DROPDOWN) fail entirely, not just lifecycle incomplete.

### Root Cause 2: MV3 service worker has no DOM access
The pipeline runs in the service worker, which cannot access the page DOM. DomInspector is NoOp. This means:
- OptionSet extraction returns null
- Sibling/ancestor discovery is impossible
- Structural recognition for multi-constituent patterns can never work without DOM access

**The design intended enrichment to have DOM access** (STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md describes DomInspector with querySelector/querySelectorAll for real DOM queries). The MV3 architecture constraint prevents this.

These two root causes are **independent but compounding**: fixing pipeline-runner data flow (Root Cause 1) without solving DOM access (Root Cause 2) would only help if the data was already captured at observation time and carried through — which it partially is (DomContext fields) but not sufficiently (no sibling elements, no full ancestor chain).

---

## Gen 1 vs Gen 2 Boundary

This testing confirms that the Gen 1 pipeline (capture → runtime → IR Bridge → Playwright → side panel) works for standalone interactions. The recognition/enrichment layers (designed for component understanding) are effectively inert for multi-constituent components due to the two root causes above.

The Gen 2 pipeline (domain adapter → recognition → enrichment → capability) inherits ALL of Gen 1's recognition problems plus its own disconnects (businessField, componentId, sourceInteractionType). Tier 1 fixes addressed the Gen 2-specific disconnects but did NOT address the Gen 1 recognition root causes.
