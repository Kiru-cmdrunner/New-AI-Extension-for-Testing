# Behavioral Observation Removal Impact Audit

**Baseline**: commit `aef34a0` (capability-surgical-removal branch)
**Audit date**: 2026-08-11
**Scope**: Full trace of every import, call site, storage key, UI consumer, test, and dependency for the Behavioral Observation system at `aef34a0`.
**Method**: Exhaustive grep + file read across all `src/` and `tests/` files.

---

## 1. What the Behavioral Observation Model Does Today

### 1.1 Purpose

The Behavioral Observation system captures **what the DOM actually did** after a user interaction. It opens a 3-second observation window after every `click` and `change` event, recording:

- **Element state snapshots** — 9 DOM properties (value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount) captured before and after
- **DOM mutations** — all MutationObserver records (childList, attributes, characterData) within the window
- **Semantic effects** — interpreted from the raw evidence into 7 categories: state-toggle, expand-collapse, enable-disable, content-change, visibility-change, no-observable-effect, unclassified

### 1.2 Architecture (7 Components)

| Component | File | LOC | Role |
|---|---|---|---|
| **ElementStateCache** | `src/tap/element-state-cache.ts` | 157 | WeakMap<Element, Snapshot>; `peek()` before, `read()` after |
| **StateCacheListeners** | `src/tap/state-cache-listeners.ts` | 80 | mousedown+focus capture-phase; pre-populates cache |
| **DocumentObserver** | `src/tap/document-observer.ts` | 364 | MutationObserver on document.body; refcounted lifecycle |
| **ObservationCoordinator** | `src/tap/observation-coordinator.ts` | 309 | Manages 3s windows; before→after capture; builds ObservationResult |
| **Effect Interpreter** | `src/semantics/effect-interpreter.ts` | 78 | Pure function; runs 5 rules + 2 fallbacks |
| **Effect Rules** | `src/semantics/effect-rules.ts` | 567 | 5 rule functions + computeQuality + 2 fallbacks |
| **SW Bridge** | `src/semantics/sw-bridge.ts` | 67 | Translates ComponentInteraction → InterpretationContext; calls interpret() |
| **Behavioral Renderer** | `src/sidepanel/behavioral-renderer.ts` | 454 | Side panel display: state diffs, mutations, semantic effects |

**Supporting types** (shared):
- `src/shared/observation-types.ts` (201 LOC) — MutationRecord2, ElementStateSnapshot, ObservationWindow, ObservationResult
- `src/semantics/effect-types.ts` (87 LOC) — SemanticEffect, EffectCategory, Confidence, ConfidenceBasis
- `src/semantics/interpretation-context.ts` (23 LOC) — InterpretationContext

**Total behavioral source**: ~2,963 LOC

### 1.3 Data Flow

```
Content Script (recorder-entry.ts)
  ├── mousedown/focus → ElementStateCache.capture(el)     [StateCacheListeners]
  ├── click/change → ObservationCoordinator.openWindow()   [EventTap onAfterEvent]
  │     ├── peek cache for before-state
  │     ├── DocumentObserver.start(windowId)
  │     └── 3s timer
  ├── window closes →:
  │     ├── ElementStateCache.read(el) → final-state
  │     ├── DocumentObserver.collectMutations(windowId)
  │     ├── DocumentObserver.stop(windowId)
  │     └── build ObservationResult → sendBehavioralResult()
  └── BEHAVIORAL_EFFECTS message → service worker

Service Worker (service-worker.ts + sw-integration.ts)
  ├── handleBehavioralEffects(result)
  │     ├── match by sourceEventId against live interactions
  │     ├── push to interaction.behavioralObservations[]
  │     ├── interpretBehavioralObservations(interaction) → SemanticEffect[]
  │     ├── broadcast INTERACTION_EFFECTS_UPDATE to side panel
  │     └── persist to chrome.storage.local under cmdrunner_obs_<eventId>
  ├── attachPendingBehavioralObservations (deferred correlation)
  ├── recoverDurableObservations (SW restart recovery)
  └── cleanupAllObsKeys (session-end sweep)

Side Panel (sidepanel.ts + interaction-renderer.ts + behavioral-renderer.ts)
  ├── INTERACTION_EFFECTS_UPDATE → merge behavioralObservations onto interaction
  └── renderInteraction():
        ├── renderSemanticEffects(effects) → "What happened" section
        └── renderBehavioralEvidence(observations) → collapsible evidence cards
```

