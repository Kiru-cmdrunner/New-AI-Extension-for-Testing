/**
 * Text Entry Recording Tests — Milestone B6 Validation Fix
 *
 * Validates: text interaction type registration, plain English generation,
 * canonical step generation with value field, execution JSON action.type='fill',
 * Playwright generation with .fill() call, side panel rendering.
 */

import { describe, it, expect } from 'vitest';
import { getInteractionType, getRegisteredTypes } from '../src/recorder/interaction-types';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import { playwrightGenerator } from '../src/generation/generators/playwright-generator';
import type { SessionEvent, ClickEvent, NavigationEvent, ElementIdentity } from '../src/shared/types';
import type { CanonicalStep } from '../src/generation/types';

// ── Helpers ────────────────────────────────────────────────

function makeTextEvent(
  actionId: string,
  accessibleName: string,
  value: string,
  tag = 'INPUT',
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'textbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: 'Enter username',
    tag,
    name: accessibleName.toLowerCase().replace(/\s/g, '_'),
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: `input[name="${accessibleName.toLowerCase()}"]`,
    xPath: `//input[@name="${accessibleName.toLowerCase()}"]`,
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('text', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'text',
    elementIdentity: identity,
    value,
    timestamp: new Date().toISOString(),
  } as unknown as SessionEvent;
}

function makeClickEvent(
  actionId: string,
  accessibleName: string,
  attrs: Partial<ElementIdentity> = {},
): ClickEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'button',
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
    elementId: actionId.replace('click', 'elem'),
    ...attrs,
  };
  return { actionId, type: 'click', elementIdentity: identity, timestamp: new Date().toISOString() };
}

function makeNavEvent(actionId: string, url: string): NavigationEvent {
  return { actionId, type: 'navigation', timestamp: new Date().toISOString(), url, title: url };
}

// ── Interaction Type Registry ──────────────────────────────

describe('Text Entry Interaction Type', () => {
  it('registers text type', () => {
    expect(getRegisteredTypes()).toContain('text');
  });

  it('returns config for text type', () => {
    const config = getInteractionType('text');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('text');
    expect(config!.idPrefix).toBe('text');
    expect(config!.badgeLabel).toBe('Text');
  });

  it('generates plain English with value and field name', () => {
    const config = getInteractionType('text')!;
    const identity: ElementIdentity = {
      accessibleName: 'Username',
      tag: 'INPUT', ariaRole: 'textbox',
      ariaLabel: null, ariaLabelledBy: null, placeholder: null,
      name: 'username', stableId: null, testId: null,
      className: null,
      dataCy: null, dataQa: null, cssSelector: 'input', xPath: '//input',
      inIframe: false, shadowDom: false, elementId: 'elem-001',
    };
    const english = config.toPlainEnglish({
      identity,
      understanding: undefined,
      extras: { value: 'admin' },
    });
    expect(english).toBe('Enter "admin" into "Username"');
  });

  it('handles empty value', () => {
    const config = getInteractionType('text')!;
    const identity: ElementIdentity = {
      accessibleName: 'Password',
      tag: 'INPUT', ariaRole: null,
      ariaLabel: null, ariaLabelledBy: null, placeholder: 'Enter password',
      name: 'password', stableId: null, testId: null,
      className: null,
      dataCy: null, dataQa: null, cssSelector: 'input', xPath: '//input',
      inIframe: false, shadowDom: false, elementId: 'elem-002',
    };
    const english = config.toPlainEnglish({
      identity,
      understanding: undefined,
      extras: {},
    });
    expect(english).toBe('Enter text into "Password"');
  });

  it('uses AI business name when available', () => {
    const config = getInteractionType('text')!;
    const identity: ElementIdentity = {
      accessibleName: 'user',
      tag: 'INPUT', ariaRole: 'textbox',
      ariaLabel: null, ariaLabelledBy: null, placeholder: null,
      name: 'username', stableId: null, testId: null,
      className: null,
      dataCy: null, dataQa: null, cssSelector: 'input', xPath: '//input',
      inIframe: false, shadowDom: false, elementId: 'elem-003',
    };
    const english = config.toPlainEnglish({
      identity,
      understanding: {
        businessName: 'Username Field',
        controlType: 'Text Field',
        userIntent: 'Enter login username',
        confidenceScore: 0.95,
      },
      extras: { value: 'testuser' },
    });
    expect(english).toBe('Enter "testuser" into "Username Field"');
  });

  it('renders title with value', () => {
    const config = getInteractionType('text')!;
    const title = config.renderTitle({
      actionId: 'text-0001',
      type: 'text',
      timestamp: '2026-01-01T00:00:00Z',
      elementIdentity: {
        accessibleName: 'Username',
        tag: 'INPUT', ariaRole: 'textbox',
        ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        name: 'username', stableId: null, testId: null,
        className: null,
        dataCy: null, dataQa: null, cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-001',
      },
      value: 'admin',
    } as never);
    expect(title).toContain('Username');
    expect(title).toContain('admin');
  });
});

