/**
 * Test Function Renderer Tests — Milestone 3
 *
 * Tests that the test function renderer produces complete, production-quality
 * Playwright test files from ExecutionIRPlan objects.
 */
import { describe, it, expect } from 'vitest';
import {
  renderTestFile,
  renderTestBody,
} from '../../../src/adapters/playwright/test-function-renderer';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import type { IRStep, ExecutionIRPlan, ResolvedLocator } from '../../../src/domain/execution-ir/types';
import {
  LocatorStrategyType,
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../../../src/domain/enums';
import { ALL_REFERENCE_PLANS } from '../../../src/adapters/playwright/__fixtures__/reference-ir-plans';

// ── Helpers ───────────────────────────────────────────────

function makeLocator(type: LocatorStrategyType, value: string, priority = 1): ResolvedLocator {
  return { type, value, priority, confidence: 0.9 };
}

function makeStep(
  action: IRAction,
  target: IRStep['target'],
  options?: {
    input?: IRStep['input'];
    assertions?: IRStep['assertions'];
  },
): IRStep {
  return {
    id: `step-${Math.random().toString(36).slice(2, 8)}`,
    order: 0,
    action,
    description: 'Test step',
    target,
    input: options?.input ?? null,
    assertions: options?.assertions ?? [],
    executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
  };
}

function makePlan(title: string, steps: IRStep[]): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title,
    tags: ['test'],
    environment: {
      baseUrl: 'https://staging.example.com',
      browser: 'chrome',
      viewport: { width: 1440, height: 900 },
    },
    steps,
  };
}

// ── Structure ─────────────────────────────────────────────

describe('file structure', () => {
  it('has import statement', () => {
    const plan = makePlan('Test', [makeStep(IRAction.NAVIGATE, { kind: 'url', url: 'https://example.com' })]);
    const result = renderTestFile(plan);
    expect(result).toContain("import { test, expect } from '@playwright/test';");
  });

  it('wraps in test.describe()', () => {
    const plan = makePlan('Login Flow', []);
    const result = renderTestFile(plan);
    expect(result).toContain("test.describe('Login Flow', () => {");
    expect(result.trim().endsWith('});')).toBe(true);
  });

  it('uses test() inside describe', () => {
    const plan = makePlan('Login Flow', []);
    const result = renderTestFile(plan);
    expect(result).toContain("test('should complete login Flow successfully', async ({ page }) => {");
  });

  it('has proper closing braces', () => {
    const plan = makePlan('Test', []);
    const result = renderTestFile(plan);
    // Should end with });\n});\n
    expect(result.trim().endsWith('});\n});') || result.trim().endsWith('});')).toBe(true);
  });
});

// ── Action Lines ──────────────────────────────────────────

describe('action rendering', () => {
  it('renders awaited action lines', () => {
    const plan = makePlan('Test', [
      makeStep(IRAction.CLICK, {
        kind: 'element',
        elementId: 'btn-1',
        elementName: 'Submit Button',
        pageOrComponent: 'LoginPage',
        resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')],
      }),
    ]);
    const result = renderTestFile(plan);
    expect(result).toContain("await page.getByRole('button', { name: 'Submit' }).click()");
  });

  it('renders step description as comment', () => {
    const plan = makePlan('Test', [
      makeStep(IRAction.NAVIGATE, { kind: 'url', url: 'https://example.com' }),
    ]);
    plan.steps[0] = { ...plan.steps[0], description: 'Navigate to home page' };
    const result = renderTestFile(plan);
    expect(result).toContain('// Navigate to home page');
  });

  it('renders all action types from reference plans', () => {
    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      const result = renderTestFile(plan);
      // Must have at least one await line
      expect(result).toContain('await');
    }
  });
});

// ── Assertion Integration ─────────────────────────────────

describe('assertion integration', () => {
  it('renders assertions after action line', () => {
    const plan = makePlan('Test', [
      makeStep(
        IRAction.CLICK,
        {
          kind: 'element',
          elementId: 'btn-1',
          elementName: 'Submit',
          pageOrComponent: 'Page',
          resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')],
        },
        {
          assertions: [{
            type: ValidationType.VISIBILITY,
            comparison: ValidationComparison.IS_TRUE,
            expectedValue: null,
            severity: ValidationSeverity.HARD,
            target: {
              kind: 'element',
              elementId: 'elm-1',
              elementName: 'Success Message',
              pageOrComponent: 'Page',
              resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'heading[name="Success"]')],
            },
            property: null,
          }],
        },
      ),
    ]);
    const result = renderTestFile(plan);
    // Action should come before assertion
    const clickIdx = result.indexOf('.click()');
    const expectIdx = result.indexOf('toBeVisible()');
    expect(clickIdx).toBeGreaterThan(0);
    expect(expectIdx).toBeGreaterThan(clickIdx);
  });

  it('renders VERIFY step assertions without action line', () => {
    const plan = makePlan('Test', [
      makeStep(
        IRAction.VERIFY,
        {
          kind: 'element',
          elementId: 'btn-1',
          elementName: 'Dashboard',
          pageOrComponent: 'Page',
          resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'heading[name="Dashboard"]')],
        },
        {
          assertions: [{
            type: ValidationType.TEXT_MATCH,
            comparison: ValidationComparison.EQUALS,
            expectedValue: 'Welcome',
            severity: ValidationSeverity.HARD,
            target: {
              kind: 'element',
              elementId: 'elm-1',
              elementName: 'Dashboard',
              pageOrComponent: 'Page',
              resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'heading[name="Dashboard"]')],
            },
            property: null,
          }],
        },
      ),
    ]);
    const result = renderTestFile(plan);
    expect(result).toContain('// ');
    expect(result).toContain('toHaveText');
    // Should NOT contain any action method after the comment
    const bodyStart = result.indexOf('async ({ page }) => {');
    const body = result.slice(bodyStart);
    // VERIFY should not produce a .click() or .fill() etc.
    expect(body).not.toMatch(/\.(click|fill|selectOption|hover|goto|check|uncheck)\(/);
  });
});

