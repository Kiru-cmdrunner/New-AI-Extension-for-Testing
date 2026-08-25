/**
 * 7.4-B3 doctrine sibling — vocabulary freeze.
 *
 * Spec .drytis/specs/phase-7-4-b3-capture-completeness.md §Doctrine:
 *   - S0–S5 add NO new `*_CLASS_RE` (or other keyword regexes) anywhere
 *   - The S4 flip REMOVES vocabulary (BODY/HTML exit NON_INTERACTIVE_TAGS)
 *   - No new interactive-role spellings or tag tokens are added
 *
 * Doctrine: "vocabulary shrinks, never grows". B3 is a capture/honesty
 * milestone: its mechanisms are structural (ledger fold, evidence join,
 * terminal sampling, tag-set removal, metadata flag) — none of them may
 * smuggle in site vocabulary.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('7.4-B3 — vocabulary freeze (S0–S5)', () => {
  const DEFS_DIR = path.join(__dirname, '..', '..', 'src', 'definitions');
  const TAP_IDENTITY = path.join(__dirname, '..', '..', 'src', 'tap', 'identity-extractor.ts');

  it('no new *_CLASS_RE in src/definitions/ (baseline 10, unchanged from B2)', () => {
    const files = fs.readdirSync(DEFS_DIR).filter(
      (f) => f.endsWith('.ts') && f !== 'index.ts',
    );
    let classReCount = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(DEFS_DIR, f), 'utf-8');
      const matches = src.match(/const\s+\w+_CLASS_RE\s*=/g);
      if (matches) classReCount += matches.length;
    }
    expect(classReCount).toBe(10);
  });

  it('S4 shrinks vocabulary: NON_INTERACTIVE_TAGS has neither BODY nor HTML', () => {
    const src = fs.readFileSync(TAP_IDENTITY, 'utf-8');
    const match = src.match(
      /const NON_INTERACTIVE_TAGS\s*=\s*new Set\(\[([\s\S]*?)\]\);/,
    );
    expect(match, 'NON_INTERACTIVE_TAGS must exist in identity-extractor.ts').toBeTruthy();
    const tokens = match![1];
    expect(tokens).not.toMatch(/'BODY'/);
    expect(tokens).not.toMatch(/'HTML'/);
    // structural set intact — SVG internals + head-level tags still present
    expect(tokens).toContain("'SVG'");
    expect(tokens).toContain("'PATH'");
    expect(tokens).toContain("'HEAD'");
    expect(tokens).toContain("'SCRIPT'");
  });

  it('INTERACTIVE_SELECTOR untouched by B3 (no new role spellings)', () => {
    const src = fs.readFileSync(TAP_IDENTITY, 'utf-8');
    const match = src.match(
      /const INTERACTIVE_SELECTOR\s*=\s*\[([\s\S]*?)\]\.join\(', '\)/,
    );
    expect(match, 'INTERACTIVE_SELECTOR must exist').toBeTruthy();
    // B3 baseline: same token count as the B2 ship (39 entries — counted
    // by comma-split of the literal; pinned now so any growth fails).
    const entries = match![1].split(',').filter((s) => s.trim().length > 0);
    expect(entries.length).toBe(39);
  });

  it('S3 synthetic machinery adds no DOM keyword vocabulary (pure ledger mechanics)', () => {
    const swSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'runtime', 'sw-integration.ts'),
      'utf-8',
    );
    // The S3 block is bounded; no class-regex or role vocabulary appears there.
    const s3Block = swSrc.slice(
      swSrc.indexOf('typed-text episode tracker'),
      swSrc.indexOf('function trackTypedTextEpisode') > -1
        ? swSrc.indexOf('function mintTypedTextSample')
        : undefined,
    );
    expect(s3Block).not.toMatch(/_CLASS_RE/);
    expect(s3Block).not.toMatch(/role=/);
  });
});
