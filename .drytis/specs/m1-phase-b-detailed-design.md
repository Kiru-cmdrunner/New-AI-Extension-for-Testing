# M1 Phase B — Document Observer Engine: Final Coding Design

**Status:** IMPLEMENTED — all tests passing.
**Baseline:** a43df53 + Phase A (observation-types.ts, element-state-cache.ts, state-cache-listeners.ts)
**Phase B modifies ZERO existing files.** Adds 1 source file + 1 test file.

---

## 0. Agreed Decisions (from design discussion)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Capture ALL attribute mutations including `style` | M1 preserves observable evidence. Noise is a deferred analysis concern, not a capture-time decision. |
| D2 | Remove fixed 2,000-record cap | The fixed 3-second window + pruning on window close provides the natural bound. No silent dropping of early or later mutations. |
| D3 | Record high-mutation-volume as a performance condition | If an unusually large batch arrives, measure it (count, wall time) and store the measurement in the window result. Do NOT claim evidence is missing unless a record was actually not captured. |
| D4 | Defer open Shadow DOM observation | Document as a known M1 coverage limitation. Handle properly as a focused future capability. |
| D5 | Compute CSS path at mutation time with WeakMap caching | Temporal fidelity: the path reflects the element's actual position when the mutation occurred. First encounter is O(depth), subsequent are O(1). |
| D6 | Class-owned DocumentObserver (not module-level singleton) | Test isolation (fresh instance per test), explicit ownership by the coordinator (Phase C). |

---

## 1. What Phase B Delivers

A **`DocumentObserver` class** that captures ALL DOM mutations across `document.body` during observation windows. Singleton MutationObserver with refcounting — one observer shared across all active windows.

**Complementary two-source strategy:**
- **Phase A** (Element State Cache): DOM **properties** (`.value`, `.checked`) — irrecoverable by MutationObserver.
- **Phase B** (DocumentObserver): DOM **attributes, text, structure** with old→new transitions — irrecoverable by property reads.

Neither alone covers every component type. Phase B does NOT assume the clicked element is the state holder.

---

## 2. Files

### New Source File

| File | Est. Lines | Responsibility |
|------|-----------|----------------|
| `src/tap/document-observer.ts` | ~180 | DocumentObserver class — singleton MutationObserver on document.body, O(1) callback, shared record buffer with windowId attribution, refcounting, pruning, CSS path cache, performance condition tracking. |

### New Test File

| File | Est. Tests | Coverage |
|------|-----------|----------|
| `tests/tap/document-observer.test.ts` | ~15 | All public API methods, refcounting, attribution, pruning, performance condition, reset. |

### Modified Files

**ZERO.** Phase B is standalone, same as Phase A. Phase C (Observation Coordinator) will import it.

### Types

Uses `MutationRecord2` from Phase A's `src/shared/observation-types.ts`. No new types needed.

---

## 3. Class Design

### 3.1 Public API

```typescript
export class DocumentObserver {
  /**
   * Start observing for a window. Refcounted — the MutationObserver
   * connects on the first start() and stays connected until the last
   * stop(). Multiple start() calls with different windowIds add to
   * the active set but do NOT create additional MutationObservers.
   */
  start(windowId: string): void;

  /**
   * Stop observing for a window. Decrements refCount. When refCount
   * reaches 0, disconnects the MutationObserver.
   * Safe to call with an unknown windowId (no-op).
   */
  stop(windowId: string): void;

  /**
   * Get all records attributed to this window.
   * Returns copies — caller can mutate without affecting the buffer.
   * Called by coordinator on window close.
   */
  getRecordsForWindow(windowId: string): MutationRecord2[];

  /**
   * Total number of records attributed to this window.
   * (Equivalent to getRecordsForWindow(id).length — kept as a
   * separate method for interface clarity and O(n) without copy.)
   */
  getTotalRecordsDuringWindow(windowId: string): number;

  /**
   * Remove records that ONLY belong to this window from the buffer.
   * Records also attributed to other active windows survive with
   * this windowId removed from their list.
   * Called by coordinator after collecting records for window close.
   */
  pruneWindowRecords(windowId: string): void;

  /**
   * Full reset — disconnect observer, clear all state.
   * Called on stopRecording (via coordinator).
   */
  reset(): void;

  // ── Testing / introspection ─────────────────────────────────

  /** Currently active window IDs (for tests/debugging). */
  getActiveWindowIds(): string[];

  /** Current buffer length (for memory monitoring/tests). */
  getBufferLength(): number;

  /**
   * Performance condition from the most recent callback batch.
   * Null if no high-volume batch has occurred. Reset on reset().
   */
  getPerformanceCondition(): PerformanceCondition | null;
}
```

