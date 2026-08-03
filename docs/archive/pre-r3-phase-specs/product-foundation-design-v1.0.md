# CmdRunner Product Foundation Design — Recording Workflow v1.0

**Status:** APPROVED PRODUCT DIRECTION — Frozen
**Date:** 2026-07-14
**Type:** Product Design (no implementation, no architecture, no code)

---

## 0. Product Identity

### CmdRunner is a Test Case Generation Platform.

Recording user interactions is a capability of the platform — not the product itself.

The product revolves around **Test Cases**. Every feature — recording, reviewing, approving, exporting — exists to produce, refine, and manage Test Cases.

A recording is temporary. A Test Case is permanent.

---

## 1. Complete User Journey

```
Home
  │
  │  User clicks "New Test Case"
  ▼
New Test Case — Enter Details
  │
  │  • Project (select or create)
  │  • Feature (select or create)
  │  • Scenario (select or create)
  │  • Test Case Name (required)
  │  • Expected Result (optional)
  │
  │  User clicks "Start Recording"
  ▼
Recording
  │
  │  • Recording Context captured (starting URL, page title, timestamp)
  │  • User performs actions on the target web application
  │  • Each interaction captured in real time
  │  • Interaction Timeline updates live
  │  • Screenshots captured per interaction
  │
  │  User clicks "Stop Recording"
  ▼
Interaction Timeline
  │
  │  • Complete chronological view of all captured interactions
  │  • Recording Context shown as session header
  │  • Every interaction listed with: action type, element name, timestamp
  │  • User can scroll through the full recording
  │
  │  System generates from the timeline:
  ▼
Canonical Test Steps + CmdRunner Execution JSON
  │
  │  • Raw interactions transformed into structured test steps
  │  • Each step has: plain English, action type, locator strategy,
  │    element identity, AI enrichment
  │  • Execution JSON: machine-readable representation of each step
  │  • This pair becomes the single source of truth
  │
  │  System generates from the canonical steps:
  ▼
Generated Playwright Test
  │
  │  • One Playwright test() for the entire Test Case
  │  • Generated from the canonical steps, not from raw events
  │  • Includes: page navigation, click actions, assertions, waits
  │  • Runnable out of the box
  │
  ▼
Review & Edit
  │
  │  • User reviews all three representations:
  │     1. Interaction Timeline (what happened)
  │     2. Canonical Test Steps + Execution JSON (what it means)
  │     3. Generated Playwright Test (how it executes)
  │
  │  • User can:
  │     - Delete steps (remove false positives)
  │     - Edit plain English descriptions
  │     - Edit Generated Playwright Test
  │     - Review AI enrichment
  │
  │  User clicks "Approve Test Case"
  ▼
Approve Test Case
  │
  │  • Test Case marked as approved
  │  • All artifacts frozen at approval point
  │  • Canonical steps locked as the source of truth
  │
  ▼
Save to Repository
  │
  │  Test Case saved into the repository hierarchy:
  │
  │  Project
  │    └── Feature
  │          └── Scenario
  │                └── Test Case
  │                      ├── Metadata
  │                      ├── Recording Context
  │                      ├── Interaction Timeline
  │                      ├── Canonical Test Steps
  │                      ├── CmdRunner Execution JSON
  │                      ├── Generated Playwright Test
  │                      └── Screenshots / Evidence (Future)
  │
  ▼
Home (Test Case saved)
```

### Future Capabilities (not in v1.0 scope)

```
Generate Playwright Test Suite
  │
  │  • Automatically combine all approved Test Cases
  │    within a Project into a complete suite
  │  • Shared setup/teardown, describe blocks
  │
  ▼
Export Complete Playwright Project
  │
  │  • Configuration files (playwright.config.ts)
  │  • All generated test files
  │  • Page Object Models (if applicable)
  │  • Package.json with dependencies
  │  • Runnable: npm install && npx playwright test
```

---

## 2. Test Case Lifecycle

### 2.1 Lifecycle States

```
DRAFT → RECORDED → GENERATED → UNDER_REVIEW → APPROVED → SAVED
```

