/**
 * P2 Capability-Derived IR Generation — Gate Tests
 *
 * Tests the P2 design's 24 exit criteria and regression cases.
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md
 *
 * Coverage:
 *   EC1-EC2:  Plan structure (navigate, field steps, verify)
 *   EC3:      inputMethod → IRAction mapping
 *   EC4:      DataRequirement constraints validation
 *   EC5:      Full identity recovery from rawInteractions
 *   EC6-EC8:  Target resolution (MATCHED, AMBIGUOUS, UNMATCHED)
 *   EC9-EC14: Duplicate-name proofs (distinguished by various signals)
 *   EC15-EC16: Missing session / interaction safety
 *   EC17-EC18: Element Repo unchanged
 *   EC19-EC24: Success criteria, variant labels, etc.
 */

import { describe, it, expect } from 'vitest';
import { resolveTestData } from '../src/domain/generation/data-resolver';
import { resolveFieldBindings } from '../src/domain/generation/element-binding-resolver';
import {
  buildInteractionIndex,
  buildEventIdentityIndex,
  recoverFullIdentity,
  buildMatchableUiElement,
  resolveTargets,
  resolveTargetByLabel,
} from '../src/domain/generation/element-target-resolver';
import { inputMethodToIRAction } from '../src/domain/generation/ir-action-mapper';
import { resolveSuccessCriteria } from '../src/domain/generation/success-criterion-resolver';
import { generateCapabilityIR } from '../src/domain/generation/capability-ir-generator';
import type {
  P2GenerationInput,
  TestData,
} from '../src/domain/generation/p2-types';
import type { P2CapabilityContract } from '../src/domain/entities/p2-capability-contract';
import type { DataRequirement } from '../src/domain/entities/data-requirement';
import type { SuccessCriterion } from '../src/domain/entities/success-criterion';
import type { RecordingSession } from '../src/domain/entities/recording-session';
import type { Element, ElementIdentityRecord } from '../src/domain/entities/element';
import { createElement } from '../src/domain/entities/element';
import { createUiElement } from '../src/domain/entities/ui-element';
import { matchElements } from '../src/repository/services/element-matching-service';
import {
  IRAction,
  type IREnvironment,
  type ExecutionIRPlan,
  type ResolvedTarget,
} from '../src/domain/execution-ir/types';
import {
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
  LocatorStrategyType,
  ElementStatus,
} from '../src/domain/enums';
import type {
  ElementIdentity,
  DomContext,
  BrowserEventType,
} from '../src/shared/types';
import type {
  ComponentInteraction,
  ObservedEvent,
  InteractionType,
} from '../src/shared/component-types';
import type { UnitOfWorkFactory } from '../src/repository/v2/interfaces/unit-of-work';
import type { ApplicationKnowledgeFragment } from '../src/domain/entities/application-knowledge';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';

// ════════════════════════════════════════════════════════════════
// Test Factories
// ════════════════════════════════════════════════════════════════

const ENVIRONMENT: IREnvironment = {
  baseUrl: 'https://shop.example.com',
  browser: 'chrome',
  viewport: { width: 1280, height: 720 },
};

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Category',
    ariaRole: 'combobox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'SELECT',
    className: 'filter-select',
    name: 'category',
    stableId: 'cat-select',
    testId: 'category-filter',
    dataCy: null,
    dataQa: null,
    cssSelector: 'select#cat-select',
    xPath: '//select[@id="cat-select"]',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: ['form', 'main'],
    ancestorClasses: ['container', 'filter-panel'],
    ...overrides,
  };
}

