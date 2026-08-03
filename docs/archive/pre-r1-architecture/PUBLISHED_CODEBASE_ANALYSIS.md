# Published Codebase Analysis — Gap Analysis & Migration Path

**Source:** `upstream/main` (commit `1b61149`) — includes PR #4 `fix/calendar-dropdown-modern-app` (commit `7bfd949`) + 13 BCT lifecycle commits  
**Published build:** v10.9.0, manifest includes Component Runtime + BCT bridge  
**Date:** 2026-07-29

---

## 0. Critical Discovery: Published Build Is NOT Local Master

The local `master` branch (commits from `55fea59` through `fcee3a7`) is a **completely different architecture** from the published extension. They diverged from `upstream/main` at commit `9976ff8` (three-layer-enrichment) and never reconverged.

| Aspect | Local `master` | Published Build (`upstream/main`) |
|---|---|---|
| Architecture | Deterministic Recorder + V1/V2 Evidence Engine | Component Runtime + BCT |
| Core engine | `deterministic-recorder.ts` (3033 lines) | `component-runtime.ts` (548 lines) + `bct-bridge.ts` |
| Event capture | 13 listeners on `document` | Event Tap (527 lines) + Identity Extractor (609 lines) |
| Classification | V1 classifier (807 lines, 24-priority chain) + V2 evidence engine (702 lines, 5 providers) | 13 priority-ordered component definitions + BCT surface detection |
| Enrichment | Semantic reasoner (793 lines) | 3-layer model: type → component detector → meaning resolver (676 lines) |
| IR generation | IR Bridge (716 lines) — custom | IR Bridge (685 lines) — similar but adapted for ComponentInteraction |
| Side panel | Raw events during recording, semantic at stop | Completed interactions during recording (real-time), IR steps at stop |
| Semantic interaction | `DetectedInteraction` (transient) | `ComponentInteraction` (live, enriched, persisted) |
| Storage | Dual: StorageService (chrome.storage) + Repository V2 (Dexie) | Same dual system |
| Execution | IR Executor + self-healing | Same IR Executor + self-healing |

**Implication:** All architecture documents (CMDRECORDER_ARCHITECTURE.md, ARCHITECTURE_REVIEW.md, etc.) were written analyzing the LOCAL master architecture, NOT the published build. The gap analysis and migration plan must be re-grounded.

---

## 1. Actual Architecture of the Published Build

### Pipeline (5 stages)

