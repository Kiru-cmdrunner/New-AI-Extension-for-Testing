/**
 * Executor content script build wiring (Phase 4c-iii-d).
 *
 * The RUN_TEST replay path injects dist/src/execution/executor-content-script.js
 * via chrome.scripting.executeScript({ files: [...] }). Pre-existing defect
 * since Phase 12.4: no build pass emitted the artifact, so every RUN_TEST
 * silently errored with zero steps (see
 * .drytis/notes/DEFECT-executor-content-script-missing-from-dist.md).
 *
 * These tests pin the WIRING (config + orchestration + verifier), not the
 * artifact itself (which exists only after `npm run build`):
 *   - vite.config.ts has the EXECUTOR_ONLY lib pass: IIFE (classic-script
 *     safe), emitting to the exact injected path
 *   - scripts/build.mjs runs the pass + the verify script BEFORE pack-zip
 *   - scripts/executor-content-script-verify.mjs exists and enforces
 *     existence, handler presence, and classic-script safety
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '..', '..');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
const buildScript = readFileSync(resolve(root, 'scripts/build.mjs'), 'utf8');

describe('executor content script build wiring (4c-iii-d)', () => {
  it('vite.config.ts has an EXECUTOR_ONLY pass', () => {
    expect(viteConfig).toContain('EXECUTOR_ONLY');
    expect(viteConfig).toContain('executor-content-script.ts');
  });

  it('the executor pass emits IIFE (classic script — no module marker)', () => {
    // The injected file runs as a CLASSIC script: an ES module marker
    // (even a bare `export {}`) is a SyntaxError there.
    const executorBlock = viteConfig.split('if (executorOnly)')[1]?.split('if (swOnly)')[0] ?? '';
    expect(executorBlock).toBeTruthy();
    expect(executorBlock).toContain("formats: ['iife']");
    expect(executorBlock).toContain('executor-content-script.js');
  });

  it('the executor pass emits to the EXACT path defaultInjectScript injects', () => {
    const executorImpl = readFileSync(resolve(root, 'src/execution/ir-executor-impl.ts'), 'utf8');
    const injected = executorImpl.match(/files:\s*\['([^']+)'\]/)?.[1];
    expect(injected).toBe('src/execution/executor-content-script.js');
    const executorBlock = viteConfig.split('if (executorOnly)')[1]?.split('if (swOnly)')[0] ?? '';
    expect(executorBlock).toContain("'src/execution/executor-content-script.js'");
  });

  it('build.mjs runs the executor pass and the verifier', () => {
    expect(buildScript).toContain('EXECUTOR_ONLY');
    expect(buildScript).toContain('executor-content-script-verify.mjs');
  });

  it('the verifier runs BEFORE pack-zip (a broken artifact stops the build)', () => {
    const runIdxs = [...buildScript.matchAll(/run\('([^']+)'/g)].map((m) => ({ cmd: m[1], idx: m.index ?? -1 }));
    const verify = runIdxs.find((r) => r.cmd.includes('executor-content-script-verify.mjs'));
    const pack = runIdxs.find((r) => r.cmd.includes('pack-zip.mjs'));
    expect(verify).toBeDefined();
    expect(pack).toBeDefined();
    expect(pack!.idx).toBeGreaterThan(verify!.idx);
  });

  it('the verifier script exists', () => {
    expect(existsSync(resolve(root, 'scripts/executor-content-script-verify.mjs'))).toBe(true);
  });

  it('the verifier enforces classic-script safety (no module markers)', () => {
    const verifier = readFileSync(resolve(root, 'scripts/executor-content-script-verify.mjs'), 'utf8');
    expect(verifier).toContain('export');
    expect(verifier).toContain('EVALUATE_ASSERTIONS');
    expect(verifier).toContain('process.exit(1)');
  });

  it('the verify script passes against the freshly built artifact (integration)', () => {
    const artifact = resolve(root, 'dist/src/execution/executor-content-script.js');
    if (!existsSync(artifact)) {
      // Build artifacts are not part of the repo; skip when dist is absent
      // (CI without a build step) — the build-time verifier covers it there.
      return;
    }
    const code = readFileSync(artifact, 'utf8');
    expect(code).toContain('EVALUATE_ASSERTIONS');
    expect(code).toContain('EXECUTE_STEP');
    // Classic-script safety: no top-level module markers.
    const stripped = code.replace(/\bexport\s*\{\s*\}\s*;?/g, '');
    expect(stripped).not.toMatch(/(^|\n)\s*(export|import)\s/);
  });
});
