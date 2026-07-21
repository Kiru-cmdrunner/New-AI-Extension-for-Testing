/**
 * Reference IR Plan Suite — permanent benchmark cases for all generators.
 *
 * These factory functions produce representative ExecutionIRPlan objects
 * covering common UI interaction patterns. Every future improvement to
 * the Playwright generator (or any future generator) should be validated
 * against these cases to detect regressions.
 *
 * Coverage goals:
 *   - Every LocatorStrategyType value appears in at least one plan.
 *   - Every business-authored IRAction appears in at least one plan.
 *   - Every ValidationType appears in at least one plan.
 *   - Common UI patterns: login, dropdowns, date pickers, checkboxes,
 *     radios, file upload, tables, search, modals, iframes, shadow DOM,
 *     keyboard input, complex form validations.
 *
 * Each function returns a FRESH object — no shared mutable state.
 */

import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../domain/execution-ir/types';
import type {
  ExecutionIRPlan,
  IRStep,
  ResolvedLocator,
  ElementTarget,
  IREnvironment,
  IRAssertion,
} from '../../../domain/execution-ir/types';
import {
  LocatorStrategyType,
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../../../domain/enums';

// ── Shared Constants ──────────────────────────────────────

const STANDARD_ENV: IREnvironment = {
  baseUrl: 'https://staging.example.com',
  browser: 'chrome',
  viewport: { width: 1440, height: 900 },
};

// ── Helpers ───────────────────────────────────────────────

let stepCounter = 0;
function resetCounter(): void {
  stepCounter = 0;
}

function makeLocator(
  type: LocatorStrategyType,
  value: string,
  priority: number,
  confidence = 0.9,
): ResolvedLocator {
  return { type, value, priority, confidence };
}

function makeElementTarget(
  elementId: string,
  elementName: string,
  pageOrComponent: string,
  locators: ResolvedLocator[],
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
  description: string,
  target: IRStep['target'],
  options?: {
    input?: IRStep['input'];
    assertions?: IRAssertion[];
    executionParameters?: IRStep['executionParameters'];
  },
): IRStep {
  return {
    id: `ref-step-${++stepCounter}`,
    order: stepCounter - 1,
    action,
    description,
    target,
    input: options?.input ?? null,
    assertions: options?.assertions ? [...options.assertions] : [],
    executionParameters: options?.executionParameters ?? { ...DEFAULT_EXECUTION_PARAMETERS },
  };
}

function makeAssertion(
  type: ValidationType,
  comparison: ValidationComparison,
  target: IRAssertion['target'],
  options?: {
    expectedValue?: unknown;
    property?: string | null;
    severity?: ValidationSeverity;
  },
): IRAssertion {
  return {
    type,
    comparison,
    target,
    expectedValue: options?.expectedValue ?? null,
    severity: options?.severity ?? ValidationSeverity.HARD,
    property: options?.property ?? null,
  };
}

function makePlan(
  title: string,
  tags: string[],
  steps: IRStep[],
  testCaseId = 'ref-tc-001',
  testCaseVersionId = 'ref-tcv-001',
  testCaseVersionNumber = 1,
): ExecutionIRPlan {
  return {
    testCaseId,
    testCaseVersionId,
    testCaseVersionNumber,
    title,
    tags,
    environment: { ...STANDARD_ENV },
    steps,
  };
}

// ── 1. Login Flow ─────────────────────────────────────────
// Covers: ROLE, CSS locator strategies; FILL, CLICK, NAVIGATE actions;
//         VISIBILITY, URL_MATCH validations.

export function loginFlowPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('User logs in with valid credentials', ['smoke', 'auth'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to login page',
      { kind: 'url', url: 'https://staging.example.com/login' },
    ),
    makeStep(IRAction.FILL, 'Enter email address',
      makeElementTarget('elm-email', 'Email Input', 'LoginPage', [
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]', 1),
        makeLocator(LocatorStrategyType.TEST_ID, 'email', 2),
        makeLocator(LocatorStrategyType.CSS, '#email-input', 3),
      ]),
      { input: 'john.doe@example.com' },
    ),
    makeStep(IRAction.FILL, 'Enter password',
      makeElementTarget('elm-password', 'Password Input', 'LoginPage', [
        makeLocator(LocatorStrategyType.LABEL, 'Password', 1),
        makeLocator(LocatorStrategyType.CSS, '#password', 2),
      ]),
      { input: 'secret123!' },
    ),
    makeStep(IRAction.CLICK, 'Click Sign In button',
      makeElementTarget('elm-signin', 'Sign In Button', 'LoginPage', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Sign In"]', 1),
        makeLocator(LocatorStrategyType.CSS, '.login-btn', 2),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.URL_MATCH, ValidationComparison.CONTAINS,
            { kind: 'url', url: 'https://staging.example.com/dashboard' },
            { expectedValue: '/dashboard', property: 'url' },
          ),
        ],
      },
    ),
    makeStep(IRAction.VERIFY, 'Verify dashboard heading is visible',
      makeElementTarget('elm-dashboard', 'Dashboard Heading', 'DashboardPage', [
        makeLocator(LocatorStrategyType.ROLE, 'heading[name="Dashboard"]', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.VISIBILITY, ValidationComparison.IS_TRUE,
            makeElementTarget('elm-dashboard', 'Dashboard Heading', 'DashboardPage', [
              makeLocator(LocatorStrategyType.ROLE, 'heading[name="Dashboard"]', 1),
            ]),
            { property: 'visible' },
          ),
        ],
      },
    ),
  ]);
}

