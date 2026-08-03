# Expanded Validation Design Document

**Status:** Design — for review before implementation
**Scope:** Systematic validation of four blind-spot areas identified by Phase 3 validation
**Predecessors:** PHASE3_VALIDATION_PLAN.md (22 capabilities), PHASE3_VALIDATION_REPORT.md (30 tests, 8 findings)
**Date:** 2026-08-01

---

## §1. Objectives

### 1.1 Primary Objective

Close the four blind spots identified by the Phase 3 validation to produce a
**complete, evidence-driven picture of recording quality** before further
implementation decisions are made.

The Phase 3 validation answered: *"Which interaction capabilities work?"*
The expanded validation answers: *"Where do they break on real-world patterns,
and why?"*

### 1.2 Specific Objectives

| # | Objective | Blind Spot Addressed |
|---|-----------|---------------------|
| O1 | Verify framework-specific component patterns classify correctly across MUI, Ant Design, Radix, Chakra, Bootstrap | Framework-specific patterns |
| O2 | Assess locator quality across realistic DOM structures with auto-generated IDs, CSS-in-JS classes, portaled content | Locator quality |
| O3 | Verify interaction sequences produce coherent test narratives — dedup correctness, ordering, cross-step state | Multi-step workflows |
| O4 | Identify where the pipeline's assumptions about event ordering and DOM mutations break on compound interactions | Compound interactions |
| O5 | Consolidate all findings into a prioritized roadmap using severity, frequency, and architectural impact | Roadmap |

### 1.3 Non-Objectives

- **Not implementing fixes.** The expanded validation is observation-only. We document every finding, then decide what to build.
- **Not testing every website.** The validation is capability-driven, not website-driven. We test *patterns*, not *apps*.
- **Not testing replay execution.** We assess whether generated Playwright code *would work* (Q5 Replay Fidelity), not whether it actually passes when executed. Live replay testing requires a browser extension runtime, which is out of scope.

---

## §2. Methodology and Rationale

### 2.1 Why Capability-Driven, Not Website-Driven

Testing on specific apps (Airbnb, Amazon, GitHub) produces app-specific
findings that don't generalize. Testing on *interaction capabilities*
(form input on a MUI Autocomplete, tab activation on a Radix TabList)
produces findings that map to the recorder's architecture.

**Capability-driven approach:**
1. Define the interaction capability (e.g., "MUI Select dropdown selection")
2. Construct a synthetic `ObservedEvent[]` that mimics the DOM events a real
   MUI Select emits
3. Run through the full pipeline: `ComponentRuntime → IR Bridge → Playwright`
4. Assess quality across 8 dimensions
5. Record findings with root cause

This is repeatable, fast, and doesn't require a browser. The key insight
from Phase 3 is that the entire pipeline can be exercised programmatically.

### 2.2 What the Programmatic Harness CAN and CANNOT Test

The existing harness (`tests/validation-harness/harness.ts`) constructs
synthetic `ObservedEvent[]` and runs them through the real pipeline.

**CAN test (programmatic):**
- Event classification — any event sequence can be simulated
- Framework CSS class patterns — set `className` and `ancestorClasses`
- Locator extraction — set `ElementIdentity` fields (testId, ariaLabel, etc.)
- IR generation — full `build()` call
- Playwright rendering — full `renderTestFile()` call
- Multi-step sequences — feed multiple interactions in sequence
- Dedup logic — construct near-duplicate events and verify suppression
- Metadata propagation — verify `intent`, `confidence`, `assertions` reach IR

**CANNOT test (requires real browser or DOM):**
- **Real DOM mutations** — surface appearance/disappearance is detected by
  the runtime's surface tracker, which needs to see `domContext.surfaceId`
  change. We can *simulate* this by providing the right context, but we're
  asserting our assumptions about what the DOM looks like, not observing it.
- **Real event ordering** — frameworks may emit synthetic events, fire
  events asynchronously, or use MutationObserver callbacks that the runtime
  doesn't see. We can simulate *expected* ordering but can't verify
  *actual* browser behavior without a real page.
- **Locator survival** — whether a CSS selector actually matches the target
  element in a real DOM tree. We can test whether the locator is
  *syntactically* correct and semantically appropriate, but not whether it
  uniquely identifies the element.

**Strategy for CANNOT-test areas:**
For compound interactions that require real DOM mutations, we construct
synthetic event sequences that *model what we believe the DOM does*. We
flag each such test with a `[SIMULATED]` marker in the finding, and we
document the assumption being made. This is explicitly acknowledged in §10
as a validation limitation.

### 2.3 Test Construction Methodology

Each test follows a fixed structure:

```
1. Define capability + framework variant
2. Construct ObservedEvent[] mimicking real framework DOM events
3. Run through pipeline (runtime → IR bridge → Playwright)
4. Assess quality dimensions (Q1-Q8)
5. Record Finding with root cause
```

The key design decision: **we construct events that mimic real framework
output, not events that exercise edge cases.** The goal is to find where
realistic patterns break, not to find theoretical edge cases. Every event
sequence should be one that a real user action on a real framework component
would produce.

