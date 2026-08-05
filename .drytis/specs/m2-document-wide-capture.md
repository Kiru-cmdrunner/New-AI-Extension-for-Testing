# Milestone 2: Bounded Document-Wide Mutation Capture

## Status: DESIGN (not yet implemented — awaiting review)

## Dependencies
- Built on: a43df53 + M1 (behavioral observation, target-subtree only)
- Does NOT modify M1 behavior
- Does NOT require AI

## AI Boundary
**Zero AI involvement in M2.** M2 is purely deterministic observation and
analysis. AI enters in future milestones (M4+) only when deterministic
evidence + accumulated knowledge are insufficient for semantic interpretation.

---

## 1. What M2 Achieves

M2 transforms the observer from a **target-subtree-only recorder** into a
**bounded document-wide recorder**. Three concrete changes from M1:

### 1.1 Spatial Scope: Target Subtree → Entire Document

M1 attaches one MutationObserver on `targetEl` with `subtree: true`. If a click
causes a modal at `document.body` level, a results panel to update in a sibling
container, or a cart badge to change in the header — M1 sees nothing.

M2 adds a **singleton document observer** on `document.body` with
`{childList: true, attributes: true, attributeOldValue: true, characterData:
true, characterDataOldValue: true, subtree: true}`. This captures every
mutation everywhere, for the duration of the observation window.

The M1 target-subtree observer stays unchanged. M2 adds alongside it.

### 1.2 Stability Window: 200ms → 500ms

M1's 200ms quiet period misses React/Vue/Angular async updates that arrive at
~300ms. M2 uses 500ms. The 3000ms hard cap stays unchanged (performance budget).

### 1.3 Capture-vs-Process Separation

M1's MutationObserver callback builds full `RawEffect` objects with semantic
fields in real time. M2's document observer callback builds **compact raw
records** — just the facts the browser already computed — with zero semantic
processing.

ALL region identification, noise filtering, and correlation are **deferred**
to a deterministic analysis function that runs once when the window closes.

---

## 2. Complete Runtime Flow

```
USER INTERACTION
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ EventTap (capture phase, unchanged from M1)                       │
│                                                                   │
│  1. Fires onEvent(ObservedEvent) → buffer + send to SW           │
│  2. Fires onAfterEvent(targetEl, eventId, timestamp, eventType)  │
│     └── if eventType ∈ {click, change}:                          │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ M2 Observation Coordinator (content script)                       │
│                                                                   │
│  3. Start observation window for this interaction                 │
│                                                                   │
│  4. M1 TARGET OBSERVER (UNCHANGED)                               │
│     • subtree MutationObserver on targetEl                       │
│     • parent MutationObserver (removal detection)                │
│     • pre-snapshot of targetEl                                   │
│     • Each mutation → RawEffect (real-time, as M1 does)          │
│     • Resets shared stability timer on each mutation             │
│                                                                   │
│  5. M2 DOCUMENT OBSERVER (SINGLETON, NEW)                        │
│     • acquire() increments refcount                               │
│     • If refcount was 0: attach MutationObserver on body         │
│       with {childList, attributes, attributeOldValue,            │
│        characterData, characterDataOldValue, subtree: true}      │
│     • Each mutation → compact RawDocumentRecord (O(1) per record)│
│     • Periodicity tracker: Map<(elementRef, attrName), {count,   │
│       timestamps[]}>. If count > 3 AND intervals roughly equal:  │
│       mark as periodic → record but DON'T reset stability timer  │
│     • Non-periodic mutations → record AND reset stability timer  │
│     • All records tagged with windowId                           │
│                                                                   │
│  6. STABILITY TIMER (SHARED between target + document observers) │
│     • 500ms quiet period                                         │
│     • Reset by: target subtree mutations (always),              │
│       document mutations that are NOT periodic noise             │
│     • If carousel auto-rotating: its mutations become periodic  │
│       after 3 occurrences → stop resetting timer                │
│     • Hard cap: 3000ms (fires regardless of stability)          │
│                                                                   │
│  7. ON WINDOW CLOSE (stability or hard cap or removal):          │
│     a. Disconnect target observer (M1 behavior, unchanged)      │
│     b. documentObserver.release() — decrements refcount         │
│        (if refcount → 0, disconnect document observer)          │
│     c. Run DEFERRED ANALYSIS (deterministic, synchronous)       │
│     d. Build combined BehavioralObservation                      │
│        (M1 fields + M2 documentEffects + noiseProfile)          │
│     e. Buffer in sessionStorage + send to SW via                │
│        BEHAVIORAL_EFFECTS (M1 delivery pipeline, unchanged)     │
│     f. Raw records released from memory (GC eligible)           │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ SERVICE WORKER (unchanged M1 correlation)                         │
│                                                                   │
│  8. handleBehavioralEffects() receives observation               │
│  9. Correlates sourceEventId against liveInteractions[*]          │
│     .memberEvents[].eventId                                      │
│ 10. Attaches to interaction.behavioralObservations[]              │
│ 11. Persists to chrome.storage.local                             │
│ 12. Broadcasts INTERACTION_EFFECTS_UPDATE to side panel          │
│     (if interaction not yet emitted: pendingBehavioralEffects)   │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ SIDE PANEL (extended display)                                     │
│                                                                   │
│ 13. INTERACTION_EFFECTS_UPDATE handler (M1, unchanged)           │
│ 14. createInteractionElement() now also calls                    │
│     createDocumentEffectsSection() (M2 new)                      │
│ 15. Document effects shown in separate collapsible section:      │
│     "🌐 Document Effects (N)" with location + classification     │
│ 16. Noise profile summary line if background noise detected      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Structures

### 3.1 Raw Document Record (capture-time, compact, O(1) per record)

```typescript
/**
 * Compact raw record from the document-wide MutationObserver.
 * Created in the callback with zero semantic processing.
 * All fields are read from the MutationRecord or via O(1) property access.
 */
