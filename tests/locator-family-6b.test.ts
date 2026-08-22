/**
 * Phase 6B — L3 provenance pins: family-tagged TEST_ID values render and
 * resolve with the exact attribute; bare values keep legacy behavior
 * byte-identical.
 *
 * AC3 renderer: '[data-auto-id="X"]' → page.locator('[data-auto-id="X"]');
 *               bare / data-testid values → getByTestId('X') (unchanged).
 * AC4 executor: family-tagged value resolves against the exact attribute;
 *               bare values keep the 3-family probe (data-testid → data-cy → data-qa).
 */

import { describe, it, expect } from 'vitest';
import { renderLocator } from '../src/adapters/playwright/locator-renderer';
import { LocatorStrategyType } from '../src/domain/enums';
import type { ResolvedLocator } from '../src/domain/execution-ir/types';

function rl(type: LocatorStrategyType, value: string, priority = 1): ResolvedLocator {
  return { type, value, priority, confidence: 0.9 };
}

// ── AC3: renderer ─────────────────────────────────────────────────────────

describe('6B AC3 — locator renderer family-tagged TEST_ID', () => {
  it('renders [data-auto-id="X"] as a CSS attribute locator', () => {
    const out = renderLocator([rl(LocatorStrategyType.TEST_ID, '[data-auto-id="flight-card-F1"]')]);
    expect(out.expression).toBe(`locator('[data-auto-id="flight-card-F1"]')`);
  });

  it('renders [data-cy="X"] and [data-qa="X"] as CSS attribute locators', () => {
    const cy = renderLocator([rl(LocatorStrategyType.TEST_ID, '[data-cy="sign-in"]')]);
    const qa = renderLocator([rl(LocatorStrategyType.TEST_ID, '[data-qa="submit"]')]);
    expect(cy.expression).toBe(`locator('[data-cy="sign-in"]')`);
    expect(qa.expression).toBe(`locator('[data-qa="submit"]')`);
  });

  it('bare value still renders getByTestId (STAB)', () => {
    const out = renderLocator([rl(LocatorStrategyType.TEST_ID, 'email-input')]);
    expect(out.expression).toBe(`getByTestId('email-input')`);
  });

  it('legacy [data-testid="X"] form still extracts and renders getByTestId (STAB)', () => {
    const out = renderLocator([rl(LocatorStrategyType.TEST_ID, '[data-testid="email"]')]);
    expect(out.expression).toBe(`getByTestId('email')`);
  });
});

// ── AC4: executor resolver (jsdom-backed) ─────────────────────────────────

import { resolveElement } from '../src/execution/locator-resolver';

function resolveTestId(value: string) {
  return resolveElement(
    [{ type: 'testId', value, priority: 1, confidence: 0.9 }],
    document,
    false, // visibility check off — jsdom offsetParent is null for everything
  );
}

describe('6B AC4 — executor family-aware TEST_ID resolution', () => {
  it('resolves a family-tagged value against the exact attribute', () => {
    document.body.innerHTML = `
      <div data-auto-id="flight-card-F1">Flight</div>
      <div data-testid="flight-card-F1">Decoy</div>
    `;
    const result = resolveTestId('[data-auto-id="flight-card-F1"]');
    expect(result?.element.textContent).toBe('Flight'); // exact attribute, not the decoy
  });

  it('bare values keep the 3-family probe (STAB)', () => {
    document.body.innerHTML = `<div data-qa="legacy-submit">Legacy</div>`;
    const result = resolveTestId('legacy-submit');
    expect(result?.element.textContent).toBe('Legacy');
  });

  it('bare value still prefers data-testid first (STAB)', () => {
    document.body.innerHTML = `
      <div data-testid="dupe">TestId</div>
      <div data-cy="dupe">Cy</div>
    `;
    const result = resolveTestId('dupe');
    expect(result?.element.textContent).toBe('TestId');
  });

  it('family-tagged miss on the exact attribute does not fall through to other families', () => {
    document.body.innerHTML = `<div data-testid="cart-count">Decoy</div>`;
    const result = resolveTestId('[data-auto-id="cart-count"]');
    // provenance-respecting: no element carries data-auto-id → not found,
    // even though a bare probe would have found the data-testid decoy.
    expect(result).toBeNull();
  });
});
