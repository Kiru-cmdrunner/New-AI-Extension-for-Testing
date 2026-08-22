/**
 * Phase 6A — Changed-Element Seed classification (pure module pins)
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §2.2, §2.4
 *
 * Pins the classifyChangedSummaries() contract of the NEW module
 * src/understanding/page-content/changed-element-seed.ts:
 *  - kind inference from change shape (counter / notification / status-badge /
 *    collection / entity candidates)
 *  - the seven noise gates (content/shape-based, ZERO timing)
 *  - the deterministic seed cap
 *
 * TDD: these pins are written BEFORE the module exists and must fail
 * (module-not-found) until implementation lands. No product code here.
 */

import { describe, it, expect } from 'vitest';
// NEW module — does not exist yet. This import failing IS the red state.
import {
  classifyChangedSummaries,
  MAX_CHANGED_ELEMENT_SEEDS,
} from '../../src/understanding/page-content/changed-element-seed';
import type { DomChangeSummary } from '../../src/shared/behavioral-evidence-types';

// ── Factory ────────────────────────────────────────────────

function summary(overrides: Partial<DomChangeSummary> = {}): DomChangeSummary {
  return {
    types: ['characterData'],
    targetPath: 'body > div#counter',
    targetTag: 'DIV',
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: { old: '0', new: '5' },
    firstMutationAt: 10,
    lastMutationAt: 20,
    rawMutationCount: 1,
    firstBatchIndex: 1,
    lastBatchIndex: 1,
    ...overrides,
  };
}

// ── Kind inference (change shape → candidate kinds) ───────

describe('classifyChangedSummaries — kind inference', () => {
  it('P1/P3: numeric characterData on a display element yields a counter candidate', () => {
    const seeds = classifyChangedSummaries([
      summary({ characterDataDelta: { old: '0', new: '5' }, targetTag: 'DIV' }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].summary.targetPath).toBe('body > div#counter');
    expect(seeds[0].candidateKinds).toContain('counter');
  });

  it('numeric characterData on an editable control (INPUT/TEXTAREA/SELECT) is NOT a counter', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const seeds = classifyChangedSummaries([
        summary({ targetTag: tag, targetPath: `body > ${tag.toLowerCase()}#x` }),
      ]);
      expect(seeds).toHaveLength(0);
    }
  });

  it('data-count attribute delta with numeric new value yields a counter candidate', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['attributes'],
        characterDataDelta: null,
        changedAttributes: ['data-count'],
        attributeDeltas: { 'data-count': { old: '3', new: '4' } },
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].candidateKinds).toContain('counter');
  });

  it('role set to alert/status yields a notification candidate', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['attributes'],
        characterDataDelta: null,
        changedAttributes: ['role'],
        attributeDeltas: { role: { old: null, new: 'status' } },
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].candidateKinds).toContain('notification');
  });

  it('non-numeric characterData yields notification/status-badge candidates (resolved from element facts later)', () => {
    const seeds = classifyChangedSummaries([
      summary({
        targetTag: 'DIV',
        characterDataDelta: { old: 'Pending', new: 'Payment Confirmed' },
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].candidateKinds).toContain('notification');
    expect(seeds[0].candidateKinds).toContain('status-badge');
  });

  it('childList additions yield a collection candidate for the parent', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['childList'],
        targetPath: 'body > ul#results',
        targetTag: 'UL',
        characterDataDelta: null,
        addedNodesCount: 3,
        removedNodesCount: 0,
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].candidateKinds).toContain('collection');
  });

  it('childList additions on a non-list parent still yield collection candidates (added-node resolution)', () => {
    // A <ul> appended to <body>: the summary targets the PARENT (body), but
    // the added children carry the semantics. Classification must still
    // produce a seed; resolution inspects the added children.
    const seeds = classifyChangedSummaries([
      summary({
        types: ['childList'],
        targetPath: 'body',
        targetTag: 'BODY',
        characterDataDelta: null,
        addedNodesCount: 1,
        removedNodesCount: 0,
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].candidateKinds).toContain('collection');
  });

  it('identity attribute delta (data-sku set) yields an entity candidate', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['attributes'],
        targetPath: 'body > ul#results > li',
        targetTag: 'LI',
        characterDataDelta: null,
        changedAttributes: ['data-sku'],
        attributeDeltas: { 'data-sku': { old: null, new: 'SKU-42' } },
      }),
    ]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].candidateKinds).toContain('entity');
  });

  it('identity vocabulary is the spec config family — data-id/data-key/data-user do NOT classify as entity', () => {
    // The seed classifier must NOT widen the attribute vocabulary past the
    // existing entity idAttribute conventions (review WARN 4): data-id,
    // data-key, data-uuid, data-uid, data-code, data-user, data-record,
    // data-row are NOT in the family and must not classify.
    for (const attr of ['data-id', 'data-key', 'data-uuid', 'data-uid', 'data-code', 'data-user', 'data-record', 'data-row']) {
      const seeds = classifyChangedSummaries([
        summary({
          types: ['attributes'],
          targetPath: 'body > div#x',
          targetTag: 'DIV',
          characterDataDelta: null,
          changedAttributes: [attr],
          attributeDeltas: { [attr]: { old: null, new: 'V' } },
        }),
      ]);
      expect(seeds, `attribute ${attr} must not classify`).toHaveLength(0);
    }
    // The spec family DOES classify:
    for (const attr of ['data-asin', 'data-product-id', 'data-item-id', 'data-sku', 'data-order-id', 'data-order-number']) {
      const seeds = classifyChangedSummaries([
        summary({
          types: ['attributes'],
          targetPath: 'body > div#x',
          targetTag: 'DIV',
          characterDataDelta: null,
          changedAttributes: [attr],
          attributeDeltas: { [attr]: { old: null, new: 'V' } },
        }),
      ]);
      expect(seeds.some((s) => s.candidateKinds.includes('entity')), `attribute ${attr} must classify as entity`).toBe(true);
    }
  });
});

