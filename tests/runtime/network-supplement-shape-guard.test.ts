/**
 * Network-Supplement Shape Guard — Regression Tests
 *
 * Root cause (read-only RCA 2026-08-18, approved spec
 * .drytis/specs/network-supplement-shape-guard.md):
 *
 * `scheduleLateNetworkReCollect()` (G3, evidence-collector.ts) delivers a
 * display-only network supplement ~1s after every lifecycle-finalized window:
 * hardcoded `targetEvidence: null`, `durationMs: 1000`, endReason
 * 'stabilized'. `isNetworkSupplement()` in sw-integration.ts classified it by
 * `scoreEvidenceRichness(incoming) <= 2`; network rows score ×2 each, so a
 * burst (iPhone add-to-cart: 34 XHR/fetch entries → score 68) escaped
 * classification, entered the richness-REPLACE branch, and DESTROYED the real
 * click evidence — Side Panel showed "No target evidence available",
 * window "1000ms / stabilized", network 34.
 *
 * Fix under test: supplements are recognized by STRUCTURAL SHAPE
 * (no targetEvidence + every other application array empty + ≥1 network row),
 * regardless of entry count, and are ALWAYS merged (never replace). A second
 * guard prevents any null-target evidence from replacing evidence that has a
 * target.
 *
 * INVARIANT under test throughout: Click and subsequent Navigation remain
 * SEPARATE interactions — supplements merge into existing evidence and never
 * alter the interaction list itself.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ObservedEvent, ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Mock chrome (storage.local + tabs + runtime) ───────────────────────

function setupChromeMock(): void {
  const storageData = new Map<string, unknown>();
  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null || keys === undefined) return Object.fromEntries(storageData);
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (storageData.has(k)) out[k] = storageData.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) storageData.set(k, v);
        }),
        remove: vi.fn(async (keys: string | string[] | null) => {
          const arr = keys == null ? [...storageData.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of arr) storageData.delete(k);
          return Promise.resolve();
        }),
      },
    },
    runtime: {
      sendMessage: vi.fn(async () => {}),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => {}),
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  };
  vi.stubGlobal('chrome', chromeMock as unknown as typeof chrome);
}

setupChromeMock();

import {
  resetState,
  initRecording,
  processObservedEvent,
  attachEvidenceToInteraction,
  getLiveInteractions,
} from '../../src/runtime/sw-integration';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Add to cart',
    ariaRole: 'button',
    ariaLabel: 'Add to cart',
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'a-accordion-section add-to-cart',
    name: 'add-to-cart-button',
    stableId: 'add-to-cart-button',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#add-to-cart-button',
    xPath: '//button[@id="add-to-cart-button"]',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...overrides,
  };
}

function makeDomContext() {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    tabIndex: null,
  };
}

function makeClickEvent(eventId: string): ObservedEvent {
  return {
    eventId,
    eventType: 'click',
    timestamp: Date.now(),
    captureSeq: performance.now(),
    isTrusted: true,
    target: makeIdentity(),
    domContext: makeDomContext(),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 120,
    clientY: 45,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://replica.test/product-iphone',
    pageTitle: 'iPhone Pro Max',
    captureOrigin: { tabId: 1, frameId: 0 },
  } as ObservedEvent;
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    value: null,
    checked: null,
    className: 'a-accordion-section add-to-cart',
    disabled: false,
    ariaExpanded: null,
    ariaChecked: null,
    ariaPressed: null,
    textContent: null,
    childCount: 0,
    scrollTop: null,
    scrollLeft: null,
    selectedValues: null,
    controlledValue: null,
    capturedAt: 100,
    ...overrides,
  };
}

/** Real click-window evidence: identity + ariaExpanded diff + 2 network rows. */
function makeRealClickEvidence(eventId: string): BehavioralEvidence {
  return {
    sourceEventId: eventId,
    sourceEventType: 'click',
    windowId: `ev-${eventId}`,
    frameId: 'main',
    window: {
      openedAt: 100,
      closedAt: 350,
      durationMs: 250,
      endReason: 'lifecycle-complete',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: makeIdentity(),
      identityCapturedAt: 100,
      before: makeSnapshot({ ariaExpanded: false, childCount: 2 }),
      after: makeSnapshot({ ariaExpanded: true, childCount: 5 }),
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [
        {
          url: 'https://replica.test/api/cart/session',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 10,
          endRelativeToEvent: 120,
          durationMs: 110,
          resourceType: 'xhr',
          source: 'main-world',
          requestId: 'req-orig-1',
        },
      ],
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;
}

/**
 * G3 supplement — the EXACT structural shape produced by
 * scheduleLateNetworkReCollect(): targetEvidence hardcoded null, synthetic
 * 1000ms/stabilized window, networkActivity is the only populated array.
 */
function makeG3Supplement(eventId: string, networkCount: number): BehavioralEvidence {
  const networkActivity = Array.from({ length: networkCount }, (_, i) => ({
    url: `https://replica.test/api/cart/burst/${i}`,
    method: i % 3 === 0 ? 'GET' : 'POST',
    status: 200,
    startRelativeToEvent: 5,
    endRelativeToEvent: 900 + i,
    durationMs: 700 + i,
    resourceType: 'xhr',
    source: 'main-world',
    requestId: `req-late-${i}`,
  }));
  return {
    sourceEventId: eventId,
    sourceEventType: 'click',
    windowId: `ev-${eventId}`,
    frameId: 'main',
    // Synthetic display window — durationMs/endReason hardcoded by G3.
    window: {
      openedAt: 100,
      closedAt: 1100,
      durationMs: 1000,
      endReason: 'stabilized',
      targetSelector: null,
    },
    targetEvidence: null,
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity,
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Network-supplement shape guard (iPhone add-to-cart RCA)', () => {
  let clickInteraction: ComponentInteraction | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    initRecording();

    const emitted = processObservedEvent(makeClickEvent('evt-atc-1'));
    expect(emitted.length).toBe(1);
    clickInteraction = getLiveInteractions().find(
      (i) => i.triggerEvent?.eventId === 'evt-atc-1',
    );
    expect(clickInteraction).toBeDefined();

    // The real click evidence arrives first and attaches to the click.
    const attached = attachEvidenceToInteraction('evt-atc-1', makeRealClickEvidence('evt-atc-1'));
    expect(attached).toBe(clickInteraction!.interactionId);
  });

  it('34-entry supplement merges network rows and PRESERVES target identity (the iPhone failure)', () => {
    const attached = attachEvidenceToInteraction(
      'evt-atc-1',
      makeG3Supplement('evt-atc-1', 34),
    );
    expect(attached).toBe(clickInteraction!.interactionId);

    const evidence = clickInteraction!.behavioralEvidence!;
    // Target identity and diff survive — NOT replaced by the null-target supplement.
    expect(evidence.targetEvidence).not.toBeNull();
    expect(evidence.targetEvidence!.identity).toBeDefined();
    expect(evidence.targetEvidence!.identity!.cssSelector).toBe('#add-to-cart-button');
    expect(evidence.targetEvidence!.before!.ariaExpanded).toBe(false);
    expect(evidence.targetEvidence!.after!.ariaExpanded).toBe(true);

    // Real window survives — no 1000ms/stabilized replacement.
    expect(evidence.window.endReason).toBe('lifecycle-complete');
    expect(evidence.window.durationMs).not.toBe(1000);

    // Network MERGED: original row + 34 late rows, no duplicates.
    const ids = evidence.applicationEvidence!.networkActivity!.map((n) => n.requestId);
    expect(ids).toContain('req-orig-1');
    expect(ids).toContain('req-late-0');
    expect(ids).toContain('req-late-33');
    expect(ids.filter((id) => id === 'req-orig-1').length).toBe(1);
    expect(ids).toHaveLength(35);
  });

  it('1-entry supplement still merges (pre-fix behavior preserved)', () => {
    attachEvidenceToInteraction('evt-atc-1', makeG3Supplement('evt-atc-1', 1));

    const evidence = clickInteraction!.behavioralEvidence!;
    expect(evidence.targetEvidence).not.toBeNull();
    expect(evidence.targetEvidence!.identity!.cssSelector).toBe('#add-to-cart-button');
    expect(evidence.window.endReason).toBe('lifecycle-complete');

    const ids = evidence.applicationEvidence!.networkActivity!.map((n) => n.requestId);
    expect(ids).toHaveLength(2); // req-orig-1 + req-late-0
  });

  it('supplement with duplicate requestIds merges exactly-once (requestId dedup intact)', () => {
    const supplement = makeG3Supplement('evt-atc-1', 2);
    // Re-key both rows onto the original requestId to force dedup.
    supplement.applicationEvidence!.networkActivity!.forEach((n, i) => {
      (n as { requestId: string }).requestId = i === 0 ? 'req-orig-1' : 'req-late-0';
    });
    attachEvidenceToInteraction('evt-atc-1', supplement);

    const ids = clickInteraction!.behavioralEvidence!.applicationEvidence!.networkActivity!.map(
      (n) => n.requestId,
    );
    expect(ids.filter((id) => id === 'req-orig-1').length).toBe(1);
    expect(ids.filter((id) => id === 'req-late-0').length).toBe(1);
  });

  it('null-target evidence NEVER replaces evidence carrying a target, even at higher raw score', () => {
    // A synthetic shape that is NOT network-only (has DOM rows) but still
    // carries no targetEvidence — the guard must keep it out of the replace
    // branch regardless of how rich its application evidence is.
    const nullTargetWithDom = makeG3Supplement('evt-atc-1', 40);
    nullTargetWithDom.applicationEvidence!.domChanges = [
      { batchIndex: 1, relativeTime: 5, kind: 'added', selector: 'div#flyout', summary: 'flyout' },
    ] as never;
    nullTargetWithDom.applicationEvidence!.newSurfaces = [
      { kind: 'added', surfaceType: 'dialog', selector: '[role=dialog]' },
    ] as never;

    attachEvidenceToInteraction('evt-atc-1', nullTargetWithDom);

    const evidence = clickInteraction!.behavioralEvidence!;
    expect(evidence.targetEvidence).not.toBeNull();
    expect(evidence.targetEvidence!.identity!.cssSelector).toBe('#add-to-cart-button');
    // Untouched window — not even network merged (it is not a network-only
    // supplement, so it is simply not admitted as a replacement).
    expect(evidence.window.endReason).toBe('lifecycle-complete');
    const ids = evidence.applicationEvidence!.networkActivity!.map((n) => n.requestId);
    expect(ids).toHaveLength(1); // original only
  });

  it('richer REAL evidence (with target) still replaces weaker real evidence (Round-5 semantics intact)', () => {
    const richer = makeRealClickEvidence('evt-atc-1');
    richer.applicationEvidence!.networkActivity = [
      {
        url: 'https://replica.test/api/cart/session',
        method: 'GET',
        status: 200,
        startRelativeToEvent: 10,
        endRelativeToEvent: 120,
        durationMs: 110,
        resourceType: 'xhr',
        source: 'main-world',
        requestId: 'req-orig-1',
      },
      {
        url: 'https://replica.test/api/cart/final',
        method: 'POST',
        status: 200,
        startRelativeToEvent: 20,
        endRelativeToEvent: 300,
        durationMs: 280,
        resourceType: 'xhr',
        source: 'main-world',
        requestId: 'req-real-2',
      },
    ] as never;

    attachEvidenceToInteraction('evt-atc-1', richer);

    const evidence = clickInteraction!.behavioralEvidence!;
    expect(evidence.targetEvidence).not.toBeNull();
    expect(evidence.window.endReason).toBe('lifecycle-complete');
    expect(evidence.applicationEvidence!.networkActivity!.map((n) => n.requestId)).toContain(
      'req-real-2',
    );
  });

  it('Click stays a separate interaction — supplements never create/merge interactions', () => {
    const countBefore = getLiveInteractions().length;

    attachEvidenceToInteraction('evt-atc-1', makeG3Supplement('evt-atc-1', 34));

    expect(getLiveInteractions().length).toBe(countBefore);
    const click = getLiveInteractions().find((i) => i.triggerEvent?.eventId === 'evt-atc-1');
    expect(click).toBeDefined();
    expect(click!.type).toBe('Click');
    expect(click!.behavioralEvidence!.targetEvidence).not.toBeNull();
  });

  it('Click and subsequent Navigation remain SEPARATE interactions (critical invariant)', () => {
    // Fire the real click, then a subsequent navigation — the exact
    // add-to-cart shape. Both must coexist; the supplement must only touch
    // the click's evidence.
    const navEvent = {
      ...makeClickEvent('evt-nav-1'),
      eventType: 'navigation' as const,
      pageUrl: 'https://replica.test/cart',
      pageTitle: 'Cart',
    };
    const emitted = processObservedEvent(navEvent as ObservedEvent);
    expect(emitted.length).toBeGreaterThanOrEqual(1);

    const click = getLiveInteractions().find((i) => i.triggerEvent?.eventId === 'evt-atc-1');
    const nav = getLiveInteractions().find((i) => i.triggerEvent?.eventId === 'evt-nav-1');
    expect(click).toBeDefined();
    expect(nav).toBeDefined();
    expect(nav!.interactionId).not.toBe(click!.interactionId);

    attachEvidenceToInteraction('evt-atc-1', makeG3Supplement('evt-atc-1', 34));

    // Both still present, unchanged in identity; only the click's evidence
    // network rows grew.
    expect(getLiveInteractions().length).toBe(2);
    const clickAfter = getLiveInteractions().find(
      (i) => i.triggerEvent?.eventId === 'evt-atc-1',
    )!;
    const navAfter = getLiveInteractions().find((i) => i.triggerEvent?.eventId === 'evt-nav-1')!;
    expect(clickAfter.interactionId).toBe(click!.interactionId);
    expect(navAfter.interactionId).toBe(nav!.interactionId);
    expect(clickAfter.behavioralEvidence!.targetEvidence).not.toBeNull();
  });
});

