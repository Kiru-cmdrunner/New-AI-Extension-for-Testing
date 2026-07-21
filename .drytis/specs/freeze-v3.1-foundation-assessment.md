# CmdRunner Smart Recorder — Foundation Freeze & Product Assessment

**Version:** 3.1.4 (v2.0.0-alpha lineage, Click Interaction complete)
**Date:** 2026-07-14
**Status:** FROZEN — no code changes in this milestone

---

## Part 1 — What Has Been Built

### 1.1 Recording Session Lifecycle

**What it is:** The authoritative in-memory + persisted state machine that manages a recording session from Start to Save.

**What it does:** Tracks recording state (Ready → Recording → Stopped), captures Recording Context (starting URL/title/timestamp as metadata, not an event), stores all captured events and generated steps, and transparently persists everything to `chrome.storage.local` so the session survives MV3 service worker termination (~30s idle timeout).

**Why it exists:** Without a centralized session manager, every component (content scripts, service worker, side panel) would independently track state, leading to inconsistency. Chrome MV3 can kill the service worker at any time — without persistence + restore, a recording would vanish.

**Milestone introduced:** Milestone 0 — Recording Session Lifecycle (product design), implemented across Milestones 3 and 4.1.

**What depends on it:** Every interaction type (Click, future Text Entry, Dropdown, etc.) depends on the session's `addAction()` method. Navigation depends on `addNavigation()`. The side panel depends on session state for UI rendering. The review/save workflow depends on the steps array.

---

### 1.2 Recording Context

**What it is:** Session metadata that records where the user was when they pressed Start Recording.

**What it does:** Captures `startUrl`, `startTitle`, and `capturedAt` immediately when recording starts. Renders as the first item in the timeline (visually distinct — purple gradient card, 📍 icon, "Recording started on" label). Also appears as the first item in Test Steps and Review Generated Steps sections.

**Why it exists:** Without Recording Context, the first Navigation event appears to be the beginning of the recording — making it look like the recording started on the destination page. Recording Context establishes the true origin point as metadata, not as an interaction. A QA engineer reviewing the test needs to know "where did this workflow begin?"

**Milestone introduced:** Milestone 0 (design), implemented in Milestone 4.1 (Correction 1), display fixed in v3.1.2 (moved into timeline as first item).

**What depends on it:** Timeline rendering, Test Steps rendering, Review rendering. Future playback/export will need Recording Context to set the initial page.

---

### 1.3 Navigation Handling

**What it is:** Automatic capture of page navigations (full URL changes in the top frame).

**What it does:** Listens to `chrome.webNavigation.onCommitted`, filters to top-frame HTTP/HTTPS only, deduplicates consecutive same-URL navigations, creates a `NavigationEvent` with timestamp, captures a screenshot (500ms delay for render), and builds a navigation `TestStep` ("Navigate to ...").

**Why it exists:** A workflow without page transitions is ambiguous for playback. If a test clicks "Book Flight" and then clicks a dropdown, the playback engine needs to know that a page transition happened between those actions — otherwise it will try to find the dropdown on the wrong page.

**Milestone introduced:** Milestone 2 (initial), Milestone 4.1 Correction 2 (added TestStep generation).

**What depends on it:** Timeline chronology, step chronology, playback/export.

---

### 1.4 Click Interaction

**What it is:** The first interaction type, built from first principles with a frozen product spec and frozen architecture.

**What it does:** Detects genuine user clicks (isTrusted, left button) via capture-phase listener. Resolves the click target through `composedPath()` (crosses Shadow DOM), checks ownership (`data-cmdrunner-handled`), extracts a complete element identity snapshot (16 fields), deduplicates double-clicks via 300ms identity-key holding window, and sends a `CLICK_CAPTURED` message to the service worker with the identity payload.

**Why it exists:** Click is the most fundamental browser interaction — every web workflow involves clicking. It serves as the template for all future interaction types: detection strategy, identity extraction, ownership model, dedup, classification.

