# Milestone B5.2 — Execution JSON Contract Design

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Architecture & Contract Design (no implementation, no UI, no generator code)
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
- Milestone B5.1 — Execution JSON Architecture (frozen)

---

## 0. Purpose of This Document

The product design phase is complete. B4.1–B4.5 froze what the Execution Object *is*, what the Execution JSON *does*, and what it *owns*. B5.1 froze the *architecture* — how the Execution JSON Generator plugs into the pipeline, who owns what at each lifecycle stage, how regeneration works.

This milestone is the **final design milestone before implementation**. It defines the **Execution JSON Contract** — the concrete logical structure that:

- The Execution JSON Generator (B5.3/B5.4) will produce
- The CmdRunner Execution Engine will consume
- Future framework generators will read
- Validation tools can verify

This document defines logical sections, field names, object hierarchy, cardinality, required vs optional information, validation rules, and extensibility — all at the contract level. No generation algorithms. No implementation classes. No runtime logic. No UI.

**Scope rule:** If a future developer cannot answer "what fields does an Execution JSON contain?" from this document, the document is incomplete.

---

## Stage 1 — Contract Overview

### 1.1 What Is an Execution JSON Contract?

An Execution JSON is a self-contained data structure that carries the **complete machine-executable intent of one Canonical Test Step**. It is embedded as the `executionJson` field within its parent Step (B5.1 §1.3). One Execution JSON per Step — the 1:1 mapping is absolute (B4.1 EP1).

The contract defines **six logical sections**, each derived directly from the six information categories frozen in B4.2 Stage 3:

| Section | B4.2 Category | Purpose |
|---|---|---|
| **Action** | Action Information (§3.1) | What the machine must do |
| **Target** | Target Information (§3.2) | What element or resource the action targets |
| **Locators** | Locator Information (§3.3) | How to find the target element (resolved) |
| **Context** | Context Information (§3.4) | Environmental factors affecting execution |
| **Traceability** | Execution Metadata (§3.5) | Links to source artifacts and generation status |
| **Metadata** | Execution Metadata (§3.5) | Operational data about this execution object |

### 1.2 Why These Six Sections?

B4.2 froze six information categories as permanent and non-removable. The contract implements these categories as logical sections — one section per category. This is not an arbitrary structuring choice; it is a faithful implementation of the frozen information model.

The separation matters because different consumers read different sections:

| Consumer | Reads | Ignores |
|---|---|---|
| Playwright Generator | Action, Target, Locators, Context | Traceability (not needed for code generation) |
| Cypress Generator (future) | Same as Playwright | Same |
| CmdRunner Execution Engine (future) | Action, Target, Locators, Context | Traceability (used for error reporting only) |
| Side Panel (UI) | All sections | — |
| Generation Engine | Traceability (for status tracking) | Action, Target, Locators, Context (delegated to generators) |
| Validation tools | All sections | — |

### 1.3 How the Sections Relate

```
┌─────────────────────────────────────────────────────┐
│                   Execution JSON                     │
│                                                      │
│  ┌─────────────┐   ┌─────────────┐   ┌───────────┐  │
│  │   Action    │──▶│   Target    │──▶│  Locators │  │
│  │ (what to do)│   │ (what to    │   │ (how to   │  │
│  │             │   │  interact   │   │  find it) │  │
│  │             │   │  with)      │   │           │  │
│  └─────────────┘   └─────────────┘   └───────────┘  │
│         │                                   │       │
│         │         ┌─────────────┐           │       │
│         │         │   Context   │◀──────────┘       │
│         │         │ (environment│                   │
│         │         │  conditions)│                   │
│         │         └─────────────┘                   │
│         │                  │                        │
│         ▼                  ▼                        │
│  ┌─────────────┐   ┌─────────────┐                  │
│  │Traceability │   │  Metadata   │                  │
│  │ (links to   │   │ (operational│                  │
│  │  source)    │   │  data)      │                  │
│  └─────────────┘   └─────────────┘                  │
└─────────────────────────────────────────────────────┘
```

- **Action** is the entry point — it tells the consumer what kind of operation this is.
- **Target** is derived from Action — a click targets an element; a navigation targets a URL.
- **Locators** exist only when Target is an element — navigation has no locators.
- **Context** qualifies how to reach the Target — iframe boundaries, Shadow DOM.
- **Traceability** links back to the source Step and Timeline interaction.
- **Metadata** stamps operational data (generation status, timestamp).

### 1.4 Contract-Level Design Principles

The contract follows the nine principles established in B5.1 Stage 9. At the contract level, these manifest as:

| Principle | Contract Consequence |
|---|---|
| AP1 — Single Responsibility | Each section answers one question; no section overlaps another |
| AP2 — One Owner | Every field has a clear producer (the JSON Generator) and clear consumers |
| AP3 — One-Way Dependencies | Sections reference forward (Action → Target → Locators), never backward |
| AP4 — Immutable Generated Artifacts | Fields are populated once and replaced on regeneration, never patched |
| AP5 — Deterministic Generation | Same Step → same field values, every time |
| AP6 — Framework-Independent | No field contains framework-specific syntax or selectors |
| AP7 — Regeneration Replaces | No field carries "previous value" or "change history" |
| AP8 — Consumers Never Modify | No field is a "suggestion" or "preference" — all are resolved decisions |
| AP9 — Future Consumers Integrate Without Redesign | Extensibility sections accommodate future capabilities |

---

## Stage 2 — Contract Structure

### 2.1 Top-Level Shape

An Execution JSON is a single object with six top-level keys, one per logical section:

```
{
  action:     { ... },   // Action section — what to do
  target:     { ... },   // Target section — what to interact with
  locators:   [ ... ],   // Locators section — how to find it (array, may be empty)
  context:    { ... },   // Context section — environmental factors
  trace:      { ... },   // Traceability section — links to source
  meta:       { ... }    // Metadata section — operational data
}
```

### 2.2 Action Section

**Purpose:** Describes what the machine must do — the operation type and any operation-specific data.

**Responsibility:** The sole driver of code generation. A Playwright generator reads `action.type` to decide whether to emit `page.click()`, `page.goto()`, or `page.fill()`. The action type is abstract (framework-agnostic); the translation to framework syntax is the code generator's job.

**Structure:**

```
action: {
  type:        string,      // REQUIRED — abstract action verb
  value:       string|null  // OPTIONAL — operation-specific data (text to type, option to select)
}
```