### 3.2 Internal State

```typescript
/** Singleton MutationObserver — created on first start(), destroyed on last stop(). */
private observer: MutationObserver | null = null;

/** Refcount: number of active windows. Observer runs while > 0. */
private refCount: number = 0;

/** Set of currently active window IDs. Snapshotted into each record's windowIds[]. */
private activeWindowIds: Set<string> = new Set();

/** Shared record buffer. One entry per MutationObserver record. */
private records: MutationRecord2[] = [];

/** Sequential record counter (for IDs). */
private recordCounter: number = 0;

/** CSS path cache. Element → path string. WeakMap for auto-GC. */
private pathCache: WeakMap<Element, string> = new WeakMap();

/** Performance condition from the most recent high-volume batch. Null if none. */
private performanceCondition: PerformanceCondition | null = null;
```

### 3.3 New Type: PerformanceCondition

This type lives in `document-observer.ts` (not `observation-types.ts`) because it's an internal concern of the document observer, not part of the evidence contract. However, the coordinator (Phase C) will surface it in `ObservationResult` — so it will be exported and added to the observation types in Phase C.

```typescript
/**
 * Performance condition recorded when a MutationObserver callback
 * batch exceeds a CPU threshold. This is a measurement, NOT evidence
 * loss. It tells the consumer: "this window experienced high DOM
 * activity; the records are all there, but they arrived in a burst."
 *
 * The consumer can use this to flag recordings that may benefit from
 * deferred noise analysis in future milestones.
 */
export interface PerformanceCondition {
  /** Number of records in the high-volume batch. */
  batchRecordCount: number;
  /** Estimated wall-clock time for the callback (performance.now delta). */
  batchDurationMs: number;
  /** When the high-volume batch occurred (performance.now()). */
  timestamp: number;
}
```

**CPU threshold for triggering:** The callback measures `performance.now()` before and after processing. If the delta exceeds the threshold, a `PerformanceCondition` is recorded.

**This is purely diagnostic/measurement evidence.** It records *what happened* (batch size, duration) without drawing any conclusion about:
- Whether the application is slow
- Whether the observation is unreliable
- Whether capture should be dropped, stopped, or throttled

**Capture continues unchanged regardless of whether the threshold is crossed.** Every record in every batch is always processed — unconditionally. The PerformanceCondition does not influence capture behavior in any way.

The threshold value (`CPU_THRESHOLD_MS = 15`, approximately one animation frame) is a **tunable constant**, not an architectural assumption. It can be adjusted later based on real-browser measurements without changing any code structure.

---

## 4. MutationObserver Configuration

```typescript
observer.observe(document.body, {
  childList: true,             // node insertions/removals anywhere in subtree
  attributes: true,            // ALL attribute changes (no attributeFilter)
  characterData: true,         // text content changes
  subtree: true,               // observe ALL descendants
  attributeOldValue: true,     // capture previous attribute value (BEFORE state)
  characterDataOldValue: true, // capture previous text value (BEFORE state)
});
```

**No `attributeFilter`:** Per Decision D1, we capture ALL attribute changes including `style`. Frameworks may set meaningful state via `style` (e.g., `display: none` → `display: block` for a modal). The noise/meaning distinction is a deferred analysis concern.

---

## 5. The O(1) Callback

```typescript
private handleMutations = (mutationList: MutationRecord[]): void => {
  const now = performance.now();

  // Snapshot active window IDs (Set → Array). If no windows are active,
  // mutations shouldn't be reaching us (observer should be disconnected),
  // but guard defensively.
  const ids = [...this.activeWindowIds];
  if (ids.length === 0) return;

  // Process every record in the batch — no cap, no break.
  // (Decision D2: the 3s window + pruning provides the natural bound.)
  const batchStart = performance.now();

  for (const m of mutationList) {
    this.records.push(this.compact(m, now, ids));
  }

  const batchDuration = performance.now() - batchStart;

  // Performance condition: record if this batch exceeded the CPU threshold.
  // This is a MEASUREMENT, not evidence loss. Every record was processed.
  if (batchDuration > CPU_THRESHOLD_MS) {
    this.performanceCondition = {
      batchRecordCount: mutationList.length,
      batchDurationMs: Math.round(batchDuration * 100) / 100,
      timestamp: now,
    };
  }
};
```

