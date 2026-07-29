# CmdRunner Platform — Implementation Roadmap

**From:** 7bfd949 (working recorder + Playwright generator, 3,810 passing tests)
**To:** Full AI QA Automation Platform
**Date:** July 2026
**Governing principle:** Every phase leaves the product in a working, releasable state. No temporary architectures. No parallel systems that will be removed.

---

## Current State Inventory (What Already Exists)

### ✅ Frozen Contracts (Already Implemented)
| Contract | Location | Status |
|----------|----------|--------|
| ExecutionIRPlan / IRStep / IRAction | `src/domain/execution-ir/types.ts` | Frozen — 10 actions, self-contained steps |
| IRExecutor interface | `src/domain/execution-ir/adapters/ir-executor.ts` | Frozen — `execute(plan, options) → result` |
| IRCodeGenerator interface | `src/domain/execution-ir/adapters/ir-code-generator.ts` | Frozen — `generate(plan, config) → files` |
| LocatorStrategyType enum | `src/domain/enums.ts` | 8 DOM locator types |
| Locator ranking (shared spine) | `src/domain/locator-ranking.ts` | 5-category priority system |
| Capability entity | `src/domain/entities/capability.ts` | Enrichment model, append-only history |
| Element entity | `src/domain/entities/element.ts` | healHistory, locatorStrategies |
| ApprovedTestCase / TestCaseVersion | `src/domain/entities/approved-test-case.ts` | Versioned, step-based |
| ExecutionRun entity | `src/domain/entities/execution-run.ts` | Append-only, per-step results |
| Repository V2 (9 interfaces) | `src/repository/v2/interfaces/` | Dexie/IndexedDB implementation |

### ✅ Working Implementations
| Component | Lines | What It Does |
|-----------|-------|-------------|
| Event Tap + Identity Extractor | ~1,200 | Capture-phase DOM event listeners, 19-field identity |
| Evidence Channels A-E | ~1,500 | Accessibility, DOM structure, behavioral, mutations, focus |
| Recognition Pipeline | ~800 | Declarative pattern matching, 40 interaction types |
| Lifecycle Engine | ~600 | State machine for component sessions (dropdown, date picker, etc.) |
| Semantic Reasoner | ~750 | Multi-interaction collapsing, component session management |
| IR Bridge | ~400 | Pure function: events + interactions + fragment → IR plan |
| IR Executor (Chrome) | ~500 | Browser tab execution + content script + self-healing |
| Playwright Generator | 7 files | Action/locator/assertion/POM/project renderers |
| Healing Service | ~200 | Source-agnostic core, recording + execution paths |
| Capability Deriver | ~250 | Deterministic capability inference from fragments |
| Enrichment Pipeline | ~2,000 | 10 modules: contracts, capabilities, workflows, surfaces |
| AI Provider Manager | ~100 | 6 providers (Gemini, OpenAI, Claude, OpenRouter, Azure, Custom) |

### ⚠️ Known Structural Debt (One Item)
The codebase has **two parallel interaction types** flowing through two semi-independent pipelines:
- `DetectedInteraction[]` (40-type classifier output) — consumed by IR Bridge, stored in RecordingSession
- A lightweight `SemanticInteraction` type exists in `architecture-types.ts` but is only 4 fields (canonicalType, actionId, value, checked) — NOT the full 22-field observation model

The full 22-field `SemanticInteraction` contract is **designed** (in `SEMANTIC_INTERACTION_BOUNDARY.md`) but **not materialized** in code as a persistent entity. This is the single refactor the roadmap addresses first.

---

## Phase 0: SemanticInteraction Contract & Pipeline Unification

### Objective
Materialize the full 22-field `SemanticInteraction` as the persistent observation model, unify the two parallel interaction types into one, and make it the single input to the IR Bridge. This is the foundation every subsequent phase depends on.

### Components Introduced / Refactored

**Refactored (in-place evolution, not rewrite):**

| Component | Change | Why |
|-----------|--------|-----|
| `SemanticInteraction` type | Promote from 4-field stub to full 22-field observation contract | Becomes the shared semantic model |
| `SemanticReasoner` output type | Change return from `DetectedInteraction[]` to `SemanticInteraction[]` | The reasoner already produces semantically correct interactions; just changes the output container |
| `IR Bridge` input | Change from `(SessionEvent[] + DetectedInteraction[] + Fragment)` to `(SemanticInteraction[])` | One pipeline, one type, pure function preserved |
| `RecordingSession.rawInteractions` | Type changes from `DetectedInteraction[]` to `SemanticInteraction[]` | Persistence of the unified model |
| `Domain Adapter` / `Domain Adapter V2` | Adapt to produce `SemanticInteraction[]` instead of `DetectedInteraction[]` | Same transformation logic, different output type |
| `Pipeline Runner` | Orchestrate the unified flow | Remove the STOP_RECORDING synthetic adapter |

**NOT changed:**
- Event Tap, Evidence Channels, Recognition Pipeline, Lifecycle Engine — all produce `DetectedInteraction[]` as an intermediate, which the SemanticReasoner upgrades to `SemanticInteraction[]`
- IR Executor, Playwright Generator, Healing Service, Repository interfaces — all consume `ExecutionIRPlan`, which the IR Bridge still produces (just from a different input)
- Capability entity, Element entity, ExecutionRun entity — unchanged

### Why This Phase Must Come First
Every subsequent phase depends on `SemanticInteraction` being the persistent, shared, queryable model:
- Capability adoption composes from `SemanticInteraction[]`
- AI test generation reasons over `SemanticInteraction[]`
- Self-healing reads `SemanticInteraction.target.identity`
- Multi-engine execution benefits from `IRStep.semanticInteractionId` back-link

Without this, every downstream phase would need to re-derive semantics from raw events, recreating the exact dual-pipeline problem this phase eliminates.

### User-Visible Functionality Unlocked
No new user-visible features. The recording experience, generated Playwright tests, and execution results are identical. This phase improves internal architecture without changing the product surface.

**What the user DOES notice:** The side panel timeline may show richer per-interaction information (semantic action, component type, confidence) because the full 22-field model carries more metadata than the 4-field stub.

