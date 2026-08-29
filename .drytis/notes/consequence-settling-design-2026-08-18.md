# Architecture investigation: consequence-settling (no fixed timeouts)

**Read-only. No code modified.** Responds to handover v2 (2026-08-18 13:14):
replace timing-based evidence windows (150ms finalize settle, G3 +1000ms
re-collect, proposed +1000ms app tail) with activity-quiescence settling.

## Core finding
The codebase ALREADY contains the correct settling model — `AdaptiveWindow`
(evidence-collector.ts:486-490 wires every DOMObserver batch →
`recordMutation()` → re-arms a 300ms quiescence timer; closes at quiescence
with `'stabilized'`; 10s hard cap). The post-nav window already runs this model
(`openPostNavWindow` :515-555 — holdOpen forced OFF, 3s cap).

The ONLY thing that turns the model off for user-action windows is
`setHoldOpen(true)` when lifecycle bindings exist (:475-478, :1225-1228):
`checkStabilized()` then re-arms forever (:244-249) and the window is instead
closed by FINALIZE_EVIDENCE + fixed 150ms settle (:1279-1328). The Amazon
dialog miss is this substitution: quiescence model disabled, timing artifact
substituted, observer disconnected at ~160ms.

## Settle predicate (the proposal)
At FINALIZE_EVIDENCE: `setHoldOpen(false)` + close condition =
`DOM quiescent ≥300ms (existing constant) AND causalInFlight == 0`
where causalInFlight = in-flight requests ∩ requestIdsStartedDuring(
requestIdsAtOpen, now) (NetworkBridge CER-3 membership — no wall-clock
correlation). Navigation-completion → its mutations re-arm quiescence →
dialog captured in the SAME window, ONE evidence delivery, no supplement,
no merge/replace risk. Network completion and DOM changes are correlated by
ORDERING (in-flight blocks settle; completion's mutations re-arm), not timing.

## Boundedness / polling
- Poll every 1s: each completion batch re-arms 300ms → window closes ~300ms
  after last poll batch. Bounded by one poll cycle, never indefinite.
- Only sub-300ms perpetual storms never quiesce → existing hard cap closes
  ('max-duration' + coarseMode already flagged). Cap is backstop, not model.
- NEEDS DETAIL: holdOpen windows never armed maxDurationTimer (arm() skips
  when holdOpen, adaptive-window.ts:112); setHoldOpen(false) at finalize must
  (re)schedule the cap — else settle mode has NO bound.
- Pre-click background requests excluded by membership set-difference;
  recurring polls bounded as above; telemetry filtered SW-side (network-drain
  noise regexes exist).

## endReason
New union member 'consequence-settled' (collector stamps it when window
closes in finalize-pending state). Renderer safe: only special-cases
'evidence-timeout' and 'page-reload-synthetic' (evidence-renderer.ts:642-669).

## Scenario matrix
- AJAX/modal: in-flight blocks → mutations re-arm → settle captures dialog. ✅
- Delayed UI (async chain): each hop re-arms; 300ms-gap-with-no-signal =
  honest residual limit (undetectable without waiting forever). Existing
  constant, not a new knob.
- Normal navigation: pagehide INV-4 path unchanged (:1715-1739); post-nav
  window separate; Navigation = separate interaction (unchanged ownership).
- Continuous polling: bounded (above).
- Slow network (>cap): hard cap closes with partial; G3 supplement delivers
  late rows — merged by the RETAINED shape guard.
- No consequence: settle ~350ms, empty arrays, correct.
- Multiple mutations: accumulation coalesces by targetPath; caps 200/50/50 +
  coarseMode/overflow unchanged.
- Long-running ops: mutations re-arm until 10s cap; partial + flagged.

## Smallest safe implementation (awaiting approval)
1. AdaptiveWindow: optional `canClose?: () => boolean` consulted in
   checkStabilized after quiescence (re-schedule if false) — no new timers.
   setHoldOpen(false) re-arms maxDurationTimer if absent.
2. NetworkBridge: additive `getInFlightRequestIds(): Set<string>`.
3. finalizeWindow: replace setTimeout(150) with settle-mode transition
   (setHoldOpen(false) + canClose = causal-network-idle predicate); stamp
   'consequence-settled'. isUnloading → keep immediate path (Vivo shape).
4. Keep G3 supplement + RETAIN uncommitted sw-integration shape guard
   (independent real bug, verified 13/13 + real Chrome; protects against any
   targetless producer incl. G3 at the settle boundary).
5. Tests: unit (fake timers: predicate, cap re-arm, endReason), integration
   (dialog RCA harness scenarios A/B/C + polling replica + slow-XHR replica).

## Tradeoffs to surface
- Evidence arrives seconds later than today (panel live-update already
  supports late evidence: INTERACTION_EVIDENCE_UPDATE path).
- Overlapping windows more common on rapid actions — already supported
  (Fix Pair 2 INV-C1 shared accumulation; MAX_CONCURRENT 5 displacement).
