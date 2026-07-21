# 2. Architecture Overview

## High-Level Architecture

The extension follows a **multi-layered, application-centric pipeline architecture**. Every interaction flows through the same path: capture → coalesce → classify → enrich → generate.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION (MV3)                         │
│                                                                      │
│  ┌─────────────┐   ┌──────────────────────┐   ┌───────────────────┐ │
│  │  Side Panel  │   │  Background Service   │   │  Content Scripts   │ │
│  │  (UI + State)│◄─►│  Worker (Orchestrator)│◄─►│  (Observer + State)│ │
│  └─────────────┘   └──────────────────────┘   └───────────────────┘ │
│         │                     │                         │             │
│         │            ┌────────┴────────┐                │             │
│         │            ▼                 ▼                ▼             │
│         │     ┌─────────────┐  ┌──────────────┐  ┌───────────┐       │
│         │     │  Recording   │  │ Classification│  │ Universal  │      │
│         │     │  Session     │  │  Pipeline     │◄─│ Observer   │      │
│         │     └──────┬───────┘  └───────┬──────┘  └───────────┘      │
│         │            │                  │                             │
│         │            ▼                  ▼                             │
│         │     ┌─────────────┐  ┌──────────────┐                       │
│         │     │  Timeline   │  │  AI Observer  │ (advisory)           │
│         │     │  Display    │  │  (optional)   │                      │
│         │     └─────────────┘  └──────────────┘                      │
│         │            │                                               │
│         │            ▼                                               │
│         │     ┌─────────────────────────────────────────────┐        │
│         │     │           GENERATION PIPELINE                │        │
│         │     │                                             │        │
│         │     │  Session Events                             │        │
│         │     │      ├─► Plain-English Steps                 │        │
│         │     │      ├─► Execution JSON (CmdRunner)         │        │
│         │     │      ├─► Playwright Test Code               │        │
│         │     │      └─► Application Knowledge Fragment     │        │
│         │     └─────────────────────────────────────────────┘        │
│         │                                                            │
│         │            ┌─────────────────────────┐                     │
│         └───────────►│  Repository (Dexie/IDB)  │                     │
│                       │  Projects, Test Cases,   │                     │
│                       │  Elements, IR Plans     │                     │
│                       └─────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Content Scripts (run in the page context)

| Component | File | Responsibility |
|-----------|------|----------------|
| **Deterministic Recorder** | `src/recorder/deterministic-recorder.ts` | The legacy (v6.1.0) recorder — still the production content script. Captures raw browser events (click, input, change, focus, blur, hover) with full element identity. |
| **Universal Interaction Observer** | `src/recorder/observer/universal-interaction-observer.ts` | Architecture C's single capture-all observer. Listens to all DOM events in capture phase, runs MutationObserver during interaction windows, emits `RawEvidence` packets. |
| **State Tracker** | `src/recorder/context/state-tracker.ts` | Maintains Layer 1 session context — real-time snapshot of deterministic page state (open dialogs, open dropdowns, active form, active element). |

### Background Service Worker

| Component | File | Responsibility |
|-----------|------|----------------|
| **Service Worker** | `src/background/service-worker.ts` | Extension lifecycle, message routing, content-script injection/health, navigation capture, recording session management. Orchestrates both pipelines. |

### Classification Pipeline

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Snapshot Coalescer** | `src/recorder/coalescer/snapshot-coalescer.ts` | Groups raw evidence packets into `InteractionSnapshot`s within temporal windows. Accumulates mutations, state changes, and event sequences. |
| **Multi-Tier Classifier** | `src/classifier/interaction-detector.ts` + `evidence/` | 16-rule, 3-tier classifier. Tier 1: structural (ARIA/tag, <1ms). Tier 2: behavioral (evidence signatures, ~5ms). Tier 3: AI advisory (async). |
| **Evidence Engine** | `src/classifier/evidence/` | V2 classification with weighted evidence voting from 5 providers (DOM, ARIA, event-sequence, mutation, CSS-classname). |
| **Merge Layer** | `src/classifier/evidence/merge-layer.ts` | V2-primary with V1 event-segment fallback. Produces merged interaction output. |
| **Interaction Assembler** | `src/recorder/pipeline/interaction-assembler.ts` | Transaction state machine for composite interactions (dropdown open → option select → close). |
| **Architecture C Pipeline** | `src/recorder/pipeline/architecture-c-pipeline.ts` | Orchestrates the full Architecture C flow: evidence → coalescer → classifier → assembler → SessionEvent. |
| **AI Observer** | `src/ai/ai-observer.ts` | Advisory classification: understands intent, returns hypotheses with evidence citations. Evidence Sovereignty applies. |

