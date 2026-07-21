/**
 * TestCaseRepository Tests — via Dexie implementation through UnitOfWork.
 *
 * Tests CRUD, versioning chain, tag-based queries, and status transitions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { TestCaseStatus, TestCasePriority, StepAction } from '../../src/domain/enums';
import { InvalidStatusTransitionError } from '../../src/domain/errors/invariant-errors';

const SAMPLE_STEPS = [
  { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
  { order: 1, action: StepAction.CLICK, description: 'Click button', elementId: 'elm-001' },
];

describe('TestCaseRepository (Dexie)', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Create (ATC + Version 1) ───────────────────────────

  describe('create', () => {
    it('creates ATC with version 1 atomically', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'prj-001',
          title: 'Login Test',
          tags: ['smoke', 'auth'],
          priority: TestCasePriority.HIGH,
          createdBy: 'u1',
          steps: SAMPLE_STEPS,
        });
      });

      expect(result.testCase.id).toBeDefined();
      expect(result.testCase.title).toBe('Login Test');
      expect(result.testCase.status).toBe(TestCaseStatus.DRAFT);
      expect(result.testCase.currentVersionId).toBe(result.version.id);

      expect(result.version.versionNumber).toBe(1);
      expect(result.version.steps).toHaveLength(2);
      expect(result.version.testCaseId).toBe(result.testCase.id);
    });

    it('throws when title is empty', async () => {
      const uow = factory.create();
      await expect(
        uow.execute(async (repos) => {
          return repos.testCases.create({
            projectId: 'p1', title: '', createdBy: 'u1', steps: [],
          });
        }),
      ).rejects.toThrow();
    });
  });

  // ── Read ────────────────────────────────────────────────

  describe('getById', () => {
    it('retrieves a test case by ID', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      const retrieved = await uow2.execute(async (repos) => {
        return repos.testCases.getById(testCase.id);
      });
      expect(retrieved).toBeDefined();
      expect(retrieved!.title).toBe('TC1');
    });

    it('returns undefined for non-existent ID', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return repos.testCases.getById('nonexistent');
      });
      expect(result).toBeUndefined();
    });
  });

  // ── getByProject ────────────────────────────────────────

  describe('getByProject', () => {
    it('lists test cases in a project', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.testCases.create({ projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: [] });
        await repos.testCases.create({ projectId: 'p1', title: 'TC2', createdBy: 'u1', steps: [] });
        await repos.testCases.create({ projectId: 'p2', title: 'TC3', createdBy: 'u1', steps: [] });
      });

      const uow2 = factory.create();
      const cases = await uow2.execute(async (repos) => {
        return repos.testCases.getByProject('p1');
      });
      expect(cases).toHaveLength(2);
    });
  });

  // ── getByTag ────────────────────────────────────────────

  describe('getByTag', () => {
    it('finds test cases by tag', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.testCases.create({ projectId: 'p1', title: 'TC1', tags: ['smoke'], createdBy: 'u1', steps: [] });
        await repos.testCases.create({ projectId: 'p1', title: 'TC2', tags: ['auth'], createdBy: 'u1', steps: [] });
        await repos.testCases.create({ projectId: 'p1', title: 'TC3', tags: ['smoke', 'auth'], createdBy: 'u1', steps: [] });
      });

      const uow2 = factory.create();
      const smokeTests = await uow2.execute(async (repos) => {
        return repos.testCases.getByTag('p1', ['smoke']);
      });
      expect(smokeTests).toHaveLength(2); // TC1 and TC3
    });

    it('matches multiple tags (OR)', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.testCases.create({ projectId: 'p1', title: 'TC1', tags: ['a'], createdBy: 'u1', steps: [] });
        await repos.testCases.create({ projectId: 'p1', title: 'TC2', tags: ['b'], createdBy: 'u1', steps: [] });
        await repos.testCases.create({ projectId: 'p1', title: 'TC3', tags: ['c'], createdBy: 'u1', steps: [] });
      });

      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.testCases.getByTag('p1', ['a', 'b']);
      });
      expect(results).toHaveLength(2); // TC1 (tag a) + TC2 (tag b)
    });

    it('deduplicates results matching multiple tags', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.testCases.create({ projectId: 'p1', title: 'TC1', tags: ['a', 'b'], createdBy: 'u1', steps: [] });
      });

      const uow2 = factory.create();
      const results = await uow2.execute(async (repos) => {
        return repos.testCases.getByTag('p1', ['a', 'b']);
      });
      expect(results).toHaveLength(1); // Not 2 — deduplicated
    });
  });

  // ── Versioning ──────────────────────────────────────────

  describe('createVersion', () => {
    it('creates version 2 with correct versionNumber', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      const v2 = await uow2.execute(async (repos) => {
        return repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, {
          changeSummary: 'Added a step',
          createdBy: 'u1',
        });
      });

      expect(v2.versionNumber).toBe(2);
      expect(v2.parentVersionId).toBe(testCase.currentVersionId);
      expect(v2.changeSummary).toBe('Added a step');
    });

    it('updates currentVersionId to new version', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      const v2 = await uow2.execute(async (repos) => {
        return repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, { createdBy: 'u1' });
      });

      const uow3 = factory.create();
      const updated = await uow3.execute(async (repos) => {
        return repos.testCases.getById(testCase.id);
      });
      expect(updated!.currentVersionId).toBe(v2.id);
    });

    it('returns ATC to draft status after revision', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      // Approve v1: draft → in_review → approved
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.testCases.transitionStatus(testCase.id, TestCaseStatus.IN_REVIEW);
      });

      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        await repos.testCases.approve(testCase.id, 'reviewer-1');
      });

      // Create v2 (revision)
      const uow4 = factory.create();
      await uow4.execute(async (repos) => {
        return repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, { createdBy: 'u1' });
      });

      const uow5 = factory.create();
      const updated = await uow5.execute(async (repos) => {
        return repos.testCases.getById(testCase.id);
      });
      expect(updated!.status).toBe(TestCaseStatus.DRAFT);
    });

    it('throws for non-existent test case', async () => {
      const uow = factory.create();
      await expect(
        uow.execute(async (repos) => {
          return repos.testCases.createVersion('nonexistent', [], { createdBy: 'u1' });
        }),
      ).rejects.toThrow('not found');
    });

    it('blocks version creation on deprecated ATC (INV-ATC2 terminal state)', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      // Transition to approved then deprecated
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.testCases.transitionStatus(testCase.id, TestCaseStatus.IN_REVIEW);
        await repos.testCases.approve(testCase.id, 'reviewer-1');
        await repos.testCases.transitionStatus(testCase.id, TestCaseStatus.DEPRECATED);
      });

      // Attempting to create a new version on a deprecated ATC should throw
      const uow3 = factory.create();
      await expect(
        uow3.execute(async (repos) => {
          return repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, { createdBy: 'u1' });
        }),
      ).rejects.toThrow();
    });
  });

  // ── listVersions ────────────────────────────────────────

  describe('listVersions', () => {
    it('returns versions ordered by versionNumber', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, { createdBy: 'u1' });
      });

      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        await repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, { createdBy: 'u1' });
      });

      const uow4 = factory.create();
      const versions = await uow4.execute(async (repos) => {
        return repos.testCases.listVersions(testCase.id);
      });
      expect(versions).toHaveLength(3);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[1].versionNumber).toBe(2);
      expect(versions[2].versionNumber).toBe(3);
    });
  });

  // ── getCurrentVersion ───────────────────────────────────

  describe('getCurrentVersion', () => {
    it('returns the version pointed to by currentVersionId', async () => {
      const uow = factory.create();
      const { testCase, version } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      const current = await uow2.execute(async (repos) => {
        return repos.testCases.getCurrentVersion(testCase.id);
      });
      expect(current).toBeDefined();
      expect(current!.id).toBe(version.id);
    });
  });

  // ── Status Transitions ──────────────────────────────────

  describe('transitionStatus', () => {
    it('transitions draft → in_review → approved', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      const inReview = await uow2.execute(async (repos) => {
        return repos.testCases.transitionStatus(testCase.id, TestCaseStatus.IN_REVIEW);
      });
      expect(inReview.status).toBe(TestCaseStatus.IN_REVIEW);

      const uow3 = factory.create();
      const approved = await uow3.execute(async (repos) => {
        return repos.testCases.transitionStatus(testCase.id, TestCaseStatus.APPROVED);
      });
      expect(approved.status).toBe(TestCaseStatus.APPROVED);
    });

    it('throws on invalid transition (draft → approved)', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      await expect(
        uow.execute(async (repos) => {
          return repos.testCases.transitionStatus(testCase.id, TestCaseStatus.APPROVED);
        }),
      ).rejects.toThrow(InvalidStatusTransitionError);
    });
  });

  // ── approve ─────────────────────────────────────────────

  describe('approve', () => {
    it('sets approvedBy/At on version and transitions ATC to approved', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.testCases.transitionStatus(testCase.id, TestCaseStatus.IN_REVIEW);
      });

      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        await repos.testCases.approve(testCase.id, 'reviewer-1');
      });

      const uow4 = factory.create();
      const updated = await uow4.execute(async (repos) => {
        return repos.testCases.getById(testCase.id);
      });
      expect(updated!.status).toBe(TestCaseStatus.APPROVED);

      const version = await uow4.execute(async (repos) => {
        return repos.testCases.getVersion(updated!.currentVersionId);
      });
      expect(version!.approvedBy).toBe('reviewer-1');
      expect(version!.approvedAt).toBeDefined();
    });
  });

  // ── findVersionsReferencingElement ──────────────────────

  describe('findVersionsReferencingElement', () => {
    it('finds versions referencing an element via steps', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1',
          steps: [
            { order: 0, action: StepAction.CLICK, description: 'Click', elementId: 'elm-target' },
          ],
        });
      });

      const uow2 = factory.create();
      const refs = await uow2.execute(async (repos) => {
        return repos.testCases.findVersionsReferencingElement('elm-target');
      });
      expect(refs).toHaveLength(1);
      expect(refs[0].versionId).toBe(result.version.id);
      expect(refs[0].testCaseId).toBe(result.testCase.id);
    });

    it('finds versions referencing an element via validations', async () => {
      const uow = factory.create();
      const result = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1',
          steps: [
            {
              order: 0, action: StepAction.VERIFY, description: 'Verify',
              elementId: 'elm-target',
              validations: [
                { type: 'visibility', comparison: 'isTrue', severity: 'hard' },
              ],
            },
          ],
        });
      });

      const uow2 = factory.create();
      const refs = await uow2.execute(async (repos) => {
        return repos.testCases.findVersionsReferencingElement('elm-target');
      });
      expect(refs).toHaveLength(1);
    });

    it('returns empty for unreferenced element', async () => {
      const uow = factory.create();
      const refs = await uow.execute(async (repos) => {
        return repos.testCases.findVersionsReferencingElement('nonexistent');
      });
      expect(refs).toEqual([]);
    });
  });

  // ── delete ──────────────────────────────────────────────

  describe('delete', () => {
    it('deletes ATC and all its versions', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'TC1', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      // Add v2
      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        return repos.testCases.createVersion(testCase.id, SAMPLE_STEPS, { createdBy: 'u1' });
      });

      // Delete
      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        await repos.testCases.delete(testCase.id);
      });

      const uow4 = factory.create();
      const tc = await uow4.execute(async (repos) => {
        return repos.testCases.getById(testCase.id);
      });
      expect(tc).toBeUndefined();

      const versions = await uow4.execute(async (repos) => {
        return repos.testCases.listVersions(testCase.id);
      });
      expect(versions).toHaveLength(0);
    });
  });

  // ── updateMetadata ──────────────────────────────────────

  describe('updateMetadata', () => {
    it('updates title without creating new version', async () => {
      const uow = factory.create();
      const { testCase } = await uow.execute(async (repos) => {
        return repos.testCases.create({
          projectId: 'p1', title: 'Old Title', createdBy: 'u1', steps: SAMPLE_STEPS,
        });
      });

      const uow2 = factory.create();
      const updated = await uow2.execute(async (repos) => {
        return repos.testCases.updateMetadata(testCase.id, { title: 'New Title' });
      });
      expect(updated.title).toBe('New Title');

      // Version count should still be 1
      const uow3 = factory.create();
      const versions = await uow3.execute(async (repos) => {
        return repos.testCases.listVersions(testCase.id);
      });
      expect(versions).toHaveLength(1);
    });
  });
});
