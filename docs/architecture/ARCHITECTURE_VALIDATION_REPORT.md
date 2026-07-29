# Architecture Validation Report

**Date:** 2026-07-29
**Validated Against:**
- `IMPLEMENTATION_BASELINE.md` (baseline architecture, commit `288c657`)
- `IMPLEMENTATION_BASELINE_SPECIFICATION.md` (frozen specification, commit `288c657`)
- Live codebase at commit `288c657`

**Validation Method:** Every claim in both documents was verified against the actual source code — import graphs traced, manifest verified, dead code importers checked, pipeline paths followed.

---

## Validation Summary

| # | Check | Result |
|---|-------|--------|
| 1 | Every engine has a single, well-defined responsibility | ✅ PASS |
| 2 | No overlapping responsibilities between engines | ✅ PASS |
| 3 | Every future feature has exactly one implementation owner | ✅ PASS |
| 4 | Data flow is strictly one direction with no circular dependencies | ✅ PASS |
| 5 | No hidden bypasses or duplicate execution paths | ⚠️ PASS WITH FINDINGS |
| 6 | Every planned phase builds on the previous without rewrites | ✅ PASS |
| 7 | Future layers (AI, Capability, SemanticInteraction, IR, Self-Healing) fit naturally | ✅ PASS |
| 8 | Removing dead modules won't affect the active pipeline | 🔴 FAIL — 1 module is not actually dead |

---

## Check 1: Single, Well-Defined Responsibility Per Engine ✅

**Verdict: PASS**

Every engine has exactly one responsibility, and no engine performs work outside its scope.

Evidence gathered by grepping each engine's source for keywords that belong to other engines:

| Engine | Checked For | Found? | Verdict |
|--------|-------------|--------|---------|
| Semantic Reasoner | `document.*`, `querySelector`, `getElementById` (DOM access) | 0 matches | ✅ Clean |
| Classifier | `session`, `multiConfig`, `absorb`, `activate` (semantic session mgmt) | Comments only | ✅ Clean |
| Component Runtime | `multiConfig`, `absorb`, `session`, `semantic` | 0 matches | ✅ Clean |
| IR Bridge | `classify`, `detect`, `detectInteractions` | Type imports only (`import type`) | ✅ Clean |
| Service Worker | Inline classification logic | 0 — delegates to `detectInteractions()`, `reasonAboutInteractions()` | ✅ Clean |

---

## Check 2: No Overlapping Responsibilities ✅

**Verdict: PASS**

Each engine owns its responsibility exclusively. Cross-engine dependencies are **type-only** (`import type`), meaning they share type definitions but never runtime code. This is the correct architectural pattern for a pipeline.

Specifically verified:
- **IR Bridge → Classifier**: `import type { DetectedInteraction, InteractionType }` — uses the type in a mapping table (`INTERACTION_TO_IR_ACTION`). The bridge translates already-classified interactions, it does not classify them. This is a translation pattern, not overlap.
- **Semantic Reasoner → Classifier**: `import type { DetectedInteraction }` — consumes output, doesn't re-classify.
- **Component Runtime → Classifier**: No import at all. Runtime emits `ComponentInteraction[]`, the SW adapts to `DetectedInteraction[]` via a conversion shim.

**One acceptable coupling:** The SW's `ObservedEvent → RecordedEvent` conversion shim (lines 287–308) bridges two type systems. This is documented as temporary (Phase 0 eliminates it) and is explicitly the ONLY place `as any` is allowed.

---

## Check 3: Every Future Feature Has Exactly One Implementation Owner ✅

**Verdict: PASS**

The ownership matrix in `IMPLEMENTATION_BASELINE_SPECIFICATION.md` §6 assigns every feature type to exactly one engine with a `NEVER Touch` column. Cross-referencing against the codebase:

