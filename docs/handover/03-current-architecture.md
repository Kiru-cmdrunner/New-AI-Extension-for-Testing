# 3. Current Architecture — Implemented Phases

This document explains every implemented architectural subsystem: what it does, why it exists, how it works internally, and how it relates to other subsystems.

---

## Era 1: Extension Foundation (Milestone 1)

**Status:** Complete | **Tests:** 20+ | **Commit:** `8d66baa` (early)

### Purpose
Provides the Chrome Extension shell: Manifest V3 configuration, Side Panel UI, Settings page, storage service, and message routing.

### Key Components
- **Side Panel** (`src/sidepanel/`) — primary UI surface with recording controls and timeline display
- **Settings** (`src/settings/`) — AI provider configuration, recording preferences
- **Service Worker** (`src/background/service-worker.ts`) — lifecycle, message routing, content script management
- **Storage** (`src/storage/storage-service.ts`) — `chrome.storage.local` wrapper with debounce + schema versioning

### Why It Exists
Everything else depends on this foundation. The Side Panel is where users interact; the Service Worker is the orchestration hub; Storage persists everything.

---

## Era 2: Deterministic Recorder (v1.x–v6.1.0)

**Status:** Complete (production) | **Tests:** 800+ across recorder, classifier, and evidence engine

### Purpose
The original recording pipeline — captures browser interactions with full element identity and classifies them into semantic interaction types.

### Architecture

```
Content Script (deterministic-recorder.ts)
    │ captures: click, input, change, focus, blur, hover, keyboard
    │ resolves: target element via composedPath() (crosses Shadow DOM)
    │ builds: 18-field ElementIdentity
    │
    ▼
Service Worker → RecordingSession
    │ stores events with sequential IDs
    │ debounced persistence (5s or 10 events)
    │
    ▼
Classification (dual engine)
    ├─► V1: Interaction Detector (rule-based)
    │      33 interaction types across 8 categories
    │
    └─► V2: Evidence Engine
           5 evidence providers → weighted voting
           ├─ DOM Provider (structural attributes)
           ├─ ARIA Provider (accessibility semantics)
           ├─ Event-Sequence Provider (temporal patterns)
           ├─ Mutation Provider (DOM changes)
           └─ CSS-Classname Provider (class differentials)
                │
                ▼
           Merge Layer (V2-primary, V1-fallback)
                │
                ▼
           Classified Session Events
```

### Why It Exists
This was the first working recorder. It proved the concept of deterministic, identity-based interaction capture. However, it had structural limitations:
- Multiple content scripts with O(n²) coordination
- Classification at capture time (limited evidence context)
- No pattern recognition (each click was a click, not part of a dropdown interaction)

These limitations motivated Architecture C.

---

## Era 3: Architecture C — Capture-First Pipeline (v7.0.0)

**Status:** Complete (Phases 0–6) | **Tests:** 100+ | **Feature flag:** `ARCHITECTURE_C_ENABLED`

### Purpose
Replaces the legacy multi-script recorder with a single universal observer that captures all interactions, then classifies them in a pure-function pipeline with full evidence context.

### 7 Architectural Principles (AP1–AP7)

| # | Principle | Meaning |
|---|-----------|---------|
| AP1 | Separation of evidence and classification | Observer captures; classifier decides |
| AP2 | Graceful degradation | Correct results without AI |
| AP3 | Progressive classification | Tier 1 immediate → Tier 2 behavioral → Tier 3 AI |
| AP4 | Evidence sovereignty | Deterministic evidence overrides AI |
| AP5 | Linear data flow | No feedback loops in the pipeline |
| AP6 | Contract-based boundaries | Typed interfaces between every stage |
| AP7 | Additive extensibility | New types = new rules, not new scripts |

### Implementation Phases

#### Phase 0: Shared Types & Contracts
- **Files:** `src/shared/architecture-types.ts`, `src/shared/evidence-types.ts`
- **Purpose:** Define the typed contracts between all pipeline stages: `RawEvidence`, `InteractionSnapshot`, `CanonicalType`, `CanonicalOutput`, `Evidence`, etc.

#### Phase 1: Multi-Tier Semantic Classifier
- **Files:** `src/classifier/interaction-detector.ts` (V1), `src/classifier/evidence/` (V2)
- **Purpose:** 16-rule classifier organized in 3 tiers:
  - **Tier 1 (R1–R6):** Structural evidence — synchronous, <1ms, confidence ≥0.95. Navigation, text entry, native date input, native select, checkbox toggle, radio selection.
  - **Tier 2 (R7–R14):** Behavioral evidence — synchronous, ~5ms. Date value outcome, calendar context, ARIA listbox, menu items, segmented controls, CSS class differentials, toggle indicators, hover + mutation.
  - **Tier 3 (R15–R16):** AI advisory + default fallback — async, ~200–500ms.

