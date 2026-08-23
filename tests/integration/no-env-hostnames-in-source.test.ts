/**
 * Genericity pin — no environment identity in tracked source
 *
 * Defect background: tests/integration/form-submit-e2e.test.ts carried the
 * environment's preview subdomain as a fixture URL constant from 2026-08-14
 * (commit 69bbf20) until the 2026-08-23 micro-fix replaced it with
 * `validation.local`. This pin makes the CLASS un-regressable: tracked
 * source under src/ tests/ scripts/ must not contain the drytis preview
 * hostname pattern, so a future fixture copy-paste from a browser bar
 * fails the suite instead of only the (periodic) infra gate.
 *
 * Exclusions: none today. `.drytis/` notes and evidence legitimately
 * reference URLs in prose/dumps and are not scanned.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'tests', 'scripts'];
// Any *.drytis.dev hostname (preview subdomains are project-slugged).
const FORBIDDEN = /[a-z0-9-]+\.drytis\.dev/i;
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|html|css|md)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(name)) yield p;
  }
}

const hits: string[] = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (FORBIDDEN.test(readFileSync(file, 'utf8'))) hits.push(file);
  }
}

describe('genericity pin — no *.drytis.dev hostnames in tracked source', () => {
  it('src/ tests/ scripts/ contain zero preview-host literals', () => {
    expect(
      hits,
      `environment hostname found in: ${hits.join(', ')}`,
    ).toEqual([]);
  });
});
