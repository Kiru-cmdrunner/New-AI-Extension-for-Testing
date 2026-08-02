# Whole-System Consolidation & Implementation Roadmap

> **Status:** Research-complete. All findings validated against design docs, specs, git history (Phase 0–R4, P1, P2), and production code. No implementation has started.
>
> **Date:** 2026-08-02
> **Frozen baselines:** R1 (5e9d75f), R2 (5a6f5d5), R3 (1b2fa89), R4 (b4d558a), P1 (cc44c74), P2 (57128cb)

---

## Part 1: Architecture & Design Decisions

### 1.1 The Project's Vision

**Not a test recorder — a semantic understanding engine.** It watches a human use a web app, understands business intent at the capability level, captures durable reusable knowledge, and generates executable test plans with arbitrary data that survive UI redesigns.

Core principle: **"The observation is immutable. The capability is versioned. The IR is disposable. The implementation is replaceable."**

### 1.2 Two Generations of Intelligence

The system has built two parallel paths for understanding interactions:

**Generation 1 (working):** DOM events → Component Runtime (23 lifecycle definitions + R3 behavioral evidence with 10 generators) → ComponentInteraction[] → IR Bridge → Playwright code. This is a smart recorder. Production-wired, tested, functional.

**Generation 2 (designed, disconnected):** ComponentInteraction[] → Domain Adapter → Recognition → Enrichment → Capability → P2 IR Plan. This is the transformative path — durable capability knowledge. The logic is correct but the domain adapter and enrichment pipeline don't read data that already exists.

The gap is not missing architecture — it's incomplete connections between Phase 2's evolved classification intelligence and the knowledge/capability pipeline.

### 1.3 The Three Identity Layers (Established)

| Layer | Owner | Purpose | Scope | Populated From |
|---|---|---|---|---|
| **R4 Element Identity** | `ElementIdentityRecord` on `Element` (repository) | Cross-session element reconciliation — "is this the same control?" | 8-dimension weighted scoring at 0.70 threshold | 18-field `ElementIdentity` captured at observation time |
| **businessField** | `LogicalAction.businessField` in fragment | Intra-session data-field binding — connect `DataRequirement` to session `elementId` | Exact string match within one pipeline run | `accessibleName` (Tier 1 restoration) |
| **Human-readable label** | `DataRequirement.label` | Display in UI, test reports, error messages | Read-only human semantics | Real `accessibleName` (preserved independently as `displayLabel`) |

**Key finding:** businessField does NOT duplicate R4's job. businessField connects a DataRequirement to a session element within one pipeline run. R4 takes over after that with full 18-field identity for cross-session matching. The two are sequential, not competing.

### 1.4 businessField Contract (Established Decision)

**Decision:** `businessField = accessibleName` for Tier 1.

**Evidence:**
- Original Phase 5 `deriveBusinessField` (commit 55fea59) was designed to return accessibleName/ariaLabel — human-readable strings from DOM inspection
- `CapabilityInput.label` (Phase 9.5.1) documented as "Human-readable field label (from LogicalAction.businessField)"
- `UiElementSummary` (fragment type used by binding resolver) carries `accessibleName` but NOT `identity.name`
- Binding resolver fallback paths (lines 111, 133) expect `accessibleName === businessField`
- R4 already scores `name` (FORM_NAME 15%) and `testId` (BUSINESS_IDS 25%) for cross-session matching — no need to duplicate in businessField

**Deferred:** P1's aspirational `field = "maxPrice"` (machine-readable camelCase) vs `label = "Maximum Price"` (human-readable) distinction. Requires a `fieldKey` derivation layer that doesn't exist. The `displayLabel` field on LogicalAction/CapabilityInput is forward-compatible — when fieldKey is added later, `businessField` can carry the key while `displayLabel` preserves the real label without type changes.

**Why `displayLabel` matters now:** `humanizeLabel("maxPrice")` = `"Max Price"` ≠ real accessibleName `"Maximum Price"`. Preserving `displayLabel = accessibleName` independently ensures the real UI label is never lost to reconstruction.

---

## Part 2: Complete Finding Catalog

### Confirmed Defects (Category A — implementation not matching design)

#### A1 / C3 — domAttributes Always Empty

