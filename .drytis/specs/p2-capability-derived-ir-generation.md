# P2: Capability-Derived IR Generation — Design Document

**Status:** DESIGN (not yet implemented)
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
- `RecordingSession` (via `sourceSessionId`) — for semantic field/element binding
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

---

## 2. Data Flow: End-to-End Trace

### 2.1 Filter Products Example

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

**Test data variant 1 (from P3 in the future, or manually specified):**

```
{ category: "Electronics", onSale: true, maxPrice: 500 }
```

**Step 1 — Test Data Resolution (DataResolver)**

For each DataRequirement, resolve the concrete value from the TestData map:

| field | kind | inputMethod | constraint | resolved value |
|---|---|---|---|---|
| category | select | dropdown | options: [Electronics, Books, ...] | `"Electronics"` |
| onSale | boolean | toggle | — | `true` |
| maxPrice | number | slider | min:0, max:1000, step:50 | `500` |

Validation: each value satisfies its constraints. If a value is missing or invalid,
emit a data resolution warning and skip that field's IR step.

**Step 2 — Field/Element Binding (ElementBindingResolver)**

For each DataRequirement, resolve the session-scoped element that was the
recording-time target of this field. The binding pipeline:

```
contract.dataRequirements[].field
  → contract.sourceSessionId → RecordingSession
  → session.understandingResult.fragment.elements: UiElementSummary[]
  → session.understandingResult.fragment.logicalActions: LogicalAction[]
  → match LogicalAction.businessField === DataRequirement.field
  → get LogicalAction's componentId → find component.rootElementId
  → find UiElementSummary by elementId
  → build fresh UiElement-like identity from UiElementSummary
```

For Filter Products:

| field | logical action match | component | UiElementSummary |
|---|---|---|---|
| category | businessField="category" | comp-001 | { elementId: "elem-0007", tag: "select", role: "combobox", accessibleName: "Category" } |
| onSale | businessField="onSale" | comp-002 | { elementId: "elem-0012", tag: "input", role: "checkbox", accessibleName: "On Sale" } |
| maxPrice | businessField="maxPrice" | comp-003 | { elementId: "elem-0018", tag: "input", role: "slider", accessibleName: "Maximum Price" } |

If no logical action matches (reviewer manually added a data requirement), fall
back to matching UiElementSummary by accessibleName === DataRequirement.label.

If no session element matches either path, the field is **unbound** — produce
`NoTarget` + resolution warning.

**Step 3 — R4 Element Repository Resolution**

For each bound session element, match against the project's Element Repository
using R4's `matchElements()`:

```typescript
// Build fresh UiElement from UiElementSummary + session identity info
const freshElements: UiElement[] = sessionElements.map(buildFreshUiElement);
const storedElements: Element[] = await repos.elements.getByProject(projectId);
const result = matchElements(freshElements, storedElements);
```

For Filter Products:

| field | session element | match result | Element UUID | locators |
|---|---|---|---|---|
| category | elem-0007 (combobox, "Category") | MATCHED (0.95) | uuid-a1b2 | [testId:category-select, role:combobox[name="Category"]] |
| onSale | elem-0012 (checkbox, "On Sale") | MATCHED (0.90) | uuid-c3d4 | [testId:on-sale-toggle, role:checkbox[name="On Sale"]] |
| maxPrice | elem-0018 (slider, "Maximum Price") | MATCHED (0.92) | uuid-e5f6 | [css:input[type="range"], aria:slider] |

If any field resolves to AMBIGUOUS or UNMATCHED, P2 still produces a plan but
with that field's target as `NoTarget` and a warning. The plan is structurally
valid but marked as needing human attention before execution.

**Step 4 — Locator Resolution**

For each MATCHED field, reuse the existing `resolveElementTarget(element)` from
`generator.ts`:

```typescript
import { resolveElementTarget } from '../domain/execution-ir/generator';

const target: ElementTarget = resolveElementTarget(matchedElement);
// → { kind: 'element', elementId: 'uuid-a1b2', elementName: 'Category',
//     pageOrComponent: '/products',
//     resolvedLocators: [
//       { type: TEST_ID, value: 'category-select', priority: 1, confidence: 0.95 },
//       { type: ROLE, value: 'combobox[name="Category"]', priority: 2, confidence: 0.80 },
//     ] }
```