// ── 2. Dropdown / Select ──────────────────────────────────
// Covers: SELECT action; ACCESSIBLE_NAME, CSS locators; TEXT_MATCH validation.

export function dropdownSelectPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Select country from dropdown', ['forms', 'select'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to settings page',
      { kind: 'url', url: 'https://staging.example.com/settings' },
    ),
    makeStep(IRAction.SELECT, 'Select country',
      makeElementTarget('elm-country', 'Country Dropdown', 'SettingsPage', [
        makeLocator(LocatorStrategyType.ACCESSIBLE_NAME, 'Country', 1),
        makeLocator(LocatorStrategyType.CSS, '#country-select', 2),
      ]),
      { input: 'United States' },
    ),
    makeStep(IRAction.VERIFY, 'Verify selected country text',
      makeElementTarget('elm-country-display', 'Country Display', 'SettingsPage', [
        makeLocator(LocatorStrategyType.TEXT, 'United States', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.TEXT_MATCH, ValidationComparison.EQUALS,
            makeElementTarget('elm-country-display', 'Country Display', 'SettingsPage', [
              makeLocator(LocatorStrategyType.TEXT, 'United States', 1),
            ]),
            { expectedValue: 'United States', property: 'text' },
          ),
        ],
      },
    ),
  ]);
}

// ── 3. Date Picker ────────────────────────────────────────
// Covers: SELECT_DATE action; ROLE, TEST_ID locators; ATTRIBUTE_MATCH validation.

export function datePickerPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Select departure date from date picker', ['forms', 'date'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to flight search',
      { kind: 'url', url: 'https://staging.example.com/flights' },
    ),
    makeStep(IRAction.SELECT_DATE, 'Select departure date',
      makeElementTarget('elm-departure-date', 'Departure Date Picker', 'FlightSearchPage', [
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Departure Date"]', 1),
        makeLocator(LocatorStrategyType.TEST_ID, 'departure-date', 2),
        makeLocator(LocatorStrategyType.CSS, '.date-picker input.departure', 3),
      ]),
      { input: '2026-08-15' },
    ),
    makeStep(IRAction.VERIFY, 'Verify date input has correct value',
      makeElementTarget('elm-departure-date', 'Departure Date Picker', 'FlightSearchPage', [
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Departure Date"]', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.ATTRIBUTE_MATCH, ValidationComparison.EQUALS,
            makeElementTarget('elm-departure-date', 'Departure Date Picker', 'FlightSearchPage', [
              makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Departure Date"]', 1),
            ]),
            { expectedValue: '2026-08-15', property: 'value' },
          ),
        ],
      },
    ),
  ]);
}

