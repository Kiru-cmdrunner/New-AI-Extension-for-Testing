# Runtime Baseline Validation

**Date:** 2026-07-29
**Validated Against:**
- `IMPLEMENTATION_BASELINE.md` (baseline architecture, commit `f3acfbf`)
- `IMPLEMENTATION_BASELINE_SPECIFICATION.md` (frozen specification)
- `ARCHITECTURE_VALIDATION_REPORT.md` (static analysis validation)
- Live source code at commit `f3acfbf` (master HEAD)

**Validation Method:** Static code trace of the actual runtime execution path — manifest → content scripts → service worker → classifier → reasoner → IR → side panel — verified line-by-line against the documented architecture.

**Purpose:** Establish a verified runtime baseline so that every future change (Adani One fixes, Phase 0, subsequent roadmap phases) is implemented on the correct foundation and affects the active runtime pipeline.

---

## Executive Summary

| # | Check | Documented | Actual Runtime | Match? |
|---|-------|-----------|----------------|--------|
| 1 | Content scripts injected | recorder-entry.ts + control-recorder.ts | Both injected on every page | ✅ |
| 2 | Event capture content script | recorder-entry.ts (EventTap) | recorder-entry.ts (EventTap) | ✅ |
| 3 | Message types reaching SW | OBSERVED_EVENT | OBSERVED_EVENT (only) | ✅ |
| 4 | Active recorder pipeline | Component Runtime (live streaming) | Component Runtime (live streaming) | ✅ |
| 5 | Active classifier path | V1 `detectInteractions()` + V2 `detectInteractionsV2()` + `mergeV1V2()` | V1 + V2 + Merge (default `'legacy'` flag) | ✅ |
| 6 | Semantic reasoning path | `reasonAboutInteractions()` | `reasonAboutInteractions()` | ✅ |
| 7 | Pipeline producing side panel interactions | runPipeline → buildIRPlan → PlaywrightCodeGenerator | runPipeline → buildIRPlan → PlaywrightCodeGenerator | ✅ |
| 8 | Deprecated/parallel pipelines at runtime | control-recorder.ts ACTIVE-DEPRECATED, RECORDED_EVENT unhandled | Confirmed: dormant but loaded, RECORDED_EVENT silently dropped | ✅ |
| 9 | Implementation matches documented baseline | Yes (with documented findings) | Yes — all documented findings confirmed at runtime | ✅ |

**Verdict: PASS** — The runtime behaviour matches the documented architecture. The three previously identified findings (control-recorder.ts manifest entry, RECORDED_EVENT unhandled, toIRActions dead import) are all confirmed as described. No new mismatches discovered.

---

## 1. Content Scripts Actually Injected at Runtime

**Source:** `src/manifest.json:28-41`

The manifest declares **two content scripts**, both injected on every page load:

| # | File | matches | all_frames | run_at |
|---|------|---------|------------|--------|
| CS1 | `src/recorder/phase5/recorder-entry.ts` | `<all_urls>` | `true` | `document_start` |
| CS2 | `src/recorder/v2/control-recorder.ts` | `<all_urls>` | `true` | `document_start` |

**Additionally:** `src/recorder/v2/control-recorder.ts` is also listed in `web_accessible_resources` (line 24).

**Not injected:** `src/recorder/deterministic-recorder.ts` is NOT in the manifest — it exists in the codebase but is never loaded by Chrome.

---

## 2. Which Content Script Captures Browser Events

### CS1: `recorder-entry.ts` — THE ACTIVE EVENT CAPTURE PIPELINE

**File:** `src/recorder/phase5/recorder-entry.ts`

```
recorder-entry.ts
  ├── Imports createEventTap from ../../tap/event-tap (line 22)
  ├── Installs EventTap: eventTapHandle = createEventTap({ onEvent }) (line 184)
  ├── onEvent callback (line 163):
  │     ├── pushToBuffer(event) — sessionStorage resilience
  │     └── sendObservedEvent(event) — chrome.runtime.sendMessage
  ├── EventTap internally handles:
  │     ├── click, mousedown, contextmenu, focus, blur, input, change
  │     ├── mouseenter, mouseleave, mousemove, keydown, scroll
  │     ├── SPA navigation (History API monkey-patch)
  │     └── Identity extraction + DOM context extraction (inside EventTap)
  └── Sends: { type: 'OBSERVED_EVENT', payload: ObservedEvent }
       └── Retry with exponential backoff (100ms → 1600ms, 5 retries)
```

