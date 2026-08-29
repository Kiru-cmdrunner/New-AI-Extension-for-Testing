/**
 * B7-P4 §5.4 item 2 — the SHARED adversarial surface-fact ownership pass.
 *
 * One pure pass over ALL window-bearing interactions. A Hover owns a
 * recorded reveal/insertion fact iff:
 *   (a) the fact was recorded at/after the hover window's open — compared
 *       in the GLOBAL batch-ordinal space (fact.firstBatchIndex /
 *       newSurfaces.batchIndex / visibilityChanges.batchIndex >= the
 *       window's delivered `openedBatch`). Replay windows (INV-C1 global
 *       accumulator re-reporting pre-open history) own nothing.
 *   (b) NO click-family anchor (trigger event type click/contextmenu —
 *       the primary-stamp classes) on the same tab has T0 inside the
 *       hover's window span [open epoch, open epoch + durationMs]. An
 *       in-span click is the proximate primary action and takes
 *       ownership (Channel A Variant 1).
 *
 * Recorded reality driving the rule (real-Chrome dumps):
 *   - channel-a-thenhover-consume: hover window open BEFORE the revealer
 *     click; the reveal lands inside BOTH windows — naive first-reporter
 *     would hand the hover a fact the click caused (Variant 1).
 *   - channel-a-d3-staggered: revealer click T0 PRECEDES the inheriting
 *     hover's window open; the click's own window closes before the
 *     staggered insertions fire (+2500..+3700ms) so the insertions land
 *     ONLY in the hover's window (Variant 2). The interval test alone
 *     cannot veto them — the panel the insertions land in was REVEALED
 *     inside the click's stream, so the reveal fact is click-owned and
 *     an insertion under a surface whose reveal another interaction owns
 *     is not the hover's to claim (container-reveal clause — the
 *     amendment's own "the click that REVEALED THE CHILD" argument, made
 *     structural; no clock, no vocabulary).
 *
 * Honesty degradation: a window delivered WITHOUT `openedBatch` (legacy
 * evidence) cannot verify rule (a) — it owns NOTHING (no assertion is
 * ever minted from unverifiable ownership).
 */

import { describe, expect, it } from 'vitest';
import {
  deriveSurfaceFactOwnership,
  type OwnershipInteraction,
} from '../../../src/shared/surface-fact-ownership';

let seq = 0;
const T = 1_780_000_000_000;

function evt(eventType: string, timestamp: number, tabId?: number) {
  seq += 1;
  return {
    eventId: `evt-own4-${seq}`,
    eventType,
    timestamp,
    captureSeq: seq,
    ...(tabId === undefined ? {} : { captureOrigin: { tabId, frameId: 0 } }),
  };
}

interface WindowOpts {
  id: string;
  type: string;
  eventType: string;
  openEpoch: number;
  durationMs: number;
  openedBatch: number | null; // null = legacy evidence (field absent)
  tabId?: number;
  domChanges?: Array<Record<string, unknown>>;
  newSurfaces?: Array<Record<string, unknown>>;
  visibilityChanges?: Array<Record<string, unknown>>;
}

function windowed(o: WindowOpts): OwnershipInteraction {
  const triggerEvent = evt(o.eventType, o.openEpoch, o.tabId);
  const window: Record<string, unknown> = {
    openedAt: 0,
    closedAt: o.durationMs,
    durationMs: o.durationMs,
    endReason: 'consequence-settled',
  };
  if (o.openedBatch !== null) window.openedBatch = o.openedBatch;
  return {
    interactionId: o.id,
    type: o.type,
    triggerEvent,
    startTime: o.openEpoch,
    endTime: o.openEpoch + o.durationMs,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      sourceEventId: triggerEvent.eventId,
      windowId: `ev-${o.id}`,
      window,
      applicationEvidence: {
        domChanges: o.domChanges ?? [],
        newSurfaces: o.newSurfaces ?? [],
        removedSurfaces: [],
        visibilityChanges: o.visibilityChanges ?? [],
        navigation: [],
        networkActivity: [],
      },
    },
  } as unknown as OwnershipInteraction;
}

const revealVis = (path: string, batchIndex: number) => ({
  path,
  property: 'display',
  oldValue: 'none',
  newValue: 'block',
  batchIndex,
});
const insertion = (path: string, batchIndex: number) => ({
  types: ['childList'],
  targetPath: path,
  targetTag: 'DIV',
  addedNodesCount: 2,
  removedNodesCount: 0,
  attributeDeltas: {},
  firstBatchIndex: batchIndex,
  lastBatchIndex: batchIndex,
});

