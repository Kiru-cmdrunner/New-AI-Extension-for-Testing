# CmdRunner Product Architecture Design v1.0

**Status:** FROZEN — Permanent Product Architecture
**Date:** 2026-07-14
**Type:** Architecture Design (no implementation, no code, no UI)
**Depends on:** Product Foundation Design v1.0 (frozen workflow)

---

## 0. Architecture Purpose

This document defines the permanent logical structure of CmdRunner. Every future milestone — Test Case Creation, Recording, Review, Playwright Generation, Repository, Interaction Engine, and future exports — must conform to this architecture without requiring redesign.

The architecture is defined in terms of **product concepts**, not implementation details. It describes *what exists*, *who owns it*, *what can change*, and *how future features fit*.

---

## 1. Product Domain Model

### 1.1 Complete Object Inventory

Every object that exists within CmdRunner:

#### Container Objects (Organizational Hierarchy)

| Object | Category | Exists Since |
|--------|----------|-------------|
| **Project** | Permanent | v1.0 |
| **Feature** | Permanent | v1.0 |
| **Scenario** | Permanent | v1.0 |

#### Core Product Objects

| Object | Category | Exists Since |
|--------|----------|-------------|
| **Test Case** | Permanent | v1.0 |
| **Test Case Metadata** | Permanent | v1.0 |
| **Recording Context** | Permanent (attached to TC) | v1.0 |
| **Interaction Timeline** | Permanent (attached to TC) | v1.0 |
| **Interaction** | Permanent (within Timeline) | v1.0 |
| **Canonical Test Steps** | Permanent (attached to TC) | v1.0 |
| **Canonical Test Step** | Permanent (within Steps) | v1.0 |
| **CmdRunner Execution JSON** | Permanent (derived from Steps) | v1.0 |
| **Generated Playwright Test** | Permanent (derived from Steps) | v1.0 |
| **Repository** | Permanent | v1.0 |

#### Transient Objects (Recording Session)

| Object | Category | Lifespan |
|--------|----------|----------|
| **Recording Session** | Temporary | Start → Stop (then discarded after generation) |
| **Active Tab** | Temporary | Bound to Recording Session |

#### Future Objects (Not in v1.0)

| Object | Category | When |
|--------|----------|------|
| **Playwright Suite** | Permanent (derived) | Post-v1.0 |
| **Playwright Project Export** | Permanent (derived) | Post-v1.0 |
| **Test Case Version** | Permanent | Post-v1.0 |
| **Generated Cypress Test** | Permanent (derived) | Post-v1.0 |
| **Screenshot Evidence** | Permanent (attached to TC) | Future |
| **AI-Generated Test Case** | Permanent | Future |
| **Test Template** | Permanent | Future |

### 1.2 Objects That Do NOT Exist (Explicitly Excluded)

| Excluded Concept | Why |
|-------------------|-----|
| **"Recording" as a first-class object** | A recording is a transient activity, not a product object. Its output (Timeline + Context) is attached to the Test Case. |
| **"Draft" as a separate object** | A Test Case in DRAFT state is still a Test Case — the state is on the TC, not a separate entity. |
| **"Step" as a standalone object** | A Canonical Test Step only exists within Canonical Test Steps. It has no identity outside its parent. |
| **"Locator" as a first-class object** | Locators are properties of a Canonical Test Step's Execution JSON. They are not independently managed. |
| **"Export" as a first-class object** | Exports (Playwright, Cypress) are derived artifacts stored as properties of the Test Case. They are not separate objects with their own lifecycle. |

---

## 2. Object Hierarchy

### 2.1 Full Containment Hierarchy

```
Repository
  └── Project (1..*)
        ├── Metadata: name, description, created date
        └── Feature (1..*)
              ├── Metadata: name, description, created date
              └── Scenario (1..*)
                    ├── Metadata: name, description, created date
                    └── Test Case (1..*)
                          │
                          ├── Test Case Metadata
                          │     ├── name *
                          │     ├── expectedResult
                          │     ├── status (DRAFT → ... → SAVED)
                          │     ├── createdAt
                          │     ├── approvedAt
                          │     ├── approvedBy
                          │     └── tags
                          │
                          ├── Recording Context
                          │     ├── startUrl
                          │     ├── startTitle
                          │     └── capturedAt
                          │
                          ├── Interaction Timeline
                          │     └── Interaction (1..*)
                          │           ├── interactionId (click-0001, nav-0001, ...)
                          │           ├── interactionType
                          │           ├── timestamp
                          │           ├── elementIdentity (if applicable)
                          │           └── aiEnrichment (if applicable)
                          │
                          ├── Canonical Test Steps
                          │     └── Canonical Test Step (1..*)
                          │           ├── stepNumber
                          │           ├── actionType
                          │           ├── plainEnglish
                          │           ├── elementIdentity
                          │           ├── executionJson
                          │           ├── aiEnrichment
                          │           └── linkedInteractionId
                          │
                          ├── CmdRunner Execution JSON
                          │     └── [Derived from Canonical Test Steps]
                          │
                          ├── Generated Playwright Test
                          │     ├── testCode (string)
                          │     ├── isManualEdit (bool)
                          │     └── generatedAt
                          │
                          └── Screenshots / Evidence (Future)
                                └── Screenshot (1..*)
                                      ├── screenshotId
                                      ├── linkedInteractionId
                                      └── dataUrl
```

