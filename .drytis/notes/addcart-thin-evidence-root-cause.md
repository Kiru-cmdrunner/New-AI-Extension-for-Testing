# Add-to-cart thin evidence (int-23: DOM 1 / Net 14, no surfaces) — root cause

**Read-only finding, no code changed.** Phase-1 post-nav work is NOT the cause
(WIP diff to evidence-collector is +103/−1 with zero changes to the click/submit
paths; recorder-entry diff only reorders the nav pull after async startRecording).

## Confirmed mechanism (minimal vitest repro, since deleted)
`DOMObserver` accumulation is **collector-global** (Map keyed by targetPath),
and `EvidenceCollector.openWindow()` calls `domObserver.clearAccumulated()`
(evidence-collector.ts:396). `WINDOW_OPEN_EVENTS = {click, contextmenu, change,
keydown}` PLUS `'submit'` (:368) — the form **submit event opens its own window**.

Amazon add-to-cart timeline (product page):
1. t=0 click on `INPUT#add-to-cart-button` → click window opens, accumulation reset.
2. t≈5–35ms: JS widget churn (mini-cart, flyout, buybox) accumulates — the 200+
   domChanges / 6 new / 8 removed / 17 visibility of the GOOD run.
3. t≈40–80ms: native form **submit fires** → `openWindow('submit')` →
   `clearAccumulated()` **wipes everything the click window accumulated**.
4. t≈35ms: semantic lifecycle completes (Accordion-type click component);
   FINALIZE_EVIDENCE sent by SW (sw-integration.ts:248 sendFinalizeEvidence).
5. t≈185ms: finalize settle (150ms) drains `getAccumulatedSummaries()` — now
   holding ONLY post-submit mutations → evidence = the single teardown span
   (childList · span · +1/−1) + network (network is window-membership-based,
   CER-3, unaffected). Result: int-23 exactly as observed.

Repro numbers: 6 distinct-target summaries accumulated → submit-open → drain = 1,
endReason lifecycle-complete, durationMs ≈ 209ms. Exactly the observed shape.

## Why the earlier run showed 200+
Pure ordering race between (a) the click window's finalize drain at
trigger+150ms and (b) Amazon's submit event firing. When the lifecycle
completes LATE relative to the submit (or the submit event is delayed by
Amazon's add-to-cart AJAX-then-submit sequence), the drain happens BEFORE the
submit-open wipes — full churn captured. When submit fires EARLY (before
trigger+150ms), the wipe lands first — thin evidence. Same code, different
Amazon timing; both runs' endReason is `lifecycle-complete` (~185ms), so window
length is NOT the differentiator — the wipe ordering is.

## Evidence was NOT misattached
- int-25 (Navigation, lifecycle-complete, 154ms): the navigation definition
  (src/definitions/navigation.ts) completes IMMEDIATELY on trigger, so the SW's
  FINALIZE_EVIDENCE for the nav interaction reaches the destination page and
  finalizes our post-nav window through the SAME 150ms settle path — that's why
  it shows `lifecycle-complete` rather than `stabilized` and only ~154ms of
  destination churn. This is a second, milder instance of the same timing
  coupling: the nav lifecycle finalizes far earlier than the 3s post-nav
  settling design intended. On the cart page most churn lands after 154ms, so
  int-25 stays thin too.
- The destination churn is NOT attached to int-23 — different document.
- Network on int-23 is complete (14 rows) because network join is
  membership-based (requestIds), independent of the DOM accumulation wipe.

## Candidate fixes (NOT implemented — needs design decision)
1. Scope accumulation per-window instead of collector-global (larger refactor;
   fixes the class of bug, touches M4 core).
2. Make `openWindow` for a LATER event on the same causal chain NOT clear the
   accumulation (e.g. only clear at window-open when NO other window is open:
   `if (this.activeWindows.filter(w=>!w.isClosed).length === 0) clearAccumulated()`).
   Smallest change; restores earlier behavior in spirit (clear only when no
   overlapping window would be robbed).
3. Snapshot the accumulated summaries at finalize-schedule time rather than
   drain-at-150ms (finalizeForInteraction could drain immediately into the
   payload and freeze it).
4. For the nav interaction specifically: exempt post-nav windows from
   FINALIZE_EVIDENCE matching (skip windows with isNavigationWindow && opened
   via post-nav path), letting them settle to their own hard cap.

Fix 2 + 4 are the minimal targeted pair; fix 3 is the most robust for the click.
