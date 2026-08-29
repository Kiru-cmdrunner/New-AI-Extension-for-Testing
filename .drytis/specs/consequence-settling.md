# Spec: Consequence-Settling Evidence Windows (activity-based, no fixed post-action timeout)

**Date:** 2026-08-18
**Status:** DRAFT — awaiting approval before implementation
**Supersedes:** the timing-tail proposal from `.drytis/notes/dialog-evidence-rca-2026-08-18.md` §"Fix direction"
**Design basis:** `.drytis/notes/consequence-settling-design-2026-08-18.md`
**RCA:** `.drytis/notes/addcart-thin-evidence-root-cause.md`, `.drytis/notes/dialog-evidence-rca-2026-08-18.md`

---

## 1. Problem

A lifecycle-bound click window is closed by FINALIZE_EVIDENCE + a **fixed 150ms settle**
(`evidence-collector.ts` `finalizeWindow`, `settleDelay = 150`). The DOMObserver refcount
then drops to zero and **disconnects** (`cleanupWindow` → `domObserver.stop()`), so any
application consequence that materializes after ~160ms — Amazon's "Added to cart" dialog
at +400–900ms — is **never observed** (RCA category A). Network-only late data is
recovered by the G3 +1000ms re-collect, but DOM/surface/visibility consequences have no
such path. Adding another fixed tail (e.g. "+1000ms app re-collect") is rejected: it
re-encodes the same arbitrary-timing assumption.

## 2. Goal Model

```
User action
  ↓
Observe resulting application activity (DOM + causal network)
  ↓
Determine when the consequence has settled  ← quiescence + causal-network-idle
  ↓
Capture the complete application evidence   ← ONE delivery per window
  ↓
Finalize the interaction
```

NOT `wait X ms → finalize`.

## 3. Non-Negotiable Constraints (from approval)

1. **Application Knowledge Recorder semantics** — every physical/user action remains a
   separate interaction. No merging, combining, or removal of interactions.
2. **Click + subsequent Navigation remain separate interactions.**
3. **No arbitrary post-action timeout** (no "wait 1000ms" class constant introduced).
4. **Reuse the existing AdaptiveWindow quiescence mechanism** (M3 `minQuiescence=300ms`).
5. **Settle predicate = DOM quiescence AND causal in-flight == 0.**
6. **Existing 10s hard cap remains the safety bound.**
7. **`isUnloading` / navigation behavior unchanged** (pagehide INV-4 zero-delay finalize;
   post-nav window semantics untouched).
8. **The uncommitted `sw-integration.ts` network-supplement shape guard is preserved
   verbatim** — not replaced, not weakened, not extended in this change.
9. **No Amazon/product/Add-to-cart-specific logic.**
10. **No changes to the 3 E1-prep files** (`knowledge-loader.ts`, `contract-queries.ts`,
    `knowledge-contract.ts`).

## 4. Current State Machine (as-is)

```
openWindow(click)                         evidence-collector.ts:388
  ├─ lifecycleBindings.size > 0 → setHoldOpen(true)     :475-478
  │    → AdaptiveWindow.checkStabilized() re-arms forever (adaptive-window.ts:244-249)
  │    → max-duration timer NEVER armed (arm() skips when holdOpen, :107-116)
  └─ AdaptiveWindow.arm()

SW: interaction emitted → sendFinalizeEvidence          sw-integration.ts:602
CS: finalizeForInteraction(payload)                     evidence-collector.ts:1238
  ├─ matchesPostNavWindow → early return (INV-C2)       :1259-1271
  ├─ matching window → finalizeWindow(win, payload, 150)
  │    └─ setTimeout(150) → executeFinalization         :1325-1328
  │         → scheduleLateNetworkReCollect (G3)         :1401
  │         → buildAndDeliverEvidence('lifecycle-complete')
  │         → cleanupWindow → refcount 0 → domObserver.stop()   ← observer dies
  └─ no match → finalizeWithoutWindow (synthetic)
```

## 5. Target State Machine (to-be)

