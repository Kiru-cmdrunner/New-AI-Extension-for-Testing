# Phase 2 Design Document — Intelligent Interaction Understanding

> **Baseline:** Commit `4429746` (Phase 1 frozen, post-cleanup)
> **Status:** Approved — implementation in progress
> **Date:** July 2026
> **Revision:** 2 — incorporates evidence engine evolution and capability-gap analysis

---

## Executive Summary

Phase 1 produced a clean, well-tested foundation: a lifecycle-based Component Runtime with 19 definitions, an evidence classifier for ambiguous cases, an IR Bridge that generates executable test plans, and a Playwright code generator. The cleanup removed 40% of the codebase — every competing architecture is gone. There is one pipeline now.

Phase 2 evolves this single pipeline from **recording what happened** to **understanding what it means**. The architectural thesis is that the current foundation can be extended in place — no new pipeline, no new classification engine, no architectural revolution. What's needed is depth: unifying the classification path (including preserving the evidence engine's reasoning capabilities as a semantic annotation layer), completing interaction coverage, generating meaningful assertions, and building the enrichment layer that transforms raw recordings into an application knowledge model.

This document proposes four architectural thrusts, ordered by dependency:

1. **Unify the classification path** — close the capability gap, rewire the evidence engine as a post-classification semantic annotation layer, then retire the V1 fallback
2. **Deepen interaction coverage** — extend existing definitions for range selection, tree navigation, and autocomplete patterns
3. **Build the assertion engine** — derive validation expectations from interaction evidence
4. **Activate the enrichment layer** — extract DOM evidence at capture time to feed the knowledge model

---

## 1. Current Architecture Assessment

### 1.1 What Works Well

The Phase 1 architecture has genuine strengths that Phase 2 should preserve:

**The Component Runtime is the right abstraction.** Definition-driven lifecycle management (trigger → active → complete) is how real UI components work. A dropdown isn't three separate events — it's one lifecycle with a trigger, absorbed member events, and a completion signal. The 19 existing definitions (Click, Dropdown, DatePicker, Checkbox, TextEntry, Slider, Hover, etc.) cover the majority of real-world interactions.

**The evidence classifier has a clean core.** The core reasoning layer — `SemanticIntent` (6 intents), `IntentVote` (weighted evidence with audit trail), `fuseEvidence` (pure fusion function), and 6 evidence generators — has **zero dependencies** on the V1 classifier or any specific data type. It imports only from its own `./types` module. The coupling to V1 lives entirely in two adapter functions (`buildFeatureView` and `deriveType`) that translate between V1's types and the evidence engine's normalized interfaces. This means the reasoning capability is structurally independent and can be rewired to the Component Runtime with bounded changes.

**The IR Bridge is a stable contract.** The ExecutionIRPlan → Playwright code generation path works. The 12 IRAction values (CLICK, FILL, SELECT, SELECT_DATE, TOGGLE, HOVER, NAVIGATE, DRAG_DROP, PRESS_KEY, VERIFY, WAIT, WAIT_FOR_ELEMENT) form a complete execution vocabulary. Phase 2 should not change this contract.

**The repository layer is well-structured.** The UnitOfWork pattern, the Dexie-backed repositories, and the 9-table schema provide a solid persistence foundation. The capability enrichment model (match → create → enrich) supports cross-session learning.

### 1.2 The Real Production Flow

Before designing the evolution, we must understand what actually runs today. Tracing every call path through the service worker reveals the true flow:

**Primary path (every normal recording):**
```
EventTap (content script) → OBSERVED_EVENT → processObservedEvent()
  → ComponentRuntime.process() [19 definitions, lifecycle state machines]
  → ComponentInteraction[] emitted via onEmit callback
  → stopRecording() flushes runtime
  → adaptToDetected(allInteractions) → DetectedInteraction[]
  → runPipeline(engine='legacy') → domain adapter → enrichment → IR Bridge
```

**Fallback path (catch block at service-worker.ts:351):**
```
IF adaptToDetected() throws:
  → detectInteractions(events) [V1 classifier, 876 lines]
  → groupEvents() → classifyGroup() → classifyByEvidence()
  → DetectedInteraction[]
```

The critical fact: `detectInteractions()` — the entire 876-line V1 classifier plus the 6-file evidence engine — is reached in production **only when `adaptToDetected()` throws an exception**. It is a catch-block safety net, not a co-equal classification path.

Two structural consequences follow from this:

1. **The V2 domain adapter is dead.** `runPipeline()` accepts an `engine` parameter and has a superior interaction-centric adapter (`adaptToDomainEntitiesV2`, which produces 4–5× fewer transitions with richer evidence). But the service worker hardcodes `engine: 'legacy'`, so this adapter never runs. The event-centric legacy adapter produces noisier output with less evidence — a direct quality regression.

