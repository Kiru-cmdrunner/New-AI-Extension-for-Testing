/**
 * Tests for CapabilityCandidate and UnderstandingResult type definitions.
 *
 * These tests verify that the types can be instantiated correctly, that
 * readonly fields enforce immutability (at the TypeScript level), and that
 * the relationships between types are correct.
 */

import { describe, it, expect } from 'vitest';
import type { CapabilityCandidate, CapabilityInput, ValidationRule, OutcomeDescriptor, FailureMode, BusinessRule, EnrichmentEvent } from '../../src/domain/entities/capability-candidate';
import type { UnderstandingResult } from '../../src/domain/entities/understanding-result';
import type { ApplicationKnowledgeFragment } from '../../src/domain/entities/application-knowledge';

// ── Helpers ───────────────────────────────────────────────

function makeMinimalFragment(): ApplicationKnowledgeFragment {
  return {
    sessionId: 'session-001',
    generatedAt: '2026-07-21T22:00:00Z',
    schemaVersion: 1,
    elements: [],
    transitions: [],
    components: [],
    interactionContracts: [],
    behavioralContracts: [],
    logicalActions: [],
    recordedWorkflow: {
      surfaceTransitions: [],
      logicalActions: [],
      branchPoints: [],
      optionalSteps: [],
    },
    applicationSurfaces: [],
  };
}

function makeCapabilityInput(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    label: 'Email',
    elementId: 'elem-001',
    required: true,
    inputType: 'email',
    valueRange: null,
    lengthRange: null,
    format: { regex: '^[^@]+@[^@]+$', description: 'Valid email format' },
    validOptions: null,
    ...overrides,
  };
}

function makeValidationRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return {
    field: 'Email',
    type: 'required',
    description: 'Email field is required',
    constraint: 'required=true',
    ...overrides,
  };
}

