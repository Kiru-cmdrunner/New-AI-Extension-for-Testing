/**
 * Execution IR Generator Tests — execution-ir-design.md §5
 *
 * Tests the DefaultIRGenerator: transforms ATC version + Element Repository
 * state + Environment → ExecutionIRArtifact.
 *
 * Key validations:
 *   - StepAction → IRAction 1:1 identity mapping
 *   - Element resolution (elementId → resolvedLocators snapshot)
 *   - WAIT_FOR_ELEMENT injection before element-interacting steps
 *   - Navigation URL resolution (absolute + relative)
 *   - Validation → IRAssertion transformation
 *   - ExecutionParameters defaults applied
 *   - Generator is stateless and pure
 */
import { describe, it, expect } from 'vitest';
import { DefaultIRGenerator, GENERATOR_VERSION, mapStepActionToIRAction } from '../../../src/domain/execution-ir/generator';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import {
  StepAction,
  LocatorStrategyType,
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../../../src/domain/enums';
import {
  createTestCase,
  createStep,
  createValidation,
} from '../../../src/domain/entities/approved-test-case';
import { createElement } from '../../../src/domain/entities/element';
import type { Element } from '../../../src/domain/entities/element';
import type { ExecutionIRPlan, ExecutionIRArtifact } from '../../../src/domain/execution-ir/types';
import type { IREnvironment } from '../../../src/domain/execution-ir/types';

// ── Test Helpers ──────────────────────────────────────────

function makeEnvironment(): IREnvironment {
  return { baseUrl: 'https://staging.example.com', browser: 'chrome', viewport: { width: 1440, height: 900 } };
}

function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id: overrides.id ?? 'elm-test-001',
    projectId: 'prj-test-001',
    logicalName: overrides.logicalName ?? 'Test Element',
    description: '',
    pageOrComponent: overrides.pageOrComponent ?? 'TestPage',
    locatorStrategies: overrides.locatorStrategies ?? [
      { type: LocatorStrategyType.ROLE, value: 'button[name="Test"]', priority: 1, confidence: 0.95 },
      { type: LocatorStrategyType.CSS, value: '#test-btn', priority: 2, confidence: 0.85 },
    ],
    status: overrides.status ?? 'active' as Element['status'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastHealedAt: null,
    healHistory: [],
  };
}

function makeElements(...elements: Element[]): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const el of elements) {
    map.set(el.id, el);
  }
  return map;
}

// ── Tests ─────────────────────────────────────────────────