describe('B7-P4: adversarial surface-fact ownership — canonical + replay', () => {
  it('canonical menu: a hover with post-open reveal + insertion facts OWNS them (locator derived from #id)', () => {
    const hover = windowed({
      id: 'int-h', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 1200, openedBatch: 0,
      newSurfaces: [{ path: 'body > div > div#fly', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'Products flyout', batchIndex: 1, kind: 'added', emergence: 'revealed' }],
      domChanges: [insertion('body > div > div#fly', 2)],
    });
    const res = deriveSurfaceFactOwnership([hover]);
    const owned = res.ownedByInteraction.get('int-h') ?? [];
    expect(owned.map((f) => f.kind).sort()).toEqual(['insertion', 'reveal']);
    expect(owned.every((f) => f.locator === '#fly')).toBe(true);
    expect(owned.find((f) => f.kind === 'reveal')?.targetName).toBe('Products flyout');
  });

  it('replay window (facts recorded BEFORE its open) owns NOTHING — rule (a) batch boundary', () => {
    const first = windowed({
      id: 'int-first', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 800, openedBatch: 0,
      visibilityChanges: [revealVis('body > div > div#panel', 1)],
    });
    // Re-opens AFTER batch 1 fired; the INV-C1 accumulator replays it.
    const replay = windowed({
      id: 'int-replay', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T + 3000, durationMs: 800, openedBatch: 5,
      visibilityChanges: [revealVis('body > div > div#panel', 1)],
    });
    const res = deriveSurfaceFactOwnership([first, replay]);
    expect(res.ownedByInteraction.get('int-first')?.length).toBe(1);
    expect(res.ownedByInteraction.get('int-replay') ?? []).toHaveLength(0);
  });

  it('legacy window without openedBatch owns NOTHING (rule (a) unverifiable → honest silence)', () => {
    const hover = windowed({
      id: 'int-legacy', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 800, openedBatch: null,
      visibilityChanges: [revealVis('body > div > div#panel', 1)],
    });
    const res = deriveSurfaceFactOwnership([hover]);
    expect(res.ownedByInteraction.get('int-legacy') ?? []).toHaveLength(0);
  });

  it('fact on a path with NO #id is owned but carries locator:null (assertion layer must skip)', () => {
    const hover = windowed({
      id: 'int-h', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 800, openedBatch: 0,
      visibilityChanges: [revealVis('body > div > div', 1)],
    });
    const res = deriveSurfaceFactOwnership([hover]);
    expect(res.ownedByInteraction.get('int-h')?.[0]?.locator).toBeNull();
  });
});

describe('B7-P4: Channel A Variant 1 — click lands inside the hover window', () => {
  it('hover opened BEFORE the revealer click owns NOTHING; the CLICK owns the reveal', () => {
    // Recorded shape (channel-a-thenhover-consume): hover int-1 open at T
    // (window span T..T+715), revealer click at T+410, reveal recorded at
    // T+460 — inside BOTH windows. Naive first-reporter hands the hover
    // the reveal; the adversarial rule must not.
    const hover = windowed({
      id: 'int-hover', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 715, openedBatch: 0,
      visibilityChanges: [revealVis('body > div#nav > div#cpanel', 1)],
      domChanges: [insertion('body > div#nav > div#cpanel', 2)],
    });
    const click = windowed({
      id: 'int-click', type: 'Expander', eventType: 'click',
      openEpoch: T + 410, durationMs: 500, openedBatch: 1,
      visibilityChanges: [revealVis('body > div#nav > div#cpanel', 1)],
      domChanges: [insertion('body > div#nav > div#cpanel', 2)],
    });
    const res = deriveSurfaceFactOwnership([hover, click]);
    expect(res.ownedByInteraction.get('int-hover') ?? []).toHaveLength(0);
    const clickOwned = res.ownedByInteraction.get('int-click') ?? [];
    expect(clickOwned.map((f) => f.kind)).toContain('reveal');
    expect(clickOwned.map((f) => f.kind)).toContain('insertion');
  });

  it('a click on a DIFFERENT tab does not veto (tab-isolated)', () => {
    const hover = windowed({
      id: 'int-hover', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 715, openedBatch: 0, tabId: 1,
      visibilityChanges: [revealVis('body > div > div#cpanel', 1)],
    });
    const foreignClick = windowed({
      id: 'int-foreign', type: 'Click', eventType: 'click',
      openEpoch: T + 300, durationMs: 200, openedBatch: 1, tabId: 2,
    });
    const res = deriveSurfaceFactOwnership([hover, foreignClick]);
    expect(res.ownedByInteraction.get('int-hover')?.length).toBe(1);
  });

  it('contextmenu is click-family (primary-stamp class) and vetoes like a click', () => {
    const hover = windowed({
      id: 'int-hover', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 715, openedBatch: 0,
      visibilityChanges: [revealVis('body > div > div#cpanel', 1)],
    });
    const ctx = windowed({
      id: 'int-ctx', type: 'Unclassified', eventType: 'contextmenu',
      openEpoch: T + 300, durationMs: 200, openedBatch: 1,
    });
    const res = deriveSurfaceFactOwnership([hover, ctx]);
    expect(res.ownedByInteraction.get('int-hover') ?? []).toHaveLength(0);
  });
});

