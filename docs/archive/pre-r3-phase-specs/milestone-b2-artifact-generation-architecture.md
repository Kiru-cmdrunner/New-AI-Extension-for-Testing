# Milestone B2 — Post-Recording Artifact Generation Architecture

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Architecture Design (no implementation, no code, no UI)
**Depends on:**
- Product Foundation Design v1.0 (frozen)
- Product Architecture Design v1.0 (frozen)
- Milestone B1 — Post-Recording Artifact Generation Product Design (frozen)
**Predecessor:** Milestone A — Test Case Creation Flow (v4.0.0, frozen)

---

## 0. Purpose

This document defines the **technical architecture** for the Artifact Generation Engine — the system that transforms a completed Interaction Timeline into Canonical Test Steps, CmdRunner Execution JSON, and a Generated Playwright Test.

A future developer should be able to implement the entire engine using only this document, without making new product or architectural decisions.

**This document does not change any frozen product decisions.** It translates them into technical contracts, data flows, and component boundaries.

---

## 1. Current State Assessment

Before designing the target architecture, we must understand the current state — what exists today and what must change.

### 1.1 What Exists Today

The current codebase generates steps **live during recording**, not after Stop. The pipeline is:

```
Content Script → CLICK_CAPTURED → Service Worker → processAction()
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    │                    │                    │
                              addAction()         Screenshot          AI Service
                                    │                                    │
                            Event stored                       buildStep()
                                                                       │
                                                               Step stored
                                                               (live, per-click)
```

This violates B1 Principle P2: *"Artifact generation begins only after recording is complete."*

### 1.2 What Must Change

| Current Behavior | Target Behavior (per B1) | Why |
|---|---|---|
| Steps generated live per-click | Steps generated only after Stop | B1 P2: Generation begins after recording |
| `step-builder.ts` combines steps + execution JSON | Separate generators with clear contracts | B2 §2: One responsibility per generator |
| No Playwright generation | Full Playwright generator | B1 §5: Playwright is the primary export |
| No GENERATING state | GENERATING state with progress | B1 §7: Required for transparency |
| Steps and events co-mingled in session | Timeline is the only input; artifacts are output | B1 P9: Generation never modifies Timeline |
| No regeneration | Full regeneration semantics | B1 §6.5: Defined regeneration rules |
| No failure recovery | Retry, partial success, preserve timeline | B1 §9: Failure never destroys input |

### 1.3 What Does NOT Change

| Component | Why Preserved |
|---|---|
| Content script detection logic (click-content-script.ts) | Detection is separate from generation |
| Element identity extraction | Identity is captured at click time, immutable |
| Recording Session lifecycle | Session produces Timeline; generation consumes it |
| AI understanding service | AI enriches interactions; generation reads enrichment |
| Storage service patterns | Same chrome.storage.local patterns, new keys |
| Interaction type registry | Registry provides per-type configuration to generators |

---

## 2. Generation Pipeline

### 2.1 Pipeline Overview

The generation engine activates when the user clicks Stop Recording. It runs a deterministic, sequential pipeline:

```
User clicks Stop Recording
        │
        ▼
┌─────────────────────────────────┐
│  STOP_RECORDING handler (SW)    │
│  1. session.stop()              │
│  2. Read Interaction Timeline   │
│  3. Read Recording Context      │
│  4. Transition TC → GENERATING  │
│  5. Invoke GenerationEngine     │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  GenerationEngine.generate()    │
│                                 │
│  Input:  Interaction Timeline   │
│          Recording Context      │
│          TestCaseDraft          │
│                                 │
│  ┌───────────────────────────┐  │
│  │ 1. CanonicalStepGenerator │  │
│  │    Timeline → Steps[]     │  │
│  └───────────┬───────────────┘  │
│              │                  │
│  ┌───────────▼───────────────┐  │
│  │ 2. ExecutionJsonGenerator │  │
│  │    Steps[] → JSON per step│  │
│  └───────────┬───────────────┘  │
│              │                  │
│  ┌───────────▼───────────────┐  │
│  │ 3. PlaywrightGenerator    │  │
│  │    Steps+JSON → test code │  │
│  └───────────┬───────────────┘  │
│              │                  │
│  Output: Canonical Test Steps   │
│          (with embedded JSON)   │
│          Playwright test string │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Post-Generation                │
│  1. Store artifacts             │
│  2. Transition TC → GENERATED   │
│  3. Transition TC → UNDER_REVIEW│
│  4. Notify side panel           │
└─────────────────────────────────┘
```

### 2.2 Execution Order

The pipeline runs **strictly sequential**. Each generator must complete before the next begins. This is a mandatory constraint because each generator's output is the next generator's input.

| Phase | Generator | Input | Output | Can Start When |
|---|---|---|---|---|
| 1 | Canonical Step Generator | Interaction Timeline + Recording Context | `CanonicalTestStep[]` (plainEnglish, actionType, elementIdentity, aiEnrichment, linkedInteractionId) | Timeline is frozen (Stop pressed) |
| 2 | Execution JSON Generator | `CanonicalTestStep[]` | `CanonicalTestStep[]` with `executionJson` populated per step | Steps array is complete |
| 3 | Playwright Generator | `CanonicalTestStep[]` (with JSON) + TestCaseDraft | `string` (TypeScript test code) | Steps + JSON are complete |

### 2.3 Orchestration

The **GenerationEngine** is the sole orchestrator. It:
- Receives the trigger (Stop Recording)
- Reads the frozen Timeline, Recording Context, and TestCaseDraft from storage
- Invokes each generator in order
- Collects outputs
- Writes all artifacts to storage in a single batch
- Manages state transitions
- Reports progress

No generator calls another generator. No generator writes to storage. Only the engine touches storage and state.

### 2.4 Pipeline Lifecycle

```
GenerationEngine (one per Stop Recording)
        │
        ├── Created when Stop Recording fires
        │
        ├── Runs generation pipeline (synchronous within each generator)
        │
        ├── On success:
        │     Stores all artifacts
        │     Transitions TC: GENERATING → GENERATED → UNDER_REVIEW
        │     Notifies side panel: "artifacts ready"
        │
        ├── On partial failure:
        │     Stores successful artifacts
        │     Marks failed artifacts with error state
        │     Transitions TC: GENERATING → GENERATED (with warnings)
        │     Notifies side panel: "generation complete with warnings"
        │
        ├── On complete failure:
        │     Preserves Timeline
        │     Keeps TC in GENERATING state
        │     Notifies side panel: "generation failed, retry available"
        │
        └── Discarded after generation completes (success or failure)
```

The engine is **transient** — it exists only for the duration of one generation pass. It is not a persistent singleton like the Recording Session. If the user clicks Retry, a new engine instance is created.

---

## 3. Generator Contracts

Each generator has a **published input contract** and **published output contract**. No generator knows anything about the others' internals. They communicate only through artifacts.

### 3.1 Generator Interface

Every generator — present and future — follows the same structural contract:

```
GeneratorContract:
  ├── name: string                    — "canonical-step-generator", etc.
  ├── inputContract: defined type     — what the generator needs
  ├── outputContract: defined type    — what the generator produces
  ├── generate(input): output         — pure function, no side effects
  └── dependencies: string[]          — names of generators that must run first (empty = runs first)
```

### 3.2 Canonical Step Generator

**Name:** `canonical-step-generator`

**Responsibility:** Transform the Interaction Timeline into Canonical Test Steps. One step per interaction. Each step captures plain English, action type, element identity (projection from interaction), AI enrichment (projection from interaction), and a linked interaction ID.

**Input Contract:**
```
CanonicalStepGeneratorInput:
  timeline: SessionEvent[]          — frozen interaction timeline
  recordingContext: RecordingContext — start URL, title, timestamp
```

**Output Contract:**
```
CanonicalStepGeneratorOutput:
  steps: CanonicalStep[]
    where CanonicalStep:
      stepNumber: number
      actionType: string              — "click", "navigation", future types
      plainEnglish: string            — human-readable description
      elementIdentity: ElementIdentity — projected from interaction (immutable)
      aiEnrichment: AIUnderstanding | null — projected from interaction
      linkedInteractionId: string     — actionId from the source interaction
      executionJson: null             — NOT populated by this generator
      timestamp: string               — generation timestamp
```

**Must Never:**
- Generate Execution JSON (that's the JSON Generator's job)
- Generate Playwright code
- Modify the Timeline
- Write to storage
- Call AI services (AI enrichment is already on the timeline events)

**Key Design Decision — Plain English Generation:**

Plain English is generated deterministically from the interaction type's registry configuration. The current `interaction-types.ts` registry already provides `toPlainEnglish()` per type. The Canonical Step Generator delegates to this function.

For click: `Click "${accessibleName}"`.
For navigation: `Navigate to "${url}"`.
Future types will register their own `toPlainEnglish()`.

AI enrichment (businessName, controlType, userIntent, confidence) is already attached to the interaction event during recording. The generator projects it onto the step — it does not call AI again.

**Key Design Decision — Element Identity Projection:**

Element identity is extracted at click time (immutable per Architecture §6.4). The generator copies the identity from the interaction event to the step. No re-extraction, no re-computation. The step's element identity is a read-only copy.

### 3.3 Execution JSON Generator

**Name:** `execution-json-generator`

**Responsibility:** Populate the `executionJson` field on each Canonical Test Step. Derive locator strategy, action semantics, and element metadata from the step's element identity.

**Input Contract:**
```
ExecutionJsonGeneratorInput:
  steps: CanonicalStep[]            — steps with executionJson = null
```

**Output Contract:**
```
ExecutionJsonGeneratorOutput:
  steps: CanonicalStep[]            — same steps, executionJson populated
    where executionJson per step:
      action: string                — action type
      actionId: string              — linked interaction ID
      elementId: string             — linked element ID
      primaryLocator: Locator       — best available locator
      fallbackLocators: Locator[]   — remaining locators in priority order
      tag: string                   — element tag
      accessibleName: string        — accessible name
      ariaRole: string | null
      inIframe: boolean
      shadowDom: boolean
      iframeContext?: IframeContext  — if applicable
```

**Must Never:**
- Modify plain English
- Modify action type
- Modify element identity
- Generate Playwright code
- Write to storage

**Key Design Decision — Locator Resolution:**

Locator resolution is deterministic. The current `buildLocators()` function in `step-builder.ts` already implements the priority order:

```
1. testId (data-testid)
2. data-cy
3. data-qa
4. id
5. aria-label
6. name attribute
7. CSS selector
8. XPath
```

The JSON Generator delegates locator resolution to a **Locator Resolution Engine** — a capability currently implemented by the `buildLocators()` function. The architecture describes this as a capability, not a specific function, so that the implementation can evolve independently (e.g., adding CSS-grid-aware selectors or AI-suggested locators) without changing the JSON Generator's contract. The first available locator becomes `primaryLocator`; the rest become `fallbackLocators`.

**Key Design Decision — Navigation Steps:**

Navigation interactions have no element identity in the traditional sense. The JSON Generator produces a synthetic locator for navigation steps:

```
action: "navigation"
primaryLocator: { type: "css", value: "body" }
```

The Playwright Generator recognizes `action: "navigation"` and translates it to `page.waitForURL()` instead of `page.click()`.

### 3.4 Playwright Generator

**Name:** `playwright-generator`

**Responsibility:** Generate one complete TypeScript Playwright test file from the Canonical Test Steps (with Execution JSON populated) and the Test Case metadata.

**Input Contract:**
```
PlaywrightGeneratorInput:
  steps: CanonicalStep[]            — steps with executionJson populated
  recordingContext: RecordingContext — becomes page.goto()
  testCaseName: string              — becomes test() name
  expectedResult?: string           — becomes assertion (commented if empty)
```

**Output Contract:**
```
PlaywrightGeneratorOutput:
  testCode: string                  — complete TypeScript Playwright test
  isManualEdit: false               — always false on fresh generation
  generatedAt: string               — ISO timestamp
```

**Must Never:**
- Modify Canonical Test Steps
- Modify Execution JSON
- Read the Interaction Timeline directly
- Write to storage

**Key Design Decision — Action Mapping:**

The Playwright Generator maps each step's `executionJson.action` to Playwright API calls:

| Execution JSON Action | Playwright Code |
|---|---|
| `click` | `await page.click('${locator}');` |
| `navigation` | `await page.waitForURL('**${urlPattern}');` |
| `text_entry` (future) | `await page.fill('${locator}', '${value}');` |
| `select` (future) | `await page.selectOption('${locator}', '${value}');` |

The generator does not invent actions. It only maps known actions. If it encounters an unknown action type, it generates a comment: `// Unknown action: ${action}`.

**Key Design Decision — Locator Translation:**

The generator translates locator types to Playwright selector syntax:

| Locator Type | Playwright Selector |
|---|---|
| `testId` | `[data-testid="${value}"]` (or data-cy / data-qa) |
| `id` | `#${value}` |
| `ariaLabel` | `[aria-label="${value}"]` |
| `name` | `[name="${value}"]` |
| `css` | `${value}` (used directly) |
| `xpath` | `xpath=${value}` |
| `text` | `text="${value}"` |

The generator uses `primaryLocator`. If the primary locator is unavailable (empty), it falls back to the first available fallback locator. If no locators exist, it generates: `// WARNING: No locator for this step — manual fix required`.

**Key Design Decision — Test Structure:**

```
import { test, expect } from '@playwright/test';

test('${testCaseName}', async ({ page }) => {
  // Recording Context: Started on ${startUrl}
  await page.goto('${startUrl}');

  // Step 1: ${plainEnglish}
  await page.click('${locator}');

  // Step 2: ${plainEnglish}
  await page.waitForURL('**${urlPattern}');

  // ... one block per step ...

  // Expected Result
  // ${expectedResult as comment, or assertion if structured}
});
```

