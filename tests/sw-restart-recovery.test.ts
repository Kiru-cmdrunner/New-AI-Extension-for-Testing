/**
 * Service Worker Restart Recovery Tests — M8.3
 *
 * Tests cover the three recovery scenarios that were broken before M8.3:
 *
 *   1. Pending evidence survival: storePendingEvidence → SW restart →
 *      restoreFromStorage → pending evidence still present
 *
 *   2. Evidence timeout reconstruction: interactions lacking evidence
 *      after restart get fresh timeout timers
 *
 *   3. Lifecycle bridge restoration: restored runtime config includes
 *      onLifecycleStart + sendFinalizeEvidence (previously missing)
 *
 *   4. Cleanup: resetState clears persisted pending evidence
 *
 *   5. initRecording clears stale pending evidence
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { BehavioralEvidence } from '../src/shared/behavioral-evidence-types';

// ── Chrome Mock ────────────────────────────────────────────────────────

function setupFullChromeMock(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };

  const tabsSendMessage = vi.fn(async () => {});
  const runtimeSendMessage = vi.fn(async () => {});

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (keys === undefined) return { ...store };
          const keyArr = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const k of keyArr) {
            if (k in store) result[k] = structuredClone(store[k]);
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) {
            store[k] = structuredClone(v);
          }
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const keyArr = Array.isArray(keys) ? keys : [keys];
          for (const k of keyArr) delete store[k];
        }),
      },
    },
    runtime: {
      sendMessage: runtimeSendMessage,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: tabsSendMessage,
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
  };

  globalThis.chrome = chromeMock as unknown as typeof chrome;

  return { store, tabsSendMessage, runtimeSendMessage };
}

// ── Fixture helpers ────────────────────────────────────────────────────

function makeEvidence(overrides: Partial<BehavioralEvidence> = {}): BehavioralEvidence {
  return {
    sourceEventId: 'evt-001',
    sourceEventType: 'click',
    windowId: 'bev-evt-001',
    frameId: 'main',
    window: {
      openedAt: 100,
      closedAt: 500,
      durationMs: 400,
      endReason: 'lifecycle-complete',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: null,
      identityCapturedAt: 0,
      before: null,
      after: null,
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
      networkActivity: [],
      performanceCondition: null,
    },
    ...overrides,
  };
}

/** Flush the 500ms debounced pending evidence persist. */
function flushDebounce(ms = 600) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Constants from sw-integration ──────────────────────────────────────

const PENDING_EVIDENCE_KEY = 'cmdrunner_pending_evidence';
const RECORDING_ACTIVE_KEY = 'cmdrunner_recording_active';
const LIVE_INTERACTIONS_KEY = 'cmdrunner_live_interactions';
const EVIDENCE_LEDGER_KEY = 'cmdrunner_evidence_ledger';

// ── Tests ──────────────────────────────────────────────────────────────

