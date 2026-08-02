# Roadmap Dependency & Sequencing QA

> **Purpose:** Validate the proposed phase ordering (Tier 1 → P2 wiring → Tier 2 → P1 review → Tier 3 → P3) against actual code-level dependencies, distinguish foundational repair from strategic requirements, and define the real boundary of what Tier 1 unblocks. Do not implement — this is a planning document.
>
> **Date:** 2026-08-02

---

## 1. Validating the Proposed Sequence

### 1.1 The Sequence Under Challenge

```
Phase A (Tier 1) → Phase B (P2 wiring) → Phase C (Tier 2) → Phase D (P1 review) → Phase E (Tier 3) → Phase F (P3)
```

### 1.2 What the Code Actually Says About Dependencies

#### P2's Input Contract: `P2CapabilityContract`

`generateCapabilityIR()` takes `P2GenerationInput`, whose first field is:

```typescript
contract: P2CapabilityContract;  // "Approved capability contract from P1 review."
```

`P2CapabilityContract` (p2-capability-contract.ts) contains:
- `dataRequirements: DataRequirement[]` — formal field specs with kind + inputMethod
- `sourceSessionId: string` — provenance to the recording session
- `approvedAt: string` — approval timestamp

**P2 does NOT consume CapabilityCandidate. It consumes P2CapabilityContract, which is produced ONLY by `processDecision()` in `capability-review-service.ts` on approval.**

#### P1 Review Flow: Already Built

The P1 review flow is NOT unbuilt. It exists in production code right now:

1. **`session-persistence-service.ts:126`** — `createReview()` is called after every recording, creating a pending `CapabilityReview` with match suggestion.
2. **`service-worker.ts:942-998`** — `processDecision()` runs on APPROVE_CAPABILITY_REVIEW, creates Capability + CapabilityVersion + **P2CapabilityContract**, stores the contract at `StorageKeys.CAPABILITY_INVENTORY + '_contract'`.
3. **`sidepanel.ts:780-860`** — Review card renders with approve/reject/override/edit buttons. User clicks → sends message to SW.

The entire candidate → review → approve → contract lifecycle is **already production-wired**. It just produces empty/zero-input contracts because Tier 1 hasn't run.

#### What P2 Wiring Actually Requires

P2's `generateCapabilityIR()` needs:
1. A `P2CapabilityContract` — **already produced** by the P1 review flow on approval
2. A `TestData` map — P3 provides this, or a default map from DataRequirements
3. Access to `repos.recordingSessions` and `repos.elements` — **already available** via `DexieUnitOfWorkFactory`

The SW already stores the contract (`_contract` key). The ONLY missing piece is calling `generateCapabilityIR()` after approval and surfacing the result. **P2 wiring depends ONLY on Tier 1 making the contract non-empty.**

#### The Correction to Phase D

Phase D as originally described ("P1 Review Flow Completion") is **misnamed**. The P1 review flow is already built. What's missing is:
- Reviewer edits UI (name/purpose/data requirements/success criteria editing) — currently edits are stored but not surfaced for editing
- Override match UI — currently shows "not yet implemented"

These are **UX enhancements, not capability pipeline prerequisites**. The approve→contract path works today. Reviewer edits enrich the contract but are not required for P2 to function.

### 1.3 Revised Sequence

**Original:**
```
Phase A (Tier 1) → Phase B (P2 wiring) → Phase C (Tier 2) → Phase D (P1 review) → Phase E (Tier 3) → Phase F (P3)
```

**Corrected:**
```
Phase A (Tier 1 — data flow repair)
    ↓ (produces non-empty CapabilityCandidate → non-empty P2CapabilityContract)
Phase B (P2 wiring — call generateCapabilityIR after approval)
    ↓ (produces disposable ExecutionIRPlan from capability knowledge)
    ↓ P1 review flow already exists; reviewer edits are parallel UX work, not a gate
Phase C (Tier 2 — multi-element recognition)
    ↓ (enriches the component path; standalone path already works)
Phase D (Reviewer edits UI — enrich, not gate)
    ↓ (parallel to Phase C; no hard dependency)
Phase E (Tier 3 — behavioral recognition + optionSets)
    ↓ (extends recognition to ARIA-absent custom controls)
Phase F (P3 — AI test generation)
    ↓ (consumes contracts + constraints to generate test variants)
Phase G (P4-P6 — execution + self-healing)
```