### 2.2 Relationship Cardinalities

```
Repository ──contains──> Project (1:N)
Project    ──contains──> Feature (1:N)
Feature    ──contains──> Scenario (1:N)
Scenario   ──contains──> Test Case (1:N)

Test Case  ──has one──>  Test Case Metadata (1:1)
Test Case  ──has one──>  Recording Context (1:1)
Test Case  ──has one──>  Interaction Timeline (1:1)
Test Case  ──has one──>  Canonical Test Steps (1:1)
Test Case  ──has one──>  CmdRunner Execution JSON (1:1)
Test Case  ──has one──>  Generated Playwright Test (1:1)

Interaction Timeline ──contains──> Interaction (1:N)
Canonical Test Steps ──contains──> Canonical Test Step (1:N)

Canonical Test Step ──links to──> Interaction (N:1, via linkedInteractionId)
```

### 2.3 Key Relationship Rules

| Rule | Description |
|------|-------------|
| **Test Case is the aggregation root** | Everything attaches to a Test Case. No artifact exists outside a Test Case. |
| **Containment is strict** | A Feature belongs to exactly one Project. A Scenario belongs to exactly one Feature. A Test Case belongs to exactly one Scenario. No shared children. |
| **Derivation is one-directional** | Execution JSON derives from Steps. Playwright derives from Steps. Steps never derive from Playwright. |
| **Linkage is referential** | A Canonical Test Step links to its source Interaction via `linkedInteractionId`. Deleting the interaction marks the step for deletion review, but does not silently destroy the step. |

---

## 3. Object Responsibilities

### 3.1 Project

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Top-level organizational boundary. Represents an application, product, or system under test. |
| **Owns** | Name, description, creation date, list of Features. |
| **Must never own** | Test Cases directly. Recording data. Execution details. |
| **Depends on** | Repository (parent container). |
| **Single responsibility** | Group related Features under one product boundary. |

### 3.2 Feature

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Functional area within a Project. Groups related user workflows. |
| **Owns** | Name, description, creation date, list of Scenarios. |
| **Must never own** | Test Cases directly. Projects. Cross-project references. |
| **Depends on** | Project (parent). |
| **Single responsibility** | Partition a Project's test surface into functional areas. |

### 3.3 Scenario

| Aspect | Detail |
|--------|--------|
| **Why it exists** | A specific user workflow or test area within a Feature. Groups Test Cases that share a common context (e.g., "Flight Booking" scenario groups all flight booking test cases). |
| **Owns** | Name, description, creation date, list of Test Cases. |
| **Must never own** | Features. Projects. Test Case content (steps, code). |
| **Depends on** | Feature (parent). |
| **Single responsibility** | Group Test Cases by shared workflow context. |

### 3.4 Test Case

| Aspect | Detail |
|--------|--------|
| **Why it exists** | The atomic unit of the product. A single, complete, approved test that can be executed independently. |
| **Owns** | All artifacts: Metadata, Recording Context, Interaction Timeline, Canonical Test Steps, Execution JSON, Generated Playwright Test. |
| **Must never own** | Other Test Cases. Repository structure. Suite configuration. |
| **Depends on** | Scenario (parent). Canonical Test Steps (internal source of truth). |
| **Single responsibility** | Be a self-contained, executable, reviewable test unit. |

**This is the most important object in the architecture.** Everything else either contains Test Cases, is contained by a Test Case, or is derived from a Test Case.

### 3.5 Test Case Metadata

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Identity and classification information for the Test Case. |
| **Owns** | Name, expectedResult, status, createdAt, approvedAt, approvedBy, tags. |
| **Must never own** | Recording data. Steps. Code. |
| **Depends on** | Test Case (parent). |
| **Single responsibility** | Answer "what is this test, who created it, and what is its lifecycle state?" |

### 3.6 Recording Context

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Establishes the starting point of the recording. Without it, the first navigation appears to be the origin. |
| **Owns** | startUrl, startTitle, capturedAt. |
| **Must never own** | Interactions. Steps. Anything that happened after Start. |
| **Depends on** | Test Case (parent). |
| **Single responsibility** | Answer "where and when did this recording begin?" |

### 3.7 Interaction Timeline

