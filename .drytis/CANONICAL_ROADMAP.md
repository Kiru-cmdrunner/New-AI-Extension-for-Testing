# Canonical Roadmap — Final Revision

> **Status:** Authoritative as of 2026-08-01. Supersedes all prior roadmaps.
>
> **Purpose:** Single source of truth for all future work. Built from the complete architectural understanding accumulated through Phase 1-Tier 2 implementation, conformance review, gap classification, behavioral pipeline audit, and first-principles architectural analysis.

---

## §0. The Vision

> **Build a general-purpose semantic recorder that understands user capabilities and intent across diverse web applications, regardless of how those applications implement their interactions, and reliably produces the correct high-level interaction in the side panel.**

This vision drove the redesign after the Amazon filter issue. Every roadmap item must be evaluated against this goal.

### What "Understanding" Means, Architecturally

The recorder must classify interactions based on **what the user did and what happened** (behavioral signals), not just **what the element looks like** (structural attributes). A checkbox implemented as a `div` with CSS toggling must be understood as a toggle, even without `<input type="checkbox">` or `role="checkbox"`.

This requires the classification layer to reason about **observable effects**: value changes, state transitions, structural mutations. The recorder must answer "did this interaction change a value?" and "did a panel appear?" — not just "does this element have the right tag?"

---

## §1. Architectural Foundation (Complete)

Everything in this section is built, tested, and verified. These are the frozen contracts that future phases build on.

### 1.1 Classification Pipeline

```
EventTap → IdentityExtractor → ComponentRuntime → Evidence Annotation →
  Domain Adapter V2 → Recognition → Enrichment → Interaction Enrichment Pass →
  IR Bridge → Playwright Generation
```

| Component | Role | Status |
|-----------|------|--------|
| **EventTap** | Content-script capture: 17 event types, valueBefore/valueAfter tracking, deferred value poll for async frameworks | ✅ Active |
| **IdentityExtractor** | 7-strategy value cascade, 5-strategy checked-state cascade, implicit ARIA role computation | ✅ Active |
| **ComponentRuntime** | 23 lifecycle definitions, priority-sorted, state machine per definition, pure pass-through of full ObservedEvent | ✅ Active |
| **Evidence Engine** | 6 generators, weighted fusion, intent classification — **active for Click interactions only** | ⚠️ Partial (see §3.1) |
| **Domain Adapter V2** | ComponentInteraction → domain entities (elements, transitions) | ✅ Active |
| **Enrichment** | Session-level knowledge extraction: component summaries, option sets, validation rules | ✅ Active |
| **Interaction Enrichment Pass** | Post-classification locator resolution + assertion backfill | ✅ Active |
| **IR Bridge** | Pure transform: ComponentInteraction + SessionEvent + Fragment → ExecutionIRPlan | ✅ Active |
| **Assertion Engine** | State-based assertions (value, checked, selected, URL) + 3 structural providers | ✅ Active |
| **Playwright Generation** | Test files, page objects, assertion rendering | ✅ Active |

### 1.2 Component Coverage

23 definitions detecting 8 categories of interaction: form input (TextEntry, Dropdown, Checkbox, RadioButton, DatePicker, Slider, Stepper, TagInput, OtpInput), click (Click, Link, DoubleClick, RightClick via subtypes), advanced (Hover, DragDrop, KeyboardShortcut, HotkeySequence), specialized (FileUpload, ModalDialog, Scroll, Navigation), navigation (NewTab, NewWindow, Breadcrumb), and infrastructure (Iframe).

### 1.3 Framework Coverage

7 Pattern Registry plugins: MUI, Ant Design, Bootstrap, PrimeReact, AGGrid, Radix (via ARIA roles), AdaniOne. Word-boundary regex matching, regex caching, dead code removed.

### 1.4 Platform Infrastructure

Session persistence (Dexie v3), IR executor (Chrome extension), deterministic element healing, iframe support (all_frames, frameLocator codegen), rich text editor identification (6 adapters), slider dual-handle range detection, autocomplete dropdown tracking.

### 1.5 Quality Assurance

3059 passing tests (2 flaky JSDOM timing), golden master (63 fixtures × 131 tests), validation harness (247 tests × 22 capabilities × 8 quality dimensions), expanded validation (4 areas × 53 observations), E2E pipeline verification (17 tests). 0 TypeScript errors in `src/`.

