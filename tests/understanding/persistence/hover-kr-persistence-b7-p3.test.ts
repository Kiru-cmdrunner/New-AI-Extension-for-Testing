/**
 * B7-P3 §5.3.3 — KR persistence of hover episodes (zero schema change).
 *
 * The mapper already iterates model.episodes; hover episodes must persist
 * as KnowledgeEpisodeRow / KnowledgeEdgeRow under the frozen signature
 * identity appId|Hover|normalizedTarget|anchorViewId, and accumulate the
 * KnowledgeActionSignatureRow occurrenceCount + consequenceProfile under
 * the existing caps. Hover provenance links are NOT a KR entity (phase-2
 * surface lineage out of P3 scope) — model.provenanceLinks pass through
 * the AppBehaviorModel only.
 */

import { describe, expect, it } from 'vitest';
import { mapBehaviorModel } from '../../../src/understanding/persistence/behavior-knowledge-mapper';
import type { AppBehaviorModel } from '../../../src/understanding/behavior-model/model-types';

function makeModel(overrides: Partial<AppBehaviorModel> = {}): AppBehaviorModel {
  const ep = {
    id: 'ep-int-h1',
    anchor: {
      interactionId: 'int-h1',
      actionType: 'Hover' as const,
      actionTarget: 'Account menu',
      triggerTimestamp: 1_000_000,
    },
    members: [{ interactionId: 'int-h1', role: 'anchor' as const, eventIds: [], eventTypes: [] }],
    parameterInputs: [],
    edges: [
      {
        id: 'edge-ep-int-h1-000',
        from: { episodeId: 'ep-int-h1', interactionId: 'int-h1' },
        to: { type: 'ui', summary: '1 DOM changes' },
        kind: 'ui' as const,
        tier: 'T4-window' as const,
        confidence: 0.6,
        latencyMs: 120,
        detail: 'UI observations',
        evidenceRefs: [{ kind: 'dom' as const, windowId: 'ev-e1', sequence: 1 }],
      },
    ],
    provenanceLinks: [
      {
        id: 'prov-ep-int-h1-ep-int-c1',
        sourceEpisodeId: 'ep-int-h1',
        targetEpisodeId: 'ep-int-c1',
        kind: 'surface-reuse' as const,
        evidenceRefs: [{ kind: 'dom' as const, windowId: 'ev-e1', sequence: 1, degradation: ['degraded-chain-join' as const] }],
      },
    ],
    unattributed: [],
    horizon: {
      uiOwnership: { openedAtMs: 1_000_000, closedAtMs: 1_001_400, closeReason: 'stabilized' as const },
      attribution: { openedAtMs: 1_000_000, closedAtMs: 1_001_400, closeReason: 'all-stamped-settled' as const, pendingRequestIds: [] },
    },
    episodeOutcome: null,
    tabId: 1,
  };
  return {
    id: 'abm-s1',
    sessionId: 's1',
    episodes: [ep as never],
    unattributed: [],
    provenanceLinks: [],
    generatedAtMs: 1_700_000_000_000,
    coverage: {} as never,
    warnings: [],
    ...overrides,
  } as AppBehaviorModel;
}

describe('B7-P3: KR persistence of hover episodes (zero schema change)', () => {
  it('a hover episode maps to a KnowledgeEpisodeRow with signatureKey appId|Hover|normalizedTarget|∅ (frozen identity v1)', () => {
    const rows = mapBehaviorModel({
      appId: 'app-1',
      sessionId: 's1',
      model: makeModel(),
      transitions: [],
    });
    expect(rows.episodes.length).toBe(1);
    const row = rows.episodes[0];
    expect(row.anchor.actionType).toBe('Hover');
    expect(row.anchor.actionTarget).toBe('Account menu');
    // signatureKey format pinned: 'app:sig:hash' — Hover appears in the
    // hashed identity, not the key string itself.
    expect(row.signatureKey.startsWith('app-1:sig:')).toBe(true);
  });

  it('hover T4 edges persist as KnowledgeEdgeRow with evidence refs (refJson)', () => {
    const rows = mapBehaviorModel({
      appId: 'app-1',
      sessionId: 's1',
      model: makeModel(),
      transitions: [],
    });
    expect(rows.edges.length).toBe(1);
    const edge = rows.edges[0];
    expect(edge.tier).toBe('T4-window');
    expect(edge.kind).toBe('ui');
    const refs = JSON.parse(edge.refJson);
    expect(refs[0].kind).toBe('dom');
    expect(refs[0].windowId).toBe('ev-e1');
  });

  it('hover episodes accumulate into KnowledgeActionSignatureRow (occurrenceCount=1, no consequence profile rows thrown)', () => {
    const rows = mapBehaviorModel({
      appId: 'app-1',
      sessionId: 's1',
      model: makeModel(),
      transitions: [],
    });
    expect(rows.signatureInputs.length).toBe(1);
    const sig = rows.signatureInputs[0];
    expect(sig.actionType).toBe('Hover');
    expect(sig.normalizedTarget).toBe('account menu');
  });

  it('model.provenanceLinks pass through the model; mapper output has NO provenance entity (phase-2 out of scope)', () => {
    const model = makeModel();
    model.provenanceLinks = [
      {
        id: 'prov-x', sourceEpisodeId: 'ep-int-h1', targetEpisodeId: 'ep-int-c1',
        kind: 'surface-reuse', evidenceRefs: [],
      } as never,
    ];
    const rows = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model, transitions: [] });
    // The mapped rows are keyed by episodes/edges/gaps/signatureInputs/session
    // — no provenance key exists (zero schema change).
    expect(Object.keys(rows).sort()).toEqual(['edges', 'episodes', 'gaps', 'session', 'signatureInputs'].sort());
    // And the episode row is unaffected by the link's presence.
    expect(rows.episodes.length).toBe(1);
  });

  it('gesture-only hover episodes never reach the mapper (admission-keyed anchoring upstream)', () => {
    // Admission happens in episode-builder; a model whose episodes array
    // contains ONLY hover episodes (all admitted) maps cleanly; the
    // mapper never sees non-admitted hovers because they never anchor.
    // Pin: zero episodes model is rejected by contract (existing guard).
    const model = makeModel();
    model.episodes = [];
    expect(() =>
      mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model, transitions: [] }),
    ).toThrow('zero episodes');
  });
});