**Milestone introduced:** Milestone 1 (product spec), Milestone 2 (architecture), Milestone 3 (implementation), Milestone 4 (validation + corrections).

**What depends on it:** The interaction-types registry pattern. The step builder. The AI understanding pipeline. Future interaction types follow the same `addToSession → capture → understand → buildStep → addStep` pipeline.

---

### 1.5 Interaction Pipeline

**What it is:** The standardized 9-stage flow that every interaction passes through from user action to stored test step.

**What it does:**

```
User Intent → Detection → Validation → Classification → Plain English → Execution JSON → Timeline → Review → Save
```

In implementation terms:

```
1. Content script detects user action (e.g., click event)
2. Target resolution (composedPath, INTERACTIVE_SELECTOR)
3. Ownership check (data-cmdrunner-handled)
4. Identity extraction (16-field snapshot)
5. Dedup (identity-key holding window)
6. Classification → CLICK_CAPTURED message sent
7. Service worker: addAction → capture screenshot → AI understand → buildStep → addStep
8. Storage persistence → chrome.storage.onChanged → side panel re-renders
9. Timeline, Test Steps, Screenshots update live
```

**Why it exists:** Principle 8 — "Can I confidently classify the user's intent? If NO, record nothing." The pipeline ensures every interaction goes through the same validation, classification, and enrichment steps. Only classified actions become steps. This prevents false positives and ensures consistency.

**Milestone introduced:** Milestone 0 (pipeline contract), Milestone 2 (architecture: 9 principles).

**What depends on it:** Every future interaction type. The registry pattern means each type only customizes detection + plain English + execution extras — the pipeline is shared.

---

### 1.6 Interaction Types Registry

**What it is:** A registry pattern that allows interaction types to be added without modifying the pipeline.

**What it does:** Each type registers an `InteractionTypeConfig` with: actionType, idPrefix, badgeColor, badgeLabel, buildPrompt (AI prompt), toPlainEnglish (human description), renderTitle (timeline title), executionExtras (type-specific JSON fields), addToSession (session integration).

**Why it exists:** Without the registry, the pipeline would have if/else branching for every interaction type — unmaintainable. The registry means adding "Text Entry" is a matter of writing a config and a content script — zero changes to the pipeline.

**Milestone introduced:** Milestone 3 (implemented as part of Click), originally designed in the interaction-registry spec.

**What depends on it:** All future interaction types.

---

### 1.7 Step Builder & Execution JSON

**What it is:** Transforms captured events into executable test steps with locators.

**What it does:** Builds a `TestStep` with: stepId, plainEnglish description, actionId, elementId, executionJson (action type, primary locator + fallbacks, tag, accessibleName, ariaRole, iframe/shadow context), aiConfidence score, timestamp. Locator priority: testId → data-cy → data-qa → id → aria-label → name → CSS → XPath.

**Why it exists:** A captured event is raw data. A test step is an executable instruction. The step builder bridges the gap — combining identity data, AI understanding, and locator strategy into a single self-contained instruction that a playback engine can execute.

**Milestone introduced:** Milestone 6 (step builder), refined in Milestone 3.

**What depends on it:** Review section display, repository save, future playback/export.

---

### 1.8 AI Understanding Layer

**What it is:** A provider-agnostic AI enrichment service.

**What it does:** Takes element info, sends a prompt to the configured AI provider (Gemini, OpenAI, Claude, OpenRouter, Azure OpenAI, or Custom), parses the response into `{ businessName, controlType, userIntent, confidenceScore }`, and attaches it to the event and step.

**Why it exists:** Raw DOM data ("BUTTON tag, role=button, text='Submit'") is readable but not insightful. AI enrichment turns it into "Login Button — Submit the login form (95% confidence)". This makes generated tests self-documenting.

**Milestone introduced:** Milestone 3 (AI provider connection), Milestone 4 (click understanding), expanded to 6 providers.

**What depends on it:** Plain English quality, timeline AI cards, confidence scoring.

