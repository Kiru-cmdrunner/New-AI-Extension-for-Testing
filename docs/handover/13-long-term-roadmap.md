# CmdRunner Smart Recorder — Long-Term Roadmap

> Generated: 2026-07-21 · Updated: 2026-07-21 (Phase 8 complete)
> Current state: 2,475 tests across 100 files · Build succeeds · HEAD: `00e11b7`

---

## Current Capability Assessment

### ✅ Complete & Wired Into Runtime

| Capability | Status | Notes |
|-----------|--------|-------|
| Extension shell (MV3, Side Panel, Settings) | ✅ Complete | 4 views: home → new-tc → recording → stopped |
| Deterministic recorder (content script) | ✅ Active | 2,340 LOC, captures 33 interaction types, 18-field element identity |
| V1 rule-based classifier | ✅ Wired | 16-rule classifier, runs in service worker |
| V2 evidence engine | ✅ Wired | 5 evidence providers, weighted voting, runs in parallel with V1 |
| V1/V2 merge layer | ✅ Wired | V2-primary with V1 fallback |
| Domain adapter | ✅ Wired | RecordedEvent[] + DetectedInteraction[] → UiElement[] + ObservedTransition[] |
| Recognition orchestrator (3-tier) | ✅ Wired | Structural → behavioral → component registry, 6/11 patterns registered |
| Post-recording enrichment pipeline | ✅ Wired | 9 modules → ApplicationKnowledgeFragment (7-step pipeline) |
| Generation engine | ✅ Wired | IR Bridge (SessionEvent[] + DetectedInteraction[] + KnowledgeFragment → ExecutionIRPlan → PlaywrightCodeGenerator). Legacy CanonicalStep pipeline retired. |
| Side panel display | ✅ Complete | Shows raw events, detected interactions, IR Plan steps (action, locators, assertions), Playwright project files, replay JSON |
| AI provider infrastructure | ✅ Complete | 6 providers (OpenAI, Claude, Gemini, Azure, OpenRouter, Custom), provider manager, connection tester |
| Settings page | ✅ Complete | AI provider config, API keys, model selection, connection testing |

### ⚠️ Complete But NOT Wired Into Runtime

| Capability | Status | What's Missing |
|-----------|--------|----------------|
| **Knowledge Fragment → Generation** | ✅ Complete (Phase 8) | IR Bridge consumes fragment + events + interactions → ExecutionIRPlan |
| **Execution IR generation** | ✅ Complete (Phase 8) | IR Bridge produces ExecutionIRPlan, PlaywrightCodeGenerator renders to code files |
| **IR-based Playwright generation** | ✅ Complete (Phase 8) | PlaywrightCodeGenerator wired into service worker via IR Bridge |
| **Repository V2 (Dexie/IndexedDB)** | ⚠️ Fully implemented, tested, not wired | Runtime still uses legacy `RepositoryService` (chrome.storage.local, flat hierarchy) |
| **Staleness detection** | ⚠️ `checkStaleness()` + `detectLocatorChanges()` complete, not wired | Only called from tests. No runtime trigger for staleness checks |
| **Screenshot capture** | ⚠️ `ScreenshotService` complete, not wired | Never called from recorder or service worker |
| **AI sendPrompt()** | ⚠️ All 6 providers' `sendPrompt()` methods complete, not wired | Only used for connection testing. No AI advisory layer in the pipeline |
| **Pattern catalogue** | ⚠️ 6/11 patterns registered | DATE_PICKER, TABLE, SLIDER, COMBOBOX, CUSTOM have enum values but no pattern definitions |

### ❌ Not Started

