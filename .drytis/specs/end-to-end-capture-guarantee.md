# End-to-End Capture Guarantee — Disposition-Based Evidence Architecture

## Status: APPROVED — ready for implementation

## Architecture Overview

```
Phase 1: EVIDENCE LEDGER       — every discrete event appended unconditionally, browser-ordered, MV3-durable
    → Phase 2: CLASSIFICATION  — ComponentRuntime processes events AND assigns a disposition to each ledger entry
        → Phase 3: PROJECTION  — Projection Engine projects ledger entries by final disposition; 'unclaimed'/'pending' → Unclassified
            → Phase 4: POST-PROCESS — filter, coalesce, capability inference, IR mapping
```

The Projection Engine does NOT reconcile, recover, reconstruct, or match. It projects.

---

## Problem

Capture Guarantee v2 added Unclassified fallbacks inside `ComponentRuntime.process()`
to prevent discrete events from being silently lost during discovery. However, these
fallbacks only protect against **discovery failures** — they do not protect against
**lifecycle absorption failures**.

When an active lifecycle's `isInScope()` returns `true` for a same-element discrete
event and `handleEvent()` returns `null`, the runtime sets `handled = true` (line 282).
All capture-guarantee fallback code (lines 360–387) is inside the discovery section,
which is gated by `if (!handled)`. The event is silently consumed with no record.

This caused intermittent total click loss in real Amazon.in testing: the broad
`select` substring in `DROPDOWN_TRIGGER_CLASS_RE` created false-positive Dropdown
lifecycles that absorbed deliberate clicks on non-dropdown elements.

### Required Invariant

> **Every Evidence Ledger entry receives exactly one disposition.**

A disposition is an explicit, recorded account of what the runtime did with an event.
It is assigned at processing time and finalized at flush time. No event is silently
consumed. No later component must reconstruct what happened.

This is strictly stronger than "capture first, classify second" — it means the
classification itself is accountable. Every absorption, every match, every miss is
recorded as a first-class disposition that lives and dies with the lifecycle that
produced it.

---

## Phase 1: Evidence Ledger

### Purpose

Record every discrete physical event (mousedown, click, contextmenu, keydown) as
unconditional, durable evidence **before** the runtime classifies it. Each entry starts
with disposition `'pending'` and is updated by the runtime as it processes the event.

### Data Structure

```typescript
/**
 * Final status of an evidence entry's accounting.
 *
 * Lifecycle:
 *   'pending'   → created at ledger append, before runtime processes the event
 *   'absorbed'  → runtime assigned the event to an active lifecycle (may be released)
 *   'claimed'   → a completed interaction has permanently claimed this event
 *   'unclaimed' → event was absorbed by an abandoned/interrupted lifecycle, or never matched
 *
 * At projection time (post-flush), only 'claimed' and ('unclaimed' | 'pending') matter:
 *   - 'claimed' entries are represented by their claiming interaction
 *   - 'unclaimed' and 'pending' entries are projected as Unclassified
 */
type DispositionStatus = 'pending' | 'absorbed' | 'claimed' | 'unclaimed';

interface LedgerEntry {
  eventId: string;            // ObservedEvent.eventId (unique per event)
  captureSeq: number;         // rawEvent.timeStamp — browser-assigned monotonic within document
  pageId: string;             // extracted from eventId — groups events by document
  eventType: string;          // 'click' | 'mousedown' | 'contextmenu' | 'keydown'
  timestamp: number;          // Date.now() at capture (wall-clock, for display/debug)

  // Disposition (assigned by runtime during process(), finalized at flush)
  disposition: DispositionStatus;
  claimedBy?: string;         // interactionId (for 'claimed') or lifecycle context id (for 'absorbed')
  claimType?: InteractionType; // Dropdown, Click, TextEntry, etc.
}
```

### What Goes Into the Ledger

Only discrete event types: `click`, `mousedown`, `contextmenu`, `keydown`.
These are the physical user actions that must survive. Lifecycle events (focus,
blur, input, change, mousemove, scroll, mouseenter, mouseleave) are classification
inputs, not standalone user actions — they do not enter the ledger.