2. **The evidence engine is unreachable.** `classifyByEvidence()` is called only from the V1 detector's ambiguous-click branch, which only runs in the catch block. The evidence engine's intent inference, confidence scoring, and audit trail are dead in production. Its 77 passing tests validate a code path that's never exercised.

### 1.3 Structural Issues That Limit the System

**Issue 1: The V1 fallback handles interaction types the Component Runtime doesn't.**

Despite the Component Runtime being the primary path, the V1 classifier handles 5–6 interaction types that have no Component Definition:

| V1-only type | V1 detection logic | Component Runtime status |
|---|---|---|
| DoubleClick | `dblclick` event → standalone group | Falls to Click definition (no dblclick subtyping) |
| RightClick | `contextmenu` event → standalone group | Falls to Click definition (no contextmenu handling) |
| BrowserAlert | `triggeredDialog` in domContext | No definition exists |
| NewTab / NewWindow | `opensNewTab` / `opensNewWindow` in domContext | No dedicated definition (partially in Link) |
| Breadcrumb | className pattern matching | Falls to Click or Link |

Removing the V1 fallback without adding these as definitions would be a capability regression. This is the most important constraint on the retirement sequence.

**Issue 2: The type vocabulary is fragmented across three layers.**

| Layer | Vocabulary | Size | Purpose |
|-------|-----------|------|---------|
| Component Runtime | `InteractionType` in component-types.ts | 20 types | Lifecycle classification |
| Classifier | `InteractionType` in interaction-types.ts | 40+ types | Exhaustive union (V1 vocabulary) |
| IR Bridge | `IRAction` enum | 12 values | Execution actions |

A `Dropdown` in the Component Runtime becomes a `CustomDropdown` in the classifier, then a `SELECT` in the IR. A `Checkbox` might become `Checkbox` or `ToggleSwitch` depending on the subtype, then becomes `TOGGLE`. Every new interaction type requires touching all three vocabularies plus the adapter, the IR Bridge, and the Playwright renderer. This is the single biggest tax on extending the system.

**Issue 3: Assertions are decorative, not derived.**

The IR Bridge calls `deriveAssertions()` for every step, but the function produces minimal output — it checks for `metadata.assertions` if present, otherwise returns empty. The system knows what happened (before/after states, value changes, checked transitions) but doesn't use that knowledge to generate meaningful test assertions. A recording that fills a required field, selects a dropdown option, and toggles a checkbox should produce assertions verifying those values persisted — but today it produces none.

**Issue 4: The evidence engine's semantic capabilities are architecturally orphaned.**

The evidence engine was introduced to provide semantic reasoning (intent inference), confidence scoring, and explainability (evidence trails) — capabilities intended as the foundation for future AI-assisted reasoning. But it's wired into a dead code path. Retiring V1 without preserving these capabilities would lose the Phase 1 investment in semantic understanding.

---

## 2. Architectural Direction

### 2.1 Guiding Principle: Extend, Don't Rebuild

Phase 1's cleanup proved that the core architecture is sound. The Component Runtime + evidence classifier + IR Bridge pipeline is the right shape. Phase 2 deepens each layer rather than replacing any of them.

The specific commitments:

- **No new classification engine.** The Component Runtime is the classifier. Phase 2 retires the V1 fallback and removes the adapter layer.
- **The evidence engine survives as a semantic annotation layer.** Its core reasoning layer (types, fusion, generators) is V1-independent. Phase 2 rewires two adapter functions to connect it to the Component Runtime.
- **No new IR contract.** The `ExecutionIRPlan` / `IRStep` / `IRAction` types are frozen. Phase 2 adds assertion generation and readability improvements within this contract.
- **No new persistence schema.** The 9-table Dexie schema is sufficient. Phase 2 enriches the content of existing entities rather than adding tables.
- **No new content script.** The phase5 recorder + EventTap + identity extractor are the capture layer. Phase 2 adds a DOM evidence collector to the existing capture pipeline.

### 2.2 The Four Thrusts

```
Thrust 1: Unify Classification         Thrust 2: Deepen Coverage
───────────────────────────────        ─────────────────────────
Step A: Close capability gap           Stepper registration
  (DoubleClick, RightClick,            DatePicker range selection
   BrowserAlert, NewTab/NewWindow,     Dropdown tree + autocomplete
   Breadcrumb definitions)             Slider dual-handle
Step B: Rewire evidence engine
  (semantic annotation layer)
Step C: Switch to V2 domain adapter
Step D: Retire V1 fallback
Step E: Remove dead code
         ↓                                     ↓
         └───────────────┬─────────────────────┘
                         ↓
Thrust 3: Assertion Engine             Thrust 4: Enrichment Layer
───────────────────────────────        ─────────────────────────
Derive assertions from                 DOM evidence collection at
before/after states                    capture time (option sets,
Value change verification              validation rules, form context)
Required-field detection              Feed enrichment → assertions
Visibility/enablement checks
```