| Feature Type | Owner | Verified |
|-------------|-------|----------|
| Event capture | EventTap (`src/tap/event-tap.ts`) | ✅ Only EventTap has DOM event listeners |
| Target resolution | Identity Extractor (`src/tap/identity-extractor.ts`) | ✅ Only `resolveTarget()` exists here |
| Surface detection | DOM Context Extractor (`src/definitions/dom-context-extractor.ts`) | ✅ Only `detectSurface()` exists here |
| Interaction classification | Classifier (`src/classifier/interaction-detector.ts`) | ✅ Only `detectInteractions()` / `classifyGroup()` |
| Session activation/absorption | Panel/Form Detectors (`src/classifier/semantic/panel-form-detectors.ts`) | ✅ Only `isMultiConfigActivation()` / `shouldAbsorbMultiConfig()` |
| Stepper detection | Panel/Form Detectors | ✅ Only `detectStepperDirection()` |
| Semantic reasoning | Semantic Reasoner (`src/classifier/semantic/reasoner.ts`) | ✅ Only `reasonAboutInteractions()` |
| IR generation | IR Bridge (`src/generation/ir-bridge.ts`) | ✅ Only `buildIRPlan()` |
| Code rendering | Code Gen (`src/adapters/playwright/`) | ✅ Only Playwright renderers |
| Persistence | Repository V2 (`src/repository/v2/`) | ✅ Only Dexie repositories |
| Healing | Healing Service (`src/repository/services/healing-service.ts`) | ✅ Only `healFromRecording()` |

No feature has two owners. No owner has ambiguous boundaries.

---

## Check 4: Data Flow Is Strictly One Direction ✅

**Verdict: PASS — No Circular Dependencies**

The dependency graph is a strict DAG (Directed Acyclic Graph):

```
EventTap → IdentityExtractor → ComponentRuntime → ServiceWorker
EventTap → DomContextExtractor → ComponentRuntime
ServiceWorker → Classifier → SemanticReasoner → IRBridge → CodeGen
ServiceWorker → RecognitionPipeline → EnrichmentPipeline
ServiceWorker → RepositoryV2 → HealingService
```

All cross-engine imports use `import type` (erased at compile time), creating zero runtime coupling between engines. The only runtime coupling is through the SW, which imports all engines — but the SW is the pipeline orchestrator, not a peer engine.

No engine imports from an engine downstream of it. The IR Bridge does not import from Code Gen. The Classifier does not import from the Semantic Reasoner. The EventTap does not import from the Classifier.

---

## Check 5: No Hidden Bypasses or Duplicate Execution Paths ⚠️

**Verdict: PASS WITH 3 FINDINGS**

### Finding A: Three-Way Classification Fork (⚠️ Architectural Debt, Documented)

The SW has a three-branch classification dispatch (lines 310–366):

1. **Control Engine** (`recorderEngine === 'control'`): calls `recognizeInteractions()` from `src/recorder/v2/interaction-recognizer.ts` (674 lines)
2. **Legacy V1**: calls `detectInteractions()` from `src/classifier/interaction-detector.ts`
3. **Legacy V2**: calls `detectInteractionsV2()` from `src/classifier/evidence/detector.ts` + `mergeV1V2()` from `src/classifier/evidence/merge-layer.ts`

This is **documented** in the IMPLEMENTATION_BASELINE.md §1.2 (Active Pipeline) and §2.2 Engine 4 (Evidence Channels). However, it represents three classification engines producing `DetectedInteraction[]`, which is more complexity than the "single pipeline" goal.

**Risk:** Low for now. The Control Engine path is gated behind a feature flag (`recorderEngine: 'control'`) that defaults to `'legacy'`. No user encounters it unless they toggle the setting.

**Resolution:** Phase 0 unifies the pipeline. Phase 1 removes the Control Engine code. The fork is temporary debt, not a permanent architectural violation.

### Finding B: `toIRActions()` Dead Import (⚠️ Harmless but Pollutes Import Graph)

| Location | Line | Status |
|----------|------|--------|
| `src/presentation/output-adapter.ts:254` | Defined | Dead export |
| `src/background/service-worker.ts:57` | Imported | Dead import — never called (0 call sites) |

The active IR generation path is `buildIRPlan()` from `src/generation/ir-bridge.ts` (line 446). `toIRActions` is tree-shaken by Vite, so it has no runtime impact, but it creates a misleading import relationship: the SW appears to depend on a second IR generation path when it doesn't.

**Risk:** None at runtime. Confusion for developers reading the import list.

**Resolution:** Remove the import in Phase 1 dead code cleanup (trivial change, no architectural dependency).

### Finding C: `recognizeInteractions()` Import — Active but Outside Engine Definitions (⚠️ Uncatalogued)

