/**
 * MS-U4 pins — KR browser section renderers (fixtures, no DB).
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md (§6 P6, P7 + A4–A11).
 * Pins honest empty states, caps/overflow in the DOM, XSS textContent,
 * status chips, and consequence-profile rendering.
 */

import { describe, it, expect } from 'vitest';
import {
  renderSignaturesSection,
  renderWorkflowsSection,
  renderViewsSection,
  renderGapsSection,
  renderOutcomesSection,
  renderEntitiesSection,
  renderCollectionsSection,
  renderNotificationsSection,
  renderApiSeedsSection,
  renderSessionsSection,
  renderAppSelector,
} from '../../src/repository/kr-browser/kr-browser';
import type {
  KnowledgeActionSignatureRow,
  KnowledgeRecordedWorkflowRow,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
  KnowledgeGapRow,
  KnowledgeOutcomeRow,
  KnowledgeEntityRow,
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeNotificationRow,
  ApplicationRow,
} from '../../src/understanding/persistence/knowledge-types';
import type { ApiTestSeed } from '../../src/understanding/contract/contract-types';
import { KR_CAPS } from '../../src/repository/kr-browser/kr-sort';

function el(t: string): string {
  return (t ?? '').toString();
}

// ── fixtures (minimal but field-faithful) ───────────────────────────────

const sig = (o: Partial<KnowledgeActionSignatureRow> = {}): KnowledgeActionSignatureRow =>
  ({
    key: 'app1:sig:1', appId: 'app1', actionType: 'Click',
    normalizedTarget: 'button.search', anchorViewId: 'view:home',
    firstSeenAtSession: 'session-1', lastSeenAtSession: 'session-2',
    firstSeenSeq: 1, lastSeenSeq: 2, occurrenceCount: 4, sessionsSinceSeen: 0,
    status: 'active', source: 'behavior',
    consequenceProfile: [{
      identity: 'T1-stamp|counter|cart-count', tier: 'T1-stamp', kind: 'counter',
      targetIdentity: 'cart-count', occurrenceCount: 4, hitCount: 4, missedObservations: 0,
      firstSeenAtSession: 'session-1', lastSeenAtSession: 'session-2', lastSeenSeq: 2,
      confidence: 0.9, status: 'active', evidenceSamples: [], observedVia: 'behavior/window',
    }],
    divergenceFlags: [],
    ...o,
  }) as KnowledgeActionSignatureRow;

const wf = (o: Partial<KnowledgeRecordedWorkflowRow> = {}): KnowledgeRecordedWorkflowRow =>
  ({
    key: 'app1:wf-1', appId: 'app1', patternId: 'wf-1', label: 'Search flow',
    canonicalSteps: ['navigate', 'fill', 'click'], viewSequence: ['home', 'results'],
    sessionIds: ['session-1', 'session-2'], occurrenceCount: 2, instances: ['i1', 'i2'],
    signatureIds: ['app1:sig:1'], linkageState: 'linked', firstSeenAt: 10, lastSeenAt: 20,
    ...o,
  }) as KnowledgeRecordedWorkflowRow;

const view = (o: Partial<KnowledgeViewRow> = {}): KnowledgeViewRow =>
  ({
    key: 'app1:v-home', appId: 'app1', viewId: 'view:home', label: 'home',
    detectedFrom: 'url-pattern', firstSeenAt: 1, lastSeenAt: 2, visitCount: 7,
    lastSessionId: 'session-2', ...o,
  }) as KnowledgeViewRow;

const edge = (o: Partial<KnowledgeViewTransitionRow> = {}): KnowledgeViewTransitionRow =>
  ({
    key: 'app1:home->results', appId: 'app1', fromViewId: 'view:home',
    toViewId: 'view:results', count: 3, firstSeenAt: 1, lastSeenAt: 2,
    lastSessionId: 'session-2', ...o,
  }) as KnowledgeViewTransitionRow;

const gap = (o: Partial<KnowledgeGapRow> = {}): KnowledgeGapRow =>
  ({
    key: 'app1:s1:g1', appId: 'app1', sessionId: 'session-1', gapId: 'g1',
    observedKind: 'ui', reason: 'no-live-horizon',
    detail: 'evidence window outside every uiOwnership horizon',
    observedAtMs: 500, tabId: null, windowRefJson: '{"windowId":"w-1"}', ...o,
  }) as KnowledgeGapRow;

const outcome = (o: Partial<KnowledgeOutcomeRow> = {}): KnowledgeOutcomeRow =>
  ({
    key: 's1:int-1', appId: 'app1', sessionId: 'session-1', interactionId: 'int-1',
    actionType: 'Click', actionTarget: 'Search', outcome: 'success',
    confidence: 0.9, confidenceLevel: 'confirmed', evidence: [], resultingEntities: [],
    persistedAt: 100, ...o,
  }) as KnowledgeOutcomeRow;

