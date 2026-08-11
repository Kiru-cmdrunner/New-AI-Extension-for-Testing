# Behavioral Evidence Model — Formal Specification

**Version**: 3.0 (implementation-ready — resolves all 23 validation findings against 3bc28f6)
**Date**: 2026-08-11
**Baseline**: `3bc28f6` on `capability-surgical-removal` (the ONLY implementation baseline)
**Status**: SPECIFICATION — no implementation yet.
**Supersedes**: `m1-behavioral-observation.md`, `m1-complete-design.md`, `semantic-effect-interpretation.md`, all Phase A–E specs for the prior behavioral observation system, and v1.0/v2.0 of this document.

**Revision log**:
- v3.0: Resolves all 23 validation findings (SC-1 through SC-8, V-R1 through V-R23) against actual code at `3bc28f6`. Key changes: (SC-1) evidence lifecycle now uses deferred in-memory attachment with stopRecording persistence; (SC-2) EventTap navigation events modified to fire `onAfterEvent`; (SC-3) `inputType` marked as a new field addition, not an existing one; (SC-4/SC-4b) MAIN-world network injection switched to dynamic `chrome.scripting.executeScript` with webRequest as parallel fallback for race coverage; (SC-5) webRequest permission UX note added; (SC-6) Dexie table scope defined as long-term queryable persistence; (SC-7/SC-8) orphaned M1 comment cleanup noted, all "reuse removed system" language eliminated. Baseline changed from `aef34a0` to `3bc28f6`.
- v2.0: Resolved C1–C4, H1–H5, all open questions (written against `aef34a0`).
- v1.0: Initial draft (written against `deff878`).

---

## 0. The Claim This Model Must Support

> For every recorded user interaction, the recorder captures two independent
> evidence scopes — what happened to the interacted element (TargetEvidence)
> and what happened across the application (ApplicationEvidence) — with raw
> timing, batch ordering, and structural context, without claiming causation,
> semantic meaning, or interpreting what the evidence implies.
>
> A future Evidence Correlation layer may consume this evidence to determine
> which application changes are consequences of the action. The evidence model
> itself never makes that determination.

**Strict boundary**: This model captures raw evidence only. No semantic
classification. No causal attribution. No effect interpretation. No confidence
scoring. No "what happened" summaries.

---

## 1. Design Principles

| # | Principle | Rationale |
|---|---|---|
| P1 | **Capture, don't interpret** | Every pre-classification is a premature causal claim the correlation layer cannot correct. Record raw timing and structural facts. |
| P2 | **Dual scope, kept separate** | TargetEvidence and ApplicationEvidence answer different questions. Merging them conflates "what happened to this element" with "what happened in the DOM." |
| P3 | **Composition over special observers** | Multi-level dropdowns, cascading filters, and wizard flows are sequences of independent actions. No "multi-level dropdown observer." Each action captures independently. |
| P4 | **Raw timing over pre-classified labels** | `synchronousEffects`/`asyncEffects`/`networkCorrelated` are interpretations. The correlation layer needs `relativeTime` + `batchIndex` to make its own classifications. |
| P5 | **Bounded by design** | Every data structure has a hard cap. Every observation window has a maximum lifetime. Memory growth is deterministic, not opportunistic. |
| P6 | **Deferred causal correlation** | "These application changes are probably consequences of this action" is a question for a later layer, never answered at capture time. |
| P7 | **Shadow DOM is first-class** | Modern SPAs use shadow DOM extensively. Observation must recursively enter shadow roots. |
| P8 | **Reuse surviving infrastructure** | EventTap (12 event types, History API patches) and IdentityExtractor (18 fields) survive at `3bc28f6` and are reused. All behavioral observation infrastructure was removed and must be built new. (Resolves C2, C3, V-R1, V-R2, V-R3.) |

---

## 2. Architecture Overview

```
┌─── Content Script — ISOLATED World (existing, entry: recorder-entry.ts) ──┐
│                                                                            │
│  ┌──────────────┐                                                          │
│  │   EventTap   │  onEvent(ObservedEvent) — includes identity + nav       │
│  │  (EXISTING   │  onAfterEvent(el, eventId, eventType, cssSelector)      │
│  │   at 3bc28f6)│  (hook exists but is NOT yet wired — see §9.1)         │
│  │              │──────────────────────────────────────────────────────┐  │
│  └──────────────┘                                                      │  │
│                                                                        │  │
│  ┌─────────────────────┐              ┌───────────────────────────▼▼┐  │
│  │ TargetStateCache    │              │ EvidenceCollector           │  │
│  │ (WeakMap<Element,   │◄────peek─────│  (NEW — does not exist      │  │
│  │  TargetStateSnap>)  │◄────read─────│   at 3bc28f6)               │  │
│  │ (NEW)               │              │                             │  │
│  │                     │              │  openEvidence(eventId,      │  │
│  │ Populated by:       │              │    eventType, targetEl,     │  │
│  │ mousedown+focus     │              │    identity, eventTimestamp)│  │
│  │ capture-phase       │              │                             │  │
│  │ listeners (NEW)     │              │  1. peek cache → beforeSnap │  │
│  └─────────────────────┘              │  2. identity from ObservedEvent│ │
│                                       │     (already on event.target)│  │
│  ┌─────────────────────┐              │  3. start DOMObserver       │  │
│  │ DOMObserver         │◄────start────│  4. start AdaptiveWindow     │  │
│  │ (NEW — recursive    │              │  5. network/nav via bridge   │  │
│  │  shadow DOM,        │────records──►│     (see §6, §7)             │  │
│  │  refcounted, shared │              │                             │  │
│  │  batch counter)     │              │  closeEvidence(reason):     │  │
│  └─────────────────────┘              │    1. read target → afterSnap│  │
│                                       │    2. collect+summarize DOM  │  │
│  ┌─────────────────────┐              │    3. collect net from bridge│  │
│  │ AdaptiveWindow      │◄────arm──────│    4. collect nav from EventTap│ │
│  │ (NEW —              │              │    5. build BehavioralEvidence│ │
│  │  setTimeout-based   │              │    6. deliver to SW          │  │
│  │  stabilization)     │────close────►│                             │  │
│  └─────────────────────┘              └─────────────────────────────┘  │
│                                                                        │  │
│  ┌─────────────────────────────────────────┐                           │  │
│  │ NetworkBridge (ISOLATED side, NEW)       │                           │  │
│  │  Listens for window 'cmdrunner-net'      │                           │  │
│  │  CustomEvents from MAIN world injection  │                           │  │
│  │  → forwards to EvidenceCollector         │                           │  │
│  └─────────────────┬───────────────────────┘                           │  │
│                    │ CustomEvent on window                              │  │
└────────────────────┼────────────────────────────────────────────────────┘
                     │
    ┌────────────────┼──────────────────────────────────┐
    │                │  Dynamic injection at recording   │
    │                ▼  start via chrome.scripting       │
┌─── Content Script — MAIN World (NEW, dynamically injected) ────────────┐
│                                                                        │
│  ┌─────────────────────┐                                              │
│  │ NetworkInterceptor  │  Patches window.fetch +                      │
│  │ (fetch/XHR          │  XMLHttpRequest.prototype.open/send          │
│  │  monkeypatch in     │  in page's JS context                        │
│  │  page's JS context) │                                              │
│  └─────────────────────┘                                              │
│                                                                        │
│  Posts CustomEvent('cmdrunner-net', {detail: NetworkActivity})         │
│  on window. ISOLATED-world NetworkBridge listens.                      │
│                                                                        │
│  Posts CustomEvent('cmdrunner-net-ready') on injection.                │
│  ISOLATED-world bridge uses this to confirm MAIN-world is active.      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

         │ EvidenceCollector sends:
         │   sendMessage({type:'BEHAVIORAL_EVIDENCE', payload})
         ▼
┌─── Service Worker ──────────────────────────────────────────────────────┐
│                                                                        │
│  case 'BEHAVIORAL_EVIDENCE':                                           │
│    handleBehavioralEvidence(evidence):                                 │
│      1. Store in pendingEvidence: Map<string, BehavioralEvidence>      │
│         keyed by sourceEventId (SC-1 deferred attachment)              │
│      2. If matching interaction exists in liveInteractions:            │
│         attach to interaction.behavioralEvidence                       │
│      3. Broadcast INTERACTION_EVIDENCE_UPDATE to side panel            │
│      4. No durable storage keys per evidence (in-memory only)          │
│                                                                        │
│  At stopRecording (session persistence):                               │
│    persistSession flushes pendingEvidence → Dexie behavioral_evidence  │
│    table alongside interaction persistence (SC-1, SC-6)                │
│                                                                        │
│  webRequest fallback (parallel, not just CSP):                         │
│    chrome.webRequest.onBeforeRequest → request metadata                │
│    chrome.webRequest.onCompleted → response metadata                   │
│    Runs IN PARALLEL with MAIN-world for race coverage (SC-4b)          │
│    EvidenceCollector deduplicates: prefers 'main-world' source         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Data Structures

### 3.1 BehavioralEvidence (Top-Level Envelope)

```typescript
/**
 * Complete behavioral evidence for one user interaction.
 * Contains two independent scopes. Neither scope references the other.
 *
 * INV-BEHAV-1: This structure contains raw evidence only.
 *   No semantic classification, no causal attribution,
 *   no confidence scores, no "what happened" summaries.
 *
 * INV-BEHAV-2: targetEvidence and applicationEvidence are independent.
 *   Neither is derived from or dependent on the other.
 *   The correlation layer may cross-reference them later.
 */
interface BehavioralEvidence {
  /** Event that triggered this evidence collection. */
  sourceEventId: string;

  /** Event type from EventTap. */
  sourceEventType: string;

  /** Unique evidence window ID: `bev-{eventId}`. */
  windowId: string;

  /** Frame identifier — 'main' for top frame, URL for iframes. */
  frameId: string;

  /** Window metadata — how/when the observation opened and closed. */
  window: EvidenceWindow;

  /** What happened to the interacted element. */
  targetEvidence: TargetEvidence;

  /** What happened across the application. */
  applicationEvidence: ApplicationEvidence;
}
```

### 3.2 EvidenceWindow

```typescript
/**
 * Metadata about the observation window itself.
 * Raw timing only — no interpretation of window quality.
 */
interface EvidenceWindow {
  /** performance.now() when the window opened (event dispatch time). */
  openedAt: number;

  /** performance.now() when the window closed. */
  closedAt: number;

  /** Duration in milliseconds (closedAt - openedAt). */
  durationMs: number;

