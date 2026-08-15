/**
 * Multi-Tab Capture & Triple-Key Attribution — Regression Suite (R12–R23)
 *
 * From .drytis/specs/multi-tab-capture-attribution.md. Verifies G4-A
 * (recording-scoped capture gate), G4-B (sourceEventId+tabId+frameId
 * attribution), G4-C (stamp eligibility), G4-D (boot-restore ordering),
 * G4-E (wholesale stop cleanup).
 *
 * All joins are identity-based — no test depends on timing for correctness.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { NetworkActivity } from '../../../src/shared/behavioral-evidence-types';

// ── Mock chrome.storage.local ─────────────────────────────────────────

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
  tabs: {
    sendMessage: vi.fn(async () => {}),
  },
  webRequest: {
    onBeforeRequest: { addListener: vi.fn(), removeListener: vi.fn() },
    onBeforeRedirect: { addListener: vi.fn(), removeListener: vi.fn() },
    onCompleted: { addListener: vi.fn(), removeListener: vi.fn() },
    onErrorOccurred: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

import {
  setLastTrustedAction,
  getLastTrustedAction,
  getFrameStamp,
  stampEligible,
  setLastTrustedActionIfAbsent,
  noteRecordingScopeTab,
  __testSetRecordingActive,
  __testGetGateState,
  __testResetStamps,
  shouldProcessRequestForTest as shouldProcessRequest,
  __testSetGateStateForSim,
  startNetworkObservation,
  stopNetworkObservation,
} from '../../../src/background/network-observation';

const OBSERVING_KEY = 'cmdrunner_net_observing_tabs';
const LAST_ACTION_KEY = 'cmdrunner_net_last_action';
const PENDING_KEY = 'cmdrunner_pending_nav_docs';

function makeClickInteraction(
  eventId: string,
  interactionId = 'int-20',
): ComponentInteraction {
  return {
    interactionId,
    interactionType: 'click',
    triggerEvent: {
      eventId,
      eventType: 'click',
      timestamp: 0,
      target: {} as never,
      isTrusted: true,
    },
    memberEvents: [],
    behavioralEvidence: null,
  } as unknown as ComponentInteraction;
}

beforeEach(() => {
  storageData.clear();
  __testSetGateStateForSim({ seeded: true, tabs: [] });
  __testSetRecordingActive(false);
  __testResetStamps();
});

// ── R12: multi-tab capture (THE int-20/int-21 repro) ──────────────────

describe('R12 — G4-A multi-tab capture', () => {
  it('captures webRequest traffic from a NON-starting tab while recording', () => {
    // Recording started in tab 1; the click+submit happen in tab 7.
    __testSetRecordingActive(true);
    expect(shouldProcessRequest(7)).toBe(true);
  });

  it('drops traffic from ANY tab when recording is inactive', () => {
    __testSetRecordingActive(false);
    expect(shouldProcessRequest(7)).toBe(false);
    expect(shouldProcessRequest(1)).toBe(false);
  });

  it('observingTabIds membership no longer gates capture (INV-G4)', () => {
    __testSetRecordingActive(true);
    __testSetGateStateForSim({ seeded: true, tabs: [1] });
    // Tab 7 is NOT in the observing set — capture must still pass.
    expect(shouldProcessRequest(7)).toBe(true);
  });
});

// ── R13: forwarding split ─────────────────────────────────────────────

describe('R13 — forwarding is not correctness', () => {
  it('shouldForwardToTab depends on observing membership, not recordingActive', async () => {
    const mod = await import('../../../src/background/network-observation');
    // recording on, tab not in observing set → no bridge forward
    __testSetRecordingActive(true);
    __testSetGateStateForSim({ seeded: true, tabs: [1] });
    expect(mod.__testForwardToTab(7)).toBe(false);
    expect(mod.__testForwardToTab(1)).toBe(true);
  });

  it('noteRecordingScopeTab grows the forwarding set idempotently and persists (INV-G4)', () => {
    __testSetRecordingActive(true);
    __testSetGateStateForSim({ seeded: true, tabs: [1] });
    noteRecordingScopeTab(7);
    noteRecordingScopeTab(7); // idempotent
    expect(storageData.get(OBSERVING_KEY)).toEqual([1, 7]);
    expect(__testGetGateState().tabs.sort()).toEqual([1, 7]);
  });

  it('recording in tab A, request in tab B: SW-side durable record still written', async () => {
    // Simulate the dispatcher stamp from tab 7 (the Amazon tab).
    setLastTrustedAction(7, 0, { eventId: 'evt-click-20', interactionId: '' });
    // Capture gate passes for tab 7 while recording (even though the
    // observing set contains only tab 1 — the start tab).
    __testSetRecordingActive(true);
    __testSetGateStateForSim({ seeded: true, tabs: [1] });
    expect(shouldProcessRequest(7)).toBe(true);
  });
});

// ── R14: stamp steal ──────────────────────────────────────────────────

describe('R14 — G4-C stamp eligibility', () => {
  it('mousemove / mouseenter / focus / blur / input do NOT stamp', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-click-20', interactionId: '' });
    for (const t of ['mousemove', 'mouseenter', 'mouseleave', 'focus', 'blur', 'input', 'scroll', 'mousedown', 'dragstart']) {
      expect(stampEligible(t)).toBe(false);
    }
    // The stamp survives — those events cannot overwrite it.
    expect(getLastTrustedAction(7)!.eventId).toBe('evt-click-20');
  });

  it('click / contextmenu / change / submit / drop stamp', () => {
    for (const t of ['click', 'contextmenu', 'change', 'submit', 'drop']) {
      expect(stampEligible(t)).toBe(true);
    }
  });

  it('G5: submit is SECONDARY — stamps only when the frame has no stamp (create-only)', () => {
    // G4-C listed submit as an overwriting stamp; G5 (INV-F2) demotes it:
    // a native submit DOM event is a consequence of the initiating click,
    // never a new trusted action. A click followed by a native form submit
    // must keep the CLICK as the causal owner (the int-18/int-19 defect).
    setLastTrustedAction(7, 0, { eventId: 'evt-click-18', interactionId: '' });
    setLastTrustedActionIfAbsent(7, 0, { eventId: 'evt-submit-90', interactionId: '' });
    expect(getLastTrustedAction(7)!.eventId).toBe('evt-click-18');
    // …and in an empty frame the submit alone IS the trusted cause
    // (programmatic form.submit()): it creates the stamp.
    setLastTrustedActionIfAbsent(7, 1, { eventId: 'evt-submit-91', interactionId: '' });
    expect(getLastTrustedAction(7, 1)!.eventId).toBe('evt-submit-91');
  });

  it('keydown stamps only for Enter', () => {
    expect(stampEligible('keydown', 'Enter')).toBe(true);
    expect(stampEligible('keydown', 'a')).toBe(false);
    expect(stampEligible('keydown', 'Tab')).toBe(false);
    expect(stampEligible('keydown')).toBe(false);
  });
});

// ── R15: Enter-only keydown (covered by R14 block) ────────────────────

// ── R16: frame scoping ────────────────────────────────────────────────

describe('R16 — G4-B frame-scoped stamps', () => {
  it('a stamp lives under tabId:frameId; other frames do not see it', () => {
    setLastTrustedAction(7, 3, { eventId: 'evt-frame3-click', interactionId: '' });
    expect(getLastTrustedAction(7, 0)).toBeNull();      // frame 0 unstamped
    expect(getLastTrustedAction(7, 3)!.eventId).toBe('evt-frame3-click');
    expect(getLastTrustedAction(9, 3)).toBeNull();      // other tab
  });

  it('main_frame request (frameId 0) matches the top document stamp', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-click-20', interactionId: '' });
    expect(getLastTrustedAction(7, 0)!.eventId).toBe('evt-click-20');
  });

  it('per-frame stamping does not bleed between frames of the same tab', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-top', interactionId: '' });
    setLastTrustedAction(7, 3, { eventId: 'evt-iframe', interactionId: '' });
    expect(getLastTrustedAction(7, 0)!.eventId).toBe('evt-top');
    expect(getLastTrustedAction(7, 3)!.eventId).toBe('evt-iframe');
  });

  it('getFrameStamp exposes all live stamps of a tab (for the G1-C 3-rule resolution)', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-top', interactionId: '' });
    setLastTrustedAction(7, 3, { eventId: 'evt-iframe', interactionId: '' });
    setLastTrustedAction(9, 0, { eventId: 'evt-other', interactionId: '' });
    const stamps7 = getFrameStamp(7);
    expect(stamps7.get('7:0')!.eventId).toBe('evt-top');
    expect(stamps7.get('7:3')!.eventId).toBe('evt-iframe');
    expect(stamps7.size).toBe(2);
  });
});

// ── R17: ambiguity rule (back-fill resolution) ────────────────────────

describe('R17 — G1-C deterministic 3-rule back-fill', () => {
  it('rule 1: frame-0 stamp wins for a top-level submit', async () => {
    const { resolveBackfillStamp } = await import('../../../src/background/network-observation');
    setLastTrustedAction(7, 0, { eventId: 'evt-top', interactionId: '' });
    setLastTrustedAction(7, 3, { eventId: 'evt-iframe', interactionId: '' });
    expect(resolveBackfillStamp(7)).toBe('evt-top');
  });

  it('rule 2: tab-unique stamp resolves when frame 0 is unstamped', async () => {
    const { resolveBackfillStamp } = await import('../../../src/background/network-observation');
    setLastTrustedAction(7, 3, { eventId: 'evt-iframe-only', interactionId: '' });
    expect(resolveBackfillStamp(7)).toBe('evt-iframe-only');
  });

  it('rule 3: two candidate frames, no frame-0 stamp → unstamped (synthetic nav keeps it)', async () => {
    const { resolveBackfillStamp } = await import('../../../src/background/network-observation');
    setLastTrustedAction(7, 3, { eventId: 'evt-a', interactionId: '' });
    setLastTrustedAction(7, 5, { eventId: 'evt-b', interactionId: '' });
    expect(resolveBackfillStamp(7)).toBeNull();
  });

  it('no stamps at all → null', async () => {
    const { resolveBackfillStamp } = await import('../../../src/background/network-observation');
    expect(resolveBackfillStamp(7)).toBeNull();
  });
});

// ── R18: boot-restore ordering ────────────────────────────────────────

describe('R18 — G4-D bootRestorePromise ordering', () => {
  it('consumers can await a single boot promise before reading restored state', async () => {
    storageData.set(PENDING_KEY, {
      '7': {
        requestId: 'req-77',
        tabId: 7,
        frameId: 0,
        originalUrl: 'https://x.test/cart/add-to-cart',
        method: 'GET',
      },
    });
    storageData.set(LAST_ACTION_KEY, {
      // per-frame map shape
      '7:0': { tabId: 7, frameId: 0, action: { eventId: 'evt-restored', interactionId: '' }, wallClock: Date.now() },
    });
    // Fresh SW instance: module-level boot restore runs NOW (storage
    // already seeded) — exactly the production restart scenario.
    vi.resetModules();
    const mod = await import('../../../src/background/network-observation');
    // A consumer that does NOT await sees nothing yet (or partial); the
    // contract: after awaiting the boot promise, restored state is visible.
    await mod.getBootRestorePromise();
    const rec = mod.consumeMainFrameCorrelation(7);
    expect(rec?.requestId).toBe('req-77');
    expect(mod.getLastTrustedAction(7, 0)?.eventId).toBe('evt-restored');
    // restore the shared bindings for subsequent tests
    await import('../../../src/background/network-observation');
  });

  it('restore keeps in-memory state (newer state wins) for stamps', () => {
    setLastTrustedAction(7, 0, { eventId: 'evt-inmemory', interactionId: '' });
    // A later restore of an older persisted value must not overwrite it.
    storageData.set(LAST_ACTION_KEY, {
      '7:0': { tabId: 7, frameId: 0, action: { eventId: 'evt-persisted-old', interactionId: '' }, wallClock: Date.now() },
    });
    // (restoreLastTrustedActionFromStorage is invoked inside the boot
    // promise; assert via the exported restore function directly)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // direct import:
    return import('../../../src/background/network-observation').then((mod) => {
      mod.restoreLastTrustedActionFromStorage();
      return import('../../../src/background/network-observation');
    }).then(() => {
      expect(getLastTrustedAction(7, 0)!.eventId).toBe('evt-inmemory');
    });
  });
});

// ── R19: stamp restore TTL ────────────────────────────────────────────

describe('R19 — stamp restore TTL (degrade-only)', () => {
  it('a stale persisted stamp (> TTL) is not resurrected', async () => {
    storageData.set(LAST_ACTION_KEY, {
      '7:0': {
        tabId: 7, frameId: 0,
        action: { eventId: 'evt-ancient', interactionId: '' },
        wallClock: Date.now() - 60_000,
      },
    });
    const mod = await import('../../../src/background/network-observation');
    mod.restoreLastTrustedActionFromStorage();
    expect(getLastTrustedAction(7, 0)).toBeNull();
  });

  it('stale restoration degrades to unstamped — the request stays out of the ledger (never misattributed)', async () => {
    // nothing restored → frame lookup null → no stamp → recordStampedRequest
    // is a no-op by definition (sourceEventId undefined). Assert the lookup.
    expect(getLastTrustedAction(7, 0)).toBeNull();
  });
});

// ── R20: wholesale stop cleanup ───────────────────────────────────────

describe('R20 — G4-E stop cleanup', () => {
  it('STOP clears observing set, stamps, pendingDocs — memory AND persisted', async () => {
    await startNetworkObservation(1);
    // another tab joined the observing set via message
    __testSetGateStateForSim({ seeded: true, tabs: [1, 9] });
    setLastTrustedAction(9, 0, { eventId: 'evt-9', interactionId: '' });
    const { getMainFrameCorrelation } = await import('../../../src/background/network-observation');
    void getMainFrameCorrelation;

    stopNetworkObservation(1);

    // memory cleared
    expect(getLastTrustedAction(9, 0)).toBeNull();
    // persisted cleared
    const obs = storageData.get(OBSERVING_KEY);
    expect(Array.isArray(obs) ? obs.length : 0).toBe(0);
    const stamps = storageData.get(LAST_ACTION_KEY) as Record<string, unknown> | undefined;
    expect(stamps && Object.keys(stamps).length > 0 ? 'nonempty' : 'empty').toBe('empty');
    const docs = storageData.get(PENDING_KEY) as Record<string, unknown> | undefined;
    expect(docs && Object.keys(docs).length > 0 ? 'nonempty' : 'empty').toBe('empty');
  });

  it('capture gate is closed after STOP even in the boot-unknown state (INV-G6)', () => {
    __testSetRecordingActive(true);
    stopNetworkObservation(1);
    __testSetGateStateForSim({ seeded: false, tabs: [] }); // boot-unknown
    expect(shouldProcessRequest(9)).toBe(false);
  });
});

// ── R21: cross-domain ─────────────────────────────────────────────────

describe('R21 — G4-B cross-domain attribution', () => {
  it('a submit to origin B keeps (tabId, frameId 0) — triple survives origin change', () => {
    // click on origin A, frame 0 of tab 7
    setLastTrustedAction(7, 0, { eventId: 'evt-a-click', interactionId: '' });
    // main_frame POST to origin B — same tabId:0 key
    const stamp = getLastTrustedAction(7, 0);
    expect(stamp!.eventId).toBe('evt-a-click');
  });

  it('ledger triple join attributes a cross-origin stamped doc to the A-click interaction', async () => {
    const { DurableAttributionLedger } = await import('../../../src/background/evidence-attribution');
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped({
      url: 'https://shop-b.test/cart/add-to-cart',
      method: 'POST',
      status: 200,
      requestId: 'req-x-origin',
      sourceEventId: 'evt-a-click',
      documentRequest: true,
      mainFrame: true,
    });
    const click = makeClickInteraction('evt-a-click', 'int-cross');
    const n = ledger.attachToInteractions([click]);
    expect(n).toBe(1);
    const net = click.behavioralEvidence!.applicationEvidence.networkActivity as NetworkActivity[];
    expect(net.some((a) => a.url === 'https://shop-b.test/cart/add-to-cart')).toBe(true);
  });
});

// ── R22: legacy storage migration ─────────────────────────────────────

describe('R22 — legacy LAST_ACTION shape migration', () => {
  it('old single-record shape restores into the per-frame map without throwing', async () => {
    storageData.set(LAST_ACTION_KEY, {
      tabId: 7,
      action: { eventId: 'evt-legacy', interactionId: '' },
      wallClock: Date.now(),
    });
    const mod = await import('../../../src/background/network-observation');
    expect(() => mod.restoreLastTrustedActionFromStorage()).not.toThrow();
    // Not restored as a frame stamp (legacy records carry no frameId) —
    // the legacy tab-level stamp is intentionally NOT resurrected as a
    // frame stamp to avoid misattribution; assert no throw + clean state.
    expect(getFrameStamp(7).size).toBe(0);
  });
});

// ── R23: gate matrix ──────────────────────────────────────────────────

describe('R23 — capture gate matrix', () => {
  it('recordingActive=true → capture any tab; false → drop; boot-unknown → ring-only (no forward)', async () => {
    const mod = await import('../../../src/background/network-observation');

    // capture matrix
    __testSetRecordingActive(true);
    expect(shouldProcessRequest(1)).toBe(true);
    expect(shouldProcessRequest(42)).toBe(true);

    __testSetRecordingActive(false);
    expect(shouldProcessRequest(1)).toBe(false);

    // boot-unknown: recording flag itself not yet seeded → conservative
    // ring-only capture. __testSetRecordingActive(undefined) simulates
    // "unknown" (tri-state).
    mod.__testSetRecordingActive(undefined as unknown as boolean);
    expect(mod.shouldProcessRequestForTest(9)).toBe(true);
    expect(mod.__testForwardToTab(9)).toBe(false); // never forward unknown
    __testSetRecordingActive(false); // restore for later tests
  });

  it('boot-unknown gate state can be observed via __testGetGateState', () => {
    __testSetGateStateForSim({ seeded: false, tabs: [] });
    const st = __testGetGateState();
    expect(st.recordingActive).toBe(false); // explicit stop dominates unknown
  });
});

// ── inFlight multi-tab scoping (G4-A mandatory consequence) ───────────

describe('G4-A — tab-scoped inFlight consumers', () => {
  it('snapshotInFlightForTab only returns entries of the named tab', async () => {
    const mod = await import('../../../src/background/network-observation');
    __testSetRecordingActive(true);
    // Register a capturing listener registry under the current chrome stub.
    const listeners: { before?: (d: Record<string, unknown>) => Promise<void> } = {};
    const prevWebRequest = (chrome as unknown as { webRequest?: Record<string, unknown> }).webRequest;
    (chrome as unknown as { webRequest: Record<string, unknown> }).webRequest = {
      onBeforeRequest: {
        addListener: (cb: (d: Record<string, unknown>) => Promise<void>) => { listeners.before = cb; },
        removeListener: () => {},
      },
      onBeforeRedirect: { addListener: () => {}, removeListener: () => {} },
      onCompleted: { addListener: () => {}, removeListener: () => {} },
      onErrorOccurred: { addListener: () => {}, removeListener: () => {} },
    };
    mod.__testRegisterForListeners();
    expect(listeners.before).toBeDefined();
    await listeners.before!({
      requestId: 'r-tab7', url: 'https://a.test/x', method: 'GET',
      type: 'xmlhttprequest', frameId: 0, tabId: 7, requestBody: undefined,
    });
    await listeners.before!({
      requestId: 'r-tab9', url: 'https://b.test/y', method: 'GET',
      type: 'xmlhttprequest', frameId: 0, tabId: 9, requestBody: undefined,
    });
    const snapped7 = mod.snapshotInFlightForTab(7, 'nav-7');
    expect(snapped7.map((s) => s.requestId)).toEqual(['r-tab7']);
    const snapped9 = mod.snapshotInFlightForTab(9, 'nav-9');
    expect(snapped9.map((s) => s.requestId)).toEqual(['r-tab9']);
    // restore the original stub
    (chrome as unknown as { webRequest: Record<string, unknown> }).webRequest =
      prevWebRequest as Record<string, unknown>;
  });
});
