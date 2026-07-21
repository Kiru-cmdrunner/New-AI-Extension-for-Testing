/**
 * Unit of Work Tests — atomic cross-repository operations.
 *
 * Tests that operations within a UnitOfWork execute atomically:
 * either all succeed or all are rolled back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { StepAction, LocatorStrategyType } from '../../src/domain/enums';

describe('UnitOfWork (Dexie)', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Atomicity: commit ───────────────────────────────────

  describe('atomic commit', () => {
    it('creates Element + ATC Version atomically', async () => {
      const uow = factory.create();

      const result = await uow.execute(async (repos) => {
        // Create element
        const element = await repos.elements.create({
          projectId: 'prj-001',
          logicalName: 'Login Button',
          locatorStrategies: [
            { type: LocatorStrategyType.ROLE, value: 'button[name="Login"]', priority: 1 },
          ],
        });

        // Create test case referencing the element
        const { testCase, version } = await repos.testCases.create({
          projectId: 'prj-001',
          title: 'Login Test',
          createdBy: 'u1',
          steps: [
            {
              order: 0,
              action: StepAction.CLICK,
              description: 'Click login',
              elementId: element.id,
            },
          ],
        });

        return { element, testCase, version };
      });

      // All three entities should be persisted
      const uow2 = factory.create();
      const verify = await uow2.execute(async (repos) => {
        return Promise.all([
          repos.elements.getById(result.element.id),
          repos.testCases.getById(result.testCase.id),
          repos.testCases.getVersion(result.version.id),
        ]);
      });

      expect(verify[0]).toBeDefined(); // element
      expect(verify[1]).toBeDefined(); // test case
      expect(verify[2]).toBeDefined(); // version
    });
  });

  // ── Atomicity: rollback ─────────────────────────────────

  describe('atomic rollback', () => {
    it('rolls back all changes when the callback throws', async () => {
      const uow = factory.create();

      // Create an element successfully, then throw
      await expect(
        uow.execute(async (repos) => {
          await repos.elements.create({
            projectId: 'prj-001',
            logicalName: 'Should Be Rolled Back',
            locatorStrategies: [
              { type: LocatorStrategyType.CSS, value: '#btn', priority: 1 },
            ],
          });
          throw new Error('Simulated failure');
        }),
      ).rejects.toThrow('Simulated failure');

      // Element should NOT exist (transaction was rolled back)
      const uow2 = factory.create();
      const elements = await uow2.execute(async (repos) => {
        return repos.elements.getByProject('prj-001');
      });
      expect(elements).toHaveLength(0);
    });

    it('rolls back partial multi-repository writes', async () => {
      const uow = factory.create();

      // Create project + element, then fail on test case
      await expect(
        uow.execute(async (repos) => {
          await repos.projects.create({ name: 'P1', createdBy: 'u1' });
          await repos.elements.create({
            projectId: 'p1',
            logicalName: 'Btn',
            locatorStrategies: [
              { type: LocatorStrategyType.CSS, value: '#x', priority: 1 },
            ],
          });
          // Now force a failure
          throw new Error('Deliberate rollback');
        }),
      ).rejects.toThrow('Deliberate rollback');

      // Nothing should be persisted
      const uow2 = factory.create();
      const [projects, elements] = await uow2.execute(async (repos) => {
        return Promise.all([
          repos.projects.getAll(),
          repos.elements.getByProject('p1'),
        ]);
      });
      expect(projects).toHaveLength(0);
      expect(elements).toHaveLength(0);
    });
  });

  // ── Multiple sequential transactions ────────────────────

  describe('sequential transactions', () => {
    it('supports multiple reads in separate transactions', async () => {
      const uow1 = factory.create();
      await uow1.execute(async (repos) => {
        await repos.projects.create({ name: 'P1', createdBy: 'u1' });
      });

      const uow2 = factory.create();
      const projects = await uow2.execute(async (repos) => {
        return repos.projects.getAll();
      });
      expect(projects).toHaveLength(1);

      const uow3 = factory.create();
      const again = await uow3.execute(async (repos) => {
        return repos.projects.getAll();
      });
      expect(again).toHaveLength(1);
    });
  });

  // ── Full Workflow: AI Review Scenario ───────────────────

  describe('full AI review workflow', () => {
    it('creates elements + test case + approves atomically per step', async () => {
      const uow = factory.create();

      // Step 1: Create project
      const projectId = await uow.execute(async (repos) => {
        const project = await repos.projects.create({ name: 'Test App', createdBy: 'u1' });
        return project.id;
      });

      // Step 2: AI Review — create elements + test case in one transaction
      const uow2 = factory.create();
      const result = await uow2.execute(async (repos) => {
        const emailEl = await repos.elements.create({
          projectId, logicalName: 'Email Field', pageOrComponent: 'login',
          locatorStrategies: [{ type: LocatorStrategyType.ROLE, value: 'textbox[name="Email"]', priority: 1 }],
        });
        const passwordEl = await repos.elements.create({
          projectId, logicalName: 'Password Field', pageOrComponent: 'login',
          locatorStrategies: [{ type: LocatorStrategyType.ROLE, value: 'textbox[name="Password"]', priority: 1 }],
        });
        const loginBtn = await repos.elements.create({
          projectId, logicalName: 'Login Button', pageOrComponent: 'login',
          locatorStrategies: [{ type: LocatorStrategyType.ROLE, value: 'button[name="Sign In"]', priority: 1 }],
        });

        const { testCase } = await repos.testCases.create({
          projectId, title: 'User can log in', tags: ['smoke', 'auth'], createdBy: 'recorder',
          steps: [
            { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
            { order: 1, action: StepAction.FILL, description: 'Enter email', elementId: emailEl.id, input: 'test@test.com' },
            { order: 2, action: StepAction.FILL, description: 'Enter password', elementId: passwordEl.id, input: 'pass' },
            { order: 3, action: StepAction.CLICK, description: 'Click login', elementId: loginBtn.id },
          ],
        });

        return { emailEl, passwordEl, loginBtn, testCase };
      });

      // Step 3: Review and approve
      const uow3 = factory.create();
      await uow3.execute(async (repos) => {
        await repos.testCases.transitionStatus(result.testCase.id, 'in_review' as never);
      });

      const uow4 = factory.create();
      await uow4.execute(async (repos) => {
        await repos.testCases.approve(result.testCase.id, 'qa-lead');
      });

      // Verify final state
      const uow5 = factory.create();
      const finalState = await uow5.execute(async (repos) => {
        const tc = await repos.testCases.getById(result.testCase.id);
        const elements = await repos.elements.getByProject(projectId);
        return { tc, elements };
      });

      expect(finalState.tc!.status).toBe('approved');
      expect(finalState.elements).toHaveLength(3);
    });
  });
});