  /**
   * Why the window closed. Raw fact, not interpretation.
   *
   * 'stabilized'         — DOM was quiescent for minQuiescence ms.
   * 'max-duration'       — hit the 10s hard cap.
   * 'element-removed'    — target element left the DOM.
   * 'recording-stopped'  — recording ended, window force-closed.
   * 'navigation'         — SPA or full-page navigation detected.
   * 'typing-complete'    — input quiescence timer expired (typing sessions).
   * 'displaced'          — displaced by max-concurrent-windows limit.
   */
  endReason: 'stabilized' | 'max-duration' | 'element-removed'
            | 'recording-stopped' | 'navigation'
            | 'typing-complete' | 'displaced';

  /**
   * Stability trace — quiescence period measurements taken during the window.
   * Lets the correlation layer see the mutation rhythm, not just the final state.
   * Capped at 50 entries (circular buffer — oldest entries dropped).
   */
  stabilityTrace: StabilitySample[];
}

interface StabilitySample {
  /** performance.now() when this sample was taken. */
  timestamp: number;
  /** Milliseconds since the last mutation batch at this sample point. */
  msSinceLastMutation: number;
  /** Global batch counter value at this sample point. */
  globalBatchCount: number;
}
```

### 3.3 TargetEvidence

```typescript
/**
 * Evidence about the element the user interacted with.
 * Answers: "What is this element, what state was it in,
 *           and what happened to it?"
 *
 * INV-TGT-1: identity is the existing ElementIdentity from src/shared/types.ts,
 *   extracted by identity-extractor.ts at EventTap capture time. This is NOT
 *   a new type — it is reused verbatim from the 18-field ElementIdentity that
 *   survives at 3bc28f6. (Resolves C3, V-R2.)
 *
 * INV-TGT-2: The ObservedEvent already carries .target (ElementIdentity) and
 *   .valueBefore/.valueAfter for the interaction. TargetEvidence ADDS the
 *   TargetStateSnapshot for properties EventTap doesn't capture.
 */
interface TargetEvidence {
  /**
   * Full element identity — existing 18-field ElementIdentity.
   * Taken directly from ObservedEvent.target (not re-extracted).
   * Fields at 3bc28f6: accessibleName, ariaRole, ariaLabel, ariaLabelledBy,
   *   placeholder, tag, className, name, stableId, testId, dataCy, dataQa,
   *   cssSelector, xPath, inIframe, shadowDom, href, elementId.
   *   Plus optional iframeContext.
   *
   * SC-3 RESOLUTION: The spec previously listed 'inputType' as an existing
   * field. It does NOT exist at 3bc28f6. See §8.2 for the new-field addition.
   */
  identity: ElementIdentity;

  /**
   * When identity was captured (relative to window.openedAt).
   * Always 0 or near-0 since identity is captured at event dispatch time.
   */
  identityCapturedAt: number;

  /** State before the interaction. null if no prior cache entry. */
  before: TargetStateSnapshot | null;

  /** State after the observation window closed. */
  after: TargetStateSnapshot | null;

  /** Where focus moved after this interaction, if detectable. */
  focusMovement: FocusMovement | null;
}

/**
 * Point-in-time snapshot of an element's observable state.
 * 9 DOM properties that MutationObserver cannot see (they are properties,
 * not attributes). Complements the existing ObservedEvent.valueBefore/valueAfter
 * which only captures value.
 */
interface TargetStateSnapshot {
  value: string | null;
  checked: boolean | null;
  className: string;
  disabled: boolean;
  ariaExpanded: boolean | null;
  ariaChecked: boolean | null;
  ariaPressed: boolean | null;
  textContent: string | null;
  childCount: number;
  /** performance.now() when this snapshot was captured. */
  capturedAt: number;
}

interface FocusMovement {
  /** Where focus was before the interaction (from cache). */
  before: { tagName: string; ariaRole: string | null; accessibleName: string | null } | null;
  /** Where focus moved to after the interaction. */
  after: { tagName: string; ariaRole: string | null; accessibleName: string | null } | null;
  /** performance.now() when the focus change was detected. */
  detectedAt: number;
}
```

### 3.4 ApplicationEvidence

```typescript
/**
 * Evidence about what happened across the application because of
 * (or coincident with) the interaction.
 *
 * INV-APP-1: No causal claims. Mutations are tagged with timing
 *   and batch index only. The correlation layer determines causality.
 *
 * INV-APP-2: All data is summarized and capped. No raw MutationRecords.
 *   No unbounded arrays.
 *
 * INV-APP-3: When coarseMode is true, domChanges contains the first 200
 *   summaries collected (NOT zero — the earliest, most-relevant evidence
 *   is preserved). domChangeOverflow indicates how many additional
 *   summaries were dropped. (Resolves C4.)
 */
interface ApplicationEvidence {
  /** Summarized DOM mutations, grouped and capped at 200. */
  domChanges: DomChangeSummary[];

  /**
   * Number of DomChangeSummary entries dropped because the 200 cap was hit.
   * 0 in normal operation. >0 indicates a high-churn page.
   * When >0, coarseMode is true.
   */
  domChangeOverflow: number;

  /** True if domChanges hit the 200 cap. Surfaces + navigation + network retained. */
  coarseMode: boolean;

  /** New surfaces that appeared (dialogs, menus, panels, overlays). */
  newSurfaces: SurfaceChange[];

  /** Surfaces that were removed. */
  removedSurfaces: SurfaceChange[];

  /** Elements whose visibility changed (display, visibility, opacity, hidden). */
  visibilityChanges: VisibilityChange[];

  /** SPA or full-page navigation events (from existing EventTap navigation events). */
  navigation: NavigationEvidence[];

  /** Network activity observed during the window. */
  networkActivity: NetworkActivity[];

  /** Performance condition: was the main thread congested? */
  performanceCondition: PerformanceCondition | null;
}
```

### 3.5 DomChangeSummary

```typescript
/**
 * A summarized group of mutations on the same target element.
 * Multiple raw MutationRecords on the same element are collapsed
 * into one DomChangeSummary.
 *
 * CAP: Max 200 summaries per evidence window. The FIRST 200 are kept;
 * additional summaries are counted in domChangeOverflow and dropped.
 * (Resolves C4 — does NOT discard all entries.)
 */
interface DomChangeSummary {
  types: ('attributes' | 'childList' | 'characterData')[];
  targetPath: string;
  targetTag: string;
  shadowContext: string | null;
  changedAttributes: string[];
  attributeDeltas: Record<string, { old: string | null; new: string | null }>;
  addedNodesCount: number;
  removedNodesCount: number;
  characterDataDelta: { old: string | null; new: string | null } | null;

  /**
   * Raw timing: performance.now() - window.openedAt for the FIRST
   * mutation in this group.
   */
  firstMutationAt: number;

  /** Raw timing for the LAST mutation in this group. */
  lastMutationAt: number;

  /** Total raw MutationRecords collapsed into this summary. */
  rawMutationCount: number;

  /**
   * Global batch index of the FIRST mutation in this group.
   *
   * The batch index comes from a SHARED counter across all concurrent
   * observation windows — NOT a per-window counter. (Resolves H1.)
   * This ensures batchIndex=5 means the same physical MutationObserver
   * callback regardless of which window observed it.
   *
   * 0 = first MutationObserver callback after recording started (or after
   * the last counter reset). The correlation layer computes timing
   * classifications from this + relativeTime.
   */
  firstBatchIndex: number;

  /** Global batch index of the LAST mutation in this group. */
  lastBatchIndex: number;
}
```

### 3.6 SurfaceChange, VisibilityChange, NavigationEvidence, NetworkActivity, PerformanceCondition

```typescript
interface SurfaceChange {
  path: string;
  tagName: string;
  ariaRole: string | null;
  accessibleName: string | null;
  shadowContext: string | null;
  descendantCount: number;
  /** performance.now() - window.openedAt. */
  relativeTime: number;
  /** Global batch index (shared counter). */
  batchIndex: number;
}

interface VisibilityChange {
  path: string;
  property: 'display' | 'visibility' | 'opacity' | 'hidden' | 'aria-hidden';
  oldValue: string | null;
  newValue: string | null;
  relativeTime: number;
  batchIndex: number;
}

/**
 * Navigation evidence derived from existing EventTap navigation events.
 * EventTap already patches history.pushState/replaceState and listens for
 * popstate/hashchange, emitting ObservedEvent with eventType='navigation'.
 * The EvidenceCollector consumes these — does NOT re-patch History API.
 * (Resolves C2, V-R5. See §7 for the onAfterEvent wiring fix.)
 */
interface NavigationEvidence {
  type: 'pushState' | 'replaceState' | 'hashchange' | 'popstate' | 'full-reload';
  fromUrl: string;
  toUrl: string;
  relativeTime: number;
  batchIndex: number | null;
}

/**
 * Network request observed during the observation window.
 *
 * PRIMARY: captured by MAIN-world fetch/XHR monkeypatch (dynamically injected).
 * FALLBACK/PARALLEL: captured by chrome.webRequest in SW (metadata only).
 *
 * SC-4b RESOLUTION: webRequest runs IN PARALLEL with MAIN-world injection,
 * not only as a CSP fallback. This covers the race condition window between
 * recording start and MAIN-world script injection. Deduplication prefers
 * 'main-world' source when both capture the same request.
 *
 * Records metadata only — no request/response bodies.
 */
interface NetworkActivity {
  url: string;
  method: string;
  status: number | null;
  startRelativeToEvent: number;
  endRelativeToEvent: number | null;
  durationMs: number | null;
  resourceType: 'xhr' | 'fetch' | 'unknown';
  /**
   * Source of this record.
   * 'main-world' — dynamically injected MAIN-world monkeypatch (full metadata).
   * 'webrequest' — SW chrome.webRequest (url/method/status/timing).
   */
  source: 'main-world' | 'webrequest';
}

interface PerformanceCondition {
  /**
   * True if any MutationObserver callback batch exceeded the
   * mainThreadBudgetMs threshold (default: 15ms).
   * Measures actual main-thread blocking — timing-based.
   */
  mainThreadBlocked: boolean;

  /**
   * True if domChanges hit the 200-entry cap.
   * Measures mutation volume — separate from thread blocking.
   */
  highChurnMode: boolean;

  /** Longest MutationObserver callback duration in milliseconds. */
  longestBatchMs: number;

