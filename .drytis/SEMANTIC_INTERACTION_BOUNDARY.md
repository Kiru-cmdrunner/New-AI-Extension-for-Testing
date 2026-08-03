> **STATUS:** The boundary contract *principle* (immutable observation vs consumer projections) is architecturally sound and still applies to `ComponentInteraction`. However, the `SemanticInteraction` type itself was superseded by `ComponentInteraction` in Phase 3/R1. Read this for the principle, not for type-specific details.
>
> **For current architecture, read MASTER-HANDOVER.md at project root.**

# SemanticInteraction — Boundary Contract (Historical — Principle Still Valid)

**Purpose:** Define what belongs inside SemanticInteraction and what does not, preventing it from becoming a god object.  
**Principle:** SemanticInteraction is an **immutable observation** — it records what the user did. Every consumer concern (assertions, execution hints, AI interpretations, healing strategies) lives in a **projection** that references it, never as a field on it.

---

## The Core Problem

I proposed adding these fields to SemanticInteraction across the previous documents:

| Field | Proposed By | Concern |
|-------|------------|---------|
| `assertions` | Architecture Freeze | IR generation |
| `executionHints` | Platform Architecture | Execution |
| `irStepId` | Platform Architecture | Cross-reference |
| `intentCategory` | Architecture Freeze (Future AI) | AI interpretation |
| `relationships` | Architecture Freeze (Future AI) | Structural analysis |
| `behavioralSignature` | Architecture Freeze (Future AI) | Capture context |
| `configuredFields` | Semantic Reasoner | Lifecycle extraction |
| `semanticAction` | Semantic Reasoner | Lifecycle classification |
| `evidence` | Evidence Engine | Classification provenance |
| `confidence` | Evidence Engine | Classification quality |

That's 10 fields spanning 6 different concerns. Add mobile support, API testing, visual regression, and AI v2 features, and SemanticInteraction accumulates 20+ concern-specific fields. This is the god object trajectory.

---

## The Solution: Observation vs Projection

### The Distinction

Every piece of information about an interaction falls into exactly one of two categories:

**Observation** — A fact captured at recording time. Immutable. Part of the permanent record.
- "The user selected 'Belgian' from the Nationality dropdown at 14:32:05"
- "The element had role=combobox and class=oxd-select-text"
- "The value before was empty, the value after was 'Belgian'"
- "This interaction was produced by a dropdown lifecycle session"
- "Classification confidence was 0.85 based on DOM + ARIA + CSS evidence"

**Projection** — A derived interpretation computed by a consumer. Mutable, consumer-specific, disposable.
- "This interaction should produce an assertion that the dropdown shows 'Belgian'" (IR bridge)
- "This interaction should use retry-once-after-1s because it's a custom dropdown" (executor)
- "This interaction is part of an 'Employee Setup' workflow" (AI analysis)
- "This interaction is related to interaction #3 and #7" (structural analysis)
- "This interaction's IR step ID is step-0005" (cross-reference)

### The Rule

> **SemanticInteraction contains ONLY observations.**
>
> **Every projection lives in a separate type that references SemanticInteraction by ID.**
>
> **Adding a new platform capability = adding a new projection type. Never adding fields to SemanticInteraction.**

---

## What Belongs Inside SemanticInteraction

### The Immutable Observation

