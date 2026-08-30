# HEC v1 — Zip Audit M4c Postmortem (2026-08-30, read-only)

## Finding
The packaged-ZIP audit's M4c check (churn ON + real `#services` reveal, then immediate STOP) fails deterministically: the genuinely-earned evidenced Hover is DROPPED. Same scenario with 6s of post-churn quiet before STOP: PASSES (`q:"evidenced", dom:5` attaches, card admitted). The 20-row matrix (dev-tree timings) passes 20/20 — its timings never hit the window.

## Root cause (proven, not theorized)
Race between the leave-triggered Hover lifecycle completion and the settle-mode evidence window, under churn:

1. mouseenter opens a provisional hover window (holdOpen=true, 10s cap).
2. mouseleave → Hover def completes `left` → lifecycle POPPED from `activeStack` → card EMITTED at leave — without behavioralEvidence (the evidence window is still parked).
3. FINALIZE_EVIDENCE → `enterSettleMode` → `settleEntryFromNow` releases holdOpen with a FRESH full 10s cap; close gated on `causalNetworkIdle` + 300ms quiescence (`recordMutation` re-schedules).
4. Carousel churn tick (every 400ms) → `recordMutation` keeps resetting the quiescence timer → settle close deferred.
5. User presses STOP. `drainHoverEvidenceBeforeStop` (service-worker.ts:465) gates on `hasLiveHoverLifecycle()` = `getRuntimeLiveLifecycles().some(type==='Hover')` — but the lifecycle was POPPED at leave → gate false → drain SKIPPED, no STOP_EVIDENCE_DRAIN sent.
6. `stopRecording()` flush: Hover completes `completesAtRecordingEnd` (already completed — emitted card stays in liveInteractions).
7. STOP_RECORDING broadcast → content-script `stopRecording` → `evidenceCollector.stop()` → `closeWindow('recording-stopped')` → evidence DELIVERED but late (after admission).
8. `filterProductionInteractions` (D2, correctly) drops the unevidenced Hover card. The evidenced qualification is computed and thrown away.

## Why this is architectural (not a test artifact)
- The spec (§5b R-I6, §6) says STOP projects the RECORDED verdict; here the verdict exists (would compute `evidenced` — proven by the 6s variant) but never reaches the recorded record before admission because the delivery side (settle-mode window under churn) is blocked and the STOP drain's liveness gate excludes exactly the leave-completed case.
- Churn does not corrupt the verdict (M4a: churn alone never earns — correct); it BLOCKS delivery of an already-earned verdict. The asymmetry: click windows (FINALIZE_EVIDENCE → 150ms settleDelay → enterSettleMode) share the settle machinery, but their lifecycles stay LIVE until flush, so `hasLiveHoverLifecycle` analog would fire for a click; the Hover's early pop is Hover-specific.
- B7-P2's S5 case was the NO-LEAVE hover (still on activeStack at STOP → drain fires). The LEAVE+CHURN+QUICK-STOP case is a gap B7-P2 did not cover.

## Fix status (2026-08-30 05:56 — implemented, validated, NOT published)
`drainHoverEvidenceBeforeStop` no longer gates on `hasLiveHoverLifecycle()` — the STOP_EVIDENCE_DRAIN round-trip is sent unconditionally (delivery mechanics only). Leave-completed hovers' parked settle windows now force-close before the stop pipeline; the verdict was already frozen at capture time, STOP just transports it. `hasLiveHoverLifecycle` retained (live-stack query) with an M4c amendment comment. Pin: `tests/background/m4c-stop-drain-liveness.test.ts`. Real-Chrome regression: `.drytis/hec-m4c-regression.mjs` (5/5); ZIP audit 12/12 (incl. M4c); matrix 20/20; suite 5258/5258. Cost: non-hover sessions pay one no-op drain round-trip at STOP (tabs.query + one ignored message per tab).

## Repro
- `.drytis/hec-m4c-bisect.mjs "<preds>" <delayMs>` — delayMs=0 FAILS, delayMs=6000 EARNS, with zero predecessors.
- `.drytis/hec-m4c-instrumented.mjs` — full page-buffer/SW-console/ledger instrumentation.
- Archives: `.drytis/notes/evidence/hover-evidence-contract-v1/zip-audit-*.json` (3 failing runs) + `matrix-run-2026-08-30T05-45-36-679Z.json` (20/20, dev timings).