| State | Meaning | What Exists |
|-------|---------|-------------|
| **DRAFT** | Test Case created, details entered, not yet recorded | Metadata only (name, project, feature, scenario, expected result) |
| **RECORDED** | Recording complete, raw interactions captured | Metadata + Recording Context + Interaction Timeline |
| **GENERATED** | Canonical steps + Execution JSON + Playwright Test auto-generated from timeline | All above + Canonical Steps + Execution JSON + Playwright Test |
| **UNDER_REVIEW** | User is reviewing and editing the generated artifacts | All above — editable |
| **APPROVED** | User has approved the Test Case | All above — frozen |
| **SAVED** | Test Case persisted to Repository | All above — immutable |

### 2.2 When Does a Test Case Come Into Existence?

A Test Case comes into existence **before recording begins**. The user creates a Test Case, enters its details, and then starts recording within that context.

This is a fundamental shift from the current implementation, where the Test Case is an afterthought — created at save time after recording is complete.

### 2.3 What Information Should Be Collected Before Recording?

**Mandatory:**

| Field | Why | Source |
|-------|-----|--------|
| **Test Case Name** | Identifies the test case. Without a name, there is no test case. | User input |
| **Project** | Every test case belongs to a project. Establishes scope. | Select existing or create new |
| **Feature** | Every test case belongs to a feature within a project. Establishes area. | Select existing or create new |
| **Scenario** | Every test case belongs to a scenario within a feature. Establishes context. | Select existing or create new |

**Optional:**

| Field | Why | Default |
|-------|-----|---------|
| **Expected Result** | Captures the tester's intent before recording. Becomes the assertion basis for generated tests. | Empty — can be added during review |
| **Description / Notes** | Free-form context for the tester. | Empty |
| **Tags** | Future classification and filtering. | Empty |

### 2.4 Should the User Be Allowed to Start Recording With Incomplete Information?

**No.** The four mandatory fields (Test Case Name, Project, Feature, Scenario) must be completed before recording can begin. This ensures:

1. Every recording has a clear purpose and destination.
2. The Test Case exists as a container before interactions are captured.
3. After Stop, the system knows exactly where to save — no decision fatigue at review time.
4. The tester thinks about what they're testing before they start testing.

The Expected Result is optional at creation time because the tester may not know the exact expected result until after interacting with the application. It can be added during review.

---

## 3. Recording Workflow

### 3.1 What Happens When Start Recording Is Pressed?

1. **The Test Case already exists** (created in Stage 1 with its metadata).
2. Recording Context is captured immediately: starting URL, page title, timestamp.
3. Recording Context is **session metadata** — it establishes where the recording began. It is not an interaction.
4. The content script is injected (already present for Click).
5. The user sees: Recording status, Recording Context card, empty Interaction Timeline.
6. Every subsequent user action is captured as an interaction.

### 3.2 What Should the User See While Recording?

| UI Element | Purpose | Updates |
|------------|---------|---------|
| **Recording Status** | Confirms recording is active | Static during recording |
| **Recording Context** | Shows starting URL and page title | Set once at start |
| **Interaction Timeline** | Live chronological feed of captured interactions | Updates per interaction |
| **Screenshot thumbnails** | Visual evidence of each interaction | Updates per interaction |

The user should **not** see generated steps, execution JSON, or Playwright output during recording. These are generated **after** Stop. During recording, the focus is on capturing — not analyzing.

### 3.3 What Belongs to Recording Context?

| Field | Captured At | Purpose |
|-------|------------|---------|
| **Start URL** | Moment of Start Recording | Establishes the starting page for playback |
| **Page Title** | Moment of Start Recording | Human-readable starting context |
| **Timestamp** | Moment of Start Recording | When the recording began |
| **Tab ID** | Moment of Start Recording | Which tab is being recorded (future: multi-tab) |

Recording Context is immutable once captured. It is never replaced by subsequent navigations.

### 3.4 What Is an Interaction?

An interaction is **a single deliberate user action on a web page that advances a workflow**.

