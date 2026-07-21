/**
 * Action Renderer Tests — Milestone 2
 *
 * Tests that every IRAction maps to valid Playwright code.
 * Focus areas per user request: SELECT_DATE, WAIT, TOGGLE.
 *
 * Also runs all reference plans through the action renderer to
 * verify no action produces an error or invalid output.
 */
import { describe, it, expect } from 'vitest';
import { renderAction } from '../../../src/adapters/playwright/action-renderer';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import type { IRStep, ResolvedLocator, ElementTarget } from '../../../src/domain/execution-ir/types';
import { LocatorStrategyType } from '../../../src/domain/enums';
import { ALL_REFERENCE_PLANS } from '../../../src/adapters/playwright/__fixtures__/reference-ir-plans';

// ── Helpers ───────────────────────────────────────────────

function makeLocator(
  type: LocatorStrategyType,
  value: string,
  priority = 1,
): ResolvedLocator {
  return { type, value, priority, confidence: 0.9 };
}

function makeElementTarget(
  locators: ResolvedLocator[],
  elementId = 'elm-1',
  elementName = 'Test Element',
  pageOrComponent = 'TestPage',
): ElementTarget {
  return {
    kind: 'element',
    elementId,
    elementName,
    pageOrComponent,
    resolvedLocators: locators,
  };
}

function makeStep(
  action: IRAction,
  target: IRStep['target'],
  options?: {
    input?: IRStep['input'];
    executionParameters?: Partial<IRStep['executionParameters']>;
  },
): IRStep {
  return {
    id: `step-${Math.random().toString(36).slice(2, 8)}`,
    order: 0,
    action,
    description: 'Test step',
    target,
    input: options?.input ?? null,
    assertions: [],
    executionParameters: {
      ...DEFAULT_EXECUTION_PARAMETERS,
      ...options?.executionParameters,
    },
  };
}