---

## 2. Where It Is Used / Depended On

### 2.1 Direct Importers (source files that import behavioral modules)

| Source File | What It Imports | Purpose |
|---|---|---|
| `src/recorder/phase5/recorder-entry.ts` | ElementStateCache, DocumentObserver, ObservationCoordinator, setupStateCacheListeners, ObservationResult type | **Content script integration hub** — creates and wires all 4 tap components |
| `src/background/service-worker.ts` | ObservationResult type, interpretBehavioralObservations | **SW handler** — receives BEHAVIORAL_EFFECTS, correlates, interprets, persists |
| `src/runtime/sw-integration.ts` | ObservationResult type, interpretBehavioralObservations | **SW state management** — pending buffer, durable recovery, cleanup |
| `src/shared/component-types.ts` | ObservationResult type | **Type definition** — `behavioralObservations?: ObservationResult[]` on ComponentInteraction |
| `src/shared/types.ts` | ObservationResult (inline import) | **Message type** — `BEHAVIORAL_EFFECTS` variant in SWMessage union |
| `src/sidepanel/interaction-renderer.ts` | renderBehavioralEvidence, renderSemanticEffects, ObservationResult type | **Side panel rendering** — displays evidence under each interaction |
| `src/sidepanel/sidepanel.ts` | (runtime, no type import) | **Live update handler** — INTERACTION_EFFECTS_UPDATE listener |
| `src/tap/element-state-cache.ts` | ElementStateSnapshot type | Internal type reference |
| `src/tap/document-observer.ts` | MutationRecord2 type | Internal type reference |
| `src/tap/observation-coordinator.ts` | ElementStateCache, DocumentObserver types + observation-types | Internal type references |
| `src/semantics/effect-interpreter.ts` | ObservationResult type | Internal |
| `src/semantics/effect-rules.ts` | observation-types | Internal |
| `src/semantics/sw-bridge.ts` | interpret, InterpretationContext | Internal |
| `src/shared/observation-types.ts` | SemanticEffect type | **Cross-reference** — ObservationResult.semanticEffects? field |

### 2.2 Storage Keys

| Key Pattern | Location | Purpose | Lifetime |
|---|---|---|---|
| `cmdrunner_obs_<sourceEventId>` | chrome.storage.local (SW) | Durable per-observation persistence | Created in handleBehavioralEffects, deleted at safe points (SP1/SP2/SP3) |
| `cmdrunner_behavioral_buffer` | sessionStorage (content script) | MV3 resilience buffer for unacked observations | Max 200 entries; flushed on startRecording and pagehide |

### 2.3 Message Types

| Message Type | Direction | Payload |
|---|---|---|
| `BEHAVIORAL_EFFECTS` | content script → service worker | ObservationResult |
| `INTERACTION_EFFECTS_UPDATE` | service worker → side panel | { interactionId, behavioralObservations } |

### 2.4 UI Consumers

| Component | What It Displays |
|---|---|
| Side panel "What happened" section | SemanticEffect[] — human-readable effect descriptions with confidence badges |
| Side panel "Behavioral Evidence" section | ObservationResult[] — collapsible cards with before→after state diffs and mutation lists |

---

## 3. What Works, Bugs, Limitations, Technical Debt

### 3.1 What Works

1. **Element state capture** — correctly reads 9 DOM properties before/after interaction
2. **DOM mutation observation** — captures all childList/attributes/characterData changes
3. **Window lifecycle** — 3s independent timers with proper refcounting
4. **Semantic effect interpretation** — 5 rules + 2 fallbacks, pure function, well-tested
5. **MV3 durability** — per-observation storage keys with safe-point cleanup
6. **SW restart recovery** — recoverDurableObservations re-pends orphaned observations
7. **Side panel display** — before→after diffs, mutation lists, semantic effect badges
8. **State cache pre-population** — capture-phase mousedown/focus listeners