### 2.4 Quality Dimensions (unchanged from Phase 3)

| ID | Dimension | Scale | What "5" Means |
|----|-----------|-------|---------------|
| Q1 | Intent Accuracy | 1–5 | Correct classification of interaction type and subtype |
| Q2 | Abstraction Fidelity | 1–5 | Right granularity — not over-fragmented, not collapsed |
| Q3 | Locator Quality | 1–5 | Locators are robust, readable, and uniquely identify the element |
| Q4 | Semantic Description | 1–5 | Human-readable description conveys user intent |
| Q5 | Replay Fidelity | 1–5 | Generated code would work if executed |
| Q6 | Confidence Calibration | 1–5 | Confidence score matches actual recording quality |
| Q7 | Evidence Quality | 1–5 | Evidence trail explains classification reasoning |
| Q8 | Assertion Value | 1–5 | Assertions verify meaningful post-action state |

Scores are assigned by the test author based on concrete evidence:
- `5` = ideal output, no issues
- `4` = minor cosmetic issue (description phrasing, locator ordering)
- `3` = functional but with a notable gap (missing assertion, fragile locator)
- `2` = partially correct (wrong subtype, but right category)
- `1` = incorrect or missing (no interaction emitted, crash, wrong action)

---

## §3. Area 1 — Framework-Specific Component Patterns

### 3.1 What We're Testing

The Pattern Registry (`src/definitions/pattern-registry.ts`) has plugins for
MUI, Ant Design, Bootstrap, OXD, PrimeReact. Radix, Chakra, and AGGrid are
detected in the enrichment layer but have **no Pattern Registry entries** —
they fall back to generic/ARIA detection.

This area tests whether the 5 registered frameworks and 3 unregistered
frameworks produce correct classifications when their specific CSS class
patterns and DOM structures are present.

### 3.2 Framework Test Matrix

Each framework is tested against the interaction capabilities where its
specific patterns matter most. We do NOT test every capability × framework
combination — only where the framework's CSS patterns or DOM structure
could change the outcome.

| Framework | Pattern Registry Plugin | Key Capabilities to Test |
|-----------|------------------------|-------------------------|
| **MUI** | ✅ MUI_PATTERNS | Select (MuiSelect), Dialog (MuiDialog-root), Checkbox (MuiCheckbox), DatePicker (MuiDatePicker) |
| **Ant Design** | ✅ ANT_PATTERNS | Select (ant-select), DatePicker (ant-picker), Modal (ant-modal), Checkbox (ant-checkbox) |
| **Bootstrap** | ✅ BOOTSTRAP_PATTERNS | Dropdown (dropdown-menu), Modal (modal show), Offcanvas (offcanvas) |
| **PrimeReact** | ✅ PRIMEREACT_PATTERNS | Dropdown (p-dropdown), Calendar (p-calendar), Dialog (p-dialog) |
| **Radix UI** | ❌ No plugin | DropdownMenu (radix-menu), Dialog (radix-dialog), Tabs (radix-tabs), Checkbox (radix-checkbox) |
| **Chakra UI** | ❌ No plugin | Select (chakra-select), Modal (chakra-modal), Tabs (chakra-tabs) |
| **AGGrid** | ❌ No plugin | Grid cell click, column header sort, row selection |

### 3.3 Test Construction for Each Framework

For each framework × capability, construct an `ObservedEvent[]` with:

1. **Realistic `className`** — actual CSS classes the framework renders
   (e.g., `MuiSelect-select MuiSelect-outlined MuiOutlinedInput-root`)
2. **Realistic `ancestorClasses`** — the DOM ancestor chain
   (e.g., `['MuiFormControl-root', 'css-1sq4k6b', 'MuiGrid-root']`)
3. **Realistic `ariaRole`** — the role the framework assigns
   (e.g., MUI Select uses `combobox`, Radix uses `listbox`)
4. **Realistic event sequence** — the events the framework actually emits
   (e.g., MUI Select fires `mousedown` on the trigger, then a separate
   `click` on the option in the popover, then `mousedown` outside to close)

For frameworks WITHOUT Pattern Registry plugins (Radix, Chakra, AGGrid),
the test specifically checks whether generic/ARIA detection is sufficient
or whether the framework's non-standard patterns cause misclassification.

### 3.4 Specific Scenarios

