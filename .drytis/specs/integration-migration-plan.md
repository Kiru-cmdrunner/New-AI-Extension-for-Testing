# Integration & Migration Plan: Control Model → Production

> **Goal:** Evolutionary replacement of the recording pipeline, stage by stage,
> each producing a working extension you can install and test.
>
> **Principle:** The old recorder keeps running until the new one is proven
> against real workflows. A feature flag toggles between them at runtime.

---

## Current Production Pipeline (what runs today)

```
Content Script                          Service Worker (post-stop)
─────────────                           ──────────────────────────
deterministic-recorder.ts               V1: detectInteractions()
  13 event listeners                    V2: detectInteractionsV2()
  resolveTarget() [3-strategy]          mergeV1V2()
  extractIdentity() [18 fields]         runPipeline():
  detectSurfaceAfterClick()               domain-adapter → entities
  hover detection                         recognition/orchestrator
  date picker capture                     enrichment (7 steps)
       │                                  IR bridge → ExecutionIRPlan
       ▼                                  Playwright generator
  RECORDED_EVENT messages                 Storage writes
       │                                       │
       ▼                                       ▼
  Service Worker                           Side Panel
  session.addElementEvent()                (renders results)
```

**~12,000 lines across ~40 production files.**

---

## What Gets Replaced vs What Stays

### WILL BE REPLACED (the capture + classification layers)

| Module | Lines | Why Replace |
|--------|-------|-------------|
| `deterministic-recorder.ts` | 2,739 | Root cause of all 5 bugs — element-centric `resolveTarget()` returns wrong target, no composite control awareness, blind CSS selectors |
| `interaction-detector.ts` (V1) | 807 | Deterministic if/else cascade — no custom dropdown rule, no OXD awareness, confidence always 1.0 |
| `evidence/detector.ts` (V2) | 80 | Evidence providers never fire for OXD controls — ARIA mismatch, 0 RecognisedInteractions |
| `evidence/engine.ts` | 534 | Relationship detection (`isRelatedToBuffer`) too simplistic for composite controls |
| `evidence/merge-layer.ts` | 188 | Unnecessary — new pipeline produces one classification, not two to merge |
| `evidence/combination.ts` | 154 | Unnecessary — replaced by direct pattern evaluation |
| `evidence/types.ts` | 168 | Unnecessary — replaced by Phase 1-5 type system |

**Total replaced: ~4,870 lines**

### WILL REMAIN UNCHANGED (the output + persistence layers)

| Module | Lines | Why Keep |
|--------|-------|----------|
| `generation/ir-bridge.ts` | 716 | Works correctly — maps interactions to IR steps. Will receive better input data. |
| `domain/locator-ranking.ts` | 349 | Locator ranking logic is sound. Will receive better target identity data. |
| `adapters/playwright/*` | ~2,100 | Code generation works correctly. All renderers stay. |
| `domain/entities/*` | ~1,500 | Domain model is well-designed. UiElement, ObservedTransition, etc. stay. |
| `domain/enums.ts` | 214 | Canonical enums stay. |
| `domain/execution-ir/types.ts` | 277 | IR type system stays. |
| `sidepanel/sidepanel.ts` | 1,301 | UI stays. Will receive better data to display. |
| `sidepanel/timeline-renderer.ts` | 646 | Rendering stays. |
| `storage/*` | varies | Dexie storage stays. |
| `recorder/recorded-event.ts` | 205 | Shared types stay (used by storage + IR bridge). |
| `classifier/interaction-types.ts` | 221 | DetectedInteraction type stays (consumed by IR bridge). |

**Total kept: ~5,500+ lines**

### WILL BE ADAPTED (bridge layer)

| Module | What Changes |
|--------|-------------|
| `recorder/pipeline/pipeline-runner.ts` | New stage: if Control Model data is present, use new recognizer instead of V1/V2 |
| `recorder/pipeline/domain-adapter.ts` | New adapter: ControlModel actions → DomainEntities (simpler than current event→interaction→entity chain) |
| `background/service-worker.ts` | Route to new pipeline when feature flag is on; old path when off |

### NEW PRODUCTION MODULES (from validated prototypes)