### 5.1 The `compact()` Function

One `MutationRecord` (browser native) → one `MutationRecord2` (our compact record).

```typescript
private compact(m: MutationRecord, ts: number, windowIds: string[]): MutationRecord2 {
  // characterData mutations target Text nodes, not Elements.
  // Resolve to the parent Element for CSS path computation.
  const targetEl = m.target instanceof Element
    ? m.target
    : (m.target.parentElement ?? document.body);

  const id = ++this.recordCounter;

  // Read newValue IMMEDIATELY — the DOM will mutate again before deferred analysis.
  // For childList, there's no "value" — we record counts.
  let newValue: string | null = null;
  if (m.type === 'attributes' && m.attributeName) {
    newValue = targetEl.getAttribute(m.attributeName);
  } else if (m.type === 'characterData') {
    newValue = m.target.textContent;
  }

  return {
    id,
    type: m.type as 'attributes' | 'childList' | 'characterData',
    targetPath: this.getPath(targetEl),
    targetTag: targetEl.tagName,
    attributeName: m.attributeName ?? null,
    oldValue: m.oldValue ?? null,   // provided by MutationObserver config
    newValue,                        // read from live DOM
    addedNodesCount: m.addedNodes.length,
    removedNodesCount: m.removedNodes.length,
    timestamp: ts,
    windowIds: [...windowIds],       // copy, not reference — critical for pruning correctness
  };
}
```

**O(1) per record (amortized):**
- `m.target` → already available from MutationRecord (O(1))
- `getAttribute()` / `textContent` → one property read (O(1))
- `getPath()` → WeakMap lookup (O(1) cached, O(depth) first encounter)
- `m.addedNodes.length` / `m.removedNodes.length` → array property (O(1))
- `windowIds` copy → O(k) where k = active windows (typically <10)

---

## 6. CSS Path Computation (Decision D5)

```typescript
/** CPU threshold for performance condition (one animation frame). */
private static readonly CPU_THRESHOLD_MS = 15;

private getPath(el: Element): string {
  let path = this.pathCache.get(el);
  if (path) return path;
  path = this.computePath(el);
  this.pathCache.set(el, path);
  return path;
}

private computePath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;

    const sameTagSiblings = Array.from(parent.children).filter(
      (s) => s.tagName === current!.tagName
    );

    if (sameTagSiblings.length === 1) {
      parts.unshift(tag);
    } else {
      parts.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
    }

    current = parent;
    depth++;
  }

  return parts.length > 0 ? `body > ${parts.join(' > ')}` : 'body';
}
```

**Why computed at mutation time (not deferred):**
- **Temporal fidelity:** The path reflects the element's actual position in the DOM tree at the moment the mutation occurred. If the DOM restructures later (siblings inserted/removed), the deferred path would be wrong. Even the element itself may be removed before window close, making deferred computation impossible.
- **Amortized O(1):** WeakMap cache means first encounter pays O(depth), all subsequent encounters are O(1).
- **Cost is negligible:** Even worst-case realistic scenarios (500 new elements at depth 15) complete in <1ms.

**Path purpose:** Display and deferred filtering only. NOT used for element resolution at window close (Phase C handles that via direct element reference).

**Path staleness:** An element's cached path can become stale if siblings are inserted/removed before it. The path reflects the first-encounter position. This is a display concern, not a correctness concern. The record's `timestamp` and `oldValue`/`newValue` remain accurate regardless of path staleness.

---

## 7. Refcounting

### 7.1 start(windowId)

```typescript
start(windowId: string): void {
  this.activeWindowIds.add(windowId);
  this.refCount++;

  if (this.observer) return;  // already running

  this.observer = new MutationObserver(this.handleMutations);
  this.observer.observe(document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });
}
```

### 7.2 stop(windowId)

```typescript
stop(windowId: string): void {
  if (!this.activeWindowIds.has(windowId)) return;  // unknown window — no-op
  this.activeWindowIds.delete(windowId);
  this.refCount--;

  if (this.refCount <= 0 && this.observer) {
    this.observer.disconnect();
    this.observer = null;
    this.refCount = 0;
  }
}
```

**Safety:** Extra `stop()` calls with unknown windowIds are no-ops. `refCount` is clamped to 0.