- Test name from `testCaseName`.
- First line is always `page.goto()` from Recording Context.
- One comment + one action per step.
- Comments mirror plain English.
- Expected Result appended as a comment (or assertion if provided).

---

## 4. Component Interaction Diagram

### 4.1 High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     SERVICE WORKER                              │
│                                                                │
│  ┌──────────────────┐    ┌─────────────────────────────────┐  │
│  │ Recording Session │    │     Generation Engine           │  │
│  │                   │    │  (transient, created on Stop)   │  │
│  │ • Captures events │    │                                 │  │
│  │ • Manages timeline│    │  ┌───────────────────────────┐  │  │
│  │ • Lives during     │    │  │ GenerationEngine.generate│  │  │
│  │   recording only   │    │  │                          │  │  │
│  │                   │    │  │ 1. Read Timeline          │  │  │
│  └────────┬──────────┘    │  │ 2. Read Context           │  │  │
│           │               │  │ 3. Read TestCaseDraft     │  │  │
│           │ Stop          │  │                           │  │  │
│           ▼               │  │ ▼ ──── Step Gen ────── ▼  │  │  │
│  ┌────────────────────┐  │  │ ▼ ──── JSON Gen ────── ▼  │  │  │
│  │  Storage Service   │  │  │ ▼ ──── PW Gen ──────── ▼  │  │  │
│  │                    │◄──┤  │                           │  │  │
│  │ • Session events   │  │  │ 4. Write all artifacts    │  │  │
│  │ • Recording context│  │  │ 5. Transition state       │  │  │
│  │ • Test case draft  │  │  └───────────────────────────┘  │  │
│  │ • Generated steps  │  │                                 │  │
│  │ • Playwright code  │  │  Generators (pure functions):   │  │
│  │ • Screenshots      │  │  ┌─────────────────────────┐   │  │
│  │                    │  │  │ CanonicalStepGenerator  │   │  │
│  └────────────────────┘  │  │ ExecutionJsonGenerator  │   │  │
│                          │  │ PlaywrightGenerator     │   │  │
│                          │  └─────────────────────────┘   │  │
│                          └─────────────────────────────────┘  │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  Message Router                                        │   │
│  │  • START_RECORDING → session.start()                   │   │
│  │  • STOP_RECORDING  → session.stop() + engine.generate()│   │
│  │  • CLICK_CAPTURED  → session.addAction() (during rec)  │   │
│  │  • GENERATION_FAILED_RETRY → engine.generate()         │   │
│  └────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
          ▲                                        ▲
          │ messages                               │ storage events
          │                                        │ (onKeyChanged)
┌─────────┴────────────────┐    ┌──────────────────┴────────────┐
│    SIDE PANEL             │    │   CONTENT SCRIPTS              │
│                           │    │                                │
│ • Home view               │    │ • click-content-script.ts      │
│ • New TC view             │    │   (detection only — no change) │
│ • Recording view          │    │                                │
│ • Review view (new)       │    └────────────────────────────────┘
│   - Timeline (read-only)  │
│   - Steps (editable)      │
│   - Playwright (editable) │
│ • State display           │
└───────────────────────────┘
```

### 4.2 Data Flow — Generation

```
                    ┌──────────────┐
                    │ Session      │
                    │ Events[]     │──┐
                    │ (frozen)     │  │
                    └──────────────┘  │
                                     │
                    ┌──────────────┐  │
                    │ Recording    │  │
                    │ Context      │──┤
                    └──────────────┘  │
                                     │  read-only
                    ┌──────────────┐  │
                    │ TestCase     │  │
                    │ Draft        │──┤
                    └──────────────┘  │
                                     │
                                     ▼
                    ┌──────────────────────────────────┐
                    │     GenerationEngine             │
                    │     .generate()                  │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │  CanonicalStepGenerator          │
                    │  Input: Timeline + Context       │
                    │  Output: CanonicalStep[]         │
                    │         (executionJson = null)   │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │  ExecutionJsonGenerator          │
                    │  Input: CanonicalStep[]          │
                    │  Output: CanonicalStep[]         │
                    │         (executionJson populated)│
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │  PlaywrightGenerator             │
                    │  Input: Steps+JSON, Context, TC  │
                    │  Output: testCode string         │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │  Storage Service                 │
                    │  Write: Steps, Playwright code   │
                    │  Transition TC state             │
                    └──────────────────────────────────┘
```

### 4.3 Data Flow — Regeneration

```
                    ┌──────────────────────────────────┐
                    │  Trigger: User edits a step      │
                    │  (structural change: delete,     │
                    │   action change, target change)  │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │  GenerationEngine.regenerate()   │
                    │  Reads CURRENT Steps from storage│
                    └──────────────┬───────────────────┘
                                   │
                          ┌────────┴────────┐
                          │                 │
                plain English only?   structural change?
                          │                 │
                  ┌───────▼───────┐  ┌─────▼──────────────┐
                  │ STOP.          │  │ ExecutionJsonGen   │
                  │ No regeneration│  │ regenerates JSON   │
                  │ needed.        │  └─────┬──────────────┘
                  └───────────────┘        │
                                  ┌────────▼───────────────┐
                                  │ isManualEdit?          │
                                  │ YES → prompt user      │
                                  │ NO  → PlaywrightGen    │
                                  │       regenerates      │
                                  └────────────────────────┘
```

---

## 5. Artifact Dependency Graph

### 5.1 Strict Dependency Rules

```
                    ┌─────────────────────┐
                    │ Interaction Timeline │
                    │ (immutable input)    │
                    └──────────┬──────────┘
                               │
                               │ 1:N transform
                               ▼
                    ┌─────────────────────┐
                    │ Canonical Test Steps │
                    │ (source of truth)    │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    │ 1:1 embedded        │ derived
                    ▼                     ▼
          ┌─────────────────┐   ┌──────────────────────┐
          │ Execution JSON  │   │ Generated Playwright │
          │ (per-step       │   │ Test                 │
          │  property)      │   │ (one test() string)  │
          └─────────────────┘   └──────────────────────┘
                                        │
                               ┌────────┼────────┐
                               │        │        │
                          ┌────▼───┐ ┌──▼───┐ ┌──▼─────┐
                          │Cypress │ │Sel.  │ │Cucumber│
                          │(future)│ │(fut.)│ │(future)│
                          └────────┘ └──────┘ └────────┘