// ── 4. Checkbox and Radio Buttons ────────────────────────
// Covers: TOGGLE action; ROLE locators; PRESENCE validation.

export function checkboxRadioPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Toggle newsletter checkbox and select plan', ['forms', 'toggle'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to preferences',
      { kind: 'url', url: 'https://staging.example.com/preferences' },
    ),
    makeStep(IRAction.TOGGLE, 'Check newsletter subscription',
      makeElementTarget('elm-newsletter', 'Newsletter Checkbox', 'PreferencesPage', [
        makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Subscribe to newsletter"]', 1),
        makeLocator(LocatorStrategyType.CSS, '#newsletter-opt-in', 2),
      ]),
      { input: true },
    ),
    makeStep(IRAction.TOGGLE, 'Uncheck email notifications',
      makeElementTarget('elm-email-notif', 'Email Notifications Checkbox', 'PreferencesPage', [
        makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Email notifications"]', 1),
        makeLocator(LocatorStrategyType.CSS, '#email-notif', 2),
      ]),
      { input: false },
    ),
    makeStep(IRAction.CLICK, 'Select Pro plan radio button',
      makeElementTarget('elm-pro-plan', 'Pro Plan Radio', 'PreferencesPage', [
        makeLocator(LocatorStrategyType.ROLE, 'radio[name="Pro"]', 1),
        makeLocator(LocatorStrategyType.CSS, 'input[value="pro"]', 2),
      ]),
    ),
    makeStep(IRAction.VERIFY, 'Verify newsletter checkbox is checked',
      makeElementTarget('elm-newsletter', 'Newsletter Checkbox', 'PreferencesPage', [
        makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Subscribe to newsletter"]', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.PRESENCE, ValidationComparison.IS_TRUE,
            makeElementTarget('elm-newsletter', 'Newsletter Checkbox', 'PreferencesPage', [
              makeLocator(LocatorStrategyType.ROLE, 'checkbox[name="Subscribe to newsletter"]', 1),
            ]),
            { property: 'checked' },
          ),
        ],
      },
    ),
  ]);
}

// ── 5. Table Interaction ──────────────────────────────────
// Covers: XPATH locator; TEXT_MATCH with CONTAINS; CLICK on table row.

export function tableInteractionPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Find and edit user in table', ['tables', 'crud'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to users admin',
      { kind: 'url', url: 'https://staging.example.com/admin/users' },
    ),
    makeStep(IRAction.CLICK, 'Click Edit button for user John Doe',
      makeElementTarget('elm-edit-john', 'Edit Button for John Doe', 'UsersTable', [
        makeLocator(LocatorStrategyType.XPATH, '//tr[td[contains(text(),"John Doe")]]//button[contains(@class,"edit")]', 1),
        makeLocator(LocatorStrategyType.CSS, 'tr.user-john .edit-btn', 2),
      ]),
    ),
    makeStep(IRAction.VERIFY, 'Verify edit modal appears and table is behind overlay',
      makeElementTarget('elm-edit-modal', 'Edit User Modal', 'UsersTable', [
        makeLocator(LocatorStrategyType.ROLE, 'dialog[name="Edit User"]', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.VISIBILITY, ValidationComparison.IS_TRUE,
            makeElementTarget('elm-edit-modal', 'Edit User Modal', 'UsersTable', [
              makeLocator(LocatorStrategyType.ROLE, 'dialog[name="Edit User"]', 1),
            ]),
            { property: 'visible' },
          ),
          makeAssertion(
            ValidationType.VISIBILITY, ValidationComparison.IS_FALSE,
            makeElementTarget('elm-users-table', 'Users Table', 'UsersTable', [
              makeLocator(LocatorStrategyType.CSS, 'table.users-table', 1),
            ]),
            { property: 'visible', severity: ValidationSeverity.SOFT },
          ),
          makeAssertion(
            ValidationType.COUNT, ValidationComparison.LESS_THAN,
            makeElementTarget('elm-delete-btns', 'Delete Buttons', 'UsersTable', [
              makeLocator(LocatorStrategyType.CSS, '.delete-btn', 1),
            ]),
            { expectedValue: 10, property: 'count' },
          ),
        ],
      },
    ),
  ]);
}

