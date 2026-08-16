# Fix Pair 2+4: Preserve click-window accumulation across `submit` window opens; exempt post-nav windows from generic FINALIZE_EVIDENCE

**Status: SPEC — awaiting approval. No code changed yet.**
Companion root-cause note: `.drytis/notes/addcart-thin-evidence-root-cause.md`
Baseline: commit `5e778b9` + approved Phase-1 post-nav WIP (uncommitted).

---

## 1. Exact current lifecycle/window sequence

### 1a. Amazon add-to-cart click (the int-23 regression)

```
t=0        INPUT#add-to-cart-button click
           └─ onAfterEvent('click') → openWindow(click)
              ├─ enforceMaxConcurrent()
              ├─ domObserver.start() (refcount 0→1)
              ├─ domObserverRefcount++            (→1)
              ├─ domObserver.clearAccumulated()   ← accumulation EMPTY here (correct:
              │                                     window boundary starts now)
              └─ AdaptiveWindow.arm() (no lifecycle binding yet → 300ms quiescence
                 + 10s hard cap; every new binding may later setHoldOpen)

t≈5–35ms   Amazon JS widget churn (mini-cart/flyout/buybox)
           └─ MutationObserver → accumulated Map (+surfaces +visibility)

t≈35ms     SW: component runtime completes the Click lifecycle
           └─ sendFinalizeEvidence → tabs.sendMessage(FINALIZE_EVIDENCE)
              (eventIds=[clickEventId], endState='completed')

t≈40–80ms  page form fires native 'submit'            ← THE RACE
           └─ onAfterEvent('submit') → openWindow(submit)
              ├─ domObserver.start(cb) (refcount 1→2)
              └─ domObserver.clearAccumulated()       ← **WIPES the click
                                                        window's accumulated
                                                        churn** (bug)

t≈185ms    CS: finalizeForInteraction(click payload)
           └─ finalizeWindow(150ms settle) → executeFinalization
              └─ closeWindow → getAccumulatedSummaries() drains the GLOBAL
                 accumulation → only post-submit mutations remain
           → int-23 evidence = 1 span change + 14 network rows
             (network unaffected: CER-3 join is requestId-membership based,
              not accumulation based)

pagehide   INV-4: submit window (action type) finalizes with 'page-reload'
```

### 1b. Full-reload navigation (the int-25 coupling)

```
destination page, t=0
  recorder-entry auto-resume → pullPendingNavCapture()
  └─ openPostNavWindow(record)
     └─ openWindow(navEventId,'navigation', maxDuration=3000ms)
        ├─ clearAccumulated()            (fine — nothing precedes it here)
        └─ post-nav flags: isNavigationWindow=true,
           isLifecycleBound=false, setHoldOpen(false)
           → AdaptiveWindow.arm() schedules the 3000ms hard cap
              INTENDED settle: 'stabilized' (300ms quiescence) or
              'max-duration' (3s cap)

t≈few ms   SW: navigation definition completes IMMEDIATELY
           (src/definitions/navigation.ts handleEvent → {endState:'completed'})
           └─ sendFinalizeEvidence(eventIds=[navEventId])
              → CS: finalizeForInteraction matches the post-nav window
                 BY SOURCEEVENTID (navEventId == triggerEvent.eventId)
              → finalizeWindow(150ms settle)
              → endReason 'lifecycle-complete' @ ~154ms   ← observed int-25
                 (cuts the designed 3s settling window to 150ms)
```

Two distinct defects, one shared shape: **generic mechanisms (window-open
clear, generic finalize matching) run against a window they were not designed
to interact with.**

---

## 2. Proposed state/invariant changes

### Fix 2 — clearAccumulated only when no other window is open

**Current invariant (implicit):** every `openWindow()` resets the shared
accumulation, regardless of other open windows.

**New invariant INV-C1:** *The shared DOM/surface/visibility accumulation is
cleared only at a true accumulation boundary — when the window being opened is
the first live window (no other non-closed window exists). While ≥1 window is
open, a new window's open must NOT destroy mutations that may belong to the
open window(s).*

Precisely, in `openWindow()`:

```ts
// before (line ~396):
this.domObserver.clearAccumulated();

// after:
const otherOpen = this.activeWindows.some((w) => !w.isClosed);
if (!otherOpen) {
  // First live window: true accumulation boundary — safe to reset.
  this.domObserver.clearAccumulated();
}
// else: an earlier window (e.g. the add-to-cart click, awaiting its 150ms
// lifecycle settle) may still own accumulated churn. Its drain at finalize
// must not be robbed by this later window's open (int-23 regression).
```

