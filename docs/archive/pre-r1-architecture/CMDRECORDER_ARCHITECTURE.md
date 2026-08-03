# CmdRecorder — Current Target Architecture

**Status:** Source-of-truth document for the recorder architecture.  
**Scope:** Describes what the architecture IS today and what it is planned to become. Historical designs are not documented here.

---

## Table of Contents

1. [Architecture Vision](#1-architecture-vision)
2. [End-to-End Pipeline](#2-end-to-end-pipeline)
3. [Start Recording](#3-start-recording)
4. [Event Capture](#4-event-capture)
5. [Target Resolution](#5-target-resolution)
6. [Identity Extraction](#6-identity-extraction)
7. [Evidence Collection](#7-evidence-collection)
8. [Interaction Recognition](#8-interaction-recognition)
9. [Lifecycle Architecture](#9-lifecycle-architecture)
10. [Guard Rails](#10-guard-rails)
11. [Decision Engine](#11-decision-engine)
12. [Merge & Semantic Processing](#12-merge--semantic-processing)
13. [Domain Pipeline](#13-domain-pipeline)
14. [IR Generation](#14-ir-generation)
15. [Phase Status](#15-phase-status)
16. [Known Architectural Gaps](#16-known-architectural-gaps)
17. [Architecture Self-Review](#17-architecture-self-review)

---

## 1. Architecture Vision

### Overall Philosophy

CmdRecorder is a Chrome extension that records user interactions on web applications and converts them into human-readable test cases. The architecture is built on a single guiding principle:

> **Describe what the user accomplished, not which browser events occurred.**

This means a multi-step interaction like opening a dropdown, scrolling through options, and selecting one should produce a single semantic output: *"Select Belgian for Nationality"* — not a stream of click, scroll, click events.

### Design Principles

| Principle | What It Means |
|-----------|---------------|
| **Semantic-first** | Every interaction output should describe user intent, not DOM mechanics. The pipeline has an explicit semantic reasoning layer that collapses component lifecycles. |
| **Evidence-based classification** | No single source determines what an element is. Five independent evidence providers (DOM, ARIA, CSS, Event Sequence, Mutation) each contribute weighted opinions. The strongest aggregate wins. |
| **Guard rails over fragility** | The recorder is deployed against real-world enterprise apps (OrangeHRM, AdaniOne, etc.) with non-standard DOM patterns. Dozens of guard rails filter noise before it reaches the pipeline. |
| **Component lifecycle awareness** | Composite UI components (dropdowns, date pickers, autocomplete, multi-config panels, form submits) are recognized as multi-event workflows with activation, absorption, completion, cancellation, and timeout states. |
| **Separation of concerns** | Capture (content script), classification (detectors), reasoning (semantic layer), understanding (domain pipeline), and output (IR/code generation) are distinct stages with well-defined data contracts. |

### Expected Behaviour

A user recording on OrangeHRM's "My Info" page should see:
- *"Enter 'John' in Employee First Name"* (not focus, input, input, input, blur)
- *"Select Belgian for Nationality"* (not click trigger, scroll, click option)
- *"Select date 2023-10-21 for Date of Birth"* (not click field, click prev month, click day)
- *"Configure Cabin=Premium Economy, Adults=2 in Flight Options"* (not 6 separate clicks inside a panel)
- *"Log in (sign in) → /dashboard"* (not enter username, enter password, click button, navigation)

### What Problems It Solves

1. **Per-keystroke noise** — Text entry should be a single interaction with a final value, not a stream of input events.
2. **Component fragmentation** — Dropdowns, date pickers, and autocomplete produce 3–7 browser events each but represent one user action.
3. **Container noise clicks** — Enterprise apps (OrangeHRM/OXD) wrap inputs in deeply nested containers; clicks on these containers produce meaningless noise.
4. **Date-format placeholder confusion** — Custom date inputs display `yyyy-dd-mm` as a placeholder; the recorder must not treat this as the field label.
5. **Multi-field panel workflows** — Flight booking, search filters, and passenger selectors are multi-control panels that should produce one semantic interaction when closed.
6. **Form submission flows** — Login, registration, and checkout forms produce a sequence of entries followed by a submit click and a page navigation; these should be recognized as a coherent workflow.

### Why This Architecture Is Better

Earlier recorders treated every browser event as a potential test step. This produced timelines with 50+ raw events for a simple form, required manual cleanup, and generated fragile Playwright code that mirrored DOM events rather than user intent. The current architecture adds two layers that didn't exist before:

- **Evidence-based dual-engine classification** — Two independent classifiers (V1 structural + V2 evidence-based) run in parallel. V2 gets first claim on all events; V1 fills gaps V2 can't classify. This catches patterns a single classifier misses.
- **Component-aware semantic reasoning** — A stream processor that recognizes complete component lifecycles and collapses them into single semantic interactions before they reach the IR layer.

---

## 2. End-to-End Pipeline

### Pipeline Overview

```
User clicks "Start Recording"
        │
        ▼
┌──────────────────────────────────────────┐
│  STAGE 1: EVENT CAPTURE                  │
│  (deterministic-recorder.ts)             │
│                                          │
│  13 capture-phase listeners              │
│  Value tracker (before/after snapshots)  │
│  Page-world dialog interception          │
│  Surface detection (MutationObserver)    │
│  Date picker debounce system             │
│  Hover detection (CSS + mutation)        │
│                                          │
│  Output: RECORDED_EVENT messages         │
│          → Service Worker                │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  STAGE 2: EVENT STORAGE                  │
│  (service-worker.ts)                     │
│                                          │
│  Assigns evt-NNNN IDs                    │
│  Debounced persist to chrome.storage     │
│  Navigation events from webNavigation    │
│                                          │
│  Output: RecordedEvent[] in memory       │
└──────────────┬───────────────────────────┘
               │
               ▼  (on STOP_RECORDING)
┌──────────────────────────────────────────┐
│  STAGE 3: CLASSIFICATION                 │
│  (interaction-detector.ts + engine.ts)   │
│                                          │
│  3a. V1 Classifier (structural)          │
│      → groupEvents() → classifyGroup()   │
│      → 24-type priority chain            │
│                                          │
│  3b. V2 Evidence Engine (5 providers)    │
│      → buffer events per element         │
│      → collect evidence (onEvent)        │
│      → commit evidence (onCommit)        │
│      → combineEvidence (weighted vote)   │
│                                          │
│  3c. Merge Layer                         │
│      → V2 primary, V1 fallback           │
│      → no event in >1 interaction        │
│                                          │
│  Output: DetectedInteraction[] (merged)  │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  STAGE 4: SEMANTIC REASONING             │
│  (semantic/reasoner.ts)                  │
│                                          │
│  Stream processor with ComponentSessions │
│  5 component types:                      │
│    dropdown, datePicker, autocomplete,   │
│    multiConfig, formSubmit              │
│                                          │
│  Per interaction:                        │
│    0. Navigation lookback merge (≤3s)    │
│    1. Cleanup stale sessions (15s)       │
│    2. Cancellation check (nav/newTab)    │
│    3. Completion check (all sessions)    │
│    4. Absorption check (absorb into      │
│       active session)                    │
│    5. Activation check (start new        │
│       session)                           │
│    6. Pass through (unchanged)           │
│                                          │
│  Output: DetectedInteraction[] (semantic)│
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  STAGE 5: DOMAIN PIPELINE                │
│  (pipeline/pipeline-runner.ts)           │
│                                          │
│  5a. Domain Adapter                      │
│      → events+interactions → UiElement[] │
│      → ObservedTransition[]              │
│                                          │
│  5b. Recognition                         │
│      → ComponentGrouping[]               │
│                                          │
│  5c. Enrichment (10 modules)             │
│      → ApplicationKnowledgeFragment      │
│                                          │
│  5d. Capability Derivation               │
│      → CapabilityCandidate               │
│                                          │
│  Output: UnderstandingResult             │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  STAGE 6: IR GENERATION                  │
│  (generation/ir-bridge.ts)               │
│                                          │
│  Interactions + Understanding → IR steps │
│  Locator ranking (5 categories)          │
│  Assertion generation                    │
│  Readability rules (merge duplicates)    │
│                                          │
│  Output: ExecutionIRPlan                 │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  STAGE 7: CODE GENERATION                │
│  (adapters/playwright/)                  │
│                                          │
│  IR steps → Playwright test file         │
│  Locator rendering                       │
│  Action rendering                        │
│  Assertion rendering                     │
│                                          │
│  Output: GeneratedFiles (.spec.ts)       │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  STAGE 8: SIDE PANEL DISPLAY             │
│  (sidepanel/sidepanel.ts)                │
│                                          │
│  Recording view (live events)            │
│  Stopped view:                           │
│    - Detected interactions (semantic)    │
│    - Raw event timeline                  │
│    - IR steps                            │
│    - Generated Playwright code           │
│    - Replay JSON                         │
└──────────────────────────────────────────┘
```

### Stage Summary

| Stage | Responsibility | Input | Output | Files |
|-------|---------------|-------|--------|-------|
| 1. Event Capture | Capture real DOM events with full identity + context | User interactions | `RECORDED_EVENT` messages | `deterministic-recorder.ts` |
| 2. Event Storage | Assign IDs, persist, manage recording lifecycle | Event messages | `RecordedEvent[]` | `service-worker.ts`, `recording-session.ts` |
| 3. Classification | Determine what each interaction IS | `RecordedEvent[]` | `DetectedInteraction[]` (merged) | `interaction-detector.ts`, `evidence/engine.ts`, `merge-layer.ts` |
| 4. Semantic Reasoning | Collapse component lifecycles into user-intent interactions | Merged interactions | Semantic interactions | `semantic/reasoner.ts`, `semantic/detectors.ts`, `semantic/panel-form-detectors.ts` |
| 5. Domain Pipeline | Build structural understanding of the application | Events + interactions | `UnderstandingResult` | `pipeline/pipeline-runner.ts` |
| 6. IR Generation | Convert interactions to executable steps | Interactions + understanding | `ExecutionIRPlan` | `generation/ir-bridge.ts` |
| 7. Code Generation | Render IR as framework code | `ExecutionIRPlan` | `.spec.ts` files | `adapters/playwright/*.ts` |
| 8. Display | Show results to user | All artifacts | Side panel UI | `sidepanel/*.ts` |

**Why this exists as separate stages:** Each stage has a well-defined input/output contract. Stages 3–4 can be swapped (e.g., with the Foundation Pipeline) without touching stages 1–2 or 5–8. The IR in stage 6 is framework-neutral — stage 7 can target Playwright, Cypress, or any framework by implementing a different adapter.

---

## 3. Start Recording

### Initialization Sequence

When the user clicks "Start Recording" in the side panel:

```
Side Panel → sends { type: 'START_RECORDING', testCaseDraft }
    │
    ▼
Service Worker: handleStartRecording()
    │
    ├─ 1. session.clear() — empty events, reset ID generators, persist empty
    ├─ 2. session.start(startUrl, startTitle) — set recording=true, create RecordingContext
    ├─ 3. session.addNavigation(startUrl, startTitle, 'link') — seed initial navigation
    ├─ 4. ensureContentScriptInjected(tabId):
    │      ├─ pingTabContentScript() → send PING, wait for PONG
    │      ├─ if dead → chrome.scripting.executeScript([
    │      │        'src/recorder/deterministic-recorder.ts',
    │      │        'src/recorder/v2/control-recorder.ts'
    │      │   ])
    │      ├─ resync state → broadcast START_RECORDING to tab
    │      └─ re-ping to confirm alive
    ├─ 5. Update UIState → recordingState = 'recording'
    ├─ 6. Broadcast { type: 'START_RECORDING' } to all tabs
    └─ 7. checkActiveTabHealth() → broadcast CONTENT_SCRIPT_STATUS to side panel
```

### What the Content Script Does on Start

`deterministic-recorder.ts` receives `START_RECORDING` via `chrome.runtime.onMessage`:

1. Sets `isRecording = true`
2. Calls `syncEngineFlag()` — reads `ui_state.recorderEngine` from `chrome.storage.local`. If `=== 'control'`, sets `isLegacyEngine = false` and the recorder stays dormant (control-recorder.ts takes over). Default: `isLegacyEngine = true`.
3. Clears the value tracker

### Listeners (already attached at injection time)

The recorder attaches **13 capture-phase event listeners** at `document_start`, but ALL are gated by the `checkRecording()` function which returns `false` when `!isRecording || !isLegacyEngine`. The listeners are:

| # | Event | Purpose |
|---|-------|---------|
| 1 | `mousedown` | Snapshot value/checked state (before-state) |
| 2 | `focus` | Track text-entry focus events |
| 3 | `input` | Track value changes (silently for text — updates tracker only) |
| 4 | `change` | Track committed value changes (dropdowns, file inputs, dates) |
| 5 | `click` | Primary interaction capture |
| 6 | `blur` | Complete text-entry interactions, flush date debounce |
| 7 | `dblclick` | Double-click capture (with container/label suppression) |
| 8 | `contextmenu` | Right-click capture |
| 9 | `mouseover` | Hover detection phase 1 (CSS reveal check) |
| 10 | `mouseout` | Clear hover tracking |
| 11 | `scroll` | Scroll capture (with debounce, threshold, post-click suppression) |
| 12 | `dragstart` | Drag-and-drop start |
| 13 | `drop` | Drop target + file metadata capture |

All listeners use `capture: true` and check `event.isTrusted` (rejects synthetic events from frameworks).

### Observers

| Observer | Target | Duration | Purpose |
|----------|--------|----------|---------|
| `MutationObserver` (surface) | Click target subtree | 500ms (`SURFACE_DETECTION_MS`) | Detect dynamically appearing modals, drawers, popovers, tooltips after clicks |
| `MutationObserver` (hover) | Hovered element subtree | 300ms | Detect JS-driven hover reveals (React tooltips, CSS mega-menus) |
| `chrome.storage.onChanged` | UIState changes | Persistent | React to recording state changes, engine flag flips |
| `chrome.alarms 'cs-health-check'` | Periodic | ~4.8s interval | Content script health monitoring (service worker side) |

### Buffers and Caches

| Buffer | Location | Contents | Lifecycle |
|--------|----------|----------|-----------|
| **Value Tracker** | Content script memory | `Map<elementKey, {value, checked}>` | Populated on mousedown/focus, updated on input/change, deleted on blur. Cleared on STOP_RECORDING. |
| **Date Picker Debounce** | Content script memory | `{ timer, target, valueBefore, lastValue }` | 800ms debounce per date input. Flushed on blur or STOP_RECORDING. |
| **Hover Tracking** | Content script memory | `{ target, startTime, timer, mutationObserver, cssReveal, nearbyReveal }` | 300ms tracking window. Cleared on mouseout or new mouseover. |
| **Events Array** | Service worker memory | `RecordedEvent[]` | The authoritative recording. Debounced persistence to `chrome.storage.local` every 5s or 10 events. |
| **Page World Signals** | DOM attributes | `data-cmdrunner-dialog`, `data-cmdrunner-window-open` | Set by injected page-world script on `alert/confirm/prompt/window.open`. Read and cleared after each click. |

### Control Discovery

**Not implemented in the production (legacy) engine.** The deterministic recorder does not pre-scan the page for controls. It processes events reactively as they arrive.

**The control-centric engine** (`control-recorder.ts`, dormant by default) does perform control discovery: on recording start, it creates a `ControlModel`, calls `model.discover(document.body)` to scan the DOM for interactive controls, and sets up a `MutationObserver` to track dynamically added controls. This is part of the planned evolution but not currently active.

### Framework Detection

**Production engine:** No explicit framework detection. Framework patterns are detected at classification time by the CSS Classname Provider (MUI, AntD, Bootstrap, Headless UI, React-Select, react-datepicker) and through heuristics in the recorder (OXD patterns in `getImplicitRole()` and `computeAccessibleName()`).

**Foundation pipeline (planned):** Channel B (DOM Structure) would capture framework-specific class patterns as structured evidence.

### Feature Flags

| Flag | Location | Default | Effect |
|------|----------|---------|--------|
| `recorderEngine` | `chrome.storage.local['ui_state']` | `'legacy'` | `'legacy'` → deterministic-recorder.ts active; `'control'` → control-recorder.ts active |

This is the only feature flag. All other behavior is hardcoded.

### State Initialization

On content script injection:
```javascript
let isRecording = false;      // set true by START_RECORDING message
let isLegacyEngine = true;    // set by syncEngineFlag()
```

On service worker startup:
```javascript
session.restoreFromStorage()  // rehydrate events from chrome.storage.local
                                // advance ActionIdGenerator past highest restored ID
```

---

## 4. Event Capture

### Event Types and Their Roles

Every captured event type falls into one of four roles: **primary** (produces interactions), **evidence** (contributes to classification but doesn't standalone), **suppressed** (captured but filtered out), or **delayed** (held for debouncing).

| Event Type | Role | Why Captured | When It Becomes Evidence-Only | When Ignored | When Delayed |
|------------|------|-------------|-------------------------------|-------------|-------------|
| **click** | Primary | The fundamental interaction — buttons, links, dropdown triggers, checkboxes, radio buttons, tabs, menu items | Inside calendar popovers (`ownedByDatePicker=true`) → evidence for DatePicker | Container noise clicks (large/empty containers), label-wrapped inputs, untrusted events | Never |
| **dblclick** | Primary | Double-click interactions | Inside calendar popovers | Container/label suppression (same as click) | Never |
| **contextmenu** | Primary | Right-click (context menu open) | Never | Never | Never |
| **focus** | Evidence | Marks the start of a text-entry session. Only fires for text-entry elements (not date triggers, not readonly). | — | Non-text-entry elements, date triggers, readonly inputs | Never |
| **input** | Evidence | Updates value tracker silently for text entry. Emits event for non-text elements. | Text-entry elements — input is silently tracked; only focus→blur matters | Checkbox, radio, select, date triggers | Never |
| **change** | Primary/Evidence | Committed value for dropdowns, file inputs. Routes to date system for date triggers. | — | Checkbox, radio (handled by click) | Date triggers → 800ms debounce |
| **blur** | Primary | Completes text-entry interaction (carries final value). Flushes date debounce. | — | Non-tracked elements (`if (!snapshot) return`) | Never |
| **scroll** | Primary | Page/container scroll, infinite scroll detection | — | <100px delta, within 1s of click, first scroll (baseline init) | 200ms debounce |
| **mouseenter** | Primary | Hover that produced visible change (tooltip, mega-menu) | — | Post-click cooldown (1.5s), inside modal/calendar, date triggers | 300ms detection window (CSS + mutation) |
| **dragstart** | Primary | Drag source for drag-and-drop | — | Never | Never |
| **drop** | Primary | Drop target + file metadata for uploads | — | Never | Never |
| **dateSelect** | Primary | Synthetic event emitted by the date picker debounce system (not a native DOM event) | — | Never | 800ms debounce from change/calendar click |
| **navigation** | Primary | Page navigation (URL change) — injected by service worker from `chrome.webNavigation.onCommitted` | — | Consecutive same-URL dedup | Never |

### The `dateSelect` Synthetic Event

This is the most important non-standard event. The recorder does NOT emit raw change events for date inputs. Instead:

1. User clicks a date input or calendar cell
2. The change handler routes to `handleDateValueChange()`
3. An 800ms debounce timer starts
4. If the user clicks another day (navigating months), the timer resets
5. When the timer fires (or blur flushes it), a single `dateSelect` event is emitted with:
   - `dateType`: `'date'`, `'time'`, or `'dateTime'`
   - `isoValue`: normalized ISO 8601 date
   - `displayValue`: human-readable date
   - `dateConfidence`: 0.5–1.0 (1.0 for native inputs, 0.8 for custom pickers, 0.9 for calendar cells)
   - `dateAmbiguous`: boolean (true if format is uncertain)

This prevents the pipeline from seeing intermediate date states while the user navigates a calendar.

---

## 5. Target Resolution

### The Problem

When a user clicks a `<span>` inside a `<button>`, the browser's `event.target` is the `<span>`, not the `<button>`. For `<svg>` icons inside links, `event.target` might be a `<path>` element. The recorder needs to find the **actual interactive element** the user intended to click.

### Resolution Cascade (`resolveTarget()`)

Three strategies, tried in order. The recorder **never silently drops** an interaction — Strategy 3 is a guaranteed fallback.

#### Strategy 1: Nearest Interactive Element via `composedPath()`

```
event.composedPath() → walk from target outward
  → find first element matching INTERACTIVE_SELECTOR
```

**`INTERACTIVE_SELECTOR`** (33 selectors):
```
a[href], button, summary, select, option, textarea, input, form,
[contenteditable],
[role="button"], [role="link"], [role="tab"], [role="menuitem"],
[role="menuitemcheckbox"], [role="menuitemradio"], [role="option"],
[role="switch"], [role="treeitem"], [role="checkbox"], [role="radio"],
[role="gridcell"], [role="combobox"], [role="textbox"], [role="spinbutton"],
[role="slider"], [role="radiogroup"],
[tabindex], [onclick], [data-action], [data-toggle], [data-bs-toggle],
[aria-haspopup]
```

**Fallback:** If `composedPath()` is unavailable (shouldn't happen in modern browsers), walks up `parentElement`.

#### Strategy 2: Nearest "Clickable" Element

If no interactive element found, looks for elements that are effectively clickable:
- `el.onclick !== null` (inline onclick or framework handler)
- `window.getComputedStyle(el).cursor === 'pointer'`

This catches custom widgets (div-based buttons, span-based dropdowns).

#### Strategy 3: Raw Target (Guaranteed Fallback)

If strategies 1 and 2 fail, returns the raw `event.target` unless it's a structural element (`HTML`, `HEAD`, `BODY`, `SCRIPT`, `STYLE`, SVG internals). In that case, walks up to the nearest non-structural ancestor.

### Shadow DOM Handling

- `composedPath()` **pierces shadow DOM** by default — this is the browser API's designed behavior.
- Shadow-DOM-aware query helpers (`deepGetElementById`, `deepQuerySelector`, `deepQuerySelectorAll`) traverse open shadow roots recursively. Closed shadow roots are inaccessible by browser limitation.
- MutationObservers use `observeWithShadowRoots()` which recursively observes all open shadow roots.
- `isInShadowDom()` checks `el.getRootNode() instanceof ShadowRoot`.

### Iframe Handling

- The recorder is injected with `"all_frames": true` in the manifest, so it runs in every frame independently.
- `extractIframeContext()` detects if `window !== window.top` (running inside an iframe) and captures: `frameSrc`, `frameName`, `frameId`, `frameSelector`, `frameXPath`, `frameIndex`, `frameDepth`.
- Events from iframes carry their `iframeContext` in the element identity, enabling the IR bridge to generate iframe-aware Playwright locators.

### Wrapper Elements, SVG/Icons, Labels

| Pattern | How Handled |
|---------|-------------|
| `<span>` inside `<button>` | Strategy 1 finds the `<button>` |
| `<path>` inside `<svg>` inside `<a>` | Strategy 1 finds the `<a>` |
| `<div>` with `cursor:pointer` | Strategy 2 finds it |
| `<label>` wrapping `<input>` | Label click suppression — if the label contains an input/button/select/textarea, the click is suppressed (browser forwards it to the control) |
| `<label for="inputId">` | Same suppression — if `htmlFor` points to a form control |

### Framework Adapters

**Production engine:** No framework-specific adapters at the capture layer. Framework detection happens at classification (CSS Classname Provider). However, the recorder has framework-specific logic embedded in:
- `getImplicitRole()` — maps OXD/AntD class patterns to ARIA roles
- `computeAccessibleName()` — resolves OXD `.oxd-input-group` / `.oxd-label` patterns
- `isContainerNoiseClick()` — exempts `oxd-select-text`, `dropdown-trigger` patterns

**Foundation pipeline (planned):** Channel A (Accessibility) and Channel B (DOM Structure) would collect framework metadata as structured evidence.

### Control Model (Planned)

The control-centric engine (`control-recorder.ts`, dormant) uses a `ControlModel` that pre-discovers interactive controls on the page. When an event arrives, `model.matchEvent(event)` returns the correct control (e.g., for a `<div>` inside a nationality dropdown, it returns the dropdown control labeled "Nationality", not a generic div). This eliminates the target resolution ambiguity that the heuristics-based cascade can't fully solve.

### Guard Rails in Target Resolution

| Guard Rail | Prevents |
|------------|----------|
| `event.isTrusted` check | Synthetic events from frameworks |
| `event.button === 0` on click | Middle/right-click noise (contextmenu handles those) |
| Label suppression | Duplicate events from label→control forwarding |
| Container noise suppression | Clicks on large layout containers |
| Date trigger guard | Date inputs treated as date pickers, not text entry |

---

## 6. Identity Extraction

### Element Identity Model

Every captured event carries an `ElementIdentity` with 18+ fields. This identity is the foundation for locator generation, duplicate suppression, and interaction grouping.

### `extractIdentity(el)` — Full Field Map

| Field | Source | Resolution Chain |
|-------|--------|-----------------|
| `accessibleName` | `computeAccessibleName(el)` | See 13-step chain below |
| `ariaRole` | `getImplicitRole(el)` | Explicit `role` > `INPUT_TYPE_ROLE_MAP` > `TAG_ROLE_MAP` > `FRAMEWORK_CLASS_ROLE_MAP` |
| `ariaLabel` | `el.getAttribute('aria-label')` | Direct attribute |
| `ariaLabelledBy` | `el.getAttribute('aria-labelledby')` | Direct attribute |
| `placeholder` | `el.getAttribute('placeholder')` or `aria-placeholder` | Direct attribute |
| `tag` | `el.tagName` (uppercase) | e.g., `'BUTTON'`, `'INPUT'` |
| `className` | `HTMLElement.className` | Space-joined string; null for non-HTMLElement |
| `name` | `el.getAttribute('name')` | Form field name |
| `stableId` | `el.id` | DOM element ID |
| `testId` | `el.getAttribute('data-testid')` | Test-specific ID |
| `dataCy` | `el.getAttribute('data-cy')` | Cypress test ID |
| `dataQa` | `el.getAttribute('data-qa')` | QA test ID |
| `cssSelector` | `generateCssSelector(el)` | Up to 5 ancestor levels, `tag:nth-of-type(n)` segments |
| `xPath` | `generateXPath(el)` | Up to 10 ancestor levels, `tag[n]` segments |
| `inIframe` | `window !== window.top` | Boolean |
| `shadowDom` | `el.getRootNode() instanceof ShadowRoot` | Boolean |
| `iframeContext` | `extractIframeContext()` | 7 sub-fields (only when inIframe=true) |
| `elementId` | Synthetic priority chain | `stableId` > `testId` > `dataCy` > `dataQa` > `name` > `cssSelector` > `tag::accessibleName` |

### `computeAccessibleName()` — 13-Step Resolution Chain

All values truncated to 200 chars.

| Step | Source | When Used |
|------|--------|-----------|
| 1 | `aria-label` attribute | If present and non-empty |
| 2 | `aria-labelledby` → resolve referenced elements via `deepGetElementById()` | If present |
| 3a | `<label for="el.id">` associated label | For INPUT/SELECT/TEXTAREA |
| 3b | Wrapping `<label>` (`.closest('label')`) | For INPUT/SELECT/TEXTAREA |
| 3c | `<select>` selected option text | For SELECT elements |
| 3d | Form-group sibling label (walk to `.oxd-input-group`/`.form-group`/`.form-field`/`.field-wrapper`, find `<label>` inside) | For INPUT/SELECT/TEXTAREA — handles OXD/Bootstrap/MUI patterns where label is sibling, not ancestor |
| 4 | `innerText` | For HTMLElement |
| 5 | `textContent` | Fallback |
| 6 | `placeholder` or `aria-placeholder` | For form inputs |
| 7 | `value` | For INPUT type=button/submit/reset |
| 8 | `alt` | For IMG or INPUT[type=image] |
| 9 | `title` attribute | Universal fallback |
| 10 | Ancestor walk (8 levels): `.oxd-input-group` → `.oxd-label`; `<fieldset>` → `<legend>`; `role="group"` → `label` | Enterprise framework patterns |
| 11 | Return `''` (empty) | Nothing found |

### `getImplicitRole()` Resolution Chain

| Priority | Source | Examples |
|----------|--------|---------|
| 1 | Explicit `role` attribute | `role="combobox"` |
| 2 | `INPUT_TYPE_ROLE_MAP` | `type=checkbox` → `'checkbox'`, `type=date` → `'combobox'` |
| 3 | `TAG_ROLE_MAP` | `A` → `'link'`, `SELECT` → `'listbox'`, `BUTTON` → `'button'` |
| 4 | `FRAMEWORK_CLASS_ROLE_MAP` | `oxd-select-text` → `'combobox'`, `oxd-checkbox-wrapper` → `'checkbox'` |

### CSS Selector Generation

- **Priority:** `#id` → walk up to 5 ancestors building `tag` or `tag:nth-of-type(n)` segments
- **Format:** `parent > child > grandchild`
- **Optimization:** If only one sibling of the same tag exists, bare `tag` is used (no `:nth-of-type`)

### XPath Generation

- **Priority:** `//tag[@id='id']` → walk up to 10 ancestors building `tag` or `tag[n]` segments
- **Format:** `//ancestor/descendant`

### Confidence Scoring (at Identity Level)

Identity extraction does NOT produce confidence scores directly. Confidence is computed at the classification stage through evidence combination. However, the `elementId` field has an implicit reliability ranking:

| Source | Reliability | Why |
|--------|-------------|-----|
| `stableId` (DOM id) | High — but filtered for framework-generated IDs (react-*, mui-*, headlessui-*) | See locator filtering rules |
| `testId` / `dataCy` / `dataQa` | Highest — intentional test attributes | These exist specifically for automation |
| `name` | Medium — form field names are stable | Can change with form refactors |
| `cssSelector` | Low — structural, fragile | Breaks when DOM hierarchy changes |
| `tag::accessibleName` | Lowest — fallback only | Name can change; tag is too generic |

---

## 7. Evidence Collection

### Evidence Model

Classification in the V2 engine is driven by **evidence** — structured observations from independent providers. Each evidence record carries:

```typescript
interface Evidence {
  provider: string;              // which provider produced this
  suggestedType: InteractionType | null;  // what type this evidence suggests
  confidence: number;            // 0.0–1.0: how sure THIS observation is
  weight: number;               // 0.0–1.0: how authoritative this provider is
  metadata?: Partial<InteractionMetadata>;  // partial metadata contribution
  reason: string;               // human-readable explanation
}
```

The distinction between **confidence** (how sure the observation is) and **weight** (how authoritative the provider is for this type of signal) is critical: a CSS class match (`weight: 0.65`) saying "this is a date picker" is less authoritative than a native `<input type="date">` match (`weight: 1.0`), even if both have `confidence: 0.9`.

### The Five Evidence Providers

Each provider observes the same event stream from a different angle. They are independent — no provider reads another's output.

#### Provider 1: DOM Provider (`dom-provider.ts`)

**Signal:** Native HTML tags and input types.

| Detection | Type | Confidence | Weight |
|-----------|------|-----------|--------|
| `<select>` | NativeDropdown | 0.99 | 1.0 |
| `<input type="checkbox">` | Checkbox | 0.99 | 1.0 |
| `<input type="radio">` | RadioButton | 0.99 | 1.0 |
| `<input type="range">` | Slider | 0.99 | 1.0 |
| `<input type="date">` | DatePicker | 0.99 | 1.0 |
| `<input type="file">` | FileUpload | 0.95 | 0.9 |
| `<button>` on click | Click | 0.8 | 0.8 |
| `<a>` on click (excl. breadcrumb/nav) | Link | 0.9 | 0.8 |
| `role="gridcell"` or calendar class | DatePicker | 0.9 | 1.0 |
| `dateSelect` event | DatePicker/TimePicker/DateTimePicker | dateConfidence | 1.0 |
| `<datalist>` autocomplete | Autocomplete | 0.75 | 0.7 |
| Text input/textarea (not date/combobox) | TextEntry | 0.85 | 0.8 |
| Dialog/window signals | BrowserAlert/NewWindow/NewTab | 0.98 | 1.0 |

**On-commit reinforcement:**
- Focus→blur on text element → TextEntry @ 0.9/0.8
- Calendar trigger + cell click → DatePicker @ 0.9/1.0
- Autocomplete input + option click → Autocomplete @ 0.8/0.75

**Limitations:** Useless for div-based custom widgets. The most reliable provider for native HTML, but enterprise apps rarely use native elements.

#### Provider 2: ARIA Provider (`aria-provider.ts`)

**Signal:** ARIA roles, states, and attributes.

| Detection | Type | Confidence | Weight |
|-----------|------|-----------|--------|
| `role="checkbox"` | Checkbox | 0.85 | 0.85 |
| `role="radio"` | RadioButton | 0.85 | 0.85 |
| `role="switch"` or `aria-pressed`/`aria-checked` | ToggleSwitch | 0.85 | 0.8 |
| `role="slider"` | Slider | 0.85 | 0.85 |
| `role="combobox"` + `aria-autocomplete` | Autocomplete | 0.85 | 0.85 |
| `role="combobox"` / `role="listbox"` | CustomDropdown | 0.85 | 0.85 |
| `role="option"` (contextual to buffer) | Autocomplete or CustomDropdown | 0.5–0.8 | 0.4–0.7 |
| `role="button"` on click | Click | 0.85 | 0.85 |
| `role="link"` on click | Link | 0.85 | 0.85 |
| `role="tab"` on click | Tab | 0.85 | 0.85 |
| `aria-haspopup="listbox/combobox/tree/grid"` | CustomDropdown | 0.7 | 0.6 |
| `aria-expanded` (no role) | CustomDropdown | 0.5 | 0.4 |

**Note:** `menuitem` is intentionally NOT mapped — it's an element description, not an action.

**On-commit reinforcement:**
- Combobox click + option click + value change → CustomDropdown/Autocomplete @ 0.85/0.8
- Listbox + option selection → CustomDropdown @ 0.85/0.8

**Limitations:** ARIA states may be stale (not updated by framework). Weak on enterprise apps with non-standard ARIA usage.

#### Provider 3: CSS Classname Provider (`css-classname-provider.ts`)

**Signal:** Framework-specific CSS class patterns. Covers 6 frameworks + generic patterns.

| Framework | Example Classes | Coverage |
|-----------|----------------|----------|
| **MUI** | `MuiButton-root`, `MuiCheckbox-root`, `MuiAutocomplete-root`, `MuiPickersDay` | 22 components |
| **Ant Design** | `ant-btn`, `ant-checkbox`, `ant-select`, `ant-picker`, `ant-picker-cell` | 21 components |
| **Bootstrap** | `btn`, `form-check-input`, `form-select`, `form-switch`, `dropdown-item` | 12 classes |
| **Headless UI** | `headlessui-listbox`, `headlessui-combobox`, `headlessui-menu`, `headlessui-switch` | 6 components |
| **React-Select** | `select__control`, `select__option`, `select__input` | 6 parts |
| **react-datepicker** | `react-datepicker__day`, `react-datepicker__month`, `react-datepicker__time` | 12 parts |
| **Generic** | `autocomplete`, `typeahead`, `toggle-switch`, `slider`, `dropzone`, `breadcrumb`, `nav-menu` | Pattern matching |

**Confidence range:** 0.55–0.9, **Weight range:** 0.5–0.85

**Special handling:**
- CSS-in-JS hashed classes (`css-1abc2de`) are explicitly **excluded** — checked before generic patterns.
- Click-type interactions (Click, Link, Tab) only fire on click/auxclick events.
- De-duplicates suggestions per type within a single event.

**Limitations:** Heuristic only — less authoritative than DOM or ARIA. A `dropdown-trigger` class doesn't guarantee a dropdown exists.

#### Provider 4: Event Sequence Provider (`event-sequence-provider.ts`)

**Signal:** Multi-event behavioral patterns on the same element.

**Standalone events (immediate):**
| Event | Type | Confidence | Weight |
|-------|------|-----------|--------|
| `dblclick` | DoubleClick | 0.95 | 0.9 |
| `contextmenu` | RightClick | 0.95 | 0.9 |
| `scroll` | PageScroll/ContainerScroll | 0.8 | 0.7 |
| `mouseenter` | Hover | 0.85 | 0.8 |
| `dragstart` | DragDrop | 0.85 | 0.8 |
| `drop` (with files) | DragDropUpload | 0.9 | 0.85 |
| `drop` (no files) | DragDrop | 0.85 | 0.8 |

**Multi-event patterns (on commit):**
| Pattern | Type | Confidence | Weight |
|---------|------|-----------|--------|
| Focus→Blur with value change | TextEntry | 0.85 | 0.8 |
| Click→Change | NativeDropdown | 0.75 | 0.7 |
| Click with `checkedAfter` | Checkbox | 0.4 | 0.3 (intentionally weak) |
| Single click (no other events) | Click | 0.6 | 0.5 |
| Click triggered dialog | BrowserAlert | 0.9 | 0.85 |

**Limitations:** Needs multiple events to build confidence — returns empty arrays for most real-time non-standalone events.

#### Provider 5: Mutation Provider (`mutation-provider.ts`)

**Signal:** Dynamically appearing UI surfaces and inferred DOM mutations.

**Surface detection (onEvent, from recorder's MutationObserver):**
| Surface | Type | Confidence | Weight |
|---------|------|-----------|--------|
| Modal | Modal | 0.85 | 0.8 |
| Drawer | Drawer | 0.85 | 0.8 |
| Popover (not date picker) | Popover | 0.8 | 0.75 |
| Tooltip | Tooltip | 0.8 | 0.75 |

**Inferred mutations (onCommit):**
| Pattern | Type | Confidence | Weight |
|---------|------|-----------|--------|
| `aria-expanded` open→close cycle | CustomDropdown | 0.7 | 0.6 |
| Trigger click + option interaction | CustomDropdown | 0.7–0.75 | 0.6 |
| Calendar trigger → gridcell | DatePicker | 0.75–0.8 | 0.55 |
| Typing → suggestion click | Autocomplete | 0.7 | 0.6 |
| Multiple scrolls + new elements | InfiniteScroll | 0.6 | 0.5 |

**Limitations:** Surface detection depends on the recorder's 500ms MutationObserver catching the appearance. Inferred mutations need ≥2 events.

### Evidence Weighting Philosophy

- **Native DOM** (weight 0.9–1.0): Most authoritative for native elements. If the tag says `<select>`, it's a dropdown.
- **ARIA** (weight 0.6–0.85): Strong, but ARIA can be misused or stale.
- **CSS classes** (weight 0.5–0.85): Heuristic — useful for framework detection but not authoritative.
- **Event sequences** (weight 0.3–0.9): Strong for standalone events (dblclick, contextmenu) and behavioral patterns.
- **Mutations** (weight 0.5–0.8): Depends on recorder capturing the mutation — timing-sensitive.

When multiple providers agree, confidence compounds. When they conflict, the highest weighted average wins.

---

## 8. Interaction Recognition

### How Interactions Are Recognized

Recognition happens in two parallel systems (V1 and V2), merged, and then semantically processed. This section describes what types are recognized and how.

### V1 Classifier — Priority Chain (24 Types)

The V1 classifier groups events by element identity and time window, then classifies each group through a strict priority chain (first match wins):

| Priority | Type | Detection Signal |
|----------|------|-----------------|
| 1 | PageNavigation/Refresh/Forward/Back | `transitionType` mapping |
| 2 | PageScroll/ContainerScroll | `scroll` event; tag-based page/container distinction |
| 3 | Hover | `mouseenter` event |
| 4 | DoubleClick | `dblclick` event |
| 5 | RightClick | `contextmenu` event |
| 6 | DragDropUpload | `drop` with `fileData` |
| 7 | DragDrop | `dragstart` or `drop` |
| 8 | FileUpload | `INPUT` + `type=file` or name/css pattern |
| 9 | DatePicker/TimePicker/DateTimePicker | `dateSelect` event, date CSS patterns, or date-format values |
| 10 | Slider | `role="slider"` or `inputType="range"` |
| 11 | TextEntry | Text input with input/focus/blur events |
| 12 | NativeDropdown | `<SELECT>` or `role="listbox"` |
| 13 | Checkbox | `role="checkbox"` |
| 14 | RadioButton | `role="radio"` |
| 15 | ToggleSwitch | `role="switch"` or `aria-pressed`/`aria-checked` button |
| 16 | Breadcrumb | className contains breadcrumb/crumb |
| 17 | Tab | `role="tab"` |
| 18 | Menu | `role="menuitem"` or navbar/sidebar/nav-menu classes |
| 19 | BrowserAlert | Click with `triggeredDialog` in domContext |
| 20 | NewWindow/NewTab | Click with `opensNewWindow`/`opensNewTab` |
| 21 | Link | `tag === 'A'` or `role="link"` |
| 22 | Click | Has click event (catch-all) |
| 23 | Unknown | Nothing matched (confidence 0.0) |

### V2 Evidence Engine — Recognition via Weighted Voting

The V2 engine processes events through a buffer system:
1. Events on the same element (or related elements) accumulate in a buffer
2. Each provider contributes evidence for each event
3. When the buffer is committed (element change, standalone event, or flush):
   - All `onCommit()` evidence is collected
   - `combineEvidence()` performs weighted average voting
   - The winning type with score ≥ 0.5 wins; otherwise `Unknown`

### Complete Interaction Type List (38 Types)

`PageNavigation`, `Refresh`, `Forward`, `Back`, `TextEntry`, `NativeDropdown`, `CustomDropdown`, `MultiSelect`, `Autocomplete`, `Checkbox`, `RadioButton`, `ToggleSwitch`, `Slider`, `DatePicker`, `TimePicker`, `DateTimePicker`, `FileUpload`, `DragDropUpload`, `DragDrop`, `Click`, `DoubleClick`, `RightClick`, `Hover`, `Link`, `Breadcrumb`, `Tab`, `Menu`, `BrowserAlert`, `NewTab`, `NewWindow`, `PageScroll`, `ContainerScroll`, `InfiniteScroll`, `Modal`, `Drawer`, `Popover`, `Tooltip`, `Unknown`

### Recognition Logic per Interaction Category

**Click-type** (Click, Link, Tab, Menu, Breadcrumb): Recognized when a click event occurs and no stronger signal overrides. V1 catches via tag/role matching; V2 via DOM tag + ARIA role + CSS class.

**Text Entry**: Requires focus→blur with value change. Intermediate input events are suppressed (tracked silently). V1 checks for text input tag + input/focus/blur events. V2's EventSequenceProvider detects the focus→blur pattern on commit.

**Dropdowns** (Native/Custom): V1 checks for `<select>` tag or `role="listbox"`. V2's DomProvider catches `<select>`, AriaProvider catches `role="combobox"`, MutationProvider infers from trigger→option patterns. The evidence engine groups trigger clicks with option clicks via relationship detection.

**Date Pickers**: Three detection paths: (1) native `date` input type, (2) `dateSelect` synthetic event from the debounce system, (3) calendar grid cell click. The recorder routes all date-related events through the debounce system to produce a single `dateSelect` event.

**Checkbox/Radio/Toggle**: V1 checks explicit role. V2's DomProvider catches native `type="checkbox/radio"`, AriaProvider catches `role="checkbox/radio/switch"` or `aria-pressed`/`aria-checked`. The recorder captures `checkedBefore` (from value tracker on mousedown) and `checkedAfter` (deferred via `setTimeout(0)` after the browser updates state).

**Slider**: V1 checks `role="slider"` or `type="range"`. V2's DomProvider catches both, plus custom sliders via `aria-valuenow`.

**Navigation**: Injected by the service worker's `chrome.webNavigation.onCommitted` listener. Maps `transitionType`: `reload`→Refresh, `forward`→Forward, `forward_back`→Back, else→PageNavigation. Consecutive same-URL navigations are deduped.

**Upload** (File/DragDrop): V1 checks for `type="file"` or name pattern. V2's DomProvider catches native file inputs. The recorder captures file metadata on the `change` event (browse) or `drop` event (drag-drop): `fileData` (name + type per file), `acceptedFileTypes`, `multipleFiles`.

**Scroll**: 200ms debounce, 100px threshold, 1s post-click suppression. V1 distinguishes PageScroll (HTML/BODY target) from ContainerScroll (specific container). V2's MutationProvider can infer InfiniteScroll when new elements appear after multiple scrolls.

**Hover**: 300ms detection window with two signals: CSS `:hover` rule analysis (scans stylesheets for rules that change visibility properties) and MutationObserver (JS-driven reveals). Only emits `mouseenter` if a visible change is detected.

**Surfaces** (Modal/Drawer/Popover/Tooltip): Detected by the click-triggered MutationObserver (500ms window). The `identifySurfaceInline()` function classifies by ARIA roles and CSS class patterns. V2's MutationProvider converts surface detection into interaction evidence.

**Drag & Drop**: `dragstart` event captures the source element. `drop` event captures the target + any file metadata. The evidence engine coordinates these as a multi-event pair.

---

## 9. Lifecycle Architecture

### Overview

The lifecycle model is the heart of the semantic reasoning layer. It recognizes that many user interactions are **multi-event workflows** — a dropdown isn't one click, it's a trigger click + option navigation + option selection + close. The recorder must wait until the component lifecycle completes before emitting the final semantic interaction.

### Component Session Model

```typescript
interface ComponentSession {
  sessionId: string;              // "comp-session-0001"
  componentType: ComponentType;   // 'dropdown' | 'datePicker' | 'autocomplete' | 'multiConfig' | 'formSubmit'
  triggerInteraction: DetectedInteraction;  // the interaction that activated the session
  absorbed: DetectedInteraction[];  // interactions consumed silently
  completionInteraction?: DetectedInteraction;  // the interaction that completed the session
  resultValue?: string;           // extracted final value
  activatedAt: string;            // timestamp
  lastEventAt: string;            // updated on each absorbed interaction
  // MultiConfig-specific:
  configuredFields?: Record<string, string>;  // field → value pairs
  panelLabel?: string;
  // FormSubmit-specific:
  triggerTarget?: string;
}
```

### Processing Flow (per interaction)

Each interaction from the merge layer passes through 7 ordered checks:

```
Incoming Interaction
        │
        ▼
┌─ Check 0: Navigation Lookback ──────────────────────┐
│ Is this a PageNavigation?                            │
│ Was the previous output a click within 3000ms?       │
│ → MERGE: Replace last output with PageNavigation     │
│   carrying both click + nav metadata                 │
└──────────────────────────────────────────────────────┘
        │ (not navigation)
        ▼
┌─ Check 1: Cleanup Stale ────────────────────────────┐
│ Any active session older than 15 seconds?            │
│ → EXPIRE: Commit if has absorbed, cancel if empty    │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ Check 2: Cancellation ─────────────────────────────┐
│ Is this a PageNavigation or NewTab?                  │
│ → CANCEL all active sessions (context switch)        │
│ → Pass this interaction through unchanged            │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ Check 3: Completion ───────────────────────────────┐
│ Does this interaction complete any active session?   │
│ (checked in reverse order — most recent first)       │
│                                                      │
│ dropdown:    option click or select with value       │
│ datePicker:  gridcell click or date value            │
│ autocomplete: option/suggestion click or select      │
│ multiConfig: Done/Apply/Close keyword click          │
│ formSubmit:  Login/Submit/Sign in keyword click      │
│                                                      │
│ → BUILD semantic interaction                         │
│ → REMOVE session                                     │
│ → Return semantic interaction as output              │
└──────────────────────────────────────────────────────┘
        │ (didn't complete anything)
        ▼
┌─ Check 4: Absorption ───────────────────────────────┐
│ Should this interaction be absorbed into a session?  │
│                                                      │
│ multiConfig: same CSS ancestry, field types,         │
│              text entry, stepper clicks, noise types │
│ datePicker:  calendar navigation (prev/next/today)   │
│ dropdown:    re-clicks on trigger, nav keywords      │
│ autocomplete: text entry, clicks on trigger input    │
│ (always):    PageScroll, ContainerScroll, Hover,     │
│              Tooltip                                 │
│                                                      │
│ → ABSORB: Add to session.absorbed[], update timestamp│
│ → Return null (nothing emitted)                      │
└──────────────────────────────────────────────────────┘
        │ (not absorbed)
        ▼
┌─ Check 4b: MultiConfig Outside-Click ───────────────┐
│ Is this a Click NOT absorbed by any multiConfig?     │
│ Does the session have configured fields?             │
│ → COMMIT session (emit configure interaction)        │
│ Or no fields?                                        │
│ → CANCEL session, pass click through unchanged       │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ Check 5: Activation ───────────────────────────────┐
│ Should this interaction activate a new session?      │
│ (priority: autocomplete > datePicker > dropdown >    │
│  multiConfig > formSubmit)                           │
│ No session of same type already active?              │
│ → CREATE session, hold trigger interaction           │
│ → Return null (nothing emitted yet)                  │
└──────────────────────────────────────────────────────┘
        │ (nothing matched)
        ▼
┌─ Check 6: Pass Through ─────────────────────────────┐
│ → Add interaction to output unchanged                │
└──────────────────────────────────────────────────────┘
```

### Lifecycle Diagrams per Component Type

#### Dropdown Lifecycle

```
User clicks dropdown trigger
        │
        ▼
┌─ ACTIVATION ─────────────────────────────────────────┐
│ isDropdownActivation(interaction):                   │
│   - type is NativeDropdown or CustomDropdown         │
│   - OR Click/Unknown on:                             │
│     role=combobox/listbox, DROPDOWN_TRIGGER_CLASSES  │
│     (oxd-select-text, select-wrapper, ant-select,    │
│      headlessui-listbox, select__control)            │
│                                                      │
│ → Create ComponentSession(type='dropdown')           │
│ → Hold trigger interaction                           │
│ → Emit nothing                                       │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ PENDING STATE ──────────────────────────────────────┐
│ Dropdown is open. User browses options.              │
│                                                      │
│ Intermediate events absorbed:                        │
│   - Re-clicks on trigger (toggles open/close)        │
│   - Nav keyword clicks (prev/next/chevron/switch/    │
│     today)                                           │
│   - PageScroll, ContainerScroll, Hover, Tooltip      │
│                                                      │
│ All silently consumed. No output emitted.            │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ COMPLETION ─────────────────────────────────────────┐
│ isDropdownCompletion(interaction):                   │
│   - NativeDropdown/CustomDropdown with selectedValue │
│   - OR Click on: role=option, role=menuitem,         │
│     role=menuitemcheckbox, role=menuitemradio,       │
│     role=treeitem, tag=OPTION, tag=LI                │
│                                                      │
│ → Build: NativeDropdown interaction                  │
│   metadata.selectedValue = completion value          │
│ → Emit semantic interaction                          │
└──────────────────────────────────────────────────────┘
```

**Fallback (timeout):** If no completion arrives within 15s, the session expires. If it has absorbed interactions, the trigger is committed as-is (the dropdown click without a value). If empty, the trigger passes through unchanged.

**Cancellation:** If a PageNavigation or NewTab occurs while the dropdown is open, the session is cancelled. The trigger interaction passes through as a plain click.

#### Date Picker Lifecycle

```
User clicks date input field
        │
        ▼
┌─ ACTIVATION ─────────────────────────────────────────┐
│ isDatePickerActivation(interaction):                 │
│   - type is DatePicker/TimePicker/DateTimePicker     │
│   - OR Click/TextEntry on:                           │
│     date inputType, DATEPICKER_TRIGGER_CLASSES       │
│     (oxd-date-input, react-datepicker, flatpickr)    │
│     date-format placeholder (yyyy-mm-dd)             │
│                                                      │
│ → Create ComponentSession(type='datePicker')         │
│ → Hold trigger interaction                            │
│ → Emit nothing                                       │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ PENDING STATE ──────────────────────────────────────┐
│ Calendar is open. User navigates months.             │
│                                                      │
│ Intermediate events absorbed:                        │
│   - Nav keyword clicks (prev, next, chevron, switch, │
│     today, month, year)                              │
│   - PageScroll, ContainerScroll, Hover, Tooltip      │
│   - All events tagged ownedByDatePicker              │
│     (these are filtered at the evidence engine level,│
│      never even reach the reasoner)                  │
│                                                      │
│ The recorder's date debounce system (800ms) ensures  │
│ only the final date value is emitted as dateSelect.  │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ COMPLETION ─────────────────────────────────────────┐
│ isDatePickerCompletion(interaction):                 │
│   - DatePicker with dateValue/displayValue           │
│   - OR Click on: role=gridcell, role=cell, tag=TD,   │
│     oxd-date-day class                              │
│   - OR TextEntry with date-like value                │
│                                                      │
│ → Build: DatePicker interaction                      │
│   metadata.dateValue = completion value              │
│   metadata.displayValue = human-readable date        │
│ → Emit semantic interaction                          │
└──────────────────────────────────────────────────────┘
```

#### Autocomplete Lifecycle

```
User focuses/types in autocomplete input
        │
        ▼
┌─ ACTIVATION ─────────────────────────────────────────┐
│ isAutocompleteActivation(interaction):               │
│   - type is Autocomplete                             │
│   - OR Click/TextEntry on:                           │
│     AUTOCOMPLETE_TRIGGER_CLASSES                     │
│     (autocomplete, typeahead, oxd-autocomplete,      │
│      combobox-input)                                 │
│     aria-autocomplete="list" or "both"               │
│                                                      │
│ → Create ComponentSession(type='autocomplete')       │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ PENDING STATE ──────────────────────────────────────┐
│ User types query. Suggestions appear.                │
│                                                      │
│ Intermediate events absorbed:                        │
│   - TextEntry interactions (typing)                  │
│   - Clicks on trigger input (re-focus)               │
│   - PageScroll, ContainerScroll, Hover, Tooltip      │
│                                                      │
│ If session expires with typed text but no selection: │
│ → FALLBACK: Emit as TextEntry with the typed value   │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ COMPLETION ─────────────────────────────────────────┐
│ isAutocompleteCompletion(interaction):               │
│   - Autocomplete with selectedValue                  │
│   - OR Click on option-role element or               │
│     suggestion/autocomplete-item/result-item classes │
│                                                      │
│ → Build: Autocomplete interaction                    │
│   metadata.selectedValue = selected option text      │
│ → Emit semantic interaction                          │
└──────────────────────────────────────────────────────┘
```

#### MultiConfig Lifecycle (AdaniOne flight options pattern)

```
User clicks "Economy" fare selector
        │
        ▼
┌─ ACTIVATION ─────────────────────────────────────────┐
│ isMultiConfigActivation(interaction):                │
│   - Click on element with PANEL_TRIGGER_CLASSES:     │
│     flight-options, cabin-selector, passenger-       │
│     selector, filter-panel, config-panel, stepper,   │
│     counter, options-trigger, more-filters           │
│   - OR role=combobox/button/menuitem with options/   │
│     selector/config/counter/stepper in class         │
│                                                      │
│ → Create ComponentSession(type='multiConfig')        │
│ → Store panelLabel from trigger accessibleName        │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ PENDING STATE ──────────────────────────────────────┐
│ Panel is open. User configures multiple fields.      │
│                                                      │
│ Intermediate events absorbed + extracted:            │
│   RadioButton    → configuredFields[field] = "Selected"/"Unselected"│
│   Checkbox/Toggle → configuredFields[field] = "On"/"Off"          │
│   TextEntry      → configuredFields[field] = textValue            │
│   Slider         → configuredFields[field] = sliderValue          │
│   Click (stepper) → configuredFields[field] = "+1"/"-1"           │
│   Dropdown       → configuredFields[field] = selectedValue        │
│   PageScroll, Hover, Tooltip → absorbed (no field extraction)     │
│                                                      │
│ Absorption test: CSS class ancestry overlap with     │
│ trigger (token-based similarity)                     │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ COMPLETION ─────────────────────────────────────────┐
│ isMultiConfigCompletion(interaction):                │
│   Click/Link/Button with accessibleName matching:    │
│   done, apply, confirm, ok, search, update, select,  │
│   continue, set, save                                │
│                                                      │
│ OR outside-click when fields are accumulated:        │
│   User clicks outside the panel → commit             │
│                                                      │
│ → Build: Click interaction with                      │
│   semanticAction = 'configure'                       │
│   configuredFields = { field: value, ... }           │
│   panelLabel = trigger accessibleName                │
│ → Emit: "Configure {panel}: field=value, ..."        │
└──────────────────────────────────────────────────────┘
```

#### FormSubmit Lifecycle (Login pattern)

```
User enters password field
        │
        ▼
┌─ ACTIVATION ─────────────────────────────────────────┐
│ isFormSubmitActivation(interaction):                 │
│   TextEntry on element where name/ariaLabel/         │
│   accessibleName/placeholder contains:               │
│   password, passwd, pwd                              │
│                                                      │
│ → Create ComponentSession(type='formSubmit')         │
│                                                      │
│ Note: Does NOT absorb preceding TextEntry            │
│ interactions (username, email). Those pass through   │
│ normally. But they ARE enriched with form context    │
│ so the reasoner can recognize the login flow.        │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ PENDING STATE ──────────────────────────────────────┐
│ FormSubmit does NOT absorb interactions.             │
│ All subsequent TextEntry interactions are enriched   │
│ with formSubmitAction metadata so the reasoner can   │
│ recognize they're part of a form submission.         │
└──────────────────────────────────────────────────────┘
        │
        ▼
┌─ COMPLETION ─────────────────────────────────────────┐
│ isFormSubmitCompletion(interaction):                 │
│   Click/Link/Button with accessibleName matching:    │
│   login, sign in, signin, log in, submit, register,  │
│   sign up, signup, continue, next, create account    │
│                                                      │
│ → Build: Preserves original interaction type         │
│   semanticAction = 'authenticate'                    │
│   formSubmitAction = matched keyword                 │
│ → Emit: "Log in (sign in) → {url}"                   │
│                                                      │
│ Then: if PageNavigation follows within 3000ms,       │
│ the Navigation Lookback (Check 0) merges the submit  │
│ click with the navigation into a single              │
│ PageNavigation carrying semantic context.            │
└──────────────────────────────────────────────────────┘
```

#### Checkbox / Radio / Toggle Lifecycle

These are **single-event interactions** — they do NOT have multi-event lifecycles. The recorder captures:
- `checkedBefore` from the value tracker (snapshotted on `mousedown`)
- `checkedAfter` via `setTimeout(0)` (browser updates state after the click event)

The V1/V2 classifiers recognize them directly. The semantic reasoner passes them through unless they're inside a MultiConfig panel (in which case they're absorbed as configured fields).

#### Navigation Lifecycle

Navigation events are injected by the service worker, not captured by the content script. They are:
1. Deduped (consecutive same-URL navigations are skipped)
2. Classified by `transitionType` (reload→Refresh, etc.)
3. In the semantic reasoner: **merged** with the preceding click if within 3000ms

The merge creates a single `PageNavigation` interaction carrying both the click metadata (accessibleName, target identity) and the navigation metadata (url, title, transitionType). This is how "Click Login button → dashboard loads" becomes "Navigate to /dashboard (from clicking 'Login')".

#### Scroll Lifecycle

Scroll is a **single-event interaction** with heavy filtering:
- <100px delta → ignored
- Within 1s of click → ignored
- 200ms debounce → coalesced

Classified as PageScroll (HTML/BODY target) or ContainerScroll (specific container). The semantic reasoner absorbs scroll events into active component sessions (they're noise during dropdown navigation, calendar scrolling, etc.).

---

## 10. Guard Rails

### Complete Guard Rail Catalogue

| # | Guard Rail | Location | Threshold/Condition | What It Prevents |
|---|-----------|----------|---------------------|-----------------|
| 1 | **Container Noise Click Suppression** | Recorder click/dblclick handler | Container tag (DIV, SECTION, etc.) AND (accessibleName > 80 chars OR ≤ 2 chars OR empty). Exception: dropdown trigger classes never suppressed. | Clicks on large layout containers that produce meaningless noise like "Click Employee Full Name Employee Id Othe..." |
| 2 | **Date-Format Placeholder Detection** | `isDateFormatPlaceholder()` | String split on delimiters, ≥2 tokens matching {yyyy, yy, mm, dd, d, m} | Custom date input placeholders ("yyyy-mm-dd") being used as field labels |
| 3 | **Date Trigger Element Detection** | `isDateTriggerElement()` | Native date inputType, `aria-haspopup="dialog/grid"`, date keywords in combined attributes, or date-format placeholder | Date inputs being treated as text entry (focus/blur/input noise) |
| 4 | **Text Entry Element Guard** | `isTextEntryElement()` | TEXTAREA (not readonly), INPUT with text-like type (not date/checkbox/radio/button), contentEditable, or `role="textbox"` | Focus/blur/input events on buttons, date pickers, divs, calendar cells |
| 5 | **Calendar Popover Ownership Tagging** | Click/dblclick/scroll handlers | `isInsideCalendarPopover(target)` → tag `ownedByDatePicker=true` | Events inside calendar popovers producing standalone interactions instead of being absorbed by the date picker lifecycle |
| 6 | **Calendar Cell Detection** | `isCalendarCell()` | `role="gridcell"` or class matching day/cell/date/gridcell/calendar/react-datepicker | Calendar day clicks being classified as generic clicks |
| 7 | **Calendar Popover Containment** | `isInsideCalendarPopover()` | Walks 10 ancestors checking role=grid/gridcell, calendar class patterns, date data attributes | Same as #5 — prevents calendar-internal events from leaking |
| 8 | **Value Tracker Duplicate Suppression** | Input handler | Text-entry input events silently update tracker, never emitted | Per-keystroke noise (10 input events for typing "hello") |
| 9 | **Checkbox/Radio Input Suppression** | Input handler | Input events on checkbox/radio suppressed | Duplicate state change events (click handler captures the transition) |
| 10 | **Select Input Suppression** | Input handler | Input events on `<select>` suppressed | Duplicate value change events (change event carries the committed value) |
| 11 | **Label Click Suppression** | Click/dblclick handler | `HTMLLabelElement` containing input/button/select/textarea, or with `for` pointing to form control | Duplicate events from browser's label→control click forwarding |
| 12 | **Hover Post-Click Cooldown** | Mouseover handler | `HOVER_COOLDOWN_MS = 1500` ms after any click | Hover artifacts from UI changes triggered by clicks (calendar opening, dropdown expanding) |
| 13 | **Hover Container Exclusion** | Mouseover handler | Elements inside dialog/grid/calendar/modal/popup/overlay containers skipped | Hover noise inside active components |
| 14 | **Hover Visible-Change Requirement** | `startHoverTracking()` | 300ms window: CSS `:hover` rule analysis + MutationObserver. Only emits if visible change detected | Every mouseover producing a hover event |
| 15 | **Scroll Delta Threshold** | Scroll handler | `delta < 100px` → ignored (baseline always updated to prevent accumulation) | Small scrolls triggered by UI changes (calendar, dropdown) |
| 16 | **Scroll Post-Click Suppression** | Scroll handler | Scrolls within 1000ms of a click → ignored | Scrolls caused by UI changes after clicking |
| 17 | **Scroll Debounce** | Scroll handler | 200ms coalescing window | Rapid scroll bursts producing multiple events |
| 18 | **Date Picker Debounce** | `handleDateValueChange()` | `DATE_DEBOUNCE_MS = 800` ms, flushed on blur | Intermediate date states while navigating a calendar |
| 19 | **Untrusted Event Rejection** | All handlers | `event.isTrusted === false` → ignored | Synthetic events from frameworks |
| 20 | **Left-Button-Only Click** | Click handler | `event.button !== 0` → ignored | Middle/right-click noise (contextmenu handles right-click) |
| 21 | **Surface Detection Timeout** | `detectSurfaceAfterClick()` | `SURFACE_DETECTION_MS = 500` ms MutationObserver | Missing dynamically appearing surfaces AND running indefinitely |
| 22 | **Stale Session Cleanup** | Semantic reasoner | `DEFAULT_SESSION_TIMEOUT_MS = 15000` ms | Component sessions living forever if completion never arrives |
| 23 | **Evidence Combination Threshold** | `combineEvidence()` | `COMMIT_THRESHOLD = 0.5` — winning score below this → Unknown | Low-confidence guesses being committed as interactions |
| 24 | **Composite Control Timeout** | Evidence engine | `COMPOSITE_TIMEOUT_MS = 10000` ms for pending buffers | Incomplete composite controls held indefinitely |
| 25 | **CSS-in-JS Class Exclusion** | CssClassnameProvider | `css-*`, `sc-*`, `emotion-*`, `styled-*`, `react-*`, `__*` classes excluded | Framework-generated hashed classes producing false positive pattern matches |
| 26 | **Auto-Generated ID Filtering** | Locator ranking | IDs matching `react-*`, `mui-*`, `ng-*`, `cdk-*`, `v-*`, `sc-*`, `css-*`, `__BVID__*`, `headlessui-*`, `radix-*` filtered out | Fragile framework-generated IDs being used as locators |
| 27 | **TextEntry Evidence Suppression** | Evidence engine commit | When calendar cell is present in buffer, TextEntry evidence is filtered out | Date picker interactions being classified as text entry |
| 28 | **Navigation Dedup** | `RecordingSession.addNavigation()` | Consecutive navigations to same URL → skipped | Duplicate navigation events from redirects |
| 29 | **Blur Guard** | Blur handler | `if (!snapshot) return` — only sends blur for elements tracked on focus | Blur events for elements that were never focused |
| 30 | **CheckedAfter Deferred Read** | Click handler | `setTimeout(0)` before reading `checkedAfter` | Reading checkbox/radio state before browser updates it |

---

## 11. Decision Engine

### How the Recorder Decides "This is a dropdown"

The decision is made through **parallel evidence collection + weighted voting + merge**. No single "decision engine" function exists — the decision emerges from the interaction of multiple independent components.

### Evidence Evaluation Flow

```
Raw Events on Element X
        │
        ├──→ DomProvider says: tag=SELECT → NativeDropdown @ 0.99/1.0
        │
        ├──→ AriaProvider says: role=combobox → CustomDropdown @ 0.85/0.85
        │
        ├──→ CssClassnameProvider says: ant-select → CustomDropdown @ 0.8/0.75
        │
        ├──→ EventSequenceProvider says: click→change → NativeDropdown @ 0.75/0.7
        │
        ├──→ MutationProvider says: aria-expanded cycle → CustomDropdown @ 0.7/0.6
        │
        ▼
combineEvidence():
  Group by suggestedType:
    NativeDropdown: scores = [(0.99×1.0 + 0.75×0.7) / (1.0+0.7)] = 1.045/1.7 = 0.615
    CustomDropdown: scores = [(0.85×0.85 + 0.8×0.75 + 0.7×0.6) / (0.85+0.75+0.6)]
                       = 1.69/2.2 = 0.768

  Winner: CustomDropdown @ 0.768 (≥0.5 threshold)
```

### Conflict Resolution

When providers disagree (e.g., DOM says NativeDropdown, ARIA says CustomDropdown), the **weighted average** resolves it. Higher-weight providers have more influence. A single high-weight provider (like DomProvider at weight 1.0 for native elements) can carry the classification even if other providers disagree.

### Priority Rules

| Decision | Priority Rule |
|----------|--------------|
| V2 vs V1 | V2 always wins. V2 gets first claim on all events. V1 only classifies events V2 couldn't. |
| Within V2 | Highest weighted average score wins. If < 0.5, type = Unknown. |
| Calendar cell + TextEntry in same buffer | Calendar cell wins. TextEntry evidence is filtered out. |
| Semantic reasoner activation | autocomplete > datePicker > dropdown > multiConfig > formSubmit |
| Semantic reasoner checks per interaction | Navigation lookback → stale cleanup → cancellation → completion → absorption → outside-click → activation → pass-through |

### Confidence Calculation

```
For each evidence group (same suggestedType):
  score = Σ(confidence_i × weight_i) / Σ(weight_i)

Winner = type with highest score (if ≥ 0.5)

Final confidence = winner.score (rounded to 3 decimal places)
```

### Confidence Interpretation

| Range | Meaning | Examples |
|-------|---------|---------|
| 0.95–1.0 | Near-certain | Native HTML elements (`<select>`, `<input type="checkbox">`) |
| 0.80–0.94 | High confidence | ARIA role match + CSS class agreement |
| 0.60–0.79 | Moderate | Single provider match, or behavioral inference |
| 0.50–0.59 | Low | Weak signal — barely above threshold |
| < 0.50 | Unknown | No provider reached threshold → fallback to V1 |

---

## 12. Merge & Semantic Processing

### Merge Strategy (V1 + V2)

The merge layer is **V2-primary with V1 fallback**:

1. **V2 gets first claim** — All events classified by V2 with confidence ≥ 0.5 are "claimed"
2. **V1 fills gaps** — V1 interactions are kept only if NONE of their events overlap with V2's claimed set
3. **No event duplication** — Each raw event appears in exactly one merged interaction
4. **Engine tagging** — Each interaction is tagged `engine='v2'` or `engine='v1-fallback'`

This means V1 only classifies interactions that V2 couldn't handle confidently — it's a safety net, not a co-equal classifier.

### Semantic Reasoning Strategy

The semantic reasoner is a **stream processor** — it processes interactions one-by-one in order, maintaining state across interactions via ComponentSessions.

**Key insight:** The reasoner operates on the complete `DetectedInteraction[]` stream. It sees every interaction in sequence, allowing it to:
1. Recognize that a dropdown trigger click is the START of a multi-event workflow
2. Absorb subsequent interactions (scroll, hover, option click) into the session
3. Wait for the completion signal before emitting the final semantic interaction
4. Cancel the session if a navigation or timeout invalidates it

This is fundamentally different from per-interaction classification — the reasoner has **context awareness** across the interaction stream.

### Grouping (Component Sessions)

The reasoner groups interactions into sessions based on:

| Component Type | Grouping Signal |
|----------------|----------------|
| **Dropdown** | Trigger element matches dropdown classes/roles → subsequent option clicks are grouped |
| **Date Picker** | Trigger element is date input/datepicker class → subsequent gridcell clicks and date changes are grouped |
| **Autocomplete** | Trigger is autocomplete/typeahead input → subsequent text entry and suggestion clicks are grouped |
| **MultiConfig** | Trigger has panel-trigger classes → all interactions sharing CSS class ancestry are grouped |
| **FormSubmit** | Trigger is password field entry → subsequent submit keyword click + navigation are grouped |

### Interaction Collapsing

The collapsing rules:

| Input Interactions | Output |
|-------------------|--------|
| Click trigger + Click option + Scroll | Single: "Select Belgian for Nationality" |
| Click date input + Click prev month + Click day | Single: "Select date 2023-10-21 for Date of Birth" |
| Click autocomplete + TextEntry "bel" + Click suggestion | Single: "Search 'bel' then select 'Belgian'" |
| Click Economy + Click +Adults + Select Premium + Click Done | Single: "Configure Flight Options: Cabin=Premium Economy, Adults=+1" |
| Enter username + Enter password + Click Login + Navigate | Enter username + Enter password + "Log in → /dashboard" |
| Click + PageNavigation within 3s | Single merged PageNavigation |

---

## 13. Domain Pipeline

### Purpose

The domain pipeline transforms the recording from a list of interactions into **structured understanding** of the application. It answers questions like: "What pages did the user visit? What UI elements exist? What capabilities did the user exercise?"

### Four Stages

#### Stage 1: Domain Adapter (`adaptToDomainEntities()`)

Converts `RecordedEvent[]` + `DetectedInteraction[]` into:

- **`UiElement[]`** — Unique UI elements encountered, with:
  - `elementId`, `tagName`, `role`, `accessibleName`, `locator strategies`
  - `pageUrl` (where encountered), `firstSeenAt`, `lastSeenAt`
  - `interactionCount`, `interactionTypes[]`
- **`ObservedTransition[]`** — State changes observed:
  - `fromValue`, `toValue`, `transitionType` (fill, select, toggle, etc.)
  - `elementId`, `interactionId`

#### Stage 2: Recognition (`runRecognition()`)

Groups UiElements into `ComponentGrouping[]` — structural patterns like:
- Form fields that belong together
- Navigation elements
- Repeating list items
- Table structures

This uses structural recognizers that look at DOM hierarchy and element relationships.

#### Stage 3: Enrichment (`enrichSession()`)

Ten enrichment modules process the entities:

1. **Label Enrichment** — Resolves business-friendly labels from accessible names, placeholders, and context
2. **Locator Enrichment** — Ranks and filters locator candidates
3. **Validation Enrichment** — Extracts form constraints (required, min/max, pattern)
4. **Assertion Enrichment** — Generates assertions from observed state transitions
5. **Workflow Enrichment** — Identifies multi-step workflows
6. **Page Enrichment** — Groups elements by page URL
7. **Option Set Enrichment** — Extracts dropdown/select options (requires DOM access — skipped in service worker via no-op inspector)
8. **Business Field Enrichment** — Maps technical element names to business domain labels
9. **Relationship Enrichment** — Links related elements (label→input, trigger→popover)
10. **Capability Enrichment** — Identifies what application capability the recording demonstrates

Output: `ApplicationKnowledgeFragment` with assertions, business field labels, workflow description.

#### Stage 4: Capability Derivation (`deriveCapability()`)

Examines the knowledge fragment and derives a `CapabilityCandidate`:
- What business capability was demonstrated? (e.g., "User Login", "Create Employee Record")
- What are the key steps?
- What assertions should hold?

### Limitations

**No DOM access in service worker:** The enrichment pipeline runs in the service worker, which has no DOM access. The `createNoOpDomInspector()` returns null/empty for all DOM queries. This means:
- Option set extraction is skipped (can't read `<option>` elements)
- Dynamic ARIA state resolution is unavailable
- Live CSS computation is unavailable

This is a known gap. The planned solution is the Foundation Pipeline's EventTap, which would collect this information in the content script (where DOM access exists) and send it as structured evidence.

---

## 14. IR Generation

### Purpose

Convert semantic interactions + application understanding into a framework-neutral execution plan that any test framework adapter can consume.

### IR Bridge (`ir-bridge.ts`)

**Input:**
```typescript
{
  events: SessionEvent[],
  interactions: DetectedInteraction[],    // semantic interactions
  understanding: UnderstandingResult,     // knowledge fragment + capability
  recordingContext: { startUrl, title },
  testCaseName: string
}
```

**Process:**

1. **Build event index** — Map actionId → SessionEvent for O(1) lookup
2. **Iterate interactions** — Skip noise types (PageScroll, ContainerScroll, InfiniteScroll, Unknown)
3. **Correlate events** — Match interactions to their source events via actionId
4. **Resolve targets** — Element targets (with locators) or URL targets
5. **Generate steps** — One IRStep per interaction, numbered `step-0001`, `step-0002`, ...
6. **Apply readability rules** — Merge consecutive duplicate-click steps, merge consecutive fill steps on same element
7. **Generate tags** — From URL path segments + surface transitions
8. **Set environment** — baseUrl, browser, viewport

### Interaction Type → IR Action Mapping

| IRAction | Source Types |
|----------|-------------|
| NAVIGATE | PageNavigation |
| CLICK | Click, DoubleClick, RightClick, DragDrop, Link, Tab, Menu, Breadcrumb, RadioButton |
| HOVER | Hover, Tooltip |
| FILL | TextEntry, Slider, FileUpload, DragDropUpload |
| SELECT | NativeDropdown, CustomDropdown, MultiSelect, Autocomplete |
| SELECT_DATE | DatePicker, TimePicker, DateTimePicker |
| TOGGLE | Checkbox, ToggleSwitch |
| VERIFY | (assertion-only, from understanding) |

### Locator Generation (Priority Categories)

Locators are ranked in 5 categories. The top 3 are kept per step.

| Priority | Category | Confidence | Examples |
|----------|----------|------------|---------|
| 1 | **BUSINESS** | 0.90 | `data-testid` (0.95), `data-cy`, `data-qa` |
| 2 | **ACCESSIBILITY** | 0.80 | `aria-label` → ROLE, `aria-labelledby` → ACCESSIBLE_NAME |
| 3 | **STABLE_TECHNICAL** | 0.72 | DOM `id` → CSS `#id` (0.75), `name` → CSS `tag[name=val]` (0.70) |
| 4 | **CONTENT** | 0.62 | role+name → ROLE (0.65), accessibleName → ACCESSIBLE_NAME (0.65), placeholder (0.60) |
| 5 | **STRUCTURAL** | 0.35 | cssSelector → CSS (0.40), xPath → XPATH (0.30) |

**Filtering rules:**
- Auto-generated IDs (`react-*`, `mui-*`, `headlessui-*`, etc.) are removed
- CSS-in-JS hashed classes (`.css-*`, `.sc-*`) are removed
- Values >100 chars or with newlines are removed (non-CSS/XPATH)

### Assertion Generation

Reads constraints from the `ApplicationKnowledgeFragment`:

| Constraint | Assertion |
|-----------|-----------|
| `required` | PRESENCE / IS_TRUE |
| `valueRange` (min/max) | GREATER_THAN / LESS_THAN |
| `lengthRange` | GREATER_THAN / LESS_THAN |
| `format.regex` | TEXT_MATCH / MATCHES |
| `validOptions` | EQUALS |

### Description Generation

Human-readable descriptions per interaction type:
- `"Fill 'john@example.com' in the Email field"`
- `"Select 'Belgian' from Nationality"`
- `"Navigate to /dashboard"`
- `"Check 'Remember me'"`

### Readability Rules

| Rule | Effect |
|------|--------|
| **OR-1** | Merge consecutive CLICK steps on the same element — keep first, discard rest |
| **OR-2** | Merge consecutive FILL steps on the same element — keep last (final committed value) |

### Code Generation (Playwright Adapter)

The `ExecutionIRPlan` is consumed by `PlaywrightCodeGenerator`:

**Locator rendering:**
| IR Locator Type | Playwright Expression |
|----------------|----------------------|
| ROLE | `getByRole('button', { name: 'Submit' })` |
| ACCESSIBLE_NAME | `getByLabel('Email')` |
| TEST_ID | `getByTestId('submit-btn')` |
| TEXT | `getByText('Login')` |
| PLACEHOLDER | `getByPlaceholder('Enter email')` |
| CSS | `locator('.form > input')` |
| XPATH | `locator('xpath=//div[@id="x"]')` |

**Action rendering:**
| IRAction | Playwright Method |
|----------|-------------------|
| CLICK | `.click()` |
| FILL | `.fill('value')` |
| SELECT | `.selectOption('value')` |
| SELECT_DATE | `.fill('2023-10-21')` |
| TOGGLE | `.check()` / `.uncheck()` / `.click()` |
| HOVER | `.hover()` |
| NAVIGATE | `page.goto('url')` |

**Generated project structure (flat pattern):**
```
project/
├── package.json          (devDeps: @playwright/test)
├── playwright.config.ts  (baseURL, viewport, retries, reporter)
├── tsconfig.json         (ES2020, strict)
├── .gitignore
└── tests/
    └── {test-name}.spec.ts
```

---

## 15. Phase Status

### Implementation Status Table

| Component | Purpose | Status | Wired to Production | Tested | Remaining Work |
|-----------|---------|--------|---------------------|--------|---------------|
| **Deterministic Recorder** | Content script: capture DOM events with full identity + context | ✅ Complete | ✅ Yes | ✅ 3800+ tests | Minor fixes for new edge cases |
| **Service Worker** | Orchestration: recording lifecycle, pipeline invocation, storage | ✅ Complete | ✅ Yes | ✅ Yes | Modernization planned (split into modules) |
| **Recording Session** | In-memory event storage, debounced persistence, restore on SW restart | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **V1 Classifier** | Structural classification: group events, classify via priority chain | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **V2 Evidence Engine** | Evidence-based classification: 5 providers, weighted voting, buffer management | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Merge Layer** | V2-primary merge with V1 fallback | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Semantic Reasoner** | Component lifecycle collapsing: dropdown, datePicker, autocomplete | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Semantic Reasoner (MultiConfig)** | Multi-field panel collapsing: flight options, filters, passenger selectors | ✅ Complete | ✅ Yes | ✅ Yes (24 tests) | — |
| **Semantic Reasoner (FormSubmit)** | Form submission flow recognition: login, register | ✅ Complete | ✅ Yes | ✅ Yes (24 tests) | — |
| **Domain Adapter** | Events+interactions → UiElement[] + ObservedTransition[] | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Recognition Pipeline** | Structural + behavioral recognition → ComponentGrouping[] | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Enrichment Pipeline** | 10 modules → ApplicationKnowledgeFragment | ✅ Complete | ✅ Yes | ✅ Yes | No DOM access in SW (no-op inspector) |
| **Capability Derivation** | Knowledge fragment → CapabilityCandidate | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **IR Bridge** | Interactions + understanding → ExecutionIRPlan | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Playwright Code Generator** | IR → .spec.ts files | ✅ Complete | ✅ Yes | ✅ Yes | POM pattern generation exists but flat is default |
| **Repository V2 Persistence** | Dexie/IndexedDB storage of sessions and capabilities | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Self-Healing Locators** | Heal broken locators from recording context | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Execution Engine** | Run tests via Playwright runner | ✅ Complete | ✅ Yes | ✅ Yes | — |
| **Side Panel UI** | 4 views: home, new-tc, recording, stopped | ✅ Complete | ✅ Yes | ✅ Yes | Modernization planned |
| **Foundation Pipeline (EventTap)** | Modular content script: 5 evidence channels, structured evidence | ⚠️ Built, NOT wired | ❌ No | ✅ Unit tested (17% accuracy in integration) | Needs wiring + quality fixes (5 root causes identified) |
| **Foundation Pipeline (Recognition)** | Declarative pattern matching (data-driven, no hardcoded logic) | ⚠️ Built, NOT wired | ❌ No | ✅ Unit tested | Same as above |
| **Foundation Pipeline (Lifecycle Engine)** | Generic state machine interpreter (5 declarative definitions) | ⚠️ Built, NOT wired | ❌ No | ✅ Unit tested | Same as above |
| **Control Recorder** | Control-model-based capture (pre-discovers controls) | ⚠️ Built, NOT active | ❌ Dormant (flag-gated) | ✅ Unit tested | Needs flag flip + integration testing |
| **Control Model** | DOM control discovery + framework adapters | ⚠️ Built, NOT active | ❌ Dormant | ✅ Unit tested | Same as above |
| **Service Worker Modernization** | Split monolith into SessionManager + MessageRouter + PipelineOrchestrator | ❌ Not started | — | — | Phase 8-9 (SW) spec exists |
| **Side Panel Modernization** | Split 1,301-line monolith into modular components | ❌ Not started | — | — | Phase 9 (UI) spec exists |
| **SPA Navigation Detection** | Capture History API (pushState/replaceState/popstate) route changes | ❌ Not started | — | — | Gap noted in freeze assessment |
| **Multi-Tab Recording** | Record across multiple tabs simultaneously | ❌ Not started | — | — | — |
| **Full-Page Screenshots** | Beyond captureVisibleTab | ❌ Not started | — | — | — |

### What's Complete and Production-Wired

The end-to-end pipeline is **fully functional** from recording through code generation:

```
✅ Content Script (deterministic-recorder.ts)
  → ✅ 13 capture-phase event listeners
  → ✅ Target resolution (composedPath, Shadow DOM)
  → ✅ Element identity (22+ fields)
  → ✅ Value tracking (before/after)
  → ✅ RECORDED_EVENT → Service Worker
    → ✅ V1/V2 Classification → Merge
    → ✅ Semantic Reasoning (5 component types)
    → ✅ Domain Adapter → Recognition → Enrichment → Capability
    → ✅ IR Bridge → ExecutionIRPlan
    → ✅ Playwright Code Generation
    → ✅ Repository V2 Persistence
    → ✅ Self-Healing
    → ✅ Execution Engine
  → ✅ Side Panel (4 views)
```

---

## 16. Known Architectural Gaps

### Gap 1: Foundation Pipeline Not Wired (37 files dormant)

**What's missing:** The complete `src/pipeline/` directory (EventTap, 5 evidence channels, recognition pipeline, lifecycle engine) is fully implemented and unit-tested but NOT connected to the content script. It coexists alongside `deterministic-recorder.ts`.

**Why it's not complete:** The foundation pipeline was built ahead of its wiring. Integration testing revealed 17% accuracy — five root causes were identified:
1. Previous interaction's blur contaminates next unit (target attribution error)
2. State diff finds 0 changes for most interactions (snapshot timing issue)
3. Custom ARIA widgets fall to generic click (no deferred ARIA read)
4. Multi-step interactions not grouped (dropdown trigger + option = 2 clicks)
5. Range slider misclassified as text entry

**What problems it causes:** None directly — the production pipeline works. But the foundation pipeline represents the intended cleaner architecture (modular, declarative, data-driven). Its dormancy means the codebase has two parallel architectures.

**Intended solution:** Fix the 5 root causes, then wire the EventTap to replace `deterministic-recorder.ts` as the capture layer.

### Gap 2: No SPA Navigation Detection

**What's missing:** Only `chrome.webNavigation.onCommitted` (full page loads) is captured. SPA route changes via History API (`pushState`, `replaceState`, `popstate`) are silently missed.

**Why it's not complete:** The `webNavigation` API doesn't fire for SPA navigation. Adding a `popstate` listener + History API interception in the content script is needed.

**What problems it causes:** Recordings on SPA apps (React Router, Next.js, Vue Router) miss navigation events between routes. The semantic reasoner can't recognize "click Login → dashboard loads" because the dashboard load isn't captured as a navigation.

**Intended solution:** Add a content-script-side navigation detector that patches `history.pushState`/`replaceState` and listens for `popstate`.

### Gap 3: Control Recorder Dormant

**What's missing:** `control-recorder.ts` (844 lines) and its `ControlModel` are built and tested but inactive by default (`recorderEngine` flag defaults to `'legacy'`).

**Why it's not complete:** The control model's `discover()` + `matchEvent()` approach is fundamentally different from the heuristic cascade in `deterministic-recorder.ts`. It needs comprehensive integration testing against real apps before it can replace the legacy recorder.

**What problems it causes:** The heuristic target resolution cascade (Strategy 1→2→3) sometimes picks the wrong element on complex enterprise apps. The Control Model would resolve this by pre-discovering controls and matching events to them directly.

**Intended solution:** Flip the flag after integration testing validates accuracy across OrangeHRM, AdaniOne, and other target apps.

### Gap 4: Enrichment Without DOM Access

**What's missing:** The enrichment pipeline runs in the service worker, which has no DOM access. A no-op DOM inspector is used, meaning option sets, dynamic ARIA states, and live CSS computation are unavailable.

**Why it's not complete:** Architecture limitation — the service worker can't access the page DOM. The planned solution (Foundation Pipeline's EventTap) would collect this data in the content script.

**What problems it causes:** Option sets for dropdowns aren't extracted. Assertions that depend on dynamic DOM state aren't generated. Business field labels that require DOM context aren't resolved.

**Intended solution:** Foundation Pipeline wiring (Gap 1) would provide structured DOM evidence collected at capture time.

### Gap 5: No Read/Edit/Delete on Steps

**What's missing:** After recording, users cannot edit, delete, reorder, or annotate steps.

**Why it's not complete:** Not yet implemented — the side panel is read-only display.

**What problems it causes:** Users must re-record if any step is wrong. No way to add manual assertions or comments.

**Intended solution:** Side panel modernization (Phase 9 UI).

### Gap 6: Service Worker Monolith

**What's missing:** `service-worker.ts` (~900 lines) handles recording lifecycle, pipeline orchestration, storage, tab management, health checks, test execution, healing, and repository persistence in a single file.

**Why it's not complete:** Service Worker Modernization (Phase 8-9 SW) was planned but not started.

**What problems it causes:** Difficult to maintain and extend. Pipeline orchestration logic is tangled with message routing.

**Intended solution:** Split into SessionManager, MessageRouter, PipelineOrchestrator modules.

### Gap 7: Ancestor CSS Class Extraction

**What's missing:** The recorder captures ancestor ROLES (`tag[role=X]`) up to 10 levels but NOT ancestor CSS CLASSES. Foundation Pipeline Channel B was designed to capture both but isn't wired.

**Why it's not complete:** `captureAncestorRoles()` was implemented but `captureAncestorClasses()` was not.

**What problems it causes:** OXD/MUI/AntD wrapper detection (which relies on ancestor class patterns like `.oxd-input-field`) is less reliable. The recorder compensates with inline OXD-specific logic in `getImplicitRole()` and `computeAccessibleName()`, but this is hardcoded rather than evidence-based.

**Intended solution:** Add ancestor class capture to the production recorder or wire the Foundation Pipeline's Channel B.

### Gap 8: Single-Locator Code Generation

**What's missing:** The Playwright code generator uses only the highest-priority locator. Fallback locators are not included in the generated code.

**Why it's not complete:** Code generation was implemented for the primary locator only.

**What problems it causes:** If the primary locator breaks, the generated test has no fallback. The self-healing system compensates at runtime, but the generated code is brittle.

**Intended solution:** Include fallback locators as commented alternatives or as a locator chain.

---

## 17. Architecture Self-Review

### Duplicated Logic

| Duplication | Location | Impact |
|-------------|----------|--------|
| **Two parallel classification systems** | V1 classifier (`interaction-detector.ts`) + V2 evidence engine (`evidence/engine.ts`) | V1 exists as a fallback safety net. It duplicates much of V2's logic (dropdown detection, text entry detection, date picker detection) with different heuristics. The merge layer keeps both, but V1 only contributes when V2 fails. |
| **Two parallel capture systems** | `deterministic-recorder.ts` (3033 lines) + `src/pipeline/tap/event-tap.ts` (foundation) | Both implement the same 13 event listeners, target resolution, identity extraction, and value tracking. The foundation version is modular; the production version is a monolith. |
| **Two parallel lifecycle systems** | `semantic/reasoner.ts` (ComponentSessions) + `pipeline/lifecycle/lifecycle-engine.ts` (declarative state machines) | Both implement dropdown, date picker, and text entry lifecycles. The semantic reasoner is wired; the lifecycle engine is not. They use different models (imperative sessions vs declarative definitions). |
| **Target resolution** | `deterministic-recorder.ts:resolveTarget()` + `pipeline/tap/target-resolver.ts` | Both implement the same 3-strategy cascade with the same INTERACTIVE_SELECTOR. |
| **Identity extraction** | `deterministic-recorder.ts:extractIdentity()` + `pipeline/tap/identity-extractor.ts` | Both extract the same 18+ fields with the same resolution chains. |
| **Date picker capture** | Inline in `deterministic-recorder.ts` + `control-recorder.ts:handleDateValueChange()` | Both implement date debounce (800ms), calendar cell detection, date normalization. The control recorder version is a simplified copy. |

### Overlapping Lifecycle Systems

The most significant architectural overlap is between:

1. **`semantic/reasoner.ts`** — Imperative, stream-based ComponentSession processor with 5 component types. Wired to production. 793 lines.
2. **`pipeline/lifecycle/lifecycle-engine.ts`** — Declarative, generic state machine interpreter with 5 LifecycleDefinitions. NOT wired. 521 lines.

Both solve the same problem (collapse multi-event component workflows into semantic interactions) but with different approaches. The semantic reasoner is more battle-tested but has hardcoded logic per component type. The lifecycle engine is data-driven (adding a lifecycle = adding a definition) but hasn't been validated in production.

**Recommendation:** When the Foundation Pipeline is wired, the lifecycle engine should replace the semantic reasoner. Until then, both must be maintained.

### Architectural Inconsistencies

| Inconsistency | Description |
|---------------|-------------|
| **Evidence engine class name** | Class is `InteractionEngine` but the concept is called "Evidence Engine" throughout documentation. The file header says "Evidence Engine." |
| **`isLargeContainerClick()` doesn't exist** | The concept exists as `isContainerNoiseClick()` but some code references and documentation use the non-existent name. |
| **`captureAncestorClasses()` vs `captureAncestorRoles()`** | The function captures roles, not classes, despite some references suggesting otherwise. |
| **NOISE_TYPES in IR bridge** | Scroll types are mapped to CLICK in `INTERACTION_TO_IR_ACTION` but then filtered as noise in the iteration. The mapping is misleading. |
| **`generator.ts` vs `ir-bridge.ts`** | Two IR generators exist: `ir-bridge.ts` (recording → IR, wired) and `generator.ts` (repository ATC → IR, not in recording flow). Easy to confuse. |

### Unnecessary Complexity

| Area | Complexity | Justified? |
|------|-----------|------------|
| **V1+V2 dual classifier** | Two complete classification systems + merge layer | ✅ Justified — V2 occasionally misses patterns V1 catches. The merge layer is cheap (188 lines). Removing V1 would lose the safety net. |
| **Evidence provider weighting** | Separate confidence and weight per evidence | ✅ Justified — allows a single authoritative provider to override multiple weaker ones. Without this, the 5 providers would often tie. |
| **5 semantic component types** | dropdown, datePicker, autocomplete, multiConfig, formSubmit | ✅ Justified — each has distinct activation/completion/absorption logic. MultiConfig and FormSubmit were added to handle real-world workflows (AdaniOne, OrangeHRM login). |
| **Page-world script injection** | Wraps alert/confirm/prompt/window.open in injected script | ✅ Justified — these APIs can't be intercepted from the isolated world. |
| **Foundation Pipeline (37 files)** | Complete parallel architecture, not wired | ⚠️ Not justified in current state — represents significant maintenance overhead with no production value. Justified only if it will be wired soon. |

### Dead Code

| Component | Location | Status |
|-----------|----------|--------|
| Foundation Pipeline (37 files) | `src/pipeline/` | Built, tested, NOT wired. EventTap comments confirm: "NOT wired yet." |
| `DefaultIRGenerator` | `src/domain/execution-ir/generator.ts` (388 lines) | ATC → IR path, not used in recording pipeline |
| Architecture C components | Various | Confidence Engine, Workflow Analyzer, Audit Manager — "implemented but not wired." Phase 7 cleanup partially done. |
| `control-recorder.ts` + Control Model | `src/recorder/v2/` | Built, tested, dormant by feature flag |

### Opportunities for Simplification

1. **Wire Foundation Pipeline OR remove it.** 37 files of dormant code is the single largest complexity source. If the wiring is deferred indefinitely, these files should be archived to reduce cognitive load.

2. **Merge the two lifecycle systems.** When Foundation Pipeline is wired, the declarative LifecycleEngine should replace the imperative semantic reasoner. Maintaining both is error-prone.

3. **Consolidate date picker logic.** Date capture exists in `deterministic-recorder.ts`, `control-recorder.ts`, and the Foundation Pipeline's channels. After one capture system is chosen, the others should be removed.

4. **Move enrichment DOM access to content script.** The no-op DOM inspector is a known limitation. If the enrichment pipeline received structured DOM evidence from the content script (as the Foundation Pipeline's channels would provide), the no-op workaround and its associated gaps would be eliminated.

5. **Split the service worker.** The ~900-line monolith mixes concerns. Splitting into SessionManager, MessageRouter, and PipelineOrchestrator would improve maintainability.

6. **Unify naming.** `InteractionEngine` vs "Evidence Engine", `isContainerNoiseClick` vs "large container click", `captureAncestorRoles` vs "ancestor classes" — consistent naming reduces confusion.

---

*This document is the source of truth for the CmdRecorder architecture. It should be updated when the architecture changes — not when individual bugs are fixed, but when the design, structure, or lifecycle model evolves.*
