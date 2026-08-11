# DF-1 Complete Technical Analysis — `c1fe56e` vs `deff878`

## Summary

DF-1 (commit c1fe56e) makes 3 changes across 5 source files (+644/-22):
1. Adds 9 new event types to EventTap (pointer, drag, touch families)
2. Expands observation windows from click+change-only to ALL 15 discrete event types
3. Adds 9 new fields to ElementStateSnapshot (6 ARIA + 3 computed-style)

15 files changed total: 5 source, 2 new test files, 8 existing test updates.

---

## 1. Problem DF-1 Solves

**Before (deff878):** Only `click` and `change` events open 3-second observation windows. This means 70%+ of classified interactions have ZERO behavioral evidence:

| Definition | Trigger Event | Opens Window? (deff878) | Has Evidence? |
|---|---|---|---|
| DatePicker(10) | focus, click | click only | Partial |
| Dropdown(20) | click, mousedown, focus | click only | Partial |
| Slider(25) | focus | NO | None |
| ColorInput(15) | focus | NO | None |
| Checkbox(30) | click | YES | Yes |
| FileUpload(35) | click, change | YES | Yes |
| RadioButton(40) | click, change | YES | Yes |
| TextEntry(50) | focus | NO | None |
| Hover(60) | mouseenter | NO | None |
| Tab(65) | click | YES | Yes |
| Link(70) | click | YES | Yes |
| Scroll(110) | scroll | NO (transient) | None |
| Navigation(120) | navigation | NO | None |
| Click(180) | click, contextmenu | click only | Partial |

**After (DF-1):** ALL 15 discrete event types open observation windows. Slider, ColorInput, TextEntry, Hover, and Click (on contextmenu) now all get behavioral evidence.

---

## 2. New Rules/Logic Introduced

### Rule A: `OBSERVATION_ELIGIBLE_EVENT_TYPES` (NEW)
A new `Set<string>` in recorder-entry.ts that controls which events open observation windows.

**Before:** Inline condition `eventType === 'click' || eventType === 'change'`
**After:** Set membership check `OBSERVATION_ELIGIBLE_EVENT_TYPES.has(eventType)`

The set contains 15 event types:
`click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, keydown, pointerdown, pointerup, dragstart, dragend, drop, touchstart, touchend`

### Rule B: Expanded `TRANSIENT_EVENT_TYPES`
**Before:** `['mousemove', 'scroll']` (2 types)
**After:** `['mousemove', 'scroll', 'pointermove', 'touchmove']` (4 types)

### Rule C: Throttling for new move events
- `POINTERMOVE_MIN_INTERVAL_MS = 50` (same as mousemove)
- `TOUCHMOVE_MIN_INTERVAL_MS = 50`

---

## 3. Event Types That Become Observation-Eligible

