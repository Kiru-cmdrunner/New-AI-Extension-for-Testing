# P1: Capability Lifecycle Management — Design Document

> **Status:** Design (awaiting approval). Do NOT implement until approved.
>
> **Baseline:** Commit `d98fec3` (post-R3 + documentation update). R1, R2, R3 complete.
>
> **Roadmap Reference:** `CANONICAL_ROADMAP.md` §5 Phase P1.
>
> **Architectural Objective:** Transform the extension from a recorder that produces test code into a test management platform where recorded sessions become managed, reviewable, versioned capabilities with formal data requirements and success criteria — the substrate for AI test generation (P3) and capability-derived execution (P2).

---

## §1. Objective and Product Value

### What P1 Delivers

Today, the recorder captures interactions, classifies them semantically, derives a `CapabilityCandidate` from the recording, and either auto-merges it into an existing `Capability` or creates a new one — all automatically, with no human review.

**P1 adds a managed lifecycle:**

1. **Human review** — a reviewer sees what was derived, its confidence, and can approve, reject, edit, or override before it becomes an official capability.
2. **Formal data requirements** — explicit specifications of what test data a capability needs (e.g., "Login requires a valid email and a password with ≥8 characters").
3. **Formal success criteria** — explicit pass/fail criteria (e.g., "Login succeeds when the URL changes to `/dashboard` within 5 seconds").
4. **Versioning** — approved capabilities are versioned snapshots. Changes create new versions. P2/P3 reference specific versions.
5. **Capability inventory** — users can browse, search, and manage all approved capabilities in a project.

### What P1 Does NOT Do

- **Does not re-classify or re-interpret interactions.** The recorder's semantic output (type, subtype, intent, confidence, evidence trail) is consumed as-is. P1 never overrides the recorder's classification.
- **Does not generate test code or execution plans.** That is P2 (capability-derived IR) and P3 (AI test generation).
- **Does not execute tests.** That is P4/P5.
- **Does not add new lifecycle definitions or evidence generators.** Recorder improvements are separate workstream decisions.
- **Does not auto-approve.** The whole point is human review. The auto-merge threshold (0.75) from the matching service becomes a *suggestion*, not a decision.

---

## §2. Existing Infrastructure Analysis

Significant capability infrastructure already exists. P1 reuses most of it.

### 2.1 What Exists and Will Be Reused (Unchanged)

| Component | File | Status in P1 |
|-----------|------|-------------|
| `CapabilityCandidate` type | `src/domain/entities/capability-candidate.ts` | ✅ Reused as-is — this is the input to the review process |
| `deriveCapability()` | `src/recorder/enrichment/capability-deriver.ts` | ✅ Reused as-is — derives candidates from fragments |
| `ApplicationKnowledgeFragment` + all sub-types | `src/domain/entities/application-knowledge.ts` | ✅ Reused as-is — the source from which candidates are derived |
| `matchCapability()` scoring | `src/repository/services/capability-matching-service.ts` | ✅ Reused as-is — scoring is sound; P1 changes how the *decision* is acted upon |
| Enrichment pipeline (7-step) | `src/recorder/enrichment/enrichment-orchestrator.ts` | ✅ Reused as-is — produces the fragment |
| `StorageService` | `src/storage/storage-service.ts` | ✅ Reused as-is — P1 adds new keys |
| `enrichInteraction()` (3-layer) | `src/enrichment/enrich.ts` | ✅ Reused as-is — enriches interactions before capability derivation |
| `enrichConfigurationSession()` | `src/enrichment/structural-enrichment.ts` | ✅ Reused as-is — produces businessField names used in capability derivation |
| Side panel 4-view architecture | `src/sidepanel/sidepanel.ts` | ✅ Extended — P1 adds capability views within existing architecture |

### 2.2 What Exists and Will Be Evolved

| Component | Current State | P1 Evolution |
|-----------|---------------|-------------|
| `Capability` entity | Auto-created/enriched, no review step, no versioning, no data requirements | Extended: add `reviewState`, `version`, `dataRequirements`, `successCriteria`, `reviewHistory` |
| `createCapability()` | Factory creates with confidence='candidate' | Extended: accepts review metadata |
| `enrichCapability()` | Accumulates data from new sessions | Extended: creates version snapshots, records review decisions |
| `CapabilityRepository` | CRUD + findBySessionId | Extended: add `getByVersion()`, `listVersions()`, `findByReviewState()` |
| `SessionPersistenceService` | Auto-decides (auto-merge/new/ambiguous) and acts immediately | Changed: derives candidate + match suggestion, but does NOT auto-create/enrich. Defers to review. |
| Side panel `stopped` view | Shows repository status badge only | Extended: shows capability review card, data requirements form, success criteria form |
| `TestCaseState` enum | DRAFT→RECORDING→RECORDED→...→APPROVED→SAVED | Extended: capability has its own review lifecycle separate from test case lifecycle |

### 2.3 What Does Not Exist and Will Be Created

| Component | Purpose |
|-----------|---------|
| `DataRequirement` type | Formal specification of test data a capability needs |
| `SuccessCriterion` type | Formal pass/fail criteria for capability execution |
| `CapabilityVersion` type | Immutable version snapshot of an approved capability |
| `CapabilityReviewService` | Orchestrates the review workflow (candidate → reviewed → approved/rejected) |
| `CapabilityReviewStore` (Dexie table) | Persists review state, reviewer identity, review decisions |
| Capability review UI | Side panel views for reviewing, editing, approving capabilities |
| Capability inventory UI | Side panel view for browsing all approved capabilities in a project |
| `P2CapabilityContract` type | The read-only interface P2/P3 consume to generate tests from capabilities |

### 2.4 What Will NOT Be Removed

Nothing in the existing capability infrastructure is removed. The auto-merge logic in `SessionPersistenceService` is changed from "act immediately" to "prepare suggestion, defer to review," but the scoring functions and thresholds remain. This allows P1 to fall back to automatic behavior if a future configuration flag enables it.

---

## §3. Data Model

### 3.1 New Types

#### DataRequirement