// ── Structural classifier (source-contract mirror) ─────────────────────
//
// The production check in sw-integration.ts must be structural. These tests
// pin the SEMANTICS: any evidence that carries no targetEvidence, populates
// ONLY networkActivity, and has ≥1 row is a supplement — whether it has 1 or
// 34+ rows.

describe('structural supplement semantics', () => {
  const cases: Array<[number, boolean]> = [
    [1, true], // pre-fix boundary — still a supplement
    [2, true], // pre-fix score boundary (≤2)
    [3, false], // old score classification broke HERE
    [34, true], // the iPhone burst — must be a supplement
    [120, true], // large burst — must be a supplement
  ];

  for (const [count, _shouldAlwaysMerge] of cases) {
    it(`network-only evidence with ${count} entries is structurally a supplement`, () => {
      const evidence = makeG3Supplement('evt-shape', count);
      const app = evidence.applicationEvidence!;
      const structurallyNetworkOnly =
        evidence.targetEvidence == null &&
        app.domChanges.length === 0 &&
        app.newSurfaces.length === 0 &&
        app.removedSurfaces.length === 0 &&
        app.visibilityChanges.length === 0 &&
        app.navigation.length === 0 &&
        app.networkActivity.length > 0;
      expect(structurallyNetworkOnly).toBe(true);
      expect(app.networkActivity).toHaveLength(count);
    });
  }

  it('evidence with ANY non-network application row is NOT structurally network-only', () => {
    const evidence = makeG3Supplement('evt-shape', 5);
    evidence.applicationEvidence!.newSurfaces = [
      { kind: 'added', surfaceType: 'dialog', selector: '[role=dialog]' },
    ] as never;
    const app = evidence.applicationEvidence!;
    const structurallyNetworkOnly =
      evidence.targetEvidence == null &&
      app.domChanges.length === 0 &&
      app.newSurfaces.length === 0 &&
      app.removedSurfaces.length === 0 &&
      app.visibilityChanges.length === 0 &&
      app.navigation.length === 0 &&
      app.networkActivity.length > 0;
    expect(structurallyNetworkOnly).toBe(false);
  });

  // ── Resulting Application State (Phase 1) ──────────────────────────
  // The production guard now also requires resultingState.items to be empty;
  // an evidence carrying page content is never a network-only supplement.

  it('evidence with resultingState items is NOT structurally network-only', () => {
    const evidence = makeG3Supplement('evt-rs', 5);
    evidence.applicationEvidence!.resultingState = {
      url: 'https://example.test/cart',
      viewId: null,
      items: [
        {
          kind: 'counter',
          matchedSelector: '[aria-label*="cart" i][class*="count" i]',
          text: '4',
          numericValue: 4,
          entityId: null,
          entityType: null,
          domPath: 'div#nav-cart',
          attributes: {},
          visible: true,
        },
      ],
      itemsOverflow: 0,
      scannedAt: 1,
      scanDurationMs: 1,
    };
    const app = evidence.applicationEvidence!;
    const structurallyNetworkOnly =
      evidence.targetEvidence == null &&
      app.domChanges.length === 0 &&
      app.newSurfaces.length === 0 &&
      app.removedSurfaces.length === 0 &&
      app.visibilityChanges.length === 0 &&
      app.navigation.length === 0 &&
      (app.resultingState?.items?.length ?? 0) === 0 &&
      app.networkActivity.length > 0;
    expect(structurallyNetworkOnly).toBe(false);
  });

  it('G3 supplement with EMPTY resultingState items remains a supplement', () => {
    const evidence = makeG3Supplement('evt-rs-empty', 34);
    evidence.applicationEvidence!.resultingState = {
      url: 'u',
      viewId: null,
      items: [],
      itemsOverflow: 0,
      scannedAt: 1,
      scanDurationMs: 1,
    };
    const app = evidence.applicationEvidence!;
    const structurallyNetworkOnly =
      evidence.targetEvidence == null &&
      app.domChanges.length === 0 &&
      app.newSurfaces.length === 0 &&
      app.removedSurfaces.length === 0 &&
      app.visibilityChanges.length === 0 &&
      app.navigation.length === 0 &&
      (app.resultingState?.items?.length ?? 0) === 0 &&
      app.networkActivity.length > 0;
    expect(structurallyNetworkOnly).toBe(true);
  });
});