| Aspect | Detail |
|--------|--------|
| **Why it exists** | The chronological record of what the user actually did. It is the raw input from which Canonical Test Steps are generated. |
| **Owns** | Ordered list of Interactions. |
| **Must never own** | Plain English descriptions (those belong to Steps). Execution JSON. Playwright code. |
| **Depends on** | Test Case (parent). Recording Context (preceding metadata). |
| **Single responsibility** | Be the authoritative record of what interactions occurred, in what order. |

### 3.8 Interaction

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Represents one captured user action during recording. |
| **Owns** | interactionId, interactionType, timestamp, elementIdentity, aiEnrichment. |
| **Must never own** | Step numbers. Plain English text. Execution logic. Playwright code. |
| **Depends on** | Interaction Timeline (parent, defines order). |
| **Single responsibility** | Be the factual record of a single user action. |

### 3.9 Canonical Test Steps

| Aspect | Detail |
|--------|--------|
| **Why it exists** | The interpreted, structured representation of the recording. Transforms raw interactions into executable, human-readable test instructions. |
| **Owns** | Ordered list of Canonical Test Steps. |
| **Must never own** | Raw interaction data (that's the Timeline's job). Playwright code. Repository structure. |
| **Depends on** | Test Case (parent). Interaction Timeline (source input). |
| **Single responsibility** | Be the single source of truth for what the test does. |

### 3.10 Canonical Test Step

| Aspect | Detail |
|--------|--------|
| **Why it exists** | One executable instruction within the test. Combines factual interaction data with human-readable description and machine-readable execution data. |
| **Owns** | stepNumber, actionType, plainEnglish, elementIdentity, executionJson, aiEnrichment, linkedInteractionId. |
| **Must never own** | Other steps. Timeline ordering. Playwright code generation logic. |
| **Depends on** | Canonical Test Steps (parent, defines order). Interaction (source, via linkedInteractionId). |
| **Single responsibility** | Be one complete, self-contained, executable test instruction. |

### 3.11 CmdRunner Execution JSON

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Machine-readable representation of the test steps. Enables code generation, playback engines, and automated analysis without parsing plain English. |
| **Owns** | Structured execution data per step (action, target, value, locator strategy, wait strategy). |
| **Must never own** | Plain English text. Playwright-specific syntax. Timeline data. |
| **Depends on** | Canonical Test Steps (source). |
| **Single responsibility** | Be the framework-agnostic execution model derived from canonical steps. |

### 3.12 Generated Playwright Test

| Aspect | Detail |
|--------|--------|
| **Why it exists** | A runnable TypeScript Playwright test file derived from the canonical steps. The primary export format for v1.0. |
| **Owns** | testCode (string), isManualEdit (bool), generatedAt. |
| **Must never own** | Canonical step definitions. Other export formats. Execution JSON. |
| **Depends on** | Canonical Test Steps (source). |
| **Single responsibility** | Be a runnable Playwright test that accurately reflects the canonical steps. |

### 3.13 Repository

| Aspect | Detail |
|--------|--------|
| **Why it exists** | The permanent, authoritative store of all approved Test Cases. |
| **Owns** | The complete Project → Feature → Scenario → Test Case hierarchy. |
| **Must never own** | Recording sessions. Live state. Transient data. |
| **Depends on** | Nothing (it is the root). |
| **Single responsibility** | Be the permanent source of truth for all approved Test Cases and their hierarchy. |

### 3.14 Recording Session (Transient)

| Aspect | Detail |
|--------|--------|
| **Why it exists** | Manages the active recording process. Coordinates content scripts, service worker, and side panel during recording. |
| **Owns** | Recording state (active/stopped), active tab reference, live event buffer. |
| **Must never own** | Test Case artifacts. Repository data. Approved content. |
| **Depends on** | Test Case (the TC it is recording for). |
| **Single responsibility** | Orchestrate the recording process and produce the Interaction Timeline + Recording Context. |
| **Lifespan** | Start Recording → Stop Recording. After Stop, its output is attached to the Test Case and the session is discarded. |

---

## 4. Lifecycle of Every Major Object

### 4.1 Test Case Lifecycle

```
DRAFT
  │  Test Case created. Metadata entered.
  │  No recording yet.
  │
  ▼
RECORDING
  │  Recording Session active.
  │  Interactions being captured into Timeline.
  │  Recording Context captured at Start.
  │
  ▼
RECORDED
  │  Recording stopped.
  │  Interaction Timeline is complete.
  │  No steps generated yet.
  │
  ▼
GENERATED
  │  System generates Canonical Test Steps from Timeline.
  │  System generates Execution JSON from Steps.
  │  System generates Playwright Test from Steps.
  │  All three artifacts exist.
  │
  ▼
UNDER_REVIEW
  │  User reviews Timeline, Steps, and Playwright Test.
  │  User can edit steps, delete interactions, modify code.
  │  Artifacts may change.
  │
  ▼
APPROVED
  │  User clicks "Approve Test Case".
  │  All artifacts frozen.
  │  No further edits possible.
  │
  ▼
SAVED
  │  Test Case persisted to Repository.
  │  Immutable. Complete. Self-contained.
  │  Ready for export, suite generation, playback.
```

