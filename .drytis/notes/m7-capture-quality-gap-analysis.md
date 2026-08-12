# M7 Capture-Quality Gap Analysis — BehavioralEvidence vs v3.0 Spec

**Date**: 2026-08-12
**Commit**: `22d21be` (M7-fix-002)
**Status**: ANALYSIS ONLY — no code changes made

---

## Executive Summary

Real-browser testing on Amazon and OrangeHRM shows that while the M7-fix-001/002
renderer and correlation architecture work (cards display, evidence attaches), the
**captured BehavioralEvidence objects are mostly empty or degraded**. This is a
**capture pipeline problem, not a renderer problem, not a correlation problem.**

Seven distinct defects were found, with one CRITICAL root cause explaining the
"Unknown element" symptom that affects **100% of interactions**.

---

## Symptom-to-Root-Cause Matrix

| # | Symptom | Root Cause | Severity | Layer |
|---|---------|-----------|----------|-------|
| **GAP-1** | Target Evidence shows "Unknown element" | `identity` is hard-set to `null` at window-open, never updated | 🔴 CRITICAL | Capture (EvidenceCollector) |
| **GAP-2** | Text entry shows no value change | `before` snapshot depends on focus/mousedown listener firing; input opens window before cache has data | 🔴 HIGH | Capture (TargetStateListeners) |
| **GAP-3** | Dropdown DOM/surface changes missing | Visibility detection only checks `hidden`/`aria-hidden`, NOT `display`/`visibility`/`opacity` | 🟡 MEDIUM | Capture (DOMObserver) |
| **GAP-4** | Navigation evidence stuck "Collecting…" | `extractNavType()` returns hardcoded `'pushState'`, `extractFromUrl()` returns `''`; nav events only attach to currently-open windows, which may already be closed | 🔴 HIGH | Capture (EvidenceCollector) |
| **GAP-5** | Network activity missing | Requests completing after window close lose status/duration; window may close before async response arrives | 🟡 MEDIUM | Capture (EvidenceCollector timing) |
| **GAP-6** | Only checked:false→true appears | Only `hidden`/`aria-hidden` visibility changes detected, not `display`/`visibility`/`opacity` (same as GAP-3); before-snapshot availability varies by event sequence | 🟡 MEDIUM | Capture (DOMObserver + TargetStateListeners) |
| **GAP-7** | Window thrashing during typing | `keydown` is NOT filtered to Enter — every keystroke opens a separate evidence window in addition to the `input` typing window | 🟡 MEDIUM | Capture (EventTap) |

---

## GAP-1 (CRITICAL): Identity Always Null → "Unknown element"

### Root Cause

**`event-tap.ts:204`** extracts full 18-field `ElementIdentity` via `extractIdentity(targetEl)`.

**`event-tap.ts:216-222`** calls `onAfterEvent(targetEl, eventId, eventType, identity.cssSelector)` — only passes `.cssSelector` as the 4th argument. The full identity object is **discarded at this boundary**.

**`evidence-collector.ts:262`** sets `identity: null` in the observation window state:
```typescript
identity: null, // Identity comes from the ObservedEvent, not available here
```

**`evidence-collector.ts:325`** casts `null` to `ElementIdentity` at close:
```typescript
identity: state.identity as ElementIdentity,
```

**`evidence-renderer.ts:78-83`** renders this as "Unknown element":
```typescript
if (!identity) {
    main.textContent = 'Unknown element';
```

### Impact
100% of interactions show "Unknown element" in Target Evidence. The full identity
(accessibleName, ariaRole, tag, stableId, className, etc.) is available in the
ObservedEvent and could be passed through, but the `onAfterEvent` callback signature
doesn't include it.

### Fix Direction (not implemented)
Either:
- (a) Extend `onAfterEvent` signature in `EventTapConfig` to pass the full `ElementIdentity`
- (b) Call `extractIdentity(state.targetEl)` at close time in EvidenceCollector (element reference is stored)

Option (a) is cleaner (uses already-extracted immutable identity from event time, per spec §4.2 step 1: "Take identity from the ObservedEvent — already extracted by EventTap's extractIdentity() call").

### Real Example (Amazon)
User clicks "Add to Cart" button:
- **ObservedEvent.target** (available in EventTap): `{ tag: 'BUTTON', stableId: 'add-to-cart-button', ariaRole: 'button', accessibleName: 'Add to Cart', className: 'a-button-input', ... }`
- **EvidenceCollector receives**: `(buttonEl, 'evt-xxx', 'click', '#add-to-cart-button')` — only CSS selector survives
- **TargetEvidence.identity**: `null`
- **Side panel displays**: "Unknown element"

