# Milestone B4.2 — Execution Object Design

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Product Design (no implementation, no architecture, no code, no JSON schema)
**Depends on:**
- Product Foundation Design v1.0 (frozen)
- Product Architecture Design v1.0 (frozen)
- Milestone B1 — Post-Recording Artifact Generation Product Design (frozen)
- Milestone B2 — Post-Recording Artifact Generation Architecture (frozen)
- Milestone B3 — Artifact Generation Engine Foundation (frozen)
- Milestone B4.1 — CmdRunner Execution Model (frozen)

---

## 0. Purpose of This Document

B4.1 froze the **Execution Model** — the conceptual framework establishing that Canonical Test Steps produce Execution Objects, which are consumed by code generators. B4.1 defined *why* Execution Objects exist and *how they relate* to other artifacts.

This milestone goes one level deeper: it defines **what an Execution Object actually is** — its purpose, its ownership model, the categories of information it carries, its relationship to Canonical Test Steps, its mutability rules, and its extensibility for the future.

This is still **product design**. No field names. No JSON schema. No locator strategy. No implementation. Only the conceptual design of the Execution Object as a product entity.

---

## Stage 1 — Purpose

### 1.1 What Is an Execution Object?

An Execution Object is the **atomic execution unit of CmdRunner**. It is the smallest indivisible thing that a test execution engine can act on.

Where a Canonical Test Step answers *"What should the test do?"* in human terms, an Execution Object answers *"What does a machine need to know to do it?"* — fully resolved, unambiguous, and ready for any execution framework to consume.

An Execution Object is:
- **One action's worth of execution data** — it represents exactly one thing the machine must do.
- **Fully resolved** — no decisions left to the consumer. The locator is chosen, the action type is concrete, the context is embedded.
- **Self-contained** — it carries everything a code generator needs to produce one framework-specific action, without reading any other Execution Object.
- **Framework-agnostic** — it describes *what* to do, never *how* a specific framework should express it.

### 1.2 Why Does It Exist?

An Execution Object exists to **separate the decision of what to do from the syntax of how to express it.**

Consider a click on a Submit button. The Canonical Test Step says: *"Click 'Submit' button."* The element identity contains eight possible locators (testId, dataCy, dataQa, id, ariaLabel, name, css, xpath). But which one should the test actually use?

Without an Execution Object, every code generator must independently make that decision. Playwright picks testId, Cypress might pick CSS, Selenium might pick XPath — inconsistent, duplicative, and prone to drift.

With an Execution Object, the decision is made **once, centrally, deterministically**. The Execution Object contains the resolved answer. Every code generator reads the same resolved answer and applies only its own syntax.

The Execution Object is the **single point of resolution** in the entire pipeline. Everything upstream is ambiguous (multiple locators, human-language descriptions). Everything downstream is syntactic (framework-specific code). The Execution Object is where ambiguity ends and certainty begins.

### 1.3 Why Is It Separate from a Canonical Test Step?

A Canonical Test Step and an Execution Object serve fundamentally different consumers with fundamentally different needs:

| Dimension | Canonical Test Step | Execution Object |
|---|---|---|
| **Primary consumer** | QA engineer (human) | Code generator (machine) |
| **Optimized for** | Readability, review, editing | Resolution, determinism, consumption |
| **Locator state** | Multiple candidates (unresolved) | One chosen locator + fallbacks (resolved) |
| **Action expression** | Human action type ("click") | Machine action type (abstract but concrete) |
| **Wait strategy** | Absent (not relevant to review) | Present (required for execution) |
| **Plain English** | Present (primary value) | Absent (not needed for execution) |
| **AI enrichment** | Present (context for reviewer) | Projected selectively (only what execution needs) |
| **Editable** | Yes (plain English, deletion) | Never (always derived) |

If these were the same object, it would either:
- Be too ambiguous for machines (containing unresolved locators and human-language descriptions that machines must parse), or
- Be too low-level for humans (containing resolved locators and wait strategies that clutter the review experience).

Separation allows each to be optimized for its consumer. The Step is clean for review; the Execution Object is precise for execution.

### 1.4 Why Is It Independent of Any Execution Framework?

An Execution Object is independent of any execution framework for the same reasons established in B4.1 (EP3: Framework-Agnostic), but reinforced at the object level:

1. **Longevity.** Frameworks come and go. Playwright may be dominant today, but the test automation landscape changes. An Execution Object that outlives any framework protects the Test Case's investment value.

2. **Multi-framework support.** CmdRunner's promise is "record once, execute anywhere." This is only possible if the execution representation is shared across all frameworks. Framework-specific Execution Objects would require per-framework recording.