#### Phase 2: Snapshot Coalescer
- **File:** `src/recorder/coalescer/snapshot-coalescer.ts`
- **Purpose:** Groups raw evidence packets from the observer into `InteractionSnapshot`s. Uses temporal windowing (default 500ms after interaction start) and accumulates mutations, state changes, and event sequences. A snapshot is the complete evidence package the classifier needs.

#### Phase 3: State Tracker (Session Context L1)
- **File:** `src/recorder/context/state-tracker.ts`
- **Purpose:** Maintains a real-time deterministic snapshot of the page: current URL, page title, open dialogs, open dropdowns, active form, active element. The classifier uses this context to disambiguate interactions (e.g., "was there a dropdown open when this click happened?").

#### Phase 4: Universal Interaction Observer
- **Files:** `src/recorder/observer/universal-interaction-observer.ts`, `src/recorder/observer/observer-helpers.ts`
- **Purpose:** A single content script that captures ALL DOM events. Uses capture-phase listeners (to intercept before page handlers). Runs a MutationObserver during interaction windows (mousedown → +500ms). Builds `RawEvidence` packets with element identity, value/state, ARIA state, and accumulated mutations.

#### Phase 5: Pipeline Integration & Feature Flag
- **File:** `src/recorder/pipeline/architecture-c-pipeline.ts`
- **Purpose:** Wires observer → coalescer → classifier → assembler → SessionEvent. Controlled by `ARCHITECTURE_C_ENABLED` feature flag. When ON, the new pipeline runs; when OFF, the legacy pipeline runs unchanged.

#### Phase 6: AI Observer Enhancement
- **File:** `src/ai/ai-observer.ts`
- **Purpose:** Advisory classification layer. When `aiEligible=true`, sends semantic snapshots (no selectors) to the configured AI provider. Returns hypotheses (max 3) with evidence citations and confidence scores. Evidence Sovereignty applies — deterministic classifications cannot be overridden.

#### Interaction Assembler (Post-Phase 6 Enhancement)
- **File:** `src/recorder/pipeline/interaction-assembler.ts`
- **Purpose:** Transaction state machine for composite interactions. A dropdown interaction is not one event — it's open → select → close. The assembler buffers these and emits a single complete interaction.

### Relationship to Other Subsystems
Architecture C's output (SessionEvents) feeds directly into the Generation Pipeline (unchanged from Era 2) and the UI Knowledge Model (Era 4). The feature flag allows running both pipelines simultaneously for comparison.

---

## Era 4: UI Knowledge Model (Phases 1–5)

**Status:** Phases 1–5 complete | **Tests:** 500+ across recognition and enrichment

### Purpose
The UI Knowledge Model transforms raw observations into a semantic understanding of the application. It recognizes UI patterns (dropdowns, checkboxes, modals), enriches them with behavioral contracts, and assembles a complete `ApplicationKnowledgeFragment`.

### Three Foundational Entities (persisted)

These carry only deterministic, observation-derived knowledge:

#### UiElement (`src/domain/entities/ui-element.ts`)
- **Identity:** 18-field signature (tag, ARIA role, accessible name, CSS path, XPath, test ID, classes, iframe context, DOM position, etc.)
- **Capabilities:** Derived from tag + role + input type (click, acceptText, focus, hover, selectOption, toggle)
- **DOM attributes:** Raw attribute map (source for InteractionContract derivation)
- **Component membership:** Optional `componentId` + `componentRole`

#### ObservedTransition (`src/domain/entities/observed-transition.ts`)
- **Operation:** What happened (click, fill, select, toggle, hover, navigate, selectDate)
- **State:** Before/after `ElementState` (value, checked, expanded, selected)
- **Evidence:** Typed evidence array (value change, state change, class change, mutation, navigation)
- **Cascade effects:** Side effects on other elements (visibility, value, availability, content)
- **Validation result:** Whether validation triggered and how

#### ComponentGrouping (`src/domain/entities/component-grouping.ts`)
- **Pattern type:** dropdown, checkbox, radioGroup, datePicker, modal, tabs, accordion, etc.
- **Constituents:** Elements with their roles (trigger, container, option, commit, cancel, etc.)
- **Lifecycle:** TENTATIVE → DEVELOPING → CONFIRMED/REJECTED
- **Schema-ready fields:** `businessField` (null until enrichment), `optionSet` (null until DOM inspection)

### Phase 1: Pattern Catalogue + Structural Recognizer
- **Files:** `src/recorder/recognition/pattern-catalogue.ts`, `structural-recognizer.ts`
- **Purpose:** Declarative pattern definitions for 11 UI patterns. Structural recognizer matches ARIA roles and HTML structure to identify patterns in <1ms with ~40-50% coverage.

