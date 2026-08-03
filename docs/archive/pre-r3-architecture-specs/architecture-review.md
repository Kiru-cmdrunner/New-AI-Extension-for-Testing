# UI Knowledge Model — Architecture Review & Documentation

> **Purpose:** A comprehensive, self-contained architecture review of the CmdRunner
> Smart Recorder's UI Knowledge Model after Phases 1–4. This document validates that
> the implementation still aligns with the architectural direction developed through
> the design discussions, and orients a new engineer to both the *what* and the *why*
> without requiring them to read the prior conversation history.
>
> **Audience:** Engineers joining the project, architects reviewing direction, and
> the project owner validating continued alignment with the original vision.
>
> **Status as of this writing:** Phases 1–4 (Foundation, Structural Recognition,
> Behavioral Recognition, Component Registry & Orchestrator) are implemented and
> verified. Phase 5 (Post-Recording Enrichment & Derived Views) is the next planned
> phase. The Application Knowledge Fragment type exists but is not yet materialized
> by an enrichment pass.

---

## Table of Contents

1. [Original Vision](#1-original-vision)
2. [Overall Architecture](#2-overall-architecture)
3. [Phase-by-Phase Review](#3-phase-by-phase-review)
4. [Domain Model Review](#4-domain-model-review)
5. [Recognition Architecture](#5-recognition-architecture)
6. [Recognition vs Enrichment](#6-recognition-vs-enrichment)
7. [Evidence Model](#7-evidence-model)
8. [Application Knowledge Model](#8-application-knowledge-model)
9. [Alignment Review](#9-alignment-review)
10. [Technical Debt](#10-technical-debt)
11. [Readiness Assessment](#11-readiness-assessment)
12. [Final Architecture Assessment](#12-final-architecture-assessment)

---

## 1. Original Vision

### The Problem

Test automation recorders are fundamentally **event loggers**. They watch what the
user did — "clicked element A, typed 'hello' into element B, clicked element C" —
and emit a flat sequence of executable steps. This output has three structural
limitations that compound over time:

1. **It records actions, not meaning.** "Clicked `div.x.y:nth-child(3)`" is a
   mechanical fact. "Selected *Premium Economy* in the *Travel Class* dropdown" is
   the business fact the tester actually cares about. The recorder captures the
   former and asks a human (or an LLM) to reconstruct the latter — every time,
   from scratch, with no accumulated understanding.

2. **It has no model of the application.** The recorder sees each interaction in
   isolation. It doesn't know that the three clicks above were one semantic action
   (open dropdown → select option → confirm), that the dropdown has six other
   options the user didn't pick, or that the field is required and has validation
   behavior. Every piece of context beyond the raw event is lost.

3. **It cannot support the next generation of test capabilities.** Negative test
   generation needs input constraints. Boundary testing needs value ranges.
   Self-healing needs ranked locator strategies and semantic identity. Accessibility
   testing needs ARIA profiles. None of these can be derived from a flat event log
   — they require a *model of the application*.

The original CmdRunner recorder (v1.x–v6.1.0) was exactly such an event logger. It
worked, but it hit a ceiling: every new capability required re-deriving application
context from scratch, because the recorder never built or persisted one.

### The Evolution: Event Recorder → Application Knowledge Model

The architecture evolved through **four distinct eras**, each driven by a specific
limitation of the previous one:

#### Era 1 — Legacy Multi-Script Recorder (v1.x–v6.1.0)

The original architecture used **six to eight independent content scripts**, each
responsible for one interaction family: `click-recorder.js`, `text-entry-recorder.js`,
`hover-recorder.js`, `checkbox-radio-recorder.js`, `select-recorder.js`,
`date-picker-recorder.js`, etc. Each script (~300–1,600 lines) captured its own
events and **classified them immediately at capture time**.

This created three problems:
- **O(n²) cross-script coordination.** Each script needed "skip rules" telling it to
  ignore events that another script had already claimed. Adding a new interaction
  type required adding skip rules to *every other script*. The coordination
  complexity grew quadratically.
- **~200 lines duplicated across six scripts.** Element identity resolution,
  ownership signaling (`data-cmdrunner-handled`), and event filtering were copied
  into each recorder.
- **Irreversible misclassification.** Classification happened at the moment of
  capture, with no later evidence to correct it. A combobox that looked like a text
  field on focus stayed a text field forever.

The `interaction-types.ts` file became a single coupling point that every script
depended on; adding a type rippled to 8+ files.

#### Era 2 — Semantic Interaction Architecture ("Architecture C")

The pivotal architectural decision: **capture first, classify second.**

Instead of each content script classifying its own events, the team designed a
three-layer separation:

1. **Universal Observer** — ONE content script that captures ALL browser events +
   DOM context. No classification, no skip rules, no ownership. It just records
   evidence.
2. **Snapshot Coalescer** — a service-worker module that groups related raw events
   (mousedown + click + change) into a single `InteractionSnapshot` with rich
   pre/post evidence (value changes, state changes, class changes, mutations).
3. **Semantic Classifier** — a deterministic pure function applying 16 ordered
   priority rules across three tiers. Tier 1 (deterministic, R1–R6) fires before
   Tier 2 (behavioral, R7–R14) fires before Tier 3 (AI advisory + fallback,
   R15–R16).

This eliminated the O(n²) coordination entirely. There is one observer, one
coalescer, one classifier — linear data flow. Seven architectural principles (AP1–
AP7) were codified, the most important being:

- **AP1 — Separation of evidence and classification.** The observer captures; the
  classifier decides. Never both in the same component.
- **AP4 — Evidence sovereignty.** Deterministic evidence (ARIA roles, observed DOM
  mutations) structurally overrides AI reasoning. ARIA is the page author's explicit
  declaration of semantic structure — it wins.
- **AP5 — Linear data flow.** No feedback loops. The classifier never feeds back
  into the observer. Recognition is a downstream consumer.
- **AP7 — Additive extensibility.** New interaction types add classification rules,
  not new systems.

The 16-rule classifier was validated against a 93-scenario corpus across seven
domains with a quality score of 5.0/5 — zero gaps, zero new types required, zero
redundancies. This became the **Semantic Interaction Language**: a 10-type canonical
taxonomy that all downstream stages operate on.

An 8-phase implementation plan (Phase 0: shared types → Phase 7: legacy retirement)
executed this transition under a feature flag (`USE_ARCHITECTURE_C`), with zero
regression guarantee.

#### Era 3 — Engineering Formalization

With Architecture C proven, the team formalized the engineering contracts:

- **42 shared objects** catalogued across six layers (Recording, Context,
  Intelligence, Execution, Review, Infrastructure), each with **sole-writer
  ownership** — no component writes to an object it doesn't own.
- **15 algorithms** specified, with the critical constraint: **AI never makes the
  final decision.** AI proposes; deterministic rules dispose.
- **8 frozen AI principles (P1–P8):** observation first, progressive understanding,
  evidence sovereignty, hypothesis discipline (max 3 competing hypotheses), honest
  confidence, evidence citation, hallucination rejection (7 anti-hallallucination
  rules), provider independence.
- **Confidence model:** 5 independent tracks (intent 35%, workflow 25%, appFocus
  15%, uiFocus 15%, change 10%), each clamped to [0.05, 0.95].
- **Session Context:** a 3-layer write-protected structure — L1 Deterministic State
  (owned by State Tracker), L2 Mental Model (owned by AI Observer), L3 Action
  History (owned by Recorder). No component writes to a layer it doesn't own.

This era also produced the **Evidence Engine** — a provider-pluggable architecture
with weighted voting. Multiple evidence providers (DomProvider, AriaProvider,
EventSequenceProvider) each contribute evidence observations with confidence; all
evidence is combined via weighted voting. Real-world validation (Avis Ford + Google
Flights) improved accuracy from 17% (6/35 ACCURATE) to 57% (20/35).

A deep debugging saga — the "C3.3 Hover Detection" investigation — evaluated 23
approaches (A1–A23) to reliably detect CSS `:hover` mega-menus that produce zero
DOM mutations. The final "walk-up clone" solution (clone at each ancestor level
until the clone shows invisible elements) passed 15/15 patterns including CSS-only
mega menus, opacity transitions, sibling selectors, and React/Vue/Angular patterns,
at ~0.9ms average. The investigation preserved every frozen abstraction — only the
implementation of `takePreHoverSnapshot()` changed.

#### Era 4 — The Application Knowledge Model (current)

The final conceptual leap, documented in `.drytis/ui-knowledge-model.md`: the
recording pipeline should produce **dual output**, not single output:

1. **Test steps** — the deterministic rendering of what happened (unchanged).
2. **Application Knowledge Fragment** — a semantic understanding of what the
   application *is*, how it *behaves*, and what *changed*.

This reframes the recorder's purpose. It is no longer an event logger that happens
to produce test steps. It is an **application knowledge builder** that produces test
steps as one of several outputs. The model is **application-centric, not AI-centric**
— AI is one consumer of the knowledge model, alongside recording, execution,
self-healing, reporting, and future capabilities.

This required three foundational entities (UiElement, ObservedTransition,
ComponentGrouping), four derived views (InteractionContract, BehavioralContract,
ApplicationSurface, RecordedWorkflow), and a **progressive three-tiered component
recognition** system (structural → behavioral → AI-assisted) with a lifecycle
(tentative → developing → confirmed | rejected).

### Key Architectural Decisions Throughout

| Decision | Era | Rationale |
|----------|-----|-----------|
| Capture-first, classify-second | 2 | Eliminate O(n²) cross-script coordination; make classification reversible |
| Evidence sovereignty (structural > behavioral > AI) | 2 | Page authors' ARIA declarations are authoritative; AI is advisory |
| Linear data flow (no feedback loops) | 2 | Recognition is a downstream consumer, never feeds back into observer |
| Additive extensibility (new patterns = catalogue entries) | 2, 4 | Adding capability never requires modifying existing systems |
| AI never makes the final decision | 3 | Deterministic rules dispose; AI proposes |
| Sole-writer ownership for all shared objects | 3 | No component writes to an object it doesn't own |
| Application-centric model (not AI-centric) | 4 | The model describes the application; AI is one consumer |
| Three foundations, four views | 4 | Minimal persistence, maximal derivation; views always recomputable |
| Progressive recognition (tentative → confirmed) | 4 | Accumulate confidence across interactions; reject on contradiction |
| Generic recognizers (zero pattern-specific logic) | 4 | All pattern knowledge is declarative data in the catalogue |

---

## 2. Overall Architecture

### End-to-End Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER RUNTIME                                │
│                                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐                │
│  │  Raw Browser │──▶│   Universal  │──▶│      Coalescer    │                │
│  │    Events    │   │   Observer   │   │  (Snapshot        │                │
│  │ (click, key, │   │ (1 content   │   │   Coalescer)      │                │
│  │  input, ...) │   │  script)     │   │                   │                │
│  └──────────────┘   └──────────────┘   └────────┬──────────┘                │
│         ▲                                        │                           │
│         │                                        ▼                           │
│   ┌─────┴──────┐                      ┌──────────────────┐                  │
│   │ State      │◀────────────────────│   Classifier      │                  │
│   │ Tracker    │   (reads page state) │  (16-rule, 3-tier │                  │
│   │ (context)  │                      │   pure function)  │                  │
│   └────────────┘                      └────────┬──────────┘                  │
│                                                 │ ClassifiedInteraction      │
└─────────────────────────────────────────────────┼───────────────────────────┘
                                                  │
┌─────────────────────────────────────────────────┼───────────────────────────┐
│                       UI KNOWLEDGE MODEL        ▼                           │
│  ┌──────────────┐                      ┌──────────────────┐                  │
│  │  UiElement   │◀──────identity────────│  ObservedTransi- │                  │
│  │  (the atom)  │                       │  tion (behavioral│                  │
│  │              │                       │  raw data)       │                  │
│  └──────┬───────┘                       └────────┬─────────┘                  │
│         │                                        │                            │
│         │          ┌─────────────────────────────┤                            │
│         │          │                             │                            │
│         │          ▼                             ▼                            │
│         │  ┌──────────────┐            ┌──────────────────┐                   │
│         │  │  Structural  │            │   Behavioral     │                   │
│         │  │ Recognizer   │            │   Recognizer     │                   │
│         │  │  (Tier 1)    │            │   (Tier 2)       │                   │
│         │  └──────┬───────┘            └────────┬─────────┘                   │
│         │         │                             │                             │
│         │         └──────────┬──────────────────┘                             │
│         │                    ▼                                                │
│         │         ┌──────────────────┐                                        │
│         │         │  Recognition     │                                        │
│         │         │  Orchestrator    │                                        │
│         │         │  (per-interaction│                                        │
│         │         │   flow)          │                                        │
│         │         └────────┬─────────┘                                        │
│         │                  │                                                  │
│         │                  ▼                                                  │
│         │         ┌──────────────────┐                                        │
│         └────────▶│  Component       │                                        │
│           (refs)  │  Registry        │                                        │
│                   │  (session store) │                                        │
│                   └────────┬─────────┘                                        │
│                            │                                                  │
│                            ▼                                                  │
│                   ┌──────────────────┐                                        │
│                   │ ComponentGrouping│                                        │
│                   │ (semantic        │                                        │
│                   │  decision)       │                                        │
│                   └────────┬─────────┘                                        │
└────────────────────────────┼─────────────────────────────────────────────────┘
                             │
                     ┌───────┴──────────────────────────────────────────────────┐
                     │  ON STOP (Post-Recording)                                │
                     │                                                          │
                     │  ┌──────────────────┐  ┌──────────────────┐             │
                     │  │   Enrichment     │─▶│  Derived Views   │             │
                     │  │   Pass (Phase 5) │  │  • Interaction-  │             │
                     │  │   (read-only DOM │  │    Contract      │             │
                     │  │    inspection)   │  │  • Behavioral-   │             │
                     │  └──────────────────┘  │    Contract      │             │
                     │          │             │  • Application-  │             │
                     │          ▼             │    Surface       │             │
                     │  ┌──────────────────┐  │  • Recorded-     │             │
                     │  │  Application     │  │    Workflow      │             │
                     │  │  Knowledge       │  └──────────────────┘             │
                     │  │  Fragment        │                                   │
                     │  └────────┬─────────┘                                   │
                     └───────────┼─────────────────────────────────────────────┘
                                 │
                    ┌────────────┴───────────────────────────────┐
                    │           FUTURE CONSUMERS                  │
                    │                                            │
                    │  Test Gen  Negative  Boundary  Accessibility│
                    │            Testing    Testing   Testing     │
                    │  Self-Heal AI Assist  Workflow  Execution   │
                    │                        Underst.  Reporting  │
                    └────────────────────────────────────────────┘
```

### Responsibility of Every Stage

| Stage | Responsibility | Key Property |
|-------|---------------|--------------|
| **Raw Browser Events** | The physical events (click, keydown, input, mouseover, mutation). Captured with capture-phase listeners. | Complete, unfiltered |
| **Universal Observer** | ONE content script capturing ALL events + DOM context into `RawEvidence`. No classification, no skip rules, no ownership. | AP1: separation of evidence and classification |
| **State Tracker** | Content script maintaining real-time page state: current URL, open dialogs, open dropdowns, active form, active element. Session Context Layer 1. | Sole-writer: only this owns L1 |
| **Coalescer** | Groups related raw events into `InteractionSnapshot`s with rich pre/post evidence. Opens/closes temporal windows, deduplicates (mousedown+click+change → one snapshot), computes valueChange/stateChange/classChange. | Temporal grouping, not semantic |
| **Classifier** | Deterministic pure function. 16 ordered priority rules, 3 tiers. Produces `ClassifiedInteraction` with type AND relevance (deliberate/supporting/noise). | Stateless, one snapshot → one type |
| **UiElement** | The atomic unit of the knowledge model. Mechanical identity + DOM attributes + intrinsic capabilities + optional component membership. | Application-centric; exists independently of components |
| **ObservedTransition** | The behavioral raw data. What happened, what changed, what evidence confirms it, what else was affected (cascades). | Empirical record; BehavioralContract is derived from these |
| **Structural Recognizer** | Tier 1 recognition. Uses ARIA composite widget roles and native HTML semantics. Confidence 0.95 (authoritative). <1ms. | Generic — zero pattern-specific logic; reads catalogue |
| **Behavioral Recognizer** | Tier 2 recognition. Uses coalescer evidence (mutations, valueChange, stateChange) to recognize patterns when ARIA is absent. ~5ms. | Generic — evaluates declarative behavioral signatures |
| **Recognition Orchestrator** | Per-interaction flow. Runs both recognizers, resolves identity, merges results (structural authority), enriches, checks lifecycle, checks rejection. | Zero pattern-specific logic; reads catalogue for lifecycle |
| **Component Registry** | Session-scoped store. Manages ComponentGrouping lifecycle. Identity resolution, evidence accumulation, lifecycle progression, rejection. | Generic; the ONLY writer of lifecycle state |
| **ComponentGrouping** | The semantic decision. A recognized UI pattern composed of multiple elements. Pattern type, constituents, lifecycle state, business field, option set. | Persisted; recognition is expensive to recompute |
| **Post-Recording Enrichment** | Runs on Stop. For each confirmed component: extract full option set from DOM. For each element: build InteractionContract. Assemble ApplicationKnowledgeFragment. | Read-only DOM inspection; no simulation |
| **Derived Views** | Materialized snapshots: InteractionContract, BehavioralContract, ApplicationSurface, RecordedWorkflow. Always recomputable from foundations. | Cached, not authoritative |
| **Application Knowledge Fragment** | The aggregate output. Foundations + materialized views + summaries. The semantic understanding of the application. | Dual output alongside test steps |
| **Future Consumers** | Test generation, negative/boundary/accessibility/security testing, self-healing, AI assistance, workflow understanding, execution, reporting. Each traces to specific knowledge in the model. | Read-only consumers |

---

## 3. Phase-by-Phase Review

The UI Knowledge Model has been implemented across four phases, each building on the
last. This section documents what each phase accomplished, why it exists, and what
was learned.

> **Note on phase numbering:** The broader project has multiple phase series —
> Architecture C (Phases 0–7), Pipeline V2 (Phases 1–2), and the UI Knowledge Model
> (Phases 1–5+). This review covers the **UI Knowledge Model** phase series, which
> sits on top of the Architecture C pipeline (Phases 0–6 of which are complete).

### Phase 1 — Foundation: Three Foundational Entities

**Objective:** Define the three foundational entities (UiElement, ObservedTransition,
ComponentGrouping) with full invariant validation, enums, and factory functions.

**What was implemented:**
- `src/domain/entities/ui-element.ts` — UiElement + `deriveCapabilities()` + `assignToComponent()` + `removeFromComponent()`
- `src/domain/entities/observed-transition.ts` — ObservedTransition + ElementState + TransitionEvidence + CascadeEffect + ValidationResult + `hasObservableOutcome()`
- `src/domain/entities/component-grouping.ts` — ComponentGrouping + ConstituentRef + OptionEntry + lifecycle mutations
- `src/domain/entities/application-knowledge.ts` — Derived view types (InteractionContract, BehavioralContract, ApplicationKnowledgeFragment)
- `src/domain/enums.ts` — All canonical enums (IntrinsicCapability, ComponentRole, PatternType, RecognitionSource, ComponentLifecycleState, RelevanceLevel, TransitionOperation, TransitionEvidenceType, CascadeEffectType)

**Why it exists:** The three foundational entities are the **source of truth** for
the entire knowledge model. Everything else — recognition, enrichment, derived views,
consumer capabilities — is derived from or operates on these three. Getting them
right was the prerequisite for everything that followed.

**Architectural discussions that led to it:** The `ui-knowledge-model.md` blueprint
(§6) established the "three foundations, four views" principle: minimal persistence
(foundations) with maximal derivation (views). This was a deliberate departure from
the recorder's previous flat event log. The discussions established that the model
must be **application-centric** — entities describe the application, not how AI
interprets it.

**Assumptions validated:**
- Immutable entities with factory functions and invariant validation work well for a
  domain model that is written during recording and read during enrichment/consumption.
- Intrinsic capabilities can be derived purely from tag + role + inputType
  (`deriveCapabilities()` is a pure function with no side effects).
- Component membership is optional and reversible — `assignToComponent()` /
  `removeFromComponent()` support the tentative → rejected lifecycle where
  constituents revert to standalone.

**Architectural changes during implementation:** None significant. The entities
matched the blueprint. The `ComponentRole.UNKNOWN` value was added later (Phase 4)
for behavioral enrichment, but this was additive, not a redesign.

**Lessons learned:** Separating the foundational entities (persisted) from the
derived views (materialized) upfront prevented the temptation to persist computed
data. The invariant validation in factory functions caught several bugs early that
would have been much harder to trace later.

### Phase 2 — Pattern Catalogue + Structural Recognizer

**Objective:** Build a declarative pattern catalogue and a **generic** structural
recognizer that uses it. Zero pattern-specific logic in the recognizer.

**What was implemented:**
- `src/recorder/recognition/pattern-catalogue.ts` — 669 lines. PatternDefinition type, BehavioralSignature type, EvidenceSignal enum (8 signals), `registerPattern()`, `getPattern()`, `getAllPatterns()`. Auto-registers 6 V1 patterns: DROPDOWN, CHECKBOX, RADIO_GROUP, MODAL, TABS, ACCORDION.
- `src/recorder/recognition/structural-recognizer.ts` — 267 lines. `recognize(input)` — iterates the catalogue, finds root elements via ARIA roles, assigns constituent roles. Confidence always 0.95.

**Why it exists:** Structural recognition is Tier 1 — the fastest, most authoritative
recognition path. It uses ARIA composite widget roles, which are the page author's
explicit declaration of semantic structure. This is the basis for **evidence
sovereignty**: structural facts override AI reasoning (AP4).

**Architectural discussions that led to it:** The blueprint (§4) established the
progressive three-tiered recognition system. The key design decision was that the
recognizer must be **generic** — all pattern knowledge lives in the catalogue as
declarative data, not in the recognizer code. This is the additive extensibility
principle (AP7): adding a new pattern means adding a catalogue entry, not modifying
the recognizer.

**Assumptions validated:**
- A purely declarative pattern catalogue works. The structural recognizer iterates
  patterns, checks `rootAriaRoles` against the ancestor chain, and assigns roles via
  a reverse lookup — no `if (patternType === DROPDOWN)` anywhere.
- Specificity ordering (fewer `rootAriaRoles` = more specific = checked first)
  correctly resolves overlapping patterns.
- Confidence of 0.95 for Tier 1 is appropriate — structural recognition is highly
  reliable when ARIA is present.

**Architectural changes during implementation:** None. The generic recognizer
pattern worked as designed.

**Lessons learned:** The catalogue-as-data approach paid off immediately. When the
team needed to add expectedLifecycle (Phase 4) or behavioral signatures (Phase 3),
they were just new fields on PatternDefinition — no recognizer changes.

### Phase 3 — Behavioral Recognition

**Objective:** Tier 2 recognition via behavioral signatures. Recognize UI patterns
from observed interaction evidence when ARIA is absent.

**What was implemented:**
- `src/recorder/recognition/behavioral-recognizer.ts` — 538 lines. `recognizeBehaviorally(input)`.
- Extended `pattern-catalogue.ts` with `BehavioralSignature` and `EvidenceSignal` (8 signals).
- 8 signals: `childElementBecameVisible`, `childContainsClickableElements`, `triggerValueChanged`, `triggerStateChanged`, `popupClosed`, `siblingValueChanged`, `elementBecameModal`, `groupMutualExclusivity`.

**Why it exists:** Structural recognition covers ~40-50% of modern UIs (well-built
component libraries with ARIA). Behavioral recognition extends coverage to ~80-90%
by recognizing patterns from *what they do* rather than *what ARIA roles they
declare*. A non-ARIA dropdown still behaves like a dropdown: click → child appears →
child contains clickable elements → click child → trigger text changes.

**Architectural discussions that led to it:** The blueprint (§4) defined behavioral
signatures as "a combination of evidence signals." The key decision was that
behavioral recognition, like structural, must be **generic** — the recognizer
evaluates declarative signature conditions against detected signals, with zero
pattern-specific code.

**Assumptions validated:**
- Behavioral signatures correctly distinguish patterns. The ranking principle (the
  pattern that explains MORE evidence is the better match) prevents degenerate
  single-condition patterns from winning over multi-condition patterns that subsume
  the same evidence.
- Confidence based on match ratio (full match vs. partial match) produces reasonable
  lifecycle trajectories — tentative on partial match, confidence increasing with
  more evidence.
- Signal detection from `ObservedTransition` evidence (TransitionEvidenceType,
  CascadeEffectType, ElementState changes) works reliably for standard web patterns.

**Architectural changes during implementation:** The ranking principle was refined
during implementation. Initially, the recognizer used confidence as the primary sort
key. This caused a problem: a checkbox signature with one state-change condition
(100% match, high confidence) would win over a dropdown signature matching 3 of 4
conditions (75% match, lower confidence). The fix: rank by **matchedCount descending,
then confidence descending**. A pattern that explains more evidence is a stronger
explanation, even if it's a partial match.

**Lessons learned:** The behavioral recognizer is necessarily approximate — it
doesn't have ARIA's explicit declarations, so it infers constituent roles from which
signals an element participated in. This is acceptable for Tier 2 (tentative until
confirmed), but it means behavioral recognition should never override structural.

### Phase 4 — Component Registry & Recognition Orchestrator

**Objective:** Validate that recognition orchestration — identity resolution,
evidence accumulation, lifecycle progression, and tentative rejection — fits
naturally on top of the three foundational entities without requiring entity changes.

**What was implemented:**
- `src/recorder/recognition/component-registry.ts` — 617 lines. `ComponentRegistry` class with identity resolution, evidence accumulation, lifecycle progression, rejection.
- `src/recorder/recognition/orchestrator.ts` — 424 lines. `processInteraction(input, registry)` — the per-interaction flow.
- Extended `pattern-catalogue.ts` with `expectedLifecycle` on MODAL and TABS.

**Why it exists:** Recognizers produce individual recognition results. The registry
and orchestrator turn those into a coherent session-scoped model: which elements
belong to which components, when components are confirmed or rejected, and how
evidence accumulates over time. Without this layer, recognition results are isolated
snapshots — you'd have no way to say "these three interactions were all on the same
dropdown."

**Architectural discussions that led to it:** The blueprint (§4) defined the
progressive lifecycle (tentative → developing → confirmed | rejected) and the
constituent association rules. Three key design decisions were made in the Phase 4
spec:

1. **Recognition vs. enrichment are separated.** Structural recognition establishes
   identity (authoritative). Behavioral processing enriches the component with
   observed behavior. Both run for every interaction.
2. **Evidence accumulation is generic.** The registry tracks supporting/contradicting
   evidence entries — not matchCount/mismatchCount. The rejection algorithm is one
   consumer; future sources (AI, vision) can contribute through the same mechanism.
3. **Tentative rejection via accumulated contradiction.** When net contradiction
   (contradicting − supporting) ≥ 3, the component is rejected. The algorithm is
   swappable without changing the registry.

**Assumptions validated:**
- The three foundational entities are sufficient. The orchestrator and registry
  operate entirely through the entity interfaces — no entity changes were needed.
- Identity resolution via exact root match → root-in-constituents → Jaccard ≥ 0.34
  correctly merges multi-tier observations of the same physical component.
- Lifecycle progression driven by `expectedLifecycle` from pattern definitions works
  generically. A dropdown is confirmed when both CLICK and SELECT are observed; a
  checkbox is confirmed on TOGGLE alone. The orchestrator reads this from the
  catalogue — no hardcoded operation lists.
- The generic evidence ledger supports the rejection algorithm without coupling to
  it. `shouldReject()` is a pure function consuming `readonly EvidenceEntry[]`.

**Architectural changes during implementation:**
1. **Added `ComponentRole.UNKNOWN`** to the enum — for constituents discovered
   through behavioral enrichment where the specific role isn't known at discovery
   time. Additive, backward-compatible.
2. **Added `ComponentRegistry.addConstituent()`** — a public method for the
   orchestrator to add constituents to existing components during behavioral
   enrichment (when an interaction's element is DOM-related to an existing component
   but wasn't part of the original structural recognition).
3. **Added constituent-enrichment step to the orchestrator** — when neither
   recognizer fires but the element is DOM-related to an existing active component,
   the orchestrator adds it as a constituent and records the transition. This
   implements the "behavioral enrichment runs for structurally-recognized components"
   principle from the blueprint.

**Lessons learned:**
- The `register()` method seeds one supporting evidence entry (initial recognition
  IS supporting evidence). This is semantically correct, but the rejection tests
  initially assumed zero supporting entries. The fix was in the tests, not the code —
  a good reminder that evidence accounting matters even in test setup.
- The generic orchestrator pattern held: zero `PatternType.*` references in the
  orchestrator code. All pattern knowledge comes from the catalogue.

### Phase 5 — Post-Recording Enrichment & Derived Views (Planned)

**Objective:** Materialize the four derived views (InteractionContract,
BehavioralContract, ApplicationSurface, RecordedWorkflow) from the foundational
entities and assemble the ApplicationKnowledgeFragment.

**What is planned:**
- An enrichment pass that runs on Stop, after components are confirmed.
- For each confirmed component: extract the full option set from constituent
  elements' DOM (read-only inspection, no simulation).
- For each UiElement: build InteractionContract from `domAttributes` (interpret
  `required`, `min`, `max`, `step`, `pattern`, `type` → constraints).
- For each confirmed ComponentGrouping: build BehavioralContract from observed
  transitions (synthesize → stateMachine, validationBehavior, cascadeEffects).
- Assemble ApplicationKnowledgeFragment (foundations + materialized views + summaries).

**Why it will exist:** This is the phase that bridges **observed** (what the user
interacted with) to **inferred** (what the application is). Most knowledge in the
model is inferred from DOM structure, not observed from user interaction. The
enrichment pass is the mechanism that performs this inference.

**Status:** Types are defined in `src/domain/entities/application-knowledge.ts`. No
enrichment code exists yet. This is the next implementation phase.

---

## 4. Domain Model Review

The UI Knowledge Model rests on **three foundational entities**. They are the source
of truth — everything else is derived from or operates on them.

### UiElement — The Atom

**File:** `src/domain/entities/ui-element.ts`

**Responsibilities:**
- Represent every interactive element encountered during recording.
- Carry mechanical identity (the existing 18-field `ElementIdentity`).
- Store semantically relevant DOM attributes (required, min, max, step, pattern,
  type, placeholder, aria-*, etc.).
- Record where the element was encountered (`sourceUrl`) and its DOM position
  (`domTreePath`).
- Expose intrinsic capabilities derived from tag + role + inputType.
- Track optional component membership (`componentId`, `componentRole`).

**Invariants (enforced by `createUiElement()`):**
- `elementId` is required and non-empty.
- `identity` is required (the 18-field ElementIdentity).
- `sourceUrl` is required and non-empty.
- `componentId` and `componentRole` must **both** be set or **both** be null —
  an element cannot have a component ID without a role, or vice versa.

**Relationships:**
- **0..1 → ComponentGrouping:** An element may belong to one component (via
  `componentId`). If the component is rejected, the element reverts to standalone
  via `removeFromComponent()`.
- **1..* → ObservedTransition:** An element may have many observed transitions
  (transitions reference elements by `elementId`).
- **Source of:** InteractionContract (derived from `domAttributes`), ApplicationSurface
  (derived from `sourceUrl` groupings), SemanticRelationship (derived from `domTreePath`).

**Why it is persisted:** An element's identity, DOM attributes, and source URL are
captured during recording and are expensive (or impossible) to recompute later — the
page may have changed. They are the structural foundation that all derived views
trace back to.

**Why it belongs in the core domain:** UiElement is the irreducible unit of the
application's UI. Every interaction targets an element. Every component is composed
of elements. Every contract constrains an element. It cannot be delegated to a
derived view or a service layer.

**How it supports future capabilities:**
- **Self-healing:** `identity.locatorStrategies` provides ranked locator chains.
- **Accessibility testing:** `identity.ariaRole`, `domAttributes` provide the ARIA profile.
- **Negative/boundary testing:** `domAttributes` (required, min, max, pattern) feed
  InteractionContract derivation.
- **Workflow understanding:** `sourceUrl` groupings define ApplicationSurface.

### ObservedTransition — The Behavioral Raw Data

**File:** `src/domain/entities/observed-transition.ts`

**Responsibilities:**
- Record a single observed state transition caused by a user interaction.
- Capture what operation was performed (`TransitionOperation`: click, type, toggle,
  select, hover, navigate, scroll).
- Record the element's state before and after (`ElementState`: value, checked,
  expanded, selected).
- Carry the evidence that confirms the transition (`TransitionEvidence[]`: valueChange,
  stateChange, classChange, mutation, navigation).
- Track side effects on other elements (`CascadeEffect[]`: what else changed).
- Record validation behavior if observed (`ValidationResult`: triggered, responseType,
  message, clearedOn).
- Classify relevance (`RelevanceLevel`: deliberate, supporting, noise).

**Invariants (enforced by `createObservedTransition()`):**
- `transitionId`, `elementId`, `operation`, `timestamp` are required.
- `relevance` is required (defaults to deliberate if not specified).
- `stateBefore` and `stateAfter` are required (may be empty states, but must be
  present).

**Relationships:**
- *** → UiElement:** A transition references exactly one element by `elementId`.
- **0..1 → ComponentGrouping:** A transition may belong to a component (via
  `componentId`), set by the orchestrator when the element is recognized as a
  constituent.
- **Source of:** BehavioralContract (derived from ordered transitions + component +
  pattern definition), RecordedWorkflow (derived from ordered transitions + components).

**Why it is persisted:** Transitions are the empirical record — what actually
happened. They cannot be recomputed (the user's actions are not reproducible). They
are the raw material from which BehavioralContracts and RecordedWorkflows are
synthesized.

**Why it belongs in the core domain:** Without observed transitions, there is no
behavioral knowledge. The application's static structure (UiElements) tells you what
*could* happen; transitions tell you what *did* happen. Both are needed for a
complete model.

**How it supports future capabilities:**
- **Behavioral testing:** BehavioralContract (state machine, validation behavior) is
  synthesized from transitions.
- **Workflow understanding:** RecordedWorkflow (ordered semantic actions, branch
  points) is derived from ordered transitions.
- **Negative testing:** Validation behavior (when does validation trigger? what
  clears it?) comes from transition evidence.
- **Component lifecycle:** The orchestrator tracks `observedTransitionIds` on
  ComponentGrouping to drive lifecycle progression.

### ComponentGrouping — The Semantic Decision

**File:** `src/domain/entities/component-grouping.ts`

**Responsibilities:**
- Assert that a group of elements form a recognized UI pattern (dropdown, checkbox,
  radio group, modal, tabs, accordion, etc.).
- Track the pattern type and recognition metadata (source, confidence).
- Manage lifecycle state: tentative → developing → confirmed | rejected.
- Reference constituent elements with their roles (trigger, option, container, etc.).
- Carry the semantic business field name (AI-assigned, null until enrichment).
- Hold the full option set for selectable components (null until enrichment extracts
  it from the DOM).
- Track which transitions were observed on this component's constituents.

**Invariants (enforced by `createComponentGrouping()`):**
- `groupingId`, `patternType`, `rootElementId`, `constituents`, `recognitionSource`
  are required.
- `recognitionConfidence` is in [0.05, 0.95].
- New groupings start in `TENTATIVE` state.
- Constituent element IDs and roles are required and non-empty.

**Relationships:**
- **1..* → UiElement:** A component references its constituent elements (by
  `elementId` in `ConstituentRef[]`). Elements retain independent existence — the
  component references them, it does not absorb them.
- **1..* → ObservedTransition:** A component tracks `observedTransitionIds` for
  lifecycle progression.
- **Source of:** BehavioralContract (pattern + transitions → state machine),
  RecordedWorkflow (confirmed components → semantic action grouping).

**Why it is persisted:** Recognition is expensive to recompute — especially Tier 2
(behavioral) and future Tier 3 (AI). The grouping assertion (which elements belong
together, what pattern they form, how confident we are) is the result of accumulating
evidence across multiple interactions. Persisting it avoids recomputation and
provides an audit trail for how a component was recognized.

**Why it belongs in the core domain:** A flat list of elements and transitions
cannot answer "is this a dropdown?" or "what are the options?" The grouping assertion
is the semantic decision that elevates raw data to understanding. It is the entity
that future capabilities (test generation, workflow analysis) will query.

**How it supports future capabilities:**
- **Test generation:** Confirmed components enable semantic action grouping
  ("Selected Premium Economy" instead of "Clicked div.xyz").
- **Alternate flow generation:** `optionSet` (full set extracted at enrichment)
  reveals options the user didn't pick — the basis for generating alternate flows.
- **Workflow understanding:** Confirmed components are the unit of business-level
  actions in RecordedWorkflow.

### The Architectural Rule (restated)

> An Element owns its identity and intrinsic capabilities.
> A Component owns its pattern, aggregate state, and business meaning.
> A Component references Elements — it does not absorb them.
> Elements retain independent existence and can be interacted with directly
> regardless of component membership.

This rule is enforced structurally: `ComponentGrouping.constituents` is an array of
`ConstituentRef` (elementId + role), not an array of `UiElement`. The component
references elements; it never owns them. When a component is rejected, its
constituents simply revert to standalone (`componentId = null`).

---

## 5. Recognition Architecture

Component recognition is the process of determining that a group of elements form a
known UI pattern. It is fundamentally different from classification:

- **Classification** is per-element, stateless, one snapshot → one type. "This click
  is a SELECT operation."
- **Recognition** is cross-element, cross-time, accumulates confidence across
  interactions. "These three elements form a dropdown, and I'm now confident enough
  to confirm it."

### The Pattern Catalogue

**File:** `src/recorder/recognition/pattern-catalogue.ts` (669 lines)

The catalogue is the **declarative knowledge base**. Each `PatternDefinition`
contains:

```
PatternDefinition
├── patternType: PatternType           (e.g., DROPDOWN, CHECKBOX)
├── rootAriaRoles: string[]            (ARIA roles that identify the root)
├── constituentRoles: RoleMapping[]     (ARIA role → ComponentRole mapping)
├── minConstituents: number            (minimum elements for a valid match)
├── specificity: number                (lower = more specific, checked first)
├── behavioralSignature?: BehavioralSignature   (Tier 2 conditions)
│   ├── conditions: SignatureCondition[]
│   │   ├── signal: EvidenceSignal
│   │   ├── minOccurrences?: number
│   │   └── expectedOperation?: TransitionOperation
│   ├── fullMatchConfidence: number
│   ├── partialMatchConfidence: number
│   └── minConditionsMet?: number
├── expectedLifecycle: TransitionOperation[]   (ops needed for CONFIRMED)
└── description: string
```

**Six V1 patterns** are auto-registered: DROPDOWN, CHECKBOX, RADIO_GROUP, MODAL,
TABS, ACCORDION. Each defines structural roles (for Tier 1), behavioral signatures
(for Tier 2), and expected lifecycle operations (for confirmation).

**Key property:** Adding a new pattern means adding a catalogue entry — no
recognizer or orchestrator changes. This is additive extensibility (AP7) in practice.

### Structural Recognition (Tier 1)

**File:** `src/recorder/recognition/structural-recognizer.ts` (267 lines)

```
Input: { element, ancestorRoles, siblingElementRoles }
  │
  ▼
recognize(input):
  1. Build role chain from ancestorRoles + element
  2. For each pattern (ordered by specificity ascending):
     a. Find root element (first ancestor whose ARIA role matches rootAriaRoles)
     b. Assign constituent roles via reverse lookup
     c. Check minConstituents
     d. If valid → return result (confidence 0.95, source STRUCTURAL)
  3. Return null result
```

**Properties:**
- **Deterministic:** same input → same output, every time.
- **Fast:** <1ms (iterates ~6 patterns against an ancestor chain).
- **Authoritative:** confidence 0.95, recognitionSource STRUCTURAL. Per evidence
  sovereignty (AP4), structural recognition overrides behavioral and AI.
- **Generic:** the recognizer contains zero `if (patternType === ...)` logic. All
  pattern knowledge comes from the catalogue.

**Coverage:** ~40-50% of modern UIs (well-built component libraries with ARIA).

### Behavioral Recognition (Tier 2)

**File:** `src/recorder/recognition/behavioral-recognizer.ts` (538 lines)

```
Input: { rootElementId, relatedElementIds, transitions }
  │
  ▼
recognizeBehaviorally(input):
  1. Filter transitions to those on related elements
  2. Detect signals from transition evidence:
     • CHILD_ELEMENT_BECAME_VISIBLE (mutation: "visible"/"appeared"/"shown")
     • ELEMENT_BECAME_MODAL (mutation: "overlay"/"modal"/"backdrop"/"dialog")
     • TRIGGER_VALUE_CHANGED (valueChange on root)
     • TRIGGER_STATE_CHANGED (stateChange on root)
     • POPUP_CLOSED (mutation: "hidden"/"closed"/"removed")
     • SIBLING_VALUE_CHANGED (cascade: VALUE on non-root)
     • CHILD_CONTAINS_CLICKABLE_ELEMENTS (clicks after appearance)
     • GROUP_MUTUAL_EXCLUSIVITY (deselection + selection across elements)
  3. For each pattern with a behavioral signature:
     a. Evaluate each condition against detected signals
     b. Count matched conditions
     c. Assign confidence (full match vs partial match)
  4. Rank: matchedCount DESC, confidence DESC
  5. Return best match (or null)
```

**Properties:**
- **Deterministic:** signal detection and signature evaluation are pure functions
  of the transition evidence.
- **Fast:** ~5ms (signal detection + signature evaluation).
- **Advisory:** confidence < 0.95 (full match typically 0.75-0.85). Recognition source
  is BEHAVIORAL, which is lower priority than STRUCTURAL.
- **Generic:** the recognizer evaluates declarative signature conditions. Adding a
  pattern's behavioral recognition = adding a signature entry.

**Ranking principle:** The pattern that explains MORE evidence is the better match.
A pattern matching 3 conditions (even partially) is stronger than a pattern matching
1 condition (even fully), because the richer pattern accounts for more observed
signals. This prevents degenerate single-condition patterns from winning.

**Coverage:** ~35-45% additional coverage (non-ARIA but functionally standard
patterns).

### Recognition Orchestrator

**File:** `src/recorder/recognition/orchestrator.ts` (424 lines)

The orchestrator is the **per-interaction entry point**. For each classified
interaction, it runs the full recognition flow:

```
processInteraction(input, registry):
  │
  ├─ 1. STRUCTURAL RECOGNITION
  │     recognize({ element, ancestorRoles, siblingElementRoles })
  │     → structuralResult (patternType or null)
  │
  ├─ 2. BEHAVIORAL RECOGNITION
  │     recognizeBehaviorally({ rootElementId, relatedElementIds, transitions })
  │     → behavioralResult (patternType or null)
  │
  ├─ 3. IDENTITY RESOLUTION + MERGE
  │     If structural or behavioral matched:
  │       resolveIdentity(primaryResult, registry.getActive())
  │       ├─ Existing component found → merge (structural authority)
  │       └─ No existing → create new ComponentGrouping
  │     Else (neither matched):
  │       findOwningComponent(elementId, relatedElementIds, activeComponents)
  │       ├─ Owning component found → enrich (add constituent + transition)
  │       └─ No owner → standalone interaction (return null)
  │
  ├─ 4. ENRICHMENT
  │     Add current transition to component
  │
  ├─ 5. LIFECYCLE PROGRESSION
  │     isLifecycleComplete(component, observedOperations)?
  │     Read expectedLifecycle from pattern definition.
  │     If all expected operations observed → promote to CONFIRMED.
  │
  └─ 6. REJECTION CHECK
        checkRejection(component.groupingId)
        netContradiction = contradicting − supporting
        If ≥ 3 → reject component
```

**Properties:**
- **Zero pattern-specific logic:** the orchestrator reads all pattern knowledge from
  the catalogue (`getPattern()`, `pattern.expectedLifecycle`). Verified: zero
  `PatternType.*` references in the code.
- **Linear:** one pass through the flow, no recursion, no feedback into recognizers.
- **Structural authority:** when structural and behavioral disagree, structural wins
  (evidence sovereignty).

### Component Registry

**File:** `src/recorder/recognition/component-registry.ts` (617 lines)

The registry is the **session-scoped store** for ComponentGrouping entities. It is
the ONLY writer of component lifecycle state during a recording session.

```
ComponentRegistry
├── components: Map<groupingId, ComponentGrouping>
├── elementIndex: Map<elementId, groupingId>      (fast lookup)
├── evidenceLedger: Map<groupingId, EvidenceEntry[]>
│
├── register(result) → ComponentGrouping
│     Identity resolution → create new or merge existing
│     Seeds 1 supporting evidence entry (recognition IS supporting)
├── addEvidence(groupingId, evidence) → void
├── addConstituent(groupingId, elementId, role) → ComponentGrouping
├── addTransition(groupingId, transitionId) → ComponentGrouping
├── promote(groupingId) → ComponentGrouping       (→ CONFIRMED)
├── checkRejection(groupingId) → boolean          (net contradiction ≥ 3?)
├── forceReject(groupingId) → void                (manual rejection)
├── getComponent(id) / getByElement(elementId) / getAll() / getActive()
├── hasComponent(elementId) → boolean             (false for rejected)
└── clear() / size
```

**Key design principle:** the registry is **generic**. It knows about
ComponentGrouping entities and EvidenceEntry records, but NOT about specific pattern
types. All pattern knowledge comes from the PatternDefinition via the orchestrator.

### Identity Resolution

When a new recognition result arrives, the registry must determine whether it refers
to an existing component or a new one. Four rules, in priority order:

```
1. EXACT ROOT MATCH:     result.rootElementId === component.rootElementId
                          → same component

2. ROOT-IN-CONSTITUENTS: result root is in component's constituents
                          (or component root is in result's constituents)
                          → same component

3. CONSTITUENT OVERLAP:  Jaccard similarity of element ID sets ≥ 0.34
                          → same component

4. NO OVERLAP:            → different component (create new)
```

The Jaccard threshold (0.34) was chosen to require meaningful overlap without being
so high that legitimately related observations fail to merge. A rejected component
is never matched against — its constituents revert to standalone.

### Lifecycle Progression

```
TENTATIVE ──(first transition)──▶ DEVELOPING ──(lifecycle complete)──▶ CONFIRMED
      │                                                                              ▲
      └──(net contradiction ≥ 3)──▶ REJECTED                                         │
                                                                                     │
                          (structural recognition is always at least DEVELOPING)──────┘
```

- **TENTATIVE:** Component hypothesis created on first evidence. Tracked in registry
  but not confirmed.
- **DEVELOPING:** Subsequent evidence consistent with hypothesis (first transition
  observed). Confidence increasing.
- **CONFIRMED:** All expected lifecycle operations observed. For a dropdown:
  `expectedLifecycle = [CLICK, SELECT]` — both must be observed. The orchestrator
  reads this from the pattern definition; the registry promotes.
- **REJECTED:** Evidence contradicts hypothesis. Net contradiction (contradicting −
  supporting) ≥ threshold (3). Constituents revert to standalone.

### Evidence Accumulation

The registry maintains a generic evidence ledger per component:

```
EvidenceEntry
├── source: RecognitionSource     (structural, behavioral, ai-assisted)
├── disposition: 'supporting' | 'contradicting' | 'neutral'
├── description: string           (human-readable, for audit trails)
└── timestamp: number
```

Evidence is **source-agnostic**. The current rejection algorithm is one consumer
of this evidence. Future recognition sources (AI, vision, heuristics) can contribute
evidence through the same mechanism. The rejection algorithm (`shouldReject()`) is a
pure function consuming `readonly EvidenceEntry[]` — swappable without changing the
registry.

---

## 6. Recognition vs Enrichment

One of the most important architectural decisions in Phase 4 was the explicit
**separation of recognition from behavioral enrichment**.

### What Recognition Does

**Recognition establishes identity.** It answers: "Is this element (or this group of
elements) a known UI pattern?" Recognition is **authoritative for classification** —
it determines the `patternType`, `rootElementId`, and constituent roles.

- Structural recognition: "This element's ancestor chain includes `role="combobox"`,
  so this is a DROPDOWN. The combobox is the trigger, the listbox is the container,
  the options are options."
- Behavioral recognition: "These transitions show click → child appeared → child has
  clickable elements → click child → trigger text changed. This matches the dropdown
  behavioral signature."

Recognition runs on the **primary result** — the structural result if it fired,
otherwise the behavioral result.

### What Behavioral Enrichment Does

**Enrichment accumulates behavioral knowledge.** It answers: "Given that we know
this is a dropdown, what did the user do with it? What state changes occurred? What
cascaded?" Enrichment **does not reclassify** — it adds transitions, constituents,
and evidence to an already-recognized component.

Enrichment runs for **every interaction**, regardless of whether structural
recognition succeeded. This is critical: behavioral enrichment is NOT skipped when
structural recognition succeeds. A structurally-recognized dropdown still needs its
transitions tracked, its lifecycle progressed, and its evidence accumulated.

### The Phase 4 Enrichment Step

During Phase 4 implementation, a third enrichment path emerged: **constituent
enrichment**. When neither structural nor behavioral recognition fires for an
interaction, but the interacted element is **DOM-related** to an existing active
component (found via `findOwningComponent()`), the orchestrator adds the element as
a constituent and records the transition.

Example: a "Done" button inside a dropdown. The button has no ARIA role that
triggers structural recognition. Behavioral recognition doesn't fire (no transitions
on it yet). But the button is in the `relatedElementIds` of the dropdown's root.
The orchestrator finds the owning component via element overlap and enriches it:

```
findOwningComponent('done-btn', ['cb-1', 'lb-1', 'opt-1', 'opt-2', 'done-btn'], activeComponents)
  → finds the dropdown component (cb-1 is its root)
  → addConstituent(dropdown.groupingId, 'done-btn', ComponentRole.UNKNOWN)
  → addTransition(dropdown.groupingId, transitionId)
```

### Why This Separation Matters

This separation has three architectural consequences:

1. **Structural classification is never overridden by behavioral.** If structural
   recognition says "this is a dropdown," behavioral processing enriches that
   dropdown — it never reclassifies it as something else. This is evidence
   sovereignty (AP4) at the orchestration level.

2. **Enrichment runs unconditionally for recognized components.** A structurally-
   recognized component still benefits from behavioral enrichment (transition
   tracking, lifecycle progression, evidence accumulation). This prevents the
   failure mode where structural recognition "wins" and behavioral insights are lost.

3. **The orchestrator stays generic.** Because recognition (establishing identity)
   and enrichment (accumulating behavior) are separate concerns, the orchestrator
   doesn't need pattern-specific logic for either. It delegates recognition to the
   recognizers and enrichment to the registry, reading pattern knowledge from the
   catalogue only for lifecycle expectations.

### How It Changed the Architecture

Before this separation was explicit, the natural temptation was a single
"recognize-and-classify" step: run both recognizers, pick a winner, done. This
conflates two concerns and leads to:

- Behavioral results that don't enrich structurally-recognized components (lost
  transitions, lost constituents).
- Structural results that suppress behavioral insights (a dropdown recognized
  structurally never gets its option-click transitions tracked).

The separation makes both paths first-class: recognition establishes identity
(authoritative), enrichment accumulates behavior (always runs). The orchestrator
became slightly more complex (two branches instead of one), but the data model
became richer and more correct.

---

## 7. Evidence Model

Evidence is the epistemological foundation of the recognition system. Every
assertion ("this is a dropdown," "this element is a constituent," "this component
should be rejected") is backed by evidence, and every piece of evidence has a
disposition (supporting, contradicting, or neutral).

### Evidence Entry

```
EvidenceEntry
├── source: RecognitionSource
│     ├── STRUCTURAL   (ARIA-based, authoritative)
│     ├── BEHAVIORAL   (evidence-based, advisory)
│     └── AI_ASSISTED  (LLM-based, advisory, future)
├── disposition: EvidenceDisposition
│     ├── 'supporting'     (this evidence supports the hypothesis)
│     ├── 'contradicting'  (this evidence contradicts the hypothesis)
│     └── 'neutral'        (this evidence is informational)
├── description: string     (human-readable, for audit trails)
└── timestamp: number       (when this evidence was recorded)
```

### Supporting Evidence

Supporting evidence increases confidence in a component hypothesis. Sources:

- **Registration:** When a component is first registered (or merged with an existing
  one), the registry seeds a supporting evidence entry. Initial recognition IS
  supporting evidence — the recognizer matched the pattern.
- **Lifecycle progression:** When a component is promoted to CONFIRMED, a supporting
  entry records "Lifecycle complete — component confirmed."
- **Behavioral enrichment:** When an interaction enriches an existing component
  (constituent added, transition recorded), a supporting entry records the enrichment.

Supporting evidence serves two purposes:
1. It protects against rejection. The rejection algorithm computes
   `netContradiction = contradicting − supporting`. Supporting evidence offsets
   contradicting evidence.
2. It provides an audit trail. The evidence ledger shows exactly which observations
   supported the component's existence and confirmation.

### Contradicting Evidence

Contradicting evidence decreases confidence in a component hypothesis. Sources:

- **Rejection:** When a component is rejected due to accumulated contradiction, a
  contradicting entry records "Component rejected due to accumulated contradiction."
- **Future:** AI-assisted recognition (Tier 3, future) may contribute contradicting
  evidence when its analysis disagrees with the hypothesis.

Contradicting evidence is the driver of **tentative rejection via accumulated
contradiction**. A single contradiction is not enough to reject (the pattern may be
correct with unusual behavior). Only when net contradiction reaches the threshold (3)
is the component rejected.

### Confidence

Confidence is a per-component value in [0.05, 0.95], set at recognition time:

| Recognition Source | Confidence | Meaning |
|-------------------|------------|---------|
| STRUCTURAL (Tier 1) | 0.95 | Authoritative. ARIA is the page author's declaration. |
| BEHAVIORAL full match (Tier 2) | 0.75–0.85 (pattern-defined) | Strong behavioral evidence. All signature conditions met. |
| BEHAVIORAL partial match (Tier 2) | 0.45–0.65 (pattern-defined) | Moderate behavioral evidence. Enough conditions met for a tentative hypothesis. |
| AI_ASSISTED (Tier 3, future) | ≥0.70 required | Advisory only. Never overrides structural or behavioral. |

Confidence is **monotonic within a source tier** — it never decreases as more
evidence accumulates (within the same tier). Cross-tier, structural (0.95) always
wins over behavioral over AI, regardless of the lower tier's confidence value.

### Lifecycle Progression

Lifecycle is driven by evidence accumulation, specifically by observing the pattern's
`expectedLifecycle` operations:

```
Component created (TENTATIVE, confidence set by recognizer)
  │
  ├─ First transition observed → DEVELOPING
  │
  ├─ More transitions observed → evidence accumulates
  │   (supporting entries added for each consistent interaction)
  │
  ├─ All expectedLifecycle operations observed?
  │   ├─ YES → CONFIRMED (supporting evidence: "Lifecycle complete")
  │   └─ NO  → stay DEVELOPING
  │
  └─ netContradiction ≥ 3?
      └─ YES → REJECTED (contradicting evidence: "accumulated contradiction")
```

The orchestrator checks lifecycle progression generically:

```typescript
function isLifecycleComplete(component, observedOperations) {
  const pattern = getPattern(component.patternType);
  if (!pattern?.expectedLifecycle?.length) {
    return component.observedTransitionIds.length > 0;
  }
  for (const op of pattern.expectedLifecycle) {
    if (!observedOperations.has(op)) return false;
  }
  return true;
}
```

No hardcoded operation lists — the pattern definition declares what "complete" means.

### Rejection

Rejection is driven by the **net contradiction** in the evidence ledger:

```typescript
function shouldReject(evidence) {
  let supporting = 0, contradicting = 0;
  for (const entry of evidence) {
    if (entry.disposition === 'supporting') supporting++;
    else if (entry.disposition === 'contradicting') contradicting++;
  }
  return contradicting - supporting >= CONTRADICTION_THRESHOLD; // 3
}
```

**Why threshold 3?** A single contradiction might be noise (unusual but valid
behavior). Two contradictions might be a pattern variant. Three net contradictions
(three more contradicting than supporting entries) is strong evidence that the
hypothesis is wrong.

**Why net, not raw contradicting count?** Supporting evidence should protect a
correct hypothesis. If a dropdown has 5 supporting entries (5 consistent
interactions) and 3 contradicting entries (3 unusual interactions), net contradiction
is −2 — the hypothesis is well-supported despite the contradictions.

### Evidence Flow Through the System

```
Interaction arrives at orchestrator
  │
  ├─ Structural recognition fires?
  │   └─ YES → register() seeds SUPPORTING evidence (source: STRUCTURAL)
  │
  ├─ Behavioral recognition fires?
  │   └─ YES → register() seeds SUPPORTING evidence (source: BEHAVIORAL)
  │
  ├─ Existing component matched (identity resolution)?
  │   └─ YES → SUPPORTING evidence ("matched existing component")
  │
  ├─ Behavioral constituents merged?
  │   └─ YES → SUPPORTING evidence ("behavioral enrichment added constituents")
  │
  ├─ Constituent enrichment (related element → existing component)?
  │   └─ YES → SUPPORTING evidence ("interaction enriched existing component")
  │
  ├─ Lifecycle complete?
  │   └─ YES → promote to CONFIRMED + SUPPORTING evidence ("lifecycle complete")
  │
  └─ Rejection check fires?
      └─ YES → reject + CONTRADICTING evidence ("accumulated contradiction")
```

All evidence flows through the registry's `addEvidence()` method. The ledger is the
single source of truth for the rejection algorithm and for future audit/analysis.

---

## 8. Application Knowledge Model

The UI Knowledge Model is not merely a better event recorder. It is an **application
knowledge model** — a semantic understanding of the application's UI, behavior, and
relationships.

### From Events to Knowledge

A traditional recorder produces a flat event log:

```
clicked div.xyz
typed "hello" into input#email
clicked button#submit
```

The UI Knowledge Model produces structured understanding:

```
Application: "Travel Booking"
├── Surfaces:
│   ├── /search (Flight Search page)
│   └── /results (Flight Results page)
├── Elements:
│   ├── input#email (text input, required, type=email, on /search)
│   ├── button#submit (submit button, on /search)
│   └── div.travel-class (dropdown trigger, on /search)
├── Components:
│   ├── Travel Class dropdown (CONFIRMED)
│   │   ├── Trigger: div.travel-class
│   │   ├── Options: [Economy, Premium Economy, Business, First]
│   │   ├── Selected: Premium Economy
│   │   └── Lifecycle: open → select → close (observed)
│   └── Email field (standalone, confirmed required + email validation)
├── Transitions:
│   ├── t1: clicked div.travel-class (opened dropdown)
│   ├── t2: clicked option "Premium Economy" (selected)
│   ├── t3: clicked "Done" (closed dropdown, trigger text changed)
│   ├── t4: typed "user@example.com" into input#email
│   └── t5: clicked button#submit (navigation to /results)
├── Contracts:
│   ├── Email field: { required: true, format: email, validation: inline-on-blur }
│   └── Travel Class: { options: [...], required: true }
└── Workflow:
    ├── Set Travel Class to Premium Economy (t1+t2+t3)
    ├── Enter email (t4)
    └── Submit form (t5 → navigation)
```

The critical insight: **most of this knowledge is inferred (from DOM structure), not
observed (from user interaction).** The user interacted with 5 elements. The model
knows about 4 travel class options even though the user only selected one. The model
knows the email field is required and validates on blur, even though the user didn't
trigger validation. The enrichment pass (Phase 5) is the mechanism that bridges
observed → inferred.

### How Future Capabilities Consume This Knowledge

Each future capability traces to specific knowledge in the model. This is not
speculative — the entities and derived views are designed to support these
capabilities.

#### Test Generation
**Requires:** Confirmed components, ordered transitions, semantic actions.
**Source:** ComponentGrouping (confirmed) + RecordedWorkflow.
**How:** Instead of "clicked div.xyz," generate "Selected Premium Economy in Travel
Class dropdown." The component model provides the semantic grouping; the workflow
view provides the ordering.

#### Negative Testing
**Requires:** Input constraints, validation behavior.
**Source:** InteractionContract (from UiElement.domAttributes) + BehavioralContract
(from ObservedTransitions).
**How:** If the email field is `required` with `type=email` and validation triggers
on blur, generate negative tests: empty submission, invalid email format, SQL
injection strings. The contract provides the constraints; the behavioral contract
provides the validation timing and response.

#### Boundary Testing
**Requires:** Value ranges, length limits, option sets.
**Source:** InteractionContract (min, max, step, minlength, maxlength, pattern) +
ComponentGrouping.optionSet.
**How:** If a quantity field has `min=1, max=10, step=1`, generate boundary tests:
0, 1, 2, 9, 10, 11. If a dropdown has 4 options, test each option plus the "no
selection" state. The full option set (extracted at enrichment) reveals options the
user didn't pick.

#### Accessibility Testing
**Requires:** ARIA profiles, heading hierarchy, landmarks.
**Source:** UiElement (ariaRole, domAttributes) + ApplicationSurface (page structure).
**How:** Verify every interactive element has an accessible name. Check heading
hierarchy is valid. Verify ARIA roles are used correctly (e.g., a dropdown trigger
has `aria-expanded`). The element model carries the ARIA data; the surface view
provides page-level structure.

#### Security Testing
**Requires:** Input types, validation behavior, form structure.
**Source:** InteractionContract + BehavioralContract.
**How:** Generate XSS attempts in text fields, SQL injection in search boxes, path
traversal in file inputs. The contract tells you what inputs are accepted; the
behavioral contract tells you how validation responds.

#### Self-Healing
**Requires:** Ranked locator strategies, semantic identity.
**Source:** UiElement (identity.locatorStrategies) + ComponentGrouping (semantic
context).
**How:** When a test breaks because `div.xyz:nth-child(3)` no longer matches, the
self-healing layer tries the next locator strategy, then falls back to semantic
identity ("the third option in the Travel Class dropdown"). The element model
carries ranked strategies; the component model provides semantic fallback.

#### AI Assistance
**Requires:** Full knowledge model.
**Source:** ApplicationKnowledgeFragment.
**How:** An AI assistant can reason about the application because it has a structured
model, not raw events. "This form has 3 required fields and validates on blur" is a
query against the model, not a re-derivation from event logs. The AI is a consumer
of the model — it does not define it.

#### Workflow Understanding
**Requires:** Ordered semantic actions, branch points, optional steps.
**Source:** RecordedWorkflow (from ordered transitions + confirmed components).
**How:** "The user searched for flights, filtered by price, selected Premium Economy,
and booked" — this is a workflow-level understanding derived from grouping
component-level actions into business-level steps. Branch points (where the user
could have taken a different path) are identified from option sets and alternate
flows.

#### Execution
**Requires:** Execution IR (derived from test cases).
**Source:** The broader domain model (ApprovedTestCase → Execution IR).
**How:** The UI Knowledge Model feeds test generation, which produces test cases,
which are compiled to Execution IR, which adapters (Playwright, etc.) execute. The
knowledge model is the upstream source; execution is a downstream consumer.

#### Reporting
**Requires:** Full knowledge model + execution results.
**Source:** ApplicationKnowledgeFragment + TestRun results.
**How:** Reports can show not just "test passed/failed" but "the Travel Class
dropdown has 4 options, the user selected Premium Economy, and the field validates
correctly." The knowledge model provides the semantic context that makes reports
meaningful.

---

## 9. Alignment Review

This section compares the implementation against the original architectural decisions
from the design discussions.

### Fully Implemented

| Decision | Status | Evidence |
|----------|--------|----------|
| **Three foundational entities** | ✅ Fully implemented | UiElement, ObservedTransition, ComponentGrouping all in `src/domain/entities/` with full invariant validation |
| **Four derived views (types)** | ✅ Types implemented | InteractionContract, BehavioralContract, ApplicationSurface, RecordedWorkflow types in `application-knowledge.ts` |
| **Progressive three-tiered recognition** | ✅ Tiers 1-2 implemented | Structural recognizer (Tier 1), behavioral recognizer (Tier 2). Tier 3 (AI) is deferred but the interface is ready |
| **Generic recognizers (zero pattern-specific logic)** | ✅ Fully implemented | Verified: zero `PatternType.*` references in structural-recognizer, behavioral-recognizer, or orchestrator |
| **Declarative pattern catalogue** | ✅ Fully implemented | 6 V1 patterns auto-registered; adding a pattern = adding a catalogue entry |
| **Evidence sovereignty** | ✅ Fully implemented | `mergeRecognition()` only overrides patternType/root when source is STRUCTURAL; source rank ensures behavioral never downgrades structural |
| **Linear data flow** | ✅ Fully implemented | Orchestrator is one pass; no feedback into recognizers |
| **Additive extensibility** | ✅ Fully implemented | Phase 4 added expectedLifecycle to patterns without recognizer changes; new ComponentRole.UNKNOWN was additive |
| **Application-centric model** | ✅ Fully implemented | Entities describe the application; AI is positioned as a consumer, not the definer |
| **Identity resolution (4 rules)** | ✅ Fully implemented | Exact root, root-in-constituents, Jaccard ≥ 0.34, no match — all in `resolveIdentity()` |
| **Evidence accumulation (generic ledger)** | ✅ Fully implemented | `EvidenceEntry` with source/disposition/description/timestamp; `shouldReject()` is a swappable pure function |
| **Tentative rejection via accumulated contradiction** | ✅ Fully implemented | Net contradiction ≥ 3; threshold-based, not immediate |
| **Lifecycle progression from pattern definitions** | ✅ Fully implemented | `isLifecycleComplete()` reads `expectedLifecycle` from catalogue; no hardcoded operation lists |
| **Recognition vs enrichment separation** | ✅ Fully implemented | Recognition establishes identity (authoritative); enrichment accumulates behavior (always runs) |
| **Sole-writer ownership** | ✅ Fully implemented | Registry is the ONLY writer of lifecycle state; orchestrator delegates |
| **No changes to foundational entities** | ✅ Verified | Phase 4 required zero entity changes; only additive enum value |

### Partially Implemented

| Decision | Status | What's missing |
|----------|--------|----------------|
| **Post-recording enrichment** | 🔵 Types only | InteractionContract, BehavioralContract, ApplicationKnowledgeFragment types exist, but the enrichment pass that materializes them is Phase 5 (not yet built) |
| **Derived views materialization** | 🔵 Types only | View types defined with full field structure, but no code computes them from foundations yet |
| **Option set extraction** | 🔵 Designed | ComponentGrouping has `optionSet: OptionEntry[] | null`, but the DOM inspection that populates it is Phase 5 |
| **Semantic Aggregation** | 🔵 Designed | The blueprint describes grouping transitions by component lifecycle into business actions, but this is deferred to post-recording enrichment |
| **SemanticRelationship graph** | 🔵 Designed | Typed edges (structural, behavioral, semantic) are designed but "computed on demand" — no implementation yet |

### Deferred

| Decision | Status | Rationale |
|----------|--------|-----------|
| **Tier 3 AI-assisted recognition** | ⏸️ Deferred | The interface is ready (RecognitionSource.AI_ASSISTED, evidence ledger accepts AI evidence). Implementation requires the AI Observer integration and LLM calls. Deferred because Tiers 1-2 provide ~80-90% coverage. |
| **Session-scoped → project-scoped promotion** | ⏸️ Deferred | Foundations are designed for promotion across sessions (stable IDs, no session-specific data in entity structure), but the cross-session aggregation layer is not built. |
| **Contextual relevance (standalone vs lifecycle mechanics)** | ⏸️ Deferred | The classifier assigns relevance (deliberate/supporting/noise), but determining whether a supporting interaction is standalone or component lifecycle mechanics requires component awareness that the classifier doesn't have. Deferred to Semantic Aggregation. |
| **Alternative recognizer sources (vision, heuristics)** | ⏸️ Future | The generic evidence ledger and RecognitionSource enum support these, but no implementation exists. |

### Changed During Implementation

| Decision | Original design | Final implementation | Reason |
|----------|----------------|---------------------|--------|
| **ComponentRole enum** | 9 values (trigger, container, option, commit, cancel, label, dependent, tab, panel) | 10 values (added `UNKNOWN`) | Behavioral enrichment discovers constituents whose specific role isn't known at discovery time. Additive, backward-compatible. |
| **Orchestrator enrichment path** | Two branches: recognition-hit → merge; no-recognition → standalone | Three branches: added constituent-enrichment (related element → existing component) | The merge test revealed that interactions on DOM-related elements (e.g., a "Done" button in a dropdown) should enrich the owning component, not be discarded as standalone. This implements the "behavioral enrichment runs for structurally-recognized components" principle. |
| **Registry.register() evidence seeding** | Not explicitly specified | Seeds 1 supporting evidence entry per registration | Initial recognition IS supporting evidence — the recognizer matched the pattern. This is semantically correct and protects against premature rejection. Discovered during test implementation. |
| **Behavioral recognizer ranking** | Confidence as primary sort key | matchedCount DESC, then confidence DESC | A pattern matching 3 conditions (even partially) is a stronger explanation than a pattern matching 1 condition (even fully). Prevents degenerate single-condition patterns from winning. |

### Why Changes Were Made

Every change was **additive** or **a refinement of an underspecified behavior** — none
contradicted the original architecture:

- `ComponentRole.UNKNOWN` extends the enum without breaking existing values.
- The constituent-enrichment path adds a third branch without modifying the existing
  two.
- Evidence seeding on registration is a natural consequence of the evidence model's
  semantics (recognition is supporting evidence).
- The ranking refinement makes the behavioral recognizer more correct, not more
  complex.

The architecture proved **stable under implementation** — the design decisions held up
when confronted with real code and real tests.

---

## 10. Technical Debt

### Known Limitations

1. **No enrichment pass (Phase 5).** The ApplicationKnowledgeFragment type exists
   but is never materialized. Derived views (InteractionContract, BehavioralContract)
   are typed but not computed. This is the most significant gap — the model captures
   foundations but doesn't yet produce the derived knowledge that future capabilities
   need.

2. **No Tier 3 AI recognition.** The interface is ready (RecognitionSource.AI_ASSISTED,
   evidence ledger), but no AI recognizer is wired in. Coverage tops out at ~80-90%
   (Tiers 1-2); unconventional widgets without ARIA or standard behavioral signatures
   are not recognized.

3. **No Semantic Aggregation.** The blueprint describes grouping transitions by
   component lifecycle into business-level actions ("Set Travel Class to Premium
   Economy" = open + select + close). This is designed but not implemented. Without
   it, the workflow view cannot be produced.

4. **No persistence layer for the knowledge model.** The entities are in-memory
   during a recording session. There is no IndexedDB/storage layer that persists
   UiElements, ObservedTransitions, and ComponentGroupings across sessions. The
   `sourceUrl` and stable ID design supports cross-session promotion, but the
   mechanism doesn't exist yet.

5. **No wiring to the recording pipeline.** The recognition system
   (`src/recorder/recognition/`) is built and tested in isolation. It is not yet
   wired into the live recording pipeline — the orchestrator's `processInteraction()`
   is not called by the recording session. This is expected (recognition is tested
   in isolation first), but it means the system has not been validated end-to-end
   against real browser interactions.

### Design Compromises

1. **Behavioral constituent role assignment is approximate.** The behavioral
   recognizer infers constituent roles from which signals an element participated in
   (appeared → CONTAINER, clicked → OPTION, etc.). This is necessarily less precise
   than structural recognition's ARIA-based assignment. Accepted because behavioral
   recognition is tentative until confirmed and never overrides structural.

2. **Identity resolution Jaccard threshold (0.34) is heuristic.** The threshold was
   chosen to require meaningful overlap without being so high that legitimately
   related observations fail to merge. It has not been extensively tuned against
   real-world recording scenarios. May need adjustment after end-to-end validation.

3. **Rejection threshold (3) is heuristic.** Similar to the Jaccard threshold —
   chosen to require accumulated contradiction, not tuned against real false-positive
   recognition scenarios. The algorithm is swappable (pure function), so adjustment
   is cheap.

4. **`checkLifecycle()` registry method is partially dead code.** The registry has a
   `checkLifecycle()` method whose set-containment logic is commented out — it always
   returns the component unchanged. The actual lifecycle checking is done by the
   orchestrator's `isLifecycleComplete()` function, which then calls
   `registry.promote()` directly. Functionally correct (the orchestrator drives it),
   but the registry method is misleading. Should be removed or implemented.

5. **Redundant identity resolution.** When the orchestrator finds an existing
   component via `resolveIdentity()`, it then calls `registry.register()`, which
   internally calls `resolveIdentity()` again. Functionally harmless (idempotent)
   but wastes computation on every recognition-hit interaction.

### Future Improvements

1. **Wire recognition into the recording pipeline.** Call `processInteraction()` from
   the recording session for each classified interaction. This is the critical
   end-to-end validation step.

2. **Implement Phase 5 enrichment.** Materialize InteractionContract (from
   domAttributes), BehavioralContract (from transitions), and
   ApplicationKnowledgeFragment. This unlocks the future capabilities described in
   §8.

3. **Add persistence.** Store UiElements, ObservedTransitions, and
   ComponentGroupings in IndexedDB (via Dexie, already a dependency). This enables
   cross-session promotion and offline analysis.

4. **Add Tier 3 AI recognition.** Wire the AI Observer to contribute evidence to the
   registry's ledger. The interface is ready; this extends coverage to unconventional
   widgets.

5. **Implement Semantic Aggregation.** Group confirmed component lifecycles into
   business-level actions. This produces the RecordedWorkflow view.

6. **Tune thresholds against real data.** After end-to-end wiring, validate the
   Jaccard threshold (0.34) and rejection threshold (3) against real-world recording
   scenarios. Adjust as needed.

7. **Clean up `checkLifecycle()`.** Either implement the registry method properly or
   remove it and document that lifecycle checking lives in the orchestrator.

### Areas That Should Be Revisited

1. **The relationship between the Architecture C classifier and the UI Knowledge
   Model orchestrator.** Both process interactions. The classifier assigns type +
   relevance; the orchestrator runs recognition. Currently they are separate stages,
   but there is potential overlap in the evidence they use. As the system matures,
   this boundary should be reviewed for clarity.

2. **The Evidence Engine vs. the recognition evidence ledger.** The Architecture C
   pipeline has an Evidence Engine (provider-pluggable, weighted voting) for
   classification. The UI Knowledge Model has an evidence ledger (supporting/
   contradicting/neutral) for recognition. These are different evidence systems
   serving different purposes, but the naming overlap could cause confusion.
   Consider whether they should share infrastructure.

3. **Multiple parallel implementations.** The project has accumulated Architecture C
   (universal observer → coalescer → classifier), Pipeline V2 (deterministic
   recorder → interaction detector), and the UI Knowledge Model. The git history
   shows these as successive approaches. The final production path should be clearly
   documented to avoid confusion about which pipeline is active.

---

## 11. Readiness Assessment

### Ready for Phase 5 (Post-Recording Enrichment)

**✅ Ready.** The foundational entities are complete and validated. The
ComponentGrouping entity carries `optionSet` (null until enrichment) and
`businessField` (null until enrichment). The derived view types
(InteractionContract, BehavioralContract, ApplicationKnowledgeFragment) are fully
defined. The enrichment pass needs only to:
1. For each confirmed component: extract option set from constituent DOM (read-only).
2. For each UiElement: build InteractionContract from `domAttributes`.
3. For each confirmed component: build BehavioralContract from transitions.
4. Assemble ApplicationKnowledgeFragment.

No entity changes, no new enums, no architectural changes needed. Phase 5 is pure
computation on top of existing foundations.

### Ready for Remaining Planned Phases

**✅ Ready, with dependencies.** Future phases (Semantic Aggregation, persistence,
pipeline wiring) build on Phase 5's enrichment output. The architecture supports
them:
- Semantic Aggregation reads confirmed ComponentGroupings + ordered transitions.
- Persistence serializes the three foundational entities (designed for it — stable
  IDs, no session-specific data in entity structure).
- Pipeline wiring calls `processInteraction()` from the recording session.

### Ready for Future AI Recognizers (Tier 3)

**✅ Ready.** The architecture was designed for this:
- `RecognitionSource.AI_ASSISTED` exists in the enum.
- The evidence ledger accepts evidence from any source.
- `mergeRecognition()` already handles source priority (structural > behavioral > AI).
- The rejection algorithm would treat AI-contributed contradicting evidence the same
  as any other.
- The AI Observer (from Architecture C Phase 6) is already implemented and could be
  wired to contribute evidence to the recognition ledger.

**Risk:** AI recognition is async (~200-500ms). The current orchestrator is
synchronous. Integrating Tier 3 will require either an async orchestrator flow or a
post-hoc evidence injection mechanism. This is a known design consideration, not a
blocker.

### Ready for Vision Recognizers

**⚠️ Partially ready.** Vision recognition (analyzing screenshots to identify
components) is a future possibility. The architecture partially supports it:
- The evidence ledger is source-agnostic — a vision recognizer could contribute
  evidence.
- `RecognitionSource` would need a new value (e.g., `VISION`) or could reuse
  `AI_ASSISTED`.

**Risk:** Vision recognition needs screenshot capture infrastructure that doesn't
exist in the current pipeline. The universal observer captures DOM events, not
visual data. This is a larger integration effort.

### Ready for Accessibility Recognizers

**✅ Ready.** Accessibility recognition is a natural extension:
- UiElement already carries `identity.ariaRole` and `domAttributes`.
- An accessibility recognizer could evaluate ARIA correctness (valid roles, required
  properties, naming) and contribute evidence.
- The derived view ApplicationSurface (page-level accessibility structure) is typed
  and waiting for enrichment.

### Ready for Enterprise-Scale Recording

**⚠️ Partially ready.** The architecture is sound, but there are scale
considerations:

**Strengths:**
- The registry uses Maps with O(1) lookup by groupingId and elementId.
- Identity resolution is O(n) in active components (typically small — tens, not
  thousands).
- Structural recognition is <1ms; behavioral is ~5ms.
- The evidence ledger grows linearly with interactions (not quadratically).

**Risks:**
- The in-memory registry has no eviction policy. A very long recording session
  (thousands of interactions) could accumulate many tentative/rejected components.
  Consider evicting rejected components after a TTL.
- No persistence means a container pause (10 min idle) loses all session state. The
  background service pattern mitigates this, but persistence is needed for
  production reliability.
- The universal observer captures ALL events. On a complex SPA with frequent
  mutations, the evidence volume could be large. The coalescer's deduplication helps,
  but throughput should be benchmarked on real enterprise applications.

### Architectural Risks Before Continuing

1. **No end-to-end validation.** The recognition system is tested in isolation
   (unit tests with synthetic fixtures) but has not been validated against real
   browser interactions. Phase 5 enrichment and pipeline wiring should include
   integration tests with real recordings.

2. **Threshold tuning is pending.** The Jaccard threshold (0.34) and rejection
   threshold (3) are reasonable defaults but unvalidated. They should be tuned
   against real data after pipeline wiring.

3. **Async Tier 3 integration.** The synchronous orchestrator will need rework for
   async AI recognition. This should be designed before implementation, not during.

4. **Persistence gap.** Without persistence, the knowledge model is session-scoped
   and ephemeral. Cross-session promotion (a stated goal) requires a storage layer.

---

## 12. Final Architecture Assessment

### Does the current implementation still represent the original vision?

**Yes.** The implementation faithfully realizes the vision documented in
`ui-knowledge-model.md`:

- The model is **application-centric** — entities describe the application, not how
  AI interprets it. AI is positioned as one consumer among many.
- The **three foundations, four views** principle holds — foundational entities are
  persisted; derived views are typed but not yet materialized (Phase 5).
- **Progressive recognition** works as designed — tentative → developing → confirmed
  | rejected, with evidence accumulation and accumulated-contradiction rejection.
- **Evidence sovereignty** is enforced — structural overrides behavioral, behavioral
  overrides AI (when it exists).
- **Generic recognizers** contain zero pattern-specific logic — all pattern knowledge
  is declarative data in the catalogue.
- **Linear data flow** — the orchestrator is one pass, no feedback loops.

The implementation required only additive changes (one enum value, one registry
method, one orchestrator branch) and one ranking refinement. No foundational
decision was contradicted.

### Has the architecture become simpler or more complex?

**Both — and that's the right outcome.**

**More complex** in the sense that there are more moving parts: three foundational
entities, a pattern catalogue, two recognizers, a registry, an orchestrator, an
evidence ledger. This is unavoidable complexity — the model does more than an event
logger.

**Simpler** in the sense that each component has a single, clear responsibility,
and the interactions between them are linear and well-defined:
- The recognizers don't know about each other.
- The orchestrator doesn't know about pattern types.
- The registry doesn't know about recognition strategies.
- The entities don't know about recognition at all.

This is the "simple made easy" principle: the system is more complex than a flat
event logger, but each piece is simple, testable, and replaceable. The complexity is
**essential** (it reflects the real complexity of understanding UI applications),
not **accidental** (it doesn't come from tangled dependencies or cross-cutting
concerns).

### Are the three foundational entities still sufficient?

**Yes.** Phase 4's explicit objective was to validate that recognition orchestration
fits on top of the three entities "without requiring entity changes." This was
confirmed:

- Identity resolution operates on `ComponentGrouping.rootElementId` and
  `constituents` — existing fields.
- Evidence accumulation is in the registry (not an entity) — the entities don't
  carry evidence.
- Lifecycle progression updates `ComponentGrouping.lifecycleState` — existing field.
- Rejection clears the element index (registry) and marks the component REJECTED —
  existing field.
- Constituent enrichment uses `addConstituent()` which adds to
  `ComponentGrouping.constituents` — existing field, existing mutation helper.

The only addition was `ComponentRole.UNKNOWN` — an enum value, not an entity change.
The entities proved to be the right abstraction: they carry the data that needs to
persist, and everything else (recognition logic, evidence, lifecycle rules) lives in
the systems that operate on them.

The entities will remain sufficient for Phase 5 (enrichment operates on
`domAttributes`, `observedTransitionIds`, and `optionSet` — all existing fields).
They may need extension for future capabilities (e.g., visual/screenshot data for
vision recognition), but that's a future decision, not a current gap.

### Is there anything I would redesign today?

**Minor items only. The architecture is sound.**

1. **I would make `checkLifecycle()` on the registry either work or remove it.**
   Currently it's dead code that misleadingly suggests the registry does lifecycle
   checking. The orchestrator does it. Pick one owner and be explicit.

2. **I would eliminate the redundant identity resolution.** The orchestrator calls
   `resolveIdentity()`, then calls `registry.register()`, which calls
   `resolveIdentity()` again. The registry's `register()` should accept a pre-
   resolved component, or the orchestrator should call lower-level registry methods.

3. **I would consider making the orchestrator async from the start.** Tier 3 (AI)
   recognition is inherently async. Retrofitting async into a synchronous flow is
   more disruptive than designing for it. However, this is a judgment call — the
   synchronous design is simpler for Tiers 1-2, and the async rework can be
   localized.

4. **I would add the persistence interface earlier.** The entities are designed for
   persistence (stable IDs, no session-specific data), but there's no storage layer.
   Designing the persistence interface (even if not implementing it) earlier would
   catch any serialization issues before they become entrenched.

None of these are architectural redesigns — they're implementation refinements. The
core decisions (three foundations, four views, progressive recognition, evidence
sovereignty, generic recognizers, linear data flow) all hold. The architecture was
well-designed, and it has proven stable under four phases of implementation.

---

### Conclusion

The UI Knowledge Model has successfully evolved from a browser event recorder into
an application knowledge model. The implementation through Phase 4 faithfully
realizes the original vision, with only additive changes and minor refinements. The
architecture is ready for Phase 5 (enrichment) and the remaining planned phases,
with clear paths for future AI, vision, and accessibility recognizers.

The three foundational entities (UiElement, ObservedTransition, ComponentGrouping)
have proven sufficient — no entity changes were required across four phases of
implementation. The generic recognizer pattern (zero pattern-specific logic,
declarative catalogue) has held, making the system extensible by addition rather
than modification.

The primary gap is the absence of the enrichment pass (Phase 5) and end-to-end
pipeline wiring. Once these are complete, the model will produce the
ApplicationKnowledgeFragment that unlocks the full range of future capabilities:
negative testing, boundary testing, self-healing, accessibility testing, and
AI-assisted test generation.

---

*Document authored: 2026-07-21. Covers implementation through Phase 4 (commit
`c66738d`). Phase 5 (Post-Recording Enrichment & Derived Views) is the next planned
phase.*
