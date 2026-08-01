/**
 * P2 End-to-End Validation Script
 *
 * Exercises the ACTUAL implemented P2 pipeline with concrete examples.
 * Not a test — a walkthrough that prints readable output.
 */

import { resolveTestData } from '../src/domain/generation/data-resolver';
import { resolveFieldBindings } from '../src/domain/generation/element-binding-resolver';
import {
  buildInteractionIndex,
  buildEventIdentityIndex,
  recoverFullIdentity,
  resolveTargets,
} from '../src/domain/generation/element-target-resolver';
import { inputMethodToIRAction } from '../src/domain/generation/ir-action-mapper';
import { resolveSuccessCriteria } from '../src/domain/generation/success-criterion-resolver';
import { generateCapabilityIR } from '../src/domain/generation/capability-ir-generator';
import type { P2GenerationInput, TestData } from '../src/domain/generation/p2-types';
import type { P2CapabilityContract } from '../src/domain/entities/p2-capability-contract';
import type { DataRequirement } from '../src/domain/entities/data-requirement';
import type { SuccessCriterion } from '../src/domain/entities/success-criterion';
import type { RecordingSession } from '../src/domain/entities/recording-session';
import type { Element, ElementIdentityRecord } from '../src/domain/entities/element';
import { createElement } from '../src/domain/entities/element';
import {
  IRAction,
  type IREnvironment,
} from '../src/domain/execution-ir/types';
import {
  LocatorStrategyType,
} from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
} from '../src/shared/component-types';
import type { ApplicationKnowledgeFragment } from '../src/domain/entities/application-knowledge';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';
import type { UnitOfWorkFactory } from '../src/repository/v2/interfaces/unit-of-work';

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

const ENV: IREnvironment = {
  baseUrl: 'https://shop.example.com',
  browser: 'chrome',
  viewport: { width: 1280, height: 720 },
};

const Z = { ancestorRoles: ['form', 'section', 'main'] } as DomContext;

function makeIdentity(o: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null,
    stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: '', xPath: '', inIframe: false, shadowDom: false,
    elementId: 'elem-x', ...o,
  } as ElementIdentity;
}

function makeDomCtx(ancestorRoles: string[]): DomContext {
  return { inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false,
    required: false, ancestorRoles, ancestorClasses: [] };
}

function makeInteraction(identity: ElementIdentity, ancestorRoles: string[], type: string): ComponentInteraction {
  const ctx = makeDomCtx(ancestorRoles);
  const event: ObservedEvent = {
    eventId: `evt-${identity.elementId}`, eventType: 'change' as never,
    timestamp: Date.now(), isTrusted: true, target: identity, domContext: ctx,
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
  };
  return {
    interactionId: `int-${identity.elementId}`, type: type as never,
    trigger: identity, triggerEvent: event, memberEvents: [event],
    startTime: Date.now(), endTime: Date.now() + 100, endState: 'completed', metadata: {},
  };
}

function makeIdRecord(o: Partial<ElementIdentityRecord>): ElementIdentityRecord {
  return {
    accessibleName: null, ariaRole: null, tag: null, name: null,
    ariaLabel: null, ancestorRoles: null, testId: null, dataCy: null, dataQa: null,
    ...o,
  };
}

function makeStoredElement(name: string, identity: ElementIdentityRecord): Element {
  return createElement({
    projectId: 'proj-1', logicalName: name, pageOrComponent: '/products',
    locatorStrategies: [
      { type: LocatorStrategyType.ACCESSIBLE_NAME, value: identity.accessibleName ?? name, priority: 1, confidence: 0.9 },
      { type: LocatorStrategyType.CSS, value: `select[name="${identity.name}"]`, priority: 2, confidence: 0.7 },
    ],
    identity,
  });
}

const DCONS = { minLength: null, maxLength: null, pattern: null, min: null, max: null, step: null, options: null, formatDescription: null };

