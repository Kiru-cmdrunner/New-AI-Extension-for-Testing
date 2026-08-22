/**
 * MS-U3 — Session Understanding Card pins (RED first).
 *
 * Spec: .drytis/specs/phase-6-u3-session-understanding-card.md (P1–P12).
 *
 * Pins cover: app identity, domain row, views+edges, entity split,
 * outcomes rollup, coverage rows, warnings, gaps attach + honest absence
 * on lookup failure, absent-result honesty, XSS, caps + overflow,
 * and wiring (listener registration, section visibility).
 */

import { describe, it, expect } from 'vitest';
import type { UnderstandingResult } from '../../src/domain/entities/understanding-result';

import {
  renderUnderstandingCard,
  outcomeRollup,
  entitySplit,
  coverageRows,
  gapsRows,
  type ForwardSigLike,
} from '../../src/sidepanel/understanding-card';

/** Realistic full fixture — all optional fields present. Deep-copied per call
 *  via JSON round-trip so tests may mutate without readonly complaints. */
function fullResult(): UnderstandingResult {
  return JSON.parse(JSON.stringify({
    sessionId: 'session-1771876000000',
    generatedAt: '2026-08-22T10:00:00.000Z',
    schemaVersion: 2,
    appId: 'app-123.example.com',
    semanticKnowledge: {
      appId: 'app-123.example.com',
      domain: {
        domain: 'e-commerce',
        confidence: 0.82,
        alternative: 'content',
        margin: 0.31,
        evidence: {
          viewPatternScore: 3,
          entityTypeScore: 2,
          apiOperationScore: 1,
          notificationKeywordScore: 0,
          urlStructureScore: 2,
          matchedSignals: ['cart-count', 'product-card', '/checkout'],
        },
      },
      surface: {} as never, // not rendered by U3
      contracts: [],
      components: [],
      intents: [],
      workflows: [],
      recordedWorkflows: [],
      metadata: {
        enricherVersion: '1.2.3',
        generatedAt: 1771876000000,
        interactionCount: 9,
        workflowCount: 1,
        viewCount: 2,
        // PRODUCTION SCALE: EnrichmentCoverage is 0–1 fractions
        // (semantic-enricher.ts rounds to 3dp) — not 0–100.
        coverage: { intentCoverage: 0.78, componentCoverage: 0.667, contractCoverage: 1 },
      },
    } as never,
    applicationKnowledge: {
      appId: 'app-123.example.com',
      origin: 'https://shop.example.com',
      label: 'shop.example.com',
      sessionCount: 3,
      firstSeenAt: 1771000000000,
      lastActiveAt: 1771876000000,
      entities: [
        {
          entityId: 'SKU-A',
          type: 'product',
          attributes: {},
          source: 'resulting-state',
          revision: 1,
          confidence: { level: 'medium', score: 0.5 } as never,
          firstSeenAt: 0,
          lastSeenAt: 0,
          observedInSessions: ['session-1771876000000'],
          currentState: 'in-cart',
        },
        {
          entityId: 'SKU-B',
          type: 'product',
          attributes: {},
          source: 'resulting-state',
          revision: 4,
          confidence: { level: 'medium', score: 0.5 } as never,
          firstSeenAt: 0,
          lastSeenAt: 0,
          observedInSessions: ['s-1', 's-2', 's-3', 'session-1771876000000'],
          currentState: 'in-cart',
        },
      ],
      views: [
        { viewId: 'v-1', label: 'Search results', detectedFrom: 'url', visitCount: 2, confidence: { level: 'medium', score: 0.5 } as never, firstSeenAt: 0, lastSeenAt: 0 },
        { viewId: 'v-2', label: 'Cart', detectedFrom: 'url', visitCount: 1, confidence: { level: 'medium', score: 0.5 } as never, firstSeenAt: 0, lastSeenAt: 0 },
      ],
      viewGraph: {
        nodes: [],
        edges: [{ fromViewId: 'v-1', toViewId: 'v-2', count: 2 }],
      },
      collections: [
        { collectionId: 'c-1', entityType: 'product', currentCount: 2, maxCount: 2, lastUpdated: 0 },
      ],
      counters: [
        { counterId: 'k-1', label: 'Cart items', elementPath: 'body>span', currentValue: '2', historyLength: 3, lastUpdated: 0 },
      ],
      notifications: [{ text: 'Added to cart', severity: 'info', count: 2 }],
      outcomePattern: {
        totalActions: 27,
        successCount: 21,
        failureCount: 2,
        ambiguousCount: 3,
        incompleteCount: 1,
        topActionTypes: [{ actionType: 'Click', count: 14 }],
      },
      totalRows: 42,
    },
    knowledgeWarnings: ['view-detection: duplicate origin normalization (s-2)'],
    outcomes: [
      { interactionId: 'int-1', actionType: 'Click', actionTarget: 'Add to cart', outcome: 'success', confidence: 0.9, confidenceLevel: 'confirmed', supportingEvidence: [], resultingEntities: [], stateChanges: [] },
      { interactionId: 'int-2', actionType: 'TextEntry', actionTarget: 'Search', outcome: 'ambiguous', confidence: 0.4, confidenceLevel: 'inconclusive', supportingEvidence: [], resultingEntities: [], stateChanges: [] },
      { interactionId: 'int-3', actionType: 'Click', actionTarget: 'Remove', outcome: 'failure', confidence: 0.7, confidenceLevel: 'likely', supportingEvidence: [], resultingEntities: [], stateChanges: [] },
    ] as never,
    transitions: [],
    behaviorModel: {
      id: 'abm-session-1771876000000',
      sessionId: 'session-1771876000000',
      episodes: [],
      unattributed: [],
      provenanceLinks: [{}, {}] as never,
      generatedAtMs: 1771876000000,
      coverage: {
        totalInteractions: 9,
        anchoredInteractions: 7,
        memberInteractions: 2,
        malformedInteractions: 0,
        totalNetworkRows: 12,
        attributedNetworkRows: 5,
        totalObservations: 30,
        attributedObservations: 22,
        unattributedConsequences: 4,
        provenanceLinks: 2,
      },
      warnings: [
        { code: 'degraded-evidence', message: 'episode e-2 ref degraded', refs: ['e-2'] },
      ],
    } as never,
  })) as UnderstandingResult;
}

