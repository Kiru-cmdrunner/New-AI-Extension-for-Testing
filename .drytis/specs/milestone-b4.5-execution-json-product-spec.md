# Milestone B4.5 — CmdRunner Execution JSON Product Specification

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
- Milestone B4.2 — Execution Object Design (frozen)
- Milestone B4.3 — CmdRunner Locator Resolution Strategy (frozen)
- Milestone B4.4 — CmdRunner Locator Priority Strategy (frozen)

---

## 0. Purpose of This Document

The previous milestones in the B4 series established:

- **B4.1:** What CmdRunner executes (the Execution Model — Execution Objects as the atomic execution unit)
- **B4.2:** What an Execution Object is (six information categories, ownership, mutability, extensibility)
- **B4.3:** How CmdRunner thinks about element identification (Identity vs Locator, trust spectrum, six locator categories)
- **B4.4:** How CmdRunner chooses locators (priority hierarchy, primary/secondary/fallback roles, acceptance rules)

This milestone answers a different question: **What is the Execution JSON as a product artifact, and what responsibilities does it own?**

The Execution Object (B4.2) is a *conceptual entity* — the design of what execution data means. The Execution JSON is the *product artifact* — the concrete, serialized, stored representation of that entity. This milestone freezes the purpose, responsibilities, ownership boundaries, and immutability rules of the Execution JSON as CmdRunner's execution contract.

This is still **product design**. No field names. No JSON syntax. No serialization details. No implementation. Only the product contract.

---

## Stage 1 — Purpose

### 1.1 What Is CmdRunner Execution JSON?

CmdRunner Execution JSON is the **serialized representation of an Execution Object** — the persistent, machine-readable form of the execution data that a Canonical Test Step produces.

Each Canonical Test Step has exactly one Execution Object (B4.1 EP1, B4.2 §4.1). Each Execution Object is serialized as one Execution JSON structure and embedded within its parent Step. The Execution JSON is not a separate file, a separate storage record, or a separate API response — it is a field on the Step that holds the serialized execution data.

When a code generator needs to produce test code for a Step, it reads the Step's Execution JSON. When the UI needs to display execution details for a Step, it reads the Execution JSON. When a user reviews a Step's locators, they are seeing the Execution JSON's content rendered for human consumption.

### 1.2 Why Does It Exist?

The Execution JSON exists because **Execution Objects must be persisted, transported, and consumed.**

An Execution Object is a conceptual entity with six information categories (B4.2 Stage 3). But concepts don't persist across container restarts, don't travel across message channels, and don't get consumed by code generators. A serialized representation is needed — one that:

- **Persists** in storage (chrome.storage.local, Test Case repository)
- **Travels** across the Generation Engine → storage → code generator pipeline
- **Is consumed** by any code generator without needing to understand the generation pipeline
- **Is self-describing** — a code generator can read it without reading the Step, the Timeline, or any other artifact

The Execution JSON is that serialized representation. It is the **exchange format** between the generation pipeline and the consumption pipeline. The generation pipeline produces it; the consumption pipeline (code generators, execution engines, UI display) reads it.

### 1.3 Why Is It Separate from Execution Objects?

The Execution Object and the Execution JSON are **two representations of the same execution contract** — not two independent artifacts. They are the same thing expressed in different forms for different stages of the pipeline:

```
Execution Object (Product Concept)
       │
       │  serialized as...
       ▼
Execution JSON (Persistent Representation)
       │
       │  consumed by...
       ▼
Execution Engine / Code Generators (Runtime Consumers)
```

- The **Execution Object** defines the conceptual execution model — what execution data *means* (six information categories, ownership rules, mutability model).
- The **Execution JSON** is the persistent representation of that same model — the concrete, stored, transportable form.
- The **Execution Engine** (or code generator) consumes the JSON representation to execute or generate code.

They are not separate business objects. The Execution JSON *is* the Execution Object, serialized. There is a single execution contract expressed in different forms. The distinction matters because:

| Concept | Nature | Role |
|---|---|---|
| **Execution Object** | Product concept | Defines what execution data *means* — six information categories, ownership rules, mutability model, extensibility guarantees. The design-level definition. |
| **Execution JSON** | Persistent representation | The serialized, stored form of that same definition. The thing that gets persisted, transported, and consumed. |

