/**
 * Page Object Renderer Tests — Milestone 5
 *
 * Tests that the POM renderer correctly groups elements by pageOrComponent,
 * generates locator getters, action methods, and produces valid TS classes.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPageObjects,
  renderPageObject,
  renderPageObjectFiles,
} from '../../../src/adapters/playwright/page-object-renderer';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import type { IRStep, ExecutionIRPlan, ResolvedLocator } from '../../../src/domain/execution-ir/types';
import { LocatorStrategyType, ValidationType, ValidationComparison, ValidationSeverity } from '../../../src/domain/enums';
import { ALL_REFERENCE_PLANS } from '../../../src/adapters/playwright/__fixtures__/reference-ir-plans';

// ── Helpers ───────────────────────────────────────────────

function makeLocator(type: LocatorStrategyType, value: string, priority = 1): ResolvedLocator {
  return { type, value, priority, confidence: 0.9 };
}

function makeElementStep(
  action: IRAction,
  elementId: string,
  elementName: string,
  pageOrComponent: string,
  locators: ResolvedLocator[],
  input?: IRStep['input'],
): IRStep {
  return {
    id: `step-${Math.random().toString(36).slice(2, 8)}`,
    order: 0,
    action,
    description: 'Test step',
    target: { kind: 'element', elementId, elementName, pageOrComponent, resolvedLocators: locators },
    input: input ?? null,
    assertions: [],
    executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
  };
}

function makeNavigateStep(url: string): IRStep {
  return {
    id: 'step-nav',
    order: 0,
    action: IRAction.NAVIGATE,
    description: 'Navigate',
    target: { kind: 'url', url },
    input: null,
    assertions: [],
    executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
  };
}

function makePlan(steps: IRStep[]): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title: 'Test Plan',
    tags: ['test'],
    environment: {
      baseUrl: 'https://staging.example.com',
      browser: 'chrome',
      viewport: { width: 1440, height: 900 },
    },
    steps,
  };
}

const ROLE_TEXTBOX = [makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]')];
const ROLE_BUTTON = [makeLocator(LocatorStrategyType.ROLE, 'button[name="Submit"]')];

// ── Grouping ──────────────────────────────────────────────

describe('page object grouping', () => {
  it('groups elements by pageOrComponent', () => {
    const plan = makePlan([
      makeNavigateStep('https://example.com'),
      makeElementStep(IRAction.FILL, 'elm-email', 'Email Input', 'LoginPage', ROLE_TEXTBOX, 'test@test.com'),
      makeElementStep(IRAction.CLICK, 'elm-signin', 'Sign In Button', 'LoginPage', ROLE_BUTTON),
      makeElementStep(IRAction.CLICK, 'elm-profile', 'Profile Link', 'DashboardPage',
        [makeLocator(LocatorStrategyType.ROLE, 'link[name="Profile"]')]),
    ]);

    const poms = buildPageObjects(plan);
    expect(poms).toHaveLength(2);

    const loginPage = poms.find(p => p.pageName === 'LoginPage')!;
    expect(loginPage).toBeDefined();
    expect(loginPage.elements).toHaveLength(2);
    expect(loginPage.methods).toHaveLength(2);

    const dashboardPage = poms.find(p => p.pageName === 'DashboardPage')!;
    expect(dashboardPage).toBeDefined();
    expect(dashboardPage.elements).toHaveLength(1);
    expect(dashboardPage.methods).toHaveLength(1);
  });

  it('deduplicates elements within same page', () => {
    const plan = makePlan([
      makeElementStep(IRAction.FILL, 'elm-email', 'Email Input', 'LoginPage', ROLE_TEXTBOX, 'a@b.com'),
      makeElementStep(IRAction.CLICK, 'elm-email', 'Email Input', 'LoginPage', ROLE_TEXTBOX),
    ]);

    const poms = buildPageObjects(plan);
    expect(poms).toHaveLength(1);
    expect(poms[0].elements).toHaveLength(1); // Same elementId, deduplicated
    expect(poms[0].methods).toHaveLength(2); // But both actions produce methods
  });

  it('produces correct className and fileName', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit', 'LoginPage', ROLE_BUTTON),
    ]);

    const poms = buildPageObjects(plan);
    expect(poms[0].className).toBe('LoginPage');
    expect(poms[0].fileName).toBe('login-page.ts');
  });
});

// ── Class Rendering ───────────────────────────────────────

describe('class rendering', () => {
  it('has import from @playwright/test', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit Button', 'LoginPage', ROLE_BUTTON),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain("import { Page, Locator } from '@playwright/test';");
  });

  it('has constructor(page: Page)', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit Button', 'LoginPage', ROLE_BUTTON),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('class LoginPage');
    expect(code).toContain('readonly page: Page');
    expect(code).toContain('constructor(page: Page)');
    expect(code).toContain('this.page = page');
  });

  it('has locator getter for each element', () => {
    const plan = makePlan([
      makeElementStep(IRAction.FILL, 'elm-email', 'Email Input', 'LoginPage', ROLE_TEXTBOX),
      makeElementStep(IRAction.CLICK, 'elm-signin', 'Sign In Button', 'LoginPage', ROLE_BUTTON),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);

    expect(code).toContain('get emailInput(): Locator');
    expect(code).toContain('get signInButton(): Locator');
  });

  it('locator getters use renderLocator output', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit Button', 'LoginPage', ROLE_BUTTON),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain("return this.page.getByRole('button', { name: 'Submit' });");
  });
});

// ── Action Methods ────────────────────────────────────────

describe('action methods', () => {
  it('generates click method', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit Button', 'LoginPage', ROLE_BUTTON),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async clickSubmit(): Promise<void>');
    expect(code).toContain('await this.submitButton.click()');
  });

  it('generates fill method with value parameter', () => {
    const plan = makePlan([
      makeElementStep(IRAction.FILL, 'elm-1', 'Email Input', 'LoginPage', ROLE_TEXTBOX, 'test@test.com'),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async fillEmail(value: string): Promise<void>');
    expect(code).toContain('await this.emailInput.fill(value)');
  });

  it('generates select method with value parameter', () => {
    const plan = makePlan([
      makeElementStep(IRAction.SELECT, 'elm-1', 'Country Dropdown', 'SettingsPage',
        [makeLocator(LocatorStrategyType.CSS, '#country')], 'United States'),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async selectCountry(value: string): Promise<void>');
    expect(code).toContain('await this.countryDropdown.selectOption(value)');
  });

  it('generates selectDate method', () => {
    const plan = makePlan([
      makeElementStep(IRAction.SELECT_DATE, 'elm-1', 'Date Picker', 'BookingPage',
        [makeLocator(LocatorStrategyType.CSS, '#date')], '2026-08-15'),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async setDate(date: string): Promise<void>');
    expect(code).toContain('await this.datePicker.fill(date)');
  });

  it('generates hover method', () => {
    const plan = makePlan([
      makeElementStep(IRAction.HOVER, 'elm-1', 'Products Menu', 'NavigationPage',
        [makeLocator(LocatorStrategyType.ROLE, 'button[name="Products"]')]),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async hoverProducts(): Promise<void>');
    expect(code).toContain('await this.productsMenu.hover()');
  });

  it('generates check method for TOGGLE true', () => {
    const plan = makePlan([
      makeElementStep(IRAction.TOGGLE, 'elm-1', 'Newsletter Checkbox', 'PreferencesPage',
        [makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Subscribe"]')], true),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async checkNewsletter(): Promise<void>');
    expect(code).toContain('await this.newsletterCheckbox.check()');
  });

  it('generates uncheck method for TOGGLE false', () => {
    const plan = makePlan([
      makeElementStep(IRAction.TOGGLE, 'elm-1', 'Email Notifications Checkbox', 'PreferencesPage',
        [makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Email notifications"]')], false),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async uncheckEmailNotifications(): Promise<void>');
    expect(code).toContain('await this.emailNotificationsCheckbox.uncheck()');
  });

  it('generates click method for TOGGLE null (literal toggle)', () => {
    const plan = makePlan([
      makeElementStep(IRAction.TOGGLE, 'elm-1', 'Toggle Switch', 'SettingsPage',
        [makeLocator(LocatorStrategyType.ROLE, 'switch[name="Dark Mode"]')], null),
    ]);
    const poms = buildPageObjects(plan);
    const code = renderPageObject(poms[0]);
    expect(code).toContain('async toggleToggle(): Promise<void>');
  });
});

// ── File Generation ───────────────────────────────────────

describe('renderPageObjectFiles', () => {
  it('returns one file per page object', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit Button', 'LoginPage', ROLE_BUTTON),
      makeElementStep(IRAction.CLICK, 'elm-2', 'Profile Link', 'DashboardPage',
        [makeLocator(LocatorStrategyType.ROLE, 'link[name="Profile"]')]),
    ]);

    const files = renderPageObjectFiles(plan);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('pages/login-page.ts');
    expect(files[1].path).toBe('pages/dashboard-page.ts');
  });

  it('all files have valid content', () => {
    const plan = makePlan([
      makeElementStep(IRAction.CLICK, 'elm-1', 'Submit Button', 'LoginPage', ROLE_BUTTON),
    ]);

    const files = renderPageObjectFiles(plan);
    for (const file of files) {
      expect(file.content).toContain('export class');
      expect(file.content).toContain('constructor(page: Page)');
    }
  });
});

// ── Reference Plan Coverage ───────────────────────────────

describe('reference plan coverage', () => {
  for (const entry of ALL_REFERENCE_PLANS) {
    it(`generates page objects for "${entry.name}"`, () => {
      const plan = entry.factory();
      const poms = buildPageObjects(plan);

      // Should have at least one page object
      expect(poms.length).toBeGreaterThan(0);

      // Each should render without errors
      for (const pom of poms) {
        const code = renderPageObject(pom);
        expect(code).toContain('export class');
        expect(code).toContain('constructor');
      }
    });
  }

  it('all reference plans produce valid page object files', () => {
    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      const files = renderPageObjectFiles(plan);
      expect(files.length).toBeGreaterThan(0);
    }
  });
});

describe('edge cases', () => {
  it('deduplicates methods for repeated same-action+element steps', () => {
    const plan: ExecutionIRPlan = {
      testCaseId: 'tc-1',
      testCaseVersionId: 'tcv1',
      testCaseVersionNumber: 1,
      title: 'Duplicate Fill',
      tags: ['test'],
      steps: [
        {
          id: 's1', action: IRAction.WAIT_FOR_ELEMENT, order: 0,
          description: 'Wait for email',
          target: {
            kind: 'element', elementId: 'el1', elementName: 'Email Input',
            pageOrComponent: 'LoginPage',
            resolvedLocators: [{ type: LocatorStrategyType.CSS, value: '#email', priority: 1, confidence: 0.9 }],
          },
          assertions: [],
          executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
          input: null,
        },
        {
          id: 's2', action: IRAction.FILL, order: 1,
          description: 'Fill email',
          target: {
            kind: 'element', elementId: 'el1', elementName: 'Email Input',
            pageOrComponent: 'LoginPage',
            resolvedLocators: [{ type: LocatorStrategyType.CSS, value: '#email', priority: 1, confidence: 0.9 }],
          },
          assertions: [],
          executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
          input: 'user@test.com',
        },
        {
          id: 's3', action: IRAction.FILL, order: 2,
          description: 'Fill email again',
          target: {
            kind: 'element', elementId: 'el1', elementName: 'Email Input',
            pageOrComponent: 'LoginPage',
            resolvedLocators: [{ type: LocatorStrategyType.CSS, value: '#email', priority: 1, confidence: 0.9 }],
          },
          assertions: [],
          executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
          input: 'other@test.com',
        },
      ],
      environment: {
        browser: 'chrome',
        viewport: { width: 1280, height: 720 },
        baseUrl: 'https://example.com',
      },
    };

    const poms = buildPageObjects(plan);
    expect(poms).toHaveLength(1);
    // Only one fillEmail method, even though there are two FILL steps on the same element
    expect(poms[0].methods).toHaveLength(1);
    expect(poms[0].methods[0].methodName).toBe('fillEmail');
    const code = renderPageObject(poms[0]);
    const fillCount = (code.match(/async fillEmail/g) || []).length;
    expect(fillCount).toBe(1);
  });

  it('registers assertion elements on non-element steps (NAVIGATE/WAIT)', () => {
    const plan: ExecutionIRPlan = {
      testCaseId: 'tc-1',
      testCaseVersionId: 'tcv1',
      testCaseVersionNumber: 1,
      title: 'Navigate with assertion',
      tags: ['test'],
      steps: [
        {
          id: 's1', action: IRAction.NAVIGATE, order: 0,
          description: 'Navigate to home',
          target: { kind: 'url', url: 'https://example.com' },
          assertions: [{
            type: ValidationType.VISIBILITY,
            comparison: ValidationComparison.IS_TRUE,
            expectedValue: null,
            severity: ValidationSeverity.HARD,
            target: {
              kind: 'element', elementId: 'el1', elementName: 'Page Heading',
              pageOrComponent: 'HomePage',
              resolvedLocators: [{ type: LocatorStrategyType.ROLE, value: 'heading', priority: 1, confidence: 0.9 }],
            },
            property: null,
          }],
          executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
          input: 'https://example.com',
        },
      ],
      environment: {
        browser: 'chrome',
        viewport: { width: 1280, height: 720 },
        baseUrl: 'https://example.com',
      },
    };

    const poms = buildPageObjects(plan);
    // HomePage page object should be created from the assertion's element target
    const homePage = poms.find(p => p.pageName === 'HomePage');
    expect(homePage).toBeDefined();
    expect(homePage!.elements).toHaveLength(1);
    expect(homePage!.elements[0].getterName).toBe('pageHeading');
  });
});