---

### 1.9 Repository Integration

**What it is:** A structured test case repository with Project → Feature → Scenario → TestCase hierarchy.

**What it does:** After recording, the user reviews steps and saves them into the repository. The save form has cascading dropdowns with inline "Create New" at each level. Saved test cases are immutable deep copies — the original session data is not modified. A separate repository browser page allows search, rename, and delete.

**Why it exists:** Without persistence, recordings are ephemeral. The repository transforms the extension from a recorder into a persistent QA tool. The hierarchy mirrors how QA teams organize tests: by project, by feature area, by test scenario.

**Milestone introduced:** Milestone 7 (test repository).

**What depends on it:** Save workflow, repository browser page. Future export to Playwright/Cucumber will read from the repository.

---

### 1.10 Screenshot Service

**What it is:** Fire-and-forget visual capture at each interaction point.

**What it does:** Calls `chrome.tabs.captureVisibleTab` after each action to capture a screenshot. Stores metadata (screenshotId, actionId, elementId, actionType, timestamp, base64 dataUrl). Never blocks the pipeline — capture failures are silently caught.

**Why it exists:** Screenshots provide visual context for review. Future AI Vision analysis can use them to verify element state, detect visual regressions, and provide richer understanding.

**Milestone introduced:** Milestone 5 (initial), integrated into pipeline in Milestone 3.

**What depends on it:** Side panel screenshot grid, future AI Vision features.

---

### 1.11 Settings & Provider Management

**What it is:** A settings page with provider-agnostic AI configuration.

**What it does:** Allows the user to select an AI provider, enter API key, choose model, test connection, and view capabilities. Six providers supported: Gemini, OpenAI, Claude, OpenRouter, Azure OpenAI, Custom (OpenAI-compatible).

**Why it exists:** Different teams use different AI providers. The provider manager abstracts the differences so the recording engine only interacts with `AIService`.

**Milestone introduced:** Milestone 3 (AI provider connection), expanded to 6 providers.

**What depends on it:** AI understanding layer.

---

### 1.12 Architecture Principles (9 Frozen Principles)

From the frozen Milestone 2 Click Architecture:

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | Identity stored, not Element reference | DOM elements can be detached by virtual DOM frameworks — store immutable identity snapshots instead |
| 2 | Capture-phase listeners | Fire before application handlers to intercept actions reliably |
| 3 | composedPath() for Shadow DOM | `event.target` doesn't cross shadow boundaries; composedPath does |
| 4 | data-cmdrunner-handled ownership | Prevents multiple content scripts from claiming the same element |
| 5 | Capture identity early, process later | Extract all identity data at detection time, don't wait |
| 6 | Classified identity is immutable | Once an interaction is classified, its identity never changes |
| 7 | Record only interactions that actually occur | Don't infer or predict — capture what the user actually did |
| 8 | Confident classification or nothing | If you can't classify intent, record nothing (false positives are worse than false negatives) |
| 9 | Single responsibility | Each interaction type owns only itself — no cross-interaction logic |

---

## Part 2 — Current Product Assessment

### 2.1 What Happens From Opening the Extension Until Saving?

1. **User opens the side panel** — sees "Ready" status, empty timeline, Start Recording button.
2. **User configures AI provider** (one-time) — Settings page → select provider → enter API key → Test Connection → Save.
3. **User clicks Start Recording** — status changes to "Recording", Recording Context captured (starting URL), timeline shows 📍 context card.
4. **User interacts with the page** — clicks are captured by the content script, processed through the pipeline, displayed live in timeline + steps + screenshots. Navigations are captured automatically.
5. **User clicks Stop Recording** — status changes to "Stopped", Review Generated Steps section appears with all steps and execution JSON.
6. **User reviews steps** — each step shows stepId, confidence %, plain English, linked IDs, collapsible execution JSON.
7. **User saves** — cascading dropdowns (Project → Feature → Scenario) → enter test case name → Save.
8. **Success** — ✅ shown with "Record Another" or "Finish" options.

