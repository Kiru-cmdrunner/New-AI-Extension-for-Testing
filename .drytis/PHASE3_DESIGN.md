# Phase 3 Design Document — Type System Unification & Real-World Validation

**Status:** Draft for review
**Date:** 2026-07-31
**Baseline:** Commit `c158e59` (Phase 2 complete)
**Prior design:** `.drytis/PHASE2_DESIGN.md` (Revision 2)

---

## 1. Context: Where We Are

### 1.1 What Phases 1 and 2 Built

The recorder now has a complete vertical pipeline: a browser extension captures user interactions, a Component Runtime classifies them through 23 priority-dispatched definitions, an evidence engine annotates each interaction with semantic intent and confidence, an IR Bridge translates to executable actions, an assertion engine derives state and constraint validations, and a Playwright renderer produces self-healing test code. The repository layer persists everything through a clean UnitOfWork pattern.

Phase 1 built the foundation and removed ~26,000 lines of dead code. Phase 2 unified the classification path (retired the V1 fallback in production), rewired the evidence engine as a semantic annotation layer, completed the assertion engine, and closed five of six V1-only capability gaps.

### 1.2 The Structural Debt That Remains

Phase 2 unified the *classification logic* but could not finish unifying the *type vocabulary*. The production pipeline today flows through three separate type systems:

```
Component Runtime              Classifier Pipeline              IR Bridge
────────────────               ────────────────────              ─────────
InteractionType (23)           InteractionType (46)              IRAction (12)
component-types.ts:220         interaction-types.ts:13           ir-bridge.ts:55

These are bridged by:
  adaptInteraction()           component-to-classifier-adapter.ts (243 lines)
  INTERACTION_TO_IR_ACTION     ir-bridge.ts:55-113 (46 entries, 19 dead)
  INTERACTION_TO_OPERATION     domain-adapter-v2.ts:40-90 (46 entries, 19 dead)
```

Every map between these vocabularies is typed `Record<string, …>` — the compiler cannot detect when a type is added to a union but not to a map, or when a map references a type that nothing produces. This is not theoretical: the researcher found 19 of 46 classifier types that can never be produced by the Component Runtime, stale comments claiming "13 types" and "40 types" when the real counts are 23 and 46, and scroll types mapped to `IRAction.CLICK` in the map but unconditionally filtered as noise — dead branches that can never execute.

### 1.3 Why This Matters Now

This duplication is not a cosmetic concern. It is the last structural seam from the V1→V2 migration, and it taxes every future change:

- **Adding a new interaction type** requires touching three unions and three maps across four files, none of which the compiler validates against each other.
- **Debugging a classification bug** requires reasoning across two type vocabularies and an adapter that performs lossy translation.
- **Integrating AI reasoning** requires a clean, consistent vocabulary for an LLM to operate over — three overlapping vocabularies with 19 phantom types is the opposite of that.
- **Test coverage gives false confidence** — 55 tests validate the dead V1 classifier, and the adapter's tests pass on mappings to types the runtime can never produce.

Finishing this unification is the prerequisite for everything the long-term vision requires.

---

## 2. Design Principles

This phase is governed by four principles, in priority order:

1. **No behavioral change.** Every generated test, every classification decision, every assertion, every evidence annotation must produce identical output before and after. The refactor is purely structural — if any output changes, that's a bug, not an improvement.

2. **One type vocabulary.** A single `InteractionType` union — the one the Component Runtime produces — flows through the entire pipeline. No adapter, no translation layer, no secondary vocabulary.

3. **Compiler-enforced completeness.** Maps keyed on `InteractionType` use the actual union type, not `Record<string, …>`. When a type is added to the union, the compiler immediately flags every map that needs updating. Exhaustive switch statements replace fallthrough defaults.

4. **Delete dead code.** The V1 classifier, its type vocabulary, the adapter, and their tests are removed. We do not maintain code that production never executes.

---

## 3. Thrust 1: Type System Unification

### 3.1 The Target Architecture

After this thrust, the pipeline has exactly one type vocabulary:

```
Component Runtime
  InteractionType (unified — ~26 values)
  ComponentInteraction (type + typed subtype enum + metadata)
       │
       ├──► Evidence Annotation Layer
       │      annotateWithEvidence(ci) → ci with intent/confidence/evidenceTrail
       │
       ├──► IR Bridge
       │      INTERACTION_TO_IR_ACTION keyed on unified InteractionType
       │      build(): ExecutionIRPlan
       │
       └──► Domain Adapter V2
              adaptToDomainEntitiesV2(): DomainEntities
              INTERACTION_TO_OPERATION keyed on unified InteractionType
```

No `DetectedInteraction`. No `ClassifierInteractionType`. No adapter. The Component Runtime's `InteractionType` is the vocabulary, period.

### 3.2 The Unified Type Vocabulary

