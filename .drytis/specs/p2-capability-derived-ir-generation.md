# P2: Capability-Derived IR Generation — Design Document

> **Status:** DESIGN — not yet implemented
> **Baseline:** Post-P1 frozen baseline `b3e14fe`
> **Depends on:** P1 (Capability Lifecycle Management) ✅
> **Feeds:** P3 (AI Test Generation), P4/P5 (Execution)
> **Design principle:** *"Observation is immutable, capability is versioned, IR is disposable, implementation is replaceable."*

---

## §1. Objective

Generate an `ExecutionIRPlan` from an approved `P2CapabilityContract` — without requiring the flow to be recorded again. This transforms the product from a record-and-replay tool into a capability-driven test platform: record once, approve the capability, then generate executable test plans with different data against the current application state.

---

## §2. What P2 Consumes

P2's **sole input** is the `P2CapabilityContract` (INV-P1-B4: P2/P3 never read `CapabilityCandidate` directly).

```typescript
interface P2CapabilityContract {
  capabilityId: string;
  versionId: string;              // immutable version reference
  versionNumber: number;
  name: string;
  purpose: string;
  dataRequirements: DataRequirement[];
  successCriteria: SuccessCriterion[];
  entryPoint: { url: string; elementName: string | null };
  sourceSessionId: string;        // provenance → RecordingSession
  approvedAt: string;
}
```

P2 also reads:
- **Element Repository** — to resolve targets (locators for each field)
- **Test data supplied by the caller** — P2 does NOT generate test data (that is P3)
- **IREnvironment** — baseUrl, browser, viewport

P2 does NOT read:
- `CapabilityCandidate` or `ApplicationKnowledgeFragment` (recorder artifacts)
- `ComponentInteraction[]` or `SessionEvent[]` (recording raw data)
- The IR Bridge (recording-time generation path)
- The evidence engine or classifier

---

## §3. Target Resolution — The Central Design Problem

### §3.1 The Gap

`DataRequirement` tells P2 *what operation* to perform (`inputMethod: 'slider'`) and *what data* (`kind: 'number'`, constraints), but not *which element* on the live page. The contract intentionally excludes locators — that abstraction was established in P1.

P2 must bridge: `DataRequirement.field` → concrete `ResolvedLocator[]` on the live application.

### §3.2 Analysis of the Two Approaches

**Approach A: Session Recovery at Generation Time**
- `sourceSessionId` → `RecordingSession` → `rawInteractions[]` → find interaction by field → `ElementIdentity` → `resolveLocatorsForIR(identity)`
- **Problem:** `rawInteractions` is archival tier (INV-RS3: "never queried by downstream consumers"). Sessions may be pruned. Matching `DataRequirement.field` to a specific interaction is fragile (name matching against metadata).
- **Problem:** ElementIdentity from the recording is a point-in-time snapshot. If the DOM has changed, these locators are stale. The Element Repository has healed locators; the session does not.
- **Problem:** Coupling P2 to session data violates the tier design. P2 becomes dependent on archival data that the architecture explicitly says should not be queried.

**Approach B: Element Repository via Element Bindings**
- Store Element Repository UUID on the contract at review approval time
- At generation, load `Element` by UUID → read `locatorStrategies[]` → `resolveElementTarget(element)`
- **Advantage:** Always uses current, healed locators
- **Advantage:** Same path as the existing `DefaultIRGenerator` (ATC IR generation)
- **Advantage:** No session dependency at generation time
- **Advantage:** Element UUIDs are stable across DOM changes, healing, and capability versioning
- **Concern:** How to populate the Element UUID at approval time

### §3.3 Decision: Approach B with Session-Assisted Population

**P2 proposes adding `elementBindings` to `P2CapabilityContract`.**

```typescript
interface P2CapabilityContract {
  // ... existing fields ...
  /**
   * Maps DataRequirement.field → Element Repository UUID.
   * Populated at review approval time. Enables P2 to resolve
   * targets without session data at generation time.
   *
   * Empty map if no bindings could be resolved — P2 falls back
   * to session recovery or flags steps as unresolved.
   */
  readonly elementBindings: ReadonlyMap<string, string>;
}
```

This is an **additive change** to a P1 entity. It does not modify DataRequirement (which stays pure). The bindings are a separate concern — they sit on the contract, not on the semantic abstraction.

**Why this is the correct long-term architecture:**

1. **Locators heal over time.** The Element Repository's `healElement()` updates locatorStrategies while preserving the Element UUID. By referencing UUIDs, P2-generated plans always use the latest healed locators. Session recovery would use stale point-in-time snapshots.