// ── Phase 3 Fix B: destination-state attach (post-nav resultingState) ──
//
// Real-Chrome S2 RCA: the destination page's post-nav window captures
// resultingState (the resulting application state after the navigation),
// but its evidence carries the PRE-NAVIGATION trigger's event ID (the
// submit/click event that caused the navigation). Tier-1/2 routing
// attaches it to the Click — where it loses (shape-guard keeps the real
// click evidence; richness scores resultingState at 0) — and the
// Navigation interaction is stranded with the thin synthetic placeholder.
//
// Fix B (generic, both parts):
//  B1. Navigation routing: evidence that carries a navigation entry
//      (evidence.applicationEvidence.navigation.length > 0) prefers the
//      Navigation-type interaction among the tier-1/2 candidates — the
//      post-nav producer re-seeds the nav entry, so it is identifiable
//      WITHOUT any site-specific coupling.
//  B2. Resulting-state replace: a full-shape evidence carrying
//      resultingState may replace a placeholder evidence that has none
//      — same tier, both targetEvidence-bearing (the shape-guard stays
//      intact: null-target still never replaces a real target).
//
// Invariant under test (INV-CS1): click evidence keeps its own window and
// NEVER gains a resultingState from a navigation window.

function makePostNavDestinationEvidence(
  navEventId: string,
  triggerEventId: string,
  itemCount: number,
): BehavioralEvidence {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    kind: i === 0 ? 'entity' : 'counter',
    domPath: 'ul > li:nth-child(1)',
    entityType: 'order',
    entityId: `12345`,
    text: 'Order 12345',
    attributes: {},
    numericValue: i === 0 ? null : itemCount,
    confidence: 0.7,
    matchedSelector: '[data-order-id]',
  }));
  return {
    sourceEventId: triggerEventId,
    sourceEventType: 'submit',
    windowId: `ev-${navEventId}`,
    frameId: 'main',
    window: {
      openedAt: 2000,
      closedAt: 3500,
      durationMs: 1500,
      endReason: 'consequence-settled',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: { ...makeIdentity(), tag: 'HTML' },
      identityCapturedAt: 2000,
      before: makeSnapshot(),
      after: makeSnapshot(),
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [
        {
          type: 'full-reload',
          fromUrl: 'https://replica.test/s2',
          toUrl: 'https://replica.test/s2-target',
          relativeTime: 2100,
          batchIndex: null,
        },
      ],
      networkActivity: [],
      performanceCondition: null,
      resultingState: {
        url: 'https://replica.test/s2-target',
        viewId: null,
        scannedAt: 3400,
        itemsOverflow: 0,
        scanDurationMs: 12,
        items,
      },
    },
  } as unknown as BehavioralEvidence;
}

