# Root cause & fix: `document is not defined` killed M9/IR/Repository in the real SW

## Root cause
Vite's injected `__vitePreload` helper (minified as `w`) unconditionally runs
`document.getElementsByTagName("link")` / `document.createElement` / `document.head`
whenever a dynamic import is compiled with a NON-EMPTY deps array. MV3 service
workers have no DOM → `ReferenceError: document is not defined` at
`service-worker.ts-DV0ObNX3.js:2:353` (that column is exactly the helper's first
DOM statement).

## Blast radius (old build)
Dynamic imports with non-empty `__vite__mapDeps([...])` — ALL failed:
- preloadPriorKnowledge + runUnderstandingPipeline + serializeStateTransitions → `[M9] ... failed`
- drainNetworkEvidence → `[NetworkDrain] drain failed`
- build (ir-bridge) + PlaywrightCodeGenerator → `[IR Bridge]`
- DexieUnitOfWorkFactory + persistSession + persistBehavioralEvidence → `[Repository V2]`
Static (`void 0` deps) imports survived: getBootRestorePromise, getCompletedBySourceEventId,
filterUnpersistedEvidence/markEvidencePersisted — which is why G4/G5 capture/attribution
kept working perfectly while everything downstream was dark.
Consequence: NO UnderstandingResult at all (not even the stub — setRaw is inside the
same try after the import), no IR plan, no Dexie persistence, no stop-drain.

## Fix (approved, applied 2026-08-15)
`vite.config.ts`: `build.modulePreload: false` — single line + comment. No source changes.
Mechanism (verified in vite 5.4.21 source): with modulePreload false, the import-analysis
plugin emits deps = `[]` for every dynamic import (CSS-only filter, and no CSS deps in the
SW graph) → helper's `if(r&&r.length>0)` guard short-circuits → import() runs normally.

## Verification performed
- New SW chunk `service-worker.ts-Csyj2n63.js`: all 17 `w(async…)` calls pass `[]`/`void 0`
  (paren-matched scan, 0 unsafe). `__vite__mapDeps` and modulepreload-polyfill gone from dist.
- Node simulation, no document/window defined: module-scope init OK; helper with deps=[]
  resolves; deps=undefined resolves; deps=['x.css'] still throws (contrast proves old path).
- tsc --noEmit: 0 errors. vitest: 152 files / 3,139 tests passed.
- ZIP v10.9.0 rebuilt: 38 files, 165,731 bytes, md5 fe8d3b571c2a2c8d939c9c8d05e386e8;
  download URL serves identical md5. ZIP SW chunk itself verified safe (17/17 imports).
- Only file changed vs HEAD: vite.config.ts (+9 lines incl. comment). Not committed yet.

## History
Defect pre-dates G4/G5 (M9.12 wiring commit 588bd8a, Phase 8.3 13feae6, Phase 10.3
1945e1e — all ancestors of origin tip 10d10e0). Hidden because vitest runs jsdom and
imports source directly (no vite helper), and no automated test loads the built bundle
in a real SW context.

## Next
User re-runs Amazon Add-to-cart test with fresh ZIP, then corrected probe
(fix: `const S = await chrome.storage.local.get([...])` — do NOT destructure as array)
to read understanding_result + cmdrunner_live_interactions; expect real outcomes/
transitions/domain/intent for the Add-to-cart click, and re-verify exactly-once POST.