### Generation Pipeline

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Semantic Classifier** | `src/generation/engine/semantic-classifier.ts` | Maps raw interactions to canonical semantic types (click, fill, select, etc.). |
| **Confidence Engine** | `src/generation/engine/confidence-engine.ts` | Computes confidence scores for classified interactions. |
| **Canonical Step Generator** | `src/generation/generators/canonical-step-generator.ts` | Produces human-readable plain-English test steps. |
| **Execution JSON Generator** | `src/generation/generators/execution-json-generator.ts` | Produces CmdRunner's native automation format. |
| **Playwright Generator** | `src/generation/generators/playwright-generator.ts` | Produces complete Playwright TypeScript test files. |
| **Readability Optimizer** | `src/generation/engine/readability-optimizer.ts` | Merges redundant steps, optimizes phrasing for readability. |
| **Locator Resolution** | `src/generation/engine/locator-resolution-engine.ts` | Resolves element identity to best locator strategy. |

### Domain Model

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Foundational Entities** | `src/domain/entities/` | `UiElement`, `ObservedTransition`, `ComponentGrouping` — the three persisted observation entities. |
| **Derived Views** | `src/domain/entities/application-knowledge.ts` | `InteractionContract`, `BehavioralContract`, `LogicalAction`, `RecordedWorkflow`, `ApplicationSurface`, `ApplicationKnowledgeFragment`. |
| **Execution IR** | `src/domain/execution-ir/` | Engine-agnostic intermediate representation: types, generator, staleness tracking, adapters. |
| **Repository Entities** | `src/domain/entities/` | `Project`, `ApprovedTestCase`, `Element`, `SourceArtifact` — the repository persistence model. |

### Component Recognition

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Pattern Catalogue** | `src/recorder/recognition/pattern-catalogue.ts` | Declarative definitions for 11 UI patterns with structural roles, behavioral signatures, and expected lifecycles. |
| **Structural Recognizer** | `src/recorder/recognition/structural-recognizer.ts` | Tier 1: recognizes patterns from ARIA roles and HTML structure (<1ms, ~40-50% coverage). |
| **Behavioral Recognizer** | `src/recorder/recognition/behavioral-recognizer.ts` | Tier 2: recognizes patterns from coalescer evidence signatures (~5ms, ~35-45% coverage). |
| **Component Registry** | `src/recorder/recognition/component-registry.ts` | Manages component lifecycle: TENTATIVE → DEVELOPING → CONFIRMED/REJECTED. |
| **Recognition Orchestrator** | `src/recorder/recognition/orchestrator.ts` | Coordinates structural → behavioral recognition, manages component lifecycle. |

### Enrichment Pipeline (Phase 5)

| Component | Path | Responsibility |
|-----------|------|----------------|
| **DOM Inspector** | `src/recorder/enrichment/dom-inspector.ts` | Abstraction over browser DOM access — makes enrichment logic testable without a real DOM. |
| **Interaction Contract Deriver** | `src/recorder/enrichment/interaction-contract-deriver.ts` | Derives input constraints (required, type, range, format) from DOM attributes. |
| **Option Set Extractor** | `src/recorder/enrichment/option-set-extractor.ts` | Discovers all options in a component via read-only DOM inspection (finds options the user never clicked). |
| **Behavioral Contract Deriver** | `src/recorder/enrichment/behavioral-contract-deriver.ts` | Synthesizes state machines, validation behavior, cascade effects from observed transitions. |
| **Semantic Aggregator** | `src/recorder/enrichment/semantic-aggregator.ts` | Groups transitions into logical actions using lifecycle occurrence segmentation (Rules A/B/C). |
| **Workflow Deriver** | `src/recorder/enrichment/workflow-deriver.ts` | Detects navigation boundaries, branch points, and optional steps. |
| **Surface Deriver** | `src/recorder/enrichment/surface-deriver.ts` | Groups elements by source URL into application surfaces. |
| **Fragment Assembler** | `src/recorder/enrichment/fragment-assembler.ts` | Combines all foundations + derived views into a single `ApplicationKnowledgeFragment`. |
| **Enrichment Orchestrator** | `src/recorder/enrichment/enrichment-orchestrator.ts` | End-to-end pipeline: entities → enrichment → fragment assembly. |

### Infrastructure

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Storage Service** | `src/storage/storage-service.ts` | `chrome.storage.local` wrapper with debounce and schema versioning. |
| **Repository V2** | `src/repository/v2/` | Dexie (IndexedDB) persistence with Unit of Work pattern. |
| **Audit Manager** | `src/infrastructure/audit-manager.ts` | Structured audit logging. |
| **Error Handler** | `src/infrastructure/error-handler.ts` | Centralized error handling. |
| **Logging Manager** | `src/infrastructure/logging-manager.ts` | Log level management. |
| **Screenshot Service** | `src/screenshots/screenshot-service.ts` | Captures screenshots during recording for AI vision. |

## Data Flow

### Recording Flow (user clicks "Start Recording" → performs actions → clicks "Stop Recording")

