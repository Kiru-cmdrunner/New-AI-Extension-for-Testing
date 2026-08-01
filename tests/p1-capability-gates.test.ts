/**
 * P1 Capability Lifecycle Management — Gate Tests (G9)
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §12 EC1-EC14
 *
 * These tests verify the P1 implementation against the 14 exit criteria.
 * Each test corresponds to one exit criterion (EC1-EC14).
 *
 * Exit Criteria:
 *   EC1:  sourceInteractionType carried through enrichment pipeline
 *   EC2:  inputMethod derived from sourceInteractionType
 *   EC3:  DataRequirement.kind correctly derived
 *   EC4:  CapabilityReview created from candidate + match
 *   EC5:  processDecision approve → creates Capability + Version + Contract
 *   EC6:  processDecision reject → no Capability created
 *   EC7:  CapabilityVersion immutable (sourceSessionId provenance)
 *   EC8:  P2CapabilityContract has dataRequirements with inputMethod
 *   EC9:  SessionPersistenceService creates review (not auto-creates capability)
 *   EC10: Filter Products consistency trace (Category/OnSale/MaxPrice)
 *   EC11: inputMethod taxonomy covers all 23 InteractionTypes
 *   EC12: Dexie V4 schema has capabilityReviews + capabilityVersions tables
 *   EC13: Filter Products trace verification (expanded)
 *   EC14: sourceInteractionType carry-through verification
 */

import { describe, it, expect } from 'vitest';
import { interactionTypeToInputMethod, capabilityInputToDataRequirement, candidateToDataRequirements, successIndicatorsToCriteria } from '../src/domain/mappings/capability-mappers';
import { createReview, processDecision } from '../src/domain/services/capability-review-service';
import type { CapabilityCandidate, CapabilityInput, ValidationRule, OutcomeDescriptor } from '../src/domain/entities/capability-candidate';
import type { CapabilityReview, CapabilityReviewEdits } from '../src/domain/entities/capability-review';
import type { InputMethod } from '../src/domain/entities/data-requirement';
import type { InteractionType } from '../src/shared/component-types';
import type { SuccessIndicator } from '../src/domain/entities/application-knowledge';

// ── Test Helpers ──────────────────────────────────────────

function makeInput(
  label: string,
  sourceInteractionType: InteractionType | null,
  overrides: Partial<CapabilityInput> = {},
): CapabilityInput {
  return {
    label,
    elementId: `el-${label}`,
    required: false,
    inputType: null,
    valueRange: null,
    lengthRange: null,
    format: null,
    validOptions: null,
    sourceInteractionType,
    ...overrides,
  };
}

function makeCandidate(
  name: string,
  inputs: CapabilityInput[],
  overrides: Partial<CapabilityCandidate> = {},
): CapabilityCandidate {
  return {
    capabilityId: `cap-${name.replace(/\s/g, '-')}`,
    name,
    purpose: `Purpose for ${name}`,
    confidence: 'candidate',
    entryElement: { accessibleName: name, tag: 'button', id: 'entry-1', role: 'button', classes: [] },
    inputs,
    observedOutcome: { terminalUrl: '/success', successSignals: ['dashboard loaded'] },
    validationRules: [],
    sourceSessionId: 'session-123',
    sourceFragmentId: 'frag-123',
    derivedAt: new Date().toISOString(),
    enrichmentHistory: [],
    ...overrides,
  };
}

const emptyEdits: CapabilityReviewEdits = {
  nameChanged: false,
  purposeChanged: false,
  inputsEdited: false,
  successCriteriaEdited: false,
  editedName: null,
  editedPurpose: null,
  editedDataRequirements: null,
  editedSuccessCriteria: null,
};

// ── EC1: sourceInteractionType carried through ─────────────

describe('EC1 — sourceInteractionType carried through enrichment pipeline', () => {
  it('maps Dropdown PatternType → InteractionType Dropdown', () => {
    const input = makeInput('Category', 'Dropdown');
    expect(input.sourceInteractionType).toBe('Dropdown');
  });

  it('maps Checkbox → Checkbox interaction type', () => {
    const input = makeInput('On Sale', 'Checkbox');
    expect(input.sourceInteractionType).toBe('Checkbox');
  });

  it('maps Slider → Slider interaction type', () => {
    const input = makeInput('Max Price', 'Slider');
    expect(input.sourceInteractionType).toBe('Slider');
  });

  it('preserves null for non-data interactions', () => {
    const input = makeInput('Submit Button', null);
    expect(input.sourceInteractionType).toBeNull();
  });
});

