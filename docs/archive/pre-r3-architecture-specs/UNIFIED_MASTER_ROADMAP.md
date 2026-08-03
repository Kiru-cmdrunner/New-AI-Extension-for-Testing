# CmdRunner Platform — Unified Master Roadmap

**Document type:** Authoritative implementation roadmap — the ONLY roadmap used for future development
**Date:** July 2026
**Base commit:** `f3acfbf` (master HEAD, evolved from validated `7bfd949` baseline)
**Runtime baseline:** Verified — see `docs/architecture/RUNTIME_BASELINE_VALIDATION.md`
**Governing principle:** Every phase leaves the product in a working, releasable state. No temporary architectures. No parallel systems that will be removed. Every phase delivers user-visible value or verified internal improvement.

---

## Supersession Notice

This document **supersedes and reconciles**:
- `.drytis/IMPLEMENTATION_ROADMAP.md` (strategic 11-phase roadmap)
- `docs/architecture/IMPLEMENTATION_BASELINE.md` §4 (operational Phase 0-4)

Those documents remain as historical references and architectural context. **All phase definitions, sequencing, acceptance criteria, and dependencies in this document are authoritative.** Where the two source documents conflict, this document prevails.

---

## Table of Contents

1. [Governing Principles](#1-governing-principles)
2. [Current State](#2-current-state)
3. [Roadmap Overview](#3-roadmap-overview)
4. [Pre-Work: Adani One Fix Verification](#pre-work-adani-one-fix-verification)
5. [Phase 0: Pipeline Foundation](#phase-0-pipeline-foundation)
   - [Phase 0a: Dead Code Removal & Flag Elimination](#phase-0a-dead-code-removal--flag-elimination)
   - [Phase 0b: Type Unification](#phase-0b-type-unification)
   - [Phase 0c: Classifier Consolidation](#phase-0c-classifier-consolidation)
   - [Phase 0d: SemanticInteraction Materialization](#phase-0d-semanticinteraction-materialization)
   - [Phase 0e: Structural Semantic Enrichment](#phase-0e-structural-semantic-enrichment)
6. [Phase 1: Persistent Semantic Layer](#phase-1-persistent-semantic-layer)
7. [Phase 2: Capability Adoption Lifecycle](#phase-2-capability-adoption-lifecycle)
8. [Phase 3: Capability-Derived IR Generation](#phase-3-capability-derived-ir-generation)
9. [Phase 4: AI Test Generation Engine](#phase-4-ai-test-generation-engine)
10. [Phase 5: Enhanced Execution Engine](#phase-5-enhanced-execution-engine)
11. [Phase 6: Multi-Engine Execution — Playwright](#phase-6-multi-engine-execution--playwright)
12. [Phase 7: AI Failure Analysis & Enhanced Self-Healing](#phase-7-ai-failure-analysis--enhanced-self-healing)
13. [Phase 8: Cross-Platform Capture & Execution Foundation](#phase-8-cross-platform-capture--execution-foundation)
14. [Phase 9: Platform Expansion — Mobile & API](#phase-9-platform-expansion--mobile--api)
15. [Phase 10: Continuous Learning & Platform Intelligence](#phase-10-continuous-learning--platform-intelligence)
16. [Dependency Graph](#dependency-graph)
17. [Phase Gate Summary](#phase-gate-summary)
18. [Frozen Contract Summary](#frozen-contract-summary)
19. [Milestones](#milestones)
20. [Debt-Free Guarantee](#debt-free-guarantee)
21. [Cross-References](#cross-references)

---

## 1. Governing Principles

### 1.1 The Observation Is Immutable, The Capability Is Versioned, The IR Is Disposable, The Implementation Is Replaceable

Every phase respects this separation. No phase pollutes the observation with consumer concerns. No phase makes the IR non-disposable. No phase couples the capability to a specific execution engine.

### 1.2 No Parallel Systems

Phase 0 explicitly eliminates ALL existing parallel pipelines:
- Dead code that loads but doesn't run (control-recorder.ts, deterministic-recorder.ts)
- Dual type systems bridged by `as any` casts (ObservedEvent vs RecordedEvent)
- Dual classifiers with a merge layer (V1 detectInteractions + V2 detectInteractionsV2 + mergeV1V2)
- The misleading `recorderEngine` feature flag

After Phase 0, every new component is additive — it implements an existing interface or extends an existing type.

### 1.3 Every Phase Is Independently Verifiable

Each phase has explicit acceptance criteria with binary pass/fail outcomes. A phase is only complete when ALL criteria pass AND the existing test suite remains green.

### 1.4 Simplify Before Adding

Phase 0 removes before it adds. Dead code, broken flags, and parallel type systems are eliminated before the SemanticInteraction contract is materialized. This makes the contract promotion a clean type change rather than a complex refactor across multiple parallel systems.

### 1.5 Verify Before Refactoring

Pre-work verifies the Adani One detection fixes on the real site before any type system changes. If surface-anchored detection doesn't work in practice, we need to know before freezing the SemanticInteraction contract that depends on it.

---

## 2. Current State

### Verified Runtime Baseline

The runtime baseline validation (`docs/architecture/RUNTIME_BASELINE_VALIDATION.md`) confirmed the active execution path:

```
recorder-entry.ts → EventTap → OBSERVED_EVENT → Component Runtime (live streaming)
  → STOP → V1 detectInteractions() + V2 detectInteractionsV2() + mergeV1V2()
  → reasonAboutInteractions() → runPipeline() → buildIRPlan()
  → PlaywrightCodeGenerator → persistSession → healFromRecording
```

### Active Pipeline

| Component | File(s) | Status |
|-----------|---------|--------|
| EventTap + Identity Extraction | `src/tap/event-tap.ts`, `src/tap/identity-extractor.ts` | ✅ Active |
| DOM Context + Surface Detection | `src/definitions/dom-context-extractor.ts` | ✅ Active |
| Component Runtime (13 definitions) | `src/runtime/component-runtime.ts`, `src/definitions/` | ✅ Active |
| V1 Classifier | `src/classifier/interaction-detector.ts` | ✅ Active |
| V2 Evidence Engine | `src/classifier/evidence/detector.ts` | ✅ Active |
| V1+V2 Merge Layer | `src/classifier/evidence/merge-layer.ts` | ✅ Active |
| Semantic Reasoner (5 session types) | `src/classifier/semantic/` | ✅ Active |
| Recognition + Enrichment Pipeline | `src/recorder/pipeline/` | ✅ Active |
| IR Bridge | `src/generation/ir-bridge.ts` | ✅ Active |
| Playwright Code Generator | `src/adapters/playwright/` | ✅ Active |
| Repository V2 (Dexie) | `src/repository/v2/` | ✅ Active |
| Healing Service | `src/repository/services/healing-service.ts` | ✅ Active |
| Side Panel UI | `src/sidepanel/` | ✅ Active |
| IR Executor (Chrome) | `src/execution/ir-executor-impl.ts` | ✅ Active |

### Documented Debt (Eliminated in Phase 0)

| Debt Item | Root Cause | Phase 0 Sub-phase |
|-----------|------------|---------------------|
| `control-recorder.ts` loaded on every page (12 dormant listeners) | Manifest entry at `manifest.json:37`; `recorderEngine` flag defaults to `'legacy'` | 0a |
| `RECORDED_EVENT` silently dropped by SW | SW message switch has no handler for `RECORDED_EVENT` | 0a |
| `deterministic-recorder.ts` (3079 lines, orphaned) | Not in manifest, never injected | 0a |
| `src/pipeline/` (34 files), `src/types/` (8 files) | Blueprint architecture, zero external imports | 0a |
| `toIRActions` dead import | Imported at SW:57, 0 call sites | 0a |
| `recorderEngine` feature flag | Misleading name, broken Control Engine branch | 0a |
| `as any` adapter shim (SW:287-308) | ObservedEvent → RecordedEvent type bridge | 0b |
| Dual `DomContext` type | `component-types.ts` vs `recorded-event.ts` | 0b |
| Dual `InteractionType` enum | `component-types.ts` (13 values) vs `interaction-types.ts` (45 values) | 0b |
| V1+V2 dual classifier + merge layer | Two classifiers with merge layer producing one output | 0c |
| A/B comparison dev logging | `compareClassifierOutputs` + `logComparisonResult` | 0c |
| `SemanticInteraction` stub (4 fields) | Not materialized as full 22-field observation contract | 0d |

### Existing Frozen Contracts (Already Implemented)

| Contract | Location | Status |
|----------|----------|--------|
| ExecutionIRPlan / IRStep / IRAction | `src/domain/execution-ir/types.ts` | Frozen — 10 actions, self-contained steps |
| IRExecutor interface | `src/domain/execution-ir/adapters/ir-executor.ts` | Frozen |
| IRCodeGenerator interface | `src/domain/execution-ir/adapters/ir-code-generator.ts` | Frozen |
| LocatorStrategyType enum | `src/domain/enums.ts` | 8 DOM locator types |
| Locator ranking (shared spine) | `src/domain/locator-ranking.ts` | 5-category priority system |
| Capability entity | `src/domain/entities/capability.ts` | Enrichment model, append-only history |
| Element entity | `src/domain/entities/element.ts` | healHistory, locatorStrategies |
| ApprovedTestCase / TestCaseVersion | `src/domain/entities/approved-test-case.ts` | Versioned, step-based |
| ExecutionRun entity | `src/domain/entities/execution-run.ts` | Append-only, per-step results |
| Repository V2 (9 interfaces) | `src/repository/v2/interfaces/` | Dexie/IndexedDB implementation |

---

## 3. Roadmap Overview

### Three Tracks That Converge

```
PRE-WORK
  │  Adani One fix verification + characterization tests
  │
  ▼
PHASE 0: PIPELINE FOUNDATION
  │  0a: Dead code removal          ─── gate ──→
  │  0b: Type unification           ─── gate ──→
  │  0c: Classifier consolidation  ─── gate ──→
  │  0d: SemanticInteraction        ─── gate ──→
  │  0e: Structural Semantic         ─── gate ──→
  │
  ├──────────────────────────────────────┐
  ▼                                      ▼
CRITICAL PATH TRACK                    EXECUTION RELIABILITY TRACK
  Phase 1: Persistent Semantic Layer      Phase 5: Enhanced Execution
  Phase 2: Capability Adoption           Phase 6: Playwright Executor
  Phase 3: Capability-Derived IR         Phase 7: AI Failure Analysis
  Phase 4: AI Test Generation            │
  │                                      ▼
  │                               CROSS-PLATFORM TRACK
  │                                      Phase 8: Capture Foundation
  │                                      Phase 9: Mobile & API
  │                                      │
  └──────────────┬───────────────────────┘
                 ▼
          CONVERGENCE
    Phase 10: Continuous Learning
```

### Phase Summary

| Phase | Track | Objective | Dependencies |
|-------|-------|-----------|-------------|
| Pre-work | — | Verify Adani One fixes + write characterization tests | None |
| 0a | Foundation | Remove all dead code, broken flags, dormant pipelines | Pre-work |
| 0b | Foundation | Unify dual type systems, eliminate `as any` casts | 0a |
| 0c | Foundation | Merge V1+V2 classifiers into one, eliminate merge layer | 0b |
| 0d | Foundation | Materialize 22-field SemanticInteraction, rewire pipeline | 0c |
| 1 | Critical Path | Make SemanticInteraction persistent + queryable | 0d |
| 2 | Critical Path | Capability review, versioning, relations, matching | 1 |
| 3 | Critical Path | Generate IR from capabilities (not just recordings) | 2 |
| 4 | Critical Path | LLM-powered test variant generation | 3 |
| 5 | Execution | Retry, wait strategies, evidence capture, test suites | 0d |
| 6 | Execution | Playwright executor (first non-Chrome engine) | 5 |
| 7 | Execution | AI root-cause analysis + AI-assisted healing | 4, 6 |
| 8 | Cross-Platform | CaptureAdapter interface, type expansions | 7 |
| 9 | Cross-Platform | Appium mobile capture/execution + API testing | 8 |
| 10 | Convergence | Coverage analysis, impact analysis, continuous learning | 4, 7, 9 |

### Phase Gate Policy

A **phase gate** is a hard checkpoint. The next phase may NOT begin until the gate is passed. Gates are verified by:
1. All acceptance criteria for the phase pass (binary check).
2. The full existing test suite passes (no regressions).
3. A recording + execution cycle on a real SPA produces correct output.
4. The frozen contracts for that phase are documented and marked frozen.

Gates are not advisory. A phase with a single failing criterion blocks all downstream phases on its track.

---

## Pre-Work: Adani One Fix Verification

### Objective

Verify the 8 existing detection fixes (Issues 1-8 from `IMPLEMENTATION_BASELINE.md` §6) work correctly on the real Adani One site. Write characterization tests that capture the current pipeline's IR output for 10 diverse interactions — these tests become the regression baseline for Phase 0.

### Why This Must Come Before Phase 0

The ARCHITECTURAL_EVOLUTION document's Decision 4 states: "detection fixes should be done as Phase 0 pre-work to validate the session model before freezing SemanticInteraction." The fixes are already coded and committed (status 🟡 Implemented) but never verified on the real site.

The ROADMAP's Phase 0 acceptance criteria includes "Recording on Adani One produces correct semantic interactions." This criterion cannot pass if the detection is broken. We must verify before refactoring.

### Work Items

| Item | Detail |
|------|--------|
| Verify Issue 1: SVG chevron → trigger button | Record on Adani One, confirm click resolves to the trigger button, not the SVG icon |
| Verify Issue 2: Surface evidence propagation | Record on Adani One, confirm `domContext.surfaceType` is populated when popover opens |
| Verify Issue 3: multiConfig activation | Record passenger/class selector, confirm multiConfig session activates |
| Verify Issue 4: Internal click absorption | Record +/- buttons and cabin class toggles, confirm they're absorbed |
| Verify Issue 5: Stepper detection | Record icon-only +/- buttons, confirm classified as Increase/Decrease |
| Verify Issue 6: Date picker single capture | Record departure date selection, confirm one interaction, not two |
| Investigate Issue 7: "Cheapest" button not captured | Debug with live recording — determine root cause and fix if needed |
| Verify Issue 8: Semantic output completeness | Confirm the semantic interaction includes both dropdown selection AND stepper increments |
| Write characterization tests | Record 10 diverse interactions (click, text entry, dropdown, date picker, checkbox, radio, navigation, scroll, hover, form submit). Capture the exact IR output. Store as baseline regression tests. |

### Acceptance Criteria

- [ ] Issues 1-6 and 8 verified working on Adani One (status → 🟢 Verified)
- [ ] Issue 7 root-caused and fixed or documented as out-of-scope
- [ ] Characterization tests written: 10 interactions, IR output captured as baseline
- [ ] All existing tests pass
- [ ] Characterization test suite passes against current code

### Phase Gate

**GATE: Pre-work → Phase 0a**
- All 8 Adani One issues verified or documented
- Characterization test suite exists and passes
- No regressions in existing test suite

---

## Phase 0: Pipeline Foundation

Phase 0 is the critical foundation every subsequent phase depends on. It is divided into **four sequential sub-phases**, each with its own gate. The sub-phases MUST be executed in order — each builds on the simplification achieved by the previous.

### Design Rationale

The original roadmap treated Phase 0 as a single step: "promote SemanticInteraction from 4-field stub to 22-field contract." The runtime validation revealed this was insufficient — the codebase has multiple layers of parallelism (dead code, dual types, dual classifiers) that must be eliminated before the type promotion can be done cleanly.

The four sub-phases follow the principle **simplify before adding**:
1. Remove what doesn't run (0a)
2. Unify what's duplicated (0b)
3. Consolidate what's parallel (0c)
4. Materialize the new contract (0d)

---

### Phase 0a: Dead Code Removal & Flag Elimination

**Objective:** Remove all dead, dormant, and broken code from the codebase. Eliminate the `recorderEngine` feature flag and its associated broken Control Engine branch. Reduce the codebase to only what actually runs.

**Dependencies:** Pre-work (characterization tests must exist as regression baseline)

#### Removal Targets

| Target | Lines | Location | Why Dead |
|--------|-------|----------|----------|
| `control-recorder.ts` | ~844 | `src/recorder/v2/control-recorder.ts` | Dormant — 12 listeners registered but `shouldCapture()` always returns false under default `'legacy'` flag |
| `control-model.ts` | — | `src/recorder/v2/control-model.ts` | Only used by control-recorder.ts |
| `element-identity-builder.ts` | — | `src/recorder/v2/element-identity-builder.ts` | Only used by control-model.ts |
| `framework-adapters.ts` | — | `src/recorder/v2/framework-adapters.ts` | Only used by control-model.ts |
| `identity-extractor.ts` (v2) | — | `src/recorder/v2/identity-extractor.ts` | Only used by control-recorder.ts |
| `interaction-recognizer.ts` | — | `src/recorder/v2/interaction-recognizer.ts` | Control Engine classifier — only called when `recorderEngine='control'`, which is structurally broken (RECORDED_EVENT unhandled) |
| `deterministic-recorder.ts` | ~3079 | `src/recorder/deterministic-recorder.ts` | Not in manifest, never injected |
| `interaction-types.ts` (legacy) | — | `src/recorder/interaction-types.ts` | Legacy registry, superseded |
| `recording-session.ts` | — | `src/recorder/recording-session.ts` | Legacy session manager, superseded |
| `element-id-generator.ts` | — | `src/recorder/element-id-generator.ts` | Unused |
| `step-id-generator.ts` | — | `src/recorder/step-id-generator.ts` | Unused |
| `surface-detector.ts` | — | `src/recorder/surface-detector.ts` | Duplicated in dom-context-extractor.ts |
| `modal-tracker.ts` | — | `src/runtime/modal-tracker.ts` | Dormant — not instantiated |
| `src/pipeline/` (34 files) | — | `src/pipeline/` | Blueprint architecture, zero external imports |
| `src/types/` (8 files) | — | `src/types/` | Only imported by `src/pipeline/` |
| `toIRActions` import | — | `src/background/service-worker.ts:57` | Imported but 0 call sites |
| `tmp-build/` | — | `tmp-build/` | Full project snapshot |
| `extension-zip/` | — | `extension-zip/` | Built extension archive |

#### Flag Elimination

| Target | Location | Change |
|--------|----------|--------|
| `recorderEngine` field | `src/shared/types.ts:100` (UIState) | Remove field |
| `DEFAULT_UI_STATE.recorderEngine` | `src/shared/types.ts:107` | Remove default |
| `recorderEngine` read in SW | `src/background/service-worker.ts:313-314` | Remove `useControlEngine` flag + Control Engine branch (lines 318-333) |
| `recorderEngine` preservation in SW | `src/background/service-worker.ts:537` | Remove `prevUiState.recorderEngine` preservation |
| `control-recorder.ts` manifest entry | `src/manifest.json:36-40` | Remove content_scripts entry |
| `control-recorder.ts` web_accessible_resources | `src/manifest.json:24` | Remove from resources array |
| `syncEngineFlag()` storage listener | `src/recorder/v2/control-recorder.ts` | Removed with file deletion |

#### Acceptance Criteria

- [ ] Build succeeds (`npm run build` exits 0)
- [ ] All existing tests pass (adapted to remove `recorderEngine` references)
- [ ] Characterization tests pass (IR output unchanged)
- [ ] `grep -r "import.*deterministic-recorder\|import.*control-recorder\|import.*modal-tracker\|import.*pipeline/channels\|import.*interaction-recognizer"` returns zero hits in active code
- [ ] `grep -r "recorderEngine"` returns zero hits in source (excluding test files that reference it in comments)
- [ ] `manifest.json` has exactly ONE content script entry (recorder-entry.ts)
- [ ] `toIRActions` is not imported in `service-worker.ts`
- [ ] Recording on a real SPA produces identical output as before removal

#### Phase Gate

**GATE: 0a → 0b**
- Build passes, all tests pass, characterization tests pass
- `manifest.json` has one content script
- Zero `recorderEngine` references in source

#### Frozen Contracts

None — this phase removes code, it does not introduce contracts.

---

### Phase 0b: Type Unification

**Objective:** Eliminate the dual type system. Unify `ObservedEvent`/`ComponentInteraction` and `RecordedEvent`/`DetectedInteraction` into a single type system so the Semantic Reasoner receives data directly from the Component Runtime without the `as any` adapter shim.

**Dependencies:** Phase 0a (dead code removed, single content script, no feature flag)

#### Current Type Debt

The runtime validation confirmed three type dualisms bridged by unsafe casts:

| Type #1 | Type #2 | Bridge | Location |
|---------|---------|--------|----------|
| `ObservedEvent` (component-types.ts) | `RecordedEvent` (recorded-event.ts) | `as any` adapter shim | SW:287-308 (3 casts at lines 299, 306, 307) |
| `DomContext` (component-types.ts — EventTap) | `DomContext` (recorded-event.ts — V1 classifier) | Implicit field mapping in adapter shim | SW:287-308 |
| `InteractionType` (component-types.ts — 13 values) | `InteractionType` (interaction-types.ts — 45 values) | Manual mapping in classifier | `src/classifier/interaction-detector.ts` |

#### Work Items

| Item | Detail |
|------|--------|
| Unify `DomContext` | Merge `component-types.ts DomContext` and `recorded-event.ts DomContext` into a single type. The unified type must carry all fields from both: surface detection (from component-types) + rich DOM context (from recorded-event) |
| Unify `InteractionType` | Merge the 13-value `component-types.ts InteractionType` and the 45-value `interaction-types.ts InteractionType` into a single enum. The unified enum must be a superset of both |
| Unify `ObservedEvent` / `RecordedEvent` | Merge into a single event type. `ObservedEvent` (from EventTap/Component Runtime) and `RecordedEvent` (for V1/V2 classifier) become one type. The adapter shim at SW:287-308 is replaced by a direct type assignment |
| Eliminate `as any` casts | Remove all three `as any` casts at SW:287-308. The SW pipeline must flow from ComponentInteraction[] → unified events → classifier without type coercion |
| Unify `ElementIdentity` | Verify `src/shared/types.ts ElementIdentity` is the single canonical identity type. Remove any duplicate identity definitions in `recorded-event.ts` or `component-types.ts` |
| Adapt side panel rendering | The side panel reads `DETECTED_INTERACTIONS_MERGED` from storage and renders interaction objects. Update the rendering code to handle the unified event type. The display fields must remain equivalent |
| Adapt V1 classifier | `detectInteractions()` currently accepts `RecordedEvent[]`. Update to accept the unified event type |
| Adapt V2 evidence engine | `detectInteractionsV2()` currently accepts `RecordedEvent[]`. Update to accept the unified event type |
| Adapt Semantic Reasoner | `reasonAboutInteractions()` currently accepts `RecordedEvent[]`. Update to accept the unified event type |
| Adapt IR Bridge | `buildIRPlan()` currently accepts events as `RecordedEvent[]`. Update to accept the unified event type |
| Adapt pipeline runner | `runPipeline()` currently accepts events as `RecordedEvent[]`. Update to accept the unified event type |
| Adapt domain adapter | `adaptToDomainEntities()` currently accepts events as `RecordedEvent[]`. Update to accept the unified event type |

#### Acceptance Criteria

- [ ] Single `DomContext` type (no duplicate definition)
- [ ] Single `InteractionType` enum (superset of both previous enums)
- [ ] Single event type (ObservedEvent = RecordedEvent, one definition)
- [ ] Zero `as any` casts in `service-worker.ts` (specifically lines 299, 306, 307)
- [ ] Zero `as any` casts in the event → classifier → reasoner → IR bridge path
- [ ] Side panel renders interactions correctly with unified type
- [ ] Characterization tests pass (IR output unchanged)
- [ ] All existing tests pass (adapted to unified types)
- [ ] Recording on a real SPA produces identical output

#### Phase Gate

**GATE: 0b → 0c**
- Zero `as any` casts in the pipeline
- Single type definitions for DomContext, InteractionType, events
- Characterization tests pass
- All tests pass

#### Frozen Contracts

| Contract | Status |
|----------|--------|
| **Unified DomContext** | ✅ FROZEN — single type definition |
| **Unified InteractionType** | ✅ FROZEN — superset enum |
| **Unified event type** | ✅ FROZEN — ObservedEvent/RecordedEvent merged |

---

### Phase 0c: Classifier Consolidation

**Objective:** Merge the V1 classifier (`detectInteractions`) and V2 evidence engine (`detectInteractionsV2`) into a single unified classifier. Eliminate the merge layer (`mergeV1V2`) and A/B comparison logging. Consolidate the 5 evidence providers into the unified classifier.

**Dependencies:** Phase 0b (unified types — the classifier must accept the unified event type)

#### Current Classifier Architecture

The runtime validation confirmed the active classifier path:

```
RecordedEvent[] (now unified event type)
  → detectInteractions(events)         ── V1 classifier ──→ DetectedInteraction[] (V1)
  → detectInteractionsV2(events)       ── V2 evidence engine ──→ DetectedInteraction[] (V2)
  → compareClassifierOutputs(v1, v2)  ── A/B dev logging ──→ console
  → mergeV1V2(v2, v1, count)          ── Merge layer ──→ DetectedInteraction[] (merged)
  → mergedInteractions
```

The merge layer uses **V2-primary, V1-fallback**: V2 results are preferred; V1 fills gaps where V2 couldn't confidently classify.

#### Work Items

| Item | Detail |
|------|--------|
| Analyze V1 vs V2 coverage | Map which interaction types V1 detects that V2 doesn't (and vice versa). Document the overlap matrix |
| Design unified classifier | Single `detectInteractions()` function that incorporates V2's evidence-based approach as primary path with V1's pattern-matching as fallback. The merge logic (V2-primary, V1-fallback) is internalized into the classifier itself |
| Consolidate evidence providers | The 5 providers (dom, aria, event-sequence, mutation, css-classname) feed into V2. In the unified classifier, they feed into the single classification path |
| Eliminate merge layer | Remove `mergeV1V2()` and `logMergeMetrics()`. The unified classifier produces one output directly |
| Eliminate A/B comparison | Remove `compareClassifierOutputs()` and `logComparisonResult()` — dev-only logging, no longer needed |
| Remove V2 storage writes | The SW currently writes `DETECTED_INTERACTIONS_V2` to storage. Remove — only one classifier output exists |
| Remove merge storage writes | The SW currently writes `DETECTED_INTERACTIONS_MERGED`. Rename to `DETECTED_INTERACTIONS` (or keep merged key for backward compatibility) |
| Update SW pipeline | Simplify `handleStopRecording()` lines 334-366 from three-call (V1+V2+merge) to single-call |
| Update side panel | Side panel reads `DETECTED_INTERACTIONS_MERGED`. Update to read the unified output key |

#### Acceptance Criteria

- [ ] Single `detectInteractions()` function produces `DetectedInteraction[]`
- [ ] Zero references to `detectInteractionsV2`, `mergeV1V2`, `compareClassifierOutputs`, `logComparisonResult`, `logMergeMetrics` in active code
- [ ] The unified classifier produces output equivalent to the previous merged output for all interaction types
- [ ] Characterization tests pass (IR output unchanged — same interactions classified the same way)
- [ ] All existing tests pass (adapted to single classifier)
- [ ] Recording on a real SPA produces identical output

#### Phase Gate

**GATE: 0c → 0d**
- Single classifier function
- Zero merge-layer references
- Characterization tests pass (same classification output)
- All tests pass

#### Frozen Contracts

| Contract | Status |
|----------|--------|
| **Unified Classifier output contract** | ✅ FROZEN — single `detectInteractions()` → `DetectedInteraction[]` |

---

### Phase 0d: SemanticInteraction Materialization

**Objective:** Promote `SemanticInteraction` from a 4-field stub to the full 22-field observation contract. Rewire the Semantic Reasoner to output `SemanticInteraction[]` and the IR Bridge to accept it as the sole interaction input. This is the foundation every strategic phase depends on.

**Dependencies:** Phase 0c (unified classifier — the Semantic Reasoner must receive `DetectedInteraction[]` from a single classifier before its output type can be changed)

#### Current State

`SemanticInteraction` exists as a 4-field stub in `architecture-types.ts`:
```typescript
{ canonicalType, actionId, value, checked }
```

The full 22-field contract is designed in `SEMANTIC_INTERACTION_BOUNDARY.md` but not materialized in code.

#### Components Refactored

| Component | Change | Why |
|-----------|--------|-----|
| `SemanticInteraction` type | Promote from 4-field stub to full 22-field observation contract | Becomes the shared semantic model |
| `SemanticReasoner` output | Change return from `DetectedInteraction[]` to `SemanticInteraction[]` | The reasoner already produces semantically correct interactions; just changes the output container |
| `IR Bridge` input | Change from `(SessionEvent[] + DetectedInteraction[] + Fragment)` to `(SemanticInteraction[])` | One pipeline, one type, pure function preserved |
| `RecordingSession` storage | Type changes from `DetectedInteraction[]` to `SemanticInteraction[]` | Persistence of the unified model |
| Domain Adapter | Adapt to produce `SemanticInteraction[]` instead of `DetectedInteraction[]` | Same transformation logic, different output type |
| Pipeline Runner | Orchestrate the unified flow | Remove the STOP_RECORDING synthetic adapter |
| Side panel rendering | Adapt display from `DetectedInteraction` fields to `SemanticInteraction` fields | Display fields must carry equivalent information |
| `IRStep.semanticInteractionId` | Populate during IR generation | Back-link from execution to semantic context |

#### NOT Changed

- EventTap, Evidence Channels, Recognition Pipeline, Lifecycle Engine — all produce `DetectedInteraction[]` as an intermediate, which the SemanticReasoner upgrades to `SemanticInteraction[]`
- IR Executor, Playwright Generator, Healing Service, Repository interfaces — all consume `ExecutionIRPlan`, which the IR Bridge still produces (just from a different input)
- Capability entity, Element entity, ExecutionRun entity — unchanged

#### SemanticInteraction Contract (22+3 Fields)

Per `SEMANTIC_INTERACTION_BOUNDARY.md` and the three adjustments from `CMDRUNNER_ARCHITECTURAL_EVOLUTION.md` §13 Decision 3:

| # | Field | Type | Source |
|---|-------|------|--------|
| 1 | `interactionId` | string (UUID) | Assigned by SemanticReasoner |
| 2 | `canonicalType` | InteractionType | From classifier |
| 3 | `semanticAction` | SemanticAction | Derived by reasoner |
| 4 | `actionId` | string | Stable action identifier |
| 5 | `value` | string \| number \| boolean \| object \| null | Expanded type |
| 6 | `checked` | boolean \| null | For toggleable controls |
| 7 | `target.identity` | ElementIdentity | From identity extractor |
| 8 | `target.domContext` | DomContext (unified) | From DOM context extractor |
| 9 | `target.virtualContext` | { containerLocator, itemIndex, itemCount } \| null | New — for virtualized lists |
| 10 | `target.overlayContext` | { type, locator } \| null | New — for elements inside surfaces |
| 11 | `target.iframeContext` | IframeContext \| null | Existing pattern |
| 12 | `evidence` | EvidenceRecord[] | From evidence channels |
| 13 | `surfaceContext` | { type, surfaceLabel, openedByThisInteraction } \| null | Surface-anchored detection |
| 14 | `componentType` | ComponentType | From enrichment |
| 15 | `componentSessionId` | string \| null | Links to session if part of composite |
| 16 | `confidence` | number (0-1) | Classification confidence |
| 17 | `timestamp` | number | Event time |
| 18 | `eventType` | string | Original DOM event type |
| 19 | `recordingSessionId` | string | Parent session |
| 20 | `transitionId` | string | Links to ComponentInteraction |
| 21 | `stepIndex` | number | Position in recording |
| 22 | `metadata` | Record<string, unknown> | Extensible metadata |
| 23 | `gestureData` | object \| null | New — for drag paths, swipe directions |

#### Acceptance Criteria

- [ ] `SemanticInteraction` type defined with all 22+3 fields from `SEMANTIC_INTERACTION_BOUNDARY.md`
- [ ] Observation/Projection boundary enforced: SemanticInteraction has zero consumer-concern fields (no assertions, execution hints, AI interpretations on the type itself)
- [ ] SemanticReasoner outputs `SemanticInteraction[]`
- [ ] IR Bridge accepts `SemanticInteraction[]` as sole interaction input
- [ ] `RecordingSession` stores `SemanticInteraction[]` in the repository
- [ ] `IRStep.semanticInteractionId` back-link populated during IR generation
- [ ] `DetectedInteraction` type retained ONLY as the recognition pipeline's intermediate output (not persisted, not consumed by IR Bridge)
- [ ] Side panel displays interactions correctly with SemanticInteraction type
- [ ] Characterization tests pass (IR output unchanged — same semantic content → same IR)
- [ ] All existing tests pass (adapted to new types where necessary)
- [ ] Recording on a real React SPA (Adani One + OrangeHRM) produces identical Playwright output as before the refactor
- [ ] Execution via IR Executor produces identical results as before the refactor

#### Phase Gate

**GATE: 0d → Phase 1 (Critical Path) + Phase 5 (Execution Track)**
- SemanticInteraction type frozen with 22+3 fields
- Observation/Projection boundary enforced
- SemanticReasoner → SemanticInteraction[] output contract frozen
- IR Bridge input contract frozen
- Characterization tests pass
- All tests pass
- Recording + execution on real SPA produces correct output

#### Frozen Contracts

| Contract | Status |
|----------|--------|
| **SemanticInteraction (22+3 fields)** | ✅ FROZEN — immutable observation model |
| **Observation/Projection boundary** | ✅ FROZEN — no consumer fields on SemanticInteraction |
| **SemanticReasoner → SemanticInteraction[] output contract** | ✅ FROZEN |
| **IR Bridge input contract** | ✅ FROZEN — accepts SemanticInteraction[] |
| **IRStep.semanticInteractionId back-link** | ✅ FROZEN |

#### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Breaking existing tests during type migration | Migrate incrementally: define SemanticInteraction → adapt SemanticReasoner → adapt IR Bridge → adapt side panel → adapt tests. Each step is independently testable |
| IR Bridge output changes when input changes | The IR Bridge is a pure function. Characterization tests (from Pre-work) verify identical output |
| SemanticInteraction loses fields the classifier populated | Map every `DetectedInteraction` field to a `SemanticInteraction` field explicitly. Create a field-coverage matrix and verify 100% before removing DetectedInteraction from the IR Bridge path |
| Side panel display regression | Side panel reads from storage. Write a display characterization test: capture side panel HTML before, verify equivalent after |
| Performance regression from richer types | Profile IR Bridge before and after. The type change is structural (more fields on the object), not algorithmic. Expected impact: negligible |

---

### Phase 0e: Structural Semantic Enrichment

**Objective:** Transform action sequences (`subActions[]`) into state-based field representations (`ConfigurationSession`). Recognize configuration patterns (multi-field config, filter-apply, search-submit, toggle-batch) using only structural signals — zero application knowledge. Provide the contract that the Capability Model (Phase 2) will consume.

**Dependencies:** Phase 0b (Observation Model — produces `subActions[]` + `isMultiConfig` on `ComponentInteraction.metadata`). Implementable on current codebase without Phase 0a–0d completion.

**Design document:** `docs/architecture/STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md`

#### The Three-Layer Distinction

| Layer | Question | Data |
|-------|----------|------|
| **Layer 1: Observation** (Phase 0b) | What did the user physically do? | `subActions[]` — action sequence |
| **Layer 2: Structural Semantic** (Phase 0e) | What state did those actions produce? | `ConfigurationSession` — fields with final values |
| **Layer 3: Business Semantic** (Phase 2) | What did the user mean in this app? | Capability type + business field labels |

Layer 2 is a **pure data transform** — input is `metadata.subActions`, output is `metadata.configurationSession`. No I/O, no DOM access, no application knowledge.

#### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `ConfigurationSession` type | State-based representation: fields with final values + commit action |
| `ConfigurationField` type | Single field: label, kind (counter/select/toggle/text/date), finalValue, delta |
| `StructuralPattern` type | Pattern category: singleSelect, multiFieldConfig, filterApply, searchSubmit, toggleBatch, uncommitted |
| `enrichConfigurationSession()` | Pure transform function: ComponentInteraction → ComponentInteraction (with configurationSession added) |

#### Components Refactored

| Component | Change |
|-----------|--------|
| Timeline renderer | Check for `configurationSession` before falling back to raw `subActions` rendering |
| IR Bridge | Check for `configurationSession` for field-based expansion (counter→fill, select→click, toggle→check) |
| Service Worker | Call `enrichConfigurationSession()` between reasoning and pipeline |

#### Discrimination Rule

Enrichment runs when: `subActions` exists AND (`confirm` subAction present OR multiple distinct fields). Simple single-select dropdowns are left untouched.

#### Pattern Recognition

| Pattern | Signature | Example |
|---------|-----------|---------|
| `singleSelect` | One selectOption, no commit | Trip Type → Round Trip |
| `multiFieldConfig` | Counter + other types + commit | Passenger & Cabin selector |
| `filterApply` | Multiple select/toggle + Apply commit | Filter panel |
| `searchSubmit` | FillInput + Search commit | Advanced search |
| `toggleBatch` | Multiple toggles + commit | Settings dialog |
| `uncommitted` | Field changes, no commit | Panel closed without Done |

#### Acceptance Criteria

- [ ] `ConfigurationSession` + `ConfigurationField` + `StructuralPattern` types defined
- [ ] `enrichConfigurationSession()` is a pure function (no side effects, no I/O)
- [ ] Stepper accumulation: two increments on same field → one field with delta +2
- [ ] Counter net-zero: increment + decrement → delta 0
- [ ] Select mind-change: two selectOptions on same field → finalValue = last
- [ ] Commit detection: confirm subAction → commitAction populated, excluded from fields
- [ ] No commit: pattern = 'uncommitted', commitAction = null
- [ ] Simple single-select not enriched (backward compatible)
- [ ] Timeline renderer shows field-based summary when configurationSession present
- [ ] IR Bridge uses configurationSession for optimal strategy when present
- [ ] Idempotency: running enrichment twice produces same result
- [ ] All existing tests pass (additive change, no regressions)
- [ ] Build succeeds

#### Phase Gate

**GATE: 0e → Phase 1**
- ConfigurationSession + ConfigurationField types frozen
- enrichConfigurationSession() contract frozen
- All tests pass

#### Frozen Contracts

| Contract | Status |
|----------|--------|
| **ConfigurationSession type** | ✅ FROZEN |
| **ConfigurationField type** | ✅ FROZEN |
| **StructuralPattern type** | ✅ FROZEN |
| **enrichConfigurationSession() contract** | ✅ FROZEN — pure transform, idempotent |

#### Reference

Full design: `docs/architecture/STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md` (1,045 lines)

---

## Phase 1: Persistent Semantic Layer

**Objective:** Make `SemanticInteraction[]` the persistent shared model that both the recorder and execution engine reference at runtime. Wire the semantic back-link through to the execution layer so the executor (and future AI) can look up the semantic context for any IR step.

**Dependencies:** Phase 0d (SemanticInteraction materialized and frozen)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `SemanticInteractionRepository` interface | CRUD for querying SemanticInteractions by session ID, interaction ID, page URL |
| `DexieSemanticInteractionRepository` | IndexedDB implementation (Dexie v4 schema upgrade) |
| `AssertionProjection` type | Derived assertions from before/after states (projection over SemanticInteraction) |
| `ExecutionProjection` type | Type-aware retry/wait/timeout hints (projection over SemanticInteraction) |
| `SemanticContextProvider` | Runtime lookup service: given an IRStep, return its SemanticInteraction + projections |

### Components Refactored

| Component | Change |
|-----------|--------|
| IR Bridge | Populate `assertions[]` from `AssertionProjection` (derived from before/after states) instead of from InteractionContract constraints |
| IR Executor | Look up `SemanticInteraction` via `semanticInteractionId` for type-aware execution decisions (retry strategy, wait strategy) |
| Dexie Database | Schema v3 → v4: add `semanticInteractions` table, index by sessionId + interactionId |

### Why This Phase Must Come After Phase 0d

Phase 0d defines the `SemanticInteraction` type and makes it flow through the pipeline. Phase 1 makes it **queryable at runtime** — stored in its own repository table, indexed for lookup, and wired to the execution engine.

### Why This Phase Must Come Before Phase 2

The Capability model composes from `SemanticInteraction[]` references. Those references need to be persistent and queryable. If interactions are only embedded in `RecordingSession.rawInteractions` (Tier 3 archival storage), capability inference can't query them efficiently. Phase 1 promotes them to Tier 1 (canonical, indexed, queryable).

### User-Visible Functionality Unlocked

- **Richer execution results:** The IR Executor reports "Custom dropdown 'Nationality' not found" instead of "Element not found"
- **Better assertions:** Assertions derived from before/after states are more accurate
- **Type-aware execution:** Custom dropdown clicks get `retryCount: 2` automatically; simple clicks get `retryCount: 1`

### Acceptance Criteria

- [ ] `SemanticInteractionRepository` interface defined with: `getBySession`, `getById`, `getByElementId`
- [ ] Dexie v4 schema upgrade is backward-compatible (existing v3 data is readable)
- [ ] `AssertionProjection` produces assertions from before/after states for all interaction types
- [ ] IR Bridge generates assertions from `AssertionProjection`
- [ ] IR Executor looks up `SemanticInteraction` for each step and applies type-aware execution parameters
- [ ] `SemanticContextProvider` returns the semantic interaction + projections for any IRStep
- [ ] Characterization tests pass
- [ ] All existing tests pass
- [ ] Recording + execution on a real SPA shows improved assertion accuracy

### Phase Gate

**GATE: Phase 1 → Phase 2**
- SemanticInteractionRepository frozen
- Dexie v4 schema frozen
- AssertionProjection + ExecutionProjection frozen
- Characterization tests pass

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **SemanticInteractionRepository interface** | ✅ FROZEN |
| **AssertionProjection type** | ✅ FROZEN |
| **ExecutionProjection type** | ✅ FROZEN |
| **Dexie v4 schema** | ✅ FROZEN (backward-compatible with v3) |

---

## Phase 2: Capability Adoption Lifecycle

**Objective:** Build the management layer that transforms inferred `CapabilityCandidate`s into approved, versioned, related `Capability` entities with business-level metadata. This is what makes CmdRunner a test management platform, not just a recorder.

**Dependencies:** Phase 1 (SemanticInteraction[] must be persistent and queryable for capability composition)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CapabilityReviewService` | Manages the candidate → approved transition: review, edit, approve, reject |
| `CapabilityVersioningService` | Creates new versions when scope changes; tracks version history |
| `CapabilityRelationService` | Manages `dependsOn` and `variations` between capabilities |
| `CapabilityMatcher` | Cross-session matching: new recording → find existing capability → enrich or create new |
| `CapabilityUI` | Side panel views: capability list, detail, review form, dependency graph |
| `DataRequirement` type | Formal data requirements with test data sets (for data-driven testing) |
| `SuccessCriterion` type | Explicit success criteria (navigation, element state, visibility, text content) |

### Components Refactored

| Component | Change |
|-----------|--------|
| `CapabilityDeriver` | Output changes from producing `CapabilityCandidate` to also proposing `DataRequirement[]` and `SuccessCriterion[]` |
| `Capability` entity | Add `version`, `dependsOn`, `variations`, `successCriteria`, `dataRequirements` fields (all additive) |
| `CapabilityRepository` | Add `getByVersion`, `findMatching` methods |
| Dexie Database | Schema v4 → v5: index capabilities by status, version, projectId |

### Why This Phase Must Come After Phase 1

Capability composition references `SemanticInteraction[]` by ID. Those IDs must be persistent and queryable (Phase 1) for the capability model to reference them.

### Why This Phase Must Come Before Phase 3

AI test generation (Phase 3) needs the approved capability model — it generates test cases FROM capabilities, not from raw interactions.

### User-Visible Functionality Unlocked

- **Capability list view:** QA tester sees detected capabilities with status (inferred → approved)
- **Capability review:** QA tester reviews, edits, and approves capabilities
- **Data-driven testing setup:** QA tester defines test data sets for data requirements
- **Dependency graph:** Capabilities show dependencies
- **Cross-session enrichment:** Second recording of the same flow enriches the existing capability

### Acceptance Criteria

- [ ] `CapabilityReviewService` transitions capability status: inferred → approved → deprecated
- [ ] `CapabilityVersioningService` creates immutable versions; versionNumber is monotonically increasing
- [ ] `CapabilityMatcher` matches new recordings to existing capabilities (≥70% field overlap threshold)
- [ ] Enrichment is append-only: `enrichmentHistory[]` grows, `confidence` progresses
- [ ] `DataRequirement` with `testDataSet` supports at least 3 data variants per requirement
- [ ] `SuccessCriterion` validates against execution results
- [ ] Capability UI in side panel: list, detail, review form
- [ ] All existing tests pass; new tests for capability lifecycle

### Phase Gate

**GATE: Phase 2 → Phase 3**
- Capability lifecycle states frozen
- Capability versioning model frozen
- DataRequirement + SuccessCriterion frozen
- CapabilityMatcher contract frozen

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **Capability lifecycle states** | ✅ FROZEN — inferred → approved → deprecated |
| **Capability versioning model** | ✅ FROZEN — immutable versions, monotonic versionNumber |
| **CapabilityStep composition** | ✅ FROZEN — interactionId + role references |
| **DataRequirement type** | ✅ FROZEN |
| **SuccessCriterion type** | ✅ FROZEN |
| **CapabilityMatcher matching contract** | ✅ FROZEN |

---

## Phase 3: Capability-Derived IR Generation

**Objective:** Build the IR generator that produces `ExecutionIRPlan` from `(Capability + SemanticInteraction[] + Element Repository + Environment Profile)`. This enables re-executing a test case without re-recording, and executing AI-generated test cases.

**Dependencies:** Phase 2 (approved capabilities with data requirements and success criteria)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CapabilityIRGenerator` | Implements `IRGenerator` interface: (Capability + SemanticInteractions + Elements + Environment) → ExecutionIRPlan |
| `DataResolver` | Resolves `DataRequirement` test data sets into concrete `IRInput` values for each step |
| `AssertionResolver` | Transforms `SuccessCriterion[]` into `IRAssertion[]` with resolved locators |
| `EnvironmentResolver` | Resolves `EnvironmentProfile` into `IREnvironment` (baseUrl, browser, viewport) |

### Components Refactored

| Component | Change |
|-----------|--------|
| IR generation entry point | Dispatches to `IRBridge` (recording-derived) or `CapabilityIRGenerator` (capability-derived) based on source |
| `ExecutionIRArtifact` | Add `source: 'recording' | 'capability'` field (additive) |

### Why This Phase Must Come After Phase 2

The generator's input is an approved `Capability` with `DataRequirement[]` and `SuccessCriterion[]`. Without Phase 2's capability lifecycle, there's no approved capability to generate from.

### Why This Phase Must Come Before Phase 4

AI test generation (Phase 4) creates new test case variants. Those variants need to be executable — which requires the capability-derived IR generator.

### User-Visible Functionality Unlocked

- **Re-execute without re-recording:** QA tester selects an approved capability, picks a data set, and clicks "Run"
- **Data-driven execution:** The same capability runs with different data sets
- **Environment switching:** Same capability runs against staging or production

### Acceptance Criteria

- [ ] `CapabilityIRGenerator` produces a valid `ExecutionIRPlan` from an approved Capability
- [ ] `DataResolver` resolves all `DataRequirement` fields to concrete values from the selected test data set
- [ ] `AssertionResolver` converts `SuccessCriterion[]` to `IRAssertion[]` with resolved element locators
- [ ] Generated IR is executable by `IRExecutor` (Chrome executor)
- [ ] Generated IR is renderable by `IRCodeGenerator` (Playwright adapter)
- [ ] Same capability + different data sets → different IR plans with different inputs but same structure
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 3 → Phase 4**
- IRGenerator interface frozen
- Capability → IR generation pipeline frozen
- DataResolver contract frozen

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **IRGenerator interface** | ✅ FROZEN |
| **Capability → IR generation pipeline** | ✅ FROZEN |
| **DataResolver contract** | ✅ FROZEN |
| **ExecutionIRArtifact.source field** | ✅ FROZEN |

---

## Phase 4: AI Test Generation Engine

**Objective:** Use LLMs to generate additional test cases from the capability model — positive, negative, boundary, validation, accessibility, and security variants — that are immediately executable because they produce capabilities → IR → execution.

**Dependencies:** Phase 3 (capability-derived IR generation — AI-generated tests must be executable)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `TestGenerationEngine` | Orchestrates LLM prompt construction, response parsing, and test case creation |
| `PromptBuilder` | Composes structured prompts from Capability + SemanticInteraction[] + DataRequirements + execution history |
| `TestCaseFactory` | Creates `ApprovedTestCase` + `TestCaseVersion` from LLM-generated test specifications |
| `TestVariant Taxonomy` | Classification: positive, negative, boundary, validation, accessibility, security, regression |
| `AnalysisProjection` type | AI-derived projections over SemanticInteraction[] (intent classification, relationships, workflow patterns) |

### Components Refactored

| Component | Change |
|-----------|--------|
| AI Provider Manager | Add `generateTestVariants` capability to the `AIProvider` interface (additive method) |
| Capability UI | Add "Generate Test Variants" button on capability detail view |

### LLM Integration

Use `create_openai_api_key(project_id)` to mint an OpenAI-compatible key. Save as env var per the platform's LLM integration pattern. Never hardcode keys; never call public LLM hostnames.

### Why This Phase Must Come After Phase 3

AI generates test case *specifications*. Those specifications need to be convertible to IR (Phase 3's `CapabilityIRGenerator`) to be executable. Without Phase 3, AI-generated tests are just text — not runnable.

### Why This Phase Must Come Before Phase 5

Enhanced execution (Phase 5) benefits from having more test cases to execute — especially negative and boundary tests that stress the execution engine's retry and assertion evaluation.

### User-Visible Functionality Unlocked

- **AI test generation:** QA tester clicks "Generate Test Variants" → AI proposes positive, negative, boundary, validation, accessibility, security variants
- **Variant review:** QA tester reviews, edits, and approves AI-proposed test cases
- **Batch generation:** Generate variants for all capabilities in a project

### Acceptance Criteria

- [ ] `TestGenerationEngine` produces at least 3 variant test cases per capability (positive, negative, boundary)
- [ ] Each generated variant has explicit expected outcomes
- [ ] `TestCaseFactory` creates valid `ApprovedTestCase` + `TestCaseVersion` from LLM output
- [ ] Generated test cases are executable via `CapabilityIRGenerator` → `IRExecutor`
- [ ] LLM prompt includes: capability metadata, data requirements, success criteria, and at least 1 prior execution result
- [ ] `AnalysisProjection` populated for at least intent classification
- [ ] AI provider abstraction works with at least 2 providers
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 4 → Phase 7 (Critical Path track complete for AI generation; Phase 7 needs Phase 4 + Phase 6)**
- AnalysisProjection frozen
- TestVariant taxonomy frozen
- TestGenerationEngine interface frozen
- PromptBuilder input contract frozen

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **AnalysisProjection type** | ✅ FROZEN |
| **TestVariant taxonomy** | ✅ FROZEN |
| **TestGenerationEngine interface** | ✅ FROZEN |
| **PromptBuilder input contract** | ✅ FROZEN |

---

## Phase 5: Enhanced Execution Engine

**Objective:** Wire up the execution parameters already designed in the IR contract (`retryCount`, `waitStrategy`, `retryDelayMs`) and add evidence capture (screenshots on failure, DOM snapshots). This makes execution reliable enough for CI/CD integration.

**Dependencies:** Phase 0d (SemanticInteraction materialized — `ExecutionProjection` derives from SemanticInteraction's `canonicalType`)

> **Note:** Phase 5 can begin in parallel with Phases 1-4 once Phase 0d is complete. It is on a separate track (Execution Reliability) and does not depend on the Critical Path track.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `RetryHandler` | Implements retry logic: on failure, wait `retryDelayMs`, retry up to `retryCount` times |
| `WaitStrategyHandler` | Implements wait strategies: `visible`, `present`, `stable` |
| `EvidenceCaptureService` | Captures screenshots (base64 PNG), DOM snapshots, and console logs on step failure |
| `SuiteExecutor` | Orchestrates multiple `IRExecutor` runs as a test suite (parallel or sequential) |

### Components Refactored

| Component | Change |
|-----------|--------|
| IR Executor content script | Implement `waitForElement` action, retry logic, and wait strategy polling |
| `ExecutionStepResult` | Add `screenshot`, `domSnapshot`, `consoleErrors` fields (all optional, additive) |
| `ExecutionRun` | Add `suiteRunId` field for grouping runs in a suite (additive) |

### User-Visible Functionality Unlocked

- **Retry on transient failure:** Flaky custom dropdown clicks retry automatically
- **Failure screenshots:** Screenshots captured and displayed on step failure
- **Test suite execution:** "Run all test cases for this capability" with aggregate reporting
- **Wait strategies:** Autocomplete waits for stability; date pickers wait for presence; simple clicks wait for visibility

### Acceptance Criteria

- [ ] `RetryHandler` retries failed steps up to `retryCount` with `retryDelayMs` delay
- [ ] `WaitStrategyHandler` implements `visible`, `present`, `stable` strategies
- [ ] `EvidenceCaptureService` captures screenshot on step failure
- [ ] `SuiteExecutor` runs multiple test cases sequentially with aggregate reporting
- [ ] `ExecutionStepResult` carries screenshot data for failed steps
- [ ] Custom dropdown clicks get `retryCount: 2` automatically via `ExecutionProjection`
- [ ] Autocomplete interactions get `waitStrategy: 'stable'` automatically
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 5 → Phase 6**
- Evidence fields frozen
- SuiteExecutor interface frozen
- Wait/retry semantics frozen

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **ExecutionStepResult evidence fields** | ✅ FROZEN — screenshot, domSnapshot, consoleErrors |
| **SuiteExecutor interface** | ✅ FROZEN |
| **Wait strategy semantics** | ✅ FROZEN — none, visible, present, stable |
| **Retry semantics** | ✅ FROZEN — retryCount, retryDelayMs |

---

## Phase 6: Multi-Engine Execution — Playwright

**Objective:** Implement the first non-Chrome-extension execution engine: a Playwright-based `IRExecutor` that runs IR plans headlessly or in a headed browser. This validates the multi-engine contract and enables CI/CD integration.

**Dependencies:** Phase 5 (retry, wait strategies, and evidence capture are engine-agnostic infrastructure)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `PlaywrightExecutor` | Implements `IRExecutor` using the Playwright browser automation API |
| `PlaywrightLocatorResolver` | Resolves IR locators to Playwright locator strategies (`getByRole`, `getByTestId`, `locator()`) |
| `PlaywrightActionHandler` | Maps IRAction → Playwright method calls |
| `PlaywrightAssertionEvaluator` | Evaluates IRAssertions using Playwright's expect API |
| `ExecutionEngineRegistry` | Registry of available execution engines: Chrome executor (existing), Playwright executor (new) |

### Why This Phase Must Come After Phase 5

Playwright execution needs the same retry, wait strategy, and evidence capture as Chrome execution. Phase 5's infrastructure is engine-agnostic. Building Playwright before Phase 5 would mean duplicating execution reliability logic.

### User-Visible Functionality Unlocked

- **Headless execution:** Run tests in a headless browser — essential for CI/CD
- **Cross-browser testing:** Execute the same test in Chromium, Firefox, and WebKit
- **Engine selection:** QA tester picks "Chrome Extension" or "Playwright" as the execution engine
- **CI/CD export:** Generated Playwright tests can run in CI/CD pipelines independently

### Acceptance Criteria

- [ ] `PlaywrightExecutor` implements `IRExecutor.execute(plan, options) → IRExecutionResult`
- [ ] Same IR plan produces structurally identical execution results in Chrome executor and Playwright executor
- [ ] `PlaywrightLocatorResolver` resolves all 8 `LocatorStrategyType` values to Playwright locators
- [ ] `PlaywrightAssertionEvaluator` evaluates all `ValidationType` values
- [ ] `ExecutionEngineRegistry` allows selecting engine at execution time
- [ ] Playwright executor captures screenshots on failure
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 6 → Phase 7**
- ExecutionEngineRegistry frozen
- PlaywrightExecutor contract frozen
- Multi-engine execution validated

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **ExecutionEngineRegistry interface** | ✅ FROZEN |
| **PlaywrightExecutor contract** | ✅ FROZEN — same IRExecutor interface |
| **Multi-engine execution validated** | ✅ Two independent engines run the same IR |

---

## Phase 7: AI Failure Analysis & Enhanced Self-Healing

**Objective:** Add LLM-powered failure analysis that diagnoses WHY a test failed at the business level, and AI-assisted healing that suggests locator strategies based on semantic context. This closes the feedback loop: execution failure → AI diagnosis → healing → re-execution → learning.

**Dependencies:** Phase 4 (AI test generation — `AnalysisProjection` and AI provider infrastructure) + Phase 6 (multi-engine execution results from Chrome + Playwright for pattern identification)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `FailureAnalysisEngine` | Composes LLM prompt from ExecutionRun + Capability + SemanticInteraction; produces structured root-cause analysis |
| `RootCauseReport` type | Structured failure analysis: root cause category, affected capability, affected step, suggested fix |
| `AIHealingService` | Extends `healElementAndPersist()`: when deterministic ranking fails, query LLM for locator suggestions based on semantic context |
| `HealingFeedbackLoop` | Tracks healing success rate per element; feeds back into locator confidence scoring |

### Components Refactored

| Component | Change |
|-----------|--------|
| `healElementAndPersist()` | Add optional AI healing path: if deterministic ranking fails, call `AIHealingService` before giving up |
| `Element.locatorStrategies` | `confidence` field computed from observed success rates (not just 1.0/null) |
| `ExecutionRun` | Add `rootCauseAnalysis?: RootCauseReport` field (additive) |
| Capability entity | `failureModes[]` enriched by AI failure analysis results |

### User-Visible Functionality Unlocked

- **Root-cause analysis:** AI explains why a test failed at the business level
- **AI-assisted healing:** AI suggests locators based on semantic context when deterministic healing fails
- **Healing feedback:** Elements that frequently need healing are flagged; confidence scores reflect real-world reliability
- **Capability failure modes:** Known failure modes accumulate on capabilities

### Acceptance Criteria

- [ ] `FailureAnalysisEngine` produces a `RootCauseReport` for any failed `ExecutionRun`
- [ ] Root cause categories include: locator_broken, ui_text_changed, element_moved, framework_migration, timing_issue, data_issue, environment_issue
- [ ] `AIHealingService` suggests locator strategies when deterministic ranking fails
- [ ] AI-suggested locators go through the same `healElementAndPersist()` audit trail with `proposedBy: 'ai'`
- [ ] `HealingFeedbackLoop` updates `locatorStrategies[].confidence` based on observed success rates
- [ ] `Capability.failureModes[]` accumulates from execution results
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 7 → Phase 8 (web platform complete)**
- RootCauseReport frozen
- FailureAnalysisEngine frozen
- AIHealingService frozen
- Healing feedback loop frozen
- Root cause taxonomy frozen

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **RootCauseReport type** | ✅ FROZEN |
| **FailureAnalysisEngine interface** | ✅ FROZEN |
| **AIHealingService contract** | ✅ FROZEN — extends existing healing core |
| **Healing feedback loop** | ✅ FROZEN — confidence from observed success |
| **Root cause taxonomy** | ✅ FROZEN |

---

## Phase 8: Cross-Platform Capture & Execution Foundation

**Objective:** Extract the `CaptureAdapter` interface from the existing EventTap, making the capture layer pluggable. Add the type expansions needed for mobile and API platforms. This is the foundation for non-web platform support.

**Dependencies:** Phase 7 (web platform must be complete before expanding to other platforms)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CaptureAdapter` interface | Abstract capture layer: `startCapture() → ObservedEvent[]`, `stopCapture() → void` |
| `WebCaptureAdapter` | Existing EventTap + IdentityExtractor, refactored to implement `CaptureAdapter` |
| `MobileLocatorType` enum expansion | `ACCESSIBILITY_ID`, `CLASS_CHAIN`, `IMAGE_MATCH` (additive to `LocatorStrategyType`) |
| `ApiTarget` variant | Additive member of `ResolvedTarget` discriminated union: `{ kind: 'api', endpoint, method }` |
| `IREnvironment.platform` field | Additive: `'web' | 'mobile' | 'desktop' | 'api'` |
| `IRAction` expansion | Additive: `API_CALL`, `SWIPE`, `LONG_PRESS` (future, not Phase 8 scope) |

### Components Refactored

| Component | Change |
|-----------|--------|
| `EventTap` | Implement `CaptureAdapter` interface; rename internal class to `WebCaptureAdapter` |
| `LocatorStrategyType` | Add mobile/API values (additive enum expansion) |
| `ResolvedTarget` | Add `ApiTarget` variant (additive union member) |
| `IREnvironment` | Add `platform` and `device` fields (additive) |

### User-Visible Functionality Unlocked

No new user-visible features for web users. This phase is infrastructure preparation.

### Acceptance Criteria

- [ ] `CaptureAdapter` interface defined with `startCapture`, `stopCapture`, `onObservedEvent`
- [ ] `WebCaptureAdapter` implements `CaptureAdapter` (EventTap logic unchanged, just wrapped)
- [ ] `LocatorStrategyType` includes mobile and API values (additive)
- [ ] `ResolvedTarget` includes `ApiTarget` variant (additive)
- [ ] `IREnvironment` includes `platform` and `device` fields (additive)
- [ ] Web recording and execution produce identical results as before (zero regression)
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 8 → Phase 9**
- CaptureAdapter interface frozen
- Expanded LocatorStrategyType/ResolvedTarget/IREnvironment frozen

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **CaptureAdapter interface** | ✅ FROZEN |
| **LocatorStrategyType (expanded)** | ✅ FROZEN — DOM + mobile + API |
| **ResolvedTarget (expanded)** | ✅ FROZEN — element + url + none + api |
| **IREnvironment (expanded)** | ✅ FROZEN — platform field |

---

## Phase 9: Platform Expansion — Mobile & API

**Objective:** Implement the first non-web capture and execution engines: Appium for mobile, and an HTTP-level executor for API testing. This proves the cross-platform architecture works end-to-end.

**Dependencies:** Phase 8 (CaptureAdapter interface and type expansions)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `MobileCaptureAdapter` | Implements `CaptureAdapter`: Appium event bridge → ObservedEvent with mobile context |
| `ApiCaptureAdapter` | Implements `CaptureAdapter`: HTTP proxy / OpenAPI spec import → ObservedEvent with API context |
| `AppiumExecutor` | Implements `IRExecutor`: mobile execution via Appium driver |
| `ApiExecutor` | Implements `IRExecutor`: HTTP-level execution via fetch/supertest |
| `AppiumCodeGenerator` | Implements `IRCodeGenerator`: Appium test code generation |
| `MobileIdentityExtractor` | Mobile-specific identity (accessibility ID, class name, resource ID) |
| `ApiInteractionMapper` | Maps HTTP requests/responses to SemanticInteraction types |

### User-Visible Functionality Unlocked

- **Mobile test recording:** QA tester records a workflow on a mobile app via Appium
- **API test generation:** QA tester imports an OpenAPI spec or records HTTP traffic
- **Cross-platform test suites:** Same business capability has web, mobile, and API variants

### Acceptance Criteria

- [ ] `MobileCaptureAdapter` captures at least 5 mobile interaction types (tap, long-press, swipe, text entry, navigation)
- [ ] `AppiumExecutor` executes IR plans with mobile locator types
- [ ] `ApiExecutor` executes IR plans with `API_CALL` action and `ApiTarget`
- [ ] Mobile interactions produce valid `SemanticInteraction[]` (same 22+3-field model)
- [ ] Capability matching works across platforms (web login + mobile login → same capability)
- [ ] All existing web tests pass (zero regression from type expansions)

### Phase Gate

**GATE: Phase 9 → Phase 10**
- Mobile/API capture + executor contracts frozen
- Cross-platform SemanticInteraction validated

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **MobileCaptureAdapter contract** | ✅ FROZEN |
| **AppiumExecutor contract** | ✅ FROZEN |
| **ApiExecutor contract** | ✅ FROZEN |
| **Cross-platform SemanticInteraction** | ✅ Validated — same model works for web + mobile + API |

---

## Phase 10: Continuous Learning & Platform Intelligence

**Objective:** Activate the continuous learning flywheel: every recording, every execution, and every failure enriches the capability model. The platform gets smarter about what each capability looks like, what its failure modes are, and what test coverage gaps exist.

**Dependencies:** Phase 4 (AI generation), Phase 7 (AI failure analysis), Phase 9 (cross-platform data)

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CapabilityEnrichmentPipeline` | Automated enrichment: new recording → match existing capability → update inputs/outcomes/rules/failure modes |
| `CoverageAnalyzer` | Maps capabilities to test cases; identifies untested capabilities and untested data variants |
| `ImpactAnalyzer` | Given a UI change (element healed), determines which capabilities and test cases are affected |
| `WorkflowMiner` | Discovers common capability sequences across recordings |
| `RegressionDetector` | Compares execution results across runs to detect regressions automatically |
| `MaintenanceRecommender` | AI-powered recommendations for test health, coverage gaps, and healing needs |

### Why This Phase Must Come Last

Continuous learning requires all prior phases:
- Capability model (Phase 2) for the learning substrate
- Execution results (Phase 5-6) for empirical data
- AI analysis (Phase 4, 7) for intelligent recommendations
- Cross-platform data (Phase 9) for comprehensive coverage

### User-Visible Functionality Unlocked

- **Coverage dashboard:** Visual map of capabilities vs test cases (green/yellow/red)
- **Impact analysis:** "Login button was redesigned. 3 capabilities and 12 test cases are affected"
- **Regression detection:** "Login capability now fails on Firefox (was passing). Root cause: button text changed"
- **Maintenance recommendations:** Weekly AI digest of test health, coverage gaps, and healing needs
- **Workflow patterns:** "Users commonly perform Login → Search → Book → Pay. Consider a composite test case"

### Acceptance Criteria

- [ ] `CapabilityEnrichmentPipeline` enriches capabilities automatically from new recordings
- [ ] `CoverageAnalyzer` produces a capability × test-case coverage matrix
- [ ] `ImpactAnalyzer` identifies affected capabilities when elements are healed
- [ ] `RegressionDetector` compares execution results across runs and flags changes
- [ ] `MaintenanceRecommender` produces at least 3 actionable recommendations per project
- [ ] Enrichment history is fully auditable
- [ ] All existing tests pass

### Phase Gate

**GATE: Phase 10 → Platform Complete**
- All learning interfaces frozen
- Platform intelligence activated

### Frozen Contracts

| Contract | Status |
|----------|--------|
| **CoverageAnalyzer interface** | ✅ FROZEN |
| **ImpactAnalyzer interface** | ✅ FROZEN |
| **WorkflowMiner interface** | ✅ FROZEN |
| **RegressionDetector interface** | ✅ FROZEN |
| **MaintenanceRecommender interface** | ✅ FROZEN |
| **Enrichment pipeline contract** | ✅ FROZEN |

---

## Dependency Graph

```
PRE-WORK: Adani One Verification + Characterization Tests
    │
    ▼
PHASE 0: PIPELINE FOUNDATION
    │
    ├── 0a: Dead Code Removal          ─── GATE ───
    │       │
    │       ▼
    ├── 0b: Type Unification           ─── GATE ───
    │       │
    │       ▼
    ├── 0c: Classifier Consolidation   ─── GATE ───
    │       │
    │       ▼
    └── 0d: SemanticInteraction         ─── GATE ───
            │
            ├──────────────────────────────────┐
            ▼                                  ▼
    CRITICAL PATH TRACK                EXECUTION RELIABILITY TRACK
        │                                  │
        ▼                                  ▼
    Phase 1: Persistent              Phase 5: Enhanced Execution
    Semantic Layer                        │
        │                                  ▼
        ▼                              Phase 6: Playwright Executor
    Phase 2: Capability                  │
    Adoption Lifecycle                   │
        │                                │
        ▼                                │
    Phase 3: Capability-                │
    Derived IR                          │
        │                                │
        ▼                                │
    Phase 4: AI Test                │
    Generation                          │
        │                                │
        │                                ▼
        │                          Phase 7: AI Failure
        │                          Analysis & Healing
        │                                │
        └──────────┬─────────────────────┘
                   │
                   ▼
            CROSS-PLATFORM TRACK
                   │
                   ▼
            Phase 8: Capture
            Foundation
                   │
                   ▼
            Phase 9: Mobile
            & API
                   │
                   ▼
            CONVERGENCE
                   │
                   ▼
            Phase 10: Continuous
            Learning
```

**Critical path:** Pre-work → 0a → 0b → 0c → 0d → 1 → 2 → 3 → 4 → 7
**Execution track:** 0d → 5 → 6 → 7
**Cross-platform track:** 7 → 8 → 9
**Convergence:** 4 + 7 + 9 → 10

### Parallelism Opportunities

After Phase 0d is complete, the Critical Path track (1→2→3→4) and the Execution Reliability track (5→6) can proceed in parallel. They converge at Phase 7 (which needs both Phase 4 and Phase 6).

---

## Phase Gate Summary

| Gate | From → To | Critical Criteria |
|------|-----------|-------------------|
| Pre-work → 0a | Adani One fixes verified + characterization tests written | 8 issues verified, 10-interaction baseline captured |
| 0a → 0b | Dead code removed, flag eliminated | Build passes, zero `recorderEngine` references, one content script in manifest |
| 0b → 0c | Types unified | Zero `as any` casts in pipeline, single type definitions |
| 0c → 0d | Classifier consolidated | Single `detectInteractions()`, zero merge-layer references |
| 0d → 1+5 | SemanticInteraction materialized | 22+3-field type frozen, characterization tests pass, real SPA recording correct |
| 1 → 2 | Semantic layer persistent | Repository frozen, Dexie v4 schema frozen |
| 2 → 3 | Capability lifecycle complete | Lifecycle states frozen, versioning frozen, DataRequirement frozen |
| 3 → 4 | Capability IR generation works | IRGenerator frozen, capability → IR pipeline frozen |
| 4 → 7 | AI test generation works | TestGenerationEngine frozen, AnalysisProjection frozen |
| 5 → 6 | Execution enhanced | Evidence fields frozen, wait/retry semantics frozen |
| 6 → 7 | Multi-engine validated | ExecutionEngineRegistry frozen, two engines produce same results |
| 7 → 8 | Web platform complete | RootCauseReport frozen, AIHealingService frozen |
| 8 → 9 | Cross-platform foundation ready | CaptureAdapter frozen, type expansions frozen |
| 9 → 10 | Mobile + API working | Cross-platform SemanticInteraction validated |
| 10 → Done | Platform complete | All learning interfaces frozen |

---

## Frozen Contract Summary

| Phase | Contracts Frozen |
|-------|-----------------|
| 0a | None (code removal only) |
| 0b | Unified DomContext, Unified InteractionType, Unified event type |
| 0c | Unified Classifier output contract |
| 0d | SemanticInteraction (22+3 fields), Observation/Projection boundary, SemanticReasoner output contract, IR Bridge input contract, IRStep.semanticInteractionId |
| 1 | SemanticInteractionRepository, AssertionProjection, ExecutionProjection, Dexie v4 |
| 2 | Capability lifecycle, versioning, composition, DataRequirement, SuccessCriterion, CapabilityMatcher |
| 3 | IRGenerator interface, Capability→IR pipeline, DataResolver, ExecutionIRArtifact.source |
| 4 | AnalysisProjection, TestVariant taxonomy, TestGenerationEngine, PromptBuilder input |
| 5 | Evidence fields, SuiteExecutor, wait/retry semantics |
| 6 | ExecutionEngineRegistry, PlaywrightExecutor contract, multi-engine validated |
| 7 | RootCauseReport, FailureAnalysisEngine, AIHealingService, healing feedback loop, root cause taxonomy |
| 8 | CaptureAdapter, expanded LocatorStrategyType/ResolvedTarget/IREnvironment |
| 9 | Mobile/API capture + executor contracts, cross-platform SemanticInteraction |
| 10 | Coverage/Impact/Regression/Maintenance/WorkflowMiner/Enrichment interfaces |

**Total frozen contracts:** 45+ types and interfaces, all additive to the Phase 0 foundation.

---

## Milestones

Milestones are user-visible checkpoints that mark significant capability additions. Multiple phases may contribute to a milestone.

| Milestone | Phases | What the User Sees |
|-----------|--------|--------------------|
| **M0: Clean Foundation** | Pre-work + 0a-0d | Cleaner extension, no dead code, unified pipeline. Recording and execution produce identical output to before, but the architecture is sound. |
| **M1: Semantic Intelligence** | 1 | Execution reports use semantic names ("Custom dropdown 'Nationality' not found" instead of "Element not found"). Fewer flaky failures from type-aware execution. |
| **M2: Test Management** | 2 | QA tester sees a list of detected capabilities, can review and approve them, define test data sets, and see dependency graphs. Cross-session enrichment makes recordings smarter over time. |
| **M3: Re-Execution** | 3 | QA tester re-executes a test without re-recording. Switches environments (staging ↔ production). Runs the same capability with different data sets. |
| **M4: AI-Powered Test Generation** | 4 | QA tester clicks "Generate Test Variants" → AI proposes positive, negative, boundary, accessibility, and security test cases. All immediately executable. |
| **M5: CI/CD Ready** | 5 + 6 | Retry on transient failure, screenshots on failure, test suite execution, headless Playwright execution, cross-browser testing. Tests can run in CI/CD pipelines. |
| **M6: AI QA Platform (Web)** | 7 | When a test fails, the AI explains why at the business level. AI suggests locator fixes. Element confidence scores reflect real-world reliability. Capability failure modes accumulate. **This is the full AI QA platform for web.** |
| **M7: Cross-Platform** | 8 + 9 | Mobile test recording via Appium. API testing via HTTP/OpenAPI. Same business capability has web, mobile, and API variants. |
| **M8: Platform Intelligence** | 10 | Coverage dashboard, impact analysis, regression detection, maintenance recommendations, workflow pattern discovery. The platform gets smarter with every use. |

### Stopping Points

| If we stop after... | What we have |
|---------------------|-------------|
| M0 (Phase 0d) | Clean recorder with unified architecture. Same functionality as today, but sound foundation. |
| M1 (Phase 1) | Recorder with semantic-aware execution and better assertions. |
| M2 (Phase 2) | Test management platform with capability lifecycle. |
| M3 (Phase 3) | Platform that can re-execute tests without re-recording. |
| M4 (Phase 4) | **AI-powered test generation platform for web apps.** |
| M5 (Phase 6) | CI/CD-ready test platform with Playwright execution. |
| M6 (Phase 7) | **Full AI QA platform for web apps.** |
| M7 (Phase 9) | Cross-platform AI QA (web + mobile + API). |
| M8 (Phase 10) | **Full AI QA Automation platform across web, mobile, and API with continuous learning.** |

---

## Debt-Free Guarantee

### No Temporary Architectures

Every phase introduces components that are permanent. Nothing is built to be thrown away. The `SemanticInteraction` type introduced in Phase 0d is the same type used in Phase 10. The `IRExecutor` interface used in Phase 6 is the same interface used in Phase 9.

### No Parallel Systems

Phase 0 explicitly eliminates ALL existing parallel pipelines:
- 0a: Dead code (control-recorder.ts, deterministic-recorder.ts, src/pipeline/, src/types/)
- 0b: Dual type systems (ObservedEvent/RecordedEvent, dual DomContext, dual InteractionType)
- 0c: Dual classifiers (V1 detectInteractions + V2 detectInteractionsV2 + mergeV1V2)
- 0d: Stub SemanticInteraction (4 fields → 22+3 fields)

After Phase 0, every new component is additive — it implements an existing interface or extends an existing type. No second pipeline, no "v2 alongside v1," no bridge layers between parallel systems.

### Every Phase Is Independently Valuable

| Phase | User Value If We Stopped Here |
|-------|------------------------------|
| Pre-work | Verified Adani One fixes, regression baseline |
| 0a | Cleaner codebase, no dead code, no misleading flags |
| 0b | Single type system, no unsafe casts |
| 0c | Single classifier, no merge layer overhead |
| 0d | Richer interaction metadata, 22+3-field semantic model |
| 1 | Better assertions, type-aware execution, fewer flaky failures |
| 2 | Capability management, data-driven testing, cross-session enrichment |
| 3 | Re-execute without re-recording, environment switching |
| 4 | AI-generated test variants (positive, negative, boundary, security) |
| 5 | Retry, screenshots, test suites — CI/CD ready |
| 6 | Headless Playwright execution, cross-browser testing |
| 7 | AI root-cause analysis, AI-assisted healing |
| 8 | Infrastructure for mobile/API (no user-visible change yet) |
| 9 | Mobile recording + API testing |
| 10 | Coverage analysis, impact analysis, continuous learning |

---

## Cross-References

This document is the authoritative roadmap. The following documents provide supporting context and should reference this document for phase definitions:

| Document | Location | Role |
|----------|----------|------|
| `IMPLEMENTATION_BASELINE.md` | `docs/architecture/` | Engine ownership, file inventory, development rules — **§4 (roadmap) is superseded by this document** |
| `IMPLEMENTATION_BASELINE_SPECIFICATION.md` | `docs/architecture/` | Build/deploy specification |
| `ARCHITECTURE_VALIDATION_REPORT.md` | `docs/architecture/` | Static analysis validation (historical) |
| `RUNTIME_BASELINE_VALIDATION.md` | `docs/architecture/` | Runtime execution path verification |
| `CMDRUNNER_ARCHITECTURAL_EVOLUTION.md` | `docs/architecture/` | Narrative architectural decisions and reasoning — **§7 (roadmap summary) is superseded by this document** |
| `IMPLEMENTATION_ROADMAP.md` | `.drytis/` | Original strategic roadmap — **superseded by this document** |
| `SEMANTIC_INTERACTION_BOUNDARY.md` | `.drytis/` | 22-field observation model design |
| `CAPABILITY_MODEL.md` | `.drytis/` | Four-layer architecture and capability domain model |
| `execution-ir-design.md` | `.drytis/` | IR type system, design principles P1-P5 |
| `PLATFORM_EXECUTION_ARCHITECTURE.md` | `.drytis/` | Semantic context at execution time |
| `MODERN_INTERACTION_ANALYSIS.md` | `.drytis/` | 15-gap analysis across frameworks |
| `COMPOSITE_COMPONENT_ANALYSIS.md` | `.drytis/` | Adani One findings and surface-anchored detection design |
| `architecture-evolution-blueprint.md` | `.drytis/` | 9-phase pipeline evolution plan (historical) |

---

*This document is the definitive implementation roadmap. All future development, bug fixes, and feature additions must follow these phase definitions, sequencing, and acceptance criteria. When in doubt, refer to the phase gates and dependency graph.*
