# CmdRunner — Architectural Evolution: From Recorder to AI QA Platform

**Document type:** Permanent architecture reference  
**Audience:** All future contributors, architects, and decision-makers  
**Purpose:** Explain not just *what* we decided, but *why* we made each decision — so future contributors understand the reasoning, the alternatives considered, and the evidence behind every architectural choice.  
**Date:** July 2026  
**Base commit:** 7bfd949 (validated foundation), fcee3a7 (HEAD with stabilization fixes)

---

## Table of Contents

1. [The Starting Point: Commit 7bfd949](#1-the-starting-point-commit-7bfd949)
2. [Why We Re-Evaluated the Architecture](#2-why-we-re-evaluated-the-architecture)
3. [Evidence That Led Us to Choose This Direction](#3-evidence-that-led-us-to-choose-this-direction)
4. [Architectural Principles We Agreed On](#4-architectural-principles-we-agreed-on)
5. [The Complete Platform Vision](#5-the-complete-platform-vision)
6. [Lifecycle Validation: Can 7bfd949 Become the Platform?](#6-lifecycle-validation-can-7bfd949-become-the-platform)
7. [The Implementation Roadmap](#7-the-implementation-roadmap)
8. [Interaction Model Investigation](#8-interaction-model-investigation)
9. [Modern Web Interaction Analysis](#9-modern-web-interaction-analysis)
10. [The Adani One Findings](#10-the-adani-one-findings)
11. [Why the Issue Is Detection, Not Semantic Model](#11-why-the-issue-is-detection-not-semantic-model)
12. [The Surface-Anchored Detection Approach](#12-the-surface-anchored-detection-approach)
13. [Decisions Made, Alternatives Considered, and Rejections](#13-decisions-made-alternatives-considered-and-rejections)
14. [Open Questions and Validation Steps](#14-open-questions-and-validation-steps)

---

## 1. The Starting Point: Commit 7bfd949

### What Existed

At commit 7bfd949, the codebase was a working browser recorder Chrome extension with Playwright test generation. It had been built through 12 phases of development and contained:

- **186 source files**, ~19,200 lines of TypeScript
- **155 test files**, 3,810 passing tests across 141 test files
- **5 evidence channels** (Accessibility, DOM Structure, Behavioral, Mutations, Focus/Overlay)
- **40 interaction types** in the classifier (navigation, mouse, text entry, selection controls, date/time, file upload, scrolling, dialogs, frames)
- **10 IR actions** (click, fill, select, selectDate, toggle, hover, navigate, verify, wait, waitForElement)
- **6 AI providers** (Gemini, OpenAI, Claude, OpenRouter, Azure OpenAI, Custom)
- **9 repository interfaces** with Dexie/IndexedDB implementation
- **5 component session types** in the SemanticReasoner (dropdown, datePicker, autocomplete, multiConfig, formSubmit)
- **Playwright code generator** with 7 renderer files
- **Self-healing pipeline** with source-agnostic core and shared locator ranking
- **Capability entity** with enrichment model, append-only history, and confidence progression

### What 7bfd949 Proved

The commit itself — "fix: root-cause calendar & dropdown capture on modern React SPAs (adanione.com)" — demonstrated that the recorder could handle real-world modern web applications. Three root causes were fixed:

1. **Dropdown options not recognized:** AdaniOne renders options as plain divs/spans inside popover surfaces without ARIA `role=option`. The fix broadened pattern matching and added `isDropdownOptionWithFallback` for options identified by accessibleName alone.

2. **Stale value capture on heavy SPAs:** The 50ms post-click delay was too short for React state flush + re-render (100-300ms on heavy pages). The fix replaced the single poll with a multi-poll sequence (50ms, 150ms, 400ms) that stops on first detected value change.

3. **Date/city value in display div:** AdaniOne writes selected values to sibling display divs, not back into the trigger input's `.value`. The fix added `findDisplayValue` fallback scanning siblings for display-value CSS classes.

### The Codebase at a Glance

```
Architecture layers at 7bfd949:

  DOM Events
    → Event Tap (capture-phase listeners)
    → Identity Extractor (19-field element identity)
    → Evidence Channels A-E (5 independent observers)
    → Recognition Pipeline (declarative pattern matching, 40 types)
    → Lifecycle Engine (component session state machine)
    → Semantic Reasoner (multi-interaction collapsing)
    → IR Bridge (pure function: events+interactions → ExecutionIRPlan)
    → IR Executor (Chrome extension runtime) / Playwright Generator
    → Self-Healing Pipeline (source-agnostic, shared locator ranking)
    → Repository V2 (Dexie/IndexedDB, 9 interfaces)
```

---

## 2. Why We Re-Evaluated the Architecture

### The Question

We had a working recorder. The question was: **Is this the right foundation for the long-term vision — an AI QA Automation platform, not just a recorder or Playwright generator?**

The user's goal was explicitly stated:

> *Our goal is to build an AI-powered QA Automation platform, not simply a browser recorder or a Playwright test generator.*

This required answering:
1. Can 7bfd949 evolve into a complete AI QA platform through additive evolution alone?
2. Will we hit an architectural ceiling that requires redesign?
3. Is this the foundation we'd choose if we started from scratch?

### The Evaluation Process

Rather than assessing the recorder in isolation, we validated the architecture against the complete 10-stage platform lifecycle:

1. Record a workflow on a modern React application
2. Produce semantic interactions
3. Identify a business capability
4. AI generates additional test scenarios
5. Convert scenarios to execution IR
6. Execute through multiple engines (CmdRunner, Playwright, Appium, API, Desktop)
7. Execution produces evidence
8. AI performs failure analysis and root-cause analysis
9. Self-healing updates execution without changing business intent
10. Future recordings enrich the capability model

For each stage, we asked:
- Which existing component from 7bfd949 is responsible?
- Which new additive component is needed?
- Does this require additive evolution or architectural redesign?
- How does it remain compatible with future capabilities?

### Why the Re-Evaluation Was Necessary

Three reasons made the re-evaluation essential before committing further development:

**Reason 1: The dual-pipeline debt.** The codebase had two parallel interaction type systems — `DetectedInteraction` (40-type classifier output consumed by the IR Bridge) and a stub `SemanticInteraction` (4 fields in `architecture-types.ts`). The full 22-field observation model was designed in `SEMANTIC_INTERACTION_BOUNDARY.md` but never materialized in code. This was the single structural debt that could compound if left unaddressed.

**Reason 2: The vision-to-code gap.** The architecture documents (7 documents, ~6,500 lines) described a platform vision, but the code was a recorder. We needed to verify that the vision documents weren't aspirational architecture — that they described structures that could actually be built from the existing codebase.

**Reason 3: The cost of a wrong foundation.** Choosing the wrong architectural foundation and discovering it 2 years later is the most expensive mistake a platform can make. The re-evaluation was insurance against that risk.

---

## 3. Evidence That Led Us to Choose This Direction

### Evidence 1: Clean Abstraction Boundaries

We found five frozen contracts already implemented at 7bfd949, each designed with engine-neutrality:

| Contract | Location | Evidence of Correct Design |
|----------|----------|---------------------------|
| ExecutionIRPlan | `src/domain/execution-ir/types.ts` | Design principle P1: "No field name references Playwright, Selenium, Cypress, or any tool." Verified: 10 actions, all framework-neutral. |
| IRExecutor interface | `src/domain/execution-ir/adapters/ir-executor.ts` | `execute(plan, options) → result` — accepts any IR, returns structured results. One implementation (Chrome executor) exists; Playwright/Appium/API would implement the same interface. |
| IRCodeGenerator interface | `src/domain/execution-ir/adapters/ir-code-generator.ts` | `generate(plan, config) → files` — Playwright adapter (7 files, ~2,684 lines) is one implementation. Adding Cypress/Appium = new implementation of same interface. |
| Locator ranking | `src/domain/locator-ranking.ts` | 5-category hierarchy used by BOTH recording-time IR Bridge AND execution-time healing. Same function, same rules. This is the shared healing spine. |
| Capability entity | `src/domain/entities/capability.ts` | Append-only enrichment history with structured deltas, conflict resolution (stricter-constraint-wins), confidence progression. Designed for continuous learning. |

### Evidence 2: Self-Healing Was Already Production-Ready

The self-healing pipeline at 7bfd949 was not a design — it was working code:

```
healElementAndPersist() — source-agnostic core:
  "Loads a stored Element, applies healElement() with provided locator strategies,
   and persists the result. Does NOT know where the locators came from
   (recording, execution-time DOM inspection, AI suggestion, etc.)."
```

The `HealContext` carries a `proposedBy` field that already anticipates multiple sources: recording, execution DOM, AI suggestion, manual correction. The audit trail (`Element.healHistory[]`) is append-only with `HealEvent` recording old strategies, new strategies, reason, and proposer.

This meant the feedback loop (failure → diagnosis → healing → re-execution) was structurally ready. The AI layer would feed suggestions into the same `healElementAndPersist()` function with `proposedBy: 'ai'`.

### Evidence 3: The Capability Model Was Designed for Continuous Learning

The `Capability` entity's invariants were explicitly designed for a platform that gets smarter over time:

- **INV-CAP2:** `enrichmentHistory[]` is append-only — every learning event is permanent
- **INV-CAP3:** Confidence progresses through consistent/contradictory observations — never resets
- **INV-CAP4:** `sessionIds` tracks every recording session that contributed — provenance for every learning event
- **INV-CAP5:** Name never changes — identity is permanent even as understanding evolves

The enrichment model with structured `EnrichmentChange` deltas (added fields, modified values, conflicts) and `stricter-constraint-wins` conflict resolution meant the platform could learn from new recordings without corrupting existing knowledge.

### Evidence 4: The Observation/Projection Boundary Prevents God-Object Degeneration

`SEMANTIC_INTERACTION_BOUNDARY.md` established that `SemanticInteraction` contains ONLY observations (22 immutable fields). Every consumer concern (assertions, execution hints, AI interpretations, healing strategies) lives in a separate projection type referencing the interaction by ID.

This meant adding a new platform capability (AI test generation, visual regression, accessibility audit) = adding a new projection type. SemanticInteraction itself never grows. This is the architectural property that prevents the most common failure mode in evolving systems.

### Evidence 5: AI Was Correctly Positioned as a Consumer

The AI provider abstraction (6 providers, registry pattern) was already production-ready. But critically, the AI was positioned as a *consumer* of the semantic model, not a *layer in the pipeline*. The architecture didn't need to know about AI — AI needed to know about the architecture. This is the correct relationship, and it means AI capabilities can evolve independently.

### Evidence 6: 8 of 11 Platform Components Already Existed

The `ARCHITECTURAL_PATH_EVALUATION.md` analysis found that 8 of 11 components needed for the full platform vision already existed at 7bfd949. The 3 gaps (capture abstraction, AI reasoning layer, cross-platform locators) were all additive — none required redesign.

---

## 4. Architectural Principles We Agreed On

These principles emerged from the evaluation and govern all subsequent decisions:

### Principle 1: Observation Is Immutable, Everything Else Is Disposable

```
Observation (SemanticInteraction)  → Immutable. Factual. Frozen.
Capability                         → Versioned. Managed. Has identity.
Execution (ExecutionIRPlan)        → Disposable. Regenerable. Mechanical.
Implementation (Playwright code)   → Disposable. Replaceable.
```

No consumer concern ever pollutes the observation. No execution detail ever bleeds into the capability model. No implementation detail ever leaks into the IR.

### Principle 2: The Four-Layer Separation Is the Correct Axis for QA

Each layer answers a different question with a different mutability profile:

- **Observation** answers "What did the user do?" — never changes
- **Capability** answers "What were they trying to accomplish?" — evolves with understanding
- **Execution** answers "How do we reproduce it?" — regenerable from capability + interactions
- **Implementation** answers "How does this engine perform it?" — replaceable per engine

This separation means: adding AI doesn't touch execution; adding engines doesn't touch capabilities; changing locators doesn't change business intent; self-healing updates IR without touching capability.

### Principle 3: Every Change Is Additive

Adding a new capability = adding a new projection type. Adding a new engine = implementing `IRExecutor`. Adding a new code target = implementing `IRCodeGenerator`. Adding a new interaction type = adding to an enum. No existing type ever changes structurally — only grows with optional fields.

### Principle 4: No Parallel Systems

Phase 0 explicitly eliminates the dual-pipeline debt. After that, every new component is additive — it implements an existing interface or extends an existing type. No second pipeline alongside v1. No bridge layers between parallel systems.

### Principle 5: Every Phase Leaves the Product Releasable

No phase introduces temporary architectures that will later be removed. Every phase delivers user-visible value. If development stopped after any phase, the product would be better than before.

### Principle 6: AI Is a Consumer, Not a Layer

The AI reads `SemanticInteraction[]`, `Capability[]`, and `ExecutionRun[]`, and produces projections, test cases, and analysis. The architecture doesn't coordinate with AI — AI coordinates with the architecture. AI capabilities evolve at their own pace.

---

## 5. The Complete Platform Vision

### What CmdRunner Will Be

A QA tester should be able to:

1. **Record** a workflow once without writing code
2. **Generate** semantic test cases automatically from the recording
3. **Execute** those test cases reliably on traditional and modern web applications
4. **Generate** Playwright tests from the same recording
5. **Re-execute** the same test case without re-recording
6. **Use AI** to generate additional positive, negative, boundary, validation, accessibility, security, and regression test cases
7. **Reuse** learned business capabilities (Login, Book Flight, Create Customer) across multiple test cases and future recordings
8. **Execute** the same test case through multiple engines (CmdRunner, Playwright, Appium, API, Desktop) from the same semantic model
9. **Self-heal**, perform root-cause analysis, AI-assisted maintenance, and continuous learning without changing the business intent

### What CmdRunner Is NOT

- Not just a browser recorder
- Not just a Playwright test generator
- Not an execution-only framework (Selenium/Playwright replacement)
- Not an AI-only tool (test generation without recording)

### The Platform Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVATION LAYER                         │
│                                                             │
│  SemanticInteraction[] (Immutable, 22+ fields)              │
│    "What the user did"                                      │
│    Frozen contract. Referenced by everything downstream.    │
│    Observation/Projection boundary enforced.                │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ capability inference (projection)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    CAPABILITY LAYER                          │
│                                                             │
│  Capability[] (Versioned domain model)                      │
│    "What business outcome the user intended"                │
│    Composed of SemanticInteraction references.              │
│    Has identity, lifecycle, versioning, dependencies.       │
│    The PRIMARY unit of test management and AI reasoning.    │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
           │ IR generation                │ AI reasoning
           ▼                              ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│   EXECUTION LAYER        │  │   AI LAYER                   │
│                          │  │                              │
│  ExecutionIRPlan         │  │  Test generation             │
│    (Disposable,          │  │  Failure analysis            │
│     regenerable)         │  │  Impact analysis             │
│  Multi-engine:           │  │  Coverage analysis           │
│    CmdRunner executor    │  │  Self-healing suggestions    │
│    Playwright executor   │  │  Workflow mining             │
│    Appium executor       │  │  Maintenance recommendations │
│    API executor          │  │                              │
│    Desktop executor      │  │  Operates on:                │
│                          │  │    Capability[] +            │
│  ↓ produces              │  │    SemanticInteraction[]     │
│                          │  └──────────────────────────────┘
│  ExecutionRun            │
│    (Append-only,         │
│     evidence-bearing)    │
└──────────────────────────┘
```

---

## 6. Lifecycle Validation: Can 7bfd949 Become the Platform?

We traced all 10 stages of the platform lifecycle against the existing codebase. The conclusion:

| Stage | Existing Component | New Component Needed | Redesign? |
|-------|-------------------|---------------------|-----------|
| 1. Record on React SPA | Event Tap + Identity Extractor + Evidence Channels | None for web | No |
| 2. Semantic interactions produced | Recognition Pipeline + Lifecycle Engine + Semantic Reasoner | Unify dual pipeline into SemanticInteraction | **Refactor** (not redesign) |
| 3. Capability identified | CapabilityDeriver + Capability entity | Adoption phase (review, version, relate) | Additive |
| 4. AI generates test scenarios | AI Provider Manager (6 providers) | TestGenerationEngine + PromptBuilder | Additive |
| 5. Scenarios → Execution IR | IR Bridge (pure function) | CapabilityIRGenerator | Additive |
| 6. Multi-engine execution | IRExecutor interface + Chrome executor + Playwright code generator | PlaywrightExecutor, AppiumExecutor, ApiExecutor, DesktopExecutor | Additive (new implementations of existing interface) |
| 7. Execution produces evidence | ExecutionRun entity (append-only) | EvidenceCaptureService (screenshots, DOM snapshots) | Additive |
| 8. AI failure analysis | AI Provider Manager + ExecutionRun data | FailureAnalysisEngine + RootCauseReport | Additive |
| 9. Self-healing | healElementAndPersist() (source-agnostic, production-ready) | AIHealingService (extends existing core) | Additive |
| 10. Continuous learning | Capability enrichment model (append-only history) | CapabilityEnrichmentPipeline + CoverageAnalyzer | Additive |

**Verdict:** 90% additive evolution. One internal refactor (dual-pipeline merge). One structural work item (capture adapter extraction for non-web platforms — additive interface, not redesign). No frozen contract violations.

### The Four Explicit Questions — Answered

**Q1: Can 7bfd949 evolve through incremental additive evolution alone?**
Almost entirely yes. ~90% of the platform is purely additive. One refactor (dual-pipeline merge) is internal plumbing — no boundary contract changes.

**Q2: If no major redesign is required, justify with evidence.**
Five structural properties make it ceiling-proof: (1) Four-layer separation is correct for the domain, (2) Observation/Projection boundary prevents god-object degeneration, (3) IR is engine-neutral by enforced design principle, (4) Self-healing is source-agnostic and already production-ready, (5) Capability entity has continuous-learning built into its invariants.

**Q3: Where will a redesign eventually be necessary?**
One place: the capture layer for non-web platforms. EventTap uses `document.addEventListener` with DOM-specific event types. Extracting a `CaptureAdapter` interface makes EventTap one implementation (`WebCaptureAdapter`); mobile/API get their own. This is interface extraction — additive, not structural. No downstream contract changes.

**Q4: Would we still choose this architecture 3-5 years ahead?**
Yes. The separation of concerns along the correct axis (Observation → Capability → IR → Implementation) is future-proof. The only scenario requiring structural change would be real-time adaptive test execution (where the executor dynamically modifies the test plan mid-execution). The architecture's design principle P5 ("designed for graph evolution") anticipates this as an additive wrapper.

---

## 7. The Implementation Roadmap

The full 11-phase roadmap (Phase 0 through Phase 10) is documented in `.drytis/IMPLEMENTATION_ROADMAP.md`. Summary:

### Three Tracks That Converge

```
Critical Path (Semantic → AI pipeline):
  Phase 0: SemanticInteraction Contract & Pipeline Unification
  Phase 1: Persistent Semantic Layer
  Phase 2: Capability Adoption Lifecycle
  Phase 3: Capability-Derived IR Generation
  Phase 4: AI Test Generation Engine

Execution Reliability Track:
  Phase 5: Enhanced Execution Engine
  Phase 6: Multi-Engine Execution — Playwright
  Phase 7: AI Failure Analysis & Enhanced Self-Healing

Cross-Platform Track:
  Phase 8: Cross-Platform Capture & Execution Foundation
  Phase 9: Platform Expansion — Mobile (Appium) & API

Convergence:
  Phase 10: Continuous Learning & Platform Intelligence
```

### Why This Ordering

- **Phase 0 first:** Every subsequent phase depends on SemanticInteraction being the persistent, shared model
- **Phase 1 before Phase 2:** Capability composition references interactions by ID — those must be queryable
- **Phase 2 before Phase 3:** IR generation from capabilities needs approved capabilities with data requirements
- **Phase 3 before Phase 4:** AI-generated test cases must be executable to be useful
- **Phase 5 before Phase 6:** Playwright execution needs the same retry/wait/evidence infrastructure as Chrome execution
- **Phase 6 before Phase 7:** AI failure analysis needs results from multiple engines
- **Phase 7 before Phase 8:** Web platform must be complete before expanding to other platforms
- **Phase 10 last:** Continuous learning requires all prior phases

### Debt-Free Guarantee

- No temporary architectures — every component is permanent
- No parallel systems — Phase 0 eliminates the dual pipeline
- Every phase delivers user-visible value
- If stopped after Phase 4: AI test generation platform for web
- If stopped after Phase 7: full AI QA platform for web
- If complete: full AI QA Automation platform across web, mobile, and API

---

## 8. Interaction Model Investigation

### The Question

Before freezing the SemanticInteraction contract in Phase 0, we needed to verify that the interaction model correctly captures every interaction type a modern web application uses.

### What We Examined

We traced every interaction type through all layers of the architecture:

1. **Event Tap** — which DOM events are captured (`DEFAULT_EVENT_TYPES`)
2. **Element Identity** — 19 fields in `RawElementIdentity`
3. **Evidence Channels A-E** — what signals each channel produces
4. **Recognition Patterns** — 7 pattern files matching signals to interaction types
5. **Semantic Reasoner** — 5 component session types for multi-event collapsing
6. **InteractionType enum** — 40 values
7. **IRAction enum** — 10 values
8. **Playwright Action Renderer** — how IR actions map to Playwright methods

### Key Finding: The Session Model Is the Right Pattern

The SemanticReasoner's component session model (activation → absorption → completion → cancellation → timeout) is the correct mechanism for handling composite interactions. Five session types exist:

| Session Type | What It Handles | Status at 7bfd949 |
|-------------|----------------|-------------------|
| dropdown | Custom dropdown open → select option → close | ✅ Working (7bfd949 focus) |
| datePicker | Calendar open → navigate months → select date | ✅ Working (7bfd949 focus) |
| autocomplete | Type → suggestions appear → select suggestion | ✅ Working |
| multiConfig | Panel trigger → configure fields → Done/Apply | ⚠️ Designed, detection unreliable |
| formSubmit | Fill form fields → submit button | ✅ Working |

The `multiConfig` session is specifically designed for composite widgets like AdaniOne's passenger/class selector. The architecture is correct; the detection is unreliable (detailed in Section 10).

---

## 9. Modern Web Interaction Analysis

### Methodology

We classified interactions into 7 behavioral categories and mapped each against how it behaves in traditional HTML, React, Angular, Vue, and custom/canvas UIs.

### Coverage Assessment: ~85% of Modern Interactions Handled

| Category | Coverage | Details |
|----------|----------|---------|
| Discrete Actions (click, link, button) | ✅ Strong | `isInteractiveElement()` checks tag, ARIA role, tabIndex, CSS classes |
| Text Entry (input, textarea) | ✅ Strong | Multi-poll timing fix from 7bfd949 handles React controlled inputs. Contenteditable detected. |
| Selection Controls (dropdown, autocomplete, checkbox, radio, toggle) | ✅ Strongest | Primary focus of 7bfd949. Broadest pattern coverage. Three RC fixes for real SPAs. |
| Temporal Controls (date, time, slider) | ✅ Strong for single-date | Calendar navigation absorbed. Display-div fallback. Range pickers not session-aware. |
| Layout & Navigation Surfaces (modal, drawer, popover) | ⚠️ Partial | Surfaces detected by Channel D. But elements inside surfaces lack container context (no OverlayContext like IframeContext). |
| Drag & Drop and Gestures | ⚠️ Weak | `DragDrop` type exists but EventTap doesn't listen for drag/pointer events. |
| Virtualized & Dynamic Content | ⚠️ Partial | Scroll captured. DOM recycling in virtualized lists not handled — locators may be invalid at execution time. |

### The 15 Gaps Identified

**Critical (3):**
- Rich Text Editors (Quill, TipTap, ProseMirror) — toolbar clicks captured as separate interactions, HTML value treated as text
- Drag & Drop (react-dnd, dnd-kit) — not captured at all (missing event types)
- Virtualized Lists (react-window, ag-Grid) — DOM recycling invalidates locators at execution time

**Important (8):**
- Date Range Picker, Accordion, Carousel, Tag/Chip Input, Transfer/Shuttle List, Tree Selector, Time Picker (scroll wheel), Range Slider

**Minor / Out of Scope (3):**
- Rich Data Grids (cells as clicks — works, lacks coordinates)
- Canvas/WebGL Widgets (no DOM events)
- Map Widgets (tile-based rendering)

### Impact on SemanticInteraction Freeze

The 15 gaps do NOT require redesigning the SemanticInteraction model. They require additive extensions following existing patterns. Three adjustments to the frozen contract ensure future-proofing:

1. **`value` type expansion:** `string | null` → `string | number | boolean | object | null` (for RTE HTML, date ranges, multi-select arrays, slider ranges)
2. **`gestureData` optional field:** For drag paths, swipe directions, pinch scale (pure observation, follows observation/projection boundary)
3. **Identity context fields:** `virtualContext` (for virtualized containers) and `overlayContext` (for elements inside surfaces) — both follow the existing `IframeContext` pattern

Everything else is purely additive: new InteractionType values, new ComponentSession types, new IRAction values, new event types in EventTap.

---

## 10. The Adani One Findings

### What the User Observed

Testing on AdaniOne (adanione.com) revealed four specific failures:

1. **Passenger/Class control recognized as click on down-arrow icon** instead of the Passenger/Class composite component
2. **+/- buttons captured as generic Click interactions** instead of Increase/Decrease value operations
3. **Selecting Premium Economy not treated as part of Passenger/Class** interaction
4. **Departure date captured twice** (open calendar + select date) instead of a single "Select Departure Date" interaction

### What the Screenshots Revealed

The AdaniOne passenger/travel class selector is a **composite widget**:
- A header button ("2 • Premium Economy" with a chevron icon) opens a dropdown panel
- The panel contains **stepper controls** (circular +/- buttons for Adults, Children, Infants)
- **Segmented toggle buttons** for travel class (Economy, Premium Economy, Business)
- A **Done button** to confirm and close

### The Common Root Cause

All four failures share one architectural blind spot:

**The SemanticReasoner makes activation and absorption decisions using only the interaction's target element identity and CSS class matching. It does NOT use the surface/overlay evidence that Evidence Channels D and E already collect.**

Evidence Channel D (`channel-d-mutations.ts`) already detects surfaces appearing and disappearing — it produces `SurfaceInfo` with type, role, accessibleName, and direction. Channel E detects overlay open/close events. Both produce evidence records: `surfaceAppearance`, `surfaceDisappearance`, `overlayOpen`, `overlayClose`.

**But this evidence is never carried through to the `DetectedInteraction` that the reasoner processes.** The `metadata.surfaceLabel` and `metadata.surfaceRole` fields exist in `InteractionMetadata` — they're just never populated. The reasoner has no way to know that "this click happened inside a popover that opened 200ms ago."

### How Each Failure Traces to the Root Cause

| Failure | Specific Cause | Root Cause |
|---------|---------------|------------|
| Click on icon, not component | Click target resolves to SVG icon child, not interactive ancestor. Icon doesn't carry trigger CSS classes. | CSS-class-based activation fails when class names don't match known patterns OR click lands on inner element |
| +/- as generic Click | Even if session were active, `shouldAbsorbMultiConfig()` checks accessibleName for "+/-/add/remove" — icon-only buttons with no text label fail | Absorption relies on target element properties, not surface membership |
| Premium Economy separate | Toggle button is `<div>` without `role=radio`, classified as Click not RadioButton. Absorption check for RadioButton misses it. | Same — absorption doesn't know this interaction is inside the open panel |
| Date captured twice | Click on date wrapper div doesn't trigger DatePicker activation (checks for `<input type=date>`). Calendar cell click starts fresh session. | Click target resolution picks wrapper, not the input. No surface-aware activation. |

---

## 11. Why the Issue Is Detection, Not Semantic Model

### The multiConfig Session Is Already the Composite Component Model

When the user asked "do we need a new Composite Component interaction model?", the answer was definitively no. The `multiConfig` session type already implements everything that model would:

| Requirement | multiConfig Implementation | Status |
|-------------|---------------------------|--------|
| Trigger opens a panel | `isMultiConfigActivation()` | ✅ Designed |
| Internal events absorbed | `shouldAbsorbMultiConfig()` | ✅ Designed |
| Field-value extraction | `extractConfigField()` | ✅ Designed |
| Done/Apply completes | `isMultiConfigCompletion()` | ✅ Designed |
| Result: single interaction | `buildMultiConfigInteraction()` — collapses to one with `semanticAction: 'configure'` and `configuredFields` | ✅ Designed |
| Outside-click cancellation | `cancelMultiConfigOnOutsideClick()` | ✅ Designed |

Adding a separate "Composite Component" model would duplicate this entire architecture. The fix is to make the existing model **work reliably** by fixing the detection pipeline.

### The Architecture Is Sound; the Wiring Is Broken

The evidence channels collect surface data. The session model knows how to use it. The metadata fields that would carry it (`surfaceLabel`, `surfaceRole`) exist. But the pipeline never connects them. This is a wiring failure, not an architectural deficiency.

### Why a New Model Would Be the Wrong Solution

Creating a new "Composite Component" model would:
1. **Duplicate** the session lifecycle (activation → absorption → completion) that multiConfig already implements
2. **Fragment** the reasoner's logic across two similar session types
3. **Not fix** the root cause — the new model would still need surface evidence to activate, and that evidence still wouldn't be wired through
4. **Break** the principle of additive evolution — we'd be adding a parallel system that overlaps with existing functionality

---

## 12. The Surface-Anchored Detection Approach

### The Insight

The existing multiConfig activation/absorption uses **element-identity-based detection**: it checks the target element's CSS classes, accessibleName, and ARIA role. This is fragile because:

1. CSS class names vary across frameworks and applications (no universal pattern)
2. Click targets often resolve to inner elements (SVG icons) that don't carry the parent's classes
3. Icon-only buttons have no text label for keyword matching

The fix is **surface-anchored detection**: if an interaction causes a surface (popover, drawer, modal) to appear, activate a session. If an interaction occurs inside a surface that's currently open, absorb it. This is robust because:

1. Surface appearance/disappearance is detected by DOM mutations (Channel D) — reliable across all frameworks
2. Surface membership doesn't depend on the click target's CSS classes — it depends on whether a surface is open
3. It works for any composite widget, not just ones with known CSS patterns

### The Five Changes

All changes are within the detection pipeline. No frozen contract changes.

#### Change 1: Propagate Surface Evidence to DetectedInteraction

Add `surfaceContext` to `InteractionMetadata`:

```typescript
surfaceContext?: {
  type: 'modal' | 'popover' | 'drawer' | 'menu' | 'dropdown';
  surfaceLabel?: string;
  openedByThisInteraction?: boolean;
} | null;
```

Populated by the pipeline when Channel D/E detect a surface is open. This is the missing wire between evidence channels and the reasoner.

#### Change 2: Surface-Anchored Activation

If a click causes a surface to appear (detected via Channel D mutation evidence), activate a multiConfig session — regardless of CSS class names. Existing CSS-class-based activation remains as fallback.

#### Change 3: Surface-Anchored Absorption

If an interaction occurred inside a surface that's currently open (tracked by the active session), absorb it — regardless of CSS classes or target element type. Existing field-type absorption remains as fallback.

#### Change 4: Stepper Detection Enhancement

Add icon-based and aria-label-based detection for icon-only +/- buttons. Check CSS classes for `plus|minus|add|increment|stepper`, check aria-label patterns, check for single-character accessible names.

#### Change 5: Click Target Ancestor Resolution

When a click lands on an SVG icon or span inside a button, resolve upward to the nearest interactive ancestor. This ensures the trigger element carries the correct role and labels.

### Why Each Change Is Correct

| Change | Reasoning |
|--------|-----------|
| Surface evidence propagation | The evidence already exists (Channel D/E). The fields already exist (`surfaceLabel`/`surfaceRole`). The wire just needs connecting. This is the highest-leverage, lowest-risk change. |
| Surface-anchored activation | DOM mutations are the most reliable cross-framework signal. A popover appearing after a click is detectable regardless of CSS naming conventions. |
| Surface-anchored absorption | "Is this interaction inside an open surface?" is a more robust question than "Does this element share CSS class tokens with the trigger?" |
| Stepper detection | Icon-only buttons are common in modern UIs. The detection uses multiple signals (CSS class, aria-label, accessible name) for resilience. |
| Click target resolution | Standard accessibility practice: the interactive element is the ancestor with role/tabIndex, not the icon inside it. This improves ALL detection, not just composite components. |

### Impact on Phase 0

These changes are entirely within the detection pipeline (SemanticReasoner, detectors, event tap). They do not touch:
- The SemanticInteraction contract
- The InteractionType enum
- The IRAction enum
- The IR Bridge
- The Capability model
- Any frozen or planned-frozen contract

**This validates that Phase 0 can proceed as designed.** The composite component problem is a detection pipeline fix, not a model redesign.

---

## 13. Decisions Made, Alternatives Considered, and Rejections

### Decision 1: Keep the multiConfig Session Model (Don't Create a New Composite Component Model)

**Decision:** The existing `multiConfig` session type IS the composite component model. Fix detection, don't add a new model.

**Alternative considered:** Create a dedicated `CompositeComponent` session type with its own activation/absorption/completion logic.

**Why rejected:**
- Would duplicate the session lifecycle that multiConfig already implements
- Would fragment reasoner logic across overlapping session types
- Would not fix the root cause (surface evidence not wired through)
- Violates the principle of additive evolution

### Decision 2: Surface-Anchored Detection (Not Improved CSS Pattern Matching)

**Decision:** Base activation/absorption on surface appearance/membership detected by Channel D, with CSS patterns as fallback only.

**Alternative considered:** Expand `PANEL_TRIGGER_CLASSES` and `DROPDOWN_TRIGGER_CLASSES` to cover more framework patterns. Add AdaniOne-specific class patterns.

**Why rejected:**
- CSS class matching is inherently fragile — new apps use new patterns
- Maintaining a growing list of CSS class patterns is unsustainable
- The surface detection mechanism (DOM mutation observation) is already implemented and cross-framework
- CSS patterns would still need surface evidence for absorption (they only help with activation)

### Decision 3: Three Adjustments to SemanticInteraction Before Freeze

**Decision:** Expand `value` type, add `gestureData`, add `virtualContext`/`overlayContext` to identity — all before freezing.

**Alternative considered:** Freeze the model as-is and add fields later when needed.

**Why rejected:**
- `value: string | null` forces structured data (date ranges, multi-select arrays, HTML content) into string encoding — changing this after freeze is a breaking change to every consumer
- `virtualContext` and `overlayContext` follow the existing `IframeContext` pattern — the field slots should exist from the start
- `gestureData` is a pure observation that can't be derived later if not captured at recording time
- All three are optional/nullable — they don't affect existing consumers

### Decision 4: Phase 0 Before Detection Fixes (With Caveat)

**Decision:** The detection fixes (surface-anchored absorption) should be done as Phase 0 pre-work to validate the session model before freezing SemanticInteraction.

**Alternative considered:** Do detection fixes after Phase 0 (after freezing SemanticInteraction).

**Why rejected:**
- If we freeze SemanticInteraction and then discover the multiConfig model doesn't work in practice, we'd need to revisit assumptions about what the observation captures
- The detection fixes validate that composite interactions are correctly collapsed — this is essential evidence that the observation model is sufficient
- The fixes are small (5 changes in detection layer) and don't touch the contract

### Decision 5: Dual-Pipeline Merge as Refactor, Not Redesign

**Decision:** Merge `DetectedInteraction` (40-type classifier output) and the stub `SemanticInteraction` (4 fields) into the full 22-field `SemanticInteraction` model. This is Phase 0.

**Alternative considered:** Keep both types and add an adapter between them.

**Why rejected:**
- An adapter would be a permanent bridge layer between two parallel systems — exactly the anti-pattern the observation/projection boundary exists to prevent
- The `DetectedInteraction` type is an intermediate pipeline output — it should not be the persisted, shared model
- The merge is internal plumbing: same lifecycle, same recognition logic, same IR output — just a different output container type

### Decision 6: Keep `DetectedInteraction` as Recognition-Only Intermediate

**Decision:** After the merge, `DetectedInteraction` is retained ONLY as the recognition pipeline's intermediate output (not persisted, not consumed by IR Bridge).

**Alternative considered:** Remove `DetectedInteraction` entirely and have the recognition pipeline output `SemanticInteraction` directly.

**Why rejected:**
- The recognition pipeline's job is to classify raw events — `DetectedInteraction` is the right abstraction for "a classified event before semantic reasoning"
- The SemanticReasoner's job is to collapse/absorb/complete sessions — it needs an input type that represents individual classified events
- Removing the intermediate would couple recognition to semantic reasoning, violating separation of concerns

---

## 14. Open Questions and Validation Steps

### Before Implementation

| # | Question | Validation Step |
|---|----------|----------------|
| 1 | Does surface-anchored activation work for ALL composite widget types, or just AdaniOne-style panels? | Test against 3+ different composite widgets: (a) AdaniOne passenger selector, (b) a transfer/shuttle list, (c) a filter panel with mixed control types |
| 2 | Does click target ancestor resolution break any existing interaction detection? | Run the full 3,810 test suite after the change. Record on OrangeHRM (known working app) and verify identical output. |
| 3 | Is the `surfaceContext` propagation fast enough to not introduce recording latency? | Profile the pipeline before and after. Surface context is computed from already-collected evidence — no new DOM queries needed. |
| 4 | Does the `value: string | number | boolean | object | null` type change break any existing IR Bridge logic? | The IR Bridge already handles `IRInput = string | number | boolean | null`. Adding `object` to SemanticInteraction's value is compatible — the bridge already serializes to IRInput. |
| 5 | Will the stepper detection heuristic produce false positives on non-stepper icon buttons? | Test against common icon-only button patterns (close X, hamburger menu, settings gear) to verify they're not absorbed as steppers. |

### Before Freezing SemanticInteraction

| # | Question | Validation Step |
|---|----------|----------------|
| 6 | Are 23 fields (22 original + `gestureData`) sufficient, or will we need more observation fields? | The observation/projection boundary ensures consumer concerns never add fields to SemanticInteraction. The 23 fields cover all physical observations (identity, context, value, state, evidence, gesture). Projections carry consumer-specific data. |
| 7 | Is `virtualContext` the right shape, or should it be a more general "dynamic context"? | Start with the minimal shape (containerLocator, itemIndex, itemCount). If virtualization patterns require more data (scroll position, rendering window), add fields. The field is optional — adding fields later is non-breaking. |
| 8 | Should `overlayContext` carry the surface's full locator chain or just the surface type? | Start with type + locator. The locator is for execution context (entering/exiting the surface). The type is for semantic classification. If execution needs more (z-index, animation state), add fields. |

### Before Phase 0 Implementation

| # | Question | Validation Step |
|---|----------|----------------|
| 9 | Can the dual-pipeline merge be done without breaking the side panel UI? | The side panel displays interactions — the display layer will need to adapt from `DetectedInteraction` display fields to `SemanticInteraction` display fields. Characterization test: capture side panel output before, verify equivalent after. |
| 10 | Will the IR Bridge produce identical output when given `SemanticInteraction[]` instead of `(SessionEvent[] + DetectedInteraction[] + Fragment)`? | Write a characterization test: record 10 diverse interactions, capture the exact IR output, then verify identical output after the input change. The bridge is a pure function — same semantic content should produce same IR. |

---

## Appendix A: Document Cross-Reference

This document is the narrative reference. The following documents contain detailed specifications:

| Document | Location | Role |
|----------|----------|------|
| `IMPLEMENTATION_ROADMAP.md` | `.drytis/` | 11-phase roadmap with acceptance criteria and frozen contracts |
| `MODERN_INTERACTION_ANALYSIS.md` | `.drytis/` | 15-gap analysis across frameworks |
| `COMPOSITE_COMPONENT_ANALYSIS.md` | `.drytis/` | AdaniOne findings and surface-anchored detection design |
| `CAPABILITY_MODEL.md` | `.drytis/` | Four-layer architecture and capability domain model |
| `SEMANTIC_INTERACTION_BOUNDARY.md` | `.drytis/` | 22-field observation model and observation/projection boundary |
| `execution-ir-design.md` | `.drytis/` | IR type system, design principles P1-P5 |
| `PLATFORM_EXECUTION_ARCHITECTURE.md` | `.drytis/` | Semantic context at execution time |
| `ARCHITECTURE_FREEZE_STRATEGY.md` | `.drytis/` | Frozen contracts and gap analysis |
| `ARCHITECTURAL_PATH_EVALUATION.md` | `.drytis/` | Component-by-component platform readiness assessment |
| `architecture-evolution-blueprint.md` | `.drytis/` | 9-phase pipeline evolution plan |

## Appendix B: Current Codebase Statistics

| Metric | Value |
|--------|-------|
| Source files | 186 |
| Source lines | ~19,200 |
| Test files | 155 |
| Tests passing | 3,810 (at time of analysis) |
| Evidence channels | 5 (A: Accessibility, B: DOM Structure, C: Behavioral, D: Mutations, E: Focus/Overlay) |
| Interaction types | 40 |
| IR actions | 10 |
| Component session types | 5 (dropdown, datePicker, autocomplete, multiConfig, formSubmit) |
| AI providers | 6 (Gemini, OpenAI, Claude, OpenRouter, Azure OpenAI, Custom) |
| Repository interfaces | 9 |
| Frozen contracts identified | 40+ types and interfaces |

---

*This document is the permanent reference for the CmdRunner architectural evolution. Future contributors should read it before making architectural decisions, as it captures not just what we decided but why — the evidence, the alternatives, and the reasoning behind every choice.*
