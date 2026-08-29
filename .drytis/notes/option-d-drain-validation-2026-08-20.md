# Option D — executor inter-step causal network drain: implementation & validation record (2026-08-20)

Spec: `.drytis/specs/executor-network-drain.md` · Predecessor analysis: `consequence-sync-architecture-options-2026-08-20.md`
Status: implemented + fully validated; NOT committed (awaiting user approval). Uncommitted on top of 36b8829.

## Files changed (exact)

- `src/shared/network-noise.ts` — NEW (28 lines): NOISE_URL_RE_CAUSAL + TELEMETRY_URL_RE_CAUSAL + isCausalNoiseUrl(); single source shared by recorder causal-idle and executor drain.
- `src/tap/network-bridge.ts` — regexes moved to shared import (behavior identical).
- `src/background/network-observation.ts` (+201): ExecutionNetworkDrain interface + createExecutionDrain() (session singleton, per-tab inFlightByTab, disposed-state machine) + drainNoteRequestStart/Finish hooks called at the TOP of onBeforeRequestCallback / onCompletedCallback / onErrorCallback — BEFORE shouldProcessRequest (critical: RUN_TEST runs with recording stopped; the recorder gate would drop everything). Classification: resourceKind xmlhttprequest|fetch, or frameId===0 excluding main_frame/websocket/ping/csp_report; URL must fail isCausalNoiseUrl; tab must be session-registered. drainForTab: two consecutive zero samples at 100ms cadence (mirrors RESOLVE_WAIT_POLL_MS), bounded by the caller's timeoutMs; 0 → immediate; never throws (timeout → timedOut:true). getExecutionDrainInFlightForTab for diagnostics.
- `src/execution/ir-executor-impl.ts` (+43): optional networkDrain dep (type-only import — no module-graph change; tests inject stubs); beginTab after createTab; drain after PASSED action before EVALUATE_ASSERTIONS; drain in navigate branch after waitForPageLoad+re-inject before assertions; endTab after closeTab. Bound = step.executionParameters.timeoutMs ?? 0.
- `src/background/service-worker.ts` (+33/-?): handleRunTest creates session via createExecutionDrain(), passes to IRExecutorImpl, .finally(dispose).
- `tests/background/execution-network-drain.test.ts` — NEW: 17 tests (14 drain + 3 executor-wiring). Covers start/finish, concurrent, noise URLs, non-causal kinds, other-tab, zero-request ~2 samples, timeout-at-bound no-throw, long-poll bounded, late-start race caught by 2-sample rule, timeoutMs 0, onErrorOccurred clears, dispose/endTab scoping, recording-stopped capture (pre-gate hook proof), session replacement, call-order wiring (drain between EXECUTE_STEP and EVALUATE_ASSERTIONS; begin/endTab around run; no drain on failed action; navigate branch).

## Validation (all green)

- tsc --noEmit: 6 errors = exact pre-existing baseline (0 net-new).
- vitest: 217 files / 3961 tests passed (was 216/3944; +1 file +17 tests).
- npm run build: exit 0; executor content-script verify OK; SW bundle grows to 29 files (drain included).
- Gate 1f (AdaniOne clone, real Chrome 148, /tmp/clone-gate1f.mjs, log /tmp/clone-dumps-post/gate1f.log): **29 PASS / 0 FAIL** (superset of the 27-check pre-drain harness; pacing-gap checks replaced by post-drain pass expectations).
  - status=passed, **8/8 steps passed**, qty steps 7/8 passed in **813ms / 806ms** (pre-drain: 10.9s/11.0s failures), 6/6 soft assertions passed (pre-drain: 0/2), zero ElementNotFound anywhere.
- Gate 2 (a-slice regression, real Chrome, harness.mjs, log /tmp/a-slice-dumps/gate2-optiond.log): **35 PASS / 0 FAIL** — exact baseline parity; all textMatch 0/1/2 items + COUNT 3/1/2 exact; Scenario B live parity; per-step 103–308ms (drain adds ~100–200ms per network-active step via the two-sample rule); run durationMs 948ms.

## Residual semantics (by design)

- Drain bound = step timeoutMs (default 30s): a never-draining tab costs at most the step's own wait budget, then proceeds (timedOut, never fails the step).
- Websocket/ping/beacon/static/sub-frame/other-tab never block.
- Pure-client (no-network) consequences still rely on the element-wait backstop — unchanged, out of scope here.