### Real Example (OrangeHRM)
User types "Admin" in username field:
- **ObservedEvent.target**: `{ tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Username', inputType: 'text', ... }`
- **EvidenceCollector receives**: `(inputEl, 'evt-xxx', 'input', 'input.oxd-input')` — only CSS selector
- **TargetEvidence.identity**: `null`
- **Side panel displays**: "Unknown element"

---

## GAP-2 (HIGH): Text Entry Before/After Value Missing

### Root Cause

The spec (§4.6) says: "First input event → open window. before.value = ''. Subsequent → extend."

EvidenceCollector opens the typing window on the first `input` event. At that
point, it peeks `TargetStateCache` for the before-snapshot:
```typescript
// evidence-collector.ts:245
const beforeSnapshot = this.targetStateCache.peek(targetEl) ?? null;
```

**The cache is populated by capture-phase `mousedown` and `focus` listeners**
(target-state-listeners.ts:47-66). These listeners fire on `e.target`:
```typescript
const onMouseDown = (e: Event): void => {
    const target = e.target; // ← plain e.target
    cache.capture(target);
};
```

**The problem**: For a typical text entry flow:
1. User clicks into the field → `mousedown` fires → cache captures `value: ''`
2. User clicks → `click` fires → opens a window (from mousedown/click in WINDOW_OPEN_EVENTS)
3. User types → `input` fires → opens typing window

**But** if the user focuses the field via Tab key (no mousedown), or if the
`focus` event fires *after* the first `input` (which can happen in React
controlled inputs where focus is delayed), the cache may not have a before-snapshot.
`peek()` returns `undefined`, so `before = null`.

Additionally, the after-snapshot is captured at window close by calling
`targetStateCache.capture(state.targetEl)`. For typing windows, the `input` event
opens the window. But `capture()` in target-state-cache.ts takes a snapshot of the
element *at the time of the call*. For typing, the final value should be in the DOM
by the time the window closes (300ms after last input). **This should work** — the
value IS in the element when the after-snapshot is taken.

### What DOES work
Checkbox `checked: false → true` works because:
1. `mousedown` capture-phase listener fires BEFORE the click changes the checkbox
2. `cache.capture(target)` stores `{ checked: false }`
3. Click event opens window, `peek()` finds the snapshot
4. Window closes, `capture()` stores `{ checked: true }`
5. Diff: `checked: false → true` ✅

### Real Example (Amazon Search)
User types "laptop" in search box:
- Expected: `before: { value: '' }`, `after: { value: 'laptop' }`
- Actual: `before: null` (if no prior focus/mousedown captured the empty state), `after: { value: 'laptop' }`
- Displayed: "(no prior state captured) → value: laptop" — the before is missing

### Real Example (OrangeHRM Login)
User types "Admin" in username:
- Expected: `before: { value: '' }`, `after: { value: 'Admin' }`
- Actual: If user clicks field first, mousedown captures `value: ''` → `before.value: ''` works. If user Tab-navigates to the field, `focus` listener fires → cache populated → `before.value: ''` works.
- **This interaction generally works in OrangeHRM** because OrangeHRM forms use standard focus flows. It may NOT work on Amazon's React-based search bar.

---

## GAP-3 (MEDIUM): Dropdown DOM/Surface Changes Missing

### Root Cause

**`dom-observer.ts:592-597`** — Visibility detection is incomplete:
```typescript
if (record.type === 'attributes') {
    const attrName = record.attributeName;
    if (attrName === 'hidden' || attrName === 'aria-hidden') {
        this.detectVisibilityChange(targetEl, attrName, record.oldValue, ...);
    }
}
```

The spec (§3.6) defines `VisibilityChange.property` as supporting `'display' | 'visibility' | 'opacity' | 'hidden' | 'aria-hidden'`. But the DOMObserver **only checks `hidden` and `aria-hidden`**. 

Most modern frameworks (React, Vue) toggle visibility via CSS classes that change `display: none → block`. These are **attribute changes to `class`**, not changes to `hidden`/`aria-hidden`. The MutationObserver sees the `class` attribute change, but `detectVisibilityChange` is never called for `class`.

Surface detection (childList mutations adding elements with `role="listbox"`, `role="menu"`, etc.) DOES work — but only if the dropdown content is added/removed from the DOM. Many frameworks pre-render the dropdown and toggle visibility via `display`/CSS — these are invisible to the current surface detection.

