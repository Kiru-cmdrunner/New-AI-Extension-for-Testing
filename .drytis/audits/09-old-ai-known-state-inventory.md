# Old AI's Known State: Complete Inventory

## Methodology

Systematic search across 151 test files, 68 golden-master fixtures, 40+ spec files, 100+ git commits, handover docs, architecture reviews, roadmap documents, and prior audits. Every item classified into one of four categories based on the old AI's own documentation.

---

## Category A: Confirmed Defects (Broken / Not Working)

### A1. The Seven Broken Connections (Gen 1 Pipeline Wiring)

These are production code defects where data was captured but discarded at a wiring boundary. All seven trace to the domain adapter / pipeline runner boundary — the point where R3 behavioral intelligence is lost.

| ID | Defect | Location | Severity |
|----|--------|----------|----------|
| A1 | `domAttributes` always empty — adapter reads `domContext?.domAttributes` which doesn't exist on the type | `domain-adapter-v2.ts:393-394` | HIGH |
| A2 | `componentId` NEVER assigned — `assignTransitionToComponent()` has zero call sites in entire codebase | `observed-transition.ts:235` | CRITICAL |
| A3 | `businessField` reads dead source — queries NoOpDomInspector which returns null | `option-set-extractor.ts:124-128` | CRITICAL |
| A4 | `ancestorRoles` truncated — pipeline runner passes `[roleInfo]` instead of full 10-level chain | `pipeline-runner.ts:109` | HIGH |
| A5 | Checkbox behavioral signature mismatch — recognizer expects `expectedOperation='click'`, adapter sends `'toggle'` | `behavioral-recognizer.ts` | MEDIUM |
| A6 | RadioGroup lifecycle mismatch — adapter maps RadioButton→TOGGLE, pattern expects [SELECT] | `domain-adapter-v2.ts:48-98` | MEDIUM |
| A7 | Dropdown lifecycle over-specified — one SELECT transition can't satisfy [CLICK, SELECT] | `pattern-catalogue.ts:358` | MEDIUM |

### A8. R3 Evidence Flow Broken at Domain Adapter (Most Critical)

R3 invested in 4 behavioral generators (value-change, panel-emergence, selection-state, slider-value) with annotation deferral and weight calibration. ALL of this intelligence is captured in `ComponentInteraction.metadata.evidenceTrail` (IntentVote[]). The domain adapter reads NONE of it. `buildEvidence()` only produces VALUE_CHANGE, STATE_CHANGE, NAVIGATION — never MUTATION or CLASS_CHANGE. This blinds 5 of 9 behavioral signals.

### A9. RelatedElementIds Always Empty

`pipeline-runner.ts:110` passes `relatedElementIds: []` — behavioral recognition's `recognizeBehaviorally()` filters transitions to the related set, which is always empty, so behavioral recognition NEVER fires in production.

### A10. DROPDOWN Pattern Never Structurally Recognized

DROPDOWN requires `minConstituents=2` (trigger + option). Without sibling capture (never implemented at any layer), structural recognition can never satisfy this constraint.

### A11. Previously Fixed Production Defects (Historical Record)

| Bug | Fix Commit | Status |
|-----|-----------|--------|
| `RecordingState.Error` missing from enum | `phase1-cleanup-postmortem.md` | Fixed |
| `InteractionMetadata` missing 11 fields | `phase1-cleanup-postmortem.md` | Fixed |
| Broken import paths | `phase1-cleanup-postmortem.md` | Fixed |
| `isLink()` anchor toggle preemption | `a59dc52` | Fixed |
| 6 iframe infrastructure bugs | `f981613` | Fixed |
| 3 AdaniOne bugs (duplicate interactions, dialog dropdowns) | `e9063df` | Fixed |
| 4 recorder pipeline bugs | `fcee3a7` | Fixed |
| 2 Component Runtime bugs (text entry, click misclassification) | `4bdb9fa` | Fixed |
| DatePicker broken for OXD inputs | `root-cause-missing-interactions.md` | Fixed |
| Content script not injected | `content-script-not-injected-root-cause.md` | Fixed |

### A12. Remaining UI Defects

