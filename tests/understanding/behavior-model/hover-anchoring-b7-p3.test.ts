/**
 * B7-P3 §5.3.1 — admission-keyed hover anchoring (episode-builder).
 *
 * The anchor gate at episode-builder.ts:296-299 currently requires
 * triggerEventType ∈ DISCRETE_ACTION_TYPES — mouseenter is NOT a member,
 * so a Hover interaction NEVER anchors an episode today (pinned by the
 * B7-P2 state; the grounding audit re-verified episodes:[] with hovers
 * present in live interactions).
 *
 * P3 switches the gate to the admission-keyed predicate (spec §5.2.4):
 *   - a COMPLETED, consequence-bearing Hover (admitted — the exact
 *     production filter outcome) ANCHORS its own episode;
 *   - a gesture-only hover (no consequence classes) NEVER anchors;
 *   - an abandoned/interrupted hover NEVER anchors;
 *   - ALL non-hover behavior is byte-identical: every
 *     DISCRETE_ACTION_TYPES trigger still anchors exactly as before,
 *     and a non-admitted hover that fails anchoring must NOT become an
 *     unowned member of another episode by its mere presence (it stays
 *     unowned — hovers are not INPUT_INTERACTION_TYPES, not navigation,
 *     not companions, not Unclassified).
 *
 * No timing rules, no vocabulary: admission derives from the recorded
 * metadata.consequenceClasses (P2 compat bridge output) + endState only.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEpisodes,
  type EpisodeBuilderInteraction,
} from '../../../src/understanding/behavior-model/episode-builder';

let seq = 0;
const T = 1_000_000;

function evt(opts: {
  id?: string;
  eventType: string;
  timestamp: number;
  tabId?: number;
  captureSeq?: number;
}): { eventId: string; eventType: string; timestamp: number; captureSeq: number; captureOrigin?: { tabId: number; frameId: number } } {
  seq += 1;
  return {
    eventId: opts.id ?? `evt-p1-${seq}`,
    eventType: opts.eventType,
    timestamp: opts.timestamp,
    captureSeq: opts.captureSeq ?? seq,
    ...(opts.tabId === undefined ? {} : { captureOrigin: { tabId: opts.tabId, frameId: 0 } }),
  };
}

/** Admitted-hover shape: completed + metadata.consequenceClasses (P2 bridge). */
function admittedHover(id: string, t0: number, classes = ['reveal']): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'mouseenter', timestamp: t0 });
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Account menu' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 1400,
    endState: 'completed',
    metadata: {
      targetName: 'Account menu',
      terminal: 'left',
      dwellMs: 1400,
      consequenceClasses: classes,
      meaningful: classes.length > 0,
    },
  } as unknown as EpisodeBuilderInteraction;
}

function gestureOnlyHover(id: string, t0: number): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'mouseenter', timestamp: t0 });
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Info' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 900,
    endState: 'completed',
    metadata: { terminal: 'left', dwellMs: 900, consequenceClasses: [], meaningful: false },
  } as unknown as EpisodeBuilderInteraction;
}

function abandonedHover(id: string, t0: number): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'mouseenter', timestamp: t0 });
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Stale menu' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 300_000,
    endState: 'abandoned',
    metadata: { terminal: 'idle-timeout', consequenceClasses: ['reveal'], meaningful: true },
  } as unknown as EpisodeBuilderInteraction;
}

function clickInteraction(id: string, t0: number): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'click', timestamp: t0 });
  return {
    interactionId: id,
    type: 'Click',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Add to Cart' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 120,
    endState: 'completed',
    metadata: { targetName: 'Add to Cart' },
  } as unknown as EpisodeBuilderInteraction;
}

/** Click with a GIVEN duration (for horizon parity against a hover). */
function clickShaped(id: string, t0: number, durMs: number): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'click', timestamp: t0 });
  return {
    interactionId: id,
    type: 'Click',
    triggerEvent,
    trigger: { tag: 'button', accessibleName: 'Add to Cart' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + durMs,
    endState: 'completed',
    metadata: { targetName: 'Add to Cart' },
  } as unknown as EpisodeBuilderInteraction;
}

/** Run episodes for [a, later] and return the episode anchored by `a`. */
function hoverOnly(
  wantId: string,
  a: EpisodeBuilderInteraction,
  later: EpisodeBuilderInteraction,
) {
  const res = buildEpisodes({ interactions: [a, later] });
  return res.episodes.find((e) => e.anchor.interactionId === wantId);
}