### 4.2 Recording Session Lifecycle

```
IDLE
  │
  ▼
ACTIVE (Start Recording pressed)
  │  Content scripts listening.
  │  Interactions flowing into Timeline.
  │  Recording Context captured.
  │
  ▼
STOPPED (Stop Recording pressed)
  │  Timeline finalized.
  │  Session output attached to Test Case.
  │
  ▼
DISCARDED
  │  Session object destroyed.
  │  All data lives on the Test Case.
```

### 4.3 Interaction Lifecycle

```
CAPTURED
  │  Content script detects user action.
  │  Identity extracted. Message sent to service worker.
  │
  ▼
RECORDED
  │  Added to Interaction Timeline.
  │  Screenshot captured.
  │  AI enrichment applied (if configured).
  │
  ▼
LINKED
  │  Canonical Test Step generated from this interaction.
  │  Step's linkedInteractionId points back here.
  │
  ▼
FROZEN (on Test Case approval)
  │  Interaction is now permanent record.
  │
  ▼
— or —
  │
  ▼
DELETED (during Review)
  │  User removes false positive.
  │  Linked Canonical Test Step also removed.
  │  Interaction removed from Timeline.
```

### 4.4 Canonical Test Step Lifecycle

```
GENERATED
  │  Created from an Interaction during post-Stop generation.
  │
  ▼
EDITED (during Review)
  │  Plain English modified by user.
  │  Execution JSON may regenerate.
  │
  ▼
FROZEN (on Test Case approval)
  │  Step is now permanent.
  │  Becomes part of the canonical source of truth.
```

### 4.5 Generated Playwright Test Lifecycle

```
GENERATED
  │  Created from Canonical Test Steps during post-Stop generation.
  │
  ▼
AUTO_REGENERATED
  │  Canonical Steps changed (user edited/deleted).
  │  Playwright test regenerated automatically
  │  (only if user has NOT manually edited it).
  │
  ▼
— or —
  │
  ▼
MANUALLY_EDITED
  │  User modified the Playwright code directly.
  │  isManualEdit = true.
  │  Future step changes prompt: "Regenerate? This overwrites edits."
  │
  ▼
FROZEN (on Test Case approval)
  │  Code is now permanent.
```

### 4.6 Project / Feature / Scenario Lifecycle

```
CREATED
  │  User creates via inline form or cascading dropdown.
  │
  ▼
ACTIVE
  │  Contains children (Features / Scenarios / Test Cases).
  │  Name and description can be edited.
  │
  ▼
— no state machine —
  │  These are simple containers. They don't have a workflow.
  │  They exist as long as they have children or the user wants them.
  │
  ▼
DELETED
  │  User deletes. Cascade: deleting a Project deletes all Features,
  │  Scenarios, and Test Cases within it.
```

---

## 5. Ownership Model

### 5.1 The Ownership Rule

**Every object has exactly one owner.** The owner is responsible for the object's lifecycle, storage, and access. No object is shared between two parents.

### 5.2 Ownership Map

```
Repository
  └─ owns → Projects

Project
  └─ owns → Features

Feature
  └─ owns → Scenarios

Scenario
  └─ owns → Test Cases

Test Case
  ├─ owns → Test Case Metadata
  ├─ owns → Recording Context
  ├─ owns → Interaction Timeline
  │    └─ owns → Interactions
  ├─ owns → Canonical Test Steps
  │    └─ owns → Canonical Test Steps (individual)
  ├─ owns → CmdRunner Execution JSON
  ├─ owns → Generated Playwright Test
  └─ owns → Screenshots (future)
```

### 5.3 Who Owns Each Key Artifact?

| Artifact | Owner | Why |
|----------|-------|-----|
| Recording Context | Test Case | It's metadata about the test, not about the recording session (which is transient). |
| Interaction Timeline | Test Case | The timeline becomes part of the permanent record once approved. The Recording Session only produces it — it doesn't own it. |
| Canonical Test Steps | Test Case | Steps are the core content of the Test Case. |
| Execution JSON | Test Case | Derived from Steps, stored alongside them. |
| Generated Playwright Test | Test Case | Derived from Steps, stored alongside them. |
| Screenshots | Test Case | Evidence attached to the test. |

### 5.4 What the Recording Session Does NOT Own

The Recording Session is a **producer**, not an **owner**. It:
- Produces the Interaction Timeline → hands it to the Test Case.
- Produces the Recording Context → hands it to the Test Case.
- Does NOT own either after Stop.

After Stop Recording, the Recording Session ceases to exist. All its output lives on the Test Case.

---

## 6. Mutable vs Immutable Rules

### 6.1 The Mutability Principle

**Objects are mutable during their active lifecycle and immutable after freezing.** The freezing point for Test Case artifacts is **approval**.

