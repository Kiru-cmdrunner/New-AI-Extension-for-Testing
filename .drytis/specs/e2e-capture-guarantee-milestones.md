# End-to-End Capture Guarantee — Incremental Implementation Plan

**Architecture:** Evidence Ledger → ComponentRuntime (assigns dispositions) → Projection Engine → Observed Workflow / Capability Analysis / IR

**Spec:** `.drytis/specs/end-to-end-capture-guarantee.md`

**Constraint:** Each milestone leaves the extension in a fully working state. Every milestone ends with `npm run build && npx vitest run` passing. If a regression appears, `git revert <commit>` returns to the last known-good state.

---

## Milestone 1: `captureSeq` Field on ObservedEvent

**Goal:** Add the browser-assigned monotonic ordering field to `ObservedEvent`. No runtime or ledger changes. The field is assigned but unused downstream — purely additive.

### Files Modified
- `src/shared/component-types.ts` — add `captureSeq: number` to `ObservedEvent` interface (after `timestamp` at line 87)
- `src/tap/event-tap.ts` — one line in `assembleObservedEvent()` (after line 271): `captureSeq: rawEvent.timeStamp,`
- `src/tap/event-tap.ts` — `emitSpaNavigation()` synthetic navigation event: `captureSeq: performance.now(),` (navigation has no rawEvent)
- `tests/helpers/make-event.ts` — add `captureSeq: 0` to defaults

### Invariants Introduced
- (None yet — field exists but is not consumed)

### Tests Added
- `tests/tap/capture-seq.test.ts` (~5 tests):
  - `assembleObservedEvent` produces an event with `captureSeq` equal to `rawEvent.timeStamp`
  - Two sequentially-fired events have monotonically increasing `captureSeq` values
  - Navigation synthetic events have a `captureSeq` (from `performance.now()`)
  - `captureSeq` is a number, not undefined/null
  - `makeObservedEvent` test helper defaults `captureSeq` to 0

### Manual Validation
- `npm run build` — build succeeds (the new field is included in all ObservedEvent instances)
- `npx vitest run` — all 3,962+ tests pass (no existing test breaks because the field is additive)

### Rollback Point
- `git revert <milestone-1-commit>` — removes the field cleanly. No downstream code depends on it yet.

---

## Milestone 2: EvidenceLedger — Append-Only Store with Dispositions

**Goal:** Create the `EvidenceLedger` class with append, disposition management, snapshot/restore, and the SW-restart reset rule. Fully unit-tested in isolation. Not wired into the runtime yet.

### Files Created
- `src/runtime/evidence-ledger.ts` (~120 lines):
  - `DISCRETE_ACTION_TYPES` constant (moved from component-runtime.ts — the old location keeps a re-export for compatibility)
  - `DispositionStatus` type: `'pending' | 'absorbed' | 'claimed' | 'unclaimed'`
  - `LedgerEntry` interface: `{ eventId, captureSeq, pageId, eventType, timestamp, disposition, claimedBy?, claimType? }`
  - `EvidenceLedger` class:
    - `append(event: ObservedEvent): void` — filters to discrete types, deduplicates by eventId, extracts pageId from eventId, stores entry with `disposition='pending'`
    - `setDisposition(eventId, status, claimedBy?, claimType?): void` — updates a single entry
    - `releaseClaims(lifecycleId: string): void` — bulk-set all entries with `claimedBy === lifecycleId` to `'unclaimed'`
    - `get entries(): readonly LedgerEntry[]` — sorted by `(pageId, captureSeq)`
    - `snapshot(): LedgerEntry[]` — serializable array
    - `restore(entries: LedgerEntry[]): void` — restore from snapshot, then call `resetAbsorbedToUnclaimed()`
    - `resetAbsorbedToUnclaimed(): void` — set all `'absorbed'` entries to `'unclaimed'` (SW restart rule)
    - `clear(): void`
    - `size: number` getter
    - `EVIDENCE_LEDGER_KEY = 'cmdrunner_evidence_ledger'` export
