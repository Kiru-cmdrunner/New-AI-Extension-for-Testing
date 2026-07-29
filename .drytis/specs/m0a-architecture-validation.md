# Milestone 0A — Architecture Validation & Final Design

**Status:** Architecture Freeze — the single source of truth for the Component Runtime rebuild.
**Date:** 2026-07-26
**Supersedes for implementation:** `architecture-c-production.md` (7-layer Architecture C blueprint), `architecture-c-implementation-plan.md` (8-phase plan). Those documents remain valid as design history and rationale; this document is the implementation authority.

---

## 1. Document Reconciliation

### 1.1 Documents Reviewed

| Document | Location | Role |
|---|---|---|
| Architecture C Production Blueprint | `.drytis/architecture-c-production.md` | Original 7-layer design (Observer → Coalescer → Classifier → AI → Session Context → Timeline → Generation) |
| Architecture C Implementation Plan | `.drytis/architecture-c-implementation-plan.md` | 8-phase roadmap (Phase 0–7) |
| Architecture Review (4 Eras) | `docs/architecture-review.md` | Historical context: 4 architectural eras |
| Technical Architecture | `docs/TECHNICAL_ARCHITECTURE.md` | Current Phase 1 codebase documentation |
| Milestone C4 Freeze | `.drytis/specs/milestone-c4-complete-freeze.md` | Frozen checkpoint: checkbox/radio, 707 tests |
| V3.1 Foundation Assessment | `.drytis/specs/freeze-v3.1-foundation-assessment.md` | Frozen: 9 architecture principles, element identity, recording session lifecycle |
| Phase 5 Pipeline Integration | `.drytis/specs/phase5-pipeline-integration.md` | Feature flag wiring (historical) |
| UI Cutover | `.drytis/specs/ui-cutover.md` | Side panel display changes (historical) |
| Execution IR Design | `.drytis/execution-ir-design.md` | IR types, IRAction enum, ResolvedLocator |
| Architecture Types | `src/shared/architecture-types.ts` | CanonicalType, SessionContext, MentalModel, ConfidenceState, etc. |
| Shared Types | `src/shared/types.ts` | ElementIdentity (18-field), SessionEvent, StorageKeys, AppMessage |
| IR Bridge | `src/generation/ir-bridge.ts` | SessionEvent[] + DetectedInteraction[] → ExecutionIRPlan |
| Architecture Walkthrough | `docs/architecture-walkthrough.md` | End-to-end flow validation |

### 1.2 Conflicts Identified & Resolved

| # | Conflict | Architecture C Says | Component Runtime Does | Resolution |
|---|---|---|---|---|
| 1 | **Coalescer/Classifier separation** | Separate Layer 2 (Coalescer) and Layer 3 (Classifier) — 500ms temporal windowing, primary event selection, then 16-rule 3-tier classification | Fuses into lifecycle-based Component Definitions — each definition tracks its own event sequence via `isInScope()` + `handleEvent()` | **Component Runtime wins.** Lifecycle tracking is strictly more expressive than snapshot classification. A date picker requires knowing the full focus → calendar open → cell click → change sequence as a connected lifecycle, not a single snapshot. The coalescer's temporal windowing is implicit in the definition's scope. |
| 2 | **Feature flag (USE_ARCHITECTURE_C)** | Phases 0–5 run behind a feature flag; old pipeline coexists | Replaces the old pipeline entirely — no feature flag, no coexistence | **No feature flag.** The old Phase 1 pipeline (RecordingSession, InteractionDetector, V1/V2 evidence engine) is replaced, not shadowed. The generation pipeline downstream is preserved. Coexistence adds complexity for no benefit during a rebuild. |
| 3 | **16-rule 3-tier classifier** | 16 rules across 3 tiers (Tier 1: 6 deterministic, Tier 2: 8 behavioral, Tier 3: 2 AI+fallback) | Priority-ordered Component Definitions (10–180 priority) | **Component Definitions win.** Each definition encodes its own trigger/scope/handle/build logic. Priority ordering replaces tier evaluation. The Click definition (priority 180) is the universal fallback — equivalent to Rule 16. DatePicker (priority 10) replaces Rules 3/7/8. The result is the same classification outcomes through a more maintainable structure. |
| 4 | **Timeline as SessionEvent[]** | SessionEvent[] in `SESSION_EVENTS` storage key | `ComponentInteraction[]` in `LIVE_INTERACTIONS` storage key | **ComponentInteraction[] is the new Timeline.** The old `SessionEvent` type (with its 7-type union) is replaced by the unified `ComponentInteraction` type. The generation pipeline is adapted to consume ComponentInteractions. The IR Bridge input is updated accordingly. |
| 5 | **AI Observer (Layer 4)** | Structural component: advisory classification, Mental Model (L2), 5-track confidence | **Deferred.** Not needed for OrangeHRM validation. The Component Runtime is fully functional without AI. AI integration is a future milestone. | **AI is out of scope for this rebuild.** AP2 (Graceful Degradation) means the system works without AI. The OrangeHRM bugs are all deterministic — no AI needed to fix dropdown no-ops, date picker double-trigger, or button capture. |
| 6 | **Session Context (Layer 5)** | 3-layer structure: L1 DeterministicState, L2 MentalModel, L3 Action History | **L3 only (the interaction list).** L1 (State Tracker) and L2 (Mental Model) are future enhancements. The Component Runtime tracks its own internal state (active component stack) which serves the L1 purpose. | **Deferred.** The runtime's component stack IS the minimal session context. Full L1/L2 are future work. |

