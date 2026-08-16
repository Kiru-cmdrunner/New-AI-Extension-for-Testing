/**
 * CP5 — capture-inputs adapter unit tests.
 *
 * Pins the pure mapping production artifacts → BehaviorModelInputs:
 * stamped-request row mapping (status 0/null in-flight), evidence-window
 * epochization (R3 — exact event resolution or DROPPED, never guessed),
 * post-nav subset, outcome keyed pairs, immutability, ordering preservation.
 */
import { describe, expect, it } from 'vitest';
import { extractBehaviorModelInputs } from '../../../src/understanding/behavior-model/capture-inputs';
import type { CaptureArtifacts } from '../../../src/understanding/behavior-model/capture-inputs';
import type { StampedRequest } from '../../../src/background/evidence-attribution';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { ActionOutcome } from '../../../src/understanding/outcome/outcome-types';
import type { StateTransition } from '../../../src/understanding/state-builder/types';

const T = 1_700_000_000_000;

function click(
  id: string,
  over: { eventId?: string; t?: number; evidence?: unknown; members?: unknown[] } = {},
): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Click',
    trigger: { tag: 'BUTTON', accessibleName: id },
    triggerEvent: {
      eventId: over.eventId ?? `evt-p1-${id}`,
      eventType: 'click',
      timestamp: over.t ?? T,
      captureSeq: 1,
      captureOrigin: { tabId: 7, frameId: 0 },
      pageId: 'p1',
    },
    memberEvents: (over.members ?? []) as never,
    startTime: over.t ?? T,
    endTime: (over.t ?? T) + 100,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: over.evidence as never,
  } as unknown as ComponentInteraction;
}

function evidence(
  sourceEventId: string,
  durationMs: number,
  network: unknown[] = [],
): unknown {
  return {
    sourceEventId,
    windowId: `bev-${sourceEventId}`,
    window: { openedAt: 0.5, closedAt: 0.5 + durationMs / 1000, durationMs, endReason: 'finalized' },
    applicationEvidence: {
      domChanges: [{}, {}],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [{ accessibleName: 'Cart' }],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [{ type: 'pushState', fromUrl: 'a', toUrl: 'b', relativeTime: 1, batchIndex: null }],
      networkActivity: network,
      performanceCondition: null,
    },
  };
}

function outcome(id: string): ActionOutcome {
  return {
    interactionId: id,
    actionType: 'Click',
    actionTarget: id,
    outcome: 'success',
    confidence: 0.9,
    confidenceLevel: 'confirmed',
    supportingEvidence: [
      { kind: 'api-operation', result: 'success', weight: 0.4, detail: 'x', interactionId: id },
    ],
    resultingEntities: [],
    stateChanges: [],
  };
}

const artifacts = (stamped: StampedRequest[]): CaptureArtifacts => ({
  stampedRequests: stamped,
  postNavRecords: [
    { navEventId: 'nav-1', committedAt: T + 265, fromUrl: 'https://a/p', toUrl: 'https://a/cart', navType: 'form_submit' },
  ],
});

function stamped(over: Partial<StampedRequest> = {}): StampedRequest {
  return {
    url: 'https://a/api/cart',
    method: 'POST',
    status: 200,
    requestId: 'req-9001',
    sourceEventId: 'evt-p1-int-1',
    ...over,
  } as StampedRequest;
}

describe('extractBehaviorModelInputs — network rows', () => {
  it('maps stamped requests to GraphNetworkRow subset', () => {
    const out = extractBehaviorModelInputs(
      [click('int-1')],
      [],
      new Map(),
      artifacts([stamped()]),
    );
    expect(out.networkRows).toEqual([
      {
        requestId: 'req-9001',
        url: 'https://a/api/cart',
        method: 'POST',
        status: 200,
        sourceEventId: 'evt-p1-int-1',
        requestBody: undefined,
      },
    ]);
  });

  it('status 0 (in-flight at drain) → null status, row retained', () => {
    const out = extractBehaviorModelInputs(
      [click('int-1')],
      [],
      new Map(),
      artifacts([stamped({ status: 0 })]),
    );
    expect(out.networkRows[0].status).toBeNull();
    expect(out.networkRows).toHaveLength(1);
  });

  it('drops documentRequest/mainFrame/captureOrigin (attribution-internal fields)', () => {
    const out = extractBehaviorModelInputs(
      [click('int-1')],
      [],
      new Map(),
      artifacts([stamped({ documentRequest: true, mainFrame: true } as Partial<StampedRequest>)]),
    );
    expect(out.networkRows[0]).not.toHaveProperty('documentRequest');
    expect(out.networkRows[0]).not.toHaveProperty('mainFrame');
  });

  it('null artifacts → empty rows/windows/postNav, not an error', () => {
    const out = extractBehaviorModelInputs([click('int-1')], [], new Map(), null);
    expect(out.networkRows).toEqual([]);
    expect(out.evidenceWindows).toEqual([]);
    expect(out.postNavRecords).toEqual([]);
  });
});

