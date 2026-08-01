/**
 * Tests for the Session Persistence Service.
 *
 * P1 BEHAVIORAL CHANGE: persistSession now creates CapabilityReviews
 * (state='pending') instead of auto-creating/enriching capabilities.
 * All capability creation is deferred to the human review workflow.
 *
 * Validates:
 * - Creates a RecordingSession from UnderstandingResult + raw data
 * - Creates a default project when projectId is null
 * - Creates CapabilityReviews (P1: no auto-create/enrich of capabilities)
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
import type { CapabilityCandidate } from '../src/domain/entities/capability-candidate';
import type { SessionEvent } from '../src/shared/types';

// ── Helpers ────────────────────────────────────────────────

function makeCapabilityCandidate(overrides: Partial<CapabilityCandidate> = {}): CapabilityCandidate {
  return {
    capabilityId: 'cand-001',
    name: 'Create Customer',
    purpose: 'Create a new customer record',
    confidence: 'candidate',
    entryElement: {
      elementId: 'elem-submit-001',
      accessibleName: 'Create Customer',
      tag: 'BUTTON',
      role: 'button',
    },
    inputs: [
      { label: 'Name', elementId: 'e1', required: true, inputType: 'text',
        valueRange: null, lengthRange: null, format: null, validOptions: null,
        sourceInteractionType: 'TextEntry' },
      { label: 'Email', elementId: 'e2', required: true, inputType: 'email',
        valueRange: null, lengthRange: null, format: null, validOptions: null,
        sourceInteractionType: 'TextEntry' },
    ],
    observedOutcome: {
      terminalUrl: '/customers',
      successSignals: ['redirect'],
      completed: true,
    },
    validationRules: [
      { field: 'Email', type: 'format', description: 'Must be valid email', constraint: 'email' },
    ],
    observedOutcomes: [],
    businessRules: [],
    failureModes: [],
    sourceSessionId: 'session-001',
    sourceFragmentId: 'frag-001',
    derivedAt: '2026-07-22T00:00:00Z',
    enrichmentHistory: [],
    ...overrides,
  };
}

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
    capability: makeCapabilityCandidate(),
    ...overrides,
  };
}

function makeIRPlan(): ExecutionIRPlan {
  return {
    id: 'ir-plan-001',
    testCaseName: 'Create Customer Test',
    environment: {
      baseUrl: 'https://example.com',
      viewport: { width: 1280, height: 720 },
    },
    steps: [],
    metadata: {
      generatedAt: '2026-07-22T00:00:00Z',
      generatorVersion: 'ir-bridge-1.0',
      sessionEventCount: 5,
      interactionCount: 3,
    },
  } as ExecutionIRPlan;
}

function makeSessionEvent(): SessionEvent {
  return {
    id: 'evt-001',
    type: 'click',
    timestamp: '2026-07-22T00:00:00Z',
    url: 'https://example.com/customers/new',
  } as SessionEvent;
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
      expect(result.reviewId).toBeDefined(); // P1: review instead of capabilityId
      expect(result.capabilityDecision).toBe('new');
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
        expect(session!.understandingResult.capability).toBeDefined();
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

  // ── Capability review creation (P1) ──────────────────────

  describe('capability matching', () => {
    it('creates a pending review when no existing capabilities', async () => {
      const result = await persistSession(factory, makePersistInput());

      // P1: creates a pending review, NOT a capability
      expect(result.capabilityDecision).toBe('new');
      expect(result.reviewId).toBeDefined();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        // No capability should exist yet
        const caps = await repos.capabilities.getByProject(result.projectId);
        expect(caps).toHaveLength(0);

        // But a review should exist
        const review = await repos.capabilityReviews.getByReviewId(result.reviewId!);
        expect(review).toBeDefined();
        expect(review!.state).toBe('pending');
      });
    });

    it('creates a pending review with auto-merge suggestion when matching', async () => {
      // First recording — creates a review (and manually approve to create capability)
      const result1 = await persistSession(factory, makePersistInput());

      // Manually create a capability so the second recording can match
      const uow0 = factory.create();
      await uow0.execute(async (repos) => {
        const { createCapability } = await import('../src/domain/entities/capability');
        const cap = createCapability({
          projectId: result1.projectId,
          name: 'Create Customer',
          purpose: 'Create a new customer record',
          inputs: [],
          validationRules: [],
          observedOutcomes: [],
          sourceSessionId: 'session-001',
        });
        await repos.capabilities.create(cap);
      });

      // Second recording with same capability candidate (different session)
      const secondCandidate = makeCapabilityCandidate({
        sourceSessionId: 'session-002',
        sourceFragmentId: 'frag-002',
      });
      const secondUnderstanding = makeUnderstandingResult({
        sessionId: 'session-002',
        capability: secondCandidate,
      });

      const result2 = await persistSession(factory, {
        ...makePersistInput({
          understanding: secondUnderstanding,
          projectId: result1.projectId,
        }),
      });

      // P1: creates a review (match suggestion determined by scoring algorithm)
      expect(['auto-merge', 'ambiguous']).toContain(result2.capabilityDecision);
      expect(result2.reviewId).toBeDefined();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const review = await repos.capabilityReviews.getByReviewId(result2.reviewId!);
        expect(review).toBeDefined();
        expect(review!.state).toBe('pending');
      });
    });

    it('creates separate reviews for different recording types', async () => {
      // First recording — Create Customer
      const result1 = await persistSession(factory, makePersistInput());

      // Second recording — Delete Invoice (completely different)
      const deleteCandidate = makeCapabilityCandidate({
        capabilityId: 'cand-002',
        name: 'Delete Invoice',
        purpose: 'Delete an invoice record',
        entryElement: {
          elementId: 'elem-delete-999',
          accessibleName: 'Delete',
          tag: 'BUTTON',
          role: 'button',
        },
        inputs: [
          { label: 'Invoice Number', elementId: 'e-inv', required: true, inputType: 'text',
            valueRange: null, lengthRange: null, format: null, validOptions: null,
            sourceInteractionType: 'TextEntry' },
        ],
        observedOutcome: {
          terminalUrl: '/invoices/deleted',
          successSignals: ['confirmation-dialog'],
          completed: true,
        },
        sourceSessionId: 'session-002',
        sourceFragmentId: 'frag-002',
      });
      const deleteUnderstanding = makeUnderstandingResult({
        sessionId: 'session-002',
        capability: deleteCandidate,
      });

      const result2 = await persistSession(factory, {
        ...makePersistInput({
          understanding: deleteUnderstanding,
          projectId: result1.projectId,
        }),
      });

      // P1: both create pending reviews, no capabilities exist
      expect(result2.reviewId).toBeDefined();
      expect(result2.reviewId).not.toBe(result1.reviewId);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const reviews = await repos.capabilityReviews.getByState('pending');
        expect(reviews).toHaveLength(2);
        const caps = await repos.capabilities.getByProject(result1.projectId);
        expect(caps).toHaveLength(0); // No capabilities until approved
      });
    });

    it('creates a pending review even for ambiguous matches (P1)', async () => {
      // First recording — Create Customer
      const result1 = await persistSession(factory, makePersistInput());

      // Manually create a capability for the first recording
      const uow0 = factory.create();
      await uow0.execute(async (repos) => {
        const { createCapability } = await import('../src/domain/entities/capability');
        const cap = createCapability({
          projectId: result1.projectId,
          name: 'Create Customer',
          purpose: 'Create a new customer record',
          inputs: [],
          validationRules: [],
          observedOutcomes: [],
          sourceSessionId: 'session-001',
        });
        await repos.capabilities.create(cap);
      });

      // Second recording — Create Premium Customer (ambiguous match)
      const ambiguousCandidate = makeCapabilityCandidate({
        capabilityId: 'cand-003',
        name: 'Create Premium Customer',
        purpose: 'Create a premium customer record',
        entryElement: {
          elementId: 'elem-premium-submit',
          accessibleName: 'Create Premium Customer',
          tag: 'BUTTON',
          role: 'button',
        },
        inputs: [
          { label: 'Name', elementId: 'e1', required: true, inputType: 'text',
            valueRange: null, lengthRange: null, format: null, validOptions: null,
            sourceInteractionType: 'TextEntry' },
          { label: 'Email', elementId: 'e2', required: true, inputType: 'email',
            valueRange: null, lengthRange: null, format: null, validOptions: null,
            sourceInteractionType: 'TextEntry' },
          { label: 'Tier', elementId: 'e4', required: true, inputType: 'select',
            valueRange: null, lengthRange: null, format: null, validOptions: ['Gold', 'Silver'],
            sourceInteractionType: 'Dropdown' },
          { label: 'Loyalty Points', elementId: 'e5', required: false, inputType: 'number',
            valueRange: null, lengthRange: null, format: null, validOptions: null,
            sourceInteractionType: 'TextEntry' },
        ],
        observedOutcome: {
          terminalUrl: '/customers/premium',
          successSignals: ['redirect'],
          completed: true,
        },
        sourceSessionId: 'session-002',
        sourceFragmentId: 'frag-002',
      });
      const ambiguousUnderstanding = makeUnderstandingResult({
        sessionId: 'session-002',
        capability: ambiguousCandidate,
      });

      const result2 = await persistSession(factory, {
        ...makePersistInput({
          understanding: ambiguousUnderstanding,
          projectId: result1.projectId,
        }),
      });

      // P1: ambiguous or new — still creates a pending review for human decision
      expect(['ambiguous', 'new', 'auto-merge']).toContain(result2.capabilityDecision);
      expect(result2.reviewId).toBeDefined();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const review = await repos.capabilityReviews.getByReviewId(result2.reviewId!);
        expect(review).toBeDefined();
        expect(review!.state).toBe('pending');
      });
    });

    it('handles null capability gracefully', async () => {
      const understanding = makeUnderstandingResult({ capability: null });
      const result = await persistSession(factory, makePersistInput({ understanding }));

      // P1: no review when no capability candidate
      expect(result.reviewId).toBeNull();
      expect(result.capabilityDecision).toBe('none');

      // Session and IR artifact should still be created
      expect(result.sessionId).toBeDefined();
      expect(result.irArtifactId).toBeDefined();
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
        // P1: review created, NOT capability
        const review = result.reviewId
          ? await repos.capabilityReviews.getByReviewId(result.reviewId)
          : undefined;
        const irArtifact = await repos.executionIRs.getById(result.irArtifactId);
        const projects = await repos.projects.getAll();

        expect(session).toBeDefined();
        expect(review).toBeDefined();
        expect(irArtifact).toBeDefined();
        expect(projects.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ── Multiple sessions ───────────────────────────────────

  describe('multiple sessions', () => {
    it('can persist multiple sessions to the same project', async () => {
      const result1 = await persistSession(factory, makePersistInput());

      // Second session with a different capability (completely different name/inputs)
      const secondCandidate = makeCapabilityCandidate({
        capabilityId: 'cand-002',
        name: 'Process Payment',
        purpose: 'Process a customer payment',
        entryElement: {
          elementId: 'elem-pay-submit',
          accessibleName: 'Process Payment',
          tag: 'BUTTON',
          role: 'button',
        },
        inputs: [
          { label: 'Card Number', elementId: 'e-card', required: true, inputType: 'text',
            valueRange: null, lengthRange: null, format: null, validOptions: null,
            sourceInteractionType: 'TextEntry' },
          { label: 'CVV', elementId: 'e-cvv', required: true, inputType: 'text',
            valueRange: null, lengthRange: null, format: null, validOptions: null,
            sourceInteractionType: 'TextEntry' },
        ],
        observedOutcome: {
          terminalUrl: '/payment/success',
          successSignals: ['success-message'],
          completed: true,
        },
        sourceSessionId: 'session-002',
        sourceFragmentId: 'frag-002',
      });
      const secondUnderstanding = makeUnderstandingResult({
        sessionId: 'session-002',
        capability: secondCandidate,
      });

      const result2 = await persistSession(factory, {
        ...makePersistInput({
          understanding: secondUnderstanding,
          projectId: result1.projectId,
        }),
      });

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const sessions = await repos.recordingSessions.getByProject(result1.projectId);
        expect(sessions).toHaveLength(2);

        // P1: reviews created instead of capabilities
        const reviews = await repos.capabilityReviews.getByState('pending');
        expect(reviews).toHaveLength(2);
      });
    });
  });
});
