/**
 * Checkbox & Radio Button Artifact Generation Tests — Milestone C4.3
 *
 * Tests the full generation pipeline for Checkbox and Radio interactions:
 *   Canonical Test Steps → Execution JSON → Playwright
 *
 * Permanently frozen C4.1 §5.2-§5.5:
 *   checkbox+checked=true  → action.type "check"   → .check()
 *   checkbox+checked=false → action.type "uncheck"  → .uncheck()
 *   radio                  → action.type "select"   → .check()
 */

import { describe, it, expect } from 'vitest';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import { playwrightGenerator } from '../src/generation/generators/playwright-generator';
import { translateAction } from '../src/generation/generators/playwright-generator';
import type { SessionEvent, ElementIdentity, RecordingContext } from '../src/shared/types';

// ── Test Helpers ──────────────────────────────────────────

const recordingContext: RecordingContext = {
  startUrl: 'https://example.com',
  startTitle: 'Example',
  capturedAt: '2026-07-16T00:00:00Z',
};

function makeCheckboxEvent(
  actionId: string,
  accessibleName: string,
  checked: boolean,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'checkbox',
    ariaLabel: accessibleName,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'input[type="checkbox"]',
    xPath: '//input[@type="checkbox"]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('check', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'checkbox',
    elementIdentity: identity,
    checked,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeRadioEvent(
  actionId: string,
  accessibleName: string,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'radio',
    ariaLabel: accessibleName,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'input[type="radio"]',
    xPath: '//input[@type="radio"]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('radio', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'radio',
    elementIdentity: identity,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeClickEvent(actionId: string, accessibleName: string): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'button',
    ariaLabel: accessibleName,
    ariaLabelledBy: null, placeholder: null,
    tag: 'BUTTON', name: null, stableId: null, testId: null,
    dataCy: null, dataQa: null,
    className: null,
    cssSelector: 'button', xPath: '//button',
    inIframe: false, shadowDom: false, elementId: actionId.replace('click', 'elem'),
  };
  return {
    actionId,
    type: 'click',
    elementIdentity: identity,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeNavEvent(actionId: string, url: string): SessionEvent {
  return {
    actionId,
    type: 'navigation',
    url,
    title: 'Page',
    timestamp: '2026-07-16T00:00:00Z',
  };
}

/**
 * Run the full pipeline: Timeline → Canonical Steps → Execution JSON → Playwright.
 * Returns the steps after each stage so tests can inspect intermediate output.
 */
function runFullPipeline(timeline: SessionEvent[], opts?: {
  testCaseName?: string;
  expectedResult?: string;
}) {
  // 1. Canonical Step Generation
  const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
  if (!canonicalResult.output) throw new Error('Canonical generation failed');

  // 2. Execution JSON Generation
  const execResult = executionJsonGenerator.generate({ steps: canonicalResult.output });
  if (!execResult.output) throw new Error('Execution JSON generation failed');

  // 3. Playwright Generation
  const playwrightResult = playwrightGenerator.generate({
    steps: execResult.output,
    recordingContext,
    testCaseName: opts?.testCaseName ?? 'Test Case',
    expectedResult: opts?.expectedResult,
  });

  return {
    canonicalSteps: canonicalResult.output,
    execSteps: execResult.output,
    playwright: playwrightResult.output?.testCode ?? '',
    playwrightOutput: playwrightResult.output,
  };
}

// ── Execution JSON: Checkbox Check ────────────────────────

describe('C4.3 — Execution JSON: Checkbox (checked=true)', () => {
  it('produces action.type = "check"', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.action.type).toBe('check');
  });

  it('action.value is null for check', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.action.value).toBeNull();
  });

  it('target has role "checkbox"', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.target.kind).toBe('element');
    expect(json.target.role).toBe('checkbox');
    expect(json.target.name).toBe('Remember Me');
  });

  it('locators are resolved', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true, {
        ariaLabel: 'Remember Me',
      }),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.locators.length).toBeGreaterThan(0);
    const primary = json.locators.find(l => l.role === 'primary');
    expect(primary).toBeDefined();
  });

  it('meta status is "generated"', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.meta.status).toBe('generated');
  });
});