2. **Capability versions are immutable.** When a capability is edited (creating a new version), the elementBindings snapshot is frozen in that version. Future healing updates the Element but not the UUID — so the old version's plans still work with current locators when regenerated.

3. **Two fields with similar names.** Element UUIDs are globally unique. Name-based matching (Approach A) would be ambiguous when two fields share a label. UUIDs eliminate this.

4. **Same semantic field appears multiple times on a page.** Each instance is a separate Element with its own UUID. The binding links to the specific one.

5. **Capability executed long after recording.** The Element Repository persists independently of sessions. Even if the original session is pruned (archival tier cleanup), the Elements remain.

6. **P3 generates many variants.** P3 calls P2 repeatedly with different test data. Each call resolves Element UUIDs in O(1) — no session lookup per call.

7. **Target cannot be resolved confidently.** When no Element binding exists, P2 flags the step as unresolved. The user can manually bind it. No silent failures.

### §3.4 Element Binding Population (at P1 Review Approval)

At review approval time, `processDecision()` already loads the session to get the candidate and success indicators. The element binding population adds one step:

```
For each CapabilityInput in candidate.inputs[]:
  1. Get fragment elementId (e.g., "elem-0007")
  2. Load fragment.elements[] → find UiElementSummary by elementId → get accessibleName
  3. Load Element Repository for project (repos.elements.getByProject)
  4. Match via ElementMatchingService.extractSignature() → find best Element
  5. Store Element UUID in elementBindings[field]
```

