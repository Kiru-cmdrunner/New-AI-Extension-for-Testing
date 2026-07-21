# Domain Scope — V1, Deferred, and Out of Scope

**Status:** Foundation blueprint — V1 scope boundaries
**Date:** 2026-07-20
**Companion to:** `domain-schema.md`, `domain-erd.md`

---

## Purpose

This document defines **exactly what is built in Version 1**, what is **architecturally prepared for but not built**, and what is **deliberately excluded** from the current architecture. The objective is to avoid overengineering V1 while ensuring the underlying schema is correct and scalable.

The three categories:

| Category | Meaning | Signal |
|----------|---------|--------|
| **✅ Implemented in V1** | Built and functional. Logic exists, fields are populated, invariants are enforced. | Code + tests |
| **🔵 Deferred but architected for** | Not built, but the schema *supports* adding it without a migration. The slot exists; V1 leaves it empty or static. When the feature is built later, it drops into the existing schema — no ALTER TABLE, no entity redesign. | Schema-ready, logic-not-built |
| **🔴 Not designed for** | Deliberately out of scope. Would require schema changes to support. Listed so the boundary is explicit — these are conscious exclusions, not oversights. | Would need migration |

The value of this document lives in the **second category**. "Deferred but architected for" is the difference between "we deferred self-healing" (ambiguous — did you leave room?) and "we deferred self-healing, and the Element Repository already stores a ranked locator strategy list with a `healHistory` array, so self-healing drops in as a write-path without touching the schema."

---

## Entity-by-Entity Scope

### 3.1 Project

| Capability | Category | Notes |
|------------|----------|-------|
| Project CRUD (create, read, update, delete) | ✅ V1 | Basic project management |
| Project as tenancy/isolation boundary | ✅ V1 | Every entity scoped by `projectId` |
| Project-level tag vocabulary | ✅ V1 | Advisory autocomplete list; not enforced |
| Multi-tenant permissions (RBAC) | 🔴 Not designed for | V1 is single-user. Would need a permissions entity |
| Cross-project element sharing | 🔴 Not designed for | Would need a shared element namespace |
| Project archiving | 🔵 Deferred | `status: active\|archived` in schema; archive logic not built |

### 3.2 Approved Test Case

| Capability | Category | Notes |
|------------|----------|-------|
| ATC CRUD (create, read, update metadata, delete) | ✅ V1 | Title, description, tags, priority editable |
| ATC Versions (immutable snapshots) | ✅ V1 | New version on step change; `currentVersionId` pointer |
| Status workflow: draft → in_review → approved → deprecated | ✅ V1 | All four states implemented; transitions enforced |
| Steps with action, description, element reference, input | ✅ V1 | Core step model |
| Validations (presence, visibility, textMatch, etc.) | ✅ V1 | Full validation model with severity |
| `{{testData.key}}` template substitution in step inputs | ✅ V1 | Resolved at execution time |
| AIMetadata (confidence, reasoning, model version) | ✅ V1 | Populated during AI review; stored on version |
| Approval records (who approved, when) | ✅ V1 | `approvedBy`, `approvedAt` on version |
| Multi-reviewer workflow | 🔵 Deferred | Schema supports multiple approvals; V1 uses single approver |
| Rich version diff view (visual side-by-side) | 🔵 Deferred | `parentVersionId` exists; diff UI not built |
| Test case collections (free-form folders) | 🔵 Deferred | Tags fulfill this role in V1; `parent_collection_id` slot can be added later |
| Branching/merging test case versions | 🔴 Not designed for | Git-style versioning; would need a branch entity |
| Test case templating / inheritance | 🔴 Not designed for | Would need a template entity and inheritance rules |

### 3.3 Source Artifact