**Field definitions:**

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | The abstract action category. v1.0 values: `"click"`, `"navigate"`. Future values: `"type"`, `"select"`, `"hover"`, `"assert"`, etc. |
| `value` | string \| null | No | Action-specific payload. For `"type"`: the text to enter. For `"select"`: the option value. For `"click"` and `"navigate"`: `null`. |

**Design rationale:** `type` is the minimal discriminator. `value` is optional because not all actions carry data (a click has no data payload; a text entry does). Separating `type` and `value` keeps the action description clean — a code generator switches on `type` and reads `value` only when the type requires it.

**Consistency check:** B4.2 §3.1 defines this as "the type of action the machine must perform and any data the action requires." B4.5 §3.1 states the Execution JSON must contain "what action to perform" and "any action-specific data." The `action.type` + `action.value` pair implements both requirements. ✅

### 2.3 Target Section

**Purpose:** Describes what element or resource the action targets — the semantic identity of the target, NOT the locator.

**Responsibility:** Provides enough information for logging, error reporting, and UI display. A code generator that fails to find an element can use the Target to generate a meaningful error message ("Element 'Submit' button not found"). An execution engine can use the Target for screenshot annotation.

**Structure:**

```
target: {
  kind:        string,      // REQUIRED — what kind of target is this?
  // --- element-specific fields (when kind = "element") ---
  tag:         string,      // REQUIRED for element — HTML tag, e.g. "BUTTON"
  role:        string|null, // OPTIONAL for element — ARIA role, e.g. "button"
  name:        string       // REQUIRED for element — accessible name, e.g. "Submit"
  // --- navigation-specific fields (when kind = "navigation") ---
  url:         string       // REQUIRED for navigation — destination URL
}
```

**Field definitions:**

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | string | Yes | Target type discriminator. v1.0 values: `"element"` (for element actions like click) and `"navigation"` (for navigation actions). |
| `tag` | string | Conditional (required when `kind = "element"`) | HTML tag name of the element, uppercased. |
| `role` | string \| null | Conditional (optional when `kind = "element"`) | ARIA role of the element. `null` if none. |
| `name` | string | Conditional (required when `kind = "element"`) | Accessible name of the element (computed). This is the human-readable identifier. |
| `url` | string | Conditional (required when `kind = "navigation"`) | Destination URL for navigation actions. |

**Design rationale:** B4.2 §3.2 defines Target as "identification of what element or resource the action targets" — explicitly separate from locators. B4.3 §0.2 establishes that "accessible name, role, tag" are descriptors (what it is), not locators (how to find it). The Target section carries these descriptors so that consumers have semantic context independent of locator strategy.

**The `kind` discriminator** is necessary because element targets and navigation targets carry fundamentally different data. An element target has `tag`, `role`, `name`. A navigation target has `url`. Without a discriminator, a consumer would need to guess which fields are present. `kind` makes the structure explicit.

**Why `name` is the accessible name:** B4.3 §0.2 defines accessible name as part of element identity. B4.4 §5.1 defines visible text (innerText) as the highest sub-priority within Content-Based Identity, but the accessible name (computed) is the semantic anchor — it captures the element's human-facing label regardless of how it was authored (aria-label, innerText, title, alt). For the Target section (which is about semantic identity, not locator strategy), accessible name is the correct field.

**Consistency check:** B4.2 §3.2: "the element's semantic identity — its accessible name, tag, role." B4.5 §4.1: "Element descriptors: tag, accessible name, role." This section carries exactly those three fields. ✅

### 2.4 Locators Section

**Purpose:** The resolved locator set — concrete strategies for finding the target element at execution time.

**Responsibility:** This is the core value of the Execution JSON. Code generators read the primary locator to produce framework-specific selectors. The section carries the Locator Resolution Engine's decisions, not the raw identity candidates.

**Structure:**

```
locators: [
  {
    strategy:   string,     // REQUIRED — locator strategy type
    value:      string,     // REQUIRED — locator value
    role:       string      // REQUIRED — "primary" | "secondary" | "fallback"
  },
  // ... up to 2 more (max 3 total per B4.4 §3.6)
]
```

**A `Locator` is an array of locator objects.** Each locator object has three fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `strategy` | string | Yes | How to find the element. v1.0 values (per B4.4 priority hierarchy): `"testId"`, `"dataCy"`, `"dataQa"`, `"dataTest"`, `"dataAutomationId"`, `"ariaLabel"`, `"ariaLabelledby"`, `"id"`, `"name"`, `"text"`, `"placeholder"`, `"alt"`, `"title"`, `"css"`, `"xpath"`. Future values: `"visual"`, `"accessibilityId"`, etc. |
| `value` | string | Yes | The concrete value for this strategy. E.g., `"submit"` for strategy `"testId"`, `"Submit Order"` for strategy `"text"`. |
| `role` | string | Yes | The locator's role in the resolution set: `"primary"`, `"secondary"`, or `"fallback"`. Exactly one locator has `role: "primary"` (when locators are present). |

**Cardinality:** The array has 0–3 entries:
- **0 entries** — navigation actions have no element locators (B4.4 §4.5). `locators: []`.
- **1 entry** — only one accepted candidate. `role: "primary"`.
- **2 entries** — primary + secondary. Roles: `"primary"`, `"secondary"`.
- **3 entries** — primary + secondary + fallback (maximum per B4.4 §3.6).

**Design rationale:** B4.3 §0.2 defines a locator as "a strategy + value pair." B4.4 §3.1 defines three roles: primary, secondary, fallback. The locator object is `{ strategy, value, role }` — the minimal representation of a resolved locator decision.

**Why an array, not separate primary/secondary/fallback fields:** An array is more flexible for extension. When a future capability adds a fourth locator role (e.g., `"contextual"` for relative-relationship locators), the array simply grows — no new top-level field. The `role` field makes the ordering explicit without relying on array position.

**Why `strategy` is a string enum, not a nested object:** Each strategy is a simple category — "find by test ID", "find by CSS selector." The value carries the concrete data. Nesting (e.g., `{ strategy: { type: "testId", attribute: "data-testid" } }`) would add complexity without information — `strategy: "testId"` already tells the code generator which attribute to use.

**Strategy enumeration (frozen by B4.4):**

| Priority | Strategy Values | B4.4 Category |
|---|---|---|
| 1 (Highest) | `testId`, `dataCy`, `dataQa`, `dataTest`, `dataAutomationId` | Business Identifiers |
| 2 | `ariaLabel`, `ariaLabelledby` | Accessibility Information |
| 3 | `id`, `name` | Stable Technical Identifiers |
| 4 | `text`, `placeholder`, `alt`, `title` | Content-Based Identity |
| 5 (Lowest) | `css`, `xpath` | Structural Identifiers |

