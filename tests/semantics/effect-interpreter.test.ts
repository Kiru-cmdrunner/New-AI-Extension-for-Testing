/**
 * Integration tests for the Effect Interpreter (full interpret() pipeline).
 *
 * Tests exercise the complete rule execution flow including fallback logic,
 * multi-rule interaction, and the agreed 'unclassified' semantics
 * (fires ONLY when effects.length === 0).
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { interpret } from '../../src/semantics/effect-interpreter';
import {
  makeResult,
  makeSnapshot,
  makeMutation,
  makeContext,
  resetMutIds,
} from './fixtures';

beforeEach(() => resetMutIds());

// ────────────────────────────────────────────────────────────────────────
// Real-world scenarios
// ────────────────────────────────────────────────────────────────────────

describe('interpret — real-world scenarios', () => {
  const ctx = makeContext();

  it('Amazon checkbox: ariaChecked + class mutation → state-toggle only (no unclassified)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'class',
          targetPath: 'body > div.row > i',
          oldValue: 'icon',
          newValue: 'icon active',
        }),
      ],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('state-toggle');
    expect(effects[0].confidence).toBe('high');
    // Class mutation does NOT get its own unclassified effect
    expect(effects.find((e) => e.category === 'unclassified')).toBeUndefined();
  });

  it('Accordion: ariaExpanded + style mutation → expand-collapse only', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaExpanded: true }),
      finalSnapshot: makeSnapshot({ ariaExpanded: false }),
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'style',
          targetPath: 'body > div.content',
          oldValue: 'display: block',
          newValue: 'display: none',
        }),
      ],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('expand-collapse');
    expect(effects[0].confidence).toBe('high');
  });

  it('Filter results: childList on two paths → two content-change effects', () => {
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
          removedNodesCount: 1,
        }),
      ],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(2);
    expect(effects.every((e) => e.category === 'content-change')).toBe(true);
    expect(effects[0].affectedTarget.cssPath).not.toBe(effects[1].affectedTarget.cssPath);
  });

  it('Static click (completed, nothing happened) → no-observable-effect HIGH', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 3 }),
      finalSnapshot: makeSnapshot({ childCount: 3 }),
      endReason: 'completed',
      mutations: [],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('no-observable-effect');
    expect(effects[0].confidence).toBe('high');
  });

  it('Static click (early close, nothing happened) → no-observable-effect LOW', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 3 }),
      finalSnapshot: makeSnapshot({ childCount: 3 }),
      endReason: 'recording-stopped',
      mutations: [],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('no-observable-effect');
    expect(effects[0].confidence).toBe('low');
    expect(effects[0].confidenceBasis).toBe('incomplete-observation');
  });

  it('Class-only change → unclassified LOW', () => {
    const result = makeResult({
      mutations: [
        makeMutation({
          type: 'attributes',
          attributeName: 'class',
          oldValue: 'a',
          newValue: 'b',
        }),
      ],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('unclassified');
    expect(effects[0].confidence).toBe('low');
  });

  it('beforeSnapshot null + aria-checked mutation → state-toggle HIGH', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: null,
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
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('state-toggle');
    expect(effects[0].confidence).toBe('high');
  });

  it('Toggle + content change together → both emitted (no suppression)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#dropdown-list',
          addedNodesCount: 1,
        }),
      ],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(2);
    const toggle = effects.find((e) => e.category === 'state-toggle');
    const content = effects.find((e) => e.category === 'content-change');
    expect(toggle).toBeDefined();
    expect(toggle!.confidence).toBe('high');
    expect(content).toBeDefined();
    expect(content!.confidence).toBe('medium');
  });

  it('Noisy window + direct evidence → direct stays HIGH (noise-immune)', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: makeSnapshot({ ariaChecked: true }),
      performanceCondition: { batchRecordCount: 500, batchDurationMs: 50, timestamp: 2000 },
    });
    const effects = interpret(result, ctx);
    const toggle = effects.find((e) => e.category === 'state-toggle');
    expect(toggle).toBeDefined();
    expect(toggle!.confidence).toBe('high');
  });

  it('React rerender (many paths) → one aggregated content-change LOW', () => {
    const paths = ['#a', '#b', '#c', '#d', '#e', '#f', '#g', '#h'];
    const result = makeResult({
      mutations: paths.map((p) =>
        makeMutation({ type: 'childList', targetPath: p, addedNodesCount: 1 }),
      ),
    });
    const effects = interpret(result, ctx);
    const content = effects.filter((e) => e.category === 'content-change');
    expect(content).toHaveLength(1);
    expect(content[0].confidence).toBe('low');
    expect(content[0].description).toContain('broad structural change');
  });

  it('Element removed (endReason) → visibility-change', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ childCount: 0 }),
      finalSnapshot: null,
      endReason: 'element-removed',
      mutations: [],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('visibility-change');
  });

  it('Toggle + element removed → state-toggle + visibility-change', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ ariaChecked: false }),
      finalSnapshot: null,
      endReason: 'element-removed',
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
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(2);
    const toggle = effects.find((e) => e.category === 'state-toggle');
    const visibility = effects.find((e) => e.category === 'visibility-change');
    expect(toggle).toBeDefined();
    expect(toggle!.confidence).toBe('high');
    expect(visibility).toBeDefined();
  });

  it('Empty result (all null snapshots, no mutations, completed) → no-observable-effect HIGH', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: null,
      mutations: [],
      endReason: 'completed',
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].category).toBe('no-observable-effect');
    expect(effects[0].confidence).toBe('high');
  });

  it('Enable + content change → enable-disable + content-change', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ disabled: true }),
      finalSnapshot: makeSnapshot({ disabled: false }),
      mutations: [
        makeMutation({
          type: 'childList',
          targetPath: '#form',
          addedNodesCount: 1,
        }),
      ],
    });
    const effects = interpret(result, ctx);
    expect(effects).toHaveLength(2);
    expect(effects.find((e) => e.category === 'enable-disable')).toBeDefined();
    expect(effects.find((e) => e.category === 'content-change')).toBeDefined();
  });
});
