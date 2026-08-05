/**
 * Phase 0 — netNodeDelta enrichment tests.
 *
 * Verifies that content-change SemanticEffects carry a `netNodeDelta` field
 * computed from the underlying MutationRecord2 added/removed counts.
 * Also verifies non-content-change effects do NOT carry the field (absent).
 *
 * The Capability Model will use netNodeDelta as a SUPPORTING signal:
 *   - SortSelection: delta ≈ 0 (items reordered, not added/removed)
 *   - FilterSelection: strongly negative delta (items removed)
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 0)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { checkContentChange, checkStateToggle } from '../../src/semantics/effect-rules';
import type { WindowQuality } from '../../src/semantics/effect-rules';
import {
  makeResult,
  makeSnapshot,
  makeMutation,
  makeContext,
  resetMutIds,
} from './fixtures';

beforeEach(() => resetMutIds());

const cleanQuality: WindowQuality = { isNoisy: false, isEarlyClose: false };
const ctx = makeContext();

// ────────────────────────────────────────────────────────────────────────
// Snapshot childCount delta → netNodeDelta
// ────────────────────────────────────────────────────────────────────────
describe('netNodeDelta: snapshot childCount delta', () => {
  it('childCount 12→2 → netNodeDelta = -10', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 12 }),
      finalSnapshot: makeSnapshot({ childCount: 2 }),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(-10);
  });

  it('childCount 5→8 → netNodeDelta = 3', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 5 }),
      finalSnapshot: makeSnapshot({ childCount: 8 }),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects[0].netNodeDelta).toBe(3);
  });

  it('childCount 4→4 → no content-change effect (no delta)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 4 }),
      finalSnapshot: makeSnapshot({ childCount: 4 }),
    });
    expect(checkContentChange(result, ctx, cleanQuality)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Snapshot textContent delta → netNodeDelta = 0
// ────────────────────────────────────────────────────────────────────────
describe('netNodeDelta: snapshot textContent delta', () => {
  it('textContent change → netNodeDelta = 0 (no childList)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ textContent: 'Loading', childCount: 0 }),
      finalSnapshot: makeSnapshot({ textContent: 'Done', childCount: 0 }),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Structural mutations: per-path effects
// ────────────────────────────────────────────────────────────────────────
describe('netNodeDelta: per-path structural mutations', () => {
  it('additions only → positive delta', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 5,
          removedNodesCount: 0,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(5);
  });

  it('removals only → negative delta', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 0,
          removedNodesCount: 8,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(-8);
  });

  it('equal add/remove (sort scenario) → delta ≈ 0', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 20,
          removedNodesCount: 20,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(0);
  });

  it('multiple childList mutations on same path aggregate', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 3,
          removedNodesCount: 1,
        }),
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 2,
          removedNodesCount: 4,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    // (3+2) - (1+4) = 5 - 5 = 0
    expect(effects[0].netNodeDelta).toBe(0);
  });

  it('characterData only → netNodeDelta = 0', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'characterData',
          targetPath: '#label',
          oldValue: 'A',
          newValue: 'B',
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(0);
  });

  it('mixed childList + characterData on same path', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#card',
          addedNodesCount: 2,
          removedNodesCount: 1,
        }),
        makeMutation({
          type: 'characterData',
          targetPath: '#card',
          oldValue: 'old',
          newValue: 'new',
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    // (2) - (1) = 1
    expect(effects[0].netNodeDelta).toBe(1);
  });

  it('two distinct paths → each carries its own delta', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 0,
          removedNodesCount: 10,
        }),
        makeMutation({
          type: 'childList',
          targetPath: '#count',
          addedNodesCount: 1,
          removedNodesCount: 0,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(2);
    const resultsEffect = effects.find((e) => e.affectedTarget.cssPath === '#results');
    const countEffect = effects.find((e) => e.affectedTarget.cssPath === '#count');
    expect(resultsEffect).toBeDefined();
    expect(resultsEffect!.netNodeDelta).toBe(-10);
    expect(countEffect).toBeDefined();
    expect(countEffect!.netNodeDelta).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Aggregated effect (broad rerender) → total netNodeDelta
// ────────────────────────────────────────────────────────────────────────
describe('netNodeDelta: aggregated broad rerender', () => {
  it('6+ paths → aggregated delta from all childList mutations', () => {
    const paths = ['#a', '#b', '#c', '#d', '#e', '#f'];
    const result = makeResult({
      mutations: paths.map((p) =>
        makeMutation({
          type: 'childList',
          targetPath: p,
          addedNodesCount: 2,
          removedNodesCount: 1,
        }),
      ),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].affectedTarget.cssPath).toBe('(multiple)');
    // 6 paths × (2 added - 1 removed) = 12 - 6 = 6
    expect(effects[0].netNodeDelta).toBe(6);
  });

  it('aggregated with mixed add/remove across paths', () => {
    const result = makeResult({
      mutations: [
        // Path A: 3 added, 0 removed
        makeMutation({ type: 'childList', targetPath: '#a', addedNodesCount: 3, removedNodesCount: 0 }),
        // Path B: 0 added, 5 removed
        makeMutation({ type: 'childList', targetPath: '#b', addedNodesCount: 0, removedNodesCount: 5 }),
        // Path C: 2 added, 2 removed
        makeMutation({ type: 'childList', targetPath: '#c', addedNodesCount: 2, removedNodesCount: 2 }),
        // Path D: 1 added, 0 removed
        makeMutation({ type: 'childList', targetPath: '#d', addedNodesCount: 1, removedNodesCount: 0 }),
        // Path E: 0 added, 3 removed
        makeMutation({ type: 'childList', targetPath: '#e', addedNodesCount: 0, removedNodesCount: 3 }),
        // Path F: 4 added, 1 removed
        makeMutation({ type: 'childList', targetPath: '#f', addedNodesCount: 4, removedNodesCount: 1 }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    // (3+0+2+1+0+4) - (0+5+2+0+3+1) = 10 - 11 = -1
    expect(effects[0].netNodeDelta).toBe(-1);
  });

  it('aggregated with characterData only (no childList) → delta 0', () => {
    const paths = ['#a', '#b', '#c', '#d', '#e', '#f'];
    const result = makeResult({
      mutations: paths.map((p) =>
        makeMutation({
          type: 'characterData',
          targetPath: p,
          oldValue: 'old',
          newValue: 'new',
        }),
      ),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].netNodeDelta).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Non-content-change effects: netNodeDelta absent
// ────────────────────────────────────────────────────────────────────────
describe('netNodeDelta: absent on non-content-change effects', () => {
  it('state-toggle effect does NOT carry netNodeDelta', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: false }),
      finalSnapshot: makeSnapshot({ checked: true }),
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('state-toggle');
    expect(effects[0].netNodeDelta).toBeUndefined();
  });
});
