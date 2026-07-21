/**
 * Playwright Generator Tests — Milestone B6
 *
 * Validates: click actions, navigation, multi-step workflows, iframe context,
 * Shadow DOM, error steps, determinism, fallback locator comments, traceability,
 * action-mapping extensibility (type/select/hover), no locator resolution,
 * no execution-json modification, no raw timeline access.
 */

import { describe, it, expect } from 'vitest';
import { translateLocator, translateAction, buildTest } from '../src/generation/generators/playwright-generator';
import { playwrightGenerator } from '../src/generation/generators/playwright-generator';
import type { CanonicalStep } from '../src/generation/types';
import type {
  ExecutionJsonObject,
  ExecutionLocator,
} from '../src/generation/contracts/execution-json-types';

// ── Helpers ────────────────────────────────────────────────

function makeLocator(
  strategy: ExecutionLocator['strategy'],
  value: string,
  role: 'primary' | 'secondary' | 'fallback' = 'primary',
): ExecutionLocator {
  return { strategy, value, role };
}

function makeClickJson(overrides: Partial<ExecutionJsonObject> = {}): ExecutionJsonObject {
  return {
    action: { type: 'click', value: null },
    target: { kind: 'element', tag: 'button', name: 'Submit', role: 'button' },
    locators: [makeLocator('testId', 'submit-btn')],
    context: { iframe: false, shadowDom: false, frame: null },
    trace: { interactionId: 'evt-001', stepId: 'step-001' },
    meta: { status: 'generated', warnings: [], generatedAt: '2025-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

function makeNavJson(url: string): ExecutionJsonObject {
  return {
    action: { type: 'navigate', value: null },
    target: { kind: 'navigation', url },
    locators: [],
    context: { iframe: false, shadowDom: false, frame: null },
    trace: { interactionId: 'nav-001', stepId: 'step-002' },
    meta: { status: 'generated', warnings: [], generatedAt: '2025-01-01T00:00:00.000Z' },
  };
}

function makeStep(stepNumber: number, plainEnglish: string, json: ExecutionJsonObject | null): CanonicalStep {
  return {
    stepId: `step-${String(stepNumber).padStart(4, '0')}`,
    stepNumber,
    plainEnglish,
    actionType: json?.action.type || 'click',
    elementIdentity: {
      accessibleName: 'element',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      className: null,
      cssSelector: 'button',
      xPath: '//button',
      inIframe: false,
      shadowDom: false,
      elementId: 'elem-1',
    },
    aiEnrichment: null,
    aiConfidence: 0,
    linkedInteractionId: 'action-001',
    value: null,
    checked: null,
    executionJson: json,
    timestamp: '2025-01-01T00:00:00Z',
  };
}

// ── translateLocator ───────────────────────────────────────

describe('translateLocator', () => {
  it('translates testId to getByTestId', () => {
    expect(translateLocator(makeLocator('testId', 'submit-btn'))).toBe(
      "getByTestId('submit-btn')",
    );
  });

  it('translates dataCy to attribute selector', () => {
    expect(translateLocator(makeLocator('dataCy', 'login-button'))).toBe(
      "locator('[data-cy=\"login-button\"]')",
    );
  });

  it('translates ariaLabel to getByLabel', () => {
    expect(translateLocator(makeLocator('ariaLabel', 'Close dialog'))).toBe(
      "getByLabel('Close dialog')",
    );
  });

  it('translates id to #id selector', () => {
    expect(translateLocator(makeLocator('id', 'main-nav'))).toBe("locator('#main-nav')");
  });

  it('translates name to [name=] attribute selector', () => {
    expect(translateLocator(makeLocator('name', 'username'))).toBe(
      "locator('[name=\"username\"]')",
    );
  });

  it('translates text to getByText', () => {
    expect(translateLocator(makeLocator('text', 'Sign Up'))).toBe(
      "getByText('Sign Up')",
    );
  });

  it('translates placeholder to getByPlaceholder', () => {
    expect(translateLocator(makeLocator('placeholder', 'Enter email'))).toBe(
      "getByPlaceholder('Enter email')",
    );
  });

  it('translates alt to getByAltText', () => {
    expect(translateLocator(makeLocator('alt', 'Company logo'))).toBe(
      "getByAltText('Company logo')",
    );
  });

  it('translates title to getByTitle', () => {
    expect(translateLocator(makeLocator('title', 'Submit form'))).toBe(
      "getByTitle('Submit form')",
    );
  });

  it('translates css to locator()', () => {
    expect(translateLocator(makeLocator('css', '.btn-primary'))).toBe(
      "locator('.btn-primary')",
    );
  });

  it('translates xpath to locator(xpath=)', () => {
    expect(translateLocator(makeLocator('xpath', '//button[@id="go"]'))).toBe(
      "locator('xpath=//button[@id=\"go\"]')",
    );
  });

  it('escapes single quotes in locator values', () => {
    expect(translateLocator(makeLocator('text', "Bob's Burgers"))).toBe(
      "getByText('Bob\\'s Burgers')",
    );
  });

  it('translates ariaLabelledby to attribute selector', () => {
    expect(translateLocator(makeLocator('ariaLabelledby', 'label-1'))).toBe(
      "locator('[aria-labelledby=\"label-1\"]')",
    );
  });

  it('translates dataQa to attribute selector', () => {
    expect(translateLocator(makeLocator('dataQa', 'qa-btn'))).toBe(
      "locator('[data-qa=\"qa-btn\"]')",
    );
  });

  it('translates dataTest to attribute selector', () => {
    expect(translateLocator(makeLocator('dataTest', 'test-el'))).toBe(
      "locator('[data-test=\"test-el\"]')",
    );
  });

  it('translates dataAutomationId to attribute selector', () => {
    expect(translateLocator(makeLocator('dataAutomationId', 'auto-1'))).toBe(
      "locator('[data-automation-id=\"auto-1\"]')",
    );
  });
});

// ── translateAction ────────────────────────────────────────

describe('translateAction', () => {
  it('generates click action using primary locator', () => {
    const json = makeClickJson();
    const result = translateAction(json);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toContain('.click()');
    expect(result.statements[0]).toContain('getByTestId');
  });

  it('generates navigate action with page.goto', () => {
    const json = makeNavJson('https://example.com/results');
    const result = translateAction(json);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toBe("page.goto('https://example.com/results');");
  });

  it('generates hover action with .hover()', () => {
    const json = makeClickJson({
      action: { type: 'hover', value: null },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('.hover()');
  });

  it('generates type/fill action with .fill()', () => {
    const json = makeClickJson({
      action: { type: 'fill', value: 'hello@example.com' },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('.fill(');
    expect(result.statements[0]).toContain('hello@example.com');
  });

  it('generates select action with .selectOption()', () => {
    const json = makeClickJson({
      action: { type: 'select', value: 'Option A' },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('.selectOption(');
    expect(result.statements[0]).toContain('Option A');
  });

  it('wraps iframe action in frameLocator', () => {
    const json = makeClickJson({
      context: {
        iframe: true,
        shadowDom: false,
        frame: {
          frameIndex: 0,
          frameName: null,
          frameId: null,
          frameSelector: null,
          frameSrc: "",
          frameXPath: null,
          frameDepth: 0,
        },
      },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('frameLocator');
  });

  it('handles error steps with commented placeholder', () => {
    const json = makeClickJson({
      meta: { status: 'error', warnings: ['No valid locators'], generatedAt: '2025-01-01T00:00:00.000Z' },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('//');
    expect(result.statements[0]).toContain('Step generation failed');
  });

  it('handles click with no locators gracefully', () => {
    const json = makeClickJson({ locators: [] });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('no locators');
  });

  it('handles navigate with no URL gracefully', () => {
    const json = makeNavJson('');
    const result = translateAction(json);
    expect(result.statements[0]).toContain('no URL');
  });

  it('handles unknown action type gracefully', () => {
    const json = makeClickJson({
      action: { type: 'unknown_type' as never, value: null },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('Unknown action type');
  });
});

// ── buildTest ──────────────────────────────────────────────

describe('buildTest', () => {
  const recordingContext = { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' };

  it('produces valid test structure with import, test(), and closing brace', () => {
    const steps = [makeStep(1, 'Click "Search"', makeClickJson())];
    const code = buildTest(steps, 'Search Test', recordingContext);

    expect(code).toContain("import { test, expect } from '@playwright/test';");
    expect(code).toContain("test('Search Test', async ({ page }) => {");
    expect(code.trim().endsWith('});')).toBe(true);
  });

  it('includes recording context start URL as first navigation', () => {
    const steps = [makeStep(1, 'Click "Search"', makeClickJson())];
    const code = buildTest(steps, 'Search Test', recordingContext);

    expect(code).toContain("await page.goto('https://app.example.com')");
  });

  it('includes traceability comments for each step', () => {
    const steps = [
      makeStep(1, 'Click "Login"', makeClickJson()),
      makeStep(2, 'Navigate to Dashboard', makeNavJson('https://app.example.com/dashboard')),
    ];
    const code = buildTest(steps, 'Login Flow', recordingContext);

    expect(code).toContain('// Step 1: Click "Login"');
    expect(code).toContain('// Step 2: Navigate to Dashboard');
  });

  it('includes fallback locator comments', () => {
    const json = makeClickJson({
      locators: [
        makeLocator('testId', 'submit', 'primary'),
        makeLocator('css', '.btn-primary', 'fallback'),
      ],
    });
    const steps = [makeStep(1, 'Click "Submit"', json)];
    const code = buildTest(steps, 'Submit Test', recordingContext);

    expect(code).toContain('Fallback locators');
    expect(code).toContain('css=".btn-primary"');
  });

  it('handles steps with null executionJson', () => {
    const steps = [
      makeStep(1, 'Click "Search"', makeClickJson()),
      makeStep(2, 'Unknown action', null),
    ];
    const code = buildTest(steps, 'Test', recordingContext);

    expect(code).toContain('No Execution JSON');
  });

  it('handles empty steps gracefully', () => {
    const code = buildTest([], 'Empty Test', recordingContext);
    expect(code).toContain("test('Empty Test'");
    expect(code.trim().endsWith('});')).toBe(true);
  });

  it('includes expected result assertion comment when provided', () => {
    const steps = [makeStep(1, 'Click "Submit"', makeClickJson())];
    const code = buildTest(steps, 'Submit Test', recordingContext, 'Form submitted');

    expect(code).toContain('// Expected: Form submitted');
  });

  it('escapes single quotes in test case name', () => {
    const steps = [makeStep(1, 'Click "Go"', makeClickJson())];
    const code = buildTest(steps, "Bob's Test", recordingContext);

    expect(code).toContain("Bob\\'s Test");
  });

  it('produces multi-step workflow with click and navigation', () => {
    const steps = [
      makeStep(1, 'Click "Book Flight"', makeClickJson()),
      makeStep(2, 'Navigate to Flight Booking', makeNavJson('https://travel.example.com/book')),
      makeStep(3, 'Click "Search"', makeClickJson({
        locators: [makeLocator('ariaLabel', 'Search flights')],
      })),
      makeStep(4, 'Navigate to Search Results', makeNavJson('https://travel.example.com/results')),
    ];
    const code = buildTest(steps, 'Flight Booking', recordingContext);

    expect(code).toContain('.click()');
    expect(code).toContain("page.goto('https://travel.example.com/book')");
    expect(code).toContain("page.goto('https://travel.example.com/results')");
    expect(code).toContain('getByLabel');
  });
});

// ── Generator Contract ─────────────────────────────────────

describe('playwrightGenerator contract', () => {
  it('has correct name', () => {
    expect(playwrightGenerator.name).toBe('playwright-generator');
  });

  it('depends on execution-json-generator', () => {
    expect(playwrightGenerator.dependencies).toContain('execution-json-generator');
  });

  it('returns success for valid input', () => {
    const steps = [
      makeStep(1, 'Click "Search"', makeClickJson()),
    ];
    const result = playwrightGenerator.generate({
      steps,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Search Test',
    });

    expect(result.status).toBe('success');
    expect(result.output).not.toBeNull();
    expect(result.output!.testCode).toContain("test('Search Test'");
    expect(result.output!.isManualEdit).toBe(false);
  });

  it('returns failure for empty steps', () => {
    const result = playwrightGenerator.generate({
      steps: [],
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Empty',
    });

    expect(result.status).toBe('failure');
    expect(result.output).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  it('returns failure for null steps', () => {
    const result = playwrightGenerator.generate({
      steps: null as unknown as CanonicalStep[],
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Null',
    });

    expect(result.status).toBe('failure');
    expect(result.output).toBeNull();
  });

  it('sets generatedAt as valid ISO timestamp', () => {
    const result = playwrightGenerator.generate({
      steps: [makeStep(1, 'Click "Go"', makeClickJson())],
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Timestamp Test',
    });

    expect(result.output!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('uses default test name when not provided', () => {
    const result = playwrightGenerator.generate({
      steps: [makeStep(1, 'Click "Go"', makeClickJson())],
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: '',
    });

    expect(result.output!.testCode).toContain('test(');
  });

  it('does not throw for mixed steps with errors', () => {
    const steps = [
      makeStep(1, 'Click "Go"', makeClickJson()),
      makeStep(2, 'Failed step', makeClickJson({
        meta: { status: 'error', warnings: ['No locators'], generatedAt: '2025-01-01T00:00:00.000Z' },
        locators: [],
      })),
      makeStep(3, 'Navigate', makeNavJson('https://example.com')),
    ];
    const result = playwrightGenerator.generate({
      steps,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Mixed',
    });

    expect(result.status).toBe('success');
    expect(result.output!.testCode).toContain('Step generation failed');
  });
});

// ── Determinism ────────────────────────────────────────────

describe('determinism', () => {
  it('produces identical code for identical steps (excluding timestamp)', () => {
    const steps = [
      makeStep(1, 'Click "Search"', makeClickJson()),
      makeStep(2, 'Navigate to Results', makeNavJson('https://app.example.com/results')),
    ];
    const input = {
      steps,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Determinism Test',
    };

    const result1 = playwrightGenerator.generate(input);
    const result2 = playwrightGenerator.generate(input);

    // testCode must be identical
    expect(result1.output!.testCode).toBe(result2.output!.testCode);
  });

  it('produces different code for different locators', () => {
    const stepWithTestId = makeStep(1, 'Click "Go"', makeClickJson({
      locators: [makeLocator('testId', 'go-btn')],
    }));
    const stepWithAriaLabel = makeStep(1, 'Click "Go"', makeClickJson({
      locators: [makeLocator('ariaLabel', 'Go button')],
    }));

    const code1 = buildTest([stepWithTestId], 'Test', { startUrl: 'https://app.example.com' });
    const code2 = buildTest([stepWithAriaLabel], 'Test', { startUrl: 'https://app.example.com' });

    expect(code1).not.toBe(code2);
    expect(code1).toContain('getByTestId');
    expect(code2).toContain('getByLabel');
  });
});

// ── iframe & Shadow DOM ────────────────────────────────────

describe('iframe and shadow DOM context', () => {
  it('wraps click in frameLocator for iframe steps', () => {
    const json = makeClickJson({
      context: {
        iframe: true,
        shadowDom: false,
        frame: {
          frameIndex: 0,
          frameName: null,
          frameId: null,
          frameSelector: 'iframe#my-frame',
          frameSrc: "",
          frameXPath: null,
          frameDepth: 0,
        },
      },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain("frameLocator('iframe#my-frame')");
  });

  it('uses frame index when no selector/id/name', () => {
    const json = makeClickJson({
      context: {
        iframe: true,
        shadowDom: false,
        frame: {
          frameIndex: 2,
          frameName: null,
          frameId: null,
          frameSelector: null,
          frameSrc: "",
          frameXPath: null,
          frameDepth: 0,
        },
      },
    });
    const result = translateAction(json);
    expect(result.statements[0]).toContain('nth(2)');
  });

  it('generates regular code for shadow DOM steps (no special wrapping)', () => {
    // Shadow DOM is handled by the content script's composedPath() during recording;
    // the Playwright generator uses the resolved locator as-is.
    const json = makeClickJson({
      context: {
        iframe: false,
        shadowDom: true,
        frame: null,
      },
    });
    const result = translateAction(json);
    expect(result.statements[0]).not.toContain('frameLocator');
    expect(result.statements[0]).toContain('.click()');
  });
});

// ── End-to-End Generation Example ──────────────────────────

describe('end-to-end generation example', () => {
  it('generates complete test for flight booking workflow', () => {
    const steps: CanonicalStep[] = [
      makeStep(1, 'Click "Book Flight"', makeClickJson({
        target: { kind: 'element', tag: 'button', name: 'Book Flight', role: 'button' },
        locators: [makeLocator('text', 'Book Flight')],
      })),
      makeStep(2, 'Navigate to Flight Booking', makeNavJson('https://travel.example.com/book')),
      makeStep(3, 'Click "Search"', makeClickJson({
        target: { kind: 'element', tag: 'input', name: 'Search', role: 'button' },
        locators: [makeLocator('testId', 'search-btn')],
      })),
      makeStep(4, 'Navigate to Search Results', makeNavJson('https://travel.example.com/results')),
    ];

    const result = playwrightGenerator.generate({
      steps,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Flight Booking Flow',
      expectedResult: 'Search results displayed',
    });

    expect(result.status).toBe('success');
    const code = result.output!.testCode;

    // Verify structure
    expect(code).toContain("import { test, expect } from '@playwright/test';");
    expect(code).toContain("test('Flight Booking Flow', async ({ page }) => {");

    // Verify recording context
    expect(code).toContain("await page.goto('https://app.example.com')");

    // Verify traceability
    expect(code).toContain('// Step 1: Click "Book Flight"');
    expect(code).toContain('// Step 2: Navigate to Flight Booking');
    expect(code).toContain('// Step 3: Click "Search"');
    expect(code).toContain('// Step 4: Navigate to Search Results');

    // Verify actions
    expect(code).toContain("getByText('Book Flight').click()");
    expect(code).toContain("page.goto('https://travel.example.com/book')");
    expect(code).toContain("getByTestId('search-btn').click()");
    expect(code).toContain("page.goto('https://travel.example.com/results')");

    // Verify expected result
    expect(code).toContain('// Expected: Search results displayed');

    // Verify closing
    expect(code.trim().endsWith('});')).toBe(true);
  });
});
