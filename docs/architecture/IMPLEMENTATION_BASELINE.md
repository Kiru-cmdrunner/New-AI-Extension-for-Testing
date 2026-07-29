# Implementation Baseline & Target Architecture

**Status:** DEFINITIVE — All future development follows this document.
**Created:** 2026-07-29
**Baseline commit:** `77aa1d6` (master — merge of 7bfd949 + surface-anchored detection fixes)
**Reference:** `docs/architecture/CMDRUNNER_ARCHITECTURAL_EVOLUTION.md` (architectural journey)

---

## 1. Development Baseline

### 1.1 Branch & Commit

| Item | Value |
|------|-------|
| Branch | `master` |
| Baseline commit | `77aa1d6` — "fix: wire surface-anchored detection into 7bfd949 pipeline" |
| Version | v10.9.0 |
| Test count | 4199 passing (1 pre-existing performance timing failure) |

**This is the permanent baseline.** All future development branches from and merges into `master`.

### 1.2 Active Code Paths

The recording pipeline has ONE active data flow. Everything else is either legacy, experimental, or dead.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ACTIVE PIPELINE                                  │
│                                                                          │
│  recorder-entry.ts                                                       │
│       ↓ installs                                                          │
│  tap/event-tap.ts                                                        │
│       ↓ uses                                                             │
│  tap/identity-extractor.ts    definitions/dom-context-extractor.ts       │
│       ↓ produces                                                         │
│  ObservedEvent[]  (shared/component-types.ts)                           │
│       ↓ OBSERVED_EVENT message                                            │
│  background/service-worker.ts                                           │
│       ↓ handleObservedEvent →                                            │
│  runtime/sw-integration.ts → runtime/component-runtime.ts               │
│       ↓ enrichInteraction (enrichment/)                                 │
│       ↓ produces ComponentInteraction[]                                  │
│  ─── On STOP_RECORDING ───                                               │
│  background/service-worker.ts                                           │
│       ↓ extract ObservedEvent[] from ComponentInteraction[]              │
│       ↓ convert to RecordedEvent[] (adapter shim)                        │
│       ↓ detectInteractions()        → V1 classifier                      │
│       ↓ detectInteractionsV2()      → V2 evidence engine (parallel)      │
│       ↓ mergeV1V2()                 → merge layer                        │
│       ↓ reasonAboutInteractions()   → Semantic Reasoner                  │
│       ↓ runPipeline()               → Recognition + Enrichment           │
│       ↓ buildIRPlan()               → IR Bridge                          │
│       ↓ PlaywrightCodeGenerator()   → Code generation                    │
│       ↓ persistSession()            → Repository V2 (Dexie)             │
│       ↓ healFromRecording()          → Cross-session healing              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Active Source-of-Truth Directories

| Directory | Responsibility | Status |
|-----------|---------------|--------|
| `src/tap/` | EventTap + identity extraction (content script side) | ✅ Active |
| `src/definitions/` | Component definitions + DOM context extractor | ✅ Active |
| `src/runtime/` | Component Runtime engine + SW integration | ✅ Active |
| `src/enrichment/` | Component detection + business meaning resolution | ✅ Active |
| `src/classifier/` | V1/V2 classifiers + evidence providers + semantic reasoner | ✅ Active |
| `src/classifier/semantic/` | Semantic Reasoner (sessions, multiConfig, steppers) | ✅ Active |
| `src/classifier/evidence/` | V2 evidence engine + 5 providers + merge layer | ✅ Active (legacy path) |
| `src/recorder/pipeline/` | Pipeline runner + domain adapter | ✅ Active |
| `src/recorder/recognition/` | Recognition orchestrator + patterns | ✅ Active |
| `src/recorder/enrichment/` | Enrichment orchestrator + derivers | ✅ Active |
| `src/recorder/v2/interaction-recognizer.ts` | Control Model recognizer | ✅ Active (control path) |
| `src/presentation/` | Output adapter (filterProductionInteractions) | ✅ Active |
| `src/generation/` | IR Bridge → ExecutionIRPlan | ✅ Active |
| `src/adapters/playwright/` | Playwright code generation | ✅ Active |
| `src/domain/` | Domain entities, enums, locator ranking, execution IR | ✅ Active |
| `src/repository/` | Repository V2 (Dexie) + services (persistence, healing) | ✅ Active |
| `src/shared/types.ts` | Canonical ElementIdentity, UIState, StorageKeys | ✅ Active |
| `src/shared/component-types.ts` | ObservedEvent, ComponentInteraction, DomContext (new) | ✅ Active |
| `src/recorder/recorded-event.ts` | RecordedEvent, DomContext (legacy, rich), RecordedEventMessage | ✅ Active (types only) |
| `src/background/service-worker.ts` | SW pipeline orchestration | ✅ Active |
| `src/sidepanel/` | Side panel UI + timeline renderer | ✅ Active |
| `src/settings/` | Settings page | ✅ Active |
| `src/storage/` | StorageService (chrome.storage.local wrapper) | ✅ Active |

### 1.4 Legacy / Dead / Experimental Code — DO NOT MODIFY