### Acceptance Criteria
- [ ] `SemanticInteraction` type defined with all 22 fields from `SEMANTIC_INTERACTION_BOUNDARY.md`
- [ ] Observation/Projection boundary enforced: SemanticInteraction has zero consumer-concern fields (no assertions, execution hints, AI interpretations on the type itself)
- [ ] SemanticReasoner outputs `SemanticInteraction[]`
- [ ] IR Bridge accepts `SemanticInteraction[]` as sole interaction input
- [ ] `RecordingSession` stores `SemanticInteraction[]` in the repository
- [ ] `IRStep.semanticInteractionId` back-link populated during IR generation
- [ ] `DetectedInteraction` type retained ONLY as the recognition pipeline's intermediate output (not persisted, not consumed by IR Bridge)
- [ ] All 3,810 existing tests pass (adapted to new types where necessary)
- [ ] Recording on a real React SPA produces identical Playwright output as before the refactor
- [ ] Execution via IR Executor produces identical results as before the refactor

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **SemanticInteraction (22 fields)** | ✅ FROZEN — immutable observation model |
| **Observation/Projection boundary** | ✅ FROZEN — no consumer fields on SemanticInteraction |
| **SemanticReasoner → SemanticInteraction[] output contract** | ✅ FROZEN |
| **IR Bridge input contract** | ✅ FROZEN — accepts SemanticInteraction[] |
| **IRStep.semanticInteractionId back-link** | ✅ FROZEN |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Breaking 3,810 tests during type migration | Migrate incrementally: define SemanticInteraction → adapt SemanticReasoner → adapt IR Bridge → adapt tests. Each step is independently testable. |
| IR Bridge output changes when input changes | The IR Bridge is a pure function. Write a characterization test BEFORE the refactor: record 10 diverse interactions, capture the exact IR output, then verify identical output after the refactor. |
| SemanticInteraction loses fields the classifier populated | Map every `DetectedInteraction` field to a `SemanticInteraction` field explicitly. Create a field-coverage matrix and verify 100% before removing DetectedInteraction from the IR Bridge path. |
| Performance regression from richer types | Profile IR Bridge before and after. The type change is structural (more fields on the object), not algorithmic. Expected impact: negligible. |

---

## Phase 1: Persistent Semantic Layer

### Objective
Make `SemanticInteraction[]` the persistent shared model that both the recorder and execution engine reference at runtime. Wire the semantic back-link through to the execution layer so the executor (and future AI) can look up the semantic context for any IR step.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `SemanticInteractionRepository` interface | CRUD for querying SemanticInteractions by session ID, interaction ID, page URL |
| `DexieSemanticInteractionRepository` | IndexedDB implementation (Dexie v4 schema upgrade) |
| `AssertionProjection` type | Derived assertions from before/after states (projection over SemanticInteraction) |
| `ExecutionProjection` type | Type-aware retry/wait/timeout hints (projection over SemanticInteraction) |
| `SemanticContextProvider` | Runtime lookup service: given an IRStep, return its SemanticInteraction + projections |

### Components Refactored

| Component | Change |
|-----------|--------|
| IR Bridge | Populate `assertions[]` from `AssertionProjection` (derived from before/after states) instead of from InteractionContract constraints |
| IR Executor | Look up `SemanticInteraction` via `semanticInteractionId` for type-aware execution decisions (retry strategy, wait strategy) |
| Dexie Database | Schema v3 → v4: add `semanticInteractions` table, index by sessionId + interactionId |

### Why This Phase Must Come After Phase 0
Phase 0 defines the `SemanticInteraction` type and makes it flow through the pipeline. Phase 1 makes it **queryable at runtime** — stored in its own repository table, indexed for lookup, and wired to the execution engine. Without Phase 0's unified type, there's nothing to persist.

### Why This Phase Must Come Before Phase 2
The Capability model composes from `SemanticInteraction[]` references. Those references need to be persistent and queryable. If interactions are only embedded in `RecordingSession.rawInteractions` (Tier 3 archival storage), capability inference can't query them efficiently. Phase 1 promotes them to Tier 1 (canonical, indexed, queryable).

### User-Visible Functionality Unlocked
- **Richer execution results:** The IR Executor can now report "Custom dropdown 'Nationality' not found" instead of "Element not found" — because it has the semantic context.
- **Better assertions:** Assertions derived from before/after states are more accurate than those derived from InteractionContract constraints (which had empty locators in the IR Bridge path).
- **Type-aware execution:** Custom dropdown clicks get `retryCount: 2, waitStrategy: 'visible'` automatically; simple clicks get `retryCount: 1, waitStrategy: 'visible'`. The user sees fewer flaky failures.

### Acceptance Criteria
- [ ] `SemanticInteractionRepository` interface defined with: `getBySession`, `getById`, `getByElementId`
- [ ] Dexie v4 schema upgrade is backward-compatible (existing v3 data is readable)
- [ ] `AssertionProjection` produces assertions from before/after states for all 19 interaction types
- [ ] IR Bridge generates assertions from `AssertionProjection` (not from InteractionContract constraints)
- [ ] IR Executor looks up `SemanticInteraction` for each step and applies type-aware execution parameters
- [ ] `SemanticContextProvider` returns the semantic interaction + projections for any IRStep
- [ ] All existing tests pass
- [ ] Recording + execution on a real SPA shows improved assertion accuracy (characterization test)

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **SemanticInteractionRepository interface** | ✅ FROZEN |
| **AssertionProjection type** | ✅ FROZEN |
| **ExecutionProjection type** | ✅ FROZEN |
| **Dexie v4 schema** | ✅ FROZEN (backward-compatible with v3) |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Dexie schema migration loses data | Dexie handles additive schema changes transparently. Test migration on a populated v3 database before deploying. Keep raw events in RecordingSession as Tier 3 backup. |
| AssertionProjection produces different assertions than current IR Bridge | Run both assertion paths in parallel during testing, diff the outputs. Fix discrepancies before switching. |
| Runtime semantic lookups add latency | SemanticInteractions are loaded once at execution start (Map<interactionId, SemanticInteraction>). No per-step DB query. |