---

## 8. Record Retrieval and Pruning

### 8.1 getRecordsForWindow

```typescript
getRecordsForWindow(windowId: string): MutationRecord2[] {
  // Return copies so the caller (coordinator) can store them
  // in ObservationResult without sharing references with the buffer.
  return this.records
    .filter(r => r.windowIds.includes(windowId))
    .map(r => ({ ...r }));  // shallow copy — MutationRecord2 has no nested objects
}
```

### 8.2 getTotalRecordsDuringWindow

```typescript
getTotalRecordsDuringWindow(windowId: string): number {
  return this.records.filter(r => r.windowIds.includes(windowId)).length;
}
```

### 8.3 pruneWindowRecords

```typescript
pruneWindowRecords(windowId: string): void {
  this.records = this.records.filter(r => {
    const hasOtherWindows = r.windowIds.some(id => id !== windowId);
    if (hasOtherWindows) {
      // Remove this windowId from the record's attribution list
      r.windowIds = r.windowIds.filter(id => id !== windowId);
      return true;
    }
    // This record ONLY belonged to the closing window — remove it
    return false;
  });
}
```

**Pruning invariant:** After pruning windowId X, no record in the buffer has X in its `windowIds`. Records that also belonged to other windows survive with X removed.

---

## 9. reset()

```typescript
reset(): void {
  if (this.observer) {
    this.observer.disconnect();
    this.observer = null;
  }
  this.refCount = 0;
  this.activeWindowIds.clear();
  this.records = [];
  this.recordCounter = 0;
  this.performanceCondition = null;
  // Note: pathCache is WeakMap — no explicit clear needed.
  // Elements no longer in DOM will be GC'd automatically.
  this.pathCache = new WeakMap();
}
```

---

## 10. Buffer Management — No Cap (Decision D2)

The shared record buffer has **no fixed cap**. Here is why this is safe:

**Natural bound from the 3-second window:**
- Each observation window lasts exactly 3 seconds.
- Pruning happens on window close (every 3s per interaction).
- Records not attributed to any remaining window are removed.
- With N overlapping windows, the buffer holds records from at most N windows' lifetimes.

**Realistic worst-case scenarios:**

| Scenario | Records in 3s | Memory (~200 B/record) |
|----------|--------------|----------------------|
| Normal interaction (dropdown, modal, checkbox) | 5-30 | 1-6 KB |
| React table re-render (500 rows) | ~500 | ~100 KB |
| CSS animation (10 elements, 60fps) | ~1800 | ~360 KB |
| Extreme: 5 overlapping windows + animation | ~9000 | ~1.8 MB |

All within acceptable bounds for a browser extension content script.

**What if a pathological case occurs?** The `PerformanceCondition` measurement records it. The records are all captured (no cap, no drop). The consumer knows the window was high-volume. Deferred analysis (future milestone) can filter noise from the complete evidence.

---

## 11. Known M1 Coverage Limitation: Open Shadow DOM (Decision D4)

### The Gap

`document.body` MutationObserver with `subtree: true` observes the light DOM tree rooted at `body`. Shadow roots are **separate node trees** — `subtree: true` does NOT cross shadow boundaries.

**What M1 captures for a Shadow DOM component:**
- Mutations on the **host element** in light DOM (attribute changes, class changes, childList for slotted content changes).
- If the component reflects meaningful state to its host element's attributes (best practice for accessibility), M1 captures it via `attributeOldValue`.

**What M1 misses:**
- ALL mutations inside the shadow root — internal state changes, internal class changes, internal structural changes.
- If the component keeps state entirely inside the shadow root without reflecting to the host, M1 captures zero meaningful mutations for that interaction.

**Why deferred:**
- Correct shadow root observation requires a sub-observer subsystem: finding existing shadow roots, attaching observers, detecting dynamically created roots, managing lifecycle. This is a focused capability, not a Phase B addition.
- None of the 13 real-world cases or Amazon/AdaniOne failures involve Shadow DOM components.
- The gap is orthogonal to the spatial/temporal/before-state problems M1 solves.

**How the gap is surfaced:**
- Side panel (Phase E) will display mutation evidence honestly — if 0 mutations were captured, the UI says so.
- This spec document explicitly documents the limitation.
- Future milestone will address open Shadow DOM observation as a dedicated capability.

---

## 12. Shadow DOM and iframe Boundaries (Complete Picture)

