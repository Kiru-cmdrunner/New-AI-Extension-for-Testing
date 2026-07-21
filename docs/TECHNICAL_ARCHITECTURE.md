# CmdRunner Smart Recorder — Technical Architecture

**Version:** Semantic Interaction Engine v1.0  
**Tag:** `semantic-interaction-engine-v1.0`  
**Manifest Version:** Chrome Extension Manifest V3  
**Last Updated:** July 2026

---

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Extension Architecture](#2-extension-architecture)
3. [Recorder Architecture and Event Flow](#3-recorder-architecture-and-event-flow)
4. [Semantic Interaction Engine](#4-semantic-interaction-engine)
5. [Evidence Providers and Classification Pipeline](#5-evidence-providers-and-classification-pipeline)
6. [Supported Interaction Types](#6-supported-interaction-types)
7. [Data Model](#7-data-model)
8. [Generation Pipeline](#8-generation-pipeline)
9. [Browser Compatibility](#9-browser-compatibility)
10. [Shadow DOM and Iframe Support](#10-shadow-dom-and-iframe-support)
11. [Current Limitations and Design Trade-offs](#11-current-limitations-and-design-trade-offs)
12. [Test Coverage and Validation Results](#12-test-coverage-and-validation-results)
13. [Future Extension Points](#13-future-extension-points)

---

## 1. High-Level System Architecture

CmdRunner is a Chrome Extension (Manifest V3) that captures user interactions on any web page, classifies them semantically, and generates executable test automation artifacts (Playwright scripts, execution JSON).

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Chrome Extension (MV3)                          │
│                                                                         │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────────────┐ │
│  │   Service     │   │   Content Script  │   │      Side Panel         │ │
│  │   Worker      │   │  (per-frame,       │   │   (UI + Timeline)       │ │
│  │   (Background)│   │   all_frames)      │   │                         │ │
│  │               │   │                    │   │  ┌─────────────────┐   │ │
│  │ • Recording   │◄──┤  • Event capture   │   │  │  Timeline       │   │ │
│  │   Session     │   │  • DOM context     │   │  │  Renderer       │   │ │
│  │ • Navigation  │   │  • Shadow DOM      │   │  └────────┬────────┘   │ │
│  │   tracking    │   │  • Iframe context  │   │           │            │ │
│  │ • Persistence │   │  • Surface detect  │   │  ┌────────▼────────┐   │ │
│  │               │──►│                    │   │  │  Detected       │   │ │
│  │               │   │  deterministic-    │   │  │  Interactions   │   │ │
│  │               │   │  recorder.ts       │   │  └────────┬────────┘   │ │
│  └──────┬───────┘   └──────────────────┘   │           │            │ │
│         │                               │  │  ┌────────▼────────┐   │ │
│         │   chrome.storage.local         │  │  │  Generation     │   │ │
│         │   (persistence)                │  │  │  Engine         │   │ │
│         │                               │  │  │  • Playwright   │   │ │
│         ▼                               │  │  │  • Exec JSON    │   │ │
│  ┌──────────────┐                       │  │  │  • Readability  │   │ │
│  │ AI Service    │                       │  │  └─────────────────┘   │ │
│  │ (optional)    │                       │  └─────────────────────────┘ │
│  │ Multi-provider│                       │                              │
│  └──────────────┘                       │                              │
│                                         │                              │
└─────────────────────────────────────────┼──────────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │     Target Web Page (any site)            │
                    │                                           │
                    │  ┌─────────────┐  ┌─────────────────────┐ │
                    │  │  Main Frame  │  │  Iframes            │ │
                    │  │  (top frame) │  │  (same & cross-org) │ │
                    │  │              │  │                     │ │
                    │  │  Shadow DOM  │  │  Shadow DOM         │ │
                    │  │  Open ✓      │  │  inside iframes ✓   │ │
                    │  │  Closed ✗    │  │                     │ │
                    │  └─────────────┘  └─────────────────────┘ │
                    └───────────────────────────────────────────┘
```

### Design Principles

1. **Deterministic recording** — The recorder captures exactly what happened: event type, target element identity, value transitions. No inference at the recording layer.
2. **Separation of concerns** — Recording (content script), session management (service worker), classification (engine), and generation (pipeline) are distinct layers with typed interfaces.
3. **Dual-engine classification** — V1 (rule-based) and V2 (evidence-based) run in parallel, enabling A/B comparison and safe migration.
4. **Provider-pluggable AI** — OpenAI, Anthropic, Gemini, Azure, OpenRouter, and custom providers are supported through a unified interface.

---

## 2. Extension Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Chrome Extension MV3                               │
│                                                                         │
│  Manifest: manifest.json                                                │
│  Permissions: sidePanel, storage, activeTab, webNavigation,             │
│               tabs, scripting, alarms                                   │
│  Host Permissions: http://*/*, https://*/*                              │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Background Service Worker (ES Module)                             │  │
│  │  src/background/service-worker.ts                                  │  │
│  │                                                                    │  │
│  │  Responsibilities:                                                 │  │
│  │  • Recording session lifecycle (start/stop/state)                  │  │
│  │  • Navigation tracking (chrome.webNavigation)                      │  │
│  │  • Event reception from content scripts (chrome.runtime.onMessage) │  │
│  │  • chrome.storage.local persistence                                │  │
│  │  • Side panel state synchronization                                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Content Script (injected per-frame, all_frames: true)             │  │
│  │  src/recorder/deterministic-recorder.ts                            │  │
│  │                                                                    │  │
│  │  Responsibilities:                                                 │  │
│  │  • DOM event capture (click, focus, blur, input, change, etc.)   │  │
│  │  • Element identity extraction (tag, ARIA, selector, XPath)       │  │
│  │  • Shadow DOM traversal via composedPath()                         │  │
│  │  • Iframe context extraction                                       │  │
│  │  • Surface detection (modal/drawer/popover/tooltip) via            │  │
│  │    MutationObserver                                                │  │
│  │  • Page-world script injection (alert/confirm/prompt/open hooks)  │  │
│  │  • Sends RECORDED_EVENT messages to service worker                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌────────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │  Side Panel UI     │  │  Settings Page   │  │  Repository Page   │  │
│  │  src/sidepanel/    │  │  src/settings/   │  │  src/repository/   │  │
│  │                    │  │                  │  │                    │  │
│  │  • Timeline view   │  │  • AI provider   │  │  • Test cases     │  │
│  │  • Interaction     │  │    configuration │  │  • Projects       │  │
│  │    list            │  │  • Connection    │  │  • Features       │  │
│  │  • Generation      │  │    testing       │  │  • Scenarios      │  │
│  │    controls        │  │                  │  │                    │  │
│  └────────────────────┘  └──────────────────┘  └────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  AI Service (optional, multi-provider)                             │  │
│  │  src/ai/                                                           │  │
│  │                                                                    │  │
│  │  Providers: OpenAI, Anthropic/Claude, Google Gemini,               │  │
│  │              Azure OpenAI, OpenRouter, Custom HTTP endpoint        │  │
│  │  Used for: Interaction enrichment (business names, intent)        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Manifest Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `manifest_version` | 3 | Modern Chrome extension standard |
| `content_scripts[0].matches` | `["<all_urls>"]` | Inject into every page |
| `content_scripts[0].all_frames` | `true` | Inject into all iframes |
| `content_scripts[0].run_at` | `document_start` | Capture events as early as possible |
| `background.type` | `"module"` | ES module service worker |
| `permissions` | sidePanel, storage, activeTab, webNavigation, tabs, scripting, alarms | Full recording capability |

---

## 3. Recorder Architecture and Event Flow

### Recorder Event Flow Diagram

```
                    Target Web Page
                          │
                    DOM Event Fires
                    (click, input, focus,
                     blur, change, etc.)
                          │
                          ▼
          ┌───────────────────────────────┐
          │     Content Script            │
          │     (deterministic-recorder)  │
          │                               │
          │  1. Event arrives via capture │
          │     phase document listener   │
          │                               │
          │  2. resolveTarget(event)      │
          │     • Walks composedPath()    │
          │       (crosses Shadow DOM)    │
          │     • Finds nearest           │
          │       interactive element     │
          │                               │
          │  3. extractIframeContext()    │
          │     • window !== window.top?  │
          │     • Walk parent frames      │
          │       (try/catch for          │
          │        cross-origin)          │
          │                               │
          │  4. captureDomContext(el)     │
          │     • inputType, ariaExpanded,│
          │       ariaHasPopup, fileData, │
          │       triggeredDialog, etc.   │
          │                               │
          │  5. detectSurfaceAfterClick() │
          │     • MutationObserver checks │
          │       for modal/drawer/       │
          │       popover/tooltip         │
          │                               │
          │  6. Build RecordedEvent       │
          │     { eventId, eventType,     │
          │       timestamp, target,      │
          │       valueBefore/After,      │
          │       domContext }            │
          └───────────┬───────────────────┘
                      │
                      │ chrome.runtime.sendMessage()
                      │ { type: 'RECORDED_EVENT', payload }
                      │
                      ▼
          ┌───────────────────────────────┐
          │     Service Worker            │
          │     (service-worker.ts)       │
          │                               │
          │  • Assigns sequential         │
          │    eventId (single counter    │
          │    across all frames)         │
          │  • Appends to session.events[]│
          │  • Persists to                │
          │    chrome.storage.local       │
          │  • Notifies side panel        │
          └───────────┬───────────────────┘
                      │
                      │ chrome.storage.local
                      │ + runtime message
                      │
                      ▼
          ┌───────────────────────────────┐
          │     Side Panel                │
          │     (timeline-renderer.ts)    │
          │                               │
          │  • detectInteractions(events) │
          │    → V1 rule-based detector   │
          │  • detectInteractionsV2(events│
          │    → V2 evidence engine       │
          │  • Render semantic timeline   │
          └───────────────────────────────┘
```

### Captured Event Types

| DOM Event | Recorder Handling | Snapshot Capture |
|-----------|------------------|-------------------|
| `click` | Primary interaction trigger; resolves target, captures context, detects surfaces | Full DomContext |
| `dblclick` | Standalone event — committed immediately as own interaction | Full DomContext |
| `contextmenu` | Standalone event — RightClick | Full DomContext |
| `focus` | Start of text entry tracking; records `valueBefore` | Full DomContext |
| `blur` | End of text entry tracking; records `valueAfter` | Full DomContext |
| `input` | Real-time value changes for dropdowns, sliders, text | Full DomContext |
| `change` | Value commit for `<select>`, checkboxes, radio buttons | Full DomContext |
| `scroll` | Standalone event — page or container scroll | Scroll position |
| `mouseenter` | Hover detection (with behavior qualification) | Full DomContext |
| `dragstart` | Drag initiation — starts a drag buffer | Full DomContext |
| `drop` | Drop completion — completes drag buffer; file data if OS drag | Full DomContext |
| `navigation` | URL change via `chrome.webNavigation.onCommitted` | URL, title, transitionType |

### Element Identity Extraction

Every captured element gets a rich identity snapshot:

```typescript
interface ElementIdentity {
  // Core attributes
  tag: string;              // HTML tag name
  accessibleName: string;   // Computed accessible name
  ariaRole: string | null;  // ARIA role
  ariaLabel: string | null;
  // DOM attributes
  className: string | null;
  stableId: string | null;  // id attribute
  name: string | null;      // form name attribute
  placeholder: string | null;
  // Test automation attributes
  testId: string | null;    // data-testid
  dataCy: string | null;    // data-cy
  dataQa: string | null;    // data-qa
  // Locators (hidden fallback for replay)
  cssSelector: string;
  xPath: string;
  // Context flags
  inIframe: boolean;
  shadowDom: boolean;
  iframeContext?: IframeContext;
  // System-assigned
  elementId: string;        // "elem-0001" (service worker assigns)
}
```

### DOM Context (Captured at Event Time)

The `DomContext` is the bridge between the recorder (sensor) and the classification engine (decision maker). It captures structural information that the engine needs but the DOM won't have by recording stop time:

```typescript
interface DomContext {
  inputType: string | null;           // 'text', 'checkbox', 'date', etc.
  ariaExpanded: boolean | null;
  ariaHasPopup: string | null;
  isContentEditable: boolean;
  ariaAutoComplete: string | null;    // 'list', 'both', 'inline'
  listId: string | null;             // native datalist ID
  surfaceType: SurfaceType | null;    // 'modal'|'drawer'|'popover'|'tooltip'
  surfaceRole: string | null;
  surfaceLabel: string | null;
  // File Upload
  acceptedFileTypes: string | null;
  multipleFiles: boolean | null;
  fileData: { name: string; type: string }[] | null;
  uploadMethod: 'browse' | 'drag-drop' | null;
  // Window & Frame
  triggeredDialog: 'alert' | 'confirm' | 'prompt' | null;
  dialogMessage: string | null;
  dialogResult: string | null;
  opensNewTab: boolean | null;
  opensNewWindow: boolean | null;
  openedUrl: string | null;
}
```

---

## 4. Semantic Interaction Engine

The Semantic Interaction Engine takes raw recorded events and classifies them into semantic interaction types. It uses a **dual-engine architecture**:

### Semantic Interaction Engine Pipeline

```
                    Recorded Events (RecordedEvent[])
                              │
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────┐  ┌───────────────┐  ┌───────────────┐
    │  V1 Engine   │  │  V2 Engine    │  │  Merge Layer  │
    │  (rule-based)│  │  (evidence)   │  │  (optional)   │
    │              │  │               │  │               │
    │  Sequential  │  │  5 Providers  │  │  V2-primary   │
    │  pattern     │  │  → Weighted   │  │  V1-fallback  │
    │  matching    │  │    Voting     │  │  for segments │
    │              │  │               │  │               │
    └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
           │                  │                  │
           │    DetectedInteraction[]           │
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────────────────────────────────────────┐
    │              Timeline Renderer                   │
    │         (semantic action descriptions)          │
    │                                                  │
    │  "Click \"Login\" button"                        │
    │  "Enter \"john@example.com\" in email field"     │
    │  "Select \"India\" from Country dropdown"        │
    │  "Upload \"invoice.pdf\""                        │
    │  "Alert dialog \"Are you sure?\" appeared"      │
    └─────────────────────────────────────────────────┘
```

### V1 Engine — Rule-Based Detector

**File:** `src/classifier/interaction-detector.ts`

The V1 engine processes events through sequential pattern matching:

1. **Event grouping** — Events are grouped by element identity key (`tag|id|cssSelector`). Multi-event interactions (e.g., focus → blur for TextEntry, dragstart → drop for DragDrop) are detected by examining event sequences within a group.

2. **Classification order** — Specific types are checked before generic types:
   - BrowserAlert → NewTab/NewWindow → Link → FileUpload → DatePicker → TimePicker → Slider → ToggleSwitch → Checkbox → RadioButton → NativeDropdown → CustomDropdown/Autocomplete → Breadcrumb → Menu → Tab → Hover → DragDrop → TextEntry → Click

3. **Iframe enrichment** — After classification, interactions inside iframes receive `iframeSrc`, `iframeName`, and `iframeDepth` metadata.

### V2 Engine — Evidence-Based Detector

**File:** `src/classifier/evidence/engine.ts`

The V2 engine uses a provider-voting architecture:

1. **Buffer accumulation** — Events are buffered per-element. The engine maintains one active buffer at a time.
2. **Multi-element grouping** — Related events across elements (dropdown trigger → option click, date input → calendar cell) are grouped via relationship detection.
3. **Provider evidence collection** — Each provider observes every event independently and contributes evidence.
4. **Commit signals** — Buffers are committed when: a different unrelated element is interacted with, a navigation occurs, a standalone event fires, or the stream ends.
5. **Weighted voting** — All evidence is combined. For each candidate type, `score = Σ(confidence × weight)`. The highest-scoring type wins.
6. **Metadata extraction** — The winning type determines which metadata fields to extract from the evidence.

---

## 5. Evidence Providers and Classification Pipeline

### Evidence Provider Architecture

```
                    ┌──────────────────────────────┐
                    │     RecordedEvent stream     │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────▼───────────────────┐
                    │    Interaction Engine        │
                    │    (engine.ts)               │
                    │                              │
                    │  • Buffers events per-element│
                    │  • Routes to all providers   │
                    │  • Commits on boundary       │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
     ┌───────────────┐ ┌──────────────┐ ┌────────────────┐
     │ DomProvider   │ │ AriaProvider │ │ EventSequence  │
     │               │ │              │ │ Provider       │
     │ Reads:        │ │ Reads:       │ │                │
     • tag, inputType│ • ariaRole    │ │ Patterns:      │
     • className     │ • ariaLabel   │ • focus→blur    │
     • file data     │ • ariaExpanded│ • click→change  │
     • dialog info   │ • ariaAutoCmplt│ • click+checked│
     • new tab/window│ • role=option │ • single click  │
     • CSS patterns  │ • role=gridcell│ • dragstart→drop│
     └───────┬───────┘ └──────┬───────┘ └───────┬────────┘
             │                │                 │
             ▼                ▼                 ▼
     ┌───────────────┐ ┌──────────────────────────────┐
     │ Mutation      │ │ CssClassnameProvider         │
     │ Provider      │ │                              │
     │               │ │ CSS class → Type maps:       │
     │ Surface detect│ │ • MUI (MuiButton, etc.)     │
     • modal         │ │ • Ant Design (ant-)          │
     • drawer        │ │ • Bootstrap (btn-, form-)    │
     • popover       │ │ • Generic (dropdown, etc.)   │
     • tooltip       │ │                              │
     └───────┬───────┘ └───────┬──────────────────────┘
             │                 │
             └────────┬────────┘
                      │
             All Evidence[]
                      │
                      ▼
          ┌───────────────────────┐
          │  combineEvidence()    │
          │  (combination.ts)     │
          │                       │
          │  For each type:       │
          │  score = Σ(conf×wt)   │
          │                       │
          │  Winner = highest     │
          │  weighted score       │
          └───────────┬───────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │  CombinationResult    │
          │  { type, confidence,  │
          │    evidence, scores } │
          └───────────────────────┘
```

### Provider Details

| Provider | File | What It Detects | Strength |
|----------|------|----------------|----------|
| **DomProvider** | `dom-provider.ts` | DOM-level signals: tag name, input type, file data, dialog info, new tab/window flags, CSS class patterns for common elements | High confidence for structural signals (0.85-0.98) |
| **AriaProvider** | `aria-provider.ts` | ARIA semantics: role=checkbox/radio/slider/combobox/option/gridcell/tab/menuitem/breadcrumb, aria-expanded, aria-haspopup, aria-autocomplete | High confidence for standards-compliant components (0.85-0.95) |
| **EventSequenceProvider** | `event-sequence-provider.ts` | Multi-event patterns: focus→blur (TextEntry), click→change (Dropdown), click+checked (Checkbox/Radio), dragstart→drop (DragDrop), single click (Click), dialog triggers, new tab/window | Medium-high confidence for sequential patterns (0.75-0.95) |
| **MutationProvider** | `mutation-provider.ts` | Surface detection: modal/drawer/popover/tooltip appearance via MutationObserver, dropdown options appearing, menu items | Medium confidence for surface detection (0.6-0.8) |
| **CssClassnameProvider** | `css-classname-provider.ts` | Framework CSS patterns: MUI (`MuiButton-root`), Ant Design (`ant-btn`), Bootstrap (`btn-primary`), generic patterns (`dropdown`, `datepicker`, `breadcrumb`) | High confidence for framework-specific patterns (0.75-0.9) |

### Evidence Combination Algorithm

```typescript
// Simplified combination logic
function combineEvidence(evidence: Evidence[]): CombinationResult {
  const scores = new Map<InteractionType, number>();

  for (const e of evidence) {
    if (e.suggestedType === null) continue;
    const score = e.confidence * e.weight;
    scores.set(e.suggestedType, (scores.get(e.suggestedType) ?? 0) + score);
  }

  // Winner = type with highest aggregate score
  const winner = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    type: winner[0],
    confidence: winner[1],
    evidence,
    scores: [...scores.entries()].map(([type, score]) => ({ type, score })),
  };
}
```

### Multi-Element Interaction Grouping

The V2 engine groups events across elements when they're related:

| Pattern | Trigger Element | Related Element | Resulting Type |
|---------|----------------|-----------------|----------------|
| Dropdown selection | Combobox/listbox (`aria-haspopup`, `aria-expanded`) | Option (`role=option`, class=option) | NativeDropdown/CustomDropdown |
| Calendar date selection | Date input/calendar button | Gridcell (`role=gridcell`, day/cell class) | DatePicker |
| Autocomplete | Text input with `aria-autocomplete` | Option item in suggestion list | Autocomplete |

---

## 6. Supported Interaction Types

### Complete Interaction Type Catalog (33 types)

| Category | Type | Tier | Detection Methods | Timeline Example |
|----------|------|------|-------------------|-----------------|
| **Navigation** | PageNavigation | T1 | `webNavigation.onCommitted` (link/form) | Navigated to "Dashboard" |
| | Back | T1 | `transitionType` = `forward_back` | Clicked browser Back button |
| | Forward | T1 | `transitionType` = `forward` | Clicked browser Forward button |
| | Refresh | T1 | `transitionType` = `reload` | Refreshed the page |
| **Mouse** | Click | T1 | Single click event, no other signals | Click "Submit" button |
| | DoubleClick | T1 | `dblclick` event | Double-click "file.txt" |
| | RightClick | T1 | `contextmenu` event | Right-click "image" |
| | Hover | T1 | `mouseenter` + behavior qualification | Hover "Profile" menu |
| | DragDrop | T1 | `dragstart` → `drop` sequence | Drag "item" to "container" |
| **Text Entry** | TextEntry | T1 | focus → blur with value change | Enter "john@example.com" |
| **Selection Controls** | NativeDropdown | T1 | `<select>` click → change | Select "India" from Country |
| | CustomDropdown | T2 | Combobox CSS + option click + change | Select "Option A" from dropdown |
| | Autocomplete | T2 | `aria-autocomplete` + suggestion interaction | Search and select "New York" |
| | MultiSelect | T2 | Multiple selections via chips/checkboxes | Select 3 items |
| | Checkbox | T1 | `input[type=checkbox]` + checked change | Check "Agree to terms" |
| | RadioButton | T1 | `input[type=radio]` + selection | Select "Express shipping" |
| | ToggleSwitch | T1 | ARIA `switch` role, toggle CSS classes | Toggle "Dark mode" on |
| | Slider | T1 | `input[type=range]`, ARIA `slider` role | Set slider to "75" |
| **Date & Time** | DatePicker | T1 | Native date input, calendar gridcells | Select date "15 July 2026" |
| | TimePicker | T1 | Native time input, time picker UI | Select time "2:30 PM" |
| | DateTimePicker | T1 | datetime-local input, combo pickers | Select "2026-07-15 14:30" |
| **File Upload** | FileUpload | T1 | `<input type=file>` change event | Upload "invoice.pdf" |
| | DragDropUpload | T2 | `drop` event with `dataTransfer.files` | Drag "photo.jpg" to Upload Area |
| **Navigation UI** | Link | T1 | `<a>` tag, `role=link` | Click "About Us" link |
| | Tab | T1 | `role=tab`, tab CSS classes | Click "Settings" tab |
| | Menu | T1 | `role=menuitem*`, nav-menu CSS | Click "File" menu item |
| | Breadcrumb | T1 | Breadcrumb CSS patterns (MUI/AntD/BS) | Click "Home" breadcrumb |
| **Scrolling** | PageScroll | T1 | Scroll on `<html>`/`<body>` | Scroll page to position |
| | ContainerScroll | T1 | Scroll on other elements | Scroll list to position |
| | InfiniteScroll | T2 | Scroll + content appended | Infinite scroll detected |
| **Dialogs** | BrowserAlert | T1 | Page-world alert/confirm/prompt hook | Alert dialog "Are you sure?" appeared |
| | Modal | T2 | MutationObserver + surface detection | Modal "Edit Profile" appeared |
| | Drawer | T2 | Surface detection + drawer CSS | Drawer appeared |
| | Popover | T2 | Surface detection + popover CSS | Popover appeared |
| | Tooltip | T2 | Surface detection + tooltip CSS | Tooltip "Help text" appeared |
| **Window & Frame** | NewTab | T1 | `target=_blank`, `window.open()` | Open "report.pdf" in new tab |
| | NewWindow | T1 | `window.open()` with features | Open "chat" in new window |
| | Iframe | T1 | Enrichment on interactions in iframes | Click "Submit" (in form-frame) |

### Framework Coverage Matrix

| Framework | Detection Methods | Coverage |
|-----------|------------------|----------|
| **Native HTML** | Tag names, input types, standard attributes | Full |
| **Material UI (MUI)** | CSS class patterns (`MuiButton-*`, `MuiBreadcrumbs-*`, etc.) | Full |
| **Ant Design** | CSS class patterns (`ant-btn`, `ant-select`, `breadcrumb-*`) | Full |
| **Bootstrap** | CSS class patterns (`btn-*`, `form-control-*`, `breadcrumb-item`) | Full |
| **React-Select** | CSS class patterns (`react-select`, `select__option`) | Partial |
| **Web Components** | composedPath() for event capture; CSS patterns limited | Partial (see §10) |

---

## 7. Data Model

### Core Data Flow

```
Recording Session
  │
  ├── RecordingContext { startUrl, startTitle, capturedAt }
  │
  ├── RecordedEvent[] (raw events)
  │     │
  │     ├── NavigationRecordedEvent { eventId, eventType:'navigation', url, title, transitionType }
  │     │
  │     └── ElementRecordedEvent { eventId, eventType, timestamp, target, valueBefore,
  │                                valueAfter, checkedBefore, checkedAfter, domContext }
  │
  ├── DetectedInteraction[] (classified)
  │     │
  │     └── DetectedInteraction { interactionId, type, eventIds, rawEventTypes,
  │                               target, metadata, confidence, engine }
  │
  └── ReplayJson { sessionContext, events[] }
```

### Storage Schema

Data is persisted in `chrome.storage.local` under these keys:

| Key | Content |
|-----|---------|
| `ui_state` | Recording state (ready/recording/stopped) |
| `session_events` | Raw RecordedEvent[] array |
| `session_context` | RecordingContext (start URL/title) |
| `detected_interactions` | V1 DetectedInteraction[] |
| `detected_interactions_v2` | V2 DetectedInteraction[] (dev comparison) |
| `detected_interactions_merged` | Merged V1+V2 interactions |
| `replay_json` | Deterministic replay artifact |
| `generated_steps` | Canonical step descriptions |
| `generated_playwright` | Playwright script output |
| `ai_config` | AI provider configuration |
| `test_repository` | Test case repository |
| `session_screenshots` | Screenshot captures |

### InteractionMetadata Schema

```typescript
interface InteractionMetadata {
  // Navigation
  url?: string;  title?: string;  transitionType?: string;
  // Text Entry
  textValue?: string;
  // Toggle states
  checked?: boolean;
  // Selection
  selectedValue?: string;
  // File Upload
  files?: string[];  fileCount?: number;  uploadMethod?: string;
  acceptedFileTypes?: string;  multiple?: boolean;
  // Scroll
  scrollPosition?: { x: number; y: number };
  // Hover
  hoverDuration?: number;
  // Drag & Drop
  dropTarget?: string;  sourceElement?: string;
  // Element identity
  accessibleName?: string;
  // Date & Time
  dateValue?: string;  timeValue?: string;  dateTimeValue?: string;
  // Slider
  sliderValue?: string;
  // Tab
  selectedTab?: string;
  // Breadcrumb
  breadcrumbLevel?: number;  breadcrumbPath?: string[];
  // Browser Alert
  dialogType?: string;  dialogMessage?: string;  dialogResult?: string;
  // New Tab / New Window
  openedUrl?: string;  openedTitle?: string;
  // Iframe enrichment
  iframeSrc?: string;  iframeName?: string;  iframeDepth?: number;
  // Surface detection
  surfaceLabel?: string;  surfaceRole?: string;
}
```

---

## 8. Generation Pipeline

After classification, detected interactions flow through the generation pipeline to produce executable artifacts:

```
DetectedInteraction[]
        │
        ▼
┌───────────────────────┐
│ CanonicalStepGenerator│  → Canonical steps ("Click Login button",
│                       │     "Enter email in Email field")
└──────────┬────────────┘
           │
           ▼
┌───────────────────────┐    ┌───────────────────────────┐
│ MultiTierClassifier   │    │ SemanticClassifier        │
│ (assigns step tier)   │    │ (semantic action grouping)│
└──────────┬────────────┘    └───────────┬───────────────┘
           │                             │
           ▼                             ▼
┌───────────────────────┐    ┌───────────────────────────┐
│ ReadabilityOptimizer  │    │ LocatorResolutionEngine   │
│ (merge, simplify)     │    │ (CSS selector, XPath,     │
│                       │    │  test-id resolution)      │
└──────────┬────────────┘    └───────────┬───────────────┘
           │                             │
           ▼                             ▼
┌───────────────────────┐    ┌───────────────────────────┐
│ ExecutionJsonGenerator│    │ PlaywrightGenerator       │
│ (deterministic JSON)  │    │ (playwright.test.js code) │
└───────────────────────┘    └───────────────────────────┘
```

---

## 9. Browser Compatibility

| Browser | Support Level | Notes |
|---------|--------------|-------|
| **Google Chrome** | ✅ Full | Primary target. MV3 service worker, side panel, webNavigation API. |
| **Microsoft Edge** | ✅ Full | Chromium-based, supports all MV3 APIs identically. |
| **Brave** | ✅ Full | Chromium-based. Privacy shields may block some third-party resources. |
| **Firefox** | ❌ Not supported | Uses MV2 / different extension APIs. Not currently targeted. |
| **Safari** | ❌ Not supported | Uses Safari Web Extensions (different API surface). |

### Required Chrome APIs

| API | Purpose |
|-----|---------|
| `chrome.sidePanel` | Recording UI and timeline display |
| `chrome.storage.local` | Session persistence |
| `chrome.webNavigation` | Page navigation tracking |
| `chrome.tabs` | Tab management and new tab detection |
| `chrome.scripting` | Programmatic script injection |
| `chrome.runtime` | Content script ↔ service worker messaging |
| `chrome.alarms` | Keepalive for long-running recording sessions |

---

## 10. Shadow DOM and Iframe Support

### Shadow DOM Compatibility Matrix

| Capability | Support | Mechanism |
|-----------|---------|-----------|
| **Event capture (open shadow)** | ✅ Full | Document-level capture-phase listeners; composed events bubble through shadow boundaries |
| **Target resolution (open shadow)** | ✅ Full | `event.composedPath()` walks the full event path across shadow boundaries |
| **Nested shadow DOM events** | ✅ Full | `composedPath()` traverses multiple shadow levels |
| **Interaction classification** | ✅ Full | Element tag, classes, ARIA attributes read directly from resolved node |
| **cssSelector / XPath** | ⚠️ Partial | `parentElement` walk stops at shadow boundary; selector covers intra-shadow path only |
| **accessibleName (aria-labelledby)** | ⚠️ Partial | `document.getElementById()` doesn't cross shadow boundaries; direct attributes work |
| **Surface detection (MutationObserver)** | ❌ Not supported | `subtree: true` covers light DOM only; shadow-root modals not detected |
| **Closed shadow roots** | ❌ Not supported | Browser-level limitation — `getRootNode()` returns document |

### Iframe Compatibility Matrix

| Capability | Support | Mechanism |
|-----------|---------|-----------|
| **Same-origin event capture** | ✅ Full | `all_frames: true` + `matches: ["<all_urls>"]` in manifest |
| **Same-origin context** | ✅ Full | `window.parent.document` → `querySelectorAll('iframe')` → selector/XPath |
| **Cross-origin event capture** | ✅ Full | Content script injected per-frame (isolated world) |
| **Cross-origin context** | ⚠️ Partial | `window.parent.document` throws SecurityError; only `frameSrc` available |
| **Nested iframes** | ✅ Events captured | Each frame gets independent content script; `frameDepth` counts levels |
| **Event merging** | ✅ Full | All frames `sendMessage()` → single service worker → single `events[]` array |
| **Event ordering** | ⚠️ Arrival-order | Not timestamp-sorted; relies on message delivery order |
| **Iframe navigation events** | ❌ Main frame only | `webNavigation.onCommitted` filters to `frameId === 0` |

### Mixed Scenario Matrix

| Scenario | Events Captured | Metadata Quality |
|----------|----------------|-----------------|
| **Shadow DOM inside iframe** | ✅ Full | ⚠️ Degraded (compounding shadow + iframe limits) |
| **Iframe inside Shadow DOM** | ✅ Full | ⚠️ Parent can't locate iframe element via `querySelectorAll` |
| **Cross-origin iframe + Shadow DOM** | ✅ Full | ⚠️ Doubly degraded (cross-origin + shadow limits) |

---

## 11. Current Limitations and Design Trade-offs

### Known Limitations

| # | Limitation | Severity | Browser/API Constraint? |
|---|-----------|----------|------------------------|
| 1 | **MutationObserver doesn't cross shadow boundaries** | High impact for web components | No — fixable with recursive shadow root observation |
| 2 | **Cross-frame event ordering not guaranteed** | Medium impact for multi-frame apps | No — fixable with timestamp-based stable sort |
| 3 | **Shadow DOM selectors truncated** | Medium impact for replay | Partially — `parentElement` returns null at boundary; no standard deep combinator |
| 4 | **accessibleName lookups don't cross shadow** | Low-medium impact | No — fixable with shadow-aware `getElementById` |
| 5 | **Cross-origin iframe context** | Low-medium impact | Yes — same-origin policy; mitigable via service worker frame API |
| 6 | **Iframe navigation events not captured** | Low impact | No — fixable by removing `frameId === 0` filter |
| 7 | **CSP blocks page-world injection** | Low impact (only affects BrowserAlert/NewTab/NewWindow detection) | Yes — strict CSP; mitigable via `chrome.scripting.executeScript` with `world: 'MAIN'` |
| 8 | **Cross-origin CSS rules unreadable** | Very low impact (hover-reveal only) | Yes — SecurityError on cross-origin stylesheet access |
| 9 | **Closed shadow roots undetectable** | Negligible impact | Yes — browser-level limitation, no workaround |

### Design Trade-offs

| Decision | Rationale |
|----------|-----------|
| **Dual V1/V2 engines** | V1 is fast and well-tested; V2 is more flexible and extensible. Running both enables safe migration and A/B comparison without risking existing functionality. |
| **Capture-phase document listeners** | Delegation via `document.addEventListener(type, handler, true)` catches all events including those in shadow DOM, without needing per-element listeners. Single attachment point, simpler lifecycle. |
| **DOM context captured at event time** | The DOM changes between recording and classification. Capturing context at event time ensures the classifier has accurate structural information regardless of when classification runs. |
| **`all_frames: true` injection** | Guarantees coverage of iframe-based content without requiring runtime frame detection. Each frame is independently instrumented. |
| **Evidence provider independence** | Each provider is isolated and contributes evidence without knowing about other providers. This makes the system extensible (add a new provider without touching existing ones) and debuggable (evidence trail shows exactly which provider contributed what). |
| **Weighted voting vs. rule precedence** | V2 uses weighted voting (multiple providers can contribute to the same type, boosting its score) rather than V1's fixed precedence chain. This handles conflicting signals more gracefully. |

---

## 12. Test Coverage and Validation Results

### Test Suite Summary

| Metric | Value |
|--------|-------|
| **Total test files** | 92 |
| **Total test cases** | 2,605 |
| **All passing** | ✅ Yes (0 failures) |
| **Regression tests** | Every milestone includes regression tests verifying prior functionality is unaffected |
| **Real-world validation** | Multiple test files validate against real-world sites (Google Flights, Avis Ford, etc.) |

### Test Categories

| Category | Files | Key Coverage |
|----------|-------|-------------|
| **Evidence Engine** | 18 files | Provider tests, combination logic, integration, real-world validation, all interaction type detection |
| **Recorder Pipeline** | 12 files | Event capture, element identity, state tracking, coalescing, architecture pipeline |
| **Generation** | 10 files | Canonical steps, Playwright generation, execution JSON, readability, locator resolution |
| **Infrastructure** | 8 files | Storage, messaging, audit, error handling, logging |
| **Legacy Content Scripts** | 15 files | Individual content scripts for click, text, checkbox, select, datepicker, hover |
| **Integration** | 8 files | End-to-end flows, stage3a/3b integration, SPA resolve-target |
| **AI Service** | 5 files | Provider management, connection testing, AI observer |
| **Other** | 16 files | Action phrasing, capabilities, schema versioning, etc. |

### Interaction Type Test Coverage

| Interaction Category | Test File | Test Count | V1 Tests | V2 Tests | Regression |
|---------------------|-----------|------------|----------|----------|------------|
| File Upload | `file-upload.test.ts` | 49 | ✅ | ✅ | ✅ |
| Navigation UI | `navigation-ui.test.ts` | 30 | ✅ | ✅ | ✅ |
| Window & Frame | `window-frame.test.ts` | 38 | ✅ | ✅ | ✅ |
| Date & Time | `date-time-completion.test.ts` | 40+ | ✅ | ✅ | ✅ |
| Selection Controls | `selection-controls-completion.test.ts` | 35+ | ✅ | ✅ | ✅ |
| Drag & Drop | `drag-drop-grouping.test.ts` | 20+ | ✅ | ✅ | ✅ |
| Autocomplete | `autocomplete-*.test.ts` | 50+ | ✅ | ✅ | ✅ |
| Dropdowns | `wave2/wave3-*.test.ts` | 30+ | ✅ | ✅ | ✅ |
| Surfaces | `mutation-surfaces.test.ts` | 15+ | — | ✅ | ✅ |

---

## 13. Future Extension Points

### Adding a New Interaction Type

1. **Add the type** to the `InteractionType` enum in `src/classifier/interaction-types.ts`.
2. **Add metadata fields** to `InteractionMetadata` if the type carries unique data.
3. **Add V1 detection logic** in `src/classifier/interaction-detector.ts` — place specific checks before generic ones.
4. **Add V2 provider evidence** in the appropriate provider(s):
   - DOM signals → `DomProvider`
   - ARIA signals → `AriaProvider`
   - Event sequence patterns → `EventSequenceProvider`
   - CSS class patterns → `CssClassnameProvider` (add framework maps)
   - Surface/mutation detection → `MutationProvider`
5. **Add timeline rendering** in `src/sidepanel/timeline-renderer.ts`.
6. **Add display info** to `TYPE_DISPLAY` (label, icon, color).
7. **Write tests** in `tests/evidence-engine/` — cover V1 detection, V2 detection, metadata extraction, timeline phrasing, and regression.
8. **Update spec** in `.drytis/specs/` with acceptance criteria.

### Adding a New Evidence Provider

1. Create a new file in `src/classifier/evidence/providers/`.
2. Implement the `EvidenceProvider` interface (`name`, `onEvent()`, optional `onCommit()`).
3. Register it in `createDefaultProviders()` in `src/classifier/evidence/detector.ts`.
4. Write provider tests in `tests/evidence-engine/`.

### Adding a New AI Provider

1. Create a new file in `src/ai/providers/`.
2. Implement the provider interface (extends `BaseAIProvider` or implements `AIProvider`).
3. Register it in `src/ai/provider-manager.ts`.
4. Add UI configuration in `src/settings/settings.ts`.
5. Write tests in `tests/`.

### Adding a New Generation Format

1. Create a new generator in `src/generation/generators/`.
2. Implement the generator interface.
3. Register it in `src/generation/registry/generator-registry.ts`.
4. Add tests in `tests/`.

---

### Component Dependency Diagram

```
                              manifest.json
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
            service-worker   content-script   side-panel
                    │              │              │
                    │              │              │
         ┌─────────┼────┐    ┌────┼────┐    ┌────┼─────────┐
         │         │    │    │    │    │    │    │         │
         ▼         ▼    │    ▼    ▼    │    ▼    ▼         ▼
  recording   storage   │  det-  shared│  timeline  generation
  -session    -service  │  rec   types │  -renderer engine
  │                     │  order      │    │         │
  │                     │    │        │    │    ┌────┼────┐
  │                     │    │        │    │    │    │    │
  ▼                     │    ▼        │    ▼    ▼    ▼    ▼
  recorded-event        │  observer   │  interaction  play- execu-
  -ts ←─────────────────┘  -helpers   │  -types      wright tion-
         ↑                             │    ↑         gen   json
         │                             │    │
    shared/types ←─────────────────────┴────┘
         │
    ElementIdentity
    DomContext
    InteractionMetadata
```

### End-to-End Data Flow

```
Browser Event ──► Content Script ──► Service Worker ──► Storage
                      │                    │
                      │                    │
                 capture DOM          assign eventId
                 extract identity    append to events[]
                 detect surface      persist to storage
                      │                    │
                      │                    ▼
                      │              Side Panel
                      │                    │
                      │              ┌─────┴─────┐
                      │              │           │
                      │         V1 Detector   V2 Engine
                      │              │           │
                      │              ▼           ▼
                      │         DetectedInteraction[]
                      │              │
                      │              ▼
                      │         Timeline Renderer
                      │         (semantic descriptions)
                      │              │
                      │              ▼
                      │         Generation Engine
                      │         ┌────┼────┐
                      │         │    │    │
                      │         ▼    ▼    ▼
                      │      Steps  Playwright  Exec JSON
                      │
                      ▼
              AI Service (optional)
              • Business name enrichment
              • Intent classification
              • Confidence scoring
```

---

## Appendix: Source File Map

```
src/
├── background/
│   └── service-worker.ts          # Background service worker (session mgmt, nav tracking)
├── recorder/
│   ├── deterministic-recorder.ts  # Main content script (event capture, DOM context)
│   ├── recorded-event.ts          # RecordedEvent types, DomContext, ReplayJson
│   ├── recording-session.ts       # Session lifecycle (start/stop/persist)
│   ├── element-id-generator.ts    # Sequential element ID assignment
│   ├── action-id.ts               # Action ID generation
│   ├── surface-detector.ts        # Modal/drawer/popover/tooltip detection
│   ├── interaction-types.ts       # Recorder-level interaction type constants
│   ├── observer/
│   │   ├── observer-helpers.ts    # Mutation observer utilities
│   │   └── universal-*.ts         # Universal interaction observer
│   ├── context/
│   │   ├── state-tracker.ts       # Element state tracking
│   │   └── state-tracker-init.ts  # State tracker initialization
│   ├── coalescer/
│   │   └── snapshot-coalescer.ts  # Event coalescing for multi-event interactions
│   ├── pipeline/
│   │   ├── architecture-c-pipeline.ts  # Architecture C processing pipeline
│   │   └── interaction-assembler.ts     # Interaction assembly
│   └── pipeline-v2/
│       ├── pipeline-v2.ts         # Pipeline V2 (alternative processing)
│       ├── v2-event-observer.ts   # V2 event observation
│       ├── state-diff-engine.ts   # State diffing
│       ├── boundary-detector.ts   # Interaction boundary detection
│       ├── intent-resolver.ts     # Intent resolution
│       └── pattern-registry.ts    # Pattern registry
├── classifier/
│   ├── interaction-types.ts       # InteractionType enum, metadata, tiers, categories
│   ├── interaction-detector.ts    # V1 rule-based detector
│   └── evidence/
│       ├── engine.ts              # V2 evidence engine (buffering, commit, voting)
│       ├── detector.ts            # V2 public API entry point
│       ├── combination.ts         # Evidence combination + metadata extraction
│       ├── merge-layer.ts         # V1+V2 merge layer
│       ├── ab-comparison.ts       # A/B comparison utilities
│       ├── types.ts               # Evidence, EvidenceProvider, InteractionBuffer types
│       └── providers/
│           ├── dom-provider.ts            # DOM-level evidence
│           ├── aria-provider.ts           # ARIA semantics evidence
│           ├── event-sequence-provider.ts # Event sequence pattern evidence
│           ├── mutation-provider.ts       # MutationObserver/surface evidence
│           └── css-classname-provider.ts  # Framework CSS class evidence
├── generation/
│   ├── engine/
│   │   ├── generation-engine.ts   # Main generation orchestrator
│   │   ├── semantic-templates.ts  # Semantic action templates
│   │   ├── confidence-engine.ts   # Step confidence scoring
│   │   ├── readability-optimizer.ts # Step merging and readability
│   │   ├── locator-resolution-engine.ts # Element locator resolution
│   │   ├── multi-tier-classifier.ts # Step tier classification
│   │   ├── semantic-classifier.ts # Semantic action classification
│   │   ├── step-to-semantic.ts    # Step → semantic action conversion
│   │   └── workflow-analyzer.ts   # Workflow pattern analysis
│   ├── generators/
│   │   ├── canonical-step-generator.ts  # Canonical step generation
│   │   ├── execution-json-generator.ts  # Execution JSON generation
│   │   └── playwright-generator.ts      # Playwright script generation
│   ├── registry/
│   │   └── generator-registry.ts  # Generator registration
│   ├── contracts/
│   │   ├── execution-json-types.ts # Execution JSON type contracts
│   │   └── generator-contract.ts   # Generator interface contract
│   ├── types.ts                   # Generation type definitions
│   └── verb-mapping-table.ts      # Action verb mapping
├── ai/
│   ├── ai-service.ts              # AI service (provider-agnostic)
│   ├── ai-observer.ts             # AI enrichment observer
│   ├── ai-understanding.ts        # AI understanding types
│   ├── provider-manager.ts        # AI provider management
│   ├── connection-tester.ts       # AI connection testing
│   ├── index.ts                   # AI module exports
│   └── providers/
│       ├── openai.ts, claude.ts, gemini.ts, azure-openai.ts,
│       │   openrouter.ts, custom.ts, types.ts
├── shared/
│   ├── types.ts                   # Shared type definitions (ElementIdentity, events, etc.)
│   ├── messaging.ts               # Message type constants
│   ├── architecture-types.ts      # Architecture type flags
│   ├── classifier-constants.ts    # Shared classifier constants
│   └── evidence-types.ts          # Shared evidence type definitions
├── sidepanel/
│   ├── sidepanel.ts               # Side panel UI logic
│   └── timeline-renderer.ts       # Timeline rendering and action descriptions
├── settings/
│   └── settings.ts                # Settings page (AI provider config)
├── repository/
│   ├── repository-page.ts         # Repository page (test cases)
│   └── repository-service.ts      # Repository data service
├── infrastructure/
│   ├── audit-manager.ts           # Audit logging
│   ├── error-handler.ts           # Error handling
│   └── logging-manager.ts         # Logging management
├── screenshots/
│   └── screenshot-service.ts      # Screenshot capture service
├── storage/
│   ├── storage-service.ts         # Chrome storage wrapper
│   └── schema-version.ts          # Storage schema versioning
└── manifest.json                  # Extension manifest
```

---

*This document is frozen at the `semantic-interaction-engine-v1.0` tag. All future enhancements should reference this as the baseline.*
