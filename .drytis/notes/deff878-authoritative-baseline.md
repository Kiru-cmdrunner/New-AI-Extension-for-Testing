# DEFF878 — AUTHORITATIVE BASELINE CONTRACT

**Commit:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8`
**Date:** 2026-08-08 03:03:55 UTC
**Message:** docs update (immediately before DF-1 `c1fe56e`)
**Extension ZIP:** `cmdrunner-extension-deff878-pre-df-baseline.zip` (659 KB, MD5: `6b5cdc6dfb4efc83cbc2884867d6b7da`)
**Manifest version:** 10.9.0
**Source:** 162 TypeScript files, 37,769 LOC
**Tests:** 114 files, 2,578 tests, ALL PASSING

---

## 0. ZIP VERIFICATION

### Clean build confirmed
- **Manifest:** `src/manifest.json` at deff878 → compiled by `@crxjs/vite-plugin` → `manifest.json` in ZIP. Version 10.9.0 matches exactly. SW path `src/background/service-worker.ts` → `service-worker-loader.js` → `assets/service-worker.ts-D7qV2iOW.js`. Content script `src/recorder/phase5/recorder-entry.ts` → `assets/recorder-entry.ts-HKYmCjRk.js`.
- **NO post-DF code in bundles:** Verified zero occurrences of `OBSERVATION_ELIGIBLE_EVENT_TYPES`, `cursorPointer`, `identityPropagation`, `pointermove`, `touchmove`, `behavioral-observation-slim`, `5-second-live-update`, `MAX_LIVE_INTERACTIONS`, `DOM_NODE_CAP`, `renderDebounce`, or any DF-1 through DF-8 feature marker.
- **'stepper'/'autocomplete' in SW bundle:** These are pre-existing component classification regex patterns in `src/definitions/patterns.ts` and `src/enrichment/component-detector.ts` — confirmed present at deff878 source. NOT DF features.
- **Known discrepancy:** The ZIP contains 4 stale inner ZIP files under `download/` (cmdrunner-extension-gdrive-working.zip, -live-update.zip, -pre-td-fixes.zip, .zip) totaling ~538 KB. These are untracked git artifacts from the `capability-v1-complete` working tree that survived `git checkout deff878` because they are in `.gitignore`. They are NOT loaded by the extension at runtime (Chrome loads manifest, scripts, and assets; the `download/` directory is never referenced by any extension HTML or JS). The actual extension code (39 compiled files) is a clean build of deff878.

### ZIP structure (39 entries)
```
manifest.json                              (1358 B)   — MV3 manifest, compiled
service-worker-loader.js                   (49 B)     — SW bootstrap loader
assets/service-worker.ts-D7qV2iOW.js       (78 KB)    — service worker bundle
assets/recorder-entry.ts-HKYmCjRk.js       (22 KB)    — content script bundle
assets/dexie-unit-of-work-factory-*.js     (112 KB)   — Repository V2 (Dexie/IndexedDB)
assets/index.html-Dbc70Q-W.js             (40 KB)    — repository page UI
assets/index.html-jtBuGifp.js             (19 KB)    — sidepanel page UI
assets/project-generator-*.js              (18 KB)    — Playwright code generator
assets/repository-*.js                     (22 KB)    — repository page logic
assets/healing-service-*.js                (4 KB)     — locator healing
assets/ir-bridge-*.js                      (3 KB)     — IR compiler
assets/ir-executor-impl-*.js               (6 KB)     — test execution
assets/storage-service-*.js                (5 KB)     — chrome.storage wrapper
assets/session-persistence-service-*.js    (9 KB)     — session persistence
assets/element-*.js                        (3 KB)     — element domain entity
assets/enums-*.js                          (1 KB)     — shared enums
assets/execution-run-*.js                  (1 KB)     — execution run domain
assets/invariant-errors-*.js               (1 KB)     — error types
assets/locator-ranking-*.js                (2 KB)     — locator strategy ranking
assets/modulepreload-polyfill-*.js         (1 KB)     — Vite polyfill
assets/staleness-*.js                      (1 KB)     — staleness tracking
assets/repository-service-*.js             (4 KB)     — repository service
assets/types-*.js                          (1 KB)     — shared types
assets/index-*.css                         (5+26 KB)  — stylesheets
src/sidepanel/index.html                   (15 KB)    — sidepanel HTML
src/repository/index.html                  (4 KB)     — repository HTML
src/settings/index.html                    (8 KB)     — settings HTML
src/assets/icon-{16,48,128}.png            — extension icons
m1-realworld-test.html / -v2.html          — test harness HTML
stress-test.html                           — stress test HTML
download/cmdrunner-extension-*.zip (×4)    — STALE (see discrepancy above)
```

---

## 1. ARCHITECTURE

**6-layer pipeline, unidirectional, evidence→classification separation:**

```
Browser DOM
  │
  ▼
[Layer 1] EventTap (capture-phase document listener, 12 event types + SPA nav)
  │ produces: ObservedEvent
  ▼
[Layer 2] Content Script Buffer (sessionStorage, durable retry)
  │ transport: chrome.runtime.sendMessage → SW
  ▼
[Layer 3] Component Runtime (14 definitions, priority-ordered discovery)
  │ produces: ComponentInteraction (on emit)
  ├── Evidence Ledger (discrete events: click, mousedown, contextmenu, keydown)
  ├── Enrichment (componentType + componentFramework + businessMeaning)
  └── Behavioral Observation System (3s windows for click+change only)
       │ produces: ObservationResult → semanticEffects
       ▼
[Layer 4] Projection Engine (pure: completed + Unclassified for unclaimed)
  │ produces: full interaction list
  ▼
[Layer 5] Presentation Layer (normalizeWorkflow + filterProductionInteractions)
  │ produces: production interactions
  ▼
[Layer 6] Generation Layer (compileToIR → PlaywrightCodeGenerator)
  │ produces: ExecutionIRPlan → Playwright test files
  │
  └── Capability Engine (12 rules, post-recording inference)
  └── Repository V2 (Dexie/IndexedDB persistence)
  └── Execution Engine (Phase 12: IR Executor + Healing)
