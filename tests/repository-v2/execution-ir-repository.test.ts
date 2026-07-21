/**
 * Execution IR Repository Tests — execution-ir-design.md §2.11, §6
 *
 * Tests the DexieExecutionIRRepository: CRUD operations and INV-IR7
 * (save replaces; one cached IR per ATC version).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { DefaultIRGenerator, GENERATOR_VERSION } from '../../src/domain/execution-ir/generator';
import type { ExecutionIRArtifact } from '../../src/domain/execution-ir/types';
import { StepAction, LocatorStrategyType } from '../../src/domain/enums';
import { createTestCase } from '../../src/domain/entities/approved-test-case';
import { createElement } from '../../src/domain/entities/element';

describe('ExecutionIRRepository (Dexie)', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Helpers ─────────────────────────────────────────────

  function makeArtifact(): ExecutionIRArtifact {
    const element = createElement({
      projectId: 'prj-001',
      logicalName: 'Test Element',
      locatorStrategies: [
        { type: LocatorStrategyType.ROLE, value: 'button[name="Test"]', priority: 1, confidence: 0.9 },
      ],
    });

    const elements = new Map([[element.id, element]]);

    const { testCase, version } = createTestCase({
      projectId: 'prj-001',
      title: 'Test Case',
      createdBy: 'tester',
      steps: [
        { order: 0, action: StepAction.CLICK, description: 'Click', elementId: element.id },
      ],
    });

    const generator = new DefaultIRGenerator();
    return generator.generate(testCase, version, elements, {
      baseUrl: 'https://staging.example.com',
      browser: 'chrome',
      viewport: { width: 1440, height: 900 },
    });
  }

  // ── Save + GetById ──────────────────────────────────────

  describe('save + getById', () => {
    it('saves and retrieves an IR artifact by ID', async () => {
      const artifact = makeArtifact();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.executionIRs.save(artifact);
      });

      const uow2 = factory.create();
      const retrieved = await uow2.execute(async (repos) => {
        return repos.executionIRs.getById(artifact.id);
      });

      expect(retrieved).toEqual(artifact);
    });

    it('retrieves by testCaseVersionId', async () => {
      const artifact = makeArtifact();

      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.executionIRs.save(artifact);
      });

      const uow2 = factory.create();
      const retrieved = await uow2.execute(async (repos) => {
        return repos.executionIRs.getByTestCaseVersion(artifact.testCaseVersionId);
      });

      expect(retrieved).toEqual(artifact);
    });

    it('returns undefined for non-existent ID', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return repos.executionIRs.getById('nonexistent');
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined for non-existent testCaseVersionId', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return repos.executionIRs.getByTestCaseVersion('nonexistent');
      });

      expect(result).toBeUndefined();
    });
  });

  // ── INV-IR7: Replace Semantics ──────────────────────────

  describe('INV-IR7: save replaces, does not append', () => {
    it('replaces existing artifact for same testCaseVersionId', async () => {
      // Save initial artifact
      const artifact1 = makeArtifact();
      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        await repos.executionIRs.save(artifact1);
      });

      // Create a second artifact with the SAME testCaseVersionId but different artifact ID
      const artifact2: ExecutionIRArtifact = {
        ...artifact1,
        id: crypto.randomUUID(),
        generatedAt: new Date().toISOString(),
      };
      expect(artifact2.id).not.toBe(artifact1.id);
      expect(artifact2.testCaseVersionId).toBe(artifact1.testCaseVersionId);

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.executionIRs.save(artifact2);
      });

      // Only one artifact should exist, and it should be artifact2
      const uow3 = factory.create();
      const allByTestCaseVersion = await uow3.execute(async (repos) => {
        return repos.executionIRs.getByTestCaseVersion(artifact1.testCaseVersionId);
      });

      expect(allByTestCaseVersion).toEqual(artifact2);
      expect(allByTestCaseVersion!.id).toBe(artifact2.id);

      // Old artifact ID should no longer exist
      const uow4 = factory.create();
      const oldArtifact = await uow4.execute(async (repos) => {
        return repos.executionIRs.getById(artifact1.id);
      });
      expect(oldArtifact).toBeUndefined();
    });
  });

  // ── Delete ──────────────────────────────────────────────

  describe('delete', () => {
    it('deletes an artifact by ID', async () => {
      const artifact = makeArtifact();

      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        await repos.executionIRs.save(artifact);
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.executionIRs.delete(artifact.id);
      });

      const uow3 = factory.create();
      const retrieved = await uow3.execute(async (repos) => {
        return repos.executionIRs.getById(artifact.id);
      });

      expect(retrieved).toBeUndefined();
    });

    it('deletes by testCaseVersionId', async () => {
      const artifact = makeArtifact();

      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        await repos.executionIRs.save(artifact);
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.executionIRs.deleteByTestCaseVersion(artifact.testCaseVersionId);
      });

      const uow3 = factory.create();
      const retrieved = await uow3.execute(async (repos) => {
        return repos.executionIRs.getByTestCaseVersion(artifact.testCaseVersionId);
      });

      expect(retrieved).toBeUndefined();
    });
  });

  // ── Persistence Round-Trip ──────────────────────────────

  describe('persistence round-trip', () => {
    it('IR survives DB close and reopen with complete data intact', async () => {
      const artifact = makeArtifact();

      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        await repos.executionIRs.save(artifact);
      });

      // Close and reopen
      factory.getDatabase().close();
      const factory2 = new DexieUnitOfWorkFactory();
      const uow2 = factory2.create();

      const retrieved = await uow2.execute(async (repos) => {
        return repos.executionIRs.getByTestCaseVersion(artifact.testCaseVersionId);
      });

      expect(retrieved).toEqual(artifact);
      expect(retrieved!.plan.steps).toEqual(artifact.plan.steps);
      expect(retrieved!.generatorVersion).toBe(GENERATOR_VERSION);

      await factory2.getDatabase().delete();
    });
  });
});