---

## Phase 2: Capability Adoption Lifecycle

### Objective
Build the management layer that transforms inferred `CapabilityCandidate`s into approved, versioned, related `Capability` entities with business-level metadata. This is what makes CmdRunner a test management platform, not just a recorder.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CapabilityReviewService` | Manages the candidate → approved transition: review, edit, approve, reject |
| `CapabilityVersioningService` | Creates new versions when scope changes; tracks version history |
| `CapabilityRelationService` | Manages `dependsOn` and `variations` between capabilities |
| `CapabilityMatcher` | Cross-session matching: new recording → find existing capability → enrich or create new |
| `CapabilityUI` | Side panel views: capability list, detail, review form, dependency graph |
| `DataRequirement` type | Formal data requirements with test data sets (for data-driven testing) |
| `SuccessCriterion` type | Explicit success criteria (navigation, element state, visibility, text content) |

### Components Refactored

| Component | Change |
|-----------|--------|
| `CapabilityDeriver` | Output changes from producing `CapabilityCandidate` to also proposing `DataRequirement[]` and `SuccessCriterion[]` |
| `Capability` entity | Add `version`, `dependsOn`, `variations`, `successCriteria`, `dataRequirements` fields (all additive — existing fields unchanged) |
| `CapabilityRepository` | Add `getByVersion`, `findMatching` methods |
| Dexie Database | Schema v4 → v5: index capabilities by status, version, projectId |

### Why This Phase Must Come After Phase 1
Capability composition references `SemanticInteraction[]` by ID. Those IDs must be persistent and queryable (Phase 1) for the capability model to reference them. Without persistent interactions, capabilities can't maintain stable references.

### Why This Phase Must Come Before Phase 3
AI test generation (Phase 3) needs the approved capability model — it generates test cases FROM capabilities, not from raw interactions. The capability's data requirements, success criteria, and validation rules are the input to AI test generation.

### User-Visible Functionality Unlocked
- **Capability list view:** QA tester sees a list of detected capabilities ("User Login", "Search Flight", "Create Employee") with status (inferred → approved).
- **Capability review:** QA tester reviews an inferred capability, edits its name/scope, adds success criteria, and approves it.
- **Data-driven testing setup:** QA tester defines test data sets for a capability's data requirements (e.g., valid credentials, invalid password, SQL injection attempt).
- **Dependency graph:** QA tester sees which capabilities depend on others ("Update Profile" depends on "User Login").
- **Cross-session enrichment:** A second recording of the same login flow enriches the existing capability (new failure modes observed, confidence rises).

### Acceptance Criteria
- [ ] `CapabilityReviewService` transitions capability status: inferred → approved → deprecated
- [ ] `CapabilityVersioningService` creates immutable versions; versionNumber is monotonically increasing
- [ ] `CapabilityMatcher` matches new recordings to existing capabilities (≥70% field overlap threshold)
- [ ] Enrichment is append-only: `enrichmentHistory[]` grows, `confidence` progresses
- [ ] `DataRequirement` with `testDataSet` supports at least 3 data variants per requirement
- [ ] `SuccessCriterion` validates against execution results (URL match, element visibility, text content)
- [ ] Capability UI in side panel: list, detail, review form
- [ ] All existing tests pass; new tests for capability lifecycle

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **Capability lifecycle states** | ✅ FROZEN — inferred → approved → deprecated |
| **Capability versioning model** | ✅ FROZEN — immutable versions, monotonic versionNumber |
| **CapabilityStep composition** | ✅ FROZEN — interactionId + role references |
| **DataRequirement type** | ✅ FROZEN |
| **SuccessCriterion type** | ✅ FROZEN |
| **CapabilityMatcher matching contract** | ✅ FROZEN |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Capability matching produces false positives | Start with conservative threshold (70% field overlap + action keyword match). QA tester reviews every match. False positives are correctable; false negatives just create a new capability. |
| Versioning adds complexity users don't need | V1 versioning is implicit: the system creates a new version when scope changes, not when the user clicks "edit." Users manage capabilities, not versions. |
| Enrichment conflicts corrupt data | The `stricter-constraint-wins` rule + append-only history + structured deltas mean conflicts are auditable and reversible. Test with contradictory recordings explicitly. |

---

## Phase 3: Capability-Derived IR Generation

### Objective
Build the IR generator that produces `ExecutionIRPlan` from `(Capability + SemanticInteraction[] + Element Repository + Environment Profile)`. This enables re-executing a test case without re-recording, and executing AI-generated test cases (which have no recording).

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CapabilityIRGenerator` | Implements `IRGenerator` interface: (Capability + SemanticInteractions + Elements + Environment) → ExecutionIRPlan |
| `DataResolver` | Resolves `DataRequirement` test data sets into concrete `IRInput` values for each step |
| `AssertionResolver` | Transforms `SuccessCriterion[]` into `IRAssertion[]` with resolved locators |
| `EnvironmentResolver` | Resolves `EnvironmentProfile` into `IREnvironment` (baseUrl, browser, viewport) |

### Components Refactored

| Component | Change |
|-----------|--------|
| IR generation entry point | Dispatches to `IRBridge` (recording-derived) or `CapabilityIRGenerator` (capability-derived) based on source |
| `ExecutionIRArtifact` | Add `source: 'recording' | 'capability'` field (additive) |

### Why This Phase Must Come After Phase 2
The generator's input is an approved `Capability` with `DataRequirement[]` and `SuccessCriterion[]`. Without Phase 2's capability lifecycle, there's no approved capability to generate from.

### Why This Phase Must Come Before Phase 4
AI test generation (Phase 4) creates new test case variants. Those variants need to be executable — which requires the capability-derived IR generator. Without it, AI-generated test cases can't run.

### User-Visible Functionality Unlocked
- **Re-execute without re-recording:** QA tester selects an approved capability, picks a data set, and clicks "Run." The system generates IR from the capability and executes it.
- **Data-driven execution:** The same capability runs with different data sets (valid login, invalid password, empty fields). Each produces a separate `ExecutionRun`.
- **Environment switching:** The same capability runs against staging, then production, by switching the environment profile.