```

**Key architectural principles:**
- **AP1:** Evidence and classification are separated. EventTap captures ALL trusted events; definitions classify later.
- **AP7:** Additive extensibility. New component types = new definition file + register in ALL_DEFINITIONS.
- **Pure functions** in Projection, IR Bridge, Workflow Normalizer, Effect Interpreter — no side effects, testable in isolation.
- **MV3 service worker** is the brain: all runtime, ledger, observation correlation, enrichment, persistence happens in SW context.

---

## 2. EVENT CAPTURE

### EventTap (`src/tap/event-tap.ts`, ~370 lines)

Single capture-phase listener on `document` with `{capture:true, passive:true}`.

| # | Event Type | Listened | Rate-Limited | Transient (fire-and-forget) | Durable (buffered+retried) |
|---|-----------|----------|-------------|---------------------------|--------------------------|
| 1 | `click` | ✅ | No | | ✅ |
| 2 | `mousedown` | ✅ | No | | ✅ |
| 3 | `contextmenu` | ✅ | No | | ✅ |
| 4 | `focus` | ✅ | No | | ✅ |
| 5 | `blur` | ✅ | No | | ✅ |
| 6 | `input` | ✅ | No | | ✅ |
| 7 | `change` | ✅ | No | | ✅ |
| 8 | `mouseenter` | ✅ | No | | ✅ |
| 9 | `mouseleave` | ✅ | No | | ✅ |
| 10 | `mousemove` | ✅ | 50ms throttle | ✅ | |
| 11 | `keydown` | ✅ | No | | ✅ |
| 12 | `scroll` | ✅ | 16ms throttle | ✅ | |
| 13 | SPA navigation | ✅ (monkey-patched) | No | | ✅ |

**NOT captured at deff878:** `pointermove`, `pointerdown`, `pointerup`, `touchstart`, `touchmove`, `touchend`, `wheel`, `dragstart`, `drop`, `submit`. (These are added by DF-1+.)

### SPA Navigation Detection
History API monkey-patching: `history.pushState` and `history.replaceState` are wrapped to emit synthetic navigation events. Also listens to `popstate` (back/forward) and `hashchange` (hash routers).

### Trusted Event Gate
`rawEvent.isTrusted` must be `true`. Programmatic events (`el.click()`, dispatchEvent) are filtered out. `TEST_HOOK.forceTrusted` overrides for jsdom test environment.

### ObservedEvent Assembly
For each captured event, `assembleObservedEvent()` produces:
- **eventId:** `evt-{pageId}-{counter}` where pageId = `p{Date.now().toString(36)}`
- **eventType:** one of 12 types + `navigation`
- **timestamp:** `Date.now()`
- **captureSeq:** `rawEvent.timeStamp` (performance timeline)
- **isTrusted:** boolean
- **target:** ElementIdentity (resolved via identity-extractor)
- **domContext:** DomContext (extracted via dom-context-extractor)
- **valueBefore:** captured on focus/click/mousedown
- **valueAfter:** captured on input/change/blur
- **checkedBefore:** captured on click/mousedown
- **checkedAfter:** captured on change
- **clientX/clientY:** pointer coordinates (mouse events only)
- **key/code:** keyboard input (keydown only)
- **shiftKey/ctrlKey/altKey/metaKey:** modifier state
- **scrollDeltaY/scrollDeltaX:** scroll position delta (scroll only)
- **pageUrl/pageTitle:** document context

---

## 3. TARGET RESOLUTION & ELEMENT IDENTITY

### resolveTarget (`src/tap/identity-extractor.ts`)

Uses `event.composedPath()` to pierce Shadow DOM. 4-strategy fallback:

1. **Interactive Selector match:** Walk composedPath(), find first element matching `INTERACTIVE_SELECTOR` (35 CSS selectors: `[role=button]`, `[role=checkbox]`, `input`, `select`, `textarea`, `button`, `a[href]`, `[tabindex]`, `[draggable]`, etc.)
2. **Clickable heuristic:** If no interactive element found, check `cursor:pointer` computed style or `onclick` attribute on path elements.
3. **Raw target fallback:** If target is not a structural tag (`HTML`, `BODY`, `SCRIPT`, `HEAD`, etc.), use the raw event target.
4. **Skip:** If target is structural, the event is effectively swallowed (no identity produced).

**Note:** `cursor:pointer` IS used as a clickable heuristic in Strategy 2. This is NOT the DF-2 `cursorPointer` identity field — it is a DOM computed-style check that determines *whether* to target an element, not a field stored on ElementIdentity.

### ElementIdentity (18 fields + elementId)

```
accessibleName    — 11-tier cascade (aria-label → aria-labelledby → label[for] → wrapping label → innerText → textContent → placeholder → value → alt → title)
ariaRole          — explicit role attr → TAG_ROLE_MAP (30 entries) → INPUT_TYPE_ROLE_MAP (15 entries)
ariaLabel         — raw aria-label attribute
ariaLabelledBy    — raw aria-labelledby attribute
placeholder       — placeholder attribute
tag               — tagName (lowercase)
className         — element.className string
name              — name attribute
stableId          — id attribute (if not auto-generated)
testId            — data-testid attribute
dataCy            — data-cy attribute
dataQa            — data-qa attribute
cssSelector       — generated: #id or nth-of-type chain (max depth 5)
xPath             — generated: id-based or position-based (max depth 10)
inIframe          — boolean: is element inside an iframe
shadowDom         — boolean: is element inside a Shadow DOM
href              — href attribute (for links)
iframeContext     — optional: {frameSelector, frameXPath, frameIndex, frameDepth}
elementId         — generated unique ID (from element-id-generator)
```

**NOT present at deff878:** `cursorPointer` (added in DF-2), any pointer/touch-specific fields.

---

## 4. CS→SW COMMUNICATION

### Content Script (`src/recorder/phase5/recorder-entry.ts`, 465 lines)

**Two event classes:**

| Class | Event Types | Buffer | Retry | On Failure |
|-------|-----------|--------|-------|------------|
| **Transient** | `mousemove`, `scroll` | None | None | Fire-and-forget via `chrome.runtime.sendMessage`. If SW is down, event is lost. |
| **Durable** | All other 10 types + navigation | sessionStorage (`cmdrunner_event_buffer`, max 500) | 5 retries, exponential backoff (100ms→1600ms) | Remains in buffer, flushed on pagehide |

**Behavioral results** (ObservationResult from 3s windows): Always durable. Buffered in `cmdrunner_behavioral_buffer` (max 200), same retry pattern.

**Lifecycle:**
- `startRecording`: Creates ElementStateCache, DocumentObserver, ObservationCoordinator. Registers state-cache listeners (mousedown+focus capture phase). Creates EventTap.
- `stopRecording`: Flushes pending events, stops EventTap, clears buffers, shuts down coordinator (finalizes windows with `endReason='recording-stopped'`).
- `pagehide`: Flushes both buffers.
- `pageshow`: Auto-resumes recording if `RECORDING_KEY` flag is set.
- Message listener handles: PING, START_RECORDING, STOP_RECORDING, FLUSH_EVENTS.

**Transport:** `chrome.runtime.sendMessage({type:'OBSERVED_EVENT', payload: ObservedEvent})`. SW responds `{ok:true}`. No batching — one message per event.

---

## 5. COMPONENT DEFINITIONS (14 definitions)

**Registry:** `src/definitions/index.ts` exports `ALL_DEFINITIONS` array.

**Discovery order** (priority ascending = checked first):
```
tryDiscovery():
  1. Sort nonClickDefinitions by priority ascending
  2. Iterate: check detectTrigger() → isInScope() → create context
  3. If none matched, try clickDefinition (priority 180, universal fallback)
