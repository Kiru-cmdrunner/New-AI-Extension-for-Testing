/**
 * sw-inline-finalize.mjs — MV3 service-worker build finalization pass.
 *
 * Dynamic `import()` is DISALLOWED on ServiceWorkerGlobalScope by the HTML
 * spec (w3c/ServiceWorker#1356). Every `await import('X')` in the MV3
 * service worker throws `TypeError: import() is disallowed ...` in real
 * Chrome — which killed M9 prior-knowledge preload, NetworkDrain, the M9
 * understanding pipeline, the IR Bridge, and Repository V2 persistence at
 * import time (before any stage logic executed). Vitest never caught it
 * because tests import source directly and never run the built bundle in a
 * real service worker.
 *
 * scripts/build.mjs runs a dedicated SW pass (vite build --mode sw-inline)
 * that emits dist/assets/service-worker-inline.js: the REAL SW entry with
 * every dynamic-import target inlined into one self-contained chunk
 * (Rollup inlineDynamicImports — zero dynamic import() call forms, zero
 * preload helper, no DOM access).
 *
 * This script then:
 *   1. Verifies the inlined chunk: zero `import(` tokens, no
 *      `vite:preloadError`, no window.dispatchEvent.
 *   2. Rewrites dist/service-worker-loader.js to point at the inlined
 *      chunk (the manifest keeps using the loader, so no manifest change).
 *   3. Deletes the stale crx-built SW entry chunk(s) that the loader no
 *      longer references — nothing in the shipped extension may point at
 *      the old dynamic-import bundle.
 *   4. Fails the build (exit 1) if any check does not hold.
 *
 * Scoped to the service worker ONLY. Content scripts, HTML pages, the
 * repository bundle, and the sidepanel chunk are never modified.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const dist = resolve(__dirname, '..', 'dist');
const assetsDir = join(dist, 'assets');
const loaderPath = join(dist, 'service-worker-loader.js');
const inlineRel = 'assets/service-worker-inline.js';
const inlinePath = join(dist, inlineRel);

function fail(msg) {
  console.error(`[sw-inline-finalize] FAIL: ${msg}`);
  process.exit(1);
}

// --- 1. inlined chunk must exist & be verified ------------------------------
if (!existsSync(inlinePath)) fail(`${inlineRel} missing — did the sw-inline pass run?`);
const code = readFileSync(inlinePath, 'utf8');
if (code.includes('import(')) fail('inlined SW chunk still contains dynamic import(');
if (code.includes('vite:preloadError')) fail('inlined SW chunk contains vite:preloadError');
if (/\bwindow\.dispatchEvent\b/.test(code)) fail('inlined SW chunk contains window.dispatchEvent');
const staticImportStmts = [...code.matchAll(/^\s*import[\s{][^;]*?from\s*['"][^'"]+['"];?\s*$/gm)];
if (staticImportStmts.length > 0) {
  fail(`inlined SW chunk still has ${staticImportStmts.length} external static import(s)`);
}
console.log(
  `[sw-inline-finalize] verified ${inlineRel}: ${statSync(inlinePath).size} bytes, ` +
    `0 dynamic import(), 0 preload helper, 0 external static imports`
);

// --- 2. rewrite the loader ---------------------------------------------------
writeFileSync(loaderPath, `import './${inlineRel}';\n`);
console.log(`[sw-inline-finalize] service-worker-loader.js -> ./${inlineRel}`);

// --- 3. remove stale crx-built SW chunks -------------------------------------
// The old SW entry chunk (service-worker.ts-<hash>.js) is dead: the loader
// now points at the inlined chunk. Its import graph (network-drain,
// ir-executor-impl, understanding-pipeline, ...) is kept alive ONLY by a
// mutual-reference cycle (those chunks import symbols back from the SW
// chunk), so a plain reachability sweep never collects them. Remove the old
// SW entry chunks first, then sweep to a fixed point.
const oldSwEntries = readdirSync(assetsDir).filter(
  (f) => /^service-worker\.ts-[^/]*\.js$/.test(f) || /^service-worker\.ts\.js$/.test(f)
);
for (const f of oldSwEntries) {
  rmSync(join(assetsDir, f));
  console.log(`[sw-inline-finalize] GC stale SW entry: ${f}`);
}
let removedTotal = oldSwEntries.length;

// Fixed-point sweep: a chunk is kept if any SURVIVING file (manifest,
// loader, sibling chunks, HTML pages under dist/src) references it. Removing
// a chunk can orphan another, so loop until stable.
for (;;) {
  const files = readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f) && f !== 'service-worker-inline.js');
  if (files.length === 0) break;
  // Collect all referencing bodies: sibling chunks + HTML/JS/CSS in dist/src + manifest + loader.
  const referencingBodies = [readFileSync(join(dist, 'manifest.json'), 'utf8'), readFileSync(loaderPath, 'utf8')];
  for (const f of files) {
    try { referencingBodies.push(readFileSync(join(assetsDir, f), 'utf8')); } catch { /* ignore */ }
  }
  const srcRoot = join(dist, 'src');
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|js|css)$/.test(e.name)) {
        try { referencingBodies.push(readFileSync(p, 'utf8')); } catch { /* ignore */ }
      }
    }
  };
  walk(srcRoot);

  const dead = [];
  for (const f of files) {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc);
    const referenced = referencingBodies.some((b) => re.test(b));
    if (!referenced) dead.push(f);
  }
  if (dead.length === 0) break;
  for (const f of dead) {
    rmSync(join(assetsDir, f));
    console.log(`[sw-inline-finalize] GC stale chunk: ${f}`);
  }
  removedTotal += dead.length;
}
console.log(`[sw-inline-finalize] OK — ${removedTotal} stale chunk(s) removed`);
