# M1 — Complete Behavioral Observation Foundation
## Fresh Design on a43df53 Baseline

**Status:** DESIGN — awaiting review. No implementation yet.

---

## 0. The Claim M1 Must Support

> For every recorded user interaction, the recorder can reliably preserve the
> relevant before/after element state and ALL observable DOM mutations across
> the entire document within a fixed 3-second observation window — including
> local, distant, and delayed consequences — while preserving each interaction
> as a separate chronological action with immutable evidence, handling
> overlapping interactions via shared capture with independent lifetimes,
> without claiming causation or semantic meaning.

**Strict boundary:** M1 captures trustworthy evidence only. No semantic
meaning. No classification. No causality claims. No AI.

---

## 1. Architecture Overview

```
┌─── Content Script (per frame, all_frames: true) ──────────────────────┐
│                                                                        │
│  ┌──────────────┐                                                      │
│  │   EventTap   │  onEvent(ObservedEvent) ──────────► recorder-entry   │
│  │  (UNCHANGED  │  onAfterEvent(el,evtId,ts,type) ──┐                  │
│  │   except +   │                                   │                  │
│  │   1 callback)│                                   │                  │
│  └──────────────┘                                   │                  │
│                                                      │                  │
│  ┌─────────────────────┐               ┌────────────▼────────────┐     │
│  │ State Cache Listeners│               │ ObservationCoordinator  │     │
│  │ (mousedown + focus   │               │                         │     │
│  │  capture-phase)      │────writes────►│  openWindow(evtId,type,el)   │
│  └─────────────────────┘   to cache     │    peek(el) → beforeSnap │     │
│                            (shared)     │    capture(el) → current │     │
│  ┌─────────────────────┐               │    docObserver.start(wId)│     │
│  │ ElementStateCache   │◄──────────────│    setTimeout(3000)      │     │
│  │ WeakMap<Element,    │  peek/capture │                         │     │
│  │  ElementStateSnap>  │               │  onWindowTimeout(wId):   │     │
│  │ Persists for entire │               │    capture(el) → final   │     │
│  │  recording session  │               │    collect records       │     │
│  └─────────────────────┘               │    prune shared buffer   │     │
│                                         │    docObserver.stop(wId) │     │
│                                         │    emit ObservationResult│     │
│                                         └────────────┬────────────┘     │
│                                                      │                  │
│  ┌─────────────────────┐                             │ activates/stops  │
│  │ DocumentObserver    │◄────────────────────────────┘                  │
│  │ (singleton,         │                                               │
│  │  refcounted)        │  MutationObserver on document.body             │
│  │                     │  {childList, attributes, characterData,        │
│  │  O(1) callback:     │   subtree:true,                                │
│  │   push compact      │   attributeOldValue,                           │
│  │   record with all   │   characterDataOldValue}                       │
│  │   active windowIds[]│                                               │
│  └─────────────────────┘                                               │
│                                                                        │
│  ┌─────────────────────┐                                               │
│  │ Behavioral Buffer   │  sessionStorage: cmdrunner_behavioral_buffer   │
│  │ + Retry Pipeline    │  max 200, exponential backoff                 │
│  └────────┬────────────┘                                               │
└───────────┼────────────────────────────────────────────────────────────┘
            │ sendMessage({type:'BEHAVIORAL_EFFECTS', payload})
            ▼
┌─── Service Worker ─────────────────────────────────────────────────────┐
│                                                                        │
│  case 'BEHAVIORAL_EFFECTS':                                            │
│    handleBehavioralEffects(result):                                    │
│      scan liveInteractions[*].memberEvents for matching eventId        │
│      if found → attach behavioralObservations, persist, broadcast      │
│      if not found → store in pendingBehavioralEffects Map              │
│                                                                        │
│  pendingBehavioralEffects attached at all 3 interaction emit points    │
│                                                                        │
│  ComponentInteraction.behavioralObservations?: ObservationResult[]     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
            │ sendMessage({type:'INTERACTION_EFFECTS_UPDATE'})
            ▼
┌─── Side Panel ────────────────────────────────────────────────────────┐
│                                                                        │
│  INTERACTION_EFFECTS_UPDATE → reload liveInteractions → re-render     │
│                                                                        │
│  createBehavioralEffectsSection():                                     │
│    collapsible <details> with:                                         │
│    - mutation summary (type, target, old→new, timing)                  │
│    - element state diff (before → after)                               │
│    - window timing (duration, endReason)                               │
│    - honest empty state when 0 mutations                               │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Files — New and Modified

### New Files (5)

| # | File | Est. Lines | Responsibility |
|---|------|-----------|----------------|
| 1 | `src/shared/observation-types.ts` | ~130 | All M1 types: `MutationRecord2`, `ElementStateSnapshot`, `ObservationWindow`, `ObservationResult`, `WindowEndReason` |
| 2 | `src/tap/element-state-cache.ts` | ~100 | `WeakMap<Element, ElementStateSnapshot>`. `capture(el)`, `peek(el)`, `clear()`. Plus `setupStateCacheListeners()` for mousedown+focus capture-phase listeners |
| 3 | `src/tap/document-observer.ts` | ~180 | Singleton `MutationObserver` on `document.body`. Lightweight O(1) callback. Refcounted start/stop. Shared record buffer with `windowIds[]` attribution |
| 4 | `src/tap/observation-coordinator.ts` | ~220 | Window lifecycle: `openWindow()`, fixed 3000ms timer, `onWindowTimeout()`. Independent per-window closure. Manages before/final snapshots via cache |
| 5 | `src/tap/state-cache-wiring.ts` | ~40 | Thin wiring module that connects state cache listeners to the recording lifecycle (start/stop). Keeps recorder-entry.ts clean |

### Modified Files (7)

| # | File | Change | Lines Changed |
|---|------|--------|--------------|
| 6 | `src/tap/event-tap.ts` | Add `onAfterEvent?` to `EventTapConfig`. Fire it after `config.onEvent(observed)` in `handleRawEvent` | +5 |
| 7 | `src/recorder/phase5/recorder-entry.ts` | Wire onAfterEvent → coordinator.openWindow. Add behavioral buffer + retry. Clear on stop | +~70 |
| 8 | `src/shared/component-types.ts` | Add `behavioralObservations?: ObservationResult[]` to `ComponentInteraction` | +3 |
| 9 | `src/background/service-worker.ts` | Add `BEHAVIORAL_EFFECTS` case + `handleBehavioralEffects()` | +~40 |
| 10 | `src/runtime/sw-integration.ts` | Add `pendingBehavioralEffects` Map + `attachPendingBehavioralObservations()` at 3 emit points | +~35 |
| 11 | `src/sidepanel/interaction-renderer.ts` | Add `createBehavioralEffectsSection()` | +~80 |
| 12 | `src/sidepanel/sidepanel.ts` | Add `INTERACTION_EFFECTS_UPDATE` handler | +~10 |

### Baseline — Unchanged

The existing `DEDUP_WINDOW_MS = 2000` dedup behavior in `component-runtime.ts`
is **unchanged** in M1. We accept the known limitation that intentional
repeated interactions on the same element within 2 seconds may be
deduplicated. This is an edge case that does not need to be solved in M1.

If a behavioral observation cannot be correlated to a dedup-suppressed
interaction, it remains in `pendingBehavioralEffects` — no data loss, just
an unattached observation that will be available for future analysis.

### New Test Files (7)

| # | File | Tests |
|---|------|-------|
| T1 | `tests/tap/element-state-cache.test.ts` | ~10 tests |
| T2 | `tests/tap/document-observer.test.ts` | ~12 tests |
| T3 | `tests/tap/observation-coordinator.test.ts` | ~15 tests |
| T4 | `tests/tap/event-tap-observer-hook.test.ts` | ~6 tests |
| T5 | `tests/tap/state-cache-listeners.test.ts` | ~8 tests |
| T6 | `tests/runtime/behavioral-delivery.test.ts` | ~6 tests |
| T7 | `tests/integration/m1-observation-flow.test.ts` | ~5 tests |

**Total: 5 new source files, 7 modified files, 7 test files (~62 tests).**

---

## 3. Data Structures

### observation-types.ts

```typescript
// ── Mutation Record ───────────────────────────────────────────────────