### 2.2 What Assumptions Does the Current Workflow Make?

| Assumption | Valid? | Risk |
|------------|--------|------|
| User has configured an AI provider before recording | Partially — recording works without AI but enrichment fails silently | Should surface a warning or prompt |
| User is recording in a single tab | Yes | Multi-tab recording not supported |
| Content script is injected before page scripts | Yes — `run_at: document_start` | Correct for MV3 |
| Navigation always means a full page load | Partially | SPA route changes (History API) may not trigger `webNavigation.onCommitted` |
| The side panel stays open during recording | Yes | If closed, recording continues but UI doesn't update |
| All clicks are genuine user actions | Yes — `isTrusted` check | Correct |

### 2.3 What Feels Complete?

| Component | Completeness | Why |
|-----------|-------------|-----|
| **Click detection + identity** | ✅ Complete | 78 tests covering Shadow DOM, iframes, SVG icons, nested spans, dedup, ownership |
| **Recording Context** | ✅ Complete | Captured, persisted, displayed in timeline + steps + review |
| **Session lifecycle** | ✅ Complete | Start/stop/persist/restore works, MV3-safe |
| **Repository hierarchy** | ✅ Complete | Full CRUD, search, save workflow, browser page |
| **AI provider management** | ✅ Complete | 6 providers, connection testing, capabilities declaration |
| **Storage model** | ✅ Complete | 7 storage keys, clean read/write, change listeners |
| **Step builder** | ✅ Complete | Locator priority, execution JSON, AI merge |
| **Screenshot capture** | ✅ Complete | Fire-and-forget, linked to events |

### 2.4 What Still Feels Temporary?

| Component | Why It Feels Temporary |
|-----------|----------------------|
| **Navigation handling** | SPA route changes (History API pushState/replaceState) may not be captured — only `webNavigation.onCommitted` fires on full page loads. This is a known gap. |
| **Review workflow** | Review is read-only. User cannot edit plain English, reorder steps, delete steps, or add annotations. This is acceptable for v1 but will need to evolve. |
| **Plain English quality** | Click says "Click 'Round Trip'" — good. Navigation says "Navigate to https://..." — should say "Navigate to Flight Booking page" (title-based). |
| **No export** | Test cases live in the extension's storage. No Playwright/Cucumber/Jest export yet. |
| **No playback** | Recording captures intent but cannot replay it. |
| **SPA Navigation gap** | Modern SPAs (React Router, Vue Router, Angular Router) change the URL via History API without triggering `webNavigation.onCommitted`. These navigations are silently missed. |
| **No multi-tab** | Only the active tab is recorded. If the user opens a new tab during recording, those actions are lost. |
| **Screenshots are single-frame** | Only `captureVisibleTab` — no full-page or element-level screenshots. |

### 2.5 Product Workflows vs Interaction-Specific

| Category | Components |
|----------|-----------|
| **Product workflows (shared foundation)** | Recording Session Lifecycle, Recording Context, Navigation Handling, Interaction Pipeline, Step Builder, Repository, Side Panel UI, Storage Model, Screenshot Service, AI Service, Settings/Providers |
| **Interaction-specific** | Click content script (detection, target resolution, identity extraction, dedup), Click registry config (plain English, AI prompt, execution extras) |

### 2.6 What Should Never Change Again?

| Component | Why It's Stable |
|-----------|----------------|
| **9 Architecture Principles** | Frozen in Milestone 2. These are axiomatic — they define how all interactions work. |
| **Recording Session Lifecycle** | The state machine (Ready → Recording → Stopped) is fundamental. Future states (Review, Approved, Saved) extend it but don't change it. |
| **Recording Context** | Session metadata concept is frozen by Milestone 0. It's metadata, not an interaction. |
| **Interaction Pipeline** | The 9-stage pipeline is frozen by Milestone 0. All interaction types use it. |
| **Interaction Types Registry** | The registry pattern is the extensibility mechanism. New types register configs, don't modify the pipeline. |
| **Storage Model** | 7 keys cover all current needs. New interaction types add events/steps, not new storage keys. |
| **Element Identity Model** | 16-field RawElementIdentity is comprehensive — covers all locator strategies. |