| Module | Source Prototype | Lines (est.) | Role |
|--------|-----------------|-------------|------|
| `recorder/v2/control-model.ts` | milestone5 IntegratedControlModel | ~350 | Discovery + MutationObserver + matchEvent |
| `recorder/v2/identity-extractor.ts` | milestone5 getAccessibleName + getRole | ~200 | W3C role inference + accessible name computation |
| `recorder/v2/framework-adapters.ts` | milestone2 OXD adapter | ~100 | OXD class→role mapping, wrapper detection |
| `recorder/v2/event-tap.ts` | milestone5 onInteraction handler | ~250 | Event listeners → Control Model match → interaction classification |
| `recorder/v2/interaction-recognizer.ts` | milestone5 InteractionRecognizer | ~300 | State machine producing SemanticActions |
| `recorder/v2/control-recorder.ts` | (new) | ~150 | Content script entry point, wires everything together |
| `recorder/v2/recognizer-adapter.ts` | (new) | ~120 | SemanticActions → DetectedInteraction[] (feeds existing IR bridge) |

**Total new: ~1,470 lines** (vs ~4,870 replaced — 70% reduction in capture+classify code)

---

## Data Flow Comparison

### Before (current)

```
DOM Event
  → resolveTarget() [3-strategy, returns wrong element]
    → extractIdentity() [18 fields, no composite awareness]
      → RECORDED_EVENT message
        → V1 classifier [if/else cascade, no custom dropdown]
        → V2 classifier [evidence engine, never fires for OXD]
          → mergeV1V2 [picks V2 when confident, else V1]
            → domain-adapter [RecordedEvent → UiElement + Transition]
              → recognition orchestrator [pattern matching]
                → enrichment [7 steps]
                  → IR bridge
                    → Playwright
```

**8 stages, 2 classification engines, 1 merge layer.**

### After (target)

```
DOM Event
  → Control Model matchEvent() [composedPath + ancestor walk, skips composites]
    → InteractionRecognizer [state machine: click/input/blur/scroll → verb]
      → SemanticActions [{verb, target, role, value, timestamp}]
        → recognizer-adapter [→ DetectedInteraction[] with correct type + target]
          → domain-adapter [simplified: action → UiElement + Transition]
            → enrichment [unchanged]
              → IR bridge [unchanged]
                → Playwright [unchanged]
```

**6 stages, 1 classification engine, no merge layer.** Enrichment onward is untouched.

---

## Integration Stages

Each stage produces a **working extension** you can install and test.
A `chrome.storage` feature flag (`recorder_engine: 'legacy' | 'control'`)
controls which pipeline runs.

### Stage 1 — Production Control Model Module

**What:** Extract the validated discovery + matching algorithms from milestone
tests into production source files. No wiring yet — unit tests only.

**Files created:**
- `src/recorder/v2/control-model.ts` — IntegratedControlModel with discover(),
  observe(), matchEvent(), findByElement()
- `src/recorder/v2/identity-extractor.ts` — getRole(), getAccessibleName(),
  isPlaceholderText()
- `src/recorder/v2/framework-adapters.ts` — OXD_CLASS_ROLE_MAP, isOxdWrapper()
- `src/recorder/v2/index.ts` — barrel export

**Tests:** Port all milestone2 event-matching tests (34 tests) to import from
production source instead of inline definitions. All must pass.

**What you can test:** Nothing visible yet. This is infrastructure.

**Rollback:** Delete `src/recorder/v2/` directory. Zero impact on existing code.

---

### Stage 2 — New Content Script (Capture Layer)

**What:** Create a new content script that uses the Control Model for target
resolution and event capture. It sends the SAME `RECORDED_EVENT` message format
so the existing downstream pipeline works unchanged. The feature flag controls
which content script is active.

**Files created:**
- `src/recorder/v2/control-recorder.ts` — Content script entry point:
  - Registers 7 event listeners (click, input, blur, keydown, scroll,
    mouseover, dragstart/drop) at capture phase
  - On each event: `model.matchEvent(target)` → resolves correct control
  - Builds `RecordedEventMessage` with the CORRECT target (via Control Model,
    not `resolveTarget()`)
  - Includes composite control context in `domContext` (parentControl role,
    accessible name, control kind)
  - Sends to service worker via `chrome.runtime.sendMessage`