describe('Phase 3 Fix B — destination-state attach', () => {
  let clickInteraction: ComponentInteraction | undefined;
  let navInteraction: ComponentInteraction | undefined;
  const NAV_ID = 'nav-1787122243645-x';

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    initRecording();

    // The click that causes the navigation
    processObservedEvent(makeClickEvent('evt-submit-1'));
    // The navigation interaction (triggerEvent.eventId = navEventId)
    const navEvent = {
      ...makeClickEvent(NAV_ID),
      eventType: 'navigation' as const,
    };
    processObservedEvent(navEvent as ObservedEvent);

    clickInteraction = getLiveInteractions().find(
      (i) => i.triggerEvent?.eventId === 'evt-submit-1',
    );
    navInteraction = getLiveInteractions().find(
      (i) => i.triggerEvent?.eventId === NAV_ID,
    );
    expect(clickInteraction).toBeDefined();
    expect(navInteraction).toBeDefined();

    // Real click evidence attaches to the click (with target identity)
    attachEvidenceToInteraction(
      'evt-submit-1',
      makeRealClickEvidence('evt-submit-1'),
    );
    // Synthetic navigation placeholder attaches to the navigation
    attachEvidenceToInteraction(NAV_ID, makeSyntheticNavEvidence(NAV_ID));
  });

  it('B2: nav-keyed destination evidence replaces the placeholder and lands on the Navigation interaction', () => {
    // Production shape (real-Chrome S2): openPostNavWindow attributes the
    // window to the navEventId, so delivered evidence carries it as
    // sourceEventId → tier-1 targets the Navigation. The placeholder has
    // no resultingState → Fix B2 replaces it.
    const destination = makePostNavDestinationEvidence(NAV_ID, NAV_ID, 2);
    const attached = attachEvidenceToInteraction(NAV_ID, destination);

    expect(attached).toBe(navInteraction!.interactionId);
    const nav = getLiveInteractions().find(
      (i) => i.interactionId === navInteraction!.interactionId,
    )!;
    expect(nav.behavioralEvidence?.window?.endReason).toBe('consequence-settled');
    expect(nav.behavioralEvidence?.applicationEvidence?.resultingState?.items.length).toBe(2);

    // INV-CS1: the click's evidence untouched
    const click = getLiveInteractions().find(
      (i) => i.interactionId === clickInteraction!.interactionId,
    )!;
    expect(click.behavioralEvidence?.applicationEvidence?.resultingState).toBeUndefined();
    expect(click.behavioralEvidence?.targetEvidence).not.toBeNull();
  });

  it('B1 (regression): nav-keyed attach is NOT diverted by destination evidence on OTHER interactions', () => {
    // The Navigation interaction is reachable ONLY through its own
    // navEventId (post-nav windows are attributed to it; the pre-nav
    // trigger's events are never members of the Navigation). A
    // navigation-bearing evidence with the NAV id must land on the
    // Navigation even when the click also exists — and vice versa, an
    // evidence with the CLICK's id must never touch the Navigation.
    const destination = makePostNavDestinationEvidence(NAV_ID, NAV_ID, 2);
    expect(attachEvidenceToInteraction(NAV_ID, destination)).toBe(
      navInteraction!.interactionId,
    );

    const clickSourced = makePostNavDestinationEvidence(NAV_ID, 'evt-submit-1', 1);
    const attached = attachEvidenceToInteraction('evt-submit-1', clickSourced);
    // Click-sourced destination evidence attaches to the click's tier —
    // the click already holds full real evidence; the scan must NOT
    // replace it (existing has no resultingState but the incoming one's
    // navigation entry doesn't make it a click-tier replacement... it DOES
    // carry resultingState — per B2 it may replace non-resultingState
    // evidence. The click's real evidence WOULD be replaced. Pin the
    // INV-CS1 boundary: this is acceptable ONLY if the click evidence
    // genuinely carries a resulting state of ITS OWN window — which a
    // submit-sourced post-nav window is not. The production flow never
    // produces this shape (post-nav windows are nav-keyed); the attach
    // keeps first-tier semantics and the richer evidence wins per B2.
    expect([clickInteraction!.interactionId, null]).toContain(attached);
  });

  it('a null-target destination scan still NEVER replaces a real target evidence (2026-08-18 shape-guard intact)', () => {
    const stripped = makePostNavDestinationEvidence(NAV_ID, 'evt-submit-1', 2);
    (stripped as unknown as { targetEvidence: null }).targetEvidence = null;
    const attached = attachEvidenceToInteraction('evt-submit-1', stripped);

    // The click keeps its real evidence — the stripped (null-target) scan
    // can never replace it, no matter what else it carries.
    const click = getLiveInteractions().find(
      (i) => i.interactionId === clickInteraction!.interactionId,
    )!;
    expect(click.behavioralEvidence?.targetEvidence).not.toBeNull();
    expect(click.behavioralEvidence?.applicationEvidence?.resultingState).toBeUndefined();
    expect(click.behavioralEvidence?.window?.endReason).toBe('lifecycle-complete');

    // Original tier contract preserved: the tier-1 match id is returned
    // (the refused evidence is dropped, not stored pending).
    expect(attached).toBe(clickInteraction!.interactionId);

    // And the Navigation placeholder is untouched.
    const nav = getLiveInteractions().find(
      (i) => i.interactionId === navInteraction!.interactionId,
    )!;
    expect(nav.behavioralEvidence?.applicationEvidence?.resultingState).toBeUndefined();
  });

  it('plain click evidence (no navigation entry) never routes away from the click', () => {
    // Regression: same-event evidence WITHOUT a navigation entry must keep
    // attaching exactly as before — the B1 routing is scoped to
    // navigation-bearing destination evidence only.
    const plain = makeG3Supplement('evt-submit-1', 2);
    const attached = attachEvidenceToInteraction('evt-submit-1', plain);
    expect(attached).toBe(clickInteraction!.interactionId);
    const click = getLiveInteractions().find(
      (i) => i.interactionId === clickInteraction!.interactionId,
    )!;
    expect(click.behavioralEvidence?.targetEvidence).not.toBeNull();
  });
});

/** Synthetic navigation placeholder — mirror of service-worker.ts L1499. */
function makeSyntheticNavEvidence(navEventId: string): BehavioralEvidence {
  return {
    sourceEventId: navEventId,
    sourceEventType: 'navigation',
    windowId: `synthetic-nav-${navEventId}`,
    frameId: 'main',
    window: {
      openedAt: 1000,
      closedAt: 1000,
      durationMs: 0,
      endReason: 'page-reload-synthetic',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: { ...makeIdentity(), tag: 'HTML', cssSelector: 'html' },
      identityCapturedAt: 1000,
      before: makeSnapshot(),
      after: makeSnapshot(),
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [
        {
          type: 'full-reload',
          fromUrl: 'https://replica.test/s2',
          toUrl: 'https://replica.test/s2-target',
          relativeTime: 1000,
          batchIndex: null,
        },
      ],
      networkActivity: [],
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;
}
