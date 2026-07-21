/**
 * Project Entity Tests — domain-schema.md §3.1
 *
 * Tests entity creation, field validation, and invariants.
 */
import { describe, it, expect } from 'vitest';
import { createProject, updateProject, type CreateProjectInput } from '../../src/domain/entities/project';
import { ProjectStatus } from '../../src/domain/enums';
import { MissingFieldError } from '../../src/domain/errors/invariant-errors';

describe('Project Entity', () => {

  // ── Valid Creation ──────────────────────────────────────

  describe('createProject', () => {
    const validInput: CreateProjectInput = {
      name: 'Adani One Flight Booking',
      description: 'End-to-end test coverage for the Adani One web platform',
      tags: ['smoke', 'checkout', 'auth'],
      createdBy: 'user-1862',
    };

    it('creates a project with all fields populated', () => {
      const project = createProject(validInput);

      expect(project.id).toBeDefined();
      expect(project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(project.name).toBe('Adani One Flight Booking');
      expect(project.description).toBe('End-to-end test coverage for the Adani One web platform');
      expect(project.tags).toEqual(['smoke', 'checkout', 'auth']);
      expect(project.status).toBe(ProjectStatus.ACTIVE);
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBe(project.createdAt);
      expect(project.createdBy).toBe('user-1862');
    });

    it('defaults description to empty string when omitted', () => {
      const project = createProject({ name: 'P1', createdBy: 'u1' });
      expect(project.description).toBe('');
    });

    it('defaults tags to empty array when omitted', () => {
      const project = createProject({ name: 'P1', createdBy: 'u1' });
      expect(project.tags).toEqual([]);
    });

    it('defaults status to ACTIVE', () => {
      const project = createProject(validInput);
      expect(project.status).toBe(ProjectStatus.ACTIVE);
    });

    it('trims whitespace from name', () => {
      const project = createProject({ name: '  My Project  ', createdBy: 'u1' });
      expect(project.name).toBe('My Project');
    });

    it('trims whitespace from description', () => {
      const project = createProject({ name: 'P1', description: '  desc  ', createdBy: 'u1' });
      expect(project.description).toBe('desc');
    });

    it('generates unique UUIDs for each project', () => {
      const p1 = createProject(validInput);
      const p2 = createProject(validInput);
      expect(p1.id).not.toBe(p2.id);
    });

    it('generates valid ISO timestamps', () => {
      const project = createProject(validInput);
      expect(new Date(project.createdAt).toISOString()).toBe(project.createdAt);
      expect(new Date(project.updatedAt).toISOString()).toBe(project.updatedAt);
    });
  });

  // ── Invariant Violations ────────────────────────────────

  describe('invariant violations', () => {
    it('throws MissingFieldError when name is empty', () => {
      expect(() => createProject({ name: '', createdBy: 'u1' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when name is whitespace-only', () => {
      expect(() => createProject({ name: '   ', createdBy: 'u1' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when name is undefined', () => {
      expect(() => createProject({ name: undefined as unknown as string, createdBy: 'u1' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when createdBy is empty', () => {
      expect(() => createProject({ name: 'P1', createdBy: '' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when createdBy is undefined', () => {
      expect(() => createProject({ name: 'P1', createdBy: undefined as unknown as string }))
        .toThrow(MissingFieldError);
    });

    it('error contains correct field name and entity type', () => {
      try {
        createProject({ name: '', createdBy: 'u1' });
      } catch (e) {
        expect(e).toBeInstanceOf(MissingFieldError);
        const err = e as MissingFieldError;
        expect(err.fieldName).toBe('name');
        expect(err.entityType).toBe('Project');
        expect(err.message).toContain('name');
      }
    });
  });

  // ── updateProject ───────────────────────────────────────

  describe('updateProject', () => {
    it('updates name', () => {
      const original = createProject({ name: 'Old', createdBy: 'u1' });
      const updated = updateProject(original, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
      expect(updated.id).toBe(original.id); // ID unchanged
    });

    it('updates description', () => {
      const original = createProject({ name: 'P1', createdBy: 'u1' });
      const updated = updateProject(original, { description: 'New desc' });
      expect(updated.description).toBe('New desc');
    });

    it('updates tags', () => {
      const original = createProject({ name: 'P1', tags: ['a'], createdBy: 'u1' });
      const updated = updateProject(original, { tags: ['b', 'c'] });
      expect(updated.tags).toEqual(['b', 'c']);
    });

    it('updates status', () => {
      const original = createProject({ name: 'P1', createdBy: 'u1' });
      const updated = updateProject(original, { status: ProjectStatus.ARCHIVED });
      expect(updated.status).toBe(ProjectStatus.ARCHIVED);
    });

    it('updates updatedAt timestamp', async () => {
      const original = createProject({ name: 'P1', createdBy: 'u1' });
      await new Promise(r => setTimeout(r, 5));
      const updated = updateProject(original, { name: 'P2' });
      expect(updated.updatedAt).not.toBe(original.updatedAt);
    });

    it('preserves unspecified fields', () => {
      const original = createProject({
        name: 'P1', description: 'Desc', tags: ['t1'],
        createdBy: 'u1',
      });
      const updated = updateProject(original, { name: 'P2' });
      expect(updated.description).toBe('Desc');
      expect(updated.tags).toEqual(['t1']);
    });

    it('throws when updating to empty name', () => {
      const original = createProject({ name: 'P1', createdBy: 'u1' });
      expect(() => updateProject(original, { name: '  ' }))
        .toThrow(MissingFieldError);
    });
  });

  // ── Immutability ────────────────────────────────────────

  describe('immutability', () => {
    it('returns new object (does not mutate input)', () => {
      const input: CreateProjectInput = { name: 'P1', createdBy: 'u1' };
      const project = createProject(input);
      expect(project).not.toBe(input);
    });
  });
});