  /** Total number of mutation batches in this window. */
  totalBatches: number;
}
```

---

## 4. Observation Lifecycle

### 4.1 Event-Trigger Matrix (Resolves H2, V-R1)

EventTap at `3bc28f6` registers 12 event types: `click`, `mousedown`,
`contextmenu`, `focus`, `blur`, `input`, `change`, `mouseenter`, `mouseleave`,
`mousemove`, `keydown`, `scroll`. **`submit` is NOT registered** and must be
added (see §4.1 note below).

The matrix below defines which events open evidence windows and which are
capture-only.

| EventTap Event | Triggers Evidence Window? | Rationale |
|---|---|---|
| `click` | ✅ Yes — standard | Primary interaction; opens full dual-scope window |
| `mousedown` | ✅ Yes — standard | Drag start, context menu trigger, custom widget activation |
| `contextmenu` | ✅ Yes — standard | Right-click menu; may open a custom context menu |
| `input` | ✅ Yes — **extend** (see §4.6) | Typing; uses extend-on-input model, not new windows |
| `change` | ✅ Yes — standard | Select/radio/checkbox change |
| `keydown` | ⚠️ Yes — **only Enter** | Enter submits forms / activates buttons. Other keys handled via `input`. |
| `focus` | ✅ Yes — lightweight | Tab navigation; minimal TargetEvidence, short window |
| `blur` | ✅ Yes — lightweight | Focus leaving an element; captures final value |
| `scroll` | ✅ Yes — **throttled** (see §4.7) | Infinite scroll content; throttled 1 window per 500ms |
| `submit` | ❌ **Not registered** | EventTap does NOT register `submit` at 3bc28f6. Adding it is a **new EventTap modification** — see M1 below. |
| `mouseenter` | ❌ No — capture only | EventTap records it for identity/classification, but it does NOT open an evidence window. Mouse hover produces no meaningful state change. |
| `mouseleave` | ❌ No — capture only | Same as mouseenter — capture for classification, no observation window. |
| `mousemove` | ❌ No — capture only | High-frequency noise. Captured by EventTap for coordinate tracking only. |

**Implementation note**: The EvidenceCollector's `onAfterEvent` handler checks
the event type against this matrix. Capture-only events are ignored by the
EvidenceCollector but still flow through EventTap's normal `onEvent` path.

**M1 — EventTap `submit` addition (NEW)**: The `eventTypes` array in
`src/tap/event-tap.ts` (approximately line 300 at `3bc28f6`) does NOT include
`'submit'`. Add `'submit'` to this array. This is one of two modifications to
EventTap (the other is navigation `onAfterEvent` — see §7.2).

**Design decision — `submit` is optional for Phase 1**: If adding `submit` to
EventTap proves complex (form submission semantics, preventDefault handling),
it can be deferred. Enter key on forms is already captured via `keydown`, and
form submission typically triggers a navigation event. `submit` is nice-to-have
for explicit form-submit evidence but not blocking.

### 4.2 When Observation Opens

The window opens in EventTap's `onAfterEvent` callback for events marked ✅ in
the matrix above.

**SC-2 / V-R1 RESOLUTION — Wiring `onAfterEvent`**: At `3bc28f6`,
`recorder-entry.ts` creates EventTap with `{ onEvent }` only (line 222-224).
The `onAfterEvent` callback is defined in EventTap's config interface
(`src/tap/event-tap.ts` line 56) and fires from `handleRawEvent` (lines 196-198),
but recorder-entry.ts does NOT pass it. Implementation must add `onAfterEvent`
to the `createEventTap` call in `recorder-entry.ts`.

**Window-open sequence**:

1. **Take identity** from the ObservedEvent — already extracted by EventTap's
   `extractIdentity()` call and present on `event.target` (ElementIdentity,
   18 fields). No re-extraction needed. (Resolves C3, V-R2, V-R3.)
2. **Peek TargetStateCache** for the `before` snapshot
3. **Start DOMObserver** (refcounted, recursive shadow DOM — see §5)
4. **Arm AdaptiveWindow** (stabilization timer + hard cap — see §4.3)
5. **Network/nav are passive** — network is collected via the MAIN-world bridge
   (§6) which runs during recording; navigation events arrive via EventTap's
   existing navigation emission (§7). No explicit start/stop needed.

### 4.3 Adaptive Window Strategy (Resolves M5)

Replaces the old fixed 3-second window (which was removed at `3bc28f6`).
Uses `setTimeout`-based stabilization, NOT polling (`setInterval`).

```
Window parameters:
  minQuiescence:    300ms   — DOM must be stable for this long before closing
  maxDuration:    10000ms   — hard cap regardless of activity
  minDuration:       50ms   — minimum window lifetime (captures sync effects)
```

**State machine** (setTimeout-based, not polling):

```
Window opens:
  1. Schedule stabilization timer: setTimeout(checkStabilized, minQuiescence)
  2. Schedule max-duration timer: setTimeout(forceClose, maxDuration)

On each MutationObserver callback:
  1. Clear the stabilization timer
  2. Re-schedule: setTimeout(checkStabilized, minQuiescence)
  (max-duration timer is NOT cleared — it's a hard cap)

checkStabilized():
  if (now - openedAt >= minDuration):
    close('stabilized')
  else:
    // Too early — re-schedule for minDuration - elapsed
    setTimeout(checkStabilized, minDuration - (now - openedAt))

forceClose():
  close('max-duration')
```

**Why setTimeout, not setInterval polling (resolves M5)**:
- No wasted timer callbacks when DOM is quiet
- Stabilization is event-driven (reset on mutations), not polled
- Stability samples are pushed to `stabilityTrace` at each timer fire + each
  mutation batch, not on a fixed interval

**Stability trace population**: A `StabilitySample` is pushed to the trace:
- On each stabilization timer fire (records quiescence period)
- On each mutation batch (records active period)
- Circular buffer capped at 50 entries

### 4.4 When Observation Closes

1. **Read target element** → capture `after` TargetStateSnapshot
2. **Read focus** → capture FocusMovement
3. **Stop DOMObserver** (decrement refcount)
4. **Clear timers** (stabilization + max-duration)
5. **Collect network activity** from the bridge buffer for this window's time range
6. **Collect navigation events** from EventTap's navigation event stream for this window's time range
7. **Summarize mutations** → group by target, apply 200-cap (keep first 200), compute overflow
8. **Detect surfaces** → identify newSurfaces and removedSurfaces from childList mutations
9. **Detect visibility changes** → filter display/visibility/opacity/hidden/aria-hidden
10. **Build BehavioralEvidence** → assemble final structure with global batch indices
11. **Deliver** → send to service worker via `BEHAVIORAL_EVIDENCE` message

### 4.5 Concurrent Windows and Shared Batch Counter (Resolves H1, V-R18)

Multiple observation windows can be open simultaneously (rapid user actions).

**Shared batch counter**:

The DOMObserver (NEW — does not exist at `3bc28f6`) maintains a SINGLE global
batch counter shared across all concurrent windows. Each MutationObserver
callback increments this counter once. All active windows record the same
batch index value for the same physical mutation batch.

```typescript
// In DOMObserver (shared singleton — NEW, must be built from scratch)
private globalBatchCounter = 0;

private onMutations = (records: MutationRecord[]): void => {
  const batchIndex = this.globalBatchCounter++;
  const now = performance.now();

  // Distribute to all active windows
  for (const window of this.activeWindows) {
    window.processMutations(records, batchIndex, now);
  }
};
```

**Why shared, not per-window**:
- `batchIndex=5` means the same thing regardless of which window observed it
- Cross-window timing correlation is reliable (the correlation layer can compare windows)
- No ambiguity when two overlapping windows see the same mutation

**Concurrent window rules**:
- The DOMObserver is **refcounted** — starts on first window, stops on last window close
- Mutations are attributed to **all active windows** at capture time
- **Max concurrent windows**: 5. If a 6th interaction occurs, the oldest open window is force-closed with `endReason: 'displaced'` before opening the new one.

### 4.6 Typing Strategy — Extend-on-Input (Resolves H3)

Typing is one of the most common interactions. Each keystroke must NOT open a
new evidence window. Instead:

**Extend-on-input model**:

1. First `input` event on a text element with no open window → **open window**
   - `sourceEventType = 'input'`
   - `before` snapshot captures the pre-typing state (e.g., `value = ""`)
2. Subsequent `input` events on the same element → **extend** the current window
   - Reset the stabilization timer (user is still typing)
   - Do NOT create a new window
   - Do NOT re-capture `before` snapshot
3. When typing stops for `minQuiescence` (300ms) → **close with `endReason: 'typing-complete'`**
   - `after` snapshot captures the final typed value (e.g., `value = "laptop"`)

**Result**: ONE BehavioralEvidence per typing session, with:
- `before.value = ""`, `after.value = "laptop"`
- Any network activity from search-as-you-type (debounced server calls)
- Any DOM mutations from autocomplete suggestion rendering

**Detection**: EvidenceCollector tracks `activeTypingTarget: Element | null`.
If an `input` event arrives and `event.target === activeTypingTarget`, extend.
Otherwise, open a new window (different text field).

### 4.7 Scroll Strategy — Throttled Lightweight (Resolves H4)

Scroll produces no meaningful TargetEvidence, but may load new content
(infinite scroll).

**Throttled scroll observation**:

1. `scroll` event → open window ONLY if no scroll window has been opened in the last 500ms
2. `targetEvidence` is minimal — `before`/`after` snapshots are null or reflect the scroll container's scrollTop
3. The adaptive window's stabilization logic handles this naturally:
   - If scroll doesn't produce DOM mutations → window closes after `minQuiescence` (300ms) with near-empty evidence
   - If scroll loads new content → mutations keep the window open, ApplicationEvidence captures the new surfaces
4. `sourceEventType = 'scroll'`

**Throttling**: The EvidenceCollector enforces `minScrollInterval = 500ms`.
If a scroll window is still open when a new scroll arrives, the existing
window's stabilization timer is reset (extend, like typing).

---

## 5. DOM Observation Strategy

### 5.1 Recursive Shadow DOM Traversal (V-R12)

The DOMObserver must see inside shadow roots. No DOM observation infrastructure
exists at `3bc28f6` — the old `document-observer.ts` was removed. This is
entirely new code.

```
attachObservers(root, shadowPath = null):
  observe(root, { childList, attributes, characterData,
                  subtree: true, attributeOldValue,
                  characterDataOldValue })

  // Walk into shadow roots
  for each element in root.querySelectorAll('*'):
    if element.shadowRoot:
      childShadowPath = shadowPath
        ? `${shadowPath} > ${cssPath(element)}`
        : cssPath(element)
      attachObservers(element.shadowRoot, childShadowPath)
      registerShadowHost(element, childShadowPath)
```

**Re-scan on mutations**: When a childList mutation adds elements, check if any
new element has a `shadowRoot`. If so, attach observers to it.

**Cap**: Maximum 20 shadow roots observed concurrently. If exceeded, log a
`performanceCondition` warning and skip further shadow roots.

**Refcounting**: All shadow root observers share the refcount of their parent
DOMObserver. Start increments all; stop decrements all.

**Inherent limitation — closed shadow roots**: Elements with `shadowRoot === null`
due to `mode: 'closed'` cannot be observed. This is a fundamental browser
security boundary. The EvidenceCollector records `shadowDom: true` (from
IdentityExtractor) but cannot capture mutations inside closed roots. The
correlation layer must account for this gap.

### 5.2 Mutation Summarization Pipeline

**Stage 1: Filter** (at MutationObserver callback time)

Exclude mutations that are pure noise:
- Attribute changes to `class` or `style` where the element also has an active CSS animation or transition
- childList mutations on elements with `role="row"` or `role="gridcell"` in a container with > 100 children (virtual scrolling)
- characterData mutations on `<script>` or `<style>` tags

**Stage 2: Summarize** (at MutationObserver callback time)

Group mutations by `targetPath + shadowContext`:
- Collapse all mutations on the same element into one `DomChangeSummary`
- Merge attribute changes: `{ class: {old: 'btn', new: 'btn active'} }`
- Sum childList: `addedNodesCount += N; removedNodesCount += N`
- Track `firstMutationAt`, `lastMutationAt`, `firstBatchIndex`, `lastBatchIndex`
- Track `rawMutationCount` for auditability

**Stage 3: Cap** (at window close — resolves C4)

- If `domChanges.length > 200`:
  - **KEEP the first 200 entries** (earliest = most likely action-caused)
  - Set `coarseMode = true`
  - Set `domChangeOverflow = (total collected - 200)`
  - Set `performanceCondition.highChurnMode = true`
  - Continue tracking `newSurfaces`, `removedSurfaces`, `navigation`, and `networkActivity` regardless
  - The most important signals (surface appearance, navigation, network) survive even on extremely heavy pages

### 5.3 Global Batch Index Tracking (Resolves H1)

(See §4.5 for the code pattern. The DOMObserver singleton holds
`globalBatchCounter`, incremented once per MutationObserver callback and
distributed to all active windows.)

**What global batchIndex tells the correlation layer**:
- `batchIndex === N` for window A and `batchIndex === N` for window B → same physical MutationObserver callback
- Low batch indices within a window's time range → early mutations (likely action-caused)
- High batch indices → later mutations (likely async/timer/network-driven)
- The correlation layer computes its own classifications. The evidence model never labels.

---

## 6. Network Interception (Resolves C1, SC-4, SC-4b, SC-5)

### 6.1 The Problem

The content script at `3bc28f6` runs in Chrome's **ISOLATED world** (manifest
`content_scripts` entry does not specify `"world"`). In isolated world,
`window.fetch` and `window.XMLHttpRequest` are separate copies from the page's
versions. Monkeypatching them intercepts only the content script's own calls,
not the page's network requests.

### 6.2 SC-4 Resolution: Dynamic MAIN-World Injection

**PRIMARY mechanism — dynamic `chrome.scripting.executeScript`**:

Instead of relying on a static manifest `content_scripts` entry with
`"world": "MAIN"` (which depends on unverified @crxjs/vite-plugin compatibility),
the service worker dynamically injects the network interceptor into the MAIN
world at recording start:

```typescript
// In service-worker.ts handleStartRecording():
async function injectNetworkInterceptor(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['assets/network-inject.js'],  // pre-built standalone bundle
      injectImmediately: true,
    });
    return true;
  } catch (e) {
    console.warn('[NetworkTap] MAIN-world injection failed:', e);
    return false;
  }
}
```

**Why dynamic injection over static manifest entry (SC-4 decision)**:
- ✅ `chrome.scripting.executeScript({ world: 'MAIN' })` is a proven, documented MV3 API
- ✅ The `scripting` permission ALREADY EXISTS at `3bc28f6` (no manifest change for scripting)
- ✅ No dependency on @crxjs/vite-plugin supporting `"world": "MAIN"` in manifest processing
- ✅ Injection is controlled — only active during recording, cleaned up on stop
- ✅ `injectImmediately: true` minimizes the race window (see §6.3)

**Build requirement**: The network interceptor (`network-inject.js`) must be a
**standalone bundle** (no imports from the extension's source tree) because it
runs in the page's MAIN world, not the extension's context. Build it as a
separate Vite entry or a standalone esbuild target that emits to
`dist/assets/network-inject.js`.

**Inter-world communication contract**:

The MAIN-world script communicates with the ISOLATED-world NetworkBridge
via `CustomEvent` on `window` (shared between MAIN and ISOLATED worlds in
the same renderer process):

```
MAIN world → ISOLATED world:
  window.dispatchEvent(new CustomEvent('cmdrunner-net', {
    detail: {
      url: '/api/search?q=laptop',
      method: 'GET',
      timestamp: performance.now(),  // shared clock (same page, same process)
      phase: 'start' | 'complete',
      status: number | null          // null for 'start'
    }
  }));