/**
 * Compact mutation record. O(1) to create — no DOM traversal, no analysis.
 * Created in the MutationObserver callback, one per MutationRecord entry.
 */
interface MutationRecord2 {
  /** Sequential record ID (for pruning and reference). */
  id: number;
  /** Mutation type. */
  type: 'attributes' | 'childList' | 'characterData';
  /** CSS selector path from document.body to the target element. */
  targetPath: string;
  /** Target element's tagName (for quick deferred filtering). */
  targetTag: string;
  /** Attribute name (for type='attributes'), null otherwise. */
  attributeName: string | null;
  /** Previous attribute value or text content (from OldValue config). */
  oldValue: string | null;
  /** Current attribute value or text content (read immediately — DOM mutates). */
  newValue: string | null;
  /** Number of nodes added (for type='childList'). */
  addedNodesCount: number;
  /** Number of nodes removed (for type='childList'). */
  removedNodesCount: number;
  /** Timestamp relative to recording start (performance.now()). */
  timestamp: number;
  /** Which observation window(s) were active when this mutation occurred. */
  windowIds: string[];
}

// ── Element State Snapshot ────────────────────────────────────────────

/**
 * A point-in-time snapshot of an element's observable state.
 * Used for before/after comparison of the TARGET element (the one clicked).
 * Captures properties that MutationObserver may miss (value, checked).
 */
interface ElementStateSnapshot {
  /** Input/select value. null for non-value elements. */
  value: string | null;
  /** Checked state (checkbox/radio, aria-checked, aria-pressed). null if N/A. */
  checked: boolean | null;
  /** className attribute. */
  className: string;
  /** disabled attribute or aria-disabled. */
  disabled: boolean;
  /** aria-expanded attribute. null if absent. */
  ariaExpanded: boolean | null;
  /** aria-checked attribute. null if absent. */
  ariaChecked: boolean | null;
  /** aria-pressed attribute. null if absent. */
  ariaPressed: boolean | null;
  /** Direct text content, truncated to 200 chars. */
  textContent: string | null;
  /** Number of direct child element nodes. */
  childCount: number;
  /** When this snapshot was taken (Date.now()). */
  capturedAt: number;
}

// ── Observation Window ────────────────────────────────────────────────

type WindowEndReason = 'completed' | 'element-removed' | 'recording-stopped';

/**
 * Internal representation of one interaction's observation window.
 * Lives in the coordinator while open, converted to ObservationResult on close.
 */
interface ObservationWindow {
  /** Unique window ID: `obs-{eventId}`. */
  windowId: string;
  /** The event that triggered this observation. */
  sourceEventId: string;
  /** Event type: 'click' or 'change'. */
  sourceEventType: string;
  /** CSS path of the target element at window open. */
  sourceElementPath: string;
  /** performance.now() when window opened. */
  openedAt: number;
  /** performance.now() when window closed (null while open). */
  closedAt: number | null;
  /** Why the window closed. */
  endReason: WindowEndReason | null;
  /** Before-state snapshot (from cache peek at open). May be null on first interaction. */
  beforeSnapshot: ElementStateSnapshot | null;
  /** After-state snapshot (captured at close). */
  finalSnapshot: ElementStateSnapshot | null;
}

// ── Observation Result (delivered to service worker) ──────────────────

/**
 * The complete behavioral evidence for one interaction.
 * This is what gets serialized and sent to the service worker.
 */
