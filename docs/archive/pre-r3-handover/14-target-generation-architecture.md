# Target Generation Architecture

> Design document for unifying the generation pipeline
> Created: 2026-07-21 · Status: **PROPOSED** (not yet implemented)

---

## Problem Statement

The codebase has **two completely parallel generation pipelines** that produce conceptually equivalent output (Playwright test code) through entirely different paths with no shared types, no shared storage, and no shared code:

| | Runtime Path | IR Path |
|---|---|---|
| **Trigger** | Stop Recording | ATC version approval |
| **Input** | `SessionEvent[]` from chrome.storage.local | `ApprovedTestCase` + `Element` from domain DB |
| **Step type** | `CanonicalStep` (with embedded `ExecutionJsonObject`) | `IRStep` (with `ResolvedTarget`) |
| **Code output** | Single `testCode` string | `GeneratedFile[]` (full project scaffold) |
| **Assertions** | ❌ None | ✅ `IRAssertion[]` |
| **Execution params** | ❌ None | ✅ `timeoutMs`, `retryCount`, `waitStrategy` |
| **Environment** | ❌ `startUrl` only | ✅ `baseUrl`, `browser`, `viewport` |
| **POM support** | ❌ Flat only | ✅ Flat or page-object |
| **Caching** | ❌ Regenerate every time | ✅ `ExecutionIRArtifact` + staleness |
| **Extensibility** | ❌ Hardcoded to Playwright | ✅ `IRCodeGenerator` interface |

Additionally, the **Application Knowledge Fragment** — containing `LogicalAction[]`, `InteractionContract[]`, `BehavioralContract[]` — is produced by the enrichment pipeline but **not consumed by either generation path**.

---

## Recommended Architecture: Converge on Execution IR

### Principle

**One execution representation, one code generation interface.**

The IR path is strictly more capable than the runtime path. Instead of maintaining two pipelines, we make the runtime path produce `ExecutionIRPlan` directly, then use the existing `IRCodeGenerator` interface (and its `PlaywrightCodeGenerator` implementation) for all code output.

This eliminates:
- `CanonicalStep` (subsumed by `IRStep`)
- `ExecutionJsonObject` (subsumed by `IRStep` fields)
- Runtime `playwright-generator.ts` (replaced by `PlaywrightCodeGenerator`)
- Runtime `execution-json-generator.ts` (replaced by IR bridge)
- `GeneratorRegistry` + `GeneratorContract` (replaced by `IRCodeGenerator`)
- 17-strategy `LocatorStrategy` type (replaced by 7-value `LocatorStrategyType`)

And gains:
- Assertions from `InteractionContract.constraints`
- Execution parameters (timeout, retry, wait strategy)
- Environment configuration (browser, viewport)
- Project scaffolding (package.json, config, POMs)
- Staleness detection and cached renderings
- Cypress extensibility via `IRCodeGenerator`

---

