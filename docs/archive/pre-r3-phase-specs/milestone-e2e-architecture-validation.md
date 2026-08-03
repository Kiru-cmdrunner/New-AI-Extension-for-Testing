# Architecture Milestone — End-to-End Recording & Automation Pipeline Validation

**Status:** Architecture review — validated and refined  
**Date:** 2026-07-18  
**Scope:** Full pipeline from Start Recording to automation code generation  
**Constraint:** No implementation. No redesign of frozen foundations. All frozen milestones (Product Foundation, Product Architecture PA1–PA12, B1–B8, C3–C6, Phase 2, Execution JSON Evolution, Intelligent Automation Generation) are permanently preserved.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Validation of the Proposed Five-Stage Architecture](#2-validation-of-the-proposed-five-stage-architecture)
3. [Stage-by-Stage Analysis](#3-stage-by-stage-analysis)
4. [Identified Gaps and Missing Responsibilities](#4-identified-gaps-and-missing-responsibilities)
5. [AI Placement Validation](#5-ai-placement-validation)
6. [Mental Model as a Separate Architectural Component](#6-mental-model-as-a-separate-architectural-component)
7. [Separation of Recording, Semantic Understanding, Execution Planning, and Automation Generation](#7-separation-of-recording-semantic-understanding-execution-planning-and-automation-generation)
8. [Scalability for Future Interaction Types](#8-scalability-for-future-interaction-types)
9. [Multi-Engine Support](#9-multi-engine-support)
10. [Recommended Improvements](#10-recommended-improvements)
11. [Corrected Architecture Diagram](#11-corrected-architecture-diagram)
12. [Consistency Review Against All Frozen Milestones](#12-consistency-review-against-all-frozen-milestones)
13. [Freeze Declaration](#13-freeze-declaration)

---

## 1. Executive Summary

### Verdict

The proposed five-stage architecture is **architecturally sound, directionally correct, and consistent with every frozen milestone.** The core philosophy — **Record Reality → Understand Context → Generate Meaning → Generate Execution → Generate Automation** — is the right principle and aligns with PA5 (Derivation Is One-Way), PA6 (Transient ≠ Permanent), and the Phase 2 recommendation to separate evidence collection from classification.

However, **six gaps** and **four refinements** are identified that must be addressed before this architecture is frozen as the canonical end-to-end reference. These are additive — they do not contradict or redesign the proposed stages; they complete and constrain them.

### Summary of findings

| Finding | Type | Severity |
|---------|------|----------|
| Canonical Test Step generation is missing as a distinct stage boundary | Gap | **High** |
| Mental Model persistence boundary is undefined | Gap | **High** |
| Evidence Store lifecycle is unspecified | Gap | **Medium** |
| Screenshot/Evidence capture is not addressed | Gap | **Medium** |
| Readability optimization (B7.1–B7.2) is not represented | Gap | **Medium** |
| AI Observer cost model and Manifest V3 service worker lifecycle constraints are unaddressed | Gap | **High** |
| Stage 3 conflates classification with canonical step generation | Refinement | **High** |
| Stage 4 should reference the Layered Execution Plan (Option D) explicitly | Refinement | **Low** |
| Recorder responsibilities include unimplemented interactions (Drag, Drop, Scroll, Canvas) that need architectural scoping | Refinement | **Medium** |
| Missing Test Case lifecycle integration (DRAFT → SAVED) | Refinement | **Medium** |

### What is validated without modification

- The five-stage separation itself (Recording → Observation → Semantic → Execution → Automation)
- The principle that recorded actions are immutable
- The principle that AI enhances understanding but never replaces deterministic recording
- The principle that semantic interactions are derived, not recorded
- The principle that Playwright generation is always deterministic from the Execution JSON
- The principle that future engines are supported via the same Execution JSON

---

## 2. Validation of the Proposed Five-Stage Architecture

### 2.1 Architectural alignment assessment

| Frozen Principle | Proposed Stage Alignment | Verdict |
|-----------------|------------------------|---------|
| PA1 (Test Case Centricity) | All stages exist within a Test Case context | ✅ Validated |
| PA5 (Derivation Is One-Way) | Data flows forward through all five stages | ✅ Validated |
| PA6 (Transient ≠ Permanent) | Recording Session produces; Test Case owns | ✅ Validated, but needs explicit boundary markers (see §4.2) |
| PA7 (Approval Is the Freeze Point) | Not mentioned — needs integration | ⚠️ Gap |
| PA8 (Framework Agnosticism) | Stage 5 is explicitly deterministic + extensible | ✅ Validated |
| PA9 (Additive Extensibility) | Future types fit into Stage 2/3 without architectural change | ✅ Validated |
| PA10 (Minimal Coupling) | Each stage reads from previous, produces its own output | ✅ Validated |
| B3 (Timeline immutability) | "Recorder should preserve exactly what happened" | ✅ Validated |
| Phase 2 (Evidence → Classification separation) | Stage 2 separates Recorder from AI Observer | ✅ Validated |
| Execution JSON Evolution (Option D) | Stage 4 says "execution plan rather than only execution instructions" | ✅ Validated |

### 2.2 Stage boundary assessment

The proposed five stages create clean boundaries with well-defined inputs and outputs. Each stage:
- Has a single primary responsibility
- Produces a well-defined output artifact
- Does not reach backward to modify prior stages
- Can be tested independently given its input

This is consistent with PA2 (Single Responsibility) and PA10 (Minimal Coupling).

### 2.3 What the five stages get right

1. **Immutability of recorded actions is front and centre.** Stage 2 explicitly states the recorder "should preserve exactly what happened" and the AI Observer "should never modify the recorded actions." This is the B3 invariant and it is correctly placed.

2. **AI is separated from recording.** The AI Observer operates alongside the Recorder but cannot mutate the Action Timeline. This prevents the fundamental risk of AI contaminating the factual record.

3. **Semantic interactions are derived, not recorded.** Stage 3 takes the Action Timeline + Mental Model + Evidence and produces semantic interactions. The original actions remain available. This aligns with the frozen product architecture's distinction between Interaction Timeline (factual) and Canonical Test Steps (interpreted).

4. **Execution JSON as an execution plan.** Stage 4's vision of the Execution JSON as a plan rather than mere instructions aligns with the Option D Layered Execution Plan recommended in the Execution JSON Evolution review.

5. **Deterministic automation generation.** Stage 5 correctly states AI should not directly generate Playwright. The Playwright generator reads the Execution JSON deterministically. This preserves PA8 and the Intelligent Automation Generation review's recommended Alternative C.

### 2.4 Overall verdict

**VALIDATED — with the six gaps and four refinements addressed in this document.** The proposed architecture is not redesigned; it is completed.

---

## 3. Stage-by-Stage Analysis

### Stage 1 — Recording Session Initialization

#### What is correct

- Creating the recording session and initializing listeners is exactly what the current implementation does (`recording-session.ts` starts content scripts, initializes storage, captures `RecordingContext`).
- Initializing evidence collection and an empty Action Timeline matches the current architecture.
- Capturing the initial application state (startUrl, startTitle, capturedAt) is the frozen Recording Context (PA §3.6).

#### Gap S1-G1: Missing Test Case context initialization

The frozen Product Foundation Design (§1) establishes that a **Test Case is created BEFORE recording begins.** The user enters metadata (name, expected result, project/feature/scenario hierarchy), THEN starts recording. The proposed Stage 1 does not mention Test Case context initialization.

**Recommendation:** Stage 1's responsibilities should include:
- Bind the Recording Session to a Test Case (which already exists in DRAFT state)
- Capture Test Case metadata context (project, feature, scenario)
- Transition Test Case to RECORDING state

#### Gap S1-G2: Manifest V3 service worker lifecycle

Chrome MV3 service workers are **ephemeral** — they can be terminated after 30 seconds of inactivity and restarted on new events. The proposed Stage 1 assumes a persistent initialization, but the service worker may be killed and restarted mid-session.

**Recommendation:** Stage 1 must account for MV3 lifecycle:
- All session state must be in `chrome.storage.local` (not in-memory)
- Session rehydration on service worker restart must be transparent
- The Recording Session is logically persistent; its in-memory representation is ephemeral

This is already how the current implementation works (`recording-session.ts` persists to storage), but the architecture document should state it explicitly.

#### Refinement S1-R1: Feature flag initialization

Per the Phase 2 migration strategy (M4), the system will transition from six content scripts to one unified Evidence Collector behind a feature flag. Stage 1 initialization should:
- Read the `useUnifiedRecorder` feature flag from storage
- Initialize the appropriate evidence collection path (legacy or unified)
- This is an implementation detail but affects the architectural contract: Stage 1 must initialize the correct evidence infrastructure

#### Stage 1 verdict

**VALIDATED with refinements.** Add: Test Case context binding, MV3 lifecycle awareness, feature flag initialization.

---

### Stage 2 — Intelligent Observation

This is the most complex stage and requires the most detailed analysis.

#### 3.2.1 Recorder responsibilities

The proposed Recorder captures:
> Click, Double Click, Keyboard input, Scroll, Hover, Drag, Drop, Navigation, Focus changes, Value changes, DOM mutations, Accessibility changes

**Currently implemented (7 types):** Click, Text Entry (keyboard input on focus/blur), Hover, Checkbox/Radio, Select, DateSelect, Navigation.

**Not yet implemented:** Scroll, Drag, Drop, Double Click, DOM mutations (as standalone interactions), Accessibility changes.

**Refinement S2-R1: Recorder responsibility scope must be tiered.**

The architecture should distinguish between:
- **Tier 1 — Core interactions (implemented):** Click, Text Entry, Hover, Checkbox, Radio, Select, DateSelect, Navigation
- **Tier 2 — Planned interactions (specs exist):** Drag & Drop, File Upload, Toggle Switch, Slider, Multiselect
- **Tier 3 — Future interactions (architecturally possible):** Scroll, Double Click, Right Click, Rich Text Editor, Canvas, Maps

The architecture document should acknowledge all three tiers without committing to Tier 3 implementation details. The Stage 2 Recorder responsibility list should scope to what the architecture supports, not what exists today.

**Key principle:** The architecture must be extensible enough to support all three tiers, but Stage 2's contract is: "capture every interaction the recorder knows about, preserve facts, never classify." Adding Tier 3 interactions means extending the recorder, not redesigning the stage.

#### 3.2.2 Recorder principle: "No actions should be merged or transformed"

**Validated.** This is the B3 immutability invariant. The current implementation already preserves this — the Timeline stores every captured event in chronological order. The Phase 2 architecture's Snapshot Coalescer groups related events (e.g., mousedown + click → one interaction), but the raw evidence is preserved before coalescing.

**Important distinction:** Event coalescing (grouping mousedown + click into one user action) is not event merging (discarding the original events). The coalescer preserves the evidence trail. This distinction should be explicit in the architecture.

#### 3.2.3 AI Observer responsibilities

The AI Observer maintains a live understanding of:

| Domain | What It Tracks | Alignment |
|--------|---------------|-----------|
| User Intent | Logging in, searching, creating customer, booking flight | ✅ Aligns with AI Intent Service from Phase 2 |
| Application Context | Current page, feature, workflow, form, dialog, menu, dropdown, screen | ✅ Aligns with ancestor context evidence from Phase 2 |
| Application Behaviour | Menu opened, dropdown expanded, calendar displayed, dialog opened, validation appeared, toast displayed, navigation, loading indicators | ⚠️ This is new — DOM Mutation observation as behavioral evidence |
| Mental Model | Current application, feature, workflow, screen, UI component, possible intent, confidence | ⚠️ This is a new architectural object (see §6) |

#### Gap S2-G1: AI Observer cost model is undefined

The current architecture calls AI once per captured interaction (async, non-blocking). The proposed AI Observer is **continuously** observing and building understanding. This implies:

- One AI call per interaction (current model): ~10-50 calls per recording session
- Continuous observation: potentially hundreds of calls, or a streaming model

**Recommendation:** The AI Observer should operate on the same **per-interaction** cadence as the current architecture, but with richer context. It observes continuously (tracking DOM state, page context) but only invokes the AI when a new interaction is captured. The "continuous" aspect is the DOM state tracking (MutationObserver, navigation listener), not continuous AI calls.

This aligns with the Phase 2 recommendation: "AI is an optional enhancement input to the deterministic classifier, not a mandatory pipeline stage."

#### Gap S2-G2: AI Observer and Manifest V3 service worker lifecycle

The AI Observer runs in the service worker. MV3 service workers can be killed at any time. Long-running AI calls may be interrupted.

**Recommendation:** All AI Observer state must be persisted to `chrome.storage.local`. On service worker restart, the Mental Model is rehydrated from storage. Pending AI calls are retried or discarded (the classifier operates without AI).

#### 3.2.4 Output: Action Timeline + Mental Model + Application Context + Evidence Store

**Gap S2-G3: Evidence Store lifecycle is undefined.**

The proposed output includes an "Evidence Store" but does not define:
- Is it transient (dies with Recording Session) or permanent (attached to Test Case)?
- What evidence does it contain (screenshots? DOM snapshots? before/after states?)
- How does it relate to the frozen Screenshot/Evidence object in the Product Architecture?

**Recommendation:** The Evidence Store is **transient** — it exists during recording to provide context to the Semantic Classifier (Stage 3) and AI Observer. After Stop Recording, the evidence is consumed by Stage 3 and then discarded. Only **screenshots** (the frozen evidence artifact) are persisted permanently on the Test Case.

This aligns with PA6: "Transient state never enters the Repository."

#### Stage 2 verdict

**VALIDATED with critical refinements.** The dual-track model (Recorder captures facts; AI Observer builds understanding) is correct. Must address: cost model (per-interaction, not continuous), MV3 lifecycle, Evidence Store lifecycle, and tiered interaction scope.

---

### Stage 3 — Semantic Understanding & Interaction Generation

#### What is correct

- Semantic interactions are **derived** from Action Timeline + Mental Model + Application Context + Evidence, not directly recorded.
- The original observed actions always remain available (frozen Timeline).
- The example (Click Dropdown → Scroll Options → Click Economy → becomes "Select Economy from Cabin Class") correctly illustrates multi-event coalescing into a semantic interaction.

#### Gap S3-G1: Stage 3 conflates two distinct operations

The proposed Stage 3 produces a "Semantic Interaction Timeline." But the frozen product architecture has TWO distinct derived artifacts:

1. **Interaction Timeline** (typed events) — the factual record of what interactions occurred. In the current architecture, events are typed at capture time (click, text, select, dateSelect, etc.). In the Phase 2 recommended architecture, typing happens post-evidence in the Semantic Classifier.

2. **Canonical Test Steps** — the interpreted, structured, human-readable test instructions. These have step numbers, plain English descriptions, readability optimizations (B7.1 OR-1 merge), and linked interaction IDs.

The proposed Stage 3 collapses both into one stage. But they are architecturally distinct:
- The typed Timeline is about **what type of interaction** occurred (deterministic classification).
- Canonical Steps are about **what the test instruction** should say (readability, merging, plain English).

**Recommendation:** Stage 3 should be split into two sub-stages:

> **Stage 3a — Semantic Classification:** Determines interaction types from evidence + AI hints. Produces a typed Semantic Interaction Timeline (each interaction has a type: click, select, dateSelect, hover, text, etc.). This is where the Phase 2 Semantic Classifier operates.

> **Stage 3b — Canonical Test Step Generation:** Transforms the typed Timeline into human-readable, numbered, optimized Canonical Test Steps. This is where the B7.1 readability optimizer (OR-1 merge: focus+click+text → one step) and the interaction type registry's `toPlainEnglish` functions operate.

This split preserves the frozen architecture's distinction between Timeline (factual, typed) and Canonical Steps (interpreted, human-readable) while maintaining the five-stage flow.

#### Gap S3-G2: Readability optimization (B7.1–B7.2) is not represented

The frozen B7.1 Readability Strategy defines OR-1 (merge focus + click + text entry on the same element into one Canonical Step). B7.2 further refines the merge eligibility rules. The proposed Stage 3 does not mention readability optimization.

**Recommendation:** Stage 3b (Canonical Step Generation) must explicitly include the readability optimization pass. This is a frozen architectural responsibility.

#### Gap S3-G3: The "Semantic Interaction Timeline" is a new artifact name

The frozen architecture has:
- Interaction Timeline (contains Interactions)
- Canonical Test Steps (contains Canonical Test Steps)

The proposed "Semantic Interaction Timeline" is neither — it's an intermediate representation between raw observed actions and canonical steps.

**Recommendation:** Rather than introducing a third artifact name, align with the Phase 2 model:
- The **Interaction Timeline** stores typed events (after classification).
- The **Canonical Test Steps** are derived from the Timeline.
- The "Semantic Interaction Timeline" in the proposed architecture maps to the classified **Interaction Timeline** in the frozen architecture.

This avoids introducing a new permanent object into the Product Architecture's object inventory.

#### Stage 3 verdict

**VALIDATED but requires splitting into 3a (Classification) and 3b (Canonical Step Generation).** This is the most significant refinement. Without it, the architecture loses the frozen distinction between factual Timeline and interpreted Steps.

---

### Stage 4 — CmdRunner Execution JSON Generation

#### What is correct

- Execution JSON is generated from the Semantic Interaction Timeline (which maps to Canonical Test Steps).
- The JSON should represent an execution plan, not just execution instructions.
- The generator combines semantic interactions, workflow context, mental model, execution strategies, recovery strategies, locator strategies, and validation information.

#### Refinement S4-R1: Explicitly reference the Layered Execution Plan

The proposed Stage 4 aligns with the Execution JSON Evolution review's recommended **Option D — Layered Execution Plan.** The architecture document should explicitly reference this model:

| Layer | Content | Status |
|-------|---------|--------|
| Layer 0 — CORE | Frozen B5.2 6 sections (action, target, locators, context, trace, meta) | **Mandatory, frozen** |
| Layer 1 — RESILIENCE | locatorChain, waitStrategy, recoveryHints (AI-enriched) | **Planned (E0)** |
| Layer 2 — VALIDATION | precondition, postcondition, expectedResult | **Future** |
| Layer 3 — WORKFLOW CONTEXT | intent, stepGroup, sequencePosition, dependentOn | **Future** |
| Layer 4 — EXECUTION STRATEGY | retryPolicy, recoveryPolicy, customSync | **Future** |

Stage 4 should produce Layer 0 always, with Layers 1–4 added incrementally as they are validated by execution experience.

#### Refinement S4-R2: AI Enrichment Layer positioning

The Intelligent Automation Generation review recommended an **AI Enrichment Layer** between the execution-json-generator and the playwright-generator. In the five-stage model, this sits within Stage 4 as an optional sub-step:

```
Stage 4a — Core Execution JSON generation (deterministic, always runs)
Stage 4b — AI Enrichment Layer (optional, adds resilience + workflow context)
```

Without AI, Stage 4 produces Layer 0 only. With AI, Stage 4 adds Layer 1 data.

#### Stage 4 verdict

**VALIDATED.** Add explicit reference to the Layered Execution Plan (Option D) and the AI Enrichment Layer positioning.

---

### Stage 5 — Intelligent Automation Generation

#### What is correct

- Playwright is deterministically generated from the Execution JSON.
- AI does not directly generate Playwright.
- Future execution engines are supported via the same Execution JSON.
- The generator uses execution strategies, locator strategies, recovery strategies, and synchronization strategies from the Execution JSON.

This is fully consistent with:
- PA8 (Framework Agnosticism)
- PA5 (Derivation Is One-Way)
- The Intelligent Automation Generation review's recommended Alternative C (AI-Enriched Execution JSON + Deterministic Playwright)
- The frozen B6 Playwright Generator architecture

#### Stage 5 verdict

**VALIDATED without modification.** This stage is correctly designed and needs no changes.

---

## 4. Identified Gaps and Missing Responsibilities

### 4.1 Gap: Canonical Test Step generation as a distinct boundary

**Severity: HIGH**

The proposed architecture compresses the frozen pipeline (Timeline → Canonical Steps → Execution JSON → Playwright) into fewer stages. Canonical Test Steps are the **single source of truth** (PA4, PA §3.9). They are not a pass-through — they contain:
- Step numbers
- Plain English descriptions (from interaction type registry)
- Readability optimization (B7.1 OR-1 merge)
- Linked interaction IDs

Collapsing Steps into Stage 3 (Semantic) or Stage 4 (Execution JSON) loses this architectural significance.

**Recommendation:** Canonical Test Step generation is an explicit sub-stage (3b) between Semantic Classification (3a) and Execution JSON Generation (Stage 4). See §3 Stage 3 analysis.

### 4.2 Gap: Transient → Permanent boundary marker

**Severity: HIGH**

The frozen Product Architecture (PA6, §8) defines three boundary zones: Transient, Permanent, Future. The proposed five stages do not explicitly mark where the Transient → Permanent boundary occurs.

**Recommendation:** The boundary occurs at **Stop Recording**:
- Stages 1–3a operate in the **Transient Zone** (Recording Session, live state, Evidence Store)
- At Stop Recording, the Interaction Timeline + Recording Context cross into the **Permanent Zone** (attached to Test Case)
- Stages 3b–5 operate in the **Permanent Zone** (Test Case artifacts, derived)

This should be an explicit marker in the architecture diagram.

### 4.3 Gap: Screenshot/Evidence capture lifecycle

**Severity: MEDIUM**

The current implementation captures screenshots per interaction (ScreenshotService). The frozen Product Architecture lists Screenshot as a future permanent artifact attached to the Test Case. The proposed five stages do not mention screenshot capture.

**Recommendation:** Screenshot capture occurs during Stage 2 (Recording), triggered when each interaction is committed to the Timeline. Screenshots cross the Transient → Permanent boundary with the Timeline. They are not re-captured during Stage 3–5.

### 4.4 Gap: AI Observer cost model

**Severity: HIGH**

Addressed in §3.2.3. Summary: AI operates per-interaction (not continuously), with richer context than today. Continuous DOM observation (MutationObserver, navigation) is not AI — it's deterministic evidence collection.

### 4.5 Gap: Test Case lifecycle integration

**Severity: MEDIUM**

The frozen Test Case lifecycle is: DRAFT → RECORDING → RECORDED → GENERATED → UNDER_REVIEW → APPROVED → SAVED. The five stages must map to these lifecycle transitions:

| Stage | TC Lifecycle Transition |
|-------|------------------------|
| Stage 1 (Init) | DRAFT → RECORDING |
| Stage 2 (Observation) | RECORDING (active) |
| Stop Recording | RECORDING → RECORDED |
| Stage 3a (Classification) | RECORDED → (still RECORDED, typing Timeline) |
| Stage 3b (Canonical Steps) | RECORDED → GENERATED |
| Stage 4 (Execution JSON) | GENERATED (enriching Steps) |
| Stage 5 (Playwright) | GENERATED (completing artifacts) |
| Review & Edit | GENERATED → UNDER_REVIEW |
| Approval | UNDER_REVIEW → APPROVED → SAVED |

This mapping should be explicit in the architecture.

### 4.6 Gap: Readability optimization representation

**Severity: MEDIUM**

Addressed in §3 (Stage 3b). The B7.1 OR-1 merge rule and B7.2 same-element clarification are frozen responsibilities that must be represented in the pipeline.

---

## 5. AI Placement Validation

### Where AI appears in the proposed architecture

| Stage | AI Role | Placement |
|-------|---------|-----------|
| Stage 1 | Initialize AI Observer (if enabled) | ✅ Correct — AI setup at init time |
| Stage 2 | AI Observer continuously understands journey | ✅ Correct in principle, needs cost refinement |
| Stage 3 | AI hints inform semantic classification | ✅ Correct — aligns with Phase 2 two-phase classification |
| Stage 4 | AI enriches Execution JSON (resilience layer) | ✅ Correct — aligns with Intelligent Automation review |
| Stage 5 | AI does NOT generate Playwright directly | ✅ Correct — deterministic generation preserved |

### AI placement principles

The proposed architecture places AI at exactly the right stages:

1. **AI observes, never modifies (Stage 2).** The AI Observer builds understanding but cannot change the Action Timeline. This prevents the fundamental risk of AI-contaminated recordings.

2. **AI informs, never decides (Stage 3).** AI hints adjust classifier confidence but do not override evidence. The deterministic classifier always has the final word. Without AI, the system works (evidence-only baseline).

3. **AI enriches, never replaces (Stage 4).** AI adds resilience data (locator chains, wait hints, recovery hints) to the Execution JSON. Without AI, the Execution JSON still works (Layer 0 only).

4. **AI never touches automation code (Stage 5).** Playwright generation is deterministic. AI never writes Playwright code. This preserves reproducibility and auditability.

### AI placement verdict

**VALIDATED.** AI is used at the appropriate stages with appropriate constraints. No changes needed to the AI placement model. The refinements (cost model, two-phase classification) are implementation constraints on the existing placement, not changes to placement itself.

---

## 6. Mental Model as a Separate Architectural Component

### What the Mental Model is

The proposed Mental Model is a live, evolving understanding during recording:
- Current application
- Current feature
- Current workflow
- Current screen
- Current UI component
- Possible user intent
- Confidence

### Is it a separate architectural component?

**YES — and it should remain separate.** The Mental Model is distinct from:
- The Action Timeline (factual record of actions — immutable)
- The Application Context (environmental metadata — page URL, title)
- The Evidence Store (raw DOM evidence — transient)

The Mental Model is a **derived understanding** built by the AI Observer from observing the recording session. It is NOT raw data — it is interpretation.

### Mental Model lifecycle

| Phase | State | Zone |
|-------|-------|------|
| During recording (Stage 2) | Continuously updated by AI Observer | Transient |
| At Stop Recording | Consumed by Stage 3 (Semantic Classification) | Transient → consumed |
| After Stage 3 | **Discarded** — its knowledge is embedded in semantic interactions | N/A |
| On Test Case | Not stored as a separate artifact | N/A |

**Key decision:** The Mental Model is **transient.** It does NOT become a permanent Test Case artifact. It is consumed by Stage 3 and then discarded. Its insights live on through the semantic interactions and AI enrichment it informed.

This aligns with:
- PA6 (Transient ≠ Permanent) — the Mental Model is transient
- PA §1.2 — the Mental Model is NOT in the permanent object inventory
- The frozen object hierarchy — no "Mental Model" object exists on the Test Case

### Why it must be separate

If the Mental Model were embedded in the Recorder or the Action Timeline:
- It would contaminate the factual record (violates B3 immutability)
- It would be immutable once recorded (preventing refinement)
- It would couple recording mechanics with AI understanding

By keeping it separate:
- The Recorder remains pure (captures facts only)
- The AI Observer can continuously refine its understanding
- Stage 3 can use the Mental Model as one input among several
- If AI is unavailable, the Mental Model is empty and Stage 3 works from evidence alone

### Mental Model verdict

**VALIDATED as a separate architectural component.** The Mental Model must:
1. Remain separate from the Action Timeline and Evidence Store
2. Be transient (not a permanent Test Case artifact)
3. Be optional (system works without it — evidence-only classification)
4. Be consumed by Stage 3 and then discarded
5. Never modify the recorded actions

---

## 7. Separation of Recording, Semantic Understanding, Execution Planning, and Automation Generation

### 7.1 Separation assessment

| Boundary | Clean? | Rationale |
|----------|--------|-----------|
| Recording → Semantic Understanding | ✅ | Action Timeline is immutable; Stage 3 reads it but cannot modify it |
| Semantic Understanding → Execution Planning | ✅ | Canonical Steps are the source of truth; Execution JSON derives from them |
| Execution Planning → Automation Generation | ✅ | Execution JSON is the input; Playwright is deterministic output |
| Recording → Execution Planning | ✅ | No shortcut — must go through Semantic Understanding |
| Semantic Understanding → Automation | ✅ | No shortcut — must go through Execution JSON |

### 7.2 Why this separation is correct

1. **Each stage has a different mutability profile.**
   - Recording (Stage 2): captures immutable facts
   - Semantic (Stage 3): derives interpretations (mutable until approval)
   - Execution (Stage 4): derives machine model (always derived, never manually edited)
   - Automation (Stage 5): derives executable code (can be manually overridden)

2. **Each stage has a different AI relationship.**
   - Stage 2: AI observes (builds Mental Model)
   - Stage 3: AI informs (hints to classifier)
   - Stage 4: AI enriches (adds resilience data)
   - Stage 5: AI absent (deterministic generation)

3. **Each stage has a different testability profile.**
   - Stage 2: Requires browser environment (content scripts)
   - Stage 3: Pure function (classifier) + deterministic transform (step generator)
   - Stage 4: Pure function (locator resolution + JSON construction)
   - Stage 5: Pure function (JSON → Playwright code string)

4. **Each stage has a different failure mode.**
   - Stage 2 failure: Missing interactions (detection gap)
   - Stage 3 failure: Misclassification (wrong interaction type)
   - Stage 4 failure: Bad locators (wrong element targeting)
   - Stage 5 failure: Invalid Playwright syntax (generation bug)

### 7.3 Coupling assessment

| Stage Pair | Coupling Level | Contract |
|------------|---------------|----------|
| Stage 2 → Stage 3 | LOW | Action Timeline (typed SessionEvent[]) |
| Stage 3 → Stage 4 | LOW | Canonical Test Steps (TestStep[] with executionJson) |
| Stage 4 → Stage 5 | LOW | Execution JSON (ExecutionJsonObject per step) |
| Stage 1 → Stage 2 | MEDIUM | Recording Session state (shared lifecycle) |
| AI Observer → Stage 3 | LOW | Mental Model (optional input) |

The coupling is LOW between all data-processing stages. The only MEDIUM coupling is between Stage 1 and Stage 2 (shared session lifecycle), which is inherent and correct.

### 7.4 Separation verdict

**VALIDATED.** The separation is clean, well-motivated, and consistent with every frozen architectural principle. Each stage has distinct mutability, AI relationship, testability, and failure mode profiles.

---

## 8. Scalability for Future Interaction Types

### Proposed future interaction types to evaluate

| Type | Complexity | Where It Fits |
|------|-----------|---------------|
| Date Pickers | ✅ Implemented (C6) | Stage 2 (recording) + Stage 3 (classification) |
| Dropdowns | ✅ Implemented (C5) | Stage 2 + Stage 3 |
| Hover Menus | ✅ Implemented (C3) | Stage 2 + Stage 3 |
| Drag & Drop | Spec exists (`.drytis/specs/drag-drop.md`) | Stage 2 (new evidence patterns) + Stage 3 (new classifier rule) + Stage 4 (new action verb) + Stage 5 (new Playwright mapping) |
| File Uploads | Spec exists (`.drytis/specs/file-transfer.md`) | Stage 2 (new event type) + Stage 3 (new type) + Stage 4 (new verb) + Stage 5 (new mapping) |
| Rich Text Editors | Not yet scoped | Stage 2 (contentEditable detection) + Stage 3 (new type) — significant complexity |
| Canvas | Not yet scoped | Stage 2 (coordinate tracking) + Stage 3 (new type) — very high complexity |
| Maps | Not yet scoped | Stage 2 (map interaction API) + Stage 3 (new type) — very high complexity |

### How the architecture accommodates each

**The key test:** Does adding a new interaction type require modifying any stage's architecture?

For all types above:

1. **Stage 2 (Recording):** Add new evidence patterns to the Evidence Collector (or new content script in current architecture). **No architectural change** — the stage already supports capturing arbitrary events.

2. **Stage 3a (Classification):** Add new classifier rules. **No architectural change** — rules are additive (Phase 2 §8).

3. **Stage 3b (Canonical Steps):** Add new interaction type config to the registry (`toPlainEnglish`, `executionExtras`). **No architectural change** — the registry is designed for extension (PA9).

4. **Stage 4 (Execution JSON):** Add new action verb to `mapActionType`. **No architectural change** — verb mapping is a lookup table.

5. **Stage 5 (Automation):** Add new Playwright code template. **No architectural change** — `translateAction` is a switch statement.

### Scalability verdict

**VALIDATED.** The five-stage architecture scales to all listed future interaction types without architectural change. Each new type requires additive work in each stage (new evidence, new rules, new registry config, new verb, new template) but no stage's architecture, contract, or boundary changes.

This is consistent with PA9 (Additive Extensibility) and the frozen Product Architecture §9.1: "A new interaction type adds one content script + one registry config."

---

## 9. Multi-Engine Support

### Current: Playwright only

The frozen architecture has one automation engine: Playwright (PA8, B6). The Execution JSON is framework-agnostic.

### Future engines

| Engine | Derivation Source | Architecture Impact |
|--------|------------------|---------------------|
| Playwright | Execution JSON → `playwright-generator.ts` | Current (exists) |
| Cypress | Execution JSON → `cypress-generator.ts` (future) | New generator, additive |
| Selenium | Execution JSON → `selenium-generator.ts` (future) | New generator, additive |
| Cucumber | Canonical Steps → `cucumber-generator.ts` (future) | Reads Steps directly (BDD format) |
| CmdRunner Runtime | Execution JSON (all layers) → runtime executor (future) | Reads Layers 0–4 |

### How Stage 5 supports multiple engines

Stage 5 is defined as "Deterministic Automation Generation" with Playwright as today's engine. The architecture naturally extends:

```
Execution JSON (Layer 0 + optional Layers 1-4)
  │
  ├──→ Playwright Generator (Layer 0 + 1)     ← EXISTS
  ├──→ Cypress Generator (Layer 0)             ← FUTURE
  ├──→ Selenium Generator (Layer 0)            ← FUTURE
  └──→ CmdRunner Runtime (Layer 0 + 1 + 4)    ← FUTURE
```

Each engine:
- Reads the Execution JSON (Layers 0+, as many as it supports)
- Produces its own code format
- Is a **new consumer** of the same source of truth (PA8)
- Does not modify the Execution JSON or Canonical Steps

### Multi-engine verdict

**VALIDATED.** The architecture naturally supports multiple automation engines. Each engine is a new generator reading the same Execution JSON. No architectural change required. This is fully consistent with PA8, PA9, and the frozen Product Architecture §9.1 (New Export Formats).

---

## 10. Recommended Improvements

### Improvement 1: Split Stage 3 into Classification + Canonical Step Generation

**Impact: HIGH**

Split Stage 3 into:
- **3a — Semantic Classification:** Determines interaction types from evidence + AI hints → typed Interaction Timeline
- **3b — Canonical Test Step Generation:** Transforms typed Timeline into human-readable, numbered, optimized Canonical Test Steps

This preserves the frozen distinction between Timeline (factual) and Steps (interpreted) and ensures B7.1–B7.2 readability optimization has a home.

### Improvement 2: Mark the Transient → Permanent boundary explicitly

**Impact: HIGH**

Add an explicit boundary marker in the architecture between Stage 3a (Transient Zone) and Stage 3b (Permanent Zone). At Stop Recording:
- The Interaction Timeline crosses into the Permanent Zone (attached to Test Case)
- The Recording Session, Evidence Store, and Mental Model are discarded
- All subsequent stages operate on Test Case artifacts

### Improvement 3: Define the Mental Model as transient and consumed

**Impact: MEDIUM**

Explicitly state:
- The Mental Model is transient (exists during recording only)
- It is consumed by Stage 3 and then discarded
- It never becomes a permanent Test Case artifact
- It is optional (system works without it)

### Improvement 4: Scope the AI Observer cost model

**Impact: HIGH**

Explicitly state:
- AI is invoked **per captured interaction** (not continuously)
- DOM observation (MutationObserver, navigation) is **deterministic evidence collection**, not AI
- The AI Observer tracks application state continuously (no AI cost) but invokes AI only when new interactions are committed
- Maximum AI latency budget per interaction: 2 seconds (async, non-blocking)

### Improvement 5: Reference the Layered Execution Plan for Stage 4

**Impact: LOW**

Stage 4 should explicitly reference the Option D Layered Execution Plan model with Layer 0 (frozen B5.2 core) as mandatory and Layers 1–4 as optional, incremental additions validated by execution experience.

### Improvement 6: Include Test Case lifecycle mapping

**Impact: MEDIUM**

Map each stage to the frozen Test Case lifecycle (DRAFT → RECORDING → RECORDED → GENERATED → UNDER_REVIEW → APPROVED → SAVED). This connects the pipeline stages to the product lifecycle.

### Improvement 7: Acknowledge MV3 service worker lifecycle

**Impact: MEDIUM**

State that all session state (Recording Session, Action Timeline, Mental Model) must survive service worker termination by being persisted to `chrome.storage.local`. Session rehydration on restart is transparent.

### Improvement 8: Define evidence hierarchy

**Impact: LOW**

Clarify the evidence hierarchy:
1. **Raw Evidence** (transient): DOM snapshots, value before/after, mutation records — consumed by Stage 3, then discarded
2. **Screenshots** (permanent): Visual evidence attached to Test Case
3. **Mental Model** (transient): AI-derived understanding — consumed by Stage 3, then discarded

---

## 11. Corrected Architecture Diagram

```
User Creates Test Case (DRAFT)
  │  Enters: Project, Feature, Scenario, Name, Expected Result
  │
  ▼
User Clicks "Start Recording"
  │
  ▼
══════════════════════════════════════════════════════════════
STAGE 1 — RECORDING SESSION INITIALIZATION          [TRANSIENT]
══════════════════════════════════════════════════════════════
  │
  │  • Bind Recording Session to Test Case
  │  • TC lifecycle: DRAFT → RECORDING
  │  • Initialize browser listeners (content scripts)
  │  • Initialize Evidence Collector (unified or legacy)
  │  • Capture Recording Context (startUrl, startTitle, capturedAt)
  │  • Initialize AI Observer (if enabled)
  │  • Initialize empty Action Timeline
  │  • Initialize empty Mental Model
  │  • All state persisted to chrome.storage.local (MV3-safe)
  │
  ▼
══════════════════════════════════════════════════════════════
STAGE 2 — INTELLIGENT OBSERVATION                   [TRANSIENT]
══════════════════════════════════════════════════════════════
  │
  │  ┌─────────────────────────────────────────────────────┐
  │  │  RECORDER (captures facts)                          │
  │  │                                                     │
  │  │  Captures ALL observed user actions:                │
  │  │  Click, Text Entry, Hover, Checkbox, Radio,         │
  │  │  Select, DateSelect, Navigation                     │
  │  │  (Future: Drag, Drop, File Upload, Scroll, etc.)    │
  │  │                                                     │
  │  │  Principle: Preserve exactly what happened          │
  │  │  No merging, no transformation, no classification   │
  │  │  Raw events captured with full DOM context          │
  │  └─────────────────────┬───────────────────────────────┘
  │                        │
  │  ┌─────────────────────┴───────────────────────────────┐
  │  │  AI OBSERVER (builds understanding)                 │
  │  │                                                     │
  │  │  Continuously tracks (deterministic, no AI cost):   │
  │  │  • Current page, feature, workflow                  │
  │  │  • DOM mutations (menus, dialogs, calendars)        │
  │  │  • Application behaviour changes                    │
  │  │                                                     │
  │  │  Per-interaction (async, non-blocking):             │
  │  │  • Infers user intent                              │
  │  │  • Builds Mental Model                              │
  │  │  • Never modifies the Action Timeline               │
  │  └─────────────────────┬───────────────────────────────┘
  │                        │
  │  ┌─────────────────────┴───────────────────────────────┐
  │  │  EVIDENCE STORE (transient)                         │
  │  │                                                     │
  │  │  • Value before/after snapshots                     │
  │  │  • State transition records                         │
  │  │  • CSS class change diffs                           │
  │  │  • DOM mutation summaries                           │
  │  │  • Screenshots (permanent — cross boundary)         │
  │  └─────────────────────────────────────────────────────┘
  │
  ▼
User Clicks "Stop Recording"
  │
  ════════════════════════════════════════════════════════════
  ╳  TRANSIENT → PERMANENT BOUNDARY                         ╳
  ════════════════════════════════════════════════════════════
  │
  │  Crosses into Permanent Zone:
  │    • Interaction Timeline (typed events)
  │    • Recording Context (startUrl, startTitle, capturedAt)
  │    • Screenshots
  │
  │  Discarded (Transient):
  │    • Recording Session
  │    • Evidence Store (raw evidence)
  │    • Mental Model (consumed by Stage 3a)
  │    • Live event buffer
  │
  │  TC lifecycle: RECORDING → RECORDED
  │
  ▼
══════════════════════════════════════════════════════════════
STAGE 3a — SEMANTIC CLASSIFICATION                  [PERMANENT]
══════════════════════════════════════════════════════════════
  │
  │  Input:
  │    • Action Timeline (raw observed actions)
  │    • Mental Model (AI understanding, if available)
  │    • Evidence Store (value changes, state changes, DOM context)
  │
  │  Process:
  │    • Snapshot Coalescer groups related events
  │      (e.g., mousedown + click + change → one interaction)
  │    • Semantic Classifier applies ordered priority rules
  │      (Phase 2 §8: 14 rules, highest specificity first)
  │    • AI hints inform ambiguous classifications (optional)
  │
  │  Output:
  │    • Typed Interaction Timeline
  │      (each interaction has: type, elementIdentity, value, timestamp)
  │    • Types: click, text, hover, checkbox, radio, select, dateSelect, navigation
  │
  │  Principle: Semantic interactions are DERIVED, not recorded
  │  Original raw actions always remain available
  │
  ▼
══════════════════════════════════════════════════════════════
STAGE 3b — CANONICAL TEST STEP GENERATION           [PERMANENT]
══════════════════════════════════════════════════════════════
  │
  │  Input:
  │    • Typed Interaction Timeline
  │
  │  Process:
  │    • Map each interaction to plain English (interaction type registry)
  │    • Apply readability optimization (B7.1 OR-1: merge focus+click+text)
  │    • Assign step numbers
  │    • Link steps to source interactions (linkedInteractionId)
  │    • Apply AI enrichment (businessName, controlType, userIntent)
  │
  │  Output:
  │    • Canonical Test Steps
  │      (each step: stepNumber, plainEnglish, actionType,
  │       elementIdentity, aiEnrichment, linkedInteractionId)
  │
  │  TC lifecycle: RECORDED → GENERATED
  │
  │  Principle: Canonical Steps = single source of truth (PA4)
  │
  ▼
══════════════════════════════════════════════════════════════
STAGE 4 — CMDRUNNER EXECUTION JSON GENERATION       [PERMANENT]
══════════════════════════════════════════════════════════════
  │
  │  Input:
  │    • Canonical Test Steps
  │    • (Optional) Mental Model workflow context
  │    • (Optional) AI enrichment data
  │
  │  Process:
  │    4a — Core JSON (always runs, deterministic):
  │      • Locator Resolution Engine (B4.4 priority chain)
  │      • mapActionType (click→click, text→fill, select→select, etc.)
  │      • Construct Layer 0 CORE (6 frozen B5.2 sections)
  │
  │    4b — AI Enrichment Layer (optional, additive):
  │      • Rank locators → locatorChain (Layer 1 RESILIENCE)
  │      • Infer wait hints → waitStrategy (Layer 1)
  │      • Generate recovery data → recoveryHints (Layer 1)
  │      • Add workflow context → intent, stepGroup (Layer 3, future)
  │
  │  Output:
  │    • Execution JSON (Layer 0 mandatory, Layers 1-4 optional)
  │      Each step's executionJson is now populated
  │
  │  Principle: Execution JSON = framework-agnostic execution plan
  │  Without AI: Layer 0 only (current behavior)
  │  With AI: Layer 0 + Layer 1 (enhanced resilience)
  │
  ▼
══════════════════════════════════════════════════════════════
STAGE 5 — DETERMINISTIC AUTOMATION GENERATION       [PERMANENT]
══════════════════════════════════════════════════════════════
  │
  │  Input:
  │    • Canonical Test Steps (with Execution JSON populated)
  │
  │  Process:
  │    • translateAction: action verb → Playwright API call
  │    • translateLocator: locator strategy → Playwright locator
  │    • Generate one test() per Test Case
  │    • Include: navigation, actions, optional assertions
  │    • AI does NOT participate in code generation
  │
  │  Output:
  │    • Generated Playwright Test (TypeScript string)
  │    • (Future: Cypress, Selenium, Cucumber from same Execution JSON)
  │
  │  Principle: Deterministic generation from Execution JSON
  │  AI never directly generates automation code
  │
  ▼
══════════════════════════════════════════════════════════════
REVIEW & EDIT → APPROVE → SAVE TO REPOSITORY         [PERMANENT]
══════════════════════════════════════════════════════════════
  │
  │  TC lifecycle: GENERATED → UNDER_REVIEW → APPROVED → SAVED
  │  All artifacts frozen at APPROVED (PA7)
  │  Repository holds canonical version (PA11)
  │
  ▼
COMPLETE
```

---

## 12. Consistency Review Against All Frozen Milestones

### 12.1 Product Foundation Design v1.0

| Frozen Decision | Architecture Alignment | Verdict |
|-----------------|----------------------|---------|
| Test Case is the atomic unit | All stages operate within Test Case context | ✅ |
| Complete user journey (Create → Record → Review → Approve → Save) | Five stages map to this journey | ✅ |
| Recording is temporary; Test Case is permanent | Transient → Permanent boundary at Stop Recording | ✅ |
| Three representations (Timeline, Steps+JSON, Playwright) | Stages 3a, 3b+4, 5 produce these | ✅ |
| User can delete steps, edit English, edit Playwright | Review phase (post-Stage 5) | ✅ |

### 12.2 Product Architecture Design v1.0

| Frozen Decision | Architecture Alignment | Verdict |
|-----------------|----------------------|---------|
| PA1 — Test Case Centricity | All stages produce Test Case artifacts | ✅ |
| PA2 — Single Responsibility | Each stage has one responsibility | ✅ |
| PA3 — Single Ownership | Each artifact has one owner (Test Case) | ✅ |
| PA4 — Canonical Source of Truth | Steps + JSON = source of truth (Stage 3b + 4) | ✅ |
| PA5 — Derivation Is One-Way | Data flows forward through stages | ✅ |
| PA6 — Transient ≠ Permanent | Explicit boundary at Stop Recording | ✅ |
| PA7 — Approval Is the Freeze Point | Post-Stage 5 review → approval | ✅ |
| PA8 — Framework Agnosticism | Stage 4 is agnostic; Stage 5 is one engine | ✅ |
| PA9 — Additive Extensibility | New types = additive work in each stage | ✅ |
| PA10 — Minimal Coupling | LOW coupling between all stages | ✅ |
| PA11 — Repository Authority | Repository is post-approval store | ✅ |
| PA12 — Containment Hierarchy | Test Case within Scenario within Feature within Project | ✅ |
| §9.1 — New interaction types = additive | Validated in §8 of this document | ✅ |
| §9.1 — New export formats = additive | Validated in §9 of this document | ✅ |
| Object inventory — no "Mental Model" as permanent object | Mental Model is transient, not in inventory | ✅ |

### 12.3 B1–B8 (Artifact Generation Pipeline)

| Frozen Decision | Architecture Alignment | Verdict |
|-----------------|----------------------|---------|
| B1 — Generation order: Timeline → Steps → JSON → Playwright | Stages 3a → 3b → 4 → 5 | ✅ |
| B3 — Timeline immutability | Stage 2 preserves facts; Stage 3a derives types | ✅ |
| B4.1–B4.5 — Execution model + locator strategy | Stage 4 applies locator resolution | ✅ |
| B5.2 — Execution JSON 6-section contract | Stage 4 Layer 0 = frozen contract | ✅ |
| B6 — Playwright generator (translateLocator, translateAction) | Stage 5 = unchanged | ✅ |
| B7.1–B7.2 — Readability optimization (OR-1 merge) | Stage 3b = readability pass | ✅ |
| B8 — Validation framework (15 categories, 9 defect codes) | Post-generation validation | ✅ |

### 12.4 C3–C6 (Interaction Type Milestones)

| Frozen Decision | Architecture Alignment | Verdict |
|-----------------|----------------------|---------|
| C3.1 — Hover = dwell + observable behavior | Stage 3a classifier Rule 12 | ✅ |
| C4.1 — Checkbox/Radio = state-based | Stage 3a classifier Rules 5-6 | ✅ |
| C5.1 — Select = meaningful value change | Stage 3a classifier Rules 7-11 | ✅ |
| C6.1 — DateSelect = committed value | Stage 3a classifier Rules 3-4 | ✅ |
| All: 5-Gate decision trees | Become evidence checks in classifier (Phase 2 §8) | ✅ |
| All: Ownership priority over Click | Classifier rule ordering (click is fallback) | ✅ |

### 12.5 Phase 2 — Semantic Interaction Architecture

| Recommendation | Architecture Alignment | Verdict |
|----------------|----------------------|---------|
| Evidence Collector (one unified script) | Stage 2 Recorder | ✅ |
| Snapshot Coalescer | Stage 3a (groups events before classification) | ✅ |
| Semantic Classifier (14 ordered rules) | Stage 3a | ✅ |
| AI as optional input, not mandatory | Stage 3a (Phase 2 refinement, optional) | ✅ |
| Two-phase classification (immediate + AI-refined) | Stage 3a | ✅ |
| Generation pipeline unchanged | Stages 3b–5 | ✅ |
| Migration in 6 phases (M1–M6) | Implementation, not architecture | ✅ |

### 12.6 Execution JSON Evolution Review

| Recommendation | Architecture Alignment | Verdict |
|----------------|----------------------|---------|
| Option D — Layered Execution Plan | Stage 4 explicitly produces Layered JSON | ✅ |
| Layer 0 CORE (frozen B5.2) mandatory | Stage 4a always produces Layer 0 | ✅ |
| Layers 1–4 optional, incremental | Stage 4b adds layers when AI is available | ✅ |
| Multi-engine support (each engine consumes layers) | Stage 5 + future generators | ✅ |

### 12.7 Intelligent Automation Generation Review

| Recommendation | Architecture Alignment | Verdict |
|----------------|----------------------|---------|
| Alternative C — AI-Enriched + Deterministic Playwright | Stage 4b enriches; Stage 5 is deterministic | ✅ |
| AI Enrichment Layer between JSON gen and Playwright gen | Stage 4b | ✅ |
| Playwright generation stays deterministic | Stage 5 | ✅ |
| Executable fallback chains (E0, no AI needed) | Stage 4a (locators already contain fallback data) | ✅ |
| Future: runtime self-healing (E) | Future Layer 4, CmdRunner Runtime | ✅ |

### 12.8 Overall consistency verdict

**ALL FROZEN DECISIONS ARE PRESERVED.** The validated five-stage architecture (with the Stage 3 split refinement) is fully consistent with every frozen milestone, every prior architecture review, and every product principle. No frozen decision is contradicted, modified, or weakened.

---

## 13. Freeze Declaration

The following architectural decisions from this validation are declared **frozen** as the canonical end-to-end architecture reference:

| # | Decision |
|---|----------|
| 1 | The pipeline is five stages: Initialization → Observation → Semantic Classification → Execution JSON → Automation Generation |
| 2 | Stage 3 is split: 3a (Classification) produces typed Timeline; 3b (Canonical Step Generation) produces Steps |
| 3 | The Transient → Permanent boundary occurs at Stop Recording |
| 4 | The Mental Model is a transient architectural component, consumed by Stage 3a and then discarded |
| 5 | The Evidence Store is transient; only Screenshots cross into the Permanent Zone |
| 6 | AI observes but never modifies recorded actions (Stage 2) |
| 7 | AI informs but never overrides deterministic classification (Stage 3a) |
| 8 | AI enriches but never replaces core Execution JSON (Stage 4b) |
| 9 | AI never directly generates automation code (Stage 5) |
| 10 | Stage 4 produces the Layered Execution Plan (Layer 0 mandatory, Layers 1-4 optional) |
| 11 | New interaction types extend each stage additively (no architectural change) |
| 12 | New automation engines read the same Execution JSON (additive generators) |
| 13 | The Interaction Timeline and Canonical Test Steps remain distinct artifacts (PA4) |
| 14 | The generation pipeline (Steps → JSON → Playwright) remains deterministic and AI-free |
| 15 | All session state survives MV3 service worker termination via chrome.storage.local |

---

*This document validates and completes the proposed end-to-end recording and automation pipeline architecture. It is consistent with all frozen milestones (Product Foundation, Product Architecture PA1–PA12, B1–B8, C3–C6, Phase 2, Execution JSON Evolution, Intelligent Automation Generation). No frozen decision is modified.*
