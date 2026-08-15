/**
 * Evidence Attribution — Unit Tests (Durable Attribution spec)
 *
 * T1–T5 and T11–T16 from .drytis/specs/form-submit-evidence-recovery.md.
 * Covers the DurableAttributionLedger (write-through chrome.storage.local,
 * rehydrate, acknowledge), RequestOwnershipLedger (exactly-once authority),
 * resolveInteractionForEventId (two-tier identity join), and
 * synthesizeMinimalEvidence (thin evidence for evidence-less clicks).
 *
 * Invariants verified: INV-1..INV-3, INV-8, durability gate/load,
 * session scoping, event-driven recovery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { NetworkActivity } from '../../../src/shared/behavioral-evidence-types';

// ── Mock chrome.storage.local (in-memory map + change events) ────────

const storageData = new Map<string, unknown>();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(storageData);
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (storageData.has(k)) out[k] = storageData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageData.set(k, v);
      }),
      // Non-async body: effect applies synchronously so fire-and-forget
      // acknowledgments are observable without awaiting microtasks.
      remove: vi.fn((keys: string | string[] | null) => {
        if (keys === null) {
          storageData.clear();
          return Promise.resolve();
        }
        for (const k of Array.isArray(keys) ? keys : [keys]) storageData.delete(k);
        return Promise.resolve();
      }),
    },
  },
});

import {
  DurableAttributionLedger,
  RequestOwnershipLedger,
  resolveInteractionForEventId,
  synthesizeMinimalEvidence,
} from '../../../src/background/evidence-attribution';
import {
  // Ring eviction constants imported as VALUES to prove they are unchanged
  // (INV-6: stamped recovery never depends on them). Re-exported through
  // network-observation — importing them here pins the production values.
  COMPLETED_BUFFER_TTL_MS,
  MAX_COMPLETED_ENTRIES,
} from '../../../src/background/network-observation';

const STORAGE_KEY = 'cmdrunner_unattached_requests';

// ── Fixtures ─────────────────────────────────────────────────────────

function makeClickInteraction(
  eventId = 'evt-click-1',
  id = 'int-1',
  withEvidence = false,
  memberEventIds: string[] = [],
): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click' as never,
    trigger: {
      kind: 'element',
      tagName: 'INPUT',
      id: 'add-to-cart-button',
      accessibleName: 'Add to cart',
      attributes: { type: 'submit' },
    } as never,
    triggerEvent: { eventId, eventType: 'click' } as never,
    memberEvents: memberEventIds.map((e) => ({ eventId: e, eventType: 'click' })) as never,
    startTime: 1_000,
    endTime: 1_100,
    endState: 'completed' as never,
    metadata: {},
    behavioralEvidence: withEvidence
      ? ({
          sourceEventId: eventId,
          sourceEventType: 'click',
          windowId: 'ev-evt-click-1',
          frameId: 'main',
          window: {
            openedAt: 0,
            closedAt: 100,
            durationMs: 100,
            endReason: 'stabilized',
            stabilityTrace: [],
          },
          targetEvidence: {
            identity: null,
            identityCapturedAt: 0,
            before: null,
            after: null,
            focusMovement: null,
          },
          applicationEvidence: {
            domChanges: [],
            domChangeOverflow: 0,
            coarseMode: false,
            newSurfaces: [],
            removedSurfaces: [],
            visibilityChanges: [],
            navigation: [],
            networkActivity: [],
            performanceCondition: {
              mainThreadBlocked: false,
              highChurnMode: false,
              longestBatchMs: 0,
              totalBatches: 0,
            },
          },
        } as never)
      : undefined,
  };
}

interface LedgerEntry extends Record<string, unknown> {
  url: string;
  method: string;
  status: number;
  requestId: string;
  sourceEventId?: string;
  requestBody?: Record<string, string>;
  documentRequest?: boolean;
  mainFrame?: boolean;
}

function makePostEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    url: 'https://www.amazon.in/cart/add',
    method: 'POST',
    status: 302,
    requestId: 'R1',
    sourceEventId: 'evt-click-1',
    requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
    documentRequest: true,
    mainFrame: true,
    ...overrides,
  };
}

// ── Test suites ──────────────────────────────────────────────────────

let ledger: DurableAttributionLedger;

beforeEach(() => {
  storageData.clear();
  vi.clearAllMocks();
  ledger = new DurableAttributionLedger();
});

describe('DurableAttributionLedger', () => {
  it('T1a: write-through — pushStamped durably persists to chrome.storage.local under the UNATTACHED_REQUESTS key', async () => {
    await ledger.pushStamped(makePostEntry());

    // The set call must have happened, to the right key, with the entry.
    expect(chrome.storage.local.set).toHaveBeenCalled();
    const stored = storageData.get(STORAGE_KEY) as Record<string, LedgerEntry[]>;
    expect(stored['evt-click-1']).toBeDefined();
    expect(stored['evt-click-1'][0].requestId).toBe('R1');
  });

  it('T1b: capture → attach — stamped POST attaches to evidence-less click, evidence synthesized; store empties only after ack', async () => {
    await ledger.pushStamped(makePostEntry());
    const click = makeClickInteraction('evt-click-1', 'int-1', false);

    const attached = ledger.attachToInteractions([click]);

    expect(attached).toBe(1);
    expect(click.behavioralEvidence).toBeDefined();
    const net = click.behavioralEvidence!.applicationEvidence.networkActivity as
      (NetworkActivity & { requestId?: string })[];
    expect(net).toHaveLength(1);
    expect(net[0].requestId).toBe('R1');
    expect(net[0].sourceEventId).toBe('evt-click-1');
    expect(net[0].requestBody).toEqual({ ASIN: 'B08KGRVW2S', quantity: '1' });
    // End-reason marks the SW recovery path
    expect(click.behavioralEvidence!.window.endReason).toBe('sw-recovered-form-submit');
    // Delete-after-persist: still durable until the caller acknowledges
    const staged = storageData.get(STORAGE_KEY) as Record<string, LedgerEntry[]> | undefined;
    expect(staged?.['evt-click-1']).toBeDefined();
    ledger.acknowledgePersisted(); // caller persisted LIVE_INTERACTIONS → ack
    await Promise.resolve();
    expect(storageData.has(STORAGE_KEY)).toBe(false);
  });

  it('T1c: awaiting pushStamped is the durability gate — the promise resolves only after the storage write', async () => {
    let resolveSet: (() => void) | null = null;
    const setCall = new Promise<void>((r) => (resolveSet = r));
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      await setCall;
    });

    const push = ledger.pushStamped(makePostEntry());
    // storage.set not yet resolved → the push promise must not have settled
    let settled = false;
    push.then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSet!();
    await push;
    expect(settled).toBe(true);
  });

  it('T1d: storage write failure degrades to memory-only and does not throw', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('QUOTA_BYTES'),
    );
    await expect(ledger.pushStamped(makePostEntry())).resolves.toBeUndefined();

    // Still attachable in-memory
    const click = makeClickInteraction('evt-click-1');
    expect(ledger.attachToInteractions([click])).toBe(1);
  });

  it('T2: tier-2 join — stamp resolves via memberEvents when triggerEvent does not match', async () => {
    await ledger.pushStamped(makePostEntry({ sourceEventId: 'evt-member-b', requestId: 'R2' }));
    // Trigger evt-click-1 does not match; memberEvents = [evt-member-a, evt-member-b]
    const click = makeClickInteraction('evt-click-1', 'int-2', false, [
      'evt-member-a',
      'evt-member-b',
    ]);

    expect(ledger.attachToInteractions([click])).toBe(1);
    expect((click.behavioralEvidence!.applicationEvidence.networkActivity[0] as { requestId?: string }).requestId).toBe('R2');
  });

  it('T3: exactly-once — same requestId cannot attach twice, to the same or a different interaction', async () => {
    await ledger.pushStamped(makePostEntry({ requestId: 'R-DUP' }));
    const clickA = makeClickInteraction('evt-click-1', 'int-a');
    const clickB = makeClickInteraction('evt-click-1', 'int-b');

    expect(ledger.attachToInteractions([clickA])).toBe(1);
    // Second attach attempt — same interaction
    expect(ledger.attachToInteractions([clickA])).toBe(0);
    // Different interaction sharing the same sourceEventId
    expect(ledger.attachToInteractions([clickB])).toBe(0);
    expect(clickB.behavioralEvidence?.applicationEvidence.networkActivity ?? []).toHaveLength(0);
  });

  it('T4: no-TTL — stamped entries survive in the ledger regardless of age (no clock participation)', async () => {
    await ledger.pushStamped(makePostEntry());
    // No time argument anywhere: attachment works "60s later" by construction.
    // Advance every clock to prove no hidden dependency.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    const click = makeClickInteraction('evt-click-1');
    expect(ledger.attachToInteractions([click])).toBe(1);
    vi.useRealTimers();
  });

  it('T4b: ring TTL untouched — unstamped entries are never durable (INV-6)', async () => {
    // The ledger only accepts stamped entries — the ring's 10s TTL remains
    // the sole mechanism for UNSTAMPED captures, and stamped data never
    // depends on it (the ledger has no TTL — proven by T4).
    await ledger.pushStamped({ ...makePostEntry(), sourceEventId: undefined });
    expect(storageData.has(STORAGE_KEY)).toBe(false);

    // The ring's production eviction constants are unchanged (INV-6).
    expect(COMPLETED_BUFFER_TTL_MS).toBe(10_000);
    expect(MAX_COMPLETED_ENTRIES).toBe(100);
  });

  it('T5: telemetry exemption — stamped main-frame POST to telemetry-shaped URL attaches', async () => {
    await ledger.pushStamped(
      makePostEntry({ url: 'https://www.amazon.in/1/batch/uedata/n/1', requestId: 'R-T' }),
    );
    const click = makeClickInteraction('evt-click-1');
    expect(ledger.attachToInteractions([click])).toBe(1);
    expect(click.behavioralEvidence!.applicationEvidence.networkActivity[0].url).toContain('/uedata');
  });
});

describe('DurableAttributionLedger — boot reconciliation (T11–T16)', () => {
  it('T11: SW-restart recovery — rehydrate attaches stored entries; store empties after persist+ack', async () => {
    // Simulate: previous SW wrote the entry then died before attaching
    storageData.set(STORAGE_KEY, {
      'evt-click-1': [makePostEntry()],
    });
    const click = makeClickInteraction('evt-click-1');

    const result = await ledger.rehydrate([click]);

    expect(result.attached.length).toBe(1);
    expect((click.behavioralEvidence!.applicationEvidence.networkActivity[0] as { requestId?: string }).requestId).toBe('R1');
    // Delete-after-persist: still durable until the caller acks
    expect(storageData.get(STORAGE_KEY)).toBeDefined();
    ledger.acknowledgePersisted();
    await Promise.resolve();
    expect(storageData.has(STORAGE_KEY)).toBe(false); // emptied after ack
  });

  it('T12: crash-point A — already attached but not acked; rehydrate must not duplicate', async () => {
    const click = makeClickInteraction('evt-click-1', 'int-1', true);
    // Ownership rebuild source: the interaction's existing networkActivity
    (click.behavioralEvidence!.applicationEvidence.networkActivity as never[]).push({
      url: 'https://www.amazon.in/cart/add',
      method: 'POST',
      status: 302,
      startRelativeToEvent: 0,
      endRelativeToEvent: null,
      durationMs: null,
      resourceType: 'unknown',
      source: 'webrequest',
      requestBody: { ASIN: 'B08KGRVW2S' },
      sourceEventId: 'evt-click-1',
      requestId: 'R1',
    } as never);
    storageData.set(STORAGE_KEY, { 'evt-click-1': [makePostEntry()] });

    const result = await ledger.rehydrate([click]);

    expect(result.attached).toHaveLength(0);
    const net = click.behavioralEvidence!.applicationEvidence.networkActivity as
      (NetworkActivity & { requestId?: string })[];
    expect(net).toHaveLength(1); // not duplicated
    expect(storageData.has(STORAGE_KEY)).toBe(false); // cleaned up
  });

  it('T13: crash-point B — stored but never attached; final state identical to no-crash', async () => {
    storageData.set(STORAGE_KEY, { 'evt-click-1': [makePostEntry()] });

    const crash = makeClickInteraction('evt-click-1');
    const noCrash = makeClickInteraction('evt-click-1');

    await ledger.rehydrate([crash]);
    const fresh = new DurableAttributionLedger();
    await fresh.pushStamped(makePostEntry());
    fresh.attachToInteractions([noCrash]);

    expect(crash.behavioralEvidence!.applicationEvidence.networkActivity.length).toBe(
      noCrash.behavioralEvidence!.applicationEvidence.networkActivity.length,
    );
    expect(
      (crash.behavioralEvidence!.applicationEvidence.networkActivity[0] as { requestId?: string }).requestId,
    ).toBe(
      (noCrash.behavioralEvidence!.applicationEvidence.networkActivity[0] as { requestId?: string }).requestId,
    );
    expect(crash.behavioralEvidence!.window.endReason).toBe(
      noCrash.behavioralEvidence!.window.endReason,
    );
  });

  it('T14: pre-capture durability — stamped main_frame POST written at onBeforeRequest with status null', async () => {
    await ledger.pushStamped(
      makePostEntry({ status: 0, statusExplicitlyNull: undefined, url: 'https://www.amazon.in/gp/add-to-cart', requestId: 'R-PRE' }),
    );
    // Directly inspect the durable store before any completion event
    const stored = storageData.get(STORAGE_KEY) as Record<string, LedgerEntry[]>;
    expect(stored['evt-click-1'][0].url).toBe('https://www.amazon.in/gp/add-to-cart');
    // Attach without any onCompleted enrichment still succeeds
    const click = makeClickInteraction('evt-click-1');
    expect(ledger.attachToInteractions([click])).toBe(1);
    expect((click.behavioralEvidence!.applicationEvidence.networkActivity[0] as { requestId?: string }).requestId).toBe('R-PRE');
  });

  it('T15: session-end cleanup — clearAll empties the durable store', async () => {
    await ledger.pushStamped(makePostEntry());
    await ledger.pushStamped(makePostEntry({ sourceEventId: 'evt-other', requestId: 'R2' }));
    expect(storageData.has(STORAGE_KEY)).toBe(true);

    await ledger.clearAll();

    expect(storageData.has(STORAGE_KEY)).toBe(false);
  });

  it('T16: empty boot — rehydrate with empty store and empty interactions is a no-op', async () => {
    const result = await ledger.rehydrate([]);
    expect(result.attached).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('T17: delete-after-persist — attached entries stay durable until acknowledgePersisted (no ack-skip loss)', async () => {
    await ledger.pushStamped(makePostEntry());
    const click = makeClickInteraction('evt-click-1');

    // Attach WITHOUT acknowledging (simulates: LIVE_INTERACTIONS persist
    // not yet landed / SW died right after in-memory attach)
    ledger.attachToInteractions([click]);
    expect(click.behavioralEvidence).toBeDefined();

    // The durable store still holds the entry — a restart recovers it.
    expect(storageData.get(STORAGE_KEY)).toBeDefined();

    // Crash point: boot reconciliation on a NEW ledger sees the stored
    // entry + the already-attached interaction → crash-point-A cleanup
    // (no duplicate), then the entry is acknowledged away.
    const fresh = new DurableAttributionLedger();
    const result = await fresh.rehydrate([click]);
    expect(result.attached).toHaveLength(0); // no duplicate attach
    const net = click.behavioralEvidence!.applicationEvidence.networkActivity as
      (import('../../../src/shared/behavioral-evidence-types').NetworkActivity & { requestId?: string })[];
    expect(net).toHaveLength(1); // still exactly one

    // Acknowledge (caller persisted): NOW the store empties.
    fresh.acknowledgePersisted();
    await Promise.resolve();
    expect(storageData.has(STORAGE_KEY)).toBe(false);
  });

  it('T18: acknowledgePersisted after normal flow — persist-then-ack empties the store', async () => {
    await ledger.pushStamped(makePostEntry());
    const click = makeClickInteraction('evt-click-1');
    const attached = ledger.attachToInteractions([click]);
    expect(attached).toBe(1);

    // Caller persists LIVE_INTERACTIONS, then acks
    await chrome.storage.local.set({ cmdrunner_live_interactions: [click] });
    ledger.acknowledgePersisted();
    await Promise.resolve();
    expect(storageData.has(STORAGE_KEY)).toBe(false);
  });

  it('T19: failed persist never acks — acknowledgeAfterPersist keeps the durable entry for boot reconciliation', async () => {
    await ledger.pushStamped(makePostEntry());
    const click = makeClickInteraction('evt-click-1');
    expect(ledger.attachToInteractions([click])).toBe(1);

    // The caller's LIVE_INTERACTIONS write FAILED (persist resolves false —
    // persistLiveInteractions never rejects, so an unguarded `await` +
    // ack would silently delete the durable entry). The helper must NOT ack.
    const failedPersist = Promise.resolve(false);
    ledger.acknowledgeAfterPersist(failedPersist);
    await new Promise((r) => setTimeout(r, 5)); // let the chain settle

    // Entry survives — boot reconciliation will attach it next boot.
    expect(storageData.get(STORAGE_KEY)).toBeDefined();
    expect(
      (click.behavioralEvidence!.applicationEvidence.networkActivity[0] as { requestId?: string }).requestId,
    ).toBe('R1');

    // Recovery: next boot, rehydrate on a fresh ledger attaches it exactly
    // once (crash-point-B shape — nothing was lost).
    const fresh = new DurableAttributionLedger();
    const recovered = await fresh.rehydrate([makeClickInteraction('evt-click-1')]);
    expect(recovered.attached).toHaveLength(1);
  });

  it('T19b: landed persist acks via acknowledgeAfterPersist — the happy path chains the delete', async () => {
    await ledger.pushStamped(makePostEntry());
    const click = makeClickInteraction('evt-click-1');
    expect(ledger.attachToInteractions([click])).toBe(1);

    ledger.acknowledgeAfterPersist(Promise.resolve(true));
    await new Promise((r) => setTimeout(r, 5));

    expect(storageData.has(STORAGE_KEY)).toBe(false); // deleted after landed
  });
});

describe('RequestOwnershipLedger', () => {
  it('rebuilds from LIVE_INTERACTIONS networkActivity and enforces exactly-once across ledgers', () => {
    const ownership = new RequestOwnershipLedger();
    const click = makeClickInteraction('evt-click-1', 'int-1', true);
    (click.behavioralEvidence!.applicationEvidence.networkActivity as never[]).push({
      requestId: 'R-EXISTING',
      url: 'https://x/api',
      method: 'GET',
    } as never);
    ownership.rebuildFromInteractions([click]);

    expect(ownership.isAttached('R-EXISTING')).toBe(true);
    expect(ownership.isAttached('R-UNKNOWN')).toBe(false);
    expect(ownership.getInteractionId('R-EXISTING')).toBe('int-1');
  });

  it('records new ownership on attach and survives ledger handoff', () => {
    const ownership = new RequestOwnershipLedger();
    ownership.markAttached('R9', 'int-9');
    expect(ownership.isAttached('R9')).toBe(true);
    expect(ownership.getInteractionId('R9')).toBe('int-9');
  });
});

describe('resolveInteractionForEventId', () => {
  it('tier 1: triggerEvent.eventId wins', () => {
    const a = makeClickInteraction('evt-a', 'int-a');
    const b = makeClickInteraction('evt-b', 'int-b');
    expect(resolveInteractionForEventId('evt-a', [a, b])?.interactionId).toBe('int-a');
  });

  it('tier 2: memberEvents fallback', () => {
    const a = makeClickInteraction('evt-a', 'int-a', false, ['evt-m1', 'evt-m2']);
    expect(resolveInteractionForEventId('evt-m2', [a])?.interactionId).toBe('int-a');
  });

  it('no match returns null — never guesses', () => {
    expect(resolveInteractionForEventId('evt-none', [makeClickInteraction('evt-a')])).toBeNull();
  });
});

describe('synthesizeMinimalEvidence', () => {
  it('produces a complete, typed evidence object anchored to the sourceEventId', () => {
    const click = makeClickInteraction('evt-click-1');
    const ev = synthesizeMinimalEvidence(click, 'evt-click-1');
    expect(ev.sourceEventId).toBe('evt-click-1');
    expect(ev.window.endReason).toBe('sw-recovered-form-submit');
    expect(ev.applicationEvidence.networkActivity).toEqual([]);
    expect(ev.targetEvidence).toMatchObject({ identity: null, before: null, after: null });
  });

  it('does not overwrite an interaction that already has behavioralEvidence', () => {
    const click = makeClickInteraction('evt-click-1', 'int-1', true);
    const before = click.behavioralEvidence;
    synthesizeMinimalEvidence(click, 'evt-click-1');
    expect(click.behavioralEvidence).toBe(before); // same reference, untouched
  });
});
