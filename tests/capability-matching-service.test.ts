/**
 * Tests for the Capability Matching Service.
 *
 * Validates:
 * - Multi-factor scored matching (entry element, inputs, outcome, name)
 * - Decision thresholds (auto-merge ≥ 0.75, ambiguous 0.50–0.75, new < 0.50)
 * - Score decomposition (each signal is individually verifiable)
 * - Candidate → Create/Enrich input converters
 * - Edge cases: empty existing, identical candidate, completely different candidate
 */

import { describe, it, expect } from 'vitest';
import {
  matchCapability,
  candidateToCreateInput,
  candidateToEnrichInput,
  type CapabilityMatchScore,
} from '../src/repository/services/capability-matching-service';
import type { CapabilityCandidate } from '../src/domain/entities/capability-candidate';
import type { Capability } from '../src/domain/entities/capability';
import { createCapability } from '../src/domain/entities/capability';

// ── Helpers ────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CapabilityCandidate> = {}): CapabilityCandidate {
  return {
    capabilityId: 'cand-001',
    name: 'Create Customer',
    purpose: 'Create a new customer record',
    confidence: 'candidate',
    entryElement: {
      elementId: 'elem-submit-001',
      accessibleName: 'Create Customer',
      tag: 'BUTTON',
      role: 'button',
    },
    inputs: [
      { label: 'Name', elementId: 'e1', required: true, inputType: 'text',
        valueRange: null, lengthRange: null, format: null, validOptions: null },
      { label: 'Email', elementId: 'e2', required: true, inputType: 'email',
        valueRange: null, lengthRange: null, format: null, validOptions: null },
      { label: 'Phone', elementId: 'e3', required: false, inputType: 'tel',
        valueRange: null, lengthRange: null, format: null, validOptions: null },
    ],
    observedOutcome: {
      terminalUrl: '/customers',
      successSignals: ['redirect', 'notification'],
      completed: true,
    },
    validationRules: [
      { field: 'Email', type: 'format', description: 'Must be valid email', constraint: 'email' },
      { field: 'Name', type: 'required', description: 'Name is required', constraint: 'required' },
    ],
    observedOutcomes: [],
    businessRules: [],
    failureModes: [],
    sourceSessionId: 'session-001',
    sourceFragmentId: 'frag-001',
    derivedAt: '2026-07-22T00:00:00Z',
    enrichmentHistory: [],
    ...overrides,
  };
}

function makeCapability(overrides: Partial<Capability> = {}): Capability {
  return createCapability({
    projectId: 'proj-001',
    name: 'Create Customer',
    purpose: 'Create a new customer record',
    inputs: [
      { label: 'Name', fieldType: 'text', required: true, validationConstraints: ['required'] },
      { label: 'Email', fieldType: 'email', required: true, validationConstraints: ['format:email'] },
      { label: 'Phone', fieldType: 'tel', required: false, validationConstraints: [] },
    ],
    validationRules: [
      { fieldLabel: 'Email', ruleType: 'format', constraint: 'email', source: 'observed' },
      { fieldLabel: 'Name', ruleType: 'required', constraint: 'required', source: 'observed' },
    ],
    observedOutcomes: [
      { outcomeId: 'outcome-session-001', terminalUrl: '/customers',
        successIndicators: ['redirect', 'notification'],
        description: 'Workflow completed successfully', firstObservedAt: '2026-07-22T00:00:00Z' },
    ],
    sourceSessionId: 'session-000',
    ...overrides,
  });
}

// ── matchCapability — Basic matching ─────────────────────

