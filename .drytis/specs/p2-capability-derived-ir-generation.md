# P2: Capability-Derived IR Generation — Design Document

**Status:** IMPLEMENTED & VALIDATED — frozen at `57128cb`
**Baseline:** R4 frozen at `b4d558a`
**Dependencies:** P1 (frozen at `b3e14fe`), R4 (frozen at `b4d558a`)
**Roadmap:** §6 P2 — transforms approved capability knowledge into disposable executable IR.

---

## 0. Purpose

P2 transforms an approved `P2CapabilityContract` — which describes *what* a
capability does at the semantic level (data requirements, success criteria,
entry point) — into one or more disposable `ExecutionIRPlan` instances that
describe *how* to execute that capability against a specific application.

**The core transformation:**

```
P2CapabilityContract
  → test data resolution (generate concrete values per DataRequirement)
  → field/element binding (map each field to a semantic identity)
  → full identity recovery (from source session's rawInteractions)
  → R4 Element Repository resolution (MATCHED/AMBIGUOUS/UNMATCHED)
  → locator resolution (Element.locatorStrategies → ResolvedLocator[])
  → IR action generation (inputMethod → IRAction)
  → success-criterion assertion generation (SuccessCriterion → IRAssertion)
  → ExecutionIRPlan
```

**What P2 achieves:** The product evolves from "record and replay" to a
capability-driven test platform. After a single recording is reviewed and
approved, P2 can generate executable test plans for arbitrary data sets
without requiring another recording.

**What P2 consumes:**
- `P2CapabilityContract` — sole input interface, published by P1 review approval
- `RecordingSession` (via `sourceSessionId`) — for semantic field/element binding AND full identity recovery
- `Element` Repository (via `ElementMatchingService`) — for durable element identity + healed locators

**What P2 produces:**
- `ExecutionIRPlan[]` — one per requested data variant (P3 will generate the variants; P2 takes a single `TestData` map as input)

**What P2 does NOT do:**
- P3 (AI Test Data Generation) — P2 accepts a `TestData` map; it does not invent data
- P4/P5 (Execution) — P2 produces IR plans; it does not execute them
- P6 (AI Failure Analysis) — downstream of execution
- Recorder modification — P2 does not touch the recorder pipeline
- Capability management — P2 reads approved contracts; it does not create/modify capabilities
- Element creation/healing — P2 resolves targets; it does not create or heal Elements
- Ambiguity guessing — P2 surfaces AMBIGUOUS/UNMATCHED targets; it never guesses

---

## 1. Architectural Boundaries

### 1.1 Responsibility Matrix

| Concern | Owner | P2 Interaction |
|---|---|---|
| Approved capability knowledge | P1 (CapabilityVersion, P2CapabilityContract) | Read-only consumption |
| Durable element identity | R4 (ElementIdentityRecord, Element entity) | Read-only consumption |
| Element matching | R4 (ElementMatchingService) | Delegation via `matchElements()` |
| Element healing/creation | Healing Service | P2 does NOT call; healing runs in the recording pipeline |
| Locator ranking | `locator-ranking.ts`, `generator.ts:resolveElementTarget` | Reuses `resolveElementTarget(element)` |
| IR types | `execution-ir/types.ts` | Produces ExecutionIRPlan |
| Test data generation | P3 | P2 accepts `TestData` input; P3 will call P2 |
| Execution | P4/P5 | Consumes ExecutionIRPlan output |

### 1.2 Hard Invariants

- **INV-P2-1:** P2 must never call `createElement`, `healElement`, `updateElement`, or any mutation method on the Element Repository.
- **INV-P2-2:** P2 must never guess an AMBIGUOUS target. If `matchElements` returns AMBIGUOUS for a field's target element, P2 produces an IR plan with a `NoTarget` placeholder and a resolution warning, not an assumed element.
- **INV-P2-3:** P2 must never guess an UNMATCHED target. If no stored Element matches, P2 produces `NoTarget` + warning, not a fabricated target.
- **INV-P2-4:** P2 must not modify P1 or R4 types. All new types are additive.
- **INV-P2-5:** P2 must not depend on the recorder pipeline. It reads only from persisted sessions and the Element Repository.
- **INV-P2-6:** P2 must produce plans compatible with the existing `ExecutionIRPlan` type — no new IR types or action variants.
- **INV-P2-7:** P2 must produce deterministic output for the same `(contract, testData, environment)` tuple.
- **INV-P2-8:** P2 must not add elementBindings or any execution binding to P2CapabilityContract.
- **INV-P2-9:** P2 must not modify the source RecordingSession.
- **INV-P2-10:** P2 must not produce DRAG_DROP or PRESS_KEY actions (not authorable from DataRequirement).
- **INV-P2-11:** P2 must never fall back to reduced-identity (UiElementSummary-only) matching. If full identity recovery fails, the field is unresolved.
- **INV-P2-12:** P2 must never fall back to accessibleName-only matching. R4's full scoring pipeline is the only target-resolution mechanism.

