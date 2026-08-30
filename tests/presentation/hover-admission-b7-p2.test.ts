/**
 * B7-P2 §5.2.7 admission rule — SUPERSEDED by HEC v1 (hover-capture
 * evidence contract, .drytis/specs/hover-capture-evidence-contract-v1.md
 * §9 + locked decisions D1/D2, 2026-08-30).
 *
 * admit ⇔ endState === 'completed' ∧ metadata/behavioralEvidence
 *         carries hoverQualification.verdict === 'evidenced'
 *
 * The verdict is computed ONCE at hover-window close in the content script
 * (capture time) from the T1b baseline + recorded window facts. STOP reads
 * the recorded verdict — it never re-derives, re-filters, or re-classifies
 * (§9; RC-E root cause closed). Legacy rows without a recorded verdict are
 * NOT admitted (D2) — deriveConsequenceClasses is demoted to display-only.
 */

import { describe, it, expect } from 'vitest';
import {
  filterProductionInteractions,
  isProductionInteraction,
  deriveConsequenceClasses,
} from '../../src/presentation/output-adapter';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { BehavioralEvidence as BE } from '../../src/shared/behavioral-evidence-types';

function qual(verdict: 'evidenced' | 'gesture-only'): {
  verdict: 'evidenced' | 'gesture-only';
  evidenceClass: string | null;
  evidenceReason: string;
  anchorFacts: unknown;
  factSummary: unknown;
} {
  return {
    verdict,
    evidenceClass: verdict === 'evidenced' ? 'reveal' : null,
    evidenceReason: verdict === 'evidenced'
      ? 'reveal: aria-expanded false→true on joined element'
      : 'gesture-only: no target-local consequence in enter window',
    anchorFacts: {
      resolution: 'self', anchorKey: 'id:menu', clickAnchorKey: 'id:menu',
      hoverReveal: false, shaped: true,
    },
    factSummary: {
      domChangesInOwnedSet: verdict === 'evidenced' ? 1 : 0,
      domChangesTotal: verdict === 'evidenced' ? 1 : 0,
      newSurfacesJoined: 0, pointerPathEnters: 0, networkRows: 0,
    },
  };
}

function makeHover(opts: {
  endState?: string;
  evidence?: Partial<BE>;
  metadata?: Record<string, unknown>;
}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    lifecycleId: 'lc-1',
    type: 'Hover',
    trigger: {} as never,
    triggerEvent: {
      eventId: 'evt-src-1',
      eventType: 'mouseenter',
    } as never,
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: (opts.endState ?? 'completed') as ComponentInteraction['endState'],
    metadata: { dwellMs: 500, ...opts.metadata },
    behavioralEvidence: opts.evidence
      ? ({
          sourceEventId: 'evt-src-1',
          sourceEvidenceType: 'mouseenter',
          windowId: 'bev-evt-src-1',
          frameId: 'main',
          window: {
            openedAt: 0, closedAt: 1000, durationMs: 1000,
            endReason: 'lifecycle-complete', stabilityTrace: [],
          },
          targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, focusMovement: null },
          applicationEvidence: {
            domChanges: [], domChangeOverflow: 0, coarseMode: false,
            newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
            navigation: [], networkActivity: [],
            performanceCondition: null,
            ...opts.evidence.applicationEvidence,
          },
          ...opts.evidence,
        } as BehavioralEvidence)
      : undefined,
  };
}