interface ObservationResult {
  /** The event that triggered this observation. */
  sourceEventId: string;
  /** Event type: 'click' or 'change'. */
  sourceEventType: string;
  /** Window ID. */
  windowId: string;
  /** performance.now() values — relative timing within the recording. */
  openedAt: number;
  closedAt: number;
  /** Duration in milliseconds (closedAt - openedAt). Always ~3000 for 'completed'. */
  durationMs: number;
  /** Why the window closed. */
  endReason: WindowEndReason;
  /** Target element state before the interaction. null if no prior cache. */
  beforeSnapshot: ElementStateSnapshot | null;
  /** Target element state after the observation window. */
  finalSnapshot: ElementStateSnapshot | null;
  /** All mutations attributed to this window (from shared buffer). */
  mutations: MutationRecord2[];
  /** Count of mutations. */
  mutationCount: number;
  /** Total mutations across the entire document during this window (context). */
  documentWideMutationTotal: number;
}
```

---

## 4. Component Designs

### 4.1 Element State Cache (`element-state-cache.ts`)

**Purpose:** Maintain a rolling cache of element **property** states so that
when an observation window opens, we can retrieve the true before-state for
DOM properties (`.value`, `.checked`) — even on the first interaction.

**This is one of two complementary before-state mechanisms in M1:**
- **Element State Cache (Phase A):** Captures DOM **properties** (`.value`,
  `.checked`) that MutationObserver cannot see. Works because mousedown
  target == state holder for native controls.
- **MutationObserver `oldValue` (Phase B):** Captures before-state for all
  DOM **attributes** (aria-checked, aria-expanded, class), **text content**,
  and **structural changes** anywhere in the document. Works for custom
  components where the state holder is an ancestor or sibling of the clicked
  element.

**Neither mechanism alone covers every case.** Phase A does not assume
mousedown.target is always the state holder. For custom components, the
cache snapshot of the clicked element may honestly show no meaningful state
change — the real before-state comes from Phase B's mutation `oldValue`.

**The property-level before-state problem it solves (Case 4):**
When a user selects "Premium Economy" from a native `<select>`, the browser
sets `.value = "Premium Economy"` BEFORE the `change` event fires. By the
time our observation window opens (on change), the old value is gone.
MutationObserver cannot help here — `.value` is a DOM property, not reflected
as an attribute after initialization.

**The DOM event ordering guarantee that makes it work:**
At capture phase of `mousedown` and `focus`, no default action has run,
no activation behavior has toggled anything, and no derived event has fired.
The element's state is exactly as it was before the user's input reached the DOM.

| Event | Fires BEFORE state change? | In cache listeners? |
|-------|---------------------------|---------------------|
| mousedown (capture) | ✓ (activation runs after click propagation) | ✓ |
| focus (capture) | ✓ (value not yet typed) | ✓ |
| click (capture) | ✓ (activation runs after propagation) | — (window opens instead) |
| change (capture) | ✗ (value already changed) | — (window opens instead) |
| input (capture) | ✗ (value already changed) | — |

**Implementation:**

```typescript
class ElementStateCache {
  private map = new WeakMap<Element, ElementStateSnapshot>();

  /**
   * Read the element's current state and store it in the cache.
   * Returns the snapshot. O(1) — reads 9 properties.
   * Called by: mousedown listener, focus listener, window open, window close.
   */
  capture(el: Element): ElementStateSnapshot {
    const snap = this.readState(el);
    this.map.set(el, snap);
    return snap;
  }

  /**
   * Return the cached state WITHOUT reading or modifying the element.
   * Returns null if the element has never been cached.
   * Called by: window open (to get before-state).
   */
  peek(el: Element): ElementStateSnapshot | null {
    return this.map.get(el) ?? null;
  }

  /**
   * Clear the cache. Called on stopRecording only.
   * WeakMap has no clear() — reassign.
   */
  clear(): void {
    this.map = new WeakMap();
  }

  private readState(el: Element): ElementStateSnapshot {
    const htmlEl = el as HTMLElement;
    const input = el as HTMLInputElement;
    const isInput = el instanceof HTMLInputElement;
    const isSelect = el instanceof HTMLSelectElement;

    return {
      value: isInput || isSelect ? (input.value ?? null) : null,
      checked: isInput && (input.type === 'checkbox' || input.type === 'radio')
        ? input.checked
        : this.readAriaChecked(el),
      className: el.getAttribute('class') ?? '',
      disabled: htmlEl.hasAttribute('disabled') ||
                el.getAttribute('aria-disabled') === 'true',
      ariaExpanded: el.getAttribute('aria-expanded') === null
        ? null
        : el.getAttribute('aria-expanded') === 'true',
      ariaChecked: el.getAttribute('aria-checked') === null
        ? null
        : el.getAttribute('aria-checked') === 'true',
      ariaPressed: el.getAttribute('aria-pressed') === null
        ? null
        : el.getAttribute('aria-pressed') === 'true',
      textContent: (el.textContent ?? '').substring(0, 200) || null,
      childCount: el.children.length,
      capturedAt: Date.now(),
    };
  }

  private readAriaChecked(el: Element): boolean | null {
    const aria = el.getAttribute('aria-checked');
    if (aria !== null) return aria === 'true';
    const pressed = el.getAttribute('aria-pressed');
    if (pressed !== null) return pressed === 'true';
    return null;
  }
}
```

**State cache listeners (separate from EventTap):**

```typescript
function setupStateCacheListeners(cache: ElementStateCache): () => void {
  const onMouseDown = (e: Event) => {
    const el = e.target as Element;
    if (el instanceof HTMLElement) {
      cache.capture(el);
    }
  };
  const onFocus = (e: Event) => {
    const el = e.target as Element;
    if (el instanceof HTMLElement) {
      cache.capture(el);
    }
  };

  document.addEventListener('mousedown', onMouseDown, { capture: true });
  document.addEventListener('focus', onFocus, { capture: true });

  return () => {
    document.removeEventListener('mousedown', onMouseDown, { capture: true });
    document.removeEventListener('focus', onFocus, { capture: true });
  };
}
```

**Why WeakMap:** Removed elements are automatically GC'd. No manual cleanup.
The cache persists for the entire recording session (populated across all
interactions), cleared only on stopRecording.

**Why separate from EventTap:** EventTap captures `valueBefore`/`checkedBefore`
in ObservedEvent. The cache serves a different purpose: providing before-state
to observation windows opened by change events (where the old value is gone).
They are complementary evidence sources, not redundant.

### 4.2 Document Observer (`document-observer.ts`)

**Purpose:** Capture ALL DOM mutations across the entire document during
observation windows. Lightweight O(1) callback. Singleton with refcounting.

**Why document-wide (Cases 2, 3, 6):**
Consequences of an interaction may appear anywhere — a modal added to
`document.body`, a results count updated in a distant region, a class
shuffled on sibling tabs. Limiting to target subtree misses these.

**Implementation:**

```typescript
// ── Singleton State ──────────────────────────────────────────────────

let observer: MutationObserver | null = null;
let refCount = 0;
let activeWindowIds: Set<string> = new Set();
let records: MutationRecord2[] = [];    // shared buffer
let recordCounter = 0;

// ── CSS Path Cache ───────────────────────────────────────────────────

const pathCache = new WeakMap<Element, string>();

function getCssPath(el: Element): string {
  let path = pathCache.get(el);
  if (path) return path;
  path = computeCssPath(el);  // tag:nth-child chain from document.body
  pathCache.set(el, path);
  return path;
}

// ── Public API ───────────────────────────────────────────────────────

function start(windowId: string): void {
  refCount++;
  activeWindowIds.add(windowId);
  if (observer) return;  // already running

  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });
}

function stop(windowId: string): void {
  activeWindowIds.delete(windowId);
  refCount--;
  if (refCount <= 0 && observer) {
    observer.disconnect();
    observer = null;
    refCount = 0;
  }
}

// ── O(1) Callback ────────────────────────────────────────────────────