**This is the sole active event capture pipeline.** The EventTap (`src/tap/event-tap.ts`) internally handles identity extraction (`src/tap/identity-extractor.ts`) and DOM context extraction (`src/definitions/dom-context-extractor.ts`), producing `ObservedEvent` objects that are sent to the SW.

### CS2: `control-recorder.ts` — DORMANT PARALLEL PIPELINE

**File:** `src/recorder/v2/control-recorder.ts`

```
control-recorder.ts
  ├── Reads recorderEngine from chrome.storage.local (line 96-98)
  ├── isActive = (engine === 'control') (line 99)
  ├── DEFAULT engine = 'legacy' → isActive = false (line 98)
  ├── Registers 12 DOM event listeners (capture phase):
  │     click, dblclick, contextmenu, focus, blur, input,
  │     change, scroll, mouseenter, mouseleave, dragstart, drop
  ├── Every handler guarded by shouldCapture() (line 505-506):
  │     return isRecording && isActive && model !== null
  ├── With default 'legacy' flag: shouldCapture() always returns false
  │     → ALL 12 listeners are registered but NEVER fire
  └── Would send: { type: 'RECORDED_EVENT', ... } (if active)
```

**CS2 is loaded but completely dormant under default settings.** The 12 event listeners are registered on every page but `shouldCapture()` short-circuits because `isActive` is `false`. No `RECORDED_EVENT` messages are ever sent.

---

## 3. Which Message Types Reach the Service Worker

**Source:** `src/background/service-worker.ts:847-905`

The SW's `chrome.runtime.onMessage` listener handles:

| Message Type | Handled? | Handler | Line |
|---|---|---|---|
| `START_RECORDING` | ✅ | `handleStartRecording()` | 853 |
| `STOP_RECORDING` | ✅ | `handleStopRecording()` | 857 |
| `OPEN_SETTINGS` | ✅ | `chrome.runtime.openOptionsPage()` | 862 |
| `OPEN_REPOSITORY` | ✅ | Opens repository tab | 866 |
| `RUN_TEST` | ✅ | `handleRunTest()` | 871 |
| `PING` | ✅ | Responds `{ type: 'PONG', recording }` | 886 |
| `OBSERVED_EVENT` | ✅ | `handleObservedEvent(payload)` | 893 |
| `RECORDED_EVENT` | ❌ | **NOT HANDLED** — falls to `default: break` | 899-901 |

**At runtime, the only event-capture message type that reaches the SW is `OBSERVED_EVENT`** (from CS1/recorder-entry.ts). `RECORDED_EVENT` (from CS2/control-recorder.ts) is never sent (dormant flag) and would be silently dropped if it were (no handler).

---

## 4. Which Recorder Pipeline Is Actually Active

### During Recording (Live Streaming)

```
OBSERVED_EVENT message
  → handleObservedEvent(payload)                    [SW:547]
    → processObservedEvent(payload)                 [sw-integration.ts]
      → Component Runtime lifecycle processing      [component-runtime.ts]
        → 13 component definitions (priority-ordered)
        → Discovery → Active → Complete lifecycle
        → Produces ComponentInteraction[]
    → For each emitted interaction:
      → chrome.runtime.sendMessage({
          type: 'INTERACTION_CAPTURED',             [SW:555]
          interaction
        })
        → Side panel live display                    [sidepanel.ts:1079]
```

The **Component Runtime** (`src/runtime/component-runtime.ts`) is the sole active recorder pipeline. It processes `ObservedEvent` objects one-at-a-time through 13 component definitions, each handling discovery → active → complete lifecycle. Interactions are emitted immediately and broadcast to the side panel in real-time.

### On STOP_RECORDING (Batch Processing)

```
handleStopRecording()                                [SW:251]
  → stopRecording()                                   [sw-integration.ts]
    → Returns ComponentInteraction[] (all live interactions)
```