```typescript
interface SemanticInteraction {
  // ─── IDENTITY ──────────────────────────────────
  id: string;
  order: number;
  
  // ─── WHAT THE USER DID ─────────────────────────
  type: InteractionType;           // 'Select', 'Fill', 'Click', etc.
  variant?: string;                // 'custom', 'native', 'autocomplete', etc.
  componentType?: string;          // 'dropdown', 'datePicker', etc.
                                    //   → which lifecycle session produced this
  
  // ─── WHERE ─────────────────────────────────────
  target: {
    identity: ElementIdentity;      // accessibleName, role, tag, locators, etc.
    pageUrl: string;
    pageTitle: string;
    context: DomContext;            // ARIA state, ancestor roles, surface, etc.
  };
  
  // ─── WHAT HAPPENED ─────────────────────────────
  label: string;                    // "Select Belgian for Nationality"
  value?: string;                   // committed value
  beforeState?: ElementState;       // observed state BEFORE
  afterState?: ElementState;        // observed state AFTER
  semanticAction?: string;          // 'configure' | 'authenticate'
  configuredFields?: Record<string, string>;
  
  // ─── WHY WE CLASSIFIED IT THIS WAY ────────────
  evidence: EvidenceSummary[];
  confidence: number;
  sourceEventCount: number;         // raw events collapsed into this
  
  // ─── WHEN ──────────────────────────────────────
  timestamp: string;
  durationMs?: number;
  
  // ─── CAPTURE-TIME CONTEXT ──────────────────────
  behavioralSignature?: {
    surroundingText?: string[];
    nearbyLandmarks?: string[];
  };
}
```

### Why Each Field Is an Observation

| Field | Why It's an Observation (Not a Projection) |
|-------|--------------------------------------------|
| `type`, `variant`, `componentType` | Facts about what kind of interaction occurred. Determined by the lifecycle engine during recording. Not re-interpretable. |
| `target` (all sub-fields) | Facts about which element the user interacted with. Captured from the live DOM at recording time. The element's identity doesn't change retroactively. |
| `label` | The human-readable description of what happened. Determined during recording. Stable. |
| `value`, `beforeState`, `afterState` | Factual state transitions observed during recording. The value WAS 'Belgian' — that's a fact, not an interpretation. |
| `semanticAction`, `configuredFields` | Facts about what the user accomplished. The user DID configure a panel. The user DID authenticate. These are observations of intent, not interpretations. |
| `evidence`, `confidence` | Audit trail of why this interaction was classified this way. Part of the observation's authenticity. Not re-computable after recording without re-running the engine. |
| `timestamp`, `durationMs` | When it happened and how long the lifecycle lasted. Factual. |
| `behavioralSignature` | Context captured from the DOM at recording time. Factual snapshot. Not derived from other interactions. |

### What Was REMOVED from the Earlier Proposal

| Removed Field | Why Removed | Where It Lives Now |
|---------------|------------|-------------------|
| `assertions` | Derived by IR bridge from before/after states. Consumer-specific. | `AssertionProjection` (see below) |
| `executionHints` | Derived by executor from type/variant. Consumer-specific. | `ExecutionProjection` |
| `irStepId` | Cross-reference to a disposable artifact (IR can be regenerated). Mutable. | On `IRStep.semanticInteractionId` (one-directional: IR → Semantic) |
| `intentCategory` | AI interpretation. The same interaction could be categorized differently by different AI models or contexts. | `AnalysisProjection` |
| `relationships` | Structural analysis computed across multiple interactions. Not observable at recording time. | `AnalysisProjection` |
| `visualPosition` (was in behavioralSignature) | Hard to capture reliably, adds complexity, limited value for the cost. | Removed entirely |

---

## What Lives Outside SemanticInteraction (Projections)

Each consumer computes its own view over SemanticInteraction[]. Projections are **derived, disposable, and consumer-owned**. They reference SemanticInteraction by ID but never modify it.

### Projection 1: AssertionProjection (IR Bridge)

```typescript
// Computed by IR bridge during IR generation
// Derived from: type, value, beforeState, afterState, target

interface AssertionProjection {
  interactionId: string;            // references SemanticInteraction.id
  assertions: DerivedAssertion[];
}

interface DerivedAssertion {
  type: AssertionType;
  target: ResolvedTarget;           // locators from SemanticInteraction.target.identity
  property: string;                 // 'value', 'checked', 'text', etc.
  expectedValue?: string;
  severity: 'hard' | 'soft';       // hard for committed changes, soft for intermediate
  description: string;
}
```

**Derivation rules:**

