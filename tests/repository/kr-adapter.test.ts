/**
 * MS-U4 pins — the seed-evidence adapter (kr-data.ts).
 *
 * Reviewer F-1 (first round): the adapter originally mapped networkActivity
 * to [], which makes the FROZEN derivation emit zero seeds unconditionally —
 * a fabricated "No attributed API requests yet." empty state. These pins
 * hold the adapter's full-fidelity mapping so that can never regress.
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md §6 P10.
 */

import { describe, it, expect, vi } from 'vitest';
import type { BehavioralEvidenceRow } from '../../src/repository/v2/dexie/dexie-database';
import type { SeedEvidenceRow } from '../../src/understanding/contract/api-seed-derivation';
import type { NetworkActivity } from '../../src/shared/behavioral-evidence-types';

// Stub the two dynamic imports the adapter performs (Dexie repos) BEFORE
// importing kr-data, so the adapter's reads run against controlled data.
const rowsBySession = new Map<string, BehavioralEvidenceRow[]>();

vi.mock('../../src/repository/v2/dexie/dexie-behavioral-evidence-repository', () => ({
  DexieBehavioralEvidenceRepository: class {
    constructor(_t: unknown) {}
    async getBySession(sessionId: string): Promise<BehavioralEvidenceRow[]> {
      return rowsBySession.get(sessionId) ?? [];
    }
  },
}));
vi.mock('../../src/repository/v2/dexie/dexie-database', () => ({
  createDatabase: () => ({ behavioralEvidence: {} }),
}));

// Dynamic-import AFTER mocks are registered (ESM hoisting-safe via vi.mock).
const { buildSeedEvidenceAccess } = await import('../../src/repository/kr-browser/kr-data');

function netRow(o: Partial<NetworkActivity> = {}): NetworkActivity {
  return {
    url: 'https://x.test/api/cart',
    method: 'POST',
    status: 200,
    startRelativeToEvent: 5,
    endRelativeToEvent: 90,
    durationMs: 85,
    resourceType: 'xhr',
    source: 'webrequest',
    sourceEventId: 'evt-9',
    ...o,
  } as NetworkActivity;
}

function evidenceRow(o: Partial<BehavioralEvidenceRow> = {}): BehavioralEvidenceRow {
  return {
    sourceEventId: 'evt-9',
    sourceEventType: 'click',
    windowId: 'bev-evt-9',
    frameId: 'main',
    window: { windowId: 'bev-evt-9' } as never,
    targetEvidence: {} as never,
    applicationEvidence: {
      navigation: [],
      domChanges: [],
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      networkActivity: [netRow()],
      resultingState: {
        items: [
          {
            kind: 'counter',
            matchedSelector: 'span[data-auto-id=cart-count]',
            text: '2',
            numericValue: 2,
            entityId: null,
            domPath: 'body > header > span',
          },
        ],
      } as never,
    } as never,
    interactionId: 'int-9',
    recordingSessionId: 'session-1',
    persistedAt: 100,
    ...o,
  } as BehavioralEvidenceRow;
}

describe('P10 — seed evidence adapter (full-fidelity mapping)', () => {
  it('carries networkActivity through (F-1 regression: [] fabricated empty seeds)', async () => {
    rowsBySession.set('session-1', [evidenceRow()]);
    const access = buildSeedEvidenceAccess();
    const rows: readonly SeedEvidenceRow[] = await access.getBySession('session-1');
    expect(rows.length).toBe(1);
    expect(rows[0].networkActivity.length).toBe(1);
    expect(rows[0].networkActivity[0]).toMatchObject({
      method: 'POST',
      status: 200,
      resourceType: 'xhr',
      source: 'webrequest',
      sourceEventId: 'evt-9',
    });
  });

  it('carries sourceEventId + interactionEventIds (CER exact-event join set)', async () => {
    rowsBySession.set('session-2', [evidenceRow({ recordingSessionId: 'session-2' })]);
    const access = buildSeedEvidenceAccess();
    const rows = await access.getBySession('session-2');
    expect(rows[0].sourceEventId).toBe('evt-9');
    expect([...rows[0].interactionEventIds]).toContain('evt-9');
  });

  it('carries resultingState items (post-condition derivation input)', async () => {
    rowsBySession.set('session-3', [evidenceRow({ recordingSessionId: 'session-3' })]);
    const access = buildSeedEvidenceAccess();
    const rows = await access.getBySession('session-3');
    expect(rows[0].resultingState?.items.length).toBe(1);
    expect(rows[0].resultingState?.items[0].kind).toBe('counter');
  });

  it('unknown session → [] (honest absence, no throw)', async () => {
    const access = buildSeedEvidenceAccess();
    expect(await access.getBySession('never')).toEqual([]);
  });

  it('row without applicationEvidence degrades to empty arrays, no throw', async () => {
    rowsBySession.set('session-4', [
      evidenceRow({ recordingSessionId: 'session-4', applicationEvidence: undefined as never }),
    ]);
    const access = buildSeedEvidenceAccess();
    const rows = await access.getBySession('session-4');
    expect(rows.length).toBe(1);
    expect(rows[0].networkActivity).toEqual([]);
  });
});

describe('P10b — getInteractionEventIds (CER join-set map)', () => {
  it('maps interactionId → real event ids from evidence rows (round-2 FAIL pin: never vacuous)', async () => {
    rowsBySession.set('session-10', [
      evidenceRow({ recordingSessionId: 'session-10' }),
      evidenceRow({
        recordingSessionId: 'session-10',
        windowId: 'bev-evt-11',
        sourceEventId: 'evt-11',
        interactionId: 'int-11',
      }),
    ]);
    const access = buildSeedEvidenceAccess();
    const map = await access.getInteractionEventIds('app-1', 'session-10');
    expect(map.size).toBe(2);
    expect(map.get('int-9')).toEqual(['evt-9']);
    expect(map.get('int-11')).toEqual(['evt-11']);
  });

  it('aggregates multiple evidence rows for the same interaction', async () => {
    rowsBySession.set('session-11', [
      evidenceRow({ recordingSessionId: 'session-11' }),
      evidenceRow({
        recordingSessionId: 'session-11',
        windowId: 'bev-evt-10',
        sourceEventId: 'evt-10',
      }),
    ]);
    const access = buildSeedEvidenceAccess();
    const map = await access.getInteractionEventIds('app-1', 'session-11');
    expect(map.size).toBe(1);
    expect(map.get('int-9')).toEqual(['evt-9', 'evt-10']);
  });

  it('unknown session → empty map (honest absence, no throw)', async () => {
    const access = buildSeedEvidenceAccess();
    const map = await access.getInteractionEventIds('app-1', 'never');
    expect(map.size).toBe(0);
  });

  it('join-set values match the frozen derivation contract (sourceEventId trigger only)', async () => {
    // api-seed-derivation.ts:330/:351 match networkActivity[].sourceEventId
    // against this set — values MUST be event ids, not interaction ids.
    rowsBySession.set('session-12', [
      evidenceRow({
        recordingSessionId: 'session-12',
        sourceEventId: 'evt-99',
        interactionId: 'int-99',
      }),
    ]);
    const access = buildSeedEvidenceAccess();
    const map = await access.getInteractionEventIds('app-1', 'session-12');
    expect(map.get('int-99')).toEqual(['evt-99']);
    expect(map.get('int-99')).not.toContain('int-99');
  });
});
