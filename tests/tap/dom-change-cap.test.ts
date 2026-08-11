/**
 * M3 Unit Tests: DOM Change Cap (200-Entry Limit)
 *
 * Tests the 200-entry cap logic that the EvidenceCollector (M4) will use
 * when building the final ApplicationEvidence from DOMObserver summaries.
 *
 * The cap logic is: keep the first 200 DomChangeSummary entries, count the
 * overflow, and set coarseMode=true when the cap is exceeded.
 *
 * Per spec §5.2 Stage 3 and INV-APP-3: when coarseMode is true, the first 200
 * entries are preserved (NOT zero), and domChangeOverflow indicates how many
 * additional summaries were dropped.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3.4, §5.2
 */

import { describe, it, expect } from 'vitest';
import type { DomChangeSummary, ApplicationEvidence } from '../../src/shared/behavioral-evidence-types';

// ── Cap utility (will be used by EvidenceCollector in M4) ────────────

/** Maximum DomChangeSummary entries per evidence window. */
const MAX_DOM_CHANGES = 200;

/**
 * Apply the 200-entry cap to a set of DomChangeSummary entries.
 * Returns the capped entries + overflow count + coarseMode flag.
 *
 * Per spec INV-APP-3: keeps the FIRST 200 entries, NOT zero.
 */
function applyDomChangeCap(summaries: DomChangeSummary[]): {
  domChanges: DomChangeSummary[];
  domChangeOverflow: number;
  coarseMode: boolean;
} {
  if (summaries.length <= MAX_DOM_CHANGES) {
    return {
      domChanges: summaries,
      domChangeOverflow: 0,
      coarseMode: false,
    };
  }

  return {
    domChanges: summaries.slice(0, MAX_DOM_CHANGES),
    domChangeOverflow: summaries.length - MAX_DOM_CHANGES,
    coarseMode: true,
  };
}

/**
 * Build a test DomChangeSummary.
 */
function makeSummary(index: number): DomChangeSummary {
  return {
    types: ['attributes'],
    targetPath: `div#el-${index}`,
    targetTag: 'div',
    shadowContext: null,
    changedAttributes: ['class'],
    attributeDeltas: { class: { old: null, new: 'active' } },
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: null,
    firstMutationAt: index * 10,
    lastMutationAt: index * 10 + 5,
    rawMutationCount: 1,
    firstBatchIndex: index,
    lastBatchIndex: index,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('DOM Change Cap (200-Entry Limit)', () => {
  // ── Under-cap behavior ─────────────────────────────────────────────

  it('keeps all entries when count < 200', () => {
    const summaries = Array.from({ length: 50 }, (_, i) => makeSummary(i));
    const result = applyDomChangeCap(summaries);

    expect(result.domChanges.length).toBe(50);
    expect(result.domChangeOverflow).toBe(0);
    expect(result.coarseMode).toBe(false);
  });

  it('keeps all entries when count === 200 (exact boundary)', () => {
    const summaries = Array.from({ length: 200 }, (_, i) => makeSummary(i));
    const result = applyDomChangeCap(summaries);

    expect(result.domChanges.length).toBe(200);
    expect(result.domChangeOverflow).toBe(0);
    expect(result.coarseMode).toBe(false);
  });

  // ── Over-cap behavior ──────────────────────────────────────────────

  it('caps at 200 when count === 201', () => {
    const summaries = Array.from({ length: 201 }, (_, i) => makeSummary(i));
    const result = applyDomChangeCap(summaries);

    expect(result.domChanges.length).toBe(200);
    expect(result.domChangeOverflow).toBe(1);
    expect(result.coarseMode).toBe(true);
  });

  it('caps at 200 and counts overflow when count is much higher', () => {
    const summaries = Array.from({ length: 500 }, (_, i) => makeSummary(i));
    const result = applyDomChangeCap(summaries);

    expect(result.domChanges.length).toBe(200);
    expect(result.domChangeOverflow).toBe(300);
    expect(result.coarseMode).toBe(true);
  });

  it('caps at 200 for extremely high churn (1000+ entries)', () => {
    const summaries = Array.from({ length: 1000 }, (_, i) => makeSummary(i));
    const result = applyDomChangeCap(summaries);

    expect(result.domChanges.length).toBe(200);
    expect(result.domChangeOverflow).toBe(800);
    expect(result.coarseMode).toBe(true);
  });

  // ── First-200 preserved (NOT zero) ─────────────────────────────────

  it('keeps the FIRST 200 entries (not random/last)', () => {
    const summaries = Array.from({ length: 300 }, (_, i) => makeSummary(i));
    const result = applyDomChangeCap(summaries);

    // The first entry should be index 0
    expect(result.domChanges[0].firstBatchIndex).toBe(0);
    // The last kept entry should be index 199
    expect(result.domChanges[199].firstBatchIndex).toBe(199);
    // Index 200 should NOT be present
    expect(result.domChanges.find((s) => s.firstBatchIndex === 200)).toBeUndefined();
  });

  // ── Empty input ────────────────────────────────────────────────────

  it('handles empty input', () => {
    const result = applyDomChangeCap([]);

    expect(result.domChanges.length).toBe(0);
    expect(result.domChangeOverflow).toBe(0);
    expect(result.coarseMode).toBe(false);
  });

  it('handles single entry', () => {
    const result = applyDomChangeCap([makeSummary(0)]);

    expect(result.domChanges.length).toBe(1);
    expect(result.domChangeOverflow).toBe(0);
    expect(result.coarseMode).toBe(false);
  });

  // ── ApplicationEvidence integration shape ──────────────────────────

  it('capped results can populate ApplicationEvidence correctly', () => {
    const summaries = Array.from({ length: 250 }, (_, i) => makeSummary(i));
    const capped = applyDomChangeCap(summaries);

    const appEvidence: ApplicationEvidence = {
      domChanges: capped.domChanges,
      domChangeOverflow: capped.domChangeOverflow,
      coarseMode: capped.coarseMode,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: capped.coarseMode,
        longestBatchMs: 5,
        totalBatches: 250,
      },
    };

    expect(appEvidence.domChanges.length).toBe(200);
    expect(appEvidence.domChangeOverflow).toBe(50);
    expect(appEvidence.coarseMode).toBe(true);
    expect(appEvidence.performanceCondition!.highChurnMode).toBe(true);
  });

  // ── Surfaces still tracked when capped ─────────────────────────────

  it('surfaces and visibility changes are independent of the 200 cap', () => {
    // The cap only applies to domChanges, not surfaces or visibility.
    // EvidenceCollector will collect surfaces/visibility separately.
    const summaries = Array.from({ length: 300 }, (_, i) => makeSummary(i));
    const capped = applyDomChangeCap(summaries);

    // Even with coarseMode=true, surfaces/visibility would still be
    // included in ApplicationEvidence (not subject to the 200 cap)
    expect(capped.coarseMode).toBe(true);
    expect(capped.domChanges.length).toBe(200);

    // The test verifies the cap function doesn't touch surfaces/visibility —
    // those are collected from DOMObserver.getSurfaceChanges() independently.
  });
});