| Defect | Location | Status |
|--------|----------|--------|
| Override Match UI shows "not yet implemented" | `sidepanel.ts:857` | Unfixed |
| CSS `:hover` context loss (sub-pixel timing) | `c3.3-clone-css-context-loss-root-cause.md` | Architectural limitation (unfixable without continuous DOM observation, which was deliberately rejected) |

---

## Category B: Known Limitations (Works but with caveats)

### B1. NoOp DomInspector (MV3 Constraint)

The enrichment pipeline's DomInspector is NoOp because the MV3 service worker has no DOM access. OptionSet extraction always returns null. This is an architectural constraint, not a bug — but it means option sets, validation rules, and dynamic structural queries are unavailable at enrichment time.

### B2. Golden Master Validates Consistency, Not Correctness

The 68 golden-master fixtures (L1: 35 per-type canonical, L2: 23 edge cases, L3: 10 multi-step) validate that the NEW unified path produces the SAME output as the OLD adapter path. If the OLD path was wrong, both are consistently wrong. No golden-master test runs the full production pipeline (recording → P2). Playwright code correctness against real apps is unproven.

### B3. Test Coverage Gaps

- 3,241/3,242 tests pass (1 pre-existing JSDOM timing flake)
- NO production integration test exists for recording → P2
- NO skipped tests found (no `it.skip`, `describe.skip`, `.todo`)
- Classification correctness for all 23 types unproven for production (tests use FixtureDomInspector mocks masking production defects)

### B4. P2 Known Limitations (from P2 spec §18)

