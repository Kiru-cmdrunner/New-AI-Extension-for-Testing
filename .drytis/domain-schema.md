# Domain Schema — Canonical Entity Model

**Status:** Foundation blueprint — canonical reference for the platform
**Date:** 2026-07-20
**Scope:** Defines the nine core entities of the CmdRunner AI testing platform, their relationships, invariants, lifecycle, versioning, and ownership. All implementation must conform to this document.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Entity Overview](#2-entity-overview)
3. [Entity Definitions](#3-entity-definitions)
   - [3.1 Project](#31-project)
   - [3.2 Approved Test Case](#32-approved-test-case)
   - [3.3 Source Artifact](#33-source-artifact)
   - [3.4 Element Repository](#34-element-repository)
   - [3.5 Test Data](#35-test-data)
   - [3.6 Test Suite](#36-test-suite)
   - [3.7 Environment Profile](#37-environment-profile)
   - [3.8 Test Run](#38-test-run)
   - [3.9 Execution IR](#39-execution-ir)
4. [Cross-Entity Invariants](#4-cross-entity-invariants)
5. [Ownership Model](#5-ownership-model)
6. [Versioning Strategy Summary](#6-versioning-strategy-summary)

---

## 1. Design Principles

These principles govern every entity definition below. If a field, relationship, or lifecycle transition contradicts a principle, the principle wins.

| ID | Principle | What it means |
|----|-----------|---------------|
| DP1 | **Intent over execution** | The repository stores *what the business wants to verify*, not *how the UI implements it today*. Selectors, execution details, and engine-specific code are derived artifacts — never the source of truth. |
| DP2 | **Separation of definition and observation** | A test definition (what should happen) is a different object from a test run (what did happen). Evidence, screenshots, pass/fail, and logs belong to runs — never to definitions. |
| DP3 | **Provenance over discard** | Source inputs (recordings, NL descriptions, screenshots) are retained immutably. If AI interpretation improves, test cases can be regenerated from original sources without asking the user to re-record. |
| DP4 | **Logical elements are first-class** | Steps reference elements by stable ID, not by selector or by name. One element definition serves all test cases that use it. Healing a locator updates the element — every consumer benefits. |
| DP5 | **Execution IR is derived, never authoritative** | The execution representation is a build artifact — regenerable from (Approved Test Case version + Element Repository state). It may be cached for performance and audit, but it is never hand-edited and never treated as the source of truth. |
| DP6 | **Minimal V1, architected for growth** | V1 implements the minimum viable surface for each entity. Fields marked `[future]` exist in the schema to avoid migrations later but are not populated or used in V1 logic. |

---

## 2. Entity Overview

Nine core entities, organized by the context that owns them as system of record:

```
┌─ AUTHORING ──────────────────────────────────────────────┐
│                                                          │
│  Source Artifact (3.3)                                   │
│  ├─ Interaction Timeline (recorder output)               │
│  ├─ Natural Language Description                         │
│  ├─ Image / Screenshot                                   │
│  ├─ Imported Document                                    │
│  └─ Manual                                               │
│                                                          │
│  [AI Workflow Review — process, not entity]              │
│  Source Artifact(s) ──► AI interprets ──► ATC Version    │
│                                                          │
└──────────────────────────┬───────────────────────────────┘
                           │ produces
                           ▼
┌─ REPOSITORY ─────────────────────────────────────────────┐
│                                                          │
│  Approved Test Case (3.2)                                │
│  ├─ Metadata (title, tags, priority, status)             │
│  └─ Versions (immutable snapshots of steps + content)    │
│     └─ Steps → reference Elements by ID                  │
│                                                          │
│  Element Repository (3.4)                                │
│  └─ Elements (logical elements with locator strategies)  │
│                                                          │
│  Test Data (3.5)                                         │
│  └─ Fixtures / datasets / parameterization               │
│                                                          │
└──────────────────────────┬───────────────────────────────┘
                           │ composed + configured
                           ▼
┌─ COMPOSITION ────────────────────────────────────────────┐
│                                                          │
│  Test Suite (3.6)                                        │
│  └─ Membership (by tags and/or IDs) + execution config   │
│                                                          │
│  Environment Profile (3.7)                               │
│  └─ Browser, viewport, base URL, capabilities            │
│                                                          │
└──────────────────────────┬───────────────────────────────┘
                           │ triggers
                           ▼
┌─ EXECUTION ──────────────────────────────────────────────┐
│                                                          │
│  Test Run (3.8)                                          │
│  ├─ Pins ATC version + environment snapshot              │
│  ├─ Step Results (pass/fail per step)                    │
│  └─ Evidence (screenshots, DOM, logs)                    │
│                                                          │
│  Execution IR (3.9) — derived artifact                   │
│  └─ Generated from (ATC version + Element Repository)    │
│     Rendered to: CmdRunner JSON, Playwright, future      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Project (3.1)** is the tenancy root that contains all of the above.

---

## 3. Entity Definitions

### 3.1 Project

#### Purpose & Responsibility

The tenancy, isolation, and permissions boundary. A Project owns its own Element Repository, Environment Profiles, Test Suites, and all Test Cases. There is no cross-project sharing of elements or data in V1 — Acme's "Login Button" is distinct from Globex's.

The Project is **not** a hierarchy level. It does not enforce Feature → Scenario → TestCase containment. Organization within a project is flat, using tags and optional collections.

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier |
| `name` | string | yes | Human-readable project name |
| `description` | string | no | What this project covers |
| `tags` | string[] | no | Project-level tag vocabulary (available tags for test cases within this project) |
| `createdAt` | timestamp | yes | Creation timestamp |
| `updatedAt` | timestamp | yes | Last modification timestamp |
| `createdBy` | string (user ID) | yes | Owner |

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Approved Test Cases | 1 : many | All test cases belong to exactly one project |
| → Elements | 1 : many | The project's element repository — elements are project-scoped |
| → Environment Profiles | 1 : many | Profiles are project-scoped |
| → Test Suites | 1 : many | Suites are project-scoped |
| → Source Artifacts | 1 : many | Sources are project-scoped |
| → Test Data | 1 : many | Fixtures/datasets are project-scoped |

#### Invariants

- **INV-P1:** An Element belongs to exactly one Project. Elements cannot be shared across projects in V1.
- **INV-P2:** Deleting a Project cascades to all child entities (test cases, elements, runs, etc.). This is a destructive operation gated by explicit confirmation.
- **INV-P3:** The `tags` vocabulary is advisory — test cases may use tags not in this list (for forward-compatibility with free-form tagging). The list exists for UI autocomplete, not enforcement.

#### Lifecycle

```
Created → Active → Archived
```

Projects do not have complex lifecycle states in V1. `Active` is the default; `Archived` hides the project from default views but retains all data.

#### Versioning

Projects are not versioned. Metadata changes (name, description) update in place.

#### Ownership

**Repository context** — the Project is the root scope owned by the repository layer. All other contexts read the project ID to scope their queries but do not modify the Project entity.

#### Example

```json
{
  "id": "prj-aa1b2c3d",
  "name": "Adani One Flight Booking",
  "description": "End-to-end test coverage for the Adani One web platform",
  "tags": ["smoke", "checkout", "auth", "flights", "mobile", "regression"],
  "createdAt": "2026-07-01T10:00:00Z",
  "updatedAt": "2026-07-20T14:30:00Z",
  "createdBy": "user-1862"
}
```

---

### 3.2 Approved Test Case

#### Purpose & Responsibility

The **canonical source of truth for business intent**. An Approved Test Case (ATC) describes *what the business wants to verify* — a sequence of business-level steps with logical element references, inputs, and validations — without coupling to any specific execution engine, selector strategy, or UI implementation detail.

The ATC is what humans review, approve, version, and maintain. Everything else (Execution IR, Playwright code, CmdRunner JSON) is derived from it.

The ATC is separated into two sub-entities:
- **Approved Test Case** — the stable identity and current metadata
- **Approved Test Case Version** — an immutable snapshot of the steps, validations, and content at a point in time

This separation enables: runs that pin to a specific version, change history that shows what evolved, and regeneration that targets a specific version's sources.

#### 3.2a Approved Test Case (identity + metadata)

##### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier — never changes, never reused |
| `projectId` | string (FK → Project) | yes | Owning project |
| `title` | string | yes | Human-readable test case title |
| `description` | string | no | What this test case verifies and why it matters |
| `tags` | string[] | no | Organization tags (e.g., `["smoke", "checkout"]`) |
| `priority` | enum | yes | `critical` \| `high` \| `medium` \| `low` |
| `status` | enum | yes | `draft` \| `in_review` \| `approved` \| `deprecated` |
| `currentVersionId` | string (FK → ATC Version) | yes | Pointer to the active version |
| `testDataRefs` | string[] (FK → Test Data) | no | References to datasets/parameters used by this case |
| `createdAt` | timestamp | yes | Creation timestamp |
| `updatedAt` | timestamp | yes | Last modification timestamp |
| `createdBy` | string (user ID) | yes | Author |

##### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Belongs to exactly one project |
| → Versions | 1 : many | Immutable snapshots; `currentVersionId` points to the active one |
| → Test Data | many : many | Through `testDataRefs`; a case may reference zero or more datasets |
| ← Test Suites | many : many | Suites include this case by tag or ID |
| ← Test Runs | 1 : many | Runs pin to a specific version of this case |
| → Source Artifacts | many : many | Through provenance on each version (see 3.2b) |

##### Invariants

- **INV-ATC1:** `currentVersionId` always points to an existing version. Creating an ATC requires creating version 1 in the same transaction.
- **INV-ATC2:** Status transitions follow: `draft → in_review → approved → deprecated`. An approved case can be revised (creates a new version, status returns to `draft` or `in_review`). A deprecated case cannot be run.
- **INV-ATC3:** Title and tags can be updated in place (organizational metadata). Step changes always create a new version (behavioral change).
- **INV-ATC4:** The ATC definition never contains execution evidence (screenshots, DOM snapshots, logs, pass/fail). Those belong to Test Runs.

##### Lifecycle

```
            ┌──────────────────────────────────────────┐
            ▼                                          │
draft → in_review → approved → (revise) → draft       │
                         │                             │
                         ▼                             │
                    deprecated                         │
                         │                             │
                         ▼                             │
                    (end of life)                      │
            └──────────────────────────────────────────┘
```

| Transition | Trigger | Effect |
|------------|---------|--------|
| `→ draft` | ATC created from any source | Version 1 created |
| `draft → in_review` | Submitted for review | No version change |
| `in_review → approved` | Reviewer approves | Status set to `approved`; approval recorded on the version |
| `approved → draft` | Steps edited | New version created; status returns to `draft` (requires re-approval) |
| `approved → deprecated` | Test case retired | No new runs can be triggered; existing runs retained |

##### Versioning

See [3.2b Approved Test Case Version](#32b-approved-test-case-version) below.

##### Ownership

**Repository context** — the ATC is the canonical entity owned by the repository. The execution context reads a frozen version; the authoring context writes new versions through the AI review workflow.

#### 3.2b Approved Test Case Version

An immutable snapshot of the test case's content at a point in time. Each version captures the steps, validations, source provenance, and a change summary.

##### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Version identifier |
| `testCaseId` | string (FK → ATC) | yes | Parent test case |
| `versionNumber` | integer | yes | Monotonically increasing within the test case (1, 2, 3, ...) |
| `steps` | Step[] | yes | Ordered list of business steps (see Step sub-entity) |
| `sourceArtifactIds` | string[] (FK → Source Artifact) | no | Provenance — which source(s) produced this version |
| `aiMetadata` | AIMetadata | no | AI interpretation metadata from the review process (see below) |
| `changeSummary` | string | no | Human-readable description of what changed from the previous version |
| `parentVersionId` | string (FK → ATC Version) | no | Previous version (for diff chain); null for version 1 |
| `approvedBy` | string (user ID) | no | Who approved this version (null if not yet approved) |
| `approvedAt` | timestamp | no | When this version was approved |
| `createdAt` | timestamp | yes | Creation timestamp |
| `createdBy` | string (user ID) | yes | Who created this version |

##### Step sub-entity

Each step in `steps[]`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Step identifier (unique within the version) |
| `order` | integer | yes | Position in the sequence (0-based) |
| `action` | enum | yes | `click` \| `fill` \| `select` \| `selectDate` \| `toggle` \| `hover` \| `navigate` \| `verify` \| `wait` |
| `description` | string | yes | Human-readable description of what this step does |
| `elementId` | string (FK → Element) | conditional | Required for all actions except `navigate` and `wait`. References a logical element by stable ID. |
| `input` | any | no | Value to enter, select, or choose (e.g., `"john@example.com"`, `"2026-07-20"`) |
| `validations` | Validation[] | no | Assertions to verify after this step executes (see Validation sub-entity) |

**Key constraint:** Steps never contain selectors, CSS, XPath, or execution JSON. They reference logical elements by ID. The execution detail is resolved at generation time from the Element Repository.

##### Validation sub-entity

Each validation in `step.validations[]`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Validation identifier |
| `type` | enum | yes | `presence` \| `visibility` \| `textMatch` \| `attributeMatch` \| `count` \| `equality` \| `urlMatch` \| `custom` |
| `elementId` | string (FK → Element) | conditional | Target element (required for element-based validations; null for URL/custom) |
| `property` | string | conditional | Property to check (e.g., `"text"`, `"value"`, `"href"`, `"checked"`) |
| `comparison` | enum | yes | `equals` \| `contains` \| `matches` \| `startsWith` \| `greaterThan` \| `lessThan` \| `isTrue` \| `isFalse` |
| `expectedValue` | any | conditional | Expected value (required for `equals`, `contains`, etc.; omitted for `isTrue`/`isFalse`) |
| `severity` | enum | yes | `hard` (stops the test on failure) \| `soft` (records failure, continues execution) |

##### AIMetadata sub-entity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `confidence` | number | no | AI confidence in the interpretation (0.05–0.95; never 0 or 1) |
| `reasoning` | string | no | AI's explanation of how it interpreted the source into this test case |
| `modelVersion` | string | no | Which AI model/version produced this interpretation |
| `interpretationTimestamp` | timestamp | no | When the AI produced this interpretation |

##### Invariants

- **INV-ATCV1:** Versions are **immutable** once created. To change steps, create a new version.
- **INV-ATCV2:** `versionNumber` is monotonically increasing. Version numbers are never reused, even after deletion.
- **INV-ATCV3:** Every `step.elementId` must resolve to an existing Element in the same Project. Deleting an Element referenced by any version is blocked.
- **INV-ATCV4:** Steps reference Elements by **stable ID**, never by logical name. Logical name is a label on the Element — renaming an element does not orphan any step.
- **INV-ATCV5:** `sourceArtifactIds` records provenance. If the AI reinterprets a source, the new interpretation creates a new version — it does not mutate the existing version or the source.

##### Lifecycle

Versions do not have a lifecycle — they are created and then persist immutably. The ATC's `currentVersionId` determines which version is "live."

##### Versioning

Versions ARE the versioning mechanism. They are not themselves versioned.

#### Example

```json
{
  "id": "tc-7f8e9d0c",
  "projectId": "prj-aa1b2c3d",
  "title": "User can log in with valid credentials",
  "description": "Verifies that a registered user can log in and reach the dashboard",
  "tags": ["smoke", "auth"],
  "priority": "critical",
  "status": "approved",
  "currentVersionId": "tcv-v3a1b2c3",
  "testDataRefs": ["td-valid-user"],
  "createdAt": "2026-07-15T09:00:00Z",
  "updatedAt": "2026-07-19T11:30:00Z",
  "createdBy": "user-1862"
}
```

Version example:

```json
{
  "id": "tcv-v3a1b2c3",
  "testCaseId": "tc-7f8e9d0c",
  "versionNumber": 3,
  "steps": [
    {
      "id": "step-1",
      "order": 0,
      "action": "navigate",
      "description": "Navigate to the login page",
      "input": "/login"
    },
    {
      "id": "step-2",
      "order": 1,
      "action": "fill",
      "description": "Enter the user's email address",
      "elementId": "elm-101-login-email",
      "input": "{{testData.email}}",
      "validations": []
    },
    {
      "id": "step-3",
      "order": 2,
      "action": "fill",
      "description": "Enter the user's password",
      "elementId": "elm-102-login-password",
      "input": "{{testData.password}}",
      "validations": []
    },
    {
      "id": "step-4",
      "order": 3,
      "action": "click",
      "description": "Click the Login button to submit",
      "elementId": "elm-103-login-button",
      "validations": [
        {
          "id": "val-1",
          "type": "urlMatch",
          "comparison": "contains",
          "expectedValue": "/dashboard",
          "severity": "hard"
        },
        {
          "id": "val-2",
          "type": "visibility",
          "elementId": "elm-104-dashboard-header",
          "property": "visible",
          "comparison": "isTrue",
          "severity": "hard"
        }
      ]
    }
  ],
  "sourceArtifactIds": ["sa-rec-abc123"],
  "aiMetadata": {
    "confidence": 0.88,
    "reasoning": "Interpreted 6 raw click/fill interactions as a login flow. Merged email focus+type+blur into a single fill step. Proposed URL and visibility validations based on observed navigation to /dashboard.",
    "modelVersion": "gemini-2.0-flash-001",
    "interpretationTimestamp": "2026-07-19T11:25:00Z"
  },
  "changeSummary": "Updated email element reference after element repository restructuring. Added dashboard visibility validation.",
  "parentVersionId": "tcv-v2a1b2c3",
  "approvedBy": "user-1862",
  "approvedAt": "2026-07-19T11:30:00Z",
  "createdAt": "2026-07-19T11:25:00Z",
  "createdBy": "user-1862"
}
```

---

### 3.3 Source Artifact

#### Purpose & Responsibility

The **immutable raw input** from which an Approved Test Case is (or can be) generated. A Source Artifact captures the original signal — recorder interactions, a natural-language description, a screenshot, an imported document — and retains it permanently so that:

1. The AI can regenerate the test case if the interpretation model improves.
2. A human can audit why the AI interpreted the source the way it did.
3. (Future) The (source → approved test case) pairs form a training dataset for improving the interpretation model.

Source Artifacts are **polymorphic** — one entity with a `type` discriminator. Each type has a different `content` structure. The Interaction Timeline is one type; natural language is another; screenshots are another. This avoids making each input mode a separate first-class entity while preserving the regeneration benefit for all of them.

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier |
| `projectId` | string (FK → Project) | yes | Owning project |
| `type` | enum | yes | `interaction_timeline` \| `natural_language` \| `image` \| `imported_document` \| `manual` |
| `content` | object | yes | Type-specific payload (see below) |
| `metadata` | object | yes | Capture metadata (see below) |
| `createdAt` | timestamp | yes | When this source was captured/created |
| `createdBy` | string (user ID) | yes | Who captured/created it |

#### Type-specific content

##### `interaction_timeline`

The output of the CmdRunner Smart Recorder — a sequence of raw, immutable interactions.

```json
{
  "type": "interaction_timeline",
  "content": {
    "sessionEvents": [
      {
        "actionId": "act-001",
        "type": "navigate",
        "url": "https://app.example.com/login",
        "timestamp": "2026-07-19T11:20:00Z"
      },
      {
        "actionId": "act-002",
        "type": "text",
        "elementIdentity": { "tag": "INPUT", "accessibleName": "Email", "inputType": "email" },
        "value": "john@example.com",
        "timestamp": "2026-07-19T11:20:05Z"
      },
      {
        "actionId": "act-003",
        "type": "text",
        "elementIdentity": { "tag": "INPUT", "accessibleName": "Password", "inputType": "password" },
        "value": "••••••••",
        "timestamp": "2026-07-19T11:20:12Z"
      },
      {
        "actionId": "act-004",
        "type": "click",
        "elementIdentity": { "tag": "BUTTON", "accessibleName": "Sign In", "role": "button" },
        "timestamp": "2026-07-19T11:20:15Z"
      }
    ],
    "recordingMetadata": {
      "browser": "Chrome 126",
      "viewport": { "width": 1440, "height": 900 },
      "duration": 15,
      "url": "https://app.example.com/login"
    }
  },
  "metadata": {
    "captureMethod": "cmdrunner_recorder_v8.5",
    "rawEvidenceAvailable": true
  }
}
```

The `sessionEvents` array matches the existing CmdRunner Timeline format (SessionEvent[]). Each event carries full element identity, classification evidence, and timing. This is the raw signal — noisy, detailed, and complete.

##### `natural_language`

```json
{
  "type": "natural_language",
  "content": {
    "description": "Log in as a registered user with valid credentials and verify the dashboard loads with the user's name displayed in the header.",
    "context": "Provided by QA lead during sprint planning"
  },
  "metadata": {
    "captureMethod": "manual_text_input"
  }
}
```

##### `image`

```json
{
  "type": "image",
  "content": {
    "imagePath": "/artifacts/screenshots/login-page-2026-07-19.png",
    "caption": "Login page with email/password fields and Sign In button",
    "annotations": []
  },
  "metadata": {
    "captureMethod": "screenshot_upload"
  }
}
```

##### `imported_document`

```json
{
  "type": "imported_document",
  "content": {
    "documentPath": "/artifacts/imports/test-plan-auth-v2.pdf",
    "documentType": "pdf",
    "extractedText": "..."
  },
  "metadata": {
    "captureMethod": "file_upload",
    "sourceSystem": "confluence"
  }
}
```

##### `manual`

```json
{
  "type": "manual",
  "content": {
    "description": "Test case authored directly in the test case editor without a recording source."
  },
  "metadata": {
    "captureMethod": "direct_authoring"
  }
}
```

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Belongs to exactly one project |
| → ATC Versions | many : many | Through `ATCVersion.sourceArtifactIds`; one source can produce multiple test case versions; one version can have multiple sources |

#### Invariants

- **INV-SA1:** Source Artifacts are **immutable** once created. The content never changes. Re-interpretation by the AI creates a new ATC version — it does not modify the source.
- **INV-SA2:** Source Artifacts are **never deleted**. They are retained permanently for regeneration, audit, and (future) training.
- **INV-SA3:** The Interaction Timeline content stores the **complete raw signal** including element identities, classification evidence, and timing. It does not store business interpretations — those live on the ATC version's `aiMetadata`.

#### Lifecycle

Source Artifacts have a single state: `created`. They persist indefinitely. There is no lifecycle — immutability replaces the need for state transitions.

#### Versioning

Source Artifacts are not versioned. Immutability makes versioning unnecessary — if a new recording is taken, it creates a new Source Artifact.

#### Ownership

**Authoring context** — Source Artifacts are owned by the authoring pipeline. The repository context reads them (via provenance references on ATC versions) but never modifies them.

---

### 3.4 Element Repository

#### Purpose & Responsibility

A **first-class catalog of logical UI elements** within a Project. Each Element represents a business-meaningful UI component ("Login Button", "Departure Date Picker", "Cart Total") identified by a stable ID and resolved to one or more locator strategies.

The Element Repository is what makes the architecture scalable:
- **Reuse:** One "Login Button" definition serves every test case that clicks it.
- **Self-healing (future):** When a run fails because the locator is stale, the AI proposes a new locator strategy. Updating the Element Repository entry automatically benefits every test case on the next regeneration.
- **Decoupling:** Steps reference elements by ID. The locator can change without touching any test case.

#### Fields (Element)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Stable identifier — never changes, never reused. Format: `elm-{project-scope}-{sequential}` (e.g., `elm-101-login-button`) |
| `projectId` | string (FK → Project) | yes | Owning project |
| `logicalName` | string | yes | Human-readable label (e.g., "Login Button"). Can be renamed without affecting references. |
| `description` | string | no | Business description of what this element is |
| `pageOrComponent` | string | no | Scope — which page or reusable component this element belongs to (e.g., "login_page", "nav_bar", "checkout_form"). Prevents naming collisions. |
| `locatorStrategies` | LocatorStrategy[] | yes | Ranked list of strategies for locating this element (see below) |
| `status` | enum | yes | `active` \| `stale` \| `broken` |
| `createdAt` | timestamp | yes | Creation timestamp |
| `updatedAt` | timestamp | yes | Last locator update timestamp |
| `lastHealedAt` | timestamp | no | `[future]` When a self-heal last updated the locators. Null in V1. |
| `healHistory` | object[] | no | `[future]` History of heal events. Empty in V1. |

#### LocatorStrategy sub-entity

A ranked strategy for locating the element at execution time. The executor tries strategies in priority order; the first match wins.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | yes | `role` \| `accessibleName` \| `testId` \| `text` \| `label` \| `css` \| `xpath` |
| `value` | string | yes | The locator value (e.g., `role=button[name="Sign In"]`, `[data-testid="login-btn"]`, `#email-input`) |
| `priority` | integer | yes | Rank order (1 = highest priority, tried first) |
| `confidence` | number | no | `[future]` Confidence score (0.0–1.0). Present in V1 schema but not actively computed. Default: 1.0 for manually created, null for AI-suggested. |

**V1 locator strategy philosophy:** Strategies are ranked by priority (semantic first, fragile last). The typical order for a well-built app: `role` → `accessibleName` → `testId` → `text` → `label` → `css` → `xpath`. The `confidence` field exists so that future self-healing can rank strategies by observed success rate — but V1 uses static priority.

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Elements are project-scoped |
| ← Steps | many : many | Many steps across many test cases can reference the same element |
| ← Validations | many : many | Validations can target elements |

#### Invariants

- **INV-EL1:** An Element belongs to exactly one Project.
- **INV-EL2:** Steps reference Elements by **stable ID**, never by logical name or selector. Renaming an element's `logicalName` does not affect any reference.
- **INV-EL3:** Deleting an Element is **blocked** if any ATC version step or validation references it. Elements must be unreferenced before deletion.
- **INV-EL4:** `locatorStrategies` is always a non-empty array. An element must have at least one strategy.
- **INV-EL5:** `id` is immutable and never reused. Even if an element is deleted, its ID is permanently retired.

#### Lifecycle

```
active → stale → broken
  ▲                   │
  │                   │
  └── (healed) ───────┘
         [future]
```

| State | Meaning | V1 behavior |
|-------|---------|-------------|
| `active` | Locator strategies are valid; element can be found | Normal state |
| `stale` | `[future]` Locator strategies are aging (intermittent failures) | Not set automatically in V1; can be set manually |
| `broken` | `[future]` Locator strategies no longer work | Not set automatically in V1; can be set manually |

In V1, all elements start as `active`. The `stale` and `broken` transitions are part of the deferred self-healing system — the schema supports them, but V1 does not automatically detect or set them.

#### Versioning

Elements are **not versioned** in V1. Locator strategy updates modify the element in place. The `updatedAt` timestamp tracks the last change.

`[future]` Full element versioning (tracking locator changes over time with diffs) is deferred. The `healHistory` field is the placeholder for this — when self-healing is implemented, each heal event will be appended to `healHistory`, providing an audit trail without full versioning.

#### Ownership

**Repository context** — Elements are owned by the repository alongside test cases. The execution context reads element locator strategies during IR generation and execution but does not modify them (except via the future self-healing write path).

#### Example

```json
{
  "id": "elm-103-login-button",
  "projectId": "prj-aa1b2c3d",
  "logicalName": "Login Button",
  "description": "The primary sign-in submission button on the login page",
  "pageOrComponent": "login_page",
  "locatorStrategies": [
    { "type": "role", "value": "button[name=\"Sign In\"]", "priority": 1, "confidence": 1.0 },
    { "type": "testId", "value": "[data-testid=\"login-submit\"]", "priority": 2, "confidence": 1.0 },
    { "type": "text", "value": "text=Sign In", "priority": 3, "confidence": 1.0 },
    { "type": "css", "value": "#login-form button[type=\"submit\"]", "priority": 4, "confidence": null }
  ],
  "status": "active",
  "createdAt": "2026-07-15T09:05:00Z",
  "updatedAt": "2026-07-18T14:00:00Z",
  "lastHealedAt": null,
  "healHistory": []
}
```

---

### 3.5 Test Data

#### Purpose & Responsibility

Structured data that test cases consume at execution time. Test Data decouples test logic from specific values — a test case says "log in with `{{testData.email}}` and `{{testData.password}}`" and the actual values come from a referenced dataset.

This entity exists to support:
- **Parameterization (data-driven testing):** One test case, many data rows. Run the login test with 5 different user accounts.
- **Reuse:** A "valid user" dataset used by 10 test cases. Update the dataset once.
- **Environment-specific values:** The same logical dataset with different values for staging vs. production.

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier |
| `projectId` | string (FK → Project) | yes | Owning project |
| `name` | string | yes | Human-readable name (e.g., "Valid User Credentials") |
| `description` | string | no | What this dataset represents |
| `type` | enum | yes | `static` \| `parameterized` \| `factory` |
| `data` | object \| object[] | yes | Type-specific (see below) |
| `createdAt` | timestamp | yes | Creation timestamp |
| `updatedAt` | timestamp | yes | Last modification timestamp |

#### Type-specific data

##### `static` — a single row of key-value pairs

```json
{
  "type": "static",
  "data": {
    "email": "testuser@example.com",
    "password": "TestPass123!",
    "firstName": "Test",
    "lastName": "User"
  }
}
```

##### `parameterized` — multiple rows for data-driven testing

```json
{
  "type": "parameterized",
  "data": [
    { "email": "admin@example.com",    "password": "AdminPass1!", "role": "admin" },
    { "email": "editor@example.com",   "password": "EditPass1!",  "role": "editor" },
    { "email": "viewer@example.com",   "password": "ViewPass1!",  "role": "viewer" }
  ]
}
```

When an ATC references a parameterized dataset, the executor runs the test case once per row, substituting `{{testData.<key>}}` with the row's values.

##### `factory` — `[future]` programmatic data generation

```json
{
  "type": "factory",
  "data": {
    "factoryType": "faker",
    "schema": {
      "email": "internet.email",
      "password": "internet.password",
      "firstName": "person.firstName"
    }
  }
}
```

Factories are deferred — the schema supports the type, but V1 does not implement factory execution.

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Belongs to exactly one project |
| ← ATCs | many : many | Referenced through `ATC.testDataRefs` |

#### Invariants

- **INV-TD1:** Test Data values are referenced in steps via `{{testData.<key>}}` template syntax. The executor resolves these at run time.
- **INV-TD2:** Deleting Test Data referenced by any ATC issues a warning but is not blocked (the reference becomes a broken template — the run will error with a clear message). V1 may upgrade this to a block.
- **INV-TD3:** Secrets (passwords, tokens) in test data are stored with `is_secret` flag at the field level `[future]`. In V1, the entire dataset is treated as potentially sensitive and access-controlled at the project level.

#### Lifecycle

Test Data has no lifecycle states. It exists and can be updated. Updates to static/parameterized data take effect on the next run — there is no versioning in V1.

#### Versioning

`[future]` Test Data versioning is deferred. In V1, data updates are in-place. If test reproducibility becomes a concern (e.g., "this run used v2 of the dataset"), data snapshotting at run time can be added — the Test Run already snapshots the environment profile, and the same pattern can extend to test data.

#### Ownership

**Repository context** — Test Data is owned by the repository. The execution context reads it during run setup.

---

### 3.6 Test Suite

#### Purpose & Responsibility

A **composition and execution configuration** entity. A Test Suite answers: *which tests, in what configuration, with what execution policy?* It is the unit of "run this group of tests."

Test Suites are not a hierarchy level — they are a selection + configuration overlay. A suite selects test cases (by tags, by explicit IDs, or both) and attaches an execution configuration (retry policy, ordering, parallelism, environment).

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier |
| `projectId` | string (FK → Project) | yes | Owning project |
| `name` | string | yes | Human-readable name (e.g., "Smoke Tests", "Checkout Regression") |
| `description` | string | no | What this suite covers |
| `membership` | object | yes | Selection criteria (see below) |
| `environmentProfileId` | string (FK → Environment Profile) | no | Default environment for this suite |
| `executionConfig` | object | yes | Execution policy (see below) |
| `createdAt` | timestamp | yes | Creation timestamp |
| `updatedAt` | timestamp | yes | Last modification timestamp |

#### Membership

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tagFilters` | string[] | no | Include all test cases matching ANY of these tags |
| `testCaseIds` | string[] | no | Explicit test case IDs to include |
| `excludeIds` | string[] | no | Explicit test case IDs to exclude (overrides tag filters) |
| `priorityFilter` | string[] | no | Only include test cases with these priorities |

A test case is included in the suite if: it matches a tag filter OR is in `testCaseIds`, AND it is not in `excludeIds`, AND (if `priorityFilter` is set) its priority is in the filter.

#### Execution Config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `retryCount` | integer | yes | Number of retries on failure (default: 0) |
| `ordering` | enum | yes | `sequential` \| `parallel` \| `random` |
| `maxParallelism` | integer | no | Max concurrent tests when `ordering=parallel` (default: 4) |
| `stopOnFailure` | boolean | yes | Whether to halt the suite on first hard failure (default: false) |
| `rerunFailedOnly` | boolean | no | `[future]` Re-run only previously failed tests (default: false) |

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Belongs to exactly one project |
| → Test Cases | many : many | Through membership (tags + IDs) |
| → Environment Profile | many : 1 | Optional default environment |
| ← Test Runs | 1 : many | A suite run produces multiple test runs |

#### Invariants

- **INV-TS1:** Membership is resolved at **run request time**, not at suite creation time. If new test cases are tagged `smoke` after the suite is created, they are automatically included in the next run of the "Smoke Tests" suite.
- **INV-TS2:** `excludeIds` always overrides `tagFilters`. This is the escape hatch for "include all smoke tests except the flaky one."
- **INV-TS3:** A suite with empty membership (no tags, no IDs) is valid but will produce zero test runs. This is not an error — it's an empty suite.

#### Lifecycle

Test Suites have no lifecycle states. They exist, can be updated, and can be deleted.

#### Versioning

Test Suites are not versioned in V1. Configuration changes update in place. The Test Run captures which tests were selected and what configuration was used at run time — this provides the audit trail without suite versioning.

#### Ownership

**Composition context** — Suites are owned by the composition/execution-planning layer. They read from the repository (to resolve membership) and feed into the execution context (to trigger runs).

#### Example

```json
{
  "id": "ts-smoke-001",
  "projectId": "prj-aa1b2c3d",
  "name": "Smoke Tests",
  "description": "Critical-path tests that run on every deployment",
  "membership": {
    "tagFilters": ["smoke"],
    "testCaseIds": [],
    "excludeIds": ["tc-known-flaky-001"],
    "priorityFilter": ["critical", "high"]
  },
  "environmentProfileId": "env-staging-chrome",
  "executionConfig": {
    "retryCount": 1,
    "ordering": "parallel",
    "maxParallelism": 4,
    "stopOnFailure": false
  },
  "createdAt": "2026-07-10T08:00:00Z",
  "updatedAt": "2026-07-18T10:00:00Z"
}
```

---

### 3.7 Environment Profile

#### Purpose & Responsibility

Defines **where and how a test executes**: which browser, which viewport, which base URL, what device capabilities. Environment Profiles are cross-cutting — they are not per-test-case. A test case doesn't know or care whether it runs on Chrome desktop or Safari mobile; the profile determines that.

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier |
| `projectId` | string (FK → Project) | yes | Owning project |
| `name` | string | yes | Human-readable name (e.g., "Staging - Chrome Desktop") |
| `baseUrl` | string | yes | The target application's base URL |
| `browser` | enum | yes | `chrome` \| `firefox` \| `safari` \| `edge` |
| `viewport` | object | yes | `{ width: number, height: number }` |
| `device` | string | no | `[future]` Device emulation (e.g., "iPhone 15", "Pixel 8") |
| `capabilities` | object[] | no | Browser capabilities/permissions (geolocation, camera, notifications) |
| `metadata` | object | no | Arbitrary key-value pairs (e.g., `{ "timezone": "America/New_York" }`) |
| `createdAt` | timestamp | yes | Creation timestamp |
| `updatedAt` | timestamp | yes | Last modification timestamp |

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Belongs to exactly one project |
| ← Test Suites | many : 1 | A suite may specify a default profile |
| ← Test Runs | many : 1 | Each run snapshots the profile at run time |

#### Invariants

- **INV-EP1:** An Environment Profile is **snapshotted into the Test Run** at run time. The run captures the profile's configuration as a frozen copy. If the profile changes later, historical runs still report against the configuration that was active when they ran.
- **INV-EP2:** `baseUrl` is required. Even local testing needs a base URL. Tests navigate relative to this URL.

#### Lifecycle

No lifecycle states. Profiles exist, can be updated, and can be deleted (if not referenced by active runs — historical runs retain their snapshots regardless).

#### Versioning

`[future]` Environment Profile versioning is deferred. In V1, the run-time snapshot (INV-EP1) provides reproducibility. If profile change auditing becomes necessary, the same versioning pattern as ATC versions can be applied.

#### Ownership

**Execution context** — Profiles are owned by the execution/planning layer. They are read by the composition context (suites) and snapshotted by the execution context (runs).

#### Example

```json
{
  "id": "env-staging-chrome",
  "projectId": "prj-aa1b2c3d",
  "name": "Staging - Chrome Desktop",
  "baseUrl": "https://staging.adanione.com",
  "browser": "chrome",
  "viewport": { "width": 1440, "height": 900 },
  "device": null,
  "capabilities": [
    { "type": "geolocation", "value": "deny" },
    { "type": "notifications", "value": "deny" }
  ],
  "metadata": { "timezone": "Asia/Kolkata" },
  "createdAt": "2026-07-05T12:00:00Z",
  "updatedAt": "2026-07-05T12:00:00Z"
}
```

---

### 3.8 Test Run

#### Purpose & Responsibility

A **single execution instance** of an Approved Test Case version against a specific environment. The Test Run is the observation — it records what actually happened when the test ran. It is completely separate from the test definition.

A Test Run captures:
- Which ATC version ran (pinned, immutable reference)
- Which environment was used (snapshotted at run time)
- Per-step results (pass/fail, duration, actual values)
- Evidence (screenshots, DOM snapshots, logs)
- Overall outcome and timing

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Stable identifier |
| `projectId` | string (FK → Project) | yes | Owning project |
| `testCaseId` | string (FK → ATC) | yes | Which test case ran |
| `testCaseVersionId` | string (FK → ATC Version) | yes | **Pinned** to a specific version |
| `testCaseVersionNumber` | integer | yes | Denormalized version number for fast display |
| `suiteRunId` | string (FK → Suite Run) | no | If part of a suite execution, links to the parent suite run |
| `environmentSnapshot` | object | yes | Frozen copy of the Environment Profile at run time (see INV-EP1) |
| `testDataSnapshot` | object | no | `[future]` Frozen copy of resolved test data |
| `status` | enum | yes | `pending` \| `running` \| `passed` \| `failed` \| `error` \| `skipped` |
| `triggeredBy` | string | yes | User ID or CI system identifier |
| `triggerType` | enum | yes | `manual` \| `scheduled` \| `ci` \| `suite` |
| `startedAt` | timestamp | no | When execution began |
| `completedAt` | timestamp | no | When execution finished |
| `duration` | integer | no | Total execution time in milliseconds |
| `stepResults` | StepResult[] | no | Per-step results (populated during execution) |
| `retryCount` | integer | no | How many retries were attempted (0 = first attempt) |
| `createdAt` | timestamp | yes | When the run was created/requested |

#### StepResult sub-entity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Result identifier |
| `stepId` | string | yes | References the step in the ATC version |
| `status` | enum | yes | `passed` \| `failed` \| `error` \| `skipped` |
| `duration` | integer | yes | Step execution time in milliseconds |
| `evidence` | Evidence[] | no | Screenshots, DOM snapshots, logs captured during this step |
| `actualValue` | any | no | The actual value observed (for validation comparisons) |
| `expectedValue` | any | no | What was expected (denormalized from the validation) |
| `error` | object | no | Error details if the step failed (message, stack trace, error type) |

#### Evidence sub-entity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Evidence identifier |
| `type` | enum | yes | `screenshot` \| `domSnapshot` \| `log` \| `video` \| `networkLog` \| `har` |
| `path` | string | yes | File path or URL to the evidence artifact |
| `capturedAt` | timestamp | yes | When this evidence was captured |
| `metadata` | object | no | Additional context (e.g., viewport size for screenshots) |

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → Project | many : 1 | Belongs to exactly one project |
| → ATC Version | many : 1 | **Pinned** to a specific, immutable version |
| → Suite Run | many : 1 | Optional; null for standalone runs |
| ← Step Results | 1 : many | One result per step in the ATC version |

#### Invariants

- **INV-TR1:** A Test Run references a **specific ATC version**, never the live ATC. If the ATC is updated to a new version, historical runs still report against the version they executed.
- **INV-TR2:** `environmentSnapshot` is a **frozen copy** — it does not reference the live Environment Profile. Historical runs are immune to profile changes.
- **INV-TR3:** Test Runs are **immutable after completion**. Once `status` transitions to a terminal state (`passed`, `failed`, `error`, `skipped`), no field may change.
- **INV-TR4:** Evidence belongs exclusively to Step Results within Test Runs. No evidence is attached to test case definitions.
- **INV-TR5:** `testCaseVersionNumber` is denormalized from the version for fast display without a join. It must always match the version's actual `versionNumber`.

#### Lifecycle

```
pending → running → passed
                   → failed
                   → error
                   → skipped
```

| State | Meaning | Transition |
|-------|---------|------------|
| `pending` | Run requested but not started | → `running` when executor picks it up |
| `running` | Execution in progress | → terminal state when complete |
| `passed` | All steps passed | Terminal |
| `failed` | One or more hard validations failed | Terminal |
| `error` | Execution error (crash, timeout, infra) | Terminal |
| `skipped` | Run was skipped (precondition unmet, suite config) | Terminal |

All terminal states are immutable (INV-TR3).

#### Versioning

Test Runs are not versioned — each run is a unique, immutable observation. Historical runs are retained for analytics and audit. A retention policy `[future]` may prune very old runs, but V1 retains all runs.

#### Ownership

**Execution context** — Test Runs are owned by the execution layer. They are the output of the execution pipeline and the input to the reporting/analytics layer. No other context modifies them.

#### Example

```json
{
  "id": "run-20260720-001",
  "projectId": "prj-aa1b2c3d",
  "testCaseId": "tc-7f8e9d0c",
  "testCaseVersionId": "tcv-v3a1b2c3",
  "testCaseVersionNumber": 3,
  "suiteRunId": null,
  "environmentSnapshot": {
    "name": "Staging - Chrome Desktop",
    "baseUrl": "https://staging.adanione.com",
    "browser": "chrome",
    "viewport": { "width": 1440, "height": 900 }
  },
  "status": "failed",
  "triggeredBy": "user-1862",
  "triggerType": "manual",
  "startedAt": "2026-07-20T10:00:00Z",
  "completedAt": "2026-07-20T10:00:18Z",
  "duration": 18000,
  "stepResults": [
    {
      "id": "sr-1",
      "stepId": "step-1",
      "status": "passed",
      "duration": 1200,
      "evidence": [
        { "id": "ev-1", "type": "screenshot", "path": "/runs/run-001/step-1-before.png", "capturedAt": "2026-07-20T10:00:01Z" }
      ]
    },
    {
      "id": "sr-4",
      "stepId": "step-4",
      "status": "failed",
      "duration": 3400,
      "evidence": [
        { "id": "ev-2", "type": "screenshot", "path": "/runs/run-001/step-4-failure.png", "capturedAt": "2026-07-20T10:00:17Z" },
        { "id": "ev-3", "type": "domSnapshot", "path": "/runs/run-001/step-4-dom.html", "capturedAt": "2026-07-20T10:00:17Z" }
      ],
      "actualValue": "/login?error=invalid",
      "expectedValue": "/dashboard",
      "error": {
        "message": "URL validation failed: expected '/dashboard', got '/login?error=invalid'",
        "type": "validation_failed"
      }
    }
  ],
  "retryCount": 0,
  "createdAt": "2026-07-20T09:59:55Z"
}
```

---

### 3.9 Execution IR

#### Purpose & Responsibility

The **engine-agnostic intermediate representation** generated from an Approved Test Case version + Element Repository state. The Execution IR is the contract between "approved business intent" and "executor."

The IR is **not authoritative**. It is a derived, cached artifact — comparable to compiled bytecode. It exists for:
- **Performance:** Generating Playwright from the IR is faster than regenerating from the ATC every time.
- **Audit:** "What did we actually execute last time?" — the cached IR answers this.
- **Engine abstraction:** One IR, multiple render targets (CmdRunner JSON, Playwright, future engines).

The IR is **always regenerable** from (ATC version + Element Repository state). If the generator improves, every test case's IR can be regenerated. If an element's locator heals, regeneration picks up the new locator automatically.

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string (UUID) | yes | Artifact identifier |
| `testCaseVersionId` | string (FK → ATC Version) | yes | Which version this IR was generated from |
| `generatedAt` | timestamp | yes | When the IR was generated |
| `generatorVersion` | string | yes | Version of the generator that produced this IR (e.g., `ir-gen-1.0.0`) |
| `elementRepositoryVersion` | string | no | `[future]` Snapshot reference of Element Repository state used |
| `ir` | object | yes | The engine-agnostic intermediate representation |
| `renderings` | object | no | Cached engine-specific renderings (see below) |

#### Renderings

The IR can be rendered to multiple engine-specific formats. Each rendering is cached alongside the IR:

| Rendering | Key | Description |
|-----------|-----|-------------|
| CmdRunner JSON | `cmdrunner` | The execution JSON consumed by the CmdRunner execution engine |
| Playwright | `playwright` | Generated Playwright test code |
| `[future]` Cypress | `cypress` | Future engine support |
| `[future]` Appium | `appium` | Future mobile engine |

#### IR structure (engine-agnostic)

```json
{
  "testCaseId": "tc-7f8e9d0c",
  "testCaseVersionId": "tcv-v3a1b2c3",
  "testCaseVersionNumber": 3,
  "title": "User can log in with valid credentials",
  "steps": [
    {
      "order": 0,
      "action": "navigate",
      "target": { "url": "/login" }
    },
    {
      "order": 1,
      "action": "fill",
      "target": {
        "elementId": "elm-101-login-email",
        "resolvedLocators": [
          { "type": "role", "value": "textbox[name=\"Email\"]", "priority": 1 },
          { "type": "css", "value": "#email", "priority": 2 }
        ]
      },
      "input": "john@example.com"
    },
    {
      "order": 3,
      "action": "click",
      "target": {
        "elementId": "elm-103-login-button",
        "resolvedLocators": [
          { "type": "role", "value": "button[name=\"Sign In\"]", "priority": 1 }
        ]
      },
      "validations": [
        { "type": "urlMatch", "comparison": "contains", "expectedValue": "/dashboard", "severity": "hard" }
      ]
    }
  ]
}
```

Note: `resolvedLocators` is the key derived field — at generation time, the generator resolves each step's `elementId` to the current locator strategies from the Element Repository and embeds them in the IR. This is the point where logical elements become concrete locators.

#### Relationships

| Relationship | Cardinality | Notes |
|--------------|-------------|-------|
| → ATC Version | many : 1 | Generated from a specific version |
| ← (none) | — | Nothing references the IR as a source of truth; executors consume it transiently |

#### Invariants

- **INV-IR1:** The Execution IR is **always regenerable** from (ATC version + Element Repository state). No information in the IR is unique or irrecoverable.
- **INV-IR2:** The Execution IR is **never hand-edited**. If the IR needs to change, the source (ATC or Element Repository) is updated and the IR is regenerated.
- **INV-IR3:** The IR is **not a peer entity** to the ATC or Element Repository. It is a derived artifact with provenance (`testCaseVersionId`, `generatorVersion`, `generatedAt`). It may be cached, discarded, and regenerated without data loss.
- **INV-IR4:** `resolvedLocators` in each IR step must match the Element Repository's current locator strategies at generation time. If locators change, regeneration produces updated locators.
- **INV-IR5:** When the IR is regenerated and differs from the cached version, the diff is the self-heal review signal — it tells the human "the generator would now produce different locators for this test."

#### Lifecycle

```
generated → cached → (regenerated) → cached
                     (discarded)
```

The IR has no complex lifecycle. It is generated, cached, and optionally regenerated or discarded. There are no status fields — the IR is ephemeral by nature.

#### Versioning

The IR itself is not versioned. Each generation produces a new IR artifact that replaces the cached one. The `generatorVersion` and `generatedAt` fields provide provenance.

`[future]` IR diff tracking (showing what changed between regenerations) is deferred. V1 simply replaces the cached IR.

#### Ownership

**Generation context** — The IR is owned by the generation pipeline. No other context treats it as authoritative. The execution context reads it transiently during test execution. The repository context does not reference it.

---

## 4. Cross-Entity Invariants

These invariants span multiple entities and are the **load-bearing constraints** that prevent architectural drift. They are more important than any individual field definition.

| ID | Invariant | Why it matters |
|----|-----------|----------------|
| **X1** | The ATC is the single source of truth for business intent. Execution IR, Playwright code, and CmdRunner JSON are all derived from it. | If anything else becomes authoritative, regeneration breaks and the system decays into "generated code that humans maintain by hand." |
| **X2** | Source Artifacts are immutable. Re-interpretation produces a new ATC version, not a mutated source. | Without this, provenance is unreliable and regeneration from original sources is impossible. |
| **X3** | Steps reference Elements by stable ID, never by logical name or selector. | Name changes would orphan steps; selector changes would make steps brittle. ID references are stable. |
| **X4** | Test Runs reference a specific ATC version, never the live ATC. | Without version pinning, historical run reports become meaningless when the ATC changes. |
| **X5** | Environment Profiles are snapshotted into Test Runs at run time. | Without snapshots, historical runs report against whatever the profile currently says, not what it said when the run happened. |
| **X6** | Execution IR is always regenerable from (ATC version + Element Repository) and is never authoritative. | If IR becomes authoritative, you have two sources of truth and no way to know which is canonical. |
| **X7** | Evidence (screenshots, DOM, logs) belongs exclusively to Test Runs, never to test case definitions. | Mixing definition and observation breaks versioning and makes the definition mutate on every run. |
| **X8** | Elements belong to exactly one Project. There is no cross-project element sharing in V1. | Prevents naming collisions and unauthorized cross-tenant access. |
| **X9** | The ATC's status workflow gates execution: only `approved` test cases can be included in runs. | Prevents executing draft or deprecated tests in production pipelines. |

---

## 5. Ownership Model

Each entity is owned by exactly one **context** (system of record). Other contexts may read the entity but must not modify it outside its owning context's write paths.

| Context | Owns (system of record) | Reads from other contexts |
|---------|------------------------|--------------------------|
| **Authoring** | Source Artifacts | (writes ATC versions through AI review, but the version is owned by Repository) |
| **Repository** | Approved Test Cases (+ Versions), Element Repository, Test Data, Project | Reads Source Artifacts (for regeneration) |
| **Composition** | Test Suites | Reads ATCs (membership resolution), Environment Profiles |
| **Execution** | Test Runs, Step Results, Evidence, Environment Profiles | Reads ATC versions (pinned), Element Repository (for IR), Test Data (for run setup) |
| **Generation** | Execution IR (as derived artifact) | Reads ATC versions, Element Repository |

**Key rule:** If a context needs to change data owned by another context, it must go through that context's API/write path. Direct cross-context database writes are prohibited.

---

## 6. Versioning Strategy Summary

| Entity | Versioned? | Strategy | Rationale |
|--------|-----------|----------|-----------|
| Project | No | In-place updates | Metadata only; no behavioral impact |
| Approved Test Case | **Yes** | Immutable versions per step change | Behavioral changes must be tracked for audit, run pinning, and regeneration |
| ATC Metadata (title, tags) | No | In-place updates with change log `[future]` | Organizational changes don't affect execution behavior |
| Source Artifact | No | Immutable from creation | Immutability replaces versioning |
| Element Repository | No (V1) | In-place updates with `updatedAt` | Locator changes tracked by timestamp; full versioning deferred |
| Element Repository | `[future]` Yes | `healHistory` + versioned locators | Self-healing requires locator change history |
| Test Data | No (V1) | In-place updates | Snapshot at run time `[future]` for reproducibility |
| Test Suite | No | In-place updates; run captures config | Membership resolved at run time; no need to version |
| Environment Profile | No (V1) | In-place; snapshotted into runs | Run-time snapshot provides reproducibility |
| Test Run | No | Immutable observation | Each run is unique; no versioning needed |
| Execution IR | No | Regenerated/replaced | Derived artifact; `generatorVersion` + `generatedAt` provide provenance |

**The two entities that must support versioning from day one:** Approved Test Case and Element Repository. ATC versioning is implemented in V1. Element versioning is deferred but the `healHistory` field and `updatedAt`/`lastHealedAt` timestamps provide the schema foundation. Retrofitting version history onto objects that have already been mutating in production is a migration nightmare — the schema is ready even if the logic is deferred.