---

## 2. Provenance Dependency

### 2.1 Source Session Requirement

P2's target resolution requires recovering the full 18-field `ElementIdentity`
captured during recording. This identity is stored in the `RecordingSession`'s
`rawInteractions: ComponentInteraction[]` (Tier 1 permanent, never deleted).

**P2 requires:**
1. `P2CapabilityContract.sourceSessionId` → must reference a recoverable `RecordingSession`
2. The session's `rawInteractions` → must contain the `ComponentInteraction` whose `trigger.elementId` matches the field's component root element

If either is unavailable, P2 **fails safely**: the field is returned as unresolved
(NoTarget + warning), never matched against a reduced identity.

### 2.2 Failure Modes for Provenance

| Scenario | Behavior |
|---|---|
| `sourceSessionId` is null or empty | All fields unresolved — warning `'missing-source-session'` |
| Session not found in repository | All fields unresolved — warning `'session-not-found'` |
| Session found but `rawInteractions` empty | Fields with recoverable identity from `rawEvents` (no ancestorRoles); rest unresolved |
| `rawInteractions` has no matching `elementId` for a field | That field unresolved — warning `'no-originating-interaction'` |
| `rawEvents` also has no matching `elementId` | That field unresolved — warning `'no-originating-interaction'` |

**P2 never silently falls back to accessibleName-only matching.** Full identity
recovery is the sole mechanism. Failure to recover identity produces an
unresolved target, not a guess.

---

## 3. Data Flow: End-to-End Trace

### 3.1 Filter Products Example

**Approved P2CapabilityContract (from P1 review):**

```
name: "Filter Products"
purpose: "Filter product catalog by category, sale status, and price"
sourceSessionId: "sess-abc123"
entryPoint: { url: "/products", elementName: null }

dataRequirements:
  - field: "category", label: "Category", kind: "select",
    inputMethod: "dropdown", required: true,
    constraints: { options: ["Electronics", "Books", "Clothing", null] }
  - field: "onSale", label: "On Sale", kind: "boolean",
    inputMethod: "toggle", required: false,
    constraints: {}
  - field: "maxPrice", label: "Maximum Price", kind: "number",
    inputMethod: "slider", required: false,
    constraints: { min: 0, max: 1000, step: 50 }

successCriteria:
  - id: "sc1", type: "elementVisible",
    target: { kind: "element", elementLocator: "Product List", urlPattern: null },
    expectedValue: null, timeout: 5000
  - id: "sc2", type: "textPresent",
    target: { kind: "page", elementLocator: null, urlPattern: null },
    expectedValue: "Electronics", timeout: 3000
```

**Test data variant 1:**

```
{ category: "Electronics", onSale: true, maxPrice: 500 }
```

### 3.2 Step-by-Step Pipeline

**Step 1 — Test Data Resolution (DataResolver)**

Validates each value against constraints:

| field | kind | inputMethod | constraint | resolved value |
|---|---|---|---|---|
| category | select | dropdown | options: [Electronics, Books, ...] | `"Electronics"` |
| onSale | boolean | toggle | — | `true` |
| maxPrice | number | slider | min:0, max:1000, step:50 | `500` |

**Step 2 — Field/Element Binding (ElementBindingResolver)**

Maps DataRequirement → session element ID via fragment metadata:

```
DataRequirement.field = "category"
  → LogicalAction { businessField: "category", componentId: "comp-001" }
  → ComponentSummary { rootElementId: "elem-0007" }
  → UiElementSummary { elementId: "elem-0007", tag: "select", role: "combobox",
                        accessibleName: "Category", sourceUrl: "/products" }
```

| field | logical action | component | session elementId |
|---|---|---|---|
| category | businessField="category" | comp-001 | elem-0007 |
| onSale | businessField="onSale" | comp-002 | elem-0012 |
| maxPrice | businessField="maxPrice" | comp-003 | elem-0018 |

Fallback: if no LogicalAction matches, try UiElementSummary by accessibleName === DataRequirement.label.

If no session element matches either path → unresolved (warning `no-session-element`).

**Step 3 — Full Identity Recovery**

For each session element ID, recover the full 18-field ElementIdentity from
`session.rawInteractions`:

```
sessionElementId = "elem-0007"
  → session.rawInteractions.find(i => i.trigger.elementId === "elem-0007")
  → ComponentInteraction {
      trigger: ElementIdentity {
        accessibleName: "Category",
        ariaRole: "combobox",
        tag: "select",
        testId: "category-select",
        dataCy: null, dataQa: null,
        name: "category",
        ariaLabel: "Product Category Filter",
        cssSelector: "select#category",
        xPath: "/html/body/main/div/select",
        ...
      },
      triggerEvent: { domContext: { ancestorRoles: ["form", "fieldset", "main"] } }
    }
  → Build UiElement with full identity + ancestorRoles
```

