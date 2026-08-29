# Inter-step consequence sync — read-only architecture comparison (2026-08-20)

Predecessor: `inter-step-pacing-rca.md` (proposed 300ms-quiescence/1s-cap settle).
This document SUPERSEDES that recommendation after deeper investigation.

## New empirical root-cause refinement (decisive)

`/tmp/clone-dumps-post/replay-poll.jsonl` (final gate run) proves the replay failure
is NOT a late-element problem:

- Replay tab T2 (dedicated, created by executor): header `[data-count]` reached **"1"**
  → step 5's add-meal fetch DID resolve server-side + locally.
- Same tab `/cart` body: permanently **"Nothing here yet."** + total 0.
- Mechanism: replay step 6 navigates to /cart the instant EXECUTE_STEP(5) returns
  (~t+2ms). `renderCart()` runs `await api('/api/cart')` BEFORE the add-meal POST
  (dispatched ~t+0, resolves ~t+500ms) commits server-side. The cart renders empty
  and NEVER re-renders. Steps 7/8 then burn the 10s resolve cap on a target that
  can never appear.
- The recorder avoided this because its window stays open via `causalNetworkIdle()`
  (evidence-collector.ts:1555) — the in-flight add-meal POST blocks settling. The
  human clicked Cart only after the fetch resolved.

**Consequence:** the previously proposed 300ms-DOM-quiescence settle is empirically
INSUFFICIENT for this case: after the add-meal click the page is DOM-quiet
immediately (only `meal.disabled=true` mutation at t≈0; next mutation at fetch
resolution t≈500ms). A 300ms quiescence would release at t≈300ms and the race
persists. The RCA note's claim that the quiescence settle "would have fixed the
clone failure" was WRONG. Network causality is the missing signal.

## Recorder ground truth (what "consequence settled" already means)

- Window close = `elapsed >= minDuration(50ms)` AND quiescence timer (300ms,
  adaptive-window.ts:99) fired AND `causalNetworkIdle()` (network in-flight minus
  requestIdsAtOpen, noise-filtered, evidence-collector.ts:1555-1566) — hard cap 10s.
- SW-side attribution: OBSERVED_EVENT stamp → webRequest onBeforeRequest carries
  `sourceEventId` (network-observation.ts:948-1007); persisted in
  DurableAttributionLedger; attached as `applicationEvidence.networkActivity`
  (NetworkActivity.sourceEventId, behavioral-evidence-types.ts:412).
- webRequest listeners are registered TOP-LEVEL on every SW start
  (network-observation.ts:1166/1174) — but `shouldProcessRequest` drops capture when
  `recordingActiveFlag === false`, which is the state during RUN_TEST.
- IR steps carry `sourceEventId` (types.ts:195) but NO network attribution and NO
  timing (executionParameters = constant DEFAULT_EXECUTION_PARAMETERS).
- Executor content script: zero MutationObserver; only resolveWithWait
  (100ms poll / 10s cap). No settle/wait wire message exists.

## Option comparison

**A. Post-step DOM quiescence (300ms/1s) — prior proposal**
- REJECTED: empirically fails the clone (releases at first quiet 300ms < fetch
  500ms). Arbitrary cap; false holds on chatty pages; still timing-based.

**B. Next-step target readiness only (extend existing resolveWithWait)**
- REJECTED as primary: already proven insufficient — steps 7/8 waited 10s each;
  target never appears. Keep as backstop only.

**C. Recorded resultingState/assertion replay-wait (wait until recorded RS transitions reproduce)**
- REJECTED for now: needs capture pipeline in executor; RS equivalence brittle
  (unrelated items legitimately differ); couples execution to derivation gated by
  2b policy. Highest fidelity aspiration, highest complexity. Possible future
  refinement (wait on the step's OWN recorded window items, not derived assertions).

**D. SW-executor causal network drain (recommended)**
- After EXECUTE_STEP returns, SW executor polls tab-scoped in-flight requests
  (reusing top-level webRequest listeners + existing NOISE_URL_RE_CAUSAL filters)
  until in-flight-for-tab == 0, bounded by the step's existing timeoutMs (30s).
- Replay tab is executor-created and dedicated → tab-scoped ≈ causal-scoped
  (no foreign-user pollution; the recorder's stricter sourceEventId attribution
  exists because recording happens in a shared tab).
- No new arbitrary constants: reuses 100ms poll + timeoutMs budget. No OR-1
  impact (execution orchestration, same bucket as existing waitForPageLoad poll).
- Components: (1) network-observation.ts — execution-scoped capture gate +
  `getInFlightForTab(tabId)` export (~40 lines); (2) ir-executor-impl.ts — drain
  loop after step action, before EVALUATE_ASSERTIONS/next step (~30 lines);
  (3) optional content-script quiescence-confirm message — DEFER until validation
  shows network drain alone is insufficient (pure-client consequences are covered
  by the next-step 10s element backstop).
- Predicted clone outcome: step 5 drains (~500ms) → step 6 renders cart with MEAL
  row → steps 7/8 resolve instantly → 8/8 steps; qty assertions likely pass.
- Risks: long-poll/streaming tabs never drain (bounded by timeoutMs — same
  exposure the recorder already accepts at its 10s cap); requests invisible to
  webRequest fall through to element backstop (today's behavior).

## Recommendation

**Option D** — causal network drain in the SW executor, recorder-parity predicate
(causalNetworkIdle semantics) without new timing constants. Validation: clone gate
expecting steps 7/8 to flip to PASS (and the run to 8/8), a-slice 35/0 regression,
full suite, tsc baseline.