function makeObservedEvent(
  identity: ElementIdentity,
  domContext: DomContext,
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-0-${identity.elementId}`,
    eventType: 'change' as BrowserEventType,
    timestamp: Date.now(),
    isTrusted: true,
    target: identity,
    domContext,
    valueBefore: null,
    valueAfter: 'Electronics',
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeComponentInteraction(
  identity: ElementIdentity,
  domContext: DomContext,
  overrides: Partial<ComponentInteraction> = {},
): ComponentInteraction {
  const event = makeObservedEvent(identity, domContext);
  return {
    interactionId: `int-${identity.elementId}`,
    type: 'Dropdown',
    trigger: identity,
    triggerEvent: event,
    memberEvents: [event],
    startTime: Date.now(),
    endTime: Date.now() + 100,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

function makeStoredElement(
  logicalName: string,
  identity: ElementIdentityRecord,
  pageOrComponent = '/products',
): Element {
  return createElement({
    projectId: 'proj-1',
    logicalName,
    pageOrComponent,
    locatorStrategies: [
      { type: LocatorStrategyType.ACCESSIBLE_NAME, value: identity.accessibleName ?? logicalName, priority: 1, confidence: 0.9 },
    ],
    identity,
  });
}

function makeIdentityRecord(overrides: Partial<ElementIdentityRecord> = {}): ElementIdentityRecord {
  return {
    accessibleName: 'Category',
    ariaRole: 'combobox',
    tag: 'SELECT',
    name: 'category',
    ariaLabel: null,
    ancestorRoles: ['form', 'main'],
    testId: 'category-filter',
    dataCy: null,
    dataQa: null,
    ...overrides,
  };
}

const DEFAULT_CONSTRAINTS = {
  minLength: null,
  maxLength: null,
  pattern: null,
  min: null,
  max: null,
  step: null,
  options: null,
  formatDescription: null,
};

function makeDataRequirement(
  field: string,
  overrides: Partial<DataRequirement> = {},
): DataRequirement {
  return {
    field,
    label: field.charAt(0).toUpperCase() + field.slice(1),
    kind: 'select',
    inputMethod: 'dropdown',
    required: true,
    defaultValue: null,
    constraints: { ...DEFAULT_CONSTRAINTS },
    source: 'inferred',
    ...overrides,
  };
}

function makeSuccessCriterion(
  id: string,
  overrides: Partial<SuccessCriterion> = {},
): SuccessCriterion {
  return {
    id,
    description: `Criterion ${id}`,
    type: 'navigation',
    target: { kind: 'url', urlPattern: '/products', elementLocator: null },
    expectedValue: null,
    timeout: 5000,
    source: 'inferred',
    ...overrides,
  };
}

function makeContract(
  overrides: Partial<P2CapabilityContract> = {},
): P2CapabilityContract {
  return {
    capabilityId: 'cap-1',
    versionNumber: 1,
    versionId: 'ver-1',
    name: 'Filter Products',
    purpose: 'Filter product listings by criteria',
    dataRequirements: [
      makeDataRequirement('category'),
    ],
    successCriteria: [
      makeSuccessCriterion('sc-1'),
    ],
    entryPoint: { url: '/products', elementName: null },
    sourceSessionId: 'sess-1',
    approvedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRecordingSession(
  overrides: Partial<RecordingSession> = {},
): RecordingSession {
  const identity = makeElementIdentity();
  const domContext = makeDomContext();
  const interaction = makeComponentInteraction(identity, domContext);

  const fragment: ApplicationKnowledgeFragment = {
    sessionId: 'sess-1',
    generatedAt: '2024-01-01T00:00:00Z',
    schemaVersion: 1,
    elements: [{
      elementId: 'elem-0001',
      tag: 'SELECT',
      role: 'combobox',
      accessibleName: 'Category',
      capabilities: [],
      componentId: 'comp-1',
      componentRole: 'field' as never,
      sourceUrl: '/products',
    }],
    transitions: [{
      transitionId: 'trans-1',
      elementId: 'elem-0001',
      componentId: 'comp-1',
      operation: 'change',
      timestamp: Date.now(),
      relevance: 'high',
    }],
    components: [{
      groupingId: 'comp-1',
      patternType: 'Dropdown',
      rootElementId: 'elem-0001',
      constituentCount: 1,
      businessField: 'category',
      lifecycleState: 'completed',
      optionCount: 5,
    }],
    interactionContracts: [],
    behavioralContracts: [],
    logicalActions: [{
      actionId: 'la-1',
      componentId: 'comp-1',
      businessField: 'category',
      transitionIds: ['trans-1'],
      lifecycleComplete: true,
      resultingChange: null,
      timestamp: Date.now(),
      sourceInteractionType: 'Dropdown',
    }],
    recordedWorkflow: {
      workflowId: 'wf-1',
      steps: [],
      boundaries: [],
      branchPoints: [],
    },
    applicationSurfaces: [{
      surfaceId: 'surf-1',
      url: '/products',
      title: 'Products',
      elementIds: ['elem-0001'],
    }],
  };

  const understanding: UnderstandingResult = {
    sessionId: 'sess-1',
    generatedAt: '2024-01-01T00:00:00Z',
    schemaVersion: 1,
    fragment,
    capability: null,
  };

  return {
    sessionId: 'sess-1',
    projectId: 'proj-1',
    createdAt: '2024-01-01T00:00:00Z',
    understandingResult: understanding,
    rawEvents: [],
    rawInteractions: [interaction],
    ...overrides,
  };
}

// Mock UnitOfWorkFactory for integration tests
function makeMockUowFactory(
  session: RecordingSession | undefined,
  elements: Element[],
): UnitOfWorkFactory {
  return {
    create() {
      return {
        async execute<T>(work: (repos: any) => Promise<T>): Promise<T> {
          return work({
            recordingSessions: {
              getById: async () => session,
            },
            elements: {
              getByProject: async () => elements,
            },
          });
        },
      };
    },
  };
}

// ════════════════════════════════════════════════════════════════
// TEST SUITES
// ════════════════════════════════════════════════════════════════

describe('P2 — Data Resolver', () => {
  it('EC4: resolves valid test data for all fields', () => {
    const reqs = [
      makeDataRequirement('category', { kind: 'select', inputMethod: 'dropdown' }),
      makeDataRequirement('search', { kind: 'text', inputMethod: 'text' }),
    ];
    const data: TestData = new Map([
      ['category', 'Electronics'],
      ['search', 'phone'],
    ]);
    const result = resolveTestData(reqs, data);
    expect(result.warnings).toHaveLength(0);
    expect(result.resolved.get('category')).toBe('Electronics');
    expect(result.resolved.get('search')).toBe('phone');
  });

  it('EC4: warns on missing required field', () => {
    const reqs = [makeDataRequirement('category', { required: true })];
    const data: TestData = new Map();
    const result = resolveTestData(reqs, data);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('missing-required');
  });

  it('EC4: warns on invalid enum value (options constraint)', () => {
    const reqs = [
      makeDataRequirement('category', {
        constraints: { ...DEFAULT_CONSTRAINTS, options: ['Electronics', 'Books'] },
      }),
    ];
    const data: TestData = new Map([['category', 'Invalid']]);
    const result = resolveTestData(reqs, data);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('invalid-value');
  });

  it('EC4: validates min/max for number kind', () => {
    const reqs = [
      makeDataRequirement('maxPrice', {
        kind: 'number',
        inputMethod: 'slider',
        constraints: { ...DEFAULT_CONSTRAINTS, min: 0, max: 1000 },
      }),
    ];
    const data: TestData = new Map([['maxPrice', 500]]);
    const result = resolveTestData(reqs, data);
    expect(result.warnings).toHaveLength(0);
    expect(result.resolved.get('maxPrice')).toBe(500);
  });

  it('EC4: rejects number below min', () => {
    const reqs = [
      makeDataRequirement('maxPrice', {
        kind: 'number',
        inputMethod: 'slider',
        constraints: { ...DEFAULT_CONSTRAINTS, min: 0, max: 1000 },
      }),
    ];
    const data: TestData = new Map([['maxPrice', -50]]);
    const result = resolveTestData(reqs, data);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('invalid-value');
  });

  it('EC4: validates pattern for text kind', () => {
    const reqs = [
      makeDataRequirement('email', {
        kind: 'email',
        inputMethod: 'text',
        constraints: { ...DEFAULT_CONSTRAINTS, pattern: '^[^@]+@[^@]+\\.[^@]+$' },
      }),
    ];
    const data: TestData = new Map([['email', 'not-an-email']]);
    const result = resolveTestData(reqs, data);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('invalid-value');
  });
});

describe('P2 — IR Action Mapper', () => {
  it('EC3: dropdown → SELECT', () => {
    expect(inputMethodToIRAction('dropdown')).toBe(IRAction.SELECT);
  });
  it('EC3: toggle → TOGGLE', () => {
    expect(inputMethodToIRAction('toggle')).toBe(IRAction.TOGGLE);
  });
  it('EC3: slider → FILL', () => {
    expect(inputMethodToIRAction('slider')).toBe(IRAction.FILL);
  });
  it('EC3: text → FILL', () => {
    expect(inputMethodToIRAction('text')).toBe(IRAction.FILL);
  });
  it('EC3: datePicker → SELECT_DATE', () => {
    expect(inputMethodToIRAction('datePicker')).toBe(IRAction.SELECT_DATE);
  });
  it('EC3: fileUpload → FILL', () => {
    expect(inputMethodToIRAction('fileUpload')).toBe(IRAction.FILL);
  });
  it('EC3: null → FILL (default)', () => {
    expect(inputMethodToIRAction(null)).toBe(IRAction.FILL);
  });
});

describe('P2 — Field Binding Resolver', () => {
  it('resolves field via businessField → component → rootElementId', () => {
    const session = makeRecordingSession();
    const reqs = [makeDataRequirement('category')];
    const result = resolveFieldBindings(reqs, session);
    expect(result.bindings.has('category')).toBe(true);
    expect(result.bindings.get('category')?.elementId).toBe('elem-0001');
  });

  it('warns when no logical action matches', () => {
    const session = makeRecordingSession();
    const reqs = [makeDataRequirement('nonexistent')];
    const result = resolveFieldBindings(reqs, session);
    expect(result.bindings.has('nonexistent')).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reason).toBe('no-logical-action');
  });

  it('warns when fragment is missing', () => {
    const session = makeRecordingSession({
      understandingResult: {
        sessionId: 'sess-1',
        generatedAt: '2024-01-01T00:00:00Z',
        schemaVersion: 1,
        fragment: undefined as any,
        capability: null,
      },
    });
    const reqs = [makeDataRequirement('category')];
    const result = resolveFieldBindings(reqs, session);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('P2 — Identity Recovery', () => {
  it('EC5: recovers full identity from rawInteractions', () => {
    const session = makeRecordingSession();
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const recovered = recoverFullIdentity('elem-0001', interactionIndex, eventIdentityIndex);
    expect(recovered).not.toBeNull();
    expect(recovered!.identity.elementId).toBe('elem-0001');
    expect(recovered!.identity.accessibleName).toBe('Category');
    expect(recovered!.identity.testId).toBe('category-filter');
    expect(recovered!.ancestorRoles).toEqual(['form', 'main']);
  });

  it('EC5: recovers identity from rawEvents fallback (no ancestorRoles)', () => {
    const identity = makeElementIdentity({ elementId: 'elem-0002' });
    // SessionEvent has elementIdentity field (not 'target' like ObservedEvent)
    const sessionEvent = {
      actionId: 'click-0001',
      type: 'click' as const,
      elementIdentity: identity,
      timestamp: '2024-01-01T00:00:00Z',
    };
    const session = makeRecordingSession({
      rawEvents: [sessionEvent as any],
      rawInteractions: [],
    });

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const recovered = recoverFullIdentity('elem-0002', interactionIndex, eventIdentityIndex);
    expect(recovered).not.toBeNull();
    expect(recovered!.identity.elementId).toBe('elem-0002');
    expect(recovered!.ancestorRoles).toBeNull(); // rawEvents don't carry domContext
  });

  it('EC5: returns null when identity cannot be recovered', () => {
    const session = makeRecordingSession();
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const recovered = recoverFullIdentity('elem-9999', interactionIndex, eventIdentityIndex);
    expect(recovered).toBeNull();
  });

  it('EC5: buildInteractionIndex builds correct map', () => {
    const session = makeRecordingSession();
    const index = buildInteractionIndex(session);
    expect(index.size).toBe(1);
    expect(index.has('elem-0001')).toBe(true);
  });
});

describe('P2 — Target Resolution (MATCHED / AMBIGUOUS / UNMATCHED)', () => {
  it('EC6: MATCHED — single element above threshold, sufficient margin', () => {
    const session = makeRecordingSession();
    const storedElements = [
      makeStoredElement('Category', makeIdentityRecord()),
    ];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['category', { elementId: 'elem-0001', summary: session.understandingResult.fragment.elements[0] }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);

    expect(result.targets.get('category')?.kind).toBe('element');
    expect(result.warnings.filter(w => w.field === 'category')).toHaveLength(0);
    expect(result.resolvedFields).toHaveLength(1);
    expect(result.resolvedFields[0].field).toBe('category');
    expect(result.resolvedFields[0].matchScore).toBeGreaterThanOrEqual(0.70);
  });

  it('EC7: AMBIGUOUS — two candidates with insufficient margin', () => {
    const session = makeRecordingSession();
    // Two stored elements with identical identity → both score equally
    const storedElements = [
      makeStoredElement('Category Primary', makeIdentityRecord()),
      makeStoredElement('Category Secondary', makeIdentityRecord()),
    ];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['category', { elementId: 'elem-0001', summary: session.understandingResult.fragment.elements[0] }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);

    expect(result.targets.get('category')?.kind).toBe('none');
    const ambiguousWarning = result.warnings.find(w => w.field === 'category' && w.reason === 'ambiguous');
    expect(ambiguousWarning).toBeDefined();
    expect(ambiguousWarning!.candidates).toBeDefined();
    expect(ambiguousWarning!.candidates!.length).toBeGreaterThanOrEqual(2);
  });

  it('EC8: UNMATCHED — no element above threshold', () => {
    const session = makeRecordingSession();
    const storedElements = [
      makeStoredElement('Search', makeIdentityRecord({
        accessibleName: 'Search',
        testId: 'search-box',
        name: 'q',
      })),
    ];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['category', { elementId: 'elem-0001', summary: session.understandingResult.fragment.elements[0] }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);

    expect(result.targets.get('category')?.kind).toBe('none');
    const unmatchedWarning = result.warnings.find(w => w.field === 'category' && w.reason === 'unmatched');
    expect(unmatchedWarning).toBeDefined();
  });

  it('EC5+EC6: unresolved when identity cannot be recovered', () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['category', { elementId: 'elem-9999', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('category')?.kind).toBe('none');
    expect(result.warnings.find(w => w.field === 'category')).toBeDefined();
  });
});

describe('P2 — Duplicate Name Resolution', () => {
  it('EC9: two Email controls distinguished by HTML name', () => {
    const sessionPrimary = makeRecordingSession({
      rawInteractions: [
        makeComponentInteraction(
          makeElementIdentity({
            elementId: 'elem-0001',
            accessibleName: 'Email',
            ariaRole: 'textbox',
            tag: 'INPUT',
            name: 'primary-email',
            testId: null,
          }),
          makeDomContext({ ancestorRoles: ['form', 'section', 'main'] }),
          { type: 'TextEntry' },
        ),
      ],
    });

    const storedElements = [
      makeStoredElement('Email Primary', makeIdentityRecord({
        accessibleName: 'Email',
        ariaRole: 'textbox',
        tag: 'INPUT',
        name: 'primary-email',
        testId: null,
        ancestorRoles: ['form', 'section', 'main'],
      })),
      makeStoredElement('Email Secondary', makeIdentityRecord({
        accessibleName: 'Email',
        ariaRole: 'textbox',
        tag: 'INPUT',
        name: 'secondary-email',
        testId: null,
        ancestorRoles: ['form', 'section', 'main'],
      })),
    ];

    const interactionIndex = buildInteractionIndex(sessionPrimary);
    const eventIdentityIndex = buildEventIdentityIndex(sessionPrimary);

    const bindings = new Map([
      ['email', { elementId: 'elem-0001', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('email')?.kind).toBe('element');
    expect(result.resolvedFields).toHaveLength(1);
  });

  it('EC10: duplicate names distinguished by testId', () => {
    const session = makeRecordingSession({
      rawInteractions: [
        makeComponentInteraction(
          makeElementIdentity({
            elementId: 'elem-0001',
            accessibleName: 'Delete',
            ariaRole: 'button',
            tag: 'BUTTON',
            name: null,
            testId: 'delete-item-1',
          }),
          makeDomContext({ ancestorRoles: ['list', 'section', 'main'] }),
          { type: 'Click' },
        ),
      ],
    });

    const storedElements = [
      makeStoredElement('Delete Item 1', makeIdentityRecord({
        accessibleName: 'Delete',
        ariaRole: 'button',
        tag: 'BUTTON',
        name: null,
        testId: 'delete-item-1',
        ancestorRoles: ['list', 'section', 'main'],
      })),
      makeStoredElement('Delete Item 2', makeIdentityRecord({
        accessibleName: 'Delete',
        ariaRole: 'button',
        tag: 'BUTTON',
        name: null,
        testId: 'delete-item-2',
        ancestorRoles: ['list', 'section', 'main'],
      })),
    ];

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['delete', { elementId: 'elem-0001', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('delete')?.kind).toBe('element');
  });

  it('EC11: duplicate names distinguished by ancestorRoles', () => {
    const session = makeRecordingSession({
      rawInteractions: [
        makeComponentInteraction(
          makeElementIdentity({
            elementId: 'elem-0001',
            accessibleName: 'Submit',
            ariaRole: 'button',
            tag: 'BUTTON',
            name: null,
            testId: null,
          }),
          makeDomContext({ ancestorRoles: ['billing-form', 'section', 'main'] }),
          { type: 'Click' },
        ),
      ],
    });

    const storedElements = [
      makeStoredElement('Submit (Billing)', makeIdentityRecord({
        accessibleName: 'Submit',
        ariaRole: 'button',
        tag: 'BUTTON',
        name: null,
        testId: null,
        ancestorRoles: ['billing-form', 'section', 'main'],
      })),
      makeStoredElement('Submit (Shipping)', makeIdentityRecord({
        accessibleName: 'Submit',
        ariaRole: 'button',
        tag: 'BUTTON',
        name: null,
        testId: null,
        ancestorRoles: ['shipping-form', 'section', 'main'],
      })),
    ];

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['submit', { elementId: 'elem-0001', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('submit')?.kind).toBe('element');
  });

  it('EC12: truly indistinguishable → AMBIGUOUS', () => {
    const session = makeRecordingSession({
      rawInteractions: [
        makeComponentInteraction(
          makeElementIdentity({
            elementId: 'elem-0001',
            accessibleName: 'Delete',
            ariaRole: 'button',
            tag: 'BUTTON',
            name: null,
            testId: null,
            dataCy: null,
            dataQa: null,
          }),
          makeDomContext({ ancestorRoles: ['list', 'main'] }),
          { type: 'Click' },
        ),
      ],
    });

    const identicalIdentity = makeIdentityRecord({
      accessibleName: 'Delete',
      ariaRole: 'button',
      tag: 'BUTTON',
      name: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      ancestorRoles: ['list', 'main'],
    });

    const storedElements = [
      makeStoredElement('Delete 1', identicalIdentity),
      makeStoredElement('Delete 2', identicalIdentity),
    ];

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['delete', { elementId: 'elem-0001', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('delete')?.kind).toBe('none');
    expect(result.warnings.find(w => w.reason === 'ambiguous')).toBeDefined();
  });

  it('EC13: changed name but strong remaining identity → MATCHED', () => {
    // A changed HTML name (15% weight) should not prevent matching when
    // testId, accessibleName, role, tag, and ancestors all match.
    const session = makeRecordingSession({
      rawInteractions: [
        makeComponentInteraction(
          makeElementIdentity({
            elementId: 'elem-0001',
            accessibleName: 'Category',
            ariaRole: 'combobox',
            tag: 'SELECT',
            name: 'category-v2', // Changed from stored
            testId: 'category-filter',
          }),
          makeDomContext({ ancestorRoles: ['form', 'main'] }),
          { type: 'Dropdown' },
        ),
      ],
    });

    const storedElements = [
      makeStoredElement('Category', makeIdentityRecord({
        accessibleName: 'Category',
        ariaRole: 'combobox',
        tag: 'SELECT',
        name: 'category-v1', // Original
        testId: 'category-filter',
        ancestorRoles: ['form', 'main'],
      }), '/products'),
    ];

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['category', { elementId: 'elem-0001', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('category')?.kind).toBe('element');
  });

  it('EC14: insufficient identity → UNMATCHED or AMBIGUOUS', () => {
    const session = makeRecordingSession({
      rawInteractions: [
        makeComponentInteraction(
          makeElementIdentity({
            elementId: 'elem-0001',
            accessibleName: '',
            ariaRole: null,
            tag: 'DIV',
            name: null,
            testId: null,
            dataCy: null,
            dataQa: null,
          }),
          makeDomContext({ ancestorRoles: [] }),
          { type: 'Click' },
        ),
      ],
    });

    // Stored element with some identity — enough to exceed threshold if
    // the fresh element had matching signals, but it doesn't
    const storedElements = [
      makeStoredElement('Some Element', makeIdentityRecord({
        accessibleName: 'Save',
        ariaRole: 'button',
        tag: 'BUTTON',
        name: null,
        testId: 'save-btn',
        ancestorRoles: ['toolbar', 'main'],
      })),
    ];

    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const bindings = new Map([
      ['element', { elementId: 'elem-0001', summary: null }],
    ]);

    const result = resolveTargets(bindings, interactionIndex, eventIdentityIndex, storedElements);
    expect(result.targets.get('element')?.kind).toBe('none');
    expect(result.warnings.find(w => w.reason === 'unmatched' || w.reason === 'ambiguous')).toBeDefined();
  });
});

describe('P2 — Missing Session / Interaction Safety', () => {
  it('EC15: missing session → safe unresolved, no throw', async () => {
    const contract = makeContract({ sourceSessionId: 'nonexistent' });
    const uowFactory = makeMockUowFactory(undefined, []);

    const input: P2GenerationInput = {
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    };

    const result = await generateCapabilityIR(input, uowFactory);
    expect(result.hasUnresolvedTargets).toBe(true);
    expect(result.warnings.find(w => w.reason === 'session-not-found')).toBeDefined();
    // Still produces a plan — safe degradation
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('EC15: null sourceSessionId → safe unresolved', async () => {
    const contract = makeContract({ sourceSessionId: '' });
    const uowFactory = makeMockUowFactory(undefined, []);

    const input: P2GenerationInput = {
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    };

    const result = await generateCapabilityIR(input, uowFactory);
    expect(result.hasUnresolvedTargets).toBe(true);
    expect(result.warnings.find(w => w.reason === 'missing-source-session')).toBeDefined();
  });

  it('EC16: missing originating interaction → safe unresolved', async () => {
    const session = makeRecordingSession({
      rawInteractions: [], // Empty — no interaction for elem-0001
    });
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];

    const contract = makeContract();
    const uowFactory = makeMockUowFactory(session, storedElements);

    const input: P2GenerationInput = {
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    };

    const result = await generateCapabilityIR(input, uowFactory);
    expect(result.hasUnresolvedTargets).toBe(true);
  });
});

describe('P2 — Element Repo Unchanged (INV-P2-1)', () => {
  it('EC17: generateCapabilityIR does not mutate storedElements', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const snapshot = JSON.parse(JSON.stringify(storedElements));

    const contract = makeContract();
    const uowFactory = makeMockUowFactory(session, storedElements);

    const input: P2GenerationInput = {
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    };

    await generateCapabilityIR(input, uowFactory);
    expect(JSON.parse(JSON.stringify(storedElements))).toEqual(snapshot);
  });

  it('EC18: generateCapabilityIR never calls createElement/healElement', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];

    let createCalled = false;
    let healCalled = false;

    const uowFactory: UnitOfWorkFactory = {
      create() {
        return {
          async execute<T>(work: (repos: any) => Promise<T>): Promise<T> {
            return work({
              recordingSessions: {
                getById: async () => session,
              },
              elements: {
                getByProject: async () => storedElements,
                create: async () => { createCalled = true; throw new Error('should not be called'); },
                heal: async () => { healCalled = true; throw new Error('should not be called'); },
              },
            });
          },
        };
      },
    };

    const input: P2GenerationInput = {
      contract: makeContract(),
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    };

    await generateCapabilityIR(input, uowFactory);
    expect(createCalled).toBe(false);
    expect(healCalled).toBe(false);
  });
});

describe('P2 — Plan Structure & End-to-End Generation', () => {
  it('EC1-EC2: produces NAVIGATE → field steps → VERIFY plan', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];

    const contract = makeContract();
    const uowFactory = makeMockUowFactory(session, storedElements);

    const input: P2GenerationInput = {
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    };

    const result = await generateCapabilityIR(input, uowFactory);

    expect(result.plan.steps[0].action).toBe(IRAction.NAVIGATE);
    expect(result.plan.steps[0].target.kind).toBe('url');

    const fieldStep = result.plan.steps.find(s => s.action === IRAction.SELECT);
    expect(fieldStep).toBeDefined();
    expect(fieldStep!.target.kind).toBe('element');
    expect(fieldStep!.input).toBe('Books');

    const verifyStep = result.plan.steps.find(s => s.action === IRAction.VERIFY);
    expect(verifyStep).toBeDefined();
  });

  it('EC2: multiple data requirements produce multiple field steps', async () => {
    const identity1 = makeElementIdentity({ elementId: 'elem-0001' });
    const identity2 = makeElementIdentity({
      elementId: 'elem-0002',
      accessibleName: 'On Sale',
      name: 'on-sale',
      testId: 'on-sale-toggle',
      ariaRole: 'checkbox',
      tag: 'INPUT',
    });

    const interactions = [
      makeComponentInteraction(identity1, makeDomContext({ ancestorRoles: ['form', 'main'] }),
        { type: 'Dropdown' }),
      makeComponentInteraction(identity2, makeDomContext({ ancestorRoles: ['form', 'main'] }),
        { type: 'Checkbox' }),
    ];

    const session = makeRecordingSession({
      rawInteractions: interactions,
      understandingResult: {
        sessionId: 'sess-1',
        generatedAt: '2024-01-01T00:00:00Z',
        schemaVersion: 1,
        fragment: {
          sessionId: 'sess-1',
          generatedAt: '2024-01-01T00:00:00Z',
          schemaVersion: 1,
          elements: [
            { elementId: 'elem-0001', tag: 'SELECT', role: 'combobox', accessibleName: 'Category', capabilities: [], componentId: 'comp-1', componentRole: 'field' as never, sourceUrl: '/products' },
            { elementId: 'elem-0002', tag: 'INPUT', role: 'checkbox', accessibleName: 'On Sale', capabilities: [], componentId: 'comp-2', componentRole: 'field' as never, sourceUrl: '/products' },
          ],
          transitions: [],
          components: [
            { groupingId: 'comp-1', patternType: 'Dropdown', rootElementId: 'elem-0001', constituentCount: 1, businessField: 'category', lifecycleState: 'completed', optionCount: 5 },
            { groupingId: 'comp-2', patternType: 'Checkbox', rootElementId: 'elem-0002', constituentCount: 1, businessField: 'onSale', lifecycleState: 'completed', optionCount: null },
          ],
          interactionContracts: [],
          behavioralContracts: [],
          logicalActions: [
            { actionId: 'la-1', componentId: 'comp-1', businessField: 'category', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: Date.now(), sourceInteractionType: 'Dropdown' },
            { actionId: 'la-2', componentId: 'comp-2', businessField: 'onSale', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: Date.now() + 1, sourceInteractionType: 'Checkbox' },
          ],
          recordedWorkflow: { workflowId: 'wf-1', steps: [], boundaries: [], branchPoints: [] },
          applicationSurfaces: [{ surfaceId: 'surf-1', url: '/products', title: 'Products', elementIds: ['elem-0001', 'elem-0002'] }],
        },
        capability: null,
      },
    });

    const storedElements = [
      makeStoredElement('Category', makeIdentityRecord({
        accessibleName: 'Category', ariaRole: 'combobox', tag: 'SELECT', name: 'category', testId: 'category-filter', ancestorRoles: ['form', 'main'],
      })),
      makeStoredElement('On Sale', makeIdentityRecord({
        accessibleName: 'On Sale', ariaRole: 'checkbox', tag: 'INPUT', name: 'on-sale', testId: 'on-sale-toggle', ancestorRoles: ['form', 'main'],
      })),
    ];

    const contract = makeContract({
      dataRequirements: [
        makeDataRequirement('category', { inputMethod: 'dropdown' }),
        makeDataRequirement('onSale', { kind: 'boolean', inputMethod: 'toggle', label: 'On Sale' }),
      ],
    });

    const uowFactory = makeMockUowFactory(session, storedElements);

    const result = await generateCapabilityIR({
      contract,
      testData: new Map([['category', 'Books'], ['onSale', true]]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    }, uowFactory);

    const fieldSteps = result.plan.steps.filter(s =>
      s.action === IRAction.SELECT || s.action === IRAction.TOGGLE,
    );
    expect(fieldSteps).toHaveLength(2);

    const selectStep = fieldSteps.find(s => s.action === IRAction.SELECT);
    const toggleStep = fieldSteps.find(s => s.action === IRAction.TOGGLE);
    expect(selectStep).toBeDefined();
    expect(toggleStep).toBeDefined();
    expect(selectStep!.target.kind).toBe('element');
    expect(toggleStep!.target.kind).toBe('element');
    expect(toggleStep!.input).toBe(true);
  });

  it('EC19: success criteria produce assertions on verify step', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];

    const contract = makeContract({
      successCriteria: [
        makeSuccessCriterion('sc-1', {
          type: 'navigation',
          target: { kind: 'url', urlPattern: '/products?*', elementLocator: null },
        }),
      ],
    });

    const uowFactory = makeMockUowFactory(session, storedElements);

    const result = await generateCapabilityIR({
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    }, uowFactory);

    const verifyStep = result.plan.steps.find(s => s.action === IRAction.VERIFY);
    expect(verifyStep).toBeDefined();
    expect(verifyStep!.assertions.length).toBeGreaterThan(0);
  });

  it('EC20: variant label included in plan title', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const uowFactory = makeMockUowFactory(session, storedElements);

    const result = await generateCapabilityIR({
      contract: makeContract(),
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
      variantLabel: 'boundary-min',
    }, uowFactory);

    expect(result.plan.title).toContain('boundary-min');
  });

  it('EC21: different data sets produce different plans without re-recording', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const uowFactory = makeMockUowFactory(session, storedElements);

    const result1 = await generateCapabilityIR({
      contract: makeContract(),
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
      variantLabel: 'books',
    }, uowFactory);

    const result2 = await generateCapabilityIR({
      contract: makeContract(),
      testData: new Map([['category', 'Electronics']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
      variantLabel: 'electronics',
    }, uowFactory);

    // Same element targets, different test data
    const step1 = result1.plan.steps.find(s => s.action === IRAction.SELECT);
    const step2 = result2.plan.steps.find(s => s.action === IRAction.SELECT);
    expect(step1!.input).toBe('Books');
    expect(step2!.input).toBe('Electronics');
    // Same resolved element (same locators)
    expect(step1!.target.kind).toBe('element');
    expect(step2!.target.kind).toBe('element');
  });

  it('EC22: tags include capability-derived and p2', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const uowFactory = makeMockUowFactory(session, storedElements);

    const result = await generateCapabilityIR({
      contract: makeContract(),
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    }, uowFactory);

    expect(result.plan.tags).toContain('capability-derived');
    expect(result.plan.tags).toContain('p2');
  });

  it('EC23: plan has correct testCaseId and versionId from contract', async () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const uowFactory = makeMockUowFactory(session, storedElements);

    const contract = makeContract({
      capabilityId: 'cap-42',
      versionId: 'ver-7',
      versionNumber: 7,
    });

    const result = await generateCapabilityIR({
      contract,
      testData: new Map([['category', 'Books']]),
      projectId: 'proj-1',
      environment: ENVIRONMENT,
    }, uowFactory);

    expect(result.plan.testCaseId).toBe('p2-cap-42');
    expect(result.plan.testCaseVersionNumber).toBe(7);
  });
});

describe('P2 — Success Criterion Resolver', () => {
  it('produces URL_MATCH assertion for navigation criterion', () => {
    const session = makeRecordingSession();
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);
    const storedElements: Element[] = [];

    const result = resolveSuccessCriteria(
      [makeSuccessCriterion('sc-1', { type: 'navigation', target: { kind: 'url', urlPattern: '/success', elementLocator: null } })],
      session,
      storedElements,
      interactionIndex,
      eventIdentityIndex,
      ENVIRONMENT,
    );

    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].type).toBe(ValidationType.URL_MATCH);
    expect(result.assertions[0].comparison).toBe(ValidationComparison.MATCHES);
    expect(result.assertions[0].severity).toBe(ValidationSeverity.HARD);
  });

  it('produces TEXT_MATCH assertion for textPresent criterion', () => {
    const session = makeRecordingSession();
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);
    const storedElements: Element[] = [];

    const result = resolveSuccessCriteria(
      [makeSuccessCriterion('sc-1', { type: 'textPresent', target: { kind: 'page', urlPattern: null, elementLocator: null }, expectedValue: 'Success' })],
      session,
      storedElements,
      interactionIndex,
      eventIdentityIndex,
      ENVIRONMENT,
    );

    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].type).toBe(ValidationType.TEXT_MATCH);
    expect(result.assertions[0].comparison).toBe(ValidationComparison.CONTAINS);
  });

  it('produces VISIBILITY assertion for elementVisible criterion with resolved target', () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const result = resolveSuccessCriteria(
      [makeSuccessCriterion('sc-1', {
        type: 'elementVisible',
        target: { kind: 'element', urlPattern: null, elementLocator: 'Category' },
      })],
      session,
      storedElements,
      interactionIndex,
      eventIdentityIndex,
      ENVIRONMENT,
    );

    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].type).toBe(ValidationType.VISIBILITY);
    expect(result.assertions[0].target.kind).toBe('element');
  });

  it('produces ATTRIBUTE_MATCH assertion for valueEquals criterion', () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const result = resolveSuccessCriteria(
      [makeSuccessCriterion('sc-1', {
        type: 'valueEquals',
        target: { kind: 'element', urlPattern: null, elementLocator: 'Category' },
        expectedValue: 'Books',
      })],
      session,
      storedElements,
      interactionIndex,
      eventIdentityIndex,
      ENVIRONMENT,
    );

    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].type).toBe(ValidationType.ATTRIBUTE_MATCH);
    expect(result.assertions[0].expectedValue).toBe('Books');
  });
});

describe('P2 — resolveTargetByLabel (for success criteria)', () => {
  it('resolves target by accessible name through full identity pipeline', () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const result = resolveTargetByLabel(
      'Category',
      null,
      interactionIndex,
      eventIdentityIndex,
      storedElements,
    );

    expect(result.target.kind).toBe('element');
    expect(result.warning).toBeNull();
    expect(result.matchScore).not.toBeNull();
  });

  it('returns warning for non-existent label', () => {
    const session = makeRecordingSession();
    const storedElements = [makeStoredElement('Category', makeIdentityRecord())];
    const interactionIndex = buildInteractionIndex(session);
    const eventIdentityIndex = buildEventIdentityIndex(session);

    const result = resolveTargetByLabel(
      'NonExistent',
      null,
      interactionIndex,
      eventIdentityIndex,
      storedElements,
    );

    expect(result.target.kind).toBe('none');
    expect(result.warning).not.toBeNull();
  });
});