### 1.6 Frozen Contracts

These interfaces are stable and must not change without a formal architecture decision:

| Contract | Frozen Since |
|----------|-------------|
| `ComponentInteraction` type + `InteractionType` (23 values) | Phase 3 type unification |
| `interactionSubtype?: string` variant mechanism | Phase 3 (architectural decision — see §2) |
| `BridgeInteractionType` (46 internal bridge values) | Phase 3 IR Bridge |
| `IRBridgeInput` interface | Phase 3 |
| `toBridgeInteraction()` normalization | Phase 3 |
| `annotateWithEvidence()` contract | Phase 2 Thrust 1 |
| `EnrichmentOutput` (locator + assertion maps) | Tier 2A |
| `AssertionProvider` interface | Tier 2A |
| `FrameworkPatterns` interface (cleaned) | Tier 2 |
| `EvidenceGenerator` interface | Phase 2 Thrust 1 |
| `fuseEvidence()` signature | Phase 2 Thrust 1 |
| `FeatureViewInput` interface | Phase 2 Thrust 1 (to be extended in R3) |
| Golden master corpus (63 fixtures) | Phase 3 |

---

## §2. Permanently Closed Items

These appeared in earlier design documents but were superseded by architectural evolution. They are **permanently closed**.

| # | Original Item | Why Closed | Satisfied By |
|---|--------------|------------|-------------|
| C1 | **DOM Evidence Collector** (Phase 2 Thrust 4) — capture-time `DOMEvidence` interface | The knowledge layer (`enrichSession`) already derives `optionSet`, `validationRules`, `componentSummaries` at session level. Tier 2A adds structural assertions post-classification. A capture-time collector would duplicate this. | Knowledge fragment + Tier 2A |
| C2 | **Remove `interactionSubtype?: string`** (Phase 3 Step 6a) | Actively used by 30 source files. The architecture deliberately chose this as the variant bridge between compact public type (23 values) and rich internal bridge type (46 values). | It IS the canonical variant mechanism |
| C3 | **Remove phantom BridgeInteractionType values** (Phase 3 Step 6b) | Internal type, never exported. Preserves exhaustiveness for `Record<BridgeInteractionType, IRAction>`. Golden master exercises these paths. | Internal bridge vocabulary |
| C4 | **SemanticInteraction Contract** (Original Roadmap Phase 0) — 22-field type replacing DetectedInteraction | Phase 1-3 achieved this via `ComponentInteraction` unification. DetectedInteraction eliminated. No separate type needed. | ComponentInteraction is the unified type |
| C5 | **IR Bridge SemanticInteraction input** (Original Roadmap Phase 0) | IR Bridge accepts `ComponentInteraction[]` as sole interaction input via `IRBridgeInput`. Adapter layer eliminated. | `IRBridgeInput.interactions: ComponentInteraction[]` |

---

## §3. Required Architectural Work

These items are **mandatory** before the platform phases. They complete the architectural vision.

### Phase R1: Foundation Cleanup

**Architectural objective:** Eliminate all dead code and dormant subsystems so the codebase has a single, clear execution path.

**Why it exists:** Phase 1-3 left behind dormant infrastructure (v2 recorder behind a never-set feature flag, legacy domain adapter for healing, vestigial UI state flag). These create confusion about what's active and add maintenance burden.

**Dependencies:** None.

| Item | Description |
|------|-------------|
| R1.1 | **Resolve dormant v2 recorder** — 2,070 lines in `src/recorder/v2/` (control-recorder.ts, control-model.ts, element-identity-builder.ts) are injected by the manifest but never activate (`recorderEngine` defaults to `'legacy'`). This subsystem has a MutationObserver and dblclick registration that the active pipeline lacks. **Decision required:** activate it, merge its capabilities into the active pipeline, or remove it. The recommended path is to salvage the MutationObserver pattern and dblclick registration into the active EventTap pipeline, then remove the dormant subsystem. |
| R1.2 | **Remove `engine` parameter from `runPipeline`** — always called with `'control'`. Delete the legacy branch. |
| R1.3 | **Migrate healing service to V2 adapter** — `service-worker.ts:466` is the sole consumer of legacy `adaptToDomainEntities`. Switch to `adaptToDomainEntitiesV2`. |
| R1.4 | **Delete legacy `domain-adapter.ts`** after R1.3. |
| R1.5 | **Remove `recorderEngine` from UI state** — vestigial feature flag, always `'legacy'`, never read for branching after R1.1 resolves the v2 recorder. |
| R1.6 | **Register `dblclick` in EventTap** — `'dblclick'` is in the `BrowserEventType` union and Click's `triggerEventTypes`, but EventTap never registers it as a listener. Double-clicks are invisible. One-line fix. |

