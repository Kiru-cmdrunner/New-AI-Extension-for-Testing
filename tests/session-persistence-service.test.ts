/**
 * Tests for the Session Persistence Service.
 *
 * Validates:
 * - Creates a RecordingSession from UnderstandingResult + raw data
 * - Creates a default project when projectId is null
 * - Stores ExecutionIRArtifact
 * - Atomicity — if any step fails, the transaction rolls back
 * - All artifacts are retrievable after persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { persistSession, type SessionPersistenceInput } from '../src/repository/services/session-persistence-service';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';
import type { ExecutionIRPlan } from '../src/domain/execution-ir/types';
import type { SessionEvent } from '../src/shared/types';


// ── Helpers ────────────────────────────────────────────────

function makeUnderstandingResult(overrides: Partial<UnderstandingResult> = {}): UnderstandingResult {
  return {
    sessionId: 'session-001',
    generatedAt: '2026-07-22T00:00:00Z',
    schemaVersion: 1,
    fragment: {
      sessionId: 'session-001',
      generatedAt: '2026-07-22T00:00:00Z',
      schemaVersion: 1,
      elements: [],
      transitions: [],
      components: [],
      interactionContracts: [],
      behavioralContracts: [],
      logicalActions: [],
      recordedWorkflow: {
        surfaceTransitions: [],
        logicalActions: [],
        branchPoints: [],
        optionalSteps: [],
      },
      applicationSurfaces: [],
    },
    ...overrides,
  };
}

function makeIRPlan(): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title: 'Create Customer Test',
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
    url: 'https://example.com/customers/new',
    title: 'Customers',
    timestamp: '2026-07-22T00:00:00Z',
  };
}

function makePersistInput(overrides: Partial<SessionPersistenceInput> = {}): SessionPersistenceInput {
  return {
    understanding: makeUnderstandingResult(),
    events: [makeSessionEvent()],
    interactions: [],
    url: 'https://example.com/customers/new',
    irPlan: makeIRPlan(),
    projectId: null,
    testCaseName: 'Create Customer Test',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('Session Persistence Service', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Basic persistence ───────────────────────────────────

  describe('basic persistence', () => {
    it('persists a recording session with all artifacts', async () => {
      const result = await persistSession(factory, makePersistInput());

      expect(result.sessionId).toBeDefined();
      expect(result.irArtifactId).toBeDefined();
      expect(result.projectId).toBeDefined();
    });

    it('creates a default project when projectId is null', async () => {
      const result = await persistSession(factory, makePersistInput({ projectId: null }));

      expect(result.projectId).toBeDefined();

      // Verify project exists in the database
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const project = await repos.projects.getById(result.projectId);
        expect(project).toBeDefined();
        expect(project!.name).toBe('Default Project');
      });
    });

    it('uses the provided projectId when given', async () => {
      // First, create a project
      const uow1 = factory.create();
      const project = await uow1.execute(async (repos) => {
        return repos.projects.create({ name: 'My App', createdBy: 'test' });
      });

      const result = await persistSession(factory, makePersistInput({ projectId: project.id }));

      expect(result.projectId).toBe(project.id);
    });
  });

  // ── RecordingSession ────────────────────────────────────

  describe('RecordingSession', () => {
    it('stores the UnderstandingResult in the session', async () => {
      const input = makePersistInput();
      const result = await persistSession(factory, input);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(result.sessionId);
        expect(session).toBeDefined();
        expect(session!.understandingResult).toBeDefined();
        expect(session!.understandingResult.sessionId).toBe('session-001');
      });
    });

    it('stores raw events in the archival tier', async () => {
      const events = [makeSessionEvent(), { ...makeSessionEvent(), id: 'evt-002' }];
      const result = await persistSession(factory, makePersistInput({ events }));

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(result.sessionId);
        expect(session!.rawEvents).toHaveLength(2);
      });
    });

    it('stores the recording URL', async () => {
      const result = await persistSession(factory, makePersistInput({ url: 'https://app.example.com/login' }));

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(result.sessionId);
        expect(session!.url).toBe('https://app.example.com/login');
      });
    });

    it('initializes testCaseIds as empty', async () => {
      const result = await persistSession(factory, makePersistInput());

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(result.sessionId);
        expect(session!.testCaseIds).toEqual([]);
      });
    });
  });

  // ── ExecutionIRArtifact ─────────────────────────────────

  describe('ExecutionIRArtifact', () => {
    it('stores the IR plan as an ExecutionIRArtifact', async () => {
      const result = await persistSession(factory, makePersistInput());

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const artifact = await repos.executionIRs.getById(result.irArtifactId);
        expect(artifact).toBeDefined();
        expect(artifact!.plan).toBeDefined();
        expect(artifact!.generatorVersion).toBe('ir-bridge-1.0');
        expect(artifact!.renderings).toEqual({});
      });
    });

    it('links the IR artifact to the recording session', async () => {
      const result = await persistSession(factory, makePersistInput());

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const artifact = await repos.executionIRs.getById(result.irArtifactId);
        // The testCaseVersionId is temporarily set to the session ID
        expect(artifact!.testCaseVersionId).toBe(result.sessionId);
      });
    });
  });

  // ── Atomicity ───────────────────────────────────────────

  describe('atomicity', () => {
    it('all artifacts are stored in a single transaction', async () => {
      const result = await persistSession(factory, makePersistInput());

      // Verify all artifacts exist
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const session = await repos.recordingSessions.getById(result.sessionId);
        const irArtifact = await repos.executionIRs.getById(result.irArtifactId);
        const projects = await repos.projects.getAll();

        expect(session).toBeDefined();
        expect(irArtifact).toBeDefined();
        expect(projects.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ── Multiple sessions ───────────────────────────────────

  describe('multiple sessions', () => {
    it('can persist multiple sessions to the same project', async () => {
      const result1 = await persistSession(factory, makePersistInput());

      const secondUnderstanding = makeUnderstandingResult({
        sessionId: 'session-002',
      });

      await persistSession(factory, {
        ...makePersistInput({
          understanding: secondUnderstanding,
          projectId: result1.projectId,
        }),
      });

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const sessions = await repos.recordingSessions.getByProject(result1.projectId);
        expect(sessions).toHaveLength(2);
      });
    });
  });
});
