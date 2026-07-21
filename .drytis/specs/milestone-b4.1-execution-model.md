# Milestone B4.1 — CmdRunner Execution Model

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Product Design (no implementation, no architecture, no code, no JSON schema)
**Depends on:**
- Product Foundation Design v1.0 (frozen)
- Product Architecture Design v1.0 (frozen)
- Milestone B1 — Post-Recording Artifact Generation Product Design (frozen)
- Milestone B2 — Post-Recording Artifact Generation Architecture (frozen)
- Milestone B3 — Artifact Generation Engine Foundation (frozen)

---

## 0. Purpose of This Document

The Generation Engine Foundation (B3) is complete. The Canonical Step Generator transforms a frozen Interaction Timeline into human-readable Canonical Test Steps.

The next milestone in the roadmap is B4 — Execution JSON Generation. Before defining the JSON schema, locator strategy, and implementation, we must first freeze the **CmdRunner Execution Model**: the conceptual framework that explains *what CmdRunner executes*, *why an execution representation exists separately from human-readable steps*, and *how it relates to every other artifact in the pipeline*.

This document introduces the **Execution Object** — a conceptual entity that sits between Canonical Test Steps and framework-specific exports. Defining this concept now prevents architectural drift later.

**This milestone defines no fields, no JSON structure, no locators, no implementation. It defines only the execution model as a concept.**

---

## Stage 1 — Purpose

### 1.1 What Is the CmdRunner Execution Model?

The CmdRunner Execution Model is the **framework-agnostic representation of executable test intent**. It is the layer that translates what a human did (captured interactions) into what a machine must do (executable actions), without binding to any specific test framework.

The execution model exists because there is a fundamental gap between human-readable test instructions and machine-executable test code:

- **Canonical Test Steps** describe what the test should do in human language: *"Click the 'Submit' button."* They are designed for review, editing, and approval by QA engineers. They contain no information about *how* to mechanically find and interact with an element.

- **Playwright Test code** describes how a specific framework executes the test: `await page.click('[data-testid="submit"]')`. It is designed for a specific runtime and contains framework-specific syntax.

The execution model fills this gap. It is the **machine-readable translation of human intent** — structured enough for code generators to consume without parsing natural language, yet abstract enough to remain valid across any framework.

### 1.2 What Problem Does It Solve?

Without an execution model, every code generator (Playwright today, Cypress tomorrow, Selenium next year) would need to independently:

1. Parse the human-readable plain English description of each step
2. Decide which locator to use from the element identity
3. Determine the action semantics (click vs type vs navigate)
4. Decide what to wait for after the action
5. Handle edge cases (navigation has no element, iframe context, Shadow DOM)

This duplicated logic would drift across generators, producing inconsistent behavior. A step that generates a working Playwright selector might generate a broken Cypress selector because each framework resolved locators differently.

The execution model **centralizes these decisions once**. Every code generator consumes the same resolved execution data and applies only its own syntax. The decisions about *what to do* are made once; only the *how to express it* differs per framework.

### 1.3 Why Does CmdRunner Require an Execution Representation?

CmdRunner's core promise is: **record once, execute anywhere**. A QA engineer records a workflow in the browser, and CmdRunner produces test code for their framework of choice.

For this promise to hold, there must be a single representation that:

- Is **resolved once** from the recording (locators, actions, wait strategies)
- Is **framework-agnostic** (contains no Playwright, Cypress, or Selenium syntax)
- Is **deterministic** (the same recording always produces the same execution model)
- Is **consumable by any code generator** without re-interpretation

That representation is the execution model. Without it, "record once, execute anywhere" becomes "record once per framework" — each framework would require its own pipeline from raw interactions to executable code.

### 1.4 Why Are Canonical Test Steps Alone Not Sufficient for Execution?

Canonical Test Steps are designed for **humans**, not machines. They are optimized for:

- **Readability** — plain English descriptions that a QA engineer can scan and edit
- **Review** — structured enough to approve or reject during review
- **Context** — AI enrichment, element identity, and traceability for understanding

But they are **not optimized for execution**:

| What Execution Needs | What Canonical Steps Provide |
|---|---|
| A resolved locator to use at runtime | Element identity with multiple possible locators (testId, dataCy, id, ariaLabel, css, xpath) — but no decision about which one to use |
| A concrete action type for the machine | A human action type ("click") that maps to different API calls in different frameworks |
| A wait strategy (what condition must be true before proceeding) | No wait information — the step describes *what* happened, not *what to wait for* |
| iframe and Shadow DOM context in machine terms | Element identity has iframe/shadow flags, but no resolved strategy for how a framework should reach the element |

Canonical Steps answer *"what should the test do?"* in human terms. The execution model answers *"what should the machine do?"* in machine terms. Both are necessary; neither is sufficient alone.

---

## Stage 2 — Relationship Between Artifacts

### 2.1 The Full Artifact Pipeline

```
INTERACTION TIMELINE
(factual record — what the user actually did)
        │
        │  Generated by: Canonical Step Generator (B3)
        │  Transformation: raw events → interpreted steps
        │
        ▼
CANONICAL TEST STEPS
(human-readable instructions — what the test should do)
        │
        │  Generated by: Execution JSON Generator (B4)
        │  Transformation: human steps → machine execution objects
        │
        ▼
EXECUTION OBJECTS
(framework-agnostic execution model — how to execute each step)
        │
        │  Serialized as: CmdRunner Execution JSON
        │  Relationship: Execution Objects are the concept;
        │                 Execution JSON is their serialized form
        │
        ▼
CMDRUNNER EXECUTION JSON
(machine-readable, serializable representation of execution objects)
        │
        │  Consumed by: Code Generators (Playwright, Cypress, etc.)
        │  Transformation: execution data → framework-specific code
        │
        ├──→ GENERATED PLAYWRIGHT TEST (v1.0 primary export)
        ├──→ FUTURE: CYPRESS TEST (derived export)
        ├──→ FUTURE: SELENIUM TEST (derived export)
        └──→ FUTURE: CUCUMBER FEATURE (derived export)
```

### 2.2 Responsibility of Each Artifact

| Artifact | Answers | Designed For | Mutability |
|---|---|---|---|
| **Interaction Timeline** | "What did the user actually do?" | Factual record (immutable evidence) | Delete-only (never edited) |
| **Canonical Test Steps** | "What should the test do?" | Human review and editing | Plain English editable; structural changes trigger downstream regeneration |
| **Execution Objects** | "What should the machine do?" | Machine consumption (code generators) | Never manually edited; always derived from Steps |
| **CmdRunner Execution JSON** | "How do we serialize the execution model?" | Storage and transport | Never manually edited; always derived from Steps |
| **Generated Playwright Test** | "How does Playwright execute this test?" | One specific framework | Editable (sets `isManualEdit`); derived from Steps |

### 2.3 Ownership

| Artifact | Owner | Who Writes It | Who Reads It |
|---|---|---|---|
| Interaction Timeline | Recording Session (during recording) | Content scripts + Service Worker | Canonical Step Generator |
| Canonical Test Steps | Generation Engine (after Stop) | Canonical Step Generator | Execution JSON Generator, User (review), Playwright Generator |
| Execution Objects | Generation Engine (after Steps) | Execution JSON Generator | Code Generators |
| CmdRunner Execution JSON | Generation Engine (serialized form) | Execution JSON Generator | Code Generators (serialized transport) |
| Generated Playwright Test | Generation Engine (after JSON) | Playwright Generator | User (review, edit), CI/CD |

**Key ownership rule:** No artifact writes backward. The Timeline feeds Steps; Steps feed Execution Objects; Execution Objects feed Code Generators. Data flows in one direction only. Editing a downstream artifact (e.g., Playwright code) never propagates backward.

### 2.4 Why Each Artifact Exists

**Interaction Timeline exists** because raw browser events are factual and immutable. They represent what really happened. No generation logic should alter them. They are the ground truth from which everything else derives.

**Canonical Test Steps exist** because humans need to review, understand, and edit test instructions. Raw events are too low-level for review. Playwright code is too framework-specific for review. Steps bridge this gap with plain English + structured data that a QA engineer can confidently approve.

**Execution Objects exist** because code generators need resolved, unambiguous execution data. Steps describe intent in human terms ("click the Submit button"). Code generators need machine terms ("find element by testId 'submit', perform click action, wait for navigation"). Execution Objects make that translation once, centrally.

**CmdRunner Execution JSON exists** because Execution Objects must be serialized for storage and transport. The JSON is the persistent form of the execution model — it is what gets stored on the Test Case and read by code generators at generation time.

