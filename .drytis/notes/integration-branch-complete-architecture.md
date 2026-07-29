# Complete Extension Architecture Study — integration branch

## Overview
The integration branch is a **complete, end-to-end recording system** with 17,127 lines of TypeScript across 130+ source files. It captures real-world user interactions, classifies them, enriches them with semantic understanding, and generates Playwright test code.

## Extension Startup & Initialization

### Manifest Contract (MV3)
- **Content script**: `src/recorder/deterministic-recorder.ts`, injected at `document_start` on `<all_urls>`, `all_frames: true`
- **Background**: `src/background/service-worker.ts`, type: `module`
- **Side panel**: `src/sidepanel/index.html`
- **Settings**: `src/settings/index.html` (options page)
- **Permissions**: sidePanel, storage, unlimitedStorage, activeTab, webNavigation, tabs, scripting, alarms
- **Host permissions**: `http://*/*`, `https://*/*`

### Service Worker Startup
1. **Session restore** (line 44-50): `ensureSessionRestored()` calls `session.restoreFromStorage()` immediately on SW boot. Reads `SESSION_EVENTS` + `SESSION_CONTEXT` from chrome.storage.local. Advances eventIdGenerator past restored events. Sets `sessionRestored=true` to prevent repeated restores.
2. **Side panel behavior**: `chrome.runtime.onInstalled` → `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})`
3. **Health check alarm**: `chrome.alarms.create('cs-health-check', {periodInMinutes: 0.08})` (~5s). Fires on every alarm — if recording, checks active tab CS health.

### Content Script Startup
1. **Double-injection guard**: Checks `window.__CMDRUNNER_CS_ACTIVE__`. If set, exits silently (prevents duplicate listeners after extension reload/update).
2. **State sync**: Listens to `chrome.storage.onChanged` for `ui_state` changes → updates `isRecording` flag. Also does initial async read of `ui_state` from storage.
3. **PING handler**: Synchronous response `{type:'PONG', isRecording, url}` — used by SW to detect orphaned scripts.
4. **START/STOP message handlers**: Direct `isRecording` flag updates + cleanup (clears valueTracker, datePickerDebounce).
5. **Page-world interception**: Injects `<script>` at document_start to wrap `window.alert/confirm/prompt/open`. Records results on `data-cmdrunner-dialog`/`data-cmdrunner-window-open` attributes.

### Side Panel Startup
1. **Init**: Reads `UIState` from storage. Routes to appropriate view:
   - `Recording` → shows recording view with live timeline
   - `Stopped` → loads all artifacts (events, interactions, replay, IR plan, files, repo status)
   - `Ready` (default) → home view
2. **Live listeners**: `setupLiveListeners()` registers `StorageService.onKeyChanged` for SESSION_EVENTS, DETECTED_INTERACTIONS_MERGED, EXECUTION_IR_PLAN, GENERATED_FILES, REPOSITORY_SESSION_ID, ELEMENT_HEAL_RESULT.

## Service Worker Architecture

### Responsibilities (844 lines)
1. Extension lifecycle (side panel action)
2. Message routing (START/STOP/PING/RECORDED_EVENT/RUN_TEST/OPEN_SETTINGS/OPEN_REPOSITORY)
3. Navigation capture (webNavigation API)
4. Session management (start/stop/persist/restore)
5. Content script health (ping/inject/resync)
6. Post-stop pipeline (classification → recognition → enrichment → IR → Playwright → repository)
7. Test execution (IR executor)
8. Periodic health checks (alarm-based)

### Key Design Patterns
- **Single RecordingSession singleton** — SW's source of truth for events
- **Triple message sync**: chrome.storage.onChanged + chrome.runtime.sendMessage + async storage read
- **Non-fatal pipeline stages** — every post-stop stage wrapped in try/catch. Recording always completes.
- **Dynamic imports** for heavy modules (IR bridge, repository) — lazy-loaded
- **Broadcast helpers**: `broadcastToTabs()` sends to all tabs (ignores errors), `broadcastToPanel()` sends via runtime message (ignores if panel closed)