```

The ISOLATED-world `NetworkBridge` listens for these events and buffers them.
At window close, EvidenceCollector reads from the buffer for entries within
`[openedAt, closedAt]`.

**IMPORTANT**: `performance.now()` is shared between MAIN and ISOLATED worlds
(they run in the same renderer process). Timing correlation is exact.

**MAIN-world "ready" signal**: The injected script posts
`window.dispatchEvent(new CustomEvent('cmdrunner-net-ready'))` immediately
after patching. The ISOLATED-world bridge listens for this to confirm
MAIN-world interception is active. If not received within 500ms of injection
call, the bridge falls back to webRequest-only mode.

### 6.3 SC-4b Resolution: Race Condition and Parallel webRequest

**The race**: Between `handleStartRecording` calling `executeScript` and the
script actually patching `fetch`/`XHR` in the page context, page JavaScript
may issue network requests that go unintercepted.

**Mitigation — parallel webRequest from recording start**:

`chrome.webRequest` listeners are registered in the service worker
IMMEDIATELY when recording starts — BEFORE the dynamic injection call.
They run in parallel with the MAIN-world interceptor for the entire
recording session, not just as a CSP fallback:

```typescript
// In service-worker.ts handleStartRecording():
function startNetworkObservation(tabId: number): void {
  // 1. Immediately register webRequest listeners (covers race window)
  chrome.webRequest.onBeforeRequest.addListener(
    onRequestStarted,
    { tabId, urls: ['http://*/*', 'https://*/*'] }
  );
  chrome.webRequest.onCompleted.addListener(
    onRequestCompleted,
    { tabId, urls: ['http://*/*', 'https://*/*'] }
  );

  // 2. Inject MAIN-world interceptor (better metadata, may miss early calls)
  injectNetworkInterceptor(tabId);

  // Both sources run in parallel for the full recording session
}
```

**Deduplication**: The EvidenceCollector receives network activity from both
sources. When the same URL + method + approximate timestamp appears from both,
it keeps the `'main-world'` source (richer metadata: exact `resourceType`,
precise timing) and drops the `'webrequest'` duplicate. If only `webrequest`
captured it (race window or CSP-blocked injection), the `'webrequest'` entry
is kept with `resourceType: 'unknown'`.

**Restoral at recording stop**:
- MAIN-world script: the injected code stores references to original `fetch`
  and `XMLHttpRequest.prototype.open/send` and restores them. The service
  worker sends a `'stop'` message via CustomEvent to trigger restoral.
- webRequest listeners: `chrome.webRequest.onBeforeRequest.removeListener()`
  and `onCompleted.removeListener()` in the service worker.

### 6.4 What Is Captured

| Field | MAIN-world | webRequest |
|---|---|---|
| `url` | ✅ | ✅ |
| `method` | ✅ | ✅ |
| `status` | ✅ (from Response) | ✅ (from onCompleted) |
| `startRelativeToEvent` | ✅ | ✅ |
| `endRelativeToEvent` | ✅ | ✅ |
| `durationMs` | ✅ | ✅ |
| `resourceType` | 'fetch' or 'xhr' | 'unknown' |
| `source` | 'main-world' | 'webrequest' |

### 6.5 What Is NOT Captured

- Request bodies (privacy + size)
- Response bodies (privacy + size)
- Response headers
- WebSocket messages
- EventSource (SSE) data streams

### 6.6 Cap

Max 50 network activity entries per evidence window. If exceeded, keep the
first 50 (earliest requests are most likely to be action-caused).

### 6.7 SC-5 Resolution: webRequest Permission

**Manifest change required**: Add `"webRequest"` to `permissions` array in
`src/manifest.json`:

```json
"permissions": ["sidePanel", "storage", "unlimitedStorage", "activeTab",
                 "webNavigation", "tabs", "scripting", "alarms", "webRequest"]
```

**UX note**: MV3 `webRequest` is observational-only (no blocking/interception
of requests — that requires `webRequestBlocking`, which is NOT needed and
NOT requested). Chrome does not prompt users for new permissions on extension
updates when the host permissions already cover the request URLs. Since
`http://*/*` and `https://*/*` are already in `host_permissions`, adding
`webRequest` is silently granted. However, the extension's Chrome Web Store
listing and privacy policy should disclose that network request metadata
(URL, method, status, timing) is observed during recording sessions.

**No `webRequestBlocking` needed**: This system observes requests only — it
does not modify, block, or redirect them. `webRequestBlocking` (which has
strict MV3 restrictions) is not required.

---

## 7. SPA Navigation Detection (Resolves C2, V-R5, SC-2)

### 7.1 Reuse Existing EventTap Navigation

EventTap (`src/tap/event-tap.ts`) at `3bc28f6` already:
- Patches `history.pushState`
- Patches `history.replaceState`
- Listens for `popstate`
- Listens for `hashchange`
- Emits `ObservedEvent` with `eventType: 'navigation'` and `pageUrl`/`pageTitle`

**The EvidenceCollector does NOT re-patch the History API.** It consumes
EventTap's existing navigation events.

### 7.2 SC-2 Resolution: Navigation Events Must Fire `onAfterEvent`

**The problem at `3bc28f6`**: EventTap's `emitSpaNavigation()` method emits
navigation events through the `onEvent` callback only. The `onAfterEvent`
callback — which the EvidenceCollector hooks into — is called from
`handleRawEvent()` (line 196-198) for DOM events but is **NOT** called from
`emitSpaNavigation()`. Navigation events bypass the evidence hook point.

**Fix — modify EventTap's `emitSpaNavigation()`**:

Add a call to `config.onAfterEvent` at the end of `emitSpaNavigation()`,
mirroring how `handleRawEvent` fires it:

```typescript
// In event-tap.ts emitSpaNavigation(), after emitting via onEvent:
if (config.onAfterEvent) {
  config.onAfterEvent(
    null,               // no real DOM element for synthetic nav events
    observedEvent.eventId,
    'navigation',
    null                // no CSS selector for synthetic nav events
  );
}
```

This is the second of two EventTap modifications (the first is the optional
`submit` event type addition in §4.1).