| ID | Limitation |
|---|-----------|
| KL-P2-1 | UiElementSummary (8 fields) insufficient for matching; full identity always recovered from rawInteractions |
| KL-P2-2 | rawEvents fallback lacks ancestorRoles → ANCESTOR_ROLES dimension scores neutral |
| KL-P2-3 | Success criterion elementLocator is a string label matched as accessibleName |
| KL-P2-4 | No entryPoint.elementName click step generated in V1 |
| KL-P2-5 | No cross-environment resolution (current project's Element Repository only) |
| KL-P2-6 | Session element IDs are session-scoped; bridged via R4 matching at generation time |

### B5. R4 Known Limitations

| Limitation | Detail |
|-----------|--------|
| Exact match only (1.0 or 0.0) | Fuzzy matching is a possible future enhancement |
| AMBIGUOUS for indistinguishable elements | Preserved for future resolution, never guessed |
| `placeholder` excluded | Transient UI hint, frequently changes |
| `stableId` excluded | `id` attribute risks false matches with auto-generated IDs |

### B6. R3 Remaining Limitations (from R3 spec §11)

| Limitation | Future Phase |
|-----------|-------------|
| Multi-element temporal patterns (require correlating multiple interactions) | O6 (Optional) |
| Delayed framework state flushes (React concurrent features) | Empirical tuning |
| Confidence calibration tuning | Continuous |

### B7. Architecture Review Weaknesses (Pre-R1 State — Many Since Fixed)

| ID | Weakness | Status |
|----|----------|--------|
| W1 | Layered redundancy — two of everything (production + foundation) | Fixed by R1 (deleted V2 subsystem) |
| W2 | Lifecycle logic scattered across 3 incompatible layers | Partially fixed by R3 annotation deferral |
| W3 | Guard rails scattered in capture layer (deterministic-recorder.ts, 3,033 lines) | Unresolved |
| W4 | dateSelect synthetic event is a hack | Unresolved |
| W5 | Domain pipeline produces limited value (4 stages, no DOM access) | Core of current Gen 1 work |
| W6 | Framework-specific logic scattered across 5+ locations | Unresolved |
| W7 | 38 interaction types (near-duplicates) | Fixed by R1 type consolidation (now 23 types) |

---

## Category C: Intentional Design Decisions (Deliberately not doing X)

### C1. Classification Architecture

| Decision | Rationale | Source |
|----------|-----------|--------|
| Behavioral > structural for classification | Amazon proved structural-only insufficient. R3 weight calibration: behavioral +0.5-0.7 > structural +0.1-0.4 | Amazon failure analysis |
| Annotation deferral (not lifecycle deferral) | Lifecycle deferral "broke 23 test files." Annotation deferral is the pragmatic alternative | R3 spec §superseded |
| Observer captures, classifier decides | These concerns must never be merged | AP1, 04-design-decisions.md |
| Deterministic evidence always overrides AI | Structural invariant, not configurable | AP4, 04-design-decisions.md |

### C2. Architectural Boundaries

| Decision | Rationale |
|----------|-----------|
| NoOp DomInspector is correct | MV3 has no DOM access; fix should capture-at-observation, not restore DOM queries |
| Deletion of old structural classification pipeline | R1 eliminated dormant V2 subsystem (3,837 lines) that tried to classify from structure alone |
| Structural recognizer runs AFTER classification | It groups already-typed interactions, never overrides Component Runtime classification |
| No continuous MutationObserver | Performance risk; short-window re-snapshot sufficient — "never (architectural decision)" |
| No visual appearance inference | Different signal class — "never (architectural decision)" |

### C3. P1 Intentionally Does NOT

- Does not re-classify or re-interpret interactions
- Does not generate test code or execution plans (P2/P3)
- Does not execute tests (P4/P5)
- Does not add new lifecycle definitions or evidence generators
- Does not auto-approve (human review is the point)

### C4. P2 Intentionally Does NOT

- Test data generation (P3)
- Execution (P4/P5)
- Element creation/healing
- Locator re-ranking
- Recording
- Ambiguity resolution (P2 surfaces; humans or future UI resolve)
- Cross-environment resolution
- entryPoint.elementName click step (future enhancement)

### C5. Permanently Closed Items (CANONICAL_ROADMAP.md §2)

| ID | Item | Status |
|----|------|--------|
| C1 | DOM Evidence Collector | Closed — duplicate of knowledge layer |
| C4 | SemanticInteraction Contract | Superseded by ComponentInteraction |
| C5 | IR Bridge SemanticInteraction input | Now takes ComponentInteraction[] directly |

### C6. Dropped from Long-Term Roadmap

| Item | Reason |
|------|--------|
| Cross-tab recording | MV3 limitations, low demand, covers 95% |
| Visual regression testing | Different product scope |
| Parallel test execution | Depends on execution engine |
| Appium adapter | No current demand |

---

## Category D: Deferred / Future Work (Planned but not yet started)

### D1. Platform Phases NOT STARTED

| Phase | Description | Status |
|-------|-------------|--------|
| P3 | AI Test Generation (TestGenerationEngine, PromptBuilder, TestCaseFactory) | Not started |
| P4 | Enhanced Execution (RetryHandler, WaitStrategyHandler, EvidenceCaptureService) | Not started |
| P5 | Playwright Execution | Not started |
| P6 | AI Failure Analysis | Not started |
| P7-P9 | Cross-Platform | Not started |

### D2. Optional Enhancements (CANONICAL_ROADMAP.md §4)

| ID | Enhancement | Effort |
|----|------------|--------|
| O1 | Dropdown deferred blur re-read | Small |
| O2 | Stepper DOM-read running total | Small |
| O3 | EditorAdapter content extraction | Medium |
| O4 | Pattern Registry regex cache clearing | Trivial |
| O5 | Test TS error cleanup (446 errors) | Medium |
| O6 | Evidence engine temporal context | Medium |

### D3. Missing Pattern Definitions

| Pattern | Status | Note |
|---------|--------|------|
| DATE_PICKER | Not registered | R2 handles detection, no pattern for grouping |
| TABLE | Not registered | No interaction definition |
| SLIDER | Not registered | R2 handles detection, no pattern |
| COMBOBOX | Not registered | Subsumed by DROPDOWN pattern |
| CUSTOM | Not registered | Extensible framework placeholder |

### D4. Long-Term Roadmap Phases (docs/handover/13)

| Phase | Priority | Status |
|-------|----------|--------|
| Phase 9: AI-Powered Enrichment | High | Partial — providers complete, no orchestrator |
| Phase 10: Repository V2 Migration | High | Partial — Dexie implemented, runtime uses legacy |
| Phase 11: Self-Healing Locators | High | Partial — checkStaleness complete, no runtime trigger |
| Phase 12: Test Execution Engine | High | From scratch — interface exists, no implementation |
| Phase 13: Test Suite Composition | Medium | From scratch |
| Phase 14: Repository UI Enhancements | Medium | Partial |
| Phase 15: Coverage Visualization | Medium | From scratch |
| Phase 16: Natural Language Authoring | Medium | From scratch |
| Phase 17: Cypress Adapter | Low | Partial — interface designed |
| Phase 18: Complete Pattern Catalogue | Low | Partial — 6/11 patterns |

### D5. Spec-Deferred Items

| Item | Source | Target |
|------|--------|--------|
| AI-powered data requirement suggestion | P1 spec §13 | P3 |
| Capability dependency graph | P1 spec §13 | Future phase |
| Capability export/import | P1 spec §13 | Future phase |
| Multi-user review collaboration | P1 spec §13 | Future phase |
| `<select multiple>` multi-select | milestone-c5.1 | Future milestone |
| OR-5 readability rule (collapse Select) | milestone-c5.1 | Deferred |
| Tab panels/accordion/context menus | milestone-c5.1 | Future milestone |
| SemanticRelationship graph | Phase 5 spec | Lower priority |
| Wiring enrichment into live pipeline | Phase 5 spec | Not yet wired |
| Tier 3 AI recognition | Phase 3 spec | Separate phase |

### D6. Unresolved Architectural Questions (from audits)

| ID | Question | Status |
|----|----------|--------|
| G1 | businessField raw vs normalized? | Resolved: raw accessibleName for Tier 1, displayLabel separate |
| G2 | domAttributes aggregated vs individual? | Resolved: build Record from typed DomContext fields (Tier 1 C3) |
| G3 | RadioButton SELECT vs TOGGLE? | Unresolved |
| G4 | Dropdown [CLICK, SELECT] lifecycle achievable? | Unresolved |
| G5 | Single-element interactions without component recognition? | Resolved: YES, via standalone path |
| G6 | When should P2 be wired to production? | Resolved: after Tier 1 |

---

## What the Old AI Validated as Complete

### Fully Working (Production-Proven)

1. **Event capture** — 19 event types, 18-field ElementIdentity, 30+ DomContext fields, SPA deferred blur, post-click value polling, R3.4 attribute re-snapshot
2. **Component Runtime classification** — 23 lifecycle definitions, R2 slider geometry, R3 behavioral evidence, annotation deferral
3. **IR Bridge** — consumes ComponentInteraction[] directly → Playwright code generation for all standalone interactions (FILL, CLICK, SELECT, TOGGLE, HOVER, SCROLL, NAVIGATE)
4. **Side Panel** — live recording timeline, stopped view, replay JSON, IR steps, Playwright files, capability review cards
5. **P1 Review Flow** — createReview(), processDecision(), capability lifecycle (create/enrich/version/approve)
6. **P2 IR Generation** — 8-step pipeline (session recovery → binding → identity recovery → R4 matching → data validation → IR action mapping → assertion generation → IR assembly), validated with 7 e2e scenarios
7. **R4 Element Identity Matching** — 8-dimension scoring, MATCH_THRESHOLD=0.70, three-category result
8. **Golden Master** — 68 fixtures validating type equivalence and IR plan deep equality

### Working with Tier 1 Corrections (Just Implemented)

9. **Source interaction type preservation** — C1: sourceInteractionType on ObservedTransition
10. **Business field derivation** — C2: businessField from accessibleName, displayLabel separate
11. **DOM attributes flow** — C3: domAttributes Record from typed DomContext fields
12. **Standalone action wiring** — D1: buildStandaloneAction uses elements map

### What the Old AI Expected to Address Next

Based on the frozen roadmap, sequencing QA, and audit findings:

1. **D7 gate fix** — Filter Click from producing CapabilityInputs (flagged but not yet fixed)
2. **Execution recipe** — P2CapabilityContract needs execution steps, not just data requirements (structural gap identified)
3. **P2 production wiring** — `generateCapabilityIR()` has zero production callers
4. **Capability naming** — deriveCapabilityName uses first businessField instead of trigger action
5. **Gen 1 semantic path restoration** — the 7 broken connections (Fixes 1-7 from root cause analysis)
6. **Missing patterns** — Slider, DatePicker, FileUpload, DragDrop, Autocomplete