Thrust 1 must come first because it eliminates the adapter that loses lifecycle metadata needed by Thrust 3, and because it preserves the evidence engine in its new role. Thrust 2 can proceed in parallel with Thrust 1 once the capability gap is closed. Thrusts 3 and 4 depend on the unified classification path.

---

## 3. Thrust 1 — Unify the Classification Path

This thrust is the most structurally significant. It has five ordered steps, each independently deployable and independently revertable.

### 3.1 Step A: Close the Capability Gap

**Problem.** The V1 detector handles interaction types the Component Runtime doesn't have definitions for (DoubleClick, RightClick, BrowserAlert, NewTab/NewWindow, Breadcrumb). These must exist as Component Definitions before the V1 fallback can be safely removed.

**Design.** Create new `ComponentDefinition` files following the existing pattern (detectTrigger → isInScope → handleEvent → buildResult). Each is ~50–100 lines.

| New Definition | Priority | Trigger | Completion | Metadata |
|---|---|---|---|---|
| **DoubleClick** | 170 (before Click=180) | `dblclick` on interactive element | Immediate | `doubleClick: true` |
| **RightClick** | 175 (before Click=180) | `contextmenu` on interactive element | Immediate | `rightClick: true` |
| **BrowserAlert** | 15 (high priority, dialog detection) | `domContext.triggeredDialog` set | Next event after dialog | `dialogType`, `dialogMessage` |
| **NewTab** | 65 (same tier as Link) | `domContext.opensNewTab` on click | Immediate | `opensNewTab: true` |
| **NewWindow** | 65 | `domContext.opensNewWindow` on click | Immediate | `opensNewWindow: true` |
| **Breadcrumb** | 72 (before Link=70) | Click on element with breadcrumb className | Immediate | `breadcrumbLevel`, `crumbText` |

These definitions extend the `InteractionType` union. The IR Bridge maps them to existing IRAction values (most → `CLICK`, BrowserAlert → `WAIT`). No new IRAction values are needed.

**Scroll subtyping** is handled differently — the existing Scroll definition already captures both page and container scroll. The subtype distinction (`PageScroll` vs `ContainerScroll`) becomes a metadata field in `buildResult`, determined by whether the scroll target is the document body or a specific element.

**Validation.** Each definition gets a test file in `tests/definitions/`. The V1 detector's existing test cases for these types serve as the specification — the new definitions must produce equivalent or better classification for the same inputs.

**Rollback.** Don't register definitions in `ALL_DEFINITIONS` until tested. Registration is a one-line addition.

### 3.2 Step B: Rewire the Evidence Engine as a Semantic Annotation Layer

This is the critical architectural decision: the evidence engine must survive the V1 retirement, evolve from a dead-code-path branch into a post-classification annotation layer that runs on every interaction.

#### 3.2.1 Why the Evidence Engine Belongs Outside Definitions

The Component Runtime and the evidence engine solve fundamentally different problems:

- **Component Runtime** answers *"What type of interaction occurred?"* using lifecycle matching — event sequences, DOM context, state transitions, scope rules. For 17 of 19 definition types, the lifecycle IS the classification. No amount of evidence fusion would improve the classification.

- **Evidence Engine** answers *"What did the user semantically intend, and how confident are we?"* using multi-signal fusion — ARIA attributes, behavioral transitions, structural context, tag semantics — voting across 6 intents with confidence and a full audit trail. This matters precisely when lifecycle matching can't disambiguate: a bare `<div>` with `role="button"` and `aria-checked` could be a toggle, a trigger, or a navigate.

Embedding evidence logic inside `ComponentDefinition` methods would conflate classification with explanation, distribute reasoning across 19+ files, and make future strategy changes (probabilistic models, LLM-assisted reasoners) require touching every definition. The evidence engine belongs as a post-classification pass.

#### 3.2.2 The Coupling Map

The evidence engine's V1 coupling lives in two adapter functions, not in the core:

```
┌─────────────────────────────────────────────────────────────┐
│                    EVIDENCE ENGINE CORE                      │
│                                                             │
│  types.ts            ── ZERO imports (pure type defs)       │
│  intent-inference.ts ── imports only from ./types           │
│  generators.ts       ── imports only from ./types           │
│                                                             │
│  These three files are the semantic reasoning layer.        │
│  They are IntentVote[] → IntentClassification, pure.        │
└─────────────────────────────────────────────────────────────┘
         │                                    │
    ┌────┴───────────┐              ┌─────────┴──────────┐
    │  INPUT ADAPTER  │              │  OUTPUT ADAPTER     │
    │  feature-view.ts│              │  type-deriver.ts    │
    │                 │              │  evidence-classifier│
    │  Currently:     │              │  Currently maps to  │
    │  ElementIdentity│              │  classifier's 40+   │
    │  ElementRecorded │              │  InteractionType    │
    │  Event (V1 type)│              │  vocabulary         │
    └─────────────────┘              └─────────────────────┘
```