| Boundary | M1 Coverage | How |
|----------|-------------|-----|
| Light DOM (document.body subtree) | ✅ Full | MutationObserver with subtree:true |
| Open Shadow DOM | ❌ Not covered | Known M1 limitation (D4). Host element mutations captured; internal mutations missed. |
| Closed Shadow DOM | ❌ Hard platform limit | No DOM access from outside. |
| Same-origin iframe | ✅ Full (per-frame) | Each frame has its own content script (all_frames:true) with its own DocumentObserver. Frame's internal mutations captured by frame's own observer. |
| Cross-origin iframe | ✅ Full (per-frame) | Same as same-origin — each frame has its own content script and observer. |

---

## 13. Real-World Example Walkthroughs

### Example 1: Native Checkbox Toggle

```
t=0ms:     User clicks <input type="checkbox">
           Phase A: mousedown capture caches {checked: false}
           Phase B: window opens (Phase C), observer starts

t=5ms:     Browser toggles .checked PROPERTY (not an attribute)
           Phase B: captures nothing — .checked is a property, invisible to MutationObserver
           Phase A: this is exactly what the cache handles

t=10ms:    Framework updates class on parent <label>
           Phase B: record {type:'attributes', attr:'class',
             old:'checkbox-label', new:'checkbox-label checked',
             path:'body > div > label'}

t=15ms:    Framework updates aria-checked on <input>
           Phase B: record {type:'attributes', attr:'aria-checked',
             old:'false', new:'true', path:'body > div > label > input'}
```

Phase B: 2 records. Phase A: before {checked:false} → after {checked:true}.

### Example 2: Amazon Custom Checkbox (nested <i>)

```
t=0ms:     User clicks <span class="a-checkbox"> containing <i class="a-icon-checkbox">
           Phase A: mousedown caches <span> state (no meaningful properties — correct)
           Phase B: window opens

t=5ms:     Amazon JS toggles class on the <i> element
           Phase B: record {type:'attributes', attr:'class',
             old:'a-icon a-icon-checkbox', new:'a-icon a-icon-checkbox checked',
             path:'body > ... > span > i'}

t=10ms:    Amazon JS updates aria-checked on <span>
           Phase B: record {type:'attributes', attr:'aria-checked',
             old:'false', new:'true', path:'body > ... > span'}
```

Phase B captures the nested <i> class change even though click target was the <span>. This is the body-wide subtree observation solving the spatial scope problem.

### Example 3: Modal Open (body-level portal)

```
t=0ms:     User clicks "Open Modal" button
           Phase B: window opens

t=50ms:    React portal inserts <div class="modal-overlay"> into document.body
           Phase B: record {type:'childList', addedNodes:1, removedNodes:0,
             path:'body'}
```

Phase B captures body-level insertion because document.body's direct children are observed. This was the case the experimental M1 target-subtree observer FAILED on.

### Example 4: Async Response at 1500ms (Case 7)

```
t=0ms:     User clicks "Search" → Phase B window opens (fixed 3s timer)
t=0-1499ms: DOM SILENCE (network request in flight)
t=1500ms:  Response arrives, React renders results
           Phase B: N records (childList for result items)
t=1520ms:  Results count text changes
           Phase B: record {type:'characterData', old:'0 results', new:'15 results'}
```

Phase B captures the delayed response because the fixed 3s window doesn't close early. No stability check to kill it at 1000ms.

### Example 5: Overlapping Interactions (Case 10)

```
t=0ms:     Click A → Window A opens → activeWindowIds = {A}
t=400ms:   Click B → Window B opens → activeWindowIds = {A, B}
t=700ms:   Results update (consequence of A, B, or both)
           Phase B: record {windowIds: [A, B]} — SHARED attribution
t=3000ms:  Window A closes
           A.mutations = records where A ∈ windowIds (includes t=700ms)
           Prune: t=700ms record survives (also belongs to B), windowIds becomes [B]
t=3400ms:  Window B closes
           B.mutations = records where B ∈ windowIds (includes t=700ms)
           Prune: t=700ms record removed (only B left)
```

Both windows receive the shared evidence. Independent lifetimes. No causal attribution.

### Example 6: High-Volume Mutation Burst (Performance Condition)