// ── Canonical Step Generation ──────────────────────────────

describe('Canonical Step Generation with Text Entry', () => {
  it('generates step with actionType=text', () => {
    const timeline: SessionEvent[] = [
      makeTextEvent('text-0001', 'Username', 'admin'),
    ];
    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'App', capturedAt: '2026-01-01T00:00:00Z' },
    });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('fill');
  });

  it('preserves the text value in the step', () => {
    const timeline: SessionEvent[] = [
      makeTextEvent('text-0001', 'Username', 'admin'),
    ];
    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'App', capturedAt: '2026-01-01T00:00:00Z' },
    });

    expect(result.output![0].value).toBe('admin');
  });

  it('generates plain English with value', () => {
    const timeline: SessionEvent[] = [
      makeTextEvent('text-0001', 'Password', 'secret123'),
    ];
    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'App', capturedAt: '2026-01-01T00:00:00Z' },
    });

    expect(result.output![0].plainEnglish).toContain('secret123');
    expect(result.output![0].plainEnglish).toContain('Password');
  });

  it('handles mixed click + text + navigation events', () => {
    const timeline: SessionEvent[] = [
      makeTextEvent('text-0001', 'Username', 'admin'),
      makeTextEvent('text-0002', 'Password', 'pass123'),
      makeClickEvent('click-0001', 'Login', { testId: 'login-btn' }),
      makeNavEvent('nav-0001', 'https://app.example.com/dashboard'),
    ];
    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'App', capturedAt: '2026-01-01T00:00:00Z' },
    });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(4);
    expect(result.output![0].actionType).toBe('fill');
    expect(result.output![0].value).toBe('admin');
    expect(result.output![1].actionType).toBe('fill');
    expect(result.output![1].value).toBe('pass123');
    expect(result.output![2].actionType).toBe('click');
    expect(result.output![2].value).toBeNull();
    expect(result.output![3].actionType).toBe('navigate');
    expect(result.output![3].value).toBeNull();
  });
});

// ── Execution JSON Generation ──────────────────────────────

describe('Execution JSON Generation with Text Entry', () => {
  it('maps text action to fill type', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-0001', stepNumber: 1, actionType: 'text',
        plainEnglish: 'Enter "admin" into "Username"',
        elementIdentity: {
          accessibleName: 'Username', tag: 'INPUT', ariaRole: 'textbox',
          ariaLabel: null, ariaLabelledBy: null, placeholder: 'Enter username',
          name: 'username', stableId: null, testId: null,
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'input[name="username"]', xPath: '//input[@name="username"]',
          inIframe: false, shadowDom: false, elementId: 'elem-001',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'text-0001', value: 'admin',
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
    ];

    const result = executionJsonGenerator.generate({ steps });
    expect(result.status).toBe('success');
    const json = result.output![0].executionJson!;
    expect(json.action.type).toBe('fill');
    expect(json.action.value).toBe('admin');
    expect(json.target.kind).toBe('element');
  });

  it('resolves locators for text fields', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-0001', stepNumber: 1, actionType: 'text',
        plainEnglish: 'Enter "pass" into "Password"',
        elementIdentity: {
          accessibleName: 'Password', tag: 'INPUT', ariaRole: null,
          ariaLabel: 'Password field', ariaLabelledBy: null, placeholder: 'Enter password',
          name: 'password', stableId: null, testId: 'password-field',
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'input#pass', xPath: '//input[@id="pass"]',
          inIframe: false, shadowDom: false, elementId: 'elem-002',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'text-0002', value: 'pass123',
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
    ];

    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;
    expect(json.action.type).toBe('fill');
    expect(json.action.value).toBe('pass123');
    // testId should be primary locator
    expect(json.locators.length).toBeGreaterThan(0);
    expect(json.locators.some((l) => l.strategy === 'testId' && l.value === 'password-field')).toBe(true);
  });
});

// ── Playwright Generation with Text Entry ──────────────────