---

## 5. Which Classifier Path Executes

**Source:** `src/background/service-worker.ts:310-366`

### Feature Flag

```
recorderEngine setting:
  Defined: src/shared/types.ts:100  (UIState.recorderEngine)
  Default: src/shared/types.ts:107  (DEFAULT_UI_STATE.recorderEngine = 'legacy')
  Read:   src/background/service-worker.ts:313-314
```

**Default value: `'legacy'`** → `useControlEngine = false` (line 314).

### Three-Way Fork

The SW has a three-branch classification dispatch:

```
                    ┌─ useControlEngine === true ──→ Branch 1: Control Engine
                    │     recognizeInteractions(events)              [SW:321]
                    │     Fallback: detectInteractions(events)        [SW:329]
                    │
handleStopRecording ┼─ useControlEngine === false ─→ Branch 2: Legacy V1+V2+Merge
                    │     detectInteractions(events) — V1            [SW:336]
                    │     detectInteractionsV2(events) — V2           [SW:342]
                    │     mergeV1V2(v2, v1, eventCount) — Merge        [SW:353-354]
                    │     Fallback: V1-only                           [SW:360-365]
                    │
                    └─ (Branch 3: deterministic-recorder.ts — NOT IN MANIFEST, never runs)
```

### Which Path Actually Executes (Default Settings)

**Branch 2 (Legacy V1+V2+Merge) executes.** The full sequence:

1. **V1 Classifier:** `detectInteractions(events)` → `DetectedInteraction[]` (V1 results stored at `DETECTED_INTERACTIONS`)
2. **V2 Evidence Engine:** `detectInteractionsV2(events)` → `DetectedInteraction[]` (V2 results stored at `DETECTED_INTERACTIONS_V2`)
3. **A/B Comparison:** `compareClassifierOutputs(v1, v2)` + `logComparisonResult()` — dev-only console logging
4. **Merge Layer:** `mergeV1V2(v2Interactions, v1Interactions, events.length)` → merged `DetectedInteraction[]`
   - V2 is primary; V1 provides fallback for events V2 couldn't confidently classify
   - Merged results stored at `DETECTED_INTERACTIONS_MERGED`
5. **Error Fallback:** If V2 or merge throws, V1 results are used as `DETECTED_INTERACTIONS_MERGED`

---

## 6. Which Semantic Reasoning Path Executes

**Source:** `src/background/service-worker.ts:368-393`

```
reasonAboutInteractions(mergedInteractions, events)   [SW:375]
  → src/classifier/semantic/reasoner.ts
    → Manages 5 session types:
      ├── Dropdown sessions
      ├── DatePicker sessions
      ├── Autocomplete sessions
      ├── MultiConfig sessions (surface-anchored activation + absorption)
      └── FormSubmit sessions
    → Surface-anchored detection (Changes 1-5 applied)
    → Stepper detection (icon-only +/- buttons)
  → Returns: { interactions, sessionsActivated, sessionsCompleted, ... }
  → Result overwrites mergedInteractions                [SW:388]
  → Updated DETECTED_INTERACTIONS_MERGED stored          [SW:389]
```

The Semantic Reasoner runs **after** the merge layer and **before** the recognition pipeline. It collapses composite UI components (dropdowns, date pickers, autocomplete) into single semantic interactions. Surface-anchored detection is applied here — all 5 changes from the surface-anchored detection work are active.

---

## 7. Which Pipeline Produces the Side Panel Interactions

### During Recording (Live)

```
Component Runtime
  → ComponentInteraction emitted
    → SW: INTERACTION_CAPTURED message               [SW:555]
      → Side panel: onMessage listener               [sidepanel.ts:1079]
        → Reads LIVE_INTERACTIONS_KEY from storage   [sidepanel.ts:1083]
        → Renders production interactions             [sidepanel.ts:1087]
```

### After STOP_RECORDING (Full Pipeline)

