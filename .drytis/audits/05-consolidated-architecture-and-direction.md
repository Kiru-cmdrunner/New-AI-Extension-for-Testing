# Consolidated Architecture Understanding & Project Direction

> **Status:** LIVING DOCUMENT — consolidate of 10+ rounds of analysis
> **Date:** 2026-08-02
> **Purpose:** Single source of truth for all architectural understanding, findings, decisions, and reasoning
> **Scope:** Full project — extension flow, architecture/design history, R1-R4, P1/P2, Capability model, all C/D findings

---

## 1. Project Vision & Ultimate Goal

**The project is NOT a test recorder. It is a semantic understanding engine.**

The vision: watch a human use a web application, understand what they are doing at the business-intent level, capture durable reusable capability knowledge, and generate executable test plans with arbitrary data that survive UI redesigns.

Three principles (CANONICAL_ROADMAP §10):
1. **Observation is immutable, capability is versioned, IR is disposable, implementation is replaceable**
2. **Separation of evidence and classification** — evidence is observed, classification is reasoned
3. **Graceful degradation** — remain uncertain rather than guessing; preserve uncertain interactions for human review

---

## 2. Two Generations of Intelligence

### Generation 1 (Working — Production)
```
DOM Events → EventTap (content script)
  → Component Runtime (23 lifecycle definitions + R3 behavioral evidence)
  → ComponentInteraction[] (authoritative classification)
  → IR Bridge (consumes ComponentInteraction directly)
  → PlaywrightCodeGenerator
```
This is a smart recorder. It works. It produces correct Playwright code for known, custom, and R3-reclassified interactions.

### Generation 2 (Designed — Not Connected)
```
ComponentInteraction[]
  → Domain Adapter → ObservedTransition[] + UiElement[]
  → Recognition → ComponentGrouping[]
  → Enrichment → ApplicationKnowledgeFragment
  → Capability Derivation → CapabilityCandidate
  → P1 Review → CapabilityVersion → P2CapabilityContract
  → P2 (capability-derived IR) → ExecutionIRPlan
```
This is the transformative path — durable capability knowledge. The design is sound. The enrichment logic is correct. The capability derivation is well-designed. The P2 binding and R4 matching are sound.

**The problem: these two generations are disconnected at the domain adapter boundary.**

---

## 3. Architecture Evolution History

### Phase 0-5: Foundation
- Phase 0-2: Content script capture, Component Runtime, evidence engine
- Phase 3: Behavioral recognition (Tier 2)
- Phase 4: Component registry, lifecycle promotion, evidence ledger
- Phase 5: Post-recording enrichment (7-step pipeline), semantic aggregation

Key design from Phase 5: `businessField` = "from accessibleName/label (a DOM attribute)." `InteractionContractDeriver` reads `UiElement.domAttributes`. `DomInspector` abstraction for testability.

### Phase 6-7: Pipeline Wiring
- Extended DomContext with `ancestorRoles` + `domAttributes` (Record)
- Built domain adapter
- Wired recognition orchestrator into pipeline-runner
- Wired enrichment orchestrator with `NullDomInspector` (SW has no DOM)
- **Critical gap introduced here**: `domAttributes` Record added to `RecordedEvent.DomContext` interface but NEVER populated by the capture function. `dom-context-extractor.ts` captures typed fields (`required`, `pattern`, etc.) on `component-types.ts DomContext` — the adapter reads a different field name.

### Phase 8-9.5: IR Bridge + Capability Deriver
- IR Bridge consumes ComponentInteraction[] directly (Phase 3 unification)
- CapabilityCandidate + deriveCapability from ApplicationKnowledgeFragment
- `businessField` was always null because `deriveBusinessField` queries `NoOpDomInspector`

### R1 (5e9d75f): Foundation Cleanup
- Eliminated dormant V2 subsystem
- Promoted `domain-adapter-v2.ts` as sole adapter
- Deleted `DetectedInteraction`/classifier types

### R2 (5a6f5d5): Slider Geometry
- Added custom div-based slider support to `dom-context-extractor.ts`
- Extended slider definitions with track geometry

### R3 (1b2fa89): Behavioral Semantic Reasoning
- Added post-handler behavioral data capture (attribute re-snapshot)
- 4 new evidence generators (selection-state, child-visibility, value-change, content-editable)
- UNRECOGNIZED_THRESHOLD = 0.3
- **Annotation deferral** (not Click lifecycle deferral) — canonical architecture
- R3-reclassified interactions (div-checkbox, custom dropdown) emit with correct InteractionType