```typescript
export interface DataRequirement {
  readonly field: string;           // "email", "password", "searchQuery", "maxPrice"
  readonly label: string;           // human-readable: "Email Address"
  readonly kind: DataKind;          // 'text' | 'number' | 'boolean' | 'date' | 'select' | 'email'
  readonly required: boolean;
  readonly defaultValue: string | null;   // suggested value for test generation
  readonly constraints: DataConstraint;   // inferred from InteractionContract, editable
  readonly source: 'inferred' | 'manual'; // was this auto-derived or manually added?
}

export type DataKind = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'email';

export interface DataConstraint {
  readonly minLength: number | null;
  readonly maxLength: number | null;
  readonly pattern: string | null;        // regex
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
  readonly options: string[] | null;      // for select kind
  readonly formatDescription: string | null;
}
```

**How this maps from existing infrastructure:**

A `CapabilityInput` from the candidate (derived from `LogicalAction.businessField` + `InteractionContract.constraints`) becomes a `DataRequirement`:

| CapabilityInput field | DataRequirement field |
|----------------------|---------------------|
| `label` | `field` + `label` |
| `inputType` | `kind` (mapped: 'email'→email, 'number'→number, etc.) |
| `required` | `required` |
| `valueRange` | `constraints.min/max/step` |
| `lengthRange` | `constraints.minLength/maxLength` |
| `format` | `constraints.pattern` + `constraints.formatDescription` |
| `validOptions` | `constraints.options` |

The reviewer sees inferred data requirements pre-populated and can edit them.

#### SuccessCriterion

```typescript
export interface SuccessCriterion {
  readonly id: string;
  readonly description: string;           // "URL changes to /dashboard"
  readonly type: SuccessType;             // 'navigation' | 'elementVisible' | 'elementAbsent' | 'valueEquals' | 'textPresent' | 'custom'
  readonly target: SuccessTarget;         // what to check
  readonly expectedValue: string | null;  // expected value for valueEquals/textPresent
  readonly timeout: number;               // ms — max time for criterion to be met
  readonly source: 'inferred' | 'manual'; // from BehavioralContract.successIndicators or manually added
}

export type SuccessType =
  | 'navigation'    // URL matches pattern
  | 'elementVisible' // element is visible on page
  | 'elementAbsent'  // element is not on page (e.g., error message gone)
  | 'valueEquals'    // element has expected value
  | 'textPresent'    // page or element contains text
  | 'custom';        // free-form description for complex criteria

export interface SuccessTarget {
  readonly kind: 'url' | 'element' | 'page';
  readonly urlPattern: string | null;     // for url kind: glob pattern
  readonly elementLocator: string | null; // for element kind: CSS selector or accessible name
}
```

**How this maps from existing infrastructure:**

`BehavioralContract.successIndicators` from the fragment become inferred `SuccessCriterion` entries:

| SuccessIndicator field | SuccessCriterion field |
|------------------------|---------------------|
| `type: 'navigation'` | `type: 'navigation'`, `target.kind: 'url'` |
| `type: 'valueDisplay'` | `type: 'valueEquals'` or `type: 'elementVisible'` |
| `type: 'visibility'` | `type: 'elementVisible'` |
| `type: 'stateChange'` | `type: 'custom'` (too abstract to auto-map precisely) |
| `signal` | `target.elementLocator` or `description` |
| `description` | `description` |

The reviewer sees inferred criteria and can refine them.

#### CapabilityVersion

```typescript
export interface CapabilityVersion {
  readonly versionId: string;            // `{capabilityId}-v{number}`
  readonly capabilityId: string;
  readonly versionNumber: number;        // 1, 2, 3, ...
  readonly createdAt: string;            // ISO timestamp
  readonly createdBy: string;            // reviewer identity (user email or 'system')
  readonly reviewDecision: ReviewDecision;
  readonly reviewNote: string | null;

  // ── The actual capability data at this version ──
  readonly snapshot: CapabilitySnapshot;
}

export interface CapabilitySnapshot {
  readonly name: string;
  readonly purpose: string;
  readonly inputs: DataRequirement[];
  readonly successCriteria: SuccessCriterion[];
  readonly validationRules: CapabilityValidationRule[];
  readonly observedOutcomes: CapabilityOutcome[];
}

export type ReviewDecision = 'approved' | 'rejected' | 'superseded';
```

#### CapabilityReviewState

```typescript
export type CapabilityReviewState = 'pending' | 'approved' | 'rejected';

export interface CapabilityReview {
  readonly reviewId: string;
  readonly capabilityCandidateId: string;  // links back to the CapabilityCandidate
  readonly sessionId: string;              // links back to the recording session
  readonly matchSuggestion: MatchSuggestionSummary;  // what the matching service suggested
  readonly state: CapabilityReviewState;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly reviewNote: string | null;
  readonly edits: CapabilityReviewEdits;   // reviewer's changes to the derived candidate
  readonly resultCapabilityId: string | null;  // ID of created/enriched capability after approval
  readonly resultVersionId: string | null;     // version ID after approval
}

export interface MatchSuggestionSummary {
  readonly decision: 'auto-merge' | 'ambiguous' | 'new-capability';
  readonly bestMatchId: string | null;
  readonly bestMatchName: string | null;
  readonly bestMatchScore: number | null;
}

export interface CapabilityReviewEdits {
  readonly nameChanged: boolean;
  readonly purposeChanged: boolean;
  readonly inputsEdited: boolean;
  readonly successCriteriaEdited: boolean;
  readonly editedName: string | null;
  readonly editedPurpose: string | null;
  readonly editedInputs: DataRequirement[] | null;
  readonly editedSuccessCriteria: SuccessCriterion[] | null;
}
```

### 3.2 Evolved Types

#### Capability Entity (Extended)

The existing `Capability` interface gains four new fields. All existing fields remain unchanged.