interface RawDocumentRecord {
  // ── Location (where it happened) ──
  tag: string;                    // nodeName.toLowerCase()
  id: string | null;              // element.id (O(1))
  testId: string | null;          // data-testid | data-cy | data-test (O(1))
  className: string | null;       // getAttribute('class') (O(1))
  role: string | null;            // getAttribute('role') (O(1))
  isInTargetSubtree: boolean;     // targetEl.contains(node) — native, fast
  isInInteractionRegion: boolean; // within interaction target's nearest
                                   // landmark/section ancestor
  // ── Mutation detail (what changed) ──
  mutationType: 'attributes' | 'childList' | 'characterData';
  attributeName: string | null;   // mutation.attributeName
  oldValue: string | null;        // mutation.oldValue (browser-provided)
  newValue: string | null;        // current value (one getAttribute/textContent)
  nodeSummary: string | null;     // for childList: summarizeNode(node)
                                   // for characterData: truncated text
  addedNodeCount: number;         // for childList: mutation.addedNodes.length
  removedNodeCount: number;       // for childList: mutation.removedNodes.length

  // ── Timing ──
  offsetMs: number;               // Date.now() - windowStartTime

  // ── Source ──
  source: 'document-wide';        // always 'document-wide' (target-subtree
                                   // records go through M1's RawEffect path)
}
```

**Why no full CSS selector or DOM path?**

Generating a path from body (`body > div[0] > main[0] > ...`) is O(depth) per
record — ~0.2ms per element. For 2000 records: 400ms. Too expensive for the
capture callback.

Instead, we capture `tag + id + testId + className + role + isInTargetSubtree`
— all O(1) reads. This is enough for deferred analysis to group mutations by
element identity. If two mutations have the same `tag + id + className`, they're
on the same element. `isInTargetSubtree` gives us the target proximity signal
for free (native `contains()`).

Full path generation is deferred to the analysis phase, where it runs once on
the ~20-50 meaningful effects (after noise filtering), not on 2000 raw records.

### 3.2 Document Effect (output of deferred analysis)

```typescript
/**
 * A document-wide mutation that survived noise filtering,
 * classified for relevance.
 */
interface DocumentEffect {
  // ── Location ──
  location: {
    tag: string;
    id: string | null;
    testId: string | null;
    className: string | null;
    role: string | null;
    pathFromTarget: string;       // Computed during analysis:
                                   // 'self' | 'descendant(d)' |
                                   // 'parent' | 'sibling' |
                                   // 'ancestor(d)' | 'distant'
    isInTargetSubtree: boolean;
  };

  // ── What changed ──
  mutationType: 'attributes' | 'childList' | 'characterData';
  attributeName: string | null;
  oldValue: string | null;
  newValue: string | null;
  nodeSummary: string | null;
  addedNodeCount: number;
  removedNodeCount: number;

  // ── Timing ──
  offsetMs: number;

  // ── Classification (deterministic) ──
  classification: 'likely-consequence' | 'ambiguous' | 'background-noise';
  classificationReason: string;
  // Examples:
  //   'likely-consequence: structural change near interaction target'
  //   'background-noise: periodic pattern (>3 repetitions at ~3000ms intervals)'
  //   'ambiguous: attribute change on distant element'
}
```

### 3.3 Noise Profile

```typescript
/**
 * Summary of background mutation activity during the observation window.
 * Helps future milestones distinguish real consequences from noise.
 */
interface NoiseProfile {
  totalRawRecords: number;
  filteredAsConsequence: number;
  filteredAsAmbiguous: number;
  filteredAsNoise: number;
  noisePatterns: Array<{
    description: string;    // "class changes on div.carousel every ~3000ms"
    recordCount: number;
    sourceTag: string;
    sourceClassName: string | null;
    averageIntervalMs: number;
  }>;
}
```

### 3.4 Capture Stats (performance metadata)

```typescript
/**
 * Performance and capacity metadata for the observation window.
 * Used for diagnostics and for future performance budgeting.
 */
interface CaptureStats {
  windowDurationMs: number;
  rawRecordCount: number;
  maxCallbackBatchSize: number;
  totalCallbackTimeMs: number;    // sum of all callback durations
  truncated: boolean;             // true if soft cap was hit
  truncatedReason: string | null; // 'exceeded max records (5000)'
}
```

### 3.5 Extended BehavioralObservation

The existing `BehavioralObservation` type gets optional M2 fields:

```typescript
interface BehavioralObservation {
  // ── M1 fields (UNCHANGED) ──
  sourceEventId: string;
  observationStartOffset: number;
  observationEndOffset: number;
  endReason: 'stabilized' | 'timeout' | 'element-removed' | 'navigation';
  effects: RawEffect[];              // target-scoped effects (M1 observer)
  preSnapshot: ElementStateSnapshot;
  finalSnapshot: ElementStateSnapshot | null;

  // ── M2 fields (NEW, all optional) ──
  documentEffects?: DocumentEffect[];
  noiseProfile?: NoiseProfile;
  captureStats?: CaptureStats;
}
```

**Why extend rather than create a new type?**

The observation is for the SAME interaction, shares the SAME sourceEventId,
SAME stability window, and SAME delivery pipeline. The SW correlation logic
(`handleBehavioralEffects`) works unchanged — it attaches `BehavioralObservation`
to `ComponentInteraction` by eventId. M2 fields travel alongside M1 fields in
the same message. No new message type, no new handler, no new correlation path.

---

## 4. Singleton Document Observer

### 4.1 Why Singleton?

If user clicks rapidly (click at t=0, click at t=400ms), observation windows
overlap. If each window created its own document observer on `document.body`,
two observers would fire for every mutation — doubling record volume during
overlap. With 5 rapid clicks: 5 observers on body.

The singleton model: one document observer, reference-counted. It attaches
when the first observation window starts and stays until the last window
closes.

### 4.2 Architecture

```typescript
class DocumentObserver {
  private observer: MutationObserver | null = null;
  private refCount: number = 0;
  private rawBuffer: RawDocumentRecord[] = [];
  private activeWindows: Map<string, { startTime: number; targetEl: Element }> = new Map();
  private periodicityMap: Map<string, { count: number; lastTimestamps: number[] }> = new Map();