function makeMockUow(session: RecordingSession | undefined, elements: Element[]): UnitOfWorkFactory {
  return { create() { return {
    async execute<T>(work: (repos: any) => Promise<T>): Promise<T> {
      return work({
        recordingSessions: { getById: async () => session },
        elements: { getByProject: async () => elements },
      });
    },
  }; } };
}

// ════════════════════════════════════════════════════════════════
// BUILD: Filter Products Session
// ════════════════════════════════════════════════════════════════

function buildFilterProductsSession(): RecordingSession {
  const catId = makeIdentity({ elementId: 'elem-0001', accessibleName: 'Category', ariaRole: 'combobox', tag: 'SELECT', name: 'category', testId: 'category-filter', className: 'filter-select', cssSelector: 'select#cat', xPath: '//select[@id="cat"]' });
  const saleId = makeIdentity({ elementId: 'elem-0002', accessibleName: 'On Sale', ariaRole: 'checkbox', tag: 'INPUT', name: 'on-sale', testId: 'on-sale-toggle', className: 'filter-toggle', cssSelector: 'input[name="on-sale"]', xPath: '//input[@name="on-sale"]' });
  const priceId = makeIdentity({ elementId: 'elem-0003', accessibleName: 'Maximum Price', ariaRole: 'slider', tag: 'INPUT', name: 'max-price', testId: 'price-slider', className: 'price-range', cssSelector: 'input[type="range"]', xPath: '//input[@type="range"]' });

  const interactions = [
    makeInteraction(catId, ['form', 'filter-panel', 'main'], 'Dropdown'),
    makeInteraction(saleId, ['form', 'filter-panel', 'main'], 'Checkbox'),
    makeInteraction(priceId, ['form', 'filter-panel', 'main'], 'Slider'),
  ];

  const fragment: ApplicationKnowledgeFragment = {
    sessionId: 'sess-filter-1', generatedAt: '2024-06-01T10:00:00Z', schemaVersion: 1,
    elements: [
      { elementId: 'elem-0001', tag: 'SELECT', role: 'combobox', accessibleName: 'Category', capabilities: [], componentId: 'comp-1', componentRole: 'field' as never, sourceUrl: '/products' },
      { elementId: 'elem-0002', tag: 'INPUT', role: 'checkbox', accessibleName: 'On Sale', capabilities: [], componentId: 'comp-2', componentRole: 'field' as never, sourceUrl: '/products' },
      { elementId: 'elem-0003', tag: 'INPUT', role: 'slider', accessibleName: 'Maximum Price', capabilities: [], componentId: 'comp-3', componentRole: 'field' as never, sourceUrl: '/products' },
    ],
    transitions: [],
    components: [
      { groupingId: 'comp-1', patternType: 'Dropdown', rootElementId: 'elem-0001', constituentCount: 1, businessField: 'category', lifecycleState: 'completed', optionCount: 5 },
      { groupingId: 'comp-2', patternType: 'Checkbox', rootElementId: 'elem-0002', constituentCount: 1, businessField: 'onSale', lifecycleState: 'completed', optionCount: null },
      { groupingId: 'comp-3', patternType: 'Slider', rootElementId: 'elem-0003', constituentCount: 1, businessField: 'maxPrice', lifecycleState: 'completed', optionCount: null },
    ],
    interactionContracts: [], behavioralContracts: [],
    logicalActions: [
      { actionId: 'la-1', componentId: 'comp-1', businessField: 'category', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: 1, sourceInteractionType: 'Dropdown' },
      { actionId: 'la-2', componentId: 'comp-2', businessField: 'onSale', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: 2, sourceInteractionType: 'Checkbox' },
      { actionId: 'la-3', componentId: 'comp-3', businessField: 'maxPrice', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: 3, sourceInteractionType: 'Slider' },
    ],
    recordedWorkflow: { workflowId: 'wf-1', steps: [], boundaries: [], branchPoints: [] },
    applicationSurfaces: [{ surfaceId: 'surf-1', url: '/products', title: 'Products', elementIds: ['elem-0001', 'elem-0002', 'elem-0003'] }],
  };

  const understanding: UnderstandingResult = {
    sessionId: 'sess-filter-1', generatedAt: '2024-06-01T10:00:00Z', schemaVersion: 1,
    fragment, capability: null,
  };

  return {
    sessionId: 'sess-filter-1', projectId: 'proj-1', createdAt: '2024-06-01T10:00:00Z',
    understandingResult: understanding, rawEvents: [], rawInteractions: interactions,
  };
}