describe('DefaultIRGenerator', () => {
  const generator = new DefaultIRGenerator();

  describe('generator version', () => {
    it('exposes GENERATOR_VERSION', () => {
      expect(generator.version).toBe(GENERATOR_VERSION);
    });

    it('has semver-like format', () => {
      expect(generator.version).toMatch(/^ir-gen-\d+\.\d+\.\d+$/);
    });
  });

  // ── Basic Generation ────────────────────────────────────

  describe('basic generation', () => {
    it('generates an ExecutionIRArtifact from an ATC version', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test Login',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.CLICK, description: 'Click login', elementId: element.id },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      expect(artifact.id).toBeTruthy();
      expect(artifact.testCaseVersionId).toBe(version.id);
      expect(artifact.generatedAt).toBeTruthy();
      expect(artifact.generatorVersion).toBe(GENERATOR_VERSION);
      expect(artifact.renderings).toEqual({});
    });

    it('carries testCase metadata into the plan', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Shopping Cart Checkout',
        tags: ['smoke', 'checkout'],
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.CLICK, description: 'Click checkout', elementId: element.id },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      expect(artifact.plan.testCaseId).toBe(testCase.id);
      expect(artifact.plan.testCaseVersionId).toBe(version.id);
      expect(artifact.plan.testCaseVersionNumber).toBe(version.versionNumber);
      expect(artifact.plan.title).toBe('Shopping Cart Checkout');
      expect(artifact.plan.tags).toEqual(['smoke', 'checkout']);
    });

    it('embeds environment into the plan', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go home' },
        ],
      });

      const env = makeEnvironment();
      const artifact = generator.generate(testCase, version, makeElements(), env);

      expect(artifact.plan.environment).toEqual(env);
    });
  });

  // ── StepAction → IRAction Mapping ───────────────────────

  describe('StepAction → IRAction mapping', () => {
    const cases: Array<[StepAction, IRAction]> = [
      [StepAction.CLICK, IRAction.CLICK],
      [StepAction.FILL, IRAction.FILL],
      [StepAction.SELECT, IRAction.SELECT],
      [StepAction.SELECT_DATE, IRAction.SELECT_DATE],
      [StepAction.TOGGLE, IRAction.TOGGLE],
      [StepAction.HOVER, IRAction.HOVER],
      [StepAction.NAVIGATE, IRAction.NAVIGATE],
      [StepAction.VERIFY, IRAction.VERIFY],
      [StepAction.WAIT, IRAction.WAIT],
    ];

    for (const [stepAction, expectedIRAction] of cases) {
      it(`maps ${stepAction} → ${expectedIRAction}`, () => {
        expect(mapStepActionToIRAction(stepAction)).toBe(expectedIRAction);
      });
    }
  });

  // ── Element Resolution ──────────────────────────────────

  describe('element resolution', () => {
    it('resolves elementId to concrete locators at generation time', () => {
      const element = makeElement({
        id: 'elm-email-001',
        logicalName: 'Email Input',
        pageOrComponent: 'LoginPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'textbox[name="Email"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.TEST_ID, value: 'email-input', priority: 2, confidence: 0.9 },
        ],
      });
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.FILL, description: 'Enter email', elementId: element.id, input: 'test@test.com' },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      // Find the FILL step (skip injected WAIT_FOR_ELEMENT)
      const fillStep = artifact.plan.steps.find(s => s.action === IRAction.FILL)!;

      expect(fillStep.target.kind).toBe('element');
      if (fillStep.target.kind === 'element') {
        expect(fillStep.target.elementId).toBe('elm-email-001');
        expect(fillStep.target.elementName).toBe('Email Input');
        expect(fillStep.target.pageOrComponent).toBe('LoginPage');
        expect(fillStep.target.resolvedLocators).toHaveLength(2);
        expect(fillStep.target.resolvedLocators[0].type).toBe(LocatorStrategyType.ROLE);
        expect(fillStep.target.resolvedLocators[0].value).toBe('textbox[name="Email"]');
        expect(fillStep.target.resolvedLocators[0].priority).toBe(1);
        expect(fillStep.target.resolvedLocators[0].confidence).toBe(0.95);
      }
    });

    it('throws when a referenced element is not in the map', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.CLICK, description: 'Click missing', elementId: 'nonexistent-element' },
        ],
      });

      expect(() => {
        generator.generate(testCase, version, makeElements(), makeEnvironment());
      }).toThrow();
    });
  });

  // ── WAIT_FOR_ELEMENT Injection ──────────────────────────

  describe('WAIT_FOR_ELEMENT injection', () => {
    it('injects WAIT_FOR_ELEMENT before element-interacting steps', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.CLICK, description: 'Click button', elementId: element.id },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      // Should have 2 steps: WAIT_FOR_ELEMENT (injected) + CLICK
      expect(artifact.plan.steps).toHaveLength(2);

      const waitStep = artifact.plan.steps[0];
      expect(waitStep.action).toBe(IRAction.WAIT_FOR_ELEMENT);
      expect(waitStep.order).toBe(0);
      expect(waitStep.description).toContain('(implicit)');
      expect(waitStep.target.kind).toBe('element');

      const clickStep = artifact.plan.steps[1];
      expect(clickStep.action).toBe(IRAction.CLICK);
      expect(clickStep.order).toBe(1);
    });

    it('does NOT inject WAIT_FOR_ELEMENT before NAVIGATE or WAIT', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Navigate', input: '/login' },
          { order: 1, action: StepAction.WAIT, description: 'Wait 1s' },
        ],
      });

      const artifact = generator.generate(testCase, version, makeElements(), makeEnvironment());

      // No injected steps — only the 2 authored steps
      expect(artifact.plan.steps).toHaveLength(2);
      expect(artifact.plan.steps.every(s => s.action !== IRAction.WAIT_FOR_ELEMENT)).toBe(true);
    });

    it('injects correctly for multi-step flow with mixed actions', () => {
      const emailEl = makeElement({ id: 'elm-email', logicalName: 'Email' });
      const btnEl = makeElement({ id: 'elm-btn', logicalName: 'Button' });
      const elements = makeElements(emailEl, btnEl);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
          { order: 1, action: StepAction.FILL, description: 'Enter email', elementId: emailEl.id, input: 'a@b.com' },
          { order: 2, action: StepAction.CLICK, description: 'Click submit', elementId: btnEl.id },
          { order: 3, action: StepAction.WAIT, description: 'Wait for redirect' },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      // Expected IR steps:
      // 0: NAVIGATE (no wait)
      // 1: WAIT_FOR_ELEMENT (injected before FILL)
      // 2: FILL
      // 3: WAIT_FOR_ELEMENT (injected before CLICK)
      // 4: CLICK
      // 5: WAIT (no wait)
      expect(artifact.plan.steps).toHaveLength(6);

      const actions = artifact.plan.steps.map(s => s.action);
      expect(actions).toEqual([
        IRAction.NAVIGATE,
        IRAction.WAIT_FOR_ELEMENT,
        IRAction.FILL,
        IRAction.WAIT_FOR_ELEMENT,
        IRAction.CLICK,
        IRAction.WAIT,
      ]);

      // Verify sequential ordering
      for (let i = 0; i < artifact.plan.steps.length; i++) {
        expect(artifact.plan.steps[i].order).toBe(i);
      }
    });
  });

  // ── URL Resolution ──────────────────────────────────────

  describe('URL resolution for navigate steps', () => {
    it('prepends baseUrl to relative URLs', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
        ],
      });

      const artifact = generator.generate(testCase, version, makeElements(), makeEnvironment());
      const navStep = artifact.plan.steps[0];

      expect(navStep.target.kind).toBe('url');
      if (navStep.target.kind === 'url') {
        expect(navStep.target.url).toBe('https://staging.example.com/login');
      }
    });

    it('uses absolute URLs as-is', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go to prod', input: 'https://prod.example.com/home' },
        ],
      });

      const artifact = generator.generate(testCase, version, makeElements(), makeEnvironment());
      const navStep = artifact.plan.steps[0];

      if (navStep.target.kind === 'url') {
        expect(navStep.target.url).toBe('https://prod.example.com/home');
      }
    });

    it('uses baseUrl when no input is provided', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go home' },
        ],
      });

      const artifact = generator.generate(testCase, version, makeElements(), makeEnvironment());
      const navStep = artifact.plan.steps[0];

      if (navStep.target.kind === 'url') {
        expect(navStep.target.url).toBe('https://staging.example.com');
      }
    });

    it('handles baseUrl with trailing slash', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
        ],
      });

      const env = { ...makeEnvironment(), baseUrl: 'https://staging.example.com/' };
      const artifact = generator.generate(testCase, version, makeElements(), env);
      const navStep = artifact.plan.steps[0];

      if (navStep.target.kind === 'url') {
        expect(navStep.target.url).toBe('https://staging.example.com/login');
      }
    });
  });

  // ── Validation → IRAssertion ────────────────────────────

  describe('validation → IRAssertion transformation', () => {
    it('transforms validations into resolved assertions', () => {
      const element = makeElement({ id: 'elm-verify-001' });
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          {
            order: 0,
            action: StepAction.CLICK,
            description: 'Click button',
            elementId: element.id,
            validations: [
              {
                type: ValidationType.VISIBILITY,
                comparison: ValidationComparison.IS_TRUE,
                expectedValue: true,
                severity: ValidationSeverity.HARD,
                property: 'visible',
              },
            ],
          },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      // Find the CLICK step (after injected WAIT_FOR_ELEMENT)
      const clickStep = artifact.plan.steps.find(s => s.action === IRAction.CLICK)!;

      expect(clickStep.assertions).toHaveLength(1);
      expect(clickStep.assertions[0].type).toBe(ValidationType.VISIBILITY);
      expect(clickStep.assertions[0].comparison).toBe(ValidationComparison.IS_TRUE);
      expect(clickStep.assertions[0].expectedValue).toBeNull(); // IS_TRUE nullifies expectedValue
      expect(clickStep.assertions[0].severity).toBe(ValidationSeverity.HARD);
      expect(clickStep.assertions[0].property).toBe('visible');
    });

    it('resolves assertion elementId to a target', () => {
      const element = makeElement({ id: 'elm-assert-001' });
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          {
            order: 0,
            action: StepAction.CLICK,
            description: 'Click button',
            elementId: element.id,
            validations: [
              {
                type: ValidationType.PRESENCE,
                comparison: ValidationComparison.IS_TRUE,
                expectedValue: true,
                severity: ValidationSeverity.HARD,
                property: 'present',
              },
            ],
          },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());
      const clickStep = artifact.plan.steps.find(s => s.action === IRAction.CLICK)!;

      expect(clickStep.assertions[0].target.kind).toBe('none'); // No elementId on the validation itself
    });
  });

  // ── ExecutionParameters ─────────────────────────────────

  describe('execution parameters', () => {
    it('applies default execution parameters to all steps', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go', input: '/login' },
        ],
      });

      const artifact = generator.generate(testCase, version, makeElements(), makeEnvironment());

      // Navigate steps use waitStrategy: 'none' (no element to wait for)
      expect(artifact.plan.steps[0].executionParameters.timeoutMs).toBe(DEFAULT_EXECUTION_PARAMETERS.timeoutMs);
      expect(artifact.plan.steps[0].executionParameters.retryCount).toBe(DEFAULT_EXECUTION_PARAMETERS.retryCount);
      expect(artifact.plan.steps[0].executionParameters.waitStrategy).toBe('none');
    });

    it('every step has fully resolved parameters (no undefined fields)', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.CLICK, description: 'Click', elementId: element.id },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());

      for (const step of artifact.plan.steps) {
        expect(step.executionParameters.timeoutMs).toBeDefined();
        expect(step.executionParameters.retryCount).toBeDefined();
        expect(step.executionParameters.retryDelayMs).toBeDefined();
        expect(step.executionParameters.waitStrategy).toBeDefined();
      }
    });
  });

  // ── Input Resolution ────────────────────────────────────

  describe('input resolution', () => {
    it('carries string input through', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.FILL, description: 'Enter email', elementId: element.id, input: 'test@test.com' },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());
      const fillStep = artifact.plan.steps.find(s => s.action === IRAction.FILL)!;

      expect(fillStep.input).toBe('test@test.com');
    });

    it('resolves null input to null', () => {
      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.NAVIGATE, description: 'Go' },
        ],
      });

      const artifact = generator.generate(testCase, version, makeElements(), makeEnvironment());

      expect(artifact.plan.steps[0].input).toBeNull();
    });

    it('resolves number input', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.FILL, description: 'Enter quantity', elementId: element.id, input: 42 },
        ],
      });

      const artifact = generator.generate(testCase, version, elements, makeEnvironment());
      const fillStep = artifact.plan.steps.find(s => s.action === IRAction.FILL)!;

      expect(fillStep.input).toBe(42);
    });
  });

  // ── Purity ──────────────────────────────────────────────

  describe('purity', () => {
    it('produces the same step structure on repeated calls (modulo IDs/timestamps)', () => {
      const element = makeElement();
      const elements = makeElements(element);

      const { testCase, version } = createTestCase({
        projectId: 'prj-test-001',
        title: 'Test',
        createdBy: 'tester',
        steps: [
          { order: 0, action: StepAction.CLICK, description: 'Click', elementId: element.id },
        ],
      });

      const artifact1 = generator.generate(testCase, version, elements, makeEnvironment());
      const artifact2 = generator.generate(testCase, version, elements, makeEnvironment());

      // Plans should have the same structure (steps, actions, targets, input)
      expect(artifact1.plan.steps).toHaveLength(artifact2.plan.steps.length);
      expect(artifact1.plan.steps.map(s => s.action)).toEqual(artifact2.plan.steps.map(s => s.action));
      expect(artifact1.plan.steps.map(s => s.description)).toEqual(artifact2.plan.steps.map(s => s.description));
      expect(artifact1.plan.title).toBe(artifact2.plan.title);
      expect(artifact1.plan.tags).toEqual(artifact2.plan.tags);

      // But artifact IDs and timestamps differ (new UUID + new timestamp)
      expect(artifact1.id).not.toBe(artifact2.id);
    });
  });
});