```
┌──────────────────────────────────────────────────────────────┐
│ STAGE 1: EVENT CAPTURE (content script)                     │
│  event-tap.ts (527 lines) — capture-phase listener          │
│  identity-extractor.ts (609 lines) — 18-field identity      │
│  recorder-entry.ts (259 lines) — MV3 bridge, retry, buffer  │
│                                                              │
│  Output: ObservedEvent { eventType, target: ElementIdentity,│
│    domContext, valueBefore, valueAfter, checkedBefore, ... }│
└──────────────────────────┬───────────────────────────────────┘
                           │ chrome.runtime.sendMessage
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 2: COMPONENT RUNTIME (service worker)                 │
│  component-runtime.ts (548 lines) — lifecycle engine        │
│  sw-integration.ts (900 lines) — SW bridge, MV3 recovery    │
│  bct-bridge.ts — Behavioural Control Tracker (surface det)  │
│                                                              │
│  13 component definitions (priority-ordered):               │
│    DatePicker(10) > Dropdown(20) > Slider(25) >             │
│    Checkbox(30) > FileUpload(35) > RadioButton(40) >        │
│    TextEntry(50) > Hover(60) > Tab(65) > Link(70) >         │
│    Scroll(110) > Navigation(120) > Click(180 fallback)     │
│                                                              │
│  Lifecycle: trigger → active → completed/abandoned          │
│  Dedup: per-type, 2s window, elementKey comparison          │
│  Timeout: 15s max lifecycle per component                   │
│                                                              │
│  Output: ComponentInteraction { id, type, triggerEvent,     │
│    memberEvents[], target, value, metadata, start/end }     │
└──────────────────────────┬───────────────────────────────────┘
                           │ onEmit callback
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 3: ENRICHMENT (inline in onEmit)                      │
│  enrich.ts (54 lines) — single entry point                 │
│  component-detector.ts (281 lines) — Layer 2: framework +   │
│    component type detection (18 rules, 11 framework regexes)│
│  meaning-resolver.ts (186 lines) — Layer 3: business meaning│
│                                                              │
│  Output: ComponentInteraction with:                         │
│    componentType, componentFramework, businessMeaning       │
│    attached                                                 │
└──────────────────────────┬───────────────────────────────────┘
                           │ persist immediately
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 4: IR GENERATION (at STOP_RECORDING)                  │
│  service-worker.ts handleStopRecording():                   │
│    1. filterProductionInteractions(allInteractions)         │
│    2. Build synthetic DetectedInteraction[] (adapter)       │
│    3. ir-bridge.ts buildIRPlan({ interactions })            │
│    4. PlaywrightCodeGenerator.generate(plan)                │
│                                                              │
│  Output: ExecutionIRPlan { steps: IRStep[] } +              │
│    GeneratedFile[] (Playwright spec files)                  │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ STAGE 5: PERSISTENCE & EXECUTION                            │
│  session-persistence-service.ts → Dexie V2                  │
│    RecordingSession, Capability, ExecutionIRArtifact        │
│                                                              │
│  ir-executor-impl.ts → Chrome tab execution                 │
│    locator-resolver.ts → action-executor.ts →               │
│    assertion-evaluator.ts → self-healing via Dexie          │
└──────────────────────────────────────────────────────────────┘
```

### File Inventory at Commit 7bfd949

```
src/
├── adapters/playwright/     (7 files, 2,684 lines) — COMPLETE codegen
├── ai/                     (8 files) — provider management (not core)
├── background/              (1 file, 768 lines) — service worker
├── classifier/evidence/    (11 files) — V2 evidence engine (LEGACY, not used)
├── definitions/             (14 files, ~1,800 lines) — component definitions
├── domain/                  (16 files) — entities, execution-ir, locator-ranking
├── enrichment/              (5 files, 676 lines) — 3-layer model
├── execution/               (4 files, 2,140 lines) — executor, resolver, assertions
├── generation/              (2 files, 747 lines) — IR bridge
├── presentation/            (1 file) — output adapter
├── recorder/               (14 files) — pipeline, recognition, enrichment (LEGACY)
├── repository/             (26 files) — Repository V2 (Dexie) + legacy service
├── runtime/                 (3 files, ~850 lines) — component runtime
├── shared/                  (8 files) — types, messaging, constants
├── sidepanel/               (3 files, 2,291 lines) — UI
├── tap/                     (2 files, 1,136 lines) — event tap + identity
├── tracker/                 (BCT files — only in upstream/main, not fix branch)
├── screenshots/             (1 file) — screenshot service
├── settings/                (3 files) — settings page
├── storage/                 (2 files) — storage service
└── manifest.json
```

**159 TypeScript source files, 149 test files = 3,414 tests passing**

---

## 2. What Already Matches the Target Architecture