  /**
   * Start observing for a new interaction window.
   * Returns a windowId for later record retrieval.
   */
  acquire(windowId: string, startTime: number, targetEl: Element): void {
    this.activeWindows.set(windowId, { startTime, targetEl });
    this.refCount++;

    if (this.refCount === 1) {
      // First window — attach the observer
      this.observer = new MutationObserver(this.handleMutations);
      this.observer.observe(document.body, {
        childList: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
      });
    }
  }

  /**
   * Release an observation window. Returns the raw records for that window.
   * If this was the last active window, disconnects the observer.
   */
  release(windowId: string): RawDocumentRecord[] {
    const windowInfo = this.activeWindows.get(windowId);
    if (!windowInfo) return [];

    const endTime = Date.now();

    // Partition: records from this window's time range
    // Records are in this.rawBuffer, filtered by [startTime, endTime]
    const windowRecords = this.rawBuffer.filter(
      r => r.windowId === windowId
    );

    // Remove this window's records from the shared buffer
    this.rawBuffer = this.rawBuffer.filter(r => r.windowId !== windowId);

    this.activeWindows.delete(windowId);
    this.refCount--;

    if (this.refCount === 0) {
      this.observer?.disconnect();
      this.observer = null;
      this.periodicityMap.clear();
    }

    return windowRecords;
  }

  /**
   * Lightweight mutation handler. O(1) per record.
   * Records compact facts. No semantic processing.
   */
  private handleMutations = (mutations: MutationRecord[]): void => {
    const batchStart = performance.now();

    for (const mutation of mutations) {
      // Build compact record for EACH active window
      for (const [windowId, { startTime, targetEl }] of this.activeWindows) {
        const record = this.buildRecord(mutation, windowId, startTime, targetEl);
        this.rawBuffer.push(record);

        // Periodicity detection (for stability timer)
        this.trackPeriodicity(mutation, windowId);

        // Stability reset (unless periodic noise)
        const isPeriodic = this.isPeriodicNoise(mutation, windowId);
        if (!isPeriodic) {
          this.resetWindowStability(windowId);
        }
      }
    }

    // Soft cap check
    if (this.rawBuffer.length > MAX_RAW_RECORDS) {
      // Drop oldest records (FIFO) — prefer keeping recent evidence
      this.rawBuffer.splice(0, this.rawBuffer.length - MAX_RAW_RECORDS);
      this.truncated = true;
    }

    const batchDuration = performance.now() - batchStart;
    this.totalCallbackTimeMs += batchDuration;
    if (mutations.length > this.maxCallbackBatchSize) {
      this.maxCallbackBatchSize = mutations.length;
    }
  };
}
```

### 4.3 Periodicity Detection

The stability timer problem: if a carousel auto-rotates every 3 seconds, its
mutations keep resetting the stability timer, preventing the window from
closing until the 3000ms hard cap.

**Solution**: Track a sliding window of timestamps for each `(element, attr)`
pair. If the same source fires >3 times with roughly equal intervals (±30%),
classify subsequent mutations from that source as periodic noise. Periodic
mutations are still RECORDED (evidence completeness) but do NOT reset the
stability timer.

```typescript
private periodicityMap: Map<string, {
  count: number;
  lastTimestamps: number[];  // last 5 timestamps
}> = new Map();

private trackPeriodicity(mutation: MutationRecord, windowId: string): void {
  const el = mutation.target as Element;
  if (el.nodeType !== 1) return;  // only track element mutations

  const key = windowId + ':' + el.tagName + ':' + (mutation.attributeName || mutation.type);
  const entry = this.periodicityMap.get(key) ?? { count: 0, lastTimestamps: [] };

  entry.count++;
  entry.lastTimestamps.push(Date.now());
  if (entry.lastTimestamps.length > 5) entry.lastTimestamps.shift();

  this.periodicityMap.set(key, entry);
}

private isPeriodicNoise(mutation: MutationRecord, windowId: string): boolean {
  const el = mutation.target as Element;
  if (el.nodeType !== 1) return false;

  const key = windowId + ':' + el.tagName + ':' + (mutation.attributeName || mutation.type);
  const entry = this.periodicityMap.get(key);
  if (!entry || entry.count < 4 || entry.lastTimestamps.length < 4) return false;

  // Check if intervals are roughly equal (±30%)
  const intervals: number[] = [];
  for (let i = 1; i < entry.lastTimestamps.length; i++) {
    intervals.push(entry.lastTimestamps[i] - entry.lastTimestamps[i - 1]);
  }
  if (intervals.length < 3) return false;

  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (avg < 100) return false;  // too fast to be periodic — likely framework batching

  const variance = intervals.every(i => Math.abs(i - avg) < avg * 0.3);
  return variance;
}
```

**Why this is deterministic**: The periodicity check is pure arithmetic on
timestamps. No AI, no classification, no semantic interpretation. It's a
mechanical noise gate that prevents background animations from extending the
observation window indefinitely.

### 4.4 Overlapping Window Record Attribution

Each raw record carries a `windowId`. During `release()`, records are filtered
by `windowId`. This means:

```
Window 1: [t=0, t=3000]
Window 2: [t=400, t=3400]

Mutation at t=500:
  → Record created for window 1 (windowId='w1')
  → Record created for window 2 (windowId='w2')
  → Both windows see this mutation

Window 1 closes at t=3000:
  → release('w1') returns records with windowId='w1'
  → Includes the t=500 record