// ── Noise gates (§2.4 — content/shape-based, no timing) ───

describe('classifyChangedSummaries — noise gates', () => {
  it('drops no-op characterData deltas (hydration placeholder echo)', () => {
    const seeds = classifyChangedSummaries([
      summary({ characterDataDelta: { old: '5', new: '5' } }),
      summary({ characterDataDelta: { old: '""', new: '""' }, targetPath: 'body > div#skel' }),
    ]);
    expect(seeds).toHaveLength(0);
  });

  it('drops skeleton / loading vocabulary text (generic words, not site tokens)', () => {
    const cases: Array<{ old: string | null; new: string | null }> = [
      { old: null, new: 'Loading' },
      { old: null, new: 'loading…' },
      { old: null, new: 'loading...' },
      { old: null, new: 'Loading some data' }, // startsWith loading, ≤16 chars
      { old: null, new: 'skeleton' },
      { old: null, new: '   ' }, // whitespace-only
    ];
    for (const delta of cases) {
      const seeds = classifyChangedSummaries([
        summary({ characterDataDelta: delta, targetPath: 'body > div#a' }),
      ]);
      expect(seeds).toHaveLength(0);
    }
  });

  it('keeps real content that merely CONTAINS the word loading (>16 chars)', () => {
    const seeds = classifyChangedSummaries([
      summary({
        characterDataDelta: { old: null, new: 'Your order is loading into the cart now' },
        targetPath: 'body > div#a',
      }),
    ]);
    expect(seeds).toHaveLength(1);
  });

  it('drops punctuation-only characterData', () => {
    const seeds = classifyChangedSummaries([
      summary({ characterDataDelta: { old: null, new: '— ...' } }),
    ]);
    expect(seeds).toHaveLength(0);
  });

  it('drops net-zero childList churn (mount/unmount, no other signal)', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['childList'],
        targetTag: 'DIV',
        characterDataDelta: null,
        addedNodesCount: 4,
        removedNodesCount: 4,
      }),
    ]);
    expect(seeds).toHaveLength(0);
  });

  it('drops characterData on SCRIPT/STYLE parents (upstream noise shape)', () => {
    const seeds = classifyChangedSummaries([
      summary({ targetTag: 'SCRIPT', targetPath: 'body > script#x' }),
      summary({ targetTag: 'STYLE', targetPath: 'body > style#x' }),
    ]);
    expect(seeds).toHaveLength(0);
  });

  it('drops shadow-context summaries (document adapter cannot resolve them)', () => {
    const seeds = classifyChangedSummaries([
      summary({ shadowContext: 'host-1', targetPath: '[host-1] > div#x' }),
    ]);
    expect(seeds).toHaveLength(0);
  });
});

// ── Determinism + cap ──────────────────────────────────────

describe('classifyChangedSummaries — cap and determinism', () => {
  it('caps seeds at MAX_CHANGED_ELEMENT_SEEDS, keeping input order', () => {
    const summaries: DomChangeSummary[] = [];
    for (let i = 0; i < 30; i++) {
      summaries.push(
        summary({
          targetPath: `body > div#c-${i}`,
          characterDataDelta: { old: '0', new: String(i + 1) },
          firstBatchIndex: i,
          lastBatchIndex: i,
        }),
      );
    }
    const seeds = classifyChangedSummaries(summaries);
    expect(MAX_CHANGED_ELEMENT_SEEDS).toBeLessThanOrEqual(24);
    expect(seeds).toHaveLength(MAX_CHANGED_ELEMENT_SEEDS);
    // First N in input order survive — deterministic, no timing.
    expect(seeds[0].summary.targetPath).toBe('body > div#c-0');
    expect(seeds[seeds.length - 1].summary.targetPath).toBe(`body > div#c-${seeds.length - 1}`);
  });

  it('is deterministic: same input → same output', () => {
    const input = [
      summary({ characterDataDelta: { old: '0', new: '2' } }),
      summary({
        types: ['childList'],
        targetPath: 'body > ul#r',
        targetTag: 'UL',
        characterDataDelta: null,
        addedNodesCount: 2,
      }),
    ];
    expect(classifyChangedSummaries(input)).toEqual(classifyChangedSummaries(input));
  });

  it('returns an empty array for an empty input', () => {
    expect(classifyChangedSummaries([])).toEqual([]);
  });
});