Consequences (deliberate, reviewed):
- When windows overlap, the later window's evidence will also include
  mutations accumulated before its open. This is ALREADY true today for the
  opposite direction (the click window's finalize drains post-submit
  mutations it never "owned"). The accumulation is shared state by design
  (M4); Fix 2 makes the sharing symmetric and non-destructive instead of
  last-writer-wins.
- `cleanupWindow()`'s `clearAccumulated()` (line ~1622) gets the same guard:
  while any other window remains open, closing one window must not wipe the
  accumulation its sibling will drain at its own finalize. When the LAST
  window closes, the clear runs and the boundary is clean for the next
  window.
  - Note: `closeWindow()`'s inline clear at line ~827 is the same site as
    cleanupWindow's (closeWindow's tail inlines the cleanup steps); the guard
    covers both through one shared helper.
- Surfaces/visibility (`surfaceChanges`, `visibilityChanges` arrays in
  DOMObserver) are cleared by the same `clearAccumulated()` call and are
  therefore covered identically.
- Network attribution is untouched: the window↔network join uses
  `requestIdsAtOpen` snapshots (CER-3), never the DOM accumulation.
- The `enforceMaxConcurrent` displacement path force-closes the oldest window
  via `adaptiveWindow.close('displaced')` → `closeWindow` → (guarded) clear.
  With ≤5 concurrent windows (the Amazon click+submit case is 2) this path
  does not fire; the guard makes it non-destructive when it does.

### Fix 4 — post-nav windows are exempt from generic FINALIZE_EVIDENCE matching

**Current invariant (implicit):** `finalizeForInteraction` matches ANY
non-closed window whose `sourceEventId` ∈ `payload.eventIds`.

**New invariant INV-C2:** *A post-navigation window's lifecycle is the
navigation itself (already committed at open). It is finalized ONLY by its own
AdaptiveWindow (stabilization timer / 3s hard cap) or by pagehide/stop —
never by the generic FINALIZE_EVIDENCE path, and never by the
finalizeWithoutWindow fallback.*

Implementation:
1. Add a window marker `isPostNavWindow: boolean` to `ObservationWindowState`
   (default `false`), set `true` in `openPostNavWindow` right where
   `isNavigationWindow` is set today.
2. In `finalizeForInteraction`, partition matches:
   ```ts
   const matchingWindows = this.activeWindows.filter(
     (w) => !w.isClosed
       && !w.isPostNavWindow                                   // ← INV-C2
       && payload.eventIds.includes(w.sourceEventId),
   );
   ```
   - If ≥1 non-post-nav match → current behavior unchanged
     (finalize first, silently close the rest).
   - If ZERO matches remain because the only would-be matches were post-nav
     windows → **return early after clearing the lifecycle binding**; do NOT
     fall into `finalizeWithoutWindow` (which would synthesize a 0-richness
     `lc-<navEventId>` evidence — harmless today because the SW richness
     replace (score 0 < placeholder score 3) keeps it out, but pointless
     noise and a latent replace hazard if the placeholder were ever
     lower-scored). The post-nav window continues settling to its own cap.
3. `handleLifecycleBound` must not bind post-nav windows either (today the
   retroactive `find(w => w.sourceEventId === triggerEventId)` could hit the
   post-nav window for a nav-triggered lifecycle and setHoldOpen(true),
   disabling the 3s hard cap — the exact thing Phase-1 AC2 forbids):
   add `&& !w.isPostNavWindow` to that find.
4. Exactly-once attachment (SW side) is unchanged: the post-nav window's
   delivered evidence still carries `sourceEventId = navEventId` =
   the Navigation interaction's `triggerEvent.eventId`, so
   `attachEvidenceToInteraction` Tier-1 attaches it once; the
   richness-replace path replaces the synthetic placeholder only when the
   post-nav evidence is strictly richer; `mergeNetworkActivity` keeps network
   rows requestId-deduped. The `postNavOpenedFor` Set already guarantees
   exactly one window per navEventId per document.
5. `finalizeAtPagehide` / `onPageHide` are NOT changed: a post-nav window
   still open at pagehide finalizes with 'page-reload' (correct — the
   document is going away; INV-4 semantics preserved).

---

## 3. Exact files/functions that will change

