/**
 * B7-P3 §5.3.4 — V3 pinned defect candidate: leave → enter-next
 * settle-supersession attribution (documented, NOT fixed — DC-4).
 *
 * MECHANISM (observed, not heuristic): when the pointer leaves hover A
 * (reveal recorded in A's window) and enters target B, hover A's window
 * closes through adaptive settle. If the revealed surface collapses
 * AFTER that close, the removal mutation is recorded by whichever
 * window is open — B's. Surface facts are window-relative diffs, so
 * B's evidence then honestly reports `removedSurfaces: [flyout]`, and
 * the deterministic downstream chain follows: deriveConsequenceClasses
 * (output-adapter) → ['removal'] → admission (completed ∧ classes>0)
 * → B anchors its own episode carrying the removal class.
 *
 * The system CANNOT, from recorded evidence alone, distinguish
 * "hovering B removed the flyout" from "A's reveal collapsed while B
 * was open" — pointer-removal facts have no causality of their own
 * (the pointer is not an actor). Any "fix" would need a timing or
 * adjacency heuristic (e.g. "removals within N ms of a leave belong to
 * the leaver") — exactly the class of rule this doctrine forbids.
 * Phase-2 child-identity snapshots (N6) may one day join the removal
 * to A's reveal fact; until then this is the honest, named floor.
 *
 * This test PINS the current behavior so the defect candidate cannot
 * silently change. It references limitation V3 (spec §7).
 */

import { describe, expect, it } from 'vitest';
import { buildEpisodes, type EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';
import { deriveCausalGraph } from '../../../src/understanding/behavior-model/causal-graph';
import { deriveConsequenceClasses } from '../../../src/presentation/output-adapter';

let seq = 0;
const T = 1_000_000;

function evt(eventType: string, timestamp: number) {
  seq += 1;
  return { eventId: `evt-v3-${seq}`, eventType, timestamp, captureSeq: seq };
}

/** Hover B whose open window recorded the collapse of A's flyout. */
function hoverWithRemovalFact(id: string, t0: number, removedPath: string): EpisodeBuilderInteraction {
  const triggerEvent = evt('mouseenter', t0);
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Cart' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 900,
    endState: 'completed',
    metadata: { targetName: 'Cart', terminal: 'left', consequenceClasses: ['removal'], meaningful: true },
    behavioralEvidence: {
      sourceEventId: triggerEvent.eventId,
      windowId: 'ev-b',
      applicationEvidence: {
        domChanges: [
          {
            types: ['childList'], targetPath: removedPath, targetTag: 'DIV',
            shadowContext: null, changedAttributes: [], attributeDeltas: {},
            addedNodesCount: 0, removedNodesCount: 3, characterDataDelta: null,
            firstMutationAt: 400, lastMutationAt: 400, rawMutationCount: 1,
            firstBatchIndex: 1, lastBatchIndex: 1,
          },
        ],
        domChangeOverflow: 0,
        newSurfaces: [],
        removedSurfaces: [{ path: removedPath, tagName: 'DIV', ariaRole: 'region', accessibleName: 'Products flyout', shadowContext: null, descendantCount: 6, relativeTime: 400, batchIndex: 1, kind: 'removed', emergence: 'removed' }],
        visibilityChanges: [],
        navigation: [],
        networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;
}

/** Hover A: completed, revealed the flyout, window closed at settle. */
function revealHover(id: string, t0: number): EpisodeBuilderInteraction {
  const triggerEvent = evt('mouseenter', t0);
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Products' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 800,
    endState: 'completed',
    metadata: { targetName: 'Products', terminal: 'left', consequenceClasses: ['reveal', 'insertion'], meaningful: true },
  } as unknown as EpisodeBuilderInteraction;
}

describe('B7-P3 V3 pin: sequential-hover revert settles into the successor window', () => {
  it('DERIVED CLASSES: the successor hover honestly derives [removal] from its own recorded facts (the collapse landed there)', () => {
    // The adapter derives ONLY from B's recorded evidence — it cannot
    // know the removed surface belonged to A's reveal.
    const b = hoverWithRemovalFact('int-b', T + 1000, 'body > div > div#mega-products');
    const classes = deriveConsequenceClasses(b as never);
    expect(classes).toContain('removal');
  });

  it('ANCHORING: the successor hover therefore ANCHORS an episode carrying the removal class (pinned misattribution, V3)', () => {
    const a = revealHover('int-a', T);
    const b = hoverWithRemovalFact('int-b', T + 1000, 'body > div > div#mega-products');
    const built = buildEpisodes({ interactions: [a, b] });

    // BOTH anchor — A for its real reveal, B for the settle-superseded
    // collapse. This is the documented defect candidate: B's episode
    // claims a consequence the pointer did not cause.
    expect(built.episodes.map((ep) => ep.anchor.interactionId).sort()).toEqual(['int-a', 'int-b']);
    const bEpisode = built.episodes.find((ep) => ep.anchor.interactionId === 'int-b');
    expect(bEpisode).toBeDefined();
    // V3 is a documented LIMITATION: asserting today's observable
    // downstream symptom so it cannot silently regress or "improve".
    expect(bEpisode?.anchor.actionType).toBe('Hover');
  });

  it('PROVENANCE BOUND: the supersession does NOT fabricate a surface-reuse link — B is a hover, and only CLICK episodes consume', () => {
    const a = revealHover('int-a', T);
    const b = hoverWithRemovalFact('int-b', T + 1000, 'body > div > div#mega-products');
    const built = buildEpisodes({ interactions: [a, b] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [a, b], evidenceWindows: [] });
    expect(graph.provenanceLinks).toHaveLength(0);
  });
});
