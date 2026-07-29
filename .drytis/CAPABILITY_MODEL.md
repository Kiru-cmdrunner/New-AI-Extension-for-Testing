# Capability Model — The Domain Center of CmdRunner

**Purpose:** Define the Capability Model as the first-class domain model that sits between observation and execution.  
**Core Thesis:** Capability is the true domain model. SemanticInteraction feeds it, IR serves it, execution implements it. Everything else exists to support capabilities.  
**Date:** July 2026

---

## Table of Contents

1. [The Four-Layer Architecture](#1-the-four-layer-architecture)
2. [What Is a Capability?](#2-what-is-a-capability)
3. [Is Capability a Projection or a Domain Model?](#3-is-capability-a-projection-or-a-domain-model)
4. [How Interactions Compose into Capabilities](#4-how-interactions-compose-into-capabilities)
5. [Capability Data Model](#5-capability-data-model)
6. [AI Reasoning at the Capability Level](#6-ai-reasoning-at-the-capability-level)
7. [What Operates on What](#7-what-operates-on-what)
8. [Capability Lifecycle in the Repository](#8-capability-lifecycle-in-the-repository)
9. [Impact on Architecture Freeze](#9-impact-on-architecture-freeze)

---

## 1. The Four-Layer Architecture

### The Separation

The user correctly identified four distinct concerns that must not be conflated:

```
Layer 1: OBSERVATION     "What the user did"
         SemanticInteraction[]
         Immutable. Factual. The raw material.

              │ derived by

Layer 2: CAPABILITY      "What business outcome the user intended"
         Capability
         Has own identity, lifecycle, relationships.
         The primary unit of test management.

              │ serves

Layer 3: EXECUTION       "How CmdRunner reproduces that capability"
         ExecutionIRPlan
         Disposable. Regenerable. Mechanical.

              │ implemented by

Layer 4: IMPLEMENTATION  "How the engine performs it on a specific platform"
         Playwright / Cypress / XCUITest / Supertest code
         Disposable. Framework-specific.
```

### Why Four Layers?

| Question | Answered By | Example |
|----------|------------|---------|
| "What did the user do?" | SemanticInteraction | "Selected 'Belgian' from the Nationality dropdown" |
| "What were they trying to accomplish?" | Capability | "Set up a new employee's personal information" |
| "How do we reproduce it?" | ExecutionIR | "Navigate to /pim/my-info, fill Name field, select Nationality" |
| "How do we execute it in Playwright?" | Implementation | `await page.getByLabel('Nationality').click(); ...` |

Each layer answers a different question. Each has a different mutability profile:

| Layer | Mutability | Regenerable? |
|-------|-----------|-------------|
| SemanticInteraction | Immutable | No — it's a recording |
| Capability | Mutable (named, versioned, refined) | No — it has its own identity and history |
| ExecutionIR | Disposable | Yes — regenerated from Capability + interactions |
| Implementation | Disposable | Yes — regenerated from IR |

### The Critical Distinction: Capability Is Not Disposable

Projections (assertions, execution hints, healing strategies) are disposable — they can be recomputed from SemanticInteraction at any time. 

Capability is **not disposable**. Once a capability is inferred and approved, it has its own identity:

- It's named ("User Login", "Search Flight", "Create Customer")
- It's versioned (v1 supports OXD dropdowns, v2 supports redesigned MUI dropdowns)
- It's associated with execution runs, test data, and success metrics
- It has dependencies ("Login" must succeed before "Update Profile")
- It has variations ("Login via SSO" vs "Login via credentials")

You can regenerate the IR from a Capability + its interactions. You can regenerate the Playwright code from the IR. But you **cannot regenerate the Capability** — it's a human-curated business artifact that captures intent, not just mechanics.

---

## 2. What Is a Capability?

### Definition

> A **Capability** is a business-meaningful unit of user intent, composed of one or more SemanticInteractions, that can be independently understood, verified, and reproduced.

### Characteristics

| Characteristic | Description |
|---------------|-------------|
| **Business-level** | Described in business terms ("Login"), not technical terms ("Fill username field") |
| **Composed** | Made of 1 to N SemanticInteractions that together accomplish a goal |
| **Verifiable** | Has explicit success criteria (what does "done" look like?) |
| **Reproducible** | Can be executed independently if its preconditions are met |
| **Dependent** | May require other capabilities to have been exercised first |
| **Variant** | The same capability can be implemented differently (native vs custom dropdown) |
| **Versioned** | Evolves as the application changes |

### Examples

| Capability | Interactions Composed | Success Criteria |
|-----------|----------------------|-----------------|
| User Login | Fill username, Fill password, Click login, Navigate to dashboard | URL is /dashboard, dashboard element visible |
| Search Flight | Fill origin (autocomplete), Fill destination (autocomplete), Select departure date, Select return date, Configure cabin+passengers (multiConfig), Click search | Flight results visible, ≥1 result shown |
| Create Employee | Fill name, Fill employee ID, Select nationality (dropdown), Select DOB (date picker), Click save | Success toast visible, employee in list |
| Update Profile | Fill fields, Toggle settings, Click save | Changes persisted (re-open shows new values) |
| Approve Leave | Navigate to leave list, Click approve on a row, Confirm in dialog | Leave status changed, row removed from pending |

### What Is NOT a Capability

| Not a Capability | Why | What It Is |
|-----------------|-----|-----------|
| A single click | Too granular — a click is a mechanism, not a business outcome | A SemanticInteraction |
| "Fill the username field" | Too granular — this is one step in a capability | A SemanticInteraction |
| "Run the login test" | Too specific — this is an execution instruction | An ExecutionRun |
| "Playwright test for login" | Too implementation-specific | Generated code |

---

## 3. Is Capability a Projection or a Domain Model?

### The Honest Answer: Both — In Sequence

Capability has a **dual nature**:

```
Phase 1: INFERENCE (Projection-like)
  SemanticInteraction[] → pattern matching → CapabilityCandidate
  This is a projection. It's derived. It can be recomputed.

Phase 2: ADOPTION (Domain Model)
  CapabilityCandidate → human review → Capability (approved)
  At this point, the Capability takes on its own identity.
  It's no longer a projection — it's a managed domain entity.
```

### Why It Transitions from Projection to Domain Model

| Property | As Projection (Inference) | As Domain Model (Approved) |
|----------|--------------------------|---------------------------|
| Identity | Derived from interaction sequence | Has its own UUID |
| Name | Auto-generated ("Select Belgian for Nationality") | Human-curated ("Configure Employee Nationality") |
| Scope | Inferred from interaction boundaries | Human-defined (may include/exclude interactions) |
| Lifecycle | Disposable | Versioned, managed, deprecated |
| Relationships | None | Depends on other capabilities, has variations |
| Success criteria | Inferred from state changes | Human-refined or AI-enriched |
| Mutability | Recomputable | Mutable but audited (changes are versions) |

### The Architecture Rule

> **Capability inference is a projection over SemanticInteraction[].**  
> **An approved Capability is a first-class domain model.**  
> **The transition happens at human review.**  
> **Before review: the system can recompute it freely.**  
> **After review: it has permanence and must be versioned.**

This is identical to how source code works: an AI can generate a pull request (projection-like — derived from requirements), but once merged, the code has permanence (domain model — versioned, owned, maintained).

---

## 4. How Interactions Compose into Capabilities

### Composition Model

A Capability references SemanticInteractions by ID. It does NOT copy their data:

```typescript
interface CapabilityStep {
  interactionId: string;           // → SemanticInteraction.id
  role: StepRole;                  // how this interaction contributes
  optional?: boolean;              // can the capability succeed without this?
}

type StepRole = 
  | 'primary'        // the core action that defines the capability
  | 'setup'          // precondition interactions (navigating to the page)
  | 'verification'   // asserting the outcome
  | 'teardown';      // cleanup after the capability
```

### Composition Examples

#### User Login

```
SemanticInteractions:
  [001] Navigate to /login                    (setup)
  [002] Fill 'admin' in Username              (primary)
  [003] Fill '***' in Password                (primary)
  [004] Click 'Login' (authenticate)          (primary)
  [005] Navigate to /dashboard                (verification)

Capability: "User Login"
  steps:
    - interactionId: "001", role: "setup"
    - interactionId: "002", role: "primary"
    - interactionId: "003", role: "primary"
    - interactionId: "004", role: "primary"
    - interactionId: "005", role: "verification"
  successCriteria:
    - "URL should be /dashboard"
    - "Dashboard element should be visible"
```

#### Search Flight (AdaniOne)

```
SemanticInteractions:
  [001] Navigate to /search                   (setup)
  [002] Fill 'DEL' → Select 'Delhi' (autocomplete)  (primary)
  [003] Fill 'BOM' → Select 'Mumbai' (autocomplete)  (primary)
  [004] Select date 2026-08-15 (datePicker)   (primary)
  [005] Configure cabin=Premium, adults=2 (multiConfig)  (primary)
  [006] Click 'Search Flights'               (primary)
  [007] Navigate to /results                  (verification)

Capability: "Search Flight"
  steps: [001-007 with appropriate roles]
  successCriteria:
    - "Flight results should be visible"
    - "At least 1 flight option should be present"
  dataRequirements:
    - origin: autocomplete (airport code)
    - destination: autocomplete (airport code)
    - departureDate: date
    - cabin: select (Economy, Premium, Business)
    - passengers: number (1-9)
```

### How Boundaries Are Detected

The capability inference engine segments the SemanticInteraction[] sequence into capabilities using these signals:

| Signal | Boundary Detection |
|--------|-------------------|
| `semanticAction: 'authenticate'` | Start/end of a login capability |
| `semanticAction: 'configure'` + completion | Part of a configuration capability |
| Navigation to a new page section | Potential capability boundary |
| `semanticAction: 'submit'` | End of a form-based capability |
| SemanticInteraction with `componentType: 'formSubmit'` | Marks a form submission boundary |
| Significant time gap (>30s) between interactions | Potential capability boundary |

**The inference doesn't need to be perfect.** It proposes capability boundaries. Human review refines them. AI can also suggest adjustments.

### Multiple Capabilities from One Recording

A single recording session can produce multiple capabilities:

```
Recording: "Admin sets up a new employee"

  Navigate to /pim/add          ─┐
  Fill employee name             │  Capability 1: "Navigate to Add Employee"
  Fill employee ID               │  (setup-heavy, may merge with Capability 2)
  ─────────────────────────────  ─┘
  Select nationality             ─┐
  Select date of birth            │  Capability 2: "Configure Employee Details"
  Select gender (radio)           │
  Click 'Save'                    │
  ─────────────────────────────  ─┘
  Navigate to /pim/view          ─┐
  Verify employee in list         │  Capability 3: "Verify Employee Created"
  ─────────────────────────────  ─┘
```

Each capability is independently testable. Capability 2 can be tested with different test data without re-recording Capability 1.

---

## 5. Capability Data Model

```typescript
interface Capability {
  // ─── IDENTITY ──────────────────────────────────
  id: string;                       // UUID
  name: string;                     // "User Login" (human-curated)
  description?: string;             // "Authenticate and access the dashboard"
  category: CapabilityCategory;
  
  // ─── ORIGIN ────────────────────────────────────
  source: {
    recordingSessionId: string;     // where it was first observed
    interactionIds: string[];       // ordered SemanticInteraction IDs
    inferredAt: string;
    inferenceMethod: 'rule' | 'ai' | 'manual';
    inferenceConfidence: number;    // 0.0–1.0
  };
  
  // ─── COMPOSITION ───────────────────────────────
  steps: CapabilityStep[];
  
  // ─── BUSINESS SEMANTICS ────────────────────────
  successCriteria: SuccessCriterion[];
  preconditions: string[];          // "Valid user credentials required"
  dataRequirements: DataRequirement[];
  
  // ─── LIFECYCLE ─────────────────────────────────
  status: CapabilityStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  
  // ─── RELATIONSHIPS ─────────────────────────────
  dependsOn?: string[];             // capability IDs that must run first
  variations?: string[];            // alternative implementations
}

type CapabilityCategory =
  | 'authentication'
  | 'navigation'
  | 'data_entry'
  | 'data_modification'
  | 'search'
  | 'selection'
  | 'configuration'
  | 'verification'
  | 'file_operation'
  | 'workflow'
  | 'custom';

type CapabilityStatus = 
  | 'inferred'       // auto-detected, awaiting review
  | 'approved'       // human-verified
  | 'deprecated';    // no longer relevant

interface SuccessCriterion {
  id: string;
  type: 'navigation' | 'element_state' | 'visibility' | 'absence' | 'text_content' | 'custom';
  description: string;               // "URL should be /dashboard"
  interactionId?: string;            // derived from which SemanticInteraction
  assertionRule?: {
    property: string;
    operator: 'equals' | 'contains' | 'matches' | 'is_true' | 'is_false';
    expectedValue?: string;
  };
}

interface DataRequirement {
  fieldName: string;                 // "username", "origin", "departureDate"
  label: string;                     // "Username", "Origin Airport"
  interactionId: string;             // which SemanticInteraction consumes this
  dataType: 'text' | 'email' | 'password' | 'date' | 'select' | 'number' | 'file';
  required: boolean;
  constraints?: {
    options?: string[];              // valid options for select/radio
    pattern?: string;                // regex for validation
    minLength?: number;
    maxLength?: number;
  };
  // For data-driven testing
  testDataSet?: DataTestSet[];
}

interface DataTestSet {
  name: string;                      // "valid_credentials", "invalid_password"
  values: Record<string, string>;    // fieldName → value
  expectedOutcome: 'success' | 'validation_error' | 'auth_failure';
}
```

### What This Model Enables

| Feature | How Capability Supports It |
|---------|---------------------------|
| **Data-driven testing** | `DataRequirement.testDataSet` defines variations. Same capability, different data. |
| **Test organization** | Capabilities are the primary grouping. Test suites = capability collections. |
| **Dependency management** | `dependsOn` ensures login runs before profile update. |
| **Variation testing** | `variations` links "Login via SSO" to "Login via credentials." |
| **Success verification** | `successCriteria` defines what "passing" means per capability. |
| **AI planning** | AI reasons at capability level: "To test the checkout flow, I need: Search Product → Add to Cart → Checkout." |
| **Impact analysis** | "The login form changed" → find all capabilities that reference login interactions. |
| **Coverage analysis** | "Which capabilities are covered by tests? Which pages have no capability coverage?" |

---

## 6. AI Reasoning at the Capability Level

### Why AI Reasons Better Over Capabilities Than Interactions

An LLM processing 50 SemanticInteractions sees a flat list of mechanical steps. It has to infer: "Oh, interactions 1-5 are a login, 6-12 are a form fill, 13 is a submit." This inference is error-prone and context-dependent.

An LLM processing 3 Capabilities sees:

```
1. Capability: "User Login" (authentication)
   Steps: [navigate, fill username, fill password, click login, verify dashboard]
   Success: URL = /dashboard, dashboard visible

2. Capability: "Configure Employee Details" (data_entry)
   Steps: [select nationality, select DOB, select gender, click save]
   Success: Save confirmation visible

3. Capability: "Verify Employee Created" (verification)
   Steps: [navigate to list, verify employee present]
   Success: Employee row visible with correct name
```

The AI can immediately reason:
- "This is a 3-step employee onboarding workflow"
- "Step 1 is a prerequisite for steps 2 and 3"
- "Step 2 has 3 data inputs that could have test variations"
- "If step 1 fails, steps 2-3 are irrelevant"

### AI Capabilities Enabled by the Capability Model

| AI Feature | What It Does | Needs From Capability |
|-----------|-------------|----------------------|
| **Test generation** | "Generate a test for employee creation" | Capability composition + data requirements + success criteria |
| **Test variation** | "Create a negative test: login with wrong password" | DataRequirement with testDataSet (valid/invalid variants) |
| **Impact analysis** | "The login page was redesigned — what's affected?" | Capability.dependencies, interaction references |
| **Coverage analysis** | "What capabilities are NOT tested?" | All capabilities vs. approved test cases |
| **Auto-healing guidance** | "This capability's dropdown broke — here's how to find the new one" | CapabilityStep.interactionId → SemanticInteraction.target.identity |
| **Workflow mining** | "Users commonly perform Login → Search → Filter → Export" | Capability sequence patterns across recordings |
| **Autonomous execution** | "Execute the 'Create Employee' capability with test data X" | Capability composition + data requirements + success criteria |
| **Root cause analysis** | "Login failed because the password field changed from input to div" | Capability → SemanticInteraction → target identity → execution failure |

### How AI Uses Both Layers

```
AI Reasoning Stack:

  Capability Level (business reasoning)
    "This is a login capability. It failed at the submit step.
     The login button changed from <button> to <div role='button'>.
     This is a framework migration, not a real failure.
     Suggest: update locator to getByRole('button')."

         │ references

  SemanticInteraction Level (technical detail)
    interaction[004]: Click 'Login'
    target.identity: { tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Login' }
    target.context: { className: 'oxd-button oxd-button--medium' }

         │ reproduced by

  IR Level (mechanical reproduction)
    step-004: CLICK
    locators: [getByRole('button', {name: 'Login'}), locator('.oxd-button')]

         │ executed by

  Execution Result (actual outcome)
    status: 'failed'
    error: 'element_not_found'
    attemptedLocators: [...]
```

The AI moves between levels freely — reasons at the capability level, drills down to interactions for technical detail, checks IR for locator strategies, and examines execution results for failure analysis.

---

## 7. What Operates on What

### The Definitive Answer

| Consumer | Primary Operating Unit | Also Accesses | Why |
|----------|----------------------|---------------|-----|
| **IR Generation** | Capability + SemanticInteraction[] | — | Generates steps from capability composition + interaction details |
| **Execution Engine** | ExecutionIRPlan | SemanticInteraction[] (semantic context) | Executes steps mechanically; uses interactions for type-aware decisions |
| **Self-Healing** | IRStep locators | SemanticInteraction.target.identity | Heals locators using rich identity from the observation |
| **AI Planning** | Capability[] | SemanticInteraction[] (for detail) | Plans at business level; drills down for implementation |
| **AI Execution** | Capability + IR | SemanticInteraction[] (for context) | Understands what capability it's executing; makes intelligent decisions |
| **Failure Analysis** | Capability + ExecutionResult | SemanticInteraction[] (for expected state) | Diagnoses at business level; examines technical detail for root cause |
| **Test Management** | Capability | — | Capabilities are the primary managed unit |
| **Coverage Analysis** | Capability[] | — | Maps capabilities to test coverage |

### The Key Insight

> **Execution operates on IR (mechanical).**  
> **Intelligence operates on Capability (business).**  
> **Both reference SemanticInteraction (factual).**

The execution engine doesn't need to understand capabilities — it executes steps. But every intelligent layer (AI, healing strategy, failure analysis, planning) operates primarily at the capability level and uses SemanticInteraction[] for technical grounding.

---

## 8. Capability Lifecycle in the Repository

### Updated Repository Entity Model

```
RecordingSession (immutable record)
  └── SemanticInteraction[] (observation)
        │
        │ capability inference (projection)
        ▼
Capability (inferred)  ──── human review ────►  Capability (approved)
  │                                                    │
  │                                              versioned, managed
  │                                                    │
  │                                                    │ IR generation
  │                                                    ▼
  │                                              ExecutionIRArtifact (disposable)
  │                                                    │
  │                                                    │ execution
  │                                                    ▼
  │                                              ExecutionRun (append-only)
  │                                                    │
  │                                                    │ results
  │                                                    ▼
  │                                              [pass/fail/healing data]
  │
  └── may be refined, re-scoped, or deprecated
```

### Repository Tables (Updated)

| Table | Entity | Lifecycle | Key Relationships |
|-------|--------|-----------|------------------|
| `recordingSessions` | RecordingSession | Immutable | Contains SemanticInteraction[] |
| `capabilities` | Capability | Versioned | References SemanticInteraction IDs; dependsOn other capabilities |
| `testCases` | ApprovedTestCase | Versioned | Wraps a Capability with execution config, scheduling, environment |
| `executionIRs` | ExecutionIRArtifact | Disposable | Generated from Capability + interactions; cached for reuse |
| `executionRuns` | ExecutionRun | Append-only | References TestCase + IR; contains step results |
| `elements` | Element | Mutable | Backed by SemanticInteraction.target.identity; healed over time |

### How Capability Relates to Test Case

A **Capability** is the business understanding. A **Test Case** is the managed execution artifact:

| Capability | Test Case |
|-----------|-----------|
| "User Login" | "Login with valid credentials (TC-001)" |
| "User Login" | "Login with invalid password (TC-002)" |
| "User Login" | "Login via SSO (TC-003)" |

One Capability → multiple Test Cases (different data sets, different configurations, different variations). The Test Case wraps the Capability with:
- Specific test data (from DataRequirement.testDataSet)
- Execution environment (staging, production)
- Scheduling (nightly, on-commit, manual)
- Expected outcome (success, validation error)

### Data Flow Summary

```
1. User records on the app
   → CapturedEvent stream

2. Interaction engine processes events
   → SemanticInteraction[] (stored in RecordingSession)

3. Capability inference engine analyzes interactions
   → Capability[] (inferred, stored in Repository)

4. Human reviews and approves
   → Capability status: inferred → approved
   → Name, description, scope refined

5. Human or AI creates Test Cases
   → ApprovedTestCase wraps Capability with data + config

6. IR generation produces execution plan
   → ExecutionIRArtifact (cached, disposable)

7. Execution engine runs the test
   → ExecutionRun (results stored)

8. If locators break during execution
   → Self-healing uses SemanticInteraction.target.identity
   → Healed locators stored in Element entity
   → IR marked stale, regenerated on next run

9. If the capability needs updating (app changed)
   → Record again → new SemanticInteraction[]
   → Capability version 2 inferred
   → Human approves v2 → deprecates v1
```

---

## 9. Impact on Architecture Freeze

### New Contract: Capability Model

The Capability Model is added as a **first-class frozen contract**, alongside SemanticInteraction and IR.

| Contract | Status | Change from Previous |
|----------|--------|---------------------|
| SemanticInteraction | ✅ Frozen (22 fields, observation only) | Unchanged — still the immutable observation |
| Interaction Taxonomy | ✅ Frozen (19 types) | Unchanged |
| Lifecycle Definition Format | ✅ Frozen | Unchanged |
| Evidence Provider Interface | ✅ Frozen | Unchanged |
| IR Contract | ✅ Frozen | Unchanged — still the disposable execution contract |
| **Capability Model** | ✅ **NEW — Frozen** | **Added as first-class domain model** |
| Success Criteria per Interaction | ✅ Frozen | Unchanged |

### What Does NOT Change

| Aspect | Status |
|--------|--------|
| 3-stage pipeline | ✅ Unchanged — capture → engine → IR+code |
| Migration phases (0-8) | ✅ Unchanged |
| Projection pattern | ✅ Unchanged — Capability inference IS a projection (before approval) |
| SemanticInteraction boundary | ✅ Unchanged — 22 fields, no consumer concerns |

### Revised Platform Architecture (Final)

```
┌─────────────────────────────────────────────────────────────┐
│                    OBSERVATION LAYER                         │
│                                                             │
│  SemanticInteraction[] (Immutable)                          │
│    "What the user did"                                      │
│    Stored in RecordingSession                               │
│    22 frozen fields                                         │
│    Referenced by everything downstream                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ capability inference (projection)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    CAPABILITY LAYER                          │
│                                                             │
│  Capability[] (First-class domain model)                    │
│    "What business outcome the user intended"                │
│    Composed of SemanticInteraction references               │
│    Has own identity, lifecycle, versioning                  │
│    Carries success criteria, data requirements              │
│    Has dependencies and variations                          │
│    The PRIMARY unit of test management and AI reasoning     │
└──────────┬──────────────────────────────┬───────────────────┘
           │                              │
           │ IR generation                │ AI reasoning
           ▼                              ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│   EXECUTION LAYER        │  │   AI LAYER                   │
│                          │  │                              │
│  ExecutionIRPlan         │  │  Test generation             │
│    (Disposable)          │  │  Impact analysis             │
│  IRStep + locators       │  │  Coverage analysis           │
│    + assertions          │  │  Workflow mining             │
│    + execution params    │  │  Autonomous execution        │
│                          │  │  Root cause analysis         │
│  ↓ implemented by        │  │                              │
│                          │  │  ↓ operates on               │
│  Playwright / Cypress    │  │                              │
│  / XCUITest / Supertest  │  │  Capability[] +              │
│                          │  │  SemanticInteraction[]       │
│  ↓ executed by           │  │                              │
│                          │  └──────────────────────────────┘
│  Execution Engine        │
│    → click, fill, select │
│    → verify assertions   │
│    → heal locators       │
│    → capture results     │
│                          │
│  ↓ produces              │
│                          │
│  ExecutionRun            │
│    → pass/fail per step  │
│    → healing history     │
│    → failure context     │
└──────────────────────────┘
```

### The Four-Layer Separation (Final)

| Layer | Model | Question | Mutability | Owner |
|-------|-------|----------|-----------|-------|
| **Observation** | SemanticInteraction | What did the user do? | Immutable | Recorder |
| **Capability** | Capability | What were they trying to accomplish? | Versioned | Product/QA team |
| **Execution** | ExecutionIRPlan | How do we reproduce it? | Disposable | IR Generator |
| **Implementation** | Playwright code | How do we execute on this platform? | Disposable | Code Generator |

> **Recording is the source of observations.**  
> **Capabilities are the core business model.**  
> **Execution and AI are consumers of that model.**

---

## Summary

The Capability Model is the missing piece that makes CmdRunner a platform, not just a recorder. It sits between the immutable observation layer (SemanticInteraction) and the disposable execution layer (IR), serving as:

1. **The primary unit of test management** — users manage capabilities, not individual interactions or IR steps
2. **The AI reasoning unit** — LLMs reason over capabilities, drilling down to interactions for detail
3. **The composition model** — groups interactions into business-meaningful units with success criteria
4. **The dependency graph** — capabilities depend on each other (login before dashboard)
5. **The data-driven testing foundation** — data requirements with test data sets enable variations
6. **The impact analysis target** — "what changed?" maps to capabilities, not steps

### The Complete Architecture (Seven Documents)

| Document | Lines | Role |
|----------|-------|------|
| `CMDRECORDER_ARCHITECTURE.md` | 1,760 | Current-state source of truth |
| `ARCHITECTURE_REVIEW.md` | 1,045 | Critical review |
| `SIMPLIFICATION_JUSTIFICATION.md` | 848 | Capability preservation analysis |
| `ARCHITECTURE_FREEZE_STRATEGY.md` | 1,263 | Frozen contracts + migration plan |
| `PLATFORM_EXECUTION_ARCHITECTURE.md` | 654 | Execution as first-class platform concern |
| `SEMANTIC_INTERACTION_BOUNDARY.md` | 469 | Observation vs projection boundary |
| `CAPABILITY_MODEL.md` | This document | **The domain center: business capabilities** |

Together these define a complete platform architecture where:
- **Recording** produces immutable observations (SemanticInteraction)
- **Capability inference** transforms observations into business understanding (Capability)
- **IR generation** transforms capabilities into executable plans (ExecutionIRPlan)
- **Code generation** transforms plans into framework code (Playwright)
- **Execution** reproduces capabilities on real apps
- **AI** reasons at the capability level, grounded by observations
- **Self-healing** uses observations to repair broken implementations
- **Future expansion** (mobile, API, desktop) adds new capture sources and code adapters without touching the semantic or capability layers

---

*This document completes the platform architecture. The Capability Model is the domain center that everything else supports.*