### Content Script Health Strategy (Critical for MV3)
1. `pingTabContentScript(tabId)` — sends PING, checks for PONG response
2. `injectContentScript(tabId)` — `chrome.scripting.executeScript({target:{tabId,allFrames:true}, files:[...]})`
3. `ensureContentScriptInjected(tabId)` — ping → inject → wait 100ms → resync state if recording → verify alive
4. `checkActiveTabHealth()` — runs health check on active tab, broadcasts CONTENT_SCRIPT_STATUS to panel
5. Alarm-based periodic check every ~5s during recording

## Content Script Lifecycle

### Recording State Management
Content script is **proactive** — it sends events whenever `isRecording=true`, even if there's a timing gap. SW is the final authority.

Three sync mechanisms (defense in depth):
1. `chrome.storage.onChanged` listener — fires when SW writes new UIState
2. `chrome.runtime.onMessage` listener — START/STOP messages from SW
3. `checkRecording()` async fallback — reads storage directly (catches missed changes)

### Event Capture Architecture (13 listeners)
All listeners on `document` at **capture phase** with `high priority`:
- mousedown, focus, input, change, click, blur, dblclick, contextmenu, mouseover, mouseout, scroll, dragstart, drop

Each listener is highly specialized with suppression rules (see migration assessment for details).

### Data Flow (Content Script → SW)
`DOM Event → resolveTarget → captureIdentity + captureDomContext + captureValue → chrome.runtime.sendMessage({type:'RECORDED_EVENT', ...}) → SW.handleRecordedEvent() → session.addElementEvent()`

### Key Capture Strategies
- **Value tracking**: Map<elementKey, {value, checked}>. Snapshots before-state on mousedown/focus. Only captures committed value at blur for text entry. Suppresses intermediate keystrokes.
- **Event suppression**: Label dedup, checkbox/radio input suppression, text-entry keystroke suppression, scroll filtering (<100px, post-click cooldown)
- **Target resolution**: 3-strategy cascade: interactive selector → clickable heuristic → raw element
- **Surface detection**: Post-click 500ms MutationObserver. ARIA roles + CSS class patterns + positioned overlay heuristics
- **Hover detection**: CSS `:hover` stylesheet rule analysis + MutationObserver for JS-driven reveals
- **Date picker**: Debounced 800ms value-outcome model. Native inputs + custom calendars + calendar cell click detection

## Side Panel Architecture (1,301 lines)

### View System (4 views)
1. **Home** — "New Test Case" + "Browse Repository"
2. **New TC** — Form: project/feature/scenario dropdowns, test case name, expected result. Repository dropdowns cascade.
3. **Recording** — Live timeline, recording context, CS health indicator
4. **Stopped** — Detected interactions, replay JSON, IR steps, Playwright files, repository status, healing results, execution results

### State Management
Side panel reads from `chrome.storage.local` via `StorageService`. SW writes artifacts asynchronously after STOP_RECORDING. **Triple strategy** for race conditions:
1. Immediate read (may be empty if SW still processing)
2. Retry after delay (setTimeout, typically 500ms-1s)
3. `chrome.storage.onChanged` listener (fires when SW writes the artifact)

### Timeline Renderer (646 lines)
Renders live event timeline during recording. Shows: timestamp, interaction type badge (color-coded), element name, action description. Supports both raw events and detected interactions.

## Session Management (256 lines)

### RecordingSession Class
- In-memory `RecordedEvent[]` with sequential IDs (ActionIdGenerator, 'evt' prefix)
- `start(url, title)`: clears events, resets generator, sets context, persistImmediate
- `stop()`: recording=false, persistImmediate
- `addNavigation(url, title, type)`: deduplicates consecutive same-URL navs
- `addElementEvent(...)`: assigns eventId, pushes, schedules persist
- `toReplayJson()`: produces {schemaVersion, recordingContext, events}

### Persistence Strategy
- **In-memory**: always immediate for UI
- **chrome.storage.local**: debounced — max 5s between writes OR flush at 10 unsaved events
- **MV3 crash recovery**: `restoreFromStorage()` reads events from storage, advances ID generator past restored events

## Post-Stop Pipeline (5 stages, all non-fatal)

### Stage 1: V1 Classification (rule-based)
`detectInteractions(events)` → DetectedInteraction[]
- EventGrouper: segments events into interaction windows (same element + time window)
- TypeClassifier: if/else cascade over 15+ interaction types, confidence 1.0