describe('matchCapability', () => {
  it('returns new-capability when no existing capabilities exist', () => {
    const candidate = makeCandidate();
    const result = matchCapability(candidate, []);

    expect(result.scores).toEqual([]);
    expect(result.bestMatch).toBeNull();
    expect(result.decision).toBe('new-capability');
    expect(result.mergeTargetId).toBeNull();
  });

  it('auto-merges when candidate is identical to existing', () => {
    const candidate = makeCandidate();
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    expect(result.decision).toBe('auto-merge');
    expect(result.mergeTargetId).toBe(existing.id);
    expect(result.bestMatch!.totalScore).toBeGreaterThanOrEqual(0.75);
  });

  it('creates new capability when candidate is completely different', () => {
    const candidate = makeCandidate({
      name: 'Delete Invoice',
      entryElement: {
        elementId: 'elem-delete-999',
        accessibleName: 'Delete',
        tag: 'BUTTON',
        role: 'button',
      },
      inputs: [
        { label: 'Invoice Number', elementId: 'e-inv', required: true, inputType: 'text',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
      ],
      observedOutcome: {
        terminalUrl: '/invoices/deleted',
        successSignals: ['confirmation-dialog'],
        completed: true,
      },
    });
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    expect(result.decision).toBe('new-capability');
    expect(result.bestMatch!.totalScore).toBeLessThan(0.50);
    expect(result.mergeTargetId).toBeNull();
  });

  it('handles ambiguous match (same name, different structure)', () => {
    const candidate = makeCandidate({
      name: 'Create Premium Customer',
      inputs: [
        { label: 'Name', elementId: 'e1', required: true, inputType: 'text',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Email', elementId: 'e2', required: true, inputType: 'email',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Tier', elementId: 'e4', required: true, inputType: 'select',
          valueRange: null, lengthRange: null, format: null, validOptions: ['Gold', 'Silver'] },
        { label: 'Loyalty Points', elementId: 'e5', required: false, inputType: 'number',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
      ],
      entryElement: {
        elementId: 'elem-premium-submit',
        accessibleName: 'Create Premium Customer',
        tag: 'BUTTON',
        role: 'button',
      },
      observedOutcome: {
        terminalUrl: '/customers/premium',
        successSignals: ['redirect'],
        completed: true,
      },
    });
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    // Should be ambiguous or new — "Create Premium Customer" vs "Create Customer"
    // has overlapping name (10% weight) but different entry element, different inputs
    // (only 2 of 5 overlap), and different outcome URL
    expect(['ambiguous', 'new-capability']).toContain(result.decision);
  });
});

// ── matchCapability — Signal decomposition ────────────────

describe('matchCapability — signal decomposition', () => {
  it('decomposes score into individual signals', () => {
    const candidate = makeCandidate();
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);
    const score = result.bestMatch!;

    expect(score).toHaveProperty('entryElementScore');
    expect(score).toHaveProperty('inputScore');
    expect(score).toHaveProperty('outcomeScore');
    expect(score).toHaveProperty('nameScore');
    expect(score).toHaveProperty('totalScore');
  });

  it('input score is 1.0 when input labels are identical', () => {
    const candidate = makeCandidate();
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    expect(result.bestMatch!.inputScore).toBe(1.0);
  });

  it('input score is 0 when input labels are completely disjoint', () => {
    const candidate = makeCandidate({
      inputs: [
        { label: 'Invoice Number', elementId: 'e-inv', required: true, inputType: 'text',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Amount', elementId: 'e-amt', required: true, inputType: 'number',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
      ],
    });
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    expect(result.bestMatch!.inputScore).toBe(0);
  });

  it('input score uses Jaccard coefficient for partial overlap', () => {
    // Candidate has 4 inputs, existing has 3. 2 shared = Jaccard 2/5 = 0.4
    const candidate = makeCandidate({
      inputs: [
        { label: 'Name', elementId: 'e1', required: true, inputType: 'text',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Email', elementId: 'e2', required: true, inputType: 'email',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Phone', elementId: 'e3', required: false, inputType: 'tel',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Address', elementId: 'e4', required: false, inputType: 'text',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
      ],
    });
    const existing = makeCapability({
      inputs: [
        { label: 'Name', fieldType: 'text', required: true, validationConstraints: ['required'] },
        { label: 'Email', fieldType: 'email', required: true, validationConstraints: ['format:email'] },
        { label: 'Phone', fieldType: 'tel', required: false, validationConstraints: [] },
      ],
    });

    // Actually both have Name, Email, Phone — 3 shared, 4 total unique → Jaccard = 3/4 = 0.75
    const result = matchCapability(candidate, [existing]);
    expect(result.bestMatch!.inputScore).toBe(0.75);
  });

  it('name score is 1.0 for identical names', () => {
    const candidate = makeCandidate();
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    expect(result.bestMatch!.nameScore).toBe(1.0);
  });

  it('name score is low for different names with one shared word', () => {
    const candidate = makeCandidate({ name: 'Edit Customer' });
    const existing = makeCapability({ name: 'Create Customer' });

    const result = matchCapability(candidate, [existing]);

    // "Edit Customer" vs "Create Customer" — 1 shared word ("Customer"), 3 total unique → 1/3 = 0.333
    expect(result.bestMatch!.nameScore).toBeCloseTo(0.333, 2);
  });

  it('outcome score is 1.0 for identical outcomes', () => {
    const candidate = makeCandidate();
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    // Same terminal URL + same success signals
    expect(result.bestMatch!.outcomeScore).toBe(1.0);
  });

  it('outcome score is lower for different terminal URLs', () => {
    const candidate = makeCandidate({
      observedOutcome: {
        terminalUrl: '/admin/dashboard',
        successSignals: ['redirect', 'notification'],
        completed: true,
      },
    });
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    expect(result.bestMatch!.outcomeScore).toBeLessThan(1.0);
    // Signal overlap is still 1.0 (redirect + notification) → 0.5 from signals
    expect(result.bestMatch!.outcomeScore).toBe(0.5);
  });
});

// ── matchCapability — Multiple existing capabilities ─────

describe('matchCapability — multiple existing', () => {
  it('returns scores sorted by total score descending', () => {
    const candidate = makeCandidate();
    const existing1 = makeCapability({ name: 'Edit Customer', id: 'cap-edit' });
    const existing2 = makeCapability({ name: 'Create Customer', id: 'cap-create' });

    const result = matchCapability(candidate, [existing1, existing2]);

    expect(result.scores).toHaveLength(2);
    expect(result.scores[0].totalScore).toBeGreaterThanOrEqual(result.scores[1].totalScore);
    expect(result.bestMatch!.capabilityId).toBe(existing2.id); // Better match
  });

  it('picks the best match across multiple candidates', () => {
    const candidate = makeCandidate({ name: 'Create Customer' });
    const cap1 = makeCapability({ name: 'Delete Customer' });
    const cap2 = makeCapability({ name: 'Create Customer' });
    const cap3 = makeCapability({ name: 'Login' });

    const result = matchCapability(candidate, [cap1, cap2, cap3]);

    expect(result.bestMatch!.capabilityId).toBe(cap2.id);
    expect(result.decision).toBe('auto-merge');
  });
});

// ── matchCapability — Edge cases ────────────────────────

describe('matchCapability — edge cases', () => {
  it('handles candidate with no entry element (neutral 0.5)', () => {
    const candidate = makeCandidate({ entryElement: null });
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    // Entry element score should be 0.5 (neutral)
    expect(result.bestMatch!.entryElementScore).toBe(0.5);
  });

  it('handles candidate with no inputs (neutral 0.5)', () => {
    const candidate = makeCandidate({ inputs: [] });
    const existing = makeCapability({ inputs: [] });

    const result = matchCapability(candidate, [existing]);

    // Both empty → neutral
    expect(result.bestMatch!.inputScore).toBe(0.5);
  });

  it('handles existing capability with no observed outcomes (neutral 0.5)', () => {
    const candidate = makeCandidate();
    // Can't create a capability with zero outcomes via the factory,
    // but we can test the scenario by constructing a capability manually
    const existing: Capability = {
      ...makeCapability(),
      observedOutcomes: [],
    };

    const result = matchCapability(candidate, [existing]);

    expect(result.bestMatch!.outcomeScore).toBe(0.5);
  });
});

// ── candidateToCreateInput ───────────────────────────────

describe('candidateToCreateInput', () => {
  it('converts a CapabilityCandidate to CreateCapabilityInput', () => {
    const candidate = makeCandidate();

    const input = candidateToCreateInput(candidate, 'proj-001');

    expect(input.projectId).toBe('proj-001');
    expect(input.name).toBe('Create Customer');
    expect(input.purpose).toBe('Create a new customer record');
    expect(input.inputs).toHaveLength(3);
    expect(input.inputs[0].label).toBe('Name');
    expect(input.inputs[0].fieldType).toBe('text');
    expect(input.inputs[0].required).toBe(true);
    expect(input.validationRules).toHaveLength(2);
    expect(input.observedOutcomes).toHaveLength(1);
    expect(input.observedOutcomes[0].terminalUrl).toBe('/customers');
    expect(input.sourceSessionId).toBe('session-001');
  });

  it('maps inputType null to "text" as default', () => {
    const candidate = makeCandidate({
      inputs: [
        { label: 'Comment', elementId: 'e-c', required: false, inputType: null,
          valueRange: null, lengthRange: null, format: null, validOptions: null },
      ],
    });

    const input = candidateToCreateInput(candidate, 'proj-001');

    expect(input.inputs[0].fieldType).toBe('text');
  });

  it('builds constraint strings from candidate input fields', () => {
    const candidate = makeCandidate({
      inputs: [
        { label: 'Age', elementId: 'e-age', required: true, inputType: 'number',
          valueRange: { min: 0, max: 120, step: 1 },
          lengthRange: null, format: null, validOptions: null },
      ],
    });

    const input = candidateToCreateInput(candidate, 'proj-001');

    expect(input.inputs[0].validationConstraints).toContain('required');
    expect(input.inputs[0].validationConstraints).toContain('range:0-120');
  });
});

// ── candidateToEnrichInput ───────────────────────────────

describe('candidateToEnrichInput', () => {
  it('converts a CapabilityCandidate to EnrichCapabilityInput', () => {
    const candidate = makeCandidate();

    const input = candidateToEnrichInput(candidate);

    expect(input.inputs).toHaveLength(3);
    expect(input.validationRules).toHaveLength(2);
    expect(input.observedOutcomes).toHaveLength(1);
    expect(input.sourceSessionId).toBe('session-001');
    expect(input.consistentObservation).toBe(true);
  });

  it('observed outcome uses session ID in outcomeId for dedup', () => {
    const candidate = makeCandidate();

    const input = candidateToEnrichInput(candidate);

    expect(input.observedOutcomes[0].outcomeId).toBe('outcome-session-001');
  });
});

// ── Weighted score calculation verification ──────────────

describe('matchCapability — weighted score math', () => {
  it('total score equals weighted sum of signals', () => {
    const candidate = makeCandidate();
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);
    const score = result.bestMatch!;

    const expected =
      0.35 * score.entryElementScore +
      0.30 * score.inputScore +
      0.25 * score.outcomeScore +
      0.10 * score.nameScore;

    expect(score.totalScore).toBeCloseTo(expected, 2);
  });

  it('Create Customer vs Add Customer (same form) scores ≥ 0.75 for auto-merge', () => {
    const candidate = makeCandidate({ name: 'Add Customer' });
    const existing = makeCapability({ name: 'Create Customer' });

    const result = matchCapability(candidate, [existing]);

    // Same entry element (Name maps to capability name, which is "Create Customer")
    // Entry element accessibleName is "Create Customer" = existing name → 0.9
    // Same inputs → 1.0
    // Same outcome → 1.0
    // Name: "Add Customer" vs "Create Customer" → 1 shared word → 0.5
    // Total = 0.35*0.9 + 0.30*1.0 + 0.25*1.0 + 0.10*0.5 = 0.315 + 0.3 + 0.25 + 0.05 = 0.915
    expect(result.decision).toBe('auto-merge');
    expect(result.bestMatch!.totalScore).toBeGreaterThanOrEqual(0.75);
  });

  it('Create Customer vs Create Premium Customer scores < 0.75 for no auto-merge', () => {
    const candidate = makeCandidate({
      name: 'Create Premium Customer',
      entryElement: {
        elementId: 'elem-premium-submit',
        accessibleName: 'Create Premium Customer',
        tag: 'BUTTON',
        role: 'button',
      },
      inputs: [
        { label: 'Name', elementId: 'e1', required: true, inputType: 'text',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Email', elementId: 'e2', required: true, inputType: 'email',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Phone', elementId: 'e3', required: false, inputType: 'tel',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
        { label: 'Tier', elementId: 'e4', required: true, inputType: 'select',
          valueRange: null, lengthRange: null, format: null, validOptions: ['Gold', 'Silver'] },
        { label: 'Loyalty Points', elementId: 'e5', required: false, inputType: 'number',
          valueRange: null, lengthRange: null, format: null, validOptions: null },
      ],
      observedOutcome: {
        terminalUrl: '/customers/premium',
        successSignals: ['redirect'],
        completed: true,
      },
    });
    const existing = makeCapability();

    const result = matchCapability(candidate, [existing]);

    // Different entry element → lower score
    // Inputs: 3 shared (Name, Email, Phone), 5 total unique → Jaccard = 3/5 = 0.6
    // Outcome: different URL, signal overlap 1/2 = 0.5 → 0 + 0.25 = 0.25
    // Name: 2 shared ("Create", "Customer") out of 3 unique → 0.67
    // Entry: "Create Premium Customer" vs "Create Customer" → word overlap 2/3 = 0.67
    // Total = 0.35*0.67 + 0.30*0.6 + 0.25*0.25 + 0.10*0.67 = 0.235 + 0.18 + 0.0625 + 0.067 = 0.544
    expect(result.bestMatch!.totalScore).toBeLessThan(0.75);
    expect(['ambiguous', 'new-capability']).toContain(result.decision);
  });
});