This uses the **existing** `ElementMatchingService` — no new matching logic. If no match is found (e.g., healing hasn't created the Element yet, or the element was a navigation-only element), the field gets no binding. P2 handles this gracefully (§3.5).

**Note:** This is a P1 completion change (populating elementBindings in `processDecision`), not a P2 implementation step. P2's design assumes elementBindings may already be populated. P2 should work whether bindings exist or not.

### §3.5 Unresolved Target Handling

When `elementBindings[field]` is missing or the Element UUID can't be loaded:

1. **Session Recovery Fallback:** P2 attempts Approach A as a last resort — loads `RecordingSession` by `sourceSessionId`, searches `rawInteractions[]` for a matching field, extracts `ElementIdentity`, uses `resolveLocatorsForIR(identity)`. This produces locators but they may be stale.

2. **Unresolved Flag:** If both the Element Repository and session recovery fail, the IRStep is produced with `target: { kind: 'none' }` and a `resolutionWarning` field is set. The Playwright code generator emits a TODO comment. The execution engine skips the step with a "target not resolved" status.

3. **No Silent Failure:** Unresolved targets are always visible in the generated plan. The user can manually provide locators or re-record.

---

## §4. Architecture

### §4.1 New Components

P2 introduces four new modules. All live in `src/generation/capability-ir/`:

```
src/generation/capability-ir/
  ├── capability-ir-generator.ts    — orchestrator (entry point)
  ├── data-resolver.ts              — DataRequirement → concrete test value
  ├── element-binding-resolver.ts   — DataRequirement.field → ElementTarget
  └── success-criterion-resolver.ts — SuccessCriterion → IRAssertion[]
```

### §4.2 CapabilityIRGenerator (Orchestrator)

```typescript
interface CapabilityIRGeneratorInput {
  readonly contract: P2CapabilityContract;
  readonly testData: ReadonlyMap<string, IRInput>;  // field → value, supplied by caller
  readonly elements: ReadonlyMap<string, Element>;   // pre-loaded by caller
  readonly environment: IREnvironment;
  readonly sessionFallback?: RecordingSession | null; // optional, for target recovery
}

interface CapabilityIRGenerator {
  generate(input: CapabilityIRGeneratorInput): ExecutionIRArtifact;
  readonly version: string;  // 'cap-ir-gen-1.0.0'
}
```

**Generation Process:**

```
1. Navigate step (from contract.entryPoint.url)
2. For each DataRequirement:
   a. Resolve test value via DataResolver
   b. Resolve target via ElementBindingResolver
   c. Map inputMethod → IRAction
   d. Build IRStep
3. Entry point click step (from contract.entryPoint.elementName)
4. For each SuccessCriterion:
   a. Resolve to IRAssertion via SuccessCriterionResolver
5. Attach assertions to the entry point click step
6. Inject WAIT_FOR_ELEMENT before element-interacting steps
7. Wrap in ExecutionIRArtifact
```

**Design:** The generator is a **pure function** — no side effects, no storage access. The caller (service layer) pre-loads Elements and supplies test data. This matches the existing `DefaultIRGenerator` design pattern.

### §4.3 DataResolver

```typescript
interface DataResolver {
  /**
   * Resolve a DataRequirement to a concrete test value.
   * Priority: caller-supplied testData > defaultValue > constraint-derived.
   */
  resolve(requirement: DataRequirement, testData: IRInput | undefined): IRInput;
}
```

**Resolution priority:**
1. **Caller-supplied** (from `testData` map) — always wins. P3 supplies these; manual execution supplies these.
2. **defaultValue** (from DataRequirement) — if the reviewer set one during P1 review.
3. **Constraint-derived fallback** — generated from `kind` + `constraints`:
   - `select` → first option from `constraints.options`
   - `boolean` → `true`
   - `number` → midpoint of `constraints.min`/`constraints.max` (or 0)
   - `text` → empty string `""` (or pattern-matching placeholder if `constraints.pattern`)
   - `date` → today's date
   - `email` → `"test@example.com"`

**Critical boundary:** DataResolver does NOT generate intelligent test variants. That is P3 (AI Test Generation). DataResolver produces only the minimal value needed to execute the capability. P3 overrides `testData` with generated variants.

### §4.4 ElementBindingResolver

```typescript
interface ElementBindingResolver {
  /**
   * Resolve a DataRequirement.field to an ElementTarget with locators.
   * Returns { target: ResolvedTarget, confidence: number, source: string }.
   */
  resolve(
    field: string,
    elementBindings: ReadonlyMap<string, string>,
    elements: ReadonlyMap<string, Element>,
    sessionFallback?: RecordingSession | null,
  ): ElementBindingResult;
}

interface ElementBindingResult {
  readonly target: ResolvedTarget;
  readonly confidence: number;   // 0.0-1.0
  readonly source: 'element-repository' | 'session-recovery' | 'unresolved';
}
```

**Resolution cascade:**
1. **Element Repository (primary):** Look up `elementBindings[field]` → UUID → `elements.get(uuid)` → `resolveElementTarget(element)`. Confidence: 0.95 (healed, current).
2. **Session Recovery (fallback):** Load `sessionFallback.rawInteractions[]` → find interaction whose metadata field matches → extract `ElementIdentity` → `resolveLocatorsForIR(identity)`. Confidence: 0.60 (point-in-time, may be stale).
3. **Unresolved:** `target: { kind: 'none' }`. Confidence: 0.0. Step flagged with `resolutionWarning`.

**Reuse:** `resolveElementTarget()` is imported directly from `src/domain/execution-ir/generator.ts`. `resolveLocatorsForIR()` is imported from `src/generation/ir-bridge.ts`. No duplication.

**Boundary:** ElementBindingResolver does NOT match elements by name or fuzzy logic. It reads pre-resolved bindings from the contract. The matching happened at review approval time via `ElementMatchingService`. This keeps P2 deterministic and testable.

### §4.5 SuccessCriterionResolver

```typescript
interface SuccessCriterionResolver {
  resolve(
    criteria: readonly SuccessCriterion[],
    elementBindings: ReadonlyMap<string, string>,
    elements: ReadonlyMap<string, Element>,
    contract: P2CapabilityContract,
  ): IRAssertion[];
}
```

**Mapping table:**

| SuccessCriterion.type | IRAssertion.type | IRAssertion.comparison | Target Resolution |
|---|---|---|---|
| `navigation` | `URL_MATCH` | `EQUALS` | `UrlTarget { url: target.urlPattern }` |
| `elementVisible` | `VISIBILITY` | `IS_TRUE` | Element from `target.elementLocator` or elementBindings |
| `elementAbsent` | `VISIBILITY` | `IS_FALSE` | Element from `target.elementLocator` |
| `valueEquals` | `EQUALITY` | `EQUALS` | Element + `expectedValue` |
| `textPresent` | `TEXT_MATCH` | `CONTAINS` | Element from `target.elementLocator` |
| `custom` | `CUSTOM` | `NONE` | Element if locator provided |

**Target resolution for assertions:**

Success criteria have a `target` field (`SuccessTarget`) that may contain `elementLocator` (a CSS selector string from the original recording). P2 resolves this in priority order:

1. If `elementLocator` is present and looks like a CSS selector → create `ElementTarget` with a single `CSS` locator
2. If no `elementLocator` → attempt elementBindings match by criterion description
3. If neither works → `NoTarget` with the assertion still emitted (runtime evaluation may still work for URL-based assertions)

**Severity:** All success-criteria-derived assertions are `HARD` — they represent the capability's definition of success. This differs from recording-time assertions (which mix HARD and SOFT).

**Reuse:** The IRAssertion type, ValidationType, ValidationComparison, and ValidationSeverity enums are all reused from `src/domain/enums.ts` and `src/domain/execution-ir/types.ts`. The assertion renderer (`src/adapters/playwright/assertion-renderer.ts`) already handles all these types — no renderer changes needed.

---

## §5. InputMethod → IRAction Mapping

P2 maps at the `InputMethod` abstraction level (not `InteractionType`). This is deliberately coarser:

| InputMethod | IRAction | Rationale |
|---|---|---|
| `dropdown` | `SELECT` | Select an option from a list |
| `toggle` | `TOGGLE` | Flip a boolean state |
| `slider` | `FILL` | Set a numeric value (same as recording-time IR Bridge) |
| `text` | `FILL` | Type text into an input |
| `datePicker` | `SELECT_DATE` | Pick a date |
| `fileUpload` | `FILL` | Provide a file path |
| `null` | `CLICK` | Fallback for non-data-input triggers (buttons, links) |

This is a **lossless collapse** — `InputMethod` was designed in P1 as a many-to-one mapping from `InteractionType`. The 23 `InteractionType` values collapse to 6 `InputMethod` values, which collapse to 6 `IRAction` values. No semantic information is lost because the collapse already happened at the P1 boundary.

**Entry point element** (the "Apply Filters" button, "Submit" button, etc.) always maps to `CLICK`, regardless of its `inputMethod`.

---

## §6. Complete Filter Products Trace

### Contract Input

```typescript
const contract: P2CapabilityContract = {
  capabilityId: "cap-filter-products",
  versionId: "cap-filter-products-v1",
  versionNumber: 1,
  name: "Filter Products",
  purpose: "Filter the product list by category, sale status, and price",
  dataRequirements: [
    { field: "category", label: "Category", kind: "select", inputMethod: "dropdown",
      constraints: { options: ["Electronics", "Clothing", "Books"] } },
    { field: "onSale", label: "On Sale", kind: "boolean", inputMethod: "toggle",
      constraints: {} },
    { field: "maxPrice", label: "Maximum Price", kind: "number", inputMethod: "slider",
      constraints: { min: 0, max: 1000, step: 10 } },
  ],
  successCriteria: [
    { id: "sc-1", type: "elementVisible", target: { kind: "element",
      elementLocator: ".results-grid" }, expectedValue: null, timeout: 5000 },
  ],
  entryPoint: { url: "https://shop.example.com/products", elementName: "Apply Filters" },
  sourceSessionId: "session-abc123",
  approvedAt: "2026-08-01T12:00:00Z",
  elementBindings: {
    "category": "elem-uuid-001",
    "onSale": "elem-uuid-002",
    "maxPrice": "elem-uuid-003",
    // "Apply Filters" entry point resolved by name → elem-uuid-004
  },
};
```

### Caller-Supplied Test Data

```typescript
const testData = new Map([
  ["category", "Electronics"],
  ["onSale", true],
  ["maxPrice", 500],
]);
```

### Pre-Loaded Elements

```typescript
const elements = new Map([
  ["elem-uuid-001", { id: "elem-uuid-001", logicalName: "Category",
    locatorStrategies: [{ type: "testId", value: "cat-select", priority: 1 },
                         { type: "role", value: "combobox[name=\"Category\"]", priority: 2 }] }],
  ["elem-uuid-002", { id: "elem-uuid-002", logicalName: "On Sale",
    locatorStrategies: [{ type: "role", value: "checkbox[name=\"On Sale\"]", priority: 1 }] }],
  ["elem-uuid-003", { id: "elem-uuid-003", logicalName: "Maximum Price",
    locatorStrategies: [{ type: "testId", value: "price-slider", priority: 1 },
                         { type: "css", value: "#filters input[type=range]", priority: 2 }] }],
  ["elem-uuid-004", { id: "elem-uuid-004", logicalName: "Apply Filters",
    locatorStrategies: [{ type: "role", value: "button[name=\"Apply Filters\"]", priority: 1 }] }],
]);
```

### Generated ExecutionIRPlan

```
Step 1: NAVIGATE
  target: UrlTarget { url: "https://shop.example.com/products" }
  input: null

Step 2: WAIT_FOR_ELEMENT
  target: ElementTarget { elementName: "Category",
    resolvedLocators: [testId:"cat-select", role:"combobox Category"] }

Step 3: SELECT
  target: ElementTarget { elementName: "Category",
    resolvedLocators: [testId:"cat-select", role:"combobox Category"] }
  input: "Electronics"
  description: "Select 'Electronics' from Category dropdown"

Step 4: WAIT_FOR_ELEMENT → TOGGLE
  target: ElementTarget { elementName: "On Sale",
    resolvedLocators: [role:"checkbox On Sale"] }
  input: true
  description: "Toggle On Sale to true"

Step 5: WAIT_FOR_ELEMENT → FILL
  target: ElementTarget { elementName: "Maximum Price",
    resolvedLocators: [testId:"price-slider", css:"#filters input[type=range]"] }
  input: 500
  description: "Set Maximum Price to 500"

Step 6: WAIT_FOR_ELEMENT → CLICK
  target: ElementTarget { elementName: "Apply Filters",
    resolvedLocators: [role:"button Apply Filters"] }
  input: null
  assertions: [
    { type: VISIBILITY, comparison: IS_TRUE, severity: HARD,
      target: ElementTarget { resolvedLocators: [css:".results-grid"] },
      property: "visible" }
  ]
  description: "Click Apply Filters"
```

### What This Proves

- **Category** → `kind: select` + `inputMethod: dropdown` → `SELECT` action with value "Electronics" ✅
- **On Sale** → `kind: boolean` + `inputMethod: toggle` → `TOGGLE` action with value `true` ✅
- **Maximum Price** → `kind: number` + `inputMethod: slider` → `FILL` action with value `500` ✅
- **Apply/Success** → entry point click + `SuccessCriterion(elementVisible)` → `VISIBILITY/IS_TRUE/HARD` assertion ✅
- **P1's semantic abstractions are sufficient** — no locators, DOM details, or raw interactions leaked into the capability contract ✅
- **Target resolution** uses Element Repository UUIDs → current healed locators, not stale snapshots ✅

---

## §7. Reuse vs New Infrastructure

### §7.1 Reused Directly (No Duplication)

| Component | Source | How P2 Uses It |
|---|---|---|
| `ExecutionIRPlan`, `IRStep`, `IRAction`, `ResolvedTarget`, `ElementTarget`, `IRAssertion` | `src/domain/execution-ir/types.ts` | P2 output type — same as recording-time IR |
| `resolveElementTarget(element)` | `src/domain/execution-ir/generator.ts:375` | Snapshot Element → ElementTarget with ResolvedLocators |
| `resolveLocatorsForIR(identity)` | `src/generation/ir-bridge.ts:399` | Session fallback path — same ranking pipeline |
| `extractCandidatesFromIdentity()` + `rankLocatorCandidates()` | `src/domain/locator-ranking.ts` | Shared locator ranking (via resolveLocatorsForIR) |
| `DEFAULT_EXECUTION_PARAMETERS` | `src/domain/execution-ir/types.ts` | Same execution defaults as recording-time IR |
| `Element` entity + Element Repository | `src/domain/entities/element.ts`, Dexie repo | Load elements by UUID for target resolution |
| `ValidationType`, `ValidationComparison`, `ValidationSeverity` | `src/domain/enums.ts` | Same assertion vocabulary |
| Playwright code generators | `src/adapters/playwright/` | Same codegen for IR steps + assertions |
| `IRExecutorImpl` | `src/execution/ir-executor-impl.ts` | Same execution engine — P2 IR is format-compatible |
| `checkStaleness()` | `src/domain/execution-ir/staleness.ts` | Same staleness detection |
| `ElementMatchingService` | `src/repository/services/element-matching-service.ts` | Used at approval time to populate elementBindings |

### §7.2 New (P2-Specific)

| Component | Why It's New |
|---|---|
| `CapabilityIRGenerator` | Different input model (contract vs ATC vs recording). Cannot reuse `DefaultIRGenerator` — it expects `ApprovedTestCase` + `TestCaseVersion` with authored `Step[]`. P2 has `DataRequirement[]`, not `Step[]`. |
| `DataResolver` | No existing equivalent. The recording path gets values from `SessionEvent` (what the user typed). The ATC path gets values from authored `Step.input`. P2 gets values from `DataRequirement` + caller-supplied testData. |
| `ElementBindingResolver` | No existing equivalent. The recording path resolves from `ElementIdentity` (inline). The ATC path resolves from `Step.elementId` (pre-authored). P2 resolves from `DataRequirement.field` → `elementBindings[field]` → `Element`. |
| `SuccessCriterionResolver` | No existing equivalent. The recording path derives assertions from observed state changes (`deriveStateAssertions`). The ATC path reads authored `Validation[]`. P2 reads `SuccessCriterion[]` from the contract. |

### §7.3 Boundary: Why Not Reuse DefaultIRGenerator

The `DefaultIRGenerator` expects:
- `ApprovedTestCase` (with title, tags)
- `TestCaseVersion` (with authored `Step[]` where each step has `action: StepAction`, `elementId`, `input`)
- `Map<elementId, Element>` (pre-resolved element lookup)

P2's input is fundamentally different:
- `P2CapabilityContract` (with `DataRequirement[]`, not `Step[]`)
- No authored steps — P2 **derives** steps from data requirements
- No `elementId` on steps — P2 resolves via `elementBindings`
- Different action mapping source (`InputMethod` → `IRAction`, not `StepAction` → `IRAction`)

Forcing P2 through the ATC generator would require synthesizing fake `ApprovedTestCase` and `TestCaseVersion` objects — a worse abstraction than a clean parallel generator that shares the output types.

---

## §8. Edge Cases and Safety

### §8.1 DOM Has Changed Since Recording

Element Repository has healed locators (via `healElement()` during cross-session matching or runtime healing). P2 reads current `Element.locatorStrategies[]` — always uses the latest healed locators. If the Element is `BROKEN`, P2 still generates the plan; runtime healing in the executor compensates.

### §8.2 Element Repository Has Healed Its Locators

Same as §8.1. The Element UUID is stable; its locatorStrategies are current. P2 snapshots the current locators into `ResolvedLocator[]` at generation time (same as `DefaultIRGenerator.resolveElementTarget()`). If locators heal again after generation, staleness detection triggers regeneration.

### §8.3 Multiple Immutable Capability Versions

Each `CapabilityVersion` has its own `elementBindings` snapshot (frozen at approval time). P2 references a specific `versionId` from the contract. Different versions may reference different Element UUIDs (if the UI changed between recordings). Plans generated from version 1 and version 2 are independent — neither affects the other.

### §8.4 Two Fields with Similar Names

Element UUIDs are globally unique. `elementBindings` maps by `DataRequirement.field` (which is unique within a contract). Two fields named "Email" on different forms are different Elements with different UUIDs. No collision.

### §8.5 Same Semantic Field Appears Multiple Times on a Page

Each instance is a separate Element. The binding at approval time links to the specific instance that was recorded. If the user needs to test against a different instance, they create a new capability version with a different binding.

### §8.6 Capability Executed Long After Recording

Element Repository persists independently. Sessions may be pruned (archival tier). As long as Elements exist, P2 resolves targets. If Elements are also gone (project cleanup), P2 falls back to session recovery if available, or flags as unresolved.

### §8.7 Target Cannot Be Resolved Confidently

`ElementBindingResult.source = 'unresolved'` → IRStep gets `target: { kind: 'none' }` and `resolutionWarning: "Element binding not found for field 'X'"`. Playwright codegen emits `// TODO: resolve target for step N`. Executor skips with status "unresolved-target".

### §8.8 Success Criteria Require Target Resolution

Navigation criteria → `UrlTarget` (no element needed). Element-based criteria → resolved from `SuccessTarget.elementLocator` (CSS string from recording) or elementBindings. If neither available → assertion emitted with `NoTarget` (may still work for URL-based evaluations).

### §8.9 P3 Generates Many Test-Data Variants

P3 calls `CapabilityIRGenerator.generate()` repeatedly with different `testData` maps. Element resolution happens once per call (O(1) UUID lookup). No re-matching per variant. The same Element bindings serve all variants — only the input values change.

---

## §9. P2 Responsibilities and Non-Responsibilities

### §9.1 P2 Is Responsible For

1. Transforming `P2CapabilityContract` + test data → `ExecutionIRPlan`
2. Mapping `InputMethod` → `IRAction`
3. Resolving concrete test values from `DataRequirement` + caller-supplied data
4. Resolving element targets from `elementBindings` → Element Repository
5. Resolving `SuccessCriterion[]` → `IRAssertion[]`
6. Producing format-compatible IR (works with existing execution engine + Playwright codegen)
7. Handling unresolved targets safely (no silent failures)
8. Injecting WAIT_FOR_ELEMENT steps (same as ATC generator)

### §9.2 P2 Is NOT Responsible For

| Item | Owner | Why |
|---|---|---|
| AI-powered test data generation | P3 | DataResolver only produces minimal values |
| Executing the plan | P4/P5 | P2 produces IR, doesn't run it |
| Recorder modifications | Frozen R1-R3 | P2 doesn't touch the pipeline |
| Capability management / review | P1 (frozen) | P2 reads contracts, doesn't create them |
| Element healing | Healing service (frozen) | P2 reads current locators, doesn't heal |
| Cross-platform IR | P7-P9 | P2 generates web IR only |
| Failure analysis | P6 | P2 generates plans, doesn't diagnose |
| Populating elementBindings | P1 processDecision | P2 consumes bindings, doesn't create them |

---

## §10. Changes to Existing Code

### §10.1 P2CapabilityContract (additive)

Add `elementBindings: ReadonlyMap<string, string>` field. This is the only change to a P1 entity. It is additive — existing code that constructs contracts without elementBindings gets an empty map (backward-compatible).

**Implementation note:** Dexie cannot directly store `ReadonlyMap` (it's not structured-cloneable). The persistence layer serializes it as `Record<string, string>` and deserializes on read. The `CapabilityVersion.snapshot` stores it as a plain object.

### §10.2 P1 processDecision() Enhancement (additive)

At review approval time, `processDecision()` gains an element binding population step. This uses the session's candidate inputs (which carry `elementId`) and the Element Repository to resolve UUIDs. This is a P1 completion enhancement, not a P2 step — but it's documented here because P2 depends on it.

**If this enhancement is not done before P2**, P2 still works — all bindings are empty, and P2 falls back to session recovery for every field. The experience is degraded but functional.

### §10.3 No Other Changes

P2 does NOT modify:
- The recorder pipeline (R1-R3 frozen)
- The IR Bridge (recording-time path)
- The IR types (shared, stable)
- The execution engine
- The Playwright code generators
- The Element Repository or healing service
- The assertion providers

---

## §11. Implementation Plan

### Step 1: Element Bindings Infrastructure

**Files to create:**
- `src/generation/capability-ir/element-binding-resolver.ts` — ElementBindingResolver + ElementBindingResult types

**Files to modify:**
- `src/domain/entities/p2-capability-contract.ts` — add `elementBindings` field
- `src/domain/mappings/capability-mappers.ts` — populate elementBindings in `capabilityToContract()`
- `src/domain/services/capability-review-service.ts` — add element binding population step in `processDecision()`

**Gate G1:** `tsc --noEmit` — 0 src errors. Unit test: elementBindings populated correctly from candidate inputs + Element Repository.

### Step 2: Data Resolver

**Files to create:**
- `src/generation/capability-ir/data-resolver.ts` — DataResolver + constraint-derived fallback logic

**Gate G2:** Unit tests verify resolution priority (caller > default > constraint-derived) for all 6 DataKind values.

### Step 3: Success Criterion Resolver

**Files to create:**
- `src/generation/capability-ir/success-criterion-resolver.ts` — SuccessCriterionResolver + mapping table

**Gate G3:** Unit tests verify all 6 SuccessType → IRAssertion mappings. Verify target resolution for navigation vs element-based criteria.

### Step 4: Capability IR Generator

**Files to create:**
- `src/generation/capability-ir/capability-ir-generator.ts` — orchestrator, InputMethod → IRAction mapping, step building, WAIT_FOR_ELEMENT injection

**Gate G4:** Unit tests: generate plan from Filter Products contract, verify step count, actions, targets, assertions. Verify WAIT_FOR_ELEMENT injection. Verify entry point click step.

### Step 5: Service Layer Integration

**Files to modify:**
- `src/background/service-worker.ts` — add `GENERATE_CAPABILITY_IR` message handler that loads contract + elements, calls generator, stores result

**Gate G5:** Integration test: contract → generator → ExecutionIRArtifact → staleness check → Playwright codegen. Verify generated code is syntactically valid.

### Step 6: Golden Master Fixtures

**Files to create:**
- `tests/golden-master/capability-ir/` — fixture contracts + expected IR plans for 5 scenarios

**Gate G6:** Golden master tests pass for all 5 scenarios (Login, Filter Products, Checkout, Search, Form Submission).

### Step 7: Regression Suite

**Gate G7:** Full test suite passes (≤ 2 flaky exceptions). R1-R3 gates unchanged. P1 gates unchanged.

---

## §12. Exit Criteria

| EC | Criterion | Verification |
|----|-----------|-------------|
| EC1 | `CapabilityIRGenerator` produces valid `ExecutionIRPlan` from `P2CapabilityContract` | Unit test — plan structure correct |
| EC2 | `InputMethod → IRAction` mapping is correct for all 6 input methods | Unit test — exhaustive mapping table |
| EC3 | `DataResolver` resolves values in correct priority order | Unit test — caller > default > constraint-derived |
| EC4 | `ElementBindingResolver` resolves targets via Element Repository | Unit test — UUID lookup → ElementTarget |
| EC5 | `ElementBindingResolver` falls back to session recovery | Unit test — session path produces locators |
| EC6 | `ElementBindingResolver` handles unresolved targets safely | Unit test — NoTarget + resolutionWarning |
| EC7 | `SuccessCriterionResolver` maps all 6 SuccessType values | Unit test — exhaustive mapping |
| EC8 | Filter Products trace produces correct 6-step plan | Golden master test |
| EC9 | Generated IR is compatible with Playwright codegen | Integration test — codegen produces valid TypeScript |
| EC10 | Generated IR is compatible with execution engine | Integration test — executor accepts plan |
| EC11 | `elementBindings` populated at review approval | Unit test — processDecision produces bindings |
| EC12 | P2 never reads CapabilityCandidate or raw interactions (except fallback) | Code inspection — import audit |
| EC13 | All existing tests pass (≤ 2 flaky) | Full suite run |
| EC14 | R1-R3 + P1 regression gates pass | Gate suite run |

---

## §13. Boundary Invariants

| Invariant | Description |
|-----------|-------------|
| INV-P2-B1 | P2 never imports from `src/recorder/` or `src/classifier/`. The recorder is not a P2 dependency. |
| INV-P2-B2 | P2 never calls `ir-bridge.build()`. The recording-time IR Bridge is a separate path. |
| INV-P2-B3 | P2 never modifies `Element` entities. It reads current locators; healing is the healing service's job. |
| INV-P2-B4 | P2 never generates test data intelligently. `DataResolver` produces minimal values only. P3 overrides testData. |
| INV-P2-B5 | P2 never executes plans. It produces `ExecutionIRPlan`; execution is P4/P5. |
| INV-P2-B6 | The `elementBindings` field on `P2CapabilityContract` stores Element UUIDs, never locators. UUIDs are stable references, not execution details. |
| INV-P2-B7 | P2-generated IR uses the same types as recording-time IR (`ExecutionIRPlan`, `IRStep`, etc.). No parallel type system. |

---

## §14. Validation Scenarios

### Scenario 1: Login Capability
- Contract: 2 data requirements (username: text, password: text), 1 success criterion (navigation)
- Test data: { username: "testuser", password: "pass123" }
- Expected: NAVIGATE → FILL username → FILL password → CLICK submit + navigation assertion

### Scenario 2: Filter Products (primary trace)
- Contract: 3 data requirements (category, onSale, maxPrice), 1 success criterion (elementVisible)
- Test data: { category: "Electronics", onSale: true, maxPrice: 500 }
- Expected: NAVIGATE → SELECT → TOGGLE → FILL → CLICK + visibility assertion

### Scenario 3: Checkout
- Contract: 4 data requirements (shippingAddress, paymentMethod, couponCode, agreeTerms)
- Test data: minimal values
- Expected: NAVIGATE → FILL → SELECT → FILL → TOGGLE → CLICK

### Scenario 4: Unresolved Target
- Contract: 2 data requirements, one with no elementBinding
- Expected: First step resolves normally, second step has NoTarget + resolutionWarning

### Scenario 5: Empty Test Data
- Contract: 3 data requirements, testData map is empty
- Expected: DataResolver uses constraint-derived fallbacks for all fields

---

## §15. Design Principles

1. **P2 binds, it doesn't discover.** Target resolution uses pre-resolved bindings from the contract. P2 does not search the DOM, match elements, or infer structure. That work happened at recording time (R1-R3) and approval time (P1).

2. **The contract is the sole input boundary.** Everything P2 needs is on `P2CapabilityContract` + caller-supplied test data + Element Repository. No backdoor access to recorder artifacts.

3. **IR is disposable.** P2-generated plans can be regenerated at any time from the same contract + data. If locators heal, regenerate. If test data changes, regenerate. The contract is the durable truth; the plan is ephemeral.

4. **Same output format, different input path.** P2 produces the same `ExecutionIRPlan` type as the recording-time IR Bridge. The execution engine, codegen, and staleness detection don't know or care which path produced the plan.

5. **Element bindings are references, not locators.** The `elementBindings` map stores UUIDs — stable identifiers that survive DOM changes, healing, and capability versioning. No CSS selectors or XPath leak into the capability contract.

6. **Fail visibly, never silently.** Unresolved targets produce explicit warnings in the generated plan. No best-guess element matching at generation time. If P2 can't resolve a target, it says so.
