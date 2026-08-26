/**
 * 7.4-B1 Expander — understanding-layer pins (spec AC-6/7).
 * KR signature fragmentation is EXPECTED behavior, pinned so a future change
 * to the frozen v1 hashing notices; DDC-3 allowlist; dedup 2s limit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signatureKey } from '../../src/understanding/persistence/behavior-knowledge-mapper';

const src = (p: string) =>
  readFileSync(resolve(process.cwd(), 'src', p), 'utf-8');

describe('7.4-B1 Expander understanding layer', () => {
  it('B1-17 (upgraded from grep to real divergence pin, 2026-08-25, reviewer WARN-2): reclassifying Click → Expander mints a DISTINCT signatureKey for the same target — the fragmentation this milestone knowingly accepts', () => {
    // FROZEN v1 identity: appId:sig:hash(appId|actionType|normalizedTarget|anchorViewId).
    // Same app, same normalized target, same anchor — ONLY actionType differs.
    const clickKey = signatureKey('http://app.example', 'Click', 'search flights', null);
    const expanderKey = signatureKey('http://app.example', 'Expander', 'search flights', null);
    expect(clickKey).not.toEqual(expanderKey);
    // Determinism guard: identical inputs derive the identical key (no drift).
    expect(signatureKey('http://app.example', 'Expander', 'search flights', null))
      .toEqual(expanderKey);
  });

  it('B1-18: DDC-3 reload-recovery allowlist includes Expander', () => {
    const p = src('understanding/pipeline/understanding-pipeline.ts');
    expect(p).toMatch(/new Set\(\['Click', 'KeyboardShortcut', 'CompoundInteraction', 'Link', 'Expander', 'Modal'\]\)/);
  });

  it('B1-19: dedup 2s limit — Expander subject to the generic same-type rule (known limit, pinned)', () => {
    // component-runtime isDuplicate: same type + elementKey within DEDUP_WINDOW_MS
    // (2000) dedupes — rapid same-control double-click collapses to one card.
    // Flips >2s apart are unaffected. Pinned as documented behavior.
    const ct = src('shared/component-types.ts');
    expect(ct).toMatch(/DEDUP_WINDOW_MS\s*=\s*2000/);
  });
});