This reuses the existing locator-resolution path — Element.locatorStrategies are
already ranked and valid (healing maintains them). No re-ranking needed.

**Step 5 — IR Action Generation (inputMethod → IRAction)**

Map each DataRequirement's `inputMethod` to the appropriate `IRAction`:

| inputMethod | IRAction | input handling |
|---|---|---|
| `dropdown` | `IRAction.SELECT` | `input: string` (option label) |
| `toggle` | `IRAction.TOGGLE` | `input: boolean` (checked state) |
| `slider` | `IRAction.FILL` | `input: number` (target value) |
| `text` | `IRAction.FILL` | `input: string` (text to type) |
| `datePicker` | `IRAction.SELECT_DATE` | `input: string` (ISO date) |
| `fileUpload` | `IRAction.FILL` | `input: string` (file path) |
| `null` | `IRAction.FILL` | fallback to text input |

For Filter Products:

| field | inputMethod | IRAction | resolved value | target |
|---|---|---|---|---|
| category | dropdown | SELECT | "Electronics" | ElementTarget(uuid-a1b2) |
| onSale | toggle | TOGGLE | true | ElementTarget(uuid-c3d4) |
| maxPrice | slider | FILL | 500 | ElementTarget(uuid-e5f6) |

**Step 6 — Success Criterion Assertion Generation**

Map each SuccessCriterion to `IRAssertion[]`:

| SuccessType | ValidationType | ValidationComparison | target resolution |
|---|---|---|---|
| `navigation` | `URL_MATCH` | `MATCHES` | UrlTarget(urlPattern) |
| `elementVisible` | `VISIBILITY` | `IS_TRUE` | ElementTarget via binding |
| `elementAbsent` | `VISIBILITY` | `IS_FALSE` | ElementTarget via binding |
| `valueEquals` | `ATTRIBUTE_MATCH` | `EQUALS` | ElementTarget via binding |
| `textPresent` | `TEXT_MATCH` | `CONTAINS` | UrlTarget(page scope) |
| `custom` | `CUSTOM` | `EQUALS` | NoTarget |

For Filter Products:

| criterion | type | assertion | target |
|---|---|---|---|
| sc1 (elementVisible: Product List) | VISIBILITY, IS_TRUE | check element visible | ElementTarget (match by accessibleName "Product List") |
| sc2 (textPresent: "Electronics") | TEXT_MATCH, CONTAINS | check page contains text | UrlTarget("/products") |

Success-criterion target resolution uses the same binding pipeline: try
`elementLocator` as accessibleName → match against session elements →
ElementMatchingService → Element Repository. If the criterion target is a URL
pattern, produce `UrlTarget` directly.

**Step 7 — Assemble ExecutionIRPlan**

```typescript
const plan: ExecutionIRPlan = {
  testCaseId: `p2-${contract.capabilityId}`,
  testCaseVersionId: `p2-${contract.versionId}-data-${variantId}`,
  testCaseVersionNumber: contract.versionNumber,
  title: `${contract.name} — ${variantLabel}`,
  tags: ['capability-derived', 'p2'],
  environment: { baseUrl, browser: 'chrome', viewport: { width: 1280, height: 720 } },
  steps: [
    // Injected navigation step
    { id: 'step-0', order: 0, action: IRAction.NAVIGATE,
      description: `Navigate to ${contract.entryPoint.url}`,
      target: { kind: 'url', url: `${baseUrl}${contract.entryPoint.url}` },
      input: null,
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    // Field steps
    { id: 'step-1', order: 1, action: IRAction.SELECT,
      description: 'Select "Electronics" from Category dropdown',
      target: ElementTarget(uuid-a1b2),
      input: 'Electronics',
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    { id: 'step-2', order: 2, action: IRAction.TOGGLE,
      description: 'Toggle On Sale to true',
      target: ElementTarget(uuid-c3d4),
      input: true,
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    { id: 'step-3', order: 3, action: IRAction.FILL,
      description: 'Set Maximum Price to 500',
      target: ElementTarget(uuid-e5f6),
      input: 500,
      assertions: [], executionParameters: DEFAULT_EXECUTION_PARAMETERS },
    // Success criteria as assertions on the last step
    { id: 'step-4', order: 4, action: IRAction.VERIFY,
      description: 'Verify success criteria',
      target: { kind: 'none' },
      input: null,
      assertions: [
        { type: VISIBILITY, comparison: IS_TRUE, expectedValue: true,
          severity: HARD, target: ElementTarget(productListUuid), property: 'visible' },
        { type: TEXT_MATCH, comparison: CONTAINS, expectedValue: 'Electronics',
          severity: SOFT, target: { kind: 'url', url: `${baseUrl}/products` }, property: 'text' },
      ],
      executionParameters: DEFAULT_EXECUTION_PARAMETERS },
  ],
};
```