Rewiring = replacing these two adapters. The core reasoning layer doesn't change.

#### 3.2.3 The Annotation Layer Architecture

```
Component Runtime (classification)
    │
    ├── TextEntry definition ──→ ComponentInteraction { type: 'TextEntry' }
    ├── DatePicker definition ──→ ComponentInteraction { type: 'DatePicker' }
    ├── ...
    └── Click definition ──→ ComponentInteraction { type: 'Click' }
                                    │
                                    ▼
                    ┌───────────────────────────────────┐
                    │   Semantic Annotation Layer       │
                    │   (evidence engine, rewired)      │
                    │                                   │
                    │  For lifecycle definitions:       │
                    │    intent = TYPE_TO_INTENT[type]  │
                    │    confidence = 1.0               │
                    │    evidence = [lifecycle proof]   │
                    │                                   │
                    │  For Click (ambiguous fallback):  │
                    │    features = buildFeatureView()  │
                    │    votes = EVIDENCE_GENERATORS    │
                    │    result = fuseEvidence(votes)   │
                    │    type may be reclassified       │
                    └───────────────────────────────────┘
                                    │
                                    ▼
                    ComponentInteraction {
                      type: 'Checkbox',       // possibly reclassified
                      intent: 'toggle',       // semantic intent
                      confidence: 0.8,        // evidence-based
                      evidenceTrail: [...],   // audit trail
                    }
```

The annotation layer runs as a pass after the Component Runtime emits interactions but before they're persisted — the same pattern as the existing `enrichInteraction()` call in `sw-integration.ts:52`.

For lifecycle-based definitions (TextEntry, DatePicker, Slider, Dropdown, etc.), the annotation is a trivial static mapping: a type-to-intent lookup (`TextEntry → 'input'`, `DatePicker → 'select'`, `Checkbox → 'toggle'`) with confidence 1.0 and a synthetic evidence entry ("Lifecycle match: <definition type>"). No generators run.

For the Click definition (universal fallback where ambiguity lives), the full evidence pipeline runs: FeatureView is built from the trigger event, generators vote, fusion resolves, the type may be reclassified (Click → Checkbox, Click → Link, Click → ToggleSwitch), and confidence + evidence trail are attached.

#### 3.2.4 The Five Migration Sub-Steps

| Sub-step | What changes | How to measure | Rollback |
|---|---|---|---|
| **B1: Rewire input adapter** | Change `buildFeatureView()` to accept `ObservedEvent` + `ElementIdentity` (Component Runtime types) instead of `ElementRecordedEvent` (V1 type). The `FeatureViewInput` interface doesn't change — generators receive the same shape. ~20-line change to one function. | All evidence engine unit tests still pass (they test generators, not the adapter) | Revert one function |
| **B2: Simplify output adapter** | Change `deriveType()` to map to the Component Runtime's 20-type vocabulary instead of the classifier's 40+ types. Fewer mappings, cleaner. | Evidence calibration suite (23 scenarios) passes with same 0-misclassification rate | Revert one function |
| **B3: Add evidence fields to ComponentInteraction** | Extend `ComponentInteraction` with optional `intent?: SemanticIntent`, `confidence?: number`, `evidenceTrail?: IntentVote[]` | TypeScript compiles; no runtime change (fields are optional) | Remove fields |
| **B4: Build the annotation layer** | Create `annotateWithEvidence(interaction: ComponentInteraction): ComponentInteraction` that runs the evidence pipeline for Click interactions and applies static mapping for lifecycle definitions | Every interaction in a test recording has intent + confidence + evidenceTrail | Don't call the annotation function |
| **B5: Wire annotation into the pipeline** | Call `annotateWithEvidence` in the `onEmit` callback or post-flush pass, before persistence | Full regression suite passes; evidence fields present on persisted interactions | Remove the call |

#### 3.2.5 What Survives, What Changes, What's Lost