| Path | Status | Reason |
|------|--------|--------|
| `src/recorder/deterministic-recorder.ts` | 🔴 DEAD | Not loaded by manifest. Superseded by `recorder-entry.ts` + `tap/event-tap.ts`. Contains inlined duplicate types. |
| `src/recorder/interaction-types.ts` | 🔴 DEAD | Legacy interaction registry. Only imported by `recording-session.ts` (also dead). |
| `src/recorder/recording-session.ts` | 🔴 DEAD | Legacy session manager. Not imported by active pipeline. |
| `src/recorder/element-id-generator.ts` | 🔴 DEAD | Not imported by active pipeline. |
| `src/recorder/step-id-generator.ts` | 🔴 DEAD | Not imported by active pipeline. |
| `src/recorder/surface-detector.ts` | 🔴 DEAD | Only imported by `deterministic-recorder.ts`. Functionality moved to `definitions/dom-context-extractor.ts`. |
| `src/recorder/v2/control-recorder.ts` | 🔴 DEAD content script | Loaded by manifest but sends `RECORDED_EVENT` messages the SW does not handle. Events go nowhere. |
| `src/recorder/v2/control-model.ts` | 🔴 DEAD | Only used by `control-recorder.ts` (dead path). |
| `src/recorder/v2/element-identity-builder.ts` | 🔴 DEAD | Only used by control-model/v2 (dead path). |
| `src/recorder/v2/framework-adapters.ts` | 🔴 DEAD | Only used by control-model/v2 (dead path). |
| `src/recorder/v2/identity-extractor.ts` | 🔴 DEAD | Only used by control-model/v2 (dead path). |
| `src/runtime/modal-tracker.ts` | ⚠️ DORMANT | `ModalTracker` class exists but is not instantiated. Surface detection is handled by `dom-context-extractor.ts`. |
| `src/pipeline/` (34 files) | 🔴 DEAD | Entire "Blueprint Architecture" directory. Zero imports from outside. Parallel universe to active code. |
| `src/types/` (8 files) | 🔴 DEAD | Only imported by `src/pipeline/` (which is dead). |
| `legacy/` | 🔴 ARCHIVE | Old architecture snapshots. |
| `tmp-build/` | 🔴 ARCHIVE | Full project snapshot (Jul 28). |
| `extension-zip/` | 🔴 ARCHIVE | Built extension package (Jul 28). |
| `src/presentation/output-adapter.ts` `toIRActions()` | ⚠️ DEAD EXPORT | Exported and imported by SW but never called. Only `filterProductionInteractions` is used. IR Bridge has its own mapping. |

### 1.5 Duplicate Type Definitions — Canonical Sources

| Type | Canonical location | Duplicates to eliminate |
|------|-------------------|------------------------|
| `ElementIdentity` | `src/shared/types.ts` L116 | `deterministic-recorder.ts` L25 (dead), `v2/types.ts` ControlNode (dead) |
| `DomContext` (rich, for V1 classifier) | `src/recorder/recorded-event.ts` L35 | `component-types.ts` L48 (simplified, for EventTap) — **must be unified** |
| `InteractionType` (45 values, for classifier) | `src/classifier/interaction-types.ts` L13 | `component-types.ts` L170 (13 values, for Component Runtime) |
| `InteractionMetadata` | `src/classifier/interaction-types.ts` L67 | — |

**Key conflict:** The V1 classifier and semantic reasoner operate on `DetectedInteraction` (from `interaction-types.ts`, 45 interaction types). The Component Runtime operates on `ComponentInteraction` (from `component-types.ts`, 13 interaction types). The SW bridges these via an adapter shim that converts `ObservedEvent[]` → `RecordedEvent[]` and feeds the V1 classifier. This is a temporary bridge — Phase 0 unifies it.

---

## 2. Target Recorder Architecture

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CONTENT SCRIPT                                      │
│                                                                             │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────┐          │
│  │  EventTap   │→ │ IdentityExtractor │→ │  DomContextExtractor   │          │
│  │             │  │                   │  │  (incl. surface detect)│          │
│  └─────────────┘  └──────────────────┘  └────────────────────────┘          │
│         ↓                                                                   │
│  ObservedEvent[]  →  sessionStorage buffer  →  OBSERVED_EVENT message         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVICE WORKER                                       │
│                                                                             │
│  ┌──────────────────┐                                                       │
│  │  Component       │  ObservedEvent → ComponentInteraction[]               │
│  │  Runtime         │  (lifecycle-based: discovery → active → complete)     │
│  └──────────────────┘                                                       │
│         ↓                                                                   │
│  ┌──────────────────┐                                                       │
│  │  Enrichment      │  Component type detection + business meaning          │
│  │  (3-layer)       │                                                       │
│  └──────────────────┘                                                       │
│         ↓ On STOP_RECORDING                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐            │
│  │  Classifier      │  │  Evidence Engine │  │  Merge Layer     │            │
│  │  (V1 detector)   │  │  (V2 providers)  │→ │  (V1+V2 fusion)  │            │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘            │
│         ↓                                                                   │
│  ┌──────────────────┐                                                       │
│  │  Semantic        │  Session-based reasoning: multiConfig, dropdown,      │
│  │  Reasoner        │  datePicker, autocomplete, formSubmit                   │
│  │                  │  Surface-anchored activation + absorption              │
│  └──────────────────┘                                                       │
│         ↓ SemanticInteraction[]                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐            │
│  │  Recognition     │→ │  Enrichment      │→ │  Capability      │            │
│  │  (patterns)      │  │  (derivers)      │  │  Deriver         │            │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘            │
│         ↓ UnderstandingResult                                                │
│  ┌──────────────────┐  ┌──────────────────┐                                 │
│  │  IR Bridge       │→ │  Playwright Gen   │→ Generated test files           │
│  └──────────────────┘  └──────────────────┘                                 │
│         ↓                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐                                 │
│  │  Repository V2   │  │  Healing Service  │→ Cross-session element health   │
│  │  (Dexie/IndexedDB)│  │                  │                                 │
│  └──────────────────┘  └──────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Engine Definitions

#### Engine 1: EventTap
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Capture-phase DOM event listener. Listens for click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, mousemove, keydown, scroll. Also detects SPA navigation (History API monkey-patch). |
| **Inputs** | Live DOM events |
| **Outputs** | `ObservedEvent[]` (sent via `chrome.runtime.sendMessage`) |
| **Owns** | `src/tap/event-tap.ts` |
| **Must never depend on** | Classifier, Semantic Reasoner, Component Runtime, Repository, IR Bridge, Generation pipeline |
| **Status** | ✅ Exists (`src/tap/event-tap.ts`, 527 lines) |
| **Never implement here** | Interaction classification, surface detection, semantic reasoning, business rules, AI logic |