| Is an Interaction | Is NOT an Interaction |
|---|---|
| Click on a button | Mouse hover (unless it reveals content — future Hover type) |
| Click on a link | Page scroll |
| Navigation to a new page | Window resize |
| Text entry into a field (future) | Focus/blur events |
| Selecting from a dropdown (future) | Tab key navigation |
| Checking a checkbox (future) | Mouse movement |
| Pressing Enter to submit (future) | Idle time / pauses |

The principle: **An interaction must be a deliberate, observable user action that changes application state or navigates to new content.**

### 3.5 How Should the Interaction Timeline Behave?

**During Recording:**
- Shows Recording Context as the first item (session header, not numbered)
- Each interaction appears immediately when captured
- Interactions are numbered sequentially: `click-0001`, `nav-0001`, `click-0002`
- Each shows: action badge, element name, timestamp
- Auto-scrolls to the latest interaction

**After Stop (Review):**
- The same timeline remains visible
- But now it is one of three synchronized views:
  1. Interaction Timeline (what happened)
  2. Canonical Test Steps (what it means)
  3. Generated Playwright Test (how it executes)

---

## 4. Review Workflow

### 4.1 What Happens After Stop Recording?

1. **System generates three artifacts** from the raw recording:
   - **Canonical Test Steps** — plain English steps with action type and locator strategy
   - **CmdRunner Execution JSON** — machine-readable representation of each step
   - **Generated Playwright Test** — one `test()` for the entire Test Case

2. **All three are presented for review.** The user sees the complete picture: what they did, what it means, and how it will execute.

3. **The Test Case enters UNDER_REVIEW state.**

### 4.2 What Should the User Review?

The review screen presents three synchronized views:

#### View 1 — Interaction Timeline
- Complete chronological list of captured interactions
- Recording Context as header
- Each interaction: badge, element name, timestamp
- **Purpose:** Verify that the right interactions were captured

#### View 2 — Canonical Test Steps + Execution JSON
- One step per interaction (plus navigation steps)
- Each step: step number, plain English, confidence score, element details
- Execution JSON per step: action, locator strategy, element identity
- **Purpose:** Verify that interactions were correctly interpreted

#### View 3 — Generated Playwright Test
- Complete TypeScript Playwright test file
- One `test()` for the entire Test Case
- Includes: imports, page navigation, actions, assertions
- **Purpose:** Verify that the generated code is correct and runnable

### 4.3 What Should Be Editable?

| Artifact | Editable? | What Can Be Edited |
|----------|-----------|-------------------|
| **Recording Context** | ❌ Immutable | Session metadata — cannot change where recording started |
| **Interaction Timeline** | Delete only | User can delete false positive interactions (e.g., accidental clicks). Cannot add interactions. |
| **Canonical Test Steps** | ✅ Editable | Plain English text, step ordering (via timeline deletion), Expected Result assertion |
| **Execution JSON** | ❌ Auto-managed | Derived from canonical steps. Regenerates if steps change. |
| **Generated Playwright Test** | ✅ Editable | Full text editing. User can modify generated code. |
| **Expected Result** | ✅ Editable | Can be set or refined during review |

**Key rule:** When the user edits the Canonical Test Steps (deletes a step, edits plain English), the Execution JSON and Generated Playwright Test should regenerate to reflect the changes. When the user edits the Playwright Test directly, the canonical steps remain the source of truth — the Playwright edit is an override.

### 4.4 What Should Remain Immutable?

| Item | Why Immutable |
|------|---------------|
| Recording Context | It's factual metadata — the recording started where it started |
| Raw interaction data (element identity, locators) | These are extracted from the DOM — factual data, not interpretation |
| Screenshots | Visual evidence — cannot be altered |
| Interaction order (within the timeline) | Chronological truth — actions happened in a specific sequence |

The user can **delete** interactions from the timeline (removing false positives), but cannot **reorder** them — the chronological order is immutable.

### 4.5 When Is the Recording Considered Approved?

The recording is considered approved when the user clicks **"Approve Test Case"**.

At that point:
- The Test Case moves to **APPROVED** state.
- All artifacts are frozen: canonical steps, execution JSON, Playwright test.
- The Test Case can no longer be edited (without starting a new recording or re-entering review).
- The Test Case is ready to be saved to the Repository.