### Stage 2: V2 Evidence Engine (parallel)
`detectInteractionsV2(events)` → DetectedInteraction[]
- 5 evidence providers (DOM, ARIA, EventSequence, Mutation, CSS class)
- Evidence buffered per-element, committed on threshold
- Weighted voting determines interaction type
- A/B comparison + merge layer combines V1+V2

### Stage 3: Recognition + Enrichment Pipeline
`runPipeline(events, interactions, sessionId, sourceUrl)` → PipelineResult
- Domain adapter: events + interactions → UiElement[] + ObservedTransition[]
- Recognition orchestrator: structural (Tier 1, ARIA roles) + behavioral (Tier 2, evidence signals)
- Enrichment orchestrator: behavioral contracts, capabilities, workflows, surfaces, fragments
- Capability derivation

### Stage 4: IR Bridge
Builds ExecutionIRPlan from events+interactions+understanding → Playwright code via PlaywrightCodeGenerator

### Stage 5: Repository V2 Persistence
Dexie/IndexedDB via persistSession + cross-session element healing

## Recognition Architecture (Integration Branch)

### Two-Tier System
**Tier 1 — Structural Recognizer**: ARIA composite widget roles + native HTML semantics. Confidence 0.95. Checks each pattern's `rootAriaRoles` against the element's ancestor chain. Completely generic — iterates declarative pattern catalogue.

**Tier 2 — Behavioral Recognizer**: Evidence signals from observed transitions. Detects patterns from behavioral signatures when ARIA is absent. Signals: CHILD_ELEMENT_BECAME_VISIBLE, CHILD_CONTAINS_CLICKABLE_ELEMENTS, TRIGGER_VALUE_CHANGED, TRIGGER_STATE_CHANGED, POPUP_CLOSED, SIBLING_VALUE_CHANGED, ELEMENT_BECAME_MODAL, GROUP_MUTUAL_EXCLUSIVITY.

### Pattern Catalogue (Declarative)
6 registered patterns with behavioral signatures:
- Dropdown/Combobox (combobox/listbox roles; behavioral: popup→options→value change→close)
- Checkbox (checkbox role; behavioral: state flip)
- Radio Group (radiogroup role; behavioral: mutual exclusivity)
- Modal (dialog role; behavioral: overlay appearance)
- Tabs (tablist role; no behavioral)
- Accordion (button role; behavioral: state toggle + section expand/collapse; structuralRecognition=false)

Each pattern has: rootAriaRoles, constituentRoles, affordances, hasOptionSet, minConstituents, behavioralSignature (optional), structuralRecognition flag, expectedLifecycle.

### Recognition Orchestrator (424 lines)
Per-interaction flow:
1. Structural recognition (check ARIA role chain)
2. Behavioral recognition (if structural fails or for enrichment)
3. Identity resolution (merge: structural is authoritative, behavioral enriches)
4. Lifecycle progression (check expectedLifecycle via set-containment)
5. Rejection (if component lifecycle not complete after timeout)

### Key insight: The old system has BOTH deterministic classification AND declarative pattern matching. They serve different purposes:
- **Classification** (interaction-detector.ts): Determines WHAT the user did (click, text entry, checkbox toggle). Rule-based, confidence 1.0.
- **Recognition** (structural + behavioral): Determines WHAT COMPONENT the interaction belongs to (combobox, radio group, modal). Pattern-based, confidence 0.65-0.95.

The current architecture conflates these two concerns into one probabilistic recognition pipeline.

## Permission Model
- `activeTab`: content script injection
- `sidePanel`: UI
- `storage`: session state
- `webNavigation`: navigation capture
- `tabs`: active tab queries, CS health checks
- `scripting`: programmatic CS injection
- `alarms`: periodic health checks
- `unlimitedStorage`: large recordings

## Error Recovery & Resilience
1. **MV3 SW restart**: Session restore from storage on boot
2. **CS orphaning**: Ping/inject/resync strategy
3. **Non-fatal pipeline**: Every post-stop stage wrapped in try/catch
4. **Debounced persistence**: Max 5s or 10 events between storage writes
5. **Date normalization**: Full normalization in SW (not just content script)
6. **Cross-session element healing**: Repository V2 matches fresh elements against stored elements, heals stale locators