**What changed:**
1. **Phase D removed from critical path.** P1 review flow is already built. Reviewer edits are UX enrichment, not a gate. Moved to parallel/optional.
2. **P2 wiring (Phase B) goes immediately after Tier 1.** P2 consumes P2CapabilityContract, which the existing review flow already produces on approval. The only thing P2 needed was non-empty dataRequirements — Tier 1 provides that.

### 1.4 Justification for This Order

| Transition | Why this order | What breaks if reversed |
|---|---|---|
| Tier 1 → P2 wiring | P2 needs non-empty DataRequirements. Tier 1 makes businessField/constraints non-null. Without Tier 1, P2 gets contracts with zero inputs → IR plan with no steps. | P2 produces empty plans. |
| P2 wiring → Tier 2 | P2 works with standalone actions. Tier 2 adds component recognition (parallel enrichment). P2 can be validated on simple single-element recordings before complex multi-element ones. | If Tier 2 first: recognition bugs obscure P2 wiring bugs. Harder to isolate. |
| Tier 2 → Tier 3 | Tier 2 handles ARIA-compliant controls (ancestorRoles + structural recognition). Tier 3 handles ARIA-absent controls (behavioral recognition). Tier 2 is simpler (data exists) and validates the recognition pipeline before Tier 3's harder DOM-access problem. | If Tier 3 first: D3 (relatedElementIds) requires MV3 architecture changes. Wastes time on the hardest problem before validating the simpler path. |
| P2 → P3 | P3 generates test data variants. P2 consumes TestData to produce IR plans. P3's output is P2's input. P2 must exist first. | P3 generates test data for a plan format that doesn't exist yet. |

---

## 2. Tier 1 "ALL" Claim Validation

### 2.1 The Claim

> "Tier 1 unblocks ALL single-element data-input interactions."

### 2.2 The Real Boundary

**What "ALL" means:** Every interaction classified as a data-input type by Component Runtime (TextEntry, Checkbox, Slider, DatePicker, FileUpload, RadioButton, Dropdown) that travels the standalone path (componentId=null) will produce a CapabilityInput after Tier 1.

**The actual conditions for this to be true:**

| Condition | Guaranteed by Tier 1? | Evidence |
|---|---|---|
| `businessField ≠ null` | YES — C2 reads `identity.accessibleName` from UiElement | `identity.accessibleName` is `string` (non-nullable) on RawElementIdentity (types.ts:121) |
| `sourceInteractionType` populated | YES — C1 passes `ci.type` through adapter → buildStandaloneAction | Component Runtime always assigns a resolved type |
| `domAttributes` non-empty | YES for elements with validation attributes — C3 projects typed fields | dom-context-extractor.ts captures `required`, `pattern`, `minLength`, etc. at observation time |
| Element in `elements` map | YES — domain adapter creates UiElement for every non-navigation interaction | domain-adapter-v2.ts:390-411 |

**What "ALL" does NOT cover:**