describe('extractBehaviorModelInputs — attached-row harvest (T1 union)', () => {
  it('harvests ATTACHED rows from interaction evidence when the ledger snapshot is empty (delete-after-persist)', () => {
    // Production reality: the live attach path durably deletes ledger entries
    // after LIVE_INTERACTIONS persists — snapshotStamped() at STOP is empty,
    // but the interactions carry the stamped rows.
    const attached = [
      {
        url: 'https://a/cart/add',
        method: 'POST',
        status: 200,
        sourceEventId: 'evt-p1-int-1',
        requestId: 'req-77',
        requestBody: { asin: 'B0FFF9VPMN' },
        resourceType: 'xhr',
        source: 'webrequest',
      },
    ];
    const out = extractBehaviorModelInputs(
      [click('int-1', { evidence: evidence('evt-p1-int-1', 500, attached) })],
      [],
      new Map(),
      artifacts([]), // empty snapshot — the defect this test pins
    );
    expect(out.networkRows).toHaveLength(1);
    expect(out.networkRows[0]).toEqual({
      requestId: 'req-77',
      url: 'https://a/cart/add',
      method: 'POST',
      status: 200,
      sourceEventId: 'evt-p1-int-1',
      requestBody: { asin: 'B0FFF9VPMN' },
    });
  });

  it('skips unstamped attached rows (no requestId or no sourceEventId — main-world/PO rows)', () => {
    const attached = [
      { url: 'https://a/x', method: 'GET', status: 200, source: 'main-world' }, // no ids
      { url: 'https://a/y', method: 'GET', status: 200, sourceEventId: 'evt-p1-int-1' }, // no requestId
      { url: 'https://a/z', method: 'GET', status: 200, requestId: 'req-noevt' }, // no sourceEventId
    ];
    const out = extractBehaviorModelInputs(
      [click('int-1', { evidence: evidence('evt-p1-int-1', 500, attached) })],
      [],
      new Map(),
      null,
    );
    expect(out.networkRows).toEqual([]);
  });

  it('dedupes by requestId: same request in BOTH attached evidence and snapshot → one row (exactly-once)', () => {
    const attached = [
      {
        url: 'https://a/cart/add', method: 'POST', status: 200,
        sourceEventId: 'evt-p1-int-1', requestId: 'req-9', source: 'webrequest',
      },
    ];
    const out = extractBehaviorModelInputs(
      [click('int-1', { evidence: evidence('evt-p1-int-1', 500, attached) })],
      [],
      new Map(),
      artifacts([stamped({ requestId: 'req-9', status: 200 })]),
    );
    expect(out.networkRows).toHaveLength(1);
    expect(out.networkRows[0].requestId).toBe('req-9');
    expect(out.networkRows[0].status).toBe(200);
  });

  it('snapshot null-status duplicate enriched by attached real status (upgrade-only)', () => {
    const attached = [
      {
        url: 'https://a/cart/add', method: 'POST', status: 200,
        sourceEventId: 'evt-p1-int-1', requestId: 'req-9', source: 'webrequest',
      },
    ];
    const out = extractBehaviorModelInputs(
      [click('int-1', { evidence: evidence('evt-p1-int-1', 500, attached) })],
      [],
      new Map(),
      artifacts([stamped({ requestId: 'req-9', status: 0 })]), // in-flight snapshot copy
    );
    expect(out.networkRows).toHaveLength(1);
    expect(out.networkRows[0].status).toBe(200); // enriched from the attached copy
  });

  it('union: attached rows and distinct snapshot recovery rows both retained', () => {
    const attached = [
      {
        url: 'https://a/cart/add', method: 'POST', status: 200,
        sourceEventId: 'evt-p1-int-1', requestId: 'req-77', source: 'webrequest',
      },
    ];
    const out = extractBehaviorModelInputs(
      [click('int-1', { evidence: evidence('evt-p1-int-1', 500, attached) })],
      [],
      new Map(),
      artifacts([stamped({ requestId: 'req-recovered', url: 'https://a/nav-doc', method: 'GET' })]),
    );
    const ids = out.networkRows.map((r) => r.requestId).sort();
    expect(ids).toEqual(['req-77', 'req-recovered']);
  });
});