The current Component Runtime has 23 types. The adapter currently fans out to ~27 classifier types via `interactionSubtype`. The unified vocabulary absorbs those subtypes as typed members rather than untyped strings.

**Proposed unified `InteractionType`** (~26 values):

| Group | Types | Source |
|---|---|---|
| **Core interactions** | `Click`, `DoubleClick`, `RightClick` | Click definition currently uses untyped `interactionSubtype` — promote to typed union members |
| **Text input** | `TextEntry`, `RichTextEditor` | RichTextEditor currently a metadata flag on TextEntry — promote to type (definition detects `contenteditable`) |
| **Selection** | `Dropdown`, `NativeDropdown`, `Autocomplete`, `MultiSelect`, `Checkbox`, `ToggleSwitch`, `RadioButton` | Dropdown currently fans via subtype; Checkbox→ToggleSwitch currently a metadata hack in the adapter |
| **Date/time** | `DatePicker` | TimePicker/DateTimePicker collapsed into DatePicker metadata (time fields) — no separate definitions exist and none are planned |
| **Range** | `Slider` | RangeSlider stays as metadata, not a separate type (same definition, same lifecycle) |
| **Files** | `FileUpload`, `DragDrop` | DragDropUpload collapsed into FileUpload (same definition handles both) |
| **Navigation** | `Link`, `Tab`, `Breadcrumb`, `NewTab`, `NewWindow`, `Navigation`, `Back`, `Forward`, `Refresh` | Navigation currently fans via metadata; Back/Forward/Refresh currently only in classifier vocabulary |
| **Containers** | `ModalDialog`, `Stepper` | |
| **Input patterns** | `TagInput`, `OtpInput`, `HotkeySequence`, `KeyboardShortcut`, `Hover` | |
| **Scroll** | `Scroll` | PageScroll/ContainerScroll/InfiniteScroll collapse into one type with a `scrollTarget` metadata field — the scroll definition already handles both page and container; InfiniteScroll was never implemented |

**Explicitly dropped from the vocabulary** (19 phantom types the Component Runtime never produces):

| Phantom Type | Why It's Removed |
|---|---|
| `Menu` | No definition, no detection logic. Menu interactions are classified as `Click`. |
| `Modal`, `Drawer`, `Popover` | These are *surface types*, not interaction types. ModalDialog definition handles all three via surface detection. The distinction belongs in `surfaceType` metadata, not the type vocabulary. |
| `Tooltip` | No interaction — it's a visual state. Hover definition already captures tooltip binding. |
| `BrowserAlert` | No definition, no detection. `window.alert`/`confirm`/`prompt` are fundamentally different (synchronous browser dialogs). If needed, this is a Phase 4 definition, not a phantom type kept in the vocabulary. |
| `Iframe` | Not an interaction — it's a frame context flag. Already tracked in `DomContext.frameId`. |
| `InfiniteScroll` | Never implemented. Scroll definition handles all scroll. |
| `DragDropUpload` | Same definition as FileUpload. |
| `TimePicker`, `DateTimePicker` | DatePicker definition handles all date/time. Metadata carries time fields. |
| `Unknown` | Noise filter drops it anyway. Click definition is the universal fallback. |

**The `interactionSubtype` field is eliminated.** Where subtypes are meaningful (DoubleClick/RightClick under Click, NativeDropdown/Autocomplete/MultiSelect under Dropdown), they become first-class union members. Where they're metadata distinctions (ToggleSwitch styling, RangeSlider, container vs. page scroll), they stay in metadata — but typed metadata, not untyped strings.

### 3.3 Migration Strategy

The migration follows a strict five-step sequence. Each step leaves the codebase compiling and tests passing. No step is merged until the previous is verified.

#### Step 1: Introduce the Unified Vocabulary (additive)

Create the unified `InteractionType` in `src/shared/component-types.ts` as a superset of the current 23 types. This is purely additive — existing code continues to use the 23-type subset and compiles unchanged.

```
src/shared/component-types.ts:
  export type InteractionType = 'Click' | 'DoubleClick' | ... (~26 values)
```

Add a typed `InteractionSubtype` concept is NOT introduced — the subtypes are promoted to full union members. The `interactionSubtype?: string` field on `ComponentInteraction` is deprecated with a `@deprecated` JSDoc tag but not removed yet.

**Verification:** `tsc --noEmit` passes. All 3,000 tests pass. No behavioral change — the new types exist but nothing produces them yet.

#### Step 2: Rewire the IR Bridge to the Unified Vocabulary

The IR Bridge currently imports `DetectedInteraction` and `InteractionType` from `src/classifier/interaction-types.ts`. This step changes its input type to `ComponentInteraction` and keys its map on the unified `InteractionType`.