| ID | Framework | Scenario | Risk |
|----|-----------|----------|------|
| FW-MUI-01 | MUI | Select: click trigger → listbox opens → click option → listbox closes | MuiSelect may trigger Click instead of Dropdown |
| FW-MUI-02 | MUI | Dialog: click open button → modal appears → click inside → click close | Surface detection may fail on portaled MuiDialog |
| FW-MUI-03 | MUI | Checkbox: click MuiCheckbox-root → checked state changes | May emit duplicate (label + input click) |
| FW-ANT-01 | Ant Design | Select: click ant-select-selector → dropdown opens → click ant-select-item | ant-select-item class detection |
| FW-ANT-02 | Ant Design | DatePicker: click ant-picker → calendar opens → click ant-picker-cell | Calendar cell class detection |
| FW-RDX-01 | Radix | DropdownMenu: click trigger → radix-menu opens → click menu item | No plugin — relies on ARIA role detection |
| FW-RDX-02 | Radix | Dialog: click trigger → radix dialog opens → content inside | Portaled content, `data-radix` attribute |
| FW-RDX-03 | Radix | Tabs: click tab trigger → associated panel activates | `role="tab"` detection should work |
| FW-CHK-01 | Chakra | Select: click chakra-select → dropdown → click option | No plugin — relies on ARIA |
| FW-CHK-02 | Chakra | Modal: click trigger → chakra-modal opens → fill input inside | Surface detection via class |
| FW-AGG-01 | AGGrid | Click cell in ag-grid: ag-cell clicked | May classify as generic Click |
| FW-AGG-02 | AGGrid | Click header: ag-header-cell clicked for sort | May not detect sort intent |
| FW-BS-01 | Bootstrap | Dropdown: click btn → dropdown-menu appears → click dropdown-item | dropdown-menu class detection |
| FW-BS-02 | Bootstrap | Modal: click button → modal show → fill input → click close | Modal surface detection |
| FW-PRE-01 | PrimeReact | Dropdown: click p-dropdown → panel opens → click p-dropdown-item | p-dropdown class detection |

### 3.5 What We're Assessing

For each scenario:
- **Q1 (Intent)**: Does the framework-specific pattern produce the correct
  interaction type (Dropdown, not Click)?
- **Q2 (Abstraction)**: Does the compound interaction (open → select → close)
  produce ONE Dropdown interaction or THREE Click interactions?
- **Q3 (Locator)**: Does the framework's CSS-in-JS class structure produce
  usable locators, or do auto-generated classes (e.g., `css-1sq4k6b`) pollute
  the candidate list?
- **Q4 (Description)**: Does the description mention the right element name?

---

## §4. Area 2 — Locator Quality Assessment

### 4.1 What We're Testing

The locator ranking system (`src/domain/locator-ranking.ts`) extracts
candidates from `ElementIdentity` and ranks them by category (BUSINESS >
ACCESSIBILITY > STABLE_TECHNICAL > CONTENT > STRUCTURAL). We need to
verify this produces good locators on realistic DOM structures, not just
the clean test fixtures used in Phase 3.

### 4.2 Locator Quality Scenarios

Each scenario constructs an `ElementIdentity` that mimics a real DOM
structure and verifies the ranking produces the right locators.

| ID | Scenario | ElementIdentity Shape | Expected #1 Locator | Risk |
|----|----------|----------------------|--------------------|----|
| LQ-01 | Clean testId | `testId="submit-btn"`, `ariaRole="button"`, `accessibleName="Submit"` | `testId:submit-btn` | Baseline — should always work |
| LQ-02 | Auto-generated React ID | `id=":r5:"`, `testId=null`, `ariaLabel="Search"` | `ariaLabel:Search` | React ID must be filtered out |
| LQ-03 | MUI CSS-in-JS classes | `className="MuiButton-root css-1sq4k6b"`, `ariaRole="button"`, `accessibleName="Save"` | `accessibleName:Save` or `role:button` | `css-1sq4k6b` must be filtered |
| LQ-04 | No semantic attributes | `tag="div"`, `id="auto-123"`, no testId, no aria, `className="cursor-pointer hover:bg-blue-50"` | `css:div.cursor-pointer` or `xpath` | Last resort — fragile by design |
| LQ-05 | Radix data attributes | `data-radix-collection-item=""`, `ariaRole="menuitemcheckbox"`, `accessibleName="Enable notifications"` | `role:menuitemcheckbox` | `data-radix-*` not useful as locators |
| LQ-06 | Deeply nested element | `testId=null`, `ariaLabel=null`, `tag="span"`, `className="text-sm font-medium"`, inside `ariaLabelledBy="label-1"` | `label:label-1` or `css` | ariaLabelledBy should produce a LABEL locator |
| LQ-07 | Tailwind utility classes | `className="flex items-center gap-2 px-4 py-2"`, `tag="button"`, `accessibleName="Submit"` | `accessibleName:Submit` | Tailwind classes are meaningless as locators |
| LQ-08 | Dynamic aria-label | `ariaLabel="Close dialog opened 3 seconds ago"`, `tag="button"`, `id="close-btn-12345"` | `css:#close-btn-12345` or `accessibleName` | Dynamic aria-labels are unstable for replay |
| LQ-09 | Duplicate testId | `testId="row"` (appears on every row in a table), `ariaRole="row"`, `accessibleName="John Doe"` | `accessibleName:John Doe` | Duplicate testId is useless — accessibleName wins |
| LQ-10 | SVG icon button | `tag="svg"`, `className="w-5 h-5"`, no aria, parent `ariaLabel="Search"` | Parent's ariaLabel via `css` | SVG elements often lack semantic identity |
| LQ-11 | ContentEditable div | `tag="div"`, `isContentEditable=true`, `className="ql-editor"`, `ariaLabel=null`, `accessibleName=null` | `css:div.ql-editor` | No semantic anchors — structural only |
| LQ-12 | Portaled element | `tag="div"`, `id="radix-:r2q:"`, `className="radix-popper-content"`, `ariaRole="dialog"`, `accessibleName="Settings"` | `accessibleName:Settings` or `role:dialog` | Portal IDs are auto-generated and unstable |