```typescript
export interface Capability {
  // ── Existing fields (unchanged) ──
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly purpose: string;
  readonly confidence: CapabilityConfidence;  // 'candidate' | 'confirmed' | 'established'
  readonly inputs: CapabilityInput[];
  readonly validationRules: CapabilityValidationRule[];
  readonly observedOutcomes: CapabilityOutcome[];
  readonly businessRules: CapabilityBusinessRule[];
  readonly failureModes: CapabilityFailureMode[];
  readonly sessionIds: string[];
  readonly enrichmentHistory: EnrichmentEvent[];
  readonly createdAt: string;
  readonly lastEnrichedAt: string;

  // ── P1 additions ──
  readonly reviewState: CapabilityReviewState;      // 'pending' → 'approved' | 'rejected'
  readonly currentVersion: number;                   // latest approved version number
  readonly dataRequirements: DataRequirement[];      // formal test data specs
  readonly successCriteria: SuccessCriterion[];      // formal pass/fail criteria
}
```

**Invariants:**
- INV-P1-1: `reviewState` starts as `'pending'`. Only transitions to `'approved'` or `'rejected'` via a `CapabilityReview`.
- INV-P1-2: `currentVersion` starts at 0. Increments to 1 on first approval. Increments on each subsequent approved edit.
- INV-P1-3: `dataRequirements` and `successCriteria` are empty until first review. On first approval, they are populated from the inferred values + reviewer edits.
- INV-P1-4: Once `reviewState === 'approved'`, the capability is visible to P2/P3 via the downstream contract.

### 3.3 P2/P3 Downstream Contract

This is the read-only interface that P2 (capability-derived IR) and P3 (AI test generation) consume:

```typescript
export interface P2CapabilityContract {
  readonly capabilityId: string;
  readonly versionNumber: number;
  readonly versionId: string;           // immutable reference
  readonly name: string;
  readonly purpose: string;
  readonly dataRequirements: DataRequirement[];
  readonly successCriteria: SuccessCriterion[];
  readonly entryPoint: {
    readonly url: string;               // starting URL for this capability
    readonly elementName: string | null; // entry element accessible name
  };
  readonly sourceSessionId: string;     // provenance — links to original recording
  readonly approvedAt: string;
}
```

P2 uses `dataRequirements` to generate parameterized execution plans.
P3 uses `dataRequirements` + `successCriteria` to generate test variants with different data and verify outcomes.

The contract is deliberately minimal — it exposes only what P2/P3 need, not the full Capability entity.

---

## §4. Lifecycle Trace — From Recording to Approved Capability

### 4.1 The Full Lifecycle

```
Recording Session
    │
    ▼ ComponentInteraction[] (23 types, with type/subtype/intent/confidence/evidenceTrail)
    │
STOP_RECORDING pipeline
    │
    ├─→ enrichInteraction() → 3-layer enrichment (componentType, framework, businessMeaning)
    ├─→ enrichConfigurationSession() → ConfigurationSession (pattern, fields, commitAction)
    ├─→ enrichSession() → ApplicationKnowledgeFragment
    │       (logicalActions, interactionContracts, behavioralContracts, recordedWorkflow, ...)
    ├─→ deriveCapability(fragment) → CapabilityCandidate
    │       (name, purpose, inputs[], validationRules[], observedOutcome, entryElement)
    ├─→ matchCapability(candidate, existing[]) → CapabilityMatchResult
    │       (scores, bestMatch, decision: auto-merge/ambiguous/new-capability)
    │
    ▼ ══════════════════ P1 REVIEW GATE (NEW) ══════════════════
    │
    │  SessionPersistenceService NO LONGER auto-creates/enriches.
    │  Instead, it creates a CapabilityReview (state='pending') with the
    │  candidate + match suggestion.
    │
    ▼ CapabilityReview { state: 'pending', candidate, matchSuggestion }
    │
    │  ┌─── Side Panel: Capability Review Card ───┐
    │  │ Name: "Login" (derived from submit button)│
    │  │ Match: 0.82 auto-merge with "User Login"  │
    │  │ Inputs: [email, password] (inferred)      │
    │  │ Data Req: [email: required, format=email] │
    │  │ Success: [URL → /dashboard] (inferred)    │
    │  │                                            │
    │  │ [Approve] [Reject] [Edit] [Override Match]│
    │  └────────────────────────────────────────────┘
    │
    ├── Reviewer approves → create/enrich Capability with review metadata
    │       → version 1 created → CapabilityVersion snapshot stored
    │       → reviewState = 'approved'
    │       → P2CapabilityContract published
    │
    ├── Reviewer rejects → reviewState = 'rejected'
    │       → candidate discarded, session still persisted
    │
    ├── Reviewer edits → dataRequirements/successCriteria/name refined
    │       → then approves → version 1 with edited data
    │
    └── Reviewer overrides match → force new capability or merge with different target
            → then approves → version 1 or version N+1
```

### 4.2 What Information Becomes Capability Knowledge

This traces exactly what flows from each pipeline stage into the final approved capability:

| Pipeline Stage | Produces | Flows into Capability? | How |
|---------------|----------|----------------------|-----|
| **EventTap capture** | ObservedEvent (40+ fields) | ❌ No | Too low-level. Aggregated into interactions. |
| **ComponentInteraction** | type, subtype, trigger, metadata | ⚠️ Indirectly | Interactions are aggregated into LogicalActions by the enrichment pipeline. The capability knows "this had an email input field" — not "the user typed j@x.com into an INPUT element at coordinates (340, 220)." |
| **Evidence Engine** | intent, confidence, evidenceTrail | ❌ No | The evidence engine's job is to produce the correct InteractionType. Once classification is done, the trail is not part of capability knowledge. (The confidence IS surfaced in the review UI for the reviewer's benefit, but is not stored in the capability.) |
| **enrichInteraction()** | componentType, componentFramework, businessMeaning | ⚠️ Indirectly | `businessMeaning` influences the derived capability name and purpose. `componentType`/`componentFramework` are not stored in the capability but inform the reviewer's understanding. |
| **enrichConfigurationSession()** | ConfigurationSession (pattern, fields, commitAction) | ⚠️ Indirectly | The `businessField` names from ConfigurationSession become `CapabilityInput` labels, which become `DataRequirement` fields. The pattern (filterApply, multiFieldConfig) is not stored. |
| **ApplicationKnowledgeFragment** | Full knowledge structure | ✅ **Yes — this is the source** | `logicalActions` → inputs, `interactionContracts` → validation rules, `behavioralContracts.successIndicators` → success criteria, `recordedWorkflow.surfaceTransitions` → outcome URL |
| **IR Bridge** | ExecutionIRPlan | ❌ No | The IR plan is execution-specific. P2 will generate NEW plans FROM the capability, not reuse the recording's plan. |
| **Interaction Enrichment** | assertions, locators | ❌ No | Locators are execution-specific, not capability-level. P2 resolves its own locators. |
| **CapabilityCandidate** | name, purpose, inputs, validationRules, observedOutcome | ✅ **Yes — this IS the capability draft** | Directly becomes the reviewed capability after approval. |