### 1.3 Obsolete Documents

| Document | Status | Reason |
|---|---|---|
| `architecture-c-implementation-plan.md` Phase 0–7 phases | **Superseded** | The 8-phase plan was designed for the 7-layer Architecture C. The Component Runtime has a different decomposition (Milestones 0–8). |
| `phase5-pipeline-integration.md` | **Obsolete** | Describes feature-flag wiring for Architecture C coexistence. We are replacing, not coexisting. |
| `ui-cutover.md` | **Obsolete** | Describes switching side panel from V1 to merged V1/V2 output. The new side panel reads ComponentInteractions directly. |
| `engineering-stabilization.md` | **Obsolete** | Technical debt cleanup for the Phase 1 pipeline. That pipeline is being replaced. |

### 1.4 Preserved Design Principles

These principles from Architecture C are **preserved without modification**:

| Principle | Source | How It's Honored |
|---|---|---|
| AP1: Separation of evidence and classification | Architecture C §2 | EventTap captures raw events (no classification). ComponentRuntime + Definitions classify. |
| AP2: Graceful degradation (works without AI) | Architecture C §2 | System is fully functional without AI. AI is a future enhancement. |
| AP4: Evidence sovereignty | Architecture C §2 | Definitions use deterministic DOM evidence (ARIA roles, element types, class patterns). No AI override. |
| AP5: Linear data flow | Architecture C §2 | EventTap → Runtime → Definitions → Presentation → Storage → Generation. No feedback loops. |
| AP6: Contract-based boundaries | Architecture C §2 | Typed interfaces: `ObservedEvent`, `ComponentDefinition`, `ComponentInteraction`. |
| AP7: Additive extensibility | Architecture C §2 | New interaction type = new definition file + add to `ALL_DEFINITIONS`. No existing files change. |
| P1–P8 AI Philosophy | Architecture C §7 | Deferred — no AI in this rebuild. Principles preserved for future AI integration. |
| Frozen identity model | V3.1 freeze §3 | `ElementIdentity` 18-field structure preserved. Identity extraction logic reused from current codebase. |
| Capture-phase listeners | V3.1 freeze §1 | EventTap uses capture phase for all listeners. |
| composedPath for shadow DOM | V3.1 freeze §2 | `resolveTarget()` uses `event.composedPath()`. |

---

## 2. Final Architecture — Component Runtime

### 2.1 Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CONTENT SCRIPT                                 │
│                                                                      │
│  ┌─────────────┐     ┌────────────────────┐     ┌────────────────┐  │
│  │  EventTap   │────▶│ IdentityExtractor   │────▶│ recorder-entry │  │
│  │  (Layer 1)  │     │ (Layer 1)           │     │ (entry point)  │  │
│  │             │     │                     │     │                │  │
│  │ Capture-    │     │ 10-tier accessible  │     │ sessionStorage │  │
│  │ phase DOM   │     │ name cascade,       │     │ buffer +       │  │
│  │ listeners   │     │ CSS selector,       │     │ sendMessage    │  │
│  │ for ALL     │     │ XPath, shadow DOM   │     │ to SW          │  │
│  │ event types │     │ piercing            │     │                │  │
│  └─────────────┘     └────────────────────┘     └───────┬────────┘  │
│                                                        │            │
└────────────────────────────────────────────────────────┼────────────┘
                                                         │ ObservedEvent
                                                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    SERVICE WORKER (MV3)                               │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                   ComponentRuntime                              │  │
