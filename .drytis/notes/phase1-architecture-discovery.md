# Phase 1 — Existing Architecture Discovery & Understanding

**Version documented:** 6.1.0 | **Date:** 2026-07-16

This document is the authoritative reference for the CmdRunner Smart Recorder's
existing interaction architecture. Every component, dependency, and data flow
has been traced through the source code.

---

## 1. System Overview — Three-Phase Architecture

### Phase 1: CAPTURE (during recording)
```
Browser DOM Event
  → Content Script (event detection → identity extraction → ownership → dedup)
    → chrome.runtime.sendMessage (e.g. CLICK_CAPTURED)
      → Service Worker onMessage handler
        → processAction()
          → session.addAction() [ID generation, storage persistence]
          → ScreenshotService.capture() [fire-and-forget]
          → AIService.understand() [async, non-blocking, stored on event]
```

### Phase 2: NAVIGATION
```
chrome.webNavigation.onCommitted (frameId=0, http/https)
  → session.addNavigation() [consecutive same-URL dedup]
  → ScreenshotService.capture() [500ms delay]
```

### Phase 3: GENERATION (on Stop Recording)
```
STOP_RECORDING message
  → session.stop()
  → GenerationEngine.generate()
    → Stage 1: canonical-step-generator [timeline → CanonicalStep[] + readability]
    → Stage 2: execution-json-generator [steps + locators → executionJson]
    → Stage 3: playwright-generator [steps with JSON → test code string]
    → Batch persist: GENERATED_STEPS + GENERATED_PLAYWRIGHT
```

**Critical architectural invariant (B3):** Steps are NOT generated during
recording. The Timeline is immutable once recorded. All artifacts are produced
post-Stop by the Generation Engine.

---

## 2. Browser Event Flow

### Which events are captured (by content script)

| Content Script | DOM Events | Capture Phase | Message Type |
|---|---|---|---|
| click | `click`, `dblclick` | Yes | CLICK_CAPTURED |
| text-entry | `focus`, `blur` | Yes | TEXT_CAPTURED |
| hover | `mouseenter`, `mouseleave` | Yes | HOVER_CAPTURED |
| checkbox-radio | `change`, `mousedown` (ARIA) | Yes | CHECKBOX_CAPTURED / RADIO_CAPTURED |
| select | `change`, `mousedown`, `keydown` | Yes | SELECT_CAPTURED |
| datepicker | `change`, `mousedown` | Yes | DATE_SELECT_CAPTURED |
| (navigation) | — (chrome.webNavigation API) | — | (internal) |

### Event flow path
All content scripts run in an **isolated world** (no module imports). Events
are captured in the capture phase (before application handlers). Each script:
1. Detects the event
2. Resolves the target via `event.composedPath()` (crosses Shadow DOM)
3. Runs its gate/decision tree
4. Extracts element identity
5. Sends `chrome.runtime.sendMessage` to the service worker

### Ownership resolution
Two data attributes provide cross-script coordination:
- `data-cmdrunner-handled="select|checkbox-radio|dateSelect"` — permanent claim
- `data-cmdrunner-pending-select="true"` — transient optimistic claim

Priority order (highest to lowest):
1. checkbox-radio
2. select
3. dateSelect
4. hover
5. click (lowest — skips all owned selectors via 8 skip checks)

### Conflict resolution
Each content script checks `isOwnedByAnother()` / `isOwnedByAnotherInteraction()`
which walks `closest('[data-cmdrunner-handled]')` and `closest('[data-cmdrunner-pending-select]')`.
Click is the fallback — it only fires if no other recorder has claimed the element.

---

## 3. Recorder Architecture (8 recorders)

### 3.1 Click Recorder (click-content-script.ts, ~1005 lines)
- **Responsibility:** Record meaningful element clicks
- **Events:** click, dblclick (capture)
- **Skip selectors (8 decisions):** checkbox/radio, native select, dropdown options,
  segmented controls [aria-pressed], ARIA menu items, native date inputs,
  calendar cells + calendar overlays, date-like text inputs
