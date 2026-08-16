/**
 * CP2→CP3 integration — genuinely unowned interactions.
 *
 * Strengthens the weak CP2 placeholder assertion: builds a session with
 * real unowned shapes (submit with no submit-capable anchor, navigation
 * outside any horizon, text entry never linked) and verifies
 * unownedInteractionIds exactly, plus that CP3 leaves them unowned and
 * never invents edges for them.
 */
import { describe, expect, it } from 'vitest';
import { buildEpisodes } from '../../../src/understanding/behavior-model/episode-builder';
import { deriveCausalGraph } from '../../../src/understanding/behavior-model/causal-graph';
import type { EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';

const T = 1_000_000;
let seq = 0;

function base(id: string, type: string, over: {
  eventType: string;
  t: number;
  tabId?: number;
  pageId?: string;
  end?: number;
  trigger?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): EpisodeBuilderInteraction {
  seq += 1;
  const pageId = over.pageId ?? 'p1';
  return {
    interactionId: id,
    type: type as EpisodeBuilderInteraction['type'],
    triggerEvent: {
      eventId: `evt-${pageId}-${seq}`,
      eventType: over.eventType,
      timestamp: over.t,
      captureSeq: seq,
      captureOrigin: over.tabId === undefined ? undefined : { tabId: over.tabId, frameId: 0 },
      pageId,
    },
    trigger: over.trigger ?? { tag: 'DIV', accessibleName: id },
    memberEvents: [],
    startTime: over.t,
    endTime: over.end ?? over.t + 100,
    endState: 'completed',
    metadata: over.metadata ?? {},
  } as unknown as EpisodeBuilderInteraction;
}

describe('genuinely unowned interactions (CP2 strengthening)', () => {
  it('unowned set is exact: submits without submit-capable anchors, navs outside horizons, unlinkable inputs', () => {
    const interactions: EpisodeBuilderInteraction[] = [
      // Episode A: plain link click (NOT submit-capable).
      base('int-1', 'Click', {
        eventType: 'click',
        t: T,
        trigger: { tag: 'A', accessibleName: 'Home' },
      }),
      // Submit with no submit-capable anchor to derive from → unowned.
      base('int-2', 'Unclassified', { eventType: 'submit', t: T + 60 }),
      // Navigation BEFORE any anchor on the tab → unowned (no episode live).
      base('int-3', 'Navigation', { eventType: 'navigation', t: T - 60_000, pageId: 'pX' }),
      // TextEntry on a different page, no anchor ever → unowned.
      base('int-4', 'TextEntry', { eventType: 'input', t: T + 90_000, pageId: 'pY' }),
      // Episode B: a real second anchor (submit-capable).
      base('int-5', 'Click', {
        eventType: 'click',
        t: T + 120_000,
        trigger: { tag: 'BUTTON', accessibleName: 'Add to Cart' },
      }),
    ];

    const built = buildEpisodes({ interactions });
    expect(built.episodes.map((e) => e.id)).toEqual(['ep-int-1', 'ep-int-5']);
    // CER-5 numeric order: int-2 < int-3 < int-4.
    expect(built.unownedInteractionIds).toEqual(['int-2', 'int-3', 'int-4']);

    // CP3 never invents edges for unowned interactions.
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions });
    const carrierIds = new Set(graph.episodes.flatMap((e) => e.edges.map((x) => x.from.interactionId)));
    for (const id of ['int-2', 'int-3', 'int-4']) {
      expect(carrierIds.has(id)).toBe(false);
    }
    expect(graph.episodes.flatMap((e) => e.edges)).toHaveLength(0);
  });

  it('a submit-capable click absorbs its native submit (not unowned), a plain click does not', () => {
    const cap = base('int-1', 'Click', {
      eventType: 'click',
      t: T,
      trigger: { tag: 'INPUT', inputType: 'submit', accessibleName: 'Buy' },
    });
    const sub = base('int-2', 'Unclassified', { eventType: 'submit', t: T + 60 });
    const plain = base('int-3', 'Click', {
      eventType: 'click',
      t: T + 5_000,
      trigger: { tag: 'A', accessibleName: 'Link' },
    });
    const sub2 = base('int-4', 'Unclassified', { eventType: 'submit', t: T + 5_060 });

    const built = buildEpisodes({ interactions: [cap, sub, plain, sub2] });
    expect(built.episodes).toHaveLength(2);
    // int-2 derived as companion of ep-int-1; int-4 has no submit-capable
    // anchor before it (int-3 is a link) → unowned.
    expect(built.unownedInteractionIds).toEqual(['int-4']);
    const memberIds = built.episodes[0].members.map((m) => m.interactionId);
    expect(memberIds).toContain('int-2');
  });
});
