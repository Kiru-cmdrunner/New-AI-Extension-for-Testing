/**
 * B7-P3 §5.3.2 — FIRST-WINDOW FACT OWNERSHIP (replay boundary).
 *
 * Recorded reality (real-Chrome p3-surface-reuse dump): the DOM/surface
 * accumulator is GLOBAL (INV-C1 — cleared only at a no-live-window
 * boundary), so OVERLAPPING windows share accumulated facts. A hover on
 * a child INSIDE an already-revealed panel (the classic travel-into-the-
 * menu flow) honestly re-reports the panel's reveal facts that were
 * recorded BEFORE its window opened — and would therefore emit a FALSE
 * surface-reuse link ("this hover revealed the panel").
 *
 * Rule (deterministic, evidence-grounded — no timing, no vocabulary):
 * a recorded surface fact is OWNED by the earliest interaction window
 * (input order = recorded order) that reports it. Only owned facts
 * qualify a producer. Later replay windows produce NO links.
 *
 * Honest limitation (documented, V3 family): when two windows are open
 * simultaneously and a genuinely new mutation lands, ownership goes to
 * the earlier window even if the later enter caused it (pure-CSS
 * reveals). Same settle-supersession class; no heuristic fix (DC-4).
 */

import { describe, expect, it } from 'vitest';
import { buildEpisodes, type EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';
import { deriveCausalGraph } from '../../../src/understanding/behavior-model/causal-graph';

let seq = 0;
const T = 1_000_000;

function evt(eventType: string, timestamp: number) {
  seq += 1;
  return { eventId: `evt-own-${seq}`, eventType, timestamp, captureSeq: seq };
}

/** Hover carrying recorded surface facts in its evidence window. */
function hoverWithFacts(id: string, t0: number, paths: string[]): EpisodeBuilderInteraction {
  const triggerEvent = evt('mouseenter', t0);
  const surfaces = paths.map((path, i) => ({
    path, tagName: 'DIV', ariaRole: 'region', accessibleName: 'Panel',
    shadowContext: null, descendantCount: 1, relativeTime: 100,
    batchIndex: i + 1, kind: 'added' as const, emergence: 'inserted' as const,
  }));
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'DIV', accessibleName: 'Panel', cssSelector: `#${id}`, xPath: `//div[@id='${id}']`, stableId: id },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 800,
    endState: 'completed',
    metadata: { targetName: 'Panel', terminal: 'left', consequenceClasses: ['reveal', 'insertion'], meaningful: true },
    behavioralEvidence: {
      sourceEventId: triggerEvent.eventId,
      windowId: `ev-${id}`,
      applicationEvidence: {
        domChanges: [], domChangeOverflow: 0,
        newSurfaces: surfaces, removedSurfaces: [], visibilityChanges: [],
        navigation: [], networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;
}

function clickOn(id: string, t0: number, css: string): EpisodeBuilderInteraction {
  const triggerEvent = evt('click', t0);
  return {
    interactionId: id,
    type: 'Click',
    triggerEvent,
    trigger: { tag: 'A', accessibleName: 'Laptops', cssSelector: css, xPath: css.replace('#', "//a[@id='").concat("']"), stableId: css.replace('#', '') },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 100,
    endState: 'completed',
    metadata: { targetName: 'Laptops' },
  } as unknown as EpisodeBuilderInteraction;
}

describe('B7-P3: first-window fact ownership (replay boundary)', () => {
  it('a LATER hover window re-reporting the SAME accumulated facts produces NO link (replay owns nothing)', () => {
    // int-1 reveals the panel (t=T). int-2 hovers a child INSIDE it
    // (t=T+3000) and its window re-reports the same accumulated reveal.
    const first = hoverWithFacts('int-first', T, ['body > div > div#panel']);
    const replay = hoverWithFacts('int-replay', T + 3000, ['body > div > div#panel']);
    const click = clickOn('int-click', T + 6000, '#panel > ul > li > a');

    const built = buildEpisodes({ interactions: [first, replay, click] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [first, replay, click], evidenceWindows: [] });

    // Exactly ONE link — from the FIRST (owning) window. The replay
    // window must not duplicate or fabricate ownership.
    expect(graph.provenanceLinks).toHaveLength(1);
    expect(graph.provenanceLinks[0].sourceEpisodeId).toBe('ep-int-first');
    expect(graph.provenanceLinks[0].targetEpisodeId).toBe('ep-int-click');
  });

  it('a later hover with a GENUINELY NEW fact still produces its own link (ownership does not starve new reveals)', () => {
    const first = hoverWithFacts('int-first', T, ['body > div > div#panel']);
    const second = hoverWithFacts('int-second', T + 3000, ['body > div > div#panel', 'body > div > div#sub-panel']);
    const clickPanel = clickOn('int-click-panel', T + 6000, '#panel > ul > li > a');
    const clickSub = clickOn('int-click-sub', T + 7000, '#sub-panel > a');

    const built = buildEpisodes({ interactions: [first, second, clickPanel, clickSub] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [first, second, clickPanel, clickSub], evidenceWindows: [] });

    // int-first owns div#panel → link to the panel click.
    // int-second owns div#sub-panel (new fact) → link to the sub-panel click.
    // div#panel on int-second is REPLAY — no second panel link.
    const pair = (l: { sourceEpisodeId: string; targetEpisodeId: string }) => `${l.sourceEpisodeId}→${l.targetEpisodeId}`;
    expect(graph.provenanceLinks.map(pair).sort()).toEqual(['ep-int-first→ep-int-click-panel', 'ep-int-second→ep-int-click-sub']);
  });

  it('deterministic: ownership assignment is stable under identical input', () => {
    const mk = () => {
      const first = hoverWithFacts('int-first', T, ['body > div > div#panel']);
      const replay = hoverWithFacts('int-replay', T + 3000, ['body > div > div#panel']);
      const click = clickOn('int-click', T + 6000, '#panel > ul > li > a');
      const built = buildEpisodes({ interactions: [first, replay, click] });
      return deriveCausalGraph({ episodes: built.episodes, interactions: [first, replay, click], evidenceWindows: [] });
    };
    expect(mk().provenanceLinks).toEqual(mk().provenanceLinks);
  });
});