### 6.2 Mutability Table

| Object | Mutable Before Approval | Immutable After Approval | Notes |
|--------|------------------------|-------------------------|-------|
| **Project Name** | ✅ | ✅ (always editable) | Container names are always editable — renaming a Project doesn't affect Test Case content. |
| **Feature Name** | ✅ | ✅ (always editable) | Same as Project. |
| **Scenario Name** | ✅ | ✅ (always editable) | Same as Project. |
| **Test Case Name** | ✅ | ⚠️ (editable, creates new version in future) | Name is metadata, not content. Always editable but tracked. |
| **Expected Result** | ✅ | ❌ Frozen | Content artifact. |
| **Recording Context** | ❌ Always immutable | ❌ | Factual metadata captured at recording time. Never changes. |
| **Interaction Timeline** | Delete only | ❌ Frozen | Can remove false positives during review. Cannot add or reorder. |
| **Canonical Test Steps** | ✅ Edit plain English, delete | ❌ Frozen | The core editable artifact during review. |
| **Execution JSON** | Auto-regenerates | ❌ Frozen | Always derived from Steps. No manual editing. |
| **Generated Playwright Test** | ✅ Full code editing | ❌ Frozen | User can edit code directly. Regenerates if Steps change and code not manually edited. |
| **Screenshots** | ❌ Always immutable | ❌ | Visual evidence. Cannot be altered. |
| **Tags** | ✅ | ✅ (always editable) | Classification metadata. |
| **Status** | ✅ (state transitions) | ❌ (final state: SAVED) | Workflow state. |

### 6.3 Regeneration Rules

| Trigger | What Regenerates | Condition |
|---------|-----------------|-----------|
| User deletes an Interaction from Timeline | Corresponding Canonical Test Step removed | Always |
| User edits plain English on a Step | Nothing regenerates | Plain English is a human layer, doesn't affect execution |
| Canonical Test Step removed or changed | Execution JSON regenerates | Always — JSON is always derived |
| Canonical Test Step removed or changed | Playwright Test regenerates | **Only if** `isManualEdit === false`. If user manually edited the Playwright code, prompt before overwriting. |
| User edits Playwright Test directly | Nothing regenerates | `isManualEdit` set to `true`. Canonical steps remain source of truth. |

### 6.4 What Can NEVER Change (Hard Immutable)

| Item | Why |
|------|-----|
| Recording Context (startUrl, startTitle, capturedAt) | Factual record of where recording began |
| Interaction chronological order | Time only flows forward |
| Element Identity (tag, role, accessibleName, locators) | Extracted from DOM — factual data |
| Screenshots | Visual evidence |
| AI enrichment timestamps | Audit trail |

---

## 7. Source of Truth Model

### 7.1 The Authority Chain

```
                     INTERACTION TIMELINE
                     (factual record of what happened)
                              │
                              │ derived from
                              ▼
                     CANONICAL TEST STEPS
                     (interpreted test instructions)
                              │
                    ┌─────────┴──────────┐
                    │                    │
                    │ derived from       │ derived from
                    ▼                    ▼
          EXECUTION JSON         GENERATED PLAYWRIGHT TEST
          (machine model)        (TypeScript code)
                                     │
                                     │ future derived from
                                     ├──→ CYPRESS TEST (future)
                                     ├──→ SELENIUM TEST (future)
                                     └──→ CUCUMBER FEATURE (future)
```

### 7.2 Source of Truth Rules

| Artifact | Is Source of Truth For | Derives From |
|----------|----------------------|--------------|
| **Interaction Timeline** | What interactions occurred and in what order | Nothing (it is raw captured data) |
| **Canonical Test Steps** | What the test does (semantics + execution) | Interaction Timeline |
| **Execution JSON** | Machine-readable execution model | Canonical Test Steps |
| **Generated Playwright Test** | Playwright-specific executable code | Canonical Test Steps |
| **Repository** | All approved Test Cases (permanent store) | Nothing (it IS the store) |

### 7.3 Conflict Resolution

If the Playwright Test (manually edited) conflicts with the Canonical Test Steps:

1. **Canonical Test Steps always win as the source of truth.**
2. The manual Playwright edit is preserved as an override.
3. The system flags the conflict: "Playwright test has manual edits that differ from canonical steps."
4. The user can choose to regenerate (discard manual edits) or keep the override.
5. In the Repository, both the canonical steps and the overridden Playwright test are stored. The canonical steps are authoritative.

### 7.4 Repository Authority

The Repository is the **permanent** source of truth. Once a Test Case is SAVED:

- The Repository version is canonical.
- Any working copy in the side panel is transient.
- Re-exporting (Playwright, future formats) always reads from the Repository.
- Regenerating a Playwright test from a saved Test Case reads the canonical steps from the Repository — not from a previous Playwright export.

---

## 8. Product Boundaries

### 8.1 Three Boundary Zones