3. **Simplicity of adding frameworks.** Adding Cypress support should mean writing a Cypress code generator — not re-architecting the execution model. Framework-independent Execution Objects make this possible.

4. **Consistency across exports.** When Playwright and Cypress tests are generated from the same Execution Objects, they are guaranteed to test the same things in the same way (same locators, same actions, same wait strategies). Framework-specificity would break this guarantee.

An Execution Object says: *"Find this element using this locator. Perform this action. Wait for this condition."* It never says: *"Call page.click()."* That translation is the code generator's job.

---

## Stage 2 — Ownership

### 2.1 Who Creates an Execution Object?

The **Execution JSON Generator** (B4, not yet implemented) creates Execution Objects. It is the sole creator. No other component in the system creates Execution Objects.

The generator is a pure function: Canonical Test Steps in, Execution Objects out. It does not write to storage, call AI services, or modify its input. It produces Execution Objects and returns them to the Generation Engine, which persists them.

This is consistent with B2 §2.3: *"No generator calls another generator. No generator writes to storage. Only the engine touches storage and state."*

### 2.2 Who Owns an Execution Object?

The **Test Case** owns its Execution Objects. They are attached to — embedded within — the Test Case's Canonical Test Steps, just as B1 §4.2 established for Execution JSON:

```
Test Case
  └── Canonical Test Steps
        └── Step 1
              └── Execution Object 1  ← owned by the Test Case via the Step
        └── Step 2
              └── Execution Object 2
        └── ...
```

Execution Objects do not have an independent lifecycle. They are born when their parent Step is created (by the generator), they change when their parent Step changes (via regeneration), and they die when their parent Step is deleted. They never exist outside the context of their Step.

### 2.3 Who Consumes an Execution Object?

| Consumer | How It Reads Execution Objects | What It Does With Them |
|---|---|---|
| **Playwright Generator** | Reads the `executionJson` field of each Step | Translates each Execution Object into Playwright API calls |
| **Future: Cypress Generator** | Same | Translates into Cypress API calls |
| **Future: Selenium Generator** | Same | Translates into Selenium API calls |
| **Future: Cucumber Generator** | Same | Translates into Gherkin steps |
| **Future: API Executor** | Same | Translates into HTTP requests |
| **Future: Mobile Executor** | Same | Translates into mobile automation calls |

No consumer modifies Execution Objects. They are read-only inputs to code generators and execution engines.

### 2.4 Who May Modify an Execution Object?

**Nobody.** Execution Objects are never manually edited. They are always derived from Canonical Test Steps by the Execution JSON Generator.

This is consistent with B1 §6.3: *"Execution JSON: ❌ Never directly. It is always derived from Steps."*

If an Execution Object needs to change, the underlying Canonical Test Step changes, and the Execution Object is regenerated. There is no manual edit path.

### 2.5 When Does an Execution Object Become Immutable?

An Execution Object becomes immutable when its parent Test Case is **approved**. At that point, all artifacts are frozen:

```
DRAFT → RECORDING → RECORDED → GENERATING → GENERATED → UNDER_REVIEW → APPROVED → SAVED
                                                                │
                                                                ▼
                                                        Everything frozen.
                                                        Execution Objects
                                                        are immutable.
```

Before approval, Execution Objects are **replaced** (not edited) when Canonical Test Steps change. Each replacement is a fresh derivation — a new Execution Object, not a mutation of the old one.

After approval (and after saving to the repository), Execution Objects are permanently immutable. They are part of the Test Case's permanent record.

---

## Stage 3 — Information Model

This section defines **categories of information** that belong on an Execution Object. It does not define field names, types, or structure — that belongs to B4.3 (JSON Specification).

### 3.1 Category: Action Information

**What it is:** The type of action the machine must perform and any data the action requires.

**Why it belongs:** Without action information, the code generator does not know what to do. "Click" becomes `page.click()`, "Navigate" becomes `page.goto()` or `page.waitForURL()`, "Type" becomes `page.fill()`. The action type is the primary driver of generated code.

**What it includes (conceptually, not as field names):**
- The action category (element interaction, navigation, input, assertion, etc.)
- Any value associated with the action (text to type, option to select)
- The action's semantic meaning (not framework syntax, but abstract enough for any generator to translate)

**What it does NOT include:**
- Plain English description (that's the Step's human layer)
- Framework-specific method names (that's the code generator's job)

### 3.2 Category: Target Information

**What it is:** Identification of what element or resource the action targets.

