/**
 * Phase 1.4.3 Integration Verification
 *
 * Verifies that the three UnitOfWork call-site migrations actually work:
 *   1. Pre-execution staleness check reads Elements from Repository
 *   2. ExecutionRun records persist and are retrievable
 *   3. Runtime locator healing persists healed locators
 *
 * These tests exercise the real Dexie implementation (via fake-indexeddb),
 * reproducing the exact code paths used in service-worker.ts and
 * ir-executor-impl.ts — but with mocked Chrome APIs stripped away.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { DexieUnitOfWorkFactory } from '../src/repository/v2/dexie/dexie-unit-of-work-factory';
import type { UnitOfWorkFactory } from '../src/repository/v2/interfaces/unit-of-work';
import type { Element } from '../src/domain/entities/element';
import { LocatorStrategyType } from '../src/domain/enums';
import { checkStaleness } from '../src/domain/execution-ir/staleness';
import type { ExecutionIRArtifact } from '../src/domain/execution-ir/types';
import { createExecutionRun } from '../src/domain/entities/execution-run';
import { healElementAndPersist } from '../src/repository/services/healing-service';
import type { RankedLocator } from '../src/domain/locator-ranking';
import type { IRExecutionResult } from '../src/domain/execution-ir/adapters/ir-executor';

// ── Test Helpers ────────────────────────────────────────────────────

/** Create a minimal ExecutionIRPlan for staleness tests. */
function makeIRPlan(elementIds: string[]): ExecutionIRArtifact['plan'] {
  return {
    irVersion: '1.0',
    irSchemaVersion: 1,
    testCaseId: 'tc-test-1',
    testCaseVersionId: 'tcv-test-1',
    environment: {
      baseUrl: 'https://example.com',
      browser: 'chromium',
      viewport: { width: 1280, height: 720 },
    },
    steps: elementIds.map((id, i) => ({
      stepId: `step-${i + 1}`,
      order: i + 1,
      description: `Step ${i + 1}`,
      action: {
        type: 'CLICK' as const,
        target: { kind: 'element' as const, elementId: id, elementName: `Element ${i + 1}` },
      },
      assertions: [],
    })),
  } as ExecutionIRArtifact['plan'];
}

/** Create a minimal IRExecutionResult for ExecutionRun tests. */
function makeExecutionResult(status: 'passed' | 'failed' = 'passed'): IRExecutionResult {
  return {
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:05.000Z',
    durationMs: 5000,
    stepResults: [
      {
        stepId: 'step-1',
        order: 1,
        status: status === 'passed' ? 'passed' : 'failed',
        durationMs: 1000,
        assertionResults: [],
      },
    ],
  } as IRExecutionResult;
}

// ── Shared setup ────────────────────────────────────────────────────