// ── Execution JSON: Checkbox Uncheck ──────────────────────

describe('C4.3 — Execution JSON: Checkbox (checked=false)', () => {
  it('produces action.type = "uncheck"', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Subscribe', false),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.action.type).toBe('uncheck');
  });

  it('action.value is null for uncheck', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Subscribe', false),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.action.value).toBeNull();
  });

  it('canonical step shows "Uncheck"', () => {
    const { canonicalSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Subscribe', false),
    ]);
    expect(canonicalSteps[0].plainEnglish).toBe('Uncheck the Subscribe');
  });
});

// ── Execution JSON: Radio Select ──────────────────────────

describe('C4.3 — Execution JSON: Radio', () => {
  it('produces action.type = "select"', () => {
    const { execSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express Delivery'),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.action.type).toBe('select');
  });

  it('target has role "radio"', () => {
    const { execSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express Delivery'),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.target.role).toBe('radio');
  });

  it('action.value is null for radio', () => {
    const { execSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express Delivery'),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.action.value).toBeNull();
  });

  it('canonical step shows "Select"', () => {
    const { canonicalSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express Delivery'),
    ]);
    expect(canonicalSteps[0].plainEnglish).toBe("Select 'Express Delivery'");
  });
});

// ── Playwright Generation ─────────────────────────────────

describe('C4.3 — Playwright: Checkbox Check', () => {
  it('generates .check() for checked=true', () => {
    const { playwright } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true, {
        ariaLabel: 'Remember Me',
      }),
    ]);
    expect(playwright).toContain('.check()');
    expect(playwright).not.toContain('.click()');
    expect(playwright).not.toContain('.uncheck()');
  });

  it('uses getByLabel locator when ariaLabel present', () => {
    const { playwright } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true, {
        ariaLabel: 'Remember Me',
      }),
    ]);
    expect(playwright).toContain("getByLabel('Remember Me')");
  });
});

describe('C4.3 — Playwright: Checkbox Uncheck', () => {
  it('generates .uncheck() for checked=false', () => {
    const { playwright } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Subscribe', false, {
        ariaLabel: 'Subscribe',
      }),
    ]);
    expect(playwright).toContain('.uncheck()');
    expect(playwright).not.toContain('.check()');
    expect(playwright).not.toContain('.click()');
  });
});

describe('C4.3 — Playwright: Radio Select', () => {
  it('generates .check() for radio (not .selectOption())', () => {
    const { playwright } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express Delivery', {
        ariaLabel: 'Express Delivery',
      }),
    ]);
    expect(playwright).toContain('.check()');
    expect(playwright).not.toContain('.selectOption(');
    expect(playwright).not.toContain('.click()');
  });

  it('uses getByLabel locator for radio', () => {
    const { playwright } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express Delivery', {
        ariaLabel: 'Express Delivery',
      }),
    ]);
    expect(playwright).toContain("getByLabel('Express Delivery')");
  });
});

// ── Dropdown <select> vs Radio <select> Disambiguation ────

describe('C4.3 — Dropdown vs Radio: "select" action type', () => {
  it('radio select uses .check(), not .selectOption()', () => {
    const { execSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Credit Card', {
        ariaLabel: 'Credit Card',
      }),
    ]);
    const json = execSteps[0].executionJson!;

    // Verify action.type is "select"
    expect(json.action.type).toBe('select');

    // Verify target role is "radio" — this is the signal for Playwright
    expect(json.target.role).toBe('radio');

    // Use translateAction directly to verify .check() is produced
    const translation = translateAction(json);
    expect(translation.statements[0]).toContain('.check()');
    expect(translation.statements[0]).not.toContain('.selectOption(');
  });
});

// ── Canonical Step checked field propagation ──────────────

