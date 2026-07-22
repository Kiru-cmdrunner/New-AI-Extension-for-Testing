# Foundation Validation Plan

> **Goal:** End-to-end validate CmdRunner against real-world web applications to confirm the platform is stable before adding new capabilities.

## 1. Test Target Applications

We will test against three categories of web applications, each exercising different DOM patterns and framework behaviors:

### Tier 1 — Built-in Test Pages (Served from the extension preview URL)
These are synthetic pages designed to exercise every interaction type and locator strategy:

| Page | URL | What it exercises |
|------|-----|-------------------|
| **Coverage Test Suite** | `/coverage-test.html` | All 35+ InteractionTypes: click, dblclick, fill, select, date picker, checkbox, toggle, hover, drag, scroll, context menu, tab switch. 110 `data-testid` attributes. |
| **Validation Suite** | `/validation.html` | Form validation, edge cases, custom widgets (dropdowns, toggles, tabs). |
| **Test Harness** | `/test-harness.html` | Modern widget patterns (CSS-only toggles, JS dropdowns, tab panels, contenteditable). |
| **Demo Page** | `/demo.html` | A simulated multi-step workflow (login → form → submit → confirmation). |

### Tier 2 — Public Web Applications (No authentication required)
These exercise real-world DOM patterns from production applications:

| Application | URL | What it exercises |
|-------------|-----|-------------------|
| **Hacker News** | https://news.ycombinator.com | Minimal HTML, link-heavy, vote buttons, nested comments, search. Tests basic click/navigation on server-rendered pages. |
| **Wikipedia Search** | https://www.wikipedia.org | Form fill, search, navigation between pages, link clicks. Tests fill + navigate on large DOMs. |
| **Demo QA Form** | https://demoqa.com/automation-practice-form | Complex form with text inputs, radio buttons, checkboxes, date picker, select dropdowns, file upload. Tests all interaction types on a real-world form. |
| **The-Internet (Heroku)** | https://the-internet.herokuapp.com | Classic test automation target: dynamic content, drag-and-drop, dropdowns, checkboxes, JavaScript alerts, iframes, shadow DOM. |

### Tier 3 — Framework-Specific Applications (Public, no auth)
These exercise framework-specific DOM rendering and event patterns:

| Application | URL | What it exercises |
|-------------|-----|-------------------|
| **TodoMVC (React)** | https://todomvc.com/examples/react/dist/ | React's controlled inputs, synthetic events, state-driven DOM updates. Tests native value setter compatibility. |
| **TodoMVC (Vue)** | https://todomvc.com/examples/vue/dist/ | Vue's reactivity system, v-model bindings. Tests input/change event dispatch. |
| **TodoMVC (Angular)** | https://todomvc.com/examples/angularjs/ | AngularJS dirty checking, ng-model, custom directives. |

## 2. End-to-End Workflows

Each workflow is a complete record → understand → execute cycle:

### Workflow A — Simple Form Fill (baseline)
1. Navigate to Demo QA Form
2. Record: fill first name, fill last name, select gender radio, fill email, click Submit
3. Verify: 5 steps detected, IR plan generated, assertions derived
4. Execute: run IR plan against the same page
5. Verify: all steps pass, no locator failures

### Workflow B — Multi-Page Navigation
1. Navigate to Wikipedia
2. Record: fill search box, press Enter (or click search button), click first result link, click a section link
3. Verify: navigation events captured, URL changes detected
4. Execute: run IR plan
5. Verify: page transitions match, assertions pass

### Workflow C — Interactive Widgets
1. Navigate to coverage-test.html
2. Record: toggle switch, dropdown select, tab switch, checkbox, hover
3. Verify: complex InteractionTypes detected (TOGGLE, SELECT, HOVER)
4. Execute: run IR plan
5. Verify: widget state changes correctly

### Workflow D — React Controlled Inputs
1. Navigate to TodoMVC React
2. Record: type new todo, press Enter, toggle complete, edit todo text, delete todo
3. Verify: React's controlled inputs captured correctly (native value setter works)
4. Execute: run IR plan
5. Verify: todos created/modified/deleted correctly

### Workflow E — Recording → Understanding Validation
1. Navigate to demo.html (built-in multi-step workflow)
2. Record: complete the full login → form → submit workflow
3. Verify:
   - DetectedInteractions count matches expected
   - Knowledge Fragment contains expected components and transitions
   - Capability Candidate derives correct purpose and validation rules
   - IR Bridge produces expected steps with correct actions, locators, and assertions
4. Do NOT execute — this workflow validates the Understanding Layer

### Workflow F — Runtime Healing
1. Navigate to coverage-test.html
2. Record: interact with a few elements
3. Manually modify the DOM (change a `data-testid` attribute)
4. Execute: run IR plan
5. Verify: locator resolution fails for modified element → healing attempts DOM re-discovery → healed locators used → step succeeds

### Workflow G — Repository Persistence
1. Record workflow A on Demo QA Form
2. Record workflow A again (same form)
3. Verify: second recording matches to same Capability (auto-merge), element locators healed via cross-session healing
4. Check: Repository UI shows capability with enrichment history

## 3. Functional Areas to Validate