- **Dedup:** Uses `event.detail` count + 300ms identityKey window
- **Ownership:** Does NOT claim — lowest priority
- **Message:** `{type: 'CLICK_CAPTURED', payload: identity}`

### 3.2 Text Entry Recorder (text-entry-content-script.ts, ~317 lines)
- **Responsibility:** Record text input value changes
- **Events:** focus (capture pre-value), blur (capture post-value)
- **Logic:** Emits only if value changed and is non-empty. One event per focus cycle.
- **Selector:** input[type=text/email/password/search/tel/url/number], textarea,
  [contenteditable]. Native date inputs excluded.
- **Ownership:** Does not claim (focus/blur, not click-based)

### 3.3 Hover Recorder (hover-content-script.ts, ~1561 lines)
- **Responsibility:** Record hover interactions that cause observable DOM changes
- **Events:** mouseenter, mouseleave (capture)
- **6-Gate Decision Tree:**
  1. isTrusted
  2. Not owned
  3. isHoverResponsive (aria-haspopup, :hover CSS rules, class hints, etc.)
  4. Debounce (2000ms recent hover suppression)
  5. Observable change via MutationObserver OR visibility transition detection
  6. (implicit: dwell threshold 500ms)
- **Walk-up clone:** Clones parent subtree to off-screen container, walks up ≤4
  ancestors to detect CSS ancestor-chain context
- **Ownership:** Does NOT claim — hover is transient

### 3.4 Checkbox-Radio Recorder (checkbox-radio-content-script.ts, ~846 lines)
- **Responsibility:** Record checkbox toggle and radio selection
- **Events:** change (capture), mousedown (capture for ARIA controls)
- **5-Gate:** isTrusted → ownership → selector match → value change (preStateMap) → enabled
- **Ownership:** Claims `data-cmdrunner-handled='checkbox-radio'`
- **ARIA controls:** setTimeout(0) to read post-click aria-checked state

### 3.5 Select Recorder (select-content-script.ts, ~1538 lines)
- **Responsibility:** Record dropdown/select value selections
- **5 mechanisms:** native select change, ARIA option mousedown, ARIA menu item
  mousedown, segmented control [aria-pressed] mousedown, CSS-class-differential
  generic fallback
- **Pre-state:** preStateMap tracks values per control
- **Trigger resolution:** aria-labelledby → aria-controls → aria-owns → container fallback
- **Ownership:** Claims `data-cmdrunner-handled='select'` on individual OPTIONS
  (not containers). Ignores own ownership for re-selection.
- **Calendar skip:** DATEPICKER_CONTAINER_SELECTOR checked in option, segmented,
  and generic handlers

### 3.6 Date Picker Recorder (datepicker-content-script.ts, ~1132 lines)
- **Responsibility:** Record date/time/range value selections
- **4 mechanisms:** native date input change, calendar grid cell mousedown,
  editable text input change, post-click value outcome detection
- **Two-pass cell detection:** Explicit selectors (role=gridcell, data-date,
  td[aria-label]) then broader (numeric text inside calendar container,
  aria-label with month name, data-day)
- **Post-click outcome:** Snapshots all text inputs on mousedown, checks 300ms
  later if any changed to date-like format
- **Ownership:** Claims `data-cmdrunner-handled='dateSelect'`

### 3.7 Navigation (service-worker.ts)
- **Responsibility:** Record page navigations
- **Mechanism:** chrome.webNavigation.onCommitted (frameId=0, http/https)
- **Dedup:** Consecutive same-URL suppressed
- **No content script** — uses Chrome extension API directly

---

## 4. AI Integration

### Where AI is invoked
`processAction()` in service-worker.ts (line 140):
```typescript
const understanding = await AIService.understand(elementInfo);
session.updateEventWithAI(actionId, understanding);
```