**Why it belongs:** An action without a target is meaningless. "Click" — click what? "Navigate" — navigate where? The target is the object of the action.

**What it includes:**
- For element actions: the element's semantic identity — its accessible name, tag, role. These are not locators (how to find it) but descriptors (what it is).
- For navigation actions: the destination URL or URL pattern.
- For future actions (API, database): the target resource (endpoint, table, etc.).

**Why it's separate from locator information:** Target information answers *"what is it?"* (identity). Locator information answers *"how do we find it?"* (strategy). These are different concerns. A blind user knows the target ("the Submit button") without knowing the locator (`[data-testid="submit"]`). Similarly, an execution engine may need the target for error reporting, screenshots, or logging — independent of how it finds the element.

### 3.3 Category: Locator Information

**What it is:** The resolved strategy for finding the target element at execution time.

**Why it belongs:** This is the core value of the Execution Object. Code generators need a concrete selector, not a list of candidates. The Execution Object resolves which locator to use (and which to keep as fallbacks) so that every code generator uses the same locator.

**What it includes:**
- The primary locator (the chosen strategy + its value) — the one the code generator uses by default.
- Fallback locators (remaining strategies in priority order) — used if the primary locator fails or if a framework supports automatic fallback.
- Locator metadata (e.g., confidence, source) — for future intelligence.

**What it does NOT include:**
- Framework-specific selector syntax. The locator is expressed abstractly (strategy + value). Translation to `[data-testid="x"]` or `#x` or `xpath=//x` is the code generator's job.
- All eight raw locator candidates. The Execution Object contains the resolved decision, not the unresolved input.

**Why locators are resolved here, not in code generators:** B2 §3.3 established the Locator Resolution Engine. Centralizing resolution ensures consistency: if the Playwright test uses testId, the Cypress test also uses testId. The resolution happens once, in the Execution Object, not N times across N generators.

### 3.4 Category: Context Information

**What it is:** Environmental context that affects how the action is executed.

**Why it belongs:** Some actions can only be executed correctly if the execution engine knows the context. An element inside an iframe requires the engine to switch to that frame first. An element inside a Shadow DOM requires Shadow-piercing selectors. Without context, the generated code may find the wrong element or fail to find any element.

**What it includes:**
- Whether the target is inside an iframe, and if so, how to identify and reach that iframe.
- Whether the target is inside a Shadow DOM.
- Frame depth and nesting information.
- Any other environmental factors that affect element reachability.

**Why it's separate from locator information:** Locators describe how to find the element *within its context*. Context describes *how to reach the context itself*. You need both: first navigate to the iframe, then locate the element within it.

### 3.5 Category: Execution Metadata

**What it is:** Operational data about the Execution Object itself — not about the action, but about the object as a managed entity.

**Why it belongs:** Execution Objects need to be traced, versioned, and managed. Metadata enables traceability to the source Step, correlation with screenshots, and future versioning.

**What it includes:**
- Traceability link to the originating Canonical Test Step and its source interaction in the Timeline.
- Generation timestamp.
- Generation status (success, partial, error).
- Any generation warnings or quality flags.

**Why it's separate from action information:** Metadata describes the Execution Object as an artifact ("when was this created?", "where did it come from?"). Action information describes what to do ("click this element"). These serve different consumers: metadata serves the management system, action information serves the code generator.

### 3.6 Category: Future Extension Data

**What it is:** A reserved space for capabilities not yet implemented but anticipated by the product vision.

**Why it belongs:** The Execution Object must be extensible without redesign. If future capabilities (visual locators, AI-suggested waits, accessibility assertions) require new information, that information must have a natural home — not a bolt-on that breaks the existing structure.

**What it might include in the future:**
- AI metadata (confidence score for locator choice, suggested alternatives)
- Visual locators (screenshot-based element identification)
- Wait strategy details (what condition to wait for, timeout, polling)
- Assertion data (expected state after action)
- Accessibility checks (expected ARIA state, contrast requirements)
- API/mobile/database execution parameters

**Design principle:** Extension data must be **additive** — new categories can be added without changing existing categories. A code generator that doesn't understand a future category ignores it gracefully. This is the forward-compatibility guarantee.

---

## Stage 4 — Relationship to Canonical Test Steps

### 4.1 One Step → One Execution Object

The mapping is strictly **1:1**, as frozen in B4.1 (EP1). Every Canonical Test Step produces exactly one Execution Object. No step produces zero objects. No step produces multiple objects.

This means:
- If there are 10 Steps, there are exactly 10 Execution Objects.
- If a Step is deleted, its Execution Object ceases to exist.
- If a Step is added (future: manual step insertion), a new Execution Object is generated for it.
- The count of Execution Objects always equals the count of Steps.