│  │                   (Layers 2+3 fused)                            │  │
│  │                                                                │  │
│  │  createRuntime(ALL_DEFINITIONS, { onEmit })                    │  │
│  │                                                                │  │
│  │  process(event: ObservedEvent): ComponentInteraction[]         │  │
│  │    1. Navigation? → flush all active as 'interrupted'         │  │
│  │    2. Offer event to active components (stack, top → bottom)  │  │
│  │       • Each def.handleEvent() may return completion           │  │
│  │    3. Outside-cancellation check                               │  │
│  │       • def.shouldCancelOnOutside() → mark abandoned           │  │
│  │    4. Discovery — no active component claimed it:             │  │
│  │       • Iterate definitions by priority (high → low)          │  │
│  │       • First def.detectTrigger() that matches → new context  │  │
│  │       • Skip Click (priority 180 = universal fallback)        │  │
│  │    5. Click fallback                                           │  │
│  │                                                                │  │
│  │  completeComponent(ctx):                                       │  │
│  │    • def.buildResult() → ComponentInteraction                  │  │
│  │    • Dedup check (type + elementKey + endTime window)         │  │
│  │    • onEmit(interaction)                                       │  │
│  │                                                                │  │
│  │  flush(): mark all active as 'interrupted', emit               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                   Component Definitions                        │  │
│  │                   (Layer 3 — the classifiers)                  │  │
│  │                                                                │  │
│  │  Each definition:                                              │  │
│  │    type: InteractionType                                       │  │
│  │    priority: number (higher = first in discovery)             │  │
│  │    triggerEventTypes: Set<BrowserEventType>                   │  │
│  │    detectTrigger(event): ComponentTrigger | null              │  │
│  │    isInScope(event, ctx): boolean                             │  │
│  │    handleEvent(event, ctx): ComponentCompletion | null        │  │
│  │    shouldCancelOnOutside(event, ctx): boolean                 │  │
│  │    buildResult(ctx, completion): { metadata }                 │  │
│  │                                                                │  │
│  │  Priority Order:                                               │  │
│  │    10  DatePicker   — date inputs, calendar cells             │  │
│  │    20  Dropdown     — combobox, listbox, select, options      │  │
│  │    30  Checkbox     — checkbox inputs/roles                   │  │
│  │    40  RadioButton  — radio inputs/roles                      │  │
│  │    50  TextEntry    — text inputs, textareas, contentEditable │  │
│  │    60  Hover        — dwell + observable behavior             │  │
│  │    70  Link         — <a> tags, role=link                     │  │
│  │    80  FileUpload   — file inputs                             │  │
│  │    90  Slider       — range inputs                            │  │
│  │   100  Tab          — role=tab                                │  │
│  │   110  Scroll       — scroll events with non-zero delta       │  │
│  │   120  Navigation   — synthetic from webNavigation API        │  │
│  │   180  Click        — universal fallback (any interactive)    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              Presentation Layer (filter + display)             │  │
│  │                                                                │  │
│  │  isProductionInteraction(interaction): boolean                 │  │
│  │    • endState must be 'completed'                             │  │
│  │    • TextEntry: userTyped=true, textValue non-empty           │  │
│  │    • Dropdown: noOpSelection=false                            │  │
│  │    • RadioButton: noOpSelection=false                         │  │
│  │    • DatePicker: selectedDate non-empty                       │  │
│  │    • Scroll: deltaTop or deltaLeft non-zero                   │  │
│  │    • Hover: needs evidence                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                   Persistence                                  │  │
│  │                                                                │  │
│  │  LIVE_INTERACTIONS → chrome.storage.local                     │  │
│  │    Written IMMEDIATELY on each emit (no debounce)             │  │
│  │    Read by side panel via chrome.storage.onChanged            │  │
│  │    Survives MV3 SW termination                                │  │
│  │                                                                │  │
│  │  ensureSessionRestored():                                      │  │
│  │    On SW restart, reads LIVE_INTERACTIONS, recreates runtime  │  │
│  │    Dedup via seenEventIds set                                 │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    GENERATION PIPELINE (preserved)                    │
│                                                                      │
│  ComponentInteraction[]                                              │
│    ↓                                                                 │
│  IR Bridge → ExecutionIRPlan                                        │
│    ↓                                                                 │
│  ExecutionIRPlan → Playwright code + Execution JSON                 │
│    ↓                                                                 │
│  Side panel stopped view (steps + code)                             │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Runtime Flow — Stage by Stage

#### Stage 1: Event Tap (Content Script)

**Purpose:** Capture every trusted DOM event with full element identity. Zero classification logic.

**Event types captured:**
- `click`, `mousedown`, `contextmenu` — mouse interactions
- `focus`, `blur` — focus transitions
- `input`, `change` — value mutations
- `mouseenter`, `mouseleave` — hover detection
- `keydown` — keyboard input
- `scroll` — viewport scrolling (rate-limited to 16ms minimum interval)