#### Engine 2: Identity Extraction
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Extract `ElementIdentity` from a live DOM element. 18-field snapshot including tag, classes, ARIA attributes, accessible name, CSS selector, XPath, stable ID, test ID. Includes `resolveTarget()` — 4-strategy cascade to resolve the correct target element from an event's `composedPath()`. |
| **Inputs** | Live `Element` + `Event` |
| **Outputs** | `ElementIdentity` (from `src/shared/types.ts`) |
| **Owns** | `src/tap/identity-extractor.ts` |
| **Must never depend on** | DomContext extractor, Classifier, Semantic Reasoner, Component Runtime, Repository |
| **Status** | ✅ Exists (`src/tap/identity-extractor.ts`, 609 lines). Change 1 (ancestor resolution) applied. |
| **Never implement here** | Surface detection, interaction classification, semantic reasoning |

#### Engine 3: DOM Context Extraction
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Extract `DomContext` from a live DOM element — structural information needed by downstream engines but unavailable after the DOM mutates. Includes: surface detection (modal/drawer/popover/tooltip), ancestor roles/classes, ARIA value attributes, input type, contenteditable state. |
| **Inputs** | Live `Element` |
| **Outputs** | `DomContext` (from `src/shared/component-types.ts`) |
| **Owns** | `src/definitions/dom-context-extractor.ts` |
| **Must never depend on** | Identity extractor, Classifier, Semantic Reasoner, Component Runtime |
| **Status** | ✅ Exists + surface detection added (`src/definitions/dom-context-extractor.ts`). Needs unification with `recorded-event.ts` DomContext (Phase 0). |
| **Never implement here** | Event capture, identity extraction, interaction classification |

#### Engine 4: Evidence Channels
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Provide secondary evidence signals that improve classification confidence. 5 providers: DOM attributes, ARIA semantics, event sequences, DOM mutations, CSS classnames. |
| **Inputs** | `RecordedEvent[]` |
| **Outputs** | Evidence signals fed to `InteractionEngine` → `DetectedInteraction[]` |
| **Owns** | `src/classifier/evidence/providers/` (5 files), `src/classifier/evidence/engine.ts`, `src/classifier/evidence/detector.ts`, `src/classifier/evidence/merge-layer.ts` |
| **Must never depend on** | Semantic Reasoner, Component Runtime, Repository, IR Bridge |
| **Status** | ✅ Exists (active in legacy engine path). Parallel blueprint in `src/pipeline/channels/` is DEAD. |
| **Never implement here** | Semantic session logic, multiConfig activation/absorption, business rules |

#### Engine 5: Component Runtime
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Lifecycle-based interaction engine. Processes `ObservedEvent` one at a time through 13 component definitions (priority-ordered). Each definition handles discovery, event processing, and completion. Produces `ComponentInteraction[]` with `triggerEvent` + `memberEvents`. Includes temporal dedup (2s window per type) and stale component cleanup (15s timeout). |
| **Inputs** | `ObservedEvent` (one at a time, live streaming) |
| **Outputs** | `ComponentInteraction[]` (emitted immediately, stored in `liveInteractions`) |
| **Owns** | `src/runtime/component-runtime.ts`, `src/runtime/sw-integration.ts` |
| **Must never depend on** | Classifier, Semantic Reasoner, Evidence Channels, Repository, IR Bridge |
| **Status** | ✅ Exists (`src/runtime/component-runtime.ts`, 548 lines) |
| **Never implement here** | Semantic reasoning, surface-anchored detection, multiConfig sessions, stepper detection, AI logic |

#### Engine 6: Semantic Reasoner
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Post-classification reasoning over `DetectedInteraction[]`. Manages 5 session types (dropdown, datePicker, autocomplete, multiConfig, formSubmit). Detects composite component patterns (multiConfig activation via surface evidence or CSS classes, absorption of internal interactions, completion via Done/Apply). Surface-anchored detection: activates multiConfig when a click opens a surface, absorbs all interactions while surface is open. Stepper detection for icon-only +/- buttons. |
| **Inputs** | `DetectedInteraction[]` + `SessionEvent[]` |
| **Outputs** | Refined `DetectedInteraction[]` with `semanticAction`, `configuredFields`, session metadata |
| **Owns** | `src/classifier/semantic/reasoner.ts`, `src/classifier/semantic/types.ts`, `src/classifier/semantic/detectors.ts`, `src/classifier/semantic/panel-form-detectors.ts`, `src/classifier/semantic/index.ts` |
| **Must never depend on** | EventTap, Component Runtime, Evidence Channels, Repository, IR Bridge |
| **Status** | ✅ Exists with all 5 surface-anchored changes applied (Changes 1-5). |
| **Never implement here** | Event capture, identity extraction, DOM context, component lifecycle management, IR generation |

#### Engine 7: Recognition & Enrichment Pipeline
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Post-semantic enrichment. Recognizes UI component patterns (forms, tables, navigation bars) from the semantic interactions. Derives application knowledge fragments (business workflows, field contracts). Derives capability candidates. |
| **Inputs** | `RecordedEvent[]` + `DetectedInteraction[]` (semantically refined) |
| **Outputs** | `UnderstandingResult` (ApplicationKnowledgeFragment + CapabilityCandidate) |
| **Owns** | `src/recorder/pipeline/pipeline-runner.ts`, `src/recorder/pipeline/domain-adapter.ts`, `src/recorder/recognition/` (5 files), `src/recorder/enrichment/` (10 files) |
| **Must never depend on** | EventTap, Component Runtime, Evidence Channels |
| **Status** | ✅ Exists |
| **Never implement here** | Event capture, interaction classification, semantic session management |

#### Engine 8: IR Bridge
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Convert `DetectedInteraction[]` + `UnderstandingResult` → `ExecutionIRPlan` (action steps with locators, assertions, descriptions). Applies readability rules (merge consecutive same-target clicks, merge consecutive fills). |
| **Inputs** | `IRBridgeInput` (events, interactions, understanding, recordingContext, testCaseName) |
| **Outputs** | `ExecutionIRPlan` (array of `IRStep`) |
| **Owns** | `src/generation/ir-bridge.ts`, `src/generation/ir-bridge-input.ts` |
| **Must never depend on** | EventTap, Component Runtime, Evidence Channels, Semantic Reasoner (consumes its output, not its internals) |
| **Status** | ✅ Exists (716 lines) |
| **Never implement here** | Event capture, classification, semantic reasoning, code rendering |