The distinction exists for three practical reasons:

1. **The concept precedes the format.** B4.2 froze what the Execution Object *is* (categories, principles). B4.5 freezes what the Execution JSON *does* (responsibilities, boundaries). The format serves the concept, not the other way around.

2. **The format can change without the concept changing.** If a future version of CmdRunner changes the serialization format (restructures JSON nesting, renames keys, adds versioning), the Execution Object concept is unaffected. The six categories, the priority hierarchy, the ownership model — all remain. The execution contract is unchanged; only its representation evolves.

3. **The concept guides what belongs in the format.** When deciding "should this piece of data be in the Execution JSON?", the answer comes from the Execution Object's information categories (B4.2 Stage 3), not from a JSON schema. The concept is the authority; the format is the expression.

**Key principle:** There is one execution contract. The Execution Object is its definition. The Execution JSON is its representation. Future developers should never treat them as independent artifacts with independent lifecycles.

### 1.4 Why Is It the Execution Contract for CmdRunner?

The Execution JSON is the **execution contract** — the authoritative, binding representation of what a Test Case's execution requires. It is a contract in three senses:

**Contract between generation and consumption.** The Generation Engine (producer) creates Execution JSON according to the frozen locator priority strategy (B4.4) and information model (B4.2). Code generators (consumers) read Execution JSON and produce framework-specific code. The JSON is the interface between these two halves of the pipeline. Neither side needs to understand the other — the JSON is the complete, self-contained handoff.

**Contract between recording and execution.** A QA engineer records a workflow. The Execution JSON captures what the machine needs to do to replay that workflow. If the JSON says "click element by test ID 'submit'", that is a binding commitment — the generated test code will click that element using that locator. The JSON is the point where recording intent becomes execution reality.

**Contract between CmdRunner and external systems.** When a Test Case is exported, shared, or integrated with a CI/CD pipeline, the Execution JSON is the artifact that carries executable meaning. External systems that understand the Execution JSON format can consume CmdRunner test cases without running CmdRunner's UI.

---

## Stage 2 — Relationship to Execution Objects

### 2.1 The Representation Relationship

The Execution JSON is a **faithful serialization** of the Execution Object. It does not add information, remove information, or transform information. It expresses the same six information categories (B4.2 Stage 3) in a serialized form:

```
Execution Object (concept)          Execution JSON (artifact)
├── Action Information      →       serialized action data
├── Target Information      →       serialized target data
├── Locator Information     →       serialized locator data
├── Context Information     →       serialized context data
├── Execution Metadata      →       serialized metadata
└── Extension Data          →       serialized extension data
```

Every category on the Execution Object has a corresponding representation in the Execution JSON. No category is omitted; no extra category is invented.

### 2.2 Ownership

| Question | Answer |
|---|---|
| Who creates the Execution JSON? | The Execution JSON Generator (B4, not yet implemented), as a pure function: Execution Objects in, Execution JSON out. |
| Who owns the Execution JSON? | The Test Case, via the Canonical Test Step. The JSON is embedded within the Step's `executionJson` field. |
| Who consumes the Execution JSON? | Code generators (Playwright, future Cypress/Selenium), the UI (for display), and future execution engines. |
| Who modifies the Execution JSON? | Nobody. It is always derived. (B1 §6.3, B4.2 §2.4) |

### 2.3 Derivation

The Execution JSON is derived from the Execution Object, which is derived from the Canonical Test Step, which is derived from the Interaction Timeline:

```
Interaction Timeline
       │ (Canonical Step Generator, B3)
       ▼
Canonical Test Step (with raw element identity)
       │ (Execution JSON Generator, B4)
       ▼
Execution Object (resolved: locators, actions, context)
       │ (serialization — same generator)
       ▼
Execution JSON (serialized, embedded in Step)
       │ (code generators read it)
       ▼
Framework-specific test code
```

The Execution JSON is produced at the same time as the Execution Object — the generator produces the conceptual entity and serializes it in one step. They are not separately generated.

### 2.4 Why the Execution JSON Is a Representation, Not a Separate Business Object