### What is sent to AI
```typescript
{
  actionType: string,      // e.g. 'click'
  text: string,            // accessibleName || tag
  tag: string,             // e.g. 'BUTTON'
  role: string | null,     // ariaRole
  className: string | null // space-joined CSS classes
}
```
**NOT sent:** CSS selectors, XPath, IDs, test attributes, iframe context, shadow DOM.

### What AI returns
```typescript
{
  businessName: string;      // "Login Button"
  controlType: string;       // "Button"
  userIntent: string;        // "Submit the login form"
  confidenceScore: number;   // 0.0-1.0
}
```

### How AI responses are used
1. Stored on timeline event as `aiUnderstanding` during recording
2. Projected onto CanonicalStep.aiEnrichment + aiConfidence during generation
3. Used in `toPlainEnglish()` for display name (subject to icon guard)
4. **NOT used for:** locator resolution, execution JSON, or Playwright code generation

### AI-dependent vs deterministic decisions

| Decision | AI-Dependent? |
|---|---|
| Element display name (businessName) | ✅ Yes (icon guard fallback is deterministic) |
| confidenceScore | ✅ Yes |
| controlType, userIntent | ✅ Yes (stored but not currently used) |
| Locator strategy selection | ❌ Deterministic (B4.4 priority) |
| Action type mapping | ❌ Deterministic (mapActionType) |
| Playwright API mapping | ❌ Deterministic (translateAction) |
| Readability optimization | ❌ Deterministic (structural) |

### Vestigial per-type prompts
Each interaction type config has a `buildPrompt()` function, but it is **never
called at runtime**. `AIService.understand()` uses the generic
`buildUnderstandingPrompt()` from ai-understanding.ts for all types.

---

## 5. Semantic Interaction Determination

### Where types are assigned
Interaction type is determined **deterministically at capture time** by the
content script — NOT by AI. Each content script emits a typed message
(CLICK_CAPTURED, SELECT_CAPTURED, etc.).

The message type directly maps to the action type. The service worker's
`processAction()` uses the action type to select the registry config.

### Decision path
```
DOM Event → Content Script (selector matching + gates)
  → Determines interaction type (click, text, select, dateSelect, etc.)
    → Sends typed message
      → Service worker processAction(actionType)
        → Registry config.addToSession()
          → Timeline event with type discriminator
            → (generation) config.toPlainEnglish() produces semantic step
```

### Which decisions are AI-dependent for SEMANTICS
None. AI only enriches the DISPLAY NAME. The interaction TYPE is always
deterministic, assigned by the content script based on DOM selectors and gate
logic.

---

## 6. Interaction Timeline

### Which component creates entries
`RecordingSession.addAction()` — called by `processAction()` in the service worker.

### What is stored (per event)
```typescript
{
  actionId: string,           // "click-0001" (type-specific prefix)
  type: string,               // discriminator
  elementIdentity: ElementIdentity, // 18-field identity
  timestamp: string,
  // type-specific fields (value, checked, dateType, etc.)
  aiUnderstanding?: AIUnderstanding,
  aiError?: string
}
```

### What is preserved
- Full element identity (all 18 fields)
- Exact interaction type
- Timestamp
- Type-specific payload (value, checked, displayValue, isoValue, etc.)
- AI enrichment (when available)

### What is discarded
- DOM node references (content scripts serialize identity)
- Transient state (preStateMap, ownership attributes)
- Screenshot is captured separately and linked by actionId

### Ordering
Events are pushed to `events[]` in chronological order. No reordering.
Navigation events interleaved by timestamp. ID generators maintain per-type
sequential counters.

---

## 7. Artifact Generation Pipeline

### Pipeline stages