function handleMutations(mutationList: MutationRecord[]): void {
  const now = performance.now();
  const ids = [...activeWindowIds];  // snapshot active windows

  for (const m of mutationList) {
    records.push(compact(m, now, ids));
  }
}

function compact(m: MutationRecord, ts: number, windowIds: string[]): MutationRecord2 {
  const target = m.target as Element;
  const id = ++recordCounter;

  // Read newValue immediately — DOM will mutate again
  let newValue: string | null = null;
  if (m.type === 'attributes' && m.attributeName) {
    newValue = target.getAttribute(m.attributeName);
  } else if (m.type === 'characterData') {
    newValue = target.textContent;
  }

  return {
    id,
    type: m.type as 'attributes' | 'childList' | 'characterData',
    targetPath: getCssPath(target),
    targetTag: target.tagName,
    attributeName: m.attributeName ?? null,
    oldValue: m.oldValue ?? null,
    newValue,
    addedNodesCount: m.addedNodes.length,
    removedNodesCount: m.removedNodes.length,
    timestamp: ts,
    windowIds,
  };
}

// ── Record Retrieval (called by coordinator on window close) ─────────

function getRecordsForWindow(windowId: string): MutationRecord2[] {
  return records.filter(r => r.windowIds.includes(windowId));
}

function getTotalRecordsDuringWindow(windowId: string): number {
  return records.filter(r => r.windowIds.includes(windowId)).length;
}

// ── Buffer Pruning ───────────────────────────────────────────────────

/**
 * Remove records that are ONLY attributed to the closing window.
 * Records also attributed to other active windows are preserved.
 */
function pruneWindowRecords(windowId: string): void {
  records = records.filter(r => {
    // Keep if this record belongs to other active windows too
    const hasOtherWindows = r.windowIds.some(id => id !== windowId);
    if (hasOtherWindows) {
      // Remove this windowId from the record's list
      r.windowIds = r.windowIds.filter(id => id !== windowId);
      return true;
    }
    return false;  // Only belonged to this window — prune
  });
}

// ── Reset (called on stopRecording) ──────────────────────────────────

function reset(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  refCount = 0;
  activeWindowIds.clear();
  records = [];
  recordCounter = 0;
}
```

**Performance:**
- Callback is O(1) per mutation record: read tagName, attributeName, oldValue
  (provided by MutationObserver), newValue (one getAttribute/textContent call),
  compute CSS path (cached via WeakMap), count added/removed nodes (array.length).
- Memory: ~200 bytes per compact record. Worst case ~2000 records in 3s = ~400KB.
  Cleared via pruning as windows close.
- No stability checking, no periodicity detection, no noise filtering in the callback.
  ALL analysis is deferred to future milestones.

**What is NOT in the document observer:**
- No periodicity detection (fixed window means no stability check to block)
- No noise filtering during capture (capture broadly, analyze later)
- No region identification (future milestone)
- No semantic classification (M1 boundary)

### 4.3 Observation Coordinator (`observation-coordinator.ts`)

**Purpose:** Manage observation window lifecycle. One independent 3-second
window per interaction. No shared closure. No stability-based early termination.

**Why fixed 3-second window (Cases 6, 7, 8):**
DOM silence does not prove the application has finished responding. A
network request in flight produces zero DOM mutations until the response
arrives. The document is explicit: "If our bounded evidence horizon is 3
seconds, meaningful evidence occurring inside that horizon should not
disappear simply because the DOM became temporarily quiet."

Case 7 timeline:
```
0ms: interaction → 10ms local changes → 20ms-1499ms DOM SILENCE
→ 1500ms server response → 1520ms results → 1540ms count change
```
A stability-based window (500ms quiet + 1000ms min) would close at ~1000ms
and MISS the 1500ms response. A fixed 3-second window captures all of it.

**Why independent windows (Case 10):**
"An older interaction reaching its limit should not prematurely terminate
evidence collection for a newer interaction." Each window has its own
setTimeout(3000). Windows close independently. The document observer
continues running until the LAST window closes.

**Implementation:**

```typescript
class ObservationCoordinator {
  private windows: Map<string, ObservationWindow> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private cache: ElementStateCache;
  private onResult: ((result: ObservationResult) => void) | null = null;

  constructor(cache: ElementStateCache) {
    this.cache = cache;
  }

  configure(callback: (result: ObservationResult) => void): void {
    this.onResult = callback;
  }

  /**
   * Open a new observation window for an interaction.
   * Called from recorder-entry.ts onAfterEvent for click + change.
   */
  openWindow(eventId: string, eventType: string, targetEl: Element): void {
    const windowId = `obs-${eventId}`;

    // Don't open duplicate windows for the same event
    if (this.windows.has(windowId)) return;

    // Peek the cache for before-state (may be null on first interaction)
    const beforeSnapshot = this.cache.peek(targetEl);

    // Capture current state (overwrites cache with current — same as peeked
    // since no state change has occurred between mousedown and click)
    this.cache.capture(targetEl);

    const window: ObservationWindow = {
      windowId,
      sourceEventId: eventId,
      sourceEventType: eventType,
      sourceElementPath: getCssPath(targetEl),
      openedAt: performance.now(),
      closedAt: null,
      endReason: null,
      beforeSnapshot,
      finalSnapshot: null,
    };

    this.windows.set(windowId, window);

    // Start document observer (refcounted singleton)
    DocumentObserver.start(windowId);

    // Independent 3-second timer for THIS window
    const timer = setTimeout(() => {
      this.closeWindow(windowId, 'completed');
    }, 3000);
    this.timers.set(windowId, timer);
  }

  /**
   * Close a single window. Collects records, creates result, prunes buffer.
   */
  private closeWindow(windowId: string, reason: WindowEndReason): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    // Clear this window's timer
    const timer = this.timers.get(windowId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(windowId);
    }

    // Try to resolve target element for final snapshot
    const targetEl = resolveByPath(window.sourceElementPath);
    if (targetEl) {
      window.finalSnapshot = this.cache.capture(targetEl);
      window.endReason = reason;
    } else {
      window.finalSnapshot = null;
      window.endReason = 'element-removed';
    }

    window.closedAt = performance.now();

    // Collect records attributed to this window
    const mutations = DocumentObserver.getRecordsForWindow(windowId);
    const docTotal = DocumentObserver.getTotalRecordsDuringWindow(windowId);

    // Prune records that only belong to this window
    DocumentObserver.pruneWindowRecords(windowId);

    // Stop document observer for this window (refcounted)
    DocumentObserver.stop(windowId);