describe('B7-P2 admission — HEC v1 §9 re-baseline (verdict-gated)', () => {
  it('evidenced verdict admits a completed hover (reveal facts present)', () => {
    const hover = makeHover({ evidence: { hoverQualification: qual('evidenced') } as never });
    expect(isProductionInteraction(hover)).toBe(true);
  });

  it('gesture-only verdict → NOT admitted even with domChanges present', () => {
    // Global churn used to admit via deriveConsequenceClasses; the recorded
    // verdict is now the only gate (RC-E closed, AC-11).
    const hover = makeHover({
      evidence: {
        hoverQualification: qual('gesture-only'),
        applicationEvidence: {
          domChanges: [{
            types: ['childList'] as never, targetPath: 'body/div#unrelated', targetTag: 'DIV',
            shadowContext: null, changedAttributes: [], attributeDeltas: {},
            addedNodesCount: 3, removedNodesCount: 0, characterDataDelta: null,
            firstMutationAt: 30, lastMutationAt: 40, rawMutationCount: 1,
            firstBatchIndex: 1, lastBatchIndex: 1,
          }],
        },
      } as never,
    });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('D2 legacy row (no hoverQualification recorded) → NOT admitted', () => {
    const hover = makeHover({
      evidence: {
        applicationEvidence: {
          newSurfaces: [{
            path: 'div#menu', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'Products',
            shadowContext: null, descendantCount: 4, relativeTime: 50, batchIndex: 2,
            kind: 'added' as const, emergence: 'revealed' as const,
          }],
        },
      } as never,
    });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('D1: nav consequence NEVER earns evidenced — nav is display metadata', () => {
    const hover = makeHover({
      evidence: {
        hoverQualification: qual('gesture-only'),
        applicationEvidence: {
          navigation: [{
            type: 'spa' as never, fromUrl: '/a', toUrl: '/b',
            relativeTime: 20, batchIndex: 1,
          }],
        },
      } as never,
    });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('abandoned endState + evidenced verdict → NOT admitted (completion still required)', () => {
    const hover = makeHover({
      endState: 'abandoned',
      evidence: { hoverQualification: qual('evidenced') } as never,
    });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('NO evidence at all → NOT admitted (gesture-only hover)', () => {
    const hover = makeHover({});
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('empty evidence (all arrays empty, no qualification) → NOT admitted', () => {
    const hover = makeHover({ evidence: {} });
    expect(isProductionInteraction(hover)).toBe(false);
  });

  it('metadata.meaningful is IGNORED as a stored judgment (old field never gates)', () => {
    const hover = makeHover({ metadata: { meaningful: true } });
    expect(isProductionInteraction(hover)).toBe(false);
    const hover2 = makeHover({
      evidence: { hoverQualification: qual('evidenced') } as never,
      metadata: { meaningful: false },
    });
    expect(isProductionInteraction(hover2)).toBe(true);
  });

  it('metadata.hoverQualification (projected copy) also admits when behavioralEvidence lost', () => {
    const hover = makeHover({
      metadata: {
        hoverQualification: qual('evidenced'),
        evidenceReason: qual('evidenced').evidenceReason,
      },
    });
    expect(isProductionInteraction(hover)).toBe(true);
  });

  it('deriveConsequenceClasses demoted to display-only — still derivable for the UI', () => {
    const ev = {
      applicationEvidence: {
        newSurfaces: [{
          path: 'div#m', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'M',
          shadowContext: null, descendantCount: 1, relativeTime: 10, batchIndex: 1,
          kind: 'added' as const, emergence: 'revealed' as const,
        }],
        domChanges: [{
          types: ['childList'] as never, targetPath: 'b/div', targetTag: 'DIV',
          shadowContext: null, changedAttributes: [], attributeDeltas: {},
          addedNodesCount: 2, removedNodesCount: 1, characterDataDelta: null,
          firstMutationAt: 1, lastMutationAt: 2, rawMutationCount: 1,
          firstBatchIndex: 1, lastBatchIndex: 1,
        }],
      },
    } as never;
    const classes = deriveConsequenceClasses(makeHover({ evidence: ev }));
    expect(classes).toEqual(expect.arrayContaining(['reveal', 'insertion', 'removal']));
    expect(deriveConsequenceClasses(makeHover({ evidence: {} }))).toEqual([]);
    expect(deriveConsequenceClasses(makeHover({}))).toEqual([]);
  });
});

describe('B7-P2: admission via filterProductionInteractions', () => {
  it('filter admits evidenced completed hovers and rejects gesture-only ones', () => {
    const admitted = makeHover({ evidence: { hoverQualification: qual('evidenced') } as never });
    const gestureOnly = makeHover({
      evidence: { hoverQualification: qual('gesture-only') } as never,
    });
    const out = filterProductionInteractions([admitted, gestureOnly]);
    expect(out.length).toBe(1);
    expect(out[0].interactionId).toBe('int-1');
  });
});