| Component | Status | Reasoning |
|---|---|---|
| `SemanticIntent` (6 intents) | **Preserved unchanged** | Core type, zero dependencies |
| `IntentVote` (weighted evidence) | **Preserved unchanged** | Core type, zero dependencies |
| `fuseEvidence()` (fusion strategy) | **Preserved unchanged** | Pure function, the swap point for future AI strategies |
| 6 evidence generators | **Preserved unchanged** | Pure functions of FeatureViewInput |
| `FeatureViewInput` interface | **Preserved unchanged** | Already normalized, generators don't care about source |
| `buildFeatureView()` | **Rewired** (V1 types → Component Runtime types) | ~20 lines, one function |
| `deriveType()` | **Simplified** (40+ types → 20 types) | Fewer mappings, cleaner |
| Evidence calibration data | **Preserved** | Re-run against unified architecture to confirm 0 misclassifications |
| Confidence scoring | **Extended** (now on ALL interactions, not just ambiguous clicks) | Lifecycle definitions get confidence 1.0 + synthetic evidence |
| Evidence trails | **Extended** (now on ALL interactions) | Every interaction can answer "why was it classified this way?" |

**Nothing is lost.** The semantic reasoning capability, confidence scoring, evidence trails, and the extension point for AI-assisted reasoning all survive intact.

### 3.3 Step C: Switch to the V2 Domain Adapter

**Problem.** The service worker hardcodes `engine: 'legacy'` at pipeline-runner.ts:371, using the event-centric domain adapter that produces noisy transitions (one per raw event). The interaction-centric V2 adapter (`adaptToDomainEntitiesV2`) produces 4–5× fewer transitions with richer evidence — but it's never used.

**Design.** Change one line:

```typescript
// Before:
const pipelineResult = runPipeline(events, mergedInteractions, sessionId, sourceUrl, 'legacy');

// After:
const pipelineResult = runPipeline(events, mergedInteractions, sessionId, sourceUrl, 'control');
```

This activates `adaptToDomainEntitiesV2`, which creates one transition per interaction (not per raw event), extracts richer stateBefore/stateAfter from metadata fields, and builds a more complete evidence array.

**Validation.** Differential testing: run both adapters on the golden test recordings and compare transition count, evidence quality, and IR Bridge output.

**Rollback.** Revert one line.

### 3.4 Step D: Retire the V1 Fallback

**Problem.** The V1 classifier (`detectInteractions()`) is called in a catch block when `adaptToDetected()` throws. After Steps A–C, every interaction type has a Component Definition and the evidence engine provides the ambiguous-click resolution that was the V1 classifier's unique value.

**Design.** Replace the catch-block fallback with a defensive adapter:

```typescript
// Before (V1 safety net):
try {
  mergedInteractions = adaptToDetected(allInteractions);
} catch (e) {
  mergedInteractions = detectInteractions(events);  // ← V1 fallback
}

// After (defensive adapter):
mergedInteractions = adaptToDetected(allInteractions, { skipOnerror: true });
// adaptToDetected wraps each interaction adaptation in try/catch internally,
// skipping malformed interactions rather than failing the entire batch.
// A non-empty assertion guarantees we never produce zero interactions.
```

The adapter itself becomes robust: per-interaction try/catch, skip malformed data, log warnings. This is better than an entire parallel classifier because it handles the actual failure mode (one malformed interaction) without the complexity of a full reclassification.

**Validation.** Fuzz test: inject malformed ComponentInteractions and verify the defensive adapter produces partial results (skipping bad ones) rather than throwing. Verify the full regression suite passes with the V1 fallback removed.

**Rollback.** Re-add the catch block.

### 3.5 Step E: Remove Dead Code

After Steps A–D are validated:

- Delete `src/classifier/interaction-detector.ts` (876 lines)
- Delete `src/generation/component-to-classifier-adapter.ts` (218 lines — the lossy adapter)
- Remove `DetectedInteraction` type usage from the pipeline (the IR Bridge consumes `ComponentInteraction` directly)
- Delete V1-specific test files (`tests/interaction-detector.test.ts`, etc.)
- Remove the `recorderEngine` feature flag (no longer needed)
- Remove the `engine` parameter from `runPipeline` (only one path remains)

**Estimated removal:** ~1,500 lines of source + ~1,000 lines of tests.

### 3.6 Risk Assessment

**Medium risk overall, decomposed per step:**

| Step | Risk | Reason |
|---|---|---|
| A (definitions) | Low | Each definition is isolated, follows a proven pattern, and has V1 tests as the specification |
| B (evidence rewire) | Low | Core layer is untouched; only two adapter functions change; calibration suite validates behavior |
| C (V2 adapter) | Low | One-line change; adapter already exists and is tested |
| D (retire V1) | Medium | Removes safety net; mitigated by defensive adapter and Steps A–C closing all gaps |
| E (remove dead code) | Low | Mechanical deletion of files no longer imported |

The overall risk is bounded by the incremental checkpoint structure. Each step is independently validated and independently revertable.

---

## 4. Thrust 2 — Deepen Interaction Coverage

### 4.1 Current State

After Thrust 1 Step A adds the V1-only types, the remaining gaps are extensions to existing definitions:

| Type | Status | Gap |
|------|--------|-----|
| Stepper | Definition exists (`stepper.ts`) but **not registered** in `ALL_DEFINITIONS` | One-line fix: add to registry |
| DatePicker (range) | Single-date only | No dual-selection lifecycle |
| Dropdown (tree) | Flat options only | No expand/collapse node tracking |
| Dropdown (autocomplete) | Detected as generic Dropdown | No fillInput → select downcast |
| Slider (range) | Single-handle only | No dual-handle tracking |

### 4.2 Design

**Register Stepper.** Add to `ALL_DEFINITIONS` at priority 55 (between RadioButton and TagInput). Verify the IR Bridge generates `CLICK` steps for increment/decrement with `metadata.stepperSubActions`.

**Extend DatePicker for range selection.** The current DatePicker definition completes after one selection. For range pickers (common in travel/booking apps), the definition should stay active after the first date and complete after the second. The detection signal: the date picker surface remains open after the first selection (no blur, no surface closure). The metadata expands to `{ startDate, endDate }`.

**Extend Dropdown for autocomplete downcast.** When a Dropdown session detects a `fillInput` subAction (text typed into the trigger) followed by an option selection, set `subtype: 'Autocomplete'`. This is metadata enrichment within the existing lifecycle — the Dropdown definition already tracks subActions.

**Extend Dropdown for tree navigation.** Add `expandNode` and `collapseNode` to the SubActionType union. When a click inside the dropdown surface toggles `aria-expanded` on a treeitem element, record it as a tree subAction. The IR Bridge generates intermediate CLICK steps for expand/collapse.

**Extend Slider for range tracking.** When the Slider definition detects a mousedown on a second handle after the first was dragged, track both values. The completion carries `{ startValue, endValue }`.

### 4.3 Implementation Pattern

Each extension follows the established pattern:

1. Modify the definition's `handleEvent` or `buildResult` to track the new signal
2. Update the metadata extraction in `buildResult`
3. Add the new subtype to the IR Bridge's step generation
4. Add the Playwright rendering (if the action changes)
5. Write tests for the new lifecycle behavior

### 4.4 Risk Assessment

**Low risk.** Each extension is isolated to one definition file. The definition's `handleEvent` method is the only logic that changes. The downcast protocol (already proven for Dropdown → Autocomplete) handles type refinement safely.

---

## 5. Thrust 3 — The Assertion Engine

### 5.1 Problem

The current `deriveAssertions()` function in the IR Bridge returns empty unless `metadata.assertions` is explicitly present. The system records rich before/after state but doesn't convert it into test assertions. Generated Playwright tests have no `expect()` calls.

### 5.2 Design

Build an assertion derivation layer that reads the interaction's evidence and produces IRAssertion objects. The layer sits between the Component Runtime and the IR Bridge:

```
ComponentInteraction → AssertionDeriver → IRStep (with assertions)
```

**Assertion derivation rules:**

| Interaction Evidence | Derived Assertion | IRAssertion Type |
|---------------------|-------------------|------------------|
| TextEntry with `valueAfter` | Target value equals `valueAfter` | `equals` |
| Dropdown with `selectedValue` | Target value equals `selectedValue` | `equals` |
| Checkbox with `checkedAfter: true` | Target is checked | `is_true` |
| Checkbox with `checkedAfter: false` | Target is unchecked | `is_false` |
| Navigation with `url` | Page URL equals `url` | `url_equals` |
| DatePicker with `dateValue` | Target value equals `dateValue` | `equals` |
| Slider with `sliderValue` | Target value equals `sliderValue` | `equals` |
| Required field filled | Target is not empty | `presence` |
| Element was disabled after | Target is disabled | `is_true` |
| Configuration session fields | Each field value equals configured value | `equals` (per field) |

**Playwright rendering:**

| IRAssertion Type | Playwright Code |
|-----------------|----------------|
| `equals` (value) | `await expect(locator).toHaveValue(expected)` |
| `equals` (text) | `await expect(locator).toHaveText(expected)` |
| `is_true` (checked) | `await expect(locator).toBeChecked()` |
| `is_false` (checked) | `await expect(locator).not.toBeChecked()` |
| `url_equals` | `await expect(page).toHaveURL(expected)` |
| `presence` | `await expect(locator).toBeVisible()` |

### 5.3 Assertion Severity

- **`must` assertions** — derived from direct state changes the user initiated (value entered, option selected). Core verification: "did the action take effect?"
- **`should` assertions** — derived from secondary evidence (field was required, element was enabled). Advisory: "this property should hold."
- **`may` assertions** — derived from cross-interaction patterns (after form submit, page should show success). Requires the enrichment layer (Thrust 4). Future work.

Phase 2 implements `must` and `should`.

