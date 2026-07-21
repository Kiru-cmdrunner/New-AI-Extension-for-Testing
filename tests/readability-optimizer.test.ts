/**
 * Tests for the Readability Optimizer (B7.2).
 *
 * B7.1 §4.2: OR-1 — Focus-Click + Text-Entry Merge
 * B7.2 Design Clarifications: Merge Eligibility Principle, Same Element Detection
 *
 * Tests cover:
 *   - OR-1 merge fires when ALL conditions met
 *   - OR-1 does NOT fire when any condition fails
 *   - Same element detection (Decision 1)
 *   - Merge eligibility conditions (Decision 2: C1-C4)
 *   - Step ID preservation
 *   - Step number renumbering
 *   - Execution field preservation
 *   - Determinism
 *   - Integration with pipeline (Execution JSON + Playwright)
 */

import { describe, it, expect } from 'vitest';
import {
  isSameElement,
  isInputElement,
  applyReadabilityRules,
} from '../src/generation/engine/readability-optimizer';
import type { CanonicalStep } from '../src/generation/types';
import type { ElementIdentity } from '../src/shared/types';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import { playwrightGenerator } from '../src/generation/generators/playwright-generator';

// ── Test Helpers ───────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Field',
    ariaRole: 'textbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'input[name="test"]',
    xPath: '//input[@name="test"]',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-test',
    ...overrides,
  };
}

function makeClickStep(
  id: string,
  stepNum: number,
  identity: ElementIdentity,
): CanonicalStep {
  return {
    stepId: id,
    stepNumber: stepNum,
    actionType: 'click',
    plainEnglish: `Click "${identity.accessibleName}"`,
    elementIdentity: identity,
    aiEnrichment: null,
    aiConfidence: 0,
    linkedInteractionId: `click-${id}`,
    value: null,
    checked: null,
executionJson: null,
    timestamp: '2026-07-15T00:00:00Z',
  };
}

function makeTextStep(
  id: string,
  stepNum: number,
  identity: ElementIdentity,
  value: string,
): CanonicalStep {
  return {
    stepId: id,
    stepNumber: stepNum,
    actionType: 'fill',
    plainEnglish: `Enter '${value}' in the ${identity.accessibleName}`,
    elementIdentity: identity,
    aiEnrichment: null,
    aiConfidence: 0,
    linkedInteractionId: `text-${id}`,
    value,
    checked: null,
executionJson: null,
    timestamp: '2026-07-15T00:00:00Z',
  };
}

function makeNavStep(
  id: string,
  stepNum: number,
  url: string,
): CanonicalStep {
  return {
    stepId: id,
    stepNumber: stepNum,
    actionType: 'navigation',
    plainEnglish: `Navigate to "${url}"`,
    elementIdentity: makeIdentity({
      tag: 'NAVIGATION',
      accessibleName: url,
      className: null,
      cssSelector: 'body',
    }),
    aiEnrichment: null,
    aiConfidence: 1.0,
    linkedInteractionId: `nav-${id}`,
    value: null,
    checked: null,
executionJson: null,
    timestamp: '2026-07-15T00:00:00Z',
  };
}

// ── Decision 1: Same Element Detection ─────────────────────

describe('isSameElement — Decision 1: Same Element Detection', () => {
  it('returns true for identical identities (same tag, stableId, cssSelector)', () => {
    const a = makeIdentity({ tag: 'INPUT', stableId: 'username', cssSelector: '#username' });
    const b = makeIdentity({ tag: 'INPUT', stableId: 'username', cssSelector: '#username' });
    expect(isSameElement(a, b)).toBe(true);
  });

  it('returns true when both have null stableId but same tag and cssSelector', () => {
    const a = makeIdentity({ tag: 'INPUT', stableId: null, cssSelector: 'input[name="user"]' });
    const b = makeIdentity({ tag: 'INPUT', stableId: null, cssSelector: 'input[name="user"]' });
    expect(isSameElement(a, b)).toBe(true);
  });

  it('returns false when tag differs', () => {
    const a = makeIdentity({ tag: 'INPUT', cssSelector: '#username' });
    const b = makeIdentity({ tag: 'TEXTAREA', cssSelector: '#username' });
    expect(isSameElement(a, b)).toBe(false);
  });

  it('returns false when cssSelector differs', () => {
    const a = makeIdentity({ tag: 'INPUT', cssSelector: '#username' });
    const b = makeIdentity({ tag: 'INPUT', cssSelector: '#password' });
    expect(isSameElement(a, b)).toBe(false);
  });

  it('returns false when stableId differs (one has id, other does not)', () => {
    const a = makeIdentity({ tag: 'INPUT', stableId: 'username', cssSelector: '#username' });
    const b = makeIdentity({ tag: 'INPUT', stableId: null, cssSelector: '#username' });
    expect(isSameElement(a, b)).toBe(false);
  });

  it('returns false for completely different elements', () => {
    const a = makeIdentity({ tag: 'INPUT', cssSelector: '#username' });
    const b = makeIdentity({ tag: 'BUTTON', cssSelector: 'button[type="submit"]' });
    expect(isSameElement(a, b)).toBe(false);
  });
});