**Capabilities delivered:** Single capture path, single domain adapter, zero dormant code.

**Completion criteria:**
- One content script in manifest (not two)
- `runPipeline` has no `engine` parameter
- Zero references to `adaptToDomainEntities` (legacy)
- `dblclick` events captured and tested
- Full test suite green, golden master unchanged, E2E pipeline tests pass

**Why before R2:** R2 adds behavioral capture capability. The capture layer must be clean and singular before adding new capture mechanisms.

---

### Phase R2: Slider Detection Expansion

**Architectural objective:** Detect and extract values from custom div-based sliders that lack ARIA attributes.

**Why it exists:** `isSlider()` currently matches only `<input type="range">` and `ariaRole === 'slider'`. Custom sliders without these signals produce Click interactions or nothing. This is the last identified capability gap from the expanded validation.

**Dependencies:** None (can run parallel with R1).

| Item | Description |
|------|-------------|
| R2.1 | Expand `isSlider()` to match CSS class patterns for common custom slider handles (jQuery UI `ui-slider-handle`, no-framework `slider-handle`, etc.) |
| R2.2 | Add geometry-based value extraction: `percent = (handle.offsetLeft - track.offsetLeft) / track.offsetWidth` using `getBoundingClientRect` |

**Scope note:** Modern libraries (MUI, AntD) set `role="slider"` + `aria-valuenow`. Target population is bespoke/hand-built sliders — shrinking but non-zero.

**Completion criteria:**
- Custom slider fixtures in golden master corpus
- Validation harness tests for custom slider detection + value extraction
- Full test suite green

---

### Phase R3: Behavioral Semantic Reasoning (The Critical Phase)

**Architectural objective:** Complete the evidence engine so it can classify any interaction based on observable behavioral effects, not just structural attributes. This is the phase that **completes the vision**.

**Why it exists:** The evidence engine — the designated semantic reasoning layer — currently classifies only Click interactions, using only structural signals (ARIA roles, tags, CSS classes). It cannot answer "did this interaction change a value?" or "did a panel appear?" because the behavioral data captured by the recorder is not propagated to it.

This means: when a lifecycle definition misses a novel implementation (no matching tag/role/class pattern), the evidence engine cannot recover. The interaction degrades to a generic Click. The system fails the "regardless of implementation" requirement.

**The gap is primarily data propagation, not data capture.** The recorder captures 40+ behavioral fields. The evidence engine sees 15. The missing 25+ include: `valueBefore`, `valueAfter`, `ariaExpanded`, `ariaValueNow`, `ancestorClasses`, `inputType`, `ariaHasPopup`, and validation constraints.

**Dependencies:** R1 (clean capture layer) must be complete. Specifically, R1.1 (resolve dormant v2 recorder) determines whether the MutationObserver capability is already available or needs to be built.

| Item | Description | Type |
|------|-------------|------|
| R3.1 | **Expand `FeatureViewInput`** to expose behavioral signals already captured: `valueBefore`, `valueAfter`, `ariaExpanded`, `ariaValueNow`, `ariaValueMin`, `ariaValueMax`, `ancestorClasses`, `inputType`, `ariaHasPopup`, `isContentEditable`. ~10 new fields on the interface. Change is in `buildFeatureView()` only — the single function that maps `ObservedEvent` → `FeatureViewInput`. | Data propagation |
| R3.2 | **Implement `select` and `input` intent derivation paths** in `type-deriver.ts`. Currently these cases return `Click` with a "not yet implemented" comment. Map `select` intent → Dropdown/Slider/Tab types based on behavioral signals. Map `input` intent → TextEntry based on value transitions. | Logic completion |
| R3.3 | **Add behavioral evidence generators** that vote on observable effects: a value-change generator (did the interaction change a value? → `input`/`select`), a state-toggle generator (did attributes/classes change in a toggle pattern? → `toggle`), a panel-emergence generator (did `ariaExpanded` transition or a surface appear? → `select` for dropdown/tab). These follow the existing `EvidenceGenerator` interface — adding them to the registry changes nothing else. | Extension |
| R3.4 | **Add attribute transition capture** — the one genuine capture gap. The recorder captures attribute *snapshots* (current state at event time) but not *transitions* (before→after diff). A post-click attribute poll (following the existing `schedulePostClickValueCheck` template) or a lightweight MutationObserver (following the ControlModel pattern from the dormant v2 recorder) would capture class/attribute changes. This covers the narrow case where the only behavioral signal is a CSS class change (div-checkbox scenario). | New capture |
| R3.5 | **Add confidence threshold for unrecognized interactions** — when no lifecycle definition triggers AND evidence confidence is below threshold, flag the interaction as unrecognized rather than silently degrading to Click. This surfaces unknowns instead of hiding them. | Behavioral |