| Interaction Type | Before | After | Assertion | Severity |
|-----------------|--------|-------|-----------|----------|
| Fill | `value: ''` | `value: 'john'` | Field contains 'john' | soft |
| Select | `value: null` | `value: 'Belgian'` | Dropdown shows 'Belgian' | hard |
| Toggle | `checked: false` | `checked: true` | Checkbox is checked | hard |
| Navigate | `url: '/login'` | `url: '/dashboard'` | URL is '/dashboard' | hard |
| DateSelect | `value: null` | `value: '2023-10-21'` | Date shows '2023-10-21' | hard |

**Why this is a projection, not a field:** Different IR consumers might want different assertions. A Playwright adapter wants `toBeVisible()`. A Cypress adapter wants `should('contain', ...)`. An AI might generate semantic assertions ("the form was successfully submitted"). The SemanticInteraction doesn't know which consumer will read it.

### Projection 2: ExecutionProjection (Executor)

```typescript
// Computed by executor before/during execution
// Derived from: type, variant, componentType, confidence

interface ExecutionProjection {
  interactionId: string;
  hints: ExecutionHints;
}

interface ExecutionHints {
  retryStrategy: 'none' | 'once' | 'twice' | 'thrice';
  retryDelayMs: number;
  waitStrategy: 'immediate' | 'visible' | 'stable' | 'present';
  timeoutMs: number;
  knownFlaky?: boolean;             // from execution history (not recording)
}
```

**Derivation rules (type-aware execution):**

| Type + Variant | Retry | Delay | Wait | Timeout |
|---------------|-------|-------|------|---------|
| Click (any) | once | 1000ms | visible | 5000ms |
| Fill | once | 500ms | visible | 10000ms |
| Select (custom) | twice | 2000ms | visible | 10000ms |
| Select (native) | once | 500ms | present | 5000ms |
| Select (autocomplete) | thrice | 1000ms | stable | 15000ms |
| DateSelect | once | 1000ms | present | 10000ms |
| Navigate | none | — | none | 30000ms |
| Toggle | once | 500ms | visible | 5000ms |
| Hover | none | — | immediate | 3000ms |

**Why this is a projection:** Execution strategies evolve independently. Today's retry logic might change when we learn that custom dropdowns need 3 retries on MUI but only 1 on AntD. That's an execution-engine evolution, not a recording change. If execution hints were on SemanticInteraction, changing retry logic would require modifying the recording model.

### Projection 3: AnalysisProjection (AI / Analytics)

```typescript
// Computed lazily by AI assistant or analytics tools
// Derived from: the full SemanticInteraction[] sequence

interface AnalysisProjection {
  interactionIds: string[];         // which interactions this analysis covers
  intentCategory?: IntentCategory;  // 'authentication', 'data_entry', etc.
  workflowContext?: string;         // "Employee Information form setup"
  relationships?: ElementRelationship[];
  capabilityInferred?: string;      // "User Login", "Create Employee"
  confidenceScore?: number;         // AI confidence in its analysis
}

interface ElementRelationships {
  interactionId: string;
  parentForm?: string;              // semantic grouping
  relatedTo?: string[];             // other interaction IDs
  opensSurface?: string;            // interaction ID that opens a surface
}
```

**Why this is a projection:** AI interpretation is inherently subjective and evolvable. A future, better AI model might classify the same recording differently. Structural relationships depend on what "related" means to the consumer. These interpretations must not pollute the observation.

### Projection 4: HealingProjection (Self-Healing)

```typescript
// Computed by the healing engine when a locator breaks
// Derived from: target.identity, target.context, behavioralSignature

interface HealingProjection {
  interactionId: string;
  searchStrategies: HealingSearchStrategy[];
}

interface HealingSearchStrategy {
  method: 'accessibleName' | 'role+nearbyText' | 'classPattern' 
        | 'ancestorStructure' | 'behavioralSignature';
  query: string;                    // concrete search query
  priority: number;
  frameworkAdapter?: string;        // 'OXD', 'MUI', etc.
}
```

**Why this is a projection:** Healing strategies depend on the live page state at execution time, which interaction framework the app uses, and what healed elements are already known. These are execution-time concerns, not recording-time observations.

