# Milestone B7.1 — Canonical Test Step Readability Strategy

**Type:** Product Design (design only — no implementation)
**Status:** FROZEN
**Date:** 2026-07-15
**Depends on:** Product Foundation, Product Architecture, B1, B2, B3, B4.1–B4.5, B5.1–B5.2, B5.3, B6
**Implementation milestone:** B7.2

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Architectural Position](#2-architectural-position)
3. [Intent Preservation](#3-intent-preservation)
4. [Deterministic Optimization Rules](#4-deterministic-optimization-rules)
5. [Guardrails](#5-guardrails)
6. [Relationship to Future AI](#6-relationship-to-future-ai)
7. [Product Principles](#7-product-principles)
8. [Consistency with the Frozen Execution Model](#8-consistency-with-the-frozen-execution-model)
9. [Assumptions](#9-assumptions)
10. [Consistency Check Against Frozen Milestones](#10-consistency-check-against-frozen-milestones)
11. [Implementation Readiness for B7.2](#11-implementation-readiness-for-b72)

---

## 1. Purpose

### 1.1 What Is Canonical Test Step Readability?

Canonical Test Step Readability is the quality of the **plain English description** that each Canonical Test Step carries. Every step has a `plainEnglish` string — the human-readable sentence that a tester reads during review to understand what the step does.

Current example (post-recording, before any optimization):

```
Step 1: Click "Username" input field
Step 2: Enter "Admin" into "Username"
Step 3: Click "Password" input field
Step 4: Enter "admin123" into "Password"
Step 5: Click "Login"
Step 6: Navigate to "https://example.com/dashboard"
```

These are technically accurate but contain **implementation noise** — details that faithfully represent what was recorded but add cognitive load without adding meaning. A human reading these steps sees six discrete actions; what they mentally model is three logical operations (fill username, fill password, submit, then navigation happened).

**Readability is about the words. It is not about the data.** The step's `actionType`, `elementIdentity`, `value`, `executionJson`, and `linkedInteractionId` remain identical regardless of how the plain English is phrased. Readability optimization touches only the `plainEnglish` field — never the structural or execution data.

### 1.2 Why Should Readability Be Improved?

1. **Review efficiency.** Testers review every Test Case before approval. Noisy steps force them to mentally filter implementation details. Fewer, clearer steps mean faster review.

2. **Communication clarity.** Canonical Test Steps are shared with stakeholders — product managers, QA leads, developers — who may not understand that "Click Username Input Field" and "Enter 'Admin' into Username" are parts of one action. A step that says `Enter "Admin" into "Username"` communicates the intent immediately.

3. **Confidence in the tool.** When generated steps look robotic and over-detailed, users lose trust that the tool "understands" their workflow. Clean, concise steps signal that the tool captured meaningful interactions, not a stream of raw DOM events.

4. **Editability.** B1 §6.5 Q1 establishes that plain English is the user's editable layer. If the starting point is already clean, the user spends less time editing.

### 1.3 Why Must Readability Never Change Execution Semantics?

The frozen execution model (B4.1, B4.5, B5.1) establishes a strict separation of concerns:

| Layer | Purpose | Source of Truth For |
|---|---|---|
| `plainEnglish` | Human communication | Human review only |
| `elementIdentity` + `actionType` + `value` | Structural data | Canonical Step identity |
| `executionJson` | Machine execution | Code generation |
| Playwright output | Executable test | Automated test runs |

The `executionJson` field is **self-contained** (B4.5 §3.5): a code generator can produce working test code by reading only the Execution JSON — it never reads `plainEnglish`. B5.2 §VR-13 confirms: `plainEnglish` is NOT part of the Execution JSON contract. B1 §6.5 Q1 confirms: editing plain English does not trigger regeneration of Execution JSON or Playwright.

If a readability transformation changed the execution data — even subtly — it would create a divergence between what the human reads and what the machine executes. The human approves a step saying `Enter "Admin" into "Username"`, but if the execution JSON silently dropped the click event, the machine might attempt to `.fill()` an element that was never focused, producing a flaky or failing test.

**Therefore: readability optimization is constrained to the `plainEnglish` field. It may merge, simplify, or rephrase descriptions. It must never alter `elementIdentity`, `actionType`, `value`, `executionJson`, `linkedInteractionId`, `stepId`, or step count in the execution model.**

### 1.4 Why Is Readability Optimization Different from AI-Assisted Workflow Understanding?

These are fundamentally different capabilities with different risk profiles:

| Dimension | Deterministic Readability Optimization | AI-Assisted Workflow Understanding |
|---|---|---|
| **What it does** | Merges adjacent steps that are provably parts of one action | Infers business intent ("log in", "create user", "submit form") |
| **How it decides** | Structural pattern matching (click on input → followed by text entry into same input) | Semantic inference (LLM analysis of element names, page context, workflow patterns) |
| **Determinism** | Same input → same output, always | Same input → different output (non-deterministic) |
| **Reversibility** | Lossless — the original steps remain in the timeline and can be regenerated | Lossy — business summaries replace structural steps |
| **Risk** | Low — only words change; execution data preserved | High — may rename, reorder, or merge semantically distinct actions |
| **When it runs** | During Canonical Step generation (part of the pipeline) | Post-generation, as an optional enrichment layer |
| **Executions dependency** | None — `plainEnglish` is not read by Execution JSON or Playwright | None — but the temptation to use AI for locator/action decisions is dangerous |

The critical distinction: **readability optimization can be proven correct by structural inspection alone**. We can verify "this click was on the same element as the following text entry" by comparing `elementIdentity.elementId`. AI understanding cannot be proven — it guesses, and guesses are sometimes wrong.

B5.1 AP2 (purity) and AP5 (determinism) require that generation never calls AI. Readability optimization, being part of Canonical Step generation, inherits this constraint. AI enrichment of the plain English is a future capability that runs outside the pipeline and whose output is always user-reviewable (§6).

---

## 2. Architectural Position

### 2.1 Where Readability Optimization Belongs

The frozen pipeline is:

```
Interaction Timeline (raw recorded events)
        ↓
   [Canonical Step Generator]     ← readability optimization happens HERE
        ↓
Canonical Test Steps (plainEnglish + elementIdentity + executionJson=null)
        ↓
   [Execution JSON Generator]
        ↓
Canonical Test Steps (executionJson populated)
        ↓
   [Playwright Generator]
        ↓
Generated Playwright Test
```

Readability optimization is an **internal refinement of the Canonical Step Generator**. It is not a new pipeline stage. It is not a new artifact. It is not a post-generation pass. It sits inside the first generator, operating on the steps as they are created from timeline events.

### 2.2 What It May Modify

| Field | May Optimize? | Rationale |
|---|---|---|
| `plainEnglish` | ✅ Yes | This is the human-readable layer. B1 §6.5 Q1 confirms it does not affect execution. |
| `stepNumber` | ✅ Renumber | When steps merge, subsequent step numbers shift. This is cosmetic — stepNumber is display order, not identity. |
| `stepId` | ⚠️ Preserve original IDs on merged steps | A merged step retains the stepId of its **primary action** (the text entry, not the focus click). This preserves traceability. |

### 2.3 What It Must Never Modify

| Field | May Modify? | Rationale |
|---|---|---|
| `actionType` | ❌ Never | Defines the execution action. Changing "click" to "text" would break the Execution JSON. |
| `elementIdentity` | ❌ Never | Defines the target element for locator resolution. B4.3, B4.4. |
| `value` | ❌ Never | The entered text value. Used by Execution JSON for `fill` actions. |
| `executionJson` | ❌ Never | The machine-readable execution contract. B5.2. |
| `linkedInteractionId` | ❌ Never | Traceability link to the originating timeline event. |
| `aiEnrichment` | ❌ Never | AI understanding data projected from the interaction. |
| `aiConfidence` | ❌ Never | AI confidence score. |

### 2.4 The Merged Step Contract

When readability optimization merges N timeline-derived steps into one Canonical Step, the merged step follows these rules:

1. **Primary action**: The action that carries execution meaning. For a focus-click + text-entry pair, the text entry is the primary action (it carries the `value` and produces the `fill` in Execution JSON).
2. **Execution data**: The merged step's `actionType`, `elementIdentity`, `value`, and (eventually) `executionJson` come from the **primary action**. The secondary action (the focus click) contributes nothing to execution data.
3. **Plain English**: The merged step's description is generated from the primary action's data, incorporating context from the secondary action (e.g., the field name from the click target).
4. **Step ID**: The merged step carries the step ID of the primary action. The secondary action's step ID is retired.
5. **Traceability**: The merged step's `linkedInteractionId` points to the primary action's timeline event. The secondary action's event remains in the Interaction Timeline — it is not deleted from the timeline, only omitted from the step list.

### 2.5 What This Strategy Does NOT Introduce

- **No new artifact.** There is no "Optimized Steps" object separate from Canonical Test Steps.
- **No new generation stage.** The pipeline remains: Canonical Step Generator → Execution JSON Generator → Playwright Generator.
- **No second representation.** Canonical Test Steps remain the single human-readable source of truth. The optimized plain English IS the plain English — not a view on top of it.
- **No timeline modification.** The Interaction Timeline is read-only (B2 AP5). Optimization never deletes, reorders, or annotates timeline events.

---

## 3. Intent Preservation

### 3.1 The Core Principle

> **A readability transformation is safe if and only if it can be proven to preserve meaning by structural inspection alone — without business knowledge, without guessing, without AI.**

"Preserve meaning" means: a human reading the optimized step(s) would perform the same actions and arrive at the same outcome as a human reading the original steps.

### 3.2 Safe Optimization — Worked Example

**Original (6 steps):**

```
Step 1: Click "Username" input field
Step 2: Enter "Admin" into "Username"
Step 3: Click "Password" input field
Step 4: Enter "admin123" into "Password"
Step 5: Click "Login"
Step 6: Navigate to "https://example.com/dashboard"
```

**Optimized (4 steps):**

```
Step 1: Enter "Admin" into "Username"
Step 2: Enter "admin123" into "Password"
Step 3: Click "Login"
Step 4: Navigate to "https://example.com/dashboard"
```

**Why this is safe:**

| Original Steps | Optimization | Proof |
|---|---|---|
| Steps 1+2 | Merge: click on input → text entry into same input | `elementIdentity.elementId` matches between step 1's target and step 2's target. The click does nothing but focus the field. The text entry is the meaningful action. Removing the click from the step list does not change execution — the Execution JSON for the text entry uses a locator that works regardless of focus state (`.fill()` auto-focuses in Playwright). |
| Steps 3+4 | Same pattern | Same proof. |
| Step 5 | No change | A click on a button is a standalone meaningful action. |
| Step 6 | No change | Navigation is a standalone meaningful action. |

The human reads `Enter "Admin" into "Username"` and understands exactly what to do. The original `Click "Username" input field` step added no information — clicking a field to focus it before typing is how all humans interact with forms, and stating it explicitly adds noise.

### 3.3 Unsafe Optimization — Worked Example

**Original (2 steps):**

```
Step 5: Click "Login"
Step 6: Navigate to "https://example.com/dashboard"
```

**Do NOT rewrite as:**

```
Step 5: Log in successfully
```

**Why this is unsafe:**

1. **Requires business inference.** "Log in successfully" is a business-level summary. The tool cannot prove that the click on "Login" caused the navigation. The navigation might have been triggered by a redirect, a JavaScript timer, or a different action entirely. Conflating two structurally independent events into one business intent requires guessing.

2. **Destroys traceability.** Step 5 is a click event (`click-0003`). Step 6 is a navigation event (`nav-0001`). They have different `linkedInteractionId` values, different `actionType` values, different `elementIdentity` values. Merging them into one step loses the structural data for one of them.

3. **Changes execution semantics.** The click produces a `page.getByText('Login').click()` statement. The navigation produces a `page.goto('...')` statement. A merged step cannot produce both — one must be dropped, and dropping either changes the test's behavior.

4. **Not reversible.** Once merged into "Log in successfully", the original click and navigation events cannot be reconstructed from the step. The timeline still has them, but "Regenerate Steps" (B1 §6.5 Q3) resets plain English — it would regenerate the original separate steps, not the AI summary.

5. **Not deterministic.** An AI might summarize this as "Log in" today and "Authenticate" tomorrow. Deterministic optimization always produces the same output.

### 3.4 The Discriminating Question

For any proposed transformation, ask:

> **Can I prove this transformation is safe by comparing `elementIdentity`, `actionType`, and `value` fields alone — without reading the element's text content to infer business meaning?**

- If YES → the transformation is a **safe deterministic optimization**.
- If NO → the transformation requires **business understanding** and must be deferred to optional AI enrichment (§6).

---

## 4. Deterministic Optimization Rules

### 4.1 Characteristics of Safe Transformations

A transformation is safe if it satisfies ALL of these properties:

1. **Structurally provable.** The decision to transform is based on comparing `elementIdentity.elementId`, `actionType`, and `value` — not on reading text content to infer purpose.
2. **Execution-neutral.** The transformation does not change any field that feeds into Execution JSON or Playwright generation.
3. **Reversible via regeneration.** If the user clicks "Regenerate Steps", the original un-optimized steps are produced. The timeline is unchanged.
4. **Deterministic.** Same input timeline → same optimized output, always.
5. **Conservative.** When uncertain whether a transformation is safe, do not transform. Correctness over readability.

### 4.2 Rule OR-1: Focus-Click + Text-Entry Merge

**Pattern:** A click event on an input/textarea/select element is immediately followed by a text-entry event on the **same element** (matching `elementId`).

**Transformation:** Merge into a single step using the text entry's data. The click step is omitted from the step list.

**Plain English:** The merged step reads `Enter "[value]" into "[field name]"`. The focus click is not mentioned.

**Proof of safety:**
- The click's only purpose was to focus the input. In Playwright, `.fill()` auto-focuses the element. The generated test does not need a separate focus step.
- The `elementIdentity` of the merged step is the text entry's identity (same element, same identity).
- The `value` field carries the entered text.
- The Execution JSON for the merged step is a `fill` action — identical to what it would be without the merge.

**Validation condition (MUST hold):**
- `clickStep.elementIdentity.elementId === textStep.elementIdentity.elementId`
- `clickStep.actionType === 'click'`
- `textStep.actionType === 'text'`
- The text step immediately follows the click step in the timeline (no intervening events on different elements).

**When NOT to apply:**
- The click target and text target have different `elementId` values (user clicked one field, then typed in another — possible if focus moved via Tab).
- There are intervening events between the click and the text entry (e.g., the user clicked the field, then clicked something else, then came back — the click was not a simple focus).
- The click target is NOT an input/textarea/select element (e.g., clicking a div that happens to be editable — the click may have a purpose beyond focus).

### 4.3 Rule OR-2: Consecutive Text Entries into Different Fields

**Pattern:** Multiple text-entry events on different elements in sequence (e.g., filling username, then password, then email).

**Transformation:** Each text entry remains its own step. No merging.

**Rationale:** Each text entry targets a different field and carries a different value. They are independent actions. Merging them into "Fill form" would require business understanding and would lose field-level traceability.

### 4.4 Rule OR-3: Redundant Duplicate Clicks

**Pattern:** Two consecutive click events on the **same element** (same `elementId`), with no intervening events.

**Transformation:** Keep only one step. The duplicate click is omitted.

**Proof of safety:**
- A double-click on the same element produces one Playwright `.click()` call in the current implementation (each click is a separate event, but the Execution JSON for both would target the same locator with the same action — the second adds nothing).
- However: **this rule must be applied with extreme caution.** Some interactions genuinely require double-click (e.g., opening a file, selecting a word). If the element is one where double-click has semantic meaning, do not merge.

**When NOT to apply:**
- The element has `ondblclick` handlers or role="button" with known double-click behavior.
- The time between the two clicks is very short (indicating an intentional double-click, not two separate clicks).
- Implementation note: this rule should be conservative. When in doubt, keep both steps.

**Status:** This rule is **provisional**. It should be validated extensively in B7.2 before being included in the optimizer. If it cannot be applied consistently across all test scenarios, it must be dropped.

### 4.5 Transformations That Must NEVER Occur

| Transformation | Why Forbidden |
|---|---|
| Merge a click on a button/link with the subsequent navigation | The click and navigation are structurally independent events. The click may or may not have caused the navigation. Merging them requires business inference. |
| Summarize multiple steps into a business action ("Fill registration form") | Requires understanding the form's purpose. Not provable by structural inspection. |
| Reorder steps to group related actions | Changes execution order. B4.1 EP3: execution order is preserved from recording order. |
| Rename an element based on context ("Username" → "Email Address") | Requires understanding the page's purpose. The accessible name is what was recorded; changing it requires business knowledge. |
| Infer expected results ("Login should succeed") | Expected results are a separate concern (Product Foundation §3.6). They require business understanding. |
| Skip steps that seem unnecessary (e.g., a click that "does nothing") | The tool cannot prove a click did nothing. It may have triggered JavaScript, set state, or prepared the page for the next action. |
| Merge text entries across page boundaries | If a navigation event occurs between two text entries, they are on different pages and must remain separate. |

---

## 5. Guardrails

### 5.1 The Optimizer Must Never

1. **Infer business intent.** The optimizer does not know what the user is trying to accomplish. It sees element structures, not workflows.
2. **Rename workflows.** Step descriptions are derived from recorded data (accessible name, value, action type). The optimizer does not invent names.
3. **Summarize workflows.** "Fill form" or "Complete checkout" are business summaries. The optimizer produces structural descriptions only.
4. **Guess user goals.** The optimizer does not know if the user was testing login, registration, or data entry. It sees clicks and text entries.
5. **Change execution order.** Steps appear in recording order. B4.1 EP3. Reordering for readability would break execution.
6. **Merge unrelated actions.** Two clicks on different elements are two separate actions, even if they seem related.
7. **Modify execution semantics.** The `actionType`, `elementIdentity`, `value`, and `executionJson` fields are immutable by the optimizer.
8. **Delete timeline events.** The Interaction Timeline is read-only (B2 AP5). The optimizer only omits steps from the Canonical Step list — it never touches the timeline.

### 5.2 The Precautionary Principle

> **If a transformation cannot be proven to preserve meaning, it must not be applied.**

This is the overriding rule. The optimizer is conservative by design. It applies only transformations that are:
- **Structurally provable** (comparing element IDs, action types, and values).
- **Execution-neutral** (no change to any field consumed by downstream generators).
- **Deterministic** (same input → same output, always).

When the optimizer encounters an ambiguous case — where it cannot determine with certainty that a transformation is safe — it **does not transform**. The original steps are preserved.

### 5.3 Correctness Over Readability

Readability is a secondary concern. The primary purpose of Canonical Test Steps is to faithfully represent recorded interactions for human review and machine execution. If readability optimization introduces any risk of misrepresenting the recording, it is better to produce verbose but accurate steps.

**Decision hierarchy:**
1. Correctness (does the step accurately represent the recording?)
2. Traceability (can the step be traced back to the timeline event?)
3. Readability (is the step's description clear and concise?)

Readability is third. It is pursued only when correctness and traceability are guaranteed.

---

## 6. Relationship to Future AI

### 6.1 The Boundary

| Capability | Deterministic Optimization (This Strategy) | Future AI Enrichment |
|---|---|---|
| **What it touches** | `plainEnglish` field only, via structural rules | `plainEnglish` field, optionally enriched with business context |
| **Decision basis** | `elementIdentity.elementId`, `actionType`, `value` | Semantic analysis of element names, page context, workflow patterns |
| **Determinism** | Same input → same output, always | Same input → different output (LLM non-determinism) |
| **When it runs** | During Canonical Step generation (in the pipeline) | Post-generation, as an optional, user-triggered enrichment |
| **User control** | Automatic — applied during generation | Explicit — user opts in, reviews suggestions, accepts or rejects |
| **Pipeline dependency** | Part of the Canonical Step Generator | NEVER part of the pipeline. Runs as an independent service. |
| **Fallback** | If optimization fails, original steps are produced | If AI is unavailable, steps remain as generated |

### 6.2 Future AI Capabilities (Out of Scope for B7.x)

The following are explicitly **not part of this strategy** but are documented here to define the boundary:

1. **Business-readable descriptions:** AI may suggest renaming `Click "btn-submit"` to `Click "Submit Order"`. This is a suggestion, not an automatic transformation.
2. **Workflow summaries:** AI may propose a test case name like "User Login Flow" based on the recorded steps. This is metadata, not a step transformation.
3. **Expected result generation:** AI may suggest "After clicking Login, the user should see the Dashboard". This is an assertion proposal, not a readability change.
4. **Step grouping for display:** AI may suggest grouping steps into phases ("Setup", "Action", "Verification"). This is a presentation layer, not a data layer change.

### 6.3 The Execution Model Remains AI-Independent

B5.1 AP2 (generators are pure functions) and AP5 (deterministic generation) establish that the execution pipeline never calls AI. This strategy inherits that constraint:

- Readability optimization is part of the Canonical Step Generator.
- The Canonical Step Generator is a pure function (B2 AP3).
- Therefore, readability optimization must be deterministic and AI-free.
- AI enrichment is a separate, optional, post-pipeline capability.

**The execution model must never depend on AI.** If AI is unavailable, slow, or returns poor results, the pipeline still produces correct, readable steps. AI adds polish; it does not add correctness.

### 6.4 AI Suggestions Are Always Optional and User-Reviewable

Any future AI capability that touches plain English must:
1. Be explicitly triggered by the user (not automatic).
2. Present suggestions for review (not apply them silently).
3. Allow rejection (the user keeps the deterministic description).
4. Never modify execution data (only `plainEnglish`).
5. Never become a pipeline dependency.

---

## 7. Product Principles

### P1: Correctness Before Readability

Every transformation must preserve the step's structural accuracy. If there is any doubt, the step remains unoptimized. Verbose-but-correct always beats concise-but-wrong.

### P2: Never Infer Business Intent

The optimizer sees DOM elements, not business workflows. It does not know what the user was trying to accomplish. It optimizes wording, not meaning.

### P3: Preserve Execution Semantics

The `actionType`, `elementIdentity`, `value`, and `executionJson` fields are immutable by the optimizer. These fields define what the machine does. The optimizer only touches what the human reads.

### P4: Preserve Traceability

Every Canonical Step must be traceable to its originating timeline event via `linkedInteractionId`. When steps are merged, the primary action's `linkedInteractionId` is retained. The timeline events for secondary actions remain in the timeline — they are not deleted.

### P5: Preserve Deterministic Behavior

Same input timeline → same optimized steps, always. No randomness, no environmental variation, no AI inference. This is inherited from B5.1 AP5.

### P6: Preserve the Frozen Execution Architecture

The pipeline remains: Canonical Step Generator → Execution JSON Generator → Playwright Generator. No new stages, no new artifacts, no new data flows.

### P7: AI Is Optional and Additive

AI enrichment of plain English is a future capability that runs outside the pipeline. It is user-triggered, user-reviewed, and never required for correct operation.

### P8: The Execution Pipeline Remains AI-Independent

B5.1 AP2 and AP5 are preserved. The pipeline — including readability optimization — is deterministic and AI-free.

---

## 8. Consistency with the Frozen Execution Model

### 8.1 Source of Truth Hierarchy (Unchanged)

| Artifact | Role | Modified by This Strategy? |
|---|---|---|
| Interaction Timeline | Recording source of truth | ❌ No — timeline is read-only (B2 AP5) |
| Canonical Test Steps | Human-readable source of truth | ✅ `plainEnglish` field refined; structural fields unchanged |
| Execution JSON | Execution source of truth | ❌ No — derived from step structural data, not plain English |
| Playwright Test | Derived executable artifact | ❌ No — derived from Execution JSON, not plain English |

### 8.2 Pipeline Architecture (Unchanged)

```
Interaction Timeline
      ↓
[Canonical Step Generator]  ← readability optimization is internal to this generator
      ↓
Canonical Test Steps (plainEnglish optimized, executionJson = null)
      ↓
[Execution JSON Generator]
      ↓
Canonical Test Steps (executionJson populated)
      ↓
[Playwright Generator]
      ↓
Playwright Test
```

No new stage. No new artifact. No new data flow. Readability optimization is an implementation detail of the Canonical Step Generator.

### 8.3 Generator Registry (Unchanged)

The Generator Registry (B5.1 §3.6) still has three generators:
1. `canonical-step-generator` (dependencies: none)
2. `execution-json-generator` (dependencies: `['canonical-step-generator']`)
3. `playwright-generator` (dependencies: `['execution-json-generator']`)

Readability optimization does not register as a separate generator. It is internal to generator #1.

### 8.4 Field-Level Impact

| CanonicalStep Field | Before Optimization | After Optimization | Downstream Impact |
|---|---|---|---|
| `stepId` | e.g., "step-0001" | Primary action's stepId retained | None — stepId is not read by Execution JSON or Playwright |
| `stepNumber` | Sequential | Renumbered after merges | None — display order only |
| `actionType` | From event type | Unchanged | None |
| `plainEnglish` | From registry `toPlainEnglish()` | Refined by optimization rules | None — not read by Execution JSON or Playwright |
| `elementIdentity` | From event | Unchanged | None |
| `value` | From event | Unchanged | None |
| `executionJson` | Populated by JSON Generator | Populated from unchanged structural data | None — identical JSON |
| `linkedInteractionId` | From event | Primary action's ID retained | None |
| `aiEnrichment` | From event | Unchanged | None |
| `aiConfidence` | From event | Unchanged | None |

### 8.5 Execution Behavior (Unchanged)

For a focus-click + text-entry merge:

**Without optimization (current):**
```javascript
// Step 1: Click "Username" input field
await locator('[name="username"]').click();

// Step 2: Enter "Admin" into "Username"
await locator('[name="username"]').fill('Admin');
```

**With optimization:**
```javascript
// Step 1: Enter "Admin" into "Username"
await locator('[name="username"]').fill('Admin');
```

The `.fill()` call auto-focuses the element in Playwright. The `.click()` was redundant for execution. The generated test is functionally identical — the merge only removed an unnecessary focus step that Playwright doesn't need.

**Critical verification for B7.2:** This must be confirmed empirically. The `.fill()` auto-focus behavior must be validated across all supported element types and web frameworks. If any framework requires explicit focus before `.fill()`, Rule OR-1 must be restricted to exclude that framework or element type.

### 8.6 Regeneration Behavior (Unchanged)

B1 §6.5 Q3 defines "Regenerate Steps" as a reset — it re-derives steps from the raw timeline, discarding plain English edits. With readability optimization:

- **Regenerate Steps** re-runs the Canonical Step Generator, which includes the optimizer. The result is the same optimized steps (deterministic).
- **Edit plain English** on an optimized step: changes `plainEnglish` only. No regeneration triggered (B1 §6.5 Q1). The user's edit is preserved until the next "Regenerate Steps."
- **Delete a step**: triggers Execution JSON + Playwright regeneration (B1 §6.5 Q1). The optimizer is not re-invoked — it only runs during initial generation.

### 8.7 Conflicts with Previously Frozen Milestones

**No conflicts found.** This strategy is fully consistent with:

- Product Foundation: Canonical Test Steps remain the single editable surface. Plain English remains the human layer.
- Product Architecture: Pipeline order unchanged. No new artifacts.
- B1: Q1 (plain English edits don't trigger regeneration) preserved. Q3 (regeneration is a reset) preserved. Q4 (v1.0 replaces) preserved.
- B2: AP3 (pure functions) preserved — optimizer is deterministic. AP5 (timeline is read-only) preserved.
- B3: Canonical Step Generator contract unchanged — optimization is internal.
- B4.1: EP3 (execution order preserved) respected. EP5 (star topology) respected.
- B4.5: Execution JSON self-containment preserved — plain English is not part of Execution JSON.
- B5.1: AP2 (generators are pure functions) preserved. AP5 (deterministic) preserved.
- B5.2: Execution JSON contract unchanged — no new fields, no modified fields.
- B6: Playwright Generator unchanged — it reads Execution JSON, not plain English.

---

## 9. Assumptions

### 9.1 Assumptions About Playwright Behavior

| # | Assumption | Risk | Mitigation for B7.2 |
|---|---|---|---|
| A1 | Playwright `.fill()` auto-focuses the target element, making a preceding `.click()` unnecessary for input/textarea elements | Medium — some custom components may intercept focus | Validate across React, Angular, Vue, plain HTML, and OrangeHRM (Vue). If `.fill()` fails without preceding focus on any framework, Rule OR-1 must be restricted. |
| A2 | Playwright `.fill()` works on `<select>` elements | Low — standard Playwright behavior | Validate in B7.2 CRUD tests. |
| A3 | Playwright `.fill()` works on `contenteditable` elements | Medium — Playwright uses `.fill()` for inputs but may require `.type()` for contenteditable | Validate in B7.2. If `.fill()` doesn't work, Rule OR-1 must exclude contenteditable elements. |

### 9.2 Assumptions About Recording Behavior

| # | Assumption | Risk | Mitigation |
|---|---|---|---|
| A4 | The content script captures `elementIdentity.elementId` consistently between click and text-entry events on the same element | Low — `elementId` is derived from DOM position, which is stable within a page session | Validate in B7.2 by recording on multiple sites and verifying `elementId` match rate. |
| A5 | Focus clicks and text entries are always adjacent in the timeline (no intervening events) | Medium — the user might click a field, move focus elsewhere, then return | Rule OR-1 explicitly checks for adjacency. If events are non-adjacent, no merge. |
| A6 | Navigation events are never produced by the same DOM event as a click | Low — navigation is captured via `webNavigation.onCommitted`, clicks via event listeners. They are structurally independent. | No mitigation needed — they are different event types. |

### 9.3 Assumptions About Optimization Scope

| # | Assumption | Risk | Mitigation |
|---|---|---|---|
| A7 | The only safe merge pattern is focus-click + text-entry (Rule OR-1) | Low — if other patterns are discovered, they require their own rules with proofs | B7.2 validates across diverse workflows. New patterns are added as new rules, not by extending existing rules loosely. |
| A8 | Rule OR-3 (duplicate clicks) is rarely needed and difficult to validate | High — double-click semantics vary widely across applications | Rule OR-3 is **provisional**. It should only be included in the optimizer if B7.2 validation proves it is safe across all scenarios. Otherwise, it is dropped. |

---

## 10. Consistency Check Against Frozen Milestones

### 10.1 Product Foundation Design

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| Canonical Test Steps have plain English, action type, locator strategy | Optimizer modifies only plain English | ✅ |
| Plain English is editable during review | Optimizer produces clean starting point; user can still edit | ✅ |
| Editing plain English does not trigger regeneration | Optimizer only runs during initial generation, not on edits | ✅ |
| Execution JSON is derived from Steps | Optimizer does not change structural fields that feed Execution JSON | ✅ |
| Playwright is derived from Execution JSON | Optimizer does not touch Execution JSON | ✅ |

### 10.2 Product Architecture Design

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| Canonical Test Steps are the single editable surface | Optimizer refines the starting point; the surface remains the same | ✅ |
| Pipeline: Timeline → Steps → JSON → Playwright | No new stage added | ✅ |
| Steps are the human-readable source of truth | Optimizer improves readability of the source of truth | ✅ |
| User edits plain English → nothing regenerates | Optimizer runs during generation, not during editing | ✅ |

### 10.3 B1 (Artifact Generation Design)

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| Q1: Plain English edits don't trigger regeneration | Optimizer is a generation-time transformation, not an edit-time one | ✅ |
| Q3: "Regenerate Steps" resets to machine derivation from timeline | Optimizer runs as part of that derivation — same result every time (deterministic) | ✅ |
| Q4: v1.0 replaces, no version history | Optimized steps are v1.0 — no separate "original" version retained | ✅ |
| Three artifacts in strict order | No new artifact introduced | ✅ |

### 10.4 B2 (Artifact Generation Architecture)

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| AP1: Single responsibility per generator | Optimization is internal to Canonical Step Generator — its responsibility is still "transform timeline into steps" | ✅ |
| AP3: Generators are pure functions | Optimizer is deterministic — same input → same output | ✅ |
| AP5: Timeline is read-only input | Optimizer never modifies the timeline | ✅ |

### 10.5 B3 (Canonical Step Generator)

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| One step per interaction | Optimizer may produce fewer steps via merging — but this is an internal refinement, not a contract change | ✅ (clarified below) |
| Step uses registry's `toPlainEnglish()` | Optimizer may override `toPlainEnglish()` output for merged steps — but the registry is still the source of the base description | ✅ |

**Clarification on "one step per interaction":** B3's contract states the generator transforms each timeline event into a step. Rule OR-1 merges two events into one step. This does not violate B3 — B3 defines the generator's responsibility (transform events into steps), not the cardinality (one event must produce exactly one step). The optimizer is an internal refinement that produces the most readable faithful representation. The contract (`GeneratorContract`) is unchanged: input is the timeline, output is `CanonicalStep[]`. The optimizer changes how many steps are in the array, not the contract.

### 10.6 B4.1–B4.5 (Execution Model)

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| EP3: Execution order preserved from recording | Optimizer does not reorder steps; merged steps retain their relative position | ✅ |
| EP5: Star topology (Steps at center) | Optimizer does not change the star — Steps still feed JSON and Playwright | ✅ |
| B4.5 §3.5: Execution JSON is self-contained | Plain English is explicitly excluded from Execution JSON (B5.2 §VR) — optimizer touches only plain English | ✅ |
| B4.5 EJ-P2: Deterministic derivation | Optimizer is deterministic — it does not introduce non-determinism | ✅ |

### 10.7 B5.1–B5.2 (Execution JSON Architecture & Contract)

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| AP2: Generators are pure functions | Optimizer is part of the Canonical Step Generator, which is a pure function | ✅ |
| AP5: Deterministic generation | Optimizer is deterministic | ✅ |
| B5.2 §VR-13: Plain English NOT in Execution JSON | Optimizer touches only plain English — Execution JSON is unaffected | ✅ |
| Execution JSON reads structural fields from Steps | Optimizer does not change structural fields | ✅ |

### 10.8 B6 (Playwright Generator)

| Frozen Decision | This Strategy | Consistent? |
|---|---|---|
| Playwright reads Execution JSON only | Execution JSON is unchanged by the optimizer | ✅ |
| Playwright never reads plain English | Optimizer changes only plain English — invisible to Playwright | ✅ |
| Traceability comments reference step numbers | Step numbers may shift due to merges — but this is cosmetic, not a contract violation | ✅ (traceability via `linkedInteractionId` is preserved) |

---

## 11. Implementation Readiness for B7.2

### 11.1 Validation Scenarios

This strategy defines rules that must be validated against diverse real web application workflows. B7.2 must test each rule against ALL of the following scenario categories:

| # | Scenario | Rules to Validate | Key Risk |
|---|---|---|---|
| 1 | **Authentication** (login, logout, registration) | OR-1 (focus-click + text-entry merge) | Does `.fill()` work without preceding `.click()` on all login forms? |
| 2 | **Search** (search box focus, type, submit) | OR-1, OR-3 (duplicate clicks on search button) | Does the merge produce a readable "Search for X" step? |
| 3 | **CRUD operations** (create, read, update, delete) | OR-1 (form fills), OR-2 (multiple fields) | Are all form fields captured as individual steps? |
| 4 | **Form entry** (multi-field forms with validation) | OR-1, OR-2 | Does the optimizer handle forms with inline validation correctly? |
| 5 | **Multi-step workflows** (checkout, wizard) | OR-1, OR-2, navigation steps | Are steps on different pages kept separate? |
| 6 | **Navigation** (menus, breadcrumbs, tabs) | No optimization for navigation-click merges | Are navigation clicks preserved? |
| 7 | **Tables and filters** (sort, filter, pagination) | OR-1 (filter input fields), click preservation | Are filter clicks preserved? |
| 8 | **Modal dialogs** (open, fill, close) | OR-1 (form fields inside modals) | Does the optimizer handle dynamically appearing elements? |
| 9 | **Wizard-style workflows** (steppers, multi-step forms) | OR-1 across wizard steps, navigation preservation | Are steps across wizard pages kept separate? |

### 11.2 Validation Criteria for Each Rule

A rule passes B7.2 validation if and only if:

1. **Consistent application:** The rule produces the same optimization decision for the same structural pattern across all test scenarios.
2. **Execution safety:** The generated Playwright test (from the optimized steps) passes when executed against the real web application.
3. **No false merges:** The rule never merges steps that should remain separate in any scenario.
4. **No false preservations:** The rule consistently merges steps that should be merged (no inconsistency).
5. **Human readability:** The optimized steps are rated as clearer than the original by a human reviewer.

### 11.3 Rule Disqualification

Any rule that cannot satisfy ALL five criteria above across ALL nine scenario categories must be **dropped from the optimizer**. It is better to have fewer optimization rules that work reliably than many rules that occasionally break.

Rule OR-3 (duplicate clicks) is explicitly **provisional**. If B7.2 cannot validate it consistently, it is dropped.

### 11.4 Implementation Placement

The optimizer logic belongs inside `src/generation/generators/canonical-step-generator.ts`, as a post-processing pass on the generated step array before returning. Concretely:

```typescript
// Pseudocode (NOT implementation — for B7.2 reference only)
function generate(input: CanonicalStepGeneratorInput): GeneratorResult<...> {
  const steps = transformTimelineToSteps(input.timeline);
  const optimized = applyReadabilityRules(steps);  // ← optimizer goes here
  return { status: 'success', output: optimized, errors: [] };
}
```

The optimizer is a pure function: `CanonicalStep[] → CanonicalStep[]`. It receives the initial steps and returns the optimized steps. It does not access the timeline, storage, or AI.

### 11.5 What B7.2 Must Deliver

| Deliverable | Description |
|---|---|
| Optimizer implementation | `applyReadabilityRules()` function inside canonical-step-generator.ts |
| Unit tests | Tests for each rule (OR-1, OR-2, OR-3 if validated) with structural proof of safety |
| Integration tests | End-to-end pipeline tests: timeline → optimized steps → execution JSON → Playwright |
| Validation report | Results of testing each rule against all 9 scenario categories |
| Updated Canonical Step Generator | Integration of optimizer into the generation pipeline |
| Full regression | All existing tests (439+) must continue to pass |

---

## Freeze Declaration

This document is **FROZEN** as of 2026-07-15. It defines the Canonical Test Step Readability Strategy and is the authoritative product design for Milestone B7.1.

**Implementation is deferred to B7.2.** No code changes are made in this milestone.

All frozen milestones (Product Foundation, Product Architecture, B1–B6) remain unchanged. This strategy is consistent with every frozen decision. No conflicts were discovered.

---

*End of Milestone B7.1 — Canonical Test Step Readability Strategy*