### 4.3 What We're Assessing

For each scenario:
- **Q3 (Locator Quality)**: Is the #1 ranked locator robust (would it survive
  a minor DOM change?), readable (does it convey what element it targets?),
  and unique (would it match only one element)?
- **Q5 (Replay Fidelity)**: Would the top locator actually work in a Playwright
  `page.locator()` call?
- **Q6 (Confidence Calibration)**: Does the confidence score match the
  locator's actual reliability?

### 4.4 Locator Edge Cases to Probe

Beyond the 12 scenarios, we probe specific edge cases in the ranking logic:

- **Empty identity**: `ElementIdentity` with all null/empty fields — should
  produce a CSS fallback, not crash
- **Very long accessibleName**: 200+ character text — should be filtered by
  `filterValidCandidates` (100 char limit)
- **Special characters in id**: `id="user[email]"` — CSS selector needs escaping
- **Numeric-only className**: `className="123 456"` — meaningless but shouldn't crash
- **Unicode accessibleName**: `accessibleName="設定"` — should be preserved

---

## §5. Area 3 — Multi-Step Workflow Validation

### 5.1 What We're Testing

Every Phase 3 test exercised single interactions in isolation. Real recording
sessions produce sequences of 5–50+ interactions. This area tests whether:

1. **Dedup** suppresses correctly when the same element is interacted with
   repeatedly (form fill, repeated checkbox toggles)
2. **Ordering** is preserved — interactions appear in the IR plan in the
   same order they were performed
3. **Cross-step state** is handled — step N may depend on step N-1 (e.g.,
   a dropdown selection reveals a new form field)
4. **Noise filtering** works at scale — scrolls between actions, stray
   hovers, accidental clicks
5. **Step merging** produces clean IR (readability rules OR-1, OR-2)
6. **Configuration session** enrichment groups multi-field form fills correctly

### 5.2 Workflow Scenarios

| ID | Workflow | Interactions | What We're Testing |
|----|----------|-------------|-------------------|
| WF-01 | Login form | Focus username → type → focus password → type → click submit → navigation | Dedup (focus+input merging), ordering, navigation after action |
| WF-02 | Registration form | Fill 8 fields (text, email, password, checkbox, select, radio, date, file) → submit | Configuration session grouping, multi-field form handling |
| WF-03 | Multi-step checkout | Address form → shipping method radio → payment form → review → submit | Cross-step dependencies, dedup across form boundaries |
| WF-04 | Data table interaction | Click column header (sort) → click cell → edit → click checkbox in another row → click pagination | Repeated clicks on similar elements, dedup suppression |
| WF-05 | Modal workflow | Click open modal → fill 3 fields inside modal → click save → modal closes → verify | Surface lifecycle, surface-bound event scope, modal close detection |
| WF-06 | Tabbed interface | Click tab 1 → interact → click tab 2 → interact → click tab 3 → interact | Tab switching, dedup between same-type events on different tabs |
| WF-07 | Nested dropdowns | Click nav menu → hover submenu → click sub-item → navigate | Hover-then-click sequencing, nested surface detection |
| WF-08 | Search and filter | Type in search → wait → click filter dropdown → select option → click apply | TextEntry followed by Dropdown, timing between interactions |
| WF-09 | Form with validation errors | Fill field → submit → validation error appears → fix field → resubmit | Error state handling, repeated submission |
| WF-10 | Drag and drop + fill | Drag item to zone → fill appears in new field → type → save | DragDrop followed by TextEntry, cross-component state |
| WF-11 | Scrolling content | Scroll down → click element revealed by scroll → scroll back → click another | Scroll noise filtering, scroll exemption from dedup |
| WF-12 | Rapid checkbox toggles | Click checkbox → click again → click again (3 rapid toggles) | Temporal dedup within DEDUP_WINDOW_MS |

### 5.3 What We're Assessing

For each workflow:
- **Q1 (Intent)**: Does each interaction classify correctly in context?
- **Q2 (Abstraction)**: Does the multi-step sequence produce the right number
  of IR steps? Not too many (over-fragmentation), not too few (collapsed)?
- **Q5 (Replay Fidelity)**: Would the generated test file produce a coherent
  test? Are steps in the right order? Are there missing steps?
- **Q8 (Assertion Value)**: Do assertions reference the correct elements in
  a multi-step context?

---

## §6. Area 4 — Browser-Based Compound Interaction Validation

### 6.1 What We're Testing

Compound interactions (modal open-fill-close, multi-config dropdown,
autocomplete type-then-select) have multi-event lifecycles that the Phase 3
validation could not test because the harness lacks real DOM mutation
support. This area uses the programmatic harness with **simulated DOM
mutations** — we construct event sequences that model what we believe the
DOM does during these interactions.