```

### 5.2 Direction of Data Flow

**Data flows in one direction only — from raw input toward derived output.**

- Timeline → Steps: forward ✓
- Steps → JSON: forward ✓
- Steps → Playwright: forward ✓
- Playwright → Steps: **FORBIDDEN** ✗
- Steps → Timeline: **FORBIDDEN** ✗
- JSON → Steps: **FORBIDDEN** ✗

No reverse derivation. No feedback loops. The chain is acyclic.

### 5.3 Ownership

| Artifact | Produced By | Owned By (Storage) | Modifiable By |
|---|---|---|---|
| Interaction Timeline | Recording Session | Storage Service (SESSION_EVENTS) | Delete only (side panel review) |
| Recording Context | Recording Session | Storage Service (SESSION_CONTEXT) | Nobody (immutable) |
| Canonical Test Steps | Canonical Step Generator | Storage Service (GENERATED_STEPS) | Side panel (plain English edits) |
| Execution JSON | Execution JSON Generator | Embedded in Steps (GENERATED_STEPS) | JSON Generator only (never manual) |
| Playwright Test | Playwright Generator | Storage Service (PLAYWRIGHT_CODE) | Side panel (full code edit, sets isManualEdit) |

### 5.4 What Each Generator Reads vs Writes

| Generator | Reads | Writes |
|---|---|---|
| Canonical Step Generator | Timeline, Recording Context | Steps (in-memory output, engine writes to storage) |
| Execution JSON Generator | Steps (from previous generator output) | Steps (adds JSON fields, in-memory) |
| Playwright Generator | Steps + JSON, Recording Context, TestCaseDraft | Playwright test string (in-memory output) |

**Critical:** No generator writes to storage directly. The GenerationEngine collects all outputs and writes them in a single batch at the end. This prevents partial persisted state if a generator fails mid-pipeline.

---

## 6. Regeneration Architecture

### 6.1 Regeneration Triggers

Per B1 §6.5–6.6, the following triggers exist:

| # | Trigger | What Regenerates | Prompt? |
|---|---|---|---|
| T1 | Edit plain English on a Step | Nothing | No |
| T2 | Delete interaction from Timeline | Corresponding Step removed; JSON for remaining steps unchanged; Playwright regenerated | Only if `isManualEdit` |
| T3 | Step structural change (action/target) | Execution JSON for that step; Playwright | Only if `isManualEdit` |
| T4 | Edit Playwright code directly | Nothing; `isManualEdit = true` | No |
| T5 | "Regenerate Steps" button | Steps re-derived from Timeline (plain English edits lost); JSON regenerated; Playwright regenerated | Warns: discards plain English |
| T6 | "Regenerate Playwright" button | Playwright re-derived from current Steps | Warns if `isManualEdit` |

### 6.2 Regeneration Engine

The GenerationEngine exposes two methods:

```
GenerationEngine:
  generate(input): full pipeline from Timeline
  regenerate(scope: "steps" | "json" | "playwright", input): partial pipeline
```

**`regenerate("json")`** — Re-runs the Execution JSON Generator on current Steps. Useful if a step was structurally edited (T3) and JSON needs updating.

**`regenerate("playwright")`** — Re-runs the Playwright Generator on current Steps + JSON. Checks `isManualEdit` first:
- If `false`: regenerates silently.
- If `true`: returns a "confirmation required" signal. The caller (side panel) prompts the user. Only regenerates after user confirms.

**`regenerate("steps")`** — Re-runs the full pipeline from Timeline (T5). This is the most destructive: it discards all plain English edits and re-derives Steps from raw Timeline.

### 6.3 Dependency Propagation

When a Step changes structurally (T3), the propagation is:

```
Step edited (action/target changed)
    │
    ├──▶ Execution JSON Generator: regenerate JSON for this step
    │
    └──▶ Check isManualEdit
              │
         false│           true│
              ▼               ▼
         Regenerate PW   Prompt user:
         (silent)        "Overwrite edits?"
                              │
                         user confirms?
                              │
                         yes──▼──no
                         Regen PW  Keep manual code
```

### 6.4 Idempotency Guarantee

Every generator is a **pure function** of its input:

- `canonicalStepGenerator(timeline)` → same timeline → same steps (always)
- `executionJsonGenerator(steps)` → same steps → same JSON (always)
- `playwrightGenerator(steps, context, draft)` → same inputs → same test code (always)

No generator reads external state, current time (beyond the timestamp field), or random values. The only non-deterministic field is `timestamp`, which changes per generation but does not affect the logical content.

Pressing Regenerate 3 times on unchanged input produces 3 identical outputs (modulo timestamp).

### 6.5 Regeneration Ownership

| Operation | Owner | Who Calls |
|---|---|---|
| Full generation (after Stop) | GenerationEngine | Service Worker (STOP_RECORDING handler) |
| Regenerate Steps | GenerationEngine | Side panel (Regenerate button) |
| Regenerate JSON | GenerationEngine | GenerationEngine (automatic on step structural change) |
| Regenerate Playwright | GenerationEngine | Side panel (Regenerate button) or automatic (on step change if !isManualEdit) |
| Edit plain English | Side panel | User (no engine involvement) |
| Edit Playwright code | Side panel | User (sets isManualEdit, no engine involvement) |

---

## 7. Failure Recovery Architecture

### 7.1 Failure Isolation Principle

Each generator can fail independently. A failure in one generator must not:
- Destroy the output of a previous generator
- Destroy the Interaction Timeline
- Prevent retry of the failed generator
- Corrupt persisted state

### 7.2 Failure Detection

Each generator returns a result type:

```
GeneratorResult<T>:
  status: "success" | "failure" | "partial"
  output: T | null
  errors: GeneratorError[]
    where GeneratorError:
      stepIndex: number | null   — which step failed (null = whole pipeline)
      message: string
      recoverable: boolean
```

The GenerationEngine inspects each result before proceeding:

```
stepResult = canonicalStepGenerator.generate(input)
  │
  ├── status = "success" → proceed to JSON generator
  ├── status = "partial" → proceed to JSON generator (with warnings)
  └── status = "failure" → halt pipeline, store nothing, report failure
```

### 7.3 Retry Strategy

| Failure Type | Retry Scope | Data Preserved |
|---|---|---|
| Canonical Step Generator fails | Full pipeline from Timeline | Timeline, Context, Draft |
| Execution JSON Generator fails | JSON only (steps remain) | Steps (from Step Generator) |
| Playwright Generator fails | Playwright only | Steps + JSON |
| Multiple generators fail | Each failed generator independently | All successful outputs |

**Retry implementation:** The GenerationEngine creates a new instance for each retry. It does not mutate the previous attempt's state. The engine reads the current Timeline from storage (which is immutable) and re-runs the pipeline.

### 7.4 Partial Success Behavior

If 8 of 10 steps generate successfully but 2 fail:

```
stepResult.status = "partial"
stepResult.errors = [
  { stepIndex: 3, message: "Element identity incomplete", recoverable: true },
  { stepIndex: 7, message: "Unknown action type: 'scroll'", recoverable: false },
]
```

The engine:
1. Stores the 8 successful steps.
2. Marks the 2 failed steps with error metadata.
3. Generates Playwright from the 8 successful steps (failed steps are commented out).
4. Transitions TC → GENERATED with a "partial" flag.
5. Side panel shows: "Generation completed with 2 warnings."

### 7.5 Recovery Ownership

| Responsibility | Owner |
|---|---|
| Detect generator failure | Generator (returns failure status) |
| Decide whether to halt or continue | GenerationEngine |
| Preserve Timeline on failure | Storage Service (Timeline never touched by generators) |
| Store partial artifacts | GenerationEngine (writes successful outputs) |
| Report failure to user | Service Worker → Side Panel (via storage state) |
| Trigger retry | Side panel (user clicks Retry) or Service Worker (automatic retry once) |

### 7.6 Complete Failure

If the Canonical Step Generator fails entirely (no steps produced):

1. TC remains in GENERATING state.
2. No artifacts are written to storage.
3. Timeline and Context are preserved (they were never touched).
4. Side panel shows: "Generation failed. [Retry] [Discard Recording]".
5. Retry creates a new GenerationEngine and re-runs from Timeline.
6. Discard clears the Timeline and returns TC to DRAFT.

---

## 8. State Management Architecture

### 8.1 State Machine

Per B1 §7, the GENERATING state is required:

```
RECORDED ──→ GENERATING ──→ GENERATED ──→ UNDER_REVIEW
                 │
                 │ (failure)
                 ▼
            GENERATING (stays, retry available)
