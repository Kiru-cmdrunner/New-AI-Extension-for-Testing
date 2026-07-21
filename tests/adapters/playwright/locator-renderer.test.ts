/**
 * Playwright Locator Renderer Tests — Milestone 1
 *
 * Tests that every LocatorStrategyType renders to valid Playwright code.
 * Uses both isolated unit tests and the reference IR plan suite for coverage.
 */
import { describe, it, expect } from 'vitest';
import { renderLocator } from '../../../src/adapters/playwright/locator-renderer';
import { LocatorStrategyType } from '../../../src/domain/enums';
import type { ResolvedLocator } from '../../../src/domain/execution-ir/types';
import { ALL_REFERENCE_PLANS } from '../../../src/adapters/playwright/__fixtures__/reference-ir-plans';

// ── Test Helpers ──────────────────────────────────────────

function makeLocator(
  type: LocatorStrategyType,
  value: string,
  priority = 1,
): ResolvedLocator {
  return { type, value, priority, confidence: 0.9 };
}

// ── Tests ─────────────────────────────────────────────────

describe('Playwright Locator Renderer', () => {

  // ── ROLE ────────────────────────────────────────────────

  describe('ROLE strategy', () => {
    it('renders role with name', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Sign In"]'),
      ]);
      expect(result.expression).toBe(`getByRole('button', { name: 'Sign In' })`);
    });

    it('renders role without name', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'heading'),
      ]);
      expect(result.expression).toBe(`getByRole('heading')`);
    });

    it('renders role with multi-word name', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'link[name="Forgot password?"]'),
      ]);
      expect(result.expression).toBe(`getByRole('link', { name: 'Forgot password?' })`);
    });

    it('renders checkbox role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Subscribe to newsletter"]'),
      ]);
      expect(result.expression).toBe(`getByRole('checkbox', { name: 'Subscribe to newsletter' })`);
    });

    it('renders combobox role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'combobox[name="Search products"]'),
      ]);
      expect(result.expression).toBe(`getByRole('combobox', { name: 'Search products' })`);
    });

    it('renders dialog role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'dialog[name="Edit User"]'),
      ]);
      expect(result.expression).toBe(`getByRole('dialog', { name: 'Edit User' })`);
    });

    it('renders switch role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'switch[name="Dark Mode"]'),
      ]);
      expect(result.expression).toBe(`getByRole('switch', { name: 'Dark Mode' })`);
    });

    it('renders option role (autocomplete suggestion)', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'option[name="Wireless Headphones"]'),
      ]);
      expect(result.expression).toBe(`getByRole('option', { name: 'Wireless Headphones' })`);
    });

    it('renders status role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'status[name="Item deleted successfully"]'),
      ]);
      expect(result.expression).toBe(`getByRole('status', { name: 'Item deleted successfully' })`);
    });

    it('renders alert role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'alert[name="Registration successful"]'),
      ]);
      expect(result.expression).toBe(`getByRole('alert', { name: 'Registration successful' })`);
    });

    it('renders radio role', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ROLE, 'radio[name="Pro"]'),
      ]);
      expect(result.expression).toBe(`getByRole('radio', { name: 'Pro' })`);
    });

    it('throws on unparseable role value', () => {
      expect(() => {
        renderLocator([makeLocator(LocatorStrategyType.ROLE, '123[invalid')]);
      }).toThrow();
    });
  });

  // ── ACCESSIBLE_NAME ─────────────────────────────────────

  describe('ACCESSIBLE_NAME strategy', () => {
    it('renders as getByLabel', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ACCESSIBLE_NAME, 'Country'),
      ]);
      expect(result.expression).toBe(`getByLabel('Country')`);
    });

    it('renders with spaces', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.ACCESSIBLE_NAME, 'Search products'),
      ]);
      expect(result.expression).toBe(`getByLabel('Search products')`);
    });
  });

  // ── TEST_ID ─────────────────────────────────────────────

  describe('TEST_ID strategy', () => {
    it('renders plain test ID', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEST_ID, 'email-input'),
      ]);
      expect(result.expression).toBe(`getByTestId('email-input')`);
    });

    it('extracts test ID from CSS attribute selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEST_ID, '[data-testid="email"]'),
      ]);
      expect(result.expression).toBe(`getByTestId('email')`);
    });

    it('extracts test ID from single-quoted attribute selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEST_ID, "[data-testid='submit']"),
      ]);
      expect(result.expression).toBe(`getByTestId('submit')`);
    });

    it('renders kebab-case test ID', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEST_ID, 'departure-date'),
      ]);
      expect(result.expression).toBe(`getByTestId('departure-date')`);
    });
  });

  // ── TEXT ────────────────────────────────────────────────

  describe('TEXT strategy', () => {
    it('renders as getByText', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEXT, 'United States'),
      ]);
      expect(result.expression).toBe(`getByText('United States')`);
    });

    it('renders with spaces', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEXT, 'Upload successful'),
      ]);
      expect(result.expression).toBe(`getByText('Upload successful')`);
    });

    it('renders page indicator text', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.TEXT, 'Page 2'),
      ]);
      expect(result.expression).toBe(`getByText('Page 2')`);
    });
  });

  // ── LABEL ───────────────────────────────────────────────

  describe('LABEL strategy', () => {
    it('renders as getByLabel', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.LABEL, 'Password'),
      ]);
      expect(result.expression).toBe(`getByLabel('Password')`);
    });

    it('renders multi-word label', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.LABEL, 'Full Name'),
      ]);
      expect(result.expression).toBe(`getByLabel('Full Name')`);
    });
  });

  // ── CSS ─────────────────────────────────────────────────

  describe('CSS strategy', () => {
    it('renders simple ID selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, '#email-input'),
      ]);
      expect(result.expression).toBe(`locator('#email-input')`);
    });

    it('renders class selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, '.login-btn'),
      ]);
      expect(result.expression).toBe(`locator('.login-btn')`);
    });

    it('renders compound selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, '.date-picker input.departure'),
      ]);
      expect(result.expression).toBe(`locator('.date-picker input.departure')`);
    });

    it('renders attribute selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, 'input[type="file"]'),
      ]);
      expect(result.expression).toBe(`locator('input[type="file"]')`);
    });

    it('escapes single quotes in selector', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, "input[value='test']"),
      ]);
      expect(result.expression).toBe(`locator('input[value=\\'test\\']')`);
    });
  });

  // ── XPATH ───────────────────────────────────────────────

  describe('XPATH strategy', () => {
    it('renders XPath with // prefix', () => {
      const result = renderLocator([
        makeLocator(
          LocatorStrategyType.XPATH,
          '//tr[td[contains(text(),"John Doe")]]//button[contains(@class,"edit")]',
        ),
      ]);
      expect(result.expression).toBe(
        `locator('xpath=//tr[td[contains(text(),"John Doe")]]//button[contains(@class,"edit")]')`,
      );
    });

    it('renders XPath already prefixed with xpath=', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.XPATH, 'xpath=//div[@id="main"]'),
      ]);
      expect(result.expression).toBe(`locator('xpath=//div[@id="main"]')`);
    });
  });

  // ── Priority Selection ──────────────────────────────────

  describe('priority selection', () => {
    it('uses priority 1 locator when multiple provided', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, '#fallback', 3),
        makeLocator(LocatorStrategyType.TEST_ID, 'email', 2),
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]', 1),
      ]);
      expect(result.expression).toBe(`getByRole('textbox', { name: 'Email' })`);
    });

    it('uses highest-priority (lowest number) regardless of array order', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, '.btn', 2),
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]', 1),
      ]);
      expect(result.expression).toBe(`getByRole('button', { name: 'Submit' })`);
    });

    it('falls back to priority 2 if priority 1 is a different type', () => {
      const result = renderLocator([
        makeLocator(LocatorStrategyType.CSS, '#email', 2),
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]', 1),
      ]);
      // Priority 1 wins
      expect(result.expression).toBe(`getByRole('textbox', { name: 'Email' })`);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('throws on empty locators array', () => {
      expect(() => renderLocator([])).toThrow();
    });

    it('throws on null/undefined locators', () => {
      expect(() => renderLocator(null as unknown as ResolvedLocator[])).toThrow();
    });

    it('uses custom page reference', () => {
      const result = renderLocator(
        [makeLocator(LocatorStrategyType.CSS, '#btn')],
        'this.page',
      );
      expect(result.pageRef).toBe('this.page');
    });

    it('throws on unsupported locator type', () => {
      expect(() => {
        renderLocator([makeLocator('unknown' as LocatorStrategyType, 'test')]);
      }).toThrow();
    });
  });

  // ── Reference Plan Coverage ─────────────────────────────

  describe('reference plan coverage (all strategies render)', () => {
    // Render every locator in every reference plan and verify no errors.
    for (const entry of ALL_REFERENCE_PLANS) {
      it(`renders all locators in "${entry.name}" plan`, () => {
        const plan = entry.factory();
        for (const step of plan.steps) {
          if (step.target.kind === 'element') {
            const target = step.target;
            expect(() => {
              renderLocator(target.resolvedLocators);
            }, `Step "${step.description}" - element locator`).not.toThrow();

            // Also verify it produces a non-empty expression
            const result = renderLocator(target.resolvedLocators);
            expect(result.expression.length).toBeGreaterThan(0);
          }
          // Render assertion locators too
          for (const assertion of step.assertions) {
            if (assertion.target.kind === 'element') {
              const assertionTarget = assertion.target;
              expect(() => {
                renderLocator(assertionTarget.resolvedLocators);
              }, `Assertion in step "${step.description}"`).not.toThrow();
            }
          }
        }
      });
    }
  });
});