| File | Function | Change |
|---|---|---|
| `src/tap/evidence-collector.ts` | `openWindow()` (~:396) | Guard `clearAccumulated()` with "no other live window" (Fix 2) |
| `src/tap/evidence-collector.ts` | `closeWindow()` tail (~:827) & `cleanupWindow()` (~:1622) | Same guard on the close-time clear (Fix 2) |
| `src/tap/evidence-collector.ts` | `ObservationWindowState` (~:171) | Add `isPostNavWindow: boolean` field (Fix 4) |
| `src/tap/evidence-collector.ts` | `openPostNavWindow()` (~:524) | Set `isPostNavWindow = true` next to `isNavigationWindow = true` (Fix 4) |
| `src/tap/evidence-collector.ts` | `finalizeForInteraction()` (~:1219) | Exclude `isPostNavWindow` windows from matching; early-return (no fallback) when only post-nav windows matched (Fix 4) |
| `src/tap/evidence-collector.ts` | `handleLifecycleBound()` (~:1185) | Exclude post-nav windows from retroactive hold-open binding (Fix 4) |

**No other files change.** In particular NOT changed:
`src/runtime/sw-integration.ts` (attach/richness/merge — untouched),
`src/background/service-worker.ts`, `src/recorder/phase5/recorder-entry.ts`,
`src/background/post-nav-capture.ts`, `src/tap/dom-observer.ts` (its API is
used as-is), `src/tap/adaptive-window.ts`,
`src/understanding/signal-extractors/network-signals.ts` (ASIN),
`src/background/evidence-attribution.ts` (G4/G5 ledger),
`network-drain.ts` / `network-observation.ts` (M9).

---

## 4. Regression tests

New file `tests/tap/window-accumulation-and-postnav-finalize.test.ts`
(jsdom, same harness/mocks as `tests/tap/evidence-collector.test.ts` and
`tests/tap/post-nav-window.test.ts`):

**Fix 2 — click → submit churn preservation**
1. `it('click churn survives a later submit window open (int-23 repro)')`
   click on submit-button → 5 distinct-target widget mutations → flush →
   `openWindow('submit')` → 1 late span mutation → flush →
   `finalizeForInteraction(click)` + settle → click evidence
   `domChanges.length` ≥ 5 targets' summaries (assert ≥ 5, endReason
   `lifecycle-complete`). This is the exact repro from the investigation
   (which currently drains 1) — asserted green only after Fix 2.
2. `it('click evidence intact when submit opens another window (surfaces & visibility)')`
   same shape + surface/visibility mutations (append surface-like nodes,
   class-visibility flips) → assert `newSurfaces` / `visibilityChanges`
   non-empty on the CLICK evidence, not only on the submit window's.
3. `it('first-window open still resets accumulation (boundary preserved)')`
   window A opens → mutations → A closes (drains) → window B opens →
   B's evidence must NOT contain A's mutations (guard must not leak old
   churn across a true boundary). Guards against over-correcting.
4. `it('existing submit interaction still delivers its own evidence')`
   submit event window → churn after submit → 300ms quiescence → submit
   evidence delivered with `endReason 'stabilized'`, its own domChanges ≥ 1,
   correct `sourceEventId` (submit eventId). Verifies submit-window behavior
   itself is unchanged.

**Fix 4 — post-nav window not prematurely finalized**
5. `it('FINALIZE_EVIDENCE for navEventId does not close the post-nav window')`
   `openPostNavWindow(record)` → immediately
   `finalizeForInteraction({eventIds:[record.navEventId], endState:'completed'})`
   → advance past 3s hard cap → post-nav evidence delivered with
   `endReason 'max-duration'` (or 'stabilized' after quiescence), duration ≥
   settle, and windowId `ev-<navEventId>`; assert NO evidence with
   `windowId 'lc-<navEventId>'` was ever delivered (no fallback synth).
6. `it('post-nav window under churn settles via its own stabilization')`
   openPostNavWindow → continuous churn every 100ms → assert window still
   open at t=1s (getActiveWindowCount===1), closes by 3s cap with
   'max-duration', domChanges > 0.
7. `it('FINALIZE_EVIDENCE for a normal click still finalizes the click window (no regression)')`
   click window open → finalize payload for the click → evidence delivered
   'lifecycle-complete' @ ~150ms settle (unchanged current behavior).