| Gap | Why | Impact | Tier |
|---|---|---|---|
| Element with `accessibleName = ""` | Content script computes accessible name best-effort. If element has no aria-label, no associated label element, no text content → empty string. | businessField = "" → still passes `!== null` gate but produces a useless key. | Not a Tier 1 defect — this is weak semantic evidence, addressed by displayLabel + future fieldKey. |
| `optionSets` (dropdown options) | NoOpDomInspector can't query DOM. Option list requires `querySelectorAll` (DOM access the SW lacks). | Dropdowns produce CapabilityInput (confirmed via accessibleName) but with empty `validOptions`. P3 can't generate "select invalid option" validation tests. | Tier 3 (U1) |
| `multi-field configuration sessions` | `enrichConfigurationSession` produces `ConfigurationField.label` for stepper/dropdown multi-field interactions. Not wired to capability pipeline. | Multi-field components like "2 adults, 3 children" stepper lose their field labels. | Tier 3 (U2) |
| Component-grouped actions | Tier 2 territory. Standalone actions for component-grouped elements still work (each transition is standalone), but they produce individual CapabilityInputs instead of one grouped action. | E.g., a radio group produces 3 separate inputs instead of one "select option" input. Functionally correct but semantically coarse. | Tier 2 (C4+C5+C7) |

### 2.3 Honest Boundary Statement

**Tier 1 unblocks ALL single-element data-input interactions where the element has a non-empty accessibleName.** This covers the vast majority of real-world form controls (labels, aria-labels, placeholder text all contribute to accessibleName).

**Tier 1 does NOT unblock:**
- OptionSet extraction (constraint `validOptions` stays null)
- Multi-field configuration enrichment (stepper labels, grouped fields)
- Component-grouped semantic actions (radio groups, accordions)

**These are Tier 2/3 concerns, not Tier 1 defects.**

---

## 3. Foundational Repair vs Strategic Requirements

### 3.1 Foundational Repair (Must Fix Before Anything Works)

These are **broken connections** — data flows that were designed, captured, but never wired. The architecture is correct; the implementation has gaps.

| Correction | What It Restores | Without It |
|---|---|---|
| **C1** (sourceInteractionType) | InteractionType travels ComponentInteraction → ObservedTransition → LogicalAction → CapabilityInput → DataRequirement.inputMethod | P1 can't derive inputMethod. P2 doesn't know if a field is text/select/check/slider. |
| **C2** (businessField) | accessibleName travels UiElement → LogicalAction.businessField → CapabilityInput → DataRequirement.field | Zero CapabilityInputs. Capability has no data fields. Entire pipeline produces nothing. |
| **C3** (domAttributes) | Validation constraints travel DomContext typed fields → domAttributes Record → InteractionContract.constraints → CapabilityInput → DataRequirement | No boundary/validation test generation. Constraints captured but lost at adapter boundary. |
| **D1** (standalone wiring) | buildStandaloneAction uses C1+C2 instead of hardcoding null | Standalone path produces empty LogicalActions. |
| **C4** (ancestorRoles) | Full ancestor chain travels DomContext → UiElement.ancestorRoles → OrchestratorInput | Structural recognition can't match ancestor-based patterns. |
| **C5** (componentId) | assignTransitionToComponent() is called after recognition | All transitions are standalone. No component-based actions. |
| **C7** (endState→CONFIRMED) | ComponentInteraction.endState → ObservedTransition.endState → checkLifecycle() confirms single-transition groups | No component reaches CONFIRMED. All lifecycle checks fail. |

### 3.2 Strategic Requirements (Needed for Product Goal, Not for Pipeline to Function)

These add **new capability** — features that don't exist yet but are needed for the full vision.

| Requirement | Why It's Strategic | What It Unlocks | Dependency |
|---|---|---|---|
| **P2 wiring** | First proof that capability knowledge generates disposable IR plans. The transformative moment: record once, replay with new data. | Cross-session, cross-data test execution without re-recording. | Tier 1 (contract non-empty) |
| **Reviewer edits UI** | Human review quality. Today the user approves/rejects but can't edit the derived dataRequirements. | Reviewer corrects classification errors, adds missing constraints, renames fields. | None (parallel to everything) |
| **OptionSet extraction** (U1) | Validation test generation: "select valid option", "select invalid option", "verify all options" | P3 dropdown/select validation tests. | D3 (DOM access) |
| **fieldKey derivation** (U5) | Clean machine-readable TestData keys (`maxPrice` instead of `Maximum Price`). TestData maps become maintainable. | P3 generates clean test data maps. Test reports are readable. | P3 readiness |
| **Behavioral recognition** (D3) | Custom controls without ARIA roles get recognized. The key to "ANY interaction regardless of implementation." | div-based checkboxes, class-toggle sliders, custom dropdowns. | Tier 2 (validate recognition pipeline first) |
| **P3 AI generation** | The endgame: AI generates comprehensive test suites from capabilities. Positive, negative, boundary, validation, accessibility, security variants. | The product's core value proposition. | P2 wiring + constraints (Tier 1 C3) |