```
handleStopRecording()                                [SW:251]
  │
  ├── 1. Classifier: V1 + V2 + Merge → DetectedInteraction[]
  │
  ├── 2. Semantic Reasoner: reasonAboutInteractions() → Refined DetectedInteraction[]
  │
  ├── 3. Recognition + Enrichment Pipeline:
  │     runPipeline(events, mergedInteractions, sessionId, sourceUrl, 'legacy')  [SW:407]
  │       → Domain Adapter: adaptToDomainEntities → { elements, transitions }
  │       → Recognition Orchestrator → ComponentGrouping[]
  │       → Enrichment Orchestrator → ApplicationKnowledgeFragment
  │       → Capability Deriver → CapabilityCandidate
  │       → UnderstandingResult
  │     → Stored: DOMAIN_ENTITIES, RECOGNITION_COMPONENTS,
  │                KNOWLEDGE_FRAGMENT, CAPABILITY_CANDIDATE,
  │                UNDERSTANDING_RESULT
  │
  ├── 4. IR Bridge:
  │     buildIRPlan({ events, interactions, understanding, ... })  [SW:446]
  │       → ExecutionIRPlan (IRStep[])
  │     → Stored: EXECUTION_IR_PLAN
  │
  ├── 5. Code Generation:
  │     PlaywrightCodeGenerator().generate(irPlan, { language, pattern, assertions })  [SW:461]
  │       → Generated test files (TypeScript/Playwright)
  │     → Stored: GENERATED_FILES
  │
  ├── 6. Repository Persistence:
  │     persistSession(uowFactory, { understanding, events, interactions, irPlan, ... })  [SW:480]
  │       → Dexie/IndexedDB write
  │     → Stored: REPOSITORY_SESSION_ID, REPOSITORY_CAPABILITY_ID
  │
  ├── 7. Cross-Session Element Healing:
  │     healFromRecording(projectId, elements, sessionId, uowFactory)  [SW:510]
  │       → Element locator healing
  │     → Stored: ELEMENT_HEAL_RESULT
  │
  └── 8. UI State Update:
        → recordingState = Stopped                    [SW:535]
        → broadcastToTabs({ type: 'STOP_RECORDING' }) [SW:542]
```

**The side panel reads results from `chrome.storage.local`** — it does not receive a dedicated "results ready" message. After STOP, the side panel detects the UI state change (`recordingState = Stopped`) and reads from the storage keys that the SW populated.

---

## 8. Deprecated, Duplicate, or Parallel Pipelines Still Active at Runtime

### 🔴 Finding R-1: `control-recorder.ts` is loaded but dormant

**Severity:** Medium (overhead + latent risk)

`control-recorder.ts` (CS2) is injected on every page via `manifest.json:37`. Under the default `'legacy'` flag:
- Its 12 DOM event listeners are **registered** on every page
- But `shouldCapture()` returns `false` for every event → **all handlers are no-ops**
- It does NOT send any `RECORDED_EVENT` messages
- It initializes `ControlModel` only if `isActive && isRecording && !model` (line 102) — never reached with default flag

**Runtime impact:** Minimal — 12 extra event listener registrations per page (no callbacks fire). The `syncEngineFlag()` function reads `chrome.storage.local` on install and on storage changes. No measurable performance impact, but:
- 12 unused listeners on every page
- `chrome.storage.onChanged` listener active (for flag sync)
- Console noise if someone toggles the flag

**Status:** Matches documentation — classified as ACTIVE-DEPRECATED in `IMPLEMENTATION_BASELINE.md` §1.4.

### 🔴 Finding R-2: `RECORDED_EVENT` message type is unhandled

**Severity:** Critical (if flag is toggled to 'control')

The SW's message switch (`service-worker.ts:852-901`) has **no case for `RECORDED_EVENT`**. It falls through to `default: break` (line 899-901) — silently discarded.

This means:
- Even if `recorderEngine` were set to `'control'`, the events captured by `control-recorder.ts` would be sent as `RECORDED_EVENT` messages
- The SW would silently drop every one
- The Control Engine path (`recognizeInteractions(events)` at line 321) would receive an empty `events[]` array (because `observedEvents` are extracted from `ComponentInteraction[]`, which are populated by `OBSERVED_EVENT` processing — not `RECORDED_EVENT`)
- **The Control Engine branch can never function** — it's dead code that appears alive due to the feature flag

