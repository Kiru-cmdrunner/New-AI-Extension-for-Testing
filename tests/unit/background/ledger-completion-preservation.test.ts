/**
 * Ledger completion-preservation — regression tests (spec:
 * .drytis/specs/ledger-completion-preservation.md)
 *
 * Invariant: an attached stamped entry leaves the ledger only when the
 * owning interaction's row for that requestId already has a REAL status.
 *
 * Root-cause chain (session 3): start-row (status null, no body) attaches
 * → ownership gate discards onCompleted(200) push → pruneKey removes the
 * in-memory entry → snapshotStamped (enrichment source) sees nothing →
 * M9 gets null status → no API vote → incomplete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock chrome.storage.local ─────────────────────────────────────────
const storageData = new Map<string, unknown>();
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const out: Record<string, unknown> = {};
        // Handle BOTH shapes: the ledger calls get(key) with a string and
        // tests sometimes pass an array.
        const list = typeof keys === 'string' ? [keys] : keys;
        for (const k of list) if (storageData.has(k)) out[k] = storageData.get(k);
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
import { enrichNetworkRowStatuses } from '../../../src/background/network-drain';
import type { ComponentInteraction } from '../../../src/shared/component-types';

type Row = { url: string; method: string; status: number | null; requestId?: string; [k: string]: unknown };

function row(overrides: Partial<Row> = {}): Row {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: null,
    requestId: '6053',
    startRelativeToEvent: 5, endRelativeToEvent: null, durationMs: null,
    resourceType: 'unknown', source: 'webrequest',
    ...overrides,
  };
}

/** Interaction already OWNING a null-status row for requestId (bridge shape). */
function ownerWithNullRow(id = 'int-14', requestId = '6053'): ComponentInteraction {
  const eventId = `evt-${id.replace(/^int-/, '')}`;
  return {
    interactionId: id,
    type: 'Click',
    trigger: { kind: 'element', tagName: 'INPUT', accessibleName: 'Add to cart' },
    triggerEvent: { eventId, eventType: 'click' },
    memberEvents: [], startTime: 1000, endTime: 1157, endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: eventId, sourceEventType: 'click',
      windowId: `w-${id.replace(/^int-/, '')}`, frameId: 'main',
      window: { openedAt: 1000, closedAt: 1157, durationMs: 157, endReason: 'lifecycle-complete', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [], navigation: [],
        networkActivity: [row({ requestId })], // status: null — THE frozen row
        performanceCondition: { mainThreadBlocked: false, highChurnMode: false, longestBatchMs: 0, totalBatches: 0 },
      },
    },
  } as unknown as ComponentInteraction;
}

function stamped(overrides: Partial<StampedRequest> = {}): StampedRequest {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: 0,
    requestId: '6053',
    sourceEventId: 'evt-14',
    mainFrame: true,
    ...overrides,
  } as StampedRequest;
}

let ledger: DurableAttributionLedger;

beforeEach(() => {
  storageData.clear();
  vi.clearAllMocks();
  ledger = new DurableAttributionLedger();
});