// ── 6. Search with Autocomplete ───────────────────────────
// Covers: FILL with keyboard interaction; TEXT with CONTAINS; WAIT action.

export function searchAutocompletePlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Search for product with autocomplete', ['search', 'forms'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to product search',
      { kind: 'url', url: 'https://staging.example.com/shop' },
    ),
    makeStep(IRAction.FILL, 'Type in search box',
      makeElementTarget('elm-search', 'Search Input', 'ShopPage', [
        makeLocator(LocatorStrategyType.ROLE, 'combobox[name="Search products"]', 1),
        makeLocator(LocatorStrategyType.ACCESSIBLE_NAME, 'Search products', 2),
      ]),
      { input: 'wireless head' },
    ),
    makeStep(IRAction.WAIT, 'Wait for autocomplete results to load',
      { kind: 'none' },
      { input: 3000 },
    ),
    makeStep(IRAction.CLICK, 'Click first autocomplete suggestion',
      makeElementTarget('elm-suggestion-1', 'First Autocomplete Suggestion', 'ShopPage', [
        makeLocator(LocatorStrategyType.ROLE, 'option[name="Wireless Headphones"]', 1),
        makeLocator(LocatorStrategyType.CSS, '.autocomplete-suggestion:first-child', 2),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.URL_MATCH, ValidationComparison.CONTAINS,
            { kind: 'url', url: 'https://staging.example.com/shop/wireless-headphones' },
            { expectedValue: '/shop/wireless-headphones', property: 'url' },
          ),
        ],
      },
    ),
  ]);
}

// ── 7. Modal Dialog ───────────────────────────────────────
// Covers: ROLE dialog locator; CLICK on modal buttons; VISIBILITY validation.

export function modalDialogPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Confirm deletion in modal dialog', ['modals', 'crud'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to item detail',
      { kind: 'url', url: 'https://staging.example.com/items/42' },
    ),
    makeStep(IRAction.CLICK, 'Click Delete button',
      makeElementTarget('elm-delete-btn', 'Delete Button', 'ItemDetailPage', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Delete"]', 1),
        makeLocator(LocatorStrategyType.CSS, '.delete-action', 2),
      ]),
    ),
    makeStep(IRAction.CLICK, 'Click Confirm in modal',
      makeElementTarget('elm-confirm-delete', 'Confirm Delete Button', 'ConfirmDialog', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Confirm Delete"]', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.TEXT_MATCH, ValidationComparison.CONTAINS,
            makeElementTarget('elm-success-msg', 'Success Message', 'ItemDetailPage', [
              makeLocator(LocatorStrategyType.ROLE, 'status[name="Item deleted successfully"]', 1),
            ]),
            { expectedValue: 'deleted', property: 'text' },
          ),
        ],
      },
    ),
  ]);
}

// ── 8. Form with Complex Validations ──────────────────────
// Covers: COUNT validation; EQUALITY validation; multiple assertions per step.

export function complexFormPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Fill complex registration form with validations', ['forms', 'validation'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to registration',
      { kind: 'url', url: 'https://staging.example.com/register' },
    ),
    makeStep(IRAction.FILL, 'Enter full name',
      makeElementTarget('elm-fullname', 'Full Name Input', 'RegistrationForm', [
        makeLocator(LocatorStrategyType.LABEL, 'Full Name', 1),
        makeLocator(LocatorStrategyType.CSS, '#fullname', 2),
      ]),
      { input: 'Jane Smith' },
    ),
    makeStep(IRAction.FILL, 'Enter email',
      makeElementTarget('elm-reg-email', 'Registration Email', 'RegistrationForm', [
        makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]', 1),
        makeLocator(LocatorStrategyType.TEST_ID, 'reg-email', 2),
      ]),
      { input: 'jane@example.com' },
    ),
    makeStep(IRAction.CLICK, 'Submit form',
      makeElementTarget('elm-submit', 'Submit Button', 'RegistrationForm', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Register"]', 1),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.COUNT, ValidationComparison.EQUALS,
            makeElementTarget('elm-error-list', 'Error Messages', 'RegistrationForm', [
              makeLocator(LocatorStrategyType.CSS, '.form-error', 1),
            ]),
            { expectedValue: 0, property: 'count' },
          ),
          makeAssertion(
            ValidationType.COUNT, ValidationComparison.GREATER_THAN,
            makeElementTarget('elm-info-list', 'Info Messages', 'RegistrationForm', [
              makeLocator(LocatorStrategyType.CSS, '.form-info', 1),
            ]),
            { expectedValue: 0, property: 'count', severity: ValidationSeverity.SOFT },
          ),
          makeAssertion(
            ValidationType.VISIBILITY, ValidationComparison.IS_TRUE,
            makeElementTarget('elm-success', 'Success Banner', 'RegistrationForm', [
              makeLocator(LocatorStrategyType.ROLE, 'alert[name="Registration successful"]', 1),
            ]),
            { property: 'visible' },
          ),
        ],
      },
    ),
  ]);
}