**Root cause:** Domain adapter (domain-adapter-v2.ts:393-394) reads `firstEvent.domContext?.domAttributes` — a `Record<string, string>` that was NEVER populated. Phase 6-7 (commit 373693c) added `domAttributes` to `RecordedEvent.DomContext` and wrote the intended capture logic in `captureAttributesForTest` (test file), but `dom-context-extractor.ts` was never updated to populate it. Instead, it populates typed fields (`required: boolean`, `pattern: string | null`, `minLength: number | null`, etc.) on `component-types.ts DomContext`.

**Data flow:** `dom-context-extractor.ts` captures typed fields → event-tap attaches to ObservedEvent → service worker casts `oe.domContext as DomContext` (unsafe but typed fields survive at runtime) → adapter reads non-existent `domAttributes` Record → always `{}` → `InteractionContractDeriver` reads empty Record → ALL constraints null.

**Effect:** All `InteractionContract.constraints` (required, inputType, format, valueRange, lengthRange, validOptions) are null. No validation constraints reach `DataRequirement`. P3 test generation cannot produce boundary/validation tests.

**Fix:** Project typed DomContext fields into `domAttributes` Record at adapter boundary. The adapter already uses unsafe casts; extend to read typed fields (`dc.required`, `dc.pattern`, `dc.inputType`, `dc.minLength`, `dc.maxLength`, `dc.min`, `dc.max`, `dc.step`).

**Tier:** 1

---

#### A2 / C5 — componentId Never Assigned

**Root cause:** `assignTransitionToComponent()` (observed-transition.ts:223-231) exists as a pure function but is dead code. `runRecognition()` (pipeline-runner.ts:80-124) calls `processInteraction()` on each transition, which registers components in the ComponentRegistry, but NEVER assigns `componentId` back to the transitions. All transitions enter the semantic aggregator with `componentId=null` → all go to standalone.

**Git history:** Existed from original Phase 6 wiring (commit 373693c). Never worked — dead code from the start, not a regression.

**Effect:** ALL transitions are standalone. No component-based LogicalActions are produced. Multi-element components (dropdowns, radiogroups, modals) cannot be recognized through the component path.

**Fix:** After `runRecognition()`, iterate components, assign `componentId` via existing `assignTransitionToComponent()`.

**Tier:** 2 (depends on C7 for confirmation logic)

---

#### A3 / C2 — businessField Always Null

**Root cause:** `deriveBusinessField()` (option-set-extractor.ts:116-161) has a 4-step cascade: query NoOpDomInspector (returns null), read `domAttributes['aria-label']` (empty Record), read `domAttributes['aria-labelledby']` (empty), query NoOpDomInspector for container (null). All fail. `UiElement.identity.accessibleName` IS populated but never read.

**Effect:** ALL LogicalActions have `businessField=null`. `deriveInputs` (capability-deriver.ts:202) gates on `businessField !== null` → skips everything → zero CapabilityInputs. No data-input fields reach capability.

**Fix:** `resolveBusinessField` reads `identity.accessibleName` directly from UiElement. Add `displayLabel` to preserve accessibleName independently.

**Tier:** 1

---

#### A4 / C4 — ancestorRoles Truncated

**Root cause:** `pipeline-runner.ts:109` constructs `OrchestratorInput` with `ancestorRoles: [roleInfo]` — only the target element, not the full ancestor chain. `UiElement.ancestorRoles` has the full chain (up to 10 levels) captured at observation time, but pipeline-runner ignores it.

**Effect:** Structural recognition fails to match ancestor-based patterns (e.g., radiogroup `<fieldset role="radiogroup">` containing radio buttons). Behavioral recognition's `relatedElementIds` is also empty, compounding the issue.

**Fix:** Pass `element.ancestorRoles ?? [roleInfo]` in pipeline-runner.ts.

**Tier:** 2

---

#### A5 — Checkbox Behavioral Recognizer Lifecycle Mismatch

**Root cause:** Checkbox behavioral recognizer (`behavioral-recognizer.ts`) expects `expectedOperation='click'` but adapter maps Checkbox → `TransitionOperation.TOGGLE`. CHECKBOX pattern's `expectedLifecycle: [TOGGLE]` works for lifecycle set-containment but the behavioral signature may expect CLICK semantics.