**What this enables**: When a navigation event occurs during an open evidence
window, the EvidenceCollector's `onAfterEvent` handler fires, and the window
is force-closed with `endReason: 'navigation'`. The `NavigationEvidence` entry
is recorded with timing relative to the window.

### 7.3 How EvidenceCollector Gets Navigation Evidence

1. EventTap's `onAfterEvent` fires for `eventType === 'navigation'` (after §7.2 fix)
2. EvidenceCollector records a `NavigationEvidence` entry:
   ```
   {
     type: derived from the navigation ObservedEvent,
     fromUrl: previous pageUrl (tracked by EvidenceCollector),
     toUrl: navigation event's pageUrl,
     relativeTime: now - window.openedAt,
     batchIndex: current global batch index
   }
   ```
3. If a navigation event arrives during an open window, the window is force-closed
   with `endReason: 'navigation'`

**Determining navigation type**: EventTap's `emitSpaNavigation()` does not
currently distinguish between pushState, replaceState, hashchange, and popstate.
The EvidenceCollector can infer the type:
- If `onAfterEvent` fires with `eventType === 'navigation'` AND EventTap's
  patched `pushState` was called → `type: 'pushState'`
- If `replaceState` → `type: 'replaceState'`
- If `popstate` listener fired → `type: 'popstate'`
- If `hashchange` listener fired → `type: 'hashchange'`

**Implementation note**: EventTap's `emitSpaNavigation()` can be enhanced to
include the trigger type as a field on the ObservedEvent. This is a minor
addition to EventTap — adding a `navType` property to the navigation event.
Alternatively, EvidenceCollector can track which listener fired by wrapping
the EventTap callbacks. The spec recommends the minor EventTap enhancement.

### 7.4 Full Page Navigation

A `pagehide` event indicates a full page navigation. When detected:
- Force-close the current evidence window with `endReason: 'navigation'`
- Record a `NavigationEvidence` entry with `type: 'full-reload'`
- Flush the behavioral buffer

---

## 8. Element Identity Strategy (Resolves C3, SC-3, V-R2)

### 8.1 Reuse Existing IdentityExtractor

The existing `identity-extractor.ts` (504 LOC) at `3bc28f6` already extracts a
complete 18-field `ElementIdentity` (defined in `src/shared/types.ts`):

| Field | Source |
|---|---|
| `accessibleName` | 10-tier cascade (aria-label → aria-labelledby → label → textContent → title) |
| `ariaRole` | Explicit role attr or implicit role mapping |
| `ariaLabel` | `getAttribute('aria-label')` |
| `ariaLabelledBy` | `getAttribute('aria-labelledby')` |
| `placeholder` | `getAttribute('placeholder')` or `getAttribute('aria-placeholder')` |
| `tag` | `el.tagName` |
| `className` | `el.className` |
| `name` | `getAttribute('name')` |
| `stableId` | `el.id` |
| `testId` | `getAttribute('data-testid')` |
| `dataCy` | `getAttribute('data-cy')` |
| `dataQa` | `getAttribute('data-qa')` |
| `cssSelector` | Generated CSS selector |
| `xPath` | Generated XPath |
| `inIframe` | Boolean |
| `shadowDom` | Boolean |
| `href` | `getAttribute('href')` |
| `elementId` | Background-assigned sequential ID (e.g., "elem-0001") |

Plus optional `iframeContext: IframeContext` (7 fields) when `inIframe` is true.

**The EvidenceCollector does NOT re-extract identity.** It takes the
`identity` directly from the `ObservedEvent.target` field, which EventTap
already populates via `extractIdentity(targetEl)` at event capture time.

### 8.2 SC-3 Resolution: `inputType` Is a NEW Field

**The v2.0 spec listed `inputType` as an existing field on ElementIdentity.
This was incorrect — `inputType` does NOT exist in `RawElementIdentity` or
`ElementIdentity` at `3bc28f6` (or at `deff878`). It has never been implemented.**

The `getImplicitRole()` function in `identity-extractor.ts` reads `el.type`
internally for role mapping but does not surface it as a field.

**Change required (NEW addition)**: Add `inputType: string | null` to
`RawElementIdentity` in `src/shared/types.ts` and populate it in
`extractIdentity()` in `identity-extractor.ts`:

```typescript
// In identity-extractor.ts extractIdentity():
inputType: (el instanceof HTMLInputElement ||
            el instanceof HTMLSelectElement ||
            el instanceof HTMLTextAreaElement)
  ? (el as HTMLInputElement).type ?? null
  : null,
```

This is needed for the generation layer to distinguish
`getByRole('checkbox')` from `getByRole('textbox')`.

**Impact**: Adding a field to `RawElementIdentity` means every call to
`extractIdentity()` must populate it. All existing tests that construct
mock `ElementIdentity` objects must add the field (or use a helper).
This is a mechanical but wide-reaching change.

### 8.3 Ranking for Generation (unchanged from v2.0)

The generation layer (IR Bridge, Playwright generator) ranks identity strategies:

| Priority | Strategy | Playwright Locator |
|---|---|---|
| 1 | `testId` | `getByTestId('industry-filter')` |
| 2 | `ariaRole` + `accessibleName` | `getByRole('button', { name: 'Industry' })` |
| 3 | `stableId` | `page.locator('#industry-btn')` |
| 4 | `cssSelector` | `page.locator('div.filters > button:nth-of-type(3)')` |
| 5 | `accessibleName` (text-based) | `page.getByText('Industry')` |

---

## 9. Evidence Lifecycle and Attachment Timing (Resolves SC-1, V-R8, V-R15, V-R19)

### 9.1 The Core Problem

At `3bc28f6`, the pipeline works as follows:
1. EventTap captures events in the content script
2. Events are sent to the SW via `OBSERVED_EVENT` messages
3. ComponentRuntime in the SW classifies events into `ComponentInteraction` objects
4. Interactions are emitted via `onEmit` callback and stored in `liveInteractions` in SW memory
5. At `stopRecording`, `persistSession` serializes interactions and writes to Dexie

**Observation windows close asynchronously** (300ms–10s after the triggering
event). Evidence is NOT available when the interaction is first emitted.
This means evidence cannot be attached at emission time.

### 9.2 SC-1 Resolution: Deferred In-Memory Attachment

**The EvidenceCollector in the content script sends evidence to the SW via
`BEHAVIORAL_EVIDENCE` messages. The SW stores evidence in a `pendingEvidence`
Map keyed by `sourceEventId`.**

**SW handler**:
```typescript
// In service-worker.ts:
private pendingEvidence: Map<string, BehavioralEvidence> = new Map();

function handleBehavioralEvidence(evidence: BehavioralEvidence): void {
  // 1. Store in pending map (SC-1 deferred attachment)
  pendingEvidence.set(evidence.sourceEventId, evidence);

  // 2. If matching interaction already exists in liveInteractions, attach now
  const interaction = liveInteractions.find(
    i => i.triggerEvent.eventId === evidence.sourceEventId
  );
  if (interaction) {
    interaction.behavioralEvidence = evidence;
    // 3. Broadcast to side panel for live display
    broadcastEvidenceUpdate(evidence);
  }
  // If no matching interaction yet, evidence stays in pendingEvidence.
  // It will be matched at persistence time (step 4 below) or when the
  // interaction is emitted later.

  // 4. Cap: if pendingEvidence exceeds 100 entries, drop oldest
  if (pendingEvidence.size > 100) {
    const oldest = pendingEvidence.keys().next().value;
    pendingEvidence.delete(oldest);
  }
}
```

**At `stopRecording` (session persistence)**:
```typescript
// In session-persistence-service.ts persistSession():
function persistSession(interactions, pendingEvidence): void {
  // 1. For each interaction, attach its evidence if available
  for (const interaction of interactions) {
    const eventId = interaction.triggerEvent.eventId;
    const evidence = pendingEvidence.get(eventId);
    if (evidence) {
      interaction.behavioralEvidence = evidence;
    }
    // evidence may be undefined if window was still open or message was lost
  }

  // 2. Persist interactions to Dexie (without inline evidence — see §11.6)
  // 3. Persist each interaction's evidence to behavioral_evidence table (§11.6)
  // 4. Clear pendingEvidence
}
```

**Why deferred attachment (not two-pass or separate persistence)**:
- ✅ Matches the proven pattern from the old system (pendingBehavioralEffects Map)
- ✅ Evidence attaches as soon as the interaction is available — no artificial delay
- ✅ At persistence time, any remaining unmatched evidence is swept
- ✅ Side panel gets live updates as evidence arrives (not waiting for stopRecording)
- ✅ Simple mental model: evidence lives in a Map until consumed

### 9.3 SC-1 / V-R8 Resolution: ComponentInteraction Field

At `3bc28f6`, the `ComponentInteraction` interface in `src/shared/component-types.ts`
has an **orphaned comment block** (approximately lines 450-455):

```typescript
  // ── M1: Behavioral Observations ──────────────────────────────────────
  //
  // Populated by the observation pipeline (Phase D). Optional because not
  // all code paths go through the observation system (existing tests,
  // events captured before coordinator was configured).

  /** M1: Behavioral observations from the observation coordinator. */

}
```

The `behavioralObservations?: ObservationResult[]` field was removed at `3bc28f6`
but the comment remains. **Implementation must remove this orphaned comment and
add the new field:**

```typescript
  // ── Behavioral Evidence ──────────────────────────────────────────────
  //
  // Populated by the deferred-attachment pipeline (§9.2). Optional because
  // evidence arrives asynchronously after the interaction is emitted, and
  // some interactions may never receive evidence (window lost, race, etc.).

  /** Dual-scope behavioral evidence (TargetEvidence + ApplicationEvidence). */
  behavioralEvidence?: BehavioralEvidence;
```

### 9.4 V-R15 Resolution: SW Restart Recovery

The old durable recovery mechanism (`recoverDurableObservations` in the removed
`sw-integration.ts`) was deleted. MV3 service workers can be killed and
restarted at any time. Evidence in `pendingEvidence` Map is lost on restart.

**Recovery strategy**: Content-script-side sessionStorage buffer (mirrors the
existing event buffer pattern at `3bc28f6` — `BUFFER_KEY = 'cmdrunner_event_buffer'`
in recorder-entry.ts):

