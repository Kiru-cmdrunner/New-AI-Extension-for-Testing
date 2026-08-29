# Executor inter-step consequence sync — causal network drain (Option D)

Parent analysis: `.drytis/notes/consequence-sync-architecture-options-2026-08-20.md`
Supersedes the 300ms/1s quiescence proposal from `.drytis/notes/inter-step-pacing-rca.md`.

## Problem

Replay dispatches each step the instant `EXECUTE_STEP` returns (~2ms). An action whose
consequence rides on a fetch (add-meal POST → server commit → cart render) is still
in flight; the next step (or the action's own assertions) observe the pre-consequence
DOM. Real-Chrome evidence (gate1 replay-poll): add-meal POST resolved (header count
"1") but `/cart` rendered before commit — permanently "Nothing here yet"; steps 7/8
then burned the full 10s element-resolve cap on a target that could never appear.

The recorder solves this with `causalNetworkIdle()` (evidence-collector.ts:1555) —
in-flight requests (noise-filtered) block window settling. The executor has no
equivalent.

## Approved design (conservative)

**Execution-session causal network drain, SW-side, per replay tab.**

### Which requests count as execution in-flight

A request is observed by a drain session iff ALL hold:
1. **Session + tab scope**: a drain session is active AND the request's `tabId` is
   registered in that session (replay tabs are executor-created, dedicated).
2. **Causal resource scope** (mirror of recorder causal filters):
   - resourceKind ∈ {`xmlhttprequest`, `fetch`} (data/XHR — the consequence
     carriers), OR `frameId === 0` (top-frame data requests Chrome types as `other`
     are rare; top-frame scoping mirrors `snapshotInFlightForTab`'s predicate).
   - EXCLUDED kinds: `main_frame`, `sub_frame`, `script`, `stylesheet`, `image`,
     `font`, `media`, `websocket`, `ping`, `csp_report`, `other`-non-top-frame,
     `object`, `xmlhttprequest`-noisy per (3).
   - Websockets never have onCompleted anyway and are excluded by kind.
3. **Noise filter**: URL fails BOTH causal noise regexes (`NOISE_URL_RE_CAUSAL`
   static-asset, `TELEMETRY_URL_RE_CAUSAL` beacon/analytics) — the SAME regexes the
   recorder's causal idle uses. Shared module `src/shared/network-noise.ts` so SW
   and content script CANNOT drift (was duplicated in tap/network-bridge.ts).

Requests never counted → cannot block the drain: analytics, beacons, static assets,
websockets, sub-frame resources, OTHER tabs' traffic (other sessions, human tabs).

### Drain protocol (no new timing semantics)

- Executor, after a PASSED action (and in the navigate branch after
  `waitForPageLoad`+re-inject), before `EVALUATE_ASSERTIONS` / next step:
  `drainForTab(tabId, timeoutMs)` with `timeoutMs = step.executionParameters.timeoutMs ?? 0`
  (existing IR field; `0`/undefined → no wait — preserves legacy instant behavior).
- Loop: stable-zero across TWO consecutive samples (poll cadence 100ms, mirroring
  the executor's existing `RESOLVE_WAIT_POLL_MS`) → drained. Bounded by `timeoutMs`
  (default 30s from existing `DEFAULT_EXECUTION_PARAMETERS`). Two-sample closes the
  CS-response-vs-onBeforeRequest dispatch race without a settle constant.
- Timeout with requests still in flight → proceed anyway (`timedOut: true` — logged,
  never fails the step). The drain can never block indefinitely: hard bound is the
  step's own `timeoutMs`.
- No observable requests → drained at the second sample (~100ms), outcomes unchanged.

### Files

| File | Change |
|---|---|
| `src/shared/network-noise.ts` | NEW — the two causal regexes (moved, single source) |
| `src/tap/network-bridge.ts` | import regexes from shared (defs removed; behavior identical) |
| `src/background/network-observation.ts` | `createExecutionDrain()` session object + capture hooks in the existing onBeforeRequest/onCompleted/onErrorOccurred dispatch |
| `src/execution/ir-executor-impl.ts` | optional `networkDrain` dep (type-only import); beginTab after createTab; drain after passed action & in navigate branch; endTab/dispose in cleanup |
| `src/background/service-worker.ts` | handleRunTest: create session, pass to executor, dispose in finally |

Content script: ZERO changes. Recorder semantics: ZERO changes. IR schema: ZERO
changes. OR-1: untouched (execution orchestration only).

## Acceptance criteria

- [ ] Unit: request start→finish counted then cleared (drain completes)
- [ ] Unit: concurrent requests — drain completes only after ALL finish
- [ ] Unit: noise URLs (static asset / telemetry beacon) never counted, even in flight
- [ ] Unit: non-causal kinds (websocket, sub_frame script/image, main_frame) excluded
- [ ] Unit: other-tab / other-session requests invisible to a session
- [ ] Unit: zero-request drain returns drained ≈ two samples (≤ ~2×poll)
- [ ] Unit: never-completing request → `timedOut` at `timeoutMs`, loop exits, no throw
- [ ] Unit: late-start race — request starting mid-drain (t≈50ms) still caught (two-sample)
- [ ] Unit: `waitStrategy 'none'` / timeoutMs 0 → no wait (behavior preserved)
- [ ] Unit: dispose() stops capture; endTab(tabId) stops that tab's capture
- [ ] Executor wiring: beginTab(created tab) once; drainForTab awaited after passed
      action BEFORE EVALUATE_ASSERTIONS (call-order asserted); NOT called on failed/
      errored action; navigate branch drains before its assertions; endTab in finally
- [ ] `npx tsc --noEmit` stays at the 6-error pre-existing baseline
- [ ] Full vitest suite green
- [ ] `npm run build` green (SW bundle includes drain)
- [ ] Gate 1 (AdaniOne clone, real Chrome): steps 7/8 PASS; run 8/8; qty steps
      resolve in ms (not ~11s); all prior 27 checks stay PASS
- [ ] Gate 2 (a-slice regression, real Chrome): 35/35, durations sane

## Out of scope

- Per-request sourceEventId attribution in the executor (tab scope suffices —
  dedicated replay tab).
- Recorded-resulting-state replay-wait (Option C refinement).
- Any content-script settle/SETTLE message.
- IR schema / recorder / OR-1 changes. New ZIP release.