| Capability | Status |
|-----------|--------|
| Self-healing locator logic | ❌ Types defined (`HealEvent`, `ElementStatus.STALE/BROKEN`), no implementation |
| Test execution engine | ❌ `IRExecutor` interface exists, no implementation |
| Test suite composition | ❌ No `TestSuite` entity, no UI |
| Environment/profile management | ❌ No `EnvironmentProfile` entity, no UI |
| Test run management | ❌ No `TestRun` entity, no UI, no execution results storage |
| Test data management | ❌ No `TestData` entity, no UI |
| Cypress adapter | ❌ `RenderingEngine` type includes `'cypress'`, no implementation |
| Appium adapter | ❌ `RenderingEngine` type includes `'appium'`, no implementation |
| Coverage visualization | ❌ No UI, no analysis |
| CI/CD integration | ❌ Not present |
| Visual regression testing | ❌ Not present |
| Cross-tab recording | ❌ Only active tab recorded |
| DOM snapshot capture | ❌ Not implemented |

### 🗑️ Should Be Dropped

| Item | Reason |
|------|--------|
| ~~Retire deterministic recorder (original Phase 7)~~ | **Superseded** — Option B decision (Phase 6-7) retains the deterministic recorder as the long-term runtime. Architecture C was retired instead. |
| Cross-tab recording | MV3 limitations make multi-tab content script coordination fragile. Low user demand. The product records single-tab workflows, which covers 95% of test scenarios. |
| Visual regression testing | Different product scope. This is a test *execution* concern, not a *recording/generation* concern. Belongs in a downstream tool. |
| Parallel test execution | Depends on test execution engine (Phase 12). Defer until single-test execution works. Not a roadmap item — it's an optimization. |
| Appium adapter | Significant design work for mobile interaction models. No current user demand. Re-evaluate if mobile testing becomes a priority. |

---

## Roadmap: Remaining Phases

### Phase 8: Knowledge Fragment → Generation Integration — ✅ COMPLETE

> **Status**: Implemented via IR Bridge architecture (not the original CanonicalStep modification plan).
> The legacy CanonicalStep → ExecutionJson → Playwright pipeline was fully retired.
> The IR Bridge (src/generation/ir-bridge.ts) consumes SessionEvent[] + DetectedInteraction[] +
> ApplicationKnowledgeFragment and produces an ExecutionIRPlan — the single canonical representation
> for all downstream code generation. PlaywrightCodeGenerator renders the plan to a complete project.
>
> **Completed milestones**: 8.1 (IRStep + IRBridgeInput), 8.2 (IR Bridge build function, 740 LOC),
> 8.3 (Service worker wiring), 8.4 (Side panel rendering), 8.5 (Legacy pipeline retirement).
> **Results**: 2,475 tests pass (100 files), build 619ms. 17 legacy source files + 21 test files archived.
> See `docs/handover/14-target-generation-architecture.md` for the full architecture design.

---

### Phase 9: AI-Powered Enrichment

| Field | Value |
|-------|-------|
| **Priority** | 🟠 **High** |
| **Objective** | Wire AI providers into the pipeline as an advisory enrichment layer. AI improves step descriptions, infers user intent, and generates alternative test scenarios. |
| **Complexity** | Medium |
| **Dependencies** | Phase 8 (✅ needed), AI provider infrastructure (✅ complete) |
| **Partial/From scratch** | **Partial** — 6 AI providers with `sendPrompt()` are complete. Provider manager and connection tester are wired. The gap is: no AI service orchestrator, no prompt templates, no response parser, no integration point in the pipeline. |
| **Major features** | 1. Build `AIService` orchestrator (reads provider config, dispatches prompt, handles errors/retries)<br>2. Design prompt templates for: step description enrichment, intent inference, alternative scenario generation<br>3. Wire AI as optional Tier 3 in the classification pipeline (advisory — never overrides evidence)<br>4. Add "AI Enrich" toggle in side panel (user can enable/disable per session)<br>5. Add AI confidence display in step cards<br>6. Guard: AI is advisory only, evidence sovereignty preserved (per frozen design decision) |
| **Expected outcome** | Users can optionally enable AI to get richer, more natural test step descriptions and AI-suggested alternative test scenarios (negative, boundary, etc.). AI never overrides deterministic classification — it enriches. |

---

### Phase 10: Repository V2 Migration