If `rawInteractions` doesn't have the elementId, try `rawEvents` (which carries
full ElementIdentity but NO domContext → ancestorRoles = null).

If neither source has the elementId → unresolved (warning `no-originating-interaction`).
**No accessibleName-only fallback.**

**Step 4 — R4 Element Repository Resolution**

Query stored Elements and match using R4's `matchElements()`:

```typescript
const storedElements = await repos.elements.getByProject(projectId);
const freshUiElements = boundFields.map(f => buildMatchableUiElement(f, session));
const result = matchElements(freshUiElements, storedElements);
```

R4's scoring with full recovered identity:

| field | fresh identity | best stored Element | score | result |
|---|---|---|---|---|
| category | testId:category-select, name:category, role:combobox | uuid-a1b2 (testId:category-select, name:category) | 0.95 | MATCHED |
| onSale | testId:on-sale-toggle, role:checkbox | uuid-c3d4 (testId:on-sale-toggle) | 0.90 | MATCHED |
| maxPrice | css:input[type=range], aria:slider | uuid-e5f6 (css:input[type=range]) | 0.85 | MATCHED |

**Step 5 — Locator Resolution**

For each MATCHED field, reuse `resolveElementTarget(element)` from `generator.ts`:

```typescript
const target: ElementTarget = resolveElementTarget(matchedElement);
// → { kind: 'element', elementId: 'uuid-a1b2', elementName: 'Category',
//     pageOrComponent: '/products',
//     resolvedLocators: [
//       { type: TEST_ID, value: 'category-select', priority: 1, confidence: 0.95 },
//       { type: ROLE, value: 'combobox[name="Category"]', priority: 2, confidence: 0.80 },
//     ] }
```

**Step 6 — IR Action Generation (inputMethod → IRAction)**

| inputMethod | IRAction | input handling |
|---|---|---|
| `dropdown` | `IRAction.SELECT` | `input: string` (option label) |
| `toggle` | `IRAction.TOGGLE` | `input: boolean` (checked state) |
| `slider` | `IRAction.FILL` | `input: number` (target value) |
| `text` | `IRAction.FILL` | `input: string` (text to type) |
| `datePicker` | `IRAction.SELECT_DATE` | `input: string` (ISO date) |
| `fileUpload` | `IRAction.FILL` | `input: string` (file path) |
| `null` | `IRAction.FILL` | fallback to text input |

**Step 7 — Success Criterion Assertion Generation**

| SuccessType | ValidationType | ValidationComparison | target resolution |
|---|---|---|---|
| `navigation` | `URL_MATCH` | `MATCHES` | UrlTarget(urlPattern) |
| `elementVisible` | `VISIBILITY` | `IS_TRUE` | ElementTarget via full identity recovery + matchElements |
| `elementAbsent` | `VISIBILITY` | `IS_FALSE` | ElementTarget via full identity recovery + matchElements |
| `valueEquals` | `ATTRIBUTE_MATCH` | `EQUALS` | ElementTarget via full identity recovery + matchElements |
| `textPresent` | `TEXT_MATCH` | `CONTAINS` | UrlTarget(page scope) |
| `custom` | `CUSTOM` | `EQUALS` | NoTarget |

Element-based criteria use the same full identity recovery + matchElements pipeline as field targets.

**Step 8 — Assemble ExecutionIRPlan**

```typescript
const plan: ExecutionIRPlan = {
  testCaseId: `p2-${contract.capabilityId}`,
  testCaseVersionId: `p2-${contract.versionId}-data-${variantId}`,
  testCaseVersionNumber: contract.versionNumber,
  title: `${contract.name} — ${variantLabel}`,
  tags: ['capability-derived', 'p2'],
  environment,
  steps: [
    { id: 'step-0', order: 0, action: IRAction.NAVIGATE,
      description: `Navigate to ${contract.entryPoint.url}`,
      target: { kind: 'url', url: `${baseUrl}${contract.entryPoint.url}` },
      input: null, assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    { id: 'step-1', order: 1, action: IRAction.SELECT,
      description: 'Select "Electronics" from Category dropdown',
      target: ElementTarget(uuid-a1b2), input: 'Electronics',
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    { id: 'step-2', order: 2, action: IRAction.TOGGLE,
      description: 'Toggle On Sale to true',
      target: ElementTarget(uuid-c3d4), input: true,
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    { id: 'step-3', order: 3, action: IRAction.FILL,
      description: 'Set Maximum Price to 500',
      target: ElementTarget(uuid-e5f6), input: 500,
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    { id: 'step-4', order: 4, action: IRAction.VERIFY,
      description: 'Verify success criteria',
      target: { kind: 'none' }, input: null,
      assertions: [VISIBILITY(productList), TEXT_MATCH("Electronics")],
      executionParameters: DEFAULT_EXECUTION_PARAMETERS },
  ],
};
```

### 3.3 Second Data Variant — No Re-recording