| Event Type | Window Before? | Window After? | Delta |
|---|---|---|---|
| click | ✅ | ✅ | — |
| change | ✅ | ✅ | — |
| mousedown | ❌ | ✅ | **NEW** |
| contextmenu | ❌ | ✅ | **NEW** |
| focus | ❌ | ✅ | **NEW** |
| blur | ❌ | ✅ | **NEW** |
| input | ❌ | ✅ | **NEW** |
| mouseenter | ❌ | ✅ | **NEW** |
| mouseleave | ❌ | ✅ | **NEW** |
| keydown | ❌ | ✅ | **NEW** |
| pointerdown | N/A (event didn't exist) | ✅ | **NEW** |
| pointerup | N/A | ✅ | **NEW** |
| dragstart | N/A | ✅ | **NEW** |
| dragend | N/A | ✅ | **NEW** |
| drop | N/A | ✅ | **NEW** |
| touchstart | N/A | ✅ | **NEW** |
| touchend | N/A | ✅ | **NEW** |

Events that NEVER open windows (both before and after):
- mousemove, scroll, pointermove, touchmove (transient — fire-and-forget)
- navigation (synthetic — no target element)

**Net: 13 event types newly gain observation windows** (8 existing + 5 new discrete).

---

## 4. Observation Window Changes

### Window mechanics (UNCHANGED):
- Duration: 3000ms (unchanged)
- Timer: independent per-window (unchanged)
- End reasons: 'completed', 'element-removed', 'recording-stopped' (unchanged)
- Before-state: `cache.peek(targetEl)` (unchanged)
- After-state: `cache.read(targetEl)` (unchanged)

### What changes:
- **Volume:** Far more windows open simultaneously. A single text-entry interaction (focus → multiple input events → keydown events) could open 10+ windows where before it opened 0.
- **Overlapping windows:** Each event opens its own window. `focus` + `input` + `keydown` in quick succession = 3 windows for one user action, each with its own 3s timer and MutationObserver subscription.

---

## 5. Impact Per Component Type

| Definition | Trigger(s) | Before Evidence | After Evidence | Impact |
|---|---|---|---|---|
| DatePicker(10) | focus, click | Click only | Focus + click | **Improves** — now sees focus→state-change |
| Dropdown(20) | click, mousedown, focus | Click only | All 3 | **Improves** — mousedown before-state is most accurate |
| Slider(25) | focus | None | Focus | **Fixes** — now has evidence |
| ColorInput(15) | focus | None | Focus | **Fixes** — now has evidence |
| Checkbox(30) | click | Yes | Yes (same) | No change |
| FileUpload(35) | click, change | Yes | Yes (same) | No change |
| RadioButton(40) | click, change | Yes | Yes (same) | No change |
| TextEntry(50) | focus | None | Focus + input + keydown | **Fixes** — now has evidence (but may be noisy) |
| Hover(60) | mouseenter | None | mouseenter + mouseleave | **Fixes** — now has evidence |
| Tab(65) | click | Yes | Yes (same) | No change |
| Link(70) | click | Yes | Yes (same) | No change |
| Click(180) | click, contextmenu | Click only | Click + contextmenu | **Improves** |
| Scroll(110) | scroll | None | None (transient) | No change |
| Navigation(120) | navigation | None | None (excluded) | No change |

---

## 6. New Data Captured

### New ElementStateSnapshot fields (9 total):

**ARIA state attributes (6):**
- `ariaSelected: boolean | null` — tab/listbox/tree selection state
- `ariaHidden: boolean | null` — SPA show/hide tracking
- `ariaCurrent: string | null` — breadcrumb/step/wizard position ('page','step','location','date','time','true','false')
- `ariaControls: string | null` — ID of controlled element
- `ariaOwns: string | null` — ID of owned element
- `ariaDescribedBy: string | null` — description element ID

**Computed style proxy (3):**
- `computedDisplay: string | null` — 'block', 'none', 'flex', etc.
- `computedVisibility: string | null` — 'visible', 'hidden', 'collapse'
- `computedOpacity: number | null` — 0.0 to 1.0

### CRITICAL FINDING: New fields are captured but NOT consumed by any effect rule

The 7 existing effect rules in effect-rules.ts only read:
- `checked` (checkStateToggle)
- `ariaChecked` (checkStateToggle)
- `ariaPressed` (checkStateToggle)
- `ariaExpanded` (checkExpandCollapse)
- `disabled` (checkEnableDisable)
- `childCount` (checkContentChange)
- `textContent` (checkContentChange)
- `endReason` (checkVisibilityChange)

**None of the 9 new fields are read by any rule.** They are captured, stored in snapshots, and flow through the pipeline — but the Effect Interpreter ignores them entirely. They appear to be foundational data for FUTURE DF phases (DF-2+).

### New event types captured (9):

| Event Family | Types | Throttled? | Transient? | Observation Window? |
|---|---|---|---|---|
| Pointer | pointerdown, pointerup | No | No (durable) | ✅ Yes |
| Pointer | pointermove | Yes (50ms) | Yes (fire-and-forget) | ❌ No |
| HTML5 Drag | dragstart, dragend, drop | No | No (durable) | ✅ Yes |
| Touch | touchstart, touchend | No | No (durable) | ✅ Yes |
| Touch | touchmove | Yes (50ms) | Yes (fire-and-forget) | ❌ No |

---

## 7. Data Flow Trace

### EventTap → CS → SW → Runtime → Projection → IR

```
1. EventTap registers 21 DOM listeners (12 existing + 9 new)
     ↓
2. Raw event fires → handleRawEvent()
     ├─ Rate-limit check (pointermove/touchmove: 50ms)
     ├─ resolveTarget() → composedPath() (Shadow DOM piercing)
     ├─ Build ObservedEvent with ElementIdentity + DomContext
     └─ onEvent(data) → sendObservedEvent()
          ├─ Transient? → fire-and-forget (pointermove, touchmove added)
          └─ Durable? → buffer + retry (pointerdown, etc. added)
               ↓
3. chrome.runtime.sendMessage({type:'OBSERVED_EVENT'})
     ↓
4. Service Worker receives event
     ├─ DISCRETE_ACTION_TYPES check → ledger entry?
     │   Only click, contextmenu, mousedown, keydown enter ledger.
     │   **NEW EVENTS DO NOT ENTER THE LEDGER** (not in DISCRETE_ACTION_TYPES)
     └─ ComponentRuntime.processEvent()
          ├─ Checks each definition's triggerEventTypes
          │   **NO DEFINITION has pointer/drag/touch in triggerEventTypes**
          │   → new events are processed but match no definition
          └─ Event absorbed or released

5. EventTap also fires onAfterEvent(targetEl, eventId, eventType)
     ├─ OLD: only if eventType === 'click' || 'change'
     └─ NEW: if OBSERVATION_ELIGIBLE_EVENT_TYPES.has(eventType) → 15 types
          ↓
6. ObservationCoordinator.openWindow(eventId, eventType, targetEl)
     ├─ cache.peek(targetEl) → beforeSnapshot (NOW with 9 new fields)
     ├─ cache.capture(targetEl) → updates cache (NOW calls readComputedStyles)
     ├─ docObserver.start(windowId) → MutationObserver subscription
     └─ setTimeout(3000) → closeWindow()
          ↓
7. On window close:
     ├─ cache.read(targetEl) → finalSnapshot (NOW with 9 new fields + getComputedStyle)
     ├─ docObserver.collectMutations(windowId)
     ├─ Build ObservationResult
     └─ onResult(ObservationResult) → sendBehavioralResult()
          ↓
8. SW receives behavioral observation
     ├─ interpretBehavioralObservations() → effect-interpreter.interpret()
     │   ├─ checkStateToggle → reads checked, ariaChecked, ariaPressed ONLY
     │   ├─ checkExpandCollapse → reads ariaExpanded ONLY
     │   ├─ checkEnableDisable → reads disabled ONLY
     │   ├─ checkContentChange → reads childCount, textContent ONLY
     │   ├─ checkVisibilityChange → reads endReason ONLY
     │   └─ **NEW FIELDS NOT READ BY ANY RULE**
     ├→ attachBehavioralEvidence() → maps effects to interactions
     └→ Project + IR generation (unchanged)
```

---

## 8. Files & Functions Changed

| File | Change | Functions Affected |
|---|---|---|
| `src/shared/component-types.ts` | +9 BrowserEventType members | Type union only |
| `src/shared/observation-types.ts` | +9 fields on ElementStateSnapshot | Interface only |
| `src/tap/element-state-cache.ts` | +readComputedStyles(), +9 fields in readState() | `readState()` (modified), `readComputedStyles()` (NEW) |
| `src/tap/event-tap.ts` | +9 listeners, +2 throttle vars | eventTypes array, handleRawEvent() |
| `src/recorder/phase5/recorder-entry.ts` | +OBSERVATION_ELIGIBLE_EVENT_TYPES, expanded TRANSIENT set | `onAfterEvent` callback, TRANSIENT_EVENT_TYPES |

**Files NOT changed (critical):**
- `src/runtime/evidence-ledger.ts` — DISCRETE_ACTION_TYPES unchanged (still 4 types)
- `src/runtime/component-runtime.ts` — no changes
- `src/semantics/effect-rules.ts` — no changes (new fields NOT consumed)
- `src/semantics/effect-interpreter.ts` — no changes
- `src/tap/observation-coordinator.ts` — no changes (window mechanics unchanged)
- `src/tap/document-observer.ts` — no changes
- `src/definitions/*.ts` — no changes (no definition gains new trigger events)
- `src/ir/*` — no changes
- `src/sidepanel/*` — no changes
- `manifest.json` — no changes

---

## 9. Existing Behavior That Changes

### Behavior change 1: Observation windows open for 13 more event types
**Before:** `focus` event on a text input → no window → TextEntry interaction has no behavioral evidence.
**After:** `focus` event → window opens → 3s later, ObservationResult delivered → effect interpreter runs → may produce content-change or no-observable-effect.

### Behavior change 2: Multiple overlapping windows per user action
**Before:** One click = one window.
**After:** focus + input + keydown in rapid succession = 3 windows, each with its own 3s timer and mutation subscription. For text entry, every `input` event (fires on every keystroke) opens a new window.

### Behavior change 3: getComputedStyle called on every snapshot
**Before:** `readState()` reads 9 properties via direct DOM access (O(1), no reflow).
**After:** `readState()` calls `window.getComputedStyle(el)` which triggers a style recalculation/reflow. Called on every `capture()` AND every `read()` — i.e., every observation window open AND close.

### Behavior change 4: New events flow through IPC
**Before:** 12 event types sent via chrome.runtime.sendMessage.
**After:** 21 event types sent. pointerdown/up, dragstart/end, drop, touchstart/end are durable (buffered + retried). pointermove/touchmove are transient (fire-and-forget).

---

## 10. Existing Behavior Guaranteed Unchanged

1. **Window duration:** Still 3000ms. No change.
2. **Window lifecycle:** open/peek/capture/read/close mechanics identical.
3. **MutationObserver:** Same document.body subtree observation, same refcounting.
4. **EvidenceLedger:** DISCRETE_ACTION_TYPES still `['click', 'contextmenu', 'mousedown', 'keydown']`. New events do NOT enter the ledger.
5. **ComponentRuntime classification:** No definition's triggerEventTypes changed. New events match no definition — they're processed and released.
6. **Effect Interpreter:** All 7 rules unchanged. Same inputs checked, same outputs produced.
7. **Projection Engine:** Pure function, unchanged. Still maps completedInteractions + unclaimed/pending ledger entries.
8. **Capability Engine:** 12 rules, all unchanged.
9. **IR Bridge:** Unchanged. Same 15 InteractionType → IRAction mappings.
10. **Playwright generation:** Unchanged.
11. **Side panel:** Unchanged. Still receives INTERACTION_CAPTURED broadcasts.
12. **Persistence:** Same chrome.storage.local + sessionStorage + IndexedDB structure.
13. **Manifest:** Same permissions, same version (10.9.0).
14. **click and change observation windows:** Still open, same mechanics.

---

## 11. Memory Impact

### Per-snapshot memory increase:
- Before: 10 fields × ~avg 20 bytes = ~200 bytes/snapshot
- After: 19 fields × ~avg 20 bytes = ~380 bytes/snapshot
- **+90% per snapshot** (but absolute: ~180 bytes more)

### Window count increase (the real impact):
- Before: ~1 window per click/change (low frequency)
- After: potentially 3-5 windows per user interaction (focus + input + keydown for typing; mousedown + click for clicking)
- Each window holds: ObservationWindow object + beforeSnapshot + finalSnapshot + mutations[] + timer reference + WeakRef

### Est. memory per active window: ~2-5 KB (snapshots + mutation records)
- Before: ~1-3 concurrent windows typical
- After: ~5-15 concurrent windows typical during active interaction
- **~5x increase in peak observation memory**

### getComputedStyle cost:
- Forces a style recalculation. In SPAs with large DOMs, this can be 1-10ms per call.
- Called 2× per window (capture on open, read on close).
- At 15 concurrent windows with rapid event firing: **significant reflow pressure**.

---

## 12. Storage/IPC Impact

### IPC message volume:
- New durable events (pointerdown/up, drag*, touchstart/end): each goes through buffer + retry. 7 new durable types.
- pointermove/touchmove: transient (fire-and-forget, no buffer).
- **Estimated 2-3× increase in chrome.runtime.sendMessage calls** during active interaction.

### sessionStorage buffer pressure:
- Durable events buffered in `cmdrunner_event_buffer` (MAX 500).
- New durable events fill the buffer faster. Under SW outage, buffer hits 500 cap sooner.
- **Risk: legitimate click/change events evicted by flood of pointerdown/dragstart events.**

### chrome.storage.local writes:
- Observation results stored as `cmdrunner_obs_{eventId}` keys.
- More windows = more obs keys.
- **No cap on obs_* keys** — unbounded growth during long recordings.

### EvidenceLedger storage:
- **Unchanged.** New events don't enter the ledger (not DISCRETE_ACTION_TYPES).

---

## 13. Performance Impact

| Operation | Before | After | Impact |
|---|---|---|---|
| EventTap listener count | 12 | 21 | +75% listeners (minor) |
| Events per interaction | ~2-3 | ~5-8 | ~2.5× more events |
| Observation windows/interaction | ~1 | ~3-5 | ~3-5× more windows |
| getComputedStyle calls | 0 | 2 per window | **New reflow source** |
| sendMessage calls | moderate | ~2.5× | Higher IPC pressure |
| MutationObserver subscriptions | 1 per window | 3-5 per interaction | More refcounted starts/stops |
| Timer count | low | ~3-5× higher | More setTimeout/setTimeout |
| Snapshot object size | ~200 bytes | ~380 bytes | +90% per snapshot |

**Hot path concern:** `readComputedStyles()` calls `window.getComputedStyle(el)` synchronously in the event handler's follow-up (onAfterEvent → openWindow → capture → readState). For rapid events (focus → input → keydown in <100ms), this means 3+ forced reflows in quick succession.

---

## 14. Duplicate/Overlapping Observation Windows

### Scenario: User clicks a dropdown
1. `mousedown` fires → window opens (NEW)
2. `focus` fires → window opens (NEW)
3. `click` fires → window opens (existing)
4. `change` fires (if selection changes) → window opens (existing)

**Result: 4 overlapping windows for ONE user action.** Each captures the same before/after state and the same mutations. The effect interpreter will produce 4 sets of effects (e.g., 4× "state-toggle" or "expand-collapse"). The capability engine then receives 4 ObservationResults for what is semantically one interaction.

### Scenario: User types in a text field
1. `focus` → window opens (NEW)
2. `input` (per keystroke) → window opens per keystroke (NEW)
3. `keydown` (per keystroke) → window opens per keystroke (NEW)

**Result: 2 windows PER KEYSTROKE.** Typing "hello" = 1 focus window + 5 input windows + 5 keydown windows = 11 windows. Each runs for 3 seconds.

### Mitigation in baseline:
- ObservationCoordinator uses refcounted MutationObserver — multiple windows share one observer. No duplicate mutation subscriptions.
- BUT: each window independently captures before/after snapshots and delivers its own ObservationResult.
- The effect interpreter is pure — it doesn't deduplicate across windows.
- **No deduplication mechanism exists for overlapping windows from the same user action.**

---

## 15. Potential Regressions

### R1: Performance regression from getComputedStyle (HIGH RISK)
`readComputedStyles()` forces a synchronous style reflow. Called on every `capture()` and `read()`. In SPAs with large DOMs (1000+ elements), this can cause jank during recording. The comment in the code acknowledges this: "Triggers a style reflow, so only call when capturing a snapshot — never in hot paths." But `capture()` IS called in the hot path (onAfterEvent → openWindow → capture).

### R2: Buffer eviction from new durable events (MEDIUM RISK)
New durable events (pointerdown, pointerup, dragstart, dragend, drop, touchstart, touchend) enter the durable buffer. Under SW outage, they compete with click/change events for the 500-slot buffer. A drag operation (dragstart + multiple pointermove (transient, not buffered) + dragend + drop) adds 4 buffered events.

### R3: Duplicate evidence on overlapping windows (MEDIUM RISK)
Multiple windows for one user action produce duplicate effects. The capability engine may see conflicting or redundant evidence. No deduplication exists.

### R4: TextEntry window explosion (MEDIUM RISK)
Every `input` event opens a 3-second window. Typing 50 characters = 50 input windows + 50 keydown windows = 100 concurrent windows (many overlapping). Each has a timer, a snapshot pair, and mutation records.

### R5: jsdom vs real browser divergence (LOW RISK)
New tests dispatch generic `Event` objects for pointer/drag/touch (jsdom lacks constructors). Real browsers fire `PointerEvent`, `DragEvent`, `TouchEvent` with different properties. The EventTap reads `rawEvent.type` (string match), so it works — but `isTrusted` filtering may behave differently.

### R6: No definition matches new event types (BY DESIGN, NOT A BUG)
pointerdown/up, dragstart/end, drop, touchstart/end are captured and sent to the SW, but NO ComponentDefinition lists them in `triggerEventTypes`. They're processed by the runtime as unmatched events and released. This is correct — the events provide observation evidence but don't trigger new interaction types. Classification still happens via click/focus/mousedown/etc.

---

## 16. Required Tests

### Already present in DF-1 (2 new test files):
- `tests/tap/df1-event-tap-new-types.test.ts` (186 lines): verifies capture of 9 new types, throttling of pointermove/touchmove, onAfterEvent for discrete events.
- `tests/tap/df1-observation-expansion.test.ts` (187 lines): verifies 9 new snapshot fields, null defaults, before/after delta detection.

### Already present (8 modified test files):
- Fixtures updated with 9 new null fields (semantics/fixtures.ts, sw-bridge.test.ts, behavioral-renderer.test.ts, g6 test, phase6/phase7 tests, subphase4 test).

### NOT tested (gaps):
1. **Overlapping window behavior** — no test verifies that 3 windows from focus+input+keydown don't produce conflicting effects.
2. **getComputedStyle on detached elements** — one test checks it doesn't throw, but doesn't verify the null return path.
3. **Buffer eviction under new durable events** — no test verifies that pointerdown/dragstart don't evict click events from the 500-slot buffer.
4. **Memory bounds** — no test verifies window count stays bounded during rapid typing.
5. **Real PointerEvent/DragEvent/TouchEvent** — tests use generic Event (jsdom limitation). No integration test with real browser events.
6. **Effect interpreter with new fields** — no test verifies that ariaSelected/computedDisplay deltas produce (or don't produce) effects. Currently they DON'T because no rule reads them.
7. **Component Runtime processing of new events** — no test verifies that pointerdown events are correctly absorbed/released without matching a definition.