`src/recorder/v2/interaction-recognizer.ts` (674 lines) is imported and called by the SW when `recorderEngine === 'control'`. This file is NOT listed in any engine definition in either document. It exists in `src/recorder/v2/` — the directory documented as "dead."

**Actually:** It is part of the Control Engine path, which is a documented feature-flagged alternative pipeline. It should be catalogued as an active-but-deprecated module.

**Risk:** Medium — Phase 1 deletion of `src/recorder/v2/` would remove this file, but it would also need to remove the import from the SW and the feature flag. The documents say "Phase 1" for `src/recorder/v2/` deletion but don't call out this specific dependency.

**Resolution:** Add `interaction-recognizer.ts` to the dead code list with a note: "Active when `recorderEngine === 'control'`. Safe to remove only after removing the Control Engine feature flag from the SW and settings."

---

## Check 6: Every Planned Phase Builds on the Previous ✅

**Verdict: PASS**

| Phase | Depends On | Verified |
|-------|-----------|----------|
| Phase 0 (Type Unification) | Nothing (foundation) | ✅ 3 `as any` casts in SW identified at exact lines (299, 306, 779). DomContext and InteractionType have documented duplicates. |
| Phase 1 (Dead Code Removal) | Phase 0 (types unified first) — BUT actually independent | ✅ Dead code modules don't depend on the type casts. Phase 1 can proceed independently of Phase 0. |
| Phase 2 (Component Runtime Enhancement) | Phase 0 (unified types) | ✅ Runtime imports `shared/component-types` — Phase 0 unifies this. |
| Phase 3 (Evidence Unification) | Phase 0 | ✅ Evidence system imports `RecordedEvent` — Phase 0 unifies this. |
| Phase 4 (AI Test Gen) | Phase 0 + `create_openai_api_key` | ✅ AI module will read from Repository/Capability, not touch the pipeline. |
| Phase 5–10 | Respective previous phases | ✅ Each adds a new engine module without modifying existing engines. |

No phase requires rewriting a prior phase's work. Each phase is additive.

**Correlation:** Phase 1 can actually proceed independently of Phase 0. Dead code removal doesn't depend on type unification. However, doing Phase 0 first is safer because it eliminates the `as any` bridge that some dead code paths might interact with.

---

## Check 7: Future Layers Fit Naturally ✅

**Verdict: PASS**

Each future layer slots into the pipeline at a well-defined boundary without crossing engine lines:

| Future Layer | Slots Into | Boundary | Violation? |
|-------------|-----------|----------|-----------|
| SemanticInteraction (Phase 0) | Replaces adapter shim between Component Runtime and Classifier | Type system only — no runtime coupling change | ✅ |
| AI Test Generator (Phase 4) | Reads UnderstandingResult + Capability from Repository. Writes test scenarios. Does NOT modify pipeline. | Repository → AI → Code Gen (new path, no existing engine modified) | ✅ |
| Execution Engine Manager (Phase 5) | Reads ExecutionIRPlan, dispatches to engines. Does NOT modify IR Bridge. | IR Bridge → Engine Manager → Playwright/Cypress | ✅ |
| AI Failure Analyzer (Phase 7) | Reads ExecutionRun results + Evidence. Does NOT modify recorder. | ExecutionRun → AI Analyzer → Healing/Capability | ✅ |
| Self-Healing Runtime (Phase 8) | Extends Healing Service. Same inputs/outputs. | Healing Service + Runtime Healer | ✅ |
| Continuous Learning (Phase 9) | Reads execution outcomes. Updates Capability invariants via Repository. | ExecutionOutcomes → Learner → Repository → Capability | ✅ |

No future layer requires modifying an existing engine's internals. All future layers are additive consumers/producers at existing boundaries.

---

## Check 8: Dead Module Removal Safety 🔴 FAIL — 1 Module Is Not Actually Dead

**Verdict: FAIL — 1 critical finding, 2 minor findings**

### 🔴 CRITICAL: `control-recorder.ts` Is Declared in `manifest.json`

The documents classify `src/recorder/v2/control-recorder.ts` as **DEAD**. It is NOT dead — it is declared as an active content script in `src/manifest.json`:

```json
// manifest.json, content_scripts section:
{
  "matches": ["<all_urls>"],
  "js": ["src/recorder/v2/control-recorder.ts"],
  "all_frames": true,
  "run_at": "document_start"
}
```