```
openWindow(click)                          [unchanged]
  └─ setHoldOpen(true)                     [unchanged]

SW: interaction emitted → FINALIZE_EVIDENCE [unchanged — emit timing unchanged]
CS: finalizeForInteraction(payload)         [routing unchanged: post-nav guard,
  │                                          member-window handling unchanged]
  └─ matching window, NOT isUnloading:
       enterSettleMode(win, metadata, endReason)          ← REPLACES setTimeout(150)
         ├─ idempotent: if state.settleMode already set → return
         ├─ state.settleMode = true; state.settleMetadata = metadata
         ├─ adaptiveWindow.setHoldOpen(false)             ← NOW arms max-duration
         │                                                timer if absent (remaining
         │                                                time from OPEN, not from now)
         └─ adaptiveWindow.setCanClose(() => causalNetworkIdle(state))

AdaptiveWindow (self-closing, existing mechanism + canClose):
  quiescence 300ms elapsed AND elapsed ≥ minDuration AND canClose()
    → close('stabilized')                                ← same close path as today
  OR 10s-from-open cap → close('max-duration')
  OR pagehide → (collector) executeFinalization('page-reload')     [unchanged]
  OR recording stop → close('recording-stopped')                   [unchanged]
  OR displacement → close('displaced')                             [unchanged]

onClose → closeWindow(windowId, evidenceWindow)
  └─ if state.settleMode:
       endReason := (evidenceWindow.endReason === 'stabilized')
                     ? 'consequence-settled' : evidenceWindow.endReason
       scheduleLateNetworkReCollect(state)               [G3 kept]
       buildAndDeliverEvidence(state, afterSnapshot, endReason)
       cleanupWindow(state)
       return                                             ← no other delivery for this window
  └─ else: existing closeWindow path verbatim (post-nav, non-lifecycle windows)
```

**No new timer classes.** The quiescence timer *is* the settle poll: while `canClose()`
is false, `checkStabilized()` re-schedules at 300ms cadence (same branch shape as the
existing `holdOpen` re-schedule in `adaptive-window.ts:244-249`).

## 6. Exact Files / Functions to Change

| # | File | Change |
|---|------|--------|
| 1 | `src/tap/adaptive-window.ts` | (a) config gains optional `canClose?: () => boolean`. (b) `checkStabilized()`: after `elapsed >= minDuration` and quiescence elapsed, consult `this.canClose?.()` — if it returns `false`, re-schedule stabilization (mirror the holdOpen branch). (c) `setHoldOpen(false)`: if `maxDurationTimer` absent and window open, arm it with `remaining = maxDuration - (now - openedAt)`; if `remaining <= 0`, close('max-duration') immediately. (d) `close()` clears `canClose`. |
| 2 | `src/tap/network-bridge.ts` | Additive getter `getInFlightRequestIds(): Set<string>` — iterate `inFlight` map, collect `requestId` of every entry. No behavior change elsewhere. |
| 3 | `src/tap/evidence-collector.ts` | (a) `ObservationWindowState` gains `settleMode: boolean` (default false) and `settleMetadata: Record<string, unknown> \| null`. (b) `finalizeWindow`: the non-unloading branch (`setTimeout(..., settleDelay)`) is replaced by `enterSettleMode(win, payload.metadata, endReason)`. The `isUnloading` (settleDelay === 0) branch keeps `executeFinalization` directly. (c) New private `enterSettleMode` and `causalNetworkIdle` (below). (d) `closeWindow`: settle-mode branch as in §5. (e) STOP path + `onPageHide` unchanged. |
| 4 | `src/shared/behavioral-evidence-types.ts` | `endReason` union += `'consequence-settled'` (doc comment: window closed by quiescence after lifecycle finalize entered settle mode). |

**Explicitly NOT changed:** `src/runtime/sw-integration.ts` (uncommitted shape guard stays
byte-identical), `src/recorder/**`, `src/background/**`, `src/sidepanel/**`,
`src/understanding/**`, the 3 E1-prep files.