```
┌─────────────────────────────────────────────────────────┐
│                    FUTURE ZONE                           │
│  Objects that don't exist yet but the architecture       │
│  must support without redesign.                          │
│                                                          │
│  • Playwright Suite                                     │
│  • Playwright Project Export                            │
│  • Cypress / Selenium / Cucumber Exports                │
│  • Test Case Versions                                   │
│  • AI-Generated Test Cases                              │
│  • Negative / Boundary / Accessibility Tests            │
│  • API Tests / Mobile Tests                             │
│  • Collaboration / Sharing                              │
│  • Test Templates                                       │
│  • CI/CD Integration                                    │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ extends into
                          │
┌─────────────────────────────────────────────────────────┐
│                   PERMANENT ZONE                         │
│  Objects that are saved, approved, and immutable.        │
│  They live in the Repository.                            │
│                                                          │
│  • Repository                                           │
│  • Project / Feature / Scenario                         │
│  • Test Case (all artifacts)                            │
│  • Recording Context                                    │
│  • Interaction Timeline                                 │
│  • Canonical Test Steps                                 │
│  • Execution JSON                                       │
│  • Generated Playwright Test                            │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │ produces into
                          │
┌─────────────────────────────────────────────────────────┐
│                   TRANSIENT ZONE                         │
│  Objects that exist only during active use.              │
│  They are discarded after producing permanent output.    │
│                                                          │
│  • Recording Session                                    │
│  • Active Tab reference                                 │
│  • Live event buffer                                    │
│  • Side panel working state                             │
│  • Unreviewed draft artifacts                           │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Boundary Crossing Rules

| From | To | Rule |
|------|-----|------|
| Transient → Permanent | Recording Session produces Timeline + Context → Test Case | **One-way.** Data flows from transient to permanent at Stop Recording. Permanent never flows back. |
| Permanent → Transient | Repository Test Case → Side panel for viewing | **Read-only copy.** The side panel gets a snapshot, never the original. |
| Permanent → Future | Test Case → Playwright Suite | **Derivation.** Suite is derived from multiple Test Cases in the Repository. |
| Transient → Transient | Content script → Service worker → Side panel | **Live flow.** Real-time during recording. Discarded after Stop. |

### 8.3 What Stays in Each Zone

**Transient objects never enter the Repository:**
- Recording Session state
- Unapproved drafts
- Live event buffers
- Side panel UI state

**Permanent objects never depend on transient state:**
- A saved Test Case is fully self-contained
- Re-opening a saved Test Case does not require a Recording Session
- Repository operations (search, browse, export) never touch transient state

---

## 9. Extensibility Model

### 9.1 How Future Capabilities Fit Without Redesign

#### New Interaction Types (Text Entry, Dropdown, Checkbox, etc.)

```
                    EXISTING ARCHITECTURE
                    ┌─────────────────────────────────┐
                    │  Content Script (new type)      │
                    │  ↓                               │
NEW INTERACTION  →  │  Interaction Timeline           │  (no change)
                    │  ↓                               │
                    │  Canonical Test Steps           │  (no change)
                    │  ↓                               │
                    │  Execution JSON                 │  (no change)
                    │  ↓                               │
                    │  Generated Playwright Test      │  (new action type)
                    └─────────────────────────────────┘
```

**Fit:** A new interaction type adds one content script + one registry config. It produces Interactions that enter the same Timeline. The Timeline produces Steps through the same pipeline. Steps produce the same Execution JSON (with a new actionType). The Playwright generator maps the new actionType to Playwright syntax. **Zero architectural change.**

#### New Export Formats (Cypress, Selenium, Cucumber)

```
                    CANONICAL TEST STEPS (source of truth)
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                    ▼         ▼         ▼
              PLAYWRIGHT   CYPRESS   SELENIUM
              (v1.0)      (future)  (future)
```

**Fit:** Each export format is a new generator that reads Canonical Test Steps and produces its own output. The Test Case gains a new property (e.g., `generatedCypressTest`). No existing artifact changes. **Additive only.**

#### Playwright Suite Generation

```
PROJECT
  ├── Test Case A (has Generated Playwright Test)
  ├── Test Case B (has Generated Playwright Test)
  └── Test Case C (has Generated Playwright Test)
         │
         ▼
    SUITE GENERATOR
    (reads all approved TCs in Project)
         │
         ▼
    PLAYWRIGHT SUITE
    (combined test file with shared setup)
```

**Fit:** Suite generation is a **read operation** on the Repository. It reads multiple Test Cases, combines their Playwright Tests, adds shared setup/teardown. Produces a new derived artifact at the Project level. **No change to Test Case architecture.**

#### Test Case Versioning

```
TEST CASE
  ├── Version 1 (original approved)
  ├── Version 2 (re-recorded after app update)
  └── Version 3 (re-recorded after locator change)
