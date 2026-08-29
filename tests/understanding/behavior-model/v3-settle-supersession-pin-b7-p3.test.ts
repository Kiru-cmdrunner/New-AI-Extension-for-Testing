/**
 * B7-P3 §5.3.4 — V3 PIN, not fix.
 *
 * Known defect candidate (spec §7 V3): under sequential hovers
 * (leave A → enter B), the predecessor's collapse window can be claimed
 * by the successor's episode via the T4 latest-anchor-wins rule — the
 * successor's window opens BEFORE the predecessor's uiOwnership horizon
 * closes, and the collapse facts belong to A but the horizon math
 * awards them to B.
 *
 * This suite ASSERTS the current behavior and names V3 in every test
 * title. It is documentation-by-test (DC-4: no guessing — unattributed
 * stays unattributed; sequential-hover misattribution stays pinned).
 * If T4 ownership ever changes, these tests must be UPDATED DELIBERATELY
 * in the same change that fixes V3 — never deleted silently.
 */

import { describe, expect, it } from 'vitest';
import { deriveCausalGraph } from '../../../src/understanding/behavior-model/causal-graph';
import { buildEpisodes, type EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';
import type { GraphInteractionEvidence } from '../../../src/understanding/behavior-model/causal-graph';

const T = 2_000_000;
let seq = 0;

function evt(opts: { eventType: string; timestamp: number }) {
  seq += 1;
  return { eventId: `evt-v3-${seq}`, eventType: opts.eventType, timestamp: opts.timestamp, captureSeq: seq };
}

function admittedHover(
  id: string,
  t0: number,
  windowId: string,
  domTargetPath: string,
): { interaction: EpisodeBuilderInteraction; evidence: GraphInteractionEvidence } {
  const triggerEvent = evt({ eventType: 'mouseenter', timestamp: t0 });
  const interaction = {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'DIV', accessibleName: id, cssSelector: `#${id}`, xPath: `//div[@id='${id}']`, stableId: id },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 1000,
    endState: 'completed',
    metadata: { targetName: id, terminal: 'left', consequenceClasses: ['reveal'], meaningful: true },
    behavioralEvidence: {
      sourceEventId: triggerEvent.eventId,
      windowId,
      window: { openedAt: 0, closedAt: 1000, durationMs: 1000, endReason: 'consequence-settled' },
      applicationEvidence: {
        domChanges: [{
          types: ['attributes'] as never, targetPath: domTargetPath, targetTag: 'DIV',
          shadowContext: null, changedAttributes: ['aria-expanded'],
          attributeDeltas: { 'aria-expanded': { old: 'true', new: 'false' } },
          addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
          firstMutationAt: 60, lastMutationAt: 60, rawMutationCount: 1,
          firstBatchIndex: 1, lastBatchIndex: 1,
        }],
        domChangeOverflow: 0, newSurfaces: [], removedSurfaces: [], visibilityChanges: [], navigation: [], networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;

  const evidence: GraphInteractionEvidence = {
    interactionId: id,
    evidence: {
      windowId, sourceEventId: triggerEvent.eventId, openedAt: 0,
      domChangeCount: 1, domChangeOverflow: 0, newSurfaces: [], removedSurfaces: [],
      visibilityChanges: 0, navigation: [], synthesized: false, endReason: 'consequence-settled',
    },
    windowOpenedEpochMs: t0, windowClosedEpochMs: t0 + 1000,
  };
  return { interaction, evidence };
}

describe('B7-P3 V3 PIN: sequential-hover revert misattribution under settle-supersession', () => {
  it('V3 — when B\'s enter is A\'s next anchor, A\'s horizon closes at B; any window opening after B goes to B — baseline mechanics pinned', () => {
    // Hover A at T; hover B at T+400. A's uiOwnership closes at T+400
    // ('next-anchor'). A's window [T, T+1000] opens inside A's horizon,
    // but B's uiOwnership [T+400, ...] also overlaps the window's tail,
    // so B is a candidate too — and latest-anchor-wins awards BOTH
    // windows to B. A therefore ends with ZERO T4 edges even though its
    // own window opened inside its own horizon. This test pins the
    // ACTUAL resolution (the known V3 defect candidate).
    const a = admittedHover('int-a', T, 'ev-a', 'body > div > div#menu-a');
    const b = admittedHover('int-b', T + 400, 'ev-b', 'body > div > div#menu-b');

    const built = buildEpisodes({ interactions: [a.interaction, b.interaction] });
    const graph = deriveCausalGraph({
      episodes: built.episodes,
      interactions: [a.interaction, b.interaction],
      evidenceWindows: [a.evidence, b.evidence],
    });

    // Both hovers anchor (admitted) — two episodes.
    expect(graph.episodes.length).toBe(2);
    // A's horizon closes at B's enter (next-anchor) — the mechanism that
    // creates the V3 window: A's horizon is capped the instant B anchors.
    const aEp = graph.episodes.find((e) => e.id === 'ep-int-a')!;
    expect(aEp.horizon.uiOwnership.closeReason).toBe('next-anchor');
    expect(aEp.horizon.uiOwnership.closedAtMs).toBe(T + 400);

    // V3 BASELINE PIN: with latest-anchor-wins over overlapping horizons,
    // BOTH windows are claimed by B (verified by probe). A holds no T4
    // edge. This is the documented defect candidate — NOT fixed here.
    const aT4 = aEp.edges.filter((e) => e.tier === 'T4-window');
    const bT4 = graph.episodes.find((e) => e.id === 'ep-int-b')!.edges.filter((e) => e.tier === 'T4-window');
    expect(aT4.length).toBe(0);
    expect(bT4.length).toBe(2);
  });

  it('V3 — non-overlapping windows resolve to their own episodes (healthy baseline the defect degrades from)', () => {
    // Hover A at T with window [T, T+800]; hover B at T+2000 — no overlap
    // at all. Each window resolves to its own episode. The V3 defect only
    // appears in the interleaved shape above.
    const a = admittedHover('int-a2', T, 'ev-a2', 'body > div > div#menu-a');
    a.interaction.endTime = T + 800;
    a.evidence.windowClosedEpochMs = T + 800;
    const b = admittedHover('int-b2', T + 2000, 'ev-b2', 'body > div > menu-b');

    const built = buildEpisodes({ interactions: [a.interaction, b.interaction] });
    const graph = deriveCausalGraph({
      episodes: built.episodes,
      interactions: [a.interaction, b.interaction],
      evidenceWindows: [a.evidence, b.evidence],
    });
    expect(graph.episodes.length).toBe(2);
    for (const ep of graph.episodes) {
      expect(ep.edges.some((e) => e.tier === 'T4-window')).toBe(true);
    }
  });

  it('V3 — the defect shape: B\'s enter inside A\'s horizon makes B the latest anchor, and a window opening AFTER B\'s anchor goes to B even when its facts are A\'s collapse', () => {
    // This is the exact misattribution shape V3 names: A's window record
    // (ev-a3) opens AFTER B's anchor (settle-supersession re-stamps the
    // window on the superseding enter under the STOP flush). Latest-
    // anchor-wins awards it to B.
    const a = admittedHover('int-a3', T, 'ev-a3', 'body > div > div#menu-a');
    const b = admittedHover('int-b3', T + 500, 'ev-b3', 'body > div > menu-b');
    // Re-stamp A's evidence window to open at T+600 (AFTER B's anchor),
    // as the settle-supersession flush does when B's enter interrupts A.
    a.evidence.windowOpenedEpochMs = T + 600;
    a.evidence.windowClosedEpochMs = T + 1600;

    const built = buildEpisodes({ interactions: [a.interaction, b.interaction] });
    const graph = deriveCausalGraph({
      episodes: built.episodes,
      interactions: [a.interaction, b.interaction],
      evidenceWindows: [a.evidence, b.evidence],
    });

    const aEp = graph.episodes.find((e) => e.id === 'ep-int-a3')!;
    const bEp = graph.episodes.find((e) => e.id === 'ep-int-b3')!;
    // V3 PIN: the re-stamped window (A's facts!) is claimed by B, not A.
    const bT4 = bEp.edges.filter((e) => e.tier === 'T4-window');
    const aT4 = aEp.edges.filter((e) => e.tier === 'T4-window');
    expect(bT4.length).toBeGreaterThanOrEqual(1);
    expect(aT4.length).toBe(0);
    // And B's claim is capped (crossed anchor, uncorroborated):
    const t4 = bT4[0];
    expect(t4.confidence).toBe(0.5);
    // HONESTY: the edge detail names the carrier, so the reader can see
    // the facts belong to A's interaction:
    expect(t4.detail).toContain('int-a3');
  });
});
