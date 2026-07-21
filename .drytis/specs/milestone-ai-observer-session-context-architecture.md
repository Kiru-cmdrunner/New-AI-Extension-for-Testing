# Architecture Milestone — AI Observer, Session Context & Mental Model

**Status:** Architecture design — validated and frozen  
**Date:** 2026-07-17  
**Scope:** Software architecture of the AI Observer, Session Context, and Mental Model — component boundaries, ownership, information flow, lifecycle, integration  
**Explicitly excluded:** AI reasoning philosophy, cognitive behaviour, confidence evolution algorithms, prompt design, model-specific behaviour (deferred to future AI Philosophy milestone)  
**Constraint:** No implementation. No redesign of validated E2E Recording Architecture. All frozen milestones preserved.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Scope Boundary — Architecture vs Philosophy](#2-scope-boundary--architecture-vs-philosophy)
3. [AI Observer Architectural Responsibilities](#3-ai-observer-architectural-responsibilities)
4. [Mental Model Architectural Decision](#4-mental-model-architectural-decision)
5. [Session Context Architecture](#5-session-context-architecture)
6. [Architectural Ownership Matrix](#6-architectural-ownership-matrix)
7. [Information Flow](#7-information-flow)
8. [Component Boundaries](#8-component-boundaries)
9. [Lifecycle](#9-lifecycle)
10. [AI Observer Constraints](#10-ai-observer-constraints)
11. [Integration with Semantic Interaction Generation](#11-integration-with-semantic-interaction-generation)
12. [Scalability](#12-scalability)
13. [Relationship to Previously Frozen Milestones](#13-relationship-to-previously-frozen-milestones)
14. [Freeze Declaration](#14-freeze-declaration)

---

## 1. Executive Summary

### Verdict

The AI Observer, Session Context, and Mental Model architecture is **validated as structurally sound and frozen** as the canonical software architecture reference. This milestone confirms the component design from the prior AI Observer milestone while **explicitly separating structural architecture from reasoning philosophy.**

### The Mental Model decision

The central question of this milestone — whether a "Mental Model" should exist as a named architectural component — is resolved:

> **The Mental Model is adopted as a named architectural component.** It is the AI-derived understanding layer within the Session Context. Architecturally, it is **Layer 2 of the Session Context** (renamed from "AI Understanding" to "Mental Model" for conceptual clarity). It is transient, owned exclusively by the AI Observer, and consumed by Stage 3a/3b before being discarded.

This naming is not cosmetic. "Mental Model" communicates the component's architectural role more clearly than "AI Understanding Layer" — it is a model of the session that the system maintains mentally, separate from the raw facts it observes. The name also aligns with the E2E Architecture validation, which already used "Mental Model" as the established term.

### What this milestone contributes (that prior milestones did not)

| Prior Milestone | What It Defined | What It Left Open |
|----------------|----------------|-------------------|
| E2E Architecture Validation | Mental Model is transient, consumed by Stage 3a, AI never modifies actions | Did not define Mental Model's internal structure or relationship to Session Context |
| AI Observer & Session Context | 3-layer Session Context, 5 reasoning domains, confidence model, constraints | Mixed architecture with reasoning philosophy; used "AI Understanding" instead of "Mental Model" |
| AI Observer Addendum | Advisory Input Pattern, Sliding Session Window, Expected Behaviour | Did not address Mental Model naming or architecture-vs-philosophy separation |

**This milestone:**
- Adopts "Mental Model" as the canonical architectural name for Layer 2
- Separates structural architecture (this document) from reasoning philosophy (future milestone)
- Defines ownership, boundaries, and information flow as pure structural concerns
- Confirms the 3-layer Session Context with clean architectural terminology

---

## 2. Scope Boundary — Architecture vs Philosophy

### 2.1 Why this separation matters

The prior AI Observer milestone defined both **how the components are structured** (architecture) and **how AI reasons within them** (philosophy). While both are valid, mixing them creates two problems:

1. **Coupling between structure and behaviour.** If reasoning philosophy changes (e.g., switching from 5 domains to 3, or from confidence scoring to probabilistic reasoning), the architectural contracts should not need to change.

2. **Premature commitment.** Freezing a confidence update algorithm (e.g., "0.3/0.7 weighted average") alongside the component structure locks in behavioural decisions before they've been validated by implementation.

### 2.2 What is architecture (this milestone)

| Concern | Examples |
|---------|----------|
| Component existence | "A Mental Model component exists within Session Context" |
| Component ownership | "The AI Observer is the sole writer to the Mental Model" |
| Component boundaries | "The Mental Model cannot write to Action History" |
| Information flow | "Stage 3a reads the Mental Model as advisory input" |
| Lifecycle | "Mental Model is created at Start, consumed at Stop, discarded after Stage 3" |
| Integration points | "Stage 3a and 3b are the consumers of the Mental Model" |
| Transience | "Mental Model is transient; it never enters the permanent Test Case" |

### 2.3 What is philosophy (future milestone)

| Concern | Examples |
|---------|----------|
| Reasoning domains | "AI reasons about Application Identity, Workflow, UI Focus, Intent, Change" |
| Confidence calculation | "Confidence grows by +0.15 per consistent action" |
| Hypothesis formation | "AI maintains primary + alternative intents" |
| Evidence weighting | "Intent carries 35% of overall confidence weight" |
| Prompt structure | "AI receives a semantic snapshot with these fields" |
| Reasoning cadence details | "2-second timeout, per-interaction trigger" |

### 2.4 How the prior milestone's decisions map

The prior AI Observer milestone's freeze decisions are partitioned:

| Frozen Decision | Architecture (this milestone) | Philosophy (future milestone) |
|----------------|-------------------------------|-------------------------------|
| #1: Per-interaction cadence | ✅ Structural (trigger model) | ✅ Behavioral (when AI thinks) |
| #2: 3-layer Session Context | ✅ **Structural** | — |
| #3: 5 reasoning domains | — | ✅ **Behavioral** |
| #4: Multi-dimensional confidence | — | ✅ **Behavioral** |
| #5: Confidence ceiling/floor | — | ✅ **Behavioral** |
| #6: Consumed by Stage 3a/3b, then discarded | ✅ **Structural** | — |
| #7: System works without AI | ✅ **Structural** | — |
| #8: AI constraints (never modify, etc.) | ✅ **Structural** | — |
| #9: MV3 persistence | ✅ **Structural** | — |
| #10: LLM-independent | ✅ **Structural** | — |
| Addendum #15: Advisory Input Pattern | ✅ **Structural** | — |
| Addendum #16: Sliding Session Window | ✅ Partially structural (mechanism) | ✅ Partially behavioral (window sizing) |
| Addendum #17: Expected Behaviour sub-domain | ✅ Structural (data fields exist) | ✅ Behavioral (how AI predicts) |

**Key principle:** The architecture (this milestone) freezes **what components exist, who owns them, how they connect, and when they live/die.** The philosophy (future milestone) freezes **how AI thinks within those components.**

---

## 3. AI Observer Architectural Responsibilities

### 3.1 Component definition

The AI Observer is a **service-worker-resident component** that operates during Stage 2 (Intelligent Observation) of the recording pipeline. Its architectural role is:

> To observe captured interactions and deterministic state, produce AI-derived understanding (the Mental Model), and make that understanding available to downstream stages — without ever modifying the factual record.

### 3.2 Architectural responsibilities (validated)

| Responsibility | Owner | Type |
|---------------|-------|------|
| Capture browser events | **Deterministic Recorder** | Not AI |
| Extract element identity | **Deterministic Recorder** | Not AI |
| Capture value before/after | **Deterministic Recorder** | Not AI |
| Track current DOM state (open dialogs, menus, etc.) | **Deterministic State Tracker** | Not AI |
| Maintain the Mental Model | **AI Observer** | AI |
| Produce contextual understanding for Stage 3a | **AI Observer** | AI |
| Produce element naming for Stage 3b | **AI Observer** | AI |
| Produce expected-behaviour data for future Stage 4b | **AI Observer** | AI |
| Maintain Session Context lifecycle | **Recording Session** (orchestrator) | Deterministic |

### 3.3 What the AI Observer reads

| Source | What It Reads | Frequency |
|--------|--------------|-----------|
| Action History (Layer 3) | Recent captured interactions + their evidence | Per interaction |
| Deterministic State (Layer 1) | Current URL, open UI elements, form context, mutation summary | Per interaction |
| Mental Model (Layer 2, previous state) | Its own previous understanding | Per interaction |

### 3.4 What the AI Observer writes

| Target | What It Writes | Frequency |
|--------|---------------|-----------|
| Mental Model (Layer 2) | Updated understanding (all fields within its ownership) | Per interaction |

**The AI Observer writes to exactly one place: Layer 2 of the Session Context.** It cannot write to Layer 1 (owned by State Tracker) or Layer 3 (owned by Recorder, write-once).

### 3.5 What the AI Observer does NOT do

- Does NOT capture events (that's the Recorder)
- Does NOT track DOM state (that's the State Tracker)
- Does NOT classify interactions (that's the Stage 3a Classifier)
- Does NOT generate test steps (that's Stage 3b)
- Does NOT generate Execution JSON (that's Stage 4)
- Does NOT generate Playwright (that's Stage 5)
- Does NOT modify, delete, merge, or reorder recorded actions
- Does NOT block the recording pipeline

---

## 4. Mental Model Architectural Decision

### 4.1 The question

Should a "Mental Model" exist as a named architectural component within CmdRunner's recording architecture?

### 4.2 Evaluation

**Option A: No Mental Model — AI understanding is ephemeral, unstructured**

AI is called per interaction, returns a naming/enrichment result, and the result is stored on the individual event. There is no session-level understanding structure.

| Criterion | Assessment |
|-----------|-----------|
| Simplicity | ✅ Simplest — matches current implementation |
| Session-level context | ❌ Each AI call is independent; no accumulated understanding |
| Workflow tracking | ❌ Impossible — no structure to hold workflow state |
| Downstage consumption | ❌ Stage 3a has nothing to consult except per-event fields |
| Future extensibility | ❌ Adding session-level features requires retroactive structure |

**Verdict: Insufficient for the validated architecture.** The E2E Architecture and Phase 2 both require session-level AI understanding to feed Stage 3a. An unstructured approach cannot provide this.

**Option B: Mental Model as a separate top-level component (outside Session Context)**

The Mental Model is its own component, sibling to Session Context, with its own lifecycle and storage.

| Criterion | Assessment |
|-----------|-----------|
| Separation of concerns | ✅ Clean — AI understanding is clearly separate from deterministic state |
| Lifecycle management | ⚠️ Two components to lifecycle (Session Context + Mental Model) — synchronization risk |
| Information flow | ⚠️ Stage 3a needs to read both — two read paths instead of one |
| MV3 persistence | ⚠️ Two storage keys to manage |
| Conceptual clarity | ✅ "The Mental Model is separate from the facts" |

**Verdict: Over-engineered.** The Mental Model's lifecycle is identical to Session Context's lifecycle (created at Start, consumed at Stop, discarded after Stage 3). Making it a separate top-level component creates synchronization overhead without architectural benefit.

**Option C: Mental Model as a layer within Session Context (Recommended)**

The Mental Model is **Layer 2 of the Session Context**, sitting between Deterministic State (Layer 1) and Action History (Layer 3). It is owned by the AI Observer and consumed by Stage 3a/3b.

| Criterion | Assessment |
|-----------|-----------|
| Separation of concerns | ✅ Each layer has a single owner — clear boundaries |
| Lifecycle management | ✅ One component, one lifecycle — Mental Model lives and dies with Session Context |
| Information flow | ✅ Stage 3a reads one unified structure (Session Context) with three layers |
| MV3 persistence | ✅ One storage key, one rehydration path |
| Conceptual clarity | ✅ "Session Context = what the system knows (facts) + what it understands (Mental Model)" |
| Write protection | ✅ Layer-level write protection is simple to enforce |
| Alignment with frozen decisions | ✅ Matches the 3-layer Session Context from the prior milestone exactly |

**Verdict: This is the correct architecture.** It was already established in the prior AI Observer milestone as "Layer 2: AI Understanding." This milestone adopts the name "Mental Model" for Layer 2 and confirms the structure.

### 4.3 The naming decision

**"Mental Model" is adopted as the canonical architectural name for Session Context Layer 2.**

Rationale:
1. The E2E Architecture validation already used "Mental Model" as the established term.
2. "Mental Model" communicates the component's role better than "AI Understanding Layer" — it is a model of the session maintained in the system's "mind," separate from raw observations.
3. It distinguishes the component's purpose (holistic session understanding) from a mere data store (which "AI Understanding Layer" might imply).
4. The term is used consistently across the E2E Architecture, this milestone, and future documentation.

### 4.4 Mental Model architectural definition

> **Mental Model:** A transient, AI-derived understanding layer within the Session Context (Layer 2). It is the sole output of the AI Observer. It exists from Start Recording to Stage 3 consumption. It is never part of the permanent Test Case. It is optional — the system is fully functional without it. Only the AI Observer writes to it. Stage 3a reads it as advisory input; Stage 3b reads element names from it. After Stage 3 completes, it is discarded.

### 4.5 Mental Model structural boundaries

```
┌─────────────────────────────────────────────────────┐
│                 SESSION CONTEXT                       │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  LAYER 1: DETERMINISTIC STATE                  │  │
│  │  Owner: State Tracker                          │  │
│  │  AI CANNOT write here                          │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  LAYER 2: MENTAL MODEL                         │  │
│  │  Owner: AI Observer                            │  │
│  │  Deterministic code CANNOT write here          │  │
│  │                                                │  │
│  │  Contains: AI-derived session understanding    │  │
│  │  Consumed by: Stage 3a (advisory),             │  │
│  │               Stage 3b (element names)          │  │
│  │  Discarded: After Stage 3 completes             │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  LAYER 3: ACTION HISTORY                       │  │
│  │  Owner: Recorder (write-once, immutable)       │  │
│  │  NEITHER AI NOR deterministic code modifies    │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 4.6 What the Mental Model contains (structural — not behavioral)

This milestone defines **that the Mental Model exists as a container** and **what categories of information it holds.** The specific fields, reasoning domains, and confidence algorithms are philosophy — deferred to the AI Philosophy milestone.

| Category | Description | Consumed By |
|----------|-------------|-------------|
| Session-level understanding | Application, workflow, screen, component context | Stage 3a (advisory) |
| User intent | What the user appears to be accomplishing | Stage 3a (advisory) |
| Element naming | Business names for interacted elements | Stage 3b (display) |
| Expected behaviour | What the app should do after each action | Stage 3a (advisory), future Stage 4b |
| Confidence indicators | How reliable the AI's understanding is | Stage 3a (threshold gating) |
| Alternative interpretations | Secondary hypotheses | Stage 3a (ambiguous cases) |

**The specific structure of each category (field names, types, nesting) is a philosophy decision, not an architecture decision.** The architecture guarantees the container exists, has an owner, has consumers, and is transient.

---

## 5. Session Context Architecture

### 5.1 Structural definition

The Session Context is the **single transient data structure** that holds everything the system knows about the recording session. It has three layers, each with a single writer and defined readers.

```
SessionContext
├── Layer 1: DeterministicState     (Writer: State Tracker)
├── Layer 2: MentalModel             (Writer: AI Observer)
└── Layer 3: ActionHistory           (Writer: Recorder, write-once)
```

### 5.2 Architectural properties

| Property | Value |
|----------|-------|
| Scope | One per recording session |
| Lifetime | Start Recording → Stage 3 completion |
| Persistence | `chrome.storage.local` (MV3-safe) |
| Mutability | Layer 1 and 2 are mutable (updated during recording); Layer 3 is immutable (write-once) |
| Transience | Discarded after Stage 3 — never enters permanent Test Case |
| Atomicity | Each layer update is persisted atomically to storage |

### 5.3 What is NOT in Session Context

| Excluded | Why |
|----------|-----|
| Interaction type assignments | Determined by Stage 3a classifier, post-recording |
| Canonical Test Steps | Generated after Stop Recording |
| Execution JSON | Generated after Stop Recording |
| Playwright code | Generated after Stop Recording |
| Screenshots | Stored separately by ScreenshotService |
| Test Case metadata | Lives on TestCaseDraft, not Session Context |

---

## 6. Architectural Ownership Matrix

### 6.1 Write ownership (who can write where)

| Component | Layer 1 (Deterministic State) | Layer 2 (Mental Model) | Layer 3 (Action History) |
|-----------|:---:|:---:|:---:|
| Deterministic Recorder | ❌ | ❌ | ✅ (write-once) |
| Deterministic State Tracker | ✅ | ❌ | ❌ |
| AI Observer | ❌ | ✅ | ❌ |
| Stage 3a Classifier | ❌ | ❌ | ❌ |
| Stage 3b Step Generator | ❌ | ❌ | ❌ |
| Stage 4 JSON Generator | ❌ | ❌ | ❌ |
| Stage 5 Playwright Generator | ❌ | ❌ | ❌ |

**Rule: Each layer has exactly one writer. No component writes to a layer it does not own.**

### 6.2 Read ownership (who can read what)

| Component | Layer 1 | Layer 2 (Mental Model) | Layer 3 |
|-----------|:---:|:---:|:---:|
| Deterministic Recorder | ❌ | ❌ | ✅ (own writes) |
| State Tracker | ✅ (previous state) | ❌ | ❌ |
| AI Observer | ✅ | ✅ (previous) | ✅ |
| Stage 3a Classifier | ✅ | ✅ (advisory) | ✅ |
| Stage 3b Step Generator | ❌ | ✅ (names only) | ✅ |
| Stage 4 JSON Generator | ❌ | ❌ | ✅ (via Steps) |
| Stage 5 Playwright Generator | ❌ | ❌ | ✅ (via Steps) |
| Side Panel (display) | ❌ | ✅ (display) | ✅ (display) |

### 6.3 The ownership invariant

> **Write-Once, Read-Many, Own-Your-Layer:** Each layer of Session Context has exactly one writer. Multiple components may read a layer, but only the owner writes. The Mental Model (Layer 2) is written exclusively by the AI Observer. Action History (Layer 3) is written exclusively by the Recorder and is immutable after write. Deterministic State (Layer 1) is written exclusively by the State Tracker.

This is the structural enforcement of the frozen principle: "AI never modifies recorded actions." It is enforced by architecture (no write API), not by convention.

---

## 7. Information Flow

### 7.1 During recording (Stage 2)

```
                        ┌─────────────────────────────┐
                        │       BROWSER DOM            │
                        └──────────┬──────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
          ┌─────────────┐ ┌──────────────┐ ┌────────────┐
          │  RECORDER   │ │ STATE TRACKER│ │ (none —    │
          │             │ │              │ │  AI does   │
          │ Captures    │ │ Reads DOM    │ │  not touch │
          │ events,     │ │ state:       │ │  DOM here) │
          │ extracts    │ │ open dialogs,│ │            │
          │ identity    │ │ menus, forms │ │            │
          └──────┬──────┘ └──────┬───────┘ └────────────┘
                 │               │
                 ▼               ▼
    ┌────────────────────────────────────────────┐
    │              SESSION CONTEXT                │
    │                                            │
    │  Layer 3: Action History  ←─ Recorder      │
    │  Layer 1: Det. State      ←─ State Tracker │
    │  Layer 2: Mental Model    ←─ (AI writes)   │
    │                            ↑               │
    └────────────────────────────┼───────────────┘
                                 │
                    ┌────────────┘
                    │  (reads L1 + L3,
                    │   writes L2)
                    ▼
          ┌─────────────────┐
          │  AI OBSERVER    │
          │                 │
          │  Reads:         │
          │   L1 (state)    │
          │   L3 (actions)  │
          │   L2 (previous) │
          │                 │
          │  Writes:        │
          │   L2 (updated)  │
          │   Mental Model  │
          └────────┬────────┘
                   │
                   ▼
          ┌─────────────────┐
          │  SIDE PANEL     │
          │  (display only) │
          │  Reads L2 + L3  │
          └─────────────────┘
```

### 7.2 At Stop Recording (Stage 3 consumption)

```
    User clicks "Stop Recording"
              │
              ▼
    ══════════════════════════════════════════
    ╳  TRANSIENT → PERMANENT BOUNDARY         ╳
    ══════════════════════════════════════════
              │
              │  Session Context is handed to Stage 3.
              │  Nothing else crosses this boundary.
              │
              ▼
    ┌──────────────────────────────────────────┐
    │  STAGE 3a — SEMANTIC CLASSIFICATION       │
    │                                          │
    │  Reads:                                  │
    │    Layer 3 (Action History) → evidence   │
    │    Layer 1 (Det. State) → context        │
    │    Layer 2 (Mental Model) → ADVISORY     │
    │                                          │
    │  Produces:                               │
    │    Typed Interaction Timeline            │
    └──────────────────┬───────────────────────┘
                       │
                       ▼
    ┌──────────────────────────────────────────┐
    │  STAGE 3b — CANONICAL STEP GENERATION    │
    │                                          │
    │  Reads:                                  │
    │    Layer 2 (Mental Model) → elem names   │
    │    Typed Timeline → step generation      │
    │                                          │
    │  Produces:                               │
    │    Canonical Test Steps                  │
    └──────────────────┬───────────────────────┘
                       │
                       ▼
    ┌──────────────────────────────────────────┐
    │  SESSION CONTEXT DISCARDED               │
    │                                          │
    │  Layer 1, Layer 2, Layer 3 all removed   │
    │  from storage.                           │
    │                                          │
    │  What persists (crossed the boundary):   │
    │    • Typed Interaction Timeline          │
    │    • Recording Context                   │
    │    • Screenshots                         │
    │    • AI enrichment on events (names)     │
    └──────────────────────────────────────────┘
```

### 7.3 Information flow principles

1. **Forward-only flow.** Information flows from Stage 2 → Stage 3a → Stage 3b → Stage 4 → Stage 5. No stage reaches backward to modify a prior stage's output.

2. **Layer isolation.** Each layer's writer is the only component that creates or modifies that layer's data. Readers consume but never mutate.

3. **Single consumption point.** The Mental Model is consumed at Stage 3 and then destroyed. No part of it flows to Stage 4 or Stage 5. (Exception: element names are projected onto individual Timeline events during Stage 3b, and those events persist — but the Mental Model structure itself does not.)

4. **No backchannel.** Stage 3a does not send feedback to the AI Observer. The classifier reads the Mental Model once and produces its output. There is no iterative refinement loop between classifier and AI Observer.

---

## 8. Component Boundaries

### 8.1 Boundary diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    RECORDING SESSION                          │
│                    (Orchestrator)                             │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  RECORDER    │  │ STATE TRACKER│  │  AI OBSERVER     │  │
│  │              │  │              │  │                  │  │
│  │ Boundary:    │  │ Boundary:    │  │ Boundary:        │  │
│  │ DOM events   │  │ DOM queries  │  │ Session Context  │  │
│  │ → L3 writes  │  │ → L1 writes  │  │ reads → L2 writes│  │
│  │              │  │              │  │                  │  │
│  │ Cannot:      │  │ Cannot:      │  │ Cannot:          │  │
│  │  write L1/L2 │  │  write L2/L3 │  │  write L1/L3     │  │
│  │  classify    │  │  classify    │  │  capture events  │  │
│  │  generate    │  │  generate    │  │  classify        │  │
│  └──────────────┘  └──────────────┘  │  generate        │  │
│                                       │  block pipeline  │  │
│                                       └──────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  SESSION CONTEXT (shared data structure)            │    │
│  │                                                     │    │
│  │  L1: Deterministic State   ← State Tracker          │    │
│  │  L2: Mental Model          ← AI Observer            │    │
│  │  L3: Action History        ← Recorder (immutable)   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                          │
                    (at Stop Recording)
                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    GENERATION PIPELINE                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ STAGE 3a     │  │ STAGE 3b     │  │ STAGE 4 / 5      │  │
│  │ CLASSIFIER   │  │ STEP GEN     │  │ JSON / PLAYWRIGHT│  │
│  │              │  │              │  │                  │  │
│  │ Reads:       │  │ Reads:       │  │ Reads:           │  │
│  │  L3 evidence │  │  L2 names    │  │  Canonical Steps │  │
│  │  L1 context  │  │  Typed TL    │  │  (with JSON)     │  │
│  │  L2 advisory │  │              │  │                  │  │
│  │              │  │              │  │ Cannot:          │  │
│  │ Cannot:      │  │ Cannot:      │  │  read Session Cx │  │
│  │  write any L │  │  classify    │  │  read Mental Mod │  │
│  │  generate    │  │  write any L │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Boundary enforcement

Each boundary is enforced structurally, not by convention:

| Boundary | Enforcement |
|----------|------------|
| Recorder cannot write L1/L2 | Recorder has no reference to L1/L2 write APIs |
| State Tracker cannot write L2/L3 | State Tracker has no reference to L2/L3 write APIs |
| AI Observer cannot write L1/L3 | AI Observer receives read-only references to L1/L3 |
| Stage 3a/3b cannot write any layer | Generation pipeline receives a snapshot copy, not live references |
| Stage 4/5 cannot read Session Context | Session Context is discarded before Stage 4 begins |

---

## 9. Lifecycle

### 9.1 Unified lifecycle

Session Context and Mental Model share **one lifecycle** — they are created together, evolve together, are consumed together, and are discarded together.

```
CREATED
│  Trigger: Start Recording
│  Action:  Initialize Session Context
│           Layer 1: Capture initial DOM state
│           Layer 2: Empty Mental Model (no AI reasoning yet)
│           Layer 3: Empty Action History
│           Persist all to chrome.storage.local
│
▼
EVOLVING (during recording)
│  Trigger: Each captured interaction + each navigation
│
│  Per interaction:
│    1. Recorder appends to Layer 3 (immutable write-once)
│    2. State Tracker updates Layer 1 (deterministic DOM read)
│    3. AI Observer updates Layer 2 / Mental Model (async)
│
│  All three layers persisted to storage on every update.
│
▼
CONSUMED (at Stop Recording)
│  Trigger: User clicks Stop Recording
│
│  Stage 3a reads all three layers → produces typed Timeline
│  Stage 3b reads Mental Model element names → produces Steps
│
▼
DISCARDED
   Trigger: Stage 3 completes
   Action:  Session Context (all 3 layers) removed from storage
   
   What persists (crossed Transient→Permanent boundary):
     • Typed Interaction Timeline
     • Recording Context (startUrl, startTitle, capturedAt)
     • Screenshots
     • AI element names (projected onto Timeline events)
   
   What does NOT persist:
     • Mental Model (Layer 2) — discarded
     • Deterministic State (Layer 1) — discarded
     • Raw Action History (Layer 3) — superseded by typed Timeline
     • Workflow understanding, intent, confidence — all discarded
```

### 9.2 Lifecycle validation

The proposed lifecycle (Created → Updated → Refined → Consumed → Discarded) is **validated as appropriate.**

The "Updated" and "Refined" steps from the proposal are the same operation architecturally: each layer is updated by its owner when new information arrives. There is no separate "refinement" pass — the Mental Model evolves in place as the AI Observer processes each interaction.

### 9.3 MV3 service worker lifecycle

All Session Context layers are persisted to `chrome.storage.local` on every update. If the MV3 service worker is terminated and restarted:

| Layer | On Restart |
|-------|-----------|
| Layer 1 (Det. State) | DOM state is stale — State Tracker re-reads DOM on next event |
| Layer 2 (Mental Model) | Rehydrated from storage — AI Observer continues from last state |
| Layer 3 (Action History) | Rehydrated from storage — no data loss (immutable) |

---

## 10. AI Observer Constraints

### 10.1 Architectural constraints (validated)

These constraints are **structural** — they define what the AI Observer component can and cannot do architecturally. They are distinct from reasoning philosophy constraints (how AI should think).

| Constraint | Type | Enforcement |
|-----------|------|------------|
| AI must never modify recorded actions | Structural | Layer 3 write API not exposed to AI Observer |
| AI must never delete actions | Structural | Layer 3 has no delete API |
| AI must never merge actions | Structural | Layer 3 has no merge API |
| AI must never reorder actions | Structural | Layer 3 is append-only |
| AI must never generate Playwright | Structural | AI Observer has no reference to Stage 5 |
| AI must never generate Execution JSON | Structural | AI Observer has no reference to Stage 4 |
| AI must never replace deterministic evidence | Structural | AI Observer cannot write to Layer 1 or Layer 3 |
| AI must never override deterministic decisions | Structural | Classifier reads AI as advisory only (Tier 2) |
| AI must never determine interaction type | Structural | Classifier does not read type suggestions from Mental Model |
| AI must never block the recording pipeline | Structural | AI calls are async with timeout; pipeline continues without AI |

### 10.2 Positive architectural constraints

| Constraint | Enforcement |
|-----------|------------|
| The Mental Model must be the sole output of the AI Observer | AI Observer's only write target is Layer 2 |
| The Mental Model must be transient | Discarded after Stage 3 — no persistence path to Test Case |
| The system must function without AI | Layer 2 can be empty — classifier operates on Layers 1+3 alone |

### 10.3 What is NOT constrained here

Reasoning-level constraints (how AI should reason, when to express uncertainty, how to handle conflicting evidence) are **philosophy** and are deferred to the AI Philosophy milestone. This milestone constrains only the structural behavior of the component.

---

## 11. Integration with Semantic Interaction Generation

### 11.1 Validated relationship

The proposed flow:

```
Observed Action Timeline  ──┐
Deterministic Evidence    ──┤
Session Context           ──┤
Mental Model              ──┘
                             ↓
                  Semantic Understanding
                             ↓
                  Semantic Interaction Generation
```

Is **validated as architecturally correct.** The refined version:

```
Action History (L3)     ──┐
                          │
Deterministic State (L1) ─┤  →  STAGE 3a CLASSIFIER  →  Typed Timeline
                          │     (evidence + advisory)
Mental Model (L2)        ──┘
                                                    ↓
Mental Model (L2 names) ──────→  STAGE 3b STEP GEN →  Canonical Steps
Typed Timeline          ──────→
```

### 11.2 Stage 3a consumption model

Stage 3a (Semantic Classification) reads all three layers:

| Layer | Role | How Used |
|-------|------|---------|
| Layer 3 (Action History) | **Primary evidence** | Every classifier rule tests action evidence (value changes, state changes, DOM context) |
| Layer 1 (Det. State) | **Environmental context** | Rules that need ancestor context (e.g., "is this inside a calendar?") |
| Layer 2 (Mental Model) | **Advisory input** | Consulted at Tier 2 only when Tier 1 evidence is ambiguous |

### 11.3 Stage 3b consumption model

Stage 3b (Canonical Step Generation) reads:

| Source | What It Takes |
|--------|--------------|
| Mental Model (Layer 2) | Element business names for plain English descriptions |
| Typed Timeline | Steps, numbering, readability optimization |

Stage 3b does NOT read Layer 1, workflow context, intent, or confidence.

### 11.4 The consumption boundary

After Stage 3a + 3b complete:
- Session Context is **discarded** (all three layers)
- Only the typed Timeline and AI element names (projected onto events) persist
- No Mental Model data reaches Stage 4 or Stage 5

This is the structural enforcement of: "The Mental Model is transient."

---

## 12. Scalability

### 12.1 The scalability test

For each future interaction type, the question is: **does the AI Observer / Mental Model / Session Context architecture require redesign?**

| Future Type | Architecture Impact | Redesign? |
|-------------|-------------------|-----------|
| Dropdowns | ✅ Already implemented | N/A |
| Date Pickers | ✅ Already implemented | N/A |
| Hover Menus | ✅ Already implemented | N/A |
| Drag & Drop | New evidence pattern in Layer 3; AI reads it in Mental Model | NO |
| File Upload | New evidence in Layer 3; AI reads it | NO |
| Rich Text Editors | Complex contentEditable evidence | NO |
| Canvas | Coordinate evidence | NO |
| Maps | Pan/zoom evidence | NO |
| Enterprise Custom Controls | Custom ARIA patterns | NO |

### 12.2 Why it scales

The architecture is **interaction-type-agnostic:**
- The Recorder captures any event → appends to Layer 3
- The State Tracker reads any DOM state → updates Layer 1
- The AI Observer reads Layers 1+3 → updates Mental Model (Layer 2)
- The Classifier reads all layers → classifies

No component is interaction-type-specific. New types add evidence patterns and classifier rules (additive), not architectural components.

### 12.3 Scalability verdict

**VALIDATED.** The architecture naturally supports all listed future interaction types without redesign.

---

## 13. Relationship to Previously Frozen Milestones

### 13.1 What this milestone changes vs prior milestones

| Prior Frozen Decision | Status in This Milestone |
|----------------------|--------------------------|
| Session Context = 3 layers (AI Observer milestone #2) | ✅ **Confirmed** — identical structure |
| Layer 2 was named "AI Understanding" | **Renamed to "Mental Model"** — conceptual clarity, zero structural change |
| AI Observer writes only to Layer 2 (#2, #8) | ✅ **Confirmed** |
| Layer 3 is write-once immutable (#3) | ✅ **Confirmed** |
| Mental Model is transient (E2E Architecture) | ✅ **Confirmed** |
| Consumed by Stage 3a/3b, then discarded (#6, #9) | ✅ **Confirmed** |
| System works without AI (#7, #10) | ✅ **Confirmed** |
| All constraints (#8) | ✅ **Confirmed** |
| Advisory Input Pattern (Addendum #15) | ✅ **Confirmed** |
| Sliding Session Window (Addendum #16) | ✅ **Confirmed** (mechanism is structural; sizing is philosophy) |
| Expected Behaviour (Addendum #17) | ✅ **Confirmed** (data structure is architectural; prediction method is philosophy) |

### 13.2 What this milestone defers to the AI Philosophy milestone

| Topic | Deferred To |
|-------|-------------|
| 5 reasoning domains (AI Observer #3) | AI Philosophy milestone |
| Confidence model: 5 tracks, weights, thresholds (AI Observer #4, #5, #6) | AI Philosophy milestone |
| Confidence update algorithm (AI Observer §6.4) | AI Philosophy milestone |
| Reasoning input structure details (AI Observer §5.4) | AI Philosophy milestone |
| Sliding window sizing (default 5, ceiling 10) | AI Philosophy milestone |
| Expected behaviour prediction method | AI Philosophy milestone |
| Prompt design | AI Philosophy milestone |

### 13.3 Consistency check

**ALL PREVIOUSLY FROZEN DECISIONS ARE PRESERVED.** The only change is terminological: Layer 2 is named "Mental Model" instead of "AI Understanding." This is a naming clarification that aligns with the E2E Architecture validation's established terminology. No structural, behavioral, or contractual decision is modified.

---

## 14. Freeze Declaration

The following architectural decisions are declared **frozen**:

| # | Decision |
|---|----------|
| 1 | **Three components exist during recording:** Deterministic Recorder, Deterministic State Tracker, and AI Observer. Each has distinct responsibilities and cannot perform the others' functions. |
| 2 | **Session Context is a single transient data structure** with three layers: Deterministic State (L1), Mental Model (L2), and Action History (L3). |
| 3 | **The Mental Model is adopted as a named architectural component.** It is Layer 2 of the Session Context. It is the sole output of the AI Observer. It is transient — consumed by Stage 3 and discarded. It never enters the permanent Test Case. |
| 4 | **Each Session Context layer has exactly one writer.** Layer 1 ← State Tracker. Layer 2 ← AI Observer. Layer 3 ← Recorder (write-once). No component writes to a layer it does not own. |
| 5 | **The Mental Model's architectural role is advisory.** It provides contextual understanding to Stage 3a (classification hints) and Stage 3b (element names). It never determines interaction types, generates artifacts, or modifies facts. |
| 6 | **Information flow is forward-only.** Data flows Stage 2 → Stage 3a → Stage 3b → Stage 4 → Stage 5. No stage reaches backward. No backchannel exists between classifier and AI Observer. |
| 7 | **Session Context and Mental Model share one lifecycle:** Created at Start Recording, evolved per interaction during recording, consumed at Stop Recording by Stage 3, discarded after Stage 3 completes. |
| 8 | **All Session Context state is persisted to `chrome.storage.local`** (MV3-safe). Service worker termination does not cause data loss. Rehydration on restart is transparent. |
| 9 | **The system is fully functional without AI.** When AI is not configured, the Mental Model (Layer 2) is empty. The classifier operates on Layers 1+3 alone. All downstream stages produce correct output. |
| 10 | **AI Observer constraints are structural:** never modify/delete/merge/reorder actions (enforced by Layer 3 write API), never classify (enforced by classifier architecture), never generate artifacts (enforced by component boundaries), never block pipeline (enforced by async timeout). |
| 11 | **Stages 4 and 5 cannot read Session Context.** It is discarded before Stage 4 begins. Only the typed Timeline and AI element names (projected onto events) persist beyond Stage 3. |
| 12 | **The architecture is interaction-type-agnostic.** New interaction types add evidence patterns and classifier rules (additive) — no architectural component changes. |
| 13 | **The architecture is LLM-independent.** No component design depends on a specific AI provider, model, or capability. |
| 14 | **Architecture and philosophy are separated.** This milestone freezes component structure, ownership, boundaries, flow, and lifecycle. How AI reasons within the Mental Model is deferred to the AI Philosophy milestone and does not affect this architecture. |

---

*This document defines the canonical software architecture for the AI Observer, Session Context, and Mental Model within CmdRunner. It is consistent with all frozen milestones (E2E Architecture, Product Architecture PA1-PA12, Phase 2, AI Observer & Session Context, AI Observer Addendum, B1-B8, C3-C6). The sole change from prior milestones is terminological: Layer 2 is named "Mental Model" for conceptual clarity. No structural decision is modified. AI reasoning philosophy is explicitly deferred to a future milestone.*