Window 2 closes at t=3400:
  → release('w2') returns records with windowId='w2'
  → Also includes the t=500 record
```

A mutation during overlap is attributed to BOTH windows. Deferred analysis for
each window can note that some effects may have been caused by a different
interaction (using the interaction's start time as context).

**Memory note**: During overlap, the buffer contains duplicate records (one
per active window per mutation). For N overlapping windows, record volume is
N× per mutation. This is acceptable because overlaps are short (max ~2.6s of
overlap per pair) and the soft cap prevents runaway growth.

---

## 5. Deferred Deterministic Analysis

Runs once when the observation window closes, in the content script,
synchronously. Input: `RawDocumentRecord[]`. Output: `DocumentEffect[]` +
`NoiseProfile`.

### 5.1 Analysis Pipeline

```
RawDocumentRecord[]
        │
        ▼
   Step 1: PROXIMITY CLASSIFICATION
   For each record:
     • isInTargetSubtree: true → 'target-scoped' (redundant with M1, but cross-validates)
     • isInInteractionRegion: true → 'local-region'
     • Both false → 'distant'
        │
        ▼
   Step 2: NOISE FILTERING
   For each record:
     • If periodicity map flagged source as periodic → 'background-noise'
     • If same (tag, className, attributeName) appears >10 times with
       near-equal intervals → 'background-noise'
     • Else → candidate
        │
        ▼
   Step 3: CONSEQUENCE CLASSIFICATION (candidates only)
   For each non-noise candidate:
     • childList with addedNodes > 0 near target (parent/sibling/ancestor) 
       → 'likely-consequence'
     • childList with removedNodes > 0 near target
       → 'likely-consequence'
     • attribute change on target's parent or sibling
       → 'likely-consequence'
     • characterData change near target
       → 'likely-consequence'
     • childList or attribute change far from target
       → 'ambiguous'
        │
        ▼
   Step 4: LOCATION GROUPING
   Group records by (tag, id, className) to identify which elements changed.
   Collapse multiple mutations on the same element into a summary effect.
   Example: 48 childList-remove records on .product-list → 1 DocumentEffect
   with removedNodeCount: 48.
        │
        ▼
   Step 5: PATH COMPUTATION (deferred from capture)
   For each unique element in the grouped effects:
     • Walk up from element to interaction targetEl (if in subtree)
     • Walk up from element to body (if not in subtree)
     • Generate compact path: 'body > main > .results > .product-card'
     • Compute relationship to target: 'self'/'descendant'/'parent'/
       'sibling'/'ancestor'/'distant'
        │
        ▼
   Step 6: OUTPUT
   DocumentEffect[] (classified, grouped, path-attributed)
   NoiseProfile (counts, patterns, descriptions)
```

### 5.2 Why All Analysis Is Deferred

During capture, the callback sees one mutation at a time. It cannot determine:
- Whether this mutation is part of a repeating pattern (needs history)
- Whether this mutation is near the target (needs to check other active regions)
- Whether this mutation is consequence or noise (needs the full timeline)

Deferred analysis has the complete record set. It can:
- Identify periodic patterns across the full window
- Group mutations by element and location
- Compute spatial relationships after the fact
- Separate background noise from real effects

This is the "capture broadly ≠ process deeply in real time" principle.

### 5.3 What the Analysis Does NOT Do

- **No semantic interpretation**: "this is a filter checkbox" → NO
- **No component type classification**: "this is a dropdown" → NO
- **No intent derivation**: "the user intended to filter results" → NO
- **No AI calls**: pure structural/statistical analysis → YES

The analysis produces STRUCTURAL facts:
- "48 elements removed from ul.product-list at +860ms"
- "class changed on div#modal-backdrop at +5ms: '' → 'open'"
- "5 class changes on div.carousel classified as background noise (periodic)"

Future milestones interpret these structural facts semantically.

---

## 6. True Before/After State

### 6.1 What M2 Preserves

| Evidence | M1 | M2 |
|----------|----|----|
| Target element pre-state (properties) | ✅ preSnapshot | ✅ (unchanged) |
| Target element post-state (properties) | ✅ finalSnapshot | ✅ (unchanged) |
| Target subtree mutations (old→new values) | ✅ RawEffect[] | ✅ (unchanged) |
| Document-wide mutations (old→new values) | ❌ | ✅ RawDocumentRecord[] |
| Element state before change event (change timing problem) | ❌ | ❌ (deferred to M3) |

### 6.2 The Change-Event Before-State Gap

For `<select>` and `<input>`, the `change` event fires AFTER the browser has
updated `.value`. M2 does NOT solve this — the pre-snapshot at observation
start already has the new value. This is a known limitation.

**Deferred to M3**: Element state cache that preserves values across events.
M2's document-wide observer does provide `oldValue` for attribute mutations
(which covers some form element state changes), but IDL property changes
(`el.value`, `el.checked`) remain invisible to MutationObserver.

### 6.3 Old-Value Availability from MutationObserver

MutationObserver provides `oldValue` when `attributeOldValue: true` and
`characterDataOldValue: true` are set. M2 sets both. This means:

- `class` change: oldValue="unchecked" → newValue="checked" ✅
- `aria-checked` change: oldValue="false" → newValue="true" ✅
- `style` change: oldValue="display:none" → newValue="display:block" ✅
- `value` attribute change (HTML attribute, not IDL property): oldValue available ✅
- `value` IDL property change (el.value = "x"): NOT detected by MutationObserver ❌

The document-wide observer captures old→new for ALL attribute and
characterData changes. This is significantly richer than M1, which only
captured old→new within the target subtree.

---

## 7. Temporary Evidence vs. Future Reusable Knowledge

### 7.1 What M2 Captures (temporary, for later milestones)

```
TEMPORARY EVIDENCE (kept during recording session, in content script memory):
  • RawDocumentRecord[] per observation window
  • Full mutation timeline with element references
  • Periodicity tracking data
  • Capture statistics

