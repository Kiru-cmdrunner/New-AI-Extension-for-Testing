# Root-Cause Analysis: Evidence Permanently Stuck at "⏳ Collecting behavioral evidence…"

**Date:** 2026-08-11
**Baseline:** bd5037f (M7 report), ac20b93 (M7 source)
**Symptom:** Every interaction card in the side panel permanently shows the placeholder `⏳ Collecting behavioral evidence…` for all interaction types (click, text entry, navigation, etc.) on all tested applications (Amazon, OrangeHRM).

---

## Executive Summary

The evidence capture pipeline (M1–M6) works **correctly end-to-end**. Evidence windows open, close after 300ms quiescence, and produce complete BehavioralEvidence objects. The `deliverEvidence()` call fires `chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EVIDENCE', ... })` to the service worker. The SW receives it and broadcasts `INTERACTION_EVIDENCE_UPDATE`.

**The evidence never reaches the interaction card because of an ID mismatch.**

The evidence's `sourceEventId` uses the EventTap ID format (`evt-p{timestamp}-{counter}`), but the interaction card's ID badge displays the ComponentInteraction ID format (`int-{counter}`). The side panel's matching function compares these two values as strings — they never match.

This is **one root cause with one downstream amplifier**:

| # | Bug | Severity | Layer |
|---|-----|----------|-------|
| **RC-1** | **ID mismatch: `sourceEventId` (evt-…) vs `interactionId` (int-…) — match always fails** | **CRITICAL** | M7 side panel matching |
| **RC-2** | `behavioralEvidence` is never attached to the `ComponentInteraction` in the service worker — the SW's `pendingEvidence` map stores evidence but never injects it into the interaction object before storage/broadcast | **CRITICAL** | M4 SW integration |
| **RC-3** | `__deferredEvidence` Map is read but never initialized — fallback path for unmatched evidence is dead code | **HIGH** | M7 side panel |

---

## End-to-End Trace: "Click Login" on OrangeHRM

### Stage 1: EventTap — ✅ EXECUTES

**What happens:** User clicks the Login button. The browser fires a `click` event. EventTap's capture-phase listener fires.

**What data is produced:**
```typescript
// EventTap.handleRawEvent()
const observed: ObservedEvent = {
  eventId: 'evt-p1a2b3c4d5e-1',  // ← EventTap ID space
  eventType: 'click',
  timestamp: Date.now(),
  captureSeq: 1,
  isTrusted: true,
  target: { /* ElementIdentity from IdentityExtractor */ },
};
```

**eventId format:** `evt-{pageId}-{counter}` where pageId = `p{Date.now().toString(36)}`

Example: `evt-p1a2b3c4d5e-1`

**What happens next:**
1. `config.onEvent(observed)` fires → ObservedEvent sent to service worker via `chrome.runtime.sendMessage({ type: 'OBSERVED_EVENT', payload: observed })`
2. `config.onAfterEvent(targetEl, observed.eventId, 'click', cssSelector)` fires synchronously → calls `evidenceCollector.onAfterEvent(targetEl, 'evt-p1a2b3c4d5e-1', 'click', '')`

**Did it execute?** YES — verified by code at `event-tap.ts` line 327-332.

---

### Stage 2: EvidenceCollector.onAfterEvent — ✅ EXECUTES

**What happens:** `onAfterEvent` receives `(targetEl, 'evt-p1a2b3c4d5e-1', 'click', '')`.

- `eventType` is `'click'` → passes capture-only check
- Not navigation, not typing, not throttled
- `'click'` is in `WINDOW_OPEN_EVENTS` → calls `this.openWindow(targetEl, 'evt-p1a2b3c4d5e-1', 'click')`

**Did it execute?** YES — verified by code at `evidence-collector.ts` lines 187-225.

---

### Stage 3: openWindow — ✅ EXECUTES

**What happens:** Opens an observation window:

```typescript
const windowId = `ev-evt-p1a2b3c4d5e-1`;
const openedAt = performance.now(); // e.g. 12345.67
const beforeSnapshot = this.targetStateCache.peek(targetEl) ?? null;
```