```
// In EvidenceCollector (content script):
// After sending BEHAVIORAL_EVIDENCE to SW, also buffer in sessionStorage
const EVIDENCE_BUFFER_KEY = 'cmdrunner_evidence_buffer';
const MAX_BUFFERED = 50;

function bufferEvidence(evidence: BehavioralEvidence): void {
  const raw = sessionStorage.getItem(EVIDENCE_BUFFER_KEY);
  const buffer = raw ? JSON.parse(raw) : [];
  buffer.push(evidence);
  if (buffer.length > MAX_BUFFERED) buffer.shift();
  sessionStorage.setItem(EVIDENCE_BUFFER_KEY, JSON.stringify(buffer));
}

// On recording start (recorder-entry.ts):
// Flush buffered evidence to SW (in case SW restarted between sessions)
function flushPendingEvidence(): void {
  const raw = sessionStorage.getItem(EVIDENCE_BUFFER_KEY);
  if (!raw) return;
  const buffer = JSON.parse(raw);
  for (const evidence of buffer) {
    chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EVIDENCE', payload: evidence });
  }
  sessionStorage.removeItem(EVIDENCE_BUFFER_KEY);
}
```

**This does NOT use `chrome.storage.local`** (no `cmdrunner_obs_*` keys). It
uses `sessionStorage` which is page-scoped and cleared on page navigation.
The buffer is only for SW restart recovery within the same page session.

---

## 10. Memory and Performance Limits

### 10.1 Per-Window Caps (Resolves C4)

| Resource | Cap | Behavior When Exceeded |
|---|---|---|
| `domChanges[]` | 200 entries | **Keep first 200** (earliest = most relevant). Set `coarseMode=true`, `domChangeOverflow=N`. |
| `newSurfaces[]` + `removedSurfaces[]` | 30 entries each | Keep first 30, drop the rest |
| `visibilityChanges[]` | 50 entries | Keep first 50 |
| `networkActivity[]` | 50 entries | Keep first 50 |
| `stabilityTrace[]` | 50 samples | Circular buffer |
| `navigation[]` | 10 entries | Keep first 10 |
| Concurrent windows | 5 | Force-close oldest with `endReason: 'displaced'` |

### 10.2 Per-Session Caps

| Resource | Cap | Behavior When Exceeded |
|---|---|---|
| Pending evidence in SW (awaiting interaction correlation) | 100 entries | Drop oldest, log warning |
| Behavioral evidence buffer (sessionStorage) | 50 entries max | Drop oldest |

### 10.3 Performance Budget

| Operation | Budget | Measurement |
|---|---|---|
| MutationObserver callback | 15ms per batch | If exceeded, set `performanceCondition.mainThreadBlocked = true` |
| Identity capture | 0ms | Already captured by EventTap — no additional work |
| Network interceptor overhead (MAIN-world) | <1ms per request | Monkeypatch + CustomEvent dispatch |
| Network interceptor overhead (webRequest) | <0.5ms per request | SW-side listener |
| Window close summarization | 10ms | Group, cap, assemble |
| Shadow root scanning | 2ms per root | `querySelectorAll('*')` + `shadowRoot` check |

### 10.4 No chrome.storage.local for Raw Evidence

Evidence lives on `ComponentInteraction.behavioralEvidence` in-memory.
No `cmdrunner_obs_*` durable keys.

**Buffer resilience** (MV3 SW restart): sessionStorage buffer (max 50 entries).

---

## 11. Multi-Level Interaction Handling

### 11.1 Principle: Composition

Multi-level dropdowns, cascading filters, and wizard flows are sequences of
independent evidence captures. No special observers.

```
Action 1: Click "Filters"
  TargetEvidence: button "Filters" ariaExpanded false→true
  ApplicationEvidence: filter surface appeared (newSurface, batchIndex=0)

Action 2: Click "Industry"
  TargetEvidence: button "Industry" ariaExpanded false→true
  ApplicationEvidence: submenu appeared (newSurface, batchIndex=0)

Action 3: Click "Technology"
  TargetEvidence: option "Technology" selected false→true
  ApplicationEvidence: next submenu appeared (newSurface, batchIndex=0)

Action 4: Click "Software"
  TargetEvidence: option "Software" selected false→true
  ApplicationEvidence: selection result changed (domChange, batchIndex=0)
```

### 11.2 Overlapping Windows

Windows may overlap (rapid clicking). Each captures independently. The
DOMObserver is refcounted. Mutations are attributed to all active windows.
The shared batch counter ensures cross-window timing comparability.

### 11.3 No Action Grouping

Each `BehavioralEvidence` is for exactly one interaction. Grouping and
composition is the future correlation/semantic layer's responsibility.

---

## 12. Integration Points

### 12.1 ComponentInteraction (Modified Field — V-R8, SC-7)

```typescript
interface ComponentInteraction {
  // ... existing fields (trigger, triggerEvent, memberEvents, startTime,
  //     endTime, endState, metadata, componentType, componentFramework,
  //     businessMeaning) ...

  /**
   * Behavioral evidence for this interaction.
   * One BehavioralEvidence per interaction (1:1).
   * Populated by deferred-attachment pipeline (§9.2).
   *
   * SC-7: The orphaned "M1: Behavioral Observations" comment block
   * at this location in 3bc28f6 must be removed when adding this field.
   */
  behavioralEvidence?: BehavioralEvidence;
}
```

### 12.2 Message Type (New — V-R7, V-R23)

```typescript
// In types.ts AppMessage union (at 3bc28f6, union has: START_RECORDING,
// STOP_RECORDING, OPEN_SETTINGS, OPEN_REPOSITORY, RUN_TEST, PING, OBSERVED_EVENT)
| { type: 'BEHAVIORAL_EVIDENCE'; payload: BehavioralEvidence }
```

Also add for side panel live updates:
```typescript
| { type: 'INTERACTION_EVIDENCE_UPDATE'; payload: { eventId: string; evidence: BehavioralEvidence } }
```

### 12.3 Service Worker Handler

```
case 'BEHAVIORAL_EVIDENCE':
  handleBehavioralEvidence(payload)
    → store in pendingEvidence Map<eventId, BehavioralEvidence>
    → if matching interaction in liveInteractions: attach + broadcast
    → NO chrome.storage.local write (in-memory only — see §9.4 for buffer)

At stopRecording:
  persistSession flushes pendingEvidence → Dexie behavioral_evidence table
```

### 12.4 Side Panel Display (V-R16)

At `3bc28f6`, the old `behavioral-renderer.ts` (454 LOC) was deleted.
A new `evidence-renderer.ts` module must be created (different name, different
types — clean-slate mandate). The side panel renders two sections under each
interaction:
1. **Target** — identity, before→after state, focus movement
2. **Application** — summarized DOM changes, surfaces, navigation, network

The `INTERACTION_EVIDENCE_UPDATE` message overlays fresh evidence onto matching
interactions for live display (replaces the old `INTERACTION_EFFECTS_UPDATE`
handler that was removed).

Dead HTML/CSS elements from the old behavioral display remain in
`src/sidepanel/index.html` at `3bc28f6` (e.g., `capability-records-section`).
These should be cleaned during implementation.

### 12.5 What Changes vs What Does NOT Change

| System | Status | Notes |
|---|---|---|
| **EventTap** | **MODIFIED** (2 changes) | (1) Add `'submit'` to eventTypes array — optional for Phase 1 (§4.1). (2) Add `onAfterEvent` call to `emitSpaNavigation()` (§7.2). Add `navType` to navigation events (§7.3). |
| **IdentityExtractor** | **MODIFIED** (1 change) | Add `inputType` field to ElementIdentity (§8.2 — NEW field, not existing). |
| **recorder-entry.ts** | **MODIFIED** | Wire `onAfterEvent` into `createEventTap` call (line 222). Create EvidenceCollector. Wire EventTap onEvent to EvidenceCollector for nav events. |
| **service-worker.ts** | **MODIFIED** | Add `BEHAVIORAL_EVIDENCE` handler. Add network observation start/stop. Add `webRequest` listeners. Add `pendingEvidence` Map. |
| **component-types.ts** | **MODIFIED** | Remove orphaned M1 comment. Add `behavioralEvidence?: BehavioralEvidence` field. |
| **types.ts** | **MODIFIED** | Add `BEHAVIORAL_EVIDENCE` and `INTERACTION_EVIDENCE_UPDATE` to AppMessage union. |
| **manifest.json** | **MODIFIED** | Add `"webRequest"` to permissions. |
| **session-persistence-service.ts** | **MODIFIED** | Flush pendingEvidence → Dexie at persistSession. |
| **dexie-database.ts** | **MODIFIED** | Add V4 schema with behavioral_evidence table. |
| ComponentRuntime / Classification | Unchanged | Zero imports from evidence types |
| EvidenceLedger | Unchanged | |
| 14 component definitions | Unchanged | |
| IR Bridge | Unchanged initially | Future phase adds evidence consumption |
| Playwright generation | Unchanged initially | |
| Healing service | Unchanged | |
| Enrichment layer | Unchanged | |

### 12.6 SC-6 Resolution: Evidence Persistence Scope

**Decision**: The `behavioral_evidence` Dexie table is for **long-term
queryable persistence** — evidence is stored per interaction and survives
across sessions. It is NOT session-scoped or cleared at stopRecording.

**Rationale**: The future Evidence Correlation layer needs to query evidence
independently of interactions. A separate table with foreign keys to
interactions and sessions allows:
- Lazy-loading evidence for a specific interaction
- Cross-session evidence analysis
- Evidence queries without loading full interaction blobs

**New Dexie table (V4 schema)**:
```typescript
// In dexie-database.ts (currently V3 with 8 tables)
this.version(4).stores({
  // V1 tables (must repeat — Dexie requirement)
  projects: 'id, status',
  elements: 'id, projectId, [projectId+pageOrComponent], status',
  testCases: 'id, projectId, *tags, status, priority',
  testCaseVersions: 'id, testCaseId, [testCaseId+versionNumber]',
  sourceArtifacts: 'id, projectId, [projectId+type]',
  executionIRs: 'id, testCaseVersionId',
  // V2 table
  recordingSessions: 'id, projectId',
  // V3 table
  executionRuns: 'id, testCaseVersionId, projectId',
  // V4 new table
  behavioral_evidence: '++id, interactionEventId, sessionId',
});
```

**Index design**:
- `++id` — auto-incrementing primary key (Dexie convention)
- `interactionEventId` — foreign key to the interaction's triggerEvent.eventId
- `sessionId` — foreign key to the recording session

**Each row stores one serialized `BehavioralEvidence` object.**

**At persistence time** (`session-persistence-service.ts`):
- Interactions are stored as before (without behavioralEvidence inline)
- For each interaction with behavioralEvidence, insert a row into behavioral_evidence
- The interaction's behavioralEvidence field is stripped before serialization
  to avoid duplication (evidence lives in the separate table)

**At query time**: The repository lazy-loads evidence via
`behavioral_evidence.where('interactionEventId').equals(eventId)`.

**This is implemented in Phase 8 (production hardening).** Phases 1–7 use
in-memory evidence only (the Dexie table is added but evidence is not yet
persisted; the field on ComponentInteraction carries it through the pipeline).

