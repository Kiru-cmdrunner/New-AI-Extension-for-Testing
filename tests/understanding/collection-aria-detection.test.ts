/**
 * D8 — Collection Detection for ARIA / Custom Grids Tests
 *
 * Verifies that collection detection works via:
 * - ARIA grid attributes (aria-rowcount, aria-colcount, aria-setsize)
 * - Custom grid containers (div.data-grid, div.results-container)
 * - Full list refreshes (net-zero childList changes)
 *
 * Architecture: .drytis/specs/deterministic-defects.md §D8
 */

import { describe, it, expect } from 'vitest';
import { ListSignalExtractor } from '../../src/understanding/signal-extractors/list-signals';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function makeInteractionWithDomChanges(
  types: ('attributes' | 'childList' | 'characterData')[],
  opts: {
    targetPath?: string;
    targetTag?: string;
    addedNodesCount?: number;
    removedNodesCount?: number;
    changedAttributes?: string[];
    attributeDeltas?: Record<string, { old: string | null; new: string | null }>;
  },
): ComponentInteraction {
  const id = `int-${Math.random()}`;
  const now = Date.now();
  const evidence = {
    sourceEventId: `evt-${id}`,
    sourceEventType: 'click',
    windowId: `bev-${id}`,
    frameId: 'main',
    window: { openedAt: now, closedAt: now + 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
    targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, changed: false, changeSummary: [] },
    applicationEvidence: {
      domChanges: [{
        types,
        targetPath: opts.targetPath ?? '/html/body/div',
        targetTag: opts.targetTag ?? 'DIV',
        shadowContext: null,
        changedAttributes: opts.changedAttributes ?? [],
        attributeDeltas: opts.attributeDeltas ?? {},
        addedNodesCount: opts.addedNodesCount ?? 0,
        removedNodesCount: opts.removedNodesCount ?? 0,
        characterDataDelta: null,
        firstMutationAt: 0,
        lastMutationAt: 10,
        rawMutationCount: 1,
        globalBatchIndex: 0,
      }],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;

  return {
    interactionId: id,
    type: 'click',
    trigger: {
      elementId: `elem-${id}`,
      accessibleName: 'Button',
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      domContext: { eventType: 'click', cssSelector: `#${id}`, xPath: '/html/body/button', url: 'https://example.com/' },
    },
    memberEvents: [],
    inScopeElements: new Set(),
    componentDefinition: 'Button',
    completionReason: 'event-matched',
    startTime: now,
    endTime: now + 100,
    behavioralEvidence: evidence,
  } as unknown as ComponentInteraction;
}

describe('D8 — Collection Detection for ARIA / Custom Grids', () => {
  const extractor = new ListSignalExtractor();

  it('detects collection via aria-rowcount attribute change', () => {
    const interaction = makeInteractionWithDomChanges(
      ['attributes'],
      {
        changedAttributes: ['aria-rowcount'],
        attributeDeltas: { 'aria-rowcount': { old: '10', new: '25' } },
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).netChange).toBe(15);
    expect((signals[0] as any).addedCount).toBe(15);
  });

  it('detects collection via aria-setsize attribute change', () => {
    const interaction = makeInteractionWithDomChanges(
      ['attributes'],
      {
        changedAttributes: ['aria-setsize'],
        attributeDeltas: { 'aria-setsize': { old: '50', new: '30' } },
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).netChange).toBe(-20);
    expect((signals[0] as any).removedCount).toBe(20);
  });

  it('detects custom grid via class-based path (div.data-grid)', () => {
    const interaction = makeInteractionWithDomChanges(
      ['childList'],
      {
        targetPath: '/html/body/div.data-grid',
        targetTag: 'DIV',
        addedNodesCount: 5,
        removedNodesCount: 0,
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).addedCount).toBe(5);
  });

  it('detects custom grid via results-container path', () => {
    const interaction = makeInteractionWithDomChanges(
      ['childList'],
      {
        targetPath: '/html/body/div#results-container',
        targetTag: 'DIV',
        addedNodesCount: 3,
        removedNodesCount: 1,
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).netChange).toBe(2);
  });

  it('backward compat: UL childList still detected', () => {
    const interaction = makeInteractionWithDomChanges(
      ['childList'],
      {
        targetPath: '/html/body/ul',
        targetTag: 'UL',
        addedNodesCount: 2,
        removedNodesCount: 0,
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
  });

  it('backward compat: TBODY childList still detected', () => {
    const interaction = makeInteractionWithDomChanges(
      ['childList'],
      {
        targetPath: '/html/body/table/tbody',
        targetTag: 'TBODY',
        addedNodesCount: 1,
        removedNodesCount: 1,
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).netChange).toBe(0);
  });

  it('non-list DIV with no grid-like class is not detected', () => {
    const interaction = makeInteractionWithDomChanges(
      ['childList'],
      {
        targetPath: '/html/body/div#random',
        targetTag: 'DIV',
        addedNodesCount: 1,
        removedNodesCount: 0,
      },
    );
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(0);
  });
});
