/**
 * Ledger Completion-Enrichment — regression tests
 * Spec: .drytis/specs/ledger-completion-enrichment.md
 *
 * Fixes two ledger-internal losses that emptied the Stop-time
 * status-enrichment sources for an owned requestId whose completion landed
 * after the commit-time attach:
 *   A) pushStamped's ownership early-return discarded completion pushes.
 *   B) attachToInteractions pruned entries whose owning row was still null.
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
import { enrichNetworkRowStatuses } from '../../../src/background/network-drain';
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
    requestId: 'R',
    ...overrides,
  };
}

function interaction(id: string, rows: Row[]): ComponentInteraction {
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
      window: { openedAt: 1000, closedAt: 1157, durationMs: 157, endReason: 'lifecycle-complete', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [],
        networkActivity: rows,
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
    requestId: 'R',
    sourceEventId: 'evt-int-14',
    ...overrides,
  } as StampedRequest;
}

// ── L-suite: ledger unit ──────────────────────────────────────────────

describe('Ledger completion-enrichment', () => {
  let ledger: DurableAttributionLedger;

  beforeEach(() => {
    storageData.clear();
    vi.clearAllMocks();
    ledger = new DurableAttributionLedger();
  });

  it('AC-A1: completion push after attach reaches snapshotStamped — kept-entry path', async () => {
    // T+0 capture
    await ledger.pushStamped(stamped({ status: 0 }));
    // T+157ms window close → interaction owns null row → commit-time attach marks R owned
    const rows = [row({ requestId: 'R', status: null })];
    const ints = [interaction('int-14', rows)];
    const attached = ledger.attachToInteractions(ints);
    expect(attached).toBe(0); // already owned → nothing attached
    // T+2s completion
    await ledger.pushStamped(stamped({ status: 200 }));

    const snap = ledger.snapshotStamped();
    const entry = snap.find((e) => e.requestId === 'R');
    expect(entry).toBeDefined();          // Fix B: pruned no more
    expect(entry!.status).toBe(200);      // Fix A: merge happened
    expect(snap.filter((e) => e.requestId === 'R')).toHaveLength(1);
  });

  it('AC-A2: real status never overwritten — late 302 after 200 stays 200', async () => {
    await ledger.pushStamped(stamped({ status: 0 }));
    const rows = [row({ requestId: 'R', status: null })];
    ledger.attachToInteractions([interaction('int-14', rows)]);
    await ledger.pushStamped(stamped({ status: 200 }));
    await ledger.pushStamped(stamped({ status: 302 }));

    const entry = ledger.snapshotStamped().find((e) => e.requestId === 'R');
    expect(entry!.status).toBe(200);
  });

  it('AC-A3: status-0 push for owned requestId remains a no-op (legacy)', async () => {
    await ledger.pushStamped(stamped({ status: 0 }));
    const rows = [row({ requestId: 'R', status: null })];
    ledger.attachToInteractions([interaction('int-14', rows)]);
    const before = ledger.snapshotStamped().find((e) => e.requestId === 'R');

    await ledger.pushStamped(stamped({ status: 0 }));

    const after = ledger.snapshotStamped().find((e) => e.requestId === 'R');
    expect(after?.status ?? 0).toBe(before?.status ?? 0); // still 0 / unchanged
    expect(ledger.snapshotStamped().filter((e) => e.requestId === 'R')).toHaveLength(1);
  });

  it('AC-B1: prune keeps null-owned entries, drops real-status-owned entries', async () => {
    // R-null: owning row still null → KEEP (sourceEventId matches int-14 so
    // the attach pass actually reaches the prune)
    await ledger.pushStamped(stamped({ requestId: 'R-null', status: 0, sourceEventId: 'evt-int-14' }));
    const nullRows = [row({ requestId: 'R-null', status: null })];
    ledger.attachToInteractions([interaction('int-14', nullRows)]);

    // R-real: owning row has real status → DROP (legacy cleanup unchanged)
    await ledger.pushStamped(stamped({ requestId: 'R-real', status: 0, sourceEventId: 'evt-int-15' }));
    const realRows = [row({ requestId: 'R-real', status: 200 })];
    ledger.attachToInteractions([interaction('int-15', realRows)]);

    const snap = ledger.snapshotStamped();
    expect(snap.some((e) => e.requestId === 'R-null')).toBe(true);   // kept
    expect(snap.some((e) => e.requestId === 'R-real')).toBe(false);  // pruned
  });

  it('AC-B2: kept entries are never re-attached — second attach call attaches nothing new', async () => {
    await ledger.pushStamped(stamped({ status: 0 }));
    const rows = [row({ requestId: 'R', status: null })];
    const ints = [interaction('int-14', rows)];
    const first = ledger.attachToInteractions(ints);
    const rowLengthAfterFirst = rows.length;

    const second = ledger.attachToInteractions(ints);

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(rows.length).toBe(rowLengthAfterFirst); // no duplicate row
  });

  it('AC-B3: acknowledge()/clearAll() still remove kept entries (no leak)', async () => {
    await ledger.pushStamped(stamped({ status: 0 }));
    const rows = [row({ requestId: 'R', status: null })];
    ledger.attachToInteractions([interaction('int-14', rows)]);
    await ledger.pushStamped(stamped({ status: 200 }));
    expect(ledger.snapshotStamped().some((e) => e.requestId === 'R')).toBe(true);

    await ledger.clearAll();
    expect(ledger.snapshotStamped()).toHaveLength(0);
  });

  it('AC-END: end-to-end Stop shape — null-status row upgraded to 200 via snapshot', async () => {
    // Full timeline: capture → own (null row) → attach(prune-safe) →
    // completion → Stop enrichment consumes snapshotStamped()
    await ledger.pushStamped(stamped({ status: 0, requestBody: { ASIN: 'B0FQFV2XKS' } }));
    const rows = [row({ requestId: 'R', status: null })];
    const ints = [interaction('int-14', rows)];
    ledger.attachToInteractions(ints);
    await ledger.pushStamped(stamped({ status: 200 }));

    const { enriched } = enrichNetworkRowStatuses(ints, {
      ledger: ledger.snapshotStamped(),
    });

    expect(rows[0].status).toBe(200);
    expect(enriched).toEqual([{ interactionId: 'int-14', requestId: 'R', from: null, to: 200 }]);
  });
});
