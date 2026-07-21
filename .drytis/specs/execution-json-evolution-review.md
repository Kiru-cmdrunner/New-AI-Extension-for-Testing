# Architecture Review — Execution JSON Evolution: Execution Plan Investigation

**Status:** Architecture review — no implementation
**Date:** 2026-07-16
**Scope:** Long-term evolution of the CmdRunner Execution JSON
**Constraint:** Preserve deterministic execution, Product Foundation, B4.2/B5.2 frozen contracts

---

## Table of Contents

1. [Current Architecture Assessment](#1-current-architecture-assessment)
2. [The Architectural Question](#2-the-architectural-question)
3. [Option A — Static Execution JSON](#3-option-a--static-execution-json)
4. [Option B — AI-Enriched Execution JSON](#4-option-b--ai-enriched-execution-json)
5. [Option C — Execution Plan](#5-option-c--execution-plan)
6. [Option D — Layered Execution Plan (Recommended)](#6-option-d--layered-execution-plan-recommended)
7. [Comparative Analysis](#7-comparative-analysis)
8. [Recommended Architecture](#8-recommended-architecture)
9. [Execution JSON Evolution](#9-execution-json-evolution)
10. [AI Relationship](#10-ai-relationship)
11. [Multi-Engine Support](#11-multi-engine-support)
12. [Migration Strategy](#12-migration-strategy)
13. [Risk Assessment](#13-risk-assessment)
14. [Consistency Review](#14-consistency-review)

---

## 1. Current Architecture Assessment

### What the Execution JSON is today

The frozen B5.2 contract defines **six sections** that describe one Canonical
Test Step as a machine-executable artifact:

| Section | Purpose | Content |
|---------|---------|---------|
| `action` | What to do | type (verb), value (payload) |
| `target` | What to interact with | kind, tag, role, name, url |
| `locators` | How to find it | 0-3 entries: strategy + value + role |
| `context` | Environmental factors | iframe, shadowDom, frame |
| `trace` | Source links | interactionId, stepId |
| `meta` | Operational data | status, warnings, generatedAt |

### What it describes

The current JSON answers: **"What action should the machine perform on what
element, using what locator, in what context?"**

It does NOT answer:
- "What should happen AFTER this action?" (validation/postcondition)
- "What should we do if this fails?" (recovery strategy)
- "How long should we wait for async effects?" (synchronization)
- "What is the user's higher-level intent?" (workflow context)
- "Is this step part of a logical group?" (workflow grouping)

### Architectural positioning

The Execution JSON sits between the **Canonical Test Step** (human-readable)
and the **Playwright Generator** (code-producing). It is the single source
of truth for "what the machine should do." B4.5 §1.3 defines it as "the
persistent representation of the Execution Object."

### The frozen constraint

B5.2 §8.1: "Extension by addition — new sections may be added; existing
sections/fields are not removed, renamed, or restructured."

This means the Execution JSON CAN grow — but only additively. The 6 frozen
sections are immutable. Any evolution must be in new sections that coexist
with the existing ones.

---

## 2. The Architectural Question

**Should the Execution JSON evolve from a static execution artifact into a
complete Execution Plan?**

This is not simply "add more fields." It is a question of **architectural
identity**: is the Execution JSON a static description of one action, or is
it a plan that governs the entire lifecycle of executing that action?

### The distinction

| Static Artifact (Current) | Execution Plan (Proposed Option C) |
|---|---|
| Describes what to do | Describes what to do + how to behave while doing it |
| No awareness of failure | Contains recovery strategy |
| No awareness of timing | Contains synchronization strategy |
| No awareness of outcome | Contains validation expectations |
| Per-step isolation | Aware of workflow context |
| One representation, one consumer (Playwright) | One representation, multiple consumers |

### The deeper question

If the Execution JSON becomes an Execution Plan, it becomes the **contract
between intent and execution** — not just the input to a code generator.

This has profound implications:
- Multiple execution engines (Playwright, Selenium, Cypress, Appium) would
  consume the same plan
- The plan could be executed by a runtime that interprets it, not just code-
  generated from it
- AI could refine the plan (not just enrich it) based on execution history

---

## 3. Option A — Static Execution JSON

### Description
The Execution JSON stays exactly as the frozen B5.2 6-section contract. All
execution behavior (waits, retries, recovery) is the responsibility of the
Playwright code that the generator produces.

### Architecture
```
Timeline → Steps → ExecJSON (6 sections) → Playwright (handles all behavior)
```

### Evaluation

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| Maintainability | ⚠️ | Every resilience improvement requires Playwright code changes |
| Enterprise scalability | ❌ | No multi-engine support; no recovery; brittle locators |
| Deterministic execution | ✅ | Fully deterministic |
| Resilience | ❌ | No fallback execution; no recovery |
| UI evolution | ❌ | Primary-locator-only breaks on DOM change |
| Flaky test reduction | ❌ | No smart waits; relies on Playwright defaults |
| Framework independence | ❌ | Playwright-specific behavior baked into generator |
| Future engines | ❌ | Would need separate generators per engine |
| Product simplicity | ✅ | Simplest architecture |
| AI compatibility | ❌ | No place for AI to contribute |

### Verdict
Insufficient for long-term enterprise resilience. This is the current state
and the reason for this review.

---

## 4. Option B — AI-Enriched Execution JSON (Previous Recommendation)

### Description
Add two optional sections (`resilience`, `workflowContext`) to the Execution
JSON via an AI enrichment layer between the execution-json-generator and the
playwright-generator. The Playwright generator consumes these when present.

### Architecture
```
Timeline → Steps → ExecJSON (6 sections)
  → AI Enrichment Layer
  → Enhanced ExecJSON (6 + 2 optional sections)
  → Deterministic Playwright Generator
```

### Evaluation

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| Maintainability | ✅ | Resilience data lives in JSON, not hardcoded in Playwright |
| Enterprise scalability | ✅ | AI-ranked locators, wait hints, recovery data |
| Deterministic execution | ✅ | Same enriched JSON → same Playwright code |
| Resilience | ✅ | Executable fallback chains; wait hints |
| UI evolution | ✅ | Multiple locator strategies; recovery hints |
| Flaky test reduction | ✅ | Smart waits from recording evidence |
| Framework independence | ⚠️ | Better — action verbs are abstract — but resilience section is still consumed only by Playwright generator |
| Future engines | ⚠️ | New engine = new generator that reads the same JSON — possible but untested |
| Product simplicity | ✅ | Two optional sections; clean separation |
| AI compatibility | ✅ | AI enrichment layer is the integration point |

### Limitations

1. **Resilience data is advisory, not prescriptive.** The Playwright generator
   *may* consume `resilience.locatorChain` to emit fallback code, but the JSON
   doesn't *prescribe* execution behavior. If a Cypress generator is written
   later, it would need its own interpretation of the resilience section.

2. **No validation contract.** `workflowContext.expectedResult` is freeform
   text. It's not structured enough for an execution engine to automatically
   validate.

3. **No execution lifecycle.** The JSON describes what to do but not what
   constitutes success or failure of that action beyond "did the Playwright
   method throw."

4. **Enrichment is bolted on.** The resilience/context sections feel like
   add-ons to a static artifact rather than integral parts of an execution
   strategy.

### Verdict
Strong improvement over Option A. The previous review correctly identified
this as the best near-term architecture. However, for long-term multi-engine
support and execution lifecycle management, it has structural gaps.

---

## 5. Option C — Execution Plan

### Description
The Execution JSON becomes a complete Execution Plan that prescribes not
just what action to perform, but how execution should behave: synchronization,
recovery, validation, retry, self-healing, and expected outcomes.

### Architecture
```
Timeline → Steps → Execution Plan (comprehensive)
  → Playwright Executor (deterministic code generation from plan)
  → Future: Selenium Executor, Cypress Executor (same plan, different output)
```

### What the Execution Plan would contain

```
ExecutionPlan {
  // ── Frozen B5.2 Sections (unchanged) ──
  action, target, locators, context, trace, meta

  // ── Execution Strategy ──
  strategy: {
    locatorResolution: LocatorStrategy    // ordered fallback chain
    synchronization: SyncStrategy         // wait conditions
    retry: RetryPolicy                     // max attempts, backoff
    recovery: RecoveryPolicy              // self-healing rules
  }

  // ── Validation ──
  validation: {
    precondition: Condition[]             // what must be true before
    postcondition: Condition[]            // what must be true after
    expectedResult: string                // semantic expected outcome
  }

  // ── Workflow Context ──
  workflow: {
    intent: string                        // "Submit login form"
    stepGroup: string                     // "login-flow"
    sequencePosition: number              // step 3 of 7
    dependentOn: string[]                 // stepIds this depends on
  }
}
```

### Evaluation

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| Maintainability | ✅ | Execution behavior lives in the plan, not in generated code |
| Enterprise scalability | ✅ | Complete execution lifecycle defined |
| Deterministic execution | ✅ | Plan is deterministic; executors are deterministic |
| Resilience | ✅ | Full recovery strategy in plan |
| UI evolution | ✅ | Self-healing, ranked locators, semantic fallbacks |
| Flaky test reduction | ✅ | Structured synchronization, retry policies |
| Framework independence | ✅ | Plan is engine-agnostic; any executor can consume it |
| Future engines | ✅ | New engine = new executor for same plan |
| Product simplicity | ❌ | Significant complexity increase |
| AI compatibility | ✅ | AI can enrich all strategy sections |

### Weaknesses

1. **Complexity explosion.** The plan would add 15-20 new fields across 3 new
   sections. Each field needs validation, testing, documentation. The contract
   surface area triples.

2. **Premature commitment.** Defining `RetryPolicy`, `RecoveryPolicy`, and
   `SyncStrategy` as structured types locks in specific execution semantics
   before we have execution-runtime experience. These abstractions may not
   survive contact with real-world execution.

3. **Validation gap.** Structured `Condition[]` types for preconditions and
   postconditions require their own expression language — a mini-DSL for
   asserting DOM state. This is a significant design surface.

4. **Specification without implementation evidence.** The plan describes
   execution behavior that no current executor implements. Writing the plan
   before building the executor risks designing abstractions that don't match
   real constraints.

5. **Migration risk.** Moving from 6 sections to 9+ sections is a large
   contract evolution, even if additive.

### Verdict
Architecturally elegant and the strongest long-term vision. But the full
Execution Plan as specified here is **too much, too soon.** The abstractions
haven't been validated by execution experience. Risk of over-engineering.

---

## 6. Option D — Layered Execution Plan (Recommended)

### Description
Evolve the Execution JSON into an Execution Plan **incrementally**, adding
one layer at a time. Each layer is independently useful, independently
testable, and independently consumable. The frozen 6 sections are the
mandatory core. New layers are optional and build on each other.

### Key insight
Options B and C are not mutually exclusive. Option B is the **first layer**
of Option C. The recommendation is to adopt Option B's structure NOW, but
design it with Option C's multi-engine identity, so future layers can be
added without restructuring.

### Architecture

```
┌────────────────────────────────────────────────────────┐
│                  EXECUTION PLAN (evolved)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LAYER 0: CORE (Frozen B5.2 — 6 sections)         │   │
│  │  action, target, locators, context, trace, meta    │   │
│  │  MANDATORY. Every executor must consume these.     │   │
│  │  DETERMINISTIC. Same Timeline → same core.         │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LAYER 1: RESILIENCE (AI-enriched, optional)      │   │
│  │  locatorChain, waitStrategy, recoveryHints         │   │
│  │  Populated by AI Enrichment Layer.                 │   │
│  │  Consumed by generators when present.              │   │
│  │  Absence = current behavior (graceful degradation).│   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LAYER 2: VALIDATION (future, optional)           │   │
│  │  precondition, postcondition, expectedResult       │   │
│  │  Enables automatic assertion generation.           │   │
│  │  Requires execution experience to design properly. │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LAYER 3: WORKFLOW CONTEXT (future, optional)     │   │
│  │  intent, stepGroup, sequencePosition, dependentOn │   │
│  │  Enables cross-step optimization and grouping.     │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  LAYER 4: EXECUTION STRATEGY (future, optional)   │   │
│  │  retryPolicy, recoveryPolicy, customSync           │   │
│  │  Enables runtime self-healing and adaptive exec.   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
├────────────────────────────────────────────────────────┤
│                   EXECUTORS                              │
│                                                          │
│  Playwright Generator    ← consumes Layer 0 + 1          │
│  Cypress Generator       ← consumes Layer 0 (+ 1 later)  │
│  Selenium Generator      ← consumes Layer 0 (+ 1 later)  │
│  CmdRunner Runtime       ← consumes Layer 0 + 1 + 4      │
│  (future)                                                   │
└────────────────────────────────────────────────────────┘
```

### Why layered is better than monolithic

| Aspect | Monolithic Plan (Option C) | Layered Plan (Option D) |
|--------|---------------------------|------------------------|
| Migration | Large contract change at once | One layer at a time |
| Validation | Must design all abstractions upfront | Each layer validated before next |
| Consumer complexity | All consumers see all data | Consumers read only layers they support |
| Risk concentration | One big bet | Distributed across layers |
| Reversibility | Hard to remove committed sections | Each layer can be revised independently |

### How layers relate

Each layer is a **versioned, optional addition** to the core Execution JSON.
A consumer (generator, executor) declares which layers it supports:

```
Playwright Generator v6.2: consumes Layer 0 + Layer 1
Playwright Generator v6.5: consumes Layer 0 + Layer 1 + Layer 2
Cypress Generator v1.0:    consumes Layer 0 only
CmdRunner Runtime v1.0:    consumes Layer 0 + Layer 1 + Layer 4
```

---

## 7. Comparative Analysis

### Scoring matrix (1-5 scale, 5 = best)

| Criterion | A: Static | B: AI-Enriched | C: Full Plan | D: Layered Plan |
|-----------|-----------|----------------|--------------|-----------------|
| Maintainability | 2 | 4 | 4 | 4 |
| Enterprise scalability | 1 | 3 | 5 | 4 |
| Deterministic execution | 5 | 5 | 5 | 5 |
| Resilience | 1 | 4 | 5 | 4 |
| UI evolution | 1 | 4 | 5 | 4 |
| Flaky test reduction | 1 | 3 | 5 | 4 |
| Framework independence | 1 | 3 | 5 | 5 |
| Future engines | 1 | 3 | 5 | 5 |
| Product simplicity | 5 | 4 | 2 | 3 |
| AI compatibility | 1 | 4 | 5 | 5 |
| **Migration safety** | **5** | **4** | **2** | **5** |
| **Total** | **24** | **44** | **51** | **52** |

### Why Option D edges out Option C

Option C scores slightly higher on enterprise scalability and resilience
because it commits to the full execution lifecycle upfront. But Option D
scores significantly higher on **migration safety** (5 vs 2) and **product
simplicity** (3 vs 2) — the two criteria most likely to cause project failure
if mishandled.

Option D reaches the same destination as Option C but arrives there
incrementally, with each step validated by real execution experience.

---

## 8. Recommended Architecture

### Recommendation: Option D — Layered Execution Plan

The CmdRunner Execution JSON should evolve into a Layered Execution Plan
where:

1. **Layer 0 (the frozen 6 sections) is always present and always deterministic.**
   This is the contract every executor must support.

2. **Layer 1 (resilience) is the first evolution.** It is AI-enriched,
   optional, and immediately actionable (executable fallback chains, wait
   hints).

3. **Future layers (validation, workflow context, execution strategy) are
   added one at a time**, each validated by real execution experience before
   the next is designed.

4. **Multiple executors consume the plan at different depths.** The Playwright
   generator is the first consumer of Layer 1. Future engines start at Layer 0
   and add layer support incrementally.

### Architectural identity

The Execution JSON's identity evolves:

```
Today:     "What action to perform on what element"
Layer 1:   "What action to perform + how to stay resilient while doing it"
Future:    "Complete execution lifecycle: what, how, what-if, verify"
```

But this evolution is **never breaking**. Layer 0 is immutable. Every new
layer is additive and optional.

---

## 9. Execution JSON Evolution

### Type evolution (additive, backward-compatible)

```typescript
// ── LAYER 0: Frozen Core (B5.2 — NEVER MODIFIED) ──

interface ExecutionJsonObject {
  action: ExecutionAction;
  target: ExecutionTarget;
  locators: ExecutionLocator[];
  context: ExecutionContext;
  trace: ExecutionTrace;
  meta: ExecutionMeta;
}

// ── LAYER 1: Resilience (first addition) ──

interface ExecutionResilience {
  /** Ranked locator chain for executable fallbacks */
  locatorChain?: RankedLocator[];
  /** Wait strategy derived from recording-time evidence */
  waitStrategy?: WaitHint;
  /** Recovery hints for AI-assisted self-healing */
  recoveryHints?: RecoveryHints;
}

// ── LAYER 2: Validation (future) ──

interface ExecutionValidation {
  precondition?: AssertionSpec[];
  postcondition?: AssertionSpec[];
  expectedResult?: string;
}

// ── LAYER 3: Workflow Context (future) ──

interface ExecutionWorkflow {
  intent?: string;
  stepGroup?: string;
  sequencePosition?: { current: number; total: number };
  dependentOn?: string[];
}

// ── LAYER 4: Execution Strategy (future) ──

interface ExecutionStrategy {
  retryPolicy?: { maxAttempts: number; backoffMs: number };
  recoveryPolicy?: { selfHeal: boolean; fallbackToIntent: boolean };
}
```

### Layered object

```typescript
// The complete Execution Plan (future state)
interface ExecutionPlan extends ExecutionJsonObject {
  // Layer 1 (optional)
  resilience?: ExecutionResilience;
  // Layer 2 (future)
  validation?: ExecutionValidation;
  // Layer 3 (future)
  workflow?: ExecutionWorkflow;
  // Layer 4 (future)
  strategy?: ExecutionStrategy;
}
```

### Key design rule: Layer independence

Each layer MUST be independently consumable. A consumer that understands
only Layer 0 must produce valid execution from the core sections alone.
A consumer that understands Layer 1 may use resilience data to improve
execution. No layer depends on another optional layer being present.

Exception: Layer 4 (execution strategy) may reference Layer 1 (resilience)
data when present, because recovery naturally uses the locator chain.

---

## 10. AI Relationship

### Where AI operates in the layered model

```
Timeline → Steps → ExecJSON (Layer 0, deterministic)
  ↓
  ↓ AI Enrichment Layer (optional)
  ↓   Populates: resilience (Layer 1)
  ↓   Future: validation (Layer 2), workflow (Layer 3)
  ↓
Enhanced ExecJSON (Layer 0 + Layer 1)
  ↓
Deterministic Playwright Generator (reads Layer 0 + Layer 1)
  ↓
Playwright code
```

### What AI provides at each layer

| Layer | AI Contribution | Determinism Impact |
|-------|----------------|-------------------|
| Layer 0 | None — fully deterministic | No AI dependency |
| Layer 1 | Ranked locators, wait hints, recovery descriptions | AI-enriched but generator treats absence gracefully |
| Layer 2 | Inferred postconditions, expected results | AI-generated but validated before use |
| Layer 3 | Intent classification, step grouping | AI-suggested but structurally deterministic |
| Layer 4 | Adaptive retry/recovery policies based on execution history | Runtime AI — future |

### The determinism contract

**Layer 0 is always deterministic.** Given the same Timeline, the same Layer 0
JSON is produced, every time, regardless of AI availability.

**Layers 1+ are AI-enriched but execution is deterministic given the enriched
data.** Given the same enriched JSON, the same Playwright code is produced.
AI may produce different enrichment on different runs (different confidence
scores, different locator rankings), but the Playwright generator's translation
is deterministic.

This preserves B5.1 AP5 (deterministic generation) while allowing AI to
improve resilience.

---

## 11. Multi-Engine Support

### How the layered plan supports multiple engines

Each engine's generator/executor declares its layer support:

| Engine | Layer 0 | Layer 1 | Layer 2 | Layer 3 | Layer 4 |
|--------|---------|---------|---------|---------|---------|
| Playwright (current) | ✅ | ✅ (v6.2) | Future | Future | N/A |
| Cypress (future) | ✅ | Future | Future | N/A | N/A |
| Selenium (future) | ✅ | Future | Future | N/A | N/A |
| Appium (future) | ✅ | N/A | N/A | N/A | N/A |
| CmdRunner Runtime (future) | ✅ | ✅ | ✅ | ✅ | ✅ |

### Why this works

1. **Layer 0 is the universal contract.** Every engine can execute it. It
   contains action, target, locators, context — sufficient for basic
   automation on any framework.

2. **Higher layers are progressive enhancement.** An engine that supports
   Layer 1 produces more resilient code. One that doesn't still produces
   functional code from Layer 0.

3. **No engine is forced to understand all layers.** Appium (mobile) may
   never need workflow context. Cypress may not need runtime self-healing.
   Each engine consumes what it supports.

4. **New engines start simple.** A Selenium generator starts with Layer 0
   only. As it matures, it adds Layer 1 support. No redesign needed.

### Example: Same plan, two engines

```json
{
  "action": { "type": "click", "value": null },
  "target": { "kind": "element", "tag": "BUTTON", "role": "button", "name": "Submit" },
  "locators": [
    { "strategy": "testId", "value": "submit-btn", "role": "primary" },
    { "strategy": "ariaLabel", "value": "Submit", "role": "secondary" }
  ],
  "context": { "iframe": false, "shadowDom": false, "frame": null },
  "trace": { "interactionId": "click-0001", "stepId": "step-0001" },
  "meta": { "status": "generated", "warnings": [], "generatedAt": "2026-07-16T..." },
  "resilience": {
    "locatorChain": [
      { "strategy": "testId", "value": "submit-btn", "confidence": 0.95 },
      { "strategy": "ariaLabel", "value": "Submit", "confidence": 0.85 }
    ],
    "waitStrategy": { "type": "none", "reason": "static element" },
    "recoveryHints": { "semanticDescription": "Submit button on login form" }
  }
}
```

**Playwright output (Layer 0 + 1):**
```typescript
await CmdRunner.resolve([
  () => page.getByTestId('submit-btn'),
  () => page.getByLabel('Submit'),
]).click();
```

**Cypress output (Layer 0 only):**
```typescript
cy.get('[data-testid="submit-btn"]').click();
```

**Selenium output (Layer 0 only):**
```python
driver.find_element(By.CSS_SELECTOR, '[data-testid="submit-btn"]').click()
```

Same plan, three engines, different resilience levels. Each engine
deterministically translates the plan into its own API.

---

## 12. Migration Strategy

### Phase E0: Executable fallback chains (no AI, no new sections)

**Scope:** Modify the Playwright generator to emit executable try-catch
fallback chains using the EXISTING `locators[]` array (which already has
primary + secondary + fallback).

**Why first:** This is a pure generator enhancement. No contract changes.
No AI needed. Immediately reduces locator brittleness. Uses data that already
exists.

**Risk:** Low. Only `playwright-generator.ts` changes.

### Phase E1: Layer 1 — Resilience section (additive)

**Scope:** Add `ExecutionResilience` as an optional property on
`ExecutionJsonObject`. Build the AI Enrichment Layer as a new generation
stage. Feature-flagged.

**Why second:** Builds on E0's fallback concept but adds AI-ranked locators,
wait hints, and recovery data. The enrichment is additive and optional.

**Risk:** Low-Medium. New section type, new generator stage, feature flag.

### Phase E2: Layer 1 Playwright consumption

**Scope:** Update the Playwright generator to consume `resilience.locatorChain`
for ranked fallbacks, `resilience.waitStrategy` for smart waits, and
`resilience.recoveryHints` for descriptive comments.

**Risk:** Medium. Wait strategy must be conservative — wrong waits slow tests.

### Phase E3-E5: Future layers (validation, workflow, strategy)

**Scope:** Add one layer at a time, validated by execution experience.

**Risk:** Each layer is evaluated independently before implementation.

### What does NOT change during migration

- The 6 frozen B5.2 sections (never modified)
- The existing generation pipeline (stages 1-3)
- The interaction type registry
- The Canonical Step format
- The locator resolution engine (B4.4)
- All frozen C-series product decisions
- The recording pipeline (Phase 2 architecture)

---

## 13. Risk Assessment

### R1: Over-engineering future layers
Adding layers 2-4 before execution experience validates the abstractions.
*Mitigation:* Only implement Layer 1 now. Layers 2-4 are architecture vision,
not committed contracts. Each requires a separate architecture review.

### R2: Layer coupling creep
Future layers may develop implicit dependencies on each other, breaking the
"independently consumable" principle.
*Mitigation:* Each layer's consumer documentation must state exactly which
other layers (if any) it references. Layer 0 is always standalone.

### R3: AI enrichment quality
The AI enrichment layer's output quality determines the resilience layer's
value. Poor AI hints are worse than no hints.
*Mitigation:* Layer 1 data is optional. The generator validates hint quality
(e.g., locatorChain entries must be non-empty, valid strategies) before use.
Invalid hints are silently dropped.

### R4: Multi-engine abstraction leakage
Engine-specific concepts (e.g., Playwright's auto-waiting) may leak into the
plan layers, breaking engine independence.
*Mitigation:* Layer 0 action verbs are already abstract. Layer 1 wait
strategies use engine-neutral types (`elementVisible`, `textAppears`) that
each engine interprets in its own idiom.

### R5: Contract growth fatigue
Each new layer increases the type surface area and documentation burden.
*Mitigation:* Layers are versioned and optional. Documentation is per-layer.
New consumers only learn the layers they support.

---

## 14. Consistency Review

### Against B4.2 (Execution Model Information Categories)

| Decision | Consistent? |
|----------|-------------|
| 6 information categories → 6 JSON sections | ✅ Layer 0 unchanged |
| Extensibility by addition | ✅ New layers are additive |

### Against B4.4 (Locator Priority Strategy)

| Decision | Consistent? |
|----------|-------------|
| 5-category priority hierarchy | ✅ Layer 1 re-ranks within hierarchy |
| Max 3 locators | ✅ Layer 0 unchanged; Layer 1 may add more ranked entries |
| Disqualifiers (auto-gen IDs, CSS-in-JS) | ✅ Still applied in Layer 0 |

### Against B4.5 (Execution Object)

| Decision | Consistent? |
|----------|-------------|
| Persistent representation of execution intent | ✅ Enhanced — now persists resilience data too |
| Not a test script | ✅ Still a JSON plan, not executable code |

### Against B5.1 (Execution JSON Generator)

| Decision | Consistent? |
|----------|-------------|
| Pure function (deterministic) | ✅ Layer 0 generation unchanged; AI layer is separate optional stage |
| Per-step error isolation | ✅ Unchanged |
| Does not generate Playwright | ✅ Still true — AI enrichment is pre-Playwright |

### Against B5.2 (Execution JSON Contract)

| Decision | Consistent? |
|----------|-------------|
| 6 sections, one per category | ✅ Layer 0 has exactly 6 sections |
| §8.1: Extension by addition | ✅ New layers are additive sections |
| Fields not removed/renamed/restructured | ✅ Zero modifications to existing fields |

### Against B5.3 (Validation Rules)

| Decision | Consistent? |
|----------|-------------|
| VR-1 through VR-13 | ✅ All validation rules apply to Layer 0 |
| Validation runs after generation | ✅ Unchanged |

### Against B6 (Playwright Generator)

| Decision | Consistent? |
|----------|-------------|
| Deterministic output | ✅ Same enriched JSON → same code |
| translateLocator / translateAction | ✅ Extended, not replaced |
| Primary locator → code; others → comments | ⚠️ E0 makes fallbacks executable — this is an enhancement, not a violation |

### Against C3-C6 (Interaction Types)

All preserved. The layered plan is interaction-type agnostic. Every interaction
type produces a Layer 0 JSON today and will produce Layer 1 data when AI
enrichment is enabled.

### Overall consistency verdict

**ALL FROZEN DECISIONS PRESERVED.** The layered plan is a purely additive
evolution. Layer 0 is the frozen B5.2 contract, unchanged. Higher layers are
optional additions that preserve every frozen constraint while enabling
progressive resilience enhancement and multi-engine support.

---

## Summary

### The question

Should the Execution JSON evolve from a static artifact into an Execution Plan?

### The answer

**Yes — but incrementally, not all at once.**

The recommended architecture is **Option D: Layered Execution Plan**, where:

1. **Layer 0** is the frozen B5.2 contract — immutable, deterministic, universal.
2. **Layer 1** (resilience) is the first addition — AI-enriched locator chains,
   wait hints, recovery data.
3. **Layers 2-4** (validation, workflow, execution strategy) are future additions,
   each requiring its own architecture review and validated by execution experience.

### Why layered over monolithic

The full Execution Plan (Option C) is architecturally superior in theory but
introduces too much complexity and premature abstraction in practice. The
layered approach reaches the same destination with:
- Lower migration risk (one layer at a time)
- Better validation (each layer tested in production before next)
- Cleaner multi-engine support (engines declare layer support)
- Preserved simplicity (consumers only see layers they support)

### The architectural identity evolution

```
Today:     Static execution artifact (what to do)
Layer 1:   Resilient execution artifact (what to do + how to survive)
Future:    Execution Plan (what to do + how to behave + what to verify)
```

This evolution is additive, reversible at each step, and preserves every
frozen product decision.