```

| # | Definition | Priority | Trigger Events | Detect Trigger Condition | Output Interaction | Key Behavior |
|---|-----------|----------|---------------|------------------------|-------------------|-------------|
| 1 | DatePicker | 10 | click | Element has date-picker patterns: `[role=combobox]`, `input[type=date]`, calendar widget classes, `aria-haspopup=grid` | DatePicker | Multi-step: click trigger → click date in calendar → detect selectedDate from value |
| 2 | ColorInput | 15 | focus | `input[type=color]` | ColorInput | Triggers on focus, completes on change. Filters same-color re-selection. |
| 3 | Dropdown | 20 | click | Element matches dropdown patterns: `select`, `[role=combobox]`, `[role=listbox]`, `[aria-expanded]`, MUI/AntD classes | Dropdown | Click trigger → click option → detect selected value. Checks `noOpSelection`. |
| 4 | Slider | 25 | focus | `input[type=range]`, `[role=slider]`, ARIA valuenow | Slider | Triggers on focus. Completes on change/input. Checks `userAdjusted`. |
| 5 | Checkbox | 30 | click | `input[type=checkbox]`, `[role=checkbox]`, `[aria-checked]`, CSS class fallbacks | Checkbox | Single click. Dedup checks accessibleName match. |
| 6 | FileUpload | 35 | click | `input[type=file]`, `[role=button]` near file input | FileUpload | Detects fileName from value attribute. |
| 7 | RadioButton | 40 | click | `input[type=radio]`, `[role=radio]` | RadioButton | Single click. Checks `noOpSelection`. |
| 8 | TextEntry | 50 | focus | `input`, `textarea`, `[contenteditable]`, `[role=textbox]` | TextEntry | Focus → member input/change events → blur completes. Checks `userTyped` and `textValue` non-empty. |
| 9 | Hover | 60 | mouseenter | Any element (mouseenter event) | Hover | mouseenter triggers, mouseleave completes. Filtered as incidental in production if no meaningful interaction. |
| 10 | Tab | 65 | click | `[role=tab]`, `[role=tablist] > *`, tab classes | Tab | Checked before Link because tabs are often `<a>` tags. |
| 11 | Link | 70 | click | `<a[href]>`, `[role=link]` | Link | Single click. |
| 12 | Scroll | 110 | scroll | Any element (scroll event with delta) | Scroll | Rate-limited. Checks `hasDelta` for production filter. |
| 13 | Navigation | 120 | navigation | Synthetic navigation event | Navigation | SPA route changes. Priority above Click as fallback. |
| 14 | Click | 180 | click | Any element (universal fallback) | Click | Always checked last. Catches any click not matched by higher-priority definitions. |

**Definition interface** (`ComponentDefinition`):
- `type: InteractionType`
- `priority: number`
- `triggerEventTypes: Set<string>`
- `detectTrigger(event: ObservedEvent): boolean`
- `isInScope(event: ObservedEvent, ctx: ComponentContext): boolean`
- `handleEvent(event: ObservedEvent, ctx: ComponentContext): void`
- `shouldCancelOnOutside: boolean`
- `shouldCompleteOnOutside?: boolean`
- `buildResult(ctx: ComponentContext): { metadata, endState }`
- `semanticChildRoles?: string[]` / `semanticChildTags?: string[]`

**Component Runtime** (`src/runtime/component-runtime.ts`, ~450 lines):
- **activeStack:** `ComponentContext[]` — stack of in-progress interactions.
- **process(event):** (1) dedup by eventId, (2) navigation flushes stack, (2b) cleanup stale components (MAX_LIFECYCLE_DURATION_MS=15000), (3) offer to stack top→bottom, (4) discovery for unmatched events.
- **seenEventIds:** Set with cap 500, halves when exceeded.
- **dedupByType:** Map for isDuplicate check (same elementKey, ≤2000ms gap).
- **lifecycleOwnsTarget:** W3C semantic child role/tag check + surface containment via ancestorRoles. No framework heuristics.

---

## 6. OBSERVATION SYSTEM

### What Opens Windows Today

**ONLY `click` and `change` events open observation windows.** This is hardcoded in `recorder-entry.ts`:

```typescript
onAfterEvent: (event) => {
  if (event.eventType === 'click' || event.eventType === 'change') {
    observationCoordinator.openWindow(event.eventId, event.eventType, targetEl);
  }
}
```

All other event types (mousedown, contextmenu, focus, blur, input, keydown, mouseenter, mouseleave, mousemove, scroll, navigation) do NOT open observation windows.

### ObservationCoordinator (`src/tap/observation-coordinator.ts`, ~230 lines)

- **Window duration:** 3000ms (DEFAULT_WINDOW_DURATION_MS)
- **openWindow(eventId, eventType, targetEl):**
  1. Peek ElementStateCache for beforeSnapshot
  2. Capture current state (updates cache)
  3. Create ObservationWindow (windowId = `obs-{eventId}`)
  4. Start DocumentObserver for windowId (refcounted)
  5. Set independent setTimeout for closeWindow
- **closeWindow(windowId, reason):**
  1. Clear timer
  2. Read finalSnapshot via `cache.read()` (non-mutating — does NOT update cache)
  3. Check `document.contains(targetEl)` for element-removed detection
  4. Collect mutations via `observer.getRecordsForWindow(windowId)`
  5. Prune window records
  6. Stop observer (refcounted)
  7. Build ObservationResult, deliver via `onResultCb`
- **Concurrent windows:** Fully independent. Each has its own timer. Shared MutationObserver records carry `windowIds[]` array for attribution.
- **shutdown():** Closes all open windows with `endReason='recording-stopped'`.
- **WeakRef<Element>:** Target elements stored as WeakRef for GC safety.

### ElementStateCache (`src/tap/element-state-cache.ts`, ~160 lines)

WeakMap<Element, ElementStateSnapshot>. Captures 9 properties:

| Field | Source |
|-------|--------|
| value | HTMLInputElement/HTMLSelectElement `.value` |
| checked | `input.checked`, `aria-checked`, `aria-pressed`, CSS class fallback |
| className | `element.className` |
| disabled | `element.disabled`, `aria-disabled` |
| ariaExpanded | `element.ariaExpanded` |
| ariaChecked | `element.aria-checked` |
| ariaPressed | `element.aria-pressed` |
| textContent | `element.textContent` (truncated 200 chars) |
| childCount | `element.children.length` |

- **capture(el):** Creates NEW snapshot (previous never mutated).
- **peek(el):** Returns cached snapshot without DOM read.
- **read(el):** Reads current state WITHOUT updating cache (used at window close).
- **clear():** Reassigns WeakMap reference.

### State Cache Pre-Population (`src/tap/state-cache-listeners.ts`)

Two capture-phase listeners on `document`:
- **mousedown** (capture, passive): `cache.capture(el)` — runs BEFORE default action toggles state.
- **focus** (capture, passive): `cache.capture(el)` — runs BEFORE application handlers.

### DocumentObserver (`src/tap/document-observer.ts`, ~280 lines)

Singleton MutationObserver on `document.body`.

Config: `childList:true, attributes:true, characterData:true, subtree:true, attributeOldValue:true, characterDataOldValue:true`.

- **handleMutations:** Processes every record in batch (no cap, no break). Records PerformanceCondition if batchDuration > 15ms (diagnostic only).
- **compact():** Creates MutationRecord2 with CSS path via WeakMap-cached `getPath()`.
- **getRecordsForWindow:** Filters by `windowIds.includes(windowId)`, returns copies.
- **pruneWindowRecords:** Records ONLY belonging to closing window are removed; shared records survive with windowId removed.
- **No buffer cap** on records array — natural bound via 3-second window + pruning.

### ObservationResult (output)

```
sourceEventId      — the triggering event's ID
sourceEventType    — 'click' or 'change'
windowId           — 'obs-{eventId}'
openedAt           — timestamp
closedAt           — timestamp
durationMs         — closedAt - openedAt
endReason          — 'completed' | 'element-removed' | 'recording-stopped'
beforeSnapshot     — ElementStateSnapshot at window open
finalSnapshot      — ElementStateSnapshot at window close
mutations[]        — MutationRecord2[]
mutationCount      — mutations.length
documentWideMutationTotal — total mutations during window (including unattributed)
performanceCondition — optional: {batchRecordCount, batchDurationMs, timestamp}
semanticEffects[]  — optional: SemanticEffect[] (attached after interpretation)
```

### How Observations Associate with Interactions

In the SW (`sw-integration.ts`):
1. `handleBehavioralEffects(payload: ObservationResult)` receives the result.
2. Correlates by `sourceEventId` against `liveInteractions`' member events.
3. If found: attaches to the interaction's `behavioralObservations[]`, runs `interpretBehavioralObservations`, broadcasts `INTERACTION_EFFECTS_UPDATE`.
4. If not found yet: stored in `pendingBehavioralEffects` map, checked again on next interaction emission.
5. ALWAYS persisted to `chrome.storage.local` under `cmdrunner_obs_{sourceEventId}` key before acking.

---

## 7. EVIDENCE TYPES

### Available at deff878

| Evidence Type | Source | Stored On |
|--------------|--------|-----------|
| **Element Identity** (18 fields) | identity-extractor.ts | ObservedEvent.target → ComponentInteraction.trigger |
| **DOM Context** (inputType, ariaExpanded, ariaHasPopup, disabled, readOnly, required, ancestorRoles, ancestorClasses, tabIndex, ariaValueNow/Min/Max) | dom-context-extractor.ts | ObservedEvent.domContext |
| **Value transitions** (before/after) | event-tap.ts | ObservedEvent.valueBefore/After |
| **Checked transitions** (before/after) | event-tap.ts | ObservedEvent.checkedBefore/After |
| **Pointer coordinates** (clientX/Y) | event-tap.ts | ObservedEvent.clientX/Y |
| **Keyboard input** (key, code, modifiers) | event-tap.ts | ObservedEvent.key/code/shiftKey/etc |
| **Scroll deltas** (Y, X) | event-tap.ts | ObservedEvent.scrollDeltaY/X |
| **Page context** (URL, title) | event-tap.ts | ObservedEvent.pageUrl/pageTitle |
| **Element State Snapshot** (9 properties, before→after) | element-state-cache.ts | ObservationResult.beforeSnapshot/finalSnapshot |
| **DOM Mutations** (childList, attributes, characterData, with old/new values) | document-observer.ts | ObservationResult.mutations[] |
| **Performance conditions** (batch record count, batch duration) | document-observer.ts | ObservationResult.performanceCondition |
| **Semantic effects** (interpreted from snapshots + mutations) | effect-interpreter.ts | ObservationResult.semanticEffects[] |
| **Evidence ledger dispositions** (pending→absorbed→claimed/unclaimed) | evidence-ledger.ts | LedgerEntry.disposition |
| **Component enrichment** (componentType, componentFramework, businessMeaning) | enrich.ts | ComponentInteraction.componentType/etc |
| **Capability records** (12 inference rules) | capability-engine.ts | CapabilityRecord[] |

### NOT Available at deff878

| Missing Evidence | Added By |
|-----------------|----------|
| Pointer movement tracking | DF-1 (pointermove capture) |
| Touch event tracking | DF-1 (touchmove capture) |
| cursorPointer identity field | DF-2 |
| Behavioral observation for non-click/change events | DF-1 (OBSERVATION_ELIGIBLE_EVENT_TYPES) |
| Network request evidence | Not implemented (DF scope) |
| Console log evidence | Not implemented |
| Screenshot evidence | Not implemented |
| Video recording | Not implemented |

---

## 8. EVIDENCE LEDGER

### LedgerEntry Structure

```typescript
{
  eventId:      string     // e.g. "evt-p1234abc-0"
  captureSeq:   number     // rawEvent.timeStamp
  pageId:       string     // extracted from eventId pattern
  eventType:    string     // 'click' | 'contextmenu' | 'mousedown' | 'keydown'
  timestamp:    number     // Date.now()
  disposition:  DispositionStatus  // 'pending' | 'absorbed' | 'claimed' | 'unclaimed'
  claimedBy?:   string     // lifecycle ID of the claiming component
  claimType?:   InteractionType  // type of the claiming component
  targetTag:    string     // diagnostic: element tagName
  targetName:   string     // diagnostic: accessibleName
  targetRole:   string     // diagnostic: ariaRole
}
```

**NO `targetIdentity`** — only diagnostic identity fields (tag, name, role) are stored.
**NO eviction cap** — ledger grows unbounded during a recording session.

### Disposition Lifecycle

```
                    append()
              ┌─────────────────┐
              │ DISCRETE_ACTION │  (click, contextmenu, mousedown, keydown)
              │     TYPES only   │
              └────────┬────────┘
                       │
                       ▼
                  ┌────────┐
                  │ pending│
                  └───┬────┘
                      │ runtime.process() runs
                      │
           ┌──────────┼──────────┐
           │          │          │
           ▼          ▼          ▼
     setDisposition('absorbed')  (event consumed by an active component but not yet its trigger)
           │
           │ component completes
           │
           ▼
     setDisposition('claimed')
     { claimedBy: lifecycleId, claimType: InteractionType }
     (TERMINAL — cannot change)

     OR: component abandoned/interrupted
           │
           ▼
     releaseClaims(lifecycleId)
     absorbed → unclaimed  (TERMINAL)