// ── helpers ─────────────────────────────────────────────────────────────

describe('outcomeRollup', () => {
  it('counts each outcome category', () => {
    const r = outcomeRollup((fullResult() as { outcomes?: unknown[] }).outcomes as never);
    expect(r).toEqual({ total: 3, success: 1, failure: 1, ambiguous: 1, incomplete: 0 });
  });
  it('absent outcomes → null (honest)', () => {
    expect(outcomeRollup(undefined)).toBeNull();
    expect(outcomeRollup([])).toBeNull();
  });
});

describe('entitySplit', () => {
  it('revision 1 or single session → new; else reinforced', () => {
    const split = entitySplit((fullResult().applicationKnowledge!) as never);
    expect(split.new.length).toBe(1);
    expect(split.reinforced.length).toBe(1);
    expect(split.reinforced[0].entityId).toBe('SKU-B');
    expect(split.total).toBe(2);
  });
});

describe('coverageRows', () => {
  it('builds behavior-model + enrichment rows with honest absent parts', () => {
    const rows = coverageRows(fullResult() as never);
    expect(rows.some(r => /7\/9 interactions anchored/.test(r))).toBe(true);
    expect(rows.some(r => /5\/12 network rows attributed/.test(r))).toBe(true);
    expect(rows.some(r => /22\/30 observations attributed/.test(r))).toBe(true);
    expect(rows.some(r => /4 unattributed consequences/.test(r))).toBe(true);
    expect(rows.some(r => /intent 78%/.test(r))).toBe(true);
    expect(rows.some(r => /component 67%/.test(r))).toBe(true); // 0.667 ×100 rounds to 67
    expect(rows.some(r => /contract 100%/.test(r))).toBe(true);
  });
  it('absent behaviorModel + absent metadata → [] (honest absence)', () => {
    expect(coverageRows({} as never)).toEqual([]);
  });
});

describe('gapsRows', () => {
  it('maps gap rows to display strings', () => {
    const rows = gapsRows([
      { key: 'k', appId: 'a', sessionId: 's', gapId: 'g1', observedKind: 'counter', reason: 'no-owner', detail: 'counter changed with no interaction', observedAtMs: 0, tabId: null, windowRefJson: '' },
      { key: 'k2', appId: 'a', sessionId: 's', gapId: 'g2', observedKind: 'entity', reason: 'identity-unstable', detail: 'path changed', observedAtMs: 0, tabId: null, windowRefJson: '' },
    ] as never);
    expect(rows).toEqual(['counter · no-owner — counter changed with no interaction', 'entity · identity-unstable — path changed']);
  });
});