// ── 9. Hover Interaction ──────────────────────────────────
// Covers: HOVER action; CSS locator with pseudo-class pattern.

export function hoverMenuPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Hover over menu to reveal dropdown', ['navigation', 'hover'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to home',
      { kind: 'url', url: 'https://staging.example.com/' },
    ),
    makeStep(IRAction.HOVER, 'Hover over Products menu',
      makeElementTarget('elm-products-menu', 'Products Menu Item', 'Navigation', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Products"]', 1),
        makeLocator(LocatorStrategyType.CSS, '.nav-products', 2),
      ]),
    ),
    makeStep(IRAction.CLICK, 'Click revealed submenu item',
      makeElementTarget('elm-submenu-laptops', 'Laptops Submenu Link', 'Navigation', [
        makeLocator(LocatorStrategyType.ROLE, 'link[name="Laptops"]', 1),
        makeLocator(LocatorStrategyType.CSS, '.submenu-laptops', 2),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.URL_MATCH, ValidationComparison.EQUALS,
            { kind: 'url', url: 'https://staging.example.com/products/laptops' },
            { expectedValue: 'https://staging.example.com/products/laptops', property: 'url' },
          ),
        ],
      },
    ),
  ]);
}

// ── 10. Custom Validation (Edge Cases) ────────────────────
// Covers: CUSTOM validation type; EQUALITY with boolean; multiple locator
//         strategy types on a single element including XPATH.

export function customValidationPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Verify custom component state', ['validation', 'custom'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to dashboard',
      { kind: 'url', url: 'https://staging.example.com/dashboard' },
    ),
    makeStep(IRAction.VERIFY, 'Verify toggle is enabled',
      makeElementTarget('elm-feature-toggle', 'Feature Toggle Switch', 'DashboardPage', [
        makeLocator(LocatorStrategyType.ROLE, 'switch[name="Dark Mode"]', 1),
        makeLocator(LocatorStrategyType.TEST_ID, 'dark-mode-toggle', 2),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.EQUALITY, ValidationComparison.IS_TRUE,
            makeElementTarget('elm-feature-toggle', 'Feature Toggle Switch', 'DashboardPage', [
              makeLocator(LocatorStrategyType.ROLE, 'switch[name="Dark Mode"]', 1),
            ]),
            { expectedValue: true, property: 'checked' },
          ),
          makeAssertion(
            ValidationType.CUSTOM, ValidationComparison.MATCHES,
            makeElementTarget('elm-feature-toggle', 'Feature Toggle Switch', 'DashboardPage', [
              makeLocator(LocatorStrategyType.ROLE, 'switch[name="Dark Mode"]', 1),
            ]),
            { expectedValue: 'aria-checked.*true', property: 'class' },
          ),
        ],
      },
    ),
  ]);
}

// ── 11. File Upload ───────────────────────────────────────
// Covers: CLICK on file input; CSS locator; PRESENCE validation after upload.