```

### 8.2 State Ownership

The Test Case state lives on the `TestCaseDraft` object (stored via `TEST_CASE_DRAFT` storage key). The `status` field transitions through:

```
TestCaseState.DRAFT
  → TestCaseState.RECORDING
  → TestCaseState.RECORDED
  → TestCaseState.GENERATING     ← NEW
  → TestCaseState.GENERATED
  → TestCaseState.UNDER_REVIEW
  → TestCaseState.APPROVED
  → TestCaseState.SAVED
```

**New state value:** `TestCaseState.GENERATING = 'generating'`

This requires adding one enum value to the existing `TestCaseState` in `types.ts`. No other type changes needed.

### 8.3 Transition Rules

| From | To | Trigger | Owner |
|---|---|---|---|
| RECORDING | RECORDED | Stop Recording | Service Worker |
| RECORDED | GENERATING | Automatic (immediately after RECORDED) | Service Worker |
| GENERATING | GENERATED | All generators complete (success or partial) | GenerationEngine |
| GENERATING | GENERATING | Generator failure (stays for retry) | GenerationEngine |
| GENERATED | UNDER_REVIEW | Automatic (immediately after GENERATED) | GenerationEngine |
| UNDER_REVIEW | UNDER_REVIEW | User edits steps/code | Side Panel |
| UNDER_REVIEW | APPROVED | User clicks Approve | Side Panel |

### 8.4 Rollback Behavior

The GENERATING state has **no rollback**. Once generation starts, it either succeeds (→ GENERATED) or fails (stays in GENERATING until retry or discard).

There is no "GENERATING → RECORDED" rollback. This is deliberate:
- The Timeline is never destroyed by generation, so there's nothing to roll back to.
- If the user wants to abandon, they Discard (→ DRAFT), not Rollback.

### 8.5 Recovery After Interruption (MV3 SW Termination)

MV3 service workers can be terminated at any time. If the SW dies during GENERATING:

1. The `TestCaseDraft.status` in storage is still `GENERATING`.
2. On SW restart, `restoreFromStorage()` reads the draft status.
3. If status is `GENERATING`, the SW detects an interrupted generation.
4. The SW can either:
   - **Auto-retry:** Check if any partial artifacts exist. If partial artifacts exist, transition to GENERATED with warnings. If no artifacts exist, re-run generation.
   - **Prompt user:** Show "Generation was interrupted. [Retry] [Discard]" in the side panel.

**Decision: Auto-retry on SW restart.** The Timeline is immutable in storage, so re-running generation is safe and idempotent. No user action needed for a transparent retry.

If auto-retry also fails (second failure), transition to manual: side panel shows the retry/discard prompt.

### 8.6 Storage Keys

New storage keys required:

```
StorageKeys:
  ...existing keys...
  GENERATED_STEPS = 'generated_steps'      — Canonical Test Steps (post-generation)
  PLAYWRIGHT_CODE = 'playwright_code'       — Generated Playwright test string + metadata
```

The existing `STEPS = 'session_steps'` key holds steps generated live during recording. After B2, live generation stops. The `GENERATED_STEPS` key holds post-Stop generated steps. The `STEPS` key is deprecated (or repurposed — see implementation roadmap).

---

## 9. Engine Extensibility

### 9.1 The Generator Registry Pattern

Future generators (Cypress, Selenium, Cucumber) plug into the architecture through a **registry** — the same pattern already used for interaction types.

```
GeneratorRegistry:
  generators: Map<string, GeneratorContract>

  register(contract: GeneratorContract): void
  get(name: string): GeneratorContract | undefined
  getAll(): GeneratorContract[]
  getOrdered(): GeneratorContract[]   — sorted by dependency chain
```

### 9.2 Adding a New Generator (e.g., Cypress)

To add a Cypress Test generator:

```
1. Create CypressGenerator implementing GeneratorContract
   - name: "cypress-generator"
   - inputContract: same as PlaywrightGenerator (Steps + Context + Draft)
   - outputContract: Cypress test string
   - dependencies: ["canonical-step-generator", "execution-json-generator"]
   - generate(steps, context, draft): Cypress test string

2. Register: GeneratorRegistry.register(cypressContract)

3. GenerationEngine.generate() now produces 4 artifacts:
   - Canonical Steps
   - Execution JSON
   - Playwright Test
   - Cypress Test

4. No existing generator is modified.
5. No storage key conflict (new key: CYPRESS_CODE).
6. No UI change required for generation (side panel gains a Cypress view — UI concern).
```

### 9.3 Extension by Addition, Not Modification

The architecture enforces this through contracts:

- Each generator has a **fixed input/output contract**.
- Adding a generator adds a new contract to the registry.
- The GenerationEngine iterates the registry in dependency order.
- No generator imports or references another generator.

```
Before (v1.0):                    After (adding Cypress):
┌──────────────────┐              ┌──────────────────┐
│ Step Generator   │              │ Step Generator   │ ← unchanged
│ JSON Generator   │              │ JSON Generator   │ ← unchanged
│ Playwright Gen   │              │ Playwright Gen   │ ← unchanged
└──────────────────┘              │ Cypress Gen      │ ← ADDED
                                  └──────────────────┘
```

### 9.4 Generator Independence

Each generator is **independently testable**:

- Unit test the generator's `generate()` function with a fixed input contract.
- No mocks of other generators needed.
- No storage mocks needed (generators don't touch storage).
- No SW mocks needed (generators don't know about the SW).

This is the primary architectural guarantee: a developer can write tests for the Playwright Generator without knowing anything about the Step Generator's implementation.

---

## 10. AI Boundaries

### 10.1 Where AI Is Used (During Recording)

AI understanding happens **during recording**, attached to each interaction event:

```
Content Script detects click
    │
    ▼