### 3.2 Confirmed Bugs & Limitations (from deff878 layer audits, confirmed present at aef34a0)

| ID | Severity | Issue |
|---|---|---|
| 1B-C-1 | **CRITICAL** | Observation windows open ONLY for click and change — 70%+ of interactions (keydown, submit, scroll, hover, focus) get zero behavioral evidence |
| 1B-C-2 | **CRITICAL** | MutationObserver observes document.body only — does not cross shadow DOM boundaries |
| 1B-H-1 | HIGH | 3-second fixed window — too short for async network responses, too long for instant toggles |
| 1B-H-2 | HIGH | Orphaned `cmdrunner_obs_*` keys accumulate in chrome.storage.local if SW dies between creation and cleanup — 143MB/3hrs observed |
| 1B-H-3 | HIGH | MutationObserver records EVERY mutation with no cap — heavy DOM pages produce massive evidence arrays |
| 1B-H-4 | HIGH | CSS path computed via custom algorithm stored in WeakMap — path quality unvalidated, may produce brittle selectors |
| 1B-M-1 | MEDIUM | ObservationResult.performanceCondition is diagnostic-only — not used to filter or weight evidence |
| 1B-M-2 | MEDIUM | endReason 'element-removed' check uses `document.contains()` via WeakRef — can false-negative if element was re-created |
| 1B-M-3 | MEDIUM | stateCacheListeners capture on ALL mousedown/focus events, not just recording targets — unnecessary cache entries for non-interactive elements |

### 3.3 Key Architectural Limitations

1. **No connection to generation**: Behavioral observations and semantic effects are display-only. The IR Bridge (`ir-bridge.ts`), Playwright code generator, and session persistence service have ZERO imports from observation-types, semantics, or behavioral-renderer. No behavioral data influences test code generation.

2. **No connection to enrichment**: The enrichment layer (`src/enrichment/`) has no imports from observation-types or semantics.

3. **No connection to classification**: ComponentRuntime and EvidenceLedger do not import observation-types. Classification runs without any behavioral evidence input.

4. **Semantic effects are display-only**: `result.semanticEffects` is set on ObservationResult, rendered in the side panel, but consumed by NOTHING downstream. The Capability Model (the intended consumer) was removed in this same commit.

5. **Domain entities are speculative**: `ObservedTransition` (249 LOC) and `ApplicationKnowledgeFragment` (which references `ObservedTransition[]`) are defined but never instantiated. `fragment` is always `null` at the call site. These are forward-looking domain models with zero runtime instantiation.

---

## 4. What Data It Produces and Who Consumes It

### 4.1 Data Produced

| Data | Format | Volume |
|---|---|---|
| ObservationResult[] on each ComponentInteraction | Before→after snapshots + mutation array + window metadata | 1 per click/change event (0 for all other event types) |
| SemanticEffect[] on each ObservationResult | Category + description + confidence + affected target | 0–N per observation |
| chrome.storage.local entries | Serialized ObservationResult under `cmdrunner_obs_<id>` | 1 per observation; deleted at safe points |
| sessionStorage buffer | Serialized ObservationResult[] under `cmdrunner_behavioral_buffer` | Max 200; drained on flush |

### 4.2 Consumers

| Consumer | What It Does With The Data |
|---|---|
| **Side panel "What happened" section** | Displays SemanticEffect descriptions with confidence badges |
| **Side panel "Behavioral Evidence" section** | Displays before→after state diffs and mutation lists |
| **Nothing else** | No downstream system reads behavioral data |

### 4.3 What Does NOT Consume Behavioral Data

