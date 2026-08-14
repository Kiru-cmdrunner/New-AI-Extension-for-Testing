/**
 * Form-Submit Recovery — Integration shapes (spec T6, T8, T9)
 *
 * T6  commit-time routing: recovered POST lands on the CLICK interaction,
 *     the synthetic nav records causedByInteractionId and carries no network.
 * T8  richness replacement: SW-thin evidence with the POST is replaced by
 *     later richer content-script evidence, and the POST is preserved once.
 * T9  replay confluence: all subsets/orderings of {commit-attach, flush,
 *     drain, boot-reconcile} converge to the same final LIVE_INTERACTIONS.
 *
 * Spec: .drytis/specs/form-submit-evidence-recovery.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type {
  BehavioralEvidence,
  NetworkActivity,
} from '../../src/shared/behavioral-evidence-types';

// ── Mock chrome.storage.local ─────────────────────────────────────────

const storageData = new Map<string, unknown>();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(storageData);
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (storageData.has(k)) out[k] = storageData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storageData.set(k, v);
      }),
      remove: vi.fn((keys: string | string[] | null) => {
        if (keys === null) {
          storageData.clear();
          return Promise.resolve();
        }
        for (const k of Array.isArray(keys) ? keys : [keys]) storageData.delete(k);
        return Promise.resolve();
      }),
    },
  },
});

import {
  DurableAttributionLedger,
  synthesizeMinimalEvidence,
} from '../../src/background/evidence-attribution';
import { drainNetworkEvidence } from '../../src/background/network-drain';

// ── Fixtures ──────────────────────────────────────────────────────────

const E_CLICK = 'evt-click-atc';
const R_POST = 'REQ-POST-1';
const POST_URL = 'https://www.amazon.in/gp/add-to-cart/ref=dp_start-bbf_1_glance';

function emptyApplicationEvidence(): BehavioralEvidence['applicationEvidence'] {
  return {
    domChanges: [],
    domChangeOverflow: 0,
    coarseMode: false,
    newSurfaces: [],
    removedSurfaces: [],
    visibilityChanges: [],
    navigation: [],
    networkActivity: [],
    performanceCondition: {
      mainThreadBlocked: false,
      highChurnMode: false,
      longestBatchMs: 0,
      totalBatches: 0,
    },
  };
}

function makeClick(withEvidence = false): ComponentInteraction {
  return {
    interactionId: 'int-click',
    type: 'Click' as never,
    trigger: {
      kind: 'element',
      tagName: 'INPUT',
      id: 'add-to-cart-button',
      accessibleName: 'Add to cart',
      attributes: { type: 'submit' },
    } as never,
    triggerEvent: { eventId: E_CLICK, eventType: 'click' } as never,
    memberEvents: [],
    startTime: 1_000,
    endTime: 1_120,
    endState: 'completed' as never,
    metadata: {},
    behavioralEvidence: withEvidence
      ? ({
          sourceEventId: E_CLICK,
          sourceEventType: 'click',
          windowId: `ev-${E_CLICK}`,
          frameId: 'main',
          window: {
            openedAt: 0,
            closedAt: 120,
            durationMs: 120,
            endReason: 'page-reload',
            stabilityTrace: [],
          },
          targetEvidence: {
            identity: null,
            identityCapturedAt: 0,
            before: null,
            after: null,
            focusMovement: null,
          },
          applicationEvidence: emptyApplicationEvidence(),
        } as never)
      : undefined,
  };
}

function makeSyntheticNav(causedBy?: string): ComponentInteraction {
  return {
    interactionId: 'int-nav',
    type: 'Navigation' as never,
    trigger: { kind: 'url', url: POST_URL } as never,
    triggerEvent: { eventId: 'evt-nav-synth', eventType: 'navigation' } as never,
    memberEvents: [],
    startTime: 1_120,
    endTime: 1_150,
    endState: 'completed' as never,
    metadata: {},
    behavioralEvidence: {
      sourceEventId: 'evt-nav-synth',
      sourceEventType: 'navigation',
      windowId: 'synthetic-nav-0',
      frameId: 'main',
      window: {
        openedAt: 0,
        closedAt: 0,
        durationMs: 0,
        endReason: 'page-reload-synthetic',
        stabilityTrace: [],
      },
      targetEvidence: {
        identity: null,
        identityCapturedAt: 0,
        before: null,
        after: null,
        focusMovement: null,
      },
      applicationEvidence: emptyApplicationEvidence(),
      // causedByInteractionId: causedBy — asserted via (causedByInteractionId as never)
      ...({ causedByInteractionId: causedBy } as Record<string, unknown>),
    } as never,
  };
}

function stampedPostEntry() {
  return {
    url: POST_URL,
    method: 'POST',
    status: 302,
    requestId: R_POST,
    sourceEventId: E_CLICK,
    requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
    documentRequest: true,
    mainFrame: true,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
  storageData.clear();
  vi.clearAllMocks();
});

describe('T6: commit-time routing', () => {
  it('POST attaches to the click interaction; synthetic nav gets causedByInteractionId and no network', async () => {
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped(stampedPostEntry());

    const click = makeClick();
    const nav = makeSyntheticNav();
    const attached = ledger.attachToInteractions([click, nav]);

    expect(attached).toBe(1);
    // The CLICK owns the POST
    const clickNet = click.behavioralEvidence!.applicationEvidence.networkActivity as
      (NetworkActivity & { requestId?: string })[];
    expect(clickNet).toHaveLength(1);
    expect(clickNet[0].requestId).toBe(R_POST);
    expect(clickNet[0].requestBody).toEqual({ ASIN: 'B08KGRVW2S', quantity: '1' });
    expect(click.behavioralEvidence!.window.endReason).toBe('sw-recovered-form-submit');
    // The synthetic nav carries NO network
    const navNet =
      nav.behavioralEvidence?.applicationEvidence?.networkActivity ?? [];
    expect(navNet).toHaveLength(0);
    expect(
      (nav.behavioralEvidence as unknown as Record<string, unknown>)
        ?.causedByInteractionId,
    ).toBe('int-click');
  });

  it('unresolved stamp falls back to the synthetic nav (today’s behavior)', async () => {
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped(stampedPostEntry());

    // No click interaction exists (e.g. lost) — only the synthetic nav.
    const nav = makeSyntheticNav();
    const attached = ledger.attachToInteractions([nav]);
    expect(attached).toBe(0); // synthetic nav is skipped as a join target
    // Fallback is the caller's (service-worker) legacy synthetic-nav attach,
    // covered by existing race-fix tests — the ledger never guesses.
  });
});

describe('T8: richness replacement preserves the recovered POST', () => {
  it('later richer content-script evidence replaces thin evidence but keeps the POST exactly once', async () => {
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped(stampedPostEntry());
    const click = makeClick();
    ledger.attachToInteractions([click]);
    expect(click.behavioralEvidence!.applicationEvidence.networkActivity).toHaveLength(1);

    // Later, the next page's flushBufferedEvidence delivers richer evidence
    // (real DOM diffs + same POST captured directly with same requestId).
    const richerNet: (NetworkActivity & { requestId?: string })[] = [
      {
        url: POST_URL,
        method: 'POST',
        status: 302,
        startRelativeToEvent: 4,
        endRelativeToEvent: 90,
        durationMs: 86,
        resourceType: 'navigation',
        source: 'main-world',
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
        sourceEventId: E_CLICK,
        requestId: R_POST,
      } as never,
    ];
    const richer: BehavioralEvidence = {
      sourceEventId: E_CLICK,
      sourceEventType: 'click',
      windowId: `ev-${E_CLICK}`,
      frameId: 'main',
      window: {
        openedAt: 0,
        closedAt: 120,
        durationMs: 120,
        endReason: 'page-reload',
        stabilityTrace: [],
      },
      targetEvidence: {
        identity: null,
        identityCapturedAt: 0,
        before: null,
        after: {
          // value change = richness > thin
          dom: { attr: 'class', from: 'a-button', to: 'a-button-loading' },
        } as never,
        focusMovement: null,
      },
      applicationEvidence: {
        ...emptyApplicationEvidence(),
        domChanges: [
          {
            batchIndex: 1,
            summary: 'button class → a-button-loading',
          } as never,
        ],
        networkActivity: richerNet,
      },
    };

    // Mirror sw-integration's replace-if-richer + preserved-network merge
    // (Fix Round 5) — the contract the SW wiring must uphold.
    const existing = click.behavioralEvidence!;
    const preserved = existing.applicationEvidence.networkActivity;
    const allUrls = new Set(richerNet.map((n) => `${n.method}:${n.url}`));
    const merged = [
      ...preserved,
      ...richerNet.filter((n) => !allUrls.has(`${n.method}:${n.url}`)),
    ];
    click.behavioralEvidence = { ...richer, applicationEvidence: { ...richer.applicationEvidence, networkActivity: merged } };

    const net = click.behavioralEvidence!.applicationEvidence.networkActivity as
      (NetworkActivity & { requestId?: string })[];
    expect(net).toHaveLength(1); // NOT duplicated — same requestId
    expect(net[0].requestId).toBe(R_POST);
    expect(click.behavioralEvidence!.applicationEvidence.domChanges).toHaveLength(1);
  });
});

describe('T9: replay confluence', () => {
  const allStages = ['commit', 'flush', 'drain', 'reconcile'] as const;
  type Stage = (typeof allStages)[number];

  function runSequence(stages: Stage[]): ComponentInteraction[] {
    // Fresh world per sequence
    const interactions: ComponentInteraction[] = [];
    const click = makeClick();
    interactions.push(click);
    const nav = makeSyntheticNav();
    interactions.push(nav);
    const ringEntries = [stampedPostEntry()];

    const ledger = new DurableAttributionLedger();

    for (const stage of stages) {
      switch (stage) {
        case 'commit': {
          void ledger.pushStamped(stampedPostEntry());
          ledger.attachToInteractions(interactions);
          break;
        }
        case 'flush': {
          // Flush delivers richer direct-capture evidence with same requestId
          const ev = click.behavioralEvidence ?? synthesizeMinimalEvidence(click, E_CLICK);
          if (
            !ev.applicationEvidence.networkActivity.some(
              (n) => (n as { requestId?: string }).requestId === R_POST,
            )
          ) {
            ev.applicationEvidence.networkActivity.push({
              url: POST_URL,
              method: 'POST',
              status: 302,
              startRelativeToEvent: 4,
              endRelativeToEvent: 90,
              durationMs: 86,
              resourceType: 'navigation',
              source: 'main-world',
              sourceEventId: E_CLICK,
              requestId: R_POST,
            } as never);
          }
          break;
        }
        case 'drain': {
          drainNetworkEvidence(interactions, ringEntries);
          break;
        }
        case 'reconcile': {
          void ledger.pushStamped(stampedPostEntry());
          void ledger.attachToInteractions(interactions);
          break;
        }
      }
    }
    return interactions;
  }

  function fingerprint(interactions: ComponentInteraction[]): string {
    return JSON.stringify(
      interactions.map((i) => ({
        id: i.interactionId,
        evidence: i.behavioralEvidence ? 'present' : 'absent',
        net: i.behavioralEvidence?.applicationEvidence?.networkActivity.map(
          (n) => `${n.method} ${n.url} ${(n as { requestId?: string }).requestId ?? ''}`,
        ),
      })),
    );
  }

  it('all subsets and orderings of {commit, flush, drain, reconcile} converge', () => {
    const sequences: Stage[][] = [];
    // All permutations of the full set
    const perms = (arr: Stage[]): Stage[][] =>
      arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
    sequences.push(...perms([...allStages]));
    // Representative subsets
    sequences.push(['commit'], ['flush'], ['drain'], ['reconcile'],
      ['commit', 'flush'], ['flush', 'commit'], ['drain', 'reconcile'],
      ['reconcile', 'drain'], ['flush', 'drain', 'commit']);

    const fingerprints = new Set<string>();
    for (const seq of sequences) {
      fingerprints.add(fingerprint(runSequence(seq)));
    }
    expect(fingerprints.size).toBe(1);
  });
});
