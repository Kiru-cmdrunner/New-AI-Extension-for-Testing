# Redesigned M1: Complete Behavioral Observation Foundation

## Status: DESIGN (not yet implemented — awaiting review)

## Guiding Principle

**M1 captures trustworthy evidence. M1 does not decide what that evidence
semantically means. No AI. No classification. No causality claims.**

## The Claim M1 Must Support When Complete

> For a recorded user interaction, the recorder can reliably preserve the
> relevant before/state evidence and observable behavioral consequences —
> local, distant, and delayed — within a bounded observation period, while
> handling overlapping interactions, background activity, and uncertainty
> without claiming causation or semantic meaning.

---

## 1. What Stays, What Changes, What Moves In

### Existing M1 Code That Stays As-Is

| Component | File | Why It Stays |
|-----------|------|-------------|
| Behavioral types | `src/shared/behavioral-types.ts` | Types are correct — extended, not replaced |
| EventTap onAfterEvent hook | `src/tap/event-tap.ts` | Hook fires correctly on main capture path |
| Behavioral delivery pipeline | `src/recorder/phase5/recorder-entry.ts` (buffer/retry/flush) | Same buffered delivery with exponential backoff |
| SW correlation handler | `src/background/service-worker.ts` | `handleBehavioralEffects()` attaches by eventId |
| Pending effects | `src/runtime/sw-integration.ts` | `pendingBehavioralEffects` + attach at 3 entry points |
| ComponentInteraction field | `src/shared/component-types.ts` | `behavioralObservations?: BehavioralObservation[]` |
| Side panel refresh | `src/sidepanel/sidepanel.ts` | `INTERACTION_EFFECTS_UPDATE` handler |
| All 29 existing M1 tests | `tests/tap/`, `tests/runtime/` | They verify correct sub-behaviors |

### Existing M1 Code That Changes

| Component | File | What Changes | Why |
|-----------|------|-------------|-----|
| Target subtree observer | `src/tap/behavioral-observer.ts` | Stability window no longer self-managed. Observer records effects but does NOT close the observation. An external coordinator manages the shared stability timer. Pre-snapshot enhanced with element state cache lookup. | M1's per-observer stability closed the window prematurely — target subtree quiet ≠ observation complete |
| Recorder wiring | `src/recorder/phase5/recorder-entry.ts` | `onAfterEvent` calls `startObservation()` (coordinator) instead of `observeBehavior()` directly. Stability constant changes. | New coordination architecture |
| Observation types | `src/shared/behavioral-types.ts` | Extended with document-wide types, capture stats, noise profile | Evidence must carry richer data |
| Side panel display | `src/sidepanel/interaction-renderer.ts` | Extended to show document effects, timing, noise profile, state transitions | Evidence must be inspectable |

### Planned M2 Pieces That Move Into M1

| Piece | Origin | Why It Belongs in M1 |
|-------|--------|---------------------|
| Document-wide MutationObserver (singleton, lightweight capture) | M2 design | Missing piece of "observe behavioral consequences" — consequences appear anywhere |
| Deferred deterministic analysis (noise filtering, proximity, consequence classification) | M2 design | Needed to make raw evidence useful without semantic interpretation |
| Periodicity detection | M2 design | Needed to prevent sub-500ms recurring mutations from preventing observation completion |
| Shared record buffer with windowId attribution | M2 design (Approach B from our discussion) | Preserves attribution ambiguity for overlapping interactions instead of duplicating evidence |
| Performance instrumentation | M2 design | Must measure actual cost, not estimate |
| Element state cache | Deferred to M3 in M2 plan | Solves the before-state problem (select.value timing) — belongs in the observation foundation |

### What Remains Deferred (NOT in M1)

| Deferred To | What | Why |
|-------------|------|-----|
| Future milestone | Region-aware observation (ARIA landmark identification, region relationship discovery) | Needs M1's complete evidence to learn from |
| Future milestone | Five-case interaction model (Case 2/3 prompts, tester feedback) | Needs validation layer — M1 provides evidence only |
| Future milestone | AI-assisted semantic interpretation | M1 is purely deterministic |
| Future milestone | Consolidation (post-recording knowledge extraction) | Needs accumulated evidence from a full session |
| Future milestone | Capability Model | Ultimate consumer of M1 evidence |
| Future milestone | Closed Shadow DOM observation | Hard platform limit |
| Future milestone | Network activity tracking (fetch/XHR interception) | Separate evidence source; M1 focuses on DOM observation |

---

## 2. The Stability Problem — Redesigned

### Why M1's Stability Was Wrong

M1's `observeBehavior` function creates a self-contained observation with its
own stability timer. The timer fires 200ms after the last mutation **in the
target subtree**. This means:

```
t=0:     click checkbox
t=5ms:   checkbox class changed (target subtree mutation, timer resets)
t=205ms: Target subtree quiet for 200ms → WINDOW CLOSES
t=850ms: ProductResults change → MISSED (window already closed)
```

The target subtree stabilizing does NOT mean the interaction's consequences
are complete. It only means the target element itself stopped changing.

### Redesigned Stability Logic