**Key insight:** The capability is a **high-level abstraction** that summarizes what the user did and what the application requires — not a replay of individual interactions. A "Login" capability knows it needs an email and password, that success means reaching `/dashboard`, and that both fields are required. It does not know that the user typed "john@example.com" or that the email field was an `<input type="email">` with class `form-control`.

### 4.3 What the Reviewer Sees vs What Is Stored

The review UI surfaces MORE information than is stored in the capability, to help the reviewer make an informed decision:

| Information | Shown in Review UI | Stored in Capability |
|------------|-------------------|---------------------|
| Derived name + purpose | ✅ | ✅ |
| Inferred inputs + validation rules | ✅ | ✅ (as dataRequirements) |
| Inferred success criteria | ✅ | ✅ |
| Match score + suggested decision | ✅ | ❌ (stored in CapabilityReview, not Capability) |
| Interaction list (from recording) | ✅ (collapsible) | ❌ |
| Evidence trail / confidence per interaction | ✅ (for low-confidence interactions) | ❌ |
| ConfigurationSession summary | ✅ (if present) | ❌ |
| Entry element (tag, role, name) | ✅ | ✅ (as entryPoint.elementName in contract) |
| Terminal URL | ✅ | ✅ (as entryPoint.url + successCriterion) |
| Component framework/type (e.g., MUI, DataGrid) | ✅ | ❌ (informative only) |

---

## §5. Concrete Examples

### Example 1: Login

**Recording:** Navigate to `/login` → focus email field → type "john@example.com" → focus password field → type "secret123" → click "Sign In" button → navigate to `/dashboard`

**What the recorder produces (ComponentInteractions):**

| # | Type | Subtype | Intent | Confidence | Key Metadata |
|---|------|---------|--------|------------|--------------|
| 1 | Navigation | — | navigate | 1.0 | url: `/login` |
| 2 | TextEntry | — | input | 1.0 | textValue: "john@example.com", target: email field |
| 3 | TextEntry | — | input | 1.0 | textValue: "secret123", target: password field |
| 4 | Click | — | trigger | 0.3 | target: Sign In button |
| 5 | Navigation | — | navigate | 1.0 | url: `/dashboard` |

**What the enrichment pipeline produces (ApplicationKnowledgeFragment):**
- `logicalActions`: [{ businessField: "email", resultingChange: { field: "value", to: "john@example.com" } }, { businessField: "password", resultingChange: { field: "value", to: "secret123" } }]
- `interactionContracts`: [{ constraints: { required: true, inputType: "email", format: { regex: "^[^@]+@[^@]+$", description: "email" } } }, { constraints: { required: true, lengthRange: { minLength: 8 } } }]
- `behavioralContracts.successIndicators`: [{ type: "navigation", signal: "/dashboard" }]
- `recordedWorkflow.surfaceTransitions`: [{ fromUrl: "/login", toUrl: "/dashboard" }]

**What deriveCapability() produces (CapabilityCandidate):**
```
name: "Sign In"              (from submit button keyword match)
purpose: "Sign In workflow with 1 page transition"
confidence: "candidate"
entryElement: { tag: "BUTTON", accessibleName: "Sign In" }
inputs: [
  { label: "email", required: true, inputType: "email", format: { regex: "^[^@]+@[^@]+$" } },
  { label: "password", required: true, lengthRange: { minLength: 8 } }
]
validationRules: [
  { field: "email", type: "required", constraint: "true" },
  { field: "email", type: "format", constraint: "^[^@]+@[^@]+$" },
  { field: "password", type: "required", constraint: "true" },
  { field: "password", type: "length", constraint: "minLength: 8" }
]
observedOutcome: { terminalUrl: "/dashboard", successSignals: ["navigation"], completed: true }
```

**What the reviewer sees and what they can edit:**

Review card shows:
- **Name:** "Sign In" (editable — reviewer might change to "User Login")
- **Match:** 0.42 → `new-capability` (first time recording this)
- **Inferred Data Requirements:**
  - `email`: required, email format
  - `password`: required, min 8 chars
- **Inferred Success Criteria:**
  - URL changes to `/dashboard`

Reviewer approves as-is (or edits name to "Login").

**Approved Capability (version 1):**
```
id: "cap-session-abc123"
name: "Login"
reviewState: "approved"
currentVersion: 1
dataRequirements: [
  { field: "email", label: "Email Address", kind: "email", required: true,
    constraints: { pattern: "^[^@]+@[^@]+$", formatDescription: "Valid email address" },
    defaultValue: null, source: "inferred" },
  { field: "password", label: "Password", kind: "text", required: true,
    constraints: { minLength: 8 },
    defaultValue: null, source: "inferred" }
]
successCriteria: [
  { type: "navigation", target: { kind: "url", urlPattern: "*/dashboard*" },
    timeout: 5000, source: "inferred" }
]
```

**P2CapabilityContract (what P2/P3 receive):**
```
capabilityId: "cap-session-abc123"
versionNumber: 1
name: "Login"
dataRequirements: [email, password]
successCriteria: [navigation to /dashboard]
entryPoint: { url: "/login", elementName: "Sign In" }
```

### Example 2: Filter Products

**Recording:** Navigate to `/shop` → click custom dropdown trigger `<div class="filter-trigger">` → option click "Electronics" → toggle div-checkbox for "On Sale" (class changes to `active`) → drag custom slider handle to 75% → click "Apply Filters" → page reloads with `/shop?cat=electronics&sale=true&max=75`

