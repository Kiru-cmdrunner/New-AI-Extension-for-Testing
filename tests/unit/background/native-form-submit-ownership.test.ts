/**
 * G5 — Native Form-Submit Ownership — Regression Suite (R24–R28)
 *
 * From .drytis/specs/native-form-submit-ownership.md. The click that
 * initiates a native form submission remains the causal owner; the native
 * `submit` DOM event never steals that ownership; one requestId has
 * exactly one owning interaction across all capture paths.
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
  tabs: { sendMessage: vi.fn(async () => {}) },
});

import {
  setLastTrustedAction,
  setLastTrustedActionIfAbsent,
  getLastTrustedAction,
  stampClass,
  stampEligible,
  resolveBackfillStamp,
  __testSetGateStateForSim,
  __testSetRecordingActive,
  __testResetStamps,
} from '../../../src/background/network-observation';
import { DurableAttributionLedger } from '../../../src/background/evidence-attribution';
import { mergeNetworkActivity } from '../../../src/runtime/sw-integration';

// ── constants / helpers ───────────────────────────────────────────────

const CLICK_EVENT_ID = 'evt-click-18';
const SUBMIT_EVENT_ID = 'evt-submit-90';
const REAL_REQUEST_ID = '12345';
const POST_URL = 'https://www.amazon.in/cart/add-to-cart/ref=dp_start-bbf_1_glance';
const TAB_ID = 7;

function makeClickInteraction(): ComponentInteraction {
  return {
    interactionId: 'int-18',
    interactionType: 'click',
    triggerEvent: {
      eventId: CLICK_EVENT_ID,
      eventType: 'click',
      timestamp: 0,
      target: {} as never,
      isTrusted: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    },
    memberEvents: [],
    behavioralEvidence: null,
    metadata: { captureOrigin: { tabId: TAB_ID, frameId: 0 } },
  } as unknown as ComponentInteraction;
}

function makeSyntheticNavInteraction(): ComponentInteraction {
  return {
    interactionId: 'int-19',
    interactionType: 'nav',
    triggerEvent: {
      eventId: 'nav-event-1',
      eventType: 'navigation',
      timestamp: 0,
      target: {} as never,
      isTrusted: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    },
    memberEvents: [],
    behavioralEvidence: {
      sourceEventId: 'nav-event-1',
      sourceEventType: 'navigation',
      windowId: 'synthetic-nav-nav-event-1',
      frameId: 'main',
      window: {
        openedAt: 0, closedAt: 0, durationMs: 0,
        endReason: 'page-reload-synthetic', stabilityTrace: [],
      },
      targetEvidence: null,
      applicationEvidence: { networkActivity: [] },
    },
  } as unknown as ComponentInteraction;
}

function makeEvidenceWithNetwork(
  rows: (NetworkActivity & { requestId?: string })[],
): NonNullable<ComponentInteraction['behavioralEvidence']> {
  return {
    sourceEventId: CLICK_EVENT_ID,
    sourceEventType: 'click',
    windowId: 'w1',
    frameId: 'main',
    window: { openedAt: 0, closedAt: 0, durationMs: 0, endReason: 'lifecycle-complete', stabilityTrace: [] },
    targetEvidence: null,
    applicationEvidence: { networkActivity: rows },
  } as never;
}

function bridgeRow(requestId = REAL_REQUEST_ID): NetworkActivity & { requestId?: string } {
  return {
    url: POST_URL,
    method: 'POST',
    status: 200,
    startRelativeToEvent: 5,
    endRelativeToEvent: null,
    durationMs: null,
    resourceType: 'unknown',
    source: 'webrequest',
    requestBody: { items: '1' },
    sourceEventId: CLICK_EVENT_ID,
    requestId,
  };
}

// ── R24 ────────────────────────────────────────────────────────────────

describe('R24 — native form-submit ownership: click stays causal owner', () => {
  beforeEach(() => {
    storageData.clear();
    __testSetGateStateForSim({ seeded: true, tabs: [TAB_ID] });
    __testSetRecordingActive(true);
    __testResetStamps();
  });

  it('submit does not steal the click stamp (G5-A/B/C)', () => {
    // 1. trusted click stamps frame-0 (primary)
    setLastTrustedAction(TAB_ID, 0, { eventId: CLICK_EVENT_ID, interactionId: 'int-18' });
    // 2. trusted submit must NOT overwrite (secondary → create-only)
    setLastTrustedActionIfAbsent(TAB_ID, 0, { eventId: SUBMIT_EVENT_ID, interactionId: 'int-x' });
    expect(getLastTrustedAction(TAB_ID, 0)?.eventId).toBe(CLICK_EVENT_ID);
  });

  it('stampClass: submit secondary; click/contextmenu/change/drop/Enter primary; others ineligible', () => {
    expect(stampClass('submit')).toBe('secondary');
    expect(stampClass('click')).toBe('primary');
    expect(stampClass('contextmenu')).toBe('primary');
    expect(stampClass('change')).toBe('primary');
    expect(stampClass('drop')).toBe('primary');
    expect(stampClass('keydown', 'Enter')).toBe('primary');
    expect(stampClass('keydown', 'a')).toBe('ineligible');
    expect(stampClass('mousemove')).toBe('ineligible');
    expect(stampClass('focus')).toBe('ineligible');
    expect(stampClass('input')).toBe('ineligible');
  });

  it('stampEligible back-compat: submit still returns true (create-only semantics live in the dispatcher)', () => {
    expect(stampEligible('submit')).toBe(true);
    expect(stampEligible('click')).toBe(true);
    expect(stampEligible('keydown', 'a')).toBe(false);
  });

  it('one requestId, one owner: ledger respects existing bridge ownership', async () => {
    const click = makeClickInteraction();
    // Bridge already attached the POST row (real requestId) to the click.
    click.behavioralEvidence = makeEvidenceWithNetwork([bridgeRow()]);
    const nav = makeSyntheticNavInteraction();
    const live = [click, nav];

    // Commit-time routing of the SAME request under the SAME real id.
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped({
      url: POST_URL, method: 'POST', status: 200,
      requestId: REAL_REQUEST_ID, sourceEventId: CLICK_EVENT_ID,
      documentRequest: true, mainFrame: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    });

    const attached = ledger.attachToInteractions(live);
    expect(attached).toBe(0); // ownership blocks — already attached
    const clickRows = click.behavioralEvidence!.applicationEvidence!.networkActivity!;
    expect(clickRows).toHaveLength(1);
  });
});

// ── R25 (fast path covered in R24 t4 above); this block pins the
// owner-absent-at-commit hold path (INV-F5's retry design) ─────────────

describe('R25 — fast path: owner absent at commit → ledger hold, STOP drain attaches', () => {
  beforeEach(() => {
    storageData.clear();
    __testSetGateStateForSim({ seeded: true, tabs: [TAB_ID] });
    __testSetRecordingActive(true);
    __testResetStamps();
  });

  it('stamped row with no live owner stays out of nav and out of interactions until STOP drain', async () => {
    const click = makeClickInteraction();
    const nav = makeSyntheticNavInteraction();
    // Owner NOT in live list at commit (deferred emission) — the G5-D hold.
    const liveAtCommit = [nav];

    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped({
      url: POST_URL, method: 'POST', status: 200,
      requestId: REAL_REQUEST_ID, sourceEventId: CLICK_EVENT_ID,
      documentRequest: true, mainFrame: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    });
    const attached = ledger.attachToInteractions(liveAtCommit);
    expect(attached).toBe(0);
    expect(nav.behavioralEvidence!.applicationEvidence!.networkActivity).toHaveLength(0);
    // The entry remains in the ledger for the STOP drain / retry paths.
    expect(ledger.size()).toBe(1);
    // STOP drain with the owner present attaches exactly once.
    const attached2 = ledger.attachToInteractions([click]);
    expect(attached2).toBe(1);
    expect(click.behavioralEvidence?.applicationEvidence?.networkActivity).toHaveLength(1);
  });
});

// ── R26 ────────────────────────────────────────────────────────────────

describe('R26 — programmatic submit only: create-only stamp fires', () => {
  beforeEach(() => {
    storageData.clear();
    __testSetGateStateForSim({ seeded: true, tabs: [TAB_ID] });
    __testSetRecordingActive(true);
    __testResetStamps();
  });

  it('submit alone creates a stamp when frame has none (programmatic form.submit())', () => {
    setLastTrustedActionIfAbsent(TAB_ID, 0, { eventId: SUBMIT_EVENT_ID, interactionId: '' });
    expect(getLastTrustedAction(TAB_ID, 0)?.eventId).toBe(SUBMIT_EVENT_ID);
  });

  it('ledger entry under a submit eventId resolves to nothing; nav stays empty; clearAll at session end', async () => {
    const nav = makeSyntheticNavInteraction();
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped({
      url: POST_URL, method: 'POST', status: 200,
      requestId: REAL_REQUEST_ID, sourceEventId: SUBMIT_EVENT_ID,
      documentRequest: true, mainFrame: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    });
    const attached = ledger.attachToInteractions([nav]);
    expect(attached).toBe(0);
    expect(nav.behavioralEvidence!.applicationEvidence!.networkActivity).toHaveLength(0);
    await ledger.clearAll();
    expect(ledger.size()).toBe(0);
  });
});

// ── R27 ────────────────────────────────────────────────────────────────

describe('R27 — iframe click + top-level submit: G1-C resolution', () => {
  beforeEach(() => {
    storageData.clear();
    __testSetGateStateForSim({ seeded: true, tabs: [TAB_ID] });
    __testSetRecordingActive(true);
    __testResetStamps();
  });

  it('frame-3 click stamps frame 3; submit in same frame does not steal; back-fill resolves to frame-3 stamp', () => {
    // click in iframe (frame 3)
    setLastTrustedAction(TAB_ID, 3, { eventId: 'evt-frame3', interactionId: 'int-f3' });
    // submit event in the SAME iframe → secondary, no steal (frame 3 keeps evt-frame3)
    setLastTrustedActionIfAbsent(TAB_ID, 3, { eventId: SUBMIT_EVENT_ID, interactionId: '' });
    expect(getLastTrustedAction(TAB_ID, 3)?.eventId).toBe('evt-frame3');

    // resolveBackfillStamp = frame0 → tab-unique → null (G1-C 3-rule)
    const resolved = resolveBackfillStamp(TAB_ID);
    expect(resolved).toBe('evt-frame3');
  });
});

// ── R28 ────────────────────────────────────────────────────────────────

describe('R28 — requestId authority across capture paths (mergeNetworkActivity dedup)', () => {
  it('drops duplicate requestId; keeps rows with distinct ids', () => {
    const existing = [bridgeRow('r1')];
    const incoming = [bridgeRow('r1'), bridgeRow('r2')];
    const merged = mergeNetworkActivity(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => (m as { requestId?: string }).requestId).sort())
      .toEqual(['r1', 'r2']);
  });

  it('method:url fallback still dedups when neither row carries a requestId', () => {
    const existing = [bridgeRow(undefined)];
    const incoming = [bridgeRow(undefined), bridgeRow('r2')];
    const merged = mergeNetworkActivity(existing, incoming);
    // duplicate method:url dropped; distinct id kept
    expect(merged).toHaveLength(2);
  });

  it('routing uses the REAL requestId: a second push under the real id cannot create a synthetic-id duplicate entry', async () => {
    // Capture time already recorded the entry under the real id.
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped({
      url: POST_URL, method: 'POST', status: 200,
      requestId: 'r1', sourceEventId: CLICK_EVENT_ID,
      documentRequest: true, mainFrame: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    });
    expect(ledger.size()).toBe(1);
    // Commit-time routing arrives with the SAME real id (G5-D passes the
    // row's real id first). holdStampedActivity must be idempotent.
    await ledger.holdStampedActivity({
      url: POST_URL, method: 'POST', status: 200,
      requestId: 'r1', sourceEventId: CLICK_EVENT_ID,
      documentRequest: true, mainFrame: true,
      captureOrigin: { tabId: TAB_ID, frameId: 0 },
    });
    expect(ledger.size()).toBe(1); // still one entry — no duplicate
  });
});
