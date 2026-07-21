/**
 * Assertion Renderer Tests — Milestone 3
 *
 * Comprehensive tests for every ValidationType × ValidationComparison
 * combination, plus severity mapping and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { renderAssertion } from '../../../src/adapters/playwright/assertion-renderer';
import type { IRAssertion } from '../../../src/domain/execution-ir/types';
import {
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
  LocatorStrategyType,
} from '../../../src/domain/enums';

// ── Helpers ───────────────────────────────────────────────

function makeAssertion(
  type: ValidationType,
  comparison: ValidationComparison,
  options?: {
    expectedValue?: unknown;
    property?: string | null;
    severity?: ValidationSeverity;
    targetKind?: 'element' | 'url' | 'none';
  },
): IRAssertion {
  const target = options?.targetKind === 'url'
    ? { kind: 'url' as const, url: 'https://example.com/page' }
    : options?.targetKind === 'none'
      ? { kind: 'none' as const }
      : {
          kind: 'element' as const,
          elementId: 'elm-1',
          elementName: 'Test Element',
          pageOrComponent: 'TestPage',
          resolvedLocators: [
            { type: LocatorStrategyType.ROLE, value: 'button[name="Submit"]', priority: 1, confidence: 0.9 },
          ],
        };

  return {
    type,
    comparison,
    expectedValue: options?.expectedValue ?? null,
    severity: options?.severity ?? ValidationSeverity.HARD,
    target,
    property: options?.property ?? null,
  };
}

function lines(a: IRAssertion): string[] {
  return renderAssertion(a).lines;
}

// ── VISIBILITY ────────────────────────────────────────────

describe('VISIBILITY', () => {
  it('IS_TRUE → toBeVisible()', () => {
    const a = makeAssertion(ValidationType.VISIBILITY, ValidationComparison.IS_TRUE);
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible()"]);
  });

  it('IS_FALSE → toBeHidden()', () => {
    const a = makeAssertion(ValidationType.VISIBILITY, ValidationComparison.IS_FALSE);
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeHidden()"]);
  });
});

// ── PRESENCE ──────────────────────────────────────────────

describe('PRESENCE', () => {
  it('IS_TRUE → toBeAttached()', () => {
    const a = makeAssertion(ValidationType.PRESENCE, ValidationComparison.IS_TRUE);
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeAttached()"]);
  });

  it('IS_FALSE → not.toBeAttached()', () => {
    const a = makeAssertion(ValidationType.PRESENCE, ValidationComparison.IS_FALSE);
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).not.toBeAttached()"]);
  });
});

// ── TEXT_MATCH ────────────────────────────────────────────

describe('TEXT_MATCH', () => {
  it('EQUALS → toHaveText(val)', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.EQUALS, { expectedValue: 'Dashboard' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toHaveText('Dashboard')"]);
  });

  it('CONTAINS → toContainText(val)', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.CONTAINS, { expectedValue: 'Welcome' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toContainText('Welcome')"]);
  });

  it('STARTS_WITH → toContainText(/^val/)', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.STARTS_WITH, { expectedValue: 'Hello' });
    const result = lines(a)[0];
    expect(result).toContain('/^Hello/');
  });

  it('MATCHES → toHaveText(/val/)', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.MATCHES, { expectedValue: 'Order #\\d+' });
    const result = lines(a)[0];
    expect(result).toContain('/Order');
    expect(result).toContain('\\\\d');
  });

  it('escapes regex metacharacters in MATCHES', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.MATCHES, { expectedValue: '$100' });
    const result = lines(a)[0];
    expect(result).toContain('/\\$100/');
  });
});

// ── ATTRIBUTE_MATCH ───────────────────────────────────────

describe('ATTRIBUTE_MATCH', () => {
  it('EQUALS → toHaveAttribute(prop, val)', () => {
    const a = makeAssertion(ValidationType.ATTRIBUTE_MATCH, ValidationComparison.EQUALS, {
      expectedValue: 'disabled',
      property: 'class',
    });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toHaveAttribute('class', 'disabled')"]);
  });

  it('CONTAINS → toHaveAttribute(prop, /val/)', () => {
    const a = makeAssertion(ValidationType.ATTRIBUTE_MATCH, ValidationComparison.CONTAINS, {
      expectedValue: 'active',
      property: 'class',
    });
    const result = lines(a)[0];
    expect(result).toContain("toHaveAttribute('class', /active/)");
  });

  it('MATCHES → toHaveAttribute(prop, /val/)', () => {
    const a = makeAssertion(ValidationType.ATTRIBUTE_MATCH, ValidationComparison.MATCHES, {
      expectedValue: 'btn-\\w+',
      property: 'class',
    });
    const result = lines(a)[0];
    expect(result).toContain("toHaveAttribute('class', /btn");
  });
});

// ── COUNT ─────────────────────────────────────────────────

describe('COUNT', () => {
  it('EQUALS → toHaveCount(n)', () => {
    const a = makeAssertion(ValidationType.COUNT, ValidationComparison.EQUALS, { expectedValue: 5 });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(5)"]);
  });

  it('GREATER_THAN → count extraction', () => {
    const a = makeAssertion(ValidationType.COUNT, ValidationComparison.GREATER_THAN, { expectedValue: 3 });
    const result = lines(a);
    expect(result[0]).toMatch(/const count_.* = await .*\.count\(\)/);
    expect(result[1]).toMatch(/expect\(count_.*\)\.toBeGreaterThan\(3\)/);
  });

  it('LESS_THAN → count extraction', () => {
    const a = makeAssertion(ValidationType.COUNT, ValidationComparison.LESS_THAN, { expectedValue: 10 });
    const result = lines(a);
    expect(result[0]).toMatch(/const count_.* = await .*\.count\(\)/);
    expect(result[1]).toMatch(/expect\(count_.*\)\.toBeLessThan\(10\)/);
  });
});

// ── EQUALITY ──────────────────────────────────────────────

describe('EQUALITY', () => {
  it('IS_TRUE with property=checked → toBeChecked()', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_TRUE, { property: 'checked' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeChecked()"]);
  });

  it('IS_FALSE with property=checked → not.toBeChecked()', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_FALSE, { property: 'checked' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).not.toBeChecked()"]);
  });

  it('IS_TRUE with property=enabled → toBeEnabled()', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_TRUE, { property: 'enabled' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled()"]);
  });

  it('IS_FALSE with property=enabled → toBeDisabled()', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_FALSE, { property: 'enabled' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled()"]);
  });

  it('IS_TRUE with property=editable → toBeEditable()', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_TRUE, { property: 'editable' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).toBeEditable()"]);
  });

  it('IS_FALSE with property=editable → not.toBeEditable()', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_FALSE, { property: 'editable' });
    expect(lines(a)).toEqual(["await expect(page.getByRole('button', { name: 'Submit' })).not.toBeEditable()"]);
  });

  it('IS_TRUE with unknown property → toHaveAttribute fallback', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_TRUE, { property: 'expanded' });
    expect(lines(a)).toEqual([
      "await expect(page.getByRole('button', { name: 'Submit' })).toHaveAttribute('expanded', 'true')",
    ]);
  });

  it('IS_FALSE with unknown property → not.toHaveAttribute fallback', () => {
    const a = makeAssertion(ValidationType.EQUALITY, ValidationComparison.IS_FALSE, { property: 'expanded' });
    expect(lines(a)).toEqual([
      "await expect(page.getByRole('button', { name: 'Submit' })).not.toHaveAttribute('expanded', 'true')",
    ]);
  });
});

// ── URL_MATCH ─────────────────────────────────────────────

describe('URL_MATCH', () => {
  it('EQUALS → toHaveURL(url)', () => {
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.EQUALS, {
      expectedValue: 'https://example.com/dashboard',
      targetKind: 'none',
    });
    expect(lines(a)).toEqual(["await expect(page).toHaveURL('https://example.com/dashboard')"]);
  });

  it('CONTAINS → toHaveURL(/url/)', () => {
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.CONTAINS, {
      expectedValue: 'dashboard',
      targetKind: 'none',
    });
    expect(lines(a)).toEqual(["await expect(page).toHaveURL(/dashboard/)"]);
  });

  it('STARTS_WITH → toHaveURL(/^url/)', () => {
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.STARTS_WITH, {
      expectedValue: 'https://app',
      targetKind: 'none',
    });
    const result = lines(a)[0];
    expect(result).toContain('/^https');
    expect(result).toContain('/app/');
  });

  it('MATCHES → toHaveURL(/url/)', () => {
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.MATCHES, {
      expectedValue: 'dashboard|home',
      targetKind: 'none',
    });
    const result = lines(a)[0];
    expect(result).toContain('/dashboard');
    expect(result).toContain('home/');
  });

  it('escapes forward slashes in regex — produces valid JS', () => {
    // CRITICAL: forward slashes in values must be escaped in regex literals
    // to avoid premature regex termination.
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.CONTAINS, {
      expectedValue: '/dashboard',
      targetKind: 'none',
    });
    const result = lines(a)[0];
    // Must be /\/dashboard/ — NOT //dashboard/ which would be invalid JS
    expect(result).toContain('\\/dashboard');
    expect(result).not.toMatch(/\/\/(?!dashboard)/);
    // Verify the generated code would be valid JS
    expect(result).toMatch(/toHaveURL\(\/.*\/\)$/);
  });

  it('escapes forward slashes in STARTS_WITH regex', () => {
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.STARTS_WITH, {
      expectedValue: 'https://app',
      targetKind: 'none',
    });
    const result = lines(a)[0];
    // Must escape / after https:
    expect(result).toContain('https:\\/\\/app');
  });
});

// ── CUSTOM ────────────────────────────────────────────────

describe('CUSTOM', () => {
  it('renders TODO comment with type and comparison', () => {
    const a = makeAssertion(ValidationType.CUSTOM, ValidationComparison.MATCHES);
    expect(lines(a)).toEqual([
      '// TODO: Custom assertion — type: custom, comparison: matches',
    ]);
  });

  it('includes property in TODO comment when present', () => {
    const a = makeAssertion(ValidationType.CUSTOM, ValidationComparison.CONTAINS, { property: 'data-state' });
    expect(lines(a)[0]).toContain('property: data-state');
  });
});

// ── Severity ──────────────────────────────────────────────

describe('severity mapping', () => {
  it('HARD (default) uses expect()', () => {
    const a = makeAssertion(ValidationType.VISIBILITY, ValidationComparison.IS_TRUE);
    expect(lines(a)[0]).toContain('expect(');
    expect(lines(a)[0]).not.toContain('expect.soft(');
  });

  it('SOFT uses expect.soft()', () => {
    const a = makeAssertion(ValidationType.VISIBILITY, ValidationComparison.IS_TRUE, {
      severity: ValidationSeverity.SOFT,
    });
    expect(lines(a)[0]).toContain('expect.soft(');
  });

  it('SOFT severity on COUNT GREATER_THAN', () => {
    const a = makeAssertion(ValidationType.COUNT, ValidationComparison.GREATER_THAN, {
      expectedValue: 5,
      severity: ValidationSeverity.SOFT,
    });
    expect(lines(a)[1]).toContain('expect.soft(');
  });
});

// ── Custom Page Variable ──────────────────────────────────

describe('custom page variable', () => {
  it('uses custom page variable for element targets', () => {
    const a = makeAssertion(ValidationType.VISIBILITY, ValidationComparison.IS_TRUE);
    const result = renderAssertion(a, 'this.page');
    expect(result.lines[0]).toContain('this.page.getByRole');
  });

  it('uses custom page variable for URL assertions', () => {
    const a = makeAssertion(ValidationType.URL_MATCH, ValidationComparison.EQUALS, {
      expectedValue: 'https://example.com',
      targetKind: 'none',
    });
    const result = renderAssertion(a, 'this.page');
    expect(result.lines[0]).toContain('this.page).toHaveURL');
  });
});

// ── Escaping ──────────────────────────────────────────────

describe('string escaping', () => {
  it('escapes single quotes in text values', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.EQUALS, {
      expectedValue: "It's a test",
    });
    expect(lines(a)[0]).toContain("'It\\'s a test'");
  });

  it('escapes backslashes in text values', () => {
    const a = makeAssertion(ValidationType.TEXT_MATCH, ValidationComparison.EQUALS, {
      expectedValue: 'C:\\path',
    });
    expect(lines(a)[0]).toContain("'C:\\\\path'");
  });
});