- `tests/runtime/evidence-ledger.test.ts` (~20 tests):
  - Append click → entry exists with `'pending'`
  - Append focus → no entry (non-discrete)
  - Append scroll → no entry (non-discrete)
  - Append duplicate eventId → no duplicate
  - `setDisposition('evt-1', 'absorbed', 'lc-1', 'Dropdown')` → entry updated
  - `setDisposition` on unknown eventId → no-op (no throw)
  - `releaseClaims('lc-1')` → entries with `claimedBy='lc-1'` → `'unclaimed'`
  - `releaseClaims` on unknown lifecycleId → no-op
  - Snapshot → restore → entries preserved
  - Restore resets `'absorbed'` → `'unclaimed'`
  - Restore preserves `'claimed'` entries
  - Restore preserves `'unclaimed'` entries
  - Entries sorted by `captureSeq` within same pageId
  - Entries grouped by pageId
  - `clear()` → empty
  - `size` reflects entry count
  - pageId extraction: `evt-pABC-3` → `pABC`
  - All 4 discrete types (click, mousedown, contextmenu, keydown) produce entries
  - `DISCRETE_ACTION_TYPES` contains exactly `['click', 'contextmenu', 'mousedown', 'keydown']`

### Files Modified
- `src/runtime/component-runtime.ts` — change `DISCRETE_ACTION_TYPES` import to re-export from `evidence-ledger.ts` (one-line change: `export { DISCRETE_ACTION_TYPES } from './evidence-ledger';`). The local definition at line 77 is removed.
- `src/shared/component-types.ts` — export `DispositionStatus` type and `LedgerEntry` interface from here (shared types), importing the runtime-specific `EvidenceLedger` class stays in `evidence-ledger.ts`.

### Invariants Introduced
- **INV-LE-1:** Every discrete event appended to the ledger receives a `'pending'` disposition. No discrete event is silently rejected.
- **INV-LE-2:** Dispositions are mutable but follow a strict lifecycle: `pending → absorbed → (claimed | unclaimed)`. `claimed` is terminal. `unclaimed` is terminal.
- **INV-LE-3:** `restore()` always resets `'absorbed'` → `'unclaimed'` (SW restart rule).

### Manual Validation
- `npx vitest run tests/runtime/evidence-ledger.test.ts` — all 20 tests pass
- `npm run build` — build succeeds
- `npx vitest run` — all existing tests pass (`DISCRETE_ACTION_TYPES` re-export is transparent)

### Rollback Point
- `git revert <milestone-2-commit>` — removes the new files and restores the local `DISCRETE_ACTION_TYPES`. No runtime or SW code references the ledger yet.

---

## Milestone 3: Runtime Disposition Tracking

**Goal:** Wire the EvidenceLedger into the runtime so that every classification decision (absorption, completion, abandonment, interruption, stale cleanup) records a disposition. The runtime's existing capture-guarantee fallback code remains in place — it still emits Unclassified directly. This milestone adds **accountability** without changing **output**.

### Files Modified
- `src/shared/component-types.ts`:
  - Add `lifecycleId: string` to `ComponentContext` (line ~223, after `type`)
- `src/runtime/component-runtime.ts`:
  - `RuntimeConfig` gains optional `evidenceLedger?: EvidenceLedger` field
  - `ComponentRuntimeImpl` stores `private readonly ledger: EvidenceLedger | null`
  - `createContext()` (line 512): assign `lifecycleId: \`lc-${this.nextLifecycleId()}\`` using a counter
  - Add `private nextLifecycleId()` counter (separate from interactionCounter)
  - In `process()` active-stack scan (lines 234–283): when `handled=true` is set for a discrete event (line 246, 273, 282), call `ledger?.setDisposition(event.eventId, 'absorbed', ctx.lifecycleId, ctx.type)`
  - In `process()` discovery section (line 329): when a new lifecycle is created and pushed to stack (line 330), if the event is discrete, call `ledger?.setDisposition(event.eventId, 'absorbed', newCtx.lifecycleId, newCtx.type)`
  - In `process()` discovery section (line 341–348): when `completedImmediately` is true, call `ledger?.setDisposition(event.eventId, 'claimed', interaction.interactionId, interaction.type)` instead of `'absorbed'`
  - In `completeComponent()` (line 560): after interaction is emitted (line 604):
    - If `endState === 'completed'`: `ledger?.setDisposition(e.eventId, 'claimed', interaction.interactionId, ctx.type)` for triggerEvent + all memberEvents
    - If `endState === 'abandoned' || 'interrupted'`: `ledger?.releaseClaims(ctx.lifecycleId)` — releases all events this lifecycle absorbed
  - In `cleanupStaleComponents()` (line 437): after `completeComponent` with `'abandoned'` state, the releaseClaims call inside `completeComponent` handles it
  - In `flush()` (line 404): after `completeComponent` with `'interrupted'`, same — `completeComponent` handles the release
  - **Existing capture-guarantee fallbacks (lines 360–386) remain UNCHANGED** — they still emit Unclassified directly. This is intentional: the runtime still works standalone without a ledger, and the fallbacks provide backward-compatible output until Milestone 5 removes them.