**Cross-cutting (integration, extend `tests/integration/post-nav-attribution.test.ts`):**
8. `it('navigation evidence attaches exactly once; placeholder replaced by rich post-nav evidence')`
   drive `initRecording` + `processObservedEvent(navEvent)` (immediate
   completion → FINALIZE path exercised at CS level via collector), then
   `attachEvidenceToInteraction(placeholder)` followed by
   `attachEvidenceToInteraction(richPostNav)` → final evidence is the rich
   one, network rows merged requestId-deduped, exactly one attach
   (`interaction.behavioralEvidence` replaced, not duplicated).
9. `it('add-to-cart network attribution unchanged (INV-5/G4/G5)')`
   existing integration tests
   (`tests/integration/post-nav-attribution.test.ts` INV-5 cases +
   ledger tests in `tests/unit/background/evidence-attribution*.test.ts`)
   re-run green — no code in those paths changes; this is a suite-level gate,
   not a new test.

**Full-reload E2E re-verification (manual, same harness as Phase 1):**
10. `/workspace/.drytis/zz-run1.mjs` (Chrome-for-Testing + unzipped release
    ZIP) → VERDICT PASS with the SAME shape as the audited build:
    Navigation `windowId=ev-nav-*`, real navEntry, domChanges ≥ 1. Fix 4
    changes the endReason from `lifecycle-complete` (~154ms) to
    `stabilized`/`max-duration` (≥300ms) — that is the intended improvement,
    assertion updated accordingly.
11. Full suite `npx vitest run` (160 files / 3,200+ tests) green; `tsc
    --noEmit` 0 errors; clean build + SW invariants (0 `import(`, 0
    `__vitePreload`, no stale chunks) + ZIP hash reported.

---

## 5. Explicitly out of scope

- **Per-window accumulation scoping** (option 1 from the note) — the shared
  accumulation stays shared; Fix 2 only makes clears non-destructive while
  windows overlap. Overlapping windows may share mutation summaries
  symmetrically (documented consequence).
- **Drain-time freeze at finalize-schedule time** (option 3) — not needed for
  the approved pair; the wipe was the destructive step, now guarded.
- **Any change to network attribution**: CER-3 joins, INV-5 stamped-request
  routing to causal owners, `mergeNetworkActivity`, G5 requestId dedup,
  M9 status enrichment (`enrichNetworkRowStatuses`), ledger semantics.
- **ASIN / entity hints** (`ENTITY_HINT_PATTERNS`, `extractEntityHints`).
- **Phase-1 NAV capture itself**: `post-nav-capture.ts` store, SW pre-await
  write, `NAV_PENDING_REQUEST` router, recorder-entry pull timing, TTL,
  consume-on-pull, exactly-once `postNavOpenedFor` guard, placeholder
  fallback semantics. Fix 4 only changes which finalization paths may close
  the window AFTER it opens.
- **`finalizeAtPagehide` / INV-4 pagehide semantics** (post-nav windows at
  pagehide still finalize 'page-reload').
- **GAP-4 SPA navigation path** (`handleNavigationEvent`, `emitSpaNavigation`)
  — SPA windows are NOT post-nav windows; their finalize matching is
  unchanged.
- **Autocomplete/suggestion surface classification** (surface-detector gap,
  separately deferred) and **per-window performance counters**.
- **Timing constants** (150ms finalize settle, 300ms quiescence, 3s post-nav
  cap, 10s default cap, MAX_CONCURRENT_WINDOWS=5).
- **Committer behavior for `lifecycleBindings` beyond the post-nav exclusion**
  in `handleLifecycleBound`.

## Risks

- **Shared accumulation across overlapping windows** (Fix 2's deliberate
  trade): a later window's evidence can include earlier-window mutations.
  Impact is bounded: richness scoring + Tier-1 exact-id attach already make
  the causal window's evidence win; network never used the accumulation.
  The alternative (full per-window scoping) was explicitly deferred.
- **Post-nav window now lives up to 3s** where it previously closed at ~154ms:
  the SW's evidence timeout for the Navigation interaction (evidence-timeout
  fallback) must not fire before the post-nav evidence lands — the Phase-1
  integration tests cover the placeholder-then-replace ordering; test 8
  re-verifies.
- **early-return skips finalizeWithoutWindow for nav-event finalizes**: no
  consumer of that fallback exists for navigation interactions (metadata is
  pageUrl/pageTitle only → afterValue null → 0-richness evidence that was
  always discarded by the richness rule).