| Field | Value |
|-------|-------|
| **Priority** | 🟠 **High** |
| **Objective** | Migrate the runtime from legacy `RepositoryService` (chrome.storage.local, flat hierarchy) to `Repository V2` (Dexie/IndexedDB, domain entities). This is a prerequisite for test suites, execution results, element tracking, and self-healing. |
| **Complexity** | Medium |
| **Dependencies** | None (Repository V2 is fully implemented and tested) |
| **Partial/From scratch** | **Partial** — Repository V2 (Dexie) is fully implemented with 6 tables, unit of work pattern, and all CRUD operations. The gap is: the runtime uses the old `RepositoryService` everywhere. Migration involves replacing `RepositoryService` calls with `DexieUnitOfWorkFactory` calls, migrating existing data, and updating the repository UI. |
| **Major features** | 1. Add data migration path (export from chrome.storage.local → import to Dexie)<br>2. Replace `RepositoryService` calls in side panel and service worker with Repository V2<br>3. Update repository UI to use Dexie queries instead of chrome.storage.local<br>4. Add `Element` tracking (store recognized elements per session)<br>5. Add `SourceArtifact` storage (store interaction timeline as artifact) |
| **Expected outcome** | All data persists in IndexedDB via Dexie with proper transactional boundaries. The old flat hierarchy is replaced with domain entities (Project, ApprovedTestCase, Element, SourceArtifact, ExecutionIRArtifact). Foundation for test suites, execution results, and self-healing. |

---

### Phase 11: Self-Healing Locators

| Field | Value |
|-------|-------|
| **Priority** | 🟠 **High** |
| **Objective** | Detect when element locators become stale (DOM changes between recording and execution) and automatically re-resolve using the 18-field identity signature. Record heal history for auditability. |
| **Complexity** | Medium |
| **Dependencies** | Phase 10 Repository V2 (✅ needed for Element persistence), staleness detection logic (✅ implemented) |
| **Partial/From scratch** | **Partial** — `checkStaleness()` and `detectLocatorChanges()` are fully implemented. `Element` entity has `healHistory[]` and `lastHealedAt` fields (schema-ready). `ElementStatus.STALE/BROKEN` enum values defined. The gap is: no runtime trigger for staleness checks, no healing logic, no UI to show staleness. |
| **Major features** | 1. Wire `checkStaleness()` into the generation pipeline (check locators against current DOM at generation time)<br>2. Implement `HealService` — re-resolves stale locators using identity signature (tag, role, accessibleName, textContent, CSS class patterns)<br>3. Record heal events in `Element.healHistory[]`<br>4. Update element status (ACTIVE → STALE → HEALED or BROKEN)<br>5. Show staleness indicators in the repository UI<br>6. Emit warnings in generated test code when locators were healed (comment annotations) |
| **Expected outcome** | When the DOM changes between recording and test execution, the system automatically detects stale locators and re-resolves them using the element's identity signature. Healed locators are tracked for auditability. Generated test code includes comments noting which locators were auto-healed. |

---

### Phase 12: Test Execution Engine

| Field | Value |
|-------|-------|
| **Priority** | 🟠 **High** |
| **Objective** | Execute generated tests and capture results — screenshots, DOM snapshots, pass/fail status, error messages. This transforms CmdRunner from a test *generator* into a test *runner*. |
| **Complexity** | Large |
| **Dependencies** | Phase 10 Repository V2 (✅ needed for results storage), Execution IR (✅ complete), Playwright adapter (✅ complete) |
| **Partial/From scratch** | **From scratch** — `IRExecutor` interface exists with `execute(plan, options) → IRExecutionResult`. No implementation. No `TestRun` entity. No execution UI. |
| **Major features** | 1. Define `TestRun` entity (run ID, test case IDs, environment, status, results[], timestamps)<br>2. Implement `IRExecutor` — executes IR plan against a target URL using Playwright (or browser automation)<br>3. Capture execution evidence: screenshots on failure, DOM snapshots, console logs, network errors<br>4. Store execution results in Repository V2 (new table or via `SourceArtifact`)<br>5. Add execution UI in side panel: "Run Test" button, progress indicator, results view<br>6. Handle execution errors: element not found, timeout, assertion failure, navigation failure<br>7. Wire screenshot service (already implemented) to capture evidence during execution |
| **Expected outcome** | Users can click "Run Test" to execute a recorded test against a target URL. The system runs the test, captures screenshots and DOM snapshots on failure, and displays pass/fail results with evidence. Results are persisted for historical comparison. |