### Real Example (Amazon Category Dropdown)
User clicks "All Departments" dropdown:
- Expected: `newSurfaces: [{ role: 'listbox', ... }]`, `visibilityChanges: [{ property: 'display', ... }]`
- Actual: If the dropdown listbox is added to DOM → `newSurfaces` detected. If it's pre-rendered and CSS-toggled → **missed entirely**.

### Real Example (OrangeHRM Dropdown)
User clicks a select dropdown:
- OXD framework renders a `<div role="listbox">` that's added to the DOM on click → `newSurfaces` should detect this
- But the OXD framework may toggle `class` to show/hide → `display` change not tracked → some visibility changes missed

---

## GAP-4 (HIGH): Navigation Evidence Stuck "Collecting…"

### Root Cause — Two Compounding Defects

**Defect A: Hardcoded navigation type and from-URL**

`evidence-collector.ts:486-497`:
```typescript
private extractNavType(_targetEl: Element): NavigationEvidence['type'] {
    return 'pushState'; // default; refined by correlation layer
}

private extractFromUrl(): string {
    return ''; // Unknown in content script context
}
```

`fromUrl` is always empty string. `type` is always `'pushState'` even for
`replaceState`, `popstate`, `hashchange`, or full page reloads.

EventTap DOES have this information — `emitSpaNavigation(navType)` at line 103
passes the correct nav type. But this type is on the `ObservedEvent.navType`
field, not passed to EvidenceCollector via `onAfterEvent`.

**Defect B: Navigation events only attach to currently-open windows**

`evidence-collector.ts:199-202`:
```typescript
if (eventType === 'navigation') {
    this.recordNavigationEvent(targetEl);
    return; // ← returns early, does NOT open a window
}
```

`recordNavigationEvent` (line 447-455):
```typescript
for (const win of this.activeWindows) {
    if (!win.isClosed) {
        win.navEvents.push(navEvidence);
    }
}
this.pendingNavEvents.push(navEvidence);
```

Navigation events are **passive** — they don't open their own window. They rely
on an existing window being open when the navigation fires. But by the time
`pushState` executes (often 100-300ms after the click handler), the click's
window may have already closed (300ms stabilization). The nav event then lands
only in `pendingNavEvents`, which gets attributed to the **next** unrelated
interaction's window (line 340).

**Defect C: Navigation interactions in ComponentRuntime**

When a navigation event is detected by EventTap, it's sent to the SW as an
ObservedEvent. The ComponentRuntime in sw-integration.ts may or may not create
a ComponentInteraction for navigation events. If it does, that interaction needs
evidence — but since `onAfterEvent` for navigation doesn't open a window, the
interaction will never receive evidence → stays "Collecting behavioral evidence…"

### Real Example (Amazon Search Results)
User types in search box, presses Enter → SPA navigates to results page:
1. `keydown(Enter)` opens window (GAP-7: not filtered to Enter, but Enter IS the key)
2. Form submission / React Router calls `history.pushState`
3. `emitSpaNavigation('pushState')` fires `onAfterEvent` with `'navigation'`
4. EvidenceCollector routes to `recordNavigationEvent` — no window opened
5. The keydown window may still be open (within 300ms) → nav attached
6. OR the keydown window already closed → nav goes to `pendingNavEvents` → attributed to next click

### Real Example (OrangeHRM Login)
User clicks Login → form POST → full page reload to /dashboard:
- This is a full-page reload, not SPA navigation → `emitSpaNavigation` may not fire at all
- The page reload destroys the content script → evidence window is destroyed
- Evidence never delivered to SW → interaction stays "Collecting…"

---

## GAP-5 (MEDIUM): Network Activity Missing

### Root Cause

**Timing mismatch**: The adaptive window closes after 300ms of DOM quiescence.
Network requests triggered by a click often take longer than 300ms to complete.

**`evidence-collector.ts:306-312`** collects network activity at close time:
```typescript
networkActivity = this.networkBridge.collectForRange(
    state.openedAt,
    performance.now(), // ← closedAt = now
);
```

