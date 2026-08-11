# Capability Model Architecture Audit — deff878 Baseline

## Executive Summary

The codebase contains **two disconnected capability systems**, neither of which fully represents an Application Knowledge Model:

1. **Runtime Capability Engine** (`src/capabilities/`) — classifies each interaction into one of 12 categories. Produces `CapabilityRecord[]` that display in the side panel. This is functional and tested.
2. **Domain Capability Entity** (`src/domain/entities/capability.ts`) + **CapabilityCandidate** + **CapabilityMatchingService** + **SessionPersistenceService** — a rich cross-session capability accumulation model. This exists as code but is **never activated**: the service worker passes `capability: null` to `persistSession()`.

Neither system is connected to the other. Neither produces an Application Knowledge Model in the product-goal sense.

---

## 1. Current Capability Model Architecture

### Two Parallel Systems

**System A: Runtime Capability Inference** (ACTIVE, functional)
- Location: `src/capabilities/`
- Input: `ComponentInteraction[]` + behavioral observation effects
- Output: `CapabilityRecord[]` (12-type classification per interaction)
- Persistence: `chrome.storage.local` → side panel display
- Triggered: `handleStopRecording()` in service-worker.ts line 298
- Lifecycle: Ephemeral — per-recording, overwrites previous results

**System B: Domain Capability Accumulation** (INACTIVE, dead path)
- Location: `src/domain/entities/`, `src/repository/services/`
- Input: `UnderstandingResult` containing `CapabilityCandidate` + `ApplicationKnowledgeFragment`
- Output: Persistent `Capability` entity in IndexedDB, enriched across sessions
- Triggered: `persistSession()` in session-persistence-service.ts
- **CRITICAL: Always called with `understanding.capability = null` and `understanding.fragment = null`**

### The Dead Connection (service-worker.ts lines 340-364)

