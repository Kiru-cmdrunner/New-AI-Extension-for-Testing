/**
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §5b (R-I1…R-I6), §12 AC-22, §13 row 2b
 * Pin 7 of §14 — hover-reveal-then-click-independence.
 *
 * Hover anchor "A" → owned surface reveals item "B" → user clicks B:
 * TWO independent interactions. The Click must never absorb, replace,
 * rename, or delete the Hover, and vice versa. Generic structural markup.
 */

import { describe, it, expect } from 'vitest';
import {
  filterProductionInteractions,
  isProductionInteraction,
  buildEvidenceDisclosures,
} from '../../src/presentation/output-adapter';
import { projectInteractions } from '../../src/runtime/projection-engine';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function makeHover(over: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    lifecycleId: 'lc-1',
    type: 'Hover',
    trigger: {} as never,
    triggerEvent: {
      eventId: 'evt-1', eventType: 'mouseenter', captureSeq: 1, target: { stableId: 'nav-a', tag: 'DIV' } as never,
    } as never,
    memberEvents: [],
    startTime: 1000,
    endTime: 2500,
    endState: 'completed',
    metadata: {
      terminal: 'consumed-by-click',
      dwellMs: 1500,
      hoverQualification: {
        verdict: 'evidenced',
        evidenceClass: 'reveal',
        evidenceReason: 'reveal: aria-expanded false→true on joined [role=button] descendant',
        anchorFacts: { resolution: 'self', anchorKey: 'id:nav-a', clickAnchorKey: 'id:nav-a', hoverReveal: false, shaped: true },
        factSummary: { domChangesInOwnedSet: 1, domChangesTotal: 3, newSurfacesJoined: 1, pointerPathEnters: 1, networkRows: 0 },
      },
      evidenceReason: 'reveal: aria-expanded false→true on joined [role=button] descendant',
    },
    behavioralEvidence: {
      sourceEventId: 'evt-1', sourceEventType: 'mouseenter', windowId: 'bev-evt-1', frameId: 'main',
      window: { openedAt: 1000, openedBatch: 1, closedAt: 2500, durationMs: 1500, endReason: 'lifecycle-complete', stabilityTrace: [] },
      targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [], networkActivity: [], performanceCondition: null,
      },
    } as BehavioralEvidence,
    ...over,
  };
}

function makeClick(over: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-2',
    lifecycleId: 'lc-2',
    type: 'Click',
    trigger: {} as never,
    triggerEvent: {
      eventId: 'evt-2', eventType: 'click', captureSeq: 2, target: { stableId: 'item-b', tag: 'A' } as never,
    } as never,
    memberEvents: [],
    startTime: 2600,
    endTime: 2600,
    endState: 'completed',
    metadata: { targetName: 'Item B', targetTag: 'A' },
    behavioralEvidence: undefined,
    ...over,
  };
}