### 4.2 Traceability

Every Execution Object maintains a **bidirectional traceability link** to its parent Canonical Test Step:

```
Canonical Test Step ←──→ Execution Object
    stepNumber: 3              linkedStepNumber: 3
    linkedInteractionId:       linkedInteractionId:
      "click-0001"               "click-0001"
```

Both artifacts reference the same source interaction ID (from the Timeline). This means:

- Given a Step, you can find its Execution Object (same position, same interaction ID).
- Given an Execution Object, you can find its Step (same interaction ID).
- Given either, you can trace back to the original Timeline interaction.

Traceability is **never broken**. Even after regeneration, the link to the source interaction persists (unless the interaction itself was deleted from the Timeline).

### 4.3 Identity Preservation

The Execution Object inherits **element identity** from its parent Step. The element identity was extracted at click time (immutable per B2 §3.2) and projected onto the Step by the Canonical Step Generator. The Execution Object carries this identity forward.

What this means:
- The tag, role, accessible name, and all locator candidates on the Execution Object are **copies** of what's on the Step.
- They are never recomputed, re-extracted, or modified.
- They represent a snapshot of the DOM at the moment of recording — frozen in time.

The Execution Object does **not** create new identity information. It resolves (picks the best locator) and organizes (structures for machine consumption) the identity it inherits. The resolution is new; the identity is inherited.

### 4.4 Ordering

Execution Objects inherit their **order** from their parent Steps:

```
Step 1 → Execution Object 1 (executes first)
Step 2 → Execution Object 2 (executes second)
Step 3 → Execution Object 3 (executes third)
```

The Execution Object does not impose its own ordering. It does not reorder steps, skip steps, or insert steps. The order of the Steps is the order of execution.

If Steps are reordered (future capability), Execution Objects are reordered with them — they follow their parent Step's position, not their own.

### 4.5 Regeneration Relationship

When a Canonical Test Step changes structurally, its Execution Object is **regenerated**:

| Step Change | Execution Object | Why |
|---|---|---|
| Plain English edit | **No change** | Plain English is a human layer. It does not affect execution data. (B1 §6.5 Q1) |
| Step deleted | **Removed** | The Step no longer exists; its Execution Object cannot exist without it. |
| Step structural change (action type, element identity) | **Regenerated** | The execution data changed. A new Execution Object is derived from the updated Step. |
| Full step regeneration ("Regenerate Steps") | **All regenerated** | New Steps → new Execution Objects. (B1 §6.5 Q3) |
| Test Case approved | **Frozen** | All artifacts immutable. |

**Key principle:** The Execution Object is a **shadow** of the Step. It tracks the Step's structural state and regenerates when that state changes. It ignores the Step's human-layer state (plain English) because that state has no execution impact.

### 4.6 Synchronization Model

The Execution Object remains synchronized with its Step through the **derivation invariant**: the Execution Object is always a function of the Step's structural data. If the structural data changes, the Execution Object is stale until regenerated. The system never allows a stale Execution Object to be consumed by a code generator.

```
Step changes (structural)
        │
        ▼
Execution Object marked stale
        │
        ▼
Generation Engine triggers regeneration
        │
        ▼
New Execution Object derived from updated Step
        │
        ▼
Code generators consume the new Execution Object
```

There is never a state where a Step says one thing and its Execution Object says another. Either they are synchronized, or the Execution Object is being regenerated (a transient state that resolves in milliseconds).

---

## Stage 5 — Mutability

### 5.1 What Can Change?

**Nothing on an existing Execution Object.** Execution Objects are immutable once created. When the underlying Step changes, the old Execution Object is **discarded** and a new one is **created** — the old one is never edited.

This is a subtle but important distinction:

| Model | Behavior |
|---|---|
| ❌ Edit-in-place | Step changes → Execution Object fields are updated. (Implies the object has mutable state.) |
| ✅ Replace-on-change | Step changes → old Execution Object discarded → new Execution Object created. (Implies the object is immutable.) |

The replace model is correct because:
1. **Determinism.** An Execution Object is the output of a pure function. Pure functions don't mutate — they return new values.
2. **Simplicity.** No need to track which fields changed. The entire object is re-derived.
3. **Consistency.** Every Execution Object is either complete and correct (just generated) or doesn't exist (old one discarded). No partially-updated state.

### 5.2 What Can Never Change?