**Consistency check:** B4.4 §2.1 freezes the priority hierarchy: Business → Accessibility → Stable Tech → Content → Structural. B4.4 §5.1 freezes intra-category sub-priority. B4.4 §3.6 freezes max 3 locators. B4.4 §4.3 DQ-1–DQ-4 freeze rejection rules. The `locators` section carries the output of these rules. ✅

### 2.5 Context Section

**Purpose:** Environmental factors that affect how the action is executed — iframe boundaries, Shadow DOM nesting.

**Responsibility:** Tells the code generator or execution engine about structural boundaries it must cross before applying locators. Without context, a locator that is correct within an iframe will fail at the top level.

**Structure:**

```
context: {
  iframe:      boolean,           // REQUIRED — is the target inside an iframe?
  shadowDom:   boolean,           // REQUIRED — is the target inside a Shadow DOM?
  frame:       IframeContext|null // CONDITIONAL — required when iframe = true
}
```

**Field definitions:**

| Field | Type | Required | Description |
|---|---|---|---|
| `iframe` | boolean | Yes | Whether the target element is inside an iframe. |
| `shadowDom` | boolean | Yes | Whether the target element is inside a Shadow DOM. |
| `frame` | IframeContext \| null | Conditional (required when `iframe = true`, null when `iframe = false`) | Detailed iframe navigation data (see below). |

**IframeContext structure (reused from ElementIdentity, B2 §3.2):**

```
frame: {
  frameSrc:      string,      // The iframe's URL
  frameName:     string|null, // The iframe's name attribute (same-origin only)
  frameId:       string|null, // The iframe's id attribute (same-origin only)
  frameSelector: string|null, // CSS selector for the iframe element in parent (same-origin only)
  frameXPath:    string|null, // XPath for the iframe element in parent (same-origin only)
  frameIndex:    number|null, // 0-based index among iframe siblings (same-origin only)
  frameDepth:    number       // How many levels deep (1 = direct child of top)
}
```

**Design rationale:** B4.2 §3.4 defines Context as "environmental context that affects how the action is executed." The two factors that affect execution are iframe nesting and Shadow DOM — these are already captured on `ElementIdentity` (shared/types.ts: inIframe, shadowDom, iframeContext) and are projected onto the Execution JSON unchanged.

B4.2 §3.4 explicitly separates context from locators: "Locators describe how to find the element *within its context*. Context describes *how to reach the context itself*." The context section answers "what frame am I in?" before the locators answer "where is the element within that frame?"

**Consistency check:** The `IframeContext` structure matches `RawElementIdentity.iframeContext` in `shared/types.ts` (lines 201–217). Same fields, same semantics. The generator copies this from element identity. ✅

### 2.6 Traceability Section

**Purpose:** Links the Execution JSON back to its source artifacts — the Canonical Test Step and the original Timeline interaction.

**Responsibility:** Enables debugging, auditing, and regeneration. Given an Execution JSON, a consumer can trace it to the Step it belongs to and the interaction that produced it.

**Structure:**

```
trace: {
  interactionId:   string,    // REQUIRED — the Timeline interaction's actionId
  stepId:          string     // REQUIRED — the parent Canonical Test Step's stepId
}
```

**Field definitions:**

| Field | Type | Required | Description |
|---|---|---|---|
| `interactionId` | string | Yes | The `actionId` from the source Timeline interaction (e.g., `"click-0001"`, `"nav-0001"`). Links the Execution JSON to the raw recording event. |
| `stepId` | string | Yes | The `stepId` of the parent Canonical Test Step (e.g., `"step-0001"`). Links the Execution JSON to its parent Step. |

**Design rationale:** B4.2 §4.2 defines traceability as "bidirectional and unbreakable" — linked by interaction ID. B4.5 §4.1 includes "execution traceability: link back to the source interaction." Both fields are simple string references — no embedded copies of source data. The trace section is a pointer, not a mirror.

**Why include `stepId`:** While the Execution JSON is embedded within the Step (so the Step is already the parent), including `stepId` in the trace section makes the Execution JSON self-contained — a consumer reading the JSON in isolation can identify which Step it belongs to without external context.

**Consistency check:** B4.2 §4.2: "linked by interaction ID." B3 `CanonicalStep` has both `stepId` and `linkedInteractionId`. The trace section carries both. ✅

### 2.7 Metadata Section

**Purpose:** Operational data about the Execution JSON itself — generation status, quality indicators, and timestamps.

**Responsibility:** Enables status tracking, partial-failure handling, and generation diagnostics. Does NOT affect execution semantics — code generators can ignore this section entirely.

**Structure:**

```
meta: {
  status:         string,        // REQUIRED — "generated" | "error"
  warnings:       string[],      // OPTIONAL — non-fatal quality warnings
  generatedAt:    string         // REQUIRED — ISO timestamp of generation
}
```

**Field definitions:**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | Generation status. `"generated"` = successfully produced. `"error"` = generation attempted but failed (see §3.3 for error representation). |
| `warnings` | string[] | Optional (default `[]`) | Non-fatal quality concerns detected during generation. E.g., "primary locator is a structural selector — low confidence." Empty array if no warnings. |
| `generatedAt` | string | Yes | ISO 8601 timestamp of when the Execution JSON was produced. Changes on every regeneration. |

**Design rationale:** B4.2 §3.5 defines Execution Metadata as "operational data about the Execution Object itself." B5.1 §7.3 defines the error marker for failed steps (status = "error", not null). B4.4 §2.3 notes that structural locators as primary may warrant a warning flag — the `warnings` array is where such flags live.

**The `status` field distinguishes from null:** `executionJson = null` means "not yet generated" (B3 default). `meta.status = "error"` means "generation was attempted and failed." `meta.status = "generated"` means "successfully produced." This three-state model is consistent with B5.1 §3.5 and §7.3.

**Why `warnings` is a string array:** Warnings are human-readable diagnostic messages. They are not structured error codes (that would be implementation over-engineering at the contract level). A QA engineer reads them; a code generator ignores them.

**Consistency check:** B5.1 §3.5: "Failed steps carry an error marker (not null)." B5.1 §7.3: partial failures have a non-null error marker. The `meta.status = "error"` with a warning message implements this. B4.2 §3.5: "generation status (success, partial, error)." ✅

---

