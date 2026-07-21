/**
 * Execution IR Staleness Tests — execution-ir-design.md §3
 *
 * Tests staleness detection and locator change detection (INV-IR5).
 *
 * Three states: Missing → Fresh → Stale.
 * Detection: element.updatedAt > artifact.generatedAt (hard stale),
 *            generatorVersion mismatch (soft stale).
 */
import { describe, it, expect } from 'vitest';
import { checkStaleness, detectLocatorChanges } from '../../../src/domain/execution-ir/staleness';
import type { ExecutionIRArtifact, ExecutionIRPlan, IRStep } from '../../../src/domain/execution-ir/types';
import type { Element } from '../../../src/domain/entities/element';
import { LocatorStrategyType } from '../../../src/domain/enums';
import { GENERATOR_VERSION } from '../../../src/domain/execution-ir/generator';

// ── Test Helpers ──────────────────────────────────────────

function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id: overrides.id ?? 'elm-001',
    projectId: 'prj-001',
    logicalName: overrides.logicalName ?? 'Test Element',
    description: '',
    pageOrComponent: 'TestPage',
    locatorStrategies: overrides.locatorStrategies ?? [
      { type: LocatorStrategyType.ROLE, value: 'button[name="Test"]', priority: 1, confidence: 0.95 },
    ],
    status: 'active' as Element['status'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    lastHealedAt: null,
    healHistory: [],
  };
}

function makePlan(steps: IRStep[]): ExecutionIRPlan {
  return {
    testCaseId: 'tc-001',
    testCaseVersionId: 'tcv-001',
    testCaseVersionNumber: 1,
    title: 'Test',
    tags: [],
    environment: { baseUrl: 'https://staging.example.com', browser: 'chrome', viewport: { width: 1280, height: 720 } },
    steps,
  };
}

function makeArtifact(plan: ExecutionIRPlan, overrides: Partial<ExecutionIRArtifact> = {}): ExecutionIRArtifact {
  return {
    id: 'ir-001',
    testCaseVersionId: 'tcv-001',
    plan,
    generatedAt: '2026-07-20T10:00:00.000Z',
    generatorVersion: GENERATOR_VERSION,
    renderings: {},
    ...overrides,
  };
}