## 7. How `canClose` Interacts with AdaptiveWindow

- `canClose` is consulted **only** in `checkStabilized()`, **only after** the quiescence
  interval has elapsed and `minDuration` satisfied — it can *delay* a stabilized close,
  never force one, never fire on its own, never consulted while holdOpen is true
  (holdOpen branch returns first, as today).
- While `canClose()` is false, the stabilization timer re-arms every `minQuiescence`
  (300ms) — this is the network-idle poll cadence. No additional timers, no intervals.
- Setting `canClose(null)`/omitting it preserves today's behavior exactly (pure DOM
  quiescence) — required for the post-nav window and non-lifecycle windows, which are
  untouched.

## 8. Causal Request-ID Determination (no timing assumptions)

Causality = **requestId membership**, reusing CER-3 exactly:

```
at open:      state.requestIdsAtOpen = bridge.snapshotRequestIds()      (existing, :441-443)
at check T:   inFlight   = bridge.getInFlightRequestIds()              (new getter)
              causalInFlight = inFlight \ requestIdsAtOpen \ NOISE_URLS
              settled ⇔ causalInFlight.size === 0
```

- A request **in flight at open** (background poll started pre-click) is in
  `requestIdsAtOpen` → excluded — never blocks settling.
- A request **started after open** → not in `requestIdsAtOpen` → causal → blocks until
  it completes; whatever DOM mutations its completion triggers re-arm quiescence
  (correlation by **ordering**: in-flight blocks, completion's mutations re-arm — no
  wall-clock correlation).
- `NOISE_URLS` = the existing generic noise/telemetry URL filter already used by the
  SW-side network drain (`src/background/network-drain.ts:52-56`) — **reused**, not
  re-invented, applied by URL pattern (content-based, not product-specific, not timing).
- `bridge == null` (no network instrumentation) → `causalNetworkIdle` returns `true`
  (pure DOM-quiescence settling).

## 9. Overlapping Interactions Stay Isolated

- **Interaction emission is unchanged.** The Click interaction is emitted when its
  semantic lifecycle completes (~10ms), exactly as today; the ledger, dedup, and
  Click-vs-Navigation separation logic are untouched. Only *evidence attachment time*
  changes (later), and `attachEvidenceToInteraction` Tier-1 trigger matching
  (`sw-integration.ts:444-450`) already handles late evidence — the panel's
  `INTERACTION_EVIDENCE_UPDATE` live path already renders it.
- Windows are per-eventId (`ev-${eventId}`); overlapping windows already share the
  collector-global accumulation under Fix Pair 2 (INV-C1) semantics — unchanged.
- `finalizeForInteraction` continues to settle the FIRST matching window and silently
  close (`closeWindowSilently`, 'displaced') any additional matching windows — unchanged.
- Companion suppression (`companionSuppressUntil`, set at finalize receipt) — unchanged.
- Click + Navigation: pagehide → INV-4 zero-delay finalize for the click window;
  destination churn belongs to the dedicated post-nav window attributed to the
  navEventId → the synthetic **Navigation interaction — separate interaction, by
  construction, unchanged**.

## 10. Polling / Background Traffic Cannot Hold a Window Indefinitely

1. **Pre-existing polls** (in flight at open): excluded by membership (§8).
2. **Recurring polls started after open**: each in-flight cycle blocks settling, but a
   poll completes and the next hasn't started ⇒ at some 300ms check the causal in-flight
   set is empty AND the DOM is quiescent (poll with no DOM consequence) → window
   **settles within ≈ one poll cycle**. A poll *with* DOM consequences re-arms
   quiescence per batch — window closes 300ms after the last mutation batch.
3. **Telemetry/noise endpoints**: excluded by the NOISE_URL filter.
4. **Pathological case** (sub-300ms-interval perpetual causal storms): never quiescent →
   the **10s hard cap** closes the window ('max-duration') with `coarseMode` /
   `domChangeOverflow` already flagging the churn honestly. The cap is a backstop, not
   part of the model. **The observer can never outlive 10s from window open** (settle
   mode re-arms the cap timer; see §5).

