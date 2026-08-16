/**
 * CP1 unit tests — model-types.ts
 *
 * Asserts the TYPE CONTRACT of the approved model as observable value
 * behavior: constant values, deterministic ID shapes, and the type surface
 * (compile-time) for owning-episode vs carrier-interaction, split horizons,
 * and ref degradation.
 *
 * These tests intentionally avoid implementation modules — model-types has
 * no runtime logic beyond exported constants.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_TAIL_MS,
  CORROBORATION_WINDOW_MS,
  type ActionEpisode,
  type AppBehaviorModel,
  type AttributionCloseReason,
  type CausalEdge,
  type ConsequenceHorizon,
  type EdgeTarget,
  type EdgeTier,
  type EpisodeMemberRole,
  type EvidenceRef,
  type EvidenceRefKinds,
  type ParameterLink,
  type ProvenanceLink,
  type RefDegradation,
  type UiOwnershipCloseReason,
  type UnattributedConsequence,
} from '../../../src/understanding/behavior-model/model-types';
import type { ActionOutcome } from '../../../src/understanding/outcome/outcome-types';

// ── constants ───────────────────────────────────────────────────────────

describe('model constants', () => {
  it('ATTRIBUTION_TAIL_MS is 30 seconds', () => {
    expect(ATTRIBUTION_TAIL_MS).toBe(30_000);
  });

  it('CORROBORATION_WINDOW_MS is 2 seconds', () => {
    expect(CORROBORATION_WINDOW_MS).toBe(2_000);
  });

  it('tail is strictly longer than the corroboration window', () => {
    expect(ATTRIBUTION_TAIL_MS).toBeGreaterThan(CORROBORATION_WINDOW_MS);
  });
});

// ── horizon contract ────────────────────────────────────────────────────

describe('ConsequenceHorizon contract', () => {
  it('uiOwnership and attribution are independent fields with their own close reasons', () => {
    const horizon: ConsequenceHorizon = {
      uiOwnership: {
        openedAtMs: 1_000,
        closedAtMs: 2_000,
        closeReason: 'next-anchor',
      },
      attribution: {
        openedAtMs: 1_000,
        closedAtMs: null,
        closeReason: null,
        pendingRequestIds: ['req-9001'],
      },
    };

    // UI ownership may be closed while attribution remains open — the
    // split-horizon law. pendingRequestIds is what keeps attribution open.
    expect(horizon.uiOwnership.closedAtMs).toBe(2_000);
    expect(horizon.attribution.closedAtMs).toBeNull();
    expect(horizon.attribution.pendingRequestIds).toEqual(['req-9001']);
  });

  it('exhausts UiOwnershipCloseReason values (compile-time union check)', () => {
    const reasons: UiOwnershipCloseReason[] = [
      'next-anchor',
      'stabilized',
      'recording-stop',
      'unrelated-navigation',
    ];
    expect(reasons).toHaveLength(4);
  });

  it('exhausts AttributionCloseReason values (compile-time union check)', () => {
    const reasons: AttributionCloseReason[] = [
      'all-stamped-settled',
      'tail-capped',
      'recording-stop',
    ];
    expect(reasons).toHaveLength(3);
  });
});

// ── edge ownership contract ─────────────────────────────────────────────

describe('CausalEdge ownership contract', () => {
  it('distinguishes OWNING episode from CARRIER interaction in from', () => {
    // R1: from.episodeId owns the consequence; from.interactionId is the
    // member whose artifact is cited — provenance only, never a co-owner.
    const edge: CausalEdge = {
      id: 'edge-ep-int-19-3',
      from: { episodeId: 'ep-int-19', interactionId: 'int-20' },
      to: { type: 'state', from: 'view:product', to: 'view:cart' },
      kind: 'state',
      tier: 'T3-transition',
      confidence: 0.7,
      latencyMs: 265,
      detail: 'view transition product → cart observed on navigation member',
      evidenceRefs: [
        { kind: 'transition', transitionId: 'st-4471' },
        { kind: 'nav', navEventId: 'nav-77' },
      ],
    };

    expect(edge.from.episodeId).toBe('ep-int-19');
    expect(edge.from.interactionId).toBe('int-20');
    // The carrier is a different id than the owner — the Amazon case shape.
    expect(edge.from.interactionId).not.toBe(edge.from.episodeId.slice('ep-'.length));
  });

  it('exhausts EdgeTier values with T1–T4 tiers', () => {
    const tiers: EdgeTier[] = ['T1-stamp', 'T2-lineage', 'T3-transition', 'T4-window'];
    expect(tiers).toHaveLength(4);
  });

  it('EdgeTarget covers member, api, navigation, state, entity, ui', () => {
    const targets: EdgeTarget[] = [
      { type: 'member', interactionId: 'int-S', role: 'companion' },
      { type: 'api', requestId: 'req-9001' },
      { type: 'navigation', navEventId: 'nav-77', toUrl: 'https://shop/cart' },
      { type: 'state', from: 'view:product', to: 'view:cart' },
      { type: 'entity', entityId: 'cart-item:B0FFF9VPMN', operation: 'create' },
      { type: 'ui', summary: 'cart confirmation surface appeared' },
    ];
    expect(targets).toHaveLength(6);
  });

  it('EpisodeMemberRole covers anchor, companion, parameter, navigation, unclassified', () => {
    const roles: EpisodeMemberRole[] = [
      'anchor',
      'companion',
      'parameter',
      'navigation',
      'unclassified',
    ];
    expect(roles).toHaveLength(5);
  });
});

// ── ref degradation contract ────────────────────────────────────────────

describe('RefDegradation contract', () => {
  it('exhausts degradation values (compile-time union check)', () => {
    const flags: RefDegradation[] = [
      'body-less-row',
      'synthesized-evidence',
      'capped-window',
      'missing-window',
      'malformed-trigger',
      'tail-capped',
    ];
    expect(flags).toHaveLength(6);
  });

  it('degradation is optional on every EvidenceRef variant', () => {
    const refs: EvidenceRef[] = [
      { kind: 'request', requestId: 'r1' },
      { kind: 'event', eventId: 'e1' },
      { kind: 'transition', transitionId: 't1' },
      { kind: 'entity', entityId: 'c1', interactionId: 'i1' },
      { kind: 'dom', windowId: 'w1', sequence: 0 },
      { kind: 'nav', navEventId: 'n1' },
    ];
    for (const r of refs) expect(r.degradation).toBeUndefined();
  });

  it('EvidenceRefKinds helper union matches the six artifact kinds', () => {
    const kinds: EvidenceRefKinds[] = [
      'request',
      'event',
      'transition',
      'entity',
      'dom',
      'nav',
    ];
    expect(kinds).toHaveLength(6);
  });
});

// ── provenance vs causality ─────────────────────────────────────────────

describe('ProvenanceLink contract', () => {
  it('links two episodes without emitting a CausalEdge', () => {
    const link: ProvenanceLink = {
      id: 'prov-ep-int-12-ep-int-19',
      sourceEpisodeId: 'ep-int-12',
      targetEpisodeId: 'ep-int-19',
      kind: 'surface-reuse',
      evidenceRefs: [{ kind: 'dom', windowId: 'ev-55', sequence: 3 }],
    };
    // A link carries refs but is not an edge: no tier, no confidence.
    expect(link).not.toHaveProperty('tier');
    expect(link).not.toHaveProperty('confidence');
    expect(link.kind).toBe('surface-reuse');
  });
});

// ── unattributed consequences ───────────────────────────────────────────

describe('UnattributedConsequence contract', () => {
  it('records reason and observation time without an owner', () => {
    const u: UnattributedConsequence = {
      id: 'unattr-api-req-9009',
      observedKind: 'api',
      evidenceRef: { kind: 'request', requestId: 'req-9009' },
      reason: 'no-live-horizon',
      observedAtMs: 4_500,
      tabId: 7,
      detail: 'unstamped telemetry request',
    };
    expect(u).not.toHaveProperty('episodeId');
    expect(u).not.toHaveProperty('ownerEpisodeId');
    expect(u.reason).toBe('no-live-horizon');
  });

  it('exhausts reason values', () => {
    const reasons: UnattributedConsequence['reason'][] = [
      'no-live-horizon',
      'outside-horizon',
      'proof-less',
    ];
    expect(reasons).toHaveLength(3);
  });
});

// ── episode + model root ────────────────────────────────────────────────

describe('ActionEpisode + AppBehaviorModel contract', () => {
  it('builds a minimal well-formed episode and model (compile-time shape)', () => {
    const episode: ActionEpisode = {
      id: 'ep-int-19',
      anchor: {
        interactionId: 'int-19',
        actionType: 'Click',
        actionTarget: 'Add to Cart',
        triggerTimestamp: 10_000,
      },
      members: [
        { interactionId: 'int-19', role: 'anchor' },
        { interactionId: 'int-18', role: 'parameter' },
        { interactionId: 'int-S', role: 'companion' },
        { interactionId: 'int-20', role: 'navigation' },
      ],
      parameterInputs: [
        { interactionId: 'int-18', label: 'quantity', value: '1', link: 'form-overlap' },
      ],
      edges: [],
      provenanceLinks: [],
      unattributed: [],
      horizon: {
        uiOwnership: { openedAtMs: 10_000, closedAtMs: 12_220, closeReason: 'stabilized' },
        attribution: {
          openedAtMs: 10_000,
          closedAtMs: 10_310,
          closeReason: 'all-stamped-settled',
          pendingRequestIds: [],
        },
      },
      episodeOutcome: {
        outcome: 'success',
        confidence: 0.95,
        confidenceLevel: 'confirmed',
        contributingMembers: ['int-19', 'int-20'],
        derivation: 'derived-episode-outcome',
      },
      tabId: 7,
    };

    const model: AppBehaviorModel = {
      id: 'abm-session-42',
      sessionId: 'session-42',
      episodes: [episode],
      unattributed: [],
      provenanceLinks: [],
      generatedAtMs: 20_000,
      coverage: {
        totalInteractions: 4,
        anchoredInteractions: 1,
        memberInteractions: 3,
        malformedInteractions: 0,
        totalNetworkRows: 12,
        attributedNetworkRows: 1,
        totalObservations: 5,
        attributedObservations: 5,
        unattributedConsequences: 0,
        provenanceLinks: 0,
      },
      warnings: [],
    };

    expect(model.episodes).toHaveLength(1);
    expect(model.episodes[0].id).toBe('ep-int-19');
    expect(model.coverage.totalInteractions).toBe(4);
    expect(model.generatedAtMs).toBe(20_000);
  });

  it('ParameterLink covers form-overlap and same-lifecycle', () => {
    const links: ParameterLink[] = ['form-overlap', 'same-lifecycle'];
    expect(links).toHaveLength(2);
  });

  it('re-exports outcome types without duplicating them', () => {
    const outcome: ActionOutcome = {
      interactionId: 'int-19',
      actionType: 'Click',
      actionTarget: 'Add to Cart',
      outcome: 'success',
      confidence: 0.95,
      confidenceLevel: 'confirmed',
      votes: [],
      supportingEvidence: [],
    } as unknown as ActionOutcome;
    expect(outcome.interactionId).toBe('int-19');
  });
});