```
Timeline (SessionEvent[])
  ↓
  ↓ Stage 1: canonical-step-generator (no deps)
  ↓
CanonicalStep[] (plainEnglish + identity + aiEnrichment, executionJson=null)
  ↓
  ↓ Stage 2: execution-json-generator (dep: canonical-step-generator)
  ↓
CanonicalStep[] (executionJson populated, 6-section contract)
  ↓
  ↓ Stage 3: playwright-generator (dep: execution-json-generator)
  ↓
Playwright test code string
```

### Stage responsibilities

| Stage | Input | Output | Key Operations |
|---|---|---|---|
| canonical-step-generator | timeline + recordingContext | CanonicalStep[] | Type→plainEnglish mapping, readability optimization (OR-1 focus+click merge), step numbering |
| execution-json-generator | steps with null JSON | steps with JSON | mapActionType, locator resolution (B4.4 priority), 6-section JSON construction |
| playwright-generator | steps with JSON + context | test code string | locator→Playwright API translation, action→Playwright verb, iframe prefixing, test wrapping |

### Readability optimizer (internal to Stage 1)
- OR-1: Focus-Click + Text-Entry merge (same element → click omitted, text retained)
- OR-2: Consecutive text entries remain separate (constraint)
- OR-3: Duplicate click removal (hook only, not implemented)

---

## 8. Shared Infrastructure

### Shared models (src/shared/types.ts)
- SessionEvent union (8 event types)
- ElementIdentity (18 fields, shared by all recorders)
- AIUnderstanding, AIConfig
- CanonicalStep, ExecutionJsonObject
- AppMessage union

### Shared utilities (inlined in every content script)
- computeAccessibleName (9-level cascade)
- generateCssSelector, generateXPath
- isInShadowDom, extractIframeContext
- checkRecording (chrome.storage.local sync)

### Common services
- AIService.understand() — generic prompt, not type-specific
- ScreenshotService.capture() — fire-and-forget
- StorageService — chrome.storage.local abstraction
- ProviderManager — 6 AI providers (Gemini, OpenAI, Claude, OpenRouter, Azure, Custom)

### Message passing
- Content scripts → Service worker: chrome.runtime.sendMessage
- Service worker → Content scripts: chrome.tabs.sendMessage (not currently used)
- All synchronous (return false from listeners)

### Generation services
- GeneratorRegistry (topological sort)
- GenerationEngine (orchestrator, transient)
- LocatorResolutionEngine (B4.4, pure function)

### How each type depends on shared infrastructure
ALL types share: ElementIdentity shape, chrome.storage.local for recording state,
message passing to service worker, `addToSession()` in recording-session.ts,
registry config for plain English + execution extras.

---

## 9. Dependency Analysis

### Module coupling map

```
HIGHEST COUPLING:
  click-content-script ↔ select-content-script (8 skip selectors)
  click-content-script ↔ datepicker-content-script (skip selectors + calendar overlay)
  select-content-script ↔ datepicker-content-script (calendar container skip)

MODERATE COUPLING:
  service-worker ↔ recording-session (session singleton)
  service-worker ↔ interaction-types registry (processAction)
  canonical-step-generator ↔ interaction-types registry (toPlainEnglish)
  canonical-step-generator ↔ readability-optimizer (internal)

LOW COUPLING:
  generation engine ↔ generators (contract-based, no internal imports)
  AI service ↔ providers (interface-based)
  playwright-generator ↔ execution-json (reads only published output)
```

### Components most affected by architectural changes
1. **interaction-types.ts** — central registry, coupling point between recording
   and generation. Changes ripple to both layers.
2. **Content scripts** — duplicated helpers across 6 files. Changes to shared
   logic (identity extraction, ownership checks) must be replicated.
3. **service-worker processAction()** — every interaction type flows through
   this single function.
4. **canonical-step-generator** — extras extraction is type-specific (manual
   field-by-field extraction via type assertions).