Service Worker receives CLICK_CAPTURED
    │
    ├── session.addAction()
    ├── ScreenshotService.capture()
    └── AIService.understand()  ← AI enrichment happens here
         │
         └── session.updateEventWithAI(actionId, understanding)
             │
             └── AI enrichment stored on the interaction event
                 (businessName, controlType, userIntent, confidenceScore)
```

AI enrichment is **factual data attached to the interaction**. It is captured once, during recording, and never changes.

### 10.2 Where AI Is NOT Used (During Generation — v1.0)

In v1.0, the Generation Engine does **not** call AI services. It reads pre-existing AI enrichment from the timeline events and projects it onto steps.

| Generation Phase | AI Calls | Why |
|---|---|---|
| Canonical Step Generation | ❌ None | AI enrichment already on timeline events |
| Execution JSON Generation | ❌ None | Deterministic locator resolution |
| Playwright Generation | ❌ None | Deterministic code mapping |

### 10.3 The Determinism Principle

The core invariant is not "AI is forbidden during generation" — it is **"generation must remain deterministic and AI must never change the semantic meaning of the recorded workflow."**

The architectural rule:

> **Generation must remain deterministic. AI may enrich generated artifacts in the future, but AI must never (a) change the semantic meaning of the recorded workflow, or (b) become a mandatory dependency for successful generation.**

This formulation protects the three properties that matter:
1. **Determinism:** For the same input state, the same semantic output is produced every time. Pressing Regenerate never changes *what the test does*, even if an AI-assisted enhancement suggests a better description.
2. **No mandatory AI dependency:** If the AI service is unavailable, rate-limited, or misconfigured, generation still succeeds with the deterministic baseline. AI enrichment is a quality enhancement, never a precondition.
3. **No semantic drift:** AI may suggest improvements (better plain English, alternative locators, additional assertions). These are **suggestions the user accepts or rejects** — they never silently change what the test does.

In v1.0, generation is fully AI-free. This rule ensures the architecture remains extensible for future AI-assisted enhancements without redesign.

### 10.4 AI Responsibility Boundaries

| Responsibility | Owner | Deterministic? |
|---|---|---|
| Understanding what the user clicked | AI Service (during recording) | No (AI is probabilistic) |
| Attaching business name / intent / confidence | AI Service (during recording) | No |
| Transforming interactions into steps | Canonical Step Generator | **Yes** (deterministic) |
| Resolving locators | Execution JSON Generator | **Yes** (deterministic) |
| Generating Playwright code | Playwright Generator | **Yes** (deterministic) |
| Managing state transitions | Generation Engine | **Yes** (deterministic) |
| Persisting artifacts | Storage Service | **Yes** (deterministic) |

### 10.5 Future AI Use Cases (Out of Scope for B2)

Future AI capabilities that the architecture must support without redesign:

- **AI-assisted plain English refinement:** User can ask AI to improve step descriptions during review. This would be an explicit user action, not part of generation. The AI produces a suggestion; the user accepts or rejects. The canonical step's plain English is updated; derived artifacts regenerate.

- **AI-generated test names:** AI could suggest a Test Case Name from the recording. This happens before or after recording, not during generation.

- **AI test optimization:** AI could suggest combining steps, removing redundant steps, or adding assertions. This is a review-time feature, not a generation-time feature.

All future AI features are **user-initiated, opt-in, and operate on the canonical representation** — never on raw events or derived exports. The generation pipeline remains AI-free and deterministic.

---

## 11. Architecture Principles

### AP1 — Single Responsibility Per Generator

Each generator owns exactly one transformation. The Step Generator produces steps. The JSON Generator produces JSON. The Playwright Generator produces test code. No generator crosses boundaries.

### AP2 — One-Way Data Flow

Data flows from Timeline → Steps → JSON → Playwright. Never reverse. No generator reads its own output's downstream consumer. The dependency graph is acyclic.

### AP3 — Generators Are Pure Functions

Generators take input, produce output, and have no side effects. They don't write to storage, don't modify global state, don't call AI services. They are deterministic and independently testable.

### AP4 — Engine Owns State, Generators Don't

The GenerationEngine is the sole component that manages state transitions, writes to storage, and coordinates generators. Generators are stateless tools the engine invokes.

### AP5 — Timeline Is Read-Only Input

No generator reads from or writes to the Timeline. The Timeline is frozen at Stop and serves as immutable input to the Step Generator only.

### AP6 — Batch Persistence

The engine writes all artifacts to storage in a single batch at the end of generation. No intermediate persisted state. This prevents partial storage corruption on generator failure.

### AP7 — Extension by Addition

New generators are added through the registry. No existing generator is modified to support a new export format. The dependency chain is resolved at runtime by the engine.

### AP8 — Generation Is Deterministic

For the same input state, generators always produce the same semantic output (modulo timestamps). Generation must remain deterministic: no randomness, no mandatory AI dependency, no external state reads. Future AI-assisted enhancements may enrich artifacts but must never change the semantic meaning of the recorded workflow or become a mandatory dependency for successful generation.

### AP9 — Failure Never Escalates

A generator failure is contained to that generator's output. It does not cascade to destroy previous outputs or the Timeline. The user can always retry the failed generator independently.

### AP10 — Storage Is the Single Source of Persisted Truth

The GenerationEngine writes to storage. The side panel reads from storage. No in-memory-only state. If the SW restarts, all artifacts are recovered from storage.

### AP11 — Contracts, Not Implementations

Generators communicate through published input/output contracts. No generator imports another generator's code. No generator assumes another generator's internal representation.

### AP12 — Every Generator Is Independently Testable

Because generators are pure functions with published contracts, each can be unit-tested in isolation with fixed inputs. No integration test is required to verify a single generator's correctness.

---

## 12. Component Specifications

### 12.1 GenerationEngine

**Location:** New file: `src/generation/engine/generation-engine.ts`

**Responsibility:** Orchestrate the generation pipeline. Read inputs from storage. Invoke generators in order. Write outputs to storage. Manage state transitions. Report progress and failures.

**Interface:**
```
GenerationEngine:
  // Full generation from Timeline
  async generate(tabId?: number): Promise<GenerationResult>

  // Partial regeneration
  async regenerateSteps(): Promise<GenerationResult>
  async regenerateJson(): Promise<GenerationResult>
  async regeneratePlaywright(force: boolean): Promise<GenerationResult>

  // State queries
  isGenerating(): boolean
  getLastResult(): GenerationResult | null
```

**Dependencies:** Storage Service, Generator Registry, TestCaseDraft state.

### 12.2 GeneratorRegistry

**Location:** New file: `src/generation/registry/generator-registry.ts`

**Responsibility:** Maintain the list of registered generators and their dependency order.

**Interface:**
```
GeneratorRegistry:
  register(contract: GeneratorContract): void
  get(name: string): GeneratorContract | undefined
  getOrdered(): GeneratorContract[]