export function fileUploadPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Upload profile picture', ['forms', 'upload'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to profile settings',
      { kind: 'url', url: 'https://staging.example.com/profile' },
    ),
    makeStep(IRAction.CLICK, 'Click upload button',
      makeElementTarget('elm-upload-btn', 'Upload Profile Picture Button', 'ProfilePage', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Upload Photo"]', 1),
        makeLocator(LocatorStrategyType.CSS, 'input[type="file"]', 2),
      ]),
    ),
    makeStep(IRAction.VERIFY, 'Verify upload success indicator',
      makeElementTarget('elm-upload-success', 'Upload Success Badge', 'ProfilePage', [
        makeLocator(LocatorStrategyType.TEXT, 'Upload successful', 1),
        makeLocator(LocatorStrategyType.CSS, '.upload-success', 2),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.PRESENCE, ValidationComparison.IS_TRUE,
            makeElementTarget('elm-upload-success', 'Upload Success Badge', 'ProfilePage', [
              makeLocator(LocatorStrategyType.TEXT, 'Upload successful', 1),
            ]),
            { property: 'present' },
          ),
        ],
      },
    ),
  ]);
}

// ── 12. Pagination Navigation ─────────────────────────────
// Covers: CLICK on pagination; XPATH; TEXT_MATCH with STARTS_WITH.

export function paginationPlan(): ExecutionIRPlan {
  resetCounter();
  return makePlan('Navigate to page 2 of results', ['navigation', 'pagination'], [
    makeStep(IRAction.NAVIGATE, 'Navigate to search results',
      { kind: 'url', url: 'https://staging.example.com/search?q=laptop' },
    ),
    makeStep(IRAction.CLICK, 'Click Next Page button',
      makeElementTarget('elm-next-page', 'Next Page Button', 'SearchResultsPage', [
        makeLocator(LocatorStrategyType.ROLE, 'button[name="Next"]', 1),
        makeLocator(LocatorStrategyType.XPATH, '//button[contains(@aria-label,"Next")]', 2),
      ]),
    ),
    makeStep(IRAction.VERIFY, 'Verify page 2 indicator',
      makeElementTarget('elm-page-indicator', 'Current Page Indicator', 'SearchResultsPage', [
        makeLocator(LocatorStrategyType.TEXT, 'Page 2', 1),
        makeLocator(LocatorStrategyType.CSS, '.pagination .current', 2),
      ]),
      {
        assertions: [
          makeAssertion(
            ValidationType.TEXT_MATCH, ValidationComparison.STARTS_WITH,
            makeElementTarget('elm-page-indicator', 'Current Page Indicator', 'SearchResultsPage', [
              makeLocator(LocatorStrategyType.TEXT, 'Page 2', 1),
            ]),
            { expectedValue: 'Page 2', property: 'text' },
          ),
        ],
      },
    ),
  ]);
}

// ── Suite Index ───────────────────────────────────────────

export interface ReferencePlanEntry {
  name: string;
  description: string;
  factory: () => ExecutionIRPlan;
}

export const ALL_REFERENCE_PLANS: ReferencePlanEntry[] = [
  { name: 'loginFlow', description: 'Login with email/password + dashboard verification', factory: loginFlowPlan },
  { name: 'dropdownSelect', description: 'Select from dropdown + verify selection', factory: dropdownSelectPlan },
  { name: 'datePicker', description: 'Date picker interaction + value verification', factory: datePickerPlan },
  { name: 'checkboxRadio', description: 'Toggle checkbox + select radio + verify state', factory: checkboxRadioPlan },
  { name: 'tableInteraction', description: 'Find row in table + click edit + modal appears', factory: tableInteractionPlan },
  { name: 'searchAutocomplete', description: 'Type in search + wait + click autocomplete suggestion', factory: searchAutocompletePlan },
  { name: 'modalDialog', description: 'Delete confirmation modal + success verification', factory: modalDialogPlan },
  { name: 'complexForm', description: 'Multi-field form with count + visibility validations', factory: complexFormPlan },
  { name: 'hoverMenu', description: 'Hover navigation menu + click revealed submenu', factory: hoverMenuPlan },
  { name: 'customValidation', description: 'Verify toggle state with equality + custom regex', factory: customValidationPlan },
  { name: 'fileUpload', description: 'Upload file + verify success indicator', factory: fileUploadPlan },
  { name: 'pagination', description: 'Navigate pagination + verify page indicator', factory: paginationPlan },
];