| System | Reads Behavioral? | Evidence |
|---|---|---|
| IR Bridge (test generation) | ❌ No | Zero imports from observation-types or semantics |
| Playwright code generator | ❌ No | Zero imports |
| Session persistence service | ❌ No | Zero imports (serializes raw interactions but never reads behavioralObservations) |
| ComponentRuntime (classification) | ❌ No | Zero imports |
| EvidenceLedger (classification) | ❌ No | Zero imports |
| Enrichment layer | ❌ No | Zero imports |
| Repository V2 (Dexie) | ❌ No | No behavioral/observation tables in schema |
| Healing service | ❌ No | Zero imports |

---

## 5. What Happens If We Remove the Entire Behavioral Observation Model

### 5.1 Impact Summary

**Functional impact: ZERO regression to test generation, classification, enrichment, or persistence.** Behavioral observation is a display-only overlay — no pipeline layer reads its output.

### 5.2 User-Visible Changes

1. **Side panel loses "What happened" section** — semantic effect descriptions with confidence badges disappear from each interaction card.
2. **Side panel loses "Behavioral Evidence" section** — collapsible before→after state diffs and mutation lists disappear.
3. **No change to generated Playwright code** — IR Bridge never read behavioral data.
4. **No change to recorded interactions** — EventTap capture, classification, and classification evidence are unaffected.
5. **No change to persisted sessions** — raw interactions are stored as-is in Repository V2; behavioralObservations were never queried.

### 5.3 Exact Code Affected

#### Files to DELETE (source — ~2,963 LOC)

| File | LOC | Category |
|---|---|---|
| `src/tap/observation-coordinator.ts` | 309 | Core infrastructure |
| `src/tap/document-observer.ts` | 364 | Core infrastructure |
| `src/tap/element-state-cache.ts` | 157 | Core infrastructure |
| `src/tap/state-cache-listeners.ts` | 80 | Core infrastructure |
| `src/shared/observation-types.ts` | 201 | Types |
| `src/semantics/effect-interpreter.ts` | 78 | Semantic interpretation |
| `src/semantics/effect-rules.ts` | 567 | Semantic interpretation |
| `src/semantics/effect-types.ts` | 87 | Types |
| `src/semantics/interpretation-context.ts` | 23 | Types |
| `src/semantics/sw-bridge.ts` | 67 | SW integration |
| `src/sidepanel/behavioral-renderer.ts` | 454 | UI display |
| `src/domain/entities/observed-transition.ts` | 249 | Speculative domain entity (never instantiated) |

#### Files to DELETE (speculative domain entities — forward-looking, never used)

These are NOT behavioral observation infrastructure but are tightly coupled domain models that reference behavioral concepts. They are **never instantiated at runtime**:

| File | LOC | Status |
|---|---|---|
| `src/domain/entities/observed-transition.ts` | 249 | Imported only by its own test file |
| `src/domain/entities/application-knowledge.ts` | 327 | Imported only by understanding-result.ts (fragment field, always null) |
| `src/domain/entities/component-grouping.ts` | ~250 | Imported only by its own test file |

**Enums that would become dead** (in `src/domain/enums.ts`):
- `TransitionOperation` (lines 188-197)
- `RelevanceLevel` (lines 178-186)
- `TransitionEvidenceType` (lines 199-206)
- `CascadeEffectType` (lines 208-217)

#### Files to DELETE (tests — ~5,121 LOC)

| File | LOC |
|---|---|
| `tests/tap/observation-coordinator.test.ts` | 486 |
| `tests/tap/document-observer.test.ts` | 389 |
| `tests/tap/element-state-cache.test.ts` | 242 |
| `tests/tap/state-cache-listeners.test.ts` | 176 |
| `tests/semantics/effect-interpreter.test.ts` | 272 |
| `tests/semantics/effect-rules.test.ts` | 776 |
| `tests/semantics/sw-bridge.test.ts` | 319 |
| `tests/semantics/fixtures.ts` | 106 |
| `tests/semantics/g6-details-expand-collapse.test.ts` | 168 |
| `tests/semantics/net-node-delta.test.ts` | 298 |
| `tests/sidepanel/behavioral-renderer.test.ts` | 853 |
| `tests/validation/subphase4-realworld-validation.test.ts` | 1,036 |
| `tests/domain/observed-transition.test.ts` | ~200 (estimated) |
| `tests/domain/component-grouping.test.ts` | ~200 (estimated) |