### 5.4 Risk Assessment

**Low risk.** Assertions are additive — they don't change existing step generation. If the assertion deriver produces nothing, the IR Bridge falls back to the current behavior (empty assertions).

---

## 6. Thrust 4 — The Enrichment Layer

### 6.1 Problem

The system records interactions but doesn't understand the application's structure. It knows "the user clicked a dropdown and selected 'Premium Economy'" but doesn't know what other options were available, whether it's required, or what form section it belongs to.

### 6.2 Design: DOM Evidence Collection

Add a **DOM Evidence Collector** to the capture layer that runs at interaction completion time (when the user finishes an interaction, before the next one starts). This collector reads the live DOM around the target element and extracts contextual evidence.

```typescript
interface DOMEvidence {
  /** The target element's form context, if inside a <form>. */
  formContext?: {
    formId?: string;
    formName?: string;
    fieldCount: number;
    requiredFieldCount: number;
  };

  /** For dropdowns/selects: the full option set visible at capture time. */
  optionSet?: Array<{
    value: string;
    label: string;
    selected: boolean;
    disabled: boolean;
  }>;

  /** Validation attributes on the target element. */
  validationRules?: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: string;
    max?: string;
    step?: string;
    acceptedFileTypes?: string;
  };

  /** The target element's section/landmark context. */
  sectionContext?: {
    landmarkRole?: string;
    headingText?: string;
    sectionLabel?: string;
  };
}
```

**Collection strategy:** The collector runs in the content script (needs DOM access), triggered by the Component Runtime's `completeComponent`. At that point, the DOM is in the post-interaction state. The collector is bounded — walks only form ancestors and option children, max depth 3. Collection takes <2ms per interaction.

### 6.3 What the Enrichment Layer Enables

| DOM Evidence | Derived Assertion |
|-------------|-------------------|
| `validationRules.required: true` | After form submit, target has a value |
| `validationRules.maxLength: 50` | Target value length ≤ 50 |
| `optionSet` | Selected value is in the option set |
| `formContext.requiredFieldCount` | All required fields filled before submit |

| Knowledge | Source | Consumer |
|-----------|--------|----------|
| Option sets | `domEvidence.optionSet` | Negative test generation (Phase 3) |
| Validation rules | `domEvidence.validationRules` | Boundary value testing |
| Form structure | `domEvidence.formContext` | Workflow-level reasoning |
| Section context | `domEvidence.sectionContext` | Locator disambiguation |

### 6.4 Risk Assessment

**Medium risk.** This is the most complex thrust because it adds a new collection path to the content script. Risks: performance (mitigated by bounded traversal), timing (mitigated by synchronous collection in `completeComponent`), and cross-origin iframes (mitigated by per-frame collection).

---

## 7. Data Flow After Phase 2

```
DOM Event
  → EventTap (capture)
  → Identity Extractor (18-field snapshot)
  → DomContext capture
  → [NEW] DOM Evidence Collector (option sets, validation rules, form context)
  → ObservedEvent → sessionStorage buffer → service worker
  → Component Runtime (definitions, lifecycle-based)
  → ComponentInteraction[] (unified type)
  → [NEW] Semantic Annotation Layer (evidence engine — intent + confidence + trail)
  → [NEW] Assertion Derivation (from before/after states + validation rules)
  → V2 Domain Adapter (interaction-centric, no event fan-out)
  → Enrichment Orchestrator
  → IR Bridge (consumes ComponentInteraction directly, no adapter)
      → IRStep[] (with assertions)
      → Readability optimization
  → Playwright Code Generator
      → .spec.ts with expect() calls
  → persistSession → Dexie/IndexedDB
```

**Key differences from Phase 1:**
- The V1 classifier, adapter, and DetectedInteraction type are gone
- The evidence engine runs on every interaction as a semantic annotation layer
- The V2 domain adapter is active (fewer transitions, richer evidence)
- Assertions are derived from interaction evidence and DOM evidence
- DOM evidence flows from capture to generation

---

## 8. What Phase 2 Does NOT Do

- **No AI/LLM integration.** The system remains fully deterministic. AI is a future consumer of the knowledge model. The evidence engine's `fuseEvidence` function is the designated swap point for future AI-assisted reasoning — generators and FeatureView don't change when a probabilistic or LLM-based strategy replaces the current weighted-sum fusion.

- **No execution model changes.** The `IRExecutor` and runtime healing system are unchanged.

- **No UI/UX changes.** The side panel, settings page, and repository page are unchanged.

- **No cross-domain expansion.** Mobile/API/desktop remains a future possibility. Phase 2 is web-only.

- **No negative test generation.** The enrichment layer produces the knowledge needed for negative tests, but generating them is a Phase 3 capability.

---

## 9. The Evidence Engine as Future AI Bridge