// ── WAIT_FOR_ELEMENT ──────────────────────────────────────

describe('WAIT_FOR_ELEMENT omission', () => {
  it('omits WAIT_FOR_ELEMENT steps entirely', () => {
    const plan = makePlan('Test', [
      makeStep(
        IRAction.WAIT_FOR_ELEMENT,
        {
          kind: 'element',
          elementId: 'elm-1',
          elementName: 'Submit Button',
          pageOrComponent: 'Page',
          resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')],
        },
      ),
      makeStep(
        IRAction.CLICK,
        {
          kind: 'element',
          elementId: 'elm-1',
          elementName: 'Submit Button',
          pageOrComponent: 'Page',
          resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')],
        },
      ),
    ]);
    const result = renderTestFile(plan);
    // Click should be present
    expect(result).toContain('.click()');
    // No waitFor for WAIT_FOR_ELEMENT
    expect(result).not.toContain('waitForSelector');
    expect(result).not.toContain('waitForElement');
  });
});

// ── renderTestBody ────────────────────────────────────────

describe('renderTestBody', () => {
  it('returns body lines without import/describe wrapper', () => {
    const steps = [
      makeStep(IRAction.NAVIGATE, { kind: 'url', url: 'https://example.com' }),
    ];
    const body = renderTestBody(steps, '    ');
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toContain('// ');
    expect(body.some((l: string) => l.includes('await page.goto'))).toBe(true);
  });

  it('skips WAIT_FOR_ELEMENT steps', () => {
    const steps = [
      makeStep(
        IRAction.WAIT_FOR_ELEMENT,
        {
          kind: 'element',
          elementId: 'elm-1',
          elementName: 'Test',
          pageOrComponent: 'Page',
          resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'button[name="Test"]')],
        },
      ),
    ];
    const body = renderTestBody(steps, '    ');
    expect(body.length).toBe(0);
  });
});

// ── Reference Plan Coverage ───────────────────────────────

describe('reference plan coverage', () => {
  for (const entry of ALL_REFERENCE_PLANS) {
    it(`renders "${entry.name}" as a complete test function`, () => {
      const plan = entry.factory();
      const result = renderTestFile(plan);

      // Must have imports
      expect(result).toContain("import { test, expect }");
      // Must have describe block
      expect(result).toContain("test.describe(");
      // Must have test block
      expect(result).toContain("test(");
      // Must end with closing braces
      expect(result.trim().endsWith('});')).toBe(true);
    });

    it(`"${entry.name}" has no bare undefined/null/NaN`, () => {
      const plan = entry.factory();
      const result = renderTestFile(plan);
      // Remove quoted strings, then check for bare undefined/NaN
      const withoutStrings = result.replace(/'[^']*'/g, "''");
      expect(withoutStrings).not.toContain('undefined');
      expect(withoutStrings).not.toContain('NaN');
    });
  }
});

// ── Production Quality ────────────────────────────────────

describe('production quality', () => {
  it('blank line between steps for readability', () => {
    const plan = makePlan('Test', [
      makeStep(IRAction.NAVIGATE, { kind: 'url', url: 'https://example.com' }),
      makeStep(IRAction.CLICK, {
        kind: 'element',
        elementId: 'btn-1',
        elementName: 'Submit',
        pageOrComponent: 'Page',
        resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')],
      }),
    ]);
    const result = renderTestFile(plan);
    // There should be a blank line between the two steps
    const navLine = result.indexOf('await page.goto');
    const clickLine = result.indexOf('.click()');
    const between = result.slice(navLine, clickLine);
    expect(between).toContain('\n\n');
  });

  it('trailing newline at end of file', () => {
    const plan = makePlan('Test', []);
    const result = renderTestFile(plan);
    expect(result.endsWith('\n')).toBe(true);
  });

  it('escapes title in describe and test name', () => {
    const plan = makePlan("User's Login", []);
    const result = renderTestFile(plan);
    expect(result).toContain("User\\'s Login");
  });
});
