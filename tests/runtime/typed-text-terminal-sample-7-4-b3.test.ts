/**
 * 7.4-B3 S3 — Typed-text terminal sample.
 *
 * F3: input/change are accumulating events — never stored in the ledger,
 * never surfaced as Unclassified. When a user types into an input whose
 * lifecycle never started (extension loaded after focus; recording started
 * mid-focus; content-script race), the typed text is lost with ZERO trace.
 *
 * S3 mints ONE synthetic ledger entry per episode:
 *   - SW tracks input events claimed by no lifecycle, per elementKey
 *   - on blur of that element: synthetic LedgerEntry eventType 'change'
 *     with the terminal valueAfter, via ledger.appendSynthetic (bypasses
 *     the DISCRETE_ACTION_TYPES filter; raw events stay filtered — R1)
 *   - projects as Unclassified physicalEventType 'change'
 *
 * Guards: no entry when a lifecycle exists or later completes; none on
 * blur-without-input; one per episode; tracker cleared on mint.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

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

const mkTarget = (name: string) => ({
  tag: 'INPUT', accessibleName: name, cssSelector: `#${name}`, elementId: name,
});

function ev(
  eventId: string, eventType: string, ts: number, target: any,
  valueAfter: string | null = null,
) {
  return {
    eventId, eventType, timestamp: ts, captureSeq: ts, isTrusted: true,
    target, domContext: { ancestorRoles: [], ancestorClasses: [], inputType: 'text', isContentEditable: false },
    valueBefore: null, valueAfter, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.com', pageTitle: 'Test',
  } as any;
}

describe('7.4-B3 S3: typed-text terminal sample', () => {
  afterEach(async () => {
    const mod = await import('../../src/runtime/sw-integration');
    mod.resetState();
    vi.resetModules();
    delete (globalThis as any).chrome;
  });

  it('S3-1: no-lifecycle typing + blur → exactly ONE synthetic entry, terminal value', async () => {
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: [],
    });
    const { restoreFromStorage, initRecording, processObservedEvent, getEvidenceLedger } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    initRecording();

    const t = mkTarget('search');
    processObservedEvent(ev('evt-p-1-1', 'input', 1000, t, 'h'));
    processObservedEvent(ev('evt-p-1-2', 'input', 1010, t, 'ho'));
    processObservedEvent(ev('evt-p-1-3', 'input', 1020, t, 'hotel'));
    processObservedEvent(ev('evt-p-1-4', 'blur', 1100, t));

    const ledger = getEvidenceLedger()!;
    const synthetic = ledger.getEntries().filter((e) => (e as any).synthetic === true);
    expect(synthetic.length).toBe(1);
    expect(synthetic[0].eventType).toBe('change');
    expect(synthetic[0].sampledValueAfter).toBe('hotel');
    // S3 RCA pin (reviewer Critical #1): the synthetic entryId MUST parse
    // to the same pageId as the raw events (evt-{pageId}-{counter}). A
    // malformed pageId sorts the entry outside its page in ledger order
    // and breaks the S2 dedup-fold twin scan.
    expect(synthetic[0].eventId).toMatch(/^evt-p-1-\d+$/);
    expect(synthetic[0].pageId).toBe('p-1');
  });

  it('S3-2: synthetic entry projects as Unclassified physicalEventType change', async () => {
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: [],
    });
    const { restoreFromStorage, initRecording, processObservedEvent, stopRecording } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    initRecording();

    const t = mkTarget('search');
    processObservedEvent(ev('evt-p-2-1', 'input', 1000, t, 'x'));
    processObservedEvent(ev('evt-p-2-2', 'blur', 1100, t));

    const result = stopRecording();
    const unc = result.filter((i) => i.type === 'Unclassified');
    expect(unc.length).toBe(1);
    expect(unc[0].metadata.physicalEventType).toBe('change');
  });

  it('S3-3: NORMAL typing (lifecycle exists) → zero synthetic entries', async () => {
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: [],
    });
    const { restoreFromStorage, initRecording, processObservedEvent, getEvidenceLedger } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    initRecording();

    // focus FIRST → TextEntry lifecycle starts (real definition priority)
    const t = mkTarget('search');
    processObservedEvent(ev('evt-p-3-0', 'focus', 900, t));
    processObservedEvent(ev('evt-p-3-1', 'input', 1000, t, 'h'));
    processObservedEvent(ev('evt-p-3-2', 'input', 1010, t, 'hi'));
    processObservedEvent(ev('evt-p-3-3', 'blur', 1100, t));

    const ledger = getEvidenceLedger()!;
    const synthetic = ledger.getEntries().filter((e) => (e as any).synthetic === true);
    expect(synthetic.length).toBe(0);
  });

  it('S3-4: blur WITHOUT prior input → zero synthetic entries', async () => {
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: [],
    });
    const { restoreFromStorage, initRecording, processObservedEvent, getEvidenceLedger } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    initRecording();

    const t = mkTarget('search');
    processObservedEvent(ev('evt-p-4-1', 'blur', 1100, t));

    const ledger = getEvidenceLedger()!;
    const synthetic = ledger.getEntries().filter((e) => (e as any).synthetic === true);
    expect(synthetic.length).toBe(0);
  });

  it('S3-5: raw change event alone → no card, no synthetic (R1 pin)', async () => {
    setupChromeMock({
      cmdrunner_recording_active: true,
      cmdrunner_live_interactions: [],
      cmdrunner_evidence_ledger: [],
      cmdrunner_pending_evidence: [],
    });
    const { restoreFromStorage, initRecording, processObservedEvent, getEvidenceLedger, stopRecording } =
      await import('../../src/runtime/sw-integration');
    await restoreFromStorage();
    initRecording();

    const t = mkTarget('search');
    processObservedEvent(ev('evt-p-5-1', 'change', 1000, t, 'v'));
    // no blur

    const ledger = getEvidenceLedger()!;
    expect(ledger.getEntries().filter((e) => (e as any).synthetic).length).toBe(0);
    const result = stopRecording();
    // raw change (no blur) → nothing at all
    expect(result.filter((i) => i.type === 'Unclassified').length).toBe(0);
  });
});