The Execution JSON does not have its own identity, its own lifecycle, or its own state machine. It does not appear as a top-level artifact in the Test Case:

```
Test Case
  ├── Recording Context
  ├── Interaction Timeline
  ├── Canonical Test Steps
  │     ├── Step 1
  │     │     ├── plainEnglish: "Click 'Submit' button"
  │     │     ├── elementIdentity: { ... }
  │     │     └── executionJson: { ... }    ← lives HERE, inside the Step
  │     ├── Step 2
  │     │     ├── plainEnglish: "..."
  │     │     ├── elementIdentity: { ... }
  │     │     └── executionJson: { ... }
  │     └── ...
  └── Playwright Test (derived export)
```

The Execution JSON is a **property of the Step**, not a sibling artifact. It has no independent existence. If the Step is deleted, the JSON is deleted. If the Step is regenerated, the JSON is regenerated. The JSON's lifecycle is entirely subordinate to the Step's lifecycle.

This is why it is a *representation* of the Execution Object rather than a separate business object: it has no business meaning independent of its parent Step. Its entire purpose is to serve the Step's execution needs.

---

## Stage 3 — Product Responsibilities

### 3.1 Represent Executable Intent

The Execution JSON's foremost responsibility is to **carry the executable intent of a Canonical Test Step** — the complete, resolved description of what a machine must do to perform that step.

This means the Execution JSON must contain:
- What action to perform (click, navigate, type, etc.)
- What element or resource to target (for element actions: the resolved locator)
- What context applies (iframe, Shadow DOM)
- Any action-specific data (text to type, option to select)

The Execution JSON is the **translation of human intent into machine intent**. The Step says "Click 'Submit' button" (human). The Execution JSON says "click the element identified by [primary locator] in [context]" (machine). Both describe the same action; the JSON adds the resolution needed for execution.

### 3.2 Preserve Deterministic Execution

The Execution JSON must guarantee that **the same Step always produces the same Execution JSON** (B4.1 EP4, B4.4 LP-P1). This determinism extends to every aspect of the JSON:

- The same primary locator is always chosen (B4.4 priority hierarchy).
- The same secondary and fallback locators are always selected.
- The same action type is always assigned.
- The same context information is always embedded.

Determinism is preserved because the Execution JSON Generator is a pure function (B2 AP1): same input → same output. No randomness, no environmental variation, no AI inference at generation time.

### 3.3 Preserve Locator Decisions

The Execution JSON must carry the **resolved locator set** — primary, secondary, and fallback — exactly as determined by the Locator Priority Strategy (B4.4). The locators in the Execution JSON are not candidates; they are **decisions**. Each locator has a role (primary, secondary, fallback) and an order.

This responsibility means:
- The primary locator in the Execution JSON is the one the code generator uses by default.
- The secondary and fallback locators are available for resilience.
- No locator in the Execution JSON is ambiguous or unresolved — the Locator Resolution Engine has already made every decision.

### 3.4 Preserve Execution Context

The Execution JSON must carry the **environmental context** that affects execution — iframe boundaries, Shadow DOM nesting, frame depth. Without this context, a code generator might produce code that uses the correct locator but fails to reach the element because it's inside an iframe the code didn't switch to.

Context preservation means:
- If the element was inside an iframe during recording, the iframe context is in the Execution JSON.
- If the element was inside a Shadow DOM, that fact is in the Execution JSON.
- Code generators read this context and produce framework-specific code that navigates to the correct frame or pierces the Shadow boundary.

### 3.5 Support Reliable Execution

The Execution JSON must contain **enough information for a code generator to produce working test code without reading any other artifact.** This is the self-containment principle:

A code generator should be able to read a single Execution JSON structure and produce a complete, runnable test action — without reading the Canonical Test Step, the Interaction Timeline, or the Recording Context. The Execution JSON is the **sole input** to code generation.