| Capability | Category | Notes |
|------------|----------|-------|
| Source Artifact as polymorphic entity | ✅ V1 | `type` discriminator with type-specific content |
| Interaction Timeline (recorder output) as source | ✅ V1 | Stores SessionEvent[] from CmdRunner recorder |
| Manual authoring as source | ✅ V1 | Test cases created directly in the editor |
| Source immutability | ✅ V1 | Once created, content never changes |
| Provenance tracking (version ↔ sources) | ✅ V1 | `sourceArtifactIds[]` on ATC Version |
| Regeneration from source (re-interpret with improved AI) | 🔵 Deferred | Schema supports it (`sourceArtifactIds` + immutable sources); re-interpretation pipeline not built in V1 |
| Natural Language as source | 🔵 Deferred | Schema supports the type; NL ingestion pipeline not built |
| Image/Screenshot as source | 🔵 Deferred | Schema supports the type; image-based test generation not built |
| Imported Document as source | 🔵 Deferred | Schema supports the type; document parsing not built |
| Training dataset export (source → ATC pairs) | 🔴 Not designed for | Would need a training pipeline entity |
| Source artifact versioning | 🔴 Not designed for | Sources are immutable; no versioning needed |

### 3.4 Element Repository

| Capability | Category | Notes |
|------------|----------|-------|
| Element CRUD (create, read, update, delete) | ✅ V1 | Full lifecycle management |
| Elements as first-class, project-scoped entities | ✅ V1 | Stable IDs, project ownership |
| Ranked locator strategies (priority-ordered list) | ✅ V1 | `locatorStrategies[]` with priority field |
| Element status: active, stale, broken | ✅ V1 (partial) | States exist in schema; `active` is set automatically. `stale`/`broken` can be set manually but are not auto-detected in V1. |
| Page/component scoping | ✅ V1 | `pageOrComponent` field prevents naming collisions |
| Referential integrity (block delete if referenced) | ✅ V1 | INV-EL3 enforced |
| Confidence field on locator strategies | 🔵 Deferred | Field exists in schema (`confidence`); not computed in V1. Default 1.0 for manual, null for AI-suggested. Future self-healing will populate it from observed success rates. |
| `healHistory` array | 🔵 Deferred | Field exists in schema; empty array in V1. Self-healing will append events. |
| `lastHealedAt` timestamp | 🔵 Deferred | Field exists; null in V1 |
| Auto-detection of stale/broken locators | 🔵 Deferred | Schema supports the status values; detection logic not built |
| Self-healing (AI proposes new locator on failure) | 🔵 Deferred | Schema fully supports it (`healHistory`, `status`, ranked strategies). Write-path not built. |
| Element versioning (full locator change history) | 🔵 Deferred | `healHistory` is the placeholder; full versioning (like ATC versions) not built |
| ML-ranked locator strategies (learned from success rates) | 🔴 Not designed for | Would need a training/feedback loop entity |
| Cross-project element unification | 🔴 Not designed for | Would need a shared element namespace |
| Auto-discovery (scan app and populate element repo) | 🔴 Not designed for | Would need a crawler + AI classification entity |

### 3.5 Test Data

