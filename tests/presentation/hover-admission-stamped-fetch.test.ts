/**
 * T5 (red) — Hover admission: stamped-fetch no longer admits.
 * Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G4.
 *
 * Telemetry is not a user-visible consequence: on instrumented pages
 * (analytics beacons on every gesture) stamped-fetch admitted EVERY hover.
 * The class remains recorded evidence; it stops ADMITTING hovers.
 */
import { describe, it, expect } from 'vitest';
import { deriveConsequenceClasses } from '../../src/presentation/output-adapter';
import type { ComponentInteraction } from '../../src/shared/component-types';

function hover(over: {
  networkActivity?: { sourceEventId: string | null; url: string }[];
  domChanges?: { addedNodesCount: number; removedNodesCount: number }[];
}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'Hover',
    endState: 'completed',
    triggerEvent: { eventId: 'ev-1', eventType: 'mouseenter' },
    memberEvents: [],
    behavioralEvidence: {
      window: {
        windowId: 'w-1', openedAt: 1, closedAt: 2, durationMs: 1,
        endReason: 'consequence-settled', sourceEventId: 'ev-1',
      },
      applicationEvidence: {
        newSurfaces: [],
        domChanges: over.domChanges ?? [],
        visibilityChanges: [],
        networkActivity: over.networkActivity ?? [],
        navigation: [],
      },
    },
    metadata: {},
  } as unknown as ComponentInteraction;
}

describe('Hover admission classes (RC-4/G4)', () => {
  it('stamped-fetch ALONE does not admit a hover (telemetry is not consequence)', () => {
    const h = hover({ networkActivity: [
      { sourceEventId: 'ev-1', url: 'https://j.clarity.ms/collect' },
      { sourceEventId: 'ev-1', url: 'https://analytics.google.com/g/collect' },
    ]});
    const classes = deriveConsequenceClasses(h);
    expect(classes).toEqual([]);
  });

  it('stamped-fetch is not even a derived class for hovers anymore', () => {
    const h = hover({ networkActivity: [
      { sourceEventId: 'ev-1', url: 'https://j.clarity.ms/collect' },
    ]});
    expect(deriveConsequenceClasses(h)).not.toContain('stamped-fetch');
  });

  it('reveal still admits', () => {
    const h = hover({ domChanges: [{ addedNodesCount: 0, removedNodesCount: 0 }] });
    (h.behavioralEvidence!.applicationEvidence!.domChanges as never as { attributeDeltas: Record<string, { old: string | null; new: string | null }> }[])[0] = {
      attributeDeltas: { 'aria-expanded': { old: 'false', new: 'true' } },
    };
    expect(deriveConsequenceClasses(h)).toContain('reveal');
  });

  it('insertion still admits', () => {
    const h = hover({ domChanges: [{ addedNodesCount: 1, removedNodesCount: 0 }] });
    expect(deriveConsequenceClasses(h)).toContain('insertion');
  });

  it('mixed: insertion + telemetry fetch yields insertion only', () => {
    const h = hover({
      domChanges: [{ addedNodesCount: 2, removedNodesCount: 0 }],
      networkActivity: [{ sourceEventId: 'ev-1', url: 'https://x.telemetry/collect' }],
    });
    expect(deriveConsequenceClasses(h)).toEqual(['insertion']);
  });
});