### Unified Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RECORDING SESSION                           │
│                                                                     │
│  Deterministic Recorder → SessionEvent[] + DetectedInteraction[]   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    PIPELINE RUNNER                          │   │
│  │                                                             │   │
│  │  Domain Adapter                                             │   │
│  │    SessionEvent[] + DetectedInteraction[]                   │   │
│  │      → UiElement[] + ObservedTransition[]                  │   │
│  │                                                             │   │
│  │  Recognition Orchestrator                                   │   │
│  │    UiElement[] + ObservedTransition[]                       │   │
│  │      → ComponentGrouping[]                                 │   │
│  │                                                             │   │
│  │  Enrichment Orchestrator                                   │   │
│  │    → ApplicationKnowledgeFragment                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      IR BRIDGE (new component)                      │
│                                                                     │
│  Inputs:                                                            │
│    • SessionEvent[] (raw timeline)                                  │
│    • DetectedInteraction[] (classified interactions)               │
│    • ApplicationKnowledgeFragment (semantic enrichment)            │
│    • RecordingContext (startUrl, title)                            │
│                                                                     │
│  Output:                                                            │
│    ExecutionIRPlan                                                 │
│                                                                     │
│  Responsibilities:                                                  │
│    1. Map DetectedInteraction → IRStep (action, target, input)     │
│    2. Resolve element locators from ElementIdentity                │
│       → ResolvedLocator[] (using existing locator priority logic) │
│    3. Derive assertions from InteractionContract.constraints       │
│       → IRAssertion[] (required, min, max, pattern, etc.)         │
│    4. Inject WAIT_FOR_ELEMENT steps (when waitStrategy != 'none')  │
│    5. Enrich step descriptions from LogicalAction.businessField    │
│    6. Set IREnvironment from RecordingContext                      │
│    7. Apply readability rules (OR-1 focus-click merge, etc.)       │
│                                                                     │
│  What it replaces:                                                  │
│    • canonical-step-generator.ts  (SessionEvent → IRStep)          │
│    • execution-json-generator.ts (IRStep enrichment)               │
│    • semantic-classifier.ts       (folded into IR bridge)          │
│    • readability-optimizer.ts    (operates on IRStep[])            │
│    • locator-resolution-engine.ts (produces ResolvedLocator[])      │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CODE GENERATION LAYER                            │
│                                                                     │
│  Interface: IRCodeGenerator (already exists)                       │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ PlaywrightCode   │  │ CypressCode      │  │ CmdRunnerJson    │  │
│  │ Generator        │  │ Generator        │  │ Generator        │  │
│  │ (✅ exists)       │  │ (Phase 17)       │  │ (future)         │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
│                                                                     │
│  Input:  ExecutionIRPlan + GeneratorConfig                          │
│  Output: GeneratedFile[] (project scaffold + test files)           │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SIDE PANEL (display)                            │
│                                                                     │
│  Reads from storage:                                                │
│    • EXECUTION_IR_PLAN  (new StorageKey)                            │
│    • GENERATED_FILES   (new StorageKey)                             │
│    • KNOWLEDGE_FRAGMENT (existing)                                  │
│                                                                     │
│  Renders:                                                           │
│    • Step cards (from IRStep[] — description + action + target)     │
│    • Assertions (from IRAssertion[] — collapsible per step)          │
│    • Playwright code (from GeneratedFile[] — with copy button)      │
│    • Knowledge fragment summary (surfaces, components, workflows)  │
└─────────────────────────────────────────────────────────────────────┘
```

---

### What Gets Retired

| Component | Disposition | Reason |
|-----------|-------------|--------|
| `CanonicalStep` type | **Retired** | Subsumed by `IRStep` (with added `aiEnrichment` + `sourceEventId` fields) |
| `ExecutionJsonObject` type | **Retired** | Subsumed by `IRStep` fields (action, target, input) + `ExecutionParameters` |
| `canonical-step-generator.ts` | **Retired** | Replaced by IR bridge |
| `execution-json-generator.ts` | **Retired** | Replaced by IR bridge (locators resolve to `ResolvedLocator[]` directly) |
| `playwright-generator.ts` (runtime) | **Retired** | Replaced by `PlaywrightCodeGenerator` (IR adapter) |
| `generator-registry.ts` | **Retired** | No longer needed — IR bridge produces plan, `IRCodeGenerator` renders it |
| `generator-contract.ts` | **Retired** | Replaced by `IRCodeGenerator` interface |
| `ExecutionLocator` (17 strategies) | **Retired** | Replaced by `ResolvedLocator` (7 strategies + priority + confidence) |
| `semantic-classifier.ts` | **Absorbed** | Classification logic folded into IR bridge (DetectedInteraction already classifies) |
| `readability-optimizer.ts` | **Absorbed** | Operates on `IRStep[]` instead of `CanonicalStep[]` |
| `locator-resolution-engine.ts` | **Absorbed** | Produces `ResolvedLocator[]` from `ElementIdentity` — same logic, different output type |

**Estimated retirement: ~1,500 lines of generation code removed.**

---

### What Gets Added

| Component | Lines (est.) | Purpose |
|-----------|-------------|---------|
| `ir-bridge.ts` | ~300 | Maps SessionEvent[] + DetectedInteraction[] + KnowledgeFragment → ExecutionIRPlan |
| `IRStep` extension | ~20 | Add optional `aiEnrichment`, `sourceEventId`, `plainEnglish` fields |
| Side panel updates | ~100 | Render IRStep[] + IRAssertion[] + GeneratedFile[] |
| 2 new StorageKeys | — | `EXECUTION_IR_PLAN`, `GENERATED_FILES` |

**Net effect: ~1,100 lines removed from the codebase while gaining capabilities.**

---

### What Already Exists (Reused as-is)

| Component | Status | Role in unified pipeline |
|-----------|--------|--------------------------|
| `IRStep`, `ExecutionIRPlan`, `ExecutionIRArtifact` | ✅ Complete | The execution representation |
| `DefaultIRGenerator` | ✅ Complete | ATC → IR path (for authored test cases) |
| `PlaywrightCodeGenerator` | ✅ Complete | IR → Playwright project files |
| `IRCodeGenerator` interface | ✅ Complete | Extension point for Cypress, CmdRunner JSON, etc. |
| `checkStaleness()` + `detectLocatorChanges()` | ✅ Complete | Staleness detection for cached artifacts |
| `IRExecutor` interface | ✅ Complete | Future test execution (Phase 12) |
| `ApplicationKnowledgeFragment` | ✅ Complete | Enrichment source for IR bridge |
| `LogicalAction`, `InteractionContract`, `BehavioralContract` | ✅ Complete | Enrichment data consumed by IR bridge |
| `locator-resolution-engine.ts` logic | ✅ Complete | Locator priority strategy (retargeted to produce `ResolvedLocator[]`) |

---

### IRStep Extensions (Minimal)

The existing `IRStep` needs three optional fields to serve as the unified step type:

```typescript
interface IRStep {
  // ── Existing fields (unchanged) ──
  readonly id: string;
  readonly order: number;
  readonly action: IRAction;
  readonly description: string;
  readonly target: ResolvedTarget;
  readonly input: IRInput;
  readonly assertions: IRAssertion[];
  readonly executionParameters: ExecutionParameters;