**Capabilities delivered:**
- The evidence engine can classify interactions based on what happened, not just what the element looks like
- Novel implementations that lifecycle definitions miss can still be correctly classified
- Unrecognized interactions are surfaced rather than silently degraded
- The "regardless of implementation" vision is architecturally complete

**Completion criteria:**
- Evidence engine classifies at least 4 of 6 SemanticIntents (currently only 3: toggle, navigate, trigger; `explore` has a path but no generators)
- The div-checkbox scenario (custom checkbox with no ARIA) produces a Toggle/Checkbox classification via behavioral evidence
- Novel dropdown implementations (panel appears on click without ARIA) produce a Select classification via behavioral evidence
- Golden master corpus includes behavioral-only fixtures (interactions with no standard ARIA/tags)
- Full test suite green

**Why this is evolution, not redesign:**
- `EvidenceGenerator` interface: unchanged
- `fuseEvidence()` signature: unchanged
- `FeatureViewInput` interface: extended (more fields), shape unchanged
- `deriveType()` switch: two cases implemented (were already stubbed)
- Component Runtime: unchanged
- IR Bridge: unchanged
- No new types, no new architectural layers, no contract breaks

**Architectural risk:** The behavioral generators must be calibrated to avoid over-classification. A button that happens to change a CSS class on click shouldn't be classified as a toggle unless the class change represents a semantic state (e.g., `active`, `selected`, `checked`). The weight calibration model (standards 0.7-0.9, behavioral 0.5-0.7, structural 0.1-0.25) provides the framework, but the boundary between "decorative class change" and "semantic state change" requires empirical validation.

---

## §4. Optional Enhancements

These improve robustness but are not architecturally required. Can be picked up opportunistically.

| # | Item | Effort | Impact |
|---|------|--------|--------|
| O1 | Dropdown deferred blur re-read (`pending` flag for SPA-on-blur value modification) | Small | Edge case: SPA modifies search input on blur |
| O2 | Stepper DOM-read running total (post-click counter display polling) | Small | Edge case: non-unit steppers (+5 buttons) |
| O3 | EditorAdapter content extraction (`extractText`/`extractHtml`/`htmlValue`) | Medium | Improves TinyMCE; enables HTML assertions |
| O4 | Pattern Registry regex cache clearing on `registerPlugin` | Trivial | Prevents orphaned cache entries |
| O5 | Test TS error cleanup (446 errors: string literals vs enums, stale properties) | Medium | Strict type checking for test code |
| O6 | Evidence engine temporal context (multi-interaction window for sequence patterns) | Medium | Improves confidence for autocomplete/stepper; not required for single-interaction behavioral classification |

---

## §5. Platform Phases

These extend the recorder into a full test automation platform. All depend on R1-R3 being complete.

### Dependency Graph

```
[R1-R3: Foundation + Semantic Reasoning Complete]
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    P1: Capability  P4: Enhanced  (parallel tracks)
    Lifecycle       Execution
        │               │
        ▼               ▼
    P2: Capability   P5: Playwright
    IR Generation    Execution
        │               │
        ▼               ▼
    P3: AI Test      P6: AI Failure
    Generation       Analysis
        │               │
        └───────┬───────┘
                ▼
        P7-P9: Cross-Platform Expansion
```

### P1: Capability Lifecycle Management

