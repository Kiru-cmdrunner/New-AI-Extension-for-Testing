/**
 * executor-content-script-verify.mjs — build-time verification for the
 * RUN_TEST executor content script (4c-iii-d).
 *
 * chrome.scripting.executeScript({ files }) loads the file as a CLASSIC
 * script into the page. Verify the artifact dist/src/execution/
 * executor-content-script.js:
 *
 *   V1. exists at the exact path defaultInjectScript() requests
 *   V2. is non-empty and contains the EVALUATE_ASSERTIONS handler
 *   V3. contains NO module markers — 'export ' at statement start /
 *       'import ' at statement start / bare 'export {}' — which would be
 *       a SyntaxError in a classic script
 *   V4. is IIFE-shaped (the lib formats:['iife'] output) — no bare
 *       top-level code outside the wrapper is required by Chrome, but a
 *       global-leaking classic script would pollute every injected page
 *
 * Exits 1 on any failure so the pipeline stops before pack-zip.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const artifact = join(root, 'dist', 'src', 'execution', 'executor-content-script.js');

const fail = (msg) => {
  console.error(`[executor-verify] FAIL: ${msg}`);
  process.exit(1);
};

// V1 — exists at the injected path
if (!existsSync(artifact)) {
  fail(`artifact missing: dist/src/execution/executor-content-script.js (defaultInjectScript injects this path)`);
}

const code = readFileSync(artifact, 'utf8');

// V2 — real content: the replay handlers must be present
if (code.length < 1000) fail(`artifact suspiciously small (${code.length} bytes)`);
for (const needle of ['EVALUATE_ASSERTIONS', 'EXECUTE_STEP', 'RESOLVE_LOCATOR']) {
  if (!code.includes(needle)) fail(`artifact missing required handler '${needle}'`);
}

// V3 — no module markers (classic-script SyntaxError)
const moduleMarker = /(^|\n)\s*(export\s|import\s)/.test(code.replace(/\bexport\s*\{\s*\}/, ''));
if (moduleMarker) {
  fail('artifact contains an import/export module marker — illegal in a classic script');
}
if (/\bexport\s*\{\s*\}\s*;?/.test(code) && !/\bvar\b|\bconst\b|\blet\b|\bfunction\b/.test(code.replace(/\bexport\s*\{\s*\}\s*;?/, ''))) {
  // belt-and-braces: a bare `export {}` that survived minification alone
  fail('artifact appears to be ONLY a module marker (export {})');
}

// V4 — IIFE wrapper present (minified IIFE starts with something like
// `var CmdRunnerExecutor=function(){"use strict";...}();` or `(function(){...})();`)
if (!/^\s*(\(?\s*function|var\s+\w+\s*=\s*function)/.test(code) && !/^!?\s*function/.test(code)) {
  // esbuild/rollup IIFE output shape check — warn-level: some minifiers
  // emit `var X=(function(){...})();`. Accept any leading function-ish
  // wrapper; hard-fail only on obviously module-shaped output (starts
  // with export/import).
  const head = code.slice(0, 80).replace(/\s+/g, ' ');
  console.warn(`[executor-verify] WARN: unexpected artifact head: ${head}`);
}

console.log(`[executor-verify] OK — ${artifact.replace(root + '/', '')} (${code.length} bytes, classic-script safe)`);