### R4 (5c814d1-b4d558a): Element Identity Matching
- Enriched Element entity with 9-field `ElementIdentityRecord`
- 8-dimension weighted scoring: BUSINESS_IDS 25%, ACCESSIBLE_NAME 20%, FORM_NAME 15%, ARIA_ROLE 10%, ARIA_LABEL 10%, ANCESTOR_ROLES 10%, TAG 5%, PAGE_SCOPE 5%
- MATCH_THRESHOLD = 0.70, MIN_MARGIN = 0.05
- Three categories: MATCHED / AMBIGUOUS / UNMATCHED
- **Owns cross-session element reconciliation — the ONLY mechanism for that**

### P1 (cc44c74): Capability Lifecycle Management
- CapabilityVersion (immutable snapshots)
- DataRequirement (field + label + kind + inputMethod + constraints)
- P2CapabilityContract (read-only downstream contract)
- `sourceInteractionType` added to LogicalAction (Revision 1)
- `INTERACTION_TYPE_TO_INPUT_METHOD` mapping table
- **Aspirational examples use camelCase field identifiers** (`email`, `maxPrice`) — no normalization function was built

### P2 (57128cb-84c3089): Capability-Derived IR Generation
- 8-step pipeline: session recovery → bindings → identity recovery → R4 matching → data resolution → success criteria → IR assembly
- `generateCapabilityIR()` has ZERO production callers
- `ElementBindingResolver` maps `DataRequirement.field → session elementId` via `businessField`
- `ElementTargetResolver` recovers full 18-field identity from `rawInteractions`, calls `matchElements`
- **businessField's job ends at binding** — R4 takes over for cross-session matching

---

## 4. The Three Identity Layers

### Layer 1 — R4 Element Identity (cross-session reconciliation)
- **Owner:** `ElementIdentityRecord` on `Element` (repository entity)
- **Purpose:** "Is this the same logical control across sessions?"
- **Source:** `ElementIdentity` (18 fields) + `ancestorRoles` from DomContext
- **Consumer:** `ElementMatchingService.matchElements()` — 8-dimension scoring
- **Scope:** Permanent in repository; updated during healing

### Layer 2 — businessField (intra-session data-field binding)
- **Owner:** `LogicalAction.businessField`
- **Purpose:** Connect a DataRequirement to a session elementId during P2 binding
- **Consumer:** `ElementBindingResolver.resolveSingleBinding()` — exact string match
- **Scope:** Ephemeral — one session's fragment, used to build binding map, then discarded
- **Does NOT participate in cross-session matching**

### Layer 3 — Human-readable semantic meaning (display)
- **Owner:** `DataRequirement.label`, `Element.logicalName`, `CapabilityInput.displayLabel`
- **Purpose:** What users see in UI, error messages, test reports
- **Source:** `accessibleName` (real DOM label), `humanizeLabel()` (reconstructed fallback)
- **Consumer:** Review UI, test reports, validation messages

### Why They Must Not Overlap
R4 already scores FORM_NAME (identity.name) at 15% weight. If businessField also used identity.name as its value, it would duplicate R4's responsibility for a job R4 already handles. businessField should be the simplest available intra-session key — `accessibleName` — not a competing identity signal.

---

## 5. businessField Contract — Complete Analysis

### Original Design (Phase 5)
`deriveBusinessField` was designed to return `accessibleName` or `aria-label` — human-readable strings. `CapabilityInput.label` was documented as "Human-readable field label (from LogicalAction.businessField)."

### P1 Aspiration
P1 examples showed `field: "email"`, `label: "Email Address"` — machine-readable vs human-readable from different sources. P1 claimed "enrichConfigurationSession produces businessField names." But:
1. `deriveBusinessField` was never changed
2. `enrichConfigurationSession` was never wired to the enrichment pipeline
3. No normalization function was built

### What P2 Actually Needs
`TestData = ReadonlyMap<string, ...>` keyed by `DataRequirement.field`. P3 generates test data maps: `{ "email": "test@test.com" }`. P2 binding resolver primary path: `action.businessField === req.field`.