PURPOSE: Available for post-recording consolidation (future milestone).
         If the page navigates (SPA), this is lost — analyzed output survives.
```

### 7.2 What M2 Outputs (persisted to ComponentInteraction)

```
PERSISTED EVIDENCE (travels to SW via BEHAVIORAL_EFFECTS, stored in
                    chrome.storage.local, survives navigation):
  • DocumentEffect[] — analyzed, noise-filtered, classified
  • NoiseProfile — background activity summary
  • CaptureStats — performance metadata
  • M1 RawEffect[] + snapshots — unchanged
```

### 7.3 What M2 Learns (persists as reusable knowledge)

```
LEARNED KNOWLEDGE: NONE

M2 does not learn. M2 captures evidence. Future milestones learn from it:

M3 (Region-Aware Observation):
  Learns: "PriceFilter region → affects → ProductResults region"
  From:   M2's documentEffects showing correlated mutations in different
          DOM locations after filter interactions.

M4 (Validation):
  Learns: "Filter checkbox should produce results change within ~1s"
  From:   M2's timing data (offsetMs of consequence effects) accumulated
          across multiple filter interactions.

M5+ (Capability Model):
  Learns: "This app has a filter capability with these characteristics..."
  From:   M2's complete behavioral evidence combined with M3's region
          relationships and M4's validation patterns.
```

### 7.4 Cleanup Strategy

**During recording**: Raw records are kept in content script memory (not
sessionStorage — too large). Each window's raw records are released after the
deferred analysis produces the compact DocumentEffect[] output.

**On recording stop**: All raw records released. Only the analyzed output
(DocumentEffect[]) persists via the SW → chrome.storage.local path.

**On SPA navigation**: Content script may be recreated. Raw records in memory
are lost. But all already-delivered observations (DocumentEffect[]) survive
in the SW's liveInteractions and chrome.storage.local.

**SessionStorage**: M2 does NOT use sessionStorage for raw records. Only the
existing M1 behavioral buffer (for BehavioralObservation delivery retry) is
used. The analyzed output is compact enough (~20-50 effects) to fit in the
existing buffer.

---

## 8. Module and File Changes

### 8.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `src/tap/document-observer.ts` | Singleton document-wide MutationObserver with refcounting, lightweight capture, periodicity detection | ~350 |
| `src/tap/deferred-analysis.ts` | Deterministic post-window analysis: noise filtering, proximity classification, consequence classification, location grouping | ~300 |
| `src/shared/document-types.ts` | Type definitions: RawDocumentRecord, DocumentEffect, NoiseProfile, CaptureStats | ~120 |
| `tests/tap/document-observer.test.ts` | Unit tests for singleton observer, refcounting, capture, periodicity | ~500 |
| `tests/tap/deferred-analysis.test.ts` | Unit tests for noise filtering, classification, grouping | ~400 |

### 8.2 Modified Files

| File | Changes | Risk |
|------|---------|------|
| `src/tap/behavioral-observer.ts` | Default stability: 200→500ms. Export `DEFAULT_STABILITY_MS`. The `observeBehavior` function gains a new optional `onDocumentAnalysis` callback parameter. Stability timer shared between target + document observers. | LOW — stability constant change + optional param. All M1 tests use explicit `stabilityMs: 200` so they're unaffected. |
| `src/recorder/phase5/recorder-entry.ts` | Wire document observer: acquire/release on window start/end. Run deferred analysis on window close. Extend `onObservationComplete` to include document effects. New `BEHAVIORAL_BUFFER` updated to carry M2 fields. | LOW — additive wiring alongside existing M1 code. |
| `src/shared/behavioral-types.ts` | Add optional M2 fields to `BehavioralObservation`: `documentEffects`, `noiseProfile`, `captureStats`. | NONE — optional fields on existing type. |
| `src/sidepanel/interaction-renderer.ts` | Add `createDocumentEffectsSection()` for rendering document-wide effects. Called after the M1 behavioral effects section. | LOW — new function, additive. |

### 8.3 Unchanged Files

| File | Why Unchanged |
|------|---------------|
| `src/tap/event-tap.ts` | M1's `onAfterEvent` hook already provides what M2 needs. No changes. |
| `src/background/service-worker.ts` | `handleBehavioralEffects()` already attaches `BehavioralObservation` by eventId. M2 fields travel in the same message. No changes. |
| `src/runtime/sw-integration.ts` | Pending effects attachment works for extended observations. No changes. |
| `src/shared/component-types.ts` | `behavioralObservations?: BehavioralObservation[]` already exists. M2 fields are inside the observation, not a new field. No changes. |
| `src/sidepanel/sidepanel.ts` | `INTERACTION_EFFECTS_UPDATE` handler reloads from storage and re-renders. M2 effects are in the same observation object. No changes. |

---

## 9. Performance Safeguards and Measurements

### 9.1 Constants

```typescript
// Stability and timing
const M2_STABILITY_MS = 500;           // quiet period (up from M1's 200ms)
const M2_MAX_TIMEOUT_MS = 3000;        // hard cap (performance budget)

// Capacity limits
const MAX_RAW_RECORDS = 5000;          // soft cap per window
const MAX_PERIODICITY_TRACKING = 200;  // max (element, attr) pairs tracked
const MAX_PERIODICITY_TIMESTAMPS = 5;  // sliding window for interval check