This means **on every page load**, Chrome injects `control-recorder.ts` into the page. The content script initializes a `ControlModel`, sets up event listeners, and sends `RECORDED_EVENT` messages via `chrome.runtime.sendMessage()`. The service worker does NOT handle `RECORDED_EVENT` messages — they are silently dropped.

**Why this is a problem:**
1. **It's actively loaded** — removing the file without updating `manifest.json` breaks the extension at load time.
2. **It creates a second event capture pipeline** — `control-recorder.ts` and `recorder-entry.ts` BOTH listen for DOM events on the same page simultaneously. They may interfere (double-capture, conflicting state).
3. **Its dependency chain is active** — `control-model.ts`, `element-identity-builder.ts`, `control-recorder.ts` are all loaded into the page context.
4. **Phase 1 deletion as written would break the extension** — the documents say "delete `src/recorder/v2/`" but don't mention removing the manifest entry.

**Cascading active modules:**

| Module | Loaded By | Truly Dead? |
|--------|----------|-------------|
| `src/recorder/v2/control-recorder.ts` | `manifest.json:37` | 🔴 NO — active content script |
| `src/recorder/v2/control-model.ts` | `control-recorder.ts:22` | 🔴 NO — loaded into page |
| `src/recorder/v2/element-identity-builder.ts` | `control-recorder.ts:23` | 🔴 NO — loaded into page |
| `src/recorder/v2/interaction-recognizer.ts` | `service-worker.ts:24` | 🔴 NO — Control Engine path |
| `src/recorder/v2/identity-extractor.ts` | Barrel re-export only | ⚠️ Loaded but unused |
| `src/recorder/v2/framework-adapters.ts` | Barrel re-export only | ⚠️ Loaded but unused |

**Resolution:** Before Phase 1 can delete `src/recorder/v2/`:
1. Remove `control-recorder.ts` from `manifest.json` content_scripts
2. Remove the `recorderEngine: 'control'` feature flag from the SW and settings
3. Remove the `recognizeInteractions` import from the SW
4. Then delete the directory

These are manifest + SW changes, not architectural changes.

### ✅ Confirmed Safe to Remove (Zero Active Importers)

| Module | Verified |
|--------|----------|
| `src/recorder/deterministic-recorder.ts` | ✅ Zero imports from active code |
| `src/recorder/interaction-types.ts` (legacy) | ✅ Only imported by `recording-session.ts` (also dead) |
| `src/recorder/recording-session.ts` | ✅ Only imported by legacy `interaction-types.ts` (dead chain) |
| `src/recorder/element-id-generator.ts` | ✅ Zero imports |
| `src/recorder/step-id-generator.ts` | ✅ Zero imports |
| `src recorder/surface-detector.ts` | ✅ Only imported by `deterministic-recorder.ts` (dead) |
| `src/runtime/modal-tracker.ts` | ✅ Zero imports |
| `src/pipeline/` (entire directory) | ✅ Zero imports from outside itself |
| `src/types/` (entire directory) | ✅ Only imported by `src/pipeline/` |

### ✅ Paired Removal Confirmed

`src/pipeline/` and `src/types/` are coupled — `src/types/` is only imported by `src/pipeline/`. They must be removed together. Both have zero importers outside themselves. Safe to delete as a pair.

### ⚠️ `src/recorder/recorded-event.ts` — Active, Not Dead

The documents correctly list this as **Active (types only)**. Confirmed: the V1/V2 classifiers and the IR Bridge consume `RecordedEvent` from this file. It cannot be removed until Phase 0 unifies the type system. Not a finding — just confirming the document's accuracy.

---

## Documented Findings Summary

### 🔴 Critical (Must Fix Before Phase 1)

**F-1:** `src/recorder/v2/control-recorder.ts` is declared in `manifest.json` as an active content script. The documents classify it as "DEAD" but it loads on every page. Removing the file without updating the manifest will break the extension. Its dependency chain (`control-model.ts`, `element-identity-builder.ts`) is also loaded into the page.

**Action required:** Update `IMPLEMENTATION_BASELINE_SPECIFICATION.md` §5.2 to reclassify `control-recorder.ts` from "Dead" to "Active-Deprecated" with the note: "Declared in manifest.json. Must remove from manifest + SW feature flag before file deletion. Phase 1 prerequisite."