---

## 13. What This Model Explicitly Does NOT Do

| Capability | Status | Who Does It |
|---|---|---|
| Semantic classification ("state-toggle", "expand-collapse") | ❌ Not here | Future semantic layer |
| Causal attribution ("this mutation was caused by this click") | ❌ Not here | Future correlation layer |
| Confidence scoring | ❌ Not here | Future semantic layer |
| Action grouping ("these 4 clicks form a filter selection flow") | ❌ Not here | Future composition layer |
| Effect interpretation ("what happened") | ❌ Not here | Future interpretation layer |
| Playwright locator generation | ❌ Not here | IR Bridge / generation layer |
| Assertion derivation | ❌ Not here | Future assertion layer |
| Multi-level control detection | ❌ Not here | Future composition layer |
| Determining if a mutation is "significant" | ❌ Not here | Future correlation layer |

---

## 14. Test Strategy

### 14.1 Unit Tests (jsdom — pure functions and data structures)

| Module | Test File | Key Tests |
|---|---|---|
| TargetStateSnapshot capture | `tests/tap/target-state-cache.test.ts` | All 9 properties, null handling, WeakMap lifecycle |
| DOMObserver summarization | `tests/tap/dom-observer.test.ts` | Grouping by target, attribute deltas, childList counting, shared batchIndex assignment, noise filtering |
| AdaptiveWindow | `tests/tap/adaptive-window.test.ts` | Stabilization via setTimeout, max-duration cap, min-duration, concurrent windows, max-5 displacement |
| NetworkInterceptor (MAIN-world) | `tests/tap/network-interceptor.test.ts` | fetch/XHR monkeypatch, CustomEvent dispatch, timing capture, restoral |
| NetworkBridge (ISOLATED) | `tests/tap/network-bridge.test.ts` | CustomEvent listener, buffer management, webRequest fallback detection, deduplication |
| EvidenceCollector | `tests/tap/evidence-collector.test.ts` | Full lifecycle: open→observe→close, cap enforcement, evidence assembly, extend-on-input, scroll throttle |
| DomChangeSummary caps | `tests/tap/dom-change-cap.test.ts` | 200-entry keep-first cap, coarseMode flag, domChangeOverflow count, surface retention |

**jsdom limitations (V-R13)**: Unit tests in jsdom cannot test:
- MutationObserver timing (jsdom fires synchronously, real browser async)
- Real network interception (jsdom has no real network stack)
- Shadow DOM (jsdom support is incomplete)
- `performance.now()` accuracy

**Mitigation**: Unit tests focus on pure functions (summarization, capping,
serialization, deduplication). Timing and DOM-dependent behavior is tested
via real-browser E2E tests (Phase 7).

### 14.2 Integration Tests (require real browser — Phase 7)

| Scenario | Test File | Key Assertions |
|---|---|---|
| Simple toggle (checkbox) | `tests/integration/toggle.test.ts` | TargetEvidence before/after, ApplicationEvidence has 0-1 changes |
| Typing session | `tests/integration/typing.test.ts` | One BehavioralEvidence per session, extend-on-input, before.value="" after.value="laptop" |
| Autocomplete typeahead | `tests/integration/autocomplete.test.ts` | Window stays open during typing, networkActivity from search calls, DOM changes from suggestions |
| Modal open | `tests/integration/modal.test.ts` | newSurface detected, focus movement captured |
| SPA navigation | `tests/integration/spa-nav.test.ts` | NavigationEvidence from EventTap events, window closes on navigation |
| Multi-level dropdown | `tests/integration/multi-level.test.ts` | 4 independent BehavioralEvidence, overlapping windows, shared batchIndex consistency |
| Shadow DOM component | `tests/integration/shadow-dom.test.ts` | Mutations inside shadow root captured with shadowContext set |
| High-churn page (virtual scroll) | `tests/integration/high-churn.test.ts` | domChanges keeps first 200, coarseMode=true, domChangeOverflow>0, surfaces retained |
| Network-driven content | `tests/integration/network-driven.test.ts` | NetworkActivity with timing (main-world source), DOM changes after network completion |
| webRequest fallback | `tests/integration/webrequest-fallback.test.ts` | NetworkActivity with source='webrequest' when MAIN-world injection fails |

### 14.3 Invariants to Test

| ID | Invariant |
|---|---|
| INV-BEHAV-1 | BehavioralEvidence contains no semantic classification, no causal attribution |
| INV-BEHAV-2 | targetEvidence and applicationEvidence are independently capturable |
| INV-APP-1 | No mutation is labeled with a causal category |
| INV-APP-2 | domChanges never exceeds 200 entries; first 200 preserved when cap hit |
| INV-APP-3 | coarseMode and domChangeOverflow are set when 200-cap is exceeded |
| INV-WIN-1 | No window exceeds maxDuration (10000ms) |
| INV-WIN-2 | No more than 5 concurrent windows |
| INV-WIN-3 | batchIndex is shared across concurrent windows (same value for same physical batch) |
| INV-NET-1 | NetworkInterceptor captures url, method, status, timing — never bodies |
| INV-NET-2 | MAIN-world injection detected via "ready" event; webRequest runs in parallel from recording start |
| INV-SHADOW-1 | Mutations inside shadow roots carry a non-null shadowContext |
| INV-CAP-1 | No chrome.storage.local keys are written for raw evidence |
| INV-CAP-2 | No NavWatcher duplicates EventTap's History API patches |
| INV-CAP-3 | ElementIdentity is taken from ObservedEvent.target, not re-extracted |
| INV-TYPING-1 | Typing produces one BehavioralEvidence per session, not per keystroke |
| INV-SCROLL-1 | Scroll windows throttled to max 1 per 500ms |

---

## 15. File Structure (Planned)

```
src/
  tap/
    event-tap.ts                     (MODIFIED — add 'submit' event [optional],
                                         add onAfterEvent to emitSpaNavigation,
                                         add navType to nav events)
    identity-extractor.ts            (MODIFIED — add inputType field [NEW])
    target-state-cache.ts            (NEW — WeakMap<Element, TargetStateSnapshot>)
    target-state-listeners.ts        (NEW — mousedown+focus capture-phase pre-population)
    dom-observer.ts                  (NEW — recursive shadow DOM, summarization,
                                         shared batch counter)
    adaptive-window.ts               (NEW — setTimeout-based stabilization)
    network-inject.ts                (NEW — MAIN-world fetch/XHR monkeypatch,
                                         standalone bundle for dynamic injection)
    network-bridge.ts                (NEW — ISOLATED-world CustomEvent listener
                                         + webRequest parallel + deduplication)
    evidence-collector.ts            (NEW — orchestrates full lifecycle)
  shared/
    behavioral-evidence-types.ts     (NEW — all type definitions from §3)
    types.ts                         (MODIFIED — add inputType to RawElementIdentity,
                                         add BEHAVIORAL_EVIDENCE + INTERACTION_EVIDENCE_UPDATE
                                         to AppMessage union)
    component-types.ts               (MODIFIED — remove orphaned M1 comment,
                                         add behavioralEvidence? field)
  recorder/
    phase5/
      recorder-entry.ts              (MODIFIED — wire onAfterEvent into createEventTap,
                                         create EvidenceCollector, wire nav events,
                                         add evidence buffer + flush)
  background/
    service-worker.ts                (MODIFIED — BEHAVIORAL_EVIDENCE handler,
                                         pendingEvidence Map, network observation
                                         start/stop, webRequest listeners)
    network-observation.ts           (NEW — SW-side webRequest listener management,
                                         MAIN-world injection orchestration)
  sidepanel/
    evidence-renderer.ts             (NEW — renders Target + Application evidence)
    interaction-renderer.ts          (MODIFIED — call evidence-renderer)
    sidepanel.ts                     (MODIFIED — INTERACTION_EVIDENCE_UPDATE handler)
    index.html                       (MODIFIED — clean dead behavioral HTML,
                                         add evidence display container)
  repository/
    services/
      session-persistence-service.ts (MODIFIED — flush pendingEvidence to Dexie
                                         behavioral_evidence table)
    v2/
      dexie/
        dexie-database.ts            (MODIFIED — add V4 schema with
                                         behavioral_evidence table)

tests/
  tap/
    target-state-cache.test.ts
    target-state-listeners.test.ts
    dom-observer.test.ts
    adaptive-window.test.ts
    network-interceptor.test.ts
    network-bridge.test.ts
    evidence-collector.test.ts
    dom-change-cap.test.ts
  integration/
    toggle.test.ts
    typing.test.ts
    autocomplete.test.ts
    modal.test.ts
    spa-nav.test.ts
    multi-level.test.ts
    shadow-dom.test.ts
    high-churn.test.ts
    network-driven.test.ts
    webrequest-fallback.test.ts
```

### Existing Files at 3bc28f6

The `src/tap/` directory at `3bc28f6` contains exactly 2 files:
- `event-tap.ts` (333 LOC) — EXISTING, 2-3 minor modifications
- `identity-extractor.ts` (504 LOC) — EXISTING, 1 minor modification (inputType)

The `src/semantics/` directory DOES NOT EXIST at `3bc28f6` (fully removed).
No new files go in `src/semantics/`.

### Deleted Files (Removed Prior to 3bc28f6)

All old behavioral observation files were removed:
- At commit `4aade52` (capability-v1-complete branch): first-pass removal
- At commit `3bc28f6` (capability-surgical-removal branch): complete removal

Removed files: `observation-coordinator.ts`, `document-observer.ts`,
`element-state-cache.ts`, `state-cache-listeners.ts`, all `semantics/*` files,
`behavioral-renderer.ts`, `observed-transition.ts`, `application-knowledge.ts`.

**This spec defines clean-slate replacements. No removed file is reused,
no removed type is reused, no removed pattern is reused verbatim.**

---

## 16. Implementation Phasing (For Reference — Not Started)

| Phase | Scope | Deliverable |
|---|---|---|
| Phase 1 | Types + TargetStateCache + target-state-listeners + EventTap modifications (onAfterEvent for nav, submit [optional]) + inputType addition | Target evidence capture working |
| Phase 2 | DOMObserver (light DOM only) + AdaptiveWindow + DomChangeSummary + shared batch counter | Application evidence (light DOM) |
| Phase 3 | Shadow DOM recursive observation | Application evidence (shadow DOM) |
| Phase 4 | NetworkInterceptor (dynamic MAIN-world injection) + NetworkBridge (ISOLATED) + webRequest parallel + deduplication | Network evidence |
| Phase 5 | EvidenceCollector (full lifecycle) + recorder-entry wiring + SW handler + pendingEvidence + typing/scroll strategies | End-to-end evidence capture |
| Phase 6 | EvidenceRenderer (side panel) + side panel integration | Visual verification |
| Phase 7 | Integration tests | Real-browser validation |
| Phase 8 | Caps enforcement, performance budgets, concurrency limits, Dexie V4 evidence table, persistence wiring | Production hardening |