### 2.7 What Is Likely to Change Before Version 1?

| Component | Expected Change | Why |
|-----------|----------------|-----|
| **Navigation handling** | Add SPA route detection (popstate, pushState, replaceState listeners) | Critical for React/Angular/Vue apps |
| **Review workflow** | Add step editing (edit plain English, delete step, reorder, annotate) | QA engineers need to refine generated steps before saving |
| **Plain English for Navigation** | Title-based ("Navigate to Flight Booking") instead of URL-based | More readable, matches user mental model |
| **Test Steps section naming** | May rename to "Generated Steps" or unify with Review | Currently split between "Test Steps" (live) and "Review Generated Steps" (after stop) |
| **Timeline section** | May rename from "Navigation Timeline" to "Interaction Timeline" | It now shows clicks + navigations, not just navigations |
| **Export pipeline** | Add Playwright/Cucumber/Jest export from saved test cases | Core value proposition for QA teams |
| **Extended lifecycle states** | Milestone 0 defined IDLE → STARTING → RECORDING → STOPPED → REVIEW → APPROVED → SAVED → IDLE | Currently only Ready/Recording/Stopped are implemented |

---

## Part 3 — The Next Layer of the Product

### 3.1 What Should Become the Next Product Foundation?

**Answer: The Recording Workflow as a cohesive product experience — not another interaction type.**

### 3.2 Why Not Build Text Entry Next?

Adding Text Entry, Dropdown, Checkbox, etc. would add more interaction types to a product that still has gaps in its core workflow. Specifically:

1. **Navigation is incomplete for modern apps.** SPA route changes are silently missed. If we add Text Entry before fixing Navigation, we'll have recordings that capture a click on "Search" but miss the page change that the search triggers — producing broken recordings.

2. **The Review experience is read-only.** A QA engineer who records 20 actions and finds one wrong click currently has no way to delete or edit that step. They must discard the entire recording and start over. This makes the product unusable for real-world workflows.

3. **The timeline and steps sections are ambiguously named.** "Navigation Timeline" shows clicks. "Test Steps" shows steps during recording. "Review Generated Steps" shows the same steps after stop. This confuses users.

4. **No validation before saving.** The user can save an empty recording or a recording with only navigations. There's no pre-save validation.

5. **The product has no concept of a "Recording Session" as a reviewable unit.** Steps are generated live during recording, but there's no structured "review phase" where the user can validate, edit, and approve before saving.

### 3.3 The Next Logical Milestone: Recording Workflow Foundation

**What it is:** Completing the product workflow that surrounds interactions — making the recorder usable end-to-end for real QA work.

**Why it's needed:** The recorder can currently capture clicks and navigations. But it cannot:
- Reliably capture navigation in SPA apps
- Let the user edit or refine recordings before saving
- Present a clear, unambiguous review of what was captured
- Validate that a recording is complete enough to save
- Differentiate between a draft recording and an approved test case

**Why it should come before more interaction types:** Adding Text Entry to a product with a broken review workflow is like installing a premium sound system in a car with no steering wheel. The individual feature works, but the product doesn't.

**How it will affect every future interaction:**
- Every new interaction type's output will flow through the same review/edit workflow
- SPA navigation detection will ensure the context for every interaction is correct
- Step editing will apply to all interaction types uniformly
- The validated save workflow ensures every saved test case is reviewable and correct

### 3.4 What the Recording Workflow Foundation Should Cover

From a QA engineer's perspective:

1. **Complete Navigation Capture** — SPA route changes (pushState, replaceState, popstate) in addition to full page loads. This is critical because most modern enterprise apps are SPAs.

