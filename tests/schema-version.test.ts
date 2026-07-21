import { describe, it, expect } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  readSchemaVersion,
  stampSchemaVersion,
  needsMigration,
} from '../src/storage/schema-version';

describe('Schema Versioning', () => {

  describe('Constants', () => {
    it('CURRENT_SCHEMA_VERSION is 1', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(1);
    });

    it('SCHEMA_VERSIONS covers all 10 storage keys', () => {
      const keys = Object.keys(SCHEMA_VERSIONS);
      expect(keys).toHaveLength(10);
      expect(keys).toContain('ui_state');
      expect(keys).toContain('session_events');
      expect(keys).toContain('session_context');
      expect(keys).toContain('session_steps');
      expect(keys).toContain('generated_steps');
      expect(keys).toContain('generated_playwright');
      expect(keys).toContain('test_case_draft');
      expect(keys).toContain('ai_config');
      expect(keys).toContain('test_repository');
      expect(keys).toContain('session_screenshots');
    });

    it('all schema versions are 1 initially', () => {
      for (const v of Object.values(SCHEMA_VERSIONS)) {
        expect(v).toBe(1);
      }
    });
  });

  describe('readSchemaVersion', () => {
    it('returns 1 for objects without schemaVersion field (backward compat)', () => {
      expect(readSchemaVersion({ recordingState: 'ready' })).toBe(1);
    });

    it('returns 1 for null', () => {
      expect(readSchemaVersion(null)).toBe(1);
    });

    it('returns 1 for undefined', () => {
      expect(readSchemaVersion(undefined)).toBe(1);
    });

    it('returns 1 for non-object types', () => {
      expect(readSchemaVersion('string')).toBe(1);
      expect(readSchemaVersion(42)).toBe(1);
      expect(readSchemaVersion(true)).toBe(1);
    });

    it('returns the version when schemaVersion is present', () => {
      expect(readSchemaVersion({ schemaVersion: 1, foo: 'bar' })).toBe(1);
      expect(readSchemaVersion({ schemaVersion: 2, foo: 'bar' })).toBe(2);
      expect(readSchemaVersion({ schemaVersion: 5 })).toBe(5);
    });

    it('returns 1 when schemaVersion is non-numeric', () => {
      expect(readSchemaVersion({ schemaVersion: '1' })).toBe(1);
      expect(readSchemaVersion({ schemaVersion: null })).toBe(1);
      expect(readSchemaVersion({ schemaVersion: undefined })).toBe(1);
    });
  });

  describe('stampSchemaVersion', () => {
    it('adds schemaVersion to an object', () => {
      const data = { recordingState: 'ready', lastChanged: '2026-07-17' };
      const stamped = stampSchemaVersion(data);
      expect(stamped.schemaVersion).toBe(1);
      expect(stamped.recordingState).toBe('ready');
    });

    it('does not mutate the original object', () => {
      const data = { foo: 'bar' };
      const stamped = stampSchemaVersion(data);
      expect(data).not.toHaveProperty('schemaVersion');
      expect(stamped).toHaveProperty('schemaVersion');
    });

    it('accepts a custom version', () => {
      const data = { foo: 'bar' };
      const stamped = stampSchemaVersion(data, 2);
      expect(stamped.schemaVersion).toBe(2);
    });

    it('defaults to CURRENT_SCHEMA_VERSION', () => {
      const data = { foo: 'bar' };
      const stamped = stampSchemaVersion(data);
      expect(stamped.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('overwrites existing schemaVersion', () => {
      const data = { foo: 'bar', schemaVersion: 1 };
      const stamped = stampSchemaVersion(data, 2);
      expect(stamped.schemaVersion).toBe(2);
    });

    it('preserves all original fields', () => {
      const data = { a: 1, b: 'two', c: true, d: [1, 2, 3] };
      const stamped = stampSchemaVersion(data);
      expect(stamped.a).toBe(1);
      expect(stamped.b).toBe('two');
      expect(stamped.c).toBe(true);
      expect(stamped.d).toEqual([1, 2, 3]);
    });
  });

  describe('needsMigration', () => {
    it('returns false for current version', () => {
      expect(needsMigration({ schemaVersion: 1 }, 1)).toBe(false);
    });

    it('returns false for objects without schemaVersion (version 1 = current)', () => {
      expect(needsMigration({ foo: 'bar' }, 1)).toBe(false);
    });

    it('returns true when stored version is less than current', () => {
      expect(needsMigration({ schemaVersion: 1 }, 2)).toBe(true);
    });

    it('returns false when stored version equals current', () => {
      expect(needsMigration({ schemaVersion: 2 }, 2)).toBe(false);
    });

    it('returns false when stored version exceeds current (forward-compatible)', () => {
      expect(needsMigration({ schemaVersion: 5 }, 2)).toBe(false);
    });

    it('returns false for null data', () => {
      expect(needsMigration(null, 1)).toBe(false);
    });
  });

  describe('Backward compatibility scenario', () => {
    it('reading old data without schemaVersion works and reports version 1', () => {
      // Simulate old stored data (pre-schemaVersion feature)
      const oldData = JSON.parse('{"recordingState":"ready","lastChanged":"2026-01-01T00:00:00Z"}');
      expect(readSchemaVersion(oldData)).toBe(1);
      expect(needsMigration(oldData, CURRENT_SCHEMA_VERSION)).toBe(false);
    });

    it('stamping and re-reading round-trips correctly', () => {
      const original = { recordingState: 'recording', lastChanged: '2026-07-17' };
      const stamped = stampSchemaVersion(original);
      // Simulate serialization round-trip
      const serialized = JSON.parse(JSON.stringify(stamped));
      expect(readSchemaVersion(serialized)).toBe(CURRENT_SCHEMA_VERSION);
      expect(needsMigration(serialized, CURRENT_SCHEMA_VERSION)).toBe(false);
    });
  });
});