**Status:** Matches documentation — the Architecture Validation Report identified this as F-1/F-3. Confirmed at runtime: the Control Engine path is structurally broken even when the flag is toggled.

### ⚠️ Finding R-3: `toIRActions` dead import

**Severity:** Low (no runtime impact, import graph pollution)

`toIRActions` is imported at `service-worker.ts:57` from `src/presentation/output-adapter.ts:254` but never called (0 call sites in the entire codebase). Vite tree-shakes it, so no runtime cost. But it creates a misleading import relationship.

**Status:** Matches documentation — identified as F-2 in the Architecture Validation Report.

### ⚠️ Finding R-4: `deterministic-recorder.ts` is orphaned

**Severity:** None (not loaded)

`src/recorder/deterministic-recorder.ts` is designed as the 'legacy' content script that sends `RECORDED_EVENT` messages. It is **NOT in the manifest** — never injected by Chrome. The `'legacy'` flag name is misleading: 'legacy' actually means the EventTap + Component Runtime + V1/V2 classifier path, NOT the deterministic recorder path.

**Status:** Matches documentation — classified as DEAD in `IMPLEMENTATION_BASELINE.md` §1.4.

### ✅ No other parallel pipelines found

Verified by grepping for:
- All `RECORDED_EVENT` senders: only `control-recorder.ts` and `deterministic-recorder.ts` (dead)
- All `OBSERVED_EVENT` senders: only `recorder-entry.ts`
- All message types handled by the SW: only the 7 listed in §3
- All imports in the SW: no hidden classifier imports beyond the three documented forks

No undocumented parallel pipelines exist at runtime.

---

## 9. Implementation vs Documented Architecture Match

| Documented (IMPLEMENTATION_BASELINE.md) | Actual Runtime | Match? |
|---|---|---|
| Active pipeline: recorder-entry.ts → EventTap → OBSERVED_EVENT → SW → Component Runtime | ✅ Exactly this | ✅ |
| On STOP: V1 + V2 + Merge → Semantic Reasoner → runPipeline → buildIRPlan → PlaywrightCodeGenerator | ✅ Exactly this | ✅ |
| Repository V2 persistence after IR generation | ✅ Exactly this | ✅ |
| Cross-session healing after persistence | ✅ Exactly this | ✅ |
| `control-recorder.ts` ACTIVE-DEPRECATED (in manifest, dormant) | ✅ Confirmed dormant | ✅ |
| `RECORDED_EVENT` not handled by SW | ✅ Confirmed silently dropped | ✅ |
| `toIRActions` dead import | ✅ Confirmed never called | ✅ |
| `deterministic-recorder.ts` DEAD (not in manifest) | ✅ Confirmed not in manifest | ✅ |
| `recorderEngine` default = 'legacy' | ✅ Confirmed (types.ts:107) | ✅ |
| Three-way classification fork (Control / V1+V2+Merge) | ✅ Confirmed (SW:318-366) | ✅ |
| Default path = Branch 2 (V1+V2+Merge) | ✅ Confirmed | ✅ |
| `interaction-recognizer.ts` active only when flag='control' | ✅ Confirmed | ✅ |
| `src/pipeline/` directory is DEAD (zero external imports) | ✅ Confirmed | ✅ |
| `src/types/` directory is DEAD (only imported by `src/pipeline/`) | ✅ Confirmed | ✅ |

**All documented claims match the actual runtime behaviour.** No new discrepancies discovered.

---