The observation has **two independent phase markers** and **one window
closure condition**:

```
LOCAL PHASE (target subtree):
  • Tracks when the target element's immediate effects are complete
  • 200ms quiet period on target subtree mutations
  • When fired: marks "local interaction stabilized at +Tms"
  • Does NOT close the observation window
  
WINDOW CLOSURE (entire document):
  Minimum duration: 1000ms from observation start
  Stability exit:   Document-wide non-periodic quiet for 500ms
                    AND minimum duration met
  Hard cap:         3000ms from observation start
```

**Why a minimum duration?**

The user's example: checkbox stabilizes at 5ms, ProductResults change at 850ms.
With a pure stability exit (500ms quiet), the window would close at 505ms —
missing the 850ms results. The minimum duration ensures the window stays open
long enough to catch delayed consequences.

**The "Under ₹500" example with redesigned stability:**

```
t=0:      click. Observation starts. [min=1000ms, stability=500ms, cap=3000ms]
t=5ms:    checkbox class change (target). Reset stability.
t=20ms:   spinner appears (document, non-target). Reset stability.
          ... 830ms gap, document is quiet ...
t=505ms:  Document quiet for 500ms. But minimum (1000ms) not reached.
          Window stays open.
t=850ms:  ProductResults change (document, non-target). ✅ CAUGHT. Reset stability.
t=870ms:  ResultCount change (document, non-target). Reset stability.
t=1370ms: Document quiet for 500ms (since t=870ms). Minimum (1000ms) met.
          → WINDOW CLOSES.
```

**Simple toggle (no delayed consequences):**

```
t=0:     click. Observation starts.
t=5ms:   class change (target). Reset stability.
t=505ms: Quiet for 500ms. But minimum (1000ms) not met.
t=1000ms: Minimum met. Quiet since t=5ms (995ms > 500ms). → CLOSE.
```

Every simple interaction takes 1000ms. Acceptable — the tester rarely clicks
again within 1 second, and the window's observer is lightweight.

**Response near 3s boundary:**

```
t=0:       click. Observation starts.
t=0-2900ms: continuous mutations (streaming render, reconciliation)
t=2900ms:  last mutation. Reset stability.
t=3000ms:  HARD CAP fires → CLOSE (endReason: 'timeout')
```

Mutations up to 2900ms are captured. The hard cap is the performance budget.

**What this DOESN'T catch:**

A response arriving at 1100ms after a gap since 20ms (document quiet from
20ms to 1100ms). The stability would fire at 520ms, but the minimum (1000ms)
keeps the window open. At 1000ms, the document has been quiet for 980ms
(>500ms stability). The window closes at 1000ms. The 1100ms response is missed.

This is a known, accepted limitation. It becomes a Case 2 finding in the
future validation layer: "action may not have completed."

**Why not just make the minimum longer?**

Every increase in minimum duration makes every simple interaction slower.
1000ms catches the user's specific example and the vast majority of normal-
speed responses. Longer minimums trade universality for recording latency.

### Periodicity Detection's Role (Redesigned)

Periodicity detection prevents **sub-500ms recurring mutations** from keeping
the stability timer perpetually reset, which would force every observation to
the 3000ms hard cap.

**Actual targets:**
- Infinite CSS animations (`animation: spin 1s infinite`) → style mutations every ~16ms
- High-frequency timers updating DOM every 100-300ms (live dashboards, clocks)
- Framework reconciliation bursts that happen at regular intervals

