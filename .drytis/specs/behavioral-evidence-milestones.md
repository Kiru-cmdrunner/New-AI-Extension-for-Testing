# Behavioral Evidence Model v3.0 — Milestone Plan

**Spec**: `.drytis/specs/behavioral-evidence-model.md` v3.0
**Baseline**: `3bc28f6` on `capability-surgical-removal`
**Date**: 2026-08-11
**Status**: PLANNING — no implementation yet.

---

## Design Principles for Milestones

1. **Each milestone compiles, passes all tests, and builds a working ZIP.** No milestone leaves the project in a broken state.
2. **Each milestone is installable in Chrome.** The extension works at every checkpoint — previous functionality is never broken.
3. **Each milestone has observable behavior** that can be validated by installing the extension and interacting with a web page (even if the observation is via DevTools console in early milestones).
4. **Dependencies flow forward only.** No milestone depends on a later milestone.

---

## Dependency Graph

```
M1 (Foundation: Types + EventTap hooks + identity)
│
├──► M2 (TargetEvidence: State cache + capture-phase listeners)
│
├──► M3 (ApplicationEvidence: DOMObserver + AdaptiveWindow)
│      │
│      └──► M5 (Shadow DOM extension to DOMObserver)
│
├──► M6 (Network Evidence: MAIN-world inject + webRequest parallel)
│
└──► M4 (EvidenceCollector: end-to-end lifecycle)
       │
       │  (M4 depends on M1 + M2 + M3)
       │
       └──► M7 (Side Panel Display: renderer + live updates)
              │
              └──► M8 (Persistence + Hardening: Dexie V4 + caps + concurrency)
```

**Build order**: M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
(M5 and M6 are independent of each other and can be done in either order after M4. M7 requires M4. M8 requires M7.)

---

## Milestone 1 — Foundation: Types + EventTap Hooks + Identity

### What Is Being Built

The type system that everything else imports from, plus the three small modifications to existing files that create hook points for later milestones.

| File | Action | Detail |
|------|--------|--------|
| `src/shared/behavioral-evidence-types.ts` | **NEW** | All type definitions from spec §3: BehavioralEvidence, EvidenceWindow, StabilitySample, TargetEvidence, TargetStateSnapshot, FocusMovement, ApplicationEvidence, DomChangeSummary, SurfaceChange, VisibilityChange, NavigationEvidence, NetworkActivity, PerformanceCondition |
| `src/shared/types.ts` | **MODIFY** | (1) Add `inputType: string \| null` to `RawElementIdentity` (spec §8.2). (2) Add `BEHAVIORAL_EVIDENCE` and `INTERACTION_EVIDENCE_UPDATE` to `AppMessage` union (spec §12.2) |
| `src/shared/component-types.ts` | **MODIFY** | Remove orphaned M1 comment block (lines ~440-448). Add `behavioralEvidence?: BehavioralEvidence` field to `ComponentInteraction` (spec §9.3, §12.1) |
| `src/tap/identity-extractor.ts` | **MODIFY** | Add `inputType` population in `extractIdentity()` — one line using existing `el.type` access (spec §8.2) |
| `src/tap/event-tap.ts` | **MODIFY** | (1) Add `config.onAfterEvent(...)` call at end of `emitSpaNavigation()` (spec §7.2). (2) Add `navType` field to navigation ObservedEvent — distinguishes pushState/replaceState/popstate/hashchange (spec §7.3) |

### What Is NOT Being Built

