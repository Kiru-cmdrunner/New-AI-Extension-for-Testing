/**
 * CP6 — Behavior Knowledge Mapper tests
 *
 * Covers:
 * - Determinism: same input → byte-identical rows (twice)
 * - Purity: input model never mutated (deep-frozen fixture)
 * - Identity keys: signature key stability across cosmetic target variants
 * - Consequence identity generalization (api/entity/nav/state/ui)
 * - Zero-episode guard
 * - refJson round-trip (evidence refs preserved verbatim)
 * - anchorViewId resolution incl. missing transition (null)
 *
 * Architecture: .drytis/specs/cp6-knowledge-repository.md
 */

import { describe, it, expect } from 'vitest';
import {
  mapBehaviorModel,
  normalizeTarget,
  signatureKey,
  consequenceTargetIdentity,
} from '../../src/understanding/persistence/behavior-knowledge-mapper';
import type { AppBehaviorModel } from '../../src/understanding/behavior-model/model-types';
import type { StateTransition } from '../../src/understanding/state-builder/types';

// ── Fixture builder (mirrors the CP5 real-Chrome acceptance shape) ─────

function makeModelFixture(): AppBehaviorModel {
  return {
    id: 'abm-test-1',
    sessionId: 'session-1',
    generatedAtMs: 1786898629484,
    coverage: {
      totalInteractions: 10,
      anchoredInteractions: 5,
      memberInteractions: 3,
      attributedNetworkRows: 3,
      attributedObservations: 5,
      totalNetworkRows: 3,
      totalObservations: 7,
      malformedInteractions: 0,
      provenanceLinks: 0,
      unattributedConsequences: 2,
    },
    warnings: [
      { code: 'unknown-tab-resolution', message: 'test warning', refs: ['ep-x'] },
    ],
    provenanceLinks: [],
    episodes: [
      {
        id: 'ep-int-9',
        anchor: {
          interactionId: 'int-9',
          actionType: 'Click',
          actionTarget: 'Add to Cart',
          triggerTimestamp: 1786898624437,
        },
        members: [{ interactionId: 'int-9', role: 'anchor' }],
        parameterInputs: [],
        horizon: {
          attribution: {
            openedAtMs: 1786898624437,
            closedAtMs: 1786898624437,
            closeReason: 'all-stamped-settled',
            pendingRequestIds: [],
          },
          uiOwnership: {
            openedAtMs: 1786898624437,
            closedAtMs: 1786898624437,
            closeReason: 'stabilized',
          },
        },
        edges: [
          {
            id: 'edge-ep-int-9-000',
            kind: 'api',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'api', requestId: '20' },
            detail: 'POST http://127.0.0.1:8098/cart/add initiated during ep-int-9',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [{ kind: 'request', requestId: '20' }],
          },
          {
            id: 'edge-ep-int-9-001',
            kind: 'entity',
            tier: 'T1-stamp',
            from: { episodeId: 'ep-int-9', interactionId: 'int-9' },
            to: { type: 'entity', entityId: 'cart-item:B0FFF9VPMN', operation: 'create' },
            detail: 'entity cart-item:B0FFF9VPMN (cart-item) created from API',
            confidence: 0.9,
            latencyMs: null,
            evidenceRefs: [
              { kind: 'entity', entityId: 'cart-item:B0FFF9VPMN', interactionId: 'int-9' },
            ],
          },
        ],
        episodeOutcome: {
          outcome: 'success',
          confidence: 1,
          confidenceLevel: 'confirmed',
          derivation: 'derived-episode-outcome',
          contributingMembers: ['int-9'],
        },
        tabId: 1559737921,
        unattributed: [],
      },
      {
        id: 'ep-int-13',
        anchor: {
          interactionId: 'int-13',
          actionType: 'Gesture',
          actionTarget: 'mousedown',
          triggerTimestamp: 1786898624434,
        },
        members: [
          { interactionId: 'int-13', role: 'anchor' },
          { interactionId: 'int-10', role: 'navigation' },
        ],
        parameterInputs: [],
        horizon: {
          attribution: {
            openedAtMs: 1786898624434,
            closedAtMs: 1786898625972,
            closeReason: 'timeout',
            pendingRequestIds: [],
          },
          uiOwnership: {
            openedAtMs: 1786898624434,
            closedAtMs: 1786898625972,
            closeReason: 'stabilized',
          },
        },
        edges: [
          {
            id: 'edge-ep-int-13-000',
            kind: 'navigation',
            tier: 'T2-lineage',
            from: { episodeId: 'ep-int-13', interactionId: 'int-13' },
            to: { type: 'navigation', toUrl: 'http://127.0.0.1:8098/cart.html' },
            detail: 'committed to http://127.0.0.1:8098/cart.html',
            confidence: 0.85,
            latencyMs: 265,
            evidenceRefs: [{ kind: 'nav', navEventId: 'nav-1786898625971-qyvngi' }],
          },
          {
            id: 'edge-ep-int-13-002',
            kind: 'ui',
            tier: 'T4-window',
            from: { episodeId: 'ep-int-13', interactionId: 'int-9' },
            to: { type: 'ui', windowId: 'ev-evt-pmsw1avsc-5' },
            detail: 'UI observations on int-9: 2 DOM changes, 1 visibility',
            confidence: 0.5,
            latencyMs: null,
            evidenceRefs: [{ kind: 'dom', windowId: 'ev-evt-pmsw1avsc-5', sequence: 0 }],
          },
        ],
        episodeOutcome: null,
        tabId: null,
        unattributed: [
          {
            id: 'unattr-ui-int-1',
            observedKind: 'ui',
            reason: 'no-live-horizon',
            detail: 'evidence window ev-nav-x lies outside every horizon',
            observedAtMs: 1786898618284,
            tabId: null,
            evidenceRef: { kind: 'dom', windowId: 'ev-nav-x', sequence: 0 },
          },
        ],
      },
    ],
    unattributed: [
      {
        id: 'unattr-ui-int-1',
        observedKind: 'ui',
        reason: 'no-live-horizon',
        detail: 'evidence window ev-nav-x lies outside every horizon',
        observedAtMs: 1786898618284,
        tabId: null,
        evidenceRef: { kind: 'dom', windowId: 'ev-nav-x', sequence: 0 },
      },
    ],
  } as unknown as AppBehaviorModel;
}

