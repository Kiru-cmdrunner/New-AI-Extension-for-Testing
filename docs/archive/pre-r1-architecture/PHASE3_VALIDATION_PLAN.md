# Phase 3 — Real-World Validation Plan

## Capability-Driven Approach

Validation is organized by **interaction capability**, not by website. Each capability
is a hypothesis: "the recorder correctly handles X." We select applications that
collectively exercise every capability, then record findings per-capability.

The output is a **capability coverage matrix** with evidence — not a pass/fail per site.

---

## Capability Inventory (22 capabilities)

Derived from the system's 23 component definitions, 8 locator strategies, evidence
engine, assertion deriver, and enrichment layer.

### Group A — Form Input (6 capabilities)

| ID | Capability | Definitions Exercised | Key Risk |
|----|-----------|----------------------|----------|
| A1 | **Text entry** — native inputs, textareas, password fields | TextEntry | Value capture on masked/autofilled inputs; blur timing on SPAs |
| A2 | **Checkbox / toggle** — native checkboxes, ARIA switches, custom toggle components | Checkbox | Distinguishing Checkbox vs ToggleSwitch; checked-state assertion |
| A3 | **Radio button** — native radio groups, custom radio cards | RadioButton | Group membership; only selected value captured |
| A4 | **Dropdown — native** — `<select>` elements | Dropdown → NativeDropdown | Option text vs value mismatch; multi-select |
| A5 | **Dropdown — custom** — ARIA combobox, JS-rendered option lists | Dropdown → CustomDropdown, Autocomplete, SearchableDropdown | Surface lifecycle timing; typeahead vs select distinction; subAction capture |
| A6 | **Date picker** — native date inputs, calendar widgets | DatePicker, DateRangePicker | Surface-bound lifecycle; date format variability; range selection |

### Group B — Click Interactions (4 capabilities)

| ID | Capability | Definitions Exercised | Key Risk |
|----|-----------|----------------------|----------|
| B1 | **Plain click** — buttons, generic divs | Click (universal fallback) | Evidence annotation on ambiguous clicks; noise filtering |
| B2 | **Link navigation** — same-page links, cross-page links, programmatic navigation | Link, NewTab, NewWindow, Navigation | SPA route changes vs full navigation; target=_blank detection |
| B3 | **Double-click / right-click** | Click → DoubleClick, RightClick | Event type detection (dblclick, contextmenu) |
| B4 | **Tab / breadcrumb** — tab panels, breadcrumb trails | Tab, Breadcrumb | Ancestor class detection accuracy |

### Group C — Advanced Interactions (5 capabilities)

| ID | Capability | Definitions Exercised | Key Risk |
|----|-----------|----------------------|----------|
| C1 | **Hover** — tooltips, hover-dropdowns, preview cards | Hover | Confidence gating (0.7 threshold); accidental hover capture |
| C2 | **Slider** — native range inputs, ARIA sliders, dual-handle range sliders | Slider → NativeSlider, AriaSlider, RangeSlider | Value extraction; drag lifecycle vs click |
| C3 | **Drag and drop** — HTML5 DnD, sortable lists, Kanban boards | DragDrop → Html5DragDrop, MouseDragDrop | mousedown→drag→mouseup lifecycle; click suppression |
| C4 | **File upload** — native file inputs, drag-drop upload zones | FileUpload, DragDropUpload | File metadata capture; dialog handling |
| C5 | **Stepper / counter** — increment/decrement controls (passengers, quantity) | Stepper | DOM-proximity grouping; delta calculation; subAction capture |

### Group D — Specialized Inputs (3 capabilities)

| ID | Capability | Definitions Exercised | Key Risk |
|----|-----------|----------------------|----------|
| D1 | **Tag input / chip input** — multi-value tokenized inputs | TagInput | Focus→type→Enter/comma→repeat lifecycle; delimiter detection |
| D2 | **OTP input** — multi-box one-time password inputs | OtpInput | Adjacent input grouping; partial entry |
| D3 | **Rich text editor** — Quill, CKEditor, ProseMirror, Slate, TinyMCE | TextEntry → RichTextEditor | Framework detection accuracy; HTML content vs plain text |

### Group E — Compound & Structural (2 capabilities)

| ID | Capability | Definitions Exercised | Key Risk |
|----|-----------|----------------------|----------|
| E1 | **Multi-config dropdown** — flight booking panels (steppers + selects + toggles + confirm) | Dropdown + structural-enrichment | subAction capture completeness; ConfigurationSession derivation; field-based IR expansion |
| E2 | **Modal dialog** — confirmation modals, form dialogs, async-appear modals | ModalDialog | Surface detection; async appearance timing; subAction capture inside modal |