```typescript
// ACTUAL CODE at deff878:
const persistenceResult = await persistSession(uowFactory, {
  understanding: {
    sessionId: `session-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    fragment: null,       // ← ALWAYS NULL
    capability: null,     // ← ALWAYS NULL
  },
  events: [],             // ← ALWAYS EMPTY
  interactions: productionInteractions,
  // ...
});
```

The `persistSession` function receives `capability: null`, so it skips all capability matching/creation/enrichment (line 111: `if (candidate) { ... }`). The entire `CapabilityMatchingService`, `candidateToCreateInput`, `candidateToEnrichInput`, `createCapability`, `enrichCapability` pipeline **never executes**.

Similarly, `fragment: null` means `ApplicationKnowledgeFragment` — the structured UI Knowledge Model with UiElements, ObservedTransitions, ComponentGroupings, InteractionContracts, BehavioralContracts, LogicalActions, RecordedWorkflow — is **never produced**.

No code anywhere in the repository builds an `ApplicationKnowledgeFragment` or a `CapabilityCandidate`.

---

## 2. Actual Data Model

### System A: CapabilityRecord (what actually works)

```typescript
CapabilityRecord = {
  capabilityId: `cap-${interactionId}`,
  interactionId: string,
  capability: CapabilityType,  // 12 categories + Unclassified
  confidence: 'high' | 'medium' | 'low',
  parameters: { target?, scope?, value? },
  evidence: {
    physicalType: InteractionType,
    targetLabel: string,
    semanticEffects: string[],
    matchedKeywords: string[],
    structuralContext: string[],
    sequenceNotes: string[],
  },
  alternatives: CapabilityAlternative[],
  unclassifiedReason?: string,
}
```

This is a **per-interaction label**. It answers "what category does this click/keypress fall into?" — not "what can this application do?"

### System B: Capability Entity (designed but unused)

```typescript
Capability = {
  id, projectId,
  name: string,                    // e.g., "Login"
  purpose: string,                 // e.g., "Authenticate user"
  confidence: 'candidate'|'confirmed'|'established',
  inputs: CapabilityInput[],       // {label, fieldType, required, validationConstraints}
  validationRules: CapabilityValidationRule[],
  observedOutcomes: CapabilityOutcome[],  // {terminalUrl, successIndicators, description}
  businessRules: CapabilityBusinessRule[],
  failureModes: CapabilityFailureMode[],
  sessionIds: string[],
  enrichmentHistory: EnrichmentEvent[],
  createdAt, lastEnrichedAt,
}
```

This is the **target product design** — a business capability with inputs, validation, outcomes, failure modes, and business rules. But it has no code that feeds it.

---

## 3. All 12 Capability Rules (System A)

Each rule examines one interaction and returns a claim. Here is what each actually detects:

### Rule 1: ToggleControl (priority 20)
- **Detects:** Checkbox/radio toggling
- **Required evidence:** `hasStateToggle` semantic effect (checked/ariaChecked/ariaPressed changed)
- **Supporting signals:** keyword (enable/disable/on/off), Checkbox/RadioButton physical type
- **Example:** User checks "Subscribe to newsletter" → ToggleControl (high)
- **Represents:** UI interaction pattern, not application capability

### Rule 2: ExpandCollapse (priority 20)
- **Detects:** Expand/collapse UI operations
- **Required evidence:** `hasExpandCollapse` semantic effect (ariaExpanded changed)
- **Example:** Click "Show details" → ExpandCollapse (high)
- **Represents:** UI interaction pattern

### Rule 3: UploadFile (priority 10)
- **Detects:** File upload
- **Required evidence:** `isFileInput` (INPUT[type=file])
- **Always HIGH confidence when it fires**
- **Example:** Upload profile photo → UploadFile (high)
- **Represents:** Closest to a real application capability among all rules

### Rule 4: Navigate (priority 30)
- **Detects:** Page-to-page navigation
- **Required evidence:** `urlPathChangedAfter` (URL path changed after this interaction)
- **Supporting:** keyword (home/back/next), Link/Click physical type
- **Example:** Click "Home" link → Navigate (medium)
- **Represents:** Navigation event, not business capability

### Rule 5: OpenDetail (priority 10)
- **Detects:** Opening a detail/product page
- **Required evidence:** URL path changed + next URL is item-specific (contains /dp/, /product/, /item/, UUID pattern), OR trigger element has item-specific href
- **Example:** Click product link with href="/dp/B08XXXX" → OpenDetail (high)
- **Represents:** Application-specific pattern (hardcoded URL patterns for e-commerce)

### Rule 6: Paginate (priority 15)
- **Detects:** Pagination
- **Required evidence:** Pagination keyword (next page/load more/«/»/page 2) + NO URL change
- **Supporting:** content-change effect, netNodeDelta > 0
- **Example:** Click "Next Page" → Paginate (medium)
- **Represents:** UI interaction pattern

### Rule 7: FilterSelection (priority 35)
- **Detects:** Filtering content
- **Required evidence:** Remote content-change/visibility-change + ≥1 filter signal (keyword filter/refine/brand/category, ancestor context, strongly negative netNodeDelta)
- **Example:** Click "Sony" brand filter → FilterSelection (medium)
- **Represents:** Semi-application capability — recognizes filtering behavior

### Rule 8: SortSelection (priority 40)
- **Detects:** Sorting content
- **Required evidence:** Remote content-change + ≥1 sort signal (keyword sort/order/price/relevance, or Dropdown physical type)
- **Example:** Select "Price: Low to High" from sort dropdown → SortSelection (medium)
- **Represents:** Semi-application capability

### Rule 9: Search (priority 25)
- **Detects:** Search box usage
- **Required evidence:** TextEntry type + ≥1 search signal (keyword search/find/query, OR content-change/navigation follows the text entry)
- **Example:** Type "laptops" in search box → Search (medium)
- **Represents:** Semi-application capability

### Rule 10: SubmitForm (priority 15)
- **Detects:** Form submission
- **Required evidence:** Click on submit-type element (type=submit, role=button with submit keyword) + preceded by TextEntry on same page
- **Supporting:** keyword (submit/sign in/login/register), urlChangedAfter
- **Example:** Click "Sign In" after entering email+password → SubmitForm (high)
- **Represents:** Closest to a real application capability — recognizes form submission

### Rule 11: SelectOption (priority 50)
- **Detects:** Generic dropdown selection (residual — only if no higher rule claimed)
- **Required evidence:** Dropdown type + no higher rule claimed above LOW
- **Example:** Select quantity "2" from dropdown → SelectOption (low)
- **Represents:** UI interaction pattern

### Rule 12: AdjustValue (priority 10)
- **Detects:** Slider/spinbutton value adjustment
- **Required evidence:** `isSliderLike` + `userAdjusted`
- **Supporting:** keyword (price/range/quantity), content-change
- **Example:** Drag price slider to $500 → AdjustValue (high)
- **Represents:** UI interaction pattern

### What the 12 rules collectively represent

The 12 rules produce **UI interaction classifications**. They answer "what type of UI thing did the user just do?" The vocabulary (FilterSelection, SortSelection, Search, SubmitForm, etc.) is borrowed from e-commerce patterns and is not generic enough to describe arbitrary application workflows.

---

## 4. End-to-End Data Flow

### Active Flow (System A — what actually runs)

```
User records a workflow
       ↓
