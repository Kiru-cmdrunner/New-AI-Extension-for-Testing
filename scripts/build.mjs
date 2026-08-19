/**
 * build.mjs — full extension build with MV3 SW dynamic-import inlining.
 *
 * Layer 1 (already in vite.config.ts): modulePreload:false — Vite's
 * __vitePreload helper never touches document/window.
 *
 * Layer 2 (this orchestration): the crx build still emits dynamic
 * import() call forms for the SW entry, which are spec-banned on
 * ServiceWorkerGlobalScope (w3c/ServiceWorker#1356). So after the main
 * pass we run a dedicated SW lib build with inlineDynamicImports:true —
 * Rollup resolves every `await import('X')` site from source and inlines
 * the target graphs into ONE self-contained SW chunk — then finalize:
 * point the loader at it, verify it contains zero dynamic import() calls,
 * and GC stale SW-related chunks that no longer ship.
 *
 * Pass 4 (this slice, 4c-iii-d): the RUN_TEST executor content script was
 * NEVER built into dist (pre-existing defect since Phase 12.4, ff513dd —
 * see .drytis/notes/DEFECT-executor-content-script-missing-from-dist.md):
 * defaultInjectScript() injects src/execution/executor-content-script.js
 * but no build pass emitted it, so chrome.scripting.executeScript rejected
 * and every RUN_TEST silently errored with status:'error', stepCount:0.
 * A dedicated IIFE lib build now emits it at the exact expected path; the
 * verify script fails the build if it is missing, non-IIFE, or contains a
 * module marker.
 *
 * Finally pack the ZIP (scripts/pack-zip.mjs, unchanged).
 */
import { execSync } from 'child_process';

function run(cmd, env = {}) {
  console.log(`\n[build] ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
}

// Pass 1: main crx build (pages, content scripts, manifest, sidepanel).
run('npx vite build');

// Pass 2: SW-only lib build with dynamic imports inlined into one chunk.
run('npx vite build --mode sw-inline', { SW_INLINE_ONLY: '1' });

// Pass 3: finalize — loader rewrite + verification + stale-chunk GC.
run('node scripts/sw-inline-finalize.mjs');

// Pass 4: executor content script — the RUN_TEST replay script injected
// on demand by defaultInjectScript() at
// src/execution/executor-content-script.js. Pre-existing defect since
// Phase 12.4: no pass emitted it, so every RUN_TEST errored with zero
// steps. IIFE → classic script (no module marker), zero imports.
// Verified by scripts/executor-content-script-verify.mjs.
run('npx vite build --mode executor', { EXECUTOR_ONLY: '1' });
run('node scripts/executor-content-script-verify.mjs');

// Pass 5: pack ZIP.
run('node scripts/pack-zip.mjs');