---

### Phase 13: Test Suite Composition & Environment Management

| Field | Value |
|-------|-------|
| **Priority** | 🟡 **Medium** |
| **Objective** | Compose test suites from multiple test cases, configure execution environments (base URL, browser, viewport), and manage run schedules. |
| **Complexity** | Medium |
| **Dependencies** | Phase 10 Repository V2 (✅ needed), Phase 12 Test Execution Engine (✅ needed) |
| **Partial/From scratch** | **From scratch** — No `TestSuite`, `EnvironmentProfile`, or `TestData` entities exist. `IREnvironment` type exists in the IR types but has no entity wrapper. |
| **Major features** | 1. Define `TestSuite` entity (name, test case IDs, environment, execution order, parallel/sequential)<br>2. Define `EnvironmentProfile` entity (base URL, browser, viewport, authentication, custom headers)<br>3. Define `TestData` entity (static values, parameterized data, factory patterns)<br>4. Add suite composition UI: drag-and-drop test case ordering, environment selection<br>5. Add environment profile management UI<br>6. Add test data management: CSV import, variable substitution, data-driven test generation<br>7. Wire suite execution: run all test cases in order, collect results, generate summary report |
| **Expected outcome** | Users can compose test suites, configure environments, and run entire suites with one click. Test data can be parameterized for data-driven testing. Suite execution produces a summary report with per-test results. |

---

### Phase 14: Repository UI Enhancements

| Field | Value |
|-------|-------|
| **Priority** | 🟡 **Medium** |
| **Objective** | Full CRUD, search, filtering, version comparison, and element management in the repository page. |
| **Complexity** | Medium |
| **Dependencies** | Phase 10 Repository V2 (✅ needed for richer queries) |
| **Partial/From scratch** | **Partial** — Repository page exists with tree view, basic CRUD, and read-only test case detail viewer. Uses legacy `RepositoryService`. After Repository V2 migration, the UI needs to be updated to leverage Dexie queries for search, filtering, and version comparison. |
| **Major features** | 1. Full-text search across test cases, projects, elements<br>2. Filter by: interaction type, component type, date range, AI confidence, test status<br>3. Test case version comparison (diff view showing what changed between versions)<br>4. Element browser: view all recognized elements with their locator strategies, staleness status, and usage in test cases<br>5. Knowledge fragment viewer: visualize the Application Knowledge Fragment (surfaces, components, workflows)<br>6. Export: download test cases as JSON, Playwright project, or CmdRunner format<br>7. Import: upload test cases from JSON or Playwright files |
| **Expected outcome** | Users can search, filter, and manage their test repository with a modern UI. They can view element health, compare test case versions, and visualize the knowledge fragment. Export and import capabilities enable round-tripping with external tools. |

---

### Phase 15: Coverage Visualization

| Field | Value |
|-------|-------|
| **Priority** | 🟡 **Medium** |
| **Objective** | Show which application surfaces and components are covered by existing tests. Identify gaps where surfaces or components have no test coverage. |
| **Complexity** | Small |
| **Dependencies** | Phase 8 Knowledge Fragment → Generation (✅ needed), Phase 10 Repository V2 (✅ needed) |
| **Partial/From scratch** | **From scratch** — No coverage analysis code exists. The `ApplicationKnowledgeFragment` contains `applicationSurfaces` and `componentGroupings` that could be cross-referenced with stored test cases, but no analysis or visualization exists. |
| **Major features** | 1. Cross-reference `ApplicationSurface[]` (from knowledge fragments) with stored test cases<br>2. Cross-reference `ComponentGrouping[]` with test case element references<br>3. Generate coverage matrix: surface × component → test count, last tested date<br>4. Visualize as heat map or tree view in the repository UI<br>5. Identify uncovered surfaces and components<br>6. Suggest test cases for uncovered areas (using AI or heuristic) |
| **Expected outcome** | Users see a visual coverage map showing which parts of their application are tested and which aren't. They can identify gaps and generate new tests for uncovered areas. |

