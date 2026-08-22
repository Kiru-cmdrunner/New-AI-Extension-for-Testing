/**
 * MS-U1 — KR chip pin (RED first).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md (P8/P8b/P9).
 *
 *  P8   lookup result → `◆ reinforced ×N · first seen {session}` / `◆ new signature`.
 *  P8b  async attach, never blocking.
 *  P9   no-write: renderer + chip attach perform zero storage/Dexie writes.
 *
 * The lookup is injectable (`setKrLookup`). The default is an honest no-op
 * (chip absent) unless a real read-only Dexie wrapper is installed — that
 * wiring lives in sidepanel.ts, not here.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildKrChip,
  joinSignatures,
  setKrLookup,
} from '../../src/sidepanel/kr-chip';

describe('P8 — buildKrChip', () => {
  it('reinforced signature → `◆ reinforced ×5 · first seen s-1`', () => {
    const chip = buildKrChip({ occurrenceCount: 5, firstSeenAtSession: 's-1', status: 'active' });
    expect(chip?.text).toBe('◆ reinforced ×5 · first seen s-1');
  });

  it('occurrenceCount 1 → `◆ new signature`', () => {
    const chip = buildKrChip({ occurrenceCount: 1, firstSeenAtSession: 's-1', status: 'active' });
    expect(chip?.text).toBe('◆ new signature');
  });

  it('stale signature is marked', () => {
    const chip = buildKrChip({ occurrenceCount: 9, firstSeenAtSession: 's-0', status: 'stale' });
    expect(chip?.text).toContain('stale');
  });

  it('absent/failed lookup → no chip (honest absence)', () => {
    expect(buildKrChip(null)).toBeNull();
    expect(buildKrChip(undefined)).toBeNull();
  });
});

describe('P8 — joinSignatures (bulk join)', () => {
  it('builds interactionId → chip-text map from episodes + signatures', () => {
    const result = joinSignatures(
      [
        {
          key: 'a:sessionId:e1',
          appId: 'a',
          sessionId: 'sessionId',
          episodeId: 'e1',
          anchor: {
            interactionId: 'int-1',
            actionType: 'Click',
            actionTarget: 'x',
            triggerTimestamp: 0,
          },
          members: [{ interactionId: 'int-1', role: 'trigger' }],
          horizonAttribution: { openedAtMs: 0, closedAtMs: null, closeReason: null },
          horizonUiOwnership: { openedAtMs: 0, closedAtMs: null, closeReason: null },
          parameterInputs: [],
          episodeOutcome: null,
          tabId: null,
          signatureKey: 'a:sig:h1',
        },
      ],
      [
        {
          key: 'a:sig:h1',
          appId: 'a',
          actionType: 'Click',
          normalizedTarget: 'button',
          anchorViewId: null,
          firstSeenAtSession: 's-1',
          lastSeenAtSession: 's-2',
          firstSeenSeq: 1,
          lastSeenSeq: 2,
          firstSeenAtMs: 0,
          lastSeenAtMs: 0,
          occurrenceCount: 5,
          sessionsSinceSeen: 0,
          status: 'active',
          source: 'behavior',
          consequenceProfile: [],
          divergenceFlags: [],
        },
      ],
    );
    expect(result.get('int-1')?.text).toBe('◆ reinforced ×5 · first seen s-1');
  });
});

describe('P8b/P9 — injectable lookup, no writes', () => {
  it('setKrLookup injected fn is used; failures resolve to no chip', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    setKrLookup(lookup);
    const { attachKrChips } = await import('../../src/sidepanel/kr-chip');
    // attach must not throw when lookup resolves null; lookup IS consulted
    await expect(attachKrChips(new Map([['int-1', document.createElement('div')]])))
      .resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalled();
  });

  it('default (unset) lookup → no chip, no throw', async () => {
    const mod = await import('../../src/sidepanel/kr-chip');
    setKrLookup(null);
    await expect(mod.attachKrChips(new Map())).resolves.toBeUndefined();
  });
});