Concretely:
- `ir-bridge.ts`: Change import from `../classifier/interaction-types` to `../shared/component-types`.
- `IRBridgeInput.interactions`: Change type from `DetectedInteraction[]` to `ComponentInteraction[]`.
- `INTERACTION_TO_IR_ACTION`: Rewrite keyed on the unified union. This map shrinks from 46 entries to ~26 — one per real type. Use an exhaustive record type (`Record<InteractionType, IRAction | 'NOISE'>`) so the compiler enforces completeness.
- Replace the separate `NOISE_TYPES` set with a `'NOISE'` sentinel value in the map — scroll types map to `'NOISE'` and are filtered in `build()`. This eliminates the current inconsistency where scroll types are mapped to `CLICK` but then filtered by a separate set.
- Update all metadata access: currently the bridge reads `DetectedInteraction.metadata` (typed `InteractionMetadata`). After this step, it reads `ComponentInteraction.metadata` (typed `Record<string, unknown>`). The bridge's existing per-type metadata access patterns remain the same — it already uses string-keyed access — but the adapter's metadata translation is eliminated because the bridge reads component metadata directly.

**The metadata translation currently in `component-to-classifier-adapter.ts` (lines 116–242) is moved into the IR Bridge itself** — but simplified. The adapter currently does two things: (1) type mapping (eliminated by the unified vocabulary) and (2) field renaming (`meta.selectedDate` → `result.dateValue`). The field renaming is eliminated by having definitions emit canonical metadata field names directly. A short audit of each definition's `buildResult` output confirms whether field names already match what the bridge expects; mismatches are fixed at the definition level.

**Verification:** `tsc --noEmit` passes. IR Bridge tests pass — but the tests currently use `DetectedInteraction` fixtures. These test fixtures are rewritten to `ComponentInteraction` shape. Test assertions on generated IR steps remain identical.

#### Step 3: Rewire the Domain Adapter V2

`domain-adapter-v2.ts` currently takes `DetectedInteraction[]`. Change it to take `ComponentInteraction[]`. Rewrite `INTERACTION_TO_OPERATION` keyed on the unified union (~26 entries, exhaustive record).

**Verification:** `tsc --noEmit` passes. Domain adapter tests pass with rewritten fixtures.

#### Step 4: Rewire the Evidence Engine's type-deriver

`type-deriver.ts` currently maps `SemanticIntent` → classifier `InteractionType` (46-value). It produces types like `ToggleSwitch`, `NewTab`, `NewWindow`, `Link`, `Hover`, `Click`. All of these exist in the unified vocabulary. The import changes from `../interaction-types` to `../../shared/component-types`. The two stub branches (`select` → `Click`, `input` → `Click`) remain stubs — they're future work, not type debt.

**Verification:** `tsc --noEmit` passes. Evidence engine tests pass.

#### Step 5: Rewire the Pipeline Runner and Service Worker

`pipeline-runner.ts` currently takes `DetectedInteraction[]`. Change it to take `ComponentInteraction[]`. The service worker's call to `adaptInteractions()` (which converts `ComponentInteraction` → `DetectedInteraction`) is removed — the pipeline receives `ComponentInteraction` directly.

This is the step that makes the adapter dead code.

**Verification:** Full integration test — record a session, run the pipeline, generate IR, render Playwright code. Output must be byte-identical to pre-refactor output.

#### Step 6: Delete Dead Code

Now that nothing references the classifier vocabulary or the adapter:

- Delete `src/classifier/interaction-detector.ts` (879 lines) and its tests.
- Delete `src/classifier/interaction-types.ts` (the 46-value union, `DetectedInteraction` interface, `InteractionMetadata` type, `TYPE_DISPLAY` map, `INTERACTION_CATEGORIES` map — all dead).
- Delete `src/generation/component-to-classifier-adapter.ts` (243 lines) and its tests.
- Delete `src/classifier/evidence/feature-view.ts`'s V1 adapter function (the `buildFeatureView` that reads `ElementRecordedEvent`) — the annotation layer's version remains.
- Remove the `interactionSubtype?: string` field from `ComponentInteraction` and update the 3 definitions that set it (Click sets `DoubleClick`/`RightClick`, Dropdown sets subtype variants, Scroll sets target type) to set `type` directly as union members.
- Remove the `engine: 'legacy' | 'control'` parameter from `runPipeline()` — legacy is dead.
- Delete `src/recorder/v2/domain-adapter-v1.ts` (the legacy domain adapter) if it still exists.

**Estimated deletion:** ~1,800 lines of source + ~800 lines of tests = ~2,600 lines removed.

**Verification:** `tsc --noEmit` clean. All remaining tests pass. `grep -r 'DetectedInteraction' src/` returns zero hits. `grep -r 'ClassifierInteractionType' src/` returns zero hits.

