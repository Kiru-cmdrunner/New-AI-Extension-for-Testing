/**
 * B7-P4 provenance-regression amendment — C-1/C-2 capture & attach pins.
 *
 * C-1: the evidence collector must record the DOM-observer global batch
 * counter for click-family WINDOW_OPEN events at observation time — even
 * when the window is never opened (companion suppression) or is silently
 * closed (consumed by an in-flight hover lifecycle). The lifecycle
 * synthetic window (`finalizeWithoutWindow`) then stamps
 * `window.openedBatch` from that recorded value. No timing heuristic: the
 * ordinal is read in the same synchronous capture-phase stack the window
 * path already reads it from.
 *
 * C-2: attach replacement paths (richness replace, resulting-state replace)
 * must carry over the existing `window.openedBatch` when the incoming
 * evidence's window lacks it — an attach race can never strip the boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ObservedEvent } from '../../src/shared/component-types';

// ── Mock chrome (sw-integration persists via chrome.storage) ──────────
function setupChromeMock(): void {
  const storageData = new Map<string, unknown>();
  const evidence: BehavioralEvidence[] = [];
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
      // EvidenceCollector.deliverEvidence posts BEHAVIORAL_EVIDENCE here —
      // that is the C-1 test's capture point (deep-cloned, like the SW
      // side receives over the wire).
      sendMessage: vi.fn((msg: { type?: string; payload?: BehavioralEvidence }) => {
        if (msg?.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
          evidence.push(JSON.parse(JSON.stringify(msg.payload)));
        }
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async () => {}),
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
  };
  vi.stubGlobal('chrome', chromeMock as unknown as typeof chrome);
  (globalThis as { __evidence?: BehavioralEvidence[] }).__evidence = evidence;
}
setupChromeMock();

import {
  resetState,
  initRecording,
  processObservedEvent,
  attachEvidenceToInteraction,
  getLiveInteractions,
} from '../../src/runtime/sw-integration';

// ── Shared fixture: a collector harness driving REAL EvidenceCollector ──
//
// The collector is constructed with a fake DOM observer whose batch counter
// we control (the P4 delivery pins already exercise this seam). jsdom
// cannot run MutationObserver batches deterministically, so no real
// observation happens — we assert only on ordinals and window shapes.

type Delivered = BehavioralEvidence[];

/** The chrome-mock capture point (see setupChromeMock). */
function deliveredEvidence(): BehavioralEvidence[] {
  return (globalThis as { __evidence?: BehavioralEvidence[] }).__evidence ?? [];
}

import { EvidenceCollector } from '../../src/tap/evidence-collector';

class FakeDomObserver {
  counter = 0;
  refcount = 0;
  start(): number { this.refcount++; return 0; }
  stop(): void { if (this.refcount > 0) this.refcount--; }
  getBatchCounter(): number { return this.counter; }
  clearAccumulated(): void {}
  getAccumulatedSummaries(): never[] { return []; }
  getSurfaceChanges(): never[] { return []; }
  getVisibilityChanges(): never[] { return []; }
  getPerformanceMetrics() { return { mainThreadBlocked: false, highChurnMode: false, longestBatchMs: 0, totalBatches: 0 }; }
  onMutationBatch(): void {}
}

function makeCollector(delivered: Delivered): { collector: EvidenceCollector; obs: FakeDomObserver } {
  const obs = new FakeDomObserver();
  const collector = new EvidenceCollector({
    onEvidence: (e: BehavioralEvidence) => delivered.push(JSON.parse(JSON.stringify(e))),
    domObserver: obs as never,
    targetStateCache: { peek: () => null, capture: () => null } as never,
  } as never);
  // deliverEvidence sends chrome.runtime messages; the constructor has no
  // delivery seam, so capture delivery via the chrome mock instead.
  (collector as unknown as { __delivered?: Delivered }).__delivered = delivered;
  return { collector, obs };
}

function clickEvent(eventId: string): ObservedEvent {
  return {
    eventId,
    eventType: 'click',
    timestamp: Date.now(),
    captureSeq: performance.now(),
    isTrusted: true,
    target: { tag: 'BUTTON', cssSelector: '#b', xPath: '//button', ariaRole: null, className: '', accessibleName: 'Buy', tabIndex: 0, ariaLabel: null, ariaLabelledBy: null, dataAutoId: null, autoId: null, stableId: 'b', id: 'b' } as never,
    domContext: { tabIndex: 0, pointerCursor: true, clickHandler: true, ancestorClasses: [] } as never,
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: 120, clientY: 45, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://shop.test/product', pageTitle: 'Shop',
    captureOrigin: { tabId: 1, frameId: 0 },
  } as unknown as ObservedEvent;
}