### Components that can evolve independently
1. Playwright generator (could be swapped for Cypress/Selenium)
2. AI providers (interface-based, pluggable)
3. Locator resolution engine (pure function, no side effects)
4. Readability optimizer (internal to canonical-step-generator, isolated)
5. Screenshot service (fire-and-forget, no pipeline dependency)

---

## 10. Architecture Risks

### Tightly coupled components
1. **Content script code duplication** — 6 files each with identical ~200 lines
   of helper code (accessibleName, CSS/XPath, iframe detection). Fixing a bug
   requires editing all 6 files.

2. **interaction-types.ts as single coupling point** — connects recording
   (addToSession) to generation (toPlainEnglish, executionExtras). Any
   architectural change to AI or semantic determination must pass through here.

3. **processAction() as single chokepoint** — all 7 interaction types flow
   through one function with type-specific branching. Growth increases complexity.

### Components difficult to modify
1. **Hover recorder** — 1561 lines, complex MutationObserver + visibility
   transition detection. High risk of regression.

2. **Select recorder** — 5 mechanisms in one file, ownership quirks (re-selection
   allowed, per-option ownership).

3. **Ownership protocol** — cross-script coordination via DOM attributes is
   fragile. Attribute names are hardcoded strings in every file.

### Regression risk areas
1. **Adding a new interaction type** requires: new content script, new message
   case in service worker, new skip selectors in click-content-script, new
   registry config, new event type in SessionEvent union, extras extraction in
   canonical-step-generator, action type mapping in execution-json-generator.

2. **Modifying AI prompt construction** could affect all interaction types
   simultaneously (generic prompt used for all).

3. **Readability optimizer changes** could merge/omit steps unexpectedly.

### Migration concerns
1. **Legacy code** (step-builder.ts, flat ExecutionJson) coexists with new
   pipeline. Must not confuse the two.

2. **isAppMessage() type guard** missing DATE_SELECT_CAPTURED — any code relying
   on the type guard would reject dateSelect messages.

3. **MV3 service worker lifecycle** — ensureSessionRestored() pattern is critical.
   Any change to session initialization must account for SW termination.

---

## Mental Model Summary

**How a browser event becomes a recorded interaction:**
1. User interacts with a web page
2. Content script in isolated world detects the DOM event (capture phase)
3. Content script runs its decision tree (selectors, gates, ownership checks)
4. Content script extracts element identity and sends a typed message
5. Service worker's processAction() receives it, creates a SessionEvent, persists it
6. AI enrichment runs async, stored on the event

**How semantic interaction types are determined:**
Deterministically by the content script at capture time, based on DOM selectors
and gate logic. AI does NOT determine the interaction type.

**How AI participates:**
Enriches the display name only (businessName → plain English). All structural
decisions (type, locators, execution JSON, Playwright code) are deterministic.

**How ownership is resolved:**
DOM attributes (data-cmdrunner-handled, data-cmdrunner-pending-select) with a
priority hierarchy. Click is always lowest priority.

**How the Timeline is produced:**
Events are pushed in chronological order with per-type sequential IDs. Immutable
once stored.

**How Canonical Steps are generated:**
Post-Stop, the Generation Engine reads the Timeline and maps each event to a
CanonicalStep via the registry's toPlainEnglish(). Readability optimization
merges focus+click+text patterns.

**How Execution JSON is generated:**
For each step, the Execution JSON Generator maps the action type to an abstract
verb, resolves locators via B4.4 priority, and constructs a 6-section JSON object.

**How Playwright code is generated:**
The Playwright Generator reads each step's executionJson, translates the locator
strategy to a Playwright API call, and maps the action verb to a Playwright method.

**Which components are tightly coupled:**
Content scripts (duplicated helpers), interaction-types registry (recording↔generation
bridge), processAction (single chokepoint), click↔select↔datepicker skip selectors.

**Which components can evolve independently:**
Generators (contract-based), AI providers (interface-based), locator engine (pure),
Playwright generator (swappable output format).