### Phase 2: Behavioral Recognizer (Tier 2)
- **File:** `src/recorder/recognition/behavioral-recognizer.ts`
- **Purpose:** Recognizes patterns from coalescer evidence signatures (e.g., "trigger expanded + child elements became visible + options are clickable" = dropdown). ~5ms, ~35-45% additional coverage.

### Phase 3: Component Registry & Lifecycle
- **File:** `src/recorder/recognition/component-registry.ts`
- **Purpose:** Manages the progressive lifecycle of recognized components. A component starts TENTATIVE (structural hint), advances to DEVELOPING (behavioral evidence), and reaches CONFIRMED (sufficient evidence) or REJECTED (insufficient evidence).

### Phase 4: Recognition Orchestrator
- **File:** `src/recorder/recognition/orchestrator.ts`
- **Purpose:** Coordinates structural → behavioral recognition, manages the component registry, and assigns elements and transitions to components.

### Phase 5: Post-Recording Enrichment & Semantic Aggregation
- **Files:** 9 modules in `src/recorder/enrichment/`
- **Purpose:** The enrichment pass that bridges "observed" to "inferred":
  1. **InteractionContract derivation** — DOM attributes → input constraints (required, type, range, format, validOptions)
  2. **Option set extraction** — DOM inspection discovers ALL options (even unclicked ones), populates `optionSet` and `businessField`
  3. **BehavioralContract synthesis** — transitions → state machines, validation behavior, cascade effects, success indicators
  4. **Semantic aggregation** — lifecycle occurrence segmentation groups transitions into logical actions (Rules A/B/C)
  5. **Workflow derivation** — navigation boundaries, branch points, optional steps
  6. **Surface derivation** — elements grouped by source URL
  7. **Fragment assembly** — all foundations + derived views → `ApplicationKnowledgeFragment`

### Semantic Aggregation Algorithm (the core innovation)

The semantic aggregator groups multiple transitions into single logical actions using three segmentation rules:

- **Rule A (Restart):** For multi-operation lifecycles (e.g., dropdown = [CLICK, SELECT]), when the initial operation reappears and the buffer is non-empty, close the current occurrence and start a new one.
- **Rule B (Gap):** When an operation not in the expected lifecycle appears, close the current occurrence (the intervening transition is skipped).
- **Rule C (Temporal Gap):** Configurable time threshold between transitions. Disabled by default.

**Key design decision:** The aggregator is completely generic. It has zero pattern-specific logic. All pattern knowledge comes from `PatternDefinition.expectedLifecycle` in the catalogue.

---

## Generation Pipeline

**Status:** Complete | **Tests:** 200+

### Purpose
Transforms classified SessionEvents into human-readable and machine-executable test artifacts.

### Internal Components

1. **Semantic Templates** (`semantic-templates.ts`) — Maps interaction types to verb phrases ("click", "enter text into", "select")
2. **Multi-Tier Classifier** (`multi-tier-classifier.ts`) — Further classifies interactions for step generation
3. **Canonical Step Generator** (`canonical-step-generator.ts`) — Produces plain-English steps with readable locators
4. **Readability Optimizer** (`readability-optimizer.ts`) — Merges redundant steps (e.g., consecutive text entries into one)
5. **Execution JSON Generator** (`execution-json-generator.ts`) — Produces CmdRunner's native format
6. **Playwright Generator** (`playwright-generator.ts`) — Produces complete TypeScript test files

### Verb Mapping Table
A frozen mapping from interaction types to human-readable verbs. This is the source of truth for step phrasing — see `src/generation/verb-mapping-table.ts`.

---

## Domain Model & Repository V2

**Status:** Architecture complete, implementation complete | **Tests:** 100+

### Purpose
A persistent data model for managing test cases, elements, execution plans, and projects.

### 9 Core Entities

Organized by owning context:

| Context | Entities |
|---------|----------|
| **Authoring** | SourceArtifact (immutable provenance) |
| **Repository** | Project, ApprovedTestCase (+ ATC Version), Element, Test Data |
| **Composition** | TestSuite, EnvironmentProfile |
| **Execution** | TestRun (pinned to ATC version, frozen environment snapshot) |
| **Generation** | ExecutionIRPlan (derived, always regenerable) |

### Repository Implementation
Dexie (IndexedDB) with Unit of Work pattern. Full CRUD for all entities. See `src/repository/v2/`.

---

## Execution IR

**Status:** Architecture complete, implementation complete | **Tests:** 50+

### Purpose
An engine-agnostic intermediate representation that sits between test cases and generated code.

### Key Principle (P2): IR is Derived and Disposable
The Execution IR is always regenerable from an ATC version + Element Repository. It is never the source of truth — it is a derived view. If elements change, the IR can be regenerated with staleness tracking.

### Adapters
Two interfaces consume the IR:
- **IRExecutor** — "run this now" (structured execution results)
- **IRCodeGenerator** — "produce source files" (GeneratedFile[])

The Playwright adapter implements both.