  // ── New optional fields (for recording provenance) ──
  readonly aiEnrichment?: AIUnderstanding | null;    // AI advisory enrichment
  readonly sourceEventId?: string;                    // back-link to SessionEvent.actionId
  readonly plainEnglish?: string;                     // template-generated human description
}
```

These fields are optional (using `?`) so the ATC → IR path (which has no AI enrichment or source events) is unaffected. The runtime path populates them; the ATC path leaves them undefined.

---

### IR Bridge: The New Component

The IR bridge is the single new component that replaces the runtime generation pipeline. Its job is to translate recording outputs into an `ExecutionIRPlan`.

```typescript
function buildExecutionIRPlan(input: IRBridgeInput): ExecutionIRPlan

interface IRBridgeInput {
  events: SessionEvent[];                 // raw timeline
  interactions: DetectedInteraction[];    // classified interactions
  fragment: ApplicationKnowledgeFragment; // semantic enrichment
  recordingContext: RecordingContext;     // startUrl, title
  testCaseName: string;
}
```

**Internal steps:**

1. **Map interactions → IRSteps.** For each `DetectedInteraction`:
   - Map `InteractionType` → `IRAction` (e.g., `Click` → `CLICK`, `TextEntry` → `FILL`, `Checkbox` → `TOGGLE`)
   - Build `ResolvedTarget` from `DetectedInteraction.target` (ElementIdentity) — resolve locators using existing priority strategy
   - Map metadata fields to `IRInput` (text value → string, checked state → boolean)
   - Generate `description` from semantic templates (same logic as current `renderSemanticPlainEnglish()`)
   - Set `sourceEventId` from `DetectedInteraction.eventIds[0]`

2. **Enrich with knowledge fragment.** For each `IRStep`:
   - Find matching `LogicalAction` by timestamp proximity or element transition IDs
   - If `LogicalAction.businessField` exists, append to description (e.g., "Fill 'john@example.com' in the Email field")
   - Derive `IRAssertion[]` from `InteractionContract.constraints`:
     - `required: true` → `IRAssertion { type: 'attribute', property: 'required', comparison: 'equals', expectedValue: true }`
     - `min`/`max` → `IRAssertion { type: 'value', comparison: 'greaterThanOrEqual'/'lessThanOrEqual' }`
     - `pattern` → `IRAssertion { type: 'pattern', expectedValue: pattern }`
     - `validOptions` → `IRAssertion { type: 'value', comparison: 'oneOf', expectedValue: validOptions }`

3. **Inject wait steps.** Before any `CLICK`/`FILL`/`SELECT` action targeting an element, inject a `WAIT_FOR_ELEMENT` step if the interaction's confidence is below a threshold (indicating the element may be dynamically rendered).

4. **Apply readability rules.** Merge focus-click + text-entry on the same element into a single `FILL` step (existing OR-1 rule, retargeted to `IRStep[]`).

5. **Assemble plan.**
   - `IREnvironment`: `{ baseUrl: recordingContext.startUrl, browser: 'chromium', viewport: { width: 1280, height: 720 } }`
   - `title`: `testCaseName`
   - `tags`: derived from `RecordedWorkflow.surfaceTransitions` (page names)

---

### Service Worker Integration

The service worker's `handleStopRecording` changes from:

```
// CURRENT (retired)
runPipeline(events, interactions, ...)     // → knowledge fragment
engine.generate()                          // reads SessionEvent[], writes CanonicalStep[] + Playwright string
```

To:

```
// PROPOSED
runPipeline(events, interactions, ...)     // → knowledge fragment (unchanged)
const plan = buildExecutionIRPlan({        // → ExecutionIRPlan (new)
  events, interactions, fragment, recordingContext, testCaseName
})
const files = await playwrightCodeGen.generate(plan, config)  // → GeneratedFile[] (existing)
StorageService.setRaw(EXECUTION_IR_PLAN, plan)
StorageService.setRaw(GENERATED_FILES, files)
```

The `GenerationEngine` class, `GeneratorRegistry`, and all three runtime generators are removed. The service worker calls the IR bridge + `IRCodeGenerator` directly.

---

### Side Panel Changes

| Section | Current (CanonicalStep) | Proposed (IRStep) |
|---------|------------------------|-------------------|
| Step list | `CanonicalStep.plainEnglish` | `IRStep.description` (+ optional `plainEnglish`) |
| Step action | `CanonicalStep.actionType` (string) | `IRStep.action` (IRAction enum) |
| Step target | `CanonicalStep.elementIdentity` (18 fields) | `IRStep.target` (ResolvedTarget — elementId, locators) |
| Execution JSON | `CanonicalStep.executionJson` (collapsible) | `IRStep` fields directly (action, target, input, params) |
| Assertions | ❌ Not shown | ✅ `IRStep.assertions[]` (collapsible per step) |
| AI enrichment | `CanonicalStep.aiEnrichment` | `IRStep.aiEnrichment` (same, now optional) |
| Playwright code | `PlaywrightGeneratorOutput.testCode` (string) | `GeneratedFile[]` (file tree with viewer) |

---

### Migration Path (Incremental, Non-Breaking)

The migration can be done in 4 steps, each leaving the codebase in a working state:

**Step 1: Add `aiEnrichment`, `sourceEventId`, `plainEnglish` to `IRStep`** (additive, non-breaking). All existing IR code continues to work — the new fields are optional.

**Step 2: Build the IR bridge** (`ir-bridge.ts`). Write tests for it. Don't wire it into the service worker yet — it exists alongside the current pipeline.

**Step 3: Wire IR bridge + `PlaywrightCodeGenerator` into the service worker** alongside the existing pipeline (dual-write: write both `GENERATED_STEPS` and `EXECUTION_IR_PLAN` to storage). Update the side panel to read from `EXECUTION_IR_PLAN` and render `IRStep[]`. The old `GENERATED_STEPS` path is still written as a fallback.

**Step 4: Remove the old pipeline.** Once the IR path is verified working in the side panel, delete `GenerationEngine`, `GeneratorRegistry`, `GeneratorContract`, `canonical-step-generator.ts`, `execution-json-generator.ts`, `playwright-generator.ts`, and the `CanonicalStep`/`ExecutionJsonObject` types. Remove `GENERATED_STEPS` and `GENERATED_PLAYWRIGHT` storage keys.

Each step is independently testable and reversible.

---

## Why This Architecture

### Simplicity

| Metric | Current (dual pipeline) | Proposed (unified) |
|--------|------------------------|-------------------|
| Step types | 2 (`CanonicalStep` + `IRStep`) | 1 (`IRStep`) |
| Execution contracts | 2 (`ExecutionJsonObject` + `ExecutionIRPlan`) | 1 (`ExecutionIRPlan`) |
| Locator types | 2 (`ExecutionLocator` + `ResolvedLocator`) | 1 (`ResolvedLocator`) |
| Code gen interfaces | 2 (`GeneratorContract` + `IRCodeGenerator`) | 1 (`IRCodeGenerator`) |
| Playwright generators | 2 (runtime + IR adapter) | 1 (`PlaywrightCodeGenerator`) |
| Storage systems | 2 (chrome.storage.local + domain DB) | 1 per context (chrome.storage.local for runtime, domain DB for ATC) |

### Extensibility

Adding a new output format (e.g., Cypress) requires:
- **Current:** Build a new generator implementing `GeneratorContract`, register it in `GeneratorRegistry`, wire it into `GenerationEngine`'s switch statement. Then also build a separate `IRCodeGenerator` implementation for the ATC path.
- **Proposed:** Implement `IRCodeGenerator`. That's it. Both the recording path and the ATC path use the same interface.

### Knowledge Fragment Integration

The IR bridge is the natural integration point for the knowledge fragment. `InteractionContract.constraints` become `IRAssertion[]`. `LogicalAction.businessField` enriches step descriptions. `BehavioralContract.stateMachine` could inform conditional logic in generated tests. This is structurally impossible in the current runtime path because `CanonicalStep` has no assertion field and `ExecutionJsonObject` has no constraint mapping.

### No Lost Capabilities

| Capability | Current runtime | Proposed unified |
|-----------|----------------|-----------------|
| Plain-English steps | ✅ via `plainEnglish` | ✅ via `IRStep.description` + optional `plainEnglish` |
| AI enrichment | ✅ via `aiEnrichment` | ✅ via `IRStep.aiEnrichment` |
| Locator resolution | ✅ via `locator-resolution-engine` | ✅ same logic, produces `ResolvedLocator[]` |
| Readability merging | ✅ via `readability-optimizer` | ✅ same rules, operates on `IRStep[]` |
| Playwright output | ✅ single test string | ✅ full project scaffold (richer) |
| **Assertions** | ❌ | ✅ from knowledge fragment |
| **Execution params** | ❌ | ✅ per-step |
| **Environment** | ❌ | ✅ browser, viewport |
| **POM pattern** | ❌ | ✅ flat or page-object |
| **Project scaffold** | ❌ | ✅ package.json, config, tsconfig |
| **Caching/staleness** | ❌ | ✅ `ExecutionIRArtifact` |
| **Cypress extensibility** | ❌ | ✅ implement `IRCodeGenerator` |

### What We Avoid

1. **No new types.** `IRStep`, `ExecutionIRPlan`, `ResolvedLocator`, `IRAction`, `IRAssertion`, `IREnvironment` all already exist. We extend `IRStep` with 3 optional fields — that's the only type change.

2. **No new interfaces.** `IRCodeGenerator` already exists. `PlaywrightCodeGenerator` already implements it. We just wire them into the runtime.

3. **No parallel maintenance.** One generation pipeline means one set of tests, one set of types, one code path to maintain. Bug fixes in code generation apply to both recording and ATC flows.

4. **No storage migration.** The runtime continues to use chrome.storage.local (just with new keys). The ATC path continues to use the domain DB. The IR plan is the shared currency between them.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `PlaywrightCodeGenerator` output format differs from runtime `playwrightGenerator` (full project vs. single string) | Medium | Step 3 (dual-write) lets us verify the new output is acceptable before removing the old path. If the side panel needs a single string, add a `renderSingleFile()` method to `PlaywrightCodeGenerator` that concatenates the test file content. |
| Locator strategy mapping (17 → 7 types) loses fidelity | Low | The 7 `LocatorStrategyType` enum values are coarser but cover all practical cases. The 17-strategy `LocatorStrategy` includes rarely-used types (`ariaLabelledby`, `placeholder`, `alt`, `title`) that map to `ACCESSIBLE_NAME` or `TEXT` in the IR system. Verify no test case relies on the distinction. |
| `DetectedInteraction.type` (40+ types) → `IRAction` (10 types) loses classification detail | Low | The 40+ `InteractionType` values are fine-grained classifications (e.g., `CustomDropdown` vs `NativeDropdown`). Both map to `IRAction.SELECT`. The distinction is preserved in `IRStep.description` and the knowledge fragment's component groupings. |
| ATC path and recording path produce slightly different IR plans | Low | Both paths produce valid `ExecutionIRPlan`. Differences in enrichment (AI, knowledge fragment) are optional fields. The `IRCodeGenerator` doesn't care about the source — it renders the plan. |
| Retiring `GenerationEngine` breaks test case state management (`TestCaseState.GENERATING → GENERATED`) | Low | Replace with a simpler flag: `StorageService.setRaw(EXECUTION_IR_PLAN, plan)` implies generation complete. Or keep `TestCaseState` transitions in the service worker without the `GenerationEngine` class. |

---

## Summary

**One execution representation (`IRStep`), one code generation interface (`IRCodeGenerator`), one new component (IR bridge).**

The IR bridge replaces the entire runtime generation pipeline (~1,500 lines) while gaining assertions, execution parameters, environment config, project scaffolding, staleness detection, and Cypress extensibility. The knowledge fragment is consumed at the IR bridge to enrich steps with business-domain language and validation assertions.

No new types, no new interfaces, no new storage systems. The existing IR infrastructure — built, tested, but never wired — becomes the foundation for all future generation work.