#### Engine 9: Code Generation (Playwright)
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Render `ExecutionIRPlan` to Playwright TypeScript test files. Includes page object model generation, action rendering, assertion rendering, locator rendering. |
| **Inputs** | `ExecutionIRPlan` + generation options |
| **Outputs** | Generated test files (TypeScript) |
| **Owns** | `src/adapters/playwright/` (6 files) |
| **Must never depend on** | EventTap, Component Runtime, Classifier, Semantic Reasoner, Recognition, Enrichment |
| **Status** | ✅ Exists |
| **Never implement here** | IR plan construction, semantic reasoning, event capture |

#### Engine 10: Repository V2
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Persist recording sessions, capabilities, elements, execution runs, test cases to IndexedDB via Dexie. Unit-of-work pattern for transactional writes. |
| **Inputs** | `UnderstandingResult` + `ExecutionIRPlan` + events + interactions |
| **Outputs** | Persisted entities (session ID, capability ID, element IDs) |
| **Owns** | `src/repository/v2/` (Dexie repositories, interfaces, unit-of-work), `src/repository/services/session-persistence-service.ts`, `src/repository/services/capability-matching-service.ts` |
| **Must never depend on** | EventTap, Component Runtime, Classifier, Semantic Reasoner, Code Generation |
| **Status** | ✅ Exists |
| **Never implement here** | Event capture, classification, semantic reasoning, code generation |

#### Engine 11: Healing Service
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Cross-session element locator healing. Matches fresh `UiElement` identities against stored `Element` records. Heals broken locators by finding the best surviving locator candidate. |
| **Inputs** | Project ID + `UiElement[]` + session ID |
| **Outputs** | Healing result (healed count, created count) |
| **Owns** | `src/repository/services/healing-service.ts`, `src/repository/services/element-matching-service.ts`, `src/domain/locator-ranking.ts` |
| **Must never depend on** | EventTap, Component Runtime, Classifier, Semantic Reasoner |
| **Status** | ✅ Exists |
| **Never implement here** | Event capture, classification, semantic reasoning |

#### Engine 12: Side Panel UI
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | Display live recording state, captured interactions, generated test code, execution results. Settings for recorder engine selection. |
| **Inputs** | `INTERACTION_CAPTURED` messages (live), storage reads (on open) |
| **Outputs** | UI rendering |
| **Owns** | `src/sidepanel/` |
| **Must never depend on** | Any engine internals (reads only via messages + storage) |
| **Status** | ✅ Exists |
| **Never implement here** | Classification, semantic reasoning, IR generation |

#### Engine 13: AI Integration (Future)
| Aspect | Definition |
|--------|-----------|
| **Responsibility** | LLM-powered test generation from capability descriptions. AI failure analysis during execution. Self-healing locator suggestions. Continuous learning from execution results. |
| **Inputs** | `UnderstandingResult`, `ExecutionRun` results, `Capability` entities |
| **Outputs** | AI-generated test cases, failure analysis reports, locator suggestions |
| **Owns** | `src/ai/` (to be created) |
| **Must never depend on** | EventTap, Component Runtime internals |
| **Status** | 🔴 Not yet built — Phase 8+ of roadmap |

---

## 3. Implementation Ownership

### Where changes go for each feature type:

| Feature / Enhancement | Engine | File(s) | What to do |
|----------------------|--------|---------|------------|
| New DOM event type to capture | EventTap | `src/tap/event-tap.ts` | Add listener, produce ObservedEvent |
| New identity field (e.g., shadow DOM depth) | Identity Extraction | `src/tap/identity-extractor.ts` | Add to `extractIdentity()` |
| New surface type (e.g., bottom sheet) | DOM Context Extraction | `src/definitions/dom-context-extractor.ts` | Add to `detectSurface()` patterns |
| New DOM context field (e.g., aria-keyshortcuts) | DOM Context Extraction | `src/definitions/dom-context-extractor.ts` | Add to `extractDomContext()` |
| New interaction type (e.g., DragDrop) | Classifier | `src/classifier/interaction-detector.ts` | Add to `classifyGroup()` detection order |
| New evidence signal | Evidence Channels | `src/classifier/evidence/providers/` | Add provider or extend existing |
| New component definition (e.g., Accordion) | Component Runtime | `src/definitions/` | New definition file + register in `ALL_DEFINITIONS` |
| New semantic session type (e.g., Wizard) | Semantic Reasoner | `src/classifier/semantic/` | Add to types.ts, detectors.ts, reasoner.ts |
| New multiConfig trigger pattern | Semantic Reasoner | `src/classifier/semantic/panel-form-detectors.ts` | Add to `isMultiConfigActivation()` |
| New stepper detection pattern | Semantic Reasoner | `src/classifier/semantic/panel-form-detectors.ts` | Add to `detectStepperDirection()` |
| New surface-anchored behavior | Semantic Reasoner | `src/classifier/semantic/panel-form-detectors.ts` | Add to `shouldAbsorbMultiConfig()` |
| New recognition pattern | Recognition | `src/recorder/recognition/` | Add pattern + register |
| New enrichment deriver | Enrichment | `src/recorder/enrichment/` | Add deriver |
| New capability type | Capability Deriver | `src/recorder/enrichment/capability-deriver.ts` | Add derivation logic |
| New IR action mapping | IR Bridge | `src/generation/ir-bridge.ts` | Add to `INTERACTION_TO_IR_ACTION` |
| New assertion derivation | IR Bridge | `src/generation/ir-bridge.ts` | Add to `deriveAssertions()` |
| New readability rule | IR Bridge | `src/generation/ir-bridge.ts` | Add to `applyReadabilityRules()` |
| New Playwright code pattern | Code Generation | `src/adapters/playwright/` | Add renderer |
| New locator strategy | Domain | `src/domain/locator-ranking.ts` | Add strategy |
| New repository entity | Repository | `src/repository/v2/` | New interface + Dexie repository |
| New healing algorithm | Healing | `src/repository/services/healing-service.ts` | Add to `healElementAndPersist()` |
| New AI test generation | AI Integration | `src/ai/` (future) | New module |
| New UI display element | Side Panel | `src/sidepanel/` | Add to HTML + timeline renderer |
| New SW pipeline step | SW Orchestration | `src/background/service-worker.ts` | Add to `handleStopRecording()` or `handleObservedEvent()` |