**ComponentInteractions:**
| # | Type | Subtype | Intent | Confidence | Notes |
|---|------|---------|--------|------------|-------|
| 1 | Navigation | — | navigate | 1.0 | |
| 2 | Dropdown | CustomDropdown | select | 1.0 | Framework detection or surface binding |
| 3 | Checkbox | — | toggle | 0.5 | R3 behavioral reclassification from Click (class `active` transition) |
| 4 | CustomSlider | — | input | 1.0 | R2 geometry-based value extraction |
| 5 | Click | — | trigger | 0.3 | "Apply Filters" button |
| 6 | Navigation | — | navigate | 1.0 | URL with query params |

**CapabilityCandidate:**
```
name: "Apply Filters"         (from submit button keyword "apply")
inputs: [
  { label: "category", required: false, validOptions: ["electronics", ...] },
  { label: "onSale", required: false },        // from toggle
  { label: "maxPrice", required: false, valueRange: { min: 0, max: 100, step: 1 } }
]
observedOutcome: { terminalUrl: "/shop?cat=electronics&sale=true&max=75", completed: true }
```

**Inferred Data Requirements:**
- `category`: select, options: ["electronics", ...]
- `onSale`: boolean
- `maxPrice`: number, range 0-100

**Inferred Success Criteria:**
- URL contains query parameters after Apply

### Example 3: Checkout (Multi-Step)

**Recording:** Click "Checkout" → modal opens → fill shipping name/address/city/zip → click "Continue to Payment" → fill card number/expiry/CVC → click "Place Order" → navigate to `/order-confirmation/12345`

**ComponentInteractions:**
| # | Type | Subtype | Intent | Confidence | Notes |
|---|------|---------|--------|------------|-------|
| 1 | ModalDialog | — | trigger | 1.0 | subActions: fillInput × 4 |
| 2 | Navigation | — | navigate | 1.0 | Within modal |
| 3 | ModalDialog | — | trigger | 1.0 | subActions: fillInput × 3, confirm |
| 4 | Navigation | — | navigate | 1.0 | `/order-confirmation/12345` |

**CapabilityCandidate:**
```
name: "Place Order"           (from submit button keyword)
inputs: [
  { label: "fullName", required: true },
  { label: "address", required: true },
  { label: "city", required: true },
  { label: "zipCode", required: true, format: { regex: "^\\d{5}$" } },
  { label: "cardNumber", required: true, format: { regex: "^\\d{16}$" } },
  { label: "expiry", required: true, format: { regex: "^\\d{2}/\\d{2}$" } },
  { label: "cvc", required: true, format: { regex: "^\\d{3}$" }, lengthRange: { minLength: 3, maxLength: 3 } }
]
observedOutcome: { terminalUrl: "/order-confirmation/*", completed: true }
```

This capability has 7 data requirements. The reviewer would likely add default test values (e.g., `cardNumber` defaultValue: "4111111111111111") and mark the success criterion as URL pattern `/order-confirmation/*`.

### Example 4: Search

**Recording:** Focus search input → type "wireless headphones" → press Enter (or click Search) → page shows results

**CapabilityCandidate:**
```
name: "Search"
inputs: [{ label: "query", required: true }]
observedOutcome: { terminalUrl: "/search?q=wireless+headphones", completed: true }
```

Simple capability — one data requirement, one success criterion.

### Example 5: Form Submission (Generic)

**Recording:** Click "Add Employee" → fill name/email/department(dropdown)/role(dropdown) → click "Save" → see "Employee created" toast

**CapabilityCandidate:**
```
name: "Save"                  (from submit button keyword)
inputs: [
  { label: "name", required: true },
  { label: "email", required: true, format: email },
  { label: "department", required: true, validOptions: ["Engineering", "Sales", ...] },
  { label: "role", required: true, validOptions: ["Admin", "Manager", "Member"] }
]
observedOutcome: { terminalUrl: "/employees", successSignals: ["visibility: Employee created toast"], completed: true }
```

Reviewer would rename to "Add Employee" and add a success criterion for the toast message.

---

## §6. Review Workflow

### 6.1 When Review Happens

Review happens **after recording stops** and the pipeline has completed. The side panel `stopped` view shows the capability review card alongside the existing interaction timeline and generated code.

The reviewer can act immediately or defer. Deferred reviews persist as `state: 'pending'` and appear in the capability inventory with a "Pending Review" badge.

### 6.2 Review Actions

| Action | What Happens | Capability Effect |
|--------|-------------|-------------------|
| **Approve** | Candidate becomes an official capability (new or enriched) | `reviewState → 'approved'`, `currentVersion → 1` (new) or increments (enriched), `CapabilityVersion` snapshot created, `P2CapabilityContract` published |
| **Reject** | Candidate is discarded | `reviewState → 'rejected'`, no capability created/enriched, session still persisted |
| **Edit then Approve** | Reviewer modifies name/purpose/dataRequirements/successCriteria, then approves | Same as Approve, but with edited values. Edits recorded in `CapabilityReviewEdits`. |
| **Override Match** | Reviewer disagrees with matching suggestion (e.g., force new when service said auto-merge, or merge with a different capability) | Reviewer selects target capability from inventory, then approves into that one |

### 6.3 Review Flow Diagram

```
Recording stops
    │
    ▼
Pipeline runs → CapabilityCandidate + matchSuggestion
    │
    ▼
SessionPersistenceService creates CapabilityReview (state='pending')
    │
    ├── Does NOT create/enrich Capability yet
    ├── Stores review in Dexie (CapabilityReviewStore)
    ├── Updates side panel via storage change event
    │
    ▼
Side panel shows review card
    │
    ├── Reviewer reviews inferred data requirements + success criteria
    ├── Reviewer optionally edits fields
    ├── Reviewer selects action: Approve / Reject / Override Match
    │
    ▼
CapabilityReviewService.processDecision(reviewId, decision, edits)
    │
    ├── If Approve (new capability):
    │     createCapability(input + review metadata)
    │     → CapabilityVersion v1 created
    │     → reviewState = 'approved'
    │
    ├── If Approve (auto-merge / enrich existing):
    │     enrichCapability(existing, input + review metadata)
    │     → CapabilityVersion v(N+1) created
    │     → confidence may upgrade (candidate→confirmed at 2+ sessions)
    │
    ├── If Reject:
    │     → reviewState = 'rejected'
    │     → candidate discarded
    │
    └── If Override Match:
          → reviewer-selected target replaces match suggestion
          → follows Approve flow with corrected target
```

