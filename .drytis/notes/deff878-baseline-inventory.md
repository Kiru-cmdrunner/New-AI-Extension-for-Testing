# deff878 Baseline Inventory — Pre-DF-1 Authoritative Reference

**Commit:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8`
**Date:** 2026-08-08 03:03:55 UTC
**Branch:** detached HEAD (on capability-v1-complete lineage)
**Verified:** 2026-08-09

---

## 14. Exact Baseline Versions

| Metric | Value |
|--------|-------|
| Commit SHA | `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8` |
| Manifest version | 10.9.0 |
| package.json version | 10.4.18 |
| Source .ts files | 162 |
| Source LOC | 37,769 |
| Test files | 114 |
| Tests | 2,578 (all passing) |
| Build output | 39 files, 659.5 KB ZIP |
| TypeScript | 0 errors |

---

## 1. Overall Architecture

### Pipeline (6 layers + output)

```
Layer 0: EventTap (content script)
    ↓ ObservedEvent[]
Layer 1: ComponentRuntime (service worker)
    ↓ ComponentInteraction[]
Layer 2: Enrichment (componentType, businessMeaning)
    ↓ enriched ComponentInteraction[]
Layer 3: Behavioral Observations (ObservationCoordinator → ObservationResult[])
    ↓ attached to interactions
Layer 4: Capability Engine (post-recording)
    ↓ CapabilityRecord[]
Layer 5: IR Bridge → Playwright Code Generator
    ↓ ExecutionIRPlan + .spec.ts files