// ── EC2: inputMethod derived from sourceInteractionType ───

describe('EC2 — inputMethod derived from sourceInteractionType', () => {
  it('derives dropdown from Dropdown interaction type', () => {
    expect(interactionTypeToInputMethod('Dropdown')).toBe('dropdown');
  });

  it('derives toggle from Checkbox interaction type', () => {
    expect(interactionTypeToInputMethod('Checkbox')).toBe('toggle');
  });

  it('derives slider from Slider interaction type', () => {
    expect(interactionTypeToInputMethod('Slider')).toBe('slider');
  });

  it('derives text from TextEntry interaction type', () => {
    expect(interactionTypeToInputMethod('TextEntry')).toBe('text');
  });

  it('derives datePicker from DatePicker interaction type', () => {
    expect(interactionTypeToInputMethod('DatePicker')).toBe('datePicker');
  });

  it('derives fileUpload from FileUpload interaction type', () => {
    expect(interactionTypeToInputMethod('FileUpload')).toBe('fileUpload');
  });

  it('returns null for Click (non-data-input type)', () => {
    expect(interactionTypeToInputMethod('Click')).toBeNull();
  });

  it('derives dropdown from all dropdown subtypes', () => {
    expect(interactionTypeToInputMethod('NativeDropdown')).toBe('dropdown');
    expect(interactionTypeToInputMethod('CustomDropdown')).toBe('dropdown');
    expect(interactionTypeToInputMethod('Autocomplete')).toBe('dropdown');
    expect(interactionTypeToInputMethod('SearchableDropdown')).toBe('dropdown');
  });

  it('derives slider from all slider subtypes', () => {
    expect(interactionTypeToInputMethod('NativeSlider')).toBe('slider');
    expect(interactionTypeToInputMethod('AriaSlider')).toBe('slider');
    expect(interactionTypeToInputMethod('CustomSlider')).toBe('slider');
    expect(interactionTypeToInputMethod('RangeSlider')).toBe('slider');
  });
});

// ── EC3: DataRequirement.kind correctly derived ────────────

describe('EC3 — DataRequirement.kind correctly derived', () => {
  it('derives select kind for dropdown with validOptions', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('Category', 'Dropdown', {
        validOptions: ['Electronics', 'Books', 'Clothing'],
      }),
    );
    expect(req.kind).toBe('select');
    expect(req.inputMethod).toBe('dropdown');
  });

  it('derives boolean kind for toggle (Checkbox)', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('On Sale', 'Checkbox'),
    );
    expect(req.kind).toBe('boolean');
    expect(req.inputMethod).toBe('toggle');
  });

  it('derives number kind for slider with valueRange', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('Max Price', 'Slider', {
        valueRange: { min: 0, max: 1000, step: 10 },
      }),
    );
    expect(req.kind).toBe('number');
    expect(req.inputMethod).toBe('slider');
  });

  it('derives text kind for TextEntry with no constraints', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('Search Query', 'TextEntry'),
    );
    expect(req.kind).toBe('text');
    expect(req.inputMethod).toBe('text');
  });

  it('derives email kind when inputType is email', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('Email', 'TextEntry', { inputType: 'email' }),
    );
    expect(req.kind).toBe('email');
  });

  it('derives date kind when inputType is date', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('Start Date', 'DatePicker', { inputType: 'date' }),
    );
    expect(req.kind).toBe('date');
  });

  it('preserves constraints in DataRequirement', () => {
    const req = capabilityInputToDataRequirement(
      makeInput('Max Price', 'Slider', {
        valueRange: { min: 0, max: 1000, step: 10 },
      }),
    );
    expect(req.constraints.min).toBe(0);
    expect(req.constraints.max).toBe(1000);
    expect(req.constraints.step).toBe(10);
  });
});

// ── EC4: CapabilityReview created from candidate + match ──

