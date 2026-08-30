/**
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §5, §4 (T1b, T3)
 * Pin 1 of §14 — hover-qualification-verdict.
 *
 * Truth table for computeHoverQualification — the capture-time verdict:
 *   evidenced ⇔ ≥1 NEW, target-local, baseline-relative T3 transition.
 *
 * NEVER qualifying: global churn (outside owned set), network rows, dwell
 * time, mousemove jitter, nav events (Decision D1), pre-existing state
 * (baseline-held), unrelated mutations.
 */

import { describe, it, expect } from 'vitest';
import {
  computeHoverQualification,
  HOVER_REASON_MAX_CHARS,
  type HoverQualificationInput,
} from '../../src/tap/hover-qualification';
import type {
  DomChangeSummary,
  SurfaceChange,
  VisibilityChange,
} from '../../src/shared/behavioral-evidence-types';

// ── Fixture builders (structural vocabulary only — no site tokens) ──

const anchorIdentity = {
  stableId: 'menu-trigger',
  cssSelector: '#menu-trigger',
  xPath: '/html/body/div[@id="menu-trigger"]',
  tag: 'DIV',
} as const;

const baselineState = {
  anchor: {
    ariaExpanded: 'false' as string | null,
    ariaHidden: null as string | null,
    hidden: false,
  },
};

function input(overrides: Partial<HoverQualificationInput> = {}): HoverQualificationInput {
  return {
    anchorIdentity: { ...anchorIdentity },
    anchorKey: 'id:menu-trigger',
    clickAnchorKey: 'id:menu-trigger',
    resolution: 'self' as const,
    hoverReveal: false,
    shaped: true,
    baseline: baselineState,
    domChanges: [],
    newSurfaces: [],
    visibilityChanges: [],
    pointerPathEnters: [],
    networkRows: 0,
    navigationCount: 0,
    openedBatch: 0,
    ...overrides,
  };
}

function attrFlip(path: string, attr: string, from: string, to: string, batchIndex = 1): DomChangeSummary {
  return {
    types: ['attributes'] as never,
    targetPath: path,
    targetTag: 'DIV',
    shadowContext: null,
    changedAttributes: [attr],
    attributeDeltas: { [attr]: { old: from, new: to } },
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: null,
    firstMutationAt: 10,
    lastMutationAt: 20,
    rawMutationCount: 1,
    firstBatchIndex: batchIndex,
    lastBatchIndex: batchIndex,
  };
}

function addedSurface(path: string, emergence: 'inserted' | 'revealed', batchIndex = 1): SurfaceChange {
  return {
    path,
    tagName: 'DIV',
    ariaRole: 'menu',
    accessibleName: null,
    shadowContext: null,
    descendantCount: 1,
    relativeTime: 50,
    batchIndex,
    kind: 'added',
    emergence,
  };
}

function visibilityFlip(path: string, property: 'display' | 'visibility', oldV: string, newV: string, batchIndex = 1): VisibilityChange {
  return {
    path,
    property,
    oldValue: oldV,
    newValue: newV,
    relativeTime: 60,
    batchIndex,
  } as VisibilityChange;
}

// ── Earning classes ───────────────────────────────────────────────────

describe('verdict: evidenced — earned by T3 transitions', () => {
  it('reveal: aria-expanded false→true on the anchor itself (baseline false)', () => {
    const q = computeHoverQualification(input({
      domChanges: [attrFlip('body > div#menu-trigger', 'aria-expanded', 'false', 'true')],
    }));
    expect(q.verdict).toBe('evidenced');
    expect(q.evidenceClass).toBe('reveal');
    expect(q.evidenceReason).toContain('aria-expanded');
    expect(q.evidenceReason).toContain('false→true');
  });

  it('reveal: joined surface emerged (emergence=rerevealed, path contains anchor id)', () => {
    const q = computeHoverQualification(input({
      newSurfaces: [addedSurface('body > div#menu-trigger > div:nth-of-type(2)', 'revealed')],
    }));
    expect(q.verdict).toBe('evidenced');
    expect(q.evidenceClass).toBe('reveal');
    expect(q.evidenceReason).toContain('emerged');
  });

  it('revert: display →none on a joined surface at leave', () => {
    const q = computeHoverQualification(input({
      visibilityChanges: [visibilityFlip('body > div#menu-trigger > div:nth-of-type(2)', 'display', 'block', 'none')],
    }));
    expect(q.verdict).toBe('evidenced');
    expect(q.evidenceClass).toBe('revert');
    expect(q.evidenceReason).toContain('display');
  });

  it('pointer-reach: later gated enter joins an insertion fact in the same window', () => {
    const q = computeHoverQualification(input({
      domChanges: [attrFlip('body > div#menu-trigger > div:nth-of-type(2)', 'class', 'x', 'y')],
      newSurfaces: [addedSurface('body > div#menu-trigger > div:nth-of-type(2)', 'inserted')],
      pointerPathEnters: [{
        identity: { stableId: 'menu-item', cssSelector: '#menu-item', xPath: '/html/body/div[@id="menu-trigger"]/div[2]/div', tag: 'DIV' } as never,
      }],
    }));
    expect(q.verdict).toBe('evidenced');
    expect(q.evidenceClass).toBe('pointer-reach');
    expect(q.evidenceReason).toContain('pointer');
  });
});

// ── Never-qualifying facts ────────────────────────────────────────────