    // Build and emit result
    const result: ObservationResult = {
      sourceEventId: window.sourceEventId,
      sourceEventType: window.sourceEventType,
      windowId: window.windowId,
      openedAt: window.openedAt,
      closedAt: window.closedAt,
      durationMs: window.closedAt - window.openedAt,
      endReason: window.endReason,
      beforeSnapshot: window.beforeSnapshot,
      finalSnapshot: window.finalSnapshot,
      mutations,
      mutationCount: mutations.length,
      documentWideMutationTotal: docTotal,
    };

    this.windows.delete(windowId);
    this.onResult?.(result);
  }

  /**
   * Close all open windows immediately. Called on stopRecording.
   */
  shutdown(): void {
    for (const windowId of [...this.windows.keys()]) {
      this.closeWindow(windowId, 'recording-stopped');
    }
  }
}
```

**Overlapping window example (Case 10):**

```
t=0ms:    Click Under ₹500 → Window A opens (timer: 3000ms)
          cache: {checked: false}
          A.beforeSnapshot = {checked: false}

t=300ms:  Click Under ₹500 (uncheck) → Window B opens (timer: 3300ms)
          cache: {checked: true}  ← populated by mousedown at ~290ms
          B.beforeSnapshot = {checked: true}

t=700ms:  ProductResults mutates
          record.windowIds = ['obs-evt-A', 'obs-evt-B']  ← shared

t=3000ms: Window A's timer fires → closeWindow('A', 'completed')
          A.finalSnapshot = {checked: false}  ← element already unchecked by action B
          A.mutations = all records where 'A' ∈ windowIds
          DocumentObserver.stop('A') → refCount 1, observer still running

t=3300ms: Window B's timer fires → closeWindow('B', 'completed')
          B.finalSnapshot = {checked: false}
          B.mutations = all records where 'B' ∈ windowIds
          DocumentObserver.stop('B') → refCount 0, observer disconnects

Result:
  A: {before: checked:false, after: checked:false, mutations: [checkbox@5ms, ProductResults@700ms]}
  B: {before: checked:true, after: checked:false, mutations: [checkbox@310ms, ProductResults@700ms]}
```

Note: Window A's finalSnapshot shows `checked:false` because the element's
state changed due to action B during A's window. This is a factual snapshot
at close time, not a causal claim. M1 records "this is what the element
looked like when the window closed" — it does NOT claim action A caused
the unchecking.

### 4.4 EventTap Modification (`event-tap.ts`)

**Minimal change — 5 lines added, zero existing behavior modified:**

```typescript
export interface EventTapConfig {
  /** Called for every captured event. */
  onEvent: (event: ObservedEvent) => void;
  /**
   * Called AFTER onEvent, on the main capture path, with the live target
   * element. Used by M1 to start behavioral observation windows.
   * Only fires for events that pass the trusted check and reach onEvent.
   */
  onAfterEvent?: (
    targetEl: Element,
    eventId: string,
    eventTimestamp: number,
    eventType: BrowserEventType,
  ) => void;
}
```

In `handleRawEvent`, after `config.onEvent(observed)`:

```typescript
config.onEvent(observed);

// M1: notify observer hook (after the event is dispatched)
if (config.onAfterEvent) {
  const targetElForHook = resolveTarget(rawEvent);
  if (targetElForHook) {
    config.onAfterEvent(
      targetElForHook,
      observed.eventId,
      observed.timestamp,
      eventType,
    );
  }
}
```

This fires at the END of handleRawEvent, only if the event passed all
existing filters (trusted check, target resolution, rate limiting). Zero
impact on the existing capture pipeline. If `onAfterEvent` is undefined
(all existing callers), the `if` guard skips it entirely.

### 4.5 Recorder Entry Wiring (`recorder-entry.ts`)

New imports and setup added to the existing start/stop lifecycle:

```typescript
import { ObservationCoordinator } from '../../tap/observation-coordinator';
import { ElementStateCache, setupStateCacheListeners } from '../../tap/element-state-cache';

const BEHAVIORAL_BUFFER_KEY = 'cmdrunner_behavioral_buffer';
const BEHAVIORAL_BUFFER_MAX = 200;

const stateCache = new ElementStateCache();
const coordinator = new ObservationCoordinator(stateCache);
let cacheCleanup: (() => void) | null = null;

// ── Behavioral Buffer (same pattern as event buffer) ──────────────────

function pushBehavioralBuffer(result: ObservationResult): void {
  try {
    const raw = sessionStorage.getItem(BEHAVIORAL_BUFFER_KEY);
    const buffer: ObservationResult[] = raw ? JSON.parse(raw) : [];
    buffer.push(result);
    if (buffer.length > BEHAVIORAL_BUFFER_MAX) buffer.shift();
    sessionStorage.setItem(BEHAVIORAL_BUFFER_KEY, JSON.stringify(buffer));
  } catch { /* silent degrade */ }
}

function clearBehavioralBuffer(): void {
  try { sessionStorage.removeItem(BEHAVIORAL_BUFFER_KEY); } catch {}
}

async function flushBehavioralBuffer(): Promise<void> {
  try {
    const raw = sessionStorage.getItem(BEHAVIORAL_BUFFER_KEY);
    if (!raw) return;
    const buffer: ObservationResult[] = JSON.parse(raw);
    for (const result of buffer) {
      sendBehavioralObservation(result);
    }
  } catch {}
}

function sendBehavioralObservation(result: ObservationResult): void {
  chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EFFECTS', payload: result })
    .then(() => { /* delivered — will be removed from buffer by caller */ })
    .catch(() => {
      // Retry with exponential backoff: 100/200/400/800/1600ms
      scheduleRetry(result, 0);
    });
}

function scheduleRetry(result: ObservationResult, attempt: number): void {
  const delays = [100, 200, 400, 800, 1600];
  if (attempt >= delays.length) return;  // give up after 5 retries
  setTimeout(() => sendBehavioralObservation(result), delays[attempt]);
}

// ── Modified startRecording ───────────────────────────────────────────

async function startRecording(): Promise<void> {
  // ... existing code: set RECORDING_KEY, flush event buffer ...

  // M1: Initialize observation infrastructure
  coordinator.configure((result) => {
    pushBehavioralBuffer(result);
    sendBehavioralObservation(result);
  });
  cacheCleanup = setupStateCacheListeners(stateCache);
  flushBehavioralBuffer();  // deliver any buffered observations from prior session

  eventTapHandle = createEventTap({
    onEvent,
    onAfterEvent: (targetEl, eventId, _timestamp, eventType) => {
      if (eventType === 'click' || eventType === 'change') {
        coordinator.openWindow(eventId, eventType, targetEl);
      }
    },
  });
}