### Acceptance Criteria
- [ ] `CapabilityIRGenerator` produces a valid `ExecutionIRPlan` from an approved Capability
- [ ] `DataResolver` resolves all `DataRequirement` fields to concrete values from the selected test data set
- [ ] `AssertionResolver` converts `SuccessCriterion[]` to `IRAssertion[]` with resolved element locators
- [ ] Generated IR is executable by `IRExecutor` (Chrome executor)
- [ ] Generated IR is renderable by `IRCodeGenerator` (Playwright adapter)
- [ ] Same capability + different data sets → different IR plans with different inputs but same structure
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **IRGenerator interface** | ✅ FROZEN — already defined in `execution-ir-design.md` §5 |
| **Capability → IR generation pipeline** | ✅ FROZEN |
| **DataResolver contract** | ✅ FROZEN |
| **ExecutionIRArtifact.source field** | ✅ FROZEN |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Generated IR diverges from recording-derived IR for the same capability | Run a round-trip test: record a capability → generate IR from recording → generate IR from capability → diff the two plans. Steps should match; only data values differ. |
| DataResolver can't resolve all field types | Start with the 7 data types from DataRequirement (text, email, password, date, select, number, file). Each has a deterministic resolution path from the test data set. |

---

## Phase 4: AI Test Generation Engine

### Objective
Use LLMs to generate additional test cases from the capability model — positive, negative, boundary, validation, accessibility, and security variants — that are immediately executable because they produce capabilities → IR → execution.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `TestGenerationEngine` | Orchestrates LLM prompt construction, response parsing, and test case creation |
| `PromptBuilder` | Composes structured prompts from Capability + SemanticInteraction[] + DataRequirements + execution history |
| `TestCaseFactory` | Creates `ApprovedTestCase` + `TestCaseVersion` from LLM-generated test specifications |
| `TestVariant Taxonomy` | Classification of test types: positive, negative, boundary, validation, accessibility, security, regression |
| `AnalysisProjection` type | AI-derived projections over SemanticInteraction[] (intent classification, relationships, workflow patterns) |

### Components Refactored

| Component | Change |
|-----------|--------|
| AI Provider Manager | Already supports 6 providers; add `generateTestVariants` capability to the `AIProvider` interface (additive method) |
| Capability UI | Add "Generate Test Variants" button on capability detail view |