## 11. Behavior at the 10s Cap

- Cap is measured **from window OPEN** (not from finalize/settle-entry): timer armed with
  `remaining = maxDuration - elapsed`; if finalize arrives after 10s of open time,
  `setHoldOpen(false)` closes immediately ('max-duration').
- Close reason: raw `'max-duration'` (honest fact; not 'consequence-settled').
- Evidence delivered **once**, complete-with-what-was-observed, via the same settle-mode
  `closeWindow` branch; G3 re-collect still scheduled.

## 12. Slow Requests After the Cap

Unchanged, already-correct path: G3 `scheduleLateNetworkReCollect` fires +1000ms after
close, collects late completions for the window range, delivers a **targetless,
network-only supplement** — which the **retained uncommitted shape guard**
(`isNetworkSupplement` structural classification + null-target-never-replaces-target)
classifies and **merges** into the existing evidence (network rows appended, dedup by
requestId; target identity, window, and application arrays preserved). No change to
that fix; this spec depends on it, not replaces it.

## 13. Exact Evidence Merge Behavior

- **Normal case — one delivery, zero merges.** Settle close delivers the complete
  evidence object (dom/surfaces/visibility/network captured in one window);
  `attachEvidenceToInteraction` Tier-1 attaches it (first evidence wins — no existing
  evidence at that point since the window only delivers at close).
- **Late network rows** — G3 supplement → shape-guarded network-only merge (§12).
- **No supplement replaces real evidence.** Guaranteed by the retained guard.
- **Multiple matching windows** — only the first settles and delivers; extras close
  silently (no evidence) — unchanged.
- **Interaction-level:** no evidence field is ever merged ACROSS interactions.

## 14. Red-Phase Unit Tests (`tests/tap/`)

New `tests/tap/consequence-settling.test.ts` (fake timers + mocked `performance.now`,
conventions from `adaptive-window.test.ts`):

- [ ] UA1 `canClose=false` blocks the stabilized close; window stays open; re-schedules
      at 300ms cadence (assert timer re-armed, no close).
- [ ] UA2 `canClose=true` + 300ms quiescence → closes 'stabilized'.
- [ ] UA3 `canClose` is never consulted before quiescence/minDuration satisfied.
- [ ] UA4 `setHoldOpen(false)` arms the max-duration timer with remaining-from-OPEN;
      closes 'max-duration' at open+10s even if entered settle at +2s.
- [ ] UA5 `setHoldOpen(false)` when elapsed ≥ maxDuration → immediate 'max-duration'.
- [ ] UA6 FINALIZE_EVIDENCE (not unloading) → window NOT closed at +150ms (old behavior
      gone); enters settle mode; closes 'consequence-settled' after quiescence+idle.
- [ ] UA7 `causalNetworkIdle`: request in flight at open → does NOT block; request
      started after open & in flight → blocks; completes → unblocks; noise-URL request
      → excluded; bridge null → true.
- [ ] UA8 Duplicate FINALIZE_EVIDENCE → idempotent (no double delivery, no error).
- [ ] UA9 pagehide during settle → immediate 'page-reload' finalize (INV-4, unchanged).
- [ ] UA10 recording stop during settle → 'recording-stopped' (existing stop semantics).
- [ ] UA11 endReason mapping: settle close 'stabilized'→'consequence-settled';
       cap close stays 'max-duration'; non-settle windows keep raw endReason.
- [ ] UA12 G3 re-collect still scheduled from the settle close path.
- [ ] UA13 Evidence delivered exactly ONCE per settle window (delivery count == 1).

Existing-suite migration (behavior change is intentional):
- [ ] Tests asserting `lifecycle-complete` for non-unloading finalize timing are updated
      to `consequence-settled` + settle-close timing (not deleted — re-asserted).

## 15. Integration Tests (`tests/tap/`, real timers, jsdom)

