/**
 * Phase 6C — Playwright renderer: EQUALITY/EQUALS/value → toHaveValue
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §2.5
 *
 * Pin P10: the committed-value fill assertion (equality / equals /
 * property='value') must render to Playwright's toHaveValue(). Today the
 * renderEquality default falls through to toHaveAttribute('value','true') —
 * wrong for this shape. Evaluator support already exists (assertion-evaluator
 * 'value' property); only the renderer matrix lacks the case.
 *
 * Also guards: existing EQUALITY cases (checked/enabled/editable) and the
 * unknown-property fallback stay EXACTLY as pinned.
 *
 * TDD: written before implementation. Red until renderEquality grows the
 * value case. No product code here.
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

function makeValueAssertion(options?: { severity?: ValidationSeverity }): IRAssertion {
  return {
    type: ValidationType.EQUALITY,
    comparison: ValidationComparison.EQUALS,
    expectedValue: 'Sat, 05 Sep',
    severity: options?.severity ?? ValidationSeverity.SOFT,
    property: 'value',
    target: {
      kind: 'element',
      elementId: 'obs-1-0',
      elementName: 'Origin',
      pageOrComponent: 'main',
      resolvedLocators: [
        { type: LocatorStrategyType.CSS, value: '#origin', priority: 1, confidence: 0.7 },
      ],
    },
  };
}

describe('EQUALITY EQUALS property=value (P10)', () => {
  it('soft value assertion renders to expect.soft(locator).toHaveValue(val)', () => {
    const lines = renderAssertion(makeValueAssertion()).lines;
    expect(lines).toEqual([
      `await expect.soft(page.locator('#origin')).toHaveValue('Sat, 05 Sep')`,
    ]);
  });

  it('hard severity renders expect().toHaveValue(val)', () => {
    const lines = renderAssertion(
      makeValueAssertion({ severity: ValidationSeverity.HARD }),
    ).lines;
    expect(lines).toEqual([
      `await expect(page.locator('#origin')).toHaveValue('Sat, 05 Sep')`,
    ]);
  });

  it('escapes single quotes and backslashes in the value (house escaper)', () => {
    const a = makeValueAssertion();
    // Raw value: We're "going" \ home — escaper doubles backslashes and
    // escapes single quotes; double quotes pass through untouched.
    const withQuote = { ...a, expectedValue: 'We\'re "going" \\ home' } as IRAssertion;
    const lines = renderAssertion(withQuote).lines;
    expect(lines[0]).toContain("toHaveValue('We\\'re \"going\" \\\\ home')");
  });

  it('existing equality cases stay pinned: checked/enabled/editable/unknown', () => {
    const mk = (property: string): IRAssertion => ({
      type: ValidationType.EQUALITY,
      comparison: ValidationComparison.IS_TRUE,
      expectedValue: null,
      severity: ValidationSeverity.HARD,
      property,
      target: {
        kind: 'element',
        elementId: 'elm-1',
        elementName: 'Test Element',
        pageOrComponent: 'TestPage',
        resolvedLocators: [
          { type: LocatorStrategyType.ROLE, value: 'button[name="Submit"]', priority: 1, confidence: 0.9 },
        ],
      },
    });
    expect(renderAssertion(mk('checked')).lines[0]).toContain('toBeChecked()');
    expect(renderAssertion(mk('enabled')).lines[0]).toContain('toBeEnabled()');
    expect(renderAssertion(mk('editable')).lines[0]).toContain('toBeEditable()');
    // Unknown properties keep the attribute fallback — 'value' no longer
    // falls through (it has its own case now), but arbitrary others do.
    expect(renderAssertion(mk('expanded')).lines[0]).toContain("toHaveAttribute('expanded', 'true')");
  });
});
