/**
 * ProjectRepository Tests — via Dexie implementation through UnitOfWork.
 *
 * Tests CRUD operations, and verifies the repository works correctly
 * within UnitOfWork transactions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { ProjectStatus } from '../../src/domain/enums';

describe('ProjectRepository (Dexie)', () => {
  let factory: DexieUnitOfWorkFactory;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
  });

  afterEach(async () => {
    await factory.getDatabase().delete();
  });

  // ── Create ──────────────────────────────────────────────

  describe('create', () => {
    it('creates and retrieves a project', async () => {
      const uow = factory.create();

      const project = await uow.execute(async (repos) => {
        return repos.projects.create({
          name: 'Test Project',
          description: 'A test',
          tags: ['smoke', 'auth'],
          createdBy: 'user-1',
        });
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.tags).toEqual(['smoke', 'auth']);
      expect(project.status).toBe(ProjectStatus.ACTIVE);

      // Read it back in a new transaction
      const uow2 = factory.create();
      const retrieved = await uow2.execute(async (repos) => {
        return repos.projects.getById(project.id);
      });
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Test Project');
    });

    it('throws on empty name', async () => {
      const uow = factory.create();

      await expect(
        uow.execute(async (repos) => {
          return repos.projects.create({ name: '', createdBy: 'u1' });
        }),
      ).rejects.toThrow();
    });
  });

  // ── Read ────────────────────────────────────────────────

  describe('getById / getAll', () => {
    it('returns undefined for non-existent project', async () => {
      const uow = factory.create();

      const result = await uow.execute(async (repos) => {
        return repos.projects.getById('nonexistent');
      });

      expect(result).toBeUndefined();
    });

    it('lists all projects', async () => {
      const uow = factory.create();

      await uow.execute(async (repos) => {
        await repos.projects.create({ name: 'P1', createdBy: 'u1' });
        await repos.projects.create({ name: 'P2', createdBy: 'u1' });
        await repos.projects.create({ name: 'P3', createdBy: 'u1' });
      });

      const uow2 = factory.create();
      const projects = await uow2.execute(async (repos) => {
        return repos.projects.getAll();
      });
      expect(projects).toHaveLength(3);
    });
  });

  // ── Update ──────────────────────────────────────────────

  describe('update', () => {
    it('updates project name', async () => {
      const uow = factory.create();

      const project = await uow.execute(async (repos) => {
        return repos.projects.create({ name: 'Old', createdBy: 'u1' });
      });

      const uow2 = factory.create();
      const updated = await uow2.execute(async (repos) => {
        return repos.projects.update(project.id, { name: 'New Name' });
      });

      expect(updated.name).toBe('New Name');
    });

    it('throws when updating non-existent project', async () => {
      const uow = factory.create();

      await expect(
        uow.execute(async (repos) => {
          return repos.projects.update('nonexistent', { name: 'X' });
        }),
      ).rejects.toThrow('not found');
    });
  });

  // ── Delete ──────────────────────────────────────────────

  describe('delete', () => {
    it('deletes a project', async () => {
      const uow = factory.create();

      const project = await uow.execute(async (repos) => {
        return repos.projects.create({ name: 'ToDelete', createdBy: 'u1' });
      });

      const uow2 = factory.create();
      await uow2.execute(async (repos) => {
        return repos.projects.delete(project.id);
      });

      const uow3 = factory.create();
      const result = await uow3.execute(async (repos) => {
        return repos.projects.getById(project.id);
      });
      expect(result).toBeUndefined();
    });
  });
});