**Files modified:**
- `src/manifest.json` — Conditional content script loading (the feature flag
  determines which script runs; implemented via SW-injected scripting API or
  manifest with both scripts + early-exit guard in each)

**Files modified:**
- `src/background/service-worker.ts` — On `START_RECORDING`: check feature flag.
  If `'control'`: inject `control-recorder.ts`. If `'legacy'`: inject
  `deterministic-recorder.ts` (current behavior).

**What changes for you:** When the flag is on, target identification is
correct. Nationality resolves to Nationality, not Blood Type. Click "Save"
resolves to Save, not "I". But classification is still done by V1/V2 — so
the interaction LIST may look different (better targets) but the verb types
come from the old classifier.

**Tests:**
- Automated: milestone2 event-matching tests (34) against production module
- Manual: Record on OrangeHRM My Info, check that raw events show correct
  target names in the timeline
- Manual: Compare Nationality/Marital Status/Blood Type targets

**Rollback:** Set feature flag to `'legacy'`. Old content script resumes.
No code changes needed.

**Old pipeline still used:** V1/V2 classifier, merge, domain adapter,
recognition, enrichment, IR bridge.

---

### Stage 3 — New Classifier (Recognition Layer)

**What:** Create the InteractionRecognizer that takes Control Model events and
produces `DetectedInteraction[]` directly — no V1, no V2, no merge. The
recognizer implements the validated state machine from milestone5.

**Files created:**
- `src/recorder/v2/interaction-recognizer.ts` — The state machine:
  - `onInteraction(type, control, options)` — processes each event
  - `_handleClick` — dropdown option detection, date picker day detection,
    radio/checkbox dedup, button/link classification
  - `_handleInput` / `_handleBlur` — text entry lifecycle (click→type→blur = fill)
  - `_handleScroll` — burst coalescing (500ms window)
  - `flush()` — emit pending state on Stop
  - `actions: SemanticAction[]` — output

- `src/recorder/v2/recognizer-adapter.ts` — Bridge to existing pipeline:
  - Converts `SemanticAction[]` → `DetectedInteraction[]`
  - Maps verbs to InteractionType (fill→TextEntry, select→CustomDropdown,
    toggle→Checkbox, selectDate→DatePicker, click→Click, navigate→Link)
  - Builds `ElementIdentity` from Control node data (role, accessibleName,
    classes, tag)
  - Sets confidence=1.0 (deterministic)

**Files modified:**
- `src/background/service-worker.ts` — On `STOP_RECORDING`: check feature flag.
  If `'control'`: run `recognizer-adapter` instead of V1+V2+merge. Feed result
  directly to `runPipeline()`. If `'legacy'`: current behavior.

**What changes for you:** Full behavioral improvement. The 9-step workflow
should now produce correct results:
1. Fill First Name → "John"
2. Fill Last Name → "Doe"
3. Select Nationality → "American" (not Blood Type!)
4. Select Marital Status → "Single" (not Blood Type!)
5. Select Gender → "Female"
6. Select Date of Birth → "15" (single step, not fragmented)
7. Click Save → "Save" (not "I"!)

**Tests:**
- Automated: milestone5 acceptance tests (28) against production modules
- Automated: Full test suite (3,400+ tests) must pass
- Manual: Record the full OrangeHRM My Info workflow
- Manual: Verify the generated Playwright code has correct locators
- Manual: Test on a non-OXD page (semantic HTML form)

**Rollback:** Set feature flag to `'legacy'`. V1/V2 classifier resumes.

**Old pipeline still used:** domain-adapter (minor adaptation), enrichment,
IR bridge, Playwright generator.

---

### Stage 4 — Domain Adapter Simplification

**What:** Simplify the domain adapter to work directly with SemanticActions
instead of the RecordedEvent → DetectedInteraction → DomainEntity chain.
Remove the intermediate recognition orchestrator call (the recognizer already
produces correct component classifications).

**Files modified:**
- `recorder/pipeline/domain-adapter.ts` — New path: when Control Model data is
  present, skip the V1/V2-style event grouping and go directly from
  SemanticAction → UiElement + ObservedTransition. Much simpler mapping.
- `recorder/pipeline/pipeline-runner.ts` — When flag is `'control'`: skip
  recognition orchestrator (already done by InteractionRecognizer), go straight
  to enrichment.

