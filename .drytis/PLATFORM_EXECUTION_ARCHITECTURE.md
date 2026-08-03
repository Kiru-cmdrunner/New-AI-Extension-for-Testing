# CmdRecorder — Platform Architecture: Execution & Semantic Foundation

> **STATUS:** The execution platform vision (P3-P6) is valid and not yet implemented. References to `SemanticInteraction` should be read as `ComponentInteraction` (the type was renamed/superseded). R4 element identity matching and the P2CapabilityContract frozen boundary design have since been specified and implemented (see R4, P1, P2 specs).
>
> **For the complete current state including what's implemented vs deferred, read MASTER-HANDOVER.md at project root.**

---

## Table of Contents

1. [Current Execution Architecture](#1-current-execution-architecture)
2. [The Core Insight: Two Layers, Not One](#2-the-core-insight-two-layers-not-one)
3. [How SemanticInteraction Serves Execution](#3-how-semanticinteraction-serves-execution)
4. [Runtime Validation & Assertions](#4-runtime-validation--assertions)
5. [Self-Healing](#5-self-healing)
6. [Retry Strategies & Failure Analysis](#6-retry-strategies--failure-analysis)
7. [AI-Assisted Execution](#7-ai-assisted-execution)
8. [Revised Platform Architecture](#8-revised-platform-architecture)
9. [Impact on Architecture Freeze](#9-impact-on-architecture-freeze)

---

## 1. Current Execution Architecture

### How Execution Works Today

The execution engine follows a clean principle: **IR is the sole execution contract.**

```
RecordingSession (persisted)
  ├── rawEvents: SessionEvent[]
  ├── rawInteractions: DetectedInteraction[]
  └── understandingResult: UnderstandingResult
          │
          ▼
    IR Bridge (build)
          │
          ▼
  ExecutionIRPlan (self-contained, disposable)
          │
          ▼
    IRExecutorImpl.execute()
          │
          ├── Creates browser tab → baseUrl
          ├── Injects executor content script
          ├── For each IRStep:
          │     ├── RESOLVE_LOCATOR → find element on page
          │     ├── If not found → attemptRuntimeHealing() → retry
          │     ├── EXECUTE_STEP → click/fill/select/etc.
          │     └── EVALUATE_ASSERTIONS → check post-conditions
          ├── Computes overall status
          └── Returns IRExecutionResult
          │
          ▼
  ExecutionRun (persisted, append-only)
```

**The executor never sees SemanticInteraction[].** It receives only `ExecutionIRPlan` — a fully resolved, self-contained plan with locators, actions, inputs, assertions, and execution parameters. This is by design (principle P3 in the IR types file: "Adapters never receive the ATC, Element Repository, or Environment Profile").

### What the IR Contains for Execution

| IR Field | Execution Use |
|----------|--------------|
| `step.action` | Determines what to do (click, fill, select, etc.) |
| `step.target.resolvedLocators` | How to find the element (testId → role → css → xpath) |
| `step.input` | What value to enter/select |
| `step.assertions[]` | What to verify after the action |
| `step.executionParameters` | Wait strategy, timeout, retry config |
| `step.description` | Human-readable label for results |
| `step.sourceEventId` | Back-link to recording event (for debugging) |
| `plan.environment.baseUrl` | Where to open the browser |

### What Execution Currently Lacks

| Gap | Impact |
|-----|--------|
| `retryCount` not implemented | Transient failures cause immediate test failure |
| `waitStrategy` not wired | Content script does single-attempt locator resolution, no polling |
| Screenshots not captured on failure | No visual debugging of failures |
| Assertion locators empty in IR Bridge path | Most element-based assertions silently fail |
| `healedElementIds` always empty | Self-healing happens but isn't tracked in results |
| No iframe support | Can't interact with elements inside iframes |
| No data-driven testing | `IRInput` is always a literal |

These are execution-engine implementation gaps, not architecture gaps. The IR contract already defines the fields for retry, wait, and screenshots — they're just not implemented.

---

## 2. The Core Insight: Two Layers, Not One

### The Problem with IR-Only Execution

The current architecture treats the IR as the ONLY artifact connecting recording to execution. This works for mechanical execution (click this, fill that). But it breaks down for **intelligent execution**:

| Scenario | What the Executor Needs | What the IR Provides | Gap |
|----------|----------------------|---------------------|-----|
| A click fails — should we retry? | What kind of click was it? Was it part of a form submit? | `action: 'click'`, `input: null` | No semantic context — retry strategy is blind |
| A locator breaks — heal it | What element is this? What's its behavioral context? | `elementId`, `resolvedLocators` | No semantic identity — healing relies on accessible name hint only |
| An assertion fails — analyze why | What was the user trying to accomplish? | `type: 'equality'`, `expectedValue: 'hello'` | No intent — failure analysis is mechanical |
| AI wants to suggest a fix | What workflow is this step part of? What patterns are common? | `description: "Fill 'john' in Username"` | No workflow context — AI has to infer intent from the description string |
| A step is slow — optimize | Is this a known slow component? | `executionParameters.timeoutMs: 30000` | No component type — can't apply component-specific timing |

The IR is **mechanically complete** but **semantically impoverished**. It tells you WHAT to do but not WHY or IN WHAT CONTEXT.

### The Solution: SemanticInteraction as the Persistent Semantic Layer

The proposed architecture positions SemanticInteraction as a transient pipeline output. I now believe this is **wrong for the platform vision**. SemanticInteraction should be a **PERSISTENT artifact** that both the recorder and the execution engine can reference.

```
RECORDER SIDE                          EXECUTION SIDE
─────────────                          ──────────────

CapturedEvent[]                        
      │                                
      ▼                                
Interaction Engine                     
      │                                
      ▼                                
SemanticInteraction[]  ◄──────────────►  Semantic Context
      │                                    (read at execution time)
      ▼                                    
IR Generation                          IR Execution
      │                                      │
      ▼                                      ▼
ExecutionIRPlan  ──────────────────►  Executor
                                      (uses IR for mechanics,
                                       SemanticInteraction[] for intelligence)
```

**The IR remains the execution contract** (mechanical: what to click, what to fill). **SemanticInteraction[] becomes the semantic context** (intelligent: why, in what workflow, what type of component, what confidence).

This is not adding a layer — it's making an existing layer persistent and accessible.

---

## 3. How SemanticInteraction Serves Execution

### Per-Step Semantic Enrichment

Each IRStep already carries a `sourceEventId` back-link to the recording. In the proposed architecture, this becomes a link to the corresponding SemanticInteraction:

```typescript
interface IRStep {
  // ... existing fields ...
  sourceEventId?: string;           // already exists
  semanticInteractionId?: string;   // NEW: link to SemanticInteraction
}
```

At execution time, the executor (or an AI execution assistant) can look up the SemanticInteraction for any step:

```typescript
const semantic = semanticMap.get(step.semanticInteractionId);
// Now the executor knows:
// - semantic.type: 'Select' (this is a dropdown selection)
// - semantic.variant: 'custom' (custom dropdown, not native)
// - semantic.componentType: 'dropdown' (produced by dropdown lifecycle)
// - semantic.confidence: 0.85 (moderately confident)
// - semantic.target.context.ariaExpanded: true (was expanded when recorded)
// - semantic.semanticAction: undefined (not a login/form submit)
// - semantic.beforeState.value: '' (was empty before)
// - semantic.afterState.value: 'Belgian' (selected Belgian)
// - semantic.behavioralSignature.surroundingText: ['Nationality', 'Country']
```

### Execution Decisions Enhanced by Semantic Context

| Execution Decision | Without Semantic Context | With Semantic Context |
|--------------------|------------------------|----------------------|
| **Retry strategy** | Retry everything once | Don't retry Navigate steps. Retry custom dropdown clicks (they're flaky). Retry text fills with typing delay. |
| **Wait strategy** | `waitStrategy: 'visible'` for all | Use `'stable'` for autocomplete (suggestions load async). Use `'present'` for date pickers (calendar animation). Use `'visible'` for everything else. |
| **Timeout** | 30s for all | 5s for Click (should be instant). 10s for Select (dropdown animation). 30s for Navigate (page load). |
| **Healing** | Search by accessible name | Search by component type + surrounding text + behavioral signature. Know it's a dropdown, so look for combobox/listbox patterns. |
| **Failure analysis** | "Element not found" | "Custom dropdown 'Nationality' not found. Element was a div with role=combobox, last seen on /pim/my-info. Surrounding text: 'Employee, Full Name'. Confidence: 0.85." |
| **AI fix suggestion** | "Try a different locator" | "This is a nationality dropdown. It uses OXD classes. The trigger is likely `.oxd-select-text`. Try: `locator('.oxd-select-text')`." |

---

## 4. Runtime Validation & Assertions

### Current State

Assertions in the IR are generated from two sources:
1. **InteractionContract constraints** (from domain pipeline enrichment) — but these have empty locators in the IR Bridge path, causing silent failures
2. **Before/after state** — not currently used for assertion generation

### How SemanticInteraction Improves Assertions

SemanticInteraction carries `beforeState` and `afterState` — the exact state transitions observed during recording. These are the most reliable source of assertions:

```typescript
// From a SemanticInteraction:
{
  type: 'Fill',
  label: "Enter 'john' in Username",
  beforeState: { value: '' },
  afterState: { value: 'john' },
  target: { identity: { accessibleName: 'Username', ariaRole: 'textbox' } }
}

// Generated assertion:
{
  type: 'equality',
  target: { kind: 'element', locators: [...] },
  property: 'value',
  expectedValue: 'john',
  severity: 'soft',           // soft because this is a pre-condition, not the test's purpose
  description: "Username field should contain 'john'"
}
```

For a dropdown selection:

```typescript
// From a SemanticInteraction:
{
  type: 'Select',
  variant: 'custom',
  label: "Select Belgian for Nationality",
  beforeState: { value: null },
  afterState: { value: 'Belgian', selected: true },
  target: { identity: { accessibleName: 'Nationality', ariaRole: 'combobox' } }
}

// Generated assertion:
{
  type: 'equality',
  target: { kind: 'element', locators: [...] },
  property: 'text',
  expectedValue: 'Belgian',
  severity: 'hard',
  description: "Nationality dropdown should show 'Belgian'"
}
```

### Assertions IR Bridge Can Generate from SemanticInteraction

| Interaction Type | Before State | After State | Generated Assertion |
|-----------------|-------------|-------------|-------------------|
| Fill | `value: ''` | `value: 'john'` | Field should contain 'john' (soft) |
| Select | `value: null` | `value: 'Belgian'` | Dropdown should show 'Belgian' (hard) |
| Toggle | `checked: false` | `checked: true` | Checkbox should be checked (hard) |
| Navigate | `url: '/login'` | `url: '/dashboard'` | URL should be '/dashboard' (hard) |
| DateSelect | `value: null` | `value: '2023-10-21'` | Date field should show '2023-10-21' (hard) |
| Surface | (no state) | (modal appeared) | Modal should be visible (hard) |

**Severity logic:** Hard assertions for committed state changes (select, toggle, navigate, date). Soft assertions for intermediate states (text entry that will be submitted later).

### What This Fixes

The current IR Bridge path generates assertions with **empty locators** (a known bug). With SemanticInteraction as the source, assertions get locators directly from `target.identity` — the same locators used for the action itself. No empty locators.

---

## 5. Self-Healing

### Current Healing Architecture

Healing operates on the Repository `Element` entity:

```
Locator resolution fails during execution
    │
    ├── Extract DOM context from live page (EXTRACT_DOM_CONTEXT)
    │     └── Searches by accessible name hint
    │
    ├── Rank fresh locators from extracted identity
    │     └── Uses locator-ranking.ts (same 5-category system)
    │
    ├── healElement(elementId, newStrategies, context)
    │     ├── Adds new strategies at priority 1, 2, 3...
    │     ├── Retains old strategies for types not covered
    │     ├── Replaces old strategies for types with new values
    │     ├── Appends to healHistory (append-only audit trail)
    │     └── Bumps updatedAt → triggers IR staleness
    │
    └── OverrideMap.set(elementId, healedLocators)
          └── Subsequent steps use healed locators
```

### How SemanticInteraction Enhances Healing

The current healing system searches for broken elements by **accessible name hint only**. This is fragile — if the accessible name changed (e.g., "Username" → "Employee Username"), healing fails.

With SemanticInteraction context, the healer knows:

```typescript
// What the element WAS when recorded:
semantic.target.identity.accessibleName     // "Nationality"
semantic.target.identity.ariaRole           // "combobox"
semantic.target.identity.className          // "oxd-select-text oxd-select..."
semantic.target.identity.tag                // "DIV"
semantic.target.context.ancestorRoles       // ["DIV[role=group]", "DIV[role=form]"]
semantic.behavioralSignature.surroundingText // ["Employee", "Nationality", "Other ID"]
semantic.behavioralSignature.nearbyLandmarks // ["Personal Details", "Employee Information"]
semantic.componentType                       // "dropdown"
```

**Enhanced healing search strategy:**

1. Try accessible name (current approach) — fast but fragile
2. Try role + nearby text — `div[role="combobox"]` near text "Nationality"
3. Try class pattern — `.oxd-select-text` (framework adapter knows OXD patterns)
4. Try ancestor structure — element inside `[role="form"]` with nearby landmark "Personal Details"
5. Try behavioral signature — element with similar surrounding text

Each fallback uses information from SemanticInteraction that is **not in the IR**. The IR only has `resolvedLocators` (the original locators that broke). SemanticInteraction has the rich identity that enables multi-strategy healing.

### Record-Time Healing Enhancement

The current record-time healing (`healFromRecording()`) matches elements from new recordings against stored Repository Elements. With SemanticInteraction:

- Match by `elementId` (synthetic key from identity fields) → exact match
- Match by `accessibleName + role + pageUrl` → fuzzy match
- Match by `behavioralSignature.surroundingText` → structural match
- Match by `componentType + pageUrl + nearbyLandmarks` → positional match

This is significantly more robust than the current element matching service.

---

## 6. Retry Strategies & Failure Analysis

### Type-Aware Retry Strategies

With SemanticInteraction context, retry strategies can be type-aware:

| Interaction Type | Retry Strategy | Rationale |
|-----------------|---------------|-----------|
| Click | Retry once after 1s | Clicks are usually instant; if they fail, the element may not be loaded yet |
| Fill | Retry once after 500ms | React/Vue value setters can race with framework rendering |
| Select (custom) | Retry twice with 2s delay | Custom dropdowns have animation delays; options may not be immediately clickable |
| Select (native) | Retry once after 500ms | Native dropdowns are fast but change events can be racy |
| Select (autocomplete) | Retry 3× with 1s delay | Autocomplete suggestions load asynchronously; typing + selection is flaky |
| DateSelect | Retry once after 1s | Calendar animations + date debounce can cause timing issues |
| Navigate | No retry | Navigation either works or it's a server error; retrying wastes time |
| Toggle | Retry once after 500ms | State change can race with framework re-rendering |
| Hover | No retry | Hover either triggers or it doesn't; retrying won't help |

These strategies are **derived from SemanticInteraction.type and .variant** — information the IR doesn't carry.

### Failure Analysis with Semantic Context

When a step fails, the execution result should include enough context for diagnosis:

```typescript
interface RichStepFailure {
  // Mechanical (from IR)
  stepId: string;
  action: string;
  attemptedLocators: ResolvedLocator[];
  error: string;
  
  // Semantic (from SemanticInteraction)
  interactionType: string;           // "Select"
  variant: string;                   // "custom"
  componentType: string;             // "dropdown"
  label: string;                     // "Select Belgian for Nationality"
  confidence: number;                // 0.85
  targetIdentity: ElementIdentity;   // full identity for healing
  behavioralSignature?: BehavioralSignature;
  pageUrl: string;
  pageTitle: string;
  
  // Contextual
  previousStepLabel?: string;        // what happened before this
  nextStepLabel?: string;            // what was supposed to happen after
  workflowContext?: string;          // "Employee Information form"
}
```

This gives failure analysis tools (and AI assistants) everything they need to understand WHY a step failed and suggest fixes.

---

## 7. AI-Assisted Execution

### Vision: AI Reads the Semantic Layer

The most powerful future capability is an AI execution assistant that reads SemanticInteraction[] alongside the IR and makes intelligent decisions:

```
SemanticInteraction[]  +  ExecutionIRPlan  +  Live DOM State
         │                      │                    │
         └──────────┬───────────┘────────────────────┘
                    │
                    ▼
          AI Execution Assistant
                    │
                    ├── Pre-execution: "This test logs in, fills a form, 
                    │   and submits. Watch for the form validation errors
                    │   on the Nationality field — it's a custom dropdown
                    │   that's known to be flaky."
                    │
                    ├── During execution: "Step 3 failed. The Nationality
                    │   dropdown isn't found. Based on the recording, this
                    │   is an OXD combobox. Let me search for .oxd-select-text
                    │   near 'Nationality' text."
                    │
                    ├── Post-failure: "The assertion failed because the
                    │   dropdown shows 'Belgian' but the expected value
                    │   was 'Belgium'. This is a data mismatch, not a
                    │   locator issue. The test data should use 'Belgian'
                    │   to match the dropdown's option text."
                    │
                    └── Optimization: "Steps 5-8 are all inside the same
                        form panel. I can optimize by filling all fields
                        before submitting, rather than waiting after each."
```

### What the AI Needs from SemanticInteraction

| AI Capability | Fields Needed | Available? |
|---------------|---------------|-----------|
| Understand workflow | `type`, `semanticAction`, `label`, `order` | ✅ |
| Identify component type | `componentType`, `variant` | ✅ |
| Suggest healing strategy | `target.identity`, `behavioralSignature` | ✅ (behavioral signature is optional/future) |
| Classify failure | `type`, `confidence`, `componentType`, `target.context` | ✅ |
| Suggest test data | `value`, `afterState`, `target.identity.inputType` | ✅ |
| Recognize patterns | full `SemanticInteraction[]` sequence | ✅ |
| Reason about timing | `durationMs`, `componentType` | ✅ |

### The Key Point

An AI assistant can't reason over the IR alone — the IR is mechanical. It needs the semantic layer to understand intent. This is why SemanticInteraction must be **persistent and accessible at execution time**, not just a transient pipeline output.

---

## 8. Revised Platform Architecture

### The Three-Layer Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SEMANTIC LAYER (Persistent)                       │
│                                                                     │
│  SemanticInteraction[]                                              │
│    The "what the user accomplished" record.                         │
│    Stored permanently in RecordingSession.                          │
│    Accessible by both recorder and executor.                        │
│    Rich enough for AI reasoning.                                    │
│                                                                     │
│  Element Catalog (derived view)                                     │
│    Unique elements encountered, with full identity + locators.      │
│    Backs the Repository Element entity for healing.                 │
│                                                                     │
│  Capability Analysis (derived view)                                 │
│    "This recording demonstrates User Login."                        │
│    Pattern inference over the interaction sequence.                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│   GENERATION (Recorder)      │  │   EXECUTION (Executor)       │
│                              │  │                              │
│  SemanticInteraction[]       │  │  ExecutionIRPlan             │
│       + Element Catalog      │  │       + SemanticInteraction[] │
│       → IR Generation        │  │       (semantic context)      │
│                              │  │                              │
│  Output: ExecutionIRPlan     │  │  → IR Executor (mechanics)    │
│         + Generated Code     │  │  → Healing (uses semantic     │
│                              │  │     identity for multi-       │
│                              │  │     strategy search)          │
│                              │  │  → AI Assistant (uses         │
│                              │  │     semantic layer for        │
│                              │  │     intelligent decisions)    │
│                              │  │  → Failure Analysis (uses     │
│                              │  │     semantic context for      │
│                              │  │     diagnosis)                │
│                              │  │                              │
│  Output: ExecutionResult     │  │  Output: RichExecutionResult  │
│         + Generated Code     │  │         + FailureAnalysis     │
└──────────────────────────────┘  └──────────────────────────────┘
```

### What Changed from the Proposed Architecture

| Aspect | Previous Proposal | Revised |
|--------|------------------|---------|
| SemanticInteraction lifetime | Transient pipeline output | **Persistent artifact in RecordingSession** |
| Who accesses SemanticInteraction | Only the IR bridge | **IR bridge AND executor AND AI assistant** |
| Repository stores | rawEvents, rawInteractions, understandingResult | **SemanticInteraction[]** (replaces rawInteractions + understandingResult) |
| IR-to-Semantic link | `sourceEventId` (one direction) | **Bidirectional: IRStep.semanticInteractionId ↔ SemanticInteraction.id** |
| Execution context | IR only | **IR for mechanics + SemanticInteraction[] for intelligence** |

### How This Affects the Frozen Contracts

#### SemanticInteraction: Add Execution-Relevant Fields

```typescript
interface SemanticInteraction {
  // ... all fields from the frozen schema ...
  
  // ─── EXECUTION CONTEXT (populated at generation time) ─────────
  irStepId?: string;               // link to the generated IR step
  executionHints?: ExecutionHints; // type-aware execution guidance
}

interface ExecutionHints {
  retryStrategy?: 'none' | 'once' | 'twice' | 'thrice';
  retryDelayMs?: number;
  waitStrategy?: 'immediate' | 'visible' | 'stable' | 'present';
  timeoutMs?: number;
  knownFlaky?: boolean;            // flagged from execution history
  componentSpecificTiming?: boolean;
}
```

These hints are **derived from type + variant + componentType** — not manually authored. They enrich the IR's `ExecutionParameters` with type-aware defaults.

#### IRStep: Add Semantic Back-Link

```typescript
interface IRStep {
  // ... all fields from the frozen schema ...
  semanticInteractionId?: string;  // link to SemanticInteraction for AI/healing
}
```

#### RecordingSession: Store SemanticInteraction[]

```typescript
interface RecordingSession {
  id: string;
  projectId: string;
  url: string;
  recordedAt: string;
  duration: number;
  
  // REPLACES rawInteractions + understandingResult
  semanticInteractions: SemanticInteraction[];
  
  // Kept for provenance/debugging
  rawEvents?: CapturedEvent[];
  
  testCaseIds: string[];
}
```

#### RichExecutionResult: Add Semantic Context

```typescript
interface RichStepResult {
  stepId: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  durationMs: number;
  
  // Semantic context for failure analysis
  semanticInteractionId?: string;
  interactionType?: string;
  componentType?: string;
  label?: string;
  
  assertionResults: AssertionResult[];
  healedLocators?: ResolvedLocator[];
  screenshot?: string;
  error?: StepError;
}

interface StepError {
  message: string;
  type: 'element_not_found' | 'assertion_failed' | 'action_error' | 'timeout';
  attemptedLocators?: ResolvedLocator[];
  semanticContext?: {
    expectedType: string;
    expectedLabel: string;
    targetIdentity: ElementIdentity;
    behavioralSignature?: BehavioralSignature;
  };
}
```

---

## 9. Impact on Architecture Freeze

### Contract Revisions Required

The Architecture Freeze contracts (from the previous document) need these additions:

| Contract | Change | Rationale |
|----------|--------|-----------|
| SemanticInteraction schema | Add `irStepId`, `executionHints` fields | Links to IR and carries type-aware execution guidance |
| IRStep schema | Add `semanticInteractionId` field | Bidirectional link for execution-time semantic lookup |
| RecordingSession | Store `SemanticInteraction[]` (not rawInteractions + understandingResult) | Persistent semantic layer for both recorder and executor |
| ExecutionResult | Enrich with `semanticInteractionId`, `interactionType`, `componentType` | Failure analysis and AI assistance |
| Success criteria | Add: "SemanticInteraction[] is persisted and accessible at execution time" | Platform requirement |

### What Does NOT Change

| Aspect | Status |
|--------|--------|
| 3-stage pipeline (Capture → Engine → IR+Code) | ✅ Unchanged |
| 19 interaction types | ✅ Unchanged |
| Lifecycle definition format | ✅ Unchanged |
| Evidence provider interface | ✅ Unchanged |
| IR as execution contract (mechanical) | ✅ Unchanged — executor still receives ExecutionIRPlan |
| Locator ranking system | ✅ Unchanged |
| Migration phases (0-8) | ✅ Unchanged in order and risk |
| Guard rails, filter layer | ✅ Unchanged |

### Revised Design Principle

> **The recorder architecture is NOT a standalone subsystem. It is the semantic foundation shared by both the recorder and the execution engine.**
>
> SemanticInteraction[] is the persistent, shared semantic layer. The IR is the disposable mechanical contract derived from it. The executor uses the IR for mechanics and SemanticInteraction[] for intelligence.

---

## Summary

### Is the Recorder Architecture a Platform Architecture?

**With the revisions in this document, yes.** The key changes:

1. **SemanticInteraction[] becomes persistent** — stored in RecordingSession, accessible at execution time. Not just a transient pipeline output.

2. **IR carries a semantic back-link** — `semanticInteractionId` on each IRStep lets the executor look up rich semantic context for any step.

3. **Execution hints derived from semantics** — type-aware retry strategies, wait strategies, and timeouts come from `interactionType + variant + componentType`.

4. **Self-healing uses full semantic identity** — not just accessible name, but role, class patterns, behavioral signatures, and component type.

5. **Failure analysis includes semantic context** — "Nationality dropdown failed" not just "element not found."

6. **AI assistant has a rich semantic layer to reason over** — workflow understanding, component types, intent categories, behavioral signatures.

### What This Costs

Almost nothing. The SemanticInteraction model is already richer than what the IR Bridge currently uses. The changes are:

- Store SemanticInteraction[] in RecordingSession (instead of rawInteractions + understandingResult)
- Add 2 optional fields to IRStep (`semanticInteractionId`, `executionHints`)
- Add 2 optional fields to SemanticInteraction (`irStepId`, `executionHints`)
- Enrich ExecutionResult with semantic context

No new pipeline stages. No new intermediate models. No architectural layers. Just making an existing model persistent and bidirectionally linked.

### If the Execution Engine Evolves

If the execution engine adds capabilities (parallel execution, visual regression, network mocking, etc.), the architecture still holds:

- **Parallel execution:** SemanticInteraction[] helps the AI identify independent step groups
- **Visual regression:** Behavioral signatures capture visual context at recording time
- **Network mocking:** SemanticAction categories identify where to inject mocks
- **Cross-domain (mobile/API):** SemanticInteraction is domain-agnostic; execution hints are per-type

The semantic layer is flexible enough to support execution evolution without additional architectural layers. The IR remains the mechanical contract; SemanticInteraction remains the semantic foundation.

---

*This document completes the platform architecture analysis. Combined with the Architecture Freeze contracts, it provides a complete picture of the target design.*