describe('Phase 1.4.3 — UnitOfWork call-site integration verification', () => {
  let factory: UnitOfWorkFactory;

  beforeEach(() => {
    // Each DexieUnitOfWorkFactory creates its own Dexie database instance.
    // Dexie uses a unique DB name per factory, so tests are naturally isolated.
    factory = new DexieUnitOfWorkFactory();
  });

  // ═══════════════════════════════════════════════════════════════════
  // Feature 1: Pre-execution staleness check
  //
  // Mirrors the exact code path in service-worker.ts handleRunTest():
  //   uowFactory.create() → uow.execute(async (repos) => { repos.elements.getById(...) })
  //   → checkStaleness(artifact, elements, version)
  // ═══════════════════════════════════════════════════════════════════

  describe('Feature 1: Pre-execution staleness check', () => {
    it('reads Elements from the Repository via uow.execute()', async () => {
      // ── Setup: create a project + element in the Repository ──
      const { elementId } = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        const element = await repos.elements.create({
          projectId: project.id,
          logicalName: 'Submit Button',
          locatorStrategies: [
            { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
          ],
        });
        return { elementId: element.id };
      });

      // ── Act: reproduce the exact staleness-check code path ──
      const uow = factory.create();
      const referencedElements: Element[] = [];

      // This is the pattern from service-worker.ts after the fix
      const elements = await uow.execute(async (repos) => {
        const result: Element[] = [];
        for (const id of [elementId]) {
          const el = await repos.elements.getById(id);
          if (el) result.push(el);
        }
        return result;
      });
      referencedElements.push(...elements);

      // ── Assert: the Element was actually loaded ──
      expect(referencedElements).toHaveLength(1);
      expect(referencedElements[0].id).toBe(elementId);
      expect(referencedElements[0].logicalName).toBe('Submit Button');
    });

    it('detects staleness when an Element was updated after IR generation', async () => {
      // ── Setup ──
      const { elementId, elementUpdatedAt } = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        const element = await repos.elements.create({
          projectId: project.id,
          logicalName: 'Submit Button',
          locatorStrategies: [
            { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
          ],
        });
        return { elementId: element.id, elementUpdatedAt: element.updatedAt };
      });

      // ── Simulate: IR was generated BEFORE the element was last updated ──
      // The element's updatedAt is "now". Generate IR at epoch (before "now").
      const irGeneratedAt = '2020-01-01T00:00:00.000Z'; // before element.createdAt

      const artifact: ExecutionIRArtifact = {
        id: 'art-1',
        testCaseVersionId: 'tcv-1',
        plan: makeIRPlan([elementId]),
        generatedAt: irGeneratedAt,
        generatorVersion: 'ir-bridge-1.0',
        renderings: {},
      };

      // ── Act: load element + check staleness ──
      const uow = factory.create();
      const elements = await uow.execute(async (repos) => {
        const result: Element[] = [];
        const el = await repos.elements.getById(elementId);
        if (el) result.push(el);
        return result;
      });

      const report = checkStaleness(artifact, elements, 'ir-bridge-1.0');

      // ── Assert: staleness detected (element.updatedAt > artifact.generatedAt) ──
      expect(report.status).toBe('stale');
      expect(report.reasons).toBeDefined();
      expect(report.reasons!.some(r => r.type === 'element_changed')).toBe(true);
    });

    it('reports fresh when no Elements changed since IR generation', async () => {
      // ── Setup ──
      const { elementId } = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        const element = await repos.elements.create({
          projectId: project.id,
          logicalName: 'Submit Button',
          locatorStrategies: [
            { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
          ],
        });
        return { elementId: element.id };
      });

      // IR generated far in the future — element hasn't changed since
      const artifact: ExecutionIRArtifact = {
        id: 'art-1',
        testCaseVersionId: 'tcv-1',
        plan: makeIRPlan([elementId]),
        generatedAt: '2099-12-31T23:59:59.000Z',
        generatorVersion: 'ir-bridge-1.0',
        renderings: {},
      };

      const uow = factory.create();
      const elements = await uow.execute(async (repos) => {
        const result: Element[] = [];
        const el = await repos.elements.getById(elementId);
        if (el) result.push(el);
        return result;
      });

      const report = checkStaleness(artifact, elements, 'ir-bridge-1.0');

      expect(report.status).toBe('fresh');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Feature 2: ExecutionRun persistence
  //
  // Mirrors the exact code path in service-worker.ts handleRunTest():
  //   uowFactory.create() → uow.execute(async (repos) => {
  //     repos.executionRuns.save(run)
  //   })
  //   → executionRunId = run.id
  // ═══════════════════════════════════════════════════════════════════

  describe('Feature 2: ExecutionRun persistence', () => {
    it('persists an ExecutionRun via uow.execute() and retrieves it', async () => {
      // ── Setup: ensure a project exists ──
      const projectId = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        return project.id;
      });

      // ── Act: reproduce the exact ExecutionRun persistence code path ──
      const run = createExecutionRun({
        testCaseId: 'tc-1',
        testCaseVersionId: 'tcv-1',
        projectId,
        result: makeExecutionResult('passed'),
        environment: {
          baseUrl: 'https://example.com',
          browser: 'chromium',
          viewport: { width: 1280, height: 720 },
        },
        healedElementIds: [],
      });

      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.executionRuns.save(run);
      });

      // ── Assert: retrieve it back from the Repository ──
      const retrieved = await factory.create().execute(async (repos) => {
        return repos.executionRuns.getById(run.id);
      });

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(run.id);
      expect(retrieved!.testCaseId).toBe('tc-1');
      expect(retrieved!.testCaseVersionId).toBe('tcv-1');
      expect(retrieved!.status).toBe('passed');
      expect(retrieved!.projectId).toBe(projectId);
    });

    it('retrieves ExecutionRuns by testCaseVersionId', async () => {
      const projectId = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        return project.id;
      });

      // Use a unique version ID for this test to avoid cross-test contamination
      const versionId = 'tcv-isolation-test';

      // Save two runs for the same version
      const run1 = createExecutionRun({
        testCaseId: 'tc-isolation',
        testCaseVersionId: versionId,
        projectId,
        result: makeExecutionResult('passed'),
        environment: {
          baseUrl: 'https://example.com',
          browser: 'chromium',
          viewport: { width: 1280, height: 720 },
        },
        healedElementIds: [],
      });

      const run2 = createExecutionRun({
        testCaseId: 'tc-isolation',
        testCaseVersionId: versionId,
        projectId,
        result: makeExecutionResult('failed'),
        environment: {
          baseUrl: 'https://example.com',
          browser: 'chromium',
          viewport: { width: 1280, height: 720 },
        },
        healedElementIds: [],
      });

      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.executionRuns.save(run1);
        await repos.executionRuns.save(run2);
      });

      // Retrieve by version
      const runs = await factory.create().execute(async (repos) => {
        return repos.executionRuns.getByTestCaseVersion(versionId);
      });

      expect(runs).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Feature 3: Runtime locator healing
  //
  // Mirrors the exact code path in ir-executor-impl.ts attemptRuntimeHealing():
  //   uowFactory.create() → uow.execute(async (repos) => {
  //     healElementAndPersist({ elementId, newStrategies, context }, repos.elements)
  //   })
  //   → overrideMap populated from healed.locatorStrategies
  // ═══════════════════════════════════════════════════════════════════

  describe('Feature 3: Runtime locator healing', () => {
    it('persists healed locators via uow.execute() and they survive a new UoW', async () => {
      // ── Setup: create a project + element ──
      const { elementId } = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        const element = await repos.elements.create({
          projectId: project.id,
          logicalName: 'Submit Button',
          locatorStrategies: [
            { type: LocatorStrategyType.CSS, value: '.old-selector', priority: 1, confidence: 0.5 },
          ],
        });
        return { elementId: element.id };
      });

      // ── Act: reproduce the exact healing code path ──
      // These are the "ranked locators" discovered from live DOM inspection
      const newStrategies: RankedLocator[] = [
        { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
        { type: LocatorStrategyType.ROLE, value: 'button[name="Submit"]', priority: 2, confidence: 0.80 },
      ];

      const uow = factory.create();
      const healed = await uow.execute(async (repos) => {
        return healElementAndPersist(
          {
            elementId,
            newStrategies,
            context: {
              sourceSessionId: 'execution-123',
              reason: 'Runtime locator resolution failure',
              proposedBy: 'runtime-healer',
            },
          },
          repos.elements,
        );
      });

      // ── Assert: healing returned the healed element ──
      expect(healed).toBeDefined();
      expect(healed!.locatorStrategies.length).toBeGreaterThanOrEqual(2);
      expect(healed!.lastHealedAt).not.toBeNull();
      expect(healed!.healHistory.length).toBe(1);

      // ── Assert: healed locators persisted — readable from a new UoW ──
      const persisted = await factory.create().execute(async (repos) => {
        return repos.elements.getById(elementId);
      });

      expect(persisted).toBeDefined();
      expect(persisted!.locatorStrategies).toHaveLength(healed!.locatorStrategies.length);

      // The new testId locator should be present (highest priority)
      const testIdStrategy = persisted!.locatorStrategies.find(s => s.type === LocatorStrategyType.TEST_ID);
      expect(testIdStrategy).toBeDefined();
      expect(testIdStrategy!.value).toBe('submit-btn');
      expect(testIdStrategy!.priority).toBe(1);

      // The old CSS locator should still be present (additive healing)
      const cssStrategy = persisted!.locatorStrategies.find(s => s.type === LocatorStrategyType.CSS);
      expect(cssStrategy).toBeDefined();
      expect(cssStrategy!.value).toBe('.old-selector');

      // healHistory should be persisted
      expect(persisted!.healHistory).toHaveLength(1);
      expect(persisted!.healHistory[0].reason).toBe('Runtime locator resolution failure');
      expect(persisted!.healHistory[0].proposedBy).toBe('runtime-healer');
    });

    it('healed locators are available for subsequent "executions" (cross-UoW read)', async () => {
      // ── Setup ──
      const { elementId } = await factory.create().execute(async (repos) => {
        const project = await repos.projects.create({
          name: 'Test Project',
          createdBy: 'test',
        });
        const element = await repos.elements.create({
          projectId: project.id,
          logicalName: 'Email Input',
          locatorStrategies: [
            { type: LocatorStrategyType.CSS, value: '.stale-input', priority: 1, confidence: 0.5 },
          ],
        });
        return { elementId: element.id };
      });

      // ── First "execution": heal the element ──
      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        return healElementAndPersist(
          {
            elementId,
            newStrategies: [
              { type: LocatorStrategyType.ROLE, value: 'textbox[name="Email"]', priority: 1, confidence: 0.85 } as RankedLocator,
            ],
            context: {
              sourceSessionId: 'execution-run-1',
              reason: 'Locator resolution failure',
              proposedBy: 'runtime-healer',
            },
          },
          repos.elements,
        );
      });

      // ── Second "execution": read the healed locators ──
      // This simulates a subsequent run that needs to resolve the element.
      // Before the fix, healed locators were never persisted — the second
      // run would find only the original stale locator.
      const uow2 = factory.create();
      const elementOnSecondRun = await uow2.execute(async (repos) => {
        return repos.elements.getById(elementId);
      });

      expect(elementOnSecondRun).toBeDefined();

      // The healed ROLE locator must be present and highest priority
      const roleStrategy = elementOnSecondRun!.locatorStrategies.find(
        s => s.type === LocatorStrategyType.ROLE,
      );
      expect(roleStrategy).toBeDefined();
      expect(roleStrategy!.value).toBe('textbox[name="Email"]');
      expect(roleStrategy!.priority).toBe(1);

      // The old CSS is preserved (additive)
      const cssStrategy = elementOnSecondRun!.locatorStrategies.find(
        s => s.type === LocatorStrategyType.CSS,
      );
      expect(cssStrategy).toBeDefined();
      expect(cssStrategy!.value).toBe('.stale-input');

      // The heal history proves it was healed in a prior run
      expect(elementOnSecondRun!.healHistory).toHaveLength(1);
      expect(elementOnSecondRun!.healHistory[0].runId).toBe('execution-run-1');
      expect(elementOnSecondRun!.lastHealedAt).not.toBeNull();
    });
  });
});
