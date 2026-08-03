# Architecture Evolution & Evidence

> **Purpose:** Complete, traceable narrative of how the CmdRecorder architecture evolved from its original dual-engine design through real-world failures to the current behavioral reasoning architecture. Every claim is sourced to a cited document with quotes and line references.
>
> **Date:** 2026-08-03
> **Referenced by:** `MASTER-HANDOVER.md` §2

---

## Table of Contents

1. [The Original Architecture](#1-the-original-architecture)
2. [Real-World Tests and Failures](#2-real-world-tests-and-failures)
3. [The Architecture Review and Simplification Proposal](#3-the-architecture-review)
4. [R1: Foundation Cleanup](#4-r1-foundation-cleanup)
5. [R2: Slider Detection](#5-r2-slider-detection)
6. [R3: Behavioral Semantic Reasoning](#6-r3-behavioral-semantic-reasoning)
7. [Golden Master Evidence](#7-golden-master-evidence)
8. [Rejected Approaches](#8-rejected-approaches)
9. [Timeline](#9-timeline)
10. [Source Index](#10-source-index)

---

## 1. The Original Architecture

### 1.1 The Dual-Engine Classifier

The system was built around a central vision: *"Describe what the user accomplished, not which browser events occurred."* It was designed to deploy against real-world enterprise apps — OrangeHRM, AdaniOne, OXD.

Two independent classifiers ran in parallel:

- **V1 (Structural)** — A priority-chain classifier with 24 interaction types spanning 807 lines. Got first claim on all events via deterministic structural rules.
- **V2 (Evidence-based)** — Used 5 weighted evidence providers (DOM, ARIA, CSS Classname, Event Sequence, Mutation) to fill gaps V1 couldn't classify.
- **Merge Layer** (188 lines) — Combined outputs: "V2 primary, V1 fallback, no event in >1 interaction."

*Source: `docs/archive/pre-r1-architecture/CMDRECORDER_ARCHITECTURE.md` (801 lines)*

### 1.2 The 8-Stage Pipeline

```
1. Event Capture          deterministic-recorder.ts (3,033 lines, 13 capture-phase listeners)
2. Event Storage          service worker
3. Classification         V1 + V2 + merge layer
4. Semantic Reasoning     reasoner.ts (stream processor, ComponentSessions, 15s timeout)
5. Domain Pipeline        4-stage: adapt→recognize→enrich→capability (5 intermediate models)
6. IR Generation          ExecutionIRPlan
7. Code Generation        Playwright
8. Side Panel             timeline, replay, code, capability review
```

*Source: `docs/archive/pre-r1-architecture/CMDRECORDER_ARCHITECTURE.md`*

### 1.3 Why It Was Designed This Way

The dual-engine was an evolutionary artifact — V1 was the original structural classifier. V2 was added later as evidence-based classification. Rather than replacing V1, V2 was layered alongside it with a merge layer. This preserved all existing V1 behavior while adding evidence-based reasoning.

The system had 38 InteractionTypes (near-duplicates), three conflicting lifecycle layers (Capture: 800ms date debounce / 300ms hover / 200ms scroll; Evidence Engine: buffer commit / 10s composite timeout; Semantic Reasoner: 15s component session timeout), and a `dateSelect` synthetic event described as *"a workaround for misplaced lifecycle logic."*

---

## 2. Real-World Tests and Failures

### 2.1 AdaniOne Failures (8 Issues)

**Source: `docs/archive/pre-r3-architecture-specs/ADANI_ONE_ISSUE_TRACKER.md` (430 lines)**

Testing against adanione.com revealed composite widget failures:

**What the user observed:**
1. Passenger/Class control recognized as click on down-arrow icon instead of the composite component
2. +/- buttons captured as generic Click instead of Increase/Decrease operations
3. Selecting Premium Economy not treated as part of Passenger/Class interaction
4. Departure date captured twice (open calendar + select date) instead of one interaction

**Root cause (from `CMDRUNNER_ARCHITECTURAL_EVOLUTION.md` §10):**

> *"The SemanticReasoner makes activation and absorption decisions using only the interaction's target element identity and CSS class matching. It does NOT use the surface/overlay evidence that Evidence Channels D and E already collect."*

> *"Evidence Channel D already detects surfaces appearing and disappearing... But this evidence is never carried through to the DetectedInteraction that the reasoner processes."*

**All 8 issues were fixed** through surface-anchored detection, CSS overlap absorption, and stepper detection improvements. Full suite after fixes: 4,212/4,213 passing.

### 2.2 The Amazon Failure (Pivotal Event)

**Source: `docs/archive/pre-r3-phase-specs/checkbox-link-detection.md` (57 lines)**

On Amazon.in, left-rail filter checkboxes were classified as **Link** instead of **Checkbox**:

```html
<a class="a-link-normal s-navigation-item" href="/s?...">
  <i class="a-icon a-icon-checkbox"></i>
  <span class="a-list-item">vivo</span>
</a>
```

**The pipeline failed at three levels:**

1. **`getImplicitRole()`** — returns `'link'` for `<a>` tags via TAG_ROLE_MAP. Never checks for `aria-checked` before the tag-map fallback.
2. **`captureCheckedState()`** — only inspects the element itself. Amazon's `<a>` class doesn't contain "checked" — the indicator is on the inner `<i>`.
3. **Classifier** — Checkbox check requires `ariaRole === 'checkbox'`; Link check catches `tag === 'A'`. *"There is no safety-net check for 'this link had a checked-state transition.'"*

**What it proved:** Structural/DOM attributes alone are insufficient for **classification**. The behavioral effect (class transitioning `opt` → `opt selected`) was invisible because DOM capture fires *before* the page's click handler runs. The system needed to see what happened *after* the click.

### 2.3 Google Flights and Avis Ford Validation

**Source: `.drytis/notes/evidence-engine-realworld-validation.md` (137 lines)**

| Site | Challenge | V1 Result | V2 Result |
|------|-----------|-----------|-----------|
| **Avis Ford** | Cross-origin iframe form, 4 native selects, no ARIA | Near-100% accuracy | Near-100% accuracy |
| **Google Flights** | `<input role="combobox">` autocomplete | Generic Click | CustomDropdown (0.85+ confidence) |

Three engine fixes applied during validation:
1. **Combobox TextEntry Suppression** — Google Flights airport input is `<input type="text" role="combobox">`; DomProvider's TextEntry vote outvoted CustomDropdown. Added `hasComboboxSemantics()` check.
2. **Broad Calendar Cell Grouping** — Google Flights date input had no date-specific markers; engine couldn't link input to gridcell click.
3. **Calendar Cell Evidence Boost** — DatePicker evidence from calendar cell outvoted by residual TextEntry; increased to 0.9 confidence.

### 2.4 Regression Analysis

**Source: `.drytis/notes/regression-analysis-evidence-classifier.md` (69 lines)**

Compared 4,811 tests before and after evidence classifier integration:

**Behavior improvements (correct now, wrong before):**
1. Amazon filter checkboxes: `<a>` tags with checked-transition → Checkbox (was Link)
2. Wishlist/like toggles: BUTTON with checked transition → ToggleSwitch (was Click)
3. All trigger interactions now have non-zero confidence (0.3) and named intent with audit trail

**Behavior regressions: Zero.** *"None found. Zero misclassifications across all 77 cross-domain validation scenarios and the existing 4,712+ test suite."*

---

## 3. The Architecture Review

### 3.1 The W1-W7 Weaknesses

**Source: `docs/archive/pre-r1-architecture/ARCHITECTURE_REVIEW.md` (1,045 lines)**

A first-principles evaluation identified 5 strengths and 7 fundamental weaknesses:

**Strengths (to preserve):**
1. Evidence-based classification (5 providers)
2. Guard rail system (30 rails)
3. Locator ranking (5 categories: Business → Accessibility → Stable Technical → Content → Structural)
4. Component lifecycle awareness
5. IR as framework-neutral contract

**Weaknesses:**

| ID | Weakness | Detail |
|----|----------|--------|
| W1 | **Layered redundancy** — "Two of Everything" | capture: deterministic-recorder vs event-tap; classification: V1 vs V2; lifecycle: reasoner vs Foundation engine; IR: ir-bridge vs generator |
| W2 | **Lifecycle logic scattered** | 3 layers with 3 incompatible "complete" definitions |
| W3 | **Guard rails in capture monolith** | 3,033 lines; capture layer making classification decisions |
| W4 | **dateSelect synthetic event** | "A hack" — workaround for misplaced lifecycle logic |
| W5 | **Domain pipeline limited value** | No DOM access, no-op inspector |
| W6 | **Framework logic scattered** | Across 5+ locations |
| W7 | **38 interaction types** | Near-duplicates |

**Verdict:** *"architecture is 'functional but over-engineered' — works (3800+ tests) but carries weight of incremental evolution."*

### 3.2 The Simplification Proposal

**Source: `docs/archive/pre-r1-architecture/SIMPLIFICATION_JUSTIFICATION.md` (831 lines)**

Proposed consolidations:

| Dimension | Before | After | Key Change |
|-----------|--------|-------|------------|
| Pipeline stages | 8 | 3 | Classification + Semantic Reasoning merged; classification IS lifecycle outcome |
| Data models | 11 | 3 | EventGroup, InteractionBuffer eliminated; DetectedInteraction merges into SemanticInteraction |
| Interaction types | 38 | 19 | Click variants merged, Date variants merged, Dropdown variants merged |
| Lifecycle layers | 3 | 1 | *"This is the strongest recommendation: eliminates root cause of confusion"* |

**5 intentional sacrifices** acknowledged: debugging granularity, pre-computed structured understanding, parallel system as error detection, explicit type-based dispatch, real-time application understanding.

### 3.3 The Architecture Freeze

**Source: `docs/archive/pre-r1-architecture/ARCHITECTURE_FREEZE_STRATEGY.md` (1,104 lines)**

Frozen contracts: Interaction taxonomy (19 types), SemanticInteraction schema, lifecycle definition format, evidence provider interface, IR contract, success criteria per type.

9 golden recordings specified for differential testing: orangehrm-login, orangehrm-my-info-full, adanione-flight-search, bootstrap-form, mui-dashboard, antd-table, etc.

---

## 4. R1: Foundation Cleanup

### 4.1 What R1 Did

**Source: `.drytis/specs/r1-foundation-cleanup.md` (408 lines), commit `5e9d75f`**

R1 eliminated the dormant V2 subsystem — code that was *"double-dead"*:

> *"The feature flag is never activated — `recorderEngine` defaults to `'legacy'`. Even if the flag were activated, the service worker has no handler for `RECORDED_EVENT` (from the dormant path). All v2 events would be silently dropped."*

### 4.2 Scale of Deletion

**Source: `.drytis/notes/phase1-cleanup-postmortem.md` (57 lines)**

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Source files | 234 | 162 | −72 (−31%) |
| Source lines | 63,681 | 43,152 | −20,529 (−32%) |
| Test files | 210 | 136 | −74 |
| Source TS errors | 188 | 0 | −188 |

**Deleted subsystems:**
- `src/pipeline/` — entire directory (31 files)
- `src/types/` — entire directory (8 files)
- `src/classifier/semantic/` — entire directory (5 files)
- `src/classifier/evidence/providers/` — 5 evidence providers
- `src/recorder/deterministic-recorder.ts` — 3,120 lines (the V1 god-module)
- Evidence engine, merge layer, detector, combination logic

### 4.3 What Was Salvaged

The MutationObserver pattern from the V2 control-model was documented in `.drytis/notes/v2-mutation-observer-pattern-for-r3.md` for later use in R3.4 attribute transition capture:

> *"The key difference from v2's pattern: R3.4 should observe only the target element's subtree for a short window after interaction (e.g., 400ms), not continuously."*

### 4.4 Runtime Bugs Fixed During Cleanup

1. `RecordingState.Error` missing from enum
2. UnitOfWork interface violations (3 locations)
3. AppMessage type holes (OBSERVED_EVENT, IFRAME_SELECTORS)
4. `as any` casts in ObservedEvent → RecordedEvent conversion

---

## 5. R2: Slider Detection

### 5.1 The Problem

**Source: `.drytis/specs/r2-slider-detection.md` (562 lines), commit `5a6f5d5`**

`isSlider()` returned true for exactly two cases (`<input type="range">` or `role="slider"`). Custom div-based sliders (jQuery UI, noUiSlider, bespoke) produced generic Click — the value was lost entirely.

### 5.2 The Solution

CSS class pattern matching (`SLIDER_CLASS_RE`) plus geometry-based value extraction (`offsetLeft`/`offsetWidth` fallback). New subtype: `CustomSlider`.

### 5.3 Bugs Discovered During R2 Design

- **B1:** Subtype → IRAction disconnect — `interactionSubtype: 'NativeSlider'` but `INTERACTION_TO_IR_ACTION` only has `'Slider'`. *"Every real-world slider recording produces CLICK instead of FILL."*
- **B2:** Assertion produces `toHaveAttribute('value', 'true')` instead of `toHaveValue('75')`
- **B3:** Timeline renderer reads `m.sliderMin`/`m.sliderMax` but definition produces `min`/`max`

### 5.4 What Was Rejected

| Rejected | Why |
|----------|-----|
| Behavioral slider classification | *"Requires R3's behavioral reasoning layer."* Deferred to R3. |
| aria-orientation capture | Not needed for geometry extraction |
| Dual-handle RangeSlider grouping | Already produces two Slider interactions |

### 5.5 Architectural Principle

> *"R2 is the last structural detection expansion. After R2, every slider with recognizable CSS classes, ARIA roles, or native semantics is detected. The remaining population — sliders with zero recognizable signals — is handled by R3's behavioral reasoning."*

---

## 6. R3: Behavioral Semantic Reasoning

### 6.1 The Problem R3 Solved

**Source: `.drytis/specs/r3-behavioral-semantic-reasoning.md` (861 lines), commit `1b2fa89`**

After R2, the evidence engine classified only Click interactions that no lifecycle definition claimed, using ONLY structural attributes snapshotted at DOM capture time — **BEFORE** the page's click handler runs:

> *"So class transitions (opt→opt selected), aria-expanded transitions, value changes on clicked element are all invisible. 10 behavioral/structural fields captured but never reach evidence engine. Result: when lifecycle definition misses a novel implementation, evidence engine cannot recover."*

| Scenario | Before R3 | After R3 |
|----------|-----------|----------|
| div-checkbox with class toggle only | Click | Checkbox |
| Novel combobox with panel appearing | Click | Dropdown |
| Link-styled toggle (Amazon) | Link | Checkbox |
| Evidence engine behavioral fields | 14 (15% behavioral) | ~24 (~50% behavioral) |

### 6.2 The Timing Flaw — The Pre-Handler Structural Blind Spot

**Source: `.drytis/notes/r3-design-review-timing-flaw.md` (160 lines)**

The critical architectural discovery that forced R3's redesign:

> *"R3.4 proposes post-click attribute transition capture to detect class/aria changes caused by the page's click handler. The intent is to feed these to the evidence engine for behavioral classification. **This cannot work as designed.**"*

**The exact timing sequence that breaks:**
1. EventTap listener (capture phase) → fires BEFORE page handlers
2. DOM snapshot taken (classes, ARIA, values — all **pre-handler** state)
3. ObservedEvent sent to service worker
4. Click lifecycle completes → `annotateWithEvidence` runs → classified → persisted
5. **THEN** page's click handler fires (bubble phase) — modifies classes, aria-expanded
6. Post-click poll fires at 50/150/400ms — detects changes — **but Click is already frozen**

> *"No re-annotation path exists. The Click interaction is emitted, classified, and persisted before any post-handler behavioral data is available."*

**Category A (pre-handler, available at capture):** `checkedBefore`/`checkedAfter` (native checkboxes toggle before event dispatch), `valueBefore`, `ariaExpanded` if pre-set.

**Category B (post-handler, created BY the click handler):** class changes (`opt` → `opt selected`), aria-expanded transitions, aria-checked on non-native elements. *"These are exactly the 'novel implementation' scenarios R3 targets."*

### 6.3 Approaches Considered and Rejected

**Source: `.drytis/notes/r3-step6-annotation-deferral-decision.md` (35 lines)**

| Option | Description | Verdict |
|--------|-------------|---------|
| **Option 1: Click Lifecycle Deferral** | Click enters brief active state; setTimeout(0) re-snapshot; classification after both available | *"Breaks 23 test files because they simulate the runtime directly and expect Click to emit immediately."* |
| **Option 2: Deferred Annotation** | Click emits immediately; post-emit hook schedules capture; re-runs annotation | *"Requires a re-annotation mechanism that doesn't exist."* Race conditions. |
| **Option 3: pendingAnnotation Signal** | Runtime emits pendingAnnotation alongside Click; SW holds in pending state; attribute-change annotates | Similar to Option 2, different signaling |

**Decision: Annotation Deferral (Option 2/3 hybrid)**

> *"Option B — Minimal test breakage. Preserves the Click lifecycle for all existing tests. The annotation happens at the SW integration layer, not in the Click definition."*

The R3 spec explicitly notes: *"Annotation deferral is the canonical architecture going forward."*

### 6.4 R3 Implementation

**R3.1 — FeatureViewInput expansion:** ~10 new fields (valueBefore/After, ariaExpanded, ariaHasPopup, ariaValueNow, inputType, isContentEditable, ancestorClasses, hasAttributeTransition, attributeChanges).

**R3.2 — Type derivation:** `select` intent → ariaHasPopup→Dropdown, ariaValueNow→Slider, ancestorRoles listbox/menu/tablist→Dropdown. `input` intent → valueBefore≠valueAfter→TextEntry, isContentEditable→TextEntry.

**R3.3 — 4 behavioral generators:**

| Generator | Weight | Signal |
|-----------|--------|--------|
| `value-change` | +0.6 | Observed value transition after interaction |
| `panel-emergence` | +0.6 container / +0.5 static / +0.3 ariaHasPopup | New element appears after click |
| `selection-state` | +0.5 | checked/selected attribute changes — *"raised from +0.4 to +0.5 during misleading-signal validation to ensure behavioral signal wins ties against structural tag evidence (+0.4)"* |
| `slider-value` | +0.5 | Numeric value transitions on slider-like elements |

**R3.4 — Content-script re-snapshot:** EventTap schedules `setTimeout(0)` re-snapshot after click. New `BrowserEventType 'attribute-change'` emitted. ATTRIBUTES_TO_TRACK: class, aria-expanded, aria-checked, aria-selected, style, aria-pressed.

**R3.5 — Unrecognized threshold:** 0.3 confidence — interactions below threshold surfaced as unrecognized rather than silently misclassified.

### 6.5 Weight Calibration Reasoning

| Signal Class | Weight Range | Rationale |
|-------------|-------------|-----------|
| Standards (ARIA declared) | 0.7-0.9 | Authoritative — developer explicitly stated semantics |
| Behavioral (observed effect) | 0.5-0.7 | Strong — inferred from what the app did |
| Structural (CSS/context) | 0.1-0.4 | Weak — circumstantial |
| Negative (suppression) | -0.2 to -0.3 | Counter-evidence |

The calibration directly addresses the Amazon failure: behavioral toggle signal (+0.5) overrides structural link signal (+0.4 from tag).

### 6.6 Validation Scenarios

**Source: `tests/r3-behavioral-gates.test.ts` (633 lines)**

Core validation principle:

> *"Tests must prove post-handler data drove classification by setting up elements with NO structural signal and handlers that produce behavioral signals."*

**Negative-signal scenarios (no structural signal, handler produces behavioral signal):**
- **G13 (div-checkbox):** *"change.before = 'opt'" (pre-handler), "change.after = 'opt selected'" (produced by handler). Evidence must cite `class-selection-transition`. Winning intent must NOT be `trigger`.*
- **G15 (novel combobox):** *"result.intent === 'select'", "result.type === 'Dropdown'".*
- **G14 (div-checkbox end-to-end)**

**Misleading-signal scenarios (structural says one thing, behavioral says another):**
- **G16 (link-styled toggle — the Amazon scenario):** *"result.intent NOT 'navigate'"* — behavioral toggle (+0.5) beats structural navigate (+0.4 from `<a>` tag).

**Gate tests G9-G19** verify field propagation, type derivation, generator voting, timing proof, end-to-end classification, unrecognized threshold, and rapid-click safety.

### 6.7 What R3 Is NOT (Evolution, Not Redesign)

> *"EvidenceGenerator interface unchanged, fuseEvidence() unchanged, SemanticIntent enum unchanged (6 values), FeatureViewInput extended (~10 fields), deriveType() switch has select/input cases now implemented, Component Runtime unchanged, Click definition lifecycle approach SUPERSEDED, IR Bridge/Playwright/assertion/pattern registry all unchanged."*

### 6.8 R3 Explicit Limitations

- Multi-element temporal patterns (deferred — O6 optional)
- Delayed framework state flushes (setTimeout(0) covers synchronous handlers)
- Confidence calibration tuning (ongoing)
- Continuous MutationObserver — **never** (architectural decision, performance risk)
- Visual appearance inference — **never** (architectural decision, different signal class)

---

## 7. Golden Master Evidence

### 7.1 Fixture Layers

**Source: `tests/golden-master/snapshots/manifest.json` (342 lines), `tests/golden-master/corpus.ts` (891 lines)**

68 total fixtures validating type equivalence and IR plan deep equality:

| Layer | Count | What It Tests |
|-------|-------|---------------|
| **L1** | 35 | Single-interaction type coverage (every InteractionType) |
| **L2** | 23 | Edge cases, variants, misleading signals |
| **L3** | 10 | Multi-interaction sequences (login flow, form fill, up to 21 interactions → 11 steps) |

### 7.2 R3/Amazon Scenarios in Golden Master

The corpus contains R3 behavioral classification fixtures (`evt-r3-001/002/003`):

| Fixture | Element | Pre-Handler State | Post-Handler Change | Classified As | Confidence |
|---------|---------|-------------------|---------------------|---------------|------------|
| evt-r3-001 | DIV, no ARIA | className: 'opt' | class: 'opt' → 'opt selected' | Checkbox | 0.5 |
| evt-r3-002 | DIV, no ARIA | aria-expanded: null | aria-expanded: null → 'true' | Dropdown | 0.6 |
| evt-r3-003 | `<a>` tag | ariaRole: 'link' | class: 'filter-link' → 'filter-link active' | Checkbox | 0.5 |

**evt-r3-003 is the Amazon scenario** — `<a>` tag with class toggle, behavioral signal overrides structural link classification.

### 7.3 Golden Master Limitation

Golden master validates **consistency** (new path produces same output as old path), not behavioral **correctness**. If the old path was wrong, both are consistently wrong. No golden test runs the full production pipeline (recording → P2).

---

## 8. Rejected Approaches

### 8.1 R3 Timing Approaches (§6.3)

Three options considered. Lifecycle deferral (Option 1) was cleanest architecturally but broke 23 test files. Annotation deferral (Option 2/3) chosen — *"the canonical architecture going forward."*

### 8.2 Pre-R3 Architectural Rejections

**Source: `docs/archive/pre-r3-architecture-specs/CMDRUNNER_ARCHITECTURAL_EVOLUTION.md` §13**

| Decision | Rejected Alternative | Why |
|----------|---------------------|-----|
| Keep multiConfig Session Model | New CompositeComponent session type | *"Would duplicate the session lifecycle. Would not fix root cause."* |
| Surface-Anchored Detection | Expand CSS class pattern lists | *"CSS class matching is inherently fragile. Maintaining a growing list is unsustainable."* |
| Three SemanticInteraction adjustments before freeze | Freeze as-is, add fields later | *"Changing after freeze is a breaking change to every consumer"* |
| Dual-pipeline merge as refactor | Keep both types + adapter | *"An adapter would be a permanent bridge layer — exactly the anti-pattern the boundary exists to prevent"* |

### 8.3 The MutationObserver Pattern

**Source: `.drytis/notes/v2-mutation-observer-pattern-for-r3.md`**

V2's continuous MutationObserver (childList + subtree + attributes on body) was salvaged for reference but explicitly rejected for continuous use. R3 spec §11: *"Continuous MutationObserver — never (architectural decision, performance risk)."* Short-window setTimeout(0) re-snapshot is sufficient.

---

## 9. Timeline

```
55fea59  v1.24 — AI Extension: evidence engine, UI Knowledge Model, domain model
   ↓     Foundation Validation Phases A/B/C — 31 + 25 + 20 tests
fcee3a7  Real-world stabilization — 4 critical bug fixes
bdc16fa  OXD radio/checkbox/datepicker fixes
7bfd949  AdaniOne calendar/dropdown root causes  ← Real-world failures discovered
8cedea6  Surface-Anchored Detection
e9063df  Fix 3 AdaniOne production bugs
   ↓     Amazon failure discovered ← Pivotal event
4429746  Phase 1 cleanup — 72 files, 20,500 lines removed
5e9d75f  R1: Foundation Cleanup — dormant V2 eliminated
5a6f5d5  R2: Slider Detection — CSS patterns, B1/B2/B3 bug fixes
7782cd7  R3 design revision — timing flaw discovered
1b2fa89  R3: Behavioral Semantic Reasoning — 4 generators, annotation deferral
5c814d1  R4: Element Identity Matching Foundation
   ↓     P1/P2 implemented (capability lifecycle, IR generation)
4a5ac82  Amazon reassessment — broken connections vs intentional decisions
```

### The Causal Chain

```
AdaniOne failures  →  Surface-anchored detection, absorption improvements
Amazon failure     →  "Structure alone insufficient for classification"
                    →  R3 design: behavioral evidence generators
                    →  Timing flaw discovered: pre-handler blind spot
                    →  Lifecycle deferral rejected (23 test files)
                    →  Annotation deferral chosen (canonical)
                    →  Weight calibration: behavioral (+0.5) > structural (+0.4)
                    →  Amazon <a> toggle now classifies as Checkbox ✅
```

---

## 10. Source Index

| Source | Location | Role |
|--------|----------|------|
| `CMDRECORDER_ARCHITECTURE.md` | `docs/archive/pre-r1-architecture/` | V1/V2 dual-engine design |
| `ARCHITECTURE_REVIEW.md` | `docs/archive/pre-r1-architecture/` | W1-W7 weaknesses, 5 strengths |
| `SIMPLIFICATION_JUSTIFICATION.md` | `docs/archive/pre-r1-architecture/` | Pipeline 8→3, types 38→19 |
| `ARCHITECTURE_FREEZE_STRATEGY.md` | `docs/archive/pre-r1-architecture/` | Frozen contracts, golden recordings |
| `CMDRUNNER_ARCHITECTURAL_EVOLUTION.md` | `docs/archive/pre-r3-architecture-specs/` | Full evolution, 6 decisions, AdaniOne |
| `ADANI_ONE_ISSUE_TRACKER.md` | `docs/archive/pre-r3-architecture-specs/` | 8 AdaniOne issues with fixes |
| `checkbox-link-detection.md` | `docs/archive/pre-r3-phase-specs/` | Amazon failure 3-layer analysis |
| `r1-foundation-cleanup.md` | `.drytis/specs/` | R1 scope, dormant V2 analysis |
| `r2-slider-detection.md` | `.drytis/specs/` | R2 problem, 3 bugs, R3 relationship |
| `r3-behavioral-semantic-reasoning.md` | `.drytis/specs/` | R3 full design, timing, validation |
| `phase1-cleanup-postmortem.md` | `.drytis/notes/` | Cleanup metrics |
| `r3-design-review-timing-flaw.md` | `.drytis/notes/` | Pre-handler blind spot discovery |
| `r3-step6-annotation-deferral-decision.md` | `.drytis/notes/` | 3 options, Option B chosen |
| `evidence-engine-realworld-validation.md` | `.drytis/notes/` | Google Flights, Avis Ford validation |
| `regression-analysis-evidence-classifier.md` | `.drytis/notes/` | 4,811 tests, 0 regressions |
| `manifest.json` + `corpus.ts` | `tests/golden-master/` | 68 fixtures, R3 scenarios |
| `r3-behavioral-gates.test.ts` | `tests/` | G9-G19 gate tests |
| `08-amazon-evolution-reassessment.md` | `.drytis/audits/` | Intentional vs broken connections |

---

*This document is the authoritative record of how and why the architecture evolved. For current state and known issues, read MASTER-HANDOVER.md.*