**What changes for you:** Faster post-stop processing. Enrichment quality may
improve because component data is richer (control role, parent group, etc.).
IR steps should be identical or better.

**Tests:**
- Automated: IR bridge tests must pass with new domain entities
- Automated: Playwright output comparison (diff against Stage 3 output)
- Manual: Compare IR steps and generated code quality vs Stage 3

**Rollback:** Set feature flag to `'legacy'`.

**Old pipeline still used:** enrichment, IR bridge, Playwright (all unchanged).

---

### Stage 5 — Parallel Validation (A/B Testing)

**What:** Run BOTH pipelines simultaneously during recording. The extension
captures with the Control Model AND the old recorder in parallel. After Stop,
both pipelines process the same session. The side panel shows both result sets
side by side for comparison.

**Files modified:**
- `src/sidepanel/sidepanel.ts` — Add comparison view: "Legacy Pipeline" vs
  "Control Model Pipeline" sections showing step count, interaction types,
  target names, Playwright code diff.
- `src/background/service-worker.ts` — Run both pipelines, store both results
  under separate storage keys.

**What changes for you:** You can directly compare old vs new output on ANY
website. This is the validation stage — record on OrangeHRM, Salesforce,
your own apps, etc. and compare.

**Tests:**
- Manual: Record 5+ different workflows across different frameworks
- Manual: Compare step counts, target accuracy, Playwright code quality
- Automated: Parity tests (milestone5 behavioural parity suite, 10 tests)

**Rollback:** Set flag to `'legacy'`. Comparison view hidden.

**Old pipeline still used:** Yes — this is the comparison stage.

---

### Stage 6 — Cutover (Old Code Disabled)

**What:** Feature flag defaults to `'control'`. Old recorder code is still
present but not loaded. Manifest no longer references
`deterministic-recorder.ts`.

**Prerequisites (all must be met):**
1. ✅ Stage 5 comparison shows equal or better output on 20+ workflows
2. ✅ No regression on any interaction type from the acceptance test suite
3. ✅ Playwright code generation produces valid, runnable tests
4. ✅ Performance: post-stop processing < 2 seconds for typical sessions
5. ✅ No console errors during recording on 5+ different websites
6. ✅ Extension doesn't crash on SPA navigation, shadow DOM, or iframes
7. ✅ Side panel renders all sections correctly

**Files modified:**
- `manifest.json` — Remove `deterministic-recorder.ts` from content_scripts
- `service-worker.ts` — Remove V1/V2/merge code paths (or gate behind
  unreachable flag)

**What changes for you:** The extension is now running the new architecture
exclusively. Old code exists but is dead.

**Tests:**
- Full manual re-test of all interaction types
- Full automated suite

**Rollback:** Re-add `deterministic-recorder.ts` to manifest, set flag to
`'legacy'`. ~5 minutes.

---

### Stage 7 — Cleanup (Old Code Removed)

**What:** Delete the old capture and classification code that is no longer
used.

**Files deleted:**
- `src/recorder/deterministic-recorder.ts` (2,739 lines)
- `src/classifier/interaction-detector.ts` (807 lines)
- `src/classifier/evidence/detector.ts` (80 lines)
- `src/classifier/evidence/engine.ts` (534 lines)
- `src/classifier/evidence/merge-layer.ts` (188 lines)
- `src/classifier/evidence/combination.ts` (154 lines)
- `src/classifier/evidence/types.ts` (168 lines)

**Prerequisite:** Stage 6 has been running in production for [agreed period]
with no issues.

**What changes for you:** Smaller extension bundle. No behavioral change.

**Rollback:** Git revert. The deleted code is in version control.

---

## Feature Flag Mechanism

```typescript
// chrome.storage.local key
type RecorderEngine = 'legacy' | 'control';

// Default: 'legacy' (Stages 1-4), 'control' (Stage 6+)

// Read at START_RECORDING time:
const engine = (await chrome.storage.local.get('recorder_engine'))
  .recorder_engine || 'legacy';

// Side panel toggle:
// Settings → Recorder Engine → [Legacy | Control Model]
```

The flag is checked at two points:
1. **START_RECORDING** — determines which content script to inject
2. **STOP_RECORDING** — determines which classifier pipeline to run

This means you can switch engines between recordings without reloading the
extension.