### The P2 Spec Walkthrough Proof
- `businessField = "category"`, `accessibleName = "Category"` — different strings
- `label = "Maximum Price"`, but `humanizeLabel("maxPrice") = "Max Price"` — different strings
- Proves field and label were intended to come from different DOM sources

### Decision: Tier 1
`businessField = accessibleName`. This restores the original Phase 5 flow. `field` and `label` will both be the accessibleName. Functional, stable, correct. The P1 vision of machine-readable field identifiers is deferred to a future mapping-layer enhancement.

### Decision: Future (when P3 is imminent)
Add a `fieldKey` derivation layer in capability-mappers.ts:
1. `identity.name` (form name, when clean)
2. `identity.testId`
3. Normalized accessibleName (camelCase conversion)
4. Raw accessibleName (fallback)

The Tier 1 `displayLabel` field is forward-compatible: it preserves accessibleName independently so the future fieldKey layer doesn't lose the real label.

---

## 6. DomContext — Origin & Purpose

### Why It Was Introduced
DomContext was the **classification substrate** — structured DOM observations that the Component Runtime's definition stack reads to classify interactions:
- `inputType` → TextEntry, Checkbox, DatePicker definitions
- `ariaExpanded` → Dropdown, Accordion definitions
- `ariaValueNow/Min/Max` → Slider definitions

### Why Fields Are Captured at Observation Time
1. **Immutability principle** — DOM state changes; capture freezes the truth
2. **MV3 constraint** — service worker has no DOM access; data must be serialized from content script
3. **Deterministic observation** — constraints come from physical DOM, not AI inference

### Phase 6-7 Extension
Added validation fields to DomContext for enrichment: `required`, `pattern`, `minLength`, `maxLength`, `min`, `max`, `step`, `inputType`, `formName`.

**The defect**: `domAttributes` Record was added to `RecordedEvent.DomContext` interface ("the source of InteractionContract derivation") but `dom-context-extractor.ts` was NEVER updated to populate it. It populates typed fields instead. The adapter reads `domAttributes` → always empty → all constraints null.

---

## 7. CONFIRMED / Lifecycle Model Analysis

### Phase 4/5 Lifecycle Model (component-registry.ts)
Components enter as TENTATIVE, accumulate transitions, promote to CONFIRMED when `expectedLifecycle ⊆ observedOps`.

### Phase 3 Incompatibility
The domain adapter creates ONE transition per ComponentInteraction (Phase 3 unified model). But:
- DROPDOWN expects `[CLICK, SELECT]` → one `SELECT` transition → `{SELECT} ⊄ {CLICK, SELECT}` → never CONFIRMED
- RADIO_GROUP expects `[SELECT]` → adapter maps RadioButton → `TOGGLE` → mismatch
- ACCORDION expects `[CLICK, TOGGLE]` → unachievable with single transition

### Root Cause
Phase 4/5 lifecycle was designed for event-level transitions. Phase 3 moved to ComponentInteraction-level granularity. The lifecycle model never adapted.

### Tier 2 Resolution (C7)
Component Runtime already determines semantic completeness via definition stack's `shouldComplete()`. The lifecycle model should consume `endState` from ComponentInteraction rather than re-deriving completeness from a cruder signal. Add `endState` to `ObservedTransition`, evolve `checkLifecycle()` to confirm single-transition groups when `endState='completed'`.

---

## 8. All Findings — Classified

### Confirmed Defects (Class A — implementation not matching design)

| ID | Finding | Root Cause | Tier |
|---|---|---|---|
| C1 | `sourceInteractionType=null` for standalone | `ObservedTransition` has no field; `buildStandaloneAction` hardcodes null | 1 |
| C2 | `businessField=null` for all | `deriveBusinessField` queries `NoOpDomInspector` + empty domAttributes | 1 |
| C3 | All constraints null | `domAttributes` Record never populated; adapter reads wrong type | 1 |
| D1 | Standalone enrichment gap | `buildStandaloneAction` hardcodes businessField=null | 1 |
| C4 | `ancestorRoles` truncated | `pipeline-runner.ts:109` passes `[roleInfo]` not full chain | 2 |
| C5 | `componentId` never assigned | `assignTransitionToComponent` is dead code | 2 |
| C7 | Lifecycle model incompatible with Phase 3 | Phase 4/5 expects multi-operation lifecycles | 2 |

### Following Design (Class B — intentional, not defects)