### Group F — Cross-Cutting Concerns (2 capabilities)

| ID | Capability | Subsystems Exercised | Key Risk |
|----|-----------|---------------------|----------|
| F1 | **Locator quality** — testId, aria, role, CSS, XPath, text | All locator strategies (8 types, 5 confidence tiers) | Auto-generated ID filtering; CSS-in-JS class detection; iframe locator chaining; locator ranking correctness |
| F2 | **Iframe interactions** — payment forms, embedded widgets, nested iframes | Frame capture, frame tree, frameLocator codegen | Cross-origin frame enrichment; nested frame chaining; same-origin selector extraction |

---

## Application Selection Matrix

Applications chosen to maximize capability coverage with minimum overlap.
Each application targets specific capabilities — no app is tested for capabilities
it doesn't exercise.

### Tier 1 — Public, No-Auth-Required (Primary)

| App | URL | Targeted Capabilities | Why This App |
|-----|-----|----------------------|--------------|
| **OrangeHRM Demo** | orangehrm.com/demo (My Info page) | A1, A2, A3, A4, A5, A6, B1, B2, F1 | Dense form with every input type; custom dropdowns; date picker; OXD framework |
| **Amazon** | amazon.com (search + product page) | B1, B2, B3, C1, C2, C5, D1, F1 | Quantity steppers, hover preview cards, tag-style search, carousel, dense ARIA |
| **Booking.com** | booking.com (search flow) | A1, A5, C1, C5, E1, F1 | Multi-config dropdown (guests/rooms), date range picker, autocomplete city search |
| **Wikipedia** | en.wikipedia.org | B1, B2, F1 | Simple semantic HTML; baseline for locator quality on well-structured pages |
| **Trello** | trello.com (public board) | C3, B1, B2, F1 | Drag-and-drop Kanban; SPA route changes; dynamic class names |
| **React Spectrum (Adobe)** | react-spectrum.adobe.com (components) | A2, A5, C2, C1, E2, F1 | Radix-based patterns; ARIA-compliant sliders, comboboxes, dialogs |
| **MUI Component Playground** | mui.com/material-ui/react-* | A2, A5, C2, D1, D3, E2, F1 | MUI framework detection; auto-generated IDs (Mui-*); rich component variety |

### Tier 2 — Focused Pattern Tests (Supplementary)

| App | URL | Targeted Capabilities | Why This App |
|-----|-----|----------------------|--------------|
| **Stripe Payment Form (demo)** | stripe.com/docs/payments/checkout | F2, A1, B1 | Cross-origin iframe payment fields; locator chaining into Stripe iframe |
| **YouTube** | youtube.com | B2, C1, B4, F1 | SPA navigation without page reload; hover preview; tab navigation; ARIA-heavy |
| **Google Forms** | forms.new | A1, A2, A3, A4, B1, F1 | Server-rendered form patterns; radio/checkbox groups; clean locators |
| **CodePen / JSFiddle** | codepen.io | D3, C3, B1 | Rich text editor (CodeMirror); iframe code panes; drag-and-drop file upload |
| **Airbnb** | airbnb.com | A5, A6, C5, E1, C1, F1 | Autocomplete with typeahead; date range calendar; guest stepper; map hover cards |

### Tier 3 — Stress Conditions (Edge Cases)