### 3.4 Risk Analysis: Type System Unification

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Metadata field names drift** — definitions emit `selectedDate` but bridge expects `dateValue` | Medium | High — generates wrong assertions | Audit every definition's `buildResult` output against the bridge's metadata access patterns. Create a snapshot test that records the full metadata shape for each interaction type. |
| **Promoting subtypes changes priority dispatch** — e.g., DoubleClick as a separate type might fire before Click | Low | Medium — classification changes | DoubleClick/RightClick are detected *inside* the Click definition's `handleEvent` and `buildResult`. They don't become separate definitions — they're separate *types* emitted by the same definition. Priority dispatch is unchanged. |
| **Removing `interactionSubtype` breaks consumers** that read it | Medium | Medium | The field is read in: the adapter (being deleted), the IR Bridge (being rewired), and the evidence annotation layer (already uses `ci.type`). Full grep before removal. |
| **Domain adapter V2 has hidden coupling** to `DetectedInteraction` fields beyond `.type` | Low | Medium | The adapter accesses `.metadata`, `.elementIdentity`, `.timestamp` — all of which exist on `ComponentInteraction` with compatible shapes. Step 3's test rewrite will surface any mismatch. |
| **Test fixtures are tightly coupled** to `DetectedInteraction` shape | High | Low — tedious but mechanical | Rewrite fixtures incrementally, one test file at a time. Use a migration helper that maps old fixture shape to new. |
| **A definition sets `interactionSubtype` to a value not in the unified union** | Low | High — type error blocks compilation | This is actually a *benefit* — the compiler catches it. Pre-audit all `interactionSubtype` assignments in definitions. |

### 3.5 What Does NOT Change

- **Component definition lifecycle** (`detectTrigger → isInScope → handleEvent → buildResult`) — unchanged.
- **Priority dispatch** — unchanged. 23 definitions, same priorities, same trigger patterns.
- **Evidence annotation layer** — unchanged. `annotateWithEvidence()` runs the same way, produces the same `intent`/`confidence`/`evidenceTrail`.
- **Assertion engine** — unchanged. `deriveStateAssertions()` and `constraintToAssertions()` read metadata fields that don't change.
- **Playwright renderer** — unchanged. It consumes `ExecutionIRPlan`, which is downstream of the type vocabulary.
- **Repository layer** — unchanged. It persists domain entities, not interaction types.
- **IR Bridge output** (`ExecutionIRPlan`) — structurally identical. Same `IRAction` enum, same `IRStep` shape, same readability merge rules.

---

## 4. Thrust 2: Real-World Validation

### 4.1 Rationale

The system has 23 definitions, 3,000 tests, and a complete pipeline. But "tests pass" means "the code does what the tests check" — and the tests were written alongside the code, testing the same mental model. They cannot tell us whether the system correctly classifies interactions on a real React form with styled-components, or whether the generated locators survive a production deployment.

Real-world validation is the only honest way to discover what actually breaks. It is not about building new features — it is about discovering the gap between "works in tests" and "works on real applications."

### 4.2 Validation Methodology

The validation consists of recording interactions on a curated set of real applications, then analyzing the full pipeline output at each stage. This is manual exploratory testing — not automated regression.

#### Application Categories

The goal is diversity of interaction patterns, UI frameworks, and application complexity:

| Category | Example Archetypes | What It Tests |
|---|---|---|
| **E-commerce checkout** | Multi-step form, payment, cart | TextEntry, Dropdown, Checkbox, Button, form validation, SPA navigation |
| **SaaS dashboard** | Data tables, filters, settings panels | Dropdown, Tab, complex composite components, Modal dialogs |
| **Admin CRUD** | Create/edit/delete with confirmation dialogs | Modal lifecycle, destructive-action confirmation, form submission |
| **Multi-step wizard** | 4+ step onboarding or configuration | Stepper, form state, conditional fields, progress tracking |
| **SPA with client-side routing** | React Router, Vue Router, Next.js | Navigation detection, URL change without page load |
| **iframe-containing app** | Legacy admin, embedded widgets | Frame context, cross-frame interaction sequencing |
| **Shadow DOM app** | Web Components, Lit, Stencil | Element targeting through shadow boundary |
| **Design-system app** | Material-UI, Ant Design, Chakra UI | Component detection, ARIA patterns, framework-specific class structures |
| **Drag-and-drop interface** | Kanban board, file upload zone | DragDrop lifecycle, drop-zone detection |
| **Rich media / non-standard** | Maps, canvas, complex widgets | Edge cases, graceful degradation |

#### Recording Protocol

For each application:
1. **Install the extension** in a clean Chrome profile.
2. **Perform a scripted task** (e.g., "search for a product, add to cart, checkout, complete payment").
3. **Capture the full recording** — all events, all classifications, all evidence annotations.
4. **Export the pipeline output** at each stage: raw events, ComponentInteractions, IR plan, generated Playwright test.
5. **Execute the generated test** against the same application.
6. **Record failures** at each stage: missed interactions, misclassifications, broken locators, failed assertions, execution errors.