Each test is marked `[SIMULATED]` and documents the assumption being made.

### 6.2 Compound Scenarios

| ID | Scenario | Event Sequence | Assumption Being Tested |
|----|----------|---------------|------------------------|
| CP-01 | MUI Autocomplete | Focus input → type "un" → options appear (surfaceId set) → click option → options disappear (surfaceId null) → input value updates | Surface tracking detects option appearance, click on option closes the dropdown, resulting interaction is ONE Autocomplete |
| CP-02 | Modal Dialog (open-fill-close) | Click button → modal appears (surfaceId="modal-1") → focus input inside modal → type → click save → modal disappears (outside click) | Surface boundary constrains events to the modal scope, surface closure detected |
| CP-03 | Multi-config Dropdown | Click dropdown → panel opens → click stepper+ → click checkbox option → click "Done" button → panel closes | Compound lifecycle: open → increment → toggle → confirm → close, all as ONE interaction with subActions |
| CP-04 | DatePicker with calendar | Focus date input → calendar appears → click calendar day → calendar disappears → date value set | Calendar surface detection, date cell click → change event dedup |
| CP-05 | Drawer/Offcanvas | Click trigger → drawer slides in (surfaceId="drawer-1") → interact inside → click close button → drawer closes | Drawer surface lifecycle, surface-bound scope |
| CP-06 | Nested modals | Click button → modal-1 opens → click button inside modal-1 → modal-2 opens inside modal-1 → close modal-2 → close modal-1 | Nested surface tracking, correct surface stack ordering |
| CP-07 | Autocomplete with keyboard | Focus input → keydown ArrowDown → keydown Enter → option selected → input value updates | Keyboard-driven selection (no click event), Enter on highlighted option |
| CP-08 | Popover/Tooltip | Hover element → tooltip appears → hover ends → tooltip disappears | Hover lifecycle with transient surface, tooltip should NOT be recorded as a separate interaction |

### 6.3 What We're Assessing

For each scenario:
- **Q1 (Intent)**: Does the compound interaction produce ONE interaction
  (correct abstraction) or multiple fragmented interactions?
- **Q2 (Abstraction)**: Is the compound lifecycle captured as a single
  interaction with subActions metadata?
- **Q5 (Replay Fidelity)**: Does the generated Playwright code capture the
  full compound action?
- **Q8 (Assertion Value)**: Does the generated code assert the compound
  result (modal closed, value set)?

### 6.4 Validation Limitation Acknowledgment

Compound interaction testing via synthetic events is **less reliable** than
the other three areas. We are testing whether the pipeline processes our
*model* of compound events correctly, not whether our model matches reality.
The validation report will explicitly flag each finding with:

- `[SIMULATED]` — based on synthetic events modeling assumed DOM behavior
- `[VERIFIED]` — based on directly observable pipeline behavior (no DOM assumptions)

Only `[SIMULATED]` findings that reveal clear architectural issues should be
prioritized. `[SIMULATED]` findings that depend on specific DOM mutation
timing should be deferred to true browser testing.

---

## §7. Representative Application Selection

### 7.1 Selection Criteria

We do NOT test on real applications. Instead, we select **representative
interaction patterns** from real applications. The selection criteria:

1. **Frequency**: How often does this pattern appear in modern web apps?
2. **Complexity**: Does it exercise the pipeline in ways simple tests don't?
3. **Framework diversity**: Does it cover frameworks beyond MUI/Ant?
4. **Architectural risk**: Does it stress the pipeline's assumptions?

### 7.2 Application Domain → Pattern Mapping

| App Domain | Representative Patterns | Frameworks |
|-----------|------------------------|------------|
| **E-commerce checkout** | Multi-step forms, dropdowns, date pickers, checkbox groups, modal payment, address autocomplete | MUI, Bootstrap |
| **Admin dashboard** | Data tables (AGGrid), tabbed interfaces, drawer panels, complex dropdowns with steppers | Ant Design, AGGrid |
| **Social media** | Rich text editors, autocomplete mentions, modal dialogs, infinite scroll | Generic, Draft.js |
| **Settings panel** | Radio groups, checkboxes, dropdowns, toggle switches, nested tabs | Radix, Chakra |
| **Form-heavy SaaS** | Complex forms with validation, OTP inputs, tag inputs, file uploads | MUI, Ant Design |

Each domain informs WHICH patterns we construct, not WHERE we test them.
All tests are programmatic — no real apps are loaded.

### 7.3 Why Not Test on Real Apps?

1. **Non-reproducible**: Real apps change, break, and require authentication
2. **Not unit-testable**: Can't assert specific pipeline behavior
3. **Too much noise**: Real apps produce hundreds of events, making it hard
   to isolate which event sequence caused a specific finding
4. **Framework opacity**: Can't inspect what CSS classes or DOM structure
   a real framework component renders without DevTools

The programmatic approach gives us full control over the input and full
visibility into the output. What we lose is the discovery of unexpected
event sequences — we only test what we anticipate.

---

## §8. Finding Categorization

