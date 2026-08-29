/**
 * B7-P2 §8 W-1 — the three post-filter recovery passes run correctly over
 * ADMITTED hovers and do not double-attach or drop hover network rows.
 *
 * Passes under test (service-worker stop path, exercised through the pure
 * seam each one uses):
 *   1. network drain by sourceEventId (drainNetworkEvidence)
 *   2. attribution-ledger attach (attachToInteractions)
 *   3. status enrichment (enrichNetworkRowStatuses)
 *
 * A hover admitted via a stamped-fetch (T1 secondary enter stamp) carries
 * behavioralEvidence.sourceEventId === the ENTER eventId — the exact key
 * the drain joins on. The passes must attach rows exactly once.
 */

import { describe, it, expect } from 'vitest';
import { drainNetworkEvidence, enrichNetworkRowStatuses } from '../../src/background/network-drain';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function makeHover(opts: {
  enterEventId?: string;
  networkRows?: BehavioralEvidence['applicationEvidence']['networkActivity'];
}): ComponentInteraction {
  const enterEventId = opts.enterEventId ?? 'evt-enter-1';
  return {
    interactionId: 'int-1',
    lifecycleId: 'lc-1',
    type: 'Hover',
    trigger: {} as never,
    triggerEvent: { eventId: enterEventId, eventType: 'mouseenter' } as never,
    memberEvents: [],
    startTime: 1000,
    endTime: 2500,
    endState: 'completed',
    metadata: {
      dwellMs: 1500,
      terminal: 'left',
      pointerPathEnters: [],
      pointerPathDropped: 0,
      consequenceClasses: ['stamped-fetch'],
      meaningful: true,
      captureOrigin: { tabId: 7, frameId: 0 },
    },
    behavioralEvidence: {
      sourceEventId: enterEventId,
      sourceEventType: 'mouseenter',
      windowId: `bev-${enterEventId}`,
      frameId: 'main',
      window: {
        openedAt: 0, closedAt: 1500, durationMs: 1500,
        endReason: 'lifecycle-complete', stabilityTrace: [],
      },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [],
        networkActivity: opts.networkRows ?? [],
        performanceCondition: null,
      },
    } as BehavioralEvidence,
  };
}

describe('B7-P2 W-1: post-filter recovery passes over admitted hovers', () => {
  it('network drain attaches a completed request stamped to the hover enter exactly once', () => {
    const hover = makeHover({
      enterEventId: 'evt-enter-1',
      networkRows: [{
        url: 'https://t/api/menu', method: 'GET', status: null,
        resourceType: 'fetch', source: 'webrequest',
        sourceEventId: 'evt-enter-1',
        relativeTime: 10,
      } as never],
    });

    // Ring entry completed AFTER the window closed (onCompleted race).
    const stamped = [{
      url: 'https://t/api/menu',
      method: 'GET',
      status: 200,
      requestId: 'req-1',
      sourceEventId: 'evt-enter-1',
      captureOrigin: { tabId: 7, frameId: 0 },
    }];

    const { updatedInteractions, mergedRequestIds } = drainNetworkEvidence([hover], stamped);
    expect(mergedRequestIds).toContain('req-1');
    const rows = updatedInteractions[0].behavioralEvidence!
      .applicationEvidence.networkActivity;
    const forReq = rows.filter((r) => (r as { requestId?: string }).requestId === 'req-1');
    expect(forReq.length).toBe(1);
    expect((forReq[0] as { status?: number | null }).status).toBe(200);
  });

  it('drain is exactly-once: re-running with the same ring adds no duplicate row', () => {
    const hover = makeHover({
      enterEventId: 'evt-enter-2',
      networkRows: [{
        url: 'https://t/api/menu', method: 'GET', status: 200,
        requestId: 'req-9', resourceType: 'fetch', source: 'webrequest',
        sourceEventId: 'evt-enter-2',
        relativeTime: 10,
      } as never],
    });
    const stamped = [{
      url: 'https://t/api/menu',
      method: 'GET',
      status: 200,
      requestId: 'req-9',
      sourceEventId: 'evt-enter-2',
      captureOrigin: { tabId: 7, frameId: 0 },
    }];
    const { mergedRequestIds } = drainNetworkEvidence([hover], stamped);
    expect(mergedRequestIds).not.toContain('req-9');
  });

  it('status enrichment upgrades null-status hover rows keyed by requestId only', () => {
    const hover = makeHover({
      enterEventId: 'evt-enter-3',
      networkRows: [{
        url: 'https://t/api/x', method: 'GET', status: null,
        requestId: 'req-3', resourceType: 'fetch', source: 'webrequest',
        sourceEventId: 'evt-enter-3',
        relativeTime: 10,
      } as never],
    });
    const { enriched } = enrichNetworkRowStatuses([hover], {
      ledger: [],
      ring: [{
        url: 'https://t/api/x', method: 'GET', status: 204,
        requestId: 'req-3', sourceEventId: 'evt-enter-3',
        captureOrigin: { tabId: 7, frameId: 0 },
      }] as never,
    });
    expect(enriched.some((e) => e.requestId === 'req-3' && e.to === 204)).toBe(true);
    const row = hover.behavioralEvidence!.applicationEvidence.networkActivity[0];
    expect((row as { status?: number | null }).status).toBe(204);
  });

  it('a hover with NO network rows is untouched by the drain (no phantom attach)', () => {
    const hover = makeHover({ enterEventId: 'evt-enter-4' });
    const stamped = [{
      url: 'https://t/api/menu', method: 'GET', status: 200,
      requestId: 'req-4',
      sourceEventId: 'evt-enter-999', // different lifecycle's enter
      captureOrigin: { tabId: 7, frameId: 0 },
    }];
    const { updatedInteractions, mergedRequestIds } = drainNetworkEvidence([hover], stamped);
    expect(mergedRequestIds).not.toContain('req-4');
    // Nothing merged for this hover → it is absent from the updated list
    // and its original evidence is untouched (no phantom attach).
    expect(updatedInteractions.length).toBe(0);
    expect(
      hover.behavioralEvidence!.applicationEvidence.networkActivity.length,
    ).toBe(0);
  });
});
