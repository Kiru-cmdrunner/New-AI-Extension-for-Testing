/**
 * Post-Nav Evidence Attribution — Integration Tests (AC5–AC8)
 *
 * From .drytis/specs/post-nav-evidence-capture.md. Verifies the SW-side
 * attach semantics for destination-page evidence delivered under the NAV pull
 * model: placeholder replacement via richness, network preservation via
 * requestId dedup, late-delivery retention, and the Add-to-cart/INV-5 routing
 * invariants.
 *
 * Uses the real sw-integration runtime: interactions are created through
 * processObservedEvent (the same path the SW's navEvent takes), so the
 * triggerEvent.eventId correlation is exercised end-to-end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ObservedEvent, ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Mock chrome (storage.local + tabs + runtime + webNavigation) ───────

const storageData = new Map<string, unknown>();

function setupChromeMock(): void {
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
        remove: vi.fn((keys: string | string[] | null) => {
          if (keys === null || keys === undefined) {
            storageData.clear();
            return Promise.resolve();
          }
          for (const k of Array.isArray(keys) ? keys : [keys]) storageData.delete(k);
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
    webNavigation: { onCommitted: { addListener: vi.fn() } },
    webRequest: {
      onBeforeRequest: { addListener: vi.fn() },
      onCompleted: { addListener: vi.fn() },
      onErrorOccurred: { addListener: vi.fn() },
    },
  };
  vi.stubGlobal('chrome', chromeMock as unknown as typeof chrome);
}

setupChromeMock();

import {
  resetState,
  initRecording,
  processObservedEvent,
  attachEvidenceToInteraction,
  storePendingEvidence,
  getLiveInteractions,
} from '../../src/runtime/sw-integration';
import {
  DurableAttributionLedger,
  type StampedRequest,
} from '../../src/background/evidence-attribution';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeIdentity(): ElementIdentity {
  return {
    accessibleName: 'Navigation to https://b.example/',
    ariaRole: 'document',
    ariaLabel: 'Navigation to https://b.example/',
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'HTML',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'html',
    xPath: '/html',
    inIframe: false,
    shadowDom: false,
    href: 'https://b.example/',
    inputType: null,
    elementId: '',
  };
}

function makeNavEvent(navEventId: string): ObservedEvent {
  return {
    eventId: navEventId,
    eventType: 'navigation' as ObservedEvent['eventType'],
    timestamp: Date.now(),
    captureSeq: performance.now(),
    isTrusted: true,
    target: makeIdentity(),
    domContext: {
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
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://b.example/',
    pageTitle: 'Results',
    captureOrigin: { tabId: 1, frameId: 0 },
  } as ObservedEvent;
}

function makeClickEvent(eventId: string): ObservedEvent {
  const clickIdentity: ElementIdentity = {
    ...makeIdentity(),
    accessibleName: 'Add to cart',
    ariaRole: 'button',
    tag: 'BUTTON',
    cssSelector: '#add-to-cart-button',
    xPath: '//button[@id="add-to-cart-button"]',
    href: null,
  };
  return {
    ...makeNavEvent(eventId),
    eventType: 'click' as ObservedEvent['eventType'],
    target: clickIdentity,
    pageUrl: 'https://a.example/',
    pageTitle: 'Form',
    clientX: 120,
    clientY: 45,
  } as ObservedEvent;
}

function makePlaceholderEvidence(navEventId: string): BehavioralEvidence {
  return {
    sourceEventId: navEventId,
    sourceEventType: 'navigation',
    windowId: `synthetic-nav-${navEventId}`,
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: 'page-reload-synthetic',
      stabilityTrace: [],
    },
    targetEvidence: null,
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [{ type: 'full-reload', fromUrl: 'https://a.example/', toUrl: 'https://b.example/', relativeTime: 0, batchIndex: null }],
      networkActivity: [
        {
          url: 'https://b.example/data',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: null,
          durationMs: null,
          resourceType: 'unknown',
          source: 'webrequest',
          requestId: 'req-dest-1',
        },
      ],
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: false,
        longestBatchMs: 0,
        totalBatches: 0,
      },
    },
  } as unknown as BehavioralEvidence;
}

function makeRichNavEvidence(navEventId: string): BehavioralEvidence {
  return {
    sourceEventId: navEventId,
    sourceEventType: 'navigation',
    windowId: `ev-${navEventId}`,
    frameId: 'main',
    window: {
      openedAt: 100,
      closedAt: 3100,
      durationMs: 3000,
      endReason: 'max-duration',
      stabilityTrace: [],
    },
    targetEvidence: null,
    applicationEvidence: {
      domChanges: [
        { batchIndex: 1, relativeTime: 10, kind: 'added', selector: 'div#results', summary: 'results grid' },
        { batchIndex: 2, relativeTime: 50, kind: 'added', selector: 'div#results div.s-result-item', summary: 'result item' },
      ] as never,
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [{ kind: 'added', surfaceType: 'dialog', selector: '[role=dialog]' } as never],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [{ type: 'form_submit', fromUrl: 'https://a.example/', toUrl: 'https://b.example/', relativeTime: 0, batchIndex: null }],
      networkActivity: [
        {
          url: 'https://b.example/data',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 0,
          endRelativeToEvent: null,
          durationMs: null,
          resourceType: 'unknown',
          source: 'webrequest',
          requestId: 'req-dest-1', // same requestId as the placeholder row
        },
        {
          url: 'https://b.example/lazy-widgets',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 5,
          endRelativeToEvent: null,
          durationMs: null,
          resourceType: 'unknown',
          source: 'webrequest',
          requestId: 'req-dest-2', // NEW request the CS window saw
        },
      ],
      performanceCondition: {
        mainThreadBlocked: true,
        highChurnMode: false,
        longestBatchMs: 42,
        totalBatches: 9,
      },
    },
  } as unknown as BehavioralEvidence;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('post-nav evidence attribution (AC5–AC8)', () => {
  let navInteraction: ComponentInteraction | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    initRecording();
    const emitted = processObservedEvent(makeNavEvent('nav-1'));
    expect(emitted.length).toBe(1);
    navInteraction = getLiveInteractions().find((i) => i.triggerEvent?.eventId === 'nav-1');
    expect(navInteraction).toBeDefined();
  });

  it('AC5: rich destination evidence replaces the placeholder; network preserved via requestId dedup', () => {
    const attachedId = attachEvidenceToInteraction('nav-1', makePlaceholderEvidence('nav-1'));
    expect(attachedId).toBe(navInteraction!.interactionId);

    const attachedId2 = attachEvidenceToInteraction('nav-1', makeRichNavEvidence('nav-1'));
    expect(attachedId2).toBe(navInteraction!.interactionId);

    const evidence = navInteraction!.behavioralEvidence!;
    expect(evidence.windowId).toBe('ev-nav-1'); // replaced, not merged-into
    expect(evidence.applicationEvidence!.domChanges!.length).toBe(2);
    expect(evidence.applicationEvidence!.newSurfaces!.length).toBe(1);
    expect(evidence.applicationEvidence!.performanceCondition!.totalBatches).toBe(9);

    // Network: placeholder row req-dest-1 preserved (dedup keeps first), rich adds req-dest-2
    const ids = evidence.applicationEvidence!.networkActivity!.map((n) => n.requestId);
    expect(ids).toContain('req-dest-1');
    expect(ids).toContain('req-dest-2');
    expect(ids.filter((id) => id === 'req-dest-1').length).toBe(1); // exactly-once
  });

  it('AC5b: replacement preserves navigation entries (no duplication)', () => {
    attachEvidenceToInteraction('nav-1', makePlaceholderEvidence('nav-1'));
    attachEvidenceToInteraction('nav-1', makeRichNavEvidence('nav-1'));
    const navigation = navInteraction!.behavioralEvidence!.applicationEvidence!.navigation!;
    expect(navigation.length).toBe(1);
    expect(navigation[0].type).toBe('form_submit');
  });

  it('AC8: stamped POST still routes to the click, not the nav (INV-5)', async () => {
    const clickIntBefore = getLiveInteractions().length;
    const emitted = processObservedEvent(makeClickEvent('evt-click-1'));
    expect(emitted.length).toBe(1);
    expect(getLiveInteractions().length).toBe(clickIntBefore + 1);
    const clickInt = getLiveInteractions().find((i) => i.triggerEvent?.eventId === 'evt-click-1');
    expect(clickInt).toBeDefined();

    attachEvidenceToInteraction('nav-1', makePlaceholderEvidence('nav-1'));

    const ledger = new DurableAttributionLedger();
    const stamped: StampedRequest = {
      url: 'https://www.amazon.in/cart/add-to-cart',
      method: 'POST',
      status: 200,
      requestId: 'req-cart-1',
      sourceEventId: 'evt-click-1',
      requestBody: { ASIN: 'B0FFF9VPMN', quantity: '1' },
      mainFrame: true,
      documentRequest: true,
      captureOrigin: { tabId: 1, frameId: 0 },
    };
    const attached = await ledger.attachStampedActivity(stamped, getLiveInteractions());
    expect(attached).toBe(true);
    const clickNetwork = clickInt!.behavioralEvidence?.applicationEvidence?.networkActivity ?? [];
    expect(clickNetwork.length).toBe(1);
    expect(clickNetwork[0].requestId).toBe('req-cart-1');

    // Rich destination evidence on the nav replaces placeholder but NEVER
    // receives the stamped row
    attachEvidenceToInteraction('nav-1', makeRichNavEvidence('nav-1'));
    const navNetwork = navInteraction!.behavioralEvidence!.applicationEvidence!.networkActivity!;
    expect(navNetwork.some((n) => n.requestId === 'req-cart-1')).toBe(false);
  });

  it('AC7: late delivery after stop does not attach anywhere', () => {
    attachEvidenceToInteraction('nav-1', makePlaceholderEvidence('nav-1'));
    resetState(); // session stopped — interactions cleared
    const attached = attachEvidenceToInteraction('nav-1', makeRichNavEvidence('nav-1'));
    expect(attached).toBeNull();
  });

  it('AC7b: unmatched evidence goes to the pending store, not onto another interaction', () => {
    const rich = makeRichNavEvidence('nav-different');
    const attached = attachEvidenceToInteraction('nav-different', rich);
    expect(attached).toBeNull();
    storePendingEvidence(rich); // what handleBehavioralEvidence does when unmatched
    expect(navInteraction!.behavioralEvidence).toBeUndefined(); // untouched
  });
});