### 3.3 The Distinguishing Question

> "If I fix this, does a broken connection start working, or does a new feature appear?"

- **C1, C2, C3, D1** → broken connections start working (Tier 1)
- **C4, C5, C7** → broken connections start working (Tier 2)
- **P2 wiring** → new feature appears (but the underlying P2 logic is already built and tested)
- **OptionSets, fieldKey, behavioral recognition, P3** → new features appear (Tier 3 / future phases)

---

## 4. Revised Roadmap (Final)

### Phase A — Tier 1: Data Flow Repair

**Scope:** C1 (sourceInteractionType), C2 (businessField), C3 (domAttributes), D1 (standalone wiring).

**Deliverable:** Recording a login form → CapabilityCandidate with 2 inputs (email, password), each with correct inputMethod, required flag, format constraints. P2CapabilityContract (on approval) has non-empty dataRequirements.

**Boundary:** ALL single-element data-input interactions with non-empty accessibleName produce CapabilityInputs. No optionSets. No multi-field enrichment. No component grouping.

**Tests:** Unit (adapter, resolveBusinessField, InteractionContractDeriver, buildStandaloneAction), Integration (login form → CapabilityCandidate, filter form → 3 inputs, R3-reclassified div-checkbox → capability), Edge (no accessibleName → skipped, Click → no input), Regression (3241 tests).

---

### Phase B — P2 Wiring: Capability-to-IR Pipeline

**Scope:** After `processDecision()` produces a P2CapabilityContract, call `generateCapabilityIR()` with default TestData. Store the result. Surface in side panel.

**Deliverable:** Record form → review → approve → **P2 IR Plan generated** with parameterized steps using correct interaction strategies. This is the first proof of the core thesis: record once, replay with different data.

**Boundary:** Works for all single-element interactions from Tier 1. Multi-element components produce coarser (per-transition) steps until Tier 2. TestData is default (values from recording). P3 not yet available to generate variant data.

**Tests:** Integration (recording → approval → P2 plan with correct IRAction steps), Verify (binding resolver binds businessField to session elementId, R4 matchElements resolves targets), Regression (IR Bridge output unchanged).

**Why after Tier 1:** P2 produces empty plans without non-empty dataRequirements. Tier 1 fixes that.

---

### Phase C — Tier 2: Multi-Element Recognition

**Scope:** C4 (ancestorRoles full chain), C5 (componentId assignment), C7 (endState→CONFIRMED).

**Deliverable:** ARIA-compliant multi-element components (radiogroup, tab panel, modal, accordion, dropdown) recognized, confirmed, enriched, producing component-based LogicalActions. P2 IR plans now have grouped steps for multi-element interactions.

**Boundary:** Works for ARIA-compliant controls. ARIA-absent custom controls still go through standalone path. Lifecycle confirmed via endState, not multi-operation set-containment.

**Tests:** Unit (adapter assigns endState, checkLifecycle confirms single-transition groups), Integration (radiogroup → grouped action, dropdown → grouped action, modal → grouped action), Regression (standalone path intact).

**Why after P2 wiring:** Validates the standalone→capability→P2 pipeline on simple cases first. Component recognition bugs don't obscure P2 wiring bugs.

---

### Phase D — Reviewer Edits UI (Parallel, Non-Blocking)

**Scope:** Side panel UI for editing CapabilityCandidate before approval: edit name, purpose, dataRequirements (field label, kind, required, constraints), success criteria.