**Per event, extracts:**
- `eventType`, `timestamp` (Date.now()), `isTrusted` (reject synthetic)
- `target` — `ElementIdentity` via identity extractor
- `domContext` — disabled, readOnly, required, inputType, ancestorRoles, ancestorClasses
- `valueBefore` / `valueAfter` — for inputs/textareas/contentEditable (on focus/click and input/change respectively)
- `checkedBefore` / `checkedAfter` — for checkboxes/radios and ARIA checkbox/switch
- `clientX`, `clientY`, `key`, `code`, modifier keys
- `frameInfo` — top frame or iframe context

**Identity extraction (10-tier accessible name cascade):**
1. `aria-label`
2. `aria-labelledby` (resolved text)
3. `label[for=<id>]` text
4. Wrapping `<label>` text
5. `<select>` selected option text
6. `innerText` (with section-container guard for multi-control containers)
7. `placeholder`
8. Input `value` (submit/button/reset only)
9. `alt` attribute
10. `title` attribute

**MV3 resilience:**
- Each event gets a page-unique ID: `evt-{pageId}-{counter}`
- Events buffered to `sessionStorage` before `sendMessage`
- On successful delivery, removed from buffer
- On failure, stays in buffer → `flushPendingEvents()` retries with `Promise.allSettled` on next page
- `pagehide` handler sends best-effort but does NOT drain buffer

#### Stage 2: Component Runtime (Service Worker)

**Purpose:** Manage active component lifecycles. Process events through the definition stack. Emit completed interactions.

**State:**
- `activeStack: ComponentContext[]` — active components, newest at top
- `seenEventIds: Set<string>` — dedup (cap at 500, halve when exceeded)
- `lastEmittedForDedup` — type + elementKey + endTime + metadata for temporal dedup
- `errorLog: string[]` — accumulate definition errors without crashing

**`process(event)` algorithm:**
1. **Dedup:** if event.eventId in seenEventIds → skip
2. **Navigation flush:** if event is navigation → flush all active as 'interrupted'
3. **Offer to active stack (top → bottom):**
   - For each active context, check `def.isInScope(event, ctx)`
   - If in scope: call `def.handleEvent(event, ctx)` → if returns completion, call `completeComponent(ctx)`
   - If not in scope: check `def.shouldCancelOnOutside(event, ctx)` → if true, mark abandoned and remove from stack