## Stage 3 — Required vs Optional Information

### 3.1 Mandatory Fields (Required on Every Successfully Generated Execution JSON)

These fields MUST be present on every Execution JSON where `meta.status = "generated"`:

| Section | Field | Why Mandatory |
|---|---|---|
| Action | `action.type` | Without an action type, no consumer knows what to do. |
| Action | `action.value` (when applicable) | Some actions require data (e.g., text entry). |
| Target | `target.kind` | Without a target kind, the consumer doesn't know whether to look for an element or a URL. |
| Target | `target.tag` (element) | Describes the element semantically. Required for logging and error messages. |
| Target | `target.name` (element) | The accessible name — the human-readable identifier of the target. |
| Target | `target.url` (navigation) | The destination. Without it, navigation has no target. |
| Context | `context.iframe` | Must always be declared (true or false). Absence is ambiguous. |
| Context | `context.shadowDom` | Must always be declared (true or false). Absence is ambiguous. |
| Traceability | `trace.interactionId` | Links to source interaction. Required for traceability (B4.2 §4.2). |
| Traceability | `trace.stepId` | Links to parent Step. Required for self-containment. |
| Metadata | `meta.status` | Must be `"generated"` for a valid Execution JSON. |
| Metadata | `meta.generatedAt` | Timestamp is required for generation tracking. |

### 3.2 Optional Fields (Present When Applicable, Absent When Not)

These fields are conditionally present based on the action type, element identity, or generation outcome:

| Section | Field | Condition for Presence |
|---|---|---|
| Target | `target.role` | Present when the element has an ARIA role. `null` when absent. |
| Target | `target.url` | Present only when `target.kind = "navigation"`. |
| Context | `context.frame` | Present when `context.iframe = true`. `null` when `iframe = false`. |
| Locators | Entire section | Present when `target.kind = "element"`. Empty array `[]` when `target.kind = "navigation"`. |
| Metadata | `meta.warnings` | Optional array. Present when warnings were detected; `[]` when none. |

### 3.3 Derived Fields (Computed by the Generator, Not Captured)

These fields are not captured during recording — they are **derived** by the Execution JSON Generator:

| Field | Derived From |
|---|---|
| `locators[].strategy` | Element identity attributes, filtered by B4.4 acceptance rules, ordered by B4.4 priority hierarchy |
| `locators[].value` | The captured attribute value for the chosen strategy |
| `locators[].role` | Assigned by the Locator Resolution Engine (primary/secondary/fallback) |
| `meta.status` | Outcome of generation (success or error) |
| `meta.warnings` | Quality flags detected during locator resolution |
| `meta.generatedAt` | Current timestamp at generation time |

### 3.4 Future Extension Points

The contract is designed for additive extension. Future capabilities add **new values to existing fields**, not new top-level sections:

| Future Capability | Extension Mechanism | What Changes |
|---|---|---|
| New action type (e.g., `"type"`, `"select"`) | New value in `action.type` | Nothing else changes |
| New locator strategy (e.g., `"visual"`) | New value in `locators[].strategy` | Nothing else changes |
| New context type (e.g., mobile platform) | New fields in `context` | Existing fields stay |
| API execution | New `target.kind` value (e.g., `"endpoint"`) | New target fields |
| AI metadata | New optional field in `meta` (e.g., `meta.aiConfidence`) | Existing fields stay |
| Schema versioning | New optional field in `meta` (e.g., `meta.schemaVersion`) | Existing fields stay |

**The contract never removes fields.** Once a field is defined, it remains. New capabilities are additive. A code generator written today ignores fields it doesn't recognize and continues to function.

---

## Stage 4 — Relationships

### 4.1 Internal Relationships (Within One Execution JSON)

```
action.type  ────── determines ──────▶  target.kind
                                              │
                                    "element" │ "navigation"
                                         │           │
                                         ▼           ▼
                              locators present    locators = []
                              (1-3 entries)       target.url set
                                         │
                                         ▼
                              context.iframe ──▶ context.frame (when true)
                              context.shadowDom
```

**Dependency rules:**

1. `action.type` determines the shape of `target`.
   - `"click"` → `target.kind = "element"` → target has `tag`, `role`, `name`
   - `"navigate"` → `target.kind = "navigation"` → target has `url`

2. `target.kind` determines whether `locators` is populated.
   - `"element"` → `locators` has 1–3 entries
   - `"navigation"` → `locators` is `[]`

3. `context.iframe` determines whether `context.frame` is populated.
   - `true` → `context.frame` is an IframeContext object
   - `false` → `context.frame` is `null`

4. `trace` and `meta` are independent of all other sections.
   - They carry reference and operational data, not execution data.
   - Their presence and content do not depend on `action`, `target`, `locators`, or `context`.

### 4.2 External Relationships (Across the Pipeline)

```
CanonicalStep.elementIdentity  ─── input to ───▶  Locator Resolution Engine
                                                          │
                                                          ▼
                                               Execution JSON.locators
                                               Execution JSON.target
                                               Execution JSON.context

CanonicalStep.linkedInteractionId  ─── projected ──▶  Execution JSON.trace.interactionId
CanonicalStep.stepId  ────────────── projected ───▶  Execution JSON.trace.stepId
CanonicalStep.actionType  ──────── translated ───▶  Execution JSON.action.type
```

**The Execution JSON never references back to the Step.** The Step-to-JSON relationship is embedding (JSON is a field on the Step), not referencing. The trace section provides links *for consumers*, not for the JSON itself to resolve.

### 4.3 Ownership Summary

| Section | Data Source | Owner (at rest) |
|---|---|---|
| `action` | CanonicalStep.actionType (translated to abstract verb) | Step (via executionJson) |
| `target` | CanonicalStep.elementIdentity (tag, role, accessibleName) or NavigationEvent (url) | Step (via executionJson) |
| `locators` | CanonicalStep.elementIdentity (resolved by Locator Resolution Engine) | Step (via executionJson) |
| `context` | CanonicalStep.elementIdentity (inIframe, shadowDom, iframeContext) | Step (via executionJson) |
| `trace` | CanonicalStep.linkedInteractionId + stepId | Step (via executionJson) |
| `meta` | Generation outcome (status, warnings, timestamp) | Step (via executionJson) |

---

## Stage 5 — Cardinality

### 5.1 Entity-Level Cardinality

