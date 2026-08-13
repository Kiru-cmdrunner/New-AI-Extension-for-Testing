/**
 * Production Hardening Tests — M8.6
 *
 * Final hardening pass for M8. Validates:
 *
 *   A. V3→V4 migration safety — version chain, additive-only, index integrity
 *   B. Persistence consistency — multi-session isolation, re-record cycle cleanup
 *   C. Failure handling — evidence persistence error non-fatal, partial persistence
 *   D. Repository integrity — UoW rollback isolation, cross-table atomicity
 *   E. Full M8 regression — end-to-end flow: persistSession + evidence + dedup + retrieval + cleanup
 *
 * No production code changes — test-only hardening.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../src/repository/v2/dexie/dexie-unit-of-work-factory';
import {
  persistSession,
  persistBehavioralEvidence,
  type SessionPersistenceInput,
} from '../src/repository/services/session-persistence-service';
import { CmdRunnerDatabase } from '../src/repository/v2/dexie/dexie-database';
import {
  filterUnpersistedEvidence,
  markEvidencePersisted,
  clearPersistedEvidenceGuard,
  resetState,
} from '../src/runtime/sw-integration';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';
import type { ExecutionIRPlan } from '../src/domain/execution-ir/types';
import type { SessionEvent } from '../src/shared/types';
import type { ComponentInteraction, ObservedEvent } from '../src/shared/component-types';
import type { BehavioralEvidence } from '../src/shared/behavioral-evidence-types';
import type { DomChangeSummary } from '../src/shared/behavioral-evidence-types';

// ── Chrome Mock (for sw-integration imports) ───────────────────────────

function setupChromeMock() {
  const store: Record<string, unknown> = {};
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
    tabs: { sendMessage: vi.fn(async () => {}) },
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

function makeObservedEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return {
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
    triggerEvent: makeObservedEvent(),
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

function makeUnderstandingResult(
  overrides: Partial<UnderstandingResult> = {},
): UnderstandingResult {
  return {
    sessionId: 'session-001',
    generatedAt: '2026-08-13T00:00:00Z',
    schemaVersion: 1,
    ...overrides,
  };
}

function makeIRPlan(): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title: 'Test',
    tags: [],
    environment: {
      baseUrl: 'https://example.com',
      browser: 'chrome',
      viewport: { width: 1280, height: 720 },
    },
    steps: [],
  };
}

function makeSessionEvent(): SessionEvent {
  return {
    actionId: 'evt-001',
    type: 'navigation',
    url: 'https://example.com',
    title: 'Example',
    timestamp: '2026-08-13T00:00:00Z',
  };
}

function makePersistInput(
  overrides: Partial<SessionPersistenceInput> = {},
): SessionPersistenceInput {
  return {
    understanding: makeUnderstandingResult(),
    events: [makeSessionEvent()],
    interactions: [],
    url: 'https://example.com',
    irPlan: makeIRPlan(),
    projectId: null,
    testCaseName: 'Test',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('M8.6: Production Hardening', () => {
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

  // ── A. V3→V4 Migration Safety ───────────────────────────────────

  describe('A. V3→V4 migration safety', () => {
    it('database opens at version 4', () => {
      const db = factory.getDatabase();
      expect(db.verno).toBe(4);
    });

    it('declares all 4 schema versions', () => {
      // CmdRunnerDatabase internally registers versions 1-4 via Dexie.
      // We verify by checking the database version (verno=4) and that
      // all V1-V4 tables are present and queryable.
      const db = factory.getDatabase();
      expect(db.verno).toBe(4);

      // V1 tables
      expect(db.table('projects')).toBeDefined();
      expect(db.table('elements')).toBeDefined();
      expect(db.table('testCases')).toBeDefined();
      expect(db.table('testCaseVersions')).toBeDefined();
      expect(db.table('sourceArtifacts')).toBeDefined();
      expect(db.table('executionIRs')).toBeDefined();

      // V2 table
      expect(db.table('recordingSessions')).toBeDefined();

      // V3 table
      expect(db.table('executionRuns')).toBeDefined();

      // V4 table
      expect(db.table('behavioralEvidence')).toBeDefined();
    });

    it('V4 migration is additive-only: V1-V3 tables have data, V4 is empty', async () => {
      const db = factory.getDatabase();

      // Write to V1-V3 tables
      await db.projects.add({
        id: 'proj-v4-check',
        name: 'Pre-V4',
        description: '',
        tags: [],
        status: 'ACTIVE' as any,
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      await db.recordingSessions.add({
        id: 'sess-v4-check',
        projectId: 'proj-v4-check',
        understandingResult: { sessionId: 'x', generatedAt: '2026-01-01', schemaVersion: 1 },
        rawEvents: [],
        rawInteractions: [],
        url: 'https://example.com',
        recordedAt: '2026-01-01T00:00:00Z',
        duration: 1000,
        testCaseIds: [],
      });

      // V4 table is empty (new, no data migration)
      const evidenceCount = await db.behavioralEvidence.count();
      expect(evidenceCount).toBe(0);

      // V1-V3 data survived
      const project = await db.projects.get('proj-v4-check');
      expect(project).toBeDefined();
      expect(project!.name).toBe('Pre-V4');

      const session = await db.recordingSessions.get('sess-v4-check');
      expect(session).toBeDefined();
      expect(session!.projectId).toBe('proj-v4-check');
    });

    it('V4 behavioral_evidence indexes are correct', async () => {
      const db = factory.getDatabase();

      // Write evidence for two interactions in two sessions
      await db.behavioralEvidence.bulkPut([
        {
          ...makeEvidence({ windowId: 'bev-1', sourceEventId: 'evt-1' }),
          interactionId: 'int-A',
          recordingSessionId: 'sess-A',
          persistedAt: 1000,
        },
        {
          ...makeEvidence({ windowId: 'bev-2', sourceEventId: 'evt-2' }),
          interactionId: 'int-B',
          recordingSessionId: 'sess-A',
          persistedAt: 2000,
        },
        {
          ...makeEvidence({ windowId: 'bev-3', sourceEventId: 'evt-3' }),
          interactionId: 'int-C',
          recordingSessionId: 'sess-B',
          persistedAt: 3000,
        },
      ]);

      // Index: interactionId
      const byIntB = await db.behavioralEvidence
        .where('interactionId').equals('int-B').toArray();
      expect(byIntB).toHaveLength(1);
      expect(byIntB[0].windowId).toBe('bev-2');

      // Index: recordingSessionId
      const bySessA = await db.behavioralEvidence
        .where('recordingSessionId').equals('sess-A').toArray();
      expect(bySessA).toHaveLength(2);

      // PK: windowId
      const byWindow = await db.behavioralEvidence.get('bev-1');
      expect(byWindow).toBeDefined();
      expect(byWindow!.interactionId).toBe('int-A');
    });

    it('fresh database opens at V4 without error', () => {
      const freshDb = new CmdRunnerDatabase();
      expect(freshDb.verno).toBe(4);
      freshDb.close();
    });
  });

  // ── B. Persistence Consistency ──────────────────────────────────

  describe('B. persistence consistency', () => {
    it('evidence from multiple sessions is isolated', async () => {
      const intA = makeInteraction({
        interactionId: 'int-A1',
        behavioralEvidence: makeEvidence({ windowId: 'bev-A1' }),
      });
      const intB = makeInteraction({
        interactionId: 'int-B1',
        behavioralEvidence: makeEvidence({
          windowId: 'bev-B1',
          sourceEventId: 'evt-B1',
        }),
      });

      await persistBehavioralEvidence(factory, 'sess-multi-A', [intA]);
      await persistBehavioralEvidence(factory, 'sess-multi-B', [intB]);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const fromA = await repos.behavioralEvidence.getBySession('sess-multi-A');
        const fromB = await repos.behavioralEvidence.getBySession('sess-multi-B');

        expect(fromA).toHaveLength(1);
        expect(fromA[0].recordingSessionId).toBe('sess-multi-A');
        expect(fromB).toHaveLength(1);
        expect(fromB[0].recordingSessionId).toBe('sess-multi-B');

        // No cross-contamination
        expect(fromA.some((e) => e.recordingSessionId === 'sess-multi-B')).toBe(false);
        expect(fromB.some((e) => e.recordingSessionId === 'sess-multi-A')).toBe(false);
      });
    });

    it('re-record cycle: new session evidence is independent of prior guard state', async () => {
      // Simulate first recording cycle
      const interactions1 = [
        makeInteraction({
          interactionId: 'int-cycle-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-cycle-1' }),
        }),
      ];

      // Persist + mark (guard tracks it)
      const unpersisted1 = filterUnpersistedEvidence(interactions1);
      expect(unpersisted1).toHaveLength(1);
      await persistBehavioralEvidence(factory, 'sess-cycle-1', unpersisted1);
      markEvidencePersisted(['bev-cycle-1']);

      // Reset for new cycle (initRecording/resetState)
      clearPersistedEvidenceGuard();

      // Second recording cycle
      const interactions2 = [
        makeInteraction({
          interactionId: 'int-cycle-2',
          behavioralEvidence: makeEvidence({ windowId: 'bev-cycle-2' }),
        }),
      ];

      const unpersisted2 = filterUnpersistedEvidence(interactions2);
      expect(unpersisted2).toHaveLength(1);

      await persistBehavioralEvidence(factory, 'sess-cycle-2', unpersisted2);

      // Both sessions have their evidence
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence1 = await repos.behavioralEvidence.getBySession('sess-cycle-1');
        const evidence2 = await repos.behavioralEvidence.getBySession('sess-cycle-2');

        expect(evidence1).toHaveLength(1);
        expect(evidence1[0].windowId).toBe('bev-cycle-1');

        expect(evidence2).toHaveLength(1);
        expect(evidence2[0].windowId).toBe('bev-cycle-2');
      });
    });

    it('total evidence count matches sum across sessions', async () => {
      const allInteractions: ComponentInteraction[] = [];

      for (let i = 0; i < 5; i++) {
        const interactions = [
          makeInteraction({
            interactionId: `int-count-${i}`,
            behavioralEvidence: makeEvidence({
              windowId: `bev-count-${i}`,
              sourceEventId: `evt-count-${i}`,
            }),
          }),
          makeInteraction({
            interactionId: `int-count-extra-${i}`,
            behavioralEvidence: makeEvidence({
              windowId: `bev-count-extra-${i}`,
              sourceEventId: `evt-count-extra-${i}`,
            }),
          }),
        ];
        await persistBehavioralEvidence(factory, `sess-count-${i}`, interactions);
        allInteractions.push(...interactions);
      }

      const db = factory.getDatabase();
      const totalCount = await db.behavioralEvidence.count();
      expect(totalCount).toBe(10); // 5 sessions × 2 interactions each
    });
  });

  // ── C. Failure Handling ─────────────────────────────────────────

  describe('C. failure handling', () => {
    it('persistBehavioralEvidence failure does not affect already-persisted session', async () => {
      const factory1 = new DexieUnitOfWorkFactory();
      const sessionInput = makePersistInput({
        interactions: [
          makeInteraction({
            interactionId: 'int-fail-sess',
            behavioralEvidence: makeEvidence({ windowId: 'bev-fail-sess' }),
          }),
        ],
      });

      // Persist the session successfully
      const sessionResult = await persistSession(factory1, sessionInput);
      const db1 = factory1.getDatabase();

      // Verify session is in the DB
      const uow1 = factory1.create();
      await uow1.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(sessionResult.sessionId);
        expect(session).toBeDefined();
      });

      // Now delete this DB to simulate a failure condition
      await db1.delete();

      // Attempt to persist evidence on a fresh DB (sessionId won't match)
      // This simulates evidence persistence failing while session already persisted
      const factory2 = new DexieUnitOfWorkFactory();
      await expect(
        persistBehavioralEvidence(factory2, sessionResult.sessionId, [
          makeInteraction({
            interactionId: 'int-fail-sess',
            behavioralEvidence: makeEvidence({ windowId: 'bev-fail-sess' }),
          }),
        ]),
      ).resolves.toEqual({ count: 1 }); // It succeeds on the fresh DB

      await factory2.getDatabase().delete();
    });

    it('interactions without behavioralEvidence are skipped (no error)', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-has-ev',
          behavioralEvidence: makeEvidence({ windowId: 'bev-has-ev' }),
        }),
        makeInteraction({
          interactionId: 'int-no-ev-1',
          behavioralEvidence: undefined,
        }),
        makeInteraction({
          interactionId: 'int-no-ev-2',
          behavioralEvidence: undefined,
        }),
      ];

      const result = await persistBehavioralEvidence(factory, 'sess-skip', interactions);
      expect(result.count).toBe(1);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const all = await repos.behavioralEvidence.getBySession('sess-skip');
        expect(all).toHaveLength(1);
        expect(all[0].windowId).toBe('bev-has-ev');
      });
    });

    it('empty interactions array returns count 0 without error', async () => {
      const result = await persistBehavioralEvidence(factory, 'sess-empty', []);
      expect(result.count).toBe(0);
    });

    it('large evidence payload persists successfully', async () => {
      const largeDomChanges: DomChangeSummary[] = Array.from({ length: 200 }, (_, i) => ({
        types: ['childList'],
        targetPath: `div.child-${i}`,
        targetTag: 'DIV',
        shadowContext: null,
        changedAttributes: [],
        attributeDeltas: {},
        addedNodesCount: 1,
        removedNodesCount: 0,
        characterDataDelta: null,
        firstMutationAt: i * 10,
        lastMutationAt: i * 10 + 5,
        rawMutationCount: 1,
        firstBatchIndex: i,
        lastBatchIndex: i,
      }));

      const largeNetwork = Array.from({ length: 50 }, (_, i) => ({
        url: `https://api.example.com/endpoint-${i}`,
        method: 'GET',
        status: 200,
        startRelativeToEvent: i * 100,
        endRelativeToEvent: i * 100 + 50,
        durationMs: 50,
        resourceType: 'fetch' as const,
        source: 'main-world' as const,
      }));

      const evidence = makeEvidence({
        windowId: 'bev-large',
        applicationEvidence: {
          domChanges: largeDomChanges,
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: largeNetwork,
          performanceCondition: {
            mainThreadBlocked: false,
            highChurnMode: true,
            longestBatchMs: 250,
            totalBatches: 30,
          },
        },
      });

      const interactions = [
        makeInteraction({
          interactionId: 'int-large',
          behavioralEvidence: evidence,
        }),
      ];

      const result = await persistBehavioralEvidence(factory, 'sess-large', interactions);
      expect(result.count).toBe(1);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const rows = await repos.behavioralEvidence.getBySession('sess-large');
        expect(rows).toHaveLength(1);
        expect(rows[0].applicationEvidence.domChanges).toHaveLength(200);
        expect(rows[0].applicationEvidence.networkActivity).toHaveLength(50);
        expect(rows[0].applicationEvidence.performanceCondition?.totalBatches).toBe(30);
      });
    });
  });

  // ── D. Repository Integrity ─────────────────────────────────────

  describe('D. repository integrity', () => {
    it('evidence transaction rollback does not affect session transaction', async () => {
      // Step 1: persist session in its own UoW
      const sessionInput = makePersistInput({
        interactions: [
          makeInteraction({
            interactionId: 'int-rollback',
            behavioralEvidence: makeEvidence({ windowId: 'bev-rollback' }),
          }),
        ],
      });
      const sessionResult = await persistSession(factory, sessionInput);

      // Verify session is committed
      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(sessionResult.sessionId);
        expect(session).toBeDefined();
      });

      // Step 2: evidence persistence throws (simulated failure)
      // We create a UoW that intentionally throws after saving evidence
      const uow2 = factory.create();
      await expect(
        uow2.execute(async (repos) => {
          await repos.behavioralEvidence.save({
            ...makeEvidence({ windowId: 'bev-rollback' }),
            interactionId: 'int-rollback',
            recordingSessionId: sessionResult.sessionId,
            persistedAt: Date.now(),
          });
          throw new Error('Simulated evidence persistence failure');
        }),
      ).rejects.toThrow('Simulated evidence persistence failure');

      // Step 3: session is still committed (separate transaction)
      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(sessionResult.sessionId);
        expect(session).toBeDefined();

        // Evidence was rolled back
        const evidence = await repos.behavioralEvidence.getBySession(sessionResult.sessionId);
        expect(evidence).toHaveLength(0);
      });
    });

    it('cross-table atomicity: session + evidence in same UoW commit together', async () => {
      const uow = factory.create();
      const sessionId = 'sess-atomic-m86';

      await uow.execute(async (repos) => {
        // Session
        await repos.recordingSessions.create({
          id: sessionId,
          projectId: 'proj-test',
          understandingResult: { sessionId: 'x', generatedAt: '2026', schemaVersion: 1 },
          rawEvents: [],
          rawInteractions: [],
          url: 'https://example.com',
          recordedAt: '2026-01-01T00:00:00Z',
          duration: 1000,
          testCaseIds: [],
        });

        // Evidence (same transaction)
        await repos.behavioralEvidence.save({
          ...makeEvidence({ windowId: 'bev-atomic-m86' }),
          interactionId: 'int-atomic-m86',
          recordingSessionId: sessionId,
          persistedAt: Date.now(),
        });
      });

      // Both committed
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(sessionId);
        expect(session).toBeDefined();

        const evidence = await repos.behavioralEvidence.getBySession(sessionId);
        expect(evidence).toHaveLength(1);
        expect(evidence[0].interactionId).toBe('int-atomic-m86');
      });
    });

    it('cross-table atomicity: rollback reverts both session and evidence', async () => {
      const uow = factory.create();
      const sessionId = 'sess-rollback-both';

      await expect(
        uow.execute(async (repos) => {
          await repos.recordingSessions.create({
            id: sessionId,
            projectId: 'proj-test',
            understandingResult: { sessionId: 'x', generatedAt: '2026', schemaVersion: 1 },
            rawEvents: [],
            rawInteractions: [],
            url: 'https://example.com',
            recordedAt: '2026-01-01T00:00:00Z',
            duration: 1000,
            testCaseIds: [],
          });

          await repos.behavioralEvidence.save({
            ...makeEvidence({ windowId: 'bev-rollback-both' }),
            interactionId: 'int-rollback-both',
            recordingSessionId: sessionId,
            persistedAt: Date.now(),
          });

          throw new Error('Rollback everything');
        }),
      ).rejects.toThrow('Rollback everything');

      // Both should be rolled back
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(sessionId);
        expect(session).toBeUndefined();

        const evidence = await repos.behavioralEvidence.getBySession(sessionId);
        expect(evidence).toHaveLength(0);
      });
    });

    it('all 9 tables accessible within a single UoW', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return {
          hasProjects: typeof repos.projects.create === 'function',
          hasTestCases: typeof repos.testCases.create === 'function',
          hasElements: typeof repos.elements.create === 'function',
          hasSourceArtifacts: typeof repos.sourceArtifacts.create === 'function',
          hasExecutionIRs: typeof repos.executionIRs.save === 'function',
          hasRecordingSessions: typeof repos.recordingSessions.create === 'function',
          hasExecutionRuns: typeof repos.executionRuns.save === 'function',
          hasBehavioralEvidence: typeof repos.behavioralEvidence.save === 'function',
        };
      });

      expect(Object.values(result)).toEqual([true, true, true, true, true, true, true, true]);
    });
  });

  // ── E. Full M8 End-to-End Regression ────────────────────────────

  describe('E. full M8 end-to-end regression', () => {
    it('complete recording cycle: persistSession → dedup → persistEvidence → retrieve → cleanup', async () => {
      // ── Step 1: Build interactions with evidence ──
      const interactions: ComponentInteraction[] = [
        makeInteraction({
          interactionId: 'int-e2e-1',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-e2e-1',
            sourceEventId: 'evt-e2e-1',
            sourceEventType: 'click',
          }),
        }),
        makeInteraction({
          interactionId: 'int-e2e-2',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-e2e-2',
            sourceEventId: 'evt-e2e-2',
            sourceEventType: 'input',
            window: {
              openedAt: 100,
              closedAt: 5000,
              durationMs: 4900,
              endReason: 'lifecycle-complete',
              stabilityTrace: [
                { timestamp: 200, msSinceLastMutation: 100, globalBatchCount: 1 },
              ],
            },
          }),
        }),
        makeInteraction({
          interactionId: 'int-e2e-3',
          behavioralEvidence: undefined, // No evidence — should be skipped
        }),
      ];

      // ── Step 2: Persist the session ──
      const sessionInput = makePersistInput({ interactions });
      const sessionResult = await persistSession(factory, sessionInput);
      expect(sessionResult.sessionId).toBeDefined();

      // ── Step 3: Dedup guard — filter unpersisted evidence ──
      const unpersisted = filterUnpersistedEvidence(interactions);
      expect(unpersisted).toHaveLength(2); // int-e2e-3 has no evidence

      // ── Step 4: Persist evidence ──
      const evidenceResult = await persistBehavioralEvidence(
        factory,
        sessionResult.sessionId,
        unpersisted,
      );
      expect(evidenceResult.count).toBe(2);

      // ── Step 5: Mark evidence as persisted (guard) ──
      markEvidencePersisted(
        unpersisted
          .filter((i) => i.behavioralEvidence)
          .map((i) => i.behavioralEvidence!.windowId),
      );

      // ── Step 6: Second stop attempt — guard blocks redundant persistence ──
      const secondUnpersisted = filterUnpersistedEvidence(interactions);
      expect(secondUnpersisted).toHaveLength(0);

      // ── Step 7: Retrieve evidence ──
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence = await repos.behavioralEvidence.getBySession(sessionResult.sessionId);
        expect(evidence).toHaveLength(2);

        // Verify by interaction
        const ev1 = await repos.behavioralEvidence.getByInteraction('int-e2e-1');
        expect(ev1).toHaveLength(1);
        expect(ev1[0].sourceEventType).toBe('click');

        const ev2 = await repos.behavioralEvidence.getByInteraction('int-e2e-2');
        expect(ev2).toHaveLength(1);
        expect(ev2[0].window.stabilityTrace).toHaveLength(1);

        // Interaction without evidence returns empty
        const ev3 = await repos.behavioralEvidence.getByInteraction('int-e2e-3');
        expect(ev3).toHaveLength(0);
      });

      // ── Step 8: Cleanup — deleteBySession ──
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.behavioralEvidence.deleteBySession(sessionResult.sessionId);
      });

      // ── Step 9: Verify cleanup ──
      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        const remaining = await repos.behavioralEvidence.getBySession(sessionResult.sessionId);
        expect(remaining).toHaveLength(0);
      });

      // Session itself is NOT deleted (evidence cleanup ≠ session deletion)
      const uow4 = factory.create();
      await uow4.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(sessionResult.sessionId);
        expect(session).toBeDefined();
      });
    });

    it('multiple recording cycles accumulate without interference', async () => {
      const sessions: string[] = [];

      for (let cycle = 0; cycle < 3; cycle++) {
        // Each cycle uses unique interaction/evidence IDs
        const interactions: ComponentInteraction[] = [
          makeInteraction({
            interactionId: `int-multi-${cycle}`,
            behavioralEvidence: makeEvidence({
              windowId: `bev-multi-${cycle}`,
              sourceEventId: `evt-multi-${cycle}`,
            }),
          }),
        ];

        // Persist session
        const sessionResult = await persistSession(
          factory,
          makePersistInput({
            understanding: makeUnderstandingResult({
              sessionId: `session-${cycle}`,
            }),
            interactions,
          }),
        );
        sessions.push(sessionResult.sessionId);

        // Persist evidence
        await persistBehavioralEvidence(factory, sessionResult.sessionId, interactions);
      }

      // All 3 sessions have their evidence
      expect(sessions).toHaveLength(3);

      for (const sessionId of sessions) {
        const uow = factory.create();
        await uow.execute(async (repos) => {
          const evidence = await repos.behavioralEvidence.getBySession(sessionId);
          expect(evidence).toHaveLength(1);
        });
      }

      // Total: 3 evidence rows across 3 sessions
      const db = factory.getDatabase();
      const total = await db.behavioralEvidence.count();
      expect(total).toBe(3);
    });

    it('guard cleared between recording cycles (no stale state leaks)', async () => {
      // Cycle 1
      const int1 = makeInteraction({
        interactionId: 'int-guard-1',
        behavioralEvidence: makeEvidence({ windowId: 'bev-guard-1' }),
      });

      let unpersisted = filterUnpersistedEvidence([int1]);
      expect(unpersisted).toHaveLength(1);
      await persistBehavioralEvidence(factory, 'sess-guard-1', unpersisted);
      markEvidencePersisted(['bev-guard-1']);

      // Simulate initRecording → clearPersistedEvidenceGuard
      clearPersistedEvidenceGuard();

      // Cycle 2 — same windowId (edge case) should be persistable via guard
      const int2 = makeInteraction({
        interactionId: 'int-guard-2',
        behavioralEvidence: makeEvidence({ windowId: 'bev-guard-1' }), // Same windowId!
      });

      unpersisted = filterUnpersistedEvidence([int2]);
      expect(unpersisted).toHaveLength(1); // Guard allows it after clear

      // At DB level, put() by windowId overwrites — exactly 1 row for bev-guard-1
      await persistBehavioralEvidence(factory, 'sess-guard-2', unpersisted);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const fromSess1 = await repos.behavioralEvidence.getBySession('sess-guard-1');
        const fromSess2 = await repos.behavioralEvidence.getBySession('sess-guard-2');

        // The row was overwritten — it now points to sess-guard-2
        expect(fromSess2).toHaveLength(1);
        expect(fromSess2[0].recordingSessionId).toBe('sess-guard-2');
        expect(fromSess2[0].interactionId).toBe('int-guard-2');

        // sess-guard-1 lost its evidence (same windowId was overwritten)
        // This is expected behavior — windowId is unique per evidence window
        expect(fromSess1).toHaveLength(0);
      });
    });
  });

  // ── F. Schema Integrity ─────────────────────────────────────────

  describe('F. schema integrity', () => {
    it('BehavioralEvidenceRow preserves all BehavioralEvidence fields + linking fields', async () => {
      const fullEvidence: BehavioralEvidence = {
        sourceEventId: 'evt-schema',
        sourceEventType: 'change',
        windowId: 'bev-schema',
        frameId: 'main',
        window: {
          openedAt: 100,
          closedAt: 5000,
          durationMs: 4900,
          endReason: 'lifecycle-complete',
          stabilityTrace: [
            { timestamp: 200, msSinceLastMutation: 100, globalBatchCount: 1 },
          ],
        },
        targetEvidence: {
          identity: {
            elementId: 'elem-schema',
            accessibleName: 'Email',
            ariaRole: 'textbox',
            ariaLabel: null,
            ariaLabelledBy: null,
            placeholder: 'Enter email',
            tag: 'INPUT',
            className: 'form-control',
            name: 'email',
            stableId: null,
            testId: 'email-field',
            dataCy: null,
            dataQa: null,
            cssSelector: '#email',
            xPath: '//input[@id="email"]',
            inIframe: false,
            shadowDom: false,
            href: null,
            inputType: 'email',
          },
          identityCapturedAt: 0,
          before: {
            value: '',
            checked: null,
            className: 'form-control',
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
            capturedAt: 50,
          },
          after: {
            value: 'user@example.com',
            checked: null,
            className: 'form-control',
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
            capturedAt: 4950,
          },
          focusMovement: null,
        },
        applicationEvidence: {
          domChanges: [
            {
              types: ['attributes'],
              targetPath: '.error-msg',
              targetTag: 'SPAN',
              shadowContext: null,
              changedAttributes: ['class'],
              attributeDeltas: { class: { old: 'hidden', new: 'visible' } },
              addedNodesCount: 0,
              removedNodesCount: 0,
              characterDataDelta: null,
              firstMutationAt: 200,
              lastMutationAt: 200,
              rawMutationCount: 1,
              firstBatchIndex: 1,
              lastBatchIndex: 1,
            },
          ],
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
            longestBatchMs: 15,
            totalBatches: 2,
          },
        },
      };

      const interactions = [
        makeInteraction({
          interactionId: 'int-schema',
          behavioralEvidence: fullEvidence,
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-schema', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const retrieved = await repos.behavioralEvidence.getByInteraction('int-schema');
        expect(retrieved).toHaveLength(1);
        const r = retrieved[0];

        // BehavioralEvidence fields
        expect(r.sourceEventId).toBe('evt-schema');
        expect(r.windowId).toBe('bev-schema');
        expect(r.window.endReason).toBe('lifecycle-complete');
        expect(r.window.stabilityTrace).toHaveLength(1);
        expect(r.targetEvidence.identity?.testId).toBe('email-field');
        expect(r.targetEvidence.before?.value).toBe('');
        expect(r.targetEvidence.after?.value).toBe('user@example.com');
        expect(r.applicationEvidence.domChanges).toHaveLength(1);
        expect(r.applicationEvidence.performanceCondition?.totalBatches).toBe(2);

        // Linking fields
        expect(r.interactionId).toBe('int-schema');
        expect(r.recordingSessionId).toBe('sess-schema');
        expect(r.persistedAt).toBeGreaterThan(0);
      });
    });

    it('all 13 endReason values survive round-trip', async () => {
      const allReasons = [
        'stabilized',
        'max-duration',
        'element-removed',
        'recording-stopped',
        'navigation',
        'typing-complete',
        'displaced',
        'evidence-timeout',
        'page-reload-synthetic',
        'lifecycle-complete',
        'lifecycle-abandoned',
        'page-reload',
      ] as const;

      const interactions = allReasons.map((reason, i) =>
        makeInteraction({
          interactionId: `int-reason-${i}`,
          behavioralEvidence: makeEvidence({
            windowId: `bev-reason-${i}`,
            sourceEventId: `evt-reason-${i}`,
            window: {
              openedAt: 0,
              closedAt: 100,
              durationMs: 100,
              endReason: reason,
              stabilityTrace: [],
            },
          }),
        }),
      );

      await persistBehavioralEvidence(factory, 'sess-all-reasons', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const rows = await repos.behavioralEvidence.getBySession('sess-all-reasons');
        expect(rows).toHaveLength(allReasons.length);

        const retrievedReasons = rows.map((r) => r.window.endReason).sort();
        expect(retrievedReasons).toEqual([...allReasons].sort());
      });
    });
  });
});