For `{ category: "Books", onSale: false, maxPrice: 200 }`:
- Steps 2-4 (binding + identity recovery + matching + locators) produce **identical** targets
- Only `input` values change: SELECT "Books", TOGGLE false, FILL 200

---

## 4. Component Design

### 4.1 New Types

#### TestData

```typescript
type TestData = ReadonlyMap<string, string | number | boolean>;
```

#### ResolutionWarning

```typescript
interface ResolutionWarning {
  readonly field: string;
  readonly reason: 'ambiguous' | 'unmatched' | 'no-session-element'
    | 'no-logical-action' | 'missing-source-session' | 'session-not-found'
    | 'no-originating-interaction';
  readonly message: string;
  readonly candidates?: ReadonlyArray<{ elementId: string; matchScore: number }>;
}
```

#### CapabilityIRResult

```typescript
interface CapabilityIRResult {
  readonly plan: ExecutionIRPlan;
  readonly warnings: ResolutionWarning[];
  readonly hasUnresolvedTargets: boolean;
  readonly resolvedFields: ReadonlyArray<{ field: string; elementId: string; matchScore: number }>;
}
```

#### P2GenerationInput

```typescript
interface P2GenerationInput {
  readonly contract: P2CapabilityContract;
  readonly testData: TestData;
  readonly projectId: string;
  readonly environment: IREnvironment;
  readonly variantLabel?: string;
}
```

### 4.2 Full Identity Recovery

#### recoverFullIdentity

```typescript
/**
 * Recover the full 18-field ElementIdentity for a session element from the
 * source session's archival data.
 *
 * Primary source: rawInteractions — carries full ElementIdentity AND
 *   domContext.ancestorRoles.
 * Fallback source: rawEvents — carries full ElementIdentity but NO
 *   domContext (ancestorRoles will be null).
 *
 * Returns null if neither source contains the elementId. Caller MUST
 * treat null as unresolved — never fall back to reduced-identity matching.
 */
function recoverFullIdentity(
  sessionElementId: string,
  session: RecordingSession,
): { identity: ElementIdentity; ancestorRoles: string[] | null } | null
```

#### buildMatchableUiElement

```typescript
/**
 * Build a UiElement with full recovered identity for matchElements().
 *
 * Uses UiElementSummary only for sourceUrl — all identity fields come
 * from recoverFullIdentity().
 *
 * Returns null if full identity cannot be recovered.
 */
function buildMatchableUiElement(
  sessionElementId: string,
  summary: UiElementSummary,
  session: RecordingSession,
): UiElement | null
```

With full recovered identity, R4 scoring uses all 8 dimensions:
- BUSINESS_IDS (25%): testId, dataCy, dataQa from recovered ElementIdentity
- ACCESSIBLE_NAME (20%): accessibleName
- FORM_NAME (15%): name (HTML form name)
- ARIA_ROLE (10%): ariaRole
- ARIA_LABEL (10%): ariaLabel
- ANCESTOR_ROLES (10%): ancestorRoles from domContext
- TAG (5%): tag
- PAGE_SCOPE (5%): sourceUrl

This gives P2 the **same identity depth** that `healFromRecording` uses during
recording. Duplicate-name elements are correctly distinguished via testId,
name, or ancestorRoles. Truly indistinguishable elements correctly return
AMBIGUOUS.

### 4.3 New Modules

#### src/domain/generation/p2-types.ts

Type definitions: `TestData`, `ResolutionWarning`, `CapabilityIRResult`,
`P2GenerationInput`, `DataWarning`, `BindingWarning`.

#### src/domain/generation/data-resolver.ts

Pure function module — no I/O.

```typescript
function resolveTestData(
  requirements: readonly DataRequirement[],
  testData: TestData,
): { resolved: ReadonlyMap<string, string | number | boolean>; warnings: DataWarning[] }
```

Validates each test value against constraints:
- `kind: select` → value must be in `constraints.options`
- `kind: number` → value must be in `[min, max]` range, aligned to `step`
- `kind: text` → value must satisfy `constraints.pattern`, `minLength`/`maxLength`
- `kind: boolean` → value must be `true` or `false`
- `kind: date` → value must be a valid date string

Missing required → warning + skip. Invalid → warning + skip. Optional missing → use `defaultValue` or skip.

#### src/domain/generation/element-binding-resolver.ts

Resolves DataRequirement.field → session element ID.

```typescript
function resolveFieldBindings(
  requirements: readonly DataRequirement[],
  session: RecordingSession,
): { bindings: Map<string, { elementId: string; summary: UiElementSummary }>; warnings: BindingWarning[] }
```

Pipeline per requirement:
1. **Primary:** Find LogicalAction where `businessField === requirement.field`.
   Get componentId → ComponentSummary.rootElementId → session elementId.
2. **Fallback:** Find UiElementSummary where `accessibleName === requirement.label`.
3. **No match:** Warning `no-logical-action` or `no-session-element`.