describe('Playwright Generation with Text Entry', () => {
  it('generates .fill() call for text entries', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-0001', stepNumber: 1, actionType: 'text',
        plainEnglish: 'Enter "admin" into "Username"',
        elementIdentity: {
          accessibleName: 'Username', tag: 'INPUT', ariaRole: 'textbox',
          ariaLabel: null, ariaLabelledBy: null, placeholder: 'Enter username',
          name: 'username', stableId: null, testId: 'username-input',
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'input[name="username"]', xPath: '//input[@name="username"]',
          inIframe: false, shadowDom: false, elementId: 'elem-001',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'text-0001', value: 'admin',
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
    ];

    // First generate Execution JSON
    const jsonResult = executionJsonGenerator.generate({ steps });
    const stepsWithJson = jsonResult.output!;

    // Then generate Playwright
    const pwResult = playwrightGenerator.generate({
      steps: stepsWithJson,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Login Test',
    });

    expect(pwResult.status).toBe('success');
    expect(pwResult.output!.testCode).toContain('.fill(');
    expect(pwResult.output!.testCode).toContain('admin');
  });

  it('generates complete login workflow with text + click + navigation', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-0001', stepNumber: 1, actionType: 'text',
        plainEnglish: 'Enter "admin" into "Username"',
        elementIdentity: {
          accessibleName: 'Username', tag: 'INPUT', ariaRole: 'textbox',
          ariaLabel: null, ariaLabelledBy: null, placeholder: 'Username',
          name: 'username', stableId: null, testId: 'username',
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'input[name="username"]', xPath: '//input',
          inIframe: false, shadowDom: false, elementId: 'elem-001',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'text-0001', value: 'admin',
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
      {
        stepId: 'step-0002', stepNumber: 2, actionType: 'text',
        plainEnglish: 'Enter "pass123" into "Password"',
        elementIdentity: {
          accessibleName: 'Password', tag: 'INPUT', ariaRole: null,
          ariaLabel: null, ariaLabelledBy: null, placeholder: 'Password',
          name: 'password', stableId: null, testId: 'password',
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'input[name="password"]', xPath: '//input',
          inIframe: false, shadowDom: false, elementId: 'elem-002',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'text-0002', value: 'pass123',
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
      {
        stepId: 'step-0003', stepNumber: 3, actionType: 'click',
        plainEnglish: 'Click "Login"',
        elementIdentity: {
          accessibleName: 'Login', tag: 'BUTTON', ariaRole: 'button',
          ariaLabel: null, ariaLabelledBy: null, placeholder: null,
          name: null, stableId: null, testId: 'login-btn',
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'button', xPath: '//button',
          inIframe: false, shadowDom: false, elementId: 'elem-003',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'click-0001', value: null,
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
      {
        stepId: 'step-0004', stepNumber: 4, actionType: 'navigation',
        plainEnglish: 'Navigate to "https://app.example.com/dashboard"',
        elementIdentity: {
          accessibleName: 'https://app.example.com/dashboard', tag: 'NAVIGATION', ariaRole: null,
          ariaLabel: null, ariaLabelledBy: null, placeholder: null,
          name: null, stableId: null, testId: null,
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'body', xPath: '//body',
          inIframe: false, shadowDom: false, elementId: 'nav',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'nav-0001', value: null,
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
    ];

    // Generate Execution JSON
    const jsonResult = executionJsonGenerator.generate({ steps });
    const stepsWithJson = jsonResult.output!;

    // Verify all steps have execution JSON
    expect(stepsWithJson.every((s) => s.executionJson !== null)).toBe(true);
    expect(stepsWithJson[0].executionJson!.action.type).toBe('fill');
    expect(stepsWithJson[1].executionJson!.action.type).toBe('fill');
    expect(stepsWithJson[2].executionJson!.action.type).toBe('click');
    expect(stepsWithJson[3].executionJson!.action.type).toBe('navigate');

    // Generate Playwright
    const pwResult = playwrightGenerator.generate({
      steps: stepsWithJson,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Login Workflow',
    });

    expect(pwResult.status).toBe('success');
    const code = pwResult.output!.testCode;

    // Verify fill calls
    expect(code).toContain("getByTestId('username').fill('admin')");
    expect(code).toContain("getByTestId('password').fill('pass123')");

    // Verify click
    expect(code).toContain("getByTestId('login-btn').click()");

    // Verify navigation
    expect(code).toContain("page.goto('https://app.example.com/dashboard')");

    // Verify traceability
    expect(code).toContain('// Step 1: Enter "admin" into "Username"');
    expect(code).toContain('// Step 2: Enter "pass123" into "Password"');
    expect(code).toContain('// Step 3: Click "Login"');
    expect(code).toContain('// Step 4: Navigate to');
  });
});

// ── Full Pipeline Determinism ──────────────────────────────

describe('Text Entry Pipeline Determinism', () => {
  it('produces identical Playwright output for identical text entries', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-0001', stepNumber: 1, actionType: 'text',
        plainEnglish: 'Enter "admin" into "Username"',
        elementIdentity: {
          accessibleName: 'Username', tag: 'INPUT', ariaRole: 'textbox',
          ariaLabel: null, ariaLabelledBy: null, placeholder: 'Username',
          name: 'username', stableId: null, testId: 'username',
          className: null,
          dataCy: null, dataQa: null, cssSelector: 'input[name="username"]', xPath: '//input',
          inIframe: false, shadowDom: false, elementId: 'elem-001',
        },
        aiEnrichment: null, aiConfidence: 0,
        linkedInteractionId: 'text-0001', value: 'admin',
        checked: null,
        executionJson: null, timestamp: '2026-01-01T00:00:00Z',
      },
    ];

    const jsonResult1 = executionJsonGenerator.generate({ steps });
    const pw1 = playwrightGenerator.generate({
      steps: jsonResult1.output!,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Test',
    });

    const jsonResult2 = executionJsonGenerator.generate({ steps });
    const pw2 = playwrightGenerator.generate({
      steps: jsonResult2.output!,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Test',
    });

    expect(pw1.output!.testCode).toBe(pw2.output!.testCode);
  });
});