## 10. Actual Runtime Execution Sequence Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          PAGE LOAD (every page)                                  │
│                                                                                 │
│  ┌─────────────────────────┐    ┌──────────────────────────────────┐            │
│  │  CS1: recorder-entry.ts │    │  CS2: control-recorder.ts       │            │
│  │  ────────────────────── │    │  ────────────────────────────── │            │
│  │  • Reads recording flag │    │  • Reads recorderEngine flag    │            │
│  │    from sessionStorage  │    │    (default: 'legacy')          │            │
│  │  • Dormant until        │    │  • isActive = false            │            │
│  │    START_RECORDING      │    │  • Registers 12 DOM listeners   │            │
│  │    received             │    │    (all guarded by shouldCapture│            │
│  │                         │    │     → always false)             │            │
│  │  DOM EVENTS:             │    │                                │            │
│  │  (none directly — all   │    │  DOM EVENTS:                    │            │
│  │   handled by EventTap)   │    │  click, dblclick, contextmenu,  │            │
│  │                         │    │  focus, blur, input, change,   │            │
│  │  LIFECYCLE:              │    │  scroll, mouseenter, mouseleave│            │
│  │  pagehide → flush buffer │    │  dragstart, drop                │            │
│  │  pageshow → resume       │    │  ─ ALL NO-OPS (shouldCapture   │            │
│  │                         │    │    returns false) ──            │            │
│  └──────────┬──────────────┘    └────────────────────────────────┘            │
│             │                                                                    │
│             ▼                                                                    │
│  ┌─────────────────────────────────────────────────┐                            │
│  │  EventTap (src/tap/event-tap.ts)                 │                            │
│  │  ─────────────────────────────────────────────── │                            │
│  │  • Capture-phase listeners for:                  │                            │
│  │    click, mousedown, contextmenu, focus, blur,   │                            │
│  │    input, change, mouseenter, mouseleave,         │                            │
│  │    mousemove, keydown, scroll                     │                            │
│  │  • SPA navigation (History API monkey-patch)      │                            │
│  │  • resolveTarget() — 4-strategy cascade           │                            │
│  │    (composedPath → parent walk → event.target)    │                            │
│  │                                                   │                            │
│  │  ┌─────────────────────────────────────────┐     │                            │
│  │  │ IdentityExtractor                       │     │                            │
│  │  │ → 18-field ElementIdentity snapshot     │     │                            │
│  │  └─────────────────────────────────────────┘     │                            │
│  │  ┌─────────────────────────────────────────┐     │                            │
│  │  │ DomContextExtractor                     │     │                            │
│  │  │ → Surface detection (modal/drawer/etc.) │     │                            │
│  │  │ → Ancestor roles, ARIA, input type     │     │                            │
│  │  └─────────────────────────────────────────┘     │                            │
│  │                                                   │                            │
│  │  → Produces: ObservedEvent                       │                            │
│  └──────────┬────────────────────────────────────────┘                            │
│             │                                                                     │
│             │  sendMessage({ type: 'OBSERVED_EVENT', payload })                  │
│             │  + sessionStorage buffer (MV3 resilience)                            │
│             │  + retry with exponential backoff                                   │
│             │                                                                     │
└─────────────┼─────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SERVICE WORKER (SW)                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Message Router (SW:847-905)                                            │    │
│  │  ───────────────────────────────                                        │    │
│  │  START_RECORDING → handleStartRecording()                               │    │
│  │  STOP_RECORDING  → handleStopRecording()                                │    │
│  │  OBSERVED_EVENT  → handleObservedEvent(payload)                         │    │
│  │  PING            → { type: 'PONG', recording }                          │    │
│  │  RUN_TEST        → handleRunTest()                                      │    │
│  │  RECORDED_EVENT  → ❌ NOT HANDLED (silently dropped)                    │    │
│  └──────────┬──────────────────────────────────────────────────────────────┘    │
│             │                                                                     │
│  ═══ DURING RECORDING (live streaming) ═══                                       │
│             │                                                                     │
│             ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  handleObservedEvent() (SW:547)                                         │    │
│  │  ─────────────────────────────                                          │    │
│  │  → processObservedEvent(payload)                                        │    │
│  │    → Component Runtime (src/runtime/component-runtime.ts)               │    │
│  │      • 13 component definitions (priority-ordered)                      │    │
│  │      • Lifecycle: discovery → active → complete                         │    │
│  │      • Produces: ComponentInteraction[]                                 │    │
│  │    → Enrichment: component type + business meaning                      │    │
│  │                                                                         │    │
│  │  → For each emitted interaction:                                        │    │
│  │    sendMessage({ type: 'INTERACTION_CAPTURED', interaction })           │    │
│  │      → Side panel live display (sidepanel.ts:1079)                      │    │
│  └───────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ═══ ON STOP_RECORDING (batch processing) ═══                                   │
│             │                                                                     │
│             ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  handleStopRecording() (SW:251-543)                                     │    │
│  │  ─────────────────────────────                                          │    │
│  │                                                                         │    │
│  │  STEP 1: Extract events                                                 │    │
│  │  → stopRecording() → ComponentInteraction[]                             │    │
│  │  → filterProductionInteractions(allInteractions)                       │    │
│  │  → Extract ObservedEvent[] from triggerEvent + memberEvents             │    │
│  │  → Convert ObservedEvent[] → RecordedEvent[] (adapter shim)             │    │
│  │                                                                         │    │
│  │  STEP 2: Classifier (feature flag: recorderEngine = 'legacy')          │    │
│  │  → detectInteractions(events) ──── V1 classifier ──────┐                │    │
│  │  → detectInteractionsV2(events) ── V2 evidence engine ─┤                │    │
│  │  → mergeV1V2(v2, v1, count) ─────── Merge layer ───────┤                │    │
│  │  → mergedInteractions: DetectedInteraction[] ◄─────────┘                │    │
│  │                                                                         │    │
│  │  STEP 3: Semantic Reasoner                                              │    │
│  │  → reasonAboutInteractions(merged, events)                              │    │
│  │    → 5 session types (dropdown, datePicker, autocomplete,                │    │
│  │      multiConfig, formSubmit)                                           │    │
│  │    → Surface-anchored detection (Changes 1-5)                          │    │
│  │    → Stepper detection                                                  │    │
│  │  → Refined DetectedInteraction[] (semantic interactions)               │    │
│  │                                                                         │    │
│  │  STEP 4: Recognition + Enrichment Pipeline                              │    │
│  │  → runPipeline(events, merged, sessionId, url, 'legacy')                │    │
│  │    → Domain Adapter → { elements, transitions }                        │    │
│  │    → Recognition Orchestrator → ComponentGrouping[]                     │    │
│  │    → Enrichment Orchestrator → ApplicationKnowledgeFragment              │    │
│  │    → Capability Deriver → CapabilityCandidate                           │    │
│  │  → UnderstandingResult                                                  │    │
│  │                                                                         │    │
│  │  STEP 5: IR Bridge                                                       │    │
│  │  → buildIRPlan({ events, interactions, understanding, context })        │    │
│  │  → ExecutionIRPlan (IRStep[])                                           │    │
│  │                                                                         │    │
│  │  STEP 6: Code Generation                                                 │    │
│  │  → PlaywrightCodeGenerator().generate(irPlan, options)                  │    │
│  │  → Generated TypeScript Playwright test files                            │    │
│  │                                                                         │    │
│  │  STEP 7: Repository Persistence                                          │    │
│  │  → persistSession(uowFactory, { understanding, events, interactions,    │    │
│  │      irPlan, projectId, testCaseName })                                  │    │
│  │  → Dexie/IndexedDB write                                                 │    │
│  │                                                                         │    │
│  │  STEP 8: Cross-Session Healing                                           │    │
│  │  → healFromRecording(projectId, elements, sessionId, uowFactory)        │    │
│  │  → Element locator healing                                              │    │
│  │                                                                         │    │
│  │  STEP 9: Finalize                                                        │    │
│  │  → UI state = Stopped (preserve recorderEngine flag)                    │    │
│  │  → broadcastToTabs({ type: 'STOP_RECORDING' })                          │    │
│  │                                                                         │    │
│  │  Storage writes during STOP:                                            │    │
│  │  → LIVE_INTERACTIONS_KEY, DETECTED_INTERACTIONS,                         │    │
│  │    DETECTED_INTERACTIONS_V2, DETECTED_INTERACTIONS_MERGED,               │    │
│  │    DOMAIN_ENTITIES, RECOGNITION_COMPONENTS, KNOWLEDGE_FRAGMENT,         │    │
│  │    CAPABILITY_CANDIDATE, UNDERSTANDING_RESULT, EXECUTION_IR_PLAN,        │    │
│  │    GENERATED_FILES, REPOSITORY_SESSION_ID, REPOSITORY_CAPABILITY_ID,   │    │
│  │    ELEMENT_HEAL_RESULT                                                  │    │
│  └───────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SIDE PANEL (UI)                                          │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Message Listeners (sidepanel.ts)                                       │    │
│  │  ─────────────────────────────                                          │    │
│  │  INTERACTION_CAPTURED → live interaction display during recording        │    │
│  │  CONTENT_SCRIPT_STATUS → connection status indicator                    │    │
│  │  EXECUTION_RESULT → test execution result display                       │    │
│  │                                                                         │    │
│  │  Storage reads:                                                         │    │
│  │  → LIVE_INTERACTIONS_KEY → live interaction list                       │    │
│  │  → DETECTED_INTERACTIONS_MERGED → classified interactions               │    │
│  │  → DOMAIN_ENTITIES → domain elements + transitions                     │    │
│  │  → GENERATED_FILES → generated Playwright code                         │    │
│  │  → EXECUTION_IR_PLAN → IR plan for display/editing                     │    │
│  │  → ELEMENT_HEAL_RESULT → healing summary                               │    │
│  └───────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Mismatch Analysis

