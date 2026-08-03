# 6. Future Roadmap

This document describes the remaining planned work, organized by priority. Each item includes its goal, why it's needed, dependencies, and recommended implementation order.

---

## Required Architecture (Next Priorities)

### Phase 6: Wire Knowledge Fragment into Generation Pipeline

**Goal:** The generation pipeline currently operates on raw `SessionEvent`s. It should also consume the `ApplicationKnowledgeFragment` to produce richer, more semantic test steps.

**Why needed:** The knowledge fragment contains `LogicalAction[]` (semantically grouped actions), `InteractionContract` (input constraints), and `BehavioralContract` (state machine understanding). The generation pipeline can use these to:
- Generate steps from logical actions instead of raw events
- Include validation assertions from behavioral contracts
- Reference business field names instead of element IDs
- Detect branch points and generate conditional test logic

**Dependencies:** Phase 5 enrichment (complete)

**Expected outputs:** Improved test step quality, validation assertions, business-domain language

**Recommended order:** 1st — this is the highest-impact next step

---

### Phase 7: Legacy Pipeline Retirement

**Goal:** Remove the legacy `deterministic-recorder.ts` pipeline once Architecture C is proven to cover all interaction types.

**Why needed:** Maintaining two pipelines is technical debt. The legacy pipeline has ~6,399 lines of code that Architecture C replaces.

**Dependencies:** Confidence that Architecture C covers all 33 legacy interaction types. Requires E2E validation against real-world applications.

**Expected outputs:** Simplified codebase, reduced maintenance, faster builds

**Recommended order:** 2nd — after Phase 6 proves the knowledge model adds value through Architecture C

---

### Self-Healing Locator Implementation

**Goal:** When a UI element changes (selector drift), the system detects staleness and resolves the element by re-matching its identity signature.

**Why needed:** This is the core value proposition of CmdRunner — tests that survive UI changes. The architecture is designed (staleness tracking, heal history, element identity) but the actual healing logic is not implemented.

**Dependencies:** Element repository (complete), staleness tracking (complete), execution IR (complete)

**Expected outputs:** Automatic locator repair, reduced test maintenance, heal audit trail

**Recommended order:** 3rd — after the generation pipeline fully uses the knowledge model

**How it works (designed):**
1. Element has 18-field identity signature
2. When a test runs and the primary locator fails, the system re-resolves using the identity signature
3. If a match is found, the element's locators are updated and `healHistory[]` records the change
4. If no match, element status → BROKEN

---

### Test Execution Engine

**Goal:** Actually run generated tests and capture results.

**Why needed:** Currently CmdRunner generates test artifacts but doesn't execute them. The Execution IR has the `IRExecutor` interface, but no runner implementation exists.

**Dependencies:** Execution IR (complete), Playwright adapter (complete)

**Expected outputs:** Test run results, evidence capture (screenshots, DOM snapshots, logs)

**Recommended order:** 4th — execution is the natural next step after generation is solid

---

## Important Enhancements

### Test Suite Composition UI

**Goal:** Allow users to compose test suites from test cases, configure execution environments, and manage run schedules.

**Why needed:** The entities (`TestSuite`, `EnvironmentProfile`) are designed but have no UI. Users need to organize test cases into runnable suites.

**Dependencies:** Repository V2 (complete), test case management UI

---

### Repository UI Enhancements

**Goal:** Enhance the repository page (`src/repository/`) to fully manage projects, test cases, elements, and execution plans.

**Why needed:** The repository page exists but is basic. Full CRUD operations, search, filtering, and version comparison are needed.

**Dependencies:** Repository V2 (complete)

---

### Natural Language Authoring

**Goal:** Allow users to write test cases in natural language ("Login to the app, navigate to settings, change the password") and have the system generate structured test cases.

**Why needed:** This is a key differentiator. The domain model supports it (`SourceArtifact` type = `NATURAL_LANGUAGE`), the AI infrastructure exists, but the NL → ATC conversion is not implemented.

**Dependencies:** AI service (complete), domain model (complete), knowledge fragment (complete — provides application context for NL understanding)

---

### Coverage Visualization

**Goal:** Show which application surfaces and components are covered by existing tests.

**Why needed:** The `ApplicationSurface` derived view groups elements by URL. Combined with test case data, this can produce coverage maps.

**Dependencies:** Knowledge fragment (complete), repository (complete)

---

## Optional / Nice-to-Have

### Image/Screenshot Authoring

**Goal:** Allow users to upload screenshots of desired interactions and have AI generate test cases from them.

**Why needed:** The `SourceArtifact` type supports `IMAGE`. The screenshot service exists. AI vision capabilities can interpret screenshots.

**Dependencies:** AI vision (provider-dependent), domain model (complete)

---

### Cypress Adapter

**Goal:** Generate Cypress test files in addition to Playwright.

**Why needed:** Some teams use Cypress. The Execution IR is engine-agnostic, so a Cypress adapter would implement `IRCodeGenerator`.

**Dependencies:** Execution IR (complete), Cypress API knowledge

---

### Appium Adapter

**Goal:** Generate mobile test automation via Appium.

**Why needed:** Mobile testing extension. Would require mobile-specific interaction types.

**Dependencies:** Execution IR (complete), significant design work for mobile interactions

---

### Test Data Management

**Goal:** Full test data system with static values, parameterized data, and factory patterns.

**Why needed:** The `TestData` entity is designed (type: static|parameterized|factory) but only static is implemented.

**Dependencies:** Domain model (complete), repository (complete)

---

### Flakiness Analytics

**Goal:** Track test flakiness across runs and identify patterns.

**Why needed:** The domain model has fields for this but no analytics implementation.

**Dependencies:** Test execution engine, multiple test runs

---

## Recommended Implementation Order

1. **Wire Knowledge Fragment → Generation Pipeline** — highest impact, leverages completed work
2. **Legacy Pipeline Retirement** — reduces debt, simplifies codebase
3. **Self-Healing Locators** — core value proposition, architecture is ready
4. **Test Execution Engine** — completes the test lifecycle
5. **Repository UI Enhancements** — makes the system usable for real projects
6. **Natural Language Authoring** — key differentiator, leverages AI infrastructure
7. **Test Suite Composition** — needed for organized test management
8. **Coverage Visualization** — leverages knowledge model, high user value

Items 9+ (Cypress adapter, Appium, image authoring, test data, flakiness) are deferred and can be prioritized based on user demand.
