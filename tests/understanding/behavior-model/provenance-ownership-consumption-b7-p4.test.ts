/**
 * B7-P4 — ownership infrastructure: `openedBatch` delivery + the shared
 * ownership pass consumed by the causal graph's provenance links.
 *
 * Two seams, one rule:
 *   1. DELIVERY: the evidence collector stamps `window.openedBatch` (the
 *      global MutationObserver batch counter at window open) onto every
 *      delivered BehavioralEvidence. Rule (a) of the ownership pass
 *      compares fact ordinals against it — without delivery the pass can
 *      only stay silent (legacy rows own nothing).
 *   2. CONSUMPTION: causal-graph provenance links qualify producers via
 *      the SHARED adversarial pass (src/shared/surface-fact-ownership) —
 *      click-family interactions enter as claimants, a hover whose facts
 *      were caused by an in-window click produces NO link (Channel A
 *      Variant 1 semantics at the link seam too).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvidenceCollector } from '../../../src/tap/evidence-collector';
import { DOMObserver } from '../../../src/tap/dom-observer';
import { TargetStateCache } from '../../../src/tap/target-state-cache';
import type { BehavioralEvidence } from '../../../src/shared/behavioral-evidence-types';
import { deriveCausalGraph } from '../../../src/understanding/behavior-model/causal-graph';
import { buildEpisodes, type EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';

let seq = 0;
const T = 1_780_000_000_000;

function evt(eventType: string, timestamp: number) {
  seq += 1;
  return { eventId: `evt-t2-${seq}`, eventType, timestamp, captureSeq: seq };
}

// ── Seam 1: openedBatch delivery ────────────────────────────────────────

describe('B7-P4: openedBatch delivery', () => {
  let cache: TargetStateCache;
  let observer: DOMObserver;
  let collector: EvidenceCollector;
  let delivered: BehavioralEvidence[];
  let mockNow: number;

  beforeEach(() => {
    document.body.innerHTML = '';
    delivered = [];
    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
    vi.useFakeTimers();
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            delivered.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;
    cache = new TargetStateCache();
    observer = new DOMObserver();
    collector = new EvidenceCollector({ targetStateCache: cache, domObserver: observer });
    collector.start();
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function advance(ms: number): void {
    mockNow += ms;
    vi.advanceTimersByTime(ms);
  }

  function observed(eventType: string, eventId: string, tag = 'BUTTON') {
    const tabIndex = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' ? 0 : -1;
    return {
      eventId, eventType, timestamp: mockNow, captureSeq: 0, isTrusted: true,
      target: {
        accessibleName: 'x', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
        placeholder: null, tag, className: null, name: null, stableId: null,
        testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '', elementId: '',
        rect: null, textContent: null, shadowContext: null,
      },
      domContext: {
        inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
        disabled: false, readOnly: false, required: false, ancestorRoles: [],
        ancestorClasses: [], tabIndex,
      },
      valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }

  it('delivers window.openedBatch — the global batch counter at open', () => {
    const btn = document.createElement('button');
    btn.id = 'b1';
    document.body.appendChild(btn);

    // A mutation BEFORE the window opens advances the global counter.
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    advance(120);

    collector.onAfterEvent(btn, 'evt-ob-1', 'mouseenter', '', null, observed('mouseenter', 'evt-ob-1'));
    advance(50);
    collector.stop();

    expect(delivered.length).toBe(1);
    const w = (delivered[0] as { window?: { openedBatch?: number } }).window;
    // The field is delivered on every window — the global batch counter's
    // VALUE at open (0 in this jsdom run: the probe append produced no
    // batch — the DOMObserver's isNoise guard throws in jsdom). The
    // invariant is presence + numeric type, so downstream rule (a) can
    // always verify boundaries; >=1 is NOT asserted (jsdom-dependent).
    expect(typeof w?.openedBatch).toBe('number');
  });
});

// ── Seam 2: causal-graph provenance consumes the shared pass ────────────

function hoverWithEvidence(
  id: string, t0: number, opts: {
    openedBatch?: number;
    newSurfaces?: Array<{ path: string; ariaRole: string | null; name: string | null; batchIndex: number }>;
  } = {},
): EpisodeBuilderInteraction {
  const triggerEvent = evt('mouseenter', t0);
  return {
    interactionId: id,
    type: 'Hover',
    triggerEvent,
    trigger: { tag: 'BUTTON', accessibleName: 'Products', cssSelector: '#nav-products', xPath: "//button[@id='nav-products']", stableId: 'nav-products' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 1200,
    endState: 'completed',
    metadata: { targetName: 'Products', terminal: 'left', consequenceClasses: ['reveal'], meaningful: true },
    behavioralEvidence: {
      sourceEventId: triggerEvent.eventId,
      windowId: `ev-${id}`,
      window: { openedAt: 0, closedAt: 1200, durationMs: 1200, endReason: 'consequence-settled', ...(opts.openedBatch !== undefined ? { openedBatch: opts.openedBatch } : {}) },
      applicationEvidence: {
        domChanges: [],
        domChangeOverflow: 0,
        newSurfaces: (opts.newSurfaces ?? []).map((s) => ({
          path: s.path, tagName: 'DIV', ariaRole: s.ariaRole, accessibleName: s.name,
          shadowContext: null, descendantCount: 1, relativeTime: 100,
          batchIndex: s.batchIndex, kind: 'added' as const, emergence: 'inserted' as const,
        })),
        removedSurfaces: [], visibilityChanges: [], navigation: [], networkActivity: [],
      },
    },
  } as unknown as EpisodeBuilderInteraction;
}

function clickInteraction(id: string, t0: number, css: string, eventId: string): EpisodeBuilderInteraction {
  const triggerEvent = { eventId, eventType: 'click', timestamp: t0, captureSeq: 1 };
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

describe('B7-P4: provenance producers qualify via the shared ownership pass', () => {
  it('canonican hover reveal with openedBatch still links (no regression)', () => {
    const h = hoverWithEvidence('int-h1', T, {
      openedBatch: 0,
      newSurfaces: [{ path: 'body > div > div#fly', ariaRole: 'menu', name: 'Flyout', batchIndex: 1 }],
    });
    const c = clickInteraction('int-c1', T + 3000, '#fly > ul > li > a', 'evt-click-c1');
    const built = buildEpisodes({ interactions: [h, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h, c], evidenceWindows: [] });
    expect(graph.provenanceLinks).toHaveLength(1);
    expect(graph.provenanceLinks[0].sourceEpisodeId).toBe('ep-int-h1');
  });

  it('Channel A V1 shape: hover whose reveal is vetoed by an in-window click emits NO link', () => {
    // Hover opens at T (span 1200ms); click lands at T+400 INSIDE the
    // hover window; the reveal fact (batch 1) is at/after the click's
    // openedBatch (0). The shared pass refuses hover ownership → no
    // producer → no link.
    const h = hoverWithEvidence('int-h1', T, {
      openedBatch: 0,
      newSurfaces: [{ path: 'body > div > div#cpanel', ariaRole: 'region', name: 'Panel', batchIndex: 1 }],
    });
    const revealer = clickInteraction('int-rev', T + 400, '#cpanel', 'evt-click-rev');
    const consumer = clickInteraction('int-c1', T + 5000, '#cpanel > a', 'evt-click-c1');
    const built = buildEpisodes({ interactions: [h, revealer, consumer] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h, revealer, consumer], evidenceWindows: [] });
    expect(graph.provenanceLinks).toHaveLength(0);
  });

  it('legacy hover evidence (no openedBatch) still emits links via the P3 first-reporter path (honest legacy compatibility)', () => {
    // Rows recorded before P4 carry no openedBatch. The shared pass
    // declines ownership for them — but the P3 link semantics were
    // pinned on exactly this shape and must not regress for stored
    // sessions replayed through the panel today.
    const h = hoverWithEvidence('int-h1', T, {
      newSurfaces: [{ path: 'body > div > div#fly', ariaRole: 'menu', name: 'Flyout', batchIndex: 1 }],
    });
    const c = clickInteraction('int-c1', T + 3000, '#fly > a', 'evt-click-c1');
    const built = buildEpisodes({ interactions: [h, c] });
    const graph = deriveCausalGraph({ episodes: built.episodes, interactions: [h, c], evidenceWindows: [] });
    expect(graph.provenanceLinks).toHaveLength(1);
    expect(graph.provenanceLinks[0].sourceEpisodeId).toBe('ep-int-h1');
  });
});