**Effect:** Checkbox CAN confirm via lifecycle (TOGGLE ⊆ {TOGGLE}), but behavioral recognition may fire incorrectly or not at all.

**Status:** Low priority — Checkbox works through the standalone path in Tier 1, and lifecycle confirmation works for the component path in Tier 2.

**Tier:** 2 (investigate during C7 lifecycle reconciliation)

---

#### A6 — RadioButton Maps to TOGGLE but RADIO_GROUP Expects SELECT

**Root cause:** `INTERACTION_TO_OPERATION['RadioButton'] = TOGGLE` (domain-adapter-v2.ts:54). RADIO_GROUP pattern `expectedLifecycle: [SELECT]`. `{TOGGLE} ⊄ {SELECT}` → never confirms.

**Effect:** RadioGroup components never reach CONFIRMED state through the component path.

**Fix:** Either change RadioButton mapping to SELECT, or change RADIO_GROUP expectedLifecycle to TOGGLE. Design decision.

**Tier:** 2 (part of C7 lifecycle reconciliation)

---

#### A7 — Dropdown Lifecycle [CLICK, SELECT] Unachievable

**Root cause:** DROPDOWN pattern `expectedLifecycle: [CLICK, SELECT]`. Adapter creates ONE transition per ComponentInteraction (SELECT for Dropdown). `{SELECT} ⊄ {CLICK, SELECT}` → never confirms.

**Effect:** Dropdown components never reach CONFIRMED state through the component path.