| ID | Finding | Why It's Intentional |
|---|---|---|
| B1 | Missing SLIDER/DATE_PICKER/FILE_UPLOAD PatternDefinitions | Single-element interactions reach capability via standalone path — no pattern needed |
| B2 | `NoOpDomInspector` in production | MV3 service worker has no DOM access — by design |
| B3 | P2 not production-wired | Roadmap sequencing — P2 is correctly designed but not yet activated |
| C6 | INTERACTION_TO_OPERATION Slider→CLICK, FileUpload→CLICK | IR Bridge doesn't use `operation` (0 references). Operation only consumed by aggregator lifecycle + behavioral signatures. C6 dropped — not worth fixing since IR Bridge is the production path. |

### Ambiguous Design (Class C — needs decision)

| ID | Finding | Resolution |
|---|---|---|
| C-CONFIRMED | CONFIRMED gating excludes standalone enrichment | Tier 2: C7 evolves lifecycle to consume endState |
| C-NORM | `businessField` format (raw vs camelCase) | Tier 1: raw accessibleName. Future: fieldKey layer. |
| C-DOMATTR | domAttributes as Record vs typed fields | Tier 1: project typed fields to Record in adapter (restores Phase 6-7 intent) |

### Intentional Boundaries (Class D — designed limits)

| ID | Finding | Why It's Intentional |
|---|---|---|
| D3 | `relatedElementIds=[]` always | MV3 constraint. R3 behavioral reclassification handles most cases via standalone path. |
| D-PROV | Evidence trail not stored in capability | P1 spec §4.2: provenance lifetime is intentional |
| D-OPTIONS | OptionSet extraction needs DOM access | Blocked by MV3 — deferred (content-script bridge or capture-at-time) |

---

## 9. Dependency Graph

### Two Independent Failure Chains

**Chain A (standalone → capability):**
```
buildStandaloneAction hardcodes businessField=null + sourceInteractionType=null
  → deriveInputs skips all standalone actions (businessField gate)
  → CapabilityCandidate.inputs = []
```
Blocked by C1 + C2 + D1. NOT caused by any other defect.
**Resolvable independently. Tier 1.**

**Chain B (component → capability):**
```
componentId never assigned (C5)
  + ancestorRoles truncated (C4)
  + lifecycle mismatches (C7)
  → no components CONFIRMED
  → component enrichment never runs
  → component businessField stays null
```
Blocked by C5, then C4, then C7. Cross-cut by C2 + C3.
**Resolvable independently. Tier 2.**

**C2 and C3 cross-cut both chains** — businessField source and constraint derivation affect both standalone and component paths.

---

## 10. Current State — What's Strong

1. **Classification Pipeline**: 23 lifecycle definitions, 8 interaction categories, R3 behavioral evidence with 10 generators
2. **IR Bridge**: Production Playwright generation consuming ComponentInteraction[] directly
3. **R4 Element Identity**: 8-dimension weighted scoring, correct MATCHED/AMBIGUOUS/UNMATCHED semantics
4. **P2 Design**: Binding resolver, identity recovery, IR action mapping all sound
5. **Capability Model**: DataRequirement with orthogonal kind × inputMethod, versioning, review workflow
6. **Test Infrastructure**: 3241/3242 tests pass, golden master (68 fixtures × 142 tests)
7. **Chrome Extension**: MV3-resilient content script, 5-retry exponential backoff, session recovery

---

## 11. Current State — What's Broken

1. **Domain adapter information loss**: sourceInteractionType, businessField, constraints, ancestorRoles all lost
2. **Recognition wiring gaps**: componentId never assigned, ancestorRoles truncated
3. **Standalone enrichment gap**: buildStandaloneAction nulls critical fields
4. **Lifecycle model mismatch**: Phase 4/5 lifecycle incompatible with Phase 3 one-transition model
5. **OptionSet extraction**: NoOpDomInspector can't query DOM (MV3 constraint)

---

## 12. Prioritized Implementation Roadmap

### Tier 1 — Unblocks ALL Single-Element Capabilities (Including R3-Reclassified)

| Step | ID | Change | Dependency |
|---|---|---|---|
| 1 | C1 | `sourceInteractionType` on ObservedTransition → adapter → standalone | None |
| 2 | C3 | `domAttributes` Record from typed DomContext fields | None (parallel with C1) |
| 3 | C2 | `resolveBusinessField` from accessibleName + `displayLabel` | C1 |
| 4 | D1 | Wire C1+C2 into `buildStandaloneAction` | C1 + C2 |

