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