### Tests Added
- `tests/runtime/disposition-tracking.test.ts` (~15 tests):
  - Click on button → completes immediately → ledger entry disposition = `'claimed'`
  - mousedown on div → no definition matches → ledger entry disposition stays `'pending'`
  - mousedown triggers Dropdown lifecycle → ledger entry disposition = `'absorbed'`
  - Dropdown lifecycle completes (option selected) → trigger mousedown disposition → `'claimed'`
  - Dropdown lifecycle interrupted at flush → trigger mousedown disposition → `'unclaimed'`
  - Dropdown lifecycle abandoned by stale cleanup → member events → `'unclaimed'`
  - Same-element absorption (line 282) → ledger entry disposition = `'absorbed'`
  - lifecycleOwnsTarget positive ownership → ledger entry disposition = `'absorbed'`
  - Different-target discrete event, no ownership → falls through → disposition stays `'pending'`
  - TextEntry completes on blur → all member events (focus, input, blur... wait, only discrete events are in ledger) → focus/input/blur are non-discrete, so only keydown (if any) would be in ledger
  - Multiple events absorbed by same lifecycle → all have same `claimedBy`
  - Lifecycle completes → all absorbed events → `'claimed'` with interactionId
  - Two lifecycles, one completes one doesn't → completed one's events claimed, other's unclaimed
  - No ledger provided (RuntimeConfig.evidenceLedger = undefined) → runtime works normally (backward compat)
  - Dedup-suppressed interaction (completeComponent returns null) → events stay `'absorbed'` → released at flush to `'unclaimed'`

### Invariants Introduced
- **INV-DT-1:** Every discrete event processed by the runtime receives a disposition update (from `'pending'` to either `'absorbed'` or `'claimed'`).
- **INV-DT-2:** When a lifecycle completes, all its discrete member events transition to `'claimed'`.
- **INV-DT-3:** When a lifecycle is abandoned/interrupted, all its discrete member events transition to `'unclaimed'`.
- **INV-DT-4:** The runtime works correctly with or without a ledger (backward compatibility).

### Manual Validation
- `npx vitest run tests/runtime/disposition-tracking.test.ts` — all 15 tests pass
- `npx vitest run tests/runtime/` — all existing runtime tests still pass (the ledger is optional, fallback code unchanged)
- `npm run build` — build succeeds
- `npx vitest run` — all 3,962+ tests pass

### Rollback Point
- `git revert <milestone-3-commit>` — removes disposition tracking from the runtime. The ledger (Milestone 2) still exists and is tested. The runtime reverts to its current behavior exactly.

---

## Milestone 4: SW Integration + Projection Engine + Verification Mode

**Goal:** Wire the EvidenceLedger into the service-worker integration layer. The ledger is created at `initRecording`, appended to in `processObservedEvent`, persisted for MV3 recovery, and projected at `stopRecording`. **The old runtime output remains the source of truth.** The Projection Engine runs in shadow mode — its output is compared against the runtime's output after every recording. If they differ, both outputs are preserved with a detailed diff report.

**The Projection Engine does NOT replace the runtime's output during this milestone.** `stopRecording()` continues to return the runtime's own `liveInteractions` (with the existing fallback code still emitting Unclassified). The projected output is computed and compared but discarded if equivalent, or reported if divergent.

### Files Created