---

## The Projection Pattern

```
                    SemanticInteraction[] (IMMUTABLE)
                    ┌─────────────────────────────────┐
                    │ id: "interaction-0001"          │
                    │ type: "Select"                  │
                    │ variant: "custom"               │
                    │ label: "Select Belgian for..."  │
                    │ value: "Belgian"                │
                    │ beforeState: { value: null }    │
                    │ afterState: { value: "Belgian" }│
                    │ target: { identity: {...} }     │
                    │ evidence: [...]                 │
                    │ confidence: 0.85                │
                    │ componentType: "dropdown"       │
                    │ timestamp: "2026-07-29T..."     │
                    │ behavioralSignature: {...}      │
                    └────────────┬────────────────────┘
                                 │
           ┌─────────┬───────────┼───────────┬──────────┐
           │         │           │           │          │
           ▼         ▼           ▼           ▼          ▼
     Assertion   Execution   Analysis    Healing    (Future)
     Projection  Projection  Projection  Projection  Projection
           
     "Field      "Retry      "This is    "Search    "Visual
      should     twice       part of    by role   regression
      show       with 2s     login      + nearby  baseline"
      Belgian"   delay"      workflow"  text"
```

Each projection:
- References SemanticInteraction by `interactionId`
- Is computed by its owning consumer
- Is disposable (can be recomputed at any time from the interaction)
- Evolves independently (changing retry logic doesn't touch the recording model)
- Can be versioned independently (IR v1 assertions vs IR v2 assertions)

---

## How This Prevents the God Object

### Test: Adding a New Platform Capability

**Scenario:** CmdRunner adds visual regression testing. The executor needs to capture a screenshot baseline for each interaction and compare against it on future runs.

**Wrong approach (god object):** Add `screenshotBaseline`, `visualRegion`, `visualDiffThreshold` to SemanticInteraction. Now the recording model knows about visual regression — a concern it shouldn't have.

**Right approach (projection):** Create a `VisualRegressionProjection`:

```typescript
interface VisualRegressionProjection {
  interactionId: string;
  baselineScreenshot?: string;      // captured on first execution
  region?: { x: number; y: number; width: number; height: number };
  diffThreshold: number;            // configurable per-project
  lastComparison?: {
    matched: boolean;
    diffPercentage: number;
    capturedAt: string;
  };
}
```

SemanticInteraction is untouched. The visual regression feature is fully encapsulated in its own projection.

**Another scenario:** CmdRunner adds API testing. Interactions need HTTP method, endpoint, request body, response status.

**Wrong approach:** Add `httpMethod`, `endpoint`, `requestBody`, `responseStatus` to SemanticInteraction. Now the model is polluted with API concerns.

**Right approach:** SemanticInteraction already has `type`, `target`, `value`, `beforeState`, `afterState`. For API interactions:

```typescript
// A SemanticInteraction from an API recording:
{
  type: 'Fill',
  target: {
    identity: {
      tag: 'ENDPOINT',
      accessibleName: 'POST /api/users',
      cssSelector: '/api/users',
    },
    pageUrl: 'https://api.example.com',
    context: { method: 'POST', endpoint: '/api/users' }
  },
  value: '{"name":"John","role":"admin"}',
  beforeState: { value: null },
  afterState: { value: '{"id":123,"name":"John","role":"admin"}' },
}

// API-specific projection for execution:
interface ApiExecutionProjection {
  interactionId: string;
  method: string;
  endpoint: string;
  headers: Record<string, string>;
  expectedStatus: number;
}
```

The SemanticInteraction model is domain-agnostic. API-specific details are projections.

### The Stability Guarantee

> **SemanticInteraction will not gain new fields when platform capabilities are added.**
>
> New capabilities produce new projections. The observation model is frozen at the fields defined in this document.
>
> The ONLY changes to SemanticInteraction after freeze are:
> 1. Adding a new `InteractionType` value (e.g., `'Swipe'` for mobile) — this is an enum extension, not a structural change
> 2. Adding optional fields to `ElementIdentity` or `DomContext` for new capture sources — these are sub-types, and the additions must be genuinely observational (captured at recording time)
> 3. Deprecating fields that prove unnecessary — backward-compatible removal

---

## Responsibility Boundaries

### What SemanticInteraction IS Responsible For

| Responsibility | Why It Belongs Here |
|---------------|---------------------|
| Recording what type of interaction occurred | This IS the observation |
| Recording which element was interacted with | This IS the observation |
| Recording what value was entered/selected | This IS the observation |
| Recording state before and after | This IS the observation |
| Recording classification evidence and confidence | This IS the provenance of the observation |
| Recording when it happened and how long | This IS the observation |
| Recording what the user semantically accomplished (configure, authenticate) | This IS the observed intent |

### What SemanticInteraction Is NOT Responsible For

| Responsibility | Why It Doesn't Belong | Where It Belongs |
|---------------|----------------------|-----------------|
| Generating assertions | Consumer-specific (Playwright vs Cypress vs AI) | AssertionProjection (IR bridge) |
| Deciding retry/wait strategy | Consumer-specific (execution engine concern) | ExecutionProjection (executor) |
| Inferring workflow context | Interpretation that varies by consumer | AnalysisProjection (AI/analytics) |
| Computing element relationships | Structural analysis across interactions | AnalysisProjection (AI/analytics) |
| Deciding healing strategy | Execution-time, depends on live page | HealingProjection (healer) |
| Linking to IR steps | IR is disposable/regenerable | IRStep.semanticInteractionId (one-directional) |
| Storing execution results | Execution concern | ExecutionRun (repository) |
| Storing screenshots | Execution concern | ExecutionStepResult (repository) |

---

## Revised Frozen Contract

### SemanticInteraction (Final — No Future Fields)

```typescript
interface SemanticInteraction {
  id: string;
  order: number;
  type: InteractionType;
  variant?: string;
  componentType?: string;
  target: {
    identity: ElementIdentity;
    pageUrl: string;
    pageTitle: string;
    context: DomContext;
  };
  label: string;
  value?: string;
  beforeState?: ElementState;
  afterState?: ElementState;
  semanticAction?: string;
  configuredFields?: Record<string, string>;
  evidence: EvidenceSummary[];
  confidence: number;
  sourceEventCount: number;
  timestamp: string;
  durationMs?: number;
  behavioralSignature?: {
    surroundingText?: string[];
    nearbyLandmarks?: string[];
  };
}
```

**22 fields. Frozen. No more will be added for consumer concerns.**

### Projection Registry (Extensible)

| Projection | Owner | When Computed | Storage |
|-----------|-------|--------------|--------|
| `AssertionProjection` | IR Bridge | At IR generation | Embedded in IRStep |
| `ExecutionProjection` | Executor | At execution time | In-memory per run |
| `AnalysisProjection` | AI / Analytics | On demand (lazy) | Separate store or side output |
| `HealingProjection` | Healing Engine | On locator failure | In-memory per heal |

**Adding a new projection requires:** defining the interface + derivation function. It does NOT require touching SemanticInteraction.

---

## Summary

The architecture has one immutable contract (SemanticInteraction — the observation) and N extensible projections (consumer-specific views). This is the event-sourcing pattern applied to test recording:

- **SemanticInteraction = the event** (immutable, factual, frozen)
- **Projections = the read models** (derived, disposable, independently evolvable)

This prevents the god object because:
1. Adding capabilities = adding projections, not fields
2. SemanticInteraction stays at 22 fields forever
3. Consumers evolve independently without contract changes
4. Multiple interpretations can coexist (IR bridge asserts X, AI interprets Y — both valid projections of the same observation)

> **SemanticInteraction answers one question: "What did the user do?"**
> **Every other question is answered by a projection over the answer.**

---

*This document defines the boundary contract for SemanticInteraction. It supersedes field additions proposed in earlier documents (assertions, executionHints, irStepId, intentCategory, relationships are REMOVED from SemanticInteraction and moved to projections).*
