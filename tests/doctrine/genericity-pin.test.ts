/**
 * Genericity pin — the Application Understanding Engine must stay
 * site-agnostic (owner directive, 2026-08-22: "Do not make this extension
 * only for AdaniOne").
 *
 * Fails if any production source file under src/ contains a site-specific
 * token OUTSIDE a comment. Tokens are matched case-insensitively; comment
 * contexts (//, /* *\/, JSDoc) are exempt because citing a site as one
 * example of a generic convention is documentation, not site logic
 * (e.g. patterns.ts DATE_CELL_NAME_RE documents the W3C ARIA APG
 * date-picker convention "used by AdaniOne, react-datepicker, MUI").
 *
 * Also guards the reverse hazard: knowledge-scope bleed. The KR is keyed
 * by appId (origin-derived); no production source may hardcode an appId
 * string for a specific real site.
 *
 * This is doctrine-as-code: a future edit that introduces a site hack
 * turns this pin red. Site-specific fixes belong in Application Knowledge
 * (per-app learned rows), never in engine logic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Site tokens — real-world sites this project has been validated against
 * (or that share their vocabulary). Lowercase; matched case-insensitively.
 * Adding a token here when a new validation site appears is EXPECTED and
 * deliberate — the list grows with the benchmark set, it never shrinks.
 */
const SITE_TOKENS: readonly string[] = [
  'adani',       // AdaniOne (validation benchmark)
  'adcn',        // AdaniOne CDN/asset prefix
  'airindia',    // peer airline sites (same widget vocabulary)
  'indigo',      // 6ix / IndiGo
  'spicejet',
  'vistara',
  'makemytrip',
  'goibibo',
  'cleartrip',
  'yatra',       // yatra.com
  'booking.com', // travel-booking vocabulary
];

/** Source extensions scanned (production code only). */
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html']);

/** Directories under src/ skipped (fixtures/seed data are test artifacts). */
const SKIP_DIRS = new Set(['__snapshots__']);

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (SOURCE_EXTS.has(entry.slice(entry.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments so tokens inside them don't count. Conservative:
 * line comments (//...) to end-of-line and block comments (slash-star).
 * Strings containing "//" (URLs) are protected by only trimming after a
 * line comment marker when it is not inside a URL — approximate, but
 * false-EXEMPT is only possible for tokens that appear on the same line
 * AFTER a comment marker inside a string literal, which the manual spot
 * check below also guards (this pin is tripwire, not the only defense).
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:'"])\/\/.*$/gm, ' '); // line comments (not after ':')
}

const tokenRe = (t: string) => new RegExp(t.replace('.', '\\.'), 'i');

describe('genericity pin — site-agnostic engine (owner directive 2026-08-22)', () => {
  it('no site token appears outside comments in any production source file', () => {
    const files = listSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(100); // sanity: we actually scanned src/
    const violations: string[] = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      for (const token of SITE_TOKENS) {
        const re = tokenRe(token);
        if (re.test(stripped)) {
          // Find the offending line for the failure message.
          const raw = readFileSync(file, 'utf8').split('\n');
          const hitLine = raw.find((l) => re.test(stripComments(l)) && re.test(l)) ?? '';
          violations.push(`${file.replace(SRC_ROOT + '/', '')}: token "${token}" outside comment — e.g. ${hitLine.trim().slice(0, 120)}`);
        }
      }
    }
    expect(violations, `Site-specific tokens found in production source (site hacks belong in Application Knowledge, never engine logic):\n${violations.join('\n')}`).toEqual([]);
  });

  it('current exemption baseline is exactly the four documented convention citations', () => {
    // The four known comment-context citations (see test docblock). If this
    // count CHANGES, a new mention appeared — verify it is comment-context
    // documentation of a generic convention before accepting it.
    const expected = new Set([
      'src/definitions/patterns.ts',
      'src/definitions/dropdown.ts',
      'src/generation/assertion-derivation.ts',
      'src/understanding/page-content/page-content-config.ts',
    ]);
    const files = listSourceFiles(SRC_ROOT);
    const mentioning = new Set<string>();
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      if (SITE_TOKENS.some((t) => tokenRe(t).test(raw))) {
        mentioning.add(file.replace(SRC_ROOT + '/', 'src/'));
      }
    }
    expect([...mentioning].sort()).toEqual([...expected].sort());
  });
});