function makeElementStep(
  elementId: string,
  elementName: string,
  locators: Array<{ type: LocatorStrategyType; value: string; priority: number }>,
): IRStep {
  return {
    id: `step-${elementId}`,
    order: 0,
    action: 'click',
    description: `Click ${elementName}`,
    target: {
      kind: 'element',
      elementId,
      elementName,
      pageOrComponent: 'TestPage',
      resolvedLocators: locators.map(l => ({ ...l, confidence: 0.9 })),
    },
    input: null,
    assertions: [],
    executionParameters: { timeoutMs: 30000, retryCount: 0, retryDelayMs: 1000, waitStrategy: 'visible' },
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('Staleness Detection', () => {

  // ── Missing ─────────────────────────────────────────────

  describe('missing status', () => {
    it('returns missing when no artifact exists', () => {
      const report = checkStaleness(undefined, [], GENERATOR_VERSION);

      expect(report.status).toBe('missing');
      expect(report.reasons).toBeUndefined();
    });
  });

  // ── Fresh ───────────────────────────────────────────────

  describe('fresh status', () => {
    it('returns fresh when artifact exists and no elements changed', () => {
      const element = makeElement({ updatedAt: '2026-07-20T09:00:00.000Z' });
      const artifact = makeArtifact(makePlan([]), { generatedAt: '2026-07-20T10:00:00.000Z' });

      const report = checkStaleness(artifact, [element], GENERATOR_VERSION);

      expect(report.status).toBe('fresh');
    });

    it('returns fresh when element was updated before IR generation', () => {
      const element = makeElement({ updatedAt: '2026-07-20T08:00:00.000Z' });
      const artifact = makeArtifact(makePlan([]), { generatedAt: '2026-07-20T10:00:00.000Z' });

      const report = checkStaleness(artifact, [element], GENERATOR_VERSION);

      expect(report.status).toBe('fresh');
    });

    it('returns fresh when element updatedAt equals generatedAt exactly', () => {
      const element = makeElement({ updatedAt: '2026-07-20T10:00:00.000Z' });
      const artifact = makeArtifact(makePlan([]), { generatedAt: '2026-07-20T10:00:00.000Z' });

      const report = checkStaleness(artifact, [element], GENERATOR_VERSION);

      expect(report.status).toBe('fresh');
    });
  });

  // ── Stale: Element Changed ──────────────────────────────

  describe('stale: element changed', () => {
    it('returns stale when element was updated after IR generation', () => {
      const element = makeElement({
        id: 'elm-signin',
        logicalName: 'Sign In Button',
        updatedAt: '2026-07-20T11:00:00.000Z', // after generation
      });
      const artifact = makeArtifact(makePlan([]), { generatedAt: '2026-07-20T10:00:00.000Z' });

      const report = checkStaleness(artifact, [element], GENERATOR_VERSION);

      expect(report.status).toBe('stale');
      expect(report.reasons).toHaveLength(1);
      expect(report.reasons![0].type).toBe('element_changed');
      expect(report.reasons![0].elementId).toBe('elm-signin');
      expect(report.reasons![0].elementName).toBe('Sign In Button');
    });

    it('returns stale with multiple reasons when multiple elements changed', () => {
      const element1 = makeElement({ id: 'elm-1', logicalName: 'Email', updatedAt: '2026-07-20T11:00:00.000Z' });
      const element2 = makeElement({ id: 'elm-2', logicalName: 'Password', updatedAt: '2026-07-20T12:00:00.000Z' });
      const unchangedElement = makeElement({ id: 'elm-3', logicalName: 'Submit', updatedAt: '2026-07-20T09:00:00.000Z' });
      const artifact = makeArtifact(makePlan([]), { generatedAt: '2026-07-20T10:00:00.000Z' });

      const report = checkStaleness(artifact, [element1, element2, unchangedElement], GENERATOR_VERSION);

      expect(report.status).toBe('stale');
      expect(report.reasons).toHaveLength(2);
      const elementReasons = report.reasons!.filter(r => r.type === 'element_changed');
      expect(elementReasons).toHaveLength(2);
    });

    it('only checks referenced elements, not all elements in the repository', () => {
      const referencedElement = makeElement({ id: 'elm-ref', updatedAt: '2026-07-20T09:00:00.000Z' });
      const artifact = makeArtifact(makePlan([]), { generatedAt: '2026-07-20T10:00:00.000Z' });

      // Even if other elements changed, only referencedElements are passed in.
      const report = checkStaleness(artifact, [referencedElement], GENERATOR_VERSION);

      expect(report.status).toBe('fresh');
    });
  });

  // ── Stale: Generator Upgraded ───────────────────────────

  describe('stale: generator upgraded', () => {
    it('returns stale when generatorVersion differs', () => {
      const artifact = makeArtifact(makePlan([]), { generatorVersion: 'ir-gen-0.9.0' });

      const report = checkStaleness(artifact, [], GENERATOR_VERSION);

      expect(report.status).toBe('stale');
      expect(report.reasons).toHaveLength(1);
      expect(report.reasons![0].type).toBe('generator_upgraded');
      expect(report.reasons![0].description).toContain('ir-gen-0.9.0');
      expect(report.reasons![0].description).toContain(GENERATOR_VERSION);
    });

    it('returns stale with both element_changed and generator_upgraded reasons', () => {
      const element = makeElement({ updatedAt: '2026-07-20T11:00:00.000Z' });
      const artifact = makeArtifact(makePlan([]), {
        generatedAt: '2026-07-20T10:00:00.000Z',
        generatorVersion: 'ir-gen-0.9.0',
      });

      const report = checkStaleness(artifact, [element], GENERATOR_VERSION);

      expect(report.status).toBe('stale');
      expect(report.reasons).toHaveLength(2);
    });
  });
});

// ── Locator Change Detection (INV-IR5) ────────────────────

describe('Locator Change Detection (INV-IR5)', () => {

  it('returns empty diff when locators are unchanged', () => {
    const locators = [{ type: LocatorStrategyType.ROLE, value: 'button[name="Submit"]', priority: 1 }];
    const oldPlan = makePlan([makeElementStep('elm-1', 'Submit Button', locators)]);
    const newPlan = makePlan([makeElementStep('elm-1', 'Submit Button', locators)]);

    const diffs = detectLocatorChanges(oldPlan, newPlan);

    expect(diffs).toHaveLength(0);
  });

  it('detects when a locator value changed', () => {
    const oldLocators = [{ type: LocatorStrategyType.CSS, value: '#old-btn', priority: 1 }];
    const newLocators = [{ type: LocatorStrategyType.CSS, value: '#new-btn', priority: 1 }];
    const oldPlan = makePlan([makeElementStep('elm-1', 'Submit Button', oldLocators)]);
    const newPlan = makePlan([makeElementStep('elm-1', 'Submit Button', newLocators)]);

    const diffs = detectLocatorChanges(oldPlan, newPlan);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].elementId).toBe('elm-1');
    expect(diffs[0].elementName).toBe('Submit Button');
    expect(diffs[0].oldLocators).toEqual([{ type: 'css', value: '#old-btn', priority: 1 }]);
    expect(diffs[0].newLocators).toEqual([{ type: 'css', value: '#new-btn', priority: 1 }]);
  });

  it('detects when locator count changed (element healed, new strategy added)', () => {
    const oldLocators = [{ type: LocatorStrategyType.CSS, value: '#btn', priority: 1 }];
    const newLocators = [
      { type: LocatorStrategyType.ROLE, value: 'button[name="Submit"]', priority: 1 },
      { type: LocatorStrategyType.CSS, value: '#btn', priority: 2 },
    ];
    const oldPlan = makePlan([makeElementStep('elm-1', 'Submit Button', oldLocators)]);
    const newPlan = makePlan([makeElementStep('elm-1', 'Submit Button', newLocators)]);

    const diffs = detectLocatorChanges(oldPlan, newPlan);

    expect(diffs).toHaveLength(1);
  });

  it('detects when locator type changed (self-heal: CSS → role)', () => {
    const oldLocators = [{ type: LocatorStrategyType.CSS, value: '.login-btn', priority: 1 }];
    const newLocators = [{ type: LocatorStrategyType.ROLE, value: 'button[name="Login"]', priority: 1 }];
    const oldPlan = makePlan([makeElementStep('elm-login', 'Login Button', oldLocators)]);
    const newPlan = makePlan([makeElementStep('elm-login', 'Login Button', newLocators)]);

    const diffs = detectLocatorChanges(oldPlan, newPlan);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].elementId).toBe('elm-login');
  });

  it('deduplicates diffs for elements appearing in multiple steps', () => {
    const oldLocators = [{ type: LocatorStrategyType.CSS, value: '#old', priority: 1 }];
    const newLocators = [{ type: LocatorStrategyType.CSS, value: '#new', priority: 1 }];

    const oldPlan = makePlan([
      makeElementStep('elm-1', 'Button', oldLocators),
      { ...makeElementStep('elm-1', 'Button', oldLocators), id: 'step-2', order: 1 },
    ]);
    const newPlan = makePlan([
      makeElementStep('elm-1', 'Button', newLocators),
      { ...makeElementStep('elm-1', 'Button', newLocators), id: 'step-2', order: 1 },
    ]);

    const diffs = detectLocatorChanges(oldPlan, newPlan);

    // Should report the element once, not twice
    expect(diffs).toHaveLength(1);
  });

  it('returns empty diff when plans have no element targets', () => {
    const urlStep: IRStep = {
      id: 'step-nav',
      order: 0,
      action: 'navigate',
      description: 'Navigate',
      target: { kind: 'url', url: 'https://example.com' },
      input: null,
      assertions: [],
      executionParameters: { timeoutMs: 30000, retryCount: 0, retryDelayMs: 1000, waitStrategy: 'none' },
    };

    const oldPlan = makePlan([urlStep]);
    const newPlan = makePlan([urlStep]);

    expect(detectLocatorChanges(oldPlan, newPlan)).toHaveLength(0);
  });
});
