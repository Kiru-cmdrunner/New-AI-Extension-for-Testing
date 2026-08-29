# D9 — IR Environment Honesty + Deterministic Test-Case IDs

**Date:** 2026-08-18 · **Status:** approved-for-implementation
**Branch:** `capability-surgical-removal` (base `bf27d52`) · **Type:** additive fix, backward-compatible

## Root cause (verified in investigation round)

`src/generation/ir-bridge.ts` `build()` violates **INV-GEN-1** (Determinism — same input → same output, declared in its own header line 16) in four ways:

1. **Nondeterministic IDs** (L449–450): `tc-${Date.now()}` / `tcv-${Date.now()}` — same recording compiled twice yields different IDs; ExecutionRun history can never correlate replays of one recording.
2. **Viewport hardcoded** (L445): `{1280,720}` fiction flowing into generated `playwright.config.ts` (project-generator.ts:158). Real recording viewport never captured anywhere in src.
3. **Browser hardcoded** (L444): `'chrome'` is truthful (Chrome-only MV3 extension) but undocumented as invariant.
4. **baseUrl = full startUrl** (L443): `IREnvironment.baseUrl` documented as "fully resolved base URL" but receives pathful URL. Load-bearing conflict: `ir-executor-impl.ts:163` uses it as replay start URL (needs path); `generator.ts:289` uses it as URL-resolution base (needs origin).

## Scope — exact files

| File | Change |
|---|---|
| `src/generation/ir-bridge.ts` | Deterministic djb2 IDs (`tc-<hex8>`/`tcv-<hex8>`) over `\|name\|startUrl\|stepId:action:targetKind:input…`; `baseUrl` = origin of startUrl (raw fallback for unparseable/non-http, e.g. about:blank); new `startUrl` field; viewport from recordingContext with documented fallback; `RECORDING_BROWSER` const + invariant comment |
| `src/generation/generation-types.ts` | `RecordingContext` += `readonly viewport?: { width: number; height: number }` |
| `src/domain/execution-ir/types.ts` | `IREnvironment` += `readonly startUrl?: string` (optional — old cached plans keep working) |
| `src/execution/ir-executor-impl.ts` | L163: `const startUrl = plan.environment.startUrl ?? plan.environment.baseUrl;` |
| `src/background/service-worker.ts` | `handleStartRecording`: capture `tab.width`/`tab.height` → module var `recordingViewport`; include in SESSION_CONTEXT payload; pass viewport into `buildIRPlan` recordingContext |
| `src/shared/types.ts` | persisted `RecordingContext` += optional `viewport?: { width: number; height: number }` |
| `tests/generation/d9-ir-env-determinism.test.ts` | NEW |
| `tests/ir-executor-impl.test.ts` | additive: prefers startUrl; falls back to baseUrl |
| `tests/ir-bridge.test.ts` | stale-assertion updates (baseUrl now origin at L131/138/580; viewport fallback lines) |

**No change needed:** `project-generator.ts` (emits `env.baseUrl` → now correct origin semantics); `generator.ts` (resolution becomes correct as side effect). Generator-version literal bump: skipped (default), flagged in report.

**Explicitly untouched:** D2/D3/D8/D10 work, E1-prep files, executor-content-script defect, preview-URL defect, D4/D5/D6 surfaces, healing.

## Acceptance criteria

- [ ] `build()` twice with identical input → deep-equal plans (INV-GEN-1 test).
- [ ] IDs match `^tc-[0-9a-f]{8}$` / `^tcv-[0-9a-f]{8}$`; stable across builds; change when name/startUrl/steps change.
- [ ] `environment.baseUrl` = origin for http(s) startUrl; = raw startUrl for `about:blank`/invalid.
- [ ] `environment.startUrl` = recorded start URL, present always.
- [ ] `environment.viewport` = recordingContext.viewport when provided; `{1280,720}` fallback otherwise (documented).
- [ ] Executor prefers `environment.startUrl`; falls back to `baseUrl` when absent (old cached plans).
- [ ] `tsc --noEmit` exit 0.
- [ ] Full suite green (3,589 total: 3,587 measured baseline incl. D5 removals + new D9 tests).
- [ ] Build v10.9.0 succeeds.
- [ ] Real-Chrome: window resized to non-default (e.g. 1100×760) before START → captured viewport ≠ 1280×720 and matches tab dims; IDs are hex (no 13-digit epoch); startUrl = recorded URL; baseUrl = origin; generated playwright.config has origin baseURL + measured viewport; two STOPs of identical interactions yield identical IDs; zero unexpected console errors.

## Tests (red phase first)

New `tests/generation/d9-ir-env-determinism.test.ts` (fixture pattern from ir-bridge.test.ts makeInteraction/makeInput):
1. determinism: build(input) deep-equals build(input) (IDs included).
2. ID format: hex8, `tc-`/`tcv-` prefixes.
3. ID sensitivity: name change → different id; URL change → different id; step change → different id.
4. baseUrl: `https://host/search.html?q=x` → `https://host`; `http://127.0.0.1:8098/` → `http://127.0.0.1:8098`; `about:blank` → `about:blank` (raw fallback).
5. startUrl preserved verbatim in all cases.
6. viewport passthrough `{1024,768}`; fallback `{1280,720}` when absent.
7. browser still 'chrome'.

Extend `tests/ir-executor-impl.test.ts`: two additive `it` blocks (startUrl preferred; baseUrl fallback).

Stale updates in `tests/ir-bridge.test.ts`: L131/138/580 baseUrl expectations → origin (`https://example.com`); viewport lines → `{1280,720}` fallback stays valid (no change needed unless fixture asserts pathful baseUrl — verify each).

## Real-Chrome validation plan

1. `npm run build`; replica :8098; CDP harness (D4/D5 method).
2. `Browser.setWindowBounds` → e.g. 1100×760 BEFORE START_RECORDING (proves capture ≠ hardcoded).
3. Record purchase flow → STOP → dump EXECUTION_IR_PLAN + GENERATED_FILES.
4. Assert hex IDs (reject 13-digit epoch), startUrl recorded, baseUrl origin, viewport captured (≠1280×720), config origin baseURL + measured viewport.
5. Second STOP of same flow → identical IDs (in-vivo determinism).
6. RUN_TEST unchanged behavior (executor-content-script defect pre-existing, out of scope); zero unexpected console errors.

## Verification

Full path: Infrastructure Gate (a–g), reviewer, infra_verifier, real-Chrome CDP. Report diff/tests/Chrome/scope audit. NO commit/push until user approves.