2. **Review & Edit** — After Stop, before Save, the user should be able to:
   - Delete a captured step (false positive, accidental click)
   - Edit the plain English description
   - See a clear chronological list that includes Recording Context at the top

3. **Unified Timeline** — Rename "Navigation Timeline" to "Interaction Timeline" or "Recording Timeline" since it shows all interactions, not just navigations.

4. **Pre-Save Validation** — At minimum: warn if recording has zero interactions, warn if first interaction is a navigation without a Recording Context.

5. **Session as a Reviewable Unit** — The recording session should be presented as a complete, reviewable workflow — not just a live feed of events. After Stop, the entire session should be presented for review with edit capabilities.

---

## Part 4 — Product Evolution Roadmap

### Phase 1: Product Workflow Foundation (NEXT)

**Goal:** Make the recorder usable end-to-end for real QA work with Click + Navigation only.

```
Recording Workflow Foundation
  ├── SPA Navigation Detection (pushState/replaceState/popstate)
  ├── Review & Edit (delete step, edit plain English, reorder)
  ├── Unified UI (rename sections, clarify timeline vs steps)
  ├── Pre-Save Validation (empty recording warning, context check)
  └── Session as Reviewable Unit (structured review phase)
```

**Why first:** Without this, adding more interaction types produces recordings with gaps (missing SPA navigations) and no way to fix mistakes (read-only review). This is the foundation every future interaction plugs into.

---

### Phase 2: Interaction Engine

**Goal:** Add the remaining core browser interactions one at a time, each through the same pipeline.

```
Interaction Engine
  ├── Text Entry (input, textarea, contenteditable)
  ├── Dropdown / Select
  ├── Checkbox
  ├── Radio Button
  ├── Toggle / Switch
  └── Keyboard (Enter, Escape, Tab)
```

**Why second:** Once the product workflow is solid (reliable navigation, editable review, validated save), each new interaction type is a clean, self-contained addition. The registry pattern means each type is: one content script + one registry config. No pipeline changes.

---

### Phase 3: Review Workflow

**Goal:** Transform review from read-only display into a full QA review experience.

```
Review Workflow
  ├── Step Annotations (add notes, mark as assertion point)
  ├── Step Reordering (drag to reorder)
  ├── Bulk Actions (delete multiple, re-run AI)
  ├── Review State Machine (REVIEW → APPROVED → SAVED)
  └── Recording Metadata (duration, interaction count, page coverage)
```

**Why third:** After multiple interaction types are available, the recordings become richer and longer. A 30-step recording needs robust review tools. This phase makes the product suitable for professional QA teams.

---

### Phase 4: Execution Models

**Goal:** Define how recorded steps translate to executable test scripts.

```
Execution Models
  ├── Execution Strategy per Interaction Type
  ├── Page Object Model generation
  ├── Selector Strategy (smart locator resolution)
  ├── Wait Strategy (implicit/explicit waits)
  └── Assertion Framework (what to verify at each step)
```

**Why fourth:** Before exporting, we need to define what "executing" a step means — how to wait for elements, how to resolve locators at runtime, how to structure assertions. This is the bridge between recording and runnable tests.

---

### Phase 5: Playwright Export

**Goal:** Generate runnable Playwright test scripts from saved test cases.

```
Playwright Export
  ├── TypeScript Playwright test file generation
  ├── Page Object Model structure
  ├── test.describe / test() scaffolding
  ├── Selector resolution (testId → data-cy → CSS)
  └── Runnable out of the box (npm test)
```

**Why fifth:** This is the moment the recorder becomes a complete product: record → review → export → run. QA engineers get executable tests without writing code.

---

### Phase 6: Suite Generation

**Goal:** Generate organized test suites from multiple recordings.

```
Suite Generation
  ├── Test Suite grouping (by feature, by scenario)
  ├── Shared setup/teardown (login, navigation, data setup)
  ├── Data-driven testing (parameterized test cases)
  ├── Test coverage reporting
  └── CI/CD integration hooks
```