```

### Persistence & Recovery

- **persistEvidenceLedger():** `chrome.storage.local.set` after every disposition change. Key: `cmdrunner_evidence_ledger`.
- **restoreFromStorage():** On MV3 SW restart, reads ledger, calls `resetAbsorbedToUnclaimed()` — any entries stuck in 'absorbed' (because the owning component was lost when SW died) are reset to 'unclaimed' so the Projection Engine can account for them.

### What Is Retained vs Discarded

- **Retained:** All discrete action events (click, mousedown, contextmenu, keydown) with full disposition history.
- **Discarded:** Non-discrete events (focus, blur, input, change, mouseenter, mouseleave, mousemove, scroll, navigation) NEVER enter the ledger. They are only in the runtime's activeStack as memberEvents.

---

## 9. PROJECTION ENGINE

### Pure Function (`src/runtime/projection-engine.ts`, ~200 lines)

```typescript
function projectInteractions(
  ledger: EvidenceLedger,
  completedInteractions: ComponentInteraction[]
): ProjectionResult
```

**Algorithm:**
1. Filter to completed-only interactions.
2. Build `coveredEventIds` set from their triggerEvent + memberEvents.
3. Find unclaimed + pending ledger entries NOT already covered.
4. For each: create an `Unclassified` interaction with placeholder ElementIdentity (only targetTag, targetName, targetRole populated — all other fields null/empty).
5. Return `{ interactions: [...completed, ...projectedUnclassified], projectedUnclassified, projectedEntries }`.

**Invariants:**
- **INV-PE-1:** Output = completedInteractions + Unclassified for every unclaimed/pending ledger entry.
- **INV-PE-2:** Every discrete event in the ledger is represented in the output (either via a recognized interaction or as Unclassified).

**Called from:** `stopRecording()` in sw-integration.ts, AFTER runtime.flush() and pending observation attachment.

---

## 10. CAPABILITY ENGINE

### 12 Rules (`src/capabilities/`)

Post-recording inference. Runs AFTER behavioral observations are finalized and effects interpreted.

| # | Rule | Trigger | Output |
|---|------|---------|--------|
| 1 | ToggleControlRule | Checkbox/RadioButton with state-toggle effect | ToggleControl capability |
| 2 | ExpandCollapseRule | Click with expand/collapse effect | ExpandCollapse capability |
| 3 | UploadFileRule | FileUpload interaction | UploadFile capability |
| 4 | NavigateRule | Navigation/Link interaction | Navigate capability |
| 5 | OpenDetailRule | Click with content-change on detail area | OpenDetail capability |
| 6 | PaginateRule | Click on pagination element | Paginate capability |
| 7 | FilterSelectionRule | Dropdown/Select with filter effect | FilterSelection capability |
| 8 | SortSelectionRule | Dropdown/Click with sort effect | SortSelection capability |
| 9 | SearchRule | TextEntry in search context | Search capability |
| 10 | SubmitFormRule | Click on submit button + form context | SubmitForm capability |
| 11 | SelectOptionRule | Dropdown/Select interaction | SelectOption capability |
| 12 | AdjustValueRule | Slider with value change | AdjustValue capability |

**Engine:** `CapabilityEngine` class. Rules registered via `engine.registerRule()`. `runInference(effectsMap)` returns `CapabilityRecord[]`.

**Bridge:** `runCapabilityInference(interactions)` in capability-bridge.ts builds EffectsMap from finalized interactions, creates engine, runs inference.

---

## 11. IR / GENERATION

### IR Bridge (`src/generation/ir-bridge.ts`)

Pure function `compileToIR(interactions)` maps 15 InteractionTypes to IRActions:

| InteractionType | IRAction |
|----------------|----------|
| Click | CLICK |
| TextEntry | FILL |
| Dropdown | SELECT |
| Checkbox | TOGGLE |
| RadioButton | SELECT |
| DatePicker | SELECT_DATE |
| Hover | HOVER |
| Link | CLICK |
| FileUpload | FILL |
| Slider | FILL |
| ColorInput | FILL |
| Tab | CLICK |
| Scroll | CLICK (filtered as noise) |
| Navigation | NAVIGATE |
| Unclassified | CLICK |

**NOISE_TYPES:** `Set(['Scroll', 'Unclassified'])` — filtered during IR plan construction.

**Locator resolution:** `resolveLocatorsForIR` delegates to `domain/locator-ranking.ts`. 5-tier hierarchy: Business (testId/dataCy/dataQa, 0.90-0.95) → Accessibility (ariaLabel, 0.80) → Stable Technical (non-auto id, name, 0.70-0.75) → Content-Based (accessibleName, placeholder, 0.60-0.65) → Structural (CSS, XPath, 0.30-0.40).

### PlaywrightCodeGenerator (`src/adapters/playwright/project-generator.ts`)

Produces complete Playwright project from ExecutionIRPlan:
- `package.json` (Playwright ^1.52.0)
- `playwright.config.ts`
- `tsconfig.json`
- `.gitignore`
- `tests/<slug>.spec.ts` (flat pattern)
- Optional: `pages/<page-slug>.ts` (page-object pattern, one per pageOrComponent)

Pure: given same plan + config, always produces same output. No I/O.

---

## 12. SIDE PANEL

### Message Listeners (`src/sidepanel/sidepanel.ts`)

**chrome.runtime.onMessage:**
| Message | Handler |
|---------|---------|
| `CONTENT_SCRIPT_STATUS` | Updates health indicator (connected/error) |
| `EXECUTION_RESULT` | Hides running indicator, loads execution results |
| `INTERACTION_CAPTURED` | **Full reload:** reads ALL interactions from `chrome.storage.local[LIVE_INTERACTIONS]`, re-renders entire detected interactions list. NOT incremental. |
| `INTERACTION_EFFECTS_UPDATE` | **UI-only merge:** finds interaction by ID, replaces `behavioralObservations`, re-renders. Does NOT persist. |

**chrome.storage.onChanged (8 listeners via StorageService.onKeyChanged):**
| Key | Handler |
|-----|---------|
| `LIVE_INTERACTIONS` | Registered TWICE — once for recording timeline, once for detected interactions list |
| `SESSION_CONTEXT` | Shows recording context (start URL) |
| `EXECUTION_IR_PLAN` | Renders IR steps |
| `GENERATED_FILES` | Renders generated Playwright files |
| `REPOSITORY_SESSION_ID` | Loads repository status |
| `ELEMENT_HEAL_RESULT` | Renders healing summary |
| `CAPABILITY_RECORDS` | Renders capability records |

### Rendering Behavior

- **No debouncing:** Every `INTERACTION_CAPTURED` message triggers immediate full reload from storage + full re-render.
- **No DOM node caps:** Every interaction renders a full DOM subtree with behavioral evidence sections.
- **No dedup on rendered interactions:** Whatever is in storage is rendered.
- **Three-layer display per interaction:** Type icon (Layer 1) + componentType badge (Layer 2) + businessMeaning text (Layer 3).
- **Behavioral evidence section:** Collapsible. Renders `ObservationResult[]` with before→after state properties and mutation timeline. Shows semantic effects with confidence labels (HIGH/MEDIUM/LOW).

### Views
1. **Home** — idle state
2. **New TC** — new test case configuration
3. **Recording** — live recording with timeline + detected interactions
4. **Stopped** — results: detected interactions, IR steps, generated files, healing summary, capability records

---

## 13. PERSISTENCE & IPC

### Complete Mechanism Inventory

| # | Mechanism | Writer | Reader | Frequency | Payload Size | Bounded? | Debounced? |
|---|-----------|--------|--------|-----------|-------------|----------|-----------|
| 1 | `chrome.runtime.sendMessage(OBSERVED_EVENT)` | Content script | SW | Per event | ~500B-2KB per ObservedEvent | N/A (fire-and-forget for transient) | No |
| 2 | `chrome.runtime.sendMessage(BEHAVIORAL_EFFECTS)` | Content script | SW | Per observation window close (3s after click/change) | ~1-10KB per ObservationResult | N/A | No |
| 3 | `chrome.runtime.sendMessage(INTERACTION_CAPTURED)` | SW | Side panel | Per interaction emission | ~200B (just interactionId + trigger) | N/A | No |
| 4 | `chrome.runtime.sendMessage(INTERACTION_EFFECTS_UPDATE)` | SW | Side panel | Per observation correlation | ~1-10KB (full behavioralObservations) | N/A | No |
| 5 | `chrome.storage.local[LIVE_INTERACTIONS]` | SW (sw-integration.ts) | Side panel (onChanged), SW (restore) | Per interaction emission (IMMEDIATE, no debounce) | Grows linearly: ~2-5KB × N interactions | **NO** — unbounded array | No |
| 6 | `chrome.storage.local[RUNTIME_SNAPSHOT]` | SW (sw-integration.ts) | SW (restore) | Per interaction emission | ~1-5KB (runtime state) | Yes (single object) | No |
| 7 | `chrome.storage.local[EVIDENCE_LEDGER]` | SW (sw-integration.ts) | SW (restore) | Per disposition change | Grows linearly: ~200B × N discrete events | **NO** — unbounded | No |
| 8 | `chrome.storage.local[RECORDING_ACTIVE]` | SW | Content script | Start/stop only | ~50B | Yes | N/A |
| 9 | `chrome.storage.local[cmdrunner_obs_{eventId}]` | SW (sw-integration.ts) | SW (restore) | Per observation window close | ~1-10KB per observation | Bounded by discrete events count, cleaned up after attach | No |
| 10 | `chrome.storage.local[SESSION_CONTEXT]` | SW | Side panel | Start only | ~200B | Yes | N/A |
| 11 | `chrome.storage.local[EXECUTION_IR_PLAN]` | SW (stopRecording) | Side panel, SW | Stop only | ~5-50KB | Yes | N/A |
| 12 | `chrome.storage.local[GENERATED_FILES]` | SW (stopRecording) | Side panel | Stop only | ~10-100KB | Yes | N/A |
| 10 | `chrome.storage.local[UI_STATE]` | Side panel | SW | State changes | ~100B | Yes | N/A |
| 14 | `sessionStorage[cmdrunner_event_buffer]` | Content script | Content script | Per durable event (push/remove on ack) | ~500B-2KB per event, max 500 entries | **YES** — MAX_BUFFER_SIZE=500 | No |
| 15 | `sessionStorage[cmdrunner_behavioral_buffer]` | Content script | Content script | Per observation result (push/remove on ack) | ~1-10KB per result, max 200 entries | **YES** — MAX_BEHAVIORAL_BUFFER=200 | No |
| 16 | IndexedDB (Dexie) `cmdrunner_repository` | SW (stopRecording, SessionPersistenceService) | Repository page | Stop only (full session persist) | Entire session: interactions + events + IR plan + capabilities | Yes (transactional) | N/A |
| 17 | `chrome.alarms` (content script health) | SW | SW | Every ~5s (periodInMinutes=0.08) | Minimal | Yes | N/A |

**Key observation:** Every interaction emission triggers:
1. `chrome.storage.local.set({[LIVE_INTERACTIONS]: [...all]})` — writes the ENTIRE array
2. `chrome.runtime.sendMessage(INTERACTION_CAPTURED)` — broadcast to side panel
3. `chrome.storage.local.set({[RUNTIME_SNAPSHOT]: ...})` — runtime state
4. `chrome.storage.local.set({[EVIDENCE_LEDGER]: ...})` — if disposition changed

And every observation window close triggers:
1. `chrome.storage.local.set({[cmdrunner_obs_{eventId}]: result})` — per-observation key
2. `chrome.runtime.sendMessage(BEHAVIORAL_EFFECTS)` — to SW
3. After correlation: `chrome.runtime.sendMessage(INTERACTION_EFFECTS_UPDATE)` — to side panel

---

## 14. MEMORY & CRASH CHARACTERISTICS

### Potentially Expensive Operations

| # | Operation | Risk | Trigger |
|---|-----------|------|---------|
| 1 | **`liveInteractions[]` unbounded growth** | Array grows linearly. `chrome.storage.local.set` writes the ENTIRE array on every emission. Side panel reads the ENTIRE array on every `INTERACTION_CAPTURED`. | Every interaction emission |
| 2 | **`evidenceLedger` unbounded growth** | Map grows linearly with discrete events. Full serialization on every disposition change. | Every click/mousedown/contextmenu/keydown |
| 3 | **`cmdrunner_obs_*` keys accumulation** | One storage key per observation window. Cleaned up after attach, but if correlation fails (SW restart, timing), keys persist. | Every click+change (3s window) |
| 4 | **Side panel full re-render** | `INTERACTION_CAPTURED` → reads ALL interactions from storage → `renderProductionInteractions` creates DOM nodes for ALL. No virtualization, no cap. | Every interaction emission |
| 5 | **No render debouncing** | Rapid interaction emissions (e.g., typing) trigger N rapid full re-renders. | Every interaction emission |
| 6 | **Per-event `chrome.storage.local.set`** | Each ObservedEvent triggers 3+ storage writes (liveInteractions, runtimeSnapshot, evidenceLedger). No batching. | Every discrete event |
| 7 | **MutationObserver processing** | Processes every mutation record in batch (no cap). Heavy DOM activity during 3s windows can produce thousands of records. | Every DOM mutation during observation window |
| 8 | **DocumentObserver records buffer** | No cap on records array. Natural bound = 3s window, but heavy SPAs can produce large volumes. | During observation windows |
| 9 | **`document-observer` getPath() computation** | Computes CSS path for every mutation target. WeakMap-cached but still CPU work for first hit per element. | Every mutation on new element |
| 10 | **8 `storage.onChanged` listeners** | Each storage write triggers all matching listeners. LIVE_INTERACTIONS registered twice → double fire. | Every relevant storage change |

### No Protections at deff878

- **No debounce** on any storage write or broadcast.
- **No array cap** on liveInteractions or evidenceLedger.
- **No DOM node cap** in side panel rendering.
- **No requestIdleCallback** or similar scheduling.
- **No backpressure** — if SW processing falls behind event rate, messages queue in `chrome.runtime.sendMessage` buffer.

---

## 15. TESTS

### Test Suite at deff878

- **Test files:** 114 (all `.test.ts` under `tests/`)
- **Test count:** 2,578 tests
- **Status:** ALL PASSING (confirmed at deff878 checkout)
- **Framework:** Vitest (config in vite.config.ts: globals=true, environment=jsdom)

### Coverage by Directory

| Directory | Files | Focus |
|-----------|-------|-------|
| `tests/` | Several | Root-level integration tests |
| `tests/adapters/playwright` | 7 | Playwright code generation, IR→code mapping |
| `tests/background` | Several | SW message routing, recording lifecycle |
| `tests/capabilities` | Several | All 12 capability rules |
| `tests/definitions` | 8 | All 14 component definitions |
| `tests/domain` | Several | Domain entities, execution-ir |
| `tests/domain/execution-ir` | Several | IR plan construction, locator ranking |
| `tests/presentation` | Several | Workflow normalizer, output adapter |
| `tests/repository-ui` | Several | Repository page UI |
| `tests/repository-v2` | 6 | Dexie repositories, unit-of-work |
| `tests/runtime` | 13 | Component runtime, evidence ledger, projection engine |
| `tests/semantics` | 5 | Effect interpreter, all 7 rules |
| `tests/sidepanel` | Several | Side panel rendering |
| `tests/tap` | 8 | EventTap, ElementStateCache, DocumentObserver, ObservationCoordinator |
| `tests/validation` | Several | Verification mode, end-to-end |

### Gaps

- **No browser E2E tests:** All tests are jsdom unit/integration. No Playwright/puppeteer tests of the actual extension.
- **No performance/load tests:** `stress-test.html` and `m1-realworld-test.html` exist as manual test harnesses but are not automated.
- **No memory growth assertions:** Tests verify correctness but do not assert bounded memory usage.
- **No concurrent-event stress tests:** Observation system tested with single windows, not many overlapping windows.

---

## 16. BASELINE FEATURE LIST

### Capture
- ✅ 12 DOM event types (click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, mousemove, keydown, scroll)
- ✅ SPA navigation via History API monkey-patching + popstate + hashchange
- ✅ Capture-phase listeners (before application handlers)
- ✅ Trusted event filtering (isTrusted gate)
- ✅ Scroll rate-limiting (16ms), mousemove throttling (50ms)
- ❌ Pointer events (pointermove, pointerdown, pointerup)
- ❌ Touch events (touchstart, touchmove, touchend)
- ❌ Wheel, drag, drop, submit events

### Target Identification
- ✅ composedPath() Shadow DOM traversal (open shadow roots)
- ✅ 4-strategy target resolution (interactive selector → clickable heuristic → raw target → skip)
- ✅ 18-field ElementIdentity with 11-tier accessibleName cascade
- ✅ CSS selector generation (max depth 5) and XPath (max depth 10)
- ✅ Iframe context detection (same-origin, frame selector/XPath/index/depth)
- ✅ cursor:pointer clickable heuristic (DOM computed style, NOT identity field)
- ❌ cursorPointer identity field (DF-2)
- ❌ Closed Shadow DOM traversal

### Classification
- ✅ 14 component definitions with priority-ordered discovery
- ✅ Component Runtime with activeStack, dedup, stale cleanup (15s)
- ✅ lifecycleOwnsTarget (W3C semantic child roles + surface containment)
- ✅ isDuplicate (per-type, same element, ≤2000ms gap)
- ✅ Unclassified fallback for unmatched discrete events
- ❌ Autocomplete component (DF-3)
- ❌ Stepper component (DF scope)
- ❌ Drag-drop component (DF scope)

### Evidence
- ✅ Value transitions (before/after)
- ✅ Checked state transitions (before/after)
- ✅ Pointer coordinates (clientX/Y)
- ✅ Keyboard input (key, code, modifiers)
- ✅ Scroll deltas
- ✅ DOM Context (inputType, ARIA states, ancestor info, range values)
- ✅ Element State Snapshots (9 properties, before→after via 3s observation window)
- ✅ DOM Mutations (childList, attributes, characterData, with old/new values)
- ✅ Performance conditions (batch duration > 15ms flag)
- ✅ Semantic effects (7 interpretation rules)
- ❌ Pointer movement trails (DF-1)
- ❌ Network request evidence
- ❌ Console log evidence
- ❌ Screenshots/video

### Observation
- ✅ 3-second observation windows for click and change events ONLY
- ✅ Before-state capture via ElementStateCache (mousedown+focus capture-phase pre-population)
- ✅ After-state capture via cache.read() (non-mutating)
- ✅ MutationObserver on document.body (childList, attributes, characterData, subtree)
- ✅ Refcounted observer lifecycle (concurrent windows share observer)
- ✅ Element-removed detection (document.contains)
- ✅ Recording-stopped window finalization
- ✅ Independent concurrent windows with shared mutation attribution
- ❌ Observation windows for non-click/change events (DF-1: OBSERVATION_ELIGIBLE_EVENT_TYPES)

### Capabilities
- ✅ 12 capability inference rules (post-recording)
- ✅ CapabilityRecord output with evidence linkage
- ✅ EffectsMap built from finalized interactions + semantic effects

### Projection
- ✅ Pure projection function (completed + Unclassified for unclaimed/pending)
- ✅ Evidence ledger with pending→absorbed→claimed/unclaimed lifecycle
- ✅ resetAbsorbedToUnclaimed on MV3 recovery
- ✅ M4 Verification Mode (shadow comparison: runtime output vs projection)

### Generation
- ✅ IR Bridge (15 InteractionTypes → IRActions)
- ✅ Locator ranking (5-tier hierarchy)
- ✅ PlaywrightCodeGenerator (flat + page-object patterns)
- ✅ Workflow Normalizer (subsumed Unclassified removal)
- ✅ Production filtering (no-op/abandoned/incidental removal)

### Persistence
- ✅ chrome.storage.local (16+ keys)
- ✅ sessionStorage buffers (event + behavioral, bounded)
- ✅ IndexedDB via Dexie (Repository V2, 9 tables)
- ✅ Session persistence service (atomic UnitOfWork transaction)
- ✅ MV3 recovery (restoreFromStorage)
- ✅ Durable observation key cleanup (3 Safe Points)

### Side Panel
- ✅ 4 views (home, new-tc, recording, stopped)
- ✅ Live timeline during recording
- ✅ Behavioral evidence display (collapsible, before→after, mutations, effects)
- ✅ Three-layer display (type + componentType + businessMeaning)
- ✅ IR step rendering
- ✅ Generated file rendering
- ✅ Capability record display
- ✅ Healing summary display
- ✅ Content script health indicator
- ❌ Render debouncing
- ❌ DOM node caps
- ❌ Incremental updates (full reload on every message)

### Repository / Healing
- ✅ Repository V2 (Dexie/IndexedDB, 9 aggregate tables)
- ✅ Element matching service
- ✅ Capability matching service
- ✅ Locator healing (recording-time + execution-time)
- ✅ Source artifact tracking
- ✅ Recording session persistence

### Navigation
- ✅ SPA navigation capture (pushState, replaceState, popstate, hashchange)
- ✅ chrome.webNavigation.onCommitted listener (full page loads)
- ✅ Navigation flushes active component stack
- ✅ Synthetic navigation ObservedEvent processing

### Shadow DOM
- ✅ composedPath() traversal for target resolution
- ✅ Shadow DOM detection (getRootNode instanceof ShadowRoot)
- ✅ Open shadow root traversal (deepGetElementById, deepQuerySelector)
- ❌ Closed shadow root traversal

### iframe Handling
- ✅ Iframe detection (window !== window.top)
- ✅ Same-origin parent iframe element resolution
- ✅ IframeContext: frameSelector, frameXPath, frameIndex, frameDepth
- ❌ Cross-origin iframe inspection

---

## 17. DEFF878 — AUTHORITATIVE BASELINE CONTRACT

### What the Extension CAN Do

1. **Capture** 12 DOM event types + SPA navigation on any page, with trusted-event filtering and rate-limiting for high-frequency events.
2. **Identify** the target element of any trusted event using 4-strategy resolution, producing an 18-field identity with accessibleName, ARIA roles, test attributes, CSS/XPath selectors, Shadow DOM and iframe awareness.
3. **Classify** user actions into 14 interaction types via priority-ordered component definitions, with deduplication, stale-lifecycle cleanup, and an Unclassified fallback.
4. **Observe** behavioral effects for click and change events: captures before/after element state (9 properties) and all DOM mutations within a 3-second window.
5. **Interpret** behavioral evidence into semantic effects via 7 rules (state toggle, expand/collapse, enable/disable, content change, visibility change, no-observable-effect, unclassified) with HIGH/MEDIUM/LOW confidence.
6. **Project** a complete interaction list ensuring every discrete user action is represented, using the Evidence Ledger's disposition system.
7. **Infer** 12 capability types from finalized interactions and their semantic effects.
8. **Generate** complete, production-ready Playwright test projects (flat or page-object pattern) with ranked locators.
9. **Execute** generated tests via the IR Executor, with runtime locator healing on failure.
10. **Persist** everything to IndexedDB via Repository V2 with atomic transactions, and recover gracefully from MV3 service worker termination.
11. **Display** live recording progress with three-layer interaction enrichment, behavioral evidence, IR steps, generated files, capabilities, and healing summaries.

### What the Extension CANNOT Do

1. **Cannot capture pointer events** (pointermove, pointerdown, pointerup) — zero touch/pointer tracking.
2. **Cannot capture touch events** (touchstart, touchmove, touchend) — no mobile/touch support.
3. **Cannot observe behavioral effects for non-click/change events** — mousedown, keydown, input, focus, blur do NOT open observation windows. ~70%+ of classified interactions have zero behavioral evidence.
4. **Cannot store cursorPointer as an identity field** — cursor:pointer is only a clickable heuristic, not persisted.
5. **Cannot bound memory usage** — liveInteractions[], evidenceLedger, obs_* keys, and side panel DOM all grow unbounded during recording.
6. **Cannot debounce side panel updates** — every interaction triggers immediate full reload + full re-render.
7. **Cannot traverse closed Shadow DOM** — only open shadow roots.
8. **Cannot inspect cross-origin iframes** — same-origin only.
9. **Cannot capture network requests, console logs, screenshots, or video.**
10. **Cannot handle autocomplete, stepper, drag-drop, switch-tab, or network-tap components** — not yet defined.

### What Data It Captures
- 12 DOM event types per interaction, with full ElementIdentity (18 fields), DOM context (10+ fields), value/checked transitions, pointer coordinates, keyboard input, scroll deltas, and page context.
- Before/after element state (9 properties) and DOM mutations (with old/new values) for click/change events during 3-second observation windows.
- Semantic effects (interpreted), capability records (inferred), evidence ledger dispositions.

### What It Classifies
- 14 interaction types: DatePicker, ColorInput, Dropdown, Slider, Checkbox, FileUpload, RadioButton, TextEntry, Hover, Tab, Link, Scroll, Navigation, Click.
- Unclassified fallback for unmatched discrete events.
- Component type enrichment (DataGrid, IconButton, SortButton, etc.) via regex pattern matching.

### What It Observes
- Click and change events ONLY, within 3-second windows.
- 9 element state properties (value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount).
- DOM mutations: childList additions/removals, attribute changes, characterData changes.

### What It Outputs
- Production-filtered interaction list (no-ops, abandoned, incidental removed).
- ExecutionIRPlan with ranked locators.
- Complete Playwright test project (package.json, config, spec file, optional page objects).
- CapabilityRecord[] with 12 inference types.

### What It Persists
- chrome.storage.local: liveInteractions, runtimeSnapshot, evidenceLedger, recordingActive, sessionContext, obs_* per observation, IR plan, generated files, UI state, capability records.
- sessionStorage: event buffer (max 500), behavioral buffer (max 200).
- IndexedDB: 9 aggregate tables (projects, elements, testCases, testCaseVersions, sourceArtifacts, executionIRs, capabilities, recordingSessions, executionRuns).

### Risks That Exist
1. **Unbounded memory growth** in liveInteractions[], evidenceLedger, and obs_* keys during long recording sessions.
2. **Per-event storage writes** (3+ chrome.storage.local.set per event) with no batching or debouncing — can overwhelm MV3 SW under high event rates.
3. **Full side panel re-render** on every interaction emission — DOM grows linearly, no virtualization.
4. **No observation evidence for ~70%+ of interactions** — only click and change open windows, leaving most classified interactions with zero behavioral evidence.
5. **MV3 SW termination risk** — the alarms-based health check (every ~5s) mitigates but the high-frequency storage writes increase SW CPU usage and eviction probability.

---

## 18. DF-1 READINESS

**DF-1 (commit c1fe56e)** changes 5 files (+158/-12 lines):

1. **`src/shared/component-types.ts`** (+14): Adds `OBSERVATION_ELIGIBLE_EVENT_TYPES` — a Set of 16 event types that replaces the click+change-only condition. Also expands `TRANSIENT_EVENT_TYPES` to include `pointermove` and `touchmove`.

2. **`src/shared/observation-types.ts`** (+24): Adds fields to support new event types in observation windows.

3. **`src/tap/element-state-cache.ts`** (+42): Expands cached properties to support new observable state from expanded event types.

4. **`src/tap/event-tap.ts`** (+29): Adds new event types to the listener registration array and adjusts the observation trigger condition.

5. **`src/enrichment/component-types.ts`** (if separate): Additional type changes for enrichment compatibility.

**The core DF-1 change:** The hardcoded `if (event.eventType === 'click' || event.eventType === 'change')` condition in recorder-entry.ts's `onAfterEvent` callback is replaced with a check against `OBSERVATION_ELIGIBLE_EVENT_TYPES`, dramatically expanding which events open behavioral observation windows.

**Comment in DF-1 source:** "fixes 70%+ of classified interactions having zero behavioral evidence."

**Baseline readiness:** deff878 is clean, stable (2,578 tests passing), and has no DF code. All 5 files DF-1 touches exist at deff878 in their pre-DF form. The extension builds successfully and the ZIP is verified clean.