### 6.4 Deferred Reviews

If the reviewer closes the side panel without acting, the review persists as `pending`. A badge on the capability inventory view shows the count of pending reviews. The reviewer can open the review later from the inventory.

---

## §7. Versioning Rules

### 7.1 When Versions Are Created

| Event | Version Effect |
|-------|---------------|
| First approval of a new capability | Version 1 created |
| Approval of an auto-merge (enriching existing) | Version N+1 created |
| Reviewer edits an already-approved capability | Version N+1 created (the edit goes through the same review flow) |
| Rejecting a candidate | No version effect |

### 7.2 Version Immutability

Each `CapabilityVersion` is an immutable snapshot. Once created, it never changes. The `CapabilitySnapshot` inside contains the exact data at the time of approval.

### 7.3 Version History

A capability's version history is the list of all `CapabilityVersion` entries for that `capabilityId`, ordered by `versionNumber`. The full history is available in the capability inventory UI.

### 7.4 P2/P3 Version Reference

P2 and P3 always reference a specific `versionId`. This ensures that test plans generated from a capability are reproducible — even if the capability is later edited, the test plan was generated from a specific version and can be re-executed against that version's data requirements and success criteria.

---

## §8. Persistence and Storage

### 8.1 New Storage Keys (chrome.storage.local)

| Key | Value | Purpose |
|-----|-------|---------|
| `PENDING_CAPABILITY_REVIEW` | `CapabilityReview` | The current pending review (shown in side panel) |
| `CAPABILITY_INVENTORY` | `P2CapabilityContract[]` | All approved capabilities for the current project (for browsing) |

### 8.2 New Dexie Tables (IndexedDB)

| Table | Schema | Purpose |
|-------|--------|---------|
| `capabilityReviews` | `reviewId, capabilityCandidateId, sessionId, state, reviewedAt` | Review state persistence |
| `capabilityVersions` | `versionId, capabilityId, versionNumber, createdAt` | Version snapshots |

The existing `capabilities` table (from `dexie-capability-repository.ts`) is extended with the new fields. No migration needed — Dexie handles additive schema changes.

### 8.3 Session Persistence Service Changes

`persistSession()` in `session-persistence-service.ts` is modified:

**Current behavior:**
```
1. Match candidate against existing capabilities
2. If auto-merge → enrichCapability() → update
3. If new → createCapability() → create
4. If ambiguous → do nothing
5. Return { sessionId, capabilityId, decision }
```

**P1 behavior:**
```
1. Match candidate against existing capabilities (unchanged)
2. Create CapabilityReview with match suggestion
3. Store CapabilityReview in Dexie
4. Store CapabilityCandidate in chrome.storage.local (for side panel)
5. Do NOT create/enrich capability — wait for review
6. Return { sessionId, reviewId, capabilityDecision: matchSuggestion.decision }
```

The create/enrich logic moves to `CapabilityReviewService.processDecision()`, called when the reviewer acts.

---

## §9. UI Behavior

### 9.1 Side Panel Views (Extended)

The existing 4-view architecture is preserved. P1 adds content within the `stopped` view and adds a new `capabilities` view accessible from the home view.

#### `stopped` view — Capability Review Section (NEW)

After the existing sections (detected interactions, IR plan, generated files), a new section appears:

```
┌─ Capability Review ────────────────────────────┐
│                                                 │
│  Name:    [Login                    ]  ✏️       │
│  Purpose: [Sign In workflow with... ]  ✏️       │
│                                                 │
│  Match Suggestion: new-capability (score: 0.42) │
│                                                 │
│  ── Data Requirements (inferred) ──             │
│  ┌─────────────────────────────────────────┐    │
│  │ email    | email    | required | format │    │
│  │ password | text     | required | min 8  │    │
│  └─────────────────────────────────────────┘    │
│  [+ Add Requirement]                            │
│                                                 │
│  ── Success Criteria (inferred) ──              │
│  ┌─────────────────────────────────────────┐    │
│  │ ✓ URL changes to /dashboard (5000ms)    │    │
│  └─────────────────────────────────────────┘    │
│  [+ Add Criterion]                              │
│                                                 │
│  ── Recording Evidence ──                       │
│  ▸ 5 interactions (click to expand)             │
│    ┌──────────────────────────────────────┐     │
│    │ #1 Navigation → /login        1.0    │     │
│    │ #2 TextEntry "john@x.com"     1.0    │     │
│    │ #3 TextEntry "••••"           1.0    │     │
│    │ #4 Click "Sign In"            0.3    │     │
│    │ #5 Navigation → /dashboard    1.0    │     │
│    └──────────────────────────────────────┘     │
│                                                 │
│  [Approve]  [Reject]  [Override Match]          │
│                                                 │
└─────────────────────────────────────────────────┘
```

The "Recording Evidence" section shows the actual ComponentInteractions from the session, with their type/subtype/confidence. This lets the reviewer verify the inferred data requirements against what was actually recorded. **This is display-only — P1 does not re-classify or edit interactions.**

Low-confidence interactions (confidence < 0.5) are highlighted to draw the reviewer's attention to cases where the recorder was uncertain.

#### New `capabilities` view — Capability Inventory

Accessible from the home view via a "Browse Capabilities" button:

```
┌─ Capabilities — Project: E-Commerce ───────────┐
│                                                 │
│  Search: [                    ]                  │
│                                                 │
│  ┌─ Pending Reviews (2) ────────────────────┐   │
│  │ ⏳ Login        | 5 interactions | 2h ago │   │
│  │ ⏳ Add to Cart  | 3 interactions | 1d ago │   │
│  └───────────────────────────────────────────┘   │
│                                                 │
│  ┌─ Approved Capabilities (4) ──────────────┐   │
│  │ ✅ Search       | v2 | 3 versions        │   │
│  │ ✅ Checkout     | v1 | 1 version         │   │
│  │ ✅ Filter       | v3 | 3 versions        │   │
│  │ ✅ Registration | v1 | 1 version         │   │
│  └───────────────────────────────────────────┘   │
│                                                 │
│  Click a capability to view details, versions,  │
│  and data requirements.                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

Clicking an approved capability shows its current version details, version history, data requirements, and success criteria.

Clicking a pending review opens the review card (same as in the `stopped` view).

---

## §10. P1/P2/P3 Boundaries

### 10.1 What P1 Produces for P2

P2 (Capability-derived IR Generation) consumes `P2CapabilityContract`:

```
P2CapabilityContract {
  capabilityId, versionNumber, versionId,
  name, purpose,
  dataRequirements: DataRequirement[],
  successCriteria: SuccessCriterion[],
  entryPoint: { url, elementName },
  sourceSessionId,
  approvedAt
}
```

P2 generates parameterized execution plans from this. For example, given the Login capability:
- P2 generates an execution plan that fills the email and password fields
- The plan uses data requirements to know which fields to fill and what constraints they have
- The plan uses success criteria to generate assertion steps

**P1 does NOT generate execution plans.** P1 only produces the capability contract. P2 reads it.

### 10.2 What P1 Produces for P3

P3 (AI Test Generation) consumes the same `P2CapabilityContract` plus the original recording session's `ExecutionIRArtifact` (already persisted by the pipeline). P3 generates test variants:
- Different data combinations (valid email + valid password, invalid email + valid password, etc.)
- Boundary cases (min/max password length)
- Optional fields (category filter present/absent)

**P1 does NOT generate test variants.** P1 only produces the capability contract with formal data requirements. P3 reads it.

### 10.3 What P1 Does NOT Depend On

- P1 does NOT depend on P4 (Enhanced Execution). Capability management is independent of execution reliability.
- P1 does NOT depend on P5 (Headless Execution). Capabilities are defined before they're executed.
- P1 does NOT depend on P2 or P3. P1 produces the substrate; P2/P3 consume it.

### 10.4 Boundary Invariants

| Invariant | Description |
|-----------|-------------|
| INV-P1-B1 | P1 never calls `ir-bridge.build()` or any code generator. IR generation is P2. |
| INV-P1-B2 | P1 never calls `annotateWithEvidence()` or any evidence engine function. Classification is the recorder's job. |
| INV-P1-B3 | P1 never modifies `ComponentInteraction` objects. They are read-only input. |
| INV-P1-B4 | P2/P3 never read `CapabilityCandidate` directly. They read `P2CapabilityContract` (the approved version). |
| INV-P1-B5 | The `SessionPersistenceService` change (defer to review) is the only modification to existing pipeline code. |

---

## §11. Implementation Plan

### Step 1: New Types

**Files to create:**
- `src/domain/entities/data-requirement.ts` — `DataRequirement`, `DataKind`, `DataConstraint`
- `src/domain/entities/success-criterion.ts` — `SuccessCriterion`, `SuccessType`, `SuccessTarget`
- `src/domain/entities/capability-version.ts` — `CapabilityVersion`, `CapabilitySnapshot`
- `src/domain/entities/capability-review.ts` — `CapabilityReview`, `CapabilityReviewState`, `CapabilityReviewEdits`, `MatchSuggestionSummary`
- `src/domain/entities/p2-capability-contract.ts` — `P2CapabilityContract`

**Files to modify:**
- `src/domain/entities/capability.ts` — add `reviewState`, `currentVersion`, `dataRequirements`, `successCriteria` fields; update `createCapability()` and `enrichCapability()` signatures

**Gate G1:** `tsc --noEmit` — 0 src errors. Unit tests for new type factories.

### Step 2: Mapping Functions

**Files to create:**
- `src/domain/mappings/capability-mappers.ts` — functions to map between types:
  - `candidateToDataRequirements(inputs: CapabilityInput[]): DataRequirement[]`
  - `successIndicatorsToCriteria(indicators: SuccessIndicator[]): SuccessCriterion[]`
  - `capabilityToContract(capability: Capability): P2CapabilityContract`
  - `capabilityToVersion(capability: Capability, review: CapabilityReview): CapabilityVersion`

**Gate G2:** Unit tests verify mapping correctness against the 5 example scenarios.

### Step 3: CapabilityReviewService

**Files to create:**
- `src/domain/services/capability-review-service.ts`

**Functions:**
```typescript
export function createReview(
  candidate: CapabilityCandidate,
  matchResult: CapabilityMatchResult,
  sessionId: string,
): CapabilityReview;