- [ ] IA1 Delayed modal (+600ms, role=dialog + aria-hidden popover) → evidence contains
      `newSurfaces` entry for the dialog AND `visibilityChanges` for the popover;
      endReason 'consequence-settled'; durationMs > 600.
- [ ] IA2 Fast modal (+100ms) → same assertions (no regression for in-window effects).
- [ ] IA3 Polling page (1s-interval causal fetch, no DOM change) → settles within
      ~1 poll cycle + quiescence; does NOT reach the cap.
- [ ] IA4 Polling page with DOM ticker → closes at cap 'max-duration'; no hang; test
      bound < 11s.
- [ ] IA5 Slow causal XHR (2.5s) → settles after completion; response-triggered DOM
      change captured; not closed early.
- [ ] IA6 No consequence → settles ≈ 350ms; empty application arrays; 'consequence-settled'.
- [ ] IA7 Form-submit navigation (isUnloading) → immediate finalize, 'page-reload',
      separate Navigation interaction — unchanged.
- [ ] IA8 Click + subsequent navigation remain TWO interactions; click evidence attaches
      to click; post-nav evidence to Navigation.

## 16. Real-Chrome Validation (CDP harness, `.drytis/notes/evidence/`)

New `settle-harness.mjs` (extends the proven `dialog-evidence-rca-harness.mjs` pattern;
full applicationEvidence dump per interaction):

- [ ] RC1 Amazon-style delayed modal (+500–600ms dialog + popover + 34-fetch burst):
      click interaction evidence HAS target + newSurfaces(dialog) +
      visibilityChanges(popover) + merged network rows; endReason 'consequence-settled';
      window duration spans the dialog.
- [ ] RC2 Fast modal (+100ms): same shape, no regression.
- [ ] RC3 Form-submit navigation (Vivo shape): click 'page-reload' + separate Navigation
      interaction with post-nav evidence — unchanged.
- [ ] RC4 Polling replica: settles bounded (no 10s cap hit, no hang; recording completes).
- [ ] RC5 Slow XHR replica (2.5s causal fetch): evidence includes its rows and its DOM
      consequence; not closed early.
- [ ] RC6 No-consequence page: settles ~350ms, empty app arrays, no console errors.
- [ ] RC7 All scenarios: zero console errors; Click and Navigation never merged;
      `#add-to-cart-button` target identity preserved in every case.

## 17. Acceptance Criteria (spec-level)

- [ ] Every criterion in §14, §15, §16 green.
- [ ] `npx tsc --noEmit` clean; full `vitest` suite green (after §14 migration).
- [ ] No fixed post-action wait constant introduced anywhere (grep: no new
      `setTimeout(<literal>, …)` in the finalize path).
- [ ] `sw-integration.ts` diff untouched by this change (guard preserved verbatim).
- [ ] E1-prep files untouched (zero diff).
- [ ] No product/URL/DOM special cases added.
- [ ] Existing caps/flags (200/50/50, coarseMode, domChangeOverflow) unchanged.

## 18. Risks / Documented Tradeoffs

- **Later evidence arrival** for slow-settling interactions (seconds vs ~160ms). Panel
  already renders late evidence; emergency 300s timeout unchanged.
- **endReason value changes** for lifecycle-finalized non-unloading windows
  (`lifecycle-complete` → `consequence-settled`) — visible in stored evidence; downstream
  consumers audited: renderer only special-cases `evidence-timeout` and
  `page-reload-synthetic`; understanding pipeline treats endReason as label only.
- **Perpetual sub-300ms causal storms** hold the window to the 10s cap — bounded, flagged.
- **Interaction cards appear without evidence for the settle duration** (card shows the
  "no evidence yet" placeholder until settle delivery) — existing live-update covers it.

## 19. Out of Scope

- Descendant scanning in `isSignificantSurface` (RCA secondary finding — separate spec).
- Any sw-integration.ts / supplement-merge changes (guard retained as-is).
- Surface/visibility overflow counters (silent 50-cap — pre-existing, noted separately).
- D2/D3, understanding pipeline, sidepanel rendering.