const entity = (o: Partial<KnowledgeEntityRow> = {}): KnowledgeEntityRow =>
  ({
    key: 'app1:e1', appId: 'app1', entityId: 'B0XYZ', type: 'product',
    attributes: { title: 'Widget' }, source: 'seed', firstSeenAt: 1, lastSeenAt: 2,
    revision: 3, lastSessionId: 'session-2', currentState: 'available',
    stateHistory: [{ from: null, to: 'available', changedAt: 'int-1', evidence: 'seed' }],
    viewIds: ['view:home'], ...o,
  }) as KnowledgeEntityRow;

const coll = (o: Partial<KnowledgeCollectionRow> = {}): KnowledgeCollectionRow =>
  ({
    key: 'app1:c1', appId: 'app1', collectionId: 'results tbody', entityType: 'product',
    currentCount: 2, maxCount: 5, lastUpdated: 5, lastSessionId: 'session-2', ...o,
  }) as KnowledgeCollectionRow;

const counter = (o: Partial<KnowledgeCounterRow> = {}): KnowledgeCounterRow =>
  ({
    key: 'app1:ctr1', appId: 'app1', counterId: 'cart-count', label: 'Cart',
    elementPath: 'body > header > span', currentValue: '3',
    history: [{ value: '3', observedAt: 9, sessionId: 'session-2', delta: 1 }],
    lastUpdated: 9, lastSessionId: 'session-2', ...o,
  }) as KnowledgeCounterRow;

const notif = (o: Partial<KnowledgeNotificationRow> = {}): KnowledgeNotificationRow =>
  ({
    key: 'app1:n1', appId: 'app1', text: 'Added to cart', severity: 'info',
    elementPath: 'body > div.toast', appearedAt: 1000, sessionId: 'session-1', ...o,
  }) as KnowledgeNotificationRow;

// ── P6: honest empty states ────────────────────────────────────────────

describe('P6 — honest empty states (every section)', () => {
  const cases: Array<[string, () => HTMLElement]> = [
    ['signatures', () => renderSignaturesSection([])],
    ['workflows', () => renderWorkflowsSection([])],
    ['views', () => renderViewsSection([], [])],
    ['gaps', () => renderGapsSection([])],
    ['outcomes', () => renderOutcomesSection([])],
    ['entities', () => renderEntitiesSection([])],
    ['collections+counters', () => renderCollectionsSection([], [])],
    ['notifications', () => renderNotificationsSection([])],
    ['api seeds', () => renderApiSeedsSection([])],
    ['sessions', () => renderSessionsSection([], {})],
  ];
  for (const [name, fn] of cases) {
    it(`${name}: empty rows → "No … yet", no undefined/NaN`, () => {
      const t = fn().textContent ?? '';
      expect(t).toMatch(/no .* yet/i);
      expect(t).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b/);
    });
  }
});

// ── A5: signatures section ─────────────────────────────────────────────

describe('A5 — signatures section', () => {
  it('renders actionType, target, occurrence, status, view anchor', () => {
    const t = renderSignaturesSection([sig()]).textContent ?? '';
    expect(t).toContain('Click');
    expect(t).toContain('button.search');
    expect(t).toContain('×4');
    expect(t).toContain('active');
    expect(t).toContain('view:home');
  });

  it('consequence profile: tier/kind/target, confidence %, status chip, observedVia', () => {
    const t = renderSignaturesSection([sig()]).textContent ?? '';
    expect(t).toContain('T1-stamp');
    expect(t).toContain('counter');
    expect(t).toContain('cart-count');
    expect(t).toContain('90%');
    expect(t).toContain('behavior/window');
  });

  it('divergence flags render a count badge when > 0 and honest absence at 0', () => {
    const withFlags = renderSignaturesSection([sig({ divergenceFlags: ['flag-a', 'flag-b'] })]).textContent ?? '';
    expect(withFlags).toContain('2 divergence flags');
    const noFlags = renderSignaturesSection([sig()]).textContent ?? '';
    expect(noFlags).not.toContain('divergence flags');
  });

  it('caps at 50 with "… N more" overflow', () => {
    const rows = Array.from({ length: KR_CAPS.signatures + 15 }, (_, i) => sig({ key: `app1:sig:${i}` }));
    const t = renderSignaturesSection(rows).textContent ?? '';
    expect(t).toContain(`… 15 more`);
    expect((t.match(/app1:sig:/g) ?? []).length).toBeLessThanOrEqual(KR_CAPS.signatures);
  });
});

// ── A6: workflows ──────────────────────────────────────────────────────