---

### Phase 16: Natural Language Authoring

| Field | Value |
|-------|-------|
| **Priority** | 🟡 **Medium** |
| **Objective** | Write test cases in natural language ("Login as admin, navigate to settings, change the password, verify success message") and have the system generate structured test cases from the description. |
| **Complexity** | Medium |
| **Dependencies** | Phase 8 Knowledge Fragment (✅ needed for component/element context), Phase 9 AI-Powered Enrichment (✅ needed) |
| **Partial/From scratch** | **From scratch** — No NL authoring code exists. AI providers with `sendPrompt()` are complete, but no prompt templates for test generation exist. |
| **Major features** | 1. Design NL → CanonicalStep parser (uses AI + knowledge fragment for context)<br>2. Build prompt template: "Given this application knowledge, generate test steps for: [user description]"<br>3. Parse AI response into structured CanonicalStep[] with element references<br>4. Resolve element references against the knowledge fragment (match "the password field" → UiElement with role=password)<br>5. Add NL authoring UI: text area in the side panel with "Generate Test" button<br>6. Validate generated steps against the knowledge fragment (flag unknown elements, impossible actions)<br>7. Allow manual editing of generated steps before saving |
| **Expected outcome** | Users can describe a test scenario in plain English and receive structured, runnable test steps. The system uses the knowledge fragment to resolve element references and validate that the described actions are possible. |

---

### Phase 17: Cypress Adapter

| Field | Value |
|-------|-------|
| **Priority** | 🟢 **Low** |
| **Objective** | Generate Cypress test files in addition to Playwright, using the Execution IR abstraction. |
| **Complexity** | Medium |
| **Dependencies** | Phase 10 Repository V2 (✅ for IR persistence), Execution IR (✅ complete) |
| **Partial/From scratch** | **Partial** — `IRCodeGenerator` interface is designed for extensibility. `RenderingEngine` type includes `'cypress'`. `PlaywrightCodeGenerator` is a reference implementation. A Cypress adapter would follow the same pattern. |
| **Major features** | 1. Implement `CypressCodeGenerator` (implements `IRCodeGenerator`)<br>2. Map IRAction → Cypress commands (click, type, select, check, etc.)<br>3. Map ResolvedLocator → Cypress selectors<br>4. Map IRAssertion → Cypress assertions<br>5. Generate Cypress project structure (cypress.config.ts, support/, e2e/)<br>6. Add output format selector in side panel (Playwright / Cypress toggle)<br>7. Tests covering all action types and locator strategies |
| **Expected outcome** | Users can choose between Playwright and Cypress output formats. Generated Cypress tests are syntactically correct and runnable. |

---

### Phase 18: Complete Pattern Catalogue

| Field | Value |
|-------|-------|
| **Priority** | 🟢 **Low** |
| **Objective** | Register the remaining 5 pattern types (DATE_PICKER, TABLE, SLIDER, COMBOBOX, CUSTOM) in the recognition pipeline. |
| **Complexity** | Small |
| **Dependencies** | Recognition pipeline (✅ complete) |
| **Partial/From scratch** | **Partial** — 6/11 patterns are registered with behavioral signatures. The remaining 5 have enum values but no `PatternDefinition` entries. The deterministic recorder already captures these interaction types — the gap is purely in component-level recognition. |
| **Major features** | 1. Define `DATE_PICKER` pattern (ARIA: role=application + combobox/gridcell; behavior: open calendar → navigate grid → select cell)<br>2. Define `TABLE` pattern (ARIA: role=table/grid + row/cell; behavior: sort, filter, paginate, row selection)<br>3. Define `SLIDER` pattern (ARIA: role=slider; behavior: drag or keyboard adjust)<br>4. Define `COMBOBOX` pattern (ARIA: role=combobox + listbox; behavior: type-to-filter → select option)<br>5. Define `CUSTOM` pattern (extensible user-defined patterns via configuration)<br>6. Add behavioral signatures for each (event sequences, state transitions)<br>7. Tests covering recognition of each pattern |
| **Expected outcome** | The recognition pipeline identifies all 11 UI component patterns, producing richer component groupings in the knowledge fragment. DATE_PICKER, TABLE, SLIDER, and COMBOBOX interactions are recognized at the component level, not just as individual clicks and typing. |

