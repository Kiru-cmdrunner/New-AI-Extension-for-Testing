# Milestone B5.1 — Execution JSON Architecture

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Architecture Design (no implementation, no code, no JSON schema, no UI)
**Depends on:**
- Product Foundation Design v1.0 (frozen)
- Product Architecture Design v1.0 (frozen)
- Milestone B1 — Post-Recording Artifact Generation Product Design (frozen)
- Milestone B2 — Post-Recording Artifact Generation Architecture (frozen)
- Milestone B3 — Artifact Generation Engine Foundation (frozen)
- Milestone B4.1 — CmdRunner Execution Model (frozen)
- Milestone B4.2 — Execution Object Design (frozen)
- Milestone B4.3 — CmdRunner Locator Resolution Strategy (frozen)
- Milestone B4.4 — CmdRunner Locator Priority Strategy (frozen)
- Milestone B4.5 — Execution JSON Product Specification (frozen)

---

## 0. Purpose of This Document

B4.1–B4.5 froze the **product contract** for the Execution JSON: what it represents, what it owns, what it must not contain, and how it relates to every other artifact. B2 froze the **overall generation architecture** at a high level — the Generation Engine, the registry, the pipeline order, the failure model.

This milestone bridges the two. It defines the **system architecture specifically for the Execution JSON** — how it is created, who owns it at each stage, how it flows through the pipeline, how regeneration works, how failures are handled, and how future consumers integrate.

B2 §3.3 already previewed the Execution JSON Generator's contract. B5.1 confirms, deepens, and freezes the architecture around it. No B2 decision is changed; B5.1 adds the operational detail needed before schema design (B5.2) and implementation (B5.4).

---

## Stage 1 — Architectural Overview

### 1.1 The Execution JSON in the Full Pipeline

```
INTERACTION TIMELINE (frozen, immutable)
        │
        │  1. Canonical Step Generator (B3, implemented)
        │     reads: SessionEvent[] + RecordingContext
        │     produces: CanonicalStep[] (executionJson = null)
        │
        ▼
CANONICAL TEST STEPS (human-readable, editable plain English)
        │
        │  2. Execution JSON Generator (B5.4, to implement)
        │     reads: CanonicalStep[] (executionJson = null)
        │     produces: CanonicalStep[] (executionJson populated)
        │     │
        │     │  Internally invokes:
        │     │  ┌──────────────────────────────────────────┐
        │     │  │  Locator Resolution Engine               │
        │     │  │  (reads element identity, applies B4.4   │
        │     │  │   priority hierarchy + acceptance rules, │
        │     │  │   produces resolved locator set)         │
        │     │  └──────────────────────────────────────────┘
        │     │
        │     │  Then serializes each Execution Object as
        │     │  Execution JSON and embeds it in its Step.
        │
        ▼
CANONICAL TEST STEPS (executionJson populated)
        │
        │  3. Playwright Generator (B6, future)
        │     reads: CanonicalStep[] (executionJson populated)
        │     produces: Playwright test code (string)
        │
        ▼
GENERATED PLAYWRIGHT TEST (derived export, editable, isManualEdit flag)
        │
        │  4. Future: Cypress Generator, Selenium Generator, etc.
        │     each reads the same CanonicalStep[] independently
        │
        ▼
FRAMEWORK-SPECIFIC TEST CODE (star topology — each spoke is independent)
```

### 1.2 Responsibility of Each Stage

