# MASTER HANDOVER — CmdRecorder AI Extension

> **Purpose:** Single comprehensive document for any new AI or developer to understand the entire project: vision, architecture, current state, broken connections, intentional boundaries, and deferred work. Every statement is traceable to authoritative design specs, frozen roadmap, code, or test evidence.
>
> **Date:** 2026-08-03  
> **Canonical Roadmap:** `.drytis/CANONICAL_ROADMAP.md` (frozen)  
> **Frozen Roadmap:** `.drytis/specs/FROZEN-ROADMAP.md`  
> **Test count:** 3,309 passing / 1 known-flaky JSDOM timing test

---

## Table of Contents

1. [The Vision](#1-the-vision)
2. [Architectural Evolution: Why the System Is What It Is](#2-architectural-evolution)
3. [Current Architecture: Module by Module](#3-current-architecture)
4. [Gen 1 Pipeline: What Works End-to-End](#4-gen-1-pipeline)
5. [Gen 2 Pipeline: Capability Model, P1, P2](#5-gen-2-pipeline)
6. [R1/R2/R3/R4: What Each Phase Did](#6-r1r2r3r4)
7. [P1/P2 Frozen Boundary](#7-p1p2-frozen-boundary)
8. [What Is Broken: Four Root Causes](#8-what-is-broken)
9. [What Is Intentional: Design Decisions Not to Undo](#9-what-is-intentional)
10. [Known Limitations](#10-known-limitations)
11. [Deferred and Future Work](#11-deferred-and-future-work)
12. [Authoritative Document Map](#12-authoritative-document-map)

---

## 1. The Vision

**Build a general-purpose semantic recorder that understands user capabilities and intent across diverse web applications, regardless of how those applications implement their interactions, and reliably produces the correct interaction in the side panel.**

This means:
- A checkbox implemented as `<a>` with CSS toggling must be understood as a toggle
- A custom slider built with `div` elements must be understood as a slider
- A novel interaction never seen before must degrade gracefully to the closest known type

The recorder is not a test recorder — it is a **semantic understanding engine**. It watches a human use a web app, understands business intent at the capability level, captures durable reusable knowledge, and generates executable test plans.

### Design Principle (Frozen)

> **The observation is immutable. The capability is versioned. The IR is disposable. The implementation is replaceable.**

*Source: CANONICAL_ROADMAP.md §10, CAPABILITY_MODEL.md §1*

---

## 2. Architectural Evolution

### The Amazon Failure (The Pivotal Event)

On Amazon.in, filter checkboxes (`<a class="s-navigation-item">` with inner `<i class="a-icon-checkbox">`) were classified as **Link** instead of **Checkbox**. The structural classifier saw `<a>` tag → Link. The behavioral effect (class transitioning `opt` → `opt selected`) was invisible because DOM capture fires *before* the page's own click handler runs.

**What it proved:** Structural/DOM attributes alone are insufficient for **classification** — determining *what type of interaction this is*. The system needed behavioral evidence (what happened *after* the click) to classify correctly.

*Source: .drytis/specs/checkbox-link-detection.md, docs/archive/pre-r3-architecture-specs/CMDRUNNER_ARCHITECTURAL_EVOLUTION.md*

### R1/R2/R3: The Behavioral Revolution

| Phase | What It Did | Commit |
|-------|------------|--------|
| **R1** (Foundation Cleanup) | Deleted ~3,837 lines of dormant V2 subsystem (dual-engine classification, Evidence Channels, Merge Layer, control-recorder). Unified to single capture path. | `5e9d75f` |
| **R2** (Slider Detection) | Added R2 slider geometry detection (CSS class regex, aria-value* capture). Noted as "last structural detection expansion." | `5a6f5d5` |
| **R3** (Behavioral Semantic Reasoning) | 4 behavioral evidence generators (value-change +0.6, panel-emergence +0.6/+0.5/+0.3, selection-state +0.5, slider-value +0.5). Annotation deferral: Click emits immediately but annotation deferred until attribute-change event arrives. Weight hierarchy: behavioral (+0.5-0.7) > structural (+0.1-0.4). | `1b2fa89` |

**Key insight:** R3 made classification behavioral-primary. The Amazon `<a>` filter toggle now classifies correctly: behavioral toggle signal (+0.5) overrides structural link signal (+0.4).

*Source: .drytis/specs/r1-foundation-cleanup.md, r2-slider-detection.md, r3-behavioral-semantic-reasoning.md*

### What Was Deleted

The old structural classification pipeline (deleted by R1):
- `src/pipeline/recognition/` — 12+ files that tried to classify from structural patterns alone
- `src/pipeline/channels/` — 5 evidence channels feeding structural data to classification
- `src/classifier/evidence/providers/` — DOM, ARIA, CSS classname, event sequence, mutation providers

These were all **classification systems** — they answered "what type of interaction is this?" using structure alone. R3's behavioral evidence voting replaced them.

### Critical Distinction: Classification vs Grouping

| Concern | Question | Layer | Mechanism | Status |
|---------|----------|-------|-----------|--------|
| **Classification** | "Is this a checkbox or a link?" | Component Runtime + evidence engine | R3 behavioral evidence voting | ✅ Works |
| **Grouping** | "Are these interactions part of one dropdown?" | Recognition orchestrator | Structural + behavioral patterns on domain entities | ❌ Starved of data |

The Amazon failure was a **classification** problem. R1/R2/R3 solved it. The recognition orchestrator addresses a **completely different problem**: grouping already-classified interactions into composite components. It never overrides classification.

---

## 3. Current Architecture

### Two Generations of Intelligence

```
═══════════════════════════════════════════════════════════════════════════
GENERATION 1: Smart Recorder Pipeline (WORKING, production-wired)
═══════════════════════════════════════════════════════════════════════════

  Content Script (has DOM access)
    │
    ├── EventTap (19 event types, capture-phase listeners)
    │     └── assembleObservedEvent: 18-field ElementIdentity, 30+ DomContext fields
    │     └── dom-context-extractor: ancestorRoles (10-level walk), ancestorClasses
    │     └── Post-click value polling (50ms/150ms/400ms)
    │     └── R3.4 attribute re-snapshot via setTimeout(0)
    │
    ├── ComponentRuntime (23 lifecycle definitions, priority 5-180)
    │     └── Evidence Engine: 10 generators (6 structural + 4 behavioral)
    │     └── R3 annotation deferral (Click held pending until attribute-change)
    │     └── RECLASSIFY_THRESHOLD=0.5, UNRECOGNIZED_THRESHOLD=0.3
    │     └── Output: ComponentInteraction[] with metadata.evidenceTrail
    │
    ├── IR Bridge (1,717 lines)
    │     └── Consumes ComponentInteraction[] DIRECTLY (bypasses domain adapter)
    │     └── Re-accesses original interactions for intent/evidenceTrail
    │     └── Handles configurationSession, subActions, modalSubActions
    │     └── Output: ExecutionIRPlan (NAVIGATE → FILL/SELECT/TOGGLE → VERIFY)
    │
    └── Playwright Code Generator
          └── ExecutionIRPlan → project files + page objects + assertions

═══════════════════════════════════════════════════════════════════════════
GENERATION 2: Capability Engine Pipeline (DISCONNECTED)
═══════════════════════════════════════════════════════════════════════════

  ComponentInteraction[]
    │
    ├── Domain Adapter V2 (domain-adapter-v2.ts)
    │     └── ComponentInteraction → ONE ObservedTransition per interaction
    │     └── Reads: type, trigger, memberEvents
    │     └── IGNORES: evidenceTrail, intent, confidence, subActions, cascadeEffects
    │     └── Output: DomainEntities (elements[], transitions[])
    │
    ├── Recognition Orchestrator
    │     └── Structural recognizer: 6 patterns (DROPDOWN, CHECKBOX, RADIO_GROUP, MODAL, TABS, ACCORDION)
    │     └── Behavioral recognizer: 9 signals (5 require MUTATION evidence — never produced)
    │     └── STARVED: ancestorRoles=[target], relatedElementIds=[]
    │     └── Output: ComponentGrouping[] (but componentId never assigned back to transitions)
    │
    ├── Enrichment Orchestrator (7-step)
    │     └── NoOp DomInspector (MV3: no DOM access) → optionSets always null
    │     └── BehavioralContract gated on CONFIRMED lifecycle state
    │     └── Output: ApplicationKnowledgeFragment (logicalActions, interactionContracts)
    │
    ├── Capability Deriver
    │     └── Fragment → CapabilityCandidate (name, purpose, inputs[])
    │     └── Input fields carry sourceInteractionType, constraints
    │     └── Output: CapabilityCandidate
    │
    ═══ P1 REVIEW GATE (human approval) ═══
    │     └── processDecision() → Capability + CapabilityVersion + P2CapabilityContract
    │
    ═══ P2 IR GENERATION (NOT PRODUCTION-WIRED) ═══
          └── generateCapabilityIR() — 8-step pipeline
          └── Zero production callers
```

### MV3 Boundary Constraint

The Chrome Extension uses Manifest V3. All processing runs in the service worker, which has **no DOM access**. The content script has DOM access but only during recording. This means:

- Structural context must be captured at observation time (content script) and carried through the pipeline
- No on-demand DOM queries is possible at analysis/enrichment time
- The design's `DomInspector` interface (designed for real DOM queries) is `NoOp` in production

*Source: pipeline-runner.ts:67-72, STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md (archived)*

---

## 4. Gen 1 Pipeline: What Works End-to-End

### Interaction Type Status (E2E Verified)

| Type | Capture | Classification | Recognition | IR Bridge | Side Panel | Status |
|------|---------|---------------|-------------|-----------|------------|--------|
| TextEntry | ✅ | ✅ | N/A (standalone) | ✅ | ✅ | ✅ |
| Click | ✅ | ✅ | ✅ (Modal/Tabs if role) | ✅ | ✅ | ✅ |
| Checkbox | ✅ | ✅ | ✅ (confirmed) | ✅ | ✅ | ✅ |
| RadioButton | ✅ | ✅ | ❌ (ancestor + op mismatch) | ⚠️ standalone | ⚠️ | ⚠️ |
| Native Dropdown | ✅ | ✅ | ❌ (minConstituents) | ✅ standalone | ⚠️ | ⚠️ |
| Custom Dropdown | ✅ | ✅ | ❌ (minConstituents) | ✅ standalone | ⚠️ | ⚠️ |
| DatePicker | ✅ | ⚠️ fallback | ❌ (no pattern) | ✅ standalone | ⚠️ | ⚠️ |
| Slider | ✅ | ✅ (R2) | ❌ (no pattern) | ✅ standalone | ⚠️ | ⚠️ |
| Hover | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Scroll | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Navigation | ✅ | ✅ | N/A | ✅ | ✅ | ✅ |
| Tabs | ✅ | ⚠️ Click | ❌ (ancestor) | ✅ standalone | ⚠️ | ⚠️ |
| Autocomplete | ✅ | ⚠️ | ❌ | ✅ standalone | ⚠️ | ⚠️ |
| Drag/Drop | ✅ | ❌ (Click) | ❌ (no pattern) | ❌ wrong step | ❌ | ❌ |
| Novel | ✅ | ⚠️ Click fallback | N/A | ⚠️ generic | ⚠️ | ⚠️ |

*Source: tests/gen1-e2e-verification.test.ts (48 tests, 5 domains), .drytis/audits/06-gen1-e2e-verification.md*

### What's Verified Working

1. **Event capture** — 19 event types, 18-field ElementIdentity, 30+ DomContext fields, SPA deferred blur, post-click value polling, R3.4 attribute re-snapshot
2. **Component Runtime classification** — 23 lifecycle definitions, R2 slider geometry, R3 behavioral evidence, annotation deferral, weight calibration (behavioral > structural)
3. **IR Bridge** — ComponentInteraction[] → Playwright code for all standalone interactions (FILL, CLICK, SELECT, TOGGLE, HOVER, SCROLL, NAVIGATE)
4. **Side Panel** — Live timeline, stopped view, replay JSON, IR steps, Playwright files, capability review cards
5. **Golden Master** — 68 fixtures validating type equivalence and IR plan deep equality across the unified path

*Source: CANONICAL_ROADMAP.md §1, tests/golden-master/*

---

## 5. Gen 2 Pipeline: Capability Model, P1, P2

### Four-Layer Architecture

```
Layer 1: OBSERVATION     ComponentInteraction[]    Immutable
Layer 2: CAPABILITY       Capability                Versioned (human-curated, auditable)
Layer 3: EXECUTION        ExecutionIRPlan           Disposable (regenerable)
Layer 4: IMPLEMENTATION   Playwright code           Disposable
```

**Core principle:** Capability is not disposable. Once approved, it has its own identity: named, versioned, associated with execution runs. You can regenerate IR from a Capability, but you cannot regenerate the Capability — it's a human-curated business artifact.

*Source: .drytis/CAPABILITY_MODEL.md §1*

### P1 Capability Lifecycle (Built)

| Component | Purpose | Status |
|-----------|---------|--------|
| `deriveCapability()` | Fragment → CapabilityCandidate | ✅ Built |
| `matchCapability()` | Match candidate against existing inventory | ✅ Built |
| `createReview()` | Create CapabilityReview for user approval | ✅ Built |
| `processDecision()` | APPROVE → Capability + CapabilityVersion + P2CapabilityContract | ✅ Built |
| Reviewer edits UI | Human edits before approval | ❌ Not built (UX enhancement) |

**P1 intentionally does NOT:** re-classify interactions, generate test code, execute tests, auto-approve (human review is the point).

*Source: .drytis/specs/p1-capability-lifecycle-management.md*

### P2 IR Generation (Built, NOT Production-Wired)

P2 generates disposable ExecutionIRPlan from a frozen P2CapabilityContract via an 8-step pipeline:

1. Recover RecordingSession via `contract.sourceSessionId`
2. Load stored Elements from Repository
3. **ElementBindingResolver** — `DataRequirement.field` → session elementId (cascade: businessField → componentId → rootElementId → elementId)
4. **Full Identity Recovery** — 18-field ElementIdentity from `session.rawInteractions`
5. **R4 Element Matching** — `matchElements(freshElements, storedElements)` → MATCHED/AMBIGUOUS/UNMATCHED
6. **DataResolver** — validate TestData against DataRequirement constraints
7. **IRActionMapper** — `inputMethod` → IRAction (dropdown→SELECT, toggle→TOGGLE, slider→FILL, text→FILL, datePicker→SELECT_DATE)
8. **SuccessCriterionResolver** → IRAssertion[]

Assembles: NAVIGATE → FILL/SELECT/TOGGLE per requirement → VERIFY

**Critical: `generateCapabilityIR()` has zero production callers.** P2 is built and validated (7 e2e scenarios) but not wired into any production flow.

**P2 intentionally does NOT:** generate test data (P3), execute (P4/P5), resolve ambiguity (surfaces for human resolution), cross-environment resolution.

*Source: .drytis/specs/p2-capability-derived-ir-generation.md, src/recorder/p2/capability-ir-generator.ts*

---

## 6. R1/R2/R3/R4

### R1: Foundation Cleanup
- Deleted dormant V2 subsystem (3,837 lines): control-recorder.ts, control-model.ts, legacy domain adapter, evidence channels, merge layer
- Unified to single capture path through Component Runtime
- Salvaged MutationObserver pattern for R3.4

*Source: .drytis/specs/r1-foundation-cleanup.md, commit 5e9d75f*

### R2: Slider Detection
- CSS class regex patterns for custom slider detection
- Aria-value* attribute capture (ariaValueMin/Max/Now)
- Explicitly noted as "last structural detection expansion" — R3 handles sliders with zero structural signals

*Source: .drytis/specs/r2-slider-detection.md, commit 5a6f5d5*

### R3: Behavioral Semantic Reasoning
- **4 behavioral generators:**
  - `value-change` (+0.6): observed value transition after interaction
  - `panel-emergence` (+0.6 container / +0.5 popup / +0.3 sibling): new element appears after click
  - `selection-state` (+0.5): checked/selected attribute changes
  - `slider-value` (+0.5): numeric value transitions on slider-like elements
- **Annotation deferral:** Click emits immediately but annotation deferred until attribute-change event arrives from setTimeout(0) re-snapshot. Lifecycle deferral was rejected because it "broke 23 test files."
- **Weight hierarchy:** Standards (ARIA) 0.7-0.9, Behavioral 0.5-0.7, Structural 0.1-0.4

*Source: .drytis/specs/r3-behavioral-semantic-reasoning.md, commit 1b2fa89*

### R4: Element Identity Matching
- **8 independent scoring dimensions** for cross-session element reconciliation:
  - BUSINESS_IDS (0.25) — name, testId, dataCy, dataQa
  - ACCESSIBLE_NAME (0.20) — accessibleName/ariaLabel
  - FORM_NAME (0.15) — HTML name attribute
  - ARIA_ROLE (0.10) — ariaRole
  - ARIA_LABEL (0.10) — aria-label
  - ANCESTOR_ROLES (0.10) — ancestor role chain
  - TAG (0.05) — HTML tag
  - PAGE_SCOPE (0.05) — element position relative to page
- **MATCH_THRESHOLD=0.70, MIN_MARGIN=0.05**
- **Three-category result:** MATCHED (≥0.70 + margin), AMBIGUOUS (≥0.70 but tied), UNMATCHED (<0.70)
- Excluded fields: `placeholder` (transient), `stableId` (auto-generated IDs risk false matches)

*Source: .drytis/specs/r4-element-identity-matching-foundation.md, commit b4d558a (frozen)*

---

## 7. P1/P2 Frozen Boundary

### The Intermediate Layer: P2CapabilityContract

A deliberately minimal, immutable, read-only interface (`src/domain/entities/p2-capability-contract.ts:23-47`):

```typescript
interface P2CapabilityContract {
  readonly capabilityId: string;
  readonly versionNumber: number;
  readonly versionId: string;            // immutable reference for reproducibility
  readonly name: string;
  readonly purpose: string;
  readonly dataRequirements: DataRequirement[];
  readonly successCriteria: SuccessCriterion[];
  readonly entryPoint: { readonly url: string; readonly elementName: string | null };
  readonly sourceSessionId: string;      // provenance → original recording
  readonly approvedAt: string;
}
```

**Why it exists:** Sits at the seam between Layer 2 (Capability, versioned/human-curated) and Layer 3 (ExecutionIRPlan, disposable/regenerable). Prevents P2 from reading `CapabilityCandidate` (pre-approval) or full `Capability` entity (15+ internal fields). Only 8 fields — exactly what P2 needs.

### The `inputMethod` Bridge

The single most important field enabling the boundary. `DataRequirement.inputMethod` is an orthogonal field to `kind`:
- `kind` = "what data?" (text, number, boolean, select, email, date)
- `inputMethod` = "how is it operated?" (text, dropdown, toggle, slider, datePicker, fileUpload)

Mapping chain: `InteractionType` (23 types) → `sourceInteractionType` → `INTERACTION_TYPE_TO_INPUT_METHOD` (coarser taxonomy) → `inputMethodToIRAction` (IR step type)

New InteractionTypes can extend the map without breaking existing approved contracts (INV-P1-B6).

*Source: .drytis/CAPABILITY_MODEL.md, .drytis/specs/p1-capability-lifecycle-management.md, .drytis/specs/p2-capability-derived-ir-generation.md*

---

## 8. What Is Broken: Four Root Causes

All Gen 1 recognition/enrichment failures trace to **four root causes**, not independent bugs.

### Root Cause 1: Pipeline runner discards captured structural context

Ancestor roles ARE captured (dom-context-extractor.ts walks 10 ancestors). Component definitions DO use them. Domain adapter DOES preserve them on UiElement.ancestorRoles. But `pipeline-runner.ts:109` passes `ancestorRoles: [roleInfo]` (target only) — the full chain is discarded. The string[] → ElementRoleInfo[] conversion was never implemented.

Sibling elements are never captured at any layer (no code walks `el.parentElement.children`).

**Causes:** D-R1 (ancestor truncation), D-R2 (relatedElementIds empty), D-R-DROPDOWN (minConstituents unmet)

### Root Cause 2: Domain adapter collapses multi-step interactions into single transitions

Component Runtime produces ONE ComponentInteraction per interaction with `metadata.subActions[]` (structured per-step data: dropdown trigger click → option selection). Domain adapter ignores subActions entirely, produces ONE transition.

The adapter also loses ALL R3 evidence:
- `evidenceTrail` (IntentVote[]) — never read
- `intent`, `confidence` — never read
- `buildEvidence` only produces VALUE_CHANGE/STATE_CHANGE/NAVIGATION — never MUTATION/CLASS_CHANGE
- `cascadeEffects` always empty

This blinds 5 of 9 behavioral signals (popup visibility, modal appearance, popup closure, sibling value changes, clickable children).

**Causes:** D-R4 (multi-op lifecycles), D-A1 (Slider→click), D-A-RadioButton (toggle vs select), R3 evidence flow broken

### Root Cause 3: Recognition results never feed back to transitions

`assignTransitionToComponent()` exists at `observed-transition.ts:235` but has **zero call sites** in the entire codebase. The recognition orchestrator calls `registry.addTransition()` (updates component's reference) but never sets `componentId` on the transition.

Result: Enrichment's `transitions.filter(t => t.componentId === component.groupingId)` → always empty. ALL transitions become standalone regardless of recognition.

**Causes:** D-R5 (componentId null), D-E2 (contracts empty)

### Root Cause 4: NoOp DomInspector (MV3 constraint)

MV3 service worker has no DOM access. `pipeline-runner.ts:67` creates NoOp. OptionSet extraction always returns null.

This is an **architectural constraint**, not a bug. The fix should follow the Amazon lesson: capture structural context at observation time, not query at analysis time.

**Causes:** D-E1 (optionSets null)

### Root Cause → Disconnect Mapping

| Disconnect | RC1 | RC2 | RC3 | RC4 |
|---|---|---|---|---|
| D-R1: ancestorRoles truncated | ✅ | | | |
| D-R2: relatedElementIds empty | ✅ | | | |
| D-R-DROPDOWN: minConstituents | ✅ | | | ✅ |
| D-R4: multi-op lifecycles | | ✅ | | |
| D-R5: componentId null | | | ✅ | |
| D-A1: Slider→click | | ✅ | | |
| D-A-RadioButton: toggle vs select | | ✅ | | |
| D-E1: optionSets null | | | | ✅ |
| D-E2: contracts empty | | | ✅ | |
| R3 evidence flow broken | | ✅ | | |

*Source: .drytis/audits/07-gen1-root-cause-analysis.md, .drytis/audits/08-amazon-evolution-reassessment.md*

### Proposed Fixes (Not Yet Implemented)

| Fix | Root Cause | What | Complexity |
|-----|-----------|------|-----------|
| Fix 1 | RC1 | Bridge UiElement.ancestorRoles to recognition (convert string[] → ElementRoleInfo[]) | Low |
| Fix 2 | RC1 | Capture sibling roles at observation time | Medium |
| Fix 3 | RC2 | Expand subActions → multiple transitions | Medium |
| Fix 4 | RC2 | Fix operation mappings (RadioButton→SELECT, Slider→SLIDE) | Low |
| Fix 5 | RC2 | Map R3 evidenceTrail → TransitionEvidence (produce MUTATION) | Medium-High |
| Fix 6 | RC3 | Wire componentId assignment (call existing function) | Low |
| Fix 7 | RC4 | Derive optionSets from captured subActions | Medium |

**Minimum viable path:** Fix 1 + Fix 6 → ancestor patterns recognized + enrichment partitioned correctly  
**Full recognition restoration:** Fix 1 + Fix 2 + Fix 3 + Fix 4 + Fix 6

*Source: .drytis/audits/07-gen1-root-cause-analysis.md*

---

## 9. What Is Intentional: Design Decisions Not to Undo

| Decision | Rationale |
|---|---|
| Behavioral > structural for **classification** | Amazon proved structural-only insufficient. Weight calibration: behavioral +0.5-0.7 > structural +0.1-0.4. R3. |
| Annotation deferral (not lifecycle deferral) | Lifecycle deferral "broke 23 test files." Click emits immediately; annotation deferred until attribute-change arrives via setTimeout(0). |
| Structural recognizer runs AFTER classification | It groups already-typed interactions, never overrides Component Runtime classification. Two-tier: structural first (ARIA), behavioral fallback (custom). |
| NoOp DomInspector | MV3 service worker has no DOM access. Fix should capture-at-observation, not restore DOM queries. |
| Deletion of old structural classification pipeline | R1 eliminated V2 (3,837 lines) that classified from structure alone. Correct decision. |
| No continuous MutationObserver | Performance risk. Short-window re-snapshot is sufficient. "Never (architectural decision)." |
| No visual appearance inference | Different signal class. "Never (architectural decision)." |
| P1 does not re-classify/generate/execute/auto-approve | Human review is the point. |
| P2 does not generate test data/execute/resolve ambiguity | P3/P4 scope. |
| P2CapabilityContract is immutable and minimal | Decouples P1 (versioned) from P2 (disposable). Only 8 fields. |
| R4 exact-match only (no fuzzy) | AMBIGUOUS preserved for future resolution. Never guessed. |

*Source: .drytis/audits/08-amazon-evolution-reassessment.md, CANONICAL_ROADMAP.md §2*

---

## 10. Known Limitations

| Limitation | Impact | Source |
|---|---|---|
| Golden master validates consistency, not correctness | If OLD path was wrong, both consistently wrong. No golden test runs full recording → P2. | tests/golden-master/ |
| Tests use FixtureDomInspector mocks | Masks production defects (NoOp DomInspector) | Test infrastructure |
| UiElementSummary (8 fields) insufficient for matching | Full identity always recovered from rawInteractions | P2 spec §18 |
| rawEvents fallback lacks ancestorRoles | ANCESTOR_ROLES dimension scores neutral in R4 | P2 spec §18 |
| Success criterion locator is string label | Matched as accessibleName only | P2 spec §18 |
| No cross-environment resolution | Current project's Element Repository only | P2 spec §18 |
| R4: placeholder/stableId excluded | Transient/auto-generated — risk false matches | R4 spec |
| Multi-element temporal patterns deferred | O6 (optional) — requires correlating multiple interactions | R3 spec §11 |
| Confidence calibration not empirically tuned | Behavioral weights are design-time estimates | R3 spec §11 |

*Source: .drytis/audits/09-old-ai-known-state-inventory.md*

---

## 11. Deferred and Future Work

### Platform Phases NOT STARTED

| Phase | Description |
|-------|-------------|
| P3 | AI Test Generation (TestGenerationEngine, PromptBuilder, TestCaseFactory) |
| P4 | Enhanced Execution (RetryHandler, WaitStrategyHandler, EvidenceCaptureService) |
| P5 | Playwright Execution |
| P6 | AI Failure Analysis |
| P7-P9 | Cross-Platform |

### Gen 1 Semantic Path Fixes (Proposed, Not Implemented)

Fixes 1-7 (see §8 above). Follow the capture-at-observation principle.

### Missing Pattern Definitions

Slider, DatePicker, FileUpload, DragDrop, Autocomplete (no patterns registered for these).

### Permanently Dropped

Cross-tab recording (MV3 limits), visual regression (different scope), parallel execution (depends on engine), Appium adapter (no demand).

*Source: CANONICAL_ROADMAP.md §3-4, .drytis/audits/09-old-ai-known-state-inventory.md*

---

## 12. Authoritative Document Map

### Primary Authoritative Documents (Read These First)

| Document | Location | Content |
|----------|----------|---------|
| **THIS DOCUMENT** | `MASTER-HANDOVER.md` | Complete project overview, current state, known issues |
| **CANONICAL_ROADMAP.md** | `.drytis/CANONICAL_ROADMAP.md` | Frozen architectural decisions, phase history, design principles |
| **FROZEN-ROADMAP.md** | `.drytis/specs/FROZEN-ROADMAP.md` | Frozen phase ordering and architectural decisions |
| **r1/r2/r3 specs** | `.drytis/specs/r1-*.md` etc. | Implemented phases (classification architecture) |
| **r4 spec** | `.drytis/specs/r4-*.md` | Element identity matching (design frozen, implemented) |
| **P1 spec** | `.drytis/specs/p1-*.md` | Capability lifecycle (implemented) |
| **P2 spec** | `.drytis/specs/p2-*.md` | Capability-derived IR generation (implemented, not production-wired) |

### Reference Documents (Still Valid)

| Document | Location | Content |
|----------|----------|---------|
| CAPABILITY_MODEL.md | `.drytis/` | Four-layer architecture, capability as domain center |
| PLATFORM_EXECUTION_ARCHITECTURE.md | `.drytis/` | Execution platform vision (P3-P6) |
| INTERACTION_TAXONOMY.md | `.drytis/` | 96 variants across 16 categories (framework-agnostic) |
| SEMANTIC_INTERACTION_BOUNDARY.md | `.drytis/` | Immutable observation vs projections (principle valid, type superseded) |
| patterns.md | `.drytis/` | UI pattern catalogue reference |
| RECORDER_CERTIFICATION_FRAMEWORK.md | `.drytis/` | Interaction certification taxonomy (S1-S10, T1-T5, etc.) |

### Audit Documents (Current Session Findings)

| Document | Location | Content |
|----------|----------|---------|
| 01-architecture-understanding.md | `.drytis/audits/` | Layer-by-layer architecture map |
| 02-semantic-preservation-audit.md | `.drytis/audits/` | Semantic preservation analysis |
| 03-confirmed-defects.md | `.drytis/audits/` | 7 confirmed defects with evidence |
| 04-git-audit-report.md | `.drytis/audits/` | Git history and branch state |
| 05-gen1-end-to-end-map.md | `.drytis/audits/` | 9-layer Gen 1 pipeline map |
| 06-gen1-e2e-verification.md | `.drytis/audits/` | 48 E2E tests across 5 domains |
| 07-gen1-root-cause-analysis.md | `.drytis/audits/` | 4 root causes behind 11 disconnects |
| 08-amazon-evolution-reassessment.md | `.drytis/audits/` | Broken connections vs intentional decisions |
| 09-old-ai-known-state-inventory.md | `.drytis/audits/` | Complete inventory of known state |

### Archived Documents (Historical Only — Do Not Use for Current Architecture)

All documents in `docs/archive/` describe pre-R1/R2/R3 architecture. They are preserved as historical record but are NOT authoritative for current implementation guidance.

| Archive Directory | Contents |
|-------------------|----------|
| `docs/archive/pre-r1-architecture/` | 19 design docs from V1/V2 dual-engine era |
| `docs/archive/pre-r3-handover/` | 15 handover docs frozen at pre-R1 state |
| `docs/archive/pre-r3-phase-specs/` | 202 phase/milestone/feature specs |
| `docs/archive/pre-r3-architecture-specs/` | 18 architecture validation docs |
| `docs/archive/pre-r3-domain-planning/` | 9 initial domain planning docs |
| `docs/archive/pre-r3-architecture/` | 6 transitional design docs |

---

*This document is the single entry point for understanding the CmdRecorder AI Extension project. Read it first. Then consult specific authoritative docs and code for implementation details.*
