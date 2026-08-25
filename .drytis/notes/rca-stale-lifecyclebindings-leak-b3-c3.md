# 7.4-B3 E2E C3 RCA — stale lifecycleBindings leak holds non-lifecycle windows open

**Status:** RESOLVED 2026-08-25 — fix shipped in the B3 working tree (fold path
sends FINALIZE_EVIDENCE for the suppressed lifecycle via
`sendFinalizeForSuppressedLifecycle`, unit-pinned S2-4b) and verified in real
Chrome (`b3-full-final3`: dismissal card hasEv=true flag=true, C3 PASS).
Follow-on defect found and fixed during verification: the S3 synthetic
eventId broke `extractPageId` ordering, breaking the S2 twin scan (reviewer
Critical #1) — synthetic ids now use the canonical `evt-{pageId}-{counter}`
shape with a 1e9-offset counter, and the sample's captureSeq positions at the
episode's last input (not the blur) to keep `pairPhysicalPress` adjacency
intact. Originally discovered during the B3 closure E2E (2026-08-25). Pre-existing
defect exposed (not introduced) by B3's S5 actionabilityEvidence flag + S1 STOP drain.

## Symptom
Real-Chrome census run: the popover dismissal click (plain `#popover-backdrop` div,
evt-59) opens an evidence window at 5782.8ms that NEVER self-closes — its stabilityTrace
shows 300ms-cadence re-scheduling for 1266ms until STOP force-closes it
(`endReason: 'recording-stopped'`). Its (rich: popover display:block→none + backdrop
style reset) evidence arrives at the SW AFTER `handleStopRecording`'s S1 drain →
`storePendingEvidence` → the dismissal card has `hasEvidence:false`,
`actionabilityEvidence:false` → harness C3 FAILs. Non-lifecycle windows normally close
on 300ms quiescence (evt-2 'stabilized' @783ms did).

## Root cause chain
1. Any lifecycle that completes WITHOUT emitting an interaction never triggers
   `sendFinalizeEvidence` (it fires only in `onEmit`).
2. Two such paths: **S2 dedup fold** (`completeComponent` → `isDuplicate` →
   `foldIntoPrior` → `return null`) and the pre-B3 suppress-and-release fallback.
3. The content-script `EvidenceCollector.lifecycleBindings` map is only cleaned in
   `finalizeForInteraction` (`this.lifecycleBindings.delete(payload.lifecycleId)`).
4. `openWindow` holds EVERY new window open when `lifecycleBindings.size > 0`
   (evidence-collector.ts:583: `if (this.lifecycleBindings.size > 0) { … setHoldOpen(true) }`).
5. A stale binding therefore keeps any LATER window with no lifecycle of its own
   (plain-div clicks, body clicks) held open until STOP force-close → late delivery.

## Evidence
- `b3-full-final/censusflow-storage.json`: evt-59 pendingEvidence window
  `endReason:'recording-stopped'`, openedAt 5782.8 / closedAt 7049.2, domChanges
  [popover style delta, backdrop style delta, output]; stabilityTrace 300ms re-arm cadence.
- With post-stop sleep extended 400→2000ms, evt-59 APPEARS in pendingEvidence
  (post-drain arrival) — proving delivery raced the STOP drain.
- Unit probes (tests/tap/dismissal-window-probe-b3.test.ts,
  tests/tap/lifecycle-claim-probe-b3.test.ts — temporary, may be removed): the collector
  is healthy when no stale binding exists; no definition claims the plain-div click;
  the leak requires a prior folded lifecycle (repeat-button 2nd click) whose binding
  was never deleted.

## Why B3 surfaced it
Pre-B3 the late evidence simply stranded invisibly (B2 dump's stranded evt-68).
B3's S1 drain runs at STOP; evidence arriving after STOP still misses. C3/S4-5/S5-5
spec pins ("dismissal card carries removal evidence + flag") are therefore NOT met
by implementation as-is.

## Fix candidates (owner decision)
- (a) `onDedupFold`/release paths in the SW should also send a FINALIZE-like message
  (or a LIFECYCLE_RELEASED) so the collector can delete the binding. Minimal, honest.
- (b) Collector-side: bind windows to the lifecycle by event membership at open, not
  the global `lifecycleBindings.size > 0` check (fixes the class, bigger change).
- (c) Accept as documented residual: flag stays false until evidence lands post-STOP
  (next STOP drains it via S1 since it sits in pendingEvidence). Spec S4-5/S5-5 pins
  would need re-wording — weakest option, contradicts approved spec.