describe('B7-P4: Channel A Variant 2 — click T0 PRECEDES the inheriting hover open', () => {
  it('staggered insertions into a CLICK-revealed panel are NOT owned by the later hover (container-reveal clause)', () => {
    // Recorded shape (channel-a-d3-staggered): hover over the button
    // (T..T+712), revealer click at T+410 (window closes T+910, reveal at
    // T+610 batch 1), inheriting hover opens T+1505 (openedBatch 2) and
    // the click's +2500..+3700ms timers insert children into the SAME
    // panel (batches 3..6) — landing ONLY in the inheriting hover's
    // window. No click T0 inside [T+1505, …] — the interval test cannot
    // veto; the panel's REVEAL is click-owned, so insertions under it are
    // not the hover's to claim.
    const firstHover = windowed({
      id: 'int-h1', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 712, openedBatch: 0,
    });
    const click = windowed({
      id: 'int-click', type: 'Expander', eventType: 'click',
      openEpoch: T + 410, durationMs: 500, openedBatch: 1,
      visibilityChanges: [revealVis('body > div#nav > div#cpanel', 1)],
      domChanges: [{
        types: ['attributes'], targetPath: 'body > div#nav > button#open-btn',
        targetTag: 'BUTTON', addedNodesCount: 0, removedNodesCount: 0,
        attributeDeltas: { 'aria-expanded': { old: 'false', new: 'true' } },
        firstBatchIndex: 1, lastBatchIndex: 1,
      }],
    });
    const inheriting = windowed({
      id: 'int-h3', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T + 1505, durationMs: 3300, openedBatch: 2,
      domChanges: [insertion('body > div#nav > div#cpanel', 3)],
    });
    const res = deriveSurfaceFactOwnership([firstHover, click, inheriting]);
    expect(res.ownedByInteraction.get('int-h3') ?? []).toHaveLength(0);
    // The click owns its own reveal.
    expect(res.ownedByInteraction.get('int-click')?.some((f) => f.kind === 'reveal')).toBe(true);
  });

  it('insertion into a surface the SAME hover revealed IS owned (canonical nested case survives the clause)', () => {
    const hover = windowed({
      id: 'int-h', type: 'Hover', eventType: 'mouseenter',
      openEpoch: T, durationMs: 1500, openedBatch: 0,
      visibilityChanges: [revealVis('body > div > div#fly', 1)],
      domChanges: [insertion('body > div > div#fly', 2)],
    });
    const res = deriveSurfaceFactOwnership([hover]);
    const owned = res.ownedByInteraction.get('int-h') ?? [];
    expect(owned.map((f) => f.kind).sort()).toEqual(['insertion', 'reveal']);
  });
});

describe('B7-P4: ownership pass — determinism', () => {
  it('identical input → identical output', () => {
    const mk = () => [
      windowed({
        id: 'int-h', type: 'Hover', eventType: 'mouseenter',
        openEpoch: T, durationMs: 900, openedBatch: 0,
        newSurfaces: [{ path: 'body > div > div#fly', tagName: 'DIV', ariaRole: 'menu', accessibleName: 'Fly', batchIndex: 1, kind: 'added', emergence: 'revealed' }],
      }),
      windowed({
        id: 'int-c', type: 'Click', eventType: 'click',
        openEpoch: T + 300, durationMs: 200, openedBatch: 2,
      }),
    ];
    const a = deriveSurfaceFactOwnership(mk());
    const b = deriveSurfaceFactOwnership(mk());
    expect(a).toEqual(b);
  });
});
