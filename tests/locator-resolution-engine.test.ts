/**
 * Tests for the Locator Resolution Engine.
 *
 * Milestone B5.3 (v5.0.0)
 *
 * Tests the B4.4 priority hierarchy, acceptance rules, disqualifiers,
 * and max-3-locator constraint.
 */

import { describe, it, expect } from 'vitest';
import { resolveLocators } from '../src/generation/engine/locator-resolution-engine';
import type { ElementIdentity } from '../src/shared/types';

/** Helper: create a base ElementIdentity with all fields null. */
function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
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
    cssSelector: '',
    xPath: '',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

describe('Locator Resolution Engine', () => {
  // ── Priority Hierarchy ──────────────────────────────────

  it('P1: data-testid is primary over all other categories', () => {
    const identity = makeIdentity({
      testId: 'submit-btn',
      ariaLabel: 'Submit',
      stableId: 'main-submit',
      accessibleName: 'Submit Order',
      className: null,
      cssSelector: 'button.submit',
      xPath: '//button',
    });
    const { locators, warnings } = resolveLocators(identity);

    expect(locators).toHaveLength(3);
    expect(locators[0]).toEqual({ strategy: 'testId', value: 'submit-btn', role: 'primary' });
    expect(warnings).toHaveLength(0);
  });

  it('P1 sub-priority: data-testid before data-cy before data-qa', () => {
    const identity = makeIdentity({
      testId: 'test-id-val',
      dataCy: 'cy-val',
      dataQa: 'qa-val',
    });
    const { locators } = resolveLocators(identity);

    expect(locators[0].strategy).toBe('testId');
    expect(locators[1].strategy).toBe('dataCy');
    expect(locators[2].strategy).toBe('dataQa');
  });

  it('P2: aria-label is primary when no business identifier exists', () => {
    const identity = makeIdentity({
      ariaLabel: 'Close dialog',
      stableId: 'close-btn',
      accessibleName: 'Close',
      className: null,
      cssSelector: 'button.close',
    });
    const { locators } = resolveLocators(identity);

    expect(locators[0]).toEqual({ strategy: 'ariaLabel', value: 'Close dialog', role: 'primary' });
  });

  it('P3: stable id is primary when no business/accessibility identifiers exist', () => {
    const identity = makeIdentity({
      stableId: 'login-email',
      accessibleName: 'Email',
      className: null,
      cssSelector: '#login-email',
    });
    const { locators } = resolveLocators(identity);

    expect(locators[0]).toEqual({ strategy: 'id', value: 'login-email', role: 'primary' });
  });

  it('P4: accessible name (text) is primary when only content exists', () => {
    const identity = makeIdentity({
      accessibleName: 'Submit Form',
      className: null,
      cssSelector: 'button:nth-child(3)',
    });
    const { locators } = resolveLocators(identity);

    expect(locators[0]).toEqual({ strategy: 'text', value: 'Submit Form', role: 'primary' });
  });

  it('P5: CSS selector is primary when only structural locators exist', () => {
    const identity = makeIdentity({
      className: null,
      cssSelector: 'div.form > button.submit',
      xPath: '//div/form/button',
    });
    const { locators, warnings } = resolveLocators(identity);

    expect(locators[0]).toEqual({ strategy: 'css', value: 'div.form > button.submit', role: 'primary' });
    // Structural primary should generate a warning
    expect(warnings).toContain('Primary locator is a structural selector — low confidence for stability');
  });

  // ── Max 3 Constraint ────────────────────────────────────

  it('returns at most 3 locators (B4.4 section 3.6)', () => {
    const identity = makeIdentity({
      testId: 'btn-test',
      dataCy: 'btn-cy',
      dataQa: 'btn-qa',
      ariaLabel: 'Button',
      stableId: 'btn-id',
      accessibleName: 'Click Me',
      className: null,
      cssSelector: 'button.btn',
      xPath: '//button',
    });
    const { locators } = resolveLocators(identity);

    expect(locators).toHaveLength(3);
    expect(locators[0].role).toBe('primary');
    expect(locators[1].role).toBe('secondary');
    expect(locators[2].role).toBe('fallback');
  });

  // ── Exactly One Primary ─────────────────────────────────

  it('has exactly one primary locator when locators exist', () => {
    const identity = makeIdentity({ testId: 'test', ariaLabel: 'label' });
    const { locators } = resolveLocators(identity);

    const primaries = locators.filter((l) => l.role === 'primary');
    expect(primaries).toHaveLength(1);
  });

  // ── Acceptance Rules ────────────────────────────────────

  it('rejects empty/null/undefined values (AC-1)', () => {
    const identity = makeIdentity({
      testId: '',
      dataCy: null,
      dataQa: undefined as unknown as null,
      ariaLabel: '   ',
      className: null,
      cssSelector: '',
      xPath: '',
      accessibleName: '',
    });
    const { locators, warnings } = resolveLocators(identity);

    expect(locators).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rejects generic body/html selectors (AC-2)', () => {
    const identity = makeIdentity({
      className: null,
      cssSelector: 'body',
      xPath: '//html',
      accessibleName: '',
    });
    const { locators } = resolveLocators(identity);

    expect(locators).toHaveLength(0);
  });

  // ── Disqualifiers ───────────────────────────────────────

  it('DQ-1: rejects auto-generated React IDs', () => {
    const identity = makeIdentity({
      stableId: ':r1:',
      accessibleName: 'Click Me',
      className: null,
      cssSelector: 'button',
    });
    const { locators } = resolveLocators(identity);

    // The auto-generated id should be skipped, text should be primary
    expect(locators[0].strategy).toBe('text');
    expect(locators.find((l) => l.strategy === 'id')).toBeUndefined();
  });

  it('DQ-1: rejects auto-generated Angular IDs', () => {
    const identity = makeIdentity({
      stableId: 'cdk-overlay-0',
      accessibleName: 'Modal',
    });
    const { locators } = resolveLocators(identity);

    expect(locators.find((l) => l.strategy === 'id')).toBeUndefined();
  });

  it('DQ-1: rejects auto-generated Emotion/styled-components IDs', () => {
    const identity = makeIdentity({
      stableId: 'sc-abc123def',
      accessibleName: 'Card',
    });
    const { locators } = resolveLocators(identity);

    expect(locators.find((l) => l.strategy === 'id')).toBeUndefined();
  });

  it('DQ-1: rejects generic hash IDs (16+ hex chars)', () => {
    const identity = makeIdentity({
      stableId: 'a1b2c3d4e5f6a7b8',
      accessibleName: 'Item',
    });
    const { locators } = resolveLocators(identity);

    expect(locators.find((l) => l.strategy === 'id')).toBeUndefined();
  });

  it('DQ-3: rejects CSS-in-JS class selectors', () => {
    const identity = makeIdentity({
      className: null,
      cssSelector: 'div.css-abc123456',
      xPath: '//div',
      accessibleName: '',
    });
    const { locators } = resolveLocators(identity);

    // The CSS-in-JS selector should be skipped, xpath should be primary
    expect(locators[0].strategy).toBe('xpath');
  });

  // ── Edge Cases ──────────────────────────────────────────

  it('returns empty locators with warning when no candidates exist', () => {
    const identity = makeIdentity({ tag: 'DIV' });
    const { locators, warnings } = resolveLocators(identity);

    expect(locators).toHaveLength(0);
    expect(warnings).toContain('No accepted locators found — element identity has no valid identifiers');
  });

  it('returns single locator when only one candidate exists', () => {
    const identity = makeIdentity({ testId: 'only-one' });
    const { locators } = resolveLocators(identity);

    expect(locators).toHaveLength(1);
    expect(locators[0].role).toBe('primary');
  });

  // ── Determinism ─────────────────────────────────────────

  it('is deterministic: same input → same output', () => {
    const identity = makeIdentity({
      testId: 'btn',
      ariaLabel: 'Button',
      className: null,
      cssSelector: 'button',
    });

    const result1 = resolveLocators(identity);
    const result2 = resolveLocators(identity);

    expect(result1.locators).toEqual(result2.locators);
    expect(result1.warnings).toEqual(result2.warnings);
  });

  // ── Secondary from Different Category ───────────────────

  it('secondary prefers different category from primary', () => {
    const identity = makeIdentity({
      testId: 'btn-test',     // Business (category 1)
      dataCy: 'btn-cy',       // Business (category 1)
      ariaLabel: 'Button',    // Accessibility (category 2)
    });
    const { locators } = resolveLocators(identity);

    expect(locators[0].strategy).toBe('testId');     // primary: category 1
    expect(locators[1].strategy).toBe('ariaLabel');   // secondary: category 2 (different)
    // dataCy (same category) is lower priority for secondary
  });
});