### 8.1 Finding Categories

Every finding is classified into one of five categories:

| Category | Description | Example | Typical Action |
|----------|-------------|---------|---------------|
| **Implementation Gap** | Code exists but has a bug or missing wiring | `change` event not in triggerEventTypes | Fix in definition file |
| **Capability Gap** | The recorder cannot handle this interaction pattern at all | No definition for ColorPicker | New definition needed |
| **Architectural Limitation** | The pipeline's design prevents correct handling | Surface detection requires real DOM mutations, but runtime has no DOM | Design change needed |
| **Framework Gap** | Framework-specific CSS patterns aren't registered in PatternRegistry | Radix has no PatternRegistry plugin | Add plugin |
| **Browser Limitation** | The event model doesn't capture what the browser does | MutationObserver callbacks not visible to EventTap | Extension architecture change |

### 8.2 Severity Classification

| Severity | Definition | Criteria |
|----------|-----------|----------|
| **P0 — Critical** | Interaction produces no output or crashes the pipeline | 0 interactions emitted, uncaught exception |
| **P1 — High** | Interaction is misclassified or produces broken code | Wrong type, missing locator, Playwright crash |
| **P2 — Medium** | Interaction works but quality is reduced | Fragile locator, missing assertion, poor description |
| **P3 — Low** | Cosmetic or edge case | Non-ideal locator ordering, description phrasing |

### 8.3 Subsystem Classification

Each finding also identifies the subsystem where the issue originates:

| Subsystem | Scope |
|-----------|-------|
| **Definition** | A component definition's detectTrigger, isInScope, handleEvent, or buildResult |
| **Runtime** | ComponentRuntime's event processing, dedup, surface tracking |
| **Pattern Registry** | Framework-specific CSS class pattern matching |
| **Locator Ranking** | Candidate extraction, filtering, ranking, confidence |
| **IR Bridge** | Type mapping, assertion derivation, target resolution |
| **Enrichment** | Evidence annotation, component detection, meaning resolution |
| **Playwright Adapter** | Action rendering, assertion rendering, description rendering |
| **Interaction Enrichment Pass** | Locator backfill, structural assertions, confidence propagation |

### 8.4 Raw Evidence Preservation Policy

Every individual observation is preserved as a distinct record, even when
multiple observations share the same underlying root cause. The final
report may consolidate observations into common issues for readability, but
the raw per-test evidence is never discarded.

**Why this matters:** If MUI Select, Ant Design Select, and Bootstrap
Dropdown all produce a Click instead of a Dropdown (3 observations, 1 root
cause), we need to know:
- **Frequency**: this root cause affects 3 of 15 framework tests (20%)
- **Distribution**: it spans 3 different frameworks, suggesting a systemic
  issue, not a framework-specific bug
- **Impact variation**: MUI Select may produce a fragile-but-functional
  locator (P2) while AGGrid cell click produces no locator at all (P1) —
  same root cause, different severity per framework

Collapsing these into one finding before analysis would lose this signal.

**Data structure:** Each observation is a `RawObservation` record:

```typescript
interface RawObservation {
  /** Unique ID: e.g., "FW-MUI-01" */
  observationId: string;
  /** Area: framework | locator | workflow | compound */
  area: 'framework' | 'locator' | 'workflow' | 'compound';
  /** The capability being tested: e.g., "A5 CustomDropdown" */
  capabilityId: string;
  /** The framework variant: e.g., "MUI", or null for non-framework tests */
  framework: string | null;
  /** Quality scores Q1-Q8 */
  scores: { q1: number; q2: number; q3: number; q4: number;
            q5: number; q6: number; q7: number; q8: number };
  /** Support level */
  support: 'full' | 'partial' | 'unsupported' | 'crash';
  /** What went wrong (concrete observation, not diagnosis) */
  observed: string;
  /** Root cause diagnosis (may be shared across observations) */
  rootCause: string;
  /** Category from §8.1 */
  category: 'implementation-gap' | 'capability-gap' | 'architectural-limitation'
          | 'framework-gap' | 'browser-limitation';
  /** Severity from §8.2 */
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  /** Subsystem from §8.3 */
  subsystem: string;
  /** Marker: simulated (synthetic DOM) vs verified (directly observable) */
  confidence: 'SIMULATED' | 'VERIFIED';
  /** Emitted interactions (for pipeline tests) */
  emittedInteractions?: unknown[];
  /** Generated Playwright code (for pipeline tests) */
  playwrightCode?: string | null;
}
```

**Storage:** All raw observations are persisted as a JSON file
(`.drytis/expanded-validation-observations.json`) alongside the
human-readable report. The report references observation IDs so any
consolidated finding can be traced back to its constituent observations.

**Consolidation rules:**
- Observations sharing the same `rootCause + subsystem` are grouped into
  a **Common Issue** in the report
- Each Common Issue lists the constituent observation IDs
- The Common Issue's severity is the **maximum** of its constituents
- The Common Issue's frequency is the **count** of constituents
- The Common Issue's distribution is the **set** of `(area, framework)`
  pairs across constituents

