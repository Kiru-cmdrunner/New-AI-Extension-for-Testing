/**
 * Form-Submit E2E — integration shape of the m9-form-submit-validation flow
 *
 * Exercises the EXACT sequence the validation page drives in the browser:
 *   click #add-to-cart-button → form submits → pagehide finalizes the click
 *   window → navigation commits (synthetic nav) → ledger routing puts the
 *   document request on the CLICK, nav gets causedBy + no network → STOP.
 *
 * The production SW wiring is composed here (drain + ledger + pagehide rule
 * + richness replacement), not re-implemented.
 *
 * Spec: .drytis/specs/form-submit-evidence-recovery.md (integration checkbox)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type {
  BehavioralEvidence,
  NetworkActivity,
} from '../../src/shared/behavioral-evidence-types';
import { finalizeAtPagehide } from '../../src/tap/evidence-collector';
import { drainNetworkEvidence } from '../../src/background/network-drain';
import {
  DurableAttributionLedger,
  synthesizeMinimalEvidence,
} from '../../src/background/evidence-attribution';
import { StorageKeys } from '../../src/shared/types';

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

// ── Constants mirroring the validation page ────────────────────────────

const E_CLICK = 'evt-atc-click';
const NAV_EVENT = 'evt-nav-synth';
const REQ_ID = 'webreq-77';
// Domain-agnostic fixture host (6F-M1 follow-up micro-fix, 2026-08-23): the
// host part is arbitrary to every consumer in this test (no fetch, no host
// parse — the URL is compared against itself and used as a dedup key). It
// previously carried the environment's preview subdomain, which was
// environment identity in tracked source (DEFECT note, 2026-08-18). The
// m9 validation page itself keeps a relative action — this now matches it.
const CART_URL =
  'https://validation.local/public/m9-cart-landed.html?ASIN=B08KGRVW2S&quantity=1&submit.addToCart=1';

function emptyAppEvidence(): BehavioralEvidence['applicationEvidence'] {
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

function clickInteraction(): ComponentInteraction {
  return {
    interactionId: 'int-atc',
    type: 'Click' as never,
    trigger: {
      kind: 'element',
      tagName: 'BUTTON',
      id: 'add-to-cart-button',
      accessibleName: 'Add to cart',
      attributes: { type: 'submit' },
    } as never,
    triggerEvent: { eventId: E_CLICK, eventType: 'click' } as never,
    memberEvents: [{ eventId: E_CLICK, eventType: 'click' }] as never,
    startTime: 1_000,
    endTime: 1_090,
    endState: 'completed' as never,
    metadata: { targetName: 'Add to cart' },
  };
}

function navInteraction(causedBy?: string): ComponentInteraction {
  return {
    interactionId: 'int-nav',
    type: 'Navigation' as never,
    trigger: { kind: 'url', url: CART_URL } as never,
    triggerEvent: { eventId: NAV_EVENT, eventType: 'navigation' } as never,
    memberEvents: [],
    startTime: 1_090,
    endTime: 1_120,
    endState: 'completed' as never,
    metadata: {},
    behavioralEvidence: {
      sourceEventId: NAV_EVENT,
      sourceEventType: 'navigation',
      windowId: `synthetic-nav-${NAV_EVENT}`,
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
      applicationEvidence: emptyAppEvidence(),
      ...({ causedByInteractionId: causedBy } as Record<string, unknown>),
    } as never,
  };
}

beforeEach(() => {
  storageData.clear();
  vi.clearAllMocks();
});

describe('m9-form-submit-validation flow (integration)', () => {
  it('the durable key matches the shared enum (no drift)', () => {
    expect(StorageKeys.UNATTACHED_REQUESTS).toBe('cmdrunner_unattached_requests');
  });

  it('full sequence: pagehide finalize → commit routing → stop drain → click owns the request, nav records the link', async () => {
    // ── 1. Click happens; window opens; form submits; pagehide at +90ms ──
    const clickWin = {
      windowId: `ev-${E_CLICK}`,
      sourceEventId: E_CLICK,
      sourceEventType: 'click',
      openedAt: 1_000,
      isClosed: false,
      isLifecycleBound: false, // LIFECYCLE_BOUND still in flight
      isNavigationWindow: false,
      navEvents: [],
    };
    const decision = finalizeAtPagehide(clickWin as never, 1_090);
    expect(decision.finalize).toBe(true);
    expect(decision.endReason).toBe('page-reload');

    // ── 2. SW captured the document request, stamped at capture (durable) ──
    const ledger = new DurableAttributionLedger();
    await ledger.pushStamped({
      url: CART_URL,
      method: 'GET', // validation page uses GET; production path is POST
      status: 200,
      requestId: REQ_ID,
      sourceEventId: E_CLICK,
      requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
      documentRequest: true,
      mainFrame: true,
    });
    expect(storageData.has(StorageKeys.UNATTACHED_REQUESTS)).toBe(true);

    // ── 3. pagehide evidence delivered (or lost) — click may have evidence ──
    const click = clickInteraction();
    const nav = navInteraction();

    // ── 4. Commit-time routing (service-worker shape): owner exists ──
    const live = [click, nav];
    const ownerExists = live.some(
      (i) =>
        i.triggerEvent?.eventId === E_CLICK ||
        i.memberEvents?.some((e) => e.eventId === E_CLICK),
    );
    expect(ownerExists).toBe(true);
    const routed = await ledger.attachStampedActivity(
      {
        url: CART_URL,
        method: 'GET',
        status: 200,
        requestId: REQ_ID,
        sourceEventId: E_CLICK,
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
        documentRequest: true,
        mainFrame: true,
      },
      live,
    );
    expect(routed).toBe(true); // → persistLiveInteractions() in production

    // ── 5. Assertions: click owns the request; nav is clean ──
    const clickNet = click.behavioralEvidence!.applicationEvidence
      .networkActivity as (NetworkActivity & { requestId?: string })[];
    expect(clickNet).toHaveLength(1);
    expect(clickNet[0].requestId).toBe(REQ_ID);
    expect(clickNet[0].url).toBe(CART_URL);
    expect(clickNet[0].requestBody).toEqual({ ASIN: 'B08KGRVW2S', quantity: '1' });
    expect(click.behavioralEvidence!.window.endReason).toBe('sw-recovered-form-submit');
    expect(nav.behavioralEvidence!.applicationEvidence.networkActivity).toHaveLength(0);

    // ── 6. STOP: ring drain backstop — must NOT double-attach ──
    const ringEntries = [
      {
        url: CART_URL,
        method: 'GET',
        status: 200,
        requestId: REQ_ID,
        sourceEventId: E_CLICK,
        requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
        documentRequest: true,
      },
    ];
    const { mergedRequestIds } = drainNetworkEvidence(live, ringEntries);
    expect(mergedRequestIds).toHaveLength(0); // exactly-once held
    expect(click.behavioralEvidence!.applicationEvidence.networkActivity).toHaveLength(1);

    // ── 7. STOP: ledger drain + session cleanup ──
    expect(ledger.attachToInteractions(live)).toBe(0); // nothing left
    await ledger.clearAll();
    expect(storageData.has(StorageKeys.UNATTACHED_REQUESTS)).toBe(false);
  });

  it('fallback: unresolved stamp lands on the synthetic nav (unchanged legacy behavior)', () => {
    const ledger = new DurableAttributionLedger();
    const nav = navInteraction();

    // Simulate the click interaction never emitted (filtered component):
    const live = [nav];
    const ownerExists = live.some(
      (i) =>
        i.triggerEvent?.eventId === E_CLICK ||
        i.memberEvents?.some((e) => e.eventId === E_CLICK),
    );
    expect(ownerExists).toBe(false);

    // Service-worker shape: unresolved → forSyntheticNav carries the entry.
    const recovered: NetworkActivity[] = [
      {
        url: CART_URL,
        method: 'GET',
        status: 200,
        startRelativeToEvent: 0,
        endRelativeToEvent: null,
        durationMs: null,
        resourceType: 'unknown',
        source: 'webrequest',
        sourceEventId: E_CLICK,
      },
    ];
    const forSyntheticNav = recovered.filter((a) => {
      if (!a.sourceEventId) return true; // unstamped → nav keeps
      return !ownerExists; // unresolved stamp → nav keeps (old behavior)
    });
    nav.behavioralEvidence!.applicationEvidence.networkActivity.push(...forSyntheticNav);
    expect(nav.behavioralEvidence!.applicationEvidence.networkActivity).toHaveLength(1);
    // And the ledger attach found nothing to join:
    expect(ledger.attachToInteractions(live)).toBe(0);
  });

  it('richness: a later richer pagehide-flush evidence replaces thin evidence and preserves the request once', () => {
    const click = clickInteraction();
    synthesizeMinimalEvidence(click, E_CLICK);
    click.behavioralEvidence!.applicationEvidence.networkActivity.push({
      url: CART_URL,
      method: 'GET',
      status: 200,
      startRelativeToEvent: 0,
      endRelativeToEvent: null,
      durationMs: null,
      resourceType: 'navigation',
      source: 'webrequest',
      requestBody: { ASIN: 'B08KGRVW2S', quantity: '1' },
      sourceEventId: E_CLICK,
      requestId: REQ_ID,
    } as never);

    // Flush from the next page: richer (real DOM diff + same requestId)
    const richerNet: (NetworkActivity & { requestId?: string })[] = [
      {
        url: CART_URL,
        method: 'GET',
        status: 200,
        startRelativeToEvent: 4,
        endRelativeToEvent: 80,
        durationMs: 76,
        resourceType: 'navigation',
        source: 'main-world',
        sourceEventId: E_CLICK,
        requestId: REQ_ID,
      } as never,
    ];
    const preserved = click.behavioralEvidence!.applicationEvidence.networkActivity;
    const keys = new Set(richerNet.map((n) => `${n.method}:${n.url}`));
    const merged = [
      ...preserved,
      ...richerNet.filter((n) => !keys.has(`${n.method}:${n.url}`)),
    ];

    expect(merged).toHaveLength(1);
    expect((merged[0] as { requestId?: string }).requestId).toBe(REQ_ID);
    expect(merged[0].source).toBe('webrequest'); // richer rows don't displace
  });

  it('the validation pages exist in public/ and are excluded from the ZIP by the packer rule', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    expect(fs.existsSync(path.resolve('public/m9-form-submit-validation.html'))).toBe(true);
    expect(fs.existsSync(path.resolve('public/m9-cart-landed.html'))).toBe(true);
    // Root-HTML exclusion: the canonical packer drops root-level html
    const packer = fs.readFileSync(path.resolve('scripts/pack-zip.mjs'), 'utf8');
    expect(packer).toContain("ext == '.html' and dirpath == dist_dir");
  });
});