function makeOutcomeDescriptor(overrides: Partial<OutcomeDescriptor> = {}): OutcomeDescriptor {
  return {
    terminalUrl: '/customers/123',
    successSignals: ['navigation'],
    completed: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('CapabilityCandidate type', () => {
  it('can be instantiated with all required fields', () => {
    const capability: CapabilityCandidate = {
      capabilityId: 'cap-001',
      name: 'Create Customer',
      purpose: 'Create a new customer record',
      confidence: 'candidate',
      entryElement: {
        elementId: 'elem-save-btn',
        accessibleName: 'Save',
        tag: 'button',
        role: 'button',
      },
      inputs: [makeCapabilityInput()],
      observedOutcome: makeOutcomeDescriptor(),
      validationRules: [makeValidationRule()],
      observedOutcomes: [],
      businessRules: [],
      failureModes: [],
      sourceSessionId: 'session-001',
      sourceFragmentId: 'session-001',
      derivedAt: '2026-07-21T22:00:00Z',
      enrichmentHistory: [],
    };

    expect(capability.capabilityId).toBe('cap-001');
    expect(capability.name).toBe('Create Customer');
    expect(capability.confidence).toBe('candidate');
    expect(capability.inputs).toHaveLength(1);
    expect(capability.entryElement?.accessibleName).toBe('Save');
  });

  it('allows null entryElement for navigation-only sessions', () => {
    const capability: CapabilityCandidate = {
      capabilityId: 'cap-002',
      name: 'Navigation',
      purpose: 'Navigate to a page',
      confidence: 'candidate',
      entryElement: null,
      inputs: [],
      observedOutcome: makeOutcomeDescriptor({ terminalUrl: '/dashboard', completed: true }),
      validationRules: [],
      observedOutcomes: [],
      businessRules: [],
      failureModes: [],
      sourceSessionId: 'session-002',
      sourceFragmentId: 'session-002',
      derivedAt: '2026-07-21T22:00:00Z',
      enrichmentHistory: [],
    };

    expect(capability.entryElement).toBeNull();
    expect(capability.inputs).toHaveLength(0);
  });

  it('supports enrichment fields for future test execution', () => {
    const failureMode: FailureMode = {
      trigger: 'Empty email field',
      outcome: 'Validation error: Email is required',
      observedAt: '2026-07-21T23:00:00Z',
    };

    const businessRule: BusinessRule = {
      description: 'Email must be unique across all customers',
      fields: ['Email'],
      inferredAt: '2026-07-21T23:05:00Z',
    };

    const enrichmentEvent: EnrichmentEvent = {
      type: 'test-execution',
      timestamp: '2026-07-21T23:00:00Z',
      description: 'Revealed email uniqueness validation',
    };

    const capability: CapabilityCandidate = {
      capabilityId: 'cap-001',
      name: 'Create Customer',
      purpose: 'Create a new customer record',
      confidence: 'candidate',
      entryElement: null,
      inputs: [],
      observedOutcome: makeOutcomeDescriptor(),
      validationRules: [],
      observedOutcomes: [makeOutcomeDescriptor({ terminalUrl: '/customers', completed: false })],
      businessRules: [businessRule],
      failureModes: [failureMode],
      sourceSessionId: 'session-001',
      sourceFragmentId: 'session-001',
      derivedAt: '2026-07-21T22:00:00Z',
      enrichmentHistory: [enrichmentEvent],
    };

    expect(capability.failureModes).toHaveLength(1);
    expect(capability.businessRules).toHaveLength(1);
    expect(capability.enrichmentHistory).toHaveLength(1);
    expect(capability.observedOutcomes).toHaveLength(1);
  });

  it('CapabilityInput supports all constraint types', () => {
    const numericInput: CapabilityInput = makeCapabilityInput({
      label: 'Age',
      inputType: 'number',
      required: true,
      valueRange: { min: 0, max: 150, step: 1 },
      format: null,
      validOptions: null,
    });

    const selectInput: CapabilityInput = makeCapabilityInput({
      label: 'Country',
      inputType: null,
      required: true,
      valueRange: null,
      format: null,
      validOptions: ['US', 'CA', 'UK', 'AU'],
    });

    const textInput: CapabilityInput = makeCapabilityInput({
      label: 'Username',
      inputType: 'text',
      required: true,
      valueRange: null,
      lengthRange: { minLength: 3, maxLength: 20 },
      format: { regex: '^[a-zA-Z0-9_]+$', description: 'Alphanumeric + underscore' },
      validOptions: null,
    });

    expect(numericInput.valueRange?.min).toBe(0);
    expect(selectInput.validOptions).toHaveLength(4);
    expect(textInput.lengthRange?.maxLength).toBe(20);
  });

  it('ValidationRule covers all rule types', () => {
    const rules: ValidationRule[] = [
      makeValidationRule({ type: 'required', description: 'Name is required', constraint: 'required=true' }),
      makeValidationRule({ type: 'format', description: 'Email must be valid', constraint: 'regex=^[^@]+@[^@]+$' }),
      makeValidationRule({ type: 'range', description: 'Age must be 0-150', constraint: 'min=0,max=150' }),
      makeValidationRule({ type: 'length', description: 'Username 3-20 chars', constraint: 'minLength=3,maxLength=20' }),
      makeValidationRule({ type: 'options', description: 'Must select a country', constraint: 'options=US,CA,UK,AU' }),
    ];

    expect(rules).toHaveLength(5);
    expect(rules.map(r => r.type)).toEqual(['required', 'format', 'range', 'length', 'options']);
  });

  it('OutcomeDescriptor captures success signals', () => {
    const outcome: OutcomeDescriptor = {
      terminalUrl: '/customers/123',
      successSignals: ['navigation', 'valueDisplay'],
      completed: true,
    };

    expect(outcome.successSignals).toHaveLength(2);
    expect(outcome.completed).toBe(true);
  });

  it('EnrichmentEvent tracks enrichment history', () => {
    const events: EnrichmentEvent[] = [
      { type: 'initial-derivation', timestamp: '2026-07-21T22:00:00Z', description: 'Derived from first recording' },
      { type: 'test-execution', timestamp: '2026-07-21T23:00:00Z', description: 'Revealed email uniqueness' },
      { type: 'cross-session', timestamp: '2026-07-22T10:00:00Z', description: 'Confirmed consistent behavior across 3 sessions' },
      { type: 'ai-enrichment', timestamp: '2026-07-22T11:00:00Z', description: 'AI inferred purpose: customer creation workflow' },
    ];

    expect(events).toHaveLength(4);
    expect(events.map(e => e.type)).toEqual([
      'initial-derivation', 'test-execution', 'cross-session', 'ai-enrichment',
    ]);
  });
});

describe('UnderstandingResult type', () => {
  it('can be instantiated with fragment and capability', () => {
    const result: UnderstandingResult = {
      sessionId: 'session-001',
      generatedAt: '2026-07-21T22:00:00Z',
      schemaVersion: 1,
      fragment: makeMinimalFragment(),
      capability: {
        capabilityId: 'cap-001',
        name: 'Create Customer',
        purpose: 'Create a new customer record',
        confidence: 'candidate',
        entryElement: null,
        inputs: [],
        observedOutcome: makeOutcomeDescriptor(),
        validationRules: [],
        observedOutcomes: [],
        businessRules: [],
        failureModes: [],
        sourceSessionId: 'session-001',
        sourceFragmentId: 'session-001',
        derivedAt: '2026-07-21T22:00:00Z',
        enrichmentHistory: [],
      },
    };

    expect(result.sessionId).toBe('session-001');
    expect(result.fragment!.elements).toEqual([]);
    expect(result.capability?.name).toBe('Create Customer');
  });

  it('allows null capability when derivation fails', () => {
    const result: UnderstandingResult = {
      sessionId: 'session-001',
      generatedAt: '2026-07-21T22:00:00Z',
      schemaVersion: 1,
      fragment: makeMinimalFragment(),
      capability: null,
    };

    expect(result.capability).toBeNull();
    expect(result.fragment).toBeDefined();
  });

  it('is the layer boundary — Generation Layer imports this, not individual types', () => {
    // The IR Bridge should accept UnderstandingResult as input, not
    // fragment + capability separately. This test verifies the type
    // can be consumed without importing individual artifact types.
    const result: UnderstandingResult = {
      sessionId: 'session-001',
      generatedAt: '2026-07-21T22:00:00Z',
      schemaVersion: 1,
      fragment: makeMinimalFragment(),
      capability: null,
    };

    // Consumer reads what it needs from the aggregate
    const fragment = result.fragment;
    const capability = result.capability;

    expect(fragment).toBeDefined();
    expect(capability).toBeNull();
  });
});