### 2.2 Different Data Sets — No Re-recording Required

For a second variant `{ category: "Books", onSale: false, maxPrice: 200 }`:

- Steps 1-3 (binding + matching + locator resolution) produce the **same** targets
  — the elements are the same, only the test data changes.
- Step 5 (action generation) produces different `input` values.
- The `ExecutionIRPlan` is structurally identical except for `input` fields and
  the `testCaseVersionId`/`title`.

For P3 (future): P3 generates many data variants, calls P2 for each, gets back
many `ExecutionIRPlan` instances — each testing the same capability with
different data.

---

## 3. Target Resolution: R4 Outcomes

### 3.1 MATCHED → Generate Target-Bearing IR

When `matchElements` returns a MATCHED pair for a field's session element:

1. Extract the matched `Element` (UUID, locatorStrategies, logicalName).
2. Call `resolveElementTarget(element)` → `ElementTarget` with resolved locators.
3. Use this `ElementTarget` as the step's `target`.

The locators are the **current** healed locators from the Element Repository —
if the DOM changed since recording and healing updated the locators, the IR
plan automatically picks up the new locators. This is the core advantage of
dynamic resolution over frozen bindings.

### 3.2 AMBIGUOUS → Do Not Guess; Surface Unresolved Target

When `matchElements` returns AMBIGUOUS:

1. Produce `NoTarget` for this field's step.
2. Add a `ResolutionWarning` to the plan's metadata:

```typescript
interface ResolutionWarning {
  readonly field: string;
  readonly reason: 'ambiguous' | 'unmatched' | 'no-session-element' | 'no-logical-action';
  readonly message: string;
  readonly candidates?: ReadonlyArray<{ elementId: string; matchScore: number }>;
}
```

3. The step is structurally present (correct action, correct input) but has no
   executable target. The plan is marked as `hasUnresolvedTargets: true`.
4. **P2 does NOT call matchElements itself.** It uses the binding resolver which
   queries the Element Repository and calls matchElements for the field's
   session element only.

### 3.3 UNMATCHED → Do Not Execute Against Assumed Element; Surface Unavailable

When `matchElements` returns UNMATCHED (no stored Element above threshold):