| Target Concept | Published Implementation | Status |
|---|---|---|
| **Lifecycle-based interaction recognition** | Component Runtime engine: trigger → active → completed/abandoned/interrupted. 13 definitions with priority-ordered discovery. | ✅ **Matches.** This IS the lifecycle engine. The target architecture's "lifecycle definitions" are already real. |
| **Priority-ordered component definitions** | `ALL_DEFINITIONS` array with priority integers (10–180). First match wins. Click(180) is universal fallback. | ✅ **Matches.** Priority dispatch is the correct pattern. |
| **Immutable element identity** | `ElementIdentity` (18 fields) extracted at capture time via 10-tier name cascade, 4-strategy target resolution, 7-strategy value capture. Never touches live DOM after snapshot. | ✅ **Matches.** This is the right abstraction for target resolution. |
| **Real-time semantic timeline** | Side panel listens for `INTERACTION_CAPTURED` messages and re-renders from `LIVE_INTERACTIONS_KEY` immediately. Shows completed interactions, not raw events. | ✅ **Matches.** The "normal recording experience should NOT expose raw events" requirement is already satisfied. |
| **Enrichment layers** | 3-layer model: type → component detector (18 rules, 11 frameworks) → meaning resolver. Mutates `ComponentInteraction` in-place during `onEmit`. | ✅ **Matches** the concept. Simpler than proposed but functionally present. |
| **IR generation from interactions** | IR Bridge maps `DetectedInteraction.type` → `IRAction`, resolves locators via shared `rankLocatorCandidates()`, generates descriptions + assertions. | ✅ **Matches.** The IR bridge is functional and generates correct Playwright code. |
| **Self-healing execution** | `IRExecutorImpl` has runtime healing: fail locator → extract DOM context → rank candidates → persist healed locator → retry. Closed feedback loop with Dexie. | ✅ **Matches.** Self-healing is real and functional. |
| **Shared locator ranking** | `locator-ranking.ts` (319 lines) — single function used by both IR bridge (recording-time) and executor (execution-time). 5 categories, confidence scoring, auto-ID filtering. | ✅ **Matches.** This is exactly the "shared spine" the target architecture calls for. |
| **MV3 resilience** | Event buffering in `sessionStorage`, exponential backoff retry, runtime snapshot/restore, immediate persistence (no debounce). | ✅ **Matches.** MV3 service worker termination is handled. |
| **Repository V2 (Dexie/IndexedDB)** | 9 tables, Unit of Work pattern, capability matching, element matching. | ✅ **Matches.** Storage layer is solid. |
| **Playwright codegen** | 7 files, 2,684 lines. Full project generation: package.json, config, test files, page objects, assertions. | ✅ **Matches.** Codegen is production-ready. |
| **BCT surface detection** | Behavioural Control Tracker runs alongside Component Runtime. MutationObserver-based, framework-agnostic surface detection. | ✅ **Matches.** This is actually MORE advanced than the target architecture envisioned — the component-aware semantic reasoning layer. |

---

## 3. What Needs Refactoring