```

**Fit:** Versioning adds a version array to the Test Case. Each version is a complete snapshot of all artifacts at approval time. The latest version is canonical. **The Test Case object gains a dimension; no structural change.**

#### AI-Generated Test Cases

```
AI PROMPT: "Generate test cases for the login feature"
         │
         ▼
    AI TEST GENERATOR
         │
         ▼
    TEST CASE (DRAFT, no recording)
    ├── Metadata (AI-generated name, expected result)
    ├── Canonical Test Steps (AI-generated)
    ├── Execution JSON (derived)
    └── Generated Playwright Test (derived)
```

**Fit:** AI-generated Test Cases skip the Recording phase but still produce Canonical Test Steps. They enter the same pipeline at the GENERATED state. The Test Case doesn't care whether its steps came from recording or AI — it only cares that canonical steps exist. **Same architecture, different entry point.**

#### Negative / Boundary Test Generation

```
EXISTING TEST CASE
  ├── Canonical Step: "Enter 'john@example.com' in email field"
         │
         ▼
    VARIANT GENERATOR
         │
         ▼
    NEW TEST CASE: "Enter empty string in email field"
    NEW TEST CASE: "Enter SQL injection in email field"
    NEW TEST CASE: "Enter 10,000 characters in email field"
```

**Fit:** Variant generation reads an existing Test Case's canonical steps, modifies input values, and creates new Test Cases. Each variant is a full Test Case in the Repository. **Derived from existing Test Cases; no architectural change.**

#### API Tests

```
TEST CASE (API variant)
  ├── Metadata (type: "api")
  ├── No Recording Context (not browser-based)
  ├── No Interaction Timeline (no recording)
  ├── Canonical Test Steps (API actions: GET, POST, assertions)
  ├── Execution JSON (API execution model)
  └── Generated Playwright Test (API test, not browser test)
```

**Fit:** API Test Cases skip Recording Context and Interaction Timeline but still have Canonical Test Steps and Execution JSON. The Test Case object already allows optional artifacts. **The architecture accommodates non-browser tests without change.**

#### Collaboration / Sharing

```
REPOSITORY
  └── Project
        └── Feature
              └── Scenario
                    └── Test Case
                          └── Metadata
                                ├── createdBy (existing)
                                ├── approvedBy (existing)
                                ├── sharedWith (new: user list)
                                └── lockState (new: editing lock)