describe('verdict: gesture-only — nothing earned', () => {
  it('global DOM churn outside the owned set', () => {
    const q = computeHoverQualification(input({
      domChanges: [attrFlip('body > section:nth-of-type(3) > ul', 'class', 'a', 'b')],
    }));
    expect(q.verdict).toBe('gesture-only');
    expect(q.evidenceClass).toBeNull();
  });

  it('network rows never qualify', () => {
    const q = computeHoverQualification(input({ networkRows: 12 }));
    expect(q.verdict).toBe('gesture-only');
    expect(q.factSummary.networkRows).toBe(12);
  });

  it('navigation events never qualify (Decision D1)', () => {
    const q = computeHoverQualification(input({ navigationCount: 2 }));
    expect(q.verdict).toBe('gesture-only');
  });

  it('pre-existing open state: baseline already true, no NEW transition', () => {
    const q = computeHoverQualification(input({
      baseline: { anchor: { ariaExpanded: 'true', ariaHidden: null, hidden: false } },
      domChanges: [], // nothing flipped after enter
    }));
    expect(q.verdict).toBe('gesture-only');
    expect(q.evidenceReason).toContain('gesture-only');
  });

  it('flip that already held at baseline (aria-expanded already true at enter)', () => {
    // DOM shows aria-expanded true→true — no transition
    const q = computeHoverQualification(input({
      baseline: { anchor: { ariaExpanded: 'true', ariaHidden: null, hidden: false } },
      domChanges: [attrFlip('body > div#menu-trigger', 'aria-expanded', 'true', 'true')],
    }));
    expect(q.verdict).toBe('gesture-only');
  });

  it('unrelated mutation inside owned set but non-reveal (text-only change)', () => {
    const q = computeHoverQualification(input({
      domChanges: [{
        ...attrFlip('body > div#menu-trigger', 'class', 'a', 'b'),
        changedAttributes: ['class'],
        attributeDeltas: { class: { old: 'a', new: 'b' } },
      }],
    }));
    expect(q.verdict).toBe('gesture-only');
  });

  it('empty window — honest gesture-only reason', () => {
    const q = computeHoverQualification(input());
    expect(q.verdict).toBe('gesture-only');
    expect(q.evidenceReason.length).toBeGreaterThan(0);
    expect(q.evidenceReason.length).toBeLessThanOrEqual(HOVER_REASON_MAX_CHARS);
  });
});

// ── Reason determinism + cap (D3) ─────────────────────────────────────

describe('reason: deterministic, capped (Decision D3)', () => {
  it('same facts ⇒ identical string (repeat 3×)', () => {
    const inp = input({
      domChanges: [attrFlip('body > div#menu-trigger', 'aria-expanded', 'false', 'true')],
    });
    const a = computeHoverQualification(inp);
    const b = computeHoverQualification(inp);
    const c = computeHoverQualification(inp);
    expect(a.evidenceReason).toBe(b.evidenceReason);
    expect(b.evidenceReason).toBe(c.evidenceReason);
  });

  it('never exceeds 200 chars', () => {
    const many: DomChangeSummary[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(attrFlip(`body > div#menu-trigger > div:nth-of-type(${i})`, 'aria-expanded', 'false', 'true'));
    }
    const q = computeHoverQualification(input({ domChanges: many }));
    expect(q.evidenceReason.length).toBeLessThanOrEqual(HOVER_REASON_MAX_CHARS);
  });
});

// ── Degradation honesty (R-Q8) ────────────────────────────────────────

describe('baseline degradation (R-Q8)', () => {
  it('missing baseline entry ⇒ gesture-only, never fabricates', () => {
    const q = computeHoverQualification(input({
      baseline: null,
      // Anchor-OWN aria-expanded flip: with no baseline we cannot prove the
      // from-state was not already true at enter (pre-existing open) —
      // degrade honestly (R-Q8).
      domChanges: [attrFlip('body > div#menu-trigger', 'aria-expanded', 'false', 'true')],
    }));
    expect(q.verdict).toBe('gesture-only');
    expect(q.evidenceReason).toContain('baseline');
  });
});

// ── Frozen (R-Q2) ─────────────────────────────────────────────────────

describe('freeze (R-Q2)', () => {
  it('record is deeply frozen', () => {
    const q = computeHoverQualification(input({
      domChanges: [attrFlip('body > div#menu-trigger', 'aria-expanded', 'false', 'true')],
    }));
    expect(Object.isFrozen(q)).toBe(true);
    expect(Object.isFrozen(q.anchorFacts)).toBe(true);
    expect(Object.isFrozen(q.factSummary)).toBe(true);
    expect(() => {
      (q as { verdict?: string }).verdict = 'tampered';
    }).toThrow();
  });
});

// ── factSummary honesty ───────────────────────────────────────────────

describe('factSummary', () => {
  it('counts owned vs total dom changes and network rows', () => {
    const q = computeHoverQualification(input({
      domChanges: [
        attrFlip('body > div#menu-trigger', 'aria-expanded', 'false', 'true'),
        attrFlip('body > section:nth-of-type(9)', 'class', 'a', 'b'),
      ],
      networkRows: 3,
    }));
    expect(q.factSummary.domChangesTotal).toBe(2);
    expect(q.factSummary.domChangesInOwnedSet).toBe(1);
    expect(q.factSummary.networkRows).toBe(3);
  });
});