**Architectural objective:** Transform inferred capability candidates into managed, versioned, approved capabilities with explicit data requirements and success criteria.

**What exists:** `CapabilityCandidate` entities derived from recordings. `CapabilityMatcher` for overlap detection. `ApplicationKnowledgeFragment` with option sets, validation rules, component summaries.

**What's missing:** `CapabilityReviewService` (candidate → approved lifecycle), `CapabilityVersioningService` (immutable versions), `DataRequirement` type (formal test data specs), `SuccessCriterion` type (explicit pass/fail criteria), capability UI in side panel.

**Why this phase:** Creates the managed substrate that AI generation (P3) and data-driven execution (P2) depend on. Without approved capabilities, there's nothing to generate tests from.

**Dependencies:** R1-R3 complete (classification must be reliable before managing capabilities).

**Completion criteria:** Candidate → review → approve → version lifecycle functional. ≥70% field overlap matching. UI for capability review in side panel.

### P2: Capability-Derived IR Generation

**Architectural objective:** Generate ExecutionIRPlan from approved capabilities (not from recordings). Enables re-execution and data-driven testing.

**What's missing:** `CapabilityIRGenerator`, `DataResolver` (DataRequirement → concrete values), `AssertionResolver` (SuccessCriterion → IRAssertion with locators).

**Dependencies:** P1 (needs approved capabilities).

### P3: AI Test Generation Engine

**Architectural objective:** Automatically generate comprehensive test suites from recorded capabilities using LLMs.

**What's missing:** `TestGenerationEngine`, `PromptBuilder`, `TestCaseFactory`, test variant taxonomy (positive/negative/boundary/validation/accessibility/security). Uses `create_openai_api_key` infrastructure.

**Dependencies:** P2 (generated tests must be executable).

### P4: Enhanced Execution Engine

**Architectural objective:** Make execution reliable for CI/CD with retry, wait strategies, and failure evidence.

**What's missing:** `RetryHandler`, `WaitStrategyHandler` (visible/present/stable), `EvidenceCaptureService` (screenshots, DOM snapshots, console logs), `SuiteExecutor`.

**Dependencies:** None (parallel with P1-P3).

### P5: Playwright Execution Engine

**Architectural objective:** Headless, cross-browser execution via Playwright API.

**What's missing:** `PlaywrightExecutor`, `PlaywrightLocatorResolver`, `ExecutionEngineRegistry`.

**Dependencies:** P4 (needs retry, wait strategies, evidence capture).

### P6: AI Failure Analysis & Self-Healing

**Architectural objective:** LLM-powered root-cause diagnosis and locator suggestions when deterministic healing fails.

**What's missing:** `FailureAnalysisEngine`, `RootCauseReport`, `AIHealingService`, `HealingFeedbackLoop`.

**Dependencies:** P5 (needs execution results from both engines).

### P7-P9: Cross-Platform Expansion

**P7 (Cross-Platform Foundation):** `CaptureAdapter` interface, mobile/API locator types, `IREnvironment.platform`. **P8 (Mobile/API):** Appium executor, API capture, mobile identity extraction. **P9 (Continuous Learning):** Coverage analysis, workflow mining, regression detection.

**Dependencies:** All prior phases (P1-P6 complete).

---

## §6. Recommended Sequence

### Immediate — Complete the Vision (R1 → R2 → R3)

1. **R1 (Foundation Cleanup)** — resolve dormant v2 recorder, remove dead code, fix dblclick
2. **R2 (Slider Detection)** — parallel with R1, no dependencies
3. **R3 (Behavioral Semantic Reasoning)** — the critical phase that completes the vision

**After R3:** The recorder is a general-purpose semantic recorder that understands capabilities and intent regardless of implementation. The original vision is achieved.

### Near-Term — Platform Value (P1 + P4 parallel)

4. **P1 (Capability Lifecycle)** — test management
5. **P4 (Enhanced Execution)** — CI/CD reliability

### Medium-Term — AI + Full Platform (P2 → P3, P5 → P6)

6. **P2 → P3** — capability-derived IR → AI test generation
7. **P5 → P6** — Playwright execution → AI failure analysis

### Long-Term — Expansion (P7 → P8 → P9)

8. Cross-platform, mobile/API, continuous learning

---

## §7. Stopping Points