// ── card rendering ──────────────────────────────────────────────────────

describe('renderUnderstandingCard — P1/P2/P3/P4/P5/P6/P7', () => {
  it('P1 app identity: label, appId, sessionCount, origin', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('shop.example.com');
    expect(t).toContain('app-123.example.com');
    expect(t).toContain('session 3 with this app');
    expect(t).toContain('https://shop.example.com');
  });

  it('P2 domain: classification, confidence, alternative, matched signals', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('e-commerce');
    expect(t).toContain('82%');
    expect(t).toContain('alternative: content');
    expect(t).toContain('cart-count');
    expect(t).toContain('/checkout');
  });

  it('P3 views and transitions with counts', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('Search results');
    expect(t).toContain('×2');
    expect(t).toContain('Search results → Cart ×2'); // edges resolve to labels
  });

  it('P4 entities: new vs reinforced, currentState', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('product:SKU-A');
    productStateCheck(t, 'in-cart');
    expect(t).toContain('reinforced ×4');
  });
  function productStateCheck(t: string, s: string) { expect(t).toContain(s); }

  it('P5 outcomes rollup', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('1 success');
    expect(t).toContain('1 failure');
    expect(t).toContain('1 ambiguous');
    expect(t).toContain('21 successes'); // cross-session pattern
  });

  it('P6 coverage rows render', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('7/9 interactions anchored');
    expect(t).toContain('intent 78%');
  });

  it('P7 warnings render with message', () => {
    const el = renderUnderstandingCard(fullResult());
    const t = el!.textContent ?? '';
    expect(t).toContain('view-detection: duplicate origin normalization (s-2)');
    expect(t).toContain('episode e-2 ref degraded');
  });
});

describe('renderUnderstandingCard — P9 honest absence', () => {
  it('null → null element', () => {
    expect(renderUnderstandingCard(null)).toBeNull();
    expect(renderUnderstandingCard(undefined)).toBeNull();
  });
  it('minimal result → minimal card, zero undefined/null text', () => {
    const el = renderUnderstandingCard({ sessionId: 's-1', generatedAt: '2026-08-22T10:00:00.000Z', schemaVersion: 2 });
    expect(el).not.toBeNull();
    const t = el!.textContent ?? '';
    expect(t).toContain('s-1');
    expect(t).not.toMatch(/\bundefined\b/);
    expect(t).not.toMatch(/\bnull\b/);
    expect(t).not.toMatch(/\bNaN\b/);
  });
});

describe('renderUnderstandingCard — P10 XSS', () => {
  it('hostile strings render as text', () => {
    const r = fullResult() as unknown as { applicationKnowledge: { label: string }; semanticKnowledge: { domain: { evidence: { matchedSignals: string[] } } }; knowledgeWarnings?: string[] };
    r.applicationKnowledge.label = '<img src=x onerror="window.__pwned=1">';
    r.semanticKnowledge.domain.evidence.matchedSignals = ['<script>alert(1)</script>'];
    r.knowledgeWarnings = ['<svg onload=alert(2)>'];
    const el = renderUnderstandingCard(r as unknown as Parameters<typeof renderUnderstandingCard>[0]);
    const t = el!.textContent ?? '';
    expect(t).toContain('<img src=x onerror="window.__pwned=1">');
    expect(document.querySelectorAll('img,script,svg').length).toBe(0);
    expect((globalThis as { window?: { __pwned?: number } }).window?.__pwned).toBeUndefined();
  });
});