```
One Test Case
  └── N Canonical Test Steps (N ≥ 1)
        └── One Step = One Execution JSON     (1:1, per B4.1 EP1)
              └── One Execution JSON = One Action           (1:1)
                                    = One Target            (1:1)
                                    = 0..3 Locators         (0..N, max 3)
                                    = One Context           (1:1)
                                    = One Traceability      (1:1)
                                    = One Metadata          (1:1)
```

### 5.2 Section Cardinality Detail

| Section | Cardinality | Constraint |
|---|---|---|
| `action` | Exactly 1 per Execution JSON | Always present |
| `action.type` | Exactly 1 | Must be a known action type |
| `action.value` | 0 or 1 | Present only when the action type requires data |
| `target` | Exactly 1 per Execution JSON | Always present |
| `target.kind` | Exactly 1 | `"element"` or `"navigation"` |
| `target.tag` | 0 or 1 | Present iff `kind = "element"` |
| `target.role` | 0 or 1 | Present iff `kind = "element"` and element has ARIA role |
| `target.name` | 0 or 1 | Present iff `kind = "element"` |
| `target.url` | 0 or 1 | Present iff `kind = "navigation"` |
| `locators` | 0 to 3 entries | 0 when `kind = "navigation"`. 1–3 when `kind = "element"`. Max 3 (B4.4 §3.6). |
| `context` | Exactly 1 per Execution JSON | Always present |
| `context.iframe` | Exactly 1 | Boolean |
| `context.shadowDom` | Exactly 1 | Boolean |
| `context.frame` | 0 or 1 | Present iff `iframe = true` |
| `trace` | Exactly 1 per Execution JSON | Always present |
| `trace.interactionId` | Exactly 1 | Non-empty string |
| `trace.stepId` | Exactly 1 | Non-empty string |
| `meta` | Exactly 1 per Execution JSON | Always present |
| `meta.status` | Exactly 1 | `"generated"` or `"error"` |
| `meta.warnings` | 0 or 1 | Array (may be empty) |
| `meta.generatedAt` | Exactly 1 | ISO timestamp |

### 5.3 Locator-Entry Cardinality (Within the `locators` Array)

| Locator Role | Count | Constraint |
|---|---|---|
| `primary` | Exactly 1 (when locators are present) | The highest-priority accepted locator |
| `secondary` | 0 or 1 | The next-highest accepted locator from a different category when possible |
| `fallback` | 0 or 1 | The lowest-priority accepted locator |

Total: 1–3 locator entries per element-action Execution JSON. 0 for navigation.

---

## Stage 6 — Validation Rules

### 6.1 What Makes an Execution JSON Valid?

An Execution JSON is valid when ALL of the following hold:

**VR-1: All mandatory sections are present.** The `action`, `target`, `context`, `trace`, and `meta` sections must exist. `locators` must exist (may be an empty array).

**VR-2: Action type is non-empty.** `action.type` must be a non-empty string. An Execution JSON with `action.type = ""` or `action.type = null` is invalid.

**VR-3: Target kind matches action type.** If `action.type = "click"`, then `target.kind` must be `"element"`. If `action.type = "navigate"`, then `target.kind` must be `"navigation"`. Mismatched pairs are invalid.

**VR-4: Element targets have required fields.** When `target.kind = "element"`: `target.tag` and `target.name` must be non-empty strings. `target.role` may be `null`.

**VR-5: Navigation targets have required fields.** When `target.kind = "navigation"`: `target.url` must be a non-empty string.

**VR-6: Locator count is within bounds.** The `locators` array has 0–3 entries. An array with 4+ entries is invalid (violates B4.4 §3.6).

**VR-7: Exactly one primary locator.** When `locators` is non-empty, exactly one entry has `role: "primary"`. Zero or multiple primaries is invalid.

**VR-8: Locator strategies are unique.** No two locator entries share the same `strategy` value within a single Execution JSON. Duplicate strategies are invalid.

**VR-9: Locator values are non-empty.** Every locator entry has a non-empty `value`. A locator with `value = ""` is invalid.

**VR-10: Context booleans are present.** `context.iframe` and `context.shadowDom` are present and are booleans (not undefined, not strings).

**VR-11: Frame context matches iframe flag.** If `context.iframe = true`, then `context.frame` must be a non-null object. If `context.iframe = false`, then `context.frame` must be `null` or absent.

**VR-12: Traceability IDs are non-empty.** `trace.interactionId` and `trace.stepId` must be non-empty strings.

**VR-13: Metadata status is valid.** `meta.status` must be `"generated"` or `"error"`. `meta.generatedAt` must be a valid ISO 8601 timestamp string.

### 6.2 What Makes an Execution JSON Invalid?

| Violation | Severity | Example |
|---|---|---|
| Missing `action` section | Fatal | `{ target: {...}, locators: [] }` |
| Empty `action.type` | Fatal | `{ action: { type: "" } }` |
| Target/action mismatch | Fatal | `action.type = "click"` but `target.kind = "navigation"` |
| 4+ locators | Fatal | `locators` array with 4 entries |
| Zero primary locators (when locators exist) | Fatal | All locators have `role: "secondary"` |
| Missing `target.name` for element target | Fatal | Element target without accessible name |
| Missing `meta.status` | Fatal | No metadata section |
| `context.iframe = true` but `frame = null` | Fatal | Inconsistent context |

### 6.3 What Makes an Execution JSON a Partial-Error?

A partial-error Execution JSON is one where `meta.status = "error"`. This means:

- The Execution JSON Generator attempted to produce execution data but failed (e.g., locator resolution could not find any accepted locator).
- The Execution JSON still exists (it is NOT null — null means "not yet generated").
- It may have some sections populated (action, target, trace, meta) but `locators` will be empty even for element actions.
- The `meta.warnings` array contains the failure reason(s).
- Code generators reading this Execution JSON should treat it as a broken step — they can emit a commented-out placeholder in generated code.

### 6.4 What Minimum Information Is Required?

For a minimal valid Execution JSON (a click on an element with only visible text):

```
{
  action: {
    type: "click",
    value: null
  },
  target: {
    kind: "element",
    tag: "BUTTON",
    role: null,
    name: "Submit"
  },
  locators: [
    {
      strategy: "text",
      value: "Submit",
      role: "primary"
    }
  ],
  context: {
    iframe: false,
    shadowDom: false,
    frame: null
  },
  trace: {
    interactionId: "click-0001",
    stepId: "step-0001"
  },
  meta: {
    status: "generated",
    warnings: [],
    generatedAt: "2026-07-14T12:00:00.000Z"
  }
}
```

For a navigation step:

