/**
 * Phase 6A/6C stabilization — honesty pins for the changed-element seeding
 * classification (E9 / rung 7) and counter-kind selection (mixed numerals).
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md
 * (Semantic Observation Contract — ladder rungs 3 and 7, examples E2/E9)
 * + .drytis/notes/phase-6a6c-validation-report-2026-08-22.md (defects 1-2).
 *
 * TDD: written before the fix. Red until classifyChangedSummaries/pickSeedKind
 * implement the identity-coordinate gate and the mixed-numeral counter rule.
 * No product code here.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyChangedSummaries,
  type SeedCandidate,
} from '/workspace/src/understanding/page-content/changed-element-seed';
import type { DomChangeSummary } from '/workspace/src/shared/behavioral-evidence-types';

// ── Factory: one characterData summary on a given path/tag ──────────
function textChange(
  path: string,
  tag: string,
  oldT: string,
  newT: string,
): DomChangeSummary {
  return {
    types: ['characterData'],
    targetPath: path,
    targetTag: tag,
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: { old: oldT, new: newT },
    firstMutationAt: 1,
    lastMutationAt: 2,
    rawMutationCount: 1,
    firstBatchIndex: 5,
    lastBatchIndex: 6,
  };
}

describe('E9 / ladder rung 7 — counter-shape verification (classification layer)', () => {
  // Design note: identity facts (aria-label/role/#id) exist only at RESOLUTION
  // time, so the identity-coordinate GATE lives in pickSeedKind (observer) —
  // pinned in seeded-scan-honesty.test.ts. Classification verifies the
  // counter SHAPE (fix 2's precondition): a counter candidate means the text
  // is genuinely number-dominated, never a date/duration that merely contains
  // digits.

  it('E9 exact: "02h"→"02h 30m" produces NO counter candidate (duration ≠ counter shape)', () => {
    const out = classifyChangedSummaries([textChange('div.trip-duration', 'div', '02h', '02h 30m')]);
    expect(out.length).toBe(1);
    expect(out[0]!.candidateKinds).not.toContain('counter');
    expect(out[0]!.candidateKinds).toContain('notification'); // shape candidate; gated at resolution
  });

  it('E9 variant: pure-text path WITH #id coordinate still emits (honest, addressable)', () => {
    const out = classifyChangedSummaries([textChange('span#trip-dur', 'span', '02h', '02h 30m')]);
    expect(out.length).toBe(1);
    expect(out[0]!.candidateKinds).not.toContain('counter'); // non-numeric shape
    expect(out[0]!.candidateKinds).toContain('notification'); // addressable → allowed
  });

  it('mixed-numeral with #id: "4 items"→"5 items" counter candidate SURVIVES (shape-verified)', () => {
    const out = classifyChangedSummaries([textChange('span#cart', 'span', '4 items', '5 items')]);
    expect(out.length).toBe(1);
    const kinds = out[0]!.candidateKinds;
    expect(kinds).toContain('counter'); // fix 2: number+unit shape verified
  });

  it('mixed-numeral WITHOUT #id: counter candidate still present (gate applies at resolution)', () => {
    const out = classifyChangedSummaries([textChange('div.cart-badge', 'div', '4 items', '5 items')]);
    expect(out.length).toBe(1);
    expect(out[0]!.candidateKinds).toContain('counter');
  });

  it('date-like "Sat, 15 Aug"→"Sat, 22 Aug" produces NO counter candidate', () => {
    const out = classifyChangedSummaries([textChange('span#date-out', 'span', 'Sat, 15 Aug', 'Sat, 22 Aug')]);
    expect(out[0]!.candidateKinds).not.toContain('counter');
  });

  it('counter is reachable: bare-digit change keeps counter-only candidates (E2)', () => {
    const out = classifyChangedSummaries([textChange('span#cart', 'span', '4', '5')]);
    expect(out[0]!.candidateKinds).toEqual(['counter']);
  });
});