#### Analysis Dimensions

For each recording, evaluate:

| Dimension | Question | How Measured |
|---|---|---|
| **Capture completeness** | Did the recorder see every meaningful interaction? | Compare recording transcript against manual task description. Flag any user action with no corresponding interaction. |
| **Classification accuracy** | Did the Component Runtime assign the correct type? | Manual judgment per interaction. Flag any type that seems wrong. |
| **Evidence quality** | Do the intent labels and confidence scores make sense? | Review the evidence trail for each interaction. Flag cases where intent seems wrong or confidence seems miscalibrated. |
| **Locator stability** | Do the generated selectors work on replay? | Execute the test. Count locator failures and self-healing triggers. |
| **Assertion validity** | Do the derived assertions hold? | Execute the test. Count assertion failures. Distinguish real bugs from over-specified assertions. |
| **IR readability** | Is the generated test understandable by a human? | Manual readability review. Flag confusing step ordering, missing context, or unclear actions. |

### 4.3 What Validation Produces

Validation is not a pass/fail gate — it is a discovery process. The output is a **prioritized defect catalog** organized by:

1. **Systematic failures** — patterns that break across multiple applications (e.g., "all Ant Design dropdowns misclassified" or "SPA navigation not detected on React Router v6"). These indicate architectural gaps that need targeted investment.
2. **Edge-case failures** — one-off issues that can be fixed with definition tweaks (e.g., "specific calendar widget not recognized"). These feed into a defect backlog.
3. **Locator fragility patterns** — classes of selectors that break. These may indicate the locator strategy needs fundamental rethinking (Phase 4 candidate).
4. **Evidence calibration data** — real-world cases where the intent/confidence thresholds produce wrong results. These calibrate the evidence engine.

This catalog directly informs Phase 4 scope. It replaces speculation with evidence.

### 4.4 Scope Boundaries