**Deliverable:** Human reviewer can correct classification errors before the capability is frozen into a version.

**Boundary:** UX enhancement. P2 works without it (contract is derived from unedited candidate). But review quality improves significantly.

**Why parallel:** No pipeline dependency. Can start during Phase C or even Phase B. The `processDecision` function already supports edits via `CapabilityReviewEdits` — the SW handler passes them through. Only the UI is missing.

---

### Phase E — Tier 3: Behavioral Recognition + Advanced Enrichment

**Scope:** D3 (relatedElementIds computation), U1 (optionSet extraction), U2 (enrichConfigurationSession wiring).

**Deliverable:** Custom controls without ARIA roles recognized through behavioral signals. Dropdown option lists extracted. Multi-field configuration sessions (steppers) produce labeled inputs.

**Boundary:** Depends on solving the MV3 DOM access problem for optionSet extraction. The behavioral recognition approach (approximate from ancestorRoles) may partially address D3 without a content-script bridge.

**Why after Tier 2:** Tier 2 validates the recognition→confirmation→capability pipeline on the simpler ARIA-compliant path. Tier 3 extends to the harder ARIA-absent path.

---

### Phase F — P3: AI Test Generation

**Scope:** TestGenerationEngine, PromptBuilder, TestCaseFactory. Constraint-driven test variant taxonomy (positive/negative/boundary/validation/accessibility/security). LLM integration via `create_openai_api_key`.

**Deliverable:** Given a P2CapabilityContract with constraints, P3 generates a suite of test data variants. Each variant → P2 generates a disposable IR plan. The full vision: record once → AI generates comprehensive test suite.

**Boundary:** Quality of test generation depends on constraint completeness. Tier 1 C3 provides constraints from typed DomContext fields. Tier 3 U1 provides optionSets for dropdown validation. fieldKey (U5) may be added here if P3 prompts benefit from clean keys.

**Why last:** P3 consumes the output of everything before it. It needs valid contracts (Tier 1), working P2 (Phase B), and ideally complete constraints (Tier 3). It's the product's endgame — the reason everything else exists.

---

### Phase G — P4-P6: Execution + Self-Healing

Execution framework, retry/wait strategies, evidence capture, AI failure analysis, element healing via R4. Depends on Phase F (test suites to execute) and Phase C (element matching for self-healing).

---

## 5. Critical Path Summary

```
Tier 1 ──────────→ P2 Wiring ──────────→ Tier 2 ──────────→ Tier 3 ──────────→ P3 ──→ P4-P6
  (data flow)      (first proof)         (multi-element)    (custom + opt)    (AI gen)  (exec)
                                               ↑
                                     Reviewer Edits UI (parallel)
```

**The critical path is Tier 1 → P2 Wiring.** Everything after is enrichment of a working capability→IR pipeline. The transformative moment — proving that recorded capability knowledge can generate new test plans — happens at P2 Wiring, not later.

**Foundational repair = Tier 1 + Tier 2.** These fix broken connections. Everything else adds new capability.

**The single most important validation after Tier 1:** Record a login form, approve the capability, call `generateCapabilityIR()` with test data `{email: 'newuser@test.com', password: 'NewPass123!'}`, and verify the output IR plan has correct FILL steps targeting the right elements. If that works, the thesis is proven. Everything else is scale and coverage.

---

## 6. Conflict Check

**One conflict found and resolved:**

**Original Phase D (P1 Review Flow Completion) was placed between Tier 2 and Tier 3 in the critical path.** Investigation reveals the P1 review flow is already fully built — `createReview()`, `processDecision()`, side panel review card, approve/reject messages, contract storage. The only missing piece is reviewer edits UI (a UX enhancement). Moving Phase D off the critical path. It runs in parallel starting any time after Tier 1.

No other conflicts. The dependency chain is linear and each phase's prerequisite is satisfied by the preceding phase.

---

*End of Roadmap Dependency & Sequencing QA.*