describe('C-1: click ordinals recorded at observation time and stamped on lifecycle synthetics', () => {
  let collector: EvidenceCollector;
  let obs: FakeDomObserver;
  // Delivered evidence is captured by the chrome mock (see setupChromeMock).

  beforeEach(() => {
    deliveredEvidence().length = 0; // reset the chrome-mock capture
    ({ collector, obs } = makeCollector([]));
    collector.start();
  });

  it('a click-family event records its ordinal BEFORE companion suppression can return early', () => {
    obs.counter = 3;
    const el = document.createElement('button');
    document.body.appendChild(el);
    // Warm the suppression window the way finalizeForInteraction does.
    collector['companionSuppressUntil'] = Date.now() + 60_000;
    collector.onAfterEvent(el, 'evt-click-1', 'click', '#b', null, clickEvent('evt-click-1'));
    // No evidence window was opened (suppressed)…
    expect(deliveredEvidence()).toHaveLength(0);
    // …but the ordinal WAS recorded, keyed by eventId.
    expect(collector['clickOrdinals']?.get('evt-click-1')).toBe(3);
  });

  it('finalizeWithoutWindow stamps window.openedBatch from the recorded ordinal', () => {
    obs.counter = 0;
    const el = document.createElement('a');
    document.body.appendChild(el);
    collector['companionSuppressUntil'] = Date.now() + 60_000;
    collector.onAfterEvent(el, 'evt-click-2', 'click', '#a', null, clickEvent('evt-click-2'));
    obs.counter = 4; // counter advanced past the click (its consequence batch)
    // The click lifecycle completes with no window — the consumer shape.
    // settleDelay 0 → doFinalize runs synchronously.
    collector['finalizeWithoutWindow']({
      eventIds: ['evt-click-2'],
      metadata: {},
      endState: 'completed',
    }, 0);
    const lc = deliveredEvidence().find((e) => e.windowId === 'lc-evt-click-2');
    expect(lc).toBeTruthy();
    expect(lc!.window.openedBatch).toBe(0); // the ordinal at CLICK TIME, not 4
  });

  it('windowed clicks keep the window-open stamp (no double authority: recorded value equals it)', () => {
    obs.counter = 7;
    const el = document.createElement('button');
    document.body.appendChild(el);
    collector.onAfterEvent(el, 'evt-click-3', 'click', '#b3', null, clickEvent('evt-click-3'));
    expect(collector['clickOrdinals']?.get('evt-click-3')).toBe(7);
    collector.stop();
    const ev = deliveredEvidence().find((e) => e.sourceEventId === 'evt-click-3');
    expect(ev).toBeTruthy();
    expect(ev!.window.openedBatch).toBe(7);
  });
});

describe('C-2: attach replacement preserves window.openedBatch', () => {
  it('richness replace carries over the existing ordinal when incoming lacks it', () => {
    vi.clearAllMocks();
    resetState();
    initRecording();
    // A real click interaction through the runtime, then attach the
    // windowed evidence WITH ordinal (tier-1 path).
    const emitted = processObservedEvent(clickEvent('evt-click-9'));
    expect(emitted.length).toBe(1);
    const interaction = getLiveInteractions().find(
      (i) => i.triggerEvent?.eventId === 'evt-click-9',
    );
    expect(interaction).toBeDefined();

    const withOrdinal = {
      sourceEventId: 'evt-click-9', windowId: 'ev-evt-click-9',
      window: { openedAt: 0, closedAt: 900, durationMs: 900, endReason: 'consequence-settled', openedBatch: 2 },
      targetEvidence: {
        identity: { cssSelector: '#b' }, identityCapturedAt: 1,
        before: null, after: null, focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [{}, {}, {}], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [], networkActivity: [],
      },
    } as unknown as BehavioralEvidence;
    expect(attachEvidenceToInteraction('evt-click-9', withOrdinal)).toBe(interaction!.interactionId);

    // Incoming: a LATE display supplement that wins the richness contest by
    // raw score but carries NO ordinal on its window.
    const incoming = {
      sourceEventId: 'evt-click-9', windowId: 'ev-evt-click-9',
      window: { openedAt: 0, closedAt: 1000, durationMs: 1000, endReason: 'stabilized' },
      targetEvidence: {
        identity: { cssSelector: '#b' }, identityCapturedAt: 1,
        before: null,
        after: { value: null, checked: null, disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: 'abcdef', childCount: 1, scrollTop: null, scrollLeft: null, selectedValues: null, controlledValue: null, className: '', capturedAt: 2 },
        focusMovement: null,
      },
      applicationEvidence: {
        domChanges: [{}, {}, {}, {}, {}], domChangeOverflow: 0, coarseMode: false,
        newSurfaces: [], removedSurfaces: [], visibilityChanges: [],
        navigation: [], networkActivity: [],
      },
    } as unknown as BehavioralEvidence;
    const attached = attachEvidenceToInteraction('evt-click-9', incoming);
    expect(attached).toBe(interaction!.interactionId);
    const w = (interaction!.behavioralEvidence as BehavioralEvidence).window as { openedBatch?: number };
    expect(w.openedBatch).toBe(2); // carried over — the boundary survives the replace
  });
});