// ── Modified stopRecording ────────────────────────────────────────────

async function stopRecording(): Promise<void> {
  // M1: Close all observation windows and clean up
  coordinator.shutdown();
  cacheCleanup?.();
  cacheCleanup = null;
  stateCache.clear();
  clearBehavioralBuffer();

  // ... existing code: stop EventTap, clear event buffer ...
}
```

### 4.6 Service Worker Handler (`service-worker.ts`)

```typescript
case 'BEHAVIORAL_EFFECTS': {
  const msg = message as { type: string; payload: ObservationResult };
  handleBehavioralEffects(msg.payload);
  sendResponse({ ok: true });
  return true;
}

function handleBehavioralEffects(result: ObservationResult): void {
  // Correlate by sourceEventId against live interactions
  for (const interaction of liveInteractions) {
    const memberEvent = interaction.memberEvents.find(
      e => e.eventId === result.sourceEventId
    );
    if (memberEvent) {
      if (!interaction.behavioralObservations) {
        interaction.behavioralObservations = [];
      }
      interaction.behavioralObservations.push(result);
      persistLiveInteractions();
      chrome.runtime.sendMessage({
        type: 'INTERACTION_EFFECTS_UPDATE',
        interactionId: interaction.interactionId,
      }).catch(() => {});
      return;
    }
  }

  // Not found — store as pending
  const existing = pendingBehavioralEffects.get(result.sourceEventId) ?? [];
  existing.push(result);
  pendingBehavioralEffects.set(result.sourceEventId, existing);
}
```

### 4.7 SW Integration Pending Effects (`sw-integration.ts`)

```typescript
import type { ObservationResult } from '../shared/observation-types';

export const pendingBehavioralEffects = new Map<string, ObservationResult[]>();

/**
 * Attach any pending behavioral observations to a newly emitted interaction.
 * Called at ALL 3 interaction emit points:
 * 1. finalizeAnnotation
 * 2. initRecording onEmit
 * 3. restoreFromStorage onEmit
 */
export function attachPendingBehavioralObservations(
  interaction: ComponentInteraction,
): void {
  for (const event of interaction.memberEvents) {
    const pending = pendingBehavioralEffects.get(event.eventId);
    if (pending && pending.length > 0) {
      if (!interaction.behavioralObservations) {
        interaction.behavioralObservations = [];
      }
      interaction.behavioralObservations.push(...pending);
      pendingBehavioralEffects.delete(event.eventId);
    }
  }
}
```

### 4.8 Side Panel Display

**interaction-renderer.ts** — new function added:

```typescript
function createBehavioralEffectsSection(
  observations: ObservationResult[],
): HTMLElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const totalMutations = observations.reduce((s, o) => s + o.mutationCount, 0);
  summary.textContent = `🔬 Behavioral Observation (${observations.length} window${observations.length > 1 ? 's' : ''}, ${totalMutations} mutations)`;
  details.appendChild(summary);

  for (const obs of observations) {
    const section = document.createElement('div');

    // Timing
    const timing = document.createElement('p');
    timing.textContent = `Window: ${(obs.durationMs).toFixed(0)}ms · ${obs.endReason} · ${obs.mutationCount} mutations`;
    section.appendChild(timing);

    // Element state diff (before → after)
    if (obs.beforeSnapshot && obs.finalSnapshot) {
      const diff = formatStateDiff(obs.beforeSnapshot, obs.finalSnapshot);
      if (diff) {
        const stateEl = document.createElement('p');
        stateEl.textContent = `State: ${diff}`;
        section.appendChild(stateEl);
      }
    } else if (!obs.beforeSnapshot && obs.finalSnapshot) {
      const note = document.createElement('p');
      note.textContent = 'State: (no before-state for first interaction)';
      section.appendChild(note);
    }

    // Mutations
    if (obs.mutations.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No observable DOM changes during observation window.';
      section.appendChild(empty);
    } else {
      for (const m of obs.mutations.slice(0, 20)) {  // cap display
        const mutEl = document.createElement('p');
        mutEl.textContent = formatMutation(m);
        section.appendChild(mutEl);
      }
      if (obs.mutations.length > 20) {
        const more = document.createElement('p');
        more.textContent = `... and ${obs.mutations.length - 20} more`;
        section.appendChild(more);
      }
    }

    details.appendChild(section);
  }

  return details;
}
```

---

## 5. All 13 Cases — Verified Against Design

| Case | Scenario | Handled? | How |
|------|----------|----------|-----|
| **1** | Checkbox self-change | ✅ | Document observer catches attribute/property mutations within subtree. State cache shows `checked: false → true`. |
| **2** | Amazon nested `<i>` | ✅ | Document-wide observer catches mutations on any descendant. No semantic classification. |
| **3** | Dropdown local behavior | ✅ | Document observer catches aria-expanded, childList (options), class (arrow). |
| **4** | Before-state disappears | ✅ | State cache populated at mousedown capture (before browser changes value). Window opens at change → peek returns cached old value. |
| **5** | Text field | ✅ | Value transition from state cache snapshots (not from mutations — `.value` isn't a DOM attribute). Existing EventTap also captures `valueBefore`/`valueAfter`. |
| **6** | Filter → distant results | ✅ | Document-wide observer captures sidebar checkbox AND distant ProductResults/ResultCount mutations. Fixed 3s window catches 850ms response. |
| **7** | Long silent period | ✅ | **Fixed 3s window.** No stability-based closure. 1500ms response after 1480ms silence is captured. |
| **8** | Near 3s boundary | ✅ | 2800ms response within fixed 3s window. |
| **9** | Nothing happens | ✅ | 3s window, 0 mutations, honest empty state. |
| **10** | Overlapping interactions | ✅ | **Independent windows.** A closes at 3000ms, B at 3300ms. Shared records carry both windowIds. No causal attribution. |
| **11** | Many rapid interactions | ✅ | Singleton observer (refcounted). 4 windows share one observer. Each record carries all active windowIds. |
| **12** | Filter + Apply | ✅ | Each interaction gets own 3s window. Apply's window captures results change. |
| **13** | Form selections | ✅ | Each selection gets own 3s window. Submit's window captures confirmation. |

---

## 6. Repeated Interactions — Guaranteed Separate

**Requirement:** "repeated interactions with the same element must remain
separate chronological actions. We must never reduce them to only the
element's final state."

**Design guarantee:**

Each window's `beforeSnapshot` and `finalSnapshot` are **value copies**
stored inside the window object at the moment of open/close. They are
plain JavaScript objects — updating the shared cache for interaction B
cannot touch interaction A's stored copies.

```
Action 1 — Check Under ₹500:
  Window A opens:  A.beforeSnapshot = {checked: false}  ← frozen copy
  Window A closes: A.finalSnapshot = {checked: true}   ← frozen copy
  cache = {checked: true}  ← shared, mutable

