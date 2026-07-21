/**
 * Tests for Surface Deriver
 *
 * Verifies that deriveSurfaces groups elements by sourceUrl and maps
 * components to their surfaces.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §6
 */

import { describe, it, expect } from 'vitest';
import { deriveSurfaces } from '../src/recorder/enrichment/surface-deriver';
import type { UiElement } from '../src/domain/entities/ui-element';
import type { ElementIdentity } from '../src/shared/types';

// ── Fixtures ─────────────────────────────────────────────

function makeIdentity(name: string): ElementIdentity {
  return {
    cssPath: 'div', xpath: '//div', ariaRole: null, ariaLevel: null,
    accessibleName: name, tag: 'div', type: null, testId: null,
    text: null, childText: null, href: null, title: null, label: null,
    classes: [], attributes: {}, domPosition: 1, rect: null,
  } as unknown as ElementIdentity;
}

function makeElement(
  elementId: string,
  sourceUrl: string,
  componentId: string | null = null,
): UiElement {
  return {
    elementId,
    identity: makeIdentity(elementId),
    domAttributes: {},
    sourceUrl,
    domTreePath: 'html>body',
    intrinsicCapabilities: [],
    componentId,
    componentRole: null,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('deriveSurfaces', () => {
  it('groups elements by sourceUrl', () => {
    const elements = [
      makeElement('e1', 'https://app.com/home'),
      makeElement('e2', 'https://app.com/home'),
      makeElement('e3', 'https://app.com/search'),
    ];

    const surfaces = deriveSurfaces(elements);

    expect(surfaces).toHaveLength(2);
    const homeSurface = surfaces.find((s) => s.url === 'https://app.com/home')!;
    expect(homeSurface.elementIds).toEqual(['e1', 'e2']);
    const searchSurface = surfaces.find((s) => s.url === 'https://app.com/search')!;
    expect(searchSurface.elementIds).toEqual(['e3']);
  });

  it('sorts surfaces by URL for stable ordering', () => {
    const elements = [
      makeElement('e1', 'https://app.com/zebra'),
      makeElement('e2', 'https://app.com/alpha'),
      makeElement('e3', 'https://app.com/mango'),
    ];

    const surfaces = deriveSurfaces(elements);
    expect(surfaces.map((s) => s.url)).toEqual([
      'https://app.com/alpha',
      'https://app.com/mango',
      'https://app.com/zebra',
    ]);
  });

  it('maps components via element componentId', () => {
    const elements = [
      makeElement('e1', 'https://app.com/home', 'comp-1'),
      makeElement('e2', 'https://app.com/home'),
      makeElement('e3', 'https://app.com/search', 'comp-2'),
    ];

    const surfaces = deriveSurfaces(elements);
    const homeSurface = surfaces.find((s) => s.url === 'https://app.com/home')!;
    expect(homeSurface.componentIds).toContain('comp-1');
    expect(homeSurface.componentIds).not.toContain('comp-2');
  });

  it('maps components via root element sourceUrl', () => {
    const elements = [
      makeElement('e1', 'https://app.com/home'), // root element of comp-1
      makeElement('e2', 'https://app.com/home'),
    ];

    const surfaces = deriveSurfaces(elements, [
      { groupingId: 'comp-1', rootElementId: 'e1' },
    ]);

    const homeSurface = surfaces.find((s) => s.url === 'https://app.com/home')!;
    expect(homeSurface.componentIds).toContain('comp-1');
  });

  it('returns empty array for no elements', () => {
    const surfaces = deriveSurfaces([]);
    expect(surfaces).toEqual([]);
  });

  it('handles elements from same URL with no components', () => {
    const elements = [
      makeElement('e1', 'https://app.com/page'),
      makeElement('e2', 'https://app.com/page'),
      makeElement('e3', 'https://app.com/page'),
    ];

    const surfaces = deriveSurfaces(elements);
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].elementIds).toHaveLength(3);
    expect(surfaces[0].componentIds).toEqual([]);
  });

  it('handles multiple components on same surface', () => {
    const elements = [
      makeElement('e1', 'https://app.com/form', 'comp-1'),
      makeElement('e2', 'https://app.com/form', 'comp-2'),
    ];

    const surfaces = deriveSurfaces(elements);
    const formSurface = surfaces.find((s) => s.url === 'https://app.com/form')!;
    expect(formSurface.componentIds).toHaveLength(2);
    expect(formSurface.componentIds).toContain('comp-1');
    expect(formSurface.componentIds).toContain('comp-2');
  });
});
