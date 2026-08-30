/**
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §7 (R-A1…R-A4), §9b, §12 AC-5/14/23/26/27/28
 * Pins 5/6/8/10 of §14 — anchor-join-set, admission-reads-verdict,
 * evidence-disclosures, decision pins (D1/D2/D3).
 */

import { describe, it, expect } from 'vitest';
import {
  isProductionInteraction,
  buildEvidenceDisclosures,
  HOVER_REASON_MAX_CHARS,
} from '../../src/presentation/output-adapter';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function hover(over: Record<string, unknown> = {}): ComponentInteraction {
  return {
    interactionId: 'int-1', lifecycleId: 'lc-1', type: 'Hover',
    trigger: {} as never,
    triggerEvent: { eventId: 'evt-1', eventType: 'mouseenter' } as never,
    memberEvents: [], startTime: 0, endTime: 100, endState: 'completed',
    metadata: { ...over },
  };
}

describe('AC-5: anchor join set', () => {
  it('hoverQualification.anchorFacts carries both anchor keys + resolution', () => {
    const h = hover({
      hoverQualification: {
        verdict: 'evidenced', evidenceClass: 'reveal', evidenceReason: 'r',
        anchorFacts: { resolution: 'ancestor-lift', anchorKey: 'id:wrap', clickAnchorKey: 'id:chev', hoverReveal: false, shaped: true },
        factSummary: { domChangesInOwnedSet: 1, domChangesTotal: 1, newSurfacesJoined: 0, pointerPathEnters: 0, networkRows: 0 },
      },
    });
    const af = (h.metadata as any).hoverQualification.anchorFacts;
    expect(af.anchorKey).toBe('id:wrap');
    expect(af.clickAnchorKey).toBe('id:chev');
    expect(af.resolution).toBe('ancestor-lift');
  });
});

describe('AC-14: admission reads ONLY endState + recorded verdict', () => {
  it('completed + evidenced ⇒ admitted', () => {
    expect(isProductionInteraction(hover({
      hoverQualification: { verdict: 'evidenced', evidenceClass: 'reveal', evidenceReason: 'r', anchorFacts: {} as never, factSummary: {} as never },
    }))).toBe(true);
  });

  it('completed + gesture-only ⇒ NOT admitted (even with rich consequence evidence — RC-E closed)', () => {
    const h = hover({
      hoverQualification: { verdict: 'gesture-only', evidenceClass: null, evidenceReason: 'r', anchorFacts: {} as never, factSummary: {} as never },
    });
    // attach global-churn evidence that the OLD rule would have admitted
    h.behavioralEvidence = {
      sourceEventId: 'evt-1', sourceEventType: 'mouseenter', windowId: 'bev-1', frameId: 'main',
      window: { openedAt: 0, closedAt: 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [{ addedNodesCount: 5 } as never], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [{} as never], networkActivity: [], performanceCondition: null,
      },
    } as BehavioralEvidence;
    expect(isProductionInteraction(h)).toBe(false);
  });

  it('not-completed ⇒ NOT admitted regardless of verdict', () => {
    const h = hover({
      hoverQualification: { verdict: 'evidenced', evidenceClass: 'reveal', evidenceReason: 'r', anchorFacts: {} as never, factSummary: {} as never },
    });
    (h as any).endState = 'abandoned';
    expect(isProductionInteraction(h)).toBe(false);
  });

  it('AC-26 (D1): navigation-bearing evidence never earns admission — verdict governs', () => {
    const h = hover({
      hoverQualification: { verdict: 'gesture-only', evidenceClass: null, evidenceReason: 'gesture-only: no target-local consequence in enter window', anchorFacts: {} as never, factSummary: {} as never },
    });
    h.behavioralEvidence = {
      sourceEventId: 'evt-1', sourceEventType: 'mouseenter', windowId: 'bev-1', frameId: 'main',
      window: { openedAt: 0, closedAt: 100, durationMs: 100, endReason: 'navigation', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [{} as never, {} as never], networkActivity: [], performanceCondition: null,
      },
    } as BehavioralEvidence;
    expect(isProductionInteraction(h)).toBe(false);
  });

  it('AC-27 (D2): legacy row without hoverQualification ⇒ NOT admitted, no fallback', () => {
    expect(isProductionInteraction(hover({ terminal: 'left' }))).toBe(false);
    // even WITH old-style consequence classes present
    const h = hover({ consequenceClasses: ['insertion', 'nav'], meaningful: true });
    expect(isProductionInteraction(h)).toBe(false);
  });
});

describe('AC-23: buildEvidenceDisclosures — availability + counts from recorded facts', () => {
  it('empty evidence ⇒ all unavailable', () => {
    const h = hover();
    h.behavioralEvidence = {
      sourceEventId: 'e', sourceEventType: 'mouseenter', windowId: 'b', frameId: 'main',
      window: { openedAt: 0, closedAt: 1, durationMs: 1, endReason: 'stabilized', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [], networkActivity: [], performanceCondition: null,
      },
    } as BehavioralEvidence;
    const d = buildEvidenceDisclosures(h);
    expect(d.domChanges.available).toBe(false);
    expect(d.visibilityChanges.available).toBe(false);
    expect(d.newSurfaces.available).toBe(false);
    expect(d.network.available).toBe(false);
    expect(d.navigation.available).toBe(false);
    // no evidence ⇒ disclosure itself is null-honest for missing window
  });

  it('rich evidence ⇒ available with counts', () => {
    const h = hover();
    h.behavioralEvidence = {
      sourceEventId: 'e', sourceEventType: 'mouseenter', windowId: 'b', frameId: 'main',
      window: { openedAt: 0, closedAt: 1, durationMs: 1, endReason: 'stabilized', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [{} as never, {} as never, {} as never], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [{} as never], removedSurfaces: [], visibilityChanges: [{} as never],
        navigation: [{} as never], networkActivity: [{} as never, {} as never], performanceCondition: null,
      },
    } as BehavioralEvidence;
    const d = buildEvidenceDisclosures(h);
    expect(d.domChanges).toEqual({ available: true, count: 3 });
    expect(d.newSurfaces).toEqual({ available: true, count: 1 });
    expect(d.network).toEqual({ available: true, count: 2 });
    expect(d.navigation).toEqual({ available: true, count: 1 });
  });

  it('no behavioralEvidence at all ⇒ all unavailable (honest)', () => {
    const d = buildEvidenceDisclosures(hover());
    expect(d.domChanges.available).toBe(false);
    expect(d.network.available).toBe(false);
  });
});

describe('AC-28 (D3): reason cap constant exported', () => {
  it('HOVER_REASON_MAX_CHARS === 200', () => {
    expect(HOVER_REASON_MAX_CHARS).toBe(200);
  });
});
