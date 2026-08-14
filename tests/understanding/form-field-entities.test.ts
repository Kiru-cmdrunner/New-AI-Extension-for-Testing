/**
 * D6 — Form-Field Entity Creation Tests
 *
 * Verifies that entity creation from input-value-change signals is
 * no longer limited to search/query fields. Domain-specific field
 * patterns (employee name, leave type, username, issue title, etc.)
 * now also create entities via the EntityTypeRegistry.
 *
 * Architecture: .drytis/specs/deterministic-defects.md §D6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { EntityTypeRegistry, createEntityTypeRegistry } from '../../src/understanding/state-builder/entity-type-registry';
import type { SignalSet } from '../../src/understanding/types';

function makeInputSignal(
  interactionId: string,
  field: string,
  newValue: string,
): SignalSet {
  return {
    interactionId,
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [{
      type: 'input-value-change',
      source: 'target-state',
      interactionId,
      field,
      oldValue: null,
      newValue,
      elementLabel: null,
    }],
    pageContent: null,
  } as unknown as SignalSet;
}

describe('D6 — Form-Field Entity Creation (generalized)', () => {
  let registry: EntityTypeRegistry;
  let builder: StateBuilder;

  beforeEach(() => {
    registry = createEntityTypeRegistry(true);
    builder = new StateBuilder(registry);
  });

  it('creates search-query entity for search field (backward compat)', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'search-field', 'laptop'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.some((e) => e.type === 'search-query')).toBe(true);
    expect(result.changes.some((c) => c.includes('search query'))).toBe(true);
  });

  it('creates employee entity for employeeName field', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'employeeName', 'John Doe'));
    const entities = Array.from(result.after.entities.values());
    const emp = entities.find((e) => e.type === 'employee');
    expect(emp).toBeDefined();
    expect(emp!.attributes.value).toBe('John Doe');
    expect(result.changes.some((c) => c.includes('form field entity (employee)'))).toBe(true);
  });

  it('creates leave-request entity for leaveType field', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'leaveType', 'Annual'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.some((e) => e.type === 'leave-request')).toBe(true);
  });

  it('creates user entity for username field', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'username', 'admin'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.some((e) => e.type === 'user')).toBe(true);
  });

  it('creates issue entity for issueTitle field', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'issueTitle', 'Bug in checkout'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.some((e) => e.type === 'issue')).toBe(true);
  });

  it('creates form-entry entity for generic title field', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'title', 'My Project'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.some((e) => e.type === 'form-entry')).toBe(true);
  });

  it('does not create entity for unrecognized field', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'someRandomField', 'value'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.length).toBe(0);
  });

  it('does not create entity when newValue is empty', () => {
    const result = builder.processSignals(makeInputSignal('int-1', 'employeeName', '   '));
    const entities = Array.from(result.after.entities.values());
    expect(entities.length).toBe(0);
  });

  it('custom field patterns from DomainPack work', () => {
    registry.clear();
    registry.register({
      entityType: 'invoice',
      fieldPatterns: ['invoice-number', 'po-number'],
    });
    const customBuilder = new StateBuilder(registry);
    const result = customBuilder.processSignals(makeInputSignal('int-1', 'invoice-number', 'INV-001'));
    const entities = Array.from(result.after.entities.values());
    expect(entities.some((e) => e.type === 'invoice')).toBe(true);
  });
});