| Component | Current State | Target State | Refactoring Required |
|---|---|---|---|
| **ComponentInteraction model** | Has enrichment fields (`componentType`, `businessMeaning`) mutated in-place. No separation between observation and projection. No `beforeState`/`afterState`. No `evidence` object. No `confidence` on the interaction itself. No `behavioralSignature`. | Immutable `SemanticInteraction` with 22 frozen observation fields. Enrichment/IR/execution/AI concerns in separate projections. | **Major refactor.** Rename `ComponentInteraction` → `SemanticInteraction`. Extract enrichment fields to projections. Add missing fields (`beforeState`, `afterState`, `evidence`, `confidence`, `behavioralSignature`). Freeze the model. |
| **Adapter impedance mismatch** | SW builds synthetic `DetectedInteraction[]` from `ComponentInteraction[]` at lines 249–257 of service-worker.ts. IR Bridge expects `DetectedInteraction[]` but the real type is `ComponentInteraction`. | IR Bridge should consume `SemanticInteraction` directly. No adapter shape. | **Medium refactor.** Change IR Bridge input type from `DetectedInteraction` to `SemanticInteraction`. Remove adapter in SW. |
| **Enrichment mutates in-place** | `enrichInteraction()` mutates `ComponentInteraction` directly — adds `componentType`, `businessMeaning`. | Enrichment should produce an `EnrichmentProjection` associated with the interaction ID, not mutate the interaction. | **Medium refactor.** Change `enrich.ts` to return a projection object. SW stores both. |
| **IR Bridge degraded inputs** | Called with `events: []` and `understanding: null`. Assertion derivation produces nothing. Only interaction-type-based assertions exist. | IR Bridge should derive assertions from `SemanticInteraction.afterState`, `evidence`, and `UnderstandingResult`. | **Medium refactor.** Wire `events` (or `evidence` from SemanticInteraction) and `understanding` into IR Bridge. |
| **Dual storage** | `RepositoryService` (chrome.storage.local) for project hierarchy + `Repository V2` (Dexie) for sessions/elements/IR. Two parallel systems with implicit bridging. | Unified storage layer. Either Dexie-only (with project hierarchy tables) or explicit adapter. | **Medium refactor.** Migrate `RepositoryService` to Dexie tables. Remove chrome.storage.local for anything except raw key-value flags (RECORDING_ACTIVE, SESSION_CONTEXT). |
| **Execution: no retry, no polling** | `retryCount`/`retryDelayMs` defined in `IRStep.executionParameters` but never used. `resolveElementWithWait()` exists but not wired. Single-attempt locator resolution. | Retry with configurable counts. Polling-based locator resolution. Screenshot on failure. | **Medium refactor.** Wire `retryCount` into executor loop. Add `resolveElementWithWait` to content script. Add screenshot capture on step failure. |
| **Execution: count assertions hardcoded** | Assertion evaluator hardcodes count to 1/0. | Should use real element counts from DOM. | **Minor refactor.** Fix assertion-evaluator.ts count logic. |
| **Hover definition complexity** | 333 lines, confidence-based promotion with 5 signal types. Complex and potentially fragile. | Simplify to: dwell threshold + overlay detection. Remove confidence decay model. | **Minor refactor.** Reduce hover to 2 signals (dwell + overlay). Keep as definition but simpler. |
| **ModalTracker dead code** | 114 lines, defined but not wired into runtime. | Remove or wire it. | **Minor refactor.** Remove `modal-tracker.ts`. BCT handles surface detection. |
| **Navigation event creation** | Two sources: (1) Event Tap monkey-patches History API in content script, (2) SW listens to `chrome.webNavigation.onCommitted`. Potential double-counting. | Single source of truth for navigation. | **Minor refactor.** Keep `webNavigation.onCommitted` (more reliable), remove History API monkey-patch. |

---

## 4. What Can Be Reused Unchanged

| Component | Lines | Why It's Reusable |
|---|---|---|
| **event-tap.ts** | 527 | Pure event capture. Capture-phase listeners, SPA value tracking, post-click polling. Architecture-agnostic. |
| **identity-extractor.ts** | 609 | Immutable identity extraction. 10-tier name cascade, 4-strategy target resolution, 7-strategy value capture, display-value fallback. This is the correct target resolution layer. |
| **recorder-entry.ts** | 259 | MV3 content script bridge. Event buffering, exponential backoff, lifecycle management. |
| **component-runtime.ts** | 548 | The lifecycle engine. Active stack, priority dispatch, dedup, stale cleanup, MV3 snapshot/restore. Core algorithm is correct. |
| **patterns.ts** | 519 | Pure functions on identity strings. All CSS class regexes, role checks, element type detection. Framework-agnostic patterns. |
| **All 13 component definitions** | ~1,800 | click, text-entry, dropdown, date-picker, checkbox, radio-button, hover, scroll, navigation, slider, tab, file-upload, link. Each defines trigger/scope/completion. |
| **locator-ranking.ts** | 319 | Shared ranking function. 5 categories, confidence scoring, auto-ID filtering. Used by both recording and execution. |
| **Playwright adapter (7 files)** | 2,684 | Complete codegen: action/locator/assertion renderers, project generator, test function renderer, page object renderer. |
| **IR Bridge (ir-bridge.ts)** | 685 | Interaction → IRStep mapping, locator resolution, description generation, readability rules. Needs input type change but core logic reusable. |
| **action-executor.ts** | 288 | React/Vue-compatible DOM action executors. |
| **assertion-evaluator.ts** | 383 | Full assertion matrix (visibility, presence, text, attribute, count, equality). |
| **Dexie database + repositories** | ~1,200 | 9-table schema, Unit of Work pattern, repository interfaces. |
| **sw-integration.ts** | 900 | SW bridge: init/stop/process/recover. MV3 recovery logic. Needs refactoring for SemanticInteraction but structure is sound. |
| **BCT bridge + tracker** | ~1,000 | Surface detection via MutationObserver. Framework-agnostic. |
| **session-persistence-service.ts** | 168 | Recording session → Dexie persistence with capability matching. |
| **bct-bridge.ts** | ~200 | Content script bridge for BCT surface events. |