describe('C4.3 — checked field propagation', () => {
  it('CanonicalStep.checked is true for checked checkbox', () => {
    const { canonicalSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    expect(canonicalSteps[0].checked).toBe(true);
  });

  it('CanonicalStep.checked is false for unchecked checkbox', () => {
    const { canonicalSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Subscribe', false),
    ]);
    expect(canonicalSteps[0].checked).toBe(false);
  });

  it('CanonicalStep.checked is null for non-checkbox events', () => {
    const { canonicalSteps } = runFullPipeline([
      makeClickEvent('click-0001', 'Submit'),
    ]);
    expect(canonicalSteps[0].checked).toBeNull();
  });

  it('CanonicalStep.checked is null for radio events', () => {
    const { canonicalSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express'),
    ]);
    // Radio doesn't have a checked field — it's always "select"
    expect(canonicalSteps[0].checked).toBeNull();
  });
});

// ── Full Pipeline: Mixed Interaction Types ────────────────

describe('C4.3 — Full Pipeline: Mixed interactions', () => {
  it('Check → Click → Navigate generates all three correctly', () => {
    const { canonicalSteps, execSteps, playwright } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true, {
        ariaLabel: 'Remember Me',
      }),
      makeClickEvent('click-0001', 'Login', ),
      makeNavEvent('nav-0001', 'https://example.com/dashboard'),
    ]);

    // Canonical
    expect(canonicalSteps).toHaveLength(3);
    expect(canonicalSteps[0].plainEnglish).toBe('Check the Remember Me');
    expect(canonicalSteps[1].plainEnglish).toBe('Click the Login');
    expect(canonicalSteps[2].plainEnglish).toBe('Navigate to https://example.com/dashboard');

    // Execution JSON
    expect(execSteps[0].executionJson!.action.type).toBe('check');
    expect(execSteps[1].executionJson!.action.type).toBe('click');
    expect(execSteps[2].executionJson!.action.type).toBe('navigate');

    // Playwright
    expect(playwright).toContain('.check()');
    expect(playwright).toContain('.click()');
    expect(playwright).toContain('page.goto(');
  });

  it('Radio → Click → Navigate', () => {
    const { canonicalSteps, execSteps, playwright } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express', { ariaLabel: 'Express' }),
      makeClickEvent('click-0001', 'Continue'),
      makeNavEvent('nav-0001', 'https://example.com/checkout'),
    ]);

    expect(canonicalSteps).toHaveLength(3);
    expect(canonicalSteps[0].plainEnglish).toBe("Select 'Express'");
    expect(execSteps[0].executionJson!.action.type).toBe('select');
    expect(execSteps[1].executionJson!.action.type).toBe('click');
    expect(execSteps[2].executionJson!.action.type).toBe('navigate');

    expect(playwright).toContain('.check()');
    expect(playwright).toContain('.click()');
    expect(playwright).toContain('page.goto(');
  });

  it('Check → Uncheck → Recheck (rapid toggle)', () => {
    const { canonicalSteps, execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Option A', true),
      makeCheckboxEvent('check-0002', 'Option A', false),
      makeCheckboxEvent('check-0003', 'Option A', true),
    ]);

    expect(canonicalSteps).toHaveLength(3);
    expect(canonicalSteps[0].plainEnglish).toBe('Check the Option A');
    expect(canonicalSteps[1].plainEnglish).toBe('Uncheck the Option A');
    expect(canonicalSteps[2].plainEnglish).toBe('Check the Option A');

    // Execution JSON alternates check/uncheck/check
    expect(execSteps[0].executionJson!.action.type).toBe('check');
    expect(execSteps[1].executionJson!.action.type).toBe('uncheck');
    expect(execSteps[2].executionJson!.action.type).toBe('check');
  });

  it('Multiple radio selections in same group', () => {
    const { canonicalSteps, execSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Standard'),
      makeRadioEvent('radio-0002', 'Express'),
      makeRadioEvent('radio-0003', 'Express Plus'),
    ]);

    expect(canonicalSteps).toHaveLength(3);
    expect(canonicalSteps[0].plainEnglish).toBe("Select 'Standard'");
    expect(canonicalSteps[1].plainEnglish).toBe("Select 'Express'");
    expect(canonicalSteps[2].plainEnglish).toBe("Select 'Express Plus'");

    expect(execSteps[0].executionJson!.action.type).toBe('select');
    expect(execSteps[1].executionJson!.action.type).toBe('select');
    expect(execSteps[2].executionJson!.action.type).toBe('select');
  });
});