```
{
  action: {
    type: "navigate",
    value: null
  },
  target: {
    kind: "navigation",
    url: "https://example.com/results"
  },
  locators: [],
  context: {
    iframe: false,
    shadowDom: false,
    frame: null
  },
  trace: {
    interactionId: "nav-0001",
    stepId: "step-0002"
  },
  meta: {
    status: "generated",
    warnings: [],
    generatedAt: "2026-07-14T12:00:01.000Z"
  }
}
```

### 6.5 Section Dependencies Summary

```
action.type          ──determines──▶  target.kind
target.kind          ──determines──▶  locators (element: 1-3, navigation: 0)
target.kind          ──determines──▶  target fields (element: tag/name/role, navigation: url)
context.iframe       ──determines──▶  context.frame (true: object, false: null)
meta.status          ──independent──▶ (affects how consumers treat the whole JSON)
trace.*              ──independent──▶ (reference data, no dependencies)
```

---

## Stage 7 — Extensibility

### 7.1 The Additive Extension Principle

The Execution JSON contract grows **additively** — new capabilities add new values to existing fields or new optional fields to existing sections. No existing field is removed, renamed, or restructured.

This is the forward-compatibility guarantee from B4.2 §6.7, B4.5 EJ-P7/EJ-P8, and B5.1 AP9, expressed at the contract level.

### 7.2 How Each Future Capability Extends the Contract

**New action type (e.g., `"type"` for text entry):**
```
action: {
  type: "type",          // ← new value
  value: "hello world"   // ← value now carries text
}
// target, locators, context, trace, meta — unchanged
```
A code generator written for v1.0 that doesn't recognize `"type"` can emit a comment (`// Unknown action type: type`). No breakage.

**New locator strategy (e.g., `"visual"`):**
```
locators: [
  { strategy: "visual", value: "region:100,200,80,30", role: "fallback" }
]
```
A code generator that doesn't recognize `"visual"` ignores it and uses the primary locator. No breakage.

**New context type (e.g., mobile platform):**
```
context: {
  iframe: false,
  shadowDom: false,
  frame: null,
  platform: "ios"        // ← new optional field
}
```
A code generator that doesn't read `context.platform` ignores it. No breakage.

**API execution (new target kind):**
```
target: {
  kind: "endpoint",      // ← new kind value
  method: "GET",         // ← new target field
  url: "/api/users/123"  // ← url re-used for endpoints
}
```
A code generator written for browser actions ignores `kind = "endpoint"` or emits a placeholder. No breakage.

**AI metadata:**
```
meta: {
  status: "generated",
  warnings: [],
  generatedAt: "2026-07-14T12:00:00.000Z",
  aiConfidence: 0.95     // ← new optional field
}
```
A code generator ignores `aiConfidence`. No breakage.

**Schema versioning (if adopted in the future):**
```
meta: {
  status: "generated",
  warnings: [],
  generatedAt: "2026-07-14T12:00:00.000Z",
  schemaVersion: "1.0"   // ← new optional field
}
```
A consumer reads `schemaVersion` to decide which fields to expect. Consumers that don't read it assume v1.0 and ignore unknown fields. No breakage.

### 7.3 What Never Changes

| Aspect | Stability Guarantee |
|---|---|
| Six top-level sections (`action`, `target`, `locators`, `context`, `trace`, `meta`) | Permanent — frozen by B4.2 and B4.5 |
| `action.type` as a string discriminator | Permanent |
| `target.kind` as a discriminator | Permanent |
| Locator as `{ strategy, value, role }` | Permanent |
| Maximum 3 locators per Execution JSON | Permanent (B4.4 §3.6) |
| Traceability by interaction ID | Permanent (B4.2 §4.2) |
| `meta.status` as `"generated"` or `"error"` | Permanent (B5.1 §7.3) |
| Embedding within the Step (`executionJson` field) | Permanent (B5.1 §1.3) |

### 7.4 The Contract Versioning Philosophy

This document does NOT define a `schemaVersion` field for v1.0. The reasoning:

1. The contract is additive. New capabilities add fields without breaking existing consumers. A consumer that ignores unknown fields (the standard JSON consumer behavior) works across all versions.
2. A version field adds complexity without benefit in an additive model. It is only needed when breaking changes are possible — and the contract design forbids breaking changes.
3. If a future milestone determines that version tracking is needed (e.g., for migration tooling), `meta.schemaVersion` can be added as an optional field without breaking v1.0 consumers.

This is a **deferred decision**, not a permanent rejection. It is listed in Open Questions (§10.2).

---

## Stage 8 — Contract Principles

### CP1 — Stable

The contract's six top-level sections are permanent. They will not be removed, merged, or restructured. A code generator written against v1.0 will continue to work with all future versions, because all future versions are additive.

### CP2 — Deterministic

Given the same Canonical Test Step (same element identity, same action type), the Execution JSON Generator produces the same Execution JSON every time — same locator strategies, same values, same roles, same warnings. The only field that changes across regenerations is `meta.generatedAt`. (B5.1 AP5, B4.4 LP-P1, B4.2 EO-P3.)

### CP3 — Framework-Agnostic

No field in the contract contains framework-specific syntax. `action.type` is `"click"`, not `"page.click()"`. Locator strategies are abstract (`"testId"`, not `"[data-testid=...]"`). Translation to framework syntax is the code generator's responsibility. (B5.1 AP6, B4.5 EJ-P1.)

### CP4 — Self-Contained

A code generator can read a single Execution JSON and produce a complete test action without reading the Step, the Timeline, the Recording Context, or any other artifact. Every field the code generator needs is in the Execution JSON. (B4.5 §3.5.)

### CP5 — Backward Compatible

New capabilities extend the contract by adding optional fields or new enum values. Existing consumers that ignore unknown fields continue to function. An Execution JSON generated by v1.0 is consumable by a code generator written for v2.0, and vice versa. (B4.5 EJ-P7, B4.2 EO-P6.)

### CP6 — Extensible

The contract accommodates future capabilities (new action types, new locator strategies, new context types, API/mobile execution, AI metadata) without restructuring. All extensions are additive — new values in existing fields or new optional fields in existing sections. (B4.5 EJ-P8, B4.2 §6.7.)

### CP7 — Easy to Validate

The contract has clear validation rules (§6): mandatory vs optional fields, cardinality constraints, consistency constraints (e.g., target kind matches action type). A validator can check all rules without understanding execution semantics — they are structural checks, not behavioral checks.

### CP8 — Easy to Consume