```

**Data flow:** Content script captures DOM events → sends `ObservedEvent` to SW via `chrome.runtime.sendMessage` → SW's `handleObservedEvent` calls `processObservedEvent` → runtime classifies via definitions → emits `ComponentInteraction` → enriched + behavioral observations attached → at `stopRecording`, projection engine merges classified + unclassified → capability inference → IR compilation → Playwright generation → repository persistence.

---

## 2. Event Capture

### Registered event types (13 in EventTap)

| Event | Registered? | Durable buffered? | Forwarded to SW? | Observation window? |
|-------|:-----------:|:-----------------:|:----------------:|:-------------------:|
| click | ✅ | ✅ | ✅ (retry) | ✅ |
| mousedown | ✅ | ✅ | ✅ (retry) | ❌ |
| contextmenu | ✅ | ✅ | ✅ (retry) | ❌ |
| focus | ✅ | ✅ | ✅ (retry) | ❌ |
| blur | ✅ | ✅ | ✅ (retry) | ❌ |
| input | ✅ | ✅ | ✅ (retry) | ❌ |
| change | ✅ | ✅ | ✅ (retry) | ✅ |
| mouseenter | ✅ | ✅ | ✅ (retry) | ❌ |
| mouseleave | ✅ | ✅ | ✅ (retry) | ❌ |
| keydown | ✅ | ✅ | ✅ (retry) | ❌ |
| scroll | ✅ | ❌ | fire-and-forget | ❌ |
| mousemove | ✅ | ❌ | fire-and-forget | ❌ |
| navigation | synthetic | ✅ | ✅ (retry) | ❌ |

**Not registered:** pointerdown, pointerup, pointermove, dragstart, dragend, drop, touchstart, touchend, touchmove.

### Transient events
`TRANSIENT_EVENT_TYPES = ['mousemove', 'scroll']` — sent fire-and-forget (no buffer, no retry).

### Target resolution
`resolveTarget(rawEvent)` uses `rawEvent.composedPath()` to pierce Shadow DOM, then walks the path to find the most specific interactive element. Falls back to `rawEvent.target`.

### ElementIdentity fields (per `RawElementIdentity` + extension)
accessibleName, ariaRole, ariaLabel, ariaLabelledBy, placeholder, tag, className, name, stableId, testId, dataCy, dataQa, cssSelector, xPath, inIframe, shadowDom, href, iframeContext?, elementId.

### ObservedEvent structure
eventId, eventType, timestamp, captureSeq (rawEvent.timeStamp), isTrusted, target (ElementIdentity), domContext (DomContext), valueBefore, valueAfter, checkedBefore, checkedAfter, clientX, clientY, key, code, shiftKey, ctrlKey, altKey, metaKey, scrollDeltaY, scrollDeltaX, pageUrl, pageTitle.

### DomContext fields
inputType, ariaExpanded, ariaHasPopup, isContentEditable, disabled, readOnly, required, ancestorRoles[], ancestorClasses[], tabIndex, ariaValueNow?, ariaValueText?, ariaValueMin?, ariaValueMax?, nativeMin?, nativeMax?.

---

## 3. Content Script → Service Worker

### Communication mechanism
Per-event `chrome.runtime.sendMessage({type:'OBSERVED_EVENT', payload})`.

### Durable events (non-transient)
1. `pushToBuffer(event)` → sessionStorage
2. `sendObservedEvent(event)` → immediate `chrome.runtime.sendMessage`
3. On `{ok:true}` → `removeFromBuffer(event.eventId)`
4. On failure → retry: 5 attempts, exponential backoff (100ms, 200ms, 400ms, 800ms, 1600ms)

### Transient events (mousemove, scroll)
Fire-and-forget: single `sendMessage`, no buffer, no retry, errors swallowed.

### Retry behavior
5 retries max with exponential backoff. If all fail, event stays in sessionStorage buffer for the next SW lifecycle.

### Buffering
- `cmdrunner_event_buffer` in sessionStorage, capped at MAX_BUFFER_SIZE=500
- `cmdrunner_behavioral_buffer` in sessionStorage, capped at MAX_BEHAVIORAL_BUFFER=200

### pagehide handling
`flushPendingEvents()` + `flushPendingBehavioralEvents()` — sends all buffered events to SW immediately. Events NOT removed from buffer (stay for recovery).

### pageshow handling
If `sessionStorage.getItem(RECORDING_KEY) === 'true'`, resumes recording. Guards on `document.body` existence.

### SW restart recovery
- Module-level `ensureSessionRestored()` at line 63 — calls `restoreFromStorage()` on first message
- `restoreFromStorage()` reads 4 keys: RECORDING_ACTIVE, LIVE_INTERACTIONS, RUNTIME_SNAPSHOT, EVIDENCE_LEDGER
- If `RECORDING_ACTIVE === true`, rebuilds runtime from snapshot + ledger
- Then calls `recoverDurableObservations()` which does `chrome.storage.local.get(null)` to find `cmdrunner_obs_*` keys

### ok:true semantics
`handleObservedEvent()` called WITHOUT await. `sendResponse({ok:true})` fires synchronously. `ok:true` means "message received," NOT "event processed." (Known race — not fixed at this commit.)

---

## 4. Component Runtime — 14 Definitions

| Priority | Definition | Trigger Events | Produces | Lifecycle |
|:--------:|-----------|----------------|----------|-----------|
| 10 | **DatePicker** | mousedown, click | DatePicker | Opens on date input click, absorbs calendar gridcell clicks, completes on date selection |
| 15 | **ColorInput** | focus | ColorInput | Triggers on `<input type="color">` focus, completes on blur |
| 20 | **Dropdown** | click, mousedown | Dropdown | Triggers on `<select>` or `[role=combobox/listbox]`, absorbs `<option>` clicks, completes on selection |
| 25 | **Slider** | focus | Slider | Triggers on `<input type="range">` focus, absorbs change/input, completes on blur |
| 30 | **Checkbox** | click | Checkbox | Triggers on checkbox click, completes immediately |
| 35 | **FileUpload** | click, change | FileUpload | Triggers on `<input type="file">` click, completes on change event |
| 40 | **RadioButton** | click, change | RadioButton | Triggers on radio click, completes immediately |
| 50 | **TextEntry** | focus | TextEntry | Triggers on text input focus, absorbs input/keydown, completes on blur |
| 60 | **Hover** | mouseenter | Hover | Triggers on mouseenter, completes on mouseleave or timeout |
| 65 | **Tab** | click | Tab | Triggers on `[role=tab]` click, completes immediately |
| 70 | **Link** | click | Link | Triggers on `<a>` click, completes immediately |
| 110 | **Scroll** | scroll | Scroll | Triggers on scroll, completes immediately |
| 120 | **Navigation** | navigation | Navigation | Triggers on synthetic SPA navigation event, completes immediately |
| 180 | **Click** | click, mousedown, contextmenu, keydown | Click | Fallback — triggers on any remaining interactive click |

### Discovery mechanism
Definitions sorted by priority (ascending). For each incoming event, the runtime iterates definitions in priority order. The FIRST definition whose `detectTrigger()` returns non-null wins. If no definition matches, the event is not classified (becomes Unclassified via Projection Engine).

### Dedup
`DEDUP_WINDOW_MS = 2000` — two interactions of the same type on the same element within 2s are suppressed.

---

## 5. Observation System

### Events that open observation windows
**Only `click` and `change`** (recorder-entry.ts:362-364):
```typescript
if (eventType === 'click' || eventType === 'change') {
  observationCoordinator?.openWindow(eventId, eventType, targetEl);
}
```

### Window duration
Fixed **3000ms** (3 seconds). No early closure, no stability check.

### MutationObserver behavior
- Singleton observer on `document.body`
- Observes: childList, attributes, characterData, subtree=true
- **Does NOT observe Shadow DOM roots**
- Refcounted: starts when first window opens, stops when last window closes
- Mutations attributed to active windows via windowId

### Element state capture
ElementStateCache (WeakMap-backed), populated by capture-phase mousedown + focus listeners.
9 fields: value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount.

### ObservationCoordinator
- `openWindow(eventId, eventType, targetEl)` — reads before-state from cache, opens observer window, starts 3s timer
- On close: captures final-state, collects mutations, builds ObservationResult, calls `onResult` callback
- Independent windows: each has its own timer, windows don't close together

### ObservationResult structure
sourceEventId, sourceEventType, windowId, openedAt, closedAt, durationMs, endReason, beforeSnapshot, finalSnapshot, mutations[], mutationCount, documentWideMutationTotal, performanceCondition?, semanticEffects?.

---

## 6. Evidence Ledger

### LedgerEntry fields
eventId, captureSeq, pageId, eventType, timestamp, disposition, claimedBy?, claimType?, targetTag, targetName, targetRole.

Note: NO `targetIdentity` field (only diagnostic tag/name/role).

### Disposition lifecycle
```
pending → absorbed → (claimed | unclaimed)
```
- `pending`: event appended, not yet processed
- `absorbed`: runtime lifecycle consumed this event
- `claimed`: terminal — completed interaction backs this event
- `unclaimed`: terminal — no interaction backs this event

Terminal states are immutable.

### DISCRETE_ACTION_TYPES
Only `click`, `contextmenu`, `mousedown`, `keydown` enter the ledger. Accumulating events (scroll, input, mousemove) do NOT.

### Persistence behavior
- `persistEvidenceLedger()` called on EVERY event (no debounce)
- Writes entire ledger snapshot to `chrome.storage.local`
- No eviction cap (unbounded Map)

### Limits/caps
**None.** The ledger grows without bound.

---

## 7. Projection Engine

### How captured events become interactions
1. `stopRecording()` calls `runtime.flush()` — completes any active lifecycles
2. `normalizeWorkflow()` removes subsumed Unclassified interactions
3. `filterProductionInteractions()` removes incidental Hovers, Scrolls, abandoned/discarded interactions
4. `projectInteractions()` merges classified interactions with Unclassified fallback

### Unclassified interactions
Created from ledger entries with disposition `unclaimed` or `pending`. Uses `createUnclassifiedFromLedger()` which builds a ComponentInteraction with:
- Identity from diagnostic fields (targetTag, targetName, targetRole) — NOT full ElementIdentity
- Placeholder values for cssSelector (''), xPath (''), elementId ('')

### What happens to unmatched events
Every discrete event in the ledger gets represented — either as part of a classified interaction or as an Unclassified fallback.

---

## 8. Capability Engine

### 12 Capability Rules

| Rule | Capability | Evidence consumed |
|------|-----------|-------------------|
| ToggleControlRule | ToggleControl | state-toggle effects (checked/aria-checked/aria-pressed changes) |
| ExpandCollapseRule | ExpandCollapse | expand-collapse effects (aria-expanded changes) |
| UploadFileRule | UploadFile | FileUpload interaction type + file input |
| NavigateRule | Navigate | Navigation interaction type + URL change |
| OpenDetailRule | OpenDetail | content-change + element appearance |
| PaginateRule | Paginate | content-change + pagination pattern |
| FilterSelectionRule | FilterSelection | content-change + filter keyword |
| SortSelectionRule | SortSelection | content-change + sort keyword |
| SearchRule | Search | TextEntry + search keyword + content-change |
| SubmitFormRule | SubmitForm | Click on submit button / form submission |
| SelectOptionRule | SelectOption | Dropdown selection + value change |
| AdjustValueRule | AdjustValue | Slider/range value adjustment |

### How capabilities are detected
Runs at `stopRecording()` AFTER behavioral observations are finalized and effects are interpreted:
1. `buildEffectsMap()` collects SemanticEffects from all interactions' behavioralObservations
2. For each production interaction, `extractEvidence()` gathers physical + behavioral + sequence + keyword evidence
3. Each rule's `evaluate()` runs, producing 0 or more CapabilityClaims
4. `resolveClaims()` selects the highest-confidence claim, resolves conflicts

### Output
`CapabilityRecord[]` — one per production interaction, with capability type, confidence, parameters, evidence trail, alternatives.

---

## 9. IR / Generation Layer

### How interactions become IR
At `stopRecording()`, after capability inference:
1. `buildIRPlan()` takes production interactions + recording context
2. Maps each InteractionType to an IRAction (Click→CLICK, TextEntry→FILL, Dropdown→SELECT, etc.)
3. Resolves locators from ElementIdentity (CSS selector, XPath, testId, dataCy)
4. Builds IRStep[] → ExecutionIRPlan

### Filtering
- `filterProductionInteractions()` removes: Hover (incidental), Scroll (incidental), abandoned/discarded, no-op
- Unclassified interactions ARE included in IR output

### Generation
`PlaywrightCodeGenerator` takes ExecutionIRPlan → produces `.spec.ts` files with Page Object pattern.

### Known gaps (at this commit)
- RadioButton → SELECT (may not match Playwright's check pattern)
- FileUpload → FILL (may not match Playwright's setInputFiles)
- No iframe context in IR locators
- No Shadow DOM piercing locators
- `deriveAssertions()` always returns `[]` (no auto-assertions)

---

## 10. Side Panel

### What the UI displays
- **Recording view:** Live timeline (Observed Workflow) + interaction count + recording context
- **Stopped view:** Detected interactions with three-layer enrichment (type, componentType, businessMeaning), behavioral evidence, capability records, IR plan steps, generated files, repository status, healing summary

### How it receives live updates
Two mechanisms:
1. **`chrome.runtime.onMessage` listener** for `INTERACTION_CAPTURED` (per-interaction broadcast from SW) and `INTERACTION_EFFECTS_UPDATE` (per-observation broadcast)
2. **`StorageService.onKeyChanged`** for LIVE_INTERACTIONS, SESSION_CONTEXT, EXECUTION_IR_PLAN, GENERATED_FILES, REPOSITORY_SESSION_ID, ELEMENT_HEAL_RESULT, CAPABILITY_RECORDS

### Live update behavior
- `INTERACTION_CAPTURED` → reads LIVE_INTERACTIONS from storage → renders full interaction list
- `INTERACTION_EFFECTS_UPDATE` → reads LIVE_INTERACTIONS → merges fresh behavioralObservations → re-renders
- Storage `onChanged` for LIVE_INTERACTIONS → renders timeline + detected interactions

### Timeline/Observed Workflow behavior
`renderProductionInteractions()` called on every update. Renders ALL interactions as DOM nodes (no cap, no debouncing, no deduplication).

### Rendering debouncing/deduplication
**None present.** No render debouncing, no MAX_RENDERED cap, no DOM node limit, no dedup logic.

---

## 11. Persistence and Storage

### chrome.storage.local

| Key | What's stored | When written | When read | Bounded? |
|-----|--------------|-------------|-----------|:--------:|
| `cmdrunner_recording_active` | boolean | initRecording(), stopRecording() | restoreFromStorage() | ✅ |
| `cmdrunner_live_interactions` | ComponentInteraction[] | onEmit (every interaction) | restoreFromStorage(), side panel onChange | ❌ |
| `cmdrunner_runtime_snapshot` | runtime state | persistRuntimeSnapshot (every emitted interaction) | restoreFromStorage() | ❌ |
| `cmdrunner_evidence_ledger` | LedgerEntry[] | persistEvidenceLedger (every event) | restoreFromStorage() | ❌ |
| `cmdrunner_obs_{eventId}` | ObservationResult | handleBehavioralEffects (per observation) | recoverDurableObservations | ❌ (cleaned at safe points) |
| `ui_state` | UI state | setRecordingState, resetUIState | getUIState | ✅ |
| `execution_ir_plan` | ExecutionIRPlan | stopRecording | side panel onChange | ✅ |
| `generated_files` | Playwright files | stopRecording | side panel onChange | ✅ |
| `capability_records` | CapabilityRecord[] | stopRecording | side panel onChange | ✅ |
| `repo_session_id` | string | stopRecording | side panel onChange | ✅ |
| `repo_capability_id` | string | stopRecording | side panel onChange | ✅ |
| `repo_capability_decision` | string | stopRecording | side panel onChange | ✅ |

### sessionStorage (content script)

| Key | What's stored | Bounded? |
|-----|--------------|:--------:|
| `cmdrunner_event_buffer` | ObservedEvent[] | 500 max |
| `cmdrunner_behavioral_buffer` | ObservationResult[] | 200 max |
| `cmdrunner_is_recording` | boolean | ✅ |

### IndexedDB (Repository V2)
Dexie-backed database for recording sessions, capabilities, elements, UI elements, projects, test cases. Written at stopRecording via `persistSession()`.

---

## 12. Crash/Memory Characteristics

**WARNING: This baseline has ZERO crash protections. All later crash vectors are fully active.**

### Unbounded structures
- `liveInteractions[]` — grows without limit (no cap, no eviction)
- Evidence Ledger Map — grows without limit (no terminal eviction)
- `cmdrunner_obs_*` storage keys — accumulate per observation (cleaned at safe points, but can accumulate if SW dies)
- Error log, capability records — no caps

### High-frequency storage writes (per event)
Every `processObservedEvent` call triggers up to **3 `chrome.storage.local.set` calls**:
1. `persistEvidenceLedger()` — writes full ledger on EVERY event
2. `persistRuntimeSnapshot()` — writes runtime state on EVERY emitted interaction
3. `persistLiveInteractions()` — writes full liveInteractions[] on EVERY emitted interaction

Plus: `cmdrunner_obs_*` per-observation write in `handleBehavioralEffects`.

**Estimated writes for a 100-interaction, 5-minute session:** ~300-500 storage writes.

### High-frequency messaging (per interaction)
- 1× `sendMessage({type:'OBSERVED_EVENT'})` per event from CS
- 1× `sendMessage({type:'INTERACTION_CAPTURED'})` per emitted interaction from SW
- 1× `sendMessage({type:'INTERACTION_EFFECTS_UPDATE'})` per observation close from SW
- Side panel `onMessage` listener creates broadcast target → Chrome serializes ALL messages for the side panel renderer

### Large payloads
- `persistLiveInteractions()` writes the FULL `liveInteractions[]` array (grows with every interaction)
- `persistEvidenceLedger()` writes the FULL ledger
- `INTERACTION_CAPTURED` broadcast carries full ComponentInteraction
- `INTERACTION_EFFECTS_UPDATE` carries full behavioralObservations

### Potential long-session risks
- **Chrome SIGTRAP/EXC_BREAKPOINT** from Mojo IPC serialization pressure on CrBrowserMain (confirmed by later crash investigation)
- **OOM** from unbounded liveInteractions[] + ledger + obs keys
- **Storage quota exhaustion** from unbounded writes
- **Side panel rendering freeze** from rendering all interactions without debouncing/capping

---

## 13. Tests

### Numbers
- **114 test files**, **2,578 tests**, ALL PASSING
- Duration: ~36 seconds

### Coverage by area

| Directory | Files | Coverage area |
|-----------|:-----:|--------------|
| tests/ (root) | 42 | Messaging, state, AI, error handler, audit, logging, connection, screenshots, SPA, action-id, capabilities |
| tests/runtime/ | 13 | Component runtime, evidence ledger, projection engine, sw-integration, verification mode |
| tests/tap/ | 8 | Event tap, observation coordinator, document observer, element state cache |
| tests/definitions/ | 8 | Each definition's trigger/scope/completion behavior |
| tests/capabilities/ | 7 | Each capability rule, evidence extraction, conflict resolution |
| tests/semantics/ | 5 | Effect interpreter, effect rules |
| tests/domain/ | 9 + 3 execution-ir | Locator ranking, types, staleness |
| tests/adapters/playwright/ | 7 | Action/assertion/locator/project/test rendering |
| tests/repository-v2/ | 6 | Dexie repositories, session persistence |
| tests/presentation/ | 2 | Workflow normalizer, output adapter |
| tests/sidepanel/ | 1 | Behavioral renderer |
| tests/background/ | 1 | Health check re-sync |
| tests/validation/ | 1 | Real-world validation |
| tests/repository-ui/ | 1 | Repository page |

### Important gaps
- No integration tests for the full CS→SW→classification→observation pipeline
- No tests for SW restart/MV3 recovery
- No tests for side panel live update behavior
- No tests for chrome.storage.local write patterns or memory growth
- No tests for crash scenarios (obviously)
- No tests for the `ok:true` race condition

---

## 15. DF-1 Readiness — What DF-1 Will Change

### Current behavior (deff878)
- Observation windows open **ONLY for `click` and `change`** events
- Events like mousedown, focus, blur, input, keydown, mouseenter, mouseleave get NO behavioral evidence
- This means: TextEntry (triggered by focus), Slider (triggered by focus), Hover (triggered by mouseenter), DatePicker (triggered by mousedown), ColorInput (triggered by focus) all have **zero behavioral observations**
- Only Click and Dropdown (triggered by click/change) have behavioral evidence

### DF-1 intended behavior
- Observation windows open for **ALL discrete event types** (click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, keydown)
- New `OBSERVATION_ELIGIBLE_EVENT_TYPES` Set replaces the `eventType === 'click' || eventType === 'change'` check
- Transient events (mousemove, scroll) remain excluded

### DF-1 diff summary (5 source files, +158/-12 lines)

| File | Change |
|------|--------|
| `src/recorder/phase5/recorder-entry.ts` | Replace click/change-only check with OBSERVATION_ELIGIBLE_EVENT_TYPES Set; add mouseenter rate-limiting (5s per-element); add new transient types (pointermove, touchmove); add new discrete types to comment |
| `src/shared/component-types.ts` | Add pointerdown, pointerup, dragstart, dragend, drop, touchstart, touchend, touchmove to BrowserEventType union (+8 types) |
| `src/shared/observation-types.ts` | Add sourceEventType now accepts the expanded set; ObservationWindow accepts new event types |
| `src/tap/element-state-cache.ts` | Add ariaSelected, ariaChecked tracking improvements |
| `src/tap/event-tap.ts` | Register new event listeners for pointer/drag/touch events |

### Side-by-side

| Aspect | deff878 (current) | After DF-1 |
|--------|-------------------|------------|
| Observation events | click, change only | click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, keydown |
| TextEntry has evidence | ❌ | ✅ |
| Slider has evidence | ❌ | ✅ |
| Hover has evidence | ❌ | ✅ |
| DatePicker has evidence | ❌ (only on click) | ✅ (on mousedown) |
| ColorInput has evidence | ❌ | ✅ |
| Coverage | ~30% of interactions | ~90%+ of interactions |