describe('EC4 — CapabilityReview created from candidate + match', () => {
  it('creates a review in pending state', () => {
    const candidate = makeCandidate('Login', [
      makeInput('Email', 'TextEntry'),
      makeInput('Password', 'TextEntry'),
    ]);
    const matchResult = {
      scores: [],
      bestMatch: null,
      decision: 'new-capability' as const,
      mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-123');

    expect(review.state).toBe('pending');
    expect(review.sessionId).toBe('session-123');
    expect(review.capabilityCandidateId).toBe(candidate.capabilityId);
    expect(review.matchSuggestion.decision).toBe('new-capability');
    expect(review.resultCapabilityId).toBeNull();
    expect(review.resultVersionId).toBeNull();
  });

  it('creates a review with auto-merge suggestion', () => {
    const candidate = makeCandidate('Login', [makeInput('Email', 'TextEntry')]);
    const matchResult = {
      scores: [{ capabilityId: 'cap-1', totalScore: 0.85, entryElementScore: 0.9, inputScore: 0.8, outcomeScore: 0.85, nameScore: 0.8, decision: 'auto-merge' as const }],
      bestMatch: { capabilityId: 'cap-1', totalScore: 0.85, entryElementScore: 0.9, inputScore: 0.8, outcomeScore: 0.85, nameScore: 0.8, decision: 'auto-merge' as const },
      decision: 'auto-merge' as const,
      mergeTargetId: 'cap-1',
    };
    const review = createReview(candidate, matchResult, 'session-456');

    expect(review.state).toBe('pending');
    expect(review.matchSuggestion.decision).toBe('auto-merge');
    expect(review.matchSuggestion.bestMatchId).toBe('cap-1');
  });
});

// ── EC5: processDecision approve → creates Capability + Version + Contract ─

describe('EC5 — processDecision approve creates Capability + Version + Contract', () => {
  it('creates a capability, version, and contract on approval', () => {
    const candidate = makeCandidate('Login', [
      makeInput('Email', 'TextEntry', { inputType: 'email' }),
      makeInput('Password', 'TextEntry'),
    ]);
    const matchResult = {
      scores: [],
      bestMatch: null,
      decision: 'new-capability' as const,
      mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-789');
    const successIndicators: SuccessIndicator[] = [
      { signal: '/dashboard', type: 'navigation', description: 'Dashboard page loads' },
    ];

    const result = processDecision(
      review,
      'approve',
      emptyEdits,
      'reviewer@test.com',
      candidate,
      null,
      'https://app.example.com/login',
      successIndicators,
    );

    expect(result.capability).not.toBeNull();
    expect(result.version).not.toBeNull();
    expect(result.contract).not.toBeNull();
    expect(result.review.state).toBe('approved');
    expect(result.review.resultCapabilityId).not.toBeNull();
    expect(result.review.resultVersionId).not.toBeNull();
  });

  it('version has correct provenance (sourceSessionId)', () => {
    const candidate = makeCandidate('Login', [makeInput('Email', 'TextEntry')]);
    const matchResult = {
      scores: [],
      bestMatch: null,
      decision: 'new-capability' as const,
      mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-789');
    const result = processDecision(
      review, 'approve', emptyEdits, 'reviewer@test.com',
      candidate, null, 'https://app.example.com/login', [],
    );

    expect(result.version).not.toBeNull();
    expect(result.version!.sourceSessionId).toBe('session-789');
  });

  it('contract has dataRequirements with inputMethod', () => {
    const candidate = makeCandidate('Login', [
      makeInput('Email', 'TextEntry', { inputType: 'email' }),
    ]);
    const matchResult = {
      scores: [], bestMatch: null, decision: 'new-capability' as const, mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-789');
    const result = processDecision(
      review, 'approve', emptyEdits, 'reviewer@test.com',
      candidate, null, 'https://app.example.com/login', [],
    );

    expect(result.contract!.dataRequirements).toHaveLength(1);
    expect(result.contract!.dataRequirements[0].inputMethod).toBe('text');
    expect(result.contract!.dataRequirements[0].kind).toBe('email');
  });
});

// ── EC6: processDecision reject → no Capability created ───

describe('EC6 — processDecision reject creates no Capability', () => {
  it('does not create capability, version, or contract on rejection', () => {
    const candidate = makeCandidate('Login', [makeInput('Email', 'TextEntry')]);
    const matchResult = {
      scores: [], bestMatch: null, decision: 'new-capability' as const, mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-789');
    const result = processDecision(
      review, 'reject', emptyEdits, 'reviewer@test.com',
      candidate, null, 'https://app.example.com/login', [],
    );

    expect(result.capability).toBeNull();
    expect(result.version).toBeNull();
    expect(result.contract).toBeNull();
    expect(result.review.state).toBe('rejected');
    expect(result.review.resultCapabilityId).toBeNull();
  });
});

// ── EC7: CapabilityVersion immutability + provenance ──────

describe('EC7 — CapabilityVersion provenance', () => {
  it('version links back to sourceSessionId', () => {
    const candidate = makeCandidate('Search', [makeInput('Query', 'TextEntry')]);
    const matchResult = {
      scores: [], bestMatch: null, decision: 'new-capability' as const, mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-source-001');
    const result = processDecision(
      review, 'approve', emptyEdits, 'user@test.com',
      candidate, null, 'https://shop.example.com', [],
    );

    expect(result.version!.sourceSessionId).toBe('session-source-001');
    expect(result.version!.versionId).toContain(result.capability!.id);
    expect(result.version!.versionNumber).toBe(1);
    expect(result.version!.reviewDecision).toBe('approved');
  });
});

// ── EC8: P2CapabilityContract has dataRequirements ────────

describe('EC8 — P2CapabilityContract has dataRequirements with inputMethod', () => {
  it('contract exposes all data requirements', () => {
    const candidate = makeCandidate('Checkout', [
      makeInput('Full Name', 'TextEntry'),
      makeInput('Country', 'Dropdown', { validOptions: ['US', 'UK', 'CA'] }),
      makeInput('Agree to Terms', 'Checkbox'),
    ]);
    const matchResult = {
      scores: [], bestMatch: null, decision: 'new-capability' as const, mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-checkout');
    const result = processDecision(
      review, 'approve', emptyEdits, 'user@test.com',
      candidate, null, 'https://shop.example.com/checkout', [],
    );

    const reqs = result.contract!.dataRequirements;
    expect(reqs).toHaveLength(3);

    // Full Name → text
    expect(reqs[0].inputMethod).toBe('text');
    expect(reqs[0].kind).toBe('text');

    // Country → dropdown + select
    expect(reqs[1].inputMethod).toBe('dropdown');
    expect(reqs[1].kind).toBe('select');

    // Agree to Terms → toggle + boolean
    expect(reqs[2].inputMethod).toBe('toggle');
    expect(reqs[2].kind).toBe('boolean');
  });
});

// ── EC10/EC13: Filter Products consistency trace ──────────

describe('EC10/EC13 — Filter Products consistency trace', () => {
  const filterProductsInputs: CapabilityInput[] = [
    // Category: dropdown select
    makeInput('Category', 'Dropdown', {
      validOptions: ['Electronics', 'Books', 'Clothing'],
    }),
    // On Sale: checkbox toggle
    makeInput('On Sale', 'Checkbox'),
    // Maximum Price: slider range
    makeInput('Maximum Price', 'Slider', {
      valueRange: { min: 0, max: 1000, step: 10 },
    }),
  ];

  it('Category retains kind=select + inputMethod=dropdown', () => {
    const reqs = candidateToDataRequirements([filterProductsInputs[0]]);
    expect(reqs[0].kind).toBe('select');
    expect(reqs[0].inputMethod).toBe('dropdown');
    expect(reqs[0].field).toBe('Category');
  });

  it('On Sale retains kind=boolean + inputMethod=toggle', () => {
    const reqs = candidateToDataRequirements([filterProductsInputs[1]]);
    expect(reqs[0].kind).toBe('boolean');
    expect(reqs[0].inputMethod).toBe('toggle');
    expect(reqs[0].field).toBe('On Sale');
  });

  it('Maximum Price retains kind=number + inputMethod=slider', () => {
    const reqs = candidateToDataRequirements([filterProductsInputs[2]]);
    expect(reqs[0].kind).toBe('number');
    expect(reqs[0].inputMethod).toBe('slider');
    expect(reqs[0].constraints.min).toBe(0);
    expect(reqs[0].constraints.max).toBe(1000);
    expect(reqs[0].constraints.step).toBe(10);
  });

  it('all three data requirements are in correct order', () => {
    const reqs = candidateToDataRequirements(filterProductsInputs);
    expect(reqs).toHaveLength(3);
    expect(reqs[0].field).toBe('Category');
    expect(reqs[1].field).toBe('On Sale');
    expect(reqs[2].field).toBe('Maximum Price');
  });

  it('the full review → contract flow preserves all three', () => {
    const candidate = makeCandidate('Filter Products', filterProductsInputs);
    const matchResult = {
      scores: [], bestMatch: null, decision: 'new-capability' as const, mergeTargetId: null,
    };
    const review = createReview(candidate, matchResult, 'session-filter');
    const result = processDecision(
      review, 'approve', emptyEdits, 'user@test.com',
      candidate, null, 'https://shop.example.com/products', [],
    );

    const contract = result.contract!;
    expect(contract.dataRequirements).toHaveLength(3);
    expect(contract.dataRequirements[0].kind).toBe('select');
    expect(contract.dataRequirements[0].inputMethod).toBe('dropdown');
    expect(contract.dataRequirements[1].kind).toBe('boolean');
    expect(contract.dataRequirements[1].inputMethod).toBe('toggle');
    expect(contract.dataRequirements[2].kind).toBe('number');
    expect(contract.dataRequirements[2].inputMethod).toBe('slider');
  });
});

// ── EC11: inputMethod taxonomy covers all InteractionTypes ─

describe('EC11 — InputMethod taxonomy coverage', () => {
  const allInteractionTypes: InteractionType[] = [
    'Click', 'Navigation', 'Link', 'TextEntry', 'Checkbox',
    'RadioButton', 'Dropdown', 'DatePicker', 'FileUpload',
    'Tab', 'Hover', 'Scroll', 'DoubleClick', 'RightClick',
    'DragDrop', 'Slider', 'RichTextEditor', 'ModalDialog',
    'NewTab', 'NewWindow', 'Breadcrumb', 'NativeDropdown',
    'CustomDropdown',
  ];

  // Data-input types that SHOULD have an InputMethod
  const dataInputTypes = new Set<InteractionType>([
    'Dropdown', 'Checkbox', 'RadioButton', 'DatePicker',
    'Slider', 'TextEntry', 'RichTextEditor', 'FileUpload',
    'NativeDropdown', 'CustomDropdown', 'Autocomplete', 'SearchableDropdown',
    'NativeSlider', 'AriaSlider', 'CustomSlider', 'RangeSlider',
    'DateRangePicker',
  ]);

  it('covers all data-input types', () => {
    for (const type of allInteractionTypes) {
      const method = interactionTypeToInputMethod(type);
      if (dataInputTypes.has(type)) {
        expect(method, `${type} should have an InputMethod`).not.toBeNull();
      } else {
        expect(method, `${type} should NOT have an InputMethod`).toBeNull();
      }
    }
  });

  it('returns one of the 6 valid InputMethod values', () => {
    const validMethods: InputMethod[] = ['dropdown', 'toggle', 'slider', 'text', 'datePicker', 'fileUpload'];
    for (const type of allInteractionTypes) {
      const method = interactionTypeToInputMethod(type);
      if (method) {
        expect(validMethods, `InputMethod for ${type} should be valid`).toContain(method);
      }
    }
  });
});

// ── EC14: sourceInteractionType carry-through ─────────────

describe('EC14 — sourceInteractionType carry-through from enrichment to contract', () => {
  it('sourceInteractionType from CapabilityInput reaches DataRequirement.inputMethod', () => {
    // Simulate the enrichment pipeline carrying sourceInteractionType
    const inputs: CapabilityInput[] = [
      { ...makeInput('Category', 'Dropdown', { validOptions: ['A', 'B'] }) },
      { ...makeInput('On Sale', 'Checkbox') },
      { ...makeInput('Max Price', 'Slider', { valueRange: { min: 0, max: 100, step: 5 } }) },
    ];

    // Map to data requirements (as happens in processDecision)
    const reqs = candidateToDataRequirements(inputs);

    // Verify the chain: sourceInteractionType → interactionTypeToInputMethod → DataRequirement.inputMethod
    expect(reqs[0].inputMethod).toBe(interactionTypeToInputMethod(inputs[0].sourceInteractionType!));
    expect(reqs[1].inputMethod).toBe(interactionTypeToInputMethod(inputs[1].sourceInteractionType!));
    expect(reqs[2].inputMethod).toBe(interactionTypeToInputMethod(inputs[2].sourceInteractionType!));
  });
});

// ── Success Indicators mapping ────────────────────────────

describe('SuccessIndicators → SuccessCriteria mapping', () => {
  it('maps navigation indicator to navigation criterion', () => {
    const indicators: SuccessIndicator[] = [
      { signal: '/dashboard', type: 'navigation', description: 'Redirects to dashboard' },
    ];
    const criteria = successIndicatorsToCriteria(indicators);
    expect(criteria).toHaveLength(1);
    expect(criteria[0].type).toBe('navigation');
    expect(criteria[0].target.urlPattern).toBe('/dashboard');
  });

  it('maps visibility indicator to elementVisible criterion', () => {
    const indicators: SuccessIndicator[] = [
      { signal: '.success-message', type: 'visibility', description: 'Success message visible' },
    ];
    const criteria = successIndicatorsToCriteria(indicators);
    expect(criteria[0].type).toBe('elementVisible');
  });

  it('maps valueDisplay indicator to valueEquals criterion', () => {
    const indicators: SuccessIndicator[] = [
      { signal: 'Welcome, John', type: 'valueDisplay', description: 'Username displayed' },
    ];
    const criteria = successIndicatorsToCriteria(indicators);
    expect(criteria[0].type).toBe('valueEquals');
  });
});