A code generator switches on `action.type` to decide which method to emit. It reads the primary locator to produce the selector. It reads `context` to handle iframe/Shadow DOM. It ignores `trace` and `meta.warnings` if it doesn't need them. The consumption pattern is simple, predictable, and well-documented.

### CP9 — Easy to Generate

The Execution JSON Generator reads the Canonical Step's element identity, passes it to the Locator Resolution Engine (which applies B4.4's frozen rules), constructs the six sections, and serializes. No external calls, no AI, no network. Pure function in, serialized JSON out. (B5.1 AP5.)

---

## Stage 9 — Consistency with Frozen Predecessors

### 9.1 Alignment with B4.2 (Execution Object Design)

| B4.2 Decision | B5.2 Contract Alignment |
|---|---|
| Six information categories (Stage 3) | ✅ Six sections: action, target, locators, context, trace, meta. One per category. |
| Action Information: action category + action value (§3.1) | ✅ `action.type` + `action.value`. |
| Target Information: semantic identity — tag, role, accessible name (§3.2) | ✅ `target.tag`, `target.role`, `target.name`. |
| Locator Information: primary + fallbacks (§3.3) | ✅ `locators[]` with `role: primary/secondary/fallback`. Max 3. |
| Context Information: iframe, Shadow DOM, frame depth (§3.4) | ✅ `context.iframe`, `context.shadowDom`, `context.frame`. |
| Execution Metadata: traceability, generation timestamp, status (§3.5) | ✅ `trace` section + `meta` section. |
| Future Extension Data (§3.6) | ✅ Extension points in every section (§7.2). |
| 1:1 mapping Step → Execution Object (§4.1) | ✅ One Execution JSON per Step. |
| Traceability by interaction ID (§4.2) | ✅ `trace.interactionId`. |
| Replace-on-change mutability (§5.1) | ✅ Contract carries no "previous value" or "change history." |
| Forward compatibility (EO-P6) | ✅ CP5 — backward compatible. |

### 9.2 Alignment with B4.4 (Locator Priority Strategy)

| B4.4 Decision | B5.2 Contract Alignment |
|---|---|
| Priority hierarchy: Business → Accessibility → Stable Tech → Content → Structural (§2.1) | ✅ Strategy enum in §2.4 ordered by category. |
| Max 3 locators (§3.6) | ✅ VR-6: locators array has 0–3 entries. |
| Three roles: primary, secondary, fallback (§3.1) | ✅ `locators[].role` field. |
| Hierarchy operates on available candidates (§2.1.1) | ✅ Locator count driven by available accepted candidates. |
| Navigation exempt from locator rules (§4.5) | ✅ Navigation: `locators = []`. |
| Intra-category sub-priority (§5.1) | ✅ Strategy enum lists sub-priority order within each category. |
| Deterministic selection (LP-P1) | ✅ CP2 — deterministic contract. |
| Auto-generated IDs rejected (DQ-1) | ✅ Implementation will filter — contract carries only accepted locators. |

### 9.3 Alignment with B4.5 (Execution JSON Product Specification)

| B4.5 Decision | B5.2 Contract Alignment |
|---|---|
| Execution JSON owns: execution intent, locators, context, descriptors, traceability, metadata (§4.1) | ✅ action, locators, context, target, trace, meta sections. |
| Execution JSON does NOT own: recording history, business meaning, raw identity, AI enrichment, review state, results, screenshots (§4.2) | ✅ No fields for any of these. Raw identity stays on the Step. |
| Self-contained (§3.5) | ✅ CP4 — self-contained. |
| Framework-agnostic (EJ-P1) | ✅ CP3. |
| Deterministic (EJ-P2) | ✅ CP2. |
| Immutable after generation (EJ-P3) | ✅ No "previous value" fields. |
| Embedded in Step (§2.4) | ✅ Contract describes the `executionJson` field's content. |
| Extensible without redesign (EJ-P8) | ✅ CP6, §7. |

### 9.4 Alignment with B5.1 (Execution JSON Architecture)

| B5.1 Decision | B5.2 Contract Alignment |
|---|---|
| Locator Resolution Engine produces primary/secondary/fallback (§5.2) | ✅ `locators[]` with `role` field. |
| Failed steps carry error marker, not null (§3.5, §7.3) | ✅ `meta.status = "error"` + `meta.warnings`. |
| Execution JSON embedded in Steps under GENERATED_STEPS (§1.3) | ✅ Contract defines what the `executionJson` field contains. |
| Regeneration replaces, never mutates (AP7) | ✅ No delta fields, no change history. |
| Consumers are read-only (AP8) | ✅ No "editable" or "suggestion" fields. |

### 9.6 Existing Code Compatibility

The current `ExecutionJson` interface in `shared/types.ts` (lines 245–266) has a **flat structure**:

```
action: string
actionId: string
elementId: string
primaryLocator: Locator
fallbackLocators: Locator[]
tag, accessibleName, ariaRole
inIframe, shadowDom, iframeContext?
```

The B5.2 contract introduces a **structured six-section model**. This is a **redesign of the TypeScript interface**, not a conflict with any frozen product decision — the existing interface predates the B4.x product design (it was a v2.2.0 placeholder). The implementation milestone (B5.3/B5.4) will:

1. Replace the flat `ExecutionJson` interface with the structured contract.
2. Update the `CanonicalStep.executionJson` type from `null` to the new contract type.
3. Implement the Execution JSON Generator to produce the new structure.
4. Update the side panel to read the new structure (UI milestone).

This is expected and planned — not a regression. The frozen specs (B4.2, B4.5, B5.1) consistently describe a structured model, not the flat placeholder.

### 9.7 No Conflicts Found

B5.2 is fully consistent with all frozen predecessors. It translates the six information categories (B4.2), locator roles (B4.4), ownership boundaries (B4.5), and architecture principles (B5.1) into a concrete logical contract. No frozen decision is modified.

---

## Stage 10 — Assumptions and Open Questions

### 10.1 Assumptions

1. **The Canonical Step Generator (B3) is complete.** Steps with `executionJson = null` are available. The Step structure (`CanonicalStep` in `src/generation/types.ts`) is the input. (B3, frozen.)

2. **Element identity on Steps contains all captured attributes** — testId, dataCy, dataQa, ariaLabel, ariaLabelledby, id, name, accessibleName, tag, ariaRole, cssSelector, xPath, placeholder, inIframe, shadowDom, iframeContext. (shared/types.ts: `RawElementIdentity`.)

3. **Navigation events have a `url` and `title`** but no element identity. (shared/types.ts: `NavigationEvent`.)