| Property | Mutability | Reason |
|---|---|---|
| **Action type** | Never (on an existing object) | Determined by the Step's action type. New object if Step changes. |
| **Resolved locator** | Never (on an existing object) | Determined by the Locator Resolution Engine from the Step's element identity. New object if identity changes. |
| **Element identity** | Never | Copied from the Step, which copied it from the Timeline. Immutable since recording. |
| **Context information** | Never | Derived from element identity. Same identity → same context. |
| **Traceability link** | Never | Points to the source interaction. The interaction doesn't change (only its presence/absence changes). |
| **Generation metadata** | Never (on an existing object) | Stamped at creation. New object gets new metadata. |

### 5.3 When Regeneration Creates a New Execution Object

Regeneration occurs in these scenarios:

1. **Step structural change** — action type or element identity changes on the Step. The old Execution Object is replaced.
2. **Step deletion** — the Step is removed. The Execution Object ceases to exist. (No regeneration; just removal.)
3. **Full "Regenerate Steps"** — all Steps are re-derived from the Timeline. All Execution Objects are re-derived from the new Steps. This is a complete reset.
4. **Generation retry** — if generation failed previously, a retry creates fresh Execution Objects from the same Steps.

In every case, the old Execution Object is **not preserved**. There is no version history (B1 §6.5 Q4, B1 P15: "v1.0 replaces without version history"). The new Execution Object replaces the old one completely.

### 5.4 What Remains Stable Across Regeneration

Even though regeneration creates a new object, certain properties are **stable** — they have the same value in the old and new objects (assuming the underlying Step's structural data didn't change):

| Property | Stable? | Condition |
|---|---|---|
| Traceability link (interaction ID) | ✅ Stable | Same Step → same source interaction. |
| Element identity | ✅ Stable | Identity is immutable since recording. |
| Resolved primary locator | ✅ Stable | Same identity → same resolution (deterministic). |
| Action type | ✅ Stable | Same Step → same action type. |
| Context information | ✅ Stable | Same identity → same context. |
| Generation timestamp | ❌ Changes | New object → new timestamp. |
| Generation metadata | ❌ Changes | New object → new metadata. |

This stability is a consequence of **determinism** (B4.1 EP4): same input → same output. If the Step's structural data is unchanged, regeneration produces a functionally identical Execution Object (differing only in metadata).

---

## Stage 6 — Future Extensibility

The Execution Object must accommodate future capabilities **without redesign**. This section demonstrates how each anticipated future capability fits naturally into the Execution Object's information model.

### 6.1 AI Metadata

**Future capability:** AI-assisted locator suggestions, confidence scoring, smart wait strategy selection.

**How it fits:** AI metadata belongs in the **Execution Metadata** category (§3.5) or a dedicated sub-category within it. The AI provides *suggestions* and *confidence* — it does not change the deterministic resolution. The locator is still resolved deterministically; AI metadata explains *why* and offers *alternatives*.

**What doesn't change:** The locator resolution algorithm, the action type, the element identity. AI metadata is additive context, not a replacement for deterministic resolution.

**Example (conceptual):**
```
Execution Object
  ├── Action: click
  ├── Locator: { strategy: testId, value: "submit" }
  └── AI Metadata: {
        confidence: 0.95,
        alternatives: [
          { strategy: css, value: "button.primary", confidence: 0.80 }
        ],
        reasoning: "testId is present and stable"
      }
```

No existing category needs to change. AI metadata is a new sub-category within the existing Execution Metadata.

### 6.2 Visual Locators

**Future capability:** Element identification by visual appearance (screenshot-based), not by DOM attributes. Useful when elements have no stable attributes (dynamic IDs, generated class names).

**How it fits:** Visual locator data belongs in the **Locator Information** category (§3.3) as a new locator strategy type. The locator model already supports multiple strategies (testId, css, xpath, etc.). "Visual" is simply another strategy type.

**What doesn't change:** The locator category structure (primary + fallbacks). The action type. The element identity. The code generator interface (it receives a locator strategy + value; whether that strategy is "testId" or "visual" is transparent).

**Example (conceptual):**
```
Execution Object
  ├── Action: click
  ├── Locator: {
        strategy: "visual",
        value: "screenshot-hash:abc123",
        region: { x: 100, y: 200, width: 80, height: 30 }
      }
  └── ...
```

The locator category already supports strategy + value. A new strategy type ("visual") is additive — existing code generators that don't understand it can fall back to the next locator.

### 6.3 API Execution

**Future capability:** Testing HTTP APIs directly — sending requests, validating responses — without a browser.

**How it fits:** API execution parameters belong in the **Action Information** category (§3.1) and **Target Information** category (§3.2). The action type changes from element interaction to HTTP request. The target changes from a DOM element to an API endpoint.