This structure ensures the raw evidence is always available for
re-analysis without re-running the validation.

---

## §9. Roadmap Consolidation

### 9.1 From Findings to Priorities

After all four validation areas are complete, findings are consolidated
into a prioritized roadmap using three factors:

1. **Severity**: P0 > P1 > P2 > P3
2. **Estimated Frequency**: How often does this pattern appear in real apps?
3. **Architectural Impact**: Does the fix strengthen the architecture or
   introduce a workaround?

### 9.2 Prioritization Matrix

| Priority | Criteria | Examples |
|----------|----------|---------|
| **Immediate** | P0 or P1 + high frequency + implementation gap | Misclassification on MUI Select (framework gap, high frequency) |
| **High** | P1 + medium frequency + implementation/framework gap | Locator quality on CSS-in-JS classes (affects replay fidelity) |
| **Medium** | P2 + any frequency + implementation gap | Missing assertion on modal close (quality improvement) |
| **Research** | P1/P2 + architectural limitation | Surface detection without real DOM (needs design work) |
| **Deferred** | P3 + low frequency + edge case | Non-ideal locator for SVG icons (rare pattern) |

### 9.3 Roadmap Output

The validation produces:
1. **Expanded Validation Report** (`.drytis/PHASE3_EXPANDED_VALIDATION_REPORT.md`)
   with all findings, categorized and prioritized
2. **Quality Score Matrix** updated with expanded coverage
3. **Recommended Phase 4 Scope** derived from findings

---

## §10. Risks, Assumptions, and Limitations

### 10.1 Risks to Validation Validity

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Synthetic events don't match real browser behavior | **High** | Findings may not reflect real-world issues | Mark all compound tests `[SIMULATED]`; document assumptions; defer DOM-dependent findings to browser testing |
| Test author bias in scoring | **Medium** | Quality scores may be subjective | Use concrete criteria for each score (§2.4); require specific evidence in each finding |
| Framework CSS patterns change between versions | **Low** | Tests may become stale | Test against current stable versions; document version assumptions |
| Missing scenarios we didn't think of | **High** | Blind spots remain | Acknowledge in report; the 4 areas are the known blind spots, not all possible blind spots |
| Test fixtures too clean | **Medium** | Real-world DOM is messier | Use realistic className strings with CSS-in-JS hashes, auto-generated IDs, Tailwind classes |

### 10.2 Explicit Assumptions

1. **Event sequences are predictable.** We assume we can predict what events
   a framework component emits. This is true for most components but may fail
   for components that use MutationObserver, requestAnimationFrame, or
   asynchronous state updates.

2. **ElementIdentity captures enough information.** The validation assumes
   that `ElementIdentity` (tag, id, name, className, ariaRole, accessibleName,
   etc.) captures enough DOM information for classification and locator
   generation. If real DOM elements have attributes not captured in
   `ElementIdentity`, both classification and locator quality could degrade.

3. **Framework patterns are stable.** We test against the CSS class patterns
   that current framework versions produce. Frameworks may rename classes
   (e.g., MUI v5 → v6) without notice.

4. **Quality scoring is consistent.** The same test author scores all tests,
   reducing inter-rater variability but introducing systematic bias.

### 10.3 What This Validation Does NOT Cover

| Not Covered | Why | When to Address |
|-------------|-----|----------------|
| Real replay execution | Requires browser extension runtime | Phase 5+ |
| Shadow DOM components | EventTap may not see shadow DOM events | After confirming basic patterns work |
| Cross-origin iframes | Security model prevents event capture | If real-world demand exists |
| Mobile/touch events | EventTap listens for mouse/keyboard events only | If mobile recording is in scope |
| Performance at scale (100+ interactions) | Not a quality concern, but a reliability concern | If users report lag |
| AI/LLM enrichment quality | AI features are not wired to a live model | After AI integration (if pursued) |
| Visual regression assertions | No visual comparison capability | Future feature |

### 10.4 Confidence Level of Results

| Area | Confidence | Rationale |
|------|-----------|-----------|
| Framework-specific patterns | **High** | CSS class patterns are well-documented and stable; the pipeline processes them deterministically |
| Locator quality | **High** | Locator ranking is a pure function; ElementIdentity → locators is fully testable |
| Multi-step workflows | **High** | Dedup, ordering, and IR generation are deterministic given the same input |
| Compound interactions | **Medium** | Synthetic events model assumed DOM behavior; findings about surface detection are indicative but not conclusive |

---

## §11. Test Inventory Summary

| Area | Test Files | Estimated Tests | Markers |
|------|-----------|----------------|---------|
| Framework patterns | `framework-mui.test.ts`, `framework-ant.test.ts`, `framework-radix.test.ts`, `framework-misc.test.ts` | ~40 | None |
| Locator quality | `locator-quality.test.ts` | ~20 | None |
| Multi-step workflows | `workflows.test.ts` | ~20 | None |
| Compound interactions | `compound-interactions.test.ts` | ~12 | `[SIMULATED]` |
| **Total** | 8 files | **~92 tests** | |