#### Files to MODIFY (source — integration point cleanup)

| File | Changes Required |
|---|---|
| `src/recorder/phase5/recorder-entry.ts` | Remove 6 imports (ElementStateCache, DocumentObserver, ObservationCoordinator, setupStateCacheListeners, ObservationResult type, BEHAVIORAL_BUFFER_KEY usage). Remove observation infrastructure init/cleanup blocks (~50 lines). Remove behavioral buffer functions (~80 lines). Remove `onAfterEvent` callback body for openWindow. Remove pagehide flush. Remove flushPendingBehavioralEvents. |
| `src/background/service-worker.ts` | Remove ObservationResult import, interpretBehavioralObservations import. Remove OBS_KEY_PREFIX const. Remove handleBehavioralEffects function (~60 lines). Remove BEHAVIORAL_EFFECTS case from onMessage handler. |
| `src/runtime/sw-integration.ts` | Remove interpretBehavioralObservations import, ObservationResult import. Remove OBS_KEY_PREFIX const. Remove pendingBehavioralEffects map. Remove addPendingBehavioralEffect, attachPendingBehavioralObservations functions. Remove observation correlation calls in initRecording, restoreFromStorage, stopRecording. Remove recoverDurableObservations function. Remove deleteObsKeys function. Remove cleanupAllObsKeys function. (~200 lines) |
| `src/shared/component-types.ts` | Remove ObservationResult import. Remove `behavioralObservations?: ObservationResult[]` field from ComponentInteraction. |
| `src/shared/types.ts` | Remove BEHAVIORAL_EFFECTS from SWMessage union. Remove 'BEHAVIORAL_EFFECTS' from message type list. |
| `src/sidepanel/interaction-renderer.ts` | Remove behavioral-renderer import. Remove ObservationResult import. Remove renderSemanticEffects call. Remove renderBehavioralEvidence call. Remove behavioralObservations access (~20 lines). |
| `src/sidepanel/sidepanel.ts` | Remove INTERACTION_EFFECTS_UPDATE handler. Remove behavioralObservations merge logic (~20 lines). |
| `src/domain/entities/understanding-result.ts` | Remove ApplicationKnowledgeFragment import. Remove `fragment` field (always null). |

#### Files to MODIFY (tests)

| File | Changes Required |
|---|---|
| `tests/domain/recording-session.test.ts` | Remove behavioralObservations references in test fixtures |
| `tests/session-persistence-service.test.ts` | Remove behavioralObservations references in UnderstandingResult test helpers |

### 5.4 What Continues Working Unchanged

| System | Status | Why |
|---|---|---|
| **Event capture** (EventTap) | ✅ Unchanged | EventTap is independent; only the `onAfterEvent` callback (which called openWindow) is removed |
| **Identity extraction** | ✅ Unchanged | No behavioral imports |
| **ComponentRuntime / Classification** | ✅ Unchanged | Zero behavioral imports; runs independently |
| **EvidenceLedger** | ✅ Unchanged | Zero behavioral imports |
| **14 component definitions** | ✅ Unchanged | Zero behavioral imports |
| **IR Bridge (test generation)** | ✅ Unchanged | Zero behavioral imports |
| **Playwright code generation** | ✅ Unchanged | Zero behavioral imports |
| **Session persistence** | ✅ Unchanged | Zero behavioral imports |
| **Repository V2 (Dexie)** | ✅ Unchanged | No behavioral/observation tables |
| **Healing service** | ✅ Unchanged | Zero behavioral imports |
| **Enrichment layer** | ✅ Unchanged | Zero behavioral imports |
| **Settings page** | ✅ Unchanged | No behavioral references |
| **Repository page** | ✅ Unchanged | No behavioral references |

---

## 6. Hidden Dependencies and Side Effects

### 6.1 Hidden Dependency: `onAfterEvent` in EventTap

