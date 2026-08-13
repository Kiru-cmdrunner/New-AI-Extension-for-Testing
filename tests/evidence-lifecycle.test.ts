/**
 * Evidence Lifecycle / Deduplication / Incomplete-Window Tests — M8.5
 *
 * Tests cover the four acceptance areas:
 *
 *   A. Exactly-once persistence — dedup guard prevents redundant writes
 *   B. Dedup during stop flow — evidence arriving during persistence window
 *   C. Incomplete windows — displaced, evidence-timeout, max-duration, etc.
 *      are still persisted (they represent real behavioral observation)
 *   D. Retrieval reliability — evidence survives across sessions, retrievable
 *      by both interactionId and recordingSessionId
 *
 * E. Guard lifecycle — initRecording/resetState clears the guard
 *
 * The dedup guard lives in sw-integration.ts (markEvidencePersisted /
 * filterUnpersistedEvidence / clearPersistedEvidenceGuard) and is tested
 * directly here without a browser. The DB-level idempotency (put by windowId)
 * is already tested in evidence-persistence.test.ts (M8.2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../src/repository/v2/dexie/dexie-unit-of-work-factory';
import {
  persistBehavioralEvidence,
} from '../src/repository/services/session-persistence-service';
import {
  filterUnpersistedEvidence,
  markEvidencePersisted,
  clearPersistedEvidenceGuard,
  resetState,
} from '../src/runtime/sw-integration';
import type { ComponentInteraction } from '../src/shared/component-types';
import type { BehavioralEvidence } from '../src/shared/behavioral-evidence-types';

// ── Chrome Mock (for sw-integration module) ────────────────────────────

function setupChromeMock(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };
  (globalThis as any).chrome = {
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
      sendMessage: vi.fn(async () => {}),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      sendMessage: vi.fn(async () => {}),
    },
  };
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

function makeInteraction(
  overrides: Partial<ComponentInteraction> = {},
): ComponentInteraction {
  return {
    interactionId: 'int-001',
    lifecycleId: 'lc-1',
    type: 'Click',
    trigger: null as any,
    triggerEvent: {
      eventId: 'evt-001',
      eventType: 'click',
      timestamp: 1000,
      captureSeq: 1,
      isTrusted: true,
      target: null as any,
      domContext: null as any,
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
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('M8.5: Evidence Lifecycle', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    setupChromeMock();
    factory = new DexieUnitOfWorkFactory();
    clearPersistedEvidenceGuard();
  });

  afterEach(async () => {
    resetState();
    await factory.getDatabase().delete();
  });

  // ── A. Exactly-once persistence ─────────────────────────────────

  describe('A. exactly-once persistence (dedup guard)', () => {
    it('filterUnpersistedEvidence returns all when none persisted', () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-1' }),
        }),
        makeInteraction({
          interactionId: 'int-2',
          behavioralEvidence: makeEvidence({ windowId: 'bev-2' }),
        }),
      ];

      const unpersisted = filterUnpersistedEvidence(interactions);
      expect(unpersisted).toHaveLength(2);
    });

    it('markEvidencePersisted + filterUnpersistedEvidence skips already-persisted', () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-1' }),
        }),
        makeInteraction({
          interactionId: 'int-2',
          behavioralEvidence: makeEvidence({ windowId: 'bev-2' }),
        }),
      ];

      markEvidencePersisted(['bev-1']);
      const unpersisted = filterUnpersistedEvidence(interactions);
      expect(unpersisted).toHaveLength(1);
      expect(unpersisted[0].interactionId).toBe('int-2');
    });

    it('after marking all, filterUnpersistedEvidence returns empty', () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-1' }),
        }),
      ];

      markEvidencePersisted(['bev-1']);
      const unpersisted = filterUnpersistedEvidence(interactions);
      expect(unpersisted).toHaveLength(0);
    });

    it('full exactly-once: persist → mark → re-attempt → no DB write needed', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-eo',
          behavioralEvidence: makeEvidence({ windowId: 'bev-eo' }),
        }),
      ];

      // First persistence call
      await persistBehavioralEvidence(factory, 'sess-eo', interactions);
      markEvidencePersisted(['bev-eo']);

      // Second call: guard filters it out — no DB write needed
      const unpersisted = filterUnpersistedEvidence(interactions);
      expect(unpersisted).toHaveLength(0);

      // If we did call persistBehavioralEvidence anyway (defense-in-depth),
      // the DB-level put() would still produce exactly 1 row
      await persistBehavioralEvidence(factory, 'sess-eo', interactions);
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const rows = await repos.behavioralEvidence.getBySession('sess-eo');
        expect(rows).toHaveLength(1);
      });
    });

    it('double-stopRecording simulation: same interactions twice = exactly one row', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-double',
          behavioralEvidence: makeEvidence({ windowId: 'bev-double' }),
        }),
      ];

      // First stop: persist + mark
      const firstUnpersisted = filterUnpersistedEvidence(interactions);
      expect(firstUnpersisted).toHaveLength(1);
      await persistBehavioralEvidence(factory, 'sess-double', firstUnpersisted);
      markEvidencePersisted(['bev-double']);

      // Second stop: same interactions, guard blocks them
      const secondUnpersisted = filterUnpersistedEvidence(interactions);
      expect(secondUnpersisted).toHaveLength(0);
    });

    it('partial set: marking one does not block others', () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-a',
          behavioralEvidence: makeEvidence({ windowId: 'bev-a' }),
        }),
        makeInteraction({
          interactionId: 'int-b',
          behavioralEvidence: makeEvidence({ windowId: 'bev-b' }),
        }),
        makeInteraction({
          interactionId: 'int-c',
          behavioralEvidence: makeEvidence({ windowId: 'bev-c' }),
        }),
      ];

      markEvidencePersisted(['bev-b']);
      const unpersisted = filterUnpersistedEvidence(interactions);
      expect(unpersisted).toHaveLength(2);
      const ids = unpersisted.map((i) => i.interactionId).sort();
      expect(ids).toEqual(['int-a', 'int-c']);
    });
  });

  // ── B. Dedup during stop flow (evidence arriving late) ──────────

  describe('B. dedup during stop flow', () => {
    it('evidence arriving during stop window is persisted on the second pass if guard not set', async () => {
      // Simulates: first stop has no evidence, evidence arrives later,
      // second stop or recovery persist includes it
      const noEvidence = [
        makeInteraction({ interactionId: 'int-late', behavioralEvidence: undefined }),
      ];

      // First pass: no evidence to persist
      let unpersisted = filterUnpersistedEvidence(noEvidence);
      expect(unpersisted).toHaveLength(0);

      // Evidence arrives
      const withEvidence = [
        makeInteraction({
          interactionId: 'int-late',
          behavioralEvidence: makeEvidence({ windowId: 'bev-late' }),
        }),
      ];

      // Second pass: evidence now present
      unpersisted = filterUnpersistedEvidence(withEvidence);
      expect(unpersisted).toHaveLength(1);
      await persistBehavioralEvidence(factory, 'sess-late', unpersisted);
      markEvidencePersisted(['bev-late']);
    });

    it('concurrent evidence for different interactions does not interfere', async () => {
      const intA = makeInteraction({
        interactionId: 'int-a',
        behavioralEvidence: makeEvidence({ windowId: 'bev-a' }),
      });
      const intB = makeInteraction({
        interactionId: 'int-b',
        behavioralEvidence: makeEvidence({ windowId: 'bev-b', sourceEventId: 'evt-b' }),
      });

      // Persist A, mark A
      await persistBehavioralEvidence(factory, 'sess-concurrent', [intA]);
      markEvidencePersisted(['bev-a']);

      // B is still unpersisted
      const unpersisted = filterUnpersistedEvidence([intA, intB]);
      expect(unpersisted).toHaveLength(1);
      expect(unpersisted[0].interactionId).toBe('int-b');

      // Persist B, mark B
      await persistBehavioralEvidence(factory, 'sess-concurrent', unpersisted);
      markEvidencePersisted(['bev-b']);

      // Both now blocked
      expect(filterUnpersistedEvidence([intA, intB])).toHaveLength(0);

      // DB has exactly 2
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const rows = await repos.behavioralEvidence.getBySession('sess-concurrent');
        expect(rows).toHaveLength(2);
      });
    });
  });

  // ── C. Incomplete windows are persisted ──────────────────────────

  describe('C. incomplete windows are persisted', () => {
    const incompleteReasons = [
      'displaced',
      'evidence-timeout',
      'max-duration',
      'element-removed',
      'navigation',
      'typing-complete',
      'lifecycle-abandoned',
      'page-reload',
      'page-reload-synthetic',
    ];

    for (const reason of incompleteReasons) {
      it(`persists evidence with endReason '${reason}'`, async () => {
        const interactions = [
          makeInteraction({
            interactionId: `int-${reason}`,
            behavioralEvidence: makeEvidence({
              windowId: `bev-${reason}`,
              sourceEventId: `evt-${reason}`,
              window: {
                openedAt: 100,
                closedAt: 200,
                durationMs: 100,
                endReason: reason as BehavioralEvidence['window']['endReason'],
                stabilityTrace: [],
              },
            }),
          }),
        ];

        const result = await persistBehavioralEvidence(
          factory,
          `sess-${reason}`,
          interactions,
        );

        expect(result.count).toBe(1);

        const uow = factory.create();
        await uow.execute(async (repos) => {
          const rows = await repos.behavioralEvidence.getByInteraction(`int-${reason}`);
          expect(rows).toHaveLength(1);
          expect(rows[0].window.endReason).toBe(reason);
        });
      });
    }

    it('no endReason is filtered out in the persistence path', async () => {
      // One interaction per reason, all in one call
      const interactions = incompleteReasons.map((reason, i) =>
        makeInteraction({
          interactionId: `int-mix-${i}`,
          behavioralEvidence: makeEvidence({
            windowId: `bev-mix-${i}`,
            sourceEventId: `evt-mix-${i}`,
            window: {
              openedAt: 100,
              closedAt: 200,
              durationMs: 100,
              endReason: reason as BehavioralEvidence['window']['endReason'],
              stabilityTrace: [],
            },
          }),
        }),
      );

      const result = await persistBehavioralEvidence(factory, 'sess-all-reasons', interactions);
      expect(result.count).toBe(incompleteReasons.length);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const rows = await repos.behavioralEvidence.getBySession('sess-all-reasons');
        expect(rows).toHaveLength(incompleteReasons.length);
      });
    });
  });

  // ── D. Retrieval reliability ────────────────────────────────────

  describe('D. retrieval reliability', () => {
    it('evidence survives across DB sessions and is retrievable', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-survive',
          behavioralEvidence: makeEvidence({ windowId: 'bev-survive' }),
        }),
      ];

      // Persist
      await persistBehavioralEvidence(factory, 'sess-survive', interactions);

      // New UoW (simulates a new DB session / different part of the app)
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const bySession = await repos.behavioralEvidence.getBySession('sess-survive');
        expect(bySession).toHaveLength(1);
        expect(bySession[0].windowId).toBe('bev-survive');

        const byInteraction = await repos.behavioralEvidence.getByInteraction('int-survive');
        expect(byInteraction).toHaveLength(1);
        expect(byInteraction[0].recordingSessionId).toBe('sess-survive');
      });
    });

    it('multiple sessions are isolated (no cross-session leakage)', async () => {
      const interactionsA = [
        makeInteraction({
          interactionId: 'int-iso-a',
          behavioralEvidence: makeEvidence({ windowId: 'bev-iso-a' }),
        }),
      ];
      const interactionsB = [
        makeInteraction({
          interactionId: 'int-iso-b',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-iso-b',
            sourceEventId: 'evt-iso-b',
          }),
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-iso-A', interactionsA);
      await persistBehavioralEvidence(factory, 'sess-iso-B', interactionsB);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const fromA = await repos.behavioralEvidence.getBySession('sess-iso-A');
        const fromB = await repos.behavioralEvidence.getBySession('sess-iso-B');

        expect(fromA).toHaveLength(1);
        expect(fromA[0].windowId).toBe('bev-iso-a');
        expect(fromB).toHaveLength(1);
        expect(fromB[0].windowId).toBe('bev-iso-b');

        // Cross-check by interaction
        const crossA = await repos.behavioralEvidence.getByInteraction('int-iso-a');
        const crossB = await repos.behavioralEvidence.getByInteraction('int-iso-b');
        expect(crossA[0].recordingSessionId).toBe('sess-iso-A');
        expect(crossB[0].recordingSessionId).toBe('sess-iso-B');
      });
    });

    it('count matches interactions-with-evidence count', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-count-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-c1' }),
        }),
        makeInteraction({
          interactionId: 'int-count-2',
          behavioralEvidence: undefined, // no evidence
        }),
        makeInteraction({
          interactionId: 'int-count-3',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-c3',
            sourceEventId: 'evt-c3',
          }),
        }),
      ];

      const expectedCount = interactions.filter((i) => i.behavioralEvidence).length;
      expect(expectedCount).toBe(2);

      await persistBehavioralEvidence(factory, 'sess-count', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const rows = await repos.behavioralEvidence.getBySession('sess-count');
        expect(rows).toHaveLength(expectedCount);
      });
    });

    it('deleteBySession removes all evidence for that session', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-del-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-del-1' }),
        }),
        makeInteraction({
          interactionId: 'int-del-2',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-del-2',
            sourceEventId: 'evt-del-2',
          }),
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-del', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const before = await repos.behavioralEvidence.getBySession('sess-del');
        expect(before).toHaveLength(2);

        await repos.behavioralEvidence.deleteBySession('sess-del');

        const after = await repos.behavioralEvidence.getBySession('sess-del');
        expect(after).toHaveLength(0);
      });
    });
  });

  // ── E. Guard lifecycle ──────────────────────────────────────────

  describe('E. guard lifecycle', () => {
    it('clearPersistedEvidenceGuard resets the set', () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-guard',
          behavioralEvidence: makeEvidence({ windowId: 'bev-guard' }),
        }),
      ];

      markEvidencePersisted(['bev-guard']);
      expect(filterUnpersistedEvidence(interactions)).toHaveLength(0);

      clearPersistedEvidenceGuard();
      expect(filterUnpersistedEvidence(interactions)).toHaveLength(1);
    });

    it('resetState clears the guard', () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-reset',
          behavioralEvidence: makeEvidence({ windowId: 'bev-reset' }),
        }),
      ];

      markEvidencePersisted(['bev-reset']);
      expect(filterUnpersistedEvidence(interactions)).toHaveLength(0);

      resetState();
      expect(filterUnpersistedEvidence(interactions)).toHaveLength(1);
    });
  });
});