#### src/domain/generation/element-target-resolver.ts

Resolves session elements to ElementTargets using full identity recovery + R4 matching.

```typescript
async function resolveTargets(
  bindings: Map<string, { elementId: string; summary: UiElementSummary }>,
  session: RecordingSession,
  storedElements: readonly Element[],
): Promise<{
  targets: Map<string, ElementTarget | NoTarget>;
  warnings: ResolutionWarning[];
  resolvedFields: Array<{ field: string; elementId: string; matchScore: number }>;
}>
```

Pipeline per binding:
1. Call `buildMatchableUiElement(sessionElementId, summary, session)`.
2. If null → unresolved (warning `no-originating-interaction`). No fallback.
3. Call `matchElements([freshUiElement], storedElements)`.
4. MATCHED → `resolveElementTarget(element)` → ElementTarget.
5. AMBIGUOUS → NoTarget + warning `ambiguous` + candidates.
6. UNMATCHED → NoTarget + warning `unmatched`.

#### src/domain/generation/ir-action-mapper.ts

```typescript
const INPUTMETHOD_TO_IRACTION: ReadonlyMap<InputMethod | null, IRAction> = new Map([
  ['dropdown', IRAction.SELECT],
  ['toggle', IRAction.TOGGLE],
  ['slider', IRAction.FILL],
  ['text', IRAction.FILL],
  ['datePicker', IRAction.SELECT_DATE],
  ['fileUpload', IRAction.FILL],
  [null, IRAction.FILL], // fallback
]);
```

#### src/domain/generation/success-criterion-resolver.ts

```typescript
async function resolveSuccessCriteria(
  criteria: readonly SuccessCriterion[],
  session: RecordingSession,
  storedElements: readonly Element[],
  environment: IREnvironment,
): Promise<{ assertions: IRAssertion[]; warnings: ResolutionWarning[] }>
```

Element-based criteria use the same full identity recovery + matchElements pipeline as field targets.

#### src/domain/generation/capability-ir-generator.ts

The orchestrator:

```typescript
async function generateCapabilityIR(
  input: P2GenerationInput,
  uowFactory: UnitOfWorkFactory,
): Promise<CapabilityIRResult>
```

Flow:
1. Recover source RecordingSession via `contract.sourceSessionId`.
2. If session missing → return result with all fields unresolved (warning `session-not-found`).
3. Call `ElementBindingResolver` → field bindings.
4. Query `repos.elements.getByProject(projectId)` → stored Elements.
5. Call `ElementTargetResolver` → targets (full identity recovery + matchElements).
6. Call `DataResolver` → resolved test values.
7. Map `inputMethod` → `IRAction` per DataRequirement.
8. Call `SuccessCriterionResolver` → assertions.
9. Assemble `ExecutionIRPlan` + warnings.

---

## 5. Target Resolution: R4 Outcomes

### 5.1 MATCHED → Generate Target-Bearing IR

When `matchElements` returns a MATCHED pair:
1. Extract matched `Element` (UUID, locatorStrategies, logicalName).
2. Call `resolveElementTarget(element)` → `ElementTarget` with resolved locators.
3. Use as the step's `target`.

Locators are the **current** healed locators from the Element Repository.

### 5.2 AMBIGUOUS → Do Not Guess; Surface Unresolved Target

When `matchElements` returns AMBIGUOUS:
1. Produce `NoTarget` for this field's step.
2. Add `ResolutionWarning` with reason `ambiguous` and candidate list.
3. Step is structurally present but has no executable target.

### 5.3 UNMATCHED → Do Not Execute Against Assumed Element

When `matchElements` returns UNMATCHED:
1. Produce `NoTarget` for this field's step.
2. Add `ResolutionWarning` with reason `unmatched`.
3. Field may be genuinely new or Repository may lack an entry.

### 5.4 Recovery Strategies (Future, NOT P2)

AMBIGUOUS and UNMATCHED targets surface human-actionable warnings. Future:
- Re-recording + re-approval refreshes session elements and allows healing.
- Manual element-binding UI could disambiguate.
- P2 does NOT implement these — it only surfaces the problem.

---

## 6. Duplicate-Name Regression Cases

These cases are required test scenarios proving the full identity recovery
path correctly consumes the R4 foundation:

| Case | Fresh identity | Stored Elements | Expected result |
|---|---|---|---|
| Two "Email" controls distinguished by `name` | name:primaryEmail, accessibleName:Email | Element A: name:primaryEmail; Element B: name:secondaryEmail | MATCHED (A) — FORM_NAME dimension distinguishes |
| Duplicate names distinguished by `testId` | testId:email-1, accessibleName:Email | Element A: testId:email-1; Element B: testId:email-2 | MATCHED (A) — BUSINESS_IDS dimension distinguishes |
| Duplicate names distinguished by `ancestorRoles` | ancestors:[form,primary-contact], accessibleName:Email | Element A: ancestors:[form,primary-contact]; Element B: ancestors:[form,secondary-contact] | MATCHED (A) — ANCESTOR_ROLES dimension distinguishes |
| Truly indistinguishable duplicates | accessibleName:Delete, no testId/name/ancestors | Element A: identical; Element B: identical | AMBIGUOUS — margin < 0.05 |
| Changed testId, strong remaining identity | testId:new-id, name:email, accessibleName:Email, ancestors:[form] | Element: testId:old-id, name:email, accessibleName:Email, ancestors:[form] | MATCHED — semantic identity survives testId change |
| Insufficient identity → not arbitrary selection | accessibleName:Delete only, no other fields | Element A: accessibleName:Delete, no identity; Element B: same | AMBIGUOUS or UNMATCHED, never arbitrary MATCHED |
| Missing source session | — | Any | All fields unresolved — warning `session-not-found` |
| Missing originating interaction | elementId not in rawInteractions or rawEvents | Any | Field unresolved — warning `no-originating-interaction` |
| P2 does not mutate Element Repository | Any | Any | Verify Element count/contents unchanged after P2 generation |

---

## 7. Provenance and Reproducibility

### 7.1 Provenance

Each `ExecutionIRPlan` carries:
- `testCaseId: p2-{capabilityId}` → links to capability
- `testCaseVersionId: p2-{versionId}-data-{variantId}` → unique per variant
- Tags: `['capability-derived', 'p2']`

### 7.2 Reproducibility

Same `(contract, testData, projectId, environment)` always produces the same
plan, because: contract is immutable, testData is an input parameter, Element
Repository is read-only from P2's perspective, and `resolveElementTarget` is
pure. If locators were healed between invocations, resolved locators differ —
this is **correct** (should use latest healed locators).

### 7.3 Traceability

```
ExecutionIRPlan.testCaseId → Capability.id
ExecutionIRPlan.testCaseVersionId → CapabilityVersion.versionId
P2CapabilityContract.sourceSessionId → RecordingSession.id
CapabilityIRResult.resolvedFields[].elementId → Element.id (repository UUID)
```

---

## 8. IR Compatibility

P2 produces plans using:
- `ExecutionIRPlan` — identical to existing
- `IRStep` — identical to existing
- `IRAction` — subset of existing enum (NAVIGATE, SELECT, TOGGLE, FILL, SELECT_DATE, VERIFY)
- `ElementTarget`, `UrlTarget`, `NoTarget` — identical to existing
- `ResolvedLocator` — identical to existing
- `IRAssertion` — identical to existing

**No new IR types.** Output is directly consumable by existing execution
infrastructure and IR renderers.

---

## 9. Failure Semantics

| Scenario | Behavior |
|---|---|
| Source session not found | All fields unresolved — warning `session-not-found` |
| sourceSessionId is null/empty | All fields unresolved — warning `missing-source-session` |
| No logical action matches field | Warning `no-logical-action`, try accessibleName fallback |
| No session element matches | Warning `no-session-element`, NoTarget |
| Full identity not recoverable | Warning `no-originating-interaction`, NoTarget. **No accessibleName-only fallback.** |
| No stored Element matches (R4) | Warning `unmatched`, NoTarget |
| Multiple stored Elements match (R4) | Warning `ambiguous`, NoTarget, list candidates |
| Test data missing for required field | Warning `missing-required`, skip step |
| Test data fails constraint | Warning `invalid-value`, skip step |
| Success criterion target unresolvable | Warning, assertion omitted |
| Element Repository empty | All fields UNMATCHED, plan has NoTarget everywhere |

Plans with `hasUnresolvedTargets: true` are structurally valid but should NOT
be auto-executed without review.

---

## 10. Implementation Steps

### Step 1: New Types

Create `src/domain/generation/p2-types.ts`:
- `TestData`, `ResolutionWarning`, `CapabilityIRResult`, `P2GenerationInput`
- `DataWarning`, `BindingWarning`

### Step 2: DataResolver

Create `src/domain/generation/data-resolver.ts`:
- `resolveTestData(requirements, testData)` → validated values + warnings
- Pure function, fully unit-testable

### Step 3: ElementBindingResolver

Create `src/domain/generation/element-binding-resolver.ts`:
- `resolveFieldBindings(requirements, session)` → field → session element bindings
- Uses LogicalAction.businessField → componentId → rootElementId

### Step 4: ElementTargetResolver (with Full Identity Recovery)

Create `src/domain/generation/element-target-resolver.ts`:
- `recoverFullIdentity(sessionElementId, session)` → ElementIdentity + ancestorRoles | null
- `buildMatchableUiElement(sessionElementId, summary, session)` → UiElement | null
- `resolveTargets(bindings, session, storedElements)` → targets + warnings
- Uses `matchElements()` for MATCHED/AMBIGUOUS/UNMATCHED
- Uses `resolveElementTarget()` for MATCHED locators

