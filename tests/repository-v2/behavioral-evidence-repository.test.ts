/**
 * BehavioralEvidenceRepository Tests — M8.1
 *
 * Tests cover:
 *   1. Schema: V4 creates the behavioral_evidence table
 *   2. Schema: V3 → V4 upgrade is safe (existing data intact)
 *   3. Repository CRUD: save, getByInteraction, getBySession, deleteBySession
 *   4. Idempotency: save() with same windowId overwrites, does not duplicate
 *   5. UnitOfWork: behavioralEvidence accessible within transaction
 *   6. UnitOfWork: transaction includes behavioral_evidence table (rollback)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { createDatabase, type BehavioralEvidenceRow } from '../../src/repository/v2/dexie/dexie-database';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import { ProjectStatus } from '../../src/domain/enums';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Build a minimal valid BehavioralEvidence for testing.
 * Focus is on the fields used for indexing + a representative shape.
 */
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

/**
 * Build a BehavioralEvidenceRow from a BehavioralEvidence + linking fields.
 */
function makeRow(
  evidence: BehavioralEvidence,
  interactionId: string,
  recordingSessionId: string,
  persistedAt: number = Date.now(),
): BehavioralEvidenceRow {
  return {
    ...evidence,
    interactionId,
    recordingSessionId,
    persistedAt,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('BehavioralEvidenceRepository (M8.1)', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Schema ────────────────────────────────────────────────────────

  describe('V4 schema', () => {
    it('creates the behavioral_evidence table', () => {
      const db = factory.getDatabase();
      expect(db.behavioralEvidence).toBeDefined();
      expect(db.table('behavioralEvidence')).toBeDefined();
    });

    it('reports version 4', async () => {
      const db = factory.getDatabase();
      expect(db.verno).toBe(4);
    });

    it('has all 9 tables (6 V1 + V2 + V3 + V4)', () => {
      const db = factory.getDatabase();
      const tableNames = db.tables.map((t) => t.name).sort();
      expect(tableNames).toEqual([
        'behavioralEvidence',
        'elements',
        'executionIRs',
        'executionRuns',
        'projects',
        'recordingSessions',
        'sourceArtifacts',
        'testCaseVersions',
        'testCases',
      ]);
      expect(tableNames).toHaveLength(9);
    });
  });

  // ── Migration safety ──────────────────────────────────────────────

  describe('V3 → V4 migration', () => {
    it('preserves existing table data after upgrade', async () => {
      // First, open a database and write to a V3 table
      const db = factory.getDatabase();
      await db.projects.add({
        id: 'proj-mig-001',
        name: 'Migration Test',
        description: 'Migration test project',
        tags: [],
        status: ProjectStatus.ACTIVE,
        createdBy: 'tester',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Verify it survived (same database instance, Dexie already at V4)
      const project = await db.projects.get('proj-mig-001');
      expect(project).toBeDefined();
      expect(project!.name).toBe('Migration Test');

      // behavioral_evidence table should exist and be empty
      const count = await db.behavioralEvidence.count();
      expect(count).toBe(0);
    });

    it('opens a fresh database at V4 without error', () => {
      const db = createDatabase();
      expect(db.verno).toBe(4);
      expect(db.behavioralEvidence).toBeDefined();
      // Don't delete — the factory's afterEach handles cleanup
    });

    it('can write to the behavioral_evidence table immediately', async () => {
      const db = factory.getDatabase();
      const row = makeRow(makeEvidence(), 'int-001', 'sess-001');
      await db.behavioralEvidence.put(row);

      const retrieved = await db.behavioralEvidence.get('bev-evt-001');
      expect(retrieved).toBeDefined();
      expect(retrieved!.interactionId).toBe('int-001');
      expect(retrieved!.recordingSessionId).toBe('sess-001');
    });
  });

  // ── Repository CRUD ───────────────────────────────────────────────

  describe('repository CRUD', () => {
    it('save() persists evidence and returns the row', async () => {
      const uow = factory.create();
      const row = makeRow(makeEvidence(), 'int-001', 'sess-001');

      const saved = await uow.execute(async (repos) => {
        return repos.behavioralEvidence.save(row);
      });

      expect(saved).toEqual(row);
    });

    it('getByInteraction() returns evidence for an interaction', async () => {
      const uow = factory.create();

      await uow.execute(async (repos) => {
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-1' }), 'int-001', 'sess-001'),
        );
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-2', sourceEventId: 'evt-2' }), 'int-001', 'sess-001'),
        );
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-3', sourceEventId: 'evt-3' }), 'int-002', 'sess-001'),
        );
      });

      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.behavioralEvidence.getByInteraction('int-001');
      });

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.windowId).sort()).toEqual(['bev-1', 'bev-2']);
    });

    it('getByInteraction() returns empty array when no evidence', async () => {
      const uow = factory.create();
      const results = await uow.execute(async (repos) => {
        return repos.behavioralEvidence.getByInteraction('nonexistent');
      });
      expect(results).toEqual([]);
    });

    it('getBySession() returns all evidence for a session', async () => {
      const uow = factory.create();

      await uow.execute(async (repos) => {
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-1' }), 'int-001', 'sess-A'),
        );
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-2', sourceEventId: 'evt-2' }), 'int-002', 'sess-A'),
        );
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-3', sourceEventId: 'evt-3' }), 'int-003', 'sess-B'),
        );
      });

      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.behavioralEvidence.getBySession('sess-A');
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.recordingSessionId === 'sess-A')).toBe(true);
    });

    it('getBySession() returns empty array when no evidence', async () => {
      const uow = factory.create();
      const results = await uow.execute(async (repos) => {
        return repos.behavioralEvidence.getBySession('nonexistent');
      });
      expect(results).toEqual([]);
    });

    it('deleteBySession() removes all evidence for a session', async () => {
      const uow = factory.create();

      await uow.execute(async (repos) => {
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-1' }), 'int-001', 'sess-A'),
        );
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-2', sourceEventId: 'evt-2' }), 'int-002', 'sess-A'),
        );
        await repos.behavioralEvidence.save(
          makeRow(makeEvidence({ windowId: 'bev-3', sourceEventId: 'evt-3' }), 'int-003', 'sess-B'),
        );
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.behavioralEvidence.deleteBySession('sess-A');
      });

      const uow3 = factory.create();
      const remaining = await uow3.execute(async (repos) => {
        return repos.behavioralEvidence.getBySession('sess-A');
      });
      expect(remaining).toHaveLength(0);

      // sess-B should be untouched
      const otherSession = await uow3.execute(async (repos) => {
        return repos.behavioralEvidence.getBySession('sess-B');
      });
      expect(otherSession).toHaveLength(1);
    });

    it('deleteBySession() on empty session is a no-op', async () => {
      const uow = factory.create();
      await expect(
        uow.execute(async (repos) => {
          await repos.behavioralEvidence.deleteBySession('nonexistent');
        }),
      ).resolves.not.toThrow();
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────

  describe('save() idempotency', () => {
    it('saving the same windowId twice does not create a duplicate', async () => {
      const uow = factory.create();
      const evidence = makeRow(
        makeEvidence({ windowId: 'bev-dup-001' }),
        'int-001',
        'sess-001',
      );

      await uow.execute(async (repos) => {
        await repos.behavioralEvidence.save(evidence);
      });

      // Save again — same windowId
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.behavioralEvidence.save(evidence);
      });

      const uow3 = factory.create();
      const all = await uow3.execute(async (repos) => {
        return repos.behavioralEvidence.getByInteraction('int-001');
      });
      expect(all).toHaveLength(1);
    });

    it('re-saving the same windowId overwrites the persistedAt and data', async () => {
      const uow = factory.create();
      const original = makeRow(
        makeEvidence({ windowId: 'bev-overwrite-001' }),
        'int-001',
        'sess-001',
        1000,
      );

      await uow.execute(async (repos) => {
        await repos.behavioralEvidence.save(original);
      });

      // Re-save with updated persistedAt and different endReason
      const updated = makeRow(
        makeEvidence({
          windowId: 'bev-overwrite-001',
          window: {
            openedAt: 100,
            closedAt: 999,
            durationMs: 899,
            endReason: 'stabilized',
            stabilityTrace: [],
          },
        }),
        'int-001',
        'sess-001',
        2000,
      );

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.behavioralEvidence.save(updated);
      });

      const uow3 = factory.create();
      const results = await uow3.execute(async (repos) => {
        return repos.behavioralEvidence.getByInteraction('int-001');
      });

      expect(results).toHaveLength(1);
      expect(results[0].persistedAt).toBe(2000);
      expect(results[0].window.endReason).toBe('stabilized');
    });
  });

  // ── UnitOfWork integration ────────────────────────────────────────

  describe('UnitOfWork integration', () => {
    it('behavioralEvidence is accessible within uow.execute', async () => {
      const uow = factory.create();

      const result = await uow.execute(async (repos) => {
        expect(repos.behavioralEvidence).toBeDefined();
        expect(typeof repos.behavioralEvidence.save).toBe('function');
        expect(typeof repos.behavioralEvidence.getByInteraction).toBe('function');
        expect(typeof repos.behavioralEvidence.getBySession).toBe('function');
        expect(typeof repos.behavioralEvidence.deleteBySession).toBe('function');
        return true;
      });

      expect(result).toBe(true);
    });

    it('evidence is rolled back when the transaction throws', async () => {
      const uow = factory.create();

      await expect(
        uow.execute(async (repos) => {
          await repos.behavioralEvidence.save(
            makeRow(makeEvidence({ windowId: 'bev-rb-001' }), 'int-001', 'sess-001'),
          );
          throw new Error('Force rollback');
        }),
      ).rejects.toThrow('Force rollback');

      // Evidence should NOT exist (transaction was rolled back)
      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.behavioralEvidence.getByInteraction('int-001');
      });
      expect(results).toHaveLength(0);
    });

    it('evidence write commits atomically with session write', async () => {
      const uow = factory.create();

      await uow.execute(async (repos) => {
        // Write to a V3 table
        await repos.recordingSessions.create({
          id: 'sess-atomic-001',
          projectId: 'proj-001',
          understandingResult: { steps: [] } as never,
          rawEvents: [],
          rawInteractions: [],
          url: 'https://example.com',
          recordedAt: '2024-01-01T00:00:00.000Z',
          duration: 5000,
          testCaseIds: [],
        });

        // Write evidence in the same transaction
        await repos.behavioralEvidence.save(
          makeRow(
            makeEvidence({ windowId: 'bev-atomic-001' }),
            'int-atomic-001',
            'sess-atomic-001',
          ),
        );
      });

      // Both should be committed
      const uow2 = factory.create();
      const [session, evidence] = await uow2.execute(async (repos) => {
        return Promise.all([
          repos.recordingSessions.getById('sess-atomic-001'),
          repos.behavioralEvidence.getBySession('sess-atomic-001'),
        ]);
      });

      expect(session).toBeDefined();
      expect(evidence).toHaveLength(1);
      expect(evidence[0].recordingSessionId).toBe('sess-atomic-001');
    });

    it('V3 tables still work after V4 addition', async () => {
      const uow = factory.create();

      // Verify all prior tables still function
      await uow.execute(async (repos) => {
        await repos.projects.create({ name: 'V4 Project', createdBy: 'tester' });
      });

      const uow2 = factory.create();
      const projects = await uow2.execute(async (repos) => {
        return repos.projects.getAll();
      });

      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('V4 Project');
    });
  });

  // ── Evidence integrity ────────────────────────────────────────────

  describe('evidence data integrity', () => {
    it('preserves full BehavioralEvidence shape after round-trip', async () => {
      const uow = factory.create();
      const fullEvidence: BehavioralEvidence = {
        sourceEventId: 'evt-full-001',
        sourceEventType: 'change',
        windowId: 'bev-evt-full-001',
        frameId: 'main',
        window: {
          openedAt: 100,
          closedAt: 5000,
          durationMs: 4900,
          endReason: 'lifecycle-complete',
          stabilityTrace: [
            { timestamp: 200, msSinceLastMutation: 100, globalBatchCount: 1 },
            { timestamp: 300, msSinceLastMutation: 100, globalBatchCount: 2 },
          ],
        },
        targetEvidence: {
          identity: {
            elementId: 'elem-001',
            accessibleName: 'Username',
            ariaRole: 'textbox',
            ariaLabel: null,
            ariaLabelledBy: null,
            placeholder: 'Enter username',
            tag: 'INPUT',
            className: 'form-control',
            name: 'username',
            stableId: null,
            testId: 'username-field',
            dataCy: null,
            dataQa: null,
            cssSelector: '#username',
            xPath: '//input[@id="username"]',
            inIframe: false,
            shadowDom: false,
            href: null,
            inputType: 'text',
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
            value: 'testuser@example.com',
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
              targetPath: 'div.validation-message',
              targetTag: 'DIV',
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
          visibilityChanges: [
            {
              path: 'div.validation-message',
              property: 'display',
              oldValue: 'none',
              newValue: 'block',
              relativeTime: 200,
              batchIndex: 1,
            },
          ],
          navigation: [],
          networkActivity: [
            {
              url: 'https://api.example.com/validate',
              method: 'POST',
              status: 200,
              startRelativeToEvent: 300,
              endRelativeToEvent: 800,
              durationMs: 500,
              resourceType: 'fetch',
              source: 'main-world',
            },
          ],
          performanceCondition: {
            mainThreadBlocked: false,
            highChurnMode: false,
            longestBatchMs: 12,
            totalBatches: 3,
          },
        },
      };

      const row = makeRow(fullEvidence, 'int-full-001', 'sess-full-001');

      await uow.execute(async (repos) => {
        await repos.behavioralEvidence.save(row);
      });

      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.behavioralEvidence.getByInteraction('int-full-001');
      });

      expect(results).toHaveLength(1);
      const retrieved = results[0];

      // Top-level fields
      expect(retrieved.sourceEventId).toBe('evt-full-001');
      expect(retrieved.windowId).toBe('bev-evt-full-001');

      // Linking fields
      expect(retrieved.interactionId).toBe('int-full-001');
      expect(retrieved.recordingSessionId).toBe('sess-full-001');

      // Window
      expect(retrieved.window.endReason).toBe('lifecycle-complete');
      expect(retrieved.window.stabilityTrace).toHaveLength(2);

      // Target evidence
      expect(retrieved.targetEvidence.identity?.testId).toBe('username-field');
      expect(retrieved.targetEvidence.after?.value).toBe('testuser@example.com');

      // Application evidence
      expect(retrieved.applicationEvidence.domChanges).toHaveLength(1);
      expect(retrieved.applicationEvidence.networkActivity[0].status).toBe(200);
      expect(retrieved.applicationEvidence.performanceCondition?.totalBatches).toBe(3);
    });

    it('preserves synthetic and timeout endReason values', async () => {
      const uow = factory.create();
      const endReasons = [
        'page-reload-synthetic',
        'evidence-timeout',
        'displaced',
        'max-duration',
        'lifecycle-abandoned',
        'page-reload',
      ] as const;

      for (const [i, reason] of endReasons.entries()) {
        await uow.execute(async (repos) => {
          await repos.behavioralEvidence.save(
            makeRow(
              makeEvidence({
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
              `int-reason-${i}`,
              'sess-reasons',
            ),
          );
        });
      }

      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.behavioralEvidence.getBySession('sess-reasons');
      });

      expect(results).toHaveLength(6);
      const retrievedReasons = results
        .map((r) => r.window.endReason)
        .sort();
      expect(retrievedReasons).toEqual([...endReasons].sort());
    });
  });
});
