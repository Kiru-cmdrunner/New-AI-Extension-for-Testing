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

// Pass 4: pack ZIP.
run('node scripts/pack-zip.mjs');