describe('renderUnderstandingCard — P11 caps + overflow', () => {
  it('caps entities at 8, views at 6, transitions at 8, gaps at 10, warnings at 8 with overflow markers', () => {
    const r = fullResult() as unknown as { applicationKnowledge: { entities: unknown[]; views: unknown[]; viewGraph: { nodes: never[]; edges: unknown[] } }; knowledgeWarnings?: string[] };
    const mkEntity = (i: number) => ({
      entityId: `E${i}`, type: 'product', attributes: {}, source: 'x', revision: 1,
      confidence: { level: 'medium', score: 0.5 } as never, firstSeenAt: 0, lastSeenAt: 0,
      observedInSessions: ['s'], currentState: 'x',
    });
    r.applicationKnowledge.entities = Array.from({ length: 12 }, (_, i) => mkEntity(i));
    r.applicationKnowledge.views = Array.from({ length: 9 }, (_, i) => ({ viewId: `vv-${i}`, label: `View ${i}`, detectedFrom: 'url', visitCount: 1, confidence: { level: 'medium', score: 0.5 } as never, firstSeenAt: 0, lastSeenAt: 0 }));
    r.applicationKnowledge.viewGraph = { nodes: [], edges: Array.from({ length: 11 }, (_, i) => ({ fromViewId: 'a', toViewId: `b${i}`, count: 1 })) };
    r.knowledgeWarnings = Array.from({ length: 12 }, (_, i) => `w${i}`);
    const el = renderUnderstandingCard(r as unknown as Parameters<typeof renderUnderstandingCard>[0], { gaps: Array.from({ length: 15 }, (_, i) => ({ key: String(i), gapId: `g${i}`, observedKind: 'counter', reason: 'r', detail: 'd', observedAtMs: 0, tabId: null, windowRefJson: '' })) as never });
    const t = el!.textContent ?? '';
    expect(t).toContain('… 4 more entities');
    expect(t).toContain('… 3 more views');
    expect(t).toContain('… 3 more transitions');
    // 12 knowledgeWarnings + 1 behaviorModel warning = 13 → 8 shown, 5 more.
    expect(t).toContain('… 5 more warnings');
    expect(t).toContain('… 5 more gaps');
    expect(t.match(/E\d+/g)!.length).toBe(8);
  });
});

// ── MS-U5 P10: forward-links block wiring (F1/F2) ───────────────────────

describe('renderUnderstandingCard — MS-U5 forward links (P10)', () => {
  const fwdSig = (o: Partial<ForwardSigLike> = {}) => ({
    actionType: 'Click',
    normalizedTarget: 'search',
    occurrenceCount: 1,
    status: 'active' as const,
    firstSeenAtSession: 'session-1',
    ...o,
  });

  it('P10a: block absent when no signatures and no gaps (honest absence)', () => {
    const el = renderUnderstandingCard(fullResult());
    expect(el!.textContent).not.toContain('What this recording improves');
  });

  it('P10b: F1 lines render for signatures, with action/target label', () => {
    const el = renderUnderstandingCard(fullResult(), {
      forwardSignatures: [fwdSig(), fwdSig({ actionType: 'TextEntry', normalizedTarget: 'q', occurrenceCount: 3 })],
    });
    const t = el!.textContent ?? '';
    expect(t).toContain('What this recording improves');
    expect(t).toContain('Click "search" ◆ new signature');
    expect(t).toContain('TextEntry "q" ◆ reinforced ×3');
  });

  it('P10c: F2 guidance appended after gaps rows when gaps exist', () => {
    const el = renderUnderstandingCard(fullResult(), {
      gaps: [
        { observedKind: 'ui', reason: 'no-live-horizon', detail: 'w outside horizon' },
        { observedKind: 'ui', reason: 'outside-horizon', detail: 'w2' },
      ],
    });
    const t = el!.textContent ?? '';
    expect(t).toContain('2 observation(s) could not be attributed (no-live-horizon ×1, outside-horizon ×1)');
    // gaps rows still render in §8 AND guidance rides the forward block.
    const gapIdx = t.indexOf('no-live-horizon — w outside horizon');
    const guidanceIdx = t.indexOf('2 observation(s)');
    expect(gapIdx).toBeGreaterThan(-1);
    expect(guidanceIdx).toBeGreaterThan(gapIdx);
  });

  it('P10d: F1 caps at 6 lines with honest overflow marker', () => {
    const sigs = Array.from({ length: 9 }, (_, i) => fwdSig({ normalizedTarget: `t${i}` }));
    const el = renderUnderstandingCard(fullResult(), { forwardSignatures: sigs });
    const t = el!.textContent ?? '';
    expect((t.match(/◆ new signature/g) ?? []).length).toBe(6);
    expect(t).toContain('… 3 more signatures');
  });

  it('P10e: XSS safety — actionType/target never injected as markup', () => {
    const el = renderUnderstandingCard(fullResult(), {
      forwardSignatures: [fwdSig({ actionType: '<img src=x onerror=1>', normalizedTarget: '<script>' })],
    });
    expect(el!.textContent).toContain('<img src=x onerror=1>');
    expect(document.querySelectorAll('img,script').length).toBe(0);
  });
});
