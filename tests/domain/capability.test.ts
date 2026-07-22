/**
 * Tests for the Capability domain entity — createCapability() and enrichCapability().
 *
 * Validates:
 * - Factory function invariant validation
 * - Initial capability structure (confidence = 'candidate', 1 session, 1 enrichment event)
 * - Additive enrichment (inputs, validationRules, outcomes, businessRules, failureModes)
 * - Constraint conflict resolution (stricter constraint wins)
 * - Session ID deduplication
 * - Confidence progression (candidate → confirmed → established)
 * - Confidence stalls on conflict
 * - Enrichment history append-only
 * - Immutability of existing fields after enrichment
 */

import { describe, it, expect } from 'vitest';
import {
  createCapability,
  enrichCapability,
  type Capability,
  type CapabilityInput,
  type CapabilityValidationRule,
  type CapabilityOutcome,
  type CapabilityBusinessRule,
  type CapabilityFailureMode,
  type CreateCapabilityInput,
} from '../../src/domain/entities/capability';

// ── Helpers ────────────────────────────────────────────────

function makeInput(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    label: 'Email',
    fieldType: 'email',
    required: true,
    validationConstraints: ['format:email'],
    ...overrides,
  };
}

function makeRule(overrides: Partial<CapabilityValidationRule> = {}): CapabilityValidationRule {
  return {
    fieldLabel: 'Email',
    ruleType: 'format',
    constraint: 'email',
    source: 'observed',
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<CapabilityOutcome> = {}): CapabilityOutcome {
  return {
    outcomeId: 'outcome-1',
    terminalUrl: '/dashboard',
    successIndicators: ['redirect'],
    description: 'Navigates to dashboard',
    firstObservedAt: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

function makeBusinessRule(overrides: Partial<CapabilityBusinessRule> = {}): CapabilityBusinessRule {
  return {
    ruleId: 'rule-1',
    description: 'Email must be unique',
    source: 'observed',
    confirmed: false,
    ...overrides,
  };
}

function makeFailureMode(overrides: Partial<CapabilityFailureMode> = {}): CapabilityFailureMode {
  return {
    failureId: 'failure-1',
    description: 'Validation error on duplicate email',
    trigger: 'submit with existing email',
    firstObservedAt: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<CreateCapabilityInput> = {}): CreateCapabilityInput {
  return {
    projectId: 'proj-001',
    name: 'Create Customer',
    purpose: 'Create a new customer record',
    inputs: [makeInput()],
    validationRules: [makeRule()],
    observedOutcomes: [makeOutcome()],
    sourceSessionId: 'session-001',
    ...overrides,
  };
}

// ── createCapability() ─────────────────────────────────────

describe('createCapability', () => {
  it('creates a capability with all fields populated', () => {
    const input = makeCreateInput();
    const cap = createCapability(input);

    expect(cap.id).toBeDefined();
    expect(cap.projectId).toBe('proj-001');
    expect(cap.name).toBe('Create Customer');
    expect(cap.purpose).toBe('Create a new customer record');
    expect(cap.confidence).toBe('candidate');
    expect(cap.inputs).toHaveLength(1);
    expect(cap.validationRules).toHaveLength(1);
    expect(cap.observedOutcomes).toHaveLength(1);
    expect(cap.businessRules).toEqual([]);
    expect(cap.failureModes).toEqual([]);
    expect(cap.sessionIds).toEqual(['session-001']);
    expect(cap.enrichmentHistory).toHaveLength(1);
    expect(cap.enrichmentHistory[0].type).toBe('initial-derivation');
    expect(cap.enrichmentHistory[0].confidenceAfter).toBe('candidate');
    expect(cap.createdAt).toBeDefined();
    expect(cap.lastEnrichedAt).toBe(cap.createdAt);
  });

  it('includes business rules and failure modes when provided', () => {
    const cap = createCapability(
      makeCreateInput({
        businessRules: [makeBusinessRule()],
        failureModes: [makeFailureMode()],
      }),
    );

    expect(cap.businessRules).toHaveLength(1);
    expect(cap.failureModes).toHaveLength(1);
  });

  it('throws MissingFieldError if projectId is empty', () => {
    expect(() => createCapability(makeCreateInput({ projectId: '' }))).toThrow();
    expect(() => createCapability(makeCreateInput({ projectId: '  ' }))).toThrow();
  });

  it('throws MissingFieldError if name is empty', () => {
    expect(() => createCapability(makeCreateInput({ name: '' }))).toThrow();
    expect(() => createCapability(makeCreateInput({ name: '  ' }))).toThrow();
  });

  it('throws MissingFieldError if sourceSessionId is empty', () => {
    expect(() => createCapability(makeCreateInput({ sourceSessionId: '' }))).toThrow();
    expect(() => createCapability(makeCreateInput({ sourceSessionId: '  ' }))).toThrow();
  });

  it('trims whitespace on name, purpose, and projectId', () => {
    const cap = createCapability(
      makeCreateInput({
        projectId: '  proj-001  ',
        name: '  Create Customer  ',
        purpose:  '  Create a new customer record  ',
      }),
    );

    expect(cap.projectId).toBe('proj-001');
    expect(cap.name).toBe('Create Customer');
    expect(cap.purpose).toBe('Create a new customer record');
  });

  it('initial enrichment event records all added items', () => {
    const cap = createCapability(makeCreateInput());

    const event = cap.enrichmentHistory[0];
    expect(event.changes.added.inputs).toEqual(['Email']);
    expect(event.changes.added.validationRules).toEqual(['Email:format']);
    expect(event.changes.added.observedOutcomes).toEqual(['outcome-1']);
    expect(event.changes.added.sessionIds).toEqual(['session-001']);
    expect(event.changes.modified).toEqual([]);
    expect(event.changes.conflicts).toEqual([]);
  });

  it('creates a unique ID for each capability', () => {
    const cap1 = createCapability(makeCreateInput());
    const cap2 = createCapability(makeCreateInput());

    expect(cap1.id).not.toBe(cap2.id);
  });
});

// ── enrichCapability() ──────────────────────────────────────

describe('enrichCapability', () => {
  it('adds new inputs that are not already present', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Phone' })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.inputs).toHaveLength(2);
    expect(enriched.inputs[1].label).toBe('Phone');
    expect(enriched.enrichmentHistory).toHaveLength(2);
  });

  it('does not add duplicate inputs (by label)', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Email' })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.inputs).toHaveLength(1);
  });

  it('adds new validation rules that are not duplicates', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [makeRule({ fieldLabel: 'Phone', ruleType: 'required' })],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.validationRules).toHaveLength(2);
    expect(enriched.validationRules[1].fieldLabel).toBe('Phone');
  });

  it('skips duplicate validation rules by fieldLabel+ruleType', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [makeRule({ fieldLabel: 'Email', ruleType: 'format' })],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.validationRules).toHaveLength(1);
  });

  it('adds new observed outcomes', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [makeOutcome({ outcomeId: 'outcome-2', terminalUrl: '/error' })],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.observedOutcomes).toHaveLength(2);
  });

  it('does not add duplicate outcomes by outcomeId', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [makeOutcome({ outcomeId: 'outcome-1' })],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.observedOutcomes).toHaveLength(1);
  });

  it('adds new session ID if not already present', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.sessionIds).toEqual(['session-001', 'session-002']);
  });

  it('does not add duplicate session ID', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-001',
      consistentObservation: true,
    });

    expect(enriched.sessionIds).toEqual(['session-001']);
  });

  it('advances confidence from candidate to confirmed with 2 consistent sessions', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.confidence).toBe('confirmed');
    expect(enriched.enrichmentHistory[1].confidenceAfter).toBe('confirmed');
  });

  it('advances confidence from confirmed to established with 3 consistent sessions', () => {
    const cap = createCapability(makeCreateInput());

    const enriched1 = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    const enriched2 = enrichCapability(enriched1, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-003',
      consistentObservation: true,
    });

    expect(enriched2.confidence).toBe('established');
  });

  it('stalls confidence advancement when there is a conflict', () => {
    const cap = createCapability(makeCreateInput());

    // Enrich with a conflict (same field, different required flag)
    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Email', required: false })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    // Confidence should stay at 'candidate' despite 2 sessions (conflict stalls)
    expect(enriched.confidence).toBe('candidate');
    expect(enriched.enrichmentHistory[1].changes.conflicts.length).toBeGreaterThan(0);
  });

  it('records constraint conflict with stricter-wins resolution', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Email', required: false })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    const conflict = enriched.enrichmentHistory[1].changes.conflicts[0];
    expect(conflict.field).toBe('inputs[Email].required');
    expect(conflict.existing).toBe(true);
    expect(conflict.candidate).toBe(false);
    expect(conflict.resolution).toContain('stricter');
  });

  it('applies stricter constraint (required=true wins over required=false)', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Email', required: false })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    const emailInput = enriched.inputs.find((i) => i.label === 'Email');
    expect(emailInput?.required).toBe(true); // stricter wins
  });

  it('records enrichment event with sourceSessionId', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Phone' })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.enrichmentHistory[1].sourceSessionId).toBe('session-002');
    expect(enriched.enrichmentHistory[1].type).toBe('cross-session-merge');
  });

  it('updates lastEnrichedAt on enrichment', () => {
    const cap = createCapability(makeCreateInput());
    const originalTimestamp = cap.lastEnrichedAt;

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    // lastEnrichedAt should be a valid ISO timestamp >= original
    expect(enriched.lastEnrichedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(enriched.lastEnrichedAt >= originalTimestamp).toBe(true);
  });

  it('does not modify the original capability (pure function)', () => {
    const cap = createCapability(makeCreateInput());
    const originalHistoryLength = cap.enrichmentHistory.length;
    const originalSessionCount = cap.sessionIds.length;

    enrichCapability(cap, {
      inputs: [makeInput({ label: 'Phone' })],
      validationRules: [],
      observedOutcomes: [],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(cap.enrichmentHistory.length).toBe(originalHistoryLength);
    expect(cap.sessionIds.length).toBe(originalSessionCount);
    expect(cap.inputs).toHaveLength(1);
  });

  it('throws MissingFieldError if sourceSessionId is empty', () => {
    const cap = createCapability(makeCreateInput());

    expect(() =>
      enrichCapability(cap, {
        inputs: [],
        validationRules: [],
        observedOutcomes: [],
        sourceSessionId: '',
        consistentObservation: true,
      }),
    ).toThrow();
  });

  it('drops confidence on contradictory evidence', () => {
    // Start with an established capability (3 sessions)
    let cap = createCapability(makeCreateInput());
    cap = enrichCapability(cap, {
      inputs: [], validationRules: [], observedOutcomes: [],
      sourceSessionId: 'session-002', consistentObservation: true,
    });
    expect(cap.confidence).toBe('confirmed');
    cap = enrichCapability(cap, {
      inputs: [], validationRules: [], observedOutcomes: [],
      sourceSessionId: 'session-003', consistentObservation: true,
    });
    expect(cap.confidence).toBe('established');

    // Contradictory evidence
    const degraded = enrichCapability(cap, {
      inputs: [], validationRules: [], observedOutcomes: [],
      sourceSessionId: 'session-004', consistentObservation: false,
    });

    expect(degraded.confidence).toBe('confirmed');
  });

  it('adds business rules and failure modes during enrichment', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [],
      validationRules: [],
      observedOutcomes: [],
      businessRules: [makeBusinessRule({ ruleId: 'rule-2', description: 'Phone is required for premium' })],
      failureModes: [makeFailureMode({ failureId: 'failure-2', description: 'Server error on timeout' })],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    expect(enriched.businessRules).toHaveLength(1);
    expect(enriched.businessRules[0].ruleId).toBe('rule-2');
    expect(enriched.failureModes).toHaveLength(1);
    expect(enriched.failureModes[0].failureId).toBe('failure-2');
  });

  it('preserves existing inputs, rules, outcomes during enrichment', () => {
    const cap = createCapability(makeCreateInput());

    const enriched = enrichCapability(cap, {
      inputs: [makeInput({ label: 'Phone' })],
      validationRules: [makeRule({ fieldLabel: 'Phone', ruleType: 'required' })],
      observedOutcomes: [makeOutcome({ outcomeId: 'outcome-2' })],
      sourceSessionId: 'session-002',
      consistentObservation: true,
    });

    // Original items still present
    expect(enriched.inputs.some((i) => i.label === 'Email')).toBe(true);
    expect(enriched.validationRules.some((r) => r.fieldLabel === 'Email')).toBe(true);
    expect(enriched.observedOutcomes.some((o) => o.outcomeId === 'outcome-1')).toBe(true);
    // New items also present
    expect(enriched.inputs.some((i) => i.label === 'Phone')).toBe(true);
    expect(enriched.validationRules.some((r) => r.fieldLabel === 'Phone')).toBe(true);
    expect(enriched.observedOutcomes.some((o) => o.outcomeId === 'outcome-2')).toBe(true);
  });
});

// ── Type-level tests ────────────────────────────────────────

describe('Capability type properties', () => {
  it('EnrichmentEvent is a discriminated union by type', () => {
    const cap = createCapability(makeCreateInput());
    const event = cap.enrichmentHistory[0];

    expect(event.type).toBe('initial-derivation');
    expect(event.changes.added.inputs).toBeDefined();
    expect(event.confidenceAfter).toBe('candidate');
  });
});
