# 5. Current Implementation Status

## Summary

| Area | Status | Tests |
|------|--------|-------|
| Extension Foundation (M1) | ✅ Complete | 20+ |
| Deterministic Recorder (v6.1.0) | ✅ Active runtime | 800+ |
| Domain Adapter (Phase 6.2) | ✅ Complete | 84 |
| Pipeline Runner (Phase 6.3–6.5) | ✅ Wired | 11 |
| Component Recognition (Phases 1–4) | ✅ Complete | 200+ |
| Post-Recording Enrichment (Phase 5) | ✅ Complete | 145 |
| Generation Pipeline | ✅ Wired | 200+ |
| Domain Model & Repository V2 | ✅ Complete | 100+ |
| Execution IR | ✅ Complete | 50+ |
| Playwright Adapter | ✅ Complete | 50+ |
| Architecture C | 📦 Archived to `legacy/` | — |
| **Total tests** | | **3126 across 119 files** |

## Architecture Decision: Option B (Phase 6–7)

In Phase 6–7, we adopted **Option B**: evolve the deterministic recorder as the sole
runtime and integrate Recognition → Enrichment → Generation on top of it, without
Architecture C. This eliminated ~2,500 lines of dormant code and ~100 tests that were
never wired into production.

**Pipeline flow (active runtime):**

```
Deterministic Recorder → V1/V2 Classifier → Domain Adapter → Recognition → Enrichment → Generation → Side Panel
```

Architecture C files (universal observer, state tracker, interaction assembler,
AI observer, ai-service, snapshot coalescer) are preserved under `legacy/architecture-c/`
for reference only. They are excluded from the build and test suite.

## Detailed Status

### ✅ Fully Completed

#### Extension Foundation
- Manifest V3 configuration
- Side Panel UI with recording controls and timeline
- Settings page with AI provider configuration
- Storage service with debounce and schema versioning
- Message routing (8 typed message types — dead types removed in Phase 7)

#### Recording Pipeline (Production)
1. **Deterministic Recorder** — the sole content script
   - Captures 33 interaction types via raw event recording
   - V1 rule-based classifier + V2 evidence engine with merge layer
   - 5 evidence providers (DOM, ARIA, event-sequence, mutation, CSS-classname)
   - Handles: click, text entry, navigation, hover, checkbox, radio, select,
     date picker, drag & drop, file upload, autocomplete, toggle switch, tabs,
     slider, window/frame interactions

#### Pipeline Wiring (Phase 6)
- **Domain Adapter** (`src/recorder/pipeline/domain-adapter.ts`)
  Transforms `RecordedEvent[]` + `DetectedInteraction[]` → `UiElement[]` + `ObservedTransition[]`
  Pure transformation, no side effects. 84 tests.
- **Pipeline Runner** (`src/recorder/pipeline/pipeline-runner.ts`)
  Chains: domain adapter → recognition orchestrator → enrichment orchestrator →
  Application Knowledge Fragment. Uses `NullDomInspector` (service worker has no DOM).
- **Service Worker Integration**
  Pipeline runs on STOP_RECORDING in try/catch (non-fatal — existing classification
  results remain if pipeline fails). Results stored via 3 new StorageKeys:
  `KNOWLEDGE_FRAGMENT`, `RECOGNITION_COMPONENTS`, `DOMAIN_ENTITIES`.

#### Component Recognition (Phases 1–4)
- Pattern catalogue: 11 pattern types with behavioral signatures
- Structural recognizer (Tier 1)
- Behavioral recognizer (Tier 2)
- Component registry with lifecycle management
- Recognition orchestrator

#### Post-Recording Enrichment (Phase 5)
- 9 enrichment modules (interaction contract, option set, behavioral contract,
  semantic aggregator, workflow deriver, surface deriver, fragment assembler,
  orchestrator, DOM inspector)
- Semantic aggregation with lifecycle occurrence segmentation (Rules A/B/C)
- Application Knowledge Fragment assembly
- 145 tests across 8 test files

#### Generation Pipeline
- Semantic classifier with multi-tier support
- Confidence engine
- Canonical step generator (plain-English output)
- Execution JSON generator (CmdRunner format)
- Playwright generator (complete TypeScript test files)
- Readability optimizer (step merging, phrasing)
- Locator resolution engine (7 locator strategies)
- Verb mapping table (frozen)

#### Domain Model
- 9 core entities fully designed and implemented
- Entity factories with invariant validation
- Entity relationship model with cascade rules

#### Repository V2
- Dexie (IndexedDB) implementation
- Unit of Work pattern
- Full CRUD for: Projects, Test Cases, Elements, Execution IR, Source Artifacts
- Schema versioning

#### Execution IR
- Type system (IRAction, ResolvedLocator, ResolvedTarget, IRAssertion, IRStep, ExecutionIRPlan)
- Generator (ATC version → IR plan)
- Staleness tracking (missing → fresh → stale)
- Two adapter interfaces (IRExecutor, IRCodeGenerator)