- `src/runtime/projection-engine.ts` (~50 lines):
  - `projectInteractions(ledger: EvidenceLedger, completedInteractions: ComponentInteraction[]): ComponentInteraction[]`
  - Pure function: returns `[...completedInteractions]` plus an Unclassified for each ledger entry with disposition `'unclaimed'` or `'pending'`, ordered by `(pageId, captureSeq)`
  - Unclassified metadata: `{ physicalEventType, recognized: false, reason: 'unclaimed-at-projection', targetName, targetTag, targetRole }`
  - Unclassified positioned at its ledger entry's captureSeq within the page group

- `src/runtime/verification-mode.ts` (~120 lines):
  - `compareOutputs(runtimeOutput, projectedOutput, ledger): VerificationResult`
  - Performs a structural comparison of the two interaction arrays by eventId
  - Returns `{ match: boolean, differences: Difference[], runtimeOutput, projectedOutput, ledgerSnapshot }`
  - `Difference` includes: the interaction(s) that differ, the specific field(s) that differ (type, endState, metadata keys, triggerEventId, memberEventIds), and the ledger dispositions for the eventIds involved
  - `formatVerificationReport(result): string` — produces a human-readable diff for console / side-panel display
  - Only active when `verificationMode` flag is true (set in initRecording config)

### Files Modified