```
t=0ms:     User clicks "Sort by Date" → Phase B window opens
t=10ms:    React re-renders a 200-row table
           MutationObserver delivers 600 records in one callback batch
           Callback processes all 600 (no cap, no break)
           batchDuration = 8ms → below 15ms threshold → no PerformanceCondition
           (all records captured)

t=20ms:    Framework also triggers a CSS transition on 50 elements
           MutationObserver delivers 50 style records
           Total so far: 650 records, no performance condition

t=3000ms:  Window closes
           650 records captured. ObservationResult.mutationCount = 650.
           performanceCondition = null (no batch exceeded 15ms).
```

vs. extreme case:

```
t=10ms:    React re-renders a 2000-row virtualized table
           MutationObserver delivers 4000 records in one callback batch
           Callback processes all 4000
           batchDuration = 22ms → exceeds 15ms threshold
           performanceCondition = {batchRecordCount: 4000, batchDurationMs: 22.0}
           (all 4000 records captured — no evidence loss)
```

---

## 14. Test Plan (~15 tests)

### Setup

Each test creates a fresh `new DocumentObserver()` — automatic isolation.

Tests use `await new Promise(r => setTimeout(r, 50))` to flush MutationObserver callbacks (matching the pattern in existing `tests/evidence-engine/shadow-dom-fixes.test.ts`).

### Basic Capture (4 tests)

1. **Attribute mutation:** Set `class` on element → record has `type:'attributes'`, correct `attributeName`, `oldValue`, `newValue`
2. **childList mutation:** Append a child element → record has `type:'childList'`, `addedNodesCount:1`, `removedNodesCount:0`
3. **characterData mutation:** Change text content → record has `type:'characterData'`, correct `oldValue`, `newValue`
4. **characterData targets Text node:** Change text inside a `<span>` → `targetPath` resolves to the `<span>` (parent element of the Text node), not the Text node itself

### Refcounting (3 tests)

5. **Multiple starts share one observer:** `start('A')`, `start('B')` → `getActiveWindowIds()` returns both, only one MutationObserver exists (verify via mutation attribution, not internal state)
6. **Stop decrements correctly:** `start('A')`, `start('B')`, `stop('A')` → mutations still captured (observer still running for B); `stop('B')` → mutations no longer captured
7. **Extra stop is safe:** `stop('unknown-id')` when nothing is running → no error, no state corruption

### Window Attribution (3 tests)

8. **Single window:** Mutations during one window → all records have that windowId in `windowIds[]`
9. **Overlapping windows:** Start A and B, trigger mutation → record has both windowIds in `windowIds[]`
10. **Pruning removes closed window's exclusive records:** Records only in window A → after `pruneWindowRecords('A')`, buffer does not contain them

### Pruning Edge Cases (2 tests)

11. **Shared records survive pruning with reduced attribution:** Record belongs to [A, B] → after `pruneWindowRecords('A')` → record survives with `windowIds: ['B']`
12. **getRecordsForWindow returns copies:** Mutations captured → `getRecordsForWindow('A')` returns array → mutating a returned record does NOT affect buffer records

### Reset (1 test)

13. **Reset clears everything:** After capture + `reset()` → buffer length 0, `getActiveWindowIds()` empty, `getPerformanceCondition()` null, no further mutations captured until `start()` called again

### Performance Condition (2 tests)

14. **Performance condition recorded on high-volume batch:** Inject a very large DOM update (e.g., 1000+ elements) → `getPerformanceCondition()` returns non-null with `batchRecordCount` and `batchDurationMs`
15. **Normal volume does not trigger condition:** Small DOM change → `getPerformanceCondition()` remains null

---

## 15. What Phase B Does NOT Do

| Excluded | Why |
|----------|-----|
| Semantic classification of mutations | M1 records evidence only |
| Causation attribution | Requires reasoning — deferred |
| Noise filtering during capture | Capture broadly, analyze later (D1) |
| Buffer cap / record dropping | Natural bound from 3s window + pruning (D2) |
| Shadow DOM observation | Known M1 limitation, deferred (D4) |
| Region identification | Needs accumulated evidence |
| Stability checking | Fixed 3s window — no early closure |
| Element resolution at window close | Phase C's concern |
| Wiring to EventTap or recorder-entry | Phase D's concern |
| Claiming evidence is missing | PerformanceCondition is a measurement, not evidence loss (D3) |

---

## 16. Constants

```typescript
/** CPU threshold for performance condition recording (one animation frame at 60fps). */
const CPU_THRESHOLD_MS = 15;
```

---

## 17. Conflicts / Risks Flagged

### No New Conflicts