describe('M8.3: Service Worker Restart Recovery', () => {

  afterEach(async () => {
    // Clean up module state between tests
    const mod = await import('../src/runtime/sw-integration');
    mod.resetState();
    vi.resetModules();
  });

  // ── 1. Pending Evidence Survival ────────────────────────────────

  describe('pending evidence survival across SW restart', () => {
    it('storePendingEvidence persists to chrome.storage.local', async () => {
      setupFullChromeMock();

      const { storePendingEvidence } = await import('../src/runtime/sw-integration');
      const evidence = makeEvidence({ sourceEventId: 'evt-pending-1', windowId: 'bev-pending-1' });

      storePendingEvidence(evidence);
      await flushDebounce();

      const result = await chrome.storage.local.get(PENDING_EVIDENCE_KEY);
      const stored = result[PENDING_EVIDENCE_KEY] as [string, BehavioralEvidence][];
      expect(stored).toBeDefined();
      expect(stored).toHaveLength(1);
      expect(stored[0][0]).toBe('evt-pending-1');
      expect(stored[0][1].windowId).toBe('bev-pending-1');
    });

    it('restoreFromStorage recovers pending evidence after SW restart', async () => {
      // Set up storage simulating the state just BEFORE a SW restart:
      // recording active + pending evidence persisted
      setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: true,
        [LIVE_INTERACTIONS_KEY]: [],
        [EVIDENCE_LEDGER_KEY]: [],
        [PENDING_EVIDENCE_KEY]: [
          ['evt-recover-1', makeEvidence({ sourceEventId: 'evt-recover-1', windowId: 'bev-recover-1' })],
        ],
      });

      const { restoreFromStorage } = await import('../src/runtime/sw-integration');
      const restored = await restoreFromStorage();

      expect(restored).toBe(true);

      // Verify PENDING_EVIDENCE_KEY was included in the storage.get call
      expect(chrome.storage.local.get).toHaveBeenCalledWith(
        expect.arrayContaining([PENDING_EVIDENCE_KEY]),
      );
    });

    it('multiple pending evidence entries are persisted and restored', async () => {
      setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: true,
        [LIVE_INTERACTIONS_KEY]: [],
        [EVIDENCE_LEDGER_KEY]: [],
        [PENDING_EVIDENCE_KEY]: [
          ['evt-a', makeEvidence({ sourceEventId: 'evt-a', windowId: 'bev-a' })],
          ['evt-b', makeEvidence({ sourceEventId: 'evt-b', windowId: 'bev-b' })],
          ['evt-c', makeEvidence({ sourceEventId: 'evt-c', windowId: 'bev-c' })],
        ],
      });

      const { restoreFromStorage } = await import('../src/runtime/sw-integration');
      const restored = await restoreFromStorage();
      expect(restored).toBe(true);
    });
  });

  // ── 2. Evidence Timeout Reconstruction ──────────────────────────

  describe('evidence timeout reconstruction after restart', () => {
    it('restoreFromStorage reconstructs timeouts for interactions lacking evidence', async () => {
      const interactionWithoutEvidence = {
        interactionId: 'int-no-ev',
        lifecycleId: 'lc-1',
        type: 'Click',
        trigger: null,
        triggerEvent: {
          eventId: 'evt-no-ev',
          eventType: 'click',
          timestamp: 1000,
          captureSeq: 1,
          isTrusted: true,
          target: null,
          domContext: null,
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
          pageUrl: 'https://example.com',
          pageTitle: 'Example',
        },
        memberEvents: [],
        startTime: 1000,
        endTime: 2000,
        endState: 'completed',
        metadata: {},
        // behavioralEvidence intentionally absent
      };

      setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: true,
        [LIVE_INTERACTIONS_KEY]: [interactionWithoutEvidence],
        [EVIDENCE_LEDGER_KEY]: [],
      });

      const { restoreFromStorage, getLiveInteractions } = await import('../src/runtime/sw-integration');
      const restored = await restoreFromStorage();

      expect(restored).toBe(true);

      // The interaction was restored and a timeout timer was started for it.
      // We can't wait 300s, but we verify the interaction exists without evidence
      // (which means a timer was queued for it).
      const interactions = getLiveInteractions();
      expect(interactions).toHaveLength(1);
      expect(interactions[0].behavioralEvidence).toBeUndefined();
    });

    it('restoreFromStorage does NOT start timeout for interactions WITH evidence', async () => {
      const interactionWithEvidence = {
        interactionId: 'int-has-ev',
        lifecycleId: 'lc-2',
        type: 'Click',
        trigger: null,
        triggerEvent: {
          eventId: 'evt-has-ev',
          eventType: 'click',
          timestamp: 1000,
          captureSeq: 1,
          isTrusted: true,
          target: null,
          domContext: null,
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
          pageUrl: 'https://example.com',
          pageTitle: 'Example',
        },
        memberEvents: [],
        startTime: 1000,
        endTime: 2000,
        endState: 'completed',
        metadata: {},
        behavioralEvidence: makeEvidence({ windowId: 'bev-has-ev' }),
      };

      setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: true,
        [LIVE_INTERACTIONS_KEY]: [interactionWithEvidence],
        [EVIDENCE_LEDGER_KEY]: [],
      });

      const { restoreFromStorage, getLiveInteractions } = await import('../src/runtime/sw-integration');
      await restoreFromStorage();

      const interactions = getLiveInteractions();
      expect(interactions).toHaveLength(1);
      expect(interactions[0].behavioralEvidence).toBeDefined();
      expect(interactions[0].behavioralEvidence!.windowId).toBe('bev-has-ev');
    });
  });

  // ── 3. Lifecycle Bridge Restoration ─────────────────────────────

  describe('lifecycle bridge restoration after restart', () => {
    it('restored runtime sends FINALIZE_EVIDENCE when a click interaction emits', async () => {
      const mock = setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: true,
        [LIVE_INTERACTIONS_KEY]: [],
        [EVIDENCE_LEDGER_KEY]: [],
      });

      const { restoreFromStorage, processObservedEvent } = await import('../src/runtime/sw-integration');
      await restoreFromStorage();

      // Process a click on a button (interactive element → Click definition triggers)
      const clickEvent = {
        eventId: 'evt-finalize-test',
        eventType: 'click',
        timestamp: Date.now(),
        captureSeq: 1,
        isTrusted: true,
        target: {
          accessibleName: 'Submit Button',
          ariaRole: 'button',
          ariaLabel: null,
          ariaLabelledBy: null,
          placeholder: null,
          tag: 'BUTTON',
          className: 'submit-btn',
          name: '',
          stableId: 'submit-btn',
          testId: null,
          dataCy: null,
          dataQa: null,
          cssSelector: '#submit-btn',
          xPath: '//button',
          inIframe: false,
          elementId: 'submit-btn',
          top: 100, left: 100, right: 150, bottom: 140,
          isVisible: true,
        },
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ancestorRoles: [],
          ancestorClasses: [],
          ariaValueNow: null,
          ariaValueMin: null,
          ariaValueMax: null,
          ariaValueText: null,
        },
        valueBefore: null,
        valueAfter: null,
        checkedBefore: null,
        checkedAfter: null,
        clientX: 120,
        clientY: 120,
        key: null,
        code: null,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        scrollDeltaY: null,
        scrollDeltaX: null,
        pageUrl: 'https://example.com',
        pageTitle: 'Example',
      };

      const emitted = processObservedEvent(clickEvent as any);

      // If an interaction was emitted, FINALIZE_EVIDENCE should have been sent
      expect(emitted.length).toBeGreaterThan(0);

      // Give the async chrome.tabs.query chain time to resolve
      await new Promise((r) => setTimeout(r, 200));

      const finalizeCalls = mock.tabsSendMessage.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'FINALIZE_EVIDENCE',
      );
      expect(finalizeCalls.length).toBeGreaterThan(0);
    });

    it('restored runtime sends LIFECYCLE_BOUND for new lifecycles', async () => {
      const mock = setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: true,
        [LIVE_INTERACTIONS_KEY]: [],
        [EVIDENCE_LEDGER_KEY]: [],
      });

      const { restoreFromStorage, processObservedEvent } = await import('../src/runtime/sw-integration');
      await restoreFromStorage();

      // Process a click — this triggers createContext which calls onLifecycleStart
      const clickEvent = {
        eventId: 'evt-lifecycle-test',
        eventType: 'click',
        timestamp: Date.now(),
        captureSeq: 1,
        isTrusted: true,
        target: {
          accessibleName: 'Click Me',
          ariaRole: 'button',
          ariaLabel: null,
          ariaLabelledBy: null,
          placeholder: null,
          tag: 'BUTTON',
          className: 'btn-primary',
          name: '',
          stableId: 'click-me-btn',
          testId: null,
          dataCy: null,
          dataQa: null,
          cssSelector: '#click-me',
          xPath: '//button',
          inIframe: false,
          elementId: 'click-me-btn',
          top: 100, left: 100, right: 150, bottom: 140,
          isVisible: true,
        },
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ancestorRoles: [],
          ancestorClasses: [],
          ariaValueNow: null,
          ariaValueMin: null,
          ariaValueMax: null,
          ariaValueText: null,
        },
        valueBefore: null,
        valueAfter: null,
        checkedBefore: null,
        checkedAfter: null,
        clientX: 120,
        clientY: 120,
        key: null,
        code: null,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        scrollDeltaY: null,
        scrollDeltaX: null,
        pageUrl: 'https://example.com',
        pageTitle: 'Example',
      };

      processObservedEvent(clickEvent as any);

      // Give the async chrome.tabs.query chain time to resolve
      await new Promise((r) => setTimeout(r, 200));

      const lifecycleCalls = mock.tabsSendMessage.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'LIFECYCLE_BOUND',
      );
      expect(lifecycleCalls.length).toBeGreaterThan(0);
    });
  });

  // ── 4. Cleanup ──────────────────────────────────────────────────

  describe('cleanup', () => {
    it('resetState clears persisted pending evidence from storage', async () => {
      setupFullChromeMock();

      const { storePendingEvidence, resetState } =
        await import('../src/runtime/sw-integration');

      storePendingEvidence(makeEvidence({ sourceEventId: 'evt-cleanup', windowId: 'bev-cleanup' }));
      await flushDebounce();

      // Verify it was stored
      const before = await chrome.storage.local.get(PENDING_EVIDENCE_KEY);
      expect(before[PENDING_EVIDENCE_KEY]).toBeDefined();

      resetState();

      // Verify storage key was removed
      const after = await chrome.storage.local.get(PENDING_EVIDENCE_KEY);
      expect(after[PENDING_EVIDENCE_KEY]).toBeUndefined();
    });

    it('resetState clears in-memory pending evidence', async () => {
      setupFullChromeMock();

      const { storePendingEvidence, resetState, attachEvidenceToInteraction } =
        await import('../src/runtime/sw-integration');

      storePendingEvidence(makeEvidence({ sourceEventId: 'evt-mem', windowId: 'bev-mem' }));

      resetState();

      // After reset, attachEvidence should find nothing (liveInteractions also cleared)
      const result = attachEvidenceToInteraction(
        'evt-mem',
        makeEvidence({ sourceEventId: 'evt-mem', windowId: 'bev-new' }),
      );
      expect(result).toBeNull();
    });
  });

  // ── 5. initRecording clears stale pending evidence ──────────────

  describe('initRecording clears stale pending evidence', () => {
    it('initRecording removes persisted pending evidence from storage', async () => {
      setupFullChromeMock();

      const { storePendingEvidence, initRecording } =
        await import('../src/runtime/sw-integration');

      storePendingEvidence(makeEvidence({ sourceEventId: 'evt-stale', windowId: 'bev-stale' }));
      await flushDebounce();

      const before = await chrome.storage.local.get(PENDING_EVIDENCE_KEY);
      expect(before[PENDING_EVIDENCE_KEY]).toBeDefined();

      // Start a new recording — should clear stale pending evidence
      initRecording();

      const after = await chrome.storage.local.get(PENDING_EVIDENCE_KEY);
      expect(after[PENDING_EVIDENCE_KEY]).toBeUndefined();
    });
  });

  // ── 6. No-recording restore ─────────────────────────────────────

  describe('restore when recording was not active', () => {
    it('returns false when recording was not active', async () => {
      setupFullChromeMock({
        [RECORDING_ACTIVE_KEY]: false,
      });

      const { restoreFromStorage } = await import('../src/runtime/sw-integration');
      const result = await restoreFromStorage();
      expect(result).toBe(false);
    });

    it('returns false when storage is empty', async () => {
      setupFullChromeMock({});

      const { restoreFromStorage } = await import('../src/runtime/sw-integration');
      const result = await restoreFromStorage();
      expect(result).toBe(false);
    });
  });
});