**Result**: TextEntry, Checkbox, ToggleSwitch, Slider, DatePicker, FileUpload, RadioButton — all single-element data-input interactions produce capabilities. R3-reclassified interactions (div-checkbox, custom slider, contentEditable) also reach capability.

**Verification**: Expected Capability output matches the "AFTER Tier 1" table in the spec. Semantic knowledge (field identity, label, interaction type, constraints) reaches CapabilityCandidate.inputs and DataRequirement[].

### Tier 2 — Unblocks Multi-Element Component Recognition

| Step | ID | Change | Dependency |
|---|---|---|---|
| 5 | C4 | Pass `element.ancestorRoles ?? [roleInfo]` in pipeline-runner | Tier 1 |
| 6 | C5 | Wire `assignTransitionToComponent()` after recognition | C4 |
| 7 | C7 | Add `endState` to ObservedTransition; evolve `checkLifecycle()` | C5 |

**Result**: Multi-element ARIA-compliant components (radiogroup, tab panel, modal, accordion) get recognized, confirmed, enriched. Structural recognition works.

### Tier 3 — Deferred

| Item | Blocked By | Impact |
|---|---|---|
| D3 (relatedElementIds) | MV3 DOM access | Behavioral recognition for non-ARIA multi-element |
| OptionSet extraction | MV3 DOM access | Dropdown option lists in constraints |
| fieldKey derivation layer | P3 readiness | Machine-readable DataRequirement.field keys |
| Multi-element temporal patterns | O6 (R3 spec) | Complex behavioral patterns |

---

## 13. Intentionally Unresolved / Deferred Decisions

| Decision | Status | Reason |
|---|---|---|
| businessField = accessibleName (not identity.name) | Decided for Tier 1 | Consistent with all binding paths; no normalization needed; R4 owns cross-session identity |
| fieldKey layer (future camelCase keys) | Deferred to pre-P3 | Not needed for Tier 1; avoids premature normalization contract |
| Lifecycle confirmation model | Decided for Tier 2 (C7) | Consume endState from ComponentInteraction; recognize Phase 3 as authoritative |
| OptionSet extraction mechanism | Deferred (Tier 3) | Requires content-script bridge or capture-at-interaction-time; MV3 constraint |
| D3 (relatedElementIds computation) | Deferred (Tier 3) | R3 standalone path handles most cases; behavioral recognition for non-ARIA multi-element is edge case |
| enrichConfigurationSession → capability pipeline wiring | Not addressed | It feeds IR Bridge, not capability pipeline. May need wiring when component path is functional. |

---

## 14. Key Design Principles Confirmed Through Analysis

1. **Complete connections, don't redesign**: Data exists, capture works, enrichment logic is correct, capability derivation is sound, P2 binding is well-designed. They're just not connected.

2. **R4 owns cross-session identity**: businessField should not duplicate this. accessibleName as businessField is the simplest intra-session key.

3. **Phase 3 Component Runtime is authoritative**: Its classification (InteractionType, endState, evidence) is more sophisticated than the Phase 4/5 lifecycle model. Later layers should consume, not re-derive.

4. **Preserve information independently**: businessField and displayLabel both carry accessibleName in Tier 1 (redundant but forward-compatible). displayLabel ensures the real label survives a future fieldKey split.

5. **Constraints are foundational for P3**: minLength/maxLength → boundary tests, pattern → validation tests, min/max/step → boundary tests, options → validation tests. C3 unblocks all of them.

6. **Later layers consume and enrich, never re-derive or destroy**: Each boundary must preserve or add information. The domain adapter currently destroys it (sourceInteractionType lost, domAttributes empty, ancestorRoles truncated).

---

## 15. Git Repository State

- Branch `main` (local) = `origin/main` = `900a51e` (audit commit, pushed)
- `origin/master` = `5e9d75f` (R1, 18 commits behind main)
- `origin/feat/extension-phase0` = `3293fea` (orphan branch)
- Working tree: 69 golden-master snapshot files (timestamp/ID-only changes, harmless)
- 3241/3242 tests pass (1 pre-existing flaky: IndexedDB API missing)