// Output limits
const MAX_DOCUMENT_EFFECTS = 100;      // max effects in analyzed output
const MAX_NOISE_PATTERNS = 10;         // max noise patterns in profile
```

### 9.2 Safeguards

| Safeguard | Mechanism | Impact |
|-----------|-----------|--------|
| Soft cap on raw records | If `rawBuffer.length > MAX_RAW_RECORDS`: drop oldest, flag `truncated: true` | Prevents memory exhaustion on extreme pages |
| Periodicity gate | Mutations from periodic sources (>3 repetitions, regular intervals) don't reset stability | Prevents infinite window on animated pages |
| Callback timing | Log `performance.now()` before/after each batch. Track `totalCallbackTimeMs`. | Diagnostics for performance profiling |
| Singleton observer | One observer on body regardless of overlapping windows | Prevents observer multiplication |
| Refcount disconnect | Observer disconnected when refcount → 0 | No orphan observers after last window |
| Analysis timeout | Deferred analysis has no explicit timeout but runs on max ~5000 records. At ~0.01ms per record: ~50ms total. | Acceptable one-time cost on window close |

### 9.3 Expected Performance Envelope

| Scenario | Records | Capture CPU | Analysis CPU | Memory |
|----------|---------|-------------|--------------|--------|
| Simple page (example.com) | 0-5 | <0.1ms | <1ms | <1KB |
| Dropdown toggle | 5-30 | <0.5ms | <5ms | <6KB |
| React SPA filter | 50-200 | <2ms | <10ms | <40KB |
| Heavy SPA with ads | 200-1000 | <5ms | <20ms | <200KB |
| Worst case (animations + reconciliation) | 1000-5000 | <15ms | <50ms | <1MB |

All CPU costs are spread across the 3-second window (capture) or one-time
(window close for analysis). Memory is temporary — released after analysis.

---

## 10. Edge Cases

### 10.1 Rapid Sequential Clicks (Overlapping Windows)

```
Click 1 at t=0  → window1 [0, 3000]
Click 2 at t=200 → window2 [200, 3200]
Click 3 at t=400 → window3 [400, 3400]
```

Singleton observer: refcount=3. Each mutation creates 3 records (one per
window). At 1000 base mutations: 3000 records. Under MAX_RAW_RECORDS=5000.

Each window closes independently when its own stability timer fires.
Window1 may close at t=1000 (stabilized), window2 at t=1200, window3 at t=1400.
Each gets its own subset of records by windowId.

Deferred analysis for window1 may note: "some effects at t=200-400 may be from
a subsequent interaction." This is acceptable — the analysis produces evidence,
not attribution certainty.

### 10.2 Page Navigation During Observation Window

User clicks a navigation link. The page starts unloading. `pagehide` fires.

```
pagehide handler (already exists in recorder-entry.ts):
  → disconnectAll('navigation')  // M1: disconnects target observers
  → documentObserver.releaseAll() // M2 NEW: force-release all windows
  → flushPendingBehavioral()      // M1: deliver buffered observations
```

If the window was mid-observation, it finalizes with `endReason: 'navigation'`.
Any raw records collected so far are analyzed and delivered before the page
unloads. If delivery fails (SW asleep), the observation sits in the behavioral
buffer for the next session.

### 10.3 Element Removed During Observation

M1 already handles this: parent observer detects removal, `endReason:
'element-removed'`, `finalSnapshot: null`. M2's document observer continues
capturing for the remaining window duration — the target is gone, but
consequences elsewhere may still be unfolding (e.g., a redirect timer).

The stability timer behavior: if the target element is removed but the document
continues mutating (consequences still happening), non-periodic document
mutations keep resetting the timer. This is correct — we want to capture all
consequences of the interaction, even if the trigger element is gone.

### 10.4 Shadow DOM (Open)

`document.body` with `subtree: true` does NOT pierce shadow boundaries.
Mutations inside an open shadow root are invisible to the document observer.

**M2 approach**: During observation window setup, scan the interaction target's
subtree for shadow hosts (`element.shadowRoot !== null`). For each shadow host
found, attach a separate MutationObserver inside its `.shadowRoot` with the
same configuration as the document observer. Tag records from these observers
with `source: 'shadow-dom'`.

This is a best-effort scan — it catches shadow hosts present at observation
start but not ones created dynamically during the window. Shadow hosts in
other parts of the document (not in the target subtree) are not scanned.

### 10.5 Shadow DOM (Closed)

`element.shadowRoot` returns `null`. Cannot observe inside. Hard platform
limit. M2 records the host element's external state changes (attributes,
position in document) but cannot see internal mutations.

### 10.6 Iframes

EventTap runs in all frames (`all_frames: true` in manifest). Each frame's
content script independently runs M2's observation logic on its own
`document.body`. No cross-frame observer needed.

Same-origin iframe: the parent frame's document observer does NOT see
mutations inside the iframe's document. The iframe's own content script
observes those independently.

Cross-origin iframe: same as above — each frame's content script observes
its own document. No cross-origin access.

### 10.7 Portals (React, Vue Teleport)

React portals render into `document.body` or another container. The document
observer catches these as `childList` additions at the body level. Location
descriptor shows `tag: 'div'`, `className: 'modal-portal'`, `isInTargetSubtree:
false`. Deferred analysis classifies as `likely-consequence: structural change
(child added) outside target subtree`.

### 10.8 Virtualized UIs (react-window, react-virtualized)

Virtualized lists recycle DOM nodes on scroll. If the user scrolls during the
observation window, `childList` mutations fire as items enter/leave the
virtual viewport. These are NOT consequences of the interaction — they're
side effects of scrolling.

Deferred analysis can distinguish these because:
- Scroll events are in the EventTap's event stream (the observer knows the user
  scrolled)
- Virtualization mutations have a distinct pattern: rapid childList add+remove
  pairs on the same container

M2 records these but may classify them as `ambiguous`. Future milestones
(M3+) with region awareness would recognize the virtualized list region and
deprioritize its recycling mutations.

### 10.9 SPA Route Change During Observation

A click triggers client-side navigation. The main content is replaced:

```
Before: <main><div class="dashboard">...</div></main>
After:  <main><div class="orders">...</div></main>
```

Document observer sees: massive `childList` mutations (entire content subtree
removed and re-added). This is a legitimate consequence — the interaction
caused a view change.

Stability timer: the large batch of mutations resets the timer. The window
stays open until the new view settles (500ms after last mutation). This is
correct — we want to capture the full new view's stabilization.

### 10.10 CSS Transitions (Heavy Animations)

A CSS transition on `opacity` fires attribute mutations (on `style`) for every
frame (~60fps). Over 3 seconds: ~180 records per animated element.

The periodicity detector catches these: the same `(element, 'style')` pair
fires >3 times at regular intervals (16.67ms apart). Classified as periodic
noise → doesn't reset stability timer.

Records are still captured (evidence completeness) but classified as
`background-noise` in deferred analysis.

---

## 11. Automated Tests

### 11.1 Document Observer Unit Tests (`tests/tap/document-observer.test.ts`)

```
SINGLETON LIFECYCLE
  ✓ acquire() attaches observer on first call, refcount=1
  ✓ acquire() doesn't create second observer on second call, refcount=2
  ✓ release() decrements refcount, keeps observer if refcount>0
  ✓ release() disconnects observer when refcount→0
  ✓ release() returns only records for the specified windowId
  ✓ releaseAll() disconnects everything regardless of refcount