describe('Ledger completion-preservation', () => {
  it('P1: completion push (status>0) survives the ownership gate — merges into the stored entry', async () => {
    const owner = ownerWithNullRow();
    // at-capture durable write (onBeforeRequest)
    await ledger.pushStamped(stamped({ status: 0 }));
    // bridge row attaches → ownership marks 6053 (simulates commit-time attach path)
    ledger.attachToInteractions([owner]);

    // onCompleted(200) — the push that used to die at the ownership gate
    await ledger.pushStamped(stamped({ status: 200 }));

    const snap = ledger.snapshotStamped();
    const e = snap.find((s) => s.requestId === '6053');
    expect(e).toBeDefined();
    expect(e!.status).toBe(200);
  });

  it('P1b: completion push after PRUNE re-inserts a held entry (in-memory map source)', async () => {
    const owner = ownerWithNullRow();
    await ledger.pushStamped(stamped({ status: 0 }));
    ledger.attachToInteractions([owner]); // prunes the (attached) entry

    await ledger.pushStamped(stamped({ status: 200 }));

    const snap = ledger.snapshotStamped();
    const e = snap.find((s) => s.requestId === '6053');
    expect(e).toBeDefined();
    expect(e!.status).toBe(200);
  });

  it('P2: pruneKey PRESERVES an attached entry whose owning row is null-status; drops it when the row has a real status', async () => {
    // Null-status owner → entry must survive the prune
    const ownerNull = ownerWithNullRow('int-a', 'r-a');
    await ledger.pushStamped(stamped({ requestId: 'r-a', sourceEventId: 'evt-a', status: 200 }));
    ledger.attachToInteractions([ownerNull]);
    // r-a was skipped (owned) — but the prune must NOT remove it
    let snap = ledger.snapshotStamped();
    expect(snap.some((s) => s.requestId === 'r-a')).toBe(true);

    // Real-status owner → entry may leave (legacy leave semantics)
    const ownerDone = ownerWithNullRow('int-b', 'r-b');
    (ownerDone.behavioralEvidence!.applicationEvidence!.networkActivity![0] as unknown as Row).status = 200;
    // A null-status push would be the legacy no-op after ownership… the
    // attach pass itself decides via the OWNING ROW's status.
    await ledger.pushStamped(stamped({ requestId: 'r-b', sourceEventId: 'evt-b', status: 0 }));
    ledger.attachToInteractions([ownerDone]);
    snap = ledger.snapshotStamped();
    expect(snap.some((s) => s.requestId === 'r-b')).toBe(false);
  });

  it('P3: completion-reinserted entries are not re-attached, not acked, and cleared by clearAll', async () => {
    const owner = ownerWithNullRow();
    await ledger.pushStamped(stamped({ status: 0 }));
    ledger.attachToInteractions([owner]);
    await ledger.pushStamped(stamped({ status: 200 })); // re-inserts held entry

    const rowsBefore = owner.behavioralEvidence!.applicationEvidence!.networkActivity!.length;
    const attached = ledger.attachToInteractions([owner]);
    expect(attached).toBe(0);
    expect(owner.behavioralEvidence!.applicationEvidence!.networkActivity!.length).toBe(rowsBefore);

    ledger.acknowledgePersisted();
    expect(ledger.snapshotStamped().some((s) => s.requestId === '6053')).toBe(true);

    await ledger.clearAll();
    expect(ledger.snapshotStamped().some((s) => s.requestId === '6053')).toBe(false);
  });

  it('P4: end-to-end stop shape — held completion upgrades the frozen row via enrichNetworkRowStatuses', async () => {
    const owner = ownerWithNullRow();
    await ledger.pushStamped(stamped({ status: 0 }));
    ledger.attachToInteractions([owner]);            // ownership + prune
    await ledger.pushStamped(stamped({ status: 200 })); // onCompleted — held completion

    const res = enrichNetworkRowStatuses([owner], { ledger: ledger.snapshotStamped() });
    expect(res.enriched).toEqual([{ interactionId: 'int-14', requestId: '6053', from: null, to: 200 }]);
    const r = owner.behavioralEvidence!.applicationEvidence!.networkActivity![0] as unknown as Row;
    expect(r.status).toBe(200);
  });

  it('P5: rehydrate crash-point-A keeps stored entries whose owning rows are null-status', async () => {
    // Simulate durable store content: entry attached pre-crash, row null.
    const owner = ownerWithNullRow();
    storageData.set('cmdrunner_unattached_requests', {
      'evt-14': [stamped({ status: 200 })],
    });
    await ledger.rehydrate([owner]);
    // owning row is null-status → entry must REMAIN as a completion source
    expect(ledger.snapshotStamped().some((s) => s.requestId === '6053')).toBe(true);
    expect((owner.behavioralEvidence!.applicationEvidence!.networkActivity!.length)).toBe(1); // not re-attached
  });

  it('P6: pendingAck admission respects the invariant (null-status owning row keeps the durable copy)', async () => {
    // Fresh interaction WITHOUT a row — the ledger entry attaches (creates
    // a synthesized row). The synthesized row inherits the entry status (0
    // → null via toNetworkActivity) → NOT admitted to pendingAck.
    const noRow = { ...ownerWithNullRow('int-c', 'unused') } as unknown as ComponentInteraction;
    (noRow.behavioralEvidence as any).applicationEvidence.networkActivity = [];
    await ledger.pushStamped(stamped({ requestId: 'r-c', sourceEventId: 'evt-c', status: 0 }));

    const attached = ledger.attachToInteractions([noRow]);
    expect(attached).toBe(1);
    // Row synthesized with status null (0 → null) → durable copy must stay
    ledger.acknowledgePersisted();
    expect(ledger.snapshotStamped().some((s) => s.requestId === 'r-c')).toBe(true);
  });

  it('P7: no downgrade through any path — stored 200 stays 200 against later 0/302 pushes', async () => {
    await ledger.pushStamped(stamped({ status: 200 }));
    await ledger.pushStamped(stamped({ status: 302 }));
    await ledger.pushStamped(stamped({ status: 0 }));
    expect(ledger.snapshotStamped().find((s) => s.requestId === '6053')!.status).toBe(200);
  });
});