| If we stop after... | What we have |
|---------------------|-------------|
| **R1 + R2** | A clean, robust web recorder with comprehensive component detection. No dormant code. Custom slider support. |
| **R3** ⭐ | **The vision is complete.** A general-purpose semantic recorder that classifies interactions based on behavioral evidence, not just structural patterns. Novel implementations are handled through behavioral reasoning rather than matching against known patterns. Unrecognized interactions are surfaced rather than silently degraded. |
| **P1 + P4** | A test management platform with capability lifecycle and CI/CD-ready execution. |
| **P3** | AI-powered test generation from recorded capabilities. |
| **P6** | Complete AI QA platform for web: record → understand → generate → execute → analyze → heal. |
| **P9** | Full AI QA automation across web, mobile, and API. |

---

## §8. Architectural Risks and Assumptions

### Risks That R3 Depends On

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Behavioral generator over-classification** — CSS class changes that are decorative (hover effects, animations) could be misread as semantic state changes | Incorrect classifications (button flagged as toggle) | Weight calibration: behavioral signals start at 0.3-0.5 (below ARIA's 0.7-0.9). Empirical validation against golden master + real-world fixtures before raising weights. |
| **Attribute transition capture performance** — a MutationObserver or post-click poll on every interaction adds overhead | Recording latency on complex pages | Scope observation to the interaction target's subtree, not the full document. Use the existing deferred poll pattern (50/150/400ms) which is already performance-tested. |
| **FeatureViewInput growth** — expanding from 15 to ~25 fields increases generator complexity | Generators harder to reason about | Generators are independent — each reads only the fields it cares about. The interface growth doesn't affect existing generators. |

### Assumptions

| Assumption | Verification |
|------------|-------------|
| The recorder captures sufficient behavioral data for semantic classification | **Verified** in behavioral pipeline audit: 40+ fields captured, only 15 propagated. The data exists. |
| The evidence engine's architecture (generators + fusion + derivation) is the right model | **Verified** by design review: generators are independent, fusion is replaceable, derivation is extensible. The model handles arbitrary signal sources. |
| No new architectural layer is needed for behavioral reasoning | **Verified** by first-principles analysis: the evidence engine IS the semantic reasoning layer. It needs more data, not a new structure. |
| Single-interaction behavioral signals are sufficient for classification | **Assessed** as true for the majority of cases. Temporal context (O6) improves confidence but is not a prerequisite. Multi-step patterns (autocomplete) are already handled by lifecycle definitions. |

---

## §9. Vision Verification

**Does this roadmap achieve the original vision?**

**After R3: YES.** The recorder will be able to:

1. **Understand what capability the user is interacting with** — lifecycle definitions handle known patterns; the evidence engine handles novel patterns via behavioral signals (value changes, state transitions, structural mutations).

2. **Correctly infer the user's intent** — the SemanticIntent taxonomy (6 intents) maps any interaction to its fundamental purpose. All 6 intents will have derivation paths after R3.

3. **Capture all information required to faithfully represent the interaction** — the recorder already captures 40+ behavioral fields. R3 propagates them to the reasoning layer. R3.4 adds the one missing capture capability (attribute transitions).

4. **Produce the correct high-level interaction in the side panel** — the classification pipeline (lifecycle definitions + evidence engine + IR Bridge) produces the correct InteractionType, which the timeline renderer displays. Novel implementations that definitions miss will be caught by behavioral evidence.

5. **Support new frameworks and patterns through extension, not redesign** — the extension model (new definition file + registration; new generator + array push; new assertion provider + registration) has been proven across Phase 2, Tier 1, Tier 2A, and Tier 2. R3 uses the same extension points.

**Before R3: NO.** The evidence engine classifies only Click interactions using only structural signals. Novel implementations that lifecycle definitions miss degrade to generic Click. The "regardless of implementation" requirement is not met.

**R3 is the phase that closes the gap between "robust pattern-based recorder" and "general-purpose semantic recorder."**

---

## §10. Design Principle

> **The observation is immutable. The capability is versioned. The IR is disposable. The implementation is replaceable.**

Every future phase must respect this separation. No phase pollutes the observation with consumer concerns. No phase makes the IR non-disposable. No phase couples the capability model to a specific engine. Every phase is additive.

---

*End of Canonical Roadmap. This document is the single source of truth for all future work.*
