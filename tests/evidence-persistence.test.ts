/**
 * Evidence Persistence Tests — M8.2
 *
 * Tests cover:
 *   1. persistBehavioralEvidence saves all interactions that have behavioralEvidence
 *   2. Each row links to interactionId and recordingSessionId
 *   3. Each row has a persistedAt timestamp
 *   4. Retrieval by session and by interaction returns correct evidence
 *   5. Idempotency — re-persisting same data does not duplicate
 *   6. Interactions without evidence are silently skipped
 *   7. Empty interactions array is handled gracefully
 *   8. persistSession + persistBehavioralEvidence integration — evidence retrievable
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../src/repository/v2/dexie/dexie-unit-of-work-factory';
import {
  persistSession,
  persistBehavioralEvidence,
  type SessionPersistenceInput,
} from '../src/repository/services/session-persistence-service';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';
import type { ExecutionIRPlan } from '../src/domain/execution-ir/types';
import type { SessionEvent } from '../src/shared/types';
import type { ComponentInteraction, ObservedEvent } from '../src/shared/component-types';
import type { BehavioralEvidence } from '../src/shared/behavioral-evidence-types';

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

function makeInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
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

function makeUnderstandingResult(overrides: Partial<UnderstandingResult> = {}): UnderstandingResult {
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

function makePersistInput(overrides: Partial<SessionPersistenceInput> = {}): SessionPersistenceInput {
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

describe('M8.2: persistBehavioralEvidence', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Basic persistence ───────────────────────────────────────────

  describe('basic persistence', () => {
    it('persists evidence for interactions that have behavioralEvidence', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-1',
          behavioralEvidence: makeEvidence({ windowId: 'bev-1', sourceEventId: 'evt-1' }),
        }),
        makeInteraction({
          interactionId: 'int-2',
          behavioralEvidence: makeEvidence({ windowId: 'bev-2', sourceEventId: 'evt-2' }),
        }),
      ];

      const result = await persistBehavioralEvidence(factory, 'sess-1', interactions);

      expect(result.count).toBe(2);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence = await repos.behavioralEvidence.getBySession('sess-1');
        expect(evidence).toHaveLength(2);
      });
    });

    it('links each evidence row to both interactionId and recordingSessionId', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-special',
          behavioralEvidence: makeEvidence({ windowId: 'bev-special' }),
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-special', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence = await repos.behavioralEvidence.getByInteraction('int-special');
        expect(evidence).toHaveLength(1);
        expect(evidence[0].interactionId).toBe('int-special');
        expect(evidence[0].recordingSessionId).toBe('sess-special');
      });
    });

    it('sets persistedAt timestamp on each row', async () => {
      const before = Date.now();
      const interactions = [
        makeInteraction({
          interactionId: 'int-ts',
          behavioralEvidence: makeEvidence({ windowId: 'bev-ts' }),
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-ts', interactions);
      const after = Date.now();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence = await repos.behavioralEvidence.getByInteraction('int-ts');
        expect(evidence[0].persistedAt).toBeGreaterThanOrEqual(before);
        expect(evidence[0].persistedAt).toBeLessThanOrEqual(after);
      });
    });

    it('preserves the full BehavioralEvidence payload in the row', async () => {
      const fullEvidence = makeEvidence({
        windowId: 'bev-full',
        sourceEventId: 'evt-full',
        sourceEventType: 'change',
        targetEvidence: {
          identity: null,
          identityCapturedAt: 0,
          before: { value: 'old', checked: null, className: '', disabled: false,
            ariaExpanded: null, ariaChecked: null, ariaPressed: null,
            textContent: null, childCount: 0, scrollTop: null, scrollLeft: null,
            selectedValues: null, controlledValue: null, capturedAt: 100 },
          after: { value: 'new', checked: null, className: 'active', disabled: false,
            ariaExpanded: null, ariaChecked: null, ariaPressed: null,
            textContent: null, childCount: 0, scrollTop: null, scrollLeft: null,
            selectedValues: null, controlledValue: null, capturedAt: 500 },
          focusMovement: null,
        },
      });

      const interactions = [
        makeInteraction({
          interactionId: 'int-full',
          behavioralEvidence: fullEvidence,
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-full', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence = await repos.behavioralEvidence.getByInteraction('int-full');
        expect(evidence).toHaveLength(1);
        expect(evidence[0].windowId).toBe('bev-full');
        expect(evidence[0].sourceEventId).toBe('evt-full');
        expect(evidence[0].sourceEventType).toBe('change');
        expect(evidence[0].targetEvidence.before?.value).toBe('old');
        expect(evidence[0].targetEvidence.after?.value).toBe('new');
        expect(evidence[0].targetEvidence.after?.className).toBe('active');
      });
    });
  });

  // ── Skipping interactions without evidence ─────────────────────

  describe('skipping interactions without evidence', () => {
    it('skips interactions where behavioralEvidence is undefined', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-with-ev',
          behavioralEvidence: makeEvidence({ windowId: 'bev-has' }),
        }),
        makeInteraction({
          interactionId: 'int-no-ev',
          behavioralEvidence: undefined,
        }),
      ];

      const result = await persistBehavioralEvidence(factory, 'sess-mixed', interactions);

      expect(result.count).toBe(1);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const all = await repos.behavioralEvidence.getBySession('sess-mixed');
        expect(all).toHaveLength(1);
        expect(all[0].windowId).toBe('bev-has');
      });
    });

    it('handles empty interactions array gracefully', async () => {
      const result = await persistBehavioralEvidence(factory, 'sess-empty', []);

      expect(result.count).toBe(0);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const all = await repos.behavioralEvidence.getBySession('sess-empty');
        expect(all).toHaveLength(0);
      });
    });

    it('handles all interactions without evidence', async () => {
      const interactions = [
        makeInteraction({ interactionId: 'int-a', behavioralEvidence: undefined }),
        makeInteraction({ interactionId: 'int-b', behavioralEvidence: undefined }),
      ];

      const result = await persistBehavioralEvidence(factory, 'sess-none', interactions);

      expect(result.count).toBe(0);
    });
  });

  // ── Retrieval ───────────────────────────────────────────────────

  describe('retrieval', () => {
    it('retrieves evidence by session ID across multiple interactions', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-a',
          behavioralEvidence: makeEvidence({ windowId: 'bev-a', sourceEventId: 'evt-a' }),
        }),
        makeInteraction({
          interactionId: 'int-b',
          behavioralEvidence: makeEvidence({ windowId: 'bev-b', sourceEventId: 'evt-b' }),
        }),
        makeInteraction({
          interactionId: 'int-c',
          behavioralEvidence: makeEvidence({ windowId: 'bev-c', sourceEventId: 'evt-c' }),
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-multi', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const bySession = await repos.behavioralEvidence.getBySession('sess-multi');
        expect(bySession).toHaveLength(3);

        const byInteraction = await repos.behavioralEvidence.getByInteraction('int-b');
        expect(byInteraction).toHaveLength(1);
        expect(byInteraction[0].windowId).toBe('bev-b');
      });
    });

    it('returns empty array for non-existent session', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const result = await repos.behavioralEvidence.getBySession('non-existent');
        expect(result).toEqual([]);
      });
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────

  describe('idempotency', () => {
    it('does not create duplicates when persisting the same evidence twice', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-dup',
          behavioralEvidence: makeEvidence({ windowId: 'bev-dup', sourceEventId: 'evt-dup' }),
        }),
      ];

      // Persist once
      await persistBehavioralEvidence(factory, 'sess-dup', interactions);
      // Persist again with same data
      await persistBehavioralEvidence(factory, 'sess-dup', interactions);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const all = await repos.behavioralEvidence.getBySession('sess-dup');
        expect(all).toHaveLength(1); // Not 2
        expect(all[0].windowId).toBe('bev-dup');
      });
    });

    it('updates persistedAt on re-persist (overwrite, not duplicate)', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-overwrite',
          behavioralEvidence: makeEvidence({ windowId: 'bev-overwrite' }),
        }),
      ];

      const t0 = Date.now();
      await persistBehavioralEvidence(factory, 'sess-overwrite', interactions);
      // Wait to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      await persistBehavioralEvidence(factory, 'sess-overwrite', interactions);
      const t2 = Date.now();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const all = await repos.behavioralEvidence.getBySession('sess-overwrite');
        expect(all).toHaveLength(1);
        // The second persist should have updated persistedAt
        expect(all[0].persistedAt).toBeGreaterThan(t0);
        expect(all[0].persistedAt).toBeLessThanOrEqual(t2);
      });
    });
  });

  // ── Integration with persistSession ─────────────────────────────

  describe('integration with persistSession', () => {
    it('persists session then evidence — evidence retrievable by returned sessionId', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-integration',
          behavioralEvidence: makeEvidence({ windowId: 'bev-integration' }),
        }),
      ];

      // Step 1: persist the session
      const sessionResult = await persistSession(factory, makePersistInput({ interactions }));

      // Step 2: persist the evidence using the returned sessionId
      const evidenceResult = await persistBehavioralEvidence(
        factory,
        sessionResult.sessionId,
        interactions,
      );

      expect(evidenceResult.count).toBe(1);

      // Verify evidence is retrievable by the session ID
      const uow = factory.create();
      await uow.execute(async (repos) => {
        const evidence = await repos.behavioralEvidence.getBySession(sessionResult.sessionId);
        expect(evidence).toHaveLength(1);
        expect(evidence[0].interactionId).toBe('int-integration');
        expect(evidence[0].recordingSessionId).toBe(sessionResult.sessionId);
      });
    });

    it('persists multiple interactions with mixed evidence after session creation', async () => {
      const interactions = [
        makeInteraction({
          interactionId: 'int-click',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-click',
            sourceEventId: 'evt-click',
            sourceEventType: 'click',
          }),
        }),
        makeInteraction({
          interactionId: 'int-no-ev',
          behavioralEvidence: undefined,
        }),
        makeInteraction({
          interactionId: 'int-text',
          behavioralEvidence: makeEvidence({
            windowId: 'bev-text',
            sourceEventId: 'evt-text',
            sourceEventType: 'input',
          }),
        }),
      ];

      const sessionResult = await persistSession(factory, makePersistInput({ interactions }));
      const evidenceResult = await persistBehavioralEvidence(
        factory,
        sessionResult.sessionId,
        interactions,
      );

      expect(evidenceResult.count).toBe(2); // int-click + int-text, int-no-ev skipped

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const all = await repos.behavioralEvidence.getBySession(sessionResult.sessionId);
        expect(all).toHaveLength(2);
        const windowIds = all.map((e) => e.windowId).sort();
        expect(windowIds).toEqual(['bev-click', 'bev-text']);
      });
    });
  });

  // ── Multiple sessions isolation ─────────────────────────────────

  describe('multiple sessions isolation', () => {
    it('evidence from different sessions is isolated', async () => {
      const interactionsA = [
        makeInteraction({
          interactionId: 'int-a',
          behavioralEvidence: makeEvidence({ windowId: 'bev-a' }),
        }),
      ];
      const interactionsB = [
        makeInteraction({
          interactionId: 'int-b',
          behavioralEvidence: makeEvidence({ windowId: 'bev-b', sourceEventId: 'evt-b' }),
        }),
      ];

      await persistBehavioralEvidence(factory, 'sess-A', interactionsA);
      await persistBehavioralEvidence(factory, 'sess-B', interactionsB);

      const uow = factory.create();
      await uow.execute(async (repos) => {
        const fromA = await repos.behavioralEvidence.getBySession('sess-A');
        const fromB = await repos.behavioralEvidence.getBySession('sess-B');

        expect(fromA).toHaveLength(1);
        expect(fromA[0].windowId).toBe('bev-a');
        expect(fromB).toHaveLength(1);
        expect(fromB[0].windowId).toBe('bev-b');
      });
    });
  });
});