**NOT the target:**
- Carousels rotating every 3 seconds (don't conflict with 500ms stability)
- Ad refreshes every 5-10 seconds (don't conflict with 500ms stability)

**Mechanism:**

Track `(element, attributeName)` pairs. If the same source fires >3 mutations
at regular intervals (±30%, average interval ≥100ms), classify subsequent
mutations from that source as periodic.

Periodic mutations are:
- ✅ **Still recorded** (evidence completeness — never destroy raw evidence)
- ✅ **Still included in deferred analysis** (analyzed and classified as noise)
- ❌ **Do NOT reset the stability timer** (noise gate)

This is pure arithmetic on timestamps. No AI. No semantic interpretation.

---

## 3. Element State Cache (Before-State Preservation)

### The Problem

For `<select>` and `<input>`, the `change` event fires AFTER the browser has
updated `.value`. The observer's pre-snapshot at observation start already
sees the new value — the before-state is irrecoverably lost.

```
User clicks select → opens dropdown (value still "")
User selects "blue" → browser sets el.value = "blue" → fires change
Observer starts (capture phase) → pre-snapshot reads value = "blue"
Final snapshot → value = "blue"
No diff detected — before-state lost
```

### The Solution: Cross-Event Element State Cache

Maintain a lightweight per-session cache in the content script. When EventTap
captures ANY event on an element, cache that element's current value/checked
state BEFORE the page handler runs.

```typescript
// Cache entry: element → most recent state
Map<Element, { value: string | null; checked: boolean | null; timestamp: number }>
```

**Population points:**

The cache is populated at EventTap's capture-phase handler, for every
ObservedEvent — not just click/change. This means mousedown, focus, keydown,
etc. all cache the element's state before the page handler runs.

**Lookup in behavioral observer:**

When the observer takes a pre-snapshot, it checks the cache for a prior entry
on the target element:

```typescript
function takePreSnapshot(el: Element, eventTimestamp: number): ElementStateSnapshot {
  const cached = getCachedState(el);
  const current = readElementState(el);

  // For change events: the cached value from the PRIOR event (click, focus)
  // is the true before-state. Current value is already the new value.
  if (cached && cached.timestamp < eventTimestamp) {
    return {
      ...current,                    // className, aria, etc. from current read
      value: cached.value,           // value from BEFORE the change
      checked: cached.checked,       // checked from BEFORE the change
    };
  }

  // No prior cache (first interaction with this element) — use current
  return current;
}
```

**The select example with cache:**

```
1. User clicks select → EventTap click (capture) → cache: { value: "", t: 0 }
2. User selects "blue" → change event → EventTap change (capture)
   → Observer starts → pre-snapshot looks up cache
   → Cached: { value: "", t: 0 } (from the click at step 1)
   → Pre-snapshot value = "" (true before-state)
3. Final snapshot → value = "blue"
4. Diff: "" → "blue" ✅ DETECTED
```

**Limitations:**

- First-ever interaction with an element: no prior cache. Pre-snapshot falls
  back to current value. Before-state may be lost for the very first change
  event on a previously unseen element.
- Cache stores only `value` and `checked` (the two IDL properties invisible to
  MutationObserver). Other properties (selectedIndex, etc.) are not cached.
- Cache is per-session (content script memory). Lost on page navigation.

**What this does NOT do:**

- Does NOT poll element state on a timer (too expensive)
- Does NOT extend ElementIdentity (state is observation context, not identity)
- Does NOT solve ALL before-state problems (only the value/checked timing gap)

---

## 4. Document Observer Architecture

### Singleton with Refcounting

One MutationObserver on `document.body`, shared across all active observation
windows. Reference-counted: attaches on first `acquire()`, disconnects when
refcount reaches zero.

### Lightweight Capture

The callback builds compact raw records — O(1) per record, zero semantic
processing:

```typescript
interface RawDocumentRecord {
  // Location (all O(1) reads)
  tag: string;                     // nodeName.toLowerCase()
  id: string | null;
  testId: string | null;           // data-testid | data-cy | data-test
  className: string | null;
  role: string | null;
  isInTargetSubtree: boolean;      // targetEl.contains(node)

  // Mutation detail (from MutationRecord)
  mutationType: 'attributes' | 'childList' | 'characterData';
  attributeName: string | null;
  oldValue: string | null;         // browser-provided via attributeOldValue
  newValue: string | null;         // one getAttribute/textContent read
  nodeSummary: string | null;      // for childList: tag + truncated text
  addedNodeCount: number;
  removedNodeCount: number;

  // Timing
  offsetMs: number;                // Date.now() - windowStartTime

  // Attribution (Approach B — shared records)
  windowIds: string[];             // ALL active windows this mutation belongs to
}
```

**Why no full CSS selector or DOM path in capture?**

Path generation is O(depth) per record. For 2000 records at depth ~10:
~400ms. Too expensive in the callback. Path computation is deferred to
analysis, where it runs once on the ~20-50 meaningful effects (after noise
filtering), not on 2000 raw records.

### Shared Record Buffer (Approach B)

One physical record per mutation, shared across active windows via `windowIds`
array. During deferred analysis, each window retrieves records where its ID
appears in the `windowIds` array.

**Why this instead of one record per window?**

From our discussion: duplicating records per window silently creates false
attribution. Both windows independently claim the mutation as their
consequence. Shared records with explicit `windowIds` preserve the ambiguity:

```
Mutation at t=500ms during overlap of w1 and w2:
  → Record { ..., windowIds: ['w1', 'w2'] }

Analysis for w1: "modal appeared — also present in w2's window — ambiguous"
Analysis for w2: "modal appeared — also present in w1's window — ambiguous"
```

The future Capability Model sees "ambiguous" — not duplicated false confidence.

---

## 5. Observation Coordinator

### Why a Coordinator?

M1's `observeBehavior` is self-contained: it manages its own observers, timers,
and finalization. The redesigned M1 needs to coordinate:
- Target subtree observer (deep, from M1)
- Document-wide observer (singleton, shared)
- Element state cache (for pre-snapshots)
- Shared stability timer (document-wide, not target-only)
- Minimum duration gate
- Periodicity gate
- Deferred analysis on close
- Overlapping window management

This coordination is too complex for the `observeBehavior` function. A
coordinator orchestrates these components.

### Coordinator Lifecycle

```typescript
class ObservationCoordinator {
  /**
   * Start a complete observation for one interaction.
   * Called from recorder-entry.ts onAfterEvent (for click/change only).
   */
  startObservation(
    targetEl: Element,
    sourceEventId: string,
    eventTimestamp: number,
  ): void {
    const windowId = generateWindowId();

    // 1. Pre-snapshot with cache lookup
    const preSnapshot = takePreSnapshot(targetEl, eventTimestamp, cache);

    // 2. Start target subtree observer (from M1, but stability extracted)
    const targetEffects = startTargetObserver(targetEl);

    // 3. Acquire document observer (singleton, refcounted)
    documentObserver.acquire(windowId, eventTimestamp, targetEl);

    // 4. Register window with shared stability manager
    stabilityManager.registerWindow(windowId, {
      onStabilized: () => this.closeObservation(windowId, 'stabilized'),
      onTimeout: () => this.closeObservation(windowId, 'timeout'),
      minimumMs: 1000,
      stabilityMs: 500,
      maxMs: 3000,
    });

    // 5. Track active window
    activeWindows.set(windowId, {
      targetEl, sourceEventId, eventTimestamp,
      preSnapshot, targetEffects, startTime: eventTimestamp,
    });
  }

  /**
   * Close an observation window. Run deferred analysis, build observation,
   * deliver to SW.
   */
  closeObservation(windowId: string, endReason: string): void {
    const window = activeWindows.get(windowId);
    if (!window) return;

    // 1. Get raw document records for this window
    const rawRecords = documentObserver.release(windowId);

    // 2. Run deferred deterministic analysis
    const { documentEffects, noiseProfile, captureStats } =
      analyzeEvidence(rawRecords, window.targetEl, windowIds);

    // 3. Take final snapshot
    const finalSnapshot = window.targetEl.isConnected
      ? takeSnapshot(window.targetEl) : null;

    // 4. Build complete observation
    const observation: BehavioralObservation = {
      sourceEventId: window.sourceEventId,
      observationStartOffset: 0,
      observationEndOffset: Date.now() - window.eventTimestamp,
      endReason,
      effects: window.targetEffects.getEffects(),
      preSnapshot: window.preSnapshot,
      finalSnapshot,
      // M2-era fields (now part of M1)
      documentEffects,
      noiseProfile,
      captureStats,
      localStabilizedAt: window.localStabilizedAt,
    };

    // 5. Deliver via M1 pipeline (unchanged)
    onObservationComplete(observation);

    // 6. Cleanup
    activeWindows.delete(windowId);
  }
}
```

### Shared Stability Manager

```typescript
class StabilityManager {
  /**
   * Single timer per observation window.
   * Fed by BOTH target observer and document observer.
   * Periodic mutations don't reset the timer.
   * Minimum duration gate prevents premature close.
   */
  registerWindow(windowId, config) {
    // Start stability timer (500ms)
    // Start minimum timer (1000ms)
    // Start hard cap timer (3000ms)
  }

  /**
   * Called by target observer or document observer on non-periodic mutation.
   */
  resetStability(windowId: string): void {
    // Clear and reset the 500ms stability timer
    // (minimum and hard cap timers are NOT reset)
  }

  /**
   * Called when stability timer fires.
   */
  onStabilityFire(windowId: string): void {
    // Check: has minimum duration been met?
    if (elapsed < minimumMs) {
      // Reschedule stability check at minimumMs
      scheduleAt(minimumMs);
      return;
    }
    // Both conditions met → close
    config.onStabilized();
  }
}
```

### Overlapping Window Handling

Multiple observation windows can be active simultaneously. Each has its own:
- Target subtree observer (on its own target element)
- Stability timer (500ms quiet + 1000ms minimum + 3000ms cap)
- Pre/final snapshots
- Deferred analysis output

They SHARE:
- The singleton document observer (one observer, refcounted)
- The raw record buffer (records carry `windowIds[]`)
- The element state cache

When a mutation occurs, the document observer creates ONE record with ALL
active window IDs. Each window's stability timer is independently reset
(unless the mutation is periodic for that window).

---

## 6. Deferred Deterministic Analysis

Runs once when an observation window closes. Synchronous. Input:
`RawDocumentRecord[]`. Output: `DocumentEffect[]` + `NoiseProfile` +
`CaptureStats`.

### Pipeline

```
Step 1: FILTER — separate records for this window
  From shared buffer, select records where windowIds includes this window's ID.

Step 2: NOISE CLASSIFICATION
  Records flagged as periodic during capture → 'background-noise'
  Records from sources with >10 mutations at regular intervals → 'background-noise'
  All others → candidates

Step 3: PROXIMITY CLASSIFICATION (candidates only)
  For each record:
    isInTargetSubtree=true → 'target-scoped'
    On target's parent/sibling → 'local-region'
    Distant element → 'distant'

Step 4: CONSEQUENCE CLASSIFICATION
  childList add/remove near target → 'likely-consequence'
  attribute change on target's parent/sibling → 'likely-consequence'
  characterData near target → 'likely-consequence'
  childList or attribute change far from target → 'ambiguous'
  Overlap with other windows → add 'ambiguous: shared with window(s) [...]'

Step 5: LOCATION GROUPING
  Collapse multiple mutations on same element into summary effect.
  Example: 48 childList-remove on .product-list → 1 DocumentEffect, removedNodeCount: 48

Step 6: PATH COMPUTATION
  For each unique element in grouped effects:
    Compute relationship to target: 'self'/'descendant(3)'/'parent'/'sibling'/'distant'

Step 7: OUTPUT
  DocumentEffect[] (classified, grouped, path-attributed)
  NoiseProfile (counts, patterns)
  CaptureStats (timing, volume, truncation)
```

**What analysis does NOT do:**
- No semantic interpretation ("this is a filter checkbox")
- No component type classification ("this is a dropdown")
- No intent derivation
- No AI calls
- No causality determination

Produces STRUCTURAL facts only:
- "48 elements removed from ul.product-list at +860ms — likely-consequence"
- "class changed on div#modal-backdrop at +5ms — likely-consequence"
- "5 style changes on div.spinner classified background-noise (periodic, ~16ms)"
- "modal appeared — ambiguous: shared with window w2"

---

## 7. Complete Data Structures

### Extended BehavioralObservation

```typescript
interface BehavioralObservation {
  // ── Original M1 fields (unchanged) ──
  sourceEventId: string;
  observationStartOffset: number;
  observationEndOffset: number;
  endReason: 'stabilized' | 'timeout' | 'element-removed' | 'navigation';
  effects: RawEffect[];              // target-scoped effects (target observer)
  preSnapshot: ElementStateSnapshot; // enhanced with cache lookup
  finalSnapshot: ElementStateSnapshot | null;

  // ── Redesigned M1 fields (new) ──
  localStabilizedAt?: number;        // when target subtree stabilized (ms offset)
  documentEffects?: DocumentEffect[];// analyzed document-wide effects
  noiseProfile?: NoiseProfile;       // background activity summary
  captureStats?: CaptureStats;       // performance metadata
}
```

### New Types (in `src/shared/document-types.ts`)

```typescript
interface RawDocumentRecord { /* as defined in §4 */ }

interface DocumentEffect {
  location: {
    tag: string;
    id: string | null;
    testId: string | null;
    className: string | null;
    role: string | null;
    pathFromTarget: string;    // 'self' | 'descendant(3)' | 'parent' | etc.
    isInTargetSubtree: boolean;
  };
  mutationType: 'attributes' | 'childList' | 'characterData';
  attributeName: string | null;
  oldValue: string | null;
  newValue: string | null;
  nodeSummary: string | null;
  addedNodeCount: number;
  removedNodeCount: number;
  offsetMs: number;
  classification: 'likely-consequence' | 'ambiguous' | 'background-noise';
  classificationReason: string;
  sharedWithWindows?: string[];  // overlapping window IDs (ambiguity)
}

interface NoiseProfile {
  totalRawRecords: number;
  filteredAsConsequence: number;
  filteredAsAmbiguous: number;
  filteredAsNoise: number;
  noisePatterns: Array<{
    description: string;
    recordCount: number;
    sourceTag: string;
    sourceClassName: string | null;
    averageIntervalMs: number;
  }>;
}

interface CaptureStats {
  windowDurationMs: number;
  rawRecordCount: number;
  maxCallbackBatchSize: number;
  totalCallbackTimeMs: number;
  truncated: boolean;
  truncatedReason: string | null;
  periodicSourcesSuppressed: number;
}
```

---

## 8. Module and File Plan

### New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `src/tap/element-state-cache.ts` | Per-session cache of element value/checked for before-state | ~80 |
| `src/tap/document-observer.ts` | Singleton document-wide MutationObserver: refcounting, lightweight capture, periodicity detection, shared record buffer | ~400 |
| `src/tap/observation-coordinator.ts` | Orchestrates target + document observers, shared stability, minimum duration, overlapping windows, deferred analysis trigger | ~350 |
| `src/tap/stability-manager.ts` | Shared stability timer logic: 500ms quiet + 1000ms minimum + 3000ms cap, periodicity gate | ~200 |
| `src/tap/deferred-analysis.ts` | Deterministic post-window analysis: noise filtering, proximity, consequence, grouping, path | ~300 |
| `src/shared/document-types.ts` | Type definitions: RawDocumentRecord, DocumentEffect, NoiseProfile, CaptureStats | ~120 |
| `tests/tap/element-state-cache.test.ts` | Unit tests: cache population, lookup, fallback | ~150 |
| `tests/tap/document-observer.test.ts` | Unit tests: singleton, refcount, capture, periodicity, shared records | ~500 |
| `tests/tap/observation-coordinator.test.ts` | Integration tests: full lifecycle, overlapping windows, stability | ~400 |
| `tests/tap/deferred-analysis.test.ts` | Unit tests: noise filtering, classification, grouping, path | ~400 |

### Modified Files

| File | Changes |
|------|---------|
| `src/tap/behavioral-observer.ts` | Extract stability management to coordinator. `observeBehavior` becomes `startTargetObserver` — records effects but doesn't manage timers. Pre-snapshot enhanced with cache lookup. Export `takeSnapshot` and `summarizeNode` for reuse. |
| `src/recorder/phase5/recorder-entry.ts` | `onAfterEvent` calls `coordinator.startObservation()` instead of `observeBehavior()`. Wire element state cache to EventTap. Update `disconnectAll` to call `coordinator.releaseAll()`. |
| `src/shared/behavioral-types.ts` | Add optional redesigned M1 fields to `BehavioralObservation`. |
| `src/sidepanel/interaction-renderer.ts` | Add `createDocumentEffectsSection()`, `createStateTransitionSection()`, `createTimingSection()`, `createNoiseProfileSection()`. |

### Unchanged Files

| File | Why |
|------|-----|
| `src/tap/event-tap.ts` | `onAfterEvent` hook already provides what we need |
| `src/background/service-worker.ts` | `handleBehavioralEffects()` attaches by eventId — extended observation travels in same message |
| `src/runtime/sw-integration.ts` | Pending effects attachment works for extended observations |
| `src/shared/component-types.ts` | `behavioralObservations?` field already exists |
| `src/sidepanel/sidepanel.ts` | `INTERACTION_EFFECTS_UPDATE` handler reloads from storage |

---

## 9. Implementation Phases

### Phase A: Element State Cache

**What it proves:** True before-state is preserved for select/input change events.

**New files:**
- `src/tap/element-state-cache.ts` (~80 lines)
- `tests/tap/element-state-cache.test.ts` (~150 lines)

**What it does:**
- Lightweight Map<Element, {value, checked, timestamp}> in content script
- Populated by EventTap's capture-phase handler for every ObservedEvent
- Queried by behavioral observer for pre-snapshot value/checked
- Falls back to current read if no prior cache entry

**Independently provable:**
```
Test: create <select>, cache state on click (value=""), trigger change
(value="blue"), verify pre-snapshot shows value="" and diff is detected.
```

**No existing files modified.** Pure additive module.

---

### Phase B: Document Observer Engine

**What it proves:** Mutations anywhere in the document are captured with
correct fields, without performance impact, and with periodicity detection.

**New files:**
- `src/tap/document-observer.ts` (~400 lines)
- `src/shared/document-types.ts` (~120 lines)
- `tests/tap/document-observer.test.ts` (~500 lines)

**What it does:**
- Singleton MutationObserver on `document.body`
- `{childList, attributes, attributeOldValue, characterData, characterDataOldValue, subtree: true}`
- Refcounting: acquire/release/releaseAll
- Lightweight capture: O(1) per record, compact RawDocumentRecord
- Periodicity detection: track (element, attr) pairs, classify after >3 regular repetitions
- Shared record buffer: one record per mutation, `windowIds[]` attribution
- Soft cap: MAX_RAW_RECORDS (5000), FIFO eviction, truncated flag

**Independently provable:**
```
Test: create DOM, trigger mutation outside target subtree (modal appears
at body level), verify RawDocumentRecord captured with correct fields.
Test: simulate 60fps animation, verify periodicity classification after
4 repetitions.
Test: two concurrent windows, verify shared records with both windowIds.
```

**Modified files:**
- `src/shared/behavioral-types.ts` — add new type imports

---

### Phase C: Stability Manager + Observation Coordinator

**What it proves:** Delayed consequences survive because the window doesn't
close prematurely. Overlapping interactions preserve ambiguity.

**New files:**
- `src/tap/stability-manager.ts` (~200 lines)
- `src/tap/observation-coordinator.ts` (~350 lines)
- `tests/tap/observation-coordinator.test.ts` (~400 lines)

**What it does:**
- StabilityManager: 500ms quiet + 1000ms minimum + 3000ms cap. Periodic
  mutations don't reset. Per-window timer management.
- ObservationCoordinator: orchestrates target observer + document observer +
  stability manager + element state cache. On close: triggers deferred analysis,
  builds extended BehavioralObservation, delivers via M1 pipeline.

**Modified files:**
- `src/tap/behavioral-observer.ts` — extract stability to coordinator. Function
  becomes `startTargetObserver` (records effects, doesn't manage timers).
  Pre-snapshot enhanced with cache lookup.

**Independently provable:**
```
Test: trigger target mutation at 0ms, trigger document mutation at 850ms.
Verify BOTH captured, window didn't close at 505ms (minimum not met).
Verify window closes at ~1370ms (500ms quiet after 850ms + minimum met).

Test: two clicks 500ms apart, mutation at 700ms.
Verify shared record has both windowIds.
Verify both observations show mutation as 'ambiguous: shared with w2/w1'.
```

---

### Phase D: Deferred Deterministic Analysis

**What it proves:** Raw evidence is organized into structural facts. Noise is
separated from signal. Attribution ambiguity is preserved.

**New files:**
- `src/tap/deferred-analysis.ts` (~300 lines)
- `tests/tap/deferred-analysis.test.ts` (~400 lines)

**What it does:**
- 7-step pipeline (filter → noise → proximity → consequence → grouping → path → output)
- Produces DocumentEffect[] with classification + pathFromTarget
- Produces NoiseProfile with noise patterns
- Produces CaptureStats with timing/volume metrics
- Pure deterministic analysis. Zero AI.

**Independently provable:**
```
Test: feed RawDocumentRecords (some periodic, some real consequences,
some overlapping). Verify correct classification, grouping, path computation.
Verify noise patterns identified. Verify ambiguity flags on overlap.
```

**Modified files:**
- `src/tap/observation-coordinator.ts` — wire to deferred analysis on close

---

### Phase E: Integration, Display & Performance Proof

**What it proves:** End-to-end on real applications — the complete "Under ₹500"
sequence captured, with visible evidence in side panel.

**Modified files:**
- `src/recorder/phase5/recorder-entry.ts` — wire coordinator, element state cache
- `src/shared/behavioral-types.ts` — extended fields finalized
- `src/sidepanel/interaction-renderer.ts` — document effects, state transitions,
  timing, noise profile sections

**What it proves (real-world):**

| Pattern | Must Show |
|---------|-----------|
| Modal (sibling backdrop) | Document effect: class change on backdrop, likely-consequence |
| Toast (sibling container) | Document effect: child added to container, likely-consequence |
| Dynamic list (sibling) | Document effect: child added to list, likely-consequence |
| React async toggle (300ms) | Target effect: class change at +300ms — minimum keeps window open |
| Loading delayed (850ms) | Document effect: result text change at +850ms — CAUGHT |
| Select change | State transition: value "" → "blue" via element state cache |
| Background carousel | Noise profile: periodic mutations classified, don't prevent close |
| Rapid clicks (overlap) | Shared records with windowIds, ambiguity flags |
| Simple toggle | Closes at ~1000ms (minimum), not prematurely |

**Performance measurements (real):**
- Callback CPU per batch (via performance.now)
- Total callback CPU per window
- Analysis time on window close
- Memory per observation window
- Mutation volume on real pages
- Recorder responsiveness (no frame drops)

---

## 10. Evidence Lifecycle

```
DURING RECORDING (content script memory):
  • RawDocumentRecord[] in shared buffer (temporary, released after analysis)
  • Element state cache (per-session, grows with interactions)
  • Active observation windows (target effects, pre-snapshots)

ON WINDOW CLOSE:
  • Raw records → deferred analysis → DocumentEffect[] (compact, ~20-50 effects)
  • Raw records released from buffer (GC eligible)
  • BehavioralObservation built with effects + documentEffects + noiseProfile + captureStats
  • Buffered in sessionStorage (same M1 key, same retry pipeline)
  • Delivered to SW via BEHAVIORAL_EFFECTS message

IN SERVICE WORKER:
  • handleBehavioralEffects() correlates by eventId (UNCHANGED from M1)
  • Attaches to ComponentInteraction.behavioralObservations[]
  • Persists to chrome.storage.local
  • Broadcasts INTERACTION_EFFECTS_UPDATE to side panel

ON RECORDING STOP:
  • coordinator.releaseAll() — force-close all active windows
  • Element state cache cleared
  • Document observer disconnected (refcount → 0)
  • All buffered observations flushed

ON SPA NAVIGATION:
  • pagehide → coordinator.releaseAll() with endReason='navigation'
  • Observations in sessionStorage buffer survive for next page's SW
  • Element state cache lost (new content script)

AFTER RECORDING (future milestone — consolidation):
  • Rich temporary evidence analyzed for semantic understanding
  • Redundant snapshots discarded
  • Capability-relevant evidence retained
  • This is NOT part of M1 — M1 captures, future milestones consolidate
```

---

## 11. What M1 Learns vs. What M1 Only Captures

### M1 Captures (Evidence)

For each interaction:
- Before-state (element state cache + pre-snapshot)
- Target subtree mutations (class, aria, childList, characterData, removal)
- Document-wide mutations (every mutation everywhere, with old→new values)
- Timing of every effect (offsetMs from interaction start)
- Background noise patterns (periodicity, frequency)
- Performance metadata (callback cost, record volume, truncation)
- Attribution ambiguity (which windows share a mutation)

### M1 Does NOT Learn (Future Milestones)

- "PriceFilter affects ProductResults" → M3 (region relationship discovery)
- "Filter checkbox should produce results change within ~1s" → M4 (validation)
- "This is a filter component" → M3+ (component recognition)
- "The results are correct for Under ₹500" → M4+ (semantic validation)
- "This interaction is Case 1/2/3" → M4 (five-case model)
- Capability profiles → M5+ (capability model)

M1's evidence is the raw material. Future milestones build understanding on top.

---

## 12. Edge Cases

### Rapid Sequential Clicks

```
Click 1 at t=0: window w1 [0, ~1000-3000]
Click 2 at t=500: window w2 [500, ~1500-3500]
```

Document observer: refcount=2. Each mutation creates ONE record with
`windowIds: ['w1', 'w2']`. Each window has independent stability timers
and minimum duration gates.

Results arriving at 850ms: shared record attributed to both windows.
Deferred analysis for each marks it `ambiguous: shared with other window`.

### Page Navigation During Observation

`pagehide` fires → `coordinator.releaseAll('navigation')`. Active windows
finalize with `endReason: 'navigation'`. Raw records analyzed and delivered
before page unloads. If delivery fails, sits in behavioral buffer for next
session.

### Element Removed During Observation

Target observer detects removal (parent MutationObserver + isConnected).
`endReason: 'element-removed'`. Document observer continues — consequences
elsewhere may still be unfolding. Window closes per stability/cap logic.

### Shadow DOM (Open)

`document.body` with `subtree: true` does NOT pierce shadow boundaries.
M1 scans the target element's subtree for shadow hosts at observation start.
For each open shadow host found, attaches a separate observer inside
`.shadowRoot`. Records tagged with `source: 'shadow-dom'`. Best-effort —
doesn't catch dynamically created shadow hosts or shadow hosts outside
the target subtree.

### Shadow DOM (Closed)

Inaccessible. Hard platform limit. Host element's external changes recorded.

### Iframes

EventTap runs in all frames (`all_frames: true`). Each frame's content
script independently runs M1's observation logic on its own `document.body`.
No cross-frame observation needed.

### Portals (React/Vue)

Document observer catches portal insertions as childList additions at body
level. Classified as `likely-consequence: structural change outside target subtree`.

### Virtualized UIs

Scroll-triggered childList mutations recorded. Deferred analysis may classify
as `ambiguous` (not clearly consequence). Scroll events in EventTap stream
provide context for future analysis.

### CSS Transitions

60fps style attribute mutations: periodicity detector classifies after 4
repetitions at ~16ms intervals. Recorded as evidence, classified as
`background-noise`, don't reset stability timer.

---

## 13. Acceptance Criteria

- [ ] Element state cache: true before-state for select.value change events
- [ ] Target subtree observer: all M1 effects still captured (aria, class, childList, text, removal)
- [ ] Document observer singleton: correct refcount lifecycle
- [ ] Document observer captures: attributes, childList, characterData across entire document
- [ ] RawDocumentRecord fields: all correct (tag, id, testId, className, role, isInTargetSubtree, mutationType, old→new, offsetMs, windowIds)
- [ ] Periodicity detection: classifies after >3 regular repetitions; doesn't reset stability; still records evidence
- [ ] Shared records: one record per mutation during overlap, windowIds[] attribution
- [ ] Stability window: 500ms quiet + 1000ms minimum + 3000ms cap
- [ ] Delayed consequence at 850ms: CAUGHT (minimum duration keeps window open)
- [ ] Simple interaction: closes at ~1000ms (minimum met + stability met)
- [ ] Deferred analysis: noise filtering, proximity, consequence, grouping, path — all deterministic
- [ ] DocumentEffect output: location with pathFromTarget, classification with reason, timing, overlap flags
- [ ] NoiseProfile: correct counts, patterns identified
- [ ] CaptureStats: accurate timing, volume, truncation metadata
- [ ] Soft cap: raw records truncated at 5000, flagged
- [ ] All 29 existing M1 tests pass
- [ ] Full test suite: same pass/fail (2 pre-existing timing artifacts only)
- [ ] SW correlation: works unchanged
- [ ] Side panel: document effects, state transitions, timing, noise profile visible
- [ ] Extension builds successfully
- [ ] Real-world test: modal, toast, dynamic list, React async, loading delayed, select change — all captured
- [ ] Real-world test: background noise classified, doesn't prevent stabilization
- [ ] Real-world test: overlapping clicks preserve ambiguity
- [ ] Performance: callback CPU <5ms/batch, analysis <50ms, memory <1MB/window
- [ ] No AI calls anywhere in M1 code path

---

## 14. Performance Safeguards

| Safeguard | Mechanism |
|-----------|-----------|
| Soft cap | rawBuffer truncated at MAX_RAW_RECORDS (5000), FIFO eviction, truncated flag |
| Periodicity gate | Sub-500ms recurring mutations don't reset stability timer |
| Singleton observer | One observer on body regardless of overlapping windows |
| Refcount disconnect | Observer disconnected when refcount → 0 |
| Lightweight callback | O(1) per record — no path computation, no region identification |
| Minimum duration cap | 1000ms — bounded overhead per interaction |
| Hard cap | 3000ms — absolute performance budget |
| CaptureStats | Actual CPU/memory measured, not estimated |
| Analysis timeout | ~50ms one-time cost on ~5000 records |

---

## 15. The Clear Claim

When redesigned M1 is complete:

> For a recorded user interaction, the recorder can reliably preserve the
> relevant before/state evidence and observable behavioral consequences —
> local, distant, and delayed — within a bounded observation period, while
> handling overlapping interactions, background activity, and uncertainty
> without claiming causation or semantic meaning.

The "Under ₹500" example:

```
t=0:     Under ₹500 selected
t=5ms:   checkbox/child state changed (TARGET — M1 observer)
t=20ms:  spinner appeared (DOCUMENT — document observer)
         ... 830ms gap, minimum keeps window open ...
t=850ms: ProductResults changed (DOCUMENT — document observer) ✅
t=870ms: ResultCount changed (DOCUMENT — document observer) ✅
t=1370ms: Window closes (500ms quiet + minimum met)

Evidence preserved:
  Before-state: checkbox unchecked, value="" (from cache)
  Target effects: class change, aria-checked change
  Document effects: spinner appeared, 48 items removed from results,
                    result count text changed
  Timing: every effect timestamped
  Noise: none detected (or background carousel classified separately)
  Attribution: unambiguous (single interaction in window)
```

No semantic claims. No causality determination. No AI.
Just trustworthy evidence, ready for future understanding.