---

## 17. Resolved Questions (Formerly Open)

All open questions from v1.0/v2.0 are resolved:

| # | Question | Resolution |
|---|---|---|
| 1 | **Scroll observation** | **RESOLVED (§4.7)**: Throttled lightweight observation. 1 window per 500ms max. Minimal TargetEvidence (scroll container scrollTop). Adaptive window closes quickly if no mutations; stays open if infinite scroll loads content. |
| 2 | **Keyboard typing** | **RESOLVED (§4.6)**: Extend-on-input model. First `input` opens window. Subsequent `input` events on same element extend (reset timer). Closes on 300ms quiescence with `endReason: 'typing-complete'`. One BehavioralEvidence per typing session. |
| 3 | **iframe support** | **RESOLVED (§3.1)**: Every BehavioralEvidence tagged with `frameId`. Top frame = `'main'`, iframes get their URL. Evidence from different frames stays separate. Existing `ElementIdentity.inIframe` and `iframeContext` fields already handle iframe detection in identity. |
| 4 | **Accessible name computation** | **RESOLVED (§8.1)**: Use the existing `computeAccessibleName()` from `identity-extractor.ts` (already implements the 10-tier cascade). No new computation needed. Identity is taken from `ObservedEvent.target`, not re-extracted. |
| 5 | **Network interceptor + CSP** | **RESOLVED (§6)**: PRIMARY: dynamic `chrome.scripting.executeScript({ world: 'MAIN' })` at recording start. PARALLEL: `chrome.webRequest` in SW for race coverage. Detection: MAIN-world posts "ready" CustomEvent; deduplication prefers main-world source. |
| 6 | **Evidence retention** | **RESOLVED (§12.6)**: Separate Dexie table `behavioral_evidence` (V4 schema) with foreign keys to interactionEventId + sessionId. Long-term queryable persistence. Implemented in Phase 8. NOT inlined with interactions to avoid blob inflation. |

---

## 18. Relationship to Prior System

| Aspect | Old System (deff878) | New Model (This Spec v3.0) |
|---|---|---|
| Observation trigger | click + change only | 9 event types per trigger matrix (§4.1) |
| Window strategy | Fixed 3000ms | Adaptive stabilization (300ms quiet → 10s max), setTimeout-based |
| Element identity | `elementId` always `''` | Reuse existing 18-field ElementIdentity from identity-extractor.ts |
| Shadow DOM | Not observed | Recursive observation of all shadow roots (max 20) |
| Network | Not observed | Dynamic MAIN-world fetch/XHR monkeypatch + parallel webRequest |
| SPA navigation | Not detected | Reuse existing EventTap navigation events + onAfterEvent fix (§7.2) |
| Mutation storage | Raw MutationRecord2[] (unbounded) | Summarized DomChangeSummary[] (keep first 200, flag overflow) |
| Timing | Absolute timestamps | Raw relative timing + shared global batchIndex (no pre-classification) |
| Evidence lifecycle | Durable chrome.storage.local per observation | Deferred in-memory attachment (§9.2) + sessionStorage buffer + Dexie at persistence |
| Semantic interpretation | 7 effect categories at capture time | None — capture only |
| Concurrent windows | Unlimited | Max 5 (displaced endReason) |
| Batch counter | N/A | Shared global counter across all windows |
| Typing | Not specially handled | Extend-on-input (1 window per session) |
| Scroll | Not handled | Throttled lightweight (1/500ms) |
| SW restart recovery | recoverDurableObservations (removed) | sessionStorage buffer flush on recording start (§9.4) |
| Downstream consumers | Side panel display + (dead) Capability Engine | Side panel display + (future) correlation layer |
| Memory hazard | 143MB/3hrs crash | Bounded by design (all arrays capped, keep-first-200) |
| History API patching | Not patched (old system) | NOT re-patched (EventTap already does it — reused) |
| MAIN-world injection | N/A | Dynamic chrome.scripting.executeScript (no static manifest entry) |

---

## 19. Validation Against 3bc28f6 — Resolution Matrix

This section maps every validation finding from
`behavioral-evidence-v2-validation-3bc28f6.md` to its resolution in v3.0.

| Validation ID | Finding | v3.0 Resolution |
|---|---|---|
| V-R1 | EventTap onAfterEvent exists but is not wired | §4.2 — implementation must wire onAfterEvent in recorder-entry.ts createEventTap call |
| V-R2 | ElementIdentity has 18 fields (confirmed) | §8.1 — reused verbatim |
| V-R3 | ObservedEvent has all needed context | §4.2 step 1 — identity taken from ObservedEvent.target |
| V-R4 | MAIN-world script does not exist | §6.2 — dynamic executeScript injection (NEW) |
| V-R5 | Navigation bypasses onAfterEvent | §7.2 — modify emitSpaNavigation to fire onAfterEvent |
| V-R6 | No behavioral_evidence Dexie table | §12.6 — V4 schema migration |
| V-R7 | SW message types clean | §12.2 — add BEHAVIORAL_EVIDENCE + INTERACTION_EVIDENCE_UPDATE |
| V-R8 | behavioralObservations field removed | §9.3 — add behavioralEvidence field, remove orphaned comment |
| V-R9 | @crxjs MAIN-world untested | §6.2 — dynamic executeScript avoids crxjs dependency entirely |
| V-R10 | Enrichment→IR gap confirmed | Out of scope — §12.5 lists IR Bridge as unchanged |
| V-R11 | No webRequest permission | §6.7 — add to manifest permissions |
| V-R12 | No shadow DOM observation | §5.1 — build from scratch (open roots only, closed documented as limitation) |
| V-R13 | jsdom test limitations | §14.1 — unit tests for pure functions, E2E for timing/DOM |
| V-R14 | eventId correlation key exists | §9.2 — confirmed as correlation key |
| V-R15 | SW restart recovery code removed | §9.4 — rebuild via sessionStorage buffer pattern |
| V-R16 | Side panel renderer removed | §12.4 — new evidence-renderer.ts module |
| V-R17 | Orphaned M1 comment | §9.3 — remove when adding new field |
| V-R18 | Global batch counter doesn't exist | §4.5/§5.3 — build into DOMObserver from scratch |
| V-R19 | Evidence attachment timing ambiguous | §9.2 — deferred in-memory attachment with stopRecording persistence |
| V-R20 | Memory budget reasonable | §10 — all caps defined |
| V-R21 | Vite multi-script build risk | §6.2 — standalone bundle for network-inject.js, no crxjs dependency |
| V-R22 | Dead M1 comment block | Same as V-R17 |
| V-R23 | Clean message types confirmed | §12.2 — no conflicts |

| Spec Change ID | Finding | v3.0 Resolution |
|---|---|---|
| SC-1 | Evidence attachment timing unspecified | §9 — full lifecycle: deferred Map → attach on match → persist at stopRecording |
| SC-2 | Navigation events bypass onAfterEvent | §7.2 — modify EventTap.emitSpaNavigation |
| SC-3 | inputType doesn't exist | §8.2 — marked as NEW field addition, not existing |
| SC-4 | MAIN-world build path unspecified | §6.2 — dynamic executeScript (not static manifest) |
| SC-4b | Network race condition | §6.3 — webRequest runs in parallel from recording start |
| SC-5 | webRequest permission UX | §6.7 — UX note added, no webRequestBlocking needed |
| SC-6 | Dexie table scope ambiguous | §12.6 — long-term queryable persistence |
| SC-7 | Orphaned M1 comment | §9.3, §12.1 — remove at implementation |
| SC-8 | "Reuse" language for removed systems | All removed — §15 explicitly states "No removed file is reused" |

---

## 20. Consistency Checklist (v3.0 Final Pass)

| Check | Status | Notes |
|---|---|---|
| Baseline is 3bc28f6 (not aef34a0 or deff878) | ✅ | Header, §15, all references |
| No NavWatcher component | ✅ | Navigation via EventTap (§7) |
| No identity-capture.ts file | ✅ | Identity from ObservedEvent.target (§8) |
| No per-window batch counter | ✅ | Shared global counter (§4.5, §5.3) |
| Coarse mode keeps first 200 | ✅ | Keep-first + overflow flag (§5.2 Stage 3, §10.1) |
| domChangeOverflow field exists | ✅ | On ApplicationEvidence (§3.4) |
| coarseMode field exists | ✅ | On ApplicationEvidence + PerformanceCondition |
| frameId on BehavioralEvidence | ✅ | Added (§3.1) |
| inputType marked as NEW (not existing) | ✅ | §8.2 explicitly states "does NOT exist at 3bc28f6" |
| MAIN-world injection uses dynamic executeScript | ✅ | §6.2 — not static manifest entry |
| webRequest runs in parallel (not just CSP fallback) | ✅ | §6.3 — covers race window |
| webRequest permission noted | ✅ | §6.7 — UX note, no webRequestBlocking |
| Typing strategy defined | ✅ | Extend-on-input (§4.6) |
| Scroll strategy defined | ✅ | Throttled lightweight (§4.7) |
| Evidence lifecycle fully specified | ✅ | §9 — deferred attachment, stopRecording persistence |
| Dexie table scope defined | ✅ | §12.6 — long-term queryable |
| Orphaned M1 comment cleanup noted | ✅ | §9.3, §12.1 |
| No "reuse removed system" language | ✅ | §15 — "No removed file is reused" |
| Navigation events fire onAfterEvent | ✅ | §7.2 — EventTap modification specified |
| Evidence attachment timing resolved | ✅ | §9.2 — pendingEvidence Map + deferred |
| SW restart recovery specified | ✅ | §9.4 — sessionStorage buffer |
| Side panel renderer is new module | ✅ | §12.4 — evidence-renderer.ts (not behavioral-renderer.ts) |
| jsdom test limitations documented | ✅ | §14.1 |
| Closed shadow roots documented as limitation | ✅ | §5.1 |
| network-inject.js is standalone bundle | ✅ | §6.2 — separate build target |
| No contradictions between sections | ✅ | Verified in this checklist |
| All 23 validation findings resolved | ✅ | §19 resolution matrix |

---

## End of Specification (v3.0)

This document defines the Behavioral Evidence Model v3.0. All 23 validation
findings (SC-1 through SC-8, V-R1 through V-R23) against the actual code at
`3bc28f6` are resolved. The spec is implementation-ready and depends only on
infrastructure that survives at `3bc28f6` (EventTap, IdentityExtractor,
ComponentRuntime, Dexie, SW message pattern). No removed file, type, or
pattern is reused. No implementation has started.