**Generated Playwright Test exists** because QA teams need runnable test code immediately. It is the v1.0 primary export — the artifact that makes CmdRunner useful on day one. It is one consumer of the execution model, not the execution model itself.

---

## Stage 3 — Execution Object

### 3.1 What Is an Execution Object?

An Execution Object is the **machine-resolved representation of a single test step's execution requirements**. It is the answer to: *"If a machine needed to perform this step, what would it need to know?"*

An Execution Object is **not**:
- A raw browser event (that's the Timeline)
- A human instruction (that's the Canonical Test Step)
- Framework-specific code (that's Playwright/Cypress)
- A data format or serialization (that's Execution JSON)

An Execution Object **is**:
- The resolved intent of one step, expressed in terms a machine can act on
- Framework-agnostic — it says *what* to do, never *how* a specific framework should do it
- Deterministic — the same Canonical Step always produces the same Execution Object
- Immutable once generated — it is derived, never hand-edited

### 3.2 Why Every Canonical Test Step Maps to Exactly One Execution Object

The mapping is **1:1** — each Canonical Test Step produces exactly one Execution Object.

**Why 1:1, not 1:many:**

A Canonical Test Step represents one user action: one click, one navigation, one text entry. That action requires exactly one execution resolution: one locator decision, one action type, one wait strategy. There is no scenario where one human-readable step should produce multiple machine actions — that would mean the step is ambiguous, which violates the principle that steps represent confident classification.

**Why not many:1:**

Multiple steps should never collapse into one Execution Object. Each step is independent and ordered. Collapsing steps would lose ordering information, traceability to the timeline, and the ability to independently review and delete steps. One step in, one execution object out.

**What about steps that seem to need multiple actions?**

Some user actions are composite at the browser level (e.g., clicking a button that opens a dropdown and then selecting an option might be two clicks). But at the Canonical Test Step level, each interaction is already a discrete step — click to open is one step, click to select is another. The 1:1 mapping holds because the Canonical Step Generator already split composite interactions into individual steps.

The one exception is **navigation**: a navigation step does not have an element to interact with. Its Execution Object represents a URL transition, not an element action. But it is still one step → one Execution Object. The execution object simply describes a different kind of action.

### 3.3 Why Execution Objects Exist Independently of Playwright

Execution Objects exist independently of Playwright for the same reason Canonical Test Steps do: **framework independence**.

If Execution Objects were Playwright-specific:

- Adding Cypress support would require a completely separate execution model for Cypress.
- Every Playwright API change would require re-deriving execution data from steps.
- The Test Case would be permanently locked to Playwright's execution semantics.
- Switching frameworks would mean re-recording tests.

By keeping Execution Objects framework-agnostic:

- Adding Cypress means writing a Cypress code generator that reads the same Execution Objects.
- Playwright API changes only affect the Playwright code generator, not the execution model.
- The Test Case retains its execution value even if the team switches frameworks.
- New framework support is a new translator, not a new recording.

### 3.4 How Execution Objects Become the Execution Representation of a Test Case

A Test Case's execution representation is the **ordered set of Execution Objects** — one per Canonical Test Step. Together, they form a complete, framework-agnostic description of what a machine must do to replay the recorded workflow:

1. **Canonical Step Generator** (B3, complete) transforms the Interaction Timeline into Canonical Test Steps.
2. **Execution JSON Generator** (B4, next) transforms each Canonical Test Step into one Execution Object.
3. The ordered set of Execution Objects **is** the Test Case's execution representation.
4. This set is serialized as CmdRunner Execution JSON for storage.
5. Code generators (Playwright, Cypress, etc.) consume the serialized Execution Objects to produce framework-specific test code.

The execution representation is **derived, not authored**. No human writes Execution Objects. They are always machine-generated from Canonical Test Steps and machine-consumed by code generators.

---

## Stage 4 — Source of Truth

### 4.1 The Source-of-Truth Hierarchy

CmdRunner has **three sources of truth**, each authoritative in its own domain:

| Source | Domain | Authority |
|---|---|---|
| **Interaction Timeline** | Recording (what happened) | The factual record. Nothing overrides it. It is the raw input from which all artifacts derive. |
| **Canonical Test Steps** | Human interpretation (what the test should do) | The interpreted record. This is what humans review, edit, and approve. It is authoritative for test semantics. |
| **Execution Objects** | Machine execution (what the machine should do) | The execution record. This is what code generators consume. It is authoritative for how the test is mechanically executed. |

### 4.2 Why This Separation Exists

A single source of truth cannot serve all three domains:

- **Recording** requires immutability and factual accuracy. The Timeline must never change — it is evidence of what happened.
- **Human interpretation** requires editability and readability. Steps must be reviewable in plain English, editable for clarity, and approvable as correct.
- **Machine execution** requires resolution and unambiguousness. Execution Objects must have decided locators, action types, and wait strategies — no ambiguity for the machine.

If the Timeline were also the execution source, then locator resolution would be frozen at capture time with no opportunity for the system to apply strategy. If Steps were also the execution source, then every code generator would need to parse English and resolve locators independently. If Playwright were the execution source, the Test Case would be locked to one framework.

The three-source model ensures each artifact is optimized for its purpose:

- Timeline: **truth** (what happened)
- Steps: **meaning** (what it means)
- Execution Objects: **action** (what to do)

### 4.3 Playwright Is Not a Source of Truth

Playwright is a **derived export** — one consumer of the execution model. It is never a source of truth.

This means:

- If Playwright code is manually edited, the edit is an **override** (flagged with `isManualEdit`), not a new truth. The Canonical Steps and Execution Objects remain authoritative.
- If Canonical Steps change (e.g., a step is deleted), the Execution Objects regenerate, and the Playwright test regenerates from the new Execution Objects (unless `isManualEdit` is true, in which case the user is prompted).
- If a team switches from Playwright to Cypress, the Canonical Steps and Execution Objects are unchanged. Only the export format changes.

### 4.4 Derivation Flow (One Direction)

```
Interaction Timeline (recording source)
        │
        │  derives ↓ (never ↑)
        ▼
Canonical Test Steps (human interpretation source)
        │
        │  derives ↓ (never ↑)
        ▼
Execution Objects (execution source)
        │
        │  derives ↓ (never ↑)
        ▼
Generated Playwright Test (derived export)
```

**Derivation never flows backward.** Editing Playwright does not change Execution Objects. Editing Execution Objects is not possible (they are always derived). Editing Steps regenerates Execution Objects. Deleting Timeline events removes corresponding Steps (and their Execution Objects).

This one-way flow is the architectural invariant that guarantees consistency across all artifacts and all future frameworks.

---

## Stage 5 — Relationship to Playwright

### 5.1 Why Playwright Is Not the Source of Truth

Playwright is a specific test automation framework with its own API, selectors, and execution model. If Playwright were the source of truth:

| Problem | Consequence |
|---|---|
| Framework lock-in | The Test Case would be permanently bound to Playwright. Switching to Cypress would require re-recording. |
| API coupling | Playwright API changes (deprecated methods, new locator strategies) would require re-deriving from steps — or worse, re-recording. |
| Editing impossibility | If a tester edits a step during review, the system would need to reverse-engineer Playwright code back into steps. This is impractical and error-prone. |
| Multi-framework conflict | If both Playwright and Cypress tests exist, which one is the source of truth? The question has no clean answer. |
| Loss of abstraction | The Test Case would lose its framework-agnostic value. It becomes a Playwright test, not a CmdRunner Test Case. |

By keeping Playwright as a derived export, none of these problems arise. The Test Case remains valuable and portable. Playwright is one way to execute it — not the definition of it.

### 5.2 Why Execution JSON Must Remain Framework-Agnostic

Execution JSON is the serialized form of Execution Objects. If it contained framework-specific syntax (e.g., `page.click('[data-testid="submit"]')`), it would be Playwright Execution JSON, not CmdRunner Execution JSON.

Framework-agnostic execution data means:

- `action: "click"` — not `page.click()` or `cy.get().click()`
- Locator is expressed as a strategy + value — not as a Playwright selector string
- Wait strategy is expressed as a condition — not as a Playwright `waitFor` call

Each code generator translates these abstract representations into its own syntax. The execution model never takes sides.

### 5.3 Why Future Execution Formats Should Derive from Execution JSON Rather Than from Playwright

When CmdRunner adds Cypress support (or Selenium, or Cucumber), the new code generator should read the same Execution JSON that the Playwright generator reads — not parse the generated Playwright test.

**Deriving from Execution JSON:**

```
Execution JSON → Cypress Generator → Cypress Test
```

- Clean, structured input designed for machine consumption.
- No ambiguity — locators and actions are already resolved.
- Consistent with Playwright output (same execution model, different syntax).
- Adding a framework is additive: one new generator, zero changes to existing artifacts.

**Deriving from Playwright (anti-pattern):**

```
Execution JSON → Playwright Generator → Playwright Test → Cypress Parser → Cypress Test
```

- Requires parsing TypeScript code back into structured data.
- Playwright-specific patterns (e.g., `page.locator()` vs `page.click()`) may not map cleanly to Cypress.
- Any Playwright-specific workaround in the generated code would be misinterpreted by the Cypress parser.
- Changes to the Playwright generator would break the Cypress parser.
- The chain grows longer and more fragile with each new framework.

**The principle:** Execution JSON is the single derivation point for all code generators. No generator reads another generator's output. The derivation graph is a star, not a chain.

---

## Stage 6 — Product Principles

### EP1 — Every Canonical Test Step Maps to Exactly One Execution Object

The mapping is strictly 1:1. One step in, one execution object out. This guarantees that the execution representation has the same granularity as the human-readable representation — no steps are merged, no steps are split. If a step exists in review, it exists in execution. If a step is deleted in review, its execution object disappears.

### EP2 — Execution Objects Represent Intent, Not Browser Events

An Execution Object is not a replay of a browser event. It is the **resolved intent** of a test step. A click event in the Timeline has coordinates, timestamps, and DOM state. An Execution Object has a locator, an action type, and a wait strategy. The execution model abstracts away the accidental details of the recording (where exactly the mouse was, how fast the click was) and retains only the essential details (what element to interact with, what action to perform, what to wait for).

### EP3 — Execution Objects Are Framework-Agnostic

An Execution Object contains no Playwright, Cypress, Selenium, or Cucumber syntax. It describes *what* to do, not *how* a specific framework should do it. This ensures the execution model remains valid regardless of which frameworks are supported now or in the future. Adding a new framework requires a new code generator, not a new execution model.

### EP4 — Execution Objects Are Deterministic

The same Canonical Test Step always produces the same Execution Object. Given the same step data (element identity, action type, AI enrichment), the Execution JSON Generator makes the same decisions every time: the same locator is chosen, the same action type is assigned, the same wait strategy is applied. There is no randomness, no AI inference at generation time, and no environmental variation. This determinism guarantees that regeneration is idempotent and that the execution model is reproducible.

### EP5 — Playwright Is a Derived Artifact

Playwright test code is generated from Execution Objects, never the other way around. Playwright is one consumer of the execution model — the v1.0 primary export. It is not the execution model itself. Manual edits to Playwright code are overrides (flagged with `isManualEdit`), not changes to the source of truth. The execution model and canonical steps remain authoritative.

### EP6 — Future Execution Engines Consume the Same Execution Model

When CmdRunner adds support for Cypress, Selenium, Cucumber, or any future test framework, the new code generator reads the same Execution JSON that the Playwright generator reads. No new execution model is created per framework. No re-recording is required. The execution model is written once and consumed by all.

### EP7 — Future Export Formats Should Require No Redesign of the Execution Model

Adding a new export format (e.g., Cucumber Gherkin, Postman collections, REST API test scripts) should require only a new code generator — never a change to the Execution Object concept, the derivation pipeline, or the source-of-truth hierarchy. The execution model is designed to be sufficiently expressive that any reasonable test execution format can be derived from it without extension.

---

## Stage 7 — Assumptions and Open Questions

### 7.1 Assumptions

These assumptions are inherited from frozen predecessors (B1, B2, Product Foundation). They are documented here for completeness; none represent new decisions.

1. **Element identity is captured at click time and is immutable.** The locators available to the Execution JSON Generator are whatever was extracted from the DOM during recording. If the recording captured no testId, the execution model has no testId. (Product Architecture §6.4, B2 §3.2)

2. **AI enrichment is already attached to timeline events during recording.** The Execution JSON Generator does not call AI. It reads AI enrichment from the step (projected from the timeline event by the Canonical Step Generator). (B2 §3.2, AP: AI boundary protects determinism)

3. **Locator resolution is deterministic.** Given the same element identity, the Locator Resolution Engine always selects the same primary locator. The priority order is fixed (testId → dataCy → dataQa → id → ariaLabel → name → css → xpath). (B2 §3.3, Milestone 2 Architecture)

4. **The Canonical Step Generator (B3) is complete and frozen.** Execution Objects derive from Canonical Steps. The step structure — stepNumber, actionType, plainEnglish, elementIdentity, aiEnrichment, linkedInteractionId, executionJson (currently null) — is the input contract for the Execution JSON Generator. (B2 §3.2, B3 frozen)

5. **Navigation steps are a special case.** Navigation interactions have no element to interact with. Their Execution Objects represent URL transitions, not element actions. The B2 architecture already accounts for this (B2 §3.3: synthetic locator for navigation). This does not break the 1:1 mapping — navigation steps still produce one Execution Object each.

### 7.2 Open Questions (Deferred to Later Milestones)

These questions are intentionally deferred. They belong to B4.2 (JSON schema), B4.3 (architecture), or B4 implementation — not to this execution model definition.

1. **What fields does an Execution Object contain?** Deferred to B4.2. This milestone defines the concept, not the contents.

2. **How are locators serialized in Execution JSON?** Deferred to B4.2. This milestone establishes that locator resolution is centralized, but does not define the serialization format.

3. **How are wait strategies determined?** Deferred to B4.2/B4.3. This milestone establishes that Execution Objects contain wait strategy as a concept, but does not enumerate the strategies.

4. **How does the Execution JSON Generator integrate with the Generation Engine?** Deferred to B4.3 (architecture) and B4 (implementation). B3 already established that the engine invokes generators via the registry — the JSON Generator will follow the same pattern.

5. **How are unknown action types handled?** Deferred to B4.2. This milestone establishes that Execution Objects are deterministic, but does not define the fallback behavior for unrecognized actions.

6. **How does iframe/Shadow DOM context affect the execution model?** Deferred to B4.2. Element identity already captures iframe and Shadow DOM flags. How these translate to execution strategy is a schema and implementation concern.

---

## Stage 8 — Consistency with Frozen Predecessors

This section documents how the Execution Model aligns with — and does not conflict with — previously frozen decisions.

### 8.1 Alignment with B1 (Post-Recording Artifact Generation)

| B1 Decision | Execution Model Alignment |
|---|---|
| Generation order: Timeline → Steps → JSON → Playwright (B1 §13, Decision 1) | ✅ The Execution Model introduces "Execution Objects" as a conceptual layer between Steps and JSON. This does not change the generation order — Execution Objects are what the JSON Generator produces. The JSON is the serialized form. The pipeline remains: Timeline → Steps → Execution Objects (= JSON) → Playwright. |
| Canonical Steps + Execution JSON is the source of truth (B1 §13, Decision 2) | ✅ This document refines "Execution JSON" into "Execution Objects (serialized as Execution JSON)." The source-of-truth model is unchanged — Execution Objects are the execution source, serialized as JSON. |
| Execution JSON is always derived from Steps (B1 §13, Decision 7) | ✅ Execution Objects are never manually edited. They are always derived from Canonical Test Steps. |
| Future execution formats derive from Canonical Steps (B1 §13, Decision 11) | ✅ This document refines: future formats derive from Execution Objects, which are derived from Steps. The derivation chain is Steps → Execution Objects → Framework Export. This is consistent — the Steps are still the root; Execution Objects are the intermediate representation. |
| Workflow is framework-agnostic at Steps and JSON level (B1 §13, Decision 12) | ✅ Execution Objects are framework-agnostic by design (EP3). |

### 8.2 Alignment with B2 (Artifact Generation Architecture)

| B2 Decision | Execution Model Alignment |
|---|---|
| Execution JSON Generator populates `executionJson` on each step (B2 §3.3) | ✅ The Execution JSON Generator produces Execution Objects and serializes them into the `executionJson` field. The contract is unchanged — Steps still get `executionJson` populated. |
| Locator Resolution Engine resolves locators (B2 §3.3) | ✅ The Execution Model centralizes locator resolution in the Execution JSON Generator. The Locator Resolution Engine is the mechanism; the Execution Object is the output. |
| Navigation steps get synthetic locators (B2 §3.3) | ✅ Navigation Execution Objects represent URL transitions, consistent with B2's synthetic locator approach. |
| Generators are pure functions (B2 AP1) | ✅ Execution Objects are deterministic (EP4). The JSON Generator is a pure function: Steps in, Execution Objects out. |
| AI boundary protects determinism (B2 Refinement 1) | ✅ No AI is called during Execution Object generation. AI enrichment is read from Steps, never invoked. |

### 8.3 No Conflicts Found

This document introduces the **Execution Object** as a named concept. This is a **clarification**, not a change:

- B1 and B2 refer to "Execution JSON" as a monolithic artifact. This document names the conceptual entity ("Execution Object") that the JSON serializes.
- The pipeline, source-of-truth model, derivation rules, and framework-agnosticism are all preserved exactly.
- No frozen decision is modified, contradicted, or overridden.

---

## Stage 9 — Success Criteria

This milestone is complete when a future developer can clearly answer:

| Question | Answer (from this document) |
|---|---|
| What does CmdRunner actually execute? | Execution Objects — the framework-agnostic, machine-resolved representation of each test step's execution requirements. |
| Why does the Execution Model exist? | To centralize the translation from human intent (Steps) to machine action (framework-specific code) — resolved once, consumed by all frameworks. |
| Why isn't Playwright the execution source? | Because Playwright is framework-specific. Making it the source would lock Test Cases to Playwright forever, prevent multi-framework support, and require reverse-engineering code back into steps when steps change. |
| How does a recorded interaction become something executable? | Timeline (raw event) → Canonical Step (human interpretation) → Execution Object (machine resolution) → Framework code (Playwright/Cypress). Each stage adds resolution; none removes information. |
| What is the responsibility of each artifact? | Timeline = what happened. Steps = what it means. Execution Objects = what to do. Playwright = how one framework does it. |

---

## 10. Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ JSON schema (field names, nesting, types)
- ❌ Locator strategy details (priority order, fallback behavior)
- ❌ Execution action enumeration (click, navigate, type, select, etc.)
- ❌ Context model (iframe handling, Shadow DOM strategy)
- ❌ Serialization format (JSON structure, property naming)
- ❌ Storage model (where Execution JSON is stored, how it's keyed)
- ❌ Implementation (generator code, engine integration)
- ❌ Playwright generation (code mapping, test structure)

These belong to B4.2 (Execution JSON Specification), B4.3 (Architecture), and B4 (Implementation).

---

## 11. Freeze Declaration

Upon approval, the following is declared **frozen** and must not be redesigned:

### Frozen Concepts

1. **The Execution Object is the machine-resolved representation of a Canonical Test Step.** It is conceptually distinct from both the human-readable step and the framework-specific code.

2. **Every Canonical Test Step maps to exactly one Execution Object.** The mapping is 1:1.

3. **Execution Objects are framework-agnostic.** They contain no Playwright, Cypress, Selenium, or Cucumber syntax.

4. **Execution Objects are deterministic.** Same step → same execution object. Always.

5. **Execution Objects represent intent, not browser events.** They abstract away recording-specific details and retain only what the machine needs.

6. **Playwright is a derived artifact.** It is one consumer of Execution Objects, not the execution source.

7. **Future execution formats derive from Execution Objects.** Not from Playwright. Not from Canonical Steps directly. The star topology (Execution Objects at center, each framework a spoke) is the permanent derivation model.

8. **The three-source-of-truth model is canonical.** Timeline (recording), Steps (human interpretation), Execution Objects (machine execution). Each is authoritative in its domain. None overrides another.

9. **Derivation is one-way.** Timeline → Steps → Execution Objects → Framework Code. Never backward.

10. **No frozen decision from B1, B2, or B3 is modified by this document.** The Execution Object concept is a clarification that names and structures what B1/B2 called "Execution JSON."

### What This Freeze Means

- B4.2 (Execution JSON Specification) must define the fields and structure of Execution Objects in a way that satisfies these principles.
- B4.3 (Architecture) must design the Execution JSON Generator to produce Execution Objects within the existing Generation Engine framework.
- B4 (Implementation) must implement the generator as a pure function, consistent with B2's generator contracts.
- No future milestone may make Execution Objects framework-specific, non-deterministic, or manually editable.

---

*This document defines the CmdRunner Execution Model. All subsequent Execution JSON milestones must conform to these principles.*
