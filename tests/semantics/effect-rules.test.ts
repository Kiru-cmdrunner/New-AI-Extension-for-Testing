/**
 * Per-rule unit tests for the Semantic Effect Interpretation engine.
 *
 * Each describe block tests one rule function in isolation.
 * Tests use synthetic ObservationResults built from fixtures.
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkStateToggle,
  checkExpandCollapse,
  checkEnableDisable,
  checkContentChange,
  checkVisibilityChange,
  makeNoObservableEffect,
  makeUnclassified,
  computeQuality,
} from '../../src/semantics/effect-rules';
import type { WindowQuality } from '../../src/semantics/effect-rules';
import {
  makeResult,
  makeSnapshot,
  makeMutation,
  makeContext,
  resetMutIds,
} from './fixtures';

beforeEach(() => resetMutIds());

// ────────────────────────────────────────────────────────────────────────
// checkStateToggle
// ────────────────────────────────────────────────────────────────────────
describe('checkStateToggle', () => {
  const ctx = makeContext();

  it('checked false→true via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: false }),
      finalSnapshot: makeSnapshot({ checked: true }),
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('state-toggle');
    expect(effects[0].confidence).toBe('high');
    expect(effects[0].confidenceBasis).toBe('direct-property');
    expect(effects[0].description).toContain('checked: false → true');
  });

  it('checked true→false via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: true }),
      finalSnapshot: makeSnapshot({ checked: false }),
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('checked: true → false');
  });

  it('ariaChecked via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('aria-checked: false → true');
  });

  it('ariaPressed via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaPressed: false }),
      finalSnapshot: makeSnapshot({ ariaPressed: true }),
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('aria-pressed: false → true');
  });

  it('aria-checked via mutation only (beforeSnapshot null)', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: makeSnapshot(),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'aria-checked',
          oldValue: 'false',
          newValue: 'true',
          targetPath: 'body > div.row',
        }),
      ],
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].confidence).toBe('high');
    expect(effects[0].affectedTarget.cssPath).toBe('body > div.row');
  });

  it('aria-pressed via mutation only', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: makeSnapshot(),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'aria-pressed',
          oldValue: 'false',
          newValue: 'true',
        }),
      ],
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('aria-pressed: false → true');
  });

  it('both .checked and ariaChecked change → two effects', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: false, ariaChecked: false }),
      finalSnapshot: makeSnapshot({ checked: true, ariaChecked: true }),
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(2);
  });

  it('snapshot + mutation for same attr (dedup)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'aria-checked',
          oldValue: 'false',
          newValue: 'true',
          targetPath: 'body > div.row',
        }),
      ],
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects).toHaveLength(1);
  });

  it('no toggle — all null', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: null }),
      finalSnapshot: makeSnapshot({ ariaChecked: null }),
    });
    expect(checkStateToggle(result, ctx)).toHaveLength(0);
  });

  it('no toggle — same values', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: true }),
      finalSnapshot: makeSnapshot({ checked: true }),
    });
    expect(checkStateToggle(result, ctx)).toHaveLength(0);
  });

  it('HIGH under noise', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      performanceCondition: { batchRecordCount: 500, batchDurationMs: 50, timestamp: 2000 },
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects[0].confidence).toBe('high');
  });

  it('HIGH under early close', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      endReason: 'recording-stopped',
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects[0].confidence).toBe('high');
  });

  it('HIGH under noise + early close', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      performanceCondition: { batchRecordCount: 500, batchDurationMs: 50, timestamp: 2000 },
      endReason: 'recording-stopped',
    });
    const effects = checkStateToggle(result, ctx);
    expect(effects[0].confidence).toBe('high');
  });

  it('mutation with null oldValue → no effect (cannot determine direction)', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: makeSnapshot(),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'aria-checked',
          oldValue: null,
          newValue: 'true',
        }),
      ],
    });
    expect(checkStateToggle(result, ctx)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// checkExpandCollapse
// ────────────────────────────────────────────────────────────────────────
describe('checkExpandCollapse', () => {
  const ctx = makeContext();

  it('expanded→collapsed via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: true }),
      finalSnapshot: makeSnapshot({ ariaExpanded: false }),
    });
    const effects = checkExpandCollapse(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('expand-collapse');
    expect(effects[0].confidence).toBe('high');
    expect(effects[0].description).toContain('expanded → collapsed');
  });

  it('collapsed→expanded via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: false }),
      finalSnapshot: makeSnapshot({ ariaExpanded: true }),
    });
    const effects = checkExpandCollapse(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('collapsed → expanded');
  });

  it('via mutation only', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: makeSnapshot(),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'aria-expanded',
          oldValue: 'true',
          newValue: 'false',
          targetPath: 'body > div.panel',
        }),
      ],
    });
    const effects = checkExpandCollapse(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].affectedTarget.cssPath).toBe('body > div.panel');
  });

  it('no change — both null', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: null }),
      finalSnapshot: makeSnapshot({ ariaExpanded: null }),
    });
    expect(checkExpandCollapse(result, ctx)).toHaveLength(0);
  });

  it('no change — same value', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: true }),
      finalSnapshot: makeSnapshot({ ariaExpanded: true }),
    });
    expect(checkExpandCollapse(result, ctx)).toHaveLength(0);
  });

  it('HIGH under noise', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: true }),
      finalSnapshot: makeSnapshot({ ariaExpanded: false }),
      performanceCondition: { batchRecordCount: 500, batchDurationMs: 50, timestamp: 2000 },
    });
    const effects = checkExpandCollapse(result, ctx);
    expect(effects[0].confidence).toBe('high');
  });

  it('HIGH under early close', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: true }),
      finalSnapshot: makeSnapshot({ ariaExpanded: false }),
      endReason: 'recording-stopped',
    });
    const effects = checkExpandCollapse(result, ctx);
    expect(effects[0].confidence).toBe('high');
  });

  it('description format uses expanded/collapsed not true/false', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: true }),
      finalSnapshot: makeSnapshot({ ariaExpanded: false }),
    });
    const effects = checkExpandCollapse(result, ctx);
    expect(effects[0].description).not.toContain('true');
    expect(effects[0].description).not.toContain('false');
  });
});

// ────────────────────────────────────────────────────────────────────────
// checkEnableDisable
// ────────────────────────────────────────────────────────────────────────
describe('checkEnableDisable', () => {
  const ctx = makeContext();

  it('disabled→enabled via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ disabled: true }),
      finalSnapshot: makeSnapshot({ disabled: false }),
    });
    const effects = checkEnableDisable(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('enable-disable');
    expect(effects[0].confidence).toBe('high');
    expect(effects[0].description).toContain('disabled → enabled');
  });

  it('enabled→disabled via snapshot', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ disabled: false }),
      finalSnapshot: makeSnapshot({ disabled: true }),
    });
    const effects = checkEnableDisable(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('enabled → disabled');
  });

  it('via mutation — attribute added (becomes disabled)', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: makeSnapshot(),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'disabled',
          oldValue: null,
          newValue: '',
        }),
      ],
    });
    const effects = checkEnableDisable(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('enabled → disabled');
  });

  it('via mutation — attribute removed (becomes enabled)', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: makeSnapshot(),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'disabled',
          oldValue: '',
          newValue: null,
        }),
      ],
    });
    const effects = checkEnableDisable(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('disabled → enabled');
  });

  it('no change', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ disabled: false }),
      finalSnapshot: makeSnapshot({ disabled: false }),
    });
    expect(checkEnableDisable(result, ctx)).toHaveLength(0);
  });

  it('HIGH under noise', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ disabled: true }),
      finalSnapshot: makeSnapshot({ disabled: false }),
      performanceCondition: { batchRecordCount: 500, batchDurationMs: 50, timestamp: 2000 },
    });
    const effects = checkEnableDisable(result, ctx);
    expect(effects[0].confidence).toBe('high');
  });
});

// ────────────────────────────────────────────────────────────────────────
// checkContentChange
// ────────────────────────────────────────────────────────────────────────
describe('checkContentChange', () => {
  const ctx = makeContext();
  const cleanQuality: WindowQuality = { isNoisy: false, isEarlyClose: false };
  const noisyQuality: WindowQuality = { isNoisy: true, isEarlyClose: false };
  const earlyQuality: WindowQuality = { isNoisy: false, isEarlyClose: true };

  it('childCount delta', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 12 }),
      finalSnapshot: makeSnapshot({ childCount: 2 }),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('content-change');
    expect(effects[0].confidence).toBe('medium');
    expect(effects[0].description).toContain('child elements: 12 → 2');
  });

  it('textContent delta', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ textContent: 'Loading' }),
      finalSnapshot: makeSnapshot({ textContent: 'Done' }),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('text changed');
  });

  it('childList mutation — additions only', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 2,
          removedNodesCount: 0,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].confidence).toBe('medium');
    expect(effects[0].description).toContain('2 added');
    expect(effects[0].affectedTarget.cssPath).toBe('#results');
  });

  it('childList mutation — removals only', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 0,
          removedNodesCount: 3,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].description).toContain('3 removed');
  });

  it('characterData mutation', () => {
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
    expect(effects[0].description).toContain('text content changed');
  });

  it('mixed childList + characterData on same path', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#card',
          addedNodesCount: 1,
          removedNodesCount: 0,
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
    expect(effects[0].description).toContain('1 added');
    expect(effects[0].description).toContain('text changes');
  });

  it('two distinct paths → two effects', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 2,
        }),
        makeMutation({
          type: 'childList',
          targetPath: '#count',
          addedNodesCount: 1,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(2);
  });

  it('three distinct paths → three effects', () => {
    const paths = ['#a', '#b', '#c'];
    const result = makeResult({
      mutations: paths.map((p) =>
        makeMutation({ type: 'childList', targetPath: p, addedNodesCount: 1 }),
      ),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(3);
  });

  it('five distinct paths (boundary) → five individual effects', () => {
    const paths = ['#a', '#b', '#c', '#d', '#e'];
    const result = makeResult({
      mutations: paths.map((p) =>
        makeMutation({ type: 'childList', targetPath: p, addedNodesCount: 1 }),
      ),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(5);
  });

  it('six distinct paths → one aggregated effect', () => {
    const paths = ['#a', '#b', '#c', '#d', '#e', '#f'];
    const result = makeResult({
      mutations: paths.map((p) =>
        makeMutation({ type: 'childList', targetPath: p, addedNodesCount: 1 }),
      ),
    });
    const effects = checkContentChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].description).toContain('broad structural change');
    expect(effects[0].description).toContain('6 mutations across 6 paths');
    expect(effects[0].affectedTarget.cssPath).toBe('(multiple)');
  });

  it('+ noise → LOW (noise-degraded)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 12 }),
      finalSnapshot: makeSnapshot({ childCount: 2 }),
    });
    const effects = checkContentChange(result, ctx, noisyQuality);
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].confidenceBasis).toBe('noise-degraded');
  });

  it('+ early close → LOW (early-close)', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 1,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, earlyQuality);
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].confidenceBasis).toBe('early-close');
  });

  it('+ noise + early close → LOW (already at floor, early-close wins basis)', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#results',
          addedNodesCount: 1,
        }),
      ],
    });
    const effects = checkContentChange(result, ctx, { isNoisy: true, isEarlyClose: true });
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].confidenceBasis).toBe('early-close');
  });

  it('no content change — no structural mutations, no snapshot delta', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 5 }),
      finalSnapshot: makeSnapshot({ childCount: 5 }),
    });
    expect(checkContentChange(result, ctx, cleanQuality)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// checkVisibilityChange
// ────────────────────────────────────────────────────────────────────────
describe('checkVisibilityChange', () => {
  const ctx = makeContext();
  const cleanQuality: WindowQuality = { isNoisy: false, isEarlyClose: false };
  const noisyQuality: WindowQuality = { isNoisy: true, isEarlyClose: false };

  it('element-removed endReason → effect', () => {
    const result = makeResult({ endReason: 'element-removed' });
    const effects = checkVisibilityChange(result, ctx, cleanQuality);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('visibility-change');
    expect(effects[0].confidence).toBe('medium');
  });

  it('completed endReason → no effect', () => {
    const result = makeResult({ endReason: 'completed' });
    expect(checkVisibilityChange(result, ctx, cleanQuality)).toHaveLength(0);
  });

  it('recording-stopped endReason → no effect (not element-removed)', () => {
    const result = makeResult({ endReason: 'recording-stopped' });
    expect(checkVisibilityChange(result, ctx, cleanQuality)).toHaveLength(0);
  });

  it('+ noise → LOW', () => {
    const result = makeResult({ endReason: 'element-removed' });
    const effects = checkVisibilityChange(result, ctx, noisyQuality);
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].confidenceBasis).toBe('noise-degraded');
  });

  it('element-removed + early close → LOW (element-removed is not completed)', () => {
    // element-removed is treated as isEarlyClose=true since endReason !== 'completed'
    const result = makeResult({ endReason: 'element-removed' });
    const effects = checkVisibilityChange(result, ctx, { isNoisy: false, isEarlyClose: true });
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].confidenceBasis).toBe('early-close');
  });
});

// ────────────────────────────────────────────────────────────────────────
// makeNoObservableEffect
// ────────────────────────────────────────────────────────────────────────
describe('makeNoObservableEffect', () => {
  const ctx = makeContext();

  it('completed window → HIGH', () => {
    const result = makeResult({ endReason: 'completed' });
    const effect = makeNoObservableEffect(
      result,
      ctx,
      { isNoisy: false, isEarlyClose: false },
    );
    expect(effect.confidence).toBe('high');
    expect(effect.confidenceBasis).toBe('direct-property');
  });

  it('early close → LOW', () => {
    const result = makeResult({ endReason: 'recording-stopped' });
    const effect = makeNoObservableEffect(
      result,
      ctx,
      { isNoisy: false, isEarlyClose: true },
    );
    expect(effect.confidence).toBe('low');
    expect(effect.confidenceBasis).toBe('incomplete-observation');
  });

  it('noisy but completed → HIGH (noise irrelevant for absence)', () => {
    const result = makeResult({ endReason: 'completed' });
    const effect = makeNoObservableEffect(
      result,
      ctx,
      { isNoisy: true, isEarlyClose: false },
    );
    expect(effect.confidence).toBe('high');
  });

  it('description format — completed', () => {
    const result = makeResult({ endReason: 'completed' });
    const effect = makeNoObservableEffect(
      result,
      ctx,
      { isNoisy: false, isEarlyClose: false },
    );
    expect(effect.description).toBe('no observable DOM changes detected');
    expect(effect.description).not.toContain('ended early');
  });
});

// ────────────────────────────────────────────────────────────────────────
// makeUnclassified
// ────────────────────────────────────────────────────────────────────────
describe('makeUnclassified', () => {
  const ctx = makeContext();

  it('class-only mutations', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'class',
          oldValue: 'icon',
          newValue: 'icon active',
        }),
      ],
    });
    const effect = makeUnclassified(result, ctx);
    expect(effect.category).toBe('unclassified');
    expect(effect.confidence).toBe('low');
    expect(effect.confidenceBasis).toBe('no-match');
    expect(effect.description).toContain('class');
  });

  it('style-only mutations', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'style',
          oldValue: 'display:none',
          newValue: 'display:block',
        }),
      ],
    });
    const effect = makeUnclassified(result, ctx);
    expect(effect.category).toBe('unclassified');
    expect(effect.description).toContain('style');
  });

  it('mixed unmatched mutations', () => {
    const result = makeResult({
      mutations: [
        makeMutation({ type: 'attributes', attributeName: 'class', oldValue: 'a', newValue: 'b' }),
        makeMutation({ type: 'attributes', attributeName: 'style', oldValue: 'x', newValue: 'y' }),
        makeMutation({ type: 'attributes', attributeName: 'data-state', oldValue: '0', newValue: '1' }),
      ],
    });
    const effect = makeUnclassified(result, ctx);
    expect(effect.description).toContain('class');
    expect(effect.description).toContain('style');
    expect(effect.description).toContain('data-state');
  });
});

// ────────────────────────────────────────────────────────────────────────
// computeQuality
// ────────────────────────────────────────────────────────────────────────
describe('computeQuality', () => {
  it('clean completed window', () => {
    const result = makeResult({
      endReason: 'completed',
      performanceCondition: null,
    });
    const q = computeQuality(result);
    expect(q.isNoisy).toBe(false);
    expect(q.isEarlyClose).toBe(false);
  });

  it('noisy window', () => {
    const result = makeResult({
      performanceCondition: { batchRecordCount: 500, batchDurationMs: 50, timestamp: 2000 },
    });
    const q = computeQuality(result);
    expect(q.isNoisy).toBe(true);
  });

  it('early close', () => {
    const result = makeResult({ endReason: 'recording-stopped' });
    const q = computeQuality(result);
    expect(q.isEarlyClose).toBe(true);
  });

  it('element-removed counts as early close', () => {
    const result = makeResult({ endReason: 'element-removed' });
    const q = computeQuality(result);
    expect(q.isEarlyClose).toBe(true);
  });
});