The `EventTap` interface has an `onAfterEvent` callback. Currently, the ONLY consumer of `onAfterEvent` is `recorder-entry.ts` calling `observationCoordinator?.openWindow()`. After removal, the `onAfterEvent` parameter would be either removed from the `createEventTap` call or left as a no-op. **This is a clean change** — EventTap itself is not behavioral; only its hook is.

### 6.2 Hidden Dependency: `behavioralObservations` on ComponentInteraction

`ComponentInteraction.behavioralObservations?: ObservationResult[]` is a field on the primary interaction type. This field is:
- Written by: handleBehavioralEffects, attachPendingBehavioralObservations, recoverDurableObservations (all in sw-integration.ts)
- Read by: interaction-renderer.ts (display only)
- Serialized by: persistSession → rawInteractions (stored in Dexie as part of the interaction JSON blob, but never queried)
- NOT read by: IR Bridge, classification, enrichment, generation

Removing the field is safe — it's a display-only channel with no downstream consumers.

### 6.3 Hidden Dependency: `cmdrunner_obs_*` Storage Pollution

If behavioral observation is removed, existing `cmdrunner_obs_*` keys in chrome.storage.local from previous recording sessions remain as **orphaned garbage**. The `cleanupAllObsKeys()` function (called at session-end in sw-integration.ts) would be removed. A one-time cleanup of existing keys is recommended but not blocking.

### 6.4 No Hidden Dependency on Domain Enums

The enums `TransitionOperation`, `RelevanceLevel`, `TransitionEvidenceType`, `CascadeEffectType` are used ONLY by `observed-transition.ts`, `component-grouping.ts`, and `application-knowledge.ts`. No other source file references them. They can be removed safely.

### 6.5 ComponentRole Enum — Must Be Preserved

`ComponentRole` in `enums.ts` (lines 129-176) is used by `application-knowledge.ts` AND by other entities (ui-element.ts). If application-knowledge.ts is removed, ComponentRole must be checked for remaining consumers before removal.

### 6.6 No Effect on Message Router

The `BEHAVIORAL_EFFECTS` case in service-worker.ts's `onMessage` handler is one of ~15 cases. Removing it is a clean switch-case deletion with no side effects on other message handlers.

### 6.7 IntrinsicCapability Enum — Must Be Preserved

`IntrinsicCapability` (used by `application-knowledge.ts` via `UiElementSummary.capabilities`) is a separate concept used by `ui-element.ts` and other non-behavioral code. Must not be removed.

---

## 7. Summary

### Removal Safety: HIGH

The Behavioral Observation system is a **self-contained display-only overlay** with zero downstream consumers. It captures DOM evidence, interprets it into semantic effects, and displays both in the side panel. No pipeline layer — not classification, not enrichment, not IR generation, not Playwright code generation, not session persistence — reads any behavioral data.

**If removed**:
- Recording, classification, generation, and persistence continue **unchanged**
- Side panel loses "What happened" and "Behavioral Evidence" display sections
- ~2,963 LOC source + ~5,121 LOC tests deleted
- ~13 source files modified (import/type/integration cleanup)
- ~2 test files modified
- 3 speculative domain entities (observed-transition, application-knowledge, component-grouping) become dead and can optionally be removed
- 4 domain enums become dead and can optionally be removed

**Risk**: LOW. The only consumers are side-panel display. The integration points are well-isolated (recorder-entry.ts for capture, service-worker.ts + sw-integration.ts for SW-side processing, interaction-renderer.ts for display).

**Contradiction noted**: The domain entity files (`observed-transition.ts`, `application-knowledge.ts`, `component-grouping.ts`) define an elaborate knowledge model (BehavioralContract, StateMachine, LogicalAction, RecordedWorkflow, etc.) that was designed to be the output of behavioral observation + enrichment. However, none of this model is ever instantiated — `fragment` is always `null`. These represent a design aspiration that was never implemented. Removing behavioral observation makes these files definitively dead code; they were already dead code before removal (never instantiated, only tested in isolation).