// ── Execution JSON Contract Integrity ─────────────────────

describe('C4.3 — Execution JSON Contract Integrity', () => {
  it('checkbox JSON has all 6 contract sections', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;

    expect(json).toHaveProperty('action');
    expect(json).toHaveProperty('target');
    expect(json).toHaveProperty('locators');
    expect(json).toHaveProperty('context');
    expect(json).toHaveProperty('trace');
    expect(json).toHaveProperty('meta');
  });

  it('radio JSON has all 6 contract sections', () => {
    const { execSteps } = runFullPipeline([
      makeRadioEvent('radio-0001', 'Express'),
    ]);
    const json = execSteps[0].executionJson!;

    expect(json).toHaveProperty('action');
    expect(json).toHaveProperty('target');
    expect(json).toHaveProperty('locators');
    expect(json).toHaveProperty('context');
    expect(json).toHaveProperty('trace');
    expect(json).toHaveProperty('meta');
  });

  it('trace section has correct interactionId', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.trace.interactionId).toBe('check-0001');
    expect(json.trace.stepId).toMatch(/^step-/);
  });

  it('context section has iframe=false for non-iframe element', () => {
    const { execSteps } = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ]);
    const json = execSteps[0].executionJson!;
    expect(json.context.iframe).toBe(false);
    expect(json.context.shadowDom).toBe(false);
  });
});

// ── Regression: Existing Types Unaffected ─────────────────

describe('C4.3 — Regression: Existing Types Unaffected', () => {
  it('click execution JSON action.type is still "click"', () => {
    const { execSteps } = runFullPipeline([
      makeClickEvent('click-0001', 'Submit'),
    ]);
    expect(execSteps[0].executionJson!.action.type).toBe('click');
  });

  it('click Playwright still uses .click()', () => {
    const { playwright } = runFullPipeline([
      makeClickEvent('click-0001', 'Submit', ),
    ]);
    expect(playwright).toContain('.click()');
    expect(playwright).not.toContain('.check()');
    expect(playwright).not.toContain('.uncheck()');
  });

  it('click checked field is null', () => {
    const { canonicalSteps } = runFullPipeline([
      makeClickEvent('click-0001', 'Submit'),
    ]);
    expect(canonicalSteps[0].checked).toBeNull();
  });

  it('navigation execution JSON action.type is still "navigate"', () => {
    const { execSteps } = runFullPipeline([
      makeNavEvent('nav-0001', 'https://example.com'),
    ]);
    expect(execSteps[0].executionJson!.action.type).toBe('navigate');
  });

  it('navigation Playwright still uses page.goto()', () => {
    const { playwright } = runFullPipeline([
      makeNavEvent('nav-0001', 'https://example.com'),
    ]);
    expect(playwright).toContain('page.goto(');
  });
});

// ── Playwright Determinism ────────────────────────────────

describe('C4.3 — Playwright Determinism', () => {
  it('same input produces identical Playwright (modulo timestamp)', () => {
    const timeline: SessionEvent[] = [
      makeCheckboxEvent('check-0001', 'Remember Me', true, {
        ariaLabel: 'Remember Me',
      }),
    ];

    // Run pipeline twice
    const result1 = runFullPipeline(timeline);
    const result2 = runFullPipeline(timeline);

    // The actual Playwright statements should be identical
    expect(result1.playwright).toContain(result2.playwright.split('\n').find(l => l.includes('.check()')) || '');
    expect(result2.playwright).toContain(result1.playwright.split('\n').find(l => l.includes('.check()')) || '');
  });

  it('check and uncheck on same element produce different Playwright', () => {
    const checkResult = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Option', true, { ariaLabel: 'Option' }),
    ]);
    const uncheckResult = runFullPipeline([
      makeCheckboxEvent('check-0001', 'Option', false, { ariaLabel: 'Option' }),
    ]);

    expect(checkResult.playwright).toContain('.check()');
    expect(uncheckResult.playwright).toContain('.uncheck()');
    expect(checkResult.playwright).not.toEqual(uncheckResult.playwright);
  });
});
