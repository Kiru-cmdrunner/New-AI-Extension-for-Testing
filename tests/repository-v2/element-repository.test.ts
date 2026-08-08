/**
 * ElementRepository Tests — via Dexie implementation through UnitOfWork.
 *
 * Tests CRUD operations and INV-EL3 (referential integrity on delete).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { ElementStatus, LocatorStrategyType, StepAction, ValidationType, ValidationComparison, ValidationSeverity } from '../../src/domain/enums';
import { ElementReferencedError } from '../../src/domain/errors/invariant-errors';

const SAMPLE_ELEMENT_INPUT = {
  projectId: 'prj-001',
  logicalName: 'Login Button',
  pageOrComponent: 'login_page',
  locatorStrategies: [
    { type: LocatorStrategyType.ROLE, value: 'button[name="Sign In"]', priority: 1 },
    { type: LocatorStrategyType.TEST_ID, value: '[data-testid="login"]', priority: 2 },
  ],
};

describe('ElementRepository (Dexie)', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Create ──────────────────────────────────────────────

  describe('create', () => {
    it('creates and retrieves an element', async () => {
      const uow = factory.create();
      const element = await uow.execute(async (repos) => {
        return repos.elements.create(SAMPLE_ELEMENT_INPUT);
      });

      expect(element.id).toBeDefined();
      expect(element.logicalName).toBe('Login Button');
      expect(element.status).toBe(ElementStatus.ACTIVE);

      const uow2 = factory.create();
      const retrieved = await uow2.execute(async (repos) => {
        return repos.elements.getById(element.id);
      });
      expect(retrieved).toBeDefined();
      expect(retrieved!.logicalName).toBe('Login Button');
    });
  });

  // ── Read ────────────────────────────────────────────────

  describe('getByProject', () => {
    it('returns elements for a project', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.elements.create({ ...SAMPLE_ELEMENT_INPUT, projectId: 'prj-a', logicalName: 'Btn A' });
        await repos.elements.create({ ...SAMPLE_ELEMENT_INPUT, projectId: 'prj-a', logicalName: 'Btn B' });
        await repos.elements.create({ ...SAMPLE_ELEMENT_INPUT, projectId: 'prj-b', logicalName: 'Btn C' });
      });

      const uow2 = factory.create();
      const elements = await uow2.execute(async (repos) => {
        return repos.elements.getByProject('prj-a');
      });
      expect(elements).toHaveLength(2);
    });

    it('returns empty array for project with no elements', async () => {
      const uow = factory.create();
      const elements = await uow.execute(async (repos) => {
        return repos.elements.getByProject('empty-project');
      });
      expect(elements).toEqual([]);
    });
  });

  describe('getByPageComponent', () => {
    it('filters by page/component scope', async () => {
      const uow = factory.create();
      await uow.execute(async (repos) => {
        await repos.elements.create({ ...SAMPLE_ELEMENT_INPUT, projectId: 'p1', pageOrComponent: 'login_page', logicalName: 'Login' });
        await repos.elements.create({ ...SAMPLE_ELEMENT_INPUT, projectId: 'p1', pageOrComponent: 'checkout_page', logicalName: 'Checkout' });
      });

      const uow2 = factory.create();
      const loginElements = await uow2.execute(async (repos) => {
        return repos.elements.getByPageComponent('p1', 'login_page');
      });
      expect(loginElements).toHaveLength(1);
      expect(loginElements[0].logicalName).toBe('Login');
    });
  });

  // ── Update ──────────────────────────────────────────────

  describe('update', () => {
    it('updates element logicalName', async () => {
      const uow = factory.create();
      const element = await uow.execute(async (repos) => {
        return repos.elements.create(SAMPLE_ELEMENT_INPUT);
      });

      const uow2 = factory.create();
      const updated = await uow2.execute(async (repos) => {
        return repos.elements.update(element.id, { logicalName: 'Sign In Button' });
      });
      expect(updated.logicalName).toBe('Sign In Button');
    });

    it('updates element locatorStrategies', async () => {
      const uow = factory.create();
      const element = await uow.execute(async (repos) => {
        return repos.elements.create(SAMPLE_ELEMENT_INPUT);
      });

      const uow2 = factory.create();
      const updated = await uow2.execute(async (repos) => {
        return repos.elements.update(element.id, {
          locatorStrategies: [
            { type: LocatorStrategyType.CSS, value: '#new-btn', priority: 1 },
          ],
        });
      });
      expect(updated.locatorStrategies).toHaveLength(1);
      expect(updated.locatorStrategies[0].type).toBe(LocatorStrategyType.CSS);
    });
  });

  // ── INV-EL3: Referential Integrity on Delete ────────────

  describe('delete with INV-EL3', () => {
    it('deletes an unreferenced element', async () => {
      const uow = factory.create();
      const element = await uow.execute(async (repos) => {
        return repos.elements.create(SAMPLE_ELEMENT_INPUT);
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        await repos.elements.delete(element.id);
      });

      const uow3 = factory.create();
      const result = await uow3.execute(async (repos) => {
        return repos.elements.getById(element.id);
      });
      expect(result).toBeUndefined();
    });

    it('blocks deletion when element is referenced by a step', async () => {
      const uow = factory.create();
      const elementId = await uow.execute(async (repos) => {
        const element = await repos.elements.create(SAMPLE_ELEMENT_INPUT);
        await repos.testCases.create({
          projectId: 'prj-001',
          title: 'Test',
          createdBy: 'u1',
          steps: [
            { order: 0, action: StepAction.CLICK, description: 'Click', elementId: element.id },
          ],
        });
        return element.id;
      });

      // Try to delete — should throw
      const uow2 = factory.create();
      await expect(
        uow2.execute(async (repos) => {
          await repos.elements.delete(elementId);
        }),
      ).rejects.toThrow(ElementReferencedError);
    });

    it('blocks deletion when element is referenced by a validation', async () => {
      const uow = factory.create();
      const elementId = await uow.execute(async (repos) => {
        const element = await repos.elements.create(SAMPLE_ELEMENT_INPUT);
        await repos.testCases.create({
          projectId: 'prj-001',
          title: 'Test',
          createdBy: 'u1',
          steps: [
            {
              order: 0,
              action: StepAction.VERIFY,
              description: 'Verify',
              elementId: element.id,
              validations: [
                {
                  type: ValidationType.VISIBILITY,
                  comparison: ValidationComparison.IS_TRUE,
                  severity: ValidationSeverity.HARD,
                },
              ],
            },
          ],
        });
        return element.id;
      });

      const uow2 = factory.create();
      await expect(
        uow2.execute(async (repos) => {
          await repos.elements.delete(elementId);
        }),
      ).rejects.toThrow(ElementReferencedError);
    });

    it('isReferenced returns empty array for unreferenced element', async () => {
      const uow = factory.create();
      const element = await uow.execute(async (repos) => {
        return repos.elements.create(SAMPLE_ELEMENT_INPUT);
      });

      const uow2 = factory.create();
      const refs = await uow2.execute(async (repos) => {
        return repos.elements.isReferenced(element.id);
      });
      expect(refs).toEqual([]);
    });

    it('isReferenced returns version IDs for referenced element', async () => {
      const uow = factory.create();
      const { elementId, versionId } = await uow.execute(async (repos) => {
        const element = await repos.elements.create(SAMPLE_ELEMENT_INPUT);
        const { version } = await repos.testCases.create({
          projectId: 'prj-001',
          title: 'Test',
          createdBy: 'u1',
          steps: [
            { order: 0, action: StepAction.CLICK, description: 'Click', elementId: element.id },
          ],
        });
        return { elementId: element.id, versionId: version.id };
      });

      const uow2 = factory.create();
      const refs = await uow2.execute(async (repos) => {
        return repos.elements.isReferenced(elementId);
      });
      expect(refs).toContain(versionId);
    });
  });
});