- Starts DOMObserver (if first window)
- Creates AdaptiveWindow with `onClose` callback
- Arms the AdaptiveWindow (starts 300ms stabilization timer)
- Registers DOMObserver batch callback

**State stored:**
```typescript
{
  windowId: 'ev-evt-p1a2b3c4d5e-1',
  sourceEventId: 'evt-p1a2b3c4d5e-1',  // ← EventTap ID
  sourceEventType: 'click',
  identity: null,                       // ← ALWAYS null (never set)
  beforeSnapshot: TargetStateSnapshot | null,
  openedAt: 12345.67,
  adaptiveWindow: AdaptiveWindow,
  isClosed: false,
}
```

**Did it execute?** YES — verified by code at `evidence-collector.ts` lines 233-281.

---

### Stage 4: TargetStateCache — ✅ EXECUTES (correctly)

**What happened before:** The capture-phase `mousedown` listener (installed in M2) fired BEFORE the click handler. It called `targetStateCache.capture(loginButton)` which stored a TargetStateSnapshot of the button's pre-click state.

**What `peek` returns:** The pre-click snapshot. If the user focused the field first, this has the before-state. If not, `peek` returns `undefined` and `beforeSnapshot` is `null`.

**Did it execute?** YES — TargetStateCache is a WeakMap, the capture-phase listeners fire on mousedown/focus.

---

### Stage 5: DOMObserver — ✅ EXECUTES

**What happens:** DOMObserver is started on `document.body`. It observes all mutations. During the 300ms window, any DOM changes are batched and summarized.

**On OrangeHRM (low-churn):** Likely zero or minimal DOM mutations (login button click may change button state but not cause large DOM changes). This is fine — the evidence window still closes after the 300ms quiescence period regardless of mutation count.

**Did it execute?** YES — `domObserver.start()` at `evidence-collector.ts` line 239.

---

### Stage 6: AdaptiveWindow.close — ✅ EXECUTES (after 300ms quiescence)

**What happens:** AdaptiveWindow was armed with `minQuiescence=300ms`. No mutations arrive within 300ms → `checkStabilized()` fires, elapsed time >= `minDuration` (50ms) → calls `close('stabilized')`.

**close() does:**
1. Clears timers
2. Builds EvidenceWindow: `{ openedAt, closedAt, durationMs: ~300, endReason: 'stabilized', stabilityTrace }`
3. Calls `onClose(evidenceWindow)` → `this.closeWindow('ev-evt-p1a2b3c4d5e-1', evidenceWindow)`

**Is closeWindow actually being called?** **YES.** The AdaptiveWindow mechanism is correct. The 300ms timer fires regardless of DOM churn. Even on OrangeHRM with zero mutations, the stabilization timer fires after 300ms.

**Did it execute?** YES — verified by `adaptive-window.ts` lines 80-130.

---

### Stage 7: closeWindow — ✅ EXECUTES

**What happens:** Builds the complete BehavioralEvidence:

```typescript
const evidence: BehavioralEvidence = {
  sourceEventId: 'evt-p1a2b3c4d5e-1',   // ← EventTap ID
  sourceEventType: 'click',
  windowId: 'ev-evt-p1a2b3c4d5e-1',
  frameId: 'main',
  window: { openedAt, closedAt, durationMs: 300, endReason: 'stabilized', stabilityTrace: [...] },
  targetEvidence: {
    identity: null,                        // ← Always null (RC-adjacent)
    identityCapturedAt: 12345.67,
    before: TargetStateSnapshot | null,
    after: TargetStateSnapshot,            // Captured at close
    focusMovement: FocusMovement | null,
  },
  applicationEvidence: {
    domChanges: [...],                     // May be empty (OrangeHRM)
    domChangeOverflow: 0,
    coarseMode: false,
    newSurfaces: [...],
    removedSurfaces: [],
    visibilityChanges: [...],
    navigation: [...],
    networkActivity: [...],                // From NetworkBridge
    performanceCondition: { ... },
  },
};
```

Then calls `this.deliverEvidence(evidence)`.

**Did it execute?** YES — verified by `evidence-collector.ts` lines 286-362.

---

### Stage 8: deliverEvidence — ✅ EXECUTES

**What happens:**