**Approval requires at least one interaction.** If the timeline is empty (user started recording and stopped without any actions), approval is blocked with: "Cannot approve an empty Test Case. Record at least one interaction."

---

## 5. Repository Workflow

### 5.1 Repository Structure

```
Project
  └── Feature
        └── Scenario
              └── Test Case
                    ├── Metadata
                    │     ├── Test Case Name
                    │     ├── Expected Result
                    │     ├── Created At
                    │     ├── Approved At
                    │     ├── Approved By
                    │     ├── Tags
                    │     └── Status (Approved)
                    ├── Recording Context
                    │     ├── Start URL
                    │     ├── Page Title
                    │     └── Captured At
                    ├── Interaction Timeline
                    │     └── [Array of captured interactions in chronological order]
                    ├── Canonical Test Steps
                    │     └── [Array of structured test steps]
                    ├── CmdRunner Execution JSON
                    │     └── [Machine-readable step execution data]
                    ├── Generated Playwright Test
                    │     └── [Complete TypeScript Playwright test string]
                    └── Screenshots / Evidence (Future)
                          └── [Array of screenshot metadata + data]
```

### 5.2 What Belongs at Each Level?

| Level | Purpose | Contains |
|-------|---------|----------|
| **Project** | Top-level grouping for an application or product | Name, description, features |
| **Feature** | Functional area within a project | Name, description, scenarios |
| **Scenario** | A specific user workflow or test area | Name, description, test cases |
| **Test Case** | A single approved test | All artifacts listed above |

### 5.3 What Metadata Belongs to the Test Case?

| Field | Required | Set When | Purpose |
|-------|----------|----------|---------|
| Test Case Name | ✅ | Creation | Identity |
| Project | ✅ | Creation | Organization |
| Feature | ✅ | Creation | Organization |
| Scenario | ✅ | Creation | Organization |
| Expected Result | ❌ | Creation or Review | Assertion basis |
| Description / Notes | ❌ | Creation or Review | Context |
| Created At | ✅ | Creation (automatic) | Audit trail |
| Approved At | ✅ | Approval (automatic) | Audit trail |
| Status | ✅ | Approval (automatic) | Workflow state |
| Tags | ❌ | Creation or Review | Classification |

### 5.4 What Should Be Saved?

**Everything.** When a Test Case is saved to the Repository, the complete Test Case object is persisted:

- Metadata (name, dates, status, tags)
- Recording Context (start URL, title, timestamp)
- Interaction Timeline (full chronological record)
- Canonical Test Steps (plain English + action details)
- CmdRunner Execution JSON (machine-readable execution data)
- Generated Playwright Test (complete test string)
- Screenshots (future — not in v1.0)

The Repository stores the **complete, self-contained Test Case**. Everything needed to understand, execute, or re-export the test is in the repository. No external dependencies.

### 5.5 The Repository Is the Single Source of Truth

Every generated artifact (CmdRunner Execution JSON, Playwright Tests, and future execution formats) must be **derived from** the approved Test Case stored in the Repository.

- If the user needs a Cucumber export in the future, it is generated from the canonical steps in the Repository — not from a live recording.
- If the user needs to regenerate a Playwright test (e.g., after a framework update), it is regenerated from the canonical steps in the Repository.
- The Repository never holds partial or unapproved data.

---

## 6. Test Case Output Generation

### 6.1 Canonical Test Steps + Execution JSON

**What it is:** The framework-agnostic, machine-readable representation of the Test Case.

**When generated:** Automatically after Stop Recording, before Review.

**What it contains:**

Each Canonical Test Step:
```
{
  stepNumber: 1,
  actionType: "click" | "navigation" | "text_entry" | ...,
  plainEnglish: "Click 'Submit' button",
  elementIdentity: { tag, role, accessibleName, locators, ... },
  executionJson: { action, target, value, locator, ... },
  aiEnrichment: { businessName, controlType, userIntent, confidenceScore },
  screenshotId: "shot-0001",
  timestamp: "..."
}
```

**Role:** This is the **single source of truth** for the Test Case. All other outputs are derived from it.