For a request that starts within the window but completes after:
- The `start` event IS captured → `startRelativeToEvent` is set
- The `complete` event happens AFTER the window closes → `endRelativeToEvent` stays `null`
- `status` may be `null` (complete event hasn't updated the buffer entry yet)
- `durationMs` is `null`

So network entries appear but with missing status/duration — or the request hasn't
even started yet by the time the window closes (async handler hasn't fired).

Additionally, `networkBridge.clearBuffer()` exists (line 249 of network-bridge.ts)
but `closeWindow` never calls it. Over a long session, old entries persist and
may be re-collected by subsequent windows (false attribution).

### Real Example (Amazon Add to Cart)
User clicks "Add to Cart":
1. Click opens window at T=0
2. Click handler fires API call at T=50ms
3. DOM settles at T=100ms (button class change only)
4. Window stabilizes at T=400ms (300ms quiescence) → closes
5. API response arrives at T=800ms → AFTER window close
6. Network entry has `start: 50ms` but `status: null`, `endRelativeToEvent: null`

### Real Example (OrangeHRM Login)
User clicks Login → POST /auth/validate:
- Request starts within window → captured
- Response (302 redirect) arrives ~300ms later → may or may not be in window
- Full page reload destroys the content script → bridge buffer lost

---

## GAP-6 (MEDIUM): Only Some State Changes Appear

### Root Cause

**Same as GAP-3**: Visibility changes (`display`, `visibility`, `opacity`) are not
tracked by DOMObserver. Only `hidden` and `aria-hidden` are detected.

Additionally, the TargetStateSnapshot's 9 properties don't include some important
state transitions:
- `aria-selected` (dropdown options)
- `aria-current` (navigation items)
- `data-*` attributes (custom component state)

What DOES work:
- ✅ `checked: false → true` (checkbox/radio via DOM property)
- ✅ `className` changes (MutationObserver sees these as attribute mutations)
- ✅ `disabled: false → true` (DOM property)
- ✅ `ariaExpanded: false → true` (attribute mutation, captured by snapshot)

What DOESN'T work:
- ❌ `display: none → block` (not in visibility detection)
- ❌ `aria-selected` (not in TargetStateSnapshot)
- ❌ Programmatic value changes (no capture-phase listener fired)

---

## GAP-7 (MEDIUM): Window Thrashing During Typing

### Root Cause

**`event-tap.ts:316-324`** registers `keydown` for ALL keys:
```typescript
const eventTypes: string[] = [
    'click', 'mousedown', 'contextmenu',
    'focus', 'blur',
    'input', 'change',
    'mouseenter', 'mouseleave', 'mousemove',
    'keydown',  // ← ALL keys, not just Enter
    'scroll',
    'submit',
];
```

Every `keydown` event calls `onAfterEvent`. The EvidenceCollector has `keydown`
in `WINDOW_OPEN_EVENTS` (line 65):
```typescript
const WINDOW_OPEN_EVENTS = new Set([
    'click', 'mousedown', 'contextmenu', 'change', 'keydown', 'focus', 'blur',
]);
```

The comment at line 217-219 says "EventTap filters to Enter-only before calling
onAfterEvent" — **but this filtering does NOT happen**. EventTap passes ALL
keydown events through. The EvidenceCollector's `keydown` comment is incorrect.

So during typing "laptop":
1. `keydown(l)` → opens window W1
2. `input(l)` → opens typing window W2
3. `keydown(a)` → opens window W3 (W1 may be displaced at 5-window limit)
4. `input(a)` → extends W2
5. `keydown(p)` → opens window W4
...

Result: One typing session produces ~6 keydown windows + 1 typing window. The
keydown windows have near-empty evidence (no DOM mutations from a single key
press). They clutter the interaction list and consume the 5-window concurrency
limit, causing premature displacement.

---

## Layer Classification

| Layer | Status | Details |
|-------|--------|---------|
| **Capture (EvidenceCollector)** | 🔴 BROKEN | GAP-1 (identity null), GAP-4 (nav stubs), GAP-5 (timing), GAP-7 (keydown) |
| **Capture (TargetStateListeners)** | 🟡 DEGRADED | GAP-2 (before snapshot availability), GAP-6 (limited properties) |
| **Capture (DOMObserver)** | 🟡 DEGRADED | GAP-3 (visibility incomplete), GAP-6 (same) |
| **Capture (EventTap)** | 🟡 DEGRADED | GAP-7 (keydown not filtered) |
| **SW Correlation (sw-integration)** | ✅ WORKING | M7-fix-001 two-tier matching correct |
| **SW Handler (service-worker)** | ✅ WORKING | BEHAVIORAL_EVIDENCE handler correct |
| **Renderer (evidence-renderer)** | ✅ WORKING | M7-fix-002 null-safe, correctly displays whatever data it receives |
| **Renderer (interaction-renderer)** | ✅ WORKING | Per-card error boundary, all cards render |

**Conclusion**: The pipeline breaks at **capture time**, not at display time.
The renderer faithfully displays exactly what it receives — which is degraded
evidence with null identity, missing before-snapshots, incomplete visibility
tracking, and missing navigation/network data.

---

## Pipeline Trace: Simple Click on Amazon "Add to Cart"

```
EventTap.handleRawEvent()
  ├─ resolveTarget(rawEvent) → buttonEl ✅
  ├─ extractIdentity(buttonEl) → { tag:'BUTTON', accessibleName:'Add to Cart', ... } ✅
  ├─ assembleObservedEvent() → ObservedEvent with full identity ✅
  ├─ config.onEvent(observed) → sent to SW → ComponentRuntime → ComponentInteraction ✅
  └─ config.onAfterEvent(buttonEl, 'evt-xxx', 'click', '#add-to-cart-button')
       ↓ identity truncated to cssSelector only ← GAP-1
     EvidenceCollector.onAfterEvent(buttonEl, 'evt-xxx', 'click', '#add-to-cart')
       ├─ 'click' ∈ WINDOW_OPEN_EVENTS → openWindow()
       ├─ peek(buttonEl) → before snapshot (if mousedown captured it)
       ├─ state.identity = null ← GAP-1 CRITICAL
       ├─ AdaptiveWindow armed → 300ms timer starts
       ├─ [DOM mutations: button class change]
       ├─ [300ms passes with no mutations]
       └─ AdaptiveWindow closes → EvidenceCollector.closeWindow()
            ├─ capture(buttonEl) → after snapshot ✅
            ├─ getAccumulatedSummaries() → [{ types:['attributes'], changedAttributes:['class'], ... }] ✅
            ├─ getSurfaceChanges() → [] (no surfaces added) ← may be correct
            ├─ getVisibilityChanges() → [] ← GAP-3/6: display not tracked
            ├─ networkBridge.collectForRange() → [] ← GAP-5: API response after close
            ├─ Build TargetEvidence:
            │    identity: null ← GAP-1
            │    before: { className:'btn' } (if captured) or null ← GAP-2
            │    after: { className:'btn active', disabled:false }
            │    focusMovement: { before:null, after:{...} }
            ├─ Build ApplicationEvidence:
            │    domChanges: [1 entry: class change] ✅
            │    networkActivity: [] ← GAP-5
            │    performanceCondition: { totalBatches:1 }
            └─ deliverEvidence() → chrome.runtime.sendMessage BEHAVIORAL_EVIDENCE
                 ↓
               SW: handleBehavioralEvidence()
                 ├─ storePendingEvidence() ✅
                 ├─ attachEvidenceToInteraction('evt-xxx')
                 │    ├─ Tier 1: interaction.triggerEvent.eventId === 'evt-xxx' → MATCH ✅
                 │    ├─ Attach to interaction.behavioralEvidence ✅
                 │    └─ Broadcast INTERACTION_EVIDENCE_UPDATE { interactionId, evidence } ✅
                 ↓
               SidePanel: handleEvidenceUpdate(interactionId, evidence)
                 ├─ Find card by interactionId ✅ (M7-fix-001)
                 └─ renderEvidence() → displays whatever it received:
                      ├─ Identity: "Unknown element" ← GAP-1
                      ├─ Before → After: class change only
                      ├─ DOM Changes: 1 entry
                      ├─ Network: (none)
                      └─ Performance: 1 batch
```

---

## Recommended Fix Priority (not implemented)

| Priority | Gap | Fix Complexity | Impact |
|----------|-----|---------------|--------|
| **P0** | GAP-1 (identity null) | Low — extend onAfterEvent signature or call extractIdentity at close | Fixes 100% of "Unknown element" |
| **P1** | GAP-4 (nav stubs) | Medium — pass navType/fromUrl from EventTap, fix nav window attribution | Fixes navigation evidence |
| **P1** | GAP-7 (keydown filter) | Low — filter keydown to Enter in EvidenceCollector or EventTap | Eliminates window thrashing |
| **P2** | GAP-3 (visibility) | Medium — add display/visibility/opacity check in DOMObserver | Fixes dropdown/overlay evidence |
| **P2** | GAP-2 (before snapshot) | Medium — capture before-state at window open time, not from cache | Fixes text entry before value |
| **P3** | GAP-5 (network timing) | Hard — extend window close to wait for in-flight requests | Improves network completeness |

---

## M1–M6 Integrity

No changes were made. All analysis was read-only. The gaps are in M1 (EventTap
identity passthrough), M2 (TargetStateListeners coverage), M3 (DOMObserver
visibility detection), M4 (EvidenceCollector identity/nav/keydown logic), and
M6 (NetworkBridge timing). M5 (shadow DOM observer) was not directly implicated.

---

## End of Report — No code changes made. Awaiting direction.