```typescript
// 1. Buffer in sessionStorage (SW restart recovery)
this.bufferEvidence(evidence);

// 2. Send to service worker
chrome.runtime.sendMessage({
  type: 'BEHAVIORAL_EVIDENCE',
  payload: evidence,  // evidence.sourceEventId = 'evt-p1a2b3c4d5e-1'
});
```

**Did it execute?** YES — `chrome.runtime.sendMessage` is called. The message includes the evidence with `sourceEventId = 'evt-p1a2b3c4d5e-1'`.

---

### Stage 9: Service Worker onMessage — ✅ EXECUTES

**What happens:** SW receives `BEHAVIORAL_EVIDENCE` message:

```typescript
case 'BEHAVIORAL_EVIDENCE':
  handleBehavioralEvidence(msg.payload);
  sendResponse({ ok: true });
  return true;
```

**handleBehavioralEvidence does:**
```typescript
// LRU eviction if at cap
pendingEvidence.set('evt-p1a2b3c4d5e-1', evidence);

// Broadcast to side panel
chrome.runtime.sendMessage({
  type: 'INTERACTION_EVIDENCE_UPDATE',
  payload: {
    eventId: 'evt-p1a2b3c4d5e-1',   // ← EventTap ID used as eventId
    evidence: evidence,
  },
});
```

**Did it execute?** YES — verified by `service-worker.ts` lines 410-431.

---

### Stage 10: Side Panel onMessage — ✅ EXECUTES

**What happens:** Side panel receives `INTERACTION_EVIDENCE_UPDATE`:

```typescript
if (msg.type === 'INTERACTION_EVIDENCE_UPDATE') {
  handleEvidenceUpdate(evMsg.payload.eventId, evMsg.payload.evidence);
  // eventId = 'evt-p1a2b3c4d5e-1'
}
```

**Did it execute?** YES — verified by `sidepanel.ts` lines 302-307.

---

### Stage 11: handleEvidenceUpdate — ❌ FAILS (ID mismatch)

**What happens:**

```typescript
function handleEvidenceUpdate(eventId: string, evidence: BehavioralEvidence): void {
  // eventId = 'evt-p1a2b3c4d5e-1'

  const containers = [timelineEvents, detectedInteractionsList];
  for (const container of containers) {
    if (!container || container.hidden) continue;

    const cards = container.querySelectorAll('.interaction-event');
    for (const card of cards) {
      const idBadge = card.querySelector('.timeline-event__id');
      // idBadge.textContent = 'int-1'  ← ComponentInteraction ID!!!
      if (idBadge && idBadge.textContent === eventId) {
        // 'int-1' === 'evt-p1a2b3c4d5e-1' → FALSE
        updateEvidenceOnInteraction(card, evidence);
        return;
      }
    }
  }

  // Falls through to deferred path...
  const deferred = (window as ...).__deferredEvidence;
  if (deferred) {
    deferred.set(eventId, evidence);
    // But __deferredEvidence is never initialized (RC-3)!
  }
}
```

**THE MATCH ALWAYS FAILS.**

The card's ID badge text is `interaction.interactionId` which is `int-1`, `int-2`, etc.
The evidence's `eventId` is `sourceEventId` which is `evt-p1a2b3c4d5e-1`, `evt-p1a2b3c4d5e-2`, etc.

**`'int-1' === 'evt-p1a2b3c4d5e-1'` → FALSE**

Every single comparison fails. The evidence is never rendered.

**Fallback (deferred) also fails:** The `__deferredEvidence` Map is read from `window.__deferredEvidence` but is never initialized anywhere in the codebase. It's always `undefined`, so the `if (deferred)` check is false, and the evidence is silently dropped.

---

## The Two ID Spaces

```
EventTap eventId space:
  evt-{pageId}-{counter}
  e.g. evt-p1a2b3c4d5e-1, evt-p1a2b3c4d5e-2, evt-p1a2b3c4d5e-3

ComponentInteraction interactionId space:
  int-{counter}
  e.g. int-1, int-2, int-3

These are generated by completely separate counters in separate modules.
There is NO mapping between them in the codebase.
```

The EventTap assigns `eventId` to each raw DOM event. The ComponentRuntime assigns `interactionId` to each emitted ComponentInteraction. The EvidenceCollector receives the `eventId` from EventTap and stores it as `sourceEventId`. The interaction card displays `interactionId`.