| Stage | Component | Responsibility | Reads | Writes |
|---|---|---|---|---|
| 1 | Canonical Step Generator (B3) | Transform raw events into human-readable steps with element identity | Timeline events, RecordingContext | CanonicalStep[] (executionJson = null) |
| 2 | Execution JSON Generator (B5.4) | Resolve locators, serialize Execution Objects, embed JSON in Steps | CanonicalStep[] (executionJson = null) | Same CanonicalStep[] (executionJson populated) |
| 2a | Locator Resolution Engine (within #2) | Apply B4.4 priority hierarchy to element identity, produce resolved locator set | Element identity from each Step | Primary, secondary, fallback locators (returned to #2) |
| 3 | Playwright Generator (B6) | Translate Execution JSON into Playwright test code | CanonicalStep[] (with executionJson) | Playwright test string |
| 4 | Future generators | Translate Execution JSON into other framework code | Same CanonicalStep[] | Framework-specific code |

**Key architectural principle:** Each stage reads only the output of the immediately preceding stage. The Playwright Generator never reads the Timeline. The Execution JSON Generator never reads the Playwright output. Dependencies are strictly one-way.

### 1.3 Where the Execution JSON Lives

The Execution JSON is **embedded within each Canonical Test Step** as the `executionJson` field. It is not a separate storage record, a separate collection, or a separate file.

```
Storage (chrome.storage.local):
  GENERATED_STEPS: CanonicalStep[]
    [0]: {
      stepNumber: 1,
      actionType: "click",
      plainEnglish: "Click \"Search\" button",
      elementIdentity: { ... },          // raw, from recording
      aiEnrichment: { ... },             // from AI enrichment
      executionJson: { ... },            // ← THIS is what B5 designs
      linkedInteractionId: "click-0001"
    }
    [1]: {
      stepNumber: 2,
      actionType: "navigate",
      plainEnglish: "Navigate to results page",
      elementIdentity: null,             // navigation has no element
      aiEnrichment: null,
      executionJson: { ... },            // navigation Execution JSON
      linkedInteractionId: "nav-0001"
    }
```

This embedding means:
- The Execution JSON is stored and retrieved with its parent Step.
- No separate storage key is needed for Execution JSON.
- Deleting a Step automatically deletes its Execution JSON.
- Reordering Steps automatically reorders their Execution JSON.

---

## Stage 2 — Ownership

### 2.1 Ownership Through the Lifecycle

| Phase | Owner | What Happens |
|---|---|---|
| **Recording** | RecordingSession | Events captured. No Execution JSON exists. Steps don't exist yet. |
| **GENERATING (Canonical Step Generator)** | GenerationEngine | Steps created with `executionJson = null`. Execution JSON does not exist yet. |
| **GENERATING (Execution JSON Generator)** | Execution JSON Generator | Execution Objects resolved. Execution JSON serialized. Embedded in Steps. |
| **GENERATING (persisted)** | GenerationEngine | Steps (now with executionJson) written to storage. |
| **GENERATED** | Test Case (via Steps) | Execution JSON is at rest, embedded in Steps. Available for consumption. |
| **UNDER_REVIEW** | Test Case (via Steps) | Execution JSON available for display and consumption. User reviews Steps. |
| **APPROVED / SAVED** | Test Case (via Steps) | Execution JSON permanently frozen. |

### 2.2 Who May Do What

| Action | Permitted By | Not Permitted By |
|---|---|---|
| **Create Execution JSON** | Execution JSON Generator (sole creator) | UI, user, code generators, Playwright Generator |
| **Read Execution JSON** | Code generators (Playwright, future), UI (for display), future execution engines | — (read access is open to all consumers) |
| **Regenerate Execution JSON** | GenerationEngine (via `regenerate("json")`) | UI directly, user directly, code generators |
| **Replace Execution JSON** | GenerationEngine (via regeneration — old JSON discarded, new JSON embedded) | Direct field mutation by any component |
| **Delete Execution JSON** | GenerationEngine (when Step is deleted, JSON is deleted with it) | — (deletion is a side effect of Step deletion) |
| **Modify Execution JSON in place** | **Nobody** | All components. No in-place mutation is ever permitted. |

### 2.3 The Immutability Chain

```
GenerationEngine.generate()
  → Execution JSON Generator produces Execution Objects
  → Serializes as Execution JSON
  → Returns to GenerationEngine
  → GenerationEngine writes to storage (batch)
  → JSON is now immutable until next regeneration

RegenerationEngine.regenerate("json")
  → Reads current Steps from storage
  → Execution JSON Generator re-derives JSON from Steps
  → Returns new Steps (with new JSON)
  → GenerationEngine writes to storage (batch replacement)
  → Old JSON is gone; new JSON is immutable until next regeneration
```

At no point does any component reach into a Step and modify its `executionJson` field directly. The only path is: full regeneration via the GenerationEngine.

---

## Stage 3 — Generation Pipeline

### 3.1 Input Dependencies

The Execution JSON Generator's input is:

```
ExecutionJsonGeneratorInput:
  steps: CanonicalStep[]    — steps with executionJson = null
```

Each step provides:
- `actionType` — the action to execute (click, navigate, etc.)
- `elementIdentity` — raw element identity from recording (the input to locator resolution)
- `linkedInteractionId` — traceability to the Timeline
- `stepNumber` — ordering
- `aiEnrichment` — AI context (selectively projected, not the full enrichment)

The generator does **not** read:
- The Interaction Timeline directly (it reads Steps, which were derived from the Timeline)
- The RecordingContext (it is not needed for execution data)
- The Test Case draft (it is not needed for execution data)
- Any external state (AI services, network, current time beyond timestamp)

### 3.2 Output Responsibilities

The generator produces:

```
ExecutionJsonGeneratorOutput:
  steps: CanonicalStep[]    — same steps, executionJson populated
```

For each step, the generator:
1. Reads the step's `elementIdentity`.
2. Passes it to the Locator Resolution Engine.
3. Receives resolved locators (primary, secondary, fallback per B4.4).
4. Constructs the Execution Object (six categories per B4.2).
5. Serializes it as Execution JSON.
6. Embeds it in the step's `executionJson` field.

The generator returns the same array of steps — same objects, with `executionJson` now populated. It does not create new step objects, reorder steps, or modify any other field.

### 3.3 Generation Sequence

```
GenerationEngine.generate():

  1. Read Timeline + Context from storage
  2. Run Canonical Step Generator → produce Steps (executionJson = null)
  3. Validate Step output (status check)
  4. ──── BEGIN Execution JSON Generation ────
  5. Run Execution JSON Generator on Steps
     │
     │  For each Step:
     │    a. Extract elementIdentity
     │    b. If actionType = "navigate": produce navigation Execution JSON
     │       (synthetic locator per B2 §3.3, target URL from event)
     │    c. If actionType = "click" (or other element action):
     │       i.   Pass elementIdentity to Locator Resolution Engine
     │       ii.  Engine applies B4.4 priority hierarchy + acceptance rules
     │       iii. Engine returns: primary, secondary, fallback locators
     │       iv.  Construct Execution Object with all six categories
     │       v.   Serialize as Execution JSON
     │       vi.  Embed in step.executionJson
     │
  6. Validate JSON output (status check)
  7. ──── END Execution JSON Generation ────
  8. [Future] Run Playwright Generator on Steps (with executionJson)
  9. Batch persist all Steps to storage (GENERATED_STEPS key)
  10. Transition Test Case → GENERATED
```

### 3.4 Validation Points

| Checkpoint | What Is Validated | Failure Action |
|---|---|---|
| After Step generation (step 3) | Steps exist, at least one step produced, no fatal errors | Halt pipeline, preserve Timeline, report failure |
| Per-step locator resolution (step 5c.ii) | Locator Resolution Engine produced at least one accepted locator for element actions | Mark step with warning, continue (partial success) |
| After JSON generation (step 6) | All steps have `executionJson` populated (or explicitly marked as failed) | If all steps failed: halt. If some failed: continue with warnings. |
| Before persistence (step 9) | Steps array is valid, no null entries | Halt, preserve prior state |

### 3.5 Error Boundaries

The Execution JSON Generator's error boundary is **per-step**. A failure in one step's locator resolution does not prevent other steps from generating:

```
Step 1: elementIdentity resolved → JSON generated ✅
Step 2: elementIdentity incomplete → locator resolution fails → JSON marked as error ⚠️
Step 3: elementIdentity resolved → JSON generated ✅
Step 4: navigation step → synthetic JSON generated ✅
```

Result: 3 successful, 1 failed. The pipeline continues. The failed step's `executionJson` contains an error marker (not null — null means "not yet generated"; error means "attempted and failed"). The Test Case transitions to GENERATED with a partial-success flag.

This per-step error isolation is consistent with B2 §7.4 (Partial Success Behavior) and B1 P9 (Partial generation is a warning, not a failure).

### 3.6 Integration with the Generation Engine

The Execution JSON Generator registers itself in the Generator Registry (established in B3):

```
generatorRegistry.register(executionJsonGenerator);
```

The registry resolves execution order via topological sort (B3 implementation). The Execution JSON Generator declares a dependency on the Canonical Step Generator:

```
ExecutionJsonGeneratorContract:
  name: "execution-json-generator"
  dependencies: ["canonical-step-generator"]
```

The Generation Engine invokes generators in registry order. When it reaches the Execution JSON Generator, it passes the Steps (already produced by the Canonical Step Generator). The generator processes them and returns Steps with JSON populated.

**No modification to the Generation Engine is required.** B3 designed the engine to accommodate future generators via the registry. The Execution JSON Generator plugs in exactly as designed.

---

## Stage 4 — Lifecycle

### 4.1 Complete Lifecycle

```
                    ┌──────────────────────────────────────────────────┐
                    │                  RECORDING                       │
                    │  Events captured. No Steps. No JSON.            │
                    └──────────────────────┬───────────────────────────┘
                                           │ STOP_RECORDING
                                           ▼
                    ┌──────────────────────────────────────────────────┐
                    │                  GENERATING                      │
                    │                                                  │
                    │  ┌────────────────────────────────────────────┐  │
                    │  │ 1. Canonical Step Generator runs           │  │
                    │  │    → Steps created (executionJson = null)  │  │
                    │  └──────────────────┬─────────────────────────┘  │
                    │                     │                            │
                    │  ┌──────────────────▼─────────────────────────┐  │
                    │  │ 2. Execution JSON Generator runs           │  │
                    │  │    → Locator Resolution per step           │  │
                    │  │    → Execution Objects serialized          │  │
                    │  │    → executionJson populated on each step  │  │
                    │  └──────────────────┬─────────────────────────┘  │
                    │                     │                            │
                    │  ┌──────────────────▼─────────────────────────┐  │
                    │  │ 3. [Future] Playwright Generator runs      │  │
                    │  │    → reads Steps (with executionJson)      │  │
                    │  │    → produces test code                    │  │
                    │  └──────────────────┬─────────────────────────┘  │
                    │                     │                            │
                    │  ┌──────────────────▼─────────────────────────┐  │
                    │  │ 4. Batch persist Steps to storage          │  │
                    │  │    transition TC → GENERATED               │  │
                    │  └────────────────────────────────────────────┘  │
                    └──────────────────────────────────────────────────┘
                                           │
                                           ▼
                    ┌──────────────────────────────────────────────────┐
                    │                  GENERATED                       │
                    │  Steps + JSON at rest in storage.                │
                    │  Consumable by code generators, UI, engines.     │
                    │                                                  │
                    │  If step structurally changes:                   │
                    │    → regenerate("json") → JSON replaced          │──┐
                    │                                                  │  │
                    │  If "Regenerate Steps" clicked:                  │  │
                    │    → full pipeline re-runs from Timeline         │  │
                    │    → all Steps + JSON replaced                   │  │
                    └──────────────────────────┬───────────────────────┘  │
                                               │                          │
                                               ▼                          │
                                    UNDER_REVIEW ◄────────────────────────┘
                                               │
                                               ▼
                                          APPROVED
                                               │
                                               ▼
                                           SAVED (frozen permanently)
```

### 4.2 Creation

The Execution JSON is created during the GENERATING phase, after the Canonical Step Generator has produced Steps. It does not exist before this point. There is no "pre-generation" JSON, no placeholder, no stub. The field starts as `null` and is populated by the generator.

### 4.3 Persistence

The Execution JSON is persisted as part of the Step, under the `GENERATED_STEPS` storage key. It is written in a single batch operation by the Generation Engine — all steps (with their JSON) are written together. This batch write ensures atomicity: either all steps have JSON, or none do (on complete failure).

### 4.4 Consumption

After persistence, the Execution JSON is consumed by:

| Consumer | How It Reads | What It Does |
|---|---|---|
| Playwright Generator (B6) | Reads `step.executionJson` for each step | Translates action + locators into Playwright API calls |
| Side Panel UI | Reads `step.executionJson` for display | Shows locators, action type, context to the user |
| Future: Execution Engine | Reads `step.executionJson` for each step | Executes the described actions against a live browser |
| Future: Cypress/Selenium Generator | Same as Playwright Generator | Translates into framework-specific code |

All consumers read the same data. No consumer gets a "private" copy or a modified version.

### 4.5 Replacement

When the Execution JSON is regenerated (§6), the old JSON is **discarded** and replaced. The replacement happens through the Generation Engine:

1. Engine reads current Steps from storage.
2. Execution JSON Generator re-derives JSON from Steps.
3. Engine writes the new Steps (with new JSON) to storage — replacing the old batch.
4. Old JSON is gone.

There is no "archive" of old JSON. No version history (B1 P15). The replacement is atomic: the storage write either succeeds (new JSON in place) or fails (old JSON preserved).

---

## Stage 5 — Architectural Boundaries

### 5.1 Execution JSON Generator

| Does | Does NOT |
|---|---|
| Read Canonical Steps (executionJson = null) | Read the Interaction Timeline |
| Invoke the Locator Resolution Engine | Read or write the Recording Context |
| Construct Execution Objects (six categories) | Generate Playwright code |
| Serialize Execution Objects as Execution JSON | Manage repository state |
| Embed Execution JSON in Steps | Modify plain English on Steps |
| Return Steps with executionJson populated | Modify action type on Steps |
| | Modify element identity on Steps |
| | Write to storage directly |
| | Call AI services |
| | Execute tests |

### 5.2 Locator Resolution Engine

| Does | Does NOT |
|---|---|
| Read element identity from a Step | Read the Step's plain English |
| Apply B4.4 priority hierarchy | Read the Timeline |
| Apply B4.4 acceptance rules (reject auto-generated IDs, etc.) | Modify the element identity |
| Produce resolved locator set (primary, secondary, fallback) | Serialize Execution JSON |
| Detect auto-generated IDs and CSS-in-JS patterns | Generate Playwright code |
| | Write to storage |

The Locator Resolution Engine is a **capability invoked by the Execution JSON Generator**. It is not a separate generator — it does not register in the Generator Registry. It is a pure function: element identity in, resolved locators out.

### 5.3 Generation Engine

| Does | Does NOT |
|---|---|
| Orchestrate the full generation pipeline | Resolve locators itself |
| Invoke generators via the registry | Construct Execution Objects |
| Validate generator outputs | Serialize Execution JSON |
| Batch-persist generator outputs to storage | Generate Playwright code (that's the Playwright Generator's job) |
| Manage Test Case state transitions | Read or modify the Timeline |
| Handle retries and partial failures | |

### 5.4 Playwright Generator (future, B6)

| Does | Does NOT |
|---|---|
| Read Canonical Steps (with executionJson populated) | Modify executionJson |
| Translate executionJson into Playwright API calls | Regenerate executionJson |
| Produce Playwright test code as a string | Resolve locators (already resolved) |
| Respect isManualEdit flag | Read the Timeline |

### 5.5 Side Panel (UI)

| Does | Does NOT |
|---|---|
| Read Steps from storage for display | Modify executionJson |
| Display executionJson content (locators, action, context) | Regenerate executionJson directly |
| Trigger regeneration via the Generation Engine | Bypass the Generation Engine |
| Edit plain English on Steps | Edit locators in executionJson |

### 5.6 The Single Responsibility Summary

Every component has exactly one responsibility in the Execution JSON lifecycle:

```
Execution JSON Generator   → creates JSON
Locator Resolution Engine  → resolves locators (invoked by JSON Generator)
Generation Engine          → orchestrates and persists
Playwright Generator       → consumes JSON to produce code
Side Panel                 → displays JSON to the user
Future Consumers           → consume JSON for their own purposes
```

No component performs another's responsibility. No component modifies another's output.

---

## Stage 6 — Regeneration Architecture

### 6.1 When Execution JSON Is Regenerated

Per B1 §6.5 and B2 §6.1, the Execution JSON is regenerated in these scenarios:

| Trigger | What Happens to JSON | Who Initiates |
|---|---|---|
| Plain English edited (T1) | **No regeneration.** Plain English is a human layer. | User (side panel) |
| Step deleted (T2) | **JSON deleted with the step.** Remaining steps' JSON unchanged. | User (side panel) |
| Step structurally changed (T3) | **JSON regenerated for that step.** Other steps unchanged. | Generation Engine (automatic) |
| Playwright edited directly (T4) | **No JSON regeneration.** Playwright is downstream. | User (side panel) |
| "Regenerate Steps" button (T5) | **All JSON regenerated.** Full pipeline from Timeline. | User (side panel) |
| "Regenerate Playwright" (T6) | **No JSON regeneration.** Only Playwright re-derived. | User (side panel) |

### 6.2 Regeneration Sequence (T3 — Step Structural Change)

```
User edits step 3's action type (e.g., changes from "click" to "navigate")
    │
    ▼
Side panel calls GenerationEngine.regenerate("json")
    │
    ▼
Generation Engine reads all current Steps from storage
    │
    ▼
Execution JSON Generator processes ALL steps
    (idempotent — unchanged steps produce identical JSON)
    │
    ▼
Generation Engine batch-writes all Steps (with updated JSON) to storage
    │
    ▼
Old JSON for step 3 is replaced.
JSON for steps 1, 2, 4, 5 is identical (deterministic regeneration).
```

**Note:** The generator processes all steps, not just the changed one. This is simpler (no diff tracking needed) and safe (deterministic regeneration produces identical output for unchanged steps). The batch write replaces the entire Steps array.

### 6.3 Regeneration Sequence (T5 — Full Regenerate Steps)

```
User clicks "Regenerate Steps"
    │
    ▼
Warning shown: "This will discard plain English edits."
    │
    ▼
User confirms
    │
    ▼
GenerationEngine.regenerate("steps")
    │
    ▼
Full pipeline re-runs from Timeline:
  1. Canonical Step Generator → new Steps (plain English edits lost)
  2. Execution JSON Generator → new JSON for all Steps
  3. [Future] Playwright Generator → new Playwright code
    │
    ▼
All artifacts replaced. Old Steps, JSON, and Playwright are gone.
```

### 6.4 Idempotent Regeneration

Regeneration is idempotent (B2 §6.4). For unchanged Steps:

```
Step 1: elementIdentity = { testId: "search-btn", ... }
  First generation:     primaryLocator = { testId: "search-btn" }
  Regeneration:         primaryLocator = { testId: "search-btn" }
  Third regeneration:   primaryLocator = { testId: "search-btn" }

  Always the same. Deterministic. Idempotent.
```

The only field that changes across regenerations is the generation timestamp (metadata). All execution-relevant data is identical.

### 6.5 Components That Participate vs Do Not

| Component | Participates in Regeneration? | Role |
|---|---|---|
| Execution JSON Generator | ✅ Yes | Re-derives JSON from Steps |
| Locator Resolution Engine | ✅ Yes | Invoked by JSON Generator |
| Generation Engine | ✅ Yes | Orchestrates, validates, persists |
| Playwright Generator | ✅ Yes (if downstream) | Re-generates Playwright from new JSON |
| Side Panel | ✅ Yes | Triggers regeneration, displays result |
| Interaction Timeline | ❌ No | Never read during JSON regeneration (Steps are the input) |
| Recording Context | ❌ No | Not needed for locator resolution |
| AI Services | ❌ No | Never called during generation (deterministic) |
| Storage Service | ✅ Yes | Read Steps, write updated Steps |

---

## Stage 7 — Failure Handling

### 7.1 Failure Isolation

The Execution JSON Generator can fail independently of the Canonical Step Generator and the Playwright Generator. Failures are isolated:

```
Canonical Step Generator: SUCCESS → 10 Steps produced
Execution JSON Generator: PARTIAL → 8 Steps have JSON, 2 failed
Playwright Generator:     SUCCESS → Playwright code generated from 8 steps
```

Each generator's failure does not cascade backward. The Canonical Step Generator's output (Steps) is preserved even if the JSON Generator fails. The JSON Generator's output (Steps with JSON) is preserved even if Playwright fails.

### 7.2 Generation Failure (Complete)

If the Execution JSON Generator fails entirely (no JSON produced for any step):

1. Steps (from the Canonical Step Generator) are preserved — they are the input, not the output.
2. No Steps are written to storage (the batch write doesn't happen).
3. Test Case stays in GENERATING state.
4. Side panel shows: "Execution JSON generation failed. [Retry] [Discard]"
5. Retry re-runs the JSON Generator on the same Steps.
6. Discard clears Steps and returns to RECORDED (Timeline preserved).

### 7.3 Partial Generation

If the JSON Generator succeeds for some steps but fails for others (B2 §7.4):

```
Step 1: JSON generated ✅
Step 2: JSON generated ✅
Step 3: Locator resolution failed — elementIdentity has no accepted locators ⚠️
Step 4: JSON generated ✅
```

Result:
1. Steps 1, 2, 4 have `executionJson` populated normally.
2. Step 3's `executionJson` contains an **error marker** (not null — null means "not yet generated"; error means "attempted and failed"). The error marker includes: a failure reason, the step index, and a recoverable flag.
3. The Test Case transitions to GENERATED with a partial-success flag.
4. The Playwright Generator receives all steps. For step 3, it generates a commented-out placeholder (e.g., `// Step 3: execution JSON generation failed — locator resolution could not find a valid locator`).
5. Side panel shows: "Generation completed with 1 warning."
6. User can retry JSON generation for the failed step, or manually address the issue (e.g., the element had no testable identity).

### 7.4 Validation Failure

If the generated Execution JSON fails validation (e.g., a step has JSON but it doesn't satisfy the contract — missing primary locator, invalid action type):

1. The failing step is treated as a partial failure (§7.3).
2. The Generation Engine logs the validation error.
3. Other steps proceed normally.

### 7.5 Recovery

| Failure Scenario | Recovery Path | Data Preserved |
|---|---|---|
| Complete JSON generation failure | Retry JSON Generator on same Steps | Steps, Timeline, Context |
| Partial failure (some steps) | Retry JSON Generator on same Steps (failed steps may succeed on retry; deterministic, so retry only helps if the failure was transient) | Steps, Timeline, Context |
| Locator resolution failure for one step | Mark step as failed, continue with others | Other steps' JSON, Steps, Timeline |
| Storage write failure | Retry storage write | Steps with JSON (in memory) |
| Generation Engine crash (MV3 SW termination) | Auto-retry on SW restart (B2 §2.3) | Timeline (immutable in storage) |

### 7.6 What Never Happens

- **The Timeline is never destroyed by a JSON generation failure.** The Timeline is never touched by the generator.
- **Previously generated Steps are never corrupted.** The batch write either replaces all Steps or doesn't write (atomic).
- **The user is never stuck with no recovery path.** Retry and Discard are always available.
- **Partial failures never silently pass.** The partial-success flag is visible in the UI and in the Test Case state.

---

## Stage 8 — Extensibility

### 8.1 Adding New Code Generators

When CmdRunner adds a new framework export (e.g., Cypress):

```
1. Create CypressGenerator implementing GeneratorContract
2. Register in GeneratorRegistry:
   generatorRegistry.register(cypressGenerator)
3. CypressGenerator declares dependency on execution-json-generator
4. Generation Engine invokes it after JSON generation
5. CypressGenerator reads step.executionJson (same data Playwright reads)
6. Produces Cypress test code
```

**What does NOT change:**
- The Execution JSON Generator — it already produces the JSON.
- The Locator Resolution Engine — locators are already resolved.
- The Generation Engine — it already orchestrates via the registry.
- The Canonical Step Generator — it already produces Steps.
- The storage model — JSON is already embedded in Steps.

**Effort: one new file (CypressGenerator).** No existing component is modified.

### 8.2 Adding New Execution Engines

When CmdRunner adds an execution engine (e.g., CmdRunner's own test runner):

```
1. Execution Engine reads GENERATED_STEPS from storage
2. For each step, reads step.executionJson
3. Translates executionJson into browser automation actions
4. No new generator needed — the engine consumes, not generates
```

**What does NOT change:**
- Everything. The execution engine is a pure consumer. It reads the Execution JSON exactly as code generators do. No pipeline modification.

### 8.3 Adding New Locator Strategies

When CmdRunner adds a new locator strategy (e.g., visual locators):

```
1. Add visual locator support to the Locator Resolution Engine
2. Engine can now produce { strategy: "visual", value: "..." } as a locator
3. Execution JSON Generator embeds it in the Execution Object
4. Code generators that support visual locators use them; others fall back
```

**What does NOT change:**
- The Execution JSON Generator — it already delegates to the Locator Resolution Engine.
- The Generation Engine — no change.
- The storage model — JSON structure accommodates new strategy types (additive per B4.2 §6.1).

### 8.4 Adding New Action Types

When CmdRunner adds a new action type (e.g., text entry, dropdown select):

```
1. Content script captures the new interaction type
2. Canonical Step Generator produces a step with the new actionType
3. Execution JSON Generator handles the new actionType (produces appropriate execution data)
4. Locator Resolution Engine resolves locators for the element
5. Code generators translate the new action into framework-specific calls
```

**What does NOT change:**
- The Generation Engine — it invokes generators generically.
- The storage model — executionJson accommodates new action types (additive).
- The registry — no change.

### 8.5 The Extensibility Guarantee

The architecture is designed so that every future capability is **additive**:

| Future Capability | What Changes | What Doesn't |
|---|---|---|
| New code generator | One new file | All existing components |
| New execution engine | New consumer (reads JSON) | All existing components |
| New locator strategy | Locator Resolution Engine extended | JSON Generator, Engine, storage |
| New action type | Content script + JSON Generator + code generators | Engine, registry, storage structure |
| New information category | Execution JSON schema extended | Architecture, ownership, boundaries |

No future capability requires modifying the Generation Engine, the registry, or the ownership model.

---

## Stage 9 — Architecture Principles

### AP1 — Single Responsibility

Every component in the Execution JSON lifecycle has exactly one responsibility. The JSON Generator creates JSON. The Locator Resolution Engine resolves locators. The Generation Engine orchestrates. Code generators consume. The UI displays. No component performs another's role.

### AP2 — One Owner for Every Artifact

At every point in the lifecycle, exactly one component owns the Execution JSON:
- During generation: the Execution JSON Generator owns it (creating it).
- After persistence: the Test Case owns it (via Steps).
- During regeneration: the Generation Engine owns it (replacing it).
- During consumption: the consumer reads it (read-only — ownership remains with the Test Case).

No two components simultaneously own the JSON. Ownership transfers cleanly: Generator → Engine → storage (Test Case).

### AP3 — One-Way Dependencies

Dependencies flow strictly downstream:

```
Timeline → Steps → Execution JSON → Playwright Code
```

No component reads backward:
- The JSON Generator never reads Playwright output.
- The Playwright Generator never reads the Timeline.
- The Locator Resolution Engine never reads the JSON output of a previous step.

This prevents circular dependencies and ensures that changes propagate in one direction only.

### AP4 — Immutable Generated Artifacts

Once generated, the Execution JSON is immutable. It is replaced on regeneration (the old JSON is discarded), never edited in place. This immutability ensures that the JSON is always a complete, consistent snapshot — never a partially-updated mess. (B4.5 EJ-P3, B4.2 EO-P7.)

### AP5 — Deterministic Generation

The Execution JSON Generator is a pure function: same Steps in → same JSON out. No randomness, no environmental variation, no AI inference. The Locator Resolution Engine is also deterministic: same identity → same locators. This determinism guarantees that regeneration is idempotent and that all consumers see consistent data. (B4.5 EJ-P2, B4.4 LP-P1.)

### AP6 — Framework-Independent Architecture

No component in the architecture is coupled to Playwright, Cypress, or any specific framework. The Execution JSON Generator produces framework-agnostic data. Code generators are pluggable consumers. The architecture supports any framework that can consume the Execution JSON format. (B4.5 EJ-P1.)

### AP7 — Regeneration Replaces Rather Than Mutates

Regeneration discards the old Execution JSON and creates a new one. It does not patch, update, or merge. This is simpler (no diff tracking), safer (no partial updates), and consistent with the pure-function model (generators return new values, not mutations). (B4.2 §5.1.)

### AP8 — Consumers Never Modify Producers

Code generators, execution engines, and the UI read the Execution JSON. None of them writes to it, modifies it, or feeds back into it. The data flow is strictly producer → consumer. No consumer is ever a producer. (B4.5 §2.2.)

### AP9 — Future Consumers Integrate Without Redesign

New code generators, new execution engines, new locator strategies, and new action types are all additive. They require new code (a new generator, a new engine module) but no changes to existing architecture. The registry, the engine, the ownership model, and the boundary contracts are stable. (B4.5 EJ-P8.)

---

## Stage 10 — Consistency with Frozen Predecessors

### 10.1 Alignment with B2 (Artifact Generation Architecture)

| B2 Decision | B5.1 Alignment |
|---|---|
| Generation Engine is sole orchestrator (§2.3) | ✅ AP2, AP3: engine orchestrates, one-way dependencies. |
| Pipeline: Canonical Steps → JSON → Playwright (§2.2) | ✅ §1.1: same pipeline, same order. |
| Generators are pure functions (§3.1 AP1) | ✅ AP5: deterministic generation. |
| Execution JSON Generator populates executionJson (§3.3) | ✅ §3.2: same contract, same output. |
| Locator Resolution Engine (§3.3) | ✅ §5.2: invoked by JSON Generator, pure function. |
| Navigation synthetic locator (§3.3) | ✅ §3.3 step 5b: navigation gets synthetic JSON. |
| Failure isolation per generator (§7.1) | ✅ §7.1: same isolation model. |
| Partial success (§7.4) | ✅ §7.3: same partial-success behavior. |
| Retry creates new instance (§7.3) | ✅ §7.5: retry re-runs on same Steps. |
| Regeneration triggers T1-T6 (§6.1) | ✅ §6.1: same triggers, same behavior. |
| Idempotency guarantee (§6.4) | ✅ §6.4: same guarantee. |

### 10.2 Alignment with B4.5 (Execution JSON Product Specification)

| B4.5 Decision | B5.1 Alignment |
|---|---|
| Execution JSON is serialized form of Execution Object (§1.3) | ✅ §3.2: generator serializes the Object into JSON. |
| Self-contained for consumption (§3.5) | ✅ §5.4: code generators read only executionJson. |
| Never manually edited (EJ-P3) | ✅ §2.2: nobody may modify in place. AP4: immutable. |
| Framework-agnostic (EJ-P1) | ✅ AP6: framework-independent architecture. |
| Engine-independent (EJ-P5) | ✅ §5.1: JSON Generator does not include engine config. |
| Star topology for exports (Stage 7) | ✅ §8.1: new generators are additive spokes. |
| Owns execution data; does NOT own recording/review/results (§4) | ✅ §5 boundaries: generator reads only Steps, not Timeline/review/results. |

### 10.3 Alignment with B4.4 (Locator Priority Strategy)

| B4.4 Decision | B5.1 Alignment |
|---|---|
| Priority hierarchy operates on available candidates (§2.1.1) | ✅ §5.2: Locator Resolution Engine applies hierarchy to available identity. |
| Max 3 locators: primary, secondary, fallback (§3.6) | ✅ §3.2 step 3: engine returns exactly these roles. |
| Acceptance rules reject auto-generated IDs (§4.3) | ✅ §5.2: engine detects and rejects. |
| Deterministic selection (LP-P1) | ✅ AP5. |

### 10.4 Alignment with B4.2 (Execution Object Design)

| B4.2 Decision | B5.1 Alignment |
|---|---|
| Six information categories (Stage 3) | ✅ §3.2 step 4: generator constructs Object with all six categories. |
| Execution JSON Generator is sole creator (§2.1) | ✅ §2.2: same ownership. |
| Replace-on-change mutability (§5.1) | ✅ AP7: regeneration replaces. |
| Traceability via interaction ID (§4.2) | ✅ §3.1: generator reads linkedInteractionId from Step. |

### 10.5 Alignment with B3 (Generation Engine Foundation)

| B3 Decision | B5.1 Alignment |
|---|---|
| Generator Registry with topological sort | ✅ §3.6: JSON Generator registers with dependency on canonical-step-generator. |
| Generation Engine invokes generators via registry | ✅ §3.6: no engine modification needed. |
| Batch persistence | ✅ §4.3: single batch write for all Steps. |
| GENERATED_STEPS storage key | ✅ §1.3: JSON embedded in Steps under this key. |

### 10.6 Existing Code Conflicts

B2 §1.2 identified conflicts between the architecture and existing code. B5.1 does not introduce new conflicts. The B3 implementation already:
- Removed live step generation (steps are generated post-Stop only). ✅
- Uses GENERATED_STEPS storage key. ✅
- The Generation Engine orchestrates via registry. ✅

The only remaining code changes needed for B5.4 (Implementation) are:
- Implement the Execution JSON Generator (new file).
- Implement the Locator Resolution Engine (new file or extracted from existing `step-builder.ts` patterns).
- Register the JSON Generator in the registry.
- These are implementation tasks for B5.4, not architectural conflicts.

### 10.7 No Conflicts Found

B5.1 is fully consistent with all frozen predecessors. It deepens B2's high-level architecture with Execution-JSON-specific operational detail. No frozen decision is modified.

---

## Stage 11 — Assumptions and Open Questions

### 11.1 Assumptions

1. **The Canonical Step Generator (B3) is complete.** Steps with `executionJson = null` are available as input. (B3, frozen)

2. **The Generation Engine and Registry (B3) are complete.** The JSON Generator registers and is invoked through existing infrastructure. (B3, implemented)

3. **Element identity on Steps contains all locator candidates captured during recording.** The generator works with what was captured — no post-recording discovery. (B2 §3.2, B4.3 §8.1)

4. **Locator resolution follows the frozen B4.4 priority hierarchy.** The Locator Resolution Engine implements B4.4's rules. (B4.4, frozen)

5. **Navigation steps produce synthetic execution JSON.** No element identity, but still one Execution Object per step. (B2 §3.3, B4.4 §4.5)

6. **The `step-builder.ts` file (legacy, from pre-B3 architecture) contains locator resolution logic that can inform the Locator Resolution Engine implementation.** It is not imported — the new engine is written fresh — but its priority order (testId → dataCy → dataQa → id → ariaLabel → name → css → xpath) confirms the B4.4 hierarchy. (B2 §3.3)

### 11.2 Open Questions (Deferred to B5.2 Schema and B5.4 Implementation)

1. **What are the exact JSON field names and structure?** Deferred to B5.2 (Execution JSON Schema Design).

2. **How is the error marker represented in a failed step's executionJson?** Deferred to B5.2. The architecture establishes that failed steps have a non-null error marker (not null, which means "not yet generated").

3. **How does the Locator Resolution Engine detect auto-generated IDs?** Deferred to B5.3/B5.4 (implementation). The architecture establishes the rule (reject them); the detection algorithm is implementation.

4. **Should the Execution JSON carry a schema version field?** Deferred to B5.2. The architecture accommodates either approach.

5. **How does the side panel render the Execution JSON for user review?** Deferred to a UI milestone. B3 already hides the section when null; B5.4 will populate it and a UI milestone will design the display.

6. **What is the exact retry behavior on MV3 service worker termination during JSON generation?** B2 §2.3 established auto-retry. The implementation detail (how many retries, what delay) is deferred to B5.4.

---

## Stage 12 — Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ JSON schema (field names, types, nesting, key naming)
- ❌ Serialization format (byte-level structure)
- ❌ Implementation code (generator logic, locator algorithms)
- ❌ Algorithms (auto-generated ID detection, CSS specificity scoring)
- ❌ UI design (how the panel displays JSON)
- ❌ Playwright generation (code mapping, test structure)

These belong to B5.2 (Schema), B5.3 (Generator Architecture), B5.4 (Implementation), and B6 (Playwright).

---

## Stage 13 — Freeze Declaration

Upon approval, the following is declared **frozen**:

### Frozen Architecture

1. **The Execution JSON Generator registers in the Generator Registry** with a dependency on the Canonical Step Generator. No Generation Engine modification is required. (§3.6)

2. **The Locator Resolution Engine is a capability invoked by the Execution JSON Generator**, not a separate generator. It is a pure function: element identity in, resolved locators out. (§5.2)

3. **Generation is per-step with error isolation.** A failure in one step's locator resolution does not prevent other steps from generating. Failed steps carry an error marker, not null. (§3.5, §7.3)

4. **The Execution JSON is embedded within Canonical Test Steps** under the `executionJson` field, stored under the `GENERATED_STEPS` key. No separate storage record. (§1.3)

5. **Regeneration replaces, never mutates.** The old JSON is discarded; new JSON is derived from current Steps. Batch write is atomic. (AP7, §4.5)

6. **Consumers are read-only.** Code generators, execution engines, and the UI read the Execution JSON. None modify it. (AP8, §5)

7. **Adding new framework generators is additive.** One new file, registered in the registry. No existing component changes. (§8.1)

8. **The architecture is framework-independent and engine-independent.** No component is coupled to Playwright or any execution engine. (AP6)

9. **Dependencies are strictly one-way.** Timeline → Steps → Execution JSON → Framework Code. No backward reads. (AP3)

10. **Future capabilities (new locators, new actions, new consumers) are additive.** No existing architecture component is modified. (AP9)

### What This Freeze Means

- B5.2 (Schema Design) must define JSON fields that carry the six B4.2 categories within this architecture.
- B5.3 (Generator Architecture) must design the generator's internal structure consistent with these boundaries.
- B5.4 (Implementation) must implement the generator, locator engine, and registry registration.
- No future milestone may bypass the Generation Engine, couple the JSON to a framework, or allow in-place mutation of executionJson.

---

*This document defines the Execution JSON Architecture for CmdRunner. All subsequent schema, generator, and implementation milestones must conform to this architecture.*