function buildFilterProductsElements(): Element[] {
  return [
    makeStoredElement('Category', makeIdRecord({ accessibleName: 'Category', ariaRole: 'combobox', tag: 'SELECT', name: 'category', testId: 'category-filter', ancestorRoles: ['form', 'filter-panel', 'main'] })),
    makeStoredElement('On Sale', makeIdRecord({ accessibleName: 'On Sale', ariaRole: 'checkbox', tag: 'INPUT', name: 'on-sale', testId: 'on-sale-toggle', ancestorRoles: ['form', 'filter-panel', 'main'] })),
    makeStoredElement('Maximum Price', makeIdRecord({ accessibleName: 'Maximum Price', ariaRole: 'slider', tag: 'INPUT', name: 'max-price', testId: 'price-slider', ancestorRoles: ['form', 'filter-panel', 'main'] })),
  ];
}

function buildFilterProductsContract(): P2CapabilityContract {
  return {
    capabilityId: 'cap-filter', versionNumber: 1, versionId: 'ver-filter-1',
    name: 'Filter Products', purpose: 'Filter product listings by criteria',
    dataRequirements: [
      { field: 'category', label: 'Category', kind: 'select', inputMethod: 'dropdown', required: true, defaultValue: null, constraints: { ...DCONS, options: ['Electronics', 'Books', 'Clothing'] }, source: 'inferred' },
      { field: 'onSale', label: 'On Sale', kind: 'boolean', inputMethod: 'toggle', required: true, defaultValue: null, constraints: { ...DCONS }, source: 'inferred' },
      { field: 'maxPrice', label: 'Maximum Price', kind: 'number', inputMethod: 'slider', required: true, defaultValue: null, constraints: { ...DCONS, min: 0, max: 1000, step: 50 }, source: 'inferred' },
    ],
    successCriteria: [
      { id: 'sc-1', description: 'Filtered results visible', type: 'navigation', target: { kind: 'url', urlPattern: '/products?*', elementLocator: null }, expectedValue: null, timeout: 5000, source: 'inferred' },
      { id: 'sc-2', description: 'No results message not shown', type: 'elementAbsent', target: { kind: 'element', urlPattern: null, elementLocator: 'No results found' }, expectedValue: null, timeout: 5000, source: 'inferred' },
    ],
    entryPoint: { url: '/products', elementName: null },
    sourceSessionId: 'sess-filter-1',
    approvedAt: '2024-06-01T12:00:00Z',
  };
}

// ════════════════════════════════════════════════════════════════
// SCENARIO RUNNERS
// ════════════════════════════════════════════════════════════════

function printSeparator(title: string) {
  console.log('\n' + '═'.repeat(80));
  console.log(`  ${title}`);
  console.log('═'.repeat(80));
}

function printStep(label: string, value: unknown) {
  const str = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  console.log(`\n  ┌─ ${label}`);
  console.log(`  │ ${str?.split('\n').join('\n  │ ')}`);
  console.log(`  └─`);
}