function makeTransitions(): StateTransition[] {
  return [
    {
      interactionId: 'int-9',
      before: { currentView: { id: 'search-results', label: 'Search Results', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: 'http://x/1', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-7', interactionCount: 5 },
      after: { currentView: { id: 'search-results', label: 'Search Results', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: 'http://x/2', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-9', interactionCount: 6 },
      changes: [],
    },
    {
      interactionId: 'int-13',
      before: { currentView: { id: 'search-results', label: 'Search Results', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: 'http://x/2', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-9', interactionCount: 6 },
      after: { currentView: { id: 'cart', label: 'Cart', confidence: 0.8, detectedFrom: 'url-pattern' }, currentUrl: 'http://x/cart', entities: new Map(), collections: new Map(), counters: new Map(), notifications: [], lastInteractionId: 'int-13', interactionCount: 7 },
      changes: [],
    },
  ] as unknown as StateTransition[];
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('CP6 behavior-knowledge-mapper', () => {
  it('maps a model deterministically — identical rows for identical input', () => {
    const a = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    const b = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    expect(a).toEqual(b);
  });

  it('never mutates the input model', () => {
    const model = makeModelFixture();
    const before = JSON.stringify(model);
    mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model, transitions: makeTransitions() });
    expect(JSON.stringify(model)).toBe(before);
  });

  it('throws on a zero-episode model', () => {
    const empty = { ...makeModelFixture(), episodes: [] } as unknown as AppBehaviorModel;
    expect(() =>
      mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: empty, transitions: [] }),
    ).toThrow();
  });

  it('produces one signature input per episode, keyed by action identity', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    expect(mapped.signatureInputs).toHaveLength(2);
    const keys = mapped.signatureInputs.map((s) => s.key);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toMatch(/^app-1:sig:[0-9a-f]{8}$/);
  });

  it('normalizes targets: case and whitespace do not change identity', () => {
    expect(normalizeTarget('  Add   To CART ')).toBe('add to cart');
    // signatureKey takes the NORMALIZED target (the mapper normalizes at
    // the call site) — so identity is invariant to cosmetic variants:
    expect(signatureKey('app-1', 'Click', normalizeTarget('Add To Cart'), 'product')).toBe(
      signatureKey('app-1', 'Click', normalizeTarget('  add to cart '), 'product'),
    );
  });

  it('anchorViewId resolves from the anchor transition before.currentView.id; null when absent', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    expect(mapped.signatureInputs[0].anchorViewId).toBe('search-results');
    expect(mapped.signatureInputs[1].anchorViewId).toBe('search-results');
  });

  it('generalizes consequence identities: api, entity, nav, ui', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    const identities = mapped.signatureInputs[0].consequences.map((c) => c.identity);
    expect(identities).toContain('T1-stamp|api|POST /cart/add');
    expect(identities).toContain('T1-stamp|entity|cart-item:create');
    const nav = mapped.signatureInputs[1].consequences.find((c) => c.kind === 'navigation');
    expect(nav?.targetIdentity).toBe('to:/cart.html');
  });

  it('ui consequences generalize to anchor-window/post-anchor by confidence', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    const ui = mapped.signatureInputs[1].consequences.find((c) => c.kind === 'ui');
    // confidence 0.5 < 0.6 → post-anchor
    expect(ui?.targetIdentity).toBe('post-anchor');
  });

  it('preserves evidence refs verbatim via refJson round-trip', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    const apiEdge = mapped.edges[0];
    expect(JSON.parse(apiEdge.refJson)).toEqual([
      { kind: 'request', requestId: '20' },
    ]);
    expect(mapped.edges[0].fromEpisodeId).toBe('ep-int-9');
    expect(mapped.edges[0].fromInteractionId).toBe('int-9');
  });

  it('maps unattributed consequences to gap rows', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    expect(mapped.gaps).toHaveLength(1);
    expect(mapped.gaps[0].reason).toBe('no-live-horizon');
    expect(mapped.gaps[0].key).toBe('app-1:s1:unattr-ui-int-1');
  });

  it('session manifest records counts and hashes', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    expect(mapped.session.episodeCount).toBe(2);
    expect(mapped.session.edgeCount).toBe(4);
    expect(mapped.session.gapCount).toBe(1);
    expect(mapped.session.signatureSetHash).toBeTruthy();
    expect(mapped.session.viewSetHash).toBeTruthy();
    expect(mapped.session.generatedAtMs).toBe(1786898629484);
  });

  it('sequence-strips host: different hosts, same path → same identity', () => {
    const edge = {
      kind: 'api',
      tier: 'T1-stamp',
      to: { type: 'api', requestId: 'r-1' },
      detail: 'POST http://staging.example.com/cart/add initiated during ep-1',
    } as never;
    expect(consequenceTargetIdentity(edge)).toBe('POST /cart/add');
  });

  // ── CP7 P2 — unparsed api detail fallback (no collapse sink) ─────────
  it('P2: unparsed api detail → api:unparsed:<hash>, never the constant "api"', () => {
    const edge = {
      kind: 'api',
      tier: 'T1-stamp',
      to: { type: 'api', requestId: 'r-1' },
      detail: 'custom-format /cart/add?x=1 initiated during ep-9',
    } as never;
    const identity = consequenceTargetIdentity(edge);
    expect(identity).toMatch(/^api:unparsed:[0-9a-f]{8}$/);
    expect(identity).not.toBe('api');
  });

  it('P2: same unparsed endpoint via different episodes → SAME identity (merge-safe)', () => {
    const mk = (ep: string) => ({
      kind: 'api',
      tier: 'T1-stamp',
      to: { type: 'api', requestId: 'r-1' },
      detail: `custom-format /cart/add?x=1 initiated during ${ep}`,
    } as never);
    expect(consequenceTargetIdentity(mk('ep-9'))).toBe(
      consequenceTargetIdentity(mk('ep-int-402')),
    );
  });

  it('P2: distinct unparsed details → DISTINCT identities (no silent merge)', () => {
    const mk = (url: string) => ({
      kind: 'api',
      tier: 'T1-stamp',
      to: { type: 'api', requestId: 'r-1' },
      detail: `custom-format ${url} initiated during ep-9`,
    } as never);
    expect(consequenceTargetIdentity(mk('/cart/add'))).not.toBe(
      consequenceTargetIdentity(mk('/checkout/pay')),
    );
  });

  // ── CP7 P3 — entity colon guard ──────────────────────────────────────
  it('P3: colon-less entityId degrades to unknown:<op>, never mis-parses', () => {
    const edge = {
      kind: 'entity',
      tier: 'T1-stamp',
      to: { type: 'entity', entityId: 'B0FFF9VPMN', operation: 'create' },
      detail: 'entity created during ep-1',
    } as never;
    expect(consequenceTargetIdentity(edge)).toBe('unknown:create');
  });

  it('P3: existing identities byte-identical after the guard (fixture regression)', () => {
    const mapped = mapBehaviorModel({ appId: 'app-1', sessionId: 's1', model: makeModelFixture(), transitions: makeTransitions() });
    const identities = mapped.signatureInputs[0].consequences.map((c) => c.identity);
    expect(identities).toContain('T1-stamp|api|POST /cart/add');
    expect(identities).toContain('T1-stamp|entity|cart-item:create');
  });
});
