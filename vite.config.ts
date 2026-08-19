import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './src/manifest.json';

/**
 * Two build passes, orchestrated by scripts/build.mjs:
 *
 *  1. MAIN pass (default): crx build — HTML pages, content scripts,
 *     manifest, sidepanel. Unchanged behavior.
 *
 *  2. SW pass (SW_INLINE_ONLY=1): plain lib build of the REAL service
 *     worker entry (src/background/service-worker.ts) with
 *     inlineDynamicImports: true. Rollup resolves every
 *     `await import('X')` site from source and inlines the target's graph
 *     into the single SW chunk, emitting in-bundle
 *     `Promise.resolve().then(() => ns)` instead of a dynamic
 *     import(...) call. Dynamic import() is spec-banned on
 *     ServiceWorkerGlobalScope (w3c/ServiceWorker#1356) — this removes
 *     the invalid call form without touching a single source line.
 *
 *     scripts/sw-inline-finalize.mjs then points service-worker-loader.js
 *     at the inlined chunk, verifies it, and garbage-collects the stale
 *     crx-built SW chunks.
 *
 * modulePreload:false (both passes) is layer 1 of the same fix: Vite's
 * __vitePreload helper touches document/window whenever a dynamic import
 * carries a non-empty deps array — fatal in a service worker. Without it
 * every dynamic import resolves with an empty deps list and the helper's
 * guard short-circuits. In the SW pass nothing needs preloading anyway.
 */
export default defineConfig(({ mode }) => {
  const swOnly = process.env.SW_INLINE_ONLY === '1';
  const executorOnly = process.env.EXECUTOR_ONLY === '1';

  if (executorOnly) {
    // EXECUTOR pass: build the RUN_TEST executor content script as a
    // self-contained IIFE at dist/src/execution/executor-content-script.js —
    // the EXACT path src/execution/ir-executor-impl.ts defaultInjectScript()
    // injects via chrome.scripting.executeScript({ files: [...] }).
    //
    // IIFE (not ES): executeScript-injected files run as CLASSIC scripts —
    // a module marker (even a bare `export {}`) is a syntax error there.
    // The source is intentionally self-contained (content scripts cannot
    // import modules), so the bundle has zero imports/exports.
    // Pinned by tests/execution/executor-content-script-build.test.ts.
    return {
      resolve: {
        alias: { '@': resolve(__dirname, 'src') },
      },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        modulePreload: false,
        minify: true,
        lib: {
          entry: resolve(__dirname, 'src/execution/executor-content-script.ts'),
          formats: ['iife'],
          name: 'CmdRunnerExecutor',
          fileName: () => 'src/execution/executor-content-script.js',
        },
        appType: 'custom',
        test: undefined,
      },
    };
  }

  if (swOnly) {
    return {
      resolve: {
        alias: { '@': resolve(__dirname, 'src') },
      },
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        modulePreload: false,
        minify: true,
        lib: {
          entry: resolve(__dirname, 'src/background/service-worker.ts'),
          formats: ['es'],
          fileName: () => 'assets/service-worker-inline.js',
        },
        rollupOptions: {
          output: {
            // THE FIX: inline every dynamic import target into the one SW
            // chunk. import() becomes an in-bundle promise resolution — no
            // dynamic import call form exists in the output, so the HTML-spec
            // ban on import() in service workers can never trigger.
            inlineDynamicImports: true,
          },
        },
      },
      // Lib mode has no dev server / app context.
      appType: 'custom',
      test: undefined,
    };
  }

  return {
    plugins: [crx({ manifest })],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // MV3 service-worker fix, layer 1 (see header comment).
      modulePreload: false,
      rollupOptions: {
        input: {
          repository: resolve(__dirname, 'src/repository/index.html'),
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/legacy/**'],
    },
  };
});