### 6.2 Generated Playwright Test

**What it is:** A complete, runnable TypeScript Playwright test file generated from the canonical steps.

**When generated:** Automatically after the Canonical Test Steps are created, before Review.

**Structure:**

```typescript
import { test, expect } from '@playwright/test';

test('Book a one-way flight on Adani One', async ({ page }) => {
  // Recording Context
  await page.goto('https://www.adanione.com/');

  // Step 1: Click "Book Flight"
  await page.click('[data-testid="book-flight"]');

  // Step 2: Navigation to flight-booking
  await page.waitForURL('**/flight-booking');

  // Step 3: Click "One Way"
  await page.click('button:has-text("One Way")');

  // Step 4: Click "Complete Action Button"
  await page.click('#complete-action');

  // Expected Result assertion (if provided)
  // await expect(page).toHaveURL('**/confirmation');
});
```

**Rules:**
- One `test()` for the entire Test Case — not per step.
- The test name comes from the Test Case Name.
- Recording Context becomes the initial `page.goto()`.
- Each canonical step becomes one or more Playwright actions.
- Locators are resolved from the Execution JSON's locator priority.
- Comments mirror the plain English descriptions.
- Expected Result becomes a Playwright assertion (if provided).

### 6.3 When Should Each Output Be Generated?

| Output | When Generated | When Regenerated |
|--------|---------------|------------------|
| Canonical Test Steps | After Stop Recording | If user deletes a step from the timeline |
| Execution JSON | With Canonical Steps | Automatically when steps change |
| Playwright Test | After Canonical Steps | If canonical steps change AND user hasn't manually edited the Playwright test. If user has edited the Playwright test manually, a warning is shown: "Canonical steps have changed. Regenerate Playwright test? This will overwrite your edits." |

### 6.4 What Is the Canonical Representation?

**Canonical Test Steps + CmdRunner Execution JSON** is the canonical representation.

It is:
- **Framework-agnostic** — doesn't know about Playwright, Cypress, or Selenium
- **Self-contained** — includes all data needed to generate any output format
- **The source of truth** — all exports derive from it
- **Immutable after approval** — frozen when the Test Case is approved

Playwright is one consumer of the canonical representation. Future consumers (Cucumber, Cypress, Jest) will read the same canonical steps and produce their own output format.

---

## 7. Product Principles

### P1 — Test Case Centric
The product revolves around Test Cases. Every feature exists to produce, refine, or manage Test Cases. A recording is a means to create a Test Case — not the end product.

### P2 — Record First, Analyze Later
During recording, the user's focus is on interacting with the application. Analysis, step generation, and code export happen after Stop. The recording experience should be distraction-free.

### P3 — Single Source of Truth
Canonical Test Steps + Execution JSON is the single source of truth. All outputs are derived from it. The Repository holds the canonical version. No artifact exists outside the Repository that isn't derived from it.

### P4 — Framework Agnostic
CmdRunner's canonical representation knows nothing about Playwright, Cypress, or Selenium. Execution formats are generated from the canonical steps. This ensures the recorder remains useful regardless of the execution framework du jour.

### P5 — Approval Is a Gate
Only approved Test Cases are saved. Approval means the tester has reviewed the timeline, canonical steps, and generated code, and confirmed they are correct. No unreviewed data enters the Repository.

### P6 — Recording Is Temporary, Test Cases Are Permanent
A recording is raw, messy, and may contain false positives. A Test Case is reviewed, refined, and approved. The distinction matters: recordings can be discarded; Test Cases are preserved.

### P7 — Capture Intent, Not Events
The recorder captures what the user intended to do, not what the browser did. A click on a submit button is "Submit the form," not "fire a mousedown event on element #submit-btn." Plain English is the user-facing representation; DOM details are the machine-facing representation.

### P8 — Simplicity Over Options
Every screen should have a clear purpose. Avoid duplicate views. Avoid settings that don't change behavior. The tester should never wonder "what does this button do?"