If a code generator needs information that is not in the Execution JSON, that information is either:
1. Not needed for execution (e.g., plain English description — that's for humans, not machines), or
2. Missing due to a bug in the generation pipeline.

---

## Stage 4 — Boundaries

### 4.1 What the Execution JSON Owns

The Execution JSON is the authoritative source for these concerns:

| Owns | Description | Source |
|---|---|---|
| **Execution intent** | The resolved action type and action data (what the machine must do) | Derived from Step's action type |
| **Resolved locator set** | Primary, secondary, and fallback locators (how to find the element) | Resolved by Locator Resolution Engine from Step's element identity |
| **Execution context** | Iframe, Shadow DOM, and environmental factors affecting element reachability | Extracted from Step's element identity |
| **Element descriptors** | Semantic identity for logging/reporting (tag, accessible name, role) | Copied from Step's element identity |
| **Execution traceability** | Link back to the source interaction (interaction ID) | Inherited from the Step |
| **Generation metadata** | Generation status, warnings, quality flags | Stamped by the Execution JSON Generator |

### 4.2 What the Execution JSON Does NOT Own

The Execution JSON explicitly does **not** own or carry these concerns:

| Does NOT Own | Why | Where It Belongs |
|---|---|---|
| **Recording history** | The JSON describes execution, not recording. Raw event data (coordinates, timestamps, DOM snapshot) is recording evidence, not execution data. | Interaction Timeline |
| **Business meaning** | The JSON carries machine-resolved execution data, not human interpretation. "Click 'Submit' button" is a human description, not execution data. | Canonical Test Step (plainEnglish field) |
| **Raw element identity** | The JSON carries resolved locators, not the raw multi-valued identity. The identity is the input; locators are the output. (B4.3 §0) | Canonical Test Step (elementIdentity field) |
| **AI enrichment** | AI analysis of the element is context for the reviewer, not data for the machine. The JSON carries only what execution needs. | Canonical Test Step (aiEnrichment field) |
| **Review state** | Whether a step has been reviewed, approved, or flagged is workflow state, not execution data. | Test Case state machine (TestCaseState) |
| **Repository metadata** | Repository name, commit hash, branch — these describe where the Test Case is stored, not how to execute it. | Test Case repository layer |
| **Execution results** | Pass/fail status, error messages, stack traces — these are produced during execution, not during generation. The JSON is generated before execution ever happens. | Execution Engine output (runtime) |
| **Screenshots** | Visual evidence of execution is captured at runtime, not at generation time. The JSON is generated before any execution occurs. | Execution Engine output (runtime) |
| **Logs** | Execution logs are runtime artifacts, not pre-execution data. | Execution Engine output (runtime) |
| **Playwright code** | Generated test code is a *consumer* of the Execution JSON, not part of it. The JSON is framework-agnostic; Playwright is framework-specific. | Separate artifact (Playwright Test) |
| **Test Case metadata** | Test Case name, description, creation date, author — these describe the Test Case as a whole, not individual step execution. | Test Case top-level fields |

### 4.3 The Boundary Principle

The Execution JSON is **minimal and complete**:

- **Minimal:** It carries only what a code generator needs to produce working test code. It does not duplicate data that belongs on the Step, the Timeline, or the Test Case.
- **Complete:** It carries everything a code generator needs. No code generator should need to read beyond the Execution JSON to produce a single test action.

If data is needed for execution, it belongs in the Execution JSON. If data is needed for understanding, review, or management, it belongs elsewhere. This boundary keeps the Execution JSON focused, small, and consumable.

---

## Stage 5 — Immutability

### 5.1 When Execution JSON Is Created

The Execution JSON is created by the Execution JSON Generator during the **GENERATING** phase of the Test Case lifecycle:

```
RECORDED → GENERATING → GENERATED
               │
               ├── Canonical Step Generator runs → produces Steps
               ├── Execution JSON Generator runs → produces Execution JSON per Step
               └── (Future: Playwright Generator runs → produces test code)
```

The JSON does not exist during recording (the Step doesn't exist yet). It does not exist before GENERATING (the generator hasn't run). It comes into existence during GENERATING and is embedded within each Step upon completion.

### 5.2 Whether It Can Be Edited

**No.** The Execution JSON is never manually edited (B1 §6.3, B4.2 §2.4). It is always derived from the Canonical Test Step by the Execution JSON Generator.

There is no UI for editing the Execution JSON. There is no API for patching it. There is no "manual override" mechanism. If the execution data needs to change, the Step changes, and the JSON is regenerated.

This immutability is a product decision, not a technical limitation. Manual editing of the JSON would:
- Break the derivation invariant (Step → Execution Object → JSON is one-way).
- Create inconsistency between the Step's identity and the JSON's locators.
- Make the JSON non-reproducible (regeneration would overwrite manual edits).
- Undermine the contract between generation and consumption.

### 5.3 Whether Regeneration Replaces It

**Yes.** Regeneration replaces the Execution JSON entirely (B4.2 §5.1 — replace-on-change model). The old JSON is discarded; a new JSON is derived from the (possibly updated) Step.

Regeneration occurs when:
- The Step's structural data changes (action type, element identity).
- "Regenerate Steps" is triggered (full reset from Timeline).
- A generation retry is attempted after a previous failure.

In every case, the old JSON is **not preserved**. There is no version history (B1 P15). The new JSON replaces the old one completely.

### 5.4 Relationship to Canonical Test Steps

The Execution JSON's lifecycle is **entirely subordinate** to the Step's lifecycle:

| Step Event | Execution JSON |
|---|---|
| Step created (by Canonical Step Generator) | JSON generated by Execution JSON Generator |
| Step plain English edited | **No change** — plain English is a human layer (B1 §6.5 Q1) |
| Step deleted | JSON deleted with the Step |
| Step structurally changed | JSON regenerated |
| Full "Regenerate Steps" | All JSONs regenerated from new Steps |
| Test Case approved | JSON frozen permanently |

The JSON never acts independently of the Step. It has no state, no lifecycle events, and no existence outside its parent Step.

### 5.5 Relationship to Execution Objects

The Execution JSON is the **serialized form** of the Execution Object. They are created at the same time, by the same generator, in the same operation. The generator produces the conceptual Execution Object and serializes it as Execution JSON — there is no intermediate step.

When we say "the Execution JSON is immutable," we mean the same thing as "the Execution Object is immutable" (B4.2 EO-P7). They are the same artifact at different levels of abstraction. The conceptual entity is immutable; its serialized form is immutable.

---

## Stage 6 — Relationship to Execution Engines

### 6.1 Execution Engines Consume, Not Define

An execution engine is any system that reads Execution JSON and performs the described actions against a real application. Examples:

- **CmdRunner Execution Engine** (future): CmdRunner's own test runner that reads Execution JSON and replays the test using browser automation.
- **External execution engines** (future): Third-party systems that consume CmdRunner's Execution JSON format to execute tests.

Execution engines are **consumers** of the Execution JSON. They read it, interpret it, and act on it. They do **not** define its structure, its content, or its semantics.

This separation means:
- CmdRunner can add its own execution engine without changing the Execution JSON format.
- Third-party engines can consume CmdRunner's Execution JSON without CmdRunner knowing about them.
- The Execution JSON format is stable regardless of which engines exist.

### 6.2 Independence from Any Specific Engine

The Execution JSON contains **no engine-specific data**:

- No CmdRunner Execution Engine runtime parameters.
- No assumptions about how an engine implements retries, timeouts, or parallelism.
- No engine-specific configuration (browser type, viewport size, network conditions).

These are **runtime concerns** — decisions made by the execution engine at test execution time, not by the generation pipeline at test creation time. The Execution JSON describes *what* to do, not *how* a specific engine should do it.

### 6.3 Why This Independence Matters

If the Execution JSON were coupled to a specific engine:

1. **Engine lock-in.** Switching execution engines would require regenerating all Execution JSON — effectively re-running the entire generation pipeline.
2. **Version coupling.** An engine update that changes its configuration format would invalidate existing Execution JSON.
3. **Multi-engine conflict.** If two engines require different configuration, the JSON would need to carry both — or pick one, excluding the other.

By remaining engine-independent, the Execution JSON serves as a **universal execution contract**. Any engine that understands the format can consume it.

---

## Stage 7 — Relationship to Framework Exports

### 7.1 Execution JSON Is the Source; Framework Exports Are Derived

This principle was established in B4.1 (EP5, EP6) and is reinforced here at the artifact level:

```
Execution JSON (source)
       │
       ├──→ Playwright Generator → Playwright Test Code
       ├──→ Cypress Generator (future) → Cypress Test Code
       ├──→ Selenium Generator (future) → Selenium Test Code
       └──→ Cucumber Generator (future) → Gherkin Feature File
```

The Execution JSON is the **single derivation point** for all framework exports. Each code generator reads the Execution JSON and translates it into its own syntax. No generator reads another generator's output.

### 7.2 Why No Framework Should Become the Execution Source of Truth

This was extensively argued in B4.1 Stage 5. The product-level reinforcement:

If Playwright code were the source of truth, then:
- Adding Cypress would require parsing Playwright code back into structured data.
- Manual edits to Playwright code would need to be reverse-engineered into Execution JSON.
- The Execution JSON would become a derived artifact, not a source — inverting the derivation pipeline.
- Switching frameworks would invalidate the source of truth.

By keeping the Execution JSON as the source, all of these problems are avoided. Framework exports are disposable — they can be regenerated at any time from the Execution JSON.

### 7.3 The Star Topology

The derivation graph is a **star**, not a chain:

```
                    Execution JSON
                   /      |       \
                  /       |        \
          Playwright   Cypress   Selenium
```

Each framework export derives directly from the Execution JSON. No export derives from another export. This topology means:
- Adding a framework is additive: one new spoke.
- Changing a framework's generator doesn't affect other frameworks.
- Removing a framework doesn't affect the Execution JSON or other frameworks.

---

## Stage 8 — Product Principles

### EJ-P1 — Framework-Agnostic

The Execution JSON contains no framework-specific syntax, no framework-specific selectors, and no framework-specific concepts. It describes *what* to execute in abstract terms. Any framework's code generator can consume it. (Reinforces B4.1 EP3, B4.3 LR-P6, B4.4 LP-P8.)

### EJ-P2 — Deterministic

The same Canonical Test Step always produces the same Execution JSON. Same locators, same action type, same context. No randomness, no variation. Regeneration is idempotent. (Reinforces B4.1 EP4, B4.2 EO-P3, B4.4 LP-P1.)

### EJ-P3 — Immutable After Generation

Once generated, the Execution JSON is never edited. It is replaced on regeneration (when the Step changes structurally). No manual edit path exists. The JSON is either fresh (just generated) or stale (being regenerated) — never partially updated. (Reinforces B4.2 EO-P7.)

### EJ-P4 — Derived from Execution Objects

The Execution JSON is the serialized form of the Execution Object. It carries exactly the six information categories defined in B4.2 — no more, no less. It does not invent data, omit data, or transform data. It is a faithful serialization. (Reinforces B4.1 EP2.)

### EJ-P5 — Independent of Execution Engines

The Execution JSON describes *what* to execute, not *how* a specific engine should execute it. No engine-specific configuration, runtime parameters, or assumptions. Any engine that understands the format can consume it. (Reinforces B4.1 EP6.)

### EJ-P6 — Independent of Export Formats

The Execution JSON is the source for all framework exports (Playwright, Cypress, etc.). It does not depend on any export format. No export format is privileged as the source of truth. The star topology ensures clean, independent derivation. (Reinforces B4.1 EP5, EP6.)

### EJ-P7 — Stable Over Time

The Execution JSON's structure and semantics are designed to remain stable as the product evolves. New capabilities (new action types, new locator strategies, new context types) are additive — they extend the JSON without changing existing structure. A code generator written today can consume Execution JSON generated next year (ignoring unknown extensions). (Reinforces B4.2 EO-P5, EO-P6, B4.4 LP-P9.)

### EJ-P8 — Extensible Without Redesign

The Execution JSON accommodates future capabilities (visual locators, API execution, mobile execution, database assertions) through additive extensions to the six information categories. No category is removed or restructured. New capabilities are new values within existing categories. (Reinforces B4.2 §6.7, B4.3 LR-P8, B4.4 LP-P9.)

---

## Stage 9 — Assumptions and Open Questions

### 9.1 Assumptions (Inherited from Frozen Predecessors)

1. **The Canonical Step Generator (B3) is complete and frozen.** Steps exist with element identity, action type, and a null `executionJson` field. The Execution JSON Generator populates that field. (B3, B2 §3.2)

2. **The Generation Engine invokes generators via the registry.** The Execution JSON Generator registers itself the same way the Canonical Step Generator did. (B3, B2 §2.3)

3. **Element identity is captured at click time and is immutable.** The locator candidates available are exactly what was recorded. (B2 §3.2)

4. **Locator resolution follows the frozen priority hierarchy.** Business Identifiers → Accessibility → Stable Technical → Content-Based → Structural. (B4.4 §2.1)

5. **A maximum of three locators per Execution Object.** Primary, secondary, fallback. (B4.4 §3.6)

6. **Navigation steps have no element locators.** They carry a target URL instead. (B2 §3.3, B4.4 §4.5)

7. **v1.0 has no version history.** Regeneration replaces. (B1 P15)

8. **The Execution JSON is embedded within the Canonical Test Step** as the `executionJson` field. It is not a separate storage record. (B2 §3.2, B3 implementation)

### 9.2 Open Questions (Deferred to Later Milestones)

1. **What are the exact field names and JSON structure?** Deferred to B4.6 (Execution JSON Schema Specification). This milestone defines responsibilities; the schema defines structure.

2. **How is the Execution JSON serialized for storage?** Deferred to B4.6/B4 architecture. This milestone establishes that the JSON is embedded in the Step; the exact serialization format is a schema concern.

3. **How does the side panel display Execution JSON data?** Deferred to the UI milestone. B3 already hides the Execution JSON section when null; B4 implementation will populate and display it.

4. **How does the Execution JSON Generator integrate with the existing Generation Engine?** Deferred to B4 architecture/implementation. B3 established the pattern (register in the registry, invoked by the engine).

5. **Should the Execution JSON carry a version field for forward compatibility?** Deferred to B4.6. This milestone establishes that the JSON is stable and extensible (EJ-P7); whether it carries an explicit version number is a schema decision.

6. **How are partial generation failures represented in the Execution JSON?** Deferred to B4.6/B4. B1 §9.3 established the product behavior (placeholder + retry); the representation is a schema concern.

7. **How will future execution engines formally specify their consumption contract?** Future milestone. This milestone establishes that engines consume the JSON; the formal interface between engine and JSON is an architecture concern.

---

## Stage 10 — Consistency with Frozen Predecessors

### 10.1 Alignment with B4.2 (Execution Object Design)

| B4.2 Decision | B4.5 Alignment |
|---|---|
| Six information categories (Stage 3) | ✅ EJ-P4: Execution JSON carries exactly these categories. |
| Execution Object is never manually edited (§2.4) | ✅ EJ-P3: JSON is immutable after generation. |
| Replace-on-change mutability model (§5.1) | ✅ §5.3: regeneration replaces the JSON entirely. |
| Forward compatibility (EO-P6) | ✅ EJ-P7: stable over time, generators ignore unknown extensions. |

### 10.2 Alignment with B4.1 (Execution Model)

| B4.1 Decision | B4.5 Alignment |
|---|---|
| Execution Object is the atomic execution unit (EP1) | ✅ Execution JSON serializes that unit. 1:1 mapping preserved. |
| Framework-agnostic (EP3) | ✅ EJ-P1. |
| Deterministic (EP4) | ✅ EJ-P2. |
| Playwright is derived (EP5) | ✅ EJ-P6 + Stage 7. |
| Future engines consume same model (EP6) | ✅ EJ-P5 + Stage 6. |

### 10.3 Alignment with B1 (Artifact Generation)

| B1 Decision | B4.5 Alignment |
|---|---|
| Execution JSON is always derived from Steps (Decision 7) | ✅ §2.3: derivation chain. EJ-P4. |
| Execution JSON never manually edited (§6.3) | ✅ EJ-P3, §5.2. |
| Future formats derive from Execution JSON (Decision 11) | ✅ Stage 7: star topology. |
| Workflow framework-agnostic at JSON level (Decision 12) | ✅ EJ-P1. |

### 10.4 Alignment with B2 (Architecture)

| B2 Decision | B4.5 Alignment |
|---|---|
| Execution JSON Generator populates executionJson on each step (§3.3) | ✅ §2.2: JSON embedded in Step. |
| Generators are pure functions (AP1) | ✅ EJ-P2: deterministic. |
| Engine owns state, generators don't (AP4) | ✅ §2.2: generator creates, engine persists. |

### 10.5 Alignment with B4.4 (Locator Priority Strategy)

| B4.4 Decision | B4.5 Alignment |
|---|---|
| Max 3 locators: primary, secondary, fallback (§3.6) | ✅ §3.3: JSON preserves locator decisions. |
| Priority hierarchy (§2.1) | ✅ §3.3: locators in JSON are resolved per B4.4. |
| Deterministic selection (LP-P1) | ✅ EJ-P2. |

### 10.6 No Conflicts Found

This document defines the **Execution JSON as a product artifact** — its purpose, responsibilities, boundaries, and immutability. It is fully consistent with all frozen predecessors. The Execution JSON is what B1/B2 called "Execution JSON," what B4.1 called "the serialized form of Execution Objects," and what B4.2 defined the content of. B4.5 freezes the product contract. No frozen decision is modified.

---

## Stage 11 — Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ JSON schema (field names, types, nesting, key naming)
- ❌ Serialization format (how the JSON is structured byte-by-byte)
- ❌ Classes or interfaces (implementation-level constructs)
- ❌ Implementation (generator code, engine integration)
- ❌ Playwright generation (code mapping, test structure)
- ❌ Execution algorithms (how engines consume the JSON)
- ❌ Storage model (storage keys, persistence strategy — beyond "embedded in Step")

These belong to B4.6 (Execution JSON Schema), B4 architecture, and B4 implementation.

---

## Stage 12 — Freeze Declaration

Upon approval, the following is declared **frozen**:

### Frozen Product Contract

1. **The Execution Object and the Execution JSON are two representations of a single execution contract.** The Execution Object is the product concept (what execution data means). The Execution JSON is the persistent representation (the serialized, stored form). They are not independent artifacts. Future milestones must never treat them as having independent lifecycles. (§1.3)

2. **The Execution JSON is the serialized representation of an Execution Object.** It is not a separate business object. It is embedded within its parent Canonical Test Step. (§1.1, §2.4)

2. **The Execution JSON is the execution contract for CmdRunner.** It is the authoritative, binding representation of what a Test Case step requires for execution. Code generators and execution engines consume it. (§1.4)

3. **The Execution JSON owns:** execution intent, resolved locator set, execution context, element descriptors, execution traceability, and generation metadata. (§4.1)

4. **The Execution JSON does NOT own:** recording history, business meaning, raw element identity, AI enrichment, review state, repository metadata, execution results, screenshots, logs, framework code, or Test Case metadata. (§4.2)

5. **The Execution JSON is never manually edited.** It is always derived. Regeneration replaces it entirely. No version history. (§5.2, §5.3, EJ-P3)

6. **The Execution JSON is framework-agnostic.** No framework-specific syntax. (EJ-P1)

7. **The Execution JSON is engine-independent.** No engine-specific configuration. Engines consume; they do not define. (EJ-P5, Stage 6)

8. **Framework exports derive from the Execution JSON** in a star topology. No export derives from another export. (EJ-P6, Stage 7)

9. **The Execution JSON is self-contained.** A code generator can produce working test code from a single Execution JSON structure without reading any other artifact. (§3.5)

10. **The Execution JSON is stable and extensible.** Future capabilities are additive. No existing structure is removed or restructured. (EJ-P7, EJ-P8)

### What This Freeze Means

- B4.6 (Execution JSON Schema) must define field names and JSON structure that carry these responsibilities.
- B4 architecture must design the Execution JSON Generator to produce JSON matching this contract.
- B4 implementation must implement the generator as a pure function within the existing Generation Engine.
- No future milestone may make the Execution JSON framework-specific, engine-coupled, manually editable, or dependent on any single export format.
- No future milestone may add non-execution concerns (recording history, review state, screenshots) to the Execution JSON.

---

*This document defines the CmdRunner Execution JSON Product Specification. All subsequent schema, architecture, and implementation milestones must conform to this specification.*
