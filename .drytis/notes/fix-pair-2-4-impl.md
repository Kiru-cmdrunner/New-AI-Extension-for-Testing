# Fix Pair 2 + 4 — implementation record

Spec: `.drytis/specs/fix-pair-2-4-window-accumulation-postnav-finalize.md`
Baseline: 5e778b9 + uncommitted Phase-1 WIP (post-nav capture). Nothing
committed for either Phase 1 or Fix 2+4 yet.

## Changes (this milestone)

Single source file touched: `src/tap/evidence-collector.ts` (+~90/−3 on top of
Phase-1 WIP):

1. **Fix 2 (INV-C1)** — `openWindow` clears the shared DOM/surface/visibility
   accumulation only when no other live window exists
   (`const otherLiveWindows = activeWindows.some(w => !w.isClosed)`).
   `closeWindow` tail and `cleanupWindow` route through the new shared
   `clearAccumulatedIfBoundary(closedWindowId)` helper with the same rule.
   True-boundary behavior preserved: first/only window open still resets.
2. **Fix 4 (INV-C2)** — `ObservationWindowState.isPostNavWindow` field;
   `openPostNavWindow` sets it; `finalizeForInteraction` early-returns when
   the matching window is post-nav (no finalizeWindow, no
   `finalizeWithoutWindow` fallback, no companion suppression);
   `handleLifecycleBound` skips hold-open for post-nav windows.

## Regression tests

`tests/tap/window-accumulation-and-postnav-finalize.test.ts` (409 lines, 8 tests):
- T1 int-23 repro: click churn (5 targets) survives submit-window open;
  finalize drains ≥5 summaries.
- T2 surfaces (`role=listbox`) + visibility (aria-hidden flip) survive submit open.
- T3 true-boundary preserved (window B does not inherit window A's churn;
  both buttons pre-created so B makes no mutations of its own).
- T4 submit window's own evidence still delivers (finalize path, ≥2 domChanges).
- T5 nav FINALIZE does not close post-nav window; settles via own
  stabilization ≥1000ms, exactly-once delivery.
- T6 continuous churn → own 3s hard cap (`max-duration`, durationMs ≥2900
  — relaxed from 3000 for timer jitter).
- T7 generic finalize for a normal click unchanged (`lifecycle-complete` <400ms).
- T8 `handleLifecycleBound` does not hold post-nav window open (closes at own
  stabilization ~300ms).

Gotchas discovered: jsdom MutationObserver callbacks need a microtask flush;
DOMObserver accumulation is keyed by target path (reusing the same element id
collapses entries); elements appended after window B opens are legitimately
attributed to B (T3 must pre-create buttons).

## Verification (all green)

- New suite: 8/8. Phase-1 suites: 20/20. INV-5/ledger suites: 27/27.
- Full suite: **161 files / 3,208 tests** (baseline 3,200 + 8).
- `tsc --noEmit`: 0 errors.
- Clean build: exit 0. ZIP **226,699 B (221.4 KB), 26 entries, CRC OK**,
  md5 `bc9bfd2d41c666843e244fb54791f03f`,
  sha256 `4786aa7a…877283`. SW inline 516,287 B, 0 `import(`, 0 `__vitePreload`,
  NAV_PENDING_REQUEST present, 0 stale chunks; `isPostNavWindow` lives in the
  recorder-entry CS chunk (55,415 B). Download copy byte-identical, HTTP 200.
- Real-Chrome E2E (Chrome-for-Testing 148, CDP, `/tmp/navtest2/ext` = exact
  ZIP artifact, fixtures product.html→cart.html):
  - **Fix 2**: click int-2 domChanges=5, newSurfaces=1, visibility=1, network=1
    across a submit-window open. Overlap proven via pending-evidence dump:
    the submit event's own evidence (`evt-…-6`, `sourceEventType:'submit'`,
    window 7042.5→7057.8 `page-reload`) **contains the click's churn**
    (flyout dialog surface, aria-hidden flip, 5 widget summaries) — the
    submit window opened INSIDE the click window (6376.8→7043.1). Submit's
    own evidence works (delivered as pending evidence with correct form identity).
  - **Fix 4**: nav int-3 `ev-nav-*` endReason=**stabilized** duration **1955ms**
    (was lifecycle-complete @154ms pre-fix), domChanges=2, newSurfaces=1,
    navEntry form_submit, exactly-once (single delivery).
  - INV-5: network attributed to the click (requestId join, membership-based)
    — no stamped-row leakage; ledger clean; 0 SW console errors.
  - Downstream understanding consumed the post-nav evidence: transition
    int-3 `view → cart` (url-pattern, conf 0.9), notification "1 item added"
    (success), collection `body > div#cart-items` +3 items.
- Page-side probe caveat: a `document`-level submit listener injected via CDP
  Runtime.evaluate in the MAIN world reads `submitCount=0` at +500ms even in
  successful runs — the probe context is destroyed by the navigation before
  its read completes (bare-Chrome control run navigates <100ms). The recorder
  taps submit via capture listener on `document` in the ISOLATED world and
  the submit event's evidence IS in the storage dump — use the
  pending-evidence dump as the source of truth for submit timing, not a
  MAIN-world probe.
- Harnesses preserved: `.drytis/zz-fix24-e2e.mjs` (product/cart E2E),
  `.drytis/zz-bare-submit.mjs` (probe isolation control).

## Working tree state

4 modified tracked files (service-worker.ts, recorder-entry.ts, types.ts —
all Phase-1 only; evidence-collector.ts — Phase-1 + Fix 2+4). Fix 2+4 delta
is confined to evidence-collector.ts + the new test file + the spec.
Not committed, not pushed (per instruction).