```

### 12.3 CanonicalStepGenerator

**Location:** New file: `src/generation/generators/canonical-step-generator.ts`

**Responsibility:** Transform Interaction Timeline into Canonical Test Steps.

**Interface:**
```
CanonicalStepGenerator:
  generate(input: CanonicalStepGeneratorInput): CanonicalStepGeneratorOutput
```

**Reuses:** `interaction-types.ts` registry (`toPlainEnglish()` per type), element identity projection, AI enrichment projection.

### 12.4 ExecutionJsonGenerator

**Location:** New file: `src/generation/generators/execution-json-generator.ts`

**Responsibility:** Populate executionJson on each Canonical Test Step.

**Interface:**
```
ExecutionJsonGenerator:
  generate(input: ExecutionJsonGeneratorInput): ExecutionJsonGeneratorOutput
```

**Uses:** The **Locator Resolution Engine** (currently implemented by `buildLocators()` from `step-builder.ts`). The capability is consumed as a contract; the implementation may evolve independently.

### 12.5 PlaywrightGenerator

**Location:** New file: `src/generation/generators/playwright-generator.ts`

**Responsibility:** Generate a TypeScript Playwright test string from Steps + JSON + Context + Draft.

**Interface:**
```
PlaywrightGenerator:
  generate(input: PlaywrightGeneratorInput): PlaywrightGeneratorOutput
```

**New logic:** Action-to-Playwright mapping, locator-to-selector translation, test scaffolding, comment generation.

### 12.6 File Structure (Target)

```
src/
  generation/                       ← NEW DIRECTORY
    engine/                         ← Generation engine (orchestration)
      generation-engine.ts          ← Orchestrator: reads inputs, invokes generators, writes outputs
    generators/                     ← Individual generators (one responsibility each)
      canonical-step-generator.ts   ← Timeline → Canonical Test Steps
      execution-json-generator.ts   ← Steps → Execution JSON (via Locator Resolution Engine)
      playwright-generator.ts       ← Steps + JSON → Playwright test string
      cypress-generator.ts          ← (future)
      selenium-generator.ts         ← (future)
      cucumber-generator.ts         ← (future)
    contracts/                      ← Published input/output contracts
      generator-contract.ts         ← GeneratorContract type, all input/output interfaces
    registry/                       ← Generator registry (extensibility)
      generator-registry.ts         ← Register, get, getOrdered (by dependency chain)
    types.ts                        ← Generator-specific types (CanonicalStep, GeneratorResult, etc.)
```

**Rationale for nested structure:**

1. **Clear separation of concerns.** Engine logic (orchestration) is physically separated from generator logic (transformation) from contract definitions (types) from registry logic (extensibility). A developer looking for "how does the Playwright generator work?" goes to `generators/`. A developer looking for "how does the pipeline coordinate?" goes to `engine/`.

2. **Scales without restructuring.** When Cypress, Selenium, and Cucumber generators are added, they drop into `generators/`. No restructuring needed. The directory communicates its purpose: "each file here is one generator."

3. **Communicates intent.** The directory names themselves document the architecture: engine orchestrates, generators transform, contracts define interfaces, registry manages extensibility.

4. **Testability mirroring.** Tests can mirror the directory structure: `tests/generation/generators/canonical-step-generator.test.ts`, etc. Each generator is independently testable — the directory structure makes this explicit.

The existing files (`step-builder.ts`, `recording-session.ts`, `service-worker.ts`) are modified to accommodate the post-Stop generation model, but their core responsibilities remain unchanged. See the implementation roadmap (§13) for details.

---

## 13. Integration with Existing Code

### 13.1 What Changes in the Service Worker

The `STOP_RECORDING` handler currently does:

```typescript
case 'STOP_RECORDING':
  session.stop();
  await StorageService.setRecordingState(RecordingState.Stopped);
  break;
```

After B2 implementation, it will do:

```typescript
case 'STOP_RECORDING':
  session.stop();
  await StorageService.setRecordingState(RecordingState.Stopped);
  // Transition TC to RECORDED, then GENERATING
  await transitionToGenerating();
  // Invoke generation engine
  const engine = new GenerationEngine();
  const result = await engine.generate();
  // Handle result (success, partial, failure)
  await handleGenerationResult(result);
  break;
```

**Key change:** The `processAction()` function in the service worker currently calls `buildStep()` and `session.addStep()` **during recording**. After B2, `processAction()` stops calling `buildStep()`. It only captures the interaction event (addAction + screenshot + AI). Steps are generated after Stop.

### 13.2 What Changes in processAction()

```
BEFORE (live step generation):
  addAction → screenshot → AI → buildStep → addStep

AFTER (capture only, generation deferred):
  addAction → screenshot → AI → (store enrichment on event)