```
1. User clicks "Start Recording" in Side Panel
   └─► Service Worker injects content scripts into active tab
   └─► Content scripts begin capturing events

2. User interacts with web page (clicks, types, selects, hovers)
   └─► Content Script captures raw event with element identity
   └─► Raw event sent to Service Worker via chrome.runtime.sendMessage

3. Service Worker routes event through pipeline:
   ├─► [Legacy Pipeline] deterministic-recorder → recording-session → timeline display
   └─► [Architecture C Pipeline] (when feature flag ON)
       └─► Universal Observer emits RawEvidence
       └─► Snapshot Coalescer groups into InteractionSnapshot
       └─► State Tracker provides deterministic context (open dropdowns, dialogs)
       └─► Multi-Tier Classifier classifies (structural → behavioral → AI)
       └─► Interaction Assembler handles composite interactions
       └─► SessionEvent produced → added to recording session
       └─► Timeline updated with classification evidence

4. User clicks "Stop Recording"
   └─► Service Worker finalizes recording session
   └─► Generation Pipeline processes events:
       ├─► Semantic Classifier maps to canonical types
       ├─► Confidence Engine scores each interaction
       ├─► Readability Optimizer merges/simplifies steps
       ├─► Canonical Step Generator → plain-English steps
       ├─► Execution JSON Generator → CmdRunner JSON
       └─► Playwright Generator → TypeScript test files
   └─► UI Knowledge Model (Phase 5 enrichment, runs post-recording):
       ├─► Component Recognition (structural → behavioral → AI)
       ├─► Interaction Contract Derivation
       ├─► Option Set Extraction (DOM inspection)
       ├─► Behavioral Contract Synthesis
       ├─► Semantic Aggregation (logical actions)
       ├─► Workflow Derivation
       └─► Application Knowledge Fragment assembly
   └─► Results displayed in Side Panel timeline
```

### Knowledge Flow (how observation becomes understanding)

```
Raw DOM Events
    │
    ▼
Element Identity (18-field signature)
    │
    ▼
UiElement (foundational entity — persisted)
    │
    ├──► Component Recognition (structural → behavioral)
    │         │
    │         ▼
    │    ComponentGrouping (foundational entity — persisted)
    │         │
    │         ▼
    │    Enrichment (DOM inspection, evidence synthesis)
    │         │
    │         ├─► InteractionContract (derived view)
    │         ├─► BehavioralContract (derived view)
    │         └─► OptionSet (schema-ready field on ComponentGrouping)
    │
    ├──► ObservedTransition (foundational entity — persisted)
    │         │
    │         ▼
    │    Semantic Aggregation
    │         │
    │         ▼
    │    LogicalAction[] (derived view — references transitions by ID)
    │
    ▼
ApplicationKnowledgeFragment (complete aggregate output)
```

### AI Interaction

AI is integrated as an **advisory layer** within the classification pipeline, not as a post-processing step:

```
                    ┌──────────────────┐
                    │  Snapshot for AI  │
                    │ (semantic only,   │
                    │  no selectors)    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   AI Observer     │
                    │ (provider-agnosic)│
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │  Hypotheses (max 3)│
                    │  + evidence cites  │
                    │  + confidence [0-1] │
                    └────────┬─────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │   Evidence Sovereignty    │
              │  (deterministic > AI)     │
              └────────────┬─────────────┘
                           │
                    ┌──────┴──────┐
                    │ Final Class │
                    │ + AI enrich │
                    └─────────────┘
```

**8 frozen AI principles (P1–P8):**
1. **Observation First** — AI observes, doesn't initiate
2. **Progressive Understanding** — builds session-level mental model
3. **Evidence Sovereignty** — deterministic evidence always overrides AI
4. **Hypothesis Discipline** — max 3 hypotheses, ranked
5. **Honest Confidence** — range [0.05, 0.95], never 0 or 1
6. **Evidence Citation** — every hypothesis cites supporting evidence
7. **Hallucination Rejection** — AI output without evidence is discarded
8. **Provider Independence** — works with any LLM provider

## How Subsystems Communicate

### Content Script ↔ Service Worker

Via Chrome extension messaging (`chrome.runtime.sendMessage` / `chrome.runtime.onMessage`). All messages are typed via the `AppMessage` discriminated union (21 message types defined in `src/shared/types.ts`).

### Service Worker ↔ Side Panel

Via the same messaging infrastructure. The Side Panel sends recording commands (`START_RECORDING`, `STOP_RECORDING`); the Service Worker pushes timeline updates (`TIMELINE_UPDATE`, `RECORDING_STATE`).

### Pipeline Stages

Via typed function calls and interfaces. Each pipeline stage is a pure function or class with well-defined input/output types. No global mutable state except:
- `RecordingSession` (managed by Service Worker)
- `ComponentRegistry` (managed by Recognition Orchestrator)
- `actionCounter` in semantic-aggregator (reset per enrichment session)

### AI Provider Communication

Via the provider abstraction layer (`src/ai/providers/`). Each provider implements a common interface. The AI service (`src/ai/ai-service.ts`) routes requests to the configured provider. API keys are stored in `chrome.storage.local` by the user via Settings.