The rewired evidence engine is the designated integration point for future AI-assisted reasoning. The evolution path:

1. **Current (Phase 2):** Deterministic fusion — weighted-sum of evidence generator votes
2. **Near-future:** Contextual enrichment — additional generators that read DOM evidence (option sets, validation rules) to produce more nuanced intent votes
3. **AI-assisted (Phase 3+):** An LLM-based reasoner reads the `FeatureViewInput` (normalized, privacy-safe) and `IntentVote[]` audit trail, then produces additional evidence votes or adjusts confidence based on contextual understanding

The `fuseEvidence` function is the swap point. The generators, FeatureView, and intent vocabulary don't change. This is the exact evolution path the original Phase 1 design intended — preserved through the V1 retirement by keeping the core reasoning layer intact.

---

## 10. Architectural Decisions Summary

| Decision | Rationale | Risk |
|----------|-----------|------|
| Close capability gap before retiring V1 | Prevents capability regression on V1-only types | Low — follows proven pattern |
| Rewire evidence engine as annotation layer | Preserves semantic reasoning; runs on all interactions | Low — core layer untouched |
| Retire V1 classifier + adapter after capability gap closed | Redundant once definitions exist; removes dual-path complexity | Medium — safety net removed, mitigated by defensive adapter |
| Switch to V2 domain adapter | 4–5× fewer transitions, richer evidence | Low — one-line change |
| Derive assertions from interaction evidence | Transforms action scripts into verification suites | Low — additive |
| Add DOM evidence collector | Enables contextual assertions and knowledge model depth | Medium — new capture path, bounded scope |
| Keep IR contract frozen | Stable execution layer | None |
| Keep repository schema unchanged | Sufficient | None |

---

## 11. Success Criteria

Phase 2 is complete when:

1. **Single classification path** — The V1 classifier, adapter, and `DetectedInteraction` type are removed. The Component Runtime is the sole classifier. All regression tests pass without them.

2. **Evidence engine integrated** — Every interaction carries a semantic intent, confidence score, and evidence trail. Lifecycle definitions get confidence 1.0 with synthetic evidence. Ambiguous clicks are resolved by the full evidence pipeline. The 23-scenario calibration suite shows 0 misclassifications.

3. **Full interaction coverage** — All interaction types have working definitions, including V1-only types (DoubleClick, RightClick, BrowserAlert, NewTab/NewWindow, Breadcrumb). Stepper is registered. DatePicker handles ranges. Dropdown handles autocomplete and tree patterns. Slider handles ranges.

4. **Meaningful assertions** — Generated Playwright tests include `expect()` calls for value assertions, navigation assertions, and required-field presence assertions.

5. **DOM evidence flows** — The enrichment layer produces InteractionContracts with option sets and validation rules extracted from the live DOM.

6. **Zero TypeScript errors** — Source code passes `tsc --noEmit` with zero errors throughout.

7. **All tests pass** — The existing regression suite passes at every stage. New tests cover the evidence annotation layer, assertion engine, DOM evidence collector, new definitions, and unified classification path.

---

## 12. Dependency Order

```
Thrust 1, Step A (Close capability gap — add V1-only definitions)
  ↓ enables
Thrust 1, Step B (Rewire evidence engine — semantic annotation layer)
  ↓ enables                    ↕ parallel
Thrust 1, Step C (Switch V2 adapter)    Thrust 2 (Deepen coverage)
  ↓ enables
Thrust 1, Steps D–E (Retire V1, remove dead code)
  ↓ enables
Thrust 3 (Assertion Engine)
  ↓ benefits from
Thrust 4 (Enrichment Layer)
```

Within each thrust and step, work is incremental and test-driven. No step requires a "big bang" change — each is a series of small, validated, revertable changes.

---

## Conclusion

Phase 2 is an evolution, not a revolution. The Phase 1 foundation — Component Runtime, evidence classifier, IR Bridge, Playwright adapter, repository layer — is the right architecture. Phase 2 deepens it: closes the capability gap, rewires the evidence engine as a universal semantic annotation layer (preserving the full Phase 1 investment in semantic reasoning), retires the redundant V1 path, completes the interaction taxonomy, adds the assertion layer that turns action scripts into verification suites, and builds the enrichment layer that gives the system contextual understanding of the application.

The evidence engine's evolution is the keystone of this phase. By moving it from a dead-code-path branch into a post-classification annotation layer, we preserve its semantic reasoning capabilities, extend them to every interaction (not just ambiguous clicks), and establish it as the designated bridge for future AI-assisted reasoning — exactly as the Phase 1 design intended.

The result is a system that doesn't just record what the user did, but understands what it means — what changed, what should be verified, and what the application's structure implies about correct behavior. That understanding is the foundation for everything that comes next.