| App / Condition | Targeted Capabilities | Why |
|-----------------|----------------------|-----|
| **Shadow DOM widget** (webcomponents.dev) | B1, F1, A1 | Shadow boundary traversal; locator inside shadow root |
| **SPA with hash routing** | B2 | Hash-based navigation detection (#/route) |
| **Infinite scroll feed** (Twitter/X, Reddit) | B1, B2 | Scroll noise filtering; dynamic content load |
| **Contenteditable rich editor** (Notion-like) | D3 | Framework-agnostic contenteditable; HTML extraction |

---

## Quality Dimensions (8)

Every recorded interaction is scored across **8 quality dimensions**, not just
supported/unsupported. Each dimension is scored on a 1–5 scale with specific
criteria. This produces a per-capability quality profile that reveals *where*
the system breaks down, not just *whether* it does.

### Q1 — Intent Accuracy (classification correctness)

Did the recorder understand what the user was actually doing?

| Score | Meaning |
|-------|---------|
| 5 | Exact type + subtype; unambiguously correct |
| 4 | Correct type, slightly imprecise subtype (e.g. Click instead of Link) |
| 3 | Correct category but wrong specific type (e.g. Hover instead of Click) |
| 2 | Captured as generic Click when a more specific type should have fired |
| 1 | Wrong classification or no classification at all |

**Assesses**: Component Runtime definition matching, evidence engine reclassification

### Q2 — Abstraction Fidelity (representation granularity)

Was the interaction represented at the right level? Not over-fragmented (one
text entry split into 4 steps), not under-captured (a compound dropdown
collapsed into a single click losing internal field changes).

| Score | Meaning |
|-------|---------|
| 5 | Perfect: one cohesive interaction at the right granularity |
| 4 | Minor over-fragmentation or slight context loss (e.g. 2 steps where 1 suffices) |
| 3 | Moderate fragmentation (3+ steps for one logical interaction) OR a compound interaction missing some sub-actions |
| 2 | Severe fragmentation (many tiny steps) or compound interaction entirely flattened to a click |
| 1 | Unusable representation — the recording doesn't reflect what happened |

**Assesses**: Event coalescing, lifecycle management, subAction capture, structural enrichment

### Q3 — Locator Quality (robustness and readability of element targeting)

Are the generated locators semantically meaningful, resilient to DOM changes,
and ranked correctly?

| Score | Meaning |
|-------|---------|
| 5 | Top locator is `data-testid` or role+name; resilient and readable |
| 4 | Top locator is aria-label+role or stable ID; good resilience |
| 3 | Top locator is CSS selector or name attribute; works but fragile |
| 2 | Only XPath or deeply nested CSS available; would break on minor DOM changes |
| 1 | No usable locator; auto-generated/filtered ID as primary |

**Assesses**: Locator ranking algorithm, auto-generated ID filtering, CSS-in-JS class detection, iframe locator chaining

### Q4 — Semantic Description (human readability of generated text)

Are the timeline description and IR step description meaningful to a human?
Would a non-technical reviewer understand what happened?

| Score | Meaning |
|-------|---------|
| 5 | Clear, specific, action-oriented ("Enter email \"john@test.com\"") |
| 4 | Understandable but generic ("Click \"Submit\"") or missing the value |
| 3 | Vague ("Click on element") or includes raw technical details |
| 2 | Misleading or confusing description |
| 1 | Empty or nonsensical |

**Assesses**: actionDescription(), generateDescription(), generatePlainEnglish(), metadata-to-label mapping

### Q5 — Replay Fidelity (would the generated code work?)

If you ran the generated Playwright code, would it correctly reproduce the
interaction? This is assessed by code review, not execution (we can't run
Playwright against live sites from here).

| Score | Meaning |
|-------|---------|
| 5 | Code would replay correctly as-is |
| 4 | Code is correct but uses a suboptimal action (e.g. click instead of fill for text entry) |
| 3 | Code is mostly correct but would need a minor manual fix (e.g. timing/wait issue) |
| 2 | Code has a significant error (wrong action, wrong locator strategy) |
| 1 | Code would completely fail to replay |

**Assesses**: IRAction mapping, Playwright action-renderer, execution parameters, wait strategy

### Q6 — Confidence Calibration (does the score match reality?)

Does the confidence score appropriately reflect the certainty of the
classification? High confidence should mean the classification is definitely
correct; low confidence should flag genuine uncertainty.

| Score | Meaning |
|-------|---------|
| 5 | Confidence matches reality (high when classification is clearly correct, low when ambiguous) |
| 4 | Slightly over/underconfident but directionally correct |
| 3 | Meaningfully miscalibrated (e.g. 0.9 confidence on a wrong classification) |
| 2 | Confidence score present but uninformative |
| 1 | No confidence score, or always 1.0/0.5 regardless of ambiguity |

**Assesses**: Evidence engine fusion, per-definition confidence, endState→confidence mapping

### Q7 — Evidence Quality (audit trail completeness and correctness)

For evidence-annotated interactions: is the evidence trail present, correct,
and does it point to the right semantic intent?

| Score | Meaning |
|-------|---------|
| 5 | Full evidence trail; each vote correctly reasoned; intent is obvious from the trail |
| 4 | Evidence present and mostly correct; minor gap in reasoning |
| 3 | Evidence present but thin or partially incorrect |
| 2 | Minimal evidence (1-2 votes); doesn't justify the classification |
| 1 | No evidence trail on an interaction that should have one |

**Assesses**: Evidence generators (6), intent inference fusion, evidence trail serialization

### Q8 — Assertion Value (are derived assertions meaningful?)

Are the derived assertions correct, non-trivial, and useful for verifying
replay success? Not just "is there an assertion" but "would this assertion
actually catch a failure?"

| Score | Meaning |
|-------|---------|
| 5 | Multiple meaningful assertions that verify the interaction's outcome |
| 4 | At least one correct, useful assertion |
| 3 | Assertion present but weak (e.g. checks element exists, not its value) |
| 2 | Assertion present but wrong (incorrect expected value or property) |
| 1 | No assertion, or assertion is trivially always-true |

**Assesses**: State-based assertion derivation, constraint-based assertions, ApplicationKnowledgeFragment integration

---

## Validation Protocol (Per Capability)

For each capability, run this 5-step protocol:

### Step 1: Record
Perform the interaction on the target application. Record the raw interaction
using the extension. Note the exact element, expected behavior, and any
visual anomalies during recording.

### Step 2: Inspect Classification
Open the timeline. Score:
- **Q1 (Intent Accuracy)**: Did the correct type + subtype fire?
- **Q6 (Confidence Calibration)**: Does the confidence match the clarity of the match?
- **Q7 (Evidence Quality)**: Is the evidence trail present and correctly reasoned?
- **Metadata completeness**: Are all expected metadata fields populated?

### Step 3: Inspect IR Generation
Export the test case. Score:
- **Q2 (Abstraction Fidelity)**: Is the interaction at the right granularity?
- **Q3 (Locator Quality)**: Are locators semantically meaningful and correctly ranked?
- **Q4 (Semantic Description)**: Are step descriptions human-readable?
- **Q8 (Assertion Value)**: Are assertions correct and meaningful?

### Step 4: Inspect Playwright Output
Read the generated Playwright code. Score:
- **Q5 (Replay Fidelity)**: Would the code replay correctly?

### Step 5: Record Scores and Classify Support Level

Compute the **capability quality score** = average of Q1–Q8 (rounded to 1 decimal).
Then classify overall support:

| Level | Quality Score | Definition |
|-------|--------------|------------|
| ✅ **Full** | 4.0–5.0 | Correctly classified, well-represented, reliable replay, meaningful output |
| ⚠️ **Partial** | 2.5–3.9 | Works but with quality issues in one or more dimensions |
| ❌ **Unsupported** | < 2.5 | Wrong classification, missing capture, or unreplayable output |
| 🔍 **Not Tested** | N/A | Capability not exercised by this app |

---

## Finding Documentation Template

Each finding is recorded as:

```markdown
### [Capability ID] — Finding Title

**App**: <name>
**Element**: <CSS selector or description>
**Expected**: <what should happen>
**Observed**: <what actually happened>

**Quality Scores**:
| Q1 Intent | Q2 Abstraction | Q3 Locator | Q4 Description | Q5 Replay | Q6 Confidence | Q7 Evidence | Q8 Assertion | **Avg** |
|-----------|----------------|------------|----------------|-----------|---------------|-------------|--------------|---------|
|     5     |       4        |     3      |       5        |     4     |       3       |      4      |      2       |  **3.8** |

**Support Level**: ⚠️ Partial

**Weakest Dimensions** (score ≤ 3):
- Q3 Locator: <what's wrong — e.g. "only CSS selector available, data-testid ignored">
- Q8 Assertion: <what's wrong — e.g. "asserts element visible but not the input value">

**Root Cause**:
<Which subsystem is responsible: definition recognition, metadata capture, locator
ranking, IR mapping, assertion derivation, evidence engine, Playwright rendering>

**Severity**: P0 (recording fails) | P1 (replay fails) | P2 (suboptimal output)

**Evidence**:
- Timeline screenshot / interaction JSON
- IR plan excerpt
- Playwright code excerpt
```

---

## Capability Quality Assessment Matrix

The validation produces **two matrices**:

### Matrix 1: Coverage (is the capability supported?)

```
         | OrangeHRM | Amazon | Booking | Wikipedia | Trello | Spectrum | MUI | Stripe | ...
A1 Text  |    ✅     |   -    |   ✅    |    -      |   -    |    -     |  -  |   ✅   | ...
A2 Check |    ✅     |   -    |   -     |    -      |   -    |    ✅     | ✅  |   -    | ...
...
```

### Matrix 2: Quality scores (how well does it work?)

```
         | OrangeHRM | Amazon | Booking | Wikipedia | Trello | Spectrum | MUI | Stripe | ... | **Cap Avg**
A1 Text  |   4.5     |   -    |  4.2    |    -      |   -    |    -     |  -  |  3.8   | ... |   4.2
A2 Check |   4.8     |   -    |   -     |    -      |   -    |   4.5    | 4.0 |   -    | ... |   4.4
...
```

The **Cap Avg** column reveals which capabilities are strong (avg ≥ 4.0) and
which need work. The **per-app scores** reveal whether a problem is
app-specific (e.g. only fails on MUI's auto-generated IDs) or systemic
(fails everywhere).

### Dimension Heatmap (which quality dimensions are weakest?)

```
         |  Q1  |  Q2  |  Q3  |  Q4  |  Q5  |  Q6  |  Q7  |  Q8  |
A1 Text  | 4.8  | 4.5  | 3.5  | 4.7  | 4.3  | 4.0  | 3.8  | 3.2  |
A2 Check | 4.9  | 4.8  | 4.2  | 4.6  | 4.5  | 4.0  | 4.0  | 3.5  |
...
**Dim Avg**| 4.7 | 4.5  | 3.8  | 4.5  | 4.2  | 3.5  | 3.5  | 3.1  |
```

The **Dim Avg** row reveals systemic weaknesses across all capabilities. If Q3
(Locator) and Q8 (Assertion) consistently score low across all capabilities,
that tells us the next implementation work should focus on the locator ranking
algorithm and assertion derivation engine — regardless of which specific
capabilities have issues.

This dimension-level view is what turns raw findings into an implementation
roadmap: the lowest-scoring dimensions across the most capabilities define
the highest-impact improvement areas.

---

## Execution Discipline

> **This is an observation pass. Do not fix, optimize, or refactor anything
> discovered during validation.** Every finding is documented — even seemingly
> trivial ones — with evidence, root cause, and severity. The complete body of
> evidence is reviewed holistically *after* the pass to prioritize implementation
> work. Fixing issues mid-pass distorts the data: it hides related failures,
> makes it impossible to assess per-capability quality fairly, and prevents
> systemic patterns from emerging.

Specifically:
- **No code changes during the pass.** Not even "quick fixes" or "obvious
  improvements." If a typo is noticed, note it — don't fix it.
- **Document every finding, even if it seems minor.** A P2 today may reveal
  a systemic pattern when combined with other P2s across capabilities.
- **Classify by subsystem.** Whether the failure is in definition recognition,
  metadata capture, locator ranking, IR mapping, assertion derivation, evidence
  engine, or Playwright rendering — this attribution is what makes the final
  prioritization possible.
- **Score honestly.** If the output is technically correct but produces a
  fragile locator, that's a 3 on Q3, not a 5. Resist the urge to round up.

---

## Execution Order

1. **Tier 1 first** — covers 20 of 22 capabilities. Run all 7 apps.
2. **Gap analysis** — which capabilities have no ✅ after Tier 1?
3. **Tier 2 to fill gaps** — focused apps for remaining capabilities.
4. **Tier 3 for stress** — edge cases that probe architectural limits.

---

## Architectural Questions to Answer

Beyond per-capability validation, the pass must answer:

1. **Is the 23-definition priority cascade correct?**
   Do high-priority lifecycle definitions (DragDrop@15, Dropdown@20) ever
   incorrectly consume events meant for lower-priority definitions?

2. **Is the evidence engine's 0.5 reclassification threshold correct?**
   Are there real-world Click interactions that get wrongly reclassified
   (false positives) or fail to be reclassified (false negatives)?

3. **Are auto-generated ID filters comprehensive?**
   Do the current patterns (React `:r*:`, MUI `mui-*`, Angular `ng-*`, etc.)
   cover all frameworks encountered? Are any stable IDs incorrectly filtered?

4. **Is the surface detection (modal/drawer/popover) reliable?**
   Does it work across MUI, Ant Design, Bootstrap, Radix, HeadlessUI?

5. **Does subAction capture work on real multi-config dropdowns?**
   The structural enrichment (ConfigurationSession) was designed for flight
   booking patterns. Does it generalize to other compound dropdowns?

6. **Is scroll noise filtering too aggressive or too lenient?**
   Are meaningful scroll-to-load interactions captured, or filtered as noise?

7. **Does the assertion deriver produce assertions that actually verify?**
   Are the derived assertions correct on replay, or do they produce false
   failures (wrong expected value, wrong property)?

8. **Is the per-definition confidence homogeneous and uninformative?**
   If every interaction scores 1.0 (because endState='completed' maps to 1.0),
   the confidence dimension is useless. Do genuinely ambiguous interactions
   on real apps produce lower scores? Is there meaningful variance?

9. **Does the evidence trail fire on real-world ambiguity?**
   The evidence engine was designed for ambiguous Click interactions. On real
   applications, how often does it actually run? When it runs, are the
   reclassifications correct? When it doesn't run, were there interactions
   that would have benefited from it?

These questions are answered by the evidence gathered during the capability
validation pass — not by separate testing.