- No TargetStateCache, DOMObserver, AdaptiveWindow, EvidenceCollector, or any capture logic
- No `onAfterEvent` wiring in recorder-entry.ts (the hook fires but nothing listens yet)
- No `'submit'` event type addition to EventTap (optional per spec §4.1 — deferred to M4 where it's needed)
- No side panel changes, no Dexie changes, no SW handler

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/tap/identity-inputType.test.ts` | `extractIdentity()` returns correct `inputType` for input (checkbox, radio, text, email, etc.), select, textarea, and non-input elements (null) |
| `tests/tap/event-tap-navigation-onAfterEvent.test.ts` | `emitSpaNavigation()` fires `onAfterEvent` with eventId, eventType='navigation', correct navType for each trigger (pushState, replaceState, popstate, hashchange) |
| `tests/shared/behavioral-evidence-types.test.ts` | Type-level compilation check — ensure all interfaces compile and export correctly |

Also: every existing test that constructs mock `ElementIdentity` objects must add the `inputType` field. This is mechanical — grep for `accessibleName` in test files to find all mock builders.

### Expected Observable Behavior

Install the extension, open DevTools console, start recording on any SPA page:
- Navigate within the SPA (click a link that triggers `pushState`)
- Console shows `onAfterEvent` firing with `eventType: 'navigation'` and `navType: 'pushState'`
- All existing recording/classification/generation continues to work identically
- No new errors in console

**Regression check**: Record a session, generate Playwright code — output must be identical to pre-M1 behavior.

### Dependencies

None — this is the foundation milestone.

---

## Milestone 2 — TargetEvidence: State Cache + Capture-Phase Listeners

### What Is Being Built

The ability to capture before/after element state snapshots for any interacted element.

| File | Action | Detail |
|------|--------|--------|
| `src/tap/target-state-cache.ts` | **NEW** | `TargetStateCache` class: WeakMap-based cache storing `TargetStateSnapshot` (9 properties: value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount + capturedAt). Methods: `capture(el)`, `peek(el)`, `read(el)` (spec §3.3) |
| `src/tap/target-state-listeners.ts` | **NEW** | Two capture-phase event listeners (`mousedown`, `focus`) that pre-populate TargetStateCache BEFORE the browser applies state changes. Uses `addEventListener(..., { capture: true })` (spec §3.3, §4.2 step 2) |
| `src/recorder/phase5/recorder-entry.ts` | **MODIFY** | Create `TargetStateCache` instance. Register/unregister capture-phase listeners on recording start/stop. Expose cache for EvidenceCollector (M4) to consume |

### What Is NOT Being Built

- No `onAfterEvent` wiring (EvidenceCollector doesn't exist yet — M4)
- No observation windows, no mutation tracking
- No evidence delivery to service worker
- State snapshots are captured and cached but not yet consumed or sent anywhere

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/tap/target-state-cache.test.ts` | All 9 TargetStateSnapshot properties captured correctly; null handling for value/checked/ariaExpanded/ariaChecked/ariaPressed; WeakMap lifecycle (GC'd entries); `peek` vs `read` vs `capture` semantics; capturedAt uses performance.now() |
| `tests/tap/target-state-listeners.test.ts` | mousedown listener captures state before click handler runs; focus listener captures state before focus handler runs; capture: true phase ordering; listener registration/unregistration |

### Expected Observable Behavior

Install the extension, start recording. With DevTools console, after interacting with elements:
- Add a temporary `console.log` in recorder-entry (or use DevTools breakpoints) to inspect `TargetStateCache`
- Click a checkbox: `peek(el)` returns `{ checked: false, ... }` (before state)
- Click a disabled button: `peek(el)` returns `{ disabled: true, ... }`
- Click a button with `aria-expanded="false"`: `peek(el)` returns `{ ariaExpanded: false, ... }`
- Focus a text input: `peek(el)` returns `{ value: '', ... }` before typing

All existing recording/classification/generation continues to work identically.

### Dependencies

- **M1** — requires `TargetStateSnapshot` type from behavioral-evidence-types.ts

---

## Milestone 3 — ApplicationEvidence (Light DOM): DOMObserver + AdaptiveWindow

### What Is Being Built

The ability to observe DOM mutations on the main document with summarization, shared batch indexing, and adaptive stabilization timing.

| File | Action | Detail |
|------|--------|--------|
| `src/tap/dom-observer.ts` | **NEW** | `DOMObserver` class: refcounted singleton MutationObserver on document.body (childList + attributes + characterData + subtree + attributeOldValue + characterDataOldValue). Shared `globalBatchCounter`. Mutation summarization pipeline: filter → summarize (group by targetPath) → cap (keep first 200). `start()`, `stop()`, `processMutations()` for active windows (spec §5) |
| `src/tap/adaptive-window.ts` | **NEW** | `AdaptiveWindow` class: setTimeout-based stabilization (minQuiescence=300ms, maxDuration=10000ms, minDuration=50ms). Stability trace collection (max 50 samples, circular buffer). `arm()`, `reset()`, `close()`. Emits `EvidenceWindow` with endReason + stabilityTrace (spec §4.3) |

### What Is NOT Being Built

- No Shadow DOM traversal (M5)
- No EvidenceCollector integration (M4)
- No network observation (M6)
- No connection to EventTap events — DOMObserver and AdaptiveWindow are standalone, tested in isolation

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/tap/dom-observer.test.ts` | Refcounting (start/stop counter); mutation grouping by targetPath; attribute delta tracking (old/new values); childList added/removed node counting; characterData delta; globalBatchCounter increments once per callback and is shared across windows; noise filtering (CSS animation exclusions, virtual scroll row exclusions); 200-entry keep-first cap + overflow count + coarseMode flag |
| `tests/tap/adaptive-window.test.ts` | Stabilization timer arms/reset on mutations; max-duration hard cap closes window; min-duration prevents premature close; endReason values (stabilized, max-duration, recording-stopped, displaced); stabilityTrace samples pushed at each timer fire + each mutation batch; circular buffer caps at 50 |
| `tests/tap/dom-change-cap.test.ts` | 200-entry keep-first behavior specifically; domChangeOverflow count matches dropped entries; coarseMode set to true at cap; newSurfaces/removedSurfaces/visibilityChanges still tracked when domChanges capped |

### Expected Observable Behavior

Install the extension, start recording. With a temporary debug hook (console.log in DOMObserver callback):
- Click a button that toggles a class: console shows one `DomChangeSummary` with `changedAttributes: ['class']` and the attribute delta
- Click a button that opens a dialog: console shows `addedNodesCount: 1` for the dialog container
- Rapidly click causing many mutations: after 200 summaries, `coarseMode` becomes true and `domChangeOverflow > 0`
- The `globalBatchCounter` increments by 1 for each MutationObserver callback (even when multiple windows are active — verifiable if a second click creates an overlapping window)

All existing recording continues to work.

### Dependencies

- **M1** — requires `DomChangeSummary`, `EvidenceWindow`, `StabilitySample`, `PerformanceCondition` types

---

## Milestone 4 — EvidenceCollector: End-to-End Capture Pipeline

### What Is Being Built

The orchestrator that ties together TargetStateCache (M2), DOMObserver + AdaptiveWindow (M3), and EventTap hooks (M1) into a complete evidence lifecycle. This is where the first complete `BehavioralEvidence` objects are produced and delivered to the service worker.

| File | Action | Detail |
|------|--------|--------|
| `src/tap/evidence-collector.ts` | **NEW** | `EvidenceCollector` class: the central orchestrator. `onAfterEvent(el, eventId, eventType, cssSelector)` entry point (wired from EventTap). Opens/closes evidence windows per the event-trigger matrix (spec §4.1). Peek TargetStateCache for before snapshot; capture after snapshot at close. Collect mutations from DOMObserver. Collect navigation events from EventTap onAfterEvent. Build BehavioralEvidence. Deliver to SW via `chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EVIDENCE', payload })`. Typing (extend-on-input) strategy. Scroll (throttled 1/500ms) strategy. Max 5 concurrent windows with displacement. Evidence buffer in sessionStorage for SW restart recovery (spec §9) |
| `src/recorder/phase5/recorder-entry.ts` | **MODIFY** | Wire `onAfterEvent` into `createEventTap` call (currently only `{ onEvent }` — spec §4.2). Create EvidenceCollector instance. Wire EvidenceCollector to TargetStateCache + DOMObserver + AdaptiveWindow. Add `flushPendingEvidence()` on recording start. Add evidence buffer (sessionStorage key `cmdrunner_evidence_buffer`, max 50) + flush on pagehide |
| `src/background/service-worker.ts` | **MODIFY** | Add `pendingEvidence: Map<string, BehavioralEvidence>`. Add `case 'BEHAVIORAL_EVIDENCE'` handler: store in pendingEvidence, match to liveInteractions, attach, cap at 100. Broadcast `INTERACTION_EVIDENCE_UPDATE` to side panel. (spec §9.2, §12.3) |
| `src/tap/event-tap.ts` | **MODIFY** | Add `'submit'` to eventTypes array (optional per spec §4.1, but needed here for form-submit evidence) |

### What Is NOT Being Built

- No Shadow DOM in DOMObserver (M5)
- No network evidence (M6) — `applicationEvidence.networkActivity` is always `[]`
- No side panel rendering (M7) — evidence is in SW memory but not displayed
- No Dexie persistence (M8) — evidence is in-memory only

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/tap/evidence-collector.test.ts` | Full lifecycle: click → open window → mutations → close → BehavioralEvidence assembled correctly; event-trigger matrix (click/mousedown/contextmenu/input/change/keydown-Enter/focus/blur trigger windows; mouseenter/mouseleave/mousemove ignored); extend-on-input typing (one window per typing session, not per keystroke); scroll throttle (max 1 window per 500ms); max 5 concurrent windows with displacement endReason; sessionStorage buffer on pagehide; flushPendingEvidence on recording start |

### Expected Observable Behavior

This is the first milestone with truly end-to-end evidence:

Install the extension, start recording, interact with a page:

1. **Click a checkbox**: Side panel shows the interaction. In DevTools (service worker DevTools), `pendingEvidence` Map has an entry keyed by the event ID. The `BehavioralEvidence` object has:
   - `targetEvidence.before.checked = false`, `targetEvidence.after.checked = true`
   - `applicationEvidence.domChanges` with class attribute delta
   - `window.endReason = 'stabilized'`, `window.durationMs ≈ 300`

2. **Type in a search field**: One `BehavioralEvidence` (not one per keystroke). `targetEvidence.before.value = ''`, `after.value = 'laptop'`. `window.endReason = 'typing-complete'`.

3. **Click a button on an SPA**: Navigate via pushState → window closes with `endReason = 'navigation'`. `applicationEvidence.navigation` has one entry with `type = 'pushState'`.

4. **Click 6 buttons rapidly**: 6th click forces oldest window closed with `endReason = 'displaced'`.

All existing recording, classification, and Playwright generation continues to work identically.

### Dependencies

- **M1** — types, EventTap hooks, inputType
- **M2** — TargetStateCache + listeners
- **M3** — DOMObserver + AdaptiveWindow

---

## Milestone 5 — Shadow DOM Recursive Observation

### What Is Being Built

Extending DOMObserver to recursively enter shadow roots and capture mutations inside shadow DOM boundaries.

| File | Action | Detail |
|------|--------|--------|
| `src/tap/dom-observer.ts` | **MODIFY** | Add recursive shadow DOM traversal: scan `querySelectorAll('*')` for `element.shadowRoot`, attach nested MutationObserver to each discovered shadow root, track `shadowContext` path. Re-scan on childList mutations (detect newly added shadow hosts). Cap at 20 shadow roots. Shared refcounting. (spec §5.1) |

### What Is NOT Being Built

- No closed shadow root support (fundamental limitation — documented)
- No network evidence (M6)
- No side panel rendering (M7)

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/tap/dom-observer-shadow-dom.test.ts` | Mutations inside open shadow root captured with non-null `shadowContext`; recursive (shadow root inside shadow root); max 20 shadow roots cap with performanceCondition warning; closed shadow roots produce no mutations (documented limitation); dynamically added shadow hosts discovered via childList mutation re-scan |

### Expected Observable Behavior

Install the extension, navigate to a page with Shadow DOM components (e.g., a site using Web Components or Lit Elements), start recording:

1. Click a button inside a shadow root: DevTools shows `DomChangeSummary` with `shadowContext = 'my-component'` (CSS path to the shadow host)
2. Click a button inside a nested shadow root (shadow root within shadow root): `shadowContext = 'outer-component > inner-component'`
3. A component that dynamically attaches a shadow root after the click: the new shadow root is discovered and observed

All existing behavior unchanged.

### Dependencies

- **M3** — DOMObserver (extends the light-DOM observer)
- **M4** — EvidenceCollector (delivers shadow DOM evidence through the pipeline)

---

## Milestone 6 — Network Evidence: MAIN-World Injection + webRequest Parallel

### What Is Being Built

Dual-source network interception: MAIN-world fetch/XHR monkeypatch (dynamic injection) for rich metadata, and SW-side `chrome.webRequest` for race-condition coverage.

| File | Action | Detail |
|------|--------|--------|
| `src/tap/network-inject.ts` | **NEW** | Standalone MAIN-world script. Patches `window.fetch` and `XMLHttpRequest.prototype.open/send`. Captures url, method, status, timing. Posts `CustomEvent('cmdrunner-net', { detail })` to window. Posts `CustomEvent('cmdrunner-net-ready')` on injection. Restores originals on stop. Must be a **standalone bundle** with no imports from extension source tree (spec §6.2) |
| `src/tap/network-bridge.ts` | **NEW** | ISOLATED-world listener for `'cmdrunner-net'` CustomEvents. Buffers NetworkActivity entries. Receives `'cmdrunner-net-ready'` to confirm MAIN-world is active. If not received within 500ms, switches to webRequest-only mode (spec §6) |
| `src/background/network-observation.ts` | **NEW** | SW-side `chrome.webRequest.onBeforeRequest` + `onCompleted` listener management. Registers/unregisters on recording start/stop. Orchestrates dynamic `chrome.scripting.executeScript({ world: 'MAIN', injectImmediately: true })`. Deduplication logic: prefers 'main-world' source, keeps 'webrequest' if only source (spec §6.3) |
| `src/background/service-worker.ts` | **MODIFY** | Call `startNetworkObservation(tabId)` in `handleStartRecording()`. Call `stopNetworkObservation(tabId)` in `handleStopRecording()`. Wire network activity from both sources into EvidenceCollector's window-close collection (spec §6) |
| `src/manifest.json` | **MODIFY** | Add `"webRequest"` to permissions array (spec §6.7) |
| `vite.config.ts` or build script | **MODIFY** | Add `network-inject.js` as a separate standalone build target (esbuild or separate Vite entry) that emits to `dist/assets/network-inject.js`. Must NOT bundle with the extension's source tree — runs in page's MAIN world (spec §6.2) |

### What Is NOT Being Built

- No request/response body capture (privacy — never captured)
- No WebSocket or EventSource monitoring
- No side panel rendering (M7)

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/tap/network-interceptor.test.ts` | fetch monkeypatch intercepts calls and dispatches CustomEvent with url/method/timestamp/phase; XHR open/send monkeypatch same; restoral of originals on stop; CustomEvent detail format correct |
| `tests/tap/network-bridge.test.ts` | CustomEvent listener receives and buffers correctly; ready signal detection switches mode; buffer management within time range; deduplication logic (same URL+method+approx-timestamp → keep main-world) |
| `tests/background/network-observation.test.ts` | webRequest listeners register/unregister; executeScript called with correct params (world:MAIN, injectImmediately, allFrames); deduplication prefers main-world source; error handling when injection fails |

### Expected Observable Behavior

Install the extension, navigate to a page with AJAX calls (e.g., a search page with autocomplete), start recording:

1. **Search-as-you-type**: Type in a search field. After recording stops, `BehavioralEvidence` for the typing interaction has `applicationEvidence.networkActivity` with entries:
   - `{ url: '/api/search?q=l', method: 'GET', status: 200, source: 'main-world', startRelativeToEvent: 45, ... }`
   - `{ url: '/api/search?q=la', method: 'GET', status: 200, source: 'main-world', ... }`

2. **Button click triggers API call**: Click a "Load More" button. `networkActivity` has the API call with timing relative to the click.

3. **Race coverage**: If the page makes a network call immediately on load (before MAIN-world injection completes), the `webrequest` source captures it.

4. **Stop recording**: MAIN-world patches are restored. webRequest listeners removed. No lingering interception.

All existing recording and generation continues to work.

### Dependencies

- **M1** — `NetworkActivity` type, `BEHAVIORAL_EVIDENCE` message type
- **M4** — EvidenceCollector (integrates network evidence into window-close collection)

---

## Milestone 7 — Side Panel Display: Evidence Rendering + Live Updates

### What Is Being Built

The visual representation of behavioral evidence in the side panel, with real-time updates as evidence arrives.

| File | Action | Detail |
|------|--------|--------|
| `src/sidepanel/evidence-renderer.ts` | **NEW** | Pure rendering module. `renderTargetEvidence(evidence)`: identity summary, before→after state diffs (value, checked, ariaExpanded, className, disabled), focus movement. `renderApplicationEvidence(evidence)`: summarized DOM changes (target path, mutation types, attribute deltas, timing), new/removed surfaces, visibility changes, navigation events, network activity (url, method, status, timing), performance condition badge. XSS escaping on all user-visible strings (spec §12.4) |
| `src/sidepanel/interaction-renderer.ts` | **MODIFY** | Import and call `evidence-renderer` for each interaction that has `behavioralEvidence`. Render two collapsible sections under each interaction: "Target" and "Application" |
| `src/sidepanel/sidepanel.ts` | **MODIFY** | Add `INTERACTION_EVIDENCE_UPDATE` message handler: overlay fresh evidence onto matching interaction in the DOM. Remove dead behavioral HTML elements from the old system if any remain (spec §12.4) |
| `src/sidepanel/index.html` | **MODIFY** | Clean dead behavioral HTML/CSS elements (e.g., `capability-records-section`). Add evidence display container placeholder |

### What Is NOT Being Built

- No Dexie persistence (M8)
- No repository page integration
- No assertion generation or IR integration

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/sidepanel/evidence-renderer.test.ts` | Renders TargetEvidence (all 9 state properties with before→after diff); renders ApplicationEvidence (domChanges, surfaces, visibility, navigation, network); XSS escaping on accessibleName, className, textContent; null/empty evidence handled gracefully; HTML structure is valid |

### Expected Observable Behavior

Install the extension, open the side panel, start recording:

1. **Click a checkbox**: Side panel shows the interaction immediately (as before), then ~300ms later the evidence sections appear:
   - **Target**: checkbox identity (role, name, testId), `checked: false → true`
   - **Application**: 1 DOM change (`class` attribute delta), `endReason: stabilized`, `durationMs: 312`

2. **Type in a search field**: After typing stops (~300ms after last keystroke):
   - **Target**: input identity, `value: "" → "laptop"`, focus before/after
   - **Application**: any DOM changes from autocomplete suggestions, any network activity from search calls (if M6 is done)

3. **Click a button that opens a modal**:
   - **Target**: button identity, `ariaExpanded: false → true`
   - **Application**: new surface detected (modal container path + descendant count)

4. **Live updates**: Evidence appears in the side panel within ~500ms of the interaction, without needing to stop recording. The `INTERACTION_EVIDENCE_UPDATE` message triggers an overlay update.

All existing side panel functionality (interaction list, recording state, code generation) continues to work.

### Dependencies

- **M4** — EvidenceCollector producing BehavioralEvidence objects
- **M1** — INTERACTION_EVIDENCE_UPDATE message type
- **M5** (recommended but not required) — Shadow DOM evidence makes the display more useful
- **M6** (recommended but not required) — Network evidence makes the display richer

---

## Milestone 8 — Persistence + Production Hardening

### What Is Being Built

Dexie V4 schema for long-term evidence storage, session-persistence wiring, and all production hardening: final cap enforcement, concurrency limits, performance budgets.

| File | Action | Detail |
|------|--------|--------|
| `src/repository/v2/dexie/dexie-database.ts` | **MODIFY** | Add `this.version(4).stores({ ...all V1-V3 stores, behavioral_evidence: '++id, interactionEventId, sessionId' })` (spec §12.6) |
| `src/repository/v2/interfaces/behavioral-evidence-repository.ts` | **NEW** | Interface for evidence CRUD: `getByInteractionEventId(eventId)`, `getBySessionId(sessionId)`, `add(evidence)`, `addMany(evidence[])` |
| `src/repository/v2/dexie/dexie-behavioral-evidence-repository.ts` | **NEW** | Dexie implementation of the interface |
| `src/repository/v2/repository-set.ts` or equivalent | **MODIFY** | Register the new repository |
| `src/repository/services/session-persistence-service.ts` | **MODIFY** | At `persistSession`: for each interaction with behavioralEvidence, insert into `behavioral_evidence` table. Strip `behavioralEvidence` from interaction before serialization (avoid duplication). Flush `pendingEvidence` Map. (spec §12.6) |
| `src/background/service-worker.ts` | **MODIFY** | Final cap enforcement: `pendingEvidence` max 100 (drop oldest). Evidence buffer management cleanup at session end |
| `src/tap/evidence-collector.ts` | **MODIFY** | Final cap enforcement: all per-window caps (domChanges 200, surfaces 30, visibility 50, network 50, stabilityTrace 50, navigation 10), max 5 concurrent windows, performance condition measurement (15ms main-thread budget) |
| `src/tap/dom-observer.ts` | **MODIFY** | Final performance budget: MutationObserver callback time measurement (15ms threshold → performanceCondition.mainThreadBlocked) |

### What Is NOT Being Built

- No evidence query UI on the repository page (future work)
- No cross-session analysis tools (future work)
- No IR Bridge consumption of evidence (future correlation layer)

### Tests Required

| Test File | What It Covers |
|-----------|---------------|
| `tests/repository/behavioral-evidence-repository.test.ts` | V4 schema migration from V3; insert/query by interactionEventId; query by sessionId; addMany bulk insert; evidence survives Dexie transaction; interaction behavioralEvidence stripped before serialization |
| `tests/tap/evidence-collector-caps.test.ts` | domChanges cap at 200 (keep-first); surfaces cap at 30; network cap at 50; pendingEvidence cap at 100; max 5 concurrent windows; performance condition thresholds (mainThreadBlocked at 15ms, highChurnMode at 200-cap) |
| `tests/repository/session-persistence-evidence.test.ts` | Full session: record → stop → persistSession → evidence rows in behavioral_evidence table with correct interactionEventId + sessionId FKs; interaction records do NOT contain inline evidence; query retrieves evidence by interactionEventId |

### Expected Observable Behavior

Install the extension, record a full session:

1. **Record and stop**: Session saves to Repository V2. Each interaction that had evidence now has a corresponding row in the `behavioral_evidence` Dexie table.

2. **Re-open the repository**: Query Dexie (via DevTools console or repository page if integrated):
   ```js
   const db = await indexedDB.open('CmdRunnerDatabase');
   // behavioral_evidence object store exists with evidence rows
   ```

3. **High-churn page test**: Record on a page with heavy DOM activity (e.g., infinite scroll, animation-heavy dashboard):
   - No memory crash (bounded arrays, all caps enforced)
   - `performanceCondition.mainThreadBlocked = true` if batches exceed 15ms
   - `performanceCondition.highChurnMode = true` if domChanges hits 200 cap
   - Surfaces, navigation, and network still captured even in coarse mode

4. **Long recording session**: Record 50+ interactions:
   - `pendingEvidence` never exceeds 100 (oldest dropped)
   - No memory growth beyond bounded limits
   - All evidence correctly persisted at stop

5. **SW restart**: During a recording session, manually restart the service worker (chrome://serviceworker-internals):
   - Buffered evidence in sessionStorage is flushed to SW on next interaction
   - No evidence lost

All existing functionality (classification, generation, healing, execution) continues to work.

### Dependencies

- **M7** — Side panel display (evidence visible during recording before persistence)
- **M4** — EvidenceCollector (caps enforcement is on the collector)
- **M5** (recommended) — Shadow DOM evidence persisted
- **M6** (recommended) — Network evidence persisted

---

## Milestone Summary Matrix

| Milestone | Title | New Files | Modified Files | Unit Tests | Observable Behavior |
|-----------|-------|-----------|----------------|------------|---------------------|
| **M1** | Foundation | 1 | 5 | 3 files | EventTap fires `onAfterEvent` for nav events; `inputType` in identity |
| **M2** | TargetEvidence | 2 | 1 | 2 files | Before/after element state snapshots in cache |
| **M3** | ApplicationEvidence (Light DOM) | 2 | 0 | 3 files | Summarized DOM mutations with batch index + timing |
| **M4** | EvidenceCollector (E2E) | 1 | 3 | 1 file | Complete BehavioralEvidence per interaction, delivered to SW |
| **M5** | Shadow DOM | 0 | 1 | 1 file | Mutations inside shadow roots captured |
| **M6** | Network Evidence | 3 | 3 | 3 files | Network activity (url/method/status/timing) in evidence |
| **M7** | Side Panel Display | 1 | 3 | 1 file | Evidence visible in side panel in real time |
| **M8** | Persistence + Hardening | 2 | 5 | 3 files | Evidence persists to Dexie; all caps enforced; no memory growth |

**Totals**: 12 new files, ~21 file modifications, 17 test files, 8 checkpoints.

---

## Validation Checkpoints

After each milestone, the following checks must pass before proceeding:

1. **tsc --noEmit** — 0 errors
2. **vitest** — all tests pass (existing + new)
3. **npm run build** — ZIP builds successfully
4. **Manual install** — extension loads in Chrome without errors
5. **Regression** — record a session, generate Playwright code — output must be identical to pre-milestone behavior (except where the milestone intentionally adds evidence)
6. **Milestone-specific observable behavior** — verified as described above

---

## What Each Milestone Does NOT Touch (Guaranteed Unchanged)

| System | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 |
|--------|----|----|----|----|----|----|----|----|
| ComponentRuntime (14 definitions) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| EvidenceLedger | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| IR Bridge | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Playwright generation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Enrichment layer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Healing service | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Settings page | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Execution (IR executor) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

No milestone modifies classification, generation, enrichment, healing, or execution code.
