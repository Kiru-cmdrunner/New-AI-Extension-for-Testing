# Entity Relationship Diagram (ERD)

**Status:** Foundation blueprint — canonical entity relationships
**Date:** 2026-07-20
**Companion to:** `domain-schema.md`

---

## 1. Overview Diagram

The full entity map, grouped by owning context. Cardinality notation: `1───∞` = one-to-many, `∞───∞` = many-to-many, `1───1` = one-to-one, `0..1───∞` = optional one-to-many.

```
┌─ AUTHORING ──────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌──────────────────────┐                                            │
│  │   Source Artifact    │                                            │
│  │   (polymorphic)      │                                            │
│  │                      │                                            │
│  │  • interaction_      │                                            │
│  │    timeline          │                                            │
│  │  • natural_language  │                                            │
│  │  • image             │                                            │
│  │  • imported_document │                                            │
│  │  • manual            │                                            │
│  └──────────┬───────────┘                                            │
│             │                                                        │
│             │ provenance                                             │
│             │ (∞───∞ through ATC Version.sourceArtifactIds)           │
│             │                                                        │
└─────────────┼────────────────────────────────────────────────────────┘
              │
              │ [AI Workflow Review interprets Source → produces ATC Version]
              │
              ▼
┌─ REPOSITORY ─────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐    │
│  │  Approved Test Case  │ 1──┤  ATC Version                     │    │
│  │  (identity +         │    │  (immutable snapshot)            │    │
│  │   metadata)          │    │                                  │    │
│  │                      │    │  • versionNumber                 │    │
│  │  • title             │    │  • steps[]                       │    │
│  │  • tags              │    │  • sourceArtifactIds[]  ─────────┼────┼──► Source Artifact
│  │  • priority          │    │  • aiMetadata                    │    │    (provenance, ∞:∞)
│  │  • status            │    │  • changeSummary                 │    │
│  │  • currentVersionId ─┼───►│  • approvedBy/At                 │    │
│  │  • testDataRefs[] ───┼────┼──► (see Test Data)               │    │
│  └──────────┬───────────┘    └──────────────┬───────────────────┘    │
│             │                               │                        │
│             │                               │ steps[].elementId      │
│             │                               │ validations[].elementId│
│             │                               │ (FK by stable ID)      │
│             │                               ▼                        │
│             │                  ┌──────────────────────────────────┐  │
│             │                  │  Element Repository              │  │
│             │                  │                                  │  │
│             │                  │  Element                         │  │
│             │                  │  • id (stable)                   │  │
│             │                  │  • logicalName                   │  │
│             │                  │  • pageOrComponent               │  │
│             │                  │  • locatorStrategies[] (ranked)  │  │
│             │                  │  • status                        │  │
│             │                  │  • healHistory[] [future]        │  │
│             │                  └──────────────────────────────────┘  │
│             │                                                        │
│             │ testDataRefs                                           │
│             ▼                                                        │
│  ┌──────────────────────┐                                            │
│  │  Test Data           │                                            │
│  │  • static            │                                            │
│  │  • parameterized     │                                            │
│  │  • factory [future]  │                                            │
│  └──────────────────────┘                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
              │
              │ (selected by suite membership)
              │
              ▼
┌─ COMPOSITION ────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌──────────────────────┐         ┌──────────────────────────────┐   │
│  │  Test Suite          │ 0..1───►│  Environment Profile         │   │
│  │                      │         │                              │   │
│  │  • membership        │         │  • baseUrl                   │   │
│  │    (tags + IDs)      │         │  • browser                   │   │
│  │  • executionConfig   │         │  • viewport                  │   │
│  │  • retryCount        │         │  • capabilities              │   │
│  │  • ordering          │         │                              │   │
│  └──────────┬───────────┘         └──────────────┬───────────────┘   │
│             │                                    │                   │
└─────────────┼────────────────────────────────────┼───────────────────┘
              │                                    │
              │ triggers                           │ snapshotted
              │                                    │ into each run
              ▼                                    ▼
┌─ EXECUTION ──────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌──────────────────────┐                                            │
│  │  Test Run            │                                            │
│  │                      │                                            │
│  │  • testCaseVersionId ┼───► ATC Version (PINNED, immutable ref)    │
│  │  • testCaseVersion#  │                                            │
│  │  • environmentSnapshot (frozen copy)                              │
│  │  • status            │                                            │
│  │  • stepResults[]     │                                            │
│  │    • evidence[]      │  screenshots, DOM, logs                    │
│  │    • actualValue     │                                            │
│  │    • error           │                                            │
│  │  • suiteRunId ───────┼───► Suite Run [future] (if part of suite)  │
│  └──────────┬───────────┘                                            │
│             │                                                        │
│             │ consumes (transient)                                   │
│             ▼                                                        │
│  ┌──────────────────────┐                                            │
│  │  Execution IR        │  derived from:                             │
│  │  (cached artifact)   │  ATC Version + Element Repository          │
│  │                      │                                            │
│  │  • resolvedLocators  │  (element IDs → concrete locators)         │
│  │  • renderings:       │                                            │
│  │    - cmdrunner JSON  │                                            │
│  │    - playwright code │                                            │
│  │    - [future engines]│                                            │
│  └──────────────────────┘                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘


┌─ TENANCY ROOT ───────────────────────────────────────────────────────┐
│                                                                      │
│  ┌──────────────────────┐                                            │
│  │  Project             │  1───∞  all entities below                 │
│  │  (tenancy boundary)  │                                            │
│  │                      │  Every entity has a projectId FK.          │
│  │  • name              │  No cross-project sharing in V1.           │
│  │  • tags (vocabulary) │                                            │
│  │  • createdBy         │                                            │
│  └──────────────────────┘                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Relationship Table

Every relationship in the model, with cardinality, optionality, and the invariant that governs it.

### Core Relationships

| # | From | To | Cardinality | Optional? | FK Location | Cascade Rule | Governing Invariant |
|---|------|----|-------------|-----------|-------------|--------------|---------------------|
| R1 | Project | Approved Test Case | 1 : ∞ | ATC required | `ATC.projectId` | Delete project → delete all ATCs | INV-P2 |
| R2 | Project | Element | 1 : ∞ | Element required | `Element.projectId` | Delete project → delete all elements | INV-P1, INV-P2 |
| R3 | Project | Source Artifact | 1 : ∞ | Source required | `SourceArtifact.projectId` | Delete project → delete all sources | INV-P2 |
| R4 | Project | Test Data | 1 : ∞ | Test Data required | `TestData.projectId` | Delete project → delete all data | INV-P2 |
| R5 | Project | Test Suite | 1 : ∞ | Suite required | `TestSuite.projectId` | Delete project → delete all suites | INV-P2 |
| R6 | Project | Environment Profile | 1 : ∞ | Profile required | `EnvironmentProfile.projectId` | Delete project → delete all profiles | INV-P2 |
| R7 | Project | Test Run | 1 : ∞ | Run required | `TestRun.projectId` | Delete project → delete all runs | INV-P2 |

### Approved Test Case Relationships

| # | From | To | Cardinality | Optional? | FK Location | Cascade Rule | Governing Invariant |
|---|------|----|-------------|-----------|-------------|--------------|---------------------|
| R8 | Approved Test Case | ATC Version | 1 : ∞ | At least 1 required (INV-ATC1) | `ATCVersion.testCaseId` | Delete ATC → delete all versions | INV-ATC1 |
| R9 | Approved Test Case | ATC Version (current) | 1 : 1 | Required | `ATC.currentVersionId` | — | INV-ATC1 |
| R10 | ATC Version | ATC Version (parent) | ∞ : 1 | Optional (null for v1) | `ATCVersion.parentVersionId` | — | — |
| R11 | ATC Version | Source Artifact | ∞ : ∞ | Optional | `ATCVersion.sourceArtifactIds[]` | — | INV-SA1, INV-ATCV5 |
| R12 | Approved Test Case | Test Data | ∞ : ∞ | Optional | `ATC.testDataRefs[]` | — | INV-TD1 |
| R13 | ATC Version | Element (via Step) | ∞ : ∞ | Optional per step; required for most actions | `Step.elementId` | **Delete blocked if referenced** (INV-EL3) | INV-ATCV3, INV-ATCV4, INV-EL2 |
| R14 | ATC Version | Element (via Validation) | ∞ : ∞ | Optional | `Validation.elementId` | **Delete blocked if referenced** (INV-EL3) | INV-ATCV3, INV-EL3 |

### Composition Relationships

| # | From | To | Cardinality | Optional? | FK Location | Cascade Rule | Governing Invariant |
|---|------|----|-------------|-----------|-------------|--------------|---------------------|
| R15 | Test Suite | Approved Test Case | ∞ : ∞ | Via tags or IDs | `Suite.membership.tagFilters` / `testCaseIds` | Membership resolved at run time | INV-TS1, INV-TS2 |
| R16 | Test Suite | Environment Profile | ∞ : 1 | Optional | `Suite.environmentProfileId` | — | — |
| R17 | Test Suite | Approved Test Case (exclude) | ∞ : ∞ | Optional | `Suite.membership.excludeIds[]` | Override precedence | INV-TS2 |

### Execution Relationships

| # | From | To | Cardinality | Optional? | FK Location | Cascade Rule | Governing Invariant |
|---|------|----|-------------|-----------|-------------|--------------|---------------------|
| R18 | Test Run | ATC Version | ∞ : 1 | **Required, pinned** | `TestRun.testCaseVersionId` | — | INV-TR1, X4 |
| R19 | Test Run | Approved Test Case | ∞ : 1 | Required | `TestRun.testCaseId` | — | INV-TR1 |
| R20 | Test Run | Test Suite (via Suite Run) | ∞ : 1 | Optional | `TestRun.suiteRunId` | — | — |
| R21 | Test Run | Step Result | 1 : ∞ | One per step | `StepResult.runId` | Delete run → delete results | INV-TR3 |
| R22 | Step Result | Evidence | 1 : ∞ | Optional | `Evidence.stepResultId` | Delete result → delete evidence | INV-TR4 |

### Generation Relationships

| # | From | To | Cardinality | Optional? | FK Location | Cascade Rule | Governing Invariant |
|---|------|----|-------------|-----------|-------------|--------------|---------------------|
| R23 | Execution IR | ATC Version | ∞ : 1 | Required | `ExecutionIR.testCaseVersionId` | — | INV-IR1, INV-IR3 |
| R24 | Execution IR (step) | Element | ∞ : ∞ | Through resolved locators | `IR.step.resolvedLocators` (denormalized from Element) | — | INV-IR4 |

---

## 3. Cardinality Key

```
1───1     one-to-one       (exactly one on each side)
1───∞     one-to-many      (one parent, many children)
0..1───∞  optional one-to-many (parent may not exist)
∞───∞     many-to-many     (join table or reference array)
∞───1     many-to-one      (many children, one parent)
```

---

## 4. Cascade and Delete Rules

Understanding what happens when an entity is deleted is critical for data integrity. This table is the definitive reference.

| Entity deleted | Effect on related entities | Rationale |
|----------------|---------------------------|-----------|
| **Project** | Cascade delete ALL child entities (ATCs, Elements, Sources, Data, Suites, Profiles, Runs) | INV-P2 — project is the root; deleting it removes everything |
| **Approved Test Case** | Cascade delete all Versions. **Block** if Test Runs exist referencing any version. | Runs are historical observations — they must survive even if the test case is deleted. `[future]` Soft-delete the ATC instead. |
| **ATC Version** | **Blocked** if it is the `currentVersionId` of its parent ATC. **Blocked** if any Test Run pins to it. | Versions are immutable and may be referenced by runs. |
| **Source Artifact** | **Never deleted** (INV-SA2) | Sources are retained permanently for regeneration, audit, and training. |
| **Element** | **Blocked** if any ATC Version step or validation references it (INV-EL3) | Referential integrity — orphaned steps are prevented. Element must be unreferenced before deletion. |
| **Test Data** | Allowed; sets broken references on ATCs that use it | INV-TD2 — runs will error with a clear message. |
| **Test Suite** | Cascade delete membership. Historical runs retain their snapshots. | Suites are configuration; runs are immutable observations. |
| **Environment Profile** | Allowed; historical runs retain their snapshots (INV-EP1). **Warn** if referenced by active suites. | Profiles are configuration; the snapshot in each run is frozen. |
| **Test Run** | Cascade delete Step Results and Evidence. | Runs are atomic units; deleting a run removes all its observations. |
| **Execution IR** | Deleted freely. Regenerable from ATC + Elements. | INV-IR1, INV-IR3 — derived artifact. |

---

## 5. Sub-Entity Reference Diagram

Shows how sub-entities nest within their parent entities. These are not separate tables — they are embedded structures (value objects or arrays within the parent).

```
Approved Test Case (identity)
  │
  └──► ATC Version (immutable snapshot, 1:∞ with ATC)
         │
         ├── steps[] (ordered array)
         │    │
         │    └── Step
         │         ├── elementId ──► Element (FK, by stable ID)
         │         ├── input (value or {{testData.key}} template)
         │         │
         │         └── validations[] (array)
         │              │
         │              └── Validation
         │                   ├── elementId ──► Element (FK, by stable ID)
         │                   ├── property
         │                   ├── comparison
         │                   └── expectedValue
         │
         ├── sourceArtifactIds[] ──► Source Artifact (FK array, provenance)
         │
         └── aiMetadata
              ├── confidence
              ├── reasoning
              └── modelVersion