### Step 5: IR Action Mapper

Create `src/domain/generation/ir-action-mapper.ts`:
- `INPUTMETHOD_TO_IRACTION` constant map
- `inputMethodToIRAction(inputMethod)` → IRAction

### Step 6: SuccessCriterionResolver

Create `src/domain/generation/success-criterion-resolver.ts`:
- `resolveSuccessCriteria(criteria, session, storedElements, environment)` → IRAssertion[]

### Step 7: CapabilityIRGenerator

Create `src/domain/generation/capability-ir-generator.ts`:
- Orchestrates Steps 2-6 via UnitOfWork
- Single async entry point

### Step 8: Tests

Create `tests/p2-gates.test.ts` — all exit criteria + regression cases.
Unit tests for DataResolver, ElementBindingResolver, ElementTargetResolver.
Integration tests for CapabilityIRGenerator with mock sessions/elements.

### Step 9: Spec Update

Update `.drytis/CANONICAL_ROADMAP.md` to mark P2 as in progress.

---

## 11. Regression Gates

| Gate | Test | Expected |
|---|---|---|
| G1 | `tsc --noEmit` src/ | 0 errors |
| G2 | Golden master suite | 143/143 |
| G3 | Element matching (R4) | 18/18 |
| G4 | Healing service (R4) | 11/11 |
| G5 | R4 identity gates | 26/26 |
| G6 | Full suite | All green (1 pre-existing flaky) |
| G7 | R2 slider gates | 16/16 |
| G8 | R3 behavioral gates | 26/26 |
| G9 | P1 gates | 39/39 |
| G10 | P2 gates (new) | All green |

---

## 12. Exit Criteria

| EC | Description | Verification |
|---|---|---|
| EC1 | P2 generates ExecutionIRPlan from P2CapabilityContract | CapabilityIRGenerator test |
| EC2 | All 6 InputMethod values map to correct IRAction | ir-action-mapper unit test |
| EC3 | DataResolver validates all DataKind constraints | data-resolver unit test |
| EC4 | ElementBindingResolver maps fields via logical actions | binding-resolver unit test |
| EC5 | Full identity recovery from rawInteractions | target-resolver unit test |
| EC6 | MATCHED target → ElementTarget with resolved locators | target-resolver unit test |
| EC7 | AMBIGUOUS target → NoTarget + warning, never guesses | target-resolver unit test |
| EC8 | UNMATCHED target → NoTarget + warning, never assumes | target-resolver unit test |
| EC9 | Two "Email" distinguished by name → MATCHED correct one | regression case test |
| EC10 | Duplicate names distinguished by testId → MATCHED correct one | regression case test |
| EC11 | Duplicate names distinguished by ancestorRoles → MATCHED correct one | regression case test |
| EC12 | Truly indistinguishable duplicates → AMBIGUOUS | regression case test |
| EC13 | Changed testId with strong remaining identity → MATCHED | regression case test |
| EC14 | Insufficient identity → UNMATCHED or AMBIGUOUS, never arbitrary | regression case test |
| EC15 | Missing source session → all fields unresolved | regression case test |
| EC16 | Missing originating interaction → field unresolved | regression case test |
| EC17 | P2 never calls createElement/healElement/updateElement | code audit + test |
| EC18 | P2 does not mutate Element Repository | regression case test |
| EC19 | Filter Products trace produces correct IR plan | integration test |
| EC20 | Second data variant: same targets, different inputs | integration test |
| EC21 | Success criteria → IRAssertion mapping | success-criterion-resolver unit test |
| EC22 | Plan compatible with existing ExecutionIRPlan type | tsc compilation |
| EC23 | All regression gates green (G1-G10) | CI run |
| EC24 | hasUnresolvedTargets flag set when any target is NoTarget | integration test |

---

## 13. Boundary Invariants

| INV | Description |
|---|---|
| INV-P2-1 | P2 never calls createElement, healElement, updateElement |
| INV-P2-2 | P2 never guesses AMBIGUOUS targets |
| INV-P2-3 | P2 never guesses UNMATCHED targets |
| INV-P2-4 | P2 does not modify P1 or R4 types |
| INV-P2-5 | P2 does not depend on the recorder pipeline |
| INV-P2-6 | P2 produces ExecutionIRPlan compatible with existing types |
| INV-P2-7 | P2 is deterministic for same (contract, testData, environment) |
| INV-P2-8 | P2 does not add elementBindings or execution binding to P2CapabilityContract |
| INV-P2-9 | P2 does not modify the source RecordingSession |
| INV-P2-10 | P2 does not produce DRAG_DROP or PRESS_KEY actions |
| INV-P2-11 | P2 never falls back to reduced-identity matching |
| INV-P2-12 | P2 never falls back to accessibleName-only matching |

---

## 14. P2/P3 Boundary