describe('B7-P3: admission-keyed hover anchoring', () => {
  it('an ADMITTED hover (completed + consequence classes) anchors its own episode', () => {
    const res = buildEpisodes({ interactions: [admittedHover('int-h1', T)] });
    expect(res.episodes.length).toBe(1);
    expect(res.episodes[0].anchor.interactionId).toBe('int-h1');
    expect(res.episodes[0].anchor.actionType).toBe('Hover');
    expect(res.episodes[0].anchor.actionTarget).toBe('Account menu');
    expect(res.unownedInteractionIds).not.toContain('int-h1');
  });

  it('a GESTURE-ONLY hover (no consequence classes) never anchors and stays unowned', () => {
    const res = buildEpisodes({ interactions: [gestureOnlyHover('int-h2', T)] });
    expect(res.episodes.length).toBe(0);
    expect(res.unownedInteractionIds).toContain('int-h2');
  });

  it('an ABANDONED hover never anchors even with consequence classes recorded', () => {
    const res = buildEpisodes({ interactions: [abandonedHover('int-h3', T)] });
    expect(res.episodes.length).toBe(0);
    expect(res.unownedInteractionIds).toContain('int-h3');
  });

  it('an INTERRUPTED hover never anchors', () => {
    const triggerEvent = evt({ eventType: 'mouseenter', timestamp: T });
    const interrupted = {
      interactionId: 'int-h4',
      type: 'Hover',
      triggerEvent,
      trigger: { tag: 'BUTTON', accessibleName: 'Menu' },
      memberEvents: [triggerEvent],
      startTime: T,
      endTime: T + 200,
      endState: 'interrupted',
      metadata: { consequenceClasses: ['reveal'] },
    } as unknown as EpisodeBuilderInteraction;
    const res = buildEpisodes({ interactions: [interrupted] });
    expect(res.episodes.length).toBe(0);
    expect(res.unownedInteractionIds).toContain('int-h4');
  });

  it('hover + click sequence: hover anchors its episode AND the click anchors its own (two episodes, both anchors)', () => {
    const res = buildEpisodes({
      interactions: [
        admittedHover('int-h5', T),        // hover at T
        clickInteraction('int-c5', T + 3000), // click well after
      ],
    });
    expect(res.episodes.length).toBe(2);
    const types = res.episodes.map((e) => e.anchor.actionType).sort();
    expect(types).toEqual(['Click', 'Hover']);
  });

  it('a LATER anchor closes the hover episode uiOwnership horizon by parity with an identically-shaped Click (horizon math unchanged)', () => {
    // Same temporal shape: anchor at T, effective end T+1400, next anchor T+3000.
    // Only the type/trigger metadata differ. Horizon math must not care.
    const hoverEp = hoverOnly('int-h6', admittedHover('int-h6', T), clickInteraction('int-c6', T + 3000));
    const clickEp = hoverOnly('int-h6c', clickShaped('int-h6c', T, 1400), clickInteraction('int-c6c', T + 3000));
    expect(hoverEp!.horizon.uiOwnership.closedAtMs).toBe(clickEp!.horizon.uiOwnership.closedAtMs);
    expect(hoverEp!.horizon.uiOwnership.closeReason).toBe(clickEp!.horizon.uiOwnership.closeReason);
    // Both close from member effective-ends (stabilized), never a hover rule:
    expect(hoverEp!.horizon.uiOwnership.closeReason).toBe('stabilized');
  });

  it('a gesture-only hover present alongside a click does NOT become a member of the click episode (unowned, V4 honesty)', () => {
    const res = buildEpisodes({
      interactions: [gestureOnlyHover('int-h7', T), clickInteraction('int-c7', T + 1000)],
    });
    expect(res.episodes.length).toBe(1); // click only
    const ep = res.episodes[0];
    expect(ep.members.some((m) => m.interactionId === 'int-h7')).toBe(false);
    expect(res.unownedInteractionIds).toContain('int-h7');
  });

  it('NON-HOVER anchoring is byte-identical: click anchors exactly as before (regression pin)', () => {
    const res = buildEpisodes({ interactions: [clickInteraction('int-c8', T)] });
    expect(res.episodes.length).toBe(1);
    expect(res.episodes[0].anchor.interactionId).toBe('int-c8');
    expect(res.episodes[0].anchor.actionType).toBe('Click');
  });

  it('hover missing metadata.consequenceClasses entirely never anchors (pre-P2 legacy record)', () => {
    const triggerEvent = evt({ eventType: 'mouseenter', timestamp: T });
    const legacy = {
      interactionId: 'int-h9',
      type: 'Hover',
      triggerEvent,
      trigger: { tag: 'BUTTON', accessibleName: 'Legacy' },
      memberEvents: [triggerEvent],
      startTime: T,
      endTime: T + 500,
      endState: 'completed',
      metadata: {}, // no classes (a legacy/predicted record)
    } as unknown as EpisodeBuilderInteraction;
    const res = buildEpisodes({ interactions: [legacy] });
    expect(res.episodes.length).toBe(0);
    expect(res.unownedInteractionIds).toContain('int-h9');
  });
});