// ── isInputElement ─────────────────────────────────────────

describe('isInputElement — Condition C4', () => {
  it('returns true for INPUT', () => {
    expect(isInputElement('INPUT')).toBe(true);
  });

  it('returns true for TEXTAREA', () => {
    expect(isInputElement('TEXTAREA')).toBe(true);
  });

  it('returns true for SELECT', () => {
    expect(isInputElement('SELECT')).toBe(true);
  });

  it('returns true for lowercase input', () => {
    expect(isInputElement('input')).toBe(true);
  });

  it('returns false for BUTTON', () => {
    expect(isInputElement('BUTTON')).toBe(false);
  });

  it('returns false for A (link)', () => {
    expect(isInputElement('A')).toBe(false);
  });

  it('returns false for DIV', () => {
    expect(isInputElement('DIV')).toBe(false);
  });

  it('returns false for NAVIGATION', () => {
    expect(isInputElement('NAVIGATION')).toBe(false);
  });
});

// ── OR-1: Merge Fires When All Conditions Met ──────────────

describe('OR-1 — Merge fires when all conditions are satisfied', () => {
  it('merges click+text on same INPUT element when adjacent', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'Admin'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(1);
    expect(result[0].actionType).toBe('fill');
    expect(result[0].value).toBe('Admin');
    expect(result[0].plainEnglish).toBe("Enter 'Admin' in the Username");
    expect(result[0].stepId).toBe('step-0002'); // Primary action's ID retained
    expect(result[0].stepNumber).toBe(1); // Renumbered
  });

  it('merges multiple click+text pairs in a login form', () => {
    const usernameId = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username' });
    const passwordId = makeIdentity({ tag: 'INPUT', cssSelector: '#password', accessibleName: 'Password' });
    const loginBtn = makeIdentity({ tag: 'BUTTON', cssSelector: 'button[type="submit"]', accessibleName: 'Login' });

    const steps: CanonicalStep[] = [
      makeClickStep('step-0001', 1, usernameId),
      makeTextStep('step-0002', 2, usernameId, 'Admin'),
      makeClickStep('step-0003', 3, passwordId),
      makeTextStep('step-0004', 4, passwordId, 'admin123'),
      makeClickStep('step-0005', 5, loginBtn),
      makeNavStep('step-0006', 6, 'https://app.com/dashboard'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(4);
    expect(result[0].actionType).toBe('fill');
    expect(result[0].value).toBe('Admin');
    expect(result[0].stepNumber).toBe(1);
    expect(result[1].actionType).toBe('fill');
    expect(result[1].value).toBe('admin123');
    expect(result[1].stepNumber).toBe(2);
    expect(result[2].actionType).toBe('click');
    expect(result[2].plainEnglish).toBe('Click "Login"');
    expect(result[2].stepNumber).toBe(3);
    expect(result[3].actionType).toBe('navigation');
    expect(result[3].stepNumber).toBe(4);
  });

  it('merges click+text on TEXTAREA element', () => {
    const identity = makeIdentity({ tag: 'TEXTAREA', cssSelector: '#notes', accessibleName: 'Notes' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'Hello world'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(1);
    expect(result[0].actionType).toBe('fill');
    expect(result[0].value).toBe('Hello world');
  });

  it('merges click+text on SELECT element', () => {
    const identity = makeIdentity({ tag: 'SELECT', cssSelector: '#country', accessibleName: 'Country' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'USA'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(1);
    expect(result[0].actionType).toBe('fill');
  });

  it('merges click+text when both have null stableId (no id attribute)', () => {
    const identity = makeIdentity({
      tag: 'INPUT',
      stableId: null,
      className: null,
      cssSelector: 'form > input:nth-of-type(1)',
      accessibleName: 'Search',
    });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'test query'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('test query');
  });
});

// ── OR-1: Merge Does NOT Fire ──────────────────────────────

describe('OR-1 — Merge does NOT fire when eligibility fails', () => {
  it('does NOT merge when click target is a BUTTON (C4 fails)', () => {
    const btnId = makeIdentity({ tag: 'BUTTON', cssSelector: '#login', accessibleName: 'Login' });
    const steps = [
      makeClickStep('step-0001', 1, btnId),
      makeTextStep('step-0002', 2, btnId, 'irrelevant'),
    ];

    const result = applyReadabilityRules(steps);

    // Button clicks are meaningful actions, not focus clicks
    expect(result).toHaveLength(2);
    expect(result[0].actionType).toBe('click');
    expect(result[1].actionType).toBe('fill');
  });

  it('does NOT merge when click and text target different elements (D1 fails)', () => {
    const usernameId = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username' });
    const passwordId = makeIdentity({ tag: 'INPUT', cssSelector: '#password', accessibleName: 'Password' });
    const steps = [
      makeClickStep('step-0001', 1, usernameId),
      makeTextStep('step-0002', 2, passwordId, 'admin123'),
    ];

    const result = applyReadabilityRules(steps);

    // User clicked Username field but typed in Password — not a focus+type pair
    expect(result).toHaveLength(2);
  });

  it('does NOT merge when click and text are NOT adjacent (C3 fails — intervening steps)', () => {
    const searchId = makeIdentity({ tag: 'INPUT', cssSelector: '#search', accessibleName: 'Search' });
    const otherId = makeIdentity({ tag: 'INPUT', cssSelector: '#filter', accessibleName: 'Filter' });

    const steps: CanonicalStep[] = [
      makeClickStep('step-0001', 1, searchId),
      makeTextStep('step-0002', 2, otherId, 'active'), // intervening: text on different element
      makeTextStep('step-0003', 3, searchId, 'John'), // same element as click, but NOT adjacent
    ];

    const result = applyReadabilityRules(steps);

    // The click on search is not adjacent to the text on search — intervening step exists
    expect(result).toHaveLength(3);
  });

  it('does NOT merge when navigation intervenes between click and text (C3 fails)', () => {
    const usernameId = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username' });

    const steps: CanonicalStep[] = [
      makeClickStep('step-0001', 1, usernameId),
      makeNavStep('step-0002', 2, 'https://other-page.com'),
      makeTextStep('step-0003', 3, usernameId, 'Admin'),
    ];

    const result = applyReadabilityRules(steps);

    // Navigation changed execution context — not the same interaction sequence
    expect(result).toHaveLength(3);
  });

  it('does NOT merge click+click (C2 fails — next is not text)', () => {
    const btnId = makeIdentity({ tag: 'BUTTON', cssSelector: '#btn', accessibleName: 'Button' });
    const steps = [
      makeClickStep('step-0001', 1, btnId),
      makeClickStep('step-0002', 2, btnId),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(2);
  });

  it('does NOT merge text+text (OR-2 constraint — each text entry is independent)', () => {
    const field1 = makeIdentity({ tag: 'INPUT', cssSelector: '#field1', accessibleName: 'Field 1' });
    const field2 = makeIdentity({ tag: 'INPUT', cssSelector: '#field2', accessibleName: 'Field 2' });

    const steps = [
      makeTextStep('step-0001', 1, field1, 'value1'),
      makeTextStep('step-0002', 2, field2, 'value2'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(2);
  });

  it('does NOT merge when 20 intervening interactions exist between same-element click+text', () => {
    const searchId = makeIdentity({ tag: 'INPUT', cssSelector: '#search', accessibleName: 'Search' });

    const steps: CanonicalStep[] = [makeClickStep('step-0001', 1, searchId)];

    // Add 20 intervening text steps on different elements
    for (let i = 0; i < 20; i++) {
      const otherId = makeIdentity({
        tag: 'INPUT',
        className: null,
        cssSelector: `#field-${i}`,
        accessibleName: `Field ${i}`,
      });
      steps.push(makeTextStep(`step-${String(i + 2).padStart(4, '0')}`, i + 2, otherId, `val${i}`));
    }

    // Finally, text on the original search element
    steps.push(makeTextStep('step-0022', 22, searchId, 'John'));

    const result = applyReadabilityRules(steps);

    // Click and text are on same element but NOT adjacent — no merge
    expect(result).toHaveLength(22);
  });
});

// ── Identity Preservation ──────────────────────────────────

describe('Identity Preservation', () => {
  it('preserves text step ID after merge (stepId is permanent identity)', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#username' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'Admin'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result[0].stepId).toBe('step-0002');
  });

  it('renumbers steps contiguously after merges', () => {
    const usernameId = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username' });
    const passwordId = makeIdentity({ tag: 'INPUT', cssSelector: '#password', accessibleName: 'Password' });
    const loginBtn = makeIdentity({ tag: 'BUTTON', cssSelector: '#login', accessibleName: 'Login' });

    const steps = [
      makeClickStep('step-0001', 1, usernameId),
      makeTextStep('step-0002', 2, usernameId, 'Admin'),
      makeClickStep('step-0003', 3, passwordId),
      makeTextStep('step-0004', 4, passwordId, 'pass'),
      makeClickStep('step-0005', 5, loginBtn),
    ];

    const result = applyReadabilityRules(steps);

    // 5 steps → 3 after 2 merges
    expect(result).toHaveLength(3);
    expect(result[0].stepNumber).toBe(1);
    expect(result[1].stepNumber).toBe(2);
    expect(result[2].stepNumber).toBe(3);
  });

  it('preserves elementIdentity after merge (no field modified)', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#email', stableId: 'email', accessibleName: 'Email' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'test@test.com'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result[0].elementIdentity).toEqual(identity);
  });

  it('preserves linkedInteractionId from the text entry (traceability)', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#phone' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, '555-1234'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result[0].linkedInteractionId).toBe('text-step-0002');
  });

  it('preserves value field (execution data)', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#address' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, '123 Main St'),
    ];

    const result = applyReadabilityRules(steps);

    expect(result[0].value).toBe('123 Main St');
  });

  it('preserves aiEnrichment and aiConfidence from text step', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#code' });
    const textStep = makeTextStep('step-0002', 2, identity, 'ABC123');
    textStep.aiConfidence = 0.95;
    textStep.aiEnrichment = {
      businessName: 'Product Code',
      elementType: 'input',
      userIntent: 'enter product identifier',
      confidenceScore: 0.95,
    } as unknown as CanonicalStep['aiEnrichment'];

    const steps = [makeClickStep('step-0001', 1, identity), textStep];
    const result = applyReadabilityRules(steps);

    expect(result[0].aiConfidence).toBe(0.95);
    expect(result[0].aiEnrichment).toEqual(textStep.aiEnrichment);
  });
});

// ── Edge Cases ─────────────────────────────────────────────

describe('Edge Cases', () => {
  it('handles empty step array', () => {
    const result = applyReadabilityRules([]);
    expect(result).toEqual([]);
  });

  it('handles single step (no possible merge)', () => {
    const identity = makeIdentity();
    const steps = [makeClickStep('step-0001', 1, identity)];
    const result = applyReadabilityRules(steps);
    expect(result).toHaveLength(1);
    expect(result[0].stepNumber).toBe(1);
  });

  it('handles steps with no merge opportunities (all standalone clicks)', () => {
    const steps = [
      makeClickStep('step-0001', 1, makeIdentity({ tag: 'BUTTON', cssSelector: '#btn1' })),
      makeClickStep('step-0002', 2, makeIdentity({ tag: 'BUTTON', cssSelector: '#btn2' })),
      makeClickStep('step-0003', 3, makeIdentity({ tag: 'BUTTON', cssSelector: '#btn3' })),
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(3);
    expect(result[0].stepNumber).toBe(1);
    expect(result[1].stepNumber).toBe(2);
    expect(result[2].stepNumber).toBe(3);
  });

  it('handles chain of click+text on same element (repeated edits)', () => {
    // User clicks field, types, then clicks same field again and types again
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#search' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'first'),
      makeClickStep('step-0003', 3, identity),
      makeTextStep('step-0004', 4, identity, 'second'),
    ];

    const result = applyReadabilityRules(steps);

    // Both pairs merge independently
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('first');
    expect(result[1].value).toBe('second');
  });

  it('does NOT merge click on INPUT followed by text on different INPUT (Tab navigation)', () => {
    const usernameId = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username' });
    const passwordId = makeIdentity({ tag: 'INPUT', cssSelector: '#password', accessibleName: 'Password' });

    const steps = [
      makeClickStep('step-0001', 1, usernameId),
      makeTextStep('step-0002', 2, passwordId, 'admin123'), // user used Tab to switch fields
    ];

    const result = applyReadabilityRules(steps);

    expect(result).toHaveLength(2);
  });
});

// ── Determinism ────────────────────────────────────────────

describe('Determinism', () => {
  it('produces identical output for identical input (run twice)', () => {
    const identity = makeIdentity({ tag: 'INPUT', cssSelector: '#field' });
    const steps = [
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'test'),
      makeClickStep('step-0003', 3, makeIdentity({ tag: 'BUTTON', cssSelector: '#submit' })),
    ];

    const result1 = applyReadabilityRules(steps);
    const result2 = applyReadabilityRules(steps);

    expect(result1).toEqual(result2);
  });
});

// ── Pipeline Integration ───────────────────────────────────

describe('Pipeline Integration — Optimized steps feed downstream generators', () => {
  it('optimized steps produce correct Execution JSON (fill action, not click)', () => {
    const identity = makeIdentity({
      tag: 'INPUT',
      className: null,
      cssSelector: '#username',
      accessibleName: 'Username',
      name: 'username',
    });

    // Simulate what the Canonical Step Generator produces AFTER optimization
    const optimized = applyReadabilityRules([
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'Admin'),
    ]);

    expect(optimized).toHaveLength(1);

    // Feed to Execution JSON Generator
    const jsonResult = executionJsonGenerator.generate({ steps: optimized });
    expect(jsonResult.status).toBe('success');
    expect(jsonResult.output).toHaveLength(1);

    const json = jsonResult.output![0].executionJson!;
    expect(json.action.type).toBe('fill');
    expect(json.action.value).toBe('Admin');
  });

  it('optimized steps produce correct Playwright (.fill, not redundant .click)', () => {
    const identity = makeIdentity({
      tag: 'INPUT',
      className: null,
      cssSelector: '#username',
      accessibleName: 'Username',
      name: 'username',
    });
    const loginBtn = makeIdentity({
      tag: 'BUTTON',
      className: null,
      cssSelector: 'button[type="submit"]',
      accessibleName: 'Login',
    });

    const optimized = applyReadabilityRules([
      makeClickStep('step-0001', 1, identity),
      makeTextStep('step-0002', 2, identity, 'Admin'),
      makeClickStep('step-0003', 3, loginBtn),
    ]);

    // Populate executionJson first
    const jsonResult = executionJsonGenerator.generate({ steps: optimized });
    const stepsWithJson = jsonResult.output!;

    // Feed to Playwright Generator
    const pwResult = playwrightGenerator.generate({
      steps: stepsWithJson,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Login Test',
    });

    expect(pwResult.status).toBe('success');
    const code = pwResult.output!.testCode;

    // Should have .fill('Admin') — the text entry
    expect(code).toContain("fill('Admin')");

    // Should have .click() for the Login button
    expect(code).toContain('click()');

    // Should NOT have .click() on the input field followed by .fill() on the same
    // (the focus click was merged away)
    const lines = code.split('\n');
    const clickLines = lines.filter(l => l.includes('.click()'));
    const fillLines = lines.filter(l => l.includes('.fill('));

    expect(fillLines).toHaveLength(1);
    expect(clickLines).toHaveLength(1); // Only the Login button click
  });

  it('multi-field form: optimized steps produce correct Playwright with all fills', () => {
    const usernameId = makeIdentity({ tag: 'INPUT', cssSelector: '#username', accessibleName: 'Username', name: 'username' });
    const passwordId = makeIdentity({ tag: 'INPUT', cssSelector: '#password', accessibleName: 'Password', name: 'password' });
    const loginBtn = makeIdentity({ tag: 'BUTTON', cssSelector: 'button[type="submit"]', accessibleName: 'Login' });

    const optimized = applyReadabilityRules([
      makeClickStep('step-0001', 1, usernameId),
      makeTextStep('step-0002', 2, usernameId, 'Admin'),
      makeClickStep('step-0003', 3, passwordId),
      makeTextStep('step-0004', 4, passwordId, 'admin123'),
      makeClickStep('step-0005', 5, loginBtn),
    ]);

    expect(optimized).toHaveLength(3);

    const jsonResult = executionJsonGenerator.generate({ steps: optimized });
    const pwResult = playwrightGenerator.generate({
      steps: jsonResult.output!,
      recordingContext: { startUrl: 'https://app.example.com', startTitle: 'Test', capturedAt: '2026-01-01T00:00:00Z' },
      testCaseName: 'Login',
    });

    const code = pwResult.output!.testCode;

    expect(code).toContain("fill('Admin')");
    expect(code).toContain("fill('admin123')");
    expect(code).toContain('click()');
  });
});