#### Playwright Adapter
- Action renderer (IRAction → Playwright code)
- Locator renderer (ResolvedLocator → Playwright locator)
- Assertion renderer (IRAssertion → Playwright expect)
- Test function renderer (IRStep[] → complete test function)
- Page object renderer (optional POM pattern)
- Project generator (complete flat project export)

#### AI Integration
- 6 providers: OpenAI, Claude, Gemini, Azure OpenAI, OpenRouter, Custom
- Provider manager with capability detection
- Connection tester
- Settings page integration

### 📦 Archived (Phase 7)

All Architecture C code has been moved to `legacy/architecture-c/`:

| Module | Path | Reason |
|--------|------|--------|
| Universal Interaction Observer | `legacy/architecture-c/observer/` | Never registered in manifest |
| State Tracker | `legacy/architecture-c/context/` | Never registered in manifest |
| Snapshot Coalescer | `legacy/architecture-c/coalescer/` | Never imported by runtime |
| Architecture C Pipeline | `legacy/architecture-c/pipeline/` | Never imported by runtime |
| AI Observer / AI Service | `legacy/architecture-c/ai/` | Not imported by active runtime |
| Observer Helpers | `legacy/architecture-c/observer/` | Logic inlined in deterministic recorder |

These files are excluded from both the build (`vite build`) and test suite (`vitest`).
They are preserved for reference — they contain working implementations of identity
extraction, DOM observation, and composite interaction assembly that may inform future work.

12 dead message types were removed from the `AppMessage` union:
`CLICK_CAPTURED`, `TEXT_CAPTURED`, `HOVER_CAPTURED`, `CHECKBOX_CAPTURED`,
`RADIO_CAPTURED`, `SELECT_CAPTURED`, `DATE_SELECT_CAPTURED`, `CREATE_TEST_CASE`,
`CLEAR_TEST_CASE`, `RAW_EVIDENCE`, `DETERMINISTIC_STATE`, `PIPELINE_EVENT`.

### ⚡ Partially Implemented

#### Fragment → Generation Integration
- The Application Knowledge Fragment is now produced by the pipeline runner and
  stored in `chrome.storage.local` under `KNOWLEDGE_FRAGMENT`
- The generation engine still reads from `SessionEvent[]` — it does not yet
  consume the knowledge fragment for richer test step output
- **Next step:** Wire the knowledge fragment into the generation pipeline so
  LogicalActions and component-level contracts enhance generated steps

### 📋 Pending / Not Started

#### Self-Healing Locators
- Architecture is designed (staleness detection, heal history)
- Element repository has `healHistory[]` field (schema-ready)
- Not yet implemented — element status transitions (active → stale → broken)
  are defined but not triggered

#### Test Execution
- Execution IR has the IRExecutor interface
- CmdRunner execution model is designed
- No actual test runner implementation

#### Test Suite Composition
- TestSuite entity is designed
- EnvironmentProfile entity is designed
- No UI for composing test suites or configuring environments

#### Test Run Management
- TestRun entity is designed
- No UI for viewing test run results or evidence

#### Multi-Format Export Beyond Playwright
- Cypress adapter: designed but not implemented
- Appium adapter: mentioned in roadmap but not designed

## Git Status

| Field | Value |
|-------|-------|
| Branch | `main` |
| HEAD | `373693c` — Phase 6-7: pipeline wiring + Architecture C retirement |
| Remote (origin) | `git.drytis.dev` (Drytis internal git server) |
| Remote (upstream) | `github.com/Kiru-cmdrunner/cmdrunner-smart-recorder` (GitHub) |
| Sync status | Both remotes at `373693c` |
| Tags | 25 versioned tags preserved from pre-squash history |

## Project Health

### Strengths
- **3126 tests, all passing** — comprehensive coverage
- **Single runtime pipeline** — no dual-pipeline confusion (Architecture C retired)
- **Clean architectural separation** — each subsystem is independently testable
- **Typed contracts everywhere** — no untyped message passing
- **Frozen design decisions** — prevents regression of key principles
- **No dormant code** — all active source is imported by the runtime

### Technical Debt
- **Pre-existing TypeScript errors in `deterministic-recorder.ts`** — content script
  uses inline types and browser APIs that don't match the TS config. These are
  grandfathered; the file works correctly in the browser extension context.
- **`NullDomInspector`** — the enrichment pipeline uses a null implementation
  because the service worker has no DOM access. Some enrichment derivers that
  require DOM queries will produce limited results until a tab-injection path
  is added.
- **Fragment → Generation gap** — the knowledge fragment is produced but not
  yet consumed by the generation engine for richer output.

### Dependency Status
- **Runtime dependencies:** `dexie` (IndexedDB), `fake-indexeddb` (testing)
- **Dev dependencies:** `vite`, `@crxjs/vite-plugin`, `vitest`, `typescript`, `puppeteer-core`, `jsdom`
- **No heavy frameworks** — vanilla TypeScript throughout
- **Lock file:** `package-lock.json` present