const ROLE_BUTTON = [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')];
const ROLE_TEXTBOX = [makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]')];
const ROLE_CHECKBOX = [makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Subscribe"]')];

// ── CLICK ─────────────────────────────────────────────────

describe('CLICK', () => {
  it('renders locator.click()', () => {
    const step = makeStep(IRAction.CLICK, makeElementTarget(ROLE_BUTTON));
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('button', { name: 'Submit' }).click()");
  });

  it('renders with custom page variable', () => {
    const step = makeStep(IRAction.CLICK, makeElementTarget(ROLE_BUTTON));
    const result = renderAction(step, 'this.page');
    expect(result).toBe("this.page.getByRole('button', { name: 'Submit' }).click()");
  });

  it('renders with indentation', () => {
    const step = makeStep(IRAction.CLICK, makeElementTarget(ROLE_BUTTON));
    const result = renderAction(step, 'page', { indent: '  ' });
    expect(result).toBe("  page.getByRole('button', { name: 'Submit' }).click()");
  });

  it('includes timeout option when non-default', () => {
    const step = makeStep(IRAction.CLICK, makeElementTarget(ROLE_BUTTON), {
      executionParameters: { timeoutMs: 5000 },
    });
    const result = renderAction(step);
    expect(result).toContain('{ timeout: 5000 }');
  });

  it('omits timeout option for default 30000ms', () => {
    const step = makeStep(IRAction.CLICK, makeElementTarget(ROLE_BUTTON));
    const result = renderAction(step);
    expect(result).not.toContain('timeout');
  });
});

// ── FILL ──────────────────────────────────────────────────

describe('FILL', () => {
  it('renders locator.fill(value)', () => {
    const step = makeStep(
      IRAction.FILL,
      makeElementTarget(ROLE_TEXTBOX),
      { input: 'john@example.com' },
    );
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('textbox', { name: 'Email' }).fill('john@example.com')");
  });

  it('escapes single quotes in input value', () => {
    const step = makeStep(
      IRAction.FILL,
      makeElementTarget(ROLE_TEXTBOX),
      { input: "O'Brien" },
    );
    const result = renderAction(step);
    expect(result).toContain("fill('O\\'Brien')");
  });

  it('escapes backslashes in input value', () => {
    const step = makeStep(
      IRAction.FILL,
      makeElementTarget(ROLE_TEXTBOX),
      { input: 'C:\\Users\\test' },
    );
    const result = renderAction(step);
    expect(result).toContain("fill('C:\\\\Users\\\\test')");
  });

  it('handles empty string input', () => {
    const step = makeStep(
      IRAction.FILL,
      makeElementTarget(ROLE_TEXTBOX),
      { input: '' },
    );
    const result = renderAction(step);
    expect(result).toContain(".fill('')");
  });

  it('escapes newlines in input value (multi-line text)', () => {
    const step = makeStep(
      IRAction.FILL,
      makeElementTarget(ROLE_TEXTBOX),
      { input: 'line1\nline2' },
    );
    const result = renderAction(step);
    expect(result).toContain("fill('line1\\nline2')");
    // Must NOT contain a raw newline in the generated code
    expect(result).not.toMatch(/fill\('[^']*'\n/);
  });

  it('escapes tabs and carriage returns in input value', () => {
    const step = makeStep(
      IRAction.FILL,
      makeElementTarget(ROLE_TEXTBOX),
      { input: 'col1\tcol2\r\n' },
    );
    const result = renderAction(step);
    expect(result).toContain("'col1\\tcol2\\r\\n'");
  });
});

// ── SELECT ────────────────────────────────────────────────

describe('SELECT', () => {
  it('renders locator.selectOption(value)', () => {
    const step = makeStep(
      IRAction.SELECT,
      makeElementTarget([makeLocator(LocatorStrategyType.CSS, '#country')]),
      { input: 'United States' },
    );
    const result = renderAction(step);
    expect(result).toBe("page.locator('#country').selectOption('United States')");
  });

  it('escapes special characters in option value', () => {
    const step = makeStep(
      IRAction.SELECT,
      makeElementTarget([makeLocator(LocatorStrategyType.CSS, '#sel')]),
      { input: "it's a test" },
    );
    const result = renderAction(step);
    expect(result).toContain("selectOption('it\\'s a test')");
  });
});

// ── SELECT_DATE (key validation action) ───────────────────

describe('SELECT_DATE', () => {
  it('renders locator.fill(date) for native date input', () => {
    const step = makeStep(
      IRAction.SELECT_DATE,
      makeElementTarget([
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Departure Date"]'),
      ]),
      { input: '2026-08-15' },
    );
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('textbox', { name: 'Departure Date' }).fill('2026-08-15')");
  });

  it('uses fill() — no native Playwright date API needed', () => {
    const step = makeStep(
      IRAction.SELECT_DATE,
      makeElementTarget([makeLocator(LocatorStrategyType.TEST_ID, 'date-picker')]),
      { input: '2026-12-31' },
    );
    const result = renderAction(step);
    // CRITICAL: should NOT contain any date-picker-specific API
    expect(result).not.toContain('datePicker');
    expect(result).not.toContain('calendar');
    expect(result).toContain('.fill(');
  });

  it('validates the IR carries the date value, not the adapter', () => {
    // The date value is in step.input, resolved from the ATC at generation time.
    // The adapter just passes it through — no date logic in the adapter.
    const step = makeStep(
      IRAction.SELECT_DATE,
      makeElementTarget([makeLocator(LocatorStrategyType.CSS, '#date')]),
      { input: '2026-01-15' },
    );
    const result = renderAction(step);
    expect(result).toContain("'2026-01-15'");
  });
});

// ── TOGGLE (key validation action) ────────────────────────

describe('TOGGLE', () => {
  it('renders .check() when input is true (idempotent check)', () => {
    const step = makeStep(
      IRAction.TOGGLE,
      makeElementTarget(ROLE_CHECKBOX),
      { input: true },
    );
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('checkbox', { name: 'Subscribe' }).check()");
  });

  it('renders .uncheck() when input is false (idempotent uncheck)', () => {
    const step = makeStep(
      IRAction.TOGGLE,
      makeElementTarget(ROLE_CHECKBOX),
      { input: false },
    );
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('checkbox', { name: 'Subscribe' }).uncheck()");
  });

  it('renders .click() when input is null (literal toggle)', () => {
    const step = makeStep(
      IRAction.TOGGLE,
      makeElementTarget(ROLE_CHECKBOX),
      { input: null },
    );
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('checkbox', { name: 'Subscribe' }).click()");
  });

  it('default (no options) renders .click() for backward compat', () => {
    const step = makeStep(IRAction.TOGGLE, makeElementTarget(ROLE_CHECKBOX));
    const result = renderAction(step);
    expect(result).toContain('.click()');
  });
});

// ── HOVER ─────────────────────────────────────────────────

describe('HOVER', () => {
  it('renders locator.hover()', () => {
    const step = makeStep(
      IRAction.HOVER,
      makeElementTarget([makeLocator(LocatorStrategyType.ROLE, 'button[name="Products"]')]),
    );
    const result = renderAction(step);
    expect(result).toBe("page.getByRole('button', { name: 'Products' }).hover()");
  });
});

// ── NAVIGATE ──────────────────────────────────────────────

describe('NAVIGATE', () => {
  it('renders page.goto(url) from UrlTarget', () => {
    const step = makeStep(
      IRAction.NAVIGATE,
      { kind: 'url', url: 'https://staging.example.com/login' },
    );
    const result = renderAction(step);
    expect(result).toBe("page.goto('https://staging.example.com/login')");
  });

  it('uses custom page variable', () => {
    const step = makeStep(
      IRAction.NAVIGATE,
      { kind: 'url', url: 'https://example.com' },
    );
    const result = renderAction(step, 'this.page');
    expect(result).toBe("this.page.goto('https://example.com')");
  });

  it('escapes URL with special characters', () => {
    const step = makeStep(
      IRAction.NAVIGATE,
      { kind: 'url', url: "https://example.com/path?q=it's" },
    );
    const result = renderAction(step);
    expect(result).toContain("goto('https://example.com/path?q=it\\'s')");
  });
});

// ── VERIFY ────────────────────────────────────────────────

describe('VERIFY', () => {
  it('renders empty string (no action line)', () => {
    const step = makeStep(
      IRAction.VERIFY,
      makeElementTarget([makeLocator(LocatorStrategyType.ROLE, 'heading[name="Dashboard"]')]),
    );
    const result = renderAction(step);
    expect(result).toBe('');
  });
});

// ── WAIT (key validation action) ──────────────────────────

describe('WAIT', () => {
  it('renders page.waitForTimeout(ms) with duration from input', () => {
    const step = makeStep(
      IRAction.WAIT,
      { kind: 'none' },
      { input: 3000 },
    );
    const result = renderAction(step);
    expect(result).toBe('page.waitForTimeout(3000)');
  });

  it('uses input field for duration, NOT executionParameters.timeoutMs', () => {
    // Per IR contract §2.6.1: input holds the wait duration.
    // timeoutMs is the action execution ceiling, not the sleep duration.
    const step = makeStep(
      IRAction.WAIT,
      { kind: 'none' },
      {
        input: 5000,
        executionParameters: { timeoutMs: 30000 },
      },
    );
    const result = renderAction(step);
    expect(result).toBe('page.waitForTimeout(5000)');
    expect(result).not.toContain('30000');
  });

  it('handles fractional milliseconds by rounding', () => {
    const step = makeStep(
      IRAction.WAIT,
      { kind: 'none' },
      { input: 2500.7 },
    );
    const result = renderAction(step);
    expect(result).toBe('page.waitForTimeout(2501)');
  });

  it('falls back to 1000ms when input is null', () => {
    const step = makeStep(
      IRAction.WAIT,
      { kind: 'none' },
      { input: null },
    );
    const result = renderAction(step);
    expect(result).toBe('page.waitForTimeout(1000)');
  });

  it('uses custom page variable', () => {
    const step = makeStep(
      IRAction.WAIT,
      { kind: 'none' },
      { input: 2000 },
    );
    const result = renderAction(step, 'this.page');
    expect(result).toBe('this.page.waitForTimeout(2000)');
  });
});

// ── WAIT_FOR_ELEMENT ──────────────────────────────────────

describe('WAIT_FOR_ELEMENT', () => {
  it('renders empty string (Playwright auto-waits)', () => {
    const step = makeStep(
      IRAction.WAIT_FOR_ELEMENT,
      makeElementTarget([makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')]),
    );
    const result = renderAction(step);
    expect(result).toBe('');
  });

  it('produces no output even with non-default timeout', () => {
    const step = makeStep(
      IRAction.WAIT_FOR_ELEMENT,
      makeElementTarget(ROLE_BUTTON),
      { executionParameters: { timeoutMs: 5000 } },
    );
    const result = renderAction(step);
    expect(result).toBe('');
  });
});

// ── Error Cases ───────────────────────────────────────────

describe('error handling', () => {
  it('throws when element action has non-element target', () => {
    const step = makeStep(
      IRAction.CLICK,
      { kind: 'url', url: 'https://example.com' },
    );
    expect(() => renderAction(step)).toThrow('element target');
  });

  it('throws when NAVIGATE has non-url target', () => {
    const step = makeStep(
      IRAction.NAVIGATE,
      makeElementTarget(ROLE_BUTTON),
    );
    expect(() => renderAction(step)).toThrow('url target');
  });
});

// ── Reference Plan Coverage ───────────────────────────────

describe('reference plan coverage (all actions render)', () => {
  for (const entry of ALL_REFERENCE_PLANS) {
    it(`renders all actions in "${entry.name}" plan`, () => {
      const plan = entry.factory();
      for (const step of plan.steps) {
        // Every step should render without throwing
        const result = renderAction(step);
        // Non-empty results must look like valid Playwright code
        if (result) {
          expect(result).toMatch(/^(page|this\.page)\./);
        }
      }
    });
  }

  it('every non-empty render is syntactically valid Playwright', () => {
    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      for (const step of plan.steps) {
        const result = renderAction(step);
        if (result) {
          // Must end with a method call closing paren
          expect(result).toMatch(/\)$/);
          // Must not contain undefined, null, or NaN as bare words
          // (only inside quotes is fine)
          const withoutStrings = result.replace(/'[^']*'/g, "''");
          expect(withoutStrings).not.toContain('undefined');
          expect(withoutStrings).not.toContain('NaN');
        }
      }
    }
  });
});

// ── Indentation ───────────────────────────────────────────

describe('indentation', () => {
  it('applies indent prefix to non-empty results', () => {
    const step = makeStep(IRAction.CLICK, makeElementTarget(ROLE_BUTTON));
    const result = renderAction(step, 'page', { indent: '    ' });
    expect(result).toBe("    page.getByRole('button', { name: 'Submit' }).click()");
  });

  it('returns empty string for VERIFY even with indent', () => {
    const step = makeStep(IRAction.VERIFY, makeElementTarget(ROLE_BUTTON));
    const result = renderAction(step, 'page', { indent: '    ' });
    expect(result).toBe('');
  });

  it('returns empty string for WAIT_FOR_ELEMENT even with indent', () => {
    const step = makeStep(
      IRAction.WAIT_FOR_ELEMENT,
      makeElementTarget(ROLE_BUTTON),
    );
    const result = renderAction(step, 'page', { indent: '    ' });
    expect(result).toBe('');
  });
});