**There is no code anywhere that maps eventId → interactionId or vice versa.**

The relationship exists implicitly: an ObservedEvent has both an `eventId` and becomes the `triggerEvent` of a ComponentInteraction. So `interaction.triggerEvent.eventId` gives the eventId for a given interaction. But the side panel matching logic does not use this relationship — it compares `sourceEventId` directly to `interactionId`.

---

## Why M4 Browser Tests Pass While the Installed M7 Extension Fails

### M4 Evidence-Collector Tests (`tests/tap/evidence-collector.test.ts`)

These tests verify that the EvidenceCollector **produces and delivers** BehavioralEvidence. They:
1. Call `collector.onAfterEvent(el, 'evt-test-1', 'click', '')` with a hardcoded eventId
2. Advance fake timers past 300ms
3. Assert `deliveredEvidence[0].sourceEventId === 'evt-test-1'`

**They only test Stages 2-8 (capture through delivery).** They never test the side panel matching logic. They mock `chrome.runtime.sendMessage` and check the message was sent, but they never verify that a side panel can match the evidence to an interaction card.

### M4 Browser Validation Tests (puppeteer-based, `m4-browser-validation.cjs`)

These tests ran inside the extension's content script environment. They:
1. Inject interactions on test pages
2. Verify that EvidenceCollector opens/closes windows
3. Verify that `BEHAVIORAL_EVIDENCE` messages are sent

**They also never test the side panel.** They test the content-script-side pipeline only.

### M7 Evidence-Renderer Tests (`tests/sidepanel/evidence-renderer.test.ts`)

These tests verify the rendering functions work correctly. The `updateEvidenceOnInteraction` tests:
1. Create a `<div class="interaction-event">` with `<div class="timeline-event__id">evt-1</div>`
2. Call `updateEvidenceOnInteraction(interactionEl, evidence)` directly

**They test the rendering function in isolation.** They never test the matching logic in `handleEvidenceUpdate`. They hardcode the ID badge as `evt-1` (matching the EventTap format), but **in production the badge text is `int-1`** (the ComponentInteraction format).

**The test creates a card with `evt-1` as the ID badge. Production creates a card with `int-1`. No test ever exercises the actual matching path with realistic ID values.**

### Gap Summary

```
What tests cover:                    What production needs:
──────────────────────               ──────────────────────
Stage 2-8 (capture → delivery)       Stage 2-8 (capture → delivery)  ✅
Evidence-renderer rendering          Evidence-renderer rendering      ✅
updateEvidenceOnInteraction()        updateEvidenceOnInteraction()    ✅
                                     handleEvidenceUpdate() matching  ❌ NEVER TESTED
                                     eventId ↔ interactionId mapping  ❌ NEVER TESTED
                                     behavioralEvidence attachment    ❌ NEVER TESTED
                                     __deferredEvidence init          ❌ NEVER TESTED
```

---

## Root Cause #2: behavioralEvidence Never Attached

Even if the ID matching were fixed, there is a second problem. The `ComponentInteraction` type has an optional `behavioralEvidence?` field. The `attachEvidenceDisplay` function checks:

```typescript
function attachEvidenceDisplay(el, interaction) {
  if (interaction.behavioralEvidence) {
    // Render evidence immediately
  } else {
    // Show placeholder
  }
}
```

But `behavioralEvidence` is **never set on any ComponentInteraction anywhere in the codebase.** The SW's `pendingEvidence` map stores evidence but never injects it into the interaction objects stored in `chrome.storage.local[LIVE_INTERACTIONS]`.

So even if `handleEvidenceUpdate` successfully finds the right card and calls `updateEvidenceOnInteraction`, the next time the interactions list is re-rendered (which happens on every `LIVE_INTERACTIONS` storage update), the evidence is lost — the interaction object from storage still has `behavioralEvidence: undefined`, so the placeholder appears again.

**The evidence overlay is ephemeral — it survives only until the next full re-render.**

---

## Root Cause #3: __deferredEvidence Never Initialized

The fallback path in `handleEvidenceUpdate`:

```typescript
const deferred = (window as unknown as { __deferredEvidence?: Map<...> }).__deferredEvidence;
if (deferred) {
  deferred.set(eventId, evidence);
}
```

`__deferredEvidence` is **read** at line 995 but **never assigned** anywhere in the codebase. It's always `undefined`. So when the matching fails (which is always, due to RC-1), the fallback is also dead code — the evidence is silently dropped.

---

## Complete Failure Chain Summary

```
✅ Stage 1:  EventTap fires click event, assigns eventId = 'evt-p1a2b3c4d5e-1'
✅ Stage 2:  EvidenceCollector.onAfterEvent receives eventId
✅ Stage 3:  openWindow creates window with sourceEventId = 'evt-p1a2b3c4d5e-1'
✅ Stage 4:  TargetStateCache provides before/after snapshots
✅ Stage 5:  DOMObserver collects mutations
✅ Stage 6:  AdaptiveWindow fires close('stabilized') after 300ms
✅ Stage 7:  closeWindow builds BehavioralEvidence
✅ Stage 8:  deliverEvidence sends BEHAVIORAL_EVIDENCE to SW
✅ Stage 9:  SW stores in pendingEvidence, broadcasts INTERACTION_EVIDENCE_UPDATE
             with eventId = 'evt-p1a2b3c4d5e-1'
✅ Stage 10: Side panel receives INTERACTION_EVIDENCE_UPDATE
❌ Stage 11: handleEvidenceUpdate searches for card with badge text === 'evt-p1a2b3c4d5e-1'
             Card badge text is 'int-1' (interactionId, not eventId)
             MATCH FAILS
❌ Stage 12: Fallback to __deferredEvidence — Map is never initialized
             EVIDENCE SILENTLY DROPPED
```

Meanwhile:
```
✅ Component Runtime emits ComponentInteraction with interactionId = 'int-1'
✅ SW stores in LIVE_INTERACTIONS, broadcasts INTERACTION_CAPTURED
✅ Side panel re-renders all interactions from storage
❌ interaction.behavioralEvidence is always undefined (never attached)
   → Placeholder '⏳ Collecting behavioral evidence…' is shown
```

**The capture pipeline is fully functional. The display layer never receives the data due to ID space mismatch and missing integration points.**

---

## Severity Assessment

| ID | Issue | Severity | Impact |
|----|-------|----------|--------|
| RC-1 | ID mismatch: sourceEventId (evt-…) vs interactionId (int-…) | **CRITICAL** | 100% of evidence never reaches any interaction card. The entire M7 feature is non-functional. |
| RC-2 | behavioralEvidence never attached to ComponentInteraction | **CRITICAL** | Even with matching fixed, evidence is ephemeral — lost on next re-render. No persistence path exists. |
| RC-3 | __deferredEvidence Map never initialized | **HIGH** | Fallback path for late-arriving evidence is dead code. Evidence arriving before card render is silently dropped. |
| RC-4 | No integration test for end-to-end evidence-to-card flow | **HIGH** | The M4 and M7 test suites tested capture and rendering in isolation, but never the matching/integration between them. This bug would have been caught by a single integration test that exercises the real ID values through the real message flow. |

---

## What Is NOT the Problem

1. **Not AdaptiveWindow timing** — closeWindow IS being called after 300ms. The stabilization timer works correctly regardless of DOM churn.
2. **Not DOMObserver** — DOMObserver starts and collects mutations correctly. On OrangeHRM with zero mutations, the evidence window still closes (the stabilization timer fires regardless).
3. **Not NetworkBridge** — Network evidence is collected correctly (verified in M6 tests).
4. **Not TargetStateCache** — Before/after snapshots are captured correctly.
5. **Not EvidenceCollector** — The entire capture pipeline from EventTap → deliverEvidence works end-to-end.
6. **Not the rendering functions** — `renderEvidence`, `renderEvidencePlaceholder`, `updateEvidenceOnInteraction` all work correctly in isolation.
7. **Not the CSS** — Styles are present in the bundle and would render correctly if the evidence reached the card.

**The bug is entirely in the integration layer between the capture pipeline (which works) and the display layer (which works) — specifically, the matching logic that connects them was never implemented correctly and was never tested end-to-end.**
