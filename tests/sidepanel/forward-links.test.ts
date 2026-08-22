/**
 * MS-U5 pins — forward-links pure formatters (F1/F2/F3).
 *
 * Deterministic templates of RECORDED fields only — every string asserted
 * here must be derivable from KnowledgeActionSignatureRow / KnowledgeGapRow /
 * Element.healHistory. No invented dates, names, or confidence.
 *
 * Spec: .drytis/specs/phase-6-u5-forward-links.md §6 P1–P9.
 */
import { describe, it, expect } from 'vitest';
import {
  forwardLinkLine,
  forwardSummaryLine,
  gapGuidanceLine,
  healLine,
  type ForwardSignature,
} from '../../src/sidepanel/forward-links';

const sig = (o: Partial<ForwardSignature> = {}): ForwardSignature => ({
  actionType: 'Click',
  normalizedTarget: 'search',
  occurrenceCount: 1,
  status: 'active',
  firstSeenAtSession: 'session-1',
  ...o,
});

describe('P1–P4 — F1 forward-link lines (signatures)', () => {
  it('P1: new signature (occurrenceCount 1) — first observation tone', () => {
    const r = forwardLinkLine(sig({ occurrenceCount: 1 }));
    expect(r).not.toBeNull();
    expect(r!.text).toBe('◆ new signature — first observation; next recording reinforces it');
    expect(r!.tone).toBe('new');
  });

  it('P2: reinforced active ×5 — recognized instantly next session', () => {
    const r = forwardLinkLine(sig({ occurrenceCount: 5, status: 'active' }));
    expect(r).not.toBeNull();
    expect(r!.text).toBe('◆ reinforced ×5 · recognized instantly next session');
    expect(r!.tone).toBe('reinforced');
  });

  it('P3: stale ×5 — never claims instant recognition', () => {
    const r = forwardLinkLine(sig({ occurrenceCount: 5, status: 'stale' }));
    expect(r).not.toBeNull();
    expect(r!.text).toBe('◆ reinforced ×5 · not seen recently');
    expect(r!.tone).toBe('stale');
    expect(r!.text).not.toContain('instantly');
  });

  it('P3b: occurrenceCount 2 active → reinforced ×2 (not new)', () => {
    const r = forwardLinkLine(sig({ occurrenceCount: 2 }));
    expect(r!.text).toBe('◆ reinforced ×2 · recognized instantly next session');
  });

  it('P3c: null/undefined signature → null (honest absence)', () => {
    expect(forwardLinkLine(null)).toBeNull();
    expect(forwardLinkLine(undefined)).toBeNull();
  });

  it('P4: all-new summary line (no signatures existed before)', () => {
    const lines = [forwardLinkLine(sig()), forwardLinkLine(sig({ actionType: 'TextEntry', normalizedTarget: 'q' }))];
    expect(forwardSummaryLine(lines, { anyReinforced: false })).toBe(
      'No signatures existed before this session — every action learned is new.',
    );
  });

  it('P4b: mixed session summary names the reinforced count', () => {
    const lines = [
      forwardLinkLine(sig()),
      forwardLinkLine(sig({ occurrenceCount: 3, normalizedTarget: 'q', actionType: 'TextEntry' })),
    ];
    expect(forwardSummaryLine(lines, { anyReinforced: true })).toBe(
      'Recording reinforced existing knowledge — next session starts from what was learned.',
    );
  });
});

describe('P5–P6 — F2 gap guidance (counts only, by reason)', () => {
  it('P5: groups by reason, count desc then reason asc, one sentence', () => {
    const gaps = [
      { reason: 'no-live-horizon' },
      { reason: 'outside-horizon' },
      { reason: 'no-live-horizon' },
    ] as { reason: string }[];
    const line = gapGuidanceLine(gaps as never);
    expect(line).toBe(
      '3 observation(s) could not be attributed (no-live-horizon ×2, outside-horizon ×1) — recording the flow again may confirm horizons.',
    );
  });

  it('P5b: unknown reason still counted honestly (no invention, no drop)', () => {
    const gaps = [{ reason: 'proof-less' }, { reason: 'future-reason' }] as { reason: string }[];
    const line = gapGuidanceLine(gaps as never);
    expect(line).toBe(
      '2 observation(s) could not be attributed (future-reason ×1, proof-less ×1) — recording the flow again may confirm horizons.',
    );
  });

  it('P6: zero gaps → null (block absent, absence is honest)', () => {
    expect(gapGuidanceLine([])).toBeNull();
  });
});

describe('P7–P9 — F3 locator durability (heals)', () => {
  const el = (healHistory: unknown[], lastHealedAt: string | null = null) =>
    ({ healHistory, lastHealedAt }) as never;

  it('P7: two heals → count + last healed date (recorded field only)', () => {
    const line = healLine(el([
      { healedAt: '2026-07-30T10:00:00Z' },
      { healedAt: '2026-08-01T10:00:00Z' },
    ], '2026-08-01T10:00:00Z'));
    expect(line).toBe('2 heals · last healed 2026-08-01');
  });

  it('P8: empty healHistory → honest never-healed line', () => {
    const line = healLine(el([], null));
    expect(line).toBe('recorded, no heals on record');
  });

  it('P9: null element / no rows → null (line absent entirely)', () => {
    expect(healLine(null)).toBeNull();
    expect(healLine(el([], null), false)).toBeNull();
  });
});
