/**
 * T6 (red) — panel pair folding: hover→click on the same target = one card.
 * Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G5.
 *
 * One physical action (hover then click) currently surfaces a Hover card
 * AND a Click card. The completed hover (terminal consumed-by-click) whose
 * trigger identity matches the FOLLOWING click folds under the click card
 * (presentation only; structural keys only; no persistence change).
 */
import { describe, it, expect } from 'vitest';
// @vitest-environment jsdom
import { foldHoverClickPairs } from '../../src/sidepanel/hover-pair-fold';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

function id(over: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    tag: 'A', accessibleName: 'Book Flight', ariaRole: 'link',
    stableId: null,
    ...over,
  } as ElementIdentity;
}

function hover(over: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-h',
    type: 'Hover',
    endState: 'completed',
    trigger: id(),
    triggerEvent: { eventId: 'ev-h' },
    memberEvents: [],
    metadata: { terminal: 'consumed-by-click', targetName: 'Book Flight' },
    ...over,
  } as unknown as ComponentInteraction;
}

function click(over: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-c',
    type: 'Click',
    endState: 'completed',
    trigger: id(),
    triggerEvent: { eventId: 'ev-c' },
    memberEvents: [],
    metadata: { targetName: 'Book Flight' },
    ...over,
  } as unknown as ComponentInteraction;
}

describe('foldHoverClickPairs (G5 — presentation only)', () => {
  it('folds a consumed-by-click hover into the following same-identity click', () => {
    const out = foldHoverClickPairs([hover(), click()]);
    expect(out.pairs).toHaveLength(1);
    const pair = out.pairs[0];
    expect(pair.primary.interactionId).toBe('int-c');
    expect(pair.folded[0].interactionId).toBe('int-h');
    // Ordering: click card position (after the hover)
    expect(out.order).toEqual(['int-c']);
  });

  it('does NOT fold a hover with terminal left', () => {
    const h = hover({ metadata: { terminal: 'left', targetName: 'Book Flight' } });
    const out = foldHoverClickPairs([h, click()]);
    expect(out.pairs).toHaveLength(0);
    expect(out.order).toEqual(['int-h', 'int-c']);
  });

  it('does NOT fold when identities differ (different targets)', () => {
    const h = hover({ trigger: id({ accessibleName: 'Services', stableId: null }) });
    const out = foldHoverClickPairs([h, click()]);
    expect(out.pairs).toHaveLength(0);
  });

  it('does NOT fold a hover followed by a NON-click interaction', () => {
    const nav = click({ interactionId: 'int-n', type: 'Navigation', metadata: {} });
    const out = foldHoverClickPairs([hover(), nav]);
    expect(out.pairs).toHaveLength(0);
  });

  it('click with NO preceding hover is untouched', () => {
    const out = foldHoverClickPairs([click()]);
    expect(out.pairs).toHaveLength(0);
    expect(out.order).toEqual(['int-c']);
  });

  it('two independent hover/click pairs both fold', () => {
    const h1 = hover({ interactionId: 'int-h1', trigger: id({ accessibleName: 'A' }) });
    const c1 = click({ interactionId: 'int-c1', trigger: id({ accessibleName: 'A' }) });
    const h2 = hover({ interactionId: 'int-h2', trigger: id({ accessibleName: 'B' }) });
    const c2 = click({ interactionId: 'int-c2', trigger: id({ accessibleName: 'B' }) });
    const out = foldHoverClickPairs([h1, c1, h2, c2]);
    expect(out.pairs).toHaveLength(2);
    expect(out.order).toEqual(['int-c1', 'int-c2']);
  });

  it('hover between unrelated clicks folds to the correct one (identity match)', () => {
    const h = hover({ trigger: id({ accessibleName: 'B' }) });
    const c1 = click({ interactionId: 'int-c1', trigger: id({ accessibleName: 'A' }) });
    const c2 = click({ interactionId: 'int-c2', trigger: id({ accessibleName: 'B' }) });
    const out = foldHoverClickPairs([h, c1, c2]);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0].primary.interactionId).toBe('int-c2');
  });

  it('stableId participates in the identity key', () => {
    const h = hover({ trigger: id({ stableId: 'x1', accessibleName: 'Book Flight' }) });
    const c = click({ trigger: id({ stableId: 'x2', accessibleName: 'Book Flight' }) });
    const out = foldHoverClickPairs([h, c]);
    expect(out.pairs).toHaveLength(0);
  });

  it('does not fold non-completed hovers', () => {
    const h = hover({ endState: 'abandoned' });
    const out = foldHoverClickPairs([h, click()]);
    expect(out.pairs).toHaveLength(0);
  });
});

// ── Round-2 pin: unmatched consumed hovers keep their recorded position ──
// (R-I6 spirit — STOP projection never reorders physical history.)
describe('foldHoverClickPairs — unmatched consumed hover position (R-I6)', () => {
  const mkHover = (id: string, name: string) => ({
    interactionId: id,
    type: 'Hover',
    endState: 'completed',
    trigger: { tag: 'DIV', stableId: name, accessibleName: name },
    memberEvents: [],
    metadata: { terminal: 'consumed-by-click' },
  }) as never;

  it('unmatched consumed hover stays BETWEEN its neighbors, not moved to the end', async () => {
    const { foldHoverClickPairs } = await import('../../src/sidepanel/hover-pair-fold');
    const hoverA = mkHover('h-a', 'A');       // consumed, never matched
    const clickB = { interactionId: 'c-b', type: 'Click', endState: 'completed',
      trigger: { tag: 'BUTTON', stableId: 'B', accessibleName: 'B' }, memberEvents: [], metadata: {} } as never;
    const clickC = { interactionId: 'c-c', type: 'Link', endState: 'completed',
      trigger: { tag: 'A', stableId: 'C', accessibleName: 'C' }, memberEvents: [], metadata: {} } as never;

    const fold = foldHoverClickPairs([hoverA, clickB, clickC] as never);
    expect(fold.order).toEqual(['h-a', 'c-b', 'c-c']); // recorded order preserved
    expect(fold.pairs).toEqual([]);                    // no identity match → no fold
  });

  it('matched consumed hover is removed from the slot and folds under its click', async () => {
    const { foldHoverClickPairs } = await import('../../src/sidepanel/hover-pair-fold');
    const hover = mkHover('h-1', 'Same');   // tag DIV, stableId Same
    const click = { interactionId: 'c-1', type: 'Click', endState: 'completed',
      // SAME structural identity (tag+stableId+accessibleName) as the hover.
      trigger: { tag: 'DIV', stableId: 'Same', accessibleName: 'Same' }, memberEvents: [], metadata: {} } as never;

    const fold = foldHoverClickPairs([hover, click] as never);
    expect(fold.order).toEqual(['c-1']);
    expect(fold.pairs.length).toBe(1);
    expect(fold.pairs[0].folded[0].interactionId).toBe('h-1');
  });
});
