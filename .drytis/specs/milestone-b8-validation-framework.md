# Milestone B8 — Validation Framework & Test Plan

**Type:** Validation Planning (no implementation)
**Status:** FROZEN
**Date:** 2026-07-15
**Scope:** Defines the repeatable validation methodology for all future CmdRunner product validation.

---

## Table of Contents

1. [Validation Principles](#1-validation-principles)
2. [Workflow Coverage Matrix](#2-workflow-coverage-matrix)
3. [Validation Checklist](#3-validation-checklist)
4. [Pass / Fail Criteria](#4-pass--fail-criteria)
5. [Defect Classification Framework](#5-defect-classification-framework)
6. [Evidence Collection Standard](#6-evidence-collection-standard)
7. [Root Cause Analysis Template](#7-root-cause-analysis-template)
8. [Regression Strategy](#8-regression-strategy)
9. [Future Milestone Validation Process](#9-future-milestone-validation-process)

---

## 1. Validation Principles

### P1 — Validation Is Independent from Implementation

This framework defines **how CmdRunner is evaluated**. It does not define how defects are fixed. Validation and implementation are separate concerns.

### P2 — Evidence Before Reporting

No defect is reported without evidence. The minimum evidence set (§6) must be collected for every issue. A report that says "it didn't work" without evidence is not actionable.

### P3 — Classification Before Fixing

Every issue must be classified (§5) before a fix is attempted. Classification determines which product area is affected, which in turn determines which milestone or component handles the fix.

### P4 — Consistency Across Milestones

This framework is stable. The same categories, criteria, and evidence requirements apply whether validating Milestone B7.2 or Milestone Z10. This enables trend tracking — quality can be measured over time.

### P5 — Coverage Over Depth

Validating 15 workflow categories against 5 real applications is more valuable than validating 3 categories against 50 applications. The framework prioritizes **breadth of interaction types** over **depth of application count**.

### P6 — Recording Is the Foundation

Every downstream artifact (Canonical Steps, Execution JSON, Playwright) depends on accurate recording. If recording fails, every downstream comparison is meaningless. Recording validation always runs first.

### P7 — Execution Equivalence, Not Identity

When comparing optimized vs. unoptimized output, the criterion is **functional equivalence** — the generated test must reproduce the same user workflow. Minor cosmetic differences (comments, whitespace, timestamp values) are acceptable. Behavioral differences (different locators, missing actions, different execution order) are failures.

---

## 2. Workflow Coverage Matrix

### 2.1 Categories

Every future validation cycle must include at least one workflow from each category below. Categories marked **Critical** must always be covered; those marked **Extended** expand coverage for thorough validation.

| # | Category | Priority | Why It Matters | CmdRunner Capabilities Exercised |
|---|---|---|---|---|
| W1 | **Authentication** (login, logout, registration) | Critical | Most common workflow; exercises text entry, click, and navigation in sequence | Text recording, click recording, OR-1 merge, navigation capture, Playwright `.fill()` + `.click()` |
| W2 | **Search** (search box entry, submit, results) | Critical | Tests text entry + button click + dynamic content | Text recording, click recording, OR-1 merge, SPA route changes |
| W3 | **CRUD Operations** (create, read, update, delete) | Critical | Covers the full lifecycle of data operations; exercises forms, buttons, confirmation dialogs | Text recording, click recording, OR-1 merge, navigation, modal interaction |
| W4 | **Form Entry** (multi-field forms with validation) | Critical | Tests OR-1 across multiple fields; verifies each field remains a separate step | Text recording, OR-1 (multiple merges in sequence), OR-2 (no text-text merge) |
| W5 | **Tables and Filtering** (sort, filter, row interactions) | Critical | Exercises clicks on table elements, filter inputs, pagination | Click recording, text recording, OR-1 merge (filter inputs) |
| W6 | **Pagination** (next, previous, page number) | Extended | Tests repeated click patterns on similar elements | Click recording, locator uniqueness (multiple similar elements) |
| W7 | **File Upload** (file selection, upload trigger) | Extended | Tests whether file inputs are captured correctly | Click recording, text recording (if file path entry), element type detection |
| W8 | **Modal Dialogs** (open, fill, close) | Critical | Tests dynamically appearing elements | Click recording, text recording, OR-1 merge (form fields inside modals) |
| W9 | **Wizard/Stepper** (multi-step forms) | Critical | Tests workflows spanning multiple pages/steps; verifies steps across page boundaries are kept separate | Navigation capture, text recording, click recording, OR-1 merge (per page), adjacency enforcement (C3) |
| W10 | **Dropdowns and Autocomplete** (select, typeahead) | Critical | Tests SELECT elements and dynamic suggestion lists | Text recording, click recording, element type detection, OR-1 merge (SELECT) |
| W11 | **Date Pickers** (calendar widgets) | Extended | Tests custom component interaction; verifies C4 guard excludes non-standard elements | Click recording, C4 guard validation (date pickers are typically DIV-based) |
| W12 | **Navigation** (menus, breadcrumbs, tabs, SPA routes) | Critical | Tests that navigation clicks and SPA route changes are captured as distinct steps | Click recording, webNavigation capture, SPA route detection |
| W13 | **Dynamic SPAs** (React/Vue/Angular route changes) | Critical | Tests content script persistence across framework re-renders | Content script survival, checkRecording() async fallback, navigation capture |
| W14 | **Shadow DOM** (web components with shadow roots) | Extended | Tests composedPath() traversal and Shadow DOM element identity | Click capture via composedPath(), element identity extraction, Shadow DOM flag |
| W15 | **iFrames** (embedded content) | Extended | Tests iframe context capture and locator generation with frame prefix | Click capture in iframe, iframeContext field, Playwright `frameLocator()` |

### 2.2 Application Types

| # | Application Type | Priority | Examples | Why It Matters |
|---|---|---|---|---|
| A1 | **Enterprise HR/Admin** | Critical | OrangeHRM (Vue.js), ERP systems | Complex forms, role-based UI, standard HTML inputs |
| A2 | **E-Commerce** | Critical | Shopify stores, Amazon-like catalogs | Search, filtering, cart, checkout wizard, tables |
| A3 | **SaaS Dashboard** | Critical | Admin panels, analytics dashboards | SPA route changes, tables, charts, modals |
| A4 | **Content Management** | Extended | WordPress, Drupal | Rich text editors (boundary test for C4 guard), media upload |
| A5 | **Public-facing Site** | Extended | adanione.com, news sites | Navigation-heavy, complex DOM, performance under load |

### 2.3 Minimum Validation Set

A validation cycle is **complete** when:

- All **Critical** workflow categories (W1-W5, W8-W10, W12-W13) are tested — 10 categories minimum.
- At least **2 Critical application types** (A1-A3) are covered.
- At least **3 Extended** categories (from W6, W7, W11, W14, W15) are tested.
- Every workflow is evaluated across all 4 pipeline stages (Recording, Canonical Steps, Execution JSON, Playwright).

---

## 3. Validation Checklist

For every workflow, collect the following observations. This is a **per-workflow checklist** — each item is checked against the specific workflow being validated.

### 3.1 Recording Stage

| # | Check | What to Look For |
|---|---|---|
| R1 | All meaningful interactions captured | Every click on a button/link, every text entry, every navigation event appears in the Interaction Timeline |
| R2 | No unnecessary interactions | Hover events, focus shifts without text entry, and incidental clicks (e.g., clicking page background) are NOT captured |
| R3 | Interaction order preserved | Timeline events appear in the same order the user performed them |
| R4 | Element identity complete | Each event has a complete `ElementIdentity` (tag, accessibleName, cssSelector, xPath, name, stableId, etc.) |
| R5 | Text values captured | Text entry events carry the correct `value` field with the text the user entered |
| R5a | Text entry fires on blur | Text entry is captured once per field when the user moves focus away (not per keystroke) |
| R6 | Navigation events captured | Full URL navigations (webNavigation API) and SPA route changes are both captured |
| R7 | Recording Context visible | Timeline shows the 📍 Recording Context header (start URL, page title, timestamp) before any numbered interactions |
| R8 | Session scope correct | Only interactions in the recording tab are captured; other tabs are excluded |

### 3.2 Canonical Test Steps Stage

| # | Check | What to Look For |
|---|---|---|
| C1 | Steps accurately represent interactions | Each meaningful interaction has a corresponding Canonical Test Step |
| C2 | Plain English is readable | Step descriptions use clear, concise language: `Click "Login"`, `Enter "Admin" into "Username"` |
| C3 | OR-1 merge applied correctly | Focus-click + text-entry pairs on the same input element are merged into single steps |
| C4 | OR-1 correctly skipped | Focus clicks followed by different-element text entry, non-adjacent pairs, and non-input clicks are NOT merged |
| C5 | OR-2 constraint respected | Consecutive text entries on different fields remain separate steps |
| C6 | Step numbers contiguous | After optimization, step numbers are 1, 2, 3... with no gaps |
| C7 | Step IDs preserved | Merged steps carry the text entry's stepId (permanent identity) |
| C8 | Navigation steps present | Navigation events appear as steps with actionType 'navigation' and 100% confidence |
| C9 | No unsafe optimization | No click+navigation merges, no business summaries, no reordering |

### 3.3 Execution JSON Stage

| # | Check | What to Look For |
|---|---|---|
| E1 | Contract compliance | JSON structure matches B5.2 contract: action, target, locators, context, trace, meta |
| E2 | Action type correct | Click → `action.type = "click"`, Text → `action.type = "fill"`, Navigation → `action.type = "navigate"` |
| E3 | Locator strategy appropriate | Primary locator follows B4.4 priority: testId > dataCy > dataQa > ariaLabel > id > name > text > placeholder > css > xpath |
| E4 | Auto-generated IDs rejected | React/MUI auto-generated IDs (e.g., `react-3.7.2.1`) are NOT used as locators |
| E5 | Fallback locators present | Each step has up to 3 locators (primary, secondary, fallback) |
| E6 | Fallback roles correct | First locator has `role: "primary"`, subsequent have `role: "secondary"` and `role: "fallback"` |
| E7 | Execution order preserved | Steps appear in recording order; no reordering |
| E8 | Value field correct | Text entry steps carry the entered value in `action.value` |
| E9 | Determinism | Same input timeline → identical Execution JSON (excluding timestamps) |
| E10 | Navigation context correct | Navigation steps have `target.kind = "navigation"` and carry the URL |
| E11 | iframe context captured | Steps inside iframes have `context.iframe` populated |
| E12 | Warning fields meaningful | `meta.warnings` contains only real warnings (e.g., "structural locator only") |

### 3.4 Playwright Stage

| # | Check | What to Look For |
|---|---|---|
| P1 | Valid TypeScript syntax | Generated code is syntactically valid Playwright TypeScript |
| P2 | Test structure correct | Import header, `test()` block, `page.goto()` for start URL, sequential steps |
| P3 | Locator usage follows Execution JSON | Primary locator used for selector; fallbacks as comments only |
| P4 | Action mapping correct | Click → `.click()`, Text → `.fill()`, Navigation → `page.goto()` |
| P5 | No unnecessary actions | Focus clicks removed by OR-1 do NOT appear as `.click()` before `.fill()` |
| P6 | Traceability comments present | Each step has `// Step N: [plain English]` comment |
| P7 | Fallback locator comments | Each step has `// Fallback locators: ...` comment |
| P8 | iframe handling correct | Steps inside iframes use `frameLocator()` prefix |
| P9 | Determinism | Same input → identical Playwright code (excluding timestamps) |
| P10 | Functional execution | **If executed against the real app**, the test reproduces the recorded workflow |
| P11 | No hardcoded URLs/credentials | Start URL comes from recordingContext; no literal test data in selectors |

---

## 4. Pass / Fail Criteria

### 4.1 Recording Stage

**PASS when ALL of:**
- Every meaningful user interaction (click, text entry, navigation) is captured in the Interaction Timeline.
- No unintended interactions are recorded (hovers, incidental clicks, non-recording-tab activity).
- Interaction order matches the user's actual action sequence.
- Element identities are complete (all fields populated from the DOM).
- Text entry values match what the user typed.
- Navigation events (both full URL and SPA route changes) are captured.

**FAIL when ANY of:**
- A meaningful interaction is missed (not captured in the timeline).
- An incorrect interaction is recorded (phantom click, wrong element identity).
- Interaction order in the timeline differs from the user's action sequence.
- Text entry value is empty or incorrect.
- Navigation event is missed (especially SPA route changes).

### 4.2 Canonical Test Steps Stage

**PASS when ALL of:**
- Steps accurately represent the recorded interactions (one step per meaningful action after optimization).
- Plain English descriptions are clear and concise.
- OR-1 merges are applied where conditions are met and skipped where conditions fail.
- OR-2 constraint is respected (no text-text merges).
- Unsafe optimizations are NOT applied (no click+navigation merges, no business summaries).
- Step IDs are preserved (merged steps carry primary action's stepId).
- Step numbers are contiguous after optimization.

**FAIL when ANY of:**
- A step changes meaning (actionType, elementIdentity, or value is altered by the optimizer).
- A deterministic optimization (OR-1) is missed where conditions are clearly met.
- An unsafe optimization is applied (e.g., merging across navigation boundaries).
- Step order changes from recording order.
- A step's plainEnglish does not match its action type (e.g., click step says "Enter").

### 4.3 Execution JSON Stage

**PASS when ALL of:**
- Every step's JSON satisfies the B5.2 contract (all six sections present, all validation rules pass).
- Locator selection follows the B4.4 priority hierarchy.
- Auto-generated IDs are correctly rejected.
- Execution order matches step order.
- The same input produces identical JSON (deterministic, excluding timestamps).
- iframe and Shadow DOM contexts are captured where applicable.

**FAIL when ANY of:**
- Contract validation fails (missing section, invalid field, wrong type).
- A lower-priority locator is selected when a higher-priority locator is available.
- An auto-generated ID passes through as a locator.
- Execution order differs from step order.
- The same input produces different JSON on repeated runs.

### 4.4 Playwright Stage

**PASS when ALL of: |
- Generated code is syntactically valid Playwright TypeScript.
- The test reproduces the recorded workflow: each recorded action maps to a Playwright statement.
- Primary locator is used for each selector; fallbacks are comments only.
- Action mapping is correct (click → `.click()`, text → `.fill()`, navigation → `page.goto()`).
- No unnecessary actions are present (OR-1-merged clicks do not appear).
- iframe handling uses `frameLocator()` where applicable.
- Code is deterministic (same input → same output, excluding timestamps).

**FAIL when ANY of:**
- Generated code has syntax errors.
- A recorded action is missing from the Playwright test.
- The test cannot reproduce the recorded workflow if executed.
- Locator selection deviates from the Execution JSON's primary locator.
- Redundant actions are present (e.g., `.click()` before `.fill()` on the same input).
- Action mapping is wrong (e.g., text entry generates `.click()` instead of `.fill()`).

---

## 5. Defect Classification Framework

Every issue discovered during validation must be classified into exactly one category:

| Code | Category | Definition | Example |
|---|---|---|---|
| **REC** | **Recorder Defect** | The content script or background service worker failed to capture an interaction, captured it incorrectly, or captured it in the wrong order. | Login click not captured because SW was asleep; text entry missing because blur handler didn't fire. |
| **CSG** | **Canonical Step Generation Defect** | The Canonical Step Generator produced incorrect, incomplete, or misordered steps from the Interaction Timeline. | Step plainEnglish says "Click DIV" when the element is a button with accessible name "Submit". |
| **OPT** | **Readability Optimizer Defect** | The Readability Optimizer merged steps that should remain separate, failed to merge steps that should be merged, or altered execution data. | OR-1 merged a click on a date picker (custom component) with a text entry; OR-1 failed to merge a focus click on a standard input. |
| **EXE** | **Execution JSON Defect** | The Execution JSON Generator produced JSON that violates the B5.2 contract, selects incorrect locators, or produces non-deterministic output. | JSON missing the `context` section; React auto-generated ID used as a locator. |
| **LOC** | **Locator Strategy Defect** | The Locator Resolution Engine violated the B4.4 priority hierarchy or rejected/accepted a locator incorrectly. | `aria-label` locator skipped in favor of CSS selector despite being higher priority. |
| **PWG** | **Playwright Generator Defect** | The Playwright Generator produced syntactically invalid code, used the wrong Playwright API, or deviated from the Execution JSON's primary locator. | `.type()` used instead of `.fill()`; xpath locator translated without `xpath=` prefix. |
| **UIX** | **UI/UX Issue** | The side panel, timeline display, or user flow has a visual or interaction issue that doesn't affect artifact generation but affects usability. | Timeline doesn't scroll to latest event; Playwright section doesn't auto-expand after generation. |
| **PLM** | **Product Limitation** | The product behaves as designed but cannot handle a specific scenario. Not a bug — a known boundary. | Date picker clicks are not merged because the custom component is excluded by C4; Shadow DOM element identity is incomplete. |
| **EXP** | **Expected Behavior** | The observed behavior is correct per the frozen design. The reporter's expectation was incorrect. | Navigation confidence is 100% (not 0%) — this is correct per B6 Final Validation; focus clicks on buttons are not merged — C4 excludes them. |

### Classification Decision Tree

```
Is the interaction missing from the Timeline?
  → YES: REC (Recorder Defect)

Is the interaction in the Timeline but missing from Canonical Steps?
  → YES: CSG (Canonical Step Generation Defect)

Is the step correct but the merge decision is wrong?
  → YES: OPT (Readability Optimizer Defect)

Is the step correct but the Execution JSON is malformed?
  → YES: EXE (Execution JSON Defect)

Is the Execution JSON valid but locators are wrong?
  → YES: LOC (Locator Strategy Defect)

Is the Execution JSON correct but Playwright code is wrong?
  → YES: PWG (Playwright Generator Defect)

Does it affect only the UI (side panel, display, layout)?
  → YES: UIX (UI/UX Issue)

Is the behavior correct per the frozen design?
  → YES: EXP (Expected Behavior)

Is the product not designed to handle this scenario?
  → YES: PLM (Product Limitation)
```

---

## 6. Evidence Collection Standard

### 6.1 Minimum Evidence Set

Every issue report must include the following evidence. A report without this evidence is considered incomplete and should be returned for additional information before triage.

| # | Evidence | Required? | Description |
|---|---|---|---|
| E1 | **Screenshots/Video** | Yes | At least one screenshot showing the side panel state when the issue occurred. Video if the issue is timing-related. |
| E2 | **Interaction Timeline** | Yes | The complete list of timeline events (can be copied from the side panel or chrome.storage). Include event IDs, types, timestamps. |
| E3 | **Canonical Test Steps** | Yes | The complete list of generated steps (including stepId, stepNumber, actionType, plainEnglish). |
| E4 | **Execution JSON** | Yes (if the issue affects JSON generation or downstream) | The JSON for the affected step(s). At minimum, the `action`, `target`, and `locators` sections. |
| E5 | **Generated Playwright** | Yes (if the issue affects Playwright generation) | The full generated test code. |
| E6 | **Application Under Test** | Yes | Name and URL of the application where the recording was performed. |
| E7 | **Browser Environment** | Yes | Chrome version, OS, CmdRunner extension version (manifest.json version). |
| E8 | **Reproduction Steps** | Yes | Step-by-step description of the workflow that triggered the issue. |
| E9 | **Expected vs. Actual** | Yes | What the reporter expected to happen vs. what actually happened. |
| E10 | **Console Logs** | Optional | Service worker console logs, content script console logs (if accessible via DevTools). Helpful for diagnosing race conditions. |

### 6.2 Evidence Quality Standards

- Screenshots must show the **full side panel** (not just a crop of one section).
- The Interaction Timeline must include all events, not just the problematic ones — context matters.
- If the issue is about a specific element, include a screenshot of that element in the page (not just the side panel).
- Reproduction steps must be specific enough that another tester can reproduce the issue by following them.

---

## 7. Root Cause Analysis Template

Every defect that is confirmed (not EXP or PLM) must have a root cause analysis documented using this template:

```markdown
## RCA: [Issue Title]

**Defect Code:** REC | CSG | OPT | EXE | LOC | PWG | UIX
**Severity:** Critical | High | Medium | Low
**Date Discovered:** YYYY-MM-DD
**Discovered During:** [Milestone / Validation Cycle]

### Description
[One-paragraph summary of the issue]

### Expected Behavior
[What should have happened, per the frozen spec]

### Actual Behavior
[What actually happened]

### Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Evidence Collected
- Screenshots: [attached / link]
- Timeline: [summary]
- Canonical Steps: [summary]
- Execution JSON: [summary or N/A]
- Playwright: [summary or N/A]
- Application: [name + URL]
- Environment: [Chrome version, OS, extension version]
- Console logs: [attached or N/A]

### Root Cause
[Technical explanation of WHY the issue occurred. Trace from symptom to cause.
Identify the specific code path, race condition, or logic error.]

### Severity Justification
[Why this severity:
- Critical: Core functionality broken — recording or generation fails completely
- High: Major feature broken — some workflows fail or produce incorrect output
- Medium: Edge case — most workflows work, specific scenarios fail
- Low: Cosmetic — output is correct but presentation is suboptimal]

### Affected Files
- [file path]

### Recommended Future Milestone
[Which milestone should address this fix, or "Immediate fix" if it blocks
current validation]

### Related Product Area
[Recorder | Canonical Step Generator | Readability Optimizer |
 Execution JSON Generator | Locator Resolution Engine |
 Playwright Generator | Side Panel UI]

### Resolution Status
- [ ] Fixed
- [ ] Retested
- [ ] Closed
```

### Severity Definitions

| Severity | Definition | Examples |
|---|---|---|
| **Critical** | Core functionality is broken. Recording or generation pipeline fails completely. No workaround exists. | Click events not captured at all; Playwright generator produces invalid code for all workflows; generation engine crashes. |
| **High** | A major feature is broken. Some workflows fail or produce incorrect output. A workaround may exist but is cumbersome. | Text entry not captured on SPA pages; OR-1 merges across navigation boundaries; locator resolution selects CSS when testId is available. |
| **Medium** | An edge case. Most workflows work correctly. Specific scenarios fail that are uncommon but not impossible. | OR-1 does not merge on a specific custom input component; iframe context missing for one specific iframe type; Playwright comment formatting is wrong. |
| **Low** | Cosmetic or minor. Output is functionally correct but presentation is suboptimal. No functional impact. | Step numbering display has a gap; timeline shows raw URL instead of page title; Playwright comment says "Step 3" when it should say "Step 4". |

---

## 8. Regression Strategy

### 8.1 Regression Triggers

Regression testing is triggered when any of the following changes are made:

| Trigger | Regression Scope |
|---|---|
| **Content script change** (recorder layer) | All Critical workflow categories (W1-W5, W8-W10, W12-W13). The recorder is the foundation — any change can affect all downstream artifacts. |
| **Canonical Step Generator change** | All Critical categories + the specific category targeted by the change. |
| **Readability Optimizer change** | W1 (Authentication), W4 (Form Entry), W8 (Modals), W9 (Wizard). These exercise OR-1 most heavily. |
| **Execution JSON Generator change** | All Critical categories. JSON generation affects all downstream output. |
| **Locator Resolution Engine change** | W1-W5 (forms, buttons, tables). These exercise the widest variety of element types and locator strategies. |
| **Playwright Generator change** | All Critical categories + the specific change's target. |
| **Service Worker change** | All Critical categories. The SW manages recording state and generation orchestration. |
| **Side Panel change** | No pipeline regression needed. Only verify that display correctly reflects the artifacts. |
| **manifest.json change** | Smoke test: load the extension, record a simple workflow, verify generation completes. |

### 8.2 Regression Suite

The following workflows constitute the **minimum regression suite**. They must be re-validated after any of the triggers above:

| # | Workflow | Category | Why It's in the Core Suite |
|---|---|---|---|
| REG-1 | Login form (username, password, submit, navigation) | W1 Auth | Exercises text entry, click, OR-1 merge, navigation, full pipeline |
| REG-2 | Search (enter query, click search, results) | W2 Search | Exercises text entry, click, SPA dynamics |
| REG-3 | CRUD create form (fill fields, submit) | W3 CRUD | Exercises multi-field form, OR-1 multiple merges |
| REG-4 | Table filter (enter filter text, click filter button) | W5 Tables | Exercises text + click on table elements |
| REG-5 | Modal dialog (open modal, fill field, close) | W8 Modals | Exercises dynamically appearing elements |

### 8.3 Regression Documentation

After each regression run, document:

| Field | Value |
|---|---|
| **Trigger** | What change prompted the regression |
| **Date** | YYYY-MM-DD |
| **Commit** | Git commit hash of the code being tested |
| **Regression Suite Run** | REG-1 through REG-5 (mark each PASS/FAIL) |
| **Extended Tests** | Any additional categories tested (mark PASS/FAIL) |
| **New Defects Found** | List with defect codes |
| **Previously Fixed Defects Verified** | List of re-verified issues |
| **Overall Result** | PASS (all regression suite workflows pass) / FAIL (any regression) |

### 8.4 Regression Expectations for Future Milestones

Every future implementation milestone must include a regression section in its completion report:

```
## Regression Validation

- [x] REG-1 (Login form): PASS
- [x] REG-2 (Search): PASS
- [x] [Extended workflow relevant to this milestone]: PASS
- [ ] New defects: None
```

If any regression suite workflow fails after a milestone's changes, the milestone is **not complete** until the regression is resolved.

---

## 9. Future Milestone Validation Process

### 9.1 Pre-Implementation Validation (Baseline)

Before implementing a new milestone:
1. Run the minimum regression suite (REG-1 through REG-5) against the current code.
2. Record the results as the **baseline**.
3. After implementation, run the same suite and compare.

This ensures that any regression introduced by the new milestone is immediately visible.

### 9.2 Implementation Validation

During implementation, validate against the workflow categories relevant to the milestone's scope:

| Milestone Type | Required Workflow Categories |
|---|---|
| Recorder change | All Critical (W1-W5, W8-W10, W12-W13) |
| Optimizer change | W1, W4, W8, W9 (OR-1 heavy) |
| Locator change | W1-W5, W10 (wide element variety) |
| Playwright change | All Critical |
| UI change | None (display only) |

### 9.3 Post-Implementation Validation (Full Cycle)

After implementation is complete:
1. Run the full minimum regression suite.
2. Run the milestone-specific workflow categories.
3. Run at least 2 Extended categories not previously tested.
4. Compare all results against the baseline.
5. Document results using the regression documentation template.
6. Any new defect gets a root cause analysis (§7).

### 9.4 Freeze Gate

Before freezing any milestone:
1. All regression suite workflows PASS.
2. No Critical or High severity defects remain open.
3. All Medium defects have a documented plan or accepted as product limitations.
4. The validation results are documented in the milestone spec.

---

## 10. Capability Status Classification

### 10.1 Purpose

Every CmdRunner capability has an **implementation status** that determines
how validation results for that capability should be interpreted. This
classification is part of the **validation framework only** — it does not
change the product architecture, execution pipeline, or implementation.

### 10.2 Status Definitions

| Status | Definition | Validation Interpretation |
|---|---|---|
| **Supported** | The capability is fully implemented and is expected to pass validation. | Must pass validation. Any failure is classified as a product defect (REC, CSG, OPT, EXE, LOC, PWG, or UIX). |
| **Partially Supported** | The capability is implemented with documented limitations. Only the supported subset is validated. | Validate only the documented behavior. Unsupported edge cases are recorded as a known limitation (PLM), not a defect. |
| **Not Yet Implemented** | The capability is intentionally outside the current product scope. It may be added in a future milestone. | Record as **Out of Current Scope**. Do NOT classify as a product defect or regression. |
| **Deprecated** | The capability has been intentionally removed or is no longer part of the supported product. | No validation required. |

### 10.3 Current Capability Status (as of B8 Freeze)

| Capability | Status | Notes |
|---|---|---|
| Click recording (standard elements) | **Supported** | Via click-content-script.ts, INTERACTIVE_SELECTOR (28 elements) |
| Text entry recording (input/textarea/select) | **Supported** | Via text-entry-content-script.ts, blur-based capture |
| Navigation recording (full URL + SPA) | **Supported** | Via webNavigation.onCommitted + SPA route detection |
| Recording Context (session metadata) | **Supported** | Captured on START_RECORDING, displayed in timeline |
| Canonical Step Generation | **Supported** | Timeline → steps with elementIdentity, value, plainEnglish |
| Readability Optimization (OR-1) | **Supported** | Focus-click + text-entry merge on same INPUT/TEXTAREA/SELECT |
| Readability Optimization (OR-3) | **Not Yet Implemented** | Provisional — duplicate click removal. Hook exists, no code. |
| Execution JSON Generation | **Supported** | B5.2 contract, B4.4 locator priority, max 3 locators |
| Playwright Generation | **Supported** | Click → `.click()`, Text → `.fill()`, Navigation → `page.goto()` |
| iframe context capture | **Partially Supported** | Detected and recorded; Playwright uses `frameLocator()`. Deeply nested iframes may not be fully captured. |
| Shadow DOM element capture | **Partially Supported** | Click captured via `composedPath()`; Shadow DOM flag set. Locator resolution for Shadow elements may produce CSS-only locators. |
| Dropdown/select option recording | **Partially Supported** | SELECT element text entry captured via blur. Click on dropdown option is captured as a click event. Full dropdown interaction modeling (open → select → close) is not implemented. |
| Hover recording | **Not Yet Implemented** | Removed in v2.2.0 Interaction Engine Reset. Not part of current scope. |
| Right-click / double-click | **Not Yet Implemented** | Not implemented in current interaction types. |
| Drag-and-drop | **Not Yet Implemented** | Not implemented. |
| File upload | **Not Yet Implemented** | File input clicks captured; file selection dialog not recorded. |
| Date picker (calendar widgets) | **Not Yet Implemented** | Custom component clicks captured as generic clicks; calendar UI interaction not modeled. |
| Rich text editor | **Not Yet Implemented** | `contenteditable` elements: click captured, text captured via blur. Rich text formatting (bold, insert image) not modeled. |
| Checkbox/radio toggle | **Not Yet Implemented** | Click events captured; toggle state change not modeled as a distinct interaction type. |
| Scroll recording | **Not Yet Implemented** | Not implemented. |
| Keyboard shortcut recording | **Not Yet Implemented** | Not implemented. |

### 10.4 Validation Interpretation Rules

When applying pass/fail criteria (§4), interpret results according to the
capability's status:

```
IF capability is Supported:
    Failure → classify as defect (REC/CSG/OPT/EXE/LOC/PWG/UIX)
    Must pass for milestone freeze

IF capability is Partially Supported:
    Supported behavior fails → classify as defect
    Unsupported edge case fails → classify as PLM (Product Limitation)
    Must pass supported behavior for milestone freeze

IF capability is Not Yet Implemented:
    Failure → classify as "Out of Current Scope"
    Does NOT block milestone freeze
    Document for future milestone planning

IF capability is Deprecated:
    No validation required
```

### 10.5 Regression Framework Integration

The regression suite (§8.2) applies the same principle:

> **All regression workflows that exercise Supported capabilities must
> pass.**

If a regression workflow exercises a capability that is Not Yet
Implemented, the result is documented as **Out of Current Scope** — not
as a regression or defect.

Example:
- REG-1 (Login form) exercises click, text entry, OR-1, and navigation —
  all **Supported**. Must pass.
- If REG-1 included a "Remember Me" checkbox toggle — that capability is
  **Not Yet Implemented**. The toggle would be captured as a generic
  click (Supported behavior) but not modeled as a toggle interaction
  (Out of Current Scope).

### 10.6 Capability Lifecycle

As CmdRunner gains new capabilities, their status transitions through:

```
Not Yet Implemented → Partially Supported → Supported
```

Or, in rare cases:

```
Supported → Deprecated
```

The validation methodology itself does not change. Only the capability
status changes, which changes how results for that capability are
interpreted.

**Transition process:**
1. When a new milestone implements a capability, update its status in §10.3.
2. Add the capability to the appropriate validation checklist (§3).
3. If it was previously "Not Yet Implemented," workflows that previously
   recorded "Out of Current Scope" results for it should now be re-run and
   expected to pass.

---

## Updated Freeze Declaration

This document is **FROZEN** as of 2026-07-15 (including the Capability
Status Addendum in §10). It defines the CmdRunner Validation Framework
and is the authoritative validation methodology for all future product
validation.

This framework is stable across future milestones. Workflow categories,
pass/fail criteria, defect classifications, evidence standards, and
capability status definitions do not change between milestones. New
workflow categories and capability status updates may be added without
modifying existing definitions.

No implementation changes are made in this milestone.

---

*End of Milestone B8 — Validation Framework & Test Plan (with Capability Status Addendum)*