### Mismatches Between Runtime and Documented Architecture

**None found.** Every claim in `IMPLEMENTATION_BASELINE.md` and `IMPLEMENTATION_BASELINE_SPECIFICATION.md` matches the actual runtime behaviour. The three findings from the Architecture Validation Report are all confirmed:

1. **`control-recorder.ts` in manifest** — Confirmed: declared at `manifest.json:37`, loaded on every page, dormant under default `'legacy'` flag.
2. **`RECORDED_EVENT` unhandled** — Confirmed: SW `onMessage` switch (lines 852-901) has no case for `RECORDED_EVENT`. Falls to `default: break`.
3. **`toIRActions` dead import** — Confirmed: imported at SW line 57, 0 call sites, tree-shaken by Vite.

### Additional Runtime Observations (Not Mismatches)

**O-1: The `'legacy'` flag name is misleading.** The 'legacy' path is actually the current production pipeline (EventTap + Component Runtime + V1/V2 classifiers + merge). The 'control' path refers to the Control Model recognizer, which is a newer (but broken) alternative. The naming suggests 'legacy' is the old path to be deprecated, but in reality, 'legacy' IS the active, correct path. Phase 0 should rename or eliminate this flag entirely.

**O-2: The Control Engine branch is structurally broken, not just flag-gated.** Even if `recorderEngine='control'` were set:
- `control-recorder.ts` would activate and send `RECORDED_EVENT` messages
- The SW would silently drop them (no handler)
- `handleStopRecording()` would still extract events from `ComponentInteraction[]` (populated by `OBSERVED_EVENT` processing from `recorder-entry.ts`)
- `recognizeInteractions(events)` would run — but on the same events as the legacy path, not on events from `control-recorder.ts`
- The Control Engine is therefore not a true alternative pipeline — it's a classification alternative that operates on the same event source

