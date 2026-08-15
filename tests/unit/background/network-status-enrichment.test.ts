/**
 * Network Status-Enrichment — regression tests (spec:
 * .drytis/specs/network-status-enrichment.md)
 *
 * Stop-time requestId-keyed upgrade of null-status networkActivity rows,
 * using the durable attribution ledger (merge-enriched) and the completed-
 * requests ring as sources. Exactly-once ROW semantics preserved: no row
 * is added/removed/reordered; only an existing null status may upgrade.
 *
 * E1–E4c: enrichNetworkRowStatuses (pure, network-drain.ts)
 * L1–L3:  DurableAttributionLedger.pushStamped merge contract
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock chrome.storage.local (in-memory map, mirrors attribution suite) ──
const storageData = new Map<string, unknown>();
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (storageData.has(k)) out[k] = storageData.get(k);
        return out;
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) storageData.set(k, v);
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const k of keys) storageData.delete(k);
      }),
    },
  },
  runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
};

import { DurableAttributionLedger } from '../../../src/background/evidence-attribution';
import type { StampedRequest } from '../../../src/background/evidence-attribution';
import {
  enrichNetworkRowStatuses,
} from '../../../src/background/network-drain';
import type { DrainEntry } from '../../../src/background/network-drain';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { NetworkActivity } from '../../../src/shared/behavioral-evidence-types';

type Row = NetworkActivity & { requestId?: string };

// ── Fixtures ──────────────────────────────────────────────────────────

function row(overrides: Partial<Row> = {}): Row {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: null,
    startRelativeToEvent: 5,
    endRelativeToEvent: null,
    durationMs: null,
    resourceType: 'unknown',
    source: 'webrequest',
    requestId: '4353',
    ...overrides,
  };
}

function interaction(id: string, rows: Row[], opts?: { endReason?: string }): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click',
    trigger: { kind: 'element', tagName: 'INPUT', accessibleName: 'Add to cart' },
    triggerEvent: { eventId: `evt-${id}`, eventType: 'click' },
    memberEvents: [],
    startTime: 1000,
    endTime: 1157,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      sourceEventType: 'click',
      windowId: `w-${id}`,
      frameId: 'main',
      window: {
        openedAt: 1000, closedAt: 1157, durationMs: 157,
        endReason: opts?.endReason ?? 'lifecycle-complete',
        stabilityTrace: [],
      },
      targetEvidence: {
        identity: null, identityCapturedAt: 0,
        before: null, after: null, focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [],
        networkActivity: rows,
        performanceCondition: {
          mainThreadBlocked: false, highChurnMode: false,
          longestBatchMs: 0, totalBatches: 0,
        },
      },
    },
  } as unknown as ComponentInteraction;
}

function ledgerEntry(overrides: Partial<StampedRequest> = {}): StampedRequest {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: 200,
    requestId: '4353',
    sourceEventId: 'evt-int-1',
    ...overrides,
  } as StampedRequest;
}

function ringEntry(overrides: Partial<DrainEntry> = {}): DrainEntry {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: 200,
    requestId: '4353',
    sourceEventId: 'evt-int-1',
    ...overrides,
  };
}

// ── E: enrichNetworkRowStatuses ───────────────────────────────────────

describe('enrichNetworkRowStatuses', () => {
  it('E1: null-status row upgraded from ledger; count/order unchanged; audit from null to 200', () => {
    const rows = [row({ requestId: 'r-a', status: null }), row({ requestId: 'r-b', status: 404 })];
    const before = [...rows];
    const i = interaction('int-1', rows);
    const interactions = [i];

    const res = enrichNetworkRowStatuses(interactions, {
      ledger: [ledgerEntry({ requestId: 'r-a', status: 200 })],
    });

    expect(rows[0].status).toBe(200);           // upgraded
    expect(rows[1].status).toBe(404);           // untouched
    expect(rows.length).toBe(2);                // no row added/removed
    expect(rows).toEqual(before.map((r, idx) => idx === 0 ? { ...r, status: 200 } : r));
    expect(res.enriched).toEqual([{ interactionId: 'int-1', requestId: 'r-a', from: null, to: 200 }]);
    expect(res.updatedInteractions).toContain(i);
  });

  it('E2: already-owned null row + ring completion → upgraded IN PLACE, no second row (exactly-once preserved)', () => {
    const rows = [row({ requestId: 'r1', status: null })];
    const i = interaction('int-1', rows);

    const res = enrichNetworkRowStatuses([i], {
      ring: [ringEntry({ requestId: 'r1', status: 200 })],
    });

    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(200);
    expect(res.enriched).toHaveLength(1);
  });

  it('E3a: real statuses never downgraded/overwritten (302/0/absent offered)', () => {
    const rows = [
      row({ requestId: 'r-ok', status: 200 }),
      row({ requestId: 'r-302', status: 302 }),
    ];
    const i = interaction('int-1', rows);

    const res = enrichNetworkRowStatuses([i], {
      ledger: [
        ledgerEntry({ requestId: 'r-ok', status: 302 }),
        ledgerEntry({ requestId: 'r-302', status: 0 }),
      ],
      ring: [ringEntry({ requestId: 'r-ok', status: 500 })],
    });

    expect(rows[0].status).toBe(200); // not downgraded by ledger 302 / ring 500
    expect(rows[1].status).toBe(302); // not downgraded by ledger 0
    expect(res.enriched).toEqual([]);
  });

  it('E3b: ledger wins over ring on conflict (deterministic precedence)', () => {
    const rows = [row({ requestId: 'r1', status: null })];
    const i = interaction('int-1', rows);

    enrichNetworkRowStatuses([i], {
      ledger: [ledgerEntry({ requestId: 'r1', status: 201 })],
      ring: [ringEntry({ requestId: 'r1', status: 200 })],
    });

    expect(rows[0].status).toBe(201);
  });

  it('E3c: source status 0 (error/incomplete sentinel) never enriches — row stays null', () => {
    const rows = [row({ requestId: 'r1', status: null })];
    const i = interaction('int-1', rows);

    const res = enrichNetworkRowStatuses([i], {
      ledger: [ledgerEntry({ requestId: 'r1', status: 0 })],
      ring: [ringEntry({ requestId: 'r1', status: 0 })],
    });

    expect(rows[0].status).toBeNull();
    expect(res.enriched).toEqual([]);
  });

  it('E4a: Amazon page-destruction shape — bridge-delivered null row enriched via ledger (ring empty)', () => {
    // The exact int-17 shape: real requestId, lifecycle-complete window,
    // start-phase row (status null), page destroyed before completion
    // delivery; ledger merge (Part 1) already holds the completion status.
    const rows = [row({ requestId: '4353', status: null })];
    const i = interaction('int-click', rows, { endReason: 'lifecycle-complete' });

    const res = enrichNetworkRowStatuses([i], {
      ledger: [ledgerEntry({ requestId: '4353', status: 200, sourceEventId: 'evt-int-click' })],
    });

    expect(rows[0].status).toBe(200);
    expect(res.enriched[0]).toMatchObject({ requestId: '4353', from: null, to: 200 });
  });

  it('E4b: SW-restart edge — ring entry without sourceEventId still enriches by requestId', () => {
    const rows = [row({ requestId: 'r1', status: null })];
    const i = interaction('int-1', rows);

    enrichNetworkRowStatuses([i], {
      ledger: [], // ledger lost/restarted — status still 0 there, offer nothing real
      ring: [ringEntry({ requestId: 'r1', status: 200, sourceEventId: undefined })],
    });

    expect(rows[0].status).toBe(200);
  });

  it('E4c: synthetic-nav interactions, requestId-less rows, and fake stamped ids are untouched', () => {
    const rows = [
      row({ requestId: undefined, status: null }),            // no id → never touched
      row({ requestId: 'POST:example.com/x:stamped', status: null }), // fake id → no match
    ];
    const click = interaction('int-click', [row({ requestId: 'real-1', status: null })]);
    const nav = interaction('int-nav', [], { endReason: 'page-reload-synthetic' });

    const res = enrichNetworkRowStatuses([click, nav], {
      ledger: [
        ledgerEntry({ requestId: 'real-1', status: 200 }),
        ledgerEntry({ requestId: 'POST:example.com/x:stamped', status: 500 }),
      ],
    });

    expect(click.behavioralEvidence!.applicationEvidence!.networkActivity![0].status).toBe(200);
    expect(rows[0].status).toBeNull();
    expect(rows[1].status).toBeNull();
    expect(res.enriched).toHaveLength(1);
  });

  it('E4c-2: a synthetic-nav interaction WITH a null-status row (defensive) is still enrichable — row upgrade only, no attribution change', () => {
    // Defensive shape: if any path ever left a row on a synthetic nav, the
    // pass upgrades the ROW only; it does not move/add attribution.
    const navRows = [row({ requestId: 'r-nav', status: null })];
    const nav = interaction('int-nav', navRows, { endReason: 'page-reload-synthetic' });

    const res = enrichNetworkRowStatuses([nav], {
      ledger: [ledgerEntry({ requestId: 'r-nav', status: 200 })],
    });

    expect(navRows[0].status).toBe(200);
    expect(navRows.length).toBe(1);
    expect(res.enriched).toHaveLength(1);
  });
});

// ── L: ledger merge contract (Part 1) ─────────────────────────────────

describe('DurableAttributionLedger.pushStamped merge (status enrichment)', () => {
  let ledger: DurableAttributionLedger;

  beforeEach(() => {
    storageData.clear();
    vi.clearAllMocks();
    ledger = new DurableAttributionLedger();
  });

  it('L1: duplicate push with real status upgrades stored status-0 entry; single entry; FIFO preserved; persist fires', async () => {
    const key = 'evt-click-1';
    await ledger.pushStamped(ledgerEntry({ requestId: 'r1', status: 0, sourceEventId: key, requestBody: { ASIN: 'B0FQFV2XKS' } }));
    const setCallsAfterFirst = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;

    // onCompleted enrichment (network-observation.ts:1066 shape)
    await ledger.pushStamped(ledgerEntry({ requestId: 'r1', status: 200, sourceEventId: key }));

    const snap = ledger.snapshotStamped();
    expect(snap).toHaveLength(1);                 // merged, not duplicated
    expect(snap[0].status).toBe(200);             // upgraded from 0
    expect(snap[0].requestBody).toEqual({ ASIN: 'B0FQFV2XKS' }); // preserved
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(setCallsAfterFirst);       // durability write-through fired

    // FIFO preserved: a second entry's order is unaffected by the merge
    await ledger.pushStamped(ledgerEntry({ requestId: 'r2', status: 0, sourceEventId: key }));
    const snap2 = ledger.snapshotStamped();
    expect(snap2.map((e) => e.requestId)).toEqual(['r1', 'r2']);
  });

  it('L2: stored real status never overwritten — late status-0 push stays 200', async () => {
    await ledger.pushStamped(ledgerEntry({ requestId: 'r1', status: 200, sourceEventId: 'evt-click-1' }));
    await ledger.pushStamped(ledgerEntry({ requestId: 'r1', status: 0, sourceEventId: 'evt-click-1' }));

    const snap = ledger.snapshotStamped();
    expect(snap).toHaveLength(1);
    expect(snap[0].status).toBe(200); // not downgraded
  });

  it('L3: fill-absent merge — second push adds missing fields, never clobbers existing', async () => {
    await ledger.pushStamped(ledgerEntry({
      requestId: 'r1', status: 0, sourceEventId: 'evt-click-1',
      requestBody: { keep: 'me' },
    }));
    await ledger.pushStamped(ledgerEntry({
      requestId: 'r1', status: 200, sourceEventId: 'evt-click-1',
      requestBody: { other: 'value' },      // different — must NOT clobber
      captureOrigin: { tabId: 7, frameId: 0 }, // absent — must be filled
    }));

    const snap = ledger.snapshotStamped();
    expect(snap).toHaveLength(1);
    expect(snap[0].status).toBe(200);
    expect(snap[0].requestBody).toEqual({ keep: 'me' });   // preserved
    expect(snap[0].captureOrigin).toEqual({ tabId: 7, frameId: 0 }); // filled
  });
});
