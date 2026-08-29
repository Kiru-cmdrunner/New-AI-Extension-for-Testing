# DEFECT (CLOSED 2026-08-23, 6F-M2a audit): RUN_TEST executor content script never built into dist

**Discovered:** 2026-08-17, during D4 real-Chrome validation (post-D4 approval,
recorded per user instruction 2026-08-18).

**Status:** **CLOSED — resolved by later build work, verified 2026-08-23 during
the 6F-M2a backlog grounding audit @ `be5faf3`.** The original root cause was
real (no build step emitted the executor script), but the current state
contradicts the note's "Pending investigation":

- `dist/src/execution/executor-content-script.js` EXISTS (12,299 bytes,
  classic-script safe) — the build log's `[executor-verify]` line checks it.
- `vite.config.ts:34-38` has a dedicated EXECUTOR pass
  (`process.env.EXECUTOR_ONLY === '1'` → self-contained IIFE emitted at the
  path `chrome.scripting.executeScript` expects).
- The canonical ZIP contains `src/execution/executor-content-script.js`
  (12,299 bytes) — testers get the executor.

The note had simply never been re-verified after the fix landed. Closing as
docs-only: no code changed, nothing to re-test beyond the existing suite
(260 files / 4,513 green at this HEAD).

## Symptom

Clicking "Run Test" in the side panel of the BUILT extension always produces:

    status: "error", stepCount: 0, stepResults: [], durationMs: ~220ms
    Panel render: "ERROR 0/0 steps passed · ~0.2s" + a Run ID

The recording pipeline, IR generation, and Playwright codegen all work; only
execution fails, silently (best-effort catch).

## Root cause (verified)

`src/execution/ir-executor-impl.ts` `defaultInjectScript()` (line ~110) injects:

    chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/execution/executor-content-script.js'],
    })

But `src/execution/executor-content-script.js` is NEVER emitted into `dist/`:

- `find dist -name "*executor*"` → empty
- vite.config.ts has no input/rollup entry for it; scripts/build.mjs does not
  copy it; `dist/manifest.json` has no content_scripts entry referencing it
  (content_scripts only carry `recorder-entry` + `network-inject`)
- The TS source exists (`src/execution/executor-content-script.ts`, ~530 lines,
  RESOLVE_LOCATOR / EXECUTE_ACTION / EVALUATE_ASSERTIONS handlers) but no
  build step compiles+places it at the path `chrome.scripting` expects

So `chrome.scripting.executeScript` rejects (file not found in extension),
`IRExecutorImpl.execute()` catches, returns `status:'error'` with zero steps,
and `handleRunTest` stores that. Pre-existing since Phase 12.4 (ff513dd) —
NOT a D4 regression (D4 only renders what's in storage, honestly).

## Fix sketch (when approved)

Add an iife/es build of `src/execution/executor-content-script.ts` output to
`dist/src/execution/executor-content-script.js` (vite build.config entry or a
copy step in scripts/build.mjs after building the bundle from source TS), then
re-run the D4 harness `/tmp/d4-val/harness.mjs` (preserved copy:
`.drytis/notes/evidence/d4-real-chrome-harness.mjs`) — its RUN_TEST phase
should then show real step results instead of the honest-error render.

## Evidence

- `.drytis/notes/evidence/d4-real-chrome-final-run.log` — "real RUN_TEST
  renders its error summary honestly" PASS line
- D4 report (session, 2026-08-17): execution_result dump showing
  `{"status":"error","stepCount":0,...}` after clicking Run Test in the panel