1. Produce `NoTarget` for this field's step.
2. Add a `ResolutionWarning` with reason `'unmatched'`.
3. The field may be genuinely new (added to the app after recording) or the
   Element Repository may not have an entry for it (healing didn't run or
   didn't create this element).

### 3.4 Recovery Strategies (Future, NOT P2)

AMBIGUOUS and UNMATCHED targets surface human-actionable warnings. In future
phases:
- Re-recording the capability and re-approving would refresh the session
  elements and allow healing to create/update Elements.
- A manual element-binding UI could let users disambiguate.
- P2 does NOT implement any of these — it only surfaces the problem.

---

## 4. Component Design

### 4.1 New Types

#### TestData

```typescript
/** Concrete test values keyed by DataRequirement.field. */
type TestData = ReadonlyMap<string, string | number | boolean>;
```

#### ResolutionWarning

```typescript
interface ResolutionWarning {
  readonly field: string;
  readonly reason: 'ambiguous' | 'unmatched' | 'no-session-element' | 'no-logical-action';
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

### 4.2 New Modules

#### src/domain/generation/capability-ir-generator.ts

The orchestrator. Single entry point:

```typescript
async function generateCapabilityIR(
  input: P2GenerationInput,
  uowFactory: UnitOfWorkFactory,
): Promise<CapabilityIRResult>
```

Flow:
1. Recover the source RecordingSession via `contract.sourceSessionId`.
2. Call `ElementBindingResolver` to map each DataRequirement → session element.
3. Call `ElementMatchingService.matchElements()` for all bound session elements
   against the project's Element Repository.
4. For each MATCHED field: call `resolveElementTarget(element)` → ElementTarget.
5. For each DataRequirement: call `DataResolver` to get the concrete value.
6. For each DataRequirement: map `inputMethod` → `IRAction`.
7. For each SuccessCriterion: call `SuccessCriterionResolver` → IRAssertion[].
8. Assemble `ExecutionIRPlan` + warnings.

#### src/domain/generation/data-resolver.ts

Pure function module — no I/O, no repository access.

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

Missing required fields → warning + skip.
Invalid values → warning + skip.
Optional missing → use `defaultValue` or skip.

#### src/domain/generation/element-binding-resolver.ts

Resolves DataRequirement.field → UiElementSummary from the source session.

```typescript
function resolveFieldBindings(
  requirements: readonly DataRequirement[],
  session: RecordingSession,
): { bindings: Map<string, UiElementSummary>; warnings: BindingWarning[] }
```

Resolution pipeline (per requirement):
1. **Primary:** Find a LogicalAction in `session.fragment.logicalActions` where
   `businessField === requirement.field`. Get its componentId → component's
   `rootElementId` → find UiElementSummary by `elementId`.
2. **Fallback:** Find a UiElementSummary where `accessibleName === requirement.label`.
3. **No match:** Warning with reason `'no-logical-action'` or `'no-session-element'`.

Note: The UiElementSummary has limited identity (tag, role, accessibleName,
sourceUrl). To use R4's `matchElements`, we need to build a `UiElement`-like
identity. See §4.3.

#### src/domain/generation/success-criterion-resolver.ts

Resolves SuccessCriterion → IRAssertion, including target resolution.

```typescript
async function resolveSuccessCriteria(
  criteria: readonly SuccessCriterion[],
  session: RecordingSession,
  storedElements: readonly Element[],
  environment: IREnvironment,
): Promise<{ assertions: IRAssertion[]; warnings: ResolutionWarning[] }>
```

Mapping:

| SuccessType | ValidationType | Comparison | Target |
|---|---|---|---|
| navigation | URL_MATCH | MATCHES | UrlTarget(pattern) |
| elementVisible | VISIBILITY | IS_TRUE | ElementTarget (via session binding → matchElements) |
| elementAbsent | VISIBILITY | IS_FALSE | ElementTarget (via session binding → matchElements) |
| valueEquals | ATTRIBUTE_MATCH | EQUALS | ElementTarget (via session binding → matchElements) |
| textPresent | TEXT_MATCH | CONTAINS | UrlTarget(page URL) |
| custom | CUSTOM | EQUALS | NoTarget |

Element-based criteria use the same binding + matching pipeline as field targets.

### 4.3 Session Element → UiElement Identity Adapter

R4's `matchElements` takes `UiElement[]`. Session elements are `UiElementSummary`,
which has only 8 fields (no full ElementIdentity). We need an adapter:

```typescript
function buildMatchableElement(summary: UiElementSummary): UiElement {
  return createUiElement({
    elementId: summary.elementId,
    identity: {
      accessibleName: summary.accessibleName,
      ariaRole: summary.role,
      tag: summary.tag,
      // Other fields are null — we match on what's available
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: '',
      xPath: '',
      inIframe: false,
      shadowDom: false,
      elementId: summary.elementId,
    },
    sourceUrl: summary.sourceUrl,
    domTreePath: '',
  });
}
```

This is a **deliberate data loss** — UiElementSummary doesn't carry testId,
dataCy, dataQa, name, or ariaLabel. Matching will rely primarily on
accessibleName + role + tag + sourceUrl.

**Impact on scoring:** With the R4 calibrated scoring policy:
- accessibleName match (20%): 1.0
- ariaRole match (10%): 1.0 if role matches
- tag match (5%): 1.0 if tag matches
- sourceUrl match (5%): 1.0 if same page
- businessIds (25%): 0.5 neutral (both sides missing in session elements)
- name (15%): 0.5 neutral
- ariaLabel (10%): 0.5 neutral
- ancestorRoles (10%): 0.5 neutral

**Best-case score: 0.40** (accessibleName 0.20 + role 0.10 + tag 0.05 + url 0.05)
**With neutrals: + 0.30** (25+15+10+10 weighted at 0.5)
**Total best case: 0.70** — exactly at MATCH_THRESHOLD.

This is **insufficient for reliable matching**. See §5.

---

## 5. Critical Gap: Identity Information Loss in Session Persistence

### 5.1 The Problem

The binding pipeline depends on `matchElements(freshUiElements, storedElements)`.
But session elements are stored as `UiElementSummary` (8 fields), not full
`UiElement` (with 18-field `ElementIdentity`). The summary drops:

- `testId`, `dataCy`, `dataQa` (business IDs — 25% weight)
- `name` (form name — 15% weight)
- `ariaLabel` (10% weight)
- `ancestorRoles` (10% weight)
- `className`, `placeholder`, `stableId`, `cssSelector`, `xPath`

With only accessibleName + role + tag + sourceUrl available from the summary,
the best achievable score is **0.70** — exactly at MATCH_THRESHOLD. Any
slight difference (different role, different page) pushes it below.

### 5.2 Existing Architecture Provides the Solution

The UiElementSummary identity gap is **not a new problem** — it's the same gap
identified during R4 analysis. The Element Repository's Element entities have
full `ElementIdentityRecord` (9 fields, R4). The issue is that session
elements are stored in a reduced form.

However, the **existing architecture already provides a more direct path**:

The `ElementMatchingService` was designed to match `UiElement` against stored
`Element`. But for P2, we don't actually need to match a session element
against stored elements using the full scoring pipeline. We need something
simpler: **given a session element (UiElementSummary), find the stored Element
that represents the same logical UI control.**

The existing `healing-service.ts` already solves this during recording. When
a recording session is processed, `healFromRecording()` matches session
elements against stored Elements and creates/heals as needed. After healing,
the **Element Repository contains the correct Elements with healed locators**.

The key insight: P2 doesn't need to re-match. It needs to **find the Elements
that were already matched/created during healing of the source session**.

### 5.3 The ElementRepository Lookup Path

Instead of building fresh UiElements and calling matchElements, P2 can use a
**direct lookup** approach:

1. **Via logical actions:** The session's fragment has logical actions with
   `businessField` values matching DataRequirement.field. Each logical action
   has a `componentId`. The component has a `rootElementId` — a session-scoped
   element ID (e.g., `elem-0007`).

2. **Via session elements:** The UiElementSummary carries `elementId` — the
   same session-scoped ID. It also carries `sourceUrl` (page scope).

3. **Via Element identity:** Each stored Element has:
   - `identity.accessibleName` — should match UiElementSummary.accessibleName
   - `identity.ariaRole` — should match UiElementSummary.role
   - `identity.tag` — should match UiElementSummary.tag
   - `pageOrComponent` — should match UiElementSummary.sourceUrl

4. **Direct matching:** For each session element, filter stored Elements by
   `projectId` + `pageOrComponent === sourceUrl`, then match by:
   - `identity.accessibleName === summary.accessibleName` (primary)
   - `identity.ariaRole === summary.role` (secondary)
   - `identity.tag === summary.tag` (tertiary)

   If exactly one match → use it.
   If multiple matches → AMBIGUOUS (same as R4).
   If zero matches → UNMATCHED.

This is a **simpler, more reliable** path than the full scoring pipeline
because:
- We know the page scope (sourceUrl → pageOrComponent)
- We know the semantic identity (accessibleName, role, tag)
- We're looking up existing Elements, not scoring similarity

### 5.4 P2's ElementBindingResolver Design

```typescript
interface FieldBinding {
  readonly field: string;
  readonly sessionElement: UiElementSummary | null;
  readonly resolutionMethod: 'logical-action' | 'accessible-name' | 'none';
}

interface ResolvedTarget {
  readonly field: string;
  readonly target: ElementTarget | NoTarget;
  readonly warning: ResolutionWarning | null;
  readonly matchScore: number | null;
}
```

The resolver:
1. Map DataRequirement → UiElementSummary via logical actions / accessible name.
2. For each UiElementSummary, query `repos.elements.getByPageComponent(projectId, sourceUrl)`.
3. Filter candidates by `identity.accessibleName === summary.accessibleName`.
4. If exactly 1 → ElementTarget via `resolveElementTarget(element)`.
5. If >1 → check role/tag to disambiguate. If still >1 → AMBIGUOUS.
6. If 0 → UNMATCHED.

This approach:
- **Reuses** the existing `ElementRepository.getByPageComponent()` query
- **Reuses** the existing `resolveElementTarget(element)` function
- **Respects** R4's three-category semantics (MATCHED/AMBIGUOUS/UNMATCHED)
- **Does not** call matchElements (which requires UiElement construction)
- **Does not** create or heal Elements
- **Does not** depend on UiElementSummary having full identity

---

## 6. Concrete Trace: Filter Products End-to-End

### 6.1 Input

```
contract = { sourceSessionId: "sess-abc123", ... }
testData = { category: "Electronics", onSale: true, maxPrice: 500 }
projectId = "proj-001"
environment = { baseUrl: "https://app.example.com", browser: "chrome", ... }
```

### 6.2 Session Recovery

```typescript
const session = await repos.recordingSessions.getById("sess-abc123");
// → RecordingSession with understandingResult.fragment
```

Fragment contains:
- `elements`: UiElementSummary[] — includes elem-0007 (Category), elem-0012 (On Sale), elem-0018 (Maximum Price)
- `logicalActions`: LogicalAction[] — includes actions with businessField "category", "onSale", "maxPrice"
- `components`: ComponentSummary[] — includes comp-001 (dropdown), comp-002 (checkbox), comp-003 (slider)

### 6.3 Binding + Resolution

```
DataRequirement "category" (field="category")
  → LogicalAction { businessField: "category", componentId: "comp-001" }
  → ComponentSummary { rootElementId: "elem-0007" }
  → UiElementSummary { elementId: "elem-0007", accessibleName: "Category", tag: "select", role: "combobox", sourceUrl: "/products" }
  → ElementRepository.getByPageComponent("proj-001", "/products")
  → Filter by identity.accessibleName === "Category"
  → Found: Element { id: "uuid-a1b2", locatorStrategies: [testId, role], identity: { accessibleName: "Category", ... } }
  → resolveElementTarget(element) → ElementTarget { resolvedLocators: [...] }
  → MATCHED, score: 1.0 (exact accessibleName + page match)
```

### 6.4 IR Step Generation

```
Step 0: NAVIGATE → { kind: 'url', url: 'https://app.example.com/products' }, input: null
Step 1: SELECT → ElementTarget(uuid-a1b2), input: "Electronics"
Step 2: TOGGLE → ElementTarget(uuid-c3d4), input: true
Step 3: FILL → ElementTarget(uuid-e5f6), input: 500
Step 4: VERIFY → NoTarget, assertions: [VISIBILITY(productList), TEXT_MATCH("Electronics")]
```

### 6.5 Second Variant (No Re-recording)

```
testData = { category: "Books", onSale: false, maxPrice: 200 }
```

Binding + resolution produces **identical** ElementTargets (same elements,
same locators). Only input values change:

```
Step 1: SELECT → ElementTarget(uuid-a1b2), input: "Books"
Step 2: TOGGLE → ElementTarget(uuid-c3d4), input: false
Step 3: FILL → ElementTarget(uuid-e5f6), input: 200
```

---

## 7. Provenance and Reproducibility

### 7.1 Provenance

Each generated `ExecutionIRPlan` carries:
- `testCaseId: p2-{capabilityId}` — links to the capability
- `testCaseVersionId: p2-{versionId}-data-{variantId}` — unique per data variant
- Tags: `['capability-derived', 'p2']`

### 7.2 Reproducibility

The same `(contract, testData, projectId, environment)` tuple always produces
the same IR plan (INV-P2-7), because:
- Contract is immutable (version snapshot)
- TestData is an input parameter
- Element Repository is read-only from P2's perspective
- `resolveElementTarget` is a pure function of Element

The only non-determinism: if the Element Repository's locators have been healed
between two P2 invocations, the resolved locators will differ. This is **correct
behavior** — the IR plan should use the latest healed locators.

### 7.3 Traceability

```
ExecutionIRPlan.testCaseId → Capability.id
ExecutionIRPlan.testCaseVersionId → CapabilityVersion.versionId
P2CapabilityContract.sourceSessionId → RecordingSession.id (original recording)
CapabilityIRResult.resolvedFields[].elementId → Element.id (repository UUID)
```

---

## 8. IR Compatibility

P2 produces plans that use:
- `ExecutionIRPlan` — identical to existing
- `IRStep` — identical to existing
- `IRAction` — subset of existing enum (NAVIGATE, SELECT, TOGGLE, FILL, SELECT_DATE, VERIFY)
- `ElementTarget`, `UrlTarget`, `NoTarget` — identical to existing
- `ResolvedLocator` — identical to existing
- `IRAssertion` — identical to existing

**No new IR types.** P2's output is directly consumable by the existing execution
infrastructure (P4/P5) and IR renderers (Playwright adapter, etc.).

P2 does **not** use recording-specific IR fields (`sourceEventId`, `aiEnrichment`,
`plainEnglish`, `intent`, `evidenceTrail`) — these are absent in P2-generated steps.

---

## 9. Failure Semantics

| Scenario | Behavior |
|---|---|
| Source session not found | Throw error — cannot generate plan without provenance |
| No logical action matches a data requirement field | Warning `no-logical-action`, try accessible-name fallback |
| No session element matches by accessible name | Warning `no-session-element`, NoTarget |
| No stored Element matches | Warning `unmatched`, NoTarget |
| Multiple stored Elements match | Warning `ambiguous`, NoTarget, list candidates |
| Test data value missing for required field | Warning `missing-required`, skip step |
| Test data value fails constraint validation | Warning `invalid-value`, skip step |
| Success criterion target unresolvable | Warning, assertion omitted from plan |
| Element Repository empty (no Elements for project) | All fields UNMATCHED, plan has NoTarget everywhere |

Plans with `hasUnresolvedTargets: true` are structurally valid but marked for
human attention. They should NOT be auto-executed without review.

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
- `resolveFieldBindings(requirements, session)` → field → UiElementSummary bindings
- Uses LogicalAction.businessField, ComponentSummary.rootElementId, UiElementSummary matching

### Step 4: ElementTargetResolver

Create `src/domain/generation/element-target-resolver.ts`:
- `resolveTargets(bindings, storedElements)` → field → ElementTarget | NoTarget
- Uses pageOrComponent query + accessibleName/role/tag matching
- Returns MATCHED/AMBIGUOUS/UNMATCHED per R4 semantics

### Step 5: SuccessCriterionResolver

Create `src/domain/generation/success-criterion-resolver.ts`:
- `resolveSuccessCriteria(criteria, session, storedElements, environment)` → IRAssertion[]

### Step 6: IR Action Mapper

Create `src/domain/generation/ir-action-mapper.ts`:
- `inputMethodToIRAction(inputMethod)` → IRAction
- `INPUTMETHOD_TO_IRACTION` constant map

### Step 7: CapabilityIRGenerator

Create `src/domain/generation/capability-ir-generator.ts`:
- Orchestrates Steps 2-6 via UnitOfWork
- Single async entry point

### Step 8: Tests

Create tests:
- `tests/p2-gates.test.ts` — P2 exit criteria tests
- Unit tests for DataResolver, ElementBindingResolver, ElementTargetResolver
- Integration tests for CapabilityIRGenerator with mock sessions/elements

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
| EC5 | MATCHED target → ElementTarget with resolved locators | target-resolver unit test |
| EC6 | AMBIGUOUS target → NoTarget + warning, never guesses | target-resolver unit test |
| EC7 | UNMATCHED target → NoTarget + warning, never assumes | target-resolver unit test |
| EC8 | P2 never calls createElement/healElement/updateElement | Code audit + test |
| EC9 | Filter Products trace produces correct IR plan | Integration test with mock session |
| EC10 | Second data variant produces same targets, different inputs | Integration test |
| EC11 | Success criteria → IRAssertion mapping | success-criterion-resolver unit test |
| EC12 | Plan is compatible with existing ExecutionIRPlan type | tsc compilation |
| EC13 | All regression gates green (G1-G10) | CI run |
| EC14 | hasUnresolvedTargets flag set when any target is NoTarget | Integration test |

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
| INV-P2-8 | P2 does not add elementBindings or any execution binding to P2CapabilityContract |
| INV-P2-9 | P2 does not modify the source RecordingSession |
| INV-P2-10 | P2 does not produce DRAG_DROP or PRESS_KEY actions (not authorable from DataRequirement) |

---

## 14. P2/P3 Boundary

| Concern | P2 | P3 |
|---|---|---|
| Test data | Accepts `TestData` input | Generates `TestData` variants |
| IR plan | Produces `ExecutionIRPlan` from given data | Calls P2 for each variant |
| Decision | Never decides what data to test | Decides boundary values, edge cases, etc. |
| LLM | Does not use LLM | Uses LLM to generate semantically meaningful test data |

P3 will import `generateCapabilityIR()` and call it multiple times with different
`TestData` maps, producing multiple `ExecutionIRPlan` instances.

---

## 15. What P2 Does NOT Address (Explicitly Out of Scope)

1. **Test data generation** — P3's job. P2 takes data as input.
2. **Execution** — P4/P5's job. P2 produces IR plans.
3. **Element creation/healing** — Healing Service's job. P2 reads Elements only.
4. **Locator re-ranking** — Element.locatorStrategies are already ranked. P2 uses `resolveElementTarget()` as-is.
5. **Recording** — Recorder's job. P2 reads persisted sessions only.
6. **Ambiguity resolution** — P2 surfaces; humans or future UI resolve.
7. **Cross-environment** — Each environment has its own Element Repository. P2 resolves against the current project's repository.
8. **entryPoint.elementName** — P2 generates a NAVIGATE step to `entryPoint.url`. If `elementName` is specified (e.g., clicking a menu item to reach the page), P2 does NOT generate a click step for it in V1 — this is a future enhancement.

---

## 16. elementBindings Rejection

The earlier P2 design proposal (Approach B) suggested adding `elementBindings:
ReadonlyMap<string, string>` to `P2CapabilityContract` — a frozen map of
field→Element UUID populated at P1 review approval.

**Rejected** for three reasons established during the R4 design analysis:

1. **Element replacement:** If an app redesign replaces the control, the old
   Element UUID becomes stale. An immutable binding would point at a dead UUID
   and require capability re-review for a purely execution-level change.

2. **Environment specificity:** Element UUIDs are project-scoped. Different
   environments (dev/staging/prod) have different Element Repositories with
   different UUIDs. A single frozen map cannot represent all environments.

3. **Coupling:** Putting execution-layer bindings into P1's immutable
   capability contract creates false coupling between capability lifecycle
   and Element Repository state.

**Instead, P2 uses dynamic resolution:** At generation time, P2 recovers the
source session, binds each field to a session element, and matches against the
current Element Repository. This approach:
- Automatically picks up healed locators
- Works across environments (each resolves against its own repository)
- Doesn't require capability re-review for DOM changes
- Respects R4's three-category semantics

P2CapabilityContract remains pure: no element bindings, no execution-layer
details. (INV-P2-8)

---

## 17. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| UiElementSummary lacks identity for reliable matching | Medium | Direct lookup by accessibleName + page scope (§5.4) instead of full scoring |
| Source session pruned/deleted | Low | Sessions are Tier 1 permanent (INV-RS1). If missing, throw. |
| Element Repository empty for project | Medium | All targets UNMATCHED → plan with all NoTarget + warnings. Correct but not executable. |
| Multiple data requirements map to same session element | Low | Each requirement maps to its own field → its own logical action → its own element |
| inputMethod is null (reviewer didn't set it) | Medium | Fallback to IRAction.FILL with text input |
| Success criterion elementLocator is vague | Medium | Best-effort matching by accessibleName; if not found, warning + omit assertion |