**What doesn't change:** The Execution Object structure. The 1:1 mapping with Steps. The ownership model. The framework-agnostic principle (API execution is still framework-agnostic — the Execution Object says "GET /users/123", not "fetch('/users/123')" or "axios.get('/users/123')").

**Example (conceptual):**
```
Execution Object
  ├── Action: { type: "http_request", method: "GET" }
  ├── Target: { type: "endpoint", url: "/api/users/123" }
  ├── Locator: null (no DOM element for API actions)
  ├── Context: { type: "api", auth: "bearer" }
  └── ...
```

No redesign needed. Action and Target categories already exist; they just carry different data for API actions than for browser actions.

### 6.4 Mobile Execution

**Future capability:** Testing mobile apps (iOS/Android) via Appium, Espresso, or XCUITest.

**How it fits:** Mobile element identification belongs in **Locator Information** (§3.3) as new strategy types (accessibility ID, class name, predicate string). Mobile context belongs in **Context Information** (§3.4).

**What doesn't change:** The Execution Object structure. The code generator interface. The framework-agnostic principle.

**Example (conceptual):**
```
Execution Object
  ├── Action: tap
  ├── Target: { type: "element", name: "Login Button" }
  ├── Locator: {
        strategy: "accessibility_id",
        value: "login-button"
      }
  ├── Context: { type: "mobile", platform: "ios" }
  └── ...
```

The locator strategy "accessibility_id" is additive. The context type "mobile" is additive. No existing category changes.

### 6.5 Database Execution

**Future capability:** Testing database state — verifying that an action produced the expected data change.

**How it fits:** Database queries belong in the **Action Information** and **Target Information** categories. The action type is a database operation. The target is a table or query.

**What doesn't change:** The Execution Object structure. The deterministic principle (same query → same result expectation).

**Example (conceptual):**
```
Execution Object
  ├── Action: { type: "db_assert", operation: "select" }
  ├── Target: { type: "table", name: "orders", condition: "status='confirmed'" }
  ├── Locator: null (no DOM element)
  ├── Context: { type: "database", connection: "primary" }
  └── ...
```

### 6.6 Future Execution Engines

**Future capability:** New execution engines that consume Execution Objects — e.g., a headless recorder, a load testing engine, a visual regression tool.

**How it fits:** Any new engine reads the same Execution Objects using the same categories. If the engine needs additional information, that information is added as a new sub-category within the existing six categories. The engine ignores categories it doesn't understand.

**What doesn't change:** The six information categories (Action, Target, Locator, Context, Metadata, Extension). The ownership model. The 1:1 mapping. The immutability rules.

### 6.7 The Extensibility Guarantee

The Execution Object's information model is designed so that:

1. **New strategies** (visual locators, mobile locators) are new values in existing categories — not new categories.
2. **New action domains** (API, mobile, database) change the *content* of Action and Target categories, not the *structure*.
3. **New metadata** (AI, confidence, quality scores) are additive sub-categories within Execution Metadata.
4. **New context types** (mobile, database, browser variants) are new values in the Context category.
5. **No existing category ever needs to be removed, renamed, or restructured** to accommodate a future capability.

This is the **forward-compatibility guarantee**: the Execution Object designed today accommodates the product vision of tomorrow without redesign.

---

## Stage 7 — Product Principles

### EO-P1 — Single Responsibility

An Execution Object has one responsibility: **describe how to execute one test step**. It does not describe the test's purpose (that's the Step's job), generate framework code (that's the code generator's job), or manage test state (that's the execution engine's job). It is a data object, not a behavior object. It carries information; it performs no action.

### EO-P2 — Framework Independence

An Execution Object contains zero framework-specific syntax. No `page.click()`, no `cy.get()`, no `driver.findElement()`. It describes *what* to do in abstract terms. Any code generator can translate it. Any execution engine can consume it. Adding a new framework never requires changing the Execution Object.

### EO-P3 — Deterministic Behavior

Given the same Canonical Test Step, the Execution JSON Generator always produces the same Execution Object. Same locator choice, same action type, same context. No randomness, no environmental variation, no AI inference at generation time. This determinism guarantees that regeneration is idempotent (same input → same output) and that the Execution Object is reproducible.

### EO-P4 — Stable Identity

An Execution Object's identity is tied to its source: the Canonical Test Step and the underlying Timeline interaction. This identity is stable across regeneration (if the Step's structural data is unchanged). The interaction ID (`click-0001`) is the anchor — it persists from Timeline → Step → Execution Object. Even after regeneration, the same interaction ID links them all.

