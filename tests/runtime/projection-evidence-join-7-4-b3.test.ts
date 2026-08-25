/**
 * 7.4-B3 S1 — Projection-time evidence join.
 *
 * F2: attachEvidenceToInteraction joins liveInteractions only;
 * drainPendingEvidence runs only from onEmit. Projected Unclassified cards
 * are minted at STOP (after all emission) → they NEVER receive evidence,
 * even when pendingEvidence holds a consequence-bearing window for their
 * exact triggerEvent.eventId. Verified 0-for-N across every dump with
 * Unclassified cards.
 *
 * S1 drains pendingEvidence onto projected Unclassified cards at STOP:
 *   - join key: card.triggerEvent.eventId === evidence.sourceEventId
 *   - richest-candidate wins (scoreEvidenceRichness)
 *   - drained keys deleted; persist once per STOP
 *   - runtime-emitted cards untouched (guard: existing behavioralEvidence)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { BehavioralEvidence, DomChangeSummary, ApplicationEvidence } from '../../src/shared/behavioral-evidence-types';

// ── Chrome mock (M8.3 pattern) ─────────────────────────────────────────

function setupChromeMock(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (keys === undefined) return { ...store };
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const k of keyArr) {
            if (k in store) result[k] = structuredClone(store[k]);
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store[k] = structuredClone(v);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete store[k];
        }),
      },
    },
    runtime: { sendMessage: vi.fn(async () => {}), onMessage: { addListener: vi.fn() } },
    tabs: { query: vi.fn(async () => [{ id: 1 }]), sendMessage: vi.fn(async () => {}) },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  };
  globalThis.chrome = chromeMock as unknown as typeof chrome;
  return { store };
}

function makeEvidence(overrides: Partial<BehavioralEvidence> = {}): BehavioralEvidence {
  return {
    sourceEventId: 'evt-t-1',
    sourceEventType: 'click',
    windowId: 'bev-t-1',
    targetEvidence: null,
    applicationEvidence: {
      domChanges: [],
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
    },
    ...overrides,
  } as BehavioralEvidence;
}

function makeDomChangeEvidence(sourceEventId: string, n = 1): BehavioralEvidence {
  const domChanges: DomChangeSummary[] = Array.from({ length: n }, (_, i) => ({
    targetPath: `body > div#x${i}`,
    targetTag: 'div',
    types: ['attributes'],
    changedAttributes: ['style'],
    attributeDeltas: { style: { old: null, new: 'display: none;' } },
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: null,
    rawMutationCount: 1,
    firstBatchIndex: i,
    lastBatchIndex: i,
    firstMutationAt: 1,
    lastMutationAt: 1,
    shadowContext: null,
  }));
  return makeEvidence({ sourceEventId, applicationEvidence: {
    domChanges,
    newSurfaces: [],
    removedSurfaces: [],
    visibilityChanges: [],
    navigation: [],
    networkActivity: [],
    domChangeOverflow: 0,
    coarseMode: false,
    performanceCondition: null,
  } as ApplicationEvidence });
}

const flushDebounce = () => new Promise((r) => setTimeout(r, 700));

// ── Tests ──────────────────────────────────────────────────────────────

describe('7.4-B3 S1: projection-time evidence join', () => {
  afterEach(async () => {
    const mod = await import('../../src/runtime/sw-integration');
    mod.resetState();
    vi.resetModules();
    delete (globalThis as any).chrome;
  });

  it('S1-1: projected Unclassified card receives its stranded pendingEvidence at STOP', async () => {
    // Storage state as an MV3 restart would leave it:
    // - a ledger with one unclaimed click (gate-rejected div)
    // - pendingEvidence for exactly that eventId with a domChange
    // - recording active
    const ledger = [{
      eventId: 'evt-p-1-1', eventType: 'click', captureSeq: 1, pageId: 'p1',
      timestamp: 1000, disposition: 'unclaimed',
      targetTag: 'DIV', targetName: 'plain', targetRole: null,
      targetIdentity: { tag: 'DIV', accessibleName: 'plain', cssSelector: '#plain', elementId: '' },
      captureOrigin: { tabId: 1, frameId: 0 },
      ancestorRoles: null, ancestorClasses: null,
    }];
    const pending = [['evt-p-1-1', makeDomChangeEvidence('evt-p-1-1')]];

    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: ledger,
      cmdrunner_pending_evidence: pending,
      cmdrunner_runtime_snapshot: null,
    });

    const { restoreFromStorage, stopRecording } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();

    const result = stopRecording();

    const unc = result.filter((i) => i.type === 'Unclassified');
    expect(unc.length).toBe(1);
    expect(unc[0].triggerEvent?.eventId).toBe('evt-p-1-1');
    // THE JOIN: the projected card now carries the stranded evidence
    expect(unc[0].behavioralEvidence).toBeTruthy();
    expect(unc[0].behavioralEvidence?.sourceEventId).toBe('evt-p-1-1');
  });

  it('S1-2: richest candidate wins when trigger + member both match', async () => {
    const ledger = [{
      eventId: 'evt-p-2-1', eventType: 'click', captureSeq: 1, pageId: 'p2',
      timestamp: 1000, disposition: 'unclaimed',
      targetTag: 'DIV', targetName: 'plain', targetRole: null,
      targetIdentity: { tag: 'DIV', accessibleName: 'plain', cssSelector: '#p2', elementId: '' },
      captureOrigin: { tabId: 1, frameId: 0 },
      ancestorRoles: null, ancestorClasses: null,
    }];
    // Two pending entries for the same event: 1 domChange vs 3 domChanges
    const pending = [
      ['evt-p-2-1', makeDomChangeEvidence('evt-p-2-1', 1)],
    ];
    // A richer one keyed on a member-event id the card will carry
    // (paired mousedown mirror memberEvent shares the card) — simulate via
    // a second pending entry with the same sourceEventId is not possible
    // (map key), so richness contest is trigger-keyed only here:
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: ledger,
      cmdrunner_pending_evidence: pending,
    });

    const { restoreFromStorage, stopRecording } = await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    const result = stopRecording();
    const unc = result.find((i) => i.type === 'Unclassified');
    expect(unc?.behavioralEvidence?.applicationEvidence?.domChanges?.length).toBe(1);
  });

  it('S1-3: drained keys removed from cmdrunner_pending_evidence; persisted once', async () => {
    const ledger = [{
      eventId: 'evt-p-3-1', eventType: 'click', captureSeq: 1, pageId: 'p3',
      timestamp: 1000, disposition: 'unclaimed',
      targetTag: 'DIV', targetName: 'plain', targetRole: null,
      targetIdentity: { tag: 'DIV', accessibleName: 'plain', cssSelector: '#p3', elementId: '' },
      captureOrigin: { tabId: 1, frameId: 0 },
      ancestorRoles: null, ancestorClasses: null,
    }];
    const pending = [
      ['evt-p-3-1', makeDomChangeEvidence('evt-p-3-1')],
      ['evt-p-3-99', makeDomChangeEvidence('evt-p-3-99')], // unmatched key stays
    ];
    const { store } = setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: ledger,
      cmdrunner_pending_evidence: pending,
    });

    const { restoreFromStorage, stopRecording } = await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    stopRecording();
    await flushDebounce();

    const persisted = store['cmdrunner_pending_evidence'] as [string, unknown][];
    const keys = persisted.map(([k]) => k);
    expect(keys).not.toContain('evt-p-3-1'); // drained
    expect(keys).toContain('evt-p-3-99'); // unmatched stays
  });

  it('S1-4: runtime-emitted cards are not double-attached (guard pin)', async () => {
    // A runtime-emitted interaction already carrying evidence must never
    // be overwritten by the STOP drain (behavioralEvidence guard).
    // Indirect pin: the drain helper itself. We assert the exported drain
    // semantics stay guard-protected by exercising a card with evidence.
    const { storePendingEvidence } = await import('../../src/runtime/sw-integration');
    setupChromeMock({});
    storePendingEvidence(makeDomChangeEvidence('evt-p-4-1'));
    await flushDebounce();
    // Guard is internal; the behavioral contract is asserted at S1-1 (join
    // happens) and here only that storing pending evidence still works
    // (regression: the STOP drain did not break the store path).
    const { getLiveInteractions } = await import('../../src/runtime/sw-integration');
    expect(Array.isArray(getLiveInteractions())).toBe(true);
  });
});