EventTap captures DOM events → ObservedEvent[]
       ↓
Content Script → chrome.runtime.sendMessage → Service Worker
       ↓
ComponentRuntime classifies events → ComponentInteraction[]
  (14 definitions, priority-ordered matching)
       ↓
Enrichment adds componentType + businessMeaning (string label)
       ↓
[Behavioral observations attached per-interaction IF click/change]
       ↓
handleStopRecording():
  normalizeWorkflow() — remove subsumed Unclassified
  filterProductionInteractions() — remove noise
       ↓
runCapabilityInference(productionInteractions):
  For EACH interaction:
    extractEvidence() — gather physical + behavioral + sequence + keyword signals
    Run 12 rules → collect claims
    resolveClaims() — pick best claim by confidence, then priority
    buildRecord() — CapabilityRecord
       ↓
serializeCapabilityRecords() → chrome.storage.local
       ↓
Side panel renders CapabilityRecord[] (icons + labels + confidence)
       ↓
IR Bridge: compileToIR(productionInteractions) → ExecutionIRPlan
  (NO GenerationEnrichment passed — enrichment field omitted)
       ↓
Playwright code generated from IR plan
```

### Dead Flow (System B — code exists, never executes)

```
[NEVER PRODUCED: ApplicationKnowledgeFragment]
[NEVER PRODUCED: CapabilityCandidate]
       ↓
UnderstandingResult { fragment: null, capability: null }
       ↓
persistSession() receives capability: null
       ↓
if (candidate) { ... }  ← SKIPPED (candidate is always null)
  CapabilityMatchingService.matchCapability()  ← NEVER CALLED
  createCapability() or enrichCapability()  ← NEVER CALLED
       ↓