**Why sixth:** Once individual tests can be exported, the next need is organizing them into suites that mirror real QA workflows — with shared setup, teardown, data-driven parameters, and CI integration.

---

### Visual Roadmap

```
Phase 1: Product Workflow Foundation    ← WE ARE HERE (next)
  │   Make the recorder usable end-to-end
  │   with Click + Navigation only.
  │
  ▼
Phase 2: Interaction Engine
  │   Add Text Entry, Dropdown, Checkbox,
  │   Radio, Toggle, Keyboard.
  │
  ▼
Phase 3: Review Workflow
  │   Full QA review experience:
  │   annotate, reorder, approve.
  │
  ▼
Phase 4: Execution Models
  │   Define how steps become executable:
  │   waits, selectors, assertions.
  │
  ▼
Phase 5: Playwright Export
  │   Generate runnable test scripts.
  │
  ▼
Phase 6: Suite Generation
      Organize tests into suites with
      shared setup, data-driven params,
      and CI/CD integration.
```

---

## Part 5 — Freeze Declaration

### What Is Frozen

The following components are declared frozen as of v3.1.4. They should not be modified unless a critical bug is found:

| # | Component | Version Frozen |
|---|-----------|---------------|
| 1 | 9 Architecture Principles | Milestone 2 (v3.0.0) |
| 2 | Recording Session Lifecycle (Ready → Recording → Stopped) | Milestone 0 (v3.0.0) |
| 3 | Recording Context concept + display | v3.1.2 |
| 4 | Interaction Pipeline (9-stage) | Milestone 0 (v3.0.0) |
| 5 | Interaction Types Registry pattern | Milestone 3 (v3.0.0) |
| 6 | Click Interaction (detection, identity, dedup, ownership) | Milestone 3 (v3.0.0) |
| 7 | Storage Model (7 keys) | v3.0.0 |
| 8 | Element Identity Model (16 fields) | Milestone 3 (v3.0.0) |
| 9 | Step Builder & Locator Priority | Milestone 6 (v3.0.0) |
| 10 | Repository Hierarchy (Project → Feature → Scenario → TestCase) | Milestone 7 (v3.0.0) |
| 11 | AI Provider Management (6 providers) | v3.0.0 |
| 12 | Screenshot Service | v3.0.0 |

### What Remains Flexible

| Component | What May Change |
|-----------|----------------|
| Side Panel UI | Section names, layout, new sections (edit, annotate) |
| Navigation handling | Add SPA route detection |
| Review workflow | Add editing, deletion, reordering |
| Plain English generation | Improve wording, add context |
| Test suite display | Add metadata, coverage info |
| Timeline section name | Rename from "Navigation Timeline" |

### Version Snapshot

- **Current version:** 3.1.4
- **Git commit:** 75eda2e
- **Tag:** v3.1.4
- **Tests:** 268 passing (14 files)
- **Build:** Succeeds
- **Extension type:** Chrome MV3 Extension
- **Content scripts:** 1 (click-content-script.ts)
- **Interaction types:** 1 (click)
- **AI providers:** 6

---

## Summary

The CmdRunner Smart Recorder has successfully completed the transition from v1.x (enterprise-first, many interactions, unstable) to v2.x+ (first-principles, one interaction done right, stable foundation).

The recorder can now:
- ✅ Capture genuine clicks across Shadow DOM, iframes, SVG icons, nested spans
- ✅ Extract comprehensive element identity (16 fields, 8 locator strategies)
- ✅ Enrich interactions with AI understanding (6 providers)
- ✅ Track recording context and navigation chronology
- ✅ Generate execution-ready test steps with plain English descriptions
- ✅ Save into a structured test repository
- ✅ Survive MV3 service worker termination via persistence

The next step is not another interaction type — it is completing the **product workflow** that makes the recorder usable for real QA work. SPA navigation, editable review, and validated save are the missing pieces before adding Text Entry, Dropdown, and the rest of the interaction engine.
