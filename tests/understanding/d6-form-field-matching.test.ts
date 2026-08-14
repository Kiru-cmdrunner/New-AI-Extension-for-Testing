/**
 * D6 Fix — Semantic Form-Field Entity Matching Tests
 *
 * Verifies:
 *   1. Word-boundary matching: "name" pattern does NOT match "hostname",
 *      "filename", "dbname", "namespace", "displayName".
 *   2. Legitimate name fields ARE matched (e.g. "name", "fullName",
 *      "employee-name", "lastName").
 *   3. Multi-token patterns work (e.g. "leave-type" matches "leaveType").
 *   4. Other form-field seeds still work correctly.
 *
 * Architecture: D6 defect fix regression tests.
 */

import { describe, it, expect } from 'vitest';
import {
  createEntityTypeRegistry,
  tokenizeFieldName,
  fieldPatternMatches,
} from '../../src/understanding/state-builder/entity-type-registry';

// ── Unit tests for tokenization and matching ────────────────────────────

describe('D6 Fix — Tokenization', () => {
  it('tokenizes hyphenated names', () => {
    const tokens = tokenizeFieldName('emp-name');
    expect(tokens.map((t) => t.token)).toEqual(['emp', 'name']);
    expect(tokens.every((t) => t.fromSeparator)).toBe(true);
  });

  it('tokenizes underscored names', () => {
    const tokens = tokenizeFieldName('employee_name');
    expect(tokens.map((t) => t.token)).toEqual(['employee', 'name']);
    expect(tokens.every((t) => t.fromSeparator)).toBe(true);
  });

  it('tokenizes camelCase names', () => {
    const tokens1 = tokenizeFieldName('firstName');
    expect(tokens1.map((t) => t.token)).toEqual(['first', 'name']);
    // camelCase tokens are NOT fromSeparator
    expect(tokens1.every((t) => !t.fromSeparator)).toBe(true);

    const tokens2 = tokenizeFieldName('lastName');
    expect(tokens2.map((t) => t.token)).toEqual(['last', 'name']);
  });

  it('does NOT split single words', () => {
    const tokens1 = tokenizeFieldName('hostname');
    expect(tokens1.map((t) => t.token)).toEqual(['hostname']);
    const tokens2 = tokenizeFieldName('filename');
    expect(tokens2.map((t) => t.token)).toEqual(['filename']);
  });

  it('handles dotted names', () => {
    const tokens = tokenizeFieldName('user.email');
    expect(tokens.map((t) => t.token)).toEqual(['user', 'email']);
  });

  it('handles already-lowercase', () => {
    const tokens = tokenizeFieldName('username');
    expect(tokens.map((t) => t.token)).toEqual(['username']);
  });
});

describe('D6 Fix — fieldPatternMatches', () => {
  const tokens = tokenizeFieldName('hostname');

  it('does NOT match "name" against "hostname"', () => {
    expect(fieldPatternMatches('name', 'hostname', tokens)).toBe(false);
  });

  it('matches "hostname" exactly against "hostname"', () => {
    expect(fieldPatternMatches('hostname', 'hostname', tokens)).toBe(true);
  });

  it('matches "name" against "emp-name"', () => {
    const t = tokenizeFieldName('emp-name');
    expect(fieldPatternMatches('name', 'emp-name', t)).toBe(true);
  });

  it('does NOT match "name" against camelCase "className"', () => {
    const t = tokenizeFieldName('className');
    expect(fieldPatternMatches('name', 'classname', t)).toBe(false);
  });

  it('matches "firstname" against camelCase "firstName" (concat check)', () => {
    const t = tokenizeFieldName('firstName');
    expect(fieldPatternMatches('firstname', 'firstname', t)).toBe(true);
  });
});

// ── Integration tests with the registry ─────────────────────────────────

describe('D6 Fix — Registry resolves form fields without false positives', () => {
  const registry = createEntityTypeRegistry();

  describe('should NOT classify compound names as form-entry', () => {
    const falsePositives = [
      'hostname',
      'fileName',
      'dbName',
      'namespace',
      'displayName',
      'fileName',
      'className',
      'columnName',
    ];

    for (const field of falsePositives) {
      it(`rejects "${field}" as generic form-entry`, () => {
        const result = registry.resolveFromFormField(field);
        // Must not be 'form-entry' — the overly broad "name" pattern bug
        expect(result).not.toBe('form-entry');
      });
    }
  });

  describe('should correctly classify legitimate name fields', () => {
    it('classifies "name" as form-entry', () => {
      expect(registry.resolveFromFormField('name')).toBe('form-entry');
    });

    it('classifies "full-name" as employee (fullname pattern in employee seed)', () => {
      // "full-name" tokenizes to ["full", "name"], concatenated = "fullname"
      // which matches the employee seed pattern "fullname" — this is correct
      // for HR contexts where fullName is an employee field.
      expect(registry.resolveFromFormField('full-name')).toBe('employee');
    });

    it('classifies "last_name" as employee (more specific rule wins)', () => {
      // "lastname" is in the employee seed — should match before form-entry
      const result = registry.resolveFromFormField('last_name');
      expect(result).toBe('employee');
    });

    it('classifies "emp-name" as employee', () => {
      expect(registry.resolveFromFormField('emp-name')).toBe('employee');
    });

    it('classifies "firstName" as employee', () => {
      expect(registry.resolveFromFormField('firstName')).toBe('employee');
    });
  });

  describe('HR domain fields still work', () => {
    it('classifies "leavetype" as leave-request', () => {
      expect(registry.resolveFromFormField('leavetype')).toBe('leave-request');
    });

    it('classifies "leave-type" as leave-request', () => {
      expect(registry.resolveFromFormField('leave-type')).toBe('leave-request');
    });

    it('classifies "applicantname" as candidate', () => {
      expect(registry.resolveFromFormField('applicantname')).toBe('candidate');
    });
  });

  describe('GitHub-style fields still work', () => {
    it('classifies "issuetitle" as issue', () => {
      expect(registry.resolveFromFormField('issuetitle')).toBe('issue');
    });

    it('classifies "pr-title" as pull-request', () => {
      expect(registry.resolveFromFormField('pr-title')).toBe('pull-request');
    });
  });

  describe('auth fields still work', () => {
    it('classifies "username" as user', () => {
      expect(registry.resolveFromFormField('username')).toBe('user');
    });

    it('classifies "email" as user', () => {
      expect(registry.resolveFromFormField('email')).toBe('user');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(registry.resolveFromFormField('')).toBeNull();
    });

    it('returns null for unrecognized field', () => {
      expect(registry.resolveFromFormField('randomfield123')).toBeNull();
    });

    it('returns null for unrecognizable numeric field', () => {
      // "field" is not a known pattern and "id" is not a seed
      expect(registry.resolveFromFormField('field123')).toBeNull();
    });
  });
});