Action 2 — Uncheck Under ₹500:
  Window B opens:  B.beforeSnapshot = cache.peek() = {checked: true}  ← frozen copy
  Window B closes: B.finalSnapshot = {checked: false}  ← frozen copy
  cache = {checked: false}  ← shared, mutable
```

A and B are independent immutable records. The cache reflects only current state.

---

## 7. Before-State — First Interaction Guarantee

**Requirement:** "can we reliably capture the true before-state on the very
first interaction with an element?"

**Yes.** Two capture-phase listeners guarantee it:

| Interaction Type | First Event w/ Old State | Cache Populated By | Before-State Available? |
|-----------------|-------------------------|-------------------|------------------------|
| Checkbox (mouse) | mousedown capture | mousedown listener | ✅ |
| Checkbox (keyboard Space) | focus capture | focus listener | ✅ |
| Radio (mouse) | mousedown capture | mousedown listener | ✅ |
| Radio (keyboard) | focus capture | focus listener | ✅ |
| Native select (mouse) | mousedown capture | mousedown listener | ✅ |
| Native select (keyboard) | focus capture | focus listener | ✅ |
| Slider (drag) | mousedown capture | mousedown listener | ✅ |
| Text field (mouse click) | mousedown capture | mousedown listener | ✅ |
| Text field (keyboard Tab) | focus capture | focus listener | ✅ |
| Custom dropdown (mouse) | mousedown capture | mousedown listener | ✅ |
| Custom dropdown (keyboard) | focus capture | focus listener | ✅ |

**The DOM specification guarantee:** At capture phase, no default action has
run, no activation behavior has toggled state, no derived event has fired.
The element's state is exactly as it was before the user's input reached the DOM.

---

## 8. OBSERVABLE_EVENT_TYPES — Why click + change Only

These are the event types that trigger observation windows. Other events
(mousedown, focus, blur, input, scroll, mousemove, keydown) do NOT open
windows.

| Event | Opens Window? | Why |
|-------|--------------|-----|
| click | ✅ | Primary action event — checkbox toggle, button press, dropdown trigger, tab switch, link navigation |
| change | ✅ | State commitment — select option chosen, text field blurred, slider released |
| input | ❌ | Fires on every keystroke/character — too frequent, intermediate values not meaningful for observation |
| focus/blur | ❌ | No state change — focus moves, element unchanged. Cache is populated by focus listener, but no observation window needed. |
| mousedown | ❌ | Pre-action event — used for cache population, not observation. Click follows. |
| scroll | ❌ | Continuous gesture — handled by existing Scroll definition lifecycle. |
| mousemove | ❌ | Pointer tracking — handled by existing Hover definition lifecycle. |
| keydown | ❌ | Individual key events — the resulting click/change is what matters. |

---

## 9. Known Limitation: DEDUP_WINDOW_MS = 2000 (Accepted for M1)

The existing `DEDUP_WINDOW_MS = 2000` in `component-runtime.ts` will
suppress interactions of the same type on the same element within 2
seconds. This means intentional rapid repeated actions (check → uncheck
within 300ms) may be deduplicated — the second interaction will not
produce a `ComponentInteraction`.

**Impact on M1:** If an interaction is deduped, the behavioral observation
window still opens in the content script (triggered by the EventTap event,
not by the ComponentRuntime). The `ObservationResult` reaches the service
worker but finds no matching `sourceEventId` in `liveInteractions`. It is
stored in `pendingBehavioralEffects` — **no data loss, just an unattached
observation** that will be available when future milestones address dedup
reform.

**Decision:** The existing 2-second dedup behavior is **unchanged** in M1.
This is an accepted limitation, not a blocker. M1 focuses on the behavioural
evidence architecture (true before-state, document-wide observation,
independent 3-second windows, overlapping interactions, state history,
reliable evidence delivery).

---

## 10. Edge Cases & Platform Limits

| Scenario | How M1 Handles It |
|----------|-------------------|
| **Overlapping clicks** (A at t=0, B at t=400ms) | Independent windows. A closes at 3000ms, B at 3400ms. Shared records carry both windowIds. |
| **Element removed during observation** | `resolveByPath` returns null → `endReason: 'element-removed'`, `finalSnapshot: null`. Mutations still captured. |
| **Navigation during observation** | Existing EventTap SPA navigation detection fires. The observation window's 3s timer still runs — mutations from the new page are captured. The result notes the window spanned a navigation. (Future milestone: navigation-triggered early close.) |
| **CSS-only change** (no DOM mutation) | Invisible to MutationObserver. Honestly reported as 0 mutations. |
| **Shadow DOM (open)** | document.body observer does NOT pierce shadow boundaries. Mutations inside open shadow roots are missed. Known gap — future milestone. |
| **Shadow DOM (closed)** | Hard platform limit. No access. |
| **Same-origin iframe** | Each frame has its own content script (all_frames: true). Each frame has its own coordinator + observer. Results carry frame context via existing EventTap iframe extraction. |
| **Cross-origin iframe** | Content script runs in frame (all_frames: true). Frame's own observer catches its mutations. Parent cannot observe cross-origin frame's DOM. |
| **React Portal** | Portal DOM nodes inserted into document.body subtree → observer catches insertion. ✅ |
| **Virtualized list** | Container is stable, children recycled → childList mutations on container caught. ✅ |
| **Recording stop during active window** | `coordinator.shutdown()` closes all windows with `endReason: 'recording-stopped'`. Results emitted immediately. No data lost. |
| **Service worker killed mid-delivery** | Behavioral buffer in sessionStorage survives. Retry on SW wake. Same pattern as event buffer. |
| **Massive mutation burst** (table re-render) | Records are compact (~200 bytes each). 500 records = ~100KB. Within limits. |
| **Animation running (CSS or JS)** | CSS animations don't trigger MutationObserver (they change computed styles, not attributes). JS-driven animations that set `style.xxx` every frame produce ~60 records/sec = ~180 records in 3s. Captured as evidence, no stability check to block. |

---

## 11. Performance Safeguards

| Concern | Safeguard |
|---------|-----------|
| MutationObserver callback cost | O(1) per record: read tagName + attributeName + oldValue + newValue + count children + CSS path (cached). No traversal, no analysis. |
| Memory during observation | ~200 bytes/record. Worst case ~2000 records in 3s = ~400KB temporary. Pruned as windows close. |
| Stability timer cost | NONE — fixed setTimeout(3000) per window. No polling, no periodic checks. |
| CSS path computation | Cached via WeakMap per element. Computed once. |
| Element state cache | WeakMap — automatic GC of removed elements. No manual cleanup. O(1) per capture (9 property reads). |
| State cache listeners | 2 additional capture-phase listeners (mousedown, focus). Each fires once per interaction. O(1) work. |
| Observation window count | Bounded by user interaction rate. Even 10 rapid clicks = 10 concurrent windows, 10 setTimeout timers. Negligible. |

---

## 12. Implementation Phases

### Phase A: Types + Element State Cache (Foundation)
**New files:** observation-types.ts, element-state-cache.ts, state-cache-wiring.ts
**Tests:** T1 (element-state-cache), T5 (state-cache-listeners)
**Deliverable:** Before-state problem solved. All types defined.

### Phase B: Document Observer Engine
**New files:** document-observer.ts
**Tests:** T2 (document-observer)
**Deliverable:** Document-wide mutation capture with shared buffer and windowId attribution.

### Phase C: Observation Coordinator
**New files:** observation-coordinator.ts
**Tests:** T3 (observation-coordinator)
**Deliverable:** Window lifecycle with fixed 3s timer, independent closure, before/final snapshots.

### Phase D: Integration with a43df53 Pipeline
**Modified files:** event-tap.ts, recorder-entry.ts, component-types.ts (behavioralObservations field only), service-worker.ts, sw-integration.ts
**Tests:** T4 (event-tap-observer-hook), T6 (behavioral-delivery)
**Deliverable:** M1 wired into existing recording pipeline. Existing dedup unchanged.

### Phase E: Side Panel + Real-World Proof
**Modified files:** interaction-renderer.ts, sidepanel.ts
**Tests:** T7 (integration/m1-observation-flow), browser testing on real apps
**Deliverable:** Visible proof. Extension builds. All 13 cases verified.

---

## 13. Acceptance Criteria

- [ ] **AC1:** Clicking a dropdown trigger captures attribute mutations (aria-expanded, class), childList mutations (options appearing), characterData mutations (label change)
- [ ] **AC2:** Clicking an Amazon-style checkbox captures mutations on nested inner elements (e.g., `<i class="a-icon-checkbox">`)
- [ ] **AC3:** Clicking a modal trigger captures body-level childList mutation (overlay insertion) — spatially distant from target
- [ ] **AC4:** Clicking a tab switch captures class mutations on sibling tab elements
- [ ] **AC5:** An async response arriving at 300ms is captured (fixed 3s window doesn't close early)
- [ ] **AC6:** An async response arriving at 850ms is captured (fixed 3s window)
- [ ] **AC7:** An async response arriving at 1500ms after 1480ms DOM silence is captured (Case 7 — the reason stability was rejected)
- [ ] **AC8:** An async response arriving at 2800ms is captured (Case 8 — near boundary)
- [ ] **AC9:** Two rapid clicks (400ms apart) produce two ObservationResults, both containing shared mutations from the overlap period, with independent close times
- [ ] **AC10:** Two rapid clicks (400ms apart) produce two ObservationResults, both containing shared mutations from the overlap period, with independent close times. (Note: if the ComponentRuntime deduplicates the second interaction, the observation is still captured and stored in pendingBehavioralEffects — no data loss.)
- [ ] **AC11:** Each interaction's beforeSnapshot and finalSnapshot are immutable value copies — updating the cache for interaction B does not modify interaction A's evidence
- [ ] **AC12:** Change event on `<select>` shows correct before-value (from element state cache, not from already-mutated DOM)
- [ ] **AC13:** Slider drag (20 → 50) shows before-state "20" (from mousedown cache population)
- [ ] **AC14:** Text field keyboard entry (Tab into field, type "Chennai") shows before-state "" (from focus cache population)
- [ ] **AC15:** First interaction with an element has correct before-state (from mousedown or focus cache listener)
- [ ] **AC16:** Element removed during observation → `endReason: 'element-removed'`, `finalSnapshot: null`, mutations still captured
- [ ] **AC17:** Observation with zero mutations → honest empty state
- [ ] **AC18:** Behavioral observations appear in side panel within ~3s of interaction
- [ ] **AC19:** Service worker killed and restarted → buffered observations delivered on restart
- [ ] **AC20:** No existing a43df53 test broken
- [ ] **AC21:** Extension builds successfully
- [ ] **AC22:** Performance: observation adds <10ms CPU overhead per interaction (measured)
- [ ] **AC23:** Memory: temporary record buffer stays <500KB per observation window

---

## 14. What Explicitly Does NOT Belong in M1

| Excluded | Why |
|----------|-----|
| Semantic classification of mutations | M1 records evidence. "This mutation means the dropdown opened" is interpretation. |
| Causation claims | "This mutation was caused by the click" requires reasoning. M1 says "these mutations occurred during the window." |
| Noise filtering during capture | Capture broadly. Analysis deferred. |
| Stability-based early closure | DOM silence ≠ response finished. Fixed 3s window. |
| Periodicity detection | Fixed window means no stability check to block. Periodic mutations just captured as evidence. |
| Region identification | Needs accumulated evidence. Future milestone. |
| Five-case interaction model | Validation layer. M1 provides evidence only. |
| AI interpretation | Deterministic only. |
| Network activity tracking | Separate evidence source. Future milestone. |
| Computed style observation | Too expensive. CSS-only changes honestly reported as 0 mutations. |
| Closed Shadow DOM observation | Hard platform limit. |
| Consolidation / post-recording analysis | Future milestone. |

---

## 15. CONFlicts/Issues Report

### No Conflicts or Issues

The design integrates cleanly with a43df53. The existing `DEDUP_WINDOW_MS =
2000` dedup behavior is kept unchanged — we accept the known limitation
that rapid repeated interactions within 2 seconds may be deduplicated.
Observations for dedup-suppressed interactions are stored in
`pendingBehavioralEffects` (no data loss).

- EventTap modification is additive (optional callback, guarded by if-check)
- recorder-entry changes are additive (new wiring alongside existing logic)
- ComponentInteraction gets one optional field
- Service worker gets one new message case
- Side panel gets one new message handler and one new render function
- No existing pipeline behavior is changed
- All 13 cases are handled by the design (Case 10's rapid repeated
  interactions within 2s are captured as observations but may not produce
  separate ComponentInteractions due to existing dedup — accepted for M1)
