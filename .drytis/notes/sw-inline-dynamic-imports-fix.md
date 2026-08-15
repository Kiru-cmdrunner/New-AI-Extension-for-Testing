# SW dynamic-import inlining (Option A) — build-config-only fix

## What was wrong
Two stacked build defects killed all five SW stages (M9 preload, NetworkDrain, M9 pipeline,
IR Bridge, Repository V2) at import time in real Chrome:
1. `__vitePreload` helper touched `document` (fixed earlier with `modulePreload:false`).
2. **Dynamic `import()` is spec-banned on ServiceWorkerGlobalScope** (w3c/ServiceWorker#1356) —
   every `await import('X')` throws TypeError. The "window is not defined" was the helper's
   catch-tail masking this TypeError.

## The fix (config-only; ZERO source changes)
- `vite.config.ts`: two-pass config. Default = unchanged crx build. `SW_INLINE_ONLY=1` =
  lib build of the REAL SW entry `src/background/service-worker.ts` with
  `rollupOptions.output.inlineDynamicImports: true` → emits `dist/assets/service-worker-inline.js`
  (one self-contained chunk; Rollup resolves all 17 dynamic-import sites from source and inlines
  the target graphs; `import()` becomes in-bundle `Promise.resolve().then(()=>ns)`).
- `scripts/sw-inline-finalize.mjs`: verifies the inlined chunk (0 `import(`, 0 preload helper,
  0 external static imports), rewrites `dist/service-worker-loader.js` →
  `import './assets/service-worker-inline.js';`, GCs the stale crx SW entry chunk +
  12 now-orphaned chunks (fixed-point reachability sweep seeded by removing the old SW entry,
  which lives in a mutual-reference cycle with network-drain/ir-executor-impl).
- `scripts/build.mjs`: orchestrates main pass → SW pass → finalize → pack-zip.
  `package.json` scripts.build now points at it.
- Why the GC matters: the old SW entry (service-worker.ts-<hash>.js) and its satellite chunks
  import each other cyclically, so a naive reachability sweep never collects them; leaving them
  in the ZIP risks a stale artifact being served (exactly the class of bug that bit v10.9.0-Csyj2n63).

## Resulting bundle characteristics
- SW chunk: `assets/service-worker-inline.js`, 507,425 bytes (~126 KB gzip), ONE file.
  0 dynamic import(, 0 vite:preloadError, 0 window.dispatchEvent, 0 document.createElement/querySelector,
  no modulepreload polyfill, 0 external static imports.
- dist/assets: 21 files (was 33). ZIP: 26 files / 223,888 bytes / md5 66f0c6d4c0a0ce3aa779fc09d71e98b0.
- manifest v10.9.0 unchanged; background.service_worker = service-worker-loader.js (loader content changed only).
- Content scripts, sidepanel, repository page chunks untouched by the finalize pass.

## Verification (all green)
- tsc --noEmit: 0 errors. Vitest: 152 files / 3,139 tests passed (twice).
- ZIP + download URL byte-identical (md5 match), 0 stale chunks, no old SW entry inside.
- REAL Chrome (Chrome-for-Testing 151.0.7922.34 — system Chrome 151 ignores --load-extension,
  a known harness trap; use the ms-playwright binary) + CDP harness `.drytis/sw-cdp-verify.mjs`:
  SW = chrome-extension://booiffdngbnalljjpciclggfcigmgggh/service-worker-loader.js.
  Drove real example.com tab + click, START, click again, STOP, then probed storage:
  - SW console: ZERO [M9]/[NetworkDrain]/[IR Bridge]/[Repository V2] errors (both error classes gone).
  - `understanding_result` WRITTEN (first time ever in a real SW): keys appId/generatedAt/outcomes/
    schemaVersion/semanticKnowledge/sessionId/transitions; 1 interaction (int-1); outcome
    "incomplete"/conf 0 (correct — example.com link click had no API evidence); intent
    resolutionPath "context"; domain unknown/0 (no ecommerce signals — correct).
  - `execution_ir_plan` + `generated_files` also present → IR Bridge + Repository V2 ran.
- Conclusion: the pipeline executes end-to-end in the real SW. M9 semantic richness on the
  Amazon flow must now be validated by the user's Layer-0 probe (previous note) since real
  amazon.in traffic cannot be driven from this container.

## Harness notes (why this took many attempts)
- System Chrome ignores --load-extension silently (Preferences shows only component extensions).
  Chrome-for-Testing at /home/coder/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome works.
- Chrome dies when the spawning bash session ends → run it from a persistent terminal.
- `new URL('chrome-extension://...').origin` === 'null' in Node (opaque origin) — derive origins
  by string replace, not URL().origin.
- SW targets idle out of /json — attach via browser-WS Target.setAutoAttach + Target.attachToTarget.
- MV3 SW sleep: after ~30s idle the SW target disappears; keep activity or re-attach.
- Panel-page sendMessage to SW returns undefined when the handler doesn't sendResponse — that's
  fine (handlers are fire-and-forget); rely on storage/console effects, not return values.

## Status
NOT committed, NOT pushed. Changed: vite.config.ts, package.json (build script),
new scripts/build.mjs + scripts/sw-inline-finalize.mjs. Untracked harness: .drytis/sw-cdp-verify.mjs.