| Area | What we validate | How we know it works |
|------|------------------|---------------------|
| **Recording** | Content script captures all interaction types | DetectedInteractions count matches manual count |
| **Classification** | V1 + V2 classifiers produce correct InteractionTypes | Classification labels match the action performed |
| **Understanding** | Knowledge Fragment, Capability Candidate, UnderstandingResult produced | Fragment has expected components, transitions, field labels |
| **IR Generation** | IR Bridge produces ExecutionIRPlan with correct steps | Step count, action types, locators, assertions match expectations |
| **Execution** | IRExecutor executes plan against live tab | All steps pass, actions produce visible effects |
| **Runtime Healing** | Stale locators trigger healing | Override map used, Repository Element updated, step passes |
| **Assertions** | Post-step assertions evaluate correctly | PASS/FAIL matches expected outcome |
| **Repository** | Capability matching, element persistence, enrichment history | Repository UI shows correct data |
| **Side Panel UI** | All sections render, Run Test works | Results displayed with correct status |
| **Cross-Session Healing** | Second recording heals elements from first | Element locators updated, heal history appended |

## 4. Issue Tracking

### Issue Categories (Priority Order)
| Priority | Category | Example |
|----------|----------|---------|
| **P0 — Blocker** | Recording fails to capture a basic interaction | Click not detected, fill value missing |
| **P0 — Blocker** | Execution crashes or produces wrong results | TypeError in executor, wrong action type |
| **P0 — Blocker** | Locator resolver can't find any element on a common page | All locators fail on standard HTML |
| **P1 — Critical** | Classification misidentifies an interaction type | Fill classified as click, select classified as fill |
| **P1 — Critical** | IR Bridge generates wrong action or missing assertion | Missing validation rule, wrong locator strategy |
| **P1 — Critical** | Runtime healing doesn't work when locators change | Element not found, healing doesn't trigger |
| **P2 — Major** | Framework-specific issue (React, Vue, Angular) | Native value setter doesn't trigger React state update |
| **P2 — Major** | Repository matching produces wrong decision | Auto-merge for unrelated capabilities, ambiguous for same form |
| **P3 — Minor** | UI rendering issue | Missing assertion details, truncated text, wrong badge color |
| **P3 — Minor** | Edge case or rare interaction | Custom shadow DOM widget, drag-and-drop coordinates |

### Issue Report Format
Each issue is recorded in `/workspace/.drytis/notes/validation-issues.md`:
```
### VAL-XXX: [Short title]
- **Priority:** P0/P1/P2/P3
- **Workflow:** A/B/C/D/E/F/G
- **Application:** [URL]
- **Area:** Recording/Classification/Understanding/IR/Execution/Healing/Repository/UI
- **Steps to reproduce:**
- **Expected:** 
- **Actual:** 
- **Root cause:** (if known)
- **Fix:** (commit hash)
```

### Issue Triage Rules
- **P0 issues block validation** — must be fixed before continuing
- **P1 issues are fixed before moving to the next tier** — each tier must be P1-clean
- **P2 issues are logged and batched** — fixed after tier completes, or deferred with justification
- **P3 issues are logged** — fixed opportunistically, may be deferred

## 5. Exit Criteria

The foundation is considered stable when:

1. ✅ **All Tier 1 workflows pass** — every interaction type on coverage-test.html is recorded and executed correctly
2. ✅ **Tier 2 workflows pass** — at least 3 public web applications produce clean recordings and successful executions
3. ✅ **At least one framework-specific app works** — TodoMVC React OR Vue produces correct recordings and executions
4. ✅ **Runtime healing works** — Workflow F demonstrates healing on a deliberately modified DOM
5. ✅ **Repository persistence works** — Workflow G demonstrates capability matching and cross-session healing
6. ✅ **Zero P0 issues** — no blockers
7. ✅ **Zero P1 issues** — no critical defects
8. ✅ **P2 issues logged** — may exist but are documented with a plan
9. ✅ **Full test suite passes** — all unit/integration tests green (2880+)

## 6. Execution Order

```
Phase A: Tier 1 — Built-in Test Pages
  ┌─ A1: coverage-test.html — record all 35+ interaction types
  ├─ A2: demo.html — full multi-step workflow
  ├─ A3: validation.html — form validation patterns
  └─ A4: test-harness.html — modern widget patterns
  (Stabilize: fix P0/P1, then proceed)

Phase B: Tier 2 — Public Web Applications
  ┌─ B1: Hacker News — basic click/navigation
  ├─ B2: Wikipedia — form fill + search + navigation
  ├─ B3: Demo QA Form — complex form (all interaction types)
  └─ B4: The-Internet (Heroku) — dynamic content, iframes, shadow DOM
  (Stabilize: fix P0/P1, then proceed)

Phase C: Tier 3 — Framework-Specific
  ┌─ C1: TodoMVC React — controlled inputs, synthetic events
  ├─ C2: TodoMVC Vue — reactivity, v-model
  └─ C3: TodoMVC Angular — dirty checking, ng-model
  (Stabilize: fix P0/P1, then proceed)

Phase D: Cross-Cutting Validation
  ├─ D1: Runtime healing (Workflow F)
  ├─ D2: Repository persistence (Workflow G)
  └─ D3: Understanding layer validation (Workflow E)

Phase E: Exit Assessment
  └─ Verify all exit criteria met
```