describe('A6 — workflows section', () => {
  it('renders label, numbered canonical steps, occurrence, linkage chip', () => {
    const t = renderWorkflowsSection([wf()]).textContent ?? '';
    expect(t).toContain('Search flow');
    expect(t).toContain('1. navigate');
    expect(t).toContain('2. fill');
    expect(t).toContain('3. click');
    expect(t).toContain('×2');
    expect(t).toContain('linked');
  });

  it('linkage-pending chip renders honestly', () => {
    const t = renderWorkflowsSection([wf({ linkageState: 'linkage-pending' })]).textContent ?? '';
    expect(t).toContain('linkage-pending');
  });
});

// ── A7: views / edges graph ────────────────────────────────────────────

describe('A7 — views & transitions graph', () => {
  it('renders from → to ×count edges and per-view visit counts', () => {
    const t = renderViewsSection([view()], [edge()]).textContent ?? '';
    expect(t).toContain('view:home');
    expect(t).toContain('→');
    expect(t).toContain('×3');
    expect(t).toContain('7'); // visitCount
  });
});

// ── A9: gaps ───────────────────────────────────────────────────────────

describe('A9 — gaps section', () => {
  it('renders kind, reason, detail, sessionId; reason summary line', () => {
    const t = renderGapsSection([
      gap(),
      gap({ key: 'app1:s1:g2', gapId: 'g2', reason: 'api-no-stamp' }),
      gap({ key: 'app1:s1:g3', gapId: 'g3' }),
    ]).textContent ?? '';
    expect(t).toContain('ui');
    expect(t).toContain('no-live-horizon');
    expect(t).toContain('outside every uiOwnership horizon');
    expect(t).toContain('api-no-stamp');
    expect(t).toContain('no-live-horizon ×2');
    expect(t).toContain('api-no-stamp ×1');
  });
});

// ── A11: outcomes / entities / collections / notifications ─────────────

describe('A11 — remaining sections', () => {
  it('outcomes: rollup counts + rows with confidence %', () => {
    const t = renderOutcomesSection([
      outcome(), outcome({ key: 's1:int-2', interactionId: 'int-2', outcome: 'failure', confidence: 0.4 }),
    ]).textContent ?? '';
    expect(t).toContain('1 success');
    expect(t).toContain('1 failure');
    expect(t).toContain('90%');
    expect(t).toContain('40%');
  });

  it('entities: type, id, state, revision + expandable state history', () => {
    const t = renderEntitiesSection([entity()]).textContent ?? '';
    expect(t).toContain('product');
    expect(t).toContain('B0XYZ');
    expect(t).toContain('available');
    expect(t).toContain('rev 3');
    expect(t).toContain('→ available');
  });

  it('collections & counters: counts + current value + delta', () => {
    const t = renderCollectionsSection([coll()], [counter()]).textContent ?? '';
    expect(t).toContain('2');
    expect(t).toContain('max 5');
    expect(t).toContain('Cart');
    expect(t).toContain('3');
    expect(t).toContain('+1');
  });

  it('notifications: severity chip, text, path', () => {
    const t = renderNotificationsSection([notif()]).textContent ?? '';
    expect(t).toContain('info');
    expect(t).toContain('Added to cart');
    expect(t).toContain('body > div.toast');
  });
});

// ── A10: API seeds ─────────────────────────────────────────────────────

describe('A10 — API seeds section', () => {
  const seed = (o: Partial<ApiTestSeed> = {}): ApiTestSeed =>
    ({
      seedId: 'session-1:int-1:req-1',
      appId: 'app1',
      sessionId: 'session-1',
      interactionId: 'int-1',
      sourceEventId: 'evt-1',
      request: {
        method: 'POST',
        path: '/api/cart',
        status: 200,
        resourceType: 'xhr',
        bodyKeys: ['sku', 'qty'],
      },
      attribution: { kind: 'webrequest-stamp' } as never,
      shared: false,
      recurring: false,
      action: { signatureKey: 'app1:sig:abc', actionType: 'Click', normalizedTarget: 'button.add' },
      expectedPostConditions: [],
      honesty: { payloadSchema: 'unrecorded', responseBody: 'unverified', uiBasis: 'content-observed' },
      confidence: 0.8,
      evidenceRef: {} as never,
      ...o,
    }) as ApiTestSeed;

  it('renders method/path identity + confidence + session + signature join', () => {
    const t = renderApiSeedsSection([seed()]).textContent ?? '';
    expect(t).toContain('POST');
    expect(t).toContain('/api/cart');
    expect(t).toContain('80%');
    expect(t).toContain('session-1');
    expect(t).toContain('Click');
    expect(t).toContain('sig abc');
  });

  it('caps at 25 with overflow', () => {
    const rows = Array.from({ length: 30 }, (_, i) => seed({ seedId: `s-${i}` }));
    const t = renderApiSeedsSection(rows).textContent ?? '';
    expect(t).toContain('… 5 more');
  });
});