---

## Implementation Order (Recommended)

```
Phase 8  ✅ COMPLETE   Knowledge Fragment → Generation Integration (IR Bridge)
Phase 10 🟠 High        Repository V2 Migration
Phase 9  🟠 High        AI-Powered Enrichment
Phase 11 🟠 High        Self-Healing Locators
Phase 12 🟠 High        Test Execution Engine
Phase 14 🟡 Medium      Repository UI Enhancements
Phase 15 🟡 Medium      Coverage Visualization
Phase 13 🟡 Medium      Test Suite Composition & Environment Management
Phase 16 🟡 Medium      Natural Language Authoring
Phase 17 🟢 Low         Cypress Adapter
Phase 18 🟢 Low         Complete Pattern Catalogue
```

### Ordering rationale

1. **Phase 8** (Fragment → Generation) — ✅ COMPLETE. The IR Bridge now consumes the knowledge fragment + session events + detected interactions to produce a unified ExecutionIRPlan. This directly improved the core output (test steps with business-domain language and assertions).

2. **Phase 10** (Repository V2 Migration) is second because it's the foundation for everything downstream — self-healing needs Element persistence, test execution needs result storage, test suites need the new data model. It's a mechanical migration (code is written) with no design risk.

3. **Phase 9** (AI Enrichment) and **Phase 11** (Self-Healing) can proceed in parallel after Phase 10. AI enrichment enhances the output; self-healing ensures the output stays valid over time. Both are independent of each other.

4. **Phase 12** (Test Execution) is the largest phase and the one that transforms the product from a generator to a runner. It depends on Repository V2 for result storage.

5. **Phases 14-16** are user-facing enhancements that build on the foundation. They can be done in any order after Phase 12.

6. **Phases 17-18** are low priority — they add value but aren't critical to the product vision. Defer until user demand is clear.

---

## Summary: What CmdRunner Will Be When Complete

| Capability | Current | After Full Roadmap |
|-----------|---------|-------------------|
| Record interactions | ✅ Works | ✅ Works |
| Classify interactions | ✅ Works (V1+V2) | ✅ Works (V1+V2 + AI advisory) |
| Recognize components | ⚠️ 6/11 patterns | ✅ 11/11 patterns |
| Enrich with knowledge | ⚠️ Produced, not consumed | ✅ Consumed by generation |
| Generate test steps | ✅ Basic (raw events) | ✅ Rich (knowledge-driven) |
| Generate Playwright code | ✅ Works | ✅ Works (with assertions + conditionals) |
| Generate Cypress code | ❌ Not started | ✅ Works |
| Self-healing locators | ❌ Not started | ✅ Automatic re-resolution |
| Store test cases | ⚠️ Legacy storage | ✅ Dexie/IndexedDB with domain entities |
| Execute tests | ❌ Not started | ✅ Run + capture evidence |
| Compose test suites | ❌ Not started | ✅ Suites + environments + test data |
| View coverage | ❌ Not started | ✅ Visual coverage map |
| Author tests via NL | ❌ Not started | ✅ Natural language → structured tests |
| AI enrichment | ⚠️ Infrastructure only | ✅ Advisory layer in pipeline |
| Repository UI | ⚠️ Basic | ✅ Full CRUD, search, versioning |

The product vision is a tool where a user **records a workflow once** and receives **a complete, readable, runnable, self-healing test suite** that stays valid as the application evolves. Phases 8-12 deliver the core of that vision. Phases 13-18 make it polished and extensible.