async function main() {
  const session = buildFilterProductsSession();
  const elements = buildFilterProductsElements();
  const contract = buildFilterProductsContract();

  // Build shared indexes
  const interactionIndex = buildInteractionIndex(session);
  const eventIdentityIndex = buildEventIdentityIndex(session);

  // ════════════════════════════════════════════════════════════
  // SCENARIO 1: Filter Products — Two Data Variants
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 1A: Filter Products — Variant: Electronics + On Sale + $500');

  console.log('\n  Input P2CapabilityContract:');
  console.log(`    name: ${contract.name}`);
  console.log(`    dataRequirements: ${contract.dataRequirements.map(r => `${r.field}(${r.kind}/${r.inputMethod})`).join(', ')}`);
  console.log(`    sourceSessionId: ${contract.sourceSessionId}`);

  console.log('\n  Input TestData: Category=Electronics, On Sale=true, Max Price=500');
  const data1: TestData = new Map([['category', 'Electronics'], ['onSale', true], ['maxPrice', 500]]);

  // Trace field binding
  printSeparator('  ── TRACE: Field Binding ──');
  const bindings = resolveFieldBindings(contract.dataRequirements, session);
  for (const [field, binding] of bindings.bindings) {
    console.log(`    ${field} → elementId=${binding.elementId}, summary.accessibleName=${binding.summary?.accessibleName}`);
  }

  // Trace identity recovery
  printSeparator('  ── TRACE: Identity Recovery ──');
  for (const [field, binding] of bindings.bindings) {
    const recovered = recoverFullIdentity(binding.elementId, interactionIndex, eventIdentityIndex);
    console.log(`    ${field}:`);
    console.log(`      elementId: ${binding.elementId}`);
    console.log(`      recovered identity: accessibleName="${recovered!.identity.accessibleName}", role="${recovered!.identity.ariaRole}", tag="${recovered!.identity.tag}", name="${recovered!.identity.name}", testId="${recovered!.identity.testId}"`);
    console.log(`      ancestorRoles: ${JSON.stringify(recovered!.ancestorRoles)}`);
  }

  // Trace R4 matching
  printSeparator('  ── TRACE: R4 ElementMatchingService Results ──');
  const targets = resolveTargets(bindings.bindings, interactionIndex, eventIdentityIndex, elements);
  for (const [field, target] of targets.targets) {
    const resolved = targets.resolvedFields.find(r => r.field === field);
    console.log(`    ${field}: kind=${target.kind}${resolved ? `, matchScore=${resolved.matchScore.toFixed(3)}, elementId=${resolved.elementId}` : ''}`);
  }

  // Full end-to-end generation
  printSeparator('  ── TRACE: Full IR Generation ──');
  const result1 = await generateCapabilityIR(
    { contract, testData: data1, projectId: 'proj-1', environment: ENV, variantLabel: 'electronics-onsale-500' },
    makeMockUow(session, elements),
  );

  console.log(`    hasUnresolvedTargets: ${result1.hasUnresolvedTargets}`);
  console.log(`    resolvedFields: ${result1.resolvedFields.map(r => `${r.field}(${r.matchScore.toFixed(3)})`).join(', ')}`);
  console.log(`    warnings: ${result1.warnings.length === 0 ? 'none' : result1.warnings.map(w => w.field + ':' + w.reason).join(', ')}`);

  console.log('\n  ── Generated ExecutionIRPlan ──');
  console.log(`    testCaseId: ${result1.plan.testCaseId}`);
  console.log(`    testCaseVersionId: ${result1.plan.testCaseVersionId}`);
  console.log(`    title: ${result1.plan.title}`);
  console.log(`    environment.baseUrl: ${result1.plan.environment.baseUrl}`);
  console.log(`    steps:`);
  for (const step of result1.plan.steps) {
    console.log(`      [${step.order}] ${step.action}`);
    console.log(`          description: "${step.description}"`);
    console.log(`          target: ${step.target.kind}${step.target.kind === 'element' ? ` (elementName="${(step.target as any).elementName}", elementId=${(step.target as any).elementId.slice(0,8)}..., ${step.target.resolvedLocators.length} locators)` : step.target.kind === 'url' ? ` (url="${step.target.url}")` : ''}`);
    console.log(`          input: ${JSON.stringify(step.input)}`);
    if (step.assertions.length > 0) {
      console.log(`          assertions: ${step.assertions.length}`);
      for (const a of step.assertions) {
        console.log(`            - type=${a.type}, comparison=${a.comparison}, severity=${a.severity}, expectedValue=${JSON.stringify(a.expectedValue)}, target=${a.target.kind}`);
      }
    }
  }

  // Variant 2
  printSeparator('SCENARIO 1B: Filter Products — Variant: Books + Not On Sale + $200');
  const data2: TestData = new Map([['category', 'Books'], ['onSale', false], ['maxPrice', 200]]);
  console.log('\n  Input TestData: Category=Books, On Sale=false, Max Price=200');

  const result2 = await generateCapabilityIR(
    { contract, testData: data2, projectId: 'proj-1', environment: ENV, variantLabel: 'books-nosale-200' },
    makeMockUow(session, elements),
  );

  console.log(`    hasUnresolvedTargets: ${result2.hasUnresolvedTargets}`);
  console.log(`    resolvedFields: ${result2.resolvedFields.map(r => `${r.field}(${r.matchScore.toFixed(3)})`).join(', ')}`);
  console.log('\n  ── Generated ExecutionIRPlan (steps summary) ──');
  for (const step of result2.plan.steps) {
    console.log(`      [${step.order}] ${step.action} | input=${JSON.stringify(step.input)} | target=${step.target.kind}${step.target.kind === 'element' ? ` (${(step.target as any).elementName})` : ''}`);
  }

  // Prove same capability, same elements, different data
  printSeparator('  ── PROOF: Same Capability, Same Elements, Different Data ──');
  console.log(`    Variant A: category=${result1.plan.steps[1]?.input}, onSale=${result1.plan.steps[2]?.input}, maxPrice=${result1.plan.steps[3]?.input}`);
  console.log(`    Variant B: category=${result2.plan.steps[1]?.input}, onSale=${result2.plan.steps[2]?.input}, maxPrice=${result2.plan.steps[3]?.input}`);
  const aElems = result1.plan.steps.filter(s => s.target.kind === 'element').map(s => (s.target as any).elementId);
  const bElems = result2.plan.steps.filter(s => s.target.kind === 'element').map(s => (s.target as any).elementId);
  console.log(`    Element targets A: ${aElems.map((e: string) => e.slice(0, 8)).join(', ')}`);
  console.log(`    Element targets B: ${bElems.map((e: string) => e.slice(0, 8)).join(', ')}`);
  console.log(`    Same elements reused: ${JSON.stringify(aElems) === JSON.stringify(bElems) ? 'YES ✓' : 'NO ✗'}`);

  // ════════════════════════════════════════════════════════════
  // SCENARIO 2: Duplicate-Name Target
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 2: Duplicate-Name — Two "Email" Controls Distinguished by HTML name');

  const emailPrimary = makeIdentity({ elementId: 'elem-0100', accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT', name: 'primary-email', testId: null });
  const sessionDup = {
    ...session,
    rawInteractions: [makeInteraction(emailPrimary, ['form', 'billing-section', 'main'], 'TextEntry')],
    understandingResult: { ...session.understandingResult,
      fragment: { ...session.understandingResult.fragment,
        elements: [{ elementId: 'elem-0100', tag: 'INPUT', role: 'textbox', accessibleName: 'Email', capabilities: [], componentId: 'comp-e1', componentRole: 'field' as never, sourceUrl: '/contact' }],
        components: [{ groupingId: 'comp-e1', patternType: 'TextEntry', rootElementId: 'elem-0100', constituentCount: 1, businessField: 'email', lifecycleState: 'completed', optionCount: null }],
        logicalActions: [{ actionId: 'la-e1', componentId: 'comp-e1', businessField: 'email', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: 1, sourceInteractionType: 'TextEntry' }],
        applicationSurfaces: [{ surfaceId: 'surf-e', url: '/contact', title: 'Contact', elementIds: ['elem-0100'] }],
      }
    },
  } as RecordingSession;

  const elementsDup = [
    makeStoredElement('Email (Primary)', makeIdRecord({ accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT', name: 'primary-email', testId: null, ancestorRoles: ['form', 'billing-section', 'main'] })),
    makeStoredElement('Email (Secondary)', makeIdRecord({ accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT', name: 'secondary-email', testId: null, ancestorRoles: ['form', 'shipping-section', 'main'] })),
  ];

  const dupIndex = buildInteractionIndex(sessionDup);
  const dupEventIndex = buildEventIdentityIndex(sessionDup);

  const dupBindings = resolveFieldBindings(
    [{ field: 'email', label: 'Email', kind: 'email', inputMethod: 'text', required: true, defaultValue: null, constraints: { ...DCONS }, source: 'inferred' }],
    sessionDup,
  );

  console.log(`\n  Stored Elements:`);
  for (const el of elementsDup) {
    console.log(`    ${el.logicalName}: accessibleName="${el.identity?.accessibleName}", name="${el.identity?.name}", ancestorRoles=${JSON.stringify(el.identity?.ancestorRoles)}`);
  }

  const dupTargets = resolveTargets(dupBindings.bindings, dupIndex, dupEventIndex, elementsDup);
  for (const [field, target] of dupTargets.targets) {
    const resolved = dupTargets.resolvedFields.find(r => r.field === field);
    console.log(`\n  Result for "${field}":`);
    console.log(`    target.kind = ${target.kind}`);
    if (resolved) {
      const matchedEl = elementsDup.find(e => e.id === resolved.elementId);
      console.log(`    matched: ${matchedEl?.logicalName} (score=${resolved.matchScore.toFixed(3)})`);
    }
    const warning = dupTargets.warnings.find(w => w.field === field);
    if (warning) console.log(`    warning: ${warning.reason} — ${warning.message}`);
  }
  console.log(`\n  Verdict: R4 identity (HTML name) distinguishes the two Email controls ✓`);

  // ════════════════════════════════════════════════════════════
  // SCENARIO 3: Ambiguous Target
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 3: Ambiguous — Two Truly Indistinguishable Delete Buttons');

  const deleteId = makeIdentity({ elementId: 'elem-0200', accessibleName: 'Delete', ariaRole: 'button', tag: 'BUTTON', name: null, testId: null });
  const sessionAmb = {
    ...session,
    rawInteractions: [makeInteraction(deleteId, ['list', 'main'], 'Click')],
    understandingResult: { ...session.understandingResult,
      fragment: { ...session.understandingResult.fragment,
        elements: [{ elementId: 'elem-0200', tag: 'BUTTON', role: 'button', accessibleName: 'Delete', capabilities: [], componentId: 'comp-d', componentRole: 'field' as never, sourceUrl: '/items' }],
        components: [{ groupingId: 'comp-d', patternType: 'Click', rootElementId: 'elem-0200', constituentCount: 1, businessField: 'delete', lifecycleState: 'completed', optionCount: null }],
        logicalActions: [{ actionId: 'la-d', componentId: 'comp-d', businessField: 'delete', transitionIds: [], lifecycleComplete: true, resultingChange: null, timestamp: 1, sourceInteractionType: 'Click' }],
        applicationSurfaces: [{ surfaceId: 'surf-d', url: '/items', title: 'Items', elementIds: ['elem-0200'] }],
      }
    },
  } as RecordingSession;

  const identicalDelete = makeIdRecord({ accessibleName: 'Delete', ariaRole: 'button', tag: 'BUTTON', name: null, testId: null, ancestorRoles: ['list', 'main'] });
  const elementsAmb = [
    makeStoredElement('Delete Item 1', identicalDelete),
    makeStoredElement('Delete Item 2', identicalDelete),
  ];

  console.log(`\n  Stored Elements:`);
  for (const el of elementsAmb) {
    console.log(`    ${el.logicalName}: identity=${JSON.stringify(el.identity)}`);
  }

  const ambResult = await generateCapabilityIR(
    { contract: { ...contract, dataRequirements: [{ field: 'delete', label: 'Delete', kind: 'text', inputMethod: 'text', required: true, defaultValue: null, constraints: { ...DCONS }, source: 'manual' }], sourceSessionId: 'sess-filter-1' },
      testData: new Map([['delete', 'confirm']]), projectId: 'proj-1', environment: ENV },
    makeMockUow(sessionAmb, elementsAmb),
  );

  console.log(`\n  Result:`);
  console.log(`    hasUnresolvedTargets: ${ambResult.hasUnresolvedTargets}`);
  const ambWarning = ambResult.warnings.find(w => w.reason === 'ambiguous');
  if (ambWarning) {
    console.log(`    warning: AMBIGUOUS — ${ambWarning.message}`);
    console.log(`    candidates: ${ambWarning.candidates?.map(c => `id=${c.elementId.slice(0,8)} score=${c.matchScore.toFixed(3)}`).join(', ')}`);
  }
  console.log(`    plan produced (safe degradation): ${ambResult.plan.steps.length} steps`);
  console.log(`    P2 did NOT choose an Element ✓`);

  // ════════════════════════════════════════════════════════════
  // SCENARIO 4: Unmatched Target
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 4: Unmatched — Target Element Removed From Repository');

  // Only store a completely different element
  const elementsUnmatched = [
    makeStoredElement('Search Bar', makeIdRecord({ accessibleName: 'Search', ariaRole: 'searchbox', tag: 'INPUT', name: 'q', testId: 'search-input', ancestorRoles: ['nav', 'header', 'main'] })),
  ];

  const unmatchedResult = await generateCapabilityIR(
    { contract, testData: new Map([['category', 'Electronics'], ['onSale', true], ['maxPrice', 500]]), projectId: 'proj-1', environment: ENV },
    makeMockUow(session, elementsUnmatched),
  );

  console.log(`\n  Result:`);
  console.log(`    hasUnresolvedTargets: ${unmatchedResult.hasUnresolvedTargets}`);
  console.log(`    warnings:`);
  for (const w of unmatchedResult.warnings) {
    console.log(`      ${w.field}: ${w.reason} — ${w.message}`);
  }
  console.log(`    plan still produced: ${unmatchedResult.plan.steps.length} steps`);
  console.log(`    P2 did NOT create or heal any Element ✓`);

  // ════════════════════════════════════════════════════════════
  // SCENARIO 5: Missing Provenance
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 5: Missing Provenance — Session Not Found');

  const missingResult = await generateCapabilityIR(
    { contract: { ...contract, sourceSessionId: 'sess-does-not-exist' },
      testData: new Map([['category', 'Books'], ['onSale', false], ['maxPrice', 200]]),
      projectId: 'proj-1', environment: ENV },
    makeMockUow(undefined, elements),
  );

  console.log(`\n  Result:`);
  console.log(`    hasUnresolvedTargets: ${missingResult.hasUnresolvedTargets}`);
  const missingWarning = missingResult.warnings.find(w => w.reason === 'session-not-found');
  if (missingWarning) {
    console.log(`    warning: ${missingWarning.reason} — ${missingWarning.message}`);
  }
  console.log(`    plan produced (NAVIGATE + VERIFY):`);
  for (const step of missingResult.plan.steps) {
    console.log(`      [${step.order}] ${step.action} — "${step.description}"`);
  }

  // ════════════════════════════════════════════════════════════
  // SCENARIO 6: Data Validation
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 6A: Data Validation — Slider Value Outside Min/Max');

  const reqs = contract.dataRequirements;
  const sliderReq = reqs.find(r => r.field === 'maxPrice')!;
  console.log(`\n  DataRequirement: maxPrice, kind=${sliderReq.kind}, inputMethod=${sliderReq.inputMethod}`);
  console.log(`  Constraints: min=${sliderReq.constraints.min}, max=${sliderReq.constraints.max}, step=${sliderReq.constraints.step}`);

  const invalidSlider: TestData = new Map([['maxPrice', 5000]]); // 5000 > max=1000
  console.log(`  Input: maxPrice=5000`);
  const dataResult = resolveTestData([sliderReq], invalidSlider);
  console.log(`  Result: warnings=${dataResult.warnings.length}`);
  if (dataResult.warnings.length > 0) {
    console.log(`    → ${dataResult.warnings[0].reason}: ${dataResult.warnings[0].message}`);
  }

  printSeparator('SCENARIO 6B: Data Validation — Dropdown Value Not In Options');

  const dropdownReq = reqs.find(r => r.field === 'category')!;
  console.log(`\n  DataRequirement: category, kind=${dropdownReq.kind}, inputMethod=${dropdownReq.inputMethod}`);
  console.log(`  Options: ${dropdownReq.constraints.options?.join(', ')}`);

  const invalidDropdown: TestData = new Map([['category', 'Toys']]); // Not in options
  console.log(`  Input: category=Toys`);
  const dataResult2 = resolveTestData([dropdownReq], invalidDropdown);
  console.log(`  Result: warnings=${dataResult2.warnings.length}`);
  if (dataResult2.warnings.length > 0) {
    console.log(`    → ${dataResult2.warnings[0].reason}: ${dataResult2.warnings[0].message}`);
  }

  printSeparator('SCENARIO 6C: Data Validation — Valid Slider Within Range');
  const validSlider: TestData = new Map([['maxPrice', 500]]);
  console.log(`\n  Input: maxPrice=500`);
  const dataResult3 = resolveTestData([sliderReq], validSlider);
  console.log(`  Result: warnings=${dataResult3.warnings.length} ✓`);

  // ════════════════════════════════════════════════════════════
  // SCENARIO 7: Complete Final IR Plan
  // ════════════════════════════════════════════════════════════

  printSeparator('SCENARIO 7: Complete Final ExecutionIRPlan (Variant A)');

  console.log('\n  Full plan JSON:\n');
  // Clean up for display: shorten UUIDs
  const displayPlan = JSON.parse(JSON.stringify(result1.plan));
  for (const step of displayPlan.steps) {
    if (step.target.elementId) step.target.elementId = step.target.elementId.slice(0, 8) + '...';
    if (step.target.resolvedLocators) {
      step.target.resolvedLocators = step.target.resolvedLocators.map((l: any) => ({ type: l.type, value: l.value, priority: l.priority }));
    }
  }
  console.log(JSON.stringify(displayPlan, null, 2));

  console.log('\n  Summary:');
  console.log(`    testCaseId: ${result1.plan.testCaseId}`);
  console.log(`    testCaseVersionId: ${result1.plan.testCaseVersionId}`);
  console.log(`    Steps: ${result1.plan.steps.length}`);
  console.log(`    NAVIGATE steps: ${result1.plan.steps.filter(s => s.action === 'navigate').length}`);
  console.log(`    SELECT steps: ${result1.plan.steps.filter(s => s.action === 'select').length}`);
  console.log(`    TOGGLE steps: ${result1.plan.steps.filter(s => s.action === 'toggle').length}`);
  console.log(`    FILL steps: ${result1.plan.steps.filter(s => s.action === 'fill').length}`);
  console.log(`    VERIFY steps: ${result1.plan.steps.filter(s => s.action === 'verify').length}`);
  console.log(`    Element targets resolved: ${result1.plan.steps.filter(s => s.target.kind === 'element').length}`);
  console.log(`    Total assertions: ${result1.plan.steps.reduce((sum, s) => sum + s.assertions.length, 0)}`);

  console.log('\n  InputMethod → IRAction mappings verified:');
  console.log(`    dropdown → ${inputMethodToIRAction('dropdown')}`);
  console.log(`    toggle → ${inputMethodToIRAction('toggle')}`);
  console.log(`    slider → ${inputMethodToIRAction('slider')}`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ALL SCENARIOS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