// ── A8: sessions/episodes/edges ────────────────────────────────────────

describe('A8 — sessions section', () => {
  const sessionRow = {
    key: 'app1:session-1', appId: 'app1', sessionId: 'session-1', seq: 1,
    generatedAtMs: 100, episodeCount: 2, edgeCount: 4, gapCount: 1,
    coverage: {
      totalInteractions: 3, anchoredInteractions: 2, memberInteractions: 2,
      malformedInteractions: 0, totalNetworkRows: 2, attributedNetworkRows: 1,
      totalObservations: 5, attributedObservations: 4, unattributedConsequences: 1,
      provenanceLinks: 0,
    },
    viewSetHash: 'h', signatureSetHash: 'h', warnings: [],
  };
  const episodeRow = {
    key: 'app1:session-1:ep-1', appId: 'app1', sessionId: 'session-1', episodeId: 'ep-1',
    anchor: { interactionId: 'int-1', actionType: 'Click', actionTarget: 'Search', triggerTimestamp: 5 },
    members: [{ interactionId: 'int-1', role: 'anchor' }, { interactionId: 'int-2', role: 'member' }],
    horizonAttribution: { openedAtMs: 5, closedAtMs: 500, closeReason: 'stabilized' },
    horizonUiOwnership: { openedAtMs: 5, closedAtMs: null, closeReason: null },
    parameterInputs: [], episodeOutcome: { outcome: 'success', confidence: 0.9, confidenceLevel: 'confirmed', derivation: 'T1' },
    tabId: null, signatureKey: 'app1:sig:1',
  };
  const edgeT4 = {
    key: 'app1:session-1:e-1', appId: 'app1', sessionId: 'session-1', episodeId: 'ep-1',
    edgeId: 'e-1', edgeSeq: 1, tier: 'T4-window', kind: 'ui', detail: '2 DOM changes',
    confidence: 0.8, latencyMs: 120, fromEpisodeId: 'ep-1', fromInteractionId: 'int-2',
    to: { type: 'ui', summary: '2 DOM changes' }, refJson: '[{"kind":"dom","windowId":"w-1"}]',
    signatureKey: 'app1:sig:1',
  };

  it('renders manifest header (seq, counts, coverage) + episode + edge with parsed refs', () => {
    const t = renderSessionsSection([sessionRow as never], {
      'app1:session-1': { episodes: [episodeRow as never], edges: [edgeT4 as never] },
    }).textContent ?? '';
    expect(t).toContain('#1');
    expect(t).toContain('session-1');
    expect(t).toContain('2 episodes');
    expect(t).toContain('1 gap');
    expect(t).toContain('2/3 anchored');
    expect(t).toContain('Click');
    expect(t).toContain('success');
    expect(t).toContain('T4-window');
    expect(t).toContain('int-2');
    expect(t).toContain('w-1'); // parsed EvidenceRef
  });
});

// ── P7: XSS ────────────────────────────────────────────────────────────

describe('P7 — XSS: textContent only', () => {
  it('hostile entity/notification/signature text renders inert', () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const container = renderEntitiesSection([
      entity({ entityId: hostile, attributes: { title: hostile } as never }),
    ]);
    document.body.appendChild(container);
    const t2 = renderNotificationsSection([notif({ text: hostile })]);
    document.body.appendChild(t2);
    const t3 = renderSignaturesSection([sig({ normalizedTarget: hostile })]);
    document.body.appendChild(t3);
    expect(document.querySelectorAll('img,script,svg').length).toBe(0);
    expect((globalThis as { window?: { __pwned?: number } }).window?.__pwned).toBeUndefined();
    expect(el(container.textContent)).toContain(hostile);
  });
});

// ── A3: app selector ───────────────────────────────────────────────────

describe('A3 — app selector', () => {
  it('renders origin label + appId/sessionCount sub; honest empty at zero apps', () => {
    const apps: ApplicationRow[] = [
      { appId: 'app-b24aev', origin: 'http://127.0.0.1:8177', sessionCount: 3, lastSessionId: 'session-3' } as ApplicationRow,
    ];
    const t = renderAppSelector(apps, 'app-b24aev').textContent ?? '';
    expect(t).toContain('http://127.0.0.1:8177');
    expect(t).toContain('app-b24aev');
    expect(t).toContain('3');

    const empty = renderAppSelector([], null).textContent ?? '';
    expect(empty).toMatch(/no applications recorded yet/i);
  });
});