describe('R-I1…R-I6: Services → Book Flight independence', () => {
  it('both interactions survive admission; hover admitted by recorded verdict; click admitted unconditionally', () => {
    const hover = makeHover();
    const click = makeClick();
    const admitted = filterProductionInteractions([hover, click]);

    expect(admitted.some((i) => i.type === 'Hover')).toBe(true);
    expect(admitted.some((i) => i.type === 'Click')).toBe(true);
    expect(admitted.length).toBe(2);
  });

  it('R-I1: the click never absorbs/renames/deletes the hover — identities and metadata intact', () => {
    const hover = makeHover();
    const click = makeClick();
    const admitted = filterProductionInteractions([hover, click]);
    const h = admitted.find((i) => i.type === 'Hover')!;
    expect(h.interactionId).toBe('int-1');
    expect(h.triggerEvent.eventId).toBe('evt-1');
    expect((h.metadata as Record<string, any>).hoverQualification.verdict).toBe('evidenced');
    expect(String(h.metadata.evidenceReason)).toContain('aria-expanded');
    expect(h.metadata.terminal).toBe('consumed-by-click');
  });

  it('R-I2: the hover never claims the click — projection mints no hover-carried click twin', () => {
    const hover = makeHover();
    const click = makeClick();
    const rows = [
      { eventId: 'evt-1', eventType: 'mouseenter', disposition: 'claimed', claimedBy: 'int-1', targetIdentity: { stableId: 'nav-a', tag: 'DIV' } as never },
      { eventId: 'evt-2', eventType: 'click', disposition: 'claimed', claimedBy: 'int-2', targetIdentity: { stableId: 'item-b', tag: 'A' } as never },
    ];
    const ledgerStub = {
      entries: () => rows,
      getByDisposition: (s: string) => rows.filter((r) => r.disposition === s),
    } as never;
    const out = projectInteractions(ledgerStub, [hover, click]);
    const types = out.interactions.map((i: any) => i.type);
    expect(types).toContain('Hover');
    expect(types).toContain('Click');
    // exactly one of each — no twin, no loss
    expect(types.filter((t: string) => t === 'Click').length).toBe(1);
    expect(types.filter((t: string) => t === 'Hover').length).toBe(1);
  });

  it('R-I3/R-I6: order preserved — hover before click in output', () => {
    const hover = makeHover();
    const click = makeClick();
    const rows = [
      { eventId: 'evt-1', eventType: 'mouseenter', disposition: 'claimed', claimedBy: 'int-1', targetIdentity: { stableId: 'nav-a', tag: 'DIV' } as never },
      { eventId: 'evt-2', eventType: 'click', disposition: 'claimed', claimedBy: 'int-2', targetIdentity: { stableId: 'item-b', tag: 'A' } as never },
    ];
    const ledgerStub = {
      entries: () => rows,
      getByDisposition: (s: string) => rows.filter((r) => r.disposition === s),
    } as never;
    const out = projectInteractions(ledgerStub, [hover, click]);
    const idxHover = out.interactions.findIndex((i: any) => i.type === 'Hover');
    const idxClick = out.interactions.findIndex((i: any) => i.type === 'Click');
    expect(idxHover).toBeLessThan(idxClick);
  });

  it('hover with gesture-only verdict is NOT admitted but the click still is (RC-D closed)', () => {
    const hover = makeHover({
      metadata: {
        terminal: 'consumed-by-click',
        hoverQualification: {
          verdict: 'gesture-only',
          evidenceClass: null,
          evidenceReason: 'gesture-only: no target-local consequence in enter window',
          anchorFacts: { resolution: 'self', anchorKey: 'id:nav-a', clickAnchorKey: 'id:nav-a', hoverReveal: false, shaped: true },
          factSummary: { domChangesInOwnedSet: 0, domChangesTotal: 0, newSurfacesJoined: 0, pointerPathEnters: 0, networkRows: 4 },
        },
        evidenceReason: 'gesture-only: no target-local consequence in enter window',
      },
    });
    const click = makeClick();
    const admitted = filterProductionInteractions([hover, click]);
    expect(admitted.length).toBe(1);
    expect(admitted[0].type).toBe('Click');
  });

  it('isProductionInteraction reads ONLY endState + recorded verdict (D2 legacy = not admitted)', () => {
    const legacy = makeHover({
      metadata: { terminal: 'left' }, // legacy row: no hoverQualification key
    });
    expect(isProductionInteraction(legacy)).toBe(false);
  });
});

describe('AC-23/25: evidenceDisclosures never affect classification', () => {
  it('zero-evidence and rich-evidence cards of the same type differ ONLY in disclosures', () => {
    const bare = makeClick();
    const rich = makeClick({
      interactionId: 'int-3',
      behavioralEvidence: {
        sourceEventId: 'evt-2', sourceEventType: 'click', windowId: 'bev-evt-2', frameId: 'main',
        window: { openedAt: 0, closedAt: 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
        targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
        applicationEvidence: {
          domChanges: [{} as never], domChangeOverflow: 0, coarseMode: false,
          newSurfaces: [{} as never], removedSurfaces: [], visibilityChanges: [{} as never],
          navigation: [{} as never], networkActivity: [{} as never], performanceCondition: null,
        },
      } as BehavioralEvidence,
    });

    // classification identical
    expect(isProductionInteraction(bare)).toBe(isProductionInteraction(rich));

    // disclosures differ
    const d1 = buildEvidenceDisclosures(bare);
    const d2 = buildEvidenceDisclosures(rich);
    expect(d1.domChanges.available).toBe(false);
    expect(d2.domChanges.available).toBe(true);
    expect(d2.network.available).toBe(true);
  });
});