Capability table in IndexedDB: EMPTY
```

---

## 5. Real Examples from Tests

### Amazon Workflow (phase7-realworld-validation.test.ts)

| User Action | ComponentInteraction Type | CapabilityRecord | Accurate? |
|---|---|---|---|
| Type "laptops" in search | TextEntry | **Search** (medium) | ✅ Recognized |
| Click "Sony" brand filter | Link | **FilterSelection** (medium) | ✅ Recognized |
| Select "Price: Low to High" sort | Dropdown | **SortSelection** (medium) | ✅ Recognized |
| Click product link | Link | **OpenDetail** (high) | ✅ Recognized |
| Drag price slider | Slider | **AdjustValue** (high) | ✅ Recognized |
| Click "Add to Cart" | Click | **Unclassified** | ❌ "Add to Cart" is a core e-commerce capability but has no rule |
| Click "Next Page" | Link | **Paginate** (medium) | ✅ Recognized |

**The test explicitly accepts "Unclassified" for Add to Cart** — this is the most telling signal. The capability vocabulary lacks "AddToCart", "Purchase", "Checkout", "Login", "Register", "Delete", "Create", "Update", or any business-meaningful capability names.

### Avis Ford Workflow (phase7-realworld-validation.test.ts)

| User Action | ComponentInteraction Type | CapabilityRecord | Accurate? |
|---|---|---|---|
| Select Make "Ford" | Dropdown | **SelectOption** (low) | Generic — doesn't know it's "filter by make" |
| Select Model "Mustang" | Dropdown | **SelectOption** (low) | Generic |
| Select Condition "New" | Dropdown | **SelectOption** (low) | Generic |
| Click "Search" button | Click | **SubmitForm** (high) | ✅ Recognized form submission |

### Login Workflow (implied by SubmitForm test)

| User Action | ComponentInteraction Type | CapabilityRecord |
|---|---|---|
| Type email | TextEntry | **Search** or **Unclassified** |
| Type password | TextEntry | **Search** or **Unclassified** |
| Click "Sign In" | Click | **SubmitForm** (high) |

The model recognizes "a form was submitted" but not that the capability is "Login" or "Authentication."

---

## 6. What the Model Does Well

1. **Per-interaction classification with evidence trail.** Every CapabilityRecord includes matchedKeywords, semanticEffects, structuralContext, and alternatives. The reasoning is auditable.

2. **Signal fusion across 4 evidence streams.** Physical evidence (DOM properties), behavioral evidence (semantic effects from observation), sequence context (what happened before/after), and keyword evidence (text matching) are combined. This is genuinely sophisticated.

3. **Conflict resolution with priorities.** When multiple rules claim the same interaction, the engine resolves by confidence level first, then priority. Lower priority number = more specific rule.

4. **Graceful degradation.** Unclassified is a valid output with a documented reason. The system doesn't force-fit.

5. **Test generation works.** The IR Bridge independently maps ComponentInteractions to Playwright steps. Capability classification is not required for test replay — it's a display/analysis layer.

6. **12-rule taxonomy covers common e-commerce patterns.** Search, Filter, Sort, Navigate, OpenDetail, Paginate — these are well-matched to shopping sites.

---

## 7. What the Model Cannot Represent

### Gap 1: No business capability names
The model can say "SubmitForm" but not "Login", "Create Account", "Place Order", "Delete User", "Approve Request." The capability vocabulary is UI-mechanical, not business-semantic.

### Gap 2: No workflow relationships
Capabilities are independent: {Search}, {FilterSelection}, {OpenDetail}, {SubmitForm}. The model cannot represent "Search → Filter → Select → Add to Cart → Checkout" as a connected workflow with dependencies.

### Gap 3: No preconditions
No capability carries "requires authentication", "requires items in cart", "requires admin role." The model cannot express that Checkout depends on Add to Cart.

### Gap 4: No application state
The model captures what the user did, not what state the application was in or what state it transitioned to. No "logged in", "cart has 3 items", "form is valid."

### Gap 5: No failure modes
No capability records what happens when an operation fails. "Login with wrong password" produces the same SubmitForm as "Login with correct password."

### Gap 6: No input constraints
No capability carries field requirements, valid value ranges, format patterns, or option sets. The InteractionContract type exists in the domain model but is never populated.

### Gap 7: No API/database awareness
No capability links to backend APIs or database entities. The model is purely client-side DOM observation.

### Gap 8: No data relationships
No capability tracks that "email" and "password" are inputs to the "Login" capability, that "quantity" affects "price", or that "shipping address" is required for "Checkout."

### Gap 9: No negative/boundary information
No capability records "this field rejects special characters", "max length is 50", "phone must match regex."

### Gap 10: No multi-session accumulation
CapabilityRecords are ephemeral — overwritten on each recording. The domain Capability entity (which supports cross-session enrichment) is never activated.

### Gap 11: No application surface model
The ApplicationSurface concept (pages, elements on each page) exists in the domain model but is never populated. The model can't answer "what can you do on the checkout page?"

---

## 8. Architectural Mismatches

### Mismatch 1: Two disconnected capability systems
- **System A** (capabilities/) produces ephemeral UI interaction labels
- **System B** (domain/entities/) defines rich business capabilities but is never fed
- **No bridge exists** between CapabilityRecord[] and CapabilityCandidate

### Mismatch 2: ApplicationKnowledgeFragment is fully designed but never built
- 3 foundational entities (UiElement, ObservedTransition, ComponentGrouping) — defined, no producer code
- 6 derived views (InteractionContract, BehavioralContract, LogicalAction, RecordedWorkflow, ApplicationSurface, StateMachine) — defined, no producer code
- This was intended to be the core "Application Knowledge" but zero lines of production code produce it

### Mismatch 3: UnderstandingResult is always null
- The aggregation point between recording and understanding is always `{fragment: null, capability: null}`
- This means the Understanding Layer architecture exists on paper but has no implementation

### Mismatch 4: GenerationEnrichment is never passed
- IR Bridge accepts optional enrichment (assertions, business labels, surface tags)
- Service worker calls `buildIRPlan()` with no enrichment parameter
- Playwright tests are generated with zero semantic enrichment

### Mismatch 5: Capability vocabulary is e-commerce-biased
- FilterSelection, SortSelection, OpenDetail, Paginate — these are shopping-site concepts
- No vocabulary for CRUD operations, approval workflows, data export, user management, settings, authentication
- "Add to Cart" is Unclassified — the most fundamental e-commerce action

### Mismatch 6: 1:1 interaction-to-capability mapping
- Each ComponentInteraction produces exactly one CapabilityRecord
- But a real capability (Login) spans multiple interactions (type email → type password → click submit)
- The model has no concept of capability composition or multi-step capabilities

### Mismatch 7: Keyword-based classification is fragile
- SubmitForm requires keyword matching (submit/sign in/login/register)
- A button labeled "Continue" or "Proceed" that submits a form won't match
- OpenDetail uses hardcoded URL patterns (/dp/, /product/, /item/, UUID-like)
- This works for Amazon but not for arbitrary applications

---

## 9. Whether DF-1 Is Genuinely Required

### What DF-1 actually does
DF-1 expands observation windows from click+change to all 15 discrete event types, and adds 9 new snapshot fields.

### The problem DF-1 claims to solve
"70%+ of classified interactions have zero behavioral evidence" because only click and change open observation windows.

### Is DF-1 necessary for the Capability Model?

**No — DF-1 is solving a symptom, not the root cause.**

The root cause is that the Capability Model (System A) uses behavioral effects as *required evidence* for some rules:
- ToggleControl requires `hasStateToggle` → requires observation window
- ExpandCollapse requires `hasExpandCollapse` → requires observation window

Without observation windows on focus/mousedown/etc., these rules can't fire. But DF-1's solution (open windows for everything) introduces:
- getComputedStyle reflows on every snapshot
- Potentially 100+ concurrent windows during typing
- Duplicate evidence from overlapping windows
- 9 new snapshot fields that no effect rule reads

### What DF-1's new snapshot fields enable
The 9 new fields (ariaSelected, ariaHidden, ariaCurrent, computedDisplay, computedVisibility, computedOpacity) are captured but consumed by NOTHING at deff878 or DF-1. They're infrastructure for future effect rules.

### The real question
The Capability Model's problem isn't "missing observation windows" — it's that it classifies **interactions** instead of **capabilities**. Opening more observation windows produces more effects for more interactions, but each interaction is still classified independently with a UI-mechanical label.

**DF-1 is an optimization of the existing (incorrect) architecture, not a step toward the product goal.** It makes the observation pipeline more thorough but doesn't change what capabilities mean or how they're composed.

### If DF-1 proceeds anyway
DF-1 is a reasonable incremental improvement to the observation pipeline IF:
- The getComputedStyle reflow risk is addressed (batch/debounce)
- The window explosion for TextEntry is addressed (coalesce input+keydown)
- The 9 new fields will actually be consumed by DF-2+ effect rules

But DF-1 should NOT be treated as a prerequisite for "building the right Capability Model." The capability model redesign is orthogonal to observation expansion.

---

## 10. What the Capability Model Should Become

### The Product Goal
> Build an Application Knowledge / Capability Model from recorded application workflows so that the system can understand what the application can do and eventually use that knowledge for automated functional, negative, boundary, validation, API, database, and other testing.

### What a Capability Should Represent

A Capability should be a **business-meaningful operation** that the application supports, described by:

1. **Name** — "Login", "Search Products", "Add to Cart", "Checkout", "Create User"
2. **Preconditions** — what must be true before this capability can be exercised (authenticated, items in cart, admin role)
3. **Inputs** — what data the capability accepts (email, password, quantity, shipping address), with constraints (required, format, range, options)
4. **Action** — what the user does (the interaction sequence)
5. **State change** — what observable state changes in the application (session created, cart updated, order placed)
6. **Expected outcomes** — success indicators (redirect to dashboard, toast message, cart count increments) and failure indicators (error message, form validation, access denied)
7. **Dependencies** — which other capabilities must precede this one (Checkout requires Add to Cart)
8. **Data entities** — which database entities are affected (User, Cart, Order, Session)
9. **APIs** — which backend endpoints support this capability (POST /api/login, POST /api/cart)
10. **Negative/boundary variants** — what inputs are invalid, what edge cases exist

### Current vs Target

| Dimension | Current (System A) | Target |
|---|---|---|
| Granularity | Per-interaction | Per-business-operation |
| Naming | "SubmitForm" | "Login" |
| Relationships | None (independent) | Dependency graph |
| Preconditions | None | Required |
| Inputs | None | Field-level with constraints |
| State | Snapshot diff only | Application state model |
| Outcomes | "content-change" effect | Success/failure indicators |
| Failure modes | Absent | Explicit |
| API awareness | None | Endpoint mapping |
| Data awareness | None | Entity mapping |
| Persistence | Ephemeral | Cross-session accumulation |
| Test generation | Interaction replay | Capability-driven test synthesis |

---

## 11. Recommended Architecture Changes (Not Implemented)

### Phase A: Activate System B (connect existing code)
The domain model (Capability entity, CapabilityCandidate, CapabilityMatchingService, ApplicationKnowledgeFragment) is well-designed but disconnected. Step 1 is building the bridge:

1. **Build a CapabilityCandidate from CapabilityRecord[].** Group consecutive interactions that compose one business operation (e.g., TextEntry × 2 + Click = Login). Derive name from accessible names/page titles. Extract inputs from TextEntry fields.

2. **Populate UnderstandingResult.capability** before calling persistSession(). Change service-worker.ts line 356 from `capability: null` to the derived candidate.

3. **Populate UnderstandingResult.fragment** by building ApplicationKnowledgeFragment from the recording data. Map ComponentInteractions → UiElements + ObservedTransitions.

### Phase B: Capability composition layer
4. **Add a Capability Composer** between the Capability Engine and persistence. This groups interactions into multi-step capabilities:
   - Login = [TextEntry(email), TextEntry(password), Click(submit)]
   - Add to Cart = [Click(add-to-cart)]
   - Checkout = [Click(checkout), TextEntry(shipping), Click(place-order)]

5. **Derive business names** from application text (button labels, page titles, form headings) using the enrichment pipeline that already exists (meaning-resolver.ts).

### Phase C: Workflow graph
6. **Build a Workflow Graph** from ordered capabilities. This replaces the flat CapabilityRecord[] with a directed graph:
   - Nodes = capabilities
   - Edges = temporal ordering + preconditions
   - Branch points = where the user chose one option from many

7. **Store the Workflow Graph** in the Repository alongside Capabilities. This is the "what workflows are supported" knowledge.

### Phase D: Constraint extraction
8. **Extract input constraints** from DOM attributes (required, pattern, min/max/step, minlength/maxlength, type). This data is already captured in ElementIdentity/DomContext but not extracted into InteractionContract.

9. **Observe validation behavior.** When a form submission fails, capture error messages, field highlighting, and validation timing. Store as FailureMode on the Capability.

### Phase E: Test generation from capabilities
10. **Generate negative tests** from InteractionConstraints: submit with empty required fields, invalid formats, out-of-range values.
11. **Generate boundary tests** from valueRange/lengthRange: min-1, min, min+1, max-1, max, max+1.
12. **Generate workflow tests** from the Workflow Graph: valid path, alternate paths, blocked paths (missing preconditions).

### What NOT to do
- Don't add more capability rules to the existing 12-rule taxonomy. The vocabulary problem isn't solved by adding more enum values.
- Don't extend the keyword matching. It's inherently fragile.
- Don't build AI-based classification yet. Deterministic composition from interaction sequences + DOM context should come first.
- Don't discard System A. It produces useful signal. Refactor it as an input to the composition layer.

### DF-1 recommendation
DF-1 can proceed as a **pipeline improvement** (more events get observation windows) but should be reframed:
- It is NOT a Capability Model improvement
- It IS an observation completeness improvement
- The 9 new fields need consumers (DF-2+ effect rules) to be worthwhile
- The getComputedStyle and window-explosion risks need mitigation