**Fix:** C7 — evolve lifecycle/CONFIRMED to account for ComponentInteraction-level completeness (the Component Runtime's `shouldComplete()` already validated the interaction as semantically complete).

**Tier:** 2

---

#### A8 / C5-supplement — relatedElementIds Always Empty

**Root cause:** `pipeline-runner.ts:110` passes `relatedElementIds: []` always. MV3 service worker has no DOM access to compute descendant relationships. Behavioral recognizer (behavioral-recognizer.ts:442-447) filters transitions by `relatedElementIds` set → always returns empty → never fires.

**Effect:** Behavioral recognition (Tier 2 of the recognition architecture) never fires in production. Structural recognition still works (reads `ancestorRoles` from element info).

**Decision:** Defer (D3). R3 behavioral reclassification handles custom controls through the standalone path. Structural recognition handles ARIA-compliant multi-element controls through `ancestorRoles`. Behavioral recognition for ARIA-absent multi-element controls is a genuine gap but not blocking.

**Tier:** 3

---

### Intentional Design Boundaries (Category D)

#### D1 — Standalone Enrichment Gap

**Finding:** `buildStandaloneAction()` hardcodes `businessField=null` and `sourceInteractionType=null`.

**Classification:** NOT a design defect. Phase 5 spec line 200 explicitly defines standalone transitions as valid: "Transitions with componentId === null are standalone — each forms its own action." The hardcoding is an implementation gap, not a design choice. The fix (Tier 1) restores the designed standalone enrichment path.

#### D2 — PatternDefinitions Are Complementary, Not Prerequisite

**Finding:** Missing SLIDER, DATE_PICKER, FILE_UPLOAD PatternDefinitions.

**Classification:** NOT a defect. PatternDefinitions are for multi-element semantic patterns (structural grouping + lifecycle). Single-element interactions (Slider, DatePicker, FileUpload, TextEntry, Checkbox) are handled by ComponentDefinitions + Component Runtime classification + standalone enrichment. They reach capability through the standalone path WITHOUT PatternDefinitions.

#### D3 — relatedElementIds Computation Requires DOM Access

**Classification:** Intentional deferral. MV3 service worker architecture prevents DOM access. Content-script bridge or capture-at-interaction-time would be needed. R3's behavioral reclassification handles most cases through annotation deferral at classification time.

#### D4 — P2 Not Production-Wired

**Classification:** Intentional roadmap sequencing. P2's `generateCapabilityIR()` has zero production callers. P2 depends on P1 producing valid `P2CapabilityContract` (with real DataRequirements), which depends on Tier 1 fixes. P2 design is complete and validated (7-scenario end-to-end walkthrough, 48 gate tests). Wiring happens after Tier 1+2 make the capability pipeline functional.

#### D5 — `enrichConfigurationSession` Not Connected to Capability Pipeline

**Finding:** `enrichConfigurationSession` (structural-enrichment.ts) runs in the SW on flush, produces `ConfigurationSession` metadata with `ConfigurationField.label` (e.g., "Adults" from stepper labels). But it feeds only the IR Bridge (ir-bridge.ts:282) and side panel renderer — NOT the capability pipeline.

**Classification:** Intentional but incomplete. The P1 spec claimed "enrichConfigurationSession produces businessField names used in capability derivation" (line 56, 423). This was aspirational — never wired. For dropdown/stepper multi-field interactions, `ConfigurationField.label` IS the intended businessField source. This connection would need to be added as part of the multi-element component path (Tier 2/3).

#### D6 — Evidence Trail/Confidence NOT Carried Forward

**Classification:** Intentional design (P1 spec §4.2). ComponentInteraction has `intent`, `confidence`, `evidenceTrail` fields. The annotation layer populates them. But P1 explicitly states evidence trail is NOT part of capability knowledge — provenance lifetime is intentional. Confidence is surfaced in the review UI only, not persisted in capability contracts.

#### D7 — Non-Data-Input Types Produce No DataRequirements

**Classification:** Intentional design (P1 spec §3.1). Click, Navigation, Tab, Hover, Scroll do not produce DataRequirements. The binary gate `businessField !== null` is deliberate — these interactions don't have data inputs.

#### D8 — `fieldKey` vs `accessibleName` (Deferred)

**Classification:** Future evolution. P1's aspirational `field="maxPrice"` vs `label="Maximum Price"` distinction requires a `fieldKey` derivation layer. Tier 1 uses `accessibleName` for both. Forward-compatible through `displayLabel`.

---

### Architectural Model Mismatches (Category C)

#### C7 — Lifecycle/CONFIRMED Model Incompatible with Phase 3

**Finding:** Phase 4/5 lifecycle model expects multi-operation lifecycles (e.g., DROPDOWN = [CLICK, SELECT]). Phase 3 unified to ComponentInteraction where Component Runtime's `shouldComplete()` already determines semantic completeness. Adapter creates ONE transition per ComponentInteraction. Multi-operation expectedLifecycle sets can never be satisfied by single transitions.

**This is the deepest architectural finding.** The lifecycle model duplicates the Component Runtime's completeness check with a cruder signal (set-containment of operations). It should evolve to consume Component Runtime's determination.

**Resolution:** Add `endState` to `ObservedTransition` (populated from `ComponentInteraction.endState` in adapter). Orchestrator's `checkLifecycle()` promotes single-transition groups to CONFIRMED when `endState='completed'`. Multi-transition groups retain existing lifecycle check. This recognizes Phase 3's Component Runtime as the authoritative classifier.

**Dependency:** A5, A6, A7 all relate to this. C7 resolves them by making lifecycle confirmation work with single-transition component groups.

**Tier:** 2

---

### Ambiguous Contracts (Category B)

#### B1 — businessField Source Priority (RESOLVED)

**Resolution:** `accessibleName` (Tier 1). FieldKey derivation deferred. See §1.4.

#### B2 — domAttributes Projection (RESOLVED)

**Resolution:** Project typed DomContext fields into Record at adapter boundary. See A1/C3.

#### B3 — CONFIRMED Semantics After Phase 3 (RESOLVED)

**Resolution:** Single-transition groups CONFIRMED when `endState='completed'`. Multi-transition groups use lifecycle set-containment. See C7.

#### B4 — Normalization Contract (RESOLVED)

**Resolution:** No normalization for Tier 1. `accessibleName` used as-is. Future fieldKey layer may add normalization. See §1.4.

---

### Genuine Design Decisions Remaining Unresolved

#### U1 — Multi-Element OptionSet Extraction (D3 dependency)

OptionSets (dropdown option lists) need `querySelectorAll` — DOM access the service worker doesn't have. Content-script bridge or capture-at-interaction-time required. Matters for P3 validation tests (select valid/invalid option from known list). Blocked by D3.

#### U2 — `enrichConfigurationSession` → Capability Pipeline Wiring

`ConfigurationField.label` is the intended businessField source for dropdown/stepper multi-field interactions. Currently feeds only IR Bridge + side panel. Wiring into the capability pipeline would provide businessField for components that go through the CONFIRMED path. Needs D5 + C7.

#### U3 — Lifecycle Mismatches for ACCORDION

ACCORDION pattern `expectedLifecycle: [CLICK, TOGGLE]`. Same single-transition problem as Dropdown (A7). Resolved by C7 (endState-based confirmation).

#### U4 — Structural Recognition Coverage

Currently NO patterns have `structuralRecognition: true` — only ACCORDION has `structuralRecognition: false` explicitly. Others omit the field (optional, defaults to undefined/falsy). This means structural recognition never fires for ANY pattern. Behavioral recognition never fires (relatedElementIds empty). The recognition pipeline is effectively inert in production — all transitions are standalone. C4 + C5 + C7 address this for the component path.

#### U5 — Long-Term fieldKey Derivation

When P3 needs clean machine-readable field keys (`"maxPrice"` instead of `"Maximum Price"`), a fieldKey layer must be added to capability-mappers.ts. Priority: medium (P3 is next major phase after P2 wiring). Not blocking Tier 1 or Tier 2.

---

## Part 3: Dependency Graph

```
Tier 1 (independent, no cross-dependencies within tier):
  C1 (sourceInteractionType) ──────────────┐
  C3 (domAttributes) ──────────────────────┤
  C2 (businessField = accessibleName) ─────┤── D1 (standalone wiring) depends on C1+C2
  D1 (buildStandaloneAction) ──────────────┘

Tier 2 (depends on Tier 1 for standalone path; component path independent):
  C4 (ancestorRoles full chain) ───────────┐
  C5 (componentId assignment) ─────────────┤── enables component-based LogicalActions
  C7 (endState → CONFIRMED) ───────────────┘   resolves A5, A6, A7

Tier 3 (depends on Tier 2):
  D3 (relatedElementIds) ── enables behavioral recognition
  U1 (OptionSet extraction) ── depends on D3
  U2 (enrichConfigurationSession wiring) ── depends on C7
  U5 (fieldKey derivation) ── depends on P3 readiness
```

**Critical path:** Tier 1 → P2 wiring → Tier 2 → P3 readiness

---

## Part 4: Prioritized Implementation + QA Roadmap

### Phase A: Tier 1 — Unblock ALL Single-Element Data-Input Capabilities

**Goal:** Every single-element data-input interaction (TextEntry, Checkbox, Slider, DatePicker, FileUpload, RadioButton) produces a CapabilityInput with correct businessField, sourceInteractionType, and constraints.

**Corrections:**
1. **C1:** Add `sourceInteractionType: string | null` to `ObservedTransition` + `CreateObservedTransitionInput`. Populate from `ci.type` in adapter. Pass through in `buildStandaloneAction`.
2. **C3:** Build `domAttributes` Record from typed DomContext fields in adapter (`required`, `inputType`→`type`, `pattern`, `minLength`→`minlength`, `maxLength`→`maxlength`, `min`, `max`, `step`).
3. **C2:** Create `resolveBusinessField(identity)` returning `{businessField: accessibleName, displayLabel: accessibleName}`. Add `displayLabel` to `LogicalAction`, `CapabilityInput`. Pass `elements: UiElement[]` in `AggregationInput`.
4. **D1:** Call `resolveBusinessField` in `buildStandaloneAction`. Pass `sourceInteractionType` from transition.

**Expected Capability Output (login form):**
```
LogicalActions: [
  { businessField: 'Email Address', displayLabel: 'Email Address', sourceInteractionType: 'TextEntry' },
  { businessField: 'Password', displayLabel: 'Password', sourceInteractionType: 'TextEntry' },
]
InteractionContracts: [
  { constraints: { required: true, inputType: 'email', format: { regex: '...' } } },
  { constraints: { required: true, inputType: 'password' } },
]
CapabilityCandidate: {
  name: 'Email Address',
  inputs: [
    { label: 'Email Address', displayLabel: 'Email Address', sourceInteractionType: 'TextEntry',
      required: true, inputType: 'email', format: {...} },
    { label: 'Password', displayLabel: 'Password', sourceInteractionType: 'TextEntry',
      required: true, inputType: 'password' },
  ],
}
DataRequirements: [
  { field: 'Email Address', label: 'Email Address', kind: 'email', inputMethod: 'text', required: true, ... },
  { field: 'Password', label: 'Password', kind: 'text', inputMethod: 'text', required: true, ... },
]
```

**QA Validation:**
- Unit: adapter produces `sourceInteractionType`, `domAttributes`, transitions for all 23 InteractionTypes
- Unit: `resolveBusinessField` returns accessibleName for elements with/without form names
- Unit: `buildStandaloneAction` resolves businessField from elements map
- Unit: `InteractionContractDeriver` produces non-null constraints from populated domAttributes
- Integration: login form → CapabilityCandidate with 2 inputs, non-null constraints
- Integration: filter form (dropdown, checkbox, slider) → 3 inputs with correct inputMethods
- Integration: R3-reclassified div-checkbox → reaches capability via standalone path
- Edge: element with no accessibleName → businessField=null → skipped (not a data-input field)
- Edge: Click interaction → businessField=null → no CapabilityInput (intentional D7)
- Regression: all 3241 existing tests pass (update tests that asserted empty domAttributes/businessField)

### Phase B: P2 Production Wiring

**Goal:** Wire `generateCapabilityIR()` into the service worker STOP_RECORDING handler so capability-derived IR plans are produced alongside IR Bridge output.

**Prerequisite:** Phase A complete (capability pipeline produces valid CapabilityInputs with non-null businessField, sourceInteractionType, constraints).

**Work:**
1. Add P2 contract creation to P1 review flow (or auto-generate for dev)
2. Call `generateCapabilityIR()` from service-worker.ts after pipeline runs
3. Store P2 IR plan in StorageService
4. Surface P2 plan in side panel alongside IR Bridge output

**QA:**
- Integration: recording → capability review → P2 IR plan generated with correct steps
- Verify: P2 binding resolver successfully binds DataRequirements to session elements (businessField match works)
- Verify: R4 matchElements resolves targets correctly using recovered 18-field identity
- Regression: IR Bridge output unchanged (P2 is additive, parallel path)

### Phase C: Tier 2 — Multi-Element Component Recognition

**Goal:** ARIA-compliant multi-element components (radiogroup, tab panel, modal, accordion, dropdown) get recognized, confirmed, enriched, and produce component-based LogicalActions.

**Corrections:**
5. **C4:** Pass `element.ancestorRoles ?? [roleInfo]` in pipeline-runner.ts:109.
6. **C5:** After `runRecognition()`, iterate `registry.getActive()`, assign `componentId` to each transition via `assignTransitionToComponent()`.
7. **C7:** Add `endState` to `ObservedTransition` (from `ComponentInteraction.endState`). Evolve `checkLifecycle()` in ComponentRegistry: single-transition group with `endState='completed'` → CONFIRMED. Multi-transition groups retain set-containment check.

**Lifecycle reconciliation (resolved by C7):**
- DROPDOWN [CLICK, SELECT] → single transition with SELECT, endState='completed' → CONFIRMED
- CHECKBOX [TOGGLE] → single transition with TOGGLE, endState='completed' → CONFIRMED
- RADIO_GROUP [SELECT] → needs A6 resolution (RadioButton → TOGGLE vs expected SELECT). With C7, single-transition endState='completed' → CONFIRMED regardless of operation. A6 becomes moot.
- MODAL [CLICK] → single transition with CLICK → CONFIRMED
- TABS [CLICK] → single transition with CLICK → CONFIRMED
- ACCORDION [CLICK, TOGGLE] → single transition → CONFIRMED via C7

**QA:**
- Unit: adapter assigns `endState` from `ComponentInteraction.endState`
- Unit: `checkLifecycle()` confirms single-transition groups with endState='completed'
- Integration: radiogroup with 3 radios → recognized, confirmed, component-based LogicalAction
- Integration: dropdown select → recognized, confirmed, enriched with businessField from accessibleName
- Integration: modal open/close → recognized, confirmed
- Regression: standalone path still works (Phase A not broken)

### Phase D: P1 Review Flow Completion

**Goal:** Capability candidates go through the full P1 lifecycle: candidate → review → approve → version → P2 contract.

**Work:**
1. `CapabilityReviewService` — candidate → approved lifecycle
2. `CapabilityVersioningService` — immutable versions on edit
3. Side panel capability review UI (extend existing 4-view architecture)
4. `capabilityToContract()` mapper — approved capability → P2CapabilityContract

**QA:**
- Integration: record → candidate → review UI → approve → version → P2 contract
- Verify: P2 contract has correct dataRequirements from approved capability
- Verify: version immutability (editing creates new version, old version preserved)

### Phase E: Tier 3 — Behavioral Recognition + Advanced Enrichment

**Goal:** ARIA-absent multi-element controls recognized through behavioral signals.

**Corrections:**
8. **D3:** relatedElementIds computation. Two approaches: (a) content-script bridge that queries DOM descendants, (b) approximate from `ancestorRoles` data (elements sharing ancestors). Approach (b) is simpler and uses data already captured.
9. **U1:** OptionSet extraction via content-script `querySelectorAll` bridge, or capture option list at interaction time (dropdown open event captures all visible options).
10. **U2:** Wire `enrichConfigurationSession` → capability pipeline for multi-field configuration interactions.

**QA:**
- Integration: custom div-based radiogroup (no ARIA role) → behavioral recognition fires → confirmed
- Integration: dropdown with 5 options → optionSet extracted → DataRequirement.constraints.options populated

### Phase F: P3 — AI Test Generation

**Goal:** Automatically generate comprehensive test suites from recorded capabilities using LLMs.

**Prerequisite:** Phase D complete (approved capabilities with valid DataRequirements and constraints).

**Work:**
1. `TestGenerationEngine`, `PromptBuilder`, `TestCaseFactory`
2. Test variant taxonomy: positive/negative/boundary/validation/accessibility/security
3. `create_openai_api_key` integration
4. Constraint-driven test case generation (minLength/maxLength → boundary, pattern → validation, options → select valid/invalid)

**Potential U5 (fieldKey):** If P3 prompt generation benefits from clean machine-readable keys, add `fieldKey` derivation layer to capability-mappers.ts at this point.

**QA:**
- Integration: capability with constraints → P3 generates boundary/negative/validation variants
- Verify: generated TestData maps are keyed by `DataRequirement.field`
- Verify: test variants produce valid P2 IR plans for execution

### Phase G: P4–P6 — Execution + Self-Healing

**Goal:** Reliable CI/CD execution with retry, wait strategies, evidence capture, and AI failure analysis.

**Work:** RetryHandler, WaitStrategyHandler, EvidenceCaptureService, PlaywrightExecutor, FailureAnalysisEngine, AIHealingService.

**Dependencies:** Phase F (test suites to execute), Phase C (element matching for self-healing).

---

## Part 5: What's Already Strong (Don't Rebuild)

1. **Classification Pipeline (Phase 2 + R3):** 23 lifecycle definitions, 10 evidence generators, weighted scoring, UNRECOGNIZED_THRESHOLD. Production-wired, works.
2. **IR Bridge (Phase 3):** Consumes ComponentInteraction[] directly, generates correct Playwright code. Production-wired, works.
3. **R4 Element Matching:** 8-dimension scoring, 0.70 threshold, AMBIGUOUS detection, healing. Production-wired, works.
4. **P2 Design:** Binding resolver, identity recovery, IR action mapping. Complete, validated (48 tests, 7-scenario walkthrough). Not wired (depends on Tier 1).
5. **Test Infrastructure:** 2,908+ tests, golden master (68 fixtures × 142 tests).
6. **P1 Data Model:** DataRequirement, CapabilityInput, CapabilityVersion, P2CapabilityContract. Sound design, correct mappings.

---

## Part 6: Conflict Check

**No conflicts found between decisions.** Every decision is grounded in design docs, git history, and code. The one area where the P1 spec's aspirational examples differ from the implementation reality (fieldKey vs accessibleName) is explicitly resolved: Tier 1 uses accessibleName (Phase 5 design), future fieldKey is deferred with forward-compatible displayLabel.

The three identity layers (R4 / businessField / displayLabel) have clean non-overlapping responsibilities. C7 resolves the lifecycle model mismatch with Phase 3 without weakening lifecycle semantics — it recognizes the Component Runtime as the authoritative completeness checker.

---

*End of Whole-System Consolidation.*