CAPTURE
  ✓ attribute mutation → RawDocumentRecord with correct fields
  ✓ childList add → record with addedNodeCount, nodeSummary
  ✓ childList remove → record with removedNodeCount, nodeSummary
  ✓ characterData change → record with old→new text values
  ✓ isInTargetSubtree correctly identifies target descendants
  ✓ multiple mutations in one batch → multiple records
  ✓ records tagged with correct offsetMs from window start
  ✓ records tagged with correct windowId

PERIODICITY DETECTION
  ✓ non-periodic mutation (count < 4) → resets stability
  ✓ periodic mutation (count ≥ 4, regular intervals) → doesn't reset stability
  ✓ periodic mutation with irregular intervals → resets stability
  ✓ different attributes on same element → separate periodicity tracking
  ✓ periodicity map cleared on observer disconnect

SOFT CAP
  ✓ rawBuffer truncated when exceeding MAX_RAW_RECORDS
  ✓ truncated flag set in capture stats
  ✓ oldest records dropped (FIFO)

OVERLAPPING WINDOWS
  ✓ two concurrent windows: mutation creates record for each
  ✓ release(w1) returns only w1 records, keeps w2 records
  ✓ release(w2) after release(w1) returns w2 records
  ✓ stability reset on w1 mutation also resets w2 stability
```

### 11.2 Deferred Analysis Unit Tests (`tests/tap/deferred-analysis.test.ts`)

```
NOISE FILTERING
  ✓ periodic mutations → classified as 'background-noise'
  ✓ non-periodic mutations → classified as candidate
  ✓ high-frequency same-source mutations (>10 with equal intervals) → noise
  ✓ noise patterns aggregated into NoiseProfile

PROXIMITY CLASSIFICATION
  ✓ record with isInTargetSubtree=true → 'target-scoped'
  ✓ record on target's parent → classified correctly
  ✓ record on target's sibling → classified correctly
  ✓ record in distant DOM region → classified as 'distant'

CONSEQUENCE CLASSIFICATION
  ✓ childList add near target → 'likely-consequence'
  ✓ childList remove near target → 'likely-consequence'
  ✓ attribute change on target's parent → 'likely-consequence'
  ✓ characterData change near target → 'likely-consequence'
  ✓ attribute change on distant element → 'ambiguous'

LOCATION GROUPING
  ✓ multiple mutations on same element → collapsed to single effect
  ✓ 48 childList-remove records → 1 effect with removedNodeCount: 48
  ✓ mutations on different elements → separate effects

PATH COMPUTATION
  ✓ descendant of target → pathFromTarget: 'descendant(3)'
  ✓ target itself → pathFromTarget: 'self'
  ✓ parent of target → pathFromTarget: 'parent'
  ✓ sibling of target → pathFromTarget: 'sibling'
  ✓ distant element → pathFromTarget: 'distant'

OUTPUT
  ✓ effects sorted by offsetMs
  ✓ NoiseProfile totals match record counts
  ✓ CaptureStats accurate
  ✓ empty input → empty effects, zero-noise NoiseProfile
```

### 11.3 Integration Tests

```
RECORDER ENTRY WIRING
  ✓ click event → both M1 target observer and M2 document observer active
  ✓ document mutations outside target subtree captured
  ✓ observation delivered to SW with documentEffects populated
  ✓ SW correlates and attaches to ComponentInteraction

STABILITY WINDOW
  ✓ 500ms quiet period (not 200ms) — verify with 300ms delayed mutation
  ✓ periodic noise doesn't prevent stabilization
  ✓ hard cap fires at 3000ms regardless of mutations

SIDE PANEL DISPLAY
  ✓ document effects section visible when documentEffects present
  ✓ document effects section hidden when absent (M1-only observations)
  ✓ noise profile summary displayed when background noise detected