```

**Fit:** Collaboration adds user references and locking metadata to existing objects. The hierarchy doesn't change. **Metadata extension only.**

---

## 10. Product Architecture Principles

### PA1 — Test Case Centricity

The Test Case is the atomic unit of the product. Every object either contains Test Cases, is contained by a Test Case, or is derived from a Test Case. No feature exists outside the Test Case context.

### PA2 — Single Responsibility

Every object has exactly one responsibility. An object that manages recording should not also manage storage. An object that stores Playwright code should not also generate it.

### PA3 — Single Ownership

Every object has exactly one owner. Ownership determines lifecycle, storage, and access. No object is orphaned; no object has two parents.

### PA4 — Canonical Source of Truth

Canonical Test Steps + Execution JSON is the single source of truth for test semantics. All export formats derive from it. The Repository holds the canonical version. No export format feeds back into the canonical representation.

### PA5 — Derivation Is One-Way

Data flows from raw (Timeline) → interpreted (Steps) → machine model (Execution JSON) → executable code (Playwright). Derivation never flows backward. Editing a derived artifact is an override, not a source of truth change.

### PA6 — Transient ≠ Permanent

Recording Session and its live state are transient. They produce output that becomes permanent on the Test Case. Transient state never enters the Repository. Permanent state never depends on transient state.

### PA7 — Approval Is the Freeze Point

All Test Case artifacts are mutable during review and immutable after approval. Approval is the single moment when a Test Case transitions from draft to permanent. No unapproved data enters the Repository.

### PA8 — Framework Agnosticism

The canonical representation (Steps + Execution JSON) knows nothing about Playwright, Cypress, or Selenium. Export formats are consumers of the canonical model. New export formats are added as new consumers, not as changes to the model.

### PA9 — Additive Extensibility

New capabilities extend the architecture without modifying existing objects. New interaction types add content scripts. New export formats add generators. New test types (API, mobile) add entry points. The core architecture remains unchanged.

### PA10 — Minimal Coupling

Objects communicate through well-defined boundaries. A content script does not know about the Repository. The Playwright generator does not know about content scripts. Coupling is minimized through the pipeline: each stage reads from the previous stage's output and produces its own output.

### PA11 — Repository Authority

The Repository is the permanent, authoritative store. All operations on approved Test Cases read from and write to the Repository. Working copies are transient snapshots. The Repository version is always canonical.

### PA12 — Containment Hierarchy

The Repository follows a strict containment hierarchy: Project → Feature → Scenario → Test Case. Children cannot exist without parents. Deleting a parent cascades to all children. No circular references. No cross-hierarchy links.

---

## 11. Suggested Implementation Roadmap

This roadmap maps the Product Foundation Design milestones (A–F) onto this architecture, identifying which objects and relationships each milestone establishes.

### Milestone A — Test Case Creation Flow

**Architectural impact:**
- Establishes: Test Case Metadata (DRAFT state), Project, Feature, Scenario as first-class objects
- Creates relationship: Scenario → Test Case (containment)
- Key principle: PA1 (Test Case Centricity)

**What becomes real:**
- A Test Case exists in DRAFT state before recording
- Project/Feature/Scenario hierarchy is chosen upfront
- Metadata (name, expected result) is captured before recording

---

### Milestone B — Post-Stop Generation Pipeline

**Architectural impact:**
- Establishes: Recording Session (transient) → Test Case (permanent) boundary
- Creates relationship: Recording Session produces Interaction Timeline + Recording Context → Test Case owns them
- Transitions Test Case through: RECORDING → RECORDED → GENERATED
- Key principle: PA6 (Transient ≠ Permanent)

**What becomes real:**
- Recording Session is explicitly transient
- Timeline and Context are produced by the session and attached to the Test Case
- Canonical Test Steps generated from Timeline after Stop (not during recording)

---

### Milestone C — Playwright Test Generation

**Architectural impact:**
- Establishes: Canonical Test Steps → Generated Playwright Test derivation
- Creates: Playwright generator (reads Steps, produces code)
- Key principle: PA5 (Derivation Is One-Way)

**What becomes real:**
- Generated Playwright Test is a property of the Test Case
- Derivation flows from Steps → Playwright, never backward
- One test() per Test Case

---

### Milestone D — Review & Edit Workflow

**Architectural impact:**
- Establishes: UNDER_REVIEW state, mutability rules, regeneration logic
- Creates: Edit operations on Steps (plain English, delete) and Playwright (code editing)
- Key principle: PA7 (Approval Is the Freeze Point — approached but not yet crossed)

**What becomes real:**
- User can delete Interactions from Timeline (removes linked Steps)
- User can edit plain English on Steps
- User can edit Playwright code directly
- Regeneration logic: Steps change → JSON regenerates → Playwright regenerates (if not manually edited)

---

### Milestone E — Approval & Save

**Architectural impact:**
- Establishes: APPROVED → SAVED transition, immutability, Repository storage
- Creates: Complete Test Case object persisted to Repository
- Key principles: PA7 (Freeze Point), PA11 (Repository Authority)

**What becomes real:**
- All artifacts frozen
- Test Case saved with all artifacts to Repository
- Repository is the permanent source of truth

---

### Milestone F — Repository Enhancement

**Architectural impact:**
- Establishes: Repository as a browsable, searchable permanent store
- Creates: Read operations on the hierarchy
- Key principle: PA12 (Containment Hierarchy)

**What becomes real:**
- Tree view of Project → Feature → Scenario → Test Case
- View complete Test Case (all artifacts, read-only)
- Search across the hierarchy

---

### Post-Foundation: Interaction Engine

**Architectural impact:**
- Validates: PA9 (Additive Extensibility)
- Each interaction type adds: 1 content script + 1 registry config
- No changes to: Timeline, Steps, Execution JSON, Playwright generator architecture
- Only the Playwright generator gains new actionType → code mappings

---

### Future: Suite Generation & Export

**Architectural impact:**
- Establishes: Playwright Suite as a Project-level derived object
- Validates: PA8 (Framework Agnosticism), PA5 (One-Way Derivation)
- Suite reads Test Cases from Repository → produces combined output
- Export reads Test Cases → produces downloadable project

---

## 12. Freeze Declaration

The following architectural decisions are declared **frozen** and must not be redesigned:

| # | Decision |
|---|----------|
| 1 | Test Case is the atomic unit of the product |
| 2 | Project → Feature → Scenario → Test Case containment hierarchy |
| 3 | Recording Session is transient; its output attaches to the Test Case |
| 4 | Recording Context is immutable metadata captured at Start |
| 5 | Interaction Timeline is the raw factual record |
| 6 | Canonical Test Steps is the single source of truth |
| 7 | Execution JSON is always derived from Steps |
| 8 | Generated Playwright Test is always derived from Steps |
| 9 | All export formats derive from Canonical Test Steps |
| 10 | Derivation is one-way (never backward) |
| 11 | Approval is the freeze point for all artifacts |
| 12 | Only approved Test Cases enter the Repository |
| 13 | Repository is the permanent, authoritative store |
| 14 | Every object has one responsibility and one owner |
| 15 | New interaction types extend without architectural change |
| 16 | New export formats extend without canonical model change |
| 17 | The architecture is framework-agnostic |

---

*This document defines the permanent CmdRunner Product Architecture. All future milestones — implementation, interactions, exports, integrations — must conform to this architecture.*