All six agreed decisions integrate cleanly:
- D1 (capture style) → no `attributeFilter` in observe config
- D2 (no cap) → no `MAX_BUFFER_RECORDS` constant, callback processes full batch
- D3 (performance condition) → new `PerformanceCondition` type, measured in callback
- D4 (defer Shadow DOM) → no shadow root observation code, documented as limitation
- D5 (CSS path at capture time) → WeakMap cache in `getPath()`
- D6 (class instance) → `export class DocumentObserver`

### Risk 1: JSDOM `characterDataOldValue` fidelity

JSDOM's MutationObserver implementation may not fully support `characterDataOldValue`. If the test for characterData mutations shows `oldValue: null` instead of the expected prior text, this is a JSDOM limitation, not a code bug.

**Mitigation:** Test 3 includes a fallback assertion: if `oldValue` is null in JSDOM, the test notes it as a known JSDOM limitation and verifies `newValue` is correct. In real Chrome, `oldValue` will be populated.

### Risk 2: JSDOM mutation batching differs from Chrome

JSDOM may deliver mutations in a single batch or multiple batches depending on timing. Tests that assert specific record counts should allow for batching differences by checking total count across all flushes, not per-batch count.

**Mitigation:** All tests flush with `await new Promise(r => setTimeout(r, 50))` and then assert on the full buffer, not on per-callback counts.

### Risk 3: PerformanceCondition threshold may be too low for slow CI

If CI machines are slow, a moderate DOM update (200 records) might take >15ms, triggering a false PerformanceCondition. This doesn't affect correctness (all records are still captured), but may cause test 14 to be flaky.

**Mitigation:** Test 14 injects a genuinely large update (1000+ elements) that will exceed the threshold on any machine. Test 15 uses a tiny update (1 element) that won't trigger on any machine.

---

## 18. Acceptance Criteria

- [ ] **AC1:** DocumentObserver captures attribute mutations with correct oldValue and newValue
- [ ] **AC2:** DocumentObserver captures childList mutations with correct added/removed counts
- [ ] **AC3:** DocumentObserver captures characterData mutations with correct oldValue and newValue
- [ ] **AC4:** characterData mutations on Text nodes resolve targetPath to parent Element
- [ ] **AC5:** style attribute changes are captured (no attributeFilter)
- [ ] **AC6:** Multiple start() calls share a single MutationObserver (refcounted)
- [ ] **AC7:** Observer disconnects only when last window calls stop()
- [ ] **AC8:** Extra stop() calls with unknown windowIds are safe no-ops
- [ ] **AC9:** Records during overlapping windows carry all active windowIds
- [ ] **AC10:** getRecordsForWindow returns copies (caller mutation doesn't affect buffer)
- [ ] **AC11:** pruneWindowRecords removes exclusive records, preserves shared records with reduced attribution
- [ ] **AC12:** No buffer cap — all records in a batch are processed
- [ ] **AC13:** High-volume batches record a PerformanceCondition without dropping any records
- [ ] **AC14:** Normal batches do not trigger PerformanceCondition
- [ ] **AC15:** reset() clears all state (buffer, observer, counter, performance condition)
- [ ] **AC16:** All 3,398 baseline + 20 Phase A tests still pass (zero regressions)

---

## 19. Implementation Notes

**Implemented on:** a43df53 + Phase A baseline (zero existing files modified).

**Files created:**
- `src/tap/document-observer.ts` — 367 lines (DocumentObserver class + PerformanceCondition type)
- `tests/tap/document-observer.test.ts` — 389 lines (16 tests across 6 categories)

**Test results:**
- Phase B tests: **16/16 passed**
- Full regression: **3,414 tests passed** (3,378 baseline + 20 Phase A + 16 Phase B), **0 failed**, across 143 test files

**Bug found and fixed during testing:**
- `getRecordsForWindow()` initially used shallow spread (`{ ...r }`) which didn't deep-copy the `windowIds` array. The buffer isolation test caught this — mutating `windowIds.push()` on a returned copy corrupted the buffer's original. Fixed by copying the array: `{ ...r, windowIds: [...r.windowIds] }`.

**JSDOM notes confirmed:**
- `characterDataOldValue` IS supported in JSDOM — test 3 passes with both `oldValue` and `newValue` correct.
- Mutation batching works as expected with 50ms flush delay.
- Performance condition test uses 1500-element injection — condition triggers reliably without being flaky.