describe('extractBehaviorModelInputs — epochization (R3)', () => {
  it('resolves window epoch from the carrier trigger event; closed = opened + durationMs', () => {
    const a = click('int-1', { t: T, evidence: evidence('evt-p1-int-1', 1_000) });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    expect(out.evidenceWindows).toHaveLength(1);
    expect(out.evidenceWindows[0]).toMatchObject({
      interactionId: 'int-1',
      windowOpenedEpochMs: T,
      windowClosedEpochMs: T + 1_000,
    });
  });

  it('resolves from member events when the source is a member, not the trigger', () => {
    const member = { eventId: 'evt-p1-submit', eventType: 'submit', timestamp: T + 50 };
    const a = click('int-1', { t: T, members: [member], evidence: evidence('evt-p1-submit', 500) });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    expect(out.evidenceWindows[0].windowOpenedEpochMs).toBe(T + 50);
    expect(out.evidenceWindows[0].windowClosedEpochMs).toBe(T + 550);
  });

  it('DROPS the window when sourceEventId matches no trigger/member event (no guessed epoch)', () => {
    const a = click('int-1', { evidence: evidence('evt-p1-does-not-exist', 500) });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    expect(out.evidenceWindows).toEqual([]);
  });

  it('DROPS the window when the source event timestamp is invalid (NaN/non-number)', () => {
    const member = { eventId: 'evt-p1-bad', eventType: 'submit', timestamp: Number.NaN };
    const a = click('int-1', { t: T, members: [member], evidence: evidence('evt-p1-bad', 500) });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    expect(out.evidenceWindows).toEqual([]);
  });

  it('DROPS the window when durationMs is invalid', () => {
    const bad = evidence('evt-p1-int-1', 500) as { window: { durationMs: number } };
    bad.window.durationMs = Number.NaN;
    const a = click('int-1', { t: T, evidence: bad });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    expect(out.evidenceWindows).toEqual([]);
  });

  it('maps evidence summary fields (domChangeOverflow, surfaces, navigation, synthesized flag)', () => {
    const a = click('int-1', { t: T, evidence: evidence('evt-p1-int-1', 100) });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    const e = out.evidenceWindows[0].evidence;
    expect(e.domChangeCount).toBe(2);
    expect(e.domChangeOverflow).toBe(0);
    expect(e.newSurfaces).toEqual([{ accessibleName: 'Cart' }]);
    expect(e.navigation).toEqual([{ type: 'pushState', fromUrl: 'a', toUrl: 'b' }]);
    expect(e.synthesized).toBe(false);
  });

  it('flags page-reload-synthetic windows as synthesized', () => {
    const ev = evidence('evt-p1-int-1', 100) as { window: { endReason: string } };
    ev.window.endReason = 'page-reload-synthetic';
    const a = click('int-1', { t: T, evidence: ev });
    const out = extractBehaviorModelInputs([a], [], new Map(), null);
    expect(out.evidenceWindows[0].evidence.synthesized).toBe(true);
  });
});

describe('extractBehaviorModelInputs — post-nav + outcomes + purity', () => {
  it('post-nav subset drops navType (not consumed by the graph)', () => {
    const out = extractBehaviorModelInputs([click('int-1')], [], new Map(), artifacts([]));
    expect(out.postNavRecords).toEqual([
      { navEventId: 'nav-1', committedAt: T + 265, fromUrl: 'https://a/p', toUrl: 'https://a/cart' },
    ]);
  });

  it('wraps outcomes Map into keyed pairs, preserving insertion order', () => {
    const outcomes = new Map<string, ActionOutcome>([
      ['int-2', outcome('int-2')],
      ['int-1', outcome('int-1')],
    ]);
    const out = extractBehaviorModelInputs([click('int-1'), click('int-2')], [], outcomes, null);
    expect(out.actionOutcomes.map((o) => o.interactionId)).toEqual(['int-2', 'int-1']);
  });

  it('never mutates inputs (Map-aware deep snapshot)', () => {
    const a = click('int-1', { t: T, evidence: evidence('evt-p1-int-1', 250) });
    const outcomes = new Map([['int-1', outcome('int-1')]]);
    const st: StateTransition[] = [
      { interactionId: 'int-1', before: {} as never, after: {} as never, changes: [] },
    ];
    const arts = artifacts([stamped()]);
    const deep = (v: unknown) =>
      JSON.stringify(v, (_k, val) => (val instanceof Map ? { __map: [...val.entries()] } : val));
    const snap = deep([a, outcomes, st, arts]);
    extractBehaviorModelInputs([a], st, outcomes, arts);
    expect(deep([a, outcomes, st, arts])).toBe(snap);
  });

  it('deterministic: same inputs twice → deep-equal outputs', () => {
    const a = click('int-1', { t: T, evidence: evidence('evt-p1-int-1', 250) });
    const outcomes = new Map([['int-1', outcome('int-1')]]);
    const arts = artifacts([stamped()]);
    const one = extractBehaviorModelInputs([a], [], outcomes, arts);
    const two = extractBehaviorModelInputs([a], [], outcomes, arts);
    expect(one).toEqual(two);
  });
});