### Decision Flowchart

```
New feature or bug fix?
│
├── Does it need to capture a new DOM event?
│   └── EventTap (src/tap/event-tap.ts)
│
├── Does it need a new element identity field?
│   └── Identity Extraction (src/tap/identity-extractor.ts)
│
├── Does it need new DOM context information?
│   └── DOM Context Extraction (src/definitions/dom-context-extractor.ts)
│
├── Does it need to detect a new interaction type from events?
│   └── Classifier (src/classifier/interaction-detector.ts)
│
├── Does it need a new component lifecycle?
│   └── Component Runtime (src/definitions/ + src/runtime/)
│
├── Does it need to group multiple interactions into one semantic action?
│   └── Semantic Reasoner (src/classifier/semantic/)
│
├── Does it need to derive business meaning or workflow patterns?
│   └── Recognition + Enrichment (src/recorder/pipeline/ + recognition/ + enrichment/)
│
├── Does it need to generate or modify test code?
│   └── IR Bridge + Code Gen (src/generation/ + src/adapters/playwright/)
│
├── Does it need to persist or retrieve data?
│   └── Repository V2 (src/repository/)
│
├── Does it need to heal broken locators?
│   └── Healing Service (src/repository/services/healing-service.ts)
│
└── Does it use AI/LLM?
    └── AI Integration (src/ai/ — future)
```

---

## 4. Implementation Roadmap

### Phase 0: Semantic Unification (Foundation)
**Objective:** Eliminate the dual-pipeline debt. Unify `ObservedEvent`/`ComponentInteraction` and `RecordedEvent`/`DetectedInteraction` into a single type system so the Semantic Reasoner receives data directly from the Component Runtime without the adapter shim.

| Item | Detail |
|------|--------|
| Modules affected | `src/shared/component-types.ts`, `src/classifier/interaction-types.ts`, `src/classifier/interaction-detector.ts`, `src/background/service-worker.ts` |
| Dependencies | None (this is the foundation) |
| Validation criteria | (1) Single `DomContext` type (2) Single `InteractionType` enum (3) Semantic Reasoner consumes ComponentInteraction[] directly (4) All 4199+ tests pass (5) Recording on Adani One produces correct semantic interactions |
| Expected outcome | No adapter shim, no `as any` casts, no duplicate type definitions. One pipeline from EventTap to IR Bridge. |

### Phase 1: Dead Code Removal
**Objective:** Remove all dead/duplicate code to reduce confusion and prevent accidental modification.

| Item | Detail |
|------|--------|
| Modules affected | `src/recorder/deterministic-recorder.ts`, `src/recorder/interaction-types.ts`, `src/recorder/recording-session.ts`, `src/recorder/surface-detector.ts`, `src/recorder/v2/control-recorder.ts`, `src/recorder/v2/control-model.ts`, `src/recorder/v2/element-identity-builder.ts`, `src/recorder/v2/framework-adapters.ts`, `src/recorder/v2/identity-extractor.ts`, `src/pipeline/` (34 files), `src/types/` (8 files), `src/runtime/modal-tracker.ts`, `tmp-build/`, `extension-zip/` |
| Dependencies | Phase 0 (types must be unified first) |
| Validation criteria | (1) Build succeeds (2) All tests pass (3) `grep -r "import.*deterministic-recorder\|import.*control-recorder\|import.*modal-tracker\|import.*pipeline/channels"` returns zero hits in active code |
| Expected outcome | Clean codebase with no dead paths. |

### Phase 2: Component Runtime Enhancement
**Objective:** Extend Component Runtime definitions to handle composite components (multiConfig-like behavior) at the runtime level, reducing the burden on the Semantic Reasoner.

| Item | Detail |
|------|--------|
| Modules affected | `src/definitions/`, `src/runtime/component-runtime.ts` |
| Dependencies | Phase 0 (unified types) |
| Validation criteria | (1) Composite components like Adani One's passenger selector are recognized as a single ComponentInteraction (2) Semantic Reasoner receives fewer, richer interactions (3) Tests pass |
| Expected outcome | Component Runtime handles lifecycle for composite widgets. Semantic Reasoner focuses on cross-interaction reasoning. |

### Phase 3: Evidence Channel Unification
**Objective:** Merge the 5 active evidence providers with the blueprint architecture's 5 channels into a single evidence system.

| Item | Detail |
|------|--------|
| Modules affected | `src/classifier/evidence/` |
| Dependencies | Phase 0 |
| Validation criteria | (1) Single evidence system (2) All 5 providers/channels active (3) V1+V2 merge layer simplified or eliminated (4) Tests pass |
| Expected outcome | One evidence pipeline, not two. |

### Phase 4: AI Test Generation
**Objective:** LLM-powered test generation from UnderstandingResult + Capability descriptions.

| Item | Detail |
|------|--------|
| Modules affected | `src/ai/` (new) |
| Dependencies | Phase 0 (unified types), `create_openai_api_key` |
| Validation criteria | (1) AI generates test cases from capability descriptions (2) Generated tests are syntactically valid Playwright (3) AI failure analysis produces actionable insights |
| Expected outcome | AI-powered test generation pipeline. |

### Phase 5-10: Platform Evolution
**Objective:** Multi-engine execution, evidence collection, AI failure analysis, self-healing, continuous learning — per the implementation roadmap in `CMDRUNNER_ARCHITECTURAL_EVOLUTION.md`.

| Phase | Objective |
|-------|-----------|
| 5 | Enhanced execution (retry, timeout, screenshot) |
| 6 | Playwright engine integration |
| 7 | AI failure analysis |
| 8 | Capture adapter extraction (mobile/API) |
| 9 | Mobile/API platforms |
| 10 | Continuous learning |

---

## 5. Development Rules

### 5.1 Where things belong