Validation does NOT include:
- Building an automated test harness for real apps (that's Phase 4+).
- Implementing fixes during validation (catalog first, fix later).
- Performance benchmarking (separate concern).
- Cross-browser testing (Chrome-only, matches the extension's runtime).

---

## 5. Explicitly Excluded from Phase 3

| Excluded Item | Rationale |
|---|---|
| **AI/LLM integration** | The `fuseEvidence` swap point is clean and waiting. Augmenting an unproven deterministic system with probabilistic AI introduces too many variables. Prove the deterministic foundation first. |
| **Negative test generation** | Requires an application state model that does not exist yet. Phase 4+ concern. |
| **New interaction definitions** | Validation reveals which are actually needed. Adding definitions speculatively on top of a unified (but unproven) system compounds complexity. |
| **Application state model** | The raw material (before/after state capture, evidence trails) exists. Building the model is Phase 4, after validation confirms the data is sufficient. |
| **Locator strategy overhaul** | Current strategy (ranking + self-healing) may be adequate. Validation determines whether it needs fundamental work or targeted improvement. Decide after data. |
| **Evidence calibration** | Thresholds are designed, not calibrated. Calibration requires real-world data, which Thrust 2 collects. Actual calibration is early Phase 4. |

---

## 6. How Phase 3 Moves Toward the Long-Term Vision

The long-term vision is **a robust, intelligent interaction understanding system that works across all modern web applications**. Phase 3 contributes to each dimension:

### Robustness

The type system unification eliminates a class of bugs that are currently impossible to catch at compile time: a type added to one union but not another, a map entry for a type that nothing produces, a subtype string that doesn't match any union member. After Phase 3, the compiler enforces type completeness across the entire pipeline. This is structural robustness — the kind that prevents entire categories of bugs from existing.

Real-world validation is the other kind of robustness — empirical. It answers "does this actually work?" rather than "does this compile?" The defect catalog it produces is the roadmap for targeted hardening in Phase 4.

### Intelligence

The evidence engine today operates on a clean annotation layer with six semantic intents, confidence scoring, and auditable evidence trails. But it feeds into a fragmented type vocabulary — the `deriveType` function maps intents to a 46-type vocabulary that includes 19 phantom types. After unification, the evidence engine maps intents to exactly the types the runtime produces. This makes the intent→type mapping verifiable and calibratable.

For future AI-assisted reasoning, the unified vocabulary is the foundation. An LLM reasoning about interactions needs a consistent type system — not three overlapping ones with lossy translation. The `fuseEvidence` swap point, when activated, will operate on a vocabulary where every type is real and every mapping is compiler-checked.

### Universal Coverage

23 definitions cover the common interaction patterns. But "common" was defined by the test suite, not by real-world data. Validation across 10+ application categories reveals which definitions work reliably, which have edge-case failures, and which interaction patterns are entirely missing. This data-driven approach to coverage expansion is fundamentally more reliable than speculative definition-building.

The application categories were chosen specifically to stress different aspects: SPA routing (navigation detection), shadow DOM (element targeting), design systems (component detection), drag-and-drop (lifecycle tracking), iframes (frame context). If the system handles all of these, it handles the vast majority of modern web applications.

### Maintainability

Generated tests are only valuable if they don't break. The validation phase tests locator stability and assertion validity by actually executing generated tests against real applications. This is the first time the system's output is tested against anything other than synthetic fixtures. The results determine whether the current locator and assertion strategies produce maintainable tests or need fundamental improvement.

---

## 7. Sequencing and Dependencies

```
Phase 3 Thrust 1 (Type Unification)              Phase 3 Thrust 2 (Validation)
  │                                                 │
  ├── Step 1: Unified vocabulary (additive)         │
  ├── Step 2: Rewire IR Bridge                      │
  ├── Step 3: Rewire Domain Adapter                 │
  ├── Step 4: Rewire Evidence deriver               │
  ├── Step 5: Rewire Pipeline + Service Worker      │
  ├── Step 6: Delete dead code                      │
  │                                                 │
  └──────────────────────┬──────────────────────────┘
                         │
                         ▼
              Thrust 2 can begin (the unified
              codebase is what we validate)
                         │
                         ▼
              Record → Analyze → Defect Catalog
                         │
                         ▼
              Phase 4 scope defined by data
```

Thrust 1 must complete before Thrust 2. Validating a codebase that's about to undergo structural changes wastes effort — we validate the final architecture, not the transitional one. Thrust 2's findings then define Phase 4 scope.

Thrust 1's six steps are strictly sequential — each depends on the previous. Steps 1–5 are each independently compilable and testable. Step 6 (deletion) is the only step that removes code, and it runs only after all consumers are rewired.

---

## 8. Success Criteria

### Thrust 1 — Type System Unification

Equivalence gates G1–G8 (§9.4) must all pass before Step 6 (deletion) begins. Additional structural criteria:

| Criterion | How Verified |
|---|---|
| Gates G1–G8 all green | Differential test suite + grep checks (§9.4) |
| `INTERACTION_TO_IR_ACTION` is typed `Record<InteractionType, …>` (not `Record<string, …>`) | Code review |
| All `Record<string, …>` maps that key on `InteractionType` are retyped to `Record<InteractionType, …>` | Code review |

### Thrust 2 — Real-World Validation

| Criterion | How Verified |
|---|---|
| Recordings completed for all 10 application categories | Recording log |
| Defect catalog produced with severity and frequency classifications | Document review |
| At least 3 systematic patterns identified (or confirmed absence) | Catalog analysis |
| Locator failure rate quantified (X% of generated selectors fail on first replay) | Test execution log |
| Assertion failure rate quantified (X% of derived assertions fail on replay) | Test execution log |
| Evidence calibration data collected (intent/confidence accuracy on real interactions) | Annotation review |

---

## 9. Equivalence Validation Strategy

**Governing rule:** No existing code is removed until all eight equivalence gates (G1–G8) have passed. The old adapter, V1 classifier, and classifier type vocabulary remain in place — compiling, importable, and functional — throughout Steps 1–5 of the migration. Only Step 6 (deletion) removes them, and only after every gate is green.

### 9.1 Structural Basis: The Adapter Is a Pure Function

The migration's safety rests on a structural property: the adapter (`adaptInteraction`) and the IR Bridge (`build`) are both **pure deterministic functions**. Given the same `ComponentInteraction[]` input, they always produce the same `ExecutionIRPlan` output. The composition `bridge(adapter(inputs))` is therefore a pure function of `ComponentInteraction[]`. The rewired bridge is also a pure function of `ComponentInteraction[]`. Proving equivalence reduces to proving these two functions produce identical output for the same input — which is directly testable through differential comparison.

### 9.2 The Test Corpus

Differential testing requires a corpus of `ComponentInteraction` fixtures that covers every type, subtype, and edge case. The corpus is built in three layers:

**Layer 1 — Per-type canonical fixtures (~26).** One per unified `InteractionType`, with representative metadata. Proves the type→IRAction mapping and basic metadata flow for every type.

**Layer 2 — Subtype and edge-case fixtures (~30).** Covers the fan-out cases the adapter currently handles:
- Click producing DoubleClick and RightClick
- Dropdown producing NativeDropdown, Autocomplete, MultiSelect variants
- Navigation producing Back, Forward, Refresh
- Scroll producing page vs. container target
- Checkbox with ToggleSwitch styling
- TextEntry with RichTextEditor flag
- DatePicker with and without time component
- Missing/empty metadata (graceful degradation)
- Modal dialog with sub-actions (multi-step interaction sequences)

**Layer 3 — Multi-interaction sequences (~10).** Full interaction sequences (5–20 interactions) exercising readability merge rules (OR-1 duplicate click, OR-2 duplicate fill), noise filtering, and step ordering. Proves pipeline-level behavior, not just per-interaction.

**Total: ~66 fixtures**, each capturing a golden `ExecutionIRPlan` + Playwright output. Built from existing test fixtures in `tests/` — the IR Bridge tests, adapter tests, and definition tests already contain compatible fixtures.

### 9.3 Stage-by-Stage Equivalence Proof

**Stage 1 — Recording (capture layer): Not affected.** Event tap, DOM context extractor, and Component Runtime definitions produce `ObservedEvent` and `ComponentInteraction`. No types change during migration. Existing definition tests (8 files, 23 definitions) continue to pass unchanged.

**Stage 2 — Semantic annotation (evidence engine).** The annotation layer maps `ci.type` to `SemanticIntent` via a static `TYPE_TO_INTENT` table. After promoting subtypes, promoted types must receive the same intent as their parent (DoubleClick→`trigger`, NativeDropdown→`select`, etc.). Differential test: for each corpus fixture, run `annotateWithEvidence` on both old representation (`{ type: 'Click', interactionSubtype: 'DoubleClick' }`) and new (`{ type: 'DoubleClick' }`). Assert identical `intent`, `confidence`, `evidenceTrail`.

**Stage 3 — IR generation (critical stage).** Golden master with differential comparison:

Before any code changes, capture golden outputs:
```
For each fixture ci in corpus:
  golden[ci.id] = {
    detectedType:  adaptInteraction(ci).type,
    irPlan:        build({ interactions: adaptInteractions([ci]) })
  }
```

After rewiring, compare:
```
For each fixture ci in corpus:
  newIrPlan = build({ interactions: [ci] })   // bridge takes ComponentInteraction directly
  assert deepEqual(newIrPlan, golden[ci.id].irPlan)
```

The `deepEqual` covers: `IRAction` per step, resolved locator, fill value/key sequence/drag coordinates, step count and ordering (merge decisions), noise filtering, and embedded assertions.

**Stage 4 — Assertion derivation.** Covered by Stage 3's `deepEqual` on the IR plan (assertions are embedded in `IRStep.assertions`). Explicit sub-assertion for clarity:
```
For each fixture:
  assert deepEqual(newPlan.assertions, goldenPlan.assertions)
```
Catches: missing assertions, changed validation types, changed comparisons, changed severity, changed order.

**Stage 5 — Playwright output.** Render both golden and new IR plans and compare byte-for-byte:
```
For each fixture:
  assert renderToPlaywright(goldenPlan) === renderToPlaywright(newPlan)   // strict string equality
```

If every fixture produces byte-identical Playwright output, the entire pipeline is proven equivalent for the corpus.

### 9.4 The Eight Equivalence Gates

Step 6 (delete dead code) is gated on **all** of the following:

| Gate | Check |
|---|---|
| **G1: TypeScript clean** | `tsc --noEmit` reports zero errors |
| **G2: Full test suite green** | All tests pass (minus V1 classifier/adapter tests being deleted) |
| **G3: Differential type equivalence** | All 66 corpus fixtures: `newType == oldType` |
| **G4: Differential IR plan equivalence** | All 66 corpus fixtures: `deepEqual(newPlan, goldenPlan)` |
| **G5: Differential Playwright equivalence** | All 66 corpus fixtures: `newCode === goldenCode` (byte-identical) |
| **G6: Evidence annotation equivalence** | All corpus fixtures with promoted subtypes: identical intent/confidence/evidenceTrail |
| **G7: No references to deleted types** | `grep -r 'DetectedInteraction' src/` → zero; `grep -r 'ClassifierInteractionType' src/` → zero |
| **G8: End-to-end recording equivalence** | One full recording session (20+ interactions across multiple types) through both paths produces byte-identical Playwright output |

G3–G7 are unit-level; G8 is integration-level. Both tiers must pass. If any gate fails, the migration is blocked at the failing step — the old code remains in place and the failing fixture's diff identifies exactly what changed.

### 9.5 Residual Risk

The validation strategy is rigorous but not omniscient:

1. **Uncovered interaction shapes.** If a real recording produces a `ComponentInteraction` shape no fixture represents, a regression could slip through. Mitigated by comprehensive corpus (66 fixtures) and G8's real recording. Thrust 2's real-world validation is the ultimate backstop.

2. **Definition modifications during migration.** If a definition's `buildResult` is modified to emit `type: 'DoubleClick'` and metadata changes simultaneously, the differential test catches the metadata change but the type change is by design — the test must encode the intended equivalence.

3. **Timing-dependent behavior.** Differential tests use synchronous fixtures. Real recordings have event-grouping windows and debounce behavior. G8 partially addresses this; full timing coverage is Thrust 2.

**Safety net:** Throughout Steps 1–5, both code paths exist and both compile. If Thrust 2 reveals a regression, the old code is in git history and the migration can be reverted to the specific step where the regression was introduced.

---

## 10. Risks and Open Questions

### 10.1 Can the Unified Vocabulary Handle Fan-Out Cleanly?

The current adapter performs three fan-out mappings: Dropdown→{NativeDropdown, CustomDropdown, Autocomplete, MultiSelect}, Navigation→{PageNavigation, Back, Forward, Refresh}, Scroll→{PageScroll, ContainerScroll}. In the unified vocabulary, these become separate union members. The question is: **do the definitions set `type` directly, or do they still set `interactionSubtype`?**

**Resolution:** Definitions set `type` directly. The Click definition, when it detects a double-click, emits `{ type: 'DoubleClick' }` — not `{ type: 'Click', interactionSubtype: 'DoubleClick' }`. This is cleaner, compiler-checked, and eliminates the untyped string field. The definition's `buildResult` already knows which subtype it detected — it just needs to emit the correct type value.

This means the `buildResult` signature may need to return a type other than the definition's "primary" type. For example, the Dropdown definition (registered as `Dropdown` at priority 20) can emit `NativeDropdown`, `Autocomplete`, or `MultiSelect` depending on what it detects. This is already the case in practice (via `interactionSubtype`) — we're just making it typed.

### 10.2 Is the Metadata Translation Lossy?

The adapter currently performs field renaming: `meta.selectedDate` → `result.dateValue`, `meta.sliderValue` → `result.sliderValue`, etc. If definitions emit canonical names directly, this renaming is unnecessary. But if a definition emits `selectedDate` and the IR Bridge reads `dateValue`, removing the adapter breaks the bridge.

**Resolution:** Audit every definition's `buildResult` output and every IR Bridge metadata access. Either (a) definitions emit the names the bridge expects (preferred — fix at source), or (b) the bridge reads the names definitions emit (acceptable — the bridge already uses string-keyed access). This audit is Step 2 of the migration and must complete before any rewiring.

### 10.3 What If Validation Reveals the Architecture Is Fundamentally Wrong?

This is the existential risk. If validation shows that the Component Runtime approach fundamentally can't handle real-world applications — e.g., priority dispatch is too fragile, or the lifecycle pattern can't model complex interactions — then Phase 4 isn't "fix defects," it's "redesign."

**Mitigation:** This is unlikely. The Component Runtime approach is well-established (it mirrors how Playwright's own locator strategies and testing-library's role-based queries work). The lifecycle pattern is sound (it's the same state-machine model used by every UI framework). What validation is more likely to reveal is *implementation gaps* — specific definitions that don't handle specific patterns — not *architectural flaws*. But if it does reveal something fundamental, that's still valuable: discovering it now, before investing in AI and feature expansion, is far cheaper than discovering it later.

### 10.4 Should Phantom Types Be Removed or Implemented?

19 classifier types have no Component Runtime backing. Most should be removed (they represent concepts that are better expressed as metadata or surface types). But some represent real interaction patterns that the system should eventually support:

- `BrowserAlert` — synchronous browser dialogs (`alert`/`confirm`/`prompt`). Real pattern, no current detection.
- `Menu` — context menus, dropdown menus that aren't form controls. Real pattern, currently classified as `Click`.
- `RichTextEditor` — contenteditable elements. Real pattern, currently a flag on TextEntry.

**Resolution:** Remove all 19 from the unified vocabulary in Phase 3. When Phase 4 adds definitions for these patterns, the types are added to the union at that time — with the compiler enforcing that every map is updated. This is the correct order: the vocabulary reflects what the system *does*, not what it *might do*.

---

## 11. Summary

Phase 3 has two thrusts in sequence:

**Thrust 1** finishes the type system unification that Phase 2 started. It eliminates the three-vocabulary fragmentation (23 types → 46 types → 12 actions) in favor of a single, compiler-enforced vocabulary (~26 types → 12 actions). It removes ~2,600 lines of dead code (V1 classifier, adapter, orphaned types) and makes the compiler the guarantor of type completeness. The migration is six strictly sequential steps, each leaving the codebase compilable and tested.

**Thrust 2** proves the unified foundation against real applications. It discovers what actually breaks through systematic recording across 10 application categories, producing a data-driven defect catalog that defines Phase 4 scope.

Together, these thrusts ensure the project's foundation is both structurally clean (one type vocabulary, no dead code, compiler-enforced maps) and empirically validated (tested against real applications, with quantified failure rates). Everything the long-term vision requires — AI-assisted reasoning, negative test generation, universal coverage — is built on top of this foundation. Phase 3 makes it solid.