```

`processAction()` still enriches the event with AI understanding (because AI enrichment is factual data captured at recording time). But it no longer builds a step. The step is built post-Stop by the Canonical Step Generator.

### 13.3 What Changes in recording-session.ts

The `addStep()` and `getSteps()` methods become less central. During recording, no steps are added. Steps are generated post-Stop and stored under `GENERATED_STEPS`.

The session's role narrows to: capture events, store events, capture context. Step management moves to the Generation Engine + Storage Service.

### 13.4 What Changes in sidepanel.ts

The side panel currently shows steps live during recording (via `STEPS_UPDATED` messages). After B2:

- During recording: shows only the Interaction Timeline (events), no steps.
- After Stop (GENERATING): shows "Generating..." progress.
- After generation (UNDER_REVIEW): shows three views: Timeline, Steps, Playwright.

The `recording-view` shows only the timeline. A new `review-view` shows the generated artifacts.

### 13.5 What Is Removed

| Removed | Why |
|---|---|
| Live step generation in `processAction()` | B1 P2: Generation after Stop |
| `STEPS_UPDATED` message during recording | No steps exist during recording |
| `session.addStep()` calls during recording | Steps generated post-Stop |

### 13.6 What Is Preserved

| Preserved | Why |
|---|---|
| `step-builder.ts` `buildLocators()` function | Reused by Execution JSON Generator |
| `interaction-types.ts` `toPlainEnglish()` | Reused by Canonical Step Generator |
| `step-id-generator.ts` | Reused by Canonical Step Generator |
| `action-id.ts`, `element-id-generator.ts` | Used during recording (unchanged) |
| `screenshot-service.ts` | Screenshots captured during recording (unchanged) |

---

## 14. Implementation Roadmap

The implementation follows the milestone sequence from B1 §12, now with architectural detail:

### Milestone B3 — Canonical Test Step Generation

**Scope:** Implement CanonicalStepGenerator + GenerationEngine skeleton.

**Changes:**
- New: `src/generation/` directory with nested structure (engine/, generators/, contracts/, registry/)
- New: `src/generation/generators/canonical-step-generator.ts`
- Modify: `service-worker.ts` STOP_RECORDING handler to invoke engine
- Modify: `service-worker.ts` `processAction()` to stop building steps live
- Modify: `types.ts` add `TestCaseState.GENERATING`
- New: `GENERATED_STEPS` storage key
- Tests: Unit tests for Step Generator (timeline → steps), integration test for Stop → Steps pipeline

**Defer:** Execution JSON generation (steps generated with `executionJson: null`), Playwright generation, review UI.

### Milestone B4 — Execution JSON Generation

**Scope:** Implement ExecutionJsonGenerator.

**Changes:**
- New: `src/generation/generators/execution-json-generator.ts`
- Relocate: `buildLocators()` from `step-builder.ts` to `src/generation/generators/execution-json-generator.ts` as the Locator Resolution Engine
- Modify: GenerationEngine to invoke JSON Generator after Step Generator
- Tests: Unit tests for JSON Generator (steps → JSON), locator priority tests

**Defer:** Playwright generation, review UI.

### Milestone B5 — Playwright Test Generation

**Scope:** Implement PlaywrightGenerator.

**Changes:**
- New: `src/generation/generators/playwright-generator.ts`
- New: `PLAYWRIGHT_CODE` storage key
- Modify: GenerationEngine to invoke Playwright Generator
- Tests: Unit tests for Playwright Generator (steps → code), action mapping, locator translation, test scaffolding

**Defer:** Review UI, regeneration, failure handling UI.

### Milestone B6 — Pipeline Integration & State Management

**Scope:** Full GENERATING state, progress, failure handling, regeneration.

**Changes:**
- Modify: GenerationEngine for failure detection, partial success, retry
- Modify: `service-worker.ts` for GENERATING state transitions
- Modify: side panel for generation progress display
- New: Regeneration methods on GenerationEngine
- New: Messages for generation events (GENERATION_STARTED, GENERATION_PROGRESS, GENERATION_COMPLETE, GENERATION_FAILED)
- Tests: Integration tests for full pipeline, failure scenarios, regeneration, idempotency

### Milestone B7 — Review & Approval Workflow

**Scope:** Complete review and approval workflow with three synchronized artifact views, editing, regeneration, and approval.

**Changes:**
- Modify: `sidepanel.ts` and `index.html` for review view
- New: Timeline view (read-only), Steps view (editable), Playwright view (editable)
- New: Delete interaction from timeline → regenerate linked step
- New: Edit plain English (no regeneration)
- New: Edit Playwright code (sets isManualEdit)
- Tests: Integration tests for review workflow, regeneration triggers, isManualEdit guard

---

## 15. Architectural Conflicts with Existing Code

### Conflict 1 — Live Step Generation vs Post-Stop Generation

**Current:** `processAction()` calls `buildStep()` and `session.addStep()` during recording.

**Target:** Steps generated only after Stop.

**Resolution:** Remove `buildStep()` and `addStep()` calls from `processAction()`. The AI enrichment is still attached to the event during recording (it's factual data). Step building moves to the Canonical Step Generator, invoked post-Stop.

**Risk:** Low. The existing step-building logic (`buildStep()`, `toPlainEnglish()`, `buildLocators()`) is reusable — it's being relocated, not rewritten.

### Conflict 2 — STEPS Storage Key

**Current:** `STEPS = 'session_steps'` holds live-generated steps.

**Target:** `GENERATED_STEPS` holds post-Stop generated steps.

**Resolution:** The `STEPS` key is repurposed: during recording it's empty (no steps); post-generation it holds the generated steps. Alternatively, introduce `GENERATED_STEPS` as a new key and deprecate `STEPS`.

**Decision:** Use `GENERATED_STEPS` as a new key. Clean separation between session events (SESSION_EVENTS) and generated steps (GENERATED_STEPS). The old `STEPS` key is deprecated.

### Conflict 3 — Side Panel State During Recording

**Current:** Side panel shows generated steps live during recording.

**Target:** Side panel shows only the Interaction Timeline during recording.

**Resolution:** The recording view drops the steps section. The timeline shows events (clicks, navigations) without step interpretation. The review view (post-generation) shows all three artifact views.

**Risk:** Low. This is a UI change, not an architectural change.

### Conflict 4 — Navigation Step Generation

**Current:** Navigation steps are generated live in the `webNavigation.onCommitted` handler (lines 144–172 of service-worker.ts).

**Target:** Navigation steps generated post-Stop by the Canonical Step Generator.

**Resolution:** The `webNavigation` handler only calls `session.addNavigation()`. It stops building nav steps. The Canonical Step Generator reads all events (including navigation events) from the timeline and generates steps for each.

**Risk:** Low. Navigation events are already stored in the timeline. The generator just needs to handle them.

---

## 16. Freeze Declaration

Upon approval, the following architecture is declared **frozen**:

### Frozen Architectural Decisions

1. **Pipeline order:** Canonical Steps → Execution JSON → Playwright. Non-negotiable.

2. **Three generators, each with a single responsibility.** No generator crosses boundaries.

3. **Generators are pure functions.** They take input, produce output, no side effects. Deterministic and independently testable.

4. **GenerationEngine is the sole orchestrator.** Only the engine writes to storage and manages state transitions. Generators never touch storage.

5. **Batch persistence.** All artifacts written to storage in a single batch at the end of generation. No intermediate persisted state.

6. **One-way data flow.** Timeline → Steps → JSON → Playwright. Never reverse.

7. **GENERATING state is required** between RECORDED and GENERATED. Auto-retry on SW termination.

8. **Regeneration is deterministic.** Same input → same output. "Regenerate Steps" discards plain English edits (warns first). "Regenerate Playwright" overwrites code (warns if `isManualEdit`).

9. **Generation must remain deterministic. AI may enrich generated artifacts in the future, but AI must never (a) change the semantic meaning of the recorded workflow, or (b) become a mandatory dependency for successful generation.** In v1.0, generation is fully AI-free; AI enrichment is captured during recording and projected onto steps.

10. **New generators added through a registry.** Extension by addition. No existing generator modified for new formats.

11. **`GENERATED_STEPS` and `PLAYWRIGHT_CODE` are new storage keys.** Clean separation from session events.

12. **Live step generation in `processAction()` is removed.** Steps generated post-Stop only.

13. **File structure:** `src/generation/` with nested subdirectories: `engine/`, `generators/`, `contracts/`, `registry/`. Scales to 8+ generators without restructuring.

14. **Navigation steps generated by Canonical Step Generator**, not by the webNavigation handler.

### What This Freeze Means

- Implementation milestones (B3–B7) follow this architecture without redesigning the engine.
- If implementation reveals a flaw, the flaw is documented and escalated — not silently worked around.
- Future interaction types (Text Entry, Dropdown, etc.) register their generators' behavior through the interaction type registry — the generation pipeline doesn't change.
- Future export formats (Cypress, Selenium, Cucumber) are added through the Generator Registry — existing generators are not modified.

---

*This document defines the technical architecture for CmdRunner's Post-Recording Artifact Generation Engine. All implementation must conform to this architecture.*