The `DISCRETE_ACTION_TYPES` set (already defined as `['click', 'contextmenu',
'mousedown', 'keydown']` at component-runtime.ts:77) is reused as the filter.

### Provenance: `captureSeq`

`captureSeq` = `rawEvent.timeStamp` (the DOM Event's native `.timeStamp` property).

Assigned by the browser engine at dispatch time, before any content script code runs.
Properties:
- **Monotonic** — non-decreasing within a document (guaranteed by WHATWG DOM spec)
- **High resolution** — 5µs on Chrome, far finer than `Date.now()`'s 1ms
- **Origin-relative** — measured from `performance.timeOrigin`, immune to NTP/clock changes
- **Browser-assigned** — set in the event dispatch loop, before our handler executes
- **Zero new state** — already exists on `rawEvent`, just needs to be copied

This makes the ledger's ordering deterministic and immune to async processing races
in the service worker. Even if mousedown and click are processed out of order by the
SW (due to the `ensureSessionRestored()` async race), the ledger sorts by `captureSeq`
and sees the correct browser-observed sequence.

### Cross-Document Ordering

The browser does NOT provide a global monotonic clock across documents. Different
pages have different `performance.timeOrigin` values, so `captureSeq` values from
different pages are not directly comparable.

The ledger does NOT attempt to create a fragile global ordering. Instead:

1. **Within each document**: events are ordered by `captureSeq` (browser-guaranteed).
2. **Across documents**: events are grouped by `pageId` (from `eventId`), and
   `navigation` events provide explicit boundaries. The projection engine processes
   events page-by-page in the order pages appear in the recording (first-seen
   timestamp of each page's earliest event). Navigation events — which are already
   captured as discrete ObservedEvents with their own `eventId` and `pageId` — serve
   as cross-page ordering markers.

No synthetic global clock. No string comparison of pageIds. The pageId collision
risk (two pages loading within the same ms) is a known degenerate case that does not
affect the capture guarantee — all events are still present, and projection matches
by unique `eventId`, not by sort position.

### Durability

The ledger is persisted to `chrome.storage.local` under
`cmdrunner_evidence_ledger` on every disposition change (same pattern as
`persistLiveInteractions`). On MV3 SW restart, the ledger is restored from storage.
This is critical: the `activeStack` is NOT persisted across SW restarts, so
lifecycles are lost, but the ledger ensures every event's disposition is stable
or correctly reset.

---

## Phase 2: Classification (ComponentRuntime with Dispositions)

### What Changes

The runtime gains **disposition tracking**. Every time the runtime processes a
discrete event, it updates the corresponding ledger entry's disposition. This is
recording what the runtime already knows — it doesn't add new classification logic.

#### Disposition Assignment During `process()`

| Runtime action | Ledger disposition |
|---|---|
| Active lifecycle absorbs event (`handled=true`, same-element) | `'absorbed'`, `claimedBy = ctx.lifecycleId`, `claimType = ctx.type` |
| Active lifecycle absorbs via positive ownership (`lifecycleOwnsTarget`) | `'absorbed'`, `claimedBy = ctx.lifecycleId`, `claimType = ctx.type` |
| Discovery matches definition, lifecycle created, completes immediately | `'claimed'`, `claimedBy = interaction.interactionId`, `claimType = interaction.type` |
| Discovery matches definition, lifecycle created, does NOT complete immediately | `'absorbed'`, `claimedBy = newCtx.lifecycleId`, `claimType = newCtx.type` |
| Discovery does NOT match any definition | disposition stays `'pending'` → treated as `'unclaimed'` at projection |
| Event was deduped (already seen eventId) | No ledger entry (already appended on first arrival) |

#### Disposition Finalization During `flush()`

When `flush()` iterates the activeStack at `stopRecording` time:

| Lifecycle final state | Disposition update for its member events |
|---|---|
| Lifecycle **completed** → interaction emitted | All member events: `'claimed'`, `claimedBy = interaction.interactionId` |
| Lifecycle **abandoned** or **interrupted** | All member events: `'unclaimed'` (claim released) |

The `completeComponent()` method (which is called for completed, abandoned, AND
interrupted lifecycles) already knows the endState. It needs to additionally:

- If `endState === 'completed'`: mark all `memberEvents[].eventId` as `'claimed'`
  in the ledger, with `claimedBy = interaction.interactionId`.
- If `endState === 'abandoned'` or `'interrupted'`: mark all
  `memberEvents[].eventId` as `'unclaimed'` in the ledger (release the claim).

#### Disposition Assignment for `cleanupStaleComponents()`

Same as flush: stale components are abandoned → their member events are released
to `'unclaimed'`.

### What Is Removed

**Delete the capture-guarantee fallback code:**

- `createUnclassifiedInteraction()` method (lines 534–554) — deleted entirely
- Capture guarantee fallback 1 (lines 360–373): discovery matched but no completion
- Capture guarantee fallback 2 (lines 378–386): no definition matched

These are no longer needed. Events that don't match any definition stay `'pending'`
in the ledger. Events absorbed by incomplete lifecycles are `'absorbed'`. Both are
projected as `'unclaimed'` by the Projection Engine.

### What Stays Unchanged

- Definition matching, lifecycle management, active-stack absorption
- `handleEvent` / completion / dedup
- `lifecycleOwnsTarget` — the W3C positive ownership test
- `DISCRETE_ACTION_TYPES` constant (reused by ledger and projection)
- `elementKey()` for identity comparisons
- All 14 component definitions (Dropdown, DatePicker, Click, etc.)

The runtime's classification logic is completely unchanged. The only addition is
that it now records its decisions as dispositions on the ledger.

---

## Phase 3: Projection Engine

### Purpose

At output time (`stopRecording`), project the Evidence Ledger into the interaction
output stream. Every entry with a final disposition of `'claimed'` is represented by
its claiming interaction. Every entry with `'unclaimed'` or `'pending'` is projected
as an Unclassified interaction.

### Algorithm

```
function projectInteractions(ledger, completedInteractions):
  output = []

  // Completed interactions are the primary output
  // (already in liveInteractions from the runtime's onEmit callback)
  output.push(...completedInteractions)

  // Project unclaimed/pending ledger entries as Unclassified
  for entry in ledger.entries (sorted by pageId, then captureSeq):
    if entry.disposition === 'unclaimed' || entry.disposition === 'pending':
      output.push(createUnclassifiedFromEntry(entry))

  return output
```

### What the Projection Engine Does NOT Do

- **Does NOT match eventIds against completed interactions** — dispositions already
  record which interaction claimed each event. The projection is a filter, not an
  investigation.
- **Does NOT reconstruct events** — the runtime had full `ObservedEvent` context when
  it assigned the disposition. The ledger entry carries the metadata needed for a
  complete Unclassified interaction (target identity fields can be stored in the entry
  or looked up from a event-id → ObservedEvent map maintained by the ledger).
- **Does NOT understand lifecycle types** — it doesn't know what a Dropdown is, what
  absorption means, or why an event was unclaimed. It only reads the final disposition.

### Unclassified Creation

The projection creates Unclassified interactions with:
- `physicalEventType` from the ledger entry's `eventType`
- `recognized: false`, `reason: 'unclaimed-at-projection'`
- Target identity (accessibleName, tag, ariaRole, cssSelector) from the original
  ObservedEvent, which the Evidence Ledger retains a reference to or stores a
  minimal projection of.

### Ordering

The projected output preserves the ledger's browser-observed order:
1. Group by `pageId` (document boundary)
2. Within each page, sort by `captureSeq` (browser-guaranteed monotonic)
3. Across pages, use navigation events as boundaries

Completed interactions are positioned at their trigger event's `captureSeq` position.
Unclassified interactions are positioned at their ledger entry's `captureSeq` position.

---

## Phase 4: Post-Processing (Existing, Relocated)

All existing post-processing runs on the **projected output** (Phase 3's result):
- `filterProductionInteractions()` — removes incidental Hovers, Scrolls, abandoned
  TextEntrys, no-op Dropdowns. Unclassified always passes (unchanged from current code).
- `runCapabilityInference()` — capability model on production interactions
- `toIRActions()` — IR mapping for test generation

None of these can cause data loss because they operate on data that is already complete
and fully accounted for.

---

## MV3 Durability Model

| State | Persisted? | Restored on SW restart? | Notes |
|---|---|---|---|
| Evidence Ledger | ✅ `chrome.storage.local` | ✅ Full restore | Entries with dispositions |
| liveInteractions | ✅ (existing) | ✅ Full restore | Completed interactions |
| interactionCounter | ✅ (RuntimeSnapshot) | ✅ | |
| seenEventIds | ✅ (RuntimeSnapshot) | ✅ | |
| dedupRecords | ✅ (RuntimeSnapshot) | ✅ | |
| activeStack | ❌ Not persisted | ❌ Starts empty | Transient classification state |
| memberEvents | ❌ Lost with activeStack | ❌ | |

### SW Restart Disposition Reset Rule

On SW restart, the ledger is restored from storage. The reset rule:

- `'claimed'` entries **stay** `'claimed'` — they are backed by completed interactions
  persisted in `liveInteractions`.
- `'absorbed'` entries are **reset to `'unclaimed'`** — the lifecycle that absorbed them
  is gone (activeStack not persisted). The claim cannot outlive the claimant.
- `'pending'` and `'unclaimed'` entries are unchanged.

This is the only disposition mutation that happens outside `process()` / `flush()`.
It is a simple, deterministic rule: **absorbed claims do not survive SW restart.**

---

## Content Script / EventTap Readiness

### Current State

The manifest specifies `"run_at": "document_start"` and `"all_frames": true`. This means
the content script is injected before page scripts run — the EventTap is installed at
the earliest possible point in the page lifecycle.

### The Remaining Gap

Between page unload (old document destroyed) and the new page's `document_start`,
there is no content script. Events during this window are not captured. This is a
**Layer 1 capture problem** — it cannot be solved by the Evidence Ledger architecture.

This gap is relevant for full page navigations (traditional form submissions, server
redirects). For SPA navigations (history.pushState), the content script persists — no gap.

### What This Implementation Does About It

This implementation does NOT attempt to solve the content script injection gap. That is
a separate problem requiring `chrome.webNavigation` onCommitted listeners or similar
mechanisms, and is out of scope for establishing the capture guarantee invariant.

The Evidence Ledger guarantees: **every event that reaches the SW is accounted for in
the output.** Ensuring every physical event reaches the SW is the next layer of work.

---

## What We Deliberately Postpone

1. **mousedown/click coalescing** — The projected output may contain both an
   Unclassified{mousedown} and a Click{click} for the same physical gesture. This is
   correct — both events occurred. Post-processing can coalesce them using the
   deterministic coordinate provenance already captured (clientX/clientY equality).
   This is Phase 4 post-processing work, not a capture guarantee concern.

2. **Fixing the `select` regex** — The broad `select` substring in
   `DROPDOWN_TRIGGER_CLASS_RE` causes false-positive Dropdown lifecycles. With the
   Evidence Ledger + dispositions, this no longer causes data loss (the absorbed click
   is released to 'unclaimed' when the Dropdown is abandoned, then projected as
   Unclassified). Fixing the regex is a classification accuracy improvement.

3. **Persisting activeStack** — Intentionally NOT done. Transient classification state
   should not govern durability. The ledger is what's durable.

4. **Fixing the `ensureSessionRestored()` async race** — The race can still reorder
   event processing in the runtime. But the Evidence Ledger sorts by `captureSeq`, so
   the projected output is correct regardless of processing order.

5. **Drag-and-drop (G1)** — Requires new event types and definitions. The disposition
   model extends naturally (drag lifecycle claims pointerdown/pointermove/pointerup).
   Build after the capture guarantee invariant is established and proven.

6. **Keyboard interaction modeling (G3)** — `keydown` enters the ledger and survives.
   Full keyboard interaction modeling is classification enrichment.

---

## Invariants Established

### INV-1: Capture Precedes Classification
Every discrete event is appended to the Evidence Ledger before `runtime.process()` runs.
No code path in the runtime — not absorption, not dedup, not discovery failure — can
prevent the ledger entry from existing.

### INV-2: Every Entry Receives Exactly One Disposition
The runtime assigns a disposition to each ledger entry as it processes the event.
At flush time, all dispositions are finalized. No entry is left in an ambiguous state.
The disposition is the runtime's explicit accounting — not an after-the-fact inference.

### INV-3: Classification Cannot Erase Evidence
The runtime may absorb events (`disposition = 'absorbed'`), but if the absorbing
lifecycle does not complete, the disposition is released to `'unclaimed'`. The event
survives in the ledger and is projected as Unclassified. Classification enriches; it
never erases.

### INV-4: Browser-Ordered Ledger
The Evidence Ledger is sorted by `(pageId, captureSeq)` where `captureSeq` is
`rawEvent.timeStamp` (browser-assigned at dispatch time). This ordering is deterministic
and immune to SW async processing races.

### INV-5: MV3 Durability
The Evidence Ledger is persisted to `chrome.storage.local` on every disposition change.
On SW restart, it is restored from storage. `'absorbed'` dispositions are reset to
`'unclaimed'` (the claimant is gone). `'claimed'` dispositions are stable (backed by
persisted completed interactions).

### INV-6: Document Boundaries Preserved
Cross-document ordering uses explicit page boundaries (pageId grouping + navigation
events). No fragile global clock is synthesized.

### INV-7: Projection Is a Pure Function
The Projection Engine does not investigate, match, reconstruct, or recover. It projects
ledger entries by their final disposition. `'unclaimed'` and `'pending'` → Unclassified.
`'claimed'` → represented by the claiming interaction. This is a filter + map, not a
reconciliation algorithm.

---

## Files Changed

### New Files

1. **`src/runtime/evidence-ledger.ts`** (~100 lines)
   - `EvidenceLedger` class
   - `append(event: ObservedEvent)`: filters to discrete types, creates entry with
     `disposition = 'pending'`, stores minimal target projection for Unclassified creation
   - `setDisposition(eventId, status, claimedBy?, claimType?)`: updates an entry's
     disposition (called by runtime)
   - `releaseClaims(lifecycleId)`: bulk-release all entries absorbed by a lifecycle
     (called at flush for abandoned/interrupted lifecycles)
   - `snapshot()` / `restore()`: for MV3 persistence. `restore()` resets all `'absorbed'`
     entries to `'unclaimed'` (SW restart disposition reset rule)
   - `resetAbsorbedToUnclaimed()`: called during restore
   - `clear()`: reset for new recording
   - `EVIDENCE_LEDGER_KEY = 'cmdrunner_evidence_ledger'` storage key
   - `DISCRETE_ACTION_TYPES` exported here (moved from component-runtime.ts)

2. **`src/runtime/projection-engine.ts`** (~50 lines)
   - `projectInteractions(ledger: EvidenceLedger, completedInteractions: ComponentInteraction[]): ComponentInteraction[]`
   - Pure function: filters ledger entries by disposition, creates Unclassified for
     `'unclaimed'` / `'pending'`, merges with completed interactions, preserves ordering
   - No matching, no reconstruction, no investigation

3. **`tests/runtime/evidence-ledger.test.ts`** (~18 tests)
   - Append discrete event → entry exists with disposition 'pending'
   - Append non-discrete event → no entry
   - Append duplicate eventId → no duplicate
   - `setDisposition` → updates entry
   - `releaseClaims` → bulk-releases entries for a lifecycle
   - Snapshot → restore → entries preserved
   - Restore resets 'absorbed' → 'unclaimed'
   - Sort by captureSeq within page
   - PageId grouping
   - Clear → empty

4. **`tests/runtime/projection-engine.test.ts`** (~15 tests)
   - Empty ledger + empty interactions → empty output
   - Ledger with 'pending' entry, 0 interactions → 1 Unclassified
   - Ledger with 'claimed' entry + matching interaction → 0 Unclassified
   - Ledger with 'absorbed' entry, 0 completed interactions → 1 Unclassified
   - Ledger with 'unclaimed' entry → 1 Unclassified
   - Ordering: Unclassified positioned by captureSeq
   - Multiple pages → page boundaries preserved

5. **`tests/runtime/end-to-end-capture.test.ts`** (~12 tests)
   - Integration: EventTap → EvidenceLedger → Runtime (with dispositions) → Projection → Output
   - Same-element absorption → lifecycle interrupted → event disposition released → projected as Unclassified
   - Same-element absorption → lifecycle completes → event disposition 'claimed' → not projected
   - SW restart simulation: absorbed → reset to unclaimed → projected
   - Event reordering → ledger sorted by captureSeq → projected in correct order
   - Multiple pages → page boundaries preserved
   - Dropdown false-positive (select regex) → click absorbed → Dropdown interrupted → click recovered
   - Dedup interaction suppressed → events still have dispositions → recovered if unclaimed

### Modified Files

6. **`src/shared/component-types.ts`**
   - Add `captureSeq: number` to `ObservedEvent` interface
   - Add `DispositionStatus` type and `LedgerEntry` interface (or import from evidence-ledger)
   - Move `DISCRETE_ACTION_TYPES` to a shared location (exported from evidence-ledger.ts or component-types.ts)

7. **`src/tap/event-tap.ts`**
   - One line in `assembleObservedEvent()`: `captureSeq: rawEvent.timeStamp,`
   - Navigation events (`emitSpaNavigation`): add `captureSeq: performance.now()` (synthetic
     equivalent — navigation is not a DOM event, so use the same clock)

8. **`src/runtime/component-runtime.ts`**
   - **Remove:** `createUnclassifiedInteraction()` method (lines 534–554)
   - **Remove:** Capture guarantee fallback 1 (lines 360–373)
   - **Remove:** Capture guarantee fallback 2 (lines 378–386)
   - **Add:** Disposition tracking — the runtime needs a reference to the EvidenceLedger
     (passed via RuntimeConfig or constructor). At each decision point where `handled=true`
     is set or an event is pushed to memberEvents, call `ledger.setDisposition()`.
     At `completeComponent()`, finalize dispositions based on endState.
   - **Add:** `lifecycleId` field to `ComponentContext` — a unique ID for each lifecycle
     instance (for `claimedBy` in dispositions). Can use the interactionCounter or a
     separate counter.
   - **Keep:** `DISCRETE_ACTION_TYPES` (moved to shared location but still used here),
     `lifecycleOwnsTarget`, `elementKey`, all definition/lifecycle/absorption logic

9. **`src/runtime/sw-integration.ts`**
   - Add `evidenceLedger: EvidenceLedger | null` singleton
   - `initRecording()`: create EvidenceLedger, persist empty, pass to runtime via config
   - `processObservedEvent()`: `evidenceLedger.append(event)` BEFORE `runtime.process(event)`,
     then `persistEvidenceLedger()` if disposition changed
   - `stopRecording()`: after flush, call `projectInteractions(evidenceLedger, liveInteractions)`,
     use the projected result as the return value (or merge projected Unclassified into
     liveInteractions)
   - `restoreFromStorage()`: restore EvidenceLedger from storage (this triggers the
     absorbed→unclaimed reset)
   - `resetState()`: clear EvidenceLedger
   - Add `persistEvidenceLedger()` helper (same pattern as `persistLiveInteractions`)

10. **`src/presentation/output-adapter.ts`**
    - No changes needed — `isProductionInteraction` and `toIRAction` already handle
      Unclassified correctly. The Unclassified interactions now come from the Projection
      Engine instead of the runtime, but the presentation layer doesn't care about the source.

11. **`src/background/service-worker.ts`**
    - No changes needed — `handleStopRecording()` already calls `stopRecording()` which
      now includes projection. The flow is transparent to the service worker.

### Existing Code That Becomes Obsolete

In `component-runtime.ts`:
- `createUnclassifiedInteraction()` — deleted entirely
- Capture guarantee fallback 1 (lines 360–373): `if (!completedImmediately && DISCRETE_ACTION_TYPES.has(event.eventType))` block
- Capture guarantee fallback 2 (lines 378–386): `if (DISCRETE_ACTION_TYPES.has(event.eventType))` block

### Existing Tests That Need Updating

- **`capture-guarantee-v2.test.ts`** (21 tests) — Rewrite: same scenarios, but assertions
  change from "runtime.process() emits Unclassified" to "Projection Engine projects
  Unclassified for unclaimed ledger entries." The test harness needs to create an
  EvidenceLedger, run events through the runtime (which assigns dispositions), then
  call `projectInteractions()`.

- **`discovery-absorption-regression.test.ts`** (8 tests) — Verify absorbed events have
  disposition `'absorbed'` in the ledger; on lifecycle interruption, disposition released
  to `'unclaimed'`; Projection Engine projects them.

- **`null-identity-regression.test.ts`** (15 tests) — Unchanged. Tests `elementKey()`
  null-safety, not capture guarantee.

- **`component-runtime.test.ts`** (3 Unclassified refs) — Update to expect no Unclassified
  from runtime; verify via Projection Engine.

- **`architectural-fixes.test.ts`** (2 Unclassified refs) — Same pattern.

---

## Testing Strategy

### Unit Tests

**EvidenceLedger:**
- Append discrete event → entry exists with disposition 'pending'
- Append non-discrete event → no entry
- Append duplicate eventId → no duplicate entry
- `setDisposition(eventId, 'absorbed', lifecycleId, 'Dropdown')` → entry updated
- `releaseClaims(lifecycleId)` → all entries with `claimedBy = lifecycleId` → 'unclaimed'
- Snapshot → restore → entries preserved
- Restore resets 'absorbed' → 'unclaimed' (SW restart rule)
- Sort by captureSeq within page
- PageId grouping
- Clear → empty

**Projection Engine:**
- Empty ledger, empty interactions → empty output
- Ledger with 1 'pending' entry, 0 interactions → 1 Unclassified
- Ledger with 1 'claimed' entry + matching interaction → 0 Unclassified
- Ledger with 1 'absorbed' entry (shouldn't happen post-flush, but test defensive) → 1 Unclassified
- Ledger with 1 'unclaimed' entry → 1 Unclassified
- Ordering: Unclassified positioned by captureSeq

### Integration Tests

**End-to-End Capture:**
- mousedown → Dropdown lifecycle absorbs (disposition 'absorbed') → click absorbed
  → stopRecording → flush → Dropdown interrupted → dispositions released to 'unclaimed'
  → Projection Engine projects 2 Unclassified
- Same scenario but Dropdown completes (option selected) → dispositions 'claimed'
  → Projection Engine projects 0 Unclassified (Dropdown interaction represents both events)
- SW restart simulation: process mousedown (disposition 'absorbed'), restart (ledger restored,
  'absorbed' reset to 'unclaimed'), process click (new Dropdown, 'absorbed') → flush →
  click's Dropdown interrupted → click released → Projection projects 2 Unclassified
- Event reordering: click processed before mousedown → ledger sorted by captureSeq →
  projected output in browser-observed order
- Multiple pages: events from page A, navigation, events from page B → page boundaries
  preserved in projected output
- Dropdown false-positive (broad 'select' regex): click on 'select-button' element →
  Dropdown created → click absorbed → Dropdown never completes → click disposition
  'unclaimed' → projected as Unclassified

### Regression Tests

- Run full existing test suite (3,962 tests). All should pass after updating the
  capture-guarantee tests to use the EvidenceLedger + Projection Engine interface.
- The Amazon "With Exchange" scenario: mousedown absorbed by false-positive Dropdown,
  click absorbed → both released at flush → projected as Unclassified → user sees
  both events (post-processing can later coalesce them).

---

## Constraints

- **No new element-specific rules** — no className regex changes, no selector changes
- **No timing heuristics** — no time windows, no delay-based matching
- **No allowlists** — no lists of "safe" elements or event types
- **No classification guardrails** — the runtime keeps its current absorption logic
  unchanged; dispositions record decisions but don't alter them
- **No fragile global ordering** — cross-document ordering uses page boundaries, not
  synthesized clocks
- **No reconstruction** — the Projection Engine projects; it does not reconstruct,
  match, or investigate
- **Additive where possible** — new files for EvidenceLedger and Projection Engine;
  minimal deletions in the runtime (only the now-obsolete fallback code)