**O-3: The adapter shim (ObservedEvent[] → RecordedEvent[]) is the bridge.** The SW extracts `ObservedEvent[]` from `ComponentInteraction[]`, converts to `RecordedEvent[]` via a field-mapping shim (SW:287-308), and feeds the V1/V2 classifiers. This is the temporary `as any` bridge documented for Phase 0 elimination. Confirmed: 3 `as any` casts at lines 299, 306, 307 (navigation, eventType, domContext).

---

## Conclusion

The runtime behaviour **fully matches** the documented implementation baseline. The active pipeline is:

```
recorder-entry.ts → EventTap → OBSERVED_EVENT → Component Runtime →
STOP → V1 + V2 + Merge → Semantic Reasoner → runPipeline → buildIRPlan →
PlaywrightCodeGenerator → persistSession → healFromRecording
```

No undocumented parallel pipelines are active. The control-recorder.ts parallel pipeline is loaded but completely dormant. The `RECORDED_EVENT` message type is silently dropped by the SW. The `toIRActions` dead import is tree-shaken.

**The verified runtime baseline is established.** All future changes — Adani One fixes, Phase 0 type unification, Phase 1 dead code removal, and subsequent roadmap phases — should be implemented against this verified runtime pipeline.

---

*This validation was performed by tracing every import, checking every manifest entry, following every message type, and verifying every function call in the actual runtime execution path.*