4. **The Locator Resolution Engine implements B4.4's priority hierarchy.** The contract assumes locators arrive pre-resolved with roles assigned. (B5.1 §5.2.)

5. **The contract describes what the generator produces, not how.** Generation algorithms, acceptance-rule implementations, and locator-scoring logic are deferred to B5.3 (Generator Architecture) and B5.4 (Implementation).

6. **The `IframeContext` structure is stable** and matches the existing `shared/types.ts` definition. No changes needed.

7. **v1.0 supports two action types: `"click"` and `"navigate"`.** These are the only interaction types currently implemented (v3.1.2). Future action types extend `action.type` additively.

### 10.2 Open Questions (Deferred to Implementation)

1. **How are auto-generated IDs detected algorithmically?** B4.4 DQ-1 defines the rule ("reject them"). The detection patterns (regex for React, Vue, Angular IDs) are implementation details for B5.3/B5.4. The contract simply carries only accepted locators.

2. **Should the contract include a `schemaVersion` field?** This document defers the decision (§7.4). If needed, `meta.schemaVersion` is additive.

3. **How does the side panel render each section?** Deferred to a UI milestone. The contract defines the data; the UI milestone defines the presentation.

4. **How are `meta.warnings` messages standardized?** The contract uses free-text strings. Standardization of warning codes (if needed) is deferred.

5. **What happens when an element has zero accepted locators?** The contract handles this: `meta.status = "error"`, `locators = []`, `meta.warnings` contains the reason. The generator produces a valid Execution JSON with error status — not null.

6. **How are composite actions (e.g., select from dropdown = click to open + click to select) represented?** Each sub-action is a separate Step with its own Execution JSON (B4.1 §3.2). The contract applies per-Step. No special handling needed.

7. **Should `action.value` support non-string types?** v1.0 actions (`click`, `navigate`) use `value: null`. Future actions like `"type"` will use string values. If a future action needs structured data (e.g., a multi-field form entry), `action.value` may be extended or `action` may gain additional fields. This is additive — deferred to the relevant future milestone.

---

## Stage 11 — Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ Generation algorithms (how locators are resolved, how acceptance rules are implemented)
- ❌ Implementation classes (GeneratorContract implementation, Locator Resolution Engine code)
- ❌ Runtime logic (how an execution engine interprets the JSON)
- ❌ UI design (how the side panel renders the sections)
- ❌ Playwright generation (how the Playwright Generator translates the contract)
- ❌ Storage mechanics (how the JSON is serialized to chrome.storage.local — beyond "embedded in Step")
- ❌ Test cases or test data

These belong to B5.3 (Generator Architecture), B5.4 (Generator Implementation), the UI milestone, and B6 (Playwright).

---

## Stage 12 — Freeze Declaration

Upon approval, the following is declared **frozen**:

### Frozen Contract

1. **The Execution JSON has six top-level sections:** `action`, `target`, `locators`, `context`, `trace`, `meta`. These correspond to the six B4.2 information categories. They are permanent. (§1.1, §2)

2. **The `action` section carries `type` (required) and `value` (optional).** The type is an abstract action verb (`"click"`, `"navigate"`). The value is action-specific data. (§2.2)

3. **The `target` section uses a `kind` discriminator.** `"element"` targets carry `tag`, `role` (nullable), `name`. `"navigation"` targets carry `url`. (§2.3)

4. **The `locators` section is an array of 0–3 locator objects.** Each locator is `{ strategy, value, role }`. Exactly one has `role: "primary"` (when non-empty). Navigation steps have `locators: []`. (§2.4)

5. **The `context` section carries `iframe` (boolean), `shadowDom` (boolean), and `frame` (IframeContext|null).** (§2.5)

6. **The `trace` section carries `interactionId` and `stepId`** — both non-empty strings. (§2.6)

7. **The `meta` section carries `status` ("generated"|"error"), `warnings` (string[]), and `generatedAt` (ISO timestamp).** (§2.7)

8. **Validation rules VR-1 through VR-13 are binding.** Every produced Execution JSON must satisfy all rules. (§6.1)

9. **The contract is additive.** Future capabilities add new field values or optional fields. No existing field is removed, renamed, or restructured. (§7, CP5, CP6)

10. **No `schemaVersion` field is defined for v1.0.** If needed in the future, it is added to `meta` additively. (§7.4)

### What This Freeze Means

- **B5.3 (Generator Architecture)** must design the Execution JSON Generator's internal structure to produce this contract. The Locator Resolution Engine must populate `locators[]` per B4.4 rules. The generator must construct all six sections.
- **B5.4 (Generator Implementation)** must implement the generator as a pure function that produces this contract, registers in the Generator Registry, and is invoked by the Generation Engine.
- **The existing `ExecutionJson` interface in `shared/types.ts`** will be replaced by the structured contract during B5.4 implementation. This is expected — the flat interface was a pre-B4.x placeholder.
- **No future milestone** may add a seventh top-level section, remove a section, change locator structure from `{ strategy, value, role }`, or allow the contract to exceed 3 locators.

---

## Stage 13 — Implementation-Readiness Checklist

A future developer should be able to answer:

| Question | Answer (from this document) |
|---|---|
| What logical sections exist within an Execution JSON? | Six: `action`, `target`, `locators`, `context`, `trace`, `meta`. (§1.1, §2) |
| What information is mandatory? | 13 mandatory fields across 6 sections, listed in §3.1. |
| What information is optional? | 5 conditional fields, listed in §3.2. |
| How are the sections organized? | Six top-level keys on the Execution JSON object, each containing a sub-object (or array for locators). (§2.1) |
| How do the sections relate? | `action.type` determines `target.kind`, which determines locator presence. `context.iframe` determines frame data. `trace` and `meta` are independent. (§4.1) |
| What makes an Execution JSON valid? | 13 validation rules (VR-1–VR-13) covering presence, consistency, cardinality, and non-emptiness. (§6.1) |
| How can future capabilities extend the contract? | Additively: new enum values in existing fields, new optional fields in existing sections. No removal or restructuring. (§7) |
| What does a minimal valid Execution JSON look like? | Examples in §6.4 for both element and navigation actions. |
| What does a partial-error Execution JSON look like? | `meta.status = "error"`, `locators = []`, `meta.warnings` contains failure reasons. (§6.3) |

---

*This document defines the CmdRunner Execution JSON Contract. All subsequent generator architecture, implementation, and consumer milestones must conform to this contract.*
