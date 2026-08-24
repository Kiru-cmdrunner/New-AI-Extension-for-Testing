/**
 * 6F-M3 Wave 1 — O2 no-op DOM-change row suppression
 *
 * Spec: .drytis/specs/phase-6f-m3-w1-display-honesty.md §2 (AC1–AC6)
 *
 * Rows that materialized nothing (attr-only, every old==new, no nodes, no
 * characterData) are pure display noise (1 of 5 rows in the committed
 * 6E-M2 dump). They are filtered from the summary display with an honest
 * hidden-count in the header; raw evidence objects are untouched.
 */
import { describe, it, expect } from 'vitest';
import type { DomChangeSummary } from '../../../src/shared/behavioral-evidence-types';
import {
  isNoOpDomChange,
  renderDomChangesForTest,
} from '../../../src/sidepanel/evidence-renderer';

function change(partial: Partial<DomChangeSummary>): DomChangeSummary {
  return {
    types: ['attributes'],
    targetPath: 'div>a',
    targetTag: 'a',
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: null,
    firstMutationAt: 1,
    lastMutationAt: 2,
    rawMutationCount: 1,
    firstBatchIndex: 0,
    lastBatchIndex: 0,
    ...partial,
  } as DomChangeSummary;
}

describe('6F-M3 O2 — isNoOpDomChange truth table (AC5)', () => {
  it('attrs-only, all old==new, no nodes, no characterData → true', () => {
    expect(
      isNoOpDomChange(
        change({
          changedAttributes: ['class'],
          attributeDeltas: { class: { old: 'x', new: 'x' } },
        }),
      ),
    ).toBe(true);
  });

  it('attrs with old≠new → false (material)', () => {
    expect(
      isNoOpDomChange(
        change({
          changedAttributes: ['class'],
          attributeDeltas: { class: { old: 'x', new: 'y' } },
        }),
      ),
    ).toBe(false);
  });

  it('added or removed nodes > 0 → false', () => {
    expect(isNoOpDomChange(change({ addedNodesCount: 1 }))).toBe(false);
    expect(isNoOpDomChange(change({ removedNodesCount: 2 }))).toBe(false);
  });

  it('characterDataDelta present → false', () => {
    expect(
      isNoOpDomChange(change({ characterDataDelta: { old: 'a', new: 'b' } })),
    ).toBe(false);
  });

  it('changed attribute with MISSING delta → false (unknown is information)', () => {
    expect(
      isNoOpDomChange(
        change({
          changedAttributes: ['aria-expanded'],
          attributeDeltas: {},
        }),
      ),
    ).toBe(false);
  });

  it('empty change (no attrs, no nodes, no text) → true (nothing materialized)', () => {
    expect(isNoOpDomChange(change({ types: ['attributes'] }))).toBe(true);
  });
});

function headerOf(el: HTMLElement | null): string {
  return el?.querySelector('.evidence-subheader')?.textContent ?? '';
}

function textOf(el: HTMLElement | null): string {
  return el?.textContent ?? '';
}

describe('6F-M3 O2 — renderDomChanges suppression (AC1–AC4)', () => {
  it('AC1: no-op row suppressed; header reports the hidden count; raw count kept', () => {
    const noop = change({
      changedAttributes: ['class'],
      attributeDeltas: { class: { old: 'x', new: 'x' } },
    });
    const material = change({
      types: ['childList'],
      addedNodesCount: 3,
    });
    const el = renderDomChangesForTest([noop, material], 0, false);
    expect(el).not.toBeNull();
    const rows = el!.querySelectorAll('.evidence-row:not(.evidence-row--muted)');
    expect(rows.length).toBe(1);
    expect(headerOf(el)).toContain('DOM Changes (2');
    expect(headerOf(el)).toContain('1 no-op hidden');
    expect(textOf(el)).not.toContain('class: "x" → "x"');
  });

  it('AC2: material rows all render (no over-filtering)', () => {
    const material = [
      change({ changedAttributes: ['class'], attributeDeltas: { class: { old: 'x', new: 'y' } } }),
      change({ addedNodesCount: 1 }),
      change({ characterDataDelta: { old: 'a', new: 'b' } }),
      change({ changedAttributes: ['aria-expanded'], attributeDeltas: {} }),
    ];
    const el = renderDomChangesForTest(material, 0, false);
    expect(el).not.toBeNull();
    const rows = el!.querySelectorAll('.evidence-row:not(.evidence-row--muted)');
    expect(rows.length).toBe(4);
    expect(headerOf(el)).not.toContain('no-op hidden');
  });

  it('AC3: suppressed rows never consume display slots before the cap', () => {
    // 8 material + 3 no-op; MAX_DOM_CHANGES_DISPLAY = 10 → all 8 material
    // rows must be visible and no "… more" overflow row for dropped slots.
    const material = Array.from({ length: 8 }, (_, i) =>
      change({ addedNodesCount: i + 1, targetPath: `div>a${i}` }),
    );
    const noop = Array.from({ length: 3 }, (_, i) =>
      change({
        changedAttributes: ['class'],
        attributeDeltas: { class: { old: 'x', new: 'x' } },
        targetPath: `div>n${i}`,
      }),
    );
    const el = renderDomChangesForTest([...material, ...noop], 0, false);
    expect(el).not.toBeNull();
    const rows = el!.querySelectorAll('.evidence-row:not(.evidence-row--muted)');
    expect(rows.length).toBe(8);
    expect(headerOf(el)).toContain('3 no-op hidden');
    expect(textOf(el)).not.toContain('more dropped');
    expect(textOf(el)).not.toMatch(/… \d+ more/);
  });

  it('AC4: zero no-op rows → header identical to pre-change form', () => {
    const material = change({ addedNodesCount: 1 });
    const el = renderDomChangesForTest([material], 0, false);
    expect(headerOf(el)).toBe('DOM Changes (1)');
  });
});