| Capability | Category | Notes |
|------------|----------|-------|
| Test Data CRUD | ✅ V1 | Basic dataset management |
| Static datasets (single row of key-value pairs) | ✅ V1 | `type: static` |
| Parameterized datasets (multiple rows for data-driven testing) | ✅ V1 | `type: parameterized`; executor runs once per row |
| `{{testData.key}}` template substitution | ✅ V1 | Resolved at execution time |
| ATC → Test Data references (`testDataRefs`) | ✅ V1 | Many-to-many through reference array |
| Factory datasets (programmatic generation via Faker, etc.) | 🔵 Deferred | Schema supports `type: factory`; execution logic not built |
| Test Data versioning / snapshotting at run time | 🔵 Deferred | Run already snapshots environment; same pattern can extend to data |
| Field-level secret marking (`is_secret` per field) | 🔵 Deferred | V1 treats entire dataset as potentially sensitive |
| Environment-specific datasets (same dataset, different values per env) | 🔵 Deferred | Can be modeled with profile-specific overrides |
| Test data relationships (Dataset A references Dataset B's entities) | 🔴 Not designed for | Would need a relational data model entity |
| Database seeding / teardown integration | 🔴 Not designed for | Would need a DB provisioning entity |

### 3.6 Test Suite

| Capability | Category | Notes |
|------------|----------|-------|
| Test Suite CRUD | ✅ V1 | Basic suite management |
| Tag-based membership | ✅ V1 | `tagFilters[]` resolved at run time |
| Explicit ID membership | ✅ V1 | `testCaseIds[]` |
| Exclusion overrides | ✅ V1 | `excludeIds[]` overrides tag filters |
| Priority filtering | ✅ V1 | `priorityFilter[]` |
| Execution config (retry, ordering, parallelism, stopOnFailure) | ✅ V1 | Full config model |
| Environment profile association | ✅ V1 | Optional default profile per suite |
| Suite runs (execute a suite → produces multiple test runs) | ✅ V1 | `suiteRunId` links individual runs to suite execution |
| Membership resolution at run time | ✅ V1 | INV-TS1 — new tagged tests auto-included |
| Rerun failed only | 🔵 Deferred | Field exists (`rerunFailedOnly`); logic not built |
| Suite scheduling (cron) | 🔵 Deferred | Schema-ready; scheduler not built |
| Suite dependencies (Suite B runs only if Suite A passes) | 🔴 Not designed for | Would need a dependency graph entity |
| Nested suites (suite of suites) | 🔴 Not designed for | Would need recursive containment |

### 3.7 Environment Profile

| Capability | Category | Notes |
|------------|----------|-------|
| Environment Profile CRUD | ✅ V1 | Basic profile management |
| Browser selection (chrome, firefox, safari, edge) | ✅ V1 | All four in enum |
| Viewport configuration | ✅ V1 | `{ width, height }` |
| Base URL configuration | ✅ V1 | Required field |
| Browser capabilities/permissions | ✅ V1 | Geolocation, notifications, etc. |
| Profile snapshotting into Test Runs | ✅ V1 | INV-EP1 — frozen copy at run time |
| Device emulation (mobile devices) | 🔵 Deferred | `device` field exists in schema; emulation logic not built |
| Profile versioning | 🔵 Deferred | Run-time snapshot suffices for V1; full versioning deferred |
| Multi-environment runs (same test, multiple envs) | 🔵 Deferred | Can be done via multiple runs; no native matrix execution |
| Cloud provider integration (BrowserStack, SauceLabs) | 🔴 Not designed for | Would need a provider integration entity |
| Network condition simulation (throttling) | 🔴 Not designed for | Would need a network profile entity |

### 3.8 Test Run

| Capability | Category | Notes |
|------------|----------|-------|
| Test Run creation and tracking | ✅ V1 | Full run lifecycle |
| Pinned ATC version reference | ✅ V1 | INV-TR1 — run pins to specific version |
| Environment snapshot (frozen copy) | ✅ V1 | INV-TR1 — profile snapshotted at run time |
| Step Results (pass/fail per step) | ✅ V1 | One result per step in the pinned version |
| Evidence capture (screenshots, DOM snapshots, logs) | ✅ V1 | Full evidence model |
| Run status lifecycle (pending → running → passed/failed/error/skipped) | ✅ V1 | All states implemented |
| Run immutability after completion | ✅ V1 | INV-TR3 — terminal states are frozen |
| Trigger tracking (manual, scheduled, ci, suite) | ✅ V1 | `triggerType` and `triggeredBy` |
| Error details on step failure | ✅ V1 | Message, stack trace, error type |
| Retry tracking | ✅ V1 | `retryCount` field |
| Actual vs. expected value comparison | ✅ V1 | Denormalized on step result |
| Suite run linkage | ✅ V1 | `suiteRunId` for suite-triggered runs |
| Flakiness detection (statistical analysis across runs) | 🔵 Deferred | Run data is captured; analytics not built |
| Video recording of execution | 🔵 Deferred | `video` in evidence type enum; capture logic not built |
| Network log / HAR capture | 🔵 Deferred | `har`, `networkLog` in evidence enum; capture logic not built |
| Test data snapshot at run time | 🔵 Deferred | `testDataSnapshot` field exists; not populated in V1 |
| Real-time run streaming (live step-by-step updates) | 🔵 Deferred | Run status is queryable; live streaming not built |
| Run retention policies (auto-delete old runs) | 🔵 Deferred | V1 retains all runs; policy engine not built |
| Parallel run execution infrastructure | 🔴 Not designed for | Would need a worker/queue entity |

### 3.9 Execution IR

| Capability | Category | Notes |
|------------|----------|-------|
| IR generation from (ATC Version + Element Repository) | ✅ V1 | Core generation pipeline |
| IR caching (store generated IR for reuse) | ✅ V1 | Avoids regeneration on every execution |
| Element ID → resolved locator strategies (at generation time) | ✅ V1 | The key derivation step |
| CmdRunner JSON rendering | ✅ V1 | Primary execution format |
| Playwright code rendering | ✅ V1 | Secondary rendering target |
| IR provenance (`generatorVersion`, `generatedAt`) | ✅ V1 | Audit trail |
| IR regeneration (discard cache, regenerate from source) | ✅ V1 | Manual trigger |
| IR diff display (what changed on regeneration) | 🔵 Deferred | `elementRepositoryVersion` field exists; diff logic not built |
| Cypress rendering | 🔵 Deferred | Enum value exists; renderer not built |
| Appium rendering (mobile) | 🔵 Deferred | Enum value exists; renderer not built |
| Auto-regeneration on element locator change | 🔵 Deferred | Manual regeneration in V1; auto-trigger deferred |
| IR versioning (multiple cached versions) | 🔴 Not designed for | IR is ephemeral; one cached copy per ATC version |

---

## Capability Matrix — By Domain Area

A cross-cutting view of what's in, deferred, and out — organized by the capability areas the user cares about.

### Authoring (How test cases are created)

| Capability | Category |
|------------|----------|
| Record interactions → AI review → Approved Test Case | ✅ V1 |
| Manual authoring in test case editor | ✅ V1 |
| AI enrichment (proposing steps, validations, descriptions) | ✅ V1 |
| Regeneration from source (re-interpret with improved AI) | 🔵 Deferred |
| Natural language → Approved Test Case | 🔵 Deferred |
| Screenshot → Approved Test Case | 🔵 Deferred |
| Imported document → Approved Test Case | 🔵 Deferred |
| Multi-modal input (combine recording + NL + image) | 🔴 Not designed for |

### Repository (How test cases are stored and organized)

| Capability | Category |
|------------|----------|
| Flat repository with tags | ✅ V1 |
| Approved Test Case versioning | ✅ V1 |
| Element Repository (first-class) | ✅ V1 |
| Test Data management | ✅ V1 |
| Hierarchy (Project → Feature → Scenario → TestCase) | 🔴 Not designed for |
| Collections (free-form folders) | 🔵 Deferred |
| Branching/merging versions | 🔴 Not designed for |
| Cross-project sharing | 🔴 Not designed for |

### Execution (How tests run)

| Capability | Category |
|------------|----------|
| Single test case execution | ✅ V1 |
| Suite execution (multiple tests) | ✅ V1 |
| Data-driven testing (parameterized datasets) | ✅ V1 |
| Retry on failure | ✅ V1 |
| Parallel execution (config in suite) | ✅ V1 (config) |
| Environment profile selection | ✅ V1 |
| Evidence capture (screenshots, DOM, logs) | ✅ V1 |
| Parallel execution infrastructure | 🔴 Not designed for |
| Scheduled execution | 🔵 Deferred |
| CI integration | 🔵 Deferred |
| Cloud provider execution | 🔴 Not designed for |

### Generation (How business intent becomes executable code)

| Capability | Category |
|------------|----------|
| ATC → Execution IR | ✅ V1 |
| IR → CmdRunner JSON | ✅ V1 |
| IR → Playwright | ✅ V1 |
| IR regeneration | ✅ V1 |
| IR → Cypress | 🔵 Deferred |
| IR → Appium | 🔵 Deferred |
| Auto-regeneration on locator change | 🔵 Deferred |

### Intelligence (AI capabilities)

| Capability | Category |
|------------|----------|
| AI review of recordings → proposed ATC | ✅ V1 |
| AI enrichment (naming, descriptions, validations) | ✅ V1 |
| AI confidence + reasoning metadata | ✅ V1 |
| Self-healing locators | 🔵 Deferred |
| AI-proposed test improvements | 🔵 Deferred |
| Flakiness prediction | 🔴 Not designed for |
| ML-ranked locator strategies | 🔴 Not designed for |
| Training pipeline (source → ATC pairs) | 🔴 Not designed for |

### Reporting & Analytics

| Capability | Category |
|------------|----------|
| Run results (pass/fail per step) | ✅ V1 |
| Evidence viewing (screenshots, DOM, logs) | ✅ V1 |
| Historical run list per test case | ✅ V1 |
| Run comparison across versions | 🔵 Deferred |
| Flakiness analytics | 🔵 Deferred |
| Coverage analytics | 🔴 Not designed for |
| Custom dashboards | 🔴 Not designed for |

---

## Migration Risk Assessment

For each "deferred but architected for" capability, this table documents **what schema support exists** and **what would be needed to activate it**. This is the proof that deferral does not create rework.

| Deferred Capability | Schema Support Already Exists | What's Needed to Activate (No Schema Change) |
|---------------------|-------------------------------|-----------------------------------------------|
| **Self-healing locators** | Element.`healHistory[]`, Element.`status` (active/stale/broken), Element.`lastHealedAt`, LocatorStrategy.`confidence` | Write-path: run failure → AI proposes new locator → append to healHistory → update locatorStrategies → regenerate IR |
| **Natural Language authoring** | SourceArtifact `type: natural_language` with content schema | Ingestion pipeline: NL → AI interpretation → draft ATC version |
| **Image/Screenshot authoring** | SourceArtifact `type: image` with content schema | Vision model integration: image → AI interpretation → draft ATC version |
| **Regeneration from source** | SourceArtifact immutability + ATC Version.`sourceArtifactIds[]` | Re-interpretation pipeline: source → improved AI → new ATC version (with parentVersionId chain) |
| **Locator confidence ranking** | LocatorStrategy.`confidence` field | Feedback loop: execution success/failure → update confidence scores → re-rank strategies |
| **Test Data factories** | TestData `type: factory` with schema definition | Factory execution engine: Faker/schema → generate rows → substitute into steps |
| **Test Data snapshotting** | TestRun.`testDataSnapshot` field | Snapshot logic: at run creation, deep-copy resolved test data into the run |
| **Flakiness analytics** | TestRun status history + step results | Analytics pipeline: aggregate run results → compute flake rate → surface in UI |
| **Scheduled execution** | TestSuite entity + executionConfig | Scheduler service: cron trigger → resolve membership → create runs |
| **IR diff display** | ExecutionIR.`elementRepositoryVersion` field | Diff engine: compare cached IR vs. regenerated IR → surface changes |
| **Element versioning** | Element.`healHistory[]` (append-only event log) | Versioning logic: treat healHistory entries as versions → enable diff queries |
| **Multi-reviewer workflow** | ATC Version has `approvedBy`/`approvedAt` (single) | Extend to approval array: multiple approvers with roles |
| **Device emulation** | EnvironmentProfile.`device` field | Emulation config: map device name to viewport + UA + touch settings |
| **Video recording** | Evidence `type: video` | Video capture integration: recorder during execution → store path |
| **Network/HAR capture** | Evidence `type: networkLog`, `type: har` | Network interception during execution → store log/HAR file |
| **Run retention policies** | TestRun has `createdAt` | Retention job: age-based deletion with safeguards |

**Every deferred capability in this table can be activated without a schema migration.** That is the architectural guarantee this document provides.

---

## V1 Summary

**What V1 delivers:**

A fully functional testing platform where:
1. Users record interactions (or author manually) and an AI workflow produces an Approved Test Case.
2. Test cases are versioned, organized by tags, and reference a first-class Element Repository.
3. Test cases can be parameterized with Test Data for data-driven testing.
4. Test Suites compose test cases by tags/IDs with execution configuration.
5. Environment Profiles define where tests run (browser, viewport, base URL).
6. Test Runs execute approved test cases against environments, capturing evidence.
7. Execution IR is generated from the ATC + Element Repository and rendered to CmdRunner JSON or Playwright.

**What V1 deliberately does not deliver:**

Advanced AI capabilities (self-healing, NL/image authoring, regeneration from source), enterprise features (RBAC, hierarchy, scheduling), and analytics (flakiness, coverage). These are either architected for (schema-ready, logic not built) or explicitly out of scope (would need schema changes).

The foundation is correct. The deferred capabilities drop in without rework. The out-of-scope items are conscious decisions, not oversights.