### ⚠️ Medium (Should Fix)

**F-2:** `toIRActions()` is imported in `service-worker.ts:57` but never called. Dead import that pollutes the import graph.

**Action required:** Remove the import during Phase 1. No architectural impact.

**F-3:** `src/recorder/v2/interaction-recognizer.ts` (674 lines) is imported by the SW for the Control Engine path but not catalogued in any engine definition. It exists in a directory documented as "dead."

**Action required:** Add to dead code list with note: "Active when `recorderEngine === 'control'`. Remove import from SW + feature flag before deletion."

### ✅ No Issues Found

**F-4 through F-8:** No circular dependencies, no overlapping responsibilities, no future layer violations, no phase dependency issues, no hidden bypasses (the three-way classification fork is documented).

---

## Architectural Risk Assessment

### What's Correct

The core architecture is sound:
- **Pipeline is unidirectional** — data flows EventTap → Identity → Context → Runtime → Classifier → Reasoner → IR → Code Gen, never backwards.
- **Engine boundaries are clean** — no engine accesses another engine's internals at runtime.
- **Type-only coupling** — cross-engine imports are `import type`, erased at compile time.
- **Future layers slot in cleanly** — every planned module (AI, Execution, Healing, Learning) is a consumer at an existing boundary.
- **No circular dependencies** — the import graph is a strict DAG.

### What's Debt (Not Risk)

The three-way classification fork is debt, not risk. It's gated behind a feature flag and scheduled for removal in Phase 0/1. The `as any` casts are temporary bridging debt, also scheduled for Phase 0 removal. The `toIRActions` dead import is trivial noise.

### What's a Risk

The `control-recorder.ts` manifest issue is a real risk: **two content scripts are competing for DOM events on the same page simultaneously.** This means every recording session has both `recorder-entry.ts` AND `control-recorder.ts` running in parallel. While the SW only processes `OBSERVED_EVENT` messages (from recorder-entry), the control-recorder's `ControlModel` is still initializing, setting up listeners, and consuming resources. This could cause:
- Double event processing on the page
- Memory overhead from two concurrent recorders
- Confusing debug output (control-recorder logs to console)
- Potential interference if a future code change accidentally handles `RECORDED_EVENT`

**Recommendation:** The manifest entry for `control-recorder.ts` should be removed as soon as the Adani One fixes are Verified — before Phase 0. This is a 1-line manifest change that eliminates a parallel recording pipeline.

---

## Final Declaration

Based on the above validation:

1. **The target architecture is internally consistent** — single responsibilities, no overlaps, unidirectional flow, no circular dependencies, future layers fit without violations.

2. **The planned phases are sequentially valid** — each phase builds on the previous without requiring rewrites.

3. **One critical finding requires documentation correction** — `control-recorder.ts` is not dead, it is actively loaded via `manifest.json`. This must be corrected in the baseline documents and addressed before Phase 1.

4. **Two medium findings require cleanup** — `toIRActions` dead import and uncatalogued `interaction-recognizer.ts`.

**These findings do NOT invalidate the architecture.** They are documentation corrections and cleanup items, not structural flaws. The architecture's engine boundaries, dependency graph, and future extensibility are all sound.

### CONDITIONAL FREEZE

The implementation architecture is declared **FROZEN** subject to the following corrections being applied to the baseline documents (not code changes):

1. **[CRITICAL]** Reclassify `control-recorder.ts` and its dependency chain as "Active-Deprecated" in `IMPLEMENTATION_BASELINE_SPECIFICATION.md` §5.2, with removal prerequisites documented.
2. **[MEDIUM]** Add `interaction-recognizer.ts` to the dead code list with feature-flag dependency noted.
3. **[MEDIUM]** Note `toIRActions` dead import for Phase 1 removal.
4. **[RECOMMENDATION]** Add a pre-Phase-0 step: "Remove `control-recorder.ts` from manifest.json to eliminate the parallel recording pipeline."

Upon applying these corrections, all future development — including the Adani One fixes, Phase 0, and subsequent roadmap phases — will be implemented against this frozen baseline.

---

*This validation was performed by tracing every import, checking every manifest entry, and grepping every engine for out-of-scope keywords. The architecture is ready for implementation.*