### EO-P5 — Extensible Design

The Execution Object accommodates future capabilities without restructuring. New locator strategies, new action domains, new metadata types, new context types — all are additive. No existing category needs to change. This extensibility is structural: the six information categories are broad enough to carry future data without being so generic that they lose meaning.

### EO-P6 — Backward Compatibility

When the Execution Object's structure is extended in the future (new sub-categories, new strategy types), existing code generators continue to work. They read the categories they understand and ignore the ones they don't. An Execution Object generated today will be consumable by code generators written next year — and vice versa, a code generator written today will consume Execution Objects generated next year (ignoring new categories it doesn't recognize).

### EO-P7 — Immutable Execution Intent

An Execution Object, once generated, is immutable. It is never edited in place. When the source Step changes, a new Execution Object is created to replace the old one. The old object is discarded, not updated. This immutability guarantees that an Execution Object is always a complete, consistent, self-contained snapshot of execution intent — never a partially-updated mess.

### EO-P8 — Separation from Implementation

The Execution Object is a **design artifact**, not an implementation artifact. It describes execution intent in terms of concepts (action, target, locator, context), not in terms of data structures (objects, arrays, maps). The serialization format (JSON), the storage model (chrome.storage.local keys), and the implementation (generator code) are all separate concerns. This separation ensures the Execution Object's design survives any implementation choice.

---

## Stage 8 — Assumptions and Open Questions

### 8.1 Assumptions (Inherited from Frozen Predecessors)

1. **The Canonical Step Generator (B3) is complete and frozen.** Execution Objects derive from Steps. The Step structure is the input contract. (B3, B2 §3.2)

2. **Element identity is extracted at click time and is immutable.** The locators and descriptors available to the Execution Object are whatever was captured during recording. (B2 §3.2, Milestone 2 Architecture)

3. **Locator resolution follows a fixed priority order.** testId → dataCy → dataQa → id → ariaLabel → name → css → xpath. This order is deterministic and frozen. (B2 §3.3, Milestone 2 Architecture)

4. **Navigation interactions are a special case.** They have no element identity in the traditional sense. Their Execution Objects represent URL transitions, not element actions. (B2 §3.3, B4.1 §7.1 Assumption 5)

5. **The Generation Engine invokes generators via the registry.** The Execution JSON Generator will register itself the same way the Canonical Step Generator did. No engine modification needed. (B3, B2 §2.3)

6. **AI enrichment is already on the Steps.** The Execution JSON Generator does not call AI. It reads enrichment from the Step. (B2 §3.2, AP: AI boundary)

7. **v1.0 has no version history.** Regeneration replaces. No snapshots. (B1 §6.5 Q4, B1 P15)

### 8.2 Open Questions (Deferred to Later Milestones)

1. **What are the exact field names and types?** Deferred to B4.3 (Execution JSON Specification). This document defines categories, not fields.

2. **How is the primary locator chosen when multiple high-quality locators exist?** Deferred to B4.3/B4 implementation. This document establishes that resolution is centralized and deterministic, but does not define tie-breaking rules.

3. **What wait strategies exist, and how are they assigned?** Deferred to B4.3. This document establishes that wait strategy is a concept within the Execution Object's information model, but does not enumerate strategies.

4. **How are Execution Objects serialized for storage?** Deferred to B4.3 (JSON Specification) and B4 (Implementation). This document establishes the conceptual model; serialization is a separate concern.

5. **How does the side panel display Execution Objects?** Deferred to the UI/UX milestone. This document does not design UI.

6. **How are partial generation failures handled at the Execution Object level?** Deferred to B4.3/B4. B1 §9.3 established the product behavior (placeholder + retry); the implementation detail is out of scope here.

7. **How will future capabilities (visual locators, API, mobile) be formally specified?** Deferred to their respective future milestones. This document demonstrates that they *fit*; it does not design them.

8. **What is the canonical serialization format — is it always JSON?** This document assumes JSON (consistent with all frozen predecessors). If a future requirement demands a different format (e.g., protobuf for performance), the Execution Object concept is unaffected — only the serialization changes.

---

## Stage 9 — Consistency with Frozen Predecessors

### 9.1 Alignment with B4.1 (Execution Model)

| B4.1 Decision | B4.2 Alignment |
|---|---|
| Every Step → one Execution Object (EP1) | ✅ §4.1 restates and reinforces the 1:1 mapping with synchronization rules. |
| Execution Objects represent intent, not events (EP2) | ✅ §1.1 defines the Execution Object as "resolved intent." §3 defines information categories that are resolved, not raw. |
| Framework-agnostic (EP3) | ✅ EO-P2. Every information category is described in abstract terms. |
| Deterministic (EP4) | ✅ EO-P3. Same Step → same Execution Object. Always. |
| Playwright is derived (EP5) | ✅ §2.3 lists code generators as consumers, not owners. |
| Future engines consume same model (EP6) | ✅ Stage 6 demonstrates this with 5 concrete future capabilities. |
| No redesign for new formats (EP7) | ✅ §6.7 — the Extensibility Guarantee. |

### 9.2 Alignment with B1 (Artifact Generation)

| B1 Decision | B4.2 Alignment |
|---|---|
| Execution JSON is always derived from Steps (Decision 7) | ✅ §2.1: Execution JSON Generator is sole creator. §2.4: nobody may modify. |
| Execution JSON never manually edited (§6.3) | ✅ §5.1: replace-on-change model. No edit-in-place. |
| Plain English edits don't trigger regeneration (§6.5 Q1) | ✅ §4.5: plain English changes → no Execution Object change. |
| v1.0 replaces without version history (P15) | ✅ §5.3: old object discarded on regeneration. No preservation. |

### 9.3 Alignment with B2 (Architecture)

| B2 Decision | B4.2 Alignment |
|---|---|
| Generators are pure functions (AP1) | ✅ EO-P3, EO-P7: deterministic, immutable. Generator returns new objects. |
| Engine owns state, generators don't (AP4) | ✅ §2.1: generator creates and returns; engine persists. |
| Execution JSON Generator populates executionJson on each step (§3.3) | ✅ §2.2: Execution Objects embedded within Steps. |
| Locator Resolution Engine resolves locators (§3.3) | ✅ §3.3: locator information category describes resolved output. |

### 9.4 No Conflicts Found

This document introduces **no new concepts that contradict frozen decisions**. It deepens the Execution Object from a named concept (B4.1) into a designed entity with ownership, information categories, mutability rules, and extensibility proof. Every frozen decision from B1, B2, B3, and B4.1 is preserved exactly.

---

## Stage 10 — Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ JSON schema (field names, types, nesting)
- ❌ Locator priority order details (which locator wins and why)
- ❌ Execution action enumeration (list of supported actions)
- ❌ Serialization format (JSON structure, key naming)
- ❌ Storage model (storage keys, persistence strategy)
- ❌ Execution algorithms (how engines consume objects)
- ❌ Playwright generation (code mapping, test structure)
- ❌ UI/UX for displaying Execution Objects

These belong to B4.3 (Execution JSON Specification), B4 (Implementation), and subsequent milestones.

---

## Stage 11 — Freeze Declaration

Upon approval, the following is declared **frozen**:

### Frozen Design Decisions

1. **An Execution Object is the atomic execution unit of CmdRunner.** It is the smallest indivisible thing an execution engine can act on.

2. **An Execution Object carries six categories of information:** Action, Target, Locator, Context, Execution Metadata, and Future Extension Data. These categories are permanent.

3. **An Execution Object is created solely by the Execution JSON Generator.** No other component creates it.

4. **An Execution Object is never manually edited.** It is always derived from its parent Canonical Test Step. Changes to the Step produce a new Execution Object (replace, not edit).

5. **An Execution Object becomes immutable at Test Case approval.** Before approval, it is replaced on Step changes. After approval, it is permanently frozen.

6. **The 1:1 mapping (Step → Execution Object) is absolute.** No exceptions for any action type, including navigation.

7. **Traceability is bidirectional and unbreakable.** Step ↔ Execution Object ↔ Timeline interaction, linked by interaction ID.

8. **An Execution Object's locator is resolved at generation time.** The code generator receives a resolved locator, not a list of candidates.

9. **The six information categories are extensible.** Future capabilities (visual locators, API, mobile, database) fit within existing categories as new values or additive sub-categories. No category is ever removed or restructured.

10. **Forward compatibility is guaranteed.** Code generators written today consume Execution Objects generated tomorrow (ignoring unknown categories). Execution Objects generated today are consumable by code generators written tomorrow.

### What This Freeze Means

- B4.3 (Execution JSON Specification) must define field names and JSON structure that carry these six categories.
- B4 (Implementation) must implement the Execution JSON Generator to produce objects matching this design.
- No future milestone may make Execution Objects mutable, framework-specific, or manually editable.
- No future milestone may break the 1:1 Step → Execution Object mapping.
- No future milestone may remove or restructure the six information categories.

---

*This document defines the Execution Object Design for CmdRunner. All subsequent Execution JSON milestones must conform to this design.*