```

---

## 12. Real-World Proof Scenarios

### 12.1 The M1 Failures (Must Now Pass)

| Pattern | M1 Result | M2 Expected | Why |
|---------|-----------|-------------|-----|
| Modal open (sibling backdrop) | ⚪ EMPTY — 0 effects | ✅ Document effect: class change on #modal-backdrop at +5ms | Document observer catches sibling mutations |
| Toast notification (sibling container) | ⚪ EMPTY | ✅ Document effect: child added to #toast-area at +2ms | Document observer catches body-level insertions |
| Dynamic list add (sibling list) | ⚪ EMPTY | ✅ Document effect: child added to #todo-list | Same as toast |
| React async toggle (300ms delay) | ⚪ EMPTY — stabilized at 202ms | ✅ Target effect: class change at +300ms (stability now 500ms) | 500ms window catches 300ms mutation |
| Loading delayed update (800ms) | ⚪ EMPTY — partial capture | ✅ Document effect: result text change at +800ms | If stability allows (mutations at 0ms + 800ms, stability at 1300ms) |

### 12.2 The M1 Successes (Must Still Pass)

| Pattern | M1 Result | M2 Expected |
|---------|-----------|-------------|
| Bootstrap dropdown (text change in target) | ✅ 2 effects | ✅ Same 2 target effects (unchanged) |
| Accordion (aria + text on target) | ✅ 3 effects | ✅ Same 3 target effects |
| Amazon checkbox (class + aria on child) | ✅ 2 effects | ✅ Same 2 target effects |
| Tab switch (class on children) | ✅ 3 effects | ✅ Same 3 target effects |
| Element removal | ✅ element-removed | ✅ Same (unchanged) |

### 12.3 New M2 Capabilities (Must Prove)

| Scenario | What to Verify |
|---------|---------------|
| Background carousel auto-rotating | Mutations captured as 'background-noise'. Stability window closes normally (carousel doesn't extend it). |
| Multiple regions changing simultaneously | Each region's mutations grouped separately in DocumentEffect[]. NoiseProfile shows what was filtered. |
| Portal modal (React) | ChildList addition at body level captured as 'likely-consequence'. |
| CSS transition (fading element) | Periodicity detection classifies as noise. Doesn't prevent stabilization. |
| Rapid clicks (3 clicks in 500ms) | Overlapping windows handled. Each gets its own effects. No observer multiplication. |

### 12.4 Performance Proof

| Measurement | Target |
|-------------|--------|
| Callback CPU per batch | <5ms (measured via performance.now) |
| Total callback CPU per window | <15ms (spread over 3s) |
| Analysis time on window close | <50ms |
| Memory per observation window | <1MB (5000 records × ~200 bytes) |
| No perceptible page jank | No frame drops during observation |

---

## 13. Acceptance Criteria

- [ ] Document observer singleton: refcount lifecycle correct (acquire/release/releaseAll)
- [ ] Document observer captures: attributes, childList, characterData across entire document
- [ ] RawDocumentRecord fields: tag, id, testId, className, role, isInTargetSubtree, mutationType, oldValue, newValue, offsetMs — all correct
- [ ] Periodicity detection: classifies repeating mutations as periodic after >3 occurrences with regular intervals
- [ ] Periodic mutations don't reset stability timer
- [ ] Non-periodic mutations reset stability timer
- [ ] Stability window: 500ms quiet period (not 200ms)
- [ ] Hard cap: 3000ms (unchanged)
- [ ] Deferred analysis: noise filtering, proximity classification, consequence classification, location grouping — all deterministic
- [ ] DocumentEffect output: location with pathFromTarget, classification with reason, timing
- [ ] NoiseProfile: correct counts, noise patterns identified
- [ ] CaptureStats: accurate timing and count metadata
- [ ] Soft cap: raw records truncated at 5000, flagged as truncated
- [ ] Overlapping windows: each window gets its own records via windowId
- [ ] M1 target observer: unchanged behavior, all 29 M1 tests pass
- [ ] Full test suite: same pass/fail as M1 (2 pre-existing timing artifacts only)
- [ ] BehavioralObservation: M2 fields (documentEffects, noiseProfile, captureStats) are optional
- [ ] SW correlation: works unchanged (BEHAVIORAL_EFFECTS handler attaches extended observations)
- [ ] Side panel: document effects section renders when present, hidden when absent
- [ ] Extension builds successfully with M2 code bundled
- [ ] Real-world test: modal, toast, dynamic list, React async toggle all captured
- [ ] Real-world test: background noise correctly classified, doesn't prevent stabilization
- [ ] No AI calls anywhere in M2 code path

---

## 14. What Is Deliberately Deferred

| Deferred To | What | Why |
|-------------|------|-----|
| M3 | Region-aware observation: ARIA landmark region identification, region relationship discovery, pre-wiring known consequence regions | Needs M2's complete evidence to learn from |
| M3 | Element state cache: rolling cache for true before-state across events | Needs careful cross-event state management; M2's MutationObserver oldValue partially mitigates |
| M3 | Open Shadow DOM deep scanning beyond interaction target | M2 scans target's subtree for shadow hosts; full document shadow scanning is region-aware |
| M4 | Five-case interaction model: Case 2/3 prompts, tester feedback | Needs validation layer; M2 provides the evidence foundation |
| M4 | AI-assisted semantic interpretation | M2 is purely deterministic; AI is last-resort assistance |
| M5 | Consolidation: post-recording knowledge extraction | Needs accumulated evidence from a full recording session |
| M5+ | Capability Model: learned capability profiles, relationship graphs | The ultimate consumer of M2+ evidence |

---

## 15. Relationship to the Vision Pipeline

```
Vision: Observe → Understand → Semantic knowledge → Learn → Generate → Execute

M1:  Observe (target subtree only, post-interaction mutations)
M2:  Observe (ENTIRE document, bounded, complete evidence capture) ← THIS MILESTONE
M3:  Understand (region relationships, component patterns from M2 evidence)
M4:  Understand + Validate (confidence-gated, deterministic-first, AI when required)
M5:  Semantic knowledge (consolidation, capability profiles)
M6+: Learn → Generate → Execute
```

M2's role: **complete the observation foundation.** Every future milestone
depends on having complete, trustworthy evidence. M1 proved the concept on
target subtrees. M2 extends it to the entire document, ensuring we never
miss a consequence because it happened "somewhere else" on the page.

The bounded broad-capture + deferred analysis model ensures this completeness
without sacrificing performance or making premature relevance decisions. The
evidence M2 produces is raw, structural, deterministic — ready for future
milestones to build understanding on top of.