All tests use the existing harness infrastructure (`runFullPipeline`,
`recordFinding`, `QualityScores`). No new test framework or tooling is needed.

---

## §12. Exit Criteria

The validation is complete when **all five conditions** below are satisfied.
If any condition is not met, the validation continues or triggers another
cycle.

### 12.1 Completeness Conditions

| # | Condition | How to Verify |
|---|-----------|---------------|
| C1 | **Full scenario coverage.** Every scenario defined in §3.4 (framework), §4.2 (locator), §5.2 (workflow), and §6.2 (compound) has been exercised and produced a `RawObservation`. | Count observation IDs against scenario IDs — no gaps. |
| C2 | **Every observation is classified.** Each `RawObservation` has a category (§8.1), severity (§8.2), subsystem (§8.3), and root cause. | Query the observations JSON for null/empty fields. |
| C3 | **Root cause analysis is complete.** Every P0 and P1 observation has a diagnosed root cause, not just "unknown" or "needs investigation." P2/P3 observations may have a tentative root cause. | Filter observations where `severity ≤ P1 && rootCause == 'unknown'`. |
| C4 | **Consolidated roadmap is produced.** Observations are grouped into Common Issues (§8.4), each with a priority tier (§9.2) and recommended action. | The report has a Roadmap section with prioritized Common Issues. |
| C5 | **Blind spots are acknowledged.** The report explicitly lists what was NOT tested (§10.3) and what the `[SIMULATED]` limitations mean for confidence (§10.4). | The report has a Limitations section. |

### 12.2 What Triggers Another Validation Cycle

After this validation cycle completes, a new cycle is triggered when:

| Trigger | Rationale |
|---------|-----------|
| **A new capability is added** (new definition registered in `ALL_DEFINITIONS`) | The new capability has never been validated — needs at least one test in the harness |
| **A definition's `triggerEventTypes` or `detectTrigger` logic changes** | The change may affect classification on patterns that previously passed |
| **The locator ranking algorithm changes** (new strategy, different priority, new filtering rule) | All locator quality scenarios must be re-run |
| **A Pattern Registry plugin is added or modified** | Framework tests for that plugin must be re-run |
| **The IR Bridge or Enrichment Pass changes how assertions or locators are derived** | All pipeline-dependent tests (framework, workflow, compound) must be re-run |
| **Real browser testing reveals findings that contradict the programmatic validation** | The programmatic model was wrong — scenarios must be updated to match real behavior, then the full area re-run |

The trigger is not "we fixed some issues" — fixing issues found by the
validation does not require a new cycle. The trigger is when the
**pipeline's behavior or inputs change in a way that could affect
previously-validated results**.

### 12.3 Confidence Threshold for Implementation Decisions

The validation provides sufficient evidence to confidently prioritize
implementation work when:

1. **No area has "not tested" status** for any of its defined scenarios.
2. **Every P0/P1 finding has a root cause** (C3 above).
3. **The `[SIMULATED]` findings that drive a priority recommendation have
   been cross-checked** — either the same root cause appears in a
   `[VERIFIED]` test, or the architectural issue is clear enough that the
   simulation's accuracy doesn't change the recommendation.
4. **The priority tiers (§9.2) have clear separation** — the distinction
   between Immediate and High is driven by evidence, not by gut feel.

If condition 3 cannot be satisfied for a critical finding (i.e., a
`[SIMULATED]` P1 finding with no `[VERIFIED]` corroboration and an unclear
architectural mechanism), that finding is flagged as **"needs browser
testing"** rather than being used to drive an implementation priority.

---

## §13. Success Criteria for the Validation Itself

The validation is successful when:

1. **All four blind-spot areas have test coverage.** Every framework in
   §3.2, every locator scenario in §4.2, every workflow in §5.2, and every
   compound scenario in §6.2 has been exercised.

2. **Every test produces a structured Finding** with quality scores, support
   level, root cause, severity, and subsystem classification.

3. **Findings are consolidated into a prioritized roadmap** (§9) with clear
   Phase 4 recommendations.

4. **The quality score matrix covers all 22 capabilities × all frameworks
   where applicable** — no capability has "not tested" status.

5. **Blind spots are explicitly enumerated** — the report acknowledges what
   the validation does NOT cover (§10.3) so future work knows where
   additional validation is needed.

---

## §14. Implementation Plan (for Reference)

Once the design is approved, implementation follows this order:

1. **Locator quality tests first** — pure function testing, highest confidence,
   fastest to write. Results inform framework tests (we know locator behavior
   before testing framework-specific locator issues).

2. **Framework-specific tests second** — uses locator knowledge from step 1.
   Tests each framework's CSS patterns against definitions.

3. **Multi-step workflow tests third** — builds on single-interaction
   confidence from steps 1-2. Tests sequences and dedup.

4. **Compound interaction tests last** — lowest confidence (`[SIMULATED]`),
   most complex to construct. Benefits from understanding single-interaction
   behavior established in steps 1-3.

5. **Consolidate into report** — aggregate all findings, produce the
   prioritized roadmap.

This order ensures each step builds on the confidence of the previous one.