- `src/runtime/sw-integration.ts`:
  - Import `EvidenceLedger`, `EVIDENCE_LEDGER_KEY`, `projectInteractions`, `compareOutputs`, `formatVerificationReport`
  - Add `let evidenceLedger: EvidenceLedger | null = null;`
  - Add `let lastVerificationResult: VerificationResult | null = null;` (accessible via `getVerificationResult()`)
  - `initRecording()`: create `evidenceLedger = new EvidenceLedger()`, pass to runtime via `config.evidenceLedger = evidenceLedger`, persist empty ledger
  - `processObservedEvent(event)`: `evidenceLedger?.append(event)` BEFORE `runtime.process(event)`, then `persistEvidenceLedger()` after process
  - `stopRecording()`:
    1. Flush runtime → `liveInteractions` (unchanged — runtime's own output with fallbacks)
    2. Compute `projectedOutput = projectInteractions(evidenceLedger, liveInteractions)`
    3. Compute `verificationResult = compareOutputs(liveInteractions, projectedOutput, evidenceLedger)`
    4. Store `lastVerificationResult = verificationResult`
    5. If `!verificationResult.match`: `console.error(formatVerificationReport(verificationResult))`
    6. **Return `liveInteractions`** (the runtime's output — NOT the projected output)
  - `restoreFromStorage()`: restore `evidenceLedger` from storage (triggers `resetAbsorbedToUnclaimed`)
  - `resetState()`: `evidenceLedger = null`, `lastVerificationResult = null`, remove `EVIDENCE_LEDGER_KEY` from storage
  - Add `persistEvidenceLedger()` helper
  - Add `getVerificationResult(): VerificationResult | null` export (for side-panel / test access)

### Tests Added

- `tests/runtime/projection-engine.test.ts` (~15 tests):
  - Empty ledger + empty interactions → empty output
  - Ledger with 1 `'pending'` entry, 0 interactions → 1 Unclassified
  - Ledger with 1 `'claimed'` entry + 1 matching interaction → 0 Unclassified
  - Ledger with 1 `'absorbed'` entry, 0 completed interactions → 1 Unclassified (defensive — shouldn't happen post-flush)
  - Ledger with 1 `'unclaimed'` entry → 1 Unclassified
  - Ledger with mousedown(`'unclaimed'`) + click(`'claimed'`) → 1 Unclassified (mousedown) + 1 Click
  - Ordering: Unclassified positioned by captureSeq within page
  - Multiple pages → page boundaries preserved (pageId grouping)
  - Unclassified has correct `physicalEventType` from ledger entry
  - Unclassified has `recognized: false` and `reason: 'unclaimed-at-projection'`
  - 3 entries, 2 claimed by 1 interaction, 1 unclaimed → 1 interaction + 1 Unclassified
  - All 4 disposition statuses handled correctly
  - Completed interactions preserved in output (not filtered)
  - Large ledger (100 entries, 50 claimed) → 50 Unclassified + 50 interactions
  - pageId extraction and grouping

- `tests/runtime/sw-ledger-integration.test.ts` (~8 tests):
  - `initRecording()` creates empty ledger, persists to storage
  - `processObservedEvent()` appends discrete events to ledger
  - `processObservedEvent()` does NOT append non-discrete events
  - `stopRecording()` returns runtime's `liveInteractions` (not projected output)
  - `restoreFromStorage()` restores ledger and resets absorbed → unclaimed
  - `resetState()` clears ledger from storage
  - Ledger persists across simulated SW restart (save → clear → restore)
  - Multiple pages: events from different pageIds grouped correctly

- `tests/runtime/verification-mode.test.ts` (~12 tests):
  - Identical outputs → `match: true`, empty differences
  - Runtime has 1 Unclassified, projection has 1 Unclassified for same eventId → match
  - Runtime has 1 Click, projection has same Click → match
  - Runtime has 1 Click (fallback didn't fire), projection has 1 Unclassified → `match: false`, difference reported with disposition `'pending'`
  - Runtime has 0 interactions (absorbed silently), projection has 1 Unclassified → `match: false`, difference reported with disposition `'unclaimed'`
  - Runtime has 2 interactions, projection has 3 (extra Unclassified from released claim) → `match: false`, extra interaction reported
  - Difference includes the ledger entries (eventId, disposition, claimedBy) for all involved eventIds
  - Difference includes the specific field that differs (type mismatch, missing interaction, extra interaction)
  - `formatVerificationReport` produces readable text with eventIds, types, and disposition
  - Both outputs preserved in the VerificationResult (not just the diff)
  - Comparison by structural equality: same type + same triggerEvent.eventId + same endState = match
  - Comparison handles interactions with no triggerEvent.eventId (shouldn't happen, but defensive)

- `tests/runtime/verification-regression.test.ts` (~10 tests):
  - **Full pipeline comparison** — run real event sequences through the runtime with ledger, compare runtime output vs projected output:
  - Simple button click → both produce 1 Click → match
  - TextEntry (focus → input → input → blur) → both produce 1 TextEntry → match
  - Dropdown (trigger → option click → change) → both produce 1 Dropdown → match
  - Unrecognized click on div → both produce 1 Unclassified → match
  - Dropdown false-positive (mousedown on 'select-button' element, no completion) → runtime emits 1 Unclassified (fallback), projection emits 1 Unclassified (unclaimed) → match
  - Same-element absorption by active lifecycle → runtime fallback fires 1 Unclassified, projection emits 1 Unclassified → match
  - Multiple sequential clicks → both produce same set → match
  - Navigation event → both produce 1 Navigation → match
  - Scroll → both produce 1 Scroll → match (scroll is non-discrete, not in ledger)
  - Contextmenu → both produce 1 Unclassified → match

### Invariants Introduced
- **INV-PE-1:** Projection Engine output = completed interactions + Unclassified for each `'unclaimed'`/`'pending'` ledger entry. This is a pure function — same input always produces same output.
- **INV-PE-2:** Every discrete event that entered the ledger is represented in the projected output: either by its claiming interaction (`'claimed'`) or as an Unclassified (`'unclaimed'`/`'pending'`).
- **INV-SW-1:** The ledger is persisted to `chrome.storage.local` on every disposition change and restored on SW restart.
- **INV-VM-1:** The old runtime output is the source of truth. The Projection Engine does not alter the extension's behavior during Milestone 4.
- **INV-VM-2:** Every divergence between runtime output and projected output is detected, reported with full evidence (dispositions, eventIds, field-level diff), and preserved for inspection.

### Manual Validation
- `npx vitest run tests/runtime/projection-engine.test.ts` — all 15 tests pass
- `npx vitest run tests/runtime/sw-ledger-integration.test.ts` — all 8 tests pass
- `npx vitest run tests/runtime/verification-mode.test.ts` — all 12 tests pass
- `npx vitest run tests/runtime/verification-regression.test.ts` — all 10 tests pass
- `npm run build` — build succeeds, extension packs correctly
- `npx vitest run` — all existing tests pass
- **Load extension in Chrome, record on multiple real-world sites:**
  - **OrangeHRM** (internal app): login, navigate to admin, interact with dropdowns, checkboxes, text fields. Stop recording. Check `chrome.storage.local` for `cmdrunner_verification_result`. If `match: false`, inspect the diff report — this is a projection bug that must be fixed before Milestone 5.
  - **Amazon.in**: search, click product, expand accordions, add to cart. Same verification.
  - **Avis** (or similar car rental): search form, date pickers, location selectors. Same verification.
  - **At least 3 distinct real-world recordings** must show `match: true` (or documented, understood, and fixed divergences) before proceeding to Milestone 5.

### Gate Condition for Milestone 5

**Milestone 5 may only begin when ALL of the following are true:**

1. `npx vitest run` — entire test suite green (including all new verification tests)
2. `tests/runtime/verification-regression.test.ts` — all 10 tests show `match: true`
3. **At least 3 real-world manual recordings** (Amazon, OrangeHRM, Avis or equivalent) show `match: true` in `lastVerificationResult`
4. Any divergences found during manual testing have been investigated, documented in a note (`note_save`), and either:
   - Fixed in the Projection Engine so they match, OR
   - Documented as a known acceptable difference (e.g., projection correctly recovers an event the runtime lost — this is a *good* divergence that proves the architecture works, but needs explicit sign-off)

### Rollback Point
- `git revert <milestone-4-commit>` — removes SW ledger integration, Projection Engine, and Verification Mode. The runtime reverts to its current behavior (fallback code still present from Milestone 3). The EvidenceLedger class (Milestone 2) and runtime disposition tracking (Milestone 3) remain but are unused.

---

## Milestone 5: Remove Runtime Fallbacks — Cutover to Projection

**Goal:** Remove the obsolete capture-guarantee fallback code from the runtime. The Projection Engine is now the sole source of Unclassified interactions. This is the cutover milestone where the architecture changes from "runtime emits Unclassified" to "runtime assigns dispositions, Projection Engine emits Unclassified."

### Files Modified
- `src/runtime/component-runtime.ts`:
  - **Delete** `createUnclassifiedInteraction()` method (lines 534–554)
  - **Delete** capture guarantee fallback 1 (lines 350–373): the `if (!completedImmediately && DISCRETE_ACTION_TYPES.has(event.eventType))` block
  - **Delete** capture guarantee fallback 2 (lines 374–387): the `if (DISCRETE_ACTION_TYPES.has(event.eventType))` block in the `else` branch
  - Clean up unused imports if any

### Tests Modified
- `tests/runtime/capture-guarantee-v2.test.ts` (21 tests):
  - Rewrite test harness: create `EvidenceLedger`, pass to runtime via `config.evidenceLedger`, run events through `runtime.process()`, then call `projectInteractions(ledger, emittedInteractions)` and assert on the projected output
  - Same test scenarios, same expected outcomes — the assertion target changes from `runtime.process()` return to `projectInteractions()` return
  - Example: "preserves a click on a plain DIV as Unclassified" — the click's ledger entry stays `'pending'` (no definition matched) → Projection Engine projects it as Unclassified. Same result, different mechanism.

- `tests/runtime/discovery-absorption-regression.test.ts` (8 tests):
  - Same rewrite pattern: add ledger to runtime config, assert via projection output

- `tests/runtime/component-runtime.test.ts` (3 Unclassified refs):
  - Update to expect 0 Unclassified from `runtime.process()` directly; verify Unclassified comes from `projectInteractions()` instead

- `tests/runtime/architectural-fixes.test.ts` (2 Unclassified refs):
  - Same pattern

### Tests Added
- `tests/runtime/end-to-end-capture.test.ts` (~12 integration tests):
  - **Amazon "With Exchange" simulation:** mousedown → Dropdown detects trigger (className with 'select') → Dropdown lifecycle absorbs mousedown → click absorbed (same-element) → flush → Dropdown interrupted → both dispositions released to `'unclaimed'` → Projection projects 2 Unclassified
  - **Same scenario, Dropdown completes:** user selects an option → Dropdown completes → trigger event disposition `'claimed'` → Projection projects 0 Unclassified for the trigger, 1 Dropdown interaction
  - **SW restart simulation:** process mousedown (disposition `'absorbed'`), save ledger, clear runtime, restore ledger (absorbed → unclaimed reset), process click (new lifecycle), flush → both projected as Unclassified
  - **Event reordering:** process click before mousedown → ledger sorted by captureSeq → projected output in browser-observed order
  - **Multiple pages:** events from page A, navigation, events from page B → page boundaries preserved
  - **No-match discrete event:** click on bare div → no definition matches → disposition stays `'pending'` → projected as Unclassified
  - **Dedup-suppressed interaction:** same-type same-element within DEDUP_WINDOW_MS → interaction suppressed → events stay `'absorbed'` → released at flush → projected as Unclassified
  - **Stale cleanup:** lifecycle exceeds 15s → abandoned → member events released → projected as Unclassified
  - **Contextmenu:** right-click → no match → `'pending'` → projected as Unclassified with `physicalEventType='contextmenu'`
  - **Keydown:** key press on non-text element → `'pending'` → projected as Unclassified with `physicalEventType='keydown'`
  - **Ledger persists across SW restart** (storage mock): append → snapshot → restore → entries preserved, absorbed reset
  - **Completed interaction claims all member events:** TextEntry focus→input→blur→complete → only discrete member events (if any) have `'claimed'` disposition

### Invariants Introduced (Final)
- **INV-1: Capture Precedes Classification** — every discrete event is appended to the Evidence Ledger before `runtime.process()` runs.
- **INV-2: Every Entry Receives Exactly One Disposition** — the runtime assigns a disposition at processing time; finalized at flush.
- **INV-3: Classification Cannot Erase Evidence** — absorbed events are released to `'unclaimed'` if the lifecycle doesn't complete.
- **INV-7: Projection Is a Pure Function** — no matching, no reconstruction, no investigation.

### Manual Validation
- `npx vitest run` — ALL tests pass (including rewritten capture-guarantee tests and new end-to-end tests)
- `npm run build` — build succeeds
- **Load extension in Chrome:**
  - Record a simple click on a button → Click interaction appears in side panel ✓
  - Record a click on a non-interactive div → Unclassified appears in side panel ✓
  - Record the Amazon "With Exchange" scenario → no total loss; events may appear as Unclassified (correct — post-processing coalescing is future work) ✓
  - Stop recording → Observed Workflow shows all deliberate actions ✓
  - Capability Analysis runs on projected output ✓
  - IR generation produces correct test steps ✓

### Rollback Point
- `git revert <milestone-5-commit>` — restores the runtime fallback code. The Projection Engine still exists (Milestone 4) but the runtime also emits Unclassified directly again. System reverts to Milestone 4's parallel-run state.

---

## Dependency Graph

```
Milestone 1 (captureSeq field)
    ↓
Milestone 2 (EvidenceLedger class)
    ↓
Milestone 3 (Runtime disposition tracking)
    ↓
Milestone 4 (SW integration + Projection Engine + Verification Mode)
    ↓
    ├─ Gate: verification-regression tests ALL match:true
    ├─ Gate: ≥3 real-world recordings match:true
    ├─ Gate: any divergences documented or fixed
    ↓
Milestone 5 (Remove runtime fallbacks — cutover)
```

Each milestone depends only on the previous one. No milestone can be skipped. But each can be reverted independently — the system degrades gracefully to the previous milestone's state. **Milestone 4→5 is gated**: the runtime fallback code is not removed until Verification Mode demonstrates equivalent output across the full regression suite and at least 3 real-world recordings.

---

## What NOT to Do During Implementation

1. **Do NOT fix the `select` regex** — classification accuracy is out of scope
2. **Do NOT add mousedown/click coalescing** — Phase 4 post-processing, separate milestone
3. **Do NOT change any definition file** (Dropdown, DatePicker, Click, etc.) — definitions are unchanged
4. **Do NOT persist activeStack** — intentionally not persisted
5. **Do NOT change the `ensureSessionRestored()` async pattern** — captureSeq ordering makes it harmless
6. **Do NOT change the content script injection mechanism** — Layer 1 problem, separate scope
7. **Do NOT change `filterProductionInteractions` or `toIRAction`** — they already handle Unclassified correctly

---

## Test Suite Growth

| Milestone | New Tests | Cumulative | Existing Tests Modified |
|---|---|---|---|
| 1 | ~5 | 3,967 | 0 |
| 2 | ~20 | 3,987 | 0 |
| 3 | ~15 | 4,002 | 0 |
| 4 | ~45 | 4,047 | 0 |
| 5 | ~12 | 4,059 | ~34 (rewritten, same scenarios) |

At every milestone, `npx vitest run` must show all-green before proceeding to the next.