export function processDecision(
  review: CapabilityReview,
  decision: 'approve' | 'reject',
  edits: CapabilityReviewEdits,
  reviewer: string,
  existingCapability: Capability | null,
): { capability: Capability; version: CapabilityVersion; contract: P2CapabilityContract };
```

**Gate G3:** Unit tests for all review flows (approve new, approve merge, reject, override match).

### Step 4: Dexie Persistence

**Files to modify:**
- `src/repository/v2/dexie/dexie-capability-repository.ts` — add `getByVersion()`, `listVersions()`, `findByReviewState()`
- Create `src/repository/v2/dexie/dexie-capability-review-repository.ts` — CRUD for reviews
- Create `src/repository/v2/dexie/dexie-capability-version-repository.ts` — CRUD for versions

**Gate G4:** Integration tests against Dexie (in-memory).

### Step 5: SessionPersistenceService Modification

**File to modify:**
- `src/repository/services/session-persistence-service.ts`

Change `persistSession()` to create a `CapabilityReview` instead of auto-creating/enriching. The matching logic remains; only the action taken on the match result changes.

**Gate G5:** Integration tests verify:
- `persistSession()` no longer creates capabilities automatically
- It creates a `CapabilityReview` with the match suggestion
- The review is persisted in Dexie
- The candidate is stored for the side panel

### Step 6: Storage Keys and Side Panel State

**Files to modify:**
- `src/shared/types.ts` — add `PENDING_CAPABILITY_REVIEW`, `CAPABILITY_INVENTORY` to `StorageKeys` enum
- `src/storage/storage-service.ts` — add typed accessors

**Gate G6:** Side panel can read/write the new keys.

### Step 7: Side Panel — Capability Review UI

**Files to modify:**
- `src/sidepanel/sidepanel.ts` — add capability review section to `stopped` view
- Create `src/sidepanel/components/capability-review-card.ts` — review card component
- Create `src/sidepanel/components/data-requirement-editor.ts` — data requirement form
- Create `src/sidepanel/components/success-criterion-editor.ts` — success criterion form

**Gate G7:** Manual verification — review card appears after recording, shows inferred data, supports approve/reject/edit.

### Step 8: Side Panel — Capability Inventory UI

**Files to modify/create:**
- `src/sidepanel/sidepanel.ts` — add `capabilities` view
- Create `src/sidepanel/components/capability-inventory.ts` — inventory list
- Create `src/sidepanel/components/capability-detail.ts` — detail view

**Gate G8:** Manual verification — inventory shows approved + pending capabilities, detail view shows versions.

### Step 9: P2CapabilityContract Publishing

When a capability is approved, the `P2CapabilityContract` is computed and stored in `CAPABILITY_INVENTORY` (which holds the list of all approved contracts for the project).

**Gate G9:** Contract contains all required fields, version is correct.

---

## §12. Validation Strategy

### 12.1 Test Categories

| Category | Tests | Focus |
|----------|-------|-------|
| Type correctness | ~15 | All new types instantiate correctly, immutability holds |
| Mapping correctness | ~12 | `CapabilityInput → DataRequirement`, `SuccessIndicator → SuccessCriterion`, `Capability → P2CapabilityContract` |
| Review workflow | ~20 | createReview, processDecision (approve/reject/override), deferred reviews |
| Versioning | ~10 | version creation, immutability, history, version-specific contract |
| Persistence | ~10 | Dexie CRUD for reviews, versions; SessionPersistenceService modification |
| Integration | ~8 | Full pipeline: recording → pipeline → review → approval → contract |
| Regression | existing | All existing tests pass unchanged (except SessionPersistenceService tests, which are updated to expect deferred behavior) |

### 12.2 Regression Gates

| Gate | Check | Threshold |
|------|-------|-----------|
| G1 | `tsc --noEmit` | 0 src errors |
| G2 | Golden master | 142/142 unchanged |
| G3 | Domain adapter | 38/38 unchanged |
| G4 | Full test suite | ≤ 2 flaky failures (pre-existing) |
| G5 | E2E pipeline | 15/15 unchanged |
| G6 | R2 slider gates | 16/16 unchanged |
| G7 | R3 behavioral gates | 26/26 unchanged |
| G8 | EC22 flush gates | 3/3 unchanged |
| G9 | P1 type/review/version tests | All new tests pass |
| G10 | SessionPersistenceService | Updated tests pass (deferred behavior) |

### 12.3 Exit Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| EC1 | `DataRequirement` type exists and maps from `CapabilityInput` | Code inspection + unit tests |
| EC2 | `SuccessCriterion` type exists and maps from `SuccessIndicator` | Code inspection + unit tests |
| EC3 | `CapabilityVersion` type exists and is immutable | Unit tests — version snapshot never mutates |
| EC4 | `CapabilityReview` workflow supports approve/reject/edit/override | Unit tests for all 4 paths |
| EC5 | `SessionPersistenceService` defers to review instead of auto-creating | Integration test — no capability created until review approved |
| EC6 | Side panel shows capability review card after recording | Manual / browser test |
| EC7 | Side panel shows capability inventory | Manual / browser test |
| EC8 | `P2CapabilityContract` produced on approval | Unit test — contract fields correct |
| EC9 | All existing tests pass (≤ 2 flaky exceptions) | Test run |
| EC10 | All R1-R3 regression gates pass | Test run |
| EC11 | Version history preserved across capability edits | Integration test |
| EC12 | Pending reviews persist across side panel close/reopen | Integration test |

---

## §13. Limitations and Deferred Items

### Explicitly OUT of P1 Scope

| Item | Where It Goes | Why Deferred |
|------|--------------|-------------|
| AI-powered data requirement suggestion (e.g., "this looks like a credit card field, suggest test card numbers") | P3 (AI Test Generation) | P1 uses inference + manual edit. AI enhancement is P3. |
| Capability dependency graph (e.g., "Checkout depends on Login") | Future phase | No infrastructure needs this yet. |
| Capability export/import (JSON, YAML) | Future phase | Useful but not blocking P2/P3. |
| Capability-level test execution | P4/P5 | Execution is separate from definition. |
| Multi-user review collaboration | Future phase | Chrome extension is single-user. |
| Recorder calibration from review feedback | Separate workstream | Per phase boundary agreement — review findings are captured separately. |

### Recorder Interface Stability

P1 depends on these recorder outputs remaining stable (they are frozen contracts post-R3):
- `ComponentInteraction` type and its fields
- `ApplicationKnowledgeFragment` and all sub-types
- `CapabilityCandidate` type
- `CapabilityMatchResult` type
- `deriveCapability()` function signature
- `matchCapability()` function signature
- `enrichSession()` pipeline output

If any of these change, P1's mapping functions must be updated. But P1 itself never modifies the recorder pipeline.

---

## §14. Design Principles

1. **P1 consumes, never re-interprets.** The recorder's classification is authoritative. P1 surfaces it for review but does not override it.

2. **Human judgment is the final classifier.** Auto-merge suggestions are helpful, but a human approves every capability. The auto-merge threshold (0.75) is a suggestion, not a decision.

3. **Capabilities are abstractions, not replays.** A capability knows "this requires an email and password" — not "the user typed john@x.com into a form-control input at 14:32 UTC."

4. **Versions are immutable.** Once approved, a capability version never changes. Edits create new versions. P2/P3 reference specific versions for reproducibility.

5. **Additive, not destructive.** P1 extends existing types and services. Nothing in the existing capability infrastructure is removed. The SessionPersistenceService change is the only behavioral modification to existing code.

6. **The review UI surfaces recorder output transparently.** When the reviewer sees low confidence or unrecognized flags, they see the recorder's honest assessment — not a reclassification by the platform layer.