### Why This Phase Must Come After Phase 3
AI generates test case *specifications* (steps, data, assertions). Those specifications need to be convertible to IR (Phase 3's `CapabilityIRGenerator`) to be executable. Without Phase 3, AI-generated tests are just text — not runnable.

### Why This Phase Must Come Before Phase 5
Enhanced execution (Phase 5) benefits from having more test cases to execute — especially negative and boundary tests that stress the execution engine's retry and assertion evaluation.

### User-Visible Functionality Unlocked
- **AI test generation:** QA tester clicks "Generate Test Variants" on a capability. The AI proposes:
  - Positive: "Login with valid credentials" (already exists)
  - Negative: "Login with invalid password" (new — expects error message)
  - Boundary: "Login with 255-character username" (new — tests field length)
  - Validation: "Login with empty email field" (new — expects validation error)
  - Accessibility: "Login using keyboard only" (new — verifies tab order)
  - Security: "Login with SQL injection in password" (new — verifies sanitization)
- **Variant review:** QA tester reviews AI-proposed test cases, edits data/assertions, approves.
- **Batch generation:** Generate variants for all capabilities in a project at once.

### Acceptance Criteria
- [ ] `TestGenerationEngine` produces at least 3 variant test cases per capability (positive, negative, boundary)
- [ ] Each generated variant has explicit expected outcomes (not just "try this")
- [ ] `TestCaseFactory` creates valid `ApprovedTestCase` + `TestCaseVersion` from LLM output
- [ ] Generated test cases are executable via `CapabilityIRGenerator` → `IRExecutor`
- [ ] LLM prompt includes: capability metadata, data requirements, success criteria, and at least 1 prior execution result
- [ ] `AnalysisProjection` populated for at least intent classification (navigation, data_entry, selection, configuration, authentication, verification)
- [ ] AI provider abstraction works with at least 2 providers (Gemini + OpenAI)
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **AnalysisProjection type** | ✅ FROZEN — AI projection over SemanticInteraction[] |
| **TestVariant taxonomy** | ✅ FROZEN — positive, negative, boundary, validation, accessibility, security, regression |
| **TestGenerationEngine interface** | ✅ FROZEN |
| **PromptBuilder input contract** | ✅ FROZEN — Capability + SemanticInteraction + history |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| LLM generates invalid test steps | `TestCaseFactory` validates every step against the `StepAction` enum and `DataRequirement` constraints. Invalid steps are rejected with structured error messages fed back to the LLM for correction. |
| LLM generates test cases that can't execute | The generated test case goes through the same `CapabilityIRGenerator` → `IRExecutor` path. If it can't execute, the error is caught and surfaced as "generation produced unexecutable test — please review." |
| Token cost per generation is high | Cache the prompt template. Only send the capability's structural data (not full SemanticInteraction[] — send the summary). Batch-generate variants in a single LLM call. |
| Different LLM providers produce different quality | The `PromptBuilder` produces provider-agnostic structured prompts. Quality varies by model, but the `TestCaseFactory` validation ensures structural correctness regardless of provider. |

---

## Phase 5: Enhanced Execution Engine

### Objective
Wire up the execution parameters already designed in the IR contract (`retryCount`, `waitStrategy`, `retryDelayMs`) and add evidence capture (screenshots on failure, DOM snapshots). This makes execution reliable enough for CI/CD integration.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `RetryHandler` | Implements retry logic: on failure, wait `retryDelayMs`, retry up to `retryCount` times |
| `WaitStrategyHandler` | Implements wait strategies: `visible` (wait for element visible), `present` (wait for element in DOM), `stable` (wait for element not animating) |
| `EvidenceCaptureService` | Captures screenshots (base64 PNG), DOM snapshots, and console logs on step failure |
| `SuiteExecutor` | Orchestrates multiple `IRExecutor` runs as a test suite (parallel or sequential) |

### Components Refactored

| Component | Change |
|-----------|--------|
| IR Executor content script | Implement `waitForElement` action, retry logic, and wait strategy polling |
| `ExecutionStepResult` | Add `screenshot`, `domSnapshot`, `consoleErrors` fields (all optional, additive) |
| `ExecutionRun` | Add `suiteRunId` field for grouping runs in a suite (additive) |

### Why This Phase Must Come After Phase 4
Phase 4 generates many test variants. Those variants need reliable execution to be useful — especially negative and boundary tests that may trigger different application behaviors. Enhanced retry and evidence capture make the difference between "the test failed" and "the test failed because the custom dropdown didn't expand after the first click; retry succeeded."

### User-Visible Functionality Unlocked
- **Retry on transient failure:** A flaky custom dropdown click retries automatically. The user sees "Step 3: passed (retry 1 of 2)" instead of "Step 3: failed."
- **Failure screenshots:** When a step fails, a screenshot is captured and displayed in the execution results.
- **Test suite execution:** "Run all test cases for this capability" executes them as a suite with aggregate pass/fail reporting.
- **Wait strategies:** Autocomplete interactions wait for stability; date pickers wait for presence; simple clicks wait for visibility. Fewer false negatives.

### Acceptance Criteria
- [ ] `RetryHandler` retries failed steps up to `retryCount` with `retryDelayMs` delay
- [ ] `WaitStrategyHandler` implements `visible`, `present`, `stable` strategies
- [ ] `EvidenceCaptureService` captures screenshot on step failure
- [ ] `SuiteExecutor` runs multiple test cases sequentially with aggregate reporting
- [ ] `ExecutionStepResult` carries screenshot data for failed steps
- [ ] Custom dropdown clicks get `retryCount: 2` automatically via `ExecutionProjection`
- [ ] Autocomplete interactions get `waitStrategy: 'stable'` automatically
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **ExecutionStepResult evidence fields** | ✅ FROZEN — screenshot, domSnapshot, consoleErrors |
| **SuiteExecutor interface** | ✅ FROZEN |
| **Wait strategy semantics** | ✅ FROZEN — none, visible, present, stable |
| **Retry semantics** | ✅ FROZEN — retryCount, retryDelayMs |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Retry masks real failures | Only retry on transient errors (element not found, timeout). Never retry on assertion failures. The `severity` field on assertions (`hard` vs `soft`) governs this. |
| Screenshots are too large for IndexedDB | Compress to JPEG at 80% quality for failure screenshots. Cap at 500KB per screenshot. Store full-resolution only if user opts in. |
| Suite execution takes too long | Sequential execution with configurable parallelism (V1: sequential; V2: parallel with configurable worker count). |

---

## Phase 6: Multi-Engine Execution — Playwright

### Objective
Implement the first non-Chrome-extension execution engine: a Playwright-based `IRExecutor` that runs IR plans headlessly or in a headed browser. This validates the multi-engine contract and enables CI/CD integration.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `PlaywrightExecutor` | Implements `IRExecutor` using the Playwright browser automation API |
| `PlaywrightLocatorResolver` | Resolves IR locators to Playwright locator strategies (`getByRole`, `getByTestId`, `locator()`) |
| `PlaywrightActionHandler` | Maps IRAction → Playwright method calls (reuses `action-renderer.ts` logic for execution, not code generation) |
| `PlaywrightAssertionEvaluator` | Evaluates IRAssertions using Playwright's expect API |
| `ExecutionEngineRegistry` | Registry of available execution engines: Chrome executor (existing), Playwright executor (new) |

### Why This Phase Must Come After Phase 5
Playwright execution needs the same retry, wait strategy, and evidence capture as Chrome execution. Phase 5's `RetryHandler`, `WaitStrategyHandler`, and `EvidenceCaptureService` are engine-agnostic — they work with any executor. Building Playwright before Phase 5 would mean duplicating execution reliability logic.

### User-Visible Functionality Unlocked
- **Headless execution:** Run tests in a headless browser (no visible Chrome window). Essential for CI/CD.
- **Cross-browser testing:** Execute the same test in Chromium, Firefox, and WebKit.
- **Engine selection:** QA tester picks "Chrome Extension" or "Playwright" as the execution engine before running a test.
- **CI/CD export:** Generated Playwright tests can run in CI/CD pipelines independently of the extension.

### Acceptance Criteria
- [ ] `PlaywrightExecutor` implements `IRExecutor.execute(plan, options) → IRExecutionResult`
- [ ] Same IR plan produces identical execution results in Chrome executor and Playwright executor
- [ ] `PlaywrightLocatorResolver` resolves all 8 `LocatorStrategyType` values to Playwright locators
- [ ] `PlaywrightAssertionEvaluator` evaluates all `ValidationType` values
- [ ] `ExecutionEngineRegistry` allows selecting engine at execution time
- [ ] Playwright executor captures screenshots on failure (via Playwright's screenshot API)
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **ExecutionEngineRegistry interface** | ✅ FROZEN |
| **PlaywrightExecutor contract** | ✅ FROZEN — same IRExecutor interface |
| **Multi-engine execution validated** | ✅ Two independent engines run the same IR |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Playwright locator resolution differs from Chrome content script | Use Playwright's `getByRole`, `getByTestId` APIs which are semantically equivalent to the accessibility-based resolution in the Chrome executor. Validate with the same characterization tests. |
| Playwright package size is too large for the extension | Playwright executor is a separate module, lazy-loaded only when the user selects "Playwright" as the engine. The Chrome extension executor remains the default. |
| Same IR produces different results across engines | This is actually expected (different browsers render differently). The acceptance criterion is "structurally identical" (same steps, same assertions, same pass/fail logic) — not "bit-identical." |

---

## Phase 7: AI Failure Analysis & Enhanced Self-Healing

### Objective
Add LLM-powered failure analysis that diagnoses WHY a test failed at the business level, and AI-assisted healing that suggests locator strategies based on semantic context. This closes the feedback loop: execution failure → AI diagnosis → healing → re-execution → learning.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `FailureAnalysisEngine` | Composes LLM prompt from ExecutionRun + Capability + SemanticInteraction; produces structured root-cause analysis |
| `RootCauseReport` type | Structured failure analysis: root cause category, affected capability, affected step, suggested fix |
| `AIHealingService` | Extends `healElementAndPersist()`: when deterministic ranking fails, query LLM for locator suggestions based on semantic context |
| `HealingFeedbackLoop` | Tracks healing success rate per element; feeds back into locator confidence scoring |

### Components Refactored

| Component | Change |
|-----------|--------|
| `healElementAndPersist()` | Add optional AI healing path: if deterministic ranking fails, call `AIHealingService` before giving up |
| `Element.locatorStrategies` | `confidence` field starts being computed from observed success rates (not just 1.0/null) |
| `ExecutionRun` | Add `rootCauseAnalysis?: RootCauseReport` field (additive) |
| Capability entity | `failureModes[]` enriched by AI failure analysis results |

### Why This Phase Must Come After Phase 6
The AI needs execution results from both Chrome and Playwright engines to identify patterns ("this element fails on Firefox but not Chromium"). Phase 6's multi-engine execution provides the data.

### User-Visible Functionality Unlocked
- **Root-cause analysis:** When a test fails, the AI explains: "The login capability failed at the authentication step. The submit button's accessible name changed from 'Login' to 'Sign In'. This is a UI text change, not a functional regression. Suggested fix: update the locator to `getByRole('button', {name: 'Sign In'})`."
- **AI-assisted healing:** When deterministic healing fails, the AI suggests locators based on the element's semantic context (component type, surrounding text, behavioral signature, known framework patterns).
- **Healing feedback:** Elements that frequently need healing are flagged. Confidence scores reflect real-world reliability.
- **Capability failure modes:** Known failure modes accumulate on capabilities, enabling proactive maintenance.

### Acceptance Criteria
- [ ] `FailureAnalysisEngine` produces a `RootCauseReport` for any failed `ExecutionRun`
- [ ] Root cause categories include: locator_broken, ui_text_changed, element_moved, framework_migration, timing_issue, data_issue, environment_issue
- [ ] `AIHealingService` suggests locator strategies when deterministic ranking fails
- [ ] AI-suggested locators go through the same `healElementAndPersist()` audit trail with `proposedBy: 'ai'`
- [ ] `HealingFeedbackLoop` updates `locatorStrategies[].confidence` based on observed success rates
- [ ] `Capability.failureModes[]` accumulates from execution results
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **RootCauseReport type** | ✅ FROZEN |
| **FailureAnalysisEngine interface** | ✅ FROZEN |
| **AIHealingService contract** | ✅ FROZEN — extends existing healing core |
| **Healing feedback loop** | ✅ FROZEN — confidence from observed success |
| **Root cause taxonomy** | ✅ FROZEN |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| LLM produces incorrect root cause | The `RootCauseReport` is advisory — it's shown to the QA tester, not auto-applied. The tester decides whether to act on the suggestion. |
| AI-suggested locators are wrong | AI suggestions go through the same validation as deterministic locators: they must resolve on the live page before being persisted. A locator that doesn't resolve is rejected. |
| Confidence scoring destabilizes locator ranking | Confidence changes are gradual (weighted moving average of recent execution results). The priority ordering doesn't change unless confidence drops below a threshold. |

---

## Phase 8: Cross-Platform Capture & Execution Foundation

### Objective
Extract the `CaptureAdapter` interface from the existing EventTap, making the capture layer pluggable. Add the type expansions needed for mobile and API platforms (locator types, target variants, action types, environment model). This is the foundation for non-web platform support.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CaptureAdapter` interface | Abstract capture layer: `startCapture() → ObservedEvent[]`, `stopCapture() → void` |
| `WebCaptureAdapter` | Existing EventTap + IdentityExtractor, refactored to implement `CaptureAdapter` |
| `MobileLocatorType` enum expansion | `ACCESSIBILITY_ID`, `CLASS_CHAIN`, `IMAGE_MATCH` (additive to `LocatorStrategyType`) |
| `ApiTarget` variant | Additive member of `ResolvedTarget` discriminated union: `{ kind: 'api', endpoint, method }` |
| `IREnvironment.platform` field | Additive: `'web' | 'mobile' | 'desktop' | 'api'` |
| `IRAction` expansion | Additive: `API_CALL`, `SWIPE`, `LONG_PRESS` (future, not Phase 8 scope) |

### Components Refactored

| Component | Change |
|-----------|--------|
| `EventTap` | Implement `CaptureAdapter` interface; rename internal class to `WebCaptureAdapter` |
| `LocatorStrategyType` | Add mobile/API values (additive enum expansion) |
| `ResolvedTarget` | Add `ApiTarget` variant (additive union member) |
| `IREnvironment` | Add `platform` and `device` fields (additive) |

### Why This Phase Must Come After Phase 7
Phase 7 completes the web platform's feedback loop (record → understand → execute → analyze → heal → learn). Cross-platform expansion is additive to a complete web platform — it doesn't make sense to expand before the web platform is mature.

### Why This Phase Is the Foundation for Phase 9
Phase 9 adds actual mobile/API capture and execution implementations. Those implementations need the interfaces (CaptureAdapter, expanded LocatorStrategyType, ApiTarget) that Phase 8 defines.

### User-Visible Functionality Unlocked
No new user-visible features for web users. This phase is infrastructure preparation.

**What an early adopter notices:** The type system now has slots for mobile locators and API targets. The IR model can represent mobile and API interactions. But there's no mobile capture or API capture yet — those come in Phase 9.

### Acceptance Criteria
- [ ] `CaptureAdapter` interface defined with `startCapture`, `stopCapture`, `onObservedEvent`
- [ ] `WebCaptureAdapter` implements `CaptureAdapter` (EventTap logic unchanged, just wrapped)
- [ ] `LocatorStrategyType` includes mobile and API values (additive)
- [ ] `ResolvedTarget` includes `ApiTarget` variant (additive)
- [ ] `IREnvironment` includes `platform` and `device` fields (additive)
- [ ] Web recording and execution produce identical results as before (zero regression)
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **CaptureAdapter interface** | ✅ FROZEN |
| **LocatorStrategyType (expanded)** | ✅ FROZEN — DOM + mobile + API |
| **ResolvedTarget (expanded)** | ✅ FROZEN — element + url + none + api |
| **IREnvironment (expanded)** | ✅ FROZEN — platform field |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| EventTap refactor breaks recording | The refactor is an interface extraction: EventTap's internal logic is unchanged. It just implements an interface instead of being called directly. Validate with the full 3,810+ test suite + real-world recording characterization tests. |
| Enum expansions break switch statements | TypeScript exhaustive switch checks catch missing cases at compile time. Any switch on LocatorStrategyType or ResolvedTarget will fail to compile until all cases are handled. |

---

## Phase 9: Platform Expansion — Mobile (Appium) & API

### Objective
Implement the first non-web capture and execution engines: Appium for mobile, and an HTTP-level executor for API testing. This proves the cross-platform architecture works end-to-end.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `MobileCaptureAdapter` | Implements `CaptureAdapter`: Appium event bridge → ObservedEvent with mobile context |
| `ApiCaptureAdapter` | Implements `CaptureAdapter`: HTTP proxy / OpenAPI spec import → ObservedEvent with API context |
| `AppiumExecutor` | Implements `IRExecutor`: mobile execution via Appium driver |
| `ApiExecutor` | Implements `IRExecutor`: HTTP-level execution via fetch/supertest |
| `AppiumCodeGenerator` | Implements `IRCodeGenerator`: Appium test code generation |
| `MobileIdentityExtractor` | Mobile-specific identity (accessibility ID, class name, resource ID) |
| `ApiInteractionMapper` | Maps HTTP requests/responses to SemanticInteraction types |

### Why This Phase Must Come After Phase 8
Phase 8 defines the interfaces (`CaptureAdapter`, expanded `LocatorStrategyType`, `ApiTarget`). Phase 9 implements them.

### User-Visible Functionality Unlocked
- **Mobile test recording:** QA tester records a workflow on a mobile app via Appium. The same capability inference, IR generation, and execution pipeline works.
- **API test generation:** QA tester imports an OpenAPI spec or records HTTP traffic. The system generates API-level test cases.
- **Cross-platform test suites:** The same business capability (e.g., "User Login") has web, mobile, and API variants. A regression in the login API is detected independently of the web UI.

### Acceptance Criteria
- [ ] `MobileCaptureAdapter` captures at least 5 mobile interaction types (tap, long-press, swipe, text entry, navigation)
- [ ] `AppiumExecutor` executes IR plans with mobile locator types
- [ ] `ApiExecutor` executes IR plans with `API_CALL` action and `ApiTarget`
- [ ] Mobile interactions produce valid `SemanticInteraction[]` (same 22-field model)
- [ ] Capability matching works across platforms (web login + mobile login → same capability)
- [ ] All existing web tests pass (zero regression from type expansions)

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **MobileCaptureAdapter contract** | ✅ FROZEN |
| **AppiumExecutor contract** | ✅ FROZEN |
| **ApiExecutor contract** | ✅ FROZEN |
| **Cross-platform SemanticInteraction** | ✅ Validated — same model works for web + mobile + API |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Mobile capture has fundamentally different event semantics | The `ObservedEvent` type already has a flexible `context` field. Mobile events populate it with `mobileContext` (accessibility ID, class name) instead of `domContext` (CSS selector, ARIA). The semantic level (InteractionType) is platform-agnostic. |
| Appium setup is complex for users | Appium executor requires the user to have an Appium server running. Document the setup. The web executor (Chrome extension) remains the default; Appium is opt-in. |
| API testing doesn't fit the interaction model | API interactions are different (request/response, not click/fill), but they map to the semantic level: an HTTP POST maps to `InteractionType.Submit`, the response maps to an assertion. The `ApiTarget` variant carries the endpoint and method. |

---

## Phase 10: Continuous Learning & Platform Intelligence

### Objective
Activate the continuous learning flywheel: every recording, every execution, and every failure enriches the capability model. The platform gets smarter about what each capability looks like, what its failure modes are, and what test coverage gaps exist.

### Components Introduced

| New Component | Purpose |
|---------------|---------|
| `CapabilityEnrichmentPipeline` | Automated enrichment: new recording → match existing capability → update inputs/outcomes/rules/failure modes |
| `CoverageAnalyzer` | Maps capabilities to test cases; identifies untested capabilities and untested data variants |
| `ImpactAnalyzer` | Given a UI change (element healed), determines which capabilities and test cases are affected |
| `WorkflowMiner` | Discovers common capability sequences across recordings (Login → Search → Filter → Export) |
| `RegressionDetector` | Compares execution results across runs to detect regressions automatically |
| `MaintenanceRecommender` | AI-powered recommendations: "3 capabilities haven't been tested in 30 days," "Login capability has 2 broken locators," "Search capability has no negative test cases" |

### Why This Phase Must Come Last
Continuous learning requires all prior phases:
- Capability model (Phase 2) for the learning substrate
- Execution results (Phase 5-6) for empirical data
- AI analysis (Phase 4, 7) for intelligent recommendations
- Cross-platform data (Phase 9) for comprehensive coverage

### User-Visible Functionality Unlocked
- **Coverage dashboard:** Visual map of capabilities vs test cases. Green = tested, yellow = partially tested, red = untested.
- **Impact analysis:** "The login button was redesigned. 3 capabilities and 12 test cases are potentially affected. Here are the specific steps that reference the changed element."
- **Regression detection:** "Test suite results changed since last run: Login capability now fails on Firefox (was passing). Root cause: button text changed."
- **Maintenance recommendations:** Weekly AI digest of test health, coverage gaps, and healing needs.
- **Workflow patterns:** "Users commonly perform Login → Search → Book → Pay. Consider creating a composite test case for this workflow."

### Acceptance Criteria
- [ ] `CapabilityEnrichmentPipeline` enriches capabilities automatically from new recordings (no user action needed)
- [ ] `CoverageAnalyzer` produces a capability × test-case coverage matrix
- [ ] `ImpactAnalyzer` identifies affected capabilities when elements are healed
- [ ] `RegressionDetector` compares execution results across runs and flags changes
- [ ] `MaintenanceRecommender` produces at least 3 actionable recommendations per project
- [ ] Enrichment history is fully auditable (every enrichment event has structured deltas)
- [ ] All existing tests pass

### Contracts Frozen After This Phase
| Contract | Status |
|----------|--------|
| **CoverageAnalyzer interface** | ✅ FROZEN |
| **ImpactAnalyzer interface** | ✅ FROZEN |
| **WorkflowMiner interface** | ✅ FROZEN |
| **RegressionDetector interface** | ✅ FROZEN |
| **MaintenanceRecommender interface** | ✅ FROZEN |
| **Enrichment pipeline contract** | ✅ FROZEN |

### Risks & Validation

| Risk | Mitigation |
|------|-----------|
| Enrichment produces noise (too many low-quality updates) | Enrichment confidence thresholds: only apply updates with >0.7 confidence. Flag lower-confidence updates for human review. |
| Coverage analysis is misleading | Coverage is based on capability × data-variant × platform. A capability with only positive tests on web is "partially covered" (yellow), not "covered" (green). |
| Impact analysis is too broad | Impact is scoped to capabilities that reference the changed element via `SemanticInteraction.target.identity.elementId`. Only capabilities with direct references are flagged. |

---

## Dependency Graph

```
Phase 0: SemanticInteraction Contract & Pipeline Unification
    │
    ▼
Phase 1: Persistent Semantic Layer
    │
    ├──────────────────────────┐
    ▼                          ▼
Phase 2: Capability        Phase 5: Enhanced Execution
Adoption Lifecycle             │
    │                          ▼
    ▼                      Phase 6: Playwright Executor
Phase 3: Capability-Derived     │
IR Generation                   │
    │                           │
    ▼                           ▼
Phase 4: AI Test           Phase 7: AI Failure Analysis
Generation                 & Enhanced Self-Healing
                               │
                               ▼
                          Phase 8: Cross-Platform
                          Capture Foundation
                               │
                               ▼
                          Phase 9: Mobile & API
                          Expansion
                               │
                               ▼
                          Phase 10: Continuous Learning
                          & Platform Intelligence
```

**Critical path:** Phase 0 → 1 → 2 → 3 → 4 (the semantic-to-AI pipeline)
**Parallel track:** Phase 5 → 6 → 7 (the execution reliability track)
**Expansion track:** Phase 8 → 9 (the cross-platform track)
**Convergence:** Phase 10 requires all tracks complete

---

## Frozen Contract Summary (All Phases)

| Phase | Contracts Frozen |
|-------|-----------------|
| 0 | SemanticInteraction (22 fields), Observation/Projection boundary, IR Bridge input contract |
| 1 | SemanticInteractionRepository, AssertionProjection, ExecutionProjection, Dexie v4 |
| 2 | Capability lifecycle, versioning, composition, DataRequirement, SuccessCriterion |
| 3 | IRGenerator interface, Capability→IR pipeline, DataResolver |
| 4 | AnalysisProjection, TestVariant taxonomy, TestGenerationEngine |
| 5 | Evidence fields, SuiteExecutor, wait/retry semantics |
| 6 | ExecutionEngineRegistry, PlaywrightExecutor contract |
| 7 | RootCauseReport, FailureAnalysisEngine, AIHealingService, healing feedback loop |
| 8 | CaptureAdapter, expanded LocatorStrategyType/ResolvedTarget/IREnvironment |
| 9 | Mobile/API capture + executor contracts |
| 10 | Coverage/Impact/Regression/Maintenance interfaces |

**Total frozen contracts:** 40+ types and interfaces, all additive to the Phase 0 foundation.

---

## What Makes This Roadmap Debt-Free

### No Temporary Architectures
Every phase introduces components that are permanent. Nothing is built to be thrown away. The `SemanticInteraction` type introduced in Phase 0 is the same type used in Phase 10. The `IRExecutor` interface used in Phase 6 is the same interface used in Phase 9.

### No Parallel Systems
Phase 0 explicitly eliminates the existing dual-pipeline problem. After that, every new component is additive — it implements an existing interface or extends an existing type. No second pipeline, no "v2 alongside v1," no bridge layers between parallel systems.

### Every Phase Is Independently Valuable
| Phase | User Value If We Stopped Here |
|-------|------------------------------|
| 0 | Cleaner architecture, richer interaction metadata |
| 1 | Better assertions, type-aware execution, fewer flaky failures |
| 2 | Capability management, data-driven testing, cross-session enrichment |
| 3 | Re-execute without re-recording, environment switching |
| 4 | AI-generated test variants (positive, negative, boundary, security) |
| 5 | Retry, screenshots, test suites — CI/CD ready |
| 6 | Headless Playwright execution, cross-browser testing |
| 7 | AI root-cause analysis, AI-assisted healing |
| 8 | Infrastructure for mobile/API (no user-visible change yet) |
| 9 | Mobile recording + API testing |
| 10 | Coverage analysis, impact analysis, continuous learning |

**If we stopped after Phase 4, we'd have an AI-powered test generation platform for web apps.**
**If we stopped after Phase 7, we'd have a full AI QA platform for web apps.**
**If we complete all 10 phases, we'd have a full AI QA Automation platform across web, mobile, and API.**

---

## Key Design Principle Throughout

> **The observation is immutable. The capability is versioned. The IR is disposable. The implementation is replaceable.**

Every phase respects this separation. No phase pollutes the observation with consumer concerns. No phase makes the IR non-disposable. No phase couples the capability to a specific execution engine. This is what makes the architecture ceiling-proof — and what makes every phase additive rather than transformative.