### P9 — Every Screen Has One Job
- **New Test Case screen:** Collect test case details.
- **Recording screen:** Capture interactions.
- **Review screen:** Validate and edit generated artifacts.
- **Repository screen:** Browse and manage saved test cases.

No screen should try to do multiple jobs.

---

## 8. UX Recommendations

### 8.1 Home Screen

**Purpose:** Entry point. Show recent activity and provide the primary action.

**Content:**
- CmdRunner logo and name
- "New Test Case" button (primary, prominent)
- "Browse Repository" button (secondary)
- Recent Test Cases (last 5 saved, clickable to open)
- Status indicator (AI provider configured / not configured)

**Design:** Minimal. The tester's first action is almost always "New Test Case."

### 8.2 New Test Case Screen

**Purpose:** Collect test case metadata before recording.

**Layout:**
- Test Case Name (text input, required, prominent)
- Project (dropdown with inline "Create New")
- Feature (dropdown, cascading from Project, inline "Create New")
- Scenario (dropdown, cascading from Feature, inline "Create New")
- Expected Result (textarea, optional, placeholder: "What should happen after this test?")
- "Start Recording" button (disabled until required fields are complete)

**Design:** Compact, form-like. The goal is to get the user recording quickly. The form should not feel like paperwork — it should feel like setting up a focused recording session.

### 8.3 Recording Screen

**Purpose:** Capture interactions with minimal distraction.

**Layout:**
- Recording status (red dot, "Recording..." with elapsed time)
- Recording Context (📍 card: starting URL, page title)
- Interaction Timeline (live, auto-scrolling)
- Stop Recording button (prominent, accessible)

**Design:** Dark accent on recording status. Timeline should be scannable at a glance. No step details, no execution JSON, no code — those come later.

### 8.4 Review Screen

**Purpose:** Validate and edit generated artifacts before approval.

**Layout:**
- Three-tab or three-section view:
  1. **Interaction Timeline** (read-only except delete)
  2. **Canonical Test Steps** (editable: plain English, delete, expected result)
  3. **Generated Playwright Test** (editable: full code editor)
- Test Case metadata header (name, project/feature/scenario)
- "Approve Test Case" button (prominent)
- "Discard" button (secondary — discards the entire recording)

**Design:** Information-dense but organized. The three views should be switchable without losing context. Code editor for Playwright should have syntax highlighting.

### 8.5 Repository Screen

**Purpose:** Browse, search, and manage saved Test Cases.

**Layout:**
- Tree view: Project → Feature → Scenario → Test Case
- Search bar
- Per Test Case: name, status, approved date, interaction count
- Click a Test Case to view its full details (read-only)
- Future: "Generate Suite" and "Export" buttons at Project level

**Design:** File-explorer metaphor. Familiar to QA engineers who use test management tools.

---

## 9. Current State vs. Target State Gap Analysis

| Workflow Stage | Current State | Target State (v1.0) | Gap |
|----------------|--------------|---------------------|-----|
| Test Case Creation | ❌ Test Case created at save time | ✅ Test Case created before recording | **Major** — requires new screen + flow change |
| Recording | ✅ Click + Navigation captured | Same + improved UI | Minor — UI tweaks |
| Stop → Generate | ❌ Steps generated live during recording | ✅ Steps generated after Stop | **Medium** — generation timing change |
| Playwright Generation | ❌ Does not exist | ✅ Auto-generated after Stop | **Major** — new feature |
| Review & Edit | ❌ Read-only steps display | ✅ Editable steps + Playwright code editor | **Major** — new feature |
| Approve | ❌ Does not exist | ✅ Approval gate before save | **Major** — new state + workflow |
| Save to Repository | ✅ Cascading dropdowns at save time | ✅ Save pre-created Test Case (already placed in hierarchy) | Medium — simplified since hierarchy chosen upfront |
| Repository Storage | ✅ Steps + events + screenshots | ✅ Complete Test Case object (all artifacts) | **Medium** — expanded storage |

---

## 10. Suggested Implementation Roadmap

### Milestone A — Test Case Creation Flow (Product Foundation)

**Deliverable:** New Test Case creation screen before recording.