| Concern | P2 | P3 |
|---|---|---|
| Test data | Accepts `TestData` input | Generates `TestData` variants |
| IR plan | Produces `ExecutionIRPlan` from given data | Calls P2 for each variant |
| Decision | Never decides what data to test | Decides boundary values, edge cases |
| LLM | Does not use LLM | Uses LLM for semantically meaningful test data |

---

## 15. What P2 Does NOT Address

1. Test data generation (P3)
2. Execution (P4/P5)
3. Element creation/healing (Healing Service)
4. Locator re-ranking (Element.locatorStrategies already ranked)
5. Recording (Recorder)
6. Ambiguity resolution (P2 surfaces; humans or future UI resolve)
7. Cross-environment (each environment resolves against its own repository)
8. `entryPoint.elementName` click step (future enhancement)

---

## 16. elementBindings Rejection

Frozen `elementBindings: ReadonlyMap<string, string>` on `P2CapabilityContract`
rejected for three reasons established during R4 design:

1. **Element replacement:** Old UUID becomes stale. Immutable binding requires
   capability re-review for execution-level change.
2. **Environment specificity:** UUIDs are project-scoped. Single map can't
   represent multiple environments.
3. **Coupling:** Couples capability lifecycle with Element Repository state.

P2 uses dynamic resolution: session recovery + full identity recovery + R4
`matchElements()`. P2CapabilityContract remains pure (INV-P2-8).

---

## 17. Consistency Check Against Frozen P1 and R4

### P1 Consistency

- P2 reads `P2CapabilityContract` as published by P1 — no modification.
- `DataRequirement.field` maps to `LogicalAction.businessField` via P1's sourceInteractionType bridge.
- `InputMethod` enum is consumed but not modified.
- `SuccessCriterion` types are consumed but not modified.
- `sourceSessionId` on `CapabilityVersion` is the provenance link P2 depends on — this was an explicit P1 design decision.

**No contradictions.** P2 is a pure consumer of P1 outputs.

### R4 Consistency

- P2 uses `matchElements(freshUiElements, storedElements)` — the exact R4 API.
- P2 provides full 18-field `ElementIdentity` (recovered from rawInteractions), not reduced UiElementSummary.
- R4 scoring dimensions all participate: BUSINESS_IDS, FORM_NAME, ACCESSIBLE_NAME, ARIA_ROLE, ARIA_LABEL, ANCESTOR_ROLES, TAG, PAGE_SCOPE.
- R4 three-category semantics (MATCHED/AMBIGUOUS/UNMATCHED) respected exactly.
- `MATCH_THRESHOLD` (0.70) and `MIN_MARGIN` (0.05) used as-is.
- P2 uses `resolveElementTarget(element)` — the existing locator resolution function.
- P2 does NOT create, heal, or update Elements.

**No contradictions.** P2 is a pure consumer of R4 matching + locator infrastructure.

### Cross-Phase Safety

- P2 depends on `rawInteractions` being populated in RecordingSession. This is guaranteed by the recorder pipeline (Tier 1 permanent archival). If a future change strips rawInteractions, P2 fails safely (all fields unresolved).
- P2 depends on `sourceSessionId` being present on P2CapabilityContract. This is guaranteed by P1's `capabilityToContract()` mapper.
- P2 depends on `ElementRepository.getByProject()` returning Elements with `identity` records. Pre-R4 Elements (identity=null) fall back to locator-based signature in R4's `extractStoredSignature()`.

---

## 18. Known Limitations

1. **UiElementSummary used only for sourceUrl.** The 8-field summary is insufficient for matching; full identity is always recovered from rawInteractions. If rawInteractions is unavailable, the field is unresolved.

2. **rawEvents fallback lacks ancestorRoles.** If rawInteractions doesn't contain the element but rawEvents does, identity is recovered but ancestorRoles is null — the ANCESTOR_ROLES dimension (10%) scores neutral (0.5).

3. **Success criterion elementLocator is a string label.** It's matched as an accessibleName against session elements. If no element has that accessibleName, the assertion target is unresolved.

4. **No entryPoint.elementName click step.** P2 generates NAVIGATE to entryPoint.url but does not generate a click step for entryPoint.elementName in V1.

5. **No cross-environment resolution.** P2 resolves against the current project's Element Repository only.

6. **Session element IDs are session-scoped.** There is no stored mapping between session elementId and Element Repository UUID. P2 bridges this gap via full identity recovery + R4 matching at generation time.

---

## 19. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Source session pruned/deleted | Low | Sessions are Tier 1 permanent. If missing, fail safely. |
| rawInteractions empty for a field | Low | Try rawEvents fallback. If also missing, field unresolved. |
| Element Repository empty | Medium | All targets UNMATCHED → NoTarget everywhere. Correct but not executable. |
| Multiple requirements map to same session element | Low | Each maps to its own field → own logical action → own element |
| inputMethod is null | Medium | Fallback to IRAction.FILL |
| Success criterion elementLocator vague | Medium | Best-effort matching; if not found, warning + omit |