4. **Discovery (if no active component handled it):**
   - Iterate ALL_DEFINITIONS by priority descending
   - Skip Click (priority 180 — it's the fallback)
   - For each: if event type in `triggerEventTypes` AND `def.detectTrigger(event)` returns non-null → create new ComponentContext, push to stack
   - If no match: try Click definition as fallback
5. Return list of newly emitted interactions

**Dedup (in `completeComponent`):**
- Compare against `lastEmittedForDedup`
- Same type + same elementKey + gap between `lastEmitted.endTime` and `ctx.startTime` ≤ DEDUP_WINDOW_MS (2000ms)
- For DatePicker: also compare `selectedDate` in metadata — if same date value, suppress
- Purpose: suppress click+change pairs, focus-return-after-selection duplicates

**`flush()`:**
- Mark all active components as 'interrupted'
- Emit each with `endState: 'interrupted'`
- Clear active stack

**Safe-call isolation:**
- Every definition method call wrapped in try/catch
- If a definition throws, log the error and treat as "no match" — the runtime continues processing
- No single definition bug can crash the recording session

#### Stage 3: Component Definitions

Each definition is a self-contained classifier for one interaction type. The definition knows:
- **When to trigger** (`detectTrigger`) — is this event the start of my interaction?
- **What's in scope** (`isInScope`) — does this event belong to my active interaction?
- **When to complete** (`handleEvent`) — has the user finished this interaction?
- **When to abandon** (`shouldCancelOnOutside`) — did the user click elsewhere, abandoning my interaction?
- **What metadata to produce** (`buildResult`) — what details describe this interaction?

**Definition-specific logic:**

| Definition | Trigger | Scope | Completion | No-op Detection |
|---|---|---|---|---|
| **DatePicker** (10) | focus/click on date input (native date type, CSS class, ancestor class, name hints) | trigger + calendar cells (role=gridcell/option) + calendar surface | calendar cell click (dateValue non-empty) OR input change (dateValue non-empty) | empty selectedDate filtered by presentation layer |
| **Dropdown** (20) | click/mousedown/focus on combobox/listbox/select/aria-haspopup | trigger + options (role=option) + dropdown surface + ancestor option/listbox | option click/mousedown OR native SELECT change | option name matches trigger display (normalized, using `\|\|` not `??`) |
| **Checkbox** (30) | click/change on checkbox input or ARIA checkbox/switch | trigger only | immediate (click/change = toggle) | N/A — toggles always count |
| **RadioButton** (40) | click/change on radio input or ARIA radio | trigger only | immediate (click = select) | `checkedBefore=true` means already selected → `noOpSelection=true` |
| **TextEntry** (50) | focus on text input/textarea/contentEditable | trigger only | blur (if userTyped=true and value non-empty) OR focus elsewhere | `userTyped=false` (no input event fired) filtered by presentation layer |
| **Hover** (60) | mouseenter on element with hover potential | trigger | mouseleave after dwell threshold + observable behavior | no observable behavior → not completed |
| **Link** (70) | click on `<a>` or role=link | N/A (immediate) | immediate | N/A |
| **Click** (180) | click/contextmenu on any interactive element (BUTTON, INPUT, SELECT, A, role=button, tabIndex≥0, interactive class patterns) | N/A (immediate) | immediate | rejects non-interactive elements (bare divs, spans, containers) |

#### Stage 4: Presentation Layer

**Purpose:** Filter completed interactions to show only production-relevant actions.

**`isProductionInteraction(interaction)`:**
```
if endState !== 'completed' → false (abandoned/interrupted filtered)
if type === 'TextEntry' AND (userTyped === false OR textValue is empty) → false
if type === 'Dropdown' AND noOpSelection === true → false
if type === 'RadioButton' AND noOpSelection === true → false
if type === 'DatePicker' AND selectedDate is empty → false
if type === 'Scroll' AND deltaTop === 0 AND deltaLeft === 0 → false
if type === 'Hover' AND no evidence → false
otherwise → true
```

**Display labels:**
- Click → "Click {name}"
- TextEntry → "Enter {value} in {name}"
- Dropdown → "Select {value} from {name}"
- Checkbox → "Check {name}" / "Uncheck {name}"
- RadioButton → "Select {name} radio button"
- DatePicker → "Select date {value}"
- Navigation → "Navigate to {url}"
- Scroll → "Scroll {direction} {delta}px"
- Hover → "Hover over {name}"

#### Stage 5: Persistence

**Storage key:** `LIVE_INTERACTIONS` in `chrome.storage.local`

**Write strategy:** IMMEDIATE — no debounce. Every `onEmit` writes synchronously to storage. This is critical for MV3: the SW can be killed at any time (form-submit navigation, idle timeout). A 100ms debounce timer will be killed before it fires.

**MV3 recovery (`ensureSessionRestored`):**
1. Read `UI_STATE` — is recording active?
2. If yes: read `LIVE_INTERACTIONS` from storage
3. Recreate runtime with preserved interaction count
4. Restore `seenEventIds` from storage (for cross-page dedup)

**Session lifecycle:**
- `START_RECORDING`: clear `LIVE_INTERACTIONS`, clear `seenEventIds`, create fresh runtime
- During recording: events → runtime → interactions → immediate storage write → side panel live update via `chrome.storage.onChanged`
- `STOP_RECORDING`: flush runtime, write final interactions, trigger generation pipeline
- Content script `STOP_RECORDING`: clear sessionStorage buffer (prevent stale data)

#### Stage 6: IR Generation

**Purpose:** Convert `ComponentInteraction[]` → `ExecutionIRPlan` → Playwright code.

**Current generation pipeline (PRESERVED):**
```
ComponentInteraction[]
  ↓
IR Bridge (adapted input: ComponentInteraction[] instead of SessionEvent[] + DetectedInteraction[])
  ↓
ExecutionIRPlan { steps: IRStep[] }
  ↓
Playwright adapter → test code string
Execution JSON adapter → ExecutionJsonObject
  ↓
Storage: GENERATED_FILES, EXECUTION_IR_PLAN
  ↓
Side panel stopped view
```

**IR Action mapping (ComponentInteraction.type → IRAction):**

| ComponentInteraction.type | IRAction | Playwright method |
|---|---|---|
| Click | CLICK | `page.click()` |
| TextEntry | FILL | `page.fill()` |
| Dropdown | SELECT | `page.selectOption()` or `page.click()` + `page.click()` |
| Checkbox | TOGGLE | `page.check()` / `page.uncheck()` |
| RadioButton | CLICK | `page.click()` (radio dedup: one click) |
| DatePicker | SELECT_DATE | `page.fill()` with date value |
| Navigation | NAVIGATE | (navigation is implicit in Playwright) |
| Scroll | (filtered or WAIT) | `page.mouse.wheel()` |
| Hover | HOVER | `page.hover()` |
| Link | CLICK | `page.click()` |

#### Stage 7: Playwright Generation

The Playwright adapter (`src/adapters/playwright/`) consumes an `ExecutionIRPlan` and produces executable test code. This component is **entirely preserved** from the current codebase. The only change is that the IR Bridge input type changes from `SessionEvent[] + DetectedInteraction[]` to `ComponentInteraction[]`.

---

## 3. Current Codebase: Reuse, Replace, Remove

### 3.1 REUSED (no changes)

| Component | Location | Why |
|---|---|---|
| Storage Service | `src/storage/storage-service.ts` | chrome.storage.local wrapper — unchanged |
| IR Types | `src/domain/execution-ir/types.ts` | IRAction, IRStep, ExecutionIRPlan — unchanged |
| IR Generator | `src/domain/execution-ir/generator.ts` | Produces ExecutionIRPlan — unchanged |
| Playwright Adapter | `src/adapters/playwright/` | Generates Playwright code — unchanged |
| Element types | `src/domain/entities/element.ts`, `src/domain/enums.ts` | Domain entities — unchanged |
| Locator Ranking | `src/domain/locator-ranking.ts` | Locator candidate extraction — unchanged |
| Repository Service | `src/repository/` | Test case CRUD — unchanged |
| Settings Page | `src/settings/` | AI provider config — unchanged |
| Screenshots | `src/screenshots/` | Screenshot capture — unchanged |
| Architecture Types | `src/shared/architecture-types.ts` | CanonicalType, etc. — reused where applicable |
| Chrome Extension Assets | `src/assets/`, `src/manifest.json` | Icons, manifest structure — manifest updated for new content script |
| Vite Build Config | `vite.config.ts` | Build configuration — unchanged |

### 3.2 REPLACED

| Current Component | Replaced By | Reason |
|---|---|---|
| `src/recorder/deterministic-recorder.ts` (content script) | `src/recorder/phase5/recorder-entry.ts` + `src/tap/event-tap.ts` + `src/tap/identity-extractor.ts` | Old script captures AND classifies. New: capture only. |
| `src/recorder/recording-session.ts` | ComponentRuntime in service worker | Old session manager is Phase 1 specific. Runtime manages lifecycles. |
| `src/classifier/interaction-detector.ts` (V1) | Component Definitions | Rule-based detector replaced by lifecycle definitions. |
| `src/classifier/evidence/` (V2) | Component Definitions | Evidence engine replaced by lifecycle definitions. |
| `src/classifier/evidence/merge-layer.ts` | Component Definitions | V1/V2 merge no longer needed — single classification path. |
| `src/recorder/pipeline/pipeline-runner.ts` | Direct runtime → storage → generation | Post-recording pipeline replaced by direct flow. |
| `src/recorder/pipeline/domain-adapter.ts` | IR Bridge (updated input) | Domain entity adapter replaced by IR Bridge. |
| `src/recorder/recognition/` | Component Definitions | Recognition orchestrator replaced by definitions. |
| `src/recorder/enrichment/` | Component Definitions (metadata in buildResult) | Enrichment orchestrator replaced by definition metadata. |
| `src/background/service-worker.ts` | New service worker (rewritten) | Message routing, runtime management, storage, generation trigger — all new. |

### 3.3 REMOVED (dead code after replacement)

| Component | Location | Lines (est.) |
|---|---|---|
| V1 Interaction Detector | `src/classifier/interaction-detector.ts` | ~500 |
| V2 Evidence Engine | `src/classifier/evidence/` (entire dir) | ~2000 |
| AB Comparison | `src/classifier/evidence/ab-comparison.ts` | ~100 |
| Merge Layer | `src/classifier/evidence/merge-layer.ts` | ~200 |
| Pipeline Runner | `src/recorder/pipeline/pipeline-runner.ts` | ~200 |
| Domain Adapter | `src/recorder/pipeline/domain-adapter.ts` | ~300 |
| Recognition (orchestrator, recognizers) | `src/recorder/recognition/` | ~800 |
| Enrichment (orchestrator, derivers) | `src/recorder/enrichment/` | ~600 |
| Deterministic Recorder | `src/recorder/deterministic-recorder.ts` | ~400 |
| Recording Session | `src/recorder/recording-session.ts` | ~250 |
| Interaction Types (V1/V2) | `src/classifier/interaction-types.ts` | ~300 |
| **Total removed** | | **~5,650** |

### 3.4 CREATED (new)

| Component | Location | Description |
|---|---|---|
| Component Types | `src/shared/component-types.ts` | ObservedEvent, ComponentDefinition, ComponentContext, ComponentInteraction, etc. |
| Pattern Utilities | `src/definitions/patterns.ts` | isInteractiveElement, isDropdownTrigger, isCalendarCell, bestName, etc. |
| Event Tap | `src/tap/event-tap.ts` | Capture-phase DOM listener factory |
| Identity Extractor | `src/tap/identity-extractor.ts` | ElementIdentity extraction (reused logic from current codebase) |
| DOM Context Extractor | `src/definitions/dom-context-extractor.ts` | Extracts disabled, readOnly, ancestorRoles, etc. |
| Component Runtime | `src/runtime/component-runtime.ts` | Lifecycle management engine |
| Modal Tracker | `src/runtime/modal-tracker.ts` | Open dialog/menu tracking for scope decisions |
| Click Definition | `src/definitions/click.ts` | Universal fallback (priority 180) |
| TextEntry Definition | `src/definitions/text-entry.ts` | Text input lifecycle (priority 50) |
| Dropdown Definition | `src/definitions/dropdown.ts` | Combobox/select lifecycle (priority 20) |
| Checkbox Definition | `src/definitions/checkbox.ts` | Checkbox toggle (priority 30) |
| RadioButton Definition | `src/definitions/radio-button.ts` | Radio selection (priority 40) |
| DatePicker Definition | `src/definitions/date-picker.ts` | Date picker lifecycle (priority 10) |
| Link Definition | `src/definitions/link.ts` | Link click (priority 70) |
| Scroll Definition | `src/definitions/scroll.ts` | Scroll capture (priority 110) |
| Navigation Definition | `src/definitions/navigation.ts` | Synthetic navigation (priority 120) |
| Definitions Index | `src/definitions/index.ts` | ALL_DEFINITIONS array |
| Recorder Entry | `src/recorder/phase5/recorder-entry.ts` | Content script entry point |
| Presentation Types | `src/presentation/types.ts` | isProductionInteraction, typeLabel, categoryFor |
| Output Adapter | `src/presentation/output-adapter.ts` | ComponentInteraction → display format |
| **Total new** | | **~4,000 (est.)** |

---

## 4. OrangeHRM Learnings — Incorporated

All five bugs identified during OrangeHRM testing are explicitly designed into the architecture:

### 4.1 Login/Save Button Capture (Bug 1)
**Root cause:** 100ms debounce timer on `pushLiveInteractionsToStorage` was killed by MV3 before firing during form-submit navigation.
**Architecture fix:** `LIVE_INTERACTIONS` written **immediately** on each emit — no debounce, no timer. Section 2.5 above.
**Test:** Integration test simulating form-submit navigation with SW termination.

### 4.2 Dropdown No-Op Detection (Bug 2)
**Root cause:** `??` operator only falls through on null/undefined, but OXD combobox inputs have `accessibleName = ''` (empty string). `'' ?? valueBefore` yields `''`.
**Architecture fix:** Use `||` not `??` when comparing accessibleName against valueBefore. Section 2.3, Dropdown definition row.
**Test:** Unit test with empty-string accessibleName + non-empty valueBefore.

### 4.3 DatePicker Double-Trigger (Bug 3)
**Root cause:** After cell click completes lifecycle A, OXD fires focus on input → new lifecycle B → change event → second completion. Dedup compared start-times (too far apart).
**Architecture fix:** Dedup compares `lastEmitted.endTime` to `ctx.startTime` (end-to-start, not start-to-start). DEDUP_WINDOW_MS = 2000ms. DatePicker-specific metadata comparison (selectedDate). Section 2.2, Dedup.
**Test:** Unit test with cell click → focus → change sequence, verify single emission.

### 4.4 Pre-Selected Fields Captured (Bug 4)
**Root cause:** No no-op detection for radio buttons (already-checked re-selection) or text entries (focus without typing on pre-filled fields).
**Architecture fix:** RadioButton checks `checkedBefore` — if already checked, `noOpSelection=true`. TextEntry tracks `userTyped` flag — only true when `input` event fires. Presentation layer filters both. Section 2.3 + Section 2.4.
**Test:** Unit tests for radio no-op and text entry no-op.

### 4.5 Scroll Events with Zero Delta (Bug 5)
**Root cause:** Scroll events with `deltaTop=0 AND deltaLeft=0` passed the production filter.
**Architecture fix:** Presentation layer explicitly filters `Scroll` where `deltaTop=0 AND deltaLeft=0`. Section 2.4.
**Test:** Unit test for zero-delta scroll filtering.

### 4.6 Stale Data Between Sessions (Bug 6)
**Root cause:** Old events in sessionStorage buffer re-flushed on new recording session after MV3 SW restart cleared `seenEventIds`.
**Architecture fix:** Content script `STOP_RECORDING` handler calls `clearEventBuffer()`. Section 2.5, Session lifecycle.
**Test:** Integration test: record → stop → start new → verify no stale events.

### 4.7 DatePicker Navigation Button False Positives (Bug 7)
**Root cause:** Calendar navigation buttons (e.g., "Next Month" with class `oxd-calendar-switch-button`) matched `CALENDAR_SURFACE_CLASS_RE`, causing premature completion.
**Architecture fix:** DatePicker `handleEvent` treats navigation buttons as lifecycle-internal (return null, don't complete). Only actual calendar cells (role=option/gridcell with date-like classes) complete the lifecycle. Section 2.3, DatePicker row.
**Test:** Unit test with calendar navigation button click, verify no premature completion.

---

## 5. Updated Implementation Plan

### Milestone Sequence

| Milestone | Goal | Key Files | Commit Message |
|---|---|---|---|
| **0A** | Architecture validation (this document) | `.drytis/specs/m0a-architecture-validation.md` | "M0A: architecture validation and final design freeze" |
| **0** | Shared types & pattern utilities | `src/shared/component-types.ts`, `src/definitions/patterns.ts`, `src/definitions/dom-context-extractor.ts` | "M0: component runtime shared types and pattern utilities" |
| **1** | Event tap content script | `src/tap/event-tap.ts`, `src/tap/identity-extractor.ts`, `src/recorder/phase5/recorder-entry.ts` | "M1: event tap content script with identity extraction" |
| **2** | Component runtime engine | `src/runtime/component-runtime.ts`, `src/runtime/modal-tracker.ts` | "M2: component runtime engine with lifecycle management" |
| **3** | Core definitions (wave 1) | `src/definitions/click.ts`, `text-entry.ts`, `dropdown.ts`, `checkbox.ts`, `radio-button.ts`, `link.ts`, `index.ts` | "M3: core component definitions (click, text, dropdown, checkbox, radio, link)" |
| **4** | Complex definitions (wave 2) | `src/definitions/date-picker.ts`, `scroll.ts`, `navigation.ts`, update `index.ts` | "M4: complex component definitions (date-picker, scroll, navigation)" |
| **5** | Service worker integration | `src/background/service-worker.ts`, `src/shared/types.ts` (LIVE_INTERACTIONS, OBSERVED_EVENT) | "M5: service worker integration with component runtime" |
| **6** | Presentation layer & side panel | `src/presentation/types.ts`, `src/presentation/output-adapter.ts`, `src/sidepanel/sidepanel.ts`, `src/sidepanel/index.html`, `src/manifest.json` | "M6: presentation layer and side panel integration" |
| **7** | OrangeHRM stabilization fixes | Targeted fixes in definitions, runtime, presentation, content script | "M7: OrangeHRM stabilization fixes" |
| **8** | Build, download, end-to-end verification | dist/, download/, full test suite | "M8: production build and verification" |

### Commit & Push Schedule

- **Git commit** after every milestone (0A through 8) — no exceptions
- **Git push** after every 2 milestones (0A+0, then 1+2, then 3+4, then 5+6, then 7+8)
- Each commit includes all source files, test files, and updated `.drytis/` docs for that milestone

### Anti-Loss Safeguards

1. Every milestone ends with `git add` + `git commit` before any next work begins
2. Every 2 milestones: `git push` to origin
3. The `.drytis/specs/` spec files are committed alongside the code they describe
4. No working-tree-only changes — everything is committed
5. If the container restarts mid-milestone, `git status` shows the last committed milestone, and only the current milestone's uncommitted work is at risk

---

## 6. Summary

This document reconciles the Architecture C blueprint (7-layer, 16-rule classifier, feature-flagged coexistence) with the Component Runtime implementation (lifecycle-based definitions, fused coalescer+classifier, full replacement). The Component Runtime is the simpler, more maintainable evolution — it achieves every architectural goal (AP1, AP2, AP4, AP5, AP6, AP7) through a more natural abstraction (component lifecycles vs. temporal snapshot windows).

The generation pipeline (IR Bridge → ExecutionIRPlan → Playwright) is entirely preserved. The recording layer is replaced. All seven OrangeHRM bugs are explicitly designed against in the architecture.

This is the implementation authority. All subsequent milestones reference this document as their spec.