- Home screen with "New Test Case" entry point
- New Test Case form (name, project, feature, scenario, expected result)
- Cascading dropdowns with inline create
- Validation: required fields must be complete before Start Recording
- Test Case metadata persisted in session storage before recording begins

**Why first:** Everything downstream depends on the Test Case existing first. This is the single biggest workflow change.

---

### Milestone B — Post-Stop Generation Pipeline

**Deliverable:** Move step generation from live-during-recording to after-Stop.

- During recording: only Interaction Timeline + screenshots (live)
- After Stop: system generates Canonical Test Steps + Execution JSON
- Review screen replaces live steps display
- Recording Context remains as timeline header

**Why second:** The generation pipeline must produce all three artifacts (steps, JSON, Playwright) together after Stop. This is prerequisite for the review workflow.

---

### Milestone C — Playwright Test Generation

**Deliverable:** Automatic Playwright test generation from canonical steps.

- Playwright code generator (canonical steps → TypeScript test file)
- One `test()` per Test Case
- Locator resolution from Execution JSON
- Comments from plain English descriptions
- Recording Context → `page.goto()`
- Expected Result → assertion (if provided)
- Syntax-highlighted code view

**Why third:** The Playwright output is the primary value-add for QA teams. It's also needed for the review workflow (user needs to see and edit the generated code).

---

### Milestone D — Review & Edit Workflow

**Deliverable:** Full review screen with editing capabilities.

- Three-view layout: Timeline / Canonical Steps / Playwright Test
- Delete interaction from timeline (removes corresponding step)
- Edit plain English on canonical steps
- Edit Playwright test code directly
- Add/refine Expected Result
- Regeneration logic: if steps change, regenerate Execution JSON. If steps change and Playwright not manually edited, regenerate Playwright.
- Pre-approval validation: at least one interaction required

**Why fourth:** Review is where the tester validates quality. Without it, the product produces unreviewed output.

---

### Milestone E — Approval & Save

**Deliverable:** Approval gate and enhanced repository save.

- "Approve Test Case" button → APPROVED state
- All artifacts frozen at approval
- Save to Repository: persists complete Test Case object
- Repository stores: metadata, recording context, timeline, canonical steps, execution JSON, Playwright test, screenshots
- Success screen with "Record Another" / "View in Repository"

**Why fifth:** This completes the workflow from creation to saved, approved Test Case.

---

### Milestone F — Repository Enhancement

**Deliverable:** Enhanced repository browser.

- Tree view of Project → Feature → Scenario → Test Case
- Click Test Case to view full details (read-only)
- Show all artifacts: timeline, steps, JSON, Playwright test, screenshots
- Search and filter
- Future hooks: "Generate Suite" and "Export" buttons

**Why sixth:** Once Test Cases are being saved properly, the repository needs to present them comprehensively.

---

### Post-Foundation: Interaction Engine

Once the product workflow is frozen and implemented (Milestones A–F), the Interaction Engine resumes:

```
Text Entry → Dropdown → Checkbox → Radio → Toggle → Keyboard → ...
```

Each interaction type plugs into the frozen workflow with zero workflow changes — only a new content script + registry config.

---

## 11. Freeze Declaration

The following product workflow is declared **frozen** and must not be redesigned:

1. **User Journey:** Home → New Test Case → Enter Details → Start Recording → Record → Stop → Interaction Timeline → Canonical Steps + Execution JSON → Playwright Test → Review & Edit → Approve → Save to Repository.

2. **Test Case comes into existence before recording.**

3. **Recording Context is session metadata, captured at Start, never replaced.**

4. **Canonical Test Steps + Execution JSON is the single source of truth.**

5. **One Playwright test() per Test Case.**

6. **Only approved Test Cases are saved to the Repository.**

7. **The Repository stores the complete Test Case.**

8. **The Repository is the single source of truth for all approved Test Cases.**

9. **Canonical representation is framework-agnostic. Playwright is one export format.**

10. **Future: Playwright Test Suite generation from approved Test Cases within a Project.**

11. **Future: Complete Playwright project export.**

---

*This document defines the CmdRunner product foundation. All future development — interactions, exports, integrations — must conform to this workflow.*