**Total reusable: ~10,000+ lines of production code**

---

## 5. What Should Be Removed

| Component | Lines | Why Remove |
|---|---|---|
| **classifier/evidence/** (V2 evidence engine) | ~2,600 | 5 providers (DomProvider 909, AriaProvider 405, EventSequenceProvider 319, MutationProvider 367, CssClassnameProvider 415) + engine (702) + merge-layer (188) + detector + combination + ab-comparison. **Not used** in published build. BCT + Component Runtime replace this entirely. Dead code. |
| **recorder/recognition/** (behavioral-recognizer, component-registry, orchestrator, pattern-catalogue, structural-recognizer) | ~1,500 | Phase 5 lifecycle engine. **Not used** in published build. Component Runtime replaces this. Dead code. |
| **recorder/enrichment/** (7 files) | ~1,200 | behavioral-contract-deriver, capability-deriver, dom-inspector, enrichment-orchestrator, fragment-assembler, interaction-contract-deriver, option-set-extractor, semantic-aggregator, surface-deriver, workflow-deriver. **Not used** in published build. 3-layer enrichment model replaces this. Dead code. |
| **recorder/pipeline/domain-adapter.ts** | ~300 | Phase 5 pipeline adapter. **Not used**. |
| **recorder/pipeline/pipeline-runner.ts** | ~200 | Phase 5 pipeline runner. **Not used**. |
| **recorder/deterministic-recorder.ts** | 3,033 | Only on local master, not in published build. Deterministic recorder was the pre-Component-Runtime approach. **Already absent** from published build. |
| **classifier/interaction-detector.ts** | ~400 | V1 classifier. **Not used** in published build. |
| **classifier/interaction-types.ts** | ~500 | V1 interaction types. **Not used**. |
| **enrichment (Phase 5)** | ~800 | `recorder/enrichment/` — the old enrichment pipeline. Replaced by `src/enrichment/` 3-layer model. |
| **modal-tracker.ts** | 114 | Defined but never wired. BCT handles surface detection. |
| **Legacy enrichment classes** | ~500 | behavioral-contract-deriver, interaction-contract-deriver, etc. in `recorder/enrichment/`. |

**Total removable: ~8,000+ lines of dead code**

---

## 6. What Should Be Introduced

| Component | Priority | Description |
|---|---|---|
| **SemanticInteraction model** | P0 (Phase 0) | The 22-field frozen observation contract. Replaces `ComponentInteraction` as the canonical interaction type. See SEMANTIC_INTERACTION_BOUNDARY.md. |
| **SemanticInteraction persistence** | P0 | Store `SemanticInteraction[]` in RecordingSession (Dexie). Currently RecordingSession does not store interactions. Add `semanticInteractions` field to the session entity. |
| **SemanticInteractionId back-link** | P0 | Add `semanticInteractionId` to `IRStep`. Enables tracing any executed step back to the original observation. |
| **Capability model (adopted)** | P1 | Approved Capability entities with UUID, name, version, dependencies, success criteria. Currently only `CapabilityCandidate` exists (inference phase). Adoption phase (human review → approved) needs to be built. |
| **ExecutionProjection** | P1 | Runtime data attached to SemanticInteraction during execution: retry count, healing events, screenshots, timing. Currently scattered in ExecutionRun. |
| **DataRequirement for capabilities** | P2 | Parameterized test cases (data-driven testing). Capability declares input variables; execution substitutes them. |
| **Real-time pipeline architecture** | P2 | Currently IR Bridge runs at STOP_RECORDING (batch). Target: incremental IR generation during recording, with final pass at stop. |
| **AssertionProjection** | P2 | Derive assertions from SemanticInteraction.afterState + evidence, not from UnderstandingResult (which is null). |
| **AnalysisProjection (AI)** | P3 | AI reasoning layer: intent categorization, relationship inference, test generation suggestions. |
| **Unified storage** | P2 | Migrate RepositoryService (chrome.storage.local) into Dexie tables. Single storage engine. |

---

## 7. Gap Analysis Summary

```
Current Published Build              Target Architecture
┌──────────────────────┐             ┌──────────────────────┐
│ Event Tap            │             │ Event Tap            │ ✅ KEEP
│ Identity Extractor   │             │ Identity Extractor   │ ✅ KEEP
│                      │             │                      │
│ Component Runtime    │             │ Lifecycle Engine     │ ✅ KEEP (rename)
│ + BCT                │             │ + Surface Detection  │ ✅ KEEP
│                      │             │                      │
│ ComponentInteraction │ ──────────► │ SemanticInteraction  │ 🔧 REFACTOR
│ (mutable, enriched)  │             │ (immutable, frozen)  │
│                      │             │                      │
│ enrich.ts            │             │ EnrichmentProjection │ 🔧 REFACTOR
│ (mutates in-place)   │             │ (separate projection)│
│                      │             │                      │
│ IR Bridge            │             │ IR Bridge            │ 🔧 REFACTOR
│ (DetectedInteraction │             │ (SemanticInteraction │   (input type)
│  input, adapter)     │             │  input, no adapter)  │
│                      │             │                      │
│ Playwright Codegen   │             │ Playwright Codegen   │ ✅ KEEP
│                      │             │                      │
│ Repository V2 (Dexie)│             │ Unified Repository   │ 🔧 REFACTOR
│ + RepositoryService  │             │ (Dexie only)         │   (merge)
│                      │             │                      │
│ IR Executor          │             │ IR Executor          │ 🔧 REFACTOR
│ (no retry, no        │             │ (retry, polling,     │   (enhance)
│  polling, no screenshot)│          │  screenshot)         │
│                      │             │                      │
│ Self-healing         │             │ Self-healing         │ ✅ KEEP
│                      │             │                      │
│ Capability (candidate)│            │ Capability (adopted) │ 🆕 INTRODUCE
│                      │             │                      │
│ --                   │             │ ExecutionProjection  │ 🆕 INTRODUCE
│ --                   │             │ AssertionProjection  │ 🆕 INTRODUCE
│ --                   │             │ AnalysisProjection   │ 🆕 INTRODUCE
│                      │             │                      │
│ Side Panel           │             │ Side Panel           │ ✅ KEEP
│ (real-time timeline) │             │ (real-time timeline) │
│                      │             │                      │
│ V2 Evidence Engine   │             │ --                   │ ❌ REMOVE
│ Phase 5 Recognition  │             │ --                   │ ❌ REMOVE
│ Phase 5 Enrichment   │             │ --                   │ ❌ REMOVE
│ Legacy Pipeline      │             │ --                   │ ❌ REMOVE
└──────────────────────┘             └──────────────────────┘
```

### Quantitative Summary

| Category | Files | Lines (approx) |
|---|---|---|
| ✅ Keep unchanged | ~55 | ~10,000 |
| 🔧 Refactor | ~15 | ~3,500 |
| ❌ Remove (dead code) | ~30 | ~8,000 |
| 🆕 Introduce | ~10 | ~2,000 |

---

## 8. Recommended Migration Path

### Guiding Principle: Rename, Don't Rebuild

The published build's architecture is fundamentally sound. The Component Runtime + BCT + IR Bridge + Playwright codegen pipeline is the correct foundation. The migration should **evolve** this code, not replace it.

The biggest risk is over-engineering — introducing SemanticInteraction, projections, capabilities, and a new pipeline simultaneously. Instead, introduce changes in small, independently-testable phases where each phase produces a working extension.

---

### Phase 0: Dead Code Removal + Model Rename (Lowest Risk)

**Goal:** Reduce surface area to what's actually used. Rename `ComponentInteraction` → `SemanticInteraction`.

**Steps:**
1. Remove `src/classifier/evidence/` (11 files, ~2,600 lines)
2. Remove `src/recorder/recognition/` (5 files, ~1,500 lines)
3. Remove `src/recorder/enrichment/` (10 files, ~1,200 lines)
4. Remove `src/recorder/pipeline/` (2 files, ~500 lines)
5. Remove `src/classifier/interaction-detector.ts`, `interaction-types.ts`
6. Remove `src/runtime/modal-tracker.ts`
7. Rename `ComponentInteraction` → `SemanticInteraction` across all files
8. Add missing fields to SemanticInteraction: `beforeState`, `afterState`, `evidence`, `confidence`, `behavioralSignature`
9. Run all 3,414 tests — fix any breakages from removals

**Verification:** Extension builds, all tests pass, recording on OrangeHRM/AdaniOne produces identical output.

**Risk:** Low — removing code that's already not imported by the production build.

---

### Phase 1: Freeze SemanticInteraction (Immutable Observation)

**Goal:** Separate observation from enrichment. SemanticInteraction becomes immutable.

**Steps:**
1. Define the 22 frozen fields per SEMANTIC_INTERACTION_BOUNDARY.md
2. Remove enrichment fields (`componentType`, `componentFramework`, `businessMeaning`) from SemanticInteraction
3. Create `EnrichmentProjection` type: `{ interactionId, componentType, componentFramework, businessMeaning }`
4. Refactor `enrich.ts` to return `EnrichmentProjection` instead of mutating the interaction
5. Update `sw-integration.ts` to store both `SemanticInteraction` and `EnrichmentProjection`
6. Update side panel to join interaction + projection for display
7. Update IR Bridge to accept `SemanticInteraction[]` + `EnrichmentProjection[]` instead of `DetectedInteraction[]`
8. Remove the synthetic `DetectedInteraction` adapter in service-worker.ts

**Verification:** Recording produces same interactions. IR generation produces same IR plans. Playwright code identical.

**Risk:** Medium — touches SW, enrichment, IR Bridge, and side panel. But each change is a type rename + field move, not logic change.

---

### Phase 2: Persist SemanticInteraction + IR Back-link

**Goal:** SemanticInteraction[] stored in RecordingSession. IRStep references its source interaction.

**Steps:**
1. Add `semanticInteractions: SemanticInteraction[]` to RecordingSession entity
2. Update `session-persistence-service.ts` to store interactions in the session
3. Add `semanticInteractionId` field to `IRStep` type
4. Update IR Bridge to populate `semanticInteractionId` from the source interaction's `id`
5. Update executor to log which SemanticInteraction each step came from

**Verification:** Recording session in Dexie contains SemanticInteraction[]. IR steps trace back to source interactions.

**Risk:** Low — additive fields, no existing logic changes.

---

### Phase 3: Execution Enhancements

**Goal:** Wire retry, polling, screenshots into the executor.

**Steps:**
1. Wire `retryCount`/`retryDelayMs` from `IRStep.executionParameters` into executor loop
2. Add `resolveElementWithWait` (polling-based) to executor content script
3. Add screenshot capture on step failure (`chrome.tabs.captureVisibleTab`)
4. Fix count assertion logic in assertion-evaluator.ts
5. Add iframe switching support (resolve locator in iframe context)

**Verification:** Execution retries on locator failure. Screenshots saved on failure. Count assertions use real DOM counts.

**Risk:** Medium — changes execution path, but additive (retry wraps existing logic).

---

### Phase 4: Unified Storage

**Goal:** Migrate RepositoryService (chrome.storage.local) into Dexie.

**Steps:**
1. Add Project/Feature/Scenario/TestCase hierarchy tables to Dexie schema (v4)
2. Implement migration: read existing chrome.storage.local data → write to Dexie
3. Refactor RepositoryService to use Dexie repositories instead of StorageService
4. Keep only raw flags (RECORDING_ACTIVE, SESSION_CONTEXT) in chrome.storage.local

**Verification:** Side panel project hierarchy works. Recording sessions persist. No data loss.

**Risk:** Medium — migration must be idempotent. Schema version bump requires careful upgrade path.

---

### Phase 5: Capability Adoption + Data-Driven Testing

**Goal:** Build the capability adoption phase. Enable data-driven testing.

**Steps:**
1. Extend Capability entity: UUID, name, version, dependencies[], successCriteria[], dataRequirements[]
2. Build capability review UI in side panel (review CapabilityCandidate → approve → create Capability)
3. Build data-driven execution: substitute DataRequirement values into IRSteps
4. Add capability coverage analysis (which interactions belong to which capability)

**Verification:** User can review and approve capabilities. Data-driven tests run with parameterized inputs.

**Risk:** Medium — new UI, new storage entities. But additive to existing flow.

---

### Phase 6: Real-Time IR Generation (Incremental Pipeline)

**Goal:** IR generation shifts from batch-at-stop to incremental-during-recording.

**Steps:**
1. Move IR Bridge call from `handleStopRecording` to `onEmit` callback
2. Generate IRStep incrementally as each SemanticInteraction completes
3. Side panel shows IR steps in real-time during recording
4. Final pass at stop applies readability rules (merge consecutive clicks)

**Verification:** IR steps appear during recording. Final plan matches batch-generated plan.

**Risk:** High — changes the core pipeline timing. Requires careful testing to ensure incremental IR matches batch IR. Mitigate with feature flag: `INCREMENTAL_IR = false` by default.

---

## 9. Key Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|--- |
| Dead code removal breaks hidden dependency | Medium | Low | Run all 3,414 tests. If a removed file is imported, the build fails immediately. |
| SemanticInteraction rename causes merge conflicts | High | Low | Do rename in a dedicated commit. Use IDE rename refactoring. |
| IR Bridge input type change breaks generation | Medium | High | Keep a `DetectedInteraction → SemanticInteraction` adapter initially. Remove adapter only after IR Bridge is verified. |
| Storage migration loses data | Low | Critical | Idempotent migration. Keep chrome.storage.local as fallback for one release. |
| Incremental IR produces different plans than batch | Medium | Medium | Feature flag. Run both paths in parallel during testing. Compare output. |
| BCT + Component Runtime interactions change during refactor | Low | Medium | Don't touch BCT or Component Runtime internals. Only change their output type. |
| Local master has 25 unpushed commits | High | Medium | These are on a different architecture. They should be preserved as a branch but NOT merged into the target. The target evolves from `upstream/main`. |

---

## 10. Critical Decision: Local Master vs Upstream Main

The local `master` branch contains extensive work (deterministic recorder, V1/V2 evidence engine, semantic reasoner, 25+ commits) that is on a **different architectural path** from the published build.

**Recommendation:** Base Phase 0 on `upstream/main` (commit `1b61149`). The local master work should be:
1. Preserved as `legacy/deterministic-recorder` branch
2. Mined for reusable concepts (semantic reasoner patterns, guard rails, component-aware reasoning)
3. NOT merged into the migration target

The published build's Component Runtime + BCT architecture is the correct starting point because:
- It's what users have installed
- It's simpler (548 lines vs 3,033 for deterministic recorder)
- It already has real-time semantic timeline
- It already has BCT surface detection (the component-aware reasoning layer)
- It has 3,414 passing tests
- It works on real applications (OrangeHRM, AdaniOne)

The architecture documents we created (SEMANTIC_INTERACTION_BOUNDARY.md, CAPABILITY_MODEL.md, etc.) remain valid as **design targets** — but the migration starts from the published codebase, not from the documents.