---

## Rollback Strategy Summary

| Stage | Rollback Action | Time | Data Loss |
|-------|----------------|------|-----------|
| 1 | Delete `src/recorder/v2/` | 1 min | None |
| 2 | Set flag to `'legacy'` | Instant | None |
| 3 | Set flag to `'legacy'` | Instant | None |
| 4 | Set flag to `'legacy'` | Instant | None |
| 5 | Set flag to `'legacy'` | Instant | None |
| 6 | Re-add to manifest + set flag | 5 min | None |
| 7 | Git revert | 10 min | None |

**Every stage is reversible without data loss.** The feature flag ensures
the old pipeline is always available until Stage 7.

---

## Old Pipeline Usage During Migration

| Stage | Content Script | Classifier | Domain Adapter | Enrichment | IR + Playwright |
|-------|---------------|------------|----------------|------------|-----------------|
| 1 | Legacy | Legacy | Legacy | Legacy | Unchanged |
| 2 | **Control** | Legacy | Legacy | Legacy | Unchanged |
| 3 | **Control** | **Control** | Legacy | Legacy | Unchanged |
| 4 | **Control** | **Control** | **Control** | Legacy | Unchanged |
| 5 | Both | Both | Both | Legacy | Unchanged |
| 6 | **Control** | **Control** | **Control** | Legacy | Unchanged |
| 7 | **Control** | **Control** | **Control** | Legacy | Unchanged |

Key insight: **enrichment, IR bridge, and Playwright generation are never
replaced.** They receive better input data but their logic is unchanged.

The enrichment stage may receive improvements in a future phase (Phase 6 of
the Architecture Evolution Blueprint — three-layer enrichment model), but
that is independent of this migration.

---

## Test Strategy Per Stage

### Automated Tests (run after every stage)

| Suite | Tests | What It Validates |
|-------|-------|-------------------|
| milestone2 event-matching | 34 | Control Model discovers + matches events correctly |
| milestone3 sync-identity | 23 | Controls survive re-renders, mutations tracked |
| milestone4 performance | 26 | Budget enforcement, scaling, O(1) lookups |
| milestone5 acceptance | 28 | Correct verb/target/value per interaction type |
| Full regression suite | 3,400+ | No existing tests broken |

### Manual Tests (user performs after each stage)

| Test | When | What To Check |
|------|------|---------------|
| OrangeHRM My Info (9 steps) | Stages 2-6 | Correct targets, no Blood Type bug |
| Semantic HTML form | Stages 2-6 | Basic interaction types work |
| MUI form | Stages 3-6 | Framework compatibility |
| Ant Design form | Stages 3-6 | Framework compatibility |
| SPA navigation | Stages 3-6 | Control Model survives route changes |
| Shadow DOM page | Stages 3-6 | Shadow root elements discovered |
| Generated Playwright runs | Stages 3-6 | Code is valid and executable |
| Console errors | Stages 2-6 | No JS errors during recording |

---

## When Can Old Code Be Safely Removed?

**Stage 7**, after ALL of these conditions are met:

1. Stage 6 has been the default for a full testing cycle
2. The 7 readiness criteria are all met (from the Migration Roadmap):
   - Interaction coverage: all 12 categories from acceptance test suite pass
   - Parity: 20+ real workflows produce equal or better output
   - No test regressions: full automated suite green
   - Playwright code gen: produces valid, runnable tests
   - Performance: < 2s typical post-stop processing
   - Crash recovery: no crashes on SPA nav, shadow DOM, iframes
   - Side panel rendering: all sections display correctly
3. User explicitly confirms satisfaction with the new recorder

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Content script bundling issues with @crxjs | Medium | High | Stage 1 validates module structure before wiring |
| Control Model performance on real enterprise DOMs | Low | Medium | Validated in M4 (linear scaling, budget enforcement) |
| Missing event types vs old recorder | Medium | Medium | Stage 5 A/B comparison catches gaps |
| IR bridge receives unexpected data shapes | Low | High | recognizer-adapter produces same DetectedInteraction[] format |
| Side panel rendering breaks | Low | Low | Storage keys unchanged, side panel code untouched |
| SPA navigation loses Control Model state | Medium | High | Validated in M3 (route change test). MutationObserver re-discovers. |