Element
  │
  └── locatorStrategies[] (ranked array)
       │
       └── LocatorStrategy
            ├── type (role | testId | text | label | css | xpath)
            ├── value
            ├── priority
            └── confidence [future]


Test Run
  │
  ├── environmentSnapshot (frozen copy of Environment Profile)
  │
  └── stepResults[] (array, one per step in the pinned ATC version)
       │
       └── StepResult
            ├── stepId (FK to step in ATC version)
            ├── status (passed | failed | error | skipped)
            ├── actualValue / expectedValue
            ├── error
            │
            └── evidence[] (array)
                 │
                 └── Evidence
                      ├── type (screenshot | domSnapshot | log | video)
                      └── path


Execution IR (derived artifact)
  │
  └── ir.steps[] (array)
       │
       └── IRStep
            ├── action
            ├── target.resolvedLocators[] (denormalized from Element.locatorStrategies)
            │    │
            │    └── ResolvedLocator
            │         ├── type
            │         ├── value
            │         └── priority
            │
            ├── input
            └── validations[]
```

---

## 6. Relationship Notes and Design Decisions

### R11 — Source Artifact ↔ ATC Version is many-to-many

This is a deliberate departure from the "recorder → test case" linear pipeline. One source can produce multiple test case versions (a long recording split into "login flow" + "checkout flow"). One test case version can have multiple sources (a timeline plus an NL clarification the user added during review). The `sourceArtifactIds[]` array on ATC Version captures this polymorphically — no join table needed in V1.

### R13/R14 — Element references go through Steps/Validations

Elements are not directly linked to ATC Versions — they are linked through the steps and validations within those versions. This means:
- The same element can appear in multiple steps within one test case (click the Login Button, then verify the Login Button is hidden).
- An ATC Version's element usage is computed by traversing `steps[].elementId + steps[].validations[].elementId`.
- Deleting an element requires checking all versions' steps and validations, not just the ATC-level relationship.

### R18 — Test Run pins to ATC Version, not ATC

This is the most important relationship in the execution context. The FK is `testCaseVersionId`, not `testCaseId` alone. The run also denormalizes `testCaseVersionNumber` for fast display. This means:
- If the ATC is updated (new version created), existing runs still report against the version they executed.
- Comparing runs across versions is possible (run v3 vs. run v4 of the same test case).
- Historical reports are stable and interpretable.

### R23 — Execution IR references ATC Version, not ATC

Same logic as R18: the IR is generated from a specific version's steps + the current Element Repository state. If the ATC is updated, the IR must be regenerated explicitly — it does not auto-update. This is consistent with INV-IR1 (IR is always regenerable from the version + elements).

### No direct relationship: Test Run ↔ Execution IR

Test Runs and Execution IRs both reference ATC Versions, but they do not reference each other directly. This is intentional:
- The IR is a transient input to the executor — it is generated, consumed, and optionally cached.
- The Test Run captures what actually happened (observations), not what was planned (IR).
- If needed for audit, the run can reference the IR's `generatorVersion` and `generatedAt` for provenance, but the IR itself is not part of the run's persistent state.