| Rule | Description |
|------|-------------|
| **New interaction types go in the Classifier** | `src/classifier/interaction-detector.ts` — add to `classifyGroup()` detection order. NOT in EventTap, NOT in Component Runtime. |
| **New component lifecycles go in Component Runtime** | `src/definitions/` — new definition file, register in `ALL_DEFINITIONS`. NOT in the Classifier, NOT in Semantic Reasoner. |
| **New semantic behaviors go in Semantic Reasoner** | `src/classifier/semantic/` — new session type, activation, completion, absorption. NOT in the Classifier, NOT in Component Runtime. |
| **Business rules go in Enrichment** | `src/recorder/enrichment/` — component detection, meaning resolution. NOT in the Classifier, NOT in EventTap. |
| **AI logic goes in AI Integration** | `src/ai/` (future). NOT in any other engine. |
| **IR generation goes in IR Bridge** | `src/generation/ir-bridge.ts`. NOT in Code Gen, NOT in Semantic Reasoner. |
| **Code rendering goes in Code Gen** | `src/adapters/playwright/`. NOT in IR Bridge. |
| **Persistence goes in Repository** | `src/repository/`. NOT in the SW directly (use services). |

### 5.2 What should NEVER be implemented in each engine

| Engine | Never implement here |
|--------|---------------------|
| **EventTap** | Interaction classification, surface detection, semantic reasoning, business rules, AI logic, persistence |
| **Identity Extraction** | Surface detection (that's DOM Context), interaction classification, semantic reasoning |
| **DOM Context Extraction** | Event capture, identity extraction, interaction classification, semantic reasoning |
| **Component Runtime** | Semantic reasoning (multiConfig sessions, steppers), surface-anchored detection, IR generation, AI logic, persistence |
| **Evidence Channels** | Semantic session logic, multiConfig activation/absorption, business rules, IR generation |
| **Classifier** | Semantic session management, business rules, IR generation, persistence |
| **Semantic Reasoner** | Event capture, identity extraction, DOM context, component lifecycle, IR generation, code rendering |
| **Recognition/Enrichment** | Event capture, classification, semantic session management, IR generation |
| **IR Bridge** | Event capture, classification, semantic reasoning, code rendering |
| **Code Generation** | IR plan construction, semantic reasoning, event capture |
| **Repository** | Event capture, classification, semantic reasoning, code generation |
| **Side Panel UI** | Any engine logic — only reads via messages + storage |

### 5.3 How future contributors decide where code belongs

1. **Is it about capturing a DOM event?** → EventTap
2. **Is it about identifying an element?** → Identity Extraction
3. **Is it about DOM context at event time?** → DOM Context Extraction
4. **Is it about lifecycle (discovery → active → complete)?** → Component Runtime
5. **Is it about classifying what type of interaction happened?** → Classifier
6. **Is it about grouping multiple interactions into one semantic action?** → Semantic Reasoner
7. **Is it about business meaning or workflow patterns?** → Recognition + Enrichment
8. **Is it about generating test steps?** → IR Bridge
9. **Is it about rendering code?** → Code Generation
10. **Is it about persisting data?** → Repository
11. **Is it about healing locators?** → Healing Service
12. **Is it about AI/LLM?** → AI Integration

### 5.4 Type system rules

- **One `ElementIdentity`** — defined in `src/shared/types.ts`. No duplicates.
- **One `DomContext`** — to be unified in Phase 0. Until then, `component-types.ts` DomContext is for EventTap, `recorded-event.ts` DomContext is for the V1 classifier. The SW adapter shim bridges them.
- **One `InteractionType`** — to be unified in Phase 0. Until then, `interaction-types.ts` (45 values) is for the Classifier + Semantic Reasoner, `component-types.ts` (13 values) is for Component Runtime.
- **Never use `as any`** to bridge type systems after Phase 0. Before Phase 0, the SW adapter shim at L287-308 is the ONLY place `as any` is allowed.

### 5.5 Testing rules

- Every new feature gets unit tests in `tests/` following the existing pattern.
- Semantic Reasoner changes get tests in `tests/surface-anchored/` or `tests/stage5-semantic-reasoning.test.ts`.
- Classifier changes get tests in `tests/interaction-detector.test.ts`.
- Component definition changes get tests in `tests/` matching the component name.
- All tests must pass before committing. Pre-existing failures (performance timing) are exempt.

---

## 6. Current Adani One Fixes — Architecture Mapping

### Status Vocabulary

| Status | Meaning |
|--------|---------|
| 🔴 **Designed** | Architecture agreed, code not yet written |
| 🟡 **Implemented** | Code written, unit tests pass, NOT yet verified on the real site |
| 🟢 **Verified** | Confirmed working by manual testing on the target site (Adani One) |
| ✅ **Complete** | Verified AND regression-tested — safe to build on |

> **Critical rule:** "Implemented" does NOT mean "done." A fix is only Complete after manual testing confirms the behavior on the target site AND regression tests pass. No fix should be treated as a foundation for further work until it reaches Complete.

### Issue 1: SVG chevron resolves to icon instead of trigger button

| Aspect | Detail |
|--------|--------|
| **Symptom** | Click on passenger/class selector captured as click on SVG chevron icon, not the trigger button |
| **Root cause** | `resolveTarget()` in `tap/identity-extractor.ts` Strategy 2 returned the first `cursor:pointer` element immediately (the SVG wrapper), instead of walking up to find a parent with a meaningful accessible name |
| **Fix location** | `src/tap/identity-extractor.ts` — Strategy 2 in `resolveTarget()` |
| **Engine** | Identity Extraction |
| **Why here** | Target resolution is an identity extraction concern. The EventTap calls `resolveTarget` to determine which element the user interacted with. Surface detection and semantic reasoning are downstream — they can only work if the correct target was resolved. |
| **Status** | 🟡 Implemented — Designed + code written. NOT yet verified on Adani One. |

### Issue 2: Surface evidence not propagated to semantic interactions

| Aspect | Detail |
|--------|--------|
| **Symptom** | multiConfig session doesn't activate because surface evidence (popover opening) is never propagated to `DetectedInteraction.metadata.surfaceContext` |
| **Root cause** | `dom-context-extractor.ts` (7bfd949's EventTap) had no surface detection. The old `deterministic-recorder.ts` had a MutationObserver that detected surfaces, but the new EventTap doesn't. The `extractSurfaceContext()` in `interaction-detector.ts` looks for `domContext.surfaceType` which was never set. |
| **Fix location** | `src/definitions/dom-context-extractor.ts` — added `detectSurface()` function |
| **Engine** | DOM Context Extraction |
| **Why here** | Surface detection is a DOM context concern — it reads the live DOM at event time to determine if the element is inside a modal/drawer/popover/tooltip. This information is then carried in `DomContext` and propagated by the Classifier's `extractSurfaceContext()` to the Semantic Reasoner. It does NOT belong in EventTap (which only captures events) or the Semantic Reasoner (which can't access the DOM). |
| **Status** | 🟡 Implemented — Designed + code written. NOT yet verified on Adani One. |

### Issue 3: multiConfig not activating for passenger/class selector

| Aspect | Detail |
|--------|--------|
| **Symptom** | Click on "2 • Premium Economy" trigger doesn't activate a multiConfig session — individual clicks pass through |
| **Root cause** | `isMultiConfigActivation()` only checked CSS class matching (`PANEL_TRIGGER_CLASSES`). The trigger's CSS class (`pax-summary`) wasn't in the list. Surface evidence (`openedByThisInteraction`) was never propagated. |
| **Fix location** | `src/classifier/semantic/panel-form-detectors.ts` — `isMultiConfigActivation()` |
| **Engine** | Semantic Reasoner |
| **Why here** | Session activation is a semantic reasoning concern. The Reasoner decides whether a sequence of interactions represents a composite component configuration. The surface evidence comes from DOM Context Extraction (upstream) and is propagated by the Classifier (upstream). The Reasoner's job is to interpret that evidence. |
| **Status** | 🟡 Implemented — Designed + code written. NOT yet verified on Adani One. |

### Issue 4: Internal clicks not absorbed (no CSS class overlap)

| Aspect | Detail |
|--------|--------|
| **Symptom** | +/- buttons and cabin class toggles inside the popover are not absorbed — they pass through as separate interactions |
| **Root cause** | `shouldAbsorbMultiConfig()` relied on CSS class-token overlap between trigger and internal elements. Adani One's trigger has `pax-summary` while buttons have `counter-btn` and toggles have `cabin-option` — no overlap. |
| **Fix location** | `src/classifier/semantic/panel-form-detectors.ts` — `shouldAbsorbMultiConfig()` |
| **Engine** | Semantic Reasoner |
| **Why here** | Absorption is a semantic reasoning concern. The Reasoner decides which interactions are internal to a composite component session. Surface-anchored absorption (absorb all interactions while surface is open) is the correct approach because it's framework-agnostic. |
| **Status** | 🟡 Implemented — Designed + code written. NOT yet verified on Adani One. |

### Issue 5: Icon-only +/- buttons not detected as steppers

| Aspect | Detail |
|--------|--------|
| **Symptom** | +/- buttons with SVG icons (no text label) captured as generic Click instead of Increase/Decrease |
| **Root cause** | `shouldAbsorbMultiConfig()` and `extractConfigField()` only checked `accessibleName` for stepper keywords. Icon-only buttons have empty `accessibleName`. CSS class patterns and `aria-label` were not checked. |
| **Fix location** | `src/classifier/semantic/panel-form-detectors.ts` — `detectStepperDirection()`, `extractStepperFieldName()`, `extractConfigField()` |
| **Engine** | Semantic Reasoner |
| **Why here** | Stepper detection is a semantic interpretation of a click interaction. The Reasoner has access to the full interaction metadata (CSS class, aria-label, accessible name) and can determine whether a click represents an increment/decrement action. |
| **Status** | 🟡 Implemented — Designed + code written. NOT yet verified on Adani One. |

### Issue 6: Date picker captured twice

| Aspect | Detail |
|--------|--------|
| **Symptom** | Departure date selection produces two interactions instead of one |
| **Root cause** | The date trigger click and the date cell click are classified as separate interactions. The DatePicker session should activate on the trigger click and complete on the cell click, merging them into one. This works when the trigger matches `DATEPICKER_TRIGGER_CLASSES` or has `inputType=date`. Adani One's date field may not match these patterns. |
| **Fix location** | `src/classifier/semantic/detectors.ts` — `isDatePickerActivation()` may need additional patterns. OR `src/definitions/dom-context-extractor.ts` — ensure the date field's DOM context includes enough signal. |
| **Engine** | Semantic Reasoner (activation detection) + DOM Context Extraction (if new patterns needed) |
| **Why here** | DatePicker session activation is a Semantic Reasoner concern. If the trigger doesn't match existing patterns, the activation function needs expansion — NOT the EventTap or Component Runtime. |
| **Status** | ⚠️ Needs investigation — may require adding Adani One's date field CSS class to `DATEPICKER_TRIGGER_CLASSES` |

### Issue 7: "Cheapest" button click not captured

| Aspect | Detail |
|--------|--------|
| **Symptom** | Click on "Cheapest" fare option button not captured as an interaction |
| **Root cause** | Needs investigation. Possible causes: (a) the button is inside a surface that was being absorbed by an active multiConfig session, (b) the click target doesn't match `INTERACTIVE_SELECTOR` and `resolveTarget()` returns a non-interactive parent, (c) the interaction is classified as `ContainerNoiseClick` and suppressed. |
| **Fix location** | TBD — depends on root cause. If (a): Semantic Reasoner absorption rules. If (b): Identity Extraction `resolveTarget()`. If (c): Classifier noise filtering. |
| **Engine** | TBD — needs debugging first |
| **Why here** | Must debug with a live recording first. DO NOT guess the fix location. |
| **Status** | ⚠️ Needs investigation — requires live recording debug |

### Issue 8: Semantic output only shows "Select Premium Economy from 1 Economy" (missing +Adults)

| Aspect | Detail |
|--------|--------|
| **Symptom** | The semantic interaction shows only the dropdown selection, not the stepper increments |
| **Root cause** | The `session.getEvents()` crash (undefined `session` variable) prevented the Semantic Reasoner from running. The Component Runtime correctly captured the dropdown lifecycle, but the semantic reasoning pipeline (which handles multiConfig + steppers) was never reached. |
| **Fix location** | `src/background/service-worker.ts` — replaced `session.getEvents()` with extraction of ObservedEvents from ComponentInteraction[] |
| **Engine** | SW Orchestration |
| **Why here** | The SW is the pipeline orchestrator. The bug was a broken orchestration step (referencing an undefined variable), not a bug in any specific engine. |
| **Status** | 🟡 Implemented — Designed + code written. NOT yet verified on Adani One. |

---

## Appendix A: File Inventory (Active Only)

```
src/
├── tap/
│   ├── event-tap.ts                    # EventTap engine
│   └── identity-extractor.ts           # Identity extraction engine
├── definitions/
│   ├── dom-context-extractor.ts        # DOM context + surface detection
│   ├── index.ts                        # ALL_DEFINITIONS registry
│   ├── click.ts                        # Click definition (priority 180)
│   ├── checkbox.ts                     # Checkbox (30)
│   ├── date-picker.ts                  # DatePicker (10)
│   ├── dropdown.ts                     # Dropdown (20)
│   ├── file-upload.ts                  # FileUpload (35)
│   ├── hover.ts                        # Hover (60)
│   ├── link.ts                         # Link (70)
│   ├── navigation.ts                   # Navigation (120)
│   ├── radio-button.ts                 # RadioButton (40)
│   ├── scroll.ts                       # Scroll (110)
│   ├── slider.ts                       # Slider (25)
│   ├── tab.ts                          # Tab (65)
│   ├── text-entry.ts                   # TextEntry (50)
│   └── patterns.ts                     # Component recognition patterns
├── runtime/
│   ├── component-runtime.ts            # Component Runtime engine
│   └── sw-integration.ts               # SW integration bridge
├── enrichment/
│   ├── enrich.ts                       # 3-layer enrichment entry
│   ├── component-detector.ts           # Layer 2: component type detection
│   └── meaning-resolver.ts             # Layer 3: business meaning
├── classifier/
│   ├── interaction-detector.ts         # V1 classifier
│   ├── interaction-types.ts            # DetectedInteraction, InteractionType (45), InteractionMetadata
│   ├── evidence/
│   │   ├── detector.ts                 # V2 entry point (detectInteractionsV2)
│   │   ├── engine.ts                   # InteractionEngine
│   │   ├── merge-layer.ts              # V1+V2 merge
│   │   ├── ab-comparison.ts            # Dev logging
│   │   └── providers/                  # 5 evidence providers
│   │       ├── dom-provider.ts
│   │       ├── aria-provider.ts
│   │       ├── event-sequence-provider.ts
│   │       ├── mutation-provider.ts
│   │       └── css-classname-provider.ts
│   └── semantic/
│       ├── reasoner.ts                 # SemanticReasoner
│       ├── types.ts                    # ComponentSession, ComponentType, SemanticReasoningResult
│       ├── detectors.ts                # Activation/completion/absorption detectors
│       ├── panel-form-detectors.ts     # MultiConfig + FormSubmit + Stepper
│       └── index.ts                    # Barrel
├── recorder/
│   ├── phase5/recorder-entry.ts        # ACTIVE content script
│   ├── v2/interaction-recognizer.ts     # Control Model recognizer (control path)
│   ├── recorded-event.ts               # RecordedEvent types (legacy, rich DomContext)
│   ├── action-id.ts                    # ActionIdGenerator
│   ├── pipeline/
│   │   ├── pipeline-runner.ts          # Recognition + enrichment orchestrator
│   │   └── domain-adapter.ts           # Events+interactions → domain entities
│   ├── recognition/                    # 5 files: orchestrator, patterns, registry
│   └── enrichment/                     # 10 files: derivers for surfaces, fragments, capabilities
├── presentation/
│   └── output-adapter.ts               # filterProductionInteractions (active)
├── generation/
│   ├── ir-bridge.ts                    # IR Bridge engine
│   └── ir-bridge-input.ts             # IRBridgeInput type
├── adapters/playwright/               # 6 files: project-generator, renderers
├── domain/
│   ├── entities/                       # 14 entity files
│   ├── enums.ts
│   ├── locator-ranking.ts
│   ├── execution-ir/                   # types, staleness, generator, adapters
│   └── errors/invariant-errors.ts
├── repository/
│   ├── services/                       # persistence, capability matching, healing
│   └── v2/                             # Dexie repositories + interfaces
├── shared/
│   ├── types.ts                        # ElementIdentity, UIState, StorageKeys (canonical)
│   └── component-types.ts              # ObservedEvent, ComponentInteraction, DomContext (new)
├── background/service-worker.ts        # SW pipeline orchestration
├── sidepanel/                          # Side panel UI
├── settings/                           # Settings page
└── storage/storage-service.ts          # StorageService
```

---

## Appendix B: Dead Code Inventory (For Phase 1 Removal)

```
src/recorder/deterministic-recorder.ts     # 3079 lines — superseded
src/recorder/interaction-types.ts          # Legacy registry
src/recorder/recording-session.ts          # Legacy session manager
src/recorder/element-id-generator.ts       # Unused
src/recorder/step-id-generator.ts          # Unused
src/recorder/surface-detector.ts            # Duplicated in dom-context-extractor.ts
src/recorder/v2/control-recorder.ts         # Dead content script (RECORDED_EVENT)
src/recorder/v2/control-model.ts            # Dead (used by control-recorder)
src/recorder/v2/element-identity-builder.ts # Dead
src/recorder/v2/framework-adapters.ts       # Dead
src/recorder/v2/identity-extractor.ts      # Dead
src/runtime/modal-tracker.ts               # Dormant — not instantiated
src/pipeline/                               # 34 files — entire blueprint architecture
src/types/                                  # 8 files — only imported by src/pipeline/
tmp-build/                                  # Full project snapshot
extension-zip/                              # Built extension archive
```

---

*This document is the definitive implementation guide. All future development, bug fixes, and feature additions must follow these boundaries. When in doubt, refer to the decision flowchart in Section 3.*